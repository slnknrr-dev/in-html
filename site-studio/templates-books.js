// site-studio/templates-books.js - template "books": an independent publisher with a reading club — a shelf
// of its books with Markdown / plain-text excerpts and PDF samples sold through the cart, a rights table, reading
// lists, club subscriptions, events, authors and readers' words (en default, ru, uk; theme preset 'quire').
//
// Contract of a template module: each exported template object carries an id, localized names and build(V, ...) ->
// a fresh document; templates.js adds catalogue metadata (group, mode, modules) where the module does not declare it,
// and studio/gallery.js shows the catalogue.
// The viewer API arrives as the argument V instead of an import, so templates are pure document builders that tests
// (test.js renders every template) and the gallery can run without the editor. Generated artwork and sample data are
// derived from seeds (tplHash / tplRand where used), so a template builds the same document on every run.
// Data file: names, texts, figures and art specs dominate; comments mark sections, not individual values.
import { tplKit } from './templates-kit.js';
import { TPL_ART_SVG, tplIsoScene } from './templates-art.js';
import { tplAgroPortrait } from './templates-agro.js';
import { tplLibCover, tplLibP, tplLibPaint, tplLibT, tplLibText, tplLibUl } from './templates-library.js';
// ===== Template: books — Paper Lantern Press & reading club (en default, ru, uk) =====
// Built only from the generic blocks: books are `collection` items (attributes Author, Genre, Imprint, Language, Year,
// Pages, Format, Rights; files = an excerpt and a PDF sample; price + SKU), plans and tickets are pricing / events
// items with SKUs in the same cart. All people, books, places, phone numbers and e-mails are FICTIONAL; the excerpts
// are original texts written for this template; covers, pictures and PDFs are generated.

/* ----- excerpts (Markdown; verse as plain text) ----- */

const TPL_BOOKS_TEXTS = {
  ferry: `
# Night Ferry to Halvard

*Ingrid Sollie · Paper Lantern Press, 2025*

## 1. The Last Sailing

The ferry to Halvard leaves at 23:40 whether or not anyone is on it. Maren had been told this by three different people in the harbour café, each of them with the satisfaction of someone delivering bad news that is not their own.

She was on it. So were a man with a crate of hens, two students asleep against their rucksacks and a woman in a yellow raincoat who stood at the stern the whole way, watching the town fold itself into the dark until only the lighthouse remained, blinking like something trying to remember a word.

## 2. Arrivals

Halvard had one road, one shop and one telephone box that had been turned into a library. Maren found the key to her aunt’s house where the letter said it would be — under the third stone from the gate, wrapped in a bag that had once held bread.

Inside, the clocks had stopped at different hours. The kettle was full. On the kitchen table lay a ferry timetable for the following year, with one sailing circled in pencil: the 23:40, every Thursday, until the end of March.
`,
  hours: `
# Small Hours

*Jonah Mercer · essays · Paper Lantern Press, 2024*

## On Waking at Four

There is a particular silence at four in the morning that belongs neither to the night nor to the day. The fridge hums a little louder than it does at noon. A car passes two streets away and you hear the whole of its journey, from the corner to the bridge, like a sentence spoken slowly.

I used to fight it. I lay still and counted, recited the capitals of countries I have never visited and made lists. Now I get up, make tea, sit by the window and let the hour be what it is: a small room in the house of the day that only a few people ever enter.

## On Borrowed Books

Every book I have borrowed and not returned has taught me something about guilt and nothing about the book. The ones I gave back, on the other hand, I remember perfectly — the way you remember a city you had to leave.
`,
  roof: `
# Сад на даху

*Ірина Лис · роман · «Паперовий ліхтар», 2025*

## 1. Квітень

Того квітня Соломія вперше піднялася на дах свого будинку — не тому, що хотіла, а тому, що двері на горище хтось залишив відчиненими. Згори місто виглядало інакше: не вулицями, а дахами — бляшаними, черепичними, латаними, з антенами, схожими на висохлі соняшники.

На сусідньому даху стояли відра з землею. Хтось посадив у них помідори, цибулю і, здається, троянду. Між відрами сидів старий у капелюсі й читав газету, притиснувши її цеглиною, щоб не забрав вітер.

## 2. Насіння

— Хочете? — спитав він наступного дня і простягнув через щілину між дахами паперовий конверт. Усередині шаруділо насіння. — Тільки поливайте щоранку. Дах — він як людина: якщо про нього забути, він теж забуває.

Соломія не мала ні відер, ні землі, ні жодного уявлення про помідори. Але конверт поклала до кишені — і цілий день відчувала його, легкий і теплий, як обіцянка.
`,
  north: `
# Комната с окном на север

*Вера Соколова · рассказы · «Бумажный фонарь», 2023*

## Окно на север

В комнате с окном на север никогда не бывает солнца, зато свет в ней ровный, как в мастерской художника. Так говорила хозяйка, сдавая комнату, и Лида поверила — она тогда вообще всему верила.

Зимой на стекле вырастали папоротники инея, и Лида по утрам не стирала их, а рассматривала: каждый день другой лес. К марту она знала его лучше, чем город за окном.

## Телефон

Телефон в коридоре звонил по вторникам, ровно в девять вечера, и каждый раз спрашивали Анну Петровну. Анны Петровны в квартире не было и, судя по всему, никогда не было.

— Может, ей что-нибудь передать? — спросила однажды Лида.

В трубке помолчали. — Передайте, что каштаны на бульваре уже зацвели, — сказал мужской голос. — Она поймёт.
`,
  atlas: `
# The Salt Atlas

*Tomás Arregui · travels · Paper Lantern Press, 2026*

## Salinas

At the salt pans the horizon is not a line but a shimmer. Workers in wide hats rake the crust into white ridges that look, from the road, like the spines of some very patient animal asleep on the coast.

I asked one of them how long he had done this. He thought about it, leaning on his rake. “Since the salt was water,” he said, which I have decided to take literally.

## A Map Without Roads

My grandfather kept a map of the coast on which he had drawn no roads at all — only the places where you could buy good salt, good bread and good conversation. The distances between them were marked in hours of talking rather than in kilometres.

I have tried to make this book in the same spirit: slowly, with long stops, and with the bread always fresh.
`,
  lullaby: `
КОЛИСКОВА ДЛЯ МАЯКА
Оксана Мельник · «Паперовий ліхтар», 2026


Коли всі кораблі вже вдома,
а чайки сплять на воді,
маяк лишається сам-самісінький —
світити, світити, світити.

— Хто ж тобі заспіває колискову? —
питає маленька хвиля.
— Ніхто, — каже маяк. —
Маяки не сплять.

Тоді хвиля кличе вітер,
вітер кличе дощ,
а дощ — кота з рибальського човна.

І всі разом вони співають так тихо,
що маяк навіть не помічає,
як заплющує одне око.

Лише одне.
Друге світить до ранку.
`,
  tides: `
TIDE TABLES
poems by Nell Achterberg · Paper Lantern Press, 2024


HIGH WATER, 06:12

The sea comes up the slipway
like a neighbour with news,
stays for exactly as long as it said it would,
and leaves the step wet.


LOW WATER, 12:31

Now the harbour shows its pockets:
a shoe, a key, a blue glass float,
the anchor chain of a boat
that left before I was born.


SPRING TIDE

Twice a month the moon pulls harder
and the whole town notices —
the bins float, the dogs complain,
and everyone is a little in love.
`,
  paper: `
# Город из бумаги

*Марк Левин · повесть · «Бумажный фонарь», 2024*

## Первый дом

Мите было двенадцать, когда он построил первый дом из бумаги — из старых квитанций, обёрток и билета на электричку, который отец забыл в кармане куртки. Дом получился кривой, но в нём горело окно: Митя вклеил туда кусок жёлтого фантика.

К лету на подоконнике стоял уже целый квартал. Соседская девочка Аня принесла для него трамвай, вырезанный из открытки, и сказала, что в городе обязательно должна быть остановка — иначе как же люди будут возвращаться домой.

## Остановка

Остановку они строили три дня. Аня настаивала на расписании, Митя — на крыше от дождя. В конце концов сделали и то и другое, а на расписании написали только одно время: «Когда придёт».
`,
};

/* ----- PDF samples (ASCII; English sample chapters and sample translations) ----- */

