// funding-studio/templates-charity.js - charity template: "Lantern Table", a fictional community kitchen in the
// fictional town of Varenholm. Two campaigns (winter meals with a matching sponsor, a delivery van) and a thank-you
// page; theme 'hearth'; en, ka, ru.
import { tplKit } from './templates-kit.js';

// Structure: T = { <lang>: { key: text } } (HTML allowed in rich keys like 'story', 'lead'); the build function makes
// the document through tplKit (t(key) -> { lang: text } with English fallback, B(type, props) -> block, page(kind,
// slug, props, blocks), scene(name, kind, hue) -> generated SVG attachment), then normalizeDoc - so a template is
// exactly as valid as any opened file. Figures (raised, donors), dates and names are invented sample data; emails
// and websites use the reserved .example TLD so they can never reach anyone.
const T = {
  en: {
    brand: 'Lantern Table', navStory: 'Our story', navMoney: 'Where money goes', navFaq: 'Questions', cta: 'Donate',
    title: 'Lantern Table — community kitchen', desc: 'Hot meals, food boxes and company for neighbours who need them in Varenholm.',
    c1: 'Warm meals this winter', c1d: 'Help us serve 6,000 hot meals between December and March.',
    eyebrow: 'Winter appeal', h1: 'Nobody in Varenholm should eat alone in the cold',
    lead: '<p>Every evening our volunteers cook for neighbours who are older, sick or simply short of money this month. Winter doubles the queue. Your gift keeps the stoves on.</p>',
    heroCta: 'Give a warm meal', heroCta2: 'Read our story',
    impT: 'What your gift does', imp1: 'one hot meal with bread and tea', imp2: 'a week of breakfasts for a child', imp3: 'a family food box for a month', imp4: 'one day of deliveries to housebound neighbours',
    storyT: 'A table with a light on', story: '<p>Lantern Table began in 2019 when six neighbours cooked soup in a borrowed church kitchen. Today 80 volunteers serve dinner five nights a week and drive food boxes to people who cannot leave home.</p><p>We buy most ingredients from farms around Varenholm, cook from scratch and sit down to eat with our guests. Nobody is asked why they came.</p><p><strong>This winter</strong> heating costs have doubled and the evening queue is longer than ever. With your help we can open two extra evenings and keep the dining hall warm until spring.</p>',
    storyCap: 'Thursday dinner at the old market hall',
    matchT: 'Every gift doubled until 31 January', sponsor: 'Mill Street Bakery', matchText: '<p>Our neighbours at Mill Street Bakery match every donation to this campaign, up to €4,000.</p>',
    donT: 'Give a warm meal', donLead: 'One-time or monthly. Every amount helps.', donBtn: 'Donate',
    donNote: '<p>Lantern Table is a fictional charity used as an example. Receipts are issued for every donation.</p>',
    progT: 'Our winter goal', ms1: 'Heating for the dining hall', ms2: 'Two extra evening shifts', ms3: 'Meals through March',
    wallT: 'Thank you, neighbours', w1: 'For the Thursday cooks!', w2: 'Keep the lights on.', w3: 'In memory of our grandmother, who fed everyone.', w4: 'Small but with love',
    updT: 'News from the kitchen', u1t: 'Second oven installed', u1: '<p>Thanks to your gifts we now cook 120 portions an hour instead of 70.</p>', u2t: 'Volunteers: 80 and counting', u2: '<p>Students from the music school joined the Saturday shift.</p>', u3t: 'Winter appeal starts', u3: '<p>Our goal: 6,000 hot meals by the end of March.</p>',
    moneyT: 'Where the money goes', moneyLead: 'We publish our spending every month.', sp1: 'Food and ingredients', sp2: 'Kitchen energy and rent', sp3: 'Delivery van', sp4: 'Volunteer training and safety', sp5: 'Administration', report: 'Monthly report (PDF)',
    faqT: 'Questions', q1: 'Do I get a receipt?', a1: '<p>Yes. Card and PayPal donations get a receipt by e-mail or on the thank-you page; for bank transfers please write the reference shown on the page.</p>',
    q2: 'Can I give every month?', a2: '<p>Choose “Monthly” above the amounts. You can stop at any time from the link in your receipt.</p>',
    q3: 'What happens to my data?', a3: '<p>We keep your name and e-mail only to send receipts and, if you agree, to show your name on the donor wall.</p>',
    q4: 'Can I help without money?', a4: '<p>Absolutely — cooks, drivers and dish-washers are always welcome. Write to us.</p>',
    shareT: 'Tell your neighbours', shareText: 'Lantern Table serves warm meals in Varenholm this winter — every gift is doubled until 31 January.',
    footText: '<p>Community kitchen, 12 Harbour Lane, Varenholm. Open Monday to Friday, 17:00–20:00.</p>', copy: '© Lantern Table (example organisation)',
    c2: 'A van for meal deliveries', c2d: 'Our old van has done 400,000 km. A new one keeps deliveries going for ten more years.',
    c2h: 'Food that comes to the door', c2lead: '<p>Forty neighbours cannot come to our dinners. Twice a week we drive to them. The van that does it is older than some of our volunteers.</p>',
    c2story: '<p>A refrigerated van keeps food boxes fresh for the longer rounds in the hills and lets us deliver three days a week instead of two.</p>',
    campsT: 'Other appeals', open: 'See the appeal',
    thxT: 'Thank you — the stove stays on', thx: '<p>Your gift is on its way to the kitchen. We will send you a short update when the winter appeal ends.</p>', thxBack: 'Back to Lantern Table',
    org: 'Lantern Table Community Kitchen', addr: '12 Harbour Lane, Varenholm', note: 'Example organisation for the template — replace with your own details.', purpose: 'Donation Lantern Table',
  },
  ka: {
    brand: 'Lantern Table', navStory: 'ჩვენი ამბავი', navMoney: 'სად მიდის თანხა', navFaq: 'კითხვები', cta: 'შეწირვა',
    title: 'Lantern Table — სათემო სამზარეულო', desc: 'ცხელი კერძები, სასურსათო ყუთები და თანადგომა ვარენჰოლმის მეზობლებისთვის.',
    c1: 'თბილი ვახშამი ამ ზამთარს', c1d: 'დაგვეხმარეთ დეკემბრიდან მარტამდე 6 000 ცხელი კერძის მომზადებაში.',
    eyebrow: 'ზამთრის კამპანია', h1: 'ვარენჰოლმში არავინ უნდა ჭამდეს მარტო, სიცივეში',
    lead: '<p>ყოველ საღამოს ჩვენი მოხალისეები ამზადებენ საჭმელს ხანდაზმული, ავადმყოფი ან ამ თვეს ფულის გარეშე დარჩენილი მეზობლებისთვის. ზამთარში რიგი ორმაგდება. თქვენი შემოწირულობა ქურას ანთებულს ინახავს.</p>',
    heroCta: 'აჩუქეთ თბილი ვახშამი', heroCta2: 'ჩვენი ამბავი',
    impT: 'რას აკეთებს თქვენი შემოწირულობა', imp1: 'ერთი ცხელი კერძი პურითა და ჩაით', imp2: 'ერთი კვირის საუზმე ბავშვისთვის', imp3: 'ოჯახის სასურსათო ყუთი ერთი თვით', imp4: 'ერთი დღის მიწოდება სახლიდან ვერგამსვლელ მეზობლებთან',
    storyT: 'სუფრა ანთებული შუქით', story: '<p>Lantern Table 2019 წელს დაიწყო, როცა ექვსმა მეზობელმა ნათხოვარ სამზარეულოში წვნიანი მოხარშა. დღეს 80 მოხალისე კვირაში ხუთ საღამოს ვახშამს ამზადებს და სასურსათო ყუთებს მათთან მიაქვს, ვისაც სახლიდან გასვლა არ შეუძლია.</p><p>ინგრედიენტების უმეტესობას ვარენჰოლმის შემოგარენის ფერმებიდან ვყიდულობთ, ყველაფერს თავიდან ვამზადებთ და სტუმრებთან ერთად ვსხდებით სუფრასთან. არავის ვეკითხებით, რატომ მოვიდა.</p><p><strong>ამ ზამთარს</strong> გათბობის ხარჯი გაორმაგდა, საღამოს რიგი კი არასდროს ყოფილა ასეთი გრძელი. თქვენი დახმარებით ორ დამატებით საღამოს გავხსნით და სასადილოს გაზაფხულამდე გავათბობთ.</p>',
    storyCap: 'ხუთშაბათის ვახშამი ძველ საბაზრო დარბაზში',
    matchT: 'ყოველი შემოწირულობა ორმაგდება 31 იანვრამდე', sponsor: 'Mill Street Bakery', matchText: '<p>ჩვენი მეზობელი საცხობი Mill Street Bakery ამ კამპანიის ყოველ შემოწირულობას აორმაგებს 4 000 €-მდე.</p>',
    donT: 'აჩუქეთ თბილი ვახშამი', donLead: 'ერთჯერადად ან ყოველთვიურად. ნებისმიერი თანხა გვეხმარება.', donBtn: 'შეწირვა',
    donNote: '<p>Lantern Table მაგალითისთვის მოგონილი ორგანიზაციაა. ყოველ შემოწირულობაზე გაიცემა ქვითარი.</p>',
    progT: 'ჩვენი ზამთრის მიზანი', ms1: 'სასადილოს გათბობა', ms2: 'ორი დამატებითი საღამო', ms3: 'ვახშამი მარტის ბოლომდე',
    wallT: 'გმადლობთ, მეზობლებო', w1: 'ხუთშაბათის მზარეულებს!', w2: 'შუქი არ ჩაქრეს.', w3: 'ბებიის ხსოვნას, რომელიც ყველას აპურებდა.', w4: 'ცოტა, მაგრამ სიყვარულით',
    updT: 'ამბები სამზარეულოდან', u1t: 'დაიდგა მეორე ღუმელი', u1: '<p>თქვენი შემოწირულობებით ახლა საათში 70-ის ნაცვლად 120 პორციას ვამზადებთ.</p>', u2t: 'მოხალისეები: უკვე 80', u2: '<p>შაბათის ცვლას მუსიკალური სკოლის სტუდენტები შემოუერთდნენ.</p>', u3t: 'იწყება ზამთრის კამპანია', u3: '<p>ჩვენი მიზანი: 6 000 ცხელი კერძი მარტის ბოლომდე.</p>',
    moneyT: 'სად მიდის თანხა', moneyLead: 'ხარჯებს ყოველთვიურად ვაქვეყნებთ.', sp1: 'საკვები და ინგრედიენტები', sp2: 'სამზარეულოს ენერგია და ქირა', sp3: 'მიწოდების ფურგონი', sp4: 'მოხალისეების სწავლება და უსაფრთხოება', sp5: 'ადმინისტრაცია', report: 'ყოველთვიური ანგარიში (PDF)',
    faqT: 'კითხვები', q1: 'მივიღებ ქვითარს?', a1: '<p>დიახ. ბარათით და PayPal-ით შემოწირულობებზე ქვითარი მოდის ელფოსტით ან მადლობის გვერდზე; საბანკო გადარიცხვისას მიუთითეთ გვერდზე ნაჩვენები დანიშნულება.</p>',
    q2: 'შემიძლია ყოველთვიურად შევწირო?', a2: '<p>აირჩიეთ „ყოველთვიურად“ თანხების ზემოთ. შეწყვეტა ნებისმიერ დროს შეგიძლიათ ქვითრის ბმულიდან.</p>',
    q3: 'რა ხდება ჩემს მონაცემებთან?', a3: '<p>თქვენს სახელსა და ელფოსტას ვინახავთ მხოლოდ ქვითრების გასაგზავნად და, თქვენი თანხმობით, დონორების კედელზე სახელის საჩვენებლად.</p>',
    q4: 'შემიძლია დავეხმარო ფულის გარეშე?', a4: '<p>რა თქმა უნდა — მზარეულები, მძღოლები და ჭურჭლის მრეცხავები ყოველთვის გვჭირდება. მოგვწერეთ.</p>',
    shareT: 'უთხარით მეზობლებს', shareText: 'Lantern Table ამ ზამთარს ვარენჰოლმში თბილ ვახშამს ამზადებს — ყოველი შემოწირულობა 31 იანვრამდე ორმაგდება.',
    footText: '<p>სათემო სამზარეულო, ჰარბორ ლეინი 12, ვარენჰოლმი. ღიაა ორშაბათიდან პარასკევამდე, 17:00–20:00.</p>', copy: '© Lantern Table (მაგალითის ორგანიზაცია)',
    c2: 'ფურგონი საკვების მისაწოდებლად', c2d: 'ჩვენმა ძველმა ფურგონმა 400 000 კმ გაიარა. ახალი კიდევ ათი წელი უზრუნველყოფს მიწოდებას.',
    c2h: 'საკვები, რომელიც კარამდე მიდის', c2lead: '<p>ორმოც მეზობელს ჩვენს ვახშამზე მოსვლა არ შეუძლია. კვირაში ორჯერ ჩვენ მივდივართ მათთან. ფურგონი, რომლითაც ამას ვაკეთებთ, ზოგიერთ მოხალისეზე უფროსია.</p>',
    c2story: '<p>მაცივრიანი ფურგონი სასურსათო ყუთებს მთაში გრძელ გზაზეც ახალს შეინახავს და კვირაში ორის ნაცვლად სამ დღეს მივიტანთ საკვებს.</p>',
    campsT: 'სხვა კამპანიები', open: 'კამპანიის ნახვა',
    thxT: 'გმადლობთ — ქურა ანთებული რჩება', thx: '<p>თქვენი შემოწირულობა სამზარეულოსკენ მიემართება. ზამთრის კამპანიის დასრულებისას მოკლე ამბავს გამოგიგზავნით.</p>', thxBack: 'Lantern Table-ზე დაბრუნება',
    org: 'Lantern Table — სათემო სამზარეულო', addr: 'ჰარბორ ლეინი 12, ვარენჰოლმი', note: 'შაბლონის მაგალითის ორგანიზაცია — ჩაანაცვლეთ თქვენი მონაცემებით.', purpose: 'შემოწირულობა Lantern Table',
  },
  ru: {
    brand: 'Lantern Table', navStory: 'Наша история', navMoney: 'Куда идут деньги', navFaq: 'Вопросы', cta: 'Помочь',
    title: 'Lantern Table — общественная кухня', desc: 'Горячая еда, продуктовые наборы и общение для соседей в Варенхольме, которым это нужно.',
    c1: 'Тёплый ужин этой зимой', c1d: 'Помогите нам приготовить 6 000 горячих обедов с декабря по март.',
    eyebrow: 'Зимний сбор', h1: 'В Варенхольме никто не должен есть один на холоде',
    lead: '<p>Каждый вечер наши волонтёры готовят для пожилых, больных и тех, кому в этом месяце просто не хватает денег. Зимой очередь удваивается. Ваше пожертвование не даёт плите погаснуть.</p>',
    heroCta: 'Подарить тёплый ужин', heroCta2: 'Наша история',
    impT: 'Что даёт ваш вклад', imp1: 'один горячий обед с хлебом и чаем', imp2: 'неделя завтраков для ребёнка', imp3: 'продуктовый набор для семьи на месяц', imp4: 'день доставки соседям, которые не выходят из дома',
    storyT: 'Стол, где горит свет', story: '<p>Lantern Table появился в 2019 году, когда шестеро соседей сварили суп на чужой кухне. Сегодня 80 волонтёров кормят ужином пять вечеров в неделю и развозят наборы тем, кто не может выйти из дома.</p><p>Почти все продукты мы покупаем у ферм вокруг Варенхольма, готовим сами и садимся за стол вместе с гостями. Никого не спрашивают, почему он пришёл.</p><p><strong>Этой зимой</strong> отопление подорожало вдвое, а вечерняя очередь длиннее, чем когда-либо. С вашей помощью мы откроем ещё два вечера и будем греть зал до весны.</p>',
    storyCap: 'Ужин в четверг в старом рыночном зале',
    matchT: 'Каждое пожертвование удваивается до 31 января', sponsor: 'Mill Street Bakery', matchText: '<p>Наши соседи из пекарни Mill Street Bakery удваивают каждое пожертвование этому сбору — до 4 000 €.</p>',
    donT: 'Подарите тёплый ужин', donLead: 'Разово или ежемесячно. Помогает любая сумма.', donBtn: 'Пожертвовать',
    donNote: '<p>Lantern Table — вымышленная организация для примера. На каждое пожертвование выдаётся квитанция.</p>',
    progT: 'Наша зимняя цель', ms1: 'Отопление обеденного зала', ms2: 'Две дополнительные вечерние смены', ms3: 'Ужины до конца марта',
    wallT: 'Спасибо, соседи', w1: 'Поварам четверга!', w2: 'Пусть свет не гаснет.', w3: 'В память о бабушке, которая кормила всех.', w4: 'Немного, но с любовью',
    updT: 'Новости с кухни', u1t: 'Установили вторую печь', u1: '<p>Благодаря вам мы готовим 120 порций в час вместо 70.</p>', u2t: 'Волонтёров уже 80', u2: '<p>К субботней смене присоединились студенты музыкальной школы.</p>', u3t: 'Начинается зимний сбор', u3: '<p>Наша цель — 6 000 горячих обедов до конца марта.</p>',
    moneyT: 'Куда идут деньги', moneyLead: 'Мы публикуем расходы каждый месяц.', sp1: 'Продукты', sp2: 'Энергия и аренда кухни', sp3: 'Фургон доставки', sp4: 'Обучение и безопасность волонтёров', sp5: 'Администрирование', report: 'Ежемесячный отчёт (PDF)',
    faqT: 'Вопросы', q1: 'Я получу квитанцию?', a1: '<p>Да. За пожертвования картой и через PayPal квитанция приходит по e-mail или на странице благодарности; при банковском переводе укажите назначение с этой страницы.</p>',
    q2: 'Можно жертвовать каждый месяц?', a2: '<p>Выберите «Ежемесячно» над суммами. Остановить можно в любой момент по ссылке из квитанции.</p>',
    q3: 'Что будет с моими данными?', a3: '<p>Имя и e-mail мы храним только для квитанций и, если вы согласны, чтобы показать имя на стене доноров.</p>',
    q4: 'Можно помочь не деньгами?', a4: '<p>Конечно — повара, водители и посудомойщики нужны всегда. Напишите нам.</p>',
    shareT: 'Расскажите соседям', shareText: 'Lantern Table этой зимой кормит горячим ужином в Варенхольме — каждое пожертвование удваивается до 31 января.',
    footText: '<p>Общественная кухня, Харбор-лейн, 12, Варенхольм. Открыто с понедельника по пятницу, 17:00–20:00.</p>', copy: '© Lantern Table (пример организации)',
    c2: 'Фургон для доставки еды', c2d: 'Наш старый фургон прошёл 400 000 км. Новый обеспечит доставку ещё на десять лет.',
    c2h: 'Еда, которая приезжает к двери', c2lead: '<p>Сорок соседей не могут прийти на наши ужины. Дважды в неделю мы едем к ним сами. Фургон, на котором мы ездим, старше некоторых наших волонтёров.</p>',
    c2story: '<p>Рефрижераторный фургон сохранит наборы свежими на длинных маршрутах по холмам, и мы сможем возить еду три дня в неделю вместо двух.</p>',
    campsT: 'Другие сборы', open: 'Открыть сбор',
    thxT: 'Спасибо — плита не гаснет', thx: '<p>Ваше пожертвование уже на пути к кухне. Когда зимний сбор закончится, мы пришлём короткий отчёт.</p>', thxBack: 'Вернуться в Lantern Table',
    org: 'Общественная кухня Lantern Table', addr: 'Харбор-лейн, 12, Варенхольм', note: 'Пример организации для шаблона — замените своими данными.', purpose: 'Пожертвование Lantern Table',
  },
};

