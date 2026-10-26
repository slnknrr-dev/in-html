# body/

A parametric human body for clothing: sex, height, weight (the BMI drives the girths), age, twelve shape features
and directly edited measurements produce one **rig** of generalized cylinders. The mesh, the measurements, the 2D
silhouettes and the collider of the cloth simulation all read the same cross-sections, so a waist typed in by the user
is exactly the waist measured on the mesh, the waist the pattern is drafted from and the waist the cloth drapes
around. Pure ES modules, no DOM, importable in Node; no external models — everything is generated from
cross-sections.

```js
import { defaultBody, buildRig, bodyFromPreset } from '../body/body.js';
import { measureBody, draftMeasurements, MEASUREMENTS } from '../body/measure.js';
import { bodyMesh } from '../body/mesh.js';
import { bodyCollider } from '../body/collide.js';
import { silhouette } from '../body/silhouette.js';
import { nearestSize, sizeBody } from '../body/sizes.js';

const body = { ...defaultBody('female'), weight: 64, features: { bust: 0.3, hips: 0.2 }, overrides: { waist: 74 } };
const rig = buildRig(body);           // ~25 ms
const m = measureBody(rig);           // { stature, bust, waist: 74, hip, armLength, napeToWaist, ... }
nearestSize(m, 'female', 'EU');       // { label: '38', labels: { EU, US, UK, RU, INT }, delta, second }
```

## Files

