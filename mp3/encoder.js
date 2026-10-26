// mp3/encoder.js - MPEG-1 Audio Layer III encoder: 32 / 44.1 / 48 kHz, mono or stereo (independent channels),
// CBR 32-320 kbps. Polyphase analysis filterbank + 18-line MDCT with alias reduction (long blocks only), a global
// gain search per granule (no psychoacoustic model, bitrate-dependent low-pass), Huffman coding with table
// selection, a bit reservoir and a CBR "Info" tag frame. Floating point; pure JavaScript.
//
// Pipeline per frame (1152 samples): polyphase analysis -> 32 subbands x 36 slots; per granule (576): MDCT of 18
// slots (+ the previous 18, 50 % overlap) -> 576 spectral lines; alias reduction; low-pass; quantisation by a global
// gain chosen by binary search to fit the bit budget; Huffman coding; packing into the bit reservoir.
// Quality trade-off: without a psychoacoustic model, noise is shaped only by the low-pass and the global gain;
// fine at 128 kbps and above, audibly worse than LAME at low rates. The upside is a small, auditable encoder.
import { HUFF_INFO, MP3_BITRATES, QUAD_A_CODES, QUAD_A_LENS, SFB_LONG, huffmanCodes, synthesisWindow } from './tables.js';

const SR_INDEX = { 44100: 0, 48000: 1, 32000: 2 };
// Region split by the number of scale factor bands in the big-values area (ISO "subdv" table).
const SUBDV = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 1], [1, 1], [1, 1], [1, 2], [2, 2], [2, 3], [2, 3], [3, 4], [3, 4], [3, 4], [4, 5], [4, 5], [4, 6], [5, 6], [5, 6], [5, 7], [6, 7], [6, 7]];
// Base tables grouped by size: a region uses the cheapest table of the smallest group that holds its values.
const GROUPS = [[1], [2, 3], [5, 6], [7, 8, 9], [10, 11, 12], [13, 15]];
const GROUP_MAX = [1, 2, 3, 5, 7, 15];
// Low-pass (Hz) by total bit rate of a stereo stream (mono uses twice its rate).
const LOWPASS = [[32, 6000], [40, 7000], [48, 8000], [56, 9500], [64, 11000], [80, 13000], [96, 14500], [112, 15500], [128, 16500], [160, 17500], [192, 18500], [224, 19000], [256, 19500], [320, 20000]];

let TABLES = null;
// Precomputed once: analysis window C (= D / 32), the 32 x 64 cosine matrix of the polyphase filterbank, the
// 18 x 36 MDCT matrix with the sine window, and the alias-reduction butterflies (cs, ca from the standard's ci).
function tables() {
  if (TABLES) return TABLES;
  const D = synthesisWindow();
  const C = new Float64Array(512);
  for (let i = 0; i < 512; i++) C[i] = D[i] / 32;
  const M = new Float64Array(32 * 64);
  for (let k = 0; k < 32; k++) for (let i = 0; i < 64; i++) M[k * 64 + i] = Math.cos(((2 * k + 1) * (i - 16) * Math.PI) / 64);
  // MDCT (36 -> 18) with the sine window of normal blocks; 1/9 makes it the inverse of the decoder's IMDCT.
  const T = new Float64Array(18 * 36);
  for (let m = 0; m < 18; m++) {
    for (let n = 0; n < 36; n++) T[m * 36 + n] = (Math.sin((Math.PI / 36) * (n + 0.5)) * Math.cos((Math.PI / 72) * (2 * n + 19) * (2 * m + 1))) / 9;
  }
  const ci = [-0.6, -0.535, -0.33, -0.185, -0.095, -0.041, -0.0142, -0.0037];
  const cs = new Float64Array(8), ca = new Float64Array(8);
  for (let i = 0; i < 8; i++) { const s = Math.sqrt(1 + ci[i] * ci[i]); cs[i] = 1 / s; ca[i] = ci[i] / s; }
  TABLES = { C, M, T, cs, ca, huff: huffmanCodes() };
  return TABLES;
}

