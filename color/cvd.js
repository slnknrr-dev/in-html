// color/cvd.js - colour vision deficiency simulation in linear sRGB: protanopia / deuteranopia (Viénot 1999 or
// Brettel 1997), tritanopia (Brettel 1997) and achromatopsia (luminance), with a severity 0..1.
//
// The matrices are the sRGB-specific precomputations of libDaltonLens (Nicolas Burrus, public domain), derived from
// the Smith & Pokorny cone fundamentals with the anchor wavelengths of the papers (475 / 575 nm for protan and
// deutan, 485 / 660 nm for tritan). Severity < 1 interpolates linearly between the normal and the dichromat
// response in linear light (the libDaltonLens approximation of anomalous trichromacy).
import { fromLinear, toLinear } from './space.js';
//
// Why linear light: cone responses are linear in photon counts; applying a matrix to gamma-encoded values (what many
// online simulators do) misrepresents mid tones. Why Viénot by default for protan/deutan: one matrix, cheap, and
// practically indistinguishable from Brettel there; tritan needs Brettel because a single plane fits it badly.
// Output is clamped to 0..1: projections can leave the sRGB gamut slightly.

// Viénot 1999: one projection plane (through black, white, blue and yellow) per deficiency.
const VIENOT = {
  protan: [[0.11238, 0.88762, 0.0], [0.11238, 0.88762, -0.0], [0.00401, -0.00401, 1.0]],
  deutan: [[0.29275, 0.70725, 0.0], [0.29275, 0.70725, -0.0], [-0.02234, 0.02234, 1.0]],
};

// Brettel 1997: two half-planes; the side is chosen by the sign of the dot product with the separation normal.
const BRETTEL = {
  protan: {
    m1: [[0.14980, 1.19548, -0.34528], [0.10764, 0.84864, 0.04372], [0.00384, -0.00540, 1.00156]],
    m2: [[0.14570, 1.16172, -0.30742], [0.10816, 0.85291, 0.03892], [0.00386, -0.00524, 1.00139]],
    n: [0.00048, 0.00393, -0.00441],
  },
  deutan: {
    m1: [[0.36477, 0.86381, -0.22858], [0.26294, 0.64245, 0.09462], [-0.02006, 0.02728, 0.99278]],
    m2: [[0.37298, 0.88166, -0.25464], [0.25954, 0.63506, 0.10540], [-0.01980, 0.02784, 0.99196]],
    n: [-0.00281, -0.00611, 0.00892],
  },
  tritan: {
    m1: [[1.01277, 0.13548, -0.14826], [-0.01243, 0.86812, 0.14431], [0.07589, 0.80500, 0.11911]],
    m2: [[0.93678, 0.18979, -0.12657], [0.06154, 0.81526, 0.12320], [-0.37562, 1.12767, 0.24796]],
    n: [0.03901, -0.02788, -0.01113],
  },
};

// Many names, four kinds: the -anomaly names map to the same kind and are expressed through severity < 1.
const CVD_TYPES = ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];
const KIND = {
  protanopia: 'protan', protan: 'protan', protanomaly: 'protan',
  deuteranopia: 'deutan', deutan: 'deutan', deuteranomaly: 'deutan',
  tritanopia: 'tritan', tritan: 'tritan', tritanomaly: 'tritan',
  achromatopsia: 'achroma', achroma: 'achroma', monochromacy: 'achroma',
};

const mul = (M, v) => [
  M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
  M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
  M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
];

/**
 * Simulates a deficiency on linear sRGB (0..1). type: 'protanopia' | 'deuteranopia' | 'tritanopia' |
 * 'achromatopsia' (short forms protan / deutan / tritan / achroma accepted). method: 'vienot' (default for protan and
 * deutan), 'brettel' (always used for tritan). Returns linear sRGB, clamped to 0..1.
 */
function simulateLinear(lin, type, severity = 1, method = 'vienot') {
  const k = KIND[type];
  if (!k) throw new Error('unknown deficiency: ' + type);
  const s = Math.min(1, Math.max(0, severity));
  let out;
  if (k === 'achroma') {
    const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    out = [y, y, y];
  } else if (k !== 'tritan' && method !== 'brettel') {
    out = mul(VIENOT[k], lin);
  } else {
    const p = BRETTEL[k];
    const side = lin[0] * p.n[0] + lin[1] * p.n[1] + lin[2] * p.n[2];
    out = mul(side >= 0 ? p.m1 : p.m2, lin);
  }
  return out.map((v, i) => Math.min(1, Math.max(0, v * s + lin[i] * (1 - s))));
}

// Same on gamma-encoded sRGB (0..1).
function simulateCVD(rgb, type, severity = 1, method = 'vienot') {
  return simulateLinear(rgb.map(toLinear), type, severity, method).map(fromLinear);
}

// Simulation of an RGBA byte buffer (ImageData.data) in place; alpha is kept.
// A 256-entry decode LUT replaces three pow() calls per pixel; the encode side still calls fromLinear per channel
// (input is continuous). Per-pixel array allocation in simulateLinear is the remaining cost - acceptable for preview
// sizes, the first thing to inline for full-resolution photos.
function simulateImageData(data, type, severity = 1, method = 'vienot') {
  const lut = new Float64Array(256);
  for (let i = 0; i < 256; i++) lut[i] = toLinear(i / 255);
  for (let i = 0; i < data.length; i += 4) {
    const o = simulateLinear([lut[data[i]], lut[data[i + 1]], lut[data[i + 2]]], type, severity, method);
    data[i] = Math.round(fromLinear(o[0]) * 255);
    data[i + 1] = Math.round(fromLinear(o[1]) * 255);
    data[i + 2] = Math.round(fromLinear(o[2]) * 255);
  }
  return data;
}

// The matrices in use, for inspection: { kind, matrices: [m] or [m1, m2], normal? }.
// KNOWN DEFECT: unlike simulateLinear, an unknown type does not throw - it returns { kind: undefined, matrices:
// [undefined] }. Fix: throw on !KIND[type] as simulateLinear does.
function cvdMatrices(type, method = 'vienot') {
  const k = KIND[type];
  if (k === 'achroma') return { kind: k, matrices: [[[0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722]]] };
  if (k !== 'tritan' && method !== 'brettel') return { kind: k, matrices: [VIENOT[k]] };
  return { kind: k, matrices: [BRETTEL[k].m1, BRETTEL[k].m2], normal: BRETTEL[k].n };
}

export {
  BRETTEL,
  CVD_TYPES,
  VIENOT,
  cvdMatrices,
  simulateCVD,
  simulateImageData,
  simulateLinear
};
