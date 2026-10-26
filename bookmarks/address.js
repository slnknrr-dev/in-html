// bookmarks/address.js - IP address classes for server-side fetches (SSRF protection): only globally reachable
// unicast addresses are "public"; loopback, private, link-local, CGNAT, multicast, documentation, benchmarking and
// reserved blocks of IPv4 and IPv6 are not. IPv6 forms that carry an IPv4 address (IPv4-mapped ::ffff:a.b.c.d, NAT64
// 64:ff9b::/96, 6to4 2002::/16) are judged by that IPv4 address.
//
//   parseIPv4(text) -> [a, b, c, d] | null        strict dotted decimal
//   parseIPv6(text) -> [8 x 16-bit] | null        '::' compression, an IPv4 tail, brackets and a %zone are accepted
//   classifyIP(text) -> { version: 4 | 6 | 0, kind, via? }   kind: public, loopback, private, link-local, cgnat,
//                     multicast, broadcast, unspecified, documentation, benchmarking, unique-local, site-local,
//                     reserved, invalid;  via: 'mapped' | 'nat64' | '6to4' when an embedded IPv4 address decided
//   isPublicIP(text) -> boolean

// Strict on purpose: leading zeros (octal in inet_aton: 010 = 8), short forms (127.1) and hex (0x7f) are refused, so
// the text classified is unambiguously the address that will be connected to. Callers must classify the RESOLVED
// address of a hostname (after DNS) and connect to that same address; checking the name and letting the HTTP client
// resolve again is the classic DNS-rebinding hole.
export function parseIPv4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s).trim());
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((x, i) => x <= 255 && !(m[i + 1].length > 1 && m[i + 1][0] === '0')) ? p : null;
}

// Expands '::' into the missing zero groups; an embedded dotted IPv4 tail counts as two groups. Brackets (URL host
// form) and a %zone suffix are stripped. More than one '::' or a wrong group count is invalid.
export function parseIPv6(s) {
  let t = String(s).trim().replace(/^\[|\]$/g, '').replace(/%[^%]*$/, '');
  if (!t.includes(':')) return null;
  let tail = [];
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(t);
  if (v4) {
    const p = parseIPv4(v4[1]);
    if (!p) return null;
    tail = [(p[0] << 8) | p[1], (p[2] << 8) | p[3]];
    t = t.slice(0, -v4[1].length);
    if (t.endsWith(':') && !t.endsWith('::')) t = t.slice(0, -1);
  }
  const halves = t.split('::');
  if (halves.length > 2) return null;
  const part = (x) => (x === '' ? [] : x.split(':'));
  const head = part(halves[0]), rest = halves.length === 2 ? part(halves[1]) : [];
  const groups = [...head, ...rest];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  const n = groups.length + tail.length;
  if (halves.length === 1 ? n !== 8 : n > 7) return null;
  const zeros = halves.length === 2 ? 8 - n : 0;
  return [...head.map((g) => parseInt(g, 16)), ...Array(zeros).fill(0), ...rest.map((g) => parseInt(g, 16)), ...tail];
}

// IANA special-purpose registry blocks, precomputed to (network, mask) as unsigned 32-bit ints (>>> 0 keeps bitwise
// results unsigned). classify4 picks the most specific matching block (longest mask), defaulting to public.
const V4_BLOCKS = [
  ['0.0.0.0/8', 'unspecified'], ['10.0.0.0/8', 'private'], ['100.64.0.0/10', 'cgnat'], ['127.0.0.0/8', 'loopback'],
  ['169.254.0.0/16', 'link-local'], ['172.16.0.0/12', 'private'], ['192.0.0.0/24', 'reserved'], ['192.0.2.0/24', 'documentation'],
  ['192.31.196.0/24', 'reserved'], ['192.52.193.0/24', 'reserved'], ['192.88.99.0/24', 'reserved'], ['192.168.0.0/16', 'private'],
  ['192.175.48.0/24', 'reserved'], ['198.18.0.0/15', 'benchmarking'], ['198.51.100.0/24', 'documentation'],
  ['203.0.113.0/24', 'documentation'], ['224.0.0.0/4', 'multicast'], ['240.0.0.0/4', 'reserved'], ['255.255.255.255/32', 'broadcast'],
].map(([cidr, kind]) => {
  const [ip, bits] = cidr.split('/');
  const p = parseIPv4(ip);
  const mask = Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
  return { net: ((((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0) & mask) >>> 0, mask, kind };
});

function classify4(p) {
  const n = ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
  let best = null;
  for (const b of V4_BLOCKS) if (((n & b.mask) >>> 0) === b.net && (!best || b.mask > best.mask)) best = b;
  return best ? best.kind : 'public';
}

const v4Of = (g, i) => [g[i] >> 8, g[i] & 255, g[i + 1] >> 8, g[i + 1] & 255];

// Order matters: exact special addresses first, then forms that embed IPv4 (mapped, NAT64, 6to4), which are judged
// by the inner IPv4 address: ::ffff:127.0.0.1 must count as loopback, otherwise a mapped address bypasses the IPv4
// rules. Anything outside 2000::/3 (global unicast) that matched nothing else is reserved.
function classify6(g) {
  const zeroUpTo = (k) => g.slice(0, k).every((x) => x === 0);
  if (g.every((x) => x === 0)) return { kind: 'unspecified' };
  if (zeroUpTo(7) && g[7] === 1) return { kind: 'loopback' };
  if (zeroUpTo(5) && g[5] === 0xffff) return { kind: classify4(v4Of(g, 6)), via: 'mapped' };
  if (zeroUpTo(6)) return { kind: 'reserved' }; // IPv4-compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) return { kind: classify4(v4Of(g, 6)), via: 'nat64' };
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return { kind: 'private' };
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return { kind: 'reserved' };
  if (g[0] === 0x2001 && g[1] === 0x0db8) return { kind: 'documentation' };
  if (g[0] === 0x2001 && g[1] < 0x200) return { kind: 'reserved' };
  if (g[0] === 0x2002) return { kind: classify4(v4Of(g, 1)), via: '6to4' };
  if (g[0] === 0x3fff && g[1] < 0x1000) return { kind: 'documentation' };
  if (g[0] === 0x5f00) return { kind: 'reserved' };
  if ((g[0] & 0xfe00) === 0xfc00) return { kind: 'unique-local' };
  if ((g[0] & 0xffc0) === 0xfe80) return { kind: 'link-local' };
  if ((g[0] & 0xffc0) === 0xfec0) return { kind: 'site-local' };
  if ((g[0] & 0xff00) === 0xff00) return { kind: 'multicast' };
  if ((g[0] & 0xe000) !== 0x2000) return { kind: 'reserved' };
  return { kind: 'public' };
}

export function classifyIP(text) {
  const v4 = parseIPv4(text);
  if (v4) return { version: 4, kind: classify4(v4) };
  const v6 = parseIPv6(text);
  if (v6) return { version: 6, ...classify6(v6) };
  return { version: 0, kind: 'invalid' };
}

export const isPublicIP = (text) => classifyIP(text).kind === 'public';
