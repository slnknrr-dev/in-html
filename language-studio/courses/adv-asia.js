// language-studio/courses/adv-asia.js - the advanced lessons of the other courses, where the course structure
// carries them: Vedic Sanskrit C2 (the Nāsadīya hymn, RV 10.129, with its vocabulary), Japanese C1 (keigo; the
// opening of the Hōjōki, 1212), Chinese C1 (the Analects 1.1 with the Japanese kanbun reading; chengyu and their
// Japanese counterparts), Korean C1 (reported speech and its contractions; Sino-Korean words with their characters
// in Chinese and Japanese). All the old texts are centuries in the public domain; the translations are the studio's.
// Mingrelian has no C1 / C2: see the README. The sections join their courses in courses/index.js.
//
// Structure: arrays of lesson sections in the same shape as the course files' SECTIONS; courses/index.js appends them
// to the matching course at import. Data, not logic: header and structure comment only. Section ids must stay
// stable (spaced-repetition keys contain them).
import { lines, words } from './util.js';
import { kw } from './ko.js';

const E = (ru, en) => ({ ru, en });
const Z = (ru, zh) => ({ ru, zh });
const J = (ru, ja) => ({ ru, ja });

export const SECTIONS_SA = [
  {
    id: 'c2-nasadiya', kind: 'poem', topic: 'poetry', level: 'C2', deva: true, title: E('Гимн творения (RV 10.129): чтение целиком', 'The Hymn of Creation (RV 10.129): a full reading'),
    intro: E('Строфы 2, 3, 4 и 7 Насадия-сукты (первая — в уроке «Цитаты из Ригведы»), триштубх: четыре пады по 11 слогов. Ударения опущены. Слитные написания разобраны в примечаниях — проверьте их в инструменте «Сандхи».', 'Stanzas 2, 3, 4 and 7 of the Nāsadīya (the first is in "Quotations from the Rigveda"), triṣṭubh: four pādas of 11 syllables. Accents omitted. The fused spellings are taken apart in the notes — check them in the Sandhi tool.'),
    lines: lines(['ru', 'en'], `
RV 10.129.2: na mṛtyur āsīd amṛtaṃ na tarhi | | Не было тогда ни смерти, ни бессмертия, | There was neither death nor immortality then,
RV 10.129.2: na rātryā ahna āsīt praketaḥ | | не было различия ночи и дня. | no sign to tell night from day. // rātryā ahnaḥ: род. п. «ночи, дня»; читается rātriyā — 11 слогов
RV 10.129.2: ānīd avātaṃ svadhayā tad ekaṃ | | Дышало без ветра, своей силой, То Единое; | That One breathed without wind, by its own power; // ānīt — прошедшее (имперфект) от an «дышать»; svadhā «своя сила, своя природа»
RV 10.129.2: tasmād dhānyan na paraḥ kiṃ canāsa | | кроме него не было ничего иного. | apart from it there was nothing else. // tasmād dhānyan = tasmāt ha anyat; canāsa = cana āsa
RV 10.129.3: tama āsīt tamasā gūḷham agre | | Тьма была, тьмою сокрытая, вначале; | Darkness there was, hidden by darkness, in the beginning; // tamas «тьма» — ср. рус. «темь», лат. tenebrae
RV 10.129.3: apraketaṃ salilaṃ sarvam ā idam | | неразличимой пучиной было всё это. | all this was an undistinguished flood.
RV 10.129.3: tuchyenābhv apihitaṃ yad āsīt | | То, что было, сокрытое пустотой, | What was, covered by the void, // tuchyena ābhu: «пустотой — пустое»
RV 10.129.3: tapasas tan mahinājāyataikam | | родилось Единым силою жара. | was born as the One by the power of heat. // mahinā ajāyata ekam; tapas «жар, подвижничество»
RV 10.129.4: kāmas tad agre sam avartatādhi | | Желание вначале охватило его — | Desire in the beginning came upon it — // sam avartata adhi «возникло над (ним)»; kāma — «желание»
RV 10.129.4: manaso retaḥ prathamaṃ yad āsīt | | первое семя мысли, что было. | which was the first seed of mind. // manas — ср. рус. «мнить», лат. mens
RV 10.129.4: sato bandhum asati nir avindan | | Связь сущего в не-сущем нашли | The bond of being in non-being was found // sat / asat: «сущее / не-сущее»; ср. рус. «суть»
RV 10.129.4: hṛdi pratīṣyā kavayo manīṣā | | мудрецы, ища в сердце прозрением. | by the seers, searching in their hearts with insight. // hṛd «сердце» — родственно рус. «сердце», англ. heart
RV 10.129.7: iyaṃ visṛṣṭir yata ābabhūva | | Откуда это творение возникло, | Whence this creation came into being, // visṛṣṭi «из-пущение, творение»; ābabhūva — перфект от bhū «быть»
RV 10.129.7: yadi vā dadhe yadi vā na | | создал ли он его или нет, — | whether he made it or not — // пада короче нормы: 9 слогов
RV 10.129.7: yo asyādhyakṣaḥ parame vyoman | | тот, кто надзирает за ним в высшем небе, | he who watches over it in the highest heaven // asya adhyakṣaḥ; vyoman читается vi-oman
RV 10.129.7: so aṅga veda yadi vā na veda | | тот, верно, знает — а может, и не знает. | surely knows — or perhaps he does not know. // veda «знает» — ср. рус. «ведать», англ. wit
`),
    note: E('Гимн кончается сомнением — редкость для священного текста. Обратите внимание на пары противоположностей (sat / asat, mṛtyu / amṛta) и на родство слов с русскими: ведать, сердце, суть, мнить.', 'The hymn ends in doubt — rare for a sacred text. Note the pairs of opposites (sat / asat, mṛtyu / amṛta) and the cognates in Russian and English: ведать / wit, сердце / heart.'),
  },
  {
    id: 'c2-hymnwords', kind: 'words', topic: 'abstract', level: 'C2', deva: true, title: E('Словарь гимна творения', 'The words of the Hymn of Creation'),
    words: words(['ru', 'en'], `
sat | | сущее, бытие | being, the existent // Ср. рус. «суть», лат. sunt «(они) суть», англ. sooth
asat | | не-сущее | non-being
svadhā | | своя сила, собственная природа | own power, inherent nature // sva «свой» + dhā «класть»
salila | | пучина, первичные воды | the flood, the primeval waters
tamas | | тьма | darkness // ср. рус. «тьма, темнота»
retas | | семя | seed
kāma | | желание, любовь | desire, love
visṛṣṭi | | творение, «выпущение» | creation, "emission" // vi- «из, врозь» + sṛj «пускать»
adhyakṣa | | надзирающий | overseer // adhi «над» + akṣa «глаз»: «над-глядящий»
vyoman | | небо, простор | heaven, the expanse
mṛtyu | | смерть | death // ср. рус. «смерть», лат. mors
bandhu | | связь, родство | bond, kinship // ср. bandh «связывать», англ. bind
`),
  },
];

