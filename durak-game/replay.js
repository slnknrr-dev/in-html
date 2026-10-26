// durak-game/replay.js - the replay viewer of DGN records: paste or open a record, step through it on the table (all
// hands open when the record carries the seed or the deal, otherwise only what everybody saw), the move list, and the
// entropy of the public course: the hidden-information curve and the bits of every decision (durak/notation.js).
//
//   renderReplays(main, { text?, onBack, rulesBody, extra }) -> element

import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { toast } from '../ui/overlays.js';
import { copyText } from '../ui/app.js';
import { parse, replay } from '../durak/notation.js';
import { viewOf } from '../durak/engine.js';
import { createTable } from './table.js';
import { skinOf } from './skins.js';
import { store, save } from './store.js';
import { moveText } from './play.js';
import { rulesetName, botLabel } from './names.js';

// Design: a replay is a list of frames (state after each token) produced by durak/notation.js replay(); the viewer
// only indexes into it, so seeking is O(1) and any position can be shown without re-simulating. The live table
// renderer is reused with a no-op act() and seat -1 (spectator), so the replay looks exactly like play.
// Hidden information: a record with seed or deal reconstructs every hand; a public-only record can show only what
// all players saw, so the "show hands" toggle exists only for full records. User rulesets are passed as `extra` so
// records of custom rulesets resolve.
export function renderReplays(main, { text = '', onBack, extra = [] }) {
  const root = h('section', { class: 'dk-replays dk-screen' });
  main.append(root);
  let R = null, P = null, idx = 0, open = true, playing = null, tb = null;

  const input = h('textarea', { class: 'ed-input ap-mono dk-dgnin', rows: '3', spellcheck: 'false', placeholder: 'DGN1;r=…', 'aria-label': t('rp.paste') }, text);
  const msg = h('p', { class: 'ed-hint' });
  const stage = h('div', { class: 'dk-rp-stage' });
  const side = h('div', { class: 'dk-rp-side' });
  const controls = h('div', { class: 'dk-rp-controls' });
  const saved = h('div', { class: 'dk-rp-saved' });

  root.append(
    h('div', { class: 'dk-screen-h' },
      h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('nav.back'), onclick: () => { stop(); tb?.destroy(); onBack(); } }, iconEl('parent')),
      h('h2', {}, t('rp.title'))),
    h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('rp.record')), input,
      h('div', { class: 'ap-actions' },
        h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: () => load(input.value) }, iconEl('eye'), t('rp.open')),
        h('button', { type: 'button', class: 'ed-btn', onclick: async () => { try { input.value = await navigator.clipboard.readText(); load(input.value); } catch { toast(t('rp.noClipboard'), 'warn'); } } }, iconEl('paste'), t('rp.pasteBtn'))),
      msg),
    h('div', { class: 'dk-rp-main' }, h('div', { class: 'dk-rp-left' }, stage, controls), side),
    h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('rp.saved')), saved));

  function renderSaved() {
    saved.textContent = '';
    if (!store.replays.length) { saved.append(h('p', { class: 'ap-empty' }, t('rp.none'))); return; }
    const list = h('div', { class: 'dk-rp-list' });
    store.replays.forEach((r, i) => list.append(h('div', { class: 'dk-rp-item' },
      h('button', { type: 'button', class: 'dk-rp-open', onclick: () => { input.value = r.dgn; load(r.dgn); root.scrollIntoView({ behavior: 'smooth' }); } },
        h('span', { class: 'dk-rp-res' }, r.won ? '🏆' : r.result === '=' ? '🤝' : '🃏'),
        h('b', {}, r.title), h('span', { class: 'ed-muted' }, new Date(r.at).toLocaleString())),
      h('button', { type: 'button', class: 'ed-iconbtn', title: t('rp.copy'), 'aria-label': t('rp.copy'), onclick: () => copyText(r.dgn) }, iconEl('copy')),
      h('button', { type: 'button', class: 'ed-iconbtn', title: t('rp.delete'), 'aria-label': t('rp.delete'), onclick: () => { store.replays.splice(i, 1); save('replays'); renderSaved(); } }, iconEl('trash')))));
    saved.append(list);
  }
  renderSaved();

  // Parse errors stop; a replay error after some frames still shows the playable prefix (r.ok false, frames > 0) with
  // a warning - a truncated or partly incompatible record is more useful partially than not at all. Opens at the end.
  function load(txt) {
    stop();
    const p = parse(txt);
    if (!p.ok) { msg.textContent = t('rp.bad', { msg: p.error }); msg.className = 'ed-hint ed-error'; return; }
    const r = replay(p, { extra: [...store.rulesets, ...extra] });
    P = p; R = r;
    if (!r.frames.length) { msg.textContent = t('rp.bad', { msg: r.error }); msg.className = 'ed-hint ed-error'; return; }
    msg.className = 'ed-hint' + (r.ok ? '' : ' ed-error');
    msg.textContent = r.ok ? (r.public ? t('rp.public') : t('rp.full')) : t('rp.partial', { msg: r.error });
    open = !r.public;
    idx = r.frames.length - 1;
    if (!tb) tb = createTable(stage, { act: async () => ({ ok: false }), onButton: (b) => { if (b === 'log') side.scrollIntoView({ behavior: 'smooth' }); }, cardInfo: () => {} });
    tb.el.classList.add('dk-replaytable');
    show();
  }

  function show() {
    if (!R) return;
    const f = R.frames[idx];
    const st = f.state;
    const v = viewOf(st, -1);
    if (open) v.hands = st.hands.map((x) => x.slice());
    const names = P.names.length ? P.names : [];
    tb.update(v, { seat: -1, skin: skinOf(store.settings), hints: false, motion: store.settings.motion, openHands: open, names, bots: P.bots.map(Boolean), avatars: P.bots.map((b) => (b ? '🤖' : '🙂')), title: rulesetName(R.rs) });
    renderControls();
    renderSide();
  }

  function stop() { if (playing) clearInterval(playing); playing = null; }
  function step(d) { if (!R) return; idx = Math.max(0, Math.min(R.frames.length - 1, idx + d)); show(); }

  // Transport controls rebuilt on each frame (the play/pause icon and position change). Autoplay is a 650ms interval
  // that stops itself at the last frame; any manual navigation stops it first.
  function renderControls() {
    controls.textContent = '';
    const n = R.frames.length - 1;
    const slider = h('input', { type: 'range', class: 'ed-range dk-rp-slider', min: '0', max: String(n), value: String(idx), 'aria-label': t('rp.position') });
    slider.addEventListener('input', () => { idx = +slider.value; show(); });
    const b = (ic, label, fn, on = false) => h('button', { type: 'button', class: 'ed-iconbtn' + (on ? ' ed-on' : ''), title: label, 'aria-label': label, onclick: fn }, typeof ic === 'string' && ic.length > 2 ? iconEl(ic) : h('span', { class: 'dk-ctl' }, ic));
    controls.append(...[
      b('⏮', t('rp.start'), () => { stop(); idx = 0; show(); }),
      b('◀', t('rp.prev'), () => { stop(); step(-1); }),
      b(playing ? '⏸' : '▶', playing ? t('rp.pause') : t('rp.play'), () => {
        if (playing) { stop(); renderControls(); return; }
        if (idx >= n) idx = 0;
        playing = setInterval(() => { if (idx >= R.frames.length - 1) { stop(); renderControls(); return; } step(1); }, 650);
        renderControls();
      }, !!playing),
      b('▶|', t('rp.next'), () => { stop(); step(1); }),
      b('⏭', t('rp.end'), () => { stop(); idx = n; show(); }),
      slider,
      h('span', { class: 'dk-rp-pos' }, `${idx} / ${n}`),
      R.public ? null : h('label', { class: 'dk-rp-open-l' }, h('input', { type: 'checkbox', checked: open, onchange: (e) => { open = e.target.checked; show(); } }), t('rp.showHands')),
      b('copy', t('rp.copy'), () => copyText(input.value.trim()))].filter(Boolean));
  }

  function renderSide() {
    side.textContent = '';
    const E = R.entropy;
    const names = P.names;
    const players = h('ul', { class: 'dk-rp-players' }, Array.from({ length: P.n }, (_, i) => h('li', {},
      h('b', {}, names[i] || t('tb.player', { n: i + 1 })), P.bots[i] ? h('span', { class: 'ed-muted' }, ' · ' + botLabel(P.bots[i])) : null,
      h('span', { class: 'dk-rp-bits' }, t('rp.seatBits', { n: E.perSeat[i].toFixed(1) })))));
    const res = R.result || P.result;
    side.append(
      h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, rulesetName(R.rs)),
        players,
        res ? h('p', {}, res.draw ? t('st.draw') : t('st.durakIs', { name: names[res.durak] || '?' })) : null,
        P.seed ? h('p', { class: 'ed-muted' }, t('rp.seed', { seed: P.seed })) : null),
      h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('rp.entropy')),
        chart(R, idx, (i) => { stop(); idx = i; show(); }),
        h('dl', { class: 'ap-kv' },
          h('dt', {}, t('rp.course')), h('dd', {}, t('rp.bits', { n: E.course.toFixed(1) })),
          h('dt', {}, t('rp.perDecision')), h('dd', {}, t('rp.bits', { n: E.perDecision.toFixed(2) }) + ` (${E.decisions})`),
          h('dt', {}, t('rp.hiddenStart')), h('dd', {}, t('rp.bits', { n: E.hiddenStart.toFixed(1) })),
          h('dt', {}, t('rp.hiddenNow')), h('dd', {}, t('rp.bits', { n: R.frames[idx].hidden.toFixed(1) })),
          h('dt', {}, t('rp.openness')), h('dd', {}, Math.round(E.openness * 100) + '%')),
        h('details', {}, h('summary', {}, t('rp.whatIs')), h('p', { class: 'ed-hint' }, t('rp.courseExplain')), h('p', { class: 'ed-hint' }, t('rp.hiddenExplain')))),
      h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('rp.moves')), moveList()));
  }

  function moveList() {
    const ol = h('ol', { class: 'dk-rp-moves' });
    const st = R.frames[R.frames.length - 1].state;
    // frames[i] follows token i - 1
    R.frames.forEach((f, i) => {
      if (!i) return;
      const tok = f.token;
      const li = h('li', { class: i === idx ? 'dk-on' : '', onclick: () => { stop(); idx = i; show(); } },
        h('code', {}, tok), h('span', {}, ' ' + framesText(i)), f.bits ? h('small', { class: 'ed-muted' }, ` ${f.bits.toFixed(1)} b`) : null);
      ol.append(li);
    });
    requestAnimationFrame(() => { const on = ol.querySelector('.dk-on'); if (on) on.scrollIntoView({ block: 'nearest' }); });
    return ol;
    // the log entries between frame i - 1 and frame i, as text
    function framesText(i) {
      const a = R.frames[i - 1].state.log.length, b = R.frames[i].state.log.length;
      return st.log.slice(a, b).map((e) => moveText(R.rs, e, P.names)).filter(Boolean).join(' · ');
    }
  }

  if (text) load(text);
  return root;
}

