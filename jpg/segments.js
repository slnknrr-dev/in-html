// jpg/segments.js - JPEG marker segments: listing (entropy-coded data skipped), SOFn / DQT / DHT / DRI / APPn / COM
// parsing, building files back from segments, and a summary (size, components, subsampling, mode, estimated
// quality, JFIF / Adobe / EXIF / XMP / ICC presence, comments).
//
//   isJPEG(bytes)
//   readSegments(bytes) -> [{ marker, name, offset, length, data, scan? }]   data excludes the 2 length bytes;
//                           an SOS entry carries scan: { start, end } of its entropy-coded data
//   writeSegments(segments) -> Uint8Array          (inverse of readSegments; scan data is copied after SOS)
//   segment(marker, payload) -> Uint8Array          one marker segment with its length
//   parseSOF(data, marker), parseDQT(data), parseDHT(data), parseAPP(marker, data), parseSOS(data)
//   jpegInfo(bytes) -> summary (see below)

//
// JPEG structure: a sequence of FF xx markers; most carry a 16-bit big-endian length (including the length bytes
// themselves); SOI / EOI / RSTn stand alone. After SOS comes entropy-coded data with no length field, where FF is
// escaped as FF 00, so the scan's end is found by searching for the next real marker (scanEnd).
// Segments are views (subarray) into the input: listing a 20 MB photo allocates almost nothing.
export const MARKER_NAMES = {
  0xd8: 'SOI', 0xd9: 'EOI', 0xda: 'SOS', 0xdb: 'DQT', 0xc4: 'DHT', 0xdd: 'DRI', 0xdc: 'DNL', 0xfe: 'COM', 0xcc: 'DAC',
  0xc0: 'SOF0', 0xc1: 'SOF1', 0xc2: 'SOF2', 0xc3: 'SOF3', 0xc5: 'SOF5', 0xc6: 'SOF6', 0xc7: 'SOF7',
  0xc9: 'SOF9', 0xca: 'SOF10', 0xcb: 'SOF11', 0xcd: 'SOF13', 0xce: 'SOF14', 0xcf: 'SOF15',
};
for (let i = 0; i < 16; i++) MARKER_NAMES[0xe0 + i] = 'APP' + i;
for (let i = 0; i < 8; i++) MARKER_NAMES[0xd0 + i] = 'RST' + i;

// C4 (DHT), C8 (JPG extension, reserved) and CC (DAC) sit inside the C0-CF range but are not frame headers.
export const isSOF = (m) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
const u8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));

export function isJPEG(bytes) {
  return !!bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// End of entropy-coded data starting at p: the first marker that is not a stuffed 0xFF00 or RSTn.
function scanEnd(b, p) {
  for (let i = p; i < b.length - 1; i++) {
    if (b[i] !== 0xff) continue;
    const m = b[i + 1];
    if (m === 0 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) continue;
    return i;
  }
  return b.length;
}

/** Marker segments of a JPEG file. Standalone markers (SOI, EOI, RSTn) have length 0 and empty data. */
// Tolerant: garbage between segments and fill bytes (FF FF ...) are skipped, as decoders do; a truncated file
// yields the segments read so far. Only an impossible length (< 2) throws, since no recovery point exists after it.
export function readSegments(input) {
  const b = u8(input);
  if (!isJPEG(b)) throw new Error('not a JPEG file');
  const out = [{ marker: 0xd8, name: 'SOI', offset: 0, length: 0, data: b.subarray(2, 2) }];
  let p = 2;
  while (p < b.length) {
    if (b[p] !== 0xff) { p++; continue; } // tolerate garbage between segments
    while (p < b.length && b[p + 1] === 0xff) p++; // fill bytes
    const m = b[p + 1];
    if (m === undefined) break;
    if (m === 0xd9) { out.push({ marker: m, name: 'EOI', offset: p, length: 0, data: b.subarray(p + 2, p + 2) }); break; }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xd8) { p += 2; continue; }
    if (p + 4 > b.length) break;
    const len = (b[p + 2] << 8) | b[p + 3];
    if (len < 2) throw new Error('corrupt JPEG segment length at ' + p);
    const data = b.subarray(p + 4, Math.min(b.length, p + 2 + len));
    const seg = { marker: m, name: MARKER_NAMES[m] || '0x' + m.toString(16), offset: p, length: len - 2, data };
    out.push(seg);
    p += 2 + len;
    if (m === 0xda) {
      const end = scanEnd(b, p);
      seg.scan = { start: p, end };
      seg.scanData = b.subarray(p, end);
      p = end;
    }
  }
  return out;
}