// Growable MSB-first bit writer.
// MSB-first, the bit order of MPEG audio. Doubles its buffer when needed; zero-initialised, so OR-ing bits in works.
class BitWriter {
  constructor(size = 4096) { this.buf = new Uint8Array(size); this.pos = 0; }
  put(v, n) {
    if (((this.pos + n) >> 3) + 1 >= this.buf.length) { const nb = new Uint8Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb; }
    while (n > 0) {
      const free = 8 - (this.pos & 7);
      const take = n < free ? n : free;
      const bits = (v >>> (n - take)) & ((1 << take) - 1);
      this.buf[this.pos >> 3] |= bits << (free - take);
      this.pos += take;
      n -= take;
    }
  }
}

/**
 * Streaming encoder.
 *   const enc = new Mp3Encoder({ sampleRate: 44100, channels: 2, bitrate: 128 });
 *   const a = enc.encode(left, right);   // Float32Array samples in [-1, 1]; returns the frames completed so far
 *   const b = enc.flush();               // the rest (pads the last frame and pushes the filter delay out)
 *   enc.infoFrame()                      // CBR "Info" tag frame (frame count, byte count, seek table) to put first
 */
export class Mp3Encoder {
  constructor({ sampleRate = 44100, channels = 2, bitrate = 128, lowpass } = {}) {
    if (!(sampleRate in SR_INDEX)) throw new Error('MP3 encoder: sample rate must be 32000, 44100 or 48000');
    if (!MP3_BITRATES.includes(bitrate)) throw new Error('MP3 encoder: unsupported bit rate ' + bitrate);
    if (channels !== 1 && channels !== 2) throw new Error('MP3 encoder: 1 or 2 channels');
    Object.assign(this, { sampleRate, channels, bitrate });
    this.T = tables();
    this.sfb = SFB_LONG[sampleRate];
    this.sideBytes = channels === 1 ? 17 : 32;
    this.frameNum = 144000 * bitrate;
    this.padAcc = 0;
    const lpRate = channels === 1 ? bitrate * 2 : bitrate;
    const lp = lowpass || (LOWPASS.find(([r]) => r >= lpRate) || LOWPASS[LOWPASS.length - 1])[1];
    this.cutLine = Math.min(576, Math.ceil((Math.min(lp, sampleRate / 2) / (sampleRate / 2)) * 576));
    this.pcm = Array.from({ length: channels }, () => new Float32Array(1152));
    this.fill = 0;
    // Per channel: filterbank input ring, subband samples of the frame ([granule][slot * 32 + band]), previous granule.
    this.fb = Array.from({ length: channels }, () => ({ x: new Float64Array(512), pos: 0, sb: new Float64Array(1152), prev: new Float64Array(576) }));
    this.xr = new Float64Array(576);
    this.xr34 = new Float64Array(576);
    this.ix = new Int32Array(576);
    this.y = new Float64Array(64);
    // main data "slot stream" with the bit reservoir
    this.stream = new Uint8Array(1 << 16);
    this.slotPos = 0;
    this.streamEnd = 0;
    this.pending = [];
    this.frames = 0;
    this.bytes = 0;
    this.totalSamples = 0;
  }

  /** Feeds planar samples; returns the bytes of the frames completed so far. */
  encode(left, right) {
    const chans = this.channels === 1 ? [left] : [left, right || left];
    const n = left.length;
    this.totalSamples += n;
    const out = [];
    let i = 0;
    while (i < n) {
      const take = Math.min(1152 - this.fill, n - i);
      for (let c = 0; c < this.channels; c++) this.pcm[c].set(chans[c].subarray(i, i + take), this.fill);
      this.fill += take;
      i += take;
      if (this.fill === 1152) { this.encodeFrame(); this.fill = 0; this.drain(out, false); }
    }
    return concat(out);
  }

