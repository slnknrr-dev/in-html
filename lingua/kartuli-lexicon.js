// lingua/kartuli-lexicon.js - a Georgian dictionary for learners who read Russian or English: nouns, proper names,
// adjectives, pronouns, numerals, postpositions, conjunctions, particles, adverbs, interjections and verbs with their
// class and principal parts. One line per headword, parsed on first use:
//
//   headword | Russian | English | tier (1 most frequent … 3) | flags separated by ';'
//
//   nouns:  h person · z animal · s syncope (the vowel before the last consonant drops: ფანჯარა -> ფანჯრის),
//           s:<stem> reduced stem given · n no truncation of -ა / -ე (კაფე -> კაფეს) · np no plural · pl:<stem>
//   verbs (the headword is the masdar, the verbal noun):
//           c:1 transitive · c:2 intransitive · c:3 medial · c:4 indirect (dative subject)
//           p: present 3sg · pv: future preverb (future = preverb + present) · f: future 3sg · i: imperfect 3sg
//           fi: conditional 3sg · a: aorist 3sg · a1: aorist 1sg · at: aorist type (e, i, ii, ie) · o: optative 3sg
//           pf: perfect 3sg · pp: pluperfect 3sg · pvo: preverb with a 1st / 2nd person object (მისცემს -> მომცემს)
//           pt: participles (comma-separated) · d:0 nothing derived by rule
//           a '-' inside a form marks the end of the preverb: და-წერა
//   ? the entry (or one of its forms) is not verified: shown with a mark
//
//   lexicon() -> [{ id, w, pos, ru, en, tier, flags, c? }]     lexByWord(w) -> [entries]     lexById(id) -> entry
//   POS: { n, np, a, pr, num, pp, cj, pt, av, i, v } with { ru, en }
//   (also used by kartuli-grammar.js: v = vowel stem in -ი, io = verb with an indirect object, m3 = 3rd-person object
//   prefix ჰ-/ს-, da:0 / dp:0 = no derived aorist / perfect; any "k:0" becomes false.)
//
// Key decisions:
// - Pipe-separated text blocks rather than JSON/object literals: compact, diff-friendly, editable by a linguist without
//   touching JS syntax; '#' lines are comments. The part of speech comes from the block a line sits in, not per line.
// - Lazy parse with three indexes built together (LIST order, BY_WORD homographs, BY_ID unique ids): import costs
//   nothing until a Georgian page actually needs the dictionary.
// - Ids are pos:word with #2, #3 suffixes for homographs: stable across edits that do not reorder homographs, so SRS
//   progress keyed by id survives lexicon growth.
// Large data tables follow: blocks carry section headers only, rows are not commented.

export const POS = {
  n: { ru: 'существительное', en: 'noun' }, np: { ru: 'имя собственное', en: 'proper name' }, a: { ru: 'прилагательное', en: 'adjective' },
  pr: { ru: 'местоимение', en: 'pronoun' }, num: { ru: 'числительное', en: 'numeral' }, pp: { ru: 'послелог', en: 'postposition' },
  cj: { ru: 'союз', en: 'conjunction' }, pt: { ru: 'частица', en: 'particle' }, av: { ru: 'наречие', en: 'adverb' },
  i: { ru: 'междометие', en: 'interjection' }, v: { ru: 'глагол (масдар)', en: 'verb (masdar)' },
};

import { N_MORE, A_MORE, AV_MORE } from './kartuli-lexicon-more.js';

let LIST = null, BY_WORD = null, BY_ID = null;

// 'k' -> true, 'k:v' -> string; typed exceptions: c is numeric, pt a list, '0' means explicitly false (so consumers
// test `!== false` to distinguish "switched off" from "absent").
function parseFlags(s) {
  const out = {};
  for (const part of String(s || '').split(';')) {
    const x = part.trim();
    if (!x) continue;
    const i = x.indexOf(':');
    if (i < 0) out[x] = true;
    else { const k = x.slice(0, i), v = x.slice(i + 1); out[k] = k === 'pt' ? v.split(',') : k === 'c' ? +v : v === '0' ? false : v; }
  }
  return out;
}

export function lexicon() {
  if (LIST) return LIST;
  LIST = [];
  BY_WORD = new Map();
  BY_ID = new Map();
  // The extra lists (kartuli-lexicon-more.js) only add words the main lists lack.
  // Main blocks are processed first, so a curated main entry always shadows an auto-extended one. Missing English
  // gloss falls back to Russian, missing tier to 2 (mid frequency).
  const more = Object.entries({ n: N_MORE, a: A_MORE, av: AV_MORE }).map(([p, x]) => [p, x, true]);
  for (const [pos, text, extra] of [...Object.entries(blocks()), ...more]) {
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const [w, ru, en, tier, flags] = line.split('|').map((x) => (x == null ? '' : x.trim()));
      if (extra && BY_WORD.has(w)) continue;
      const f = parseFlags(flags);
      const unverified = !!f['?'];
      delete f['?'];
      let id = pos + ':' + w;
      for (let k = 2; BY_ID.has(id); k++) id = pos + ':' + w + '#' + k;
      const e = { id, w, pos, ru, en: en || ru, tier: +tier || 2, flags: f, unverified };
      if (pos === 'v') e.c = f.c || 1;
      LIST.push(e);
      BY_ID.set(id, e);
      if (!BY_WORD.has(w)) BY_WORD.set(w, []);
      BY_WORD.get(w).push(e);
    }
  }
  return LIST;
}
export const lexByWord = (w) => { lexicon(); return BY_WORD.get(w) || []; };
export const lexById = (id) => { lexicon(); return BY_ID.get(id) || null; };
// counts by part of speech
export const lexStats = () => lexicon().reduce((a, e) => { a[e.pos] = (a[e.pos] || 0) + 1; return a; }, {});

// --- nouns: people, family, body, home ---------------------------------------------------------------------------
const N1 = `
კაცი|мужчина; человек|man; person|1|h
ქალი|женщина|woman|1|h
ადამიანი|человек|human being, person|1|h
ბავშვი|ребёнок|child|1|h
ბიჭი|мальчик, парень|boy, lad|1|h
გოგო|девочка, девушка|girl|1|h
გოგონა|девочка|little girl|2|h
ყმაწვილი|юноша|youth, young man|3|h
მოხუცი|старик, старуха|old person|2|h
დედა|мать|mother|1|h
მამა|отец|father|1|h
შვილი|сын, дочь (ребёнок родителей)|son, daughter (offspring)|1|h
ვაჟი|сын; юноша|son; young man|2|h
ქალიშვილი|дочь|daughter|2|h
ძმა|брат|brother|1|h
და|сестра|sister|1|h
ბებია|бабушка|grandmother|1|h
ბაბუა|дедушка|grandfather|1|h
შვილიშვილი|внук, внучка|grandchild|2|h
ბიძა|дядя|uncle|2|h
დეიდა|тётя (сестра матери)|aunt (mother's sister)|2|h
მამიდა|тётя (сестра отца)|aunt (father's sister)|2|h
ბიძაშვილი|двоюродный брат, сестра|cousin|3|h
ქმარი|муж|husband|1|h
ცოლი|жена|wife|1|h
საქმრო|жених|bridegroom, fiancé|3|h
პატარძალი|невеста (на свадьбе)|bride|3|h;s
ოჯახი|семья|family|1
ნათესავი|родственник|relative|2|h
მშობელი|родитель|parent|2|h;s
მეგობარი|друг|friend|1|h;s
მეზობელი|сосед|neighbour|2|h;s
სტუმარი|гость|guest|1|h;s
მასპინძელი|хозяин (принимающий гостей)|host|2|h;s
მტერი|враг|enemy|2|h;s
ამხანაგი|товарищ|comrade|3|h
ბატონი|господин|sir, Mr|1|h
ქალბატონი|госпожа|madam, Mrs|1|h
ხალხი|народ, люди|people (folk)|1|np
ერი|нация|nation|2
მოსწავლე|ученик|pupil|1|h
სტუდენტი|студент|student|1|h
მასწავლებელი|учитель|teacher|1|h;s
პროფესორი|профессор|professor|2|h
ექიმი|врач|doctor|1|h
მწერალი|писатель|writer|2|h;s
პოეტი|поэт|poet|2|h
მხატვარი|художник|painter|2|h;s
მუსიკოსი|музыкант|musician|3|h
მომღერალი|певец|singer|2|h;s
მსახიობი|актёр|actor|2|h
მძღოლი|водитель|driver|1|h
მგზავრი|пассажир, путник|passenger, traveller|2|h
გლეხი|крестьянин|peasant|2|h
მუშა|рабочий|worker|2|h
მეფე|царь, король|king|2|h
დედოფალი|царица, королева|queen|2|h;s
უფლისწული|царевич, принц|prince|3|h
რაინდი|рыцарь|knight|3|h
ჯარისკაცი|солдат|soldier|2|h
მეომარი|воин|warrior|3|h;s
მღვდელი|священник|priest|2|h;s
ბერი|монах|monk|3|h
მეცნიერი|учёный|scientist|2|h
ოფიციანტი|официант|waiter|2|h
გამყიდველი|продавец|seller, shop assistant|2|h
მყიდველი|покупатель|buyer|3|h
პოლიციელი|полицейский|police officer|2|h
მეთევზე|рыбак|fisherman|3|h
მწყემსი|пастух|shepherd|3|h
მონადირე|охотник|hunter|3|h
თამადა|тамада|toastmaster|2|h
ობოლი|сирота|orphan|3|h;s
ქვრივი|вдова, вдовец|widow, widower|3|h
ბავშვობა|детство|childhood|2
სიბერე|старость|old age|3
ახალგაზრდობა|молодость|youth (time)|3
თავი|голова; сам; глава|head; self; chapter|1
თმა|волосы|hair|1
სახე|лицо|face|1
შუბლი|лоб|forehead|2
თვალი|глаз|eye|1
წარბი|бровь|eyebrow|3
ცხვირი|нос|nose|1
პირი|рот; лицо, человек|mouth; person|1
ტუჩი|губа|lip|2
კბილი|зуб|tooth|1
ენა|язык|tongue; language|1
ყური|ухо|ear|1
ლოყა|щека|cheek|3
ნიკაპი|подбородок|chin|3
კისერი|шея|neck|2|s
ყელი|горло|throat|2
მხარი|плечо; сторона|shoulder; side|1
ხელი|рука|hand, arm|1
თითი|палец|finger|2
ფრჩხილი|ноготь|nail|3
მკერდი|грудь|chest|2
გული|сердце|heart|1
ზურგი|спина|back|2
მუცელი|живот|belly|2|s
ფეხი|нога|foot, leg|1
მუხლი|колено|knee|2
ძვალი|кость|bone|2|s
სისხლი|кровь|blood|2
ტანი|тело, стан|body, figure|2
სხეული|тело|body|2
ხმა|голос; звук|voice; sound|1
სული|душа|soul|1
გონება|разум|mind, reason|2
ცრემლი|слеза|tear|2
სახლი|дом|house, home|1
ბინა|квартира|flat, apartment|1
ოთახი|комната|room|1
კარი|дверь|door|1
ფანჯარა|окно|window|1|s
კედელი|стена|wall|2|s
იატაკი|пол|floor|2
ჭერი|потолок|ceiling|3
სახურავი|крыша|roof|2
კიბე|лестница|stairs, ladder|2
სამზარეულო|кухня|kitchen|1
აბაზანა|ванная|bathroom|2
საძინებელი|спальня|bedroom|2
ეზო|двор|yard, courtyard|1
ბაღი|сад|garden|1
ვენახი|виноградник|vineyard|2
ბოსტანი|огород|vegetable garden|3
ღობე|забор|fence|3
ჭიშკარი|ворота|gate|3|s
მაგიდა|стол|table|1
სკამი|стул|chair|1
სავარძელი|кресло|armchair|3|s
საწოლი|кровать|bed|1
კარადა|шкаф|wardrobe, cupboard|2
თარო|полка|shelf|3
ლამპა|лампа|lamp|3
სანთელი|свеча|candle|2|s
ხალიჩა|ковёр|carpet|2
ბალიში|подушка|pillow|3
საბანი|одеяло|blanket|3
სარკე|зеркало|mirror|2
საათი|часы; час|clock; hour|1
ტელეფონი|телефон|telephone|1
კომპიუტერი|компьютер|computer|2
ტელევიზორი|телевизор|television set|2
გასაღები|ключ|key|1
ჭურჭელი|посуда|dishes|2|s
თეფში|тарелка|plate|2
ჭიქა|стакан|glass, cup|1
ფინჯანი|чашка|cup|2
ბოთლი|бутылка|bottle|2
დანა|нож|knife|2
ჩანგალი|вилка|fork|3|s
კოვზი|ложка|spoon|2
ქვაბი|кастрюля, котёл|pot, cauldron|3
ქოთანი|горшок|pot (clay)|3|s
ყანწი|рог для вина|drinking horn|3
ქვევრი|квеври (кувшин для вина)|qvevri (wine jar)|3
`;

