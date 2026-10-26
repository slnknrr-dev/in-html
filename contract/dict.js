// contract/dict.js - the words a contract and its fill-in form need in the contract language: the phrases that write
// parties and documents ("паспорт …, выдан …"), the payment schedule table, appendix titles, the labels of the field
// controls (contract/form.js), validation messages and the interface of compiled pages. Seven languages (en, ru, uk,
// de, fr, es, ka) with the same keys; any other contract language falls back to English for these words (the clause
// texts themselves are the template's).
//
//   DICTS { lang: { key: text } }    tr(lang, key, vars?) -> text ({name} interpolation)    dictFor(langs) -> subset
//   Keys with .m / .f variants agree with the gender of a person ('p.reg.m', 'p.reg.f').

// Structure: one flat object per language, keys namespaced by prefix: sch.* schedule table, list.* list tables,
// p.* person/organisation phrases, d.* document phrases, pp.* party picker, v.* validation messages, pg.* compiled
// page UI. Flat string keys rather than nested objects: a lookup is one hasOwnProperty test, and the dictionaries can
// be subset per language (dictFor) and serialized into a compiled page as-is.
// Placeholders: {d} by convention an already formatted date, {v} a raw value, {n} a number.
// Why a contract carries its own words instead of the app i18n: the contract language is chosen per document (a
// bilingual contract has two at once), independent of the editor's interface language.
const en = {
  'sch.n': 'No.', 'sch.period': 'Period', 'sch.days': 'Days', 'sch.due': 'Due by', 'sch.amount': 'Amount', 'sch.total': 'Total', 'sch.partial': 'part period',
  'list.n': 'No.', 'list.total': 'Total', 'period': 'from {a} to {b}', 'appendix': 'Appendix {n}', 'yes': 'yes', 'no': 'no', 'fallback': 'not translated: shown in {lang}',
  'p.born': 'born {d}', 'p.bornAt': 'born {d} in {v}', 'p.passport': 'passport {v}', 'p.issued': 'issued by {v}', 'p.issuedOn': 'on {d}', 'p.code': 'division code {v}',
  'p.reg.m': 'registered at {v}', 'p.reg.f': 'registered at {v}', 'p.inn': 'TIN {v}', 'p.ogrn': 'PSRN {v}', 'p.kpp': 'KPP {v}', 'p.orgAddr': 'registered office: {v}',
  'p.rep': 'represented by {title} {v}', 'p.basis': 'acting under {v}', 'p.phone': 'tel. {v}', 'p.email': 'e-mail {v}', 'p.bank': 'bank {v}', 'p.account': 'account {v}', 'p.bik': 'BIC {v}',
  'd.number': 'No. {v}', 'd.date': 'dated {d}', 'd.until': 'valid until {d}',
  'pp.kind': 'Party', 'pp.person': 'Person', 'pp.org': 'Organisation', 'pp.name': 'Full name', 'pp.orgName': 'Name of the organisation', 'pp.gender': 'Gender', 'pp.m': 'male', 'pp.f': 'female',
  'pp.birthDate': 'Date of birth', 'pp.birthPlace': 'Place of birth', 'pp.passport': 'Passport (series and number)', 'pp.passportIssuer': 'Issued by', 'pp.passportDate': 'Date of issue',
  'pp.passportCode': 'Division code', 'pp.address': 'Registered address', 'pp.inn': 'TIN', 'pp.phone': 'Phone', 'pp.email': 'E-mail', 'pp.ogrn': 'PSRN', 'pp.kpp': 'KPP',
  'pp.rep': 'Represented by (name)', 'pp.repTitle': 'Position', 'pp.repBasis': 'Acting under', 'pp.bank': 'Bank', 'pp.account': 'Account', 'pp.bik': 'BIC',
  'dp.kind': 'Document', 'dp.number': 'Number', 'dp.date': 'Date', 'dp.issuer': 'Issued / certified by', 'dp.until': 'Valid until',
  'pe.start': 'Start', 'pe.months': 'Months', 'pe.end': 'Move-out date', 'pe.byMonths': 'by months', 'pe.byEnd': 'by date', 'pe.summary': '{a} – {b}, move-out {c}',
  'sc.anchor': 'Periods start on day', 'sc.anchorAuto': 'as the start', 'sc.prorata': 'Partial periods by days', 'sc.due': 'Payment, days from the period start', 'sc.summary': '{n} payments, total {total}',
  'li.add': 'Add', 'li.remove': 'Remove', 'li.up': 'Up', 'li.down': 'Down', 'li.empty': 'No items yet',
  'v.required': 'Required', 'v.min': 'At least {n}', 'v.max': 'At most {n}', 'v.mask': 'Wrong format (e.g. {ex})', 'v.pattern': 'Does not match the expected format', 'v.date': 'Not a valid date',
  'v.after': 'Must be later than “{f}”', 'v.dateMin': 'Not earlier than {d}', 'v.dateMax': 'Not later than {d}', 'v.term': 'Give the start and the term', 'v.order': 'The end is before the start',
  'v.minItems': 'At least {n} items', 'v.maxItems': 'At most {n} items', 'v.item': 'Row {n}: fill in “{f}”', 'v.checksum': 'The check digits do not match', 'v.expr': 'Expression error: {m}',
  'v.cycle': 'Computed fields depend on each other', 'v.user': 'JS validator: {m}', 'v.timeout': 'The JS validator did not finish in {n} ms', 'v.syntax': 'Template text error: {m}', 'v.select': 'Choose a value from the list',
  'pg.print': 'Print', 'pg.reset': 'Clear', 'pg.export': 'Save data', 'pg.import': 'Load data', 'pg.lang': 'Language', 'pg.form': 'Form', 'pg.doc': 'Document', 'pg.issues': 'Checks',
  'pg.ok': 'No problems found', 'pg.saved': 'Kept in this browser', 'pg.resetQ': 'Clear every field?', 'pg.hint': 'Fill in the fields: the text of the document follows at once.',
  'pg.made': 'Made with Agreement Constructor: one file, works offline, nothing is sent anywhere.', 'pg.badFile': 'This is not a data file of this template', 'pg.options': 'Options', 'pg.side': 'Side by side',
};

