// battleship-game/e2e.js - browser scenario: places a fleet through the interface (drag from the dock, the R key, the
// Random menu), plays a whole game against a bot by tapping cells and through the cell menu, opens the replay with its
// information curve, the profile and every constructor tab, and — on pages served over http with the rooms backend —
// plays an online game between this page and a second page (an iframe that joins by the invite link, without the
// password), each placing and firing through its own interface. Run against the dev server or a built page:
//   node check.js e2e http://127.0.0.1:8080/battleship-game/ battleship-game/e2e.js --lang en [--mobile --size 390x844]
// The scenario function is serialized into the page (Function.prototype.toString): it may use only browser globals.
// Strategy: act only through the UI (synthetic pointer and key events), observe through stable hooks rather than
// pixels: data-* attributes (the grid publishes its marks as el.dataset.marks, one digit per cell), classes and the
// URL. Each step records ok/FAIL and the run continues, so one broken feature does not mask the others.

export default async function scenario() {
  const steps = [];
  const step = (name, ok, v) => steps.push([name, ok ? 'ok' : 'FAIL', v]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { let v; try { v = fn(); } catch { v = null; } if (v) return v; await sleep(80); } return null; };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  await until(() => $('.bs-tile'), 20000);

  // A tap on a cell of a sea: pointer events at the cell's centre (the grid exposes its marks and width).
  function cellPoint(grid, c) {
    const W = +grid.dataset.w, svg = grid.querySelector('svg');
    const H = grid.dataset.marks.length / W;
    const r = svg.getBoundingClientRect();
    const vbW = W * 10 + 8, vbH = H * 10 + 8;
    const k = Math.min(r.width / vbW, r.height / vbH);
    const ox = r.left + (r.width - vbW * k) / 2, oy = r.top + (r.height - vbH * k) / 2;
    return { x: ox + (7 + (c % W) * 10 + 5) * k, y: oy + (7 + Math.floor(c / W) * 10 + 5) * k };
  }
  function tap(grid, c, win = window) {
    const p = cellPoint(grid, c);
    const P = win.PointerEvent;
    grid.dispatchEvent(new P('pointerdown', { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 5, pointerType: 'mouse', button: 0, isPrimary: true }));
    grid.dispatchEvent(new P('pointerup', { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 5, pointerType: 'mouse', button: 0, isPrimary: true }));
  }
  const freeCells = (grid) => [...grid.dataset.marks].map((m, i) => (m === '0' ? i : -1)).filter((i) => i >= 0);

  // Settings: fast bots, then back home.
  $('.bs-tile[data-k="settings"]').click();
  const dlg = await until(() => $('.bs-setdlg'));
  step('settings dialog', !!dlg, null);
  $$('.ed-seg-btn', dlg).find((b) => b.dataset.v === 'fast')?.click();
  $('.ed-dialog .ed-dlg-head .ed-iconbtn')?.click();
  await sleep(300);

  // --- a game against a bot ---------------------------------------------------------------------------------------
  $('.bs-tile[data-k="new"]').click();
  await until(() => $('.bs-setup'));
  $('.bs-rscard[data-id="quick-8"]').click();
  await sleep(100);
  $$('.bs-setup .ed-seg-btn').find((b) => b.dataset.v === 'seeded')?.click();
  await sleep(50);
  const seedIn = $('.bs-seedrow .ed-input');
  if (seedIn) { seedIn.value = 'e2e-seed'; seedIn.dispatchEvent(new Event('input')); }
  $('.bs-setup [data-a="start"]').click();
  const place = await until(() => $('.bs-place .bs-grid'));
  step('placement screen', !!place, null);
  const sea = $('.bs-place .bs-grid');
  // drag the first ship of the dock onto the sea
  const dockBefore = $$('.bs-dockship').length;
  const ship = $('.bs-dockship');
  const from = ship.getBoundingClientRect();
  const to = cellPoint(sea, 2 * 8 + 3);
  ship.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: from.x + 5, clientY: from.y + 5, pointerId: 9, pointerType: 'mouse', button: 0, isPrimary: true }));
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: from.x + 30, clientY: from.y - 20, pointerId: 9, pointerType: 'mouse' }));
  await sleep(30);
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: to.x, clientY: to.y, pointerId: 9, pointerType: 'mouse' }));
  await sleep(30);
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: to.x, clientY: to.y, pointerId: 9, pointerType: 'mouse' }));
  await sleep(150);
  const placed = $$('.bs-place .bs-ship').length;
  step('drag a ship from the dock onto the sea', placed === 1, { placed, dockBefore, dockAfter: $$('.bs-dockship').length });
  // turn it with the R key
  const before = $('.bs-place .bs-ship')?.innerHTML;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
  await sleep(150);
  step('the R key turns the selected ship', $('.bs-place .bs-ship')?.innerHTML !== before, null);
  // random placement along the edges
  $('[data-b="random"]').click();
  const item = await until(() => $$('.ed-menu-item').find((b) => /edges/i.test(b.textContent)));
  item?.click();
  await sleep(200);
  step('random placement completes the fleet', !$('.bs-ready').disabled, $('.bs-place-status')?.textContent);
  $('.bs-ready').click();
  const battle = await until(() => $('.bs-battle .bs-enemy .bs-grid'), 15000);
  step('the battle begins', !!battle, null);
  let menuShots = 0;
  async function playToEnd(doc, win, label, maxMs = 240000) {
    const t0 = Date.now();
    let shots = 0;
    while (Date.now() - t0 < maxMs) {
      if ($('.bs-enddlg', doc)) break;
      // the enemy sea is active when it is this page's turn
      const g = $('.bs-sea.bs-enemy .bs-grid.bs-active', doc);
      if (g) {
        const free = freeCells(g);
        if (free.length) {
          const c = free[Math.floor(Math.random() * free.length)];
          if (label === 'local' && shots % 9 === 4) {
            // through the cell menu (right click)
            const p = cellPoint(g, c);
            g.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 2 }));
            const it = await until(() => $$('.ed-menu-item', doc).find((b) => /Fire here/.test(b.textContent)), 1500);
            if (it) { it.click(); menuShots++; } else tap(g, c, win);
          } else tap(g, c, win);
          shots++;
          await sleep(140);
          continue;
        }
      }
      await sleep(120);
    }
    const end = await until(() => $('.bs-enddlg', doc), 6000);
    step(`${label}: the game ends through the interface`, !!end, { shots, seconds: Math.round((Date.now() - t0) / 1000) });
    return end;
  }
  const end = await playToEnd(document, window, 'local');
  step('local: shots through the cell menu', menuShots > 0, menuShots);
  step('local: the end shows both fleets', $$('.bs-enemy .bs-ship').length > 0, $$('.bs-enemy .bs-ship').length);
  const luck = await until(() => { const x = $('.bs-enddlg .bs-luck'); return x && x.textContent !== '…' && x.textContent; }, 20000);
  step('local: luck and skill from the analysis', !!luck, luck);
  // the replay
  $$('.ed-dlg-foot .ed-btn').find((b) => /Replay/.test(b.textContent))?.click();
  const chart = await until(() => $('.bs-replays .bs-chart'), 40000);
  step('replay: the information curve', !!chart, null);
  step('replay: moves listed', $$('.bs-rp-moves li').length > 10, $$('.bs-rp-moves li').length);
  step('replay: the fleets are in the record', /fleets/.test($('.bs-replays .ed-hint')?.textContent || ''), $('.bs-replays .ed-hint')?.textContent);
  $$('.bs-rp-controls .ed-iconbtn')[0]?.click();
  await sleep(300);
  step('replay: back to the start', /^0 \//.test($('.bs-rp-pos')?.textContent || ''), $('.bs-rp-pos')?.textContent);
  $('.bs-replays .bs-screen-h .ed-iconbtn')?.click();
  await until(() => $('.bs-hero'));

  // profile and constructor
  $('.bs-tile[data-k="profile"]').click();
  await until(() => $('.bs-profile'));
  step('profile: the game is counted', +($('.bs-stats b')?.textContent || 0) >= 1, $('.bs-stats b')?.textContent);
  step('profile: closest personality', !!$('.bs-close'), $('.bs-close b')?.textContent);
  $('.bs-profile .bs-screen-h .ed-iconbtn')?.click();
  await until(() => $('.bs-hero'));
  $('.bs-tile[data-k="studio"]').click();
  await until(() => $('.bs-studio'));
  for (const tab of $$('.bs-st-tab')) { tab.click(); await sleep(120); }
  step('constructor: every tab renders', errors.length === 0, errors);
  $('.bs-studio .bs-screen-h .ed-iconbtn')?.click();
  await until(() => $('.bs-hero'));

  // --- online: two pages through the server ---------------------------------------------------------------------------
  const onlineTile = $('.bs-tile[data-k="online"]');
  if (onlineTile && /^https?:/.test(location.protocol)) try {
    onlineTile.click();
    const ok = await until(() => $('.bs-onstatus[data-ok]'), 10000);
    step('online: connected to this server', !!ok, $('.bs-onstatus')?.textContent);
    $('[data-a="create"]').click();
    const form = await until(() => $('.bs-createroom'));
    const rsSel = $('select[data-f="ruleset"]', form);
    if (rsSel) { rsSel.value = 'mini-6'; rsSel.dispatchEvent(new Event('change')); }
    await sleep(100);
    const pw = $('input[data-f="password"]', document);
    if (pw) { pw.value = 'secret-1'; pw.dispatchEvent(new Event('input')); }
    $$('.ed-dlg-foot .ed-btn.ed-primary').pop()?.click();
    const lobby = await until(() => $('.bs-lobby'));
    const link = await until(() => $('.bs-invite .ed-input')?.value);
    step('online: room created with an invite link', !!lobby && /#room=/.test(link || ''), (link || '').replace(/invite=[^&]+/, 'invite=…'));
    // the second page: an iframe of this application opening the invite link
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;left:0;top:0;width:420px;height:760px;border:0;z-index:99999;background:#fff';
    frame.src = link;
    document.body.append(frame);
    const fdoc = await until(() => frame.contentDocument && frame.contentDocument.querySelector('.ed-dialog input') && frame.contentDocument, 25000);
    if (fdoc) {
      const nameIn = fdoc.querySelector('.ed-dialog input');
      nameIn.value = 'Bob';
      nameIn.dispatchEvent(new frame.contentWindow.Event('input'));
      fdoc.querySelector('.ed-dialog .ed-btn.ed-primary').click();
    }
    const seated = await until(() => $$('.bs-lobby-players li').filter((li) => /Bob/.test(li.textContent)).length, 10000);
    step('online: the second page joined by invite without the password', !!seated, $$('.bs-lobby-players li').map((li) => li.textContent));
    // chat in the lobby reaches the other page
    const say = $('.bs-lobbychat .ed-input');
    if (say) { say.value = 'ahoy'; say.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
    const heard = await until(() => /ahoy/.test(fdoc.querySelector('.bs-lobbychat')?.textContent || ''), 6000);
    step('online: lobby chat reaches the other page', !!heard, null);
    $('.bs-lobby [data-a="start"]')?.click();
    // both pages place with Random and press Ready
    for (const [doc, win] of [[document, window], [fdoc, frame.contentWindow]]) {
      const r = await until(() => $('[data-b="random"]', doc), 15000);
      r?.click();
      const it = await until(() => $('.ed-menu-item', doc), 3000);
      it?.click();
      await sleep(200);
      $('.bs-ready', doc)?.click();
      void win;
    }
    const both = await until(() => $('.bs-battle', document) && $('.bs-battle', fdoc), 15000);
    step('online: both pages reach the battle', !!both, null);
    let leaked = 0;
    // both pages fire whenever it is their turn
    const t0 = Date.now();
    while (Date.now() - t0 < 180000 && !($('.bs-enddlg', document) && $('.bs-enddlg', fdoc))) {
      leaked = Math.max(leaked, $$('.bs-enemy .bs-grid:not(.bs-reveal) .bs-ship:not(.bs-sunkship)', document).length + $$('.bs-enemy .bs-grid:not(.bs-reveal) .bs-ship:not(.bs-sunkship)', fdoc).length);
      for (const [doc, win] of [[document, window], [fdoc, frame.contentWindow]]) {
        {
          const g = $('.bs-sea.bs-enemy .bs-grid.bs-active', doc);
          const free = g ? freeCells(g) : [];
          if (free.length) tap(g, free[Math.floor(Math.random() * free.length)], win);
        }
      }
      await sleep(250);
    }
    step('online: the networked game ends on both pages', !!($('.bs-enddlg', document) && $('.bs-enddlg', fdoc)), $('.bs-enddlg .ed-dlg-title', document)?.textContent + ' / ' + $('.bs-enddlg .ed-dlg-title', fdoc)?.textContent);
    step('online: no page ever saw the other fleet before the end', leaked === 0, leaked);
    frame.remove();
  } catch (e) { step('online: no exception', false, String(e && e.stack || e).slice(0, 300)); }
  return { steps };
}
