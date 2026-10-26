// site-studio/templates-backend.js - Site Studio templates of the group "Backend site": sites with their own server
// (backend exports): accounts with sign-in by password or e-mail link, roles, closed sections, content collections the
// admin console edits (news, products, units, rooms, courses), orders, bookings, RSVP and chat.
// Every name, address, price and figure is FICTIONAL.
//
// Contract of a template module: each exported template object carries an id, localized names and build(V, ...) ->
// a fresh document; templates.js adds catalogue metadata (group, mode, modules) where the module does not declare it,
// and studio/gallery.js shows the catalogue.
// The viewer API arrives as the argument V instead of an import, so templates are pure document builders that tests
// (test.js renders every template) and the gallery can run without the editor. Generated artwork and sample data are
// derived from seeds (tplHash / tplRand where used), so a template builds the same document on every run.
// Data file: names, texts, figures and art specs dominate; comments mark sections, not individual values.
import { siteKit } from './templates-site-kit.js';
import { both } from './templates-landing2.js';

// Header with the account entry; the account pages every backend template shares.
function accountPages(K, o = {}) {
  const { B, L, T, P, page, sec } = K;
  return [
    page('account', T('Account', 'Кабинет'), [
      sec({ width: 'narrow' }, [B('account', { view: 'profile', title: L(T('Your account', 'Ваш кабинет')) })]),
      ...(o.profileExtra || []),
    ], { access: 'members', nav: o.navAccount !== false }),
    page('sign-in', T('Sign in', 'Вход'), [
      sec({ width: 'narrow' }, [B('account', { view: 'signin', title: L(T('Sign in', 'Вход')), after: '#/account' })]),
      sec({ width: 'narrow' }, [K.text(P('No account yet? <a href="#/sign-up">Create one</a> — it takes a minute.', 'Ещё нет аккаунта? <a href="#/sign-up">Создайте</a> — это минута.'))]),
    ], { nav: false }),
    page('sign-up', T('Create an account', 'Регистрация'), [
      sec({ width: 'narrow' }, [B('account', { view: 'signup', title: L(T('Create an account', 'Регистрация')), after: '#/account' })]),
    ], { nav: false }),
  ];
}

/* ---------- regional portal ---------- */

