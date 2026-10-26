// body/test.js - tests of the body model: `node body/test.js` (importing the module runs nothing). Normalisation,
// girths measured on the rig equal their targets, every editable measurement reads back after an override, monotone
// responses to weight / height / features, the weight implied by the mesh volume, closed outward meshes, the collider
// against the mesh surface, silhouettes, poses and the size charts (round trips and conversions).
//
// Testing style: property checks rather than golden numbers. "Measured girth = target within tolerance" and "more
// weight never shrinks the waist" survive retuning of the REF tables; exact expected values would break on every
// anthropometric adjustment without catching real bugs. near() carries explicit tolerances in cm.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BODY_PRESETS, FEATURES, OVERRIDABLE, bmiCategory, bmiOf, bodyFromPreset, buildRig, defaultBody, normalizeBody, partById, refFor, ringAt } from './body.js';
import { MEASUREMENTS, draftMeasurements, measureBody } from './measure.js';
import { bodyMesh, meshVolume } from './mesh.js';
import { bodyCollider, bodyVolume, weightFromVolume } from './collide.js';
import { landmarkLines, silhouette, silhouettePath } from './silhouette.js';
import { SIZE_CHARTS, nearestSize, sizeBody, sizeLabel } from './sizes.js';
import { TAU } from './geom.js';

