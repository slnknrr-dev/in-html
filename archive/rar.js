// archive/rar.js - RAR archives of the 1.5 - 4.x format (and RAR 1.4 "RE~^" archives; extraction only): listing,
// extraction and testing. RAR 5 archives are handed to openRar5, so openRar opens every RAR archive.
//
//   openRar(sources, { password, charset }) -> Archive (contract in README.md)
//
// Blocks: { CRC16 (low half of CRC32 from the type byte on), type, flags, size, [data size] }: marker 0x72, main 0x73
// (old-style archive comment embedded), file 0x74, old comment 0x75, old AV / subblock / recovery / sign 0x76-0x79,
// NEWSUB 0x7a (CMT archive comment, ACL, STM, RR, QO ...), end of archive 0x7b. With MHD_PASSWORD every block after
// the main header is preceded by an 8-byte salt and AES-128-CBC encrypted (padded to 16 bytes). Unicode names use
// RAR's packed encoding (EncodeFileName) after the legacy name and a zero byte, or UTF-8 when nothing follows.
// Compression: unpack versions 15 (RAR 1.3-1.5), 20 / 26 (RAR 2.x), 29 (RAR 2.9-4.x); encryption: RAR 1.3, 1.5 and
// 2.9+ (AES); RAR 2.0 encryption is not supported. RAR 1.4 checksums are the 16-bit RAR 1.4 sum, all others CRC32.

import { ArchiveError, EMPTY, Reader, bytesStream, concatStreams, decodeText, dosDateTime, fail, hashStream, le16, le32, readAll, readAt, sourceStream, utf8 } from './io.js';
import { crc32 } from '../codec/crc32.js';
import { AesCbc } from '../crypto/aes.js';
import { windowSize } from './rarbits.js';
import { Unpack15 } from './unpack15.js';
import { Unpack20 } from './unpack20.js';
import { UNPACK29_FILTER_MAX, Unpack29 } from './unpack29.js';
import { cbcStream, rar13Stream, rar15Stream, rar3Key } from './rarcrypt.js';
import { dictLabel, openRar5, scanRarSignature } from './rar5.js';

const HOSTS = ['MS-DOS', 'OS/2', 'Windows', 'Unix', 'Mac OS', 'BeOS'];
const dictProp = (n) => dictLabel(n).replace(/([KMGT])$/, ' $1B');

/** EncodeFileName::Decode: 16-bit characters from the legacy name bytes and a packed stream of flag pairs. */
// Compression of UTF-16 names against the legacy (OEM) name: most characters share a high byte (one script), so the
// stream stores one `high` byte once and 2-bit opcodes per character: 0 low byte with high 0, 1 low byte with `high`,
// 2 full 16-bit char, 3 a run copied from the legacy name (optionally shifted by `corr` into the `high` page). Every
// read is bounds-checked because a truncated stream must yield a shorter name, never an exception or garbage reads.
export function decodeRarUnicode(name, enc) {
  const out = [];
  let p = 0, flags = 0, bits = 0;
  const high = p < enc.length ? enc[p++] : 0;
  while (p < enc.length) {
    if (bits === 0) { flags = enc[p++]; bits = 8; }
    switch (flags >> 6) {
      case 0:
        if (p >= enc.length) break;
        out.push(enc[p++]);
        break;
      case 1:
        if (p >= enc.length) break;
        out.push(enc[p++] + (high << 8));
        break;
      case 2:
        if (p + 1 >= enc.length) break;
        out.push(enc[p] + (enc[p + 1] << 8));
        p += 2;
        break;
      case 3: {
        if (p >= enc.length) break;
        let len = enc[p++];
        if (len & 0x80) {
          if (p >= enc.length) break;
          const corr = enc[p++];
          for (len = (len & 0x7f) + 2; len > 0; len--) out.push(((name[out.length] + corr) & 0xff) + (high << 8));
        } else for (len += 2; len > 0 && out.length < name.length; len--) out.push(name[out.length]);
        break;
      }
    }
    flags = (flags << 2) & 0xff;
    bits -= 2;
  }
  let s = '';
  // Chunked spread: String.fromCharCode(...out) with a huge array would exceed the engine's argument count limit.
  for (let i = 0; i < out.length; i += 4096) s += String.fromCharCode(...out.slice(i, i + 4096));
  return s;
}

/** RAR 1.4 file checksum: 16-bit sum rotated left after every byte. */
export function checksum14(b, prev = 0) {
  let c = prev;
  for (let i = 0; i < b.length; i++) { c = (c + b[i]) & 0xffff; c = ((c << 1) | (c >>> 15)) & 0xffff; }
  return c;
}

