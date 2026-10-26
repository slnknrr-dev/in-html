// sudoku-game/home.js - the home screen: the game in progress, today's puzzle, the catalogue of variants (cards with
// example pictures in the current skin, filters by kind, rules), the options of a new game (size, boxes, difficulty,
// symmetry, extra rules, symbols, secure random or a seed) and the ways to play (alone, against bots, online).
//
//   renderHome()

//
// Rendering model: renderHome() rebuilds the whole screen on every option change. State lives in prefs().setup (and
// two module flags), never in the DOM, so a rebuild is always consistent and the chosen options survive reloads.
// Thumbnails are the expensive part; they are cached in pictures.js, so a rebuild redraws them from cache.
import { $, h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { toast } from '../ui/overlays.js';
import { randomSeed } from '../prng/prng.js';
import { MAX_N, MIN_N, boxShapes } from '../sudoku/geometry.js';
import { ALPHABETS, parseCustom } from '../sudoku/symbols.js';
import { decodePuzzle } from '../sudoku/codec.js';
import { variant as variantOf, EXTRA_RULES, sizeProblem } from '../sudoku/variants.js';
import { difficultiesFor, normalize } from '../sudoku/generate.js';
import { dailyDone, loadSave, prefs, setPrefs } from './store.js';
import { ENV, GROUPS, SYMMETRIES, dailyGame, fmtTime, gameTitle, sizeLabel, sizesFor, symbolsOf, today, variantName, variantsOf } from './common.js';
import { cachedExample, loadExamples, picture } from './pictures.js';
import { APP } from './shell.js';

let group = 'all';
let customOpen = false; // the custom size field is shown
// Puzzles that can take a minute to make: expert and extreme from 12 × 12, medium and hard above 25 × 25.
// Heuristic thresholds measured on the generator: used only to show a "this may take a while" hint.
const SLOW = (o) => (o.n >= 12 && ['expert', 'extreme'].includes(o.difficulty)) || (o.n > 25 && o.difficulty !== 'easy');

// The setup of a new game from the preferences, made valid (variant, size, box, difficulty, rules).
// Stored setup may be stale (variant removed, size no longer allowed, rule clash): repair step by step and fall back
// to the bare variant if normalize still throws, so the Play button always works.
export function currentSetup() {
  const s = prefs().setup;
  const v = variantOf(s.variant) ? s.variant : 'classic';
  const sizes = sizesFor(v);
  const n = sizes.includes(+s.n) || !sizeProblem(v, +s.n) ? +s.n : sizes.includes(9) ? 9 : sizes[0];
  let o;
  try { o = normalize({ variant: v, n, box: s.box, difficulty: s.difficulty, symmetry: s.symmetry, rules: s.rules }); } catch {
    o = normalize({ variant: v, n, difficulty: s.difficulty });
  }
  return { options: o, random: s.random === 'seeded' ? { kind: 'seeded', seed: s.seed || randomSeed() } : { kind: 'crypto' }, randomKind: s.random === 'seeded' ? 'seeded' : 'crypto', seed: s.seed || '' };
}

function saveSetup(patch) {
  const s = { ...prefs().setup, ...patch };
  setPrefs({ setup: s });
}

export function renderHome() {
  const main = APP.main();
  main.textContent = '';
  const page = h('div', { class: 'sg-home' });
  page.append(...[hero(), continueCard(), dailyCard(), newGame(), online(), footer()].filter(Boolean));
  main.append(page);
  fillExamples();
}

// --- hero ---------------------------------------------------------------------------------------------------------------------

function hero() {
  const skins = h('div', { class: 'sg-skins', role: 'radiogroup', 'aria-label': t('sg.skin') },
    ['flat', 'paper', 'wood', 'pastel', 'neon', 'contrast'].map((k) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(prefs().skin === k), class: 'sg-skin sg-skin-' + k + (prefs().skin === k ? ' sg-on' : ''),
      title: t('sg.skin.' + k), 'aria-label': t('sg.skin.' + k), onclick: () => { APP.setSkin(k); renderHome(); },
    }, h('span', { class: 'sg-skin-sw' }, h('i'), h('i'), h('i')))));
  return h('section', { class: 'sg-hero' },
    h('div', { class: 'sg-hero-logo', html: LOGO_SVG }),
    h('div', { class: 'sg-hero-text' },
      h('h1', { class: 'sg-hero-t' }, t('sg.name')),
      h('p', { class: 'sg-hero-sub' }, t('sg.tagline'))),
    skins);
}

