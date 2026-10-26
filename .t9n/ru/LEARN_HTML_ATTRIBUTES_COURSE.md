# Атрибуты

> Курс 25 из программы. Для тех, кто уверенно пишет разметку и хочет понимать атрибуты так, как их
> понимает браузер: какие значения у атрибута бывают, что происходит с неверным значением, чем
> атрибут отличается от одноимённого свойства DOM-объекта и почему `disabled="false"` отключает
> кнопку.

**Что вы будете понимать после курса**

- как парсер читает атрибуты: регистр, кавычки, повторы;
- **глобальные атрибуты**: `id`, `class`, `lang`, `dir`, `hidden` (включая `until-found`), `title`,
  `tabindex`, `inert`, `contenteditable`, `data-*`, `translate`, `popover`;
- семантику **логических атрибутов** (boolean attributes);
- разницу между **атрибутом** и **свойством**: `value` / `defaultValue`, `checked` / `defaultChecked`;
- как разрешаются URL-атрибуты;
- **перечисляемые атрибуты** (enumerated attributes) и значения по умолчанию для пропущенного и
  неверного значения.

---

## 1. Как парсер читает атрибуты

```html
<input TYPE=checkbox checked data-x='a "b"' class="one two">
```

- Имена атрибутов в HTML-документе **приводятся к нижнему регистру**: `TYPE` станет `type`. (В SVG
  внутри HTML парсер восстанавливает «верблюжьи» имена вроде `viewBox`.)
- Кавычки нужны, только если значение пустое или содержит пробел, `"`, `'`, `=`, `<`, `>`, `` ` ``.
  Писать кавычки всегда — просто надёжнее.
- Атрибут без значения (`checked`) получает значение — **пустую строку**.
- **Повторный атрибут отбрасывается**: побеждает первый. Это ошибка разбора, но не исключение.

<details>
<summary>Повторный атрибут и регистр имён</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-attributes.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Разбор атрибутов</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  .red { color: #c33; } .blue { color: #234f9c; }
  pre { background: #f4f4f4; padding: 8px; }
</style>
</head>
<body>
  <p id="x" class="red" class="blue" DATA-Info="пример" hidden-not-real>Какого я цвета?</p>
  <pre id="out"></pre>
  <script>
    const p = document.getElementById('x');
    document.getElementById('out').textContent =
      [...p.attributes].map(a => a.name + ' = "' + a.value + '"').join('\n') +
      '\n\nВторой class отброшен парсером, имя DATA-Info стало data-info.';
  </script>
</body>
</html>
```

</details>

## 2. Глобальные атрибуты

**Глобальные атрибуты** разрешены на любом элементе HTML. Разберём те, у которых есть подвохи.

### 2.1. `id`

- Должен быть **уникален** в документе (точнее, в своём дереве — в теневом DOM своё пространство
  имён), непуст и без пробелов. Дубликат не вызовет ошибки: `getElementById` вернёт первый, а
  `<label for>` и `aria-labelledby` сломаются молча.
- Цель фрагмента URL: `page.html#intro` прокручивает к `id="intro"` и включает псевдокласс
  `:target`.
- **Именованный доступ**: элемент с `id="menu"` доступен как глобальная переменная `window.menu`.
  Не полагайтесь на это — любая переменная с тем же именем его затенит.
- В CSS у `#id` специфичность (1,0,0) — её трудно перебить. Поэтому для стилей обычно берут
  классы, а `id` оставляют для связей (`for`, `aria-*`, якоря). См.
  [Каскад и специфичность](LEARN_CSS_CASCADE_COURSE.md).
- `id`, начинающийся с цифры, допустим в HTML, но в CSS-селекторе его надо экранировать:
  `#\31 23` или `[id="123"]`.

### 2.2. `class`

Список токенов через пробельные символы. Порядок классов в атрибуте **ни на что не влияет** —
важен порядок правил в CSS. Из JS — `classList` (`add`, `remove`, `toggle`, `contains`, `replace`);
свойство называется `className`, потому что `class` — зарезервированное слово JS.

### 2.3. `lang` и `dir`

