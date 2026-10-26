// body/body.js - the parametric human body: parameters (sex, height, weight, age, twelve shape features, measurement
// overrides, pose), the anthropometric targets they imply (BMI-driven girths, proportions as fractions of the
// stature) and the rig: generalized cylinders (torso, neck, head, arms, hands, legs, feet) whose horizontal or
// perpendicular cross-sections are polar radius rings. The mesh (mesh.js), the measurements (measure.js), the
// silhouettes (silhouette.js) and the cloth collider (collide.js) all read the same rings, so a girth edited by the
// user is exactly the girth measured on the mesh and the girth the cloth drapes around.
//
//   defaultBody(sex), normalizeBody(raw), bodyFromPreset(id), BODY_PRESETS, FEATURES, POSES, LIMITS
//   bmiOf(body), bmiCategory(bmi), bodyTargets(body) -> { girth, length, ratio }, buildRig(body) -> rig
//   ringAt(part, t) -> { cx, cz, r: Float64Array(M) }   (interpolated cross-section of a rig part)
//
// Coordinates: centimetres, y up from the floor, x towards the wearer's left, z forward (the wearer faces +z).
// A rig part maps (t, phi, r) to origin + axis*t + e1*(cx + r cos phi) + e2*(cz + r sin phi); for the torso e1 = +x and
// e2 = +z, so phi = 90 deg is the centre front and 270 deg the centre back.

//
// Pipeline: body (user parameters) -> bodyTargets (numbers: girths, lengths, landmark ratios) -> buildRig (geometry:
// parts with node profiles, fitted so measured girths equal the targets). Separating targets from geometry keeps the
// statistical model (REF / CHILD tables, BMI slopes) independent of how shapes are drawn.
// Fitting strategy: each girth-carrying node is scaled by bisection until the convex-hull perimeter of its ring hits
// the target (fitNode). Superellipse radii are linear in a scale factor, so the search is 1D and monotone.
// Coupled constraints (back length moves the waist, bust span moves the bumps) are solved by a short fixed-point loop
// (6 iterations max) rather than a joint optimiser: each correction is nearly independent of the others.
import { DEG, TAU, add, clamp, cross, hull, lerp, madd, norm, perimeter, pchip, rotate, scale, solveMonotone, sub, superR, angDiff } from './geom.js';

export const SEXES = ['female', 'male'];
export const POSES = ['a', 't', 'relaxed'];
export const LIMITS = { height: [80, 210], weight: [10, 180], age: [2, 90] };

// Shape features, each -1 .. 1 (0 = average for the sex, height and BMI).
export const FEATURES = [
  'shoulderWidth', 'shoulderSlope', 'posture', 'bust', 'belly', 'waist', 'hips', 'seat', 'arms', 'legs', 'neck', 'legLength',
];

// Measurements that can be set directly (they override the value derived from height, weight, age and features).
export const OVERRIDABLE = [
  'stature', 'head', 'neck', 'neckBase', 'bust', 'chest', 'underbust', 'waist', 'highHip', 'hip', 'upperArm', 'elbow', 'wrist',
  'thigh', 'knee', 'calf', 'ankle', 'shoulderWidth', 'armLength', 'insideLeg', 'napeToWaist', 'waistToHip', 'bustSpan',
];

const ring = (n) => new Float64Array(n);

export function defaultBody(sex = 'female') {
  const m = sex === 'male';
  return {
    v: 1, sex: m ? 'male' : 'female', height: m ? 178 : 166, weight: m ? 76 : 61, age: 32,
    features: Object.fromEntries(FEATURES.map((f) => [f, 0])), overrides: {}, pose: 'a',
  };
}

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// Clamped, complete copy of a body description (never throws).
// Overrides outside (0, 400) cm are ignored, not clamped: a typo of 7000 must not silently become 400.
export function normalizeBody(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const b = defaultBody(r.sex === 'male' ? 'male' : 'female');
  b.height = clamp(num(r.height, b.height), ...LIMITS.height);
  b.weight = clamp(num(r.weight, b.weight), ...LIMITS.weight);
  b.age = clamp(Math.round(num(r.age, b.age)), ...LIMITS.age);
  for (const f of FEATURES) b.features[f] = clamp(num(r.features?.[f], 0), -1, 1);
  if (r.overrides && typeof r.overrides === 'object') {
    for (const k of OVERRIDABLE) {
      const v = r.overrides[k];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 400) b.overrides[k] = v;
    }
  }
  b.pose = POSES.includes(r.pose) ? r.pose : 'a';
  return b;
}

export const bmiOf = (b) => b.weight / ((b.height / 100) ** 2);
// BMI categories: the adult cut-offs from 18; children use age-dependent ones (approximate growth-chart percentiles:
// the 5th, 85th and 95th lie near 13.8 / 17 / 18.4 at 6 years and rise to the adult values by 18).
export function bmiCategory(bmi, age = 30) {
  if (age >= 18) return bmi < 18.5 ? 'under' : bmi < 25 ? 'normal' : bmi < 30 ? 'over' : 'obese';
  const k = clamp((age - 6) / 12, 0, 1), young = clamp((6 - age) / 4, 0, 1);
  const lo = 13.8 + 4.7 * k + 0.6 * young, hi = 17 + 8 * k - 0.4 * young, ob = 18.4 + 11.6 * k + 0.2 * young;
  return bmi < lo ? 'under' : bmi < hi ? 'normal' : bmi < ob ? 'over' : 'obese';
}