const LOGO_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="3" y="3" width="42" height="42" rx="9" class="sg-logo-bg"/><path d="M17 4v40M31 4v40M4 17h40M4 31h40" class="sg-logo-l"/><text x="10" y="15" class="sg-logo-d">1</text><text x="38" y="29" class="sg-logo-d">5</text><text x="24" y="43" class="sg-logo-d sg-logo-a">9</text><circle cx="24" cy="24" r="5" class="sg-logo-c"/></svg>';

// --- the game in progress -----------------------------------------------------------------------------------------------------

function continueCard() {
  const s = loadSave();
  if (!s) return null;
  let p;
  try { p = decodePuzzle(s.code); } catch { return null; }
  const pic = h('div', { class: 'sg-cont-pic', html: picture(p, symbolsOf(p.n), { values: s.board && s.board.values }) });
  return h('section', { class: 'sg-card sg-continue' },
    pic,
    h('div', { class: 'sg-cont-body' },
      h('div', { class: 'sg-card-kicker' }, t('sg.inProgress')),
      h('div', { class: 'sg-card-t' }, gameTitle(p)),
      h('div', { class: 'sg-muted' }, t('sg.timeIs', { time: fmtTime(s.elapsed || 0) }), s.daily ? ' · ' + t('sg.daily') : ''),
      h('div', { class: 'sg-row' }, h('button', { type: 'button', class: 'ed-btn ed-primary sg-big', onclick: () => APP.resume() }, iconEl('play'), t('sg.continue')))));
}

function dailyCard() {
  const d = today();
  const g = dailyGame(d);
  const done = dailyDone(d);
  return h('section', { class: 'sg-card sg-daily' },
    h('div', { class: 'sg-daily-ic' }, iconEl('calendar')),
    h('div', { class: 'sg-cont-body' },
      h('div', { class: 'sg-card-kicker' }, t('sg.daily'), ' · ', new Date(d + 'T12:00:00').toLocaleDateString(document.documentElement.lang || undefined, { day: 'numeric', month: 'long' })),
      h('div', { class: 'sg-card-t' }, variantName(g.options.variant), ' · ', t('sg.d.' + g.options.difficulty)),
      done != null ? h('div', { class: 'sg-ok' }, iconEl('check'), t('sg.dailyDone', { time: fmtTime(done) })) : h('div', { class: 'sg-muted' }, t('sg.dailySub'))),
    h('button', { type: 'button', class: 'ed-btn' + (done != null ? '' : ' ed-primary'), onclick: () => APP.play(g) }, iconEl('play'), t(done != null ? 'sg.playAgain' : 'sg.play')));
}

// --- new game -----------------------------------------------------------------------------------------------------------------