const ru = {
  'sch.n': '№', 'sch.period': 'Период', 'sch.days': 'Дней', 'sch.due': 'Оплата не позднее', 'sch.amount': 'Сумма', 'sch.total': 'Итого', 'sch.partial': 'неполный период',
  'list.n': '№', 'list.total': 'Итого', 'period': 'с {a} по {b}', 'appendix': 'Приложение № {n}', 'yes': 'да', 'no': 'нет', 'fallback': 'нет перевода: показан текст на языке {lang}',
  'p.born': '{d} рождения', 'p.bornAt': '{d} рождения, место рождения: {v}', 'p.passport': 'паспорт {v}', 'p.issued': 'выдан {v}', 'p.issuedOn': '{d}', 'p.code': 'код подразделения {v}',
  'p.reg.m': 'зарегистрированный по адресу: {v}', 'p.reg.f': 'зарегистрированная по адресу: {v}', 'p.inn': 'ИНН {v}', 'p.ogrn': 'ОГРН {v}', 'p.kpp': 'КПП {v}', 'p.orgAddr': 'место нахождения: {v}',
  'p.rep': 'в лице {title} {v}', 'p.basis': 'действующего на основании {v}', 'p.phone': 'тел. {v}', 'p.email': 'эл. почта {v}', 'p.bank': 'банк {v}', 'p.account': 'р/с {v}', 'p.bik': 'БИК {v}',
  'd.number': '№ {v}', 'd.date': 'от {d}', 'd.until': 'сроком до {d}',
  'pp.kind': 'Сторона', 'pp.person': 'Физическое лицо', 'pp.org': 'Организация', 'pp.name': 'ФИО', 'pp.orgName': 'Наименование организации', 'pp.gender': 'Пол', 'pp.m': 'мужской', 'pp.f': 'женский',
  'pp.birthDate': 'Дата рождения', 'pp.birthPlace': 'Место рождения', 'pp.passport': 'Паспорт (серия и номер)', 'pp.passportIssuer': 'Кем выдан', 'pp.passportDate': 'Дата выдачи',
  'pp.passportCode': 'Код подразделения', 'pp.address': 'Адрес регистрации', 'pp.inn': 'ИНН', 'pp.phone': 'Телефон', 'pp.email': 'Эл. почта', 'pp.ogrn': 'ОГРН', 'pp.kpp': 'КПП',
  'pp.rep': 'В лице (должность и ФИО в род. падеже)', 'pp.repTitle': 'Должность (род. падеж)', 'pp.repBasis': 'На основании (род. падеж)', 'pp.bank': 'Банк', 'pp.account': 'Расчётный счёт', 'pp.bik': 'БИК',
  'dp.kind': 'Документ', 'dp.number': 'Номер', 'dp.date': 'Дата', 'dp.issuer': 'Кем выдан / удостоверен', 'dp.until': 'Действует до',
  'pe.start': 'Начало', 'pe.months': 'Месяцев', 'pe.end': 'Дата выезда', 'pe.byMonths': 'в месяцах', 'pe.byEnd': 'до даты', 'pe.summary': '{a} – {b}, выезд {c}',
  'sc.anchor': 'Периоды начинаются с числа', 'sc.anchorAuto': 'как начало', 'sc.prorata': 'Неполные периоды — по дням', 'sc.due': 'Оплата, дней от начала периода', 'sc.summary': '{n} платежей, итого {total}',
  'li.add': 'Добавить', 'li.remove': 'Удалить', 'li.up': 'Выше', 'li.down': 'Ниже', 'li.empty': 'Пока пусто',
  'v.required': 'Обязательное поле', 'v.min': 'Не меньше {n}', 'v.max': 'Не больше {n}', 'v.mask': 'Неверный формат (например, {ex})', 'v.pattern': 'Не соответствует формату', 'v.date': 'Неверная дата',
  'v.after': 'Должно быть позже, чем «{f}»', 'v.dateMin': 'Не раньше {d}', 'v.dateMax': 'Не позже {d}', 'v.term': 'Укажите начало и срок', 'v.order': 'Окончание раньше начала',
  'v.minItems': 'Не меньше {n} строк', 'v.maxItems': 'Не больше {n} строк', 'v.item': 'Строка {n}: заполните «{f}»', 'v.checksum': 'Не сходится контрольное число', 'v.expr': 'Ошибка в выражении: {m}',
  'v.cycle': 'Вычисляемые поля ссылаются друг на друга', 'v.user': 'JS-проверка: {m}', 'v.timeout': 'JS-проверка не уложилась в {n} мс', 'v.syntax': 'Ошибка в тексте шаблона: {m}', 'v.select': 'Выберите значение из списка',
  'pg.print': 'Печать', 'pg.reset': 'Очистить', 'pg.export': 'Сохранить данные', 'pg.import': 'Загрузить данные', 'pg.lang': 'Язык', 'pg.form': 'Анкета', 'pg.doc': 'Документ', 'pg.issues': 'Проверка',
  'pg.ok': 'Замечаний нет', 'pg.saved': 'Сохраняется в этом браузере', 'pg.resetQ': 'Очистить все поля?', 'pg.hint': 'Заполните поля — текст документа меняется сразу.',
  'pg.made': 'Сделано в Конструкторе договоров: один файл, работает без сети, ничего никуда не отправляет.', 'pg.badFile': 'Это не файл данных этого шаблона', 'pg.options': 'Условия', 'pg.side': 'Рядом',
};

