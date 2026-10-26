// garment/test.js - tests of pattern drafting: `node garment/test.js` (importing the module runs nothing). Piece
// operations (split / join / unfold / darts keep areas and seam edges), every garment drafted for every body preset
// (closed, simple outlines; every seam has its intended length difference; dart legs equal), the sleeve cap ease,
// grading (monotone growth between sizes), nesting (no two placed pieces overlap, all inside the fabric width), the
// tiled PDF (page grid, test squares, xref), the AAMA-style DXF (one block per piece), flats and SVG; the outfits,
// layers worn over layers, material usage, pattern edits and reading DXF back.

//
// Strategy: invariants over the whole product space (every garment x every body preset) rather than fixed
// coordinates: closed simple outlines, seams with their intended ease, equal dart legs, monotone grading, no overlap
// in nesting. A drafting formula change that breaks any size or garment is caught without updating snapshots.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addEdgeDart, cutOutline, edgeLength, joinPieces, makePiece, outline, pieceArea, splitPiece, unfoldPiece, validatePiece } from './piece.js';
import { area, inside, segIntersect } from './geom.js';
import { GARMENTS, OUTFITS, OUTFIT_INFO, draftGarment } from './garments.js';
import { layerThickness, layeredMeasurements, outfitLayers } from './layers.js';
import { materialUsage, outfitUsage, usageCSV } from './usage.js';
import { normalizeEdits } from './edits.js';
import { guessPlace } from './costume.js';
import { DETAILS, STACK, detailChoices } from './details.js';
import { checkSeams, seamNotches } from './seams.js';
import { gradeGarment, gradeReport } from './grade.js';
import { nest, cutInstances } from './nest.js';
import { latin, tiledPDF } from './pdf.js';
import { parseDXF, patternDXF, readPatternDXF } from './dxf.js';
import { flatShapes, flatSVG } from './flats.js';
import { patternSVG } from './svg.js';
import { BODY_PRESETS, bodyFromPreset, defaultBody } from '../body/body.js';
import { draftMeasurements } from '../body/measure.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// Do two simple polygons overlap (an edge crossing or one inside the other)?
function overlaps(a, b) {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (segIntersect(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length], 1e-9)) return true;
  return inside(b, a[0]) || inside(a, b[0]);
}

