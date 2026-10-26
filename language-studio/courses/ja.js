// language-studio/courses/ja.js - Japanese for Chinese and Russian speakers: hiragana, katakana, kanji with their
// readings, comparison with traditional and simplified Chinese, the character constructor, phrases, grammar, haiku.
//
// Structure (data, not logic; reviewed for content, not commented line by line):
//   tables first (letters as compact arrays or util.js words() text blocks), then SECTIONS (lessons), then COURSE:
//   { id, native, speech (BCP 47 tag for speech.js), explain: [explanation languages], script (FONTS key),
//     name: { per UI language }, scripts: [{ id, name, letters }], tools: [tool ids of tools.js], games, sections }.
//   A section: { id, kind ('words' | 'text' | 'dialogue' | 'poem' | ...), topic, title, words | blocks | lines }.
//   Ids are stable on purpose: spaced-repetition items are keyed "<course>:<section>:<word>" (index.js wordId), so
//   renaming a section id or a word orphans the learner's progress for it.
import { DAKUTEN, GOJUON } from '../../lingua/kana.js';
import { CHARS, COMPOSE, FALSE_FRIENDS, VARIANTS } from './cjk.js';
import { lines, words } from './util.js';

const L = ['ru', 'zh'];
const Z = (ru, zh) => ({ ru, zh });

export const HIRAGANA = [...GOJUON, ...DAKUTEN].map((k) => ({ ch: k.h, tr: k.r, say: k.h }));
export const KATAKANA = [...GOJUON, ...DAKUTEN].map((k) => ({ ch: k.k, tr: k.r, say: k.k }));
export const KANJI = CHARS.map((c) => ({ ch: c.ja, tr: c.on.split('・')[0].toLowerCase(), reading: `${c.on} / ${c.kun}`, m: { ru: c.m.ru, zh: c.m.zh }, strokes: c.strokes, say: c.ja }));

