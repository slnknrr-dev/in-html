# Введение: как скрипт попадает на страницу

> Курс 32 из программы. Для тех, кто уже понимает дерево документа, каскад и раскладку и теперь
> хочет управлять страницей из JavaScript. Синтаксис языка здесь не объясняется — мы говорим о том,
> **где и когда** код выполняется, что он видит и что ему мешает.

**Что вы будете понимать после курса**

- как парсер HTML встречает `<script>` и почему обычный скрипт останавливает построение дерева;
- чем отличаются `defer`, `async`, `type="module"` и встроенный (inline) скрипт и в каком порядке они выполняются;
- что такое `document.currentScript` и почему у модулей его нет;
- что меняет строгий режим (strict mode) и почему модули всегда строгие;
- что такое глобальный объект, откуда в `window` берутся переменные с именами ваших `id`;
- как устроен цикл событий (event loop): задачи, микрозадачи, шаги отрисовки, `requestAnimationFrame`;
- где искать ошибки и как политика безопасности содержимого (Content Security Policy, CSP) запрещает скрипты.

---

## 1. Скрипт глазами парсера

Вспомним [Документ HTML](LEARN_HTML_DOCUMENT_COURSE.md): парсер идёт по байтам сверху вниз и строит
дерево. Элемент `<script>` для него особый. Скрипт может вызвать `document.write()` и вставить новую
разметку **прямо в поток парсера** — в то место, где парсер сейчас стоит. Поэтому, встретив обычный
(классический, classic) скрипт без атрибутов, парсер обязан:

1. остановиться (такой скрипт называется **блокирующим парсер**, parser-blocking);
2. если скрипт внешний — скачать его;
3. дождаться, пока загрузятся таблицы стилей выше по документу (скрипт может спросить
   `getComputedStyle`, и ответ должен быть честным);
4. выполнить его;
5. продолжить разбор.

Отсюда первое следствие: **скрипт видит только ту часть дерева, которая построена до него**.

