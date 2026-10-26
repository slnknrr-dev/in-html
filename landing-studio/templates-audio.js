// landing-studio/templates-audio.js - template "audio": an audio library of audiobooks, podcasts, lecture
// courses and bedtime stories — a catalogue with chapter / episode players and the docked mini player, series with
// their episode lists, categories, a featured listening path, narrators, plans and FAQ (en default, ru, uk; theme
// preset 'nocturne').
//
// Contract of a template module: each exported template object carries an id, localized names and build(V, ...) ->
// a fresh document; templates.js adds catalogue metadata (group, mode, modules) where the module does not declare it,
// and studio/gallery.js shows the catalogue.
// The viewer API arrives as the argument V instead of an import, so templates are pure document builders that tests
// (test.js renders every template) and the gallery can run without the editor. Generated artwork and sample data are
// derived from seeds (tplHash / tplRand where used), so a template builds the same document on every run.
// Data file: names, texts, figures and art specs dominate; comments mark sections, not individual values.
import { tplHash, tplRand } from '../sample/bytes.js';
import { tplKit } from './templates-kit.js';
import { TPL_ART_SVG } from './templates-art.js';
import { tplAgroPortrait } from './templates-agro.js';
import { tplLibCover, tplLibP, tplLibSketch, tplLibT, tplLibUl } from './templates-library.js';
// ===== Template: audio — Long Wave audio library (en default, ru, uk) =====
// Built only from the generic blocks: a series is a `collection` item whose audio files are its chapters / episodes
// (the reader feature plays them in order, with speed, ±15 s, a docked mini player and the position remembered);
// Type, Category, Narrator, Language, Episodes and Length are attributes. The sounds are short tonal sketches standing
// in for speech (labelled "sample"). All names, shows, people, numbers and e-mails are FICTIONAL.

/* ----- series (data) ----- */
// key, title (original), type, category, narrator, lang, length (total, hours first so ranges work in hours), year,
// date (release), episodes (total in the series), html, tags, cover (tplLibCover options, square), audio {root, mode,
// lead, parts: [[label, seconds]…]}.

const TPL_AUDIO_TYPE = {
  book: tplLibT('Audiobook', 'Аудиокнига', 'Аудіокнижка'),
  podcast: tplLibT('Podcast', 'Подкаст', 'Подкаст'),
  course: tplLibT('Lecture course', 'Курс лекций', 'Курс лекцій'),
  kids: tplLibT('Bedtime stories', 'Сказки на ночь', 'Казки на ніч'),
};
const TPL_AUDIO_LANG = {
  en: tplLibT('English', 'Английский', 'Англійська'),
  ru: tplLibT('Russian', 'Русский', 'Російська'),
  uk: tplLibT('Ukrainian', 'Украинский', 'Українська'),
};
const TPL_AUDIO_NARRATOR = {
  brandt: tplLibT('Elias Brandt', 'Элиас Брандт', 'Еліас Брандт'),
  okoye: tplLibT('Ruth Okoye', 'Рут Окойе', 'Рут Окойє'),
  vale: tplLibT('Henrik Vale', 'Хенрик Вейл', 'Генрік Вейл'),
  akhmerov: tplLibT('Timur Akhmerov', 'Тимур Ахмеров', 'Тимур Ахмеров'),
  deineka: tplLibT('Myroslava Deineka', 'Мирослава Дейнека', 'Мирослава Дейнека'),
};