function tplBuildRegion(V) {
  const K = siteKit(V);
  const { B, L, T, P, art, item, page, sec } = K;
  const hero = art.scene('region-hero', { seed: 'imereti', pal: 'forest', motif: 'hills' });
  const news = ['road', 'market', 'school', 'wine'].map((s, i) => art.card('news-' + s, { seed: s, pal: ['forest', 'clay', 'ink', 'rose'][i], glyph: ['🛣', '🧺', '🏫', '🍇'][i] }));
  const reqPost = K.req('Requests of residents', 'local:requests');
  const reqIdea = K.req('Ideas for the region', 'local:ideas');
  const d = K.doc({ name: 'Imereti Hub — regional portal', preset: 'counsel', theme: { accent: '#2f6b45', accent2: '#d9a441', scheme: 'auto' },
    title: T('Imereti Hub — news, services and people of the region', 'Имерети-Хаб — новости, услуги и люди региона'),
    description: T('Regional portal: news the editors publish online, a directory of services, residents’ requests and a members’ area.', 'Региональный портал: новости, которые редакция публикует онлайн, справочник услуг, заявки жителей и раздел для участников.'),
    output: { switcher: 'buttons', langLabels: 'code', themeToggle: true, backToTop: true } });
  d.requests = K.requests;
  d.auth = { signup: 'open', password: true, link: true, defaultRole: 'member', roles: [{ id: 'editor', name: { en: 'Editor', ru: 'Редактор' }, parent: 'member' }, { id: 'moderator', name: { en: 'Moderator', ru: 'Модератор' }, parent: 'editor' }] };
  d.regions.header = [B('nav', { brand: L('Imereti Hub'), variant: 'bar', sticky: true, pages: true, items: [], ctaLabel: L(T('Sign in', 'Войти')), ctaHref: '#/sign-in' })];
  const newsItem = (att, date, en, ru, den, dru, tag) => item({ cover: att, title: T(en, ru), date, html: P(den, dru), tags: L(tag), subtitle: L('') });
  const newsList = [
    newsItem(news[0], '2026-10-20', 'The Kutaisi bypass opens in December', 'Объезд Кутаиси откроют в декабре', 'Twelve kilometres of new road take trucks out of the old town.', 'Двенадцать километров новой дороги уведут грузовики из старого города.', 'Roads'),
    newsItem(news[1], '2026-10-18', 'Farmers’ market moves to Sunday', 'Фермерский рынок переезжает на воскресенье', 'Sixty stalls in the Green Bazaar every Sunday from 8 to 14.', 'Шестьдесят прилавков на Зелёном базаре каждое воскресенье с 8 до 14.', 'City'),
    newsItem(news[2], '2026-10-15', 'Two village schools get a lab', 'Две сельские школы получили лабораторию', 'Physics and chemistry kits for Tskaltubo and Terjola.', 'Наборы по физике и химии для Цхалтубо и Тержолы.', 'Education'),
    newsItem(news[3], '2026-10-11', 'Harvest festival in Baghdati', 'Праздник урожая в Багдати', 'Wine, folk dance and a cheese contest on 25 October.', 'Вино, народные танцы и конкурс сыра 25 октября.', 'Culture'),
  ];
  d.regions.main = [
    page('', T('Home', 'Главная'), [
      B('hero', { layout: 'split', media: hero, eyebrow: L(T('Kutaisi · Zestafoni · Tkibuli · Sachkhere', 'Кутаиси · Зестафони · Ткибули · Сачхере')), title: L(T('Everything about our region in one place', 'Всё о нашем регионе в одном месте')),
        text: L(P('News from the editors, a directory of services, requests of residents and a members’ area for volunteers.', 'Новости редакции, справочник услуг, заявки жителей и раздел для волонтёров.')),
        items: [K.btn(T('Latest news', 'Свежие новости'), '#/news', 'primary'), K.btn(T('Post a request', 'Оставить заявку'), '#/requests', 'secondary')] }),
      sec({ title: T('Latest news', 'Свежие новости') }, [B('collection', { source: 'news', variant: 'grid', columns: 3, ratio: '16/9', search: false, details: true, items: [
        newsItem(news[0], '2026-10-20', 'The Kutaisi bypass opens in December', 'Объезд Кутаиси откроют в декабре', 'Twelve kilometres of new road take trucks out of the old town.', 'Двенадцать километров новой дороги уведут грузовики из старого города.', 'Roads'),
        newsItem(news[1], '2026-10-18', 'Farmers’ market moves to Sunday', 'Фермерский рынок переезжает на воскресенье', 'Sixty stalls in the Green Bazaar every Sunday from 8 to 14.', 'Шестьдесят прилавков на Зелёном базаре каждое воскресенье с 8 до 14.', 'City'),
        newsItem(news[2], '2026-10-15', 'Two village schools get a lab', 'Две сельские школы получили лабораторию', 'Physics and chemistry kits for Tskaltubo and Terjola.', 'Наборы по физике и химии для Цхалтубо и Тержолы.', 'Education'),
        newsItem(news[3], '2026-10-11', 'Harvest festival in Baghdati', 'Праздник урожая в Багдати', 'Wine, folk dance and a cheese contest on 25 October.', 'Вино, народные танцы и конкурс сыра 25 октября.', 'Culture')] })]),
      sec({ title: T('Find anything', 'Найти что угодно'), tone: 'muted' }, [B('finder', { title: L(T('Search the portal', 'Поиск по порталу')) })]),
    ]),
    page('news', T('News', 'Новости'), [
      sec({ title: T('News of the region', 'Новости региона'), lead: T('Editors add articles in the admin console (Content → news); the site updates by itself.', 'Редакция добавляет статьи в админке (Содержимое → news); сайт обновляется сам.') }, [
        B('collection', { source: 'news', variant: 'list', search: true, details: true, items: newsList.map((x) => ({ ...x, id: K.id() })) })]),
    ]),
    page('services', T('Services', 'Услуги'), [
      sec({ title: T('Directory', 'Справочник') }, [B('directory', { title: L(T('Services and specialists', 'Услуги и специалисты')), variant: 'cards', columns: 3, find: true, tabs: true, items: [
        item({ kind: 'organisation', name: L(T('Kutaisi Public Service Hall', 'Дом юстиции Кутаиси')), areas: L(T('Documents, registry', 'Документы, реестр')), city: L(T('Kutaisi', 'Кутаиси')), verified: true, phone: '+995 431 00 00 00' }),
        item({ kind: 'person', name: L('Dr. Tamar Japaridze'), role: L(T('Family doctor', 'Семейный врач')), areas: L(T('Health', 'Здоровье')), city: L(T('Zestafoni', 'Зестафони')), rating: 4.8, reviews: 31 }),
        item({ kind: 'firm', name: L('Rioni Transport'), areas: L(T('Buses, freight', 'Автобусы, грузы')), city: L(T('Kutaisi', 'Кутаиси')), isNew: true })] })]),
    ]),
    page('requests', T('Requests', 'Заявки'), [
      sec({ title: T('Requests of residents', 'Заявки жителей') }, [B('board', { title: L(T('What people need', 'Что нужно людям')), variant: 'cards', find: true, items: [
        item({ title: L(T('Street lights on Tamar Mepe street', 'Фонари на улице Тамар Мепе')), body: L(T('Six lamps are out since September.', 'Шесть фонарей не горят с сентября.')), category: L(T('City', 'Город')), city: L(T('Kutaisi', 'Кутаиси')), posted: '2026-10-12', closes: '2026-11-30', status: 'open' }),
        item({ title: L(T('Volunteers for the river clean-up', 'Волонтёры для уборки реки')), body: L(T('Saturday 9:00, gloves and bags provided.', 'Суббота 9:00, перчатки и мешки выдаём.')), category: L(T('Ecology', 'Экология')), city: L(T('Tkibuli', 'Ткибули')), posted: '2026-10-16', closes: '2026-11-08', status: 'open' })] })]),
      sec({ title: T('Post a request', 'Оставить заявку'), width: 'narrow', tone: 'muted' }, [B('form', { req: reqPost, fallback: 'outbox' })]),
    ]),
    page('volunteers', T('Volunteers', 'Волонтёрам'), [
      sec({ title: T('Volunteer desk', 'Волонтёрский штаб'), lead: T('Only for signed-in members of the portal.', 'Только для участников портала, вошедших в аккаунт.') }, [
        B('checklist', { title: L(T('Before a clean-up', 'Перед уборкой')), persist: true, progress: true, items: [item({ label: L(T('Check the weather', 'Проверить погоду')) }), item({ label: L(T('Pick up gloves and bags', 'Забрать перчатки и мешки')) }), item({ label: L(T('Send photos after', 'Прислать фото после')) })] }),
        B('form', { title: L(T('Suggest an idea', 'Предложить идею')), req: reqIdea, fallback: 'outbox' })]),
    ], { access: 'members' }),
    page('editors', T('Editors', 'Редакции'), [
      sec({ title: T('Editors’ room', 'Комната редакции') }, [
        B('markdown', { text: T('## How we publish\n\n1. Write the article in **Admin → Content → news**.\n2. Add a cover (16:9) and a tag.\n3. Save — the site is rebuilt at once.\n\n> [!IMPORTANT]\n> Moderators check requests every morning.', '## Как мы публикуем\n\n1. Пишем статью в **Админке → Содержимое → news**.\n2. Добавляем обложку (16:9) и тег.\n3. Сохраняем — сайт пересобирается сразу.\n\n> [!IMPORTANT]\n> Модераторы проверяют заявки каждое утро.') }),
        B('diagram', { mode: 'text', src: 'flowchart LR\n  R[Resident] -->|request| M{Moderator}\n  M -->|ok| B[Board]\n  M -->|spam| X[Deleted]\n  E[Editor] -->|article| N[News]' })]),
    ], { access: 'roles', roles: 'editor' }),
    ...accountPages(K),
    V.notFoundPage(d, K.langs),
  ];
  d.regions.footer = [B('footer', { variant: 'columns', tone: 'dark', brand: L('Imereti Hub'), text: L(P('A fictional regional portal built with Site Studio.', 'Вымышленный региональный портал, сделанный в «Студии сайтов».')),
    items: [item({ title: T('Portal', 'Портал'), html: K.links([['#/news', T('News', 'Новости')], ['#/services', T('Services', 'Услуги')], ['#/requests', T('Requests', 'Заявки')]]) }),
      item({ title: T('Members', 'Участникам'), html: K.links([['#/sign-in', T('Sign in', 'Вход')], ['#/sign-up', T('Create an account', 'Регистрация')], ['#/volunteers', T('Volunteers', 'Волонтёрам')]]) })],
    copy: L(T('© 2026 Imereti Hub · fictional demo', '© 2026 Имерети-Хаб · вымышленный пример')) })];
  return V.normalizeDoc(d);
}

/* ---------- online store ---------- */