const uk = {
  'sch.n': '№', 'sch.period': 'Період', 'sch.days': 'Днів', 'sch.due': 'Оплата не пізніше', 'sch.amount': 'Сума', 'sch.total': 'Разом', 'sch.partial': 'неповний період',
  'list.n': '№', 'list.total': 'Разом', 'period': 'з {a} по {b}', 'appendix': 'Додаток № {n}', 'yes': 'так', 'no': 'ні', 'fallback': 'немає перекладу: показано текст мовою {lang}',
  'p.born': '{d} народження', 'p.bornAt': '{d} народження, місце народження: {v}', 'p.passport': 'паспорт {v}', 'p.issued': 'виданий {v}', 'p.issuedOn': '{d}', 'p.code': 'код підрозділу {v}',
  'p.reg.m': 'зареєстрований за адресою: {v}', 'p.reg.f': 'зареєстрована за адресою: {v}', 'p.inn': 'РНОКПП {v}', 'p.ogrn': 'ЄДРПОУ {v}', 'p.kpp': 'КПП {v}', 'p.orgAddr': 'місцезнаходження: {v}',
  'p.rep': 'в особі {title} {v}', 'p.basis': 'що діє на підставі {v}', 'p.phone': 'тел. {v}', 'p.email': 'ел. пошта {v}', 'p.bank': 'банк {v}', 'p.account': 'р/р {v}', 'p.bik': 'МФО {v}',
  'd.number': '№ {v}', 'd.date': 'від {d}', 'd.until': 'строком до {d}',
  'pp.kind': 'Сторона', 'pp.person': 'Фізична особа', 'pp.org': 'Організація', 'pp.name': 'ПІБ', 'pp.orgName': 'Найменування організації', 'pp.gender': 'Стать', 'pp.m': 'чоловіча', 'pp.f': 'жіноча',
  'pp.birthDate': 'Дата народження', 'pp.birthPlace': 'Місце народження', 'pp.passport': 'Паспорт (серія і номер)', 'pp.passportIssuer': 'Ким виданий', 'pp.passportDate': 'Дата видачі',
  'pp.passportCode': 'Код підрозділу', 'pp.address': 'Адреса реєстрації', 'pp.inn': 'РНОКПП', 'pp.phone': 'Телефон', 'pp.email': 'Ел. пошта', 'pp.ogrn': 'Код ЄДРПОУ', 'pp.kpp': 'КПП',
  'pp.rep': 'В особі (ПІБ у род. відмінку)', 'pp.repTitle': 'Посада (род. відмінок)', 'pp.repBasis': 'На підставі (род. відмінок)', 'pp.bank': 'Банк', 'pp.account': 'Рахунок', 'pp.bik': 'МФО',
  'dp.kind': 'Документ', 'dp.number': 'Номер', 'dp.date': 'Дата', 'dp.issuer': 'Ким виданий / посвідчений', 'dp.until': 'Діє до',
  'pe.start': 'Початок', 'pe.months': 'Місяців', 'pe.end': 'Дата виїзду', 'pe.byMonths': 'у місяцях', 'pe.byEnd': 'до дати', 'pe.summary': '{a} – {b}, виїзд {c}',
  'sc.anchor': 'Періоди починаються з числа', 'sc.anchorAuto': 'як початок', 'sc.prorata': 'Неповні періоди — за днями', 'sc.due': 'Оплата, днів від початку періоду', 'sc.summary': '{n} платежів, разом {total}',
  'li.add': 'Додати', 'li.remove': 'Видалити', 'li.up': 'Вище', 'li.down': 'Нижче', 'li.empty': 'Поки порожньо',
  'v.required': 'Обов’язкове поле', 'v.min': 'Не менше {n}', 'v.max': 'Не більше {n}', 'v.mask': 'Неправильний формат (наприклад, {ex})', 'v.pattern': 'Не відповідає формату', 'v.date': 'Неправильна дата',
  'v.after': 'Має бути пізніше, ніж «{f}»', 'v.dateMin': 'Не раніше {d}', 'v.dateMax': 'Не пізніше {d}', 'v.term': 'Вкажіть початок і строк', 'v.order': 'Закінчення раніше за початок',
  'v.minItems': 'Не менше {n} рядків', 'v.maxItems': 'Не більше {n} рядків', 'v.item': 'Рядок {n}: заповніть «{f}»', 'v.checksum': 'Не збігається контрольне число', 'v.expr': 'Помилка у виразі: {m}',
  'v.cycle': 'Обчислювані поля посилаються одне на одне', 'v.user': 'JS-перевірка: {m}', 'v.timeout': 'JS-перевірка не вклалася в {n} мс', 'v.syntax': 'Помилка в тексті шаблону: {m}', 'v.select': 'Виберіть значення зі списку',
  'pg.print': 'Друк', 'pg.reset': 'Очистити', 'pg.export': 'Зберегти дані', 'pg.import': 'Завантажити дані', 'pg.lang': 'Мова', 'pg.form': 'Анкета', 'pg.doc': 'Документ', 'pg.issues': 'Перевірка',
  'pg.ok': 'Зауважень немає', 'pg.saved': 'Зберігається в цьому браузері', 'pg.resetQ': 'Очистити всі поля?', 'pg.hint': 'Заповніть поля — текст документа змінюється одразу.',
  'pg.made': 'Зроблено в Конструкторі договорів: один файл, працює без мережі, нічого нікуди не надсилає.', 'pg.badFile': 'Це не файл даних цього шаблону', 'pg.options': 'Умови', 'pg.side': 'Поруч',
};

