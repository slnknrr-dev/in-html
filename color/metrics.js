// color/metrics.js - colour differences (ΔE76, ΔE2000, ΔEOK) and text contrast (WCAG 2.x ratio and levels, APCA Lc
// with the SAPC 0.0.98G-4g constants). Inputs are plain coordinate triples; sRGB is gamma-encoded 0..1.
import { convertCoords, deltaEOKLab, toLinear } from './space.js';
//
// Which metric when: ΔE76 is cheap but over-weights saturated colours; ΔE2000 is the industry standard for "do these
// look the same" (but discontinuous around hue wrap and heavy); ΔEOK is the CSS Color 4 choice for gamut mapping -
// simple Euclidean in a perceptually uniform space. Contrast: WCAG 2.x ratio is the legal/compliance number; APCA
// models perceived lightness contrast with polarity (dark-on-light differs from light-on-dark), which WCAG ignores.

const rad = (d) => d * Math.PI / 180;

// CIE 1976: Euclidean distance in CIELAB.
function deltaE76(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

// CIEDE2000 (Sharma, Wu, Dalal 2005, including the hue-mean and Δh' rules of their test data).
// Pitfalls handled exactly as in Sharma's paper (implementations commonly get them wrong and fail its 34 test pairs):
// hue of an achromatic colour is 0; Δh' is 0 when either chroma is 0; the mean hue h̄' takes the short way round
// the circle (the three-branch rule), and when either chroma is 0 it is the plain sum h1' + h2'. G rescales a* to
// correct CIELAB's poor blue/neutral behaviour; RT is the blue-region rotation term.
function deltaE2000([L1, a1, b1], [L2, a2, b2], kL = 1, kC = 1, kH = 1) {
  const P7 = 25 ** 7;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + P7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b, a) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) * 180 / Math.PI;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const zero = C1p * C2p === 0;
  let dhp = 0;
  if (!zero) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp;
  if (zero) hbp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbp = (h1p + h2p + 360) / 2;
  else hbp = (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp))
    + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.20 * Math.cos(rad(4 * hbp - 63));
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Cbp7 = Cbp ** 7;
  const RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + P7));
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(rad(2 * dTheta)) * RC;
  const l = dLp / (kL * SL);
  const c = dCp / (kC * SC);
  const hh = dHp / (kH * SH);
  return Math.sqrt(l * l + c * c + hh * hh + RT * c * hh);
}

// Euclidean distance in OKLab (CSS Color 4 deltaEOK; a just-noticeable difference is about 0.02).
const deltaEOK = deltaEOKLab;

// Difference of two colour objects ({ space, coords }): method '2000' (default), '76' (both on D50 CIELAB) or 'ok'.
// Converting both inputs first means colours from different spaces compare correctly; D50 Lab because that is the
// CSS 'lab' space (the CIEDE2000 formula itself is white-point agnostic).
function deltaE(c1, c2, method = '2000') {
  if (method === 'ok') return deltaEOK(convertCoords(c1.coords, c1.space, 'oklab'), convertCoords(c2.coords, c2.space, 'oklab'));
  const a = convertCoords(c1.coords, c1.space, 'lab');
  const b = convertCoords(c2.coords, c2.space, 'lab');
  return method === '76' ? deltaE76(a, b) : deltaE2000(a, b);
}

// --- WCAG 2.x ------------------------------------------------------------------------------------

