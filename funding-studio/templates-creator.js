// funding-studio/templates-creator.js - creator template: "Mira Kalden", a fictional illustrator funding a printed
// travel sketchbook (reward tiers with limits, countdown, backer wall, studio updates); theme 'studio'; en, es, uk.
import { tplKit } from './templates-kit.js';

// Structure: T = { <lang>: { key: text } } (HTML allowed in rich keys like 'story', 'lead'); the build function makes
// the document through tplKit (t(key) -> { lang: text } with English fallback, B(type, props) -> block, page(kind,
// slug, props, blocks), scene(name, kind, hue) -> generated SVG attachment), then normalizeDoc - so a template is
// exactly as valid as any opened file. Figures (raised, donors), dates and names are invented sample data; emails
// and websites use the reserved .example TLD so they can never reach anyone.
const T = {
  en: {
    brand: 'Mira Kalden', navRewards: 'Rewards', navUpdates: 'Studio notes', cta: 'Back the book',
    title: 'The Salt Road Sketchbook — Mira Kalden', desc: 'Help print a 160-page illustrated journal of a walk along an old trade road.',
    c1: 'The Salt Road Sketchbook', c1d: 'A 160-page printed travel journal, drawn on the road.',
    eyebrow: 'Illustrated travel journal', h1: 'Help me print the Salt Road Sketchbook',
    lead: '<p>For three months I walked an old salt-trading road through hills and coastal villages, drawing every day. 140 drawings and notes became a book. Your support pays for the first print run on good paper.</p>',
    heroCta: 'Choose a reward', heroCta2: 'Read the studio notes',
    rewT: 'Rewards', rewLead: 'Every reward includes your name in the book (if you like).',
    r1: 'Postcard set', r1x: '<p>Six postcards with drawings from the road, sent with a handwritten note.</p>',
    r2: 'Signed print', r2x: '<p>An A4 giclée print of a drawing you choose, signed and numbered.</p>',
    r3: 'The sketchbook', r3x: '<p>The printed book, signed, plus the postcard set.</p>', r3b: 'Most popular',
    r4: 'Your town, drawn', r4x: '<p>I draw a street of your town for the book’s last pages, and you get the original.</p>', r4b: 'Limited',
    cdT: 'The campaign closes in', cdDone: 'The campaign has closed — thank you for making the book happen!',
    donT: 'Support without a reward', donLead: 'Any amount helps the print run. You can also give monthly to support new journals.', donBtn: 'Support',
    donNote: '<p>Mira Kalden is a fictional artist used as an example. Rewards ship after printing.</p>',
    storyT: 'Why print it?', story: '<p>Screens flatten drawings. On paper you see the watercolour bleeding into the grain and the pencil lines I did not erase. I want this book to feel like the notebook I carried.</p><p>The print run of 500 copies is ready to go to a small family printer as soon as the goal is reached.</p>',
    wallT: 'Backers', updT: 'Studio notes', u1t: 'Paper samples arrived', u1: '<p>We picked a warm, uncoated 150 g paper — the watercolours look right on it.</p>', u2t: 'Halfway there!', u2: '<p>Thank you all. The book will have a fabric spine.</p>',
    faqT: 'Questions', q1: 'When will the rewards arrive?', a1: '<p>Postcards ship within a month after the campaign; books about three months after it ends.</p>', q2: 'Do you ship worldwide?', a2: '<p>Yes. Shipping is included in the reward price.</p>',
    shareT: 'Share the journey', shareText: 'Mira Kalden is printing an illustrated travel journal — have a look at the rewards.',
    copy: '© Mira Kalden (example artist)', footText: '<p>Illustration and travel journals. This page is an example template.</p>',
    thxT: 'Thank you for backing the sketchbook!', thx: '<p>I will draw a little thank-you on your postcard. Updates come by e-mail when the book goes to print.</p>', thxBack: 'Back to the campaign',
    org: 'Mira Kalden Studio', addr: 'Old Port Studios, Calder', note: 'Example artist for the template — replace with your own details.', purpose: 'Salt Road Sketchbook',
  },
  es: {
    brand: 'Mira Kalden', navRewards: 'Recompensas', navUpdates: 'Notas del estudio', cta: 'Apoyar el libro',
    title: 'El cuaderno del Camino de la Sal — Mira Kalden', desc: 'Ayuda a imprimir un diario ilustrado de 160 páginas sobre un antiguo camino comercial.',
    c1: 'El cuaderno del Camino de la Sal', c1d: 'Un diario de viaje impreso de 160 páginas, dibujado en el camino.',
    eyebrow: 'Diario de viaje ilustrado', h1: 'Ayúdame a imprimir el cuaderno del Camino de la Sal',
    lead: '<p>Durante tres meses recorrí a pie un antiguo camino de la sal entre colinas y pueblos de costa, dibujando cada día. 140 dibujos y notas se convirtieron en un libro. Tu apoyo paga la primera tirada en buen papel.</p>',
    heroCta: 'Elegir una recompensa', heroCta2: 'Leer las notas del estudio',
    rewT: 'Recompensas', rewLead: 'Todas incluyen tu nombre en el libro (si quieres).',
    r1: 'Juego de postales', r1x: '<p>Seis postales con dibujos del camino y una nota escrita a mano.</p>',
    r2: 'Lámina firmada', r2x: '<p>Una lámina giclée A4 del dibujo que elijas, firmada y numerada.</p>',
    r3: 'El cuaderno', r3x: '<p>El libro impreso y firmado, más el juego de postales.</p>', r3b: 'El más elegido',
    r4: 'Tu pueblo, dibujado', r4x: '<p>Dibujo una calle de tu pueblo para las últimas páginas del libro y te quedas con el original.</p>', r4b: 'Limitado',
    cdT: 'La campaña termina en', cdDone: 'La campaña ha terminado: ¡gracias por hacer posible el libro!',
    donT: 'Apoyar sin recompensa', donLead: 'Cualquier importe ayuda a la tirada. También puedes apoyar cada mes los próximos diarios.', donBtn: 'Apoyar',
    donNote: '<p>Mira Kalden es una artista ficticia usada como ejemplo. Las recompensas se envían después de imprimir.</p>',
    storyT: '¿Por qué en papel?', story: '<p>Las pantallas aplanan los dibujos. En papel se ve la acuarela fundiéndose con el grano y las líneas de lápiz que no borré. Quiero que el libro se sienta como el cuaderno que llevé.</p><p>La tirada de 500 ejemplares está lista para una pequeña imprenta familiar en cuanto lleguemos a la meta.</p>',
    wallT: 'Mecenas', updT: 'Notas del estudio', u1t: 'Llegaron las muestras de papel', u1: '<p>Elegimos un papel cálido sin estucar de 150 g: las acuarelas quedan bien.</p>', u2t: '¡Ya vamos por la mitad!', u2: '<p>Gracias a todos. El libro tendrá lomo de tela.</p>',
    faqT: 'Preguntas', q1: '¿Cuándo llegan las recompensas?', a1: '<p>Las postales salen en el mes siguiente a la campaña; los libros, unos tres meses después del cierre.</p>', q2: '¿Envías a todo el mundo?', a2: '<p>Sí. El envío está incluido en el precio de la recompensa.</p>',
    shareT: 'Comparte el viaje', shareText: 'Mira Kalden imprime un diario de viaje ilustrado: mira las recompensas.',
    copy: '© Mira Kalden (artista de ejemplo)', footText: '<p>Ilustración y diarios de viaje. Esta página es una plantilla de ejemplo.</p>',
    thxT: '¡Gracias por apoyar el cuaderno!', thx: '<p>Te dibujaré un pequeño agradecimiento en la postal. Recibirás novedades por correo cuando el libro vaya a imprenta.</p>', thxBack: 'Volver a la campaña',
    org: 'Estudio Mira Kalden', addr: 'Old Port Studios, Calder', note: 'Artista de ejemplo de la plantilla: sustituye los datos por los tuyos.', purpose: 'Cuaderno Camino de la Sal',
  },
  uk: {
    brand: 'Mira Kalden', navRewards: 'Нагороди', navUpdates: 'Нотатки студії', cta: 'Підтримати книгу',
    title: 'Скетчбук Соляного шляху — Mira Kalden', desc: 'Допоможіть надрукувати 160-сторінковий ілюстрований щоденник подорожі старим торговим шляхом.',
    c1: 'Скетчбук Соляного шляху', c1d: 'Друкований щоденник подорожі на 160 сторінок, намальований у дорозі.',
    eyebrow: 'Ілюстрований щоденник подорожі', h1: 'Допоможіть надрукувати скетчбук Соляного шляху',
    lead: '<p>Три місяці я йшла старим соляним шляхом крізь пагорби та прибережні села і малювала щодня. 140 малюнків і нотаток стали книгою. Ваша підтримка оплачує перший наклад на гарному папері.</p>',
    heroCta: 'Обрати нагороду', heroCta2: 'Читати нотатки студії',
    rewT: 'Нагороди', rewLead: 'Кожна нагорода — це й ваше ім’я в книзі (якщо хочете).',
    r1: 'Набір листівок', r1x: '<p>Шість листівок із малюнками з дороги та записка від руки.</p>',
    r2: 'Підписаний принт', r2x: '<p>Принт A4 (жиклє) обраного малюнка, підписаний і пронумерований.</p>',
    r3: 'Скетчбук', r3x: '<p>Надрукована книга з підписом і набір листівок.</p>', r3b: 'Найпопулярніше',
    r4: 'Ваше місто, намальоване', r4x: '<p>Я намалюю вулицю вашого міста для останніх сторінок книги, а оригінал отримаєте ви.</p>', r4b: 'Обмежено',
    cdT: 'Кампанія закінчиться через', cdDone: 'Кампанія завершилася — дякую, що книга стала можливою!',
    donT: 'Підтримати без нагороди', donLead: 'Будь-яка сума допомагає накладу. Можна також підтримувати нові щоденники щомісяця.', donBtn: 'Підтримати',
    donNote: '<p>Mira Kalden — вигадана художниця для прикладу. Нагороди надсилаються після друку.</p>',
    storyT: 'Навіщо друкувати?', story: '<p>Екрани роблять малюнки пласкими. На папері видно, як акварель розтікається по зерну, і олівцеві лінії, які я не стерла. Я хочу, щоб книга відчувалася як блокнот, що був зі мною.</p><p>Наклад у 500 примірників готовий піти до маленької сімейної друкарні, щойно ми досягнемо мети.</p>',
    wallT: 'Меценати', updT: 'Нотатки студії', u1t: 'Прийшли зразки паперу', u1: '<p>Ми обрали теплий некрейдований папір 150 г — акварелі на ньому виглядають як треба.</p>', u2t: 'Пів шляху позаду!', u2: '<p>Дякую всім. Книга матиме тканинний корінець.</p>',
    faqT: 'Питання', q1: 'Коли прийдуть нагороди?', a1: '<p>Листівки — протягом місяця після кампанії, книги — приблизно через три місяці після її завершення.</p>', q2: 'Ви надсилаєте по всьому світу?', a2: '<p>Так. Доставку включено у вартість нагороди.</p>',
    shareT: 'Поділіться подорожжю', shareText: 'Mira Kalden друкує ілюстрований щоденник подорожі — подивіться нагороди.',
    copy: '© Mira Kalden (художниця для прикладу)', footText: '<p>Ілюстрація та щоденники подорожей. Ця сторінка — шаблон для прикладу.</p>',
    thxT: 'Дякую, що підтримали скетчбук!', thx: '<p>Я намалюю маленьку подяку на вашій листівці. Новини надійдуть e-mail, коли книга піде в друк.</p>', thxBack: 'Повернутися до кампанії',
    org: 'Студія Mira Kalden', addr: 'Old Port Studios, Калдер', note: 'Художниця для прикладу — замініть даними про себе.', purpose: 'Скетчбук Соляного шляху',
  },
};

