// lingua/morph.js - a morpheme parser that works before (and beside) a dictionary: a word is cut into slots
// (prefixes / preverbs, markers, one or two roots, suffixes, an ending, a postfix) by inventories of known pieces,
// with an unknown root allowed when nothing else fits; every reading is matched against derivation rules, so the
// parser can name the probable rule and the meaning it gives ("უ- + სახლ + -ო: without a house"). Attested words
// carry register labels; a well-formed word that no source attests gets labels by rule — correct formation, not
// found in literature, its own meaning from the rule.
//
//   createMorph(spec) -> { parse(word, { max = 5 }) -> [reading], explain(reading, lang) -> text, spec }
//   spec = { lang, norm(w) -> w, slots: [{ role, items: [item], min = 0, max = 1, after? (only right after a piece of
//            that role), gain? (the weight of a root here) }], rules: [rule],
//            exceptions: { word: 'pre+root+suf' }, attested(word) -> labels | null, unknownRoot: { min, penalty } }
//   item = { s, alt?: [s], tag?, gloss: { ru, en }, w?: weight, pos? }      (roots: role 'root')
//   rule = { id, need: { role: [tag | s] | true }, not?: { role: [...] }, pos, mean: { ru, en } ('{root}' is the
//            root's gloss), name: { ru, en } }
//   reading = { parts: [{ s, role, item, gloss, tag }], root, rule: { id, name, mean } | null, score, unknown,
//               labels: { use, norm, lit, own }, attested }
//
//   LABELS: the label values with names in ru / en:
//     use (обиход): everyday · common · rare · special · dialect · slang
//     norm (корректность): norm · colloquial · substandard · questionable
//     lit (литературность): literary · neutral · bookish · archaic · poetic · unattested
//   labelText(labels, lang) -> 'everyday · norm · literary'      matchLabels(labels, filter) -> boolean

// Algorithm in one paragraph: a depth-first walk over the slots in fixed order; inside a slot each step consumes one
// inventory piece found by a trie at the current position, or (root slot only) an arbitrary unknown stretch. Complete
// cuts (whole word consumed, at least one root) are scored, deduplicated, then matched against the rules. Why
// enumeration, not a finite-state transducer: inventories are tiny and authored by hand, readings must be ranked and
// explained, and a plain DFS with a score is debuggable by reading the parts.

export const LABELS = {
  use: { everyday: { ru: 'обиходное', en: 'everyday' }, common: { ru: 'общеупотребительное', en: 'common' }, rare: { ru: 'редкое', en: 'rare' }, special: { ru: 'специальное', en: 'special' }, dialect: { ru: 'диалектное', en: 'dialect' }, slang: { ru: 'жаргон', en: 'slang' } },
  norm: { norm: { ru: 'нормативно', en: 'standard' }, colloquial: { ru: 'разговорно', en: 'colloquial' }, substandard: { ru: 'просторечно', en: 'substandard' }, questionable: { ru: 'сомнительно', en: 'questionable' } },
  lit: { literary: { ru: 'литературное', en: 'literary' }, neutral: { ru: 'нейтральное', en: 'neutral' }, bookish: { ru: 'книжное', en: 'bookish' }, archaic: { ru: 'устаревшее', en: 'archaic' }, poetic: { ru: 'поэтическое', en: 'poetic' }, unattested: { ru: 'не встречается в литературе', en: 'not found in literature' } },
};
export const OWN = { ru: 'но имеет собственное значение по правилу', en: 'but has its own meaning by rule' };

export function labelText(l, lang = 'ru') {
  if (!l) return '';
  const out = ['use', 'norm', 'lit'].map((k) => l[k] && LABELS[k][l[k]] && LABELS[k][l[k]][lang]).filter(Boolean);
  if (l.own) out.push(OWN[lang]);
  return out.join(' · ');
}
// Filter semantics: per dimension, an absent or empty list matches anything; otherwise the label must be listed.
export const matchLabels = (l, f = {}) => ['use', 'norm', 'lit'].every((k) => !f[k] || !f[k].length || (l && f[k].includes(l[k])));

// Labels of a dictionary word from its frequency tier (1 most frequent … 3) and explicit flags.
export function labelsFromTier(tier, flags = {}) {
  return { use: flags.use || (tier === 1 ? 'everyday' : tier === 2 ? 'common' : 'rare'), norm: flags.norm || 'norm', lit: flags.lit || (tier === 3 ? 'bookish' : 'neutral'), own: false };
}

// Flags written in data lines: !col !sub !rare !lit !book !arch !poet !dial !slang !spec !every !q
export function parseFlags(str = '') {
  const f = {};
  for (const x of String(str).split(/[\s,]+/).filter(Boolean)) {
    switch (x.replace(/^!/, '')) {
      case 'col': f.norm = 'colloquial'; break;
      case 'sub': f.norm = 'substandard'; break;
      case 'q': f.norm = 'questionable'; break;
      case 'rare': f.use = 'rare'; break;
      case 'every': f.use = 'everyday'; break;
      case 'spec': f.use = 'special'; break;
      case 'dial': f.use = 'dialect'; break;
      case 'slang': f.use = 'slang'; break;
      case 'lit': f.lit = 'literary'; break;
      case 'book': f.lit = 'bookish'; break;
      case 'arch': f.lit = 'archaic'; break;
      case 'poet': f.lit = 'poetic'; break;
      default: break;
    }
  }
  return f;
}