// Relative luminance of gamma-encoded sRGB (0..1, clamped).
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => toLinear(Math.min(1, Math.max(0, v))));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Contrast ratio 1..21 (order of the arguments does not matter).
function contrastRatio(rgb1, rgb2) {
  const a = luminance(rgb1);
  const b = luminance(rgb2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Success criteria 1.4.3 / 1.4.6 (text) and 1.4.11 (non-text, 3:1). Large text: 18pt, or 14pt bold.
function wcagLevels(ratio) {
  return {
    aa: ratio >= 4.5, aaa: ratio >= 7,
    aaLarge: ratio >= 3, aaaLarge: ratio >= 4.5,
    ui: ratio >= 3,
  };
}

// Short label of the best level for normal text: 'AAA', 'AA', 'AA18' (large text only) or 'fail'.
function wcagGrade(ratio) {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA18';
  return 'fail';
}

// --- APCA (Accessible Perceptual Contrast Algorithm, SAPC 0.0.98G-4g) ---------------------------

// Constants are the published SAPC-APCA 0.0.98G-4g set, exported so the UI can show them; changing any one changes
// every Lc value, so they are frozen in spirit even though the object is mutable. The exponents differ per polarity
// (normBG/normTXT vs revBG/revTXT) - that asymmetry is the core of APCA.
const APCA = {
  mainTRC: 2.4, sRco: 0.2126729, sGco: 0.7151522, sBco: 0.0721750,
  normBG: 0.56, normTXT: 0.57, revTXT: 0.62, revBG: 0.65,
  blkThrs: 0.022, blkClmp: 1.414, scaleBoW: 1.14, scaleWoB: 1.14,
  loBoWoffset: 0.027, loWoBoffset: 0.027, deltaYmin: 0.0005, loClip: 0.1,
};

// Screen luminance Y of APCA: a plain 2.4 power curve (no linear toe), sRGB 0..1 input.
function apcaY(rgb) {
  const p = (v) => Math.pow(Math.min(1, Math.max(0, v)), APCA.mainTRC);
  return APCA.sRco * p(rgb[0]) + APCA.sGco * p(rgb[1]) + APCA.sBco * p(rgb[2]);
}

// Lightness contrast Lc of text on a background (about -108..106; positive = dark text on light background).
// Order of arguments MATTERS (unlike WCAG): text first, background second. Steps: soft black clamp, a minimum
// luminance difference below which Lc is 0, polarity-specific power curves, a low-contrast clip to 0, then an offset.
function apcaContrast(textRgb, bgRgb) {
  const A = APCA;
  let txt = apcaY(textRgb);
  let bg = apcaY(bgRgb);
  // Soft clamp of near-black luminance (flare / ambient light).
  txt = txt > A.blkThrs ? txt : txt + Math.pow(A.blkThrs - txt, A.blkClmp);
  bg = bg > A.blkThrs ? bg : bg + Math.pow(A.blkThrs - bg, A.blkClmp);
  if (Math.abs(bg - txt) < A.deltaYmin) return 0;
  let out;
  if (bg > txt) {
    const sapc = (Math.pow(bg, A.normBG) - Math.pow(txt, A.normTXT)) * A.scaleBoW;
    out = sapc < A.loClip ? 0 : sapc - A.loBoWoffset;
  } else {
    const sapc = (Math.pow(bg, A.revBG) - Math.pow(txt, A.revTXT)) * A.scaleWoB;
    out = sapc > -A.loClip ? 0 : sapc + A.loWoBoffset;
  }
  return out * 100;
}

// Rough APCA use bands (|Lc|): 90 preferred body text, 75 body text, 60 content text, 45 headlines, 30 spot text,
// 15 non-text minimum. Returns the highest band reached (0 when below 15).
function apcaBand(lc) {
  const a = Math.abs(lc);
  for (const b of [90, 75, 60, 45, 30, 15]) if (a >= b) return b;
  return 0;
}

// Black or white, whichever reads better on `bgRgb`: method 'wcag' (contrast ratio, the default) or 'apca' (|Lc|,
// which prefers white on mid tones, closer to how text on them is perceived). Ties go to black.
function labelOn(bgRgb, method = 'wcag') {
  if (method === 'apca') return Math.abs(apcaContrast([0, 0, 0], bgRgb)) >= Math.abs(apcaContrast([1, 1, 1], bgRgb)) ? [0, 0, 0] : [1, 1, 1];
  return contrastRatio(bgRgb, [0, 0, 0]) >= contrastRatio(bgRgb, [1, 1, 1]) ? [0, 0, 0] : [1, 1, 1];
}

export {
  APCA,
  apcaBand,
  apcaContrast,
  apcaY,
  contrastRatio,
  deltaE,
  deltaE2000,
  deltaE76,
  deltaEOK,
  labelOn,
  luminance,
  wcagGrade,
  wcagLevels
};
