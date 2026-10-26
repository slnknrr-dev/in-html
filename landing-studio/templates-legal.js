// landing-studio/templates-legal.js - template "legal": a business law firm with practice areas, team, process,
// fees and packages, results and testimonials, events and consultation booking, case intake, guides and contacts
// (en default, ru, de; theme preset 'counsel').
//
// Contract of a template module: each exported template object carries an id, localized names and build(V, ...) ->
// a fresh document; templates.js adds catalogue metadata (group, mode, modules) where the module does not declare it,
// and studio/gallery.js shows the catalogue.
// The viewer API arrives as the argument V instead of an import, so templates are pure document builders that tests
// (test.js renders every template) and the gallery can run without the editor. Generated artwork and sample data are
// derived from seeds (tplHash / tplRand where used), so a template builds the same document on every run.
// Data file: names, texts, figures and art specs dominate; comments mark sections, not individual values.
import { tplKit } from './templates-kit.js';
import { TPL_ART_PROFILE, TPL_ART_SVG, tplArtMap, tplArtWordmark, tplIsoFigure, tplIsoScene } from './templates-art.js';
import { tplAgroPortrait } from './templates-agro.js';
// ===== Template: legal — Aldermoor & Venn, business law firm (en default, ru, de) =====
// Built only from the generic blocks; pictures are data for the generic isometric kit (templates-art.js).
// All firms, people, places, phone numbers, matters and figures below are FICTIONAL.

// ---------------------------------------------------------------------------
// Pictures as data
// ---------------------------------------------------------------------------

/** Portico building (facade facing +y): steps, stylobate, cella, six columns, entablature, gable. o.night = lit windows. */
function tplLegalPortico(o = {}) {
  const night = !!o.night;
  const wall = night ? ['#6b7487', '#454e61', '#30384a'] : 'stone';
  const marble = night ? ['#8a93a6', '#5d6679', '#41495b'] : 'marble';
  const s = [
    { shadow: [-4, -2, 66, 38] },
    { box: [-3, 26, 0, 66, 10, 1.2], c: marble }, { box: [-2, 26, 1.2, 64, 8, 1.2], c: marble }, { box: [-1, 26, 2.4, 62, 6, 1.2], c: marble },
    { box: [0, 0, 3.6, 60, 30, 1.4], c: marble },
    { box: [4, 2, 5, 52, 18, 22], c: wall },
    { box: [26, 19.95, 5, 8, 0.2, 12], c: night ? 'amber' : 'navy' },
  ];
  for (const x of [9, 40]) for (const z of [9, 17]) s.push({ box: [x, 19.95, z, 11, 0.2, 5], c: night ? 'amber' : ['#a9b4c4', '#7f8ba0', '#5f6b80'] });
  if (night) s.push({ glow: [30, 22, 14], rx: 40, ry: 22, c0: '#ffe3a1', c1: '#f2b523', a: 0.45 });
  for (const x of [6, 15.6, 25.2, 34.8, 44.4, 54]) {
    s.push({ cyl: [x, 26, 5], axis: 'z', r: 2.2, len: 0.8, c: marble }, { cyl: [x, 26, 5.8], axis: 'z', r: 1.6, r1: 1.4, len: 20.4, c: marble },
      { box: [x - 2.2, 23.8, 26.2, 4.4, 4.4, 0.8], c: marble });
  }
  s.push({ box: [0, 0, 27, 60, 30, 3.4], c: marble });
  s.push({ stroke: [[[0, 30, 28.6], [60, 30, 28.6]]], color: night ? '#2c3445' : '#bdb5a6', w: 0.25 });
  s.push({ prism: [30, 0, 30.4], axis: 'y', len: 30.6, profile: TPL_ART_PROFILE.gable(62, 9.5), c: marble });
  s.push({ disc: [30, 30.7, 33.4], axis: 'y', r: 2.1, fill: '#b08d57' });
  if (!night) s.push({ figure: [16, 37, 0], fill: '#2c3e5c', h: 7.4 }, { figure: [19, 38.5, 0], fill: '#b08d57', h: 6.8, lean: 1 }, { figure: [47, 35, 0], fill: '#1f2a3a', h: 7.6, lean: -1.5 });
  return s;
}

/** Desk with documents, a lamp and a balance (generic boxes and cylinders) — an editorial still life. */
function tplLegalDesk() {
  const s = [{ shadow: [0, 0, 40, 22] }, { box: [0, 0, 0, 40, 22, 1.6], c: 'wood' }];
  for (let i = 0; i < 5; i++) s.push({ box: [4 + i * 0.4, 4 + (i % 2) * 0.6, 1.6 + i * 0.5, 13, 9.5, 0.5], c: 'paper' });
  s.push({ box: [20, 3, 1.6, 6, 8.5, 3.6], c: 'navy' }, { box: [20, 3, 5.2, 6, 8.5, 0.6], c: 'brass' });
  s.push({ cyl: [33, 8, 1.6], axis: 'z', r: 3, len: 0.8, c: 'brass' }, { cyl: [33, 8, 2.4], axis: 'z', r: 0.4, len: 11, c: 'brass' },
    { box: [26.5, 7.6, 13.2, 13, 0.8, 0.6], c: 'brass' },
    { stroke: [[[27, 8, 13.2], [27, 8, 9.8]], [[39, 8, 13.2], [39, 8, 9.8]]], color: '#9a7a3c', w: 0.18 },
    { cyl: [27, 8, 9.2], axis: 'z', r: 2.2, r1: 2.6, len: 0.6, c: 'brass' }, { cyl: [39, 8, 9.2], axis: 'z', r: 2.2, r1: 2.6, len: 0.6, c: 'brass' });
  s.push({ cyl: [10, 17, 1.6], axis: 'x', r: 0.35, len: 9, c: 'navy' });
  return s;
}

/** Monogram mark: a portico arch over two rules (64×64). */
function tplLegalBrandSVG() {
  return TPL_ART_SVG + 'viewBox="0 0 64 64" width="64" height="64">' +
    '<rect width="64" height="64" fill="#1f3a5f"/>' +
    '<path d="M14 50V31a18 18 0 0 1 36 0V50H43V31a11 11 0 0 0-22 0V50Z" fill="#d8bd86"/>' +
    '<path d="M10 53H54M10 57H54" stroke="#d8bd86" stroke-width="2"/></svg>';
}

/** Chat avatar (160×160): a figure under the portico arch, brass on navy (kit figure primitive). */
function tplLegalAvatarSVG() {
  return TPL_ART_SVG + 'viewBox="0 0 160 160" width="160" height="160"><defs>' +
    '<radialGradient id="a" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="#2c4c78"/><stop offset="1" stop-color="#16263e"/></radialGradient></defs>' +
    '<rect width="160" height="160" fill="url(#a)"/>' +
    '<path d="M34 160V78a46 46 0 0 1 92 0V160" fill="none" stroke="#b08d57" stroke-width="5" stroke-opacity=".55"/>' +
    '<path d="M18 150H142" stroke="#b08d57" stroke-width="3" stroke-opacity=".55"/>' +
    tplIsoFigure(80, 152, 108, '#e6d3a8', '') + '</svg>';
}

