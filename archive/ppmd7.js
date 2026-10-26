// archive/ppmd7.js - PPMd variant H (Dmitry Shkarin's PPMd var.H as 7-Zip's Ppmd7.c implements it): the context
// model with its sub-allocator, the two range decoders that drive it (7z and RAR 3.x) and the 7z method 03 04 01.
//
//   new Ppmd7(memSize)            allocates the model memory (memSize bytes plus one guard unit, one ArrayBuffer)
//     .init(maxOrder)             restarts the model (RestartModel; maxOrder 2..64)
//     .decodeSymbol(rc) -> 0..255, or -1 for the escape out of the order-0 context (the end mark);
//                                  throws ArchiveError 'corrupt' when the coded value lies outside every interval
//     .decodeInto(rc, out, n) -> n, or ~count when the end mark followed `count` symbols (bulk decoding)
//   new RangeDecoder7z(reader)    7-Zip's coder: a zero byte, then 4 code bytes; Range = 0xFFFFFFFF
//   new RangeDecoderRar(reader, strict = false)   RAR 3.x / Shkarin's carry-less coder (also PPMd var.I's): 4 code
//                                  bytes; Low, Code, Range, TOP 2^24, BOT 2^15. Past the input it reads zeros and
//                                  counts them in `extra`, or with `strict` throws 'truncated'
//   Range decoder interface (identical for both, used by decodeSymbol):
//     getThreshold(total) -> n     Range /= total; returns Code / Range (n >= total only on corrupt data)
//     decode(start, size)          takes the interval [start, start + size) in units of the Range set by getThreshold
//     decodeBit(size0, total) -> 0 | 1   binary decision, 0 with probability size0 / total
//   ppmd7Stream(reader, props, { size }) -> Stream   props: 5 bytes (order, memory size uint32 LE); decodes `size`
//     bytes when given, else up to the end mark
//   MAX_MEM: largest memory size accepted (just under 2 GiB; larger sizes throw 'limit')
//
// Memory layout follows Ppmd7.c byte for byte, because when the model runs out of memory (and restarts) depends on
// the exact fragmentation of the allocator: offsets into one buffer replace pointers (0 = null). 12-byte units:
//   context  NumStats u16 @0, SummFreq u16 @2, Stats u32 @4, Suffix u32 @8 (a one-symbol context keeps its state in
//            place at @2: Symbol, Freq, Successor)
//   state    Symbol u8 @0, Freq u8 @1, Successor u16+u16 @2 (6 bytes, so only 2-aligned)
//   free     Stamp u16 @0, NU u16 @2, Next u32 @4, Prev u32 @8 (while gluing; in a free list @0 holds the link)

import { corrupt, fail, le32, unsupported } from './io.js';

const UNIT = 12, N_INDEXES = 38, MAX_FREQ = 124, BIN_SCALE = 1 << 14, PERIOD_BITS = 7, MAX_ORDER = 64;
const EXP_ESCAPE = Uint8Array.of(25, 14, 9, 7, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2, 2);
const INIT_BIN_ESC = [0x3cdd, 0x1f3f, 0x59bf, 0x48f3, 0x64a1, 0x5abc, 0x6632, 0x6051];
const DUMMY_SEE = 25 * 16;
export const MAX_MEM = 0x7fffff00;

// Units per size class: 1, 2, 3, 4, 6, 8, 10, 12, 15, 18, 21, 24, 28, 32, … 128.
const I2U = new Uint8Array(N_INDEXES), U2I = new Uint8Array(128);
for (let i = 0, k = 0; i < N_INDEXES; i++) {
  let step = i >= 12 ? 4 : (i >> 2) + 1;
  do U2I[k++] = i; while (--step);
  I2U[i] = k;
}
const NS2BSINDX = new Uint8Array(256), NS2INDX = new Uint8Array(256), HB2FLAG = new Uint8Array(256);
NS2BSINDX[1] = 2;
NS2BSINDX.fill(4, 2, 11);
NS2BSINDX.fill(6, 11);
for (let i = 0; i < 3; i++) NS2INDX[i] = i;
for (let i = 3, m = 3, k = 1; i < 256; i++) {
  NS2INDX[i] = m;
  if (--k === 0) k = ++m - 2;
}
HB2FLAG.fill(8, 0x40);

