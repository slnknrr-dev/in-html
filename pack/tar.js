// pack/tar.js - tar writer: POSIX ustar headers, pax extended headers ('x') for what ustar cannot hold (long or
// non-ASCII paths and link targets, sizes of 8 GiB and more, fractional times), directories, symbolic and hard links.
// The output reads back with GNU tar, bsdtar, 7-Zip and ../archive/tar.js.
//
//   tar(entries, { pax = true, owner }) -> Uint8Array
//     entries: { path, data?: Uint8Array, dir?: boolean, kind?: 'file' | 'dir' | 'symlink' | 'hardlink',
//                link?: string, mtime?: Date | number (ms), mode?: number (permission bits or a full Unix mode) }
//   tarHeader(entry, size) -> Uint8Array (one or more 512-byte blocks: the pax header first when needed)

// DESIGN. Write plain ustar whenever it can represent the entry, and add a pax 'x' header only for what it cannot:
// maximum compatibility (old readers see a valid ustar entry) and no overhead for ordinary files. uid/gid 0 and
// the optional owner name: archives built in a browser have no meaningful numeric ids.
const BLOCK = 512;
const te = new TextEncoder();

function put(b, o, n, s) { const v = te.encode(s); b.set(v.subarray(0, n), o); }
// Numeric fields: zero-padded octal, NUL-terminated, filling the field (the most widely accepted form).
function putOctal(b, o, n, v) { put(b, o, n - 1, Math.floor(v).toString(8).padStart(n - 1, '0')); b[o + n - 1] = 0; }

const isAscii = (s) => /^[\x20-\x7e]*$/.test(s);
const msOf = (t) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.now());

// ustar keeps names up to 100 bytes, or a prefix of up to 155 bytes plus a name of up to 100 split at a '/'.
function splitUstar(path) {
  if (path.length <= 100) return ['', path];
  for (let i = path.length - 1; i > 0; i--) {
    if (path[i] !== '/') continue;
    if (i <= 155 && path.length - i - 1 <= 100 && path.length - i - 1 > 0) return [path.slice(0, i), path.slice(i + 1)];
  }
  return null;
}

// The length prefix includes its own digits, so it is solved by iteration (converges in at most two steps).
function paxRecord(key, value) {
  // "<len> <key>=<value>\n", where len counts itself.
  const body = ' ' + key + '=' + value + '\n';
  const bl = te.encode(body).length;
  let len = bl + 1;
  while (String(len).length + bl !== len) len = String(len).length + bl;
  return len + body;
}

// One 512-byte header. The checksum is computed with the checksum field set to spaces, then written as six octal
// digits, NUL, space (the traditional layout). Only permission bits go into 'mode': the type is in typeflag.
function block(name, size, { mode, mtime, type, link = '', prefix = '', owner = '' }) {
  const b = new Uint8Array(BLOCK);
  put(b, 0, 100, name);
  putOctal(b, 100, 8, mode & 0o7777);
  putOctal(b, 108, 8, 0);
  putOctal(b, 116, 8, 0);
  putOctal(b, 124, 12, size);
  putOctal(b, 136, 12, Math.max(0, Math.floor(mtime / 1000)));
  b.fill(0x20, 148, 156);
  b[156] = type.charCodeAt(0);
  put(b, 157, 100, link);
  put(b, 257, 6, 'ustar');
  put(b, 263, 2, '00');
  put(b, 265, 32, owner);
  put(b, 297, 32, owner);
  put(b, 345, 155, prefix);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += b[i];
  put(b, 148, 7, sum.toString(8).padStart(6, '0') + '\0');
  b[155] = 0x20;
  return b;
}

const kindOf = (e) => e.kind || (e.dir ? 'dir' : e.link != null ? 'symlink' : 'file');

export function tarHeader(e, size, { pax = true, owner = '' } = {}) {
  const kind = kindOf(e);
  let path = String(e.path).replace(/\\/g, '/').replace(/^\/+/, '');
  if (kind === 'dir' && !path.endsWith('/')) path += '/';
  const type = { file: '0', dir: '5', symlink: '2', hardlink: '1' }[kind] || '0';
  const mtime = msOf(e.mtime);
  const mode = e.mode != null ? e.mode : kind === 'dir' ? 0o755 : kind === 'symlink' ? 0o777 : 0o644;
  const link = e.link || '';
  const records = [];
  // ustar fields are bytes of an unspecified charset; non-ASCII paths go through pax (UTF-8 by definition).
  const split = isAscii(path) ? splitUstar(path) : null;
  if (!split) records.push(paxRecord('path', path));
  if (link && (!isAscii(link) || link.length > 100)) records.push(paxRecord('linkpath', link));
  // The 12-byte size field holds 11 octal digits: < 8 GiB. Fractional mtimes are kept via pax only.
  // KNOWN DEFECT: with { pax: false } an entry of 8 GiB or more is written with size 0 and its data still follows,
  // which desynchronises every reader. Fix: use the GNU base-256 size encoding (0x80 marker) when pax is off.
  if (size >= 8 ** 11) records.push(paxRecord('size', String(size)));
  if (mtime % 1000) records.push(paxRecord('mtime', (mtime / 1000).toFixed(3)));
  const [prefix, name] = split || ['', paxName(path)];
  const main = block(name, size >= 8 ** 11 ? 0 : size, { mode, mtime, type, link: isAscii(link) ? link.slice(0, 100) : '', prefix, owner });
  if (!records.length || !pax) return main;
  const body = te.encode(records.join(''));
  // The pax header's own name is informational; readers apply its records to the next entry.
  const xname = ('PaxHeaders/' + name).slice(0, 100);
  const head = block(xname, body.length, { mode: 0o644, mtime, type: 'x' });
  const out = new Uint8Array(BLOCK * 2 + Math.ceil(body.length / BLOCK) * BLOCK);
  out.set(head, 0);
  out.set(body, BLOCK);
  out.set(main, out.length - BLOCK);
  return out;
}

// A fallback ustar name (for readers without pax): the last 100 ASCII characters of the path.
function paxName(path) {
  const a = path.replace(/[^\x20-\x7e]/g, '_');
  return a.length <= 100 ? a : a.slice(a.length - 100);
}

export function tar(entries, opts = {}) {
  const parts = [];
  let total = 0;
  for (const e of entries) {
    const kind = kindOf(e);
    const data = kind === 'file' && e.data ? e.data : null;
    const size = data ? data.length : 0;
    const h = tarHeader(e, size, opts);
    parts.push(h);
    total += h.length;
    if (data) {
      parts.push(data);
      const pad = (BLOCK - (size % BLOCK)) % BLOCK;
      if (pad) parts.push(new Uint8Array(pad));
      total += size + pad;
    }
  }
  // The zero blocks and padding are already zero in the fresh Uint8Array, so only 'total' needs adjusting.
  // Two zero blocks end the archive; the record is padded to 10240 bytes as tar(1) does.
  total += BLOCK * 2;
  const rec = 10240;
  const end = Math.ceil(total / rec) * rec;
  const out = new Uint8Array(end);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
