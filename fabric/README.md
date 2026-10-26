# fabric/

Fabrics as data: weave structures and weaving drafts, knits, warp and weft colour orders (stripes, checks, tartan
setts, colour-and-weave effects such as houndstooth), physical properties for rendering and cloth simulation, and
procedural seamless textures. Pure ES modules, no DOM, importable in Node.

```js
import { normalizeFabric, simParams } from '../fabric/fabric.js';
import { fabricTexture } from '../fabric/texture.js';
import { weave, weaveToDraft, drawdown } from '../fabric/weave.js';

const f = normalizeFabric({ preset: 'tartan', sett: 'K/4 R24 K24 Y/4' });
const tex = fabricTexture(f, { px: 6 });          // { width, height, data (RGBA), cm: [w, h] of the tile }
const draft = weaveToDraft(weave('satin', { shafts: 8, move: 3 })); // threading, tie-up, treadling: 8 shafts
```

## Files

| file | contents |
| --- | --- |
| `weave.js` | `weave(kind, params)` for `WEAVES` (plain, twill S / Z any up / down, herringbone, broken twill, satin with a valid move, basket, warp / weft rib, hopsack, diamond), `jacquard(bitmap, { figure, ground })`, `drawdown(draft)`, `weaveToDraft(weave)` (minimal shafts and treadles), `floats`, `warpFace`, `weaveEquals`, `KNITS` / `knit(kind)` (jersey, 1×1 and 2×2 rib, interlock, purl, piqué, French terry, fleece) |
| `fabric.js` | `FABRICS` (29 presets: poplin, oxford, gingham, denim, suiting, flannel, tweed, barathea, houndstooth, tartan, satin, charmeuse, linen, lining, habotai, interfacing, canvas, pocketing, cotton canvas, jersey, rib, French terry, fleece, piqué, broadcloth, velvet, nylon ripstop, gabardine, wadding), `normalizeFabric`, `fabricWeave`, `colorOrder`, `parseSett`, `TARTAN_COLORS`, `averageColor`, `simParams`, `MATERIAL_DEFAULTS` |
| `texture.js` | `fabricTexture(fabric, { px, maxSize, repeat })`, `tileSeamless` |
| `dye.js` | dyeing over the finished fabric in the garment's centimetres: `DYES` (none, ombré, dip-dye, tie-dye, spray), `normalizeDye`, `dyeWeight`, `applyDye` (multiply blend), `dyeSVG` (a gradient fill for 2D) |
| `test.js` | `node fabric/test.js` |

## Model

A fabric is `{ preset, structure: { type: 'woven', weave, params } | { type: 'knit', knit }, color, warp, weft, sett,
threadsPerCm, props: { gsm, thickness (mm), stretchWarp, stretchWeft (%), bending, shear, sheen, roughness, friction
(0…1) } }`. A weave is a binary matrix over one repeat (1 = warp over weft). The drawdown of a draft is computed exactly
as a loom does (end up when its shaft is tied to the pick's treadle); the minimal draft of a weave gives every distinct
warp column a shaft and every distinct pick a treadle, so `drawdown(weaveToDraft(w))` is `w` again (tested for every
structure, plus a hand-drafted point twill).

Textures draw every crossing as a float of its yarn — a rounded cross-section, a highlight along the float that grows
with the float length and the sheen (satins gleam, plain weaves stay matte), a seeded per-thread slub and dark gaps —
and knits as V loops, purl bumps and terry loops. The tile is the least common multiple of the weave repeat and the
colour orders, so it is seamless by construction; `repeat: [2, 2]` renders copies and `tileSeamless` proves them
identical. `cm` gives the physical size of the tile from the thread density; applications usually show threads
larger than life so that structures stay visible at screen scale.

`simParams` maps the properties to the cloth solver: density (g/cm²) from the gsm, stretch compliance from the
stretch percentages, bending and shear compliances from the stiffnesses (a canvas bends some 50× less than habotai),
collision thickness, friction and damping.

## Limits

- Yarn twist, hairiness, pile and print-on-knit distortion are not modelled; knits are charts with a simple loop
  look. Jacquards are two-structure (figure / ground) from a thresholded bitmap.
- The physical properties of the presets are typical values, not laboratory measurements (Kawabata / FAST).
