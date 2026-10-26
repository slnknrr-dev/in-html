# DOM

> Курс 33 из программы. Для тех, кто прошёл [Введение](LEARN_JAVASCRIPT_INTRODUCTION_COURSE.md) и
> знает, когда выполняется скрипт. Теперь — что именно он видит: объектную модель документа,
> её интерфейсы, способы читать и менять дерево и цену каждого способа.

**Что вы будете понимать после курса**

- какие бывают узлы и как устроена иерархия интерфейсов `Node` → `Element` → `HTMLElement`;
- почему `childNodes` и `children` дают разное и откуда берутся пробельные текстовые узлы;
- как создавать и вставлять узлы: `createElement`, `append`, `insertAdjacentHTML`, `<template>`, `DocumentFragment`;
- чем `innerHTML`, `textContent` и `innerText` отличаются по безопасности и по цене;
- разницу между атрибутами и свойствами, зачем `classList`, `dataset`, `style` и `getComputedStyle`;
- что такое живые и статичные коллекции и почему цикл по живой коллекции может не закончиться;
- как следить за изменениями дерева через `MutationObserver`.

---

## 1. Что такое DOM

**DOM** (Document Object Model) — стандарт WHATWG, описывающий документ как дерево **объектов**
с программным интерфейсом. Парсер строит из HTML дерево, а JavaScript получает к нему доступ через
объект `document`. Важно различать три вещи:

- **исходный HTML** — текст, который пришёл с сервера. После разбора он больше не используется;
- **DOM** — живое дерево. Его меняют скрипты, расширения, сам браузер (например, значение `<input>`
  при вводе меняется в свойстве, а не в атрибуте). Панель Elements в инструментах разработчика
  показывает именно DOM;
- **дерево отрисовки** (render tree) — то, что строится из DOM и CSS для показа. Элементов с
  `display: none` и узлов `<head>` в нём нет.

Поэтому «Просмотр кода страницы» и панель Elements часто показывают разное, и отлаживать надо DOM.

## 2. Узлы и интерфейсы

### 2.1. Типы узлов

Каждый узел имеет `nodeType` — число, у которого есть именованная константа на `Node`:

| Константа | Значение | Пример | `nodeName` |
|---|---|---|---|
| `ELEMENT_NODE` | 1 | `<p>` | `"P"` (в HTML — заглавными) |
| `TEXT_NODE` | 3 | текст внутри `<p>` | `"#text"` |
| `COMMENT_NODE` | 8 | `<!-- … -->` | `"#comment"` |
| `DOCUMENT_NODE` | 9 | `document` | `"#document"` |
| `DOCUMENT_TYPE_NODE` | 10 | `<!doctype html>` | `"html"` |
| `DOCUMENT_FRAGMENT_NODE` | 11 | `DocumentFragment`, теневой корень | `"#document-fragment"` |

### 2.2. Цепочка интерфейсов

Объекты DOM построены на наследовании интерфейсов. Для `<a>`:

```text
HTMLAnchorElement → HTMLElement → Element → Node → EventTarget → Object
```

- **`EventTarget`** — `addEventListener`. Есть у всего, что получает события, не только у узлов.
- **`Node`** — всё про дерево: `parentNode`, `childNodes`, `firstChild`, `nextSibling`,
  `textContent`, `appendChild`, `insertBefore`, `removeChild`, `cloneNode`, `contains`.
- **`Element`** — атрибуты (`getAttribute`), `id`, `className`, `classList`, `children`,
  `querySelector`, `closest`, `matches`, `innerHTML`, `getBoundingClientRect`.
- **`HTMLElement`** — то, что специфично для HTML: `hidden`, `title`, `dataset`, `style`,
  `innerText`, `focus()`, `tabIndex`.
- **`HTMLAnchorElement`** — `href`, `hostname`, `download`, …

Почему это важно: у `Text` нет `children` и `classList`, у `SVGElement` нет `innerText` и
`HTMLElement`-свойств. Ошибки вида «`classList` is undefined» почти всегда означают, что в руках
текстовый узел, а не элемент.

`Document` — отдельный интерфейс-наследник `Node`: `document.documentElement` (`<html>`),
`document.head`, `document.body`, `createElement`, `getElementById`.

