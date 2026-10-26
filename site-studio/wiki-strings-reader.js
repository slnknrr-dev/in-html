// site-studio/wiki-strings-reader.js - strings of published knowledge bases (the reader, prerendered pages, the
// server) in the 7 UI languages, and a tiny translator with plurals and {var} interpolation (Node and browsers).
//
//   readerT(lang) -> t(key, vars)        lang: one of READER_LANGS (else English)
//   READER_STRINGS[lang][key]            string | { one, few, many, other }
import { PT_UI } from '../portal/strings.js';

// Separate from the editor's strings (wiki-strings-*.js) on purpose: this dictionary ships inside every exported
// site, so it holds only what a reader sees; the editor's ~180 keys per language would be dead weight there.
// Structure: one flat object per language, keys namespaced 'r.*' (reader) and 'pt.*' (portal, merged below);
// values are strings with {var} slots or plural objects { one, few, many, other } (CLDR categories).
// Data tables below: header and structure only, per the commenting policy for dictionaries.
export const READER_LANGS = ['en', 'ru', 'uk', 'de', 'fr', 'es', 'ka'];

const en = {
  'r.accessed': 'Retrieved', 'r.backTo': 'Jump up to the citation', 'r.breadcrumbs': 'Breadcrumbs',
  'r.callout.note': 'Note', 'r.callout.info': 'Information', 'r.callout.tip': 'Tip', 'r.callout.warning': 'Warning', 'r.callout.stub': 'This page is a stub',
  'r.callout.spoiler': 'Spoiler', 'r.callout.important': 'Important',
  'r.categories': 'Categories', 'r.categoryTitle': 'Category: {name}', 'r.contents': 'Contents', 'r.enlarge': 'Enlarge image', 'r.from': 'From {site}',
  'r.goHome': 'Go to the main page', 'r.goTo': 'Go to page:', 'r.hat.main': 'Main article:', 'r.hat.see': 'See also:', 'r.hat.further': 'Further information:',
  'r.home': 'Main page', 'r.lastEdited': 'Last edited on {date}', 'r.layers': 'Layers', 'r.linksTo': 'Pages that link to “{title}”',
  'r.madeWith': 'Made with Knowledge Processor', 'r.menu': 'Menu', 'r.missingPage': '{title} (the page does not exist)', 'r.more': 'More',
  'r.navbox': 'Navigation', 'r.navigation': 'Navigation', 'r.noLinks': 'No pages link here.', 'r.noMedia': 'The media file is missing',
  'r.noPages': 'No pages yet.', 'r.notFound': 'Page not found', 'r.notFoundText': 'There is no page “{page}” in this knowledge base.',
  'r.notes': 'Notes', 'r.original': 'Original', 'r.pagesInCategory': { one: '{n} page in this category', other: '{n} pages in this category' },
  'r.password': 'Password', 'r.placeholder': 'To be filled in', 'r.play': 'Play', 'r.playFrom': 'Play from {t}', 'r.publicVersion': 'Public version',
  'r.readMore': 'Read more', 'r.redirectedFrom': '(Redirected from {title})', 'r.references': 'References',
  'r.resultsN': { one: '{n} result for “{q}”', other: '{n} results for “{q}”' }, 'r.scheme': 'Light / dark', 'r.search': 'Search',
  'r.searchFor': 'Search for “{q}”', 'r.searchPh': 'Search {site}', 'r.searchResults': 'Search results', 'r.secretVersion': 'Secret version',
  'r.seeAlso': 'See also', 'r.show': 'Show:', 'r.skip': 'Skip to content',
  'r.special.all': 'All pages', 'r.special.recent': 'Recent changes', 'r.special.random': 'Random page', 'r.special.search': 'Search',
  'r.special.categories': 'Categories', 'r.special.unlock': 'Unlock', 'r.special.links': 'What links here',
  'r.subpages': 'Subpages', 'r.tools': 'Tools', 'r.unlock': 'Unlock',
  'r.unlockHelp': 'Some pages of this knowledge base are encrypted. Enter a password to open what it unlocks. The password never leaves this browser.',
  'r.unlockTitle': 'Unlock secret pages', 'r.unlocking': 'Unlocking…', 'r.unlockingHelp': 'Deriving the key from the password. This takes a moment on purpose.',
  'r.unlockWrong': 'This password opens nothing here.', 'r.unlockedN': { one: 'Unlocked: {n} item', other: 'Unlocked: {n} items' }, 'r.unlockedList': 'Unlocked pages',
  'r.variants': 'Variants', 'r.version': 'Version:', 'r.versionN': 'Version {n}', 'r.versions': 'Versions', 'r.whatLinksHere': 'What links here',
  'r.term': 'Term', 'r.reading': 'Reading', 'r.meaning': 'Meaning', 'r.note': 'Note', 'r.top': 'Back to top', 'r.close': 'Close', 'r.flip': 'Turn the card over',
  'r.reveal': 'Reveal', 'r.searchAll': 'Search all pages for “{q}”', 'r.noResults': 'Nothing found.', 'r.loading': 'Loading…', 'r.prev': 'Previous', 'r.next': 'Next',
  'r.sort': 'Sort by this column', 'r.secretPage': 'Secret page',
};

