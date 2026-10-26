# cloth/

Garments sewn around a body by a position-based cloth simulation. Pattern pieces from [`garment/`](../garment/) are
meshed, placed around the body part they belong to, sewn along their seams and draped by gravity against the body
collider of [`body/`](../body/), with the fabric properties of [`fabric/`](../fabric/). Pure ES modules, no DOM,
deterministic — the same code runs in the browser and in Node (headless checks, mockup images).

```js
import { assemble } from '../cloth/assemble.js';
const S = assemble([draft], rig, { h: 3, fabricFor: (garmentIndex, material) => fabric });
for (let f = 0; f < 150; f++) S.cloth.step(1 / 60);     // 2.5 s of simulated time
S.cloth.stats();   // { finite, meanSpeed, p95Speed, seamGapMean, seamGapMax, strainMean, penetrating, ... }
S.instances;       // per piece instance: global vertex range, triangles, 2D coordinates (= texture coordinates)
```

## Files

| file | contents |
| --- | --- |
| `mesh.js` | `pieceMesh(piece, { h })` (outline resampled per edge, hexagonal interior, Bowyer–Watson Delaunay, triangles outside removed; the vertex list of every edge is kept for seams), `delaunay`, `meshEdges`, `bendPairs` |
| `sim.js` | `createCloth(n)`: XPBD with small steps — distance constraints (stretch, bending across shared edges), seam attachments (a vertex to a point between two vertices of the other side), triangle attachments (overlays, linings), pins, body collisions with a per-particle clearance and friction, layering between garments, `stats()` |
| `assemble.js` | `assemble(drafts, rig, opts)`: instances (mirrored pairs, opened folds, folded bands at half height, the jacket front cut at the roll line), arrangement modes, masses from the fabric density, seams between instances, overlays, linings attached to their shells, closures, pins, outward winding |
| `test.js` | `node cloth/test.js [--long]` — meshes, a hanging sheet and the headless stability check |

## Arrangement

The torso frame of the drafts (x from the centre back round the side to the centre front, y down from the nape)
maps straight onto angles round the torso (centre back 270°, side 180°, centre front 90°) and heights below the
cervicale, so back and front start with their side seams next to each other; skirts and trousers use the waist,
trouser pieces turn about the creases of the legs and blend into the hips above the crotch, sleeves wrap the arms from
the top of the cap, collars the neck, hoods the head, waistbands, hem bands, cuffs, cummerbunds and their straps the
waist, hem and wrists; totes hang in front of the body from pinned handles. Left instances are mirror images: their
seam paths are read in the right half's direction, so both sides of a seam — and the two halves of a centre seam —
correspond point by point, with the ease spread evenly.

Pieces of **imported patterns** (`arrange.mode: 'wrap'`) carry a place — the front, back or side of the torso, a
sleeve, a collar, the front or back of a skirt or of a trouser leg — and their bounding box wraps that part of the
body: a pair's right half from the side to the centre front or back, a single or opened-out piece the whole front or
back, the top at the shoulder line (lowered past a yoke), the waist or the shoulder joint. They have no seam list:
`orientImported` chooses which way round every piece goes so that the most edges meet, and `autoSew` sews the
pairs of edges that end together (within 6 cm, lengths within 25 %; shoulders over the top of the torso within 30 cm
when their lengths agree within 8 %; an edge with another of its own piece where they lie together or share an apex
— underarm seams, darts), then a leftover edge against two that continue each other (a sleeve cap against the front
and back armholes).

## Layers

Clearances from the body grow inside → outside: linings, shells, then the overlays of `garment/details.js` (folded
lapels, flaps, jets, welts, patch pockets, stripes, belt loops) held a lift above their parent's surface by triangle
attachments. Linings are attached to their shell along their whole outline (they are drafted in the shell's frame).
Whole garments of an outfit stack by their order: each outer garment starts farther out, and once a frame a projection
moves an outer particle out and the inner one in where they come closer than a cloth thickness along the body normal
(no velocity is added). Renderers draw linings from their inner side only.

## Stability (headless check)

Speed: once a frame (and again every four substeps, because seams can drag a particle several centimetres within a
frame) the collider lists for every particle the body parts within its reach - what it moved over the last frame,
doubled - with its distance and normal; the substeps test only those parts, and the layering between garments reuses
the distances and normals and a typed hash grid. The radius slope of the collider's normal comes from a precomputed
table. Together about a third faster than testing every part on every substep (the tuxedo 60 → 38 ms a frame).

`node cloth/test.js` simulates 2.5 s (150 frames of 1/60 s, 12 substeps) at a 3.5 cm mesh and requires every garment
to stay finite, keep all particles outside the body, close its seams (mean gap < 1.5 mm), settle (mean speed < 3
cm/s, 95 % of particles < 8 cm/s) and stretch little (mean edge strain < 5 %). Numbers of the last run (Node 24,
one core):

| garment | particles | ms / frame | mean speed (cm/s) | 95 % speed | mean / max seam gap (cm) | mean strain | inside body |
| --- | --- | --- | --- | --- | --- | --- | --- |
| t-shirt, female-m | 765 | 14 | 1.16 | 2.40 | 0.021 / 0.39 | 1.6 % | 0 |
| lined jacket, male-m | 3196 | 51 | 0.97 | 2.74 | 0.064 / 3.19 | 1.4 % | 0 |
| trousers, male-m | 1460 | 23 | 2.31 | 3.57 | 0.014 / 0.25 | 1.8 % | 0 |
| dress (lined), female-m | 2462 | 35 | 1.20 | 3.15 | 0.018 / 0.38 | 1.4 % | 0 |
| hoodie, male-m | 1837 | 28 | 0.77 | 1.97 | 0.045 / 0.78 | 2.8 % | 0 |
| tote, female-m | 402 | 2 | 0.44 | 0.80 | 0.019 / 0.63 | 1.4 % | 0 |
| shirt + lined jacket (tuxedo) | 4633 | 57 | 9.18 | 26.5 | 0.062 / 3.15 | 2.2 % | 0 |

The outfit is the weak spot: layering between garments is a projection, not cloth–cloth collision, and outer garments
keep moving a little where they press on inner ones (the check only requires it to stay bounded and sewn).

## Limits

- No self-collision inside a garment and no true cloth–cloth contact; layers are kept apart by clearances and the
  projection above. Folds that need self-contact (a collar rolling over its stand) are approximated by overlays.
- Collars stand up around the neck rather than rolling; hoods drape as a rounded shell.
- The solver runs on one thread; the viewer time-slices it per animation frame (24 ms), on message-channel ticks
  while the page is hidden. The draft quality takes 8 substeps instead of 12.
- Imported patterns drape as well as their pieces are recognised: a piece whose name does not tell its place stays
  flat until it is given one; unusual cuts (raglans, kimono sleeves, many panels) may need their places and
  orientation set by hand.