// Run only when executed directly; importing run() has no side effects.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const t0 = Date.now();
  const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${typeof info === 'string' ? info : JSON.stringify(info)}`); } };
  const near = (name, got, want, tol) => ok(name, Math.abs(got - want) <= tol, `got ${got} want ${want} ±${tol}`);

  // --- parameters
  {
    const b = normalizeBody({ sex: 'male', height: 999, weight: -5, age: 3, features: { belly: 7, nope: 1 }, overrides: { waist: 90, bogus: 4, hip: -1 }, pose: 'zz' });
    ok('normalize clamps height', b.height === 210 && b.weight === 10 && b.age === 3, b);
    ok('normalize clamps features', b.features.belly === 1 && !('nope' in b.features) && FEATURES.every((f) => f in b.features));
    ok('normalize keeps valid overrides only', b.overrides.waist === 90 && !('bogus' in b.overrides) && !('hip' in b.overrides));
    ok('normalize pose', b.pose === 'a');
    ok('normalize never throws', normalizeBody(null).sex === 'female' && normalizeBody('x').height > 0);
    near('bmi', bmiOf({ height: 180, weight: 81 }), 25, 1e-9);
  }

  // --- girths measured on the rig equal the targets; every override reads back
  for (const sex of ['female', 'male']) {
    const rig = buildRig(defaultBody(sex));
    const m = measureBody(rig);
    for (const [k, v] of Object.entries(rig.targets.girth)) if (k !== 'underbust' || sex === 'female') near(`${sex} girth ${k} on the rig`, m[k], v, 0.02);
    near(`${sex} stature on the rig`, m.stature, rig.targets.H, 0.05);
    ok(`${sex} measurement set complete`, MEASUREMENTS.filter((d) => !d.sex || d.sex === sex).every((d) => Number.isFinite(m[d.id]) && m[d.id] > 0), Object.keys(m));
    const over = { stature: rig.H + 4, head: 58, neck: m.neck + 2, neckBase: m.neckBase + 2, waist: m.waist + 6, highHip: m.highHip + 5, hip: m.hip + 5, upperArm: m.upperArm + 2,
      elbow: m.elbow + 1, wrist: m.wrist + 1, thigh: m.thigh + 3, knee: m.knee + 1, calf: m.calf + 2, ankle: m.ankle + 1, shoulderWidth: m.shoulderWidth + 2, armLength: m.armLength + 3,
      insideLeg: m.insideLeg + 3, napeToWaist: m.napeToWaist + 2, waistToHip: m.waistToHip + 1.5 };
    if (sex === 'female') Object.assign(over, { bust: m.bust + 6, underbust: m.underbust + 3, bustSpan: m.bustSpan + 1.5 });
    else over.chest = m.chest + 6;
    const b = defaultBody(sex);
    b.overrides = over;
    const m2 = measureBody(b);
    for (const [k, v] of Object.entries(over)) near(`${sex} override ${k} reads back`, m2[k], v, k === 'bustSpan' ? 0.1 : k === 'napeToWaist' ? 0.05 : 0.03);
    ok(`${sex} every editable measurement is tested`, OVERRIDABLE.filter((k) => MEASUREMENTS.find((d) => d.id === k && (!d.sex || d.sex === sex))).every((k) => k in over));
  }

  // --- monotone responses
  {
    const at = (w, h = 166, f = {}) => measureBody(normalizeBody({ sex: 'female', height: h, weight: w, features: f }));
    const light = at(50), heavy = at(85);
    for (const k of ['bust', 'underbust', 'waist', 'highHip', 'hip', 'thigh', 'upperArm', 'neck']) ok(`heavier -> larger ${k}`, heavy[k] > light[k] + 1, [light[k], heavy[k]]);
    const short = at(60, 155), tall = at(60, 185);
    for (const k of ['stature', 'insideLeg', 'armLength', 'napeToWaist', 'shoulderWidth']) ok(`taller -> longer ${k}`, tall[k] > short[k] + 1, [short[k], tall[k]]);
    ok('bust feature', at(60, 166, { bust: 1 }).bust > at(60, 166, { bust: -1 }).bust + 8);
    ok('belly feature', at(60, 166, { belly: 1 }).waist > at(60, 166, { belly: -1 }).waist + 10);
    ok('leg length feature', at(60, 166, { legLength: 1 }).insideLeg > at(60, 166, { legLength: -1 }).insideLeg + 5);
    ok('shoulder slope feature', at(60, 166, { shoulderSlope: 1 }).shoulderHeight < at(60, 166, { shoulderSlope: -1 }).shoulderHeight - 1.5);
    ok('posture feature', at(60, 166, { posture: 1 }).napeToWaist > at(60, 166, { posture: -1 }).napeToWaist);
  }

  // --- volume-implied weight, meshes
  for (const id of Object.keys(BODY_PRESETS)) {
    const b = bodyFromPreset(id);
    const rig = buildRig(b);
    const w = weightFromVolume(bodyVolume(rig, 2));
    ok(`${id}: weight from the volume within 7 %`, Math.abs(w - b.weight) / b.weight < 0.07, [w.toFixed(1), b.weight]);
  }
  {
    const rig = buildRig(defaultBody('female'));
    const mesh = bodyMesh(rig);
    let finite = true;
    for (const v of mesh.positions) if (!Number.isFinite(v)) finite = false;
    ok('mesh finite', finite);
    for (const p of mesh.parts) {
      // Closed: every undirected edge is used by exactly two triangles, once in each direction.
      const edges = new Map();
      for (let i = p.first; i < p.first + p.count; i += 3) {
        for (let k = 0; k < 3; k++) {
          const a = mesh.indices[i + k], b = mesh.indices[i + (k + 1) % 3];
          const key = a + ',' + b;
          edges.set(key, (edges.get(key) || 0) + 1);
        }
      }
      let closed = true;
      for (const [key, n] of edges) { const [a, b] = key.split(','); if (n !== 1 || edges.get(b + ',' + a) !== 1) { closed = false; break; } }
      ok(`mesh part ${p.id} closed and consistently wound`, closed);
      ok(`mesh part ${p.id} outward (positive volume)`, meshVolume(mesh.positions, mesh.indices, p.first, p.count) > 0);
    }
    near('mesh top is the stature', mesh.bounds.max[1], rig.H, 0.3);
    near('mesh stands on the floor', mesh.bounds.min[1], 0, 0.05);
    // Collider: points on the swept surface are at distance ~0; collide() leaves a point at the clearance.
    const c = bodyCollider(rig);
    const torso = partById(rig, 'torso');
    let worst = 0;
    for (const tt of [10, 25, 35, 45]) {
      const rg = ringAt(torso, tt);
      for (let j = 0; j < torso.M; j += 4) {
        const phi = (j / torso.M) * TAU;
        const x = rg.cx + rg.r[j] * Math.cos(phi), z = rg.cz + rg.r[j] * Math.sin(phi);
        const own = c.parts[0];
        void own;
        const d = c.signedDistance(x, torso.origin[1] + tt, z);
        // Other parts may cover the torso surface (arms at the armpit), so only the outside limit is strict.
        worst = Math.max(worst, d);
      }
    }
    ok('collider: torso surface is not outside', worst < 0.15, worst);
    const p = new Float64Array([0, rig.lm.waist, 0]);
    c.collide(p, 0, 0.8);
    near('collide pushes to the clearance', c.signedDistance(p[0], p[1], p[2]), 0.8, 0.12);
    ok('far point unaffected', !c.collide(new Float64Array([0, 300, 0]), 0, 1));
  }

  // --- poses
  {
    const T = buildRig(normalizeBody({ sex: 'male', pose: 't' }));
    const hand = T.pts.wristL;
    near('T-pose: wrist at shoulder-joint height', hand[1], T.pts.shoulderJointL[1], 3);
    const A = buildRig(normalizeBody({ sex: 'female', pose: 'a' }));
    ok('A-pose: arms at 40 deg or more', A.abduction > 0.69, A.abduction);
    const R = buildRig(normalizeBody({ sex: 'female', pose: 'relaxed' }));
    // Relaxed arms clear the torso: the inner side of the upper arm at the armpit level is outside the torso.
    const ua = partById(R, 'upperArmL'), torso = partById(R, 'torso');
    const c = bodyCollider({ ...R, parts: [torso] });
    let minD = Infinity;
    for (let tt = ua.length * 0.3; tt <= ua.length; tt += 2) {
      const rg = ringAt(ua, tt);
      for (let j = 0; j < ua.M; j += 2) {
        const phi = (j / ua.M) * TAU, r = rg.r[j];
        const q = [0, 1, 2].map((k) => ua.origin[k] + ua.axis[k] * tt + ua.e1[k] * (rg.cx + r * Math.cos(phi)) + ua.e2[k] * (rg.cz + r * Math.sin(phi)));
        minD = Math.min(minD, c.signedDistance(q[0], q[1], q[2]));
      }
    }
    ok('relaxed arms do not cut into the torso', minD > -1.2, minD);
    ok('elbow bends forward in the relaxed pose', R.pts.wristL[2] > R.pts.elbowL[2] + 2);
  }

  // --- silhouettes
  {
    const rig = buildRig(defaultBody('female'));
    const mesh = bodyMesh(rig);
    const front = silhouette(rig, 'front', { mesh }), back = silhouette(rig, 'back', { mesh }), side = silhouette(rig, 'side', { mesh });
    near('front silhouette height', front.bbox.maxY, rig.H, 0.8);
    near('back mirrors front', back.bbox.maxX, -front.bbox.minX, 0.6);
    ok('side silhouette narrower than front (A-pose)', side.bbox.maxX - side.bbox.minX < front.bbox.maxX - front.bbox.minX);
    ok('outline is one big loop', front.outline.length > 40 && front.contours.length >= 1, front.contours.map((c) => c.length));
    const lines = landmarkLines(rig, front);
    const hip = lines.find((l) => l.id === 'hip');
    ok('hip line spans the hips', hip && hip.x1 - hip.x0 > 28 && hip.x1 - hip.x0 < 45, hip);
    ok('svg path', /^M[-\d.]+ [-\d.]+L/.test(silhouettePath(front.contours, { scale: 2, height: rig.H })));
  }

  // --- size charts
  for (const sex of ['female', 'male']) {
    for (const row of SIZE_CHARTS[sex]) {
      const m = measureBody(sizeBody(sex, row.eu));
      const n = nearestSize(m, sex, 'EU');
      ok(`${sex} size ${row.eu} round trip`, n.row.eu === row.eu, [n.label, n.delta]);
    }
  }
  ok('women conversions', ['EU', 'RU', 'UK', 'US', 'INT'].map((s) => sizeLabel(SIZE_CHARTS.female[3], s, 'female')).join() === '38,44,12,8,M');
  ok('men conversions', ['EU', 'RU', 'UK', 'US'].map((s) => sizeLabel(SIZE_CHARTS.male[3], s, 'male')).join() === '50,50,40,40');
  {
    const m = draftMeasurements(defaultBody('female'));
    ok('draft measurements', m.B === m.bust && m.bustProminence > 1 && m.shoulderSlope > 10, m);
    const t1 = Date.now();
    for (let i = 0; i < 10; i++) buildRig(defaultBody(i % 2 ? 'male' : 'female'));
    const per = (Date.now() - t1) / 10;
    ok('rig builds fast enough for sliders', per < 200, per);
  }

  // children and teenagers: growth references, proportions, sizes by height, BMI by age
  {
    const head = (b) => measureBody(buildRig(b)).head;
    const kid = bodyFromPreset('child-boy-4'), teen = bodyFromPreset('teen-boy-13'), man = bodyFromPreset('male-m');
    const mk = measureBody(buildRig(kid)), mt = measureBody(buildRig(teen)), mm = measureBody(buildRig(man));
    ok('child: a larger head for the stature', mk.head / mk.stature > mt.head / mt.stature && mt.head / mt.stature > mm.head / mm.stature, [mk.head / mk.stature, mm.head / mm.stature]);
    ok('child: shorter legs for the stature', mk.insideLeg / mk.stature < mm.insideLeg / mm.stature, [mk.insideLeg / mk.stature, mm.insideLeg / mm.stature]);
    ok('child: girths grow with age', ['child-girl-4', 'child-girl-8', 'teen-girl-13', 'teen-girl-16'].map((id) => measureBody(buildRig(bodyFromPreset(id))).bust).every((v, i, a) => i === 0 || v > a[i - 1]));
    ok('child: no bust bump before puberty', refFor('female', 6).mature === 0 && refFor('female', 18).mature === 1 && head(kid) > 45);
    const n = nearestSize(mk, 'male', 'EU', kid.age);
    ok('child: height size', n.child && n.label === '104' && n.labels.US === '4T', n.labels);
    ok('child: adult sizes from 15', !nearestSize(mm, 'male', 'EU', 30).child);
    ok('bmi by age', bmiCategory(15.6, 8) === 'normal' && bmiCategory(15.6, 30) === 'under' && bmiCategory(23, 8) === 'obese');
  }

  console.log(`body: ${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