export class Ppmd7 {
  constructor(memSize) {
    if (!(memSize >= 1 << 11 && memSize <= 0xffffffff - 36)) unsupported('PPMd memory size ' + memSize);
    // Offsets stay below 2^31 so that they are int32 (Int32Array loads keep the JIT on integer paths).
    if (memSize > MAX_MEM) fail('limit', `PPMd memory size ${memSize} is above ${MAX_MEM} bytes`);
    this.size = memSize;
    this.align = 4 - (memSize & 3);
    let buf;
    try { buf = new ArrayBuffer(this.align + memSize + UNIT); } catch { fail('limit', `cannot allocate ${memSize} bytes for PPMd`); }
    this.m8 = new Uint8Array(buf);
    this.m16 = new Uint16Array(buf);
    this.m32 = new Int32Array(buf);
    this.freeList = new Int32Array(N_INDEXES);
    this.binSumm = new Uint16Array(128 * 64);
    this.seeSumm = new Uint16Array(DUMMY_SEE + 1);
    this.seeShift = new Uint8Array(DUMMY_SEE + 1);
    this.seeCount = new Uint8Array(DUMMY_SEE + 1);
    this.mask = new Uint8Array(256); // 1 = symbol not yet seen in a higher order (reset on the first escape)
    this.ps = new Int32Array(256);
    this.ps2 = new Int32Array(MAX_ORDER);
    this.minContext = this.maxContext = this.foundState = 0;
    this.orderFall = this.initEsc = this.prevSuccess = this.maxOrder = this.hiBitsFlag = 0;
    this.runLength = this.initRL = 0;
    this.glueCount = this.loUnit = this.hiUnit = this.text = this.unitsStart = 0;
  }

  init(maxOrder) {
    if (!(maxOrder >= 2 && maxOrder <= MAX_ORDER)) unsupported('PPMd order ' + maxOrder);
    this.maxOrder = maxOrder;
    this.restartModel();
    this.seeShift[DUMMY_SEE] = PERIOD_BITS;
    this.seeSumm[DUMMY_SEE] = 0;
    this.seeCount[DUMMY_SEE] = 64;
  }

  // --- sub-allocator ---------------------------------------------------------------------------------------------

  succ(s) { const m = this.m16, i = (s + 2) >> 1; return m[i] | (m[i + 1] << 16); }
  setSucc(s, v) { const m = this.m16, i = (s + 2) >> 1; m[i] = v & 0xffff; m[i + 1] = v >>> 16; }
  copyState(d, s) { const m = this.m16; d >>= 1; s >>= 1; m[d] = m[s]; m[d + 1] = m[s + 1]; m[d + 2] = m[s + 2]; }
  swapStates(a, b) {
    const m = this.m16;
    a >>= 1; b >>= 1;
    for (let i = 0; i < 3; i++) { const t = m[a + i]; m[a + i] = m[b + i]; m[b + i] = t; }
  }

  insertNode(node, indx) { this.m32[node >> 2] = this.freeList[indx]; this.freeList[indx] = node; }
  removeNode(indx) { const node = this.freeList[indx]; this.freeList[indx] = this.m32[node >> 2]; return node; }

  splitBlock(ptr, oldIndx, newIndx) {
    const nu = I2U[oldIndx] - I2U[newIndx];
    ptr += I2U[newIndx] * UNIT;
    let i = U2I[nu - 1];
    if (I2U[i] !== nu) {
      const k = I2U[--i];
      this.insertNode(ptr + k * UNIT, nu - k - 1);
    }
    this.insertNode(ptr, i);
  }

