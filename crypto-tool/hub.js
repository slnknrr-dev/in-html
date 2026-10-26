// crypto-tool/hub.js - the overview page: links to the tools and the algorithms and encodings read from the registries,
// the password character groups and the sizes of the strength dictionaries. Everything listed is read from the
// registries at render time, so the overview is always complete without a hand-maintained list.
import { h, $$ } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { card } from '../ui/app.js';
import { getHash, getHashes } from './hashing.js';
import { getCipher, getCiphers } from './ciphering.js';
import { getEncoding, getEncodings } from './encoding.js';
import { fmtNum, grouped, startShell, t } from './shell.js';
import { ALPHABETS } from '../crypto/password.js';
import { WORD_COUNTS } from '../crypto/strength-data.js';

const main = document.getElementById('ct-main');
// Hrefs from the (build-rewritten) page links of the markup.
// Optional call (?.) because the fallback {} has no getAttribute: a missing link yields undefined and then "#".
const href = (k) => ($$('#ct-pages a').find((a) => a.dataset.k === k) || {}).getAttribute?.('href') || '#';

// Broken hashes and ECB are shown muted (ct-tag-weak) with the note as tooltip.
function tags(defs) {
  const groups = grouped(defs);
  return groups.map(([g, list]) => h('div', { class: 'ct-group' },
    groups.length > 1 ? h('h3', { class: 'ct-group-h' }, t('grp.' + g)) : null,
    h('div', { class: 'ct-tags' }, list.map((d) => h('span', { class: 'ct-tag' + (d.note === 'broken' || d.note === 'ecb' ? ' ct-tag-weak' : ''), title: d.note ? t('note.' + d.note) : null }, d.label)))));
}

function render() {
  const hashes = getHashes().map(getHash), ciphers = getCiphers().map(getCipher), encodings = getEncodings().map(getEncoding);
  const digests = hashes.filter((d) => !d.kdf), kdfs = hashes.filter((d) => d.kdf);
  const words = Object.values(WORD_COUNTS).reduce((a, b) => a + b, 0);
  main.textContent = '';
  main.append(
    h('p', { class: 'ap-lead' }, t('hub.lead')),
    h('div', { class: 'ct-hub' },
      h('a', { class: 'ct-tile', href: href('nav.hashing') },
        h('h2', {}, iconEl('hash'), t('nav.hashing')),
        h('p', {}, t('hub.hashingText', { n: digests.filter((d) => d.keyed !== 'required').length })),
        h('span', { class: 'ct-go' }, t('hub.open'), ' →')),
      h('a', { class: 'ct-tile', href: href('nav.ciphering') },
        h('h2', {}, iconEl('lock'), t('nav.ciphering')),
        h('p', {}, t('hub.cipheringText', { n: ciphers.length })),
        h('span', { class: 'ct-go' }, t('hub.open'), ' →')),
      h('a', { class: 'ct-tile', href: href('nav.encoding') },
        h('h2', {}, iconEl('type'), t('nav.encoding')),
        h('p', {}, t('hub.encodingText', { n: encodings.length })),
        h('span', { class: 'ct-go' }, t('hub.open'), ' →')),
      h('a', { class: 'ct-tile', href: href('nav.passwords') },
        h('h2', {}, iconEl('key'), t('nav.passwords')),
        h('p', {}, t('hub.passwordsText', { g: ALPHABETS.length, w: fmtNum(words) })),
        h('span', { class: 'ct-go' }, t('hub.open'), ' →'))),
    h('div', { class: 'ap-cols' },
      card('hub.hashes', tags(digests)),
      card('hub.kdfs', tags(kdfs)),
      card('hub.ciphers', tags(ciphers)),
      card('hub.encodings', tags(encodings)),
      card('hub.passwords', h('div', { class: 'ct-group' },
        h('div', { class: 'ct-tags' }, ALPHABETS.map((a) => h('span', { class: 'ct-tag', title: `${[...a.chars].length}` }, t('pw.grp.' + a.id))))),
      h('div', { class: 'ct-group' },
        h('div', { class: 'ct-tags' }, Object.entries(WORD_COUNTS).map(([k, n]) => h('span', { class: 'ct-tag' }, `${t('dict.' + k)} · ${fmtNum(n)}`)))))),
    h('p', { class: 'ed-hint', style: { marginTop: '16px' } }, t('hub.registry')),
    h('p', { class: 'ed-hint' }, t('hub.note')));
}

startShell('home', render);
render();
