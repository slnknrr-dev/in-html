# Нормальный поток и `display`

> Курс 8 из программы. Для тех, кто уже знает блочную модель и схлопывание отступов
> ([Блочная модель и схлопывание отступов](LEARN_CSS_BOX_MODEL_COURSE.md)) и хочет понять, *где*
> браузер ставит каждый бокс и почему. Здесь нет рецептов «как отцентрировать» — здесь алгоритм,
> из которого рецепты выводятся сами.

**Что вы будете понимать после курса**

- что такое **нормальный поток** (normal flow) и почему это поведение по умолчанию, а не «отсутствие вёрстки»;
- чем блочный контекст форматирования отличается от строчного и откуда берутся **строчные боксы** (line boxes);
- откуда взялся «зазор» между `inline-block`-элементами и четыре способа его убрать (и чем каждый плох);
- что такое **блочный контекст форматирования** (BFC), что его создаёт и зачем нужен `display: flow-root`;
- как работают `float` и `clear` и почему родитель «не видит» плавающих детей;
- что такое **анонимные боксы** и почему текст рядом с `<div>` вдруг ведёт себя как блок;
- двухзначный синтаксис `display: block flex` — внешний и внутренний тип отображения;
- разницу между `display: none`, `visibility: hidden` и `display: contents`;
- что такое **замещаемые элементы** (replaced elements) и почему `<img>` ведёт себя «как буква».

---

## 1. Из дерева — в дерево боксов

В курсе [Как браузер рисует страницу](LEARN_WEB_RENDERING_PIPELINE_COURSE.md) мы видели этапы: DOM →
стили → раскладка (layout) → отрисовка. Раскладка работает не с элементами, а с **боксами** (boxes).
Каждый элемент порождает ноль, один или несколько боксов, и *какие* именно — решает свойство `display`.

| Элемент | Значение `display` | Что порождает |
|---|---|---|
| `<p>` | `block` (стили браузера) | один блочный бокс |
| `<span>` | `inline` (начальное значение) | один строчный бокс, который может разрезаться на куски по строкам |
| `<li>` | `list-item` | блочный бокс + бокс маркера |
| `<head>`, `<script>` | `none` | ничего |
| элемент с `display: contents` | `contents` | ничего, но его дети участвуют в раскладке |

Обратите внимание: **начальное значение `display` — `inline`**, а не `block`. `<div>` блочный только
потому, что стили браузера пишут `div { display: block; }`. Неизвестный элемент `<my-card>` без CSS
окажется строчным — частая неожиданность при работе с пользовательскими элементами.

Дерево боксов **не совпадает** с DOM: в нём нет `head`, нет элементов с `display: none`, зато есть
боксы, которых нет в DOM, — маркеры списков, `::before`/`::after` и анонимные боксы (раздел 5).

## 2. Нормальный поток

**Нормальный поток** — это раскладка, которую получает бокс, если он не плавающий (`float`), не
вынут из потока позиционированием (`position: absolute/fixed`) и лежит внутри обычного (не flex и
не grid) контейнера. В нормальном потоке действует ровно одно из двух правил:

- **блочное форматирование** (block formatting): боксы ставятся **друг под другом** по направлению
  блоков (в горизонтальном письме — сверху вниз), каждый занимает всю доступную ширину;
  вертикальные внешние отступы соседей **схлопываются**;
- **строчное форматирование** (inline formatting): боксы ставятся **друг за другом** по направлению
  строки (для русского — слева направо) и переносятся на новую строку, когда место кончается.

Какое правило действует — решает **контейнер**, а не сам бокс: если все дети блочного контейнера
блочные, он устанавливает блочный контекст; если все строчные — строчный. Смешанный случай решают
анонимные боксы.