  // Merges adjacent free blocks: a doubly-linked list of all free blocks (in the order of Ppmd7.c, which decides
  // the fragmentation), a guard node after the memory end and one at LoUnit, then refills the free lists.
  glueFreeBlocks() {
    const m16 = this.m16, m32 = this.m32, fl = this.freeList;
    const head = this.align + this.size;
    let n = head;
    this.glueCount = 255;
    for (let i = 0; i < N_INDEXES; i++) {
      const nu = I2U[i];
      let next = fl[i];
      fl[i] = 0;
      while (next !== 0) {
        const node = next;
        m32[(node >> 2) + 1] = n;
        m32[(n >> 2) + 2] = node;
        n = node;
        next = m32[node >> 2];
        m16[node >> 1] = 0;
        m16[(node >> 1) + 1] = nu;
      }
    }
    m16[head >> 1] = 1;
    m32[(head >> 2) + 1] = n;
    m32[(n >> 2) + 2] = head;
    if (this.loUnit !== this.hiUnit) m16[this.loUnit >> 1] = 1;

    while (n !== head) {
      const node = n;
      let nu = m16[(node >> 1) + 1];
      for (;;) {
        const node2 = node + nu * UNIT;
        nu += m16[(node2 >> 1) + 1];
        if (m16[node2 >> 1] !== 0 || nu >= 0x10000) break;
        const prev = m32[(node2 >> 2) + 2], next = m32[(node2 >> 2) + 1];
        m32[(prev >> 2) + 1] = next;
        m32[(next >> 2) + 2] = prev;
        m16[(node >> 1) + 1] = nu;
      }
      n = m32[(node >> 2) + 1];
    }

    for (n = m32[(head >> 2) + 1]; n !== head;) {
      let node = n;
      const next = m32[(node >> 2) + 1];
      let nu = m16[(node >> 1) + 1];
      for (; nu > 128; nu -= 128, node += 128 * UNIT) this.insertNode(node, N_INDEXES - 1);
      let i = U2I[nu - 1];
      if (I2U[i] !== nu) {
        const k = I2U[--i];
        this.insertNode(node + k * UNIT, nu - k - 1);
      }
      this.insertNode(node, i);
      n = next;
    }
  }

  allocUnitsRare(indx) {
    if (this.glueCount === 0) {
      this.glueFreeBlocks();
      if (this.freeList[indx] !== 0) return this.removeNode(indx);
    }
    let i = indx;
    do {
      if (++i === N_INDEXES) {
        const numBytes = I2U[indx] * UNIT;
        this.glueCount--;
        return this.unitsStart - this.text > numBytes ? (this.unitsStart -= numBytes) : 0;
      }
    } while (this.freeList[i] === 0);
    const block = this.removeNode(i);
    this.splitBlock(block, i, indx);
    return block;
  }

  allocUnits(indx) {
    if (this.freeList[indx] !== 0) return this.removeNode(indx);
    const numBytes = I2U[indx] * UNIT;
    if (numBytes <= this.hiUnit - this.loUnit) {
      const r = this.loUnit;
      this.loUnit += numBytes;
      return r;
    }
    return this.allocUnitsRare(indx);
  }

  shrinkUnits(oldPtr, oldNU, newNU) {
    const i0 = U2I[oldNU - 1], i1 = U2I[newNU - 1];
    if (i0 === i1) return oldPtr;
    if (this.freeList[i1] !== 0) {
      const ptr = this.removeNode(i1);
      this.m32.copyWithin(ptr >> 2, oldPtr >> 2, (oldPtr >> 2) + 3 * newNU);
      this.insertNode(oldPtr, i0);
      return ptr;
    }
    this.splitBlock(oldPtr, i0, i1);
    return oldPtr;
  }

  // --- model -----------------------------------------------------------------------------------------------------

  restartModel() {
    const m8 = this.m8, m16 = this.m16, m32 = this.m32;
    this.freeList.fill(0);
    this.text = this.align;
    this.hiUnit = this.text + this.size;
    this.loUnit = this.unitsStart = this.hiUnit - Math.floor(this.size / 8 / UNIT) * 7 * UNIT;
    this.glueCount = 0;
    this.orderFall = this.maxOrder;
    this.runLength = this.initRL = -(this.maxOrder < 12 ? this.maxOrder : 12) - 1;
    this.prevSuccess = 0;

    const mc = (this.hiUnit -= UNIT);
    this.minContext = this.maxContext = mc;
    m32[(mc >> 2) + 2] = 0;
    m16[mc >> 1] = 256;
    m16[(mc >> 1) + 1] = 256 + 1;
    const st = this.loUnit;
    this.foundState = st;
    this.loUnit += 128 * UNIT;
    m32[(mc >> 2) + 1] = st;
    for (let i = 0; i < 256; i++) {
      const s = st + i * 6;
      m8[s] = i;
      m8[s + 1] = 1;
      m16[(s + 2) >> 1] = 0;
      m16[(s + 4) >> 1] = 0;
    }
    const bs = this.binSumm;
    for (let i = 0; i < 128; i++) {
      for (let k = 0; k < 8; k++) {
        const val = BIN_SCALE - Math.floor(INIT_BIN_ESC[k] / (i + 2));
        for (let m = 0; m < 64; m += 8) bs[i * 64 + k + m] = val;
      }
    }
    for (let i = 0; i < 25; i++) {
      for (let k = 0; k < 16; k++) {
        this.seeShift[i * 16 + k] = PERIOD_BITS - 4;
        this.seeSumm[i * 16 + k] = (5 * i + 10) << (PERIOD_BITS - 4);
        this.seeCount[i * 16 + k] = 4;
      }
    }
  }

