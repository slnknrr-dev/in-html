# Псевдоэлементы: `::before`, `::marker`, `::selection`

> Курс 12 из программы. Для тех, кто прошёл [псевдоклассы](LEARN_CSS_PSEUDO_CLASSES_COURSE.md)
> и [блочную модель](LEARN_CSS_BOX_MODEL_COURSE.md). Псевдоэлементы — это коробки, которых нет в
> DOM, но которые есть в дереве отрисовки. Разберёмся, откуда они берутся и что с ними нельзя.

**Что вы будете понимать после курса**

- чем **псевдоэлемент** (pseudo-element) отличается от псевдокласса и почему у него два двоеточия;
- как `::before` и `::after` порождают коробки, почему они не работают у `<img>` и `<input>`;
- что видят и чего не видят скрипты и экранные чтецы;
- как оформлять маркеры списков через `::marker`;
- `::placeholder`, `::selection`, `::backdrop`, `::file-selector-button`;
- какие свойства разрешены в `::first-line` и `::first-letter` и почему.

---

## 1. Псевдокласс выбирает, псевдоэлемент создаёт

Псевдокласс **сужает** выбор среди существующих элементов: `a:hover` — это всё ещё элемент `a`.
Псевдоэлемент **адресует часть** или **порождает** коробку, которой в DOM нет: `p::first-line` —
не элемент, а первая отформатированная строка абзаца, которая появится только после раскладки.
Элемент, к которому относится псевдоэлемент, называется **исходным** (originating element).

Правила записи:

- псевдоэлемент пишется **в конце** составного селектора: `p::first-line`, но не `::first-line p`;
- после псевдоэлемента можно добавить только некоторые псевдоклассы состояния: `li:hover::marker`
  — правильно, состояние вешается на исходный элемент; `::before:hover` поддержки не имеет;
- специфичность псевдоэлемента — как у **элемента**: (0,0,1). `p::before` весит (0,0,2).

### 1.1. Одно двоеточие или два

В CSS1 были `:first-line` и `:first-letter`, в CSS2 добавились `:before` и `:after` — все с одним
двоеточием, как псевдоклассы. CSS3 ввёл `::`, чтобы отличать псевдоэлементы. Ради совместимости
браузеры обязаны понимать **одно** двоеточие у этих четырёх старых. У всех новых (`::marker`,
`::selection`, `::placeholder`, `::backdrop`) одно двоеточие не работает.

```css
p:before   { }  /* работает: наследство CSS2 */
p::before  { }  /* современная запись */
::selection { } /* только так */
```

## 2. `::before` и `::after`

### 2.1. Без `content` коробки нет

`::before` создаёт коробку **первым ребёнком** исходного элемента, `::after` — последним. Но только
если у них вычисленное значение `content` не `none` и не `normal`. Это самая частая ошибка:

```css
.icon::before { width: 16px; height: 16px; background: red; }  /* ничего не видно */
.icon::before { content: ""; display: inline-block; width: 16px; height: 16px; background: red; }
```

По умолчанию сгенерированная коробка — `display: inline`, поэтому `width`/`height` на неё не
действуют, пока вы не смените `display`.

Значения `content`:

| Значение | Что вставит |
|---|---|
| `"текст"` | строку; `\A` — перенос (нужен `white-space: pre`) |
| `url(icon.svg)` | картинку как замещаемый контент |
| `attr(data-x)` | значение атрибута исходного элемента как строку |
| `counter(n)` / `counters(n, ".")` | значение счётчика |
| `open-quote` / `close-quote` | кавычки из свойства `quotes` |
| `"★" / "звезда"` | после косой черты — **альтернативный текст** для доступности |

Наследование: псевдоэлемент наследует от исходного элемента, как обычный ребёнок. `color`,
`font` берутся оттуда, если не заданы явно.

### 2.2. Не в DOM — что это значит