const ru = {
  'r.accessed': 'Проверено', 'r.backTo': 'Вернуться к ссылке', 'r.breadcrumbs': 'Навигационная цепочка',
  'r.callout.note': 'Примечание', 'r.callout.info': 'Информация', 'r.callout.tip': 'Совет', 'r.callout.warning': 'Внимание', 'r.callout.stub': 'Это заготовка статьи',
  'r.callout.spoiler': 'Спойлер', 'r.callout.important': 'Важно',
  'r.categories': 'Категории', 'r.categoryTitle': 'Категория: {name}', 'r.contents': 'Содержание', 'r.enlarge': 'Увеличить изображение', 'r.from': 'Материал из {site}',
  'r.goHome': 'На заглавную страницу', 'r.goTo': 'Перейти к странице:', 'r.hat.main': 'Основная статья:', 'r.hat.see': 'См. также:', 'r.hat.further': 'Подробнее:',
  'r.home': 'Заглавная страница', 'r.lastEdited': 'Последнее изменение: {date}', 'r.layers': 'Слои', 'r.linksTo': 'Страницы, ссылающиеся на «{title}»',
  'r.madeWith': 'Сделано в Knowledge Processor', 'r.menu': 'Меню', 'r.missingPage': '{title} (страница не существует)', 'r.more': 'Подробнее',
  'r.navbox': 'Навигация', 'r.navigation': 'Навигация', 'r.noLinks': 'Сюда не ссылается ни одна страница.', 'r.noMedia': 'Медиафайл отсутствует',
  'r.noPages': 'Страниц пока нет.', 'r.notFound': 'Страница не найдена', 'r.notFoundText': 'В этой базе знаний нет страницы «{page}».',
  'r.notes': 'Примечания', 'r.original': 'Оригинал', 'r.pagesInCategory': { one: '{n} страница в этой категории', few: '{n} страницы в этой категории', many: '{n} страниц в этой категории', other: '{n} страницы в этой категории' },
  'r.password': 'Пароль', 'r.placeholder': 'Заполнить', 'r.play': 'Воспроизвести', 'r.playFrom': 'Воспроизвести с {t}', 'r.publicVersion': 'Открытая версия',
  'r.readMore': 'Читать дальше', 'r.redirectedFrom': '(Перенаправлено с «{title}»)', 'r.references': 'Источники',
  'r.resultsN': { one: '{n} результат по запросу «{q}»', few: '{n} результата по запросу «{q}»', many: '{n} результатов по запросу «{q}»', other: '{n} результата по запросу «{q}»' },
  'r.scheme': 'Светлая / тёмная тема', 'r.search': 'Поиск', 'r.searchFor': 'Искать «{q}»', 'r.searchPh': 'Поиск по {site}', 'r.searchResults': 'Результаты поиска',
  'r.secretVersion': 'Тайная версия', 'r.seeAlso': 'См. также', 'r.show': 'Показать:', 'r.skip': 'К содержимому',
  'r.special.all': 'Все страницы', 'r.special.recent': 'Свежие правки', 'r.special.random': 'Случайная страница', 'r.special.search': 'Поиск',
  'r.special.categories': 'Категории', 'r.special.unlock': 'Открыть', 'r.special.links': 'Ссылки сюда',
  'r.subpages': 'Подстраницы', 'r.tools': 'Инструменты', 'r.unlock': 'Открыть по паролю',
  'r.unlockHelp': 'Часть страниц этой базы знаний зашифрована. Введите пароль, чтобы открыть то, что он отпирает. Пароль не покидает этот браузер.',
  'r.unlockTitle': 'Открыть тайные страницы', 'r.unlocking': 'Открываем…', 'r.unlockingHelp': 'Ключ выводится из пароля. Это намеренно занимает немного времени.',
  'r.unlockWrong': 'Этот пароль здесь ничего не открывает.', 'r.unlockedN': { one: 'Открыто: {n} элемент', few: 'Открыто: {n} элемента', many: 'Открыто: {n} элементов', other: 'Открыто: {n} элемента' },
  'r.unlockedList': 'Открытые страницы', 'r.variants': 'Варианты', 'r.version': 'Версия:', 'r.versionN': 'Версия {n}', 'r.versions': 'Версии',
  'r.whatLinksHere': 'Ссылки сюда', 'r.term': 'Термин', 'r.reading': 'Чтение', 'r.meaning': 'Значение', 'r.note': 'Примечание', 'r.top': 'Наверх',
  'r.close': 'Закрыть', 'r.flip': 'Перевернуть карточку', 'r.reveal': 'Показать', 'r.searchAll': 'Искать «{q}» на всех страницах', 'r.noResults': 'Ничего не найдено.',
  'r.loading': 'Загрузка…', 'r.prev': 'Назад', 'r.next': 'Вперёд', 'r.sort': 'Сортировать по этому столбцу', 'r.secretPage': 'Тайная страница',
};

