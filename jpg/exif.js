// jpg/exif.js - EXIF / TIFF metadata: IFD0, EXIF, GPS, interoperability and IFD1 (thumbnail) directories with tag
// names, a human summary (camera, lens, exposure, dates, orientation, GPS as decimal degrees), orientation helpers
// and a minimal TIFF writer (e.g. an EXIF block that only keeps the orientation).
//
//   readTiff(tiffBytes) -> { littleEndian, ifd0, exif, gps, interop, ifd1, thumbnail }   (tag name -> value)
//   readExif(jpegBytes) -> the same for the APP1 "Exif" segment of a JPEG, or null
//   exifSummary(tiff) -> { make, model, lens, dateTime, orientation, exposureTime, fNumber, iso, focalLength, gps, ... }
//   exifEntries(tiff) -> [{ group, tag, name, value }]   display strings (MakerNote and binary blobs abbreviated)
//   buildTiff({ Orientation: 6, Software: '…', ... }) -> Uint8Array (big-endian TIFF with one IFD0)
//   exifSegmentPayload(tiff) -> 'Exif\0\0' + tiff (APP1 payload)
//   jpegOrientation(jpegBytes) -> 1..8   setJpegOrientation(jpegBytes, value) -> Uint8Array | null (patched copy)
//   trimExif(tiff, { orientation, thumbnail = false }) -> TIFF copy for re-encoded pixels (orientation reset, no thumbnail)
//   ORIENTATIONS[o] -> { rotate: 0 | 90 | 180 | 270, flip: boolean } (to display upright: rotate the stored pixels
//                      clockwise, then mirror horizontally when `flip`)

import { readSegments } from './segments.js';

