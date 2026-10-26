# Селекторы в JavaScript

> Курс 34 из программы. Для тех, кто знает язык селекторов CSS и интерфейсы DOM. Здесь тот же язык
> работает в обратную сторону: не «стиль ищет элементы», а «код ищет элементы» — и у этого есть
> свои правила, ловушки и цена.

**Что вы будете понимать после курса**

- как `querySelector` и `querySelectorAll` применяют язык селекторов CSS и что именно они возвращают;
- зачем `matches` и `closest` и как на них строится делегирование событий;
- почему `el.querySelectorAll('div p')` находит больше, чем ожидаешь, и как это лечит `:scope`;
- чем `getElementById` и `getElementsByClassName` отличаются от `querySelector*`;
- как безопасно подставлять в селектор произвольные строки через `CSS.escape`;
- откуда берётся `SyntaxError` и почему псевдоэлементы ничего не находят;
- что стоит дорого, что дёшево и где проходит граница теневого DOM.

---

## 1. Один язык, два направления

С первого курса мы называли **селектор** шаблоном над деревом. CSS применяет его, чтобы найти
элементы, к которым относятся объявления. JavaScript применяет **тот же язык** (Selectors Level 4,
в пределах поддержки браузера) через методы `Element` и `Document`:

| Метод | Возвращает | Если не найдено |
|---|---|---|
| `root.querySelector(sel)` | первый подходящий элемент **в порядке документа** | `null` |
| `root.querySelectorAll(sel)` | статичный `NodeList` всех подходящих | пустой `NodeList` |
| `el.matches(sel)` | `true`/`false`: подходит ли сам `el` | — |
| `el.closest(sel)` | ближайший предок **включая сам `el`**, подходящий под `sel` | `null` |

«Первый в порядке документа» — это обход в глубину (depth-first, pre-order): родитель раньше
детей, старший брат со всеми потомками раньше младшего. Не «самый близкий к корню».

Всё, что вы знаете о селекторах из [Введения в CSS](LEARN_CSS_INTRODUCTION_COURSE.md), работает
здесь: комбинаторы ` `, `>`, `+`, `~`, атрибуты `[href^="https:"]`, `:not()`, `:is()`, `:where()`,
`:has()`, `:nth-child(2n of .x)`. Состояния тоже: `:checked`, `:disabled`, `:focus`, `:hover`,
`:invalid` — отвечают на текущее состояние в момент вызова.