function tplBuildStore(V) {
  const K = siteKit(V);
  const { B, L, T, P, art, item, page, sec } = K;
  const hero = art.scene('store-hero', { seed: 'kitchen', pal: 'clay', motif: 'shop' });
  const pics = ['knife', 'board', 'pan', 'pot', 'kettle', 'set'].map((s, i) => art.card('kw-' + s, { seed: s, pal: i % 2 ? 'clay' : 'ink', glyph: ['🔪', '🪵', '🍳', '🍲', '🫖', '🎁'][i] }));
  const orders = K.req('Orders', 'local:orders');
  const sync = K.req('Cart of the account', 'local:carts/{cartId}', 'PUT');
  const load = K.req('Load the cart', 'local:carts/{cartId}', 'GET');
  const d = K.doc({ name: 'Kitchen Works — online store', preset: 'forge', theme: { scheme: 'auto' },
    title: T('Kitchen Works — tools for home cooks', 'Kitchen Works — инструменты для домашних поваров'),
    description: T('Online store with a catalogue the admin edits, stock, a cart that follows the account and orders kept on the server.', 'Интернет-магазин: каталог, который правят в админке, остатки, корзина, привязанная к аккаунту, и заказы на сервере.'),
    shop: { currency: 'GEL', mode: 'cart', cartButton: 'auto', sync: 'remote', loadReq: load, saveReq: sync, policy: 'merge', checkout: { method: 'request', req: orders, fallback: 'mailto', email: 'orders@kitchenworks.example', minTotal: 30 } } });
  d.requests = K.requests;
  d.auth = { signup: 'open', password: true, link: true, defaultRole: 'member', roles: [{ id: 'wholesale', name: { en: 'Wholesale buyer', ru: 'Оптовый покупатель' }, parent: 'member' }] };
  const prod = (sku, att, en, ru, price, old, stock, den, dru) => item({ sku, image: att, name: T(en, ru), price, old, stock, html: P(den, dru), min: 1, step: 1, unit: L('') });
  d.regions.header = [B('nav', { brand: L('Kitchen Works'), variant: 'bar', sticky: true, pages: true, items: [], ctaLabel: L(T('Account', 'Кабинет')), ctaHref: '#/account' })];
  d.regions.main = [
    page('', T('Store', 'Магазин'), [
      B('hero', { layout: 'split', media: hero, eyebrow: L(T('Free delivery from 150 GEL', 'Бесплатная доставка от 150 лари')), title: L(T('Tools that last a lifetime', 'Инструменты на всю жизнь')),
        text: L(P('Forged knives, oak boards and cast iron — tested in our own kitchen.', 'Кованые ножи, дубовые доски и чугун — проверено на нашей кухне.')), items: [K.btn(T('Shop now', 'В каталог'), '#/catalog', 'primary')] }),
      sec({}, [B('features', { variant: 'icons', columns: 3, items: [item({ icon: 'truck', title: T('Delivery in 2 days', 'Доставка за 2 дня'), html: P('Across Georgia', 'По всей Грузии') }), item({ icon: 'shield', title: T('10-year warranty', 'Гарантия 10 лет'), html: P('On knives and cast iron', 'На ножи и чугун') }), item({ icon: 'user', title: T('Your cart everywhere', 'Корзина везде'), html: P('Signed in, it follows you', 'После входа — на любом устройстве') })] })]),
    ]),
    page('catalog', T('Catalogue', 'Каталог'), [
      sec({ title: T('Catalogue', 'Каталог'), lead: T('Products and stock are edited in the admin console (Content → products).', 'Товары и остатки правят в админке (Содержимое → products).') }, [B('products', { source: 'products', variant: 'cards', columns: 3, qty: true, items: [
        prod('kw-knife', pics[0], 'Chef’s knife 21 cm', 'Поварской нож 21 см', 189, 229, 14, 'Forged carbon steel, walnut handle.', 'Кованая углеродистая сталь, ручка из ореха.'),
        prod('kw-board', pics[1], 'Oak board', 'Дубовая доска', 95, null, 30, 'End grain, 40 × 28 cm.', 'Торцевая, 40 × 28 см.'),
        prod('kw-pan', pics[2], 'Cast iron pan', 'Чугунная сковорода', 120, null, 8, '26 cm, pre-seasoned.', '26 см, уже прокалена.'),
        prod('kw-pot', pics[3], 'Dutch oven', 'Жаровня', 260, 300, 5, '4.5 l, enamel inside.', '4,5 л, эмаль внутри.'),
        prod('kw-kettle', pics[4], 'Copper kettle', 'Медный чайник', 175, null, 0, '1.2 l, for gas and induction.', '1,2 л, для газа и индукции.'),
        prod('kw-set', pics[5], 'Starter set', 'Стартовый набор', 399, 459, 6, 'Knife, board and pan in a box.', 'Нож, доска и сковорода в коробке.')] })]),
      sec({ title: T('Cart', 'Корзина'), tone: 'muted', width: 'narrow' }, [B('cart', { title: L(T('Your cart', 'Ваша корзина')) })]),
    ]),
    page('wholesale', T('Wholesale', 'Опт'), [
      sec({ title: T('Wholesale prices', 'Оптовые цены'), lead: T('Visible to wholesale buyers only.', 'Видны только оптовым покупателям.') }, [
        B('datatable', { title: L(T('Price list', 'Прайс-лист')), csv: 'SKU,Product,From 10 pcs,From 50 pcs\nkw-knife,Chef’s knife,150,135\nkw-board,Oak board,72,64\nkw-pan,Cast iron pan,92,84\nkw-pot,Dutch oven,205,190', file: 'wholesale-prices' })]),
    ], { access: 'roles', roles: 'wholesale' }),
    ...accountPages(K, { profileExtra: [K.sec({ width: 'narrow', title: L(T('Orders', 'Заказы')) }, [K.text(P('Your orders appear in the shop’s admin console; we e-mail every status change.', 'Ваши заказы видны в админке магазина; о каждом статусе пишем на почту.'))])] }),
    V.notFoundPage(d, K.langs),
  ];
  d.regions.footer = [B('footer', { variant: 'simple', brand: L('Kitchen Works'), copy: L(T('© 2026 · fictional demo store', '© 2026 · вымышленный магазин')) })];
  return V.normalizeDoc(d);
}

/* ---------- real estate agency ---------- */

