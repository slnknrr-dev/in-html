# Наследование и значения по умолчанию

> Курс 6 из программы. Для тех, кто прошёл [Каскад и специфичность](LEARN_CSS_CASCADE_COURSE.md)
> и знает, как выбирается победитель среди объявлений. Здесь — что происходит, когда объявлений
> нет вовсе, и почему фон «наследуется», хотя на самом деле нет.

**Что вы будете понимать после курса**

- полный путь значения: **объявленное → каскадное → указанное → вычисленное → используемое →
  фактическое**;
- какие свойства **наследуются** (inherited) и какой в этом замысел;
- что именно передаётся по наследству — **вычисленное** значение, и почему `line-height: 1.5`
  и `line-height: 1.5em` ведут себя по-разному;
- ключевые слова `inherit`, `initial`, `unset`, `revert`, `revert-layer` и свойство `all`;
- почему фон кажется унаследованным: кто его рисует, где он виден, как фон `body` попадает на
  **холст** (canvas) и чем фон строчного элемента отличается от фона блока;
- что такое `currentColor` и почему рамка по умолчанию цвета текста.

---

## 1. Путь значения: шесть стадий

У каждого элемента **каждое** CSS-свойство имеет значение — даже если вы ничего не написали.
Спецификация описывает конвейер:

| Стадия | Англ. термин | Что происходит | Пример для `width: 50%` |
|---|---|---|---|
| Объявленные | declared values | все валидные объявления, подходящие элементу | `50%`, `auto` из UA |
| Каскадное | cascaded value | победитель каскада (или ничего) | `50%` |
| Указанное | specified value | каскадное, а если его нет — унаследованное или начальное | `50%` |
| Вычисленное | computed value | относительное приведено, насколько можно **без раскладки** | `50%` |
| Используемое | used value | после раскладки, в абсолютных единицах | `400px` |
| Фактическое | actual value | после ограничений устройства (округление пикселей) | `400px` |

Ключевой шаг для этого курса — **указанное значение**. Если каскад ничего не дал, браузер решает так:

- свойство **наследуемое** и у элемента есть родитель → берётся **вычисленное** значение родителя;
- иначе → **начальное значение** (initial value) из определения свойства.

Начальное значение — это не «стиль браузера». У `display` начальное — `inline`, хотя `div` блочный:
`display: block` для `div` приходит из стилей браузера через каскад.

## 2. Что наследуется и почему

Правило-ориентир: **наследуется то, что описывает текст; не наследуется то, что описывает коробку**.

| Наследуются (текст) | Не наследуются (коробка) |
|---|---|
| `color` | `background-*` |
| `font-*`, `line-height` | `border-*`, `outline-*` |
| `letter-spacing`, `word-spacing` | `margin-*`, `padding-*` |
| `text-align`, `text-indent`, `text-transform` | `width`, `height`, `box-sizing` |
| `white-space`, `hyphens`, `direction` | `display`, `position`, `float` |
| `visibility`, `cursor` | `opacity`, `transform`, `filter` |
| `list-style-*`, `quotes` | `overflow`, `z-index` |
| `border-collapse`, `border-spacing`, `caption-side` | `vertical-align`, `text-decoration` |
| все пользовательские свойства `--x` | `content` |

Почему так? Представьте обратное:

- если бы наследовался `border`, рамку `section` получили бы каждый абзац, каждая ссылка и каждое
  слово в `<em>` — ненужные рамки на всех уровнях;
- если бы наследовался `margin`, отступы складывались бы в геометрической прогрессии вглубь дерева;
- если бы **не** наследовался `color`, пришлось бы писать цвет для `p`, `li`, `em`, `a`, `span`…

Наследование — это экономия: шрифт и цвет пишут один раз на `body`, и весь текст его получает.

<details>
<summary>Цвет и шрифт наследуются, рамка и отступ — нет</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-inheritance.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  section { color: darkblue; font: italic 17px Georgia, serif;
            border: 3px solid crimson; padding: 12px; }
</style>
</head>
<body>
  <section>
    Текст секции.
    <p>Абзац: курсив и синий цвет пришли от section, а рамки у абзаца нет.</p>
    <p>Внутри <em>em</em> — тоже синий.</p>
  </section>
