# Grid

> Курс 14 из программы. Для тех, кто уже знает блочную модель, нормальный поток и Flexbox. Grid —
> первая в CSS система раскладки, которая думает сразу в двух измерениях. Мы разберём не только
> синтаксис, но и алгоритм: откуда берутся размеры дорожек и почему `1fr` иногда «не слушается».

**Что вы будете понимать после курса**

- из чего состоит сетка: **дорожки**, **линии**, **ячейки**, **области** — и как их назвать;
- как работает единица `fr` и почему `1fr` — это на самом деле `minmax(auto, 1fr)`;
- в чём ловушка минимального размера и почему лечится она `minmax(0, 1fr)` или `min-width: 0`;
- разницу между `auto-fill` и `auto-fit` — на пикселях, а не на словах;
- как размещать элементы по линиям, по именам и по областям;
- что такое **неявная сетка** (implicit grid), `grid-auto-flow: dense` и `subgrid`;
- как выравнивать всё и вся, и когда выбирать Grid, а когда Flexbox.

---

## 1. Словарь сетки

`display: grid` делает элемент **контейнером сетки** (grid container). Его дети в потоке становятся
**элементами сетки** (grid items). Внуки — нет: сетка, как и flex, действует ровно на один уровень
дерева (исключение — `subgrid`, раздел 9).

| Термин | Английский | Что это |
|---|---|---|
| Линия | grid line | граница между дорожками, нумеруется с 1; отрицательные номера — с конца |
| Дорожка | grid track | колонка или строка — промежуток между двумя соседними линиями |
| Ячейка | grid cell | пересечение одной колонки и одной строки |
| Область | grid area | прямоугольник из нескольких ячеек |
| Промежуток | gap (gutter) | расстояние между дорожками; это не дорожка, в нём нельзя ничего разместить |

У сетки из трёх колонок **четыре** линии по горизонтали: 1, 2, 3, 4 (или −4, −3, −2, −1). Это главное,
что путают новички: размещают элемент «в колонку 3», а пишут номер линии.

Контейнер ведёт себя снаружи как блок (`display: grid`) или как строчный блок (`display: inline-grid`).
Внутри устанавливается **контекст форматирования сетки** (grid formatting context): поля элементов не
схлопываются с полями контейнера, `float` на элементах игнорируется, а `vertical-align` не действует.