const de = {
  'sch.n': 'Nr.', 'sch.period': 'Zeitraum', 'sch.days': 'Tage', 'sch.due': 'Fällig bis', 'sch.amount': 'Betrag', 'sch.total': 'Summe', 'sch.partial': 'Teilzeitraum',
  'list.n': 'Nr.', 'list.total': 'Summe', 'period': 'vom {a} bis {b}', 'appendix': 'Anlage {n}', 'yes': 'ja', 'no': 'nein', 'fallback': 'nicht übersetzt: Text in {lang}',
  'p.born': 'geboren am {d}', 'p.bornAt': 'geboren am {d} in {v}', 'p.passport': 'Ausweis {v}', 'p.issued': 'ausgestellt von {v}', 'p.issuedOn': 'am {d}', 'p.code': 'Behördenkennzahl {v}',
  'p.reg.m': 'wohnhaft in {v}', 'p.reg.f': 'wohnhaft in {v}', 'p.inn': 'Steuer-ID {v}', 'p.ogrn': 'Registernummer {v}', 'p.kpp': 'KPP {v}', 'p.orgAddr': 'Sitz: {v}',
  'p.rep': 'vertreten durch {title} {v}', 'p.basis': 'handelnd aufgrund {v}', 'p.phone': 'Tel. {v}', 'p.email': 'E-Mail {v}', 'p.bank': 'Bank {v}', 'p.account': 'Konto {v}', 'p.bik': 'BIC {v}',
  'd.number': 'Nr. {v}', 'd.date': 'vom {d}', 'd.until': 'gültig bis {d}',
  'pp.kind': 'Partei', 'pp.person': 'Person', 'pp.org': 'Organisation', 'pp.name': 'Vollständiger Name', 'pp.orgName': 'Name der Organisation', 'pp.gender': 'Geschlecht', 'pp.m': 'männlich', 'pp.f': 'weiblich',
  'pp.birthDate': 'Geburtsdatum', 'pp.birthPlace': 'Geburtsort', 'pp.passport': 'Ausweis (Serie und Nummer)', 'pp.passportIssuer': 'Ausgestellt von', 'pp.passportDate': 'Ausstellungsdatum',
  'pp.passportCode': 'Behördenkennzahl', 'pp.address': 'Meldeadresse', 'pp.inn': 'Steuer-ID', 'pp.phone': 'Telefon', 'pp.email': 'E-Mail', 'pp.ogrn': 'Registernummer', 'pp.kpp': 'KPP',
  'pp.rep': 'Vertreten durch (Name)', 'pp.repTitle': 'Funktion', 'pp.repBasis': 'Handelnd aufgrund', 'pp.bank': 'Bank', 'pp.account': 'Konto', 'pp.bik': 'BIC',
  'dp.kind': 'Dokument', 'dp.number': 'Nummer', 'dp.date': 'Datum', 'dp.issuer': 'Ausgestellt / beglaubigt von', 'dp.until': 'Gültig bis',
  'pe.start': 'Beginn', 'pe.months': 'Monate', 'pe.end': 'Auszugsdatum', 'pe.byMonths': 'in Monaten', 'pe.byEnd': 'bis Datum', 'pe.summary': '{a} – {b}, Auszug {c}',
  'sc.anchor': 'Zeiträume beginnen am Tag', 'sc.anchorAuto': 'wie der Beginn', 'sc.prorata': 'Teilzeiträume tageweise', 'sc.due': 'Zahlung, Tage ab Beginn des Zeitraums', 'sc.summary': '{n} Zahlungen, Summe {total}',
  'li.add': 'Hinzufügen', 'li.remove': 'Entfernen', 'li.up': 'Nach oben', 'li.down': 'Nach unten', 'li.empty': 'Noch leer',
  'v.required': 'Pflichtfeld', 'v.min': 'Mindestens {n}', 'v.max': 'Höchstens {n}', 'v.mask': 'Falsches Format (z. B. {ex})', 'v.pattern': 'Entspricht nicht dem Format', 'v.date': 'Kein gültiges Datum',
  'v.after': 'Muss nach „{f}“ liegen', 'v.dateMin': 'Nicht vor dem {d}', 'v.dateMax': 'Nicht nach dem {d}', 'v.term': 'Beginn und Laufzeit angeben', 'v.order': 'Das Ende liegt vor dem Beginn',
  'v.minItems': 'Mindestens {n} Zeilen', 'v.maxItems': 'Höchstens {n} Zeilen', 'v.item': 'Zeile {n}: „{f}“ ausfüllen', 'v.checksum': 'Die Prüfziffer stimmt nicht', 'v.expr': 'Fehler im Ausdruck: {m}',
  'v.cycle': 'Berechnete Felder hängen voneinander ab', 'v.user': 'JS-Prüfung: {m}', 'v.timeout': 'Die JS-Prüfung brauchte länger als {n} ms', 'v.syntax': 'Fehler im Vorlagentext: {m}', 'v.select': 'Einen Wert aus der Liste wählen',
  'pg.print': 'Drucken', 'pg.reset': 'Leeren', 'pg.export': 'Daten speichern', 'pg.import': 'Daten laden', 'pg.lang': 'Sprache', 'pg.form': 'Formular', 'pg.doc': 'Dokument', 'pg.issues': 'Prüfung',
  'pg.ok': 'Keine Probleme', 'pg.saved': 'In diesem Browser gespeichert', 'pg.resetQ': 'Alle Felder leeren?', 'pg.hint': 'Felder ausfüllen: der Text des Dokuments folgt sofort.',
  'pg.made': 'Erstellt mit dem Vertragsbaukasten: eine Datei, offline, nichts wird gesendet.', 'pg.badFile': 'Keine Datendatei dieser Vorlage', 'pg.options': 'Bedingungen', 'pg.side': 'Nebeneinander',
};