<details>
<summary>Скрипт видит только то, что выше</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-introduction.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.5 system-ui, sans-serif; }
  pre { background: #f3f3f3; padding: 8px; border-left: 4px solid #c33; }
</style>
<script>
  // Здесь body ещё не построен
  var early = document.body;
</script>
</head>
<body>
  <p id="first">Первый абзац</p>
  <script>
    var a = document.getElementById('first');
    var b = document.getElementById('second');
    document.write('<pre>в head: document.body = ' + early +
      '\nпервый: ' + a + '\nвторой: ' + b + '</pre>');
  </script>
  <p id="second">Второй абзац — появится после скрипта</p>
</body>
</html>
```

</details>

`document.body` в `<head>` равен `null`, второй абзац ещё не существует. И обратите внимание, где
появился `<pre>`: `document.write` вставил его между абзацами, ровно в позицию парсера.

> `document.write` — исторический механизм, ради которого вся эта блокировка и существует. В новом
> коде он не нужен. Вызов после загрузки документа хуже, чем бесполезен: он неявно вызывает
> `document.open()` и **стирает страницу целиком**.

### 1.1. Предзагрузчик

Если парсер стоит, разве браузер не простаивает? Нет: все движки имеют **предзагрузчик** (preload
scanner) — лёгкий второй токенизатор, который бежит вперёд по ещё не разобранному HTML и заранее
запускает скачивание найденных `src`, `href`, `srcset`. Поэтому три внешних скрипта подряд качаются
параллельно, хотя выполняются строго по очереди. Предзагрузчик не видит ресурсов, которые создаёт
JavaScript, — отсюда совет не вставлять критичные скрипты динамически.

## 2. Атрибуты `defer`, `async`, `type="module"`

| Вариант | Блокирует парсер | Когда выполняется | Порядок между собой |
|---|---|---|---|
| `<script>` (inline или `src`) | да | сразу, на месте | порядок документа |
| `<script defer src>` | нет | после разбора, **до** `DOMContentLoaded` | порядок документа |
| `<script async src>` | нет (только на время выполнения) | как только скачался | любой |
| `<script type="module">` | нет | как `defer` | порядок документа |
| `<script type="module" async>` | нет | как `async` | любой |
| скрипт, вставленный из JS | нет | как `async` (если не задать `s.async = false`) | любой |

Важные детали, которые часто путают:

- `defer` и `async` действуют **только на внешние** классические скрипты. На inline-скрипте
  `<script defer>…</script>` атрибут молча игнорируется.
- Модуль ведёт себя как отложенный **всегда**, в том числе inline. А `async` на модуле работает
  и для inline-модуля.
- Если указаны оба атрибута, `async` побеждает. `defer` рядом с ним — подстраховка для очень
  старых браузеров.
- `DOMContentLoaded` ждёт отложенные скрипты, но **не ждёт** `async`. Событие `load` у `window` ждёт
  всё, включая картинки.

### 2.1. Как выбрать

- **Код, работающий с DOM страницы** (почти любой код приложения) — `defer` или модуль. Порядок
  сохраняется, дерево полностью построено, парсер не стоит. Это современный ответ на старый совет
  «ставьте скрипты в конец `body`».
- **Независимый код** (счётчик, сторонний виджет, который ни от чего не зависит) — `async`.
- **Маленький код, нужный до первой отрисовки** (например, выставить класс темы на `<html>`,
  чтобы не мигнула светлая тема) — inline в `<head>`, именно потому, что он блокирует.

<details>
<summary>Порядок выполнения: inline, defer, модуль, DOMContentLoaded, load</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-introduction.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  ol { background: #eef6ff; border: 1px solid #69c; padding: 8px 8px 8px 32px; }
</style>
<script>
  // Журнал: копим строки и выводим их, когда body появится
  var log = [];
  function note(s) { log.push(s); }
  note('1. inline в head');
</script>
<script type="module">
  note('модуль (отложен, хотя inline)');
</script>
<script defer>
  // defer на inline игнорируется: этот код выполнится сразу
  note('2. inline с defer — выполнился сразу');
</script>
</head>
<body>
<ol id="out"></ol>
<script>
  note('3. inline в конце body');
  document.addEventListener('DOMContentLoaded', function () { note('DOMContentLoaded'); });
  window.addEventListener('load', function () {
    note('load');
    document.getElementById('out').innerHTML =
      log.map(function (s) { return '<li>' + s + '</li>'; }).join('');
  });
</script>
</body>
</html>
```

</details>

Модуль записан вторым, а выполнился после всех inline-скриптов, но до `DOMContentLoaded`.

### 2.2. Чем модуль отличается ещё

Модуль (`type="module"`) — не просто «отложенный скрипт»:

- **своя область видимости**: `var x` верхнего уровня не становится свойством `window`, а функции
  не видны другим скриптам. Обмен — только через `import`/`export`;
- **всегда строгий режим** (раздел 4);
- `this` на верхнем уровне равен `undefined`, а не `window`;
- **выполняется один раз**: два `<script type="module" src="a.js">` с одним адресом исполнят файл
  однократно, у классических скриптов — дважды;
- загружается по правилам **CORS**: модуль с другого домена без заголовка
  `Access-Control-Allow-Origin` не выполнится. А **страница, открытая как `file://`**, вообще не
  может загрузить модуль из файла — нужен локальный сервер;
- доступны `import.meta.url` (адрес самого модуля) и `await` на верхнем уровне (top-level await);
- есть атрибут `nomodule` для классического скрипта: браузеры, понимающие модули, его пропускают.
  Сегодня это история, но в старом коде встречается пара `module` + `nomodule`.

## 3. `document.currentScript`

Классический скрипт во время **синхронного** выполнения может узнать собственный элемент:
`document.currentScript`. Так виджеты читают свои настройки из `data-*` атрибутов и вставляют
разметку рядом с собой.

<details>
<summary>Скрипт находит сам себя</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-introduction.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.5 system-ui, sans-serif; }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 12px; color: #fff; margin: 4px; }
</style>
</head>
<body>
  <p>Каждый скрипт ставит значок сразу перед собой, цвет берёт из своего data-color:</p>
  <script data-color="#c33">
    (function () {
      var me = document.currentScript;
      var b = document.createElement('span');
      b.className = 'badge';
      b.style.background = me.dataset.color;
      b.textContent = 'красный';
      me.before(b);
    })();
  </script>
  <script data-color="#36a">
    (function () {
      var me = document.currentScript;
      var b = document.createElement('span');
      b.className = 'badge';
      b.style.background = me.dataset.color;
      b.textContent = 'синий';
      me.before(b);
      setTimeout(function () {
        b.textContent += ' (позже currentScript = ' + document.currentScript + ')';
      }, 0);
    })();
  </script>
