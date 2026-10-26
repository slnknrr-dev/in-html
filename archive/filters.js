// archive/filters.js - the reversible pre-processing filters of 7z and xz (decoding side): branch converters for
// x86 (BCJ), ARM, ARM Thumb, ARM64, RISC-V, PowerPC, SPARC and IA-64 executables, Delta, byte swapping and the four-stream
// BCJ2 decoder.
//
//   filterStream(stream, name, props) -> Stream   name: 'x86' | 'arm' | 'armt' | 'arm64' | 'riscv' | 'ppc' | 'sparc' | 'ia64' |
//                                                    'delta' | 'swap2' | 'swap4'; props: the filter properties
//                                                    (start offset for branch filters, distance - 1 for Delta)
//   bcj2Stream(main, call, jump, rc, { size }) -> Stream   (the four inputs are io.js Readers)
//   FILTERS: the converter functions conv(buf, end, ip, state) -> bytes done (exported for tests)
//
// Why branch filters exist: relative CALL / BL targets differ at every call site even when they name the same
// function, which hides repetition from LZ77. The encoder rewrites relative displacements to absolute addresses
// (ip + position + displacement), so repeated calls become identical byte strings; the decoder here subtracts the
// position again. They are pure functions of (bytes, position), hence reversible without side information, but a
// false positive (data that merely looks like an opcode) is harmless only because encoder and decoder make the
// identical decision: every test here must match the LZMA SDK / xz bit for bit, or files decode wrongly with no error.
//
// Converter contract: conv(buf, size, ip, state) converts in place and returns how many leading bytes are final;
// the rest (an instruction possibly cut by the chunk end) is offered again with more input. `ip` is the virtual
// address of buf[0] (the filter's start offset + bytes already passed), mod 2^32.

import { corrupt, fail, le32 } from './io.js';

// Bra86.c tables: `mask` holds which of the previous 3 byte positions were E8/E9 candidates; overlapping candidates
// make some positions ambiguous, and these tables (from the SDK, not derivable from first principles) encode which
// patterns are still converted and which byte of the operand must then be tested.
const MASK_ALLOWED = [true, true, true, false, true, false, false, false];
const MASK_BIT = [0, 1, 2, 2, 3, 3, 3, 3];
// The operand's high byte is 00 or FF for any displacement within +-16 MiB: real near calls; other values are taken
// as data and left alone (this is what makes false positives rare).
const test86 = (b) => b === 0 || b === 0xff;

// x86 BCJ (LZMA SDK Bra86.c, decoding). state.mask carries the "recent E8/E9" bits across calls.
function x86(data, size, ip, state) {
  if (size < 5) return 0;
  // ip + 5: x86 displacements are relative to the end of the 5-byte instruction.
  let pos = 0, prevPos = -1, mask = state.mask & 7;
  ip += 5;
  for (;;) {
    const limit = size - 4;
    while (pos < limit && (data[pos] & 0xfe) !== 0xe8) pos++;
    if (pos >= limit) break;
    const d = pos - prevPos;
    if (d > 3) mask = 0;
    else {
      mask = (mask << (d - 1)) & 7;
      if (mask !== 0) {
        const b = data[pos + 4 - MASK_BIT[mask]];
        if (!MASK_ALLOWED[mask] || test86(b)) {
          prevPos = pos;
          mask = ((mask << 1) & 7) | 1;
          pos++;
          continue;
        }
      }
    }
    prevPos = pos;
    if (test86(data[pos + 4])) {
      let src = (data[pos + 1] | (data[pos + 2] << 8) | (data[pos + 3] << 16) | (data[pos + 4] << 24)) >>> 0;
      let dest;
      for (;;) {
        dest = (src - (ip + pos)) >>> 0;
        if (mask === 0) break;
        const idx = MASK_BIT[mask] * 8;
        const b = (dest >>> (24 - idx)) & 0xff;
        if (!test86(b)) break;
        src = (dest ^ ((2 ** (32 - idx)) - 1)) >>> 0;
      }
      // Bit 24 of the result is sign-extended into the whole high byte (00 or FF), keeping the +-16 MiB invariant.
      data[pos + 4] = ~(((dest >>> 24) & 1) - 1) & 0xff;
      data[pos + 3] = dest >>> 16;
      data[pos + 2] = dest >>> 8;
      data[pos + 1] = dest;
      pos += 5;
    } else {
      mask = ((mask << 1) & 7) | 1;
      pos++;
    }
  }
  const d = pos - prevPos;
  state.mask = d > 3 ? 0 : (mask << (d - 1)) & 7;
  return pos;
}