const TPL_BOOKS_PDF = {
  ferry: ['Night Ferry to Halvard - sample chapter', 'PAPER LANTERN PRESS - SAMPLE CHAPTER', [
    '> Ingrid Sollie - novel - 264 pages - Lantern Fiction - 2025',
    '',
    '# 1. The Last Sailing',
    'The ferry to Halvard leaves at 23:40 whether or not anyone is on it. Maren had been told this by three different',
    'people in the harbour cafe, each of them with the satisfaction of someone delivering bad news that is not their own.',
    '',
    'She was on it. So were a man with a crate of hens, two students asleep against their rucksacks and a woman in a',
    'yellow raincoat who stood at the stern the whole way.',
    '',
    '# About the book',
    'A woman inherits a house on an island served by one night ferry a week - and a timetable with one sailing circled.',
    '',
    '> Sample pages of a fictional book generated by the landing template.',
  ]],
  hours: ['Small Hours - sample pages', 'PAPER LANTERN PRESS - SAMPLE PAGES', [
    '> Jonah Mercer - essays - 192 pages - Lantern Essays - 2024',
    '',
    '# On Waking at Four',
    'There is a particular silence at four in the morning that belongs neither to the night nor to the day. The fridge',
    'hums a little louder than it does at noon.',
    '',
    '# Contents',
    '- On Waking at Four',
    '- On Borrowed Books',
    '- On Trains That Wait',
    '- On Writing Letters Nobody Asked For',
    '',
    '> Sample pages of a fictional book generated by the landing template.',
  ]],
  roof: ['The Roof Garden - English sample translation', 'PAPER LANTERN PRESS - FOREIGN RIGHTS', [
    '> Iryna Lys - Sad na dakhu (The Roof Garden) - novel - 312 pages - Ukrainian original, 2025',
    '',
    '# Synopsis',
    'A young woman climbs onto the roof of her apartment block and finds a neighbour growing tomatoes in buckets.',
    'Over one summer the roofs of the city turn into a garden - and into a way of talking about what was lost.',
    '',
    '# Sample translation (chapter 1, opening)',
    'That April Solomiia went up onto the roof for the first time - not because she wanted to, but because someone',
    'had left the attic door open. From above, the city looked different: not streets, but roofs.',
    '',
    '# Rights',
    '- Available: all languages except Ukrainian',
    '- Full English sample (40 pages) on request: rights@paperlantern.example',
    '',
    '> Sample document of a fictional book generated by the landing template.',
  ]],
  north: ['A Room Facing North - English sample translation', 'PAPER LANTERN PRESS - FOREIGN RIGHTS', [
    '> Vera Sokolova - Komnata s oknom na sever (A Room Facing North) - stories - 208 pages - Russian original, 2023',
    '',
    '# Sample translation',
    'In a room facing north there is never any sun, but the light in it is even, like the light in a painter\'s studio.',
    'That is what the landlady said when she let the room, and Lida believed her - she believed everything then.',
    '',
    '# Rights',
    '- Available: world English, German, French',
    '',
    '> Sample document of a fictional book generated by the landing template.',
  ]],
  atlas: ['The Salt Atlas - sample chapter', 'PAPER LANTERN PRESS - SAMPLE CHAPTER', [
    '> Tomas Arregui - travels - 236 pages - Lantern Essays - 2026',
    '',
    '# Salinas',
    'At the salt pans the horizon is not a line but a shimmer. Workers in wide hats rake the crust into white ridges.',
    '',
    '# Maps in this edition',
    '- Twelve hand-drawn maps of salt coasts, with no roads on them',
    '',
    '> Sample pages of a fictional book generated by the landing template.',
  ]],
  lullaby: ['A Lullaby for the Lighthouse - English text', 'PAPER LANTERN PRESS - LITTLE LANTERN', [
    '> Oksana Melnyk - Kolyskova dlia maiaka - picture book - 40 pages - Ukrainian original, 2026',
    '',
    '# English text (sample)',
    'When all the ships are home and the gulls are asleep on the water, the lighthouse stays all alone -',
    'to shine, and shine, and shine.',
    '',
    '"Who will sing you a lullaby?" asks a little wave. "Nobody," says the lighthouse. "Lighthouses never sleep."',
    '',
    '# Rights',
    '- Available: all languages except Ukrainian; co-editions welcome',
    '',
    '> Sample document of a fictional book generated by the landing template.',
  ]],
  tides: ['Tide Tables - sample poems', 'PAPER LANTERN PRESS - SAMPLE PAGES', [
    '> Nell Achterberg - poems - 88 pages - Lantern Poetry - 2024',
    '',
    '# High Water, 06:12',
    'The sea comes up the slipway',
    'like a neighbour with news,',
    'stays for exactly as long as it said it would,',
    'and leaves the step wet.',
    '',
    '> Sample pages of a fictional book generated by the landing template.',
  ]],
  paper: ['The Paper Town - English sample translation', 'PAPER LANTERN PRESS - FOREIGN RIGHTS', [
    '> Mark Levin - Gorod iz bumagi (The Paper Town) - novella for young readers - 176 pages - Russian original, 2024',
    '',
    '# Sample translation',
    'Mitya was twelve when he built his first house out of paper - out of old receipts, sweet wrappers and a train',
    'ticket his father had forgotten in his jacket. The house came out crooked, but there was a light in its window.',
    '',
    '# Rights',
    '- Available: world English, Polish, Czech',
    '',
    '> Sample document of a fictional book generated by the landing template.',
  ]],
};

const TPL_BOOKS_LANG = {
  en: tplLibT('English', 'Английский', 'Англійська'),
  ru: tplLibT('Russian', 'Русский', 'Російська'),
  uk: tplLibT('Ukrainian', 'Украинский', 'Українська'),
};

const TPL_BOOKS_IMPRINT = {
  fiction: tplLibT('Lantern Fiction', 'Lantern Fiction', 'Lantern Fiction'),
  essays: tplLibT('Lantern Essays', 'Lantern Essays', 'Lantern Essays'),
  poetry: tplLibT('Lantern Poetry', 'Lantern Poetry', 'Lantern Poetry'),
  little: tplLibT('Little Lantern', 'Little Lantern', 'Little Lantern'),
};

