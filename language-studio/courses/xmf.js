// language-studio/courses/xmf.js - Mingrelian (მარგალური ნინა, xmf) for those who read Georgian or are learning it,
// explained in Russian and English: the Mkhedruli letters with the Mingrelian additions ჷ ჸ ჲ, the sound
// correspondences with Georgian (the heart of the course), greetings, numbers, cases, the verb, words by theme from
// the lexicon of lingua/megruli.js, sample sentences and grammar notes. Every form the references did not confirm
// carries `unverified: true` and a ⚠ mark in its note.
//
// Structure (data, not logic; reviewed for content, not commented line by line):
//   tables first (letters as compact arrays or util.js words() text blocks), then SECTIONS (lessons), then COURSE:
//   { id, native, speech (BCP 47 tag for speech.js), explain: [explanation languages], script (FONTS key),
//     name: { per UI language }, scripts: [{ id, name, letters }], tools: [tool ids of tools.js], games, sections }.
//   A section: { id, kind ('words' | 'text' | 'dialogue' | 'poem' | ...), topic, title, words | blocks | lines }.
//   Ids are stable on purpose: spaced-repetition items are keyed "<course>:<section>:<word>" (index.js wordId), so
//   renaming a section id or a word orphans the learner's progress for it.
import { T } from './util.js';
import { LETTERS as KA_LETTERS } from './ka.js';
import {
  ALPHABET, NOT_USED, LEXICON, GROUPS, RULES, EPENTHESIS, CASES, PREVERBS, VERBS, EXCEPTIONS,
  decline, present, imperfect, aorist, explainPair, ruleById, translit, lexStats,
} from '../../lingua/megruli.js';

const UNV = T('⚠ не проверено по источникам', '⚠ not confirmed in the references');
const tr = (w) => translit(w, 'lat');
const mark = (u, s) => (u ? '⚠ ' + s : s);

// --- letters -----------------------------------------------------------------------------------------------------
const kaHint = new Map(KA_LETTERS.map((l) => [l.ch, l.hint.ru]));
export const LETTERS = ALPHABET.map((a) => ({
  ch: a.ch, tr: a.lat, ipa: a.ipa, name: a.name,
  hint: a.note ? { ru: a.note.ru, en: a.note.en } : { ru: (kaHint.get(a.ch) || a.ru) + ' — как в грузинском', en: `/${a.ipa}/ — as in Georgian` },
}));
// The letters to practise apart: the three additions and the sounds they are confused with.
const HARD = ['ჷ', 'ჸ', 'ჲ', 'ყ', 'ქ', 'კ', 'ღ', 'ხ', 'ჰ', 'ი'];
export const HARD_LETTERS = HARD.map((ch) => LETTERS.find((l) => l.ch === ch));

// --- words from the lexicon --------------------------------------------------------------------------------------
const RULE_SHORT = (id) => {
  const r = ruleById(id);
  if (!r) return { ru: id, en: id };
  return r.id === 'epenthesis' ? { ru: 'вставной гласный', en: 'inserted vowel' } : { ru: `${r.ka} → ${r.xmf}`, en: `${r.ka} → ${r.xmf}` };
};
export function cognateNote(e) {
  if (!e.ka) return null;
  const ex = explainPair(e.w, e.ka);
  const rules = ex.rules.map(RULE_SHORT);
  const how = (l) => (e.w === e.ka ? (l === 'ru' ? 'то же слово' : 'the same word') : rules.length ? rules.map((r) => r[l]).join('; ') + (ex.reached ? '' : l === 'ru' ? '; и нерегулярные изменения' : '; plus irregular changes') : l === 'ru' ? 'нерегулярные изменения' : 'irregular changes');
  const sure = (l) => (e.kaSure ? '' : l === 'ru' ? ' (родство предположительно)' : ' (the kinship is a proposal)');
  return { ru: `груз. ${e.ka}${sure('ru')}: ${how('ru')}`, en: `Georgian ${e.ka}${sure('en')}: ${how('en')}` };
}
const wordOf = (e) => {
  const cog = cognateNote(e);
  const parts = { ru: [e.unverified ? UNV.ru : '', cog ? cog.ru : ''].filter(Boolean).join(' · '), en: [e.unverified ? UNV.en : '', cog ? cog.en : ''].filter(Boolean).join(' · ') };
  return { w: e.w, tr: tr(e.w), m: { ru: e.ru, en: e.en }, ...(parts.ru ? { note: parts } : {}), group: GROUPS[e.group].ru, unverified: e.unverified, ka: e.ka };
};
const lexWords = (groups) => LEXICON.filter((e) => groups.includes(e.group)).map(wordOf);

