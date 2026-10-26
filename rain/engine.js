// rain/engine.js - the digital rain renderer (canvas 2D, glyph atlas, depth layers, bloom, message reveal).
//
// rainEngine(canvas, params, options) -> controller. The function is self-contained: it references only its
// parameters, its own locals and browser globals, so exported pages embed it with Function.prototype.toString
// (rain/export.js). Nothing runs at module evaluation, so the module imports in Node.
//
//   params   engine parameters (rain/params.js engineParams(): normalized + `chars`, the glyph string)
//   options  { auto: start the animation loop now, width / height / dpr: fixed-size (offscreen) rendering
//              instead of following the canvas' CSS box, ignoreReducedMotion: animate even when the system asks
//              for reduced motion (the creator's preview; the parameter `motion` decides in exported pages) }
//
// Controller: set(params), start(), stop(), toggle(), step(dt), advance(seconds), render(), resize(), destroy(),
// ready() -> Promise (background image decoded), and the read-only running / fps / reduced / canvas.
//
// Each layer is a grid of columns; every column keeps a glyph buffer that falling streams "write" as their head
// enters a row (and that mutates randomly). A frame redraws the visible trail of every stream from a pre-rendered
// glyph atlas (one row per colour tone, glow baked in), so trails fade identically at any frame rate and the
// background can be a colour, an image or transparent. Bloom is a downscaled copy of the rain layer added on top.
//
// Performance model: text rendering with shadows is the expensive operation, so every glyph x tone is rasterised
// once into an atlas and a frame is only drawImage blits (thousands per frame are cheap). Atlases are rebuilt only
// when a parameter that changes glyph pixels changes (see apply()). Streams and glyph buffers live in typed arrays.
// Determinism: with a non-zero seed, the PRNG is reset, so stills are reproducible for the same sequence of
// update / draw calls; draw() itself consumes random numbers (head sparkle, flicker), so the frame count matters.
export function rainEngine(canvas, params, options) {
  const opt = options || {};
  const win = typeof window !== 'undefined' ? window : null;
  const doc = typeof document !== 'undefined' ? document : null;
  const ctx = canvas.getContext('2d');
  const FONTS = {
    gothic: '"MS Gothic","Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans Mono CJK JP","Noto Sans CJK JP",ui-monospace,monospace',
    mono: 'ui-monospace,"Cascadia Mono","SF Mono",Menlo,Consolas,"DejaVu Sans Mono","MS Gothic",monospace',
    sans: 'system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans","MS Gothic",sans-serif',
    serif: 'Georgia,"Times New Roman","Noto Serif","MS Mincho",serif',
  };
  // 4096 px: the texture size every current GPU accepts for canvas-backed images; larger canvases may fail or fall
  // back to slow software paths.
  const ATLAS_MAX = 4096;
  const TONES = 8;      // gradient tones of a trail (plus the head)
  const HUES = 12;      // rainbow hues
  const SPARE = 2;      // hidden columns on each side, room for the parallax shift

  let P = {};
  let W = 1, H = 1, DPR = 1;
  let layers = [];
  let glyphs = [], baseCount = 1;
  let atH = null, atB = null;   // glyph atlases of the head tone and of the trail tones: { cv, cs (cell px), cpr }
  let rainCanvas = null, rctx = null, bloomCanvas = null, bctx = null;
  let msg = null;       // { lay, cells: Int32Array, on: Uint8Array, lit: Float32Array, glyph: Int16Array|null, phase, t }
  let bgImg = null, bgPromise = Promise.resolve();
  let raf = 0, running = false, last = 0, acc = 0, time = 0;
  let fpsVal = 0, fpsN = 0, fpsT = 0;
  let pointerX = 0.5, offX = 0;
  let ro = null, destroyed = false;
  let rs = (Math.random() * 4294967296) >>> 0;
  const reduceMQ = win && win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;

  // mulberry32: fast, good enough for visuals, seedable for reproducible stills.
  function rnd() {
    rs = (rs + 0x6D2B79F5) | 0;
    let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const num = (v, d, a, b) => { v = Number(v); if (!isFinite(v)) v = d; return Math.min(b, Math.max(a, v)); };
  function hex(c, d) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim());
    if (!m) return d;
    let s = m[1];
    if (s.length === 3) s = s.replace(/./g, '$&$&');
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  }
  const css = (a) => 'rgb(' + a.map((v) => Math.round(v)).join(',') + ')';
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  function newCanvas(w, h) {
    if (doc) { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; }
    return new OffscreenCanvas(w, h);
  }
  function graphemes(s) {
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment);
    } catch (e) { /* older engines */ }
    return Array.from(s);
  }
  const reduced = () => !opt.ignoreReducedMotion && P.motion !== 'ignore' && !!(reduceMQ && reduceMQ.matches);

  function readParams(p) {
    p = p || {};
    return {
      chars: String(p.chars || '01'), font: FONTS[p.font] ? p.font : 'gothic', bold: !!p.bold, mirror: !!p.mirror,
      size: num(p.size, 18, 4, 160), spacing: num(p.spacing, 1, 0.4, 4), drops: num(p.drops, 1, 0.02, 6),
      speed: num(p.speed, 12, 0.1, 200), variance: num(p.variance, 0.5, 0, 1), trail: num(p.trail, 20, 1, 200),
      fade: num(p.fade, 1.5, 0.1, 8), mutate: num(p.mutate, 0.5, 0, 20), flicker: num(p.flicker, 0, 0, 1),
      direction: p.direction === 'up' ? 'up' : 'down', colorMode: p.colorMode === 'rainbow' ? 'rainbow' : 'gradient',
      color1: hex(p.color1, [93, 255, 138]), color2: hex(p.color2, [0, 86, 27]), head: hex(p.head, [232, 255, 233]),
      rainbowSpeed: num(p.rainbowSpeed, 0.1, 0, 5), glow: num(p.glow, 0.5, 0, 1), headGlow: num(p.headGlow, 0.8, 0, 1),
      bloom: num(p.bloom, 0, 0, 1), bgMode: ['color', 'transparent', 'image'].indexOf(p.bgMode) >= 0 ? p.bgMode : 'color',
      bg: hex(p.bg, [0, 0, 0]), bgImage: /^data:image\//.test(p.bgImage || '') ? p.bgImage : '', bgDim: num(p.bgDim, 0.5, 0, 1),
      layers: Math.round(num(p.layers, 1, 1, 3)), depth: num(p.depth, 0.5, 0, 1), parallax: num(p.parallax, 0, 0, 1),
      msg: String(p.msg || '').slice(0, 80), msgStyle: p.msgStyle === 'inline' ? 'inline' : 'big', msgHold: num(p.msgHold, 6, 0, 600),
      fps: num(p.fps, 0, 0, 240), motion: p.motion === 'ignore' ? 'ignore' : 'respect', seed: num(p.seed, 0, 0, 4294967295),
    };
  }

  // ---- geometry -------------------------------------------------------------------------------------------
  function measure() {
    if (opt.width) {
      W = Math.max(1, opt.width); H = Math.max(1, opt.height || opt.width); DPR = opt.dpr || 1;
    } else {
      const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: canvas.width, height: canvas.height };
      W = Math.max(1, r.width || canvas.clientWidth || 300);
      H = Math.max(1, r.height || canvas.clientHeight || 150);
      DPR = Math.min(2, (win && win.devicePixelRatio) || 1);
    }
    const cw = Math.max(1, Math.round(W * DPR)), ch = Math.max(1, Math.round(H * DPR));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    if (!rainCanvas) { rainCanvas = newCanvas(cw, ch); rctx = rainCanvas.getContext('2d'); }
    if (rainCanvas.width !== cw) rainCanvas.width = cw;
    if (rainCanvas.height !== ch) rainCanvas.height = ch;
  }

  // ---- glyph atlases: tone rows x glyph columns, wrapped at ATLAS_MAX px ------------------------------------------
  // The head (strong glow, wide cells) and the trail tones (tighter cells: most draws, so cheaper) are kept apart.
  // Cell size includes padding for the baked glow (shadowBlur spreads beyond the glyph box). Mirroring (the film's
  // look) applies only to glyphs from the sets, never to inline message letters (g >= baseCount).
  function makeAtlas(old, tones, glow) {
    const size = P.size * DPR;
    const pad = Math.ceil(size * 0.55 * glow) + 2;
    const cs = Math.ceil(size * 1.3) + pad * 2;
    const total = glyphs.length * tones.length, cpr = Math.max(1, Math.floor(ATLAS_MAX / cs));
    const w = Math.min(total, cpr) * cs, h = Math.ceil(total / cpr) * cs;
    const cv = old ? old.cv : newCanvas(w, h);
    cv.width = w; cv.height = h;
    const a = cv.getContext('2d');
    a.clearRect(0, 0, w, h);
    a.font = (P.bold ? 'bold ' : '') + size + 'px ' + FONTS[P.font];
    a.textAlign = 'center';
    a.textBaseline = 'middle';
    for (let t = 0; t < tones.length; t++) {
      const tone = tones[t];
      const col = tone.c ? css(tone.c) : 'hsl(' + tone.hsl + ',100%,62%)';
      for (let g = 0; g < glyphs.length; g++) {
        const i = t * glyphs.length + g;
        a.save();
        a.translate((i % cpr) * cs + cs / 2, Math.floor(i / cpr) * cs + cs / 2);
        if (P.mirror && g < baseCount) a.scale(-1, 1);
        a.fillStyle = col;
        a.shadowColor = col;
        a.shadowBlur = tone.g * size * 0.55;
        a.fillText(glyphs[g], 0, 0);
        if (tone.g > 0.5) { a.shadowBlur = tone.g * size * 0.18; a.fillText(glyphs[g], 0, 0); }
        a.restore();
      }
    }
    return { cv, cs, cpr };
  }
  function buildAtlas() {
    let base = [];
    const seen = new Set();
    for (const g of graphemes(P.chars)) if (g.trim() && !seen.has(g)) { seen.add(g); base.push(g); }
    if (!base.length) base = ['0', '1'];
    if (base.length > 160) base = base.slice(0, 160);
    // Inline message letters get their own atlas entries: never mirrored, and possibly outside the glyph sets.
    let extra = [];
    if (P.msg && P.msgStyle === 'inline') extra = [...new Set(graphemes(P.msg).filter((g) => g.trim() && g !== '|'))];
    const body = [];
    if (P.colorMode === 'rainbow') {
      for (let i = 0; i < HUES; i++) body.push({ hsl: i * (360 / HUES), g: P.glow * 0.7 });
    } else {
      for (let i = 0; i < TONES; i++) body.push({ c: mix(P.color1, P.color2, i / (TONES - 1)), g: P.glow * (0.7 - 0.4 * i / (TONES - 1)) });
    }
    // Keep each atlas within ATLAS_MAX^2: drop glyphs from the base set when a huge size meets many glyphs.
    const csMax = Math.ceil(P.size * DPR * 1.3) + 2 * (Math.ceil(P.size * DPR * 0.55 * Math.max(P.glow, P.headGlow)) + 2);
    // Cells that fit in ATLAS_MAX^2 divided by the number of tone rows: the maximum glyph count for this size.
    const room = Math.max(2, Math.floor(Math.floor((ATLAS_MAX / csMax) ** 2) / body.length));
    if (base.length + extra.length > room) { base = base.slice(0, Math.max(2, room - extra.length)); extra = extra.slice(0, room - base.length); }
    glyphs = base.concat(extra);
    baseCount = base.length;
    atH = makeAtlas(atH, [{ c: P.head, g: P.headGlow }], P.headGlow);
    atB = makeAtlas(atB, body, P.glow * 0.7);
  }

  // ---- layers and streams ------------------------------------------------------------------------------------
  const speedOf = (lay, s) => Math.max(0.3, P.speed * lay.speed * (1 + P.variance * s.u));
  function spawn(lay, initial, s) {
    s = s || {};
    s.c = Math.floor(rnd() * lay.cols);
    s.k = 0.55 + rnd() * 0.9;     // trail length factor
    s.u = rnd() * 2 - 1;          // speed deviation, scaled by the variance
    s.len = Math.max(2, P.trail * s.k);
    s.v = speedOf(lay, s);
    s.y = initial ? rnd() * (lay.rows + s.len) - 1 : -rnd() * lay.rows * 0.6 - 1;
    s.r = Math.floor(s.y);
    return s;
  }
  // Depth layers: farther layers (d -> 1) are smaller, dimmer and slower, which reads as depth without 3D; the
  // nearest layer is last so it draws on top. SPARE hidden columns on each side give parallax room to slide.
  function buildLayers() {
    layers = [];
    const L = P.layers;
    for (let i = 0; i < L; i++) {
      const d = L === 1 ? 0 : (L - 1 - i) / (L - 1);   // 1 = farthest, 0 = nearest
      const scale = 1 - P.depth * 0.5 * d;
      const cw = Math.max(2, P.size * P.spacing * 0.92 * scale);
      const ch = Math.max(2, P.size * 1.08 * scale);
      const cols = Math.ceil(W / cw) + SPARE * 2 + 1, rows = Math.ceil(H / ch) + 1;
      const lay = { d, scale, cw, ch, cols, rows, alpha: 1 - P.depth * 0.62 * d, speed: 1 - P.depth * 0.55 * d, buf: new Uint16Array(cols * rows), streams: [], macc: 0 };
      for (let j = 0; j < lay.buf.length; j++) lay.buf[j] = (rnd() * baseCount) | 0;
      const n = Math.max(1, Math.round(cols * P.drops * (1 + d * 0.35)));
      for (let k = 0; k < n; k++) lay.streams.push(spawn(lay, true));
      layers.push(lay);
    }
  }

  // ---- message: cells of the nearest layer that light up when a stream head passes -----------------------
  // The message is a mask over the nearest layer's cells: 'big' rasterises the text at one pixel per cell (alpha
  // threshold 110 / 255), 'inline' places letters as glyphs. Cells light up when a stream head passes over them, so
  // the message emerges from the rain instead of appearing.
  function buildMessage() {
    msg = null;
    const text = P.msg.replace(/\|/g, '\n').trim();
    if (!text || !layers.length) return;
    const lay = layers[layers.length - 1];
    const cols = lay.cols, rows = lay.rows, n = cols * rows;
    const on = new Uint8Array(n), lit = new Float32Array(n), mask = new Uint8Array(n);
    let glyph = null;
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4);
    const toRow = (sr) => (P.direction === 'up' ? rows - 1 - sr : sr);
    // Visible columns start at index SPARE (hidden columns each side leave room for the parallax shift).
    const visCols = Math.max(1, Math.floor(W / lay.cw)), visRows = Math.max(1, Math.floor(H / lay.ch));
    if (P.msgStyle === 'inline') {
      glyph = new Int16Array(n).fill(-1);
      const top = Math.floor((visRows - lines.length * 2 + 1) / 2);
      lines.forEach((line, li) => {
        const gs = graphemes(line);
        const start = SPARE + Math.max(0, Math.floor((visCols - gs.length) / 2));
        gs.forEach((g, k) => {
          const c = start + k, r = toRow(top + li * 2);
          if (c >= cols - SPARE || r < 0 || r >= rows || !g.trim()) return;
          const gi = glyphs.indexOf(g, baseCount);
          if (gi < 0) return;
          mask[c * rows + r] = 1; glyph[c * rows + r] = gi;
        });
      });
    } else if (doc || typeof OffscreenCanvas !== 'undefined') {
      // Rasterise the text at one pixel per cell; cells are taller than wide, so draw in screen proportions.
      const aspect = lay.ch / lay.cw;
      const m = newCanvas(visCols, visRows);
      const g = m.getContext('2d', { willReadFrequently: true });
      const fam = 'bold %spx system-ui,"Segoe UI",Roboto,Arial,sans-serif';
      let f = 100;
      g.font = fam.replace('%s', f);
      const widest = Math.max(1, ...lines.map((l) => g.measureText(l).width));
      f = Math.min(f * visCols * 0.84 / widest, (visRows * aspect * 0.62) / (lines.length * 1.12));
      f = Math.max(3, f);
      g.setTransform(1, 0, 0, 1 / aspect, 0, 0);
      g.font = fam.replace('%s', f.toFixed(2));
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      const lh = f * 1.12, y0 = visRows * aspect / 2 - (lines.length - 1) * lh / 2;
      lines.forEach((l, i) => g.fillText(l, visCols / 2, y0 + i * lh));
      const px = g.getImageData(0, 0, visCols, visRows).data;
      for (let y = 0; y < visRows; y++) {
        for (let x = 0; x < visCols; x++) if (px[(y * visCols + x) * 4 + 3] > 110) mask[(x + SPARE) * rows + toRow(y)] = 1;
      }
    }
    const list = [];
    for (let i = 0; i < n; i++) if (mask[i]) list.push(i);
    if (!list.length) return;
    msg = { lay, cells: Int32Array.from(list), mask, on, lit, glyph, phase: 0, t: 0 };
  }
  // State machine: 0 reveal (cells light as heads pass; forced after 90 % or 9 s), 1 hold, 2 fade out, 3 pause.
  function msgUpdate(dt) {
    if (!msg) return;
    msg.t += dt;
    const cells = msg.cells;
    let litN = 0;
    for (let j = 0; j < cells.length; j++) {
      const i = cells[j];
      if (msg.phase <= 1 && msg.on[i]) msg.lit[i] = Math.min(1, msg.lit[i] + dt * 3);
      else if (msg.phase >= 2) msg.lit[i] = Math.max(0, msg.lit[i] - dt * 0.9);
      if (msg.lit[i] > 0.5) litN++;
    }
    if (msg.phase === 0 && (litN >= cells.length * 0.9 || msg.t > 9)) {
      for (let j = 0; j < cells.length; j++) msg.on[cells[j]] = 1;
      msg.phase = 1; msg.t = 0;
    } else if (msg.phase === 1 && P.msgHold > 0 && msg.t > P.msgHold) { msg.phase = 2; msg.t = 0; msg.on.fill(0); }
    else if (msg.phase === 2 && msg.t > 2) { msg.phase = 3; msg.t = 0; }
    else if (msg.phase === 3 && msg.t > 2.5) { msg.phase = 0; msg.t = 0; }
  }

  // ---- background ------------------------------------------------------------------------------------------------
  function loadBg() {
    bgImg = null;
    if (P.bgMode !== 'image' || !P.bgImage || typeof Image === 'undefined') { bgPromise = Promise.resolve(); return; }
    const img = new Image();
    bgPromise = new Promise((res) => {
      img.onload = () => { if (!destroyed) { bgImg = img; if (!running) draw(); } res(); };
      img.onerror = () => res();
    });
    img.src = P.bgImage;
  }
  function drawBg(c, w, h) {
    if (P.bgMode === 'transparent') { c.clearRect(0, 0, w, h); return; }
    c.fillStyle = css(P.bg);
    c.fillRect(0, 0, w, h);
    if (P.bgMode === 'image' && bgImg && bgImg.naturalWidth) {
      const s = Math.max(w / bgImg.naturalWidth, h / bgImg.naturalHeight);
      const iw = bgImg.naturalWidth * s, ih = bgImg.naturalHeight * s;
      c.drawImage(bgImg, (w - iw) / 2, (h - ih) / 2, iw, ih);
      if (P.bgDim > 0) { c.globalAlpha = P.bgDim; c.fillRect(0, 0, w, h); c.globalAlpha = 1; }
    }
  }

  // ---- simulation --------------------------------------------------------------------------------------------
  // Every row a head crosses this frame gets a fresh glyph (the loop covers skipped rows at low frame rates), so the
  // pattern is frame-rate independent. Random mutation count is proportional to dt and buffer size, accumulated in
  // macc so fractional mutations are not lost at high frame rates.
  function update(dt) {
    time += dt;
    const main = layers[layers.length - 1];
    for (const lay of layers) {
      for (const s of lay.streams) {
        const prev = s.r;
        s.y += s.v * dt;
        const r = Math.floor(s.y);
        if (r !== prev) {
          // The head writes a fresh glyph into every row it enters.
          for (let row = Math.max(0, prev + 1); row <= r && row < lay.rows; row++) {
            const i = s.c * lay.rows + row;
            lay.buf[i] = (rnd() * baseCount) | 0;
            if (msg && lay === main && msg.mask[i] && msg.phase === 0) msg.on[i] = 1;
          }
          s.r = r;
        }
        if (s.y - s.len > lay.rows) spawn(lay, false, s);
      }
      lay.macc += P.mutate * dt * lay.buf.length * 0.35;
      let n = lay.macc | 0;
      lay.macc -= n;
      while (n-- > 0) lay.buf[(rnd() * lay.buf.length) | 0] = (rnd() * baseCount) | 0;
    }
    msgUpdate(dt);
    const target = (pointerX - 0.5) * P.parallax * 3;
    offX += (target - offX) * Math.min(1, dt * 3);
  }

  // ---- drawing ------------------------------------------------------------------------------------------------
  // tone 0 = head, 1.. = trail tones; scale = layer scale.
  function drawGlyph(c, tone, gi, x, y, scale) {
    const A = tone ? atB : atH, i = tone ? (tone - 1) * glyphs.length + gi : gi, cs = A.cs, ds = cs * scale;
    c.drawImage(A.cv, (i % A.cpr) * cs, Math.floor(i / A.cpr) * cs, cs, cs, x - ds / 2, y - ds / 2, ds, ds);
  }
  // Trails are redrawn from scratch each frame from the glyph buffer, rather than fading the previous frame with a
  // translucent fill: that classic trick ties trail length to frame rate and cannot work over a transparent or image
  // background.
  function draw() {
    if (!atH || !rctx) return;
    const cw = canvas.width, ch = canvas.height;
    const c = rctx, up = P.direction === 'up';
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, cw, ch);
    const rainbow = P.colorMode === 'rainbow';
    for (const lay of layers) {
      const cwD = lay.cw * DPR, chD = lay.ch * DPR, ds = atH.cs * lay.scale;
      const shift = (offX * (1 - lay.d * 0.85) - SPARE) * cwD;
      const hueShift = time * P.rainbowSpeed;
      for (const s of lay.streams) {
        const x = s.c * cwD + cwD / 2 + shift;
        if (x < -ds || x > cw + ds) continue;
        const col = s.c * lay.rows, len = s.len;
        const hue = rainbow ? 1 + (((Math.floor((s.c / lay.cols + hueShift) * HUES) % HUES) + HUES) % HUES) : 0;
        for (let k = 0; k < len; k++) {
          const row = s.r - k;
          if (row < 0) break;
          if (row >= lay.rows) continue;
          let a = 1 - k / len;
          a = Math.pow(a, P.fade) * lay.alpha;
          if (k > 0 && P.flicker > 0) a *= 1 - P.flicker * rnd();
          if (a < 0.012) continue;
          let gi = lay.buf[col + row], tone;
          if (k === 0) { tone = 0; if (rnd() < 0.3) gi = (rnd() * baseCount) | 0; }
          else if (rainbow) tone = hue;
          else tone = 1 + Math.min(TONES - 1, Math.floor(((k - 1) / Math.max(1, len - 1)) * TONES));
          c.globalAlpha = a > 1 ? 1 : a;
          drawGlyph(c, tone, gi, x, ((up ? lay.rows - 1 - row : row) + 0.5) * chD, lay.scale);
        }
      }
    }
    if (msg) {
      const lay = msg.lay, rows = lay.rows, cwD = lay.cw * DPR, chD = lay.ch * DPR;
      const shift = (offX * (1 - lay.d * 0.85) - SPARE) * cwD;
      for (let j = 0; j < msg.cells.length; j++) {
        const i = msg.cells[j], a = msg.lit[i];
        if (a <= 0.01) continue;
        const col = (i / rows) | 0, row = i - col * rows;
        const gi = msg.glyph && msg.glyph[i] >= 0 ? msg.glyph[i] : lay.buf[i];
        c.globalAlpha = Math.min(1, a);
        drawGlyph(c, 0, gi, col * cwD + cwD / 2 + shift, ((up ? rows - 1 - row : row) + 0.5) * chD, lay.scale);
      }
    }
    c.globalAlpha = 1;
    // Compose: background, rain, bloom (a blurred, downscaled copy of the rain added with 'lighter').
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    drawBg(ctx, cw, ch);
    ctx.drawImage(rainCanvas, 0, 0);
    if (P.bloom > 0) {
      const bw = Math.max(1, Math.round(cw / 5)), bh = Math.max(1, Math.round(ch / 5));
      if (!bloomCanvas) { bloomCanvas = newCanvas(bw, bh); bctx = bloomCanvas.getContext('2d'); }
      if (bloomCanvas.width !== bw || bloomCanvas.height !== bh) { bloomCanvas.width = bw; bloomCanvas.height = bh; }
      bctx.clearRect(0, 0, bw, bh);
      bctx.imageSmoothingEnabled = true;
      if ('filter' in bctx) bctx.filter = 'blur(' + Math.max(1, Math.round(P.size * DPR / 12)) + 'px)';
      bctx.drawImage(rainCanvas, 0, 0, bw, bh);
      if ('filter' in bctx) bctx.filter = 'none';
      // Bloom: additive blend of a blurred 1/5-scale copy. Downscaling first makes the blur cheap (25x fewer pixels).
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = P.bloom;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bloomCanvas, 0, 0, cw, ch);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // ---- loop -------------------------------------------------------------------------------------------------------
  // dt is clamped to 0.1 s so a tab returning from the background does not teleport every stream. The fps cap
  // accumulates time and renders only when a frame interval has elapsed (2 ms tolerance for rAF jitter).
  function frame(ts) {
    raf = 0;
    if (!running || destroyed) return;
    raf = requestAnimationFrame(frame);
    if (!last) last = ts;
    let dt = (ts - last) / 1000;
    last = ts;
    if (dt <= 0) return;
    if (P.fps > 0) {
      acc += dt;
      if (acc < 1 / P.fps - 0.002) return;
      dt = acc;
      acc = 0;
    }
    if (dt > 0.1) dt = 0.1;
    update(dt);
    draw();
    fpsN++;
    fpsT += dt;
    if (fpsT >= 0.5) { fpsVal = fpsN / fpsT; fpsN = 0; fpsT = 0; }
  }
  function schedule() {
    if (!raf && running && !destroyed && !(doc && doc.hidden)) { last = 0; raf = requestAnimationFrame(frame); }
  }
  function unschedule() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function still() { advance(3); draw(); }
  function advance(sec) { for (let t = 0; t < sec; t += 1 / 30) update(1 / 30); }

  function rebuild(full) {
    measure();
    if (full) buildAtlas();
    buildLayers();
    buildMessage();
  }
  function onResize() {
    if (destroyed) return;
    const pw = W, ph = H, pd = DPR;
    measure();
    if (pw === W && ph === H && pd === DPR) return;
    rebuild(pd !== DPR);
    if (!running) draw();
  }
  function onPointer(e) { pointerX = W > 0 && win ? e.clientX / (win.innerWidth || W) : 0.5; }
  function onVisibility() { if (doc.hidden) unschedule(); else schedule(); }
  // Switching to reduced motion stops the animation and renders a still. Switching back does not restart it; the user
  // starts it again explicitly.
  function onMotionChange() { if (reduced()) { api.stop(); still(); } }

  // Three tiers of change cost: atlas rebuild (glyph pixels changed), layer rebuild (grid changed), or in-place
  // tweaks that keep the running streams, so dragging a speed slider does not reset the animation.
  function apply(p, first) {
    const prev = P;
    P = readParams(p);
    if (P.seed && (first || P.seed !== prev.seed)) rs = P.seed >>> 0;
    const changed = (keys) => first || keys.some((k) => String(prev[k]) !== String(P[k]));
    const atlasKeys = ['chars', 'font', 'bold', 'mirror', 'size', 'colorMode', 'color1', 'color2', 'head', 'glow', 'headGlow'];
    const layerKeys = ['size', 'spacing', 'drops', 'layers', 'depth'];
    const inlineMsg = P.msgStyle === 'inline' || prev.msgStyle === 'inline';
    if (changed(atlasKeys) || (inlineMsg && changed(['msg', 'msgStyle']))) { measure(); buildAtlas(); buildLayers(); buildMessage(); }
    else if (changed(layerKeys)) { measure(); buildLayers(); buildMessage(); }
    else {
      // Live tweaks keep the streams: rescale speed / length in place.
      if (changed(['speed', 'variance', 'trail'])) {
        for (const lay of layers) for (const s of lay.streams) { s.len = Math.max(2, P.trail * s.k); s.v = speedOf(lay, s); }
      }
      if (changed(['msg', 'msgStyle', 'direction'])) buildMessage();
    }
    if (changed(['bgMode', 'bgImage'])) loadBg();
  }

  const api = {
    canvas,
    get running() { return running; },
    get fps() { return Math.round(fpsVal); },
    get reduced() { return reduced(); },
    ready: () => bgPromise,
    set(p) { apply(p, false); if (!running) draw(); return api; },
    start() {
      if (destroyed) return api;
      if (reduced()) { still(); return api; }
      running = true;
      schedule();
      return api;
    },
    stop() { running = false; unschedule(); return api; },
    toggle() { return running ? api.stop() : api.start(); },
    step(dt) { update(dt || 1 / 60); draw(); return api; },
    advance(sec) { advance(sec || 0); return api; },
    render() { draw(); return api; },
    resize() { onResize(); return api; },
    destroy() {
      destroyed = true;
      api.stop();
      if (ro) ro.disconnect();
      if (win && !opt.width) { win.removeEventListener('resize', onResize); win.removeEventListener('pointermove', onPointer); }
      if (doc && !opt.width) doc.removeEventListener('visibilitychange', onVisibility);
      if (reduceMQ && reduceMQ.removeEventListener && !opt.width) reduceMQ.removeEventListener('change', onMotionChange);
    },
  };

  apply(params, true);
  if (!opt.width && win) {
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => onResize()); ro.observe(canvas); }
    else win.addEventListener('resize', onResize);
    win.addEventListener('pointermove', onPointer, { passive: true });
    if (doc) doc.addEventListener('visibilitychange', onVisibility);
    if (reduceMQ && reduceMQ.addEventListener) reduceMQ.addEventListener('change', onMotionChange);
  }
  advance(0.5);
  draw();
  if (opt.auto) api.start();
  return api;
}
