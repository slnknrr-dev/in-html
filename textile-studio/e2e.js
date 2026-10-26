// textile-studio/e2e.js - browser scenario through the interface: edits the body (sex, height, a measurement), drafts
// the tuxedo outfit (shirt, trousers, cummerbund, jacket), adds a layered detail, chooses a fabric and edits its
// drawdown, places a print and turns on a repeat, waits for the 3D drape, exports the tiled PDF and the other pattern
// files and the material usage, puts on the chokha outfit (the room for the layers under it), lays a layer on a piece
// and dyes its material, checks undo / redo, then makes a merch mockup from dropped artwork and exports the mockup
// images. Run against the dev server or a built page, at desktop and phone widths:
//   node check.js e2e http://localhost:8080/textile-studio/ textile-studio/e2e.js --lang en
//   node check.js e2e http://localhost:8080/textile-studio/ textile-studio/e2e.js --lang en --mobile --size 390x844
// The scenario function is serialized into the page (Function.prototype.toString): it may use only browser globals.
//
// Method: drive the real UI (clicks, synthetic input / change / drop events) and assert on the PROJECT STATE through
// window.__textile, not on pixels: state assertions are exact and stable across renderers, screenshots are not.
// until() polls instead of fixed sleeps: the drape takes from seconds (WebGL) to minutes (software fallback), a
// fixed sleep would be either flaky or slow. Each step records ok / FAIL and a value for the report; the scenario
// continues after a FAIL so one run shows every broken step. English labels are matched in a few places, hence --lang en.