// Hidden entropy (line) and the bits of every decision (bars) along the record.
// Two independent y scales: the line uses the full height (max hidden bits), bars at most 45 % so they do not hide
// the line. Built as an SVG string; the aria-label strips '"', '<', '&' from the translation instead of escaping.
// Click maps clientX back through the viewBox scale to the nearest frame index.
function chart(R, at, onPick) {
  const W = 320, H = 120, pad = 6;
  const hs = R.entropy.series, bs = R.entropy.bitsSeries;
  const n = Math.max(1, hs.length - 1);
  const maxH = Math.max(1, ...hs), maxB = Math.max(1, ...bs);
  const x = (i) => pad + (i / n) * (W - 2 * pad);
  const yH = (v) => H - pad - (v / maxH) * (H - 2 * pad);
  const yB = (v) => H - pad - (v / maxB) * (H * 0.45);
  let bars = '';
  bs.forEach((b, i) => { if (b > 0) bars += `<rect x="${(x(i) - 0.9).toFixed(1)}" y="${yB(b).toFixed(1)}" width="1.8" height="${(H - pad - yB(b)).toFixed(1)}" class="dk-ch-bar"/>`; });
  const line = hs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${yH(v).toFixed(1)}`).join('');
  const svg = h('div', { html: `<svg class="dk-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('rp.chart').replace(/["<&]/g, '')}">${bars}<path d="${line}" class="dk-ch-line"/><line x1="${x(at)}" x2="${x(at)}" y1="0" y2="${H}" class="dk-ch-at"/></svg>` }).firstElementChild;
  svg.addEventListener('click', (e) => {
    const r = svg.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width * W - pad) / (W - 2 * pad) * n);
    onPick(Math.max(0, Math.min(n, i)));
  });
  return h('div', { class: 'dk-chartbox' }, svg, h('div', { class: 'dk-ch-legend' }, h('span', { class: 'dk-lg-line' }, t('rp.legendHidden', { n: maxH.toFixed(0) })), h('span', { class: 'dk-lg-bar' }, t('rp.legendBits'))));
}