const TPL_AUDIO_SERIES = [
  {
    key: 'weaver', title: 'The Weaver of Hollin Moor', type: 'book', narrator: 'brandt', lang: 'en', year: '2026', date: '2026-10-02', episodes: '14',
    category: tplLibT('Fiction', 'Проза', 'Проза'), length: tplLibT('9 h 20 min', '9 ч 20 мин', '9 год 20 хв'),
    html: tplLibP('On a moor where the wind never stops, a weaver keeps a loom that records the village’s secrets in its pattern. A slow, haunting novel read by Elias Brandt.',
      'На пустоши, где ветер не стихает, ткачиха хранит станок, который вплетает в узор тайны деревни. Неспешный завораживающий роман читает Элиас Брандт.',
      'На пустищі, де вітер не стихає, ткаля береже верстат, що вплітає в узор таємниці села. Неспішний заворожливий роман читає Еліас Брандт.'),
    tags: tplLibT('moor, weaving, mystery', 'пустошь, ткачество, тайна', 'пустище, ткацтво, таємниця'),
    cover: { motif: 'waves', bg: '#2a1f4a', ink: '#f3eefb', accent: '#ff7a5c', art: 'bottom', font: 'sans', fontTitle: 'serif', label: 'Audiobook' },
    audio: { root: 196, mode: 'dorian', lead: 'pluck', parts: [[tplLibT('Ch. 1 · The Loom', 'Гл. 1 · Станок', 'Розд. 1 · Верстат'), 1.3], [tplLibT('Ch. 2 · Wind from the North', 'Гл. 2 · Северный ветер', 'Розд. 2 · Північний вітер'), 1.25], [tplLibT('Ch. 3 · The Pattern', 'Гл. 3 · Узор', 'Розд. 3 · Узор'), 1.3]] },
  },
  {
    key: 'night', title: 'Night Shift', type: 'podcast', narrator: 'okoye', lang: 'en', year: '2026', date: '2026-09-25', episodes: '24',
    category: tplLibT('Society', 'Общество', 'Суспільство'), length: tplLibT('16 h 40 min', '16 ч 40 мин', '16 год 40 хв'),
    html: tplLibP('Conversations with people who work while the city sleeps: a baker, a tram driver, a lighthouse keeper, a night nurse. Season 2 is out now.',
      'Разговоры с людьми, которые работают, пока город спит: пекарь, водитель трамвая, смотритель маяка, ночная медсестра. Вышел второй сезон.',
      'Розмови з людьми, які працюють, поки місто спить: пекар, водійка трамвая, доглядач маяка, нічна медсестра. Вийшов другий сезон.'),
    tags: tplLibT('night, work, interviews', 'ночь, работа, интервью', 'ніч, робота, інтерв’ю'),
    cover: { motif: 'bars', bg: '#14112a', ink: '#efeaf8', accent: '#ff7a5c', art: 'bottom', font: 'sans', fontTitle: 'sans', label: 'Podcast · Season 2' },
    audio: { root: 220, mode: 'minor', lead: 'bell', parts: [[tplLibT('Trailer · Season 2', 'Трейлер · 2 сезон', 'Трейлер · 2 сезон'), 5], [tplLibT('Ep. 1 · The Baker', 'Вып. 1 · Пекарь', 'Вип. 1 · Пекар'), 1.25], [tplLibT('Ep. 2 · The Tram Driver', 'Вып. 2 · Водитель трамвая', 'Вип. 2 · Водійка трамвая'), 1.25]] },
  },
  {
    key: 'maps', title: 'A Short History of Maps', type: 'course', narrator: 'vale', lang: 'en', year: '2025', date: '2025-11-12', episodes: '8',
    category: tplLibT('History', 'История', 'Історія'), length: tplLibT('6 h 10 min', '6 ч 10 мин', '6 год 10 хв'),
    html: tplLibP('Eight lectures from clay tablets to satellites: how people drew the world, and how the maps drew them back. With Professor Henrik Vale.',
      'Восемь лекций — от глиняных табличек до спутников: как люди рисовали мир и как карты меняли людей. Читает профессор Хенрик Вейл.',
      'Вісім лекцій — від глиняних табличок до супутників: як люди малювали світ і як мапи змінювали людей. Читає професор Генрік Вейл.'),
    tags: tplLibT('maps, history, science', 'карты, история, наука', 'мапи, історія, наука'),
    cover: { motif: 'rings', bg: '#e9e4f7', ink: '#1b1733', accent: '#6a54e8', art: 'bottom', font: 'sans', fontTitle: 'sans', label: 'Lecture course' },
    audio: { root: 261.63, mode: 'lydian', lead: 'chime', parts: [[tplLibT('Lecture 1 · Clay and Stars', 'Лекция 1 · Глина и звёзды', 'Лекція 1 · Глина й зорі'), 1.3], [tplLibT('Lecture 2 · The Edge of the World', 'Лекция 2 · Край света', 'Лекція 2 · Край світу'), 1.25]] },
  },
  {
    key: 'river', title: 'Дом у реки', type: 'book', narrator: 'akhmerov', lang: 'ru', year: '2025', date: '2025-06-18', episodes: '11',
    category: tplLibT('Fiction', 'Проза', 'Проза'), length: tplLibT('7 h 5 min', '7 ч 5 мин', '7 год 5 хв'),
    html: tplLibP('A family summer house by a slow river, three generations and one boat that nobody admits to having sunk. Read by Timur Akhmerov.',
      'Семейная дача у медленной реки, три поколения и одна лодка, которую никто не признаётся, что утопил. Читает Тимур Ахмеров.',
      'Родинна дача біля повільної річки, три покоління й один човен, який ніхто не зізнається, що втопив. Читає Тимур Ахмеров.'),
    tags: tplLibT('family, summer, river', 'семья, лето, река', 'родина, літо, річка'),
    cover: { motif: 'peaks', bg: '#1d2a3a', ink: '#eef2f7', accent: '#ffb35c', art: 'bottom', font: 'sans', fontTitle: 'serif', label: 'Аудиокнига' },
    audio: { root: 174.61, mode: 'minor', lead: 'pluck', parts: [[tplLibT('Ch. 1 · The Jetty', 'Гл. 1 · Мостки', 'Розд. 1 · Місток'), 1.25], [tplLibT('Ch. 2 · The Boat', 'Гл. 2 · Лодка', 'Розд. 2 · Човен'), 1.3]] },
  },
  {
    key: 'tales', title: 'Казки на ніч', type: 'kids', narrator: 'deineka', lang: 'uk', year: '2026', date: '2026-08-30', episodes: '20',
    category: tplLibT('Kids', 'Детям', 'Дітям'), length: tplLibT('2 h 15 min', '2 ч 15 мин', '2 год 15 хв'),
    html: tplLibP('Short, gentle stories for the last ten minutes of the day: a hedgehog who collects echoes, a cloud that wants to be a pillow. Read by Myroslava Deineka.',
      'Короткие тихие истории для последних десяти минут дня: ёжик, который собирает эхо, облако, мечтающее стать подушкой. Читает Мирослава Дейнека.',
      'Короткі тихі історії для останніх десяти хвилин дня: їжачок, що збирає луну, хмарка, яка мріє стати подушкою. Читає Мирослава Дейнека.'),
    tags: tplLibT('bedtime, animals, calm', 'на ночь, животные, спокойствие', 'на ніч, тварини, спокій'),
    cover: { motif: 'stars', bg: '#1f1846', ink: '#f6f0ff', accent: '#ffd36b', art: 'top', font: 'sans', fontTitle: 'sans', label: 'Для дітей' },
    audio: { root: 293.66, mode: 'penta', lead: 'chime', parts: [[tplLibT('The Echo Collector', 'Собиратель эха', 'Збирач луни'), 1.3], [tplLibT('The Pillow Cloud', 'Облако-подушка', 'Хмарка-подушка'), 1.25]] },
  },
];

/* ----- pictures ----- */

