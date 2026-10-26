# carpet/

Rug and carpet designs on a knot grid: traditions as rule sets, symmetry (field symmetries and wallpaper groups),
border systems with guard stripes and corner resolution, field fills, a motif library, palettes of natural dyes,
seeded generation with share codes, yarn estimates, knotting and cross-stitch charts through `stitch/`, pictures
(flat, realistic pile with abrash, fringe, an antique wash, the rug in perspective in a room), compositions of pattern
layers (ornaments, fractals, abstractions) crossed into one design, a gallery of exclusive designs and hand edits of
knots. Pure ES modules, importable in Node; `render.js`'s `drawRug` draws on a
Canvas 2D context the caller gives it.

Used by `carpet-generator/`.

| file | contents |
| --- | --- |
| `generate.js` | `generateRug(opts)`, `TRADITIONS`, `FIELDS`, `FIELD_PALETTES`, `CORNERS`, `GUARDS`, `knotGrid(widthCm, lengthCm, kpsi)` |
| `patterns.js` | 37 pattern types of composition layers: ornaments (medallion, frame with mihrab arch, rings, star, rosette, lattice, stripes, checks, girih stars by polygons in contact, whirl — borjgali / eternity sign —, sunburst, çintamani, kilim bands, motif repeats), fractals (Sierpinski carpet and triangle, Vicsek, H-tree, Hilbert / Moore, dragon curves, Koch, Mandelbrot, Julia, Newton basins, L-systems, Pythagoras tree) and abstractions (Truchet, mazes with the way out, cellular automata, Life, Voronoi, quasicrystals, interference, spirals, terraced noise, Gray–Scott reaction–diffusion, moiré) |
| `compose.js` | `paintLayers` (transforms: grid of cells, rotation, scale, mirrors, quarter turns, kaleidoscope, offset, polar and wallpaper-tile warps; blends: over, under, mask in / out, erase, invert, outline, halo; dithered opacity; colours per cell), `normLayer`, `compactLayer`, `randomComposition` |
| `regional.js` | the Indian, Arab and Moroccan, Ottoman Turkish, Armenian and Georgian fields as seeded layer recipes |
| `designs.js` | `DESIGNS`: the gallery of exclusive designs (regional, fractal mash-ups, classics) |
| `edits.js` | hand edits of knots: brush, line, rectangle, flood fill, motif stamps, every stroke repeated by a rug symmetry; run-length text for share codes |
| `symmetry.js` | field symmetries (`none`, `mirrorX`, `mirrorY`, `mirrorXY`, `rot2`, `rot4`, `d4`: orbits and representatives) and the 12 wallpaper groups of rectangular and square lattices (`wallpaperFold`) |
| `motifs.js` | the motif library (field, border and corner motifs as role bitmaps), mirror / rotate, validation of user motifs |
| `dyes.js` | natural dye colours and palettes per tradition with colour roles |
| `share.js` | share codes: `persian.cold-river-41.170x240.160[.p-<palette>][.o-<options, layers, edits>]` |
| `estimate.js` | knots per colour, pile yarn length and weight, warp, weft, knotting hours, tufted yarn |
| `chart.js` | `knotScheme(rug)` (knotting chart in the rug's colours) and `crossStitchScheme(rug, { brand })` — stitch schemes for the PDF / OXS / PNG / SVG exports |
| `render.js` | `rugRGBA` (flat or pile, fringe, antique wash), `rugSVG`, `drawRug` (canvas, knot lobes at close zoom), `drawRoom` (the rug in perspective on a floor) |
| `test.js` | unit tests: `node carpet/test.js` (also `node check.js tests carpet`) |

## Traditions

| tradition | palettes | fields | borders |
| --- | --- | --- | --- |
| Persian | Persian court (madder field, indigo border), Persian night | central medallion (superellipse with concentric bands, a rosette centre, pendants), quarter medallions in the corners, a floral lattice; or an allover repeat | barber-pole / reciprocal / dotted guards, a vine or S-motif main border, block or mitred corners |
| Anatolian | village madder and indigo with weld, purple, saffron | allover repeats of hooked diamonds, ram's horns, stars, latch hooks in a wallpaper group with row colour changes; prayer niche (stepped gable, columns, tree); kilim bands | zigzag, crenellation or S-motif; corners cut (unresolved) or mitred |
| Caucasian | Caucasian, Anatolian | two or three stacked hooked medallions with star centres and scattered latch-hook fillers; allover repeats | reciprocal trefoil, running dog, crenellation |
| Turkmen | deep madder | rows of quartered octagon guls on a lattice, minor guls between, elem panels at both ends | narrow zigzag / S borders, dotted guards |
| Nordic rya | rya blues, undyed wool, modern earth | soft colour fields from value noise with shaggy boundaries; long pile | none |
| Modern | modern earth, undyed, rya | golden-ratio block splits, a circle, lines; asymmetric | none or a thin edge |
| Indian | Mughal lac, Mughal ivory | millefleur rows in shifting colours, chahar-bagh garden panels with water channels and cypresses, a niche with a lamp | tulip vine, vine, cloud band |
| Arab and Moroccan | Mamluk, Beni Ourain, boucherouite | Mamluk octagon of stars and umbrella leaves amid small octagons, girih star tilings outlined like interlace, Beni Ourain lozenges, boucherouite patchwork | pseudo-Kufic, braid, meander; none for Berber and rag rugs |
| Ottoman Turkish | Ottoman court, Uşak, Lotto | Uşak stars with small diamonds, endless Uşak medallions, the Lotto arabesque, Holbein octagons, çintamani | pseudo-Kufic, cloud band, tulip vine, çintamani band |
| Armenian | vordan karmir, Chelaberd | vishapagorg lozenges with dragons and palmettes, Chelaberd sunburst "eagles", eternity wheels | eternity band, diamond chain, running dog, trefoil |
| Georgian | Tushetian, Georgian sun | borjgali suns, Tushetian banded pardagi, Bolnisi crosses on a lattice, Khevsur crosses | crosses, stepped triangles, diamond chain, braid |
| Mash-up | modern and synthetic palettes | a seeded composition: a ground structure, a centrepiece (often a fractal through a kaleidoscope inside a mask), cells of small things, outlines | any |

A rule set lists the allowed palettes, fields, field symmetries, wallpaper groups, border and field motifs, corner
resolutions, guard types, the number of guard pairs, the main border width and a typical knot density; every
choice not fixed by the options comes from the seeded PRNG (`prng/`, `seededRandom(tradition + '/' + seed)`).

## Symmetry

Field symmetries are applied by drawing only the representative of each cell's orbit (the first cell of the orbit in
reading order), so a field is exactly symmetric whatever the drawing does. `rot4` and `d4` need a square field and
fall back to `mirrorXY` otherwise. Wallpaper groups fold a cell into the fundamental region of a tile: `p1`, `p2`,
`pm`, `pg`, `cm`, `pmm`, `pmg`, `pgg`, `cmm`, `p4`, `p4m`, `p4g` — the twelve that fit a rectangular or square
lattice. The five hexagonal groups (`p3`, `p3m1`, `p31m`, `p6`, `p6m`) need a 60° lattice, which a grid of knots
does not have.