const fr = {
  'sch.n': 'N°', 'sch.period': 'Période', 'sch.days': 'Jours', 'sch.due': 'À payer avant le', 'sch.amount': 'Montant', 'sch.total': 'Total', 'sch.partial': 'période partielle',
  'list.n': 'N°', 'list.total': 'Total', 'period': 'du {a} au {b}', 'appendix': 'Annexe {n}', 'yes': 'oui', 'no': 'non', 'fallback': 'non traduit : texte en {lang}',
  'p.born': 'né(e) le {d}', 'p.bornAt': 'né(e) le {d} à {v}', 'p.passport': 'passeport {v}', 'p.issued': 'délivré par {v}', 'p.issuedOn': 'le {d}', 'p.code': 'code de service {v}',
  'p.reg.m': 'domicilié à {v}', 'p.reg.f': 'domiciliée à {v}', 'p.inn': 'n° fiscal {v}', 'p.ogrn': 'n° d’immatriculation {v}', 'p.kpp': 'KPP {v}', 'p.orgAddr': 'siège : {v}',
  'p.rep': 'représentée par {title} {v}', 'p.basis': 'agissant en vertu de {v}', 'p.phone': 'tél. {v}', 'p.email': 'e-mail {v}', 'p.bank': 'banque {v}', 'p.account': 'compte {v}', 'p.bik': 'BIC {v}',
  'd.number': 'n° {v}', 'd.date': 'du {d}', 'd.until': 'valable jusqu’au {d}',
  'pp.kind': 'Partie', 'pp.person': 'Personne', 'pp.org': 'Organisation', 'pp.name': 'Nom complet', 'pp.orgName': 'Dénomination', 'pp.gender': 'Sexe', 'pp.m': 'masculin', 'pp.f': 'féminin',
  'pp.birthDate': 'Date de naissance', 'pp.birthPlace': 'Lieu de naissance', 'pp.passport': 'Passeport (série et numéro)', 'pp.passportIssuer': 'Délivré par', 'pp.passportDate': 'Date de délivrance',
  'pp.passportCode': 'Code de service', 'pp.address': 'Adresse', 'pp.inn': 'N° fiscal', 'pp.phone': 'Téléphone', 'pp.email': 'E-mail', 'pp.ogrn': 'N° d’immatriculation', 'pp.kpp': 'KPP',
  'pp.rep': 'Représentée par (nom)', 'pp.repTitle': 'Fonction', 'pp.repBasis': 'Agissant en vertu de', 'pp.bank': 'Banque', 'pp.account': 'Compte', 'pp.bik': 'BIC',
  'dp.kind': 'Document', 'dp.number': 'Numéro', 'dp.date': 'Date', 'dp.issuer': 'Délivré / certifié par', 'dp.until': 'Valable jusqu’au',
  'pe.start': 'Début', 'pe.months': 'Mois', 'pe.end': 'Date de départ', 'pe.byMonths': 'en mois', 'pe.byEnd': 'jusqu’à une date', 'pe.summary': '{a} – {b}, départ le {c}',
  'sc.anchor': 'Les périodes commencent le', 'sc.anchorAuto': 'comme le début', 'sc.prorata': 'Périodes partielles au prorata', 'sc.due': 'Paiement, jours après le début de période', 'sc.summary': '{n} paiements, total {total}',
  'li.add': 'Ajouter', 'li.remove': 'Supprimer', 'li.up': 'Monter', 'li.down': 'Descendre', 'li.empty': 'Encore vide',
  'v.required': 'Champ obligatoire', 'v.min': 'Au moins {n}', 'v.max': 'Au plus {n}', 'v.mask': 'Format incorrect (p. ex. {ex})', 'v.pattern': 'Ne correspond pas au format', 'v.date': 'Date invalide',
  'v.after': 'Doit être postérieur à « {f} »', 'v.dateMin': 'Pas avant le {d}', 'v.dateMax': 'Pas après le {d}', 'v.term': 'Indiquez le début et la durée', 'v.order': 'La fin précède le début',
  'v.minItems': 'Au moins {n} lignes', 'v.maxItems': 'Au plus {n} lignes', 'v.item': 'Ligne {n} : remplir « {f} »', 'v.checksum': 'La clé de contrôle ne correspond pas', 'v.expr': 'Erreur d’expression : {m}',
  'v.cycle': 'Des champs calculés dépendent l’un de l’autre', 'v.user': 'Contrôle JS : {m}', 'v.timeout': 'Le contrôle JS a dépassé {n} ms', 'v.syntax': 'Erreur dans le texte du modèle : {m}', 'v.select': 'Choisissez une valeur de la liste',
  'pg.print': 'Imprimer', 'pg.reset': 'Effacer', 'pg.export': 'Enregistrer les données', 'pg.import': 'Charger des données', 'pg.lang': 'Langue', 'pg.form': 'Formulaire', 'pg.doc': 'Document', 'pg.issues': 'Contrôles',
  'pg.ok': 'Aucun problème', 'pg.saved': 'Conservé dans ce navigateur', 'pg.resetQ': 'Effacer tous les champs ?', 'pg.hint': 'Remplissez les champs : le texte du document suit aussitôt.',
  'pg.made': 'Créé avec le Constructeur de contrats : un seul fichier, hors ligne, rien n’est envoyé.', 'pg.badFile': 'Ce n’est pas un fichier de données de ce modèle', 'pg.options': 'Conditions', 'pg.side': 'Côte à côte',
};