function tplBuildAgency(V) {
  const K = siteKit(V);
  const { B, L, T, P, art, item, page, sec } = K;
  const hero = art.scene('agency-hero', { seed: 'tower', pal: 'ink', motif: 'city' });
  const viewing = K.req('Viewing requests', 'local:viewings');
  const d = K.doc({ name: 'Riverside Residence — sales office', preset: 'shore', theme: { scheme: 'auto' },
    title: T('Riverside Residence — new apartments by the Rioni', 'Riverside Residence — новые квартиры у Риони'),
    description: T('Units with live availability, a floor chessboard, a mortgage formula, a map of the district and viewing bookings; an agents’ desk behind sign-in.', 'Квартиры с актуальным наличием, шахматка этажей, формула ипотеки, карта района и запись на просмотр; кабинет агентов за входом.'),
    shop: { currency: 'USD' } });
  d.requests = K.requests;
  d.auth = { signup: 'invite', password: true, link: true, defaultRole: 'member', roles: [{ id: 'agent', name: { en: 'Agent', ru: 'Агент' }, parent: 'member' }] };
  const statuses = ['free', 'free', 'reserved', 'sold', 'free', 'free', 'sold', 'free', 'reserved', 'free', 'free', 'free'];
  const units = [];
  for (let f = 1; f <= 6; f++) for (let k = 1; k <= 4; k++) {
    const rooms = [1, 2, 2, 3][k - 1];
    const area = [42, 58, 61, 84][k - 1] + f * 0.5;
    units.push(item({ num: String(f * 100 + k), building: 'A', floor: f, rooms, area, price: Math.round(area * (1150 + f * 20)), status: statuses[(f * 4 + k) % statuses.length], note: L('') }));
  }
  d.regions.header = [B('nav', { brand: L('Riverside'), variant: 'bar', sticky: true, pages: true, items: [], ctaLabel: L(T('Book a viewing', 'Записаться на просмотр')), ctaHref: '#/viewing' })];
  d.regions.main = [
    page('', T('Residence', 'Комплекс'), [
      B('hero', { layout: 'left', media: hero, height: 'tall', overlay: 45, eyebrow: L(T('Kutaisi · ready in Q3 2027', 'Кутаиси · сдача в III кв. 2027')), title: L(T('Riverside Residence', 'Riverside Residence')),
        text: L(P('Six floors, 24 apartments with river views, underground parking and a courtyard park.', 'Шесть этажей, 24 квартиры с видом на реку, подземный паркинг и двор-парк.')), items: [K.btn(T('Choose an apartment', 'Выбрать квартиру'), '#/units', 'primary')] }),
      sec({}, [B('stats', { variant: 'cards', count: true, items: [item({ value: '24', label: T('apartments', 'квартиры') }), item({ value: '1 150', suffix: ' $', label: T('per m² from', 'за м², от') }), item({ value: '2027', label: T('handover', 'сдача') })] })]),
    ]),
    page('units', T('Apartments', 'Квартиры'), [
      sec({ title: T('Floor chessboard', 'Шахматка'), lead: T('Availability is kept by the sales office in the admin console (Content → units).', 'Наличие ведёт отдел продаж в админке (Содержимое → units).') }, [B('estate', { source: 'units', view: 'chess', filters: true, items: units })]),
      sec({ title: T('All apartments', 'Все квартиры'), tone: 'muted' }, [B('estate', { source: 'units', view: 'cards', filters: true, items: units })]),
      sec({ title: T('Mortgage', 'Ипотека'), width: 'narrow' }, [B('formula', { tex: 'M = P \\cdot \\frac{r(1+r)^n}{(1+r)^n - 1}', caption: L(T('Monthly payment: P — loan, r — monthly rate, n — months', 'Платёж в месяц: P — кредит, r — ставка в месяц, n — месяцы')) }), B('units', { kind: 'area', from: 'm2', to: 'sqft', title: L(T('m² ⇄ ft²', 'м² ⇄ фут²')) })]),
    ]),
    page('district', T('District', 'Район'), [
      sec({ title: T('Around the house', 'Вокруг дома') }, [B('map', { height: 420, items: [
        item({ title: T('Riverside Residence', 'Riverside Residence'), text: T('Chavchavadze 50', 'Чавчавадзе, 50'), lat: 42.2706, lng: 42.7055 }),
        item({ title: T('School No. 3', 'Школа № 3'), text: T('5 min walk', '5 минут пешком'), lat: 42.2689, lng: 42.7031 }),
        item({ title: T('Park', 'Парк'), text: T('Along the river', 'Вдоль реки'), lat: 42.2721, lng: 42.7088 })] })]),
    ]),
    page('viewing', T('Viewing', 'Просмотр'), [
      sec({ title: T('Book a viewing', 'Запись на просмотр'), width: 'narrow' }, [B('form', { req: viewing, fallback: 'outbox', items: [
        { id: 'fname', key: 'name', type: 'text', label: L(T('Name', 'Имя')), ph: {}, options: {}, required: true, half: true },
        { id: 'fphone', key: 'phone', type: 'tel', label: L(T('Phone', 'Телефон')), ph: {}, options: {}, required: true, half: true },
        { id: 'fday', key: 'day', type: 'date', label: L(T('Preferred day', 'Удобный день')), ph: {}, options: {}, required: false, half: true },
        { id: 'funit', key: 'unit', type: 'text', label: L(T('Apartment №', 'Квартира №')), ph: {}, options: {}, required: false, half: true }] })]),
    ]),
    page('agents', T('Agents’ desk', 'Кабинет агента'), [
      sec({ title: T('Agents’ desk', 'Кабинет агента'), lead: T('Commission table and sales scripts; only for invited agents.', 'Таблица комиссий и скрипты продаж; только для приглашённых агентов.') }, [
        B('datatable', { title: L(T('Commission', 'Комиссия')), csv: 'Rooms,Commission %,Bonus USD\n1,2.0,300\n2,2.5,500\n3,3.0,800' }),
        B('diagram', { mode: 'text', src: 'stateDiagram-v2\n  [*] --> Free\n  Free --> Reserved : deposit\n  Reserved --> Sold : contract\n  Reserved --> Free : 14 days\n  Sold --> [*]', caption: L(T('Life of a unit', 'Жизнь квартиры')) })]),
    ], { access: 'roles', roles: 'agent' }),
    ...accountPages(K, { navAccount: false }),
    V.notFoundPage(d, K.langs),
  ];
  d.regions.footer = [B('footer', { variant: 'simple', brand: L('Riverside Residence'), copy: L(T('© 2026 · fictional demo development', '© 2026 · вымышленный жилой комплекс')) })];
  return V.normalizeDoc(d);
}

/* ---------- members site ---------- */

function tplBuildMembers(V) {
  const K = siteKit(V);
  const { B, L, T, P, art, item, page, sec } = K;
  const hero = art.scene('club-hero', { seed: 'club', pal: 'rose', motif: 'grid' });
  const d = K.doc({ name: 'Photo Club Lens', preset: 'clean', theme: { accent: '#9d2b4f', scheme: 'auto' },
    title: T('Lens — a photo club with a members’ area', 'Lens — фотоклуб с разделом для участников'),
    description: T('Public pages, registration with a password or an e-mail link, a profile and sections for members and mentors.', 'Публичные страницы, регистрация по паролю или ссылке из письма, профиль и разделы для участников и наставников.') });
  d.auth = { signup: 'open', password: true, link: true, defaultRole: 'member', roles: [{ id: 'mentor', name: { en: 'Mentor', ru: 'Наставник' }, parent: 'member' }] };
  d.regions.header = [B('nav', { brand: L('Lens'), variant: 'bar', sticky: true, pages: true, items: [], ctaLabel: L(T('Join', 'Вступить')), ctaHref: '#/sign-up' })];
  d.regions.main = [
    page('', T('Club', 'Клуб'), [
      B('hero', { layout: 'split', media: hero, eyebrow: L(T('Since 2015 · 340 members', 'С 2015 года · 340 участников')), title: L(T('Learn photography with people who love it', 'Учитесь фотографии с теми, кто её любит')),
        text: L(P('Weekly photo walks, critiques and a members’ library of lessons.', 'Еженедельные фотопрогулки, разборы и библиотека уроков для участников.')), items: [K.btn(T('Join the club', 'Вступить в клуб'), '#/sign-up', 'primary'), K.btn(T('Sign in', 'Войти'), '#/sign-in', 'secondary')] }),
      sec({ title: T('What members get', 'Что получают участники') }, [B('compare', { cols: L(T('Guest\nMember\nMentor', 'Гость\nУчастник\nНаставник')), featured: 2, items: [
        item({ label: L(T('Photo walks', 'Фотопрогулки')), values: L('+\n+\n+') }), item({ label: L(T('Lesson library', 'Библиотека уроков')), values: L('–\n+\n+') }), item({ label: L(T('Critique sessions', 'Разборы работ')), values: L('–\n+\n+') }), item({ label: L(T('Mentors’ room', 'Комната наставников')), values: L('–\n–\n+') })] })]),
    ]),
    page('lessons', T('Lessons', 'Уроки'), [
      sec({ title: T('Lesson library', 'Библиотека уроков'), width: 'narrow' }, [B('markdown', { text: T('## Exposure triangle\n\n| | wider | narrower |\n|---|---|---|\n| aperture | more light, less depth | less light, more depth |\n| shutter | blur | freeze |\n| ISO | brighter, noisier | darker, cleaner |\n\nExposure value: $EV = \\log_2 \\frac{N^2}{t}$',
        '## Треугольник экспозиции\n\n| | шире | уже |\n|---|---|---|\n| диафрагма | больше света, меньше ГРИП | меньше света, больше ГРИП |\n| выдержка | смаз | заморозка |\n| ISO | ярче, шумнее | темнее, чище |\n\nЭкспозиционное число: $EV = \\log_2 \\frac{N^2}{t}$') })]),
    ], { access: 'members' }),
    page('mentors', T('Mentors', 'Наставникам'), [
      sec({ title: T('Mentors’ room', 'Комната наставников') }, [B('checklist', { title: L(T('Before a critique session', 'Перед разбором')), persist: true, progress: true, items: [item({ label: L(T('Collect 10 photos', 'Собрать 10 фото')) }), item({ label: L(T('Agree the theme', 'Согласовать тему')) }), item({ label: L(T('Book the room', 'Забронировать зал')) })] })]),
    ], { access: 'roles', roles: 'mentor' }),
    ...accountPages(K),
    V.notFoundPage(d, K.langs),
  ];
  d.regions.footer = [B('footer', { variant: 'simple', brand: L('Lens'), copy: L(T('© 2026 · fictional demo club', '© 2026 · вымышленный клуб')) })];
  return V.normalizeDoc(d);
}

