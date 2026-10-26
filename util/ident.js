// util/ident.js - canonical forms of hardware and network identifiers and of serial / inventory codes, for storage
// and for search.
//
//   normalizeMac(v, { sep = ':', lower = false }) -> 'AA:BB:CC:DD:EE:FF' | null   accepts aa-bb-…, aabb.ccdd.eeff,
//                                                                               12 hex digits (MAC, BSSID, EUI-48)
//   normalizeIPv4(v) -> '192.168.0.1' | null      dotted quad; leading zeros dropped (010 -> 10)
//   normalizeIPv6(v) -> '2001:db8::1' | null      RFC 5952: lower case, no leading zeros, the longest run of two or
//                                                 more zero groups as '::' (the first on a tie), IPv4-mapped tail
//                                                 dotted (::ffff:192.0.2.1); brackets and a %zone are accepted
//   normalizeIp(v) -> IPv4 or IPv6 canonical | null
//   normalizeCode(v) -> code | null               letters, digits, - _ / . # and single spaces; up to 64 characters
//   normalizeIdent(type, v) -> canonical | null   type: 'mac' | 'bssid' | 'ip' | anything else (a code)
//   compactIdent(v) -> 'AABBCC…'                  search key: upper case without separators (aa-bb finds AA:BB:…)
//
// Contract: every normalizer returns the canonical string or null; it never throws and never "repairs" invalid input.
// Equal identifiers must give equal strings so canonical forms work as dedup and exact-match keys; a lenient
// normalizer that guessed would merge distinct devices.

// Strips every common separator style (Unix ':', Windows '-', Cisco '.') and then insists on exactly 12 hex digits.
// The separator layout itself is not validated (aa:bbcc-ddeeff passes): the forgiving behaviour users expect.
export function normalizeMac(v, { sep = ':', lower = false } = {}) {
  const hex = String(v ?? '').trim().replace(/[\s:.\-]/g, '');
  if (!/^[0-9a-fA-F]{12}$/.test(hex)) return null;
  const s = hex.match(/../g).join(sep);
  return lower ? s.toLowerCase() : s.toUpperCase();
}

// Strict dotted quad: inet_aton shorthands (10.1, 0x0a.0.0.1) are rejected and leading zeros are read as decimal.
// inet_aton reads 010 as octal 8; in inventory data a leading zero is a formatting habit, not octal.
export function normalizeIPv4(v) {
  const p = String(v ?? '').trim().split('.');
  if (p.length !== 4 || !p.every((x) => /^\d{1,3}$/.test(x) && +x <= 255)) return null;
  return p.map(Number).join('.');
}

export function normalizeIPv6(v) {
  let s = String(v ?? '').trim();
  if (s[0] === '[' && s[s.length - 1] === ']') s = s.slice(1, -1);
  let zone = '';
  const z = s.indexOf('%');
  if (z >= 0) { zone = s.slice(z); s = s.slice(0, z); if (!/^%[\w.~-]+$/.test(zone)) return null; }
  if (!/^[0-9a-fA-F:.]+$/.test(s) || !s.includes(':')) return null;
  // An IPv4 tail becomes two groups.
  // The dotted tail becomes two 16-bit groups up front so the group count check below treats it uniformly. After
  // cutting it off, the trailing ':' is dropped unless it belongs to '::' (else 'a::1.2.3.4' would lose its gap).
  let tail = [];
  const lastColon = s.lastIndexOf(':');
  if (s.indexOf('.', lastColon) > 0) {
    const v4 = normalizeIPv4(s.slice(lastColon + 1));
    if (!v4) return null;
    const b = v4.split('.').map(Number);
    tail = [(b[0] << 8) | b[1], (b[2] << 8) | b[3]];
    s = s.slice(0, lastColon + 1);
    if (!s.endsWith('::')) s = s.slice(0, -1);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const part = (x) => (x === '' ? [] : x.split(':'));
  const head = part(halves[0]), rest = halves.length === 2 ? part(halves[1]) : [];
  if ([...head, ...rest].some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  const known = head.length + rest.length + tail.length;
  // With '::' at most 7 explicit groups (the gap stands for at least one zero group); without it exactly 8.
  if (halves.length === 2 ? known > 7 : known !== 8) return null;
  const groups = [...head, ...Array(halves.length === 2 ? 8 - known : 0).fill('0'), ...rest].map((g) => parseInt(g, 16)).concat(tail);
  // IPv4-mapped (::ffff:a.b.c.d) is written with the dotted tail.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return `::ffff:${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}${zone}`;
  }
  // RFC 5952 4.2: compress the longest zero run, the first on a tie, never a single zero group (bestLen starts at 1).
  let best = -1, bestLen = 1;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) { best = i; bestLen = j - i; }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  const out = best < 0 ? hex.join(':') : hex.slice(0, best).join(':') + '::' + hex.slice(best + bestLen).join(':');
  return out + zone;
}

// IPv4 first: a dotted quad without a colon can never be valid IPv6, so the order cannot misclassify.
export const normalizeIp = (v) => normalizeIPv4(v) ?? normalizeIPv6(v);

// Character whitelist common in serial and inventory numbers; \p{L}\p{N} admit any script. Rejecting the rest
// (angle brackets, quotes, etc.) keeps codes safe in labels, filenames and CSV without context-specific escaping.
export function normalizeCode(v) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  return /^[\p{L}\p{N}\-_/.# ]{1,64}$/u.test(s) ? s : null;
}

export function normalizeIdent(type, v) {
  if (type === 'mac' || type === 'bssid') return normalizeMac(v);
  if (type === 'ip') return normalizeIp(v);
  return normalizeCode(v);
}

// Search key, not a storage form: separators removed so 'aa-bb' typed by a user finds 'AA:BB:...'. Lossy by design.
export const compactIdent = (v) => String(v ?? '').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
