// durak-game/setup.js - the new game screen (ruleset gallery, number of players, a bot on every other seat, shuffle
// source with a shareable seed) and the bot picker: templates with their principles, difficulty per level (ratings
// from the simulations), which bots disrupt them and which play into their hands, saved own bots and the bot
// constructor (traits, skills, targeting).
//
//   renderSetup(main, { onStart(setup), onBack, rulesBody, botInfo }) -> element
//   pickBot(current) -> Promise<seat config | null>      seat config: { kind, level, options?, name?, icon? }
//   botCard(kind, level) -> element                      the description of a template (also for seat info)
//   rulesetChoices() -> [{ raw, builtin }]

import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { openDialog, toast } from '../ui/overlays.js';
import { seg } from '../ui/app.js';
import { normalizeRuleset, playerRange } from '../durak/ruleset.js';
import { PRESETS } from '../durak/presets.js';
import { TEMPLATES, TRAITS, SKILLS, TARGETING, LEVELS, templateById, profileOf } from '../durak/bots.js';
import { BOTSTATS } from '../durak/botstats.js';
import { randomSeed } from '../prng/prng.js';
import { store, save } from './store.js';
import { rulesetName, rulesetDesc, botName, levelName } from './names.js';

// Built-ins first, then the player's own; built-ins are referenced by id in rooms and records, own ones travel in full.
export function rulesetChoices() {
  return [...PRESETS.map((raw) => ({ raw, builtin: true })), ...store.rulesets.map((raw) => ({ raw, builtin: false }))];
}

const tagsOf = (raw) => (raw.tags || []).filter((x) => ['classic', 'exclusive', 'transfer', 'jokers', 'teams', 'big', 'fast', 'custom-cards', 'trump'].includes(x));

// --- interactions ---------------------------------------------------------------------------------------------------

// Templates that disrupt `id` (its durak rate rises when they sit at the table) and that play into its hands.
// v.specific = change in id's durak rate attributable to that opponent (from offline simulations). +-1.2 percentage
// points is the noise threshold: smaller effects are not shown, to avoid presenting simulation noise as insight.
export function interactionsOf(id) {
  const row = BOTSTATS.interactions && BOTSTATS.interactions[id];
  if (!row) return { foes: [], friends: [] };
  const list = Object.entries(row).filter(([y]) => y !== id).map(([y, v]) => ({ id: y, v: v.specific }));
  const foes = list.filter((x) => x.v > 0.012).sort((a, b) => b.v - a.v).slice(0, 3);
  const friends = list.filter((x) => x.v < -0.012).sort((a, b) => a.v - b.v).slice(0, 3);
  return { foes, friends };
}

// The template closest to a constructed profile (trait distance): squared Euclidean distance over all traits, a
// missing trait counting as its default. Linear scan, ~10 templates.
export function nearestTemplate(traits) {
  let best = null, bd = Infinity;
  for (const tp of TEMPLATES) {
    let d = 0;
    for (const tr of TRAITS) d += ((tp.traits[tr.id] ?? tr.def) - (traits[tr.id] ?? tr.def)) ** 2;
    if (d < bd) { bd = d; best = tp; }
  }
  return best;
}

const ratingOf = (id, level) => BOTSTATS.templates?.[id]?.levels?.[level]?.rating ?? null;

function chip(id) {
  const tp = templateById(id);
  return h('span', { class: 'dk-chip' }, tp ? tp.icon : '🤖', ' ', tp ? t(`bot.${id}.name`) : id);
}

