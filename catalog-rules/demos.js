// catalog-rules/demos.js - the seeded projects: Batumi real-estate listings (a category tree real estate ->
// apartments -> new builds / resale, houses, commercial; title rules in Georgian, Russian and English with the
// euro-layout and sea-distance scales; sea / mall / parking tags) and a grocery catalogue (goods -> dairy -> milk /
// cheese, drinks -> water; titles from brand, fat, volume and pack; organic / promo / origin tags). Each comes with
// sample objects that exercise the rules: overrides, hidden fields, showIf, missing required values, the segment
// rule, the fallback and a disabled rule.
//
// Data, not code: both projects are raw project objects in the same shape a user would import, deliberately loose
// (options as 'code = labels' strings, some fields without type on child levels = overrides). They always enter the
// app through normalizeProject (engine.js), so the demos also exercise the import path. Each sample has an
// `expect` title, which turns the demo into a regression test visible in the UI (green/red per sample).
// Structure of a project: { version, name, srcLang, tree: [node], scales, rules: [{ note, off, when, tpl }],
// fallback: { ka, ru, en }, tags, samples: [{ id, node, values, tags, expect }] }; a node is
// { id, parent, name, fields: [field definition], values: { key: default } }.

// 'code = English | Русский | ქართული' -> { v, label }
// Helpers to keep the tables readable: opt() splits one option line, L() builds a { en, ru, ka } label.
const opt = (line) => {
  const [v, rest = ''] = line.split('=').map((s) => s.trim());
  const [en, ru, ka] = rest.split('|').map((s) => s.trim());
  return { v, label: { en, ru, ka } };
};
const L = (en, ru, ka) => ({ en, ru, ka });