/** One marker segment: FF marker, 16-bit length (payload + 2), payload. */
export function segment(marker, payload = new Uint8Array(0)) {
  const d = u8(payload);
  if (d.length > 65533) throw new Error('JPEG segment payload too large');
  const s = new Uint8Array(4 + d.length);
  s[0] = 0xff; s[1] = marker; s[2] = (d.length + 2) >> 8; s[3] = (d.length + 2) & 255;
  s.set(d, 4);
  return s;
}

/** File from segments (as returned by readSegments, possibly filtered / extended). */
export function writeSegments(segments) {
  const parts = [];
  for (const s of segments) {
    if (s.marker === 0xd8 || s.marker === 0xd9 || (s.marker >= 0xd0 && s.marker <= 0xd7)) parts.push(new Uint8Array([0xff, s.marker]));
    else parts.push(segment(s.marker, s.data));
    if (s.scanData) parts.push(s.scanData);
  }
  if (!segments.some((s) => s.marker === 0xd9)) parts.push(new Uint8Array([0xff, 0xd9]));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const PROCESS = { 0xc0: 'baseline', 0xc1: 'extended', 0xc2: 'progressive', 0xc3: 'lossless', 0xc5: 'differential sequential', 0xc6: 'differential progressive', 0xc7: 'differential lossless', 0xc9: 'extended', 0xca: 'progressive', 0xcb: 'lossless', 0xcd: 'differential sequential', 0xce: 'differential progressive', 0xcf: 'differential lossless' };

export function parseSOF(d, marker) {
  if (d.length < 6) throw new Error('JPEG: short SOF');
  const n = d[5];
  if (d.length < 6 + n * 3) throw new Error('JPEG: short SOF');
  const components = [];
  for (let i = 0; i < n; i++) components.push({ id: d[6 + i * 3], h: d[7 + i * 3] >> 4, v: d[7 + i * 3] & 15, tq: d[8 + i * 3] });
  return {
    marker, process: PROCESS[marker] || 'unknown', progressive: marker === 0xc2 || marker === 0xca || marker === 0xc6 || marker === 0xce,
    arithmetic: marker >= 0xc9, precision: d[0], height: (d[1] << 8) | d[2], width: (d[3] << 8) | d[4], components,
  };
}

// Natural (row-major) index of the k-th coefficient in zigzag order.
export const ZIGZAG = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
  28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61,
  54, 47, 55, 62, 63,
]);

/** Quantization tables: [{ id, precision (0: 8-bit, 1: 16-bit), table: Uint16Array(64) in natural order }]. */
// One DQT segment may hold several tables. Values are stored in zigzag order in the file and converted to natural
// (row-major) order here, the order the DCT code works in.
export function parseDQT(d) {
  const out = [];
  for (let p = 0; p < d.length;) {
    const pq = d[p] >> 4, id = d[p] & 15;
    p++;
    const table = new Uint16Array(64);
    for (let k = 0; k < 64; k++) { table[ZIGZAG[k]] = pq ? (d[p] << 8) | d[p + 1] : d[p]; p += pq ? 2 : 1; }
    if (p > d.length) throw new Error('JPEG: short DQT');
    out.push({ id, precision: pq, table });
  }
  return out;
}

/** Huffman tables: [{ cls (0 DC, 1 AC), id, counts: Uint8Array(16), symbols: Uint8Array }]. */
// Canonical Huffman: counts[i] = number of codes of length i+1, then the symbols in code order; that is all a
// decoder needs to rebuild the code table. More than 256 symbols is impossible for 8-bit symbols, so it means a
// corrupt file.
export function parseDHT(d) {
  const out = [];
  for (let p = 0; p < d.length;) {
    const cls = d[p] >> 4, id = d[p] & 15;
    const counts = d.subarray(p + 1, p + 17);
    let total = 0;
    for (let i = 0; i < 16; i++) total += counts[i];
    if (p + 17 + total > d.length || total > 256) throw new Error('JPEG: bad DHT');
    out.push({ cls, id, counts: new Uint8Array(counts), symbols: new Uint8Array(d.subarray(p + 17, p + 17 + total)) });
    p += 17 + total;
  }
  return out;
}