export function botCard(kind, level = 2, compact = false) {
  const tp = templateById(kind);
  if (!tp) return h('div', { class: 'dk-botcard' }, h('b', {}, t('bot.custom.name')));
  const inter = interactionsOf(tp.id);
  return h('div', { class: 'dk-botcard' + (compact ? ' dk-compact' : '') },
    h('div', { class: 'dk-bot-h' }, h('span', { class: 'dk-bot-i' }, tp.icon), h('div', {}, h('b', {}, t(`bot.${tp.id}.name`)),
      h('div', { class: 'dk-ratings' }, LEVELS.map((l) => h('span', { class: 'dk-rating' + (l.id === level ? ' dk-on' : ''), title: t('bp.rating') }, levelName(l.id), ' ', h('b', {}, String(ratingOf(tp.id, l.id) ?? '—'))))))),
    h('p', { class: 'dk-bot-sum' }, t(`bot.${tp.id}.summary`)),
    h('div', { class: 'dk-chips' }, tp.principles.map((_, i) => h('span', { class: 'dk-chip dk-pr' }, t(`bot.${tp.id}.p${i + 1}`)))),
    inter.foes.length ? h('div', { class: 'dk-inter dk-foes' }, h('span', {}, t('bp.foes')), inter.foes.map((x) => chip(x.id))) : null,
    inter.friends.length ? h('div', { class: 'dk-inter dk-friends' }, h('span', {}, t('bp.friends')), inter.friends.map((x) => chip(x.id))) : null);
}

// --- bot picker -------------------------------------------------------------------------------------------------------

// Resolves with the chosen seat config, or null when dismissed. The dialog has no buttons: choosing an item closes it
// (close() is wired in onMount, where the dialog handle first exists) and `choice` carries the result out.
export function pickBot(current = { kind: 'rookie', level: 2 }) {
  let level = current.level || 2;
  let choice = null;
  let tab = 'list';
  const body = h('div', { class: 'dk-picker' });
  const render = () => {
    body.textContent = '';
    body.append(seg([{ v: 'list', l: 'bp.templates' }, { v: 'build', l: 'bp.build' }], tab, (v) => { tab = v; render(); }, 'bp.mode'));
    if (tab === 'list') {
      body.append(h('div', { class: 'dk-levelrow' }, h('span', {}, t('bp.level')), seg(LEVELS.map((l) => ({ v: l.id, l: 'lvl.' + l.id })), level, (v) => { level = +v; render(); }, 'bp.level')));
      const list = h('div', { class: 'dk-botlist', role: 'listbox' });
      for (const tp of TEMPLATES) {
        const item = h('button', { type: 'button', class: 'dk-botitem' + (current.kind === tp.id ? ' dk-on' : ''), role: 'option', onclick: () => { choice = { kind: tp.id, level }; close(); } }, botCard(tp.id, level));
        list.append(item);
      }
      for (const b of store.bots) {
        const near = nearestTemplate(b.options?.traits || {});
        list.append(h('div', { class: 'dk-botitem dk-own' },
          h('button', { type: 'button', class: 'dk-own-main', onclick: () => { choice = { ...b, level: b.level || level }; close(); } },
            h('div', { class: 'dk-bot-h' }, h('span', { class: 'dk-bot-i' }, b.icon || '🤖'), h('div', {}, h('b', {}, b.name), h('div', { class: 'ed-muted' }, t('bp.similar', { name: near ? t(`bot.${near.id}.name`) : '—' }))))),
          h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('bp.delete'), title: t('bp.delete'), onclick: () => { store.bots = store.bots.filter((x) => x !== b); save('bots'); render(); } }, iconEl('trash'))));
      }
      body.append(list);
    } else body.append(builder((cfg) => { choice = cfg; close(); }));
  };
  let close = () => {};
  render();
  return openDialog({ title: t('bp.title'), body, wide: true, className: 'dk-pickdlg', buttons: [], onMount: (m) => { close = () => m.close(null); } }).then(() => choice);
}