// ARM BL (condition AL): little-endian word with top byte 0xEB, 24-bit word offset; PC reads 8 bytes ahead.
function arm(data, size, ip) {
  if (size < 4) return 0;
  let i = 0;
  ip += 8;
  for (; i <= size - 4; i += 4) {
    if (data[i + 3] === 0xeb) {
      const src = ((data[i + 2] << 16) | (data[i + 1] << 8) | data[i]) << 2;
      const dest = ((src - (ip + i)) >>> 2) & 0xffffff;
      data[i + 2] = dest >>> 16; data[i + 1] = dest >>> 8; data[i] = dest;
    }
  }
  return i;
}

// Thumb BL: a 32-bit pair of halfwords 11110 hi11 / 11111 lo11 (22-bit halfword offset), 2-byte aligned, PC + 4.
// After a conversion the second halfword is skipped (i += 2 extra) so it cannot start another match.
function armt(data, size, ip) {
  if (size < 4) return 0;
  let i = 0;
  ip += 4;
  for (; i <= size - 4; i += 2) {
    if ((data[i + 1] & 0xf8) === 0xf0 && (data[i + 3] & 0xf8) === 0xf8) {
      const src = (((data[i + 1] & 7) << 19) | (data[i] << 11) | ((data[i + 3] & 7) << 8) | data[i + 2]) << 1;
      const dest = (src - (ip + i)) >>> 1;
      data[i + 1] = 0xf0 | ((dest >>> 19) & 7);
      data[i] = dest >>> 11;
      data[i + 3] = 0xf8 | ((dest >>> 8) & 7);
      data[i + 2] = dest;
      i += 2;
    }
  }
  return i;
}

// PowerPC `bl` (big-endian): primary opcode 18 (top 6 bits 010010 -> 0x48..0x4B), AA = 0, LK = 1; 24-bit word offset.
function ppc(data, size, ip) {
  if (size < 4) return 0;
  let i = 0;
  for (; i <= size - 4; i += 4) {
    if ((data[i] >> 2) === 0x12 && (data[i + 3] & 3) === 1) {
      const src = ((data[i] & 3) << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | (data[i + 3] & ~3);
      const dest = (src - (ip + i)) >>> 0;
      data[i] = 0x48 | ((dest >>> 24) & 3);
      data[i + 1] = dest >>> 16;
      data[i + 2] = dest >>> 8;
      data[i + 3] = (data[i + 3] & 3) | (dest & 0xfc);
    }
  }
  return i;
}

// SPARC CALL (big-endian, op = 01): 30-bit word displacement. Only displacements whose top bits are a pure sign
// extension (0x40 00.. or 0x7F C0..: within +-8 MiB) are converted, the same near-call heuristic as test86.
function sparc(data, size, ip) {
  if (size < 4) return 0;
  let i = 0;
  for (; i <= size - 4; i += 4) {
    if ((data[i] === 0x40 && (data[i + 1] & 0xc0) === 0) || (data[i] === 0x7f && (data[i + 1] & 0xc0) === 0xc0)) {
      const src = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) << 2;
      let dest = (src - (ip + i)) >>> 2;
      dest = (((0 - ((dest >>> 22) & 1)) << 22) & 0x3fffffff) | (dest & 0x3fffff) | 0x40000000;
      data[i] = dest >>> 24; data[i + 1] = dest >>> 16; data[i + 2] = dest >>> 8; data[i + 3] = dest;
    }
  }
  return i;
}

