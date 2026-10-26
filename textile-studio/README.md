# Textile Studio (`textile-studio`)

Garment modelling for desktop and phones, in the order clothes are made: a **body** (sex, height, weight, age from 2 to
90, pose, twelve features, every measurement editable; children and teenagers grow by their own references), a
**template** drafted from its measurements (26 garments in six groups and 17 ready outfits: tuxedos, suits and classics
for men and women, Georgian chokha and kartuli, Slavic kosovorotka, kaftan, rubakha and sarafan, jackets), the **details** layered from the inside out (pocketing, linings, canvas, interfacings,
facings, the shell, bands, plackets, lapels, collars, pockets, flaps, trims, buttons), with the **fabric** editor and
the **print** editor at every step. The 2D view and the 3D view stand side by side (tabs on phones). A **Mockup**
mode is the quick path for merch: a blank, a model, your artwork, images of the front and the back.

Everything runs in the browser, on the repository's libraries: [`body/`](../body/) (parametric bodies and
measurements), [`garment/`](../garment/) (drafting, details, seams, grading, nesting, PDF / SVG / DXF),
[`fabric/`](../fabric/) (weaves, knits, presets with physical properties, textures), [`motif/`](../motif/) (print
design), [`cloth/`](../cloth/) (meshes and the cloth simulation), [`view3d/`](../view3d/) (WebGL and software
renderers) and [`mockup/`](../mockup/) (textured previews, the embeddable viewer).

## Artifacts

Built from the NOTICE files (`node singlefile.js textile-studio`):

| artifact | what it is |
| --- | --- |
| `html@5_offline_singlefile/index.html` | the whole studio in one file without any network code — from disk, a USB stick, any host |
| `html@5_serverless/` | a static site for any static host; nothing leaves the visitor's browser |

## Steps

- **Body**: start from a preset (women S / M / L / curvy / tall, men S / M / L / athletic) or set sex, height, weight
  (with the BMI), age and pose (A, T, relaxed); twelve feature sliders (bust, waist, belly, hips, seat, shoulder width
  and slope, neck, arms, legs, leg length, posture). The 38 measurements (ISO 8559-1 style) are measured on the body;
  the girths and lengths a pattern needs can be typed in and override the body, which is refitted to them exactly. The
  nearest size is shown in the EU, US, UK, RU and INT systems with the differences.
- **Template**: the outfit is a stack of garments, innermost first (reorder, add, remove; *Tuxedo outfit* sets shirt,
  trousers, cummerbund and dinner jacket with satin shawl lapels, satin stripes and jetted pockets). The gallery
  switches the active garment's template; its options (fit, length, sleeves, neckline, closure, …) and the seam
  allowance follow.
- **Details**: the layered components of the active garment by layer (outer details, inner layers) with their variants
  and options; adding a lining copies the shell pieces, a lapel rebuilds the front with its roll line and facing.
  **The pattern is edited in place**: a click on a piece of the 2D pattern selects it - its material slot (the shell,
  a contrast, satin, accents), the colour and the dye of that material, and the **layers** laid on it (rectangles,
  ellipses, shapes drawn point by point, presets: yoke, hem band, elbow patch, appliqué), dragged on the pattern,
  sized and turned with sliders, on both halves or one; every layer is a cut piece (layouts, usage) and an overlay
  sewn onto its piece in 3D. **The outline itself is reshaped** by dragging the handles of the selected piece (round
  ones on the corners, square ones in the middles of the edges): the edge bends smoothly over a reach you set, its
  lining, interfacing and wadding follow, and the seams that no longer match are listed with their difference.
- **Layers of the outfit**: every garment has a thickness (its shell, lining and insulation, or set by hand); the
  garments over it are drafted with 2π × that thickness more on the girths it covers (the Template step shows the
  thickness and the room taken by the layers under the active garment).
- **Fabric**: a fabric per material slot of the garment (shell, lining, satin, contrast, rib, interfacing, canvas,
  pocketing, wadding, accents) from 29 presets, or your own: woven (ten weaves with parameters or your own drawdown — click its cells
  in the 2D weaving draft), knitted (eight stitches) or a jacquard from a picture; colours as warp and weft colour
  orders or a tartan sett; weight, thickness, stretch, stiffness, shear, sheen, roughness and friction drive the drape.
