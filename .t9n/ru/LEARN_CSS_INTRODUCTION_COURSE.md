# Введение в CSS: как стиль находит элемент

> Курс 2 из программы. Для тех, кто прошёл [Документ HTML](LEARN_HTML_DOCUMENT_COURSE.md) и знает, что
> страница — это дерево. Здесь мы подключаем к дереву стиль и сразу разбираемся, почему браузер
> рисует то, чего вы не писали: отступы, размеры заголовков, «унаследованный» фон.

**Что вы будете понимать после курса**

- три способа подключить CSS к документу и чем они отличаются для браузера, кэша и каскада;
- из чего состоит правило: селектор, блок объявлений, свойство, значение — и что делает браузер с ошибкой;
- что такое **стили браузера** (user-agent stylesheet) и какие значения в них на самом деле;
- почему `<body><header><h1>` даёт зазор сверху, хотя у `header` нет никаких отступов;
- почему цвет текста наследуется, а фон — нет, хотя выглядит наоборот;
- как два правила для одного элемента решают, кто победит (первое знакомство с каскадом).

---

## 1. CSS — это второй слой над деревом

В курсе 1 браузер превратил байты в **DOM**. CSS ничего в этом дереве не меняет: он не добавляет
узлов и не переставляет их. Он сопоставляет каждому элементу набор **значений свойств** (`color`,
`margin`, `display`…). Всё оформление — ответ на один вопрос, который браузер задаёт для **каждого**
элемента и **каждого** свойства:

> Какое значение у свойства P для элемента E?

У каждого свойства есть значение для каждого элемента всегда. Если ни одно правило его не задало,
значение берётся либо у родителя (**наследование**, inheritance), либо из определения свойства
(**начальное значение**, initial value). Пустого места не бывает. Это главное отличие CSS от
«набора украшений»: стиль — полная функция над деревом.

## 2. Три способа подключить CSS

### 2.1. Внешний файл: `<link rel="stylesheet">`

```html
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="site.css">
</head>
```

- файл кэшируется браузером и переиспользуется всеми страницами сайта;
- загрузка идёт параллельно с разбором HTML, но **рисование ждёт** таблицу (подробно — в курсе 3);
- атрибут `media` позволяет подключить таблицу условно: `<link rel="stylesheet" href="print.css" media="print">`.
  Такая таблица всё равно скачивается, но не задерживает первую отрисовку на экране.

### 2.2. Встроенный блок: `<style>`

```html
<style>
  h1 { color: teal; }
</style>
```

Нет лишнего сетевого запроса, но нет и кэша между страницами. Типичный приём — небольшой
«критический» CSS для первого экрана прямо в `<style>`, остальное — файлом. Этот репозиторий
вообще собирает страницы «всё в одном»: стили лежат внутри HTML.

### 2.3. Атрибут `style=""`

```html
<p style="color: crimson; margin: 0">Красный абзац без отступов</p>
```

Внутри атрибута — только блок объявлений, **без селектора**: элемент уже известен. Минусы:

- такое объявление сильнее любого селектора (в каскаде оно идёт отдельным уровнем, см. раздел 7);
- нельзя описать `:hover`, `@media`, `::before` — у атрибута нет селектора;
- стиль размазан по разметке, его не переиспользовать.

Атрибут `style` удобен для значений, которые вычисляет скрипт (`el.style.left = x + 'px'`), и для
передачи переменных: `style="--progress: 40%"`.

### 2.4. Сравнение

| Способ | Кэш | Селекторы и `@media` | Сила в каскаде | Когда выбирать |
|---|---|---|---|---|
| `<link>` | да | да | как у обычных правил автора | основной CSS сайта |
| `<style>` | нет (вместе с HTML) | да | как у обычных правил автора | критический CSS, одностраничники |
| `style=""` | нет | нет | выше любого селектора | значения из JavaScript, переменные |
| `@import` в CSS | да | да | как у обычных правил автора | почти никогда: цепочка запросов |