/** Night horizon for the hero (1600×900): gradient sky, stars, a moon glow and a mirrored waveform along the horizon. */
function tplAudioNightSVG(o = {}) {
  const W = 1600, H = 900, rnd = tplRand(tplHash('night:' + (o.seed || 'x')));
  const N = (v) => String(Math.round(v * 10) / 10);
  let s = TPL_ART_SVG + 'viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"><defs>' +
    '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b0918"/><stop offset=".55" stop-color="#231a4d"/><stop offset="1" stop-color="#3b2366"/></linearGradient>' +
    '<radialGradient id="moon" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd2c2"/><stop offset=".25" stop-color="#ff7a5c" stop-opacity=".55"/><stop offset="1" stop-color="#ff7a5c" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a7c"/><stop offset=".5" stop-color="#8f7cff"/><stop offset="1" stop-color="#8f7cff" stop-opacity="0"/></linearGradient>' +
    '</defs><rect width="' + W + '" height="' + H + '" fill="url(#sky)"/>';
  let st = '';
  for (let i = 0; i < 140; i++) {
    const x = rnd() * W, y = rnd() * H * 0.62, r = 0.6 + rnd() * 1.6;
    st += '<circle cx="' + N(x) + '" cy="' + N(y) + '" r="' + N(r) + '" opacity="' + (0.3 + rnd() * 0.7).toFixed(2) + '"/>';
  }
  s += '<g fill="#f3eefb">' + st + '</g>';
  s += '<circle cx="1270" cy="230" r="170" fill="url(#moon)"/><circle cx="1270" cy="230" r="40" fill="#ffe2d6"/><circle cx="1288" cy="219" r="35" fill="#2a1f55" opacity=".18"/>';
  const base = H * 0.93, n = 120, gw = W / n;
  let bars = '', refl = '';
  for (let i = 0; i < n; i++) {
    const x = i * gw, env = 0.35 + 0.65 * Math.pow(Math.sin(((i + 0.5) / n) * Math.PI), 0.7);
    const h = H * 0.085 * env * (0.25 + rnd() * 0.75) + 6;
    bars += '<rect x="' + N(x + gw * 0.22) + '" y="' + N(base - h) + '" width="' + N(gw * 0.56) + '" height="' + N(h) + '" rx="' + N(gw * 0.28) + '"/>';
    refl += '<rect x="' + N(x + gw * 0.22) + '" y="' + N(base + 6) + '" width="' + N(gw * 0.56) + '" height="' + N(Math.min(h * 0.4, H - base - 8)) + '" rx="' + N(gw * 0.28) + '"/>';
  }
  s += '<g fill="url(#bar)" opacity=".9">' + bars + '</g><g fill="#8f7cff" opacity=".18">' + refl + '</g>';
  s += '<rect y="' + N(base + 2) + '" width="' + W + '" height="2" fill="#ffb3a0" opacity=".5"/>';
  return s + '</svg>';
}