</body>
</html>
```

</details>

Ограничения:

- значение есть **только пока скрипт выполняется синхронно**. В обработчике события или таймере это
  уже `null` — запоминайте элемент в переменную сразу;
- в **модуле** `document.currentScript` всегда `null`. Модуль может быть импортирован многими, у него
  нет «своего» элемента. Вместо этого используйте `import.meta.url`.

## 4. Строгий режим

Строгий режим (strict mode) включается строкой `'use strict';` в начале файла или функции и всегда
действует в модулях и в телах `class`. Он превращает молчаливые ошибки в явные:

| Ситуация | Нестрогий режим | Строгий режим |
|---|---|---|
| присвоить необъявленной переменной `x = 1` | создаётся глобальная переменная | `ReferenceError` |
| `this` в обычной функции, вызванной без объекта | глобальный объект | `undefined` |
| запись в свойство только для чтения | молча игнорируется | `TypeError` |
| одинаковые имена параметров | разрешены | `SyntaxError` |
| `with`, восьмеричные литералы `010` | разрешены | `SyntaxError` |
| `arguments` и параметры | связаны | независимы |

Первая строка таблицы — главная причина. Опечатка `coutn = 5` в нестрогом коде создаёт новую
глобальную переменную, и программа «работает», только неправильно.

<details>
<summary>Опечатка в нестрогом и строгом режиме</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-introduction.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  .box { padding: 8px; margin: 6px 0; border: 2px solid; }
  .sloppy { border-color: #c90; background: #fff8e6; }
  .strict { border-color: #393; background: #eefaee; }
</style>
</head>
<body>
<div class="box sloppy" id="a"></div>
<div class="box strict" id="b"></div>
<script>
  function sloppy() {
    var count = 0;
    coutn = 5;            // опечатка
    return 'нестрогий: count = ' + count + ', window.coutn = ' + window.coutn;
  }
  function strict() {
    'use strict';
    var total = 0;
    try { totla = 5; } catch (e) { return 'строгий: ' + e.name + ': ' + e.message; }
  }
  document.getElementById('a').textContent = sloppy();
  document.getElementById('b').textContent = strict();
</script>
</body>
</html>
```

</details>

`'use strict'` работает, только если это **первая инструкция** файла или функции. Ещё одна ловушка:
при склейке файлов строгий файл, оказавшийся вторым, теряет режим. Модули эту проблему снимают.

## 5. Глобальный объект и засорение

### 5.1. Что такое глобальная область

На странице есть **глобальный объект** — `window` (он же `globalThis`, он же `self`). Классические
скрипты разделяют одну глобальную область видимости:

- `var` и `function` верхнего уровня классического скрипта становятся **свойствами `window`**;
- `let`, `const` и `class` верхнего уровня тоже глобальны и видны всем скриптам, но свойствами
  `window` **не становятся** (они живут в отдельной «декларативной» части глобального окружения);
- в модуле верхний уровень — **локальный** для модуля.

```js
var a = 1;   window.a   // 1
let b = 2;   window.b   // undefined, но b видна из другого <script>
```

Чем это опасно: два скрипта, объявившие `var config`, тихо перезапишут друг друга. Объявить `let`
с уже занятым именем во втором скрипте — `SyntaxError`, и **весь второй скрипт не выполнится**.

### 5.2. Именованный доступ: `id` становится переменной

Историческая особенность, закреплённая в спецификации HTML как **именованный доступ к объекту
Window** (named access on the Window object): элемент с `id="menu"` доступен как `window.menu` и
просто как `menu`. То же для `name` у некоторых элементов (`form`, `img`, `iframe`, `embed`, `object`).