export function openRar(sources, opts = {}) {
  if (!Array.isArray(sources)) sources = [sources];
  const sig = scanRarSignature(sources[0], opts.offset);
  if (!sig) fail('format', 'not a RAR archive');
  if (sig.version === 5) return openRar5(sources, opts);
  const old = sig.version === 1.4;
  const arc = {
    format: old ? 'rar14' : 'rar', label: old ? 'RAR 1.4' : 'RAR', entries: [], password: opts.password ?? null,
    info: { solid: false, encrypted: false, headersEncrypted: false, volumes: 0, methods: [], warnings: [], props: [] },
  };
  const charset = opts.charset || 'auto';
  const files = [], internal = new WeakMap();
  let recovery = false, locked = false, volume = false, comment = null, cmtHeader = null, oldCmt = null, av = false;

  // --- headers -------------------------------------------------------------------------------------------------
  for (let vi = 0; vi < sources.length; vi++) {
    const src = sources[vi];
    const base = vi === 0 ? sig.offset : 0;
    if (vi > 0) {
      const s2 = src.read(0, 7);
      const ok = old ? s2[0] === 0x52 && s2[1] === 0x45 && s2[2] === 0x7e && s2[3] === 0x5e : s2[0] === 0x52 && s2[1] === 0x61 && s2[2] === 0x72 && s2[3] === 0x21 && s2[6] === 0;
      if (!ok) { arc.info.warnings.push(`volume ${vi + 1} is not a RAR volume`); break; }
    }
    arc.info.volumes = vi + 1;
    let more = false, ended = false;
    if (old) {
      const mh = readAt(src, base, 7), hsize = le16(mh, 4), mflags = mh[6];
      if (hsize < 7) fail('corrupt', 'corrupt RAR 1.4 main header');
      if (vi === 0) {
        volume = (mflags & 1) !== 0;
        arc.info.solid = (mflags & 8) !== 0;
        locked = (mflags & 4) !== 0;
        if (mflags & 2) oldCmt = { pos: base + 7, end: base + hsize, packed: (mflags & 0x10) !== 0, v14: true };
      }
      let pos = base + hsize;
      while (pos + 21 <= src.size) {
        const h = readAt(src, pos, 21);
        const hsz = le16(h, 10);
        if (hsz < 21) { arc.info.warnings.push('corrupt RAR 1.4 file header'); break; }
        const full = readAt(src, pos, hsz), nameLen = h[19], fl = h[17];
        const f = {
          name: decodeText(full.subarray(21, 21 + nameLen), charset), dir: (h[16] & 0x10) !== 0, size: le32(h, 4),
          crc: le16(h, 8), sum14: true, attr: h[16], host: 0, ftime: le32(h, 12), ver: h[18] === 2 ? 13 : 10, method: h[20],
          stored: h[20] === 0, encrypted: (fl & 4) !== 0, crypt: (fl & 4) ? 'rar13' : null, salt: null,
          splitBefore: (fl & 1) !== 0, splitAfter: (fl & 2) !== 0, solidFlag: false, dict: 0x10000,
          parts: [{ vi, off: pos + hsz, len: le32(h, 0) }], mtime: null, ctime: null, atime: null, unicode: false,
        };
        f.mtime = dosDateTime(f.ftime & 0xffff, f.ftime >>> 16);
        addFile(f);
        pos += hsz + le32(h, 0);
      }
      if (!volume) break;
      continue;
    }

    let pos = base + 7, hkey = null;
    // main header
    {
      const h = readAt(src, pos, 7);
      if (h[2] !== 0x73) fail('corrupt', 'RAR main header missing');
      const size = le16(h, 5);
      const mh = readAt(src, pos, size);
      const flags = le16(mh, 3);
      // Some old writers computed the main header CRC over the first 13 bytes only (before optional fields existed),
      // so either value is accepted; a mismatch is a warning, not fatal, as unrar does.
      const crcAll = crc32(mh, 2, size) & 0xffff, crc13 = crc32(mh, 2, Math.min(13, size)) & 0xffff;
      if (le16(mh, 0) !== crcAll && le16(mh, 0) !== crc13) arc.info.warnings.push('RAR main header checksum mismatch');
      if (vi === 0) {
        volume = (flags & 1) !== 0;
        arc.info.solid = (flags & 8) !== 0;
        locked = (flags & 4) !== 0;
        recovery = (flags & 0x40) !== 0;
        av = (flags & 0x20) !== 0;
        if ((flags & 2) && size > 13 + 7 && mh[13 + 2] === 0x75) oldCmt = { header: mh.subarray(13) };
      }
      if (flags & 0x80) {
        arc.info.headersEncrypted = arc.info.encrypted = true;
        if (arc.password == null) fail('password', 'the archive headers are encrypted: a password is needed');
        hkey = true;
      }
      pos += size;
    }
    let first = true;
    while (pos < src.size) {
      let h, blockLen;
      if (hkey) {
        if (pos + 8 + 16 > src.size) break;
        const salt = readAt(src, pos, 8);
        const k = rar3Key(arc.password, salt);
        const dec = new AesCbc(k.key, k.iv, { decrypt: true, padding: false });
        const b0 = dec.update(readAt(src, pos + 8, 16));
        const size = le16(b0, 5), padded = (size + 15) & ~15;
        // Garbage from a wrong key shows first as an impossible size (the CRC check below catches the rest).
        if (size < 7 || pos + 8 + padded > src.size) fail(first ? 'badPassword' : 'corrupt', first ? 'wrong password' : 'corrupt RAR header');
        h = new Uint8Array(padded);
        h.set(b0);
        if (padded > 16) h.set(dec.update(readAt(src, pos + 24, padded - 16)), 16);
        h = h.subarray(0, size);
        blockLen = 8 + padded;
      } else {
        if (pos + 7 > src.size) break;
        const h7 = readAt(src, pos, 7);
        const size = le16(h7, 5);
        if (size < 7) fail('corrupt', 'corrupt RAR block header at ' + pos);
        h = readAt(src, pos, size);
        blockLen = size;
      }
      const type = h[2], flags = le16(h, 3), size = h.length;
      const crcOk = (crc32(h, 2, size) & 0xffff) === le16(h, 0);
      if (!crcOk && hkey && first) fail('badPassword', 'wrong password');
      first = false;
      let dataSize = 0;
      if ((type === 0x74 || type === 0x7a) && size >= 32) {
        dataSize = le32(h, 7) + (flags & 0x100 && size >= 40 ? le32(h, 32) * 4294967296 : 0);
      } else if (flags & 0x8000 && size >= 11) dataSize = le32(h, 7);
      const dataPos = pos + blockLen;
      if (type === 0x74 || type === 0x7a) {
        if (!crcOk) arc.info.warnings.push('RAR file header checksum mismatch');
        const f = fileHeader(h, flags, vi, dataPos, dataSize);
        if (type === 0x74) addFile(f);
        else if (f.name === 'CMT' && !cmtHeader) cmtHeader = f;
        else if (f.name === 'RR') recovery = true;
        else if (f.name === 'AV') av = true;
      } else if (type === 0x7b) {
        more = (flags & 1) !== 0;
        ended = true;
        break;
      } else if (type === 0x78) recovery = true;
      else if (type === 0x76 || type === 0x79) av = true;
      pos = dataPos + dataSize;
    }
    if (ended ? !more : !volume) break;
  }

  function fileHeader(h, flags, vi, dataPos, dataSize) {
    if (h.length < 32) fail('corrupt', 'corrupt RAR file header');
    let p = 32, unp = le32(h, 11);
    if (flags & 0x100) {
      const hu = le32(h, 36);
      unp = unp === 0xffffffff && hu === 0xffffffff ? -1 : unp + hu * 4294967296;
      p = 40;
    } else if (unp === 0xffffffff) unp = -1;
    const nameLen = le16(h, 26), raw = h.subarray(p, p + nameLen);
    p += nameLen;
    let name;
    if (flags & 0x200) {
      const z = raw.indexOf(0);
      name = z >= 0 && z + 1 < raw.length ? decodeRarUnicode(raw.subarray(0, z), raw.subarray(z + 1)) : '';
      if (!name) name = utf8(z >= 0 ? raw.subarray(0, z) : raw);
    } else name = decodeText(raw, charset);
    let salt = null;
    if (flags & 0x400) { salt = h.slice(p, p + 8); p += 8; }
    const host = h[15], ver = h[24], method = h[25], attr = le32(h, 28), ftime = le32(h, 20);
    const f = {
      name, size: unp, host, crc: le32(h, 16), sum14: false, ftime, ver, method: method - 0x30, stored: method === 0x30,
      attr, dir: (flags & 0xe0) === 0xe0, encrypted: (flags & 4) !== 0, salt, splitBefore: (flags & 1) !== 0,
      splitAfter: (flags & 2) !== 0, solidFlag: (flags & 0x10) !== 0, unicode: (flags & 0x200) !== 0,
      dict: 0x10000 << ((flags & 0xe0) >> 5), parts: [{ vi, off: dataPos, len: dataSize }],
      mtime: dosDateTime(ftime & 0xffff, ftime >>> 16), ctime: null, atime: null, subFlags: attr,
    };
    if (f.dir) f.dict = 0;
    f.crypt = !f.encrypted ? null : ver === 13 ? 'rar13' : ver === 15 ? 'rar15' : ver === 20 || ver === 26 ? 'rar20' : 'rar30';
    if (flags & 0x1000 && p + 2 <= h.length) {
      try { extTime(h, p, f); } catch { /* damaged extended time: keep the DOS time */ }
    }
    return f;
  }

  function extTime(h, p, f) {
    const flags = le16(h, p);
    p += 2;
    const names = ['mtime', 'ctime', 'atime', null];
    for (let i = 0; i < 4; i++) {
      const mode = (flags >> ((3 - i) * 4)) & 15;
      if (!(mode & 8) || !names[i]) continue;
      let base;
      if (i === 0) base = f.mtime;
      else { const t = le32(h, p); p += 4; base = dosDateTime(t & 0xffff, t >>> 16); }
      if (!base) continue;
      let rem = 0;
      const n = mode & 3;
      for (let j = 0; j < n; j++) rem |= h[p++] << ((j + 3 - n) * 8); // units of 100 ns, most significant bytes
      f[names[i]] = new Date(base.getTime() + (mode & 4 ? 1000 : 0) + rem / 10000);
    }
  }

  function addFile(f) {
    const prev = files[files.length - 1];
    if (f.splitBefore && prev && prev.splitAfter && !prev.complete) {
      prev.parts.push(...f.parts);
      prev.splitAfter = f.splitAfter;
      prev.crc = f.crc;
      if (!f.splitAfter) prev.complete = true;
      return;
    }
    if (f.splitBefore) arc.info.warnings.push('file continued from a missing volume: ' + f.name);
    f.complete = !f.splitAfter;
    files.push(f);
  }

  // --- entries -------------------------------------------------------------------------------------------------
  const methods = new Set();
  let prevCompressed = null, groupStart = -1, maxDict = 0, seenCompressed = false;
  for (const f of files) {
    const index = arc.entries.length;
    const path = f.name.replace(/[\\/]+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    const unixHost = f.host === 3 || f.host === 5;
    if (!f.dir && unixHost && (f.attr & 0xf000) === 0x4000) f.dir = true;
    if (!f.dir && !unixHost && !f.sum14 && (f.attr & 0x10) && f.size === 0 && f.stored) f.dir = true;
    const kind = f.dir ? 'dir' : unixHost && (f.attr & 0xf000) === 0xa000 ? 'symlink' : 'file';
    const packed = f.parts.reduce((n, q) => n + q.len, 0);
    const entry = { index, path, dir: f.dir, kind, size: f.size >= 0 ? f.size : undefined, packed };
    if (f.mtime) entry.mtime = f.mtime;
    if (f.ctime) entry.ctime = f.ctime;
    if (f.atime) entry.atime = f.atime;
    if (unixHost) entry.mode = f.attr & 0xffff; else if (f.host <= 2) entry.attrib = f.attr;
    let method;
    if (!f.dir) {
      method = f.stored ? 'Store' : `RAR ${f.sum14 ? '1.4' : (f.ver / 10).toFixed(1)} m${f.method}`;
      entry.method = method;
      methods.add(method);
    }
    if (f.encrypted) { entry.encrypted = true; arc.info.encrypted = true; }
    if (!f.sum14) entry.crc = f.crc;
    const solid = f.ver <= 15 ? arc.info.solid && seenCompressed : f.solidFlag;
    if (solid && !f.dir) entry.solid = true;
    f.algo = f.ver <= 15 ? 15 : f.ver === 20 || f.ver === 26 ? 20 : f.ver === 29 ? 29 : 0;
    let why = null;
    if (!f.dir && !f.stored && (f.algo === 0 || f.method < 1 || f.method > 5)) why = `unknown RAR compression (version ${f.ver}, method ${f.method})`;
    else if (f.crypt === 'rar20') why = 'RAR 2.0 encryption';
    if (why) entry.unsupported = why;
    if (!f.dir && !f.stored && !why && packed > 0) {
      seenCompressed = true;
      maxDict = Math.max(maxDict, f.dict);
      if (!solid || !prevCompressed || prevCompressed.algo !== f.algo) groupStart = index;
      f.group = groupStart;
      prevCompressed = f;
    }
    if (kind === 'symlink' && f.stored && !f.encrypted && f.complete && f.size >= 0 && f.size < 4096) {
      try { entry.link = utf8(readAll(limitTo(partsStream(f), f.size, f.name))); } catch { /* left to open() */ }
    }
    f.index = index;
    arc.entries.push(entry);
    internal.set(entry, f);
  }
  const groups = new Map();
  for (const f of files) if (f.group != null) { if (!groups.has(f.group)) groups.set(f.group, []); groups.get(f.group).push(f); }
  for (const list of groups.values()) list.forEach((f, i) => { f.list = list; f.pos = i; });

  arc.info.methods = [...methods];
  const props = arc.info.props;
  const vers = [...new Set(files.filter((f) => !f.dir && !f.stored).map((f) => (f.sum14 ? 'RAR 1.4' : 'RAR ' + (f.ver / 10).toFixed(1))))];
  props.push(['Version', old ? 'RAR 1.4' : vers.length ? 'RAR 1.5-4.x (' + vers.join(', ') + ')' : 'RAR 1.5-4.x']);
  if (maxDict) props.push(['Dictionary', dictProp(maxDict)]);
  if (arc.info.solid) props.push(['Solid', 'yes']);
  if (recovery) props.push(['Recovery record', 'yes']);
  if (locked) props.push(['Locked', 'yes']);
  if (av) props.push(['Authenticity verification', 'yes']);
  if (volume) props.push(['Volumes', String(arc.info.volumes)]);
  if (arc.info.headersEncrypted) props.push(['Encrypted headers', 'yes']);
  const hosts = [...new Set(files.map((f) => HOSTS[f.host] || 'host ' + f.host))];
  if (!old && hosts.length) props.push(['Host OS', hosts.join(', ')]);
  if (sig.offset) { arc.info.sfx = sig.offset; props.push(['SFX', 'yes']); }

  // --- data ----------------------------------------------------------------------------------------------------
  function partsStream(f) {
    if (!f.complete) fail('volume', `missing volume: ${f.name} continues in the next volume`);
    return concatStreams(f.parts.map((q) => () => sourceStream(sources[q.vi], q.off, q.len)));
  }

  // Packed data; an encrypted file is one cipher stream across its volume parts (as unrar keeps the decryptor when
  // it switches volumes; verified for RAR 5 volumes made by Rar.exe, whose parts end anywhere).
  function input(f) {
    const s = partsStream(f);
    if (!f.crypt) return s;
    if (arc.password == null) fail('password', 'a password is needed: ' + f.name);
    if (f.crypt === 'rar30') { const k = rar3Key(arc.password, f.salt); return cbcStream(s, k.key, k.iv); }
    if (f.crypt === 'rar15') return rar15Stream(s, arc.password);
    if (f.crypt === 'rar13') return rar13Stream(s, arc.password);
    return fail('unsupported', 'not supported: RAR 2.0 encryption');
  }

  const DECODERS = { 15: Unpack15, 20: Unpack20, 29: Unpack29 };
  let state = null;
  function unpackerFor(f) {
    const list = f.list;
    if (state && state.list === list && state.next <= f.pos) return state;
    let dict = 0, total = 0;
    for (const g of list) { dict = Math.max(dict, g.dict); total = total >= 0 && g.size >= 0 ? total + g.size : -1; }
    const need = windowSize(dict, total, f.algo === 29 ? UNPACK29_FILTER_MAX : 0);
    const C = DECODERS[f.algo];
    const reuse = state && state.unp instanceof C && state.unp.W >= need && state.unp.W <= 4 * need + 0x100000;
    state = { unp: reuse ? state.unp : new C(need), list, next: 0 };
    return state;
  }

  function decoded(f) {
    const st = unpackerFor(f);
    try {
      while (st.next < f.pos) {
        const g = st.list[st.next];
        const s = st.unp.file(new Reader(input(g)), g.size, st.next > 0);
        st.next++;
        while (s.read(1 << 20));
      }
      st.next = f.pos + 1;
      const out = st.unp.file(new Reader(input(f)), f.size, f.pos > 0);
      // A failure inside the file leaves the decoder mid-stream: the next open starts the solid stream over.
      return { size: out.size, read(max) { try { return out.read(max); } catch (e) { if (state === st && e.code !== 'aborted') state = null; throw e; } } };
    } catch (e) {
      state = null;
      throw e;
    }
  }

  function openFile(f) {
    if (f.dir) return bytesStream(EMPTY);
    const entry = arc.entries[f.index];
    if (entry.unsupported) fail('unsupported', 'not supported: ' + entry.unsupported);
    let s;
    if (f.stored) {
      s = input(f);
      if (f.size >= 0) s = limitTo(s, f.size, f.name);
    } else if (f.group == null) s = bytesStream(EMPTY);
    else s = decoded(f);
    const name = f.name, size = f.size >= 0 ? f.size : undefined;
    let c = 0;
    s = f.sum14
      ? hashStream(s, (b) => { c = checksum14(b, c); }, () => c === f.crc, { name, size })
      : hashStream(s, (b) => { c = crc32(b, 0, b.length, c); }, () => c === f.crc >>> 0, { name, size });
    if (!f.encrypted) return s;
    // No password check value in these formats: a wrong password shows up as damaged data.
    return { size: s.size, read(max) {
      try { return s.read(max); } catch (e) {
        if (e instanceof ArchiveError && (e.code === 'checksum' || e.code === 'corrupt' || e.code === 'truncated')) fail('badPassword', 'wrong password or damaged data: ' + name);
        throw e;
      }
    } };
  }

  arc.open = (entry) => {
    const f = internal.get(entry) || internal.get(arc.entries[entry.index]);
    if (!f) fail('format', 'entry of another archive');
    return openFile(f);
  };

  // --- comments ------------------------------------------------------------------------------------------------
  try {
    if (cmtHeader) {
      const f = cmtHeader;
      f.complete = true;
      if (!f.crypt || arc.password != null) {
        let s = input(f);
        if (!f.stored) {
          const algo = f.ver <= 15 ? 15 : f.ver === 29 ? 29 : 20;
          s = new DECODERS[algo](windowSize(f.dict || 0x10000, f.size, algo === 29 ? UNPACK29_FILTER_MAX : 0)).file(new Reader(s), f.size, false);
        } else if (f.size >= 0) s = limitTo(s, f.size, 'comment');
        const b = readAll(s, 1 << 24);
        comment = f.subFlags & 1 ? new TextDecoder('utf-16le').decode(b) : decodeText(b, charset);
      }
    } else if (oldCmt && oldCmt.header) {
      // RAR 2.x: comment block inside the main header: size, UnpSize(2), UnpVer, Method, CommCRC(2), data.
      const h = oldCmt.header, size = le16(h, 5), unp = le16(h, 7), ver = h[9], method = h[10], ccrc = le16(h, 11);
      const data = h.subarray(13, size);
      let b = data;
      if (method !== 0x30) {
        const algo = ver <= 15 ? 15 : ver === 29 ? 29 : 20;
        b = readAll(new DECODERS[algo](windowSize(0x10000, unp, algo === 29 ? UNPACK29_FILTER_MAX : 0)).file(new Reader(bytesStream(data)), unp, false));
      }
      if ((crc32(b) & 0xffff) !== ccrc) arc.info.warnings.push('archive comment checksum mismatch');
      comment = decodeText(b, charset);
    } else if (oldCmt && oldCmt.v14) {
      // RAR 1.4: length (2), then the text, or (packed) the unpacked length (2) and RAR 1.3-encrypted RAR 1.5 data.
      const src = sources[0], n = le16(readAt(src, oldCmt.pos, 2), 0);
      let b = readAt(src, oldCmt.pos + 2, n);
      if (oldCmt.packed && n >= 2) {
        const unp = le16(b, 0);
        const s = rar13Stream(bytesStream(b.subarray(2)), null);
        b = readAll(new Unpack15(windowSize(0x10000, unp)).file(new Reader(s), unp, false));
      }
      comment = decodeText(b, charset);
    }
  } catch (e) { arc.info.warnings.push('archive comment: ' + e.message); }
  if (comment != null) arc.info.comment = comment.replace(/\0+$/, '');
  return arc;
}

function limitTo(stream, n, name) {
  let left = n;
  return {
    size: n,
    read(max = 1 << 20) {
      if (left <= 0) return null;
      const b = stream.read(Math.min(max, left));
      if (!b || !b.length) fail('truncated', 'unexpected end of data: ' + name);
      const r = b.length > left ? b.subarray(0, left) : b;
      left -= r.length;
      return r;
    },
  };
}