// --- nouns: food, nature, animals --------------------------------------------------------------------------------
const N2 = `
საჭმელი|еда|food|1|s
სადილი|обед|lunch, dinner|1
საუზმე|завтрак|breakfast|1
ვახშამი|ужин|supper|2|s
პური|хлеб|bread|1
ყველი|сыр|cheese|1
კარაქი|масло (сливочное)|butter|2
რძე|молоко|milk|1
მაწონი|мацони (кислое молоко)|matsoni (yoghurt)|2
ხორცი|мясо|meat|1
ქათამი|курица|chicken, hen|2|z;s
თევზი|рыба|fish|1|z
კვერცხი|яйцо|egg|2
მარილი|соль|salt|2
შაქარი|сахар|sugar|2|s
თაფლი|мёд|honey|2
ზეთი|масло (растительное)|oil|3
წიწაკა|перец|pepper|3
ნიორი|чеснок|garlic|3|s:ნივრ
ხახვი|лук|onion|3
კარტოფილი|картофель|potato|2
პომიდორი|помидор|tomato|2
კიტრი|огурец|cucumber|2
ლობიო|фасоль; лобио|beans|2
ბრინჯი|рис|rice|3
სუპი|суп|soup|2
ხაჭაპური|хачапури|khachapuri (cheese bread)|1
ხინკალი|хинкали|khinkali (dumplings)|1|s
მწვადი|шашлык|mtsvadi (grilled meat)|2
ჩურჩხელა|чурчхела|churchkhela|2
ნამცხვარი|пирожное, торт|cake, pastry|2|s
ტკბილეული|сладости|sweets|3
ხილი|фрукты|fruit|1|np
ვაშლი|яблоко|apple|1
მსხალი|груша|pear|2
ატამი|персик|peach|3
ყურძენი|виноград|grapes|1
ბალი|черешня|cherry|3
ნესვი|дыня|melon|3
საზამთრო|арбуз|watermelon|2
ლიმონი|лимон|lemon|2
ფორთოხალი|апельсин|orange|2
ნიგოზი|грецкий орех|walnut|2|s:ნიგვზ
თხილი|фундук|hazelnut|3
ბოსტნეული|овощи|vegetables|2
წყალი|вода|water|1|s
ღვინო|вино|wine|1
ლუდი|пиво|beer|2
ჩაი|чай|tea|1
ყავა|кофе|coffee|1
წვენი|сок|juice|2
ბუნება|природа|nature|1
მზე|солнце|sun|1
მთვარე|луна|moon|1
ვარსკვლავი|звезда|star|1
ცა|небо|sky|1
ღრუბელი|облако|cloud|2|s
ქარი|ветер|wind|1
წვიმა|дождь|rain|1
თოვლი|снег|snow|1
ყინული|лёд|ice|2
ნისლი|туман|fog|3
ჭექა-ქუხილი|гроза|thunderstorm|3
ელვა|молния|lightning|3
ცისარტყელა|радуга|rainbow|3
ამინდი|погода|weather|1
სიცხე|жара|heat|2
სიცივე|холод|cold|2
ჰაერი|воздух|air|2
ცეცხლი|огонь|fire|1
კვამლი|дым|smoke|3
მიწა|земля|earth, ground, land|1
ქვა|камень|stone|1
ქვიშა|песок|sand|3
მთა|гора|mountain|1
გორა|холм|hill|3
კლდე|скала|rock, cliff|2
ხევი|ущелье|gorge|2
ველი|поле, равнина|field, plain|2
მინდორი|поле, луг|meadow, field|2|s:მინდვრ
ტყე|лес|forest|1
ხე|дерево|tree|1
ტოტი|ветка|branch|3
ფოთოლი|лист|leaf|2|s
ყვავილი|цветок|flower|1
ვარდი|роза|rose|2
ია|фиалка|violet (flower)|3
ბალახი|трава|grass|2
ფესვი|корень|root|3
თესლი|семя|seed|3
მდინარე|река|river|1
ტბა|озеро|lake|2
ზღვა|море|sea|1
ნაპირი|берег|shore, bank|2
კუნძული|остров|island|2
წყარო|родник, источник|spring, source|2
ჩანჩქერი|водопад|waterfall|3
ტალღა|волна|wave|3
ცხოველი|животное|animal|1|z
ფრინველი|птица|bird|2|z
ჩიტი|птичка|small bird|1|z
ძაღლი|собака|dog|1|z
კატა|кошка|cat|1|z
ცხენი|лошадь|horse|1|z
ძროხა|корова|cow|2|z
ხარი|бык|ox, bull|2|z
ცხვარი|овца|sheep|2|z;s
თხა|коза|goat|2|z
ღორი|свинья|pig|2|z
ვირი|осёл|donkey|2|z
თაგვი|мышь|mouse|2|z
კურდღელი|заяц|hare|3|z;s
მგელი|волк|wolf|2|z;s
მელა|лиса|fox|2|z
დათვი|медведь|bear|2|z
ლომი|лев|lion|2|z
ვეფხვი|тигр|tiger|2|z
ირემი|олень|deer|3|z;s
არწივი|орёл|eagle|2|z
ბულბული|соловей|nightingale|3|z
მტრედი|голубь|pigeon, dove|3|z
ყვავი|ворона|crow|3|z
იხვი|утка|duck|3|z
ბატი|гусь|goose|3|z
მამალი|петух|rooster|3|z;s
გველი|змея|snake|2|z
ბაყაყი|лягушка|frog|3|z
ფუტკარი|пчела|bee|3|z;s
პეპელა|бабочка|butterfly|3|z
ბუზი|муха|fly|3|z
ჭიანჭველა|муравей|ant|3|z
ლეკვი|щенок, детёныш|puppy, cub|3|z
კვიცი|жеребёнок|foal|3|z
აქლემი|верблюд|camel|3|z
სპილო|слон|elephant|3|z
მაიმუნი|обезьяна|monkey|3|z
ოქრო|золото|gold|2
ვერცხლი|серебро|silver|2
რკინა|железо|iron|2
`;

// --- nouns: town, travel, time, work, society --------------------------------------------------------------------
const N3 = `
ქალაქი|город|city, town|1
სოფელი|село, деревня; мир (стар.)|village; world (old)|1|s
დედაქალაქი|столица|capital|2
ქვეყანა|страна|country|1
სამშობლო|родина|homeland|2
ქუჩა|улица|street|1
გამზირი|проспект|avenue|2
მოედანი|площадь|square|2|s
ხიდი|мост|bridge|2
გზა|дорога, путь|road, way|1
ბილიკი|тропинка|path|3
შენობა|здание|building|2
სასახლე|дворец|palace|2
ციხე|крепость; тюрьма|fortress; prison|2
ეკლესია|церковь|church|2
ტაძარი|храм, собор|cathedral, temple|2|s
მონასტერი|монастырь|monastery|3|s
სკოლა|школа|school|1
უნივერსიტეტი|университет|university|2
საავადმყოფო|больница|hospital|2
აფთიაქი|аптека|pharmacy|2
მაღაზია|магазин|shop|1
ბაზარი|рынок|market|1|s
ბანკი|банк|bank|2
ფოსტა|почта|post office|3
სასტუმრო|гостиница|hotel|1
რესტორანი|ресторан|restaurant|1
კაფე|кафе|café|1|n
თეატრი|театр|theatre|2
კინო|кино|cinema|2
მუზეუმი|музей|museum|2
ბიბლიოთეკა|библиотека|library|2
პარკი|парк|park|2
სადგური|вокзал, станция|station|2
აეროპორტი|аэропорт|airport|2
მეტრო|метро|metro|1
მანქანა|машина|car; machine|1
ავტობუსი|автобус|bus|1
ტაქსი|такси|taxi|1
მატარებელი|поезд|train|1|s
თვითმფრინავი|самолёт|aeroplane|2
გემი|корабль|ship|2
ნავი|лодка|boat|2
ველოსიპედი|велосипед|bicycle|3
ბილეთი|билет|ticket|1
ფული|деньги|money|1|np
ლარი|лари (валюта)|lari (currency)|1
ფასი|цена|price|1
ანგარიში|счёт|bill, account|1
საჩუქარი|подарок|gift|2|s
სამუშაო|работа (место)|work, job|1
სამსახური|служба, работа|job, service|1
საქმე|дело|matter, business, affair|1
ოფისი|офис|office|2
შეხვედრა|встреча|meeting|1
კრება|собрание|assembly|3
ომი|война|war|1
მშვიდობა|мир (не война)|peace|1
ბრძოლა|битва, борьба|battle, struggle|2
გამარჯვება|победа|victory|2
ჯარი|войско, армия|army|2
ხმალი|меч|sword|2|s
ფარი|щит|shield|3
მთავრობა|правительство|government|2
სახელმწიფო|государство|state|2
კანონი|закон|law|2
უფლება|право|right|2
თავისუფლება|свобода|freedom|1
ისტორია|история|history; story|1
ამბავი|история, новость|story, news|1|s:ამბ
ზღაპარი|сказка|fairy tale|2|s
წიგნი|книга|book|1
წერილი|письмо|letter|1
გაზეთი|газета|newspaper|2
ჟურნალი|журнал|magazine|3
ლექსი|стихотворение|poem|1
სიმღერა|песня|song|1
მუსიკა|музыка|music|1
ცეკვა|танец|dance|2
სურათი|картина, фото|picture|1
ფილმი|фильм|film|2
თამაში|игра|game|1
სიტყვა|слово|word|1
წინადადება|предложение|sentence; proposal|2
ასო|буква|letter (of the alphabet)|2
ანბანი|алфавит|alphabet|2
სახელი|имя|name|1
გვარი|фамилия; род|surname; kin|2
კითხვა|вопрос; чтение|question; reading|1
პასუხი|ответ|answer|1
აზრი|мысль, мнение, смысл|thought, opinion, sense|1
ფიქრი|дума, мысль|thought|2
სიმართლე|правда|truth|1
ტყუილი|ложь|lie|2
იდეა|идея|idea|2
მიზეზი|причина|reason|2
მიზანი|цель|goal|2|s
შედეგი|результат|result|2
პრობლემა|проблема|problem|1
შესაძლებლობა|возможность|possibility|2
დრო|время|time|1
წამი|секунда; миг|second; moment|2
წუთი|минута|minute|1
დღე|день|day|1
ღამე|ночь|night|1
დილა|утро|morning|1
საღამო|вечер|evening|1
შუადღე|полдень|noon|2
შუაღამე|полночь|midnight|3
კვირა|неделя; воскресенье|week; Sunday|1
თვე|месяц|month|1
წელი|год; поясница|year; waist|1|s
საუკუნე|век|century|2
გაზაფხული|весна|spring|1
ზაფხული|лето|summer|1
შემოდგომა|осень|autumn|1
ზამთარი|зима|winter|1|s
ორშაბათი|понедельник|Monday|2
სამშაბათი|вторник|Tuesday|2
ოთხშაბათი|среда|Wednesday|2
ხუთშაბათი|четверг|Thursday|2
პარასკევი|пятница|Friday|2
შაბათი|суббота|Saturday|2
იანვარი|январь|January|3|s
თებერვალი|февраль|February|3|s
მარტი|март|March|3
აპრილი|апрель|April|3
მაისი|май|May|3
ივნისი|июнь|June|3
ივლისი|июль|July|3
აგვისტო|август|August|3
სექტემბერი|сентябрь|September|3|s
ოქტომბერი|октябрь|October|3|s
ნოემბერი|ноябрь|November|3|s
დეკემბერი|декабрь|December|3|s
დაბადების დღე|день рождения|birthday|2
დღესასწაული|праздник|holiday, feast|2
ქორწილი|свадьба|wedding|2
სუფრა|стол (накрытый), застолье|laid table, feast|2
სადღეგრძელო|тост|toast|2
ტანსაცმელი|одежда|clothes|1|s
პერანგი|рубашка|shirt|2
კაბა|платье|dress|2
შარვალი|брюки|trousers|2|s
ქუდი|шапка, шляпа|hat|2
ფეხსაცმელი|обувь|shoes|2|s
ჩოხა|чоха (черкеска)|chokha (Georgian coat)|3
ჩანთა|сумка|bag|2
ქაღალდი|бумага|paper|2
კალამი|ручка|pen|2|s
ფანქარი|карандаш|pencil|3|s
რვეული|тетрадь|exercise book|3
დაფა|доска|board|3
კარტი|карта (игральная)|card|3
რუკა|карта (географическая)|map|2
სამყარო|мир, вселенная|world, universe|1
მსოფლიო|мир (весь), всемирный|world|2
ცხოვრება|жизнь (образ жизни)|life, living|1
სიცოცხლე|жизнь (бытие)|life (being alive)|1
სიკვდილი|смерть|death|2
სიყვარული|любовь|love|1
მეგობრობა|дружба|friendship|2
ბედნიერება|счастье|happiness|1
სიხარული|радость|joy|1
მწუხარება|печаль|sorrow|3
შიში|страх|fear|2
იმედი|надежда|hope|1
ოცნება|мечта|dream (wish)|2
სიზმარი|сон (сновидение)|dream (in sleep)|2|s
ძილი|сон|sleep|2
ჯანმრთელობა|здоровье|health|2
ავადმყოფობა|болезнь|illness|3
წამალი|лекарство|medicine|2|s
ტკივილი|боль|pain|2
ძალა|сила|strength, force|1
ღმერთი|бог|god|1
ცოდნა|знание|knowledge|2
სწავლა|учёба|learning, study|1
გაკვეთილი|урок|lesson|1
მაგალითი|пример|example|2
ნაწილი|часть|part|1
ადგილი|место|place|1
მხარე|сторона, край|side, region|1
კუთხე|угол; край|corner; region|2
შუა|середина|middle|2
ბოლო|конец|end|1
დასაწყისი|начало|beginning|2
ფერი|цвет|colour|1
ზომა|размер|size|2
რაოდენობა|количество|amount|3
წონა|вес|weight|3
ხაზი|линия|line|2
წერტილი|точка|point, full stop|3
ნიშანი|знак|sign, mark|2|s
`;

