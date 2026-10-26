// prosody/morph.js - morphemes of a word through lingua/ (Russian, English and Georgian morpheme parsers; the Georgian
// grammar and lexicon for known words), and the split of a word into the part a rhyme keeps and the ending it may change.
//
//   morphemes(word, lang) -> { parts: [{ s, role, gloss }], pos, rule, attested, source } | null
//   splitEnding(word, lang) -> { stem, ending, post, pos, parts, lex? }
//     ending: the inflection (Russian / Georgian case or person ending, English -s / -ed / -ing …), post: what follows it
//     (-ся, a Georgian postposition), pos: 'n' | 'a' | 'v' | 'adv' | null; lex: the Georgian lexicon entry when known
import { parseRu } from '../lingua/morph-ru.js';
import { parseEn } from '../lingua/morph-en.js';
import { parseKa } from '../lingua/morph-ka.js';
import { analyzeWord as analyzeKaWord } from '../lingua/kartuli-grammar.js';
import { normWord } from './words.js';
import { knownRu } from './phon-ru.js';

const ENDING_ROLES = new Set(['ending', 'plural', 'case']);
const POST_ROLES = new Set(['post', 'postfix']);

export function morphemes(word, lang) {
  const w = normWord(word, lang).replace(/'/g, '');
  if (!w || w.includes('-')) return null;
  if (lang === 'ka') {
    const g = analyzeKaWord(w)[0];
    if (g && g.parts && g.parts.map((p) => p.s).join('') === w) {
      return { parts: g.parts.map((p) => ({ s: p.s, role: p.role === 'stem' ? 'root' : p.role, gloss: null, tag: p.tag || null })), pos: g.pos === 'v' ? 'v' : g.pos === 'a' ? 'a' : 'n', rule: null, attested: true, source: 'grammar', lex: g.lex, tags: g.tags };
    }
  }
  let r = null;
  try { r = (lang === 'ru' ? parseRu : lang === 'ka' ? parseKa : parseEn)(w)[0] || null; } catch { r = null; }
  if (!r) return null;
  const pos = r.rule && ['n', 'a', 'v', 'adv'].includes(r.rule.pos) ? r.rule.pos : null;
  return { parts: r.parts.map((p) => ({ s: p.s, role: p.role, gloss: p.gloss || null, tag: p.tag || null })), pos, rule: r.rule || null, attested: !!r.attested, source: 'morph' };
}

const RU_VERB_END = /(ть|ти|чь|л|ла|ло|ли|ешь|ет|ем|ете|ут|ют|ишь|ит|им|ите|ат|ят|й|йте|в|вши)$/;
const RU_NOUN_END = /(ами|ями|ой|ей|ою|ею|ом|ем|ах|ях|ов|ев|ам|ям|а|я|о|е|ы|и|у|ю)$/;
const RU_ADJ_END =/(ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ую|юю|ых|их|ыми|ими)$/;

export function splitEnding(word, lang) {
  const w = normWord(word, lang).replace(/'/g, '');
  const m = morphemes(w, lang);
  let parts = m ? m.parts : [{ s: w, role: 'root' }];
  let post = '';
  while (parts.length > 1 && POST_ROLES.has(parts[parts.length - 1].role)) { post = parts[parts.length - 1].s + post; parts = parts.slice(0, -1); }
  let ending = '';
  while (parts.length > 1 && ENDING_ROLES.has(parts[parts.length - 1].role)) { ending = parts[parts.length - 1].s + ending; parts = parts.slice(0, -1); }
  let stem = parts.map((p) => p.s).join('');
  let pos = m ? m.pos : null;
  // what the parsers leave inside the stem for English inflections
  if (lang === 'en' && !ending) {
    const x = /^(.{2,}?)(ing|ed|es|s|er|est|ly)$/.exec(stem);
    if (x && !/(ss|us|is)$/.test(stem)) { stem = x[1]; ending = x[2]; }
  }
  if (lang === 'ru' && !pos) {
    // the dictionary decides between a noun and an adjective (полосой: полоса; золотой: золотая)
    const adj = RU_ADJ_END.exec(w);
    const base = adj ? w.slice(0, -adj[0].length) : null;
    if (adj && ['ая', 'ое', 'ые', 'ую'].some((e) => knownRu(base + e))) pos = 'a';
    else if (RU_NOUN_END.test(w) && ['а', 'я', 'ы', 'и', 'у', 'ом', 'ой', 'ам', ''].some((e) => knownRu(w.replace(RU_NOUN_END, '') + e) && w.replace(RU_NOUN_END, '') + e !== w)) pos = 'n';
    else pos = adj ? 'a' : RU_VERB_END.test(w) ? 'v' : 'n';
  }
  // an ending the parser kept in the stem (полосой → полос + ой)
  if (lang === 'ru' && !ending) {
    const re = pos === 'a' ? RU_ADJ_END : pos === 'v' ? /(ешь|ет|ем|ете|ут|ют|ишь|ит|им|ите|ат|ят|ть|ти)$/ : RU_NOUN_END;
    const x = re.exec(stem);
    if (x && /[аеёиоуыэюя]/.test(stem.slice(0, -x[0].length))) { ending = x[0]; stem = stem.slice(0, -x[0].length); }
  }
  if (stem + ending + post !== w) { stem = w.slice(0, w.length - ending.length - post.length); }
  return { stem, ending, post, pos, parts: m ? m.parts : [{ s: w, role: 'root' }], lex: m && m.lex ? m.lex : null, tags: m && m.tags ? m.tags : null };
}