// Ready-made bodies (the mockup mode and embedded previews name them; each is a partial body description).
export const BODY_PRESETS = {
  'female-s': { sex: 'female', height: 162, weight: 52, age: 26 },
  'female-m': { sex: 'female', height: 166, weight: 61, age: 32 },
  'female-l': { sex: 'female', height: 168, weight: 76, age: 40, features: { belly: 0.2, hips: 0.2 } },
  'female-curvy': { sex: 'female', height: 165, weight: 68, age: 30, features: { bust: 0.6, waist: -0.5, hips: 0.6, seat: 0.5 } },
  'female-tall': { sex: 'female', height: 180, weight: 64, age: 27, features: { legLength: 0.5, shoulderWidth: 0.2 } },
  'male-s': { sex: 'male', height: 172, weight: 62, age: 25 },
  'male-m': { sex: 'male', height: 178, weight: 76, age: 32 },
  'male-l': { sex: 'male', height: 182, weight: 95, age: 45, features: { belly: 0.6, posture: 0.2 } },
  'male-athletic': { sex: 'male', height: 183, weight: 84, age: 29, features: { shoulderWidth: 0.6, bust: 0.6, waist: -0.4, arms: 0.6, legs: 0.4 } },
  'female-petite': { sex: 'female', height: 154, weight: 49, age: 30, features: { legLength: -0.3, shoulderWidth: -0.2 } },
  'female-pear': { sex: 'female', height: 165, weight: 66, age: 34, features: { bust: -0.3, waist: -0.2, hips: 0.8, seat: 0.6, legs: 0.4 } },
  'female-plus': { sex: 'female', height: 166, weight: 92, age: 42, features: { bust: 0.4, belly: 0.4, hips: 0.3 } },
  'male-slim': { sex: 'male', height: 180, weight: 64, age: 24, features: { shoulderWidth: -0.2, arms: -0.3, legs: -0.2 } },
  'male-tall': { sex: 'male', height: 193, weight: 88, age: 30, features: { legLength: 0.4, shoulderWidth: 0.2 } },
  'male-plus': { sex: 'male', height: 178, weight: 112, age: 48, features: { belly: 0.4, bust: 0.2, posture: 0.2 } },
  'child-girl-4': { sex: 'female', height: 103, weight: 16.5, age: 4 },
  'child-boy-4': { sex: 'male', height: 104, weight: 17, age: 4 },
  'child-girl-8': { sex: 'female', height: 128, weight: 25.5, age: 8 },
  'child-boy-8': { sex: 'male', height: 129, weight: 26, age: 8 },
  'teen-girl-13': { sex: 'female', height: 156, weight: 45, age: 13 },
  'teen-boy-13': { sex: 'male', height: 156, weight: 45, age: 13 },
  'teen-girl-16': { sex: 'female', height: 163, weight: 54, age: 16 },
  'teen-boy-16': { sex: 'male', height: 174, weight: 65, age: 16 },
};

export function bodyFromPreset(id, extra = {}) {
  const p = BODY_PRESETS[id] || BODY_PRESETS['female-m'];
  return normalizeBody({ ...p, ...extra, features: { ...(p.features || {}), ...(extra.features || {}) } });
}

// --- anthropometric model ------------------------------------------------------------------------------------------

// Reference girths at the reference stature and BMI, and their change per BMI unit (cm). Typical adult values of
// anthropometric surveys; brands and populations differ, which is what the features and overrides are for.
const REF = {
  female: {
    H: 165, bmi: 22,
    g: { head: 55.5, neck: 33.5, neckBase: 37.5, bust: 90, underbust: 76, waist: 71, highHip: 84, hip: 98, upperArm: 27.5, elbow: 23.5, wrist: 15.3, thigh: 55, knee: 36.5, calf: 34.5, ankle: 21.5 },
    k: { head: 0.05, neck: 0.4, neckBase: 0.5, bust: 1.9, underbust: 1.65, waist: 2.35, highHip: 2.3, hip: 2.05, upperArm: 1.0, elbow: 0.5, wrist: 0.15, thigh: 1.55, knee: 0.7, calf: 0.7, ankle: 0.25 },
    // Landmark heights as fractions of the stature.
    y: { cervicale: 0.85, armpit: 0.746, bust: 0.718, underbust: 0.676, waist: 0.627, highHip: 0.574, hip: 0.508, crotch: 0.462, knee: 0.283, ankle: 0.044, chin: 0.868 },
    biacromial: 0.222, arm: 0.348, upperArm: 0.555, slope: 21, neckLen: 0.052,
  },
  male: {
    H: 178, bmi: 24,
    g: { head: 57.5, neck: 38.5, neckBase: 42.5, chest: 98, underbust: 92, waist: 85, highHip: 91, hip: 98, upperArm: 31, elbow: 26.5, wrist: 17.3, thigh: 55, knee: 38, calf: 37, ankle: 23 },
    k: { head: 0.05, neck: 0.6, neckBase: 0.65, chest: 2.0, underbust: 2.2, waist: 2.9, highHip: 2.4, hip: 1.8, upperArm: 1.0, elbow: 0.5, wrist: 0.15, thigh: 1.35, knee: 0.65, calf: 0.65, ankle: 0.25 },
    y: { cervicale: 0.851, armpit: 0.75, bust: 0.722, underbust: 0.684, waist: 0.605, highHip: 0.56, hip: 0.502, crotch: 0.465, knee: 0.283, ankle: 0.044, chin: 0.868 },
    biacromial: 0.232, arm: 0.352, upperArm: 0.555, slope: 20, neckLen: 0.055,
  },
};