// Books: key, title (original), author, lang, genre, imprint, year, pages, format, price, old, sku, rights, html, tags, cover, text file.
const TPL_BOOKS_LIST = [
  {
    key: 'atlas', title: 'The Salt Atlas', lang: 'en', imprint: 'essays', year: '2026', pages: '236', price: 18.99, sku: 'pl-salt-atlas', badge: tplLibT('New', 'Новинка', 'Новинка'),
    author: tplLibT('Tomás Arregui', 'Томас Арреги', 'Томас Арреґі'), genre: tplLibT('Travel', 'Путешествия', 'Подорожі'),
    format: tplLibT('Hardback, 14 × 21 cm', 'Твёрдый переплёт, 14 × 21 см', 'Тверда палітурка, 14 × 21 см'),
    rights: tplLibT('World', 'Все языки', 'Усі мови'),
    html: tplLibP('Twelve salt coasts, twelve hand-drawn maps without roads, and the people who still rake salt by hand. Slow travel at its saltiest.',
      'Двенадцать соляных побережий, двенадцать нарисованных от руки карт без дорог и люди, которые до сих пор сгребают соль вручную. Медленные путешествия.',
      'Дванадцять соляних узбереж, дванадцять мап без доріг, намальованих від руки, і люди, які досі згрібають сіль вручну. Повільні подорожі.'),
    tags: tplLibT('sea, salt, maps, slow travel', 'море, соль, карты, медленные путешествия', 'море, сіль, мапи, повільні подорожі'),
    cover: { motif: 'sun', bg: '#f1ece2', ink: '#141414', accent: '#c8361f', font: 'sans', fontTitle: 'display', art: 'bottom', label: 'Lantern Essays' },
    file: 'the-salt-atlas-excerpt.md',
  },
  {
    key: 'roof', title: 'Сад на даху', lang: 'uk', imprint: 'fiction', year: '2025', pages: '312', price: 17.99, sku: 'pl-sad-na-dakhu', badge: tplLibT('New', 'Новинка', 'Новинка'),
    author: tplLibT('Iryna Lys', 'Ирина Лис', 'Ірина Лис'), genre: tplLibT('Novel', 'Роман', 'Роман'),
    format: tplLibT('Paperback, 13 × 20 cm', 'Мягкая обложка, 13 × 20 см', 'М’яка обкладинка, 13 × 20 см'),
    rights: tplLibT('All except Ukrainian', 'Все, кроме украинского', 'Усі, крім української'),
    html: tplLibP('A young woman finds a neighbour growing tomatoes on the next roof — and over one summer the roofs of the city become a garden and a way to talk about loss.',
      'Девушка находит на соседней крыше старика с помидорами в вёдрах — и за одно лето крыши города превращаются в сад и в способ говорить о потере.',
      'Дівчина знаходить на сусідньому даху старого з помідорами у відрах — і за одне літо дахи міста стають садом і способом говорити про втрату.'),
    tags: tplLibT('city, garden, neighbours, summer', 'город, сад, соседи, лето', 'місто, сад, сусіди, літо'),
    cover: { motif: 'leaves', bg: '#1d3b2e', ink: '#f3efe4', accent: '#e0623f', font: 'sans', fontTitle: 'display', art: 'bottom', label: 'Lantern Fiction' },
    file: 'sad-na-dakhu-urivok.md',
  },
  {
    key: 'lullaby', title: 'Колискова для маяка', lang: 'uk', imprint: 'little', year: '2026', pages: '40', price: 11.99, sku: 'pl-kolyskova', badge: tplLibT('New', 'Новинка', 'Новинка'),
    author: tplLibT('Oksana Melnyk', 'Оксана Мельник', 'Оксана Мельник'), genre: tplLibT('Picture book', 'Книжка с картинками', 'Книжка з малюнками'),
    format: tplLibT('Hardback, 24 × 24 cm', 'Твёрдый переплёт, 24 × 24 см', 'Тверда палітурка, 24 × 24 см'),
    rights: tplLibT('All except Ukrainian', 'Все, кроме украинского', 'Усі, крім української'),
    html: tplLibP('Lighthouses never sleep — so the wave, the wind, the rain and a fisherman’s cat sing one a lullaby. A bedtime picture book in verse.',
      'Маяки не спят — поэтому волна, ветер, дождь и рыбацкий кот поют маяку колыбельную. Книжка с картинками в стихах.',
      'Маяки не сплять — тож хвиля, вітер, дощ і рибальський кіт співають маякові колискову. Віршована книжка з малюнками.'),
    tags: tplLibT('bedtime, sea, verse', 'на ночь, море, стихи', 'на ніч, море, вірші'),
    cover: { motif: 'beam', bg: '#2b3fbf', ink: '#fdf8ee', accent: '#ffcf4a', font: 'sans', fontTitle: 'sans', art: 'bottom', label: 'Little Lantern' },
    file: 'kolyskova-dlia-maiaka.txt',
  },
  {
    key: 'ferry', title: 'Night Ferry to Halvard', lang: 'en', imprint: 'fiction', year: '2025', pages: '264', price: 16.99, sku: 'pl-night-ferry',
    author: tplLibT('Ingrid Sollie', 'Ингрид Солли', 'Інгрід Соллі'), genre: tplLibT('Novel', 'Роман', 'Роман'),
    format: tplLibT('Paperback, 13 × 20 cm', 'Мягкая обложка, 13 × 20 см', 'М’яка обкладинка, 13 × 20 см'),
    rights: tplLibT('World English sold', 'Английский продан', 'Англійську продано'),
    html: tplLibP('A woman inherits a house on an island served by one night ferry a week — and a timetable with one sailing circled in pencil.',
      'Женщина наследует дом на острове, куда раз в неделю ходит ночной паром, — и расписание, где карандашом обведён один рейс.',
      'Жінка успадковує будинок на острові, куди раз на тиждень ходить нічний пором, — і розклад, де олівцем обведено один рейс.'),
    tags: tplLibT('island, inheritance, winter', 'остров, наследство, зима', 'острів, спадок, зима'),
    cover: { motif: 'waves', bg: '#121821', ink: '#f2ede2', accent: '#c8361f', font: 'sans', fontTitle: 'display', art: 'bottom', label: 'Lantern Fiction' },
    file: 'night-ferry-to-halvard-excerpt.md',
  },
  {
    key: 'north', title: 'Комната с окном на север', lang: 'ru', imprint: 'fiction', year: '2023', pages: '208', price: 14.99, old: 16.99, sku: 'pl-komnata-sever',
    author: tplLibT('Vera Sokolova', 'Вера Соколова', 'Віра Соколова'), genre: tplLibT('Short stories', 'Рассказы', 'Оповідання'),
    format: tplLibT('Paperback, 13 × 20 cm', 'Мягкая обложка, 13 × 20 см', 'М’яка обкладинка, 13 × 20 см'),
    rights: tplLibT('English, German, French', 'Английский, немецкий, французский', 'Англійська, німецька, французька'),
    html: tplLibP('Stories of rented rooms, frosted windows and telephone calls for someone who never lived there. Quiet, precise and full of light.',
      'Рассказы о съёмных комнатах, морозных окнах и звонках для той, кто здесь никогда не жил. Тихо, точно и светло.',
      'Оповідання про винайняті кімнати, морозні вікна й дзвінки для тієї, хто тут ніколи не жила. Тихо, точно і світло.'),
    tags: tplLibT('city, winter, solitude', 'город, зима, одиночество', 'місто, зима, самотність'),
    cover: { motif: 'grid', bg: '#e9eef2', ink: '#18222c', accent: '#2b3fbf', font: 'sans', fontTitle: 'serif', art: 'bottom', label: 'Lantern Fiction' },
    file: 'komnata-s-oknom-na-sever-otryvok.md',
  },
  {
    key: 'hours', title: 'Small Hours', lang: 'en', imprint: 'essays', year: '2024', pages: '192', price: 12.99, sku: 'pl-small-hours',
    author: tplLibT('Jonah Mercer', 'Джона Мерсер', 'Джона Мерсер'), genre: tplLibT('Essays', 'Эссе', 'Есеї'),
    format: tplLibT('Paperback, 11 × 18 cm', 'Мягкая обложка, 11 × 18 см', 'М’яка обкладинка, 11 × 18 см'),
    rights: tplLibT('World', 'Все языки', 'Усі мови'),
    html: tplLibP('Pocket-sized essays for the hour between night and morning: on waking at four, borrowed books and trains that wait.',
      'Карманные эссе для часа между ночью и утром: о пробуждении в четыре, чужих книгах и поездах, которые ждут.',
      'Кишенькові есеї для години між ніччю й ранком: про пробудження о четвертій, позичені книжки й потяги, що чекають.'),
    tags: tplLibT('night, tea, everyday', 'ночь, чай, повседневность', 'ніч, чай, буденність'),
    cover: { motif: 'stars', bg: '#f6f1e6', ink: '#141414', accent: '#c8361f', font: 'sans', fontTitle: 'display', art: 'top', label: 'Lantern Essays', italic: true },
    file: 'small-hours-excerpt.md',
  },
  {
    key: 'tides', title: 'Tide Tables', lang: 'en', imprint: 'poetry', year: '2024', pages: '88', price: 10.99, sku: 'pl-tide-tables',
    author: tplLibT('Nell Achterberg', 'Нелл Ахтерберг', 'Нелл Ахтерберґ'), genre: tplLibT('Poetry', 'Поэзия', 'Поезія'),
    format: tplLibT('Paperback, 13 × 20 cm', 'Мягкая обложка, 13 × 20 см', 'М’яка обкладинка, 13 × 20 см'),
    rights: tplLibT('World', 'Все языки', 'Усі мови'),
    html: tplLibP('A year of poems set to the harbour’s tide table: high water, low water and the spring tides when the whole town is a little in love.',
      'Год стихов по таблице приливов: полная вода, малая вода и сизигийные приливы, когда весь город немного влюблён.',
      'Рік віршів за таблицею припливів: повна вода, мала вода й сизигійні припливи, коли все місто трохи закохане.'),
    tags: tplLibT('sea, harbour, seasons', 'море, гавань, времена года', 'море, гавань, пори року'),
    cover: { motif: 'rings', bg: '#c8361f', ink: '#fbf5ea', accent: '#121821', font: 'sans', fontTitle: 'display', art: 'bottom', label: 'Lantern Poetry' },
    file: 'tide-tables-sample.txt',
  },
  {
    key: 'paper', title: 'Город из бумаги', lang: 'ru', imprint: 'little', year: '2024', pages: '176', price: 12.99, sku: 'pl-gorod-iz-bumagi',
    author: tplLibT('Mark Levin', 'Марк Левин', 'Марк Левін'), genre: tplLibT('Young readers', 'Для подростков', 'Для підлітків'),
    format: tplLibT('Paperback, 13 × 20 cm', 'Мягкая обложка, 13 × 20 см', 'М’яка обкладинка, 13 × 20 см'),
    rights: tplLibT('English, Polish, Czech', 'Английский, польский, чешский', 'Англійська, польська, чеська'),
    html: tplLibP('Two neighbours build a whole town out of receipts and sweet wrappers — with a tram stop whose timetable says only “When it comes”.',
      'Двое соседей строят целый город из квитанций и фантиков — с трамвайной остановкой, где в расписании написано только «Когда придёт».',
      'Двоє сусідів будують ціле місто з квитанцій і фантиків — із трамвайною зупинкою, де в розкладі написано лише «Коли прийде».'),
    tags: tplLibT('friendship, city, making things', 'дружба, город, своими руками', 'дружба, місто, своїми руками'),
    cover: { motif: 'peaks', bg: '#f3e7cf', ink: '#2b2116', accent: '#2b3fbf', font: 'sans', fontTitle: 'slab', art: 'bottom', label: 'Little Lantern' },
    file: 'gorod-iz-bumagi-otryvok.md',
  },
];

/* ----- pictures as data ----- */