  createSuccessors(skip) {
    const m8 = this.m8, m16 = this.m16, m32 = this.m32, ps = this.ps2;
    let c = this.minContext;
    const fs = this.foundState, fSym = m8[fs];
    const upBranch = this.succ(fs);
    let numPs = 0;
    if (!skip) ps[numPs++] = fs;
    while (m32[(c >> 2) + 2] !== 0) {
      c = m32[(c >> 2) + 2];
      let s;
      if (m16[c >> 1] !== 1) {
        s = m32[(c >> 2) + 1];
        while (m8[s] !== fSym) s += 6;
      } else s = c + 2;
      const successor = this.succ(s);
      if (successor !== upBranch) {
        c = successor;
        if (numPs === 0) return c;
        break;
      }
      ps[numPs++] = s;
    }

    const upSym = m8[upBranch], upSucc = upBranch + 1;
    let upFreq;
    if (m16[c >> 1] === 1) upFreq = m8[c + 3];
    else {
      let s = m32[(c >> 2) + 1];
      while (m8[s] !== upSym) s += 6;
      const cf = m8[s + 1] - 1;
      const s0 = (m16[(c >> 1) + 1] - m16[c >> 1] - cf) >>> 0;
      upFreq = 1 + (2 * cf <= s0 ? +(5 * cf > s0) : Math.floor((2 * cf + 3 * s0 - 1) / (2 * s0)));
    }

    do {
      let c1;
      if (this.hiUnit !== this.loUnit) c1 = this.hiUnit -= UNIT;
      else if (this.freeList[0] !== 0) c1 = this.removeNode(0);
      else {
        c1 = this.allocUnitsRare(0);
        if (!c1) return 0;
      }
      m16[c1 >> 1] = 1;
      m8[c1 + 2] = upSym;
      m8[c1 + 3] = upFreq;
      m32[(c1 >> 2) + 1] = upSucc;
      m32[(c1 >> 2) + 2] = c;
      this.setSucc(ps[--numPs], c1);
      c = c1;
    } while (numPs !== 0);
    return c;
  }