- `document.querySelector('p::before')` вернёт `null` — селектор с псевдоэлементом ни с чем
  в DOM не совпадает. Стиль можно прочитать: `getComputedStyle(p, '::before').content`.
- Событий у псевдоэлемента нет: клик по нему приходит **исходному элементу** (`event.target`
  — сам элемент).
- Текст из `content` нельзя выделить и скопировать — в большинстве браузеров.
- Экранные чтецы **читают** текстовый `content`: он входит в доступное имя (accessible name).
  Поэтому декоративные символы (`"→"`, `"★"`) лучше гасить альтернативным текстом `/ ""`,
  а смысловой текст, наоборот, не прятать в `content` — его не найдёт поиск, не переведёт
  переводчик страницы и не скопирует пользователь.

### 2.3. Почему не работает у `<img>`, `<input>`, `<br>`

`::before` и `::after` вставляются **внутрь** коробки исходного элемента, в её содержимое.
У замещаемых элементов (replaced elements: `img`, `video`, `input`, `iframe`) содержимое рисует
не CSS, а внешний ресурс или виджет — места для детей нет. Поэтому `input::after` не работает.
(Исключения — нестандартные: Chrome и Firefox рисуют `::before` у **сломанной** картинки, потому
что она перестаёт быть замещаемой; полагаться на это не стоит.) Нужна иконка в поле — оборачивайте
поле в `<span>` или `<label>` и вешайте псевдоэлемент на обёртку.