// Children and teenagers: median girths at the median stature and BMI of each age (typical growth-survey values; the
// sexes share the rows up to 10), the landmark fractions of a growing body (a larger head, shorter legs, a lower
// waist), shoulder and arm ratios. Between the rows and up to 18 everything is interpolated towards the adult REF.
const CH = (age, H, bmi, g, y, o = {}) => ({ age, H, bmi, g, y, biacromial: o.biacromial ?? 0.222, arm: o.arm ?? 0.34, upperArm: 0.55, neckLen: o.neckLen ?? 0.042 });
const GC = (head, neck, neckBase, chest, underbust, waist, hip, upperArm, wrist, thigh, knee, calf, ankle) => ({ head, neck, neckBase, chest, underbust, waist, highHip: (waist + hip) / 2, hip, upperArm, elbow: upperArm * 0.86, wrist, thigh, knee, calf, ankle });
const YC = (cervicale, armpit, waist, hip, crotch, knee, chin) => ({ cervicale, armpit, bust: armpit - 0.028, underbust: armpit - 0.065, waist, highHip: (waist + hip) / 2, hip, crotch, knee, ankle: 0.05, chin });
const CHILD = {
  any: [
    CH(2, 87, 16.4, GC(48.5, 24, 26, 51, 50, 48, 52, 16, 11, 28, 22, 20, 15), YC(0.79, 0.7, 0.58, 0.47, 0.4, 0.25, 0.81), { biacromial: 0.228, arm: 0.33, neckLen: 0.032 }),
    CH(4, 103, 15.6, GC(50, 25.5, 27.5, 55, 54, 51, 57, 17, 11.8, 32, 24.5, 22.5, 16), YC(0.805, 0.712, 0.585, 0.48, 0.415, 0.262, 0.825), { biacromial: 0.224, arm: 0.332, neckLen: 0.035 }),
    CH(6, 116, 15.4, GC(51, 26.5, 29, 59, 57.5, 53, 62, 18, 12.4, 35, 26.5, 24.5, 17), YC(0.818, 0.722, 0.59, 0.488, 0.428, 0.27, 0.837), { biacromial: 0.22, arm: 0.335, neckLen: 0.038 }),
    CH(8, 128, 15.8, GC(52, 27.5, 30.5, 63, 61, 56, 67, 19.5, 13, 39, 28.5, 26.5, 18), YC(0.828, 0.73, 0.597, 0.494, 0.44, 0.275, 0.847), { biacromial: 0.217, arm: 0.338, neckLen: 0.04 }),
    CH(10, 139, 16.6, GC(52.5, 28.5, 32, 68, 65.5, 59, 73, 21, 13.6, 43, 30.5, 28.5, 19), YC(0.836, 0.736, 0.602, 0.498, 0.45, 0.279, 0.854), { biacromial: 0.216, arm: 0.342, neckLen: 0.044 }),
  ],
  female: [
    CH(12, 151, 17.5, { ...GC(53.5, 29.5, 33.5, 0, 68, 62, 82, 23, 14.2, 47, 32.5, 30.5, 20), bust: 75 }, YC(0.842, 0.74, 0.61, 0.502, 0.458, 0.281, 0.86), { biacromial: 0.218, arm: 0.345, neckLen: 0.047 }),
    CH(14, 160, 19, { ...GC(54.5, 31, 35, 0, 72, 65, 90, 25, 14.8, 51, 34.5, 32, 20.5), bust: 82 }, YC(0.846, 0.744, 0.618, 0.505, 0.461, 0.282, 0.865), { biacromial: 0.221, arm: 0.347, neckLen: 0.05 }),
    CH(16, 163, 20.5, { ...GC(55, 32.5, 36.5, 0, 74, 68, 95, 26.5, 15.1, 53, 35.5, 33.5, 21), bust: 86 }, YC(0.848, 0.745, 0.624, 0.507, 0.462, 0.283, 0.866), { biacromial: 0.222, arm: 0.348, neckLen: 0.051 }),
  ],
  male: [
    CH(12, 150, 17.5, GC(53.5, 30.5, 34, 72, 68, 62, 78, 22.5, 14.6, 45, 32.5, 30.5, 20.5), YC(0.842, 0.742, 0.6, 0.5, 0.458, 0.281, 0.86), { biacromial: 0.22, arm: 0.346, neckLen: 0.048 }),
    CH(14, 164, 19, GC(55, 33.5, 37.5, 80, 74, 66, 86, 25, 16, 49, 35, 33, 21.5), YC(0.847, 0.746, 0.603, 0.501, 0.463, 0.282, 0.864), { biacromial: 0.226, arm: 0.35, neckLen: 0.052 }),
    CH(16, 174, 20.5, GC(56.5, 36.5, 40.5, 90, 85, 74, 94, 28.5, 16.8, 53, 37, 35.5, 22.5), YC(0.85, 0.748, 0.604, 0.502, 0.465, 0.283, 0.867), { biacromial: 0.23, arm: 0.352, neckLen: 0.054 }),
  ],
};

function lerpRef(A, B, t) {
  const g = {}, y = {};
  for (const k of Object.keys(B.g)) g[k] = lerp(A.g[k] ?? B.g[k], B.g[k], t);
  for (const k of Object.keys(B.y)) y[k] = lerp(A.y[k] ?? B.y[k], B.y[k], t);
  return { H: lerp(A.H, B.H, t), bmi: lerp(A.bmi, B.bmi, t), g, y, biacromial: lerp(A.biacromial, B.biacromial, t), arm: lerp(A.arm, B.arm, t), upperArm: lerp(A.upperArm, B.upperArm, t), neckLen: lerp(A.neckLen, B.neckLen, t) };
}

// The reference of a sex and age: the adult REF from 18, the growth rows below (with the adult per-BMI slopes scaled
// down, the adult shoulder slope) and maturity 0..1 (shapes the bust, seat and belly bumps).
// Interpolation between growth rows (piecewise linear in age) with the adult row appended at 18, so the child model
// joins the adult one continuously; no jump on an 18th birthday. Shared rows below 10 carry 'chest'; for girls it is
// renamed to 'bust' so downstream code uses one key per sex.
export function refFor(sex, age) {
  const adult = REF[sex === 'male' ? 'male' : 'female'];
  if (age >= 18) return { ...adult, mature: 1 };
  const rows = [...CHILD.any, ...CHILD[sex === 'male' ? 'male' : 'female']].map((r) => {
    // shared rows: the girls' bust is the chest, the boys keep it
    const g = { ...r.g };
    if (sex === 'male') delete g.bust; else { g.bust = g.bust || g.chest; delete g.chest; }
    return { ...r, g };
  });
  const adultRow = { age: 18, H: adult.H, bmi: adult.bmi, g: adult.g, y: adult.y, biacromial: adult.biacromial, arm: adult.arm, upperArm: adult.upperArm, neckLen: adult.neckLen };
  rows.push(adultRow);
  let i = rows.findIndex((r) => r.age >= age);
  if (i <= 0) i = 1;
  const A = rows[i - 1], B = rows[i];
  const r = lerpRef(A, B, clamp((age - A.age) / (B.age - A.age), 0, 1));
  const k = {};
  for (const [key, v] of Object.entries(adult.k)) k[key] = v * clamp(r.H / adult.H, 0.4, 1) * 0.7;
  const mature = clamp((age - 10) / 7, 0, 1);
  return { ...r, k, slope: lerp(14, adult.slope, mature), mature };
}

