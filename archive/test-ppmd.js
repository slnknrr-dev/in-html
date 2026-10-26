// archive/test-ppmd.js - tests of the PPMd decoders (ppmd7.js: 7z PPMd var.H, ppmd8.js: ZIP PPMd var.I rev. 1):
// `node archive/test-ppmd.js` (importing the module runs nothing; `run()` returns the number of failures).
//
// With 7-Zip installed (env SEVEN_ZIP=<path>, or 'none' to skip it; else C:/Program Files/7-Zip/7z.exe, 7zz or 7z in
// /usr/bin, /usr/local/bin, /opt/homebrew/bin) fixtures are made fresh: generated inputs (text, random, zeros, mixes;
// orders 2..32, memory sizes down to 64 KB / 1 MB so that the model restarts or is cut off) are compressed and the
// decoded output must equal the input; counters on the model prove that restarts, cut-offs and block gluing ran.
// The embedded fixtures below always run (made by `node archive/test-ppmd.js --fixtures`). `-v`: speed per fixture.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArchiveError, Reader, bytesStream, readAll } from './io.js';
import { Ppmd7, RangeDecoder7z, RangeDecoderRar, ppmd7Stream } from './ppmd7.js';
import { Ppmd8, ppmd8Stream } from './ppmd8.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// --- inputs ------------------------------------------------------------------------------------------------------

function xorshift(seed) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
}
const WORDS = ('the of and to in is that it was for on are with as be by this at from or have an they which one you were ' +
  'all there would their we been has when who will more no if out so said what up its about into than them can only other ' +
  'new some could time these two may then do first any now such like over even most made after also did many before must ' +
  'through back years where much your way well down should because each just those people how little state good very make ' +
  'world still own see work long get here between both life being under never day same another know while last might great ' +
  'old year off come since against go came right used take three archive stream model context symbol order memory').split(' ');

const GEN = {
  text(n, seed) {
    const r = xorshift(seed), out = new Uint8Array(n);
    for (let o = 0; o < n;) {
      const w = WORDS[r() % WORDS.length] + (r() % 13 === 0 ? '.\n' : r() % 7 === 0 ? ', ' : ' ');
      for (let i = 0; i < w.length && o < n; i++) out[o++] = w.charCodeAt(i);
    }
    return out;
  },
  random(n, seed) { const r = xorshift(seed); return Uint8Array.from({ length: n }, () => r() & 0xff); },
  binary(n, seed) { const r = xorshift(seed); return Uint8Array.from({ length: n }, () => 97 + (r() & 1)); },
  alpha64(n, seed) { const r = xorshift(seed); return Uint8Array.from({ length: n }, () => 32 + (r() & 63)); },
  zeros(n) { return new Uint8Array(n); },
  mix(n, seed) { // blocks of text, random bytes and zeros
    const out = new Uint8Array(n), kinds = ['text', 'random', 'zeros', 'text', 'alpha64'];
    for (let o = 0, k = 0; o < n; o += 32768, k++) out.set(GEN[kinds[k % kinds.length]](Math.min(32768, n - o), seed + k), o);
    return out;
  },
};
const input = ([gen, n, seed = 1]) => GEN[gen](n, seed);

// --- containers --------------------------------------------------------------------------------------------------

// 7z: with -mhc=off a single-file archive is [32-byte signature header][packed stream][plain header]; the header must
// say exactly that (one pack stream at 0, one folder with one PPMd coder).
function parse7z(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== 0xafbc7a37) throw new Error('not 7z');
  const packed = Number(dv.getBigUint64(12, true));
  let p = 32 + packed;
  const num = () => {
    const first = b[p++];
    let mask = 0x80, v = 0;
    for (let i = 0; i < 8; i++, mask >>= 1) {
      if (!(first & mask)) return v + (first & (mask - 1)) * 2 ** (8 * i);
      v += b[p++] * 2 ** (8 * i);
    }
    return v;
  };
  const expect = (...want) => { for (const w of want) if (num() !== w) throw new Error('unexpected 7z header layout'); };
  expect(0x01, 0x04, 0x06, 0, 1, 0x09, packed, 0x00, 0x07, 0x0b, 1, 0, 1, 0x23, 3, 4, 1);
  const n = num();
  if (n !== 5) throw new Error('PPMd props size ' + n);
  return { data: b.subarray(32, 32 + packed), props: b.slice(p, p + 5) };
}