/** Book stack still life for the hero: three piles of books, an open book, a mug, a pencil (isometric kit). */
function tplBooksHeroSpec() {
  const C = ['#c8361f', '#2b3fbf', '#141414', '#f2ede2', '#e9b23a', '#1d3b2e', '#8a8378', '#ffffff'];
  const s = [];
  const pile = (x, y, seed, n) => {
    let z = 0;
    for (let i = 0; i < n; i++) {
      const w = 13 + ((seed * 7 + i * 5) % 5), dpt = 9 + ((seed + i * 3) % 3), h = 1.6 + ((i * 3 + seed) % 3) * 0.5;
      const dx = ((i * 7 + seed) % 3) - 1, dy = ((i * 5 + seed) % 3) - 1;
      const col = C[(seed + i * 3) % C.length];
      s.push({ box: [x + dx, y + dy, z, w, dpt, h], c: tplLibPaint(col) });
      s.push({ box: [x + dx + 0.4, y + dy + dpt - 0.02, z + 0.25, w - 0.8, 0.05, h - 0.5], c: ['#ffffff', '#f4efe4', '#e6dfd0'] });
      z += h;
    }
    return z;
  };
  pile(0, 0, 1, 7);
  pile(19, -2, 4, 5);
  // open book: two pages on a cover
  s.push({ box: [16, 15, 0, 22, 14, 0.6], c: tplLibPaint('#c8361f') });
  s.push({ prism: [17, 15.6, 0.6], axis: 'y', len: 12.8, profile: [[0, 0], [10, 0], [10, 1.6], [6, 1.2], [0, 0.6]], c: ['#ffffff', '#f2ede2', '#ddd5c4'] });
  s.push({ prism: [27, 15.6, 0.6], axis: 'y', len: 12.8, profile: [[0, 0], [10, 0], [10, 0.6], [4, 1.2], [0, 1.6]], c: ['#ffffff', '#f2ede2', '#ddd5c4'] });
  s.push({ stroke: [[[19, 18, 1.5], [25, 18, 1.8]], [[19, 20, 1.5], [25, 20, 1.8]], [[19, 22, 1.5], [24, 22, 1.8]], [[29, 18, 1.8], [35, 18, 1.4]], [[29, 20, 1.8], [35, 20, 1.4]], [[29, 22, 1.8], [33, 22, 1.4]]], color: '#8a8378', w: 0.18 });
  s.push({ box: [16.5, 28.6, 0.5, 15, 0.5, 0.25], c: tplLibPaint('#e9b23a') });
  // mug and pencil
  s.push({ cyl: [41, 6, 0], axis: 'z', r: 3.2, len: 7, c: tplLibPaint('#2b3fbf'), cap: '#3a2a1e' });
  s.push({ arc: [44, 6, 3.5], axis: 'y', r: 1.8, color: '#2b3fbf', w: 0.7 });
  s.push({ box: [36, 30, 0, 12, 0.7, 0.7], c: tplLibPaint('#e9b23a') }, { box: [48, 30, 0, 1.2, 0.7, 0.7], c: tplLibPaint('#141414') });
  return s;
}

/** Imprint mark: a lantern on a black square (64×64). */
function tplBooksBrandSVG() {
  return TPL_ART_SVG + 'viewBox="0 0 64 64" width="64" height="64"><rect width="64" height="64" fill="#141414"/><rect x="2" y="2" width="60" height="60" fill="none" stroke="#c8361f" stroke-width="2"/>' +
    '<path d="M24 16h16M28 12h8v4" fill="none" stroke="#fbf5ea" stroke-width="2.5"/>' +
    '<path d="M22 20h20l-3 28H25Z" fill="#c8361f"/><path d="M27 26h10l-1.6 16h-6.8Z" fill="#ffcf4a"/>' +
    '<path d="M20 52h24" stroke="#fbf5ea" stroke-width="3"/></svg>';
}