/** Scan header: { components: [{ id, td, ta }], ss, se, ah, al }. */
export function parseSOS(d) {
  const n = d[0];
  const components = [];
  for (let i = 0; i < n; i++) components.push({ id: d[1 + i * 2], td: d[2 + i * 2] >> 4, ta: d[2 + i * 2] & 15 });
  const p = 1 + n * 2;
  return { components, ss: d[p], se: d[p + 1], ah: d[p + 2] >> 4, al: d[p + 2] & 15 };
}

const ascii = (d, a, b) => String.fromCharCode.apply(null, d.subarray(a, b));
const startsWith = (d, s) => d.length >= s.length && ascii(d, 0, s.length) === s;

/** Identifies an APPn payload: { type, ... } (JFIF, JFXX, EXIF, XMP, ICC, Adobe, Photoshop, MPF, unknown). */
export function parseAPP(marker, d) {
  const n = marker - 0xe0;
  if (n === 0 && startsWith(d, 'JFIF\0') && d.length >= 14) {
    return { type: 'JFIF', version: d[5] + '.' + String(d[6]).padStart(2, '0'), units: ['none', 'dpi', 'dpcm'][d[7]] || 'none', xDensity: (d[8] << 8) | d[9], yDensity: (d[10] << 8) | d[11], thumbnail: d[12] * d[13] > 0 };
  }
  if (n === 0 && startsWith(d, 'JFXX\0')) return { type: 'JFXX' };
  if (n === 1 && startsWith(d, 'Exif\0')) return { type: 'EXIF', tiff: d.subarray(6) };
  if (n === 1 && startsWith(d, 'http://ns.adobe.com/xap/1.0/\0')) return { type: 'XMP', xml: new TextDecoder().decode(d.subarray(29)) };
  if (n === 1 && startsWith(d, 'http://ns.adobe.com/xmp/extension/\0')) return { type: 'XMP-extension' };
  if (n === 2 && startsWith(d, 'ICC_PROFILE\0') && d.length >= 14) return { type: 'ICC', seq: d[12], count: d[13], data: d.subarray(14) };
  if (n === 2 && startsWith(d, 'MPF\0')) return { type: 'MPF' };
  if (n === 13 && startsWith(d, 'Photoshop 3.0\0')) return { type: 'Photoshop' };
  if (n === 14 && startsWith(d, 'Adobe') && d.length >= 12) return { type: 'Adobe', version: (d[5] << 8) | d[6], flags0: (d[7] << 8) | d[8], flags1: (d[9] << 8) | d[10], transform: d[11] };
  return { type: 'unknown', id: ascii(d, 0, Math.min(d.length, 32)).replace(/\0[\s\S]*$/, '').replace(/[^\x20-\x7e]/g, '') };
}

/** ICC profile reassembled from APP2 chunks (null when absent). */
// ICC profiles larger than one segment (64 KB) are split into numbered APP2 chunks (seq of count); sorted by seq
// because writers are not obliged to emit them in order.
export function iccProfile(segments) {
  const parts = segments.filter((s) => s.marker === 0xe2).map((s) => parseAPP(0xe2, s.data)).filter((a) => a.type === 'ICC').sort((a, b) => a.seq - b.seq);
  if (!parts.length) return null;
  const out = new Uint8Array(parts.reduce((a, p) => a + p.data.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p.data, o); o += p.data.length; }
  return out;
}

// IJG standard tables (natural order), used to estimate the quality of a file's quantization.
export const STD_LUMA = new Uint8Array([16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99]);
export const STD_CHROMA = new Uint8Array([17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99]);