// The measurement targets of a body: { girth: {...}, length: {...}, ratio: {...}, bmi }. Overrides win.
export function bodyTargets(body) {
  const b = normalizeBody(body);
  const R = refFor(b.sex, b.age), F = b.features, O = b.overrides;
  const H = O.stature ?? b.height;
  const bmi = b.weight / ((b.height / 100) ** 2);
  const db = bmi - R.bmi;
  // Girths scale with sqrt(height ratio) at constant BMI (BMI fixes weight / H^2, and cross-section area ~ weight / H,
  // so girth ~ sqrt(area) ~ sqrt(H)). The head barely follows stature (exponent 0.2).
  const hs = Math.sqrt(H / R.H);
  const da = b.age - 30, ag = b.age < 18 ? 0 : da > 0 ? da : da * 0.5;
  const g = {};
  for (const [k, v] of Object.entries(R.g)) g[k] = (v + R.k[k] * db) * (k === 'head' ? Math.pow(H / R.H, 0.2) : hs);
  const female = b.sex === 'female';
  const B = female ? 'bust' : 'chest';
  g.waist += ag * (female ? 0.13 : 0.16);
  g.highHip += ag * 0.08;
  g.hip += ag * 0.03;
  g[B] += ag * 0.04;
  g.neck += ag * 0.02;
  if (female) g.bust += F.bust * 7;
  else { g.chest += F.bust * 4; g.underbust += F.bust * 1.5; }
  g.waist += F.belly * 7 + F.waist * 6;
  g.highHip += F.belly * 5.5 + F.hips * 3;
  g.underbust += F.belly * 2;
  g.hip += F.hips * 6 + F.seat * 4;
  g.thigh = g.thigh * (1 + 0.12 * F.legs) + F.hips * 1.5;
  g.upperArm *= 1 + 0.12 * F.arms;
  g.elbow *= 1 + 0.06 * F.arms;
  g.wrist *= 1 + 0.04 * F.arms;
  g.knee *= 1 + 0.06 * F.legs;
  g.calf *= 1 + 0.1 * F.legs;
  g.ankle *= 1 + 0.04 * F.legs;
  // Plausibility floor: no girth below 8 cm whatever the feature sliders say; ordering is only enforced for
  // underbust < bust (below), other pairs are left to the user's overrides.
  for (const k of Object.keys(g)) g[k] = Math.max(8, g[k]);
  if (!female) delete g.bust; else delete g.chest;
  for (const k of Object.keys(g)) if (O[k] != null) g[k] = O[k];
  if (female) g.underbust = Math.min(g.underbust, g.bust - 1);
  const L = {
    stature: H,
    shoulderWidth: O.shoulderWidth ?? H * R.biacromial * (1 + 0.08 * F.shoulderWidth) + 0.15 * db,
    armLength: O.armLength ?? H * R.arm,
    insideLeg: O.insideLeg ?? H * (R.y.crotch + 0.025 * F.legLength),
    napeToWaist: O.napeToWaist ?? null, // derived from the landmarks when not set
    waistToHip: O.waistToHip ?? null,
    bustSpan: O.bustSpan ?? (female ? g.bust / 5 : g[B] / 4.6),
  };
  return {
    sex: b.sex, H, bmi, girth: g, length: L, pose: b.pose, features: F, age: b.age,
    ratio: R.y, ref: R, mature: R.mature, slope: R.slope + 7 * F.shoulderSlope, neckLen: H * R.neckLen + 2.5 * F.neck * (0.4 + 0.6 * R.mature),
  };
}

// --- rig parts -------------------------------------------------------------------------------------------------------

// A part from nodes: [{ t, a, f, b, n, cx, cz }], bumps [{ t0, up, down, phi, w, amp }]; rings sampled every dt.
function makePart(spec) {
  const nodes = spec.nodes.slice().sort((p, q) => p.t - q.t);
  const ts = nodes.map((n) => n.t);
  const fn = {};
  for (const k of ['a', 'f', 'b', 'n', 'cx', 'cz']) fn[k] = pchip(ts, nodes.map((n) => n[k] ?? (k === 'n' ? 2 : 0)));
  const part = {
    id: spec.id, kind: spec.kind, side: spec.side || '', origin: spec.origin, axis: norm(spec.axis), e1: spec.e1, e2: spec.e2,
    length: spec.length, M: spec.M || 32, capStart: spec.capStart !== false, capEnd: spec.capEnd !== false,
    bumps: spec.bumps || [], fn, rings: [], dt: 0,
  };
  const n = Math.max(2, Math.ceil(spec.length / (spec.dt || 1.2)) + 1);
  part.dt = spec.length / (n - 1);
  for (let i = 0; i < n; i++) part.rings.push(evalRing(part, i * part.dt));
  return part;
}

// A bump is a separable raised-cosine bell: along the axis (different extents up and down, so a bust can slope into
// the chest and drop under) times cos^2 in angle around phi. Smooth (C1) at its edges, so it adds no creases.
function bumpAt(bp, t, phi) {
  const d = t - bp.t0;
  let v;
  if (d >= 0) { if (d >= bp.up) return 0; v = 0.5 + 0.5 * Math.cos(Math.PI * d / bp.up); }
  else { if (-d >= bp.down) return 0; v = 0.5 + 0.5 * Math.cos(Math.PI * d / bp.down); }
  const a = Math.abs(angDiff(phi, bp.phi));
  if (a >= bp.w) return 0;
  const c = Math.cos(Math.PI / 2 * a / bp.w);
  return bp.amp * v * c * c;
}

// Cross-section of a part at axis position t (exact evaluation, not the sampled rings).
function evalRing(part, t, override) {
  const p = override || { a: part.fn.a(t), f: part.fn.f(t), b: part.fn.b(t), n: part.fn.n(t), cx: part.fn.cx(t), cz: part.fn.cz(t) };
  const M = part.M, r = ring(M);
  for (let j = 0; j < M; j++) {
    const phi = (j / M) * TAU;
    let v = superR(phi, Math.max(0.05, p.a), Math.max(0.05, p.f), Math.max(0.05, p.b), p.n);
    for (const bp of part.bumps) v += bumpAt(bp, t, phi);
    r[j] = v;
  }
  return { t, cx: p.cx, cz: p.cz, r };
}

// Sampled ring at t (linear between the stored rings): { cx, cz, r }.
export function ringAt(part, t) {
  const u = clamp(t / part.dt, 0, part.rings.length - 1);
  const i = Math.min(part.rings.length - 2, Math.floor(u)), f = u - i;
  const A = part.rings[i], B = part.rings[i + 1];
  const r = ring(part.M);
  for (let j = 0; j < part.M; j++) r[j] = A.r[j] + (B.r[j] - A.r[j]) * f;
  return { t, cx: lerp(A.cx, B.cx, f), cz: lerp(A.cz, B.cz, f), r };
}

// Ring points in the part's (e1, e2) plane: [[u, v], ...].
export const ringPoints = (rg, M = rg.r.length) => Array.from({ length: M }, (_, j) => {
  const phi = (j / M) * TAU;
  return [rg.cx + rg.r[j] * Math.cos(phi), rg.cz + rg.r[j] * Math.sin(phi)];
});

// Girth of a ring as a tape measure takes it: the convex hull perimeter.
export const ringGirth = (rg) => perimeter(hull(ringPoints(rg)));

// Scales the a / f / b of a node so that the girth at its t equals the target (bumps included). The superellipse
// radius is homogeneous in (a, f, b), so the ring is s * base + bumps and only the hull is recomputed per step.
function fitNode(partSpec, node, target) {
  const M = partSpec.M || 32, bumps = partSpec.bumps || [];
  const base = new Float64Array(M), bump = new Float64Array(M), cs = new Float64Array(M), sn = new Float64Array(M);
  for (let j = 0; j < M; j++) {
    const phi = (j / M) * TAU;
    base[j] = superR(phi, Math.max(0.05, node.a), Math.max(0.05, node.f), Math.max(0.05, node.b), node.n);
    for (const bp of bumps) bump[j] += bumpAt(bp, node.t, phi);
    cs[j] = Math.cos(phi); sn[j] = Math.sin(phi);
  }
  const pts = Array.from({ length: M }, () => [0, 0]);
  const girth = (s) => {
    for (let j = 0; j < M; j++) { const r = s * base[j] + bump[j]; pts[j][0] = r * cs[j]; pts[j][1] = r * sn[j]; }
    return perimeter(hull(pts));
  };
  const s = solveMonotone(girth, target, 0.05, 6, 34);
  node.a *= s; node.f *= s; node.b *= s;
}

