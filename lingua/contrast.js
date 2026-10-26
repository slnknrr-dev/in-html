// lingua/contrast.js - the structure of a Georgian sentence (lingua/kartuli-syntax.js buildSentence) set against the
// structure Russian or English give the same message: which case or position each argument takes there, the tense
// and aspect that render the screeve, the word order, and notes where the systems part ways (the ergative of series
// II, the dative subject of series III and of the verbs of feeling, the evidential perfect, ვერ "cannot").
//
//   contrastSentence(r, target = 'ru' | 'en') -> { rows, order, gloss, verb, notes }
//     rows: [{ role, ka, kaCase, label: { ru, en }, form }]   labels are bilingual: the UI picks its language
//
// Key decisions:
// - Rule-based contrastive notes, not translation: the module explains *structure* (case, order, tense mapping)
//   from the parse that kartuli-syntax.js already produced; it never claims to produce a fluent translation (`gloss`
//   is a role-ordered word string of first senses, a scaffold for the learner).
// - Two axes of language: `target` picks which grammar is contrasted (ru or en); each text is B(ru, en) so the
//   explanation can be read in either UI language independently of the target.
// - Georgian screeves are grouped into series I/II/III because case marking of subject/object depends on the series
//   (nominative-accusative-like in I, ergative in II, inverted in III); every note below keys off series + case.

const B = (ru, en) => ({ ru, en });
const SERIES = { present: 1, imperfect: 1, presSubj: 1, future: 1, conditional: 1, futSubj: 1, aorist: 2, optative: 2, imperative: 2, perfect: 3, pluperfect: 3 };

export const SCREEVE_IN = {
  ru: {
    present: B('настоящее время, несовершенный вид («пишет»)', 'present tense, imperfective ("пишет")'),
    imperfect: B('прошедшее несовершенного вида («писал, бывало писал»)', 'imperfective past ("писал")'),
    presSubj: B('«чтобы писал», «пусть пишет»', '"чтобы писал", "пусть пишет"'),
    future: B('будущее; преверб даёт совершенный вид («напишет»)', 'future; the preverb makes it perfective ("напишет")'),
    conditional: B('сослагательное «написал бы»', 'conditional "написал бы"'),
    futSubj: B('«чтобы написал»', '"чтобы написал"'),
    aorist: B('прошедшее; с превербом — совершенный вид («написал»)', 'past; with the preverb perfective ("написал")'),
    optative: B('«пусть напишет»; после უნდა — «должен написать»', '"пусть напишет"; after უნდა "должен написать"'),
    imperative: B('повелительное наклонение («напиши»)', 'imperative ("напиши")'),
    perfect: B('прошедшее совершенного вида со словом «оказывается» или «уже»: пересказ, вывод по следам', 'perfective past with "оказывается" or "уже": hearsay, inference from traces'),
    pluperfect: B('«должен был написать», «написал бы (а не написал)»', '"должен был написать", "написал бы (but did not)"'),
  },
  en: {
    present: B('Present Simple или Continuous («writes, is writing»)', 'Present Simple or Continuous ("writes, is writing")'),
    imperfect: B('Past Continuous, used to («was writing»)', 'Past Continuous, used to ("was writing")'),
    presSubj: B('«(so) that he write(s)», «let him be writing»', '"(so) that he write(s)", "let him be writing"'),
    future: B('Future Simple («will write»)', 'Future Simple ("will write")'),
    conditional: B('«would write»', '"would write"'),
    futSubj: B('«so that he would write»', '"so that he would write"'),
    aorist: B('Past Simple («wrote»)', 'Past Simple ("wrote")'),
    optative: B('«let him write»; после უნდა — «must / should write»', '"let him write"; after უნდა "must / should write"'),
    imperative: B('повелительное («write!»)', 'imperative ("write!")'),
    perfect: B('Present Perfect, часто с «apparently»: «has (apparently) written»', 'Present Perfect, often with "apparently": "has (apparently) written"'),
    pluperfect: B('«should have written», «had written» (несбывшееся)', '"should have written", "had written" (unrealised)'),
  },
};