<details>
<summary>Язык селекторов из JavaScript: подсветка по вводу</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-selectors.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  #q { width: 100%; box-sizing: border-box; padding: 6px; font: 14px monospace; }
  #demo { border: 1px solid #ccc; padding: 8px; margin-top: 8px; }
  #demo * { outline: 1px dotted #bbb; margin: 2px; }
  .hit { outline: 3px solid #e33 !important; background: #fee; }
  #msg { font: 13px monospace; color: #555; }
</style>
</head>
<body>
<p>Пишите селектор: <code>li:nth-child(odd)</code>, <code>a[href^="https"]</code>,
<code>section:has(> h3)</code>, <code>p + p</code>, <code>:checked</code>…</p>
<input id="q" value="li:nth-child(odd)">
<p id="msg"></p>
<div id="demo">
  <section><h3>Раздел</h3><p>Абзац <a href="https://example.org">внешняя</a></p><p>Второй <a href="/local">своя</a></p></section>
  <section><ul><li>один</li><li>два</li><li>три</li><li>четыре</li></ul></section>
  <label><input type="checkbox" checked> флажок</label> <label><input type="checkbox"> ещё</label>
</div>
<script>
  var q = document.getElementById('q'), demo = document.getElementById('demo'), msg = document.getElementById('msg');
  function run() {
    demo.querySelectorAll('.hit').forEach(function (e) { e.classList.remove('hit'); });
    try {
      var found = demo.querySelectorAll(q.value);
      found.forEach(function (e) { e.classList.add('hit'); });
      msg.textContent = 'найдено: ' + found.length;
    } catch (e) {
      msg.textContent = e.name + ': ' + e.message;
    }
  }
  q.addEventListener('input', run);
  demo.addEventListener('change', run);
  run();
</script>
</body>
</html>
```

</details>

Введите незаконченный селектор, например `li:nth-child(` — и увидите `SyntaxError` (раздел 6).

## 2. `matches` и `closest`

### 2.1. `matches`

`el.matches(sel)` проверяет **сам элемент**. Это тот же вопрос, который CSS задаёт для каждого
элемента при сопоставлении: «подходит ли этот элемент под правило?». Удобно в фильтрах:

```js
[...form.elements].filter(el => el.matches(':invalid'))
```

### 2.2. `closest` и делегирование

`el.closest(sel)` поднимается от `el` к корню и возвращает первого подходящего. Важно, что он
**начинает с самого `el`**: `button.closest('button') === button`.

На `closest` строится **делегирование событий** (event delegation): один обработчик на общем
предке вместо сотни на каждом элементе. Событие всплывает от места клика; `event.target` — самый
глубокий элемент, по которому попали (это может быть `<span>` или иконка внутри кнопки), а
`closest` находит нужный «логический» элемент:

```js
list.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn || !list.contains(btn)) return;   // клик мимо или кнопка снаружи списка
  // …
});
```

Проверка `list.contains(btn)` нужна, потому что `closest` поднимается **выше** `list`: если сам
список лежит внутри `<button data-action>`, поиск выйдет за его пределы. Плюсы делегирования:
работает для элементов, добавленных позже; меньше обработчиков и памяти. Подробно о всплытии —
в курсе [События](LEARN_JAVASCRIPT_EVENTS_COURSE.md).

<details>
<summary>Делегирование: один обработчик на весь список</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-selectors.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  ul { list-style: none; padding: 0; max-width: 360px; }
  li { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px;
       margin: 4px 0; border: 1px solid #ccc; border-radius: 4px; }
  li.done span { text-decoration: line-through; color: #888; }
  button { cursor: pointer; }
  button b { pointer-events: auto; }
  #log { font: 13px monospace; color: #555; }
</style>
</head>
<body>
<p>Нажимайте кнопки (в том числе прямо на жирные значки внутри них) и добавляйте новые пункты:
новые работают без отдельных обработчиков.</p>
<ul id="list">
  <li><span>Купить хлеб</span><span><button data-action="done"><b>✓</b> готово</button> <button data-action="del"><b>✕</b></button></span></li>
  <li><span>Позвонить</span><span><button data-action="done"><b>✓</b> готово</button> <button data-action="del"><b>✕</b></button></span></li>
</ul>
<button id="add">Добавить пункт</button>
<p id="log"></p>
<script>
  var list = document.getElementById('list'), n = 0;
  list.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn || !list.contains(btn)) return;
    var item = btn.closest('li');
    document.getElementById('log').textContent =
      'target: <' + e.target.tagName.toLowerCase() + '>, найдена кнопка: ' + btn.dataset.action;
    if (btn.dataset.action === 'done') item.classList.toggle('done');
    if (btn.dataset.action === 'del') item.remove();
  });
  document.getElementById('add').onclick = function () {
    var li = list.firstElementChild ? list.firstElementChild.cloneNode(true) : null;
    if (!li) return;
    li.classList.remove('done');
    li.querySelector('span').textContent = 'Новый пункт ' + (++n);
    list.append(li);
  };
</script>
</body>
</html>
```

</details>

## 3. Область поиска и `:scope`

### 3.1. Неожиданность: селектор проверяется по всему документу

`el.querySelectorAll(sel)` возвращает потомков `el`, подходящих под `sel`. Но **сам селектор
сопоставляется с документом целиком**, а не с поддеревом. Ограничение «внутри `el`» накладывается
только на итоговый элемент (самый правый составной селектор). Предки из левой части селектора
могут находиться **выше `el`**.

```html
<div id="outer">
  <section id="box"><p>текст</p></section>
</div>
```

```js
box.querySelectorAll('div p')   // находит <p>! «div» — это #outer, он выше box
```

