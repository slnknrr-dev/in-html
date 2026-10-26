# Хранилища браузера

> Курс 37 из программы. Для тех, кто строит интерфейсы ([Интерфейс: состояние, отрисовка,
> диалоги](LEARN_JAVASCRIPT_UI_COURSE.md)) и хочет сохранять данные между перезагрузками правильно:
> знать, где что хранится, сколько места, кто может это прочитать и когда браузер всё сотрёт.

**Что вы будете понимать после курса**

- cookies: атрибуты (`Expires`, `Max-Age`, `Domain`, `Path`, `Secure`, `HttpOnly`, `SameSite`,
  `Partitioned`), лимиты размера и почему они едут с каждым запросом;
- `localStorage` и `sessionStorage`: синхронность, только строки, квота, событие `storage`, обёртки с
  `try/catch`;
- IndexedDB: базы, хранилища объектов, индексы, транзакции и их автозавершение;
- Cache API: хранение пар «запрос → ответ» для офлайна;
- что такое источник (origin), разделение хранилища (storage partitioning) и вытеснение (eviction);
- `navigator.storage.estimate()` и `persist()`;
- безопасность: почему секреты нельзя класть в `localStorage` и где хранить сессию.

---

## 1. Карта хранилищ

| Хранилище | Объём (порядок) | API | Доступ | Уходит на сервер | Срок жизни |
|---|---|---|---|---|---|
| Cookies | ~4 КБ на cookie, десятки на домен | строка `document.cookie`, `cookieStore` | JS (если не `HttpOnly`) и сервер | **да, с каждым запросом** | до `Expires`/`Max-Age` или конца сессии |
| `localStorage` | ~5 МБ на источник | синхронный, строки | JS одного источника | нет | бессрочно (до очистки/вытеснения) |
| `sessionStorage` | ~5 МБ | синхронный, строки | JS одного источника **и одной вкладки** | нет | пока жива вкладка |
| IndexedDB | сотни МБ — гигабайты | асинхронный, структурированные данные | JS одного источника, в т. ч. воркеры | нет | бессрочно (до вытеснения) |
| Cache API | общая квота с IndexedDB | асинхронный, `Request`/`Response` | JS и Service Worker | нет | бессрочно (до вытеснения) |
| OPFS (Origin Private File System) | общая квота | файлы, синхронный доступ в воркере | JS одного источника | нет | до вытеснения |

Ключевое понятие — **источник** (origin): схема + хост + порт. `https://a.example`, `http://a.example`
и `https://a.example:8443` — три разных источника с тремя раздельными `localStorage`. Cookies живут по
другим правилам: по домену и пути, без учёта порта (исторически).

Замечание к живым примерам: они выполняются во встроенном фрейме. В приватном режиме, при запрете
сторонних данных или в изолированном (sandbox) фрейме часть хранилищ может быть недоступна — примеры
это честно покажут ошибкой. Это не баг примера, а ровно та ситуация, к которой нужно готовить код.

## 2. Cookies

Cookie появились в Netscape в 1994 году как способ дать HTTP, у которого нет памяти, «состояние»:
сервер присылает заголовок, браузер возвращает его в каждом следующем запросе.

```http
Set-Cookie: sid=9f2a…; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1209600
```

```http
Cookie: sid=9f2a…; theme=dark
```

### 2.1. Атрибуты

| Атрибут | Смысл | По умолчанию |
|---|---|---|
| `Expires=<дата>` / `Max-Age=<сек>` | срок; `Max-Age` приоритетнее; `Max-Age=0` удаляет | нет → **сессионная** cookie (до закрытия браузера; «восстановление сессии» может её сохранить) |
| `Domain=example.com` | отправлять и на поддомены | нет → только точный хост, **без** поддоменов |
| `Path=/app` | только для путей с этим префиксом | каталог текущего URL |
| `Secure` | только по HTTPS (и `localhost`) | нет |
| `HttpOnly` | недоступна из JavaScript (`document.cookie`) | нет |
| `SameSite=Strict\|Lax\|None` | отправлять ли в межсайтовых запросах | `Lax` в Chrome и Edge (с 2020), в Firefox и Safari фактическое поведение иное |
| `Partitioned` | CHIPS: отдельная копия для каждого сайта верхнего уровня | нет |

Тонкости:

- Указанный `Domain` **расширяет** область, а не сужает. Для максимальной изоляции его не пишут.
- `Path` — не мера безопасности: страница на `/` может прочитать cookie пути `/admin` через фрейм того
  же источника.
- Префиксы имён: `__Host-sid` браузер примет только с `Secure`, `Path=/` и **без** `Domain`; `__Secure-`
  требует `Secure`. Это защита от подмены cookie с поддомена или по HTTP.