const uk = {
  'r.accessed': 'Перевірено', 'r.backTo': 'Повернутися до посилання', 'r.breadcrumbs': 'Навігаційний ланцюжок',
  'r.callout.note': 'Примітка', 'r.callout.info': 'Інформація', 'r.callout.tip': 'Порада', 'r.callout.warning': 'Увага', 'r.callout.stub': 'Це заготовка статті',
  'r.callout.spoiler': 'Спойлер', 'r.callout.important': 'Важливо',
  'r.categories': 'Категорії', 'r.categoryTitle': 'Категорія: {name}', 'r.contents': 'Зміст', 'r.enlarge': 'Збільшити зображення', 'r.from': 'Матеріал з {site}',
  'r.goHome': 'На головну сторінку', 'r.goTo': 'Перейти до сторінки:', 'r.hat.main': 'Основна стаття:', 'r.hat.see': 'Див. також:', 'r.hat.further': 'Докладніше:',
  'r.home': 'Головна сторінка', 'r.lastEdited': 'Остання зміна: {date}', 'r.layers': 'Шари', 'r.linksTo': 'Сторінки, що посилаються на «{title}»',
  'r.madeWith': 'Зроблено в Knowledge Processor', 'r.menu': 'Меню', 'r.missingPage': '{title} (сторінки не існує)', 'r.more': 'Докладніше',
  'r.navbox': 'Навігація', 'r.navigation': 'Навігація', 'r.noLinks': 'Сюди не посилається жодна сторінка.', 'r.noMedia': 'Медіафайл відсутній',
  'r.noPages': 'Сторінок поки немає.', 'r.notFound': 'Сторінку не знайдено', 'r.notFoundText': 'У цій базі знань немає сторінки «{page}».',
  'r.notes': 'Примітки', 'r.original': 'Оригінал', 'r.pagesInCategory': { one: '{n} сторінка в цій категорії', few: '{n} сторінки в цій категорії', many: '{n} сторінок у цій категорії', other: '{n} сторінки в цій категорії' },
  'r.password': 'Пароль', 'r.placeholder': 'Заповнити', 'r.play': 'Відтворити', 'r.playFrom': 'Відтворити з {t}', 'r.publicVersion': 'Відкрита версія',
  'r.readMore': 'Читати далі', 'r.redirectedFrom': '(Перенаправлено з «{title}»)', 'r.references': 'Джерела',
  'r.resultsN': { one: '{n} результат за запитом «{q}»', few: '{n} результати за запитом «{q}»', many: '{n} результатів за запитом «{q}»', other: '{n} результату за запитом «{q}»' },
  'r.scheme': 'Світла / темна тема', 'r.search': 'Пошук', 'r.searchFor': 'Шукати «{q}»', 'r.searchPh': 'Пошук у {site}', 'r.searchResults': 'Результати пошуку',
  'r.secretVersion': 'Таємна версія', 'r.seeAlso': 'Див. також', 'r.show': 'Показати:', 'r.skip': 'До вмісту',
  'r.special.all': 'Усі сторінки', 'r.special.recent': 'Нові редагування', 'r.special.random': 'Випадкова сторінка', 'r.special.search': 'Пошук',
  'r.special.categories': 'Категорії', 'r.special.unlock': 'Відкрити', 'r.special.links': 'Посилання сюди',
  'r.subpages': 'Підсторінки', 'r.tools': 'Інструменти', 'r.unlock': 'Відкрити за паролем',
  'r.unlockHelp': 'Частину сторінок цієї бази знань зашифровано. Введіть пароль, щоб відкрити те, що він відмикає. Пароль не залишає цей браузер.',
  'r.unlockTitle': 'Відкрити таємні сторінки', 'r.unlocking': 'Відкриваємо…', 'r.unlockingHelp': 'Ключ виводиться з пароля. Це навмисно займає трохи часу.',
  'r.unlockWrong': 'Цей пароль тут нічого не відкриває.', 'r.unlockedN': { one: 'Відкрито: {n} елемент', few: 'Відкрито: {n} елементи', many: 'Відкрито: {n} елементів', other: 'Відкрито: {n} елемента' },
  'r.unlockedList': 'Відкриті сторінки', 'r.variants': 'Варіанти', 'r.version': 'Версія:', 'r.versionN': 'Версія {n}', 'r.versions': 'Версії',
  'r.whatLinksHere': 'Посилання сюди', 'r.term': 'Термін', 'r.reading': 'Читання', 'r.meaning': 'Значення', 'r.note': 'Примітка', 'r.top': 'Нагору',
  'r.close': 'Закрити', 'r.flip': 'Перевернути картку', 'r.reveal': 'Показати', 'r.searchAll': 'Шукати «{q}» на всіх сторінках', 'r.noResults': 'Нічого не знайдено.',
  'r.loading': 'Завантаження…', 'r.prev': 'Назад', 'r.next': 'Далі', 'r.sort': 'Сортувати за цим стовпцем', 'r.secretPage': 'Таємна сторінка',
};