// --- nouns: things, abstractions, culture ------------------------------------------------------------------------
const N4 = `
ნივთი|вещь|thing|2
საგანი|предмет|object, subject|2|s
რამე|что-нибудь, вещь|something|2
ყუთი|ящик, коробка|box|2
კალათა|корзина|basket|3
ტომარა|мешок|sack|3
თოკი|верёвка|rope|3
ძაფი|нитка|thread|3
ნემსი|игла|needle|3
სათამაშო|игрушка|toy|2
ბურთი|мяч|ball|2
ზარი|колокол, звонок|bell|2
სიმი|струна|string (of an instrument)|3
ფანდური|пандури (лютня)|panduri (lute)|3
დოლი|барабан|drum|3
ჩონგური|чонгури|chonguri (lute)|3
ცული|топор|axe|3
ჩაქუჩი|молоток|hammer|3
ლურსმანი|гвоздь|nail (metal)|3|s
ბორბალი|колесо|wheel|3|s
ურემი|арба, телега|cart|3|s
ქოხი|хижина|hut|3
კოშკი|башня|tower|2
ჭა|колодец|well|3
წისქვილი|мельница|mill|3
ბეღელი|амбар|barn|3|s
მარანი|винный погреб|wine cellar|3|s
ღუმელი|печь|stove, oven|3|s
ბუხარი|камин|fireplace|3|s
კერა|очаг|hearth|3
ნაცარი|пепел, зола|ash|3|s
ნახშირი|уголь|coal, charcoal|3
ბალახეული|травы|herbs|3
სანელებელი|пряность|spice|3|s
ფქვილი|мука|flour|3
ცომი|тесто|dough|3
ღომი|гоми (каша)|ghomi (maize porridge)|3
მჭადი|мчади (кукурузная лепёшка)|mchadi (corn bread)|3
ლავაში|лаваш|lavash|3
კანი|кожа|skin|2
ტყავი|шкура, кожа|hide, leather|3
ბეწვი|мех|fur|3
ფრთა|крыло|wing|2
ბუდე|гнездо|nest|3
კუდი|хвост|tail|3
რქა|рог|horn|2
ვაჭრობა|торговля|trade|3
ვაჭარი|купец|merchant|3|h;s
ხელობა|ремесло|craft|3
ხელოვნება|искусство|art|2
კულტურა|культура|culture|2
ტრადიცია|традиция|tradition|2
ჩვეულება|обычай|custom|2
რწმენა|вера|faith, belief|2
ლოცვა|молитва|prayer|2
ჯვარი|крест|cross|2
ანგელოზი|ангел|angel|3|h
ეშმაკი|чёрт|devil|3|h
გმირი|герой|hero|2|h
ლეგენდა|легенда|legend|3
მითი|миф|myth|3
პოეზია|поэзия|poetry|2
რომანი|роман|novel|2
მოთხრობა|рассказ|short story|2
ავტორი|автор|author|2|h
მკითხველი|читатель|reader|3|h
პერსონაჟი|персонаж|character (in a story)|3|h
სცენა|сцена|stage, scene|3
როლი|роль|role|3
დიალოგი|диалог|dialogue|3
საუბარი|беседа, разговор|conversation|2|s
ლაპარაკი|разговор, речь|talk|2
სიტყვიერება|словесность|literature (old word)|3
ლიტერატურა|литература|literature|2
გრამატიკა|грамматика|grammar|3
ზმნა|глагол|verb|2
არსებითი სახელი|существительное|noun|3
ბრუნვა|падеж; склонение|case; declension|3
ბრუნება|склонение|declension|3
უღლება|спряжение|conjugation|3
მწკრივი|ряд; скрив (время глагола)|row; screeve|3
ფუძე|основа|stem|3
ძირი|корень (слова), низ|root, bottom|3
სუფიქსი|суффикс|suffix|3
თანდებული|послелог|postposition|3
ბგერა|звук (речи)|speech sound|3
მარცვალი|слог; зерно|syllable; grain|3|s
მახვილი|ударение|stress (accent)|3
აზროვნება|мышление|thinking|3
მეხსიერება|память|memory|2
გრძნობა|чувство|feeling|2
სურვილი|желание|wish, desire|2
ნება|воля|will|2
ხასიათი|характер|character, temper|2
ბუნებრიობა|естественность|naturalness|3
სიკეთე|добро|goodness|2
ბოროტება|зло|evil|2
სილამაზე|красота|beauty|2
სიბრძნე|мудрость|wisdom|2
სიმშვიდე|спокойствие|calm|3
სიჩუმე|тишина|silence|2
ხმაური|шум|noise|2
სინათლე|свет|light|2
სიბნელე|темнота|darkness|2
ჩრდილი|тень|shadow, shade|2
ღირსება|достоинство|dignity|2
პატივი|честь, почёт|honour|2
სირცხვილი|стыд|shame|2
ბედი|судьба|fate|2
იღბალი|удача|luck|3|s
შეცდომა|ошибка|mistake|1
მოვალეობა|долг (обязанность)|duty|3
ვალი|долг (денежный)|debt|3
ხარჯი|расход|expense|3
სარგებელი|польза|benefit|3|s
საფრთხე|опасность|danger|2
დახმარება|помощь|help|1
თხოვნა|просьба|request|2
ბრძანება|приказ|order, command|2
რჩევა|совет|advice|2
ნებართვა|разрешение|permission|3
გზავნილი|послание|message|3
ცნობა|справка, сведение|notice, information|3
ინფორმაცია|информация|information|2
ამოცანა|задача|task, problem|2
გამოცდა|экзамен|exam|2
შანსი|шанс|chance|3
გეგმა|план|plan|2
მოგზაურობა|путешествие|journey|2
დასვენება|отдых|rest|2
შვებულება|отпуск|holiday (leave)|3
ტური|тур|tour|3
ექსკურსია|экскурсия|excursion|3
ბარგი|багаж|luggage|3
პასპორტი|паспорт|passport|2
საზღვარი|граница|border|2|s
უცხოელი|иностранец|foreigner|2|h
თარჯიმანი|переводчик|interpreter|3|h
თარგმანი|перевод|translation|3
ლექსიკონი|словарь|dictionary|2
ბრძოლის ველი|поле битвы|battlefield|3
გამარჯობა|здравствуйте (приветствие)|hello|1
მადლობა|спасибо, благодарность|thanks|1
ბოდიში|извинение; извините|apology; sorry|1
ნახვამდის|до свидания|goodbye|1
ნაბიჯი|шаг|step|2
მოძრაობა|движение|movement|2
ხმაურობა|шум, суета|bustle|3
სიჩქარე|скорость|speed|3
ძალაუფლება|власть|power|3
ხელისუფლება|власть (органы)|authorities|3
პრეზიდენტი|президент|president|3|h
მინისტრი|министр|minister|3|h
დეპუტატი|депутат|deputy|3|h
პარტია|партия|party|3
საზოგადოება|общество|society|2
ჯგუფი|группа|group|2
კლასი|класс|class|2
გუნდი|команда; хор|team; choir|2
ფეხბურთი|футбол|football|2
ჭადრაკი|шахматы|chess|3
ჭიდაობა|борьба (спорт)|wrestling|3
მოგება|выигрыш|win, profit|3
წაგება|проигрыш|loss|3
ფიცი|клятва|oath|3
სიცილი|смех|laughter|2
ტირილი|плач|crying|2
ღიმილი|улыбка|smile|2
კოცნა|поцелуй|kiss|2
ხვევნა|объятие|hug|3
ჩხუბი|ссора, драка|quarrel, fight|3
ბრაზი|гнев|anger|3
სინანული|сожаление|regret|3
მოწყენილობა|скука|boredom|3
დაღლილობა|усталость|tiredness|3
შიმშილი|голод|hunger|3
წყურვილი|жажда|thirst|3
სუნი|запах|smell|2
გემო|вкус|taste|2
ტელევიზია|телевидение|television|3
რადიო|радио|radio|3
ინტერნეტი|интернет|internet|2
პროგრამა|программа|programme|3
ფაილი|файл|file|3
ეკრანი|экран|screen|3
ღილაკი|кнопка|button|3
ფოტო|фото|photo|2
ელფოსტა|электронная почта|e-mail|3
მისამართი|адрес|address|2
ნომერი|номер|number (label)|2|s
რიცხვი|число|number; date|2
ციფრი|цифра|digit|3
ასაკი|возраст|age|2
სიმაღლე|высота, рост|height|3
სიგრძე|длина|length|3
სიგანე|ширина|width|3
სიღრმე|глубина|depth|3
ჩრდილოეთი|север|north|2
სამხრეთი|юг|south|2
აღმოსავლეთი|восток|east|2
დასავლეთი|запад|west|2
მარჯვენა|правая сторона|right (side)|3
მარცხენა|левая сторона|left (side)|3
ზედაპირი|поверхность|surface|3
შიგთავსი|содержимое|contents|3
`;