- `SameSite=None` обязан идти с `Secure`, иначе cookie отвергается.

### 2.2. SameSite и «сайт»

`SameSite` оперирует не источником, а **сайтом** (site): схема + регистрируемый домен (eTLD+1 по списку
публичных суффиксов). `a.example.com` и `b.example.com` — один сайт, но разные источники. А
`user1.github.io` и `user2.github.io` — разные сайты, потому что `github.io` в списке публичных
суффиксов.

| Значение | Межсайтовый переход по ссылке (верхний уровень, GET) | Межсайтовый `fetch`, `<img>`, фрейм, POST-форма |
|---|---|---|
| `Strict` | не отправляется | не отправляется |
| `Lax` | отправляется | не отправляется |
| `None` (+ `Secure`) | отправляется | отправляется (если браузер не блокирует сторонние cookie) |

`Lax` — главная защита от CSRF (подделки межсайтовых запросов): чужой сайт не может отправить POST-форму
на ваш сервер с вашей сессией. `Strict` строже, но ломает удобство: перешли по ссылке из письма —
и вы «не вошли» на первой странице.

### 2.3. `document.cookie` — странный API

```js
document.cookie = 'theme=dark; Max-Age=31536000; Path=/; SameSite=Lax';  // добавляет ОДНУ cookie
document.cookie;  // "theme=dark; lang=ru" — только имена и значения, без атрибутов
document.cookie = 'theme=; Max-Age=0; Path=/';  // удаление: совпасть по имени, Path и Domain
```

Присваивание не заменяет строку целиком, а устанавливает одну cookie. Значения нужно кодировать
(`encodeURIComponent`): `;`, `,` и пробелы ломают разбор. Чтение — синхронный разбор строки.

Современная альтернатива — асинхронный `cookieStore` (`await cookieStore.get('theme')`, событие
`change`). Есть в Chromium давно, в Safari и Firefox появился позже — проверяйте наличие.

### 2.4. Размер и цена

Лимит — около 4096 байт на cookie (имя + значение), и браузеры гарантируют не меньше 50 cookie на домен
(RFC 6265 требует минимум 20 на домен и 3000 всего). Но главная цена — **трафик**: все подходящие
cookie уходят в **каждом** запросе, включая картинки и стили. 2 КБ cookie × 100 запросов на странице
= 200 КБ лишнего исходящего трафика. Поэтому статику раздают с отдельного домена без cookie, а данные
для интерфейса хранят не в cookie.