- **Print**: an all-over repeat (block, half-drop, brick, mirror, rotate; motifs, colourways, the seamless check and
  the colour separations) printed on chosen materials, and placement prints (motifs or uploaded artwork) on the print
  areas of the garment, moved with sliders or dragged on the pattern.
- **Dyeing**: over any material - ombré (a gradient in a direction), dip-dye (from a line down, a ragged soft edge),
  tie-dye (rings round a centre), spray; in the garment's centimetres, so it runs across seams, in 2D and in 3D.
- **Material usage**: per garment and material the length of the cutting layout on the fabric width and the length to
  buy, the buttons by size, zips, hooks, gazyri cartridges and thread; as a CSV table.
- **Import**: patterns from DXF files (AAMA pieces of other pattern CAD systems or the closed outlines of a drawing, in
  cm, mm or inches) join the outfit as an imported pattern (2D, layouts, usage, PDF / SVG / DXF, edits) and drape in
  3D: every piece gets a place on the body guessed from its name (front, back, side, sleeve, collar, skirt or trouser
  front and back), pieces cut on the fold open out, hems are found at the bottom of the pieces, and the edges that
  meet are sewn automatically; place, orientation and a drop are set per piece in the piece editor.
- **Export**: the tiled print-at-home PDF (A4 or Letter, overview page, test squares, alignment crosses), SVG and DXF
  (AAMA) patterns, the graded nest of five sizes, the cutting layout on a fabric width, technical flats, a 3D
  screenshot, mockup images, the project file.

The 2D view shows the body silhouettes with landmarks, the pattern (notches, grainlines, cut instructions, prints),
the technical flats of the outfit, the cutting layout with the fabric length, the graded nest, the fabric swatch with
its weaving draft, and the print repeat with its separations; drag to pan, wheel / pinch to zoom, `0` fits. The 3D
view drapes the whole outfit on the body with a time-sliced cloth simulation (the page stays responsive) in WebGL,
or with the software renderer where WebGL is missing (it keeps draping while the pane or the tab is hidden); drag to turn, wheel / pinch to zoom, arrows and `+` / `-` on
the focused view; front / side / back buttons; drape quality *draft / normal / fine*. Texture changes (fabric
colours, prints) repaint the same drape; geometry changes drape again.

Projects are saved automatically in the browser (IndexedDB, localStorage as the fallback), the last one opens again
on the next visit and the others are listed in *Projects*; *Save a copy and continue* forks a version; projects travel
as `.textile.json` files with their artwork. Undo / redo cover every edit (Ctrl+Z, Ctrl+Shift+Z /
Ctrl+Y); a slider drag is one step. The interface speaks English, Russian, Ukrainian, German, French, Spanish and
Georgian.

## Development and checks

```bash
node textile-studio/server.js            # the sources (first free port from 8080: http://localhost:8080/textile-studio/)
node singlefile.js textile-studio        # the artifacts
node check.js e2e http://localhost:8080/textile-studio/ textile-studio/e2e.js --lang en
node check.js e2e http://localhost:8080/textile-studio/ textile-studio/e2e.js --lang en --mobile --size 390x844
node check.js e2e textile-studio/html@5_offline_singlefile/index.html textile-studio/e2e.js --lang en
```

The scenario edits the body, drafts the tuxedo, changes a jacket option, adds a vent and switches lapels, chooses a
fabric and edits its drawdown, places a print and turns on a repeat, waits for the 3D drape of the four garments,
exports the tiled PDF, SVG, DXF, layout, flats, the project file and the material usage, puts on the chokha outfit
(checks the room for the layers under it), lays a layer on a piece and dyes its material, checks undo / redo, then switches to the Mockup
mode, drops artwork, resizes it, changes the blank and exports the mockup image. Every download is recorded in
`window.__textileDownloads`.

## Files

| file | contents |
| --- | --- |
| `main.js` | the page: toolbar, steps, panels, 2D and 3D panes, history wiring, autosave, project menu |
| `state.js` | the project model, normalisation, undo / redo, storage, project files |
| `compute.js` | memoised derivations: rig, measurements, drafts, materials, fabrics, the preview spec and its signatures |
| `panels.js` | the step panels and the Mockup panel |
| `view2d.js` | the 2D views with pan and zoom, print dragging, drawdown editing |
| `export.js` | every download |
| `names.js` | translated names of pieces, materials, garments, details |
| `strings*.js` | UI strings in seven languages |
| `e2e.js` | the browser scenario |
