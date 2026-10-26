// battleship-game/profile.js - the player's profile: name and avatar, results (games, wins, accuracy, mean skill), the
// style measured from every shot and fleet (battleship/analysis.js features) next to the closest bot personalities
// (their profiles come from the simulations), style badges and achievements.
//
//   renderProfile(main, { onBack }) -> element;  AVATARS

import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { confirmDialog } from '../ui/overlays.js';
import { features, compare, traitsOf, STYLE_FEATURES, ACHIEVEMENTS, newCounters } from '../battleship/analysis.js';
import { templateById } from '../battleship/bots.js';
import { BOTSTATS } from '../battleship/botstats.js';
import { store, save } from './store.js';

// Emoji avatars: no image assets, render in every font stack, and travel as a single string in online rooms.
// Some are ZWJ sequences (pirate flag, pilots), so code that measures them must count graphemes, not UTF-16 units.
export const AVATARS = ['⚓', '🐙', '🦈', '🐳', '🐬', '🦀', '🐢', '🦭', '🧜', '🏴‍☠️', '👩‍✈️', '🧑‍✈️', '🦜', '🐧', '🦑', '🌊', '⛵', '🚢', '🛟', '🤖'];

// Style vectors of the bot personalities, measured offline by simulations (battleship/botstats.js), keyed by id.
export function profiles() {
  const out = {};
  for (const [id, x] of Object.entries(BOTSTATS.templates || {})) out[id] = x.style;
  return out;
}

export function renderProfile(main, { onBack }) {
  const root = h('section', { class: 'bs-profile bs-screen' });
  main.append(root);
  // Everything is derived from the stored counters and game summaries at render time: the profile stores raw counts,
  // never computed percentages, so a better feature formula applies retroactively to all past games.
  // Accuracy = total hits / total shots (shot-weighted), not the mean of per-game accuracies, so short games do not
  // dominate. The closest bots: compare() ranks by similarity of feature vectors; the best one is drawn as markers.
  const render = () => {
    const S = store.settings, P = store.profile;
    root.textContent = '';
    const games = P.games;
    const wins = games.filter((g) => g.won).length;
    const shots = games.reduce((a, g) => a + (g.shots || 0), 0), hits = games.reduce((a, g) => a + (g.hits || 0), 0);
    const sk = games.filter((g) => g.skill != null);
    const f = features(P.counters);
    const close = compare(f, profiles()).slice(0, 3);
    const badges = traitsOf(f);
    const nameIn = h('input', { class: 'ed-input', value: S.name || '', placeholder: t('you'), maxlength: '24', 'aria-label': t('pf.name') });
    nameIn.addEventListener('change', () => { S.name = nameIn.value.trim(); save('settings'); });
    const avatars = h('div', { class: 'bs-avatars', role: 'radiogroup', 'aria-label': t('pf.avatar') }, AVATARS.map((a) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(S.avatar === a), class: 'bs-avatar' + (S.avatar === a ? ' bs-on' : ''), onclick: () => { S.avatar = a; save('settings'); render(); } }, a)));
    const bars = h('div', { class: 'bs-style' });
    const best = close[0] ? profiles()[close[0].id] : null;
    for (const { id } of STYLE_FEATURES) {
      const v = f[id], b = best ? best[id] : null;
      bars.append(h('div', { class: 'bs-sbar', dataset: { f: id } }, h('div', { class: 'bs-sbar-h' }, h('span', {}, t('sf.' + id)), h('b', {}, v == null ? '—' : Math.round(v * 100) + '%')),
        h('div', { class: 'bs-sbar-t' }, v == null ? null : h('i', { class: 'bs-sbar-you', style: { width: Math.round(v * 100) + '%' } }), b == null ? null : h('i', { class: 'bs-sbar-bot', style: { left: Math.round(b * 100) + '%' }, title: t('pf.botMark') })),
        h('div', { class: 'ed-hint' }, t('sf.' + id + '.d'))));
    }
    const have = new Map(P.achievements.map((a) => [a.id, a.at]));
    root.append(
      h('div', { class: 'bs-screen-h' },
        h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('nav.back'), onclick: onBack }, iconEl('parent')),
        h('h2', {}, t('pf.title'))),
      h('div', { class: 'bs-profile-grid' },
        h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('pf.you')),
          h('div', { class: 'bs-me-big' }, h('span', { class: 'bs-me-ava' }, S.avatar || '⚓'), nameIn), avatars,
          h('div', { class: 'bs-stats' },
            h('div', {}, h('b', {}, String(games.length)), h('span', {}, t('pf.games'))),
            h('div', {}, h('b', {}, String(wins)), h('span', {}, t('pf.wins'))),
            h('div', {}, h('b', {}, shots ? Math.round((hits / shots) * 100) + '%' : '—'), h('span', {}, t('pf.accuracy'))),
            h('div', {}, h('b', {}, sk.length ? Math.round((sk.reduce((a, g) => a + g.skill, 0) / sk.length) * 100) + '%' : '—'), h('span', {}, t('pf.skill'))))),
        h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('pf.style')),
          close.length ? h('div', { class: 'bs-closest' }, h('p', {}, t('pf.closest')), close.map((c, i) => {
            const tp = templateById(c.id);
            return h('div', { class: 'bs-close' + (i === 0 ? ' bs-first' : '') }, h('span', { class: 'bs-bot-i' }, tp ? tp.icon : '🤖'), h('b', {}, t(`bot.${c.id}.name`)), h('span', { class: 'bs-sim' }, Math.round(c.similarity * 100) + '%'));
          })) : h('p', { class: 'ap-empty' }, t('pf.noData')),
          badges.length ? h('div', { class: 'bs-chips' }, badges.map((b) => h('span', { class: 'bs-chip bs-badge', title: t('bd.' + b + '.d') }, t('bd.' + b)))) : null,
          bars),
        h('section', { class: 'ap-card bs-achcard' }, h('h2', { class: 'ap-card-h' }, t('pf.achievements', { n: have.size, total: ACHIEVEMENTS.length })),
          h('div', { class: 'bs-achs' }, ACHIEVEMENTS.map((a) => h('div', { class: 'bs-ach' + (have.has(a.id) ? ' bs-got' : ''), dataset: { id: a.id } },
            h('span', { class: 'bs-ach-i' }, a.icon), h('div', {}, h('b', {}, t('ach.' + a.id)), h('div', { class: 'ed-muted' }, t('ach.' + a.id + '.d')),
              have.has(a.id) ? h('small', { class: 'ed-muted' }, new Date(have.get(a.id)).toLocaleDateString()) : null)))),
          h('div', { class: 'ap-actions' }, h('button', { type: 'button', class: 'ed-btn ed-danger', onclick: async () => {
            if (!(await confirmDialog(t('pf.reset'), t('pf.resetQ'), t('pf.reset'), true))) return;
            store.profile = { counters: newCounters(), games: [], achievements: [] };
            save('profile');
            render();
          } }, iconEl('trash'), t('pf.reset'))))));
  };
  render();
  return root;
}