  updateModel() {
    const m8 = this.m8, m16 = this.m16, m32 = this.m32;
    const fs = this.foundState, fSym = m8[fs], fFreq = m8[fs + 1];
    let fSuccessor = this.succ(fs);
    const mc = this.minContext;

    if (fFreq < MAX_FREQ / 4 && m32[(mc >> 2) + 2] !== 0) {
      const c = m32[(mc >> 2) + 2];
      if (m16[c >> 1] === 1) {
        if (m8[c + 3] < 32) m8[c + 3]++;
      } else {
        let s = m32[(c >> 2) + 1];
        if (m8[s] !== fSym) {
          do s += 6; while (m8[s] !== fSym);
          if (m8[s + 1] >= m8[s - 5]) {
            this.swapStates(s, s - 6);
            s -= 6;
          }
        }
        if (m8[s + 1] < MAX_FREQ - 9) {
          m8[s + 1] += 2;
          m16[(c >> 1) + 1] += 2;
        }
      }
    }

    if (this.orderFall === 0) {
      const cs = this.createSuccessors(true);
      this.minContext = this.maxContext = cs;
      if (!cs) { this.restartModel(); return; }
      this.setSucc(this.foundState, cs);
      return;
    }

    m8[this.text++] = fSym;
    let successor = this.text;
    if (this.text >= this.unitsStart) { this.restartModel(); return; }

    if (fSuccessor) {
      if (fSuccessor <= successor) { // a raw successor (into the text): the context does not exist yet
        const cs = this.createSuccessors(false);
        if (!cs) { this.restartModel(); return; }
        fSuccessor = cs;
      }
      if (--this.orderFall === 0) {
        successor = fSuccessor;
        if (this.maxContext !== this.minContext) this.text--;
      }
    } else {
      this.setSucc(fs, successor);
      fSuccessor = this.minContext;
    }

    const ns = m16[mc >> 1];
    const s0 = m16[(mc >> 1) + 1] - ns - (fFreq - 1);

    for (let c = this.maxContext; c !== mc; c = m32[(c >> 2) + 2]) {
      const ns1 = m16[c >> 1];
      const sfi = (c >> 1) + 1;
      if (ns1 !== 1) {
        if ((ns1 & 1) === 0) {
          const oldNU = ns1 >> 1, i = U2I[oldNU - 1];
          if (i !== U2I[oldNU]) {
            const ptr = this.allocUnits(i + 1);
            if (!ptr) { this.restartModel(); return; }
            const oldPtr = m32[(c >> 2) + 1];
            m32.copyWithin(ptr >> 2, oldPtr >> 2, (oldPtr >> 2) + 3 * oldNU);
            this.insertNode(oldPtr, i);
            m32[(c >> 2) + 1] = ptr;
          }
        }
        const sf0 = m16[sfi];
        m16[sfi] = sf0 + (2 * ns1 < ns) + 2 * ((4 * ns1 <= ns) & (sf0 <= 8 * ns1));
      } else {
        const s = this.allocUnits(0);
        if (!s) { this.restartModel(); return; }
        this.copyState(s, c + 2);
        m32[(c >> 2) + 1] = s;
        const f = m8[s + 1] < MAX_FREQ / 4 - 1 ? m8[s + 1] << 1 : MAX_FREQ - 4;
        m8[s + 1] = f;
        m16[sfi] = f + this.initEsc + (ns > 3);
      }
      let cf = 2 * fFreq * (m16[sfi] + 6);
      const sf = s0 + m16[sfi];
      if (cf < 6 * sf) {
        cf = 1 + (cf > sf) + (cf >= 4 * sf);
        m16[sfi] += 3;
      } else {
        cf = 4 + (cf >= 9 * sf) + (cf >= 12 * sf) + (cf >= 15 * sf);
        m16[sfi] += cf;
      }
      const s = m32[(c >> 2) + 1] + ns1 * 6;
      this.setSucc(s, successor);
      m8[s] = fSym;
      m8[s + 1] = cf;
      m16[c >> 1] = ns1 + 1;
    }
    this.maxContext = this.minContext = fSuccessor;
  }

  // Frequencies are 8-bit (MAX_FREQ 124): when one would overflow, all counts of the context are halved (rounding so
  // seen symbols stay >= 1, zero-count ones are dropped). Halving also ages the statistics, so the model adapts to
  // changing data, an exponential forgetting that a pure counter would lack.
  rescale() {
    const m8 = this.m8, m16 = this.m16, m32 = this.m32, mc = this.minContext;
    const stats = m32[(mc >> 2) + 1];
    let s = this.foundState;
    if (s !== stats) { // move the found state to the front
      const a = m16[s >> 1], b = m16[(s >> 1) + 1], c = m16[(s >> 1) + 2];
      m16.copyWithin((stats >> 1) + 3, stats >> 1, s >> 1);
      m16[stats >> 1] = a; m16[(stats >> 1) + 1] = b; m16[(stats >> 1) + 2] = c;
      s = stats;
    }
    let escFreq = m16[(mc >> 1) + 1] - m8[s + 1];
    const adder = this.orderFall !== 0 ? 1 : 0;
    m8[s + 1] = (m8[s + 1] + 4 + adder) >> 1;
    let sumFreq = m8[s + 1];
    let i = m16[mc >> 1] - 1;
    do {
      s += 6;
      escFreq -= m8[s + 1];
      const f = (m8[s + 1] + adder) >> 1;
      m8[s + 1] = f;
      sumFreq += f;
      if (f > m8[s - 5]) { // insertion: keep the states sorted by frequency
        const a = m16[s >> 1], b = m16[(s >> 1) + 1], c = m16[(s >> 1) + 2];
        let s1 = s;
        do s1 -= 6; while (s1 !== stats && f > m8[s1 - 5]);
        m16.copyWithin((s1 >> 1) + 3, s1 >> 1, s >> 1);
        m16[s1 >> 1] = a; m16[(s1 >> 1) + 1] = b; m16[(s1 >> 1) + 2] = c;
      }
    } while (--i);

    if (m8[s + 1] === 0) {
      const numStats = m16[mc >> 1];
      i = 0;
      do { i++; s -= 6; } while (m8[s + 1] === 0);
      escFreq += i;
      const ns = numStats - i;
      m16[mc >> 1] = ns;
      if (ns === 1) {
        const sym = m8[stats], succ = this.succ(stats);
        let freq = m8[stats + 1];
        do { freq -= freq >> 1; escFreq >>>= 1; } while (escFreq > 1);
        this.insertNode(stats, U2I[((numStats + 1) >> 1) - 1]);
        const os = mc + 2;
        m8[os] = sym;
        m8[os + 1] = freq;
        this.setSucc(os, succ);
        this.foundState = os;
        return;
      }
      const n0 = (numStats + 1) >> 1, n1 = (ns + 1) >> 1;
      if (n0 !== n1) m32[(mc >> 2) + 1] = this.shrinkUnits(stats, n0, n1);
    }
    m16[(mc >> 1) + 1] = sumFreq + escFreq - (escFreq >>> 1);
    this.foundState = m32[(mc >> 2) + 1];
  }