/** Long Wave mark: a sine wave over a round badge (64×64). */
function tplAudioBrandSVG() {
  return TPL_ART_SVG + 'viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="31" fill="#1b1733" stroke="#8f7cff" stroke-width="2"/>' +
    '<path d="M10 34c4 0 4-12 8-12s4 20 8 20 4-26 8-26 4 30 8 30 4-18 8-18 4 6 6 6" fill="none" stroke="#ff7a5c" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function tplBuildAudio(V) {
  const K = tplKit(V, ['en', 'ru', 'uk']);
  const { B, L } = K;
  const T = tplLibT;
  const P = tplLibP;
  const img = (name, svg, title) => K.svg(name, svg, { title });
  const field = (key, type, label, o = {}) => K.item({ key, type, label: L(label), ph: L(o.ph || ''), options: L(o.options || ''), required: !!o.required, half: !!o.half });
  const sample = T('Tonal sketch in place of the recording · sample', 'Звуковой эскиз вместо записи · образец', 'Звуковий ескіз замість запису · зразок');

  // ----- pictures -----
  const brand = img('long-wave-mark.svg', tplAudioBrandSVG(), T('Long Wave mark', 'Знак «Длинной волны»', 'Знак «Довгої хвилі»'));
  const night = img('long-wave-night.svg', tplAudioNightSVG({ seed: 'longwave' }), T('A night sky over a sound wave', 'Ночное небо над звуковой волной', 'Нічне небо над звуковою хвилею'));
  const portrait = (seed, o) => img('narrator-' + seed + '.svg', tplAgroPortrait({ seed, bg: ['#2a2350', '#151230'], shirt: '#ff7a5c', shirt2: '#e2593b', collar: '#efeaf8', ...o }), '');
  const voices = {
    brandt: portrait('brandt', { skin: '#efc6a8', skin2: '#dcab88', hair: '#6d6a66', style: 'short', beard: true, shirt: '#8f7cff', shirt2: '#6f5ce0' }),
    okoye: portrait('okoye', { skin: '#7b4b33', skin2: '#683d29', hair: '#17110d', style: 'curly' }),
    vale: portrait('vale', { skin: '#f3d6c2', skin2: '#e4b99d', hair: '#e8e2d8', style: 'short', glasses: true, shirt: '#3b3366', shirt2: '#2c2650' }),
    deineka: portrait('deineka', { skin: '#f0cdb4', skin2: '#e0b394', hair: '#c47a3a', style: 'long', shirt: '#ffd36b', shirt2: '#e8b84a' }),
  };

  // ----- series: covers and episode files -----
  const S = {};
  for (const sr of TPL_AUDIO_SERIES) {
    const e = { sr, files: [] };
    e.cover = img('cover-' + sr.key + '.svg', tplLibCover({ seed: 'lw-' + sr.key, w: 600, h: 600, title: sr.title, author: TPL_AUDIO_NARRATOR[sr.narrator][sr.lang], ...sr.cover }), T('Cover: ' + sr.title, 'Обложка: ' + sr.title, 'Обкладинка: ' + sr.title));
    sr.audio.parts.forEach(([label, sec], i) => {
      const att = K.addAtt({
        name: 'long-wave-' + sr.key + '-' + String(i + 1).padStart(2, '0') + '.wav', mime: 'audio/wav',
        data: tplLibSketch({ seed: 'lw:' + sr.key + ':' + i, sec, notes: sec > 3 ? 9 : 4, root: sr.audio.root, mode: sr.audio.mode, lead: sr.audio.lead }),
        title: L(label), desc: sample,
      });
      e.files.push({ att, label: L(T(label.en + ' (sample)', label.ru + ' (образец)', label.uk + ' (зразок)')), kind: 'audio' });
    });
    S[sr.key] = e;
  }
  const A = (label, value) => ({ label: L(label), value: L(value) });
  const ATTR = {
    type: (sr) => A(T('Type', 'Тип', 'Тип'), TPL_AUDIO_TYPE[sr.type]),
    length: (sr) => A(T('Length', 'Длительность', 'Тривалість'), sr.length),
    narrator: (sr) => A(T('Narrator', 'Голос', 'Голос'), TPL_AUDIO_NARRATOR[sr.narrator]),
    category: (sr) => A(T('Category', 'Категория', 'Категорія'), sr.category),
    lang: (sr) => A(T('Language', 'Язык', 'Мова'), TPL_AUDIO_LANG[sr.lang]),
    episodes: (sr) => A(T('Episodes', 'Выпусков', 'Випусків'), sr.episodes),
    year: (sr) => A(T('Year', 'Год', 'Рік'), sr.year),
  };
  const KEYS = ['type', 'length', 'narrator', 'category', 'lang', 'episodes', 'year'];
  const entry = (key, o = {}) => {
    const e = S[key], sr = e.sr;
    return K.item({
      title: L(o.title || sr.title), subtitle: L(o.subtitle || TPL_AUDIO_NARRATOR[sr.narrator]), cover: e.cover, badge: L(o.badge || ''), html: L(o.html || sr.html), tags: L(o.tags === '' ? '' : sr.tags),
      attrs: (o.keys || KEYS).map((k) => ATTR[k](sr)), files: (o.files || e.files).map((f) => ({ ...f })), date: o.date ?? sr.date, href: '', price: null, old: null, unit: L(''), sku: '',
    });
  };

  // ----- requests -----
  const rqOrder = { id: K.id(), name: 'Subscriptions (browser storage)', method: 'POST', url: 'local:orders', headers: [], credentials: 'omit', timeout: 8000, retries: 1, itemsPath: 'items' };

  const d = K.doc({
    name: 'Long Wave — audio library', preset: 'nocturne', defaultLang: 'en',
    author: 'Long Wave',
    keywords: 'audio library, audiobooks, podcasts, lecture courses, bedtime stories, narrators, listening, subscription',
    title: T('Long Wave — audiobooks, podcasts and lectures', '«Длинная волна» — аудиокниги, подкасты и лекции', '«Довга хвиля» — аудіокнижки, подкасти й лекції'),
    description: T(
      'An audio library: audiobooks, podcasts, lecture courses and bedtime stories with chapter players, a mini player that follows you down the page, a featured listening path, narrators and plans.',
      'Аудиобиблиотека: аудиокниги, подкасты, курсы лекций и сказки на ночь с плеером глав, мини-плеер, который следует за вами по странице, маршрут прослушивания, голоса и тарифы.',
      'Аудіобібліотека: аудіокнижки, подкасти, курси лекцій і казки на ніч із плеєром розділів, міні-плеєр, що йде за вами сторінкою, маршрут слухання, голоси й тарифи.'),
    meta: { favicon: brand },
    theme: { scheme: 'dark' },
    output: { autodetect: true, switcher: 'buttons', langLabels: 'code', themeToggle: true, toolbarPos: 'nav', uiFallback: 'en', motion: 'fade', backToTop: false },
    shop: {
      currency: 'GBP', mode: 'cart', cartButton: 'auto', sync: 'local', policy: 'newest', ttlDays: 30,
      checkout: {
        method: 'request', req: rqOrder.id, fallback: 'mailto', email: 'listen@longwave.example', phone: '+44 000 000 0331', minTotal: 0,
        note: T('Your first month is free; cancel any time before it ends and you pay nothing.', 'Первый месяц бесплатно; отмените до его окончания — и ничего не заплатите.', 'Перший місяць безкоштовно; скасуйте до його завершення — і нічого не заплатите.'),
        success: T('Welcome to Long Wave! Your sign-in link is on its way.', 'Добро пожаловать на «Длинную волну»! Ссылка для входа уже в пути.', 'Ласкаво просимо на «Довгу хвилю»! Посилання для входу вже в дорозі.'),
        fields: [
          field('name', 'text', T('Name', 'Имя', 'Ім’я'), { required: true, half: true }),
          field('email', 'email', T('E-mail for sign-in', 'E-mail для входа', 'E-mail для входу'), { required: true, half: true }),
        ],
      },
    },
    requests: [rqOrder],
  });
  d.meta.ogImage = night;

  // ----- header -----
  d.regions.header = [B('nav', {
    brand: L(T('Long Wave', 'Длинная волна', 'Довга хвиля')), logo: brand, logoH: 36, sticky: true, overlay: true, variant: 'bar',
    items: [
      K.item({ label: L(T('Listen', 'Слушать', 'Слухати')), href: '#listen' }),
      K.item({ label: L(T('Series', 'Серии', 'Серії')), href: '#series' }),
      K.item({ label: L(T('Path', 'Маршрут', 'Маршрут')), href: '#path' }),
      K.item({ label: L(T('Plans', 'Тарифы', 'Тарифи')), href: '#plans' }),
    ],
    ctaLabel: L(T('Try free', 'Попробовать', 'Спробувати')), ctaHref: '#plans',
  })];

  // ----- main -----
  const hero = B('hero', {
    layout: 'center', bg: night, overlay: 15, height: 'tall', tone: 'dark',
    badge: L(T('New: Night Shift, season 2', 'Новое: «Night Shift», 2 сезон', 'Нове: «Night Shift», 2 сезон')),
    eyebrow: L(T('Audio library · audiobooks · podcasts · lectures', 'Аудиобиблиотека · книги · подкасты · лекции', 'Аудіобібліотека · книжки · подкасти · лекції')),
    title: L(T('Stories you can hear', 'Истории, которые можно услышать', 'Історії, які можна почути')),
    text: L(P('Audiobooks, podcasts, lecture courses and bedtime stories in English, Ukrainian and Russian. Press play, keep scrolling — the mini player stays with you and remembers where you stopped.',
      'Аудиокниги, подкасты, курсы лекций и сказки на ночь на английском, украинском и русском. Нажмите «Слушать» и листайте дальше — мини-плеер останется с вами и запомнит, где вы остановились.',
      'Аудіокнижки, подкасти, курси лекцій і казки на ніч англійською, українською та російською. Натисніть «Слухати» й гортайте далі — міні-плеєр залишиться з вами й запам’ятає, де ви зупинилися.')),
    items: [
      K.btn(T('Start listening', 'Начать слушать', 'Почати слухати'), '#listen', 'primary', K.icon('headphones')),
      K.btn(T('See plans', 'Тарифы', 'Тарифи'), '#plans', 'secondary'),
    ],
  });

  const cats = K.sec({ pad: 'm' }, [
    B('stats', {
      variant: 'plain', columns: 4,
      items: [
        K.item({ value: '1 200', suffix: L('+'), label: L(T('audiobooks', 'аудиокниг', 'аудіокнижок')) }),
        K.item({ value: '80', suffix: L(''), label: L(T('podcasts', 'подкастов', 'подкастів')) }),
        K.item({ value: '300', suffix: L(''), label: L(T('lectures', 'лекций', 'лекцій')) }),
        K.item({ value: '0', suffix: L(''), label: L(T('ads, ever', 'рекламы — никогда', 'реклами — ніколи')) }),
      ],
    }),
    B('spacer', { h: 24 }),
    B('features', {
      variant: 'icons', columns: 4,
      items: [
        K.item({ icon: K.icon('book'), image: null, title: L(T('Audiobooks', 'Аудиокниги', 'Аудіокнижки')), html: L(P('Novels and memoirs read whole, by voices you will want to follow from book to book.', 'Романы и мемуары целиком — голосами, за которыми хочется идти от книги к книге.', 'Романи й мемуари повністю — голосами, за якими хочеться йти від книжки до книжки.')) }),
        K.item({ icon: K.icon('chat'), image: null, title: L(T('Podcasts', 'Подкасты', 'Подкасти')), html: L(P('Conversations and documentary series, released every week, no ads in between.', 'Разговоры и документальные серии каждую неделю, без рекламы посередине.', 'Розмови й документальні серії щотижня, без реклами посередині.')) }),
        K.item({ icon: K.icon('graduation'), image: null, title: L(T('Lectures', 'Лекции', 'Лекції')), html: L(P('Short courses by people who love their subject — history, science, art, cities.', 'Короткие курсы от людей, влюблённых в свой предмет: история, наука, искусство, города.', 'Короткі курси від людей, закоханих у свій предмет: історія, наука, мистецтво, міста.')) }),
        K.item({ icon: K.icon('moon'), image: null, title: L(T('For kids', 'Детям', 'Дітям')), html: L(P('Gentle bedtime stories with a sleep timer and no surprises at the end.', 'Тихие сказки на ночь с таймером сна и без сюрпризов в конце.', 'Тихі казки на ніч із таймером сну й без сюрпризів наприкінці.')) }),
      ],
    }),
  ]);

  const listen = K.sec({
    anchor: 'listen', tone: 'muted', width: 'wide',
    eyebrow: T('Listen now', 'Слушать сейчас', 'Слухати зараз'),
    title: T('Press play on anything', 'Включайте что угодно', 'Вмикайте будь-що'),
    lead: P('Every series opens a player with its chapters or episodes, speed control and ±15 seconds. On this demo page each chapter is a short tonal sample instead of a voice.',
      'Каждая серия открывает плеер с главами или выпусками, скоростью и перемоткой на 15 секунд. На этой демонстрационной странице вместо голоса — короткий звуковой образец.',
      'Кожна серія відкриває плеєр із розділами чи випусками, швидкістю й перемоткою на 15 секунд. На цій демонстраційній сторінці замість голосу — короткий звуковий зразок.'),
  }, [B('collection', {
    variant: 'grid', columns: 3, ratio: '1/1', cardAttrs: 2, details: 'modal', media: 'reader',
    search: true, filters: ['Type', 'Category', 'Language', 'Narrator'], ranges: ['Length'], sorts: ['$date', '$title', 'Length'],
    empty: L(T('Nothing to play with these filters — try another category.', 'С такими фильтрами слушать нечего — попробуйте другую категорию.', 'З такими фільтрами слухати нічого — спробуйте іншу категорію.')),
    items: TPL_AUDIO_SERIES.map((sr) => entry(sr.key)),
  })]);

  const series = K.sec({
    anchor: 'series', eyebrow: T('Series & episodes', 'Серии и выпуски', 'Серії й випуски'),
    title: T('Follow a show from the first episode', 'Слушайте шоу с первого выпуска', 'Слухайте шоу з першого випуску'),
    lead: P('Episodes play one after another; close the player and the mini player docks at the bottom of the page.',
      'Выпуски играют один за другим; закройте плеер — и мини-плеер закрепится внизу страницы.',
      'Випуски грають один за одним; закрийте плеєр — і міні-плеєр закріпиться внизу сторінки.'),
  }, [B('collection', {
    variant: 'list', ratio: '1/1', cardAttrs: 3, details: 'none', media: 'reader',
    items: [
      entry('night', { keys: ['type', 'episodes', 'length', 'narrator', 'category', 'lang', 'year'], date: '' }),
      entry('maps', { keys: ['type', 'episodes', 'length', 'narrator', 'category', 'lang', 'year'], date: '' }),
    ],
  })]);

  // Wide episode art (the series' colours, the episode's name) for the path cards.
  const wideArt = (key, fi) => {
    const sr = S[key].sr, part = sr.audio.parts[fi][0];
    return img('path-' + key + '-' + (fi + 1) + '.svg', tplLibCover({ ...sr.cover, seed: 'lw-path-' + key + fi, w: 800, h: 450, art: 'right', title: sr.title, label: part[sr.lang] || part.en, author: TPL_AUDIO_NARRATOR[sr.narrator][sr.lang] }),
      T(sr.title + ' — ' + part.en, sr.title + ' — ' + part.ru, sr.title + ' — ' + part.uk));
  };
  const step = (n, key, fi, title, html) => ({
    ...entry(key, { badge: T('Step ' + n, 'Шаг ' + n, 'Крок ' + n), title, html, files: [S[key].files[fi]], keys: ['type', 'narrator'], date: '', tags: '' }),
    cover: wideArt(key, fi),
  });
  const path = K.sec({
    anchor: 'path', tone: 'dark', eyebrow: T('Featured listening path', 'Маршрут недели', 'Маршрут тижня'),
    title: T('An evening in four sounds', 'Вечер в четырёх звуках', 'Вечір у чотирьох звуках'),
    lead: P('Our editors’ route through the library this week: one story, one voice from the night, one idea and one lullaby.',
      'Маршрут наших редакторов по библиотеке на этой неделе: одна история, один голос из ночи, одна идея и одна колыбельная.',
      'Маршрут наших редакторів бібліотекою цього тижня: одна історія, один голос із ночі, одна ідея й одна колискова.'),
  }, [B('collection', {
    variant: 'feature', columns: 3, ratio: '16/9', cardAttrs: 2, details: 'none', media: 'reader',
    items: [
      step(1, 'weaver', 0, T('Begin with a story: The Weaver of Hollin Moor', 'Начните с истории: «The Weaver of Hollin Moor»', 'Почніть з історії: «The Weaver of Hollin Moor»'),
        P('Chapter one sets the loom going and the wind blowing. Ten quiet minutes that pull you in.', 'Первая глава запускает станок и ветер. Десять тихих минут, которые затягивают.', 'Перший розділ запускає верстат і вітер. Десять тихих хвилин, які затягують.')),
      step(2, 'night', 0, T('A voice from the night', 'Голос из ночи', 'Голос із ночі'),
        P('The Night Shift trailer: who works while you sleep.', 'Трейлер «Night Shift»: кто работает, пока вы спите.', 'Трейлер «Night Shift»: хто працює, поки ви спите.')),
      step(3, 'maps', 0, T('One idea: clay and stars', 'Одна идея: глина и звёзды', 'Одна ідея: глина й зорі'),
        P('The first map was drawn on wet clay.', 'Первую карту нарисовали на сырой глине.', 'Першу мапу намалювали на вогкій глині.')),
      step(4, 'tales', 0, T('And a lullaby', 'И колыбельная', 'І колискова'),
        P('The Echo Collector, for the last ten minutes of the day.', '«Собиратель эха» — для последних десяти минут дня.', '«Збирач луни» — для останніх десяти хвилин дня.')),
    ],
  })]);

  const member = (photo, name, role, html) => K.item({ photo, name: L(name), role: L(role), html: L(html), href: '' });
  const narrators = K.sec({
    anchor: 'voices', align: 'center', eyebrow: T('Narrators', 'Голоса', 'Голоси'), title: T('Voices worth following', 'Голоса, за которыми хочется идти', 'Голоси, за якими хочеться йти'),
  }, [B('team', {
    variant: 'cards', columns: 4,
    items: [
      member(voices.brandt, TPL_AUDIO_NARRATOR.brandt, T('Audiobooks & drama', 'Аудиокниги и драма', 'Аудіокнижки й драма'),
        P('A former stage actor with a voice like a wool blanket; reads our long novels.', 'Бывший театральный актёр с голосом, как шерстяной плед; читает наши длинные романы.', 'Колишній театральний актор із голосом, як вовняний плед; читає наші довгі романи.')),
      member(voices.okoye, TPL_AUDIO_NARRATOR.okoye, T('Host · Night Shift', 'Ведущая · «Night Shift»', 'Ведуча · «Night Shift»'),
        P('Radio journalist who has interviewed two hundred people between midnight and six.', 'Радиожурналистка, взявшая интервью у двухсот человек между полуночью и шестью.', 'Радіожурналістка, яка взяла інтерв’ю у двохсот людей між північчю й шостою.')),
      member(voices.vale, TPL_AUDIO_NARRATOR.vale, T('Lecturer · A Short History of Maps', 'Лектор · «A Short History of Maps»', 'Лектор · «A Short History of Maps»'),
        P('Cartographer and teacher; has never once used a satnav.', 'Картограф и преподаватель; ни разу в жизни не пользовался навигатором.', 'Картограф і викладач; жодного разу не користувався навігатором.')),
      member(voices.deineka, TPL_AUDIO_NARRATOR.deineka, T('Bedtime stories', 'Сказки на ночь', 'Казки на ніч'),
        P('Reads in Ukrainian slowly enough for eyelids to close by the second page.', 'Читает по-украински так неспешно, что глаза закрываются ко второй странице.', 'Читає українською так неспішно, що очі заплющуються до другої сторінки.')),
    ],
  })]);

  const plan = (name, price, period, featured, sku, label, href, html) => K.item({ name: L(name), price, period: L(period), featured, label: L(label), href, sku, html: L(html) });
  const month = T('month', 'месяц', 'місяць');
  const plans = K.sec({
    anchor: 'plans', tone: 'muted', align: 'center', eyebrow: T('Plans', 'Тарифы', 'Тарифи'),
    title: T('Listen free, or listen to everything', 'Слушайте бесплатно — или слушайте всё', 'Слухайте безкоштовно — або слухайте все'),
    lead: P('Podcasts and samples are free for everyone. Plans open the whole library; the first month is on us.',
      'Подкасты и образцы бесплатны для всех. Тарифы открывают всю библиотеку; первый месяц — за наш счёт.',
      'Подкасти й зразки безкоштовні для всіх. Тарифи відкривають усю бібліотеку; перший місяць — за наш рахунок.'),
  }, [B('pricing', {
    columns: 3,
    items: [
      plan(T('Free', 'Бесплатно', 'Безкоштовно'), 0, month, false, '', T('Start listening', 'Начать слушать', 'Почати слухати'), '#listen',
        tplLibUl(['All podcasts', 'First chapter of every book', 'Mini player and bookmarks'], ['Все подкасты', 'Первая глава каждой книги', 'Мини-плеер и закладки'], ['Усі подкасти', 'Перший розділ кожної книжки', 'Міні-плеєр і закладки'])),
      plan(T('Listener', 'Слушатель', 'Слухач'), 7.99, month, true, 'lw-listener-monthly', T('Try a month free', 'Месяц бесплатно', 'Місяць безкоштовно'), '',
        tplLibUl(['The whole library', 'Offline listening in the app', 'Speed, sleep timer, chapters', 'No ads, ever'], ['Вся библиотека', 'Офлайн-прослушивание в приложении', 'Скорость, таймер сна, главы', 'Никакой рекламы'], ['Уся бібліотека', 'Офлайн-слухання в застосунку', 'Швидкість, таймер сну, розділи', 'Жодної реклами'])),
      plan(T('Family', 'Семейный', 'Родинний'), 11.99, month, false, 'lw-family-monthly', T('Try a month free', 'Месяц бесплатно', 'Місяць безкоштовно'), '',
        tplLibUl(['Up to five listeners', 'Separate bookmarks for everyone', 'Kids’ profile with bedtime mode'], ['До пяти слушателей', 'У каждого свои закладки', 'Детский профиль с режимом сна'], ['До п’яти слухачів', 'У кожного свої закладки', 'Дитячий профіль із режимом сну'])),
    ],
  })]);

  const faqItems = [
    [T('Why do the chapters here sound like music?', 'Почему главы здесь звучат как музыка?', 'Чому розділи тут звучать як музика?'),
      P('This page is a demo: each chapter is a short tonal sample standing in for the recording. In the library you hear the real narration; the player works exactly the same way.', 'Это демонстрационная страница: каждая глава — короткий звуковой образец вместо записи. В библиотеке звучит настоящая начитка, плеер работает так же.', 'Це демонстраційна сторінка: кожен розділ — короткий звуковий зразок замість запису. У бібліотеці звучить справжня начитка, плеєр працює так само.')],
    [T('Will it remember where I stopped?', 'Запомнит ли он, где я остановился?', 'Чи запам’ятає він, де я зупинився?'),
      P('Yes. Each series remembers its chapter and position on this device; press play again and it carries on.', 'Да. Каждая серия помнит главу и место на этом устройстве; нажмите «Слушать» снова — и она продолжится.', 'Так. Кожна серія пам’ятає розділ і місце на цьому пристрої; натисніть «Слухати» знову — і вона продовжиться.')],
    [T('Can I keep listening while I scroll?', 'Можно слушать, пока листаю страницу?', 'Чи можна слухати, поки гортаю сторінку?'),
      P('Close the player while it plays and a mini player docks at the bottom of the page — tap it to return to the chapters.', 'Закройте плеер во время воспроизведения — внизу страницы закрепится мини-плеер; нажмите на него, чтобы вернуться к главам.', 'Закрийте плеєр під час відтворення — унизу сторінки закріпиться міні-плеєр; натисніть на нього, щоб повернутися до розділів.')],
    [T('Can I change the speed?', 'Можно менять скорость?', 'Чи можна змінювати швидкість?'),
      P('From 0.75× to 2×, and ±15 seconds with one tap. The speed you choose is kept for next time.', 'От 0,75× до 2× и ±15 секунд одним нажатием. Выбранная скорость сохраняется.', 'Від 0,75× до 2× і ±15 секунд одним дотиком. Обрана швидкість зберігається.')],
    [T('How do I cancel?', 'Как отменить подписку?', 'Як скасувати підписку?'),
      P('Any time, in two clicks, from your account. If you cancel in the first month you pay nothing.', 'В любой момент, в два клика, в личном кабинете. Отмена в первый месяц — бесплатно.', 'Будь-коли, у два кліки, в особистому кабінеті. Скасування в перший місяць — безкоштовно.')],
  ];
  const faq = K.sec({
    anchor: 'faq', width: 'narrow', eyebrow: T('FAQ', 'Вопросы', 'Питання'), title: T('Before you press play', 'Прежде чем нажать «Слушать»', 'Перш ніж натиснути «Слухати»'),
  }, [B('faq', { variant: 'details', openFirst: true, items: faqItems.map(([q, a]) => K.item({ q: L(q), html: L(a) })) })]);

  const cta = B('cta', {
    variant: 'card', tone: 'accent',
    title: L(T('Give a month of listening', 'Подарите месяц слушания', 'Подаруйте місяць слухання')),
    html: L(P('A gift code arrives by e-mail with a card you can print. They choose the stories; we keep the voices coming.', 'Подарочный код придёт на e-mail вместе с открыткой для печати. Истории выберут они, голоса — за нами.', 'Подарунковий код прийде на e-mail разом із листівкою для друку. Історії оберуть вони, голоси — за нами.')),
    items: [K.btn(T('Choose a plan', 'Выбрать тариф', 'Обрати тариф'), '#plans', 'primary', K.icon('gift'))],
  });

  d.regions.main = [hero, cats, listen, series, path, narrators, plans, faq, cta];

  const links = (rows) => '<p>' + rows.map(([h, x]) => '<a href="' + h + '">' + x + '</a>').join('<br>') + '</p>';
  d.regions.footer = [B('footer', {
    variant: 'columns', tone: 'auto', logo: brand, logoH: 40,
    brand: L(T('Long Wave', 'Длинная волна', 'Довга хвиля')),
    text: L(P('An audio library for long evenings and short commutes.', 'Аудиобиблиотека для долгих вечеров и коротких поездок.', 'Аудіобібліотека для довгих вечорів і коротких поїздок.')),
    items: [
      K.item({ title: L(T('Listen', 'Слушать', 'Слухати')), html: L(T(links([['#listen', 'Catalogue'], ['#series', 'Series'], ['#path', 'Listening path']]), links([['#listen', 'Каталог'], ['#series', 'Серии'], ['#path', 'Маршрут']]), links([['#listen', 'Каталог'], ['#series', 'Серії'], ['#path', 'Маршрут']]))) }),
      K.item({ title: L(T('Long Wave', 'Длинная волна', 'Довга хвиля')), html: L(T(links([['#voices', 'Narrators'], ['#plans', 'Plans'], ['#faq', 'FAQ']]), links([['#voices', 'Голоса'], ['#plans', 'Тарифы'], ['#faq', 'Вопросы']]), links([['#voices', 'Голоси'], ['#plans', 'Тарифи'], ['#faq', 'Питання']]))) }),
      K.item({ title: L(T('Contact', 'Контакты', 'Контакти')), html: L(T(
        '<p><a href="mailto:listen@longwave.example">Write to us</a><br><a href="tel:+440000000331">+44 000 000 0331</a></p>',
        '<p><a href="mailto:listen@longwave.example">Написать нам</a><br><a href="tel:+440000000331">+44 000 000 0331</a></p>',
        '<p><a href="mailto:listen@longwave.example">Написати нам</a><br><a href="tel:+440000000331">+44 000 000 0331</a></p>')) }),
    ],
    copy: L(T('© 2026 Long Wave · A fictional audio library: shows, voices and samples are made up.', '© 2026 «Длинная волна» · Вымышленная аудиобиблиотека: шоу, голоса и образцы придуманы.', '© 2026 «Довга хвиля» · Вигадана аудіобібліотека: шоу, голоси та зразки вигадані.')),
  })];
  return V.normalizeDoc(d);
}

