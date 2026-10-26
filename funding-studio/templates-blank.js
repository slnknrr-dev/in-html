// funding-studio/templates-blank.js - blank campaign in the user's language: navigation, hero with progress, story,
// donate, share and a thank-you page; theme 'clean'.
import { tplKit } from './templates-kit.js';

// Structure: TEXT = { <lang>: { key: text } } (HTML allowed in rich keys like 'story', 'lead'); the build function makes
// the document through tplKit (t(key) -> { lang: text } with English fallback, B(type, props) -> block, page(kind,
// slug, props, blocks), scene(name, kind, hue) -> generated SVG attachment), then normalizeDoc - so a template is
// exactly as valid as any opened file. Figures (raised, donors), dates and names are invented sample data; emails
// and websites use the reserved .example TLD so they can never reach anyone.
// The blank template is built in the user's language (userLang): only that language plus English is used.
const TEXT = {
  en: { brand: 'Your organisation', cta: 'Donate', camp: 'Our campaign', h1: 'A headline that says what the money changes', lead: '<p>One or two sentences: who you help and why it matters now.</p>', story: 'The story', donate: 'Make a donation', share: 'Share the campaign', thx: 'Thank you!', thxText: '<p>Your support means a lot to us.</p>', back: 'Back to the campaign', copy: '© Your organisation' },
  ru: { brand: 'Ваша организация', cta: 'Помочь', camp: 'Наш сбор', h1: 'Заголовок о том, что изменят деньги', lead: '<p>Одно-два предложения: кому вы помогаете и почему это важно сейчас.</p>', story: 'История', donate: 'Сделать пожертвование', share: 'Поделиться сбором', thx: 'Спасибо!', thxText: '<p>Ваша поддержка очень много для нас значит.</p>', back: 'Вернуться к сбору', copy: '© Ваша организация' },
  uk: { brand: 'Ваша організація', cta: 'Допомогти', camp: 'Наш збір', h1: 'Заголовок про те, що змінять гроші', lead: '<p>Одне-два речення: кому ви допомагаєте і чому це важливо зараз.</p>', story: 'Історія', donate: 'Зробити пожертву', share: 'Поділитися збором', thx: 'Дякуємо!', thxText: '<p>Ваша підтримка дуже багато для нас означає.</p>', back: 'Повернутися до збору', copy: '© Ваша організація' },
  de: { brand: 'Ihre Organisation', cta: 'Spenden', camp: 'Unsere Kampagne', h1: 'Eine Überschrift, die sagt, was das Geld verändert', lead: '<p>Ein, zwei Sätze: wem Sie helfen und warum es jetzt wichtig ist.</p>', story: 'Die Geschichte', donate: 'Jetzt spenden', share: 'Kampagne teilen', thx: 'Danke!', thxText: '<p>Ihre Unterstützung bedeutet uns viel.</p>', back: 'Zurück zur Kampagne', copy: '© Ihre Organisation' },
  fr: { brand: 'Votre organisation', cta: 'Donner', camp: 'Notre campagne', h1: 'Un titre qui dit ce que l’argent change', lead: '<p>Une ou deux phrases : qui vous aidez et pourquoi c’est important maintenant.</p>', story: 'L’histoire', donate: 'Faire un don', share: 'Partager la campagne', thx: 'Merci !', thxText: '<p>Votre soutien compte beaucoup pour nous.</p>', back: 'Retour à la campagne', copy: '© Votre organisation' },
  es: { brand: 'Tu organización', cta: 'Donar', camp: 'Nuestra campaña', h1: 'Un titular que diga qué cambia el dinero', lead: '<p>Una o dos frases: a quién ayudas y por qué importa ahora.</p>', story: 'La historia', donate: 'Haz una donación', share: 'Comparte la campaña', thx: '¡Gracias!', thxText: '<p>Tu apoyo significa mucho para nosotros.</p>', back: 'Volver a la campaña', copy: '© Tu organización' },
  ka: { brand: 'თქვენი ორგანიზაცია', cta: 'შეწირვა', camp: 'ჩვენი კამპანია', h1: 'სათაური იმაზე, რას შეცვლის ფული', lead: '<p>ერთი-ორი წინადადება: ვის ეხმარებით და რატომ არის ეს ახლა მნიშვნელოვანი.</p>', story: 'ამბავი', donate: 'შემოწირულობა', share: 'კამპანიის გაზიარება', thx: 'გმადლობთ!', thxText: '<p>თქვენი მხარდაჭერა ჩვენთვის ძალიან მნიშვნელოვანია.</p>', back: 'კამპანიაზე დაბრუნება', copy: '© თქვენი ორგანიზაცია' },
};

function tplBuildBlank(V, lang = 'en', opts = {}) {
  if (typeof lang !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(lang)) lang = 'en';
  const p = lang.split('-')[0];
  const X = Object.prototype.hasOwnProperty.call(TEXT, p) ? TEXT[p] : TEXT.en;
  const K = tplKit(V, [lang], { [lang]: X, en: TEXT.en });
  const { t, B, page } = K;
  const d = K.doc({ name: opts.name || X.camp, preset: 'clean' });
  d.regions.header = [B('nav', { brand: t('brand'), cta: t('cta'), ctaHref: '#donate' })];
  d.regions.main = [
    page('campaign', 'campaign', { title: t('camp'), currency: p === 'ka' ? 'GEL' : p === 'en' ? 'USD' : 'EUR', goal: 5000 }, [
      B('hero', { layout: 'split', title: t('h1'), lead: t('lead'), progress: true, cta: t('cta'), ctaHref: '#donate' }),
      B('story', { title: t('story'), side: 'none' }),
      B('donate', { anchor: 'donate', title: t('donate') }),
      B('share', { title: t('share') }),
    ]),
    page('thanks', 'thanks', { title: t('thx') }, [B('thanks', { title: t('thx'), text: t('thxText'), back: t('back') })]),
  ];
  d.regions.footer = [B('footer', { showOrg: true, copy: t('copy') })];
  return V.normalizeDoc(d);
}

export const TPL_BLANK = {
  id: 'blank',
  name: { en: 'Blank', ru: 'Пустой', uk: 'Порожній', de: 'Leer', fr: 'Vierge', es: 'En blanco', ka: 'ცარიელი' },
  desc: {
    en: 'One campaign with a hero, story, donate form and share buttons, plus a thank-you page.',
    ru: 'Один сбор: первый экран, история, форма пожертвования и кнопки «поделиться», плюс страница благодарности.',
    uk: 'Один збір: перший екран, історія, форма пожертви та кнопки «поділитися», плюс сторінка подяки.',
    de: 'Eine Kampagne mit Startbereich, Geschichte, Spendenformular und Teilen-Knöpfen, dazu eine Dankeseite.',
    fr: 'Une campagne avec bannière, histoire, formulaire de don et boutons de partage, plus une page de remerciement.',
    es: 'Una campaña con portada, historia, formulario de donación y botones para compartir, más una página de agradecimiento.',
    ka: 'ერთი კამპანია: მთავარი ეკრანი, ამბავი, შემოწირულობის ფორმა და გაზიარების ღილაკები, პლუს მადლობის გვერდი.',
  },
  langs: ['en'],
  userLang: true,
  build: tplBuildBlank,
};