const es = {
  'sch.n': 'N.º', 'sch.period': 'Periodo', 'sch.days': 'Días', 'sch.due': 'Pagar antes del', 'sch.amount': 'Importe', 'sch.total': 'Total', 'sch.partial': 'periodo parcial',
  'list.n': 'N.º', 'list.total': 'Total', 'period': 'del {a} al {b}', 'appendix': 'Anexo {n}', 'yes': 'sí', 'no': 'no', 'fallback': 'sin traducir: texto en {lang}',
  'p.born': 'nacido/a el {d}', 'p.bornAt': 'nacido/a el {d} en {v}', 'p.passport': 'pasaporte {v}', 'p.issued': 'expedido por {v}', 'p.issuedOn': 'el {d}', 'p.code': 'código de oficina {v}',
  'p.reg.m': 'con domicilio en {v}', 'p.reg.f': 'con domicilio en {v}', 'p.inn': 'NIF {v}', 'p.ogrn': 'n.º de registro {v}', 'p.kpp': 'KPP {v}', 'p.orgAddr': 'domicilio social: {v}',
  'p.rep': 'representada por {title} {v}', 'p.basis': 'en virtud de {v}', 'p.phone': 'tel. {v}', 'p.email': 'correo {v}', 'p.bank': 'banco {v}', 'p.account': 'cuenta {v}', 'p.bik': 'BIC {v}',
  'd.number': 'n.º {v}', 'd.date': 'de fecha {d}', 'd.until': 'válido hasta el {d}',
  'pp.kind': 'Parte', 'pp.person': 'Persona', 'pp.org': 'Organización', 'pp.name': 'Nombre completo', 'pp.orgName': 'Denominación', 'pp.gender': 'Sexo', 'pp.m': 'masculino', 'pp.f': 'femenino',
  'pp.birthDate': 'Fecha de nacimiento', 'pp.birthPlace': 'Lugar de nacimiento', 'pp.passport': 'Pasaporte (serie y número)', 'pp.passportIssuer': 'Expedido por', 'pp.passportDate': 'Fecha de expedición',
  'pp.passportCode': 'Código de oficina', 'pp.address': 'Domicilio', 'pp.inn': 'NIF', 'pp.phone': 'Teléfono', 'pp.email': 'Correo', 'pp.ogrn': 'N.º de registro', 'pp.kpp': 'KPP',
  'pp.rep': 'Representada por (nombre)', 'pp.repTitle': 'Cargo', 'pp.repBasis': 'En virtud de', 'pp.bank': 'Banco', 'pp.account': 'Cuenta', 'pp.bik': 'BIC',
  'dp.kind': 'Documento', 'dp.number': 'Número', 'dp.date': 'Fecha', 'dp.issuer': 'Expedido / certificado por', 'dp.until': 'Válido hasta',
  'pe.start': 'Inicio', 'pe.months': 'Meses', 'pe.end': 'Fecha de salida', 'pe.byMonths': 'en meses', 'pe.byEnd': 'hasta una fecha', 'pe.summary': '{a} – {b}, salida {c}',
  'sc.anchor': 'Los periodos empiezan el día', 'sc.anchorAuto': 'como el inicio', 'sc.prorata': 'Periodos parciales por días', 'sc.due': 'Pago, días desde el inicio del periodo', 'sc.summary': '{n} pagos, total {total}',
  'li.add': 'Añadir', 'li.remove': 'Quitar', 'li.up': 'Subir', 'li.down': 'Bajar', 'li.empty': 'Aún vacío',
  'v.required': 'Campo obligatorio', 'v.min': 'Al menos {n}', 'v.max': 'Como máximo {n}', 'v.mask': 'Formato incorrecto (p. ej. {ex})', 'v.pattern': 'No coincide con el formato', 'v.date': 'Fecha no válida',
  'v.after': 'Debe ser posterior a «{f}»', 'v.dateMin': 'No antes del {d}', 'v.dateMax': 'No después del {d}', 'v.term': 'Indique el inicio y el plazo', 'v.order': 'El final es anterior al inicio',
  'v.minItems': 'Al menos {n} filas', 'v.maxItems': 'Como máximo {n} filas', 'v.item': 'Fila {n}: rellene «{f}»', 'v.checksum': 'El dígito de control no coincide', 'v.expr': 'Error en la expresión: {m}',
  'v.cycle': 'Campos calculados dependen unos de otros', 'v.user': 'Validación JS: {m}', 'v.timeout': 'La validación JS superó {n} ms', 'v.syntax': 'Error en el texto de la plantilla: {m}', 'v.select': 'Elija un valor de la lista',
  'pg.print': 'Imprimir', 'pg.reset': 'Vaciar', 'pg.export': 'Guardar datos', 'pg.import': 'Cargar datos', 'pg.lang': 'Idioma', 'pg.form': 'Formulario', 'pg.doc': 'Documento', 'pg.issues': 'Revisión',
  'pg.ok': 'Sin problemas', 'pg.saved': 'Guardado en este navegador', 'pg.resetQ': '¿Vaciar todos los campos?', 'pg.hint': 'Rellene los campos: el texto del documento cambia al momento.',
  'pg.made': 'Hecho con el Constructor de contratos: un archivo, sin conexión, no se envía nada.', 'pg.badFile': 'No es un archivo de datos de esta plantilla', 'pg.options': 'Condiciones', 'pg.side': 'En paralelo',
};