// The bot constructor: traits, targeting, skills, level; saved bots live in store.bots.
// Starts from a template's values; changing the base template resets traits/skills to it. Trait sliders update their
// label and the "similar to" line in place (no full re-render, so dragging stays smooth). Saved bots are keyed by
// name (same name overwrites) and capped at 40.
export function builder(onUse, init = null) {
  const base = templateById(init?.base || 'accountant');
  const cfg = {
    name: init?.name || t('bp.myBot'), icon: init?.icon || '🤖', base: base.id, level: init?.level || 3,
    traits: { ...base.traits, ...(init?.options?.traits || {}) }, skills: { ...base.skills, ...(init?.options?.skills || {}) },
    targeting: init?.options?.targeting || base.targeting,
  };
  const box = h('div', { class: 'dk-builder' });
  const render = () => {
    box.textContent = '';
    const near = nearestTemplate(cfg.traits);
    const nameIn = h('input', { class: 'ed-input', value: cfg.name, maxlength: '24', 'aria-label': t('bp.name') });
    nameIn.addEventListener('input', () => { cfg.name = nameIn.value; });
    const iconIn = h('input', { class: 'ed-input dk-emoji-in', value: cfg.icon, maxlength: '4', 'aria-label': t('bp.icon') });
    iconIn.addEventListener('input', () => { cfg.icon = iconIn.value || '🤖'; });
    const baseSel = h('select', { class: 'ed-input ed-select', 'aria-label': t('bp.base') }, TEMPLATES.map((tp) => h('option', { value: tp.id, selected: tp.id === cfg.base }, tp.icon + ' ' + t(`bot.${tp.id}.name`))));
    baseSel.addEventListener('change', () => { const tp = templateById(baseSel.value); cfg.base = tp.id; cfg.traits = { ...tp.traits }; cfg.skills = { ...tp.skills }; cfg.targeting = tp.targeting; render(); });
    box.append(h('div', { class: 'dk-brow' }, h('label', { class: 'ed-label' }, t('bp.name')), h('div', { class: 'ap-row' }, iconIn, nameIn)),
      h('div', { class: 'dk-brow' }, h('label', { class: 'ed-label' }, t('bp.base')), baseSel));
    const traits = h('div', { class: 'dk-traits' });
    for (const tr of TRAITS) {
      const out = h('output', {}, Math.round(cfg.traits[tr.id] * 100) + '%');
      const r = h('input', { type: 'range', class: 'ed-range', min: '0', max: '100', step: '5', value: String(Math.round(cfg.traits[tr.id] * 100)), 'aria-label': t('tr.' + tr.id) });
      r.addEventListener('input', () => { cfg.traits[tr.id] = +r.value / 100; out.textContent = r.value + '%'; nearOut.textContent = t('bp.similar', { name: t(`bot.${nearestTemplate(cfg.traits).id}.name`) }); });
      traits.append(h('div', { class: 'dk-trait' }, h('div', { class: 'dk-trait-h' }, h('b', {}, t('tr.' + tr.id)), out), r, h('div', { class: 'ed-hint' }, t('tr.' + tr.id + '.d'))));
    }
    const skills = h('div', { class: 'dk-skills' });
    for (const sk of SKILLS) {
      skills.append(h('div', { class: 'dk-trait' }, h('div', { class: 'dk-trait-h' }, h('b', {}, t('sk.' + sk.id))),
        seg([0, 1, 2, 3].map((v) => ({ v, l: '=' + v })), cfg.skills[sk.id] | 0, (v) => { cfg.skills[sk.id] = +v; }, 'sk.' + sk.id),
        h('div', { class: 'ed-hint' }, t('sk.' + sk.id + '.d'))));
    }
    const tgt = h('select', { class: 'ed-input ed-select', 'aria-label': t('bp.targeting') }, TARGETING.map((x) => h('option', { value: x, selected: x === cfg.targeting }, t('tg.' + x))));
    tgt.addEventListener('change', () => { cfg.targeting = tgt.value; });
    const nearOut = h('p', { class: 'dk-near' }, t('bp.similar', { name: near ? t(`bot.${near.id}.name`) : '—' }));
    box.append(h('h3', {}, t('bp.traits')), traits, h('h3', {}, t('bp.skills')), skills,
      h('div', { class: 'dk-brow' }, h('label', { class: 'ed-label' }, t('bp.targeting')), tgt),
      h('div', { class: 'dk-brow' }, h('label', { class: 'ed-label' }, t('bp.level')), seg(LEVELS.map((l) => ({ v: l.id, l: 'lvl.' + l.id })), cfg.level, (v) => { cfg.level = +v; }, 'bp.level')),
      nearOut,
      h('div', { class: 'ap-actions' },
        h('button', { type: 'button', class: 'ed-btn', onclick: () => { saveBot(); toast(t('bp.saved'), 'ok'); } }, iconEl('save'), t('bp.save')),
        h('button', { type: 'button', class: 'ed-btn ed-primary', onclick: () => onUse(saveBot()) }, iconEl('check'), t('bp.use'))));
  };
  // KNOWN DEFECT: the profileOf call below is a no-op - it never throws and its clamped result is discarded, so the
  // stored entry keeps unclamped values (harmless only because the engine clamps again when the bot is built).
  // Fix: assign the clamped traits/skills from profileOf back into entry.options, or drop the call.
  const saveBot = () => {
    const entry = { kind: 'custom', level: cfg.level, name: cfg.name.trim() || t('bp.myBot'), icon: cfg.icon, base: cfg.base, options: { traits: { ...cfg.traits }, skills: { ...cfg.skills }, targeting: cfg.targeting } };
    // validate through the bot engine (clamps values)
    profileOf('custom', { level: entry.level, ...entry.options });
    const i = store.bots.findIndex((b) => b.name === entry.name);
    if (i >= 0) store.bots[i] = entry; else store.bots.unshift(entry);
    store.bots = store.bots.slice(0, 40);
    save('bots');
    return entry;
  };
  render();
  return box;
}