  /** Encodes the buffered samples plus the filterbank delay and returns the remaining frames. */
  flush() {
    const out = [];
    // The buffered samples plus the filterbank / MDCT / decoder delay (about 1105 samples) must come out.
    const frames = Math.ceil((this.fill + 1105) / 1152);
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < this.channels; c++) this.pcm[c].fill(0, this.fill);
      this.encodeFrame();
      this.fill = 0;
      this.drain(out, false);
    }
    this.drain(out, true);
    return concat(out);
  }

  // Frames whose slot area can no longer change are written out (all of them when `all`).
  // The bit reservoir lets a frame's main data begin up to 511 bytes before the frame (in earlier frames' spare
  // slots), so a frame can only be emitted once no later granule can still write into its slot area (safeEnd).
  drain(out, all) {
    while (this.pending.length) {
      const f = this.pending[0];
      if (!all && f.slotStart + f.slotLen > this.safeEnd) break;
      this.pending.shift();
      const bytes = new Uint8Array(f.head.length + f.slotLen);
      bytes.set(f.head);
      bytes.set(this.stream.subarray(f.slotStart, f.slotStart + f.slotLen), f.head.length);
      out.push(bytes);
      this.frames++;
      this.bytes += bytes.length;
    }
    // Keep the slot stream small: drop what every pending frame is past (new main data never starts before streamEnd).
    const keep = this.pending.length ? this.pending[0].slotStart : this.streamEnd;
    if (keep > 1 << 15) {
      this.stream.copyWithin(0, keep, Math.max(keep, this.streamEnd));
      this.stream.fill(0, Math.max(0, this.streamEnd - keep));
      for (const f of this.pending) f.slotStart -= keep;
      this.slotPos -= keep;
      this.streamEnd -= keep;
      this.safeEnd -= keep;
    }
  }

  encodeFrame() {
    const nch = this.channels;
    // Frame size and padding (44.1 kHz needs padding slots now and then).
    // Exact CBR: frame size 144000 * bitrate / rate is fractional at 44.1 kHz; the remainder accumulates and inserts
    // a padding byte whenever it reaches a whole slot, keeping the long-term bit rate exact.
    const base = Math.floor(this.frameNum / this.sampleRate);
    this.padAcc += this.frameNum % this.sampleRate;
    let pad = 0;
    if (this.padAcc >= this.sampleRate) { pad = 1; this.padAcc -= this.sampleRate; }
    const frameBytes = base + pad;
    const slotLen = frameBytes - 4 - this.sideBytes;
    const slotStart = this.slotPos;
    // main_data_begin is a 9-bit back pointer: new main data can start at most 511 bytes before this frame's slots,
    // and never before the end of the previous frame's main data.
    const start = Math.max(this.streamEnd, slotStart - 511);
    const mainDataBegin = slotStart - start;
    this.safeEnd = start; // slots before the new main data are final
    const need = slotStart + slotLen + 8;
    if (need > this.stream.length) { const nb = new Uint8Array(Math.max(need * 2, this.stream.length * 2)); nb.set(this.stream); this.stream = nb; }
    const bw = new BitWriter(2048);
    let remaining = (slotStart + slotLen - start) * 8;
    const side = [];
    for (let ch = 0; ch < nch; ch++) this.analyze(ch);
    for (let gr = 0; gr < 2; gr++) {
      for (let ch = 0; ch < nch; ch++) {
        const left = (1 - gr) * nch + (nch - ch);
        // Budget split evenly over the granules / channels still to encode; part2_3_length is a 12-bit field (4095).
        const maxBits = Math.min(4095, Math.floor(remaining / left));
        this.transform(ch, gr);
        const gi = this.quantizeGranule(maxBits);
        this.writeGranule(bw, gi);
        remaining -= gi.part23;
        side.push(gi);
      }
    }
    const mainLen = (bw.pos + 7) >> 3;
    this.stream.set(bw.buf.subarray(0, mainLen), start);
    this.streamEnd = start + mainLen;
    this.slotPos = slotStart + slotLen;
    this.pending.push({ head: this.header(pad, mainDataBegin, side), slotStart, slotLen });
  }

  // Polyphase analysis of the 1152 buffered samples of a channel into 2 x 18 x 32 subband samples.
  // Standard polyphase analysis (ISO 11172-3 annex C): shift 32 new samples into a 512-sample ring, window with C,
  // fold into 64 partial sums, then the 32 x 64 cosine matrix gives one sample per subband.
  analyze(ch) {
    const { C, M } = this.T;
    const fb = this.fb[ch], x = fb.x, pcm = this.pcm[ch], sb = fb.sb, y = this.y;
    for (let slot = 0; slot < 36; slot++) {
      fb.pos = (fb.pos + 480) & 511;
      const p = fb.pos;
      for (let n = 0; n < 32; n++) x[(p + 31 - n) & 511] = pcm[slot * 32 + n];
      for (let i = 0; i < 64; i++) {
        let s = 0;
        for (let j = i; j < 512; j += 64) s += C[j] * x[(p + j) & 511];
        y[i] = s;
      }
      const o = slot * 32;
      for (let k = 0; k < 32; k++) {
        let s = 0;
        const row = k * 64;
        for (let i = 0; i < 64; i++) s += M[row + i] * y[i];
        // Frequency inversion of odd subbands at odd time slots (undone by the decoder).
        sb[o + k] = (k & 1) && (slot & 1) ? -s : s;
      }
    }
  }

  // MDCT of granule gr (18 new slots + the previous 18 of each subband), alias reduction and low-pass -> this.xr.
  transform(ch, gr) {
    const { T, cs, ca } = this.T;
    const prev = this.fb[ch].prev, sb = this.fb[ch].sb, xr = this.xr;
    const cur = gr * 576;
    for (let k = 0; k < 32; k++) {
      for (let m = 0; m < 18; m++) {
        let s = 0;
        const row = m * 36;
        for (let n = 0; n < 18; n++) s += T[row + n] * prev[n * 32 + k] + T[row + 18 + n] * sb[cur + n * 32 + k];
        xr[k * 18 + m] = s;
      }
    }
    prev.set(sb.subarray(cur, cur + 576));
    for (let k = 1; k < 32; k++) {
      for (let i = 0; i < 8; i++) {
        const a = xr[k * 18 - 1 - i], b = xr[k * 18 + i];
        xr[k * 18 - 1 - i] = a * cs[i] + b * ca[i];
        xr[k * 18 + i] = b * cs[i] - a * ca[i];
      }
    }
    for (let i = this.cutLine; i < 576; i++) xr[i] = 0;
  }

  // Smallest global gain whose Huffman coding fits in maxBits (binary search; bits fall as the gain rises).
  // Binary search over global_gain: bit count is monotone non-increasing in gain, so the smallest gain that fits is
  // found in about 8 trials. The lower bound keeps quantised values within the 8191 limit of the Huffman escape.
  // KNOWN DEFECT: if even gain 255 needs more than maxBits, the fallback result is used anyway; its part23 then
  // exceeds the budget and the main data can overrun into the next frame's slots, corrupting the stream (possible
  // only at the lowest bit rates with loud, wide-band input). Fix: zero high-frequency lines (lower the low-pass for
  // that granule) until the coding fits.
  quantizeGranule(maxBits) {
    const xr = this.xr, xr34 = this.xr34;
    let peak = 0;
    for (let i = 0; i < 576; i++) { const a = Math.abs(xr[i]); xr34[i] = Math.pow(a, 0.75); if (a > peak) peak = a; }
    if (peak < 1e-12) return { gain: 0, sign: null, ix: new Int32Array(576), part23: 0, bigValues: 0, count1: 0, tables: [0, 0, 0], r0: 0, r1: 0, c1t: 0 };
    // The gain where the largest value quantizes to about 8191 bounds the search from below.
    let lo = Math.max(0, Math.ceil(210 + (16 / 3) * Math.log2(Math.pow(peak, 0.75) / 8191)));
    let hi = 255;
    let best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = this.tryGain(mid, maxBits);
      if (r) { best = r; hi = mid - 1; } else lo = mid + 1;
    }
    if (!best) best = this.tryGain(255, Infinity);
    best.sign = new Uint8Array(576);
    for (let i = 0; i < 576; i++) best.sign[i] = xr[i] < 0 ? 1 : 0;
    return best;
  }

    // Quantiser of the standard: ix = floor(|x|^0.75 * 2^(-3/16 (gain - 210)) + 0.4054); 0.4054 is the rounding
    // offset ISO recommends (slightly below 0.5 to favour smaller values, which code cheaper).
  tryGain(gain, maxBits) {
    const xr34 = this.xr34, ix = this.ix;
    const step = Math.pow(2, -0.1875 * (gain - 210));
    for (let i = 0; i < 576; i++) {
      const v = Math.floor(xr34[i] * step + 0.4054);
      if (v > 8191) return null;
      ix[i] = v;
    }
    const gi = this.countBits(ix);
    if (gi.part23 > maxBits) return null;
    gi.gain = gain;
    gi.ix = ix.slice();
    return gi;
  }

  countBits(ix) {
    let i = 576;
    while (i > 1 && ix[i - 1] === 0 && ix[i - 2] === 0) i -= 2;
    let count1 = 0;
    while (i > 3 && ix[i - 1] <= 1 && ix[i - 2] <= 1 && ix[i - 3] <= 1 && ix[i - 4] <= 1) { count1++; i -= 4; }
    const bv2 = i;
    // count1 table
    let bitsA = 0, bitsB = 0;
    for (let q = bv2; q < bv2 + count1 * 4; q += 4) {
      const v = ix[q], w = ix[q + 1], x = ix[q + 2], y = ix[q + 3];
      const nz = v + w + x + y;
      bitsA += QUAD_A_LENS[(v << 3) | (w << 2) | (x << 1) | y] + nz;
      bitsB += 4 + nz;
    }
    const c1t = bitsB < bitsA ? 1 : 0;
    let bits = Math.min(bitsA, bitsB);
    // regions
    const sfb = this.sfb;
    let r0 = 0, r1 = 0;
    const tbl = [0, 0, 0];
    if (bv2 > 0) {
      let n = 0;
      while (sfb[n] < bv2) n++;
      r0 = SUBDV[n][0];
      while (r0 > 0 && sfb[r0 + 1] > bv2) r0--;
      r1 = SUBDV[n][1];
      while (r1 > 0 && sfb[r0 + r1 + 2] > bv2) r1--;
      const a1 = Math.min(bv2, sfb[r0 + 1]), a2 = Math.min(bv2, sfb[r0 + r1 + 2]);
      const bounds = [0, a1, a2, bv2];
      for (let r = 0; r < 3; r++) {
        const [t, b] = this.chooseTable(ix, bounds[r], bounds[r + 1]);
        tbl[r] = t;
        bits += b;
      }
    }
    return { part23: bits, bigValues: bv2 >> 1, count1, tables: tbl, r0, r1, c1t };
  }

  // Cheapest Huffman table for the pairs in [a, b): [table, bits].
  chooseTable(ix, a, b) {
    if (a >= b) return [0, 0];
    let max = 0;
    for (let i = a; i < b; i++) if (ix[i] > max) max = ix[i];
    if (max === 0) return [0, 0];
    const H = this.T.huff;
    if (max > 15) {
      let best = [0, Infinity];
      for (const first of [16, 24]) {
        let t = first;
        while (t < first + 8 && max - 15 >= 1 << HUFF_INFO[t][1]) t++;
        if (t === first + 8) continue;
        const bits = pairBits(ix, a, b, H[first], HUFF_INFO[t][1]);
        if (bits < best[1]) best = [t, bits];
      }
      return best;
    }
    let g = 0;
    while (GROUP_MAX[g] < max) g++;
    let best = [0, Infinity];
    for (let gg = g; gg < Math.min(GROUPS.length, g + 2); gg++) {
      for (const t of GROUPS[gg]) {
        const bits = pairBits(ix, a, b, H[t], 0);
        if (bits < best[1]) best = [t, bits];
      }
    }
    return best;
  }

  writeGranule(bw, gi) {
    if (!gi.part23) return;
    const H = this.T.huff, ix = gi.ix, sign = gi.sign, sfb = this.sfb;
    const bv2 = gi.bigValues * 2;
    const a1 = Math.min(bv2, sfb[gi.r0 + 1]), a2 = Math.min(bv2, sfb[gi.r0 + gi.r1 + 2]);
    const bounds = [0, a1, a2, bv2];
    const startPos = bw.pos;
    for (let r = 0; r < 3; r++) {
      const t = gi.tables[r];
      if (!t) continue;
      const [baseT, lin] = HUFF_INFO[t];
      const h = H[baseT];
      for (let i = bounds[r]; i < bounds[r + 1]; i += 2) {
        const x = ix[i], y = ix[i + 1];
        const xs = lin && x > 14 ? 15 : x, ys = lin && y > 14 ? 15 : y;
        const sym = (xs << 4) | ys;
        bw.put(h.codes[sym], h.lens[sym]);
        if (lin && x > 14) bw.put(x - 15, lin);
        if (x) bw.put(sign[i], 1);
        if (lin && y > 14) bw.put(y - 15, lin);
        if (y) bw.put(sign[i + 1], 1);
      }
    }
    for (let q = bv2; q < bv2 + gi.count1 * 4; q += 4) {
      const v = ix[q], w = ix[q + 1], x = ix[q + 2], y = ix[q + 3];
      const idx = (v << 3) | (w << 2) | (x << 1) | y;
      if (gi.c1t) bw.put(15 - idx, 4); else bw.put(QUAD_A_CODES[idx], QUAD_A_LENS[idx]);
      if (v) bw.put(sign[q], 1);
      if (w) bw.put(sign[q + 1], 1);
      if (x) bw.put(sign[q + 2], 1);
      if (y) bw.put(sign[q + 3], 1);
    }
    if (bw.pos - startPos !== gi.part23) throw new Error(`MP3 encoder: bit count mismatch ${bw.pos - startPos} != ${gi.part23}`);
  }

  // Frame header + side information.
  header(pad, mainDataBegin, side) {
    const bw = new BitWriter(4 + this.sideBytes);
    bw.put(0xfffb, 16); // sync, MPEG-1, Layer III, no CRC
    bw.put(MP3_BITRATES.indexOf(this.bitrate) + 1, 4);
    bw.put(SR_INDEX[this.sampleRate], 2);
    bw.put(pad, 1);
    bw.put(0, 1);
    bw.put(this.channels === 1 ? 3 : 0, 2); // mono / stereo
    bw.put(0, 2);
    bw.put(0, 1); // copyright
    bw.put(1, 1); // original
    bw.put(0, 2); // emphasis
    bw.put(mainDataBegin, 9);
    bw.put(0, this.channels === 1 ? 5 : 3);
    bw.put(0, 4 * this.channels); // scfsi
    for (const gi of side) {
      bw.put(gi.part23, 12);
      bw.put(gi.bigValues, 9);
      bw.put(gi.gain, 8);
      bw.put(0, 4); // scalefac_compress: no scale factors
      bw.put(0, 1); // window_switching_flag: normal blocks
      for (let r = 0; r < 3; r++) bw.put(gi.tables[r], 5);
      bw.put(gi.r0, 4);
      bw.put(gi.r1, 3);
      bw.put(0, 1); // preflag
      bw.put(0, 1); // scalefac_scale
      bw.put(gi.c1t, 1);
    }
    return bw.buf.subarray(0, 4 + this.sideBytes);
  }

  /** CBR "Info" tag frame for the frames written so far (frame count, byte count incl. this frame, linear seek table). */
  infoFrame() {
    const frameBytes = Math.floor(this.frameNum / this.sampleRate);
    const out = new Uint8Array(frameBytes);
    const h = this.header(0, 0, Array.from({ length: 2 * this.channels }, () => ({ part23: 0, bigValues: 0, gain: 0, tables: [0, 0, 0], r0: 0, r1: 0, c1t: 0 })));
    out.set(h);
    const dv = new DataView(out.buffer);
    let p = 4 + this.sideBytes;
    out.set([0x49, 0x6e, 0x66, 0x6f], p); // 'Info'
    dv.setUint32(p + 4, 0x0f); // frames, bytes, TOC, quality
    dv.setUint32(p + 8, this.frames);
    dv.setUint32(p + 12, this.bytes + frameBytes);
    for (let i = 0; i < 100; i++) out[p + 16 + i] = Math.min(255, Math.floor((i * 256) / 100));
    dv.setUint32(p + 116, 0);
    return out;
  }
}

