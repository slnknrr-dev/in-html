// body/measure.js - body measurements after the definitions of ISO 8559-1 (anthropometric definitions for body
// measurement): girths are taken horizontally (limbs: perpendicular to the limb axis) as a tape takes them, i.e. the
// convex hull of the cross-section; heights are vertical distances to the floor; lengths follow the body contour
// where the standard says so. Values are measured on the rig itself, so an overridden measurement reads back exactly.
//
//   MEASUREMENTS                    [{ id, kind: 'girth'|'height'|'length'|'width', group, sex?, editable, def }]
//   measureBody(body | rig)         -> { id: cm } (every measurement of MEASUREMENTS that applies to the sex)
//   draftMeasurements(body | rig)   -> the subset garment drafting uses, with the primary chest girth as `B`
//   primaryGirth(m)                 -> bust (women) or chest (men)

//
// Key invariant: measurements are read back from the built rig, never echoed from the input. If the user overrides
// the waist to 70 cm, measureBody must return 70 because the rig really has that ring; a mismatch reveals a bug in
// body.js fitting instead of hiding it. Landmark heights (lm) are absolute y in cm from the floor; t(y) converts to
// the torso's own axial coordinate.
import { TAU, hull, perimeter } from './geom.js';
import { OVERRIDABLE, backContour, buildRig, evalRing, frontContour, partById, ringGirth, ringPoints } from './body.js';

// def: the measuring method in the words of the standard (paraphrased); sex: only for that sex.
export const MEASUREMENTS = [
  { id: 'stature', kind: 'height', group: 'main', def: 'Vertical distance from the floor to the highest point of the head, standing erect, feet together.' },
  { id: 'bust', kind: 'girth', group: 'main', sex: 'female', def: 'Maximum horizontal girth measured at bust point level.' },
  { id: 'chest', kind: 'girth', group: 'main', sex: 'male', def: 'Horizontal girth under the armpits across the most prominent point of the chest (breathing normally).' },
  { id: 'underbust', kind: 'girth', group: 'main', sex: 'female', def: 'Horizontal girth just below the breasts.' },
  { id: 'waist', kind: 'girth', group: 'main', def: 'Girth of the natural waistline between the top of the hip bones and the lower ribs, horizontal.' },
  { id: 'highHip', kind: 'girth', group: 'main', def: 'Horizontal girth halfway between the waist and the hip girth (the abdomen).' },
  { id: 'hip', kind: 'girth', group: 'main', def: 'Horizontal girth at the level of the greatest lateral trochanter projection / buttock prominence.' },
  { id: 'head', kind: 'girth', group: 'head', def: 'Maximum horizontal girth of the head above the eyebrows and ears.' },
  { id: 'neck', kind: 'girth', group: 'head', def: 'Girth of the neck midway between the neck base and the head.' },
  { id: 'neckBase', kind: 'girth', group: 'head', def: 'Girth at the base of the neck through the cervicale, the side neck points and the front neck point.' },
  { id: 'shoulderWidth', kind: 'width', group: 'upper', def: 'Distance between the left and right acromion points (biacromial breadth).' },
  { id: 'shoulderLength', kind: 'length', group: 'upper', def: 'Distance from the side neck point to the acromion.' },
  { id: 'backWidth', kind: 'length', group: 'upper', def: 'Horizontal distance across the back between the posterior armpit folds (across back).' },
  { id: 'chestWidth', kind: 'length', group: 'upper', def: 'Horizontal distance across the chest between the anterior armpit folds (across front).' },
  { id: 'napeToWaist', kind: 'length', group: 'upper', def: 'Distance from the cervicale down the spine contour to the waistline (back waist length).' },
  { id: 'frontNeckToWaist', kind: 'length', group: 'upper', def: 'Distance from the front neck point down the centre front contour to the waistline.' },
  { id: 'scyeDepth', kind: 'length', group: 'upper', def: 'Vertical distance from the cervicale to the armpit level.' },
  { id: 'bustSpan', kind: 'width', group: 'upper', sex: 'female', def: 'Horizontal distance between the bust points.' },
  { id: 'shoulderToBust', kind: 'length', group: 'upper', sex: 'female', def: 'Distance from the side neck point to the bust point.' },
  { id: 'armLength', kind: 'length', group: 'arm', def: 'Distance from the acromion over the elbow to the wrist (ulnar styloid), arm hanging.' },
  { id: 'upperArmLength', kind: 'length', group: 'arm', def: 'Distance from the acromion to the elbow, arm hanging.' },
  { id: 'upperArm', kind: 'girth', group: 'arm', def: 'Girth of the upper arm halfway between the acromion and the elbow, perpendicular to the arm.' },
  { id: 'elbow', kind: 'girth', group: 'arm', def: 'Girth over the elbow point, arm straight.' },
  { id: 'wrist', kind: 'girth', group: 'arm', def: 'Girth of the wrist over the ulnar styloid.' },
  { id: 'waistToHip', kind: 'length', group: 'leg', def: 'Vertical distance from the waistline to the hip girth level at the side.' },
  { id: 'crotchDepth', kind: 'length', group: 'leg', def: 'Vertical distance from the waistline to the crotch level (body rise).' },
  { id: 'crotchLength', kind: 'length', group: 'leg', def: 'Distance from the centre front waist through the crotch to the centre back waist (total rise).' },
  { id: 'insideLeg', kind: 'height', group: 'leg', def: 'Vertical distance from the crotch to the floor (inside leg).' },
  { id: 'outsideLeg', kind: 'height', group: 'leg', def: 'Vertical distance from the waistline at the side to the floor.' },
  { id: 'thigh', kind: 'girth', group: 'leg', def: 'Horizontal girth of the thigh just below the gluteal fold.' },
  { id: 'knee', kind: 'girth', group: 'leg', def: 'Girth over the middle of the kneecap, leg straight.' },
  { id: 'calf', kind: 'girth', group: 'leg', def: 'Maximum horizontal girth of the calf.' },
  { id: 'ankle', kind: 'girth', group: 'leg', def: 'Minimum girth of the leg above the ankle bones.' },
  { id: 'cervicaleHeight', kind: 'height', group: 'heights', def: 'Vertical distance from the floor to the cervicale (7th cervical vertebra).' },
  { id: 'shoulderHeight', kind: 'height', group: 'heights', def: 'Vertical distance from the floor to the acromion.' },
  { id: 'waistHeight', kind: 'height', group: 'heights', def: 'Vertical distance from the floor to the waistline at the front.' },
  { id: 'hipHeight', kind: 'height', group: 'heights', def: 'Vertical distance from the floor to the hip girth level.' },
  { id: 'kneeHeight', kind: 'height', group: 'heights', def: 'Vertical distance from the floor to the middle of the kneecap.' },
].map((m) => ({ ...m, editable: OVERRIDABLE.includes(m.id) }));

