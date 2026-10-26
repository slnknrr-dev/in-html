// landing-studio/templates-blank.js - blank landing in the user's language.
//
// Contract of a template module: each exported template object carries an id, localized names and build(V, ...) ->
// a fresh document; templates.js adds catalogue metadata (group, mode, modules) where the module does not declare it,
// and studio/gallery.js shows the catalogue.
// The viewer API arrives as the argument V instead of an import, so templates are pure document builders that tests
// (test.js renders every template) and the gallery can run without the editor. Generated artwork and sample data are
// derived from seeds (tplHash / tplRand where used), so a template builds the same document on every run.
// Data file: names, texts, figures and art specs dominate; comments mark sections, not individual values.
import { tplKit } from './templates-kit.js';
// ===== Template: blank starter (built in the user's language) =====

const TPL_BLANK_TEXT = {
  en: { brand: 'Your brand', nav1: 'About', nav2: 'Contact', title: 'A headline that says what you do', text: 'One or two sentences about your offer and who it is for.', cta: 'Get in touch', sec: 'About', copy: '© Your brand' },
  ru: { brand: 'Ваш бренд', nav1: 'О нас', nav2: 'Контакты', title: 'Заголовок о том, что вы делаете', text: 'Одно-два предложения о вашем предложении и о том, для кого оно.', cta: 'Связаться', sec: 'О нас', copy: '© Ваш бренд' },
  uk: { brand: 'Ваш бренд', nav1: 'Про нас', nav2: 'Контакти', title: 'Заголовок про те, що ви робите', text: 'Одне-два речення про вашу пропозицію та для кого вона.', cta: 'Зв’язатися', sec: 'Про нас', copy: '© Ваш бренд' },
  de: { brand: 'Ihre Marke', nav1: 'Über uns', nav2: 'Kontakt', title: 'Eine Überschrift, die sagt, was Sie tun', text: 'Ein, zwei Sätze zu Ihrem Angebot und für wen es gedacht ist.', cta: 'Kontakt aufnehmen', sec: 'Über uns', copy: '© Ihre Marke' },
  fr: { brand: 'Votre marque', nav1: 'À propos', nav2: 'Contact', title: 'Un titre qui dit ce que vous faites', text: 'Une ou deux phrases sur votre offre et à qui elle s’adresse.', cta: 'Nous contacter', sec: 'À propos', copy: '© Votre marque' },
  es: { brand: 'Tu marca', nav1: 'Nosotros', nav2: 'Contacto', title: 'Un titular que diga lo que haces', text: 'Una o dos frases sobre tu oferta y para quién es.', cta: 'Contactar', sec: 'Nosotros', copy: '© Tu marca' },
  ka: { brand: 'თქვენი ბრენდი', nav1: 'ჩვენ შესახებ', nav2: 'კონტაქტი', title: 'სათაური იმაზე, რასაც აკეთებთ', text: 'ერთი-ორი წინადადება თქვენს შეთავაზებაზე და ვისთვისაა ის.', cta: 'დაგვიკავშირდით', sec: 'ჩვენ შესახებ', copy: '© თქვენი ბრენდი' },
};

function tplBuildBlank(V, lang = 'en', opts = {}) {
  if (typeof lang !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(lang)) lang = 'en';
  const p = String(lang).split('-')[0];
  const T = Object.prototype.hasOwnProperty.call(TPL_BLANK_TEXT, p) ? TPL_BLANK_TEXT[p] : TPL_BLANK_TEXT.en;
  const K = tplKit(V, [lang]);
  const { B, L } = K;
  const d = K.doc({ name: opts.name || 'Untitled landing', preset: 'clean', title: '', description: '' });
  d.regions.header = [
    B('nav', {
      brand: L(T.brand),
      items: [K.item({ label: L(T.nav1), href: '#about' }), K.item({ label: L(T.nav2), href: '#contact' })],
      ctaLabel: L(T.cta), ctaHref: '#contact',
    }),
  ];
  d.regions.main = [
    B('hero', { title: L(T.title), text: L('<p>' + T.text + '</p>'), items: [K.btn(T.cta, '#contact', 'primary')] }),
    B('section', { anchor: 'about', title: L(T.sec), blocks: [K.text('')] }),
    // The editable "Not found" page (404.html of archives, unknown addresses); the blocks above form the home page.
    ...(V.notFoundPage ? [V.notFoundPage(d, [lang])] : []),
  ];
  d.regions.footer = [B('footer', { anchor: 'contact', brand: L(T.brand), copy: L(T.copy) })];
  return V.normalizeDoc(d);
}

const TPL_BLANK = {
  id: 'blank',
  name: { en: 'Blank', ru: 'Пустой', de: 'Leer', fr: 'Vierge', es: 'En blanco', uk: 'Порожній', ka: 'ცარიელი' },
  desc: {
    en: 'Start from scratch: navigation, hero, one section and a footer.',
    ru: 'Начните с нуля: навигация, первый экран, один раздел и подвал.',
    de: 'Von Grund auf: Navigation, Startbereich, ein Abschnitt und Fußzeile.',
    fr: 'Partir de zéro : navigation, bannière, une section et un pied de page.',
    es: 'Empieza desde cero: navegación, portada, una sección y pie de página.',
    uk: 'Почніть з нуля: навігація, перший екран, один розділ і підвал.',
    ka: 'დაიწყეთ ნულიდან: ნავიგაცია, მთავარი ეკრანი, ერთი სექცია და ქვედა კოლონტიტული.',
  },
  langs: ['en'],
  userLang: true, // built in the user's language: build(V, lang, { name })
  build: tplBuildBlank,
};

export {
  TPL_BLANK,
  TPL_BLANK_TEXT,
  tplBuildBlank
};
