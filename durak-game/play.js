// durak-game/play.js - one game session on the table: a local room (bots in the page, rooms/local.js) or an online
// room (rooms/client.js), the table renderer, the player's actions (recorded for the style analysis), the move log,
// chat and emotes, the optional turn timer, the end of the game (result, achievements, the DGN record, rematch) and
// the dialogs about cards and players.
//
//   startSession(main, { room, settings, mySeat, names, bots, avatars, online, onExit }) -> session
//   localSettings(setup) -> { settings, options }   room settings and localRoom options of a new local game
//   moveText(rs, entry, names) -> string             one public log entry as text

import { h } from '../ui/dom.js';
import { t, pickUI } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { openDialog, openMenu, toast, confirmDialog } from '../ui/overlays.js';
import { copyText } from '../ui/app.js';
import { localRoom } from '../rooms/client.js';
import { cardText, compile, textOf } from '../durak/ruleset.js';
import { game, hydrate, rulesetOf } from '../durak/game.js';
import { templateById } from '../durak/bots.js';
import { encode } from '../durak/notation.js';
import { observe, gameSummary, newAchievements, ACHIEVEMENTS, newCounters, mergeCounters } from '../durak/analysis.js';
import { fastPolicy } from '../durak/bots.js';
import { unbeaten, throwers, hasPassed, legalActions } from '../durak/engine.js';
import { createTable, describeCard } from './table.js';
import { skinOf } from './skins.js';
import { store, save, addReplay } from './store.js';
import { play, setSound } from './sound.js';
import { rulesetName, botName, botLabel } from './names.js';

//
// Design: the session is a view over a room. The room is the single source of truth (it emits 'view' after every
// change, including our own moves); the table never mutates game state, it only sends actions via room.act and
// re-renders whatever view arrives. So local and online play, bots and humans, and reconnects all go through one
// render path. Style analysis observes our accepted actions against the view they were made in (lastView captured
// before the await), never rejected ones.

// Emotes travel as chat messages prefixed ':e:' - no protocol extension needed; receivers render them as bubbles
// and keep them out of the chat history.
export const EMOTES = ['👍', '😂', '😮', '😡', '🤝', '🔥', '🃏', '⏱', '🙏', '👏'];
const SPEEDS = { fast: 260, normal: 650, slow: 1200 };

export const botDelayOf = (speed) => SPEEDS[speed] || SPEEDS.normal;

// The room settings and options of a local game from the setup screen.
// Seat 0 is always the human. A built-in ruleset is sent by id only (ruleset: undefined), a custom one in full: the
// room (and a replay) must be able to reconstruct it. kinds[i] = 'kind.level' per seat (null for the human) feeds
// seat info dialogs and DGN records. random 'crypto' = unrepeatable deal; 'seeded' = reproducible from the seed.
export function localSettings(setup) {
  const S = store.settings;
  const n = setup.players;
  const names = [S.name || t('you')];
  const avatars = [S.avatar || '🙂'];
  const bots = [];
  const kinds = [null];
  for (let i = 1; i < n; i++) {
    const b = setup.seats[i - 1] || { kind: 'rookie', level: 2 };
    const tpl = templateById(b.kind);
    const custom = b.kind === 'custom' || !tpl;
    bots.push({ seat: i, kind: custom ? 'custom' : b.kind, options: { level: b.level, ...(b.options || {}) } });
    names.push(b.name || botName(b));
    avatars.push(custom ? (b.icon || '🤖') : tpl.icon);
    kinds.push(`${custom ? 'custom' : b.kind}.${b.level}`);
  }
  const settings = { rulesetId: setup.ruleset.id, ruleset: setup.builtin ? undefined : setup.ruleset, skin: undefined, avatars, names };
  const random = setup.random === 'crypto' ? { kind: 'crypto' } : { kind: 'seeded', seed: setup.seed };
  return { settings, options: { seats: n, seat: 0, names, bots, random, botDelay: botDelayOf(S.speed) }, kinds, avatars };
}