export const SECTIONS = [
  {
    id: 'kana', kind: 'text', topic: 'rules', level: 'A1', title: Z('Хирагана и катакана', '平假名和片假名'),
    blocks: [
      { p: Z('В японском письме три системы: хирагана (грамматика и исконные слова), катакана (заимствования, звукоподражания, выделение) и кандзи (иероглифы, пришедшие из Китая). Каждая кана — слог: か = ka.', '日语有三种文字：平假名（语法成分和固有词）、片假名（外来词、拟声词、强调）和汉字（来自中国）。每个假名代表一个音节：か = ka。') },
      { p: Z('Кана произошли из иероглифов: хирагана — из скорописи целых знаков (あ из 安), катакана — из частей знаков (ア из 阿). Поэтому китайскому читателю легко узнать источник.', '假名源自汉字：平假名来自整个汉字的草书（あ 源于 安），片假名取自汉字的一部分（ア 源于 阿）。') },
      { table: { head: ['хирагана', 'катакана', 'источник', 'чтение'], rows: [['あ', 'ア', '安 / 阿', 'a'], ['い', 'イ', '以 / 伊', 'i'], ['う', 'ウ', '宇', 'u'], ['か', 'カ', '加', 'ka'], ['た', 'タ', '太 / 多', 'ta'], ['な', 'ナ', '奈', 'na'], ['ま', 'マ', '末', 'ma'], ['ら', 'ラ', '良', 'ra']] } },
      { p: Z('Знаки ゛ (дакутэн) и ゜ (хандакутэн) делают согласный звонким или p: か ka → が ga, は ha → ば ba → ぱ pa. Маленькая っ удваивает следующий согласный: きって kitte «марка».', '浊点 ゛ 和半浊点 ゜ 改变辅音：か ka → が ga，は ha → ば ba → ぱ pa。小っ 表示促音：きって kitte「邮票」。') },
    ],
  },
  {
    id: 'kanji', kind: 'kanji', topic: 'rules', level: 'A1', title: Z('Кандзи: чтения он и кун', '汉字：音读与训读'),
    intro: Z('У кандзи два типа чтений: он (音読み, китайское по происхождению: 山 サン san — ср. кит. shān) и кун (訓読み, исконно японское слово, записанное знаком: 山 やま yama). В сочетаниях обычно он, отдельно — кун.', '汉字有两种读音：音读（源自汉语：山 サン san，对应汉语 shān）和训读（用汉字书写的日语固有词：山 やま yama）。复合词多用音读，单用多为训读。'),
    chars: CHARS.map((c) => c.ja),
  },
  {
    id: 'compare', kind: 'variants', topic: 'culture', level: 'A2', title: Z('Сравнение с китайским: синдзитай, традиционные и упрощённые', '与中文比较：新字体、繁体字与简体字'),
    intro: Z('После 1946 года Япония упростила часть знаков (синдзитай), материковый Китай с 1956 года — свои (упрощённые). Тайвань, Гонконг и старые тексты используют традиционные. Иногда упрощения совпали (国), иногда пошли разными путями (気 / 气 / 氣).', '1946年后日本简化了部分汉字（新字体），中国大陆1956年起推行简体字。台湾、香港和古籍使用繁体字。有时简化结果相同（国），有时不同（気 / 气 / 氣）。'),
    items: VARIANTS,
  },
  {
    id: 'false', kind: 'false', topic: 'culture', level: 'B1', title: Z('Ложные друзья: одинаково пишется — разное значит', '同形异义词'),
    intro: Z('Знаки те же, значение в японском и китайском разное.', '字形相同，日语和汉语意义不同。'),
    items: FALSE_FRIENDS,
  },
  {
    id: 'compose', kind: 'compose', topic: 'rules', level: 'A2', title: Z('Разбор и конструктор иероглифов', '汉字的构成'),
    intro: Z('Большинство знаков сложены из частей: смысловой ключ + фонетик (語 = 言 «речь» + 吾 go — подсказка чтения) или два смысла (休 = 人 + 木: человек у дерева). Выберите части в «Инструментах» — конструктор найдёт знаки, которые из них собираются.', '大多数汉字由部件组成：意符 + 声符（語 = 言 + 吾），或会意（休 = 人 + 木：人靠在树旁）。'),
    items: COMPOSE,
  },
  {
    id: 'phrases', kind: 'words', topic: 'situation', level: 'A1', title: Z('Фразы и их буквальный смысл', '常用语及其字面意义'),
    words: words(L, `
こんにちは | konnichiwa | здравствуйте | 你好 // букв. «что до сегодняшнего дня…» — начало старой фразы 今日は; は читается wa
ありがとう | arigatō | спасибо | 谢谢 // от 有り難い «трудно (редко) бывающее» — «такое редко случается»
すみません | sumimasen | извините; спасибо | 对不起；谢谢 // «(мой долг) не исчерпывается» — и извинение, и благодарность
いただきます | itadakimasu | (говорят перед едой) | 我开动了 // «смиренно принимаю» — благодарность за пищу
ごちそうさまでした | gochisōsama deshita | спасибо за угощение | 多谢款待 // 馳走 — «бегать, хлопоча» об угощении
おつかれさまです | otsukaresama desu | спасибо за работу | 辛苦了 // «вы устали» — признание чужого труда
よろしくおねがいします | yoroshiku onegai shimasu | прошу любить и жаловать | 请多关照 // «прошу (относиться) хорошо»
いってきます | ittekimasu | я пошёл (и вернусь) | 我走了 // «пойду и приду»
ただいま | tadaima | я дома | 我回来了 // «прямо сейчас (вернулся)»
はじめまして | hajimemashite | рад познакомиться | 初次见面 // «впервые»
`),
  },
  {
    id: 'grammar', kind: 'text', topic: 'grammar', level: 'A1', title: Z('Частицы и порядок слов', '助词与语序'),
    blocks: [
      { p: Z('Порядок слов: подлежащее — дополнение — сказуемое (глагол в конце), как в корейском и монгольском, в отличие от китайского SVO. Роли слов показывают частицы после них.', '语序：主语—宾语—谓语（动词在句末），与汉语的 SVO 不同。词的作用由其后的助词表示。') },
      { table: { head: ['частица', 'роль', 'пример'], rows: [['は wa', 'тема: «что касается…»', 'わたしは がくせいです — я студент'], ['が ga', 'подлежащее, новая информация', 'ねこが いる — есть кошка'], ['を o', 'прямое дополнение', 'ほんを よむ — читать книгу'], ['に ni', 'место, время, направление, адресат', 'がっこうに いく — идти в школу'], ['で de', 'место действия; средство', 'でんしゃで いく — ехать на поезде'], ['の no', 'принадлежность', 'わたしの ほん — моя книга']] } },
      { p: Z('Вежливость встроена в грамматику: よむ (просто) / よみます (вежливо). Учебники начинают с вежливой формы -ます.', '礼貌程度体现在语法中：よむ（简体）/ よみます（敬体）。') },
    ],
  },
  {
    id: 'haiku', kind: 'poem', topic: 'poetry', level: 'B1', title: Z('Хайку: Басё и Исса', '俳句：芭蕉与一茶'),
    intro: Z('Хайку — 17 мор в ритме 5-7-5, с сезонным словом (киго) и «режущим» словом (кирэдзи: や, かな, けり), которое делит стих на два образа.', '俳句由 5-7-5 共十七个音拍组成，含季语和切字（や、かな、けり）。'),
    lines: lines(L, `
Басё: 古池や | furuike ya | Старый пруд — | 古池呀 // や — кирэдзи; пауза после образа
Басё: 蛙飛び込む | kawazu tobikomu | лягушка прыгнула в него — | 青蛙跳入 // киго: лягушка — весна
Басё: 水の音 | mizu no oto | всплеск воды. | 水之声
Басё: 閑さや | shizukasa ya | Тишина — | 寂静呀
Басё: 岩にしみ入る | iwa ni shimiiru | проникает в скалы | 渗入岩石
Басё: 蝉の声 | semi no koe | голос цикад. | 蝉之声 // парадокс: звук делает тишину слышимой
Исса: やせ蛙 | yasegaeru | Тощий лягушонок, | 瘦青蛙
Исса: まけるな一茶 | makeru na Issa | не сдавайся! Исса | 别输，一茶
Исса: これにあり | kore ni ari | здесь, с тобой. | 在这里
`),
  },
];

export const COURSE = {
  id: 'ja', native: '日本語', speech: 'ja-JP', explain: ['ru', 'zh'], script: 'Jpan',
  name: { ru: 'Японский', en: 'Japanese', uk: 'Японська', de: 'Japanisch', fr: 'Japonais', es: 'Japonés', ka: 'იაპონური' },
  scripts: [
    { id: 'hiragana', name: Z('Хирагана', '平假名'), letters: HIRAGANA },
    { id: 'katakana', name: Z('Катакана', '片假名'), letters: KATAKANA },
    { id: 'kanji', name: Z('Кандзи', '汉字'), letters: KANJI, strokes: true },
  ],
  tools: ['cjk-compose', 'ja-kana'],
  games: ['cjk-compose'],
  sections: SECTIONS,
};
export default COURSE;
