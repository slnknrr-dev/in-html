// archive/ppmd8.js - PPMd variant I revision 1 (Dmitry Shkarin's PPMd var.I as 7-Zip's Ppmd8.c implements it): the
// context model with its sub-allocator and the model restoration methods, and the ZIP PPMd stream (method 98).
//
//   new Ppmd8(memSize)                    allocates the model memory (one ArrayBuffer)
//     .init(maxOrder, restoreMethod)      restarts the model; maxOrder 2..16, restoreMethod 0 = restart, 1 = cut off
//                                          (2 = freeze is not supported, as in 7-Zip)
//     .decodeSymbol(rc) -> 0..255, or -1 for the escape out of the order-0 context (the end mark); throws
//                                          ArchiveError 'corrupt' on invalid data. `rc` is a RangeDecoderRar
//                                          (ppmd7.js): Ppmd8 uses the same carry-less coder.
//     .decodeInto(rc, out, n) -> n, or ~count when the end mark followed `count` symbols
//   ppmd8Stream(reader, { size }) -> Stream   ZIP method 98: a 16-bit LE header (bits 0-3 order - 1, 4-11 memory
//     in MB - 1, 12-15 restoration method), then the range-coded data; decodes exactly `size` bytes
//
// Memory layout follows Ppmd8.c byte for byte (offsets into one buffer, 0 = null), since when memory runs out decides
// when the model is restarted or cut off. 12-byte units:
//   context  NumStats u8 @0 (symbols - 1), Flags u8 @1, SummFreq u16 @2, Stats u32 @4, Suffix u32 @8 (a one-symbol
//            context keeps its state in place at @2)
//   state    Symbol u8 @0, Freq u8 @1, Successor u16+u16 @2 (6 bytes)
//   free     Stamp u32 @0 (0xFFFFFFFF), Next u32 @4, NU u32 @8

import { corrupt, fail, unsupported } from './io.js';
import { MAX_MEM, RangeDecoderRar } from './ppmd7.js';

const UNIT = 12, N_INDEXES = 38, MAX_FREQ = 124, BIN_SCALE = 1 << 14, PERIOD_BITS = 7, MAX_ORDER = 16;
const EMPTY = -1; // free-node stamp 0xFFFFFFFF as read through the Int32Array view
const EXP_ESCAPE = Uint8Array.of(25, 14, 9, 7, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2, 2);
const INIT_BIN_ESC = [0x3cdd, 0x1f3f, 0x59bf, 0x48f3, 0x64a1, 0x5abc, 0x6632, 0x6051];
const DUMMY_SEE = 24 * 32;

const I2U = new Uint8Array(N_INDEXES), U2I = new Uint8Array(128);
for (let i = 0, k = 0; i < N_INDEXES; i++) {
  let step = i >= 12 ? 4 : (i >> 2) + 1;
  do U2I[k++] = i; while (--step);
  I2U[i] = k;
}
const NS2BSINDX = new Uint8Array(256), NS2INDX = new Uint8Array(260);
NS2BSINDX[1] = 2;
NS2BSINDX.fill(4, 2, 11);
NS2BSINDX.fill(6, 11);
for (let i = 0; i < 5; i++) NS2INDX[i] = i;
for (let i = 5, m = 5, k = 1; i < 260; i++) {
  NS2INDX[i] = m;
  if (--k === 0) k = ++m - 4;
}

