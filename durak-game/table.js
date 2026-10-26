// durak-game/table.js - the card table: opponents around the top, the cloth with the stock, the open trump card,
// the discard pile and the bout (attack cards with their answers), the own seat with its actions and the hand. It
// renders a seat's view (durak/game.js views, hydrated) and animates every change from the previous view (cards fly
// from a player to the table, to the discard pile, to whoever takes them, from the stock to the hands). People play
// by tapping (select a card, then a highlighted target), by dragging a card onto a target, with the keyboard, or from
// the card's menu (right click / long press: what this card can do, or what it is). The browser's own menu, callout
// and text selection never appear over the table.
//
//   const tb = createTable(root, { act(action) -> Promise<{ ok, error }>, onButton(name), cardInfo(u) })
//   tb.update(view, { seat, players, skin, hints, motion, openHands, names, avatars, bots, title, online })
//   tb.bubble(seat, text, kind);  tb.setTimer(seat, fraction | null);  tb.flash(text);  tb.destroy()
//
// Design rules:
// - Stateless with respect to the game: every update() re-renders from the view; the only local state is UI state
//   (selection, focus, drag, timers) and the element cache.
// - Card identity: each physical card has a uid; one DOM element per uid is kept in `els` and reused wherever the card
//   appears (hand, table, open hands). That identity is what makes FLIP animation possible: measure every card's rect
//   before the re-render, re-render, then animate each element from its old rect to its new one. A card that had no
//   element before flies in from the stock or the seat that played it, per the new log entries.
// - Legality comes only from durak/engine.js (beatOptions, leadOk, ...): the table never re-implements a rule, so
//   custom rulesets highlight correctly for free. The server re-validates anyway.
// - Input paths (tap, drag, keyboard, context menu) all converge on one send(action) that respects `busy`, so a
//   double tap cannot send two actions while the first is in flight.

import { h, esc } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { contextMenu } from '../ui/contextmenu.js';
import { compile, cardText } from '../durak/ruleset.js';
import {
  beatOptions, leadOk, throwOptions, transferTarget, unbeaten, swapOk, hasPassed, throwers, teamOf, nextOpponent,
} from '../durak/engine.js';
import { faceSVG, backSVG } from './cardart.js';
import { applySkin, backColor } from './skins.js';
import { play } from './sound.js';

// Pointer travel (px) before a press becomes a drag: below it the gesture is a tap. 8px tolerates finger jitter.
const DRAG_START = 8;