Это прямое следствие того, как браузер проверяет селекторы — **справа налево** (курс
[Документ HTML](LEARN_HTML_DOCUMENT_COURSE.md)): найти `p`, затем искать среди его предков `div`,
без оглядки на то, где начался поиск.

### 3.2. `:scope`

Псевдокласс `:scope` в `querySelector*` обозначает **элемент, на котором вызван метод**. Он
позволяет и привязать селектор к этому элементу, и использовать дочерний комбинатор относительно
него:

```js
box.querySelectorAll(':scope div p')  // div теперь обязан быть внутри box
box.querySelectorAll(':scope > p')    // только прямые дети box
```

В `matches` и `closest` `:scope` — это сам проверяемый элемент. В обычном CSS без `@scope` он
совпадает с `:root`.

<details>
<summary>Сюрприз «div p» внутри section и лечение через :scope</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-selectors.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  #outer { border: 3px solid #c90; padding: 8px; }
  #outer::before { content: "div#outer"; font: 12px monospace; color: #c90; }
  #box { border: 3px solid #36a; padding: 8px; }
  #box::before { content: "section#box"; font: 12px monospace; color: #36a; }
  p { margin: 4px 0; padding: 4px; }
  .hit { background: #e33; color: #fff; }
  pre { background: #f3f3f3; padding: 8px; }
</style>
</head>
<body>
<div id="outer">
  <section id="box">
    <p>прямой ребёнок section</p>
    <article><p>внук внутри article</p></article>
  </section>
</div>
<button data-sel="div p">box.qSA('div p')</button>
<button data-sel=":scope div p">box.qSA(':scope div p')</button>
<button data-sel=":scope > p">box.qSA(':scope > p')</button>
<button data-sel="p">box.qSA('p')</button>
<pre id="out"></pre>
<script>
  var box = document.getElementById('box');
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-sel]');
    if (!b) return;
    box.querySelectorAll('.hit').forEach(function (p) { p.classList.remove('hit'); });
    var found = box.querySelectorAll(b.dataset.sel);
    found.forEach(function (p) { p.classList.add('hit'); });
    document.getElementById('out').textContent = b.dataset.sel + '  →  найдено ' + found.length;
  });
</script>
</body>
</html>
```

</details>

## 4. `getElementById` и `getElementsBy*`

Эти методы старше `querySelector` и не используют язык селекторов:

| Метод | Где есть | Возвращает | Живая? |
|---|---|---|---|
| `document.getElementById(id)` | `Document`, `DocumentFragment`, `ShadowRoot` (не `Element`!) | элемент или `null` | — |
| `getElementsByClassName('a b')` | `Document`, `Element` | `HTMLCollection` (элементы со **всеми** классами) | да |
| `getElementsByTagName('li')` | `Document`, `Element` | `HTMLCollection` | да |
| `document.getElementsByName(n)` | `Document` | `NodeList` | да |

Особенности:

- `getElementById` принимает **значение id как есть**, без `#` и без экранирования:
  `getElementById('1:a.b')` работает, тогда как `querySelector('#1:a.b')` — `SyntaxError`;
- при повторяющихся `id` (это ошибка разметки) все методы возвращают первый в порядке документа;
- `getElementsByClassName` и `getElementsByTagName` возвращают **живые** коллекции (курс
  [DOM](LEARN_JAVASCRIPT_DOM_COURSE.md)) и потому особенно дёшевы при повторных вызовах: браузер
  кеширует коллекцию и обновляет её лениво;
- аргумент `getElementsByClassName` — список классов через пробел, не селектор: `'.a'` ищет класс
  с точкой в имени.

Что выбрать: `getElementById` — для одного элемента по `id` (самый быстрый и не требует
экранирования). `querySelector*` — для всего остального: один язык, выразительность, статичный
результат без сюрпризов в циклах. Живые коллекции — когда вам нужна именно живость, и вы помните
о ней.

## 5. Экранирование: `CSS.escape`