export class Ppmd8 {
  constructor(memSize) {
    if (!(memSize >= 1 << 11 && memSize <= MAX_MEM)) unsupported('PPMd memory size ' + memSize);
    this.size = memSize;
    this.align = 4 - (memSize & 3);
    let buf;
    try { buf = new ArrayBuffer(this.align + memSize + UNIT); } catch { fail('limit', `cannot allocate ${memSize} bytes for PPMd`); }
    this.m8 = new Uint8Array(buf);
    this.m16 = new Uint16Array(buf);
    this.m32 = new Int32Array(buf);
    this.freeList = new Int32Array(N_INDEXES);
    this.stamps = new Uint32Array(N_INDEXES); // free blocks per size class (GetUsedMemory)
    this.count = new Uint32Array(N_INDEXES);
    this.binSumm = new Uint16Array(25 * 64);
    this.seeSumm = new Uint16Array(DUMMY_SEE + 1);
    this.seeShift = new Uint8Array(DUMMY_SEE + 1);
    this.seeCount = new Uint8Array(DUMMY_SEE + 1);
    this.mask = new Uint8Array(256); // 1 = symbol not yet seen in a higher order (reset on the first escape)
    this.ps = new Int32Array(256);
    this.ps2 = new Int32Array(MAX_ORDER + 1);
    this.minContext = this.maxContext = this.foundState = 0;
    this.orderFall = this.initEsc = this.prevSuccess = this.maxOrder = this.restoreMethod = 0;
    this.runLength = this.initRL = 0;
    this.glueCount = this.loUnit = this.hiUnit = this.text = this.unitsStart = 0;
  }