const de = {
  'r.accessed': 'Abgerufen am', 'r.backTo': 'Zurück zum Einzelnachweis', 'r.breadcrumbs': 'Brotkrumen',
  'r.callout.note': 'Anmerkung', 'r.callout.info': 'Information', 'r.callout.tip': 'Tipp', 'r.callout.warning': 'Warnung', 'r.callout.stub': 'Dieser Artikel ist ein Stub',
  'r.callout.spoiler': 'Spoiler', 'r.callout.important': 'Wichtig',
  'r.categories': 'Kategorien', 'r.categoryTitle': 'Kategorie: {name}', 'r.contents': 'Inhaltsverzeichnis', 'r.enlarge': 'Bild vergrößern', 'r.from': 'Aus {site}',
  'r.goHome': 'Zur Hauptseite', 'r.goTo': 'Zur Seite:', 'r.hat.main': 'Hauptartikel:', 'r.hat.see': 'Siehe auch:', 'r.hat.further': 'Weitere Informationen:',
  'r.home': 'Hauptseite', 'r.lastEdited': 'Zuletzt bearbeitet am {date}', 'r.layers': 'Ebenen', 'r.linksTo': 'Seiten, die auf „{title}“ verlinken',
  'r.madeWith': 'Erstellt mit Knowledge Processor', 'r.menu': 'Menü', 'r.missingPage': '{title} (Seite existiert nicht)', 'r.more': 'Mehr',
  'r.navbox': 'Navigation', 'r.navigation': 'Navigation', 'r.noLinks': 'Keine Seite verlinkt hierher.', 'r.noMedia': 'Die Mediendatei fehlt',
  'r.noPages': 'Noch keine Seiten.', 'r.notFound': 'Seite nicht gefunden', 'r.notFoundText': 'In dieser Wissensbasis gibt es keine Seite „{page}“.',
  'r.notes': 'Anmerkungen', 'r.original': 'Original', 'r.pagesInCategory': { one: '{n} Seite in dieser Kategorie', other: '{n} Seiten in dieser Kategorie' },
  'r.password': 'Passwort', 'r.placeholder': 'Auszufüllen', 'r.play': 'Abspielen', 'r.playFrom': 'Ab {t} abspielen', 'r.publicVersion': 'Öffentliche Fassung',
  'r.readMore': 'Weiterlesen', 'r.redirectedFrom': '(Weitergeleitet von „{title}“)', 'r.references': 'Einzelnachweise',
  'r.resultsN': { one: '{n} Ergebnis für „{q}“', other: '{n} Ergebnisse für „{q}“' }, 'r.scheme': 'Hell / dunkel', 'r.search': 'Suche',
  'r.searchFor': 'Nach „{q}“ suchen', 'r.searchPh': '{site} durchsuchen', 'r.searchResults': 'Suchergebnisse', 'r.secretVersion': 'Geheime Fassung',
  'r.seeAlso': 'Siehe auch', 'r.show': 'Zeigen:', 'r.skip': 'Zum Inhalt springen',
  'r.special.all': 'Alle Seiten', 'r.special.recent': 'Letzte Änderungen', 'r.special.random': 'Zufällige Seite', 'r.special.search': 'Suche',
  'r.special.categories': 'Kategorien', 'r.special.unlock': 'Entsperren', 'r.special.links': 'Links auf diese Seite',
  'r.subpages': 'Unterseiten', 'r.tools': 'Werkzeuge', 'r.unlock': 'Mit Passwort öffnen',
  'r.unlockHelp': 'Einige Seiten dieser Wissensbasis sind verschlüsselt. Geben Sie ein Passwort ein, um zu öffnen, was es entsperrt. Das Passwort verlässt diesen Browser nie.',
  'r.unlockTitle': 'Geheime Seiten entsperren', 'r.unlocking': 'Wird entsperrt …', 'r.unlockingHelp': 'Der Schlüssel wird aus dem Passwort abgeleitet. Das dauert absichtlich einen Moment.',
  'r.unlockWrong': 'Dieses Passwort öffnet hier nichts.', 'r.unlockedN': { one: 'Entsperrt: {n} Element', other: 'Entsperrt: {n} Elemente' }, 'r.unlockedList': 'Entsperrte Seiten',
  'r.variants': 'Varianten', 'r.version': 'Fassung:', 'r.versionN': 'Fassung {n}', 'r.versions': 'Fassungen', 'r.whatLinksHere': 'Links auf diese Seite',
  'r.term': 'Begriff', 'r.reading': 'Lesung', 'r.meaning': 'Bedeutung', 'r.note': 'Anmerkung', 'r.top': 'Nach oben', 'r.close': 'Schließen', 'r.flip': 'Karte umdrehen',
  'r.reveal': 'Aufdecken', 'r.searchAll': 'Alle Seiten nach „{q}“ durchsuchen', 'r.noResults': 'Nichts gefunden.', 'r.loading': 'Wird geladen …', 'r.prev': 'Zurück', 'r.next': 'Weiter',
  'r.sort': 'Nach dieser Spalte sortieren', 'r.secretPage': 'Geheime Seite',
};