<details>
<summary>Линии, дорожки и промежутки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-grid.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px system-ui, sans-serif; margin: 16px; }
  .grid {
    display: grid;
    grid-template-columns: 100px 1fr 2fr;
    grid-template-rows: 60px 60px;
    gap: 12px;
    background: repeating-linear-gradient(45deg, #fde68a 0 6px, #fef3c7 6px 12px);
    outline: 2px dashed #b45309;
  }
  .grid > div { background: #bfdbfe; border: 1px solid #1d4ed8; display: grid; place-items: center; }
  p { color: #555; }
</style>
</head>
<body>
  <div class="grid">
    <div>100px</div><div>1fr</div><div>2fr</div>
    <div>4</div><div>5</div><div>6</div>
  </div>
  <p>Полосатый фон — это промежутки (gap): фон контейнера виден между ячейками. Колонки: 100px, затем
  оставшееся место делится 1 : 2.</p>
</body>
</html>
```

</details>

## 2. Явные дорожки: `grid-template-columns` и `grid-template-rows`

Каждое значение в списке — размер одной дорожки. Допустимы:

| Значение | Как считается |
|---|---|
| `200px`, `20%`, `10em` | фиксированный размер; проценты — от размера контейнера по этой оси |
| `auto` | как минимум — min-content содержимого, как максимум — max-content; растягивается при `align/justify-content: normal` |
| `min-content` | самое узкое без переполнения: длина самого длинного неразрывного слова |
| `max-content` | ширина содержимого «в одну строку», без переносов |
| `fit-content(300px)` | `max-content`, но не больше 300px (и не меньше `min-content`) |
| `minmax(a, b)` | не меньше `a`, не больше `b` |
| `1fr` | доля **свободного** места (раздел 3) |

Запись `repeat(3, 1fr)` — то же, что `1fr 1fr 1fr`. В повтор можно класть узор: `repeat(2, 100px 1fr)`
даёт четыре дорожки.

Строки задаются так же. Если строк не задано, они создаются неявно и получают размер
`grid-auto-rows` (по умолчанию `auto`).

### 2.1. Порядок расчёта

Алгоритм определения размеров дорожек (track sizing algorithm) упрощённо идёт так:

1. Фиксированные дорожки получают свой размер.
2. Дорожки с размером по содержимому (`auto`, `min-content`, `max-content`) получают свой минимум.
3. Оставшееся место отдаётся `fr`-дорожкам пропорционально.
4. Если `fr`-дорожек нет и место ещё осталось, растягиваются `auto`-дорожки (при выравнивании `normal`
   или `stretch`).

Сначала колонки, потом строки: высота строки зависит от того, как текст перенёсся в уже известной
ширине колонки.

## 3. `fr` и ловушка минимального размера

`fr` (fraction) — доля **свободного** места, то есть того, что осталось после фиксированных дорожек и
промежутков. `1fr 2fr` при 300px свободного места даёт 100px и 200px.

Но у `fr` есть скрытая деталь. Спецификация говорит: дорожка `1fr` — это `minmax(auto, 1fr)`. Минимум
`auto` для элемента сетки — это его **автоматический минимальный размер** (automatic minimum size),
грубо — min-content. То есть колонка `1fr` **не может стать уже, чем самое длинное неразрывное
слово, длинная ссылка, `<pre>` или широкая картинка** внутри неё.

Последствия:

- `repeat(3, 1fr)` перестаёт давать равные колонки, если в одной колонке длинный URL;
- сетка вылезает за пределы контейнера на узком экране;
- `<pre>` с `overflow: auto` внутри колонки не прокручивается, а распирает колонку.

Лечение — разрешить колонке сжиматься ниже min-content:

```css
/* вариант 1: на дорожке */
grid-template-columns: repeat(3, minmax(0, 1fr));

/* вариант 2: на элементе — отменить автоматический минимум */
.grid > * { min-width: 0; }   /* или overflow: hidden, он тоже обнуляет автоминимум */
```

Вариант 1 честнее: дорожки становятся строго равными. Вариант 2 оставляет дорожки зависимыми от
содержимого, но не даёт ему распирать сетку. Та же самая ловушка есть во Flexbox (`min-width: auto`
у flex-элементов) — см. [Flexbox](LEARN_CSS_FLEXBOX_COURSE.md).

<details>
<summary>1fr против minmax(0, 1fr)</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-grid.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; margin: 16px; width: 360px; }
  .grid { display: grid; gap: 8px; margin-bottom: 8px; outline: 2px solid #b91c1c; }
  .a { grid-template-columns: repeat(3, 1fr); }
  .b { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .grid > div { background: #dbeafe; border: 1px solid #2563eb; padding: 4px; overflow-wrap: normal; }
  .b > div { overflow: hidden; text-overflow: ellipsis; }
  h4 { margin: 12px 0 4px; }
</style>
</head>
<body>
  <h4>repeat(3, 1fr): колонки неравные, сетка шире красной рамки</h4>
  <div class="grid a">
    <div>коротко</div>
    <div>https://example.com/очень-длинный-адрес-без-пробелов</div>
    <div>коротко</div>
  </div>
  <h4>repeat(3, minmax(0, 1fr)): три равные колонки</h4>
  <div class="grid b">
    <div>коротко</div>
    <div>https://example.com/очень-длинный-адрес-без-пробелов</div>
    <div>коротко</div>
  </div>
</body>
</html>
```

</details>

### 3.1. `fr` и сумма меньше единицы

Если сумма `fr` меньше 1 (например, `0.25fr 0.25fr`), дорожки занимают только соответствующую долю
свободного места, а не всё. Редкий, но законный способ сказать «каждая колонка — четверть остатка».

### 3.2. Проценты против `fr`

`grid-template-columns: 50% 50%` плюс `gap: 20px` переполняет контейнер на 20px: проценты считаются от
всего контейнера, промежуток к ним добавляется. `1fr 1fr` делит место **после** вычета промежутков.
Отсюда правило: в сетках с `gap` доли задают через `fr`.

## 4. `repeat()` с `auto-fill` и `auto-fit`

Самый знаменитый приём Grid — адаптивная галерея без единого `@media`:

```css
grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
```

Браузер создаёт **столько колонок, сколько помещается**, если каждая не уже 160px. Оставшееся место
делится между колонками через `1fr`.

Разница между `auto-fill` и `auto-fit` видна, только когда элементов **меньше**, чем помещается колонок:

| | Пустые дорожки | Итог для двух карточек в широком контейнере |
|---|---|---|
| `auto-fill` | остаются, занимают место | карточки по ~160px слева, справа пустые колонки |
| `auto-fit` | схлопываются в 0 (collapsed tracks), их `fr`-доля отдаётся занятым | две карточки растягиваются на всю ширину |

Что выбрать: `auto-fill` — когда карточки должны выглядеть одинаково независимо от их количества
(каталог, где на последней странице 2 товара). `auto-fit` — когда немногие элементы должны занять всю
строку.

Подвох: `minmax(160px, 1fr)` переполнит контейнер уже 160px. Надёжная формула —
`minmax(min(160px, 100%), 1fr)`: минимум никогда не больше самого контейнера.

<details>
<summary>auto-fill против auto-fit</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-grid.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; margin: 16px; }
  .grid { display: grid; gap: 8px; outline: 2px dashed #64748b; margin-bottom: 16px; }
  .fill { grid-template-columns: repeat(auto-fill, minmax(min(120px, 100%), 1fr)); }
  .fit  { grid-template-columns: repeat(auto-fit,  minmax(min(120px, 100%), 1fr)); }
  .grid > div { background: #bbf7d0; border: 1px solid #15803d; padding: 12px; }
</style>
</head>
<body>
  <p>auto-fill: пустые колонки сохранены (меняйте ширину окна)</p>
  <div class="grid fill"><div>1</div><div>2</div></div>
  <p>auto-fit: пустые колонки схлопнуты, две карточки заняли всё</p>
  <div class="grid fit"><div>1</div><div>2</div></div>
</body>
</html>
```

</details>

Ограничения: в одном списке дорожек может быть только один автоповтор, и вместе с ним разрешены только
фиксированные размеры (никаких `auto` или `fr` вне `repeat`).

## 5. Размещение по линиям

```css
.item {
  grid-column: 1 / 3;       /* от линии 1 до линии 3: две колонки */
  grid-row: 2;              /* только начальная линия: занять одну строку */
}
.wide  { grid-column: 1 / -1; }      /* от первой до последней явной линии */
.span  { grid-column: span 2; }      /* две колонки там, где окажется автоматически */
.tail  { grid-column: 2 / span 3; }  /* начать со 2-й линии и занять три дорожки */
```

`grid-column` — сокращение для `grid-column-start` и `grid-column-end`. `grid-area` может задать все
четыре: `grid-area: row-start / column-start / row-end / column-end` — порядок против часовой стрелки
от верха, **не** как у `margin`.

Нюанс: `-1` — последняя **явная** линия. Если сетка разрослась неявными колонками, `1 / -1` их не
захватит.

Элементы могут занимать одни и те же ячейки — тогда они накладываются. Порядок отрисовки — по порядку в
дереве, его меняют `z-index` (работает на элементах сетки и без `position`!) или `order`.

### 5.1. Именованные линии

```css
.page {
  display: grid;
  grid-template-columns:
    [full-start] minmax(16px, 1fr)
    [content-start] minmax(0, 60ch) [content-end]
    minmax(16px, 1fr) [full-end];
}
.page > *     { grid-column: content; }   /* content-start / content-end */
.page > .hero { grid-column: full; }      /* на всю ширину экрана */
```

Пара имён `xxx-start` / `xxx-end` автоматически создаёт неявную **именованную область** `xxx`, поэтому
`grid-column: content` работает. Это классическая «раскладка с выходом за колонку текста»: обычный текст
не шире 60ch, а картинки и герой-блоки занимают всю ширину — без отрицательных полей и `100vw`.

<details>
<summary>Колонка текста с элементами на всю ширину</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-grid.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; font: 16px/1.5 Georgia, serif; }
  .page {
    display: grid;
    grid-template-columns:
      [full-start] minmax(16px, 1fr)
      [content-start] minmax(0, 36ch) [content-end]
      minmax(16px, 1fr) [full-end];
    row-gap: 12px;
  }
  .page > * { grid-column: content; margin: 0; }
  .page > .full { grid-column: full; background: #1e3a8a; color: white; padding: 24px; text-align: center; }
  .page > p { background: #f1f5f9; }
</style>
</head>
<body>
  <article class="page">
    <h2>Заголовок статьи</h2>
    <p>Текст держится в узкой колонке для удобства чтения. Поля по бокам — это колонки minmax(16px, 1fr).</p>
    <div class="full">Блок на всю ширину: grid-column: full</div>
    <p>И снова узкая колонка без единой обёртки.</p>
  </article>
</body>
</html>
```

</details>

## 6. Именованные области: `grid-template-areas`

Самый наглядный способ описать макет — нарисовать его строками:

```css
.layout {
  display: grid;
  grid-template-columns: 200px 1fr;
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    "head head"
    "side main"
    "foot foot";
}
header { grid-area: head; }
```

Правила:

- каждая строка в кавычках — строка сетки, каждое слово — ячейка;
- области должны быть **прямоугольниками**; буква «Г» сделает всё объявление недействительным;
- `.` (одна или несколько точек подряд) — пустая ячейка;
- количество ячеек во всех строках одинаковое.

Сила областей — в перестройке через `@media`: меняется только рисунок, разметка не трогается. Но
помните, что визуальный порядок, расходящийся с порядком в DOM, путает пользователей клавиатуры и
экранных дикторов: Tab идёт по DOM, а не по сетке. См. [Доступность](LEARN_HTML_ACCESSIBILITY_COURSE.md).

<details>
<summary>Макет страницы на grid-template-areas</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-grid.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  html, body { height: 100%; margin: 0; font: 15px system-ui, sans-serif; }
  body {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: auto auto 1fr auto;
    grid-template-areas: "head" "side" "main" "foot";
    gap: 6px; padding: 6px; box-sizing: border-box;
  }
  @media (width >= 500px) {
    body {
      grid-template-columns: 160px 1fr;
      grid-template-rows: auto 1fr auto;
      grid-template-areas:
        "head head"
        "side main"
        "foot foot";
    }
  }
  header { grid-area: head; background: #fecaca; }
  nav    { grid-area: side; background: #fde68a; }
  main   { grid-area: main; background: #bbf7d0; }
  footer { grid-area: foot; background: #c7d2fe; }
  body > * { padding: 12px; }
</style>
</head>
<body>
  <header>head</header>
  <nav>side</nav>
  <main>main: сузьте окно уже 500px, и макет станет одной колонкой</main>
  <footer>foot: всегда прижат вниз благодаря строке 1fr</footer>
</body>
</html>
```

</details>

Обратите внимание на «липкий подвал» бесплатно: строка `1fr` между `auto`-строками забирает всю
оставшуюся высоту, а `body` растянут на `height: 100%`.

## 7. Неявная сетка и автоматическое размещение

Если элементов больше, чем ячеек, или элемент поставлен на линию за пределами явной сетки, браузер
достраивает **неявные дорожки** (implicit tracks). Их размер — `grid-auto-rows` / `grid-auto-columns`.

```css
.feed {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-auto-rows: minmax(100px, auto); /* каждая новая строка — не ниже 100px, но растёт по тексту */
}
```

Автоматическое размещение (auto-placement) обходит сетку курсором: по умолчанию `grid-auto-flow: row` —
слева направо, построчно, добавляя строки. `grid-auto-flow: column` — сверху вниз, добавляя колонки
(тогда нужен `grid-template-rows`).

Курсор движется только вперёд. Если элемент со `span 2` не помещается в остаток строки, он переносится на
следующую, а в текущей остаётся дыра. Курсор назад не возвращается.

### 7.1. `dense` — заполнить дыры

`grid-auto-flow: row dense` заставляет алгоритм для каждого элемента искать **первое подходящее место с
начала сетки**. Дыры заполняются меньшими элементами, идущими позже.

Цена — визуальный порядок перестаёт совпадать с порядком в DOM. Для галереи картинок это нормально,
для списка статей или формы — нет.

<details>
<summary>Дыры при автоматическом размещении и dense</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-grid.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; margin: 16px; }
  .grid { display: grid; grid-template-columns: repeat(4, 60px); grid-auto-rows: 50px; gap: 6px; margin-bottom: 16px; }
  .dense { grid-auto-flow: row dense; }
  .grid > div { background: #e0e7ff; border: 1px solid #4338ca; display: grid; place-items: center; }
  .grid > .w { grid-column: span 3; background: #fbcfe8; border-color: #be185d; }
</style>
</head>
<body>
  <p>row (по умолчанию): после «1» широкий «2» не влез, осталась дыра</p>
  <div class="grid">
    <div>1</div><div>a</div><div class="w">2</div><div>3</div><div>4</div><div class="w">5</div><div>6</div>
  </div>
  <p>row dense: поздние маленькие элементы заполнили дыры</p>
  <div class="grid dense">
    <div>1</div><div>a</div><div class="w">2</div><div>3</div><div>4</div><div class="w">5</div><div>6</div>
  </div>
</body>
</html>
```

</details>

## 8. Выравнивание

В Grid работают все шесть свойств модуля Box Alignment. Схема простая: `justify-*` — по строчной оси
(обычно горизонталь), `align-*` — по блочной (вертикаль).

| Свойство | Где | Что двигает |
|---|---|---|
| `justify-items` / `align-items` | контейнер | каждый элемент **внутри своей области** |
| `justify-self` / `align-self` | элемент | этот элемент внутри своей области |
| `justify-content` / `align-content` | контейнер | **все дорожки целиком** внутри контейнера, если они меньше него |
| `place-items`, `place-self`, `place-content` | сокращения | `align` и `justify` одной записью: сначала `align` |

Значение по умолчанию у `*-items` — `normal`, что для элементов без собственных пропорций означает
`stretch`: элемент растягивается на всю область. Поэтому в сетке все карточки одной строки равной высоты
сами собой. Для картинок (у них есть пропорции) `normal` ведёт себя как `start`.

Отличие от Flexbox: во flex нет `justify-items` и `justify-self` — главная ось там распределяется через
`justify-content` и `margin: auto`. В Grid есть все шесть.

`*-content` работает, только когда сумма дорожек меньше контейнера, то есть нет `fr` (они съедают всё
место). `justify-content: space-between` раздвигает **колонки**, а не элементы.

Центрирование чего угодно в две строки — классика:

```css
.center { display: grid; place-items: center; }
```

`margin: auto` на элементе сетки тоже работает и поглощает свободное место в области — как во flex.

<details>
<summary>items против content</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-grid.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; margin: 16px; display: flex; gap: 16px; flex-wrap: wrap; }
  .grid {
    display: grid; grid-template-columns: repeat(2, 70px); grid-template-rows: repeat(2, 50px);
    width: 240px; height: 160px; gap: 6px;
    background: #f1f5f9; outline: 2px dashed #475569;
  }
  .grid > div { background: #fca5a5; border: 1px solid #991b1b; }
  .items { place-items: center; }
  .items > div { width: 30px; height: 20px; }
  .content { place-content: space-between; }
  figure { margin: 0; }
</style>
</head>
<body>
  <figure><div class="grid items"><div></div><div></div><div></div><div></div></div>
    <figcaption>place-items: center — элементы в центре ячеек</figcaption></figure>
  <figure><div class="grid content"><div></div><div></div><div></div><div></div></div>
    <figcaption>place-content: space-between — разъехались дорожки</figcaption></figure>
</body>
</html>
```

</details>

## 9. `subgrid`

Обычная вложенная сетка ничего не знает о родительской. Классическая боль: карточки в ряд, у каждой
заголовок, текст и кнопка. Заголовки разной длины — и кнопки на разной высоте.

`subgrid` позволяет элементу сетки, который сам является сеткой, **взять дорожки родителя** вместо
своих:

```css
.cards { display: grid; grid-template-columns: repeat(3, 1fr); }
.card {
  display: grid;
  grid-row: span 3;               /* занять три строки родителя */
  grid-template-rows: subgrid;    /* и использовать их как свои */
}
```

Теперь высота строки «заголовок» общая для всех карточек: она считается по самому высокому заголовку в
строке. `subgrid` поддерживается во всех основных браузерах с 2023 года.

Детали: дорожки наследуются только в той оси, где сказано `subgrid`; промежутки (`gap`) наследуются,
но их можно переопределить; именованные линии родителя видны внутри.

<details>
<summary>Карточки с subgrid: выровненные заголовки и кнопки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-grid.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; margin: 16px; }
  .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .card {
    display: grid; grid-row: span 3; grid-template-rows: subgrid; row-gap: 8px;
    border: 1px solid #0f766e; padding: 10px; background: #f0fdfa;
  }
  .card h3 { margin: 0; background: #99f6e4; }
  .card p { margin: 0; }
  .card button { justify-self: start; }
</style>
</head>
<body>
  <div class="cards">
    <article class="card"><h3>Коротко</h3><p>Текст.</p><button>Купить</button></article>
    <article class="card"><h3>Очень длинный заголовок, который переносится на три строки</h3><p>Текст.</p><button>Купить</button></article>
    <article class="card"><h3>Средний заголовок</h3><p>Длинный текст описания, чтобы средняя строка тоже была разной высоты.</p><button>Купить</button></article>
  </div>
</body>
</html>
```

</details>

## 10. Grid или Flexbox

Обычная формулировка «Grid — два измерения, Flex — одно» верна, но неточна. Полезнее другой вопрос:
**что задаёт размер — контейнер или содержимое?**

| Ситуация | Выбор | Почему |
|---|---|---|
| Колонки должны совпадать между строками | Grid | у flex каждая строка переноса независима |
| Ряд кнопок, тегов, пунктов меню разной ширины | Flex | размер идёт от содержимого |
| Макет страницы | Grid | области, перестройка рисунком |
| Элемент слева, элемент справа, остальное посередине | оба | flex с `margin-left: auto` или grid `auto 1fr auto` |
| Карточки с одинаковыми внутренними строками | Grid + `subgrid` | flex так не умеет |
| Последняя неполная строка тянется на всю ширину | Flex (`flex: 1 1 200px`) | grid держит колонки |
| Последняя строка той же ширины колонок | Grid (`auto-fill`) | |

На практике они вкладываются друг в друга: сетка страницы снаружи, flex внутри шапки.

<details>
<summary>Одна разметка: flex-wrap против grid auto-fill</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-grid.html#example-9">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; margin: 16px; width: 420px; }
  .box { gap: 6px; outline: 2px dashed #64748b; margin-bottom: 16px; }
  .box > div { background: #fed7aa; border: 1px solid #c2410c; padding: 10px; }
  .flex { display: flex; flex-wrap: wrap; }
  .flex > div { flex: 1 1 110px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
</style>
</head>
<body>
  <p>flex: последняя строка растягивается</p>
  <div class="box flex"><div>1</div><div>2</div><div>3</div><div>4</div><div>5</div></div>
  <p>grid: колонки одинаковы во всех строках</p>
  <div class="box grid"><div>1</div><div>2</div><div>3</div><div>4</div><div>5</div></div>
</body>
</html>
```

</details>

## 11. Приёмы и тонкости

- **Наложение без `position`**: поставьте несколько элементов в одну область (`grid-area: 1 / 1`) —
  текст поверх картинки без абсолютного позиционирования, и контейнер сам вырастет по большему.
- **Абсолютное позиционирование внутри сетки**: если контейнер сетки имеет `position: relative`, а у
  абсолютного ребёнка задано `grid-area`, то **область** становится его содержащим блоком.
- **`display: contents`** на обёртке «поднимает» её детей в сетку. Удобно, но долгое время ломало
  семантику для экранных дикторов; на кнопках и ссылках не применяйте.
- **Отладка**: DevTools в Chrome и Firefox рисуют линии, номера и имена областей — включайте значок
  `grid` рядом с элементом в панели Elements.
- **Порядок свойств**: сокращение `grid` сбрасывает и неявные свойства (`grid-auto-*`). Пишите
  `grid-template` или отдельные свойства, если не хотите сюрпризов.

<details>
<summary>Текст поверх картинки без position</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-grid.html#example-10">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px system-ui, sans-serif; margin: 16px; }
  .hero { display: grid; width: 320px; }
  .hero > * { grid-area: 1 / 1; }
  .pic { height: 180px; background: linear-gradient(135deg, #0ea5e9, #6d28d9); }
  .caption { align-self: end; color: white; padding: 12px; background: rgb(0 0 0 / .4); }
</style>
</head>
<body>
  <div class="hero">
    <div class="pic"></div>
    <div class="caption">Подпись в той же ячейке, что и картинка</div>
  </div>
</body>
</html>
```

</details>

## Итог

- Сетка — это **линии**; дорожки между ними, элементы ставятся на линии.
- `fr` делит свободное место **после** фиксированных дорожек и `gap`; `1fr` = `minmax(auto, 1fr)`,
  поэтому длинное содержимое распирает колонку — лечится `minmax(0, 1fr)` или `min-width: 0`.
- `auto-fill` сохраняет пустые колонки, `auto-fit` их схлопывает; минимум пишите через `min(…, 100%)`.
- `grid-template-areas` — рисунок макета; перестраивайте его в `@media`, помня о порядке DOM.
- Неявная сетка растёт по `grid-auto-rows/columns`; `dense` заполняет дыры ценой порядка.
- `subgrid` разделяет дорожки родителя между вложенными сетками.
- Grid — когда размер задаёт контейнер, Flex — когда содержимое.

## Проверьте себя

1. Сетка из 4 колонок. Какие номера линий у правого края? Что даст `grid-column: 2 / -2`?
2. Почему `repeat(3, 1fr)` даёт колонки разной ширины, если в одной лежит длинная ссылка? Два способа
   исправить.
3. Контейнер 1000px, `repeat(auto-fit, minmax(200px, 1fr))`, элементов два. Какой ширины они будут? А
   с `auto-fill`?
4. Почему `grid-template-areas: "a a" "b b"` работает, а `"a b" "a a"` — нет? Что тогда произойдёт с
   объявлением?
5. Почему `justify-content: center` не действует на сетку `1fr 1fr`?

Дальше: [Позиционирование, `z-index` и контекст наложения](LEARN_CSS_POSITIONING_COURSE.md).