| file | contents |
| --- | --- |
| `body.js` | parameters (`defaultBody`, `normalizeBody`, `FEATURES`, `POSES`, `LIMITS`, `OVERRIDABLE`, `BODY_PRESETS`, `bodyFromPreset`), the growth references (`refFor(sex, age)`), BMI (`bmiOf`, `bmiCategory(bmi, age)`), the anthropometric targets (`bodyTargets`), the rig (`buildRig`), ring access (`ringAt`, `evalRing`, `ringGirth`, `partPoint`), contours (`backContour`, `frontContour`) |
| `measure.js` | `MEASUREMENTS` (38 definitions after ISO 8559-1, with the method in words), `measureBody`, `draftMeasurements` (what `garment/` drafts from), `primaryGirth` |
| `mesh.js` | `bodyMesh(rig, { step })` → positions, normals, indices, part ranges; `vertexNormals`, `meshVolume`, `bounds` |
| `collide.js` | `bodyCollider(rig)` (`collide(pos, i, offset)`, `signedDistance`, `inside`), `bodyVolume`, `weightFromVolume` |
| `silhouette.js` | `silhouette(rig, 'front' \| 'side' \| 'back')` (projected mesh → mask → marching squares → simplified outline), `silhouettePath`, `landmarkLines` |
| `sizes.js` | `SIZE_CHARTS` (women EU 32–54, men EU 44–62, children 86–164 by height), `sizeLabel` (EU / US / UK / RU / INT; children: height, age, US toddler T sizes), `nearestSize(m, sex, system, age)`, `sizeBody` and `childSizeBody` (bodies with a chart size's girths, for graded drafting) |
| `geom.js` | vectors, monotone cubic interpolation, convex hull, superellipse radius, bisection |
| `test.js` | `node body/test.js` |

## Model

- **Parameters**: `{ sex, height, weight, age, features: { shoulderWidth, shoulderSlope, posture, bust, belly, waist,
  hips, seat, arms, legs, neck, legLength } (each −1…1), overrides: { measurement: cm }, pose: 'a' | 't' | 'relaxed' }`.
- **Targets**: reference girths of an average adult of each sex at a reference stature and BMI, a slope per BMI unit
  (waist ≈ 2.4–2.9 cm per unit, hips ≈ 2, wrist 0.15…), the square root of the stature ratio at a fixed BMI (geometric
  similarity), age drift after 30 (waist, hips), then the features; overrides replace any of them. Landmark heights
  (cervicale, armpit, bust, waist, hip, crotch, knee…) are fractions of the stature; leg length and the shoulder slope
  move them.
- **Rig**: parts are generalized cylinders `origin + axis·t + e1·(cx + r cos φ) + e2·(cz + r sin φ)` with polar rings
  of radii (64 samples on the torso, 32 on the limbs). Rings are superellipses with separate front and back depths,
  interpolated between key nodes by monotone cubics, plus localized bumps (bust, pectorals, seat, belly, shoulder
  blades). Each node that carries a girth is scaled so that the **convex hull perimeter** of its ring (a tape bridges
  the hollow between the breasts) equals the target — exactly, since the radius is homogeneous in the node's axes.
  The back length override moves the waist until the centre-back contour has that length; the bust span moves the
  bust bumps until their peaks are that far apart.
- **Pose**: the arms rotate about the shoulder joint (A-pose ≥ 40°, T-pose 88°, relaxed = just clearing the torso
  with a 14° elbow bend); the legs abduct slightly. Arm length is defined in the hanging reference posture, so it does
  not change with the pose.
- **Consistency**: the weight implied by the mesh volume (voxels of the union of parts, density 1.0) lands within
  1–4 % of the entered weight for every preset — the girth model and the shape agree with the scales.

Coordinates: centimetres, y up from the floor, x towards the wearer's left, z forward (the wearer faces +z).

## Shape

The torso narrows below the crotch into the tops of the thighs and the legs start narrow inside it, so the hips flow
into the thighs without a ledge; the upper arm has a deltoid cap over a shoulder joint set a little outwards; the
upper torso sections are rounder; the seat and the belly are broad, soft bumps (a belly reaches from the underbust to
the hips, never a pouch); the neck widens into the trapezius; feet have a heel, an instep and a rounded ball. Every
girth is still fitted exactly at its node: the shape changes, the measurements do not.

## Children and teenagers

From 2 to 18 years the reference is not the adult one: `refFor(sex, age)` interpolates growth rows (median stature, BMI
and girths at 2, 4, 6, 8, 10 years shared by girls and boys, 12, 14, 16 per sex) towards the adult reference at 18, with
the landmark fractions of a growing body (the head about a fifth of the stature at two, short legs, a low waist), the
shoulder and arm ratios, the adult per-BMI slopes scaled down, and a maturity 0..1 that shapes the bust, pectoral,
seat and belly bumps. The adult age drift is off below 18. Presets: girls and boys of 4 and 8, teenagers of 13 and 16;
children's sizes go by height (`nearestSize` with an age under 15) and the BMI categories by age.

## Measurements

Girths are horizontal (limbs: perpendicular to the limb) convex-hull perimeters at their landmark; heights are vertical
from the floor; back / front waist lengths and the crotch length follow the centre contours; across back / front are
arcs between the armpit folds. `MEASUREMENTS[i].def` states the method; `editable` marks the 23 that can be overridden
(stature, all girths, shoulder width, arm length, inside leg, back length, waist to hip, bust span). The tests check
that every one reads back exactly after an override.

## Size charts

Typical retail body-dimension tables keyed by continental (German) sizes: women 32–54 (bust / waist / hip in 4 cm steps
to 44, then 6 cm), men 44–62 (chest = 2 × size). Women RU = EU + 6 (RU = bust ÷ 2), UK = EU − 26, US = EU − 30; men
RU = EU, UK / US = chest in inches. Brands differ — the charts are data, easy to replace. `nearestSize` weighs bust /
chest, hip and waist and returns the runner-up for bodies between sizes; `sizeBody` builds the body of a chart size
for drafting a graded set.

## Collider

`bodyCollider(rig).collide(pos, i, offset)` moves a point out of every part to `offset` cm from the surface along the
surface normal of the swept rings (the radial direction leaning against the slope of the radius, so cloth rests on
sloping shoulders) and domed ends; parts are culled by bounding boxes. `signedDistance` returns `Infinity` far from
every part.

## Limits

- A dress-form body: no fingers, toes or face; hands are mittens, the head an egg. Joints are overlapping tubes
  with domed ends, not a skinned skeleton, so only the three standing poses exist.
- The anthropometric regressions are plausible averages, not a survey model; the size charts are typical retail
  tables. Children are not modelled (16–90 years).
- Measurement definitions follow the methods of ISO 8559-1 in words; the clause numbers of the standard are not
  reproduced.