</body>
</html>
```

</details>

### 2.1. Исключения внутри стилей браузера

Наследование можно «перебить» каскадом — и стили браузера это делают. Ссылка не наследует цвет
родителя, потому что у неё есть собственное правило `a:link { color: … }` (синий). Кнопки и поля
ввода не наследуют шрифт, потому что стили браузера задают им `font` явно. Отсюда классический сброс:

```css
button, input, select, textarea { font: inherit; color: inherit; }
```

`text-decoration` формально не наследуется, но подчёркивание **распространяется** (propagates) на
потомков: оно рисуется через всё содержимое строчного блока. Поэтому `a span { text-decoration:
none }` не снимет подчёркивание ссылки — его рисует сама ссылка поверх текста потомка.

<details>
<summary>Подчёркивание нельзя снять у потомка</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-inheritance.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 18px sans-serif; }
  a span { text-decoration: none; color: crimson; }
  a .ib { display: inline-block; text-decoration: none; }
</style>
</head>
<body>
  <p><a href="#">Ссылка <span>span всё равно подчёркнут</span></a></p>
  <p><a href="#">Ссылка <span class="ib">inline-block — уже нет</span></a></p>
  <p>Подчёркивание не распространяется в атомарные строчные блоки, такие как inline-block.</p>
</body>
</html>
```

</details>

## 3. Наследуется вычисленное значение

Ребёнок получает не текст `2em`, а **вычисленное** значение родителя. Для `font-size` `em`
вычисляется в пиксели, поэтому проценты и `em` не «перемножаются» повторно при наследовании — но
**накапливаются**, если правило снова срабатывает на каждом уровне:

```css
li { font-size: 1.2em; } /* вложенные списки растут: 1.2 × 1.2 × 1.2… */
li { font-size: 1.2rem; } /* rem — от корня, роста нет */
```

### 3.1. `line-height`: число против `em`

Самый известный пример разницы.

- `line-height: 1.5em` вычисляется **в пиксели** на элементе, где написан. Дети наследуют пиксели.
- `line-height: 1.5` (число без единиц) **остаётся числом** в вычисленном значении. Каждый потомок
  умножает его на **свой** `font-size`.