export default async function scenario() {
  const steps = [];
  const step = (name, ok, v) => steps.push([name, ok ? 'ok' : 'FAIL', v]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(80); } return null; };
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  const T = await until(() => window.__textile);
  step('app ready', !!T && !!$('.tx-step'), null);
  if (!T) return { steps };
  const S = () => T.hist.state;
  const phone = innerWidth < 760;
  const goStep = async (id) => { $(`.tx-step[data-step="${id}"]`).click(); return until(() => $(`.tx-panel[data-step="${id}"]`)); };
  const panelBtn = (text) => $$('.tx-panel button').find((b) => b.textContent.trim() === text);
  const setRange = (k, v) => { const r = $(`.tx-panel [data-k="${k}"] input[type=range]`); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); };
  const downloads = () => window.__textileDownloads || [];
  const waitDownload = (re, n0) => until(() => downloads().slice(n0).find((d) => re.test(d.name)), 90000);
  // Quick drapes for the scenario.
  const q = $('.tx-quality');
  q.value = 'draft'; q.dispatchEvent(new Event('change'));
  step('quality draft', S().view.quality === 'draft', S().view.quality);

  // --- body ---
  await goStep('body');
  $$('.tx-panel .ed-seg-btn').find((b) => b.dataset.v === 'male').click();
  await until(() => S().body.sex === 'male');
  setRange('height', 186);
  await sleep(200);
  const hip0 = S().body.overrides.hip;
  const waistIn = $('.tx-panel input[data-m="waist"]');
  waistIn.value = '86'; waistIn.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => S().body.overrides.waist === 86);
  step('body edited', S().body.sex === 'male' && S().body.height === 186 && S().body.overrides.waist === 86 && hip0 == null, { sex: S().body.sex, height: S().body.height, waist: S().body.overrides.waist });
  await until(() => $('.tx-panel .tx-meas-row.tx-over'));
  step('measurement override marked', !!$('.tx-panel .tx-meas-row.tx-over'), $('.tx-panel .tx-size')?.dataset.size);
  if (!phone) step('2D body silhouettes', !!(await until(() => $('.tx-pane-2d svg path'))), null);

  // --- template: tuxedo ---
  await goStep('template');
  panelBtn('Tuxedo outfit').click();
  await until(() => S().outfit.length === 4);
  step('tuxedo outfit', S().outfit.map((g) => g.garment).join(',') === 'shirt,trousers,cummerbund,jacket', S().outfit.map((g) => g.garment));
  const jd = T.app.draft();
  step('jacket drafted', S().outfit[S().active].garment === 'jacket' && jd.pieces.length >= 10 && jd.seams.length >= 8, { pieces: jd.pieces.length, seams: jd.seams.length, overlays: jd.overlays.length });
  $$('.tx-panel .ed-seg-btn').find((b) => b.dataset.v === 'double')?.click();
  await until(() => S().outfit[3].opts.closure === 'double');
  step('jacket option', S().outfit[3].opts.closure === 'double', S().outfit[3].opts);
  $$('.tx-panel .ed-seg-btn').find((b) => b.dataset.v === 'single')?.click();
  await sleep(100);

  // --- details: layered components ---
  await goStep('details');
  const inner0 = $$('.tx-panel .tx-det').map((x) => x.dataset.type);
  step('layered details listed', ['lining', 'facing', 'canvas', 'lapel', 'pocket'].every((k) => inner0.includes(k)), inner0);
  const n0 = S().outfit[3].details.length;
  $('.tx-panel [data-action="add-detail"]').click();
  const item = await until(() => $$('.ed-menu-item').find((b) => b.textContent.includes('Vent')));
  item?.click();
  await until(() => S().outfit[3].details.length === n0 + 1);
  step('vent added', S().outfit[3].details.some((c) => c.type === 'vent'), S().outfit[3].details.map((c) => c.type));
  const lapel = $('.tx-panel .tx-det[data-type="lapel"]');
  $$('.ed-seg-btn', lapel).find((b) => b.textContent.trim() === 'Peak')?.click();
  await until(() => S().outfit[3].details.find((c) => c.type === 'lapel')?.variant === 'peak');
  step('lapel variant', S().outfit[3].details.find((c) => c.type === 'lapel').variant === 'peak', null);
  $$('.ed-seg-btn', $('.tx-panel .tx-det[data-type="lapel"]')).find((b) => b.textContent.trim() === 'Shawl')?.click();
  await sleep(100);

  // --- fabric ---
  await goStep('fabric');
  const sel = $('.tx-panel select[aria-label="Fabric"]');
  sel.value = 'tweed'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => S().outfit[3].fabrics.shell?.preset === 'tweed');
  step('fabric chosen', S().outfit[3].fabrics.shell.preset === 'tweed', S().outfit[3].fabrics.shell);
  if (phone) { $('.tx-stage-tabs .ed-seg-btn[data-v="2d"]').click(); await sleep(150); }
  const cell = await until(() => $('.tx-pane-2d .tx-dd'));
  step('weaving draft shown', !!cell, $('.tx-pane-2d figcaption:last-of-type')?.textContent);
  cell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await until(() => S().outfit[3].fabrics.shell?.structure?.weave === 'custom');
  step('drawdown edited', S().outfit[3].fabrics.shell.structure?.weave === 'custom', S().outfit[3].fabrics.shell.structure);
  // Back to the preset weave (the custom one would be fine too; keeps the drape typical).
  const sel2 = $('.tx-panel select[aria-label="Fabric"]');
  sel2.value = 'barathea'; sel2.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => S().outfit[3].fabrics.shell?.preset === 'barathea' && !S().outfit[3].fabrics.shell.structure);

  // --- print ---
  await goStep('print');
  $('.tx-panel [data-action="add-print"]').click();
  await until(() => S().outfit[3].placements.length === 1);
  step('placement print', S().outfit[3].placements[0]?.art.kind === 'motif', S().outfit[3].placements[0]);
  $('.tx-panel [data-k="repeat-on"] input').click();
  await until(() => S().outfit[3].design);
  step('repeat print on', !!S().outfit[3].design && !!$('.tx-panel .tx-seamless'), $('.tx-panel .tx-seamless')?.dataset.ok);
  const pv = await until(() => $('.tx-pane-2d .tx-repeat'));
  step('repeat preview', !!pv, null);
  // The print on the pattern (2D pattern view).
  $$('.tx-2d-modes .ed-seg-btn').find((b) => b.dataset.v === 'pattern').click();
  const pl = await until(() => $('.tx-pane-2d .tx-pl'));
  step('print on the pattern', !!pl, pl?.dataset.piece);

  // --- 3D ---
  if (phone) { $('.tx-stage-tabs .ed-seg-btn[data-v="3d"]').click(); await sleep(150); }
  const done = await until(() => $('.tx-pane-3d')?.dataset.state === 'done', 150000);
  const st = T.viewer.stats();
  step('3D draped', !!done && T.viewer.prep.drafts.length === 4, { renderer: T.viewer.mode, particles: T.viewer.prep.sim.stats.particles, meanSpeed: st && +st.meanSpeed.toFixed(2), status: $('.tx-pane-3d .tx-status')?.textContent });
  const canvas = $('.tx-3d-canvas');
  step('3D canvas sized', canvas.width > 100 && canvas.height > 100, [canvas.width, canvas.height]);

  // --- export ---
  await goStep('export');
  let k = downloads().length;
  $('.tx-panel [data-export="pdf"]').click();
  const pdf = await waitDownload(/\.pdf$/, k);
  step('tiled PDF exported', !!pdf && pdf.bytes > 20000, pdf);
  for (const kind of ['svg', 'dxf', 'layout', 'flats']) {
    k = downloads().length;
    $(`.tx-panel [data-export="${kind}"]`).click();
    const d = await waitDownload(/\.(svg|dxf)$/, k);
    step('export ' + kind, !!d && d.bytes > 1000, d && d.name);
  }
  k = downloads().length;
  $('.tx-panel [data-export="project"]').click();
  const pj = await waitDownload(/\.json$/, k);
  step('project file', !!pj, pj);
  k = downloads().length;
  $('.tx-panel [data-export="usage"]').click();
  const us = await waitDownload(/\.csv$/, k);
  step('material usage CSV', !!us && us.bytes > 200 && $$('.tx-panel .tx-usage tbody tr').length >= 4, us);

  // --- a ready national outfit, its layers, a layer on a piece, a dye ---
  await goStep('template');
  panelBtn('Ready outfits').click();
  (await until(() => $$('.ed-menu-item').find((b) => b.textContent.startsWith('Chokha with arkhaluk')))).click();
  await until(() => S().outfit.length === 4 && S().outfit[2].garment === 'chokha');
  step('chokha outfit', S().outfit.map((g) => g.garment).join(',') === 'arkhaluk,trousers,chokha,belt', S().outfit.map((g) => g.garment));
  // the chokha (third in the outfit, over the arkhaluk and the trousers) is the garment edited next
  (await until(() => $$('.tx-panel .tx-outfit-row')[2]?.querySelector('button'))).click();
  await until(() => S().active === 2);
  const room = await until(() => $('.tx-panel .tx-layer-room'));
  step('room for the layers under it', !!room && Number(room.dataset.torso) > 0.3, room && room.dataset.torso);
  await goStep('details');
  T.app.selectPiece('front');
  await until(() => $('.tx-panel [data-piece="front"]'));
  panelBtn('Rectangle').click();
  await until(() => S().outfit[S().active].edits.layers.length === 1);
  step('layer on a piece', S().outfit[S().active].edits.layers[0]?.piece === 'front' && T.app.draft().pieces.some((p) => p.meta.editLayer), S().outfit[S().active].edits.layers[0]);
  $$('.tx-panel .ed-seg-btn').find((b) => b.textContent.trim() === 'Ombré').click();
  await until(() => S().outfit[S().active].fabrics.shell?.dye?.kind === 'ombre');
  step('dye on the material', S().outfit[S().active].fabrics.shell?.dye?.kind === 'ombre', S().outfit[S().active].fabrics.shell?.dye);
  T.app.selectPiece(null);
  await goStep('export');

  // --- undo / redo ---
  const before = S().view.paper;
  $$('.tx-panel .ed-seg-btn').find((b) => b.dataset.v === 'Letter').click();
  await until(() => S().view.paper === 'Letter');
  $('[data-action="undo"]').click();
  await until(() => S().view.paper === before);
  const undone = S().view.paper === before;
  $('[data-action="redo"]').click();
  await until(() => S().view.paper === 'Letter');
  step('undo / redo', undone && S().view.paper === 'Letter', S().view.paper);

  // --- mockup mode ---
  $('.tx-mode .ed-seg-btn[data-v="mockup"]').click();
  await until(() => $('.tx-panel[data-step="mockup"]'));
  step('mockup mode', S().mode === 'mockup' && S().outfit.length === 1 && S().outfit[0].garment === 'tshirt', S().outfit.map((g) => g.garment));
  // Artwork dropped on the drop zone.
  const c = document.createElement('canvas');
  c.width = 200; c.height = 200;
  const x = c.getContext('2d');
  x.fillStyle = '#ff3366'; x.beginPath(); x.arc(100, 100, 90, 0, 7); x.fill();
  x.fillStyle = '#fff'; x.font = 'bold 60px sans-serif'; x.textAlign = 'center'; x.fillText('E2E', 100, 122);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'art.png', { type: 'image/png' }));
  $('.tx-panel .ap-drop').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  await until(() => S().outfit[0].placements[0]?.art.kind === 'image', 8000);
  step('artwork placed', S().outfit[0].placements[0]?.art.kind === 'image' && Object.keys(S().images).length === 1, S().outfit[0].placements[0]);
  setRange('mkw', 26);
  await until(() => S().outfit[0].placements[0].w === 26);
  step('print resized', S().outfit[0].placements[0].w === 26, null);
  const blankBtn = $('.tx-panel .tx-gcard[data-garment="hoodie"]');
  blankBtn.click();
  await until(() => S().outfit[0].garment === 'hoodie');
  step('blank switched', S().outfit[0].garment === 'hoodie' && S().outfit[0].placements.length === 1, null);
  if (phone) { $('.tx-stage-tabs .ed-seg-btn[data-v="3d"]').click(); await sleep(150); }
  await sleep(700);
  await until(() => $('.tx-pane-3d')?.dataset.state === 'done', 90000);
  k = downloads().length;
  $$('.tx-panel [data-k="mockup-export"] button')[2].click();
  const mk = await waitDownload(/\.png$/, k);
  step('mockup exported', !!mk && mk.bytes > 30000, mk);
  return { steps, errors, missingKeys: [...(window.__edMissingKeys || [])], downloads: downloads().map((d) => `${d.name} ${d.bytes}`) };
}