// Variant filter chips are role=tab with aria-selected (they switch the catalogue view). Each card has two buttons:
// the card itself (select, aria-pressed) and an info button (rules); nesting buttons would be invalid HTML, so they
// are siblings positioned over each other in CSS.
function newGame() {
  const setup = currentSetup();
  const sec = h('section', { class: 'sg-new' });
  const chips = h('div', { class: 'sg-chips', role: 'tablist', 'aria-label': t('sg.kinds') },
    ['all', ...GROUPS].map((g) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(group === g), class: 'sg-chip' + (group === g ? ' sg-on' : ''), onclick: () => { group = g; renderHome(); } }, t('sg.g.' + g))));
  const grid = h('div', { class: 'sg-variants' });
  for (const v of variantsOf(group)) {
    const on = v.id === setup.options.variant;
    const card = h('div', { class: 'sg-vcard' + (on ? ' sg-on' : ''), dataset: { v: v.id } },
      h('button', { type: 'button', class: 'sg-vcard-main', 'aria-pressed': String(on), onclick: () => chooseVariant(v.id) },
        h('span', { class: 'sg-vpic', dataset: { pic: v.id } }, h('span', { class: 'sg-vpic-ph' })),
        h('span', { class: 'sg-vname' }, variantName(v.id))),
      h('button', { type: 'button', class: 'sg-vinfo', title: t('sg.rules'), 'aria-label': t('sg.rulesOf', { name: variantName(v.id) }), onclick: () => APP.rules(v.id) }, iconEl('info')));
    grid.append(card);
  }
  const opts = options(setup);
  // Phones: the chosen variant and Play stay at hand while the catalogue scrolls (hidden once the options show).
  const o = setup.options;
  const quick = h('div', { class: 'sg-quickbar' },
    h('button', { type: 'button', class: 'sg-quick-info', onclick: () => opts.scrollIntoView({ block: 'start', behavior: smooth() }) },
      h('b', {}, variantName(o.variant)), h('span', { class: 'sg-muted' }, `${o.n}×${o.n} · ${t('sg.d.' + o.difficulty)}`)),
    h('button', { type: 'button', class: 'ed-btn ed-primary sg-big', onclick: () => { const s = currentSetup(); APP.play({ options: s.options, random: s.random }); } }, iconEl('play'), t('sg.play')));
  sec.append(h('div', { class: 'sg-sec-head' }, h('h2', { class: 'sg-h2' }, t('sg.newGame')), h('span', { class: 'sg-muted' }, t('sg.variantsCount', { n: variantsOf('all').length }))), chips,
    h('div', { class: 'sg-new-body' }, grid, opts), quick);
  if (typeof IntersectionObserver !== 'undefined') {
    // The quick bar hides while the options card is on screen: two Play buttons in view would be redundant.
    new IntersectionObserver((entries) => { for (const e of entries) quick.classList.toggle('sg-hide', e.isIntersecting); }).observe(opts);
  }
  return sec;
}

// Smooth scrolling only when the user has not asked for reduced motion.
const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

// Changing the variant keeps the current size if the new variant accepts it, and keeps only the extra rules that
// stay valid for it (each rule tried alone through normalize).
function chooseVariant(id) {
  const s = prefs().setup;
  const sizes = sizesFor(id);
  const n = sizes.includes(+s.n) || !sizeProblem(id, +s.n) ? +s.n : sizes.includes(9) ? 9 : sizes[0];
  saveSetup({ variant: id, n, rules: (s.rules || []).filter((r) => { try { normalize({ variant: id, n, rules: [r] }); return true; } catch { return false; } }) });
  renderHome();
  requestAnimationFrame(() => $('.sg-options')?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
}

function fieldRow(label, control, hint) {
  return h('div', { class: 'sg-field' }, h('div', { class: 'sg-field-l' }, label), control, hint ? h('div', { class: 'sg-field-h' }, hint) : null);
}

function segOf(items, value, onPick, aria) {
  return h('div', { class: 'sg-seg', role: 'radiogroup', 'aria-label': aria },
    items.map(([v, label, title]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(v === value), class: 'sg-seg-b' + (v === value ? ' sg-on' : ''), title: title || null,
      onclick: () => onPick(v),
    }, label)));
}