// IA-64: 128-bit bundles = 5-bit template + three 41-bit slots. The table maps a template to a bitmask of the slots
// that are B-unit (branch) slots. Slots straddle byte boundaries and are 41 bits wide, beyond the 53-bit exact range
// once shifted, hence BigInt: slow, but IA-64 binaries are rare and the cost is confined to this filter.
const IA64_BRANCH = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 6, 6, 0, 0, 7, 7, 4, 4, 0, 0, 4, 4, 0, 0];
function ia64(data, size, ip) {
  if (size < 16) return 0;
  let i = 0;
  for (; i <= size - 16; i += 16) {
    const mask = IA64_BRANCH[data[i] & 0x1f];
    for (let slot = 0, bitPos = 5; slot < 3; slot++, bitPos += 41) {
      if (((mask >> slot) & 1) === 0) continue;
      const bytePos = bitPos >> 3, bitRes = BigInt(bitPos & 7);
      let inst = 0n;
      for (let j = 0; j < 6; j++) inst |= BigInt(data[i + j + bytePos]) << BigInt(8 * j);
      let norm = inst >> bitRes;
      if (((norm >> 37n) & 0xfn) === 0x5n && ((norm >> 9n) & 0x7n) === 0n) {
        let src = Number((norm >> 13n) & 0xfffffn);
        src |= Number((norm >> 36n) & 1n) << 20;
        src <<= 4;
        const dest = ((src - (ip + i)) >>> 4) >>> 0;
        norm &= ~(0x8fffffn << 13n);
        norm |= BigInt(dest & 0xfffff) << 13n;
        norm |= BigInt(dest & 0x100000) << (36n - 20n);
        inst &= (1n << bitRes) - 1n;
        inst |= norm << bitRes;
        for (let j = 0; j < 6; j++) data[i + j + bytePos] = Number((inst >> BigInt(8 * j)) & 0xffn);
      }
    }
  }
  return i;
}

// ARM64 (7-Zip 23+, xz 5.4 filter 0x0A): BL instructions and ADRP pages, 4-byte aligned little-endian words.
// BL (100101 imm26): word offset converted to absolute. ADRP: the 21-bit page immediate (immlo bits 29-30, immhi
// bits 5-23) is converted only when its high bits are a pure sign extension (the flag / mask test), so random data rarely
// matches; the pc is taken in 4 KiB pages (pc >>> 12, scaled by 8 to line up with the shuffled field layout).
function arm64(data, size, ip) {
  const end = size & ~3;
  const flag = 1 << 20, mask = (1 << 24) - (flag << 1);
  for (let i = 0; i < end; i += 4) {
    let v = (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)) >>> 0;
    const pc = (ip + i) >>> 0;
    if ((((v - 0x94000000) >>> 0) & 0xfc000000) === 0) {
      const c = pc >>> 2;
      v = ((((v - c) >>> 0) & 0x03ffffff) | 0x94000000) >>> 0;
    } else {
      v = (v - 0x90000000) >>> 0;
      if ((v & 0x9f000000) !== 0) continue;
      v = (v + flag) >>> 0;
      if (v & mask) continue;
      let z = ((v & 0xffffffe0) | (v >>> 26)) >>> 0;
      const c = ((pc >>> (12 - 3)) & ~7) >>> 0;
      z = (z - c) >>> 0;
      v &= 0x1f;
      v |= 0x90000000;
      v |= z << 26;
      v |= 0x00ffffe0 & ((z & ((flag << 1) - 1)) - flag);
      v >>>= 0;
    }
    data[i] = v; data[i + 1] = v >>> 8; data[i + 2] = v >>> 16; data[i + 3] = v >>> 24;
  }
  return end;
}