// Target-language pronouns by person: [subject, direct object, indirect object] form. PRON_KA maps Georgian pronoun
// forms (any case, incl. -თვის) to a person key; Georgian pronouns do not inflect for nom/dat in 1st/2nd person, so
// the role decides the target form, not the Georgian form.
const PRON = {
  ru: { '1sg': ['я', 'меня', 'мне'], '2sg': ['ты', 'тебя', 'тебе'], '3sg': ['он / она', 'его / её', 'ему / ей'], '1pl': ['мы', 'нас', 'нам'], '2pl': ['вы', 'вас', 'вам'], '3pl': ['они', 'их', 'им'] },
  en: { '1sg': ['I', 'me', 'me'], '2sg': ['you', 'you', 'you'], '3sg': ['he / she', 'him / her', 'him / her'], '1pl': ['we', 'us', 'us'], '2pl': ['you', 'you', 'you'], '3pl': ['they', 'them', 'them'] },
};
const PRON_KA = { 'მე': '1sg', 'შენ': '2sg', 'ის': '3sg', 'მან': '3sg', 'მას': '3sg', 'ჩვენ': '1pl', 'თქვენ': '2pl', 'ისინი': '3pl', 'მათ': '3pl', 'ჩემთვის': '1sg', 'შენთვის': '2sg', 'მისთვის': '3sg', 'ჩვენთვის': '1pl', 'თქვენთვის': '2pl', 'მათთვის': '3pl' };

const ROLE_IN = {
  ru: {
    subj: B('подлежащее — именительный падеж', 'subject: nominative'),
    obj: B('прямое дополнение — винительный падеж', 'direct object: accusative'),
    io: B('косвенное дополнение — дательный падеж («кому?»)', 'indirect object: dative ("to whom?")'),
    q: B('вопросительное слово в том падеже, который требует глагол («кому?», «что?»)', 'question word in the case the verb demands'),
    adv: B('обстоятельство: предлог + падеж («в доме» — в + предложный)', 'adverbial: preposition + case ("в доме": в + prepositional)'),
    adj: B('определение согласуется с существительным в роде, числе и падеже', 'the adjective agrees with its noun in gender, number and case'),
    pred: B('сказуемое: глагол согласуется с подлежащим (лицо, число; в прошедшем — род)', 'predicate: agrees with the subject (person, number; gender in the past)'),
    neg: B('отрицание перед глаголом', 'negation before the verb'),
  },
  en: {
    subj: B('подлежащее — перед глаголом (порядок слов вместо падежа)', 'subject: before the verb (word order instead of case)'),
    obj: B('прямое дополнение — после глагола', 'direct object: after the verb'),
    io: B('косвенное дополнение — «to X» или между глаголом и прямым дополнением («gave me a book»)', 'indirect object: "to X" or between the verb and the object ("gave me a book")'),
    q: B('вопросительное слово в начале предложения («who … to?», «what …?»)', 'question word first ("who … to?", "what …?")'),
    adv: B('обстоятельство — предлог («in the house»)', 'adverbial: a preposition ("in the house")'),
    adj: B('прилагательное перед существительным, без изменений', 'the adjective before its noun, unchanged'),
    pred: B('сказуемое: время выражено вспомогательными глаголами (will, has, would)', 'predicate: tense through auxiliaries (will, has, would)'),
    neg: B('отрицание через вспомогательный глагол («did not», «cannot»)', 'negation through an auxiliary ("did not", "cannot")'),
  },
};
// Neutral target word order (the same SVO skeleton for both; kept per language so either can diverge). Only Russian
// has case tags to show, English marks roles by position.
const ORDER = { ru: ['q', 'subj', 'neg', 'pred', 'io', 'adj', 'obj', 'adv'], en: ['q', 'subj', 'neg', 'pred', 'io', 'adj', 'obj', 'adv'] };
const CASE_TAG = { ru: { subj: 'им.', obj: 'вин.', io: 'дат.', q: '', adv: '', adj: '', pred: '', neg: '' } };

// the first sense of each part: 'in, into + house, home' -> 'in + house'
const head = (g) => String(g || '').split('+').map((p) => p.split(/[;,]/)[0].trim()).join(' + ');