/* ---------- hotel ---------- */

function tplBuildHotel(V) {
  const K = siteKit(V);
  const { B, L, T, P, art, item, page, sec } = K;
  const hero = art.scene('hotel-hero', { seed: 'sighnaghi', pal: 'sand', motif: 'hills' });
  const rooms = ['double', 'family', 'suite'].map((s, i) => art.card('room-' + s, { seed: s, pal: 'sand', glyph: ['2', '4', '★'][i] }));
  const book = K.req('Bookings', 'local:bookings');
  const agree = K.req('Signed agreements', 'local:agreements');
  const d = K.doc({ name: 'Alazani View — boutique hotel', preset: 'kvevri', theme: { scheme: 'auto' },
    title: T('Alazani View — a boutique hotel in Sighnaghi', 'Alazani View — бутик-отель в Сигнахи'),
    description: T('Rooms the admin edits, a price calendar, bookings stored on the server, the hotel agreement and a guest area.', 'Номера, которые правят в админке, календарь цен, брони на сервере, договор отеля и кабинет гостя.'),
    shop: { currency: 'GEL' } });
  d.requests = K.requests;
  d.auth = { signup: 'open', password: false, link: true, defaultRole: 'member', roles: [] };
  d.regions.header = [B('nav', { brand: L('Alazani View'), variant: 'bar', sticky: true, pages: true, items: [], ctaLabel: L(T('Book', 'Бронь')), ctaHref: '#/book' })];
  d.regions.main = [
    page('', T('Hotel', 'Отель'), [
      B('hero', { layout: 'center', media: hero, height: 'tall', overlay: 35, eyebrow: L(T('Sighnaghi · Kakheti', 'Сигнахи · Кахетия')), title: L(T('Twelve rooms above the Alazani valley', 'Двенадцать номеров над Алазанской долиной')), items: [K.btn(T('Rooms', 'Номера'), '#/rooms', 'primary')] }),
    ]),
    page('rooms', T('Rooms', 'Номера'), [
      sec({ title: T('Rooms', 'Номера'), lead: T('Rooms, photos and prices are kept in the admin console (Content → rooms).', 'Номера, фото и цены ведут в админке (Содержимое → rooms).') }, [B('collection', { source: 'rooms', variant: 'grid', columns: 3, ratio: '4/3', details: true, items: [
        item({ cover: rooms[0], title: T('Double with balcony', 'Двухместный с балконом'), price: 220, html: P('22 m², valley view, breakfast.', '22 м², вид на долину, завтрак.'), tags: L('2') }),
        item({ cover: rooms[1], title: T('Family room', 'Семейный'), price: 320, html: P('34 m², two bedrooms.', '34 м², две спальни.'), tags: L('4') }),
        item({ cover: rooms[2], title: T('Suite with terrace', 'Люкс с террасой'), price: 480, html: P('48 m², private terrace and a qvevri wine tasting.', '48 м², своя терраса и дегустация вина из квеври.'), tags: L('★') })] })]),
    ]),
    page('book', T('Booking', 'Бронь'), [
      sec({ title: T('Free dates and prices', 'Свободные даты и цены') }, [B('booking', { title: L(T('Double with balcony', 'Двухместный с балконом')), price: 220, weekend: 260, minNights: 1, months: 2,
        seasons: '2026-09-15..2026-10-31 | 280 | 320 | Rtveli (harvest)', booked: '2026-11-21..2026-11-23', req: book, fallback: 'mailto', to: 'stay@alazaniview.example' })]),
      sec({ title: T('Hotel agreement', 'Договор отеля'), tone: 'muted' }, [B('contract', { title: L(T('Accommodation agreement', 'Договор проживания')),
        body: L(T('Guest {{name}} books a room from {{checkin}} for {{nights}} nights and agrees to the hotel rules: check-in from 14:00, check-out until 12:00, quiet hours 23:00–8:00.', 'Гость {{name}} бронирует номер с {{checkin}} на {{nights}} ночей и соглашается с правилами отеля: заезд с 14:00, выезд до 12:00, тишина с 23:00 до 8:00.')),
        req: agree, fallback: 'mailto', to: 'stay@alazaniview.example' })]),
    ]),
    page('guests', T('Guests', 'Гостям'), [
      sec({ title: T('For our guests', 'Для наших гостей'), width: 'narrow' }, [B('markdown', { text: T('## Wi-Fi\n\nNetwork **AlazaniView**, the password is at the reception.\n\n## Wine tour\n\nEvery day at 16:00 from the lobby.', '## Wi-Fi\n\nСеть **AlazaniView**, пароль на ресепшене.\n\n## Винный тур\n\nКаждый день в 16:00 из лобби.') })]),
    ], { access: 'members' }),
    ...accountPages(K),
    V.notFoundPage(d, K.langs),
  ];
  d.regions.footer = [B('footer', { variant: 'simple', brand: L('Alazani View'), copy: L(T('© 2026 · fictional demo hotel', '© 2026 · вымышленный отель')) })];
  return V.normalizeDoc(d);
}

/* ---------- school ---------- */