// --- proper names (v: a name in -ი keeps it: გიორგიმ, გიორგის) --------------------------------------------------
const NP = `
საქართველო|Грузия|Georgia|1
თბილისი|Тбилиси|Tbilisi|1
ქუთაისი|Кутаиси|Kutaisi|2
ბათუმი|Батуми|Batumi|2
მცხეთა|Мцхета|Mtskheta|2
გორი|Гори|Gori|3
თელავი|Телави|Telavi|3
სიღნაღი|Сигнахи|Sighnaghi|3
კახეთი|Кахетия|Kakheti|2
იმერეთი|Имеретия|Imereti|2
სვანეთი|Сванетия|Svaneti|2
აჭარა|Аджария|Adjara|3
გურია|Гурия|Guria|3
სამეგრელო|Мегрелия|Samegrelo|3
მტკვარი|Кура (река)|Mtkvari (Kura river)|2|s
რიონი|Риони|Rioni|3
კავკასიონი|Кавказский хребет|Greater Caucasus|3
ყაზბეგი|Казбек|Kazbegi|3
შავი ზღვა|Чёрное море|Black Sea|2
რუსეთი|Россия|Russia|2
მოსკოვი|Москва|Moscow|2
ევროპა|Европа|Europe|2
ამერიკა|Америка|America|2
ინგლისი|Англия|England|3
საფრანგეთი|Франция|France|3
გერმანია|Германия|Germany|3
სომხეთი|Армения|Armenia|3
აზერბაიჯანი|Азербайджан|Azerbaijan|3
თურქეთი|Турция|Turkey|3
ირანი|Иран|Iran|3
იაპონია|Япония|Japan|3
ჩინეთი|Китай|China|3
ინდოეთი|Индия|India|3
გიორგი|Георгий|Giorgi|1|h;v
ნინო|Нино|Nino|1|h
დავითი|Давид|Davit|2|h
თამარი|Тамара|Tamar|2|h
ლევანი|Леван|Levan|2|h
ირაკლი|Ираклий|Irakli|2|h;v
ნიკა|Ника|Nika|2|h;n
ანა|Анна|Ana|2|h;n
მარიამი|Мариам|Mariam|2|h
ეკა|Эка|Eka|3|h;n
ქეთევანი|Кетеван|Ketevan|3|h
ლაშა|Лаша|Lasha|3|h;n
ზურაბი|Зураб|Zurab|3|h
ვახტანგი|Вахтанг|Vakhtang|3|h
ილია|Илья|Ilia|3|h;n
შოთა|Шота|Shota|2|h;n
ნიკოლოზი|Николоз|Nikoloz|3|h
ელენე|Елена|Elene|3|h;n
სოფო|Софо|Sopo|3|h
დათო|Дато|Dato|2|h
გოგა|Гога|Goga|3|h;n
ბესო|Бесо|Beso|3|h
მზია|Мзия|Mzia|3|h;n
რუსთაველი|Руставели|Rustaveli|2|h
ბარათაშვილი|Бараташвили|Baratashvili|3|h
ჭავჭავაძე|Чавчавадзе|Chavchavadze|3|h;n
ვაჟა-ფშაველა|Важа-Пшавела|Vazha-Pshavela|3|h;n
ფიროსმანი|Пиросмани|Pirosmani|3|h
`;

// --- adjectives (attributive forms come from adjAgree) -----------------------------------------------------------
const A1 = `
კარგი|хороший|good|1
ცუდი|плохой|bad|1
დიდი|большой|big, great|1
პატარა|маленький|small|1
ახალი|новый|new|1|s
ძველი|старый (о вещах)|old|1
ახალგაზრდა|молодой|young|1
მოხუცებული|пожилой|elderly|3
ლამაზი|красивый|beautiful|1
მშვენიერი|прекрасный|wonderful|2
უშნო|некрасивый|ugly|3
მაღალი|высокий|tall, high|1|s
დაბალი|низкий|low, short|1|s
გრძელი|длинный|long|1
მოკლე|короткий|short|1
ფართო|широкий|wide|2
ვიწრო|узкий|narrow|2
სქელი|толстый (о вещах)|thick|2
თხელი|тонкий|thin|2
მსუქანი|толстый, полный|fat|3|s
გამხდარი|худой|thin (person)|2|s
მძიმე|тяжёлый|heavy|2
მსუბუქი|лёгкий (по весу)|light (weight)|2
ადვილი|лёгкий, простой|easy|1
რთული|сложный|difficult, complex|1
ძნელი|трудный|hard|2
მარტივი|простой|simple|2
სწრაფი|быстрый|fast|1
ნელი|медленный|slow|2
ცხელი|горячий|hot|1
თბილი|тёплый|warm|1
გრილი|прохладный|cool|2
ცივი|холодный|cold|1
სველი|мокрый|wet|2
მშრალი|сухой|dry|2
სუფთა|чистый|clean|1
ჭუჭყიანი|грязный|dirty|2
ახლო|близкий|near|2
შორეული|далёкий|distant|3
ძვირი|дорогой (по цене)|expensive|1
იაფი|дешёвый|cheap|1
ძვირფასი|дорогой, ценный|precious, dear|1
ტკბილი|сладкий|sweet|1
მწარე|горький|bitter|2
მჟავე|кислый|sour|2
მლაშე|солёный|salty|3
გემრიელი|вкусный|tasty|1
ცხარე|острый (о еде)|spicy|2
მწიფე|спелый|ripe|3
ნედლი|сырой|raw|3
ჯანმრთელი|здоровый|healthy|2
ავადმყოფი|больной|sick|2
დაღლილი|усталый|tired|2
მშიერი|голодный|hungry|2
მაძღარი|сытый|full (fed)|3|s
ბედნიერი|счастливый|happy|1
უბედური|несчастный|unhappy|2
მხიარული|весёлый|cheerful|2
სევდიანი|грустный|sad|2
მოწყენილი|скучающий, грустный|sad, bored|2
მშვიდი|спокойный|calm|2
ბრაზიანი|сердитый|angry|3
კეთილი|добрый|kind|1
ბოროტი|злой|evil|2
ჭკვიანი|умный|clever|1
სულელი|глупый, дурак|stupid, fool|2
ბრძენი|мудрый|wise|2
გულადი|отважный|brave|3
მამაცი|храбрый|brave|2
მშიშარა|трусливый|cowardly|3
ზარმაცი|ленивый|lazy|2
ბეჯითი|прилежный|diligent|3
ერთგული|верный|loyal|2
მართალი|правдивый, правый|true, right|1|s
ტყუილი|ложный|false|3
ზრდილობიანი|вежливый|polite|2
უხეში|грубый|rude|3
მორცხვი|застенчивый|shy|3
ამაყი|гордый|proud|2
თავმდაბალი|скромный|modest|3|s
მდიდარი|богатый|rich|1|s
ღარიბი|бедный|poor|1
საინტერესო|интересный|interesting|1
მოსაწყენი|скучный|boring|2
მნიშვნელოვანი|важный|important|1
საჭირო|нужный|necessary|1
სასარგებლო|полезный|useful|2
საშიში|опасный|dangerous|2
უსაფრთხო|безопасный|safe|3
ცნობილი|известный|famous, known|1
უცნობი|незнакомый|unknown|2
უცხო|чужой, иностранный|foreign, strange|2
ნაცნობი|знакомый|acquainted|2
მთავარი|главный|main|1
პირველი|первый|first|1
ბოლო|последний|last|1
ერთადერთი|единственный|only, sole|2
ყოველი|каждый|every|1
ყველა|все|all, everybody|1
ბევრი|много, многие|many, much|1
ცოტა|мало, немного|little, few|1
სრული|полный|full, complete|2
ცარიელი|пустой|empty|2
ღია|открытый; светлый (о цвете)|open; light (colour)|1
დახურული|закрытый|closed|2
თავისუფალი|свободный|free|1|s
დაკავებული|занятый|busy|2
მზად|готов|ready|1
სწორი|прямой, правильный|straight, correct|1
მრუდე|кривой|crooked|3
მრგვალი|круглый|round|2
ბრტყელი|плоский|flat|3
ბასრი|острый|sharp|3
ბლაგვი|тупой (о ноже)|blunt|3
რბილი|мягкий|soft|2
მაგარი|твёрдый; крутой|hard; cool|2|s
ძლიერი|сильный|strong|1
სუსტი|слабый|weak|2
მყარი|прочный|solid, firm|3
ხმამაღალი|громкий|loud|2
წყნარი|тихий|quiet|2
ნათელი|светлый|bright, clear|2|s
ბნელი|тёмный|dark|2
მუქი|тёмный (о цвете)|dark (colour)|3
ფერადი|цветной|colourful|3
თეთრი|белый|white|1
შავი|чёрный|black|1
წითელი|красный|red|1|s
ყვითელი|жёлтый|yellow|1|s
მწვანე|зелёный|green|1
ლურჯი|синий|blue|1
ცისფერი|голубой|light blue|2
ნაცრისფერი|серый|grey|2
ყავისფერი|коричневый|brown|2
ვარდისფერი|розовый|pink|2
იისფერი|фиолетовый|violet|3
ნარინჯისფერი|оранжевый|orange (colour)|3
ოქროსფერი|золотистый|golden|3
ცოცხალი|живой|alive|2|s
მკვდარი|мёртвый|dead|2|s
მთელი|целый, весь|whole|1
ნახევარი|половина; полу-|half|2|s
საერთო|общий|common|2
პირადი|личный|personal|3
საკუთარი|собственный|own|2|s
ქართული|грузинский|Georgian|1
რუსული|русский|Russian|1
ინგლისური|английский|English|1
ფრანგული|французский|French|3
გერმანული|немецкий|German|3
ბერძნული|греческий|Greek|3
ლათინური|латинский|Latin|3
სომხური|армянский|Armenian|3
ებრაული|еврейский|Hebrew, Jewish|3
იაპონური|японский|Japanese|3
ჩინური|китайский|Chinese|3
უცხოური|иностранный|foreign|3
ადგილობრივი|местный|local|3
ეროვნული|национальный|national|3
ხალხური|народный|folk|3
ძველებური|старинный|old-fashioned|3
თანამედროვე|современный|modern|2
მომავალი|будущий; будущее|future|1|s
წარსული|прошлый; прошлое|past|2
შემდეგი|следующий|next|1
წინა|предыдущий, передний|previous, front|2
უკანა|задний|back, rear|3
ზედა|верхний|upper|3
ქვედა|нижний|lower|3
მარჯვენა|правый|right|2
მარცხენა|левый|left|2
შუა|средний|middle|2
ბუნებრივი|естественный|natural|3
ნამდვილი|настоящий|real|2
ყალბი|фальшивый|fake|3
შესაძლებელი|возможный|possible|2
შეუძლებელი|невозможный|impossible|2
აუცილებელი|обязательный|necessary|2
ცნობისმოყვარე|любопытный|curious|3
მოხერხებული|ловкий, удобный|handy, deft|3
მარჯვე|ловкий|dexterous|3
გულწრფელი|искренний|sincere|3
საყვარელი|любимый, милый|beloved, lovely|1
საოცარი|удивительный|amazing|2|s
უცნაური|странный|strange|2
ჩვეულებრივი|обычный|usual, ordinary|2
განსაკუთრებული|особый|special|2
სასიამოვნო|приятный|pleasant|2
უსიამოვნო|неприятный|unpleasant|3
ღირსეული|достойный|worthy|3
სახელოვანი|славный|glorious|3
ბრმა|слепой|blind|3
ყრუ|глухой|deaf|3
მუნჯი|немой|mute|3
ობოლი|осиротевший|orphaned|3
მარტოხელა|одинокий|lonely|3
მარტო|один, одинокий|alone|2
`;