export const SECTIONS_JA = [
  {
    id: 'c1-keigo', kind: 'text', topic: 'speech', level: 'C1', title: Z('Кэйго: почтительная речь', '敬语：尊敬语、谦让语与丁宁语'),
    blocks: [
      { p: Z('Японская вежливость — грамматика: 尊敬語 (сонкэйго) возвышает собеседника и его действия, 謙譲語 (кэндзёго) принижает свои, 丁寧語 (тэйнэйго, формы на -ます / です) просто вежливы. Свои действия возвышать нельзя, как и чужие принижать.', '日语的礼貌是语法：尊敬语抬高对方及其行为，谦让语降低自己的行为，丁宁语（-ます／です）表示一般的礼貌。不能抬高自己，也不能贬低对方。') },
      { table: { head: ['обычно / 普通', '尊敬語', '謙譲語', '丁寧語'], rows: [
        ['行く・来る・いる', 'いらっしゃる', '参る (まいる)・伺う (うかがう)', '行きます'], ['食べる・飲む', '召し上がる (めしあがる)', 'いただく', '食べます'],
        ['言う', 'おっしゃる', '申す (もうす)', '言います'], ['見る', 'ご覧になる (ごらんになる)', '拝見する (はいけんする)', '見ます'],
        ['する', 'なさる', 'いたす', 'します'], ['知っている', 'ご存じだ (ごぞんじだ)', '存じている (ぞんじている)', '知っています'],
      ] } },
      { p: Z('Корейский устроен похоже: суффикс -(으)시- возвышает того, о ком говорят, а особые глаголы (드시다 «кушать», 계시다 «находиться») заменяют обычные — см. урок «Почтительность» корейского курса. Грузинский знает почтительные глаголы тоже: მიირთვით «кушайте», ბრძანდებით «изволите быть».', '韩语与此相似：-(으)시- 抬高所谈论的人，特殊动词（드시다 “吃”、계시다 “在”）代替普通动词。格鲁吉亚语也有尊敬动词：მიირთვით “请用”。') },
      { quiz: [
        { q: Z('Учитель спрашивает, видели ли вы его книгу. Скромный ответ «Да, видел»:', '老师问你是否看过他的书。谦逊地回答“是的，看过”：'), opts: ['はい、ご覧になりました。', 'はい、拝見しました。', 'はい、見られました。'], a: 1, why: Z('О своём действии — кэндзёго 拝見する.', '谈自己的行为用谦让语 拝見する。') },
        { q: Z('«Пожалуйста, угощайтесь» гостю:', '对客人说“请用餐”：'), opts: ['どうぞ、いただいてください。', 'どうぞ、召し上がってください。', 'どうぞ、食べてくれ。'], a: 1, why: Z('Действие гостя — сонкэйго 召し上がる; いただく — о себе.', '客人的行为用尊敬语 召し上がる；いただく 用于自己。') },
      ] },
    ],
  },
  {
    id: 'c1-hojoki', kind: 'poem', topic: 'poetry', level: 'C1', title: Z('Чтение: Камо-но Тёмэй, «Записки из кельи» (1212)', '阅读：鸭长明《方丈记》（1212）'),
    intro: Z('Начало «Ходзёки» — образ реки и пены как непостоянства (無常 мудзё). Классический язык: ず — отрицание, にあらず = ではない, たり — «-та», なし = ない.', '《方丈记》开篇以河流与泡沫比喻无常。古典语法：ず 表否定，にあらず = ではない，たり 相当于 た，なし = ない。'),
    lines: lines(['ru', 'zh'], `
ゆく河の流れは絶えずして、 | ゆくかわのながれはたえずして | Течение уходящей реки не прерывается, | 逝去的河流奔流不息， // 絶えずして: 絶ゆ «прерваться» + ず (отрицание) + して
しかももとの水にあらず。 | しかももとのみずにあらず | и всё же это не прежняя вода. | 然而已不是原来的水。 // にあらず = ではない
よどみに浮かぶうたかたは、 | よどみにうかぶうたかたは | Пена, что плавает в заводях, | 漂浮在水湾的泡沫，
かつ消えかつ結びて、 | かつきえかつむすびて | то исчезает, то возникает вновь, | 时而消失，时而凝结，
久しくとどまりたるためしなし。 | ひさしくとどまりたるためしなし | и не бывало, чтобы она задерживалась надолго. | 从未有长久停留的先例。 // たる — классическое -た; なし = ない
世の中にある人と栖と、またかくのごとし。 | よのなかにあるひととすみかと、またかくのごとし | Так же и люди в этом мире, и их жилища. | 世上的人与住所，也是如此。 // かくのごとし «таков»; 栖 (すみか) «жилище»
`),
    note: Z('Камо-но Тёмэй умер в 1216 году; текст в общественном достоянии, перевод — студии.', '鸭长明卒于1216年，原文属公有领域，译文为本站所作。'),
  },
];

