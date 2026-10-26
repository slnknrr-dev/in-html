// contract/lease.js - the built-in template of a residential lease (договор найма жилого помещения): Russian as the
// main language, English as the second. Parties (a person or an organisation as the landlord, a realtor acting under
// a power of attorney or an agency agreement), the flat and the title to it, the term, the rent with the billing
// periods (the 23rd to the 22nd, the last one ending the day before the move-out date) and the payment schedule,
// the deposit, utilities, obligations, nuances (pets, smoking, subletting, early termination, repairs), additional
// services, strictness variants (deposit, late fees, notice, termination), signatures, the schedule appendix, the
// services appendix and the act of acceptance with the inventory and meter readings.
//
//   LEASE -> raw template (normalize with contract/model.js normalizeTemplate)

// Structure of this data file (large literal; commented at the structure level only):
//   VALIDATOR   the template's JS validator as source TEXT (a template literal, not a function): templates are JSON
//               documents, so code travels as a string and is compiled only inside the sandboxed Worker
//               (validate.js). Its comments are part of the shipped template and are shown to authors in the editor.
//   LEASE       modifiers (on/off switches that show or hide sections), levels (strictness: soft/standard/strict,
//               chosen per clause through `by` + `variants`), groups (form fieldsets), fields (typed inputs),
//               sections -> clauses (texts with {{placeholders}} and [[if]]/[[each]] blocks, `when` conditions),
//               validator, sample (demo values for the editor's preview).
// L(ru, en): the localized-text shape {lang: text} written compactly; the main language goes first by convention.
// Note in VALIDATOR: helpers.days(a, b) is b - a, so `days(d.until, term.start) > 0` means the lease starts after
// the authority has expired. The guard tests term.last but the call uses term.start; an absent start makes days()
// return null and the comparison false, so the mismatch is harmless.
const L = (ru, en) => ({ ru, en });

const VALIDATOR = `// The template's own checks. fields: the values (fields.rent, fields.term.months, fields.tenant.name …),
// ctx: { lang, modifiers, levels }, helpers: days(a, b), isEmpty(v), digits(s). Return a list of
// { field, level: 'error' | 'warning', message }.
const ru = ctx.lang === 'ru';
const issues = [];
const term = fields.term || {};
if (term.months >= 12) issues.push({ field: 'term', level: 'warning', message: ru
  ? 'Договор на год и более: обременение квартиры подлежит государственной регистрации (ст. 674 ГК РФ).'
  : 'A lease of a year or more has to be registered as an encumbrance (Civil Code, art. 674).' });
if (fields.signDate && term.start && helpers.days(fields.signDate, term.start) < 0) issues.push({ field: 'term', level: 'warning',
  message: ru ? 'Найм начинается раньше даты подписания договора.' : 'The lease starts before the agreement is signed.' });
const a = fields.landlord || {}, b = fields.tenant || {};
if (a.name && b.name && a.name.trim().toLowerCase() === b.name.trim().toLowerCase()) issues.push({ field: 'tenant', level: 'error',
  message: ru ? 'Наймодатель и Наниматель — одно и то же лицо.' : 'The landlord and the tenant are the same person.' });
if (ctx.modifiers.poa) {
  const d = fields.agentDoc || {};
  if (d.until && term.last && helpers.days(d.until, term.start) > 0) issues.push({ field: 'agentDoc', level: 'error',
    message: ru ? 'Полномочия представителя истекают до начала найма.' : 'The representative\\'s authority ends before the lease starts.' });
  if (d.kind === 'simple') issues.push({ field: 'agentDoc', level: 'warning', message: ru
    ? 'Простая письменная доверенность: попросите у собственника подтверждение полномочий (звонок, переписка).'
    : 'A simple written power of attorney: ask the owner to confirm the authority.' });
}
if (fields.rent && fields.deposit > fields.rent * 3) issues.push({ field: 'deposit', level: 'warning',
  message: ru ? 'Обеспечительный платёж больше трёх месячных плат.' : 'The deposit exceeds three months of rent.' });
if (ctx.modifiers.extraServices && !(fields.services || []).length) issues.push({ field: 'services', level: 'warning',
  message: ru ? 'Включены дополнительные услуги, но список пуст.' : 'Additional services are on, but the list is empty.' });
return issues;
`;