  nextContext() {
    const c = this.succ(this.foundState);
    if (this.orderFall === 0 && c > this.text) this.minContext = this.maxContext = c;
    else this.updateModel();
  }

  // --- decoder ---------------------------------------------------------------------------------------------------

  /** Decodes up to `n` symbols into `out`; returns n, or ~count when the end mark came after `count` symbols. */
  decodeInto(rc, out, n) {
    for (let i = 0; i < n; i++) {
      const c = this.decodeSymbol(rc);
      if (c < 0) return ~i;
      out[i] = c;
    }
    return n;
  }

  decodeSymbol(rc) {
    const m8 = this.m8, m16 = this.m16, m32 = this.m32, mask = this.mask;
    let mc = this.minContext;

    if (m16[mc >> 1] !== 1) {
      let s = m32[(mc >> 2) + 1];
      const summ = m16[(mc >> 1) + 1];
      const count = rc.getThreshold(summ);
      let hiCnt = m8[s + 1];
      if (count < hiCnt) {
        rc.decode(0, hiCnt);
        this.foundState = s;
        const sym = m8[s];
        // Update1_0
        this.prevSuccess = 2 * hiCnt > summ ? 1 : 0;
        this.runLength += this.prevSuccess;
        m16[(mc >> 1) + 1] = summ + 4;
        if ((m8[s + 1] = hiCnt + 4) > MAX_FREQ) this.rescale();
        this.nextContext();
        return sym;
      }
      this.prevSuccess = 0;
      let i = m16[mc >> 1] - 1;
      do {
        s += 6;
        const f = m8[s + 1];
        if ((hiCnt += f) > count) {
          rc.decode(hiCnt - f, f);
          this.foundState = s;
          const sym = m8[s];
          // Update1
          m8[s + 1] = f + 4;
          m16[(mc >> 1) + 1] = summ + 4;
          if (f + 4 > m8[s - 5]) {
            this.swapStates(s, s - 6);
            this.foundState = s - 6;
            if (f + 4 > MAX_FREQ) this.rescale();
          }
          this.nextContext();
          return sym;
        }
      } while (--i);
      if (count >= summ) corrupt('PPMd data');
      this.hiBitsFlag = HB2FLAG[m8[this.foundState]];
      rc.decode(hiCnt, summ - hiCnt);
      mask.fill(1);
      mask[m8[s]] = 0;
      i = m16[mc >> 1] - 1;
      do { s -= 6; mask[m8[s]] = 0; } while (--i);
    } else {
      const os = mc + 2, freq = m8[os + 1];
      const hb = HB2FLAG[m8[this.foundState]];
      this.hiBitsFlag = hb;
      const bi = (freq - 1) * 64 + this.prevSuccess + NS2BSINDX[m16[m32[(mc >> 2) + 2] >> 1] - 1] + hb +
        2 * HB2FLAG[m8[os]] + ((this.runLength >> 26) & 0x20);
      // Binary context (only one symbol seen here): instead of a frequency table, an adaptive probability from binSumm
      // indexed by the symbol's frequency, previous success, the parent's size, high bits of the previous symbol and
      // the run length. Update rule p += (1 - p) / 128 on a hit, p -= p / 128 on a miss (fixed-point, +32 rounding):
      // the shift-based exponential moving average used throughout PPMd and LZMA.
      const bs = this.binSumm;
      const prob = bs[bi];
      if (rc.decodeBit(prob, BIN_SCALE) === 0) {
        bs[bi] = prob + (1 << 7) - ((prob + 32) >> 7);
        this.foundState = os;
        const sym = m8[os]; // read before the update: a restart may reuse the memory
        // UpdateBin
        m8[os + 1] = freq + (freq < 128 ? 1 : 0);
        this.prevSuccess = 1;
        this.runLength++;
        this.nextContext();
        return sym;
      }
      const p1 = prob - ((prob + 32) >> 7);
      bs[bi] = p1;
      this.initEsc = EXP_ESCAPE[p1 >> 10];
      mask.fill(1);
      mask[m8[os]] = 0;
      this.prevSuccess = 0;
    }

    const ps = this.ps, seeSumm = this.seeSumm, seeShift = this.seeShift, seeCount = this.seeCount;
    for (;;) {
      const numMasked = m16[mc >> 1];
      do {
        this.orderFall++;
        const suffix = m32[(mc >> 2) + 2];
        if (suffix === 0) return -1;
        mc = suffix;
        this.minContext = mc;
      } while (m16[mc >> 1] === numMasked);

      const ns = m16[mc >> 1], num = ns - numMasked;
      let hiCnt = 0, s = m32[(mc >> 2) + 1], i = 0;
      do { // branch-free, as 7-Zip's charMask loop: one 16-bit load gives Symbol (low) and Freq (high)
        const w = m16[s >> 1], k = mask[w & 0xff];
        hiCnt += (w >> 8) & -k;
        ps[i] = s;
        i += k;
        s += 6;
      } while (i !== num);

      // MakeEscFreq: the escape frequency comes from a secondary (SEE) context
      // SEE (secondary escape estimation): the probability of "a symbol not seen in this context" is learned per class
      // of contexts (number of symbols, parent size, flags) instead of per context, because individual contexts see too
      // few escapes to estimate them. seeSumm / 2^seeShift is the running mean; seeShift grows to PERIOD_BITS as the
      // estimate stabilises (longer averaging window).
      let see, escFreq;
      if (ns !== 256) {
        see = NS2INDX[num - 1] * 16 + (num < ((m16[m32[(mc >> 2) + 2] >> 1] - ns) >>> 0)) +
          2 * (m16[(mc >> 1) + 1] < 11 * ns) + 4 * (numMasked > num) + this.hiBitsFlag;
        const r = seeSumm[see] >> seeShift[see];
        seeSumm[see] -= r;
        escFreq = r + (r === 0);
      } else {
        see = DUMMY_SEE;
        escFreq = 1;
      }
      const freqSum = escFreq + hiCnt;
      const count = rc.getThreshold(freqSum);
      if (count < hiCnt) {
        let k = 0, f;
        hiCnt = 0;
        for (;;) {
          s = ps[k++];
          f = m8[s + 1];
          if ((hiCnt += f) > count) break;
        }
        rc.decode(hiCnt - f, f);
        if (seeShift[see] < PERIOD_BITS && --seeCount[see] === 0) {
          seeSumm[see] <<= 1;
          seeCount[see] = 3 << seeShift[see]++;
        }
        this.foundState = s;
        const sym = m8[s];
        // Update2
        m8[s + 1] = f + 4;
        m16[(mc >> 1) + 1] += 4;
        if (f + 4 > MAX_FREQ) this.rescale();
        this.runLength = this.initRL;
        this.updateModel();
        return sym;
      }
      if (count >= freqSum) corrupt('PPMd data');
      rc.decode(hiCnt, freqSum - hiCnt);
      seeSumm[see] += freqSum;
      for (let k = 0; k < i; k++) mask[m8[ps[k]]] = 0;
    }
  }
}

