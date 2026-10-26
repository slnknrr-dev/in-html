// studio/anchors.js - the anchor field of the block inspector (products with P.anchors): a slug validated as you
// type, applied when the field is left; links to the old target are rewritten so menus and buttons keep working.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { toast } from '../ui/overlays.js';
import { anchorMap, anchorReserved, blockLabel, findBlock, remapAnchorRefs, slugify, uniqueAnchor } from './doc.js';
import { commit } from './history.js';
import { fid } from './fields.js';

//
// UX contract: validate on every keystroke (warning only), commit on change / Enter. Committing per keystroke would
// push one history entry and one link-remap pass per character and transiently rename links to half-typed slugs.
// a11y: the warning is a role=status live region and is prepended to aria-describedby while it applies, together
// with aria-invalid, so a screen reader announces both the problem and the hint.

// Links that pointed at the old target ('#old-anchor', or '#b-<id>' while the block had none) follow the change.
export function anchorField(bid) {
  const getBlock = () => findBlock(bid)?.block;
  const b0 = getBlock();
  const id = fid();
  const inp = h('input', {
    type: 'text', id, class: 'ed-input ed-anchor', value: b0?.anchor || '', spellcheck: 'false', autocomplete: 'off',
    autocapitalize: 'off', placeholder: 'about', 'aria-describedby': id + 'h',
  });
  const warn = h('div', { class: 'ed-hint ed-hint-warn', id: id + 'w', role: 'status', hidden: true });
  const hint = h('div', { class: 'ed-hint', id: id + 'h' });
  const paintHint = (a) => { hint.textContent = a ? t('ins.anchorHint', { anchor: a }) : t('ins.anchorNone'); };
  paintHint(b0?.anchor || '');
  // Returns '' (fine) or the message. Empty input is valid (= no anchor); a non-empty input that slugifies to ''
  // (only punctuation) is invalid. Reserved ids would collide with ids the exported page itself uses.
  const problem = (s, raw) => {
    if (!String(raw).trim()) return '';
    if (!s) return t('ins.anchorBad');
    if (anchorReserved(s)) return t('ins.anchorReserved', { anchor: s });
    const owner = anchorMap().get(s);
    if (owner && owner !== bid) return t('ins.anchorTaken', { anchor: s });
    return '';
  };
  const showWarn = (msg) => {
    warn.textContent = msg;
    warn.hidden = !msg;
    if (msg) { inp.setAttribute('aria-invalid', 'true'); inp.setAttribute('aria-describedby', id + 'w ' + id + 'h'); }
    else { inp.removeAttribute('aria-invalid'); inp.setAttribute('aria-describedby', id + 'h'); }
  };
  const apply = (raw) => {
    const s = String(raw || '').trim() ? slugify(raw) : '';
    const msg = problem(s, raw);
    const blk = getBlock();
    if (!blk) return;
    const old = blk.anchor || '';
    if (msg) { showWarn(msg); return; }
    showWarn('');
    inp.value = s;
    if (s === old) return;
    // Remap inside the same commit: anchor change and link rewrite are one undo step, never a dangling state.
    // 'b-<id>' is the implicit anchor every block has without an explicit one, so links survive set and clear alike.
    let n = 0;
    commit('anchor', (d) => {
      const fb = findBlock(bid, d);
      if (!fb) return;
      fb.block.anchor = s;
      n = remapAnchorRefs(d, old || 'b-' + bid, s || 'b-' + bid);
    }, { render: 'all' });
    paintHint(s);
    if (n) toast(t('ins.anchorLinks', { n }), 'ok');
  };
  inp.addEventListener('input', () => { const raw = inp.value; showWarn(problem(slugify(raw), raw)); });
  inp.addEventListener('change', () => apply(inp.value));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(inp.value); } });
  const sug = h('button', {
    type: 'button', class: 'ed-iconbtn', title: t('ins.anchorSuggest'), 'aria-label': t('ins.anchorSuggest'), html: icon('anchor'),
    onclick: () => {
      const blk = getBlock();
      if (!blk) return;
      const s = uniqueAnchor(blockLabel(blk).replace(/^#/, '') || t('b.' + blk.type), bid);
      inp.value = s;
      apply(s);
      try { inp.focus(); } catch { /* ignore */ }
    },
  });
  return h('div', { class: 'ed-field', dataset: { key: 'anchor' } },
    h('label', { for: id, class: 'ed-label' }, t('f.anchor')),
    h('div', { class: 'ed-row' }, h('span', { class: 'ed-anchor-hash', 'aria-hidden': 'true' }, '#'), inp, sug),
    warn, hint);
}