// A trie of the surface forms of a slot's items (main form and alternants). Map children keyed by character; the
// key '\u0000' (never a letter of a normalised word) holds the items that end at this node, so prefixes of one
// another ('in' / 'inter') coexist. Iteration uses for...of, i.e. code points, which is safe for every script here.
function trie(items) {
  const root = new Map();
  for (const it of items) for (const s of [it.s, ...(it.alt || [])].filter((x) => typeof x === 'string')) {
    if (!s) continue;
    let node = root;
    for (const ch of s) { if (!node.has(ch)) node.set(ch, new Map()); node = node.get(ch); }
    if (!node.has('\u0000')) node.set('\u0000', []);
    node.get('\u0000').push({ s, it });
  }
  return root;
}
// Every inventory piece that starts at w[i], shortest first, lazily (a generator): the caller can stop early and
// no array is allocated per position. Note: w is indexed by UTF-16 unit while the trie was built per code point;
// identical for the BMP scripts used (Latin, Cyrillic, Georgian).
function* matchesAt(t, w, i) {
  let node = t;
  for (let k = i; k < w.length; k++) {
    node = node.get(w[k]);
    if (!node) return;
    const end = node.get('\u0000');
    if (end) for (const m of end) yield { ...m, end: k + 1 };
  }
}

// Templates: {root} the root's gloss; {pv} / {prefix} / {suffix} / {ending} / {post} the gloss of that piece.
const fill = (tpl, root, parts = [], lang = 'ru') => String(tpl || '').replace(/\{root\}/g, root || '…').replace(/\{(pv|prefix|suffix|ending|post)\}/g, (_, k) => {
  const role = k === 'pv' ? 'preverb' : k;
  const p = parts.find((x) => x.role === role);
  return p && p.gloss ? p.gloss[lang] || '' : '';
});