// --- range decoders ----------------------------------------------------------------------------------------------

const TOP = 1 << 24, BOT = 1 << 15;

/** 7-Zip's PPMd range decoder (7z method 03 04 01). Reading past the input is an error, as in 7-Zip. */
export class RangeDecoder7z {
  constructor(reader) {
    this.r = reader;
    this.range = 0xffffffff;
    this.code = 0;
    if (reader.byte() !== 0) corrupt('PPMd stream start');
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | this.next()) >>> 0;
    if (this.code === 0xffffffff) corrupt('PPMd stream start');
  }

  next() {
    const b = this.r.byte();
    if (b < 0) fail('truncated', 'unexpected end of PPMd data');
    return b;
  }

  normalize() {
    if (this.range < TOP) {
      this.code = ((this.code << 8) | this.next()) >>> 0;
      this.range = (this.range << 8) >>> 0;
      if (this.range < TOP) {
        this.code = ((this.code << 8) | this.next()) >>> 0;
        this.range = (this.range << 8) >>> 0;
      }
    }
  }

  getThreshold(total) {
    this.range = (this.range / total) >>> 0;
    return (this.code / this.range) >>> 0;
  }

  decode(start, size) {
    this.code = (this.code - start * this.range) >>> 0;
    this.range *= size;
    this.normalize();
  }

  // Arithmetic decoding: the coder's interval [0, range) is divided into `total` units; code / unit says which
  // symbol's sub-interval holds the code. All values are kept as uint32 via >>> 0; products like range * size stay
  // below 2^32 because range was divided by total first, so doubles hold them exactly.
  decodeBit(size0, total) {
    const bound = ((this.range / total) >>> 0) * size0;
    let bit;
    if (this.code < bound) {
      bit = 0;
      this.range = bound;
    } else {
      bit = 1;
      this.code -= bound;
      this.range -= bound;
    }
    this.normalize();
    return bit;
  }
}