export const SECTIONS_ZH = [
  {
    id: 'c1-lunyu', kind: 'poem', topic: 'poetry', level: 'C1', title: J('Чтение: «Лунь юй» 1.1 и японское чтение канбун', '講読：『論語』学而第一と漢文訓読'),
    intro: J('Первые слова «Бесед и суждений» Конфуция (V в. до н. э.) — образец древнекитайского (вэньянь): 而 соединяет действия, 不亦…乎 — риторический вопрос «разве не…?», 之 — местоимение «это». Справа — японское чтение по правилам канбун (漢文訓読): тот же текст, переставленный в японский порядок.', '孔子『論語』の冒頭。文言の典型：而は動作をつなぎ、不亦…乎は「なんと…ではないか」という反語、之は代名詞。右は漢文訓読による日本語の読み。'),
    lines: lines(['ru', 'ja'], `
子曰： | zǐ yuē | Учитель сказал: | 子曰く、
学而时习之，不亦说乎？ | xué ér shí xí zhī, bú yì yuè hū | Учиться и вовремя повторять выученное — разве это не радость? | 学びて時に之を習ふ、亦た説ばしからずや。 // 说 здесь читается yuè и значит 悦 «радоваться»
有朋自远方来，不亦乐乎？ | yǒu péng zì yuǎnfāng lái, bú yì lè hū | Когда друг приходит издалека — разве это не счастье? | 朋有り遠方より来たる、亦た楽しからずや。 // 自 «из, от» — предлог вэньяня
人不知而不愠，不亦君子乎？ | rén bù zhī ér bú yùn, bú yì jūnzǐ hū | Не досадовать, когда люди тебя не знают, — разве не таков благородный муж? | 人知らずして慍みず、亦た君子ならずや。 // 君子 — «благородный муж», идеал Конфуция
`),
  },
  {
    id: 'c1-chengyu', kind: 'words', topic: 'speech', level: 'C1', title: J('Чэнъюй: четыре знака — одна история', '成語：四字にこめた故事'),
    intro: J('Чэнъюй — устойчивые выражения из четырёх иероглифов, почти всегда с историей из древних книг. Во многих есть японский двойник (故事成語).', '成語は四字の慣用句で、多くは古典の故事に由来する。日本語にも対応する故事成語が多い。'),
    words: words(['ru', 'ja'], `
画蛇添足 | huà shé tiān zú | испортить лишним (букв. «пририсовать змее ноги») | 蛇足（だそく） // «Чжаньго цэ»: кто первым нарисует змею, получит вино; пририсовавший ноги проиграл
守株待兔 | shǒu zhū dài tù | ждать удачи, ничего не делая (букв. «сторожить пень, ждать зайца») | 株を守る // «Хань Фэй-цзы»: заяц разбился о пень, и крестьянин бросил пахоту
对牛弹琴 | duì niú tán qín | говорить с тем, кто не поймёт (букв. «играть корове на цитре») | 馬の耳に念仏 // японский образ другой: «молитва в ухо лошади»
亡羊补牢 | wáng yáng bǔ láo | лучше поздно, чем никогда (букв. «потеряв овцу, чинить загон») | 失ってからでも直せば遅くない
井底之蛙 | jǐng dǐ zhī wā | человек с узким кругозором (букв. «лягушка на дне колодца») | 井の中の蛙（いのなかのかわず） // «Чжуан-цзы»
塞翁失马 | sài wēng shī mǎ | не знаешь, где найдёшь, где потеряешь (букв. «старик с границы потерял коня») | 人間万事塞翁が馬 // «Хуайнань-цзы»
自相矛盾 | zì xiāng máo dùn | противоречить самому себе (букв. «копьё и щит») | 矛盾（むじゅん） // «Хань Фэй-цзы»: продавец хвалил копьё, что пробьёт любой щит, и щит, что выдержит любое копьё
狐假虎威 | hú jiǎ hǔ wēi | прикрываться чужой силой (букв. «лиса пользуется грозностью тигра») | 虎の威を借る狐 // «Чжаньго цэ»
半途而废 | bàn tú ér fèi | бросить на полпути | 中途でやめる
杞人忧天 | qǐ rén yōu tiān | тревожиться попусту (букв. «человек из Ци боялся, что упадёт небо») | 杞憂（きゆう） // «Ле-цзы»
`),
  },
];