  init(maxOrder, restoreMethod = 0) {
    if (!(maxOrder >= 2 && maxOrder <= MAX_ORDER)) unsupported('PPMd order ' + maxOrder);
    if (restoreMethod !== 0 && restoreMethod !== 1) unsupported('PPMd model restoration method ' + restoreMethod);
    this.maxOrder = maxOrder;
    this.restoreMethod = restoreMethod;
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

  insertNode(node, indx) {
    const m32 = this.m32, n = node >> 2;
    m32[n] = EMPTY;
    m32[n + 1] = this.freeList[indx];
    m32[n + 2] = I2U[indx];
    this.freeList[indx] = node;
    this.stamps[indx]++;
  }

  removeNode(indx) {
    const node = this.freeList[indx];
    this.freeList[indx] = this.m32[(node >> 2) + 1];
    this.stamps[indx]--;
    return node;
  }

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

  // Merges adjacent free blocks (free lists in index order, each block absorbing the free blocks after it), then
  // refills the free lists. The order-0 context is the top unit, so only LoUnit needs a guard.
  glueFreeBlocks() {
    const m32 = this.m32, fl = this.freeList;
    let head = 0, prev = -1; // prev: m32 index of the Next field to patch, -1 = head
    this.glueCount = 1 << 13;
    this.stamps.fill(0);
    if (this.loUnit !== this.hiUnit) m32[this.loUnit >> 2] = 0;
    for (let i = 0; i < N_INDEXES; i++) {
      let next = fl[i];
      fl[i] = 0;
      while (next !== 0) {
        const n = next >> 2;
        if (m32[n + 2] !== 0) {
          if (prev < 0) head = next; else m32[prev] = next;
          prev = n + 1;
          for (;;) {
            const n2 = (next + m32[n + 2] * UNIT) >> 2;
            if (m32[n2] !== EMPTY) break;
            m32[n + 2] += m32[n2 + 2];
            m32[n2 + 2] = 0;
          }
        }
        next = m32[n + 1];
      }
    }
    if (prev < 0) head = 0; else m32[prev] = 0;
    this.refill(head);
  }

  refill(head) {
    const m32 = this.m32;
    while (head !== 0) {
      let node = head;
      head = m32[(node >> 2) + 1];
      let nu = m32[(node >> 2) + 2];
      if (nu === 0) continue;
      for (; nu > 128; nu -= 128, node += 128 * UNIT) this.insertNode(node, N_INDEXES - 1);
      let i = U2I[nu - 1];
      if (I2U[i] !== nu) {
        const k = I2U[--i];
        this.insertNode(node + k * UNIT, nu - k - 1);
      }
      this.insertNode(node, i);
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

  freeUnits(ptr, nu) { this.insertNode(ptr, U2I[nu - 1]); }

  specialFreeUnit(ptr) {
    if (ptr !== this.unitsStart) this.insertNode(ptr, 0);
    else this.unitsStart += UNIT;
  }

  // Moves a block near UnitsStart into a free block higher up, so that the text area can grow.
  moveUnitsUp(oldPtr, nu) {
    const indx = U2I[nu - 1];
    if (oldPtr > this.unitsStart + 16 * 1024 || oldPtr > this.freeList[indx]) return oldPtr;
    const ptr = this.removeNode(indx);
    this.m32.copyWithin(ptr >> 2, oldPtr >> 2, (oldPtr >> 2) + 3 * nu);
    if (oldPtr !== this.unitsStart) this.insertNode(oldPtr, indx);
    else this.unitsStart += I2U[indx] * UNIT;
    return ptr;
  }

  // Free blocks right at UnitsStart join the text area (and leave their free lists).
  expandTextArea() {
    const m32 = this.m32, fl = this.freeList, count = this.count;
    count.fill(0);
    if (this.loUnit !== this.hiUnit) m32[this.loUnit >> 2] = 0;
    let node = this.unitsStart;
    for (; m32[node >> 2] === EMPTY; node += m32[(node >> 2) + 2] * UNIT) {
      m32[node >> 2] = 0;
      count[U2I[m32[(node >> 2) + 2] - 1]]++;
    }
    this.unitsStart = node;
    for (let i = 0; i < N_INDEXES; i++) {
      let slot = -1; // m32 index of the link to the current node, -1 = freeList[i]
      while (count[i] !== 0) {
        let n = slot < 0 ? fl[i] : m32[slot];
        while (m32[n >> 2] === 0) {
          n = m32[(n >> 2) + 1];
          if (slot < 0) fl[i] = n; else m32[slot] = n;
          this.stamps[i]--;
          if (--count[i] === 0) break;
        }
        slot = (n >> 2) + 1;
      }
    }
  }

  getUsedMemory() {
    let v = 0;
    for (let i = 0; i < N_INDEXES; i++) v += this.stamps[i] * I2U[i];
    return (this.size - (this.hiUnit - this.loUnit) - (this.unitsStart - this.text) - v * UNIT) >>> 0;
  }

  // --- model -----------------------------------------------------------------------------------------------------

  restartModel() {
    const m8 = this.m8, m16 = this.m16, m32 = this.m32;
    this.freeList.fill(0);
    this.stamps.fill(0);
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
    m8[mc] = 255;
    m8[mc + 1] = 0;
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
    for (let i = 0, m = 0; m < 25; m++) {
      while (NS2INDX[i] === m) i++;
      for (let k = 0; k < 8; k++) {
        const val = BIN_SCALE - Math.floor(INIT_BIN_ESC[k] / (i + 1));
        for (let r = 0; r < 64; r += 8) bs[m * 64 + k + r] = val;
      }
    }
    for (let i = 0, m = 0; m < 24; m++) {
      while (NS2INDX[i + 3] === m + 3) i++;
      for (let k = 0; k < 32; k++) {
        this.seeShift[m * 32 + k] = PERIOD_BITS - 4;
        this.seeSumm[m * 32 + k] = (2 * i + 5) << (PERIOD_BITS - 4);
        this.seeCount[m * 32 + k] = 7;
      }
    }
  }

  // Halves (scale 1) or keeps the frequencies after the stats block shrank; recomputes SummFreq and Flags.
  refresh(ctx, oldNU, scale) {
    const m8 = this.m8, m16 = this.m16, m32 = this.m32;
    let i = m8[ctx];
    let s = this.shrinkUnits(m32[(ctx >> 2) + 1], oldNU, (i + 2) >> 1);
    m32[(ctx >> 2) + 1] = s;
    let flags = (m8[ctx + 1] & (0x10 + 0x04 * scale)) + 0x08 * (m8[s] >= 0x40);
    let escFreq = m16[(ctx >> 1) + 1] - m8[s + 1];
    let sumFreq = (m8[s + 1] = (m8[s + 1] + scale) >> scale);
    do {
      s += 6;
      escFreq -= m8[s + 1];
      sumFreq += (m8[s + 1] = (m8[s + 1] + scale) >> scale);
      flags |= 0x08 * (m8[s] >= 0x40);
    } while (--i);
    m16[(ctx >> 1) + 1] = sumFreq + ((escFreq + scale) >>> scale);
    m8[ctx + 1] = flags;
  }

  // Removes the raw (text) successors and the contexts above MaxOrder from the tree under `ctx`.
  // Recursive prune: successors of states with low frequency are dropped, contexts left with no states are freed.
  // Recursion depth is bounded by maxOrder (<= 16), so no stack risk.
  cutOff(ctx, order) {
    const m8 = this.m8, m16 = this.m16, m32 = this.m32;
    if (m8[ctx] === 0) {
      const s = ctx + 2, sc = this.succ(s);
      if (sc >= this.unitsStart) {
        this.setSucc(s, order < this.maxOrder ? this.cutOff(sc, order + 1) : 0);
        if (this.succ(s) || order <= 9) return ctx;
      }
      this.specialFreeUnit(ctx);
      return 0;
    }
    const tmp = (m8[ctx] + 2) >> 1;
    const stats = (m32[(ctx >> 2) + 1] = this.moveUnitsUp(m32[(ctx >> 2) + 1], tmp));
    let i = m8[ctx];
    for (let s = stats + i * 6; s >= stats; s -= 6) {
      const sc = this.succ(s);
      if (sc < this.unitsStart) {
        const s2 = stats + i-- * 6;
        this.setSucc(s, 0);
        this.swapStates(s, s2);
      } else this.setSucc(s, order < this.maxOrder ? this.cutOff(sc, order + 1) : 0);
    }
    if (i !== m8[ctx] && order) {
      m8[ctx] = i;
      if (i < 0) {
        this.freeUnits(stats, tmp);
        this.specialFreeUnit(ctx);
        return 0;
      }
      if (i === 0) {
        m8[ctx + 1] = (m8[ctx + 1] & 0x10) + 0x08 * (m8[stats] >= 0x40);
        this.copyState(ctx + 2, stats);
        this.freeUnits(stats, tmp);
        m8[ctx + 3] = (m8[ctx + 3] + 11) >> 3;
      } else this.refresh(ctx, tmp, m16[(ctx >> 1) + 1] > 16 * i ? 1 : 0);
    }
    return ctx;
  }

  // Out of memory (or text area full) while updating: undo the half-done update from MaxContext to c1, then
  // restart the model or cut it off (RestoreMethod).
  // Out of memory: var.I's distinguishing feature. Method 0 discards the model (restart, a compression drop on large
  // inputs); method 1 (cut off) keeps the low orders and prunes high-order branches until a quarter of the memory is
  // free, so the statistics learned so far survive. Either way it must match the encoder decision exactly, which is
  // why the allocator layout mirrors Ppmd8.c byte for byte (getUsedMemory drives the choice).
  restoreModel(c1) {
    const m8 = this.m8, m16 = this.m16, m32 = this.m32;
    this.text = this.align;
    let c = this.maxContext;
    for (; c !== c1; c = m32[(c >> 2) + 2]) {
      const n = m8[c] - 1;
      m8[c] = n;
      if (n === 0) {
        const s = m32[(c >> 2) + 1];
        m8[c + 1] = (m8[c + 1] & 0x10) + 0x08 * (m8[s] >= 0x40);
        this.copyState(c + 2, s);
        this.specialFreeUnit(s);
        m8[c + 3] = (m8[c + 3] + 11) >> 3;
      } else this.refresh(c, (n + 3) >> 1, 0);
    }
    for (; c !== this.minContext; c = m32[(c >> 2) + 2]) {
      if (m8[c] === 0) m8[c + 3] -= m8[c + 3] >> 1;
      else {
        const sf = (m16[(c >> 1) + 1] + 4) & 0xffff;
        m16[(c >> 1) + 1] = sf;
        if (sf > 128 + 4 * m8[c]) this.refresh(c, (m8[c] + 2) >> 1, 1);
      }
    }
    if (this.restoreMethod === 0 || this.getUsedMemory() < this.size >>> 1) this.restartModel();
    else {
      while (m32[(this.maxContext >> 2) + 2] !== 0) this.maxContext = m32[(this.maxContext >> 2) + 2];
      do {
        this.cutOff(this.maxContext, 0);
        this.expandTextArea();
      } while (this.getUsedMemory() > 3 * (this.size >>> 2));
      this.glueCount = 0;
      this.orderFall = this.maxOrder;
    }
  }

  createSuccessors(skip, s1, c) {
    const m8 = this.m8, m16 = this.m16, m32 = this.m32, ps = this.ps2;
    const fs = this.foundState, fSym = m8[fs];
    const upBranch = this.succ(fs);
    let numPs = 0;
    if (!skip) ps[numPs++] = fs;
    while (m32[(c >> 2) + 2] !== 0) {
      c = m32[(c >> 2) + 2];
      let s;
      if (s1) {
        s = s1;
        s1 = 0;
      } else if (m8[c] !== 0) {
        s = m32[(c >> 2) + 1];
        while (m8[s] !== fSym) s += 6;
        if (m8[s + 1] < MAX_FREQ - 9) {
          m8[s + 1]++;
          m16[(c >> 1) + 1]++;
        }
      } else {
        s = c + 2;
        m8[s + 1] += (m8[m32[(c >> 2) + 2]] === 0) & (m8[s + 1] < 24);
      }
      const successor = this.succ(s);
      if (successor !== upBranch) {
        c = successor;
        if (numPs === 0) return c;
        break;
      }
      ps[numPs++] = s;
    }

    const upSym = m8[upBranch], upSucc = upBranch + 1;
    const flags = 0x10 * (fSym >= 0x40) + 0x08 * (upSym >= 0x40);
    let upFreq;
    if (m8[c] === 0) upFreq = m8[c + 3];
    else {
      let s = m32[(c >> 2) + 1];
      while (m8[s] !== upSym) s += 6;
      const cf = m8[s + 1] - 1;
      const s0 = (m16[(c >> 1) + 1] - m8[c] - cf) >>> 0;
      upFreq = 1 + (2 * cf <= s0 ? +(5 * cf > s0) : Math.floor((cf + 2 * s0 - 3) / s0));
    }

    do {
      let c1;
      if (this.hiUnit !== this.loUnit) c1 = this.hiUnit -= UNIT;
      else if (this.freeList[0] !== 0) c1 = this.removeNode(0);
      else {
        c1 = this.allocUnitsRare(0);
        if (!c1) return 0;
      }
      m8[c1] = 0;
      m8[c1 + 1] = flags;
      m8[c1 + 2] = upSym;
      m8[c1 + 3] = upFreq;
      m32[(c1 >> 2) + 1] = upSucc;
      m32[(c1 >> 2) + 2] = c;
      this.setSucc(ps[--numPs], c1);
      c = c1;
    } while (numPs !== 0);
    return c;
  }

  reduceOrder(s1, c) {
    const m8 = this.m8, m16 = this.m16, m32 = this.m32;
    const fs = this.foundState, fSym = m8[fs];
    const c1 = c, upBranch = this.text;
    let s = 0;
    this.setSucc(fs, upBranch);
    this.orderFall++;
    for (;;) {
      if (s1) {
        c = m32[(c >> 2) + 2];
        s = s1;
        s1 = 0;
      } else {
        if (m32[(c >> 2) + 2] === 0) return c;
        c = m32[(c >> 2) + 2];
        if (m8[c] !== 0) {
          s = m32[(c >> 2) + 1];
          while (m8[s] !== fSym) s += 6;
          if (m8[s + 1] < MAX_FREQ - 9) {
            m8[s + 1] += 2;
            m16[(c >> 1) + 1] += 2;
          }
        } else {
          s = c + 2;
          m8[s + 1] += m8[s + 1] < 32;
        }
      }
      if (this.succ(s)) break;
      this.setSucc(s, upBranch);
      this.orderFall++;
    }
    if (this.succ(s) <= upBranch) {
      this.foundState = s;
      this.setSucc(s, this.createSuccessors(false, 0, c));
      this.foundState = fs;
    }
    if (this.orderFall === 1 && c1 === this.maxContext) {
      this.setSucc(fs, this.succ(s));
      this.text--;
    }
    return this.succ(s);
  }

  updateModel() {
    const m8 = this.m8, m16 = this.m16, m32 = this.m32;
    const fs = this.foundState, fSym = m8[fs], fFreq = m8[fs + 1];
    let fSuccessor = this.succ(fs);
    const mc = this.minContext;
    let s = 0;

    if (fFreq < MAX_FREQ / 4 && m32[(mc >> 2) + 2] !== 0) {
      const c = m32[(mc >> 2) + 2];
      if (m8[c] === 0) {
        s = c + 2;
        if (m8[s + 1] < 32) m8[s + 1]++;
      } else {
        s = m32[(c >> 2) + 1];
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

    let c = this.maxContext;
    if (this.orderFall === 0 && fSuccessor) {
      const cs = this.createSuccessors(true, s, mc);
      if (!cs) {
        this.setSucc(fs, 0);
        this.restoreModel(c);
      } else {
        this.setSucc(fs, cs);
        this.maxContext = cs;
      }
      return;
    }

    m8[this.text++] = fSym;
    let successor = this.text;
    if (this.text >= this.unitsStart) { this.restoreModel(c); return; }

    if (!fSuccessor) {
      const cs = this.reduceOrder(s, mc);
      if (!cs) { this.restoreModel(c); return; }
      fSuccessor = cs;
    } else if (fSuccessor < this.unitsStart) {
      const cs = this.createSuccessors(false, s, mc);
      if (!cs) { this.restoreModel(c); return; }
      fSuccessor = cs;
    }

    if (--this.orderFall === 0) {
      successor = fSuccessor;
      if (this.maxContext !== this.minContext) this.text--;
    }

    const ns = m8[mc];
    const s0 = m16[(mc >> 1) + 1] - ns - fFreq;
    const flag = 0x08 * (fSym >= 0x40);

    for (; c !== mc; c = m32[(c >> 2) + 2]) {
      const ns1 = m8[c];
      const sfi = (c >> 1) + 1;
      if (ns1 !== 0) {
        if ((ns1 & 1) !== 0) {
          const oldNU = (ns1 + 1) >> 1, i = U2I[oldNU - 1];
          if (i !== U2I[oldNU]) {
            const ptr = this.allocUnits(i + 1);
            if (!ptr) { this.restoreModel(c); return; }
            const oldPtr = m32[(c >> 2) + 1];
            m32.copyWithin(ptr >> 2, oldPtr >> 2, (oldPtr >> 2) + 3 * oldNU);
            this.insertNode(oldPtr, i);
            m32[(c >> 2) + 1] = ptr;
          }
        }
        m16[sfi] += 3 * ns1 + 1 < ns;
      } else {
        const s2 = this.allocUnits(0);
        if (!s2) { this.restoreModel(c); return; }
        this.copyState(s2, c + 2);
        m32[(c >> 2) + 1] = s2;
        const f = m8[s2 + 1] < MAX_FREQ / 4 - 1 ? m8[s2 + 1] << 1 : MAX_FREQ - 4;
        m8[s2 + 1] = f;
        m16[sfi] = f + this.initEsc + (ns > 2);
      }
      let cf = 2 * fFreq * (m16[sfi] + 6);
      const sf = s0 + m16[sfi];
      if (cf < 6 * sf) {
        cf = 1 + (cf > sf) + (cf >= 4 * sf);
        m16[sfi] += 4;
      } else {
        cf = 4 + (cf > 9 * sf) + (cf > 12 * sf) + (cf > 15 * sf);
        m16[sfi] += cf;
      }
      const s2 = m32[(c >> 2) + 1] + (ns1 + 1) * 6;
      this.setSucc(s2, successor);
      m8[s2] = fSym;
      m8[s2 + 1] = cf;
      m8[c + 1] |= flag;
      m8[c] = ns1 + 1;
    }
    this.maxContext = this.minContext = fSuccessor;
  }

  rescale() {
    const m8 = this.m8, m16 = this.m16, m32 = this.m32, mc = this.minContext;
    const stats = m32[(mc >> 2) + 1];
    let s = this.foundState;
    if (s !== stats) {
      const a = m16[s >> 1], b = m16[(s >> 1) + 1], c = m16[(s >> 1) + 2];
      m16.copyWithin((stats >> 1) + 3, stats >> 1, s >> 1);
      m16[stats >> 1] = a; m16[(stats >> 1) + 1] = b; m16[(stats >> 1) + 2] = c;
      s = stats;
    }
    let escFreq = m16[(mc >> 1) + 1] - m8[s + 1];
    const adder = this.orderFall !== 0 ? 1 : 0;
    m8[s + 1] = (m8[s + 1] + 4 + adder) >> 1;
    let sumFreq = m8[s + 1];
    let i = m8[mc];
    do {
      s += 6;
      escFreq -= m8[s + 1];
      const f = (m8[s + 1] + adder) >> 1;
      m8[s + 1] = f;
      sumFreq += f;
      if (f > m8[s - 5]) {
        const a = m16[s >> 1], b = m16[(s >> 1) + 1], c = m16[(s >> 1) + 2];
        let s1 = s;
        do s1 -= 6; while (s1 !== stats && f > m8[s1 - 5]);
        m16.copyWithin((s1 >> 1) + 3, s1 >> 1, s >> 1);
        m16[s1 >> 1] = a; m16[(s1 >> 1) + 1] = b; m16[(s1 >> 1) + 2] = c;
      }
    } while (--i);

    if (m8[s + 1] === 0) {
      const numStats = m8[mc];
      i = 0;
      do { i++; s -= 6; } while (m8[s + 1] === 0);
      escFreq += i;
      const ns = numStats - i;
      m8[mc] = ns;
      if (ns === 0) {
        const sym = m8[stats], succ = this.succ(stats);
        let freq = Math.floor((2 * m8[stats + 1] + escFreq - 1) / escFreq);
        if (freq > MAX_FREQ / 3) freq = Math.floor(MAX_FREQ / 3);
        this.insertNode(stats, U2I[((numStats + 2) >> 1) - 1]);
        m8[mc + 1] = (m8[mc + 1] & 0x10) + 0x08 * (sym >= 0x40);
        const os = mc + 2;
        m8[os] = sym;
        m8[os + 1] = freq;
        this.setSucc(os, succ);
        this.foundState = os;
        return;
      }
      const n0 = (numStats + 2) >> 1, n1 = (ns + 2) >> 1;
      if (n0 !== n1) m32[(mc >> 2) + 1] = this.shrinkUnits(stats, n0, n1);
      let flags = m8[mc + 1] & ~0x08;
      s = m32[(mc >> 2) + 1];
      flags |= 0x08 * (m8[s] >= 0x40);
      i = ns;
      do { s += 6; flags |= 0x08 * (m8[s] >= 0x40); } while (--i);
      m8[mc + 1] = flags;
    }
    m16[(mc >> 1) + 1] = sumFreq + escFreq - (escFreq >>> 1);
    m8[mc + 1] |= 0x04;
    this.foundState = m32[(mc >> 2) + 1];
  }

  nextContext() {
    const c = this.succ(this.foundState);
    if (this.orderFall === 0 && c >= this.unitsStart) this.minContext = this.maxContext = c;
    else {
      this.updateModel();
      this.minContext = this.maxContext;
    }
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

    if (m8[mc] !== 0) {
      let s = m32[(mc >> 2) + 1];
      const summ = m16[(mc >> 1) + 1];
      const count = rc.getThreshold(summ);
      let hiCnt = m8[s + 1];
      if (count < hiCnt) {
        rc.decode(0, hiCnt);
        this.foundState = s;
        const sym = m8[s];
        // Update1_0
        this.prevSuccess = 2 * hiCnt >= summ ? 1 : 0;
        this.runLength += this.prevSuccess;
        m16[(mc >> 1) + 1] = summ + 4;
        if ((m8[s + 1] = hiCnt + 4) > MAX_FREQ) this.rescale();
        this.nextContext();
        return sym;
      }
      this.prevSuccess = 0;
      let i = m8[mc];
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
      rc.decode(hiCnt, summ - hiCnt);
      mask.fill(1);
      mask[m8[s]] = 0;
      i = m8[mc];
      do { s -= 6; mask[m8[s]] = 0; } while (--i);
    } else {
      const os = mc + 2, freq = m8[os + 1];
      const bi = NS2INDX[freq - 1] * 64 + NS2BSINDX[m8[m32[(mc >> 2) + 2]]] + this.prevSuccess + m8[mc + 1] +
        ((this.runLength >> 26) & 0x20);
      const bs = this.binSumm;
      const prob = bs[bi];
      if (rc.decodeBit(prob, BIN_SCALE) === 0) {
        bs[bi] = prob + (1 << 7) - ((prob + 32) >> 7);
        this.foundState = os;
        const sym = m8[os]; // read before the update: a cut-off may free or move the context
        // UpdateBin
        m8[os + 1] = freq + (freq < 196 ? 1 : 0);
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
      const numMasked = m8[mc];
      do {
        this.orderFall++;
        const suffix = m32[(mc >> 2) + 2];
        if (suffix === 0) return -1;
        mc = suffix;
        this.minContext = mc;
      } while (m8[mc] === numMasked);

      const ns = m8[mc], num = ns - numMasked;
      let hiCnt = 0, s = m32[(mc >> 2) + 1], i = 0;
      do { // branch-free, as 7-Zip's charMask loop: one 16-bit load gives Symbol (low) and Freq (high)
        const w = m16[s >> 1], k = mask[w & 0xff];
        hiCnt += (w >> 8) & -k;
        ps[i] = s;
        i += k;
        s += 6;
      } while (i !== num);

      // MakeEscFreq
      let see, escFreq;
      if (ns !== 0xff) {
        see = (NS2INDX[ns + 2] - 3) * 32 + (m16[(mc >> 1) + 1] > 11 * (ns + 1)) +
          2 * (2 * ns < m8[m32[(mc >> 2) + 2]] + numMasked) + m8[mc + 1];
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
        m16[(mc >> 1) + 1] += 4;
        m8[s + 1] = f + 4;
        if (f + 4 > MAX_FREQ) this.rescale();
        this.runLength = this.initRL;
        this.updateModel();
        this.minContext = this.maxContext;
        return sym;
      }
      if (count >= freqSum) corrupt('PPMd data');
      rc.decode(hiCnt, freqSum - hiCnt);
      seeSumm[see] += freqSum;
      for (let k = 0; k < i; k++) mask[m8[ps[k]]] = 0;
    }
  }
}

// --- ZIP stream --------------------------------------------------------------------------------------------------

const OUT = 1 << 16;

/** ZIP method 98 (PPMd var.I rev. 1): 2 header bytes, then the range-coded data; exactly `size` bytes. */
export function ppmd8Stream(reader, { size } = {}) {
  let model = null, rc = null, left = size ?? Infinity, done = false, out = null;
  const start = () => {
    const lo = reader.byte(), hi = reader.byte();
    if (hi < 0) fail('truncated', 'unexpected end of PPMd data');
    const v = lo | (hi << 8);
    const order = (v & 15) + 1, mem = (((v >> 4) & 0xff) + 1) << 20, restore = v >> 12;
    if (order < 2 || restore > 2) corrupt('PPMd parameters');
    if (restore === 2) unsupported('PPMd model restoration method "freeze"');
    rc = new RangeDecoderRar(reader, true); // strict: valid data never needs bytes past its end (as 7-Zip checks)
    if (rc.code === 0xffffffff) corrupt('PPMd stream start');
    model = new Ppmd8(mem);
    model.init(order, restore);
    out = new Uint8Array(OUT);
  };
  return {
    size,
    read(max = OUT) {
      if (done || left <= 0) return null;
      if (!model) start();
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
