// util/value.js - small coercion and lookup helpers (no dependencies).
//
// Shared contract: helpers coerce untrusted values (parsed JSON, URL params, localStorage) into the expected type or
// return the caller's default. They never throw, so a corrupt saved state degrades to defaults instead of a crash.

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Registry / data-keyed lookup that never follows the prototype chain ('constructor', '__proto__', ...).
export const own = (o, k) => (o != null && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

// JSON round trip: drops functions and undefined fields, turns Dates into strings. Applied to plain stored data, where
// that is exactly the wanted normalisation; structuredClone would keep types the stored format cannot hold.
export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// Blank strings are not numbers (Number('') is 0 and would silently replace the default). Out-of-range values are
// clamped, not rejected: a value one step outside a slider range is still meaningful.
export const num = (v, def, min, max) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return def;
  return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
};

export const oneOf = (v, list, def) => (list.includes(v) ? v : def);
// Strings as they are; numbers / booleans as text; null, undefined, objects and functions -> def.
export const str = (v, def = '') => (typeof v === 'string' ? v : v == null || typeof v === 'object' || typeof v === 'function' ? def : String(v));
export const bool = (v, def) => (typeof v === 'boolean' ? v : def);
// Scaling rounding: ties such as 1.005 go down because 1.005 * 100 is 100.4999... in binary. Fine for display only.
export const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;
export const pad2 = (n) => String(n).padStart(2, '0');

// type/subtype media type token.
export const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/;

// Own-property path lookup ('items.2.title'); never follows the prototype chain.
export function getPath(obj, path) {
  let o = obj;
  for (const k of String(path).split('.')) {
    if (o == null || typeof o !== 'object' || !Object.prototype.hasOwnProperty.call(o, k)) return undefined;
    o = o[k];
  }
  return o;
}
