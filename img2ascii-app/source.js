// img2ascii-app/source.js - picture sources: the built-in sample scene, image files and the camera.
// Every source ends up as a canvas (or the live <video>), the one drawable type the converter path accepts.
// Normalising to a canvas at load time (with the size cap) means later conversions never touch the original file.

export const MAX_SIDE = 2048; // larger pictures are scaled down on load: plenty for 400 columns of braille

// A colourful sample drawn at startup: sunset sky with stars, a glossy sphere on a perspective checkerboard and
// bold lettering, so every ramp, dithering mode and colour mode has gradients, edges and fine detail to show.
export function drawSample(canvas) {
  const W = 720, H = 480, hy = Math.round(H * 0.6);
  canvas.width = W;
  canvas.height = H;
  const x = canvas.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, hy);
  sky.addColorStop(0, '#0b1636');
  sky.addColorStop(0.5, '#43307a');
  sky.addColorStop(0.85, '#c8577a');
  sky.addColorStop(1, '#f7a35c');
  x.fillStyle = sky;
  x.fillRect(0, 0, W, hy);
  // Night on the right: the sphere stands out against a dark sky, the sunset glows on the left.
  const night = x.createLinearGradient(0, 0, W, 0);
  night.addColorStop(0, 'rgba(6,8,26,0)');
  night.addColorStop(0.45, 'rgba(6,8,26,.25)');
  night.addColorStop(1, 'rgba(6,8,26,.82)');
  x.fillStyle = night;
  x.fillRect(0, 0, W, hy);
  const sun = x.createRadialGradient(W * 0.24, hy, 8, W * 0.24, hy, 230);
  sun.addColorStop(0, 'rgba(255,236,170,1)');
  sun.addColorStop(0.2, 'rgba(255,190,110,.7)');
  sun.addColorStop(1, 'rgba(255,120,90,0)');
  x.fillStyle = sun;
  x.fillRect(0, 0, W, hy);
  // Stars from a fixed seed: the sample looks the same on every start.
  // Park-Miller minimal standard LCG (multiplier 16807, modulus 2^31 - 1): two lines, deterministic, plenty random
  // for star placement. Math.random would change the sample (and thus every screenshot) on each start.
  let seed = 20261;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  x.fillStyle = '#ffffff';
  for (let i = 0; i < 90; i++) {
    const sx = rnd() * W, sy = rnd() * hy * 0.55, r = rnd() * 1.5 + 0.5;
    x.globalAlpha = 0.35 + rnd() * 0.65;
    x.beginPath();
    x.arc(sx, sy, r, 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
  // Ground: a checkerboard projected from a camera 1 unit above the plane, fading into the haze.
  x.fillStyle = '#081a20';
  x.fillRect(0, hy, W, H - hy);
  const f = (H - hy) * 1.1, cx = W / 2;
  // Pinhole projection: screen x = cx + f*X/Z, y = horizon + f*h/Z with camera height h = 1. Tiles fully off-screen
  // are skipped; only every other tile is drawn ((X + Z) & 1), the gaps show the dark ground: a checkerboard.
  const P = (X, Z) => [cx + (f * X) / Z, hy + f / Z];
  for (let Z = 1; Z < 40; Z++) {
    for (let X = -40; X < 40; X++) {
      if ((X + Z) & 1) continue;
      const a = P(X, Z), b = P(X + 1, Z), c = P(X + 1, Z + 1), d = P(X, Z + 1);
      if (Math.max(a[0], b[0], c[0], d[0]) < 0 || Math.min(a[0], b[0], c[0], d[0]) > W) continue;
      const haze = Math.min(1, Z / 26);
      const k = 1 - haze;
      x.fillStyle = `rgb(${Math.round(20 * k + 247 * haze * 0.55)},${Math.round(150 * k + 140 * haze * 0.55)},${Math.round(150 * k + 120 * haze * 0.55)})`;
      x.beginPath();
      x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.lineTo(c[0], c[1]); x.lineTo(d[0], d[1]);
      x.closePath();
      x.fill();
    }
  }
  const haze = x.createLinearGradient(0, hy, 0, hy + 70);
  haze.addColorStop(0, 'rgba(247,163,92,.85)');
  haze.addColorStop(1, 'rgba(247,163,92,0)');
  x.fillStyle = haze;
  x.fillRect(0, hy, W, 70);
  // Sphere with a soft shadow, warm key light from the upper left and a cool rim from the right.
  const sx = W * 0.68, sy = H * 0.47, r = 122;
  const sh = x.createRadialGradient(sx + 26, sy + r - 4, 4, sx + 26, sy + r - 4, r * 1.15);
  sh.addColorStop(0, 'rgba(0,0,0,.6)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = sh;
  // Elliptical shadow: build the circle path under a squashed transform, restore, THEN fill. The path keeps its
  // squashed geometry while the gradient fill is evaluated in the unscaled space, so the gradient stays round-ish.
  x.save();
  x.translate(sx + 26, sy + r - 4);
  x.scale(1, 0.24);
  x.beginPath();
  x.arc(0, 0, r * 1.15, 0, Math.PI * 2);
  x.restore();
  x.fill();
  const body = x.createRadialGradient(sx - r * 0.38, sy - r * 0.42, r * 0.04, sx, sy, r);
  body.addColorStop(0, '#fffaf0');
  body.addColorStop(0.16, '#ffd59a');
  body.addColorStop(0.46, '#ff6a72');
  body.addColorStop(0.8, '#a3266a');
  body.addColorStop(1, '#3d0d45');
  x.fillStyle = body;
  x.beginPath();
  x.arc(sx, sy, r, 0, Math.PI * 2);
  x.fill();
  const rim = x.createRadialGradient(sx + r * 0.9, sy + r * 0.1, r * 0.2, sx + r * 0.9, sy + r * 0.1, r * 0.9);
  rim.addColorStop(0, 'rgba(110,220,255,.55)');
  rim.addColorStop(1, 'rgba(110,220,255,0)');
  x.save();
  x.beginPath();
  x.arc(sx, sy, r, 0, Math.PI * 2);
  x.clip();
  x.fillStyle = rim;
  x.fillRect(sx - r, sy - r, 2 * r, 2 * r);
  x.restore();
  // Lettering.
  x.textBaseline = 'alphabetic';
  x.font = '800 92px system-ui, "Segoe UI", Roboto, Arial, sans-serif';
  x.fillStyle = 'rgba(0,0,0,.35)';
  x.fillText('ASCII', 44, 152);
  x.fillStyle = '#ffffff';
  x.fillText('ASCII', 38, 146);
  x.font = '600 26px system-ui, "Segoe UI", Roboto, Arial, sans-serif';
  x.fillStyle = '#ffd9a8';
  x.fillText('pixels → characters', 42, 188);
}

// Draws any drawable into `canvas`, scaled down to at most MAX_SIDE; optional horizontal mirror.
// Mirror = translate to the right edge and scale x by -1, so drawing at (0, 0) lands flipped inside the canvas.
export function drawInto(canvas, src, w, h, mirror = false) {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
  canvas.width = cw;
  canvas.height = ch;
  const x = canvas.getContext('2d');
  x.imageSmoothingQuality = 'high';
  if (mirror) { x.translate(cw, 0); x.scale(-1, 1); }
  x.drawImage(src, 0, 0, cw, ch);
  return { w: cw, h: ch };
}

// Decodes an image file into `canvas` (EXIF orientation applied by the browser). Throws when it is not an image.
// createImageBitmap first (fast, decodes off the main thread where supported, applies EXIF orientation); close()
// frees its GPU/memory backing at once instead of waiting for GC. Fallback through <img> + decode() for formats
// createImageBitmap rejects on Blobs (notably SVG). The object URL is revoked in finally, also on failure.
// SVG without intrinsic size reports 0: 512 x 512 is the fallback raster size.
export async function loadImageInto(file, canvas) {
  if (typeof createImageBitmap === 'function') {
    let bmp = null;
    try { bmp = await createImageBitmap(file); } catch { bmp = null; }
    if (bmp) {
      try { return drawInto(canvas, bmp, bmp.width, bmp.height); } finally { bmp.close?.(); }
    }
  }
  // SVG and a few other formats decode only through an image element.
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 512, h = img.naturalHeight || 512;
    return drawInto(canvas, img, w, h);
  } finally { URL.revokeObjectURL(url); }
}

// Opens the front camera into `video`; resolves with the stream.
// 'ideal' constraints (not exact): the browser picks the closest mode instead of failing with OverconstrainedError.
// 960x720 is enough for 400 braille columns (800 dots wide) and cheap to read back. muted + playsInline: required
// for autoplay on iOS Safari (otherwise it opens a fullscreen player or refuses to play). play() may reject when
// autoplay is blocked, yet a muted inline video still delivers frames, so the rejection is ignored.
export async function openCamera(video) {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
  if (!md || typeof md.getUserMedia !== 'function') throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
  const stream = await md.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try { await video.play(); } catch { /* muted inline video keeps delivering frames */ }
  return stream;
}

// Stopping every track releases the hardware (camera indicator off); clearing srcObject drops the last reference.
export function closeCamera(video, stream) {
  for (const tr of stream ? stream.getTracks() : []) tr.stop();
  video.srcObject = null;
}