export const LEASE = {
  id: 'lease-residential', version: 1, builtin: true, kind: 'lease',
  langs: ['ru', 'en'], main: 'ru',
  name: L('Договор найма жилого помещения', 'Residential lease agreement'),
  description: L('Квартира в найм физическому лицу: доверенность риелтора, доп. услуги, особые условия, строгость, график платежей, акт приёма-передачи.',
    'A flat let to a person: realtor\'s power of attorney, additional services, special terms, strictness, payment schedule, act of acceptance.'),
  title: L('ДОГОВОР НАЙМА ЖИЛОГО ПОМЕЩЕНИЯ № {{number}}', 'RESIDENTIAL LEASE AGREEMENT No. {{number}}'),
  page: { size: 'A4', margins: [20, 15, 20, 25], font: 'serif', fontSize: 12 },
  modifiers: [
    { id: 'poa', label: L('Доверенность', 'Power of attorney'), help: L('От имени собственника действует представитель (риелтор) по доверенности или агентскому договору.', 'A representative (a realtor) acts for the owner under a power of attorney or an agency agreement.') },
    { id: 'extraServices', label: L('Доп. услуги', 'Additional services'), help: L('Уборка, интернет, парковка и другие услуги со своей ценой: приложение к договору.', 'Cleaning, internet, parking and other priced services: an appendix to the agreement.') },
    { id: 'nuances', label: L('Особые условия', 'Special terms'), help: L('Животные, курение, поднаём, досрочное расторжение, ремонт.', 'Pets, smoking, subletting, early termination, repairs.') },
    { id: 'act', label: L('Акт приёма-передачи', 'Act of acceptance'), help: L('Акт с описью имущества и показаниями счётчиков.', 'The act with the inventory and the meter readings.'), default: true },
  ],
  levels: [
    { id: 'strictness', label: L('Строгость', 'Strictness'), default: 'standard', options: [
      { v: 'soft', label: L('Мягко', 'Soft') }, { v: 'standard', label: L('Стандарт', 'Standard') }, { v: 'strict', label: L('Строго', 'Strict') }] },
  ],
  groups: [
    { id: 'doc', label: L('Договор', 'Agreement') }, { id: 'parties', label: L('Стороны', 'Parties') }, { id: 'poa', label: L('Представитель', 'Representative') },
    { id: 'flat', label: L('Квартира', 'Flat') }, { id: 'money', label: L('Срок и оплата', 'Term and payment') }, { id: 'services', label: L('Доп. услуги', 'Additional services') },
    { id: 'nuances', label: L('Особые условия', 'Special terms') }, { id: 'act', label: L('Акт приёма-передачи', 'Act of acceptance') },
  ],
  fields: [
    { id: 'number', type: 'text', group: 'doc', label: L('Номер договора', 'Agreement number'), default: '1' },
    { id: 'city', type: 'text', group: 'doc', label: L('Город', 'City'), required: true },
    { id: 'signDate', type: 'date', group: 'doc', label: L('Дата подписания', 'Date of signing'), required: true, default: 'today' },
    { id: 'landlord', type: 'party', group: 'parties', label: L('Наймодатель (собственник)', 'Landlord (owner)'), required: true, kinds: ['person', 'org'],
      parts: { person: ['name', 'gender', 'birthDate', 'passport', 'passportIssuer', 'passportDate', 'passportCode', 'address', 'phone', 'email'] } },
    { id: 'tenant', type: 'party', group: 'parties', label: L('Наниматель', 'Tenant'), required: true, kinds: ['person'],
      parts: { person: ['name', 'gender', 'birthDate', 'passport', 'passportIssuer', 'passportDate', 'passportCode', 'address', 'phone', 'email'] } },
    { id: 'agent', type: 'party', group: 'poa', label: L('Представитель наймодателя (риелтор)', 'Landlord\'s representative (realtor)'), required: true, kinds: ['person'],
      parts: { person: ['name', 'gender', 'birthDate', 'passport', 'passportIssuer', 'passportDate', 'address', 'phone'] } },
    { id: 'agentDoc', type: 'docref', group: 'poa', label: L('Документ о полномочиях', 'Document of authority'), required: true, parts: ['kind', 'number', 'date', 'issuer', 'until'],
      kinds: [
        { v: 'notarial', label: L('нотариальной доверенности', 'a notarised power of attorney'), issuer: L('удостоверенной', 'certified by') },
        { v: 'simple', label: L('доверенности в простой письменной форме', 'a simple written power of attorney'), issuer: L('выданной', 'issued by') },
        { v: 'agency', label: L('агентского договора с собственником', 'an agency agreement with the owner'), issuer: L('заключённого с', 'concluded with') },
        { v: 'other', label: L('документа', 'the document'), issuer: L('выданного', 'issued by') }],
      help: L('Нотариальная доверенность, простая письменная доверенность или агентский договор с собственником; срок действия — если указан.', 'A notarised or simple written power of attorney, or an agency agreement with the owner; the validity date if it has one.') },
    { id: 'address', type: 'longtext', group: 'flat', label: L('Адрес квартиры', 'Address of the flat'), required: true },
    { id: 'cadastral', type: 'text', group: 'flat', label: L('Кадастровый номер', 'Cadastral number'), mask: 'cadastral-ru' },
    { id: 'rooms', type: 'number', group: 'flat', label: L('Комнат', 'Rooms'), min: 1, max: 20, default: 1 },
    { id: 'area', type: 'number', group: 'flat', label: L('Общая площадь', 'Total area'), min: 5, max: 2000, unit: L('кв. м', 'sq. m') },
    { id: 'floor', type: 'number', group: 'flat', label: L('Этаж', 'Floor'), min: -5, max: 200 },
    { id: 'ownershipDoc', type: 'docref', group: 'flat', label: L('Право собственности подтверждает', 'Title is confirmed by'), parts: ['kind', 'number', 'date'],
      kinds: [
        { v: 'egrn', label: L('выпиской из ЕГРН', 'an extract from the Unified State Register'), issuer: L('выданной', 'issued by') },
        { v: 'cert', label: L('свидетельством о государственной регистрации права', 'a certificate of state registration of title'), issuer: L('выданным', 'issued by') },
        { v: 'sale', label: L('договором купли-продажи', 'a sale and purchase agreement'), issuer: L('заключённым с', 'concluded with') }] },
    { id: 'occupants', type: 'list', group: 'flat', label: L('Совместно проживающие', 'Other occupants'), max: 10,
      items: [{ id: 'name', type: 'text', label: L('ФИО', 'Full name'), required: true }, { id: 'birthDate', type: 'date', label: L('Дата рождения', 'Date of birth') }, { id: 'relation', type: 'text', label: L('Кем приходится', 'Relation') }] },
    { id: 'term', type: 'period', group: 'money', label: L('Срок найма', 'Term of the lease'), required: true, default: { months: 11 }, minMonths: 1, maxMonths: 60,
      help: L('Каждый расчётный период — с числа начала по предыдущее число следующего месяца; последний заканчивается за день до даты выезда.', 'Every billing period runs from the start day to the day before it in the next month; the last one ends the day before the move-out date.') },
    { id: 'rent', type: 'money', group: 'money', label: L('Плата за месяц', 'Monthly rent'), required: true, currency: 'RUB', min: 1 },
    { id: 'schedule', type: 'schedule', group: 'money', label: L('График платежей', 'Payment schedule'), term: 'term', amount: 'rent', prorata: true, dueOffset: 0, currency: 'RUB' },
    { id: 'payMethod', type: 'select', group: 'money', label: L('Способ оплаты', 'Payment method'), default: 'transfer',
      options: [{ v: 'transfer', label: L('Перевод на счёт', 'Bank transfer') }, { v: 'cash', label: L('Наличными под расписку', 'Cash against receipt') }] },
    { id: 'bankDetails', type: 'longtext', group: 'money', label: L('Реквизиты для перевода', 'Bank details'), required: true },
    { id: 'depositMonths', type: 'computed', group: 'money', label: L('Залог, месяцев платы', 'Deposit, months of rent'), expr: "strictness == 'strict' ? 2 : strictness == 'soft' ? 0.5 : 1", format: 'number' },
    { id: 'deposit', type: 'computed', group: 'money', label: L('Обеспечительный платёж', 'Deposit'), expr: 'round(rent * depositMonths)', format: 'money', currency: 'RUB' },
    { id: 'lateFeePct', type: 'computed', group: 'money', label: L('Неустойка, % в день', 'Late fee, % a day'), expr: "strictness == 'strict' ? 1 : strictness == 'soft' ? 0.1 : 0.3", format: 'number' },
    { id: 'noticeDays', type: 'computed', group: 'money', label: L('Срок уведомления, дней', 'Notice, days'), expr: "strictness == 'strict' ? 60 : strictness == 'soft' ? 14 : 30", format: 'number' },
    { id: 'utilities', type: 'select', group: 'money', label: L('Коммунальные услуги', 'Utilities'), default: 'meters',
      options: [{ v: 'meters', label: L('Наниматель — по счётчикам', 'Tenant pays by the meters') }, { v: 'included', label: L('Включены в плату', 'Included in the rent') }] },
    { id: 'services', type: 'list', group: 'services', label: L('Дополнительные услуги', 'Additional services'), min: 1, currency: 'RUB',
      items: [{ id: 'name', type: 'text', label: L('Услуга', 'Service'), required: true }, { id: 'terms', type: 'text', label: L('Периодичность', 'How often') }, { id: 'price', type: 'money', label: L('Цена в месяц', 'Price a month'), currency: 'RUB', required: true }] },
    { id: 'servicesTotal', type: 'computed', group: 'services', label: L('Итого доп. услуги', 'Additional services total'), expr: "sum(services, 'price')", format: 'money', currency: 'RUB' },
    { id: 'pets', type: 'bool', group: 'nuances', label: L('Можно с животными', 'Pets allowed') },
    { id: 'petsDesc', type: 'text', group: 'nuances', label: L('Какие животные', 'Which pets'), required: true },
    { id: 'smoking', type: 'bool', group: 'nuances', label: L('Курение на балконе', 'Smoking on the balcony') },
    { id: 'sublet', type: 'bool', group: 'nuances', label: L('Поднаём с согласия', 'Subletting with consent') },
    { id: 'earlyTermination', type: 'bool', group: 'nuances', label: L('Досрочный выезд без штрафа', 'Early move-out without a fine'), default: true },
    { id: 'earlyFee', type: 'money', group: 'nuances', label: L('Штраф за досрочный выезд', 'Early move-out fine'), currency: 'RUB', required: true },
    { id: 'repairs', type: 'bool', group: 'nuances', label: L('Косметический ремонт нанимателем', 'Tenant may redecorate') },
    { id: 'otherTerms', type: 'longtext', group: 'nuances', label: L('Другие условия', 'Other terms') },
    { id: 'condition', type: 'longtext', group: 'act', label: L('Состояние квартиры', 'Condition of the flat'), default: '' },
    { id: 'keys', type: 'number', group: 'act', label: L('Комплектов ключей', 'Sets of keys'), min: 1, max: 20, default: 2 },
    { id: 'inventory', type: 'list', group: 'act', label: L('Опись имущества', 'Inventory'),
      items: [{ id: 'name', type: 'text', label: L('Предмет', 'Item'), required: true }, { id: 'qty', type: 'number', label: L('Кол-во', 'Qty') }, { id: 'state', type: 'text', label: L('Состояние', 'Condition') }] },
    { id: 'meters', type: 'list', group: 'act', label: L('Показания счётчиков', 'Meter readings'),
      items: [{ id: 'name', type: 'text', label: L('Счётчик', 'Meter'), required: true }, { id: 'serial', type: 'text', label: L('Номер', 'Serial') }, { id: 'reading', type: 'number', label: L('Показание', 'Reading') }] },
  ],
  sections: [
    { id: 'head', kind: 'plain', clauses: [
      { id: 'place', text: L('г. {{city}}\t{{signDate}}', '{{city}}\t{{signDate}}') },
      { id: 'parties', text: L(
        '{{landlord}}[[if poa]], от имени и в интересах {{landlord|g:\'которого\',\'которой\',\'которого\'}} действует {{agent}} на основании {{agentDoc}}[[end]], {{landlord|g:\'именуемый\',\'именуемая\',\'именуемое\'}} в дальнейшем «Наймодатель», с одной стороны, и {{tenant}}, {{tenant|g:\'именуемый\',\'именуемая\'}} в дальнейшем «Наниматель», с другой стороны, вместе именуемые «Стороны», заключили настоящий договор (далее — «Договор») о нижеследующем:',
        '{{landlord}}[[if poa]], represented by {{agent}} acting under {{agentDoc}}[[end]], hereinafter the “Landlord”, of the one part, and {{tenant}}, hereinafter the “Tenant”, of the other part, together the “Parties”, have concluded this agreement (the “Agreement”) as follows:') },
    ] },
    { id: 'subject', title: L('Предмет договора', 'Subject of the Agreement'), clauses: [
      { id: 'flat', text: L(
        'Наймодатель предоставляет Нанимателю за плату во владение и пользование для проживания жилое помещение — {{rooms}}-комнатную квартиру общей площадью {{area}}[[if floor]] на {{floor}}-м этаже[[end]], расположенную по адресу: {{address}}[[if cadastral]], кадастровый номер {{cadastral}}[[end]] (далее — «Квартира»).',
        'The Landlord lets to the Tenant for payment, for possession and use as a dwelling, a {{rooms}}-room flat with a total area of {{area}}[[if floor]] on floor {{floor}}[[end]] at: {{address}}[[if cadastral]], cadastral number {{cadastral}}[[end]] (the “Flat”).') },
      { id: 'title', text: L('Квартира принадлежит Наймодателю на праве собственности, что подтверждается {{ownershipDoc}}.', 'The Flat is owned by the Landlord, as confirmed by {{ownershipDoc}}.') },
      { id: 'warranty', text: L(
        'Наймодатель гарантирует, что Квартира не продана, не заложена, в споре и под арестом не состоит и не обременена правами третьих лиц[[if poa]], а полномочия его представителя действуют на дату подписания Договора и не отозваны[[end]].',
        'The Landlord warrants that the Flat is not sold, mortgaged, disputed or seized and is free of third-party rights[[if poa]], and that the authority of the representative is valid on the date of signing and has not been revoked[[end]].') },
      { id: 'occupantsCl', text: L(
        '[[if occupants]]Вместе с Нанимателем в Квартире будут проживать: [[each occupants as p]]{{p.name}}[[if p.birthDate]], {{p.birthDate|date:\'short\'}} г. р.[[end]][[if p.relation]] ({{p.relation}})[[end]][[if index < count(occupants)]]; [[end]][[end]].[[else]]Иные лица постоянно проживать в Квартире не будут.[[end]] Временное проживание гостей не более 7 (семи) дней подряд не требует согласия Наймодателя.',
        '[[if occupants]]The following persons will live in the Flat with the Tenant: [[each occupants as p]]{{p.name}}[[if p.birthDate]], born {{p.birthDate|date:\'short\'}}[[end]][[if p.relation]] ({{p.relation}})[[end]][[if index < count(occupants)]]; [[end]][[end]].[[else]]No other persons will live in the Flat permanently.[[end]] Guests staying up to 7 (seven) days in a row need no consent of the Landlord.') },
      { id: 'handover', text: L(
        'Квартира передаётся с мебелью, бытовой техникой и оборудованием[[if act]] по акту приёма-передачи (Приложение № {{#actApp}}), в котором фиксируются её состояние, опись имущества и показания приборов учёта[[end]].',
        'The Flat is let with its furniture, appliances and fittings[[if act]] under the act of acceptance (Appendix {{#actApp}}) recording its condition, the inventory and the meter readings[[end]].') },
    ] },
    { id: 'termSec', title: L('Срок найма', 'Term'), clauses: [
      { id: 'termCl', text: L(
        'Договор заключён на {{term.months}} ({{term.months|words}}) {{term.months|plural:\'месяц\',\'месяца\',\'месяцев\'}}: с {{term.start}} по {{term.last}} включительно. Наниматель освобождает и возвращает Квартиру Наймодателю не позднее {{term.end}}.',
        'The Agreement is concluded for {{term.months}} ({{term.months|words}}) {{term.months|plural:\'month\',\'months\'}}: from {{term.start}} to {{term.last}} inclusive. The Tenant vacates the Flat and returns it to the Landlord no later than {{term.end}}.') },
      { id: 'effect', text: L('Договор вступает в силу с момента подписания и действует до полного исполнения Сторонами своих обязательств.', 'The Agreement enters into force on signing and remains in force until the Parties have fully performed their obligations.') },
      { id: 'renewal', by: 'strictness', text: L('', ''), variants: {
        soft: L('Если ни одна из Сторон не позднее чем за 30 (тридцать) дней до окончания срока не заявит о прекращении Договора, он считается продлённым на тот же срок на тех же условиях.',
          'Unless either Party gives notice of termination no later than 30 (thirty) days before the end of the term, the Agreement is renewed for the same term on the same terms.'),
        standard: L('По окончании срока Договор может быть продлён по соглашению Сторон. Наниматель, надлежащим образом исполнявший свои обязанности, имеет преимущественное право на заключение договора на новый срок.',
          'At the end of the term the Agreement may be renewed by agreement of the Parties. A Tenant who has duly performed the Agreement has a preferential right to a new lease.'),
        strict: L('Продление Договора возможно только по письменному соглашению Сторон, подписанному не позднее чем за 30 (тридцать) дней до окончания срока. Пользование Квартирой после окончания срока без такого соглашения не допускается.',
          'The Agreement may be renewed only by a written agreement of the Parties signed no later than 30 (thirty) days before the end of the term. The Flat may not be used after the term without such an agreement.') } },
    ] },
    { id: 'payment', title: L('Плата и расчёты', 'Rent and payments'), clauses: [
      { id: 'rentCl', text: L('Плата за наём Квартиры составляет {{rent}} в месяц.', 'The rent for the Flat is {{rent}} a month.') },
      { id: 'periods', text: L(
        'Расчётный период — один месяц. Каждый расчётный период начинается в число месяца, в которое начинается найм, и заканчивается днём, предшествующим этому числу следующего месяца; последний расчётный период заканчивается {{term.last}}. Расчётные периоды и суммы приведены в графике платежей (Приложение № {{#scheduleApp}}): {{schedule.count}} {{schedule.count|plural:\'платёж\',\'платежа\',\'платежей\'}} на общую сумму {{schedule.total}}.',
        'The billing period is one month. Each period starts on the day of the month on which the lease started and ends on the day before that day of the next month; the last period ends on {{term.last}}. The periods and amounts are listed in the payment schedule (Appendix {{#scheduleApp}}): {{schedule.count}} {{schedule.count|plural:\'payment\',\'payments\'}}, {{schedule.total}} in total.') },
      { id: 'prorataCl', when: 'schedule.partialCount > 0', text: L(
        '[[if schedule.settings.prorata]]Плата за неполный расчётный период рассчитывается пропорционально количеству дней в нём.[[else]]Плата за неполный расчётный период вносится в полном размере.[[end]]',
        '[[if schedule.settings.prorata]]The rent for a part period is pro rata to its days.[[else]]The rent for a part period is paid in full.[[end]]') },
      { id: 'due', text: L(
        'Плата вносится авансом [[if schedule.settings.dueOffset < 0]]не позднее чем за {{-schedule.settings.dueOffset}} ({{-schedule.settings.dueOffset|words}}) {{-schedule.settings.dueOffset|plural:\'день\',\'дня\',\'дней\'}} до начала[[elif schedule.settings.dueOffset > 0]]в течение {{schedule.settings.dueOffset}} ({{schedule.settings.dueOffset|words:\'f\'}}) {{schedule.settings.dueOffset|plural:\'дня\',\'дней\',\'дней\'}} с начала[[else]]не позднее первого дня[[end]] каждого расчётного периода [[if payMethod == \'cash\']]наличными денежными средствами под расписку Наймодателя[[else]]переводом по реквизитам: {{bankDetails}}[[end]]. Плата за первый расчётный период вносится при подписании Договора.',
        'The rent is paid in advance [[if schedule.settings.dueOffset < 0]]no later than {{-schedule.settings.dueOffset}} ({{-schedule.settings.dueOffset|words}}) {{-schedule.settings.dueOffset|plural:\'day\',\'days\'}} before the start[[elif schedule.settings.dueOffset > 0]]within {{schedule.settings.dueOffset}} ({{schedule.settings.dueOffset|words}}) {{schedule.settings.dueOffset|plural:\'day\',\'days\'}} of the start[[else]]no later than the first day[[end]] of each billing period [[if payMethod == \'cash\']]in cash against the Landlord\'s receipt[[else]]by transfer to: {{bankDetails}}[[end]]. The rent for the first period is paid on signing.') },
      { id: 'depositCl', by: 'strictness', text: L('', ''), variants: {
        soft: L('При подписании Договора Наниматель вносит обеспечительный платёж {{deposit}}. Он возвращается Нанимателю в день возврата Квартиры за вычетом документально подтверждённого ущерба и может быть зачтён в плату за последний расчётный период.',
          'On signing the Tenant pays a deposit of {{deposit}}. It is returned on the day the Flat is returned, less documented damage, and may be set off against the rent of the last period.'),
        standard: L('При подписании Договора Наниматель вносит обеспечительный платёж {{deposit}}. Он возвращается в течение 3 (трёх) дней после возврата Квартиры по акту за вычетом задолженности по оплате и стоимости устранения повреждений сверх нормального износа.',
          'On signing the Tenant pays a deposit of {{deposit}}. It is returned within 3 (three) days after the Flat is returned under the act, less unpaid amounts and the cost of repairing damage beyond normal wear.'),
        strict: L('При подписании Договора Наниматель вносит обеспечительный платёж {{deposit}}. Он не засчитывается в плату за наём и возвращается в течение 10 (десяти) дней после возврата Квартиры по акту за вычетом задолженности, ущерба и неустоек. При выезде до окончания срока без уведомления за {{noticeDays}} ({{noticeDays|words}}) {{noticeDays|plural:\'день\',\'дня\',\'дней\'}} обеспечительный платёж не возвращается.',
          'On signing the Tenant pays a deposit of {{deposit}}. It is not set off against the rent and is returned within 10 (ten) days after the Flat is returned under the act, less unpaid amounts, damage and penalties. If the Tenant leaves before the end of the term without {{noticeDays}} ({{noticeDays|words}}) days\' notice, the deposit is not returned.') } },
      { id: 'utilitiesCl', text: L(
        '[[if utilities == \'included\']]Плата за коммунальные услуги включена в плату за наём; услуги связи и интернета Наниматель оплачивает сам.[[else]]Наниматель дополнительно оплачивает коммунальные услуги по показаниям приборов учёта (электроэнергия, холодная и горячая вода, водоотведение, газ) и услуги связи. Плату за содержание жилого помещения и взносы на капитальный ремонт вносит Наймодатель.[[end]]',
        '[[if utilities == \'included\']]Utilities are included in the rent; the Tenant pays for telephone and internet.[[else]]The Tenant also pays for the utilities by the meters (electricity, cold and hot water, sewerage, gas) and for telephone and internet. The Landlord pays the maintenance charges and the capital repair contributions.[[end]]') },
      { id: 'servicesCl', when: 'extraServices', text: L(
        'Наймодатель оказывает Нанимателю дополнительные услуги, перечисленные в Приложении № {{#servicesApp}}, общей стоимостью {{servicesTotal}} в месяц; стоимость услуг вносится вместе с платой за наём.',
        'The Landlord provides the additional services listed in Appendix {{#servicesApp}}, {{servicesTotal}} a month in total, paid together with the rent.') },
      { id: 'lateFee', by: 'strictness', text: L('', ''), variants: {
        soft: L('При просрочке платы более чем на 5 (пять) дней Наниматель уплачивает неустойку {{lateFeePct|num}} % от неоплаченной суммы за каждый день просрочки, начиная с шестого.',
          'If a payment is more than 5 (five) days late, the Tenant pays a penalty of {{lateFeePct|num}} % of the unpaid amount for each day from the sixth.'),
        standard: L('За просрочку платы Наниматель уплачивает неустойку {{lateFeePct|num}} % от неоплаченной суммы за каждый день просрочки.',
          'For a late payment the Tenant pays a penalty of {{lateFeePct|num}} % of the unpaid amount for each day of delay.'),
        strict: L('За просрочку платы Наниматель уплачивает неустойку {{lateFeePct|num}} % от неоплаченной суммы за каждый день просрочки. Просрочка более 10 (десяти) дней даёт Наймодателю право отказаться от Договора в одностороннем порядке.',
          'For a late payment the Tenant pays a penalty of {{lateFeePct|num}} % of the unpaid amount for each day of delay. A delay of more than 10 (ten) days entitles the Landlord to withdraw from the Agreement unilaterally.') } },
    ] },
    { id: 'landlordDuties', title: L('Обязанности Наймодателя', 'Obligations of the Landlord'), clauses: [
      { id: 'ld1', text: L('Передать Нанимателю Квартиру в состоянии, пригодном для проживания, свободной от проживания третьих лиц, в день начала найма.', 'To hand over the Flat fit for living and free of other occupants on the first day of the lease.') },
      { id: 'ld2', text: L('Обеспечивать предоставление коммунальных услуг и производить капитальный ремонт Квартиры и её оборудования.', 'To ensure the supply of utilities and carry out major repairs of the Flat and its equipment.') },
      { id: 'ld3', by: 'strictness', text: L('', ''), variants: {
        soft: L('Посещать Квартиру только по согласованию с Нанимателем и в его присутствии, предупредив не менее чем за 48 (сорок восемь) часов, кроме аварийных ситуаций.', 'To visit the Flat only by arrangement and in the Tenant\'s presence, with at least 48 (forty-eight) hours\' notice, except emergencies.'),
        standard: L('Посещать Квартиру для проверки её состояния не чаще одного раза в месяц, предупредив Нанимателя не менее чем за 24 (двадцать четыре) часа, кроме аварийных ситуаций.', 'To inspect the Flat no more than once a month with at least 24 (twenty-four) hours\' notice, except emergencies.'),
        strict: L('Посещать Квартиру для проверки её состояния, предупредив Нанимателя не менее чем за 12 (двенадцать) часов; в аварийных ситуациях — без предупреждения.', 'To inspect the Flat with at least 12 (twelve) hours\' notice; in emergencies without notice.') } },
      { id: 'ld4', text: L('Не позднее чем за {{noticeDays}} ({{noticeDays|words}}) {{noticeDays|plural:\'день\',\'дня\',\'дней\'}} письменно уведомлять Нанимателя о намерении расторгнуть Договор или продать Квартиру.', 'To give the Tenant written notice of {{noticeDays}} ({{noticeDays|words}}) days of an intention to terminate the Agreement or to sell the Flat.') },
    ] },
    { id: 'tenantDuties', title: L('Обязанности Нанимателя', 'Obligations of the Tenant'), clauses: [
      { id: 'td1', text: L('Использовать Квартиру только для проживания, соблюдать правила пользования жилыми помещениями, санитарные и противопожарные нормы, права и законные интересы соседей.', 'To use the Flat only as a dwelling and to keep the rules of use of dwellings, sanitary and fire rules and the rights of the neighbours.') },
      { id: 'td2', text: L('Своевременно вносить плату за наём и коммунальные услуги.', 'To pay the rent and the utilities on time.') },
      { id: 'td3', text: L('Бережно относиться к Квартире и имуществу, не производить переустройство и перепланировку; немедленно сообщать Наймодателю о неисправностях и авариях.', 'To take good care of the Flat and its contents, make no alterations, and report faults and accidents to the Landlord at once.') },
      { id: 'td4', text: L('Возместить ущерб, причинённый Квартире и имуществу по вине Нанимателя и проживающих с ним лиц.', 'To compensate damage to the Flat and its contents caused by the Tenant or the persons living with the Tenant.') },
      { id: 'td5', text: L('По окончании найма вернуть Квартиру[[if act]] по акту[[end]] в том состоянии, в котором она была получена, с учётом нормального износа, вместе со всеми комплектами ключей.', 'At the end of the lease to return the Flat[[if act]] under an act[[end]] in the condition in which it was received, fair wear excepted, with every set of keys.') },
    ] },
    { id: 'special', title: L('Особые условия', 'Special terms'), when: 'nuances', clauses: [
      { id: 'petsCl', text: L(
        '[[if pets]]Нанимателю разрешается содержать в Квартире домашних животных: {{petsDesc}}. Наниматель возмещает ущерб, причинённый животными, и оплачивает профессиональную уборку при выезде.[[else]]Содержание в Квартире домашних животных не допускается.[[end]]',
        '[[if pets]]The Tenant may keep pets in the Flat: {{petsDesc}}. The Tenant compensates damage caused by the pets and pays for professional cleaning on leaving.[[else]]No pets may be kept in the Flat.[[end]]') },
      { id: 'smokingCl', text: L(
        '[[if smoking]]Курение допускается только на балконе (лоджии) при закрытых дверях в Квартиру.[[else]]Курение в Квартире, на балконе и в местах общего пользования запрещено; при нарушении Наниматель оплачивает химчистку мебели и текстиля.[[end]]',
        '[[if smoking]]Smoking is allowed only on the balcony with the doors to the Flat closed.[[else]]No smoking in the Flat, on the balcony or in the common areas; for a breach the Tenant pays for cleaning the furniture and textiles.[[end]]') },
      { id: 'subletCl', text: L(
        '[[if sublet]]Наниматель вправе передавать Квартиру в поднаём только с предварительного письменного согласия Наймодателя.[[else]]Поднаём Квартиры, а также передача её во временное пользование третьим лицам (в том числе посуточно) не допускаются.[[end]]',
        '[[if sublet]]The Tenant may sublet the Flat only with the Landlord\'s prior written consent.[[else]]The Flat may not be sublet or given for temporary use to anyone else (short lets included).[[end]]') },
      { id: 'earlyCl', text: L(
        '[[if earlyTermination]]Наниматель вправе досрочно отказаться от Договора, письменно предупредив Наймодателя не позднее чем за {{noticeDays}} ({{noticeDays|words}}) {{noticeDays|plural:\'день\',\'дня\',\'дней\'}}; при соблюдении этого срока штрафы не применяются, а плата за неиспользованные дни оплаченного периода возвращается.[[else]]При досрочном отказе от Договора по инициативе Нанимателя он уплачивает Наймодателю штраф {{earlyFee}}.[[end]]',
        '[[if earlyTermination]]The Tenant may end the Agreement early by giving the Landlord {{noticeDays}} ({{noticeDays|words}}) days\' written notice; no fine applies then, and the rent for the unused days of a paid period is refunded.[[else]]If the Tenant ends the Agreement early, the Tenant pays the Landlord a fine of {{earlyFee}}.[[end]]') },
      { id: 'repairsCl', when: 'repairs', text: L('Наниматель вправе за свой счёт производить косметический ремонт по письменному согласованию с Наймодателем; стоимость ремонта не возмещается и в счёт платы не засчитывается.', 'The Tenant may redecorate at the Tenant\'s own cost with the Landlord\'s written approval; the cost is not refunded or set off against the rent.') },
      { id: 'poaCl', when: 'poa', text: L('Документ, подтверждающий полномочия представителя Наймодателя, предъявлен Нанимателю при подписании Договора; его копия передана Нанимателю. Плата, внесённая представителю, считается внесённой Наймодателю.', 'The document of authority of the Landlord\'s representative was shown to the Tenant on signing and a copy was given to the Tenant. Payments made to the representative count as made to the Landlord.') },
      { id: 'otherCl', when: 'otherTerms', text: L('{{otherTerms}}', '{{otherTerms}}') },
    ] },
    { id: 'termination', title: L('Изменение и расторжение', 'Amendment and termination'), clauses: [
      { id: 'tm1', text: L('Договор может быть изменён или расторгнут по соглашению Сторон, оформленному письменно.', 'The Agreement may be amended or terminated by a written agreement of the Parties.') },
      { id: 'tm2', by: 'strictness', text: L('', ''), variants: {
        soft: L('Договор может быть расторгнут по требованию любой из Сторон в случаях, предусмотренных Гражданским кодексом Российской Федерации.', 'Either Party may demand termination in the cases provided by the Civil Code of the Russian Federation.'),
        standard: L('Наймодатель вправе потребовать расторжения Договора в случаях, предусмотренных законом, а также при нарушении Нанимателем срока внесения платы более двух раз подряд.', 'The Landlord may demand termination in the cases provided by law and if the Tenant pays late more than twice in a row.'),
        strict: L('Наймодатель вправе отказаться от Договора в одностороннем порядке, уведомив Нанимателя за 10 (десять) дней, при однократной просрочке платы более чем на 10 (десять) дней, при порче имущества[[if nuances]] или нарушении особых условий (раздел {{#special}})[[end]].', 'The Landlord may withdraw from the Agreement with 10 (ten) days\' notice if a payment is more than 10 (ten) days late, if property is damaged[[if nuances]] or if the special terms (section {{#special}}) are breached[[end]].') } },
      { id: 'tm3', text: L('При расторжении Договора Наниматель освобождает Квартиру в срок, указанный в уведомлении или соглашении, и возвращает её[[if act]] по акту[[end]].', 'On termination the Tenant vacates the Flat by the date stated in the notice or the agreement and returns it[[if act]] under an act[[end]].') },
    ] },
    { id: 'final', title: L('Заключительные положения', 'Final provisions'), clauses: [
      { id: 'f1', text: L('Споры разрешаются путём переговоров, а при недостижении согласия — в суде по месту нахождения Квартиры. Во всём, что не предусмотрено Договором, Стороны руководствуются законодательством Российской Федерации.', 'Disputes are settled by negotiation and, failing agreement, by the court at the location of the Flat. Matters not covered by the Agreement are governed by the law of the Russian Federation.') },
      { id: 'f2', text: L('Договор составлен в двух экземплярах, имеющих равную юридическую силу, по одному для каждой из Сторон.', 'The Agreement is made in two counterparts of equal force, one for each Party.') },
      { id: 'f3', text: L(
        'Неотъемлемые части Договора: Приложение № {{#scheduleApp}} — график платежей[[if extraServices]]; Приложение № {{#servicesApp}} — дополнительные услуги[[end]][[if act]]; Приложение № {{#actApp}} — акт приёма-передачи[[end]].',
        'Integral parts of the Agreement: Appendix {{#scheduleApp}}, the payment schedule[[if extraServices]]; Appendix {{#servicesApp}}, additional services[[end]][[if act]]; Appendix {{#actApp}}, the act of acceptance[[end]].') },
    ] },
    { id: 'signs', kind: 'signatures', title: L('Реквизиты и подписи Сторон', 'Details and signatures of the Parties'), clauses: [
      { id: 'sigLandlord', text: L(
        '**Наймодатель**\n{{landlord|details}}[[if poa]]\nПредставитель: {{agent.name}}\nна основании {{agentDoc}}[[end]]\n\n____________________ / [[if poa]]{{agent|initials}}[[else]]{{landlord|initials}}[[end]] /',
        '**Landlord**\n{{landlord|details}}[[if poa]]\nRepresentative: {{agent.name}}\nunder {{agentDoc}}[[end]]\n\n____________________ / [[if poa]]{{agent|initials}}[[else]]{{landlord|initials}}[[end]] /') },
      { id: 'sigTenant', text: L('**Наниматель**\n{{tenant|details}}\n\n____________________ / {{tenant|initials}} /', '**Tenant**\n{{tenant|details}}\n\n____________________ / {{tenant|initials}} /') },
    ] },
    { id: 'scheduleApp', kind: 'appendix', title: L('Приложение № {{#}}\nк договору найма № {{number}} от {{signDate|date:\'short\'}}\n\n**ГРАФИК ПЛАТЕЖЕЙ**', 'Appendix {{#}}\nto the lease No. {{number}} of {{signDate|date:\'short\'}}\n\n**PAYMENT SCHEDULE**'), clauses: [
      { id: 'schTable', text: L('{{schedule}}', '{{schedule}}') },
      { id: 'schNote', text: L(
        'Расчётные периоды: с числа начала найма по день, предшествующий этому числу следующего месяца; последний период — по {{term.last}}, за день до даты выезда {{term.end}}. Итого за срок найма: {{schedule.total|moneyWords}}.[[if schedule.partialCount]] Неполные периоды отмечены.[[end]]',
        'Billing periods run from the start day to the day before it in the next month; the last one ends on {{term.last}}, the day before the move-out date {{term.end}}. Total for the term: {{schedule.total|moneyWords}}.[[if schedule.partialCount]] Part periods are marked.[[end]]') },
    ] },
    { id: 'servicesApp', kind: 'appendix', when: 'extraServices', title: L('Приложение № {{#}}\nк договору найма № {{number}} от {{signDate|date:\'short\'}}\n\n**ДОПОЛНИТЕЛЬНЫЕ УСЛУГИ**', 'Appendix {{#}}\nto the lease No. {{number}} of {{signDate|date:\'short\'}}\n\n**ADDITIONAL SERVICES**'), clauses: [
      { id: 'srvTable', text: L('{{services}}', '{{services}}') },
      { id: 'srvNote', text: L('Итого в месяц: {{servicesTotal}}. Услуги оказываются в течение всего срока найма; отказ от отдельной услуги оформляется письменно не позднее чем за 10 (десять) дней до начала расчётного периода.', 'Total a month: {{servicesTotal}}. The services are provided for the whole term; a service may be cancelled in writing no later than 10 (ten) days before a billing period starts.') },
    ] },
    { id: 'actApp', kind: 'appendix', when: 'act', title: L('Приложение № {{#}}\nк договору найма № {{number}} от {{signDate|date:\'short\'}}\n\n**АКТ ПРИЁМА-ПЕРЕДАЧИ КВАРТИРЫ**', 'Appendix {{#}}\nto the lease No. {{number}} of {{signDate|date:\'short\'}}\n\n**ACT OF ACCEPTANCE OF THE FLAT**'), clauses: [
      { id: 'actPlace', text: L('г. {{city}}\t{{term.start}}', '{{city}}\t{{term.start}}') },
      { id: 'act1', text: L('Наймодатель[[if poa]] в лице представителя {{agent.name}}[[end]] передал, а Наниматель {{tenant.name}} принял Квартиру по адресу: {{address}}.', 'The Landlord[[if poa]], represented by {{agent.name}},[[end]] has handed over and the Tenant {{tenant.name}} has accepted the Flat at: {{address}}.') },
      { id: 'act2', text: L('Состояние Квартиры: {{condition|default:\'пригодна для проживания, видимых повреждений нет\'}}. Переданы ключи: {{keys}} {{keys|plural:\'комплект\',\'комплекта\',\'комплектов\'}}.', 'Condition of the Flat: {{condition|default:\'fit for living, no visible damage\'}}. Keys handed over: {{keys}} {{keys|plural:\'set\',\'sets\'}}.') },
      { id: 'act3', when: 'inventory', text: L('Опись имущества:\n{{inventory}}', 'Inventory:\n{{inventory}}') },
      { id: 'act4', when: 'meters', text: L('Показания приборов учёта на дату передачи:\n{{meters}}', 'Meter readings on the day of handover:\n{{meters}}') },
      { id: 'act5', text: L('Стороны претензий друг к другу не имеют.\n\nПередал: ____________________ / [[if poa]]{{agent|initials}}[[else]]{{landlord|initials}}[[end]] /\tПринял: ____________________ / {{tenant|initials}} /', 'The Parties have no claims against each other.\n\nHanded over: ____________________ / [[if poa]]{{agent|initials}}[[else]]{{landlord|initials}}[[end]] /\tAccepted: ____________________ / {{tenant|initials}} /') },
    ] },
  ],
  validator: VALIDATOR,
  sample: {
    modifiers: { poa: true, extraServices: false, nuances: true, act: true },
    levels: { strictness: 'standard' },
    values: {
      number: '23/01-2027', city: 'Москва', signDate: '2027-01-20',
      landlord: { kind: 'person', name: 'Соколова Анна Викторовна', gender: 'f', birthDate: '1979-04-14', passport: '45 08 731942', passportIssuer: 'ОВД района Хамовники г. Москвы', passportDate: '2008-06-02', passportCode: '772-015', address: 'г. Москва, ул. Остоженка, д. 12, кв. 7', phone: '+7 916 555-12-30' },
      tenant: { kind: 'person', name: 'Морозов Илья Андреевич', gender: 'm', birthDate: '1994-09-30', passport: '46 15 204871', passportIssuer: 'ТП УФМС России по Московской обл. в г. Химки', passportDate: '2015-10-12', passportCode: '500-112', address: 'Московская обл., г. Химки, ул. Победы, д. 3, кв. 41', phone: '+7 903 222-81-17' },
      agent: { kind: 'person', name: 'Лебедев Олег Сергеевич', gender: 'm', birthDate: '1986-02-11', passport: '45 11 552010', passportIssuer: 'Отделом УФМС России по г. Москве по району Арбат', passportDate: '2011-03-15', address: 'г. Москва, Смоленский б-р, д. 4, кв. 18', phone: '+7 926 410-00-55' },
      agentDoc: { kind: 'notarial', number: '77 АГ 1234567', date: '2026-12-01', issuer: 'нотариусом г. Москвы Петровой Е. А., зарегистрировано в реестре № 77/45-н/77-2026-3-1180', until: '2027-12-31' },
      address: 'г. Москва, Комсомольский проспект, д. 28, кв. 112', cadastral: '77:01:0005008:3176', rooms: 2, area: 54.3, floor: 7,
      ownershipDoc: { kind: 'egrn', number: 'КУВИ-001/2026-118842', date: '2026-12-10' },
      occupants: [{ name: 'Морозова Дарья Павловна', birthDate: '1996-05-21', relation: 'супруга' }],
      term: { start: '2027-01-23', months: 11 }, rent: 65000, schedule: { prorata: true, anchorDay: null, dueOffset: 0 },
      payMethod: 'transfer', bankDetails: 'получатель Соколова Анна Викторовна, счёт 40817810099910004312 в ПАО «Сбербанк», БИК 044525225',
      utilities: 'meters',
      services: [{ name: 'Уборка квартиры', terms: '2 раза в месяц', price: 6000 }, { name: 'Интернет и ТВ', terms: 'ежемесячно', price: 900 }, { name: 'Место на подземной парковке', terms: 'ежемесячно', price: 7500 }],
      pets: true, petsDesc: 'кошка', smoking: false, sublet: false, earlyTermination: true, earlyFee: 30000, repairs: false,
      condition: 'Квартира в хорошем состоянии, сантехника и электрика исправны.', keys: 2,
      inventory: [{ name: 'Диван-кровать', qty: 1, state: 'хорошее' }, { name: 'Холодильник Bosch', qty: 1, state: 'исправен' }, { name: 'Стиральная машина LG', qty: 1, state: 'исправна' }, { name: 'Шкаф-купе', qty: 2, state: 'хорошее' }],
      meters: [{ name: 'Электроэнергия (Т1/Т2)', serial: '0981123', reading: 15234 }, { name: 'Холодная вода', serial: 'ХВ-55102', reading: 412 }, { name: 'Горячая вода', serial: 'ГВ-55103', reading: 268 }],
    },
  },
};