// ZIP: the first local header; data = the method 98 stream (2-byte parameter word + range-coded data).
function parseZip(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error('not ZIP');
  const method = dv.getUint16(8, true), csize = dv.getUint32(18, true), usize = dv.getUint32(22, true);
  const off = 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
  return { method, usize, data: b.subarray(off, off + csize) };
}

// --- 7-Zip as the oracle -----------------------------------------------------------------------------------------

async function sevenZip() {
  if (typeof process === 'undefined' || process.env.SEVEN_ZIP === 'none') return null;
  const fs = await import('node:fs');
  const list = [process.env.SEVEN_ZIP, 'C:/Program Files/7-Zip/7z.exe', '/usr/bin/7zz', '/usr/bin/7z', '/usr/local/bin/7zz',
    '/usr/local/bin/7z', '/opt/homebrew/bin/7zz', '/opt/homebrew/bin/7z'];
  const exe = list.find((f) => f && fs.existsSync(f));
  if (!exe) return null;
  const os = await import('node:os'), cp = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-ppmd-'));
  let n = 0;
  return {
    exe,
    /** Compresses `bytes` as one file; returns the archive bytes. */
    pack(kind, bytes, args) {
      const f = path.join(dir, `in${n}.bin`), a = path.join(dir, `out${n++}.${kind}`);
      fs.writeFileSync(f, bytes);
      cp.execFileSync(exe, ['a', '-t' + kind, ...args, a, f], { stdio: 'ignore' });
      const b = new Uint8Array(fs.readFileSync(a));
      fs.rmSync(a);
      fs.rmSync(f);
      return b;
    },
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

const ARGS_7Z = ['-mhc=off', '-ms=off', '-mtm=off', '-mtc=off', '-mta=off'];

// Fresh fixtures: [name, kind, input, 7z.exe method args, minimum model event counts]
const CASES = [
  ['7z tiny', '7z', ['text', 1], ['-m0=PPMd:o=6']],
  ['7z short', '7z', ['text', 100, 3], ['-m0=PPMd:o=4']],
  ...[2, 3, 4, 6, 8, 16, 32].map((o) => [`7z text o${o}`, '7z', ['text', 150000, o], [`-m0=PPMd:o=${o}:mem=16m`]]),
  ['7z random', '7z', ['random', 65536, 5], ['-m0=PPMd:o=6:mem=16m']],
  ['7z zeros', '7z', ['zeros', 1 << 20], ['-m0=PPMd:o=2:mem=1m']],
  ['7z mix o8 1m', '7z', ['mix', 512 * 1024, 7], ['-m0=PPMd:o=8:mem=1m'], { 'Ppmd7.restartModel': 2 }],
  ['7z text o8 1m restarts', '7z', ['text', 2000000, 8], ['-m0=PPMd:o=8:mem=1m'], { 'Ppmd7.restartModel': 3, 'Ppmd7.glueFreeBlocks': 1 }],
  ['7z binary o16 64k restarts', '7z', ['binary', 30000, 9], ['-m0=PPMd:o=16:mem=64k'], { 'Ppmd7.restartModel': 5 }],
  ['zip short', 'zip', ['text', 300, 4], ['-mm=PPMd']],
  ...[2, 4, 8, 16].map((o) => [`zip text o${o}`, 'zip', ['text', 150000, o], ['-mm=PPMd', `-mo=${o}`, '-mmem=16m', `-mx=${o < 8 ? 5 : 9}`]]),
  ['zip alpha64', 'zip', ['alpha64', 100000, 3], ['-mm=PPMd', '-mo=6', '-mmem=16m']],
  ['zip text o8 1m restart', 'zip', ['text', 2000000, 11], ['-mm=PPMd', '-mo=8', '-mmem=1m', '-mx=5'], { 'Ppmd8.restartModel': 2 }],
  ['zip text o8 1m cut-off', 'zip', ['text', 2000000, 12], ['-mm=PPMd', '-mo=8', '-mmem=1m', '-mx=9'], { 'Ppmd8.cutOff': 1 }],
  ['zip text o16 1m cut-off', 'zip', ['text', 1200000, 13], ['-mm=PPMd', '-mo=16', '-mmem=1m', '-mx=9'], { 'Ppmd8.cutOff': 1 }],
  ['zip mix o6 1m cut-off', 'zip', ['mix', 640 * 1024, 14], ['-mm=PPMd', '-mo=6', '-mmem=1m', '-mx=9'], { 'Ppmd8.cutOff': 1 }],
];

// Embedded fixtures (`--fixtures` prints this list): [name, kind, input, base64 props (7z), base64 data, events]
const EMBEDDED = [
  ["7z text o6", '7z', ["text",3000,21], 'BgAAAQA=',
    'AG71eWgh7dl11dYRF2/AjcZji4plajgOLa8qNiEy7WDDB0GbXsrUXfZu3aHFJzd7KVcTfgjSsJyG1mmzuKKkWlh3ef2brt4ixorSdCh6AoI4opOh' +
    '0HDDjDwJGT4JMwMyYY8ra1NlhgedmRZBrgpcnMidxJSez6xe8I8WGVKAPR5jpn/DAnZlQpJvbkty2hlzxiRaHgRRW2ecNguMKMNh3s3BSTCIJQAq' +
    'vD1R66zu6TpYMaIK3ibN5LCUQmTotDBHp/mY90ROErDUVr3cAwjmqLnl0MU1/WHVb9xMwxzB7Oc/HJ6Rb14aGrbQxjhS5TFjLZFmTB84Q4WAarL1' +
    'nos+VHgu9HCmr3J9bvbYfnfT8ZcDdGzRz0VEVdTplF38P235JTuWfR7tAvkzdvcFRHKgrc+jboon3uknMQStWmOrhr6f+FWZu8BBJoEYKwJ3d/iO' +
    'e2DLJrdnEboF5dqV0i/dEV8XW/UVAUSLTcbIZpk3Mrp4KdWaBvAclqjPJZo8H+P0vgXj3fqalAtrD95Meg4Y5giFOtQ198fDHKtozImXK0f1sNVZ' +
    'fzMyDYM7OuejJ2oPT9EhHu7I5FglO/kx1vw/5jA7sL3wyhhBgFHenSr5Xp4USm8XsjQPNrnj/7IJ57rUlt02F8/nROKVWYSUelbDGyxye22IbbBg' +
    'JDTZ1dRABxD2WWsEDNwjlAGMQ6UUltdOoh2JmY0AYMhgmZrTuGOThoywuxWLM5K3WvVKjdZ2INavJa2OtnCLmPudyBMk6ETS/gMRK13D3vnHeth1' +
    '/mpexriC3mbAHyRT0eBtQX16xY73IqHTGWo8UuxvZbL27obTsjQ3hi7rGyv3GUK2Mev9VSAs8huEB/+Cs+wSG2NU5W2NugHLDOz+HfIPvPC3vzsU' +
    'fay3KKvdd5EdGpBk+2peLJ/MQ0On33bmm2wFmYnhQV7cq3sLYXw+CWgNuPFCjCdjeTN6KfhdwA4P8t8ePv+AhCWFt4GmaiwyqNYUcUKPk+7ze6G/' +
    'pLGDXqXesLlKP7FM498FZOV6k6q56GzHgbNYGvgCbtjNkaF1rqOOvg7A+/nvPpHNjEve9Dn8gSijeSUt3o72EqZ7mgv+e6QdYDw3lCBxYH0jUKza' +
    'NTFU5chgp1Cfro+jUp+Dk0HzTsL+K7v0D/HJtwRE3ouYOXBssK/wUYkc5Ip5Z4wsQt9xL+10hvYwsxHdIGsLyz9SQwIaoE6JsPr1+Z/wpEpMSXLF' +
    'Z+M4/0LMbCqYhUy/xI8FEfkQVhcCkh5/nXSOorErAkBEDO/+oGyXqDOYQqtX+B9M+D0Cb9dugJIp4HeN7/4+1I83iasnH11yRAA='],
  ["7z text o32 64k", '7z', ["text",3000,22], 'IAAAAQA=',
    'AGEPPBNJpLzMFWde6hPP2cIl62isOD13G+FrqMSBgjszIGZ+0heVJF0z6zMR3uGCZeOwzCAF+wO+PRJUMBQVjtHmoE2TrqCLReSORTIQLkaj4xcY' +
    'rIsiYf0oYlKMSxirwDyq7FtUJ8eoIRjjedU63chj7z3nz3MEjskkgK6Z40mDrqi6ITVVo7UzuHYB7bl4SrVLKWwmopKk073Lx6cJltez2mXRZKfB' +
    'DH28Q+tGGnsS7ejGU0jZJmjVdkEuxfoLk6if84fAA9NUXM5huGvmLGk4ZP+mKRhZR5sV1/3c9tUH/w+Tb2bZnhel0Kwf/yj1rSJ2IqkQvwa5np1x' +
    'ZL9CpqYLM41hpqIh4sOuxJSoxyqVNMjyIWAlpMV70bMegoNVEfBOoNnxY3HhqK0Mlc0GAJ0D/2OW7/wRD0gGMJMv7+LnQlly/kVEv1EzlwRicKVM' +
    'SyiU8uFkZV0Gf1OVACc65mG/mU0+uM+nJ1023fMT2gi+MA23jXVYOENpA62TDHdFfsziKUg9Qm40WLp5y1ptXpnmFYsQaFBtL0NRveT/iAkbr/JJ' +
    'KQ5jE34Eiv4QzMhoqKFBRdjg1F8Ul+qckjZMAECZIvVp7rVRVbR++x6eWbQE23V36KJlyw+wYPOMjcmWjqv/edH1+DZlYuu7hWSO8n2T8BSrTIxZ' +
    '8Yw0CWgWORKrwjwgrEd93NWRI4mR3wzUe/q0uVEbwTttwMxhAKQgV7FoQqQC+qFCKWcAI8f2V8rvbFoHLJD4cZzpYWRP9SdgGnGFYrt4vp6W4TES' +
    'RfCHffyT923Zm4ut8nxYD07Ss4GVM/ZknGir+FdUOFxq0eEtPu3HHBCkpmmFzc8jTeRbuClDAJGmBZzzXlsu8lYwo5g4jyEbphtKSgdXAquCQxii' +
    'k43WOErOP6SNOQhaxIsKzvOzif6Ip2WmLtKYJ5dkT8qkVTswJXNRBhO4lUbVRvAZlc68AVKKdgc/wA2xy9wYp0kcDEAqI58cvgnx8gnANMbQYRz9' +
    'eoJHCKg4Q2PH3AGbXLWesQs32zF04bFqWg8uQQY3vljkXfb8ItX+AmHEojJ7/VyK/jlMmFDu0jYwoPhZd27OOnhxnPcrtJHTSy2yiq9fW+9tyKqo' +
    'VbUj8LyYBiMfjIw1i6KIzAW19YvWcX7ZxQdp1K7uZePS+U0v/tcpKqSHSxmv97eJXVySaIIlg1rUc70yVWDqmMceJuz28VVtDl3PVoNaf8lRfVVN' +
    '6A3tYjaabIf5k67i7QKpGmWMRhvf3VwZVL5l872SI57tdMBXldL4ZgFejuSpPUiefpoLwoFyMevErcwN2l724eN7P/oz28L8ajVSM7kCXWtXcSMX' +
    'oS6ql6lhQfwkvc+fAOY='],
  ["7z zeros o2", '7z', ["zeros",20000], 'AgAACAA=',
    'AAAAAAAAAAAAAAAAAAA='],
  ["7z random o4", '7z', ["random",300,23], 'BAAAAQA=',
    'ANV9egW/jxlPM1H2RlPcBlNBafZhhIlt0fVzy60OAEvSGqwBUpxwR/TZ92rev7ln2H3AS/LnmSH8p84nI9wg1/li4E3tMlpPBj/83/9CovoqZeXW' +
    'iyLBHXTSKEKJyZ94lH+Au9qUp5Q1aKl2/xRTKZT0Hfrm08mC6y/pUqT+V2qJCasHAOxdvOTE67JXyRgZ1ibvqF6BZUvXHbKYmcY2ZGTB0OgaIuMp' +
    'FsDzhfhG0ZTA4fWsF9SeSx1/5mjosKJiMhzvQUPL3YqXmI2Jz9lsUYihp0Imbdm0jrSqNSaFhz+q5Z3v2MEz02gQpTwTkPwu0p5PRv5Pc8NN1xvP' +
    'sk5lne5RnC8fQcFXmQFQ6taMqEnDZTODwU883TZ8CYWgnxX+evNu9a08TYJBdNRiENJkbDpES/xWFjxGv5w42/og3OcTGC3pPAA='],
  ["7z binary o16 64k restarts", '7z', ["binary",12000,24], 'EAAAAQA=',
    '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',
    {"Ppmd7.restartModel":3,"Ppmd7.glueFreeBlocks":1}],
  ["zip text o8 cut-off method", 'zip', ["text",2500,25], null,
    'BxBo+y8xYhZLsdJGryRUyOZaQbdrqTGZsLrFKQ4fr1ORghXx3Pnay8w8NDQ7R8UddcEDQJFBQV10yIvurWTYDWB/j7oPs9HbCIWp2zc4eEpdeoFP' +
    '2e8EZM9QMDHKM9H01Bb0aKskh1bOBDkdExI+0pdq6thh/nGzgHyS2J5g7dH384VvY4cdj5al1TbkfPLzDYoZFAW17Cq6VOUIs8N8KO0sCkKw5ACK' +
    'oyNXt63qJYnEF+0JLvGlbIssahoFgVTJe0tSR1m07VGKDiTsNMzBV5uPAIAy+4Sj340lx63B8feAftWco7/Qnqia0eqpvMl7pSSPGh5IlguXU6eb' +
    '10QoO5QuSTzPFx5RkBb84yCHLUX3vvnugt1lMFfYAFn6+w3CdIsQPyQuA2CVvlZRq+1GN4QpZxeKOWI35G78VOTLllDzmEHUkH2SRtATDmu4r8cz' +
    'nziIg6yRQ8aVHrNpQm6M4ag/mHXYLiPvwinrvbKFUnozmKo6B5R0vl5+o/OTbxnxYGmtnjKQwpbPNaefQzh+84yI+NENkQEq5UBIfMBIaknUoqdX' +
    'iUpOgWt4EWnn2pdb516vIov0a9tBvikijfZe/ufXYjnWMSMOvWr6cHD3613pziSkj6596BMlDr+u85UoDSlICnOG9LjiEnunbwKJ18AXx9Bxh8XB' +
    'Jyu6WnXeKS60TZqjKLumuwm6eMzOUBnARtXt1ZcehyJ4xM2G6n9wUs2pThZFIjXSOEkYuL1hvEf2eU9fzgxbiz0Kvac7H2gQNMISOG82wmxpb5vx' +
    'kNbhu/sZ+bUokeGlLjE30uNVARPgodyvD6hlyXdsL5r7Xn6ohzuzucUWPewAdHJA3rF/Su88eUIRWozoO6jws1ZpjIZq0TKXEZ7NuTrlYaFOMZ6t' +
    '/4wpcVKY05HIiXsL/FRk/LfaLpELyHIis54DacXN5b92ek2Vtb/mxIE+NiR5Lz4CNrvxKWpp6mKNWG37uAyL7Fwt7nek48vnMg6t41i8GtTv7+GK' +
    '97HP3jMR9Tv2uaVLgErh2Gg7dsqwSNhIejmnb++pURXVBvdMiOSYJoatjGu8CR0O4sGxufwAhIDasxKo8tdANPcHDTaFf3M0EzTYRqjRoYlnPLYg' +
    'CZwaNqRAjEKpKthlkWtNfgJ+XYlpNpQTTQdfAAA='],
  ["zip text o2 restart method", 'zip', ["text",2000,26], null,
    'AQBnDRAYSpg+bjF1ubrtWbbMEIqUfqxZJP9adFIK/gowwXseyR9WP19o+9zMRbzZw27t2lvJtXORDnCa+hVgQnsjS7UIqVEkiTmUCTUAXJu6hZNm' +
    'TXnvpOpP1Q0RJKnFE+iWKY/bq3WAWZV7Y1k4cquANWKvzsNa/3T0oSMDpOR80IBpiwzSN4edYHCnFet+JQDWLtfwSJlDn39iTrqBrao3IcRzX+Ko' +
    'WqHrXJsFSwHp0m3ilzi3wF1tIWEc2xO1vNwZY77t8+BsA7LQ44EPj+k50gIEik6OJXqNTl+cO8Bp9DgyBzMCG+lu+E1CAgdAUF96PwAsUSBmIdcw' +
    'Efmqsmkpc4MO3kW79DmWZuYQ8H5vouY9qVEGFdBsHoDRsJjj9Zz3ycHf2Q+GAZCIyYozlV9GC6l6AbzoexQtY1swnbonAFxfQF/tXdutFvZK/T4W' +
    'e8bfPE7eQUvkkK5/jO2/PlAA7hW8uFoOeiSBqYktdUbQsqaHvh/8NkgJhQKGME7QIckzyOS70CeAoEKGEId3XbrnSCC72PJ8I4Hh8g9/7CW134Ey' +
    's2K4q5v8Kn3kbalv9Wi1dukaF+dKY9g7lut6LQtv2bQt123WooUZjILj+V0q+gtDVt7QGIo698G/u9uJk6XnuQuKyXUIbu53WYHdzUKf7c5/O0bE' +
    'Z4Xtf9rHXkh9ksJGtFhvtRTPEnhHn2dpGs7mZWsEuH1lD8gp0+LIuoBdtGaud0dKuJTPOJ5coPyYgbXe+d7T22qG1z1NZCoLRnBSR5r9FLtPW1q/' +
    '3C/z9WSxXMWaoFdRxalCciHD3lbzcVTC/g1jGlRaWu0JLttHWFNA7YyQl3iGpm8/4+LxfpVUFGHpoXdsXu9POqblloMOMnVQfza/L36mVZQO5K+Q' +
    'efBwAUNgu/MG4QrQwkXzBPignnpwOpiSQ9jz1oCVUF//gbW/RaUHoaU9nIsVAVO2ANpXxW3yZqQ6+5zL9EhNxC19FkbBK3P2n80gYynnZ8DqM1K0' +
    'GG/DvIRy2cz1EFh6KaTR6G4mzLbDDH7z+itSyHAeEGshcwAA'],
  ["zip binary o16 1m", 'zip', ["binary",40000,27], null,
    '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',
    {"Ppmd8.glueFreeBlocks":1}],
];

// --- model event counters (to prove that restarts and cut-offs really ran) ---------------------------------------

const calls = {};
// Wraps model methods to count calls: equality of output alone cannot prove that the rare paths (restart, cut-off,
// block gluing) ran, and those are where an allocator layout mismatch with 7-Zip would show up.
function instrument() {
  const undo = [];
  for (const [C, names] of [[Ppmd7, ['restartModel', 'glueFreeBlocks']], [Ppmd8, ['restartModel', 'restoreModel', 'cutOff', 'glueFreeBlocks']]]) {
    for (const n of names) {
      const orig = C.prototype[n], key = `${C.name}.${n}`;
      C.prototype[n] = function (...a) { calls[key] = (calls[key] || 0) + 1; return orig.apply(this, a); };
      undo.push(() => { C.prototype[n] = orig; });
    }
  }
  return () => undo.forEach((f) => f());
}

// --- helpers -----------------------------------------------------------------------------------------------------

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
const firstDiff = (a, b) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
};
const decode7z = (data, props, size) => readAll(ppmd7Stream(new Reader(bytesStream(data)), props, { size }));
const decodeZip = (data, size) => readAll(ppmd8Stream(new Reader(bytesStream(data)), { size }));

// Decodes past the data with the bare model: a ZIP PPMd stream ends with the end mark (-1).
function zipEndMark(data, size) {
  const v = data[0] | (data[1] << 8);
  const m = new Ppmd8((((v >> 4) & 0xff) + 1) << 20);
  m.init((v & 15) + 1, v >> 12);
  const rc = new RangeDecoderRar(new Reader(bytesStream(data.subarray(2))));
  for (let i = 0; i < size; i++) m.decodeSymbol(rc);
  return m.decodeSymbol(rc);
}

/** `verbose`: one line per fixture with the decoding speed. */
export async function run({ verbose = false } = {}) {
  let pass = 0, fail = 0;
  const ok = (name, cond, detail = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${detail ? ': ' + detail : ''}`); } };
  const code = (fn) => { try { fn(); return 'none'; } catch (e) { return e instanceof ArchiveError ? e.code : 'other: ' + e.message; } };
  const restore = instrument();

  const check = (name, kind, inp, props, data, events) => {
    const want = input(inp);
    for (const k in calls) delete calls[k];
    try {
      const t0 = performance.now();
      const got = kind === '7z' ? decode7z(data, props, want.length) : decodeZip(data, want.length);
      const ms = performance.now() - t0;
      if (verbose) console.log(`  ${name}: ${want.length} <- ${data.length} bytes, ${(want.length / 1048576 / (ms / 1000)).toFixed(2)} MB/s, ${JSON.stringify(calls)}`);
      const d = firstDiff(got, want);
      ok(name, d < 0, `differs at ${d} (${got.length} of ${want.length} bytes)`);
      for (const [k, min] of Object.entries(events || {})) ok(`${name} ${k}`, (calls[k] || 0) >= min, `${calls[k] || 0} calls, want >= ${min}`);
      if (kind === 'zip' && want.length <= 200000) ok(`${name} end mark`, zipEndMark(data, want.length) === -1);
    } catch (e) {
      ok(name, false, e.stack);
    }
  };

  try {
    // --- embedded fixtures ---------------------------------------------------------------------------------------
    for (const [name, kind, inp, props, data, events] of EMBEDDED) check('embedded ' + name, kind, inp, props && b64(props), b64(data), events);

    // --- fresh fixtures from 7-Zip -------------------------------------------------------------------------------
    const sz = await sevenZip();
    if (!sz) console.log('archive ppmd: 7-Zip not found, only the embedded fixtures run');
    else {
      try {
        for (const [name, kind, inp, args, events] of CASES) {
          const want = input(inp);
          const arc = sz.pack(kind, want, kind === '7z' ? [...args, ...ARGS_7Z] : args);
          if (kind === '7z') {
            const { data, props } = parse7z(arc);
            check(name, kind, inp, props, data, events);
          } else {
            const z = parseZip(arc);
            ok(name + ' is PPMd', z.method === 98 && z.usize === want.length, `method ${z.method}`);
            if (z.method === 98) check(name, kind, inp, null, z.data, events);
          }
        }
      } finally {
        sz.cleanup();
      }
    }

    // --- API and error paths -------------------------------------------------------------------------------------
    const [, , inp, props, data] = EMBEDDED.find((f) => f[1] === '7z') || [];
    if (data) {
      const p = b64(props), d = b64(data), want = input(inp);
      ok('size 0 reads nothing', ppmd7Stream({ byte() { throw new Error('read'); } }, p, { size: 0 }).read() === null);
      ok('bad order', code(() => ppmd7Stream(new Reader(bytesStream(d)), Uint8Array.of(1, 0, 0, 1, 0), { size: 1 })) === 'unsupported');
      ok('short props', code(() => ppmd7Stream(new Reader(bytesStream(d)), p.subarray(0, 4), { size: 1 })) === 'corrupt');
      ok('first byte must be 0', code(() => decode7z(Uint8Array.of(1, ...d.subarray(1)), p, want.length)) === 'corrupt');
      ok('truncated 7z', code(() => decode7z(d.subarray(0, d.length >> 1), p, want.length)) === 'truncated');
      // Without a size the stream runs to the end mark; 7-Zip writes none, so it ends with an error after the data.
      const s = ppmd7Stream(new Reader(bytesStream(d)), p, {});
      const parts = [];
      const c = code(() => { for (let b; (b = s.read(1000));) parts.push(b.slice()); });
      const got = parts.length ? Uint8Array.from(parts.flatMap((x) => [...x])) : new Uint8Array(0);
      ok('no size: data then error', c !== 'none' && !c.startsWith('other') && firstDiff(got.subarray(0, want.length), want) < 0, c);
      // The model and range decoder used directly.
      const r = new Reader(bytesStream(d));
      const rc = new RangeDecoder7z(r), m = new Ppmd7(p[1] | (p[2] << 8) | (p[3] << 16) | (p[4] << 24));
      m.init(p[0]);
      let same = true;
      for (let i = 0; i < want.length; i++) if (m.decodeSymbol(rc) !== want[i]) { same = false; break; }
      ok('Ppmd7 + RangeDecoder7z', same);
    }
    const z = EMBEDDED.find((f) => f[1] === 'zip');
    if (z) {
      const d = b64(z[4]), want = input(z[2]);
      ok('zip restore method 2', code(() => decodeZip(Uint8Array.of(d[0], (d[1] & 0x0f) | 0x20, ...d.subarray(2)), want.length)) === 'unsupported');
      ok('zip order 1', code(() => decodeZip(Uint8Array.of(d[0] & 0xf0, d[1], ...d.subarray(2)), want.length)) === 'corrupt');
      ok('truncated zip', code(() => decodeZip(d.subarray(0, d.length >> 1), want.length)) === 'truncated');
    }
    // Garbage must end in an ArchiveError or in (wrong) output, never hang or fail otherwise.
    for (let seed = 1; seed <= 20; seed++) {
      const g = GEN.random(2000, seed);
      g[0] = 0;
      const c1 = code(() => decode7z(g, Uint8Array.of(2 + (seed % 8), 0, 0, 1, 0), 50000));
      const c2 = code(() => decodeZip(g, 50000));
      ok(`garbage ${seed}`, !c1.startsWith('other') && !c2.startsWith('other'), c1 + ' / ' + c2);
    }
  } finally {
    restore();
  }

  console.log(`archive ppmd: ${pass} passed, ${fail} failed`);
  return fail;
}

// Prints the EMBEDDED list for this file (needs 7-Zip).
async function fixtures() {
  const sz = await sevenZip();
  if (!sz) throw new Error('7-Zip not found');
  const list = [
    ['7z text o6', '7z', ['text', 3000, 21], ['-m0=PPMd:o=6']],
    ['7z text o32 64k', '7z', ['text', 3000, 22], ['-m0=PPMd:o=32:mem=64k']],
    ['7z zeros o2', '7z', ['zeros', 20000], ['-m0=PPMd:o=2']],
    ['7z random o4', '7z', ['random', 300, 23], ['-m0=PPMd:o=4']],
    ['7z binary o16 64k restarts', '7z', ['binary', 12000, 24], ['-m0=PPMd:o=16:mem=64k'], { 'Ppmd7.restartModel': 3, 'Ppmd7.glueFreeBlocks': 1 }],
    ['zip text o8 cut-off method', 'zip', ['text', 2500, 25], ['-mm=PPMd', '-mo=8', '-mx=9']],
    ['zip text o2 restart method', 'zip', ['text', 2000, 26], ['-mm=PPMd', '-mo=2', '-mx=5']],
    ['zip binary o16 1m', 'zip', ['binary', 40000, 27], ['-mm=PPMd', '-mo=16', '-mmem=1m', '-mx=9'], { 'Ppmd8.glueFreeBlocks': 1 }],
  ];
  const out = [];
  try {
    for (const [name, kind, inp, args, events] of list) {
      const arc = sz.pack(kind, input(inp), kind === '7z' ? [...args, ...ARGS_7Z] : args);
      const f = kind === '7z' ? parse7z(arc) : parseZip(arc);
      const lines = toB64(f.data).match(/.{1,112}/g).map((l) => `    '${l}'`).join(' +\n');
      out.push(`  [${JSON.stringify(name)}, '${kind}', ${JSON.stringify(inp)}, ${f.props ? `'${toB64(f.props)}'` : 'null'},\n` +
        `${lines}${events ? `,\n    ${JSON.stringify(events)}` : ''}],`);
    }
  } finally {
    sz.cleanup();
  }
  console.log('const EMBEDDED = [\n' + out.join('\n') + '\n];');
}

if (isMain) {
  if (process.argv.includes('--fixtures')) await fixtures();
  else process.exitCode = (await run({ verbose: process.argv.includes('-v') })) ? 1 : 0;
}
