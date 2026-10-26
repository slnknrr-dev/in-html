# garment/

Pattern drafting from body measurements: blocks, thirteen garment templates and the tuxedo outfit, details as
layered components with an explicit stacking order, seams between piece edges with their checks, grading across
sizes, and the 2D outputs — pattern SVG, a tiled PDF for printing at home, an AAMA / ASTM-style DXF, the cutting
layout on a fabric width and technical flats generated from the pattern. Pure ES modules, no DOM; measurements come
from [`body/`](../body/) (`draftMeasurements`). Centimetres, y down as on paper.

```js
import { draftMeasurements } from '../body/measure.js';
import { draftGarment, OUTFITS } from '../garment/garments.js';
import { checkSeams } from '../garment/seams.js';
import { tiledPDF } from '../garment/pdf.js';

const m = draftMeasurements(body);
const d = draftGarment({ garment: 'jacket', opts: { fit: 'slim' }, details: [{ type: 'lapel', variant: 'peak', facing: 'satin' }, { type: 'lining' }] }, m);
checkSeams(d);                       // [{ id: 'armhole', a, b, ease: 3.2, diff: 0.0003, ok: true }, ...]
const pdf = tiledPDF(d, { paper: 'A4', title: 'Jacket' });   // Uint8Array
```

## Files

| file | contents |
| --- | --- |
| `geom.js` | 2D helpers: Bézier / Hermite / Catmull-Rom curves flattened to polylines, quadrature arc length, resampling, offsets, polygons, intersections, affine maps |
| `piece.js` | the piece model and its operations: `makePiece`, `splitPiece` (with wedge cuts), `joinPieces`, `unfoldPiece`, `mirrorPiece`, `transformPiece`, `addEdgeDart`, `edgeChain`, `cutOutline` (seam allowances, darts bridged), `validatePiece` |
| `blocks.js` | `torsoBlock`, `sleeveBlock` (cap height solved for the cap ease), `twoPieceSleeve`, `skirtBlock`, `trouserBlock` |
| `garments.js` | `GARMENTS` (option schemas + base drafts), `OUTFITS` (17 ready outfits with their fabrics) and `OUTFIT_INFO`, `normalizeSpec`, `draftGarment(spec, m)` (`spec.under`: layers worn under it; `spec.edits`: pattern edits; `spec.imported`: an imported pattern) |
| `costume.js` | `PLACES`, `guessPlace` (the place on the body of an imported piece from its name); national, historical and outerwear templates: chokha, arkhaluk, kartuli, kaftan (long coats: a fitted bodice and a flared skirt, open or closed fronts with an overlap), kosovorotka, rubakha, sarafan, bomber, parka, puffer (with the loft of its insulation), trucker, the belt, and the imported pattern |
| `layers.js` | `REGION`, `layerThickness`, `outfitLayers`, `layeredMeasurements`: garments over garments get 2π × the thickness of the layers under them on the girths they cover |
| `usage.js` | `materialUsage`, `outfitUsage`, `usageCSV`: per material the pieces, area, cutting-layout length on the fabric width and the length to buy; buttons, zips, hooks, cartridges, thread |
| `edits.js` | `normalizeEdits`, `applyEdits`, `layerOutline`, `reshapePiece`, `handlePoint`: pattern edits made in 2D - a piece's material, its outline reshaped by handles (a corner or a point of an edge moved, the edge bending with a smooth falloff; the copies cut from it follow), layers (rectangles, ellipses, drawn shapes) laid onto pieces as cut pieces and 3D overlays |
| `details.js` | `STACK`, `DETAILS`, `defaultDetails`, `detailChoices`, `applyDetails` — lapels, collars, hoods, plackets, cuffs, bands, waistbands, trims, vents, pleats, pockets, buttons, facings, lining, canvas, interfacing, pocketing |
| `seams.js` | seam paths (edge chains, partial stretches), `pathSampler`, `checkSeams`, `seamNotches` |
| `grade.js` | `gradeGarment` (the template drafted for each chart size's body), `gradeReport` |
| `svg.js` | `patternSVG`, `pieceSVG`, `layoutRows`, `gradedSVG`, `cutText` |
| `pdf.js` | `pdfDoc` (vector PDF 1.4 writer), `tiledPDF`, `latin` (Cyrillic / Georgian transliteration for the standard fonts) |
| `dxf.js` | `patternDXF` (ASCII R12, AAMA layers), `parseDXF`, `readPatternDXF` (AAMA blocks or the closed polylines of a drawing; cm / mm / inches) |
| `nest.js` | `cutInstances`, `nest`, `layoutsByMaterial`, `layoutSVG` |
| `flats.js` | `flatShapes`, `flatSVG` (front / back technical drawings of one garment or an outfit) |
| `test.js` | `node garment/test.js` |

## Pieces and operations

A piece is a closed outline of named edges (polylines, clockwise on paper) with seam allowances per edge, a kind
(`seam`, `hem`, `fold`, `dart`), marks (notches, buttons, button holes, pocket and fold lines, drill holes, labels), a
grainline, cutting instructions (`{ n, mirror, fold }`), its material and stack layer, and hints for the 3D arrangement.
Seams stay exact by construction: `splitPiece` gives both pieces the same cut polyline (or two polylines sharing their
ends, taking a suppression wedge), `joinPieces` moves one piece rigidly so congruent edges meet, `addEdgeDart` slides
the dart mouth until both legs are equal. Side panels, the shirt yoke with its front strip, the two-piece sleeve, the
facing and lining fronts, the lapel and the shirt tail are all made this way.

## Blocks

- **Torso**: back and front share one frame — x from the centre back round the side to the centre front (half the
  garment chest girth), y down from the nape line — so they can be joined at the side and re-split anywhere. Neck from
  the neck-base girth, shoulders from the body's shoulder length and slope, armhole depth from the scye depth, across
  back / front widths, waist shaping split between side seams, centre back seam and waist darts, hip spring, women's
  bust dart in the side seam (intake from the bust prominence, apex 2.5 cm from the bust point), front extension.
- **Sleeve**: bicep = upper arm + ease; the cap height and the position of its top are solved by bisection so that
  the front cap equals the front armhole plus its share of the cap ease and the back cap likewise (jackets 3.2 cm,
  shirts 0.6, knits 0). The two-piece sleeve cuts the one-piece and joins the outer strips along the underarm.
- **Skirt** (waist darts, side shaping, straight / pencil / A-line; a dress skirt adapts its darts to the bodice waist)
  and **trousers** (front and back by the crease, the back inseam and outseam walked to the front lengths).

## Garments and details

`tshirt`, `longsleeve`, `tank`, `sweatshirt`, `hoodie`, `tote` (merch blanks with print areas), `shirt` (yoke, curved
tail), `dress` (bodice + skirt), `skirt`, `trousers`, `waistcoat` (V opening, points), `jacket` (men 3-panel with
suppression wedges, women 2-panel with the bust dart), `cummerbund`; the **tuxedo** outfit = shirt, trousers with a satin
stripe, cummerbund and a jacket with a satin shawl lapel, jetted pockets and one button. Each template has an option
schema (fit, length, sleeve, neckline, closure …) and default details.

Details are components applied in a fixed order (structural ones first) and drawn / simulated by the explicit stack,
inside → outside: `pocketing, lining, canvas, interfacing, facing, shell, band, placket, lapel, collar, pocket, flap,
trim, button`. Components add pieces (collar stands, rib bands, waistbands, facings, lining copies of the shell with
their seams), reshape pieces (the lapel mirrors its look across the roll line into the cut front), add marks and
seams, and add **overlays** for 3D — layers lying on a parent piece: the folded lapel, pocket jets, welts, flaps,
patches, the kangaroo pocket, the satin stripe, belt loops — plus buttons and closures (pins between the fronts).

## Costumes, outerwear, outfits

The long coats draft a waist-length bodice (darts, centre back seam) and a skirt matched to its waist with the flare at
the side seams: the **chokha** opens in a deep V to the waist, hooks at the waist, has wide sleeves with turned-back
cuffs and the **gazyri** detail (two rows of cartridge tubes on the chest, the cartridges counted in the usage); the
**arkhaluk** under it has a stand collar, narrow sleeves and a row of small buttons; the chokha's back skirt takes
deep pleats at the waist (four by default, the seam carries their intake) and its turned-back sleeves a 10 cm slit; the **kartuli** dress is closed, floor length,
with hanging sleeves open over 30 cm and the embroidered **gulispiri** bib filling its V; the **kaftan** overlaps 5 cm. The **kosovorotka** has dropped shoulders, its
neck opening to the side, square underarm gussets and poliki (shoulder pieces) of the traditional cut, the **rubakha**
is long, the **sarafan** is a strap bodice over a gored (A-line) or a gathered skirt (straight panels 1.2-2.5 times
the hip gathered into the bodice); embroidered
bands are overlays on the hems. **Bomber**, **parka**, **puffer** and **trucker** are open fronts (a zip pinned
edge to edge, or a button stand) with bands, hoods, pockets; the **quilting** detail stitches channels or diamonds
and cuts the wadding like the shell, and the loft makes room in the pattern. **OUTFITS**: tuxedo and women's tuxedo,
three-piece suit and women's skirt suit, classic (men, women), chokha (black, white festive, mountain, women's), kartuli
(velvet, wedding), Slavic (kosovorotka with a belt, with a kaftan; rubakha with a sarafan, with a long skirt), winter.