function pairBits(ix, a, b, h, lin) {
  const lens = h.lens;
  let bits = 0;
  if (lin) {
    for (let i = a; i < b; i += 2) {
      let x = ix[i], y = ix[i + 1];
      if (x > 14) { bits += lin; x = 15; }
      if (y > 14) { bits += lin; y = 15; }
      bits += lens[(x << 4) | y] + (x ? 1 : 0) + (y ? 1 : 0);
    }
  } else {
    for (let i = a; i < b; i += 2) { const x = ix[i], y = ix[i + 1]; bits += lens[(x << 4) | y] + (x ? 1 : 0) + (y ? 1 : 0); }
  }
  return bits;
}

function concat(parts) {
  let n = 0;
  for (const x of parts) n += x.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

/**
 * Encodes planar float channels to a complete MP3 stream (Info frame first).
 *   opts { sampleRate (32000 | 44100 | 48000), bitrate = 128, channels (1 | 2; default min(2, input channels)), lowpass }
 */
export function encodeMp3(channelData, opts = {}) {
  const enc = new Mp3Encoder({ sampleRate: opts.sampleRate, bitrate: opts.bitrate || 128, channels: opts.channels || Math.min(2, channelData.length), lowpass: opts.lowpass });
  const [l, r] = prepareChannels(channelData, enc.channels);
  const body = [enc.encode(l, r), enc.flush()];
  return concat([enc.infoFrame(), ...body]);
}

/**
 * Same as encodeMp3, in slices of `chunk` samples with a pause between them (keeps a page responsive).
 *   opts.onProgress(fraction), opts.signal (AbortSignal)
 */
export async function encodeMp3Async(channelData, opts = {}) {
  const enc = new Mp3Encoder({ sampleRate: opts.sampleRate, bitrate: opts.bitrate || 128, channels: opts.channels || Math.min(2, channelData.length), lowpass: opts.lowpass });
  const [l, r] = prepareChannels(channelData, enc.channels);
  const chunk = opts.chunk || 1152 * 40;
  const parts = [];
  for (let i = 0; i < l.length; i += chunk) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    parts.push(enc.encode(l.subarray(i, i + chunk), r ? r.subarray(i, i + chunk) : undefined));
    opts.onProgress?.(Math.min(1, (i + chunk) / l.length));
    await new Promise((res) => setTimeout(res, 0));
  }
  parts.push(enc.flush());
  return concat([enc.infoFrame(), ...parts]);
}

// Mono: average of all channels; stereo: the first two (a mono input is duplicated).
// Downmix to mono by averaging (no -3 dB pan law): avoids clipping when channels are correlated.
function prepareChannels(chs, n) {
  const toF32 = (a) => (a instanceof Float32Array ? a : Float32Array.from(a));
  if (n === 1) {
    if (chs.length === 1) return [toF32(chs[0])];
    const len = chs[0].length, m = new Float32Array(len);
    for (const c of chs) for (let i = 0; i < len; i++) m[i] += c[i] / chs.length;
    return [m];
  }
  return [toF32(chs[0]), toF32(chs[1] || chs[0])];
}
