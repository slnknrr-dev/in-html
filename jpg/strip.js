// jpg/strip.js - JPEG metadata removal without re-encoding: drops EXIF / XMP (APP1), Photoshop / IPTC (APP13), other
// APPn blocks and comments; keeps the image (frame, tables, scans), Adobe APP14 (it defines the colour transform) and,
// on request, JFIF, the ICC profile and the EXIF orientation (rewritten as a minimal EXIF block).
//
//   stripJpegMetadata(bytes, { keepOrientation = false, keepICC = true, keepJFIF = true, keepComments = false })
//     -> Uint8Array
//   insertExif(bytes, tiff) -> Uint8Array   (replaces any EXIF block; placed after SOI / JFIF)

import { buildTiff, exifSegmentPayload, jpegOrientation } from './exif.js';
import { parseAPP, readSegments, writeSegments } from './segments.js';

// Lossless by construction: segments are copied byte for byte and the entropy-coded scans untouched, so pixels are
// identical (re-encoding would lose quality and change the file's fingerprint). Privacy rationale: EXIF holds GPS,
// device serials and timestamps; XMP and IPTC hold names and edit history. Kept on purpose: Adobe APP14 (without
// it a CMYK / RGB file decodes with wrong colours) and ICC (without it wide-gamut photos look washed out).
export function stripJpegMetadata(bytes, { keepOrientation = false, keepICC = true, keepJFIF = true, keepComments = false } = {}) {
  const segs = readSegments(bytes);
  const orientation = keepOrientation ? jpegOrientation(bytes) : 1;
  const out = [];
  for (const s of segs) {
    const m = s.marker;
    if (m >= 0xe0 && m <= 0xef) {
      const a = parseAPP(m, s.data);
      if (a.type === 'Adobe' || (keepJFIF && a.type === 'JFIF') || (keepICC && a.type === 'ICC')) out.push(s);
      continue;
    }
    if (m === 0xfe && !keepComments) continue;
    out.push(s);
  }
  if (keepOrientation && orientation !== 1) return insertExif(writeSegments(out), buildTiff({ Orientation: orientation }));
  return writeSegments(out);
}

/** Puts an EXIF block (TIFF bytes) into a JPEG, replacing existing EXIF segments. */
// Position: right after SOI, or after JFIF when present (JFIF must be the first APP segment for strict readers).
// Throws (via segment()) when the TIFF block exceeds 65533 bytes: a single APP1 cannot hold more.
export function insertExif(bytes, tiff) {
  const segs = readSegments(bytes).filter((s) => !(s.marker === 0xe1 && parseAPP(0xe1, s.data).type === 'EXIF'));
  const at = segs.length > 1 && segs[1].marker === 0xe0 ? 2 : 1;
  segs.splice(at, 0, { marker: 0xe1, data: exifSegmentPayload(tiff) });
  return writeSegments(segs);
}