function tplBuildSchool(V) {
  const K = siteKit(V);
  const { B, L, T, P, art, item, page, sec } = K;
  const hero = art.scene('school-hero', { seed: 'code-school', pal: 'night', motif: 'grid' });
  const covers = ['js', 'py', 'ux'].map((s, i) => art.card('course-' + s, { seed: s, pal: ['night', 'forest', 'rose'][i], glyph: ['JS', 'Py', 'UX'][i] }));
  const enrol = K.req('Enrolments', 'local:enrolments');
  const d = K.doc({ name: 'Byte School', preset: 'nocturne', theme: { scheme: 'dark' },
    title: T('Byte School — evening courses in programming and design', 'Byte School — вечерние курсы программирования и дизайна'),
    description: T('Courses the admin edits, a schedule, enrolment, payment by link and lessons only for students.', 'Курсы, которые правят в админке, расписание, запись, оплата по ссылке и уроки только для студентов.'),
    shop: { currency: 'GEL' } });
  d.requests = K.requests;
  d.auth = { signup: 'invite', password: true, link: true, defaultRole: 'member', roles: [{ id: 'student', name: { en: 'Student', ru: 'Студент' }, parent: 'member' }, { id: 'teacher', name: { en: 'Teacher', ru: 'Преподаватель' }, parent: 'student' }] };
  d.regions.header = [B('nav', { brand: L('Byte School'), variant: 'bar', sticky: true, pages: true, items: [], ctaLabel: L(T('Enrol', 'Записаться')), ctaHref: '#/enrol' })];
  d.regions.main = [
    page('', T('School', 'Школа'), [
      B('hero', { layout: 'split', media: hero, eyebrow: L(T('Evenings · Tbilisi and online', 'Вечерами · Тбилиси и онлайн')), title: L(T('From zero to your first project in 12 weeks', 'С нуля до первого проекта за 12 недель')), items: [K.btn(T('Courses', 'Курсы'), '#/courses', 'primary')] }),
    ]),
    page('courses', T('Courses', 'Курсы'), [
      sec({ title: T('Courses', 'Курсы') }, [B('collection', { source: 'courses', variant: 'grid', columns: 3, ratio: '1/1', details: true, items: [
        item({ cover: covers[0], title: T('JavaScript from zero', 'JavaScript с нуля'), price: 900, html: P('12 weeks, Tue/Thu 19:00.', '12 недель, вт/чт 19:00.') }),
        item({ cover: covers[1], title: T('Python for data', 'Python для данных'), price: 950, html: P('10 weeks, Mon/Wed 19:00.', '10 недель, пн/ср 19:00.') }),
        item({ cover: covers[2], title: T('UX design', 'UX-дизайн'), price: 800, html: P('8 weeks, Sat 11:00.', '8 недель, сб 11:00.') })] })]),
      sec({ title: T('Schedule', 'Расписание'), tone: 'muted' }, [B('events', { variant: 'list', items: [
        item({ date: '2026-11-03', time: '19:00', title: L(T('JavaScript: first lesson', 'JavaScript: первое занятие')), city: L(T('Tbilisi', 'Тбилиси')), venue: L('Room 2') }),
        item({ date: '2026-11-07', time: '11:00', title: L(T('UX design: open lesson', 'UX-дизайн: открытый урок')), city: L(T('Online', 'Онлайн')), venue: L('') })] })]),
    ]),
    page('enrol', T('Enrol', 'Запись'), [
      sec({ title: T('Enrol', 'Запись на курс'), width: 'narrow' }, [B('form', { req: enrol, fallback: 'outbox' })]),
      sec({ width: 'narrow' }, [B('donate', { title: L(T('Pay the course', 'Оплата курса')), text: L(P('Pay by the link of our payment provider or by bank transfer.', 'Оплатите по ссылке платёжного сервиса или банковским переводом.')), goal: 0, raised: 0, link: 'https://example.org/pay/byte-school', qr: true, bank: 'IBAN GE00 XX00 0000 0000 0000 01\nPurpose: course fee', items: [] })]),
    ]),
    page('lessons', T('Lessons', 'Уроки'), [
      sec({ title: T('Week 1 · Variables', 'Неделя 1 · Переменные'), width: 'narrow' }, [B('markdown', { text: T('```js\nlet count = 0;\nconst name = "Byte";\ncount += 1;\nconsole.log(`${name}: ${count}`);\n```\n\n- [ ] Read chapter 1\n- [ ] Solve tasks 1–5', '```js\nlet count = 0;\nconst name = "Byte";\ncount += 1;\nconsole.log(`${name}: ${count}`);\n```\n\n- [ ] Прочитать главу 1\n- [ ] Решить задачи 1–5') })]),
    ], { access: 'roles', roles: 'student' }),
    page('teachers', T('Teachers', 'Преподавателям'), [
      sec({ title: T('Teachers’ room', 'Учительская') }, [B('datatable', { title: L(T('Group progress', 'Прогресс группы')), csv: 'Student,Week 1,Week 2,Week 3\nAna,10,9,10\nGiorgi,8,10,7\nMariam,10,10,10' })]),
    ], { access: 'roles', roles: 'teacher' }),
    ...accountPages(K),
    V.notFoundPage(d, K.langs),
  ];
  d.regions.footer = [B('footer', { variant: 'simple', brand: L('Byte School'), copy: L(T('© 2026 · fictional demo school', '© 2026 · вымышленная школа')) })];
  return V.normalizeDoc(d);
}

/* ---------- conference ---------- */