const fr = {
  'r.accessed': 'Consulté le', 'r.backTo': 'Revenir à l’appel de note', 'r.breadcrumbs': 'Fil d’Ariane',
  'r.callout.note': 'Remarque', 'r.callout.info': 'Information', 'r.callout.tip': 'Astuce', 'r.callout.warning': 'Avertissement', 'r.callout.stub': 'Cet article est une ébauche',
  'r.callout.spoiler': 'Divulgâcheur', 'r.callout.important': 'Important',
  'r.categories': 'Catégories', 'r.categoryTitle': 'Catégorie : {name}', 'r.contents': 'Sommaire', 'r.enlarge': 'Agrandir l’image', 'r.from': 'Extrait de {site}',
  'r.goHome': 'Aller à l’accueil', 'r.goTo': 'Aller à la page :', 'r.hat.main': 'Article principal :', 'r.hat.see': 'Voir aussi :', 'r.hat.further': 'Pour plus de détails :',
  'r.home': 'Accueil', 'r.lastEdited': 'Dernière modification le {date}', 'r.layers': 'Couches', 'r.linksTo': 'Pages liées à « {title} »',
  'r.madeWith': 'Réalisé avec Knowledge Processor', 'r.menu': 'Menu', 'r.missingPage': '{title} (la page n’existe pas)', 'r.more': 'Plus',
  'r.navbox': 'Navigation', 'r.navigation': 'Navigation', 'r.noLinks': 'Aucune page ne pointe ici.', 'r.noMedia': 'Le fichier média est manquant',
  'r.noPages': 'Pas encore de pages.', 'r.notFound': 'Page introuvable', 'r.notFoundText': 'Il n’y a pas de page « {page} » dans cette base de connaissances.',
  'r.notes': 'Notes', 'r.original': 'Original', 'r.pagesInCategory': { one: '{n} page dans cette catégorie', other: '{n} pages dans cette catégorie' },
  'r.password': 'Mot de passe', 'r.placeholder': 'À compléter', 'r.play': 'Lire', 'r.playFrom': 'Lire à partir de {t}', 'r.publicVersion': 'Version publique',
  'r.readMore': 'Lire la suite', 'r.redirectedFrom': '(Redirigé depuis « {title} »)', 'r.references': 'Références',
  'r.resultsN': { one: '{n} résultat pour « {q} »', other: '{n} résultats pour « {q} »' }, 'r.scheme': 'Clair / sombre', 'r.search': 'Rechercher',
  'r.searchFor': 'Rechercher « {q} »', 'r.searchPh': 'Rechercher dans {site}', 'r.searchResults': 'Résultats de la recherche', 'r.secretVersion': 'Version secrète',
  'r.seeAlso': 'Voir aussi', 'r.show': 'Afficher :', 'r.skip': 'Aller au contenu',
  'r.special.all': 'Toutes les pages', 'r.special.recent': 'Modifications récentes', 'r.special.random': 'Page au hasard', 'r.special.search': 'Recherche',
  'r.special.categories': 'Catégories', 'r.special.unlock': 'Déverrouiller', 'r.special.links': 'Pages liées',
  'r.subpages': 'Sous-pages', 'r.tools': 'Outils', 'r.unlock': 'Ouvrir avec un mot de passe',
  'r.unlockHelp': 'Certaines pages de cette base de connaissances sont chiffrées. Saisissez un mot de passe pour ouvrir ce qu’il déverrouille. Le mot de passe ne quitte jamais ce navigateur.',
  'r.unlockTitle': 'Déverrouiller les pages secrètes', 'r.unlocking': 'Déverrouillage…', 'r.unlockingHelp': 'La clé est dérivée du mot de passe. Cela prend volontairement un instant.',
  'r.unlockWrong': 'Ce mot de passe n’ouvre rien ici.', 'r.unlockedN': { one: 'Déverrouillé : {n} élément', other: 'Déverrouillés : {n} éléments' }, 'r.unlockedList': 'Pages déverrouillées',
  'r.variants': 'Variantes', 'r.version': 'Version :', 'r.versionN': 'Version {n}', 'r.versions': 'Versions', 'r.whatLinksHere': 'Pages liées',
  'r.term': 'Terme', 'r.reading': 'Lecture', 'r.meaning': 'Sens', 'r.note': 'Remarque', 'r.top': 'Haut de page', 'r.close': 'Fermer', 'r.flip': 'Retourner la carte',
  'r.reveal': 'Révéler', 'r.searchAll': 'Rechercher « {q} » dans toutes les pages', 'r.noResults': 'Aucun résultat.', 'r.loading': 'Chargement…', 'r.prev': 'Précédent', 'r.next': 'Suivant',
  'r.sort': 'Trier selon cette colonne', 'r.secretPage': 'Page secrète',
};