## Borders

From the edge inwards: an outline, guard stripes (solid, barber-pole, dots, reciprocal trefoil), the main border (a
repeat unit scaled to the band and centred on each side), mirrored guards, an outline. Corner resolution: `mitre`
(each cell belongs to its nearest edge, the diagonal mitre), `block` (corner squares with a rosette), `continuous`
(the repeat runs around the perimeter), `cut` (the top and bottom bands run through, the sides are cut — the
"unresolved" corners of village rugs).

## Estimates

Pile yarn per symmetric knot: two tufts of the pile height plus the wrap around two warps (≈ 2.2 knot widths), 12 %
waste, 1600 m/kg two-ply rug wool; warp: two per knot across, the rug length plus both fringes and 40 cm loom waste;
weft: two shoots per row with 10 % take-up; 600 knots an hour; tufting: about 230 g per m² and mm of pile.

## Limits

- Motifs are drawn for this library in the manner of the traditions; they are not copies of documented rugs. A few
  synthetic colours serve the modern and mash-up palettes; the dye column says so.
- Composition layers are evaluated per knot (fractals and curves from a cached raster), so a large rug with many
  layers takes a second or two to rebuild.
- Designs are bounded to 1.5 million knots (a 3 × 4.5 m rug at about 70 KPSI) to stay interactive.
- Wefts per knot row and the vertical knot density are taken equal to the horizontal one.