function tplBuildCharity(V) {
  const langs = ['en', 'ka', 'ru'];
  const K = tplKit(V, langs, T);
  const { t, B, item, page } = K;
  const d = K.doc({
    name: 'Lantern Table', preset: 'hearth', title: t('title'), description: t('desc'),
    org: { name: t('org'), email: 'hello@lantern-table.example', website: 'https://lantern-table.example', address: t('addr'), regNo: 'VH-2019-0412', note: t('note') },
  });
  d.pay.bank.purpose = t('purpose');
  const kitchen = K.scene('winter-kitchen', 'kitchen', 18);
  const people = K.scene('volunteers', 'people', 24);
  const van = K.scene('delivery-van', 'van', 12);
  const pdf = K.addAtt({
    name: 'lantern-table-report.pdf', mime: 'application/pdf', title: t('report'),
    data: K.files.makePDF('Lantern Table — monthly report (example)', ['Example spending report of a fictional organisation.', '', 'Food and ingredients: 6,820 EUR', 'Kitchen energy and rent: 2,140 EUR', 'Delivery van: 960 EUR', 'Volunteer training and safety: 410 EUR', 'Administration: 520 EUR'], { accent: '#c2410c' }),
  });
  d.regions.header = [B('nav', {
    brand: t('brand'), cta: t('cta'), ctaHref: '#donate',
    items: [item({ label: t('navStory'), href: '#story' }), item({ label: t('navMoney'), href: '#money' }), item({ label: t('navFaq'), href: '#faq' })],
  })];
  const c1 = page('campaign', 'winter-meals', {
    title: t('c1'), metaDesc: t('c1d'), image: kitchen, currency: 'EUR', currencies: ['USD'], goal: 18000, raised: 11240, donors: 312,
    end: '2027-03-31', endTime: '23:59', tz: 1, methods: ['stripe', 'paypal', 'bank', 'btc', 'eth'],
  }, [
    B('hero', { layout: 'split', eyebrow: t('eyebrow'), title: t('h1'), lead: t('lead'), image: kitchen, progress: true, cta: t('heroCta'), ctaHref: '#donate', cta2: t('heroCta2'), cta2Href: '#story' }),
    B('impact', { title: t('impT'), items: [item({ amount: 5, text: t('imp1'), icon: 'heart' }), item({ amount: 25, text: t('imp2'), icon: 'sprout' }), item({ amount: 60, text: t('imp3'), icon: 'gift' }), item({ amount: 150, text: t('imp4'), icon: 'home' })] }),
    B('story', { anchor: 'story', title: t('storyT'), html: t('story'), image: people, side: 'right', caption: t('storyCap') }),
    B('matching', { title: t('matchT'), sponsor: t('sponsor'), text: t('matchText'), ratio: 1, cap: 4000, until: '2027-01-31' }),
    B('donate', { anchor: 'donate', title: t('donT'), lead: t('donLead'), button: t('donBtn'), note: t('donNote'), amounts: [10, 25, 60, 150], defAmount: 25 }),
    B('progress', { title: t('progT'), style: 'big', items: [item({ amount: 6000, label: t('ms1') }), item({ amount: 12000, label: t('ms2') }), item({ amount: 18000, label: t('ms3') })] }),
    B('wall', { title: t('wallT'), sort: 'recent', count: 8, items: [
      item({ name: 'Nino K.', amount: 60, message: 'For the Thursday cooks!', date: '2026-12-14' }), item({ name: '', anon: true, amount: 25, message: '', date: '2026-12-13' }),
      item({ name: 'The Ferrand family', amount: 150, message: 'In memory of our grandmother, who fed everyone.', date: '2026-12-11' }), item({ name: 'Tomas R.', amount: 10, message: 'Small but with love', date: '2026-12-10' }),
    ] }),
    B('updates', { title: t('updT'), items: [item({ date: '2026-12-12', title: t('u1t'), html: t('u1') }), item({ date: '2026-11-28', title: t('u2t'), html: t('u2') }), item({ date: '2026-11-15', title: t('u3t'), html: t('u3') })] }),
    B('section', { anchor: 'money', tone: 'muted', blocks: [B('transparency', { title: t('moneyT'), lead: t('moneyLead'), report: pdf, reportLabel: t('report'), updated: '2026-12-01', items: [
      item({ label: t('sp1'), planned: 11000, spent: 6820 }), item({ label: t('sp2'), planned: 3200, spent: 2140 }), item({ label: t('sp3'), planned: 1600, spent: 960 }),
      item({ label: t('sp4'), planned: 900, spent: 410 }), item({ label: t('sp5'), planned: 1300, spent: 520 }),
    ] })] }),
    B('faq', { anchor: 'faq', title: t('faqT'), single: true, items: [item({ q: t('q1'), a: t('a1') }), item({ q: t('q2'), a: t('a2') }), item({ q: t('q3'), a: t('a3') }), item({ q: t('q4'), a: t('a4') })] }),
    B('share', { title: t('shareT'), text: t('shareText'), nets: ['native', 'copy', 'facebook', 'telegram', 'whatsapp', 'email', 'qr'] }),
    B('campaigns', { title: t('campsT'), cta: t('open'), show: 'others' }),
  ]);
  const c2 = page('campaign', 'delivery-van', {
    title: t('c2'), metaDesc: t('c2d'), image: van, currency: 'EUR', goal: 32000, raised: 9800, donors: 141, end: '2027-06-30', tz: 1, methods: ['stripe', 'paypal', 'bank'],
  }, [
    B('hero', { layout: 'center', eyebrow: t('brand'), title: t('c2h'), lead: t('c2lead'), progress: true, cta: t('heroCta'), ctaHref: '#donate' }),
    B('story', { title: t('c2'), html: t('c2story'), image: van, side: 'left' }),
    B('donate', { anchor: 'donate', title: t('donT'), lead: t('donLead'), button: t('donBtn'), amounts: [20, 50, 100, 250], defAmount: 50, intervals: 'once' }),
    B('share', { title: t('shareT'), text: t('c2d'), nets: ['native', 'copy', 'facebook', 'whatsapp', 'email'] }),
    B('campaigns', { title: t('campsT'), cta: t('open'), show: 'others' }),
  ]);
  const thanks = page('thanks', 'thanks', { title: t('thxT') }, [
    B('thanks', { title: t('thxT'), text: t('thx'), back: t('thxBack'), summary: true }),
    B('share', { title: t('shareT'), text: t('shareText'), nets: ['native', 'copy', 'facebook', 'telegram', 'whatsapp'] }),
  ]);
  d.regions.main = [c1, c2, thanks];
  d.regions.footer = [B('footer', { showOrg: true, text: t('footText'), copy: t('copy'), items: [item({ label: t('navMoney'), href: '#money' }), item({ label: t('navFaq'), href: '#faq' })] })];
  return V.normalizeDoc(d);
}