`lang` **наследуется** по дереву: его значение у элемента — ближайший предок с `lang`. От него
зависят произношение синтезатора, перенос `hyphens: auto`, кавычки `<q>`, выбор глифов (одни и те же
иероглифы в японском и китайском выглядят по-разному), проверка орфографии. Селектор `:lang(en)`
учитывает наследование, а `[lang="en"]` — нет.

`dir` — направление текста: `ltr`, `rtl`, `auto` (браузер решит по первому сильному символу). Его
ставят в HTML, а не только CSS-свойством `direction`, потому что направление — смысл: без него
при отключённых стилях арабский текст рассыплется. Для вставки пользовательского текста с неизвестным
направлением — `<bdi>` или `dir="auto"`.

### 2.4. `hidden` и `hidden="until-found"`

`hidden` означает «элемент сейчас не имеет отношения к странице». Реализован он одной строкой стилей
браузера:

```css
[hidden] { display: none; }
```

Отсюда главная ловушка: **авторский CSS побеждает стили браузера** (по каскаду, независимо от
специфичности), поэтому `.panel { display: flex }` делает «скрытую» панель видимой. Лечится одним
правилом в начале своих стилей: `[hidden] { display: none !important; }`.

Значение `until-found` — скрытое, но **находимое**: элемент получает `content-visibility: hidden`
(место в раскладке пропадает, содержимое не рисуется), однако поиск по странице (Ctrl+F) и переход
по `#якорю` его находят. Браузер тогда снимает атрибут и посылает событие `beforematch`. Так делают
свёрнутые разделы, текст которых всё равно ищется. Поддержка неполная: в браузере без неё
`until-found` работает как обычный `hidden`.