function tplBuildConference(V) {
  const K = siteKit(V);
  const { B, L, T, P, art, item, page, sec } = K;
  const hero = art.scene('conf-hero', { seed: 'conf', pal: 'ink', motif: 'stage' });
  const rsvp = K.req('Registrations', 'local:registrations');
  const d = K.doc({ name: 'Caucasus Health Summit', preset: 'counsel', theme: { scheme: 'auto' },
    title: T('Caucasus Health Summit 2027', 'Кавказский саммит здравоохранения 2027'),
    description: T('Registration with accounts, programme, venue map, a chat with organisers and materials only for participants.', 'Регистрация с аккаунтами, программа, карта площадки, чат с организаторами и материалы только для участников.') });
  d.requests = K.requests;
  d.auth = { signup: 'open', password: true, link: true, defaultRole: 'member', roles: [{ id: 'speaker', name: { en: 'Speaker', ru: 'Спикер' }, parent: 'member' }] };
  d.regions.header = [B('nav', { brand: L('CHS 2027'), variant: 'bar', sticky: true, pages: true, items: [], ctaLabel: L(T('Register', 'Регистрация')), ctaHref: '#/register' })];
  d.regions.main = [
    page('', T('Summit', 'Саммит'), [
      B('hero', { layout: 'left', media: hero, height: 'tall', overlay: 50, eyebrow: L(T('Tbilisi · 18–19 March 2027', 'Тбилиси · 18–19 марта 2027')), title: L(T('Caucasus Health Summit', 'Кавказский саммит здравоохранения')), items: [K.btn(T('Register', 'Регистрация'), '#/register', 'primary')] }),
      sec({ width: 'narrow' }, [B('countdown', { title: L(T('Opens in', 'До открытия')), date: '2027-03-18', time: '09:30', tz: 4 })]),
      sec({ title: T('Programme', 'Программа'), tone: 'muted' }, [B('tabs', { variant: 'pills', items: [
        item({ label: T('Day 1', 'День 1'), html: P('09:30 Opening · 10:00 Digital clinics · 14:00 Rural care', '09:30 Открытие · 10:00 Цифровые клиники · 14:00 Сельская медицина') }),
        item({ label: T('Day 2', 'День 2'), html: P('10:00 Public health data · 15:00 Closing panel', '10:00 Данные здравоохранения · 15:00 Итоговая панель') })] })]),
      sec({ title: T('Venue', 'Площадка') }, [B('map', { height: 340, items: [item({ title: T('Expo Georgia, hall 11', 'Экспо Джорджия, павильон 11'), text: T('Tsereteli Ave 118', 'Проспект Церетели, 118'), lat: 41.7365, lng: 44.7862 })] })]),
    ]),
    page('register', T('Registration', 'Регистрация'), [
      sec({ width: 'wide' }, [B('event', { title: L('Caucasus Health Summit 2027'), date: '2027-03-18', time: '09:30', endTime: '18:00', tz: 'Asia/Tbilisi', place: L('Expo Georgia'), address: 'Tsereteli Ave 118, Tbilisi', lat: 41.7365, lng: 44.7862,
        rsvp: true, rsvpTitle: L(T('Register', 'Регистрация')), req: rsvp, fallback: 'outbox' })]),
      sec({ width: 'narrow' }, [B('account', { view: 'signup', title: L(T('Create your participant account', 'Создайте аккаунт участника')), after: '#/materials' })]),
    ]),
    page('materials', T('Materials', 'Материалы'), [
      sec({ title: T('Slides and recordings', 'Слайды и записи'), lead: T('For registered participants.', 'Для зарегистрированных участников.') }, [B('datatable', { csv: 'Talk,Speaker,Slides\nDigital clinics,Dr. N. Abashidze,PDF\nRural care,Dr. L. Kapanadze,PDF\nPublic health data,Dr. S. Gogua,PDF' })]),
    ], { access: 'members' }),
    page('speakers', T('Speakers’ room', 'Для спикеров'), [
      sec({ title: T('Speakers’ checklist', 'Чек-лист спикера') }, [B('checklist', { persist: true, progress: true, items: [item({ label: L(T('Upload slides by 10 March', 'Загрузить слайды до 10 марта')) }), item({ label: L(T('Rehearsal on 17 March, 16:00', 'Репетиция 17 марта, 16:00')) })] })]),
    ], { access: 'roles', roles: 'speaker', nav: false }),
    ...accountPages(K),
    V.notFoundPage(d, K.langs),
  ];
  d.regions.footer = [B('footer', { variant: 'simple', brand: L('Caucasus Health Summit'), copy: L(T('© 2027 · fictional demo conference', '© 2027 · вымышленная конференция')) })];
  d.regions.footer.push(B('chat', { display: 'bubble', title: L(T('Questions to organisers', 'Вопросы организаторам')), welcome: L(T('Hello! Ask us anything about the summit.', 'Здравствуйте! Спрашивайте о саммите.')), operator: L(T('Organising team', 'Оргкомитет')) }));
  return V.normalizeDoc(d);
}

/* ---------- retail chain ---------- */

function tplBuildRetail(V) {
  const K = siteKit(V);
  const { B, L, T, P, art, item, page, sec } = K;
  const hero = art.scene('retail-hero', { seed: 'retail', pal: 'forest', motif: 'shop' });
  const d = K.doc({ name: 'Green Basket — grocery chain', preset: 'harvest', theme: { scheme: 'auto' },
    title: T('Green Basket — groceries near you', 'Green Basket — продукты рядом с вами'),
    description: T('Stores on a map, the weekly offers the admin edits, price tags with barcodes and a staff area with stock and shelf plans.', 'Магазины на карте, акции недели из админки, ценники со штрихкодами и раздел для персонала с остатками и планами полок.'),
    shop: { currency: 'GEL' } });
  d.auth = { signup: 'invite', password: true, link: true, defaultRole: 'member', roles: [{ id: 'staff', name: { en: 'Staff', ru: 'Персонал' }, parent: 'member' }, { id: 'manager', name: { en: 'Store manager', ru: 'Управляющий' }, parent: 'staff' }] };
  const offer = (sku, en, ru, price, old) => item({ sku, name: T(en, ru), price, old, unit: L(T('kg', 'кг')), html: L(''), image: null, min: 1, step: 1 });
  d.regions.header = [B('nav', { brand: L('Green Basket'), variant: 'bar', sticky: true, pages: true, items: [] })];
  d.regions.main = [
    page('', T('Home', 'Главная'), [
      B('hero', { layout: 'split', media: hero, eyebrow: L(T('9 stores · open 8–23', '9 магазинов · с 8 до 23')), title: L(T('Fresh food, fair prices', 'Свежие продукты по честным ценам')), items: [K.btn(T('Offers of the week', 'Акции недели'), '#/offers', 'primary')] }),
      sec({ title: T('Our stores', 'Наши магазины') }, [B('map', { height: 380, items: [
        item({ title: T('Vake', 'Ваке'), text: T('Chavchavadze 37', 'Чавчавадзе, 37'), lat: 41.7101, lng: 44.7489 }), item({ title: T('Saburtalo', 'Сабуртало'), text: T('Pekini 12', 'Пекини, 12'), lat: 41.7259, lng: 44.7533 }), item({ title: T('Didube', 'Дидубе'), text: T('Tsereteli 61', 'Церетели, 61'), lat: 41.7404, lng: 44.7807 })] })]),
    ]),
    page('offers', T('Offers', 'Акции'), [
      sec({ title: T('Offers of the week', 'Акции недели'), lead: T('Managers update offers in the admin console (Content → offers).', 'Управляющие обновляют акции в админке (Содержимое → offers).') }, [B('products', { source: 'offers', variant: 'table', buy: false, items: [
        offer('gb-tomato', 'Tomatoes', 'Помидоры', 3.2, 4.1), offer('gb-cheese', 'Imeretian cheese', 'Имеретинский сыр', 14.5, 16), offer('gb-apples', 'Apples', 'Яблоки', 2.4, null)] })]),
    ]),
    page('staff', T('Staff', 'Персонал'), [
      sec({ title: T('Stock today', 'Остатки на сегодня') }, [B('datatable', { title: L(T('Stock by store', 'Остатки по магазинам')), csv: 'SKU,Product,Vake,Saburtalo,Didube\ngb-tomato,Tomatoes,120,85,40\ngb-cheese,Imeretian cheese,32,18,25\ngb-apples,Apples,210,160,90', file: 'stock-today' })]),
      sec({ title: T('Price tags', 'Ценники'), tone: 'muted' }, [B('columns', { cols: [
        { w: 33, blocks: [B('barcode', { kind: 'ean13', value: '4860123450016', caption: L(T('Tomatoes · 3.20 ₾/kg', 'Помидоры · 3,20 ₾/кг')) })] },
        { w: 33, blocks: [B('barcode', { kind: 'ean13', value: '4860123450023', caption: L(T('Cheese · 14.50 ₾/kg', 'Сыр · 14,50 ₾/кг')) })] },
        { w: 33, blocks: [B('barcode', { kind: 'code128', value: 'GB-APPLES-24', caption: L(T('Apples · 2.40 ₾/kg', 'Яблоки · 2,40 ₾/кг')) })] }] })]),
    ], { access: 'roles', roles: 'staff' }),
    page('managers', T('Managers', 'Управляющим'), [
      sec({ title: T('Shelf plan: dairy', 'План полки: молочка') }, [B('diagram', { mode: 'text', src: 'block-beta\n', caption: L('') }), B('markdown', { text: T('| shelf | left | middle | right |\n|---|---|---|---|\n| 1 (top) | yoghurt | kefir | matsoni |\n| 2 | cheese | **cheese (offer)** | butter |\n| 3 | milk 1 l | milk 2 l | cream |', '| полка | слева | центр | справа |\n|---|---|---|---|\n| 1 (верх) | йогурт | кефир | мацони |\n| 2 | сыр | **сыр (акция)** | масло |\n| 3 | молоко 1 л | молоко 2 л | сливки |') })]),
    ], { access: 'roles', roles: 'manager' }),
    ...accountPages(K, { navAccount: false }),
    V.notFoundPage(d, K.langs),
  ];
  d.regions.footer = [B('footer', { variant: 'simple', brand: L('Green Basket'), copy: L(T('© 2026 · fictional demo chain', '© 2026 · вымышленная сеть')) })];
  return V.normalizeDoc(d);
}