<details>
<summary>id превращается в глобальную переменную</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-introduction.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  #banner { padding: 8px; background: #fde; border: 1px dashed #c36; }
  pre { background: #f3f3f3; padding: 8px; }
</style>
</head>
<body>
<div id="banner">Я элемент с id="banner"</div>
<div id="name">и с id="name"</div>
<pre id="out"></pre>
<script>
  var lines = [];
  // Никаких getElementById: элемент доступен по имени
  lines.push('banner: ' + banner);
  // Но window.name — это уже существующее свойство окна (строка)
  lines.push('name: ' + JSON.stringify(name) + ' (тип ' + typeof name + ')');
  // Объявленная переменная заслоняет элемент
  var out = 'строка';
  lines.push('out после var: ' + out);
  document.getElementById('out').textContent = lines.join('\n');
</script>
</body>
</html>
```

</details>

Почему на это нельзя полагаться:

- **настоящие свойства окна побеждают**: `id="name"`, `id="status"`,
  `id="top"`, `id="parent"`, `id="history"` дадут не элемент;
- **любая объявленная переменная заслоняет** элемент;
- при двух элементах с одним `id` получите коллекцию вместо элемента;
- код перестаёт быть читаемым: непонятно, откуда взялась переменная.

Обратная сторона той же проблемы — **DOM clobbering**: если на странице есть пользовательская
разметка (комментарии, профиль), злоумышленник вставляет `<a id="config">` и подменяет глобальную
переменную, которую ваш код проверяет через `window.config || {}`. Защита: модули, явное
`document.getElementById`, `const` вместо проверки «есть ли глобальная».

## 6. Цикл событий

### 6.1. Один поток, очередь задач

Скрипты страницы выполняются в **одном потоке** вместе с раскладкой, отрисовкой и обработкой ввода.
Пока работает ваш код, браузер не может ни перерисовать страницу, ни обработать клик. Порядок
задаёт **цикл событий** (event loop) из спецификации HTML. Упрощённо одна итерация такая:

1. взять **одну задачу** (task, её ещё называют macrotask) из очереди и выполнить её до конца.
   Задачи — это выполнение скрипта, обработчик клика, колбэк `setTimeout`, сообщение
   `postMessage`, событие сети;
2. **выполнить все микрозадачи** (microtasks) — колбэки `Promise.then`, `await`-продолжения,
   `queueMicrotask`, `MutationObserver`. Если микрозадача добавила новую, та тоже выполнится
   сейчас — очередь опустошается полностью;
3. если пора рисовать (обычно ~60 раз в секунду и только если есть изменения) — **шаги отрисовки**
   (update the rendering): события `resize`/`scroll`, колбэки **`requestAnimationFrame`**, пересчёт
   стилей, раскладка, отрисовка;
4. повторить.

Микрозадачи выполняются также сразу после каждого колбэка, когда стек вызовов пуст, — то есть
между двумя обработчиками одного события.

<details>
<summary>Порядок: синхронный код, микрозадачи, задачи, кадр</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-introduction.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  ol { background: #f4f0ff; border: 1px solid #86c; padding: 8px 8px 8px 32px; }
</style>
</head>
<body>
<button id="go">Запустить</button>
<ol id="out"></ol>
<script>
  document.getElementById('go').addEventListener('click', function () {
    var out = document.getElementById('out');
    out.innerHTML = '';
    function note(s) { var li = document.createElement('li'); li.textContent = s; out.append(li); }
    note('синхронно: начало');
    setTimeout(function () { note('задача: setTimeout 0'); }, 0);
    requestAnimationFrame(function () { note('кадр: requestAnimationFrame'); });
    Promise.resolve().then(function () {
      note('микрозадача: then 1');
      queueMicrotask(function () { note('микрозадача, добавленная из микрозадачи'); });
    });
    queueMicrotask(function () { note('микрозадача: queueMicrotask'); });
    note('синхронно: конец');
  });
</script>
</body>
</html>
```

</details>

Нажмите кнопку. Синхронные строки идут первыми, затем **все** микрозадачи, включая добавленную
изнутри. Относительный порядок `setTimeout` и `requestAnimationFrame` не гарантирован: он зависит
от того, когда наступит следующий кадр. Это нормально — не стройте логику на этом порядке.

### 6.2. Следствия для интерфейса

- **Изменения DOM не видны, пока задача не закончилась.** Скрыть элемент, сделать долгий расчёт
  и показать снова — пользователь не увидит скрытия вовсе.
- **Долгая задача замораживает страницу.** Задачи дольше 50 мс называются длинными (long tasks):
  ввод в это время не обрабатывается. Подробно — в курсе
  [Производительность JavaScript в браузере](LEARN_JAVASCRIPT_PERFORMANCE_COURSE.md).
- **Бесконечная цепочка микрозадач страшнее бесконечного `setTimeout`.** Таймер отдаёт управление
  между итерациями, а микрозадачи — нет: страница зависает полностью.
- **Анимацию делайте через `requestAnimationFrame`**: колбэк вызывается прямо перед отрисовкой,
  один раз на кадр, и не вызывается в скрытой вкладке. `setTimeout(f, 16)` не синхронизирован с
  кадрами и даёт рывки.

<details>
<summary>Долгая задача блокирует отрисовку</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-introduction.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  #msg { padding: 10px; margin-top: 8px; border: 2px solid #999; }
  .busy { background: #ffd; border-color: #c90 !important; }
  .spin { width: 40px; height: 40px; background: #36a; animation: r 1s linear infinite; margin-top: 8px; }
  @keyframes r { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<button id="bad">Плохо: занят 1,5 с сразу</button>
<button id="good">Хорошо: дать кадру отрисоваться</button>
<div id="msg">Готов</div>
<div class="spin"></div>
<p>Квадрат вращается на потоке композиции и может не замереть; надпись «Считаю…» — замрёт.</p>
<script>
  var msg = document.getElementById('msg');
  function work() { var t = Date.now(); while (Date.now() - t < 1500) {} }
  document.getElementById('bad').onclick = function () {
    msg.textContent = 'Считаю…'; msg.className = 'busy';
    work();                         // надпись «Считаю…» так и не появится
    msg.textContent = 'Готово'; msg.className = '';
  };
  document.getElementById('good').onclick = function () {
    msg.textContent = 'Считаю…'; msg.className = 'busy';
    // Двойной rAF: дождаться, пока кадр с надписью будет нарисован
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        work();
        msg.textContent = 'Готово'; msg.className = '';
      });
    });
  };
