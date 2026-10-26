// codec/uu.js - UUencode and XXencode: lines of up to 45 bytes, a length character, then 6-bit groups of three bytes,
// framed by "begin <mode> <name>" and "end" (an empty line before "end": '`' / '+').
//
//   uuEncode(bytes, { table = 'uu' | 'xx', name = 'data.bin', mode = '644', frame = true }) -> string ('\n' lines)
//   uuDecode(text, { table }) -> { bytes, name, mode }   the frame is optional; 'auto' picks the table under which
//                                                       more lines have valid characters and a matching length character
// UU uses characters 32…95 with '`' for zero (as uuencode and Python's b2a_uu(backtick=True)); XX uses
// "+-0-9A-Za-z".

//
// Format: each line = one length char (byte count, 0..45) + ceil(n/3) * 4 data chars. 45 bytes -> 60 chars + 1 =
// 61-char lines, historically chosen to survive 80-column transports. The zero-length line terminates the data.
// UU maps value v to char 32 + v, but v = 0 would be a SPACE, which mailers strip at line ends - hence '`' (96) for
// zero. XX exists because UU's punctuation was mangled by EBCDIC gateways; its alphabet is alphanumeric plus '+-'.

const XX = '+-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
// The UU decoder masks with & 63, so both ' ' and '`' decode to 0 (classic uudecode behaviour). Side effect: with an
// explicit table 'uu', characters outside 32..96 are not rejected but wrapped mod 64; only the 'auto' path validates
// (VALID below).
const enc = { uu: (v) => (v === 0 ? '`' : String.fromCharCode(32 + v)), xx: (v) => XX[v] };
const dec = {
  uu: (c) => (c === '`' ? 0 : (c.charCodeAt(0) - 32) & 63),
  xx: (c) => { const v = XX.indexOf(c); if (v < 0) throw new Error(`invalid XX character "${c}"`); return v; },
};

// Missing bytes of the final triplet are read as 0 (`|| 0`) and their chars are still emitted (always 4 per group);
// the length char tells the decoder how many bytes are real.
export function uuEncode(bytes, { table = 'uu', name = 'data.bin', mode = '644', frame = true } = {}) {
  const e = enc[table];
  if (!e) throw new Error('table must be "uu" or "xx"');
  const lines = [];
  for (let i = 0; i < bytes.length; i += 45) {
    const chunk = bytes.subarray(i, i + 45);
    let line = e(chunk.length);
    for (let j = 0; j < chunk.length; j += 3) {
      const a = chunk[j], b = chunk[j + 1] || 0, c = chunk[j + 2] || 0;
      line += e(a >> 2) + e(((a & 3) << 4) | (b >> 4)) + e(((b & 15) << 2) | (c >> 6)) + e(c & 63);
    }
    lines.push(line);
  }
  if (!frame) return lines.join('\n') + (lines.length ? '\n' : '');
  return `begin ${mode} ${name}\n${lines.join('\n')}${lines.length ? '\n' : ''}${e(0)}\nend\n`;
}

// How many lines read consistently with a table: valid characters, and the length character matches the number of
// group characters (one extra character is tolerated - some encoders append a check character). -1: invalid characters.
const VALID = { uu: /^[ -`]+$/, xx: /^[+\-0-9A-Za-z]+$/ };
function fits(lines, t) {
  let score = 0;
  for (const l of lines) {
    if (!VALID[t].test(l)) return -1;
    const n = dec[t](l[0]), k = l.length - 1, need = Math.ceil(n / 3) * 4;
    if (k === need || k === need + 1) score++;
  }
  return score;
}

// "begin-base64" is recognised only to refuse it with a clear message (it is the uuencode -m MIME form).
// Table detection prefers UU on ties: every XX line is also valid UU-range text, so XX must win strictly.
// The `line === 'end'` check inside the loop is unreachable (filtered out above); the n === 0 line ends the data.
// Surplus chars beyond n bytes are ignored (tolerates encoders that append a checksum char); too few throws.
export function uuDecode(text, { table = 'auto' } = {}) {
  let lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  let name = '', mode = '';
  const b = lines.findIndex((l) => /^begin(-base64)? [0-7]{3,4} /.test(l));
  if (b >= 0) {
    const m = /^begin [0-7]{3,4} (.*)$/.exec(lines[b]);
    if (!m) throw new Error('"begin-base64" is MIME Base64, not UUencode');
    mode = lines[b].split(' ')[1];
    name = m[1];
    lines = lines.slice(b + 1);
  }
  const data = lines.filter((l) => l.length && l !== 'end');
  let t = table;
  if (t === 'auto') {
    const su = fits(data, 'uu'), sx = fits(data, 'xx');
    t = sx > su ? 'xx' : 'uu';
  }
  const d = dec[t];
  if (!d) throw new Error('table must be "auto", "uu" or "xx"');
  const out = [];
  for (const line of data) {
    if (line === 'end') break;
    const n = d(line[0]);
    if (n === 0) break;
    const groups = line.slice(1);
    const bytes = [];
    for (let j = 0; j < groups.length && bytes.length < n; j += 4) {
      const v = [0, 1, 2, 3].map((k) => (groups[j + k] !== undefined ? d(groups[j + k]) : 0));
      bytes.push((v[0] << 2) | (v[1] >> 4), ((v[1] & 15) << 4) | (v[2] >> 2), ((v[2] & 3) << 6) | v[3]);
    }
    if (bytes.length < n) throw new Error(`line too short for ${n} bytes`);
    out.push(...bytes.slice(0, n).map((x) => x & 255));
  }
  return { bytes: Uint8Array.from(out), name, mode };
}