export const TAGS = {
  ifd0: {
    0x0100: 'ImageWidth', 0x0101: 'ImageLength', 0x0102: 'BitsPerSample', 0x0103: 'Compression', 0x0106: 'PhotometricInterpretation',
    0x010e: 'ImageDescription', 0x010f: 'Make', 0x0110: 'Model', 0x0111: 'StripOffsets', 0x0112: 'Orientation', 0x0115: 'SamplesPerPixel',
    0x0116: 'RowsPerStrip', 0x0117: 'StripByteCounts', 0x011a: 'XResolution', 0x011b: 'YResolution', 0x011c: 'PlanarConfiguration',
    0x0128: 'ResolutionUnit', 0x012d: 'TransferFunction', 0x0131: 'Software', 0x0132: 'DateTime', 0x013b: 'Artist', 0x013e: 'WhitePoint',
    0x013f: 'PrimaryChromaticities', 0x0201: 'JPEGInterchangeFormat', 0x0202: 'JPEGInterchangeFormatLength', 0x0211: 'YCbCrCoefficients',
    0x0212: 'YCbCrSubSampling', 0x0213: 'YCbCrPositioning', 0x0214: 'ReferenceBlackWhite', 0x02bc: 'XMLPacket', 0x4746: 'Rating', 0x4749: 'RatingPercent',
    0x8298: 'Copyright', 0x83bb: 'IPTC-NAA', 0x8769: 'ExifIFDPointer', 0x8773: 'InterColorProfile', 0x8825: 'GPSInfoIFDPointer', 0xa005: 'InteroperabilityIFDPointer',
    0x9c9b: 'XPTitle', 0x9c9c: 'XPComment', 0x9c9d: 'XPAuthor', 0x9c9e: 'XPKeywords', 0x9c9f: 'XPSubject', 0xc4a5: 'PrintImageMatching',
  },
  exif: {
    0x829a: 'ExposureTime', 0x829d: 'FNumber', 0x8822: 'ExposureProgram', 0x8824: 'SpectralSensitivity', 0x8827: 'ISOSpeedRatings', 0x8828: 'OECF',
    0x8830: 'SensitivityType', 0x8832: 'RecommendedExposureIndex', 0x9000: 'ExifVersion', 0x9003: 'DateTimeOriginal', 0x9004: 'DateTimeDigitized',
    0x9010: 'OffsetTime', 0x9011: 'OffsetTimeOriginal', 0x9012: 'OffsetTimeDigitized', 0x9101: 'ComponentsConfiguration',
    0x9102: 'CompressedBitsPerPixel', 0x9201: 'ShutterSpeedValue', 0x9202: 'ApertureValue', 0x9203: 'BrightnessValue', 0x9204: 'ExposureBiasValue',
    0x9205: 'MaxApertureValue', 0x9206: 'SubjectDistance', 0x9207: 'MeteringMode', 0x9208: 'LightSource', 0x9209: 'Flash', 0x920a: 'FocalLength',
    0x9214: 'SubjectArea', 0x927c: 'MakerNote', 0x9286: 'UserComment', 0x9290: 'SubSecTime', 0x9291: 'SubSecTimeOriginal', 0x9292: 'SubSecTimeDigitized',
    0xa000: 'FlashpixVersion', 0xa001: 'ColorSpace', 0xa002: 'PixelXDimension', 0xa003: 'PixelYDimension', 0xa004: 'RelatedSoundFile',
    0xa005: 'InteroperabilityIFDPointer', 0xa20b: 'FlashEnergy', 0xa20e: 'FocalPlaneXResolution', 0xa20f: 'FocalPlaneYResolution',
    0xa210: 'FocalPlaneResolutionUnit', 0xa214: 'SubjectLocation', 0xa215: 'ExposureIndex', 0xa217: 'SensingMethod', 0xa300: 'FileSource',
    0xa301: 'SceneType', 0xa302: 'CFAPattern', 0xa401: 'CustomRendered', 0xa402: 'ExposureMode', 0xa403: 'WhiteBalance', 0xa404: 'DigitalZoomRatio',
    0xa405: 'FocalLengthIn35mmFilm', 0xa406: 'SceneCaptureType', 0xa407: 'GainControl', 0xa408: 'Contrast', 0xa409: 'Saturation', 0xa40a: 'Sharpness',
    0xa40c: 'SubjectDistanceRange', 0xa420: 'ImageUniqueID', 0xa430: 'CameraOwnerName', 0xa431: 'BodySerialNumber', 0xa432: 'LensSpecification',
    0xa433: 'LensMake', 0xa434: 'LensModel', 0xa435: 'LensSerialNumber', 0xa460: 'CompositeImage', 0xa500: 'Gamma',
  },
  gps: {
    0x00: 'GPSVersionID', 0x01: 'GPSLatitudeRef', 0x02: 'GPSLatitude', 0x03: 'GPSLongitudeRef', 0x04: 'GPSLongitude', 0x05: 'GPSAltitudeRef',
    0x06: 'GPSAltitude', 0x07: 'GPSTimeStamp', 0x08: 'GPSSatellites', 0x09: 'GPSStatus', 0x0a: 'GPSMeasureMode', 0x0b: 'GPSDOP', 0x0c: 'GPSSpeedRef',
    0x0d: 'GPSSpeed', 0x0e: 'GPSTrackRef', 0x0f: 'GPSTrack', 0x10: 'GPSImgDirectionRef', 0x11: 'GPSImgDirection', 0x12: 'GPSMapDatum',
    0x13: 'GPSDestLatitudeRef', 0x14: 'GPSDestLatitude', 0x15: 'GPSDestLongitudeRef', 0x16: 'GPSDestLongitude', 0x17: 'GPSDestBearingRef',
    0x18: 'GPSDestBearing', 0x19: 'GPSDestDistanceRef', 0x1a: 'GPSDestDistance', 0x1b: 'GPSProcessingMethod', 0x1c: 'GPSAreaInformation',
    0x1d: 'GPSDateStamp', 0x1e: 'GPSDifferential', 0x1f: 'GPSHPositioningError',
  },
  interop: { 0x01: 'InteroperabilityIndex', 0x02: 'InteroperabilityVersion', 0x1000: 'RelatedImageFileFormat', 0x1001: 'RelatedImageWidth', 0x1002: 'RelatedImageLength' },
};
TAGS.ifd1 = TAGS.ifd0;