export async function run() {
  let pass = 0, fail = 0;
  const t0 = Date.now();
  const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${typeof info === 'string' ? info : JSON.stringify(info)}`); } };
  const near = (name, got, want, tol) => ok(name, Math.abs(got - want) <= tol, `got ${got} want ${want} ±${tol}`);

  // --- piece operations
  {
    const sq = makePiece({ id: 'sq', edges: [{ id: 'top', pts: [[0, 0], [10, 0]] }, { id: 'right', pts: [[10, 0], [10, 20]] }, { id: 'bottom', pts: [[10, 20], [0, 20]], kind: 'hem' }, { id: 'left', pts: [[0, 20], [0, 0]], kind: 'fold' }] });
    ok('square valid', validatePiece(sq).length === 0);
    const [a, b] = splitPiece(sq, { from: { edge: 'top', at: 4 }, to: { edge: 'bottom', at: 6 }, via: [[5, 10]], ids: ['cutA', 'cutB'] });
    near('split keeps the area', pieceArea(a) + pieceArea(b), 200, 1e-6);
    near('split edges are the same cut', edgeLength(a, 'cutA'), edgeLength(b, 'cutB'), 1e-9);
    ok('split pieces valid', !validatePiece(a).length && !validatePiece(b).length);
    const j = joinPieces(a, 'cutA', b, 'cutB');
    near('join restores the area', pieceArea(j), 200, 1e-6);
    ok('join merges edges', j.edges.map((e) => e.id).join() === 'top,right,bottom,left', j.edges.map((e) => e.id));
    const u = unfoldPiece(sq, 'left');
    near('unfold doubles', pieceArea(u), 400, 1e-6);
    ok('unfold names the mirrored half', u.edges.some((e) => e.id === 'right:L'));
    const dd = addEdgeDart(sq, 'top', 5, 2, [4, 8], 'd');
    near('dart legs equal', edgeLength(dd, 'd.a'), edgeLength(dd, 'd.b'), 1e-6);
    near('dart takes its width', edgeLength(dd, 'top.1') + edgeLength(dd, 'top.2'), 8, 1e-6);
    const cut = cutOutline(sq);
    ok('cutting line contains the seam line', outline(sq).every((q) => inside(cut, [q[0] + (q[0] > 5 ? -0.01 : 0.01), q[1] + (q[1] > 10 ? -0.01 : 0.01)])));
    near('fold edge has no allowance; others 1 cm', Math.abs(area(cut)), 11 * 22, 0.5);
  }

  // --- every garment on every body
  let drafts = 0, seamsChecked = 0, worst = 0;
  for (const id of Object.keys(BODY_PRESETS)) {
    const m = draftMeasurements(bodyFromPreset(id));
    for (const g of Object.keys(GARMENTS)) {
      const d = draftGarment({ garment: g }, m);
      drafts++;
      const bad = d.pieces.filter((p) => validatePiece(p).length);
      ok(`${id} ${g}: closed simple pieces`, !bad.length, bad.map((p) => [p.id, validatePiece(p)]));
      const badOv = d.overlays.filter((o) => validatePiece(o.piece).length);
      ok(`${id} ${g}: overlays valid`, !badOv.length, badOv.map((o) => o.id));
      const res = checkSeams(d);
      for (const r of res) if (r.judged) { seamsChecked++; worst = Math.max(worst, Math.abs(r.diff || 0)); }
      const badS = res.filter((r) => !r.ok);
      ok(`${id} ${g}: seams match`, !badS.length, badS.map((r) => `${r.id}:${r.error || r.diff.toFixed(3)}`));
      ok(`${id} ${g}: no drafting notes`, !d.notes.length, d.notes);
      ok(`${id} ${g}: stack order on every piece`, d.pieces.every((p) => Number.isInteger(p.stack)));
    }
  }
  console.log(`  ${drafts} drafts, ${seamsChecked} seams checked, worst difference ${worst.toExponential(2)} cm`);

  // --- sleeve cap ease, collars, details
  {
    const m = draftMeasurements(defaultBody('male'));
    const j = draftGarment({ garment: 'jacket' }, m);
    const arm = checkSeams(j).find((r) => r.id === 'armhole');
    ok('jacket cap ease about 3 cm', arm.b - arm.a > 2.5 && arm.b - arm.a < 3.6, arm);
    ok('jacket has lapel overlay and collar', j.overlays.some((o) => o.id === 'lapelLook') && j.pieces.some((p) => p.id === 'collar'));
    ok('jacket two-piece sleeve', j.pieces.some((p) => p.id === 'topSleeve') && j.pieces.some((p) => p.id === 'underSleeve'));
    ok('jacket lining and canvas layers', j.pieces.some((p) => p.layer === 'lining') && j.pieces.some((p) => p.layer === 'canvas'));
    const lin = j.pieces.find((p) => p.layer === 'lining'), shell = j.pieces.find((p) => p.layer === 'shell');
    ok('lining stacks under the shell, collar over the lapel', lin.stack < shell.stack && STACK.indexOf('collar') > STACK.indexOf('lapel'));
    const shawl = draftGarment({ garment: 'jacket', details: [{ type: 'lapel', variant: 'shawl', facing: 'satin' }, { type: 'buttons', count: 1 }, { type: 'facing' }] }, m);
    ok('shawl lapel in satin', shawl.overlays.find((o) => o.id === 'lapelLook')?.material === 'satin' && shawl.pieces.find((p) => p.id === 'facing')?.material === 'satin');
    const peak = draftGarment({ garment: 'jacket', details: [{ type: 'lapel', variant: 'peak' }, { type: 'buttons', count: 2 }] }, m);
    ok('peak lapel valid', peak.pieces.every((p) => !validatePiece(p).length) && checkSeams(peak).every((r) => r.ok));
    const tux = OUTFITS.tuxedo.map((x) => draftGarment({ garment: x.garment, opts: x.opts, details: x.details }, m));
    ok('tuxedo outfit drafts', tux.length === 4 && tux.every((d) => d.pieces.length && checkSeams(d).every((r) => r.ok)));
    ok('tuxedo satin stripe', tux[1].overlays.some((o) => o.id === 'stripe' && o.material === 'satin'));
    ok('every detail type applies somewhere', Object.keys(DETAILS).every((k) => DETAILS[k].garments.length > 0) && detailChoices('jacket').includes('lining'));
    const notches = seamNotches(j);
    ok('notches on both sides of seams', notches.length > 20 && notches.every((n) => Number.isFinite(n.p[0])));
    const shirtM = draftGarment({ garment: 'shirt' }, draftMeasurements(defaultBody('female')));
    ok('women shirt bust dart and seams', shirtM.pieces.find((p) => p.id === 'front').edges.some((e) => e.id === 'bustDart.a') && checkSeams(shirtM).every((r) => r.ok));
  }

  // --- grading
  for (const sex of ['female', 'male']) {
    const graded = gradeGarment({ garment: 'jacket' }, sex, sex === 'male' ? [46, 48, 50, 52, 54] : [34, 36, 38, 40, 42]);
    ok(`${sex} graded set`, graded.length === 5 && graded.every((g) => checkSeams(g.draft).every((r) => r.ok)));
    const rep = gradeReport(graded);
    for (const id of ['back', 'front', 'topSleeve']) {
      const r = rep.find((x) => x.piece === id);
      ok(`${sex} ${id} grows with the size`, r.steps.a.every((s, i) => s > 0 && s < r.areas[i] * 0.12), r.steps.a.map((s) => s.toFixed(1)));
    }
    const total = graded.map((g) => g.draft.pieces.filter((p) => p.layer === 'shell').reduce((s, p) => s + Math.abs(area(outline(p))), 0));
    ok(`${sex} shell area grows 2-9 % a size`, total.slice(1).every((v, i) => v / total[i] > 1.02 && v / total[i] < 1.09), total.map((v) => v.toFixed(0)));
  }

  // --- nesting
  {
    const m = draftMeasurements(defaultBody('male'));
    for (const g of ['jacket', 'shirt', 'tshirt', 'trousers']) {
      const d = draftGarment({ garment: g }, m);
      const inst = cutInstances(d, { material: 'shell' });
      const r = nest(inst, { width: 150 });
      const placed = r.placed.filter((p) => p.poly);
      ok(`${g}: every piece placed`, r.failed === 0 && placed.length === inst.length, r.failed);
      ok(`${g}: inside the width`, placed.every((p) => p.poly.every((q) => q[0] >= -1e-6 && q[0] <= 150 + 1e-6 && q[1] >= -1e-6)));
      let clash = 0;
      for (let i = 0; i < placed.length; i++) for (let k = i + 1; k < placed.length; k++) if (overlaps(placed[i].poly, placed[k].poly)) clash++;
      ok(`${g}: no overlaps`, clash === 0, clash);
      ok(`${g}: efficiency reported`, r.efficiency > 0.4 && r.efficiency < 1, r.efficiency);
      ok(`${g}: mirrored pairs`, inst.filter((x) => x.mirrored).length === d.pieces.filter((p) => p.cut.mirror && p.material === 'shell').reduce((s, p) => s + Math.floor(p.cut.n / 2), 0));
    }
  }

  // --- exports
  {
    const m = draftMeasurements(defaultBody('female'));
    const d = draftGarment({ garment: 'tshirt' }, m);
    const pdf = tiledPDF(d, { paper: 'A4', title: 'Футболка' });
    const s = Buffer.from(pdf).toString('latin1');
    ok('pdf header and trailer', s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
    const pages = (s.match(/\/Type \/Page\b/g) || []).length;
    const grid = /(\d+) tiles in (\d+) rows x (\d+) columns/.exec(s);
    ok('pdf pages = overview + tiles', grid && pages === 1 + Number(grid[1]) && Number(grid[1]) === Number(grid[2]) * Number(grid[3]), [pages, grid && grid[0]]);
    ok('pdf test squares', s.includes('(5 cm)') && s.includes('(2 in)'));
    const xref = Number(/startxref\n(\d+)/.exec(s)[1]);
    ok('pdf xref offset', s.slice(xref, xref + 4) === 'xref');
    // 5 cm = 141.732 pt: the test square is drawn with that size.
    ok('pdf test square is 5 cm', /141\.732 141\.732 re/.test(s));
    ok('transliteration', latin('Перед, წინა') === "Pered, ts'ina" && latin('Ärmel') === 'Ärmel');
    const letter = Buffer.from(tiledPDF(d, { paper: 'Letter' })).toString('latin1');
    ok('letter paper', /MediaBox \[0 0 612\.0\d* 792/.test(letter) || letter.includes('/MediaBox [0 0 612 792]'));
    const dxf = patternDXF(d, { date: '2026-01-01' });
    const pairs = parseDXF(dxf);
    ok('dxf blocks = pieces', pairs.filter((p) => p.code === 0 && p.value === 'BLOCK').length === d.pieces.length);
    ok('dxf ends with EOF', pairs[pairs.length - 1].value === 'EOF' && dxf.includes('Units: METRIC') && dxf.includes('Piece Name: front'));
    const svg = patternSVG(d, { title: 'x' });
    ok('svg pattern', svg.startsWith('<svg') && svg.includes('data-piece="front"') && svg.endsWith('</svg>'));
    for (const g of ['jacket', 'trousers', 'dress', 'hoodie', 'tote']) {
      const dg = draftGarment({ garment: g }, m);
      const f = flatShapes(dg, 'front'), b = flatShapes(dg, 'back');
      ok(`${g}: flats`, f.length > 2 && b.length > 1 && f.every((x) => (x.pts || [x.p]).every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]))));
    }
    ok('flat svg', flatSVG(d, { view: 'back' }).startsWith('<svg'));
  }

  // --- outfits, layers, material usage, pattern edits, DXF import
  {
    const m = draftMeasurements(defaultBody('male'));
    for (const [id, list] of Object.entries(OUTFITS)) {
      const ds = list.map((x) => draftGarment(x, m));
      ok(`outfit ${id}: drafted`, ds.every((d) => d.pieces.length > 0 && checkSeams(d).every((s) => s.ok)), id);
      ok(`outfit ${id}: info`, !!OUTFIT_INFO[id], id);
    }
    // a jacket over a shirt and a puffer: more room for thicker layers, nothing for the innermost
    const specs = [{ garment: 'shirt' }, { garment: 'jacket', details: [{ type: 'lining' }] }, { garment: 'puffer', opts: { loft: 2 } }];
    const under = outfitLayers(specs, () => (mat) => (mat === 'shell' ? 0.45 : 0.12));
    ok('layers: innermost has none', under[0].length === 0 && under[2].length === 2);
    const plain = draftGarment({ garment: 'jacket' }, m), over = draftGarment({ garment: 'jacket', under: under[1] }, m);
    ok('layers: jacket over a shirt is wider', over.info.torso.W > plain.info.torso.W && over.m.layers.torso > 0.2, [plain.info.torso.W, over.info.torso.W]);
    ok('layers: puffer thickness counts the loft', layerThickness(specs[2]) > 2, layerThickness(specs[2]));
    const lm = layeredMeasurements(m, [{ region: 'top', t: 1, sleeves: true }], 'bottom');
    ok('layers: an untucked top adds nothing to trousers', lm === m);
    // usage
    const u = materialUsage(plain, { width: 150 });
    ok('usage: shell first, lengths to buy', u.materials[0].material === 'shell' && u.materials.every((x) => x.buy >= x.layout && x.buy % 10 === 0), u.materials.map((x) => [x.material, x.layout, x.buy]));
    ok('usage: notions', Object.values(u.notions.buttons).reduce((a, b) => a + b, 0) >= 2 && u.thread > 50, u.notions);
    const csv = usageCSV(outfitUsage([plain], { width: 150 }));
    ok('usage: csv', csv.startsWith('\uFEFF') && csv.split('\r\n').length > 4 && csv.includes(';'));
    const chokha = outfitUsage(OUTFITS.chokha.map((x) => draftGarment(x, m)), { width: 150 });
    ok('usage: chokha cartridges are not buttons', chokha.notions.cartridges === 16 && !chokha.notions.buttons['1.1'], chokha.notions);
    // edits
    const ed = draftGarment({ garment: 'jacket', edits: { materials: { side: 'contrast' }, layers: [{ id: 'p', piece: 'underSleeve', shape: 'ellipse', x: 8, y: 35, w: 8, h: 12, material: 'accent1' }, { id: 'q', piece: 'nope', shape: 'rect' }] } }, m);
    ok('edits: material of a piece', ed.pieces.find((p) => p.id === 'side').material === 'contrast');
    ok('edits: layer piece and overlay', ed.pieces.some((p) => p.id === 'layer-p' && p.material === 'accent1' && validatePiece(p).length === 0) && ed.overlays.some((o) => o.id === 'layer-p' && o.on === 'underSleeve'));
    ok('edits: unknown host noted', ed.notes.some((n) => /nope/.test(n)));
    const ne = normalizeEdits({ materials: { a: 'Bad Name', b: 'satin' }, layers: [{ piece: 'x', shape: 'poly', pts: [[0, 0], [1, 0]] }] });
    ok('edits: normalized', !('a' in ne.materials) && ne.materials.b === 'satin' && ne.layers[0].shape === 'rect');
    // DXF round trip and a plain drawing in millimetres
    const r = readPatternDXF(patternDXF(plain));
    ok('dxf read: every piece', r.units === 'cm' && r.pieces.length === plain.pieces.length && r.pieces.every((p) => p.cut.length >= 3), r.pieces.length);
    const imp = draftGarment({ garment: 'imported', imported: { pieces: r.pieces } }, m);
    ok('dxf import: pieces valid', imp.pieces.length === plain.pieces.length && imp.pieces.every((p) => validatePiece(p).length === 0));
    near('dxf import: shell usage close', materialUsage(imp).materials[0].buy, u.materials[0].buy, 30);
    const lw = '0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\n0\n70\n1\n10\n0\n20\n0\n10\n400\n20\n0\n10\n400\n20\n600\n10\n0\n20\n600\n0\nENDSEC\n0\nEOF\n';
    const r2 = readPatternDXF(lw);
    ok('dxf read: plain drawing in mm', r2.units === 'mm' && r2.pieces.length === 1 && Math.abs(r2.pieces[0].cut[2][0] - 40) < 1e-9 && r2.pieces[0].cut[2][1] === -60, r2); // y up in DXF, down on paper
  }

  // reshaped outlines, places of imported pieces
  {
    const m = draftMeasurements(defaultBody('female'));
    const plain = draftGarment({ garment: 'dress', details: [{ type: 'lining' }] }, m);
    const d = draftGarment({ garment: 'dress', details: [{ type: 'lining' }], edits: { shape: { front: [{ edge: 'neck', at: 0.5, dx: 0, dy: 4 }, { edge: 'shoulder', at: 0, dx: 1.5, dy: -1 }] } } }, m);
    const f0 = plain.pieces.find((p) => p.id === 'front'), f1 = d.pieces.find((p) => p.id === 'front');
    ok('reshape: valid piece, smaller front', validatePiece(f1).length === 0 && pieceArea(f1) < pieceArea(f0));
    const l0 = plain.pieces.find((p) => p.id === 'frontLining'), l1 = d.pieces.find((p) => p.id === 'frontLining');
    ok('reshape: the lining follows', l1 && Math.abs(pieceArea(l1) - pieceArea(l0)) > 1);
    ok('reshape: the shoulder seam reports the change', checkSeams(d).some((s) => s.id === 'shoulder' && !s.ok));
    ok('reshape: normalized handles', normalizeEdits({ shape: { a: [{ edge: 'e', at: 2, dx: 0, dy: 0 }, { edge: 'e', at: 0.5, dx: 99 }] } }).shape.a.length === 1);
    ok('places guessed from names', guessPlace('Sleeve') === 'sleeve' && guessPlace('Перед') === 'torsoFront' && guessPlace('skirtBack') === 'skirtBack' && guessPlace('trouserFront') === 'legFront' && guessPlace('xyz') === 'none');
  }

  console.log(`garment: ${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