## Outputs

- **SVG**: true size (1 unit = 1 cm), cutting and seam lines, darts, folds, notches (matching on both sides of every
  seam, ease spread evenly), grainlines, buttons and holes, labels; graded nests.
- **Tiled PDF**: A4 or Letter at 1:1 with 1 cm overlaps, an overview page with the tile grid, tile names (A1, A2 …),
  neighbours at the edges, crosses for alignment, a 5 cm and a 2 in test square on A1. Text uses the standard
  Helvetica fonts, so Cyrillic and Georgian labels are transliterated.
- **DXF**: AAMA-style blocks per piece (layer 1 cut, 14 sew, 7 grain, 4 notches, 8 internal, 13 drill) with the
  Piece Name / Quantity / Size / Category texts, Units: METRIC.
- **Cutting layout**: mirrored pairs and opened fold pieces on the fabric width, grain kept (0° / 180°), per
  material; skyline drop plus sliding into hollows on bitsets (efficiency typically 55–65 %).
- **Flats**: front and back drawings generated from the pieces (side line as the fold, bust dart closed, lapel look,
  sleeves from the drafted lengths, collars, bands, pockets, buttons, stitching); outfits draw in stacking order.

## Limits

- Drafting systems are simplified versions of classic block methods; fit is plausible, not tailor-verified. Women's
  jackets are two-panel; there is no raglan, kimono sleeve, princess seam or pleated trousers yet.
- Grading drafts each chart size from its body (proportional), not from grade rules tables.
- The nesting is greedy (no rotations other than 180°, no fabric folds, no plaid matching).
- National costumes are drafted from the same blocks: the cut follows the tradition's silhouette, not a museum pattern;
  imported patterns are 2D only (the 3D view does not know where on the body their pieces go).
- PDF text is Latin-1 (transliterated); DXF is the AAMA style, not a certified ASTM D6673 writer.