const tpl = (id, build, name, desc, modules, note) => ({ id, group: 'backend', mode: 'backend', langs: ['en', 'ru'], build, name, desc, modules, note });

const TPL_REGION = tpl('region', tplBuildRegion, both('Regional portal', 'Региональный портал', 'Регіональний портал', 'Regionalportal', 'Portail régional', 'Portal regional', 'რეგიონული პორტალი'),
  both('News the editors publish online, a directory, residents’ requests, a volunteers’ area and an editors’ room by role.', 'Новости, которые редакция публикует онлайн, справочник, заявки жителей, раздел волонтёров и комната редакции по роли.', 'Новини, які редакція публікує онлайн, довідник, заявки мешканців, розділ волонтерів і кімната редакції за роллю.'),
  { req: ['accounts', 'roles', 'collection', 'portal'], opt: ['diagram', 'markdown', 'search'] },
  both('Without a server the news are a snapshot and closed sections show a note.', 'Без сервера новости — снимок, а закрытые разделы показывают пояснение.'));
const TPL_STORE = tpl('store', tplBuildStore, both('Online store', 'Интернет-магазин', 'Інтернет-магазин', 'Onlineshop', 'Boutique en ligne', 'Tienda en línea', 'ონლაინ მაღაზია'),
  both('A catalogue with stock the admin edits, a cart that follows the account, orders on the server and wholesale prices by role.', 'Каталог с остатками из админки, корзина, привязанная к аккаунту, заказы на сервере и оптовые цены по роли.', 'Каталог із залишками з адмінки, кошик, прив’язаний до облікового запису, замовлення на сервері й оптові ціни за роллю.'),
  { req: ['cart', 'checkout', 'accounts', 'roles'], opt: ['payments', 'table'] });
const TPL_AGENCY = tpl('agency', tplBuildAgency, both('Real estate agency', 'Агентство недвижимости', 'Агентство нерухомості', 'Immobilienagentur', 'Agence immobilière', 'Agencia inmobiliaria', 'უძრავი ქონების სააგენტო'),
  both('A floor chessboard and cards with live availability, a mortgage formula, a district map, viewing requests and an agents’ desk.', 'Шахматка и карточки с актуальным наличием, формула ипотеки, карта района, запись на просмотр и кабинет агента.', 'Шахівка й картки з актуальною наявністю, формула іпотеки, мапа району, запис на перегляд і кабінет агента.'),
  { req: ['estate', 'map', 'accounts', 'roles'], opt: ['formula', 'units', 'diagram'] });
const TPL_MEMBERS = tpl('members', tplBuildMembers, both('Site with accounts', 'Сайт с личным кабинетом', 'Сайт з особистим кабінетом', 'Website mit Konten', 'Site avec comptes', 'Sitio con cuentas', 'საიტი პირადი კაბინეტით'),
  both('Registration with a password or an e-mail link, a profile, lessons for members and a mentors’ room by role.', 'Регистрация по паролю или ссылке из письма, профиль, уроки для участников и комната наставников по роли.', 'Реєстрація за паролем або посиланням з листа, профіль, уроки для учасників і кімната наставників за роллю.'),
  { req: ['accounts', 'roles'], opt: ['markdown', 'formula'] });
const TPL_HOTEL = tpl('hotel', tplBuildHotel, both('Boutique hotel', 'Бутик-отель', 'Бутик-готель', 'Boutiquehotel', 'Hôtel de charme', 'Hotel boutique', 'ბუტიკ-სასტუმრო'),
  both('Rooms the admin edits, a price calendar with seasons, bookings and signed agreements on the server, a guests’ page after an e-mail link.', 'Номера из админки, календарь цен по сезонам, брони и подписанные договоры на сервере, страница гостя после входа по ссылке.', 'Номери з адмінки, календар цін за сезонами, бронювання й підписані договори на сервері, сторінка гостя після входу за посиланням.'),
  { req: ['booking', 'contract', 'accounts', 'collection'], opt: ['markdown'] });
const TPL_SCHOOL = tpl('school', tplBuildSchool, both('School or courses', 'Школа или курсы', 'Школа або курси', 'Schule oder Kurse', 'École ou cours', 'Escuela o cursos', 'სკოლა ან კურსები'),
  both('Courses and a schedule, enrolment, payment by link and QR, lessons for students and a teachers’ room.', 'Курсы и расписание, запись, оплата по ссылке и QR, уроки для студентов и учительская.', 'Курси й розклад, запис, оплата за посиланням і QR, уроки для студентів і вчительська.'),
  { req: ['accounts', 'roles', 'collection'], opt: ['payments', 'markdown', 'table'] });
const TPL_CONFERENCE = tpl('conference', tplBuildConference, both('Conference', 'Конференция', 'Конференція', 'Konferenz', 'Conférence', 'Congreso', 'კონფერენცია'),
  both('Registration with an account and RSVP, programme tabs, a countdown, the venue map, a chat with organisers and materials for participants.', 'Регистрация с аккаунтом и RSVP, программа во вкладках, обратный отсчёт, карта площадки, чат с организаторами и материалы для участников.', 'Реєстрація з обліковим записом і RSVP, програма у вкладках, зворотний відлік, мапа майданчика, чат з організаторами й матеріали для учасників.'),
  { req: ['events', 'accounts', 'chat', 'map'], opt: ['table', 'countdown'] });
const TPL_RETAIL = tpl('retail', tplBuildRetail, both('Retail chain', 'Розничная сеть', 'Роздрібна мережа', 'Einzelhandelskette', 'Chaîne de magasins', 'Cadena minorista', 'საცალო ქსელი'),
  both('Stores on a map, weekly offers the admin edits, and a staff area: stock by store, price tags with barcodes and shelf plans.', 'Магазины на карте, акции недели из админки и раздел персонала: остатки по магазинам, ценники со штрихкодами и планы полок.', 'Магазини на мапі, акції тижня з адмінки й розділ персоналу: залишки за магазинами, цінники зі штрихкодами й плани полиць.'),
  { req: ['map', 'accounts', 'roles', 'barcode'], opt: ['table', 'markdown'] });

export { TPL_AGENCY, TPL_CONFERENCE, TPL_HOTEL, TPL_MEMBERS, TPL_REGION, TPL_RETAIL, TPL_SCHOOL, TPL_STORE, accountPages };