<details>
<summary>Cookie из JavaScript: что видно и что нет</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-storage.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  button { margin: 2px; }
  pre { background: #f5f5f5; padding: 8px; border-left: 4px solid #e65100; white-space: pre-wrap; }
</style>
</head>
<body>
<button id="set">Установить theme=тёмная</button>
<button id="set2">Установить lang=ru</button>
<button id="del">Удалить theme</button>
<pre id="out"></pre>
<script>
  const out = document.getElementById('out');
  function show(note) {
    let parsed;
    try {
      parsed = Object.fromEntries(document.cookie.split('; ').filter(Boolean).map(p => {
        const i = p.indexOf('=');
        return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
      }));
    } catch (e) { parsed = 'cookie недоступны: ' + e.message; }
    out.textContent = (note || '') + '\ndocument.cookie = ' + JSON.stringify(document.cookie) +
      '\nразобрано: ' + JSON.stringify(parsed) +
      '\n\nАтрибуты (Max-Age, SameSite) прочитать нельзя: браузер их не возвращает.';
  }
  document.getElementById('set').onclick = () => {
    document.cookie = 'theme=' + encodeURIComponent('тёмная') + '; Max-Age=3600; Path=/; SameSite=Lax';
    show('установлено');
  };
  document.getElementById('set2').onclick = () => { document.cookie = 'lang=ru; Max-Age=3600; Path=/'; show('установлено'); };
  document.getElementById('del').onclick = () => { document.cookie = 'theme=; Max-Age=0; Path=/'; show('удалено'); };
  show();
</script>
</body>
</html>
```

</details>

## 3. Web Storage: `localStorage` и `sessionStorage`

```js
localStorage.setItem('theme', 'dark');
localStorage.getItem('theme');      // 'dark'; отсутствующий ключ → null
localStorage.removeItem('theme');
localStorage.clear();
localStorage.length; localStorage.key(0);
```

### 3.1. Пять свойств, которые нужно помнить

1. **Синхронность.** Каждый вызов блокирует главный поток. Браузер подгружает данные источника с диска
   при первом обращении — на медленном диске это заметно. Не храните там мегабайты и не читайте в
   цикле при прокрутке.
2. **Только строки.** `setItem('n', 5)` сохранит `"5"`, объект — `"[object Object]"`. Для структур —
   `JSON.stringify`/`JSON.parse` (и помните, что JSON теряет `Date`, `Map`, `undefined`).
3. **Квота** около 5 МБ на источник (символы UTF-16, то есть фактически ~5 млн символов в Chrome). При
   превышении `setItem` бросает `QuotaExceededError`.
4. **Может не существовать или бросать.** Обращение к `localStorage` бросает `SecurityError`, если
   пользователь запретил данные сайтов, или во фрейме с запретом сторонних данных. Старый Safari в
   приватном режиме давал квоту 0 — любой `setItem` бросал. Поэтому — только через `try/catch`.
5. **Видно всем скриптам источника.** Любой скрипт на странице (включая сторонние и внедрённые через
   XSS) читает всё содержимое.

`sessionStorage` отличается областью: он привязан к **вкладке** (точнее, к контексту верхнего уровня) и
источнику. Перезагрузка и навигация внутри вкладки его сохраняют; новая вкладка получает пустой (а при
«Открыть в новой вкладке» / `window.open` браузеры **копируют** текущий — отдельная копия, не общая).
Закрыли вкладку — данные исчезли (если вкладку не восстановили).

### 3.2. Обёртка, как в `ui/dom.js`

```js
function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }          // нет доступа или испорченный JSON
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }               // квота или запрет — приложение продолжает работать
}
```

Ещё два правила профессионального использования:

- **Префикс ключей** (`myapp:theme`): на одном источнике могут жить несколько приложений (как в этом
  репозитории — десятки приложений на одном домене).
- **Версия схемы** (`myapp:v2:settings` или поле `version` в объекте): после обновления приложения
  старые данные должны либо мигрироваться, либо отбрасываться, но не ломать запуск.

### 3.3. Событие `storage`

Когда другая вкладка того же источника меняет `localStorage`, во **всех остальных** вкладках
срабатывает `window` событие `storage` с `key`, `oldValue`, `newValue`, `storageArea`. В самой вкладке,
которая сделала изменение, оно **не** приходит. Это дешёвый способ синхронизировать тему или выход из
аккаунта между вкладками. Для произвольных сообщений лучше `BroadcastChannel`.

<details>
<summary>Черновик в sessionStorage, настройки в localStorage</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-storage.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  textarea { width: 300px; height: 70px; display: block; margin: 6px 0; }
  body.dark { background: #222; color: #eee; }
  output { display: block; font: 12px ui-monospace, monospace; color: #888; }
</style>
</head>
<body>
<label><input type="checkbox" id="dark"> тёмная тема (localStorage, переживёт закрытие вкладки)</label>
<textarea id="draft" placeholder="черновик (sessionStorage, живёт в этой вкладке)"></textarea>
<p>Напечатайте что-нибудь, включите тему и перезагрузите пример. Событие storage придёт, если
открыть этот пример во второй вкладке и переключить тему там.</p>
<output id="out"></output>
<script>
  const get = (area, k, d) => { try { const v = area.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const set = (area, k, v) => { try { area.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const out = document.getElementById('out');
  const dark = document.getElementById('dark'), draft = document.getElementById('draft');
  let L, S;
  try { L = localStorage; S = sessionStorage; } catch (e) { out.textContent = 'Хранилище недоступно: ' + e.name; }
  if (L) {
    dark.checked = get(L, 'demo:v1:dark', false);
    document.body.classList.toggle('dark', dark.checked);
    draft.value = get(S, 'demo:v1:draft', '');
    dark.onchange = () => { set(L, 'demo:v1:dark', dark.checked); document.body.classList.toggle('dark', dark.checked); };
    draft.oninput = () => { out.textContent = set(S, 'demo:v1:draft', draft.value) ? 'черновик сохранён' : 'не удалось сохранить'; };
    addEventListener('storage', (e) => {
      if (e.key !== 'demo:v1:dark') return;
      out.textContent = 'storage из другой вкладки: ' + e.oldValue + ' → ' + e.newValue;
      dark.checked = JSON.parse(e.newValue || 'false');
      document.body.classList.toggle('dark', dark.checked);
    });
  }
</script>
</body>
</html>
```

</details>