function tplBuildCreator(V) {
  const langs = ['en', 'es', 'uk'];
  const K = tplKit(V, langs, T);
  const { t, B, item, page } = K;
  const d = K.doc({
    name: 'Salt Road Sketchbook', preset: 'studio', title: t('title'), description: t('desc'),
    org: { name: t('org'), email: 'studio@mira-kalden.example', website: 'https://mira-kalden.example', address: t('addr'), note: t('note') },
  });
  d.pay.bank.purpose = t('purpose');
  d.pay.eth.chains = [1, 8453];
  const art = K.scene('salt-road', 'sketch', 330);
  d.regions.header = [B('nav', { brand: t('brand'), cta: t('cta'), ctaHref: '#rewards', items: [item({ label: t('navRewards'), href: '#rewards' }), item({ label: t('navUpdates'), href: '#notes' })] })];
  const c1 = page('campaign', 'sketchbook', {
    title: t('c1'), metaDesc: t('c1d'), image: art, currency: 'EUR', currencies: ['USD', 'UAH'], goal: 9000, raised: 5420, donors: 168,
    end: '2027-04-30', endTime: '20:00', tz: 2, methods: ['stripe', 'paypal', 'eth'],
  }, [
    B('hero', { layout: 'cover', eyebrow: t('eyebrow'), title: t('h1'), lead: t('lead'), image: art, progress: true, cta: t('heroCta'), ctaHref: '#rewards', cta2: t('heroCta2'), cta2Href: '#notes' }),
    B('countdown', { title: t('cdT'), done: t('cdDone') }),
    B('tiers', { anchor: 'rewards', title: t('rewT'), lead: t('rewLead'), interval: 'once', items: [
      item({ amount: 15, title: t('r1'), text: t('r1x') }), item({ amount: 40, title: t('r2'), text: t('r2x') }),
      item({ amount: 65, title: t('r3'), text: t('r3x'), badge: t('r3b'), limit: 300, claimed: 112 }), item({ amount: 250, title: t('r4'), text: t('r4x'), badge: t('r4b'), limit: 10, claimed: 7 }),
    ] }),
    B('story', { title: t('storyT'), html: t('story'), image: art, side: 'left' }),
    B('donate', { anchor: 'donate', title: t('donT'), lead: t('donLead'), button: t('donBtn'), note: t('donNote'), amounts: [15, 40, 65, 250], defAmount: 40, intervals: 'both' }),
    B('wall', { title: t('wallT'), sort: 'recent', count: 9, items: [
      item({ name: 'Lucía P.', amount: 65, message: '¡Qué ganas de tenerlo!', date: '2026-10-11' }), item({ name: 'Ostap V.', amount: 40, message: '', date: '2026-10-10' }),
      item({ name: 'Hanna B.', amount: 250, message: 'Draw the harbour, please!', date: '2026-10-09' }), item({ name: '', anon: true, amount: 15, message: '', date: '2026-10-08' }),
    ] }),
    B('updates', { anchor: 'notes', title: t('updT'), items: [item({ date: '2026-10-08', title: t('u1t'), html: t('u1') }), item({ date: '2026-10-01', title: t('u2t'), html: t('u2') })] }),
    B('faq', { title: t('faqT'), items: [item({ q: t('q1'), a: t('a1') }), item({ q: t('q2'), a: t('a2') })] }),
    B('share', { title: t('shareT'), text: t('shareText'), nets: ['native', 'copy', 'x', 'facebook', 'whatsapp', 'qr'] }),
  ]);
  const thanks = page('thanks', 'thanks', { title: t('thxT') }, [B('thanks', { title: t('thxT'), text: t('thx'), back: t('thxBack'), summary: true })]);
  d.regions.main = [c1, thanks];
  d.regions.footer = [B('footer', { showOrg: false, text: t('footText'), copy: t('copy') })];
  return V.normalizeDoc(d);
}