<details>
<summary>line-height: 1.5 против 1.5em</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-inheritance.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px sans-serif; display: flex; gap: 16px; }
  div { width: 260px; border: 1px solid #999; padding: 6px; }
  .em  { line-height: 1.5em; } /* 21px наследуется всем */
  .num { line-height: 1.5; }   /* множитель наследуется */
  h2 { font-size: 32px; margin: 0; background: #ffe9a8; }
</style>
</head>
<body>
  <div class="em"><h2>Заголовок в 32px на 1.5em — строки слиплись</h2></div>
  <div class="num"><h2>Заголовок в 32px на 1.5 — строки по 48px</h2></div>
</body>
</html>
```

</details>

Поэтому `line-height` почти всегда пишут числом.

### 3.2. Проценты, которые остаются процентами

У `width: 50%` вычисленное значение — всё ещё `50%`: размер родителя неизвестен до раскладки.
Если ребёнку написать `width: inherit`, он унаследует `50%` и посчитает их **от своего** блока
(то есть от родителя), а не получит пиксели родителя. Это легко проверить в DevTools: Computed
показывает используемые пиксели, а `getComputedStyle` для `width` тоже отдаёт используемое значение —
исторически он возвращает **resolved value**, смесь вычисленного и используемого.

## 4. Ключевые слова для всех свойств

Пять ключевых слов принимает **любое** свойство (CSS-wide keywords):

| Слово | Что значит |
|---|---|
| `inherit` | взять вычисленное значение родителя — даже для ненаследуемого свойства |
| `initial` | начальное значение из спецификации свойства |
| `unset` | наследуемое → как `inherit`; ненаследуемое → как `initial` |
| `revert` | откатиться к значению из **предыдущего источника** каскада (обычно — стили браузера) |
| `revert-layer` | откатиться к значению из **предыдущего слоя** того же источника |

Самая частая ловушка — `initial`: это **не** «как было по умолчанию у элемента».

<details>
<summary>initial против revert для display</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-inheritance.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px sans-serif; }
  div { display: flex; gap: 8px; background: #eef; margin: 6px 0; padding: 4px; }
  .i { display: initial; } /* начальное значение display — inline */
  .r { display: revert; }  /* стиль браузера для div — block */
  span { border: 1px solid #555; padding: 2px 6px; }
</style>
</head>
<body>
  <div><span>flex</span><span>flex</span></div>
  <div class="i"><span>initial</span><span>стал inline!</span></div>
  <div class="r"><span>revert</span><span>снова block</span></div>
</body>
</html>
```

</details>

### 4.1. Свойство `all`

`all` — сокращение для всех свойств, кроме `direction`, `unicode-bidi` и пользовательских свойств.
Смысл имеют только ключевые слова:

- `all: unset` — «чистый лист»: текст наследуется от родителя, коробка без оформления. Удобно для
  кнопки, которая должна выглядеть как текст.
- `all: revert` — вернуть стили браузера, отменив все авторские.
- `all: initial` — почти всегда ошибка: элемент станет `display: inline`, шрифт — начальным, а не
  унаследованным.

<details>
<summary>Кнопка-ссылка через all: unset</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-inheritance.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 17px Georgia, serif; color: #333; }
  .link { all: unset; color: royalblue; text-decoration: underline; cursor: pointer; }
  /* all: unset убирает и обводку фокуса: возвращаем её явно */
  .link:focus-visible { outline: 2px solid royalblue; outline-offset: 2px; }
</style>
</head>
<body>
  <p>Текст абзаца и <button class="link">кнопка, похожая на ссылку</button> — шрифт унаследован
     от абзаца. Нажмите Tab, чтобы увидеть фокус.</p>
</body>
</html>
```

</details>

## 5. Почему фон кажется унаследованным

Напишите `section { background: gold }` — и абзацы внутри будут на жёлтом. Похоже на наследование,
но проверьте: `getComputedStyle(p).backgroundColor` вернёт `rgba(0, 0, 0, 0)` — **прозрачный**.
Начальное значение `background-color` — `transparent`, и оно не наследуется.

Что на самом деле происходит:

1. Блок `section` **рисует** свой фон на всей своей площади — область рамки (border box) по умолчанию,
   `background-clip: border-box`.
2. Абзацы лежат **внутри** этой площади и сами ничего не рисуют — они прозрачны.
3. Сквозь прозрачного ребёнка виден фон предка. Это **отрисовка** (painting), а не наследование.

Разницу легко увидеть, когда ребёнок выходит за пределы родителя или когда фон — картинка.

<details>
<summary>Фон рисует родитель, а не наследует ребёнок</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-inheritance.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px sans-serif; }
  section { background: gold; padding: 10px; height: 80px; }
  p { margin: 0; }
  .out { margin-top: 50px; outline: 2px dashed crimson; }
  .inh { background: inherit; outline: 2px dashed royalblue; }
</style>
</head>
<body>
  <section>
    <p>Мой фон прозрачен, жёлтый — это section под мной.</p>
    <p class="out">А я вылез за высоту section — и я уже без фона.</p>
  </section>
  <p class="inh">background: inherit — теперь у меня собственный фон (от body: прозрачный).</p>
  <pre id="o"></pre>
  <script>
    // Вычисленный фон абзаца: прозрачный.
    document.getElementById('o').textContent =
      'getComputedStyle(p).backgroundColor = ' + getComputedStyle(document.querySelector('p')).backgroundColor;
  </script>
</body>
</html>
```

</details>

Если бы фон действительно наследовался, картинка-фон `section` с `background-image` повторялась бы
заново в каждом абзаце — с собственной точкой начала. Так происходит именно с `background: inherit`.

### 5.1. Строчный и блочный: какую площадь закрывает фон

Площадь фона зависит от **типа коробки**:

- **блочный** (`display: block`) — прямоугольник во всю доступную ширину и на всю высоту содержимого
  плюс внутренние отступы;
- **строчный** (`display: inline`) — только **строчные фрагменты**: полосы по высоте шрифта вокруг
  текста, разорванные на переносах строк. Межстрочное пространство (`line-height`) остаётся
  незакрашенным, а вертикальный `padding` рисуется, но **не раздвигает** строки и наезжает на соседние.
- `box-decoration-break: clone` заставляет каждый фрагмент рисовать свои отступы и скругления.

<details>
<summary>Фон блочного и строчного элемента</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-inheritance.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/2 sans-serif; width: 340px; }
  .b { display: block;  background: #ffd36e; }
  .i { display: inline; background: #9fd8ff; padding: 4px 6px; }
  .c { display: inline; background: #b9f0b0; padding: 4px 6px; border-radius: 6px;
       -webkit-box-decoration-break: clone; box-decoration-break: clone; }
</style>
</head>
<body>
  <span class="b">Блок: фон — сплошной прямоугольник во всю ширину, вместе с межстрочными промежутками.</span>
  <p><span class="i">Строчный: фон только вокруг текста, между строками — просветы, края на переносе обрезаны.</span></p>
  <p><span class="c">Строчный с clone: каждая строка получила свои отступы и скругления.</span></p>
</body>
</html>
```

</details>

### 5.2. Фон `body` закрашивает весь холст

Ещё одна «магия»: `body { background: navy }` закрашивает всё окно, хотя `body` может быть высотой
в одну строку и с полями 8px. Это **распространение фона** (background propagation):

1. Фон корневого элемента `html` рисуется не на нём, а на **холсте** — бесконечной поверхности под
   документом.
2. Если у `html` фон пустой (`transparent` и без картинки), браузер берёт фон `body` и переносит
   его на корень — а значит, на холст. Сам `body` тогда считается без фона.

Как только вы зададите фон и `html`, магия кончится: `body` станет обычным блоком со своим фоном.

<details>
<summary>Распространение фона body на холст</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-inheritance.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  /* Включите строку ниже, чтобы остановить распространение */
  /* html { background: #eee; } */
  body { background: #234; color: white; font: 15px sans-serif;
         outline: 3px dashed gold; margin: 20px; }
</style>
</head>
<body>
  <p>body обведён жёлтым пунктиром, он маленький. Но тёмный фон — на всём окне.</p>
</body>
</html>
```

</details>

То же правило для `overflow`: `overflow` у `body` переносится на окно просмотра (viewport), если
у `html` он `visible`.

## 6. `currentColor`

`currentColor` — ключевое слово «значение `color` этого же элемента». Им пользуются стили по
умолчанию: начальное значение `border-color`, `outline-color`, `text-decoration-color`,
`column-rule-color` — по сути `currentColor`. Поэтому `border: 2px solid` без цвета рисует рамку
цвета текста.

Сила `currentColor` вместе с наследованием: `color` наследуется, значит, одна смена `color` у
предка перекрашивает и текст, и рамки, и SVG-иконки с `fill="currentColor"`.

<details>
<summary>Одна смена color перекрашивает всё (наведите курсор)</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-inheritance.html#example-9">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  .btn { color: royalblue; font: 16px sans-serif; display: inline-flex; gap: 8px;
         align-items: center; padding: 8px 14px; border: 2px solid; border-radius: 6px;
         background: none; cursor: pointer; }
  .btn:hover { color: crimson; } /* меняем только color */
  svg { width: 18px; height: 18px; }
</style>
</head>
<body>
  <button class="btn">
    <svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>
    Рамка, текст и иконка — всё от color
  </button>
</body>
</html>
```

</details>

Тонкость: при наследовании передаётся `currentColor` как ключевое слово, а не готовый цвет. Если
ребёнок наследует, например, `text-shadow: 0 0 2px currentColor`, тень у него будет цвета **его**
`color`.

## 7. Пользовательские свойства наследуются

Все `--переменные` наследуются по умолчанию. На этом стоят темы: `:root { --accent: … }` видно
везде, а `.dark { --accent: … }` переопределяет поддерево. Через `@property` можно объявить
переменную **ненаследуемой** (`inherits: false`) и с типом. Подробнее — в курсе
[Пользовательские свойства и темы](LEARN_CSS_CUSTOM_PROPERTIES_COURSE.md).

## Итог

- Нет объявления → наследуемое свойство берёт **вычисленное** значение родителя, остальные —
  **начальное**.
- Наследуется «текстовое» (`color`, `font`, `line-height`), не наследуется «коробочное» (`background`,
  `border`, `margin`).
- `line-height` — числом: число наследуется как множитель, `em` — как пиксели.
- `initial` ≠ стиль браузера; для «вернуть как было» — `revert`.
- Фон не наследуется: его рисует блок, а прозрачные потомки его показывают. Фон `body` уходит на
  холст, если у `html` фона нет.
- `currentColor` связывает рамки, обводки и SVG с наследуемым `color`.

## Проверьте себя

1. Почему у кнопки внутри `body { font-family: Georgia }` всё равно системный шрифт? Как это исправить
   одной строкой?
2. Что вернёт `getComputedStyle(p).backgroundColor` для абзаца внутри жёлтого `div` и почему?
3. Чем `div { display: initial }` отличается от `div { display: revert }`?
4. Зададим `html { background: white } body { background: black; margin: 40px }`. Как будет выглядеть
   страница?
5. `section { line-height: 2em; font-size: 10px } h2 { font-size: 30px }` — какой интерлиньяж у `h2`?

Дальше: [Блочная модель и схлопывание отступов](LEARN_CSS_BOX_MODEL_COURSE.md).