const es = {
  'r.accessed': 'Consultado el', 'r.backTo': 'Volver a la cita', 'r.breadcrumbs': 'Ruta de navegación',
  'r.callout.note': 'Nota', 'r.callout.info': 'Información', 'r.callout.tip': 'Consejo', 'r.callout.warning': 'Advertencia', 'r.callout.stub': 'Este artículo es un esbozo',
  'r.callout.spoiler': 'Spoiler', 'r.callout.important': 'Importante',
  'r.categories': 'Categorías', 'r.categoryTitle': 'Categoría: {name}', 'r.contents': 'Contenido', 'r.enlarge': 'Ampliar imagen', 'r.from': 'De {site}',
  'r.goHome': 'Ir a la portada', 'r.goTo': 'Ir a la página:', 'r.hat.main': 'Artículo principal:', 'r.hat.see': 'Véase también:', 'r.hat.further': 'Más información:',
  'r.home': 'Portada', 'r.lastEdited': 'Última edición: {date}', 'r.layers': 'Capas', 'r.linksTo': 'Páginas que enlazan con «{title}»',
  'r.madeWith': 'Hecho con Knowledge Processor', 'r.menu': 'Menú', 'r.missingPage': '{title} (la página no existe)', 'r.more': 'Más',
  'r.navbox': 'Navegación', 'r.navigation': 'Navegación', 'r.noLinks': 'Ninguna página enlaza aquí.', 'r.noMedia': 'Falta el archivo multimedia',
  'r.noPages': 'Todavía no hay páginas.', 'r.notFound': 'Página no encontrada', 'r.notFoundText': 'No hay ninguna página «{page}» en esta base de conocimiento.',
  'r.notes': 'Notas', 'r.original': 'Original', 'r.pagesInCategory': { one: '{n} página en esta categoría', other: '{n} páginas en esta categoría' },
  'r.password': 'Contraseña', 'r.placeholder': 'Por completar', 'r.play': 'Reproducir', 'r.playFrom': 'Reproducir desde {t}', 'r.publicVersion': 'Versión pública',
  'r.readMore': 'Seguir leyendo', 'r.redirectedFrom': '(Redirigido desde «{title}»)', 'r.references': 'Referencias',
  'r.resultsN': { one: '{n} resultado para «{q}»', other: '{n} resultados para «{q}»' }, 'r.scheme': 'Claro / oscuro', 'r.search': 'Buscar',
  'r.searchFor': 'Buscar «{q}»', 'r.searchPh': 'Buscar en {site}', 'r.searchResults': 'Resultados de la búsqueda', 'r.secretVersion': 'Versión secreta',
  'r.seeAlso': 'Véase también', 'r.show': 'Mostrar:', 'r.skip': 'Ir al contenido',
  'r.special.all': 'Todas las páginas', 'r.special.recent': 'Cambios recientes', 'r.special.random': 'Página aleatoria', 'r.special.search': 'Búsqueda',
  'r.special.categories': 'Categorías', 'r.special.unlock': 'Desbloquear', 'r.special.links': 'Lo que enlaza aquí',
  'r.subpages': 'Subpáginas', 'r.tools': 'Herramientas', 'r.unlock': 'Abrir con contraseña',
  'r.unlockHelp': 'Algunas páginas de esta base de conocimiento están cifradas. Escriba una contraseña para abrir lo que desbloquea. La contraseña nunca sale de este navegador.',
  'r.unlockTitle': 'Desbloquear páginas secretas', 'r.unlocking': 'Desbloqueando…', 'r.unlockingHelp': 'La clave se deriva de la contraseña. Tarda un momento a propósito.',
  'r.unlockWrong': 'Esta contraseña no abre nada aquí.', 'r.unlockedN': { one: 'Desbloqueado: {n} elemento', other: 'Desbloqueados: {n} elementos' }, 'r.unlockedList': 'Páginas desbloqueadas',
  'r.variants': 'Variantes', 'r.version': 'Versión:', 'r.versionN': 'Versión {n}', 'r.versions': 'Versiones', 'r.whatLinksHere': 'Lo que enlaza aquí',
  'r.term': 'Término', 'r.reading': 'Lectura', 'r.meaning': 'Significado', 'r.note': 'Nota', 'r.top': 'Volver arriba', 'r.close': 'Cerrar', 'r.flip': 'Dar la vuelta a la tarjeta',
  'r.reveal': 'Mostrar', 'r.searchAll': 'Buscar «{q}» en todas las páginas', 'r.noResults': 'No se encontró nada.', 'r.loading': 'Cargando…', 'r.prev': 'Anterior', 'r.next': 'Siguiente',
  'r.sort': 'Ordenar por esta columna', 'r.secretPage': 'Página secreta',
};

