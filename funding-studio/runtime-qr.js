// funding-studio/runtime-qr.js - QR codes drawn by exported pages for texts known only in the browser (a payment URI
// with the amount the donor picked, a per-visitor address, the page URL to share). A runtime feature: one function
// serialized into the page, so it carries its own copy of the encoder of qr/qr.js (ISO/IEC 18004, error correction
// level M, numeric / alphanumeric / byte mode, smallest version, best of the eight masks by the standard penalty).
// test.js checks that R.qrMatrix(text) equals qrMatrix(text, 'M') of qr/qr.js for many texts.
//
//   R.qrMatrix(text) -> boolean[][]        R.qr(text, title) -> '<svg …>' (dark modules on white, 2-module margin)

// Why a second copy instead of importing qr/qr.js: runtime features are serialized one function at a time and may
// reference nothing outside themselves; the equality test in test.js keeps the two encoders from drifting.
// Level M (~15 % recovery) balances density against damage tolerance for phone-screen and print scanning.
function rtQr(R) {
  // Tables for error correction level M, index = version - 1: EC codewords per block, number of blocks.
  var ECC = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  var BLK = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  var ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  // GF(256) arithmetic with the QR primitive polynomial x^8+x^4+x^3+x^2+1 (0x11d). EXP is doubled to 512 entries so
  // mul() can index LOG[a]+LOG[b] (max 508) without a modulo.
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  var GEN = {};
  function gen(n) {
    if (GEN[n]) return GEN[n];
    var g = [1];
    for (var i = 0; i < n; i++) {
      var ng = [];
      for (var k = 0; k <= g.length; k++) ng.push(0);
      for (var j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); }
      g = ng;
    }
    GEN[n] = g;
    return g;
  }
  // Reed-Solomon remainder by polynomial long division (LFSR form): the n EC codewords appended to a data block.
  // gen(n) = product of (x - a^i), i < n, memoised per n.
  function rsRem(data, n) {
    var g = gen(n);
    var rem = [];
    for (var i = 0; i < n; i++) rem.push(0);
    for (var k = 0; k < data.length; k++) {
      var f = data[k] ^ rem.shift();
      rem.push(0);
      for (var j = 0; j < n; j++) rem[j] ^= mul(g[j + 1], f);
    }
    return rem;
  }
  // Data-carrying modules of version v (closed form: total area minus finders, timing, alignment, format/version
  // areas), from which codeword capacity follows. ccBits: character-count field width per mode and version band.
  function rawModules(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) { var na = Math.floor(v / 7) + 2; r -= (25 * na - 10) * na - 55; if (v >= 7) r -= 36; }
    return r;
  }
  function dataCw(v) { return (rawModules(v) >> 3) - ECC[v - 1] * BLK[v - 1]; }
  function ccBits(mode, v) {
    var t = mode === 1 ? [10, 12, 14] : mode === 2 ? [9, 11, 13] : [8, 16, 16];
    return t[v < 10 ? 0 : v < 27 ? 1 : 2];
  }
  function align(v) {
    if (v === 1) return [];
    var n = Math.floor(v / 7) + 2;
    var size = v * 4 + 17;
    var step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
    var out = [6];
    for (var p = size - 7; out.length < n; p -= step) out.splice(1, 0, p);
    return out;
  }
  // Format info: 5 bits (EC level, mask) + 10-bit BCH(15,5) remainder with generator 0x537, XORed with 0x5412 so the
  // word is never all zeros. Version info (v >= 7): 6 bits + 12-bit BCH(18,6) with generator 0x1f25.
  function formatWord(mask) {
    var d = (0 << 3) | (mask & 7); // level M = 00
    var r = d;
    for (var i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    return ((d << 10) | r) ^ 0x5412;
  }
  function versionWord(v) {
    var r = v;
    for (var i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    return (v << 12) | r;
  }
  function maskBit(k, y, x) {
    switch (k) {
      case 0: return (y + x) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (y + x) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((y * x) % 2) + ((y * x) % 3) === 0;
      case 6: return (((y * x) % 2) + ((y * x) % 3)) % 2 === 0;
      default: return (((y + x) % 2) + ((y * x) % 3)) % 2 === 0;
    }
  }
  // Single-segment mode choice: numeric (10 bits per 3 digits) < alphanumeric (11 bits per 2 chars) < byte (UTF-8).
  // Payment URIs are mixed case, so they end up in byte mode; an all-digit or upper-case text gets the denser modes.
  // (Mixed-mode segmentation would be smaller but adds complexity for little gain on short URIs.)
  function segment(text) {
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    var i;
    if (text && /^[0-9]*$/.test(text)) {
      for (i = 0; i < text.length; i += 3) { var g = text.slice(i, i + 3); put(+g, g.length * 3 + 1); }
      return { mode: 1, count: text.length, bits: bits };
    }
    if (text && /^[0-9A-Z $%*+\-./:]*$/.test(text)) {
      for (i = 0; i < text.length; i += 2) {
        var a = ALNUM.indexOf(text[i]);
        if (i + 1 < text.length) put(a * 45 + ALNUM.indexOf(text[i + 1]), 11); else put(a, 6);
      }
      return { mode: 2, count: text.length, bits: bits };
    }
    var bytes = new TextEncoder().encode(text);
    for (i = 0; i < bytes.length; i++) put(bytes[i], 8);
    return { mode: 4, count: bytes.length, bits: bits };
  }
  function encode(text) {
    var seg = segment(text);
    var v = 1;
    var cap = 0;
    for (; ; v++) {
      if (v > 40) throw new RangeError('QR: data too long');
      var cc = ccBits(seg.mode, v);
      cap = dataCw(v) * 8;
      if (seg.count < Math.pow(2, cc) && 4 + cc + seg.bits.length <= cap) break;
    }
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(seg.mode, 4);
    put(seg.count, ccBits(seg.mode, v));
    for (var k = 0; k < seg.bits.length; k++) bits.push(seg.bits[k]);
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }
    for (var p = 0xec; data.length < cap / 8; p ^= 0xec ^ 0x11) data.push(p);
    return { v: v, data: data };
  }
  // Split data into blocks (the last nb - nShort blocks are one codeword longer), add RS codewords per block, then
  // interleave column-wise (data first, EC after) so a local smudge damages a little of many blocks, not one block.
  function interleave(data, v) {
    var nb = BLK[v - 1];
    var ecLen = ECC[v - 1];
    var raw = rawModules(v) >> 3;
    var nShort = nb - (raw % nb);
    var shortLen = Math.floor(raw / nb);
    var blocks = [];
    var k = 0;
    for (var i = 0; i < nb; i++) {
      var len = shortLen - ecLen + (i < nShort ? 0 : 1);
      var d = data.slice(k, k + len);
      k += len;
      blocks.push([d, rsRem(d, ecLen)]);
    }
    var out = [];
    var b;
    for (i = 0; i <= shortLen - ecLen; i++) for (b = 0; b < blocks.length; b++) if (i < blocks[b][0].length) out.push(blocks[b][0][i]);
    for (i = 0; i < ecLen; i++) for (b = 0; b < blocks.length; b++) out.push(blocks[b][1][i]);
    return out;
  }
  function drawFormat(m, fn, mask) {
    var size = m.length;
    var bits = formatWord(mask);
    function set(x, y, i) { m[y][x] = ((bits >>> i) & 1) === 1; fn[y][x] = true; }
    var i;
    for (i = 0; i <= 5; i++) set(8, i, i);
    set(8, 7, 6); set(8, 8, 7); set(7, 8, 8);
    for (i = 9; i < 15; i++) set(14 - i, 8, i);
    for (i = 0; i < 8; i++) set(size - 1 - i, 8, i);
    for (i = 8; i < 15; i++) set(8, size - 15 + i, i);
    m[size - 8][8] = true; fn[size - 8][8] = true;
  }
  // ISO 18004 mask penalty: N1 runs of >= 5 same-colour modules (3 + extra), N2 2x2 blocks (3 each), N3 finder-like
  // 1:1:3:1:1 patterns with 4 light modules on a side (40 each), N4 dark-ratio deviation from 50 % (10 per 5 %).
  // The mask with the lowest score is chosen; it avoids patterns that confuse scanners' finder detection.
  function penalty(m) {
    var size = m.length;
    var p = 0;
    var dark = 0;
    function line(get) {
      var run = 0;
      var prev = null;
      var i;
      for (i = 0; i < size; i++) {
        var c = get(i);
        if (c === prev) run++;
        else { if (run >= 5) p += run - 2; run = 1; prev = c; }
      }
      if (run >= 5) p += run - 2;
      function at(j) { return j >= 0 && j < size ? get(j) : false; }
      for (i = -4; i <= size; i++) {
        if (at(i) || at(i + 1) || at(i + 2) || at(i + 3)) continue;
        if (at(i + 4) && !at(i + 5) && at(i + 6) && at(i + 7) && at(i + 8) && !at(i + 9) && at(i + 10)) p += 40;
        if (at(i - 7) && !at(i - 6) && at(i - 5) && at(i - 4) && at(i - 3) && !at(i - 2) && at(i - 1)) p += 40;
      }
    }
    var y;
    var x;
    for (y = 0; y < size; y++) line(function (xx) { return m[y][xx]; });
    for (x = 0; x < size; x++) line(function (yy) { return m[yy][x]; });
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) {
        var c = m[y][x];
        if (c) dark++;
        if (x < size - 1 && y < size - 1 && c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
      }
    }
    var total = size * size;
    p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return p;
  }
  // Build: function patterns first (timing, finders with separators, alignment except where finders are, format
  // placeholders, version blocks), recorded in `fn` so data placement skips them; then the zigzag placement in
  // 2-column strips from the right, skipping the vertical timing column 6; then try all 8 masks (apply, score,
  // un-apply by applying again - XOR is its own inverse) and keep the best.
  R.qrMatrix = function (text) {
    var e = encode(String(text == null ? '' : text));
    var v = e.v;
    var cw = interleave(e.data, v);
    var size = v * 4 + 17;
    var m = [];
    var fn = [];
    var i;
    var j;
    for (i = 0; i < size; i++) { m.push([]); fn.push([]); for (j = 0; j < size; j++) { m[i].push(false); fn[i].push(false); } }
    function set(x, y, d) { m[y][x] = d; fn[y][x] = true; }
    for (i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    var corners = [[3, 3], [size - 4, 3], [3, size - 4]];
    for (var c = 0; c < 3; c++) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var x = corners[c][0] + dx;
          var y = corners[c][1] + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          var dd = Math.max(Math.abs(dx), Math.abs(dy));
          set(x, y, dd !== 2 && dd !== 4);
        }
      }
    }
    var ap = align(v);
    var last = ap.length - 1;
    for (i = 0; i <= last; i++) {
      for (j = 0; j <= last; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        for (var ay = -2; ay <= 2; ay++) for (var ax = -2; ax <= 2; ax++) set(ap[i] + ax, ap[j] + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
      }
    }
    drawFormat(m, fn, 0);
    if (v >= 7) {
      var vb = versionWord(v);
      for (i = 0; i < 18; i++) {
        var bit = ((vb >>> i) & 1) === 1;
        var a = size - 11 + (i % 3);
        var b = Math.floor(i / 3);
        set(a, b, bit); set(b, a, bit);
      }
    }
    var n = 0;
    var nbits = cw.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      var up = ((right + 1) & 2) === 0;
      for (var k = 0; k < size; k++) {
        var yy = up ? size - 1 - k : k;
        for (var t = 0; t < 2; t++) {
          var xx = right - t;
          if (fn[yy][xx]) continue;
          if (n < nbits) m[yy][xx] = ((cw[n >>> 3] >>> (7 - (n & 7))) & 1) === 1;
          n++;
        }
      }
    }
    function applyMask(q) {
      for (var y2 = 0; y2 < size; y2++) for (var x2 = 0; x2 < size; x2++) if (!fn[y2][x2] && maskBit(q, y2, x2)) m[y2][x2] = !m[y2][x2];
    }
    var best = 0;
    var bestP = Infinity;
    for (var q = 0; q < 8; q++) {
      applyMask(q);
      drawFormat(m, fn, q);
      var pp = penalty(m);
      if (pp < bestP) { bestP = pp; best = q; }
      applyMask(q);
    }
    applyMask(best);
    drawFormat(m, fn, best);
    return m;
  };
  // SVG with one path, horizontal runs merged (far fewer commands than one rect per module), crispEdges against
  // anti-aliased seams, explicit white background so dark themes do not invert contrast. Title escaped as numeric
  // character references; without a title the image is decorative (aria-hidden).
  // Caveat: the margin is 2 modules, below the 4-module quiet zone of the standard; it relies on the page's white
  // panel around the code. Scanners usually cope, but a dark background directly around the SVG would not.
  R.qr = function (text, title) {
    var m = R.qrMatrix(text);
    var nn = m.length;
    var w = nn + 4;
    var d = '';
    for (var y = 0; y < nn; y++) {
      for (var x = 0; x < nn; x++) {
        if (!m[y][x]) continue;
        var x0 = x;
        while (x < nn && m[y][x]) x++;
        d += 'M' + (x0 + 2) + ' ' + (y + 2) + 'h' + (x - x0) + 'v1h-' + (x - x0) + 'z';
      }
    }
    var esc = String(title || '').replace(/[&<>"']/g, function (ch) { return '&#' + ch.charCodeAt(0) + ';'; });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + w + '" shape-rendering="crispEdges"'
      + (esc ? ' role="img"><title>' + esc + '</title>' : ' aria-hidden="true">')
      + '<rect width="' + w + '" height="' + w + '" fill="#fff"/><path fill="#000" d="' + d + '"/></svg>';
  };
}

export { rtQr };