// Greetings and phrases: `phrase | ru | en | Georgian equivalent | flags` (`?` unverified).
const PHRASES = `
გომორძგუა | здравствуйте (приветствие-пожелание) | hello (a greeting, a wish) | გაგიმარჯოს | ?
მარდი | спасибо | thank you | მადლობა |
ბრელი მარდი | большое спасибо | thank you very much | დიდი მადლობა | ?
მუჭო რექ? | как ты? | how are you? | როგორ ხარ? | ?
ჯგირო | хорошо | well, fine | კარგად | ?
ქო | да | yes | კი, ჰო | ?
ვარ | нет | no | არა |
ვა მიჩქუ | не знаю | I don't know | არ ვიცი |
მიჸორქ | я тебя люблю | I love you | მიყვარხარ | ?
ჩქიმი ჯოხო რე… | меня зовут… (мое имя — …) | my name is… | ჩემი სახელია… | ?
სქანი ჯოხო მუ რე? | как тебя зовут? | what is your name? | შენი სახელი რა არის? | ?
მორთი! | иди сюда! заходи! | come (here)! | მოდი! | ?
`;
const phraseWords = PHRASES.trim().split('\n').map((line) => {
  const [w, ru, en, ka, flags = ''] = line.split('|').map((s) => s.trim());
  const u = flags.includes('?');
  return { w, tr: tr(w), m: { ru, en }, note: { ru: [u ? UNV.ru : '', 'по-грузински: ' + ka].filter(Boolean).join(' · '), en: [u ? UNV.en : '', 'in Georgian: ' + ka].filter(Boolean).join(' · ') }, unverified: u };
});

// --- tables made from the grammar --------------------------------------------------------------------------------
const KA_CASES = { nom: 'კაცი', erg: 'კაცმა', dat: 'კაცს', gen: 'კაცის', ins: 'კაცით', adv: 'კაცად', all: '(კაცისკენ)', abl: '(კაცისგან)', cau: '(კაცისთვის)' };
const caseRows = (noun, withKa) => decline(noun).sg.map((f) => {
  const c = CASES.find((x) => x.id === f.id);
  return [c.ru + ' · ' + c.en, mark(f.unverified, f.form), tr(f.form), ...(withKa ? [KA_CASES[f.id]] : [])];
});
const KA_WRITE = ['ვწერ', 'წერ', 'წერს', 'ვწერთ', 'წერთ', 'წერენ'];
const PRON = { '1sg': 'მა', '2sg': 'სი', '3sg': 'თინა', '1pl': 'ჩქი', '2pl': 'თქვა', '3pl': 'თინეფი' };
const write = VERBS.find((v) => v.id === 'write');
const verbRows = (make, withKa) => make(write).map((f, i) => [`${PRON[f.s]} (${f.s})`, mark(f.unverified, f.form), f.parts.map((p) => p.s).join('-'), ...(withKa ? [KA_WRITE[i]] : [])]);
const ruleRows = [...RULES, EPENTHESIS].map((r) => [r.id === 'epenthesis' ? '+ ი / ო / უ' : `${r.ka} → ${r.xmf}`, r.ru + (r.sporadic && r.id !== 'epenthesis' ? ' (в отдельных словах)' : ''), r.ex.map(([k, x]) => `${k} → ${x}`).join(', ')]);
const pairRows = LEXICON.filter((e) => e.ka && e.ka !== e.w && e.kaSure && explainPair(e.w, e.ka).reached).slice(0, 30)
  .map((e) => [e.ka, e.w, e.ru, explainPair(e.w, e.ka).rules.map((id) => RULE_SHORT(id).ru).join('; ')]);