`@import url(other.css);` внутри таблицы обязан стоять до всех правил (кроме `@charset` и `@layer`).
Браузер узнаёт о вложенном файле, только скачав и разобрав внешний, — запросы идут цепочкой, а не
параллельно. Поэтому `@import` в рабочем CSS избегают; сегодня у него есть законное применение —
`@import url(x.css) layer(base);` для каскадных слоёв.

<details>
<summary>Три способа в одном документе</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-introduction.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<!-- Внешний файл подменён data:-адресом, чтобы пример был самодостаточным -->
<link rel="stylesheet" href="data:text/css,p%7Bcolor:navy%3Bfont-family:sans-serif%7D">
<style>
  p.big { font-size: 24px; }
</style>
</head>
<body>
  <p>Синий: правило из link.</p>
  <p class="big">Синий и крупный: link + style.</p>
  <p class="big" style="color: crimson">Красный: атрибут style сильнее обоих.</p>
</body>
</html>
```

</details>

## 3. Анатомия правила

```css
/* селектор      блок объявлений                        */
   h1.title    { color: teal; margin-block: 0 .5em; }
/*               └свойство┘ └значение┘                  */
```

| Термин | Английский | Что это |
|---|---|---|
| правило | rule (style rule) | селектор + блок объявлений |
| селектор | selector | шаблон над деревом: каким элементам правило применяется |
| блок объявлений | declaration block | всё в `{ }` |
| объявление | declaration | пара `свойство: значение` |
| свойство | property | имя «ручки»: `color`, `margin-block` |
| значение | value | то, что ей присваивается: `teal`, `0 .5em` |
| at-правило | at-rule | инструкция с `@`: `@media`, `@import`, `@font-face` |

Несколько деталей, которые важны сразу:

- **Список селекторов** через запятую — это сокращение: `h1, h2 { … }` равно двум правилам.
  Но если хотя бы один селектор в списке неверен, **отбрасывается всё правило**: `h1, h2:foo { … }`
  не стилизует и `h1`. (Исключение — «прощающие» списки внутри `:is()` и `:where()`, курс 4.)
- **Неизвестное свойство или неверное значение** отбрасывает одно объявление, остальные работают.
  На этом построена прогрессивная деградация:

```css
.card {
  background: #eee;                  /* старые браузеры остановятся здесь */
  background: color-mix(in oklch, teal 10%, white); /* новые перепишут */
}
```

- **Сокращённые свойства** (shorthand) задают сразу несколько полных (longhand). `margin: 0 8px` —
  это четыре свойства `margin-top/right/bottom/left`. Сокращение сбрасывает **все** свои полные
  свойства, даже не упомянутые: `background: red` обнуляет и `background-image`.
- Регистр: имена свойств и ключевые слова не зависят от регистра, имена классов и id — зависят.

<details>
<summary>Ошибка в списке селекторов убивает всё правило</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-introduction.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font-family: sans-serif; }
  /* Неизвестный псевдокласс: правило отброшено целиком, h2 не станет красным */
  h2, h3:no-such-thing { color: crimson; }
  /* Внутри :is() список прощающий: неверная часть игнорируется */
  :is(h4, h5:no-such-thing) { color: seagreen; }
  /* Неверное значение отбрасывает только одно объявление */
  p { color: navy; border: 2px solid banana; outline: 2px dashed orange; }
</style>
</head>
<body>
  <h2>h2: остался чёрным</h2>
  <h4>h4: зелёный</h4>
  <p>Синий текст, пунктирная обводка есть, рамки нет.</p>
</body>
</html>
```

</details>

## 4. Стили браузера: CSS, который был до вас