// --- text of the moves ------------------------------------------------------------------------------------------

// Public log entries are compact arrays [op, seat, ...]: L lead, + throw-in, B beat, T transfer (e[3] = shown trump
// instead of laid), X take, P pass, S trump swap, / bout end (e[1] truthy = taken), D draw (count only: drawn cards
// are private), O player out, E end. Cards are uids resolved through the compiled ruleset (uid -> def).
export function moveText(rs, e, names) {
  const C = compile(rs);
  const cards = (us) => us.map((u) => cardText(rs, C.defs[C.uidDef[u]])).join(' ');
  const nm = (i) => names[i] || t('tb.player', { n: i + 1 });
  switch (e[0]) {
    case 'L': return t('mv.lead', { name: nm(e[1]), cards: cards(e[2]) });
    case '+': return t('mv.throw', { name: nm(e[1]), cards: cards(e[2]) });
    case 'B': return t('mv.beat', { name: nm(e[1]), card: cards([e[2]]) });
    case 'T': return e[3] ? t('mv.show', { name: nm(e[1]), card: cards(e[2]) }) : t('mv.transfer', { name: nm(e[1]), cards: cards(e[2]) });
    case 'X': return t('mv.take', { name: nm(e[1]) });
    case 'P': return t('mv.pass', { name: nm(e[1]) });
    case 'S': return t('mv.swap', { name: nm(e[1]), card: cards([e[2]]) });
    case '/': return e[1] ? t('mv.took', { name: nm(e[2]) }) : t('mv.beaten');
    case 'D': return e[2] ? t('mv.draw', { name: nm(e[1]), n: e[2] }) : '';
    case 'O': return t('mv.out', { name: nm(e[1]) });
    case 'E': return t('mv.end');
    default: return '';
  }
}

// --- a session --------------------------------------------------------------------------------------------------