// Only options that make sense for the variant are shown: no box shapes for jigsaw or multi-grid layouts, extra
// rules filtered to those that do not clash. Difficulty levels depend on size (difficultiesFor).
function options(setup) {
  const o = setup.options;
  const v = variantOf(o.variant);
  const box = h('div', { class: 'ap-card sg-options' });
  box.append(h('div', { class: 'sg-opt-head' }, h('div', { class: 'sg-opt-t' }, variantName(o.variant)), h('button', { type: 'button', class: 'sg-link', onclick: () => APP.rules(o.variant) }, t('sg.howItWorks'))));
  box.append(h('p', { class: 'sg-opt-sum' }, t('sg.vs.' + o.variant)));
  // size: the listed sizes, the last custom one and "Custom…" (a typed a or a×a)
  box.append(sizeField(o, v));
  // boxes
  if (!v.layout && v.shape !== 'jigsaw') {
    const shapes = boxShapes(o.n).filter((b) => v.supports({ n: o.n, box: b }));
    const items = shapes.map((b) => [b.join('x'), `${b[0]}×${b[1]}`, t('sg.boxWH', { w: b[0], h: b[1] })]);
    if (v.supports({ n: o.n, box: null })) items.push(['none', t('sg.noBoxes'), t('sg.noBoxesHint')]);
    if (items.length > 1) box.append(fieldRow(t('sg.boxes'), segOf(items, o.box ? o.box.join('x') : 'none', (k) => { saveSetup({ box: k === 'none' ? 'none' : k.split('x').map(Number) }); renderHome(); }, t('sg.boxes'))));
  }
  // difficulty
  const diffs = difficultiesFor(o.n);
  box.append(fieldRow(t('sg.difficulty'), segOf(diffs.map((d) => [d, t('sg.d.' + d), t('sg.dh.' + d)]), o.difficulty, (d) => { saveSetup({ difficulty: d }); renderHome(); }, t('sg.difficulty')),
    SLOW(o) ? t('sg.slowHint') : o.n > 31 ? t('sg.hugeHint') : o.n > 16 ? t('sg.bigHint') : null));
  // more options (collapsed on phones)
  const more = h('details', { class: 'sg-more', open: matchMedia('(min-width: 900px)').matches || null });
  more.append(h('summary', {}, iconEl('sliders'), t('sg.moreOptions')));
  const symSel = h('select', { class: 'ed-input ed-select', 'aria-label': t('sg.symmetry'), onchange: (e) => saveSetup({ symmetry: e.target.value }) },
    SYMMETRIES.map((s) => h('option', { value: s, selected: s === o.symmetry }, t('sg.sym.' + s))));
  more.append(fieldRow(t('sg.symmetry'), symSel));
  // extra rules that fit
        // Toggle is validated against the whole set before saving: two individually valid rules can clash together.
  const extras = EXTRA_RULES.filter((r) => !(v.rules || []).includes(r)).filter((r) => { try { normalize({ ...o, box: o.box || (v.layout || v.shape === 'jigsaw' ? null : 'none'), rules: [r] }); return true; } catch { return false; } });
  if (extras.length) {
    const chosen = new Set(o.rules);
    more.append(fieldRow(t('sg.extraRules'), h('div', { class: 'sg-chips sg-chips-sm' }, extras.map((r) => h('button', {
      type: 'button', class: 'sg-chip' + (chosen.has(r) ? ' sg-on' : ''), 'aria-pressed': String(chosen.has(r)), title: t('sg.vs.' + r),
      onclick: () => {
        const next = new Set(prefs().setup.rules || []);
        if (next.has(r)) next.delete(r); else next.add(r);
        try { normalize({ ...o, box: o.box || (v.layout || v.shape === 'jigsaw' ? null : 'none'), rules: [...next] }); } catch { toast(t('sg.rulesClash'), 'warn'); return; }
        saveSetup({ rules: [...next] }); renderHome();
      },
    }, t('sg.v.' + r)))), t('sg.extraHint')));
  }
  // symbols
  more.append(symbolsField(o.n));
  // random source
  // Seeds are free text (capped at 120 chars, like readLink): "my birthday" is a valid, memorable seed.
  const seedInput = h('input', { class: 'ed-input sg-seed-in', value: setup.seed, placeholder: t('sg.seedPh'), 'aria-label': t('sg.seed'), spellcheck: 'false', maxlength: '120', oninput: (e) => saveSetup({ seed: e.target.value.trim() }) });
  const seedRow = h('div', { class: 'sg-row sg-seedrow', hidden: setup.randomKind !== 'seeded' }, seedInput,
    h('button', { type: 'button', class: 'ed-btn', title: t('sg.newSeed'), 'aria-label': t('sg.newSeed'), onclick: () => { const s = randomSeed(); seedInput.value = s; saveSetup({ seed: s }); } }, iconEl('dice')));
  more.append(fieldRow(t('sg.random'), h('div', {},
    segOf([['crypto', t('sg.rnd.crypto'), t('sg.rnd.cryptoHint')], ['seeded', t('sg.rnd.seeded'), t('sg.rnd.seededHint')]], setup.randomKind, (k) => {
      saveSetup({ random: k, seed: prefs().setup.seed || (k === 'seeded' ? randomSeed() : '') }); renderHome();
    }, t('sg.random')), seedRow), t(setup.randomKind === 'seeded' ? 'sg.rnd.seededHint' : 'sg.rnd.cryptoHint')));
  box.append(more);
  // play
  const play = () => { const s = currentSetup(); APP.play({ options: s.options, random: s.random }); };
  box.append(h('div', { class: 'sg-play-row' },
    h('button', { type: 'button', class: 'ed-btn ed-primary sg-big sg-grow', onclick: play }, iconEl('play'), t('sg.play')),
    h('button', { type: 'button', class: 'ed-btn sg-big', onclick: () => APP.botGame(currentSetup()) }, iconEl('bot'), t('sg.vsBots')),
    ENV.online ? h('button', { type: 'button', class: 'ed-btn sg-big', onclick: () => APP.online(currentSetup()) }, iconEl('users'), t('sg.online')) : null));
  return box;
}