Откройте пустой документ с `<h1>` и `<p>`: заголовок крупный и жирный, вокруг текста отступы. Это
**таблица стилей браузера** (user-agent stylesheet) — обычный CSS, который браузер применяет ко
всем страницам. Спецификация HTML публикует рекомендуемую таблицу (раздел «Rendering»), и все
современные браузеры следуют ей очень близко. Вот самое заметное (значения из этой таблицы):

```css
html, body, div, header, main, section, article, nav, aside, footer, p, h1, ul, ol, li, form
                { display: block; }        /* li на самом деле display: list-item */
head, script, style, title, meta, link
                { display: none; }
body            { margin: 8px; }
p               { margin-block: 1em; }     /* 1em сверху и снизу, 0 по бокам */
h1              { font-size: 2em;    margin-block: 0.67em; font-weight: bold; }
h2              { font-size: 1.5em;  margin-block: 0.83em; }
h3              { font-size: 1.17em; margin-block: 1em; }
h4              { font-size: 1em;    margin-block: 1.33em; }
h5              { font-size: 0.83em; margin-block: 1.67em; }
h6              { font-size: 0.67em; margin-block: 2.33em; }
ul, ol          { margin-block: 1em; padding-inline-start: 40px; }
strong, b       { font-weight: bolder; }
em, i           { font-style: italic; }
a:link          { color: LinkText; text-decoration: underline; }
```

Что из этого следует:

- **`display` — тоже стиль браузера.** «Блочный элемент» — не свойство тега, а значение
  `display: block` из таблицы браузера. `<span>` строчный, потому что у `display` начальное значение
  `inline`, и таблица браузера для `span` ничего не меняет. Любой элемент можно переключить.
- **`<head>` не виден** не потому, что «он особенный», а из-за `display: none`. Это можно отменить:
  `head, title { display: block }` покажет заголовок вкладки на странице.
- **Размеры заголовков в `em`.** `em` в `font-size` — от шрифта родителя. При базовых 16px `h1`
  получает 32px, а его `margin-block: 0.67em` считается уже от *своего* шрифта: 0,67 × 32 = 21,44px.
- **Отступы абзацев — `1em` от их шрифта**, поэтому у крупного абзаца и отступы больше.
- Логические свойства (`margin-block`, `padding-inline-start`) значат «сверху/снизу» и «в начале
  строки» для горизонтального письма слева направо; для арабского `padding-inline-start` — справа.

<details>
<summary>Стили браузера на виду: включаем head и обводим блоки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-introduction.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Это заголовок вкладки</title>
<style>
  /* Отменяем display: none из таблицы браузера */
  head, title { display: block; }
  title { background: lightyellow; font-family: monospace; }
  /* Делаем видимыми блоки и их отступы */
  body * { outline: 1px solid rgb(0 128 128 / .5); }
</style>
</head>
<body>
  <h1>h1: 2em, отступы 0.67em</h1>
  <p>p: отступы 1em сверху и снизу</p>
  <ul><li>ul: отступ слева 40px под маркеры</li></ul>
  <span>span: строчный</span> <span>ещё span</span>
</body>
</html>
```

</details>

Посмотреть точные значения можно в инструментах разработчика: панель Elements → Styles показывает
правила с пометкой «user agent stylesheet». Это первое место, куда смотреть, когда «отступ взялся
ниоткуда».

### 4.1. Сброс и нормализация

Есть две школы обращения со стилями браузера:

| Подход | Идея | Плюс | Минус |
|---|---|---|---|
| reset | обнулить всё: `* { margin: 0; padding: 0 }` | предсказуемый ноль | теряется полезное: отступы списков, заголовков |
| normalize | выровнять различия браузеров, сохранить разумные умолчания | меньше работы | надо знать, что именно оставлено |
| точечный | снять только мешающее: `body { margin: 0 }` | минимум CSS | каждое решение — вручную |

Современные браузеры почти не расходятся, поэтому многие ограничиваются точечным подходом и
парой строк вроде `body { margin: 0 }` и `*, *::before, *::after { box-sizing: border-box }`.

## 5. Почему `<body><header>` даёт зазор

Классическая загадка. Цель — тёмная шапка вплотную к верху окна:

```html
<body>
  <header><h1>Сайт</h1></header>