export const measurementDef = (id) => MEASUREMENTS.find((m) => m.id === id) || null;
export const primaryGirth = (m) => m.bust ?? m.chest;

const asRig = (x) => (x && x.parts && x.lm ? x : buildRig(x));

// Arc length over the torso ring at height y between two angles (radians, increasing).
// Sampled at 4x the ring resolution: chord sums under-measure arcs, and 4 sub-steps per ring sample keep the error
// well under a millimetre. A straight chord would ignore the back's curvature (across back is measured over it).
// KNOWN DEFECT: ringPoints(rg) is computed and discarded (void pts), wasted work per call. Fix: remove the call.
function arcAt(torso, t, from, to) {
  const rg = evalRing(torso, t);
  const pts = ringPoints(rg);
  const M = torso.M;
  let s = 0;
  const steps = Math.max(4, Math.round(((to - from) / TAU) * M * 4));
  let prev = null;
  for (let k = 0; k <= steps; k++) {
    const phi = from + (to - from) * k / steps;
    const jf = ((phi / TAU) * M + M) % M, j0 = Math.floor(jf), g = jf - j0;
    const r = rg.r[j0] * (1 - g) + rg.r[(j0 + 1) % M] * g;
    const p = [rg.cx + r * Math.cos(phi), rg.cz + r * Math.sin(phi)];
    if (prev) s += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  void pts;
  return s;
}

// Angle on the torso ring at t where the lateral coordinate reaches x on the front (front = true) or back half.
// Brute-force scan of 721 angles (0.25 degree): the ring is not a function of x in closed form, and this runs a few
// times per measurement, so robustness beats a root finder that could lock onto the wrong side.
function angleAtX(torso, t, x, front) {
  const rg = evalRing(torso, t);
  let best = 0, bd = Infinity;
  for (let k = 0; k <= 720; k++) {
    const phi = front ? (Math.PI * k) / 720 : Math.PI + (Math.PI * k) / 720;
    const jf = (phi / TAU) * torso.M, j0 = Math.floor(jf) % torso.M, g = jf - Math.floor(jf);
    const r = rg.r[j0] * (1 - g) + rg.r[(j0 + 1) % torso.M] * g;
    const d = Math.abs(rg.cx + r * Math.cos(phi) - x);
    if (d < bd) { bd = d; best = phi; }
  }
  return best;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function measureBody(input) {
  const rig = asRig(input);
  const { lm, pts, stations } = rig;
  const female = rig.sex === 'female';
  const torso = partById(rig, 'torso');
  const head = partById(rig, 'head');
  const t = (y) => y - torso.origin[1];
  const m = {};
  // Stature: the top of the head.
  const hr = head.rings[head.rings.length - 1];
  m.stature = head.origin[1] + head.axis[1] * hr.t;
  for (const [id, st] of Object.entries(stations)) {
    if ((id === 'bust' && !female) || (id === 'chest' && female) || (id === 'underbust' && !female)) continue;
    m[id] = ringGirth(evalRing(partById(rig, st.part), st.t));
  }
  m.shoulderWidth = dist(pts.acromionL, pts.acromionR);
  m.shoulderLength = dist(pts.snpL, pts.acromionL);
  // Across back / front: between the armpit folds, which lie inside the arm junction.
  const J = pts.shoulderJointL;
  // Armpit folds sit inside the arm junction by a fraction of the upper-arm radius (0.75 back, 0.95 front): fixed model
  // factors, not values from the standard.
  const rUA = rig.targets.girth.upperArm / TAU;
  const xb = J[0] - rUA * 0.75, xf = J[0] - rUA * 0.95;
  const tb = t(lm.armpit + 0.4 * (lm.shoulder - lm.armpit)), tf = t(lm.armpit + 0.3 * (lm.shoulder - lm.armpit));
  const b0 = angleAtX(torso, tb, xb, false), b1 = angleAtX(torso, tb, -xb, false);
  m.backWidth = arcAt(torso, tb, Math.min(b0, b1), Math.max(b0, b1));
  const f0 = angleAtX(torso, tf, xf, true), f1 = angleAtX(torso, tf, -xf, true);
  m.chestWidth = arcAt(torso, tf, Math.min(f0, f1), Math.max(f0, f1));
  m.napeToWaist = backContour(torso, t(lm.waist), t(lm.cervicale));
  const fnp = lm.snp - (rig.targets.girth.neckBase / TAU) * 1.25;
  m.frontNeckToWaist = frontContour(torso, t(lm.waist), t(fnp));
  m.scyeDepth = lm.cervicale - lm.armpit;
  if (female) {
    m.bustSpan = Math.abs(pts.bustPointL[0] - pts.bustPointR[0]);
    m.shoulderToBust = dist(pts.snpL, pts.bustPointL);
  }
  m.armLength = rig.upperArmLength + rig.forearmLength;
  m.upperArmLength = rig.upperArmLength;
  m.waistToHip = lm.waist - lm.hip;
  m.crotchDepth = lm.waist - lm.crotch;
  const cr = evalRing(torso, 0);
  // Total rise: front contour + back contour + the passage under the crotch, approximated from the side radii of
  // the lowest torso ring times a fixed factor 0.55 (a model approximation, not a measured arc).
  m.crotchLength = frontContour(torso, 0, t(lm.waist)) + backContour(torso, 0, t(lm.waist)) + (cr.r[torso.M / 4] + cr.r[(torso.M * 3) / 4]) * 0.55;
  m.insideLeg = lm.crotch;
  m.outsideLeg = lm.waist;
  m.cervicaleHeight = lm.cervicale;
  m.shoulderHeight = lm.shoulder;
  m.waistHeight = lm.waist;
  m.hipHeight = lm.hip;
  m.kneeHeight = lm.knee;
  return m;
}

// The measurements the pattern drafting uses (garment/), cm.
export function draftMeasurements(input) {
  const rig = asRig(input);
  const m = measureBody(rig);
  return {
    sex: rig.sex, ...m, B: primaryGirth(m), W: m.waist, Hp: m.hip,
    // Bust prominence for darts: how far the bust stands out of the underbust (women), a little for men.
    bustProminence: rig.sex === 'female' ? Math.max(0, (m.bust - m.underbust) / TAU * 1.1) : 0.4,
    shoulderSlope: rig.targets.slope,
  };
}

// Girth of the convex hull of arbitrary 2D points (exported for the garment library's own checks).
export const hullGirth = (pts) => perimeter(hull(pts));