// Frame (e1, e2) of a limb axis: e2 is the forward direction made perpendicular to the axis.
// Gram-Schmidt against the world forward vector keeps limb seams (phi = 0) on the outside of the limb in every pose.
// Degenerate when the limb points exactly forward; then world +z is used as a fallback.
function limbFrame(axis, fwd = [0, 0, 1]) {
  let e2 = sub(fwd, scale(axis, axis[0] * fwd[0] + axis[1] * fwd[1] + axis[2] * fwd[2]));
  if (Math.hypot(...e2) < 1e-6) e2 = [0, 0, 1];
  e2 = norm(e2);
  return { e1: norm(cross(e2, axis)), e2 };
}

// --- the rig ---------------------------------------------------------------------------------------------------------

export function buildRig(body, opts = {}) {
  const T = bodyTargets(body);
  const pose = opts.pose || T.pose;
  const { H, girth: G, length: L, ratio: Y, features: F } = T;
  const female = T.sex === 'female';
  const B = female ? G.bust : G.chest;
  const posture = F.posture;
  const tg = (g) => g / TAU; // radius of a circle with girth g

  // Landmark heights.
  const lm = {};
  lm.stature = H;
  lm.crotch = L.insideLeg;
  // Landmarks are computed bottom-up from the crotch so that an inside-leg override stretches only the legs and the
  // torso landmarks are rescaled into the remaining height.
  const legScale = lm.crotch / (H * Y.crotch); // longer legs push the torso landmarks up within the stature
  const torsoY = (f) => lm.crotch + (f - Y.crotch) * H * (1 - (legScale - 1) * Y.crotch / Math.max(0.2, 1 - Y.crotch));
  lm.cervicale = torsoY(Y.cervicale);
  lm.armpit = torsoY(Y.armpit);
  lm.bust = torsoY(Y.bust);
  lm.underbust = torsoY(Y.underbust);
  lm.waist = torsoY(Y.waist);
  lm.highHip = torsoY(Y.highHip);
  lm.hip = torsoY(Y.hip);
  lm.knee = H * Y.knee * (0.6 + 0.4 * legScale);
  lm.ankle = H * Y.ankle;
  lm.chin = torsoY(Y.chin);
  if (L.waistToHip != null) lm.hip = lm.waist - L.waistToHip;
  lm.hip = clamp(lm.hip, lm.crotch + 2, lm.waist - 6);
  lm.highHip = clamp(lm.highHip, lm.hip + 2, lm.waist - 2);
  // Shoulder line: side neck point just above the cervicale, acromion lower by the shoulder slope.
  const rNB = tg(G.neckBase), rN = tg(G.neck);
  const shoulderHalf = L.shoulderWidth / 2;
  lm.snp = lm.cervicale + 1.2;
  const shoulderRun = Math.max(6, shoulderHalf - rNB);
  lm.shoulder = lm.snp - shoulderRun * Math.tan(T.slope * DEG);
  lm.armpit = Math.min(lm.armpit, lm.shoulder - 6);
  lm.bust = Math.min(lm.bust, lm.armpit - 2);
  lm.underbust = Math.min(lm.underbust, lm.bust - 3);

  // --- torso nodes (t = y - crotch) ---
  // Built by a function of the landmarks and the bust angle, then iterated: the back-length override moves the waist
  // (and the hip with it when the waist-to-hip length is set), the bust span positions the bust bumps exactly.
  const o = lm.crotch;
  const t = (y) => y - o;
  const span = L.bustSpan;
  // Posture: stooped (+) rounds the upper back (scapulae back, shoulders and neck forward), erect / sway (-) the opposite.
  const czNeckP = -0.4 + 2.0 * Math.max(posture, 0) + 0.5 * Math.min(posture, 0);
  const bustAmp = female ? Math.max(0.6 * T.mature + 0.15, (G.bust - G.underbust - 5) * 0.55) : (0.7 + 1.2 * F.bust) * (0.35 + 0.65 * T.mature);
  const armpitGirth = female ? Math.max(G.underbust + 4, G.bust - bustAmp * 1.35) : G.chest * 0.985;
  const shoulderTopA = shoulderHalf - tg(G.upperArm) * 0.62;
  const r0 = (g) => tg(g) * 1.12;
  let bustPhi = Math.atan2(0.72 * tg(B) * 1.1, span / 2);
  const buildTorso = () => {
    const bumps = [];
    for (const s of [1, -1]) {
      const phi = s > 0 ? bustPhi : Math.PI - bustPhi;
      if (female) bumps.push({ id: 'bust', t0: t(lm.bust), up: (lm.armpit - lm.bust) + 0.035 * H, down: Math.max(2, lm.bust - lm.underbust), phi, w: 0.5, amp: bustAmp });
      else bumps.push({ id: 'pec', t0: t(lm.bust) + 1, up: 0.05 * H, down: 0.025 * H, phi: s > 0 ? 58 * DEG : 122 * DEG, w: 0.62, amp: Math.max(0.2, bustAmp) });
      bumps.push({ id: 'seat', t0: t(lm.hip) + 0.012 * H, up: 0.075 * H, down: 0.05 * H, phi: (270 + 23 * s) * DEG, w: 0.72, amp: Math.max(0.3, ((female ? 2.5 : 1.7) + 2.2 * F.seat) * (0.45 + 0.55 * T.mature)) });
      bumps.push({ id: 'scapula', t0: t(lm.armpit) + 2.5, up: 0.05 * H, down: 0.045 * H, phi: (270 + 38 * s) * DEG, w: 0.5, amp: 0.6 + 0.6 * Math.max(0, posture) });
    }
    // a belly is broad and soft: wide, reaching up to the underbust and down to the hips, never a pouch
    const bellyAmp = clamp(0.6 + 3 * F.belly + 0.25 * (T.bmi - T.ref.bmi), 0, 5.5);
    bumps.push({ id: 'belly', t0: t((lm.waist + lm.highHip) / 2) - 1, up: 0.1 * H, down: 0.085 * H, phi: 90 * DEG, w: 1.55, amp: bellyAmp });
    const torsoSpec = { M: 64, bumps };
    const nodes = [];
    const node = (key, y, a, fa, ba, n, cz, girth) => {
      const nd = { key, t: t(y), a, f: a * fa, b: a * ba, n, cx: 0, cz };
      if (girth) fitNode(torsoSpec, nd, girth);
      nodes.push(nd);
      return nd;
    };
    const hipN = node('hip', lm.hip, r0(G.hip), female ? 0.6 : 0.62, 0.66, 2.3, -0.4, G.hip);
    node('crotch', lm.crotch + 1.5, hipN.a * 0.86, (hipN.f / hipN.a) * 0.78, (hipN.b / hipN.a) * 0.8, 2.2, -0.2);
    // below the crotch the torso narrows into the tops of the thighs (no ledge where the legs come out)
    node('fork', lm.crotch - 1.5, hipN.a * 0.62, (hipN.f / hipN.a) * 0.62, (hipN.b / hipN.a) * 0.66, 2.1, -0.3);
    node('highHip', lm.highHip, r0(G.highHip), 0.62, 0.6, 2.3, 0.2, G.highHip);
    node('waist', lm.waist, r0(G.waist), female ? 0.66 : 0.7, 0.6, 2.2, 0.9 - 0.4 * posture, G.waist);
    node('underbust', lm.underbust, r0(G.underbust), female ? 0.66 : 0.68, 0.64, 2.4, 0.7 - 0.2 * posture, G.underbust);
    const bustN = node('bust', lm.bust, r0(B), female ? 0.6 : 0.66, 0.64, 2.5, 0.2 - 0.2 * posture, B);
    const pp = Math.max(posture, 0), pn = Math.min(posture, 0);
    node('armpit', lm.armpit, r0(armpitGirth), 0.66, 0.68 + 0.1 * pp + 0.04 * pn, 2.45, 0.1 - 0.5 * pp - 0.1 * pn, armpitGirth);
    const sh = node('shoulder', lm.shoulder - 1.2, Math.max(bustN.a * 0.9, shoulderTopA), 0.46, 0.52 + 0.06 * posture, 2.15, -0.2 - 0.2 * posture);
    // The trapezius between the shoulder line and the neck is never deeper at the back than the shoulders below it.
    const slopeA = (shoulderTopA + rNB) / 2 + 0.5;
    node('slope', lm.shoulder + (lm.snp - lm.shoulder) * 0.5, slopeA, 0.62, Math.min(0.72, (sh.b + sh.cz + 0.4 + 0.5 * posture) / slopeA), 2.2, -0.4 + 0.5 * posture);
    node('neckBase', lm.snp + 0.6, rNB + 0.6, 0.95, 0.95, 2.1, czNeckP);
    node('top', lm.snp + 1.6, rNB * 0.9, 0.95, 0.95, 2, czNeckP);
    const part = makePart({ id: 'torso', kind: 'torso', origin: [0, o, 0], axis: [0, 1, 0], e1: [1, 0, 0], e2: [0, 0, 1], length: t(lm.snp + 1.6), M: 64, dt: 1, nodes, bumps });
    return { part, nodes };
  };
  let torso, nodes;
  // Rebuild the whole torso per iteration (cheap: ~12 nodes, 64-point rings) instead of patching nodes in place:
  // the fitted node scales depend on the landmarks, so a partial update would leave stale fits.
  for (let iter = 0; iter < 6; iter++) {
    ({ part: torso, nodes } = buildTorso());
    let done = true;
    if (L.napeToWaist != null) {
      const dy = L.napeToWaist - backContour(torso, t(lm.waist), t(lm.cervicale));
      if (Math.abs(dy) > 0.01) {
        done = false;
        const hipGap = lm.waist - lm.hip, highGap = lm.waist - lm.highHip;
        lm.waist = clamp(lm.waist - dy, lm.crotch + 10, lm.underbust - 2);
        lm.hip = L.waistToHip != null ? lm.waist - L.waistToHip : lm.waist - hipGap;
        lm.hip = clamp(lm.hip, lm.crotch + 2, lm.waist - 6);
        lm.highHip = clamp(lm.waist - highGap, lm.hip + 2, lm.waist - 2);
      }
    }
    if (female) {
      // The bust point is the peak of the bump: move the bump until the peaks are bustSpan apart.
      const rg = evalRing(torso, t(lm.bust));
      const j = (bustPhi / TAU) * torso.M, j0 = Math.floor(j), g = j - j0;
      const r = rg.r[j0] * (1 - g) + rg.r[(j0 + 1) % torso.M] * g;
      const x = rg.cx + r * Math.cos(bustPhi);
      const dx = x - span / 2;
      if (Math.abs(dx) > 0.01) { done = false; bustPhi = clamp(bustPhi + dx / Math.max(1, r * Math.sin(bustPhi)), 20 * DEG, 85 * DEG); }
    }
    if (done) break;
  }
  const parts = [torso];
  const stations = {};
  for (const k of ['hip', 'highHip', 'waist', 'underbust', 'bust']) {
    const nd = nodes.find((n) => n.key === k);
    stations[k === 'bust' && !female ? 'chest' : k] = { part: 'torso', t: nd.t };
  }

  // --- neck and head ---
  const neckTilt = (14 + 10 * posture) * DEG;
  const neckAxis = norm([0, Math.cos(neckTilt), Math.sin(neckTilt)]);
  const czNeck = czNeckP;
  const neckOrigin = [0, lm.snp - 3, czNeck - 0.5];
  const neckLen = Math.max(6, (lm.chin + 2 - neckOrigin[1]) / Math.cos(neckTilt) + T.neckLen * 0.15);
  const nk = { M: 32 };
  const nn = [
    { t: 0, a: rNB * 1.1, f: rNB * 1.05, b: rNB * 1.1, n: 2 },
    { t: 3, a: rNB, f: rNB * 0.95, b: rNB, n: 2 },
    { t: 3 + T.neckLen * 0.5, a: rN, f: rN * 0.95, b: rN, n: 2 },
    { t: neckLen, a: rN * 0.97, f: rN * 0.95, b: rN, n: 2 },
  ];
  fitNode(nk, nn[1], G.neckBase);
  fitNode(nk, nn[2], G.neck);
  stations.neckBase = { part: 'neck', t: nn[1].t };
  stations.neck = { part: 'neck', t: nn[2].t };
  parts.push(makePart({ id: 'neck', kind: 'neck', origin: neckOrigin, axis: neckAxis, e1: [1, 0, 0], e2: limbFrame(neckAxis).e2, length: neckLen, M: 32, dt: 1, nodes: nn }));
  const neckTop = madd(neckOrigin, neckAxis, neckLen);
  const headLen = H - neckTop[1] + 1.5;
  const hs = tg(G.head);
  const hn = [
    { t: 0, a: hs * 0.48, f: hs * 0.62, b: hs * 0.25, n: 2.2, cz: 1.2 },
    { t: headLen * 0.2, a: hs * 0.72, f: hs * 0.82, b: hs * 0.55, n: 2.2, cz: 0.9 },
    { t: headLen * 0.45, a: hs * 0.86, f: hs * 0.95, b: hs * 0.98, n: 2.15, cz: 0 },
    { t: headLen * 0.66, a: hs * 0.9, f: hs * 1.0, b: hs * 1.08, n: 2.1, cz: -0.3 },
    { t: headLen * 0.86, a: hs * 0.72, f: hs * 0.78, b: hs * 0.9, n: 2.05, cz: -0.4 },
    { t: headLen, a: hs * 0.03, f: hs * 0.03, b: hs * 0.03, n: 2, cz: -0.4 },
  ];
  fitNode({ M: 32 }, hn[3], G.head);
  stations.head = { part: 'head', t: hn[3].t };
  const headUp = norm([0, 1, Math.sin(posture * 4 * DEG)]);
  parts.push(makePart({ id: 'head', kind: 'head', origin: [0, neckTop[1] - 1.5, neckTop[2] + 0.6], axis: headUp, e1: [1, 0, 0], e2: limbFrame(headUp).e2, length: headLen, M: 32, dt: 0.8, nodes: hn, capEnd: true }));

  // --- arms ---
  const rUA = tg(G.upperArm), rEl = tg(G.elbow), rWr = tg(G.wrist);
  const armpitA = torso.fn.a(t(lm.armpit));
  const joint = (s) => [s * (shoulderHalf - rUA * 0.48), lm.shoulder - rUA * 0.85, -0.3 + 1.0 * posture];
  const acromion = (s) => [s * shoulderHalf, lm.shoulder, -0.3 + 1.0 * posture];
  // Hanging (reference) abduction: the arm clears the torso at the armpit.
  const J0 = joint(1);
  const relaxedAbd = Math.atan2(Math.max(0.5, armpitA + rUA + 0.6 - J0[0]), Math.max(4, J0[1] - lm.armpit));
  const abd = pose === 't' ? 88 * DEG : pose === 'a' ? Math.max(relaxedAbd + 28 * DEG, 42 * DEG) : relaxedAbd;
  const elbowBend = pose === 'relaxed' ? 14 * DEG : 0;
  // Upper arm length from the acromion to the elbow (reference posture), forearm from the elbow to the wrist.
  const U = L.armLength * T.ref.upperArm, Lf = L.armLength - U;
  const dir0 = norm([Math.sin(relaxedAbd), -Math.cos(relaxedAbd), 0]);
  const JA = sub(J0, acromion(1));
  const bq = dir0[0] * JA[0] + dir0[1] * JA[1] + dir0[2] * JA[2];
  const cq = JA[0] ** 2 + JA[1] ** 2 + JA[2] ** 2 - U * U;
  // Lu solves |JA + Lu * dir0| = U (ray from the joint hitting a sphere of radius U around the acromion): the arm
  // is measured from the acromion but hinges at the joint, which sits inside the shoulder.
  const Lu = -bq + Math.sqrt(Math.max(0, bq * bq - cq));
  const pts = { acromionL: acromion(1), acromionR: acromion(-1) };
  for (const s of [1, -1]) {
    const side = s > 0 ? 'L' : 'R';
    const J = joint(s);
    const up = norm([s * Math.sin(abd), -Math.cos(abd), 0]);
    const ua = makeLimb(`upperArm${side}`, 'upperArm', side, J, up, Lu, [
      { t: 0, r: rUA * 1.12, fa: 1.08 }, { t: Lu * 0.16, r: rUA * 1.16, fa: 1.06 }, { t: Lu * 0.45, r: rUA, fa: 1, girth: G.upperArm }, { t: Lu * 0.85, r: rEl * 1.05, fa: 0.95 }, { t: Lu, r: rEl, fa: 0.92, girth: G.elbow },
    ]);
    parts.push(ua);
    const E = madd(J, up, Lu);
    // Forearm: in the relaxed pose the elbow bends forward.
    const fdir = elbowBend ? norm(madd(scale(up, Math.cos(elbowBend)), [0, 0, 1], Math.sin(elbowBend))) : up;
    parts.push(makeLimb(`forearm${side}`, 'forearm', side, E, fdir, Lf, [
      { t: 0, r: rEl, fa: 0.92 }, { t: Lf * 0.22, r: tg(G.elbow * 1.07), fa: 0.88 }, { t: Lf * 0.7, r: (rWr + rEl) / 2, fa: 0.8 }, { t: Lf, r: rWr, fa: 0.72, girth: G.wrist },
    ]));
    const W = madd(E, fdir, Lf);
    const handLen = H * 0.108;
    parts.push(makeLimb(`hand${side}`, 'hand', side, W, fdir, handLen, [
      { t: 0, r: rWr * 0.98, fa: 0.7 }, { t: handLen * 0.35, r: rWr * 1.35, fa: 0.42 }, { t: handLen * 0.7, r: rWr * 1.25, fa: 0.38 }, { t: handLen, r: rWr * 0.55, fa: 0.5 },
    ], { lateral: true }));
    if (s > 0) Object.assign(stations, { upperArm: { part: 'upperArmL', t: Lu * 0.45 }, elbow: { part: 'upperArmL', t: Lu }, wrist: { part: 'forearmL', t: Lf } });
    pts['shoulderJoint' + side] = J;
    pts['elbow' + side] = E;
    pts['wrist' + side] = W;
  }

  // --- legs and feet ---
  const rTh = tg(G.thigh), rKn = tg(G.knee), rCa = tg(G.calf), rAn = tg(G.ankle);
  const hipA = nodes.find((n) => n.key === 'hip').a;
  const xh = Math.max(rTh * 0.92, hipA - rTh * 0.98);
  const legAbd = (pose === 't' ? 6 : pose === 'a' ? 4 : 1.2) * DEG;
  for (const s of [1, -1]) {
    const side = s > 0 ? 'L' : 'R';
    // the leg starts deep inside the torso, narrow, and swells to the thigh only where the torso already covers it
    const top = [s * xh, lm.crotch + 0.085 * H, -0.6];
    const ankleC0 = [s * xh * 0.72, lm.ankle, -1.2];
    let dir = norm(sub(ankleC0, top));
    dir = norm(rotate(dir, [0, 0, 1], s * legAbd));
    const len = (top[1] - lm.ankle) / -dir[1];
    const tk = (top[1] - lm.knee) / -dir[1];
    const tc = (top[1] - (lm.knee - 0.075 * H)) / -dir[1];
    const tcr = (top[1] - (lm.crotch - 2)) / -dir[1];
    parts.push(makeLimb(`leg${side}`, 'leg', side, top, dir, len, [
      { t: 0, r: rTh * 0.62, fa: 1 }, { t: (top[1] - (lm.crotch + 0.035 * H)) / -dir[1], r: rTh * 1.06, fa: 1 }, { t: tcr, r: rTh, fa: 1, girth: G.thigh }, { t: (tcr + tk) / 2, r: (rTh + rKn) / 2 * 1.04, fa: 0.98 },
      { t: tk, r: rKn, fa: 0.95, girth: G.knee }, { t: tc, r: rCa, fa: 1.05, girth: G.calf, cz: -0.8 }, { t: len - 3.5, r: rAn * 1.08, fa: 1 }, { t: len, r: rAn, fa: 1.1, girth: G.ankle },
    ]));
    const A = madd(top, dir, len);
    if (s > 0) Object.assign(stations, { thigh: { part: 'legL', t: tcr }, knee: { part: 'legL', t: tk }, calf: { part: 'legL', t: tc }, ankle: { part: 'legL', t: len } });
    pts['hipJoint' + side] = top;
    pts['knee' + side] = madd(top, dir, tk);
    pts['ankle' + side] = A;
    // Foot: heel to toe along +z, flat on the floor.
    const footLen = H * 0.148, fw = footLen * 0.39;
    const footNodes = [
      { t: 0, a: fw * 0.3, f: lm.ankle * 0.46, b: lm.ankle * 0.46, n: 2.1, cz: lm.ankle * 0.46 },
      { t: footLen * 0.2, a: fw * 0.38, f: lm.ankle * 0.72, b: lm.ankle * 0.72, n: 2.2, cz: lm.ankle * 0.72 },
      { t: footLen * 0.45, a: fw * 0.44, f: lm.ankle * 0.6, b: lm.ankle * 0.6, n: 2.3, cz: lm.ankle * 0.6 },
      { t: footLen * 0.7, a: fw * 0.5, f: lm.ankle * 0.36, b: lm.ankle * 0.36, n: 2.3, cz: lm.ankle * 0.36 },
      { t: footLen * 0.9, a: fw * 0.42, f: lm.ankle * 0.28, b: lm.ankle * 0.28, n: 2.1, cz: lm.ankle * 0.28 },
      { t: footLen, a: fw * 0.22, f: lm.ankle * 0.16, b: lm.ankle * 0.16, n: 2, cz: lm.ankle * 0.16 },
    ];
    parts.push(makePart({ id: `foot${side}`, kind: 'foot', side, origin: [A[0] + s * 0.4, 0, A[2] - footLen * 0.22], axis: [0, 0, 1], e1: [1, 0, 0], e2: [0, 1, 0], length: footLen, M: 32, dt: 1, nodes: footNodes }));
  }

  // Bust points (women) / nipples (men): the front-most points of the bust bumps.
  for (const s of [1, -1]) {
    const phi = s > 0 ? bustPhi : Math.PI - bustPhi;
    const rg = evalRing(torso, t(lm.bust));
    const jf = (phi / TAU) * torso.M, j0 = Math.floor(jf) % torso.M, g = jf - Math.floor(jf);
    const r = rg.r[j0] * (1 - g) + rg.r[(j0 + 1) % torso.M] * g;
    pts['bustPoint' + (s > 0 ? 'L' : 'R')] = [rg.cx + r * Math.cos(phi), lm.bust, rg.cz + r * Math.sin(phi)];
  }
  pts.snpL = [rNB, lm.snp, czNeck];
  pts.snpR = [-rNB, lm.snp, czNeck];
  pts.cervicale = [0, lm.cervicale, czNeck - rNB];

  return { sex: T.sex, pose, H, targets: T, lm, pts, parts, stations, shoulderHalf, abduction: abd, relaxedAbduction: relaxedAbd, upperArmLength: U, forearmLength: Lf };
}

