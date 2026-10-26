# Carpet Generator (`carpet-generator`)

Rug designs on a knot grid for desktop and phones: pick a weaving tradition, roll a seed, set the size and knot
density, choose natural dyes and the design rules, and get the rug as a pile picture, a flat design and a knotting
chart, with yarn and time estimates and a cross-stitch version for [Embroidery Studio](../embroidery-studio/). The
design engine is the [`carpet/`](../carpet/) library, charts and file formats are [`stitch/`](../stitch/), seeds
[`prng/`](../prng/), colour [`color/`](../color/).

## Artifacts

Built from the NOTICE files (`node singlefile.js carpet-generator`):

| artifact | what it is |
| --- | --- |
| `html@5_offline_singlefile/index.html` | everything in one file with no network code: from disk, a phone, a USB stick |
| `html@5_serverless/` | a static site: the same generator, rugs open from links (`#code=…`), and on the same site as Embroidery Studio the cross-stitch scheme is handed over in the browser |

There is no backend build: the generator computes everything in the page, keeps your motifs in the browser, and a rug
travels as a share code, so a server would add nothing. Development: `node carpet-generator/server.js [port]`.

## The page

A side panel in five tabs, the stage with the knot editor, and outputs.

- **Design**: twelve traditions as cards — Persian, Anatolian, Caucasian, Turkmen, Nordic rya, modern, Indian, Arab and
  Moroccan, Ottoman Turkish, Armenian, Georgian and the mash-up; "Surprise me"; the seed and the share code (options,
  layers and hand edits rebuild exactly the same rug; copy a link); the gallery of 30 exclusive designs (regional,
  fractals and mash-ups, classics).
- **Pattern**: field (21 kinds, from medallions and gul rows to Uşak stars, borjgali, dragon lozenges, girih and
  compositions), field symmetry, the wallpaper group of repeats, border corners, guard stripes, border pairs, border
  and field motifs including your own; the motif editor.
- **Layers**: the composition stack painted over the field — 37 pattern types (ornaments, motifs, fractals,
  abstractions) with their parameters, colour roles, blend (over, under, masks, erase, invert, outline, halo),
  opacity, field or whole rug, a grid of cells with colours per cell, offset, rotation, scale, symmetry (mirrors,
  quarter turns, kaleidoscope sectors) and warps (polar rings, wallpaper tiles); reorder, switch off, duplicate,
  reseed, random layers; the layers a regional field is built from can be taken over and edited.
- **Colours**: palettes of natural dyes (and a few synthetic ones for modern designs) by colour role; every role can
  take another dye or a custom colour.
- **Size**: width, length, knot density, pile, fringe; the antique wash and the floor of the room view.
- **Views**: pile, flat design, knotting chart, the rug in a room; zoom and pan.
- **Knot editor** (above the stage): move, brush, line, rectangle, fill, colour picker, motif stamp; brush size,
  a symmetry of the whole rug for every stroke, the palette roles as colours, undo / redo, clearing; edits travel in
  the share code.
- **Estimates and exports** as before, plus a PNG of the rug in the room.

## What was taken from the design example

The example (a cross-stitch scheme site) concerns the studio; here it set the level of the chart output: a key with
symbols and counts, page splitting into 10-cell blocks with page labels, and OXS / PDF downloads.

## Checks

```
node check.js tests carpet
node check.js modules carpet-generator
node check.js e2e http://127.0.0.1:8731/carpet-generator/ carpet-generator/e2e.js [--mobile --size 390x844] [--lang ka]
node check.js e2e carpet-generator/html@5_offline_singlefile/index.html carpet-generator/e2e.js
```

## Limits

- Hexagonal wallpaper groups (p3, p3m1, p31m, p6, p6m) need a 60° lattice and are not offered on the square knot grid.
- Yarn and time figures are rules of thumb for a symmetric knot and two-ply wool; real yarns and weavers differ.
- The pile view is an illustration, not a photographic render.