// Byte size per TIFF field type (index = type): BYTE ASCII SHORT LONG RATIONAL SBYTE UNDEFINED SSHORT SLONG
// SRATIONAL FLOAT DOUBLE IFD. A value of <= 4 bytes is stored inline in the entry, larger ones at an offset.
const SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
const POINTERS = { 0x8769: 'exif', 0x8825: 'gps', 0xa005: 'interop' };

/** Parses a TIFF structure (the payload of an EXIF block after "Exif\0\0"). Never throws on bad offsets. */
// EXIF is attacker-controlled binary data (uploaded photos), so every offset is bounds-checked, IFD offsets are
// remembered in "seen" to break pointer cycles, and counts are capped (1000 entries, 4096 array items, 1e7 bytes).
// ASCII values are tried as UTF-8 (decodeURIComponent(escape(s)) reinterprets the byte string), since cameras and
// editors often write UTF-8 into fields the spec calls ASCII.
export function readTiff(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length < 8) throw new Error('TIFF: too short');
  const le = b[0] === 0x49 && b[1] === 0x49;
  if (!le && !(b[0] === 0x4d && b[1] === 0x4d)) throw new Error('TIFF: bad byte order');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (p) => dv.getUint16(p, le), u32 = (p) => dv.getUint32(p, le);
  if (u16(2) !== 42) throw new Error('TIFF: bad magic');
  const out = { littleEndian: le, ifd0: {}, exif: {}, gps: {}, interop: {}, ifd1: {}, thumbnail: null, tags: { ifd0: {}, exif: {}, gps: {}, interop: {}, ifd1: {} } };
  const seen = new Set();
  const value = (type, count, p) => {
    const sz = SIZES[type] || 1;
    if (p < 0 || p + sz * count > b.length) return undefined;
    if (type === 2) { let s = ''; for (let i = 0; i < count; i++) { const c = b[p + i]; if (!c) break; s += String.fromCharCode(c); } try { s = decodeURIComponent(escape(s)); } catch { /* not UTF-8 */ } return s.trim(); }
    if (type === 7 || (type === 1 && count > 8)) return b.slice(p, p + count);
    const arr = [];
    for (let i = 0; i < Math.min(count, 4096); i++) {
      const q = p + i * sz;
      switch (type) {
        case 1: arr.push(b[q]); break;
        case 3: arr.push(u16(q)); break;
        case 4: case 13: arr.push(u32(q)); break;
        case 5: { const d = u32(q + 4); arr.push(d ? u32(q) / d : 0); break; }
        case 6: arr.push(dv.getInt8(q)); break;
        case 8: arr.push(dv.getInt16(q, le)); break;
        case 9: arr.push(dv.getInt32(q, le)); break;
        case 10: { const d = dv.getInt32(q + 4, le); arr.push(d ? dv.getInt32(q, le) / d : 0); break; }
        case 11: arr.push(dv.getFloat32(q, le)); break;
        case 12: arr.push(dv.getFloat64(q, le)); break;
        default: arr.push(b[q]);
      }
    }
    return count === 1 ? arr[0] : arr;
  };
  const readIFD = (off, group) => {
    if (!off || off + 2 > b.length || seen.has(off)) return 0;
    seen.add(off);
    const n = u16(off);
    if (off + 2 + n * 12 > b.length || n > 1000) return 0;
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      if (!SIZES[type] || count > 1e7) continue;
      const size = SIZES[type] * count;
      const p = size <= 4 ? e + 8 : u32(e + 8);
      const name = TAGS[group][tag] || '0x' + tag.toString(16).padStart(4, '0');
      if (POINTERS[tag] && group !== 'gps') { readIFD(value(type === 13 ? 4 : type, 1, p), POINTERS[tag]); continue; }
      if (tag === 0x927c) { out[group][name] = { bytes: count }; continue; } // MakerNote: proprietary, size only
      const v = value(type, count, p);
      if (v === undefined) continue;
      out[group][name] = v;
      out.tags[group][tag] = { type, count, offset: p };
    }
    return off + 2 + n * 12 + 4 <= b.length ? u32(off + 2 + n * 12) : 0;
  };
  const next = readIFD(u32(4), 'ifd0');
  if (next) readIFD(next, 'ifd1');
  const t = out.ifd1;
  if (t.JPEGInterchangeFormat && t.JPEGInterchangeFormatLength && t.JPEGInterchangeFormat + t.JPEGInterchangeFormatLength <= b.length) {
    out.thumbnail = b.slice(t.JPEGInterchangeFormat, t.JPEGInterchangeFormat + t.JPEGInterchangeFormatLength);
  }
  return out;
}