<details>
<summary>Блоки встают друг под другом, строки — друг за другом</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-display-flow.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  .wrap { border: 2px dashed #888; padding: 8px; max-width: 420px; }
  div.b { background: #cde; border: 1px solid #369; margin: 6px 0; }
  span { background: #fd9; border: 1px solid #c80; }
</style>
</head>
<body>
  <p>Блочные боксы: каждый на всю ширину, даже если текст короткий.</p>
  <div class="wrap">
    <div class="b">первый</div>
    <div class="b">второй</div>
  </div>
  <p>Строчные боксы: идут подряд и переносятся.</p>
  <div class="wrap">
    <span>один</span> <span>два</span> <span>три очень длинных слова</span>
    <span>четыре</span> <span>пять и ещё немного текста, чтобы перенести</span>
  </div>
</body>
</html>
```

</details>

### 2.1. Ширина блока — «всё, что дали», высота — «всё, что нужно»

В блочном контексте у бокса с `width: auto` ширина вычисляется так, чтобы
`margin-left + border + padding + width + ... + margin-right` в точности равнялось ширине
**содержащего блока** (containing block). Поэтому блок растягивается на всю ширину, и поэтому
`margin: 0 auto` центрирует блок с заданной шириной: два `auto` делят остаток поровну.

Высота с `height: auto` — наоборот, сумма содержимого. Отсюда асимметрия, которая мучает новичков:
отцентрировать по горизонтали легко, а по вертикали в нормальном потоке почти нечем — высота
родителя сама зависит от детей. Для этого придуманы flex и grid
([Flexbox](LEARN_CSS_FLEXBOX_COURSE.md), [Grid](LEARN_CSS_GRID_COURSE.md)).

## 3. Строчное форматирование и строчные боксы

Внутри строчного контекста браузер нарезает содержимое на **строчные боксы** (line boxes) —
горизонтальные полосы, в каждой из которых лежат куски строчных боксов и текста.

### 3.1. Высота строки и `line-height`

Высота строчного бокса — это не `font-size`. Каждый строчный бокс вносит в строку высоту своего
`line-height`, и строка становится достаточно высокой, чтобы вместить их все *с учётом выравнивания
по базовой линии*. Поэтому один `<span>` с крупным шрифтом раздвигает всю строку.

Важно: вертикальные `padding`, `border` и `margin` у **несамостоятельного** строчного бокса
(обычный `span`) **не влияют** на высоту строки. Фон и рамка рисуются, но наезжают на соседние строки.

<details>
<summary>Вертикальный padding у span не раздвигает строки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-display-flow.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; max-width: 420px; }
  span.pad { background: rgba(255,160,0,.5); padding: 14px 4px; border: 2px solid #c60; margin: 20px 0; }
  span.ib { display: inline-block; background: rgba(0,140,255,.4); padding: 14px 4px; border: 2px solid #06c; }
</style>
</head>
<body>
  <p>Обычный текст. Здесь <span class="pad">span с padding 14px</span> внутри абзаца:
  фон наезжает на строки выше и ниже, но строки не раздвинулись. Ещё немного текста,
  чтобы было видно соседние строки.</p>
  <p>А здесь <span class="ib">inline-block с тем же padding</span> — он участвует в высоте
  строки как единое целое, и строка стала выше. Ещё немного текста для сравнения.</p>
</body>
</html>
```

</details>

### 3.2. Базовая линия и «щель под картинкой»

По умолчанию `vertical-align: baseline`: низ буквы «х» каждого строчного бокса выравнивается по одной
**базовой линии** (baseline). Ниже базовой линии остаётся место для «хвостов» букв (у, р, д) —
**свисание** (descender). Картинка — строчный бокс, и её нижний край по умолчанию стоит на базовой
линии. Отсюда знаменитая щель в несколько пикселей под `<img>` внутри `<div>`.

Варианты лечения:

| Способ | Что делает | Когда плох |
|---|---|---|
| `img { display: block; }` | картинка перестаёт быть строчной | если она должна стоять в тексте |
| `img { vertical-align: middle; }` (или `top`/`bottom`) | картинка выравнивается иначе, щель исчезает | почти никогда — самый мягкий вариант |
| `div { line-height: 0; }` | строка схлопывается | ломает текст внутри |
| `div { font-size: 0; }` | то же | ломает текст, мешает `em` |

<details>
<summary>Щель под картинкой и её исправление</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-display-flow.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 20px/1.5 system-ui, sans-serif; margin: 16px; display: flex; gap: 24px; }
  .box { background: #f44; padding: 0; width: 120px; }
  .box i { display: inline-block; width: 120px; height: 60px; background: #4a8; }
  .fix i { vertical-align: bottom; }
  p { font-size: 13px; margin: 4px 0 0; }
</style>
</head>
<body>
  <div><div class="box"><i></i></div><p>baseline: красная щель снизу</p></div>
  <div><div class="box fix"><i></i></div><p>vertical-align: bottom</p></div>
</body>
</html>
```

</details>

Зелёный бокс здесь — `inline-block` без текста: его базовой линией считается нижний край внешнего
отступа, поэтому он ведёт себя так же, как картинка.

### 3.3. `inline-block`: снаружи строчный, внутри блочный

`display: inline-block` порождает бокс, который **снаружи** участвует в строке, как слово, а
**внутри** устанавливает свой блочный контекст. У него работают `width`, `height`, вертикальные
отступы — и они раздвигают строку. Это была главная техника сеток до flexbox, и от неё осталась
известная проблема.

### 3.4. Зазор между `inline-block`

Перевод строки и отступы между тегами в HTML — это **пробельные символы** в текстовом узле. В
строчном контексте последовательность пробелов схлопывается до **одного пробела**, и этот пробел —
полноценный символ шириной примерно 0,25 em. Поэтому четыре блока по `width: 25%` не помещаются в
одну строку: между ними три пробела.

<details>
<summary>Зазор между inline-block и способы его убрать</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-display-flow.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.4 system-ui, sans-serif; margin: 16px; max-width: 480px; }
  .row { border: 2px dashed #888; margin: 0 0 4px; }
  .row b { display: inline-block; width: 25%; background: #9cf; outline: 1px solid #036;
           text-align: center; font-weight: 400; }
  .fs0 { font-size: 0; }
  .fs0 b { font-size: 16px; }
  .flex { display: flex; }
  h2 { font-size: 14px; margin: 12px 0 4px; }
</style>
</head>
<body>
  <h2>Как есть: пробелы между тегами, последний блок уехал вниз</h2>
  <div class="row">
    <b>1</b>
    <b>2</b>
    <b>3</b>
    <b>4</b>
  </div>
  <h2>Теги вплотную, без пробелов в разметке</h2>
  <div class="row"><b>1</b><b>2</b><b>3</b><b>4</b></div>
  <h2>font-size: 0 у родителя</h2>
  <div class="row fs0">
    <b>1</b>
    <b>2</b>
    <b>3</b>
    <b>4</b>
  </div>
  <h2>Правильный ответ: display: flex у родителя</h2>
  <div class="row flex">
    <b>1</b>
    <b>2</b>
    <b>3</b>
    <b>4</b>
  </div>
</body>
</html>
```

</details>

Сравнение способов:

- **без пробелов в разметке** (или `<!-- -->` между тегами) — работает, но хрупко: любой форматтер
  кода вернёт переносы строк;
- **`font-size: 0`** у родителя — пробел становится нулевой ширины, но детям нужно восстанавливать
  размер, и `em` у детей ломается (используйте `rem`);
- **отрицательный `margin-right: -0.25em`** — угадывание ширины пробела, зависит от шрифта;
- **`display: flex`** у родителя — во flex-контейнере текстовые узлы из одних пробелов вообще не
  порождают боксов. Это и есть современный ответ: `inline-block` для сеток больше не нужен.

## 4. Замещаемые элементы

**Замещаемый элемент** (replaced element) — элемент, содержимое которого рисует не CSS, а что-то
внешнее: картинка, видео, `<iframe>`, `<canvas>`, многие элементы форм. CSS управляет только его
рамкой, а внутренность «подставляется».

Следствия:

- у замещаемых элементов есть **собственные размеры** (intrinsic dimensions) и пропорции: `<img>`
  без `width`/`height` возьмёт размер файла;
- `::before` и `::after` у `<img>` и `<input>` не работают: у них нет содержимого в смысле CSS;
- `<img>` по умолчанию `display: inline`, но, в отличие от `span`, у него работают `width`, `height`
  и вертикальные отступы — строчные замещаемые боксы ведут себя как `inline-block`;
- `object-fit` и `object-position` управляют тем, как содержимое вписывается в бокс.

Подробнее о картинках — в курсе [Медиа: изображения, видео, SVG](LEARN_HTML_MEDIA_COURSE.md).

## 5. Анонимные боксы

Спецификация требует, чтобы у блочного контейнера дети были **либо все блочные, либо все строчные**.
Что делать с разметкой, где текст лежит рядом с `<div>`?

```html
<section>
  Текст без обёртки
  <div>Блок</div>
  Ещё текст
</section>
```

Браузер оборачивает каждый кусок строчного содержимого в **анонимный блочный бокс** (anonymous block
box). Его нет в DOM, к нему нельзя обратиться селектором, он **наследует** от родителя то, что
наследуется (цвет, шрифт), а ненаследуемые свойства у него начальные (нет рамки, нет фона, нет отступов).

Обратный случай ещё интереснее: блок **внутри** строчного элемента.

```html
<span>начало <div>блок</div> конец</span>
```

Здесь `span` разрезается на две части, а блок встаёт между ними на отдельной строке. Рамка `span`
рисуется на обеих частях, но не вокруг блока. Это законный, но запутанный случай — так верстать
не стоит.

<details>
<summary>Анонимные боксы и разрезанный span</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-display-flow.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.6 system-ui, sans-serif; margin: 16px; max-width: 440px; }
  section { border: 2px solid #555; padding: 6px; color: #036; margin-bottom: 16px; }
  section div { background: #fd9; border: 1px solid #c80; }
  span { border: 2px solid #c03; background: #fee; }
  span div { background: #cfc; }
</style>
</head>
<body>
  <section>
    Текст без обёртки (анонимный блок, цвет унаследован)
    <div>настоящий div</div>
    ещё текст: снова анонимный блок
  </section>
  <div><span>начало span <div>div внутри span</div> конец span</span></div>
</body>
</html>
```

</details>

Обратите внимание: `span` с блоком внутри мы положили в `<div>`, а не в `<p>`. Внутри абзаца парсер
HTML, встретив `<div>`, **закрыл бы** `<p>` вместе с открытым `span`, и в DOM не осталось бы никакого
«разрезанного span» — только `div` после абзаца и голый текст. Это хороший повод проверять DOM в
инструментах разработчика, а не верить исходнику.

## 6. Блочный контекст форматирования (BFC)

**Блочный контекст форматирования** (block formatting context, BFC) — это изолированная область, в
которой раскладываются блоки. Внутри неё работают все правила нормального потока, но **её содержимое
не взаимодействует с тем, что снаружи**. Три практических следствия:

1. **Отступы не схлопываются через границу BFC.** Внешний отступ первого ребёнка не «вытекает»
   наружу корня BFC.
2. **Корень BFC вмещает свои плавающие элементы.** Его высота учитывает `float`-детей.
3. **Корень BFC не залезает под чужие плавающие элементы.** Он сужается и встаёт рядом с `float`.

### 6.1. Что создаёт BFC

| Что | Побочные эффекты |
|---|---|
| корневой элемент `<html>` | — |
| `display: flow-root` | **нет** — создан ровно для этого |
| `float: left/right` | бокс становится плавающим |
| `position: absolute/fixed` | бокс вынут из потока |
| `display: inline-block` | бокс становится строчным |
| `overflow` кроме `visible` и `clip` | обрезает содержимое и тени, может появиться прокрутка |
| ячейки таблиц, `display: table-cell`, `table-caption` | табличная раскладка |
| дети flex- и grid-контейнеров (flex/grid items) | создают *независимый* контекст |
| `contain: layout`, `content` или `paint` | изоляция для производительности |
| `column-count` / `column-width` (мультиколонки) | раскладка в колонки |

Исторически BFC создавали «побочным эффектом» — чаще всего `overflow: hidden`. Это работает, но
обрезает выпадающие меню и тени. `display: flow-root` (поддерживается всеми современными браузерами
с 2017–2019 годов) делает ровно одно: превращает блок в корень BFC.

<details>
<summary>Отступ ребёнка выходит из родителя — пока родитель не станет BFC</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-display-flow.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.4 system-ui, sans-serif; margin: 0; padding: 16px; background: #eee; }
  .parent { background: #9cf; margin-bottom: 16px; }
  .child { margin-top: 30px; background: #fd9; }
  .bfc { display: flow-root; }
</style>
</head>
<body>
  <div class="parent">
    <div class="child">margin-top: 30px у ребёнка ушёл наружу: голубой фон начинается ниже</div>
  </div>
  <div class="parent bfc">
    <div class="child">родитель с display: flow-root: отступ остался внутри, голубое поле сверху</div>
  </div>
</body>
</html>
```

</details>

Именно это происходит с `<body><header>`: у первого ребёнка `header` есть `h1` с внешним отступом
сверху (стили браузера: `margin-block: 0.67em`), он схлопывается через `header` и `body`, и сверху
страницы появляется «непонятная» полоса. Лечится `padding`/`border` у родителя, BFC или обнулением
отступа у `h1`.

## 7. Плавающие элементы и `clear`

`float` придуман для обтекания текстом: картинка уходит к краю, а **строчные боксы** укорачиваются и
обтекают её. Ключевая тонкость: **блочные** боксы соседей плавающий элемент *не* сдвигает — они
проходят под ним (фон и рамка соседа видны за картинкой), сдвигается только текст внутри них.

Плавающий элемент вынут из нормального потока, поэтому родитель с только плавающими детьми имеет
высоту 0 — «родитель схлопнулся». Три поколения решений:

1. **Пустой элемент с `clear: both`** в конце — работает, но мусорит разметку.
2. **Clearfix** — тот же `clear`, но через псевдоэлемент:
   ```css
   .clearfix::after { content: ""; display: table; clear: both; }
   ```
   `display: table` здесь нужен, чтобы заодно не схлопывались отступы (наследие эпохи IE).
3. **`display: flow-root`** у родителя — корень BFC вмещает плавающих детей. Это современный ответ.

`clear: left | right | both` у блока означает: «опусти мой верхний край ниже всех предшествующих
плавающих элементов указанной стороны *в этом же BFC*». Браузер добавляет над блоком **зазор**
(clearance), и это ещё один случай, когда отступы ведут себя неочевидно: `margin-top` у
очищающего блока может «исчезнуть» внутри зазора.

<details>
<summary>Float: обтекание, схлопнувшийся родитель, flow-root</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-display-flow.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 16px; max-width: 460px; }
  .card { border: 3px solid #c03; margin-bottom: 20px; }
  .pic { float: left; width: 90px; height: 90px; background: #4a8; margin: 0 10px 4px 0; }
  .note { background: rgba(0,100,255,.15); outline: 1px dashed #06c; }
  .fr { display: flow-root; }
</style>
</head>
<body>
  <div class="card">
    <div class="pic"></div>
    <div class="note">Голубой блок проходит ПОД зелёным квадратом (видна пунктирная рамка),
    а текст его обтекает.</div>
  </div>
  <div class="card">
    <div class="pic"></div>
  </div>
  <p>Выше: карточка только с плавающим ребёнком — красная рамка схлопнулась в линию.</p>
  <div class="card fr">
    <div class="pic"></div>
  </div>
  <p>Та же карточка с display: flow-root вмещает квадрат.</p>
</body>
</html>
```

</details>

### 7.1. BFC рядом с float: колонка без расчётов

Третье свойство BFC даёт старый, но полезный приём: блок-корень BFC рядом с плавающим элементом
**не проходит под ним**, а сужается до оставшегося места. Получается «картинка слева, текст справа
ровной колонкой» без вычисления ширины.

<details>
<summary>Корень BFC не залезает под float</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-display-flow.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 16px; max-width: 460px; }
  .pic { float: left; width: 80px; height: 120px; background: #4a8; margin-right: 10px; }
  .text { background: #fd9; }
  .bfc { display: flow-root; }
  .row { margin-bottom: 20px; }
</style>
</head>
<body>
  <div class="row"><div class="pic"></div>
    <div class="text">Обычный блок: текст обтекает, а когда квадрат кончается, текст
    уходит под него — колонка неровная. Добавим строк, чтобы это увидеть, и ещё немного,
    и ещё чуть-чуть текста здесь.</div></div>
  <div class="row"><div class="pic"></div>
    <div class="text bfc">Блок с display: flow-root: вся колонка встала справа от квадрата и не
    заходит под него. Добавим строк, чтобы это увидеть, и ещё немного, и ещё чуть-чуть.</div></div>
</body>
</html>
```

</details>

Для раскладки страниц `float` сегодня не используют: для этого есть flex и grid. Но для обтекания
текстом — по-прежнему только он (вместе с `shape-outside` для непрямоугольного обтекания).

## 8. Внешний и внутренний тип: `display: block flex`

Модуль CSS Display Level 3 объяснил, что `display` всегда задаёт **две вещи**:

- **внешний тип** (outer display type) — как бокс участвует в раскладке *родителя*: `block` или
  `inline` (и особый `run-in`, который браузеры почти не поддерживают);
- **внутренний тип** (inner display type) — какой контекст бокс устанавливает для *своих детей*:
  `flow`, `flow-root`, `flex`, `grid`, `table`, `ruby`.

Старые однословные значения — это сокращения:

| Однословное | Двухзначное | Смысл |
|---|---|---|
| `block` | `block flow` | блок снаружи, нормальный поток внутри |
| `inline` | `inline flow` | строчный снаружи, внутри строчное содержимое |
| `inline-block` | `inline flow-root` | строчный снаружи, свой BFC внутри |
| `flow-root` | `block flow-root` | блок снаружи, свой BFC внутри |
| `flex` | `block flex` | блок снаружи, flex внутри |
| `inline-flex` | `inline flex` | строчный снаружи, flex внутри |
| `grid` / `inline-grid` | `block grid` / `inline grid` | аналогично |
| `list-item` | `block flow list-item` | блок + маркер |

Двухзначный синтаксис поддерживается во всех современных браузерах (Firefox с 70, Safari с 15,
Chrome с 115). На практике однословные значения короче и привычнее; двухзначная запись важна как
**модель мышления**: когда вы пишете `display: flex`, вы меняете поведение элемента *для детей*, а
для родителя он остаётся блоком. Поэтому flex-контейнер по-прежнему занимает всю ширину и
схлопывает внешние отступы с соседями-блоками.

<details>
<summary>Внешний и внутренний тип по отдельности</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-display-flow.html#example-9">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 16px; }
  .c { border: 2px solid #369; padding: 4px; gap: 4px; margin: 4px 0; }
  .c i { background: #fd9; padding: 2px 8px; font-style: normal; }
  .a { display: block flex; }
  .b { display: inline flex; }
  .d { display: inline flow-root; width: 140px; }
</style>
</head>
<body>
  <p>Текст до. <span class="c a"><i>block</i><i>flex</i></span> Текст после.</p>
  <p>Текст до. <span class="c b"><i>inline</i><i>flex</i></span> Текст после.</p>
  <p>Текст до. <span class="c d">inline flow-root = inline-block</span> Текст после.</p>
</body>
</html>
```

</details>

## 9. `display: none`, `visibility: hidden`, `display: contents`

Три способа «убрать» элемент, и все разные.

| | Бокс есть? | Место занимает? | Дети видны? | В дереве доступности? | События мыши |
|---|---|---|---|---|---|
| `display: none` | нет | нет | нет, никогда | нет | нет |
| `visibility: hidden` | да | **да** | можно вернуть: `visibility: visible` у ребёнка | нет | нет |
| `opacity: 0` | да | да | нет (прозрачность умножается) | **да** | **да** |
| `display: contents` | нет (сам элемент) | его дети встают на его место | да | дети да; сам элемент — исторически терялся у кнопок и заголовков | у детей |

Детали, которые нужно знать:

- `visibility` **наследуется**, а `display` — нет. Поэтому ребёнок может «перекрыть» скрытого
  родителя `visibility: visible`, а вернуть ребёнка из-под `display: none` родителя невозможно —
  у родителя нет бокса, в котором ребёнок мог бы жить.
- `visibility: collapse` у строк и колонок таблицы убирает их, не пересчитывая ширину колонок; у
  прочих элементов означает то же, что `hidden`.
- Атрибут HTML `hidden` — это просто `display: none` из стилей браузера. Любое ваше `display: flex`
  на этом элементе его **перебьёт** (селектор класса специфичнее). Поэтому в сбросах часто пишут
  `[hidden] { display: none !important; }`.
- `display: contents` полезен, когда обёртка мешает flex/grid: её дети становятся прямыми
  участниками раскладки деда. Но у самого элемента пропадают фон, рамка, отступы. Ранние реализации
  при этом выкидывали элемент из дерева доступности — для `<button>`, `<ul>`, заголовков это было
  серьёзной ошибкой; сейчас браузеры это в основном исправили, но для интерактивных элементов
  `contents` лучше не применять.

<details>
<summary>none, hidden, opacity и contents рядом</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-display-flow.html#example-10">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.4 system-ui, sans-serif; margin: 16px; }
  .row { display: flex; gap: 6px; border: 2px dashed #888; padding: 6px; margin-bottom: 10px;
         align-items: center; }
  .row > * { background: #9cf; padding: 6px 10px; }
  .x { background: #f88 !important; }
  .none { display: none; }
  .vis { visibility: hidden; }
  .vis b { visibility: visible; background: #fd9; }
  .op { opacity: 0; }
  .cont { display: contents; }
  .cont > span { background: #cfc; padding: 6px 10px; }
  button { cursor: pointer; }
</style>
</head>
<body>
  <p>Щёлкните по пустому месту в строке с opacity: 0 — там кнопка, и она реагирует.</p>
  <div class="row">A <div class="x none">none</div> B</div>
  <div class="row">A <div class="x vis">hidden <b>а ребёнок виден</b></div> B</div>
  <div class="row">A <button class="x op" onclick="this.parentNode.lastChild.textContent=' нажато!'">opacity</button> B</div>
  <div class="row">A <div class="x cont"><span>ребёнок 1</span><span>ребёнок 2</span></div> B</div>
</body>
</html>
```

</details>

В последней строке обёртка с красным фоном исчезла, а её дети стали flex-элементами строки.

## 10. Корневой элемент и холст

Ещё одна особенность нормального потока объясняет загадку «фон body заливает всё окно, хотя body
короче»: фон корневого элемента рисуется на **холсте** (canvas) — бесконечной поверхности под
документом. А если у `html` фон не задан, браузер **переносит** (propagates) фон `body` на холст.
То же происходит с `overflow`: `overflow` у `body` переносится на окно, если у `html` он `visible`.

Сам `body` при этом остаётся обычным блоком: его высота равна высоте содержимого, и рамка вокруг
него покажет это.

<details>
<summary>Фон body переносится на холст</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-display-flow.html#example-11">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { background: #fd9; outline: 3px solid #c03; margin: 20px;
         font: 15px/1.5 system-ui, sans-serif; }
</style>
</head>
<body>
  <p>Жёлтым залито всё окно, хотя body (красная рамка) занимает только эти строки.</p>
  <p>Задайте html { background: white } — и жёлтый останется только внутри рамки.</p>
</body>
</html>
```

</details>

## Итог

- Элементы порождают **боксы**; какие — решает `display`. Начальное значение — `inline`.
- **Нормальный поток**: в блочном контексте боксы встают друг под другом, в строчном — друг за
  другом, переносясь по **строчным боксам**.
- Вертикальные `padding`/`margin` у обычного `span` не раздвигают строку; у `inline-block` и
  замещаемых — раздвигают. Щель под картинкой — это место под базовой линией.
- Зазор между `inline-block` — это схлопнутый пробел из разметки. Лучшее лечение — `display: flex`.
- **Анонимные боксы** выравнивают «смешанное» содержимое; селектором их не достать.
- **BFC** изолирует: не выпускает отступы, вмещает `float`, не залезает под чужие `float`.
  Создавайте его через `display: flow-root`, а не побочным `overflow: hidden`.
- `display` = **внешний** тип (для родителя) + **внутренний** (для детей).
- `display: none` убирает бокс, `visibility: hidden` оставляет место, `display: contents` убирает
  только сам бокс элемента.

## Проверьте себя

1. Почему пользовательский элемент `<user-card>` без CSS не растягивается на всю ширину?
2. Пять `inline-block` по `width: 20%` не помещаются в строку. Назовите причину и три способа
   исправить; какой из них не зависит от шрифта?
3. Перечислите три следствия создания BFC. Почему `overflow: hidden` — плохой способ его создать?
4. Чем отличается поведение текста и фона соседнего блока рядом с `float`?
5. Как записать `inline-block` в двухзначном синтаксисе и что означает каждое слово?
6. Почему ребёнок может стать видимым внутри `visibility: hidden`, но не внутри `display: none`?

Дальше: [Свойства и значения: как читать любое свойство](LEARN_CSS_PROPERTIES_COURSE.md).