export const TPL_CREATOR = {
  id: 'creator',
  name: { en: 'Creator', ru: 'Автор', uk: 'Автор', de: 'Kreative', fr: 'Créateur', es: 'Creador', ka: 'შემოქმედი' },
  desc: {
    en: 'An illustrator prints a book: reward tiers with limits, countdown, backer wall and studio notes over a cover picture.',
    ru: 'Иллюстратор печатает книгу: награды с лимитами, обратный отсчёт, стена спонсоров и заметки студии на обложке-картинке.',
    uk: 'Ілюстраторка друкує книгу: нагороди з лімітами, зворотний відлік, стіна меценатів і нотатки студії на обкладинці-зображенні.',
    de: 'Eine Illustratorin druckt ein Buch: Belohnungen mit Limits, Countdown, Unterstützerwand und Atelier-Notizen über einem Titelbild.',
    fr: 'Une illustratrice imprime un livre : contreparties limitées, compte à rebours, mur des soutiens et notes d’atelier sur une image de couverture.',
    es: 'Una ilustradora imprime un libro: recompensas limitadas, cuenta atrás, muro de mecenas y notas del estudio sobre una imagen de portada.',
    ka: 'ილუსტრატორი წიგნს ბეჭდავს: ჯილდოები ლიმიტით, უკუათვლა, მხარდამჭერების კედელი და სტუდიის ჩანაწერები ყდის სურათზე.',
  },
  langs: ['en', 'es', 'uk'],
  build: tplBuildCreator,
};