В селекторе есть служебные символы: `. # : [ ] ( ) > + ~ , " ' \` и пробел. Кроме того,
идентификатор **не может начинаться с цифры** (или с дефиса и цифры). А значения `id` и классов в
HTML могут быть почти любыми: `id="2025"`, `class="w-1/2"`, `class="md:flex"` (утилитарные
CSS-фреймворки), `id="user@mail"`.

Если строка приходит из данных, её нельзя подставлять в селектор напрямую:

```js
document.querySelector('#' + id);               // id = "2025" → SyntaxError
document.querySelector('#' + CSS.escape(id));   // "#\32 025" — работает
document.querySelector(`[data-name="${CSS.escape(name)}"]`); // кавычки внутри значения
```

`CSS.escape` экранирует строку **как идентификатор CSS**: ведущая цифра превращается в
шестнадцатеричную escape-последовательность, служебные символы получают `\`. Это защищает и от
ошибок, и от «инъекции селектора», когда значение вида `x"], *, [a="` расширяет поиск.

<details>
<summary>CSS.escape для «неудобных» id и классов</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-selectors.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px/1.5 system-ui, sans-serif; }
  .item { display: inline-block; padding: 4px 8px; margin: 3px; border: 1px solid #aaa; font-family: monospace; }
  .hit { background: #3a3; color: #fff; }
  table { border-collapse: collapse; margin-top: 8px; font: 13px monospace; }
  td { border: 1px solid #ccc; padding: 3px 6px; }
  .err { color: #c22; }
</style>
</head>
<body>
<span class="item" id="2025">id="2025"</span>
<span class="item md:flex">class="md:flex"</span>
<span class="item w-1/2">class="w-1/2"</span>
<span class="item" id="a.b">id="a.b"</span>
<table id="t"></table>
<script>
  var cases = [['#', '2025'], ['.', 'md:flex'], ['.', 'w-1/2'], ['#', 'a.b']];
  var t = document.getElementById('t');
  t.innerHTML = '<tr><td>без экранирования</td><td>CSS.escape</td></tr>';
  cases.forEach(function (c) {
    var tr = document.createElement('tr');
    [c[0] + c[1], c[0] + CSS.escape(c[1])].forEach(function (sel) {
      var td = document.createElement('td');
      try {
        var el = document.querySelector(sel);
        td.textContent = sel + '  →  ' + (el ? 'нашёл' : 'null');
        if (el) el.classList.add('hit');
      } catch (e) {
        td.textContent = sel + '  →  ' + e.name;
        td.className = 'err';
      }
      tr.append(td);
    });
    t.append(tr);
  });
</script>
</body>
</html>
```

</details>

`#a.b` без экранирования не падает, а **молча ищет другое**: элемент с `id="a"` и классом `b`.
Такие ошибки опаснее исключения.

## 6. Ошибки селекторов

### 6.1. `SyntaxError`

Если строка не разбирается как список селекторов, все четыре метода бросают `DOMException` с
именем `SyntaxError`. Важное отличие от CSS:

- в **таблице стилей** неверный селектор делает недействительным **только своё правило**, остальные
  применяются;
- в **списке селекторов** CSS одна ошибка роняет весь список (`a, b:бред { … }` не применится
  даже к `a`). `:is()` и `:where()` — исключение: у них **прощающий** разбор (forgiving), неверные
  части просто отбрасываются;
- в **JavaScript** ошибка — исключение, и **весь остаток задачи не выполнится** (курс
  [Введение](LEARN_JAVASCRIPT_INTRODUCTION_COURSE.md)).

Поэтому селекторы, собранные из данных, — только через `CSS.escape`, а пробные (например, с новым
псевдоклассом, который браузер может не знать) — в `try`/`catch` или после проверки
`CSS.supports('selector(:has(a))')`.

### 6.2. Псевдоэлементы ничего не находят

`querySelector('p::before')` не бросит исключение (в современных браузерах), но вернёт `null`:
псевдоэлементы — не узлы DOM, их нет в дереве. Для чтения их стилей есть
`getComputedStyle(el, '::before')`. По той же причине нельзя найти текстовый узел селектором:
селекторы находят только **элементы**.

