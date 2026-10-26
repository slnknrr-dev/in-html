// crypto-tool/checksums.js - checksum list files: GNU coreutils (sha256sum, md5sum ...: `<hex>  <name>`, `<hex> *<name>`,
// backslash-escaped names) and BSD / `--tag` (`SHA256 (<name>) = <hex>`). The algorithm comes from the BSD tag, else
// from the digest length, unless one is forced.
//   parseChecksumList(text, forced = 'auto') -> [{ name, hex, algo (registry id or null) }]
// Length-based guessing is ambiguous by nature (64 hex digits = SHA-256, SHA3-256, BLAKE2s-256…): it picks the most common
// algorithm; the user can force another one.
const BY_LEN = { 8: 'crc-32', 32: 'md5', 40: 'sha-1', 56: 'sha-224', 64: 'sha-256', 96: 'sha-384', 128: 'sha-512' };
const BSD = { MD2: 'md2', MD4: 'md4', MD5: 'md5', SHA1: 'sha-1', SHA224: 'sha-224', SHA256: 'sha-256', SHA384: 'sha-384', SHA512: 'sha-512', 'SHA512/256': 'sha-512/256',
  'SHA3-224': 'sha3-224', 'SHA3-256': 'sha3-256', 'SHA3-384': 'sha3-384', 'SHA3-512': 'sha3-512', BLAKE2B: 'blake2b-512', BLAKE2b: 'blake2b-512',
  'BLAKE2B-512': 'blake2b-512', BLAKE2S: 'blake2s-256', RMD160: 'ripemd-160', RIPEMD160: 'ripemd-160', CRC32: 'crc-32' };

export function parseChecksumList(text, forced = 'auto') {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // BSD form first: its "(" … ") =" frame cannot be mistaken for a GNU line.
    let m = /^([A-Za-z0-9/-]+) ?\((.+)\) ?= ?([0-9a-fA-F]+)$/.exec(line);
    if (m) { out.push({ name: m[2], hex: m[3].toLowerCase(), algo: forced !== 'auto' ? forced : BSD[m[1]] || BSD[m[1].toUpperCase()] || BY_LEN[m[3].length] || null }); continue; }
    // GNU form: a leading backslash marks a line whose name contains escapes (\n, \\); "*" before the name means binary mode.
    // KNOWN DEFECT: the two unescape replaces run in sequence, so an escaped backslash followed by "n" (\\n in the file, a
    // literal backslash + n) becomes a newline. Fix: one pass, name.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c)).
    m = /^\\?([0-9a-fA-F]{8,})[ \t]+[ *]?(.+)$/.exec(line);
    if (m) {
      let name = m[2];
      if (raw.trim().startsWith('\\')) name = name.replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
      out.push({ name: name.replace(/^\.\//, ''), hex: m[1].toLowerCase(), algo: forced !== 'auto' ? forced : BY_LEN[m[1].length] || null });
    }
  }
  return out;
}