// --- pronouns, numerals, postpositions, conjunctions, particles, adverbs, interjections ----------------------------
const PR = `
მე|я|I|1
შენ|ты|you|1
ის|он, она, оно; тот|he, she, it; that|1
იგი|он, она (книжн.)|he, she (bookish)|2
ეს|этот, это|this|1
ეგ|тот (возле тебя)|that (near you)|2
ჩვენ|мы|we|1
თქვენ|вы|you (pl., polite)|1
ისინი|они|they|1
ესენი|эти|these|2
ეგენი|те (возле тебя)|those (near you)|3
ჩემი|мой|my|1
შენი|твой|your|1
მისი|его, её|his, her|1
ჩვენი|наш|our|1
თქვენი|ваш|your (pl.)|1
მათი|их|their|1
თავისი|свой (его, её)|his / her own|1
საკუთარი თავი|сам себя|oneself|3
ვინ|кто|who|1
რა|что|what|1
რომელი|который|which|1
როგორი|какой|what kind|1
რამდენი|сколько|how many|1
ვინც|кто (относ.)|who (relative)|1
რაც|что (относ.)|what, which (relative)|1
რომელიც|который (относ.)|which, who (relative)|1
როგორიც|такой, какой (относ.)|such as|2
რამდენიც|сколько (относ.)|as many as|3
ვიღაც|кто-то|somebody|2
რაღაც|что-то|something|1
ვინმე|кто-нибудь|anybody|2
რამე|что-нибудь|anything|2
არავინ|никто|nobody|1
არაფერი|ничто|nothing|1
ვერავინ|никто (не смог)|nobody (could)|3
ვერაფერი|ничего (не смог)|nothing (could)|3
ნურავინ|пусть никто|let nobody|3
ყველა|все|everybody|1
ყველაფერი|всё|everything|1
თითოეული|каждый в отдельности|each one|3
სხვა|другой|other|1
ასეთი|такой|such|1
ისეთი|такой (тот)|such (that)|2
ამდენი|столько|so many|2
იმდენი|столько (того)|that many|3
`;
const NUM = `
ნული|ноль|zero|2
ერთი|один|one|1
ორი|два|two|1
სამი|три|three|1
ოთხი|четыре|four|1
ხუთი|пять|five|1
ექვსი|шесть|six|1
შვიდი|семь|seven|1
რვა|восемь|eight|1
ცხრა|девять|nine|1
ათი|десять|ten|1
თერთმეტი|одиннадцать|eleven|2
თორმეტი|двенадцать|twelve|2
ცამეტი|тринадцать|thirteen|2
თოთხმეტი|четырнадцать|fourteen|2
თხუთმეტი|пятнадцать|fifteen|2
თექვსმეტი|шестнадцать|sixteen|2
ჩვიდმეტი|семнадцать|seventeen|2
თვრამეტი|восемнадцать|eighteen|2
ცხრამეტი|девятнадцать|nineteen|2
ოცი|двадцать|twenty|1
ოცდაათი|тридцать (20 + 10)|thirty|2
ორმოცი|сорок (2 × 20)|forty|2
ორმოცდაათი|пятьдесят (2 × 20 + 10)|fifty|2
სამოცი|шестьдесят (3 × 20)|sixty|2
სამოცდაათი|семьдесят|seventy|2
ოთხმოცი|восемьдесят (4 × 20)|eighty|2
ოთხმოცდაათი|девяносто|ninety|2
ასი|сто|hundred|1
ორასი|двести|two hundred|2
ათასი|тысяча|thousand|1
მილიონი|миллион|million|2
მეორე|второй|second|1
მესამე|третий|third|1
მეოთხე|четвёртый|fourth|2
მეხუთე|пятый|fifth|2
მეექვსე|шестой|sixth|3
მეშვიდე|седьмой|seventh|3
მერვე|восьмой|eighth|3
მეცხრე|девятый|ninth|3
მეათე|десятый|tenth|2
მეოცე|двадцатый|twentieth|3
მეასე|сотый|hundredth|3
ნახევარი|половина|half|2|s
მეოთხედი|четверть|quarter|3
ორივე|оба|both|2
სამივე|все трое|all three|3
თითო|по одному|one each|3
`;
const PPW = `
შესახებ|о, про (+ род.)|about (+ gen.)|1
გამო|из-за (+ род.)|because of (+ gen.)|1
მიერ|(сделано) кем (+ род.)|by (agent, + gen.)|2
შემდეგ|после (+ род.)|after (+ gen.)|1
წინ|перед (+ род.)|in front of, before (+ gen.)|1
უკან|за, позади (+ род.)|behind (+ gen.)|1
გარეშე|без (+ род.)|without (+ gen.)|1
ნაცვლად|вместо (+ род.)|instead of (+ gen.)|2
მაგივრად|вместо (+ род.)|instead of (+ gen.)|3
გარდა|кроме (+ род.)|except (+ gen.)|2
შორის|между, среди (+ род.)|between, among (+ gen.)|2
ირგვლივ|вокруг (+ род.)|around (+ gen.)|2
მიუხედავად|несмотря на (+ род.)|despite (+ gen.)|2
თანახმად|согласно (+ род.)|according to (+ gen.)|3
დროს|во время (+ род.)|during (+ gen.)|1
წინააღმდეგ|против (+ род.)|against (+ gen.)|2
მიმართ|по отношению к (+ род.)|towards (+ gen.)|3
ქვეშ|под (+ род.)|under (+ gen.)|2
გვერდით|рядом с (+ род.)|beside (+ gen.)|2
შიგნით|внутри (+ род.)|inside (+ gen.)|3
გარეთ|снаружи (+ род.)|outside (+ gen.)|2
მახლობლად|вблизи (+ род.)|near (+ gen.)|3
ახლოს|близко (+ род.)|close to (+ gen.)|2
მიხედვით|по, согласно (+ род.)|according to, by (+ gen.)|2
მსგავსად|подобно (+ род.)|like, similarly to (+ gen.)|3
მიღმა|за, по ту сторону (+ род.)|beyond (+ gen.)|3
`;
const CJ = `
და|и|and|1
მაგრამ|но|but|1
თუ|если; или (в вопросе)|if; or (in questions)|1
ან|или|or|1
ანუ|то есть|that is, or|2
არც|и не, ни|nor, not even|1
რომ|что; чтобы; если бы; который (разг.)|that; so that; if|1
როცა|когда (союз)|when (conjunction)|1
როდესაც|когда (книжн.)|when (bookish)|2
სანამ|пока, прежде чем|until, before|1
მას შემდეგ რაც|после того как|after (conj.)|2
რადგან|так как|since, because|1
რადგანაც|так как|since, because|2
რის გამოც|из-за чего|because of which|3
იმიტომ|потому|that is why|1
იმიტომ რომ|потому что|because|1
ამიტომ|поэтому|therefore|1
თითქოს|будто|as if|2
თუმცა|хотя|although|1
მიუხედავად იმისა|несмотря на то|despite (that)|3
ხოლო|а, же|whereas, and|2
არამედ|а (после отрицания)|but rather|2
ვიდრე|чем; пока|than; until|2
ვინაიდან|поскольку|inasmuch as|3
როგორც|как (сравнение)|as, like|1
სადაც|где (относ.)|where (relative)|1
საიდანაც|откуда (относ.)|from where (relative)|3
როგორც კი|как только|as soon as|2
ისე|так|so|1
`;
const PT = `
არ|не|not|1
ვერ|не (не может)|not (cannot)|1
ნუ|не (запрет)|don't (prohibition)|1
არა|нет|no|1
კი|да; же, -то|yes; even, though|1
დიახ|да (вежливо)|yes (polite)|1
ჰო|да (разг.)|yeah|1
აბა|ну, а ну|well, come on|2
ხომ|ведь, не так ли|isn't it, surely|1
განა|разве|really? (doubt)|2
ნეტავ|хоть бы, интересно|I wish; I wonder|2
თითქმის|почти|almost|2
მხოლოდ|только|only|1
მარტო|только; один|only; alone|2
კიდევ|ещё|again, more, still|1
უკვე|уже|already|1
ჯერ|сначала; ещё (не)|first; yet|1
ჯერ კიდევ|всё ещё|still|2
ალბათ|наверное|probably|1
იქნებ|может быть|maybe|1
თურმე|оказывается|apparently, it turns out|2
ნამდვილად|действительно|really|2
სწორედ|именно|exactly, precisely|2
თვით|сам, даже|self, even|3
-ო|частица чужой речи («мол»)|quotative particle (he says)|1
-მეთქი|частица своей речи («говорю»)|quotative of my own words|2
-თქო|частица передаваемых слов («передай, что…»)|quotative of words to pass on|2
-ც|тоже, и|also, too|1
-ღა|только, уже лишь|only, just|3
-ვე|тот же, сразу|the same, right (away)|3
`;
const AV = `
აქ|здесь|here|1
იქ|там|there|1
ეგრე|так (как у тебя)|like that (by you)|3
სად|где|where|1
საით|куда|whither|2
საიდან|откуда|from where|1
როდის|когда (вопрос)|when (question)|1
როგორ|как|how|1
რატომ|почему|why|1
რისთვის|зачем|what for|2
ახლა|сейчас|now|1
მაშინ|тогда|then|1
დღეს|сегодня|today|1
ხვალ|завтра|tomorrow|1
გუშინ|вчера|yesterday|1
ზეგ|послезавтра|the day after tomorrow|2
გუშინწინ|позавчера|the day before yesterday|3
წელს|в этом году|this year|2
შარშან|в прошлом году|last year|3
ამაღამ|сегодня ночью|tonight|2
დილით|утром|in the morning|1
საღამოს|вечером|in the evening|1
ღამით|ночью|at night|2
ადრე|рано; раньше|early; earlier|1
გვიან|поздно|late|1
მალე|скоро|soon|1
ხშირად|часто|often|1
იშვიათად|редко|rarely|2
ყოველთვის|всегда|always|1
არასოდეს|никогда|never|1
ზოგჯერ|иногда|sometimes|1
ხანდახან|иногда|now and then|2
კვლავ|снова|again|3
ისევ|опять, снова|again|1
ერთხელ|однажды; один раз|once|1
ბოლოს|наконец, в конце|finally, at last|2
მერე|потом|then, afterwards|1
შემდეგ|затем|next, later|1
თავიდან|сначала, заново|from the start, anew|2
უცებ|вдруг|suddenly|1
მყისვე|тотчас|instantly|3
ნელა|медленно|slowly|1
ჩქარა|быстро|quickly|1
სწრაფად|быстро|fast|1
კარგად|хорошо|well|1
ცუდად|плохо|badly|1
ძალიან|очень|very|1
ძლიერ|сильно|strongly, very|2
საკმაოდ|достаточно|quite, enough|2
ცოტათი|немного|a little|2
ბევრად|намного|much (more)|3
ერთად|вместе|together|1
მარტოდ|в одиночку|alone|3
ცალკე|отдельно|separately|2
ზემოთ|вверху, наверх|up, above|2
ქვემოთ|внизу, вниз|down, below|2
შიგ|внутри|inside|3
გარეთ|снаружи, на улице|outside|1
შინ|дома, домой|at home, home|1
შორს|далеко|far|1
ახლოს|близко|near|1
წინ|вперёд, впереди|forward, ahead|1
უკან|назад|back|1
მარჯვნივ|направо|to the right|1
მარცხნივ|налево|to the left|1
პირდაპირ|прямо|straight on|1
ყველგან|везде|everywhere|1
არსად|нигде|nowhere|2
სადღაც|где-то|somewhere|2
ასე|так|so, like this|1
ისე|так (как то)|so, like that|1
როგორღაც|как-то|somehow|3
რა თქმა უნდა|конечно|of course|1
მართლა|правда, действительно|really|1
ზუსტად|точно|exactly|2
უბრალოდ|просто|simply|2
დიდხანს|долго|for a long time|1
ცოტა ხანს|недолго|for a while|2
სამუდამოდ|навсегда|forever|3
ჯერჯერობით|пока что|for the time being|3
სულ|всё время; совсем|all the time; quite|1
საერთოდ|вообще|in general, at all|2
მით უმეტეს|тем более|all the more|3
ქართულად|по-грузински|in Georgian|1
რუსულად|по-русски|in Russian|1
ინგლისურად|по-английски|in English|1
გემრიელად|вкусно; приятного аппетита|tastily; bon appétit|2
სიამოვნებით|с удовольствием|with pleasure|1
ნამდვილად|действительно|indeed|2
`;
const IJ = `
გამარჯობა|здравствуйте|hello|1
გაგიმარჯოს|здравствуй (ответ)|hello (reply)|1
ნახვამდის|до свидания|goodbye|1
მადლობა|спасибо|thank you|1
ბოდიში|извините|sorry|1
ინებეთ|пожалуйста (возьмите)|here you are|2
გთხოვთ|пожалуйста (прошу вас)|please|1
გენაცვალე|дорогой (ласк.)|dear|2
ვაიმე|ой, увы|oh no, alas|2
ვაი|увы|alas|3
ოჰ|ох|oh|3
ეჰ|эх|eh|3
უი|ой|oops|3
კარგი|ладно, хорошо|OK|1
აბა რა|а как же|of course|3
`;

