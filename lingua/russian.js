// lingua/russian.js - Russian words taken apart into morphemes: prefixes, roots (with interfixes in compounds),
// suffixes, the ending and the postfix -ся / -сь; every morpheme with its meaning in English and Russian.
//
//   split(word) -> [{ parts: [{ s, role, gloss: { en, ru } }], score }]   (best first, at most 5)
//   ROOTS, PREFIXES, SUFFIXES, ENDINGS: the inventories ({ s: 'чувств', en, ru, alt: [...] })
//   translit(text) -> Latin (a simple, readable scheme)
//
// The analysis is by inventory, the way a school morphemic analysis works: it finds the readings in which every piece
// is a known morpheme and prefers known roots, fewer pieces and the commonest morphemes. It does not know the
// history of every word: the lessons tell the history (сочувствие: со- + чувств- = "feeling together").

// Inventory tables below (PREFIXES, ROOTS, SUFFIXES, ENDINGS): header comments only. Data shape [s, en, ru, alt?],
// mapped to objects at load. Allomorphs (без / бес, раз / рас) are separate entries rather than a rule, because the
// analysis matches surface strings.
export const PREFIXES = [
  ['без', 'without', 'без, отсутствие'], ['бес', 'without', 'без (перед глухой)'], ['вз', 'up', 'вверх'], ['вс', 'up', 'вверх (перед глухой)'],
  ['воз', 'up, back, in return', 'вверх, в ответ'], ['вос', 'up, back', 'вверх, в ответ'], ['в', 'in, into', 'внутрь'], ['во', 'in, into', 'внутрь'],
  ['вы', 'out', 'наружу, до конца'], ['до', 'up to, finishing', 'до предела, завершение'], ['за', 'behind, beginning', 'за, начало действия'],
  ['из', 'out of', 'изнутри наружу'], ['ис', 'out of', 'изнутри наружу'], ['на', 'on, onto, fully', 'на, до полноты'], ['над', 'above', 'над, сверху'],
  ['недо', 'under-, not enough', 'недостаточно'], ['не', 'not', 'отрицание'], ['обо', 'around, about', 'вокруг, охват'], ['об', 'around, about', 'вокруг, охват'],
  ['о', 'around, about', 'вокруг, охват'], ['ото', 'away', 'отделение'], ['от', 'away', 'отделение'], ['пере', 'across, over, again', 'через, заново, чрезмерно'],
  ['по', 'a little, along, beginning', 'немного, по поверхности, начало'], ['под', 'under, up to', 'под, приближение'], ['пред', 'before', 'перед, заранее'],
  ['пре', 'very; over', 'очень; через (пере)'], ['при', 'towards, attaching', 'приближение, присоединение'], ['про', 'through, past', 'сквозь, мимо'],
  ['раз', 'apart', 'в разные стороны'], ['рас', 'apart', 'в разные стороны (перед глухой)'], ['со', 'together, with', 'вместе, совместно'],
  ['с', 'together; down from', 'вместе; сверху вниз'], ['у', 'away; achieving', 'удаление; достижение'], ['низ', 'down', 'вниз'], ['нис', 'down', 'вниз'],
].map(([s, en, ru]) => ({ s, en, ru }));

