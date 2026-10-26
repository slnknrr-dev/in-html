// archive/unpack20.js - RAR 2.0 / 2.6 decompression (unpack versions 20 and 26), including the multimedia (audio)
// mode.
//
//   const u = new Unpack20(windowSize(dict, total))
//   u.file(reader, size, solid) -> Stream            (see rarbits.js)
//
// LZ blocks: main table of 298 symbols (literals, 256 repeat last match, 257-260 old distances, 261-268 short
// distances, 269 new tables, 270-297 lengths), 48 distance slots (1 MiB), 28 repeat-length codes. Audio blocks: 1-4
// channels, one 257-symbol table per channel (256 = new tables) coding the prediction error of an adaptive linear
// predictor per channel. Tables are sent as differences to the previous ones. A file ends after `size` bytes; a table
// change right at its end belongs to it (unrar's ReadLastTables), which matters for the next file of a solid archive.

import { corrupt } from './io.js';
import { DecodeTable, Unpacker } from './rarbits.js';
import { DBITS, DDECODE, LBITS, LDECODE, SDBITS, SDDECODE } from './unpack29.js';

const NC = 298, DC = 48, RC = 28, BC = 19, MC = 257;

class Audio {
  constructor() { this.dif = new Uint32Array(11); this.reset(); }
  reset() {
    this.k1 = this.k2 = this.k3 = this.k4 = this.k5 = 0;
    this.d1 = this.d2 = this.d3 = this.d4 = 0;
    this.lastDelta = 0;
    this.dif.fill(0);
    this.count = 0;
    this.lastChar = 0;
  }
}

export class Unpack20 extends Unpacker {
  constructor(size) {
    super(size);
    this.BD = new DecodeTable(BC);
    this.LD = new DecodeTable(NC);
    this.DD = new DecodeTable(DC);
    this.RD = new DecodeTable(RC);
    this.MD = [0, 1, 2, 3].map(() => new DecodeTable(MC));
    this.old = new Uint8Array(MC * 4);
    this.table = new Uint8Array(MC * 4);
    this.bl = new Uint8Array(BC);
    this.aud = [0, 1, 2, 3].map(() => new Audio());
    this.od = new Int32Array(4);
    this.odPtr = 0;
    this.lastDist = 0;
    this.lastLen = 0;
    this.chDelta = 0;
    this.curCh = 0;
    this.channels = 1;
    this.audio = false;
    this.tablesRead = false;
    this.started = false;
  }

  init(solid) {
    if (!solid) {
      this.tablesRead = false;
      this.audio = false;
      this.chDelta = 0;
      this.curCh = 0;
      this.channels = 1;
      for (const a of this.aud) a.reset();
      this.old.fill(0);
      this.od.fill(0);
      this.odPtr = 0;
      this.lastDist = this.lastLen = 0;
    }
    this.started = false;
  }

  readTables() {
    const inp = this.inp, bl = this.bl, t = this.table;
    if (inp.pos > inp.border) inp.refill();
    const bf = inp.getbits();
    this.audio = (bf & 0x8000) !== 0;
    // Bit 15: audio mode; bit 14 clear: start from all-zero lengths instead of deltas against the previous tables.
    // Delta coding (length = (n + old) mod 16) makes a table that barely changed cost almost nothing to retransmit.
    if (!(bf & 0x4000)) this.old.fill(0);
    inp.addbits(2);
    let size;
    if (this.audio) {
      this.channels = ((bf >> 12) & 3) + 1;
      if (this.curCh >= this.channels) this.curCh = 0;
      inp.addbits(2);
      size = MC * this.channels;
    } else size = NC + DC + RC;
    for (let i = 0; i < BC; i++) bl[i] = inp.bits(4);
    this.BD.build(bl, 0, BC);
    for (let i = 0; i < size;) {
      if (inp.pos > inp.border) { inp.refill(); if (inp.over()) corrupt('RAR 2 Huffman table beyond the data'); }
      const n = this.BD.decode(inp);
      // Pre-code symbols as in Deflate's code-length alphabet: 0-15 literal (delta) length, 16 repeat previous 3-6
      // times, 17 / 18 runs of zeros (3-10 / 11-138).
      if (n < 16) { t[i] = (n + this.old[i]) & 15; i++; }
      else if (n === 16) {
        let c = inp.bits(2) + 3;
        if (i === 0) corrupt('RAR 2 Huffman table');
        for (; c > 0 && i < size; c--, i++) t[i] = t[i - 1];
      } else {
        let c = n === 17 ? inp.bits(3) + 3 : inp.bits(7) + 11;
        for (; c > 0 && i < size; c--) t[i++] = 0;
      }
    }
    this.tablesRead = true;
    if (inp.over()) return;
    if (this.audio) for (let i = 0; i < this.channels; i++) this.MD[i].build(t, i * MC, MC);
    else {
      this.LD.build(t, 0, NC);
      this.DD.build(t, NC, DC);
      this.RD.build(t, NC + DC, RC);
    }
    this.old.set(t.subarray(0, size));
  }

  // After the last byte of a file: a table change coded right there is part of this file.
  readLastTables() {
    const inp = this.inp;
    // Fewer than 5 bytes left at the end of input cannot hold a table change; probing would read zero padding and
    // could misinterpret it as one.
    if (inp.eof && inp.top - inp.pos < 5) return;
    if (this.audio) { if (this.MD[this.curCh].decode(inp) === 256) this.readTables(); }
    else if (this.LD.decode(inp) === 269) this.readTables();
  }