// --- expressions taken apart (parts add up to the word) ------------------------------------------------------------
export const EXPRESSIONS = [
  { w: 'სამარგალო', tr: 'samargalo', m: T('Мегрелия', 'Mingrelia'), parts: [['სა', 'конфикс места са-…-о (как в груз. სა-მეგრ-ელ-ო)'], ['მარგალ', '«мегрел» (груз. მეგრელ-: э → а, перестановка р)'], ['ო', 'конец конфикса']], lit: T('«место мегрелов»', '"the place of the Mingrelians"'), note: T('Грузинское სამეგრელო и мегрельское სამარგალო — одно слово: э ↔ а дважды, и звуки რ, გ переставлены (მეგრ- ↔ მარგ-).', 'Georgian სამეგრელო and Mingrelian სამარგალო are one word: e ↔ a twice, and r, g change places (megr- ↔ marg-).') },
  { w: 'მარგალური', tr: 'margaluri', m: T('мегрельский', 'Mingrelian'), parts: [['მარგალ', '«мегрел»'], ['ურ', 'суффикс принадлежности: груз. -ულ- (л ↔ р)'], ['ი', 'именительный падеж']], lit: T('«мегрельский»: მარგალური ნინა — мегрельский язык', '"Mingrelian": მარგალური ნინა — the Mingrelian language'), note: T('Груз. მეგრ-ულ-ი: тот же суффикс, только ლ ↔ რ. Так же ქართ-ულ-ი ↔ ქორთ-ულ-ი (здесь ლ сохранился).', 'Georgian megr-ul-i: the same suffix, only l ↔ r. Likewise kart-ul-i ↔ kort-ul-i (here l stays).') },
  { w: 'ვჭარუნქ', tr: "vch'arunk", m: T('я пишу', 'I write'), parts: [['ვ', '1-е лицо субъекта (как в груз.)'], ['ჭარ', 'корень «писать»: груз. წერ (ц’ → ч’, э → а)'], ['უ', 'тематический суффикс'], ['ნ', 'показатель серии настоящего'], ['ქ', 'окончание 1-го / 2-го лица ед. ч.']], lit: T('груз. ვწერ', 'Georgian ვწერ'), note: T('Главное отличие от грузинского — окончание -ქ у 1-го и 2-го лица: ვჭარუნქ «пишу», ჭარუნქ «пишешь», но ჭარუნს «пишет» (как груз. წერს).', 'The main difference from Georgian is the ending -k in the 1st and 2nd person: ვჭარუნქ "I write", ჭარუნქ "you write", but ჭარუნს "writes" (Georgian წერს).') },
  { w: 'ოხორიშა', tr: 'okhorisha', m: T('к дому, домой', 'to the house, home'), parts: [['ოხორ', '«дом» (ოხორი)'], ['იშა', 'направительный падеж: «куда, к»']], lit: T('«к дому»', '"towards the house"'), note: T('В грузинском такого падежа нет: там послелог -კენ («к») или -ში («в»). Ср. ოხორიშე «из дома» (исходный падеж).', 'Georgian has no such case: it uses -ken ("towards") or -shi ("into"). Cf. ოხორიშე "from the house" (ablative).') },
  { w: 'ჯოღორეფს', tr: 'joghoreps', m: T('собакам (дат. мн.)', 'to the dogs (dat. pl.)'), parts: [['ჯოღორ', '«собака»: груз. ძაღლ-'], ['ეფ', 'мн. число: груз. -ებ- (ბ ↔ ფ)'], ['ს', 'дательный падеж -ს, как в грузинском']], lit: T('груз. ძაღლებს', 'Georgian ძაღლებს'), note: T('Сравните звук за звуком: ძ ↔ ჯ, ა ↔ ო, вставной ო между ღ и ლ, ლ ↔ რ, ებ ↔ ეფ. Пять закономерностей в одном слове.', 'Compare sound by sound: dz ↔ j, a ↔ o, an inserted o between gh and l, l ↔ r, eb ↔ ep. Five correspondences in one word.') },
  { w: 'ვა მიჩქუ', tr: 'va michku', m: T('не знаю', "I don't know"), parts: [['ვა ', 'отрицание «не»'], ['მ', '«мне» — инверсия: знающий стоит как объект'], ['ი', 'гласная версии'], ['ჩქ', 'корень «знать»'], ['უ', 'тематическая гласная']], lit: T('«мне не известно»', '"to me (it is) not known"'), note: T('Груз. არ ვიცი. «Знать» в мегрельском — инвертированный глагол, как груз. მიყვარს «люблю»: მიჩქუ «я знаю», გიჩქუ «ты знаешь», უჩქუ «он знает».', 'Georgian არ ვიცი. "Know" is an inverted verb in Mingrelian, like Georgian მიყვარს "I love": მიჩქუ "I know", გიჩქუ "you know", უჩქუ "he knows".') },
  { w: 'მუშენ', tr: 'mushen', m: T('почему, зачем', 'why'), parts: [['მუ', '«что»'], ['შენ', 'причинный падеж -(ი)შენ «для, из-за»']], lit: T('«для чего», «из-за чего»', '"for what", "because of what"'), note: T('Тот же падеж у имён: კოჩიშენ «для человека, ради человека» (груз. კაცისთვის).', 'The same case on nouns: კოჩიშენ "for the man" (Georgian კაცისთვის).') },
  { w: 'ოჭკომალი', tr: "och'k'omali", m: T('еда', 'food'), parts: [['ო', 'конфикс назначения о-…-ал-и (груз. са-…-ел-и)'], ['ჭკომ', 'корень «есть» (ჭკომა)'], ['ალ', 'конец конфикса: груз. -ელ- (э → а)'], ['ი', 'именительный падеж']], lit: T('«то, что для еды»: груз. სა-ჭმ-ელ-ი', '"what is for eating": Georgian სა-ჭმ-ელ-ი'), note: T('⚠ Соответствие конфиксов ო-…-ალ-ი ↔ სა-…-ელ-ი — разбор автора курса, не проверен по источникам. Ср. ოხვამე «церковь» — «место молитвы».', '⚠ The match of the confixes o-…-al-i ↔ sa-…-el-i is the course author\'s analysis, not confirmed in the references. Cf. ოხვამე "church" — "the place of prayer".') },
];