/** RAR 3.x (and Shkarin's original) carry-less range decoder. Bytes past the input read as 0 (`extra` counts them). */
export class RangeDecoderRar {
  constructor(reader, strict = false) {
    this.r = reader;
    this.strict = strict;
    this.extra = 0;
    this.low = 0;
    this.range = 0xffffffff;
    this.code = 0;
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | this.next()) >>> 0;
  }

  next() {
    const b = this.r.byte();
    if (b >= 0) return b;
    if (this.strict) fail('truncated', 'unexpected end of PPMd data');
    this.extra++;
    return 0;
  }

  getThreshold(total) {
    this.range = (this.range / total) >>> 0;
    return (this.code / this.range) >>> 0;
  }

  decode(start, size) {
    start *= this.range;
    this.low = (this.low + start) >>> 0;
    this.code = (this.code - start) >>> 0;
    this.range *= size;
    for (;;) {
      if (((this.low ^ (this.low + this.range)) >>> 0) >= TOP) {
        if (this.range >= BOT) break;
        this.range = -this.low & (BOT - 1);
      }
      this.code = ((this.code << 8) | this.next()) >>> 0;
      this.range = (this.range << 8) >>> 0;
      this.low = (this.low << 8) >>> 0;
    }
  }

  decodeBit(size0, total) {
    if (this.getThreshold(total) < size0) {
      this.decode(0, size0);
      return 0;
    }
    this.decode(size0, total - size0);
    return 1;
  }
}

// --- 7z stream ---------------------------------------------------------------------------------------------------

const OUT = 1 << 16;

/** 7z method 03 04 01: `props` = order byte + memory size (uint32 LE). Exactly `size` bytes, or up to the end mark. */
export function ppmd7Stream(reader, props, { size } = {}) {
  if (!props || props.length < 5) corrupt('PPMd properties');
  const order = props[0], mem = le32(props, 1);
  if (order < 2 || order > MAX_ORDER || mem < 1 << 11 || mem > 0xffffffff - 36) unsupported(`PPMd order ${order} / memory ${mem}`);
  let model = null, rc = null, done = false, left = size ?? Infinity, out = null;
  return {
    size,
    read(max = OUT) {
      if (done || left <= 0) return null;
      if (!model) {
        rc = new RangeDecoder7z(reader);
        model = new Ppmd7(mem);
        model.init(order);
        out = new Uint8Array(OUT);
      }
      const n = model.decodeInto(rc, out, Math.min(max, OUT, left));
      if (n < 0) {
        done = true;
        if (size != null) corrupt('PPMd end mark before the end of the data');
      }
      const got = n < 0 ? ~n : n;
      left -= got;
      return got ? out.subarray(0, got) : null;
    },
  };
}