const ka = {
  'sch.n': '№', 'sch.period': 'პერიოდი', 'sch.days': 'დღე', 'sch.due': 'გადახდა არაუგვიანეს', 'sch.amount': 'თანხა', 'sch.total': 'სულ', 'sch.partial': 'არასრული პერიოდი',
  'list.n': '№', 'list.total': 'სულ', 'period': '{a}-დან {b}-მდე', 'appendix': 'დანართი № {n}', 'yes': 'კი', 'no': 'არა', 'fallback': 'არ არის თარგმნილი: ტექსტი ენაზე {lang}',
  'p.born': 'დაბადებული {d}', 'p.bornAt': 'დაბადებული {d}, {v}', 'p.passport': 'პასპორტი {v}', 'p.issued': 'გაცემული {v}', 'p.issuedOn': '{d}', 'p.code': 'განყოფილების კოდი {v}',
  'p.reg.m': 'რეგისტრირებული მისამართზე: {v}', 'p.reg.f': 'რეგისტრირებული მისამართზე: {v}', 'p.inn': 'პირადი/საიდენტიფიკაციო № {v}', 'p.ogrn': 'სარეგისტრაციო № {v}', 'p.kpp': 'KPP {v}', 'p.orgAddr': 'იურიდიული მისამართი: {v}',
  'p.rep': 'წარმოდგენილი {title} {v}-ის მიერ', 'p.basis': 'მოქმედი {v}-ის საფუძველზე', 'p.phone': 'ტელ. {v}', 'p.email': 'ელ. ფოსტა {v}', 'p.bank': 'ბანკი {v}', 'p.account': 'ანგარიში {v}', 'p.bik': 'BIC {v}',
  'd.number': '№ {v}', 'd.date': '{d}', 'd.until': 'მოქმედია {d}-მდე',
  'pp.kind': 'მხარე', 'pp.person': 'ფიზიკური პირი', 'pp.org': 'ორგანიზაცია', 'pp.name': 'სახელი და გვარი', 'pp.orgName': 'ორგანიზაციის სახელწოდება', 'pp.gender': 'სქესი', 'pp.m': 'მამრობითი', 'pp.f': 'მდედრობითი',
  'pp.birthDate': 'დაბადების თარიღი', 'pp.birthPlace': 'დაბადების ადგილი', 'pp.passport': 'პასპორტი (სერია და ნომერი)', 'pp.passportIssuer': 'გამცემი', 'pp.passportDate': 'გაცემის თარიღი',
  'pp.passportCode': 'განყოფილების კოდი', 'pp.address': 'რეგისტრაციის მისამართი', 'pp.inn': 'საიდენტიფიკაციო ნომერი', 'pp.phone': 'ტელეფონი', 'pp.email': 'ელ. ფოსტა', 'pp.ogrn': 'სარეგისტრაციო ნომერი', 'pp.kpp': 'KPP',
  'pp.rep': 'წარმომადგენელი (სახელი)', 'pp.repTitle': 'თანამდებობა', 'pp.repBasis': 'მოქმედებს საფუძველზე', 'pp.bank': 'ბანკი', 'pp.account': 'ანგარიში', 'pp.bik': 'BIC',
  'dp.kind': 'დოკუმენტი', 'dp.number': 'ნომერი', 'dp.date': 'თარიღი', 'dp.issuer': 'გამცემი / დამმოწმებელი', 'dp.until': 'მოქმედია',
  'pe.start': 'დასაწყისი', 'pe.months': 'თვე', 'pe.end': 'გასვლის თარიღი', 'pe.byMonths': 'თვეებით', 'pe.byEnd': 'თარიღამდე', 'pe.summary': '{a} – {b}, გასვლა {c}',
  'sc.anchor': 'პერიოდები იწყება რიცხვში', 'sc.anchorAuto': 'როგორც დასაწყისი', 'sc.prorata': 'არასრული პერიოდები დღეებით', 'sc.due': 'გადახდა, დღე პერიოდის დასაწყისიდან', 'sc.summary': '{n} გადახდა, სულ {total}',
  'li.add': 'დამატება', 'li.remove': 'წაშლა', 'li.up': 'ზემოთ', 'li.down': 'ქვემოთ', 'li.empty': 'ჯერ ცარიელია',
  'v.required': 'სავალდებულო ველი', 'v.min': 'არანაკლებ {n}', 'v.max': 'არაუმეტეს {n}', 'v.mask': 'არასწორი ფორმატი (მაგ., {ex})', 'v.pattern': 'არ შეესაბამება ფორმატს', 'v.date': 'არასწორი თარიღი',
  'v.after': 'უნდა იყოს „{f}“-ის შემდეგ', 'v.dateMin': 'არა უადრეს {d}', 'v.dateMax': 'არა უგვიანეს {d}', 'v.term': 'მიუთითეთ დასაწყისი და ვადა', 'v.order': 'დასასრული დასაწყისზე ადრეა',
  'v.minItems': 'არანაკლებ {n} სტრიქონი', 'v.maxItems': 'არაუმეტეს {n} სტრიქონი', 'v.item': 'სტრიქონი {n}: შეავსეთ „{f}“', 'v.checksum': 'საკონტროლო ციფრი არ ემთხვევა', 'v.expr': 'შეცდომა გამოსახულებაში: {m}',
  'v.cycle': 'გამოთვლადი ველები ერთმანეთზეა დამოკიდებული', 'v.user': 'JS შემოწმება: {m}', 'v.timeout': 'JS შემოწმება {n} მწ-ში ვერ დასრულდა', 'v.syntax': 'შეცდომა შაბლონის ტექსტში: {m}', 'v.select': 'აირჩიეთ მნიშვნელობა სიიდან',
  'pg.print': 'ბეჭდვა', 'pg.reset': 'გასუფთავება', 'pg.export': 'მონაცემების შენახვა', 'pg.import': 'მონაცემების ჩატვირთვა', 'pg.lang': 'ენა', 'pg.form': 'ანკეტა', 'pg.doc': 'დოკუმენტი', 'pg.issues': 'შემოწმება',
  'pg.ok': 'შენიშვნები არ არის', 'pg.saved': 'ინახება ამ ბრაუზერში', 'pg.resetQ': 'გასუფთავდეს ყველა ველი?', 'pg.hint': 'შეავსეთ ველები — დოკუმენტის ტექსტი მაშინვე იცვლება.',
  'pg.made': 'შექმნილია ხელშეკრულებების კონსტრუქტორში: ერთი ფაილი, მუშაობს ქსელის გარეშე, არაფერს აგზავნის.', 'pg.badFile': 'ეს არ არის ამ შაბლონის მონაცემების ფაილი', 'pg.options': 'პირობები', 'pg.side': 'გვერდიგვერდ',
};