// A limb: nodes [{ t, r, fa (front/back depth to width), girth?, cz? }] around an axis; e1 lateral, e2 forward.
// KNOWN DEFECT: opts.lateral selects [0, 0, 1] in both branches, so the hand frame is identical to the arm frame and
// the option has no effect. Fix: pass the intended lateral reference vector (e.g. the palm normal) in the true branch.
function makeLimb(id, kind, side, origin, axis, length, specNodes, opts = {}) {
  const { e1, e2 } = limbFrame(axis, opts.lateral ? [0, 0, 1] : [0, 0, 1]);
  const spec = { M: 32 };
  const nodes = specNodes.map((s) => {
    const nd = { t: s.t, a: s.r, f: s.r * s.fa, b: s.r * s.fa, n: 2, cx: 0, cz: s.cz || 0 };
    if (s.girth) fitNode(spec, nd, s.girth);
    return nd;
  });
  return makePart({ id, kind, side, origin, axis, e1, e2, length, M: 32, dt: 1.2, nodes });
}

// Length of the centre-back contour (phi = 270 deg) of the torso between two axis positions.
// Polyline in the sagittal plane, sampled every 0.5 cm: follows the spine's curvature, as a tape laid on the back
// would. Index M*3/4 assumes M divisible by 4 (the torso uses 64).
export function backContour(torso, t0, t1) {
  const n = Math.max(4, Math.ceil(Math.abs(t1 - t0) / 0.5));
  let s = 0, prev = null;
  for (let i = 0; i <= n; i++) {
    const tt = t0 + (t1 - t0) * i / n;
    const rg = evalRing(torso, tt);
    const z = rg.cz - rg.r[(torso.M * 3) / 4];
    if (prev) s += Math.hypot(tt - prev[0], z - prev[1]);
    prev = [tt, z];
  }
  return s;
}