// --- verbs (headword = masdar). io: the second argument is an indirect object (dative in every series) -------------
const V1 = `
# class I: transitive
წერა|писать|write|1|c:1;p:წერს;pv:და;pt:დაწერილი,დასაწერი,მწერალი,დაუწერელი
ჩაწერა|записать|write down, record|2|c:1;p:წერს;pv:ჩა;pt:ჩაწერილი
გადაწერა|переписать|copy, rewrite|3|c:1;p:წერს;pv:გადა;pt:გადაწერილი
კეთება|делать|do, make|1|c:1;p:აკეთებს;pv:გა;pt:გაკეთებული,გასაკეთებელი
შეკეთება|чинить|repair|3|c:1;p:აკეთებს;pv:შე;pt:შეკეთებული
ხატვა|рисовать|draw, paint|1|c:1;p:ხატავს;pv:და;pt:დახატული,მხატვარი
შენება|строить|build|2|c:1;p:აშენებს;pv:ა;pt:აშენებული,მშენებელი
ზრდა|растить, воспитывать|raise, bring up|2|c:1;p:ზრდის;pv:გა;a:გა-ზარდა;pf:გა-უზრდია;pp:გა-ეზარდა;pt:გაზრდილი
გახსნა|открыть; развязать|open; untie|1|c:1;p:ხსნის;pv:გა;pt:გახსნილი
ახსნა|объяснить|explain|2|c:1;p:ხსნის;pv:ა;pt:ახსნილი
მომზადება|готовить|prepare, cook|1|c:1;p:ამზადებს;pv:მო;pt:მომზადებული
ჭამა|есть, кушать|eat|1|c:1;p:ჭამს;pv:შე;pt:შეჭამული,საჭმელი
დალაგება|убирать, раскладывать|tidy, arrange|2|c:1;p:ალაგებს;pv:და;pt:დალაგებული
თესვა|сеять|sow|3|c:1;p:თესავს;pv:და;pt:დათესილი
რეცხვა|мыть, стирать|wash|2|c:1;p:რეცხავს;pv:გა;pt:გარეცხილი
თვლა|считать|count|2|c:1;p:თვლის;pv:და;a:და-თვალა;pf:და-უთვლია;pp:და-ეთვალა
ქსოვა|вязать, ткать|knit, weave|3|c:1;p:ქსოვს;pv:მო;pt:მოქსოვილი
კითხვა|читать|read|1|c:1;p:კითხულობს;f:წა-იკითხავს;a:წა-იკითხა;pf:წა-უკითხავს;pp:წა-ეკითხა;pt:წაკითხული,წასაკითხი,მკითხველი
კითხვა|спрашивать (кого-то)|ask (someone)|1|c:1;io;p:ეკითხება;f:ჰკითხავს;a:ჰკითხა;pf:უკითხავს;pp:ეკითხა;m3
სწავლა|учить, изучать|learn, study|1|c:1;p:სწავლობს;f:ისწავლის;a:ისწავლა;pf:უსწავლია;pp:ესწავლა;pt:ნასწავლი,სასწავლი
სწავლება|учить (кого-то), преподавать|teach|2|c:1;p:ასწავლის;f:ასწავლის;a:ასწავლა;pf:უსწავლებია;pp:ესწავლებინა;pt:მასწავლებელი
ნახვა|видеть, увидеть|see|1|c:1;p:ხედავს;f:ნახავს;a:ნახა;pf:უნახავს;pp:ენახა;pt:ნანახი
დანახვა|заметить, увидеть|catch sight of|2|c:1;p:ხედავს;f:და-ინახავს;a:და-ინახა;pf:და-უნახავს;pp:და-ენახა
მოსმენა|слушать|listen to|1|c:1;io;p:უსმენს;f:მო-უსმენს;a:მო-უსმინა;pf:მო-უსმენია;pp:მო-ესმინა
თქმა|сказать, говорить|say|1|c:1;p:ამბობს;f:იტყვის;fi:იტყოდა;a:თქვა;a1:ვთქვი;at:i;pf:უთქვამს;pp:ეთქვა;pt:ნათქვამი,სათქმელი
თქმა|сказать (кому-то)|tell (someone)|1|c:1;io;p:ეუბნება;f:ეტყვის;fi:ეტყოდა;a:უთხრა;a1:ვუთხარი;at:i;pf:უთქვამს;pp:ეთქვა
მიცემა|давать|give|1|c:1;p:აძლევს;f:მი-სცემს;pvo:მო;a:მი-სცა;a1:მი-ვეცი;at:i;o:მი-სცეს;pf:მი-უცია;pp:მი-ეცა;m3;pt:მიცემული
სმა|пить|drink|1|c:1;p:სვამს;f:და-ლევს;a:და-ლია;pf:და-ულევია;pp:და-ელია;pt:დალეული,სასმელი
ყიდვა|покупать|buy|1|c:1;p:ყიდულობს;f:იყიდის;a:იყიდა;pf:უყიდია;pp:ეყიდა;pt:ნაყიდი
გაყიდვა|продавать|sell|1|c:1;p:ყიდის;pv:გა;pt:გაყიდული,გამყიდველი
ძებნა|искать|look for|1|c:1;p:ეძებს;f:მო-ძებნის;a:მო-ძებნა;pf:მო-უძებნია;pp:მო-ეძებნა
პოვნა|находить|find|1|c:1;p:პოულობს;f:იპოვის;a:იპოვა;pf:უპოვია;pp:ეპოვა;pt:ნაპოვნი
კარგვა|терять|lose|2|c:1;p:კარგავს;pv:და;pt:დაკარგული
მოტანა|принести (вещь)|bring (a thing)|1|c:1;f:მო-იტანს;a:მო-იტანა;pf:მო-უტანია;pp:მო-ეტანა;pt:მოტანილი
წაღება|унести (вещь)|take away (a thing)|2|c:1;f:წა-იღებს;a:წა-იღო;a1:წა-ვიღე;pf:წა-უღია;pp:წა-ეღო;pt:წაღებული
მოყვანა|привести (кого-то)|bring (someone)|2|c:1;f:მო-იყვანს;a:მო-იყვანა;pf:მო-უყვანია;pp:მო-ეყვანა
წაყვანა|увести, отвезти (кого-то)|take (someone) away|2|c:1;f:წა-იყვანს;a:წა-იყვანა;pf:წა-უყვანია;pp:წა-ეყვანა
აღება|брать|take, pick up|1|c:1;p:იღებს;pv:ა;a:ა-იღო;pf:ა-უღია;pp:ა-ეღო;pt:აღებული
მიღება|получать, принимать|receive, accept|1|c:1;p:იღებს;pv:მი;a:მი-იღო;pf:მი-უღია;pp:მი-ეღო;pt:მიღებული
დადება|класть|put, lay|1|c:1;p:დებს;pv:და;a:და-დო;pf:და-უდია;pp:და-ედო;pt:დადებული
დაწყება|начинать|begin, start|1|c:1;p:იწყებს;pv:და;a:და-იწყო;pf:და-უწყია;pp:და-ეწყო;pt:დაწყებული
დამთავრება|заканчивать|finish|1|c:1;p:ამთავრებს;pv:და;pt:დამთავრებული
გაგება|понимать, узнавать|understand, learn (news)|1|c:1;p:იგებს;pv:გა;a:გა-იგო;pf:გა-უგია;pp:გა-ეგო;pt:გაგებული
ცოდნა|знать|know|1|c:1;p:იცის;i:იცოდა;d:0
დარეკვა|позвонить|ring, call (phone)|1|c:1;io;p:რეკავს;pv:და
დახურვა|закрывать|close|1|c:1;p:ხურავს;pv:და;pt:დახურული
მოკვლა|убивать|kill|2|c:1;p:კლავს;pv:მო;a:მო-კლა;a1:მო-ვკალი;at:i;pt:მოკლული
ჭრა|резать|cut|2|c:1;p:ჭრის;pv:გა;a:გა-ჭრა;a1:გა-ვჭერი;at:i;pt:გაჭრილი
დაჭრა|ранить|wound|3|c:1;p:ჭრის;pv:და;a:და-ჭრა;a1:და-ვჭერი;at:i;pt:დაჭრილი
დაგდება|бросить|throw down, drop|3|c:1;p:აგდებს;pv:და;a:და-აგდო;pf:და-უგდია;pp:და-ეგდო
დაბანა|мыть (руки, лицо)|wash (hands, face)|2|c:1;p:ბანს;pv:და;a:და-ბანა;pf:და-უბანია;pp:და-ებანა
ჩაცმა|одевать(ся)|dress, put on|2|c:1;p:იცვამს;pv:ჩა;a:ჩა-იცვა;a1:ჩა-ვიცვი;at:i;pf:ჩა-უცვამს;pp:ჩა-ეცვა;pt:ჩაცმული
გახდა|снимать (одежду)|take off (clothes)|3|c:1;p:იხდის;pv:გა;a:გა-იხადა;d:0
გაგზავნა|отправить|send|1|c:1;p:გზავნის;pv:გა;pt:გაგზავნილი
გადაწყვეტა|решить|decide|1|c:1;p:წყვეტს;pv:გადა;a:გადა-წყვიტა;pf:გადა-უწყვეტია;pp:გადა-ეწყვიტა;pt:გადაწყვეტილი
ხარშვა|варить|boil, cook|2|c:1;p:ხარშავს;pv:მო;pt:მოხარშული
გამოცხობა|испечь|bake|3|c:1;p:აცხობს;pv:გამო;a:გამო-აცხო;d:0;?
ჩუქება|дарить|give as a present|2|c:1;io;f:ა-ჩუქებს;a:ა-ჩუქა;d:0
ჩვენება|показывать|show|1|c:1;io;p:აჩვენებს;f:აჩვენებს;a:აჩვენა;pf:უჩვენებია;pp:ეჩვენებინა
თხოვნა|просить|ask (for), request|1|c:1;io;p:სთხოვს;f:სთხოვს;a:სთხოვა;pf:უთხოვია;pp:ეთხოვა;m3
კოცნა|целовать|kiss|2|c:1;io;p:კოცნის;f:აკოცებს;a:აკოცა;pf:უკოცნია;d:0
ხმარება|употреблять|use|3|c:1;p:ხმარობს;f:იხმარს;a:იხმარა;pf:უხმარია;d:0
გამოყენება|использовать|use, make use of|1|c:1;p:იყენებს;pv:გამო;pt:გამოყენებული
დამალვა|прятать|hide|2|c:1;p:მალავს;pv:და;pt:დამალული
გაღება|открыть (дверь)|open (a door)|1|c:1;p:აღებს;pv:გა;a:გა-აღო;pf:გა-უღია;pp:გა-ეღო;pt:გაღებული
ანთება|зажечь|light|2|c:1;p:ანთებს;pv:ა;a:ა-ანთო;pf:ა-უნთია;pp:ა-ენთო;pt:ანთებული
ჩაქრობა|гасить|put out|3|c:1;p:აქრობს;pv:ჩა;a:ჩა-აქრო;pf:ჩა-უქრია;pp:ჩა-ექრო
ტარება|носить, проводить|carry, wear|2|c:1;p:ატარებს;f:ატარებს;a:ატარა;pf:უტარებია;d:0
გატარება|провести (время)|spend (time)|2|c:1;p:ატარებს;pv:გა;pt:გატარებული
გაგრძელება|продолжать|continue|1|c:1;p:აგრძელებს;pv:გა
გაჩერება|остановить|stop (something)|1|c:1;p:აჩერებს;pv:გა
ცვლა|менять|change|2|c:1;p:ცვლის;pv:შე;a:შე-ცვალა;pf:შე-უცვლია;pp:შე-ეცვალა;pt:შეცვლილი
დალოცვა|благословить|bless|3|c:1;p:ლოცავს;pv:და;pt:დალოცვილი
ქება|хвалить|praise|2|c:1;p:აქებს;pv:შე;a:შე-აქო;pf:შე-უქია;pp:შე-ექო
ლანძღვა|ругать|scold|3|c:1;p:ლანძღავს;pv:გა
გაღვიძება|будить|wake (someone)|2|c:1;p:აღვიძებს;pv:გა
ყინვა|замораживать|freeze|3|c:1;p:ყინავს;pv:გა;pt:გაყინული
დატოვება|оставить|leave (behind)|1|c:1;p:ტოვებს;pv:და;pt:დატოვებული
მოპარვა|украсть|steal|2|c:1;p:იპარავს;pv:მო;pt:მოპარული
გაფრთხილება|предупредить|warn|3|c:1;p:აფრთხილებს;pv:გა
გაბედვა|осмелиться|dare|3|c:1;p:ბედავს;pv:გა
გატეხა|сломать|break|2|c:1;p:ტეხს;pv:გა;a:გა-ტეხა;pf:გა-უტეხია;pp:გა-ეტეხა;pt:გატეხილი
დანგრევა|разрушить|destroy|2|c:1;p:ანგრევს;pv:და;a:და-ანგრია;pf:და-უნგრევია;pp:და-ენგრია;pt:დანგრეული
შეგროვება|собирать|collect, gather|2|c:1;p:აგროვებს;pv:შე;pt:შეგროვებული
გაზომვა|измерить|measure|3|c:1;p:ზომავს;pv:გა
აწონვა|взвесить|weigh|3|c:1;p:წონის;pv:ა
დაჭერა|поймать|catch|2|c:1;p:იჭერს;pv:და;a:და-იჭირა;pf:და-უჭერია;pp:და-ეჭირა;pt:დაჭერილი
გაშვება|отпустить|let go, release|2|c:1;p:უშვებს;pv:გა;a:გა-უშვა;a1:გა-ვუშვი;at:i;pf:გა-უშვია;pp:გა-ეშვა
ჩაკეტვა|запереть|lock|3|c:1;p:კეტავს;pv:ჩა;pt:ჩაკეტილი
დაბეჭდვა|напечатать|print|3|c:1;p:ბეჭდავს;pv:და;pt:დაბეჭდილი
გაწმენდა|очистить|clean|2|c:1;p:წმენდს;pv:გა;a:გა-წმინდა;pf:გა-უწმენდია;pp:გა-ეწმინდა;pt:გაწმენდილი
დარგვა|сажать (растение)|plant|3|c:1;p:რგავს;pv:და;a:და-რგო;pf:და-ურგავს;pp:და-ერგო
მორწყვა|поливать|water|3|c:1;p:რწყავს;pv:მო;a:მო-რწყო;pf:მო-ურწყავს;pp:მო-ერწყო
დაწვა|жечь|burn|2|c:1;p:წვავს;pv:და;a:და-წვა;a1:და-ვწვი;at:i;pf:და-უწვავს;pp:და-ეწვა;pt:დამწვარი
გაზიარება|разделить (с кем-то)|share|3|c:1;io;p:უზიარებს;pv:გა;a:გა-უზიარა;pf:გა-უზიარებია;pp:გა-ეზიარებინა
დაპატიჟება|пригласить|invite|2|c:1;p:პატიჟებს;pv:და
მოწვევა|пригласить (офиц.)|invite (formally)|3|c:1;p:იწვევს;pv:მო;a:მო-იწვია;pf:მო-უწვევია;pp:მო-ეწვია;pt:მოწვეული
გამოცდა|испытать|test, try out|3|c:1;m3;p:ცდის;pv:გამო;a:გამო-სცადა;pf:გამო-უცდია;pp:გამო-ეცადა;pt:გამოცდილი
გახსენება|вспомнить|recall|2|c:1;p:იხსენებს;pv:გა
დავიწყება|забыть|forget|1|c:1;p:ივიწყებს;pv:და;a:და-ივიწყა;dp:0;pt:დავიწყებული
გაცნობა|познакомить|introduce|3|c:1;p:აცნობს;pv:გა;a:გა-აცნო;d:0
დაძახება|позвать|call (to)|2|c:1;io;p:უძახის;f:და-უძახებს;a:და-უძახა;pf:და-უძახია;d:0
დაინტერესება|заинтересовать|interest|2|c:1;p:აინტერესებს;pv:და;dp:0
დაპატიება|простить|forgive|2|c:1;io;p:პატიობს;f:აპატიებს;a:აპატია;pf:უპატიებია;d:0
შექმნა|создать|create|2|c:1;p:ქმნის;pv:შე;a:შე-ქმნა;pf:შე-უქმნია;pp:შე-ექმნა;pt:შექმნილი
მოგება|выиграть|win|2|c:1;p:იგებს;pv:მო;a:მო-იგო;pf:მო-უგია;pp:მო-ეგო
წაგება|проиграть|lose (a game)|2|c:1;p:აგებს;pv:წა;a:წა-აგო;pf:წა-უგია;pp:წა-ეგო
ჩამოტანა|привезти|bring (down, from afar)|3|c:1;f:ჩამო-იტანს;a:ჩამო-იტანა;pf:ჩამო-უტანია;pp:ჩამო-ეტანა
გადაცემა|передать|pass on, hand over|2|c:1;f:გადა-სცემს;a:გადა-სცა;a1:გადა-ვეცი;at:i;o:გადა-სცეს;pf:გადა-უცია;pp:გადა-ეცა;m3;d:0
`;