<details>
<summary>Цепочка прототипов у разных узлов</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-dom.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  pre { background: #f3f3f3; padding: 8px; border-left: 4px solid #36a; }
</style>
</head>
<body>
<p id="p">Абзац с <a href="#">ссылкой</a><!-- и комментарием --></p>
<pre id="out"></pre>
<script>
  function chain(o) {
    var names = [];
    for (var p = Object.getPrototypeOf(o); p; p = Object.getPrototypeOf(p)) {
      names.push(p.constructor.name);
    }
    return names.join(' → ');
  }
  var p = document.getElementById('p');
  var rows = [p.querySelector('a'), p, p.firstChild, p.lastChild, document, document.doctype];
  document.getElementById('out').textContent = rows.map(function (n) {
    return n.nodeType + ' ' + n.nodeName.padEnd(10) + chain(n);
  }).join('\n');
</script>
</body>
</html>
```

</details>

## 3. Обход дерева

### 3.1. Два набора ссылок

У `Node` есть ссылки на **все** узлы, у `Element` — только на **элементы**:

| Все узлы (`Node`) | Только элементы (`Element`) |
|---|---|
| `childNodes` | `children` |
| `firstChild`, `lastChild` | `firstElementChild`, `lastElementChild` |
| `previousSibling`, `nextSibling` | `previousElementSibling`, `nextElementSibling` |
| `parentNode` | `parentElement` |

`parentNode` и `parentElement` различаются только наверху: у `<html>` родитель — `document`,
который узел, но не элемент, поэтому `document.documentElement.parentElement === null`.

### 3.2. Пробельные текстовые узлы

Переносы и отступы между тегами в исходнике — тоже текст. Парсер
сохраняет их как узлы `Text`. В разметке

```html
<ul>
  <li>Один</li>
  <li>Два</li>
</ul>
```

у `ul` **пять** узлов в `childNodes`: текст, `li`, текст, `li`, текст. А в `children` — два.
Поэтому `ul.firstChild.textContent` вернёт `"\n  "`, а не «Один». Это частая ошибка новичков и
причина, по которой «набор `Element`» в таблице выше появился в DOM позже.

<details>
<summary>childNodes против children</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-dom.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  ul { border: 2px solid #69c; }
  pre { background: #f3f3f3; padding: 8px; }
</style>
</head>
<body>
<ul id="list">
  <li>Один</li>
  <li>Два</li>
</ul>
<pre id="out"></pre>
<script>
  var ul = document.getElementById('list');
  var lines = ['childNodes: ' + ul.childNodes.length, 'children: ' + ul.children.length, ''];
  ul.childNodes.forEach(function (n, i) {
    lines.push(i + ': ' + n.nodeName + '  ' + JSON.stringify(n.textContent));
  });
  lines.push('', 'firstChild: ' + JSON.stringify(ul.firstChild.textContent));
  lines.push('firstElementChild: ' + JSON.stringify(ul.firstElementChild.textContent));
  document.getElementById('out').textContent = lines.join('\n');
</script>
</body>
</html>
```

</details>

Для сложного обхода есть `document.createTreeWalker(root, NodeFilter.SHOW_TEXT)`: он даёт все
узлы нужного типа в порядке документа, без ручной рекурсии. Так ищут текст для подсветки.

## 4. Создание и вставка

### 4.1. Создание узлов

```js
const li = document.createElement('li');     // элемент HTML
const t  = document.createTextNode('текст'); // текстовый узел
const c  = el.cloneNode(true);               // глубокая копия (без обработчиков addEventListener!)
```

Для SVG нужен `document.createElementNS('http://www.w3.org/2000/svg', 'circle')`: обычный
`createElement('circle')` создаст `HTMLUnknownElement`, который ничего не нарисует.

### 4.2. Методы вставки

| Метод | Куда | Принимает строки как текст | Возвращает |
|---|---|---|---|
| `parent.append(...nodes)` | в конец | да | — |
| `parent.prepend(...nodes)` | в начало | да | — |
| `el.before(...)`, `el.after(...)` | рядом с `el` | да | — |
| `el.replaceWith(...)` | вместо `el` | да | — |
| `parent.replaceChildren(...)` | заменить всех детей | да | — |
| `el.remove()` | удалить | — | — |
| `parent.appendChild(node)` | в конец, старый API | нет | узел |
| `parent.insertBefore(node, ref)` | перед `ref` (`null` = в конец) | нет | узел |

Ключевое правило: **узел может быть только в одном месте**. Вставка существующего узла его
**перемещает**, а не копирует. Так переставляют элементы списка без пересоздания.

Строки, переданные в `append`/`before`, становятся **текстовыми узлами**: `el.append('<b>')`
покажет буквальное `<b>`, а не жирный текст. Это безопасно.

### 4.3. `insertAdjacentHTML` и позиции

`el.insertAdjacentHTML(position, html)` разбирает строку как HTML и вставляет результат, **не
трогая** существующих детей (в отличие от `innerHTML +=`, который пересоздаёт всё содержимое,
теряя обработчики, фокус и введённый текст). Позиции:

```text
<!-- beforebegin -->
<div>
  <!-- afterbegin -->
  …существующее содержимое…
  <!-- beforeend -->
</div>
<!-- afterend -->
```

Есть парные `insertAdjacentElement` и `insertAdjacentText`.

### 4.4. `<template>` и `DocumentFragment`

**`DocumentFragment`** — лёгкий узел-контейнер без родителя. При вставке во фрагмент узлы не
попадают в документ; при вставке самого фрагмента в документ переносятся **его дети**, а сам он
остаётся пустым. Это удобно, чтобы собрать сотню элементов и вставить одной операцией.

> Совет «собирайте во фрагменте, иначе будет сто перерисовок» устарел наполовину. Браузер и так
> не перерисовывает после каждой вставки — отрисовка происходит после задачи (курс
> [Введение](LEARN_JAVASCRIPT_INTRODUCTION_COURSE.md)). Реальная цена появляется, когда вы между
> вставками **читаете** геометрию (`offsetHeight`) — это заставляет раскладку пересчитываться
> синхронно. Фрагмент полезен прежде всего как удобная единица вставки, а `append(...nodes)` с
> несколькими аргументами делает то же самое.

**`<template>`** — элемент, содержимое которого **разбирается, но не становится частью документа**:
картинки внутри не грузятся, скрипты не выполняются, селекторы на странице его детей не находят.
Содержимое лежит в `template.content` — это `DocumentFragment`. Клонируйте его и заполняйте:

<details>
<summary>Список из template: клонирование и вставка одним махом</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-dom.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  .card { display: flex; gap: 8px; align-items: center; border: 1px solid #ccc;
          border-left: 4px solid var(--c); padding: 6px 10px; margin: 4px 0; border-radius: 4px; }
  .swatch { width: 20px; height: 20px; background: var(--c); border-radius: 50%; }
</style>
</head>
<body>
<template id="tpl">
  <div class="card"><span class="swatch"></span><b class="name"></b><code class="hex"></code></div>
</template>
<div id="list"></div>
<p id="info"></p>
<script>
  var colors = [['Кирпич', '#b5452f'], ['Море', '#2f6db5'], ['Мох', '#5a8a2f']];
  var tpl = document.getElementById('tpl');
  var frag = document.createDocumentFragment();
  colors.forEach(function (c) {
    var node = tpl.content.cloneNode(true);     // глубокая копия содержимого
    var card = node.querySelector('.card');
    card.style.setProperty('--c', c[1]);
    node.querySelector('.name').textContent = c[0];  // данные только через textContent
    node.querySelector('.hex').textContent = c[1];
    frag.append(node);
  });
  document.getElementById('list').append(frag);
  document.getElementById('info').textContent =
    'Карточек в документе: ' + document.querySelectorAll('.card').length +
    '; фрагмент после вставки пуст: ' + (frag.childNodes.length === 0);
</script>
</body>
</html>
```

</details>

Шаблон даёт лучшее из двух миров: структура пишется как обычный HTML (читаемо, подсветка в
редакторе), а данные вставляются через `textContent` (безопасно).

## 5. `innerHTML`, `textContent`, `innerText`

| Свойство | Чтение | Запись | Учитывает CSS | Цена |
|---|---|---|---|---|
| `innerHTML` | сериализует детей в HTML | **разбирает строку как HTML** | нет | разбор |
| `textContent` | весь текст всех потомков, включая `<script>`, `<style>` и скрытое | один текстовый узел | нет | дёшево |
| `innerText` | текст **как он показан**: без скрытого, с переносами блоков, с учётом `text-transform` | текст, `\n` превращаются в `<br>` | да | **вызывает раскладку** |
| `outerHTML` | элемент вместе с собой | заменяет сам элемент | нет | разбор |

### 5.1. Безопасность

Запись в `innerHTML` строки, в которой есть данные пользователя, — классическая дыра XSS. `<script>`,
вставленный через `innerHTML`, по спецификации **не выполняется**, но это не защита:

```js
el.innerHTML = '<img src=x onerror="alert(document.cookie)">'; // выполнится
```

Правило: **данные — через `textContent` (или `append` строки), структура — через создание
элементов или `<template>`**. Если HTML из чужого источника нужен (например, отрисованный Markdown),
его надо очищать санитайзером. Современные браузеры начинают поддерживать `el.setHTML()` со
встроенной очисткой, но опираться на неё можно только после проверки поддержки.

### 5.2. Цена `innerText`

`innerText` должен знать, что видно и где переносы, — значит, ему нужны актуальные стили и
раскладка. Чтение `innerText` после изменения DOM вызывает **принудительную синхронную раскладку**
(forced synchronous layout). В цикле по тысяче элементов это заметно. Если нужен «весь текст» —
берите `textContent`.

<details>
<summary>Три свойства на одном элементе</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-dom.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  #src { border: 2px dashed #888; padding: 8px; }
  .up { text-transform: uppercase; }
  pre { background: #f3f3f3; padding: 8px; white-space: pre-wrap; }
  h4 { margin: 12px 0 2px; }
</style>
</head>
<body>
<div id="src">
  <p>Первый <span class="up">абзац</span></p>
  <p style="display:none">Скрытый абзац</p>
  <p>Второй &amp; последний</p>
  <style>/* стиль внутри */</style>
</div>
<h4>innerHTML</h4><pre id="a"></pre>
<h4>textContent</h4><pre id="b"></pre>
<h4>innerText</h4><pre id="c"></pre>
<script>
  var src = document.getElementById('src');
  document.getElementById('a').textContent = src.innerHTML;
  document.getElementById('b').textContent = src.textContent;
  document.getElementById('c').textContent = src.innerText;
</script>
</body>
</html>
```

</details>

`textContent` включил скрытый абзац и текст CSS-комментария из `<style>`; `innerText` их убрал, а
«абзац» показал заглавными — как на экране.

## 6. Атрибуты и свойства

**Атрибут** (attribute) — то, что написано в разметке; всегда строка; доступен через
`getAttribute`/`setAttribute`/`removeAttribute`/`hasAttribute`/`toggleAttribute`. **Свойство**
(property) — поле JavaScript-объекта; может быть любого типа. Для стандартных атрибутов свойства
**отражают** (reflect) атрибуты, но отражение бывает разным:

| Атрибут | Свойство | Особенность |
|---|---|---|
| `id` | `el.id` | полное зеркало |
| `class` | `el.className`, `el.classList` | имя отличается: `class` — зарезервированное слово |
| `for` | `label.htmlFor` | то же |
| `href="page.html"` | `a.href` | свойство — **абсолютный** URL, атрибут — как написано |
| `checked` | `input.checked` | атрибут = **начальное** состояние (`defaultChecked`), свойство = текущее |
| `value` у `<input>` | `input.value` | атрибут = `defaultValue`; после ввода пользователем расходятся |
| `disabled`, `hidden` | булево | наличие атрибута = `true`; `disabled="false"` — это всё равно `true`! |
| `tabindex` | `el.tabIndex` | число; при отсутствии атрибута — значение по умолчанию |

Нестандартные атрибуты (`<div foo="1">`) свойствами не становятся: `div.foo === undefined`. Для
своих данных есть `data-*` (раздел 8).

<details>
<summary>value: атрибут и свойство расходятся</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-dom.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  input { padding: 6px; font: inherit; }
  pre { background: #f3f3f3; padding: 8px; }
</style>
</head>
<body>
<p>Напечатайте что-нибудь в поле, отметьте и снимите флажок — и смотрите на таблицу.</p>
<input id="i" value="начальное">
<label><input type="checkbox" id="c" checked> флажок</label>
<p><a id="a" href="page.html">ссылка</a> <button id="r">Сбросить форму</button></p>
<pre id="out"></pre>
<form id="f" hidden></form>
<script>
  var i = document.getElementById('i'), c = document.getElementById('c'), a = document.getElementById('a');
  function show() {
    document.getElementById('out').textContent =
      'input  атрибут value:   ' + JSON.stringify(i.getAttribute('value')) + '\n' +
      'input  свойство value:  ' + JSON.stringify(i.value) + '\n' +
      'флажок атрибут checked: ' + c.hasAttribute('checked') + '\n' +
      'флажок свойство checked:' + c.checked + '\n' +
      'a      атрибут href:    ' + a.getAttribute('href') + '\n' +
      'a      свойство href:   ' + a.href;
  }
  document.addEventListener('input', show);
  document.addEventListener('change', show);
  document.getElementById('r').onclick = function () {
    i.value = i.defaultValue; c.checked = c.defaultChecked; show();
  };
  show();
</script>
</body>
</html>
```

</details>

Практический вывод: **текущее состояние читайте из свойства**. Атрибут — это «что было в разметке»
и то, что видят CSS-селекторы атрибутов: `input[value="x"]` не реагирует на ввод.

## 7. `classList`

`el.classList` — объект `DOMTokenList`: `add`, `remove`, `toggle(name, force?)`, `contains`,
`replace`. Он меняет только нужный класс, тогда как запись `el.className = 'active'` стирает
все остальные. `toggle` со вторым аргументом заменяет условный `if`:

```js
row.classList.toggle('is-selected', id === selectedId);
```

Управлять видом через классы, а не через `style`, — правильная граница ответственности: JavaScript
говорит **что** (состояние), CSS — **как** (оформление, переходы, медиазапросы).

## 8. `dataset`

Атрибуты `data-*` доступны через `el.dataset`. Имена переводятся из kebab-case в camelCase:
`data-user-id` ↔ `dataset.userId`. Значения — **всегда строки**: `dataset.count = 5` запишет
`"5"`, а `dataset.flag = false` — строку `"false"`, которая истинна в `if`. Удаление —
`delete el.dataset.userId`.

`data-*` удобны для связи разметки и кода (`data-action="delete"` на кнопке) и видны CSS:
`[data-state="open"]` и `content: attr(data-label)`.

<details>
<summary>dataset, classList и CSS по атрибуту</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-dom.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  .lamp { display: inline-block; width: 90px; padding: 10px; margin: 4px; text-align: center;
          border: 2px solid #999; border-radius: 6px; cursor: pointer; background: #eee; }
  .lamp[data-state="on"] { background: #ffe066; border-color: #c90; }
  .lamp::after { content: " (" attr(data-clicks) ")"; color: #666; }
  .lamp.is-last { outline: 3px solid #36a; outline-offset: 2px; }
</style>
</head>
<body>
<p>Нажимайте на лампы. Состояние хранится в data-state, счётчик — в data-clicks.</p>
<div class="lamp" data-state="off" data-clicks="0">Кухня</div>
<div class="lamp" data-state="off" data-clicks="0">Зал</div>
<div class="lamp" data-state="off" data-clicks="0">Двор</div>
<script>
  document.querySelectorAll('.lamp').forEach(function (lamp) {
    lamp.addEventListener('click', function () {
      lamp.dataset.state = lamp.dataset.state === 'on' ? 'off' : 'on';
      lamp.dataset.clicks = Number(lamp.dataset.clicks) + 1;   // строки, отсюда Number
      document.querySelectorAll('.lamp').forEach(function (l) {
        l.classList.toggle('is-last', l === lamp);
      });
    });
  });
</script>
</body>
</html>
```

</details>

## 9. `style` и `getComputedStyle`

`el.style` — это **встроенный стиль** элемента, то есть атрибут `style`. Отсюда:

- читая `el.style.color`, вы получите только то, что записано в атрибуте, а не итоговый цвет из
  таблиц стилей (чаще всего — пустую строку);
- запись в `el.style` имеет специфичность встроенного стиля и перебивает правила таблиц (кроме
  `!important`) — см. [Каскад](LEARN_CSS_CASCADE_COURSE.md);
- имена свойств в camelCase (`el.style.backgroundColor`) или через `setProperty('background-color', …)`.
  Пользовательские свойства — **только** через `setProperty('--c', …)` и `getPropertyValue('--c')`;
- `el.style.color = ''` удаляет объявление; некорректное значение молча игнорируется.

`getComputedStyle(el)` возвращает **вычисленный стиль** после каскада и наследования — объект
только для чтения. Обычно значения в нём — **используемые** (resolved): `width` в пикселях, цвета
в `rgb()`. Вторым аргументом можно спросить о псевдоэлементе: `getComputedStyle(el, '::before')`.

Цена: чтение геометрических значений из `getComputedStyle` после изменений DOM, как и
`offsetWidth`, `getBoundingClientRect()`, заставляет браузер пересчитать стили и раскладку
синхронно. Чередование «записал — прочитал» в цикле называется **layout thrashing**.

<details>
<summary>style пуст, getComputedStyle знает всё</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-dom.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  .box { width: 50%; padding: 1em; color: tomato; border: 3px solid currentColor; }
  .box::before { content: "★ "; color: gold; }
  pre { background: #f3f3f3; padding: 8px; font-size: 14px; }
  body { font: 15px/1.5 system-ui, sans-serif; }
</style>
</head>
<body>
<div class="box" id="b" style="font-weight: bold">Коробка</div>
<pre id="out"></pre>
<script>
  var b = document.getElementById('b');
  var cs = getComputedStyle(b);
  document.getElementById('out').textContent = [
    'style.color:        ' + JSON.stringify(b.style.color),
    'style.fontWeight:   ' + JSON.stringify(b.style.fontWeight),
    'computed color:     ' + cs.color,
    'computed width:     ' + cs.width + '   (в CSS было 50%)',
    'computed padding:   ' + cs.paddingTop + '   (в CSS было 1em)',
    'computed fontWeight:' + cs.fontWeight,
    '::before color:     ' + getComputedStyle(b, '::before').color
  ].join('\n');
</script>
</body>
</html>
```

</details>

## 10. Живые и статичные коллекции

Методы возвращают коллекции двух видов:

| Возвращает | Тип | Живая? |
|---|---|---|
| `el.children`, `getElementsByTagName`, `getElementsByClassName`, `form.elements`, `document.forms` | `HTMLCollection` | **да** |
| `el.childNodes` | `NodeList` | **да** |
| `querySelectorAll` | `NodeList` | нет (снимок) |

**Живая** (live) коллекция при каждом обращении отражает текущее состояние дерева. Отсюда
классические ошибки:

- удаление в цикле `for (i = 0; i < c.length; i++) c[i].remove()` удаляет каждый **второй**
  элемент: после удаления все сдвигаются, а `i` растёт;
- цикл, который добавляет элементы того же класса, по живой коллекции **никогда не закончится**;
- снятие класса у элементов из `getElementsByClassName('x')` выбрасывает их из коллекции прямо
  в цикле.

Лечение: обходить с конца, или превратить в массив (`Array.from(c)`, `[...c]`), или взять снимок
`querySelectorAll`. У `HTMLCollection` нет `forEach`; у `NodeList` есть.

<details>
<summary>Снять класс со всех: живая коллекция против снимка</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-dom.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  span { display: inline-block; width: 32px; height: 32px; margin: 2px; line-height: 32px;
         text-align: center; border: 1px solid #999; background: #eee; }
  span.hot { background: #e55; color: #fff; }
</style>
</head>
<body>
<p>Обе кнопки снимают класс hot с каждого элемента коллекции в цикле for.</p>
<div id="row"></div>
<button id="live">Живая getElementsByClassName</button>
<button id="snap">Снимок querySelectorAll</button>
<button id="reset">Заново</button>
<p id="out"></p>
<script>
  var row = document.getElementById('row');
  function reset() {
    row.innerHTML = '';
    for (var k = 1; k <= 8; k++) {
      var s = document.createElement('span'); s.className = 'hot'; s.textContent = k; row.append(s);
    }
    document.getElementById('out').textContent = '';
  }
  function run(c, label) {
    for (var i = 0; i < c.length; i++) c[i].classList.remove('hot');
    document.getElementById('out').textContent =
      label + ': осталось красных ' + row.querySelectorAll('.hot').length;
  }
  document.getElementById('live').onclick = function () { run(row.getElementsByClassName('hot'), 'живая'); };
  document.getElementById('snap').onclick = function () { run(row.querySelectorAll('.hot'), 'снимок'); };
  document.getElementById('reset').onclick = reset;
  reset();
</script>
</body>
</html>
```

</details>

С живой коллекцией красными остались чётные квадраты: каждый снятый класс укорачивал коллекцию.

## 11. `MutationObserver`

`MutationObserver` сообщает об изменениях в поддереве: добавление и удаление детей (`childList`),
атрибуты (`attributes`, с фильтром `attributeFilter` и `attributeOldValue`), текст
(`characterData`), и всё это во всём поддереве (`subtree: true`).

Как он устроен относительно цикла событий: записи об изменениях **копятся**, а колбэк вызывается
**микрозадачей** — один раз на пачку изменений, после текущего синхронного кода, но до отрисовки.
Сто вставок подряд дадут один вызов с сотней записей. Старые «события мутаций» (`DOMNodeInserted`)
срабатывали синхронно на каждое изменение, тормозили всё и удалены из браузеров.

Где применяют: реагировать на разметку, которую добавляет чужой код; следить за атрибутом,
который меняет библиотека; ленивая инициализация виджетов в динамическом контенте.

Ловушки: изменение DOM внутри колбэка в наблюдаемой области даёт новую запись — легко получить
бесконечный цикл; `observer.disconnect()` отключает, `observer.takeRecords()` забирает
накопленное синхронно.

<details>
<summary>MutationObserver: одна пачка на много изменений</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-dom.html#example-9">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; }
  #box { min-height: 40px; border: 2px dashed #69c; padding: 6px; margin: 6px 0; }
  #box i { display: inline-block; padding: 2px 6px; margin: 2px; background: #def; }
  #log { background: #f3f3f3; padding: 8px; font: 13px monospace; }
</style>
</head>
<body>
<button id="add">Добавить 5 элементов</button>
<button id="attr">Сменить атрибут</button>
<div id="box" data-mode="a"></div>
<pre id="log"></pre>
<script>
  var box = document.getElementById('box'), log = document.getElementById('log');
  var observer = new MutationObserver(function (records) {
    var added = 0, attrs = [];
    records.forEach(function (r) {
      if (r.type === 'childList') added += r.addedNodes.length;
      if (r.type === 'attributes') attrs.push(r.attributeName + ': ' + r.oldValue + ' → ' + box.getAttribute(r.attributeName));
    });
    log.textContent += 'вызов колбэка: записей ' + records.length + ', добавлено ' + added +
      (attrs.length ? ', атрибуты ' + attrs.join('; ') : '') + '\n';
  });
  observer.observe(box, { childList: true, attributes: true, attributeOldValue: true });
  document.getElementById('add').onclick = function () {
    for (var k = 0; k < 5; k++) { var e = document.createElement('i'); e.textContent = k; box.append(e); }
    log.textContent += 'синхронный код закончился\n';
  };
  document.getElementById('attr').onclick = function () {
    box.dataset.mode = box.dataset.mode === 'a' ? 'b' : 'a';
  };
</script>
</body>
</html>
```

</details>

Строка «синхронный код закончился» появляется **раньше** записи колбэка — это и есть микрозадача.

## Итог

- DOM — живое дерево объектов; отлаживайте его, а не исходный HTML.
- Интерфейсы наследуются: `Node` (дерево) → `Element` (атрибуты, селекторы) → `HTMLElement`.
  У текстовых узлов нет методов элемента.
- `childNodes` включает пробельные текстовые узлы, `children` — только элементы.
- Вставка существующего узла его перемещает. Строки в `append` — текст, а не HTML.
- Данные — через `textContent`, структура — через элементы и `<template>`. `innerHTML` с данными —
  XSS; `innerText` стоит раскладки.
- Атрибут — исходное значение в разметке, свойство — текущее состояние.
- `el.style` — только встроенный стиль; итог — `getComputedStyle`.
- Живые коллекции меняются на ходу; перед циклом с изменениями делайте снимок.
- `MutationObserver` вызывается микрозадачей, пачками.

## Проверьте себя

1. Почему `ul.firstChild.classList.add('x')` может бросить `TypeError`? Как исправить двумя способами?
2. Чем `el.innerHTML += '<li>…</li>'` хуже `el.insertAdjacentHTML('beforeend', …)`, кроме скорости?
3. Пользователь ввёл текст в `<input value="a">`. Что вернут `getAttribute('value')` и `.value`?
   Сработает ли селектор `input[value="a"]`?
4. Почему `el.style.width` пуст, хотя ширина задана в CSS? Что дороже прочитать в цикле — его или
   `getComputedStyle(el).width`, и почему?
5. Почему цикл `for` с `remove()` по `getElementsByTagName('li')` удаляет лишь половину?

Дальше: [Селекторы в JavaScript](LEARN_JAVASCRIPT_SELECTORS_COURSE.md).