/** Preview list for the artwork sheet of the verification tools. */
function tplLegalArtPreview() {
  return [
    ['hero', tplIsoScene(1200, 900, tplLegalPortico(), { light: true, pad: 70, dy: 10, glow: [0.6, 0.35, 0.55] })],
    ['night', tplIsoScene(1600, 520, [{ anchor: [-62, 40, 0] }, ...tplLegalPortico({ night: true })], { pad: 50, dy: 20, bg0: '#18243a', bg1: '#0b1220', grid: '#b08d57', glow: [0.55, 0.5, 0.3], glowC0: '#f2d38a', glowC1: '#b08d57' })],
    ['desk', tplIsoScene(900, 900, tplLegalDesk(), { light: true, pad: 80 })],
  ];
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

function tplBuildLegal(V) {
  const K = tplKit(V, ['en', 'ru', 'de']);
  const { B, L } = K;
  const t = (en, ru, de) => ({ en, ru, de });
  const p = (en, ru, de) => t('<p>' + en + '</p>', '<p>' + ru + '</p>', '<p>' + de + '</p>');
  const ul = (en, ru, de) => t('<ul>' + en.map((x) => '<li>' + x + '</li>').join('') + '</ul>', '<ul>' + ru.map((x) => '<li>' + x + '</li>').join('') + '</ul>', '<ul>' + de.map((x) => '<li>' + x + '</li>').join('') + '</ul>');
  const img = (name, svg, title) => K.svg(name, svg, { title });
  const pdf = (name, title, lines, band, ttl, desc) => K.addAtt({
    name, mime: 'application/pdf', data: K.files.makePDF(title, lines, { accent: '#1f3a5f', band }), title: ttl, desc,
  });
  const col = (w, blocks) => ({ id: K.id(), w, blocks });
  const field = (key, type, label, ph, o = {}) => K.item({ key, type, label: L(label), ph: L(ph || ''), options: L(o.options || ''), required: !!o.required, half: !!o.half });
  const th = (v, o = {}) => K.cell(v, { th: true, ...o });

  // ----- pictures -----
  const brand = img('aldermoor-venn-mark.svg', tplLegalBrandSVG(), t('Aldermoor & Venn mark', 'Знак «Олдермур и Венн»', 'Zeichen Aldermoor & Venn'));
  const hero = img('aldermoor-venn-chambers.svg', tplIsoScene(1200, 900, tplLegalPortico(), { light: true, pad: 70, dy: 10, glow: [0.6, 0.35, 0.55] }),
    t('Our chambers on Quayside Row', 'Наш офис на Набережном ряду', 'Unsere Kanzlei an der Quayside Row'));
  const night = img('chambers-at-night.svg', tplIsoScene(1600, 520, [{ anchor: [-62, 40, 0] }, ...tplLegalPortico({ night: true })],
    { pad: 50, dy: 20, bg0: '#18243a', bg1: '#0b1220', grid: '#b08d57', glow: [0.55, 0.5, 0.3], glowC0: '#f2d38a', glowC1: '#b08d57' }), '');
  const desk = img('engagement-letter.svg', tplIsoScene(900, 900, tplLegalDesk(), { light: true, pad: 80 }),
    t('Engagement letter, case file and the balance', 'Договор, материалы дела и весы', 'Mandatsvereinbarung, Akte und Waage'));
  const map = img('aldermoor-venn-map.svg', tplArtMap({ seed: 'westbridge', river: true, ground: '#efece6', block: '#e2ddd3', building: '#d3ccbf', park: '#d4e0c8', water: '#b9cfdf', road: '#ffffff', pins: [[600, 430, '#1f3a5f', 1.4]] }),
    t('Map: 14 Quayside Row, Westbridge', 'Карта: Набережный ряд, 14, Уэстбридж', 'Karte: Quayside Row 14, Westbridge'));
  const portrait = (seed, o) => img('team-' + seed + '.svg', tplAgroPortrait({ seed, bg: ['#ece6da', '#cfc3ad'], shirt: '#1f2a3a', shirt2: '#141c28', collar: '#f6f3ec', ...o }), '');
  const people = [
    portrait('aldermoor', { skin: '#f1d0b8', skin2: '#e2b597', hair: '#8f8a84', style: 'bun', glasses: true }),
    portrait('venn', { skin: '#e9c3a6', skin2: '#d9a988', hair: '#3b302a', style: 'short', beard: true }),
    portrait('sokolova', { skin: '#f0cdb4', skin2: '#e0b394', hair: '#5a3a2a', style: 'long', shirt: '#2c3e5c', shirt2: '#1f2d44' }),
    portrait('weidner', { skin: '#efc6a8', skin2: '#dcab88', hair: '#b88a4a', style: 'short', glasses: true, shirt: '#33415a', shirt2: '#26324a' }),
  ];
  const clients = [['arch', 'NORTHGATE', '#6b6457'], ['ring', 'BRIGHTLOOP', '#5f6b7a'], ['leaf', 'VERDANT LABS', '#5d6f62'], ['star', 'HALCYON', '#6f6a5a'], ['wave', 'MERIDIAN', '#5a6e82'], ['hex', 'IRONWOOD', '#66615a']]
    .map(([k, n, c]) => ({ id: img('client-' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.svg', tplArtWordmark(k, n, c, { font: 'serif', weight: 600 }), n), name: n }));

  // ----- documents (sample PDFs, ASCII text) -----
  const guideSha = pdf('founders-guide-shareholder-agreements.pdf', "Founder's guide to shareholder agreements", [
    '> Aldermoor & Venn - practical guide, 2026 edition',
    '',
    'A shareholder agreement decides what happens when founders disagree, leave or sell. Write it while everybody still agrees.',
    '# 1. Decisions and deadlock',
    '- Which decisions need unanimity: new shares, debt, sale of the business, budgets',
    '- A deadlock mechanism: escalation, mediation, then a buy-sell (shotgun) clause',
    '# 2. Leaving the company',
    '- Good and bad leaver definitions; vesting of 4 years with a 1-year cliff',
    '- Non-compete and non-solicitation within the limits courts accept',
    '# 3. Selling',
    '- Pre-emption rights, tag-along for minorities, drag-along above 75 %',
    '- Valuation method agreed in advance',
    '# 4. Checklist before signing',
    '- Cap table matches the register; option pool approved; IP assigned to the company',
    '',
    'Questions? Book a free 30-minute call: intake@aldermoor-venn.example',
    '',
    '> Sample document generated by the landing template. Not legal advice. All names are fictional.',
  ], 'GUIDE', t("Founder's guide to shareholder agreements", 'Гайд для основателей: корпоративный договор', 'Leitfaden: Gesellschaftervereinbarungen für Gründer'),
  t('Decisions, leavers, exits — and a checklist', 'Решения, выход участников, продажа — и чек-лист', 'Entscheidungen, Ausscheiden, Exit – mit Checkliste'));
  const guideEmp = pdf('employment-contract-checklist-2026.pdf', 'Employment contract checklist 2026', [
    '# Before the offer',
    '- Job title, duties, place of work and reporting line',
    '- Salary, bonus rules, benefits and review dates',
    '# The contract',
    '- Working time, overtime and remote work rules',
    '- Probation period and notice periods for both sides',
    '- Confidentiality, IP assignment and data protection notice',
    '- Post-termination restrictions: scope, duration, compensation',
    '# After signing',
    '- Policies acknowledged: code of conduct, IT and security, whistleblowing',
    '- Records kept for the statutory period',
    '',
    '> Sample document. Not legal advice. All names are fictional.',
  ], 'CHECKLIST', t('Employment contract checklist 2026', 'Чек-лист трудового договора 2026', 'Checkliste Arbeitsvertrag 2026'),
  t('Twelve points to check before you sign', 'Двенадцать пунктов, которые стоит проверить до подписания', 'Zwölf Punkte vor der Unterschrift'));
  const guideClaim = pdf('received-a-claim-first-10-days.pdf', 'Received a claim? The first 10 days', [
    '# Day 1',
    '- Note the date of service and every deadline in the document',
    '- Keep all emails, contracts and invoices; stop deleting anything',
    '# Days 2-3',
    '- Send the papers to your lawyer and your insurer',
    '- Do not contact the other side without advice',
    '# Days 4-10',
    '- Decide: settle, defend or counterclaim',
    '- File the acknowledgment or defence within the deadline',
    '',
    'Duty lawyer: +1 (000) 000-1400, weekdays 8:30-18:30.',
    '',
    '> Sample document. Not legal advice. All names are fictional.',
  ], 'GUIDE', t('Received a claim? The first 10 days', 'Получили иск? Первые 10 дней', 'Klage erhalten? Die ersten 10 Tage'),
  t('Deadlines, evidence and what not to do', 'Сроки, доказательства и чего делать не стоит', 'Fristen, Beweise und was Sie lassen sollten'));
  const fees = pdf('aldermoor-venn-fee-schedule-2026.pdf', 'Aldermoor & Venn - Fee schedule 2026', [
    '# Hourly rates (EUR, excl. VAT)',
    '- Partner: 380 - Counsel: 320 - Senior associate: 260 - Associate: 190 - Paralegal: 110',
    '# Fixed fees',
    '- Initial consultation, 60 minutes: 180 (credited if you instruct us)',
    '- Company formation package: 1,450',
    '- Employment contract and policies pack: 950',
    '- Retainer: from 2,900 per month, up to 12 hours',
    '# Billing',
    '- Time recorded in 6-minute units; monthly invoices with a task breakdown',
    '- Caps agreed in the engagement letter are binding on us',
    '',
    '> Sample document generated by the landing template. All figures are fictional.',
  ], 'FEES', t('Fee schedule 2026', 'Тарифы 2026', 'Honorarübersicht 2026'),
  t('Rates, fixed fees and how we bill', 'Ставки, фиксированные цены и порядок расчётов', 'Stundensätze, Pauschalen und Abrechnung'));

  // ----- requests (browser-local endpoints; mailto is the human fallback) -----
  const reqIntake = K.id();
  const reqBooking = K.id();
  const R = (id, name, url) => ({ id, name, method: 'POST', url, headers: [], credentials: 'omit', timeout: 8000, retries: 0, itemsPath: 'items' });

  const d = K.doc({
    name: 'Aldermoor & Venn — business law firm', preset: 'counsel', defaultLang: 'en',
    author: 'Aldermoor & Venn', keywords: 'law firm, corporate law, M&A, contracts, employment law, real estate, disputes, arbitration, data protection',
    title: t('Aldermoor & Venn — business law firm', 'Олдермур и Венн — юридическая фирма для бизнеса', 'Aldermoor & Venn — Wirtschaftskanzlei'),
    description: t(
      'Partner-led business law firm: corporate and M&A, contracts, employment, real estate, disputes and data protection. Fixed fees, a free first call and online case intake.',
      'Юридическая фирма для бизнеса: корпоративное право и M&A, договоры, трудовое право, недвижимость, споры и защита данных. Фиксированные цены, бесплатный первый звонок и онлайн-заявка.',
      'Partnergeführte Wirtschaftskanzlei: Gesellschaftsrecht und M&A, Verträge, Arbeitsrecht, Immobilien, Prozesse und Datenschutz. Pauschalen, kostenloses Erstgespräch und Online-Mandatsanfrage.'),
    meta: { favicon: brand },
    theme: { scheme: 'auto' },
    output: { autodetect: true, switcher: 'buttons', langLabels: 'code', themeToggle: true, toolbarPos: 'nav', motion: 'fade', backToTop: true },
    shop: { currency: 'EUR', mode: 'cart', checkout: { method: 'none' } },
    requests: [R(reqIntake, 'Case intake (browser storage)', 'local:intake'), R(reqBooking, 'Consultation booking (browser storage)', 'local:bookings')],
  });

  const areas = t('Corporate & M&A\nCommercial contracts\nEmployment\nReal estate & construction\nDisputes & arbitration\nIP & data protection\nNot sure yet',
    'Корпоративное право и M&A\nДоговоры\nТрудовое право\nНедвижимость и строительство\nСпоры и арбитраж\nИС и защита данных\nПока не знаю',
    'Gesellschaftsrecht & M&A\nVertragsrecht\nArbeitsrecht\nImmobilien & Bau\nProzesse & Schiedsverfahren\nIP & Datenschutz\nNoch unklar');

  // ----- header -----
  d.regions.header = [
    B('nav', {
      brand: L(t('Aldermoor & Venn', 'Олдермур и Венн', 'Aldermoor & Venn')), logo: brand, logoH: 36, sticky: true, variant: 'bar',
      items: [
        K.item({ label: L(t('Practice', 'Практики', 'Rechtsgebiete')), href: '#practice' }),
        K.item({ label: L(t('Team', 'Команда', 'Team')), href: '#team' }),
        K.item({ label: L(t('Fees', 'Стоимость', 'Honorare')), href: '#fees' }),
        K.item({ label: L(t('Guides', 'Гайды', 'Ratgeber')), href: '#guides' }),
        K.item({ label: L(t('Contact', 'Контакты', 'Kontakt')), href: '#contact' }),
      ],
      ctaLabel: L(t('Book a call', 'Консультация', 'Termin buchen')), ctaHref: '#book',
    }),
  ];

  // ----- main -----
  d.regions.main = [
    B('hero', {
      layout: 'split', media: hero, height: 'auto',
      badge: L(t('First 30-minute call free of charge', 'Первые 30 минут — бесплатно', 'Erstgespräch 30 Minuten kostenfrei')),
      eyebrow: L(t('Business law firm · Westbridge · since 1998', 'Юридическая фирма для бизнеса · с 1998 года', 'Wirtschaftskanzlei · Westbridge · seit 1998')),
      title: L(t('Clear legal advice for the decisions that shape your business', 'Ясные юридические решения для вашего бизнеса', 'Klare Rechtsberatung für Entscheidungen, die zählen')),
      text: L(p('Deals, contracts, employment, property and disputes — handled by a partner-led team that tells you the risks, the options and the price before you commit.',
        'Сделки, договоры, трудовые вопросы, недвижимость и споры ведёт команда во главе с партнёром. Риски, варианты и стоимость вы узнаёте до начала работы.',
        'Transaktionen, Verträge, Arbeitsrecht, Immobilien und Streitigkeiten – betreut von einem partnergeführten Team, das Risiken, Optionen und Kosten offenlegt, bevor Sie sich festlegen.')),
      items: [
        K.btn(t('Book a consultation', 'Записаться на консультацию', 'Beratung buchen'), '#book', 'primary', K.icon('calendar')),
        K.btn(t('Describe your case', 'Описать ситуацию', 'Fall schildern'), '#intake', 'secondary'),
      ],
    }),
    K.sec({ pad: 's' }, [
      B('stats', {
        variant: 'band', columns: 4, items: [
          K.item({ value: '27', suffix: L(t('years', 'лет', 'Jahre')), label: L(t('in practice', 'практики', 'Praxis')) }),
          K.item({ value: '38', suffix: L(''), label: L(t('lawyers and paralegals', 'юристов и помощников', 'Anwälte und Fachangestellte')) }),
          K.item({ value: '1200+', suffix: L(''), label: L(t('matters closed', 'завершённых дел', 'abgeschlossene Mandate')) }),
          K.item({ value: '91', suffix: L('%'), label: L(t('of disputes settled or won', 'споров урегулировано или выиграно', 'der Streitfälle verglichen oder gewonnen')) }),
        ],
      }),
    ]),
    K.sec({
      anchor: 'practice', pad: 'm',
      eyebrow: t('Practice areas', 'Практики', 'Rechtsgebiete'),
      title: t('Six practices, one team that knows your business', 'Шесть практик и одна команда, которая знает ваш бизнес', 'Sechs Rechtsgebiete, ein Team, das Ihr Unternehmen kennt'),
      lead: p('Most matters touch more than one area of law. Your lead lawyer brings in colleagues as needed — you keep one point of contact.',
        'Большинство вопросов касаются сразу нескольких отраслей права. Ведущий юрист подключает коллег по мере необходимости — у вас остаётся один контакт.',
        'Die meisten Mandate berühren mehrere Rechtsgebiete. Ihr federführender Anwalt holt Kollegen hinzu – Sie behalten einen Ansprechpartner.'),
    }, [
      B('features', {
        variant: 'cards', columns: 3, items: [
          K.item({ icon: K.icon('briefcase'), title: L(t('Corporate & M&A', 'Корпоративное право и M&A', 'Gesellschaftsrecht & M&A')),
            html: L(p('Company formation, shareholder agreements, investments, acquisitions and exits.', 'Создание компаний, корпоративные договоры, инвестиции, покупка и продажа бизнеса.', 'Gründungen, Gesellschaftervereinbarungen, Beteiligungen, Unternehmenskäufe und Exits.')) }),
          K.item({ icon: K.icon('file'), title: L(t('Commercial contracts', 'Договорная работа', 'Vertragsrecht')),
            html: L(p('Supply, distribution, licensing and SaaS agreements drafted to be signed, not argued over.', 'Поставка, дистрибуция, лицензии и SaaS — договоры, которые подписывают, а не оспаривают.', 'Liefer-, Vertriebs-, Lizenz- und SaaS-Verträge, die unterschrieben statt gestritten werden.')) }),
          K.item({ icon: K.icon('users'), title: L(t('Employment', 'Трудовое право', 'Arbeitsrecht')),
            html: L(p('Contracts and policies, restructuring, dismissals and workplace investigations.', 'Договоры и политики, реструктуризация, увольнения и внутренние расследования.', 'Verträge und Richtlinien, Restrukturierung, Kündigungen und interne Untersuchungen.')) }),
          K.item({ icon: K.icon('home'), title: L(t('Real estate & construction', 'Недвижимость и строительство', 'Immobilien & Bau')),
            html: L(p('Leases, purchases, development projects and construction claims.', 'Аренда, покупка, девелоперские проекты и строительные споры.', 'Miete, Kauf, Projektentwicklung und Bauforderungen.')) }),
          K.item({ icon: K.icon('shield'), title: L(t('Disputes & arbitration', 'Споры и арбитраж', 'Prozesse & Schiedsverfahren')),
            html: L(p('Negotiation and mediation first; court litigation and international arbitration when needed.', 'Сначала переговоры и медиация; суд и международный арбитраж — когда это нужно.', 'Zuerst Verhandlung und Mediation; Gerichts- und Schiedsverfahren, wenn nötig.')) }),
          K.item({ icon: K.icon('lock'), title: L(t('IP & data protection', 'ИС и защита данных', 'IP & Datenschutz')),
            html: L(p('Trade marks, software, privacy compliance and data breach response.', 'Товарные знаки, программы, соответствие требованиям о данных и реагирование на утечки.', 'Marken, Software, Datenschutz-Compliance und Reaktion auf Datenpannen.')) }),
        ],
      }),
    ]),
    K.sec({
      anchor: 'process', tone: 'muted', pad: 'm',
      eyebrow: t('How we work', 'Как мы работаем', 'So arbeiten wir'),
      title: t('No surprises — in the advice or the invoice', 'Без сюрпризов — ни в советах, ни в счетах', 'Keine Überraschungen – weder im Rat noch in der Rechnung'),
    }, [
      B('columns', {
        gap: 48, valign: 'center', cols: [
          col(58, [B('timeline', {
            variant: 'line', items: [
              K.item({ date: '01', image: null, title: L(t('Free first call', 'Бесплатный первый звонок', 'Kostenloses Erstgespräch')), html: L(p('30 minutes with a lawyer to understand the situation and the deadlines.', '30 минут с юристом, чтобы понять ситуацию и сроки.', '30 Minuten mit einem Anwalt, um Lage und Fristen zu verstehen.')) }),
              K.item({ date: '02', image: null, title: L(t('Scope and fixed quote', 'Объём и фиксированная цена', 'Umfang und Festpreis')), html: L(p('An engagement letter with the team, the steps and a fixed fee or a cap.', 'Договор с составом команды, этапами и фиксированной ценой или лимитом.', 'Eine Mandatsvereinbarung mit Team, Schritten und Pauschale oder Obergrenze.')) }),
              K.item({ date: '03', image: null, title: L(t('Strategy and work', 'Стратегия и работа', 'Strategie und Umsetzung')), html: L(p('A partner leads the matter; you get a weekly update and a direct line.', 'Дело ведёт партнёр; еженедельный отчёт и прямой телефон.', 'Ein Partner führt das Mandat; wöchentliches Update und Direktdurchwahl.')) }),
              K.item({ date: '04', image: null, title: L(t('Result and follow-up', 'Результат и сопровождение', 'Ergebnis und Nachsorge')), html: L(p('Signed documents or a closed case — and a debrief on what to do next.', 'Подписанные документы или закрытое дело — и разбор дальнейших шагов.', 'Unterschriebene Dokumente oder ein abgeschlossener Fall – und ein Ausblick.')) }),
            ],
          })]),
          col(42, [B('image', { att: desk, width: 100, align: 'center', shape: 'rect', ratio: '1/1', fit: 'cover', zoom: false, caption: L(''), link: '' })]),
        ],
      }),
    ]),
    K.sec({
      anchor: 'fees', pad: 'm', align: 'center',
      eyebrow: t('Fees', 'Стоимость', 'Honorare'),
      title: t('Fixed where possible, capped where not', 'Фиксированная цена — где возможно, лимит — где нет', 'Pauschal, wo möglich – gedeckelt, wo nicht'),
      lead: p('Prices exclude VAT. The consultation fee is credited if you instruct us within 30 days.',
        'Цены указаны без НДС. Стоимость консультации засчитывается, если вы поручите нам дело в течение 30 дней.',
        'Preise zzgl. MwSt. Das Beratungshonorar wird angerechnet, wenn Sie uns binnen 30 Tagen mandatieren.'),
    }, [
      B('pricing', {
        columns: 3, items: [
          K.item({ name: L(t('Consultation', 'Консультация', 'Erstberatung')), price: 180, period: L(t('60 minutes', '60 минут', '60 Minuten')), featured: false,
            html: L(ul(['Video call or in person', 'Written summary of the advice', 'Credited if you instruct us'], ['Видео или лично в офисе', 'Письменное резюме рекомендаций', 'Засчитывается при заключении договора'], ['Videocall oder vor Ort', 'Schriftliche Zusammenfassung', 'Wird bei Mandatierung angerechnet'])),
            label: L(t('Book a slot', 'Выбрать время', 'Termin wählen')), href: '#book', sku: '' }),
          K.item({ name: L(t('Fixed-fee package', 'Пакет с фиксированной ценой', 'Pauschalpaket')), price: 1450, period: L(t('e.g. company formation', 'например, создание компании', 'z. B. Gesellschaftsgründung')), featured: true,
            html: L(ul(['Founders’ agreement and articles', 'Registration and bank account support', 'Two rounds of revisions included'], ['Корпоративный договор и устав', 'Регистрация и открытие счёта', 'Две итерации правок включены'], ['Gesellschaftervertrag und Satzung', 'Eintragung und Kontoeröffnung', 'Zwei Korrekturrunden inklusive'])),
            label: L(t('Request this package', 'Запросить пакет', 'Paket anfragen')), href: '#intake', sku: '' }),
          K.item({ name: L(t('Retainer', 'Абонентское обслуживание', 'Beratungsmandat')), price: 2900, period: L(t('per month', 'в месяц', 'pro Monat')), featured: false,
            html: L(ul(['Up to 12 hours of advice', 'Contract review within 48 hours', 'Named partner and backup lawyer'], ['До 12 часов консультаций', 'Проверка договоров за 48 часов', 'Закреплённый партнёр и заместитель'], ['Bis zu 12 Stunden Beratung', 'Vertragsprüfung binnen 48 Stunden', 'Fester Partner und Vertretung'])),
            label: L(t('Discuss a retainer', 'Обсудить абонемент', 'Mandat besprechen')), href: '#contact', sku: '' }),
        ],
      }),
      B('spacer', { h: 24 }),
      B('columns', {
        gap: 40, valign: 'top', cols: [
          col(55, [
            K.head(t('Hourly rates', 'Почасовые ставки', 'Stundensätze'), 4, { align: 'left' }),
            K.table([
              [th(t('Role', 'Позиция', 'Funktion')), th(t('Per hour', 'В час', 'Pro Stunde'), { align: 'right' })],
              [K.cell(t('Partner', 'Партнёр', 'Partner')), K.cell('€380', { align: 'right' })],
              [K.cell(t('Counsel', 'Советник', 'Counsel')), K.cell('€320', { align: 'right' })],
              [K.cell(t('Senior associate', 'Старший юрист', 'Senior Associate')), K.cell('€260', { align: 'right' })],
              [K.cell(t('Associate', 'Юрист', 'Associate')), K.cell('€190', { align: 'right' })],
              [K.cell(t('Paralegal', 'Помощник юриста', 'Rechtsfachwirt')), K.cell('€110', { align: 'right' })],
            ], [70, 30], {
              header: 'row', variant: 'minimal', compact: false, width: 100,
              caption: L(t('Excl. VAT; time recorded in 6-minute units; caps agreed in advance are binding on us.', 'Без НДС; учёт времени по 6 минут; согласованный лимит для нас обязателен.', 'Zzgl. MwSt.; Abrechnung im 6-Minuten-Takt; vereinbarte Obergrenzen binden uns.')),
            }),
          ]),
          col(45, [
            B('embed', { att: fees, display: 'card', player: 'object', height: 520, ratio: 'auto', caption: L(''), dl: true, op: true }),
            B('quote', {
              variant: 'callout', tone: 'accent', icon: K.icon('info'), author: L(''),
              html: L(p('Legal expenses insurance or a fixed budget? Tell us at the first call — we will plan the work around it.', 'Есть страховка судебных расходов или жёсткий бюджет? Скажите на первом звонке — мы спланируем работу под него.', 'Rechtsschutzversicherung oder festes Budget? Sagen Sie es im Erstgespräch – wir planen danach.')),
            }),
          ]),
        ],
      }),
    ]),
    K.sec({
      anchor: 'results', tone: 'muted', pad: 'm',
      eyebrow: t('Results', 'Результаты', 'Erfolge'),
      title: t('Selected matters', 'Избранные дела', 'Ausgewählte Mandate'),
      lead: p('Published with our clients’ consent. Every matter is different; past results do not guarantee a similar outcome.',
        'Публикуется с согласия клиентов. Каждое дело уникально; прошлые результаты не гарантируют такого же исхода.',
        'Veröffentlicht mit Zustimmung unserer Mandanten. Jeder Fall ist anders; frühere Ergebnisse garantieren keinen gleichen Ausgang.'),
    }, [
      B('timeline', {
        variant: 'alternate', items: [
          K.item({ date: '2025', image: null, title: L(t('Sale of a logistics group to a strategic buyer', 'Продажа логистической группы стратегическому инвестору', 'Verkauf einer Logistikgruppe an einen strategischen Käufer')),
            html: L(p('Advised the founders on an €84 m exit including a 24-month earn-out.', 'Сопровождали основателей при продаже за €84 млн с отложенной частью цены на 24 месяца.', 'Beratung der Gründer beim Exit über 84 Mio. € inklusive 24-monatigem Earn-out.')) }),
          K.item({ date: '2024', image: null, title: L(t('€12.6 m arbitration award for a machine builder', 'Решение арбитража на €12,6 млн в пользу машиностроителя', 'Schiedsspruch über 12,6 Mio. € für einen Maschinenbauer')),
            html: L(p('Arbitration over a terminated supply contract; the award was enforced in full.', 'Арбитраж по расторгнутому договору поставки; решение исполнено полностью.', 'Schiedsverfahren über einen gekündigten Liefervertrag; der Spruch wurde vollständig vollstreckt.')) }),
          K.item({ date: '2024', image: null, title: L(t('Restructuring without a single court claim', 'Реструктуризация без единого иска', 'Restrukturierung ohne eine einzige Klage')),
            html: L(p('Reorganised a 600-employee retailer with agreed redundancy terms.', 'Реорганизация розничной сети на 600 сотрудников на согласованных условиях.', 'Umstrukturierung eines Händlers mit 600 Beschäftigten zu vereinbarten Bedingungen.')) }),
          K.item({ date: '2023', image: null, title: L(t('Brand and domain recovered in 11 weeks', 'Бренд и домен возвращены за 11 недель', 'Marke und Domain in 11 Wochen zurückgewonnen')),
            html: L(p('Trade mark opposition and domain dispute won for a software company.', 'Выиграли возражение против знака и доменный спор для разработчика ПО.', 'Markenwiderspruch und Domainstreit für ein Softwareunternehmen gewonnen.')) }),
          K.item({ date: '2022', image: null, title: L(t('Construction claim settled at 92 % of value', 'Строительный спор урегулирован на 92 % суммы', 'Bauforderung zu 92 % des Werts verglichen')),
            html: L(p('Mediation in a delayed-delivery dispute on a warehouse project.', 'Медиация в споре о просрочке сдачи складского комплекса.', 'Mediation im Streit über die verspätete Übergabe eines Lagerprojekts.')) }),
        ],
      }),
      B('spacer', { h: 24 }),
      B('testimonials', {
        variant: 'cards', columns: 3, items: [
          K.item({ rating: 5, photo: null,
            html: L(p('They told us the three ways the deal could fail and fixed two of them before signing. The third never happened.', 'Нам назвали три сценария, при которых сделка могла сорваться, и два закрыли до подписания. Третий так и не случился.', 'Sie nannten uns drei Wege, wie der Deal scheitern konnte, und lösten zwei vor der Unterzeichnung. Der dritte trat nie ein.')),
            name: L(t('Hannah Price', 'Ханна Прайс', 'Hannah Price')), role: L(t('Founder, Northgate Logistics', 'Основатель, Northgate Logistics', 'Gründerin, Northgate Logistics')) }),
          K.item({ rating: 5, photo: null,
            html: L(p('A fixed fee, weekly updates and no invoice surprises — exactly what our board asked for.', 'Фиксированная цена, еженедельные отчёты и никаких сюрпризов в счетах — именно то, чего хотел наш совет директоров.', 'Pauschalhonorar, wöchentliche Updates, keine Überraschungen auf der Rechnung – genau das wollte unser Vorstand.')),
            name: L(t('Daniel Okafor', 'Даниэль Окафор', 'Daniel Okafor')), role: L(t('CFO, Brightloop', 'Финансовый директор, Brightloop', 'CFO, Brightloop')) }),
          K.item({ rating: 5, photo: null,
            html: L(p('Irina handled a difficult restructuring in three countries and three languages without a single claim.', 'Ирина провела сложную реструктуризацию в трёх странах и на трёх языках без единого иска.', 'Irina führte eine schwierige Restrukturierung in drei Ländern und drei Sprachen ohne eine einzige Klage.')),
            name: L(t('Martina Ruiz', 'Мартина Руис', 'Martina Ruiz')), role: L(t('HR director, Halcyon Retail', 'Директор по персоналу, Halcyon Retail', 'Personalleiterin, Halcyon Retail')) }),
        ],
      }),
      B('spacer', { h: 16 }),
      B('logos', { variant: 'strip', mono: true, items: clients.map((c) => K.item({ att: c.id, name: L(c.name), href: '' })) }),
    ]),
    K.sec({
      anchor: 'team', pad: 'm',
      eyebrow: t('Team', 'Команда', 'Team'),
      title: t('Partners who stay on your matter', 'Партнёры, которые ведут ваше дело сами', 'Partner, die Ihr Mandat selbst führen'),
    }, [
      B('team', {
        variant: 'cards', columns: 4, items: [
          K.item({ photo: people[0], name: L(t('Eleanor Aldermoor', 'Элеонора Олдермур', 'Eleanor Aldermoor')), role: L(t('Managing partner · Corporate & M&A', 'Управляющий партнёр · M&A', 'Managing Partner · M&A')),
            html: L(p('Twenty years of transactions; leads the M&A and venture practice.', 'Двадцать лет сделок; руководит практикой M&A и венчурных инвестиций.', 'Zwanzig Jahre Transaktionen; leitet M&A und Venture Capital.')), href: 'mailto:e.aldermoor@aldermoor-venn.example' }),
          K.item({ photo: people[1], name: L(t('Marcus Venn', 'Маркус Венн', 'Marcus Venn')), role: L(t('Partner · Disputes & arbitration', 'Партнёр · Споры и арбитраж', 'Partner · Prozesse & Schiedsverfahren')),
            html: L(p('Former in-house counsel; has argued more than 140 commercial cases.', 'Бывший юрист компании; провёл более 140 коммерческих дел.', 'Früher Syndikus; hat über 140 Wirtschaftsprozesse geführt.')), href: 'mailto:m.venn@aldermoor-venn.example' }),
          K.item({ photo: people[2], name: L(t('Irina Sokolova', 'Ирина Соколова', 'Irina Sokolova')), role: L(t('Partner · Employment', 'Партнёр · Трудовое право', 'Partnerin · Arbeitsrecht')),
            html: L(p('Advises employers in three jurisdictions in English, Russian and German.', 'Консультирует работодателей в трёх юрисдикциях на английском, русском и немецком.', 'Berät Arbeitgeber in drei Rechtsordnungen auf Englisch, Russisch und Deutsch.')), href: 'mailto:i.sokolova@aldermoor-venn.example' }),
          K.item({ photo: people[3], name: L(t('Jonas Weidner', 'Йонас Вайднер', 'Jonas Weidner')), role: L(t('Counsel · IP & data protection', 'Советник · ИС и данные', 'Counsel · IP & Datenschutz')),
            html: L(p('Certified data protection officer; software and trade mark specialist.', 'Сертифицированный специалист по защите данных; эксперт по ПО и товарным знакам.', 'Zertifizierter Datenschutzbeauftragter; Experte für Software und Marken.')), href: 'mailto:j.weidner@aldermoor-venn.example' }),
        ],
      }),
    ]),
    K.sec({
      anchor: 'book', tone: 'muted', pad: 'm',
      eyebrow: t('Consultations and events', 'Консультации и мероприятия', 'Beratung und Termine'),
      title: t('Book a consultation', 'Запишитесь на консультацию', 'Beratung buchen'),
      lead: p('Choose a preferred day and format — we confirm the slot by e-mail within one working day. Free clinics and briefings are listed on the left.',
        'Выберите удобный день и формат — мы подтвердим время по почте в течение рабочего дня. Бесплатные встречи и брифинги — слева.',
        'Wählen Sie Wunschtag und Format – wir bestätigen den Termin per E-Mail innerhalb eines Arbeitstages. Kostenlose Sprechstunden und Briefings finden Sie links.'),
    }, [
      B('columns', {
        gap: 40, valign: 'top', cols: [
          col(46, [
            K.head(t('Upcoming clinics and briefings', 'Ближайшие встречи и брифинги', 'Nächste Sprechstunden und Briefings'), 4, { align: 'left' }),
            B('events', {
              variant: 'list', columns: 3, hidePast: false, items: [
                K.item({ date: '2026-11-05', time: '18:00', title: L(t('Founders’ legal clinic', 'Юридическая клиника для основателей', 'Rechtssprechstunde für Gründer')), venue: L(t('Online', 'Онлайн', 'Online')), city: L(''), status: 'on', price: null, sku: '', href: '' }),
                K.item({ date: '2026-11-19', time: '12:00', title: L(t('Webinar: employment law changes 2027', 'Вебинар: изменения трудового права в 2027 году', 'Webinar: Arbeitsrecht 2027 – was sich ändert')), venue: L(t('Online', 'Онлайн', 'Online')), city: L(''), status: 'on', price: null, sku: '', href: '' }),
                K.item({ date: '2026-12-03', time: '10:00', title: L(t('Office hours for start-ups', 'Приёмные часы для стартапов', 'Sprechstunde für Start-ups')), venue: L(t('14 Quayside Row', 'Набережный ряд, 14', 'Quayside Row 14')), city: L(t('Westbridge', 'Уэстбридж', 'Westbridge')), status: 'on', price: null, sku: '', href: '' }),
                K.item({ date: '2027-01-21', time: '08:30', title: L(t('Breakfast briefing: data protection audits', 'Утренний брифинг: аудит защиты данных', 'Frühstücksbriefing: Datenschutz-Audits')), venue: L(t('14 Quayside Row', 'Набережный ряд, 14', 'Quayside Row 14')), city: L(t('Westbridge', 'Уэстбридж', 'Westbridge')), status: 'on', price: null, sku: '', href: '' }),
              ],
            }),
          ]),
          col(54, [
            B('form', {
              variant: 'card', req: reqBooking, fallback: 'mailto', to: 'book@aldermoor-venn.example',
              title: L(t('Request a consultation slot', 'Запрос времени консультации', 'Beratungstermin anfragen')),
              submit: L(t('Request a slot', 'Отправить запрос', 'Termin anfragen')),
              success: L(t('Thank you! We will confirm your appointment by e-mail within one working day.', 'Спасибо! Мы подтвердим время по почте в течение рабочего дня.', 'Vielen Dank! Wir bestätigen Ihren Termin per E-Mail innerhalb eines Arbeitstages.')),
              consent: L(p('We use your details only to arrange the consultation.', 'Мы используем ваши данные только для организации консультации.', 'Wir nutzen Ihre Angaben nur zur Terminvereinbarung.')),
              items: [
                field('name', 'text', t('Name', 'Имя', 'Name'), '', { required: true, half: true }),
                field('email', 'email', t('E-mail', 'E-mail', 'E-Mail'), 'name@company.example', { required: true, half: true }),
                field('date', 'date', t('Preferred day', 'Желаемый день', 'Wunschtag'), '', { required: true, half: true }),
                field('time', 'select', t('Time of day', 'Время', 'Tageszeit'), '', { half: true, options: t('Morning (8:30–12:00)\nAfternoon (12:00–16:00)\nEvening (16:00–18:30)', 'Утро (8:30–12:00)\nДень (12:00–16:00)\nВечер (16:00–18:30)', 'Vormittag (8:30–12:00)\nNachmittag (12:00–16:00)\nAbend (16:00–18:30)') }),
                field('format', 'select', t('Format', 'Формат', 'Format'), '', { half: true, options: t('Video call\nIn person\nPhone', 'Видеозвонок\nЛично в офисе\nТелефон', 'Videocall\nPersönlich\nTelefon') }),
                field('area', 'select', t('Practice area', 'Практика', 'Rechtsgebiet'), '', { half: true, options: areas }),
                field('note', 'textarea', t('In one or two sentences: what is it about?', 'В двух словах: о чём вопрос?', 'In ein, zwei Sätzen: worum geht es?'), ''),
              ],
            }),
          ]),
        ],
      }),
    ]),
    K.sec({
      anchor: 'intake', pad: 'm',
      eyebrow: t('Case intake', 'Заявка по делу', 'Mandatsanfrage'),
      title: t('Describe your case', 'Опишите вашу ситуацию', 'Schildern Sie Ihren Fall'),
      lead: p('The more we know, the faster we can tell you where you stand. A lawyer reviews every request and replies within one working day.',
        'Чем больше мы знаем, тем быстрее скажем, каковы ваши шансы. Каждую заявку читает юрист и отвечает в течение рабочего дня.',
        'Je mehr wir wissen, desto schneller sagen wir Ihnen, wo Sie stehen. Jede Anfrage prüft ein Anwalt und antwortet innerhalb eines Arbeitstages.'),
    }, [
      B('columns', {
        gap: 40, valign: 'top', cols: [
          col(60, [
            B('form', {
              variant: 'card', req: reqIntake, fallback: 'mailto', to: 'intake@aldermoor-venn.example',
              title: L(''),
              submit: L(t('Send to a lawyer', 'Отправить юристу', 'An einen Anwalt senden')),
              success: L(t('Thank you. A lawyer will review your case and reply within one working day.', 'Спасибо. Юрист изучит ситуацию и ответит в течение рабочего дня.', 'Vielen Dank. Ein Anwalt prüft Ihren Fall und antwortet innerhalb eines Arbeitstages.')),
              consent: L(p('I understand that sending this form does not yet create a lawyer–client relationship. The information is treated as confidential.',
                'Я понимаю, что отправка формы ещё не означает заключения договора. Информация остаётся конфиденциальной.',
                'Mir ist bewusst, dass mit dem Absenden noch kein Mandat entsteht. Die Angaben werden vertraulich behandelt.')),
              items: [
                field('name', 'text', t('Name', 'Имя', 'Name'), '', { required: true, half: true }),
                field('company', 'text', t('Company (if any)', 'Компания (если есть)', 'Firma (falls zutreffend)'), '', { half: true }),
                field('email', 'email', t('E-mail', 'E-mail', 'E-Mail'), 'name@company.example', { required: true, half: true }),
                field('phone', 'tel', t('Phone', 'Телефон', 'Telefon'), '+1 000 000 0000', { half: true }),
                field('area', 'select', t('Practice area', 'Практика', 'Rechtsgebiet'), '', { required: true, half: true, options: areas }),
                field('urgency', 'select', t('How urgent is it?', 'Насколько срочно?', 'Wie dringend ist es?'), '', { half: true, options: t('A deadline within days\nWithin a few weeks\nNo deadline yet', 'Срок — через несколько дней\nВ течение нескольких недель\nСрока пока нет', 'Frist in wenigen Tagen\nIn einigen Wochen\nNoch keine Frist') }),
                field('deadline', 'date', t('Known deadline', 'Известный срок', 'Bekannte Frist'), '', { half: true }),
                field('parties', 'text', t('Other parties involved', 'Другие участники', 'Weitere Beteiligte'), t('For our conflict check', 'Для проверки конфликта интересов', 'Für unsere Kollisionsprüfung'), { half: true }),
                field('summary', 'textarea', t('What happened and what do you want to achieve?', 'Что произошло и какого результата вы хотите?', 'Was ist passiert und was möchten Sie erreichen?'), '', { required: true }),
              ],
            }),
          ]),
          col(40, [
            B('quote', {
              variant: 'callout', tone: 'info', icon: K.icon('lock'), author: L(''),
              html: L(p('<strong>Confidential.</strong> Only the reviewing lawyer and our conflicts team see your request. Please do not send original documents yet.',
                '<strong>Конфиденциально.</strong> Заявку видят только юрист и сотрудник, проверяющий конфликт интересов. Пока не присылайте оригиналы документов.',
                '<strong>Vertraulich.</strong> Nur der prüfende Anwalt und unser Kollisionsteam sehen Ihre Anfrage. Bitte senden Sie noch keine Originale.')),
            }),
            B('features', {
              variant: 'list', columns: 2, items: [
                K.item({ icon: K.icon('clock'), title: L(t('Reply within 1 working day', 'Ответ за 1 рабочий день', 'Antwort binnen 1 Arbeitstag')), html: L(p('With a first view and the next step.', 'С первой оценкой и следующим шагом.', 'Mit erster Einschätzung und nächstem Schritt.')) }),
                K.item({ icon: K.icon('check'), title: L(t('Conflict check first', 'Сначала — проверка конфликта', 'Zuerst Kollisionsprüfung')), html: L(p('We confirm we can act for you.', 'Подтверждаем, что можем представлять вас.', 'Wir bestätigen, dass wir Sie vertreten dürfen.')) }),
                K.item({ icon: K.icon('note'), title: L(t('Quote before work', 'Цена до начала работы', 'Angebot vor Arbeitsbeginn')), html: L(p('Fixed fee or cap in writing.', 'Фиксированная цена или лимит — письменно.', 'Pauschale oder Obergrenze schriftlich.')) }),
                K.item({ icon: K.icon('language'), title: L(t('English, Russian, German', 'Английский, русский, немецкий', 'Englisch, Russisch, Deutsch')), html: L(p('Advice and documents in your language.', 'Консультации и документы на вашем языке.', 'Beratung und Dokumente in Ihrer Sprache.')) }),
              ],
            }),
          ]),
        ],
      }),
    ]),
    B('cta', {
      variant: 'split', tone: 'dark', bg: night, overlay: 35,
      title: L(t('Received a letter from a court or a regulator?', 'Пришло письмо из суда или от регулятора?', 'Post vom Gericht oder einer Behörde?')),
      html: L(p('Call our duty lawyer — we answer the same working day and tell you what the deadline means.', 'Позвоните дежурному юристу — мы ответим в тот же рабочий день и объясним, что означает срок.', 'Rufen Sie unseren Bereitschaftsanwalt an – wir antworten am selben Arbeitstag und erklären, was die Frist bedeutet.')),
      items: [
        K.btn('+1 (000) 000-1400', 'tel:+10000001400', 'primary', K.icon('phone')),
        K.btn(t('The first 10 days (PDF)', 'Первые 10 дней (PDF)', 'Die ersten 10 Tage (PDF)'), '#att-' + guideClaim, 'secondary', K.icon('download')),
      ],
    }),
    K.sec({
      anchor: 'guides', pad: 'm',
      eyebrow: t('Guides', 'Гайды', 'Ratgeber'),
      title: t('Free guides from our practice', 'Бесплатные гайды из нашей практики', 'Kostenlose Ratgeber aus unserer Praxis'),
    }, [
      B('columns', {
        gap: 24, valign: 'top', cols: [
          col(36, [
            B('embed', { att: guideEmp, display: 'card', player: 'object', height: 520, ratio: 'auto', caption: L(''), dl: true, op: true }),
            B('embed', { att: guideClaim, display: 'card', player: 'object', height: 520, ratio: 'auto', caption: L(''), dl: true, op: true }),
            B('quote', {
              variant: 'pull', tone: 'accent', icon: '',
              html: L(p('Write the shareholder agreement while everybody still agrees.', 'Корпоративный договор пишут, пока все ещё согласны друг с другом.', 'Schreiben Sie die Gesellschaftervereinbarung, solange sich alle noch einig sind.')),
              author: L(t('Eleanor Aldermoor', 'Элеонора Олдермур', 'Eleanor Aldermoor')),
            }),
          ]),
          col(64, [B('embed', { att: guideSha, display: 'embed', player: 'object', height: 600, ratio: 'auto', caption: L(''), dl: true, op: true })]),
        ],
      }),
    ]),
    K.sec({
      anchor: 'faq', tone: 'muted', pad: 'm', align: 'center',
      eyebrow: t('Questions', 'Вопросы', 'Fragen'),
      title: t('Before you call', 'Перед звонком', 'Bevor Sie anrufen'),
    }, [
      B('faq', {
        variant: 'details', openFirst: true, items: [
          K.item({ q: L(t('What does the first call cost?', 'Сколько стоит первый звонок?', 'Was kostet das Erstgespräch?')),
            html: L(p('Nothing. The first 30-minute call is free; a full 60-minute consultation with a written summary costs €180 and is credited if you instruct us.', 'Ничего. Первые 30 минут бесплатно; полная консультация на 60 минут с письменным резюме стоит €180 и засчитывается при заключении договора.', 'Nichts. Die ersten 30 Minuten sind kostenlos; eine 60-minütige Beratung mit schriftlicher Zusammenfassung kostet 180 € und wird bei Mandatierung angerechnet.')) }),
          K.item({ q: L(t('Do you work on fixed fees?', 'Работаете ли вы по фиксированной цене?', 'Arbeiten Sie mit Pauschalen?')),
            html: L(p('Yes, for most transactional work and many disputes. Where a fixed fee is not possible we agree a cap in the engagement letter.', 'Да, по большинству сделок и многим спорам. Если фиксировать цену нельзя, мы согласуем лимит в договоре.', 'Ja, bei den meisten Transaktionen und vielen Streitigkeiten. Wo das nicht geht, vereinbaren wir eine Obergrenze.')) }),
          K.item({ q: L(t('Who will handle my matter?', 'Кто будет вести моё дело?', 'Wer betreut mein Mandat?')),
            html: L(p('A named partner leads every matter and stays your point of contact; associates do the groundwork under their supervision.', 'Каждое дело ведёт закреплённый партнёр — он остаётся вашим контактом; юристы готовят материалы под его контролем.', 'Ein fester Partner führt jedes Mandat und bleibt Ihr Ansprechpartner; Associates arbeiten unter seiner Aufsicht zu.')) }),
          K.item({ q: L(t('Is what I send you confidential?', 'Конфиденциально ли то, что я отправляю?', 'Ist meine Anfrage vertraulich?')),
            html: L(p('Yes. Requests are seen only by the reviewing lawyer and our conflicts team, and this page keeps your form in your browser until it is sent.', 'Да. Заявку видят только юрист и сотрудник по конфликтам интересов, а страница хранит форму в вашем браузере до отправки.', 'Ja. Anfragen sehen nur der prüfende Anwalt und unser Kollisionsteam; diese Seite hält Ihr Formular bis zum Absenden in Ihrem Browser.')) }),
          K.item({ q: L(t('Do you act for individuals?', 'Работаете ли вы с частными лицами?', 'Vertreten Sie auch Privatpersonen?')),
            html: L(p('Yes — founders, executives and private clients in employment, property and shareholder matters.', 'Да — с основателями, руководителями и частными клиентами по трудовым, имущественным и корпоративным вопросам.', 'Ja – Gründer, Führungskräfte und Privatpersonen in Arbeits-, Immobilien- und Gesellschafterfragen.')) }),
          K.item({ q: L(t('Which languages do you work in?', 'На каких языках вы работаете?', 'In welchen Sprachen arbeiten Sie?')),
            html: L(p('English, Russian and German, including contracts in two languages and court filings with certified translations.', 'Английский, русский и немецкий — включая двуязычные договоры и процессуальные документы с заверенным переводом.', 'Englisch, Russisch und Deutsch, einschließlich zweisprachiger Verträge und Schriftsätze mit beglaubigten Übersetzungen.')) }),
        ],
      }),
    ]),
    K.sec({
      anchor: 'contact', pad: 'm',
      eyebrow: t('Contact', 'Контакты', 'Kontakt'),
      title: t('Visit us on Quayside Row', 'Приходите к нам на Набережный ряд', 'Besuchen Sie uns an der Quayside Row'),
    }, [
      B('contact', {
        variant: 'split', labels: true, map, mapHref: '', items: [
          K.item({ kind: 'address', value: '14 Quayside Row\nWestbridge WB1 0AA', label: L(t('Chambers', 'Офис', 'Kanzlei')), href: '' }),
          K.item({ kind: 'phone', value: '+1 (000) 000-1400', label: L(t('Reception and duty lawyer', 'Приёмная и дежурный юрист', 'Empfang und Bereitschaftsanwalt')), href: '' }),
          K.item({ kind: 'email', value: 'hello@aldermoor-venn.example', label: L(t('General enquiries', 'Общие вопросы', 'Allgemeine Anfragen')), href: '' }),
          K.item({ kind: 'email', value: 'intake@aldermoor-venn.example', label: L(t('New matters', 'Новые дела', 'Neue Mandate')), href: '' }),
          K.item({ kind: 'hours', value: '08:30–18:30', label: L(t('Office hours, Mon–Fri', 'Часы работы, пн–пт', 'Bürozeiten, Mo–Fr')), href: '' }),
        ],
      }),
    ]),
  ];
  // ----- pages: home (practice, fees, FAQ), the firm, guides, contact; the "Not found" page -----
  const main = d.regions.main;
  const at = (a) => main.find((b) => b.anchor === a);
  const pageHero = (eyebrow, title, text) => B('hero', { layout: 'left', height: 'auto', eyebrow: L(eyebrow), title: L(title), text: L(text), items: [] });
  const statsSec = main[1];
  if (statsSec && statsSec.blocks[0]) statsSec.blocks[0].count = true;
  // Fees: the three offers side by side.
  at('fees').blocks.splice(1, 0, B('spacer', { h: 8 }), B('compare', {
    cols: L(t('Consultation\nFixed-fee package\nRetainer', 'Консультация\nПакет\nАбонемент', 'Erstberatung\nPauschalpaket\nBeratungsmandat')), featured: 2,
    caption: L(t('What each offer includes', 'Что входит в каждое предложение', 'Was jedes Angebot umfasst')),
    items: [
      K.item({ label: L(t('Advice', 'Консультации', 'Beratung')), group: true, values: L(''), note: L('') }),
      K.item({ label: L(t('Time with a lawyer', 'Время юриста', 'Zeit mit einem Anwalt')), values: L(t('60 minutes\nas the package needs\nup to 12 hours a month', '60 минут\nсколько нужно пакету\nдо 12 часов в месяц', '60 Minuten\nnach Bedarf des Pakets\nbis zu 12 Stunden im Monat')), note: L('') }),
      K.item({ label: L(t('Written summary', 'Письменное резюме', 'Schriftliche Zusammenfassung')), values: L('+\n+\n+'), note: L('') }),
      K.item({ label: L(t('Named partner', 'Закреплённый партнёр', 'Fester Partner')), values: L('-\n+\n+'), note: L('') }),
      K.item({ label: L(t('Documents', 'Документы', 'Dokumente')), group: true, values: L(''), note: L('') }),
      K.item({ label: L(t('Drafting', 'Подготовка документов', 'Entwürfe')), values: L(t('-\nincluded\nincluded', '-\nвключено\nвключено', '-\ninklusive\ninklusive')), note: L('') }),
      K.item({ label: L(t('Contract review', 'Проверка договоров', 'Vertragsprüfung')), values: L(t('-\ntwo rounds\nwithin 48 hours', '-\nдве итерации\nза 48 часов', '-\nzwei Runden\nbinnen 48 Stunden')), note: L(t('Turnaround', 'Срок', 'Bearbeitungszeit')) }),
    ],
  }));
  at('faq').blocks[0].single = true;
  // The firm: results, voices with their sources, clients in a moving strip, the partners.
  const results = at('results');
  const voices = results.blocks.find((b) => b.type === 'testimonials');
  voices.variant = 'quote';
  voices.summary = true;
  voices.autoplay = 8;
  const sources = [t('Google review', 'Отзыв в Google', 'Google-Bewertung'), t('Legal 500 client interview', 'Интервью клиента Legal 500', 'Mandanteninterview Legal 500'), t('Client survey 2025', 'Опрос клиентов 2025', 'Mandantenbefragung 2025')];
  voices.items.forEach((it, i) => { it.source = L(sources[i % sources.length]); });
  const clientsStrip = results.blocks.find((b) => b.type === 'logos');
  clientsStrip.variant = 'marquee';
  clientsStrip.speed = 45;
  // Contact: the next free clinic counts down above the booking form.
  const book = at('book');
  book.blocks.unshift(B('countdown', {
    title: L(t('Next free founders’ clinic', 'Следующая бесплатная клиника для основателей', 'Nächste kostenlose Gründer-Sprechstunde')),
    date: '2026-11-05', time: '18:00', tz: 0, units: 'dhm', variant: 'plain',
    done: L(t('The clinic has started — the next dates are listed below.', 'Встреча уже началась — следующие даты ниже.', 'Die Sprechstunde hat begonnen – die nächsten Termine finden Sie unten.')),
  }), B('spacer', { h: 16 }));
  const cta = main.find((b) => b.type === 'cta');
  const home = [main[0], statsSec, at('practice'), at('process'), at('fees'), cta, at('faq')];
  d.regions.main = [
    ...home,
    B('page', {
      slug: 'firm', title: L(t('The firm', 'О фирме', 'Kanzlei')),
      metaDesc: L(t('Selected matters, client voices and the partners of Aldermoor & Venn.', 'Избранные дела, отзывы клиентов и партнёры «Олдермур и Венн».', 'Ausgewählte Mandate, Stimmen von Mandanten und die Partner von Aldermoor & Venn.')),
      blocks: [pageHero(t('The firm', 'О фирме', 'Die Kanzlei'), t('Twenty-seven years of matters that ended well', 'Двадцать семь лет дел, которые закончились хорошо', 'Siebenundzwanzig Jahre Mandate mit gutem Ausgang'),
        p('A partner-led team of 38 lawyers and paralegals — and the clients who trust them with the decisions that matter.', 'Команда из 38 юристов и помощников во главе с партнёрами — и клиенты, которые доверяют им важные решения.', 'Ein partnergeführtes Team aus 38 Anwälten und Fachangestellten – und die Mandanten, die ihnen wichtige Entscheidungen anvertrauen.')),
      results, at('team')],
    }),
    B('page', {
      slug: 'guides', title: L(t('Guides', 'Гайды', 'Ratgeber')),
      blocks: [pageHero(t('Guides', 'Гайды', 'Ratgeber'), t('Practical guides, free to read and download', 'Практические гайды — бесплатно', 'Praxisratgeber zum Lesen und Herunterladen'),
        p('Checklists and first steps written by our lawyers — read them in the browser or take the PDF with you.', 'Чек-листы и первые шаги от наших юристов — читайте в браузере или скачайте PDF.', 'Checklisten und erste Schritte von unseren Anwälten – im Browser lesen oder als PDF mitnehmen.')),
      at('guides')],
    }),
    B('page', {
      slug: 'contact', title: L(t('Contact', 'Контакты', 'Kontakt')),
      metaDesc: L(t('Book a consultation, describe your case or visit Aldermoor & Venn on Quayside Row.', 'Запишитесь на консультацию, опишите ситуацию или приходите к нам на Набережный ряд.', 'Beratung buchen, Fall schildern oder Aldermoor & Venn an der Quayside Row besuchen.')),
      blocks: [book, at('intake'), at('contact')],
    }),
    V.notFoundPage ? V.notFoundPage(d, ['en', 'ru', 'de']) : null,
  ].filter(Boolean);
  // Site-wide announcement above the navigation (closable; it shows again when its text changes).
  d.regions.header.unshift(B('announce', {
    tone: 'dark', icon: K.icon('calendar'), dismiss: true, href: '#book',
    html: L(t('<strong>Free founders’ clinic</strong> on 5 November — 30-minute slots with a partner.', '<strong>Бесплатная клиника для основателей</strong> 5 ноября — 30 минут с партнёром.', '<strong>Kostenlose Gründer-Sprechstunde</strong> am 5. November – 30 Minuten mit einem Partner.')),
    label: L(t('Book a slot', 'Записаться', 'Termin buchen')),
  }));
  // The navigation links the pages (nav page links); its own items keep the sections of the home page.
  d.regions.header.find((b) => b.type === 'nav').items = [
    K.item({ label: L(t('Practice', 'Практики', 'Rechtsgebiete')), href: '#practice' }),
    K.item({ label: L(t('Fees', 'Стоимость', 'Honorare')), href: '#fees' }),
  ];

  // Floating "Online consultation" chat on every page (footer region): no external API here — a static page leaves
  // the message by e-mail, a backend export answers it live (the export check offers both).
  const chatHost = [];
  if (V.BLOCK_TYPES && V.BLOCK_TYPES.chat) {
    const avatar = img('chat-duty-lawyer.svg', tplLegalAvatarSVG(), t('Duty lawyer', 'Дежурный юрист', 'Bereitschaftsanwalt'));
    chatHost.push(B('chat', {
      display: 'bubble', side: 'right', avatar,
      title: L(t('Online consultation', 'Онлайн-консультация', 'Online-Beratung')),
      operator: L(t('Duty lawyer · Aldermoor & Venn', 'Дежурный юрист · «Олдермур и Венн»', 'Bereitschaftsanwalt · Aldermoor & Venn')),
      welcome: L(t('Hello! Describe your question in a few sentences — a lawyer will tell you where you stand and what the next step is. Everything you write here is confidential and seen only by our lawyers.',
        'Здравствуйте! Опишите вопрос в нескольких предложениях — юрист оценит ситуацию и подскажет следующий шаг. Всё, что вы пишете, конфиденциально и доступно только нашим юристам.',
        'Guten Tag! Schildern Sie Ihr Anliegen in ein paar Sätzen – ein Anwalt sagt Ihnen, wo Sie stehen und was als Nächstes zu tun ist. Alles, was Sie hier schreiben, ist vertraulich und nur für unsere Anwälte sichtbar.')),
      offline: L(t('Our lawyers answer Mon–Fri, 08:30–18:30. Leave your question with an e-mail or phone number and we will reply within one working day.',
        'Юристы отвечают пн–пт с 08:30 до 18:30. Оставьте вопрос с e-mail или телефоном — ответим в течение рабочего дня.',
        'Unsere Anwälte antworten Mo–Fr von 08:30 bis 18:30 Uhr. Hinterlassen Sie Ihre Frage mit E-Mail oder Telefon – wir antworten innerhalb eines Arbeitstages.')),
      nameField: 'optional', contactField: 'required', fallback: 'mailto', to: 'intake@aldermoor-venn.example',
    }));
  }

  // ----- footer -----
  const links = (rows) => '<ul>' + rows.map(([h, x]) => '<li><a href="' + h + '">' + x + '</a></li>').join('') + '</ul>';
  const contacts = '<p><a href="tel:+10000001400">+1 (000) 000-1400</a><br><a href="mailto:hello@aldermoor-venn.example">hello@aldermoor-venn.example</a></p>';
  d.regions.footer = [
    B('footer', {
      variant: 'columns', tone: 'dark', logo: brand, logoH: 44,
      brand: L(t('Aldermoor & Venn', 'Олдермур и Венн', 'Aldermoor & Venn')),
      text: L(t('<p>Business law firm in Westbridge since 1998.</p>' + contacts, '<p>Юридическая фирма для бизнеса с 1998 года.</p>' + contacts, '<p>Wirtschaftskanzlei in Westbridge seit 1998.</p>' + contacts)),
      items: [
        K.item({ title: L(t('Practice', 'Практики', 'Rechtsgebiete')), html: L(t(
          links([['#practice', 'Corporate & M&A'], ['#practice', 'Contracts'], ['#practice', 'Employment'], ['#practice', 'Disputes']]),
          links([['#practice', 'Корпоративное право'], ['#practice', 'Договоры'], ['#practice', 'Трудовое право'], ['#practice', 'Споры']]),
          links([['#practice', 'Gesellschaftsrecht'], ['#practice', 'Verträge'], ['#practice', 'Arbeitsrecht'], ['#practice', 'Prozesse']]))) }),
        K.item({ title: L(t('Firm', 'Фирма', 'Kanzlei')), html: L(t(
          links([['#team', 'Team'], ['#fees', 'Fees'], ['#results', 'Results'], ['#book', 'Book a consultation']]),
          links([['#team', 'Команда'], ['#fees', 'Стоимость'], ['#results', 'Результаты'], ['#book', 'Консультация']]),
          links([['#team', 'Team'], ['#fees', 'Honorare'], ['#results', 'Erfolge'], ['#book', 'Beratung buchen']]))) }),
        K.item({ title: L(t('Guides', 'Гайды', 'Ratgeber')), html: L(t(
          links([['#att-' + guideSha, 'Shareholder agreements'], ['#att-' + guideEmp, 'Employment checklist'], ['#att-' + guideClaim, 'Received a claim?'], ['#att-' + fees, 'Fee schedule']]),
          links([['#att-' + guideSha, 'Корпоративный договор'], ['#att-' + guideEmp, 'Трудовой договор'], ['#att-' + guideClaim, 'Получили иск?'], ['#att-' + fees, 'Тарифы']]),
          links([['#att-' + guideSha, 'Gesellschaftervereinbarung'], ['#att-' + guideEmp, 'Checkliste Arbeitsvertrag'], ['#att-' + guideClaim, 'Klage erhalten?'], ['#att-' + fees, 'Honorare']]))) }),
      ],
      copy: L(t('© 2026 Aldermoor & Venn LLP · Past results do not guarantee a similar outcome.', '© 2026 «Олдермур и Венн» · Прошлые результаты не гарантируют такого же исхода.', '© 2026 Aldermoor & Venn Rechtsanwälte · Frühere Ergebnisse garantieren keinen gleichen Ausgang.')),
    }),
    ...chatHost,
  ];
  return V.normalizeDoc(d);
}

const TPL_LEGAL = {
  id: 'legal',
  name: { en: 'Legal services', ru: 'Юридические услуги', de: 'Rechtsberatung', fr: 'Services juridiques', es: 'Servicios jurídicos', uk: 'Юридичні послуги', ka: 'იურიდიული მომსახურება' },
  desc: {
    en: 'Business law firm: practice areas, how we work, fees and packages, hourly rates, selected matters and testimonials, partners, clinics and consultation booking, case intake form, PDF guides, FAQ and contacts with a map.',
    ru: 'Юридическая фирма: практики, порядок работы, пакеты и цены, почасовые ставки, избранные дела и отзывы, партнёры, мероприятия и запись на консультацию, заявка по делу, гайды в PDF, FAQ и контакты с картой.',
    de: 'Wirtschaftskanzlei: Rechtsgebiete, Arbeitsweise, Pakete und Honorare, Stundensätze, ausgewählte Mandate und Stimmen, Partner, Sprechstunden und Terminbuchung, Mandatsanfrage, PDF-Ratgeber, FAQ und Kontakt mit Karte.',
    fr: 'Cabinet d’avocats d’affaires : domaines d’expertise, méthode, forfaits et honoraires, taux horaires, dossiers et témoignages, associés, permanences et prise de rendez-vous, formulaire de dossier, guides PDF, FAQ et contact avec plan.',
    es: 'Despacho de abogados de empresa: áreas de práctica, método, paquetes y honorarios, tarifas por hora, casos y testimonios, socios, sesiones y reserva de consulta, formulario de caso, guías en PDF, FAQ y contacto con mapa.',
    uk: 'Юридична фірма: практики, порядок роботи, пакети й ціни, погодинні ставки, вибрані справи та відгуки, партнери, заходи й запис на консультацію, заявка у справі, гайди в PDF, FAQ і контакти з картою.',
    ka: 'ბიზნეს-იურიდიული ფირმა: პრაქტიკის სფეროები, მუშაობის წესი, პაკეტები და ჰონორარები, საათობრივი ტარიფები, საქმეები და შეფასებები, პარტნიორები, შეხვედრები და კონსულტაციის ჯავშანი, საქმის განაცხადი, PDF გზამკვლევები, FAQ და კონტაქტი რუკით.',
  },
  langs: ['en', 'ru', 'de'],
  build: tplBuildLegal,
};

export {
  TPL_LEGAL,
  tplBuildLegal,
  tplLegalArtPreview,
  tplLegalAvatarSVG,
  tplLegalBrandSVG,
  tplLegalDesk,
  tplLegalPortico
};
