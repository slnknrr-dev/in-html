// batumi-map/e2e.js - in-page scenario of the map page (node check.js e2e batumi-map/html@5_offline_singlefile/
// index.html batumi-map/e2e.js): the map renders SVG paths, "Руставели" and "rustaveli" find the same street, an
// address with a house number resolves to coordinates and puts a marker on the map, a missing number offers the
// nearest ones, a click on the map gives coordinates, the zoom buttons and the keyboard move the view, nothing
// touches the network.
//
// How it runs: check.js imports this module in Node, serialises the default export with toString() and evaluates it
// in the page, so the function must be self-contained (browser globals only). Assertions use test hooks the page
// exposes on purpose (data-paths, data-z, data-kind, data-sid, #bm-coords) instead of translated text, and until()
// polls for asynchronous rendering rather than sleeping a fixed worst case.
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  const $ = (s) => document.querySelector(s);
  const until = async (fn, ms = 4000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(50); } return fn(); };
  const type = async (text) => {
    const q = $('#bm-q');
    q.value = text;
    q.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(350);
    return [...document.querySelectorAll('.bm-res')];
  };
  // A saved view from an earlier run would change what is visible; start from the default city view.
  localStorage.removeItem('bm-view');

  // The map.
  const stage = await until(() => $('#bm-stage[data-paths]'));
  const paths = +(stage?.dataset.paths || 0);
  step('map renders paths', paths > 500, paths);
  step('attribution visible', /OpenStreetMap/.test($('.bm-attr')?.textContent || '') && $('.bm-attr').getBoundingClientRect().height > 0, $('.bm-attr')?.textContent);
  step('scale bar', /\d/.test($('.bm-scale-t')?.textContent || ''), $('.bm-scale-t')?.textContent);

  // Search in Russian and in Latin finds the same street.
  const ru = await type('Руставели');
  const ruId = ru.find((li) => li.dataset.kind === 'street')?.dataset.sid;
  const lat = await type('rustaveli');
  const latId = lat.find((li) => li.dataset.kind === 'street')?.dataset.sid;
  step('"Руставели" finds a street', !!ruId, ru[0]?.textContent);
  step('"rustaveli" finds the same street', !!latId && latId === ruId, `${ruId} / ${latId}`);
  const ka = await type('რუსთაველის');
  step('Georgian finds it too', ka.find((li) => li.dataset.kind === 'street')?.dataset.sid === ruId, ka[0]?.textContent);

  // A street result highlights the street on the map.
  (await type('rustaveli'))[0].click();
  await sleep(500);
  step('street selected', ($('#bm-sel-name')?.textContent || '').length > 3, $('#bm-sel-name')?.textContent);
  // The highlight is recognised by its stroke colour (light or dark style), i.e. it checks the rendered SVG itself.
  const hl = [...document.querySelectorAll('.bm-layer path')].filter((p) => /#e11d48|#fb7185/i.test(p.getAttribute('stroke') || '')).length;
  step('street highlighted', hl > 0, hl);
  step('link to the street', /#street=\d+/.test(location.hash), location.hash);

  // Address with a house number -> coordinates.
  const addr = await type('Руставели 10');
  const house = addr.find((li) => li.dataset.kind === 'house');
  step('address found', !!house && house.dataset.sid === ruId, house?.textContent);
  house?.click();
  await sleep(500);
  const coords = $('#bm-coords')?.textContent || '';
  const m = coords.match(/^(41\.6\d+), (41\.[5-7]\d+)$/);
  step('address resolves to coordinates', !!m, coords);
  // The marker is recognised by the start of its pin path as emitted by geo/render.js.
  const marker = [...document.querySelectorAll('.bm-layer path')].some((p) => (p.getAttribute('d') || '').startsWith('M0 0C-2 -6'));
  step('marker on the map', marker, marker);
  const lat2 = await type('rustavelis 10');
  step('Latin genitive with a number', lat2.find((li) => li.dataset.kind === 'house')?.dataset.sid === ruId, lat2[0]?.textContent);

  // A missing number offers the nearest ones.
  const miss = await type('Руставели 12');
  step('missing number offers neighbours', miss.some((li) => /\b10\b/.test(li.textContent) && /\b14\b/.test(li.textContent)), miss[0]?.textContent);

  // House lookup on the selected street.
  (await type('Руставели'))[0].click();
  await sleep(400);
  const chip = $('.bm-hchip[data-label="10"]');
  chip?.click();
  await sleep(400);
  step('house number chip selects the address', ($('#bm-coords')?.textContent || '') === coords, $('#bm-coords')?.textContent);

  // Coordinates typed in the search box.
  const c = await type('41.6516, 41.6367');
  step('coordinates query', c[0]?.dataset.kind === 'coords', c[0]?.textContent);

  // Zoom buttons and keys.
  const z0 = +stage.dataset.z;
  $('.bm-ctrl button').click();
  await sleep(450);
  step('zoom in button', +stage.dataset.z > z0, `${z0} -> ${stage.dataset.z}`);
  stage.focus();
  stage.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));
  await sleep(450);
  step('minus key zooms out', +stage.dataset.z < z0 + 0.9, stage.dataset.z);

  // A click (pointer down + up without moving) gives the coordinates of the point.
  const r = stage.getBoundingClientRect();
  const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 7, pointerType: 'mouse', button: 0, bubbles: true };
  stage.dispatchEvent(new PointerEvent('pointerdown', at));
  stage.dispatchEvent(new PointerEvent('pointerup', at));
  await sleep(450);
  step('click shows coordinates', /^41\.\d{6}, 41\.\d{6}$/.test($('#bm-coords')?.textContent || ''), $('#bm-coords')?.textContent);
  step('geo: link', /^geo:41\.\d+,41\.\d+$/.test(document.querySelector('.bm-kv a[href^="geo:"]')?.getAttribute('href') || ''), document.querySelector('.bm-kv a[href^="geo:"]')?.getAttribute('href'));

  // Zero network: the page made no requests beyond itself.
  // Resource Timing lists every fetched URL; data: and blob: are local. An offline build must show none.
  const res = performance.getEntriesByType('resource').filter((e) => !/^(data|blob):/.test(e.name));
  step('no network requests', res.length === 0, res.map((e) => e.name).join(' '));

  await type('');
  return { steps };
}