// roots with their variants (alternations): s, en, ru, alt
export const ROOTS = [
  ['чувств', 'feel (old чу- "sense, perceive", as in чуять)', 'чувствовать (древнее чу- «ощущать», как в чуять)'], ['чу', 'sense, perceive', 'ощущать, чуять'],
  ['страд', 'suffer, toil', 'страдать, трудиться'], ['жив', 'live', 'жить', ['жи', 'жит']], ['вид', 'see', 'видеть', ['вид', 'виж']], ['вед', 'know', 'ведать, знать', ['вес', 'вещ']],
  ['зна', 'know', 'знать'], ['мысл', 'think', 'мыслить', ['мышл']], ['слов', 'word', 'слово'], ['мир', 'peace; world', 'мир, покой; вселенная'],
  ['люб', 'love', 'любить'], ['ход', 'go', 'ходить', ['хож', 'шед', 'ш']], ['нос', 'carry', 'носить', ['нош', 'нес']], ['вес', 'weigh', 'весить'],
  ['важ', 'weight, importance', 'вес, значимость'], ['благ', 'good', 'благо, добро'], ['дар', 'gift, give', 'дар, давать'], ['да', 'give', 'давать'],
  ['спас', 'save', 'спасать'], ['бог', 'god', 'бог'], ['здрав', 'healthy, whole', 'здоровый, целый', ['здоров', 'здрав']], ['прост', 'simple; forgive', 'простой; прощать', ['пращ', 'прощ']],
  ['вин', 'guilt', 'вина'], ['жал', 'pity', 'жалеть'], ['вяз', 'bind', 'связывать', ['вяж', 'яз']], ['глас', 'voice', 'голос', ['голос', 'глаш']],
  ['вест', 'news, knowing', 'весть, знание'], ['совест', 'conscience (co-knowledge)', 'совесть (со-знание)'], ['част', 'part, share', 'часть, доля', ['част', 'чащ']],
  ['пыт', 'try, inquire', 'пытать, узнавать'], ['льст', 'flatter, deceive', 'льстить, обольщать', ['лест', 'лесть']], ['зор', 'look', 'смотреть', ['зр', 'зир']],
  ['душ', 'soul, breath', 'душа, дыхание', ['дух', 'дыш']], ['рав', 'equal, even', 'равный', ['равн', 'ровн']], ['ним', 'take', 'брать (древнее ять, имать)', ['ня', 'ем', 'им', 'им']],
  ['уч', 'learn, teach', 'учить'], ['ум', 'mind', 'ум'], ['сердц', 'heart', 'сердце', ['серд', 'сердеч']], ['труд', 'labour', 'труд'], ['дел', 'do, make', 'делать'],
  ['бр', 'take', 'брать', ['бир', 'бор', 'бер']], ['ст', 'stand', 'стоять', ['ста', 'сто']], ['жд', 'wait', 'ждать'], ['мен', 'change, exchange', 'менять'],
  ['ряд', 'row, order', 'ряд, порядок'], ['лож', 'lay, put', 'класть', ['лаг', 'лог', 'лж']], ['пис', 'write', 'писать', ['пиш']], ['чит', 'read; count, honour', 'читать; считать, чтить', ['чет', 'чт']],
  ['говор', 'speak', 'говорить'], ['реч', 'speech', 'речь', ['рек', 'рок']], ['свет', 'light; world', 'свет', ['свеч', 'свещ']], ['свят', 'holy', 'святой', ['свящ']],
  ['стыд', 'shame', 'стыд', ['стыж']], ['добр', 'good', 'добрый'], ['зл', 'evil', 'злой'], ['вер', 'faith, trust', 'вера'], ['мил', 'dear, kind', 'милый'],
  ['сты', 'cold; shame', 'стыть'], ['гор', 'burn; grief', 'гореть; горе', ['жар', 'жог']], ['рад', 'glad', 'радость'], ['весел', 'merry', 'весёлый'],
  ['дум', 'think', 'думать'], ['вол', 'will', 'воля'], ['прав', 'right, true', 'правый, правда'], ['лик', 'face', 'лицо, облик', ['лиц', 'лич']],
  ['каз', 'show', 'показывать', ['каж']], ['раз', 'strike; image', 'удар; образ', ['раж']], ['род', 'kin, birth', 'род, рождение', ['рож']], ['мол', 'pray, ask', 'молить'],
  ['сыл', 'send', 'посылать', ['сл']], ['ступ', 'step', 'ступать'], ['мест', 'place', 'место', ['мещ']], ['треб', 'need, demand', 'требовать'],
  ['нуж', 'need', 'нужда', ['нужд']], ['бед', 'trouble', 'беда'], ['гост', 'guest', 'гость'], ['друг', 'friend', 'друг', ['друж']], ['лад', 'harmony', 'лад'],
  ['дом', 'home', 'дом'], ['пуст', 'empty; let go', 'пустой; пускать', ['пуск']],
  ['смысл', 'meaning (with-thought)', 'смысл (с-мысль)'], ['слух', 'hearing', 'слух', ['слыш', 'слуш']], ['вкус', 'taste', 'вкус'],
  ['тер', 'rub; lose', 'тереть; терять', ['тир', 'тр']], ['тех', 'comfort', 'утешение', ['тех', 'теш']], ['лич', 'person', 'личность'], ['смех', 'laugh', 'смех', ['смеш', 'сме']],
  ['печ', 'bake; care', 'печь; печься', ['пек']], ['пущ', 'let go', 'пускать'], ['сил', 'strength', 'сила'], ['мог', 'can, might', 'мочь', ['мож', 'мощ']],
].filter((r) => r[1]).map(([s, en, ru, alt]) => ({ s, en, ru, alt: alt || [] }));