export const SECTIONS_KO = [
  {
    id: 'c1-reported', kind: 'text', topic: 'grammar', level: 'C1', title: E('Косвенная речь и её сокращения', 'Reported speech and its contractions'),
    blocks: [
      { p: E('Чужие слова передают окончанием цитаты + 하다 «говорить». Окончание зависит от типа высказывания: сообщение -다고, вопрос -냐고, предложение -자고, приказ -(으)라고. В живой речи цитата сливается с 해요: 간다고 해요 → 간대요 «говорят, (он) идёт».', 'Someone\'s words are reported by a quoting ending + 하다 "to say". The ending depends on the kind of utterance: statement -다고, question -냐고, suggestion -자고, command -(으)라고. In speech the quote fuses with 해요: 간다고 해요 → 간대요 "they say (he) is going".') },
      { table: { head: ['тип / kind', 'полная форма / full', 'сокращение / short', 'перевод / meaning'], rows: [
        ['сообщение (глагол)', '간다고 해요 · 먹는다고 해요', '간대요 · 먹는대요', '(он) говорит, что идёт · ест'], ['сообщение (прилагательное)', '예쁘다고 해요', '예쁘대요', 'говорят, красивая'],
        ['связка 이다', '학생이라고 해요', '학생이래요', 'говорит, что студент'], ['вопрос', '가냐고 물어요', '가냬요', 'спрашивает, идёт ли'],
        ['предложение', '가자고 해요', '가재요', 'предлагает пойти'], ['приказ', '가라고 해요 · 먹으라고 해요', '가래요 · 먹으래요', 'велит идти · есть'],
      ] } },
      { p: E('Грузинский передаёт чужую речь частицами: -ო (о сказанном другим: მოვალო «говорит, приду»), მეთქი (о своих словах: ვუთხარი, მოვალ-მეთქი «я сказал: приду»), თქო (просьба передать). Русский — частицами «мол», «дескать». Конструктор грузинских предложений распознаёт эти частицы.', 'Georgian reports speech with particles: -ო (someone else\'s words: მოვალო "he says he\'ll come"), მეთქი (one\'s own words), თქო (a message to pass on). Russian uses мол, дескать.') },
      { quiz: [
        { q: E('«Мама велит есть» (сокращённо)', '"Mum says to eat" (contracted)'), opts: ['엄마가 먹재요.', '엄마가 먹으래요.', '엄마가 먹는대요.'], a: 1, why: E('Приказ: -(으)라고 해요 → -(으)래요.', 'A command: -(으)라고 해요 → -(으)래요.') },
        { q: E('«Говорят, завтра будет дождь»', '"They say it will rain tomorrow"'), opts: ['내일 비가 온대요.', '내일 비가 오재요.', '내일 비가 오냬요.'], a: 0, why: E('Сообщение о действии: 온다고 해요 → 온대요.', 'A reported statement: 온다고 해요 → 온대요.') },
      ] },
      { try: [{ tool: 'ko-parse', label: E('Разбор корейского слова', 'Korean word parser') }, { course: 'ka', tool: 'ka-sentence', label: E('Грузинские частицы цитаты', 'Georgian quotative particles') }] },
    ],
  },
  {
    id: 'c1-hanja', kind: 'words', topic: 'abstract', level: 'C1', title: E('Слова ханмун: одни иероглифы на три языка', 'Sino-Korean words: one set of characters, three languages'),
    intro: E('Больше половины корейского словаря — китайского происхождения (한자어). Зная иероглифы, вы узнаёте слова в китайском и японском; в «Между языками» → «Семьи слов» эти слова собраны вместе.', 'More than half of the Korean vocabulary is of Chinese origin (한자어). Knowing the characters, you recognise the words in Chinese and Japanese; "Across languages" → "Word families" groups them.'),
    words: kw(`
학교 | школа | school // 學校 · яп. 学校 gakkō · кит. 学校 xuéxiào | 學校 · Japanese 学校 gakkō · Chinese 学校 xuéxiào
경제 | экономика | economy // 經濟 · 経済 keizai · 经济 jīngjì: «управлять миром, спасать народ» | 經濟 · 経済 keizai · 经济 jīngjì: "order the world, relieve the people"
사회 | общество | society // 社會 · 社会 shakai · 社会 shèhuì | 社會 · 社会 shakai · 社会 shèhuì
문화 | культура | culture // 文化 · 文化 bunka · 文化 wénhuà | 文化 · bunka · wénhuà
자유 | свобода | freedom // 自由 · 自由 jiyū · 自由 zìyóu: «по своей причине» | 自由 · jiyū · zìyóu: "by one's own cause"
도서관 | библиотека | library // 圖書館 · 図書館 toshokan · 图书馆 túshūguǎn | 圖書館 · toshokan · túshūguǎn
세계 | мир (весь свет) | world // 世界 · 世界 sekai · 世界 shìjiè | 世界 · sekai · shìjiè
역사 | история | history // 歷史 · 歴史 rekishi · 历史 lìshǐ | 歷史 · rekishi · lìshǐ
철학 | философия | philosophy // 哲學 · 哲学 tetsugaku · 哲学 zhéxué: слово Ниси Аманэ (1874) | 哲學 · tetsugaku · zhéxué: Nishi Amane's coinage (1874)
과학 | наука | science // 科學 · 科学 kagaku · 科学 kēxué | 科學 · kagaku · kēxué
시간 | время, час | time, hour // 時間 · 時間 jikan · 时间 shíjiān | 時間 · jikan · shíjiān
전화 | телефон | telephone // 電話 · 電話 denwa · 电话 diànhuà: «электрическая речь» | 電話 · denwa · diànhuà: "electric speech"
대학교 | университет | university // 大學校 · в японском и китайском — 大学 без 校 | 大學校 · Japanese and Chinese say 大学 without 校
민주주의 | демократия | democracy // 民主主義 · 民主主義 minshushugi · 民主主义 mínzhǔ zhǔyì | 民主主義 · minshushugi · mínzhǔ zhǔyì
`),
  },
];