export const DICTS = { en, ru, uk, de, fr, es, ka };

// prim: 'ru-RU' -> 'ru'. own: hasOwnProperty lookup, so a key or language like 'constructor' or '__proto__' never
// resolves to an Object.prototype member (keys and languages come from user-authored templates).
const prim = (lang) => String(lang || '').toLowerCase().split('-')[0];
const own = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

// Fallback chain: exact language -> primary subtag -> English dictionary; missing key -> English text -> the key
// itself (a visible key in output is a loud, greppable bug, better than an empty string). `??` not `||`: an
// intentionally empty translation '' is kept. Unknown {vars} are left as written so a template author sees the typo.
export function tr(lang, key, vars) {
  const d = own(DICTS, lang) || own(DICTS, prim(lang)) || en;
  let s = own(d, key) ?? own(en, key) ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return s;
}

// The dictionaries a compiled page needs (its languages plus English as the fallback).
// Keyed by the name that resolved (exact, else primary subtag), mirroring tr's lookup order, so the page-side tr
// finds the same dictionary under the same name.
export function dictFor(langs) {
  const out = { en };
  for (const l of langs || []) { const d = own(DICTS, l) || own(DICTS, prim(l)); if (d) out[own(DICTS, l) ? l : prim(l)] = d; }
  return out;
}