export const SUFFIXES = [
  ['ствова', 'verb of a state', 'глагол состояния'], ['ств', 'state, quality (abstract noun)', 'состояние, качество'], ['ость', 'quality (abstract noun)', 'качество'], ['есть', 'quality', 'качество'],
  ['ени', 'action, result (noun)', 'действие, результат'], ['ани', 'action (noun)', 'действие'], ['ти', 'abstract noun', 'отвлечённое существительное'], ['тель', 'doer', 'деятель'],
  ['ник', 'person, thing', 'лицо, предмет'], ['щик', 'worker', 'работник'], ['чик', 'worker; little', 'работник; уменьшит.'], ['ист', 'person of a field', 'деятель области'],
  ['изм', 'doctrine', 'учение'], ['ниц', 'feminine; place', 'женский род; место'], ['иц', 'feminine; little', 'женский род; уменьшит.'], ['ок', 'little', 'уменьшит.'],
  ['ек', 'little', 'уменьшит.'], ['ик', 'little', 'уменьшит.'], ['к', 'noun-forming', 'образует существительное'], ['еньк', 'endearing', 'ласкательное'],
  ['оньк', 'endearing', 'ласкательное'], ['тельн', 'adjective of action', 'прилагательное действия'], ['альн', 'adjective', 'прилагательное'], ['н', 'adjective', 'прилагательное'],
  ['енн', 'adjective; participle', 'прилагательное; причастие'], ['нн', 'participle', 'причастие'], ['ов', 'adjective; belonging', 'прилагательное; принадлежность'], ['ев', 'adjective', 'прилагательное'],
  ['ск', 'adjective of relation', 'относительное прилагательное'], ['лив', 'inclined to', 'склонность'], ['чив', 'inclined to', 'склонность'], ['ив', 'having a quality', 'обладающий качеством'],
  ['ова', 'verb stem', 'основа глагола'], ['ева', 'verb stem', 'основа глагола'], ['ыва', 'repeated action', 'многократность'], ['ива', 'repeated action', 'многократность'],
  ['уй', 'imperative', 'повелительное наклонение'], ['ну', 'once', 'однократность'], ['у', 'verb stem (present)', 'основа настоящего'], ['ю', 'verb stem', 'основа'], ['и', 'verb stem', 'основа глагола'], ['е', 'verb stem', 'основа глагола'],
  ['а', 'verb stem', 'основа глагола'], ['я', 'verb stem', 'основа глагола'], ['ть', 'infinitive', 'инфинитив'], ['ти', 'infinitive', 'инфинитив'], ['л', 'past tense', 'прошедшее время'],
  ['вш', 'past participle', 'причастие прошедшего'], ['ущ', 'present participle', 'причастие настоящего'], ['ющ', 'present participle', 'причастие настоящего'],
  ['ащ', 'present participle', 'причастие настоящего'], ['ящ', 'present participle', 'причастие настоящего'], ['ем', 'passive participle', 'страдательное причастие'],
  ['им', 'passive participle', 'страдательное причастие'], ['о', 'adverb', 'наречие'], ['ен', 'adjective', 'прилагательное'], ['ин', 'one of; belonging', 'единичность; принадлежность'],
  ['уш', 'endearing', 'ласкательное'], ['ыш', 'young of', 'детёныш'], ['арь', 'person', 'лицо'], ['ар', 'person', 'лицо'], ['ость', 'quality', 'качество'],
].map(([s, en, ru]) => ({ s, en, ru }));