const ka = {
  'r.accessed': 'გადამოწმდა', 'r.backTo': 'დაბრუნება მითითებასთან', 'r.breadcrumbs': 'ნავიგაციის ჯაჭვი',
  'r.callout.note': 'შენიშვნა', 'r.callout.info': 'ინფორმაცია', 'r.callout.tip': 'რჩევა', 'r.callout.warning': 'ყურადღება', 'r.callout.stub': 'ეს სტატია ნამზადია',
  'r.callout.spoiler': 'სპოილერი', 'r.callout.important': 'მნიშვნელოვანი',
  'r.categories': 'კატეგორიები', 'r.categoryTitle': 'კატეგორია: {name}', 'r.contents': 'სარჩევი', 'r.enlarge': 'სურათის გადიდება', 'r.from': 'მასალა {site}-დან',
  'r.goHome': 'მთავარ გვერდზე გადასვლა', 'r.goTo': 'გვერდზე გადასვლა:', 'r.hat.main': 'მთავარი სტატია:', 'r.hat.see': 'იხილეთ აგრეთვე:', 'r.hat.further': 'დაწვრილებით:',
  'r.home': 'მთავარი გვერდი', 'r.lastEdited': 'ბოლო ცვლილება: {date}', 'r.layers': 'ფენები', 'r.linksTo': 'გვერდები, რომლებიც „{title}“-ს უთითებს',
  'r.madeWith': 'შექმნილია Knowledge Processor-ით', 'r.menu': 'მენიუ', 'r.missingPage': '{title} (გვერდი არ არსებობს)', 'r.more': 'მეტი',
  'r.navbox': 'ნავიგაცია', 'r.navigation': 'ნავიგაცია', 'r.noLinks': 'აქ არცერთი გვერდი არ უთითებს.', 'r.noMedia': 'მედიაფაილი აკლია',
  'r.noPages': 'გვერდები ჯერ არ არის.', 'r.notFound': 'გვერდი ვერ მოიძებნა', 'r.notFoundText': 'ამ ცოდნის ბაზაში გვერდი „{page}“ არ არის.',
  'r.notes': 'შენიშვნები', 'r.original': 'ორიგინალი', 'r.pagesInCategory': { one: 'ამ კატეგორიაში {n} გვერდია', other: 'ამ კატეგორიაში {n} გვერდია' },
  'r.password': 'პაროლი', 'r.placeholder': 'შესავსებია', 'r.play': 'დაკვრა', 'r.playFrom': 'დაკვრა {t}-დან', 'r.publicVersion': 'საჯარო ვერსია',
  'r.readMore': 'სრულად წაკითხვა', 'r.redirectedFrom': '(გადამისამართდა „{title}“-დან)', 'r.references': 'წყაროები',
  'r.resultsN': { one: '„{q}“: {n} შედეგი', other: '„{q}“: {n} შედეგი' }, 'r.scheme': 'ნათელი / მუქი', 'r.search': 'ძიება',
  'r.searchFor': '„{q}“-ის ძიება', 'r.searchPh': 'ძიება: {site}', 'r.searchResults': 'ძიების შედეგები', 'r.secretVersion': 'საიდუმლო ვერსია',
  'r.seeAlso': 'იხილეთ აგრეთვე', 'r.show': 'ჩვენება:', 'r.skip': 'შიგთავსზე გადასვლა',
  'r.special.all': 'ყველა გვერდი', 'r.special.recent': 'ბოლო ცვლილებები', 'r.special.random': 'შემთხვევითი გვერდი', 'r.special.search': 'ძიება',
  'r.special.categories': 'კატეგორიები', 'r.special.unlock': 'გახსნა', 'r.special.links': 'ბმულები აქ',
  'r.subpages': 'ქვეგვერდები', 'r.tools': 'ხელსაწყოები', 'r.unlock': 'პაროლით გახსნა',
  'r.unlockHelp': 'ამ ცოდნის ბაზის ზოგი გვერდი დაშიფრულია. შეიყვანეთ პაროლი, რომ გახსნათ ის, რასაც იგი ხსნის. პაროლი ამ ბრაუზერს არ ტოვებს.',
  'r.unlockTitle': 'საიდუმლო გვერდების გახსნა', 'r.unlocking': 'იხსნება…', 'r.unlockingHelp': 'გასაღები პაროლიდან გამოიყვანება. ეს განზრახ ცოტა დროს მოითხოვს.',
  'r.unlockWrong': 'ეს პაროლი აქ არაფერს ხსნის.', 'r.unlockedN': { one: 'გაიხსნა: {n} ელემენტი', other: 'გაიხსნა: {n} ელემენტი' }, 'r.unlockedList': 'გახსნილი გვერდები',
  'r.variants': 'ვარიანტები', 'r.version': 'ვერსია:', 'r.versionN': 'ვერსია {n}', 'r.versions': 'ვერსიები', 'r.whatLinksHere': 'ბმულები აქ',
  'r.term': 'ტერმინი', 'r.reading': 'წაკითხვა', 'r.meaning': 'მნიშვნელობა', 'r.note': 'შენიშვნა', 'r.top': 'ზემოთ', 'r.close': 'დახურვა', 'r.flip': 'ბარათის გადაბრუნება',
  'r.reveal': 'ჩვენება', 'r.searchAll': '„{q}“-ის ძიება ყველა გვერდზე', 'r.noResults': 'ვერაფერი მოიძებნა.', 'r.loading': 'იტვირთება…', 'r.prev': 'წინა', 'r.next': 'შემდეგი',
  'r.sort': 'ამ სვეტით დალაგება', 'r.secretPage': 'საიდუმლო გვერდი',
};

