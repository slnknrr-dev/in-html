// pdf/inspect.js - a structural reader of PDF files with a classic cross-reference table (what pdf/doc.js and most
// simple writers produce): checks the header, startxref, every xref offset against its "N 0 obj", stream /Length
// against the position of "endstream", decodes Flate streams, lists pages, fonts (embedded, subset, ToUnicode),
// images, links and the Info dictionary, and extracts page text through the fonts' ToUnicode maps (or WinAnsi) -
// so a test can prove that drawn text is also copyable text. Object streams and xref streams are not supported.
//
//   inspectPDF(bytes) -> { ok, problems, version, size, xrefOk, objects, streams: [{ obj, length, lengthOk, filter,
//       decodedLength }], pages: [{ width, height, text: [string per BT block], fonts, images, links }], fonts: [{ obj,
//       base, subtype, embedded, subset, toUnicode }], images, links, info, outlines, text (all pages, joined) }
//   parseCMap(text) -> Map(code (number) -> string)
//   tokenize(content) -> [{ t: 'num' | 'name' | 'str' | 'hex' | 'op' | '[' | ']' | '<<' | '>>', v }]

import { unzlibSync } from '../codec/zlib.js';
//
// Design: a verifier, not a general parser. It decodes the file as latin1 text (byte i = char i, so string offsets
// ARE byte offsets - essential for checking xref offsets) and uses targeted regexes on dictionaries. That is enough
// for the flat, predictable output of doc.js and keeps this module small; a real-world PDF with object streams,
// incremental updates or nested dictionaries in /Resources would need a proper object parser.
// It reports `problems` instead of throwing, so a test sees every structural defect at once.

const dec = (b) => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return s; };

const CP1252_REV = { 0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178 };

// Content-stream lexer per PDF 32000 section 7.2: literal strings with balanced parentheses and backslash escapes
// (octal up to 3 digits, line continuation), hex strings (odd length padded with 0 as the spec says), names with #xx
// escapes, numbers, and everything else as operators. Delimiters are the spec's set ( ) < > [ ] { } / %.
export function tokenize(s) {
  const out = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === '(') {
      let depth = 1, v = '';
      i++;
      while (i < n && depth) {
        const ch = s[i];
        if (ch === '\\') {
          const e = s[i + 1];
          if (/[0-7]/.test(e)) { const m = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))[0]; v += String.fromCharCode(parseInt(m, 8) & 255); i += 1 + m.length; continue; }
          v += { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[e] ?? (e === '\r' || e === '\n' ? '' : e);
          i += 2;
          continue;
        }
        if (ch === '(') depth++;
        if (ch === ')' && --depth === 0) { i++; break; }
        v += ch;
        i++;
      }
      out.push({ t: 'str', v });
      continue;
    }
    if (c === '<' && s[i + 1] === '<') { out.push({ t: '<<' }); i += 2; continue; }
    if (c === '>' && s[i + 1] === '>') { out.push({ t: '>>' }); i += 2; continue; }
    if (c === '<') {
      const e = s.indexOf('>', i);
      let h = s.slice(i + 1, e < 0 ? n : e).replace(/\s/g, '');
      if (h.length % 2) h += '0';
      let v = '';
      for (let k = 0; k < h.length; k += 2) v += String.fromCharCode(parseInt(h.slice(k, k + 2), 16));
      out.push({ t: 'hex', v });
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (c === '[' || c === ']') { out.push({ t: c }); i++; continue; }
    if (c === '/') {
      let j = i + 1;
      while (j < n && !/[\s/[\]()<>{}%]/.test(s[j])) j++;
      out.push({ t: 'name', v: s.slice(i + 1, j).replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))) });
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !/[\s/[\]()<>{}%]/.test(s[j])) j++;
    if (j === i) { i++; continue; }
    const w = s.slice(i, j);
    out.push(/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w) ? { t: 'num', v: +w } : { t: 'op', v: w });
    i = j;
  }
  return out;
}

