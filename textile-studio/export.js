// textile-studio/export.js - the files the studio makes: the tiled print-at-home PDF of the pattern, SVG and DXF
// (AAMA) patterns, the graded nest, the cutting layout, technical flats, 3D screenshots and merch mockups (front,
// back, both side by side), the project file. Every download is also listed in window.__textileDownloads (name, type,
// bytes) so the end-to-end checks can see it.
//
// Contract: runExport(kind, app) never throws. Every failure ends in a toast with the message (and console.error for
// the stack): an export is a user action, a silent failure would look like a dead button. All generators are pure
// (garment/*, fabric/*), the only browser work here is canvas compositing and the download itself.

import { download, toast } from '../ui/app.js';
import { safeFileName } from '../ui/files.js';
import { t } from '../ui/i18n.js';
import { tiledPDF } from '../garment/pdf.js';
import { patternSVG, gradedSVG, cutText } from '../garment/svg.js';
import { patternDXF } from '../garment/dxf.js';
import { nest, cutInstances, layoutSVG } from '../garment/nest.js';
import { flatSVG } from '../garment/flats.js';
import { gradeGarment } from '../garment/grade.js';
import { averageColor } from '../fabric/fabric.js';
import { projectFile } from './state.js';
import { draftOf, fabricOf, sizeOf, usageOf } from './compute.js';
import { usageCSV } from '../garment/usage.js';
import { pieceName, materialName, garmentName } from './names.js';

// A global log rather than intercepting the download: headless test browsers do not expose saved files to the page,
// so e2e.js reads names and byte sizes here. Shared through globalThis so a module re-evaluation keeps the same log.
const log = (globalThis.__textileDownloads = globalThis.__textileDownloads || []);
// Byte size per data kind: strings are measured as UTF-8 (what the file will hold), not .length (UTF-16 units);
// Blob -> size, ArrayBuffer / typed array -> byteLength, plain arrays -> length.
function save(data, name, type) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data).length : data.size ?? data.byteLength ?? data.length;
  log.push({ name, type, bytes });
  download(data, name, type);
  toast(t('ex.saved', { name }), 'ok');
}

// '<project> - <garment> - <extra>', filtered so empty parts leave no ' -  - '. safeFileName strips characters
// that Windows / macOS reject in file names; 'textile' is the fallback for a name made only of such characters.
const baseName = (p, extra = '') => safeFileName([p.name || t('tb.untitled'), garmentName(p.outfit[p.active].garment), extra].filter(Boolean).join(' - '), 'textile');
// Piece label used by the PDF and SVG: translated name plus the cut instruction ('cut 2, on fold') and material.
const label = (p) => (pc) => ({ title: pieceName(pc.name || pc.id), lines: [cutText(pc, (k, v) => t(k, v)), materialName(pc.material)] });

// data: URL -> Blob without fetch(): fetch of a data URL is blocked by some CSPs and by the offline build's audit
// (no network APIs), and it is async for no benefit. atob gives a binary string; copying char codes into a Uint8Array
// gives the bytes. The MIME type is taken from the URL head so PNG / JPEG snapshots keep their type.
async function dataURLToBlob(url) {
  const [head, b64] = url.split(',');
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: /data:([^;]+)/.exec(head)[1] });
}

// Polls instead of awaiting an event: the viewer exposes state (prep, running), not a promise. 600 x 50 ms = 30 s cap,
// after which the snapshot is taken anyway; a hung simulation must not hang the export forever.
// Waits for the drape of the 3D view to finish (screenshots of a half-draped garment are useless).
async function settled(viewer) {
  for (let i = 0; i < 600 && (!viewer.prep || viewer.running); i++) await new Promise((r) => setTimeout(r, 50));
}