// The strings of the portal blocks (../portal/strings.js) join every language.
// Reader keys override portal keys on collision (spread order): the reader owns its own vocabulary.
export const READER_STRINGS = Object.fromEntries(Object.entries({ en, ru, uk, de, fr, es, ka }).map(([l, d]) => [l, { ...PT_UI[l], ...d }]));

// Intl.PluralRules picks the CLDR category (Russian/Ukrainian need one/few/many; Georgian and English one/other);
// an engine without Intl falls back to 'other'. Unknown {vars} are left visible rather than blanked, so a missing
// argument shows up in testing. Output is plain text: callers escape it (esc/attr) at the HTML boundary.
// KNOWN DEFECT: the fallback chain uses the local `en` object, which lacks the merged portal keys; a 'pt.*' key
// missing from PT_UI[lang] renders as the raw key instead of English. Fix: fall back to READER_STRINGS.en[key].
export function readerT(lang) {
  const code = READER_LANGS.includes(lang) ? lang : 'en';
  const dict = READER_STRINGS[code];
  let pr = null;
  try { pr = new Intl.PluralRules(code); } catch { /* none */ }
  return (key, vars) => {
    let s = dict[key] ?? en[key] ?? key;
    if (s && typeof s === 'object') {
      const n = Number(vars && vars.n);
      const cat = Number.isFinite(n) && pr ? pr.select(n) : 'other';
      s = s[cat] ?? s.other;
    }
    if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
    return s;
  };
}