// ToUnicode CMap: bfchar (single codes) and bfrange (consecutive codes, either incrementing from a base or listed in
// an array). Destination strings are UTF-16BE hex, decoded per code unit so surrogate pairs survive. A range is
// capped at 65536 codes so a corrupt range cannot loop for minutes. Incrementing ranges assume BMP destinations.
export function parseCMap(text) {
  const map = new Map();
  const hexStr = (h) => { let s = ''; for (let k = 0; k + 3 < h.length + 0; k += 4) s += String.fromCharCode(parseInt(h.slice(k, k + 4), 16)); return s; };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), hexStr(m[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (m[4] != null) { const base = parseInt(m[4], 16); for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, String.fromCharCode(base + c - lo)); }
      else { const list = [...m[5].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => hexStr(x[1])); list.forEach((v, k) => map.set(lo + k, v)); }
    }
  }
  return map;
}

// Checks in dependency order: header and %%EOF -> startxref points at 'xref' -> every entry is exactly 20 bytes and
// its offset lands on "N 0 obj" -> trailer /Size matches -> each stream's /Length ends right before 'endstream' ->
// Flate data inflates. Text extraction replays Tf / Tj / TJ / ' / " with a token stack and decodes strings through
// the current font's ToUnicode (2-byte for Type0, else 1-byte with a WinAnsi fallback).
export function inspectPDF(bytes) {
  const problems = [];
  const text = dec(bytes);
  const version = (/^%PDF-(\d\.\d)/.exec(text) || [])[1] || null;
  if (!version) problems.push('header');
  if (!/%%EOF\s*$/.test(text)) problems.push('no %%EOF at the end');
  const sx = text.lastIndexOf('startxref');
  const xrefAt = sx >= 0 ? parseInt(text.slice(sx + 9).trim(), 10) : -1;
  let xrefOk = xrefAt >= 0 && text.startsWith('xref', xrefAt);
  if (!xrefOk) problems.push('startxref does not point at an xref table');
  const offsets = new Map();
  let size = 0;
  if (xrefOk) {
    const m = /^xref\s+(\d+)\s+(\d+)\s*?\n/.exec(text.slice(xrefAt));
    if (!m) { xrefOk = false; problems.push('xref subsection header'); }
    else {
      let p = xrefAt + m[0].length;
      const first = +m[1], count = +m[2];
      for (let k = 0; k < count; k++, p += 20) {
        const line = text.slice(p, p + 20);
        if (!/^\d{10} \d{5} [nf](\r\n| \n| \r)$/.test(line)) { xrefOk = false; problems.push('xref entry ' + (first + k) + ' is not 20 bytes'); break; }
        if (line[17] !== 'n') continue;
        const off = +line.slice(0, 10), i = first + k;
        if (!text.startsWith(`${i} 0 obj`, off)) { xrefOk = false; problems.push(`xref offset of object ${i} is wrong`); }
        offsets.set(i, off);
      }
      const tm = /trailer\s*<<([\s\S]*?)>>\s*startxref/.exec(text.slice(xrefAt));
      size = tm ? +((/\/Size (\d+)/.exec(tm[1]) || [])[1] || 0) : 0;
      if (!tm) problems.push('no trailer');
      if (size !== first + count) problems.push(`/Size ${size} differs from the xref count ${first + count}`);
    }
  }
  const trailer = (/trailer\s*<<([\s\S]*?)>>\s*startxref/.exec(text) || [, ''])[1];
  const objs = new Map();
  const streams = [];
  for (const [i, off] of offsets) {
    const end = text.indexOf('endobj', off);
    const head = text.slice(off, end < 0 ? text.length : end);
    const si = head.search(/stream\r?\n/);
    const o = { i, off, dict: si >= 0 ? head.slice(0, si) : head, data: null };
    if (si >= 0 && /\/Length\s/.test(o.dict)) {
      const nl = head[si + 6] === '\r' ? 8 : 7;
      const start = off + si + nl;
      const len = +((/\/Length (\d+)(?!\s+\d+\s+R)/.exec(o.dict) || [])[1] ?? -1);
      const after = text.slice(start + len, start + len + 12);
      const lengthOk = len >= 0 && /^\r?\n?endstream/.test(after);
      if (!lengthOk) problems.push(`stream length of object ${i}`);
      let data = bytes.subarray(start, start + Math.max(0, len));
      const filter = (/\/Filter\s*\/(\w+)/.exec(o.dict) || [])[1] || null;
      let decodedLength = data.length;
      if (filter === 'FlateDecode') { try { data = unzlibSync(data); decodedLength = data.length; } catch { problems.push(`object ${i}: Flate data does not inflate`); } }
      o.data = data; o.filter = filter;
      streams.push({ obj: i, length: len, lengthOk, filter, decodedLength });
    }
    objs.set(i, o);
  }
  const ref = (dict, key) => { const m = new RegExp('/' + key + '\\s+(\\d+)\\s+0\\s+R').exec(dict); return m ? +m[1] : null; };
  const textStr = (raw) => {
    if (raw == null) return '';
    if (raw.startsWith('<')) { const h = raw.slice(1, -1).replace(/\s/g, ''); let s = ''; const st = /^feff/i.test(h) ? 4 : 0; for (let k = st; k < h.length; k += 4) s += String.fromCharCode(parseInt(h.slice(k, k + 4), 16)); return s; }
    return tokenize(raw)[0]?.v ?? '';
  };
  // fonts
  const fonts = [];
  const fontInfo = new Map();
  for (const o of objs.values()) {
    if (!/\/Type\s*\/Font\b/.test(o.dict) || /\/CIDFontType2|\/CIDFontType0/.test(o.dict)) continue;
    const subtype = (/\/Subtype\s*\/(\w+)/.exec(o.dict) || [])[1];
    const base = (/\/BaseFont\s*\/([^\s/<>[\]]+)/.exec(o.dict) || [])[1] || '';
    const tuRef = ref(o.dict, 'ToUnicode');
    const cmap = tuRef && objs.get(tuRef)?.data ? parseCMap(dec(objs.get(tuRef).data)) : null;
    let embedded = false;
    const descFrom = (d) => { const r = ref(d, 'FontDescriptor'); const fd = r && objs.get(r); return fd ? /\/FontFile[23]?\s+\d+/.test(fd.dict) : false; };
    if (subtype === 'Type0') { const m = /\/DescendantFonts\s*\[\s*(\d+)\s+0\s+R/.exec(o.dict); const df = m && objs.get(+m[1]); embedded = df ? descFrom(df.dict) : false; }
    else embedded = descFrom(o.dict);
    const info = { obj: o.i, base, subtype, embedded, subset: /^[A-Z]{6}\+/.test(base), toUnicode: !!cmap, cmapSize: cmap ? cmap.size : 0, twoByte: subtype === 'Type0' };
    fonts.push(info);
    fontInfo.set(o.i, { ...info, cmap });
  }
  const decodeString = (font, raw) => {
    if (!font) return raw;
    let s = '';
    if (font.twoByte) {
      for (let k = 0; k + 1 < raw.length; k += 2) { const code = (raw.charCodeAt(k) << 8) | raw.charCodeAt(k + 1); s += font.cmap?.get(code) ?? '�'; }
      return s;
    }
    for (let k = 0; k < raw.length; k++) { const b = raw.charCodeAt(k); s += font.cmap?.get(b) ?? String.fromCharCode(CP1252_REV[b] || b); }
    return s;
  };
  // pages
  const pages = [];
  const links = [];
  for (const o of objs.values()) {
    if (!/\/Type\s*\/Page\b(?!s)/.test(o.dict)) continue;
    const mb = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(o.dict);
    const resRef = ref(o.dict, 'Resources');
    const res = resRef ? objs.get(resRef)?.dict || '' : o.dict;
    const fontMap = new Map();
    const fm = /\/Font\s*<<([^>]*)>>/.exec(res);
    if (fm) for (const m of fm[1].matchAll(/\/([^\s/]+)\s+(\d+)\s+0\s+R/g)) fontMap.set(m[1], fontInfo.get(+m[2]));
    const im = /\/XObject\s*<<([^>]*)>>/.exec(res);
    const pageText = [];
    const cRef = ref(o.dict, 'Contents');
    const content = cRef && objs.get(cRef)?.data ? dec(objs.get(cRef).data) : '';
    let font = null, cur = '';
    const stack = [];
    for (const t of tokenize(content)) {
      if (t.t !== 'op') { stack.push(t); continue; }
      if (t.v === 'Tf') { const nm = stack.filter((x) => x.t === 'name').pop(); font = nm ? fontMap.get(nm.v) : null; }
      else if (t.v === 'Tj' || t.v === "'" || t.v === '"') { const st = stack.filter((x) => x.t === 'str' || x.t === 'hex').pop(); if (st) cur += decodeString(font, st.v); }
      else if (t.v === 'TJ') { const open = stack.map((x) => x.t).lastIndexOf('['); for (const x of stack.slice(open + 1)) if (x.t === 'str' || x.t === 'hex') cur += decodeString(font, x.v); }
      else if (t.v === 'ET') { if (cur) pageText.push(cur); cur = ''; }
      stack.length = 0;
    }
    const pageLinks = [];
    const an = /\/Annots\s*\[([^\]]*)\]/.exec(o.dict);
    if (an) for (const m of an[1].matchAll(/(\d+)\s+0\s+R/g)) {
      const a = objs.get(+m[1]);
      if (!a) continue;
      const uri = /\/URI\s*(\((?:\\.|[^\\)])*\))/.exec(a.dict);
      const l = uri ? { uri: tokenize(uri[1])[0].v } : { dest: /\/Dest\s*\[\s*(\d+)\s+0\s+R/.test(a.dict) ? +/\/Dest\s*\[\s*(\d+)/.exec(a.dict)[1] : null };
      pageLinks.push(l); links.push(l);
    }
    pages.push({ obj: o.i, width: mb ? +mb[3] - +mb[1] : 0, height: mb ? +mb[4] - +mb[2] : 0, text: pageText, fonts: [...fontMap.keys()], images: im ? [...im[1].matchAll(/\/(\w+)\s+\d+\s+0\s+R/g)].map((x) => x[1]) : [], links: pageLinks });
  }
  // document order of pages (the /Kids array of the root)
  const rootRef = ref(trailer, 'Root');
  const root = rootRef && objs.get(rootRef);
  const treeRef = root ? ref(root.dict, 'Pages') : null;
  const kids = treeRef && objs.get(treeRef) ? [...(/\/Kids\s*\[([^\]]*)\]/.exec(objs.get(treeRef).dict) || [, ''])[1].matchAll(/(\d+)\s+0\s+R/g)].map((m) => +m[1]) : [];
  if (kids.length) pages.sort((a, b) => kids.indexOf(a.obj) - kids.indexOf(b.obj));
  const count = treeRef ? +((/\/Count (\d+)/.exec(objs.get(treeRef)?.dict || '') || [])[1] || 0) : 0;
  if (count !== pages.length) problems.push(`/Count ${count} differs from ${pages.length} page objects`);
  const infoRef = ref(trailer, 'Info');
  const info = {};
  if (infoRef && objs.get(infoRef)) {
    const d = objs.get(infoRef).dict;
    for (const k of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate']) {
      const m = new RegExp('/' + k + '\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)').exec(d);
      if (m) info[k] = textStr(m[1]);
    }
  }
  const outlines = root && /\/Outlines\s+\d+/.test(root.dict) ? +((/\/Count (\d+)/.exec(objs.get(ref(root.dict, 'Outlines'))?.dict || '') || [])[1] || 0) : 0;
  const images = [...objs.values()].filter((o) => /\/Subtype\s*\/Image/.test(o.dict)).length;
  return {
    ok: problems.length === 0, problems, version, size, xrefOk, objects: objs.size, streams, pages, fonts, images, links, info, outlines,
    text: pages.map((p) => p.text.join('\n')).join('\n'),
  };
}