<details>
<summary>::before и ::after: коробки, content, attr()</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-pseudo-elements.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.5 system-ui, sans-serif; padding: 16px; }
  p { border: 2px solid #999; padding: 6px; }
  p::before { content: "before"; background: #ffe08a; outline: 1px dashed #c90; }
  p::after  { content: "after"; background: #b8e0ff; outline: 1px dashed #06c; }
  .block::before { display: block; }
  a[href^="http"]::after { content: " ↗" / ""; }
  abbr[data-full]::after { content: " (" attr(data-full) ")"; color: #666; }
  input::after { content: "не появится"; }
</style>
</head>
<body>
  <p>Обычный абзац: сгенерированные коробки строчные.</p>
  <p class="block">Здесь ::before стал блочным.</p>
  <div><a href="https://example.org">Внешняя ссылка</a> — стрелка без «озвучки».</div>
  <div><abbr data-full="Cascading Style Sheets">CSS</abbr> — расшифровка из атрибута.</div>
  <div><input value="input::after не работает"></div>
</body>
</html>
```

</details>

### 2.4. Типовые приёмы

- **Иконки и декор** без лишней разметки (стрелки у внешних ссылок, кавычки у цитат).
- **Очистка обтекания** (clearfix): `.box::after { content: ""; display: table; clear: both; }` —
  сегодня проще `display: flow-root` у контейнера.
- **Оверлей поверх карточки**, чтобы вся карточка была кликабельной: у ссылки внутри
  `a::after { content: ""; position: absolute; inset: 0; }`, у карточки `position: relative`.
  Ссылка остаётся одной, доступное имя — её текст.
- **Счётчики**: нумерация заголовков `h2::before { counter-increment: h; content: counter(h) ". "; }`.
- **Треугольники, ленточки, подчёркивания** с анимацией — декоративная геометрия.

<details>
<summary>Вся карточка кликабельна через ::after</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-pseudo-elements.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.4 system-ui, sans-serif; padding: 16px; }
  .card { position: relative; border: 2px solid #ccc; border-radius: 8px; padding: 12px; max-width: 320px; }
  .card:hover { border-color: #1a73e8; }
  .card a::after { content: ""; position: absolute; inset: 0; }
  .card a:focus-visible { outline: none; }
  .card:has(a:focus-visible) { outline: 3px solid #1a73e8; outline-offset: 2px; }
</style>
</head>
<body>
  <article class="card">
    <h3><a href="#">Заголовок карточки</a></h3>
    <p>Щёлкните в любом месте карточки — сработает ссылка. Наведите курсор: рамка синеет.</p>
  </article>
</body>
</html>
```

</details>

## 3. `::marker`

Элемент с `display: list-item` (по умолчанию `<li>` и `<summary>`) получает коробку маркера.
`::marker` адресует её. Раньше маркер стилизовали только через `list-style-*`, либо прятали и
рисовали `::before`.

В `::marker` разрешён **ограниченный набор** свойств: все свойства шрифта, `color`, `content`,
`white-space`, `direction`, `unicode-bidi`, `text-combine-upright`, анимации и переходы. Отступы,
фон, рамки — нельзя: маркер не обычная коробка.

```css
li::marker { color: crimson; font-weight: 700; }
ol li::marker { content: counter(list-item) ") "; }
ul.check li::marker { content: "✓ "; }
summary::marker { content: "+ "; }
details[open] > summary::marker { content: "− "; }
```

`list-item` — встроенный счётчик, который браузер ведёт для списков автоматически.

| Нужно | Чем |
|---|---|
| цвет или размер маркера | `::marker` |
| свой символ | `list-style-type: "→ "` или `::marker { content }` |
| картинка | `list-style-image: url(...)` |
| маркер с фоном, отступами, позиционированием | `list-style: none` + `li::before` |

Важно для доступности: Safari (VoiceOver) при `list-style: none` перестаёт объявлять список
списком. Если стиль сбрасывается, а семантика нужна, добавляют `role="list"` к `<ul>`.

<details>
<summary>::marker против ::before</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-pseudo-elements.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.5 system-ui, sans-serif; padding: 16px; display: flex; gap: 32px; }
  .m li::marker { color: crimson; font-weight: 700; }
  .c li::marker { content: "✓ "; color: seagreen; }
  .o li::marker { content: counter(list-item) ") "; color: #1a73e8; }
  .b { list-style: none; padding: 0; }
  .b li::before { content: counter(list-item); display: inline-grid; place-items: center;
                  width: 1.6em; height: 1.6em; margin-right: .5em; border-radius: 50%;
                  background: #1a73e8; color: #fff; font-size: .8em; }
</style>
</head>
<body>
  <ul class="m"><li>цвет</li><li>маркера</li></ul>
  <ul class="c"><li>свой</li><li>символ</li></ul>
  <ol class="o"><li>счётчик</li><li>list-item</li></ol>
  <ol class="b" role="list"><li>круг</li><li>через ::before</li></ol>
</body>
</html>
```

</details>

## 4. `::placeholder`

Текст подсказки в `<input>` и `<textarea>`. Разрешены свойства, применимые к `::first-line`:
шрифт, цвет, фон, отступы между буквами и т. п.

```css
input::placeholder { color: #767676; opacity: 1; }
```

`opacity: 1` нужен потому, что Firefox по умолчанию делает подсказку полупрозрачной. Цвет
подсказки должен иметь достаточный контраст: `#767676` на белом — около 4,5:1.

Не путайте: `::placeholder` — **текст** подсказки; `:placeholder-shown` — **поле**, пока
подсказка видна. Подсказка — не замена `<label>`: она исчезает при вводе, и человек забывает,
что требовалось.

## 5. `::selection`

Выделенный пользователем текст. Разрешено мало: `color`, `background-color`, `text-decoration`
и его подсвойства, `text-shadow`, `-webkit-text-stroke-color` / `stroke-color`, `fill-color`.
Ничего, что меняет раскладку: выделение не должно сдвигать текст.

```css
::selection { background: #ffe08a; color: #000; }
code::selection { background: #333; color: #fff; }
```

Тонкость наследования. Спецификация CSS Pseudo-Elements 4 вводит **подсветочное наследование**
(highlight inheritance): `p::selection` наследует от `::selection` родителя, а не от самого `p`.
Браузеры переходят на эту модель постепенно (Chrome — с 2024 года). Поэтому глобальное правило
пишут для `::selection` или `:root::selection`, а частные — на нужных элементах.

<details>
<summary>::selection и ::placeholder</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-pseudo-elements.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.5 system-ui, sans-serif; padding: 16px; }
  ::selection { background: #ffe08a; color: #000; }
  .dark::selection { background: #222; color: #7fffd4; }
  input { font: inherit; padding: 6px; width: 280px; }
  input::placeholder { color: #9b59b6; font-style: italic; opacity: 1; }
</style>
</head>
<body>
  <p>Выделите этот абзац мышью: фон выделения жёлтый.</p>
  <p class="dark">А этот — тёмный с бирюзовым текстом.</p>
  <input placeholder="фиолетовая курсивная подсказка">
</body>
</html>
```

</details>

## 6. `::first-line` и `::first-letter`

Оба зависят от **раскладки**: какая строка первая, станет известно только после переноса слов.
Измените ширину окна — `::first-line` охватит другие слова. Поэтому набор свойств ограничен
теми, что не меняют саму раскладку строки «слишком сильно».

| | Разрешено | Работает у |
|---|---|---|
| `::first-line` | шрифт, цвет, фон, `word-spacing`, `letter-spacing`, `text-decoration`, `text-transform`, `line-height`, `vertical-align` | блочных контейнеров (`block`, `inline-block`, `list-item`, ячеек таблицы) |
| `::first-letter` | всё из `::first-line` **плюс** `margin`, `padding`, `border`, `float` | то же, если первым идёт текст |

Подробности, которые часто удивляют:

- у **строчного** элемента (`<span>`, `<a>`) `::first-line` не работает;
- `::first-letter` захватывает и предшествующую пунктуацию: у «"Привет» буквицей станут `"П`;
- если первым ребёнком идёт картинка или блок-обёртка, первая буква ищется **внутри** первого
  блочного потомка, но строчный `<img>` до текста её «съедает»;
- `::before` с текстом участвует: первая буква может оказаться буквой из `content`.

Классическая буквица (drop cap): `float: left` и крупный шрифт. Современная альтернатива —
`initial-letter: 3` (Safari, Chrome; в Firefox нет), которое само выравнивает буквицу по строкам.

<details>
<summary>Буквица и первая строка</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-pseudo-elements.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 17px/1.5 Georgia, serif; padding: 16px; max-width: 520px; }
  p::first-line { font-variant: small-caps; color: #8b0000; }
  p::first-letter { float: left; font-size: 3.4em; line-height: .9; padding: 4px 8px 0 0; color: #1a3a6b; }
  span::first-line { color: red; }
</style>
</head>
<body>
  <p>Измените ширину окна: первая строка охватит другие слова, потому что ::first-line
     определяется после переноса. Буквица — это ::first-letter с float, полями и крупным
     шрифтом. Остальной текст обтекает её как любое плавающее тело.</p>
  <span>У span (строчный элемент) ::first-line не сработает.</span>
</body>
</html>
```

</details>

## 7. Псевдоэлементы элементов управления и верхнего слоя

### 7.1. `::backdrop`

Подложка под элементом в **верхнем слое** (top layer): модальный `<dialog>` (открытый
`showModal()`), `popover`, элемент в полноэкранном режиме. Подложка закрывает весь viewport
под элементом. В современных браузерах `::backdrop` наследует от исходного элемента — значит,
пользовательские свойства, объявленные на диалоге, доступны в подложке.

```css
dialog::backdrop { background: rgb(0 0 0 / .5); backdrop-filter: blur(3px); }
```

`dialog.show()` (не модальный) верхний слой не использует — подложки нет.

<details>
<summary>::backdrop модального диалога</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-pseudo-elements.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.4 system-ui, sans-serif; padding: 16px; }
  dialog { border: none; border-radius: 12px; padding: 20px; --tint: 26 115 232; }
  dialog::backdrop { background: rgb(var(--tint) / .35); backdrop-filter: blur(3px); }
  button { font: inherit; padding: 6px 12px; }
</style>
</head>
<body>
  <p>Текст страницы, который размоется под подложкой.</p>
  <button onclick="document.querySelector('dialog').showModal()">Открыть модально</button>
  <button onclick="document.querySelector('dialog').show()">Открыть без подложки</button>
  <dialog>
    <p>Подложка взяла цвет из переменной диалога.</p>
    <form method="dialog"><button>Закрыть</button></form>
  </dialog>
</body>
</html>
```

</details>

### 7.2. `::file-selector-button`

Кнопка внутри `<input type="file">`. До стандартизации были `::-webkit-file-upload-button`
и `::-ms-browse`. Теперь — одно имя для всех браузеров:

```css
input[type=file]::file-selector-button {
  border: 0; border-radius: 6px; padding: 6px 12px; background: #1a73e8; color: #fff;
}
input[type=file]::file-selector-button:hover { background: #1558b0; }
```

Здесь `:hover` после псевдоэлемента разрешён: у этой коробки своё состояние наведения.

<details>
<summary>Оформление кнопки выбора файла</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-pseudo-elements.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.4 system-ui, sans-serif; padding: 16px; }
  input[type=file] { font: inherit; }
  input[type=file]::file-selector-button {
    font: inherit; border: 0; border-radius: 6px; padding: 6px 12px; margin-right: 12px;
    background: #1a73e8; color: #fff; cursor: pointer;
  }
  input[type=file]::file-selector-button:hover { background: #1558b0; }
</style>
</head>
<body>
  <p>Наведите курсор на кнопку: у неё свой :hover.</p>
  <input type="file">
</body>
</html>
```

</details>

### 7.3. Нестандартные и новые

Префиксные псевдоэлементы вроде `::-webkit-scrollbar`, `::-webkit-inner-spin-button`,
`::-moz-range-thumb` работают только в своём движке. Для полос прокрутки есть стандартные
свойства `scrollbar-color` и `scrollbar-width`. Из новых: `::cue` (субтитры `<track>`),
`::highlight(имя)` (CSS Custom Highlight API), `::view-transition-*`. Неизвестный браузеру
псевдоэлемент делает недействительным весь селектор — и весь список через запятую:

```css
input::-webkit-slider-thumb, input::-moz-range-thumb { }  /* не сработает нигде! */
input::-webkit-slider-thumb { }   /* пишите отдельными правилами */
input::-moz-range-thumb { }
```

`:is()` здесь не поможет: псевдоэлементы внутри `:is()` не допускаются.

## Итог

- Псевдоэлемент — коробка или часть, которой нет в DOM; весит как элемент; пишется в конце.
- Одно двоеточие допустимо только у `before`, `after`, `first-line`, `first-letter`.
- `::before`/`::after` без `content` не существуют; по умолчанию строчные; внутри исходного
  элемента, поэтому не работают у замещаемых.
- Текст из `content` читают экранные чтецы — гасите декор через `/ ""`, смысл держите в DOM.
- `::marker`, `::placeholder`, `::selection`, `::first-line` принимают ограниченный набор свойств:
  они не должны ломать раскладку.
- `::backdrop` — подложка верхнего слоя, только у модальных диалогов, поповеров и полноэкранных.
- Префиксные псевдоэлементы — только в отдельных правилах.

## Проверьте себя

1. Почему `.badge::after { width: 8px; height: 8px; background: red; }` ничего не рисует? Назовите
   две причины.
2. Какой элемент получит клик по области `::before` и что будет в `event.target`?
3. Почему нельзя поставить иконку через `input[type=search]::before`, и как обойти?
4. Чем `ol li::marker { content: counter(list-item) ") " }` лучше `::before` и когда хуже?
5. Почему `::first-line` не принимает `margin`, а `::first-letter` — принимает?
6. Почему правило `a::-webkit-x, a::-moz-y { }` не сработает ни в одном браузере?

Дальше: [Flexbox](LEARN_CSS_FLEXBOX_COURSE.md).