const V2 = `
# class II: intransitive (subject in the nominative in every series); suppletive tables live in kartuli-grammar.js
ყოფნა|быть, находиться|be|1|c:2
მისვლა|идти, прийти (туда)|go (there)|1|c:2
მოსვლა|идти, прийти (сюда)|come|1|c:2
წასვლა|уйти, уехать|leave, go away|1|c:2
შესვლა|войти|go in|1|c:2
გასვლა|выйти|go out|1|c:2
ასვლა|подняться|go up|2|c:2
ჩასვლა|спуститься, приехать (вниз)|go down, arrive|2|c:2
გადასვლა|перейти|go across|2|c:2
შემოსვლა|войти (сюда)|come in|1|c:2
გამოსვლა|выйти (сюда); выступить|come out; speak in public|2|c:2
ამოსვლა|подняться (сюда); взойти|come up; rise (sun)|2|c:2
ჩამოსვლა|спуститься (сюда), приехать|come down; arrive|2|c:2
გადმოსვლა|перейти (сюда)|come across|3|c:2
სიარული|ходить|walk, go about|1|c:3
დგომა|стоять|stand|1|c:2
ჯდომა|сидеть|sit|1|c:2
დაჯდომა|сесть|sit down|1|c:2
წოლა|лежать|lie|2|c:2
ადგომა|встать|get up|1|c:2;p:დგება;f:ა-დგება;a:ა-დგა;a1:ა-ვდექი;at:ii
დაწოლა|лечь|lie down|2|c:2;p:წვება;f:და-წვება;a:და-წვა;a1:და-ვწექი;at:ii
დაბრუნება|вернуться|return|1|c:2;p:ბრუნდება;pv:და
გათბობა|согреться|get warm|3|c:2;p:თბება;pv:გა
სიკვდილი|умирать|die|2|c:2;p:კვდება;pv:მო
დაბადება|родиться|be born|1|c:2;p:იბადება;pv:და
გახდომა|стать|become|1|c:2;p:ხდება;pv:გა
მოხდენა|случиться|happen|1|c:2;p:ხდება;pv:მო
დავარდნა|упасть|fall|2|c:2;p:ვარდება;pv:და
გაჩენა|появиться|appear, come into being|2|c:2;p:ჩნდება;pv:გა
გაქცევა|убежать|run away|2|c:2;p:გა-რბის;i:გა-რბოდა;f:გა-იქცევა;a:გა-იქცა;a1:გა-ვიქეცი;at:ii
ლოდინი|ждать|wait (for)|1|c:2;io;p:ელოდება;pv:და;at:ie
დახმარება|помогать|help|1|c:2;io;p:ეხმარება;pv:და;at:ie
შეხვედრა|встретить(ся)|meet|1|c:2;io;p:ხვდება;pv:შე
დარჩენა|остаться|stay, remain|1|c:2;p:რჩება;pv:და
დაღლა|устать|get tired|2|c:2;p:იღლება;pv:და;a:და-იღალა;at:ie
გაბრაზება|рассердиться|get angry|2|c:2;p:ბრაზდება;pv:გა
გაჩერება|остановиться|stop (oneself)|1|c:2;p:ჩერდება;pv:გა
გაჩუმება|замолчать|fall silent|2|c:2;p:ჩუმდება;pv:გა
დამშვიდება|успокоиться|calm down|2|c:2;p:მშვიდდება;pv:და
გაწითლება|покраснеть|blush, turn red|3|c:2;p:წითლდება;pv:გა
დნობა|таять|melt|3|c:2;p:დნება;pv:გა
შეცვლა|измениться|change (oneself)|2|c:2;p:იცვლება;pv:შე;a:შე-იცვალა;at:ie
გაზრდა|вырасти|grow up|1|c:2;p:იზრდება;pv:გა;a:გა-იზარდა;at:ie
დაწყება|начаться|begin (intr.)|2|c:2;p:იწყება;pv:და;a:და-იწყო;a1:და-ვიწყე;at:ie
დამთავრება|закончиться|end (intr.)|2|c:2;p:მთავრდება;pv:და
# class III: medial (ergative subject in series II, dative in series III)
ფიქრი|думать|think|1|c:3;p:ფიქრობს
თამაში|играть|play|1|c:3;p:თამაშობს
მუშაობა|работать|work|1|c:3;p:მუშაობს;f:იმუშავებს;a:იმუშავა;pf:უმუშავია;pp:ემუშავა
ლაპარაკი|говорить, разговаривать|speak, talk|1|c:3;p:ლაპარაკობს
საუბარი|беседовать|converse|2|c:3;p:საუბრობს
ცეკვა|танцевать|dance|1|c:3;p:ცეკვავს
მღერა|петь|sing|1|c:3;p:მღერის;i:მღეროდა
ტირილი|плакать|cry|1|c:3;p:ტირის;i:ტიროდა
ყვირილი|кричать|shout|2|c:3;p:ყვირის;i:ყვიროდა
სიცილი|смеяться|laugh|1|c:3;p:იცინის;i:იცინოდა;f:გა-იცინებს;a:გა-იცინა;pf:გა-უცინია;pp:გა-ეცინა
ცხოვრება|жить|live|1|c:3;p:ცხოვრობს
ცურვა|плавать|swim|2|c:3;p:ცურავს;f:იცურავებს;a:იცურავა;pf:უცურავია;?
ფრენა|летать|fly|2|c:3;p:და-ფრინავს;f:იფრენს;a:იფრინა;pf:უფრენია;pp:ეფრინა
ზრუნვა|заботиться|care (for)|2|c:3;p:ზრუნავს
ოცნება|мечтать|dream|2|c:3;p:ოცნებობს
ვარჯიში|тренироваться|exercise, train|3|c:3;p:ვარჯიშობს
მოგზაურობა|путешествовать|travel|2|c:3;p:მოგზაურობს
ხუმრობა|шутить|joke|2|c:3;p:ხუმრობს
კამათი|спорить|argue|3|c:3;p:კამათობს
ჩხუბი|ссориться, драться|quarrel, fight|3|c:3;p:ჩხუბობს
ლოცვა|молиться|pray|2|c:3;p:ლოცულობს;f:ილოცავს;a:ილოცა;pf:ულოცია;pp:ელოცა
მეცადინეობა|заниматься (учёбой)|study, do lessons|3|c:3;p:მეცადინეობს;f:იმეცადინებს;a:იმეცადინა;pf:უმეცადინია;pp:ემეცადინა
ვარაუდი|предполагать|assume|3|c:3;p:ვარაუდობს
დაძინება|заснуть|fall asleep|2|c:3;p:იძინებს;pv:და;a:და-იძინა;pf:და-უძინია;pp:და-ეძინა
გაღვიძება|проснуться|wake up|2|c:3;p:იღვიძებს;pv:გა;a:გა-იღვიძა;pf:გა-უღვიძია;pp:გა-ეღვიძა
ყურება|смотреть|watch, look at|1|c:3;io;p:უყურებს;f:უყურებს;a:უყურა;pf:უყურებია;pp:ეყურებინა
პასუხი|отвечать|answer|1|c:3;io;p:პასუხობს;f:უპასუხებს;a:უპასუხა;pf:უპასუხია;pp:ეპასუხა
# class IV: indirect (the experiencer in the dative, the verb agrees with it through the object prefixes)
სიყვარული|любить|love|1|c:4;p:უყვარს;i:უყვარდა;f:ეყვარება;a:შე-უყვარდა
ნდომა|хотеть|want|1|c:4;p:უნდა;i:უნდოდა;f:მო-უნდება;a:მო-უნდა
ქონა|иметь (вещь)|have (a thing)|1|c:4;p:აქვს;i:ჰქონდა;f:ექნება;a:ჰქონდა;o:ჰქონდეს;pf:ჰქონია;pp:ჰქონოდა
ყოლა|иметь (живое)|have (a person, an animal)|1|c:4;p:ჰყავს;i:ჰყავდა;f:ეყოლება;a:ჰყავდა;o:ჰყავდეს;pf:ჰყოლია;pp:ჰყოლოდა
მოწონება|нравиться|like|1|c:4;p:მო-სწონს;i:მო-სწონდა;f:მო-ეწონება;a:მო-ეწონა
შიში|бояться|be afraid|1|c:4;p:ეშინია;i:ეშინოდა;f:შე-ეშინდება;a:შე-ეშინდა
გონება|думать, полагать|think, believe|1|c:4;p:ჰგონია;i:ეგონა;f:ეგონება
შეძლება|мочь|be able, can|1|c:4;p:შე-უძლია;i:შე-ეძლო;f:შე-ეძლება;a:შე-ეძლო
სმენა|слышать|hear|2|c:4;p:ესმის;i:ესმოდა
ხსოვნა|помнить|remember|1|c:4;p:ახსოვს;i:ახსოვდა;f:ემახსოვრება
დავიწყება|забываться|slip one's mind|2|c:4;p:ავიწყდება;i:ავიწყდებოდა;f:და-ავიწყდება;a:და-ავიწყდა
შიმშილი|быть голодным|be hungry|2|c:4;p:შია;i:შიოდა;f:მო-შივდება;a:მო-შივდა
წყურვილი|хотеть пить|be thirsty|2|c:4;p:სწყურია;i:სწყუროდა;f:მო-სწყურდება;a:მო-სწყურდა
ტკივილი|болеть (о части тела)|hurt|2|c:4;p:სტკივა;i:სტკიოდა;f:ეტკინება;a:ეტკინა
ძილი|спать|sleep|1|c:4;p:სძინავს;i:ეძინა;f:ეძინება
გაკვირვება|удивляться|be surprised|2|c:4;p:უკვირს;i:უკვირდა;f:გა-უკვირდება;a:გა-უკვირდა
სიხარული|радоваться|be glad|2|c:4;p:უხარია;i:უხაროდა;f:გა-უხარდება;a:გა-უხარდა
წყენა|обижаться|be upset|3|c:4;p:სწყინს;i:სწყინდა;f:ეწყინება;a:ეწყინა
ზარება|лениться|be too lazy to|3|c:4;p:ეზარება;i:ეზარებოდა;f:და-ეზარება;a:და-ეზარა
სიცივე|мёрзнуть|be cold|2|c:4;p:სცივა;i:სციოდა;f:შე-სცივდება;a:შე-სცივდა
მოჩვენება|казаться|seem|2|c:4;p:ეჩვენება;i:ეჩვენებოდა;f:მო-ეჩვენება;a:მო-ეჩვენა
დარქმევა|называться|be called|1|c:4;p:ჰქვია;i:ერქვა
დაჯერება|верить|believe|2|c:4;p:სჯერა;i:სჯეროდა;f:და-ეჯერება
`;