</script>
</body>
</html>
```

</details>

Почему два `requestAnimationFrame`? Колбэк первого вызывается **до** отрисовки кадра — если считать
там, кадр опять не нарисуется. Второй колбэк попадает в следующий кадр, а значит, первый уже показан.

## 7. Где видны ошибки

Необработанная ошибка в скрипте **не ломает страницу целиком**: прерывается только текущая задача
(текущий `<script>`, текущий обработчик). Остальные скрипты и обработчики продолжают работать.
Поэтому сломанная страница часто выглядит «почти рабочей».

- **Консоль** инструментов разработчика (F12) показывает необработанные исключения со ссылкой на
  файл и строку, отклонённые промисы без обработчика (`Uncaught (in promise)`), нарушения CSP,
  ошибки загрузки ресурсов и CORS.
- `SyntaxError` в файле означает, что **файл не выполнился вообще ни одной строкой**: разбор
  происходит до выполнения.
- Ошибку внешнего скрипта с другого домена страница видит лишь как `Script error.` без подробностей,
  если скрипт не подключён с `crossorigin` и сервер не отдаёт CORS-заголовок.
- Программно: событие `error` на `window` для исключений и `unhandledrejection` для промисов.

<details>
<summary>Ошибка прерывает только свою задачу</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-introduction.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  li.ok { color: #282; } li.err { color: #c22; }
</style>
</head>
<body>
<ul id="out"></ul>
<script>
  function note(s, cls) {
    var li = document.createElement('li'); li.textContent = s; li.className = cls || 'ok';
    document.getElementById('out').append(li);
  }
  window.addEventListener('error', function (e) { note('window error: ' + e.message, 'err'); });
  window.addEventListener('unhandledrejection', function (e) {
    note('unhandledrejection: ' + e.reason, 'err');
  });
  note('скрипт 1 выполнен');
</script>
<script>
  note('скрипт 2: до ошибки');
  undefinedFunction();
  note('скрипт 2: эта строка не выполнится');
</script>
<script>
  note('скрипт 3 работает как ни в чём не бывало');
  Promise.reject('отказ без catch');
</script>
</body>
</html>
```

