// durak-game/profile.js - the player's profile: name and avatar, results, the style measured from every decision
// (durak/analysis.js features) next to the closest bot templates (their style profiles come from the simulations),
// style badges and achievements.
//
//   renderProfile(main, { onBack }) -> element

import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { iconEl } from '../ui/icons.js';
import { confirmDialog } from '../ui/overlays.js';
import { features, compare, traitsOf, STYLE_FEATURES, ACHIEVEMENTS, newCounters } from '../durak/analysis.js';
import { templateById } from '../durak/bots.js';
import { BOTSTATS } from '../durak/botstats.js';
import { store, save } from './store.js';

export const AVATARS = ['🦊', '🐻', '🐼', '🐯', '🦁', '🐸', '🐙', '🦉', '🐺', '🦄', '🐲', '🐧', '🐱', '🐶', '🤠', '🧙', '🥷', '👩‍🚀', '🧛', '🤖'];

// Style vectors of the bot templates, precomputed offline by simulation (durak/botstats.js), keyed by template id.
// Comparing the player's measured feature vector against them answers "which bot plays like you".
export function profiles() {
  const out = {};
  for (const [id, x] of Object.entries(BOTSTATS.templates || {})) out[id] = x.style;
  return out;
}

// Whole-screen render function re-run on every change (avatar, reset): the profile is small, rebuilding is simpler
// than patching. Style bars: the player's value as a filled bar, the closest bot's value as a thin marker on the same
// track, so the difference is visible without numbers; null features (not enough decisions yet) show '—'.
// Avatars form an ARIA radiogroup (role=radio + aria-checked).
export function renderProfile(main, { onBack }) {
  const root = h('section', { class: 'dk-profile dk-screen' });
  main.append(root);
  const render = () => {
    const S = store.settings, P = store.profile;
    root.textContent = '';
    const games = P.games;
    const wins = games.filter((g) => g.won).length, duraks = games.filter((g) => g.durak).length;
    const f = features(P.counters);
    const close = compare(f, profiles()).slice(0, 3);
    const badges = traitsOf(f);
    const nameIn = h('input', { class: 'ed-input', value: S.name || '', placeholder: t('you'), maxlength: '24', 'aria-label': t('pf.name') });
    nameIn.addEventListener('change', () => { S.name = nameIn.value.trim(); save('settings'); });
    const avatars = h('div', { class: 'dk-avatars', role: 'radiogroup', 'aria-label': t('pf.avatar') }, AVATARS.map((a) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(S.avatar === a), class: 'dk-avatar' + (S.avatar === a ? ' dk-on' : ''), onclick: () => { S.avatar = a; save('settings'); render(); } }, a)));
    const bars = h('div', { class: 'dk-style' });
    const best = close[0] ? profiles()[close[0].id] : null;
    for (const { id } of STYLE_FEATURES) {
      const v = f[id], b = best ? best[id] : null;
      bars.append(h('div', { class: 'dk-sbar' }, h('div', { class: 'dk-sbar-h' }, h('span', {}, t('sf.' + id)), h('b', {}, v == null ? '—' : Math.round(v * 100) + '%')),
        h('div', { class: 'dk-sbar-t' }, v == null ? null : h('i', { class: 'dk-sbar-you', style: { width: Math.round(v * 100) + '%' } }), b == null ? null : h('i', { class: 'dk-sbar-bot', style: { left: Math.round(b * 100) + '%' }, title: t('pf.botMark') })),
        h('div', { class: 'ed-hint' }, t('sf.' + id + '.d'))));
    }
    const have = new Map(P.achievements.map((a) => [a.id, a.at]));
    root.append(
      h('div', { class: 'dk-screen-h' },
        h('button', { type: 'button', class: 'ed-iconbtn', 'aria-label': t('nav.back'), onclick: onBack }, iconEl('parent')),
        h('h2', {}, t('pf.title'))),
      h('div', { class: 'dk-profile-grid' },
        h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('pf.you')),
          h('div', { class: 'dk-me-big' }, h('span', { class: 'dk-me-ava' }, S.avatar || '🙂'), nameIn), avatars,
          h('div', { class: 'dk-stats' },
            h('div', {}, h('b', {}, String(games.length)), h('span', {}, t('pf.games'))),
            h('div', {}, h('b', {}, String(wins)), h('span', {}, t('pf.wins'))),
            h('div', {}, h('b', {}, String(duraks)), h('span', {}, t('pf.duraks'))),
            h('div', {}, h('b', {}, games.length ? Math.round((wins / games.length) * 100) + '%' : '—'), h('span', {}, t('pf.rate'))))),
        h('section', { class: 'ap-card' }, h('h2', { class: 'ap-card-h' }, t('pf.style')),
          close.length ? h('div', { class: 'dk-closest' }, h('p', {}, t('pf.closest')), close.map((c, i) => {
            const tp = templateById(c.id);
            return h('div', { class: 'dk-close' + (i === 0 ? ' dk-first' : '') }, h('span', { class: 'dk-bot-i' }, tp ? tp.icon : '🤖'), h('b', {}, t(`bot.${c.id}.name`)), h('span', { class: 'dk-sim' }, Math.round(c.similarity * 100) + '%'));
          })) : h('p', { class: 'ap-empty' }, t('pf.noData')),
          badges.length ? h('div', { class: 'dk-chips' }, badges.map((b) => h('span', { class: 'dk-chip dk-badge', title: t('bd.' + b + '.d') }, t('bd.' + b)))) : null,
          bars),
        h('section', { class: 'ap-card dk-achcard' }, h('h2', { class: 'ap-card-h' }, t('pf.achievements', { n: have.size, total: ACHIEVEMENTS.length })),
          h('div', { class: 'dk-achs' }, ACHIEVEMENTS.map((a) => h('div', { class: 'dk-ach' + (have.has(a.id) ? ' dk-got' : '') },
            h('span', { class: 'dk-ach-i' }, a.icon), h('div', {}, h('b', {}, t('ach.' + a.id)), h('div', { class: 'ed-muted' }, t('ach.' + a.id + '.d')),
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
