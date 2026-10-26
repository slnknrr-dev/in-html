// kdbx/bytes.js - binary helpers of the KDBX format: little-endian reader / writer, UUIDs (16 bytes, base64 in the
// XML), KeePass timestamps (KDBX 4: base64 of int64 seconds since 0001-01-01 UTC; KDBX 3: ISO 8601) and the
// VariantDictionary (typed key-value map of KDF parameters and public custom data).
import { base64ToBytes, bytesToBase64, bytesToHex, readU32LE, readU64LE, utf8ToBytes, bytesToUtf8, writeU32LE, writeU64LE } from '../crypto/encoding.js';
import { randomBytes } from '../crypto/random.js';

// Cursor over a byte array. Every read is bounds-checked by need() so a truncated or hostile file throws a clean
// 'unexpected end of data' instead of reading undefined -> NaN / 0 silently. bytes(n) returns a subarray VIEW (no
// copy): cheap, but callers that keep the value past the buffer's lifetime must slice().
// i32() via `| 0`: reinterprets the unsigned 32-bit value as signed (two's complement).
export class Reader {
  constructor(bytes, pos = 0) { this.b = bytes; this.pos = pos; }
  need(n) { if (this.pos + n > this.b.length) throw new Error('unexpected end of data'); }
  u8() { this.need(1); return this.b[this.pos++]; }
  u16() { this.need(2); const v = this.b[this.pos] | (this.b[this.pos + 1] << 8); this.pos += 2; return v; }
  u32() { this.need(4); const v = readU32LE(this.b, this.pos); this.pos += 4; return v; }
  i32() { return this.u32() | 0; }
  u64() { this.need(8); const v = readU64LE(this.b, this.pos); this.pos += 8; return v; }
  bytes(n) { this.need(n); const v = this.b.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  get left() { return this.b.length - this.pos; }
}

// Append-only list of chunks, concatenated once in done(): O(n) total instead of re-allocating a growing buffer per
// write. Methods return `this` for chaining (w.u8(t).u32(n).bytes(b)).
export class Writer {
  constructor() { this.parts = []; this.length = 0; }
  push(b) { this.parts.push(b); this.length += b.length; return this; }
  u8(v) { return this.push(new Uint8Array([v])); }
  u16(v) { return this.push(new Uint8Array([v & 255, (v >>> 8) & 255])); }
  u32(v) { const b = new Uint8Array(4); writeU32LE(b, 0, v >>> 0); return this.push(b); }
  u64(v) { const b = new Uint8Array(8); writeU64LE(b, 0, v); return this.push(b); }
  bytes(b) { return this.push(b); }
  done() {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

// --- UUIDs (stored as base64 strings, the form of the XML) -----------------------------------------------------

// UUIDs travel as base64 strings because that is their XML form: entries, groups and references compare as plain
// strings (Map keys, ===) without re-encoding. ZERO_UUID (16 zero bytes) means "none" in KeePass (e.g. no recycle
// bin); isZeroUuid also treats empty/missing as none. New UUIDs are 16 random bytes (not RFC 4122 v4 - KeePass does
// not set version bits either).
export const ZERO_UUID = 'AAAAAAAAAAAAAAAAAAAAAA==';
export const newUuid = () => bytesToBase64(randomBytes(16));
export const uuidBytes = (u) => base64ToBytes(u);
export const isZeroUuid = (u) => !u || u === ZERO_UUID;
// The 32 upper-case hex digits of a (base64) UUID, as KeePass writes it in field references ({REF:P@I:<hex>}).
export const uuidHex = (u) => bytesToHex(base64ToBytes(u)).toUpperCase();
export const uuidFromHex = (hex) => bytesToBase64(Uint8Array.from(String(hex).match(/[0-9a-f]{2}/gi) || [], (x) => parseInt(x, 16)));
// 31c1f2e6-bf71-4350-be58-05216afc5aff style (header ids).
export function uuidString(b) {
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// --- time ---------------------------------------------------------------------------------------------------

const EPOCH_DIFF = 62135596800; // seconds between 0001-01-01 and 1970-01-01

// Accepts both encodings regardless of file version (files written by other tools mix them): an ISO date prefix ->
// Date parser, otherwise base64 of an 8-byte LE count of seconds since 0001-01-01. Unparseable -> null, never throws:
// one bad timestamp must not make a whole database unreadable.
export function timeFromXml(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d\d-\d\d/.test(s)) { const d = new Date(s); return isNaN(d) ? null : d; }
  try {
    const b = base64ToBytes(s);
    if (b.length !== 8) return null;
    return new Date((readU64LE(b, 0) - EPOCH_DIFF) * 1000);
  } catch { return null; }
}

// v4: binary form (KDBX 4 writes it); otherwise ISO 8601 without milliseconds, as KeePass 2.x writes KDBX 3.
// Invalid dates fall back to "now" rather than writing garbage; pre-0001 dates clamp to 0 (unsigned field).
export function timeToXml(date, v4) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date();
  if (!v4) return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const b = new Uint8Array(8);
  writeU64LE(b, 0, Math.max(0, Math.floor(d.getTime() / 1000) + EPOCH_DIFF));
  return bytesToBase64(b);
}

// Whole seconds (the file stores no fractions).
export const now = () => new Date(Math.floor(Date.now() / 1000) * 1000);

// --- VariantDictionary ---------------------------------------------------------------------------------------

// Type tags of the KeePass VariantDictionary (KDBX 4 header field 11 KdfParameters and 12 PublicCustomData).
// Format: u16 version, then records [u8 type, i32 nameLen, name, i32 valueLen, value] until type 0.
export const VD = { UInt32: 0x04, UInt64: 0x05, Bool: 0x08, Int32: 0x0c, Int64: 0x0d, String: 0x18, Bytes: 0x42 };

// -> Map(name -> { type, value }) (numbers as Number, Int64 / UInt64 exact up to 2^53).
export function readVariantDictionary(bytes) {
  const r = new Reader(bytes);
  // Only the high (critical) byte of the version is checked, as in KeePass: a minor bump is compatible by contract.
  const version = r.u16();
  if ((version & 0xff00) > 0x0100) throw new Error('unsupported VariantDictionary version');
  const map = new Map();
  for (;;) {
    const type = r.u8();
    if (type === 0) break;
    const name = bytesToUtf8(r.bytes(r.i32()));
    const data = r.bytes(r.i32());
    const d = new Reader(data);
    let value;
    switch (type) {
      case VD.UInt32: value = d.u32(); break;
      case VD.Int32: value = d.i32(); break;
      case VD.UInt64: value = d.u64(); break;
      case VD.Int64: { const lo = d.u32(), hi = d.i32(); value = hi * 0x100000000 + lo; break; }
      case VD.Bool: value = data[0] !== 0; break;
      case VD.String: value = bytesToUtf8(data); break;
      case VD.Bytes: value = data.slice(); break;
      // Unknown types are preserved as raw bytes with their tag, so a re-save round-trips data from newer clients.
      default: value = data.slice();
    }
    map.set(name, { type, value });
  }
  return map;
}

// Inverse of readVariantDictionary; Map iteration order = insertion order, so field order is stable across saves.
// Int64 goes through writeU64LE like UInt64; whether a negative value is written as two's complement depends on
// writeU64LE (crypto/encoding.js). KDF parameters in practice are all non-negative.
export function writeVariantDictionary(map) {
  const w = new Writer().u16(0x0100);
  for (const [name, { type, value }] of map) {
    let data;
    switch (type) {
      case VD.UInt32: case VD.Int32: data = new Uint8Array(4); writeU32LE(data, 0, value >>> 0); break;
      case VD.UInt64: case VD.Int64: data = new Uint8Array(8); writeU64LE(data, 0, value); break;
      case VD.Bool: data = new Uint8Array([value ? 1 : 0]); break;
      case VD.String: data = utf8ToBytes(value); break;
      default: data = value;
    }
    const nm = utf8ToBytes(name);
    w.u8(type).u32(nm.length).bytes(nm).u32(data.length).bytes(data);
  }
  return w.u8(0).done();
}