/** EXIF of a JPEG (first APP1 "Exif" segment), or null. */
export function readExif(jpeg) {
  const seg = exifSegment(jpeg);
  if (!seg) return null;
  try { return readTiff(seg.data.subarray(6)); } catch { return null; }
}

function exifSegment(jpeg) {
  for (const s of readSegments(jpeg)) {
    if (s.marker === 0xda) break;
    if (s.marker === 0xe1 && s.data.length > 14 && s.data[0] === 0x45 && s.data[1] === 0x78 && s.data[2] === 0x69 && s.data[3] === 0x66 && s.data[4] === 0 && s.data[5] === 0) return s;
  }
  return null;
}

// --- summary --------------------------------------------------------------------------------------------

export const ORIENTATIONS = {
  1: { rotate: 0, flip: false }, 2: { rotate: 0, flip: true }, 3: { rotate: 180, flip: false }, 4: { rotate: 180, flip: true },
  5: { rotate: 90, flip: true }, 6: { rotate: 90, flip: false }, 7: { rotate: 270, flip: true }, 8: { rotate: 270, flip: false },
};

const EXPOSURE_PROGRAMS = ['Not defined', 'Manual', 'Normal program', 'Aperture priority', 'Shutter priority', 'Creative program', 'Action program', 'Portrait mode', 'Landscape mode'];
const METERING = { 0: 'Unknown', 1: 'Average', 2: 'Center-weighted average', 3: 'Spot', 4: 'Multi-spot', 5: 'Pattern', 6: 'Partial', 255: 'Other' };
const LIGHT = { 0: 'Unknown', 1: 'Daylight', 2: 'Fluorescent', 3: 'Tungsten', 4: 'Flash', 9: 'Fine weather', 10: 'Cloudy', 11: 'Shade', 17: 'Standard light A', 18: 'Standard light B', 19: 'Standard light C', 20: 'D55', 21: 'D65', 22: 'D75', 23: 'D50', 24: 'ISO studio tungsten', 255: 'Other' };

// "2024:05:06 07:08:09" (+ subseconds, offset) -> ISO 8601, or the input when unparseable.
export function exifDate(s, sub, offset) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return s || null;
  let iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  if (sub && /^\d+$/.test(String(sub).trim())) iso += '.' + String(sub).trim().slice(0, 3).padEnd(3, '0');
  if (offset && /^[+-]\d{2}:\d{2}$/.test(offset)) iso += offset;
  return iso;
}

const dms = (v) => (Array.isArray(v) ? v[0] + (v[1] || 0) / 60 + (v[2] || 0) / 3600 : typeof v === 'number' ? v : NaN);
const round = (v, n = 6) => Math.round(v * 10 ** n) / 10 ** n;