export const TPL_CHARITY = {
  id: 'charity',
  name: { en: 'Charity', ru: 'Благотворительность', uk: 'Благодійність', de: 'Wohltätigkeit', fr: 'Association caritative', es: 'Beneficencia', ka: 'ქველმოქმედება' },
  desc: {
    en: 'A community kitchen: winter appeal with a matching sponsor, impact lines, donor wall, spending report; a second campaign for a van.',
    ru: 'Общественная кухня: зимний сбор с удвоением, «что даёт сумма», стена доноров, отчёт о расходах; второй сбор на фургон.',
    uk: 'Громадська кухня: зимовий збір з подвоєнням, «що дає сума», стіна донорів, звіт про витрати; другий збір на фургон.',
    de: 'Eine Gemeinschaftsküche: Winteraufruf mit Verdopplung, Wirkungszeilen, Spenderwand, Ausgabenbericht; zweite Kampagne für einen Lieferwagen.',
    fr: 'Une cuisine solidaire : appel d’hiver avec doublement, impact par montant, mur des donateurs, rapport de dépenses ; seconde campagne pour une camionnette.',
    es: 'Una cocina comunitaria: campaña de invierno con donaciones duplicadas, impacto por importe, muro de donantes, informe de gastos; otra campaña para una furgoneta.',
    ka: 'სათემო სამზარეულო: ზამთრის კამპანია გაორმაგებით, თანხის გავლენა, დონორების კედელი, ხარჯების ანგარიში; მეორე კამპანია ფურგონისთვის.',
  },
  langs: ['en', 'ka', 'ru'],
  build: tplBuildCharity,
};