</details>

## 8. Политика безопасности содержимого

**CSP** (Content Security Policy) — список правил, по которым браузер решает, какие скрипты, стили
и ресурсы разрешены. Задаётся HTTP-заголовком `Content-Security-Policy` или (с ограничениями)
тегом `<meta http-equiv="Content-Security-Policy">`.

```http
Content-Security-Policy: script-src 'self'; object-src 'none'; base-uri 'none'
```

Как только задана директива `script-src` (или общая `default-src`), браузер **по умолчанию
запрещает**:

- **inline-скрипты** — `<script>…</script>` без `src`;
- **inline-обработчики** — `onclick="…"`, а также ссылки `javascript:`;
- **`eval`**, `new Function`, `setTimeout('строка')`.

Разрешить конкретный inline-скрипт можно одноразовым номером (`'nonce-…'`, сервер генерирует его
заново на каждый ответ и пишет в `<script nonce="…">`) или хешем содержимого (`'sha256-…'`).
`'unsafe-inline'` разрешает всё и почти обнуляет защиту.

Зачем это: главная атака на страницы — **межсайтовый скриптинг** (cross-site scripting, XSS), когда
чужие данные попадают в разметку и выполняются как код. CSP — второй рубеж: даже если строка с
`<img src=x onerror=…>` прошла в `innerHTML`, обработчик не выполнится. Первый рубеж — не вставлять
данные как HTML (курс [DOM](LEARN_JAVASCRIPT_DOM_COURSE.md)).

<details>
<summary>CSP через meta запрещает inline-обработчик</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-introduction.html#example-9">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="script-src 'none'">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  button { padding: 8px 14px; }
  p { padding: 8px; background: #fee; border-left: 4px solid #c33; }
</style>
</head>
<body>
<button onclick="this.textContent = 'Сработало'">Нажмите меня</button>
<p>Политика script-src 'none' запрещает любые скрипты. Ни inline-обработчик кнопки,
ни этот текст не будут изменены скриптами. Откройте консоль: там сообщение
о нарушении Content Security Policy.</p>
<script>
  document.querySelector('p').textContent = 'Этот скрипт выполнился — значит, CSP не применилась';
</script>
</body>
</html>
```

</details>

Привычка, которая окупается: **не пишите `onclick` в разметке**, вешайте обработчики через
`addEventListener` из внешнего файла. Тогда строгая CSP включается без переписывания кода. Этот
репозиторий так и устроен.

## Итог

- Классический скрипт без атрибутов **останавливает парсер** и видит только дерево выше себя.
- `defer` и модули выполняются после разбора, по порядку, до `DOMContentLoaded`; `async` — когда
  скачается, в любом порядке. На inline-скриптах `defer`/`async` не работают (кроме `async` у модулей).
- `document.currentScript` есть только во время синхронного выполнения классического скрипта.
- Строгий режим превращает тихие ошибки в исключения; модули строгие всегда.
- `var`/`function` классического скрипта засоряют `window`; `id` элементов тоже видны как
  глобальные — не полагайтесь на это и опасайтесь DOM clobbering.
- Цикл событий: задача → все микрозадачи → (иногда) кадр с `requestAnimationFrame`. Пока идёт
  задача, страница не рисуется и не отвечает.
- Ошибка прерывает только текущую задачу; `SyntaxError` — весь файл. CSP запрещает inline-код и `eval`.

## Проверьте себя

1. Почему `<script defer>alert(1)</script>` выполняется сразу, а `<script type="module">` с тем же
   кодом — после разбора документа?
2. Два классических скрипта: в первом `let user = 1`, во втором `let user = 2`. Что произойдёт и
   выполнится ли второй скрипт хотя бы частично?
3. Почему элемент `<div id="name">` нельзя получить как глобальную переменную `name`?
4. В каком порядке выведутся `setTimeout(…, 0)`, `Promise.resolve().then(…)` и синхронный
   `console.log`? Что из этого гарантировано?
5. Почему код «показать спиннер, посчитать, скрыть спиннер» в одном обработчике не показывает
   спиннер, и как это исправить?

Дальше: [DOM](LEARN_JAVASCRIPT_DOM_COURSE.md).