/** Decimal GPS position { lat, lon, alt?, time?, direction?, speed? } or null. */
export function gpsDecimal(gps) {
  if (!gps || gps.GPSLatitude == null || gps.GPSLongitude == null) return null;
  let lat = dms(gps.GPSLatitude), lon = dms(gps.GPSLongitude);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (/^S/i.test(gps.GPSLatitudeRef || '')) lat = -lat;
  if (/^W/i.test(gps.GPSLongitudeRef || '')) lon = -lon;
  const out = { lat: round(lat), lon: round(lon) };
  if (typeof gps.GPSAltitude === 'number') out.alt = round(gps.GPSAltitudeRef === 1 ? -gps.GPSAltitude : gps.GPSAltitude, 2);
  if (gps.GPSDateStamp && Array.isArray(gps.GPSTimeStamp)) {
    const [h, mi, s] = gps.GPSTimeStamp;
    out.time = exifDate(`${gps.GPSDateStamp} ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}`) + 'Z';
  }
  if (typeof gps.GPSImgDirection === 'number') out.direction = round(gps.GPSImgDirection, 2);
  if (typeof gps.GPSSpeed === 'number') out.speed = round(gps.GPSSpeed, 2);
  return out;
}

const fmtExposure = (v) => (typeof v !== 'number' || !v ? null : v >= 1 ? `${round(v, 1)} s` : `1/${Math.round(1 / v)} s`);
const asText = (v) => (v instanceof Uint8Array ? null : v == null ? null : Array.isArray(v) ? v.join(' ') : String(v));

// UTF-16LE XP* tags (Windows) and UserComment (8-byte character code prefix).
function xpString(v) {
  if (!(v instanceof Uint8Array) && !Array.isArray(v)) return asText(v);
  const a = Uint8Array.from(v);
  let s = '';
  for (let i = 0; i + 1 < a.length; i += 2) { const c = a[i] | (a[i + 1] << 8); if (!c) break; s += String.fromCharCode(c); }
  return s || null;
}
function userComment(v) {
  if (!(v instanceof Uint8Array) || v.length < 8) return asText(v);
  const code = String.fromCharCode(...v.subarray(0, 8)).replace(/\0+$/, '');
  const body = v.subarray(8);
  let s;
  if (code === 'UNICODE') { s = ''; for (let i = 0; i + 1 < body.length; i += 2) s += String.fromCharCode(body[i] << 8 | body[i + 1]); } else s = new TextDecoder().decode(body);
  s = s.replace(/\0+$/, '').trim();
  return s || null;
}

/** Human summary of parsed EXIF (null fields are absent from the file). */
export function exifSummary(t) {
  if (!t) return null;
  const i0 = t.ifd0, ex = t.exif;
  const o = i0.Orientation;
  const flash = typeof ex.Flash === 'number' ? { fired: !!(ex.Flash & 1), value: ex.Flash } : null;
  return {
    make: asText(i0.Make), model: asText(i0.Model), software: asText(i0.Software), artist: asText(i0.Artist) || xpString(i0.XPAuthor),
    copyright: asText(i0.Copyright), description: asText(i0.ImageDescription) || xpString(i0.XPTitle) || userComment(ex.UserComment),
    lens: asText(ex.LensModel) || null, lensMake: asText(ex.LensMake), serial: asText(ex.BodySerialNumber),
    dateTime: exifDate(ex.DateTimeOriginal || ex.DateTimeDigitized || i0.DateTime, ex.SubSecTimeOriginal, ex.OffsetTimeOriginal || ex.OffsetTime),
    modified: exifDate(i0.DateTime, ex.SubSecTime, ex.OffsetTime),
    orientation: o >= 1 && o <= 8 ? o : 1,
    exposureTime: fmtExposure(ex.ExposureTime), fNumber: typeof ex.FNumber === 'number' && ex.FNumber ? `f/${round(ex.FNumber, 1)}` : null,
    iso: Array.isArray(ex.ISOSpeedRatings) ? ex.ISOSpeedRatings[0] : ex.ISOSpeedRatings ?? null,
    focalLength: typeof ex.FocalLength === 'number' && ex.FocalLength ? `${round(ex.FocalLength, 1)} mm` : null,
    focalLength35: ex.FocalLengthIn35mmFilm ? `${ex.FocalLengthIn35mmFilm} mm` : null,
    exposureBias: typeof ex.ExposureBiasValue === 'number' ? `${ex.ExposureBiasValue > 0 ? '+' : ''}${round(ex.ExposureBiasValue, 2)} EV` : null,
    exposureProgram: EXPOSURE_PROGRAMS[ex.ExposureProgram] || null, metering: METERING[ex.MeteringMode] || null, lightSource: LIGHT[ex.LightSource] || null,
    flash, whiteBalance: ex.WhiteBalance === 0 ? 'Auto' : ex.WhiteBalance === 1 ? 'Manual' : null,
    colorSpace: ex.ColorSpace === 1 ? 'sRGB' : ex.ColorSpace === 0xffff ? 'Uncalibrated' : null,
    width: ex.PixelXDimension || i0.ImageWidth || null, height: ex.PixelYDimension || i0.ImageLength || null,
    gps: gpsDecimal(t.gps), thumbnail: t.thumbnail ? t.thumbnail.length : 0,
  };
}