// One snapshot per camera yaw (0 front, PI back), composited side by side on a canvas. Each snapshot is decoded
// before drawImage (draw before decode draws nothing). toBlob, not toDataURL: no base64 inflation (+33 %) and no
// synchronous encode of a large image on the main thread.
async function mockupImage(viewer, views, w, h) {
  await settled(viewer);
  const urls = [];
  for (const yaw of views) urls.push(await viewer.snapshot({ width: w, height: h, view: { yaw, pitch: 0.04, zoom: 1 } }));
  if (urls.length === 1) return dataURLToBlob(urls[0]);
  const c = document.createElement('canvas');
  c.width = w * urls.length; c.height = h;
  const x = c.getContext('2d');
  for (let i = 0; i < urls.length; i++) {
    const img = new Image();
    img.src = urls[i];
    await img.decode();
    x.drawImage(img, i * w, 0);
  }
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

// Dispatch by kind. Order: the kinds that need no draft (project, images) first, so a broken draft cannot block
// saving the project file, the user's way out of a bad state.
export async function runExport(kind, app) {
  const p = app.project();
  const g = p.outfit[p.active];
  try {
    if (kind === 'project') return save(projectFile(p), safeFileName(p.name || t('tb.untitled'), 'textile') + '.textile.json', 'application/json');
    // 'shot' keeps the user's current yaw; the mockup kinds use fixed front / back cameras so mockups are comparable.
    if (kind === 'shot' || kind.startsWith('mockup')) {
      const v = app.viewer();
      const views = kind === 'mockup-front' ? [0] : kind === 'mockup-back' ? [Math.PI] : kind === 'mockup' ? [0, Math.PI] : [v.view.yaw];
      const blob = kind === 'shot' ? await (async () => { await settled(v); return dataURLToBlob(await v.snapshot({ width: 1600, height: 1600 })); })() : await mockupImage(v, views, 1200, 1500);
      return save(blob, baseName(p, t(kind === 'shot' ? 'ex.shot' : 'ex.' + kind)) + '.png', 'image/png');
    }
    const d = draftOf(p);
    const title = `${p.name || t('tb.untitled')} · ${garmentName(g.garment)} · ${sizeOf(p).label}`;
    if (kind === 'pdf') {
      const bytes = tiledPDF(d, {
        paper: p.view.paper || 'A4', allowance: p.view.allowance, title, label: label(p),
        instructions: [t('pdf.i1'), t('pdf.i2'), t('pdf.i3'), t('pdf.i4')],
      });
      return save(bytes, baseName(p, p.view.paper || 'A4') + '.pdf', 'application/pdf');
    }
    if (kind === 'svg') return save(patternSVG(d, { allowance: p.view.allowance, title, label: label(p), width: 150 }), baseName(p) + '.svg', 'image/svg+xml');
    if (kind === 'dxf') return save(patternDXF(d, { style: garmentName(g.garment), size: sizeOf(p).label }), baseName(p) + '.dxf', 'application/dxf');
    // Graded nest: five neighbouring sizes around the middle of the women's / men's EU ranges. Children (age < 15) get
    // null, which lets gradeGarment pick an age-appropriate range itself.
    // KNOWN DEFECT: the size list is EU-only while p.view.sizeSystem may be UK / US; gradeGarment receives the system but
    // the numbers 34..42 / 46..54 are EU labels. Fix: derive the list from body/sizes.js for the chosen system.
    if (kind === 'graded') {
      const sizes = p.body.age < 15 ? null : p.body.sex === 'male' ? [46, 48, 50, 52, 54] : [34, 36, 38, 40, 42];
      const graded = gradeGarment({ garment: g.garment, opts: g.opts, details: g.details }, p.body.sex, sizes, { system: p.view.sizeSystem, age: p.body.age, height: p.body.height });
      return save(gradedSVG(graded, { width: 150 }), baseName(p, t('ex.graded')) + '.svg', 'image/svg+xml');
    }
    if (kind === 'usage') {
      const u = usageOf(p);
      const rows = u.rows.map((r) => ({ ...r, garment: `${r.index + 1}. ${garmentName(r.garmentId)}` }));
      const csv = usageCSV({ ...u, rows }, { material: materialName, header: [t('use.garment'), t('use.material'), t('use.pieces'), t('use.area'), t('use.layout'), t('use.width'), t('use.efficiency'), t('use.buy')], button: t('use.buttons'), zip: t('use.zip'), hooks: t('use.hooks'), cartridges: t('use.cartridges'), thread: t('use.thread') });
      return save(csv, baseName(p, t('use.title')) + '.csv', 'text/csv');
    }
    // The layout nests only the shell pieces: other materials are cut from other fabrics on other tables.
    if (kind === 'layout') {
      const r = nest(cutInstances(d, { material: 'shell' }), { width: p.view.fabricWidth || 150 });
      return save(layoutSVG(r, { fabric: averageColor(fabricOf(p, p.active, 'shell')) + '55', label: (pl) => pieceName(pl.label) }), baseName(p, t('ex.layout')) + '.svg', 'image/svg+xml');
    }
    // Flats of the whole outfit, front and back, combined into one SVG by nesting the two documents as inner <svg>
    // elements with their own viewBox (each keeps its coordinate system; no path rewriting). The outer viewBox puts
    // them side by side; the white rect makes the file readable in dark-mode viewers that show transparency as black.
    // Fills come from the OUTERMOST garment (last in the outfit), the one that is seen.
    if (kind === 'flats') {
      const drafts = p.outfit.map((_, i) => draftOf(p, i));
      const fills = {};
      for (const mat of ['shell', 'lining', 'satin', 'rib', 'contrast']) fills[mat] = averageColor(fabricOf(p, p.outfit.length - 1, mat));
      const front = flatSVG(drafts, { view: 'front', width: 600, fills }), back = flatSVG(drafts, { view: 'back', width: 600, fills });
      const inner = (s) => s.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
      const vb = (s) => /viewBox="([^"]+)"/.exec(s)[1].split(/\s+/).map(Number);
      const [ax, ay, aw, ah] = vb(front), [bx, by, bw, bh] = vb(back);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${Math.round((600 * Math.max(ah / aw, bh / bw)))}" viewBox="0 0 ${aw + bw} ${Math.max(ah, bh)}"><rect width="100%" height="100%" fill="#fff"/>`
        + `<svg x="0" y="0" width="${aw}" height="${ah}" viewBox="${ax} ${ay} ${aw} ${ah}">${inner(front)}</svg><svg x="${aw}" y="0" width="${bw}" height="${bh}" viewBox="${bx} ${by} ${bw} ${bh}">${inner(back)}</svg></svg>`;
      return save(svg, baseName(p, t('ex.flats')) + '.svg', 'image/svg+xml');
    }
  } catch (e) {
    console.error(e);
    toast(t('err.generic', { msg: e.message }), 'error');
  }
  return null;
}