function tplBuildBooks(V) {
  const K = tplKit(V, ['en', 'ru', 'uk']);
  const { B, L } = K;
  const T = tplLibT;
  const P = tplLibP;
  const img = (name, svg, title) => K.svg(name, svg, { title });
  const col = (w, blocks) => ({ id: K.id(), w, blocks });
  const field = (key, type, label, o = {}) => K.item({ key, type, label: L(label), ph: L(o.ph || ''), options: L(o.options || ''), required: !!o.required, half: !!o.half });

  // ----- pictures -----
  const brand = img('paper-lantern-mark.svg', tplBooksBrandSVG(), T('Paper Lantern Press mark', 'Знак издательства «Бумажный фонарь»', 'Знак видавництва «Паперовий ліхтар»'));
  const hero = img('paper-lantern-books.svg', tplIsoScene(1200, 900, tplBooksHeroSpec(), { light: true, pad: 50, dy: 10, bg0: '#fbf8f2', bg1: '#ede6d8', grid: '#141414', glow: [0.55, 0.45, 0.5], glowC0: '#fff4dc', glowC1: '#f1dfb8' }),
    T('New books on the desk: piles of paperbacks, an open book and a mug of tea', 'Новые книги на столе: стопки книг, раскрытая книга и кружка чая', 'Нові книжки на столі: стоси книжок, розгорнута книжка й горнятко чаю'));
  const portrait = (seed, o) => img('author-' + seed + '.svg', tplAgroPortrait({ seed, bg: ['#f1ece2', '#d9d0bf'], shirt: '#141414', shirt2: '#000000', collar: '#fbf5ea', ...o }), '');
  const faces = {
    sollie: portrait('sollie', { skin: '#f3d6c2', skin2: '#e4b99d', hair: '#d9b77a', style: 'long', shirt: '#2b3fbf', shirt2: '#22339a' }),
    arregui: portrait('arregui', { skin: '#d8a27c', skin2: '#c48b66', hair: '#2a1d16', style: 'short', beard: true, glasses: true }),
    lys: portrait('lys', { skin: '#f0cdb4', skin2: '#e0b394', hair: '#8c3b1f', style: 'bun', shirt: '#c8361f', shirt2: '#a42b18' }),
    mercer: portrait('mercer', { skin: '#7c5039', skin2: '#6a422e', hair: '#1b1410', style: 'buzz', shirt: '#1d3b2e', shirt2: '#152c22' }),
  };

  // ----- books: covers, excerpts, PDF samples -----
  const ed = {};
  for (const bk of TPL_BOOKS_LIST) {
    const e = { bk };
    e.cover = img('cover-' + bk.key + '.svg', tplLibCover({ seed: 'pl-' + bk.key, title: bk.title, author: bk.author[bk.lang] || bk.author.en, ...bk.cover }), T('Cover: ' + bk.title, 'Обложка: ' + bk.title, 'Обкладинка: ' + bk.title));
    const verse = /\.txt$/.test(bk.file);
    e.text = K.addAtt({
      name: bk.file, mime: verse ? 'text/plain' : 'text/markdown', data: tplLibText(TPL_BOOKS_TEXTS[bk.key]), title: L(bk.title),
      desc: verse ? T('Sample · plain text', 'Фрагмент · простой текст', 'Фрагмент · простий текст') : T('Excerpt · Markdown', 'Отрывок · Markdown', 'Уривок · Markdown'),
    });
    const [ptitle, band, lines] = TPL_BOOKS_PDF[bk.key];
    const translated = bk.lang !== 'en';
    e.pdf = K.addAtt({
      name: bk.file.replace(/\.(md|txt)$/, '').replace(/-(excerpt|sample|urivok|otryvok)$/, '') + (translated ? '-english-sample.pdf' : '-sample.pdf'), mime: 'application/pdf',
      data: K.files.makePDF(ptitle, lines, { accent: '#c8361f', band }),
      title: translated ? T('English sample translation', 'Английский пробный перевод', 'Англійський пробний переклад') : T('Sample pages', 'Пробные страницы', 'Пробні сторінки'),
      desc: T('PDF sample', 'Образец в PDF', 'Зразок у PDF'),
    });
    e.files = [
      { att: e.text, label: L(verse ? T('First poems · text', 'Первые стихи · текст', 'Перші вірші · текст') : T('Read the first pages', 'Читать первые страницы', 'Читати перші сторінки')), kind: 'text' },
      { att: e.pdf, label: L(translated ? T('English sample translation (PDF)', 'Пробный перевод на английский (PDF)', 'Пробний переклад англійською (PDF)') : T('Sample pages (PDF)', 'Пробные страницы (PDF)', 'Пробні сторінки (PDF)')), kind: 'pdf' },
    ];
    ed[bk.key] = e;
  }
  const A = (label, value) => ({ label: L(label), value: L(value) });
  const ATTR = {
    author: (bk) => A(T('Author', 'Автор', 'Автор'), bk.author),
    genre: (bk) => A(T('Genre', 'Жанр', 'Жанр'), bk.genre),
    pages: (bk) => A(T('Pages', 'Страниц', 'Сторінок'), bk.pages),
    lang: (bk) => A(T('Language', 'Язык', 'Мова'), TPL_BOOKS_LANG[bk.lang]),
    year: (bk) => A(T('Year', 'Год', 'Рік'), bk.year),
    imprint: (bk) => A(T('Imprint', 'Серия', 'Серія'), TPL_BOOKS_IMPRINT[bk.imprint]),
    format: (bk) => A(T('Format', 'Формат', 'Формат'), bk.format),
    rights: (bk) => A(T('Rights available', 'Права доступны', 'Права доступні'), bk.rights),
  };
  const unit = T('copy', 'экз.', 'прим.');
  const book = (key, keys) => {
    const e = ed[key], bk = e.bk;
    return K.item({
      title: L(bk.title), subtitle: L(bk.author), cover: e.cover, badge: L(bk.badge || ''), html: L(bk.html), tags: L(bk.tags),
      attrs: keys.map((k) => ATTR[k](bk)), files: e.files.map((f) => ({ ...f })), date: '', href: '', price: bk.price, old: bk.old ?? null, unit: L(unit), sku: bk.sku,
    });
  };
  const rightsRow = (key) => {
    const e = ed[key], bk = e.bk;
    return K.item({
      title: L(bk.title), subtitle: L(bk.author), cover: e.cover, badge: L(''), html: L(bk.html), tags: L(''),
      attrs: ['lang', 'rights', 'pages', 'genre', 'year'].map((k) => ATTR[k](bk)), files: [{ ...e.files[1] }], date: '', href: '', price: null, old: null, unit: L(''), sku: '',
    });
  };

  // ----- requests (browser-local endpoints; e-mail fallback) -----
  const R = (name, url) => ({ id: K.id(), name, method: 'POST', url, headers: [], credentials: 'omit', timeout: 8000, retries: 1, itemsPath: 'items' });
  const rqOrder = R('Orders (browser storage)', 'local:orders');
  const rqSubmit = R('Manuscripts and messages (browser storage)', 'local:inbox');

  const d = K.doc({
    name: 'Paper Lantern Press — books and reading club', preset: 'quire', defaultLang: 'en',
    author: 'Paper Lantern Press',
    keywords: 'independent publisher, books, reading club, book subscription, literary fiction, essays, poetry, picture books, translation rights',
    title: T('Paper Lantern Press — small books for long evenings', 'Издательство «Бумажный фонарь» — небольшие книги для долгих вечеров', 'Видавництво «Паперовий ліхтар» — невеликі книжки для довгих вечорів'),
    description: T(
      'Independent publisher and reading club: our books with excerpts and PDF samples, club subscriptions, reading lists, events, authors and foreign rights.',
      'Независимое издательство и книжный клуб: наши книги с отрывками и PDF-образцами, подписка клуба, списки для чтения, встречи, авторы и права на перевод.',
      'Незалежне видавництво й книжковий клуб: наші книжки з уривками та PDF-зразками, підписка клубу, списки для читання, зустрічі, автори й права на переклад.'),
    meta: { favicon: brand },
    theme: { scheme: 'auto' },
    output: { autodetect: true, switcher: 'buttons', langLabels: 'code', themeToggle: true, toolbarPos: 'nav', uiFallback: 'en', motion: 'rise', backToTop: true },
    shop: {
      currency: 'GBP', mode: 'cart', cartButton: 'auto', sync: 'local', policy: 'newest', ttlDays: 30,
      checkout: {
        method: 'request', req: rqOrder.id, fallback: 'mailto', email: 'orders@paperlantern.example', phone: '+44 000 000 2014', minTotal: 0,
        note: T('Books ship within two working days, wrapped in brown paper. Club subscriptions start with the next monthly parcel.',
          'Книги отправляем в течение двух рабочих дней, завёрнутыми в крафт-бумагу. Подписка клуба начинается со следующей ежемесячной посылки.',
          'Книжки надсилаємо протягом двох робочих днів, загорнутими в крафтовий папір. Підписка клубу починається з наступної щомісячної посилки.'),
        success: T('Thank you! Your order is in — we will e-mail the payment link and the tracking number.',
          'Спасибо! Заказ принят — пришлём ссылку на оплату и трек-номер на e-mail.',
          'Дякуємо! Замовлення прийнято — надішлемо посилання на оплату й трек-номер на e-mail.'),
        fields: [
          field('name', 'text', T('Full name', 'Имя и фамилия', 'Ім’я та прізвище'), { required: true, half: true }),
          field('email', 'email', T('E-mail', 'E-mail', 'E-mail'), { required: true, half: true }),
          field('address', 'textarea', T('Delivery address', 'Адрес доставки', 'Адреса доставки'), { required: true }),
          field('gift', 'checkbox', T('This is a gift — no prices on the packing slip', 'Это подарок — без цен в накладной', 'Це подарунок — без цін у накладній')),
        ],
      },
    },
    requests: [rqOrder, rqSubmit],
  });
  d.meta.ogImage = hero;

  // ----- header -----
  d.regions.header = [B('nav', {
    brand: L(T('Paper Lantern', 'Бумажный фонарь', 'Паперовий ліхтар')), logo: brand, logoH: 34, sticky: true, overlay: false, variant: 'bar',
    items: [
      K.item({ label: L(T('Books', 'Книги', 'Книжки')), href: '#books' }),
      K.item({ label: L(T('Club', 'Клуб', 'Клуб')), href: '#club' }),
      K.item({ label: L(T('Events', 'Встречи', 'Зустрічі')), href: '#events' }),
      K.item({ label: L(T('Authors', 'Авторы', 'Автори')), href: '#authors' }),
    ],
    ctaLabel: L(T('Join the club', 'Вступить в клуб', 'Вступити до клубу')), ctaHref: '#club',
  })];

  // ----- main -----
  const heroB = B('hero', {
    layout: 'split', media: hero, height: 'auto',
    eyebrow: L(T('Independent publisher & reading club · since 2014', 'Независимое издательство и книжный клуб · с 2014 года', 'Незалежне видавництво й книжковий клуб · з 2014 року')),
    title: L(T('Small books for long evenings', 'Небольшие книги для долгих вечеров', 'Невеликі книжки для довгих вечорів')),
    text: L(P('We publish eight books a year — novels, essays, poems and picture books, in English and in translation from Ukrainian and Russian. Read the first pages of any of them right here.',
      'Мы выпускаем восемь книг в год — романы, эссе, стихи и книжки с картинками, на английском и в переводах с украинского и русского. Первые страницы любой из них можно прочесть прямо здесь.',
      'Ми видаємо вісім книжок на рік — романи, есеї, вірші й книжки з малюнками, англійською та в перекладах з української й російської. Перші сторінки будь-якої з них можна прочитати просто тут.')),
    items: [
      K.btn(T('See the books', 'Смотреть книги', 'Дивитися книжки'), '#books', 'primary', K.icon('book')),
      K.btn(T('Join the club', 'Вступить в клуб', 'Вступити до клубу'), '#club', 'secondary'),
    ],
  });

  const books = K.sec({
    anchor: 'books', eyebrow: T('Our books', 'Наши книги', 'Наші книжки'),
    title: T('Read the first pages, then take one home', 'Прочтите первые страницы — и заберите книгу домой', 'Прочитайте перші сторінки — і заберіть книжку додому'),
    lead: P('Every book comes with an excerpt you can read in the browser and a PDF sample. Filter by imprint, genre or language; sort by price or length.',
      'К каждой книге — отрывок, который можно прочесть в браузере, и образец в PDF. Фильтруйте по серии, жанру или языку; сортируйте по цене или объёму.',
      'До кожної книжки — уривок, який можна прочитати в браузері, і зразок у PDF. Фільтруйте за серією, жанром чи мовою; сортуйте за ціною чи обсягом.'),
    width: 'wide',
  }, [B('collection', {
    variant: 'shelf', columns: 4, ratio: '2/3', details: 'modal', media: 'reader',
    search: true, filters: ['Imprint', 'Genre', 'Language'], ranges: ['$price', 'Pages'], sorts: ['$title', '$price', 'Year', 'Pages'],
    buy: L(T('Add to basket', 'В корзину', 'До кошика')),
    empty: L(T('No book matches — try another imprint or language.', 'Ни одна книга не подошла — попробуйте другую серию или язык.', 'Жодна книжка не підійшла — спробуйте іншу серію чи мову.')),
    items: TPL_BOOKS_LIST.map((bk) => book(bk.key, ['author', 'genre', 'pages', 'lang', 'year', 'imprint', 'format'])),
  })]);

  const lists = K.sec({
    anchor: 'lists', tone: 'muted', eyebrow: T('Reading lists', 'Списки для чтения', 'Списки для читання'),
    title: T('Three ways into the list', 'Три способа начать', 'Три способи почати'),
  }, [B('features', {
    variant: 'cards', columns: 3,
    items: [
      K.item({ icon: K.icon('clock'), image: null, title: L(T('For a night train', 'Для ночного поезда', 'Для нічного потяга')),
        html: L(T('<ol><li>Night Ferry to Halvard</li><li>Small Hours</li><li>Tide Tables</li></ol><p>Three books that fit one long journey and a little of the next.</p>',
          '<ol><li>Night Ferry to Halvard</li><li>Small Hours</li><li>Tide Tables</li></ol><p>Три книги на одну долгую дорогу и немного следующей.</p>',
          '<ol><li>Night Ferry to Halvard</li><li>Small Hours</li><li>Tide Tables</li></ol><p>Три книжки на одну довгу дорогу й трохи наступної.</p>')) }),
      K.item({ icon: K.icon('star'), image: null, title: L(T('Read aloud together', 'Читать вслух вместе', 'Читати вголос разом')),
        html: L(T('<ol><li>Колискова для маяка</li><li>Город из бумаги</li><li>The Salt Atlas (the maps!)</li></ol><p>For evenings when someone small is listening.</p>',
          '<ol><li>Колискова для маяка</li><li>Город из бумаги</li><li>The Salt Atlas (карты!)</li></ol><p>Для вечеров, когда слушает кто-то маленький.</p>',
          '<ol><li>Колискова для маяка</li><li>Город из бумаги</li><li>The Salt Atlas (мапи!)</li></ol><p>Для вечорів, коли слухає хтось маленький.</p>')) }),
      K.item({ icon: K.icon('globe'), image: null, title: L(T('In translation', 'В переводе', 'У перекладі')),
        html: L(T('<ol><li>Сад на даху — Iryna Lys</li><li>Комната с окном на север — Vera Sokolova</li><li>Город из бумаги — Mark Levin</li></ol><p>Read the originals here; English sample translations come as PDFs.</p>',
          '<ol><li>Сад на даху — Ирина Лис</li><li>Комната с окном на север — Вера Соколова</li><li>Город из бумаги — Марк Левин</li></ol><p>Оригиналы читайте здесь; пробные переводы на английский — в PDF.</p>',
          '<ol><li>Сад на даху — Ірина Лис</li><li>Комната с окном на север — Віра Соколова</li><li>Город из бумаги — Марк Левін</li></ol><p>Оригінали читайте тут; пробні переклади англійською — у PDF.</p>')) }),
    ],
  })]);

  const plan = (name, price, period, featured, sku, label, html) => K.item({ name: L(name), price, period: L(period), featured, label: L(label), href: '', sku, html: L(html) });
  const month = T('month', 'месяц', 'місяць');
  const club = K.sec({
    anchor: 'club', eyebrow: T('Reading club', 'Книжный клуб', 'Книжковий клуб'),
    title: T('A book in the post, a table to talk about it', 'Книга по почте и стол, за которым о ней говорят', 'Книжка поштою і стіл, за яким про неї говорять'),
    lead: P('Club members get every new book before the shops, a monthly evening with the author or translator, and a postcard you will want to keep.',
      'Участники клуба получают каждую новую книгу раньше магазинов, ежемесячный вечер с автором или переводчиком и открытку, которую захочется сохранить.',
      'Учасники клубу отримують кожну нову книжку раніше за крамниці, щомісячний вечір з автором чи перекладачем і листівку, яку захочеться зберегти.'),
    align: 'center',
  }, [B('pricing', {
    columns: 3,
    items: [
      plan(T('Reader', 'Читатель', 'Читач'), 9, month, false, 'club-reader', T('Subscribe', 'Подписаться', 'Підписатися'),
        tplLibUl(['One new book every other month', 'Online club evenings', '10% off the whole list'], ['Новая книга раз в два месяца', 'Онлайн-встречи клуба', 'Скидка 10% на все книги'], ['Нова книжка раз на два місяці', 'Онлайн-зустрічі клубу', 'Знижка 10% на всі книжки'])),
      plan(T('Club', 'Клуб', 'Клуб'), 15, month, true, 'club-monthly', T('Join the club', 'Вступить в клуб', 'Вступити до клубу'),
        tplLibUl(['Every new book, before the shops', 'A seat at the monthly evening', 'Signed bookplate and postcard', '15% off the whole list'], ['Каждая новая книга раньше магазинов', 'Место на ежемесячной встрече', 'Подписной экслибрис и открытка', 'Скидка 15% на все книги'], ['Кожна нова книжка раніше за крамниці', 'Місце на щомісячній зустрічі', 'Підписаний екслібрис і листівка', 'Знижка 15% на всі книжки'])),
      plan(T('Gift: three months', 'Подарок: три месяца', 'Подарунок: три місяці'), 42, T('once', 'разово', 'разово'), false, 'club-gift-3', T('Give a gift', 'Подарить', 'Подарувати'),
        tplLibUl(['Three monthly parcels', 'A card with your message', 'Starts on the date you choose'], ['Три ежемесячные посылки', 'Открытка с вашим текстом', 'Начинается в выбранный вами день'], ['Три щомісячні посилки', 'Листівка з вашим текстом', 'Починається в обраний вами день'])),
    ],
  })]);

  const ev = (date, time, title, venue, price, sku, status = 'on', href = '') => K.item({ date, time, title: L(title), venue: L(venue), city: L(T('Ashby Quay', 'Эшби-Ки', 'Ешбі-Кі')), href, price, sku, status });
  const shop = T('Paper Lantern shop, 12 Ropewalk Lane', 'Магазин «Бумажный фонарь», Ропуок-лейн, 12', 'Крамниця «Паперовий ліхтар», Ропвок-лейн, 12');
  const events = K.sec({
    anchor: 'events', tone: 'dark', eyebrow: T('Events', 'Встречи', 'Зустрічі'),
    title: T('Launches, club nights and a translation workshop', 'Презентации, вечера клуба и мастерская перевода', 'Презентації, вечори клубу й майстерня перекладу'),
  }, [B('events', {
    variant: 'cards', columns: 2, hidePast: false, linkLabel: L(T('Details', 'Подробнее', 'Докладніше')), buy: L(T('Get a ticket', 'Купить билет', 'Купити квиток')),
    items: [
      ev('2026-10-22', '19:00', T('Launch: The Salt Atlas with Tomás Arregui', 'Презентация: «The Salt Atlas», Томас Арреги', 'Презентація: «The Salt Atlas», Томас Арреґі'), shop, 5, 'ev-salt-atlas', 'few'),
      ev('2026-11-05', '19:30', T('Club night: Сад на даху', 'Вечер клуба: «Сад на даху»', 'Вечір клубу: «Сад на даху»'), T('Upstairs room, The Ropewalk café', 'Второй этаж, кафе «Ропуок»', 'Другий поверх, кафе «Ропвок»'), null, '', 'on', '#club'),
      ev('2026-11-14', '11:00', T('Translation workshop: from Ukrainian to English', 'Мастерская перевода: с украинского на английский', 'Майстерня перекладу: з української англійською'), shop, 15, 'ev-translation-ws'),
      ev('2026-12-06', '16:00', T('Lullabies for lighthouses: a reading for children', 'Колыбельные для маяков: чтения для детей', 'Колискові для маяків: читання для дітей'), T('Ashby Quay Library', 'Библиотека Эшби-Ки', 'Бібліотека Ешбі-Кі'), null, '', 'on', '#contact'),
    ],
  })]);

  const member = (photo, name, role, html) => K.item({ photo, name: L(name), role: L(role), html: L(html), href: '' });
  const authors = K.sec({
    anchor: 'authors', eyebrow: T('Authors', 'Авторы', 'Автори'), title: T('The people behind the pages', 'Люди за страницами', 'Люди за сторінками'),
  }, [B('team', {
    variant: 'cards', columns: 4,
    items: [
      member(faces.sollie, T('Ingrid Sollie', 'Ингрид Солли', 'Інгрід Соллі'), T('Novelist · Night Ferry to Halvard', 'Романистка · «Night Ferry to Halvard»', 'Романістка · «Night Ferry to Halvard»'),
        P('Grew up on a ferry route and still cannot sleep without the sound of an engine.', 'Выросла на паромной линии и до сих пор не может уснуть без шума мотора.', 'Виросла на поромній лінії й досі не може заснути без шуму мотора.')),
      member(faces.arregui, T('Tomás Arregui', 'Томас Арреги', 'Томас Арреґі'), T('Travel writer · The Salt Atlas', 'Автор путевых заметок · «The Salt Atlas»', 'Автор подорожніх нотаток · «The Salt Atlas»'),
        P('Draws maps without roads and has visited every salt pan he could reach on foot.', 'Рисует карты без дорог и побывал на всех солеварнях, до которых смог дойти пешком.', 'Малює мапи без доріг і побував на всіх солеварнях, до яких зміг дійти пішки.')),
      member(faces.lys, T('Iryna Lys', 'Ирина Лис', 'Ірина Лис'), T('Novelist · Сад на даху', 'Романистка · «Сад на даху»', 'Романістка · «Сад на даху»'),
        P('Writes in Ukrainian and grows tomatoes on a balcony the size of a door.', 'Пишет по-украински и выращивает помидоры на балконе размером с дверь.', 'Пише українською й вирощує помідори на балконі завбільшки з двері.')),
      member(faces.mercer, T('Jonah Mercer', 'Джона Мерсер', 'Джона Мерсер'), T('Essayist · Small Hours', 'Эссеист · «Small Hours»', 'Есеїст · «Small Hours»'),
        P('Night-shift baker turned essayist; writes between four and six in the morning.', 'Пекарь ночной смены, ставший эссеистом; пишет с четырёх до шести утра.', 'Пекар нічної зміни, що став есеїстом; пише з четвертої до шостої ранку.')),
    ],
  })]);

  const voices = K.sec({
    tone: 'muted', eyebrow: T('Readers', 'Читатели', 'Читачі'), title: T('What the club says', 'Что говорят в клубе', 'Що кажуть у клубі'),
  }, [B('testimonials', {
    variant: 'cards', columns: 3,
    items: [
      K.item({ rating: 5, photo: null, name: L(T('Hannah P.', 'Ханна П.', 'Ганна П.')), role: L(T('Club member since 2019', 'В клубе с 2019 года', 'У клубі з 2019 року')),
        html: L(P('The parcel arrives, I put the kettle on and the evening is decided. Every single month.', 'Приходит посылка, я ставлю чайник — и вечер решён. Каждый месяц.', 'Приходить посилка, я ставлю чайник — і вечір вирішено. Щомісяця.')) }),
      K.item({ rating: 5, photo: null, name: L(T('Owen & Mila', 'Оуэн и Мила', 'Овен і Міла')), role: L(T('Booksellers, Fennick Street Books', 'Книжный «Фенник-стрит»', 'Книгарня «Феннік-стріт»')),
        html: L(P('Their books sell themselves from the window — the covers alone stop people on the pavement.', 'Их книги продают себя сами с витрины — одни обложки останавливают прохожих.', 'Їхні книжки продають себе самі з вітрини — самі обкладинки зупиняють перехожих.')) }),
      K.item({ rating: 5, photo: null, name: L(T('Daria K.', 'Дарья К.', 'Дарія К.')), role: L(T('Translator', 'Переводчица', 'Перекладачка')),
        html: L(P('The translation workshop was the best Saturday of my year. I left with three pages and a friend.', 'Мастерская перевода — лучшая суббота года. Ушла с тремя страницами и подругой.', 'Майстерня перекладу — найкраща субота року. Пішла з трьома сторінками й подругою.')) }),
    ],
  })]);

  const rights = K.sec({
    anchor: 'rights', eyebrow: T('Foreign rights', 'Права на перевод', 'Права на переклад'),
    title: T('For publishers and translators', 'Для издателей и переводчиков', 'Для видавців і перекладачів'),
    lead: P('Which rights are still open, in one table. English sample translations of our Ukrainian and Russian titles are attached as PDFs.',
      'Какие права ещё свободны — в одной таблице. Пробные переводы наших украинских и русских книг на английский приложены в PDF.',
      'Які права ще вільні — в одній таблиці. Пробні переклади наших українських і російських книжок англійською додано в PDF.'),
  }, [B('collection', {
    variant: 'table', ratio: '2/3', cardAttrs: 3, details: 'none', media: 'reader', search: false, filters: ['Language'], sorts: ['$title', 'Pages'],
    items: ['roof', 'north', 'lullaby', 'paper', 'atlas', 'hours'].map(rightsRow),
  })]);

  const basket = K.sec({
    anchor: 'basket', tone: 'muted', width: 'normal', eyebrow: T('Your basket', 'Ваша корзина', 'Ваш кошик'),
    title: T('Ready when you are', 'Всё готово, когда будете готовы вы', 'Усе готово, коли будете готові ви'),
  }, [B('cart', {
    title: L(T('Books, tickets and subscriptions', 'Книги, билеты и подписки', 'Книжки, квитки й підписки')),
    text: L(P('Free delivery in the UK on orders over £30. Club subscriptions renew monthly and can be paused at any time.',
      'Бесплатная доставка по Великобритании для заказов от £30. Подписка клуба продлевается ежемесячно, её можно приостановить в любой момент.',
      'Безкоштовна доставка по Великобританії для замовлень від £30. Підписка клубу подовжується щомісяця, її можна призупинити будь-коли.')),
    form: true,
  })]);

  const contact = K.sec({
    anchor: 'contact', eyebrow: T('Write to us', 'Напишите нам', 'Напишіть нам'),
    title: T('Manuscripts, questions, bookshop orders', 'Рукописи, вопросы, заказы для магазинов', 'Рукописи, питання, замовлення для книгарень'),
  }, [B('columns', {
    gap: 48, valign: 'top',
    cols: [
      col(40, [
        B('text', { size: 'm', html: L(P('We read every manuscript we receive, usually within eight weeks. Send a synopsis and the first thirty pages; poems — up to ten.',
          'Мы читаем каждую присланную рукопись, обычно в течение восьми недель. Пришлите синопсис и первые тридцать страниц; стихи — до десяти.',
          'Ми читаємо кожен надісланий рукопис, зазвичай протягом восьми тижнів. Надішліть синопсис і перші тридцять сторінок; вірші — до десяти.')) }),
        B('contact', {
          variant: 'list', labels: true, map: null, mapHref: '',
          items: [
            K.item({ kind: 'email', value: 'hello@paperlantern.example', label: L(T('General', 'Общие вопросы', 'Загальні питання')), href: '' }),
            K.item({ kind: 'email', value: 'rights@paperlantern.example', label: L(T('Foreign rights', 'Права на перевод', 'Права на переклад')), href: '' }),
            K.item({ kind: 'phone', value: '+44 000 000 2014', label: L(T('Shop and orders', 'Магазин и заказы', 'Крамниця й замовлення')), href: '' }),
            K.item({ kind: 'address', value: '12 Ropewalk Lane\nAshby Quay AQ2 7PL', label: L(T('Shop and office', 'Магазин и офис', 'Крамниця й офіс')), href: '' }),
          ],
        }),
      ]),
      col(60, [B('form', {
        variant: 'card',
        title: L(T('Send us a manuscript or a message', 'Пришлите рукопись или сообщение', 'Надішліть рукопис або повідомлення')), submit: L(T('Send', 'Отправить', 'Надіслати')),
        req: rqSubmit.id, fallback: 'mailto', to: 'hello@paperlantern.example',
        success: L(T('Thank you — it is in our reading pile. We reply within eight weeks.', 'Спасибо — рукопись в нашей стопке для чтения. Ответим в течение восьми недель.', 'Дякуємо — рукопис у нашому стосі для читання. Відповімо протягом восьми тижнів.')),
        consent: L(T('I agree that Paper Lantern keeps my details only to answer this message.', 'Я согласен(на), что «Бумажный фонарь» хранит мои данные только для ответа на это сообщение.', 'Я погоджуюся, що «Паперовий ліхтар» зберігає мої дані лише для відповіді на це повідомлення.')),
        items: [
          field('name', 'text', T('Name', 'Имя', 'Ім’я'), { required: true, half: true }),
          field('email', 'email', T('E-mail', 'E-mail', 'E-mail'), { required: true, half: true }),
          field('kind', 'select', T('Topic', 'Тема', 'Тема'), { options: T('Manuscript\nTranslation rights\nBookshop order\nEvents\nSomething else', 'Рукопись\nПрава на перевод\nЗаказ для магазина\nВстречи\nДругое', 'Рукопис\nПрава на переклад\nЗамовлення для книгарні\nЗустрічі\nІнше') }),
          field('title', 'text', T('Working title', 'Рабочее название', 'Робоча назва'), { half: true }),
          field('words', 'number', T('Length, words', 'Объём, слов', 'Обсяг, слів'), { half: true, ph: '60000' }),
          field('message', 'textarea', T('Synopsis or message', 'Синопсис или сообщение', 'Синопсис або повідомлення'), { required: true }),
        ],
      })]),
    ],
  })]);

  // Readers' voices: one at a time, with the average rating and where each was published.
  const vt = voices.blocks[0];
  vt.variant = 'quote';
  vt.summary = true;
  vt.items.forEach((it, i) => { it.source = L([T('Club newsletter', 'Рассылка клуба', 'Розсилка клубу'), T('Bookseller letter', 'Письмо книжного магазина', 'Лист книгарні'), T('Workshop feedback', 'Отзыв о мастерской', 'Відгук про майстерню')][i % 3]); });

  // Club page: what each plan includes, and the next club night counting down.
  const compare = B('compare', {
    cols: L(T('Reader\nClub\nGift', 'Читатель\nКлуб\nПодарок', 'Читач\nКлуб\nПодарунок')), featured: 2,
    caption: L(T('What each plan includes', 'Что входит в каждый план', 'Що входить у кожен план')),
    items: [
      K.item({ label: L(T('New books', 'Новые книги', 'Нові книжки')), values: L(T('every other month\nevery month, before the shops\nthree monthly parcels', 'раз в два месяца\nкаждый месяц, раньше магазинов\nтри посылки', 'раз на два місяці\nщомісяця, раніше за крамниці\nтри посилки')), note: L(''), group: false }),
      K.item({ label: L(T('Club evenings', 'Вечера клуба', 'Вечори клубу')), values: L(T('online\nonline and upstairs at The Ropewalk\n-', 'онлайн\nонлайн и в кафе «Ропуок»\n-', 'онлайн\nонлайн і в кафе «Ропвок»\n-')), note: L(''), group: false }),
      K.item({ label: L(T('Signed bookplate', 'Подписной экслибрис', 'Підписаний екслібрис')), values: L('-\n+\n+'), note: L(''), group: false }),
      K.item({ label: L(T('Discount on the list', 'Скидка на книги', 'Знижка на книжки')), values: L('10%\n15%\n-'), note: L(''), group: false }),
    ],
  });
  const nextNight = B('countdown', {
    title: L(T('Next club night: Сад на даху', 'Следующий вечер клуба: «Сад на даху»', 'Наступний вечір клубу: «Сад на даху»')),
    date: '2026-11-05', time: '19:30', tz: 0, units: 'dhms', variant: 'cards',
    done: L(T('The evening has begun — see you at the next one.', 'Вечер уже начался — до встречи на следующем.', 'Вечір уже почався — до зустрічі на наступному.')),
  });
  club.blocks.push(B('spacer', { h: 20 }), compare);
  events.blocks.unshift(nextNight, B('spacer', { h: 24 }));
  const pageHero = (eyebrow, title, text) => B('hero', { layout: 'left', height: 'auto', eyebrow: L(eyebrow), title: L(title), text: L(text), items: [] });

  // Pages: the books (home), the club, the authors and rights, contact — and the "Not found" page.
  d.regions.main = [
    B('page', { title: L(T('Books', 'Книги', 'Книжки')), blocks: [heroB, books, lists, voices, basket] }),
    B('page', {
      slug: 'club', title: L(T('Reading club', 'Книжный клуб', 'Книжковий клуб')), navLabel: L(T('Club', 'Клуб', 'Клуб')),
      metaDesc: L(T('Club plans, evenings with authors and translators, and the next club night.', 'Планы клуба, вечера с авторами и переводчиками и ближайшая встреча.', 'Плани клубу, вечори з авторами й перекладачами та найближча зустріч.')),
      blocks: [club, events],
    }),
    B('page', {
      slug: 'authors', title: L(T('Authors & rights', 'Авторы и права', 'Автори й права')), navLabel: L(T('Authors', 'Авторы', 'Автори')),
      blocks: [pageHero(T('Authors', 'Авторы', 'Автори'), T('Eight books a year, written by people who mean every page', 'Восемь книг в год от людей, которые отвечают за каждую страницу', 'Вісім книжок на рік від людей, які відповідають за кожну сторінку'),
        P('Meet the writers and translators — and, if you publish abroad, see which rights are still open.', 'Познакомьтесь с авторами и переводчиками — и, если вы издатель, посмотрите, какие права ещё свободны.', 'Познайомтеся з авторами й перекладачами — і, якщо ви видавець, подивіться, які права ще вільні.')),
      authors, rights],
    }),
    B('page', { slug: 'contact', title: L(T('Contact', 'Контакты', 'Контакти')), blocks: [contact] }),
    V.notFoundPage ? V.notFoundPage(d, ['en', 'ru', 'uk']) : null,
  ].filter(Boolean);
  d.regions.header.find((b) => b.type === 'nav').items = [];

  const links = (rows) => '<p>' + rows.map(([h, x]) => '<a href="' + h + '">' + x + '</a>').join('<br>') + '</p>';
  d.regions.footer = [B('footer', {
    variant: 'columns', tone: 'dark', logo: brand, logoH: 40,
    brand: L(T('Paper Lantern Press', 'Издательство «Бумажный фонарь»', 'Видавництво «Паперовий ліхтар»')),
    text: L(P('Small books for long evenings. An independent publisher and reading club in Ashby Quay since 2014.', 'Небольшие книги для долгих вечеров. Независимое издательство и книжный клуб в Эшби-Ки с 2014 года.', 'Невеликі книжки для довгих вечорів. Незалежне видавництво й книжковий клуб в Ешбі-Кі з 2014 року.')),
    items: [
      K.item({ title: L(T('Books', 'Книги', 'Книжки')), html: L(T(links([['#books', 'All books'], ['#lists', 'Reading lists'], ['#rights', 'Foreign rights']]), links([['#books', 'Все книги'], ['#lists', 'Списки для чтения'], ['#rights', 'Права на перевод']]), links([['#books', 'Усі книжки'], ['#lists', 'Списки для читання'], ['#rights', 'Права на переклад']]))) }),
      K.item({ title: L(T('Club', 'Клуб', 'Клуб')), html: L(T(links([['#club', 'Subscriptions'], ['#events', 'Events'], ['#cart', 'Basket']]), links([['#club', 'Подписка'], ['#events', 'Встречи'], ['#cart', 'Корзина']]), links([['#club', 'Підписка'], ['#events', 'Зустрічі'], ['#cart', 'Кошик']]))) }),
      K.item({ title: L(T('Contact', 'Контакты', 'Контакти')), html: L(T(
        '<p>12 Ropewalk Lane, Ashby Quay<br><a href="mailto:hello@paperlantern.example">Write to us</a><br><a href="tel:+440000002014">+44 000 000 2014</a></p>',
        '<p>Ропуок-лейн, 12, Эшби-Ки<br><a href="mailto:hello@paperlantern.example">Написать нам</a><br><a href="tel:+440000002014">+44 000 000 2014</a></p>',
        '<p>Ропвок-лейн, 12, Ешбі-Кі<br><a href="mailto:hello@paperlantern.example">Написати нам</a><br><a href="tel:+440000002014">+44 000 000 2014</a></p>')) }),
    ],
    copy: L(T('© 2026 Paper Lantern Press · A fictional publisher: authors, books and samples are made up.', '© 2026 «Бумажный фонарь» · Вымышленное издательство: авторы, книги и образцы придуманы.', '© 2026 «Паперовий ліхтар» · Вигадане видавництво: автори, книжки та зразки вигадані.')),
  })];
  return V.normalizeDoc(d);
}