export function createTable(root, opts) {
  const els = new Map();                 // uid -> card element
  let V = null, O = {}, C = null, me = -1;
  let sel = [];                          // selected uids (hand)
  let busy = false;
  let lastLog = 0;
  let drag = null;
  let focusIdx = -1;
  const timers = new Map();

  // --- skeleton ----------------------------------------------------------------------------------------------
  const btn = (name, icon, label, cls = '') => h('button', { type: 'button', class: 'dk-ibtn ' + cls, 'aria-label': label, title: label, dataset: { b: name }, onclick: () => opts.onButton?.(name) }, iconEl(icon));
  const bar = h('div', { class: 'dk-bar' },
    btn('menu', 'menu', t('tb.menu')),
    h('div', { class: 'dk-title' }, h('b', { class: 'dk-rs' }), h('span', { class: 'dk-trumpbadge' })),
    btn('log', 'list', t('tb.log')),
    btn('chat', 'chat', t('tb.chat'), 'dk-chatbtn'),
    btn('settings', 'settings', t('tb.settings')));
  const opps = h('div', { class: 'dk-opps' });
  const deck = h('div', { class: 'dk-deck' }, h('div', { class: 'dk-trumpcard' }), h('div', { class: 'dk-stock' }), h('span', { class: 'dk-stockn' }));
  const discard = h('div', { class: 'dk-discard' }, h('div', { class: 'dk-dpile' }), h('span', { class: 'dk-dn' }));
  const playArea = h('div', { class: 'dk-play', role: 'group', 'aria-label': t('tb.table') });
  const status = h('div', { class: 'dk-status', 'aria-live': 'polite' });
  const felt = h('div', { class: 'dk-felt' }, deck, discard, playArea, status);
  const self = h('div', { class: 'dk-self' });
  const actions = h('div', { class: 'dk-actions' });
  const mebar = h('div', { class: 'dk-mebar' }, self, actions);
  const hand = h('div', { class: 'dk-hand', role: 'listbox', 'aria-label': t('tb.hand'), 'aria-multiselectable': 'true', tabindex: '0' });
  const flashEl = h('div', { class: 'dk-flash', 'aria-live': 'assertive' });
  const el = h('div', { class: 'dk-table' }, bar, opps, felt, mebar, hand, flashEl);
  root.append(el);

  // No browser menu, callout or selection over the table (fields keep theirs).
  const noMenu = (e) => { if (!e.target.closest('input, textarea, [contenteditable]')) e.preventDefault(); };
  el.addEventListener('contextmenu', noMenu);
  el.addEventListener('selectstart', noMenu);
  const detachMenu = contextMenu(el, menuItems, { selector: '.dk-card[data-u], .dk-seat[data-seat]', delay: 450 });

  // Motion setting: 'auto' follows the OS reduced-motion preference, 'full'/'reduced' override it.
  const motion = () => O.motion !== 'reduced' && !(O.motion === 'auto' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const defOf = (u) => C.defs[C.uidDef[u]];
  const nameOf = (i) => (O.names && O.names[i]) || t('tb.player', { n: i + 1 });
  const cardName = (u) => cardText(V.rs, defOf(u));

  // --- card elements ------------------------------------------------------------------------------------------
  // Get-or-create the element of uid u. innerHTML is replaced only when the face markup changed (_html memo): rewriting
  // identical SVG would cost a parse and drop any running animation. className is reset so state classes from the
  // card's previous place (dk-att, dk-sel...) never leak into its new one; callers add the current ones.
  function cardEl(u) {
    let c = els.get(u);
    if (!c) {
      c = h('div', { class: 'dk-card', dataset: { u: String(u) }, role: 'img' });
      els.set(u, c);
    }
    const html = faceSVG(V.rs, defOf(u), O.skin.face);
    if (c._html !== html) { c.innerHTML = html; c._html = html; }
    c.setAttribute('aria-label', cardName(u));
    c.className = 'dk-card';
    return c;
  }
  const backHTML = () => backSVG(O.skin.back, backColor(O.skin), O.skin.backImage);
  const backEl = (cls = '') => { const b = h('div', { class: 'dk-card dk-back ' + cls }); b.innerHTML = backHTML(); return b; };

  // --- update ---------------------------------------------------------------------------------------------------
  // FLIP step 1 (First): record rects of every connected card, seats, stock and discard BEFORE touching the DOM.
  // Then render everything, then (Last/Invert/Play) animate from the recorded rects using only the log entries added
  // since the previous update. Selection is pruned to cards still in hand; outside the lead phase at most one card can
  // be selected (multi-card leads only). Elements of cards that left the board are dropped from the cache.
  function update(view, o = {}) {
    const first = !V;
    const prevView = V;
    const rects = new Map();
    if (!first) for (const [u, c] of els) if (c.isConnected) rects.set(u, c.getBoundingClientRect());
    const seatRect = seatRects();
    const stockRect = deck.getBoundingClientRect();
    const discardRect = discard.getBoundingClientRect();
    V = view;
    O = { ...O, ...o };
    C = compile(V.rs);
    me = O.seat ?? V.seat;
    applySkin(el, O.skin);
    el.classList.toggle('dk-online', !!O.online);
    el.classList.toggle('dk-spect', me < 0);
    // selection stays only with cards still in hand
    const myHand = me >= 0 && V.hands[me] ? V.hands[me] : [];
    sel = sel.filter((u) => myHand.includes(u));
    if (!sel.length || V.phase !== 'lead') sel = sel.slice(0, V.phase === 'lead' ? sel.length : 1);

    renderBar();
    renderOpponents();
    renderDeck();
    renderPlay();
    renderSelf();
    renderHand(myHand);
    renderActions();
    renderStatus();

    // Animations: what moved, what is new, what left.
    const newLog = V.log.slice(prevView ? lastLog : V.log.length);
    lastLog = V.log.length;
    if (!first && motion()) animate(rects, seatRect, stockRect, discardRect, newLog);
    if (!first) sounds(newLog);
    for (const [u, c] of els) if (!c.isConnected) els.delete(u);
    layoutHand();
  }

  function seatRects() {
    const m = new Map();
    for (const s of el.querySelectorAll('.dk-seat[data-seat]')) m.set(+s.dataset.seat, s.getBoundingClientRect());
    return m;
  }

  function renderBar() {
    bar.querySelector('.dk-rs').textContent = O.title || '';
    const tb = bar.querySelector('.dk-trumpbadge');
    tb.textContent = '';
    if (V.trumpSuit) {
      const s = V.rs.deck.suits.find((x) => x.id === V.trumpSuit);
      const red = s && s.color === 'red';
      tb.append(h('span', { class: 'dk-tsym' + (red ? ' dk-red' : ''), title: t('tb.trump') }, s ? s.symbol : V.trumpSuit));
    } else tb.append(h('span', { class: 'dk-tsym', title: t('tb.noTrump') }, '∅'));
    if (V.rs.rules.eternal.length) for (const e of V.rs.rules.eternal) { const s = V.rs.deck.suits.find((x) => x.id === e); tb.append(h('span', { class: 'dk-tsym dk-eternal' + (s && s.color === 'red' ? ' dk-red' : ''), title: t('tb.eternal') }, s ? s.symbol : e)); }
    bar.querySelector('.dk-chatbtn').hidden = !O.online;
  }

  function role(i) {
    if (V.phase === 'over') return '';
    if (i === V.defender && V.phase === 'bout') return V.taking ? 'taking' : 'defender';
    if (i === V.defender) return 'defender';
    if (i === V.attacker) return 'attacker';
    return '';
  }

  // Opponents in play order starting after me (clockwise from my seat), so the next player is always leftmost.
  // Spectators see seats 0..n-1. The `if (me < 0)` unshift/pop line is dead code: its result is discarded by the
  // return below (harmless, left as is).
  function seatOrder() {
    const order = [];
    const base = me >= 0 ? me : 0;
    for (let k = 1; k <= V.n; k++) { const i = (base + k) % V.n; if (i !== me) order.push(i); }
    if (me < 0) order.unshift(0), order.pop();
    return me < 0 ? Array.from({ length: V.n }, (_, i) => i) : order;
  }

  // One seat: avatar with timer ring and team dot, name, card count, a role/state tag (text, not only colour), a mini
  // fan of backs (max 7 drawn), open hand at game end or in full replays, and a bubble slot. The timer fraction is
  // re-applied from `timers` because the seat element is recreated on every update.
  function seatBox(i, mine = false) {
    const r = role(i);
    const out = V.out.includes(i);
    const places = V.result ? V.result.places : null;
    const avatar = (O.avatars && O.avatars[i]) || (O.bots && O.bots[i] ? '🤖' : '🙂');
    const count = V.counts[i];
    const turn = V.turn === i && V.phase !== 'over';
    const cls = ['dk-seat', mine ? 'dk-me' : '', r ? 'dk-' + r : '', out ? 'dk-out' : '', turn ? 'dk-turn' : '',
      O.players && O.players[i] && O.players[i].connected === false && !O.players[i].bot ? 'dk-away' : ''].filter(Boolean).join(' ');
    const passed = V.phase === 'bout' && V.passes && V.passes[i] != null && throwers(V).includes(i) && i !== V.defender;
    let tag = '';
    if (out && places) tag = t('tb.place', { n: places.indexOf(i) + 1 });
    else if (out) tag = t('tb.out');
    else if (r === 'taking') tag = t('tb.takes');
    else if (passed) tag = t('tb.passed');
    else if (r === 'defender') tag = '🛡';
    else if (r === 'attacker') tag = '⚔';
    if (V.result && V.result.losers && V.result.losers.includes(i)) tag = V.result.durak === i ? t('tb.durak') : t('tb.lost');
    const team = V.rs.rules.teams ? h('i', { class: 'dk-team dk-team' + teamOf(V, i) }) : null;
    const fan = !mine ? h('div', { class: 'dk-fan' }, ...Array.from({ length: Math.min(count, 7) }, (_, k) => {
      const b = h('i', { class: 'dk-mini' });
      b.style.setProperty('--k', String(k - Math.min(count, 7) / 2));
      return b;
    })) : null;
    const open = !mine && (O.openHands || V.phase === 'over') && V.hands[i] ? h('div', { class: 'dk-openhand' }, V.hands[i].map((u) => { const c = cardEl(u); c.classList.add('dk-small'); return c; })) : null;
    const box = h('div', { class: cls, dataset: { seat: String(i) }, title: nameOf(i) },
      h('div', { class: 'dk-ava' }, h('span', { class: 'dk-avai' }, avatar), team, h('span', { class: 'dk-ringbox', html: '<svg class="dk-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16.5"/></svg>' })),
      h('div', { class: 'dk-sinfo' }, h('span', { class: 'dk-nm' }, nameOf(i)), mine ? null : h('span', { class: 'dk-cnt', title: t('tb.cards') }, String(count))),
      tag ? h('span', { class: 'dk-tag' }, tag) : null,
      fan, open,
      h('div', { class: 'dk-bubble' }));
    const tm = timers.get(i);
    if (tm != null) box.style.setProperty('--timer', String(tm));
    return box;
  }

  // Visible bubbles are carried over into the rebuilt seats so a chat line does not vanish when a move arrives.
  function renderOpponents() {
    const bubbles = new Map();
    for (const b of opps.querySelectorAll('.dk-seat')) { const bb = b.querySelector('.dk-bubble'); if (bb && bb.classList.contains('dk-show')) bubbles.set(b.dataset.seat, bb); }
    opps.textContent = '';
    const order = seatOrder();
    opps.dataset.n = String(order.length);
    for (const i of order) {
      const box = seatBox(i);
      const keep = bubbles.get(String(i));
      if (keep) box.querySelector('.dk-bubble').replaceWith(keep);
      opps.append(box);
    }
  }

  // Stock: the trump card under it while still in the stock (it is the last card drawn), up to 4 backs for depth, the
  // count; when the stock is empty a faint trump symbol remains so the trump suit stays visible on the cloth.
  function renderDeck() {
    const tc = deck.querySelector('.dk-trumpcard'), st = deck.querySelector('.dk-stock'), n = deck.querySelector('.dk-stockn');
    tc.textContent = '';
    st.textContent = '';
    if (V.trumpCard >= 0 && V.trumpInStock) tc.append(cardEl(V.trumpCard));
    const pile = Math.max(0, V.stock - (V.trumpInStock ? 1 : 0));
    for (let k = 0; k < Math.min(4, Math.ceil(pile / 6)); k++) { const b = backEl(); b.style.setProperty('--k', String(k)); st.append(b); }
    n.textContent = V.stock ? String(V.stock) : '';
    deck.classList.toggle('dk-empty', !V.stock);
    deck.title = t('tb.stock', { n: V.stock });
    if (!V.stock && V.trumpSuit) {
      const s = V.rs.deck.suits.find((x) => x.id === V.trumpSuit);
      tc.append(h('span', { class: 'dk-trumpghost' + (s && s.color === 'red' ? ' dk-red' : '') }, s ? s.symbol : ''));
    }
    const dp = discard.querySelector('.dk-dpile'), dn = discard.querySelector('.dk-dn');
    dp.textContent = '';
    for (let k = 0; k < Math.min(5, Math.ceil(V.discard / 5)); k++) { const b = backEl(); b.style.setProperty('--k', String(k)); dp.append(b); }
    dn.textContent = V.discard ? String(V.discard) : '';
    discard.title = t('tb.discard', { n: V.discard });
  }

  // Targets of the selection: { beat: Set(slot), lead, throw, transfer, show }
  // beat = table slots whose open attack card the selected card can beat; the others light up the whole play area.
  // Only single-card selections have targets outside the lead (multi-card leads are the only multi-select action).
  function targets() {
    const out = { beat: new Set(), lead: false, throw: false, transfer: false, show: false };
    if (me < 0 || V.phase === 'over' || !sel.length) return out;
    if (V.phase === 'lead') { out.lead = leadOk(V, me, sel); return out; }
    if (sel.length === 1) {
      const u = sel[0];
      V.table.forEach((p, i) => { if (p.d < 0 && beatOptions(V, me, i).includes(u)) out.beat.add(i); });
      out.throw = throwOptions(V, me).includes(u);
      out.transfer = transferTarget(V, me, [u]) >= 0;
      out.show = !!V.rs.rules.transferShow && transferTarget(V, me, [u], true) >= 0;
    }
    return out;
  }

  function renderPlay() {
    playArea.textContent = '';
    const tg = targets();
    V.table.forEach((p, i) => {
      const a = cardEl(p.a);
      a.classList.add('dk-att');
      if (tg.beat.has(i)) a.classList.add('dk-target');
      const pair = h('div', { class: 'dk-pair', dataset: { slot: String(i) } }, a);
      if (p.d >= 0) { const d = cardEl(p.d); d.classList.add('dk-def'); pair.append(d); pair.classList.add('dk-beaten'); }
      if (V.shown && V.shown.length) pair.classList.toggle('dk-shownbout', true);
      playArea.append(pair);
    });
    if (V.shown && V.shown.length) {
      playArea.append(h('div', { class: 'dk-shown' }, h('span', {}, t('tb.shown')), V.shown.map((u) => { const c = cardEl(u); c.classList.add('dk-small'); return c; })));
    }
    const drop = tg.lead || tg.throw || tg.transfer || tg.show;
    playArea.classList.toggle('dk-drop', drop);
    playArea.dataset.hint = tg.lead ? t('tb.dropLead') : tg.transfer ? t('tb.dropTransfer') : tg.throw ? t('tb.dropThrow') : tg.show ? t('tb.dropShow') : '';
    playArea.classList.toggle('dk-emptyplay', !V.table.length);
    playArea.dataset.n = String(V.table.length);
  }

  function renderSelf() {
    self.textContent = '';
    if (me < 0) { self.append(h('span', { class: 'dk-spectlabel' }, iconEl('eye'), t('tb.spectator'))); return; }
    self.append(seatBox(me, true));
  }

  // Hand as an ARIA listbox (multiselectable); cards are options with tabIndex -1 - focus stays on the hand container
  // and the "focused" card is tracked by focusIdx (roving focus without moving DOM focus between re-created nodes).
  // With hints on, cards with no legal use right now are dimmed; dk-ok marks playable ones for the hover lift.
  function renderHand(myHand) {
    hand.textContent = '';
    const decision = myDecision();
    const playable = decision ? playableSet() : null;
    myHand.forEach((u, k) => {
      const c = cardEl(u);
      c.classList.add('dk-inhand');
      c.setAttribute('role', 'option');
      c.setAttribute('aria-selected', String(sel.includes(u)));
      c.tabIndex = -1;
      if (sel.includes(u)) c.classList.add('dk-sel');
      if (playable && O.hints !== false && !playable.has(u)) c.classList.add('dk-dim');
      if (playable && playable.has(u)) c.classList.add('dk-ok');
      c.style.setProperty('--i', String(k));
      hand.append(c);
    });
    hand.dataset.n = String(myHand.length);
    if (focusIdx >= myHand.length) focusIdx = myHand.length - 1;
  }

  // Overlap step = visible slice per card: at most 84 % of a card (barely overlapping when there is room), else the
  // width shared out evenly ((W - one full card) / (n - 1)). Below 12px slices become unreadable, so the hand switches
  // to horizontal scrolling instead (CSS .dk-scroll). Runs after render because it measures real card width.
  function layoutHand() {
    const n = hand.children.length;
    if (!n) return;
    const cw = hand.firstElementChild.getBoundingClientRect().width || 64;
    const W = hand.clientWidth - 20;
    const step = n > 1 ? Math.min(cw * 0.84, (W - cw) / (n - 1)) : 0;
    hand.style.setProperty('--step', Math.max(12, step).toFixed(1) + 'px');
    hand.classList.toggle('dk-scroll', step < 12);
  }

  // Is the game waiting for a decision of mine (or may I act now)?
  function myDecision() {
    if (me < 0 || V.phase === 'over') return false;
    return (V.actors || []).includes(me) || V.turn === me;
  }

  // Hand cards with any legal use right now.
  function playableSet() {
    const s = new Set();
    const hd = V.hands[me] || [];
    if (V.phase === 'lead' && V.attacker === me) { for (const u of hd) if (leadOk(V, me, [u])) s.add(u); }
    else if (V.phase === 'bout') {
      for (const u of throwOptions(V, me)) s.add(u);
      if (me === V.defender && !V.taking) {
        V.table.forEach((p, i) => { if (p.d < 0) for (const u of beatOptions(V, me, i)) s.add(u); });
        for (const u of hd) if (transferTarget(V, me, [u]) >= 0 || (V.rs.rules.transferShow && transferTarget(V, me, [u], true) >= 0)) s.add(u);
      }
    }
    for (const u of hd) if (swapOk(V, me, u)) s.add(u);
    return s;
  }

  // Action buttons for the current decision only. Defender: transfer (primary when possible), show-trump transfer,
  // take (warn colour unless a transfer is the better hint). Throwers: throw the selected card; pass labelled by
  // context ("let take" while the defender takes, "done" when all is beaten, "no more" while cards are still open).
  function renderActions() {
    actions.textContent = '';
    if (me < 0 || V.phase === 'over') {
      if (V.phase === 'over') actions.append(abtn('again', t('tb.again'), 'primary'), abtn('review', t('tb.review')));
      return;
    }
    const tg = targets();
    const add = (b) => actions.append(b);
    if (V.phase === 'lead' && V.attacker === me && sel.length && tg.lead) add(abtn('lead', sel.length > 1 ? t('tb.leadN', { n: sel.length }) : t('tb.lead'), 'primary'));
    if (V.phase === 'bout') {
      if (me === V.defender && !V.taking && unbeaten(V) > 0) {
        if (tg.transfer) add(abtn('transfer', t('tb.transfer'), 'primary'));
        if (tg.show) add(abtn('show', t('tb.show')));
        add(abtn('take', t('tb.take'), tg.transfer ? '' : 'warn'));
      }
      const isThrower = throwers(V).includes(me);
      if (isThrower && tg.throw) add(abtn('throw', t('tb.throw'), 'primary'));
      if (isThrower && (V.taking || unbeaten(V) === 0) && !hasPassed(V, me)) add(abtn('pass', V.taking ? t('tb.letTake') : t('tb.done'), V.taking ? '' : 'go'));
      else if (isThrower && unbeaten(V) > 0 && !V.taking && !hasPassed(V, me) && throwOptions(V, me).length) add(abtn('pass', t('tb.noMore'), 'subtle'));
    }
    const sw = (V.hands[me] || []).find((u) => swapOk(V, me, u));
    if (sw != null) add(abtn('swap', t('tb.swap')));
  }

  function abtn(name, label, kind = '') {
    return h('button', { type: 'button', class: 'dk-abtn' + (kind ? ' dk-' + kind : ''), dataset: { a: name }, onclick: () => doButton(name) }, label);
  }

  function renderStatus() {
    status.textContent = '';
    const s = statusText();
    if (s) status.append(h('span', {}, s));
    status.hidden = !s;
  }

  function statusText() {
    if (V.phase === 'over') {
      const r = V.result;
      if (!r) return '';
      if (r.draw) return t('st.draw');
      if (me >= 0 && r.losers.includes(me)) return r.durak === me ? t('st.youDurak') : t('st.yourTeamLost');
      if (me >= 0) return t('st.youWon');
      return t('st.durakIs', { name: nameOf(r.durak) });
    }
    const who = V.turn;
    if (me >= 0) {
      if (V.phase === 'lead' && V.attacker === me) return t('st.yourLead', { name: nameOf(V.defender) });
      if (V.phase === 'bout' && me === V.defender && !V.taking && unbeaten(V) > 0) return V.rs.rules.transfer && V.table.every((p) => p.d < 0) ? t('st.defendTransfer') : t('st.defend');
      if (V.phase === 'bout' && who === me) return V.taking ? t('st.throwToTaker', { name: nameOf(V.defender) }) : t('st.throwMore');
    }
    if (who >= 0) {
      if (V.phase === 'lead') return t('st.leads', { name: nameOf(who) });
      if (who === V.defender) return t('st.defends', { name: nameOf(who) });
      if (V.taking && V.defender === me) return t('st.youTake');
      return V.taking ? t('st.takesWaiting', { name: nameOf(V.defender) }) : t('st.thinking', { name: nameOf(who) });
    }
    return '';
  }

  // --- animations ---------------------------------------------------------------------------------------------
  // FLIP play. For each visible card: start rect = its old rect, or (new element) the seat that played it per the log,
  // or the stock for drawn hand cards (staggered 60ms, cycling every 8 so big draws do not take seconds). Invert with
  // translate+scale and animate to 'none' via WAAPI (compositor-friendly, no style bookkeeping). Cards that left the
  // DOM are animated as fixed-position ghost clones to the taker's seat or the discard pile. Opponents' draws are
  // hidden information, so only up to 4 anonymous backs fly to their seat.
  function animate(rects, seatRect, stockRect, discardRect, newLog) {
    const dur = 360;
    const ease = 'cubic-bezier(.2,.75,.25,1)';
    // who put which card on the table (new cards fly from their seat)
    const from = new Map();
    for (const e of newLog) {
      if (e[0] === 'L' || e[0] === '+' || (e[0] === 'T' && !e[3])) for (const u of e[2]) from.set(u, e[1]);
      else if (e[0] === 'B') from.set(e[2], e[1]);
    }
    let took = null;
    for (const e of newLog) if (e[0] === '/') took = e[1] ? e[2] : -1;
    const draws = newLog.filter((e) => e[0] === 'D' && e[2] > 0);
    let k = 0;
    for (const [u, c] of els) {
      if (!c.isConnected) continue;
      const to = c.getBoundingClientRect();
      let fr = rects.get(u);
      if (!fr) {
        const s = from.get(u);
        if (s != null && s !== me && seatRect.get(s)) fr = shrink(seatRect.get(s), to);
        else if (c.classList.contains('dk-inhand')) fr = shrink(stockRect, to);
        else continue;
      }
      const dx = fr.left - to.left, dy = fr.top - to.top, sc = fr.width && to.width ? fr.width / to.width : 1;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sc - 1) < 0.02) continue;
      c.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${sc})` }, { transform: 'none' }], { duration: dur, easing: ease, delay: c.classList.contains('dk-inhand') && !rects.get(u) ? 60 * (k++ % 8) : 0 });
    }
    // Cards that left the view: to the discard pile or to the player who took them.
    for (const [u, r] of rects) {
      const c = els.get(u);
      if (c && c.isConnected) continue;
      const target = took != null && took >= 0 && took !== me ? seatRect.get(took) : discardRect;
      if (!target) continue;
      ghost(c, r, target, took != null && took >= 0 ? 1 : 0.6);
    }
    // Hidden draws of the opponents: backs from the stock to their seats.
    let d = 0;
    for (const e of draws) {
      if (e[1] === me) continue;
      const sr = seatRect.get(e[1]);
      if (!sr) continue;
      for (let i = 0; i < Math.min(e[2], 4); i++) {
        const b = backEl('dk-flyer');
        ghost(b, stockRect, sr, 0.5, 120 + 70 * d++);
      }
    }
  }

  function shrink(r, to) {
    const w = to.width * 0.6, hgt = to.height * 0.6;
    return { left: r.left + r.width / 2 - w / 2, top: r.top + r.height / 2 - hgt / 2, width: w, height: hgt };
  }

  // Temporary clone appended to <body> (outside the table's overflow:hidden). Removed on finish, on cancel, and by a
  // safety timeout - a backgrounded tab may never deliver finish, and leaked ghosts would pile up over a game.
  function ghost(c, fromR, toR, endScale = 0.6, delay = 0) {
    if (!c) return;
    const g = c.cloneNode(true);
    g.classList.add('dk-ghost');
    g.classList.remove('dk-target', 'dk-sel');
    Object.assign(g.style, { position: 'fixed', left: fromR.left + 'px', top: fromR.top + 'px', width: fromR.width + 'px', height: (fromR.height || fromR.width * 1.4) + 'px', margin: '0', zIndex: 50 });
    document.body.append(g);
    const dx = toR.left + toR.width / 2 - (fromR.left + fromR.width / 2), dy = toR.top + toR.height / 2 - (fromR.top + (fromR.height || 0) / 2);
    const a = g.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${endScale})`, opacity: 0.15 }], { duration: 420, delay, easing: 'cubic-bezier(.4,.1,.3,1)', fill: 'both' });
    a.onfinish = () => g.remove();
    a.oncancel = () => g.remove();
    setTimeout(() => g.remove(), 1200 + delay);
  }

  function sounds(newLog) {
    if (!newLog.length) return;
    const kinds = newLog.map((e) => e[0]);
    if (kinds.includes('E')) return;
    if (kinds.includes('/')) {
      const e = newLog.find((x) => x[0] === '/');
      play(e[1] ? 'take' : 'shuffle');
    } else if (kinds.includes('B')) play('beat');
    else if (kinds.some((k) => k === 'L' || k === '+' || k === 'T' || k === 'S')) play('card');
    if (myDecision() && V.turn === me && !newLog.some((e) => e[1] === me)) play('turn');
  }

  // --- input: selection, buttons, drag & drop, keys --------------------------------------------------------------
  // Single exit for all player actions. Selection is cleared only on success, so a rejected move keeps the card
  // selected for a retry. The re-render after the await restores the hand even if no new view arrives.
  async function send(action) {
    if (busy) return;
    busy = true;
    try {
      const r = await opts.act(action);
      if (r && !r.ok) flash(t('err.illegal'));
      else sel = [];
    } finally { busy = false; }
    if (V) update(V);
  }

  function doButton(name) {
    const tg = targets();
    if (name === 'take') { send({ type: 'take' }); return; }
    if (name === 'pass') { send({ type: 'pass' }); return; }
    if (name === 'lead' && tg.lead) { send({ type: 'lead', cards: sel.slice() }); return; }
    if (name === 'throw' && tg.throw) { send({ type: 'throw', cards: [sel[0]] }); return; }
    if (name === 'transfer' && tg.transfer) { send({ type: 'transfer', cards: [sel[0]] }); return; }
    if (name === 'show' && tg.show) { send({ type: 'transfer', cards: [sel[0]], show: true }); return; }
    if (name === 'swap') { const u = (V.hands[me] || []).find((x) => swapOk(V, me, x)); if (u != null) send({ type: 'swap', card: u }); return; }
    opts.onButton?.(name);
  }

  // The actions of one hand card: [{ label, action }].
  function cardActions(u) {
    const out = [];
    if (me < 0 || !V || V.phase === 'over') return out;
    const hd = V.hands[me] || [];
    if (!hd.includes(u)) return out;
    if (V.phase === 'lead' && V.attacker === me) {
      if (leadOk(V, me, [u])) out.push({ label: t('cm.lead', { card: cardName(u) }), action: { type: 'lead', cards: [u] } });
      const same = hd.filter((x) => x !== u && C.match[C.uidDef[x] * C.D + C.uidDef[u]] && !C.wild[C.uidDef[x]]);
      if (same.length && leadOk(V, me, [u, ...same])) out.push({ label: t('cm.leadAll', { n: same.length + 1 }), action: { type: 'lead', cards: [u, ...same] } });
    }
    if (V.phase === 'bout') {
      V.table.forEach((p, i) => { if (p.d < 0 && beatOptions(V, me, i).includes(u)) out.push({ label: t('cm.beat', { card: cardName(p.a) }), action: { type: 'beat', card: u, slot: i } }); });
      if (transferTarget(V, me, [u]) >= 0) out.push({ label: t('cm.transfer', { name: nameOf(transferTarget(V, me, [u])) }), action: { type: 'transfer', cards: [u] } });
      if (V.rs.rules.transferShow && transferTarget(V, me, [u], true) >= 0) out.push({ label: t('cm.show'), action: { type: 'transfer', cards: [u], show: true } });
      if (throwOptions(V, me).includes(u)) out.push({ label: t('cm.throw'), action: { type: 'throw', cards: [u] } });
    }
    if (swapOk(V, me, u)) out.push({ label: t('cm.swap'), action: { type: 'swap', card: u } });
    return out;
  }

  function menuItems(target) {
    if (!V) return null;
    if (target.dataset.seat != null) {
      const i = +target.dataset.seat;
      return [{ header: true, label: nameOf(i) }, { label: t('cm.cards', { n: V.counts[i] }), disabled: true }, opts.seatInfo ? { label: t('cm.about'), icon: 'info', action: () => opts.seatInfo(i) } : null];
    }
    const u = +target.dataset.u;
    const items = [{ header: true, label: cardName(u) }];
    for (const a of cardActions(u)) items.push({ label: a.label, action: () => send(a.action) });
    // A table card: what of mine beats it.
    const slot = V.table.findIndex((p) => p.a === u && p.d < 0);
    if (slot >= 0 && me === V.defender && !V.taking) for (const x of beatOptions(V, me, slot)) items.push({ label: t('cm.beatWith', { card: cardName(x) }), action: () => send({ type: 'beat', card: x, slot }) });
    items.push({ sep: true }, { label: t('cm.details'), icon: 'info', action: () => opts.cardInfo?.(u) });
    return items;
  }

  // Tap model: first tap selects (or extends a multi-card lead of matching ranks), second tap on a selected card plays
  // it when exactly one action is possible (otherwise deselects). Tapping a table card beats it with the selection;
  // with nothing selected and exactly one possible beater, that card is played directly.
  function tapCard(u) {
    if (!V || me < 0 || V.phase === 'over') return;
    const hd = V.hands[me] || [];
    if (!hd.includes(u)) {
      // a table card: beat it with the selection
      const slot = V.table.findIndex((p) => p.a === u && p.d < 0);
      if (slot >= 0 && sel.length === 1 && beatOptions(V, me, slot).includes(sel[0])) { send({ type: 'beat', card: sel[0], slot }); return; }
      if (slot >= 0 && !sel.length && me === V.defender && !V.taking) {
        const opts2 = beatOptions(V, me, slot);
        if (opts2.length === 1) { send({ type: 'beat', card: opts2[0], slot }); return; }
        flash(opts2.length ? t('tb.pickBeat') : t('tb.cannotBeat'));
      }
      return;
    }
    if (sel.includes(u)) {
      // second tap: play it when there is exactly one thing to do
      const acts = cardActions(u);
      if (V.phase === 'lead' && sel.length > 1 && leadOk(V, me, sel)) { send({ type: 'lead', cards: sel.slice() }); return; }
      if (acts.length === 1) { send(acts[0].action); return; }
      sel = sel.filter((x) => x !== u);
    } else if (V.phase === 'lead' && sel.length && leadOk(V, me, [...sel, u])) sel = [...sel, u];
    else sel = [u];
    update(V);
  }

  function tapPlay() {
    const tg = targets();
    if (!sel.length) return;
    if (tg.lead) send({ type: 'lead', cards: sel.slice() });
    else if (tg.transfer) send({ type: 'transfer', cards: [sel[0]] });
    else if (tg.throw) send({ type: 'throw', cards: [sel[0]] });
    else if (tg.show) send({ type: 'transfer', cards: [sel[0]], show: true });
  }

  el.addEventListener('click', (e) => {
    if (drag && drag.moved) return;
    const c = e.target.closest('.dk-card[data-u]');
    if (c && el.contains(c)) { tapCard(+c.dataset.u); return; }
    if (e.target.closest('.dk-play')) tapPlay();
  });

  // Drag & drop of hand cards (mouse, touch, pen). Pointer Events unify all three. pointerdown only arms; the drag
  // starts after DRAG_START px and only if the card has any legal action. Move/up listen on window so the drag
  // continues outside the hand; pointermove is non-passive so preventDefault can stop touch scrolling (cards also have
  // touch-action:none in CSS). Drop target is found with elementFromPoint - the ghost has pointer-events:none so it is
  // never the hit. After a drag, `drag` is cleared on the next tick so the click event that follows pointerup is
  // ignored instead of toggling the selection.
  // KNOWN DEFECT: the 'pointercancel' window listener is an anonymous arrow function, so destroy() cannot remove it;
  // each finished session leaks one listener (it only calls endDrag on a dead table). Fix: name it and remove it in
  // destroy() like onMove/onUp.
  hand.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.dk-card[data-u]');
    if (!c || e.button > 0 || me < 0) return;
    drag = { u: +c.dataset.u, c, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, ghost: null };
  });
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', () => endDrag());
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_START) return;
      if (!cardActions(drag.u).length) { drag = null; return; }
      drag.moved = true;
      if (!sel.includes(drag.u)) { sel = V.phase === 'lead' && sel.length && leadOk(V, me, [...sel, drag.u]) ? [...sel, drag.u] : [drag.u]; update(V); }
      const r = (els.get(drag.u) || drag.c).getBoundingClientRect();
      drag.ox = drag.x - r.left; drag.oy = drag.y - r.top;
      const g = (els.get(drag.u) || drag.c).cloneNode(true);
      g.classList.add('dk-dragging');
      Object.assign(g.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: 0, zIndex: 60, pointerEvents: 'none' });
      document.body.append(g);
      drag.ghost = g;
      (els.get(drag.u) || drag.c).classList.add('dk-lifted');
      el.classList.add('dk-dragmode');
    }
    e.preventDefault();
    drag.ghost.style.left = e.clientX - drag.ox + 'px';
    drag.ghost.style.top = e.clientY - drag.oy + 'px';
    const over = document.elementFromPoint(e.clientX, e.clientY);
    for (const x of el.querySelectorAll('.dk-hover')) x.classList.remove('dk-hover');
    const tgt = over && (over.closest('.dk-att.dk-target') || over.closest('.dk-play.dk-drop'));
    if (tgt) tgt.classList.add('dk-hover');
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) { drag = null; return; }
    const over = document.elementFromPoint(e.clientX, e.clientY);
    const att = over && over.closest('.dk-att.dk-target');
    const area = over && over.closest('.dk-play.dk-drop');
    const u = drag.u;
    endDrag();
    if (att) { const slot = +att.parentElement.dataset.slot; send({ type: 'beat', card: u, slot }); }
    else if (area) tapPlay();
    // keep the click that follows from toggling the selection
    setTimeout(() => { drag = null; }, 0);
  }
  function endDrag() {
    if (!drag) return;
    if (drag.ghost) drag.ghost.remove();
    for (const x of el.querySelectorAll('.dk-hover, .dk-lifted')) x.classList.remove('dk-hover', 'dk-lifted');
    el.classList.remove('dk-dragmode');
    drag = { ...drag, ghost: null };
  }

  hand.addEventListener('keydown', (e) => {
    if (!V || me < 0) return;
    const cards = [...hand.querySelectorAll('.dk-card[data-u]')];
    if (!cards.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      focusIdx = Math.max(0, Math.min(cards.length - 1, (focusIdx < 0 ? 0 : focusIdx + (e.key === 'ArrowRight' ? 1 : -1))));
      cards.forEach((c, i) => c.classList.toggle('dk-focus', i === focusIdx));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (focusIdx >= 0) tapCard(+cards[focusIdx].dataset.u);
    }
  });
  // Global shortcuts: T take, D/P pass ("done"), Esc clear selection. Ignored while typing or inside dialogs/menus.
  const onKey = (e) => {
    if (!V || me < 0 || e.target.closest('input, textarea, select, [contenteditable], .ed-dialog, .ed-menu')) return;
    if (e.key === 't' || e.key === 'T') { if (me === V.defender && !V.taking && unbeaten(V) > 0) { e.preventDefault(); send({ type: 'take' }); } }
    else if (e.key === 'd' || e.key === 'D' || e.key === 'p' || e.key === 'P') { if (throwers(V).includes(me) && !hasPassed(V, me)) { e.preventDefault(); send({ type: 'pass' }); } }
    else if (e.key === 'Escape' && sel.length) { sel = []; update(V); }
  };
  window.addEventListener('keydown', onKey);
  const onResize = () => layoutHand();
  window.addEventListener('resize', onResize);

  // --- extras -------------------------------------------------------------------------------------------------------
  function bubble(seat, text, kind = 'chat') {
    const box = el.querySelector(`.dk-seat[data-seat="${seat}"] .dk-bubble`);
    if (!box) return;
    box.textContent = text;
    box.className = 'dk-bubble dk-show dk-' + kind;
    clearTimeout(box._tm);
    box._tm = setTimeout(() => box.classList.remove('dk-show'), kind === 'emote' ? 2200 : 4200);
  }
  function setTimer(seat, fraction) {
    timers.clear();
    if (seat != null && fraction != null) timers.set(seat, Math.max(0, Math.min(1, fraction)));
    for (const s of el.querySelectorAll('.dk-seat[data-seat]')) {
      const f = timers.get(+s.dataset.seat);
      if (f != null) s.style.setProperty('--timer', String(f)); else s.style.removeProperty('--timer');
      s.classList.toggle('dk-timed', f != null);
    }
  }
  // Restart a CSS animation: remove the class, force a reflow (reading offsetWidth), add it again. Without the reflow
  // the browser coalesces remove+add and the animation does not replay for repeated messages.
  function flash(text) {
    flashEl.textContent = text;
    flashEl.classList.remove('dk-show');
    void flashEl.offsetWidth;
    flashEl.classList.add('dk-show');
  }
  function destroy() {
    detachMenu();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    el.remove();
  }

  return { el, update, bubble, setTimer, flash, destroy, cardActions, get view() { return V; }, select: (u) => { sel = [u]; update(V); } };
}

// Short descriptions of a card for the details dialog: what it beats, what beats it, its rules.
// C.beat[trumpIndex] is a flattened D x D boolean matrix over card definitions (row = beater, column = beaten);
// counts are weighted by copies so a double deck reports physical cards, not definitions.
export function describeCard(rs, trumpSuit, u) {
  const C = compile(rs);
  const d = C.uidDef[u], def = C.defs[d];
  const t2 = C.trumpIndex(trumpSuit);
  let beats = 0, beatenBy = 0;
  for (let j = 0; j < C.D; j++) { if (C.beat[t2][d * C.D + j]) beats += C.defs[j].copies; if (C.beat[t2][j * C.D + d]) beatenBy += C.defs[j].copies; }
  return { def, beats, beatenBy, trump: C.tier[t2][d] > 0, tier: C.tier[t2][d], wild: def.rules.wild, rules: def.rules, text: cardText(rs, def) };
}

export { esc, nextOpponent };
