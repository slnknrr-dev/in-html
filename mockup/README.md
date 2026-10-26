# mockup/

"This garment, in this fabric, with this print, on this body" from one serialisable spec — rendered in Node (software
renderer, for static images at build time) or shown live in a page (WebGL with a software fallback). It is the layer
between the modelling libraries ([`body/`](../body/), [`garment/`](../garment/), [`fabric/`](../fabric/),
[`motif/`](../motif/), [`cloth/`](../cloth/), [`view3d/`](../view3d/)) and anything that wants to *show* clothes: the
studio's 3D pane, its Mockup mode, and blocks of a landing or shop page (merch, product cards, configurators).

| file | contents |
| --- | --- |
| `preview.js` | the spec (`DEFAULT_SPEC`, `normalizePreviewSpec`; garments may carry `thickness`, `edits`, `imported`), `prepare` (body → measurements → drafts with the room for the layers under each → assembled cloth), `simulate`, `coolDown`, `buildScene`, `cameraFor`, `renderPreview` (Node), `bakeDrape` / `applyDrape` |
| `texture.js` | `pieceTexture`: a pattern piece's texture in its own centimetres (fabric at true thread density, its dye in the drafts' frame, repeat prints continuous across seams, placement prints) |
| `embed.js` | browser: `createViewer`, `mountPreview`, `decodeImages` |

`preview.js` and `texture.js` are pure (Node ≥ 22.12, no DOM); `embed.js` needs a DOM and uses WebGL when it can.

## The spec

```js
{
  v: 1,
  body: { preset: 'female-m' } | 'male-l' | { sex, height, weight, age, pose, features, overrides },  // body/body.js
  outfit: 'tuxedo',                                  // optional: a named outfit instead of garments
  garments: [{                                       // innermost first; at most 6
    garment: 'tshirt',                               // garment/garments.js GARMENTS
    opts: { fit: 'regular', sleeve: 'short' },       // the garment's option schema
    details: null,                                   // null = the template's defaults (garment/details.js)
    fabrics: { shell: { preset: 'jersey', color: '#f4f4f2' } },   // per material slot (fabric/fabric.js)
    design: null,                                    // a repeat print (motif/repeat.js) or null
    designOn: ['shell'],                             // materials the repeat is printed on
    placements: [{ area: 'front', x: 0, y: 0, w: 22, rot: 0,      // area: front | chest | back | sleeve (per garment)
                   art: { kind: 'image', id: 'logo' } }],         // or { kind: 'motif', motif: 'star', color }
  }],
  images: { logo: 'data:image/png;base64,…' },       // artwork used by placements (embed.js decodes it)
  view: { yaw: 0, pitch: 0.06, zoom: 1, width: 480, height: 640, background: ['#eef0f4', '#cdd2da'] },
  sim: { frames: 150, h: 3 },                        // drape length (frames of 1/60 s) and mesh size (cm)
  showBody: true, bodyColor: '#d8c8b4',
  drape: null,                                       // a baked drape (bakeDrape) - shown at once, no simulation
}
```

`normalizePreviewSpec` never throws: unknown garments are dropped, sizes clamped (64–2048 px, 0–600 frames, mesh
1.5–6 cm). A placement with an `area` is resolved against the draft's print areas (`resolvePlacement`), so `x` / `y`
are offsets from the area's centre in cm and the same spec fits any body size.

## In a page

```js
import { mountPreview } from '../mockup/embed.js';

const v = mountPreview(document.querySelector('#tee'), spec, { onStatus: (s) => {} });
v.update({ ...spec, garments: [{ ...spec.garments[0], fabrics: { shell: { preset: 'jersey', color: '#1d1d1f' } } }] });
v.setView({ yaw: Math.PI });                             // the back
const png = await v.snapshot({ width: 1200, height: 1500 });   // data URL
v.destroy();
```

`createViewer(element, { onStatus, background, budget, forceSoft, label })` is the lower level: `load(prepare(spec),
{ images })` drapes (time-sliced: at most `budget` ms of simulation per animation frame, 14 by default, so the page
stays responsive; then the drape cools down and stops), `refresh({ images, garments, fabricFor })` repaints fabrics and
prints on the same drape, `setView`, `pause`, `resume(frames)`, `redraw`, `stats`, `snapshot({ width, height, view })`,
`destroy`. Orbit with the mouse, touch (drag, pinch) and keys (arrows, `+` / `-`) on the focused canvas. Status
callbacks: `{ state: 'draping' | 'done' | 'paused', frame, target, mode: 'webgl' | 'soft', stats }`.

The viewer makes no network requests (artwork comes in the spec as data URLs), so it can be inlined into single-file
offline pages.

## For a landing / shop page (merch)

A shop block for printed merch keeps one spec per product and swaps what the customer chooses:

- **Product card**: a spec with the blank (`tshirt`, `longsleeve`, `tank`, `sweatshirt`, `hoodie`, `tote`), the
  shop's artwork in `images` and a placement on `front`; the colour swatches of the card call `v.update` with another
  `fabrics.shell.color` (with a baked drape the update shows at once).
- **Instant display**: draping takes from a fraction of a second (T-shirt) to a few seconds (lined jacket). Bake it
  once — `bakeDrape(prep)` after `simulate` / `coolDown` in Node or in the studio — and put the result into the spec's
  `drape`: the page shows the finished garment at once, and colour or artwork changes keep that drape.
- **Static images**: `renderPreview(spec, { views: [0, Math.PI], width, height, ss: 2 })` in Node returns RGBA images
  (front and back) for catalogue thumbnails, social cards or a no-JavaScript fallback; encode them with `png/`.
- **Sizes and bodies**: the same spec on `female-s` … `male-athletic` presets (or measured bodies) shows fit on
  different people; `garment/` grades the pattern for production files.
- **Configurator**: the studio's project file carries the same garments, fabrics and placements, so a product can be
  designed in Textile Studio and its outfit copied into a spec.

The landing builder (`landing-app-serverless/`) is not changed by this library; a block that wants previews imports
`mockup/embed.js` like any other module (the single-file build inlines it).

## Tests

`node mockup/test.js` (also run by `node check.js`): spec normalisation, print areas, piece textures, a T-shirt with a
print draped and rendered in Node, baked drapes restoring the same image, `renderPreview` views.
