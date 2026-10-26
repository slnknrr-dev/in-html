// durak-game/e2e.js - browser scenario: plays whole games against bots through the interface only (taps on cards and
// targets, drag and drop, the card menu, the action buttons), then checks the end dialog, the replay of the record,
// the profile and the constructor. Run against the dev server or a built page:
//   node check.js e2e http://localhost:8080/durak-game/ durak-game/e2e.js --lang en [--mobile --size 390x844]
// The scenario function is serialized into the page (Function.prototype.toString): it may use only browser globals.
//
// Approach: black-box through the real DOM. Drags are synthesized PointerEvents (pointerId 7, mouse type) dispatched
// at element centres, which exercises table.js's own drag code path rather than calling its functions. Waiting uses
// until() polling (60ms) on observable DOM conditions with an 8s ceiling, because bot delays and animations make
// fixed sleeps flaky. Uncaught page errors are collected and reported as a step, so a silent exception fails the run.
// Bots are switched to "fast" first to keep whole games short.

export default async function scenario() {
  const steps = [];
  const step = (name, ok, v) => steps.push([name, ok ? 'ok' : 'FAIL', v]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(60); } return null; };
  const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const pointer = (el, type, p, extra = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...extra }));
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));

  // Settings: fast bots (through the settings dialog).
  $('.dk-tile[data-k="settings"]')?.click();
  const dlg = await until(() => $('.dk-setdlg'));
  step('settings dialog', !!dlg, null);
  const fast = dlg && $$('.ed-seg-btn', dlg).find((b) => b.dataset.v === 'fast');
  fast?.click();
  $('.ed-dialog .ed-dlg-head .ed-iconbtn')?.click();
  await sleep(300);

  async function newGame(presetIndex, players) {
    $('.dk-tile[data-k="new"]').click();
    await until(() => $('.dk-setup'));
    $$('.dk-setup .ed-seg-btn').find((b) => b.dataset.v === 'all')?.click();
    await sleep(50);
    const cards = $$('.dk-rscard');
    cards[presetIndex % cards.length].click();
    await sleep(80);
    for (let k = 0; k < 8; k++) {
      const n = +$('.dk-stepn').textContent;
      const [minus, plus] = $$('.dk-stepper .ed-iconbtn');
      if (n === players || (n < players && plus.disabled) || (n > players && minus.disabled)) break;
      (n < players ? plus : minus).click();
      await sleep(40);
    }
    $$('.dk-setup .ed-seg-btn').find((b) => b.dataset.v === 'seeded')?.click();
    await sleep(40);
    const seed = $('.dk-seedrow .ed-input');
    if (seed) { seed.value = 'e2e-' + presetIndex; seed.dispatchEvent(new Event('input')); }
    $('.dk-setup .dk-bigbtn').click();
    return until(() => $('.dk-table .dk-hand'));
  }

  // One decision of mine through the interface; returns what was done.
  let attempts = 0, useDrag = 0, usedMenu = 0, usedDrag = 0;
  async function decide() {
    const btn = (a) => $(`.dk-abtn[data-a="${a}"]`);
    const target = $('.dk-att.dk-target');
    const drop = $('.dk-play.dk-drop');
    const sel = $('.dk-hand .dk-card.dk-sel');
    if (sel && target) { target.click(); return 'beat'; }
    if (sel && drop) { drop.click(); return 'drop'; }
    if (btn('lead')) { btn('lead').click(); return 'lead'; }
    const ok = $$('.dk-hand .dk-card.dk-ok');
    if (btn('swap')) { btn('swap').click(); return 'swap'; }
    if (ok.length && attempts < 3) {
      attempts++;
      const c = ok[Math.floor(Math.random() * ok.length)];
      // Every few moves: drag the card onto its target, or use the card's menu.
      if (useDrag++ % 5 === 4) {
        const from = center(c);
        pointer(c, 'pointerdown', from);
        await sleep(20);
        pointer(window, 'pointermove', { x: from.x + 12, y: from.y - 12 });
        await sleep(30);
        const tgt = $('.dk-att.dk-target') || $('.dk-play.dk-drop');
        if (tgt) {
          const to = center(tgt);
          pointer(window, 'pointermove', to);
          await sleep(20);
          pointer(window, 'pointerup', to);
          usedDrag++;
          return 'drag';
        }
        pointer(window, 'pointerup', from);
        return 'drag-none';
      }
      if (useDrag % 7 === 3) {
        const p = center(c);
        c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 2 }));
        const menu = await until(() => $('.ed-menu'), 1500);
        const item = menu && $$('.ed-menu-item:not([disabled])', menu)[0];
        if (item && !/About|details/i.test(item.textContent)) { item.click(); usedMenu++; return 'menu'; }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        $('.ed-popover')?.remove();
      }
      c.click();
      return 'select';
    }
    attempts = 0;
    if (btn('transfer') && Math.random() < 0.3) { btn('transfer').click(); return 'transfer'; }
    if (btn('pass')) { btn('pass').click(); return 'pass'; }
    if (btn('take')) { btn('take').click(); return 'take'; }
    if (sel) { sel.click(); return 'unselect'; }
    return null;
  }

  async function playToEnd(label) {
    const t0 = Date.now();
    let moves = 0, idle = 0;
    while (Date.now() - t0 < 240000) {
      if ($('.dk-enddlg')) break;
      const r = await decide();
      if (r) { moves++; idle = 0; await sleep(r === 'select' ? 40 : 120); } else { idle++; await sleep(120); }
      if (idle > 400) break;
    }
    const end = await until(() => $('.dk-enddlg'), 4000);
    step(`${label}: game over through the interface`, !!end, { moves, seconds: Math.round((Date.now() - t0) / 1000) });
    return end;
  }

  // Game 1: classic, 3 players.
  let tb = await newGame(0, 3);
  step('game 1: table', !!tb, null);
  step('game 1: six cards in hand', $$('.dk-hand .dk-card').length === 6, $$('.dk-hand .dk-card').length);
  step('game 1: opponents shown', $$('.dk-opps .dk-seat').length === 2, $$('.dk-opps .dk-seat').length);
  step('game 1: trump badge', !!$('.dk-tsym'), $('.dk-tsym')?.textContent);
  let end = await playToEnd('game 1');
  const title1 = end && $('.ed-dlg-title')?.textContent;
  step('game 1: result title', !!title1, title1);
  step('game 1: drag and drop used', usedDrag > 0, usedDrag);
  step('game 1: card menu used', usedMenu > 0, usedMenu);
  // Replay of the record.
  const replayBtn = end && $$('.ed-dlg-foot .ed-btn').find((b) => /Replay/i.test(b.textContent));
  replayBtn?.click();
  const rp = await until(() => $('.dk-rp-controls .dk-rp-slider'));
  step('replay opens', !!rp, null);
  if (rp) {
    const course = $$('.dk-rp-side .ap-kv dd')[0]?.textContent;
    step('replay: course entropy shown', /bits/.test(course || ''), course);
    step('replay: moves listed', $$('.dk-rp-moves li').length > 10, $$('.dk-rp-moves li').length);
    $$('.dk-rp-controls .ed-iconbtn')[0]?.click();
    await sleep(500);
    step('replay: back to the start', /^0 \//.test($('.dk-rp-pos')?.textContent || ''), $('.dk-rp-pos')?.textContent);
    $('.dk-replays .dk-screen-h .ed-iconbtn')?.click();
  }
  await until(() => $('.dk-hero'));

  // Game 2: an exclusive with jokers and transfers (Chameleon), 2 players.
  const idx = 11; // ex-chameleon in the gallery (presets first)
  tb = await newGame(idx, 2);
  step('game 2: table', !!tb, $('.dk-rs')?.textContent);
  end = await playToEnd('game 2');
  $$('.ed-dlg-foot .ed-btn').find((b) => /Play again/i.test(b.textContent))?.click();
  await sleep(600);
  step('game 2: rematch deals again', $$('.dk-hand .dk-card').length >= 5, $$('.dk-hand .dk-card').length);
  // leave through the menu
  $('.dk-ibtn[data-b="menu"]')?.click();
  const leave = await until(() => $$('.ed-menu-item').find((b) => /Leave/i.test(b.textContent)));
  leave?.click();
  const confirm = await until(() => $$('.ed-dlg-foot .ed-btn.ed-primary').find(Boolean), 2000);
  confirm?.click();
  step('leave the table', !!(await until(() => $('.dk-hero'))), null);

  // Profile and constructor.
  $('.dk-tile[data-k="profile"]')?.click();
  const pf = await until(() => $('.dk-profile'));
  step('profile: games counted', +($('.dk-stats b')?.textContent || 0) >= 2, $('.dk-stats b')?.textContent);
  step('profile: closest strategist', !!$('.dk-close'), $('.dk-close b')?.textContent);
  $('.dk-profile .dk-screen-h .ed-iconbtn')?.click();
  await until(() => $('.dk-hero'));
  $('.dk-tile[data-k="studio"]')?.click();
  const st = await until(() => $('.dk-studio'));
  step('constructor opens', !!st, $('.dk-st-summary')?.textContent);
  for (const tab of $$('.dk-st-tab')) { tab.click(); await sleep(60); }
  step('constructor: every tab renders', errors.length === 0, errors);
  $('.dk-studio .dk-screen-h .ed-iconbtn')?.click();
  await until(() => $('.dk-hero'));

  // Online (pages served over http with a rooms server: the development server, the backend build).
  const onlineTile = $('.dk-tile[data-k="online"]');
  if (onlineTile && /^https?:/.test(location.protocol)) {
    onlineTile.click();
    const connected = await until(() => $$('.dk-online .ed-hint').find((x) => /Connected/.test(x.textContent)), 8000);
    step('online: connected to this server', !!connected, connected?.textContent);
    $$('.dk-online .ed-btn').find((b) => /Create a room/.test(b.textContent))?.click();
    const form = await until(() => $('.dk-createroom'));
    const seats = form && $$('select', form)[1];
    if (seats) { seats.value = '2'; seats.dispatchEvent(new Event('change')); }
    await sleep(100);
    $$('.dk-createroom .ed-btn').find((b) => /Add a bot/.test(b.textContent))?.click();
    const pick = await until(() => $$('.dk-botitem')[1]);
    pick?.click();
    await sleep(200);
    const pw = $('.dk-createroom input[type=password]');
    if (pw) { pw.value = 'pass-123'; pw.dispatchEvent(new Event('input')); }
    $$('.ed-dlg-foot .ed-btn.ed-primary').pop()?.click();
    const lobby = await until(() => $('.dk-lobby'));
    const seated = await until(() => $$('.dk-lobby-players li').length === 2 && $$('.dk-lobby-players li'));
    step('online: room created, lobby with the bot', !!lobby && !!seated, seated && seated.map((li) => li.textContent));
    step('online: invite link offered', /#room=/.test($('.dk-invite .ed-input')?.value || ''), $('.dk-invite .ed-input')?.value?.replace(/invite=[^&]+/, 'invite=…'));
    $('.dk-lobby .dk-bigbtn')?.click();
    const table = await until(() => $('.dk-table .dk-hand .dk-card'), 8000);
    step('online: the game starts', !!table, null);
    if (table) {
      $('.dk-ibtn[data-b="chat"]')?.click();
      const say = await until(() => $('.dk-drawer .dk-chatin .ed-input'));
      if (say) { say.value = 'hello'; say.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
      $$('.dk-emote')[0]?.click();
      await sleep(600);
      step('online: chat and emotes', /hello/.test($('.dk-chatlist')?.textContent || ''), $('.dk-chatlist')?.textContent);
      $('.dk-drawer .ed-iconbtn')?.click();
      end = await playToEnd('online game');
    }
  }
  return { steps };
}