// --- more nouns, adjectives and adverbs --------------------------------------------------------------------------
const N5 = `
ბუნების დაცვა|охрана природы|nature conservation|3
მეურნეობა|хозяйство|farm, economy|3
ეკონომიკა|экономика|economy|2
პოლიტიკა|политика|politics|2
მეცნიერება|наука|science|2
ფიზიკა|физика|physics|3
მათემატიკა|математика|mathematics|2
ქიმია|химия|chemistry|3
ბიოლოგია|биология|biology|3
გეოგრაფია|география|geography|3
ფილოსოფია|философия|philosophy|3
მედიცინა|медицина|medicine (science)|3
ტექნიკა|техника|technology|3
ინჟინერი|инженер|engineer|3|h
მზარეული|повар|cook|2|h
მეპური|пекарь|baker|3|h
მებაღე|садовник|gardener|3|h
მეღვინე|винодел|winemaker|3|h
მჭედელი|кузнец|blacksmith|3|h;s
ხურო|плотник|carpenter|3|h
მკერავი|портной|tailor|3|h
ფეხბურთელი|футболист|footballer|3|h
მოთამაშე|игрок|player|2|h
მოგზაური|путешественник|traveller|2|h
მკვლევარი|исследователь|researcher|3|h;s
ჟურნალისტი|журналист|journalist|3|h
იურისტი|юрист|lawyer|3|h
მოსამართლე|судья|judge|3|h
ქურდი|вор|thief|2|h
მეგზური|проводник, гид|guide|3|h
ტურისტი|турист|tourist|2|h
მოქალაქე|гражданин|citizen|3|h
ბინადარი|житель|inhabitant|3|h;s
სოფლელი|сельский житель|villager|3|h
ქალაქელი|горожанин|townsman|3|h
მოყვარე|любитель|lover (of something), amateur|3|h
დამწყები|начинающий|beginner|3|h
შეყვარებული|влюблённый; возлюбленный|sweetheart|2|h
ნათლია|крёстный|godparent|3|h
მაზლი|деверь|brother-in-law|3|h
სიძე|зять|son-in-law|3|h
რძალი|невестка|daughter-in-law|3|h;s
დედამთილი|свекровь|mother-in-law|3|h
ბავშვთა ბაღი|детский сад|kindergarten|3
სათვალე|очки|glasses|3
საფულე|кошелёк|wallet|3
ქოლგა|зонт|umbrella|3
ბეჭედი|кольцо|ring|3|s
ყელსაბამი|ожерелье|necklace|3
საყურე|серьга|earring|3
ფარდა|занавеска|curtain|3
ტორტი|торт|cake|3
ნაყინი|мороженое|ice cream|2
შოკოლადი|шоколад|chocolate|3
ფაფა|каша|porridge|3
ხაჭო|творог|cottage cheese|3
ძეხვი|колбаса|sausage|3
ქაბაბი|кебаб|kebab|3
ბადრიჯანი|баклажан|aubergine|3
სტაფილო|морковь|carrot|3
კომბოსტო|капуста|cabbage|3
ჭარხალი|свёкла|beetroot|3|s
მწვანილი|зелень|herbs, greens|3
ქინძი|кинза|coriander|3
ტყემალი|ткемали|tkemali (plum sauce)|3|s
საწებელი|соус|sauce|3|s
ბროწეული|гранат|pomegranate|3
ლეღვი|инжир|fig|3
ხურმა|хурма|persimmon|3
მარწყვი|клубника|strawberry|3
ჟოლო|малина|raspberry|3
ქლიავი|слива|plum|3
კაკალი|орех|nut|3|s
სოკო|гриб|mushroom|3
მუხა|дуб|oak|3
ფიჭვი|сосна|pine|3
ნაძვი|ель|fir|3
ვაზი|виноградная лоза|vine|2
ტირიფი|ива|willow|3
ჭადარი|платан|plane tree|3|s
ალვა|тополь|poplar|3
ბამბა|хлопок|cotton|3
მატყლი|шерсть|wool|3
აბრეშუმი|шёлк|silk|3
ქსოვილი|ткань|fabric|3
ფიცარი|доска|plank|3|s
მინა|стекло|glass (material)|3
პლასტმასი|пластмасса|plastic|3
ქვანახშირი|каменный уголь|coal|3
ნავთობი|нефть|oil (petroleum)|3
გაზი|газ|gas|3
ელექტროენერგია|электроэнергия|electricity|3
ენერგია|энергия|energy|3
სითბო|тепло|warmth|2
სინესტე|влажность|humidity|3
გვალვა|засуха|drought|3
წყალდიდობა|наводнение|flood|3
მიწისძვრა|землетрясение|earthquake|3
ზვავი|лавина|avalanche|3
ჭაობი|болото|swamp|3
უდაბნო|пустыня|desert|3
ოკეანე|океан|ocean|3
ყურე|залив|bay|3
მწვერვალი|вершина|summit|3
ფერდობი|склон|slope|3
გამოქვაბული|пещера|cave|3
ვულკანი|вулкан|volcano|3
ქვეყნიერება|мир, свет|the world|3
მზის ამოსვლა|восход|sunrise|3
მზის ჩასვლა|закат|sunset|3
ბინდი|сумерки|dusk|3
განთიადი|рассвет|dawn|3
შუქი|свет|light|2
ვარსკვლავეთი|звёздное небо|starry sky|3
სიამაყე|гордость|pride|3
სიამოვნება|удовольствие|pleasure|2
სიძნელე|трудность|difficulty|3
სისუსტე|слабость|weakness|3
სიჯანსაღე|бодрость|vigour|3
სიახლე|новость, новизна|novelty, news|2
სიცრუე|ложь|falsehood|3
სიჭაბუკე|юность|youth|3
სიზარმაცე|лень|laziness|3
გამბედაობა|смелость|courage|3
მოთმინება|терпение|patience|2
ყურადღება|внимание|attention|2
პასუხისმგებლობა|ответственность|responsibility|3
თანხმობა|согласие|consent|3
უარი|отказ|refusal|2
ეჭვი|сомнение|doubt|2
შეგრძნება|ощущение|sensation|3
შთაბეჭდილება|впечатление|impression|3
მოგონება|воспоминание|memory, recollection|3
`;

const A2 = `
მსუყე|жирный (о еде)|rich, fatty|3
ახალშობილი|новорождённый|newborn|3
უძველესი|древнейший|most ancient|3
ძველისძველი|старинный|ancient|3
ბრწყინვალე|блестящий|brilliant|3
ნაზი|нежный|tender, delicate|2
მკაცრი|строгий|strict|2
ფრთხილი|осторожный|careful|2
ხელმისაწვდომი|доступный|accessible|3
დამოუკიდებელი|независимый|independent|3
სახიფათო|опасный|hazardous|3
გაბრაზებული|рассерженный|angry|2
გახარებული|обрадованный|delighted|3
შეშინებული|испуганный|frightened|3
გაკვირვებული|удивлённый|surprised|3
დაბნეული|растерянный|confused|3
ზრდილი|воспитанный|well-mannered|3
უცხოენოვანი|иноязычный|foreign-language|3
ორენოვანი|двуязычный|bilingual|3
ოქროს|золотой|golden (made of gold)|3
ხის|деревянный|wooden|3
ქვის|каменный|stone (made of stone)|3
რკინის|железный|iron|3
მზიანი|солнечный|sunny|2
წვიმიანი|дождливый|rainy|3
ღრუბლიანი|облачный|cloudy|3
ქარიანი|ветреный|windy|3
თოვლიანი|снежный|snowy|3
მთიანი|гористый|mountainous|3
ტყიანი|лесистый|wooded|3
წყლიანი|водянистый|watery|3
ფულიანი|денежный, богатый|moneyed|3
ნიჭიერი|талантливый|talented|2
გულიანი|сердечный|hearty|3
ცბიერი|хитрый|cunning|3
გულუხვი|щедрый|generous|2
ძუნწი|скупой|stingy|3
სტუმართმოყვარე|гостеприимный|hospitable|2
შრომისმოყვარე|трудолюбивый|hard-working|3
`;

const AV2 = `
ყველაზე|самый (превосходная степень)|most (superlative)|1
უფრო|более|more|1
ზემოდან|сверху|from above|3
ქვემოდან|снизу|from below|3
შიგნიდან|изнутри|from inside|3
გარედან|снаружи|from outside|3
შორიდან|издалека|from afar|3
ახლოდან|вблизи|from close by|3
აქედან|отсюда|from here|2
იქიდან|оттуда|from there|2
აქეთ|сюда|this way|2
იქით|туда|that way|2
დღესვე|сегодня же|this very day|3
ახლავე|сейчас же|right now|2
მაშინვე|тотчас|immediately|2
ნახევრად|наполовину|half|3
სრულად|полностью|fully|3
უეცრად|внезапно|suddenly|3
თანდათან|постепенно|gradually|3
ერთბაშად|сразу|all at once|3
`;

const blocks = () => ({ n: N1 + N2 + N3 + N4 + N5, np: NP, a: A1 + A2, pr: PR, num: NUM, pp: PPW, cj: CJ, pt: PT, av: AV + AV2, i: IJ, v: V1 + V2 });