export function createMorph(spec) {
  const norm = spec.norm || ((w) => String(w).toLowerCase().trim());
  const slots = spec.slots.map((sl) => ({ min: 0, max: 1, ...sl, t: trie(sl.items || []) }));
  const unknown = spec.unknownRoot || { min: 2, penalty: 3 };
  const rules = spec.rules || [];

  // Most specific rule wins: a matched tag / form list scores 2, a mere presence requirement (true) 1, plus the
  // rule's prio. `not` and `rootPos` are vetoes. Strict '>' keeps the earlier rule on a tie, so rule order in the
  // spec is the final tie-break. A root without pos passes any rootPos (unknown roots must not lose every rule).
  function ruleFor(parts) {
    let best = null, bestN = -1;
    for (const r of rules) {
      let ok = true, n = 0;
      for (const [role, want] of Object.entries(r.need || {})) {
        const ps = parts.filter((p) => p.role === role);
        if (want === true) { if (!ps.length) ok = false; else n++; continue; }
        if (!ps.some((p) => want.includes(p.tag) || want.includes(p.s) || (p.item && want.includes(p.item.s)))) ok = false; else n += 2;
      }
      for (const [role, bad] of Object.entries(r.not || {})) if (parts.some((p) => p.role === role && (bad === true || bad.includes(p.tag) || bad.includes(p.s)))) ok = false;
      if (r.rootPos && !parts.some((p) => p.role === 'root' && (!p.item.pos || r.rootPos.includes(p.item.pos)))) ok = false;
      n += r.prio || 0;
      if (ok && n > bestN) { best = r; bestN = n; }
    }
    if (best) best = { ...best, n: bestN };
    return best;
  }

  function parse(word, { max = 5 } = {}) {
    const w = norm(word);
    if (!w) return [];
    if (spec.exceptions && spec.exceptions[w]) return [exceptionReading(w, spec.exceptions[w])];
    const out = [];
    // Depth-first over slots; each slot takes between min and max pieces. Arguments: i position in w, si slot index,
    // taken pieces already in this slot, parts the shared stack (push / pop, no copies until a reading completes),
    // score so far, unk whether an unknown root was used (at most one per reading, or the search explodes and any
    // word parses as one unknown root). The 3000-reading cap is a safety valve against pathological inventories.
    const walk = (i, si, taken, parts, score, unk) => {
      if (out.length > 3000) return;
      if (si === slots.length) { if (i === w.length && parts.some((p) => p.role === 'root')) out.push({ parts: parts.slice(), score, unknown: unk }); return; }
      const sl = slots[si];
      if (taken >= sl.min) walk(i, si + 1, 0, parts, score, unk);
      if (taken >= sl.max || i >= w.length) return;
      // A slot that only follows another (the second root of a compound after its linking vowel).
      if (sl.after && !(parts.length && parts[parts.length - 1].role === sl.after)) return;
      for (const m of matchesAt(sl.t, w, i)) {
        parts.push({ s: m.s, role: sl.role, item: m.it, gloss: m.it.gloss, tag: m.it.tag });
        // A second root (a compound) costs more than an affix reading of the same letters.
        // Score per piece: roots earn +3 (first root of the slot) or the slot's gain, +0.5 if longer than 2 letters,
        // -0.6 if 1..2 letters (short roots are usually accidental matches); an affix earns 0.2. Item weight w adds,
        // and every piece costs 0.35, so among equal analyses fewer, longer pieces win (parsimony).
        const rootGain = sl.role === 'root' ? (sl.gain != null ? sl.gain : taken ? 0 : 3) + (m.s.length > 2 ? 0.5 : -0.6) : 0.2;
        walk(m.end, si, taken + 1, parts, score + rootGain + (m.it.w || 0) - 0.35, unk);
        parts.pop();
      }
      // An unknown root: a stretch no inventory knows (the word is new, or the root is not seeded).
      if (sl.role === 'root' && !unk && taken === 0) {
        for (let e = i + unknown.min; e <= w.length; e++) {
          const s = w.slice(i, e);
          parts.push({ s, role: 'root', item: { s, gloss: null }, gloss: null, tag: 'unknown' });
          // Penalty grows with length, so an unknown root never beats a known affix analysis of the same letters.
          walk(e, si, taken + 1, parts, score - unknown.penalty - 0.08 * s.length, true);
          parts.pop();
        }
      }
    };
    walk(0, 0, 0, [], 0, false);
    // The same cut can be reached through different alternants / slots; the key (form + role per part) dedupes.
    // KNOWN DEFECT: the list is cut to `max` by the pre-rule score, then finish() adds rule and attestation bonuses
    // and re-sorts; a reading just below the cut that would have won with its rule bonus is lost. Fix: finish() every
    // deduped reading (or the top max * 3), sort, then slice(0, max).
    const seen = new Set();
    const res = [];
    for (const r of out.sort((a, b) => b.score - a.score)) {
      const key = r.parts.map((p) => p.s + ':' + p.role).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      res.push(finish(w, r));
      if (res.length >= max) break;
    }
    return res.sort((a, b) => b.score - a.score);
  }

  // Reading -> public record. Labels: attested words take their source labels; an unattested word that a rule
  // explains is 'rare / unattested' with own: true (well formed, its meaning follows from the rule); with no rule it
  // is 'questionable'. Bonuses: +0.8 + 0.35 x rule specificity for an explaining rule, +2 for attestation.
  function finish(w, r) {
    const rule = ruleFor(r.parts);
    const root = r.parts.filter((p) => p.role === 'root');
    const rootGloss = root.map((p) => (p.gloss ? p.gloss.ru || '' : p.s)).join(' + ');
    const rootGlossEn = root.map((p) => (p.gloss ? p.gloss.en || '' : p.s)).join(' + ');
    const att = spec.attested ? spec.attested(w) : null;
    const labels = att || (rule ? { use: 'rare', norm: r.unknown ? 'questionable' : 'norm', lit: 'unattested', own: true } : { use: 'rare', norm: 'questionable', lit: 'unattested', own: false });
    return {
      word: w, parts: r.parts, unknown: r.unknown, root: root.map((p) => p.s).join('+'),
      rule: rule ? { id: rule.id, name: rule.name, pos: rule.pos, mean: { ru: fill(rule.mean.ru, rootGloss, r.parts, 'ru'), en: fill(rule.mean.en, rootGlossEn, r.parts, 'en') } } : null,
      score: r.score + (rule ? 0.8 + 0.35 * rule.n : 0) + (att ? 2 : 0), labels, attested: !!att,
    };
  }

  // Hand-written cut for words the walk gets wrong: plan is 'piece:role+piece:role', a chunk without ':role' is a
  // root. Items are looked up in the slot inventories so glosses and tags still apply. Score 10 puts it above any
  // computed reading.
  function exceptionReading(w, plan) {
    const parts = plan.split('+').map((chunk) => {
      const [s, role = 'root'] = chunk.split(':');
      const sl = slots.find((x) => x.role === role);
      const item = sl && (sl.items || []).find((it) => it.s === s || (it.alt || []).includes(s));
      return { s, role, item: item || { s }, gloss: item ? item.gloss : null, tag: item ? item.tag : null };
    });
    return { ...finish(w, { parts, score: 10, unknown: false }), exception: true };
  }

  function explain(r, lang = 'ru') {
    const pieces = r.parts.map((p) => (p.role === 'root' ? p.s : p.role === 'prefix' || p.role === 'preverb' ? p.s + '-' : '-' + p.s)).join(' + ');
    return pieces + (r.rule ? ': ' + r.rule.mean[lang] : '');
  }

  return { parse, explain, spec, ruleFor };
}