// RISC-V (xz 5.6 / 7-Zip 24, filter id 0x0B): JAL with rd x1 / x5, and AUIPC + I/S-type pairs. Instructions are
// 2-byte aligned (compressed extension), so the scan steps by 2. Encoded pairs keep
// the absolute address big-endian in the second word and mark the first with rd = x2; "fake" pairs protect original
// AUIPC rd = x2 instructions that would look like an encoded pair.
const rd32 = (d, i) => (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24)) >>> 0;
const wr32 = (d, i, v) => { d[i] = v; d[i + 1] = v >>> 8; d[i + 2] = v >>> 16; d[i + 3] = v >>> 24; };
function riscv(data, size, ip) {
  if (size < 8) return 0;
  const lim = size - 8;
  let i = 0;
  for (; i <= lim; i += 2) {
    let inst = data[i];
    if (inst === 0xef) {
      const b1 = data[i + 1];
      if (b1 & 0x0d) continue;
      const b2 = data[i + 2], b3 = data[i + 3];
      let addr = ((b1 & 0xf0) << 13) | (b2 << 9) | (b3 << 1);
      addr = (addr - ((ip + i) >>> 0)) >>> 0;
      data[i + 1] = (b1 & 0x0f) | ((addr >>> 8) & 0xf0);
      data[i + 2] = ((addr >>> 16) & 0x0f) | ((addr >>> 7) & 0x10) | ((addr << 4) & 0xe0);
      data[i + 3] = ((addr >>> 4) & 0x7f) | ((addr >>> 13) & 0x80);
      i += 2;
      continue;
    }
    if ((inst & 0x7f) !== 0x17) continue;
    inst = rd32(data, i);
    let inst2;
    if (inst & 0xe80) {
      // rd is neither x0 nor x2: a "fake" pair when it looks like an encoded one
      inst2 = rd32(data, i + 4);
      if ((((inst << 8) ^ (inst2 - 3)) & 0xf8003) !== 0) { i += 4; continue; }
      const n = ((inst & 0xfffff000) | (inst2 >>> 20)) >>> 0;
      inst = (0x117 | (inst2 << 12)) >>> 0;
      inst2 = n;
    } else {
      // rd is x0 or x2: an encoded "real" pair, second word = absolute address (big-endian)
      const rs1 = inst >>> 27;
      if ((((inst - 0x3117) << 18) >>> 0) >= (rs1 & 0x1d)) { i += 2; continue; }
      let addr = ((data[i + 4] << 24) | (data[i + 5] << 16) | (data[i + 6] << 8) | data[i + 7]) >>> 0;
      addr = (addr - ((ip + i) >>> 0)) >>> 0;
      inst2 = ((inst >>> 12) | (addr << 20)) >>> 0;
      inst = (0x17 | (rs1 << 7) | ((addr + 0x800) & 0xfffff000)) >>> 0;
    }
    wr32(data, i, inst);
    wr32(data, i + 4, inst2);
    i += 6;
  }
  return i;
}

function swap2(data, size) { const n = size & ~1; for (let i = 0; i < n; i += 2) { const t = data[i]; data[i] = data[i + 1]; data[i + 1] = t; } return n; }
function swap4(data, size) {
  const n = size & ~3;
  for (let i = 0; i < n; i += 4) { let t = data[i]; data[i] = data[i + 3]; data[i + 3] = t; t = data[i + 1]; data[i + 1] = data[i + 2]; data[i + 2] = t; }
  return n;
}

export const FILTERS = { x86, arm, armt, arm64, riscv, ppc, sparc, ia64, swap2, swap4 };

/**
 * Applies a converter to a stream: input is buffered until a converter can decide, the tail passes unchanged.
 * `keep` bytes (an instruction possibly split by the chunk boundary) are moved to the front and re-examined with the
 * next chunk; at the end of input they cannot hold a whole instruction and are returned as they are, which is what
 * the encoder did too. `state` carries the x86 mask between calls (the other converters are stateless).
 */
function convStream(stream, conv, ip0) {
  let buf = new Uint8Array(1 << 16), len = 0, keep = 0, ip = ip0, done = false;
  const state = { mask: 0 };
  return {
    size: stream.size,
    read(max) {
      for (;;) {
        if (keep) { buf.copyWithin(0, len - keep, len); len = keep; keep = 0; } else if (!done) len = 0;
        if (done) {
          if (!len) return null;
          const r = buf.subarray(0, len);
          len = 0;
          return r;
        }
        const c = stream.read(max);
        if (!c) { done = true; continue; }
        if (len + c.length > buf.length) { const nb = new Uint8Array(len + c.length + 4096); nb.set(buf.subarray(0, len)); buf = nb; }
        buf.set(c, len);
        len += c.length;
        const n = conv(buf, len, ip, state);
        keep = len - n;
        ip = (ip + n) >>> 0;
        if (n > 0) return buf.subarray(0, n);
      }
    },
  };
}