// "30", "30x30", "30×30" -> { n } | { error: 'format' | 'square' }
// Accepts "30", "30x30", "30×30", Cyrillic "х" (a common keyboard-layout slip) and "*". Non-square sizes are
// rejected explicitly with their own message rather than as a format error.
export function parseSize(text) {
  const m = /^\s*(\d{1,3})\s*(?:[x×х*]\s*(\d{1,3}))?\s*$/i.exec(String(text || ''));
  if (!m) return { error: 'format' };
  if (m[2] && +m[2] !== +m[1]) return { error: 'square' };
  return { n: +m[1] };
}

// The sizes a variant takes, as ranges ("4–16", "4, 9").
// Compresses the allowed sizes into ranges for the error message ("4–16, 25"). Linear scan over MIN_N..MAX_N.
function sizeRanges(id) {
  const out = [];
  for (let n = MIN_N; n <= MAX_N; n++) {
    if (sizeProblem(id, n)) continue;
    const last = out[out.length - 1];
    if (last && last[1] === n - 1) last[1] = n; else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? String(a) : b === a + 1 ? `${a}, ${b}` : `${a}–${b}`)).join(', ');
}

// Why a typed size cannot be played ('' when it can).
function sizeError(id, text) {
  const r = parseSize(text);
  if (r.error) return t('sg.sizeErr.' + r.error);
  const why = sizeProblem(id, r.n);
  return why ? t('sg.sizeErr.' + why, { n: r.n, min: MIN_N, max: MAX_N, variant: variantName(id), sizes: sizeRanges(id) }) : '';
}

function sizeField(o, v) {
  const sizes = sizesFor(o.variant);
  const last = +prefs().setup.customN || 0;
  // a size typed earlier stays in the list once used (while the variant takes it)
  const extra = [...new Set([o.n, last])].filter((n) => n && !sizes.includes(n) && !sizeProblem(o.variant, n));
  const label = (n) => (v.layout ? sizeLabel({ n, layout: v.layout }) : `${n}×${n}`);
  const input = h('input', {
    class: 'ed-input sg-size-in', value: last ? `${last}×${last}` : '', placeholder: t('sg.sizeCustomPh'), 'aria-label': t('sg.sizeCustomT'),
    autocomplete: 'off', spellcheck: 'false', maxlength: '9',
  });
  const msg = h('div', { class: 'sg-field-h sg-size-msg', role: 'status', hidden: !customOpen });
  const check = () => {
    const text = input.value.trim();
    const err = text ? sizeError(o.variant, text) : t('sg.sizeErr.format');
    msg.textContent = err || t('sg.sizeOk', { n: parseSize(text).n, variant: variantName(o.variant) });
    msg.classList.toggle('sg-err', !!(err && text));
    return !err;
  };
  const use = () => {
    if (!check()) { input.focus(); return; }
    const n = parseSize(input.value).n;
    customOpen = false;
    saveSetup({ n, box: null, customN: n });
    renderHome();
  };
  input.addEventListener('input', check);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); use(); } else if (e.key === 'Escape') { customOpen = false; renderHome(); }
  });
  const row = h('div', { class: 'sg-row sg-size-row', hidden: !customOpen }, input, h('button', { type: 'button', class: 'ed-btn sg-size-use', onclick: use }, t('sg.sizeUse')));
  const sel = h('select', {
    class: 'ed-input ed-select sg-size-sel', 'aria-label': t('sg.size'),
    onchange: (e) => {
      if (e.target.value === 'custom') { customOpen = true; row.hidden = false; msg.hidden = false; check(); input.focus(); input.select(); return; }
      customOpen = false;
      saveSetup({ n: +e.target.value, box: null }); renderHome();
    },
  }, [...sizes, ...extra].sort((a, b) => a - b).map((n) => h('option', { value: String(n), selected: n === o.n && !customOpen }, label(n))),
  v.layout ? null : h('option', { value: 'custom', selected: customOpen }, t('sg.sizeCustom')));
  if (customOpen) check();
  return fieldRow(t('sg.size'), h('div', { class: 'sg-size' }, sel, row, msg));
}