// --- the setup screen -------------------------------------------------------------------------------------------------

// Setup screen. Every choice is persisted to store.settings immediately, so "Play" on the home screen repeats the last
// setup. The player count is clamped to the selected ruleset on each render. Team colour of seat i = i mod teams
// (seat order alternates teams around the table). The seed is generated at start time when left empty, so the field
// can stay blank and every game still gets a recorded seed.
export function renderSetup(main, { onStart, onBack, rulesBody, initial = null }) {
  const S = store.settings;
  const choices = rulesetChoices();
  let current = choices.find((c) => c.raw.id === (initial?.rulesetId || S.rulesetId)) || choices[0];
  let filter = 'all';
  const root = h('section', { class: 'dk-setup dk-screen' });
  const render = () => {
    const rs = normalizeRuleset(current.raw);
    const pr = playerRange(rs);
    S.players = Math.max(pr.min, Math.min(pr.max, S.players || 3));
    root.textContent = '';
    const head = h('div', { class: 'dk-screen-h' },
      h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('nav.back'), onclick: onBack }, iconEl('parent')),
      h('h2', {}, t('setup.title')));
    // rulesets
    const filters = seg([{ v: 'all', l: 'setup.all' }, { v: 'classic', l: 'tag.classic' }, { v: 'exclusive', l: 'tag.exclusive' }, { v: 'own', l: 'setup.own' }], filter, (v) => { filter = v; render(); }, 'setup.rules');
    const gallery = h('div', { class: 'dk-gallery' });
    for (const c of choices) {
      if (filter === 'classic' && !(c.builtin && !c.raw.exclusive)) continue;
      if (filter === 'exclusive' && !c.raw.exclusive) continue;
      if (filter === 'own' && c.builtin) continue;
      const n = normalizeRuleset(c.raw);
      const p = playerRange(n);
      gallery.append(h('button', { type: 'button', class: 'dk-rscard' + (c === current ? ' dk-on' : '') + (c.raw.exclusive ? ' dk-excl' : ''), 'aria-pressed': String(c === current), onclick: () => { current = c; S.rulesetId = c.raw.id; save('settings'); render(); } },
        h('div', { class: 'dk-rscard-h' }, h('b', {}, rulesetName(n)), c.raw.exclusive ? h('span', { class: 'dk-excl-b' }, '★') : null),
        h('div', { class: 'dk-rscard-m' }, t('setup.meta', { cards: n.cardCount, min: p.min, max: p.max })),
        h('div', { class: 'dk-rscard-t' }, tagsOf(c.raw).map((x) => h('span', { class: 'dk-tagp' }, t('tag.' + x))), c.builtin ? null : h('span', { class: 'dk-tagp dk-own' }, t('setup.own')))));
    }
    if (filter === 'own' && !gallery.children.length) gallery.append(h('p', { class: 'ap-empty' }, t('setup.noOwn')));
    const rulesCard = h('section', { class: 'ap-card dk-rulescard' }, h('h2', { class: 'ap-card-h' }, t('setup.rules')), filters, gallery,
      h('details', { class: 'dk-rulesdetails' }, h('summary', {}, t('setup.howPlay', { name: rulesetName(rs) })), rulesBody(rs)));
    // players
    const count = h('div', { class: 'dk-stepper' },
      h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('setup.fewer'), disabled: S.players <= pr.min, onclick: () => { S.players--; save('settings'); render(); } }, iconEl('minus')),
      h('b', { class: 'dk-stepn' }, String(S.players)),
      h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('setup.more'), disabled: S.players >= pr.max, onclick: () => { S.players++; save('settings'); render(); } }, iconEl('plus')));
    const seats = h('div', { class: 'dk-seats' }, h('div', { class: 'dk-seatrow dk-you' }, h('span', { class: 'dk-bot-i' }, S.avatar || '🙂'), h('b', {}, S.name || t('you')), rs.rules.teams ? h('span', { class: 'dk-team dk-team0' }) : null));
    for (let i = 1; i < S.players; i++) {
      const b = S.seats[i - 1];
      const tp = templateById(b.kind);
      seats.append(h('button', { type: 'button', class: 'dk-seatrow', onclick: async () => { const r = await pickBot(b); if (r) { S.seats[i - 1] = r; save('settings'); render(); } } },
        h('span', { class: 'dk-bot-i' }, b.icon || (tp ? tp.icon : '🤖')), h('b', {}, botName(b)), h('span', { class: 'dk-lvl' }, levelName(b.level)),
        rs.rules.teams ? h('span', { class: 'dk-team dk-team' + (i % rs.rules.teams) }) : null, iconEl('edit')));
    }
    const playersCard = h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('setup.players')), count, seats,
      h('p', { class: 'ed-hint' }, t('setup.seatsHint')));
    // shuffle
    const seedIn = h('input', { class: 'ed-input', value: S.seed || '', placeholder: t('setup.seedAuto'), 'aria-label': t('setup.seed'), spellcheck: 'false' });
    seedIn.addEventListener('input', () => { S.seed = seedIn.value.trim(); save('settings'); });
    const shuffleCard = h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('setup.shuffle')),
      seg([{ v: 'seeded', l: 'setup.prng' }, { v: 'crypto', l: 'setup.csprng' }], S.random, (v) => { S.random = v; save('settings'); render(); }, 'setup.shuffle'),
      S.random === 'seeded' ? h('div', { class: 'ap-row dk-seedrow' }, seedIn, h('button', { type: 'button', class: 'ed-iconbtn', title: t('setup.newSeed'), 'aria-label': t('setup.newSeed'), onclick: () => { seedIn.value = S.seed = randomSeed(); save('settings'); } }, h('span', { class: 'dk-dice' }, '🎲'))) : null,
      h('p', { class: 'ed-hint' }, t(S.random === 'seeded' ? 'setup.prngHint' : 'setup.csprngHint')));
    const start = h('button', { type: 'button', class: 'dk-bigbtn', onclick: () => {
      const seed = S.random === 'seeded' ? (S.seed || randomSeed()) : null;
      onStart({ ruleset: current.raw, builtin: current.builtin, players: S.players, seats: S.seats.slice(0, S.players - 1), random: S.random, seed });
    } }, iconEl('send'), t('setup.start'));
    root.append(head, h('div', { class: 'dk-setup-grid' }, rulesCard, h('div', { class: 'dk-setup-side' }, playersCard, shuffleCard, start)));
  };
  render();
  main.append(root);
  return root;
}