// Delta: out[i] = in[i] + out[i - dist] (mod 256), dist 1..256. A 256-byte ring of previous output covers every
// distance and survives chunk boundaries. slice(): the input view belongs to the upstream stream, never write into it.
function deltaStream(stream, dist) {
  const hist = new Uint8Array(256);
  let hp = 0;
  return {
    size: stream.size,
    read(max) {
      const c = stream.read(max);
      if (!c) return null;
      const out = c.slice();
      for (let i = 0; i < out.length; i++) {
        const v = (out[i] + hist[(hp - dist) & 255]) & 255;
        out[i] = v;
        hist[hp] = v;
        hp = (hp + 1) & 255;
      }
      return out;
    },
  };
}

export function filterStream(stream, name, props) {
  if (name === 'delta') {
    const dist = (props && props.length ? props[0] : 0) + 1;
    return deltaStream(stream, dist);
  }
  const conv = FILTERS[name];
  if (!conv) fail('unsupported', 'not supported: filter ' + name);
  const start = props && props.length >= 4 ? le32(props, 0) : 0;
  return convStream(stream, conv, start);
}

/**
 * BCJ2 (7z method 03 03 01 1B): main stream, CALL and JUMP targets (big-endian) and the range-coded decisions.
 * Unlike BCJ, the encoder moves converted absolute targets out of the code into separate CALL / JUMP streams (which
 * compress well together) and codes the per-opcode "converted or not" choice with an adaptive binary range coder
 * (same arithmetic as LZMA: 11-bit probabilities, shift 5). Contexts: 256 for E8 keyed by the preceding byte, one for
 * E9, one for Jcc (0F 80..8F). Since the decision is transmitted, BCJ2 needs no heuristic and converts every real call.
 */
export function bcj2Stream(main, call, jump, rc, { size } = {}) {
  const prob = new Uint16Array(258).fill(1024);
  let range = 0xffffffff, code = 0, started = false, prev = 0, total = 0, over = 0;
  const pend = new Uint8Array(4);
  let pn = 0, pp = 0;
  const rcByte = () => { const b = rc.byte(); if (b < 0) { over++; return 0; } return b; };
  const be = (r) => {
    let v = 0;
    for (let i = 0; i < 4; i++) { const b = r.byte(); if (b < 0) fail('truncated', 'unexpected end of a BCJ2 stream'); v = v * 256 + b; }
    return v;
  };
  let out = null;
  return {
    size,
    read(max = 1 << 16) {
      // Range coder init: 5 bytes (the first is the encoder's 0 cache byte); % 2^32 keeps code in 32 bits.
      if (!started) { started = true; for (let i = 0; i < 5; i++) code = (code * 256 + rcByte()) % 4294967296; }
      if (!out || out.length < max) out = new Uint8Array(Math.max(16, max));
      let n = 0;
      const cap = size != null ? Math.min(max, size - total) : max;
      while (n < cap) {
        if (pp < pn) { out[n++] = pend[pp++]; total++; continue; }
        const b = main.byte();
        if (b < 0) break;
        out[n++] = b; total++;
        if ((b & 0xfe) !== 0xe8 && !(prev === 0x0f && (b & 0xf0) === 0x80)) { prev = b; continue; }
        const i = b === 0xe8 ? prev : b === 0xe9 ? 256 : 257;
        const p = prob[i];
        const bound = (range >>> 11) * p;
        let taken;
        if (code < bound) { range = bound; prob[i] = p + ((2048 - p) >> 5); taken = false; }
        else { range -= bound; code -= bound; prob[i] = p - (p >> 5); taken = true; }
        if (range < 16777216) { range *= 256; code = code * 256 + rcByte(); }
        if (!taken) { prev = b; continue; }
        const src = be(b === 0xe8 ? call : jump);
        // total = output position just after the opcode; the displacement is relative to the end of the 4-byte
        // operand. The operand bytes go through `pend` so a read() may stop in the middle of them.
        const dest = (src - (total + 4)) >>> 0;
        pend[0] = dest; pend[1] = dest >>> 8; pend[2] = dest >>> 16; pend[3] = dest >>> 24;
        pn = 4; pp = 0;
        prev = dest >>> 24;
      }
      // One zero byte beyond the rc stream is tolerated (a final normalisation may look ahead); more means truncation.
      if (over > 1) corrupt('BCJ2 range coder');
      if (n === 0) {
        if (size != null && total < size) fail('truncated', 'unexpected end of a BCJ2 stream');
        return null;
      }
      return out.subarray(0, n);
    },
  };
}
