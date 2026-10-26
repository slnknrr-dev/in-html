// walletui/mnemonic.js - recovery phrases in the wallet applications: the numbered word grid (hidden until revealed),
// the backup check that asks for a few words in random positions, and a phrase input with completion from the
// official BIP-39 lists, word-by-word validation and checksum feedback.
//
//   mnemonicGrid(phrase, { hidden = true }) -> element
//   backupCheck(phrase, { count = 3 }) -> Promise<boolean> (dialog)
//   mnemonicInput({ onChange(state) }) -> element with .value() and .state(): { phrase, ok, error, list, words }
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { openDialog } from '../ui/overlays.js';
import { iconEl } from '../ui/icons.js';
import { randomInt } from '../crypto/random.js';
import { WORDLISTS, checkMnemonic, completeWord, wordlistOf } from '../hdkey/bip39.js';

// NFKD per BIP-39 (the spec normalises mnemonics to NFKD before seeding); the ideographic space U+3000 separates
// Japanese words.
const wordsOf = (phrase) => String(phrase).normalize('NFKD').trim().split(/[\s　]+/).filter(Boolean);

export function mnemonicGrid(phrase, { hidden = true } = {}) {
  const words = String(phrase).trim().split(/[\s　]+/);
  const grid = h('ol', { class: 'wu-words' + (hidden ? ' wu-blur' : '') }, words.map((w) => h('li', null, h('span', { class: 'wu-word' }, w))));
  const reveal = h('button', { type: 'button', class: 'ed-btn', onclick: () => {
    const on = grid.classList.toggle('wu-blur');
    reveal.lastChild.textContent = on ? t('wu.reveal') : t('wu.hide');
  } }, iconEl('eye'), h('span', null, hidden ? t('wu.reveal') : t('wu.hide')));
  return h('div', { class: 'wu-col' }, h('div', { class: 'wu-warn-box' }, iconEl('warn'), t('wu.phraseWarn')), grid, h('div', { class: 'ap-row' }, reveal));
}

// Random positions from a CSPRNG (randomInt) so the user cannot pass by memorising "the first three words".
export function backupCheck(phrase, { count = 3 } = {}) {
  const words = wordsOf(phrase);
  const picks = new Set();
  while (picks.size < Math.min(count, words.length)) picks.add(randomInt(words.length));
  const order = [...picks].sort((a, b) => a - b);
  const inputs = order.map((i) => h('input', { class: 'ed-input', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'data-index': i, 'aria-label': t('wu.wordN', { n: i + 1 }) }));
  const msg = h('div', { class: 'wu-error', role: 'alert' });
  const body = h('div', { class: 'wu-col' }, h('p', null, t('wu.checkIntro')),
    ...order.map((i, k) => h('label', { class: 'ed-field ed-field-col' }, h('span', { class: 'ed-label' }, t('wu.wordN', { n: i + 1 })), inputs[k])), msg);
  return openDialog({
    title: t('wu.checkTitle'), body, className: 'wu-backup-dlg',
    buttons: [{ label: t('dlg.cancel'), value: false }, {
      label: t('wu.checkOk'), primary: true, value: true,
      onClick: () => {
        const ok = order.every((i, k) => inputs[k].value.normalize('NFKD').trim().toLowerCase() === words[i].toLowerCase());
        if (!ok) { msg.textContent = t('wu.checkFail'); return false; }
        return true;
      },
    }],
  }).then((v) => v === true);
}

export function mnemonicInput({ onChange = () => {} } = {}) {
  const ta = h('textarea', { class: 'ed-input ed-textarea wu-mono', rows: 3, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': t('wu.phrase') });
  const sugg = h('div', { class: 'wu-suggest' });
  const info = h('div', { class: 'wu-small' });
  let state = { phrase: '', ok: false, error: 'count', list: null, words: [] };
  const evaluate = () => {
    const phrase = ta.value;
    const words = wordsOf(phrase);
    const listName = wordlistOf(phrase) || 'english';
    const list = WORDLISTS[listName];
    const r = checkMnemonic(phrase, list);
    state = { phrase: words.join(listName === 'japanese' ? '　' : ' '), ok: r.ok, error: r.error, list: listName, words };
    info.className = 'wu-small ' + (r.ok ? 'wu-ok' : words.length ? 'wu-error' : 'wu-muted');
    info.textContent = !words.length ? t('wu.phraseHint') : r.ok ? t('wu.phraseOk', { n: words.length, list: t('wu.list.' + listName) })
      : r.error === 'word' ? t('wu.phraseBadWord', { word: r.words[r.bad[0]] }) : r.error === 'count' ? t('wu.phraseCount', { n: words.length }) : t('wu.phraseChecksum');
    // Completion of the word under the cursor.
    sugg.textContent = '';
    const before = ta.value.slice(0, ta.selectionStart);
    const cur = (before.match(/[^\s　]*$/) || [''])[0];
    if (cur.length >= 2) {
      for (const w of completeWord(cur, list, 6)) {
        if (w === cur) continue;
        sugg.append(h('button', { type: 'button', class: 'wu-chip', onclick: () => {
          const start = ta.selectionStart - cur.length;
          ta.value = ta.value.slice(0, start) + w + ' ' + ta.value.slice(ta.selectionStart);
          ta.focus();
          ta.selectionStart = ta.selectionEnd = start + w.length + 1;
          evaluate();
        } }, w));
      }
    }
    onChange(state);
  };
  ta.addEventListener('input', evaluate);
  ta.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow')) evaluate(); });
  const el = h('div', { class: 'wu-col' }, ta, sugg, info);
  el.value = () => state.phrase;
  el.state = () => state;
  el.input = ta;
  evaluate();
  return el;
}