<details>
<summary>hidden против авторского display и until-found</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-attributes.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>hidden</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  .panel { display: flex; gap: 8px; padding: 8px; border: 2px solid #c33; background: #ffecec; margin: 8px 0; }
  .fixed[hidden] { display: none; }
  .found { border: 2px solid #3a7bd5; padding: 8px; background: #eef6ff; }
</style>
</head>
<body>
  <div class="panel" hidden>1. hidden, но .panel { display: flex } его перебил — видно!</div>
  <div class="panel fixed" hidden>2. Этого не видно: правило [hidden] восстановлено.</div>
  <p>Ниже свёрнутый текст. Нажмите Ctrl+F (Cmd+F) и найдите слово «жирафа».</p>
  <div class="found" hidden="until-found" id="f">Здесь спрятано описание жирафа.</div>
  <p id="log"></p>
  <script>
    document.getElementById('f').addEventListener('beforematch', () => {
      document.getElementById('log').textContent = 'beforematch: браузер снял hidden, чтобы показать находку.';
    });
  </script>
</body>
</html>
```

</details>

Альтернативы `hidden` и их различия:

| Способ | Место в раскладке | Видят скринридеры | Фокус | Поиск по странице |
|---|---|---|---|---|
| `hidden` / `display: none` | нет | нет | нет | нет |
| `hidden="until-found"` | нет | нет | нет | **да** |
| `visibility: hidden` | **есть** | нет | нет | нет |
| `opacity: 0` | есть | **да** | **да** | да |
| `inert` | есть | нет | нет | нет |
| класс `.visually-hidden` (клип 1px) | почти нет | **да** | да | зависит от браузера |

### 2.5. `title` — подсказка с подвохами

`title` показывает всплывающую подсказку при наведении мыши. Проблемы:

- её **не видно** на сенсорных экранах и при навигации с клавиатуры (фокус её не показывает);
- скринридеры читают её непоследовательно — иногда как описание, иногда никак;
- она появляется с задержкой, её нельзя стилизовать, и она исчезает, когда хочется прочитать;
- `title` у `<link rel="stylesheet">`, `<abbr>`, `<dfn>`, `<iframe>` имеет **особый смысл** (имя
  набора стилей, расшифровка, термин, имя фрейма).

Правило: важную информацию в `title` не прячут. У `<iframe>` `title` — его доступное имя, там
он нужен. Для подсказок — видимый текст или `popover`.

### 2.6. `tabindex`

| Значение | Фокус по Tab | Фокус из JS (`el.focus()`) | Применение |
|---|---|---|---|
| нет атрибута | только у фокусируемых по природе (`a[href]`, `button`, `input`…) | так же | по умолчанию |
| `0` | **да**, в порядке документа | да | свой интерактивный виджет |
| `-1` | **нет** | да | цель программного фокуса: заголовок после перехода, контейнер диалога |
| `1` и больше | **раньше всех**, по возрастанию | да | **не используйте** |

Положительный `tabindex` создаёт отдельную очередь, которая обходится раньше всего документа. На
реальной странице это значит: Tab прыгает по десятку элементов в непредсказуемом порядке, а
порядок легко ломается при любой правке. Если порядок фокуса не совпадает с визуальным — меняйте
порядок в DOM.

<details>
<summary>Порядок Tab с положительным tabindex</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-attributes.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>tabindex</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  button, [tabindex] { margin: 4px; padding: 6px 10px; }
  :focus-visible { outline: 3px solid #c33; outline-offset: 2px; }
  span[tabindex] { display: inline-block; border: 1px dashed #888; }
</style>
</head>
<body>
  <p>Щёлкните на пустое место страницы и нажимайте Tab. Порядок: 3, 1, 2, 4, а «-1» пропускается.</p>
  <button>1 (без tabindex)</button>
  <button>2 (без tabindex)</button>
  <button tabindex="1">3 (tabindex="1")</button>
  <span tabindex="0">4 (span с tabindex="0")</span>
  <span tabindex="-1">-1 (только из JS)</span>
</body>
</html>
```

</details>

### 2.7. `inert`

`inert` делает поддерево **инертным**: по нему нельзя кликнуть, в него нельзя попасть фокусом,
его текст не выделяется и не находится поиском, скринридер его не видит. Это то, что
`showModal()` делает со всей остальной страницей, но вручную: выезжающее меню, неактивный шаг
мастера, содержимое за собственным оверлеем. Внешне элемент не меняется — затемнение добавляйте
сами, например `[inert] { opacity: .5 }`.

### 2.8. `contenteditable`

| Значение | Состояние |
|---|---|
| `true` или пустая строка | редактируемый, с форматированием (Ctrl+B вставит `<b>`) |
| `plaintext-only` | редактируется только текст, без разметки при вставке |
| `false` | не редактируемый (полезно внутри редактируемого предка) |
| неверное значение | **наследуется** от родителя (inherit) |

Редактируемый элемент фокусируется и получает событие `input`; результат — `innerHTML` или
`textContent`. Рядом стоят `spellcheck` (`true`/`false`), `autocapitalize`, `enterkeyhint`,
`inputmode` — они управляют проверкой орфографии и экранной клавиатурой.

<details>
<summary>inert и contenteditable</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-attributes.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>inert и contenteditable</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  fieldset { margin: 8px 0; border: 2px solid #3a7bd5; }
  [inert] { opacity: .45; }
  .ed { border: 2px dashed #1b6e3a; padding: 8px; min-height: 2em; }
  .ed:focus { outline: 3px solid #1b6e3a; }
  pre { background: #f4f4f4; padding: 6px; white-space: pre-wrap; }
</style>
</head>
<body>
  <label><input type="checkbox" id="t" checked> Сделать блок инертным</label>
  <fieldset id="box" inert>
    <legend>Шаг 2</legend>
    <button>Кнопка</button> <a href="#">Ссылка</a> <input value="Поле">
    <p>Пока стоит inert, сюда нельзя кликнуть, перейти по Tab или выделить текст.</p>
  </fieldset>
  <p>Редактируемые блоки: попробуйте вставить текст с форматированием в оба.</p>
  <div class="ed" contenteditable="true">contenteditable="true": <b>жирный</b> текст.</div>
  <div class="ed" contenteditable="plaintext-only">contenteditable="plaintext-only"</div>
  <pre id="html"></pre>
  <script>
    document.getElementById('t').onchange = e => document.getElementById('box').inert = e.target.checked;
    const ed = document.querySelector('.ed');
    const show = () => document.getElementById('html').textContent = 'innerHTML первого: ' + ed.innerHTML;
    ed.addEventListener('input', show); show();
  </script>
</body>
</html>
```

</details>

### 2.9. `data-*`

Свои данные на элементе: `data-` + имя из строчных букв, цифр, дефисов. Из JS — через `dataset`,
где имена переводятся в «верблюжий» регистр:

| Атрибут | `dataset` |
|---|---|
| `data-id` | `dataset.id` |
| `data-user-name` | `dataset.userName` |
| `data-x-2` | `dataset['x-2']` (за дефисом не буква — не переводится) |

Значение всегда **строка**: `dataset.count = 5` запишет `"5"`, а `delete el.dataset.count` удалит
атрибут. В CSS `data-*` доступны селекторам (`[data-state="open"]`) и функции `attr()` в `content`.
Это хорошая замена классам-состояниям: `data-state` хранит одно значение из нескольких, а не
набор взаимоисключающих классов.

### 2.10. `translate`

`translate="no"` просит автоматический перевод (Chrome, Google Translate) не трогать фрагмент:
названия продукта, код, имена. Значение `yes` — по умолчанию, наследуется. Сам документ можно
целиком пометить `<html translate="no">`, а `<code>` полезно помечать всегда.

### 2.11. `popover`

Делает любой элемент **всплывающим**: он скрыт (UA-стиль `[popover]:not(:popover-open) { display: none }`),
а при показе уходит в верхний слой — поверх всего, без `z-index` и без обрезки `overflow` предков.

| Значение | Закрытие кликом мимо и Esc (light dismiss) | Закрывает другие `auto` |
|---|---|---|
| `auto` (или пустое) | да | да |
| `manual` | нет, только явно | нет |
| `hint` | да | закрывает только другие `hint` |

Открывать можно без JS: `<button popovertarget="id">` и `popovertargetaction="show|hide|toggle"`.
Кнопка-инициатор при этом получает правильную связь для скринридера, а фокус после закрытия
возвращается на неё. Из JS — `showPopover()`, `hidePopover()`, `togglePopover()`, событие `toggle`.
Значение `hint` поддерживается не везде; там, где его нет, оно считается неверным и превращается в
`manual`.

<details>
<summary>popover без JavaScript</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-attributes.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>popover</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  .clip { overflow: hidden; height: 60px; border: 2px dashed #888; padding: 8px; position: relative; z-index: 1; }
  [popover] { border: 3px solid #3a7bd5; border-radius: 8px; padding: 12px 16px; }
  [popover]::backdrop { background: rgb(0 0 0 / .15); }
  #m { border-color: #c33; }
</style>
</head>
<body>
  <div class="clip">
    Кнопки внутри блока с overflow: hidden:
    <button popovertarget="a">auto</button>
    <button popovertarget="m">manual</button>
  </div>
  <div id="a" popover>popover="auto": закроется кликом мимо или Esc. Обрезка предка не мешает.</div>
  <div id="m" popover="manual">popover="manual": закрывается только кнопкой.
    <button popovertarget="m" popovertargetaction="hide">Закрыть</button></div>
</body>
</html>
```

</details>

## 3. Логические атрибуты

**Логический атрибут** (boolean attribute) — это `true`, если атрибут **присутствует**, и `false`,
если его **нет**. Значение не читается вовсе. Допустимые записи: `disabled`, `disabled=""`,
`disabled="disabled"`. Всё прочее (`disabled="false"`, `disabled="no"`) невалидно, но всё равно
означает «отключено».

```js
btn.setAttribute('disabled', 'false'); // кнопка ОТКЛЮЧЕНА
btn.removeAttribute('disabled');       // вот так включают
btn.disabled = false;                  // или через свойство: оно само удалит атрибут
btn.toggleAttribute('disabled');       // переключить
```

Логические: `disabled`, `checked`, `selected`, `readonly`, `required`, `multiple`, `autofocus`,
`hidden` (в форме без значения), `open`, `inert`, `defer`, `async`, `novalidate`, `controls`,
`loop`, `muted`, `playsinline`.

Ловушка шаблонизаторов: `<input checked="{{ isChecked }}">` при `false` даёт `checked="false"` —
флажок отмечен. Шаблон должен **не выводить** атрибут, а не выводить его со значением `false`.

Не путайте логические атрибуты с **перечисляемыми** (раздел 6), у которых значения `true`/`false`
— это слова: `contenteditable="false"`, `draggable="false"`, `spellcheck="false"` работают
именно как «нет».

<details>
<summary>disabled="false" всё равно отключает</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-attributes.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Логические атрибуты</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  button { margin: 4px; padding: 6px 12px; }
  button:disabled { outline: 2px dashed #c33; }
  td, th { border: 1px solid #ccc; padding: 4px 8px; }
  table { border-collapse: collapse; margin-top: 8px; }
</style>
</head>
<body>
  <button disabled>disabled</button>
  <button disabled="false">disabled="false"</button>
  <button disabled="no">disabled="no"</button>
  <button>без атрибута</button>
  <table id="t"><tr><th>Атрибут</th><th>Свойство .disabled</th></tr></table>
  <script>
    for (const b of document.querySelectorAll('button')) {
      const r = document.getElementById('t').insertRow();
      r.insertCell().textContent = b.hasAttribute('disabled') ? 'disabled="' + b.getAttribute('disabled') + '"' : '(нет)';
      r.insertCell().textContent = b.disabled;
    }
  </script>
</body>
</html>
```

</details>

## 4. Атрибут и свойство

Атрибут живёт в разметке и в DOM как строка (`getAttribute`). **Свойство** (property) — поле
JS-объекта элемента. Связь между ними называется **отражением** (reflection) и бывает разной:

| Пара | Как связаны |
|---|---|
| `id`, `className`, `title`, `lang` | полное отражение: изменили одно — изменилось другое |
| `href`, `src`, `action` | свойство возвращает **абсолютный** URL, атрибут — как написано |
| `tabIndex` | свойство даёт **эффективное** значение: `0` у кнопки без атрибута, `-1` у `div` |
| `disabled`, `hidden` | логическое свойство ↔ присутствие атрибута |
| `input.value` ↔ атрибут `value` | **нет** прямой связи: атрибут отражает `defaultValue` |
| `input.checked` ↔ атрибут `checked` | **нет** прямой связи: атрибут отражает `defaultChecked` |
| `option.selected` ↔ атрибут `selected` | атрибут отражает `defaultSelected` |

### 4.1. `value` и `defaultValue`

У поля ввода две величины: **значение по умолчанию** (атрибут `value`, свойство `defaultValue`) и
**текущее значение** (свойство `value`). Пока пользователь ничего не ввёл, текущее берётся из
атрибута. Как только поле стало «грязным» (dirty value flag) — после ввода или присваивания
`input.value = ...`, — изменение атрибута на текущее значение уже не влияет. Кнопка сброса формы
(`<button type="reset">`, `form.reset()`) возвращает текущее значение к атрибуту.

Следствия:

- селектор `input[value="да"]` проверяет **атрибут**, а не то, что ввёл пользователь;
- `setAttribute('value', ...)` после ввода «не работает» — работает, но меняет значение по
  умолчанию;
- `innerHTML` и «Просмотр кода» показывают атрибут, а не введённое.

<details>
<summary>Атрибут value против свойства value</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-attributes.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>value и defaultValue</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  input[type=text] { font: inherit; padding: 4px 8px; }
  input[value="исходное"] { outline: 3px solid #1b6e3a; }
  pre { background: #f4f4f4; padding: 8px; }
  button { margin: 4px 4px 4px 0; }
</style>
</head>
<body>
  <form id="f">
    <input type="text" id="i" value="исходное">
    <input type="checkbox" id="c" checked> флажок
    <p>
      <button type="button" id="attr">setAttribute('value', 'новое')</button>
      <button type="reset">Сброс формы</button>
    </p>
  </form>
  <p>Впишите что-нибудь, снимите флажок и смотрите таблицу. Зелёная рамка — селектор по атрибуту value.</p>
  <pre id="out"></pre>
  <script>
    const i = document.getElementById('i'), c = document.getElementById('c');
    const show = () => document.getElementById('out').textContent =
      'атрибут value   = ' + JSON.stringify(i.getAttribute('value')) +
      '\ndefaultValue    = ' + JSON.stringify(i.defaultValue) +
      '\nсвойство value  = ' + JSON.stringify(i.value) +
      '\n\nатрибут checked = ' + c.hasAttribute('checked') +
      '\ndefaultChecked  = ' + c.defaultChecked +
      '\nсвойство checked= ' + c.checked;
    document.getElementById('attr').onclick = () => { i.setAttribute('value', 'новое'); show(); };
    document.getElementById('f').addEventListener('input', show);
    document.getElementById('f').addEventListener('change', show);
    document.getElementById('f').addEventListener('reset', () => setTimeout(show));
    show();
  </script>
</body>
</html>
```

</details>

Тот же принцип у `<textarea>`: значение по умолчанию — его **текстовое содержимое**, а атрибута
`value` у него нет вовсе. Подробнее о полях — в [Формы](LEARN_HTML_FORMS_COURSE.md), о работе с DOM —
в [DOM](LEARN_JAVASCRIPT_DOM_COURSE.md).

## 5. URL-атрибуты

`href`, `src`, `action`, `formaction`, `poster`, `cite`, `srcset`, `data` у `<object>` — значения
это URL, и браузер **разрешает** их относительно базового адреса документа (адрес страницы или
`<base href>`, см. [Метаданные](LEARN_HTML_METADATA_COURSE.md)).

| Значение | Результат на `https://site.org/a/b.html` |
|---|---|
| `c.html` | `https://site.org/a/c.html` |
| `../c.html` | `https://site.org/c.html` |
| `/c.html` | `https://site.org/c.html` |
| `//cdn.org/x.js` | `https://cdn.org/x.js` (схема страницы) |
| `?q=1` | `https://site.org/a/b.html?q=1` |
| `#top` | `https://site.org/a/b.html#top` |
| `""` (пусто) | сама страница |

Тонкости:

- пробелы по краям значения обрезаются, а переносы строк и табуляции внутри URL удаляются;
- `<img src="">` раньше вызывал повторный запрос самой страницы; сейчас браузеры его не грузят, но
  такая запись бессмысленна — лучше без `src`;
- `href="javascript:..."` выполняет код при переходе. Это вектор XSS, если адрес приходит от
  пользователя, и CSP без `'unsafe-inline'` его блокирует. Для действия нужен `<button>`;
- `target="_blank"` в современных браузерах подразумевает `rel="noopener"`: открытая вкладка не
  получает `window.opener`.

## 6. Перечисляемые атрибуты

**Перечисляемый атрибут** (enumerated attribute) принимает одно слово из фиксированного набора
(регистр не важен). Для каждого такого атрибута спецификация определяет два особых правила:

- **значение по умолчанию для пропущенного** (missing value default) — когда атрибута нет;
- **значение по умолчанию для неверного** (invalid value default) — когда написано что-то
  неизвестное.

Это и есть механизм обратной совместимости HTML: старый браузер, не знающий `type="date"`, видит
неверное значение и показывает обычное текстовое поле. Страница не ломается.

| Атрибут | Нет атрибута | Неверное значение | Пустое значение |
|---|---|---|---|
| `input type` | `text` | `text` | `text` |
| `button type` | `submit` | `submit` | `submit` |
| `form method` | `get` | `get` | `get` |
| `form enctype` | `application/x-www-form-urlencoded` | то же | то же |
| `crossorigin` | нет CORS | `anonymous` | `anonymous` |
| `contenteditable` | inherit | inherit | `true` |
| `draggable` | auto (ссылки и картинки — да) | auto | auto |
| `dir` | нет состояния (наследуется) | нет состояния | нет состояния |
| `loading` (`img`, `iframe`) | `eager` | `eager` | `eager` |
| `referrerpolicy` | политика документа | политика документа | политика документа |

Две вещи из таблицы, о которые спотыкаются чаще всего:

- **`<button>` внутри `<form>` по умолчанию — `submit`**. Кнопка «Показать пароль» без
  `type="button"` отправит форму. Пишите `type` у кнопок всегда;
- `crossorigin="use-credentials"` с опечаткой превращается в `anonymous` — запрос уйдёт **без**
  куки, и ошибка будет выглядеть как проблема сервера.

Из JS отражённое свойство возвращает **каноническое** значение, а не написанное: у
`<input type="Foo">` атрибут — `"Foo"`, свойство `type` — `"text"`. Это лучший способ проверить
поддержку: создать `input`, присвоить `type = 'date'` и прочитать обратно.

<details>
<summary>Неверные значения превращаются в значения по умолчанию</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-attributes.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Перечисляемые атрибуты</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 16px; }
  table { border-collapse: collapse; margin-top: 8px; }
  td, th { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  code { background: #f2f2f2; padding: 0 4px; }
  .diff { background: #fff3cd; }
</style>
</head>
<body>
  <div id="src" hidden>
    <input type="Foo">
    <input type="DATE">
    <button type="reset2"></button>
    <form method="PATCH"></form>
    <img crossorigin="use-credential">
    <img loading="later">
    <div contenteditable="yes"></div>
  </div>
  <p>Атрибут — как написано, свойство — как понял браузер. Жёлтым — расхождения.</p>
  <table id="t"><tr><th>Элемент</th><th>Атрибут</th><th>Свойство</th></tr></table>
  <script>
    const map = { input: 'type', button: 'type', form: 'method', div: 'contentEditable' };
    for (const el of document.getElementById('src').children) {
      const attr = el.localName === 'img' ? (el.hasAttribute('loading') ? 'loading' : 'crossorigin')
                 : el.localName === 'div' ? 'contenteditable' : map[el.localName];
      const prop = el.localName === 'img' ? (attr === 'loading' ? 'loading' : 'crossOrigin') : map[el.localName];
      const a = el.getAttribute(attr), p = String(el[prop]);
      const r = document.getElementById('t').insertRow();
      if (a !== p) r.className = 'diff';
      r.insertCell().textContent = '<' + el.localName + '>';
      r.insertCell().textContent = attr + '="' + a + '"';
      r.insertCell().textContent = prop + ' = ' + p;
    }
  </script>
</body>
</html>
```

</details>

Обратите внимание на `contenteditable="yes"`: неверное значение даёт состояние «наследовать», и
свойство `contentEditable` честно возвращает `"inherit"`.

## Итог

- Имена атрибутов приводятся к нижнему регистру; при повторе побеждает первый.
- `id` уникален и служит связям; `class` — список токенов, порядок в нём не важен.
- `lang` наследуется и влияет на перенос, кавычки, произношение; `dir` — смысл, а не стиль.
- `hidden` — это `display: none` из стилей браузера, авторский `display` его перебивает;
  `until-found` прячет, но оставляет находимым.
- `title` не виден на тач-экранах и с клавиатуры; положительный `tabindex` не используют;
  `inert` выключает поддерево целиком.
- `data-*` → `dataset` в «верблюжьем» регистре, значения — строки.
- `popover` даёт верхний слой и light dismiss без JS.
- Логический атрибут — это присутствие: `disabled="false"` отключает.
- Атрибут `value` — это `defaultValue`; текущее значение живёт в свойстве.
- URL-атрибуты разрешаются относительно базы; свойство `href` возвращает абсолютный адрес.
- Перечисляемые атрибуты имеют значения по умолчанию для пропущенного и неверного случая — на этом
  держится обратная совместимость.

## Проверьте себя

1. Почему `<div hidden class="toolbar">` виден, если в CSS есть `.toolbar { display: grid }`? Как
   исправить один раз для всего сайта?
2. Что вернут `getAttribute('value')` и `.value` у поля `<input value="a">`, в которое пользователь
   вписал `b`? А после `form.reset()`?
3. Почему `<input checked="false">` отмечен, а `<div contenteditable="false">` не редактируется?
4. В каком порядке Tab обойдёт элементы `<button>`, `<button tabindex="2">`, `<a href="#">`,
   `<span tabindex="1">`?
5. Какое значение получит `data-user-id` в `dataset` и какого оно типа?
6. Кнопка «Показать пароль» в форме отправляет форму. Какой перечисляемый атрибут виноват и какое
   у него значение по умолчанию?

Дальше: [HTML как набор крючков для селекторов](LEARN_HTML_SELECTORS_COURSE.md).