export function startSession(main, o) {
  const S = store.settings;
  const room = o.room;
  let mySeat = o.mySeat ?? room.seat ?? 0;
  let names = o.names || [];
  let avatars = o.avatars || [];
  let kinds = o.kinds || [];
  let rs = rulesetOf(room.settings || {});
  let lastView = null, timer = null, timerStart = 0, timerSeat = -1, ended = false, logOpen = false, chatOpen = false;
  const gameCounters = newCounters();
  const chatLines = [];
  setSound(S.sound, S.volume);
  document.body.classList.add('dk-playing');

  const wrap = h('div', { class: 'dk-session' });
  main.append(wrap);
  const drawer = h('aside', { class: 'dk-drawer', 'aria-label': t('tb.log') });
  wrap.append(drawer);
  const tb = createTable(wrap, {
    act: async (action) => {
      const v = lastView;
      const r = await room.act(action);
      if (r && r.ok && v && mySeat >= 0) {
        try { observe(store.profile.counters, v, mySeat, action); observe(gameCounters, v, mySeat, action); } catch { /* analysis is optional */ }
      }
      return r;
    },
    onButton,
    cardInfo,
    seatInfo,
  });

  function title() { return rulesetName(rs); }
  // Render options, recomputed per update because players can join, leave or rename online. Online names always come
  // from the room (authoritative); local names from the setup. bots: room player flags followed by the setup kinds -
  // the second half only matters when room.players is empty (indices past n are never read otherwise).
  function opts() {
    const players = room.players || [];
    const nm = names.slice();
    players.forEach((p) => { if (p && p.name && !nm[p.seat]) nm[p.seat] = p.name; });
    if (o.online) players.forEach((p) => { if (p && p.name) nm[p.seat] = p.name; });
    // Online seats: a bot shows its template's icon, a person the initial of the name.
    const av = o.online ? players.map((p) => (p && p.bot ? (templateById(p.bot)?.icon || '🤖') : p && p.name ? (p.seat === mySeat ? S.avatar || '🙂' : p.name.trim().charAt(0).toUpperCase() || '🙂') : '·')) : (room.settings && room.settings.avatars) || avatars;
    return {
      seat: mySeat, players, skin: skinOf(S, room.settings && room.settings.skin), hints: S.hints, motion: S.motion,
      names: nm, avatars: av, bots: players.map((p) => !!(p && p.bot)).concat(kinds.map((k) => !!k)), title: title(), online: !!o.online,
    };
  }

  // hydrate() turns the wire view into the engine view; if it fails, the ruleset probably changed (room settings
  // event raced the view), so the ruleset is re-read and hydration retried once. The end dialog is delayed 900ms so
  // the last card animation finishes; `ended` guards against opening it twice for repeated 'over' views and is reset
  // when a new game starts.
  function render(view) {
    if (!view) return;
    let v;
    try { v = hydrate(view); } catch { rs = rulesetOf(room.settings || {}); v = hydrate(view); }
    lastView = v;
    tb.update(v, opts());
    if (logOpen) renderLog();
    armTimer(v);
    if (v.phase === 'over' && !ended) { ended = true; setTimeout(() => finish(v), 900); }
    if (v.phase !== 'over') ended = false;
  }

  // Every room.on returns an unsubscribe function; close() calls them all so a finished session leaves no listeners
  // on a room object that may outlive it (online client reconnects).
  const offs = [
    room.on('view', render),
    room.on('players', () => { if (lastView) tb.update(lastView, opts()); }),
    room.on('settings', (st) => { rs = rulesetOf(st || {}); if (lastView) tb.update(lastView, opts()); }),
    room.on('chat', (m) => onChat(m)),
    room.on('error', (e) => { if (e && e.message && (e.seat == null || e.seat === mySeat)) toast(String(e.message), 'warn'); }),
    room.on('connection', (c) => { wrap.dataset.conn = c; if (c === 'retrying') toast(t('on.reconnecting'), 'warn'); }),
    room.on('status', (st) => { if (st && st.status === 'playing' && lastView && lastView.phase === 'over') { ended = false; } }),
  ];
  if (room.view) render(room.view);

  // --- timer ----------------------------------------------------------------------------------------------------
  // Turn timer (client-side, only for our own seat): a 250ms setTimeout loop on performance.now() - monotonic, so
  // system clock changes cannot stretch a turn, and drift between ticks does not accumulate. Re-arming is skipped while
  // it already runs for us (views arrive several times per turn). In the last quarter it ticks about once per second
  // (round(f x secs x 4) % 4 === 0 at 4 ticks/s). On expiry autoMove picks the safest legal action: take if defending,
  // pass if throwing in, else the fast bot policy, else the first legal action.
  function armTimer(v) {
    const secs = +S.timer || 0;
    const waiting = v.phase !== 'over' && mySeat >= 0 && v.turn === mySeat;
    if (!secs || !waiting) { stopTimer(); return; }
    if (timer && timerSeat === mySeat) return;
    stopTimer();
    timerSeat = mySeat;
    timerStart = performance.now();
    const tick = () => {
      const f = 1 - (performance.now() - timerStart) / (secs * 1000);
      tb.setTimer(mySeat, Math.max(0, f));
      if (f <= 0) { stopTimer(); autoMove(); return; }
      if (f < 0.25 && Math.round(f * secs * 4) % 4 === 0) play('tick');
      timer = setTimeout(tick, 250);
    };
    tick();
  }
  function stopTimer() { if (timer) clearTimeout(timer); timer = null; timerSeat = -1; tb.setTimer(null, null); }
  async function autoMove() {
    const v = lastView;
    if (!v || v.turn !== mySeat) return;
    let a = null;
    if (v.phase === 'bout' && v.defender === mySeat && !v.taking && unbeaten(v) > 0) a = { type: 'take' };
    else if (v.phase === 'bout' && throwers(v).includes(mySeat) && !hasPassed(v, mySeat)) a = { type: 'pass' };
    else a = fastPolicy({ ...v, hands: v.hands }, mySeat, null) || legalActions(v, mySeat)[0];
    if (a) { toast(t('tb.timeUp'), 'info'); await room.act(a); }
  }

  // --- buttons, dialogs ---------------------------------------------------------------------------------------------
  function onButton(name) {
    if (name === 'menu') return menu();
    if (name === 'log') { logOpen = !logOpen; chatOpen = false; renderLog(); return; }
    if (name === 'chat') { chatOpen = !chatOpen; logOpen = false; renderChat(); return; }
    if (name === 'settings') return o.openSettings?.(() => { setSound(S.sound, S.volume); if (lastView) tb.update(lastView, opts()); });
    if (name === 'again') return rematch();
    if (name === 'review') return review();
  }

  // Online, only the room owner may restart (null items are dropped by openMenu).
  function menu() {
    const items = [
      { label: t('gm.rules'), icon: 'info', action: rules },
      { label: t('gm.log'), icon: 'list', action: () => onButton('log') },
      { label: t('gm.copyDgn'), icon: 'copy', action: () => copyText(dgn()) },
      { label: t('gm.settings'), icon: 'settings', action: () => onButton('settings') },
      { sep: true },
      !o.online || (room.info && room.info.owner === mySeat) ? { label: t('gm.restart'), icon: 'undo', action: restart } : null,
      { label: o.online ? t('gm.leaveRoom') : t('gm.leave'), icon: 'close', danger: true, action: leave },
    ];
    openMenu(tb.el.querySelector('[data-b="menu"]'), items);
  }

  async function restart() {
    if (lastView && lastView.phase !== 'over' && !(await confirmDialog(t('gm.restart'), t('gm.restartQ'), t('gm.restart')))) return;
    ended = false;
    const r = await room.start();
    if (r && r.ok === false) toast(r.error || t('err.generic', { msg: '' }), 'warn');
  }
  async function rematch() { ended = false; const r = await room.start(); if (r && r.ok === false) toast(t('on.ownerStarts'), 'info'); }

  async function leave() {
    if (lastView && lastView.phase !== 'over' && !(await confirmDialog(t('gm.leave'), t('gm.leaveQ'), t('gm.leave'), true))) return;
    close();
  }

  function close() {
    stopTimer();
    for (const f of offs) try { f(); } catch { /* ignore */ }
    try { room.leave(); } catch { /* ignore */ }
    tb.destroy();
    wrap.remove();
    document.body.classList.remove('dk-playing');
    o.onExit?.();
  }

  function rules() {
    openDialog({ title: rulesetName(rs), body: o.rulesBody(rs), wide: true });
  }

  // Card details: how many of the deck's N cards it beats / is beaten by under the current trump (computed by the
  // engine, so custom beat rules are included). The picture is copied from the card already on the table (same skin).
  function cardInfo(u) {
    const v = lastView;
    if (!v) return;
    const d = describeCard(v.rs, v.trumpSuit, u);
    const C = compile(v.rs);
    const lines = [
      h('div', { class: 'dk-cardinfo-card', html: '' }),
      h('p', {}, d.trump ? t('ci.trump', { tier: d.tier }) : t('ci.plain')),
      h('p', {}, t('ci.beats', { n: d.beats, total: C.N })),
      h('p', {}, t('ci.beatenBy', { n: d.beatenBy, total: C.N })),
      d.wild ? h('p', {}, t('ci.wild.' + d.wild)) : null,
      d.rules.rankAs.length ? h('p', {}, t('ci.rankAs', { ranks: d.rules.rankAs.join(', ') })) : null,
      ...['noLead', 'noThrow', 'noTransfer', 'noDefend', 'closesBout'].filter((k) => d.rules[k]).map((k) => h('p', {}, t('ci.' + k))),
      d.def.note ? h('p', { class: 'ed-muted' }, textOf(d.def.note)) : null,
    ];
    const card = tb.el.querySelector(`.dk-card[data-u="${u}"]`);
    if (card) lines[0].innerHTML = card.innerHTML;
    openDialog({ title: d.def.name ? pickUI(d.def.name) + ' · ' + d.text : d.text, body: h('div', { class: 'dk-cardinfo' }, lines) });
  }

  function seatInfo(i) {
    const p = (room.players || [])[i];
    const kind = kinds[i] || (p && p.bot ? p.bot : null);
    o.botInfo?.(kind, names[i] || (p && p.name));
  }

  // --- log and chat ---------------------------------------------------------------------------------------------------
  // Log and chat share one drawer; opening one closes the other. Rebuilt on each view while open; scrolled to the end
  // in the next frame (after layout, so scrollHeight is final). Chat text is inserted as text nodes by h(), never
  // as HTML: chat comes from other players.
  function renderLog() {
    drawer.classList.toggle('dk-open', logOpen || chatOpen);
    if (!logOpen) return;
    const v = lastView;
    drawer.textContent = '';
    const head = h('div', { class: 'dk-drawer-h' }, h('b', {}, t('tb.log')), h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('dlg.close'), onclick: () => { logOpen = false; renderLog(); } }, iconEl('close')));
    const list = h('ol', { class: 'dk-loglist' });
    if (v) {
      const nm = opts().names;
      let bout = 1;
      for (const e of v.log) {
        const txt = moveText(v.rs, e, nm);
        if (!txt) continue;
        list.append(h('li', { class: 'dk-lg-' + (e[0] === '/' ? 'end' : e[0] === 'D' ? 'draw' : 'move') }, txt));
        if (e[0] === '/') { bout++; list.append(h('li', { class: 'dk-lg-sep' }, t('tb.bout', { n: bout }))); }
      }
    }
    drawer.append(head, list);
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }

  function renderChat() {
    drawer.classList.toggle('dk-open', logOpen || chatOpen);
    if (!chatOpen) return;
    drawer.textContent = '';
    const head = h('div', { class: 'dk-drawer-h' }, h('b', {}, t('tb.chat')), h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('dlg.close'), onclick: () => { chatOpen = false; renderChat(); } }, iconEl('close')));
    const list = h('div', { class: 'dk-chatlist' }, chatLines.map((m) => h('div', { class: 'dk-chatline' }, h('b', {}, m.name + ': '), m.text)));
    const input = h('input', { class: 'ed-input', maxlength: '200', placeholder: t('tb.say'), 'aria-label': t('tb.say') });
    const sendText = () => { const s = input.value.trim(); if (s) { room.chat(s); input.value = ''; } };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendText(); });
    const emotes = h('div', { class: 'dk-emotes' }, EMOTES.map((em) => h('button', { type: 'button', class: 'dk-emote', onclick: () => room.chat(':e:' + em) }, em)));
    drawer.append(head, list, emotes, h('div', { class: 'dk-chatin' }, input, h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: sendText }, iconEl('send'))));
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  }

  function onChat(m) {
    if (!m) return;
    const emote = typeof m.text === 'string' && m.text.startsWith(':e:') ? m.text.slice(3) : null;
    tb.bubble(m.seat, emote || m.text, emote ? 'emote' : 'chat');
    if (!emote) chatLines.push(m);
    if (chatLines.length > 100) chatLines.shift();
    play('chat');
    if (chatOpen) renderChat();
  }

  // --- the end ----------------------------------------------------------------------------------------------------------
  // DGN record of the game. With a seed the deal is reproducible, so only the seed is stored; otherwise (crypto
  // random) the full deal is embedded when the view exposes it.
  function dgn() {
    const v = lastView;
    if (!v) return '';
    const nm = opts().names;
    return encode(v, { names: nm, bots: kinds, seed: v.seed || null, deal: !v.seed && !!v.deal, date: new Date().toISOString().slice(0, 10) });
  }

  // End of game: sound, profile update (summary, new achievements, last 300 games kept), replay saved, result dialog.
  // Spectators (mySeat < 0) get no profile changes. Team games: "won" means not among the losers.
  function finish(v) {
    stopTimer();
    const r = v.result;
    if (!r) return;
    const won = mySeat >= 0 && !r.draw && !r.losers.includes(mySeat);
    play(r.draw ? 'shuffle' : won ? 'win' : mySeat >= 0 ? 'lose' : 'shuffle');
    // profile: summary, achievements, replay
    let fresh = [];
    if (mySeat >= 0) {
      const sm = gameSummary(v.log, mySeat, r, v.rs, {
        rulesetId: v.rs.id, exclusive: !!v.rs.exclusive, teams: !!v.rs.rules.teams, players: v.n, trumpSuit: v.trumpSuit, seeded: !!v.seed,
        opponents: kinds.map((k) => (k ? { kind: k.split('.')[0], level: +k.split('.')[1] } : null)).filter(Boolean), online: !!o.online,
      });
      const P = store.profile;
      fresh = newAchievements(P.games, sm, P.achievements.map((a) => a.id));
      for (const id of fresh) P.achievements.push({ id, at: Date.now() });
      P.games.push({ ...sm, at: Date.now() });
      P.games = P.games.slice(-300);
      P.lastGame = mergeCounters(newCounters(), gameCounters);
      save('profile');
    }
    const text = dgn();
    addReplay({ dgn: text, title: rulesetName(v.rs), result: r.draw ? '=' : (opts().names[r.durak] || '?'), won, players: v.n });
    const nm = opts().names;
    const places = h('ol', { class: 'dk-places' }, r.places.map((i) => h('li', { class: r.losers.includes(i) ? 'dk-lost' : 'dk-won' }, h('span', {}, (opts().avatars[i] || '') + ' ' + nm[i]), r.durak === i ? h('b', {}, ' — ' + t('tb.durak')) : null)));
    const ach = fresh.length ? h('div', { class: 'dk-ach-new' }, h('h3', {}, t('pf.newAch')), fresh.map((id) => { const a = ACHIEVEMENTS.find((x) => x.id === id); return h('div', { class: 'dk-ach' }, h('span', { class: 'dk-ach-i' }, a ? a.icon : '★'), h('div', {}, h('b', {}, t('ach.' + id)), h('div', { class: 'ed-muted' }, t('ach.' + id + '.d')))); })) : null;
    const head = r.draw ? t('st.draw') : mySeat < 0 ? t('st.durakIs', { name: nm[r.durak] }) : won ? t('end.won') : r.durak === mySeat ? t('end.durak') : t('end.teamLost');
    const pog = r.pogony ? h('p', {}, t('end.pogony', { n: r.pogony })) : null;
    openDialog({
      title: head,
      className: 'dk-enddlg' + (won ? ' dk-win' : ''),
      body: h('div', {}, h('div', { class: 'dk-endicon' }, r.draw ? '🤝' : won ? '🏆' : '🃏'), places, pog, ach,
        h('p', { class: 'ed-muted' }, t('end.bouts', { n: r.bouts }))),
      buttons: [
        { label: t('end.replay'), value: 'replay' },
        { label: t('end.copy'), value: 'copy' },
        { label: t('end.again'), value: 'again', primary: true },
      ],
    }).then((v2) => {
      if (v2 === 'again') rematch();
      else if (v2 === 'copy') copyText(text);
      else if (v2 === 'replay') o.openReplay?.(text);
    });
  }

  function review() { o.openReplay?.(dgn()); }

  return { close, get view() { return lastView; }, table: tb };
}

export { botLabel };