// Real estate: srcLang 'ka', so titles are authored in Georgian and the source-language fallback is Georgian too.
const REALTY = {
  version: 1,
  name: 'Batumi real estate',
  srcLang: 'ka',
  tree: [
    {
      id: 'realty', parent: null, name: L('Real estate', 'Недвижимость', 'უძრავი ქონება'),
      fields: [
        { key: 'deal', type: 'select', label: L('Deal', 'Сделка', 'გარიგება'), required: true, group: 'deal', groupLabel: L('Deal', 'Сделка', 'გარიგება'), sort: 1,
          options: ['sale = Sale | Продажа | იყიდება', 'rent_long = Long-term rent | Долгосрочная аренда | გრძელვადიანი ქირა', 'rent_daily = Daily rent | Посуточно | დღიური ქირა'].map(opt) },
        { key: 'price', type: 'number', label: L('Price', 'Цена', 'ფასი'), unit: 'USD', min: 0, group: 'deal', sort: 2 },
        { key: 'area', type: 'number', label: L('Area', 'Площадь', 'ფართი'), unit: 'm2', required: true, min: 5, max: 10000, decimals: 1, group: 'object', groupLabel: L('Property', 'Объект', 'ობიექტი'), sort: 10 },
        { key: 'floor', type: 'number', label: L('Floor', 'Этаж', 'სართული'), min: -2, max: 80, group: 'object', sort: 14 },
        { key: 'floors', type: 'number', label: L('Floors in the building', 'Этажей в доме', 'სართულიანობა'), min: 1, max: 80, group: 'object', sort: 15 },
        { key: 'district', type: 'select', label: L('District', 'Район', 'უბანი'), required: true, group: 'place', groupLabel: L('Location', 'Расположение', 'მდებარეობა'), sort: 20,
          options: ['old_town = Old Town | Старый город | ძველი ქალაქი', 'new_boulevard = New Boulevard | Новый бульвар | ახალი ბულვარი', 'gonio = Gonio | Гонио | გონიო', 'makhinjauri = Makhinjauri | Махинджаури | მახინჯაური'].map(opt) },
        { key: 'address', type: 'text', label: L('Address', 'Адрес', 'მისამართი'), group: 'place', sort: 21 },
        { key: 'sea_dist', type: 'number', label: L('Distance to the sea', 'До моря', 'მანძილი ზღვამდე'), unit: 'm', min: 0, group: 'place', sort: 22 },
      ],
      values: { deal: 'sale' },
    },
    {
      id: 'apartments', parent: 'realty', name: L('Apartments', 'Квартиры', 'ბინები'),
      fields: [
        { key: 'area', label: L('Total area', 'Общая площадь', 'საერთო ფართი'), min: 12 },
        { key: 'layout', type: 'select', label: L('Layout', 'Планировка', 'გეგმარება'), required: true, group: 'object', sort: 11,
          options: ['studio = Studio | Студия | სტუდიო', 'rooms = Rooms | Комнаты | ოთახები', 'apartments = Apartments (bedrooms) | Апартаменты (спальни) | აპარტამენტები (საძინებლები)'].map(opt) },
        { key: 'rooms', type: 'number', label: L('Rooms', 'Комнат', 'ოთახები'), min: 1, max: 12, group: 'object', sort: 12, showIf: [{ v: 'layout', op: 'is', a: ['rooms', 'apartments'] }] },
        { key: 'bedrooms', type: 'number', label: L('Bedrooms', 'Спален', 'საძინებლები'), min: 0, max: 8, group: 'object', sort: 13, showIf: [{ v: 'layout', op: 'is', a: ['apartments'] }] },
        { key: 'btype', type: 'select', label: L('Building type', 'Тип здания', 'შენობის ტიპი'), group: 'building', groupLabel: L('Building', 'Здание', 'შენობა'), sort: 30,
          options: ['block = Residential block | Жилой дом | საცხოვრებელი კორპუსი', 'apartments = Apart-hotel | Апарт-отель | აპარტ-სასტუმრო'].map(opt) },
        { key: 'legal', type: 'select', label: L('Legal status', 'Статус помещения', 'იურიდიული სტატუსი'), group: 'building', sort: 31,
          options: ['residential = Residential | Жилое | საცხოვრებელი', 'nonresidential = Non-residential | Нежилое | არასაცხოვრებელი'].map(opt) },
        { key: 'condition', type: 'select', label: L('Condition', 'Состояние', 'მდგომარეობა'), group: 'object', sort: 16,
          options: ['black = Black frame | Чёрный каркас | შავი კარკასი', 'white = White frame | Белый каркас | თეთრი კარკასი', 'green = Green frame | Зелёный каркас | მწვანე კარკასი', 'renovated = Renovated | С ремонтом | რემონტით'].map(opt) },
        { key: 'balcony', type: 'bool', label: L('Balcony', 'Балкон', 'აივანი'), group: 'object', sort: 17 },
      ],
      values: {},
    },
    {
      id: 'newbuild', parent: 'apartments', name: L('New builds', 'Новостройки', 'ახალი აშენებული'),
      fields: [
        { key: 'complex', type: 'text', label: L('Residential complex', 'Жилой комплекс', 'საცხოვრებელი კომპლექსი'), required: true, group: 'building', sort: 29 },
        { key: 'ready', type: 'text', label: L('Ready by', 'Срок сдачи', 'ჩაბარების ვადა'), group: 'building', sort: 32 },
        { key: 'installment', type: 'bool', label: L('Installment plan', 'Рассрочка', 'განვადება'), group: 'deal', sort: 3 },
        { key: 'condition', required: true, options: ['black = Black frame | Чёрный каркас | შავი კარკასი', 'white = White frame | Белый каркас | თეთრი კარკასი', 'green = Green frame | Зелёный каркас | მწვანე კარკასი'].map(opt) },
        { key: 'address', hidden: true },
      ],
      values: { condition: 'white' },
    },
    {
      id: 'resale', parent: 'apartments', name: L('Resale', 'Вторичное жильё', 'მეორადი ბინები'),
      fields: [
        { key: 'year', type: 'number', label: L('Year built', 'Год постройки', 'აშენების წელი'), min: 1900, max: 2030, group: 'building', sort: 33 },
        { key: 'condition', required: true },
      ],
      values: {},
    },
    {
      id: 'houses', parent: 'realty', name: L('Houses', 'Дома', 'სახლები'),
      fields: [
        { key: 'land', type: 'number', label: L('Land', 'Участок', 'მიწის ფართი'), unit: 'sotka', min: 0, group: 'object', sort: 11 },
        { key: 'floors', label: L('Storeys', 'Этажей', 'სართულები'), max: 5 },
        { key: 'floor', hidden: true },
        { key: 'pool', type: 'bool', label: L('Pool', 'Бассейн', 'აუზი'), group: 'object', sort: 18 },
      ],
      values: {},
    },
    {
      id: 'commercial', parent: 'realty', name: L('Commercial', 'Коммерческая', 'კომერციული'),
      fields: [
        { key: 'purpose', type: 'select', label: L('Purpose', 'Назначение', 'დანიშნულება'), required: true, group: 'object', sort: 9,
          options: ['office = Office | Офис | ოფისი', 'shop = Shop | Магазин | მაღაზია', 'hotel = Hotel | Гостиница | სასტუმრო', 'warehouse = Warehouse | Склад | საწყობი'].map(opt) },
        { key: 'deal', options: ['sale = Sale | Продажа | იყიდება', 'rent_long = Long-term rent | Долгосрочная аренда | გრძელვადიანი ქირა'].map(opt) },
      ],
      values: {},
    },
  ],
  scales: [
    { key: 'euro', mode: 'exact', name: L('Euro layout', 'Евро-планировка', 'ევრო გეგმარება'), steps: [
      { at: 1, name: L('Euro one-room', 'Евро-однушка', 'ევრო ერთოთახიანი') },
      { at: 2, name: L('Euro two-room', 'Евродвушка', 'ევრო ოროთახიანი') },
      { at: 3, name: L('Euro three-room', 'Евротрёшка', 'ევრო სამოთახიანი') },
      { at: null, name: L('Euro {n}-room', 'Евро-{n}-комнатная', 'ევრო {n}-ოთახიანი') },
    ] },
    { key: 'sea', mode: 'upto', unit: 'm', name: L('Sea distance', 'Расстояние до моря', 'მანძილი ზღვამდე'), steps: [
      { at: 300, name: L('by the sea', 'у моря', 'ზღვასთან') },
      { at: 800, name: L('near the sea', 'рядом с морем', 'ზღვის სიახლოვეს') },
      { at: null, name: L('{n} m to the sea', '{n} м до моря', 'ზღვამდე {n} მ') },
    ] },
  ],
  rules: [
    { note: 'Daily rent', when: [{ v: 'deal', op: 'is', a: ['rent_daily'] }],
      tpl: { ka: 'დღიური ქირა · {rooms}-ოთახიანი · {sea_dist:sea} · {district}', ru: 'Посуточно · {rooms}-комн. · {sea_dist:sea} · {district}', en: 'Daily rent · {rooms}-room · {sea_dist:sea} · {district}' } },
    { note: 'Apart-hotel in a non-residential building', when: [{ v: 'layout', op: 'is', a: ['apartments'] }, { v: 'btype', op: 'is', a: ['apartments'] }, { v: 'legal', op: 'is', a: ['nonresidential'] }],
      tpl: { ka: 'აპარტამენტები {bedrooms}+1 · {area} მ²', ru: 'Апартаменты {bedrooms}+1 · {area} м²', en: 'Apartments {bedrooms}+1 · {area} m²' } },
    { note: 'Euro layout', when: [{ v: 'layout', op: 'is', a: ['apartments'] }, { v: 'rooms', op: 'min', a: ['2'] }],
      tpl: { ka: '{rooms:euro} · {area} მ² · {district}', ru: '{rooms:euro} · {area} м² · {district}', en: '{rooms:euro} · {area} m² · {district}' } },
    { note: 'Studio', when: [{ v: 'layout', op: 'is', a: ['studio'] }],
      tpl: { ka: 'სტუდიო · {area} მ² · {district}', ru: 'Студия · {area} м² · {district}', en: 'Studio · {area} m² · {district}' } },
    { note: 'New build: the complex in the title', when: [{ v: 'path', op: 'is', a: ['newbuild'] }, { v: 'rooms', op: 'min', a: ['1'] }, { v: 'complex', op: 'has' }],
      tpl: { ka: '{rooms}-ოთახიანი ბინა {complex}-ში · {area} მ²', ru: '{rooms}-комнатная квартира в ЖК {complex} · {area} м²', en: '{rooms}-room flat in {complex} · {area} m²' } },
    { note: 'Rooms', when: [{ v: 'rooms', op: 'min', a: ['1'] }],
      tpl: { ka: '{rooms}-ოთახიანი ბინა · {area} მ² · {district}', ru: '{rooms}-комнатная квартира · {area} м² · {district}', en: '{rooms}-room flat · {area} m² · {district}' } },
    { note: 'Old naming by price (switched off)', off: true, when: [{ v: 'price', op: 'has' }],
      tpl: { en: 'Flat for {price} USD', ru: 'Квартира за {price} USD' } },
    { note: 'Commercial', when: [{ v: 'path', op: 'is', a: ['commercial'] }],
      tpl: { ka: '{purpose} · {area} მ² · {district}', ru: '{purpose} · {area} м² · {district}', en: '{purpose} · {area} m² · {district}' } },
  ],
  fallback: { ka: '{category} · {area} მ² · {district}', ru: '{category} · {area} м² · {district}', en: '{category} · {area} m² · {district}' },
  tags: [
    { id: 1, key: 'sea', label: L('Sea', 'Море', 'ზღვა'), icon: '🌊', color: '#0ea5e9', where: ['building', 'unit'],
      fields: [{ key: 'dist', kind: 'number', unit: 'm', scale: 'sea', label: L('Distance', 'Расстояние', 'მანძილი') }, { key: 'walk', kind: 'number', unit: 'min', label: L('Walk', 'Пешком', 'ფეხით') }],
      texts: [L('Sea: {dist}, {walk} walk', 'Море: {dist}, {walk} пешком', 'ზღვა: {dist}, {walk} ფეხით'), L('Sea: {dist:sea}', 'Море: {dist:sea}', 'ზღვა: {dist:sea}')], link: '' },
    { id: 2, key: 'mall', label: L('Shopping mall', 'Торговый центр', 'სავაჭრო ცენტრი'), icon: '🛍', color: '#a855f7', where: ['building'],
      fields: [{ key: 'name', kind: 'select', label: L('Mall', 'ТЦ', 'მოლი'), options: ['metro_city = Metro City | Метро Сити | მეტრო სითი', 'black_sea_mall = Black Sea Mall | Black Sea Mall | ბლექ სი მოლი'].map(opt) }, { key: 'dist', kind: 'number', unit: 'm', label: L('Distance', 'Расстояние', 'მანძილი') }],
      texts: [L('{name} mall, {dist}', 'ТЦ {name}, {dist}', '{name}, {dist}'), L('{name} mall', 'ТЦ {name}', '{name}')], link: 'https://www.openstreetmap.org/search?query=%m%20Batumi' },
    { id: 3, key: 'parking', label: L('Parking', 'Парковка', 'პარკინგი'), icon: '🅿', color: '#64748b', where: ['building'],
      fields: [{ key: 'kind', kind: 'select', label: L('Kind', 'Тип', 'ტიპი'), options: ['underground = Underground | Подземная | მიწისქვეშა', 'yard = Yard | Во дворе | ეზოში'].map(opt) }],
      texts: [L('{kind} parking', 'Парковка: {kind}', 'პარკინგი: {kind}')], link: '' },
  ],
  samples: [
    { id: 's1', node: 'newbuild', values: { deal: 'sale', price: '68000', area: '54', district: 'new_boulevard', sea_dist: '150', layout: 'rooms', rooms: '2', complex: 'Orbi City', ready: 'Q4 2026' }, tags: 'sea dist=150 walk=2; mall name=metro_city dist=600', expect: '2-ოთახიანი ბინა Orbi City-ში · 54 მ²' },
    { id: 's2', node: 'resale', values: { area: '28', district: 'old_town', layout: 'studio', condition: 'renovated', floor: '3' }, tags: 'parking kind=yard', expect: 'სტუდიო · 28 მ² · ძველი ქალაქი' },
    { id: 's3', node: 'newbuild', values: { area: '42', district: 'new_boulevard', layout: 'apartments', bedrooms: '1', btype: 'apartments', legal: 'nonresidential', complex: 'Alliance Palace' }, tags: 'sea dist=80 walk=1; parking kind=underground', expect: 'აპარტამენტები 1+1 · 42 მ²' },
    { id: 's4', node: 'resale', values: { area: '71,5', district: 'makhinjauri', layout: 'apartments', rooms: '3', bedrooms: '2', btype: 'block', legal: 'residential', condition: 'renovated' }, tags: '', expect: 'ევრო სამოთახიანი · 71,5 მ² · მახინჯაური' },
    { id: 's5', node: 'houses', values: { price: '210000', area: '160', land: '6', district: 'gonio', pool: 'yes' }, tags: 'sea dist=1200', expect: 'სახლები · 160 მ² · გონიო' },
    { id: 's6', node: 'resale', values: { deal: 'rent_daily', area: '35', district: 'new_boulevard', layout: 'rooms', rooms: '1', sea_dist: '250', condition: 'renovated' }, tags: 'sea dist=250 walk=3', expect: 'დღიური ქირა · 1-ოთახიანი · ზღვასთან · ახალი ბულვარი' },
    { id: 's7', node: 'newbuild', values: { district: 'gonio', layout: 'rooms', rooms: '2' }, tags: '', expect: '' },
    { id: 's8', node: 'commercial', values: { deal: 'rent_long', area: '90', district: 'old_town', purpose: 'shop' }, tags: 'mall name=black_sea_mall', expect: 'მაღაზია · 90 მ² · ძველი ქალაქი' },
  ],
};