</body>
```

```css
body   { margin: 0; }
header { background: #234; color: white; }
```

`margin` у `body` обнулён, у `header` отступов нет — а сверху всё равно светлая полоса, и шапка
начинается ниже. Причина в двух механизмах сразу.

### 5.1. Отступ пришёл от `h1`

У `h1` из таблицы браузера `margin-block: 0.67em`, то есть 21,44px сверху.

### 5.2. Схлопывание отступов «сквозь» родителя

**Схлопывание отступов** (margin collapsing): вертикальные внешние отступы соседних блоков в
нормальном потоке не складываются, а сливаются в один, равный большему. Важнейший частный случай —
**отступ первого ребёнка и отступ родителя**: если между верхним краем родителя и верхним краем
его первого потомка нет ничего — ни `border`, ни `padding`, ни строчного содержимого, — и родитель
не создаёт новый **контекст форматирования блоков** (block formatting context), то отступ ребёнка
**выходит наружу** и становится отступом родителя.

Цепочка такая: отступ `h1` (21,44px) проходит через `header` (нет рамки и полей), затем через
`body` (его `margin: 0` сливается с 21,44px → 21,44px). У корня `html` отступы со своими детьми не
схлопываются, поэтому всё останавливается здесь: `body` оказывается на 21,44px ниже верха окна. Фон
`header` рисуется в пределах рамки `header`, а не на месте выпавшего отступа, — вот и светлая полоса.

Если `body { margin: 8px }` (как по умолчанию), отступы 8px и 21,44px тоже схлопываются, и зазор
равен **21,44px**, а не 29,44px.

<details>
<summary>Загадка зазора и пять способов его убрать</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-introduction.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; font-family: sans-serif; background: #fde; }
  header { background: #234; color: white; }
  section { margin-bottom: 12px; }
  /* Способы — по одному на каждую шапку */
  .fix-margin h1 { margin-top: 0; }
  .fix-padding  { padding-top: 1px; }
  .fix-border   { border-top: 1px solid #234; }
  .fix-flow     { display: flow-root; }
  .fix-flex     { display: flex; }
  h1 { font-size: 20px; }
</style>
</head>
<body>
  <section><header><h1>Без исправления: отступ h1 выпал наружу</h1></header></section>
  <section><header class="fix-margin"><h1>h1 { margin-top: 0 }</h1></header></section>
  <section><header class="fix-padding"><h1>header { padding-top: 1px }</h1></header></section>
  <section><header class="fix-border"><h1>header { border-top }</h1></header></section>
  <section><header class="fix-flow"><h1>header { display: flow-root }</h1></header></section>
  <section><header class="fix-flex"><h1>header { display: flex }</h1></header></section>
</body>
</html>
```

</details>

### 5.3. Какой способ выбрать

| Способ | Что делает | Когда плох |
|---|---|---|
| `h1 { margin-top: 0 }` | убирает сам отступ | если внутри может оказаться другой первый элемент |
| `padding` у родителя | ставит преграду между краями | меняет размер, если не нужен внутренний отступ |
| `border` у родителя | тоже преграда | лишняя линия, иногда в цвет фона |
| `display: flow-root` | создаёт новый контекст форматирования блоков, отступы детей остаются внутри | почти никогда; создан ровно для этого |
| `display: flex` / `grid` | у flex- и grid-элементов отступы не схлопываются вообще | меняет раскладку детей |
| `overflow: hidden` | старый способ создать контекст | обрезает тени и выпадающие меню |

Профессиональная привычка — задавать вертикальный ритм отступами **в одну сторону** (например,
только `margin-block-end` или `gap` в flex/grid-контейнере). Тогда схлопывание почти не
встречается. Подробно — в [Блочная модель и схлопывание отступов](LEARN_CSS_BOX_MODEL_COURSE.md).

<details>
<summary>Соседи: 20px и 30px дают 30px, а не 50px</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-introduction.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font-family: sans-serif; }
  .a { margin-bottom: 20px; background: #cde; }
  .b { margin-top: 30px; background: #fdc; }
  .flex { display: flex; flex-direction: column; outline: 1px dashed gray; }
  p { margin: 0; padding: 6px; }
</style>
</head>
<body>
  <p class="a">margin-bottom: 20px</p>
  <p class="b">margin-top: 30px — расстояние 30px (схлопнулось)</p>
  <hr>
  <div class="flex">
    <p class="a">в flex-контейнере</p>
    <p class="b">расстояние 50px: здесь отступы не схлопываются</p>
  </div>
</body>
</html>
```

</details>

## 6. Первое знакомство с наследованием

### 6.1. Что наследуется

Свойства делятся на **наследуемые** (inherited) и **ненаследуемые**. Если для элемента значение не
задано никаким правилом:

- наследуемое свойство берёт значение **родителя** (`color`, `font-*`, `line-height`, `text-align`,
  `visibility`, `cursor`, `list-style` — в основном всё, что про текст);
- ненаследуемое берёт **начальное значение** (`margin: 0`, `border: none`, `background-color:
  transparent`, `display: inline`, `width: auto` — всё, что про коробку).

Логика простая: если бы `border` наследовался, рамка у `article` нарисовалась бы вокруг каждого
абзаца и слова внутри. А текст, наоборот, естественно красить сразу у предка.

Поэтому `body { color: #222; font-family: system-ui }` красит весь документ: правило задаёт значение
только для `body`, остальные элементы его наследуют.

Исключения из таблицы браузера: у ссылок свой `color`, поэтому они не наследуют цвет `body`. Поля
форм (`input`, `button`) по умолчанию не наследуют шрифт — для них в таблице браузера задан свой.
Отсюда частое `button, input { font: inherit; }`.

### 6.2. Фон не наследуется, но кажется, что наследуется

```css
article { background: lightyellow; }
```

Абзацы внутри — тоже жёлтые. Наследование? Нет. У `p` значение `background-color` —
начальное, `transparent`. Блок абзаца прозрачный, и сквозь него виден фон, нарисованный **коробкой
`article`** на всей её площади. Проверка — `getComputedStyle(p).backgroundColor` вернёт
`rgba(0, 0, 0, 0)`.

Разница проявляется, как только у ребёнка появляется что-то своё: отступ, выход за пределы
родителя, позиционирование. Тогда видно, что фон принадлежит коробке родителя, а не ребёнку.

<details>
<summary>Фон «просвечивает», цвет — наследуется</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-introduction.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font-family: sans-serif; }
  article { background: lightyellow; color: darkgreen; padding: 8px; width: 260px; }
  .out { margin-left: 200px; outline: 1px dashed gray; }
  output { display: block; font-family: monospace; color: black; }
</style>
</head>
<body>
  <article>
    <p id="p">Зелёный текст: color унаследован.</p>
    <p class="out">Этот абзац вылез вправо: за краем article фона нет.</p>
  </article>
  <output id="o"></output>
  <script>
    // Вычисленные значения абзаца: цвет — от родителя, фон — прозрачный
    var s = getComputedStyle(document.getElementById('p'));
    document.getElementById('o').textContent =
      'color: ' + s.color + ' / background-color: ' + s.backgroundColor;
  </script>
</body>
</html>
```

</details>

### 6.3. Фон `body` захватывает всё окно

Ещё одна особенность, которая кажется наследованием, а на деле — особое правило. Сделаем
`body { background: lavender; margin: 40px }`. Ожидание: фиолетовый прямоугольник с полями 40px.
Реальность: фиолетовое **всё окно**, включая поля.

Правило из спецификации CSS Backgrounds:

1. Фон **корневого элемента** (`html`) рисуется на **холсте** (canvas) — бесконечной поверхности
   под документом, — а не только в пределах коробки `html`.
2. Если у `html` фон не задан (`transparent` и без картинки), то фон `body` **передаётся**
   (propagates) корню и, значит, тоже рисуется на холсте. Сам `body` тогда рисуется без фона.

Причина историческая: раньше фон страницы задавали атрибутом `<body bgcolor>`, и он должен был
заливать всё окно. Правило сохранило это поведение для CSS.

Как только у `html` появляется свой фон, передача отключается: холст красится фоном `html`, а фон
`body` — только в пределах коробки `body`.

<details>
<summary>Фон body передаётся холсту</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-introduction.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { background: lavender; margin: 40px; outline: 3px dashed purple; font-family: sans-serif; }
  /* Нажмите кнопку: у html появится свой фон, и передача отключится */
  html.own { background: white; }
</style>
</head>
<body>
  <p>Пунктир — коробка body. Фиолетовым залито всё окно.</p>
  <button onclick="document.documentElement.classList.toggle('own')">
    переключить фон у html
  </button>
</body>
</html>
```

</details>

Полностью наследование, `inherit`, `initial`, `unset` и `revert` разобраны в
[Наследование и значения по умолчанию](LEARN_CSS_INHERITANCE_COURSE.md).

## 7. Первое знакомство с каскадом

Что если два правила задают одно свойство одному элементу?

```css
p       { color: navy; }
.note   { color: crimson; }
```

Для `<p class="note">` оба подходят. Решает **каскад** (cascade) — алгоритм, который из всех
**объявлений-кандидатов** выбирает одно, **побеждающее** (cascaded value). Сравнение идёт по
критериям, по очереди, пока не найдётся различие:

1. **Происхождение и важность** (origin and importance): стили браузера < стили автора (ваши) <
   `!important` автора < `!important` браузера. Поэтому ваш `body { margin: 0 }` побеждает
   `body { margin: 8px }` браузера без всяких ухищрений.
2. **Контекст** (shadow DOM) — пока пропустим.
3. **Атрибут `style`**: объявление в `style=""` сильнее любого правила с селектором того же
   происхождения.
4. **Каскадные слои** (`@layer`).
5. **Специфичность** (specificity) селектора: id сильнее класса, класс сильнее типа.
   `.note` (0,1,0) побеждает `p` (0,0,1) — и **не важно**, в каком порядке они написаны.
6. **Порядок в коде**: при равенстве всего остального побеждает объявление, которое встретилось
   позже.

Каскад решает спор **по каждому свойству отдельно**. Если `.note` задаёт только `color`, то
`font-size` из правила `p` по-прежнему применяется. Правила не «перекрывают» друг друга целиком.

<details>
<summary>Спор правил: специфичность важнее порядка</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-introduction.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font-family: sans-serif; }
  .note { color: crimson; }       /* (0,1,0) — выше в коде, но сильнее */
  p     { color: navy; font-size: 20px; }  /* (0,0,1) */
  p     { color: teal; }          /* та же специфичность, позже: побеждает navy */
  #main { color: darkorange; }    /* (1,0,0) */
</style>
</head>
<body>
  <p>teal: из двух p побеждает последний</p>
  <p class="note">crimson: класс сильнее типа, font-size 20px остался от p</p>
  <p class="note" id="main">darkorange: id сильнее класса</p>
  <p class="note" style="color: seagreen">seagreen: атрибут style сильнее селекторов</p>
</body>
</html>
```

</details>

`!important` разворачивает порядок происхождения: важное объявление браузера сильнее важного
объявления автора. Это сделано, чтобы пользовательские настройки доступности (у пользователя тоже
есть своё происхождение) могли победить автора. В авторском CSS `!important` — признак проигранной
войны специфичностей; правильные инструменты — `@layer` и `:where()`. Всё это — в
[Каскад и специфичность](LEARN_CSS_CASCADE_COURSE.md).

## 8. От правила до пикселя: четыре «значения»

Чтобы потом не путаться, сразу назовём этапы, через которые проходит значение свойства:

| Этап | Английский | Пример для `width: 50%` у блока в родителе 600px |
|---|---|---|
| объявленные | declared | все объявления `width`, подошедшие элементу |
| каскадное | cascaded | победитель каскада: `50%` |
| заданное | specified | каскадное или, если его нет, унаследованное/начальное |
| вычисленное | computed | `50%` (проценты ширины остаются до раскладки); для `font-size: 2em` здесь уже px |
| используемое | used | `300px` — после раскладки |

`getComputedStyle()` исторически возвращает **разрешённое значение** (resolved value): для одних
свойств вычисленное, для других (как `width`) — используемое. Поэтому он вернёт `300px`, а не `50%`.

<details>
<summary>getComputedStyle: em превращается в px</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-introduction.html#example-9">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px sans-serif; }
  .box { font-size: 1.5em; width: 50%; background: #def; padding: 4px; }
  .box h1 { outline: 1px solid teal; }
  pre { background: #f4f4f4; padding: 6px; }
</style>
</head>
<body>
  <div class="box"><h1>h1 внутри шрифта 24px</h1></div>
  <pre id="out"></pre>
  <script>
    var box = document.querySelector('.box');
    var h1 = box.querySelector('h1');
    var b = getComputedStyle(box), h = getComputedStyle(h1);
    // 1.5em от 16px = 24px; h1 = 2em от 24px = 48px; его margin = 0.67em от 48px
    document.getElementById('out').textContent =
      '.box font-size: ' + b.fontSize + '\n' +
      '.box width:     ' + b.width + '\n' +
      'h1 font-size:   ' + h.fontSize + '\n' +
      'h1 margin-top:  ' + h.marginTop;
  </script>
</body>
</html>
```

</details>

## Итог

- CSS не меняет дерево, а приписывает **каждому элементу значение каждого свойства**.
- `<link>` кэшируется и годится для основного CSS; `<style>` — для критического; `style=""`
  сильнее селекторов и нужен для значений из JavaScript. `@import` создаёт цепочку запросов.
- Ошибка в селекторе отбрасывает всё правило, ошибка в значении — одно объявление.
- Стили браузера — обычный CSS: `body { margin: 8px }`, `h1 { font-size: 2em; margin-block: 0.67em }`,
  `p { margin-block: 1em }`, `display` у всех элементов.
- Зазор над шапкой — отступ первого ребёнка, **схлопнувшийся** сквозь родителей без рамки и полей.
  Лечится `display: flow-root`, `padding`, `border` или отказом от отступа.
- `color` и шрифт наследуются; `background` — нет, он рисуется коробкой и виден сквозь прозрачных
  детей. Фон `body` передаётся холсту, если у `html` своего фона нет.
- Каскад решает спор **по каждому свойству**: происхождение → `style` → слои → специфичность → порядок.

## Проверьте себя

1. Почему `h1, h1::frobnicate { color: red }` не красит заголовок, а `:is(h1, h1::frobnicate)` красит?
2. У `body` отступ по умолчанию 8px, первый ребёнок — `h1` с отступом 21,44px. Какое расстояние от
   верха окна до текста и почему не 29,44px?
3. Что вернёт `getComputedStyle(p).backgroundColor` для абзаца внутри `article` с жёлтым фоном?
4. Почему при `body { background: pink; margin: 50px }` розовым будет всё окно и как это отключить?
5. `.a { color: red }` стоит в коде раньше `div { color: blue }`. Какого цвета `<div class="a">`?

Дальше: [Как браузер рисует страницу: от байтов до пикселей](LEARN_WEB_RENDERING_PIPELINE_COURSE.md).