function symbolsField(n) {
  const p = prefs();
  const ids = Object.keys(ALPHABETS).filter((id) => ALPHABETS[id].max >= n);
  const sel = h('select', { class: 'ed-input ed-select', 'aria-label': t('sg.symbols') },
    [...ids.map((id) => h('option', { value: id, selected: p.alphabet === id }, t('sg.abc.' + id))), h('option', { value: 'custom', selected: p.alphabet === 'custom' }, t('sg.abc.custom'))]);
  const preview = h('div', { class: 'sg-abc-prev' });
  const custom = h('input', { class: 'ed-input', value: p.custom, placeholder: t('sg.customPh', { n }), 'aria-label': t('sg.abc.custom'), hidden: p.alphabet !== 'custom', spellcheck: 'false' });
  const msg = h('div', { class: 'sg-field-h' });
  const paint = () => {
    const syms = symbolsOf(n);
    preview.innerHTML = '';
    for (const s of syms) preview.append(s.color ? h('span', { class: 'sg-abc-sw', style: { background: s.color } }) : h('span', { class: 'sg-abc-s' }, s.text));
    if (prefs().alphabet === 'custom') {
      const r = parseCustom(prefs().custom, n);
      msg.textContent = r.ok ? t('sg.customOk') : t('sg.customErr.' + r.error, { n, count: r.count });
      msg.classList.toggle('sg-err', !r.ok);
    } else if (!ALPHABETS[prefs().alphabet] || ALPHABETS[prefs().alphabet].max < n) { msg.textContent = t('sg.abcShort'); msg.classList.remove('sg-err'); }
    else msg.textContent = '';
  };
  sel.addEventListener('change', () => { setPrefs({ alphabet: sel.value }); custom.hidden = sel.value !== 'custom'; paint(); APP.refresh?.(); });
  custom.addEventListener('input', () => { setPrefs({ custom: custom.value }); paint(); });
  paint();
  return fieldRow(t('sg.symbols'), h('div', { class: 'sg-abc' }, sel, custom, preview), msg);
}

// --- online and footer --------------------------------------------------------------------------------------------------------

function online() {
  if (!ENV.online) return null;
  return h('section', { class: 'sg-card sg-online-card' },
    h('div', { class: 'sg-daily-ic' }, iconEl('users')),
    h('div', { class: 'sg-cont-body' },
      h('div', { class: 'sg-card-t' }, t('sg.onlineTitle')),
      h('div', { class: 'sg-muted' }, t('sg.onlineSub'))),
    h('button', { type: 'button', class: 'ed-btn', onclick: () => APP.online(currentSetup()) }, iconEl('users'), t('sg.onlineOpen')));
}

function footer() {
  return h('nav', { class: 'sg-homefoot', 'aria-label': t('sg.more') },
    h('button', { type: 'button', class: 'sg-flink', onclick: () => APP.stats() }, iconEl('award'), t('sg.stats')),
    h('button', { type: 'button', class: 'sg-flink', onclick: () => APP.settings() }, iconEl('settings'), t('sg.settings')),
    h('button', { type: 'button', class: 'sg-flink', onclick: () => APP.help() }, iconEl('help'), t('sg.help')),
    h('button', { type: 'button', class: 'sg-flink', onclick: () => APP.openCode() }, iconEl('paste'), t('sg.openCode')));
}

// --- example pictures ---------------------------------------------------------------------------------------------------------

// data-done guards against drawing twice (cache hit + worker delivery). The attribute selector uses variant ids,
// which are plain [a-z-] identifiers from the variant table, so no CSS escaping is needed.
function drawPic(item) {
  const host = document.querySelector(`.sg-vpic[data-pic="${item.variant}"]`);
  if (!host || host.dataset.done) return;
  host.dataset.done = '1';
  host.innerHTML = picture(item.puzzle, symbolsOf(item.puzzle.n), { cls: 'sg-pic sg-pic-sm' });
}

function fillExamples() {
  const ids = variantsOf(group).map((v) => v.id);
  for (const id of ids) { const c = cachedExample(id); if (c) drawPic(c); }
  loadExamples(ids, drawPic);
}