  decodeAudio(delta) {
    const v = this.aud[this.curCh];
    v.count++;
    v.d4 = v.d3;
    v.d3 = v.d2;
    v.d2 = v.lastDelta - v.d1;
    v.d1 = v.lastDelta;
    const pch = ((8 * v.lastChar + v.k1 * v.d1 + v.k2 * v.d2 + v.k3 * v.d3 + v.k4 * v.d4 + v.k5 * this.chDelta) >> 3) & 0xff;
    const ch = (pch - delta) & 0xff;
    const d = ((delta << 24) >> 24) * 8;
    const dif = v.dif;
    dif[0] += Math.abs(d);
    dif[1] += Math.abs(d - v.d1);
    dif[2] += Math.abs(d + v.d1);
    dif[3] += Math.abs(d - v.d2);
    dif[4] += Math.abs(d + v.d2);
    dif[5] += Math.abs(d - v.d3);
    dif[6] += Math.abs(d + v.d3);
    dif[7] += Math.abs(d - v.d4);
    dif[8] += Math.abs(d + v.d4);
    dif[9] += Math.abs(d - this.chDelta);
    dif[10] += Math.abs(d + this.chDelta);
    this.chDelta = v.lastDelta = ((ch - v.lastChar) << 24) >> 24;
    v.lastChar = ch;
    if ((v.count & 0x1f) === 0) {
      let min = dif[0], num = 0;
      dif[0] = 0;
      for (let i = 1; i < 11; i++) {
        if (dif[i] < min) { min = dif[i]; num = i; }
        dif[i] = 0;
      }
      switch (num) {
        case 1: if (v.k1 >= -16) v.k1--; break;
        case 2: if (v.k1 < 16) v.k1++; break;
        case 3: if (v.k2 >= -16) v.k2--; break;
        case 4: if (v.k2 < 16) v.k2++; break;
        case 5: if (v.k3 >= -16) v.k3--; break;
        case 6: if (v.k3 < 16) v.k3++; break;
        case 7: if (v.k4 >= -16) v.k4--; break;
        case 8: if (v.k4 < 16) v.k4++; break;
        case 9: if (v.k5 >= -16) v.k5--; break;
        case 10: if (v.k5 < 16) v.k5++; break;
      }
    }
    return ch;
  }

  run(target) {
    const inp = this.inp, win = this.win, W = this.W, od = this.od;
    if (!this.started) {
      this.started = true;
      if (!this.tablesRead) this.readTables();
    }
    const end = this.fileStart + this.size;
    let ptr = this.ptr, abs = this.abs;
    while (abs < target) {
      if (abs >= end) { this.ptr = ptr; this.abs = abs; this.readLastTables(); this.done = true; break; }
      if (inp.pos > inp.border) { inp.refill(); if (inp.over()) { this.done = true; break; } }
      if (this.audio) {
        const a = this.MD[this.curCh].decode(inp);
        if (a === 256) { this.readTables(); continue; }
        win[ptr++] = this.decodeAudio(a);
        abs++;
        if (ptr === W) ptr = 0;
        if (++this.curCh === this.channels) this.curCh = 0;
        continue;
      }
      const n = this.LD.decode(inp);
      if (n < 256) {
        win[ptr++] = n;
        abs++;
        if (ptr === W) ptr = 0;
        continue;
      }
      let len, dist;
      if (n > 269) {
        const k = n - 270;
        len = LDECODE[k] + 3;
        if (LBITS[k]) len += inp.bits(LBITS[k]);
        const dn = this.DD.decode(inp);
        dist = DDECODE[dn] + 1;
        if (DBITS[dn]) dist += inp.bits(DBITS[dn]);
        if (dist >= 0x2000) { len++; if (dist >= 0x40000) len++; }
      } else if (n === 269) {
        this.readTables();
        continue;
      } else if (n === 256) {
        len = this.lastLen;
        dist = this.lastDist;
      } else if (n < 261) {
        dist = od[(this.odPtr - (n - 256)) & 3];
        const ln = this.RD.decode(inp);
        len = LDECODE[ln] + 2;
        if (LBITS[ln]) len += inp.bits(LBITS[ln]);
        if (dist >= 0x101) { len++; if (dist >= 0x2000) { len++; if (dist >= 0x40000) len++; } }
      } else {
        const k = n - 261;
        dist = SDDECODE[k] + 1;
        if (SDBITS[k]) dist += inp.bits(SDBITS[k]);
        len = 2;
      }
      // CopyString20: every match becomes the last one and enters the old distances.
      this.lastDist = od[this.odPtr] = dist;
      this.odPtr = (this.odPtr + 1) & 3;
      this.lastLen = len;
      if (dist > abs || dist > W || dist === 0) {
        for (let k = 0; k < len; k++) { win[ptr++] = 0; if (ptr === W) ptr = 0; }
      } else {
        let src = ptr - dist;
        if (src < 0) src += W;
        for (let k = 0; k < len; k++) {
          win[ptr++] = win[src++];
          if (ptr === W) ptr = 0;
          if (src === W) src = 0;
        }
      }
      abs += len;
    }
    this.ptr = ptr;
    this.abs = abs;
  }
}