### 6.3. Псевдоклассы, зависящие от пользователя

`:visited` в JavaScript **всегда ведёт себя как непосещённая ссылка**: `a.matches(':visited')`
возвращает `false`. Это защита приватности — иначе любой сайт мог бы проверить историю браузера
посетителя. `:hover` и `:focus` работают, но отражают состояние ровно в момент вызова.

## 7. Производительность и кеширование

### 7.1. Что дорого

- **Сам поиск дешёвый.** `getElementById` использует хеш-таблицу документа; простые селекторы
  `querySelector` (`#id`, `.class`, тег) браузеры тоже ускоряют. Тысячи вызовов в секунду не
  проблема, но десятки тысяч в одном кадре — уже да.
- **`querySelectorAll` создаёт новый список** при каждом вызове и обходит всё поддерево.
  `querySelector` останавливается на первом совпадении, поэтому быстрее, если вам нужен один.
- **Широкие селекторы** с потомковым комбинатором и `:has()` на большом дереве медленнее простых.
- **Узкий корень лучше широкого**: `panel.querySelector('.title')` обходит только панель.

### 7.2. Кешируйте ссылки, а не результаты

Частый приём — найти элементы один раз при инициализации и хранить ссылки:

```js
const ui = {
  form:   document.getElementById('order'),
  total:  document.getElementById('total'),
  submit: document.querySelector('#order button[type=submit]'),
};
```

Это ускоряет и, что важнее, **документирует зависимости**: сразу видно, на какие элементы опирается
модуль. Но кеш устаревает: если элемент заменили (`innerHTML`, перерисовка шаблона), ссылка
указывает на **отсоединённый** узел. Изменения в нём ничего не покажут, а `isConnected` вернёт
`false`. Кешируйте стабильные элементы-контейнеры, а за динамическим содержимым обращайтесь через
делегирование или новый поиск от контейнера.

### 7.3. Селекторы и классы-хуки

Селекторы, по которым ищет JavaScript, становятся неявным API разметки. Если дизайнер
переименует `.btn-primary`, код сломается. Распространённые соглашения: отдельные атрибуты для
кода — `data-action`, `data-role`, `data-js="cart"` — или префикс `js-` у классов. Стили на них не
вешают, и оформление можно менять, не трогая скрипты.