<details>
<summary>localStorage: строки, JSON, квота и try/catch</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-storage.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  button { margin: 2px; }
  pre { background: #f5f5f5; padding: 8px; border-left: 4px solid #1565c0; white-space: pre-wrap; }
</style>
</head>
<body>
<button id="num">setItem('demo:n', 5)</button>
<button id="obj">setItem объекта без JSON</button>
<button id="json">через JSON</button>
<button id="fill">Заполнить до квоты</button>
<button id="clr">Очистить demo:*</button>
<pre id="out"></pre>
<script>
  const out = document.getElementById('out');
  const say = (s) => out.textContent = s;
  function safe(fn) {
    try { return fn(); }
    catch (e) { say('Ошибка: ' + e.name + ' — ' + e.message + '\nПриложение должно продолжить работу без хранилища.'); }
  }
  document.getElementById('num').onclick = () => safe(() => {
    localStorage.setItem('demo:n', 5);
    const v = localStorage.getItem('demo:n');
    say('getItem вернул ' + JSON.stringify(v) + ' типа ' + typeof v + '; v + 1 = ' + (v + 1));
  });
  document.getElementById('obj').onclick = () => safe(() => {
    localStorage.setItem('demo:o', { a: 1 });
    say('сохранилось: ' + localStorage.getItem('demo:o'));
  });
  document.getElementById('json').onclick = () => safe(() => {
    localStorage.setItem('demo:o', JSON.stringify({ a: 1, when: new Date() }));
    const back = JSON.parse(localStorage.getItem('demo:o'));
    say('строка: ' + localStorage.getItem('demo:o') + '\ntypeof back.when = ' + typeof back.when + ' (Date стал строкой)');
  });
  document.getElementById('fill').onclick = () => safe(() => {
    const chunk = 'x'.repeat(512 * 1024);
    let i = 0;
    try { for (; i < 40; i++) localStorage.setItem('demo:big' + i, chunk); }
    catch (e) { say('Упёрлись в квоту после ' + (i / 2) + ' млн символов: ' + e.name); return; }
    say('Квота не достигнута за 20 млн символов');
  });
  document.getElementById('clr').onclick = () => safe(() => {
    Object.keys(localStorage).filter(k => k.startsWith('demo:')).forEach(k => localStorage.removeItem(k));
    say('Ключи demo:* удалены');
  });
  safe(() => say('Ключей в localStorage этого источника: ' + localStorage.length));
</script>
</body>
</html>
```

</details>

После опыта с квотой нажмите «Очистить» — иначе данные останутся на диске.

## 4. IndexedDB

IndexedDB — транзакционная база «ключ → значение» внутри браузера. Значения — любые данные,
поддерживаемые **структурированным клонированием** (structured clone): объекты, массивы, `Date`,
`Map`, `Set`, `Blob`, `File`, `ArrayBuffer`, типизированные массивы. Не сохраняются функции, DOM-узлы и
экземпляры классов (прототип теряется).

### 4.1. Понятия

| Понятие | Аналог в SQL | Комментарий |
|---|---|---|
| база (database) | база | имя + целочисленная **версия** |
| хранилище объектов (object store) | таблица | создаётся только в `upgradeneeded` |
| ключ (key) | первичный ключ | `keyPath` (поле объекта) или внешний; `autoIncrement` |
| индекс (index) | индекс | поиск по другому полю, `unique`, `multiEntry` для массивов |
| транзакция (transaction) | транзакция | `readonly` / `readwrite` / `versionchange` |
| курсор (cursor) | курсор | обход по ключу или индексу, с диапазоном `IDBKeyRange` |

### 4.2. Открытие и схема

```js
const req = indexedDB.open('notes-db', 2);
req.onupgradeneeded = (e) => {           // первый запуск или версия выросла
  const db = req.result;
  if (e.oldVersion < 1) db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
  if (e.oldVersion < 2) req.transaction.objectStore('notes').createIndex('byTag', 'tags', { multiEntry: true });
};
req.onsuccess = () => { const db = req.result; /* работа */ };
req.onerror = () => console.error(req.error);
req.onblocked = () => alert('Закройте другие вкладки приложения для обновления');
```

Миграции пишут **по шагам** `oldVersion < N`, чтобы пользователь с версией 1 прошёл и шаг 2, а новый —
оба. Если другая вкладка держит старую версию открытой, новая получит `blocked`; старая получает
`versionchange` и должна вызвать `db.close()`.

### 4.3. Транзакции и автозавершение

Главная особенность IndexedDB, которая удивляет всех: **транзакция завершается автоматически**, как
только у неё не осталось ожидающих запросов и управление вернулось в цикл событий. Поэтому нельзя
«подождать что-то постороннее» посреди транзакции:

```js
const tx = db.transaction('notes', 'readwrite');
const store = tx.objectStore('notes');
store.put({ text: 'a' });
await fetch('/x');                       // ← транзакция уже завершилась!
store.put({ text: 'b' });                // TransactionInactiveError
```

Правила:

- Сначала соберите все данные (сеть, вычисления), потом откройте транзакцию и выполните запросы
  подряд.
- Успех **записи** гарантирован только по событию `complete` транзакции, а не по `success` отдельного
  запроса: ошибка в любом запросе откатывает всю транзакцию (`abort`).
- Транзакции `readonly` над одними хранилищами идут параллельно; `readwrite` с пересекающейся областью
  — по очереди.
- По умолчанию `durability` может быть `'relaxed'` (Chrome ускорил так запись с 2021 года):
  `complete` приходит до сброса на диск. Для критичных данных — `db.transaction(s, 'readwrite',
  { durability: 'strict' })`.

### 4.4. Обёртка на промисах

Событийный API многословен. Минимальная обёртка:

```js
const promisify = (req) => new Promise((ok, fail) => {
  req.onsuccess = () => ok(req.result);
  req.onerror = () => fail(req.error);
});
const done = (tx) => new Promise((ok, fail) => {
  tx.oncomplete = () => ok();
  tx.onerror = tx.onabort = () => fail(tx.error);
});
```

`await` **промиса, разрешённого в обработчике запроса**, транзакцию не убивает: продолжение выполнится
микрозадачей до возврата в цикл событий (во всех современных браузерах). Убивает только ожидание
чего-то внешнего. Готовая обёртка такого рода — небольшая библиотека `idb` Джейка Арчибальда.

<details>
<summary>IndexedDB: заметки с индексом по тегам</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-storage.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  form { display: flex; gap: 6px; flex-wrap: wrap; }
  li { padding: 3px; } .tag { background: #e3f2fd; border-radius: 4px; padding: 0 4px; margin-left: 4px; font-size: 12px; }
  output { display: block; font: 12px ui-monospace, monospace; color: #555; margin-top: 6px; white-space: pre-wrap; }
</style>
</head>
<body>
<form id="f"><input name="text" placeholder="текст" required> <input name="tags" placeholder="теги через запятую"> <button>Сохранить</button></form>
<p>Фильтр по тегу: <input id="tag" placeholder="например, дом"> <button id="clear">Удалить базу</button></p>
<ul id="list"></ul>
<output id="log"></output>
<script>
  const log = (s) => document.getElementById('log').textContent = s;
  const P = (req) => new Promise((ok, fail) => { req.onsuccess = () => ok(req.result); req.onerror = () => fail(req.error); });
  const done = (tx) => new Promise((ok, fail) => { tx.oncomplete = ok; tx.onerror = tx.onabort = () => fail(tx.error); });
  let db;
  async function open() {
    const req = indexedDB.open('course-demo-notes', 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
      store.createIndex('byTag', 'tags', { multiEntry: true });
    };
    db = await P(req);
    db.onversionchange = () => db.close();
  }
  async function show() {
    const tag = document.getElementById('tag').value.trim();
    const store = db.transaction('notes').objectStore('notes');
    const rows = tag ? await P(store.index('byTag').getAll(tag)) : await P(store.getAll());
    document.getElementById('list').replaceChildren(...rows.map(n => {
      const li = document.createElement('li');
      li.textContent = '#' + n.id + ' ' + n.text + ' (' + n.created.toLocaleTimeString() + ')';
      for (const t of n.tags) { const s = document.createElement('span'); s.className = 'tag'; s.textContent = t; li.append(s); }
      return li;
    }));
    log('Записей: ' + rows.length + '. created хранится как Date, а не строка: ' + (rows[0] ? rows[0].created instanceof Date : '—'));
  }
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const note = { text: fd.get('text'), tags: fd.get('tags').split(',').map(s => s.trim()).filter(Boolean), created: new Date() };
    const tx = db.transaction('notes', 'readwrite');
    tx.objectStore('notes').add(note);
    await done(tx);
    e.target.reset();
    show();
  };
  document.getElementById('tag').oninput = show;
  document.getElementById('clear').onclick = async () => {
    db.close();
    await P(indexedDB.deleteDatabase('course-demo-notes'));
    await open(); show();
  };
  open().then(show).catch(e => log('IndexedDB недоступна: ' + e.name + ' — ' + e.message));
</script>
</body>
</html>
```

</details>

Перезагрузите страницу примера — заметки останутся. Поле `tags` — массив, и индекс с `multiEntry`
находит запись по любому из тегов.

## 5. Cache API

`caches` хранит пары **`Request` → `Response`** — настоящие HTTP-ответы с заголовками и телом. Создан для
Service Worker (офлайн-режим), но доступен и со страницы.

```js
const cache = await caches.open('static-v3');
await cache.addAll(['/', '/app.css', '/app.js']);   // скачать и положить (всё или ничего)
const hit = await cache.match('/app.css');          // Response или undefined
await cache.put(request, response.clone());         // тело Response читается один раз — клонируйте
await caches.delete('static-v2');                   // уборка старой версии
```

Отличия от HTTP-кэша браузера:

| | HTTP-кэш | Cache API |
|---|---|---|
| Кто управляет | браузер по заголовкам `Cache-Control` | ваш код |
| Срок | `max-age`, `ETag`, эвристики | пока не удалите (или не вытеснят) |
| Видимость | невидим для JS | полный перечень ключей |
| Офлайн | нет гарантий | да, через Service Worker |

Тонкость: `cache.match` по умолчанию учитывает строку запроса и заголовок `Vary`; опции
`ignoreSearch`, `ignoreVary` это меняют. Ответы со сторонних источников без CORS (`opaque`) можно
положить, но их размер браузер учитывает с большим запасом (в Chrome — порядка 7 МБ за штуку), чтобы
не раскрывать реальный размер.

Стратегии офлайна (cache-first, network-first, stale-while-revalidate) — тема Service Worker; базовые
приёмы см. в [Производительность JavaScript в браузере](LEARN_JAVASCRIPT_PERFORMANCE_COURSE.md).

<details>
<summary>Cache API: положить ответ и прочитать</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-storage.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  pre { background: #f5f5f5; padding: 8px; border-left: 4px solid #2e7d32; white-space: pre-wrap; }
</style>
</head>
<body>
<button id="put">Положить синтетический ответ</button>
<button id="get">Прочитать</button>
<button id="keys">Список ключей</button>
<button id="del">Удалить кэш</button>
<pre id="out"></pre>
<script>
  const out = document.getElementById('out');
  const NAME = 'course-demo-v1', URL_ = '/__demo/greeting.json';
  async function run(fn) {
    if (!('caches' in self)) { out.textContent = 'Cache API недоступен (нужен безопасный контекст: https или localhost).'; return; }
    try { await fn(); } catch (e) { out.textContent = 'Ошибка: ' + e.name + ' — ' + e.message; }
  }
  document.getElementById('put').onclick = () => run(async () => {
    const cache = await caches.open(NAME);
    const res = new Response(JSON.stringify({ hello: 'мир', at: new Date().toISOString() }), {
      headers: { 'Content-Type': 'application/json', 'X-Demo': 'yes' },
    });
    await cache.put(new Request(URL_, { mode: 'same-origin' }), res);
    out.textContent = 'Положено под ключом ' + URL_;
  });
  document.getElementById('get').onclick = () => run(async () => {
    const hit = await caches.match(URL_, { cacheName: NAME });
    out.textContent = hit
      ? 'status ' + hit.status + ', X-Demo: ' + hit.headers.get('X-Demo') + '\nтело: ' + await hit.text()
      : 'Промах: такого ключа нет';
  });
  document.getElementById('keys').onclick = () => run(async () => {
    const cache = await caches.open(NAME);
    out.textContent = 'Кэши: ' + (await caches.keys()).join(', ') + '\nКлючи: ' + (await cache.keys()).map(r => r.url).join('\n');
  });
  document.getElementById('del').onclick = () => run(async () => {
    out.textContent = 'Удалён: ' + await caches.delete(NAME);
  });
</script>
</body>
</html>
```

</details>

## 6. Квоты, вытеснение и `navigator.storage`

IndexedDB, Cache API, OPFS и (в части браузеров) Service Worker делят **одну квоту источника**. Её
размер зависит от браузера и свободного места на диске:

- Chrome: источник может занять до ~60 % размера диска, общий пул браузера — до ~80 %.
- Firefox: до 10 % диска или 10 ГБ для «лучшее усилие» (best-effort) хранилища на группу сайтов; до
  50 % диска для постоянного.
- Safari: около 1 ГБ на источник с запросом на большее, и, главное, — см. ниже про ITP.

Числа меняются от версии к версии; полагайтесь не на них, а на API:

```js
const { usage, quota } = await navigator.storage.estimate();   // байты, приблизительно
const persisted = await navigator.storage.persisted();          // уже постоянное?
const granted = await navigator.storage.persist();              // попросить постоянное
```

### 6.1. Режимы: best-effort и persistent

По умолчанию хранилище источника — **best-effort**: при нехватке места браузер вытесняет (evicts)
данные **целого источника** целиком (никогда частично), начиная с давно не посещавшихся (LRU).
`localStorage` в Chrome и Firefox относится к той же системе вытеснения.

**Persistent** хранилище не вытесняется автоматически — только по воле пользователя. Как браузеры
решают на `persist()`:

- Chrome одобряет без диалога по эвристике: сайт добавлен в закладки, установлен как приложение
  (PWA), у него есть разрешение на уведомления, высокая вовлечённость;
- Firefox показывает пользователю запрос;
- Safari поддерживает API с версии 17 и решает по своей эвристике.

### 6.2. Safari и семидневное правило

Intelligent Tracking Prevention в Safari (с 2020 года) удаляет **всё** хранилище, записываемое скриптом
(localStorage, IndexedDB, Cache API, cookies из `document.cookie`), у сайта, с которым пользователь не
взаимодействовал 7 дней использования браузера. Исключение — веб-приложения, добавленные на главный
экран. Вывод: клиентское хранилище — **кэш**, а не основное место хранения. Важное должно иметь копию
на сервере или экспорт в файл.

<details>
<summary>Сколько места и постоянно ли оно</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-storage.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  .bar { height: 18px; background: #eee; border: 1px solid #999; width: 320px; }
  .bar div { height: 100%; background: #6a1b9a; min-width: 2px; }
  pre { font: 13px ui-monospace, monospace; white-space: pre-wrap; }
</style>
</head>
<body>
<button id="est">Оценить</button> <button id="per">Попросить persist()</button>
<div class="bar"><div id="fill" style="width:0"></div></div>
<pre id="out"></pre>
<script>
  const out = document.getElementById('out');
  const mb = (b) => (b / 1048576).toFixed(2) + ' МБ';
  async function estimate() {
    if (!navigator.storage || !navigator.storage.estimate) { out.textContent = 'StorageManager недоступен (нужен безопасный контекст)'; return; }
    try {
      const { usage, quota, usageDetails } = await navigator.storage.estimate();
      document.getElementById('fill').style.width = Math.max(0.5, usage / quota * 100) + '%';
      out.textContent = 'занято: ' + mb(usage) + '\nквота: ' + mb(quota) +
        (usageDetails ? '\nпо типам (только Chromium): ' + JSON.stringify(usageDetails) : '') +
        '\npersisted: ' + (navigator.storage.persisted ? await navigator.storage.persisted() : 'неизвестно');
    } catch (e) { out.textContent = 'Ошибка: ' + e.name + ' — ' + e.message; }
  }
  document.getElementById('est').onclick = estimate;
  document.getElementById('per').onclick = async () => {
    try {
      const ok = await navigator.storage.persist();
      out.textContent = 'persist() вернул ' + ok + (ok ? '' : ' — браузер отказал (эвристика или фрейм)');
    } catch (e) { out.textContent = 'Ошибка: ' + e.message; }
  };
  estimate();
</script>
</body>
</html>
```

</details>

Квоты намеренно неточны: браузер добавляет «шум» и округляет, чтобы `estimate()` нельзя было
использовать для слежки (определения приватного режима или отпечатка устройства).

## 7. Разделение хранилища (storage partitioning)

Раньше `localStorage` источника `https://widget.example` был **один** — и когда виджет встроен во фрейм
на сайте A, и на сайте B. Так работало межсайтовое отслеживание: фрейм записал идентификатор на сайте
A, прочитал на B.

Теперь хранилище фрейма делится по ключу **(сайт верхнего уровня, источник фрейма)**:

- Firefox (Total Cookie Protection, по умолчанию с 2022 года), Safari (давно, по частям) и Chrome
  (разделение хранилища и Cache API с версии 115, 2023) разделяют `localStorage`, IndexedDB, Cache API,
  `BroadcastChannel`, Service Worker во встроенных фреймах.
- Сторонние cookie: Safari и Firefox блокируют/разделяют их по умолчанию. Для легитимных сценариев
  (чат-виджет со своей сессией) есть атрибут `Partitioned` (CHIPS) — cookie хранится отдельно для
  каждого сайта верхнего уровня. Доступ к **неразделённым** данным фрейм может запросить через
  `document.requestStorageAccess()` (Storage Access API), нужен жест пользователя.

Практические следствия: виджет на чужих сайтах не может рассчитывать, что пользователь «уже вошёл» во
фрейме; данные, сохранённые на сайте A, не видны на сайте B; а встроенный во фрейм пример курса пишет
не в то же хранилище, что открытая отдельно страница.

## 8. Безопасность

### 8.1. Никогда не храните секреты в `localStorage`

Токен доступа, refresh-токен, пароль, ключ API — всё, что даёт права. Причина: **любой** JavaScript
на источнике читает `localStorage` одной строкой. Одна XSS-уязвимость (или скомпрометированный
сторонний скрипт аналитики) — и токен улетает на чужой сервер, где действует до истечения срока, даже
после закрытия вкладки.

| Где хранить сессию | XSS может украсть? | CSRF? | Комментарий |
|---|---|---|---|
| `localStorage` / `sessionStorage` | **да**, целиком | нет | токен живёт вне вашего контроля |
| переменная в памяти JS | да, пока страница открыта | нет | пропадает при перезагрузке |
| cookie `HttpOnly; Secure; SameSite=Lax` (`__Host-` префикс) | **нет** (украсть нельзя, только действовать изнутри страницы) | закрыто `SameSite` + проверка `Origin` | рекомендуемый вариант |
| IndexedDB | да | нет | то же, что `localStorage` |

Важно понимать границу: `HttpOnly` не делает XSS безвредным — внедрённый скрипт может делать запросы
от имени пользователя, пока открыта страница. Но он не может **унести** сессию и пользоваться ей
потом. Защита от XSS — экранирование и CSP ([Интерфейс](LEARN_JAVASCRIPT_UI_COURSE.md), помощник
`h()`).

### 8.2. Что ещё

- Данные в хранилище **видны пользователю** и легко правятся в инструментах разработчика. Не храните
  там «права» (`isAdmin: true`), цены для оформления заказа и т. п. — сервер должен проверять всё.
- Данные лежат на диске **в открытом виде**. Общий компьютер — общий доступ. Персональные данные
  храните минимально и удаляйте при выходе (`Clear-Site-Data: "storage"` в ответе на выход очищает
  всё хранилище источника).
- Шифрование на клиенте через Web Crypto имеет смысл, только если ключ не лежит рядом (например,
  выводится из пароля пользователя). Неизвлекаемый `CryptoKey` можно хранить в IndexedDB — сам ключ
  JavaScript не прочитает, но сможет им пользоваться.
- Значения из хранилища — **ненадёжный ввод**. `innerHTML = localStorage.getItem('name')` превращает
  одну временную XSS в постоянную.

## 9. Как выбрать

| Задача | Выбор |
|---|---|
| сессия, вход | cookie `HttpOnly; Secure; SameSite=Lax`, имя с `__Host-` |
| тема, язык, свёрнутые панели | `localStorage` через обёртку с `try/catch` |
| черновик формы в рамках вкладки | `sessionStorage` |
| много записей, поиск, файлы, офлайн-данные | IndexedDB |
| офлайн-копия страниц и ресурсов | Cache API + Service Worker |
| большие бинарные файлы, базы SQLite в WASM | OPFS |
| синхронизация вкладок | событие `storage` или `BroadcastChannel` |

И общее правило: клиентское хранилище может исчезнуть в любой момент (очистка, вытеснение, ITP,
приватный режим). Код должен стартовать с пустым хранилищем без ошибок.

## Итог

- Хранилища привязаны к **источнику**; cookies — к домену и пути, а `SameSite` оперирует **сайтом**.
- Cookies едут с каждым запросом: держите их маленькими, сессию — в `HttpOnly; Secure; SameSite`.
- `localStorage` синхронен, хранит строки, ~5 МБ, может бросать — только через `try/catch` и с
  префиксом ключей.
- IndexedDB — структурированные данные, версии и миграции в `upgradeneeded`, транзакции
  автозавершаются, надёжность — по `complete`.
- Cache API хранит `Request → Response` под вашим управлением; основа офлайна.
- Квота общая, best-effort данные вытесняются целым источником; `estimate()` и `persist()` дают
  контроль; Safari стирает данные через 7 дней без взаимодействия.
- Во фреймах хранилище разделено по сайту верхнего уровня.
- Секреты — никогда в `localStorage`; данные из хранилища — ненадёжный ввод.

## Проверьте себя

1. Почему `https://a.example.com` не видит `localStorage` страницы `https://b.example.com`, но получает
   cookie с `Domain=example.com`?
2. Чем отличаются `SameSite=Lax` и `Strict` для перехода по ссылке из письма?
3. Что вернёт `localStorage.getItem('n')` после `setItem('n', 5)` и чему будет равно значение `+ 1`?
4. Почему внутри транзакции IndexedDB нельзя ждать ответа `fetch`?
5. Сайт хранит черновики только в IndexedDB. Что может случиться с ними в Safari и что с этим делать?
6. Почему cookie `HttpOnly` защищает сессию лучше, чем токен в `localStorage`, хотя не отменяет вреда
   от XSS?

Дальше: [Производительность JavaScript в браузере](LEARN_JAVASCRIPT_PERFORMANCE_COURSE.md).