const TPL_BOOKS = {
  id: 'books',
  name: { en: 'Books & reading club', ru: 'Книги и книжный клуб', uk: 'Книжки й книжковий клуб', de: 'Bücher & Lesekreis', fr: 'Livres & club de lecture', es: 'Libros y club de lectura', ka: 'წიგნები და წიგნის კლუბი' },
  desc: {
    en: 'Independent publisher with a reading club: book shelf with excerpts to read in the browser, PDF samples, search and filters, cart and checkout, club subscriptions, reading lists, events with tickets, authors, foreign rights table and manuscript form.',
    ru: 'Независимое издательство с книжным клубом: полка книг с отрывками для чтения в браузере, PDF-образцы, поиск и фильтры, корзина и оформление, подписка клуба, списки для чтения, встречи с билетами, авторы, таблица прав и форма для рукописей.',
    uk: 'Незалежне видавництво з книжковим клубом: полиця книжок з уривками для читання в браузері, PDF-зразки, пошук і фільтри, кошик і оформлення, підписка клубу, списки для читання, зустрічі з квитками, автори, таблиця прав і форма для рукописів.',
    de: 'Unabhängiger Verlag mit Lesekreis: Bücherregal mit Leseproben im Browser, PDF-Proben, Suche und Filter, Warenkorb und Kasse, Club-Abos, Leselisten, Veranstaltungen mit Tickets, Autorinnen und Autoren, Lizenztabelle und Manuskriptformular.',
    fr: 'Éditeur indépendant avec club de lecture : rayon de livres avec extraits à lire dans le navigateur, extraits PDF, recherche et filtres, panier et commande, abonnements, listes de lecture, rencontres avec billets, auteurs, table des droits et formulaire de manuscrit.',
    es: 'Editorial independiente con club de lectura: estantería con fragmentos para leer en el navegador, muestras en PDF, búsqueda y filtros, carrito y pago, suscripciones, listas de lectura, eventos con entradas, autores, tabla de derechos y formulario de manuscritos.',
    ka: 'დამოუკიდებელი გამომცემლობა წიგნის კლუბით: წიგნების თარო ბრაუზერში წასაკითხი ნაწყვეტებით, PDF ნიმუშები, ძიება და ფილტრები, კალათა და შეკვეთა, კლუბის გამოწერა, საკითხავი სიები, შეხვედრები ბილეთებით, ავტორები, უფლებების ცხრილი და ხელნაწერის ფორმა.',
  },
  langs: ['en', 'ru', 'uk'],
  build: tplBuildBooks,
};

export {
  TPL_BOOKS,
  TPL_BOOKS_LIST,
  TPL_BOOKS_TEXTS,
  tplBooksBrandSVG,
  tplBooksHeroSpec,
  tplBuildBooks
};