export const ENDINGS = ['ами', 'ями', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ешь', 'ишь', 'ете', 'ите', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ый', 'ий', 'ой', 'ей',
  'ую', 'юю', 'ом', 'ем', 'ам', 'ям', 'ах', 'ях', 'ов', 'ев', 'ет', 'ит', 'ут', 'ют', 'ат', 'ят', 'им', 'ым', 'их', 'ых', 'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'й', 'ь']
  .map((s) => ({ s, en: 'ending: case, number, person', ru: 'окончание: падеж, число, лицо' }));

const POSTFIX = [{ s: 'те', en: 'plural or polite imperative', ru: 'повелит. мн. ч. или вежливость' }, { s: 'ся', en: 'reflexive or mutual', ru: 'возвратность, взаимность' }, { s: 'сь', en: 'reflexive or mutual', ru: 'возвратность, взаимность' }];
const INTERFIX = [{ s: 'о', en: 'linking vowel of a compound', ru: 'соединительная гласная' }, { s: 'е', en: 'linking vowel of a compound', ru: 'соединительная гласная' }];

// Every root form (main and alternants) with its root, longest first: longer roots are tried first, and dedupe in
// split() keeps the first parts list for a key.
const rootForms = [];
for (const r of ROOTS) for (const f of [r.s, ...r.alt]) rootForms.push({ f, r });
rootForms.sort((a, b) => b.f.length - a.f.length);

const norm = (w) => String(w).toLowerCase().replace(/ё/g, 'е').trim();
const gloss = (m) => ({ en: m.en, ru: m.ru });

// all ways to write `s` as a sequence from `list` (each { s }), short lists only. Exponential in the worst case, so
// depth is capped (max pieces); inputs are word fragments of a few letters, which keeps it cheap.
function seqs(s, list, max = 4) {
  if (!s) return [[]];
  if (max === 0) return [];
  const out = [];
  for (const m of list) if (s.startsWith(m.s)) for (const rest of seqs(s.slice(m.s.length), list, max - 1)) out.push([m, ...rest]);
  return out;
}

// Every split of a word's tail into suffixes, an optional ending and an optional postfix. The postfix is stripped
// greedily (first match only).
// KNOWN DEFECT: POSTFIX lists 'те' first, so a verb in -ете / -ите (знаете) always loses 'те' to the postfix and the
// reading with the 'ете' ending is never produced. Fix: try both with and without the postfix, as done for endings.
function tails(s) {
  // suffixes* ending? postfix?
  const out = [];
  let core = s, post = null;
  for (const p of POSTFIX) if (core.endsWith(p.s)) { post = p; core = core.slice(0, -p.s.length); break; }
  const tryEnd = [null, ...ENDINGS.filter((e) => core.endsWith(e.s))];
  for (const e of tryEnd) {
    const mid = e ? core.slice(0, -e.s.length) : core;
    for (const sfx of seqs(mid, SUFFIXES, 4)) out.push([...sfx.map((m) => ({ s: m.s, role: 'suffix', gloss: gloss(m) })), ...(e ? [{ s: e.s, role: 'ending', gloss: gloss(e) }] : []), ...(post ? [{ s: post.s, role: 'postfix', gloss: gloss(post) }] : [])]);
  }
  return out;
}

// Score: share of the word covered by known roots (x2) dominates; then -0.08 per piece (parsimony), -0.05 per
// one-letter suffix (usually an artefact), +0.05 for having an ending. Every root form is tried at every position
// (indexOf loop), the head must be a prefix sequence (at most 3), the tail a suffix / ending / postfix sequence. No
// reading at all yields the whole word as an unknown root, so callers always get one reading.
export function split(word) {
  const w = norm(word);
  const results = [];
  const seen = new Set();
  const push = (parts) => {
    const key = parts.map((p) => p.s + ':' + p.role).join('|');
    if (seen.has(key) || parts.map((p) => p.s).join('') !== w) return;
    seen.add(key);
    const roots = parts.filter((p) => p.role === 'root');
    const known = roots.reduce((a, p) => a + p.s.length, 0);
    const score = known / w.length * 2 - parts.length * 0.08 - parts.filter((p) => p.role === 'suffix' && p.s.length === 1).length * 0.05 + (parts.some((p) => p.role === 'ending') ? 0.05 : 0);
    results.push({ parts, score: Math.round(score * 1000) / 1000 });
  };
  for (const { f, r } of rootForms) {
    let at = w.indexOf(f);
    while (at >= 0) {
      const head = w.slice(0, at), tail = w.slice(at + f.length);
      const pres = seqs(head, PREFIXES, 3);
      for (const pre of pres) {
        const preParts = pre.map((m) => ({ s: m.s, role: 'prefix', gloss: gloss(m) }));
        const rootPart = { s: f, role: 'root', gloss: gloss(r) };
        for (const t of tails(tail)) push([...preParts, rootPart, ...t]);
        // compound: root + interfix + second root + tail
        for (const ix of INTERFIX) {
          if (!tail.startsWith(ix.s)) continue;
          const after = tail.slice(1);
          for (const { f: f2, r: r2 } of rootForms) {
            if (!after.startsWith(f2)) continue;
            for (const t of tails(after.slice(f2.length))) push([...preParts, rootPart, { s: ix.s, role: 'interfix', gloss: gloss(ix) }, { s: f2, role: 'root', gloss: gloss(r2) }, ...t]);
          }
        }
      }
      at = w.indexOf(f, at + 1);
    }
  }
  results.sort((a, b) => b.score - a.score);
  if (!results.length) return [{ parts: [{ s: w, role: 'root', gloss: { en: '?', ru: '?' } }], score: 0 }];
  return results.slice(0, 5);
}

// Learner transliteration (not a standard: ICAO lives in translit.js). Case: lower stays lower, a capital capitalises
// the first letter of a multi-letter output (Ж -> Zh).
const TR = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '"', 'ы': 'y', 'ь': "'", 'э': 'e', 'ю': 'yu', 'я': 'ya' };
export function translit(text) {
  return String(text).replace(/[а-яё]/gi, (c) => { const l = c.toLowerCase(), t = TR[l] ?? c; return c === l ? t : t.charAt(0).toUpperCase() + t.slice(1); });
}