function display(v) {
  if (v == null) return '';
  if (v instanceof Uint8Array) {
    const printable = v.length && v.length <= 64 && Array.from(v).every((c) => c === 0 || (c >= 32 && c < 127));
    return printable ? String.fromCharCode(...v).replace(/\0+$/, '') : `(${v.length} bytes)`;
  }
  if (typeof v === 'object' && !Array.isArray(v)) return v.bytes != null ? `(${v.bytes} bytes)` : JSON.stringify(v);
  if (Array.isArray(v)) return v.length > 16 ? `${v.slice(0, 16).map((x) => round(x, 4)).join(' ')} …` : v.map((x) => round(x, 4)).join(' ');
  if (typeof v === 'number') return String(round(v, 6));
  return String(v);
}

/** Every tag as display strings: [{ group, tag, name, value }]. */
export function exifEntries(t) {
  if (!t) return [];
  const out = [];
  for (const group of ['ifd0', 'exif', 'gps', 'interop', 'ifd1']) {
    for (const [name, v] of Object.entries(t[group] || {})) {
      let value = display(v);
      if (/^XP/.test(name)) value = xpString(v) || value;
      if (name === 'UserComment') value = userComment(v) || value;
      out.push({ group, name, value });
    }
  }
  return out;
}

// --- writing ------------------------------------------------------------------------------------------

const NAME_TO_TAG = Object.fromEntries(Object.entries(TAGS.ifd0).map(([k, v]) => [v, +k]));
const SHORT_TAGS = new Set(['Orientation', 'ResolutionUnit', 'YCbCrPositioning']);
const RATIONAL_TAGS = new Set(['XResolution', 'YResolution']);

/**
 * Minimal big-endian TIFF with one IFD0: numbers go out as SHORT (Orientation, ResolutionUnit, ...) or RATIONAL
 * (X/YResolution), strings as ASCII. Unknown names are ignored.
 */