// Defaults are defensive: no predicate -> present (series I), unknown target -> ru, missing parse -> empty rows; the
// UI must render something for any half-built sentence. Notes are appended in a fixed pedagogical order: case
// alignment first (the biggest surprise), then special verbs/negation, then the evidential, then articles/order.
export function contrastSentence(r, target = 'ru') {
  const T = target === 'en' ? 'en' : 'ru';
  const words = (r && r.words) || [];
  const pred = words.find((w) => w.role === 'pred');
  const screeve = (pred && pred.screeve) || 'present';
  const series = SERIES[screeve] || 1;
  const subj = words.find((w) => w.role === 'subj');
  const obj = words.find((w) => w.role === 'obj');
  const io = words.find((w) => w.role === 'io');
  const neg = words.find((w) => w.role === 'neg');
  const rows = [];
  for (const w of words) {
    const p = w.pron ? PRON_KA[w.ka] : null;
    let form = '';
    if (p) form = PRON[T][p][w.role === 'subj' ? 0 : w.role === 'obj' ? 1 : 2];
    else if (w.role === 'pred') form = (w.gloss && w.gloss[T]) || '';
    else if (w.role === 'neg') form = w.ka === 'ვერ' ? (T === 'ru' ? 'не смог(ла) / не может' : 'could not / cannot') : (T === 'ru' ? 'не' : 'not / do not');
    else form = head(w.gloss && w.gloss[T]) + (T === 'ru' && CASE_TAG.ru[w.role] ? ' (' + CASE_TAG.ru[w.role] + ')' : '');
    rows.push({ role: w.role, ka: w.ka, kaCase: w.case || null, label: ROLE_IN[T][w.role] || B('', ''), form });
  }
  const order = ORDER[T].filter((role) => rows.some((x) => x.role === role));
  const gloss = order.map((role) => rows.filter((x) => x.role === role).map((x) => x.form).join(' ')).filter(Boolean).join(' · ');
  const notes = [];
  if (subj && subj.case === 'erg') notes.push(B('Эргатив: в серии II подлежащее переходного глагола получает -მა / -მ. В русском и английском такого падежа нет — подлежащее остаётся в именительном (или просто стоит перед глаголом).', 'Ergative: in series II the subject of a transitive verb takes -მა / -მ. Russian and English have no such case: the subject stays nominative (or simply comes first).'));
  if (subj && subj.case === 'dat' && series === 3) notes.push(B('Инверсия серии III: подлежащее в дательном, как в русском «мне надо», «мне, оказывается, …»; в переводе подлежащее снова именительное, а пересказывательность передают словами «оказывается», «видимо», apparently.', 'Series III inversion: the subject is dative, as in Russian мне надо; a translation makes it nominative again and renders the evidential with "оказывается", "apparently".'));
  else if (subj && subj.case === 'dat') notes.push(B('Глагол чувства или обладания: подлежащее в дательном — как русское «мне нравится», «у меня есть». В английском подлежащее обычное: I like, I have.', 'A verb of feeling or having: the subject is dative, like Russian мне нравится, у меня есть. English uses an ordinary subject: I like, I have.'));
  if (obj && obj.case === 'nom' && series > 1) notes.push(B('Прямое дополнение в серии II и III — в именительном (-ი), но по-русски оно всё равно винительное: «книгу».', 'In series II and III the direct object is nominative (-ი), yet Russian still puts it in the accusative: книгу.'));
  if (obj && obj.case === 'dat' && series === 1) notes.push(B('В серии I прямое дополнение в дательном (-ს) — по смыслу это русский винительный.', 'In series I the direct object is dative (-ს), which corresponds to the Russian accusative.'));
  if (io && io.case === 'tvis') notes.push(B('В серии III косвенное дополнение уходит в послелог -თვის «для»: «для меня», как в русском «для кого-то».', 'In series III the indirect object moves into the postposition -თვის "for", like Russian для.'));
  if (neg && neg.ka === 'ვერ') notes.push(B('ვერ — «не смог / не может»: невозможность, а არ — простое «не». Русскому нужен глагол «мочь», английскому — can / could.', 'ვერ means "could not / cannot": inability, while არ is a plain "not". Russian needs мочь, English can / could.'));
  if (series === 3 && screeve === 'perfect') notes.push(B('Перфект — это и результат («уже сделал»), и пересказ («говорят, сделал»). В отрицании — «ни разу не»: არ მინახავს «я (никогда) не видел».', 'The perfect is both a result ("has done") and hearsay ("reportedly did"). Negated it means "never": არ მინახავს "I have never seen".'));
  if (T === 'en') notes.push(B('Английскому нужны артикли (a book, the book), которых нет ни в грузинском, ни в русском.', 'English needs articles (a book, the book), which neither Georgian nor Russian has.'));
  notes.push(T === 'ru' ? B('Порядок слов: в грузинском глагол обычно в конце (SOV), в русском нейтральный порядок SVO, но падежи позволяют переставлять слова ради акцента.', 'Word order: Georgian usually puts the verb last (SOV); neutral Russian is SVO, but cases let words move for emphasis.')
    : B('Порядок слов: в английском он жёсткий (SVO) — только он и показывает, кто кому что сделал.', 'Word order: English keeps SVO strictly: it alone shows who did what to whom.'));
  return { rows, order, gloss, verb: { screeve, series, label: SCREEVE_IN[T][screeve] || B('', '') }, notes };
}