const TPL_AUDIO = {
  id: 'audio',
  name: { en: 'Audio library', ru: 'Аудиобиблиотека', uk: 'Аудіобібліотека', de: 'Hörbibliothek', fr: 'Audiothèque', es: 'Audioteca', ka: 'აუდიობიბლიოთეკა' },
  desc: {
    en: 'Audio library of audiobooks, podcasts, lectures and bedtime stories: catalogue with search, filters and sorting, chapter player with speed and ±15 s, docked mini player that remembers your place, series with episode lists, a featured listening path, narrators, plans and FAQ.',
    ru: 'Аудиобиблиотека аудиокниг, подкастов, лекций и сказок: каталог с поиском, фильтрами и сортировкой, плеер глав со скоростью и ±15 с, мини-плеер, запоминающий место, серии со списками выпусков, маршрут прослушивания, голоса, тарифы и FAQ.',
    uk: 'Аудіобібліотека аудіокнижок, подкастів, лекцій і казок: каталог із пошуком, фільтрами й сортуванням, плеєр розділів зі швидкістю та ±15 с, міні-плеєр, що пам’ятає місце, серії зі списками випусків, маршрут слухання, голоси, тарифи й FAQ.',
    de: 'Hörbibliothek mit Hörbüchern, Podcasts, Vorlesungen und Gute-Nacht-Geschichten: Katalog mit Suche, Filtern und Sortierung, Kapitel-Player mit Tempo und ±15 s, angedockter Mini-Player mit Merkposition, Serien mit Folgenlisten, Hörpfad, Sprecher, Tarife und FAQ.',
    fr: 'Audiothèque de livres audio, podcasts, cours et histoires du soir : catalogue avec recherche, filtres et tri, lecteur de chapitres avec vitesse et ±15 s, mini-lecteur ancré qui retient la position, séries et épisodes, parcours d’écoute, voix, offres et FAQ.',
    es: 'Audioteca de audiolibros, pódcasts, cursos y cuentos para dormir: catálogo con búsqueda, filtros y orden, reproductor de capítulos con velocidad y ±15 s, minirreproductor anclado que recuerda la posición, series y episodios, ruta de escucha, voces, planes y FAQ.',
    ka: 'აუდიობიბლიოთეკა — აუდიოწიგნები, პოდკასტები, ლექციები და ზღაპრები: კატალოგი ძიებით, ფილტრებითა და დალაგებით, თავების პლეერი სიჩქარითა და ±15 წმ-ით, მიმაგრებული მინი-პლეერი, რომელიც ადგილს იმახსოვრებს, სერიები ეპიზოდებით, მოსმენის მარშრუტი, ხმები, ტარიფები და FAQ.',
  },
  langs: ['en', 'ru', 'uk'],
  build: tplBuildAudio,
};

export {
  TPL_AUDIO,
  TPL_AUDIO_SERIES,
  tplAudioBrandSVG,
  tplAudioNightSVG,
  tplBuildAudio
};