export function buildTiff(fields) {
  const entries = Object.entries(fields || {}).filter(([k, v]) => NAME_TO_TAG[k] != null && v != null && v !== '').map(([k, v]) => [NAME_TO_TAG[k], k, v]).sort((a, b) => a[0] - b[0]);
  const n = entries.length;
  const ifdSize = 2 + n * 12 + 4;
  const blobs = [];
  let dataOff = 8 + ifdSize;
  const ifd = new Uint8Array(ifdSize);
  const dv = new DataView(ifd.buffer);
  dv.setUint16(0, n);
  entries.forEach(([tag, name, v], i) => {
    const e = 2 + i * 12;
    dv.setUint16(e, tag);
    if (SHORT_TAGS.has(name)) { dv.setUint16(e + 2, 3); dv.setUint32(e + 4, 1); dv.setUint16(e + 8, Number(v) & 0xffff); return; }
    if (RATIONAL_TAGS.has(name)) {
      dv.setUint16(e + 2, 5); dv.setUint32(e + 4, 1); dv.setUint32(e + 8, dataOff);
      const r = new Uint8Array(8); const rv = new DataView(r.buffer); rv.setUint32(0, Math.round(Number(v) * 100)); rv.setUint32(4, 100);
      blobs.push(r); dataOff += 8;
      return;
    }
    const s = new TextEncoder().encode(String(v) + '\0');
    dv.setUint16(e + 2, 2); dv.setUint32(e + 4, s.length);
    if (s.length <= 4) ifd.set(s, e + 8);
    else { dv.setUint32(e + 8, dataOff); const padded = new Uint8Array(s.length + (s.length & 1)); padded.set(s); blobs.push(padded); dataOff += padded.length; }
  });
  dv.setUint32(2 + n * 12, 0);
  const out = new Uint8Array(dataOff);
  out.set([0x4d, 0x4d, 0, 42, 0, 0, 0, 8]);
  out.set(ifd, 8);
  let o = 8 + ifdSize;
  for (const bl of blobs) { out.set(bl, o); o += bl.length; }
  return out;
}

/** APP1 payload for a TIFF block. */
export function exifSegmentPayload(tiff) {
  const out = new Uint8Array(6 + tiff.length);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
  out.set(tiff, 6);
  return out;
}

/**
 * Copy of a TIFF block for re-encoded pixels: the Orientation tag is set to `orientation` (when present) and the IFD1
 * thumbnail is unlinked and, when it ends the block, cut off (a stale thumbnail would show the unedited picture).
 */
export function trimExif(tiff, { orientation = null, thumbnail = false } = {}) {
  let t;
  try { t = readTiff(tiff); } catch { return null; }
  let out = new Uint8Array(tiff);
  const le = t.littleEndian;
  const dv = new DataView(out.buffer);
  if (orientation != null) {
    const info = t.tags.ifd0[0x0112];
    if (info && info.type === 3) dv.setUint16(info.offset, orientation, le);
  }
  if (!thumbnail) {
    const ifd0 = dv.getUint32(4, le);
    if (ifd0 + 2 <= out.length) {
      const n = dv.getUint16(ifd0, le), next = ifd0 + 2 + n * 12;
      if (next + 4 <= out.length && dv.getUint32(next, le)) {
        dv.setUint32(next, 0, le);
        const i1 = t.ifd1;
        if (i1.JPEGInterchangeFormat && i1.JPEGInterchangeFormat + i1.JPEGInterchangeFormatLength >= out.length - 1) out = out.slice(0, i1.JPEGInterchangeFormat);
      }
    }
  }
  return out;
}

/** EXIF orientation of a JPEG (1 when absent or invalid). */
export function jpegOrientation(jpeg) {
  try {
    const t = readExif(jpeg);
    const o = t && t.ifd0.Orientation;
    return o >= 1 && o <= 8 ? o : 1;
  } catch { return 1; }
}

/** Copy of the JPEG with its EXIF Orientation tag set to `value`; null when the file has no such tag. */
// Patches the 2 bytes of the existing SHORT in a copy (no re-serialisation of the TIFF): offsets of every other tag,
// MakerNote included, stay valid. MakerNotes often contain absolute offsets, so rewriting the block would break them.
export function setJpegOrientation(jpeg, value) {
  const seg = exifSegment(jpeg);
  if (!seg) return null;
  let t;
  try { t = readTiff(seg.data.subarray(6)); } catch { return null; }
  const info = t.tags.ifd0[0x0112];
  if (!info || info.type !== 3) return null;
  const out = new Uint8Array(jpeg);
  const p = seg.offset + 4 + 6 + info.offset;
  if (t.littleEndian) { out[p] = value & 255; out[p + 1] = value >> 8; } else { out[p] = value >> 8; out[p + 1] = value & 255; }
  return out;
}