// Grocery: a second domain with different field types (fat %, volume, pack) to show the engine is domain-agnostic.
const GROCERY = {
  version: 1,
  name: 'Grocery catalogue',
  srcLang: 'ru',
  tree: [
    {
      id: 'goods', parent: null, name: L('Goods', 'Товары', 'საქონელი'),
      fields: [
        { key: 'brand', type: 'text', label: L('Brand', 'Бренд', 'ბრენდი'), required: true, group: 'main', groupLabel: L('Main', 'Основное', 'მთავარი'), sort: 1 },
        { key: 'name', type: 'text', label: L('Product name', 'Название', 'დასახელება'), group: 'main', sort: 2 },
        { key: 'country', type: 'select', label: L('Country', 'Страна', 'ქვეყანა'), group: 'main', sort: 3,
          options: ['ge = Georgia | Грузия | საქართველო', 'tr = Türkiye | Турция | თურქეთი', 'ua = Ukraine | Украина | უკრაინა'].map(opt) },
        { key: 'price', type: 'number', label: L('Price', 'Цена', 'ფასი'), unit: 'GEL', min: 0, decimals: 2, group: 'sale', groupLabel: L('Sale', 'Продажа', 'გაყიდვა'), sort: 20 },
        { key: 'barcode', type: 'serial', label: L('Barcode', 'Штрихкод', 'შტრიხკოდი'), group: 'sale', sort: 21 },
        { key: 'organic', type: 'bool', label: L('Organic', 'Органический', 'ორგანული'), group: 'main', sort: 4 },
      ],
      values: {},
    },
    {
      id: 'dairy', parent: 'goods', name: L('Dairy', 'Молочные продукты', 'რძის ნაწარმი'),
      fields: [
        { key: 'fat', type: 'number', label: L('Fat', 'Жирность', 'ცხიმიანობა'), unit: '%', min: 0, max: 60, decimals: 1, group: 'props', groupLabel: L('Properties', 'Свойства', 'თვისებები'), sort: 10 },
        { key: 'shelf', type: 'number', label: L('Shelf life', 'Срок годности', 'ვარგისიანობა'), unit: 'd', min: 1, group: 'props', sort: 14 },
        { key: 'storage', type: 'select', label: L('Storage', 'Хранение', 'შენახვა'), group: 'props', sort: 15,
          options: ['chilled = Chilled | Охлаждённое | გაციებული', 'frozen = Frozen | Замороженное | გაყინული'].map(opt) },
      ],
      values: { storage: 'chilled' },
    },
    {
      id: 'milk', parent: 'dairy', name: L('Milk', 'Молоко', 'რძე'),
      fields: [
        { key: 'volume', type: 'number', label: L('Volume', 'Объём', 'მოცულობა'), unit: 'l', required: true, min: 0.1, max: 10, decimals: 2, group: 'props', sort: 11 },
        { key: 'pack', type: 'select', label: L('Pack', 'Упаковка', 'შეფუთვა'), group: 'props', sort: 12,
          options: ['bottle = bottle | бутылка | ბოთლი', 'carton = Tetra Pak | тетрапак | ტეტრაპაკი', 'bag = bag | пакет | პარკი'].map(opt) },
        { key: 'lactose_free', type: 'bool', label: L('Lactose-free', 'Безлактозное', 'ულაქტოზო'), group: 'props', sort: 13 },
        { key: 'fat', required: true, max: 6 },
        { key: 'storage', hidden: true },
      ],
      values: {},
    },
    {
      id: 'cheese', parent: 'dairy', name: L('Cheese', 'Сыр', 'ყველი'),
      fields: [
        { key: 'kind', type: 'select', label: L('Kind', 'Вид', 'სახეობა'), required: true, group: 'props', sort: 9,
          options: ['sulguni = Sulguni | сулугуни | სულგუნი', 'imeruli = Imeruli | имеретинский | იმერული', 'gouda = Gouda | гауда | გაუდა'].map(opt) },
        { key: 'weight', type: 'number', label: L('Weight', 'Вес', 'წონა'), unit: 'g', required: true, min: 1, group: 'props', sort: 11 },
        { key: 'smoked', type: 'bool', label: L('Smoked', 'Копчёный', 'შებოლილი'), group: 'props', sort: 12, showIf: [{ v: 'kind', op: 'is', a: ['sulguni'] }] },
        { key: 'fat', label: L('Fat in dry matter', 'Жирность в сухом веществе', 'ცხიმი მშრალ ნივთიერებაში') },
      ],
      values: {},
    },
    {
      id: 'drinks', parent: 'goods', name: L('Drinks', 'Напитки', 'სასმელები'),
      fields: [
        { key: 'volume', type: 'number', label: L('Volume', 'Объём', 'მოცულობა'), unit: 'l', required: true, min: 0.1, max: 20, decimals: 2, group: 'props', groupLabel: L('Properties', 'Свойства', 'თვისებები'), sort: 11 },
        { key: 'sparkling', type: 'bool', label: L('Sparkling', 'Газированная', 'გაზიანი'), group: 'props', sort: 12 },
      ],
      values: {},
    },
    {
      id: 'water', parent: 'drinks', name: L('Water', 'Вода', 'წყალი'),
      fields: [
        { key: 'source', type: 'select', label: L('Source', 'Источник', 'წყარო'), group: 'props', sort: 10,
          options: ['mineral = mineral | минеральная | მინერალური', 'spring = spring | родниковая | წყაროს'].map(opt) },
        { key: 'organic', hidden: true },
        { key: 'volume', max: 19 },
      ],
      values: {},
    },
  ],
  scales: [
    { key: 'fatness', mode: 'upto', name: L('Fatness', 'Жирность словом', 'ცხიმიანობა სიტყვით'), steps: [
      { at: 1.5, name: L('low-fat', 'нежирное', 'დაბალცხიმიანი') },
      { at: 3.5, name: L('classic', 'классическое', 'კლასიკური') },
      { at: null, name: L('rich', 'жирное', 'ცხიმიანი') },
    ] },
  ],
  rules: [
    { note: 'Lactose-free milk', when: [{ v: 'path', op: 'is', a: ['milk'] }, { v: 'lactose_free', op: 'is', a: ['true'] }],
      tpl: { ru: '{brand} молоко безлактозное {fat}% · {volume} л', en: '{brand} lactose-free milk {fat}% · {volume} l', ka: '{brand} ულაქტოზო რძე {fat}% · {volume} ლ' } },
    { note: 'Milk', when: [{ v: 'path', op: 'is', a: ['milk'] }],
      tpl: { ru: '{brand} молоко {fat:fatness} {fat}% · {volume} л · {pack}', en: '{brand} {fat:fatness} milk {fat}% · {volume} l · {pack}', ka: '{brand} რძე {fat}% · {volume} ლ · {pack}' } },
    { note: 'Smoked sulguni', when: [{ v: 'path', op: 'is', a: ['cheese'] }, { v: 'kind', op: 'is', a: ['sulguni'] }, { v: 'smoked', op: 'is', a: ['true'] }],
      tpl: { ru: 'Сулугуни копчёный {brand} · {weight} г', en: 'Smoked sulguni {brand} · {weight} g', ka: 'შებოლილი სულგუნი {brand} · {weight} გ' } },
    { note: 'Cheese', when: [{ v: 'path', op: 'is', a: ['cheese'] }],
      tpl: { ru: 'Сыр {kind} {brand} · {weight} г', en: '{kind} cheese {brand} · {weight} g', ka: 'ყველი {kind} {brand} · {weight} გ' } },
    { note: 'Sparkling water', when: [{ v: 'path', op: 'is', a: ['water'] }, { v: 'sparkling', op: 'is', a: ['true'] }],
      tpl: { ru: '{brand} газированная {source} вода · {volume} л', en: '{brand} sparkling {source} water · {volume} l', ka: '{brand} გაზიანი {source} წყალი · {volume} ლ' } },
    { note: 'Water', when: [{ v: 'path', op: 'is', a: ['water'] }],
      tpl: { ru: '{brand} {source} вода · {volume} л', en: '{brand} {source} water · {volume} l', ka: '{brand} {source} წყალი · {volume} ლ' } },
    { note: 'Big packs (switched off)', off: true, when: [{ v: 'volume', op: 'min', a: ['5'] }],
      tpl: { ru: '{brand} · {volume} л · большая упаковка', en: '{brand} · {volume} l · big pack' } },
  ],
  fallback: { ru: '{brand} {name}', en: '{brand} {name}', ka: '{brand} {name}' },
  tags: [
    { id: 1, key: 'organic', label: L('Organic', 'Органик', 'ორგანული'), icon: '🌿', color: '#16a34a', where: ['unit'], fields: [], texts: [], link: '' },
    { id: 2, key: 'promo', label: L('Promotion', 'Акция', 'აქცია'), icon: '%', color: '#dc2626', where: ['unit'],
      fields: [{ key: 'discount', kind: 'number', unitText: L('%', '%', '%'), label: L('Discount', 'Скидка', 'ფასდაკლება') }],
      texts: [L('−{discount}', 'Скидка {discount}', 'ფასდაკლება {discount}')], link: '' },
    { id: 3, key: 'origin', label: L('Local product', 'Местный продукт', 'ადგილობრივი პროდუქტი'), icon: '📍', color: '#ca8a04', where: ['unit'],
      fields: [{ key: 'region', kind: 'select', label: L('Region', 'Регион', 'რეგიონი'), options: ['adjara = Adjara | Аджария | აჭარა', 'kakheti = Kakheti | Кахетия | კახეთი', 'imereti = Imereti | Имеретия | იმერეთი', 'samegrelo = Samegrelo | Самегрело | სამეგრელო'].map(opt) }],
      texts: [L('Made in {region}', 'Произведено: {region}', 'წარმოებულია: {region}')], link: '' },
  ],
  samples: [
    { id: 'g1', node: 'milk', values: { brand: 'Sante', fat: '3,2', volume: '1', pack: 'carton', price: '4.35', country: 'ge', barcode: '4860001234561' }, tags: 'origin region=kakheti', expect: 'Sante молоко классическое 3,2% · 1 л · тетрапак' },
    { id: 'g2', node: 'milk', values: { brand: 'Soplis', fat: '1,5', volume: '0,9', pack: 'bottle', lactose_free: 'yes' }, tags: 'promo discount=15', expect: 'Soplis молоко безлактозное 1,5% · 0,9 л' },
    { id: 'g3', node: 'cheese', values: { brand: 'Kvelis Sakhli', kind: 'sulguni', smoked: 'yes', weight: '300', fat: '45' }, tags: 'origin region=samegrelo', expect: 'Сулугуни копчёный Kvelis Sakhli · 300 г' },
    { id: 'g4', node: 'cheese', values: { brand: 'Tsezari', kind: 'imeruli', smoked: 'yes', weight: '500' }, tags: 'origin region=imereti', expect: 'Сыр имеретинский Tsezari · 500 г' },
    { id: 'g5', node: 'water', values: { brand: 'Borjomi', source: 'mineral', sparkling: 'yes', volume: '0,5', price: '2.10' }, tags: 'promo discount=10', expect: 'Borjomi газированная минеральная вода · 0,5 л' },
    { id: 'g6', node: 'water', values: { source: 'spring', volume: '5' }, tags: '', expect: '' },
    { id: 'g7', node: 'dairy', values: { brand: 'Ecofarm', name: 'кефир', fat: '2,5', organic: 'yes' }, tags: 'organic', expect: 'Ecofarm кефир' },
  ],
};

// DEMO_KEYS keeps the declaration order: the first key is the default demo of a fresh install.
export const DEMOS = { realty: REALTY, grocery: GROCERY };
export const DEMO_KEYS = Object.keys(DEMOS);