/** Estimated IJG quality (1-100) of a luminance table: inverse of the IJG scaling formula. */
// IJG scales the standard table by S = q < 50 ? 5000 / q : 200 - 2q (percent); averaging table / standard recovers S
// and inverts it. Exact for files written by libjpeg-based encoders, an approximation for custom tables (Photoshop,
// phone ISPs), which is why it is called an estimate.
export function estimateQuality(table) {
  let sum = 0;
  for (let i = 0; i < 64; i++) sum += (table[i] * 100) / STD_LUMA[i];
  const scale = sum / 64;
  const q = scale <= 100 ? (200 - scale) / 2 : 5000 / scale;
  return Math.max(1, Math.min(100, Math.round(q)));
}

function subsamplingName(comps) {
  if (comps.length < 3) return comps.length === 1 ? 'gray' : comps.map((c) => c.h + 'x' + c.v).join(' ');
  const [y, cb, cr] = comps;
  if (cb.h !== cr.h || cb.v !== cr.v) return comps.map((c) => c.h + 'x' + c.v).join(' ');
  const hr = y.h / cb.h, vr = y.v / cb.v;
  if (hr === 1 && vr === 1) return '4:4:4';
  if (hr === 2 && vr === 1) return '4:2:2';
  if (hr === 2 && vr === 2) return '4:2:0';
  if (hr === 1 && vr === 2) return '4:4:0';
  if (hr === 4 && vr === 1) return '4:1:1';
  return comps.map((c) => c.h + 'x' + c.v).join(' ');
}

/**
 * Summary of a JPEG file: { width, height, precision, components, colorSpace, subsampling, process, progressive,
 * arithmetic, scans, quality, restartInterval, jfif, adobe, exif (TIFF bytes or null), xmp, icc (bytes or null),
 * comments, segments: [{ name, offset, length, type }] }.
 */
export function jpegInfo(bytes) {
  const segs = readSegments(bytes);
  const info = {
    width: 0, height: 0, precision: 8, components: 0, colorSpace: '', subsampling: '', process: '', progressive: false, arithmetic: false,
    scans: 0, quality: null, restartInterval: 0, jfif: null, adobe: null, exif: null, xmp: null, icc: null, comments: [], segments: [],
  };
  let sof = null;
  const qt = {};
  for (const s of segs) {
    const entry = { name: s.name, offset: s.offset, length: s.length };
    if (isSOF(s.marker) && !sof) sof = parseSOF(s.data, s.marker);
    else if (s.marker === 0xdb) for (const t of parseDQT(s.data)) qt[t.id] = t.table;
    else if (s.marker === 0xdd && s.data.length >= 2) info.restartInterval = (s.data[0] << 8) | s.data[1];
    else if (s.marker === 0xda) info.scans++;
    else if (s.marker === 0xfe) info.comments.push(new TextDecoder().decode(s.data));
    else if (s.marker >= 0xe0 && s.marker <= 0xef) {
      const a = parseAPP(s.marker, s.data);
      entry.type = a.type;
      if (a.type === 'JFIF' && !info.jfif) info.jfif = a;
      else if (a.type === 'Adobe') info.adobe = a;
      else if (a.type === 'EXIF' && !info.exif) info.exif = a.tiff;
      else if (a.type === 'XMP' && !info.xmp) info.xmp = a.xml;
    }
    info.segments.push(entry);
  }
  info.icc = iccProfile(segs);
  // Colour space inference follows libjpeg: the Adobe transform flag wins (0 = no transform: RGB / CMYK, 2 = YCCK);
  // without it, component ids 'R','G','B' (82,71,66) mean RGB, otherwise three components are YCbCr (JFIF).
  if (sof) {
    Object.assign(info, { width: sof.width, height: sof.height, precision: sof.precision, components: sof.components.length, process: sof.process, progressive: sof.progressive, arithmetic: sof.arithmetic });
    info.subsampling = subsamplingName(sof.components);
    const nc = sof.components.length;
    const ids = sof.components.map((c) => c.id);
    const t = info.adobe ? info.adobe.transform : -1;
    info.colorSpace = nc === 1 ? 'gray' : nc === 3 ? (t === 0 || (t < 0 && ids.join() === '82,71,66') ? 'RGB' : 'YCbCr') : nc === 4 ? (t === 2 ? 'YCCK' : 'CMYK') : 'unknown';
    const lt = qt[sof.components[0].tq];
    if (lt) info.quality = estimateQuality(lt);
  }
  return info;
}