<details>
<summary>Устаревшая ссылка после innerHTML</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-selectors.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  #panel { border: 2px solid #36a; padding: 8px; margin: 8px 0; }
  .count { font-size: 24px; font-weight: bold; color: #36a; }
  pre { background: #f3f3f3; padding: 8px; }
</style>
</head>
<body>
<button id="inc">+1</button>
<button id="redraw">Перерисовать панель через innerHTML</button>
<div id="panel"><span class="count">0</span></div>
<pre id="out"></pre>
<script>
  var panel = document.getElementById('panel');
  var cached = panel.querySelector('.count');   // кеш при старте
  var n = 0;
  function report() {
    document.getElementById('out').textContent =
      'кешированный элемент isConnected: ' + cached.isConnected +
      '\nего текст: ' + cached.textContent +
      '\nна экране:  ' + panel.querySelector('.count').textContent;
  }
  document.getElementById('inc').onclick = function () { cached.textContent = ++n; report(); };
  document.getElementById('redraw').onclick = function () {
    panel.innerHTML = '<span class="count">' + n + '</span>';
    report();
  };
  report();
</script>
</body>
</html>
```

</details>

Нажмите «+1», затем «Перерисовать», затем снова «+1»: счётчик на экране застынет, потому что код
пишет в узел, которого в документе уже нет.

## 8. Граница теневого DOM

**Теневой DOM** (shadow DOM) — отдельное поддерево, прикреплённое к элементу-хозяину
(`host.attachShadow({ mode: 'open' })`). Так устроены веб-компоненты и встроенные элементы вроде
`<video>` и `<input type="range">`. Для селекторов теневой корень — **граница**:

- `document.querySelector*` **не заходит** внутрь теневого дерева: элементы внутри не находятся,
  даже `*` их не видит;
- искать внутри нужно от корня: `host.shadowRoot.querySelector(...)`. У закрытого корня
  (`mode: 'closed'`) свойство `shadowRoot` равно `null`;
- внутри теневого дерева `getElementById` есть у самого `ShadowRoot`; `id` не конфликтуют с
  документом;
- `closest` изнутри тени поднимается только до теневого корня и не выходит к хозяину; к нему ведёт
  `el.getRootNode().host`;
- **проецируемые** (slotted) элементы — обычные дети хозяина в светлом DOM: документ их находит,
  а `shadowRoot.querySelector` — нет. Получить их со стороны тени — `slot.assignedElements()`;
- комбинаторов, пробивающих границу (старые `/deep/` и `>>>`), больше нет — их удалили.

<details>
<summary>document.querySelector не видит теневое дерево</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-selectors.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  .tag { padding: 4px 8px; border: 2px solid #c90; }
  pre { background: #f3f3f3; padding: 8px; }
</style>
</head>
<body>
<div id="host"><span class="tag">светлый ребёнок (слот)</span></div>
<pre id="out"></pre>
<script>
  var host = document.getElementById('host');
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML =
    '<style>.tag { display: block; padding: 6px; margin: 4px 0; border: 2px solid #36a; } p { color: #36a; }</style>' +
    '<p class="tag" id="inner">внутри тени</p><slot></slot>';
  var inner = root.getElementById('inner');
  document.getElementById('out').textContent = [
    'document.querySelectorAll(".tag").length = ' + document.querySelectorAll('.tag').length,
    'root.querySelectorAll(".tag").length     = ' + root.querySelectorAll('.tag').length,
    'document.getElementById("inner")         = ' + document.getElementById('inner'),
    'inner.closest("#host")                   = ' + inner.closest('#host'),
    'inner.getRootNode().host.id              = ' + inner.getRootNode().host.id,
    'slot.assignedElements()                  = ' + root.querySelector('slot').assignedElements().length
  ].join('\n');
</script>
</body>
</html>
```

</details>

Документ нашёл один `.tag` — светлый ребёнок; теневой корень — тоже один, свой. Ни один поиск
не видит обоих: граница работает в обе стороны.

## Итог

- `querySelector*`, `matches`, `closest` используют язык селекторов CSS; результат
  `querySelectorAll` — статичный снимок, первый элемент — по порядку документа.
- `closest` начинает с самого элемента; с ним и проверкой `contains` строится делегирование.
- Селектор в `el.querySelectorAll` сопоставляется со всем документом; `:scope` привязывает его к `el`.
- `getElementById` не требует экранирования; `getElementsBy*` возвращают живые коллекции.
- Данные в селекторе — только через `CSS.escape`; неверный селектор — исключение, которое обрывает задачу.
- Псевдоэлементы и текстовые узлы не находятся; `:visited` в JS всегда ложен.
- Кешируйте стабильные контейнеры, следите за отсоединёнными узлами; для хуков кода — `data-*`.
- Теневой корень — граница для всех методов поиска.

## Проверьте себя

1. Даны `<div><section id="s"><p>…</p></section></div>`. Что вернёт `s.querySelector('div p')` и
   как переписать, чтобы `div` искался только внутри `s`?
2. Почему в делегированном обработчике пишут `e.target.closest('button')`, а не проверяют
   `e.target.tagName === 'BUTTON'`?
3. Какие из вызовов бросят `SyntaxError`: `querySelector('#7')`, `getElementById('7')`,
   `querySelector('.a:b')`, `querySelector('p::after')`?
4. Почему `querySelector('#' + id)` с `id = "a.b"` опаснее, чем с `id = "1a"`?
5. Как найти элемент внутри открытого теневого дерева компонента `<my-card>` и почему
   `document.querySelector('my-card .title')` не сработает?

Дальше: [События](LEARN_JAVASCRIPT_EVENTS_COURSE.md).