const st = lexStats();
const NUMBERS = LEXICON.filter((e) => e.group === 'numbers').map(wordOf);

export const SECTIONS = [
  {
    id: 'intro', kind: 'text', topic: 'rules', level: 'A1', title: T('Мегрельский язык', 'The Mingrelian language'),
    blocks: [
      { p: T('Мегрельский (მარგალური ნინა, «мегрельский язык») — картвельский язык Западной Грузии (Самегрело, часть Абхазии). Вместе с лазским он образует занскую ветвь; грузинский и сванский — его ближайшая родня. Говорящих по разным оценкам от нескольких сотен тысяч до полумиллиона; почти все они двуязычны и пишут по-грузински.', 'Mingrelian (მარგალური ნინა, "the Mingrelian language") is a Kartvelian language of western Georgia (Samegrelo and part of Abkhazia). With Laz it forms the Zan branch; Georgian and Svan are its closest relatives. Estimates of speakers range from a few hundred thousand to half a million; nearly all are bilingual and write Georgian.') },
      { p: T('Письменной нормы нет: мегрельский пишут грузинскими буквами с тремя добавочными (ჷ, ჸ, ჲ), и издания расходятся в написании. Два диалекта по Кипшидзе — зугдидско-самурзаканский и сенакский.', 'There is no written standard: Mingrelian is written in Georgian letters plus three additional ones (ჷ, ჸ, ჲ), and publications spell differently. Kipshidze distinguishes two dialects: Zugdidi-Samurzakano and Senaki.') },
      { p: T(`Материал курса опирается на грамматику и словарь И. Кипшидзе (1914), словарь О. Кажая, обзор А. Харрис «The Kartvelian Languages» и этимологический словарь Г. Климова. Мегрельский описан хуже грузинского, поэтому всё, что автор курса не смог подтвердить, помечено «⚠ не проверено». В словаре курса ${st.total} слов, из них ${st.verified} без пометки; у ${st.cognates} указан грузинский родственник.`, `The course follows I. Kipshidze's grammar and dictionary (1914), O. Kajaia's dictionary, A. Harris's survey "The Kartvelian Languages" and G. Klimov's etymological dictionary. Mingrelian is less documented than Georgian, so whatever the course author could not confirm is marked "⚠ not confirmed". The course lexicon has ${st.total} words, ${st.verified} of them unmarked; ${st.cognates} show their Georgian relative.`) },
      { p: T('Если вы знаете грузинский, мегрельский покажется знакомым и чужим одновременно: те же падежи -ს, -ით, тот же порядок слотов в глаголе, но гласные и шипящие «сдвинуты» по правилам. Раздел «Соответствия» и инструмент «Родственные слова» показывают эти правила на словах.', 'If you know Georgian, Mingrelian feels familiar and foreign at once: the same cases -s, -it, the same verb slots, but the vowels and sibilants are "shifted" by rule. The "Correspondences" section and the "Cognates" tool show these rules on real words.') },
    ],
  },
  {
    id: 'alphabet', kind: 'text', topic: 'rules', level: 'A1', title: T('Буквы и звуки', 'Letters and sounds'),
    blocks: [
      { p: T('Мегрельский пользуется мхедрули — теми же 33 буквами, что и грузинский (ჰ почти не встречается), — и тремя дополнительными. Они есть в Юникоде и в шрифтах с полным грузинским блоком.', 'Mingrelian uses Mkhedruli — the same 33 letters as Georgian (ჰ is almost absent) — and three more. They are in Unicode and in fonts with the full Georgian block.') },
      { table: { head: ['буква · letter', 'лат. · Latin', 'рус.', 'IPA', 'звук · sound'], rows: ALPHABET.filter((a) => a.extra).map((a) => [a.ch, a.lat, a.ru, a.ipa, a.note.ru]) } },
      { p: T('Буквы ჴ, ჵ, ჳ из того же блока Юникода — древнегрузинские и сванские; в мегрельских текстах их нет.', 'The letters ჴ, ჵ, ჳ from the same Unicode block are Old Georgian and Svan; Mingrelian texts do not use them.') },
      { table: { head: ['буква · letter', 'название · name', ''], rows: NOT_USED.map((x) => [x.ch, x.name, x.ru]) } },
      { p: T('Транскрипция курса: грузинская национальная латиница (k = ქ, k\' = კ, kh = ხ, q\' = ყ), плюс ə = ჷ, ʔ = ჸ, y = ჲ. В русской записи: ы = ჷ, ʼ = ჸ, й = ჲ. В инструментах слово можно набирать и так, и так.', 'Course transcription: the Georgian national romanisation (k = ქ, k\' = კ, kh = ხ, q\' = ყ), plus ə = ჷ, ʔ = ჸ, y = ჲ. In Russian: ы = ჷ, ʼ = ჸ, й = ჲ. The tools accept either.') },
      { p: T('Конечный -ი в мегрельском часто ослаблен до шва: კოჩი ~ კოჩჷ «человек». Тексты пишут по-разному; анализатор принимает оба написания.', 'Final -i is often reduced to schwa: კოჩი ~ კოჩჷ "person". Texts differ; the analyser accepts both spellings.') },
    ],
  },
  {
    id: 'corr', kind: 'text', topic: 'rules', level: 'A2', title: T('Соответствия с грузинским', 'Correspondences with Georgian'),
    intro: T('Мегрельский и грузинский разошлись из общего картвельского предка, и звуки менялись закономерно. Зная правила, по грузинскому слову можно угадать мегрельское — и наоборот.', 'Mingrelian and Georgian split from a common Kartvelian ancestor, and the sounds changed regularly. Knowing the rules, you can guess the Mingrelian word from the Georgian one — and back.'),
    blocks: [
      { h: T('Правила', 'The rules') },
      { table: { head: ['груз. → мегр.', 'правило · rule', 'примеры · examples'], rows: ruleRows } },
      { p: T('Самые надёжные — гласные (а ↔ о, э ↔ а) и «шипящий сдвиг» (с ↔ ш, з ↔ ж, ц ↔ ч, дз ↔ дж, ц’ ↔ ч’): в праязыке было три ряда шипящих и свистящих, и грузинский с мегрельским сохранили их по-разному. Правила с пометкой «в отдельных словах» видны лишь в нескольких корнях.', 'The most reliable are the vowels (a ↔ o, e ↔ a) and the "hushing shift" (s ↔ sh, z ↔ zh, ts ↔ ch, dz ↔ j, ts\' ↔ ch\'): the proto-language had three series of sibilants and hushing sounds, which Georgian and Mingrelian kept differently. Rules marked "a few words" are seen in only a handful of roots.') },
      { p: T('Правила — тенденции, а не законы для каждого слова. Поздние заимствования из грузинского сохраняют грузинский облик (ცხენი «лошадь», ქვა «камень»), а у многих слов есть ещё и нерегулярные изменения: ერთი — არტი «один» (э → а по правилу, но თ → ტ без правила).', 'The rules are tendencies, not laws for every word. Later loans from Georgian keep their Georgian shape (ცხენი "horse", ქვა "stone"), and many words also have irregular changes: ერთი — არტი "one" (e → a by rule, but t → t\' without one).') },
      { h: T('Слова, объяснённые правилами полностью', 'Words fully explained by the rules') },
      { table: { head: ['груз.', 'мегр.', 'значение · meaning', 'правила · rules'], rows: pairRows } },
      { p: T('Попробуйте сами в «Инструментах → Родственные слова»: введите грузинское слово и посмотрите, какие мегрельские формы предскажут правила и какие из них есть в словаре.', 'Try it in "Tools → Cognates": type a Georgian word and see which Mingrelian forms the rules predict and which of them are in the lexicon.') },
    ],
  },
  { id: 'greetings', kind: 'words', topic: 'situation', level: 'A1', title: T('Приветствия и фразы', 'Greetings and phrases'), intro: T('Разговорные формулы. Многие из них записаны в разных изданиях по-разному; непроверенные помечены.', 'Everyday formulas. Many are spelled differently in different publications; unconfirmed ones are marked.'), words: phraseWords },
  { id: 'parse', kind: 'parse', topic: 'rules', level: 'A2', title: T('Слова по частям', 'Words taken apart'), intro: T('Каждое слово разложено на части и сопоставлено с грузинским.', 'Each word is split into its parts and compared with Georgian.'), items: EXPRESSIONS },
  {
    id: 'numbers', kind: 'text', topic: 'rules', level: 'A1', title: T('Числа', 'Numbers'),
    blocks: [
      { p: T('Счёт, как и в грузинском, двадцатеричный: 30 — ეჩდოვითი «двадцать и десять» (груз. ოცდაათი, დო = груз. და «и»). Числа 1–10 и 20, 100 надёжны; составные формы помечены.', 'Counting is vigesimal, as in Georgian: 30 is ეჩდოვითი "twenty and ten" (Georgian ოცდაათი, დო = Georgian და "and"). 1–10, 20 and 100 are reliable; compound forms are marked.') },
      { table: { head: ['число', 'мегр.', 'груз.', 'соответствие · correspondence'], rows: [['3', 'სუმი', 'სამი', 'а ↔ у (нерегулярно)'], ['6', 'ამშვი', 'ექვსი', 'э ↔ а; остальное нерегулярно'], ['8', 'რუო', 'რვა', 'в ↔ у, а ↔ о'], ['9', 'ჩხორო', 'ცხრა', 'ц ↔ ч, вставной о, а ↔ о'], ['20', 'ეჩი', 'ოცი', 'ц ↔ ч'], ['100', 'ოში', 'ასი', 'а ↔ о, с ↔ ш']] } },
      { ex: NUMBERS },
    ],
  },
  {
    id: 'cases', kind: 'text', topic: 'grammar', level: 'A2', title: T('Падежи', 'Cases'),
    blocks: [
      { p: T('Падежей больше, чем в грузинском: кроме общих с ним именительного, эргативного, дательного, родительного, творительного и обстоятельственного, есть направительный (-იშა «к»), исходный (-იშე «от, из») и причинный (-იშენ «для, из-за»). По всей видимости, они выросли из родительного падежа -იში с частицами — поэтому все начинаются на -იშ-.', 'There are more cases than in Georgian: besides the shared nominative, ergative, dative, genitive, instrumental and adverbial, there are the allative (-iša "to"), the ablative (-iše "from") and the causal (-išen "for, because of"). They apparently grew out of the genitive -iši plus particles — hence all begin with -iš-.') },
      { table: { head: ['падеж · case', 'კოჩი «человек»', 'лат.', 'груз. კაცი'], rows: caseRows('კოჩი', true) } },
      { p: T('Основы на гласную (დიდა «мать») присоединяют окончания без -ი-: დიდაქ, დიდას, დიდაში, დიდაშა.', 'Vowel stems (დიდა "mother") take the endings without -i-: დიდაქ, დიდას, დიდაში, დიდაშა.') },
      { table: { head: ['падеж · case', 'დიდა «мать»', 'лат.'], rows: caseRows('დიდა', false) } },
      { p: T('Множественное число — суффикс -ეფ- (груз. -ებ-): კოჩეფი «люди», კოჩეფს, კოჩეფიში. ⚠ Эргатив основ на согласный (კოჩქ или კოჩიქ) в источниках записан по-разному.', 'The plural is the suffix -ep- (Georgian -eb-): კოჩეფი "people", კოჩეფს, კოჩეფიში. ⚠ The ergative of consonant stems (კოჩქ or კოჩიქ) is written differently in the sources.') },
    ],
  },
  {
    id: 'verb', kind: 'text', topic: 'grammar', level: 'B1', title: T('Глагол', 'The verb'),
    blocks: [
      { p: T('Слоты те же, что в грузинском: (частица) — преверб — лицо — версия — корень — тематический суффикс — показатель — окончание. Отличаются окончания: в настоящем 1-е и 2-е лицо ед. ч. получают -ქ.', 'The slots are those of Georgian: (particle) — preverb — person — version — root — thematic suffix — marker — ending. The endings differ: in the present the 1st and 2nd person singular take -k.') },
      { table: { head: ['лицо', 'ჭარუა «писать»', 'морфемы', 'груз.'], rows: verbRows(present, true) } },
      { p: T('Имперфект и аорист ниже построены по правилам из грамматик и помечены: полные парадигмы в источниках автор курса не сверил.', 'The imperfect and the aorist below are built by the rules of the grammars and marked: the course author did not check the full paradigms against the sources.') },
      { table: { head: ['лицо', 'имперфект', 'морфемы'], rows: verbRows(imperfect, false) } },
      { table: { head: ['лицо', 'аорист', 'морфемы'], rows: verbRows(aorist, false) } },
      { h: T('Превербы', 'Preverbs') },
      { table: { head: ['мегр.', 'груз.', 'значение · meaning'], rows: PREVERBS.map((p) => [mark(p.unverified, p.s + '-'), p.ka + '-', p.ru + ' · ' + p.en]) } },
      { p: T('Утвердительная частица ქ- (ქო-, ქი-, ქე-) ставится перед глаголом или превербом: «ведь, действительно (сделал)». В грузинском её нет; в рассказе о прошлом она очень часта.', 'The affirmative particle k- (ko-, ki-, ke-) stands before the verb or the preverb: "indeed (did)". Georgian has nothing like it; it is very frequent in narratives about the past.') },
      { p: T('Инверсия — как в грузинском: «знающий» и «любящий» стоят как объект. მიჩქუ «я знаю» (груз. ვიცი), გიჩქუ «ты знаешь», უჩქუ «он знает»; ⚠ მიჸორს «я его люблю».', 'Inversion works as in Georgian: the one who knows or loves is marked as the object. მიჩქუ "I know" (Georgian ვიცი), გიჩქუ "you know", უჩქუ "he knows"; ⚠ მიჸორს "I love him / her".') },
      { table: { head: ['мегр.', 'лат.', 'значение · meaning'], rows: EXCEPTIONS.filter((e) => e.lemma === 'რე').map((e) => [mark(e.unverified, e.w), tr(e.w), e.ru + ' · ' + e.en]) } },
    ],
  },
  { id: 'w-family', kind: 'words', topic: 'objects', level: 'A1', title: T('Слова: семья и люди', 'Words: family and people'), words: lexWords(['family', 'people']) },
  { id: 'w-body', kind: 'words', topic: 'objects', level: 'A1', title: T('Слова: тело', 'Words: the body'), words: lexWords(['body']) },
  { id: 'w-nature', kind: 'words', topic: 'objects', level: 'A1', title: T('Слова: природа и время', 'Words: nature and time'), words: lexWords(['nature', 'time']) },
  { id: 'w-life', kind: 'words', topic: 'objects', level: 'A1', title: T('Слова: животные и еда', 'Words: animals and food'), intro: T('Мегрельская кухня дала грузинскому названия блюд: ელარჯი, გებჟალია, ჭვიშტარი, კუჭმაჭი — в обоих языках они звучат одинаково.', 'Mingrelian cuisine gave Georgian the names of its dishes: ელარჯი, გებჟალია, ჭვიშტარი, კუჭმაჭი sound the same in both languages.'), words: lexWords(['animals', 'food']) },
  { id: 'w-grammar', kind: 'words', topic: 'objects', level: 'A2', title: T('Слова: качества, местоимения, вопросы', 'Words: qualities, pronouns, questions'), words: lexWords(['qualities', 'pronouns', 'questions', 'particles']) },
  { id: 'w-verbs', kind: 'words', topic: 'objects', level: 'A2', title: T('Слова: глаголы', 'Words: verbs'), intro: T('Глаголы даны масдаром (отглагольным именем), как в грузинских словарях: ჭარუა «писание, писать».', 'Verbs are given as masdars (verbal nouns), as in Georgian dictionaries: ჭარუა "writing, to write".'), words: lexWords(['verbs']) },
  {
    id: 'texts', kind: 'poem', topic: 'poetry', level: 'B1', title: T('Песни и первые фразы', 'Songs and first sentences'),
    intro: T('Мегрельские народные песни — «Одоя» (ოდოია, рабочая песня), «Во, киана» (ვო, ქიანა, «О, мир») — известны по всей Грузии. Их тексты в записях заметно расходятся, поэтому курс не приводит их целиком: ниже — только заглавные строки и простые фразы из проверенных форм.', 'Mingrelian folk songs — "Odoia" (ოდოია, a work song), "Vo, kiana" (ვო, ქიანა, "O, world") — are known all over Georgia. Their recorded texts differ noticeably, so the course does not quote them in full: below are only the title lines and simple sentences from confirmed forms.'),
    lines: [
      { w: 'ვო, ქიანა!', tr: 'vo, kiana!', m: T('О, мир!', 'O, world!'), note: T('⚠ Заглавие и зачин песни. ქიანა «мир, земля, страна» — груз. ქვეყანა (родство предположительно).', '⚠ The title and opening of the song. ქიანა "world, land, country" — Georgian ქვეყანა (kinship proposed).'), unverified: true },
      { w: 'ოდოია', tr: 'odoia', m: T('припев рабочей песни «Одоя»', 'the refrain of the work song "Odoia"'), note: T('⚠ Пели при совместной работе в поле; смысл припева в источниках толкуют по-разному.', '⚠ Sung during communal field work; the sources interpret the refrain differently.'), unverified: true },
      { w: 'მა ვჭარუნქ.', tr: "ma vch'arunk.", m: T('Я пишу.', 'I write.'), note: T('груз. მე ვწერ: მა ↔ მე (э → а), ჭარ ↔ წერ.', 'Georgian მე ვწერ: ma ↔ me (e → a), č\'ar ↔ c\'er.') },
      { w: 'ბოში ჭარუნს.', tr: "boshi ch'aruns.", m: T('Мальчик пишет.', 'The boy writes.'), note: T('В настоящем подлежащее в именительном, как в грузинском.', 'In the present the subject is in the nominative, as in Georgian.') },
      { w: 'ვა მიჩქუ.', tr: 'va michku.', m: T('Не знаю.', "I don't know."), note: T('груз. არ ვიცი.', 'Georgian არ ვიცი.') },
      { w: 'ჩქიმი ჯოხო რე…', tr: 'chkimi jokho re…', m: T('Меня зовут… (моё имя — …)', 'My name is…'), note: T('⚠ Порядок слов и место რე «есть» в источниках не сверены.', '⚠ The word order and the place of რე "is" were not checked against the sources.'), unverified: true },
    ],
  },
  {
    id: 'notes', kind: 'text', topic: 'grammar', level: 'B1', title: T('Заметки о грамматике', 'Grammar notes'),
    blocks: [
      { p: T('Эргатив шире, чем в грузинском. В грузинском в аористе на -მა стоит подлежащее переходных (и части непереходных) глаголов; в мегрельском -ქ получает подлежащее любого глагола в серии аориста (Харрис). «Мальчик пришёл» и «мальчик написал» одинаково требуют эргатива.', 'The ergative is wider than in Georgian. In Georgian the aorist puts the subject of transitive (and some intransitive) verbs into -ma; in Mingrelian every subject in the aorist series takes -k (Harris). "The boy came" and "the boy wrote" both need the ergative.') },
      { p: T('Пространственных падежей больше (-იშა, -იშე), и грузинские послелоги -კენ, -დან, -გან в мегрельском часто передаются ими.', 'There are more spatial cases (-iša, -iše), and they often render the Georgian postpositions -ken, -dan, -gan.') },
      { p: T('Утвердительные частицы (ქო-, ქი-) и превербы образуют сложные цепочки в начале глагола — то, чего нет в грузинском.', 'The affirmative particles (ko-, ki-) and the preverbs build long chains at the start of the verb — something Georgian lacks.') },
      { p: T('Многие повседневные слова не имеют грузинских родственников (ოხორი «дом», ქობალი «хлеб», ჯგირი «хороший», დუდი «голова»), а многие грузинские слова мегрельский заимствовал позднее и не изменил. Поэтому соответствия видны лучше всего в древнем слое: числа, тело, родство, животные.', 'Many everyday words have no Georgian relatives (ოხორი "house", ქობალი "bread", ჯგირი "good", დუდი "head"), and many Georgian words were borrowed later and kept unchanged. So the correspondences show best in the old layer: numbers, the body, kinship, animals.') },
      { p: T('Анализатор слов в «Инструментах» сначала применяет правила (падежи, -ეფ-, лица, превербы, частицу ქ-), а словарь лишь повышает оценку разбора. Поэтому он разберёт и слово, которого нет в словаре, но честно пометит такой разбор как догадку.', 'The word analyser in "Tools" applies the rules first (cases, -ep-, persons, preverbs, the particle k-), and the lexicon only raises a reading\'s score. So it parses words the lexicon lacks too, but marks such a reading as a guess.') },
    ],
  },
];

export const COURSE = {
  id: 'xmf', native: 'მარგალური', speech: 'xmf', explain: ['ru', 'en'], script: 'Geor',
  name: { ru: 'Мегрельский', en: 'Mingrelian', uk: 'Мегрельська', de: 'Mingrelisch', fr: 'Mingrélien', es: 'Megreliano', ka: 'მეგრული' },
  scripts: [
    { id: 'mkhedruli', name: T('Мхедрули с мегрельскими буквами', 'Mkhedruli with the Mingrelian letters'), letters: LETTERS },
    { id: 'hard', name: T('Мегрельские и трудные звуки', 'Mingrelian and difficult sounds'), letters: HARD_LETTERS },
  ],
  tools: ['xmf-parse', 'xmf-cognate'],
  games: [],
  sections: SECTIONS,
};
export default COURSE;