// Front contour (phi = 90 deg) length between two axis positions (used by the crotch length).
export function frontContour(torso, t0, t1) {
  const n = Math.max(4, Math.ceil(Math.abs(t1 - t0) / 0.5));
  let s = 0, prev = null;
  for (let i = 0; i <= n; i++) {
    const tt = t0 + (t1 - t0) * i / n;
    const rg = evalRing(torso, tt);
    const z = rg.cz + rg.r[torso.M / 4];
    if (prev) s += Math.hypot(tt - prev[0], z - prev[1]);
    prev = [tt, z];
  }
  return s;
}

// World position of a part point (t, phi) at the ring surface plus an offset.
// Expects phi in [0, TAU): a negative phi gives a negative index and NaN coordinates; callers must normalise.
export function partPoint(part, t, phi, offset = 0) {
  const rg = ringAt(part, t);
  const j = ((phi / TAU) * part.M) % part.M;
  const j0 = Math.floor(j), f = j - j0;
  const r = rg.r[j0 % part.M] * (1 - f) + rg.r[(j0 + 1) % part.M] * f + offset;
  const u = rg.cx + r * Math.cos(phi), v = rg.cz + r * Math.sin(phi);
  return add(add(madd(part.origin, part.axis, t), scale(part.e1, u)), scale(part.e2, v));
}

export const partById = (rig, id) => rig.parts.find((p) => p.id === id);
export { evalRing };
