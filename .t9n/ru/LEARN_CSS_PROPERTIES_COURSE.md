# Свойства и значения: как читать любое свойство

> Курс 9 из программы. Для тех, кто прошёл каскад, наследование и блочную модель и хочет перестать
> заучивать свойства по одному. В CSS их больше пятисот, но каждое описано по одной и той же схеме.
> Научившись читать эту схему, вы сможете разобраться в любом свойстве по спецификации или MDN за
> минуту — и предсказать его поведение до того, как напишете код.

**Что вы будете понимать после курса**

- что значит каждая строка **таблицы определения свойства** (property definition table) в спецификации;
- почему `width: 50%` и `padding: 50%` считаются от одного и того же, а `height: 50%` часто не работает;
- что такое **вычисленное значение** (computed value) и почему именно оно наследуется;
- как читать **нотацию синтаксиса значений** (value definition syntax): `[ ]`, `|`, `||`, `&&`, `?`, `*`, `#`, `{a,b}`;
- как работают **сокращённые свойства** (shorthands) и почему `font` и `background` молча сбрасывают ваши настройки;
- что такое **логические свойства** (logical properties) и почему `margin-inline-start` лучше `margin-left`;
- что такое **общие ключевые слова** (CSS-wide keywords) и чем `initial` отличается от `revert`.

---

## 1. Таблица свойства

Откройте любое свойство в спецификации CSS — увидите таблицу. Вот как она выглядит для `padding-top`
(CSS Box Model Level 3):

| Строка | Значение для `padding-top` |
|---|---|
| Name | `padding-top` |
| Value | `<length-percentage [0,∞]>` |
| Initial | `0` |
| Applies to | все элементы, кроме внутренних табличных (кроме ячеек), `ruby base container` и `ruby annotation container` |
| Inherited | no |
| Percentages | относительно **ширины** (logical width) содержащего блока |
| Computed value | указанное ключевое слово или абсолютная длина / процент |
| Canonical order | per grammar |
| Animation type | by computed value type |

Каждая строка отвечает на конкретный вопрос, который иначе пришлось бы выяснять опытным путём. Пройдём
их по порядку.

### 1.1. Value — что можно написать

Грамматика допустимых значений. Если написанное ей не соответствует, объявление **недействительно**
(invalid) и браузер его **целиком отбрасывает** при разборе — как будто строки нет. Это основа приёма
«запасное значение» (fallback):

```css
.box {
  background: #333;                    /* поймут все */
  background: color-mix(in oklch, #333, blue 20%); /* старый браузер отбросит эту строку */
}
```

Правило каскада простое: побеждает последнее *действительное* объявление. Недействительное в каскаде
вообще не участвует. Синтаксис грамматики разберём в разделе 3.

### 1.2. Initial — начальное значение

Значение, которое свойство имеет, если каскад ничего не дал **и** свойство не наследуется (или у
корня). Начальное значение задаёт **спецификация**, а не стили браузера. Знать разницу обязательно:

| Свойство | Начальное значение (спецификация) | Что видно у `<div>` (стили браузера) |
|---|---|---|
| `display` | `inline` | `block` |
| `margin` у `body` | `0` | `8px` |
| `font-weight` у `h1` | `normal` (`400`) | `bold` |
| `color` | `CanvasText` (зависит от браузера) | — |

`display: initial` у `<div>` даст `inline`, а не `block`. Это частая ловушка, о ней ещё в разделе 6.

### 1.3. Applies to — к чему применяется

Свойство можно задать любому элементу, и оно **вычислится** для любого элемента. Но *действовать*
оно будет только там, где указано в «Applies to». `width` не действует на несамостоятельные строчные
боксы (`span`), `vertical-align` — на блоки, `gap` — на обычные блочные контейнеры.

Важная деталь: свойство, которое к элементу «не применяется», всё равно **наследуется** его детьми,
если наследуемое. `text-align` применяется к блочным контейнерам, но поставить его на `span`
бесполезно не из-за наследования, а потому, что внутри `span` нет строк, которые нужно выравнивать.

### 1.4. Inherited — наследуется ли

Если `yes`, то при отсутствии объявления в каскаде элемент получает **вычисленное значение
родителя**. Подробности — в курсе [Наследование и значения по умолчанию](LEARN_CSS_INHERITANCE_COURSE.md).
Здесь запомните эмпирическое правило: наследуется то, что относится к **тексту** (шрифт, цвет,
межстрочный интервал, `text-align`, `visibility`, `cursor`), и не наследуется то, что относится к
**боксу** (размеры, отступы, рамки, фон, `display`, `position`).

### 1.5. Percentages — от чего считаются проценты

Эта строка закрывает вопрос, который иначе запоминают годами:

| Свойство | Проценты относительно |
|---|---|
| `width`, `margin-left/right`, `padding-left/right` | ширины содержащего блока |
| `margin-top/bottom`, `padding-top/bottom` | **тоже ширины** содержащего блока (в горизонтальном письме) |
| `height` | высоты содержащего блока; если она зависит от содержимого — `%` ведёт себя как `auto` |
| `top`/`bottom` | высоты содержащего блока |
| `font-size` | `font-size` родителя |
| `line-height` | `font-size` самого элемента |
| `background-position` | (размер области − размер картинки) |
| `transform: translate()` | размера **самого** элемента (рамочного бокса, border box) |
| `border-radius` | размера рамочного бокса по соответствующей оси |

Вертикальный `padding` в процентах от ширины — не баг, а расчёт: иначе возник бы цикл (высота
родителя зависит от детей, а отступ детей — от высоты родителя). На этом построен старый приём
**пропорционального бокса**: `padding-top: 56.25%` даёт высоту 16:9 от ширины. Сегодня то же самое
делает `aspect-ratio: 16 / 9`.

<details>
<summary>Проценты: вертикальный padding считается от ширины</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-properties.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 16px; }
  .outer { width: 400px; height: 100px; background: #eee; outline: 2px solid #888; margin-bottom: 30px; }
  .inner { padding-top: 25%; background: #9cf; }
  .h { height: 50%; background: #fd9; }
  .ratio { width: 200px; padding-top: 56.25%; background: #4a8; position: relative; }
  .modern { width: 200px; aspect-ratio: 16 / 9; background: #4a8; }
</style>
</head>
<body>
  <p>Родитель 400×100. padding-top: 25% — это 100px (от ширины!), а не 25px:</p>
  <div class="outer"><div class="inner"></div></div>
  <p>Родитель с высотой auto: height: 50% у ребёнка не действует (жёлтого почти не видно):</p>
  <div style="outline:2px solid #888"><div class="h">height: 50%</div></div>
  <p>Пропорция 16:9 старым способом (padding-top) и новым (aspect-ratio):</p>
  <div style="width:200px"><div class="ratio" style="width:auto"></div></div>
  <br>
  <div class="modern"></div>
</body>
</html>
```

</details>

### 1.6. Computed value — вычисленное значение

То, во что значение превращается после каскада, но **до раскладки**: относительные единицы,
которые можно разрешить без раскладки, разрешаются (`2em` → `32px`), ключевые слова часто
сохраняются (`auto` остаётся `auto`), проценты, которым нужна раскладка, остаются процентами.

Это строка с самым большим практическим смыслом: **наследуется вычисленное значение**. Сравните:

```css
.parent { font-size: 20px; line-height: 1.5; }   /* вычисленное: число 1.5 */
.parent { font-size: 20px; line-height: 150%; }  /* вычисленное: 30px */
```

С числом каждый потомок умножает 1.5 на **свой** `font-size`. С процентом потомки наследуют готовые
`30px` — и заголовок с `font-size: 40px` получит строки по 30px, буквы налезут друг на друга. Поэтому
`line-height` задают **числом без единиц**.

<details>
<summary>line-height: число против процента</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-properties.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font-family: system-ui, sans-serif; margin: 16px; display: flex; gap: 20px; }
  .a, .b { font-size: 14px; width: 220px; border: 1px solid #888; padding: 6px; }
  .a { line-height: 1.3; }
  .b { line-height: 130%; }
  h2 { font-size: 32px; margin: 0; background: #fd9; }
</style>
</head>
<body>
  <div class="a"><h2>Заголовок в две строки</h2>line-height: 1.3 — строки заголовка нормальные</div>
  <div class="b"><h2>Заголовок в две строки</h2>line-height: 130% — унаследованы 18.2px, строки слиплись</div>
</body>
</html>
```

</details>

Как значения проходят путь «указанное → вычисленное → используемое → фактическое», подробно
разбирается в курсе [Единицы и вычисление значений](LEARN_CSS_UNITS_VALUES_COURSE.md).

### 1.7. Animation type — как анимируется

Как браузер строит промежуточные значения при `transition` и `@keyframes`:

- **by computed value type** — интерполяция по типу: длины, цвета, числа плавно меняются;
- **discrete** — переключение скачком на середине (50%) анимации; так ведут себя `display`
  (с оговорками `transition-behavior: allow-discrete`), `font-style`, `visibility` — особый случай:
  при переходе с `hidden` на `visible` значение `visible` действует на всём промежутке;
- **not animatable** — свойство не анимируется вовсе (например, `animation-name`).

Отсюда вечный вопрос «почему не анимируется `height: auto`»: `auto` — ключевое слово, промежуточных
значений между `0` и `auto` нет. Решения — анимировать `grid-template-rows: 0fr → 1fr`, `max-height`,
или новую функцию `interpolate-size: allow-keywords` / `calc-size()` там, где она поддерживается.
Подробнее — в курсе [Переходы и анимации](LEARN_CSS_TRANSITIONS_ANIMATIONS_COURSE.md).

## 2. Типы значений

В грамматике значения в угловых скобках — это **типы** (data types), определённые в CSS Values and Units:

| Тип | Примеры | Заметки |
|---|---|---|
| `<length>` | `10px`, `2em`, `0` | `0` можно писать без единицы — только для длин |
| `<percentage>` | `50%` | от чего — смотри строку Percentages |
| `<length-percentage>` | `10px` или `50%` или `calc(50% - 10px)` | |
| `<number>` | `1.5`, `0`, `-3` | без единицы |
| `<integer>` | `3` | `z-index`, `order` |
| `<color>` | `red`, `#f00`, `rgb(255 0 0)`, `oklch(...)` | |
| `<image>` | `url(a.png)`, `linear-gradient(...)` | градиент — это изображение, а не цвет! |
| `<string>` | `"текст"` | `content`, `quotes` |
| `<custom-ident>` | `slide-in` | имена анимаций, grid-линий |
| `<time>`, `<angle>`, `<resolution>` | `200ms`, `45deg`, `2dppx` | |

Пометка `[0,∞]` после типа (`<length [0,∞]>`) означает допустимый диапазон: отрицательный `padding`
недействителен, а отрицательный `margin` — пожалуйста.

Почему градиент — изображение, важно на практике: `background-color: linear-gradient(...)`
**недействительно** и будет отброшено целиком. Градиент пишут в `background-image` (или в
сокращение `background`).

## 3. Нотация синтаксиса значений

Строка Value записана на маленьком языке. Его стоит выучить один раз:

| Запись | Смысл | Пример |
|---|---|---|
| `a b` | оба, строго в этом порядке | `<length> <length>` |
| `a && b` | оба, в любом порядке | |
| `a \|\| b` | хотя бы одно, в любом порядке | `border: <line-width> \|\| <line-style> \|\| <color>` |
| `a \| b` | ровно одно | `visible \| hidden \| clip \| scroll \| auto` |
| `[ ... ]` | группировка | |
| `?` | ноль или один раз | |
| `*` | ноль и более | |
| `+` | один и более | |
| `{2,4}` | от 2 до 4 раз | `margin: <length-percentage>{1,4}` |
| `#` | один и более, **через запятую** | `transition: <single-transition>#` |
| `!` | группа обязательна, даже если все её части необязательны | |

Приоритет: сопоставление по месту (пробел) сильнее `&&`, `&&` сильнее `||`, `||` сильнее `|`.

Пример — грамматика `border` из спецификации:

```
<line-width> || <line-style> || <color>
```

Читается: «от одного до трёх компонентов — ширина, стиль, цвет — в любом порядке». Значит,
`border: red solid 2px` так же правильно, как `border: 2px solid red`. Порядок, который пишут все, —
просто привычка.

А вот `box-shadow`:

```
none | <shadow>#
<shadow> = <color>? && [<length>{2} <length [0,∞]>? <length>?] && inset?
```

Отсюда сразу видно: теней может быть несколько через запятую (`#`); цвет и `inset` могут стоять в
начале или в конце (`&&`); длин от двух до четырёх, они идут подряд, и третья (размытие) не может
быть отрицательной.

## 4. Сокращённые свойства

**Сокращение** (shorthand) — свойство, которое задаёт сразу несколько **полных** (longhand) свойств.
`margin` задаёт четыре, `border` — двенадцать, `font` — около пятнадцати.

### 4.1. Главное правило: сокращение задаёт **все** свои подсвойства

Всё, что вы не указали в сокращении, получает **начальное значение**. Не «остаётся как было», а
именно сбрасывается. Это и есть ловушка.

```css
.title { font-weight: 700; font-style: italic; line-height: 1.2; }
.title { font: 24px Georgia, serif; }
/* итог: font-weight: normal; font-style: normal; line-height: normal — всё сброшено */
```

`font` сбрасывает `font-style`, `font-variant`, `font-weight`, `font-stretch`, `font-size`,
`line-height`, `font-family`, а также — хоть их в нём и нельзя указать — `font-size-adjust`,
`font-kerning`, `font-variant-*` подсвойства, `font-feature-settings` и другие.

<details>
<summary>Ловушка font: сокращение стирает жирность и межстрочный интервал</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-properties.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { margin: 16px; font-family: system-ui, sans-serif; }
  p { width: 260px; background: #eef; border: 1px solid #99c; padding: 4px; }
  .base { font-weight: 700; font-style: italic; line-height: 2; }
  .trap { font: 16px Georgia, serif; }
  .ok { font-family: Georgia, serif; font-size: 16px; }
</style>
</head>
<body>
  <p class="base">Базовый стиль: жирный курсив, line-height: 2, две строки текста.</p>
  <p class="base trap">base + font: 16px Georgia — всё жирное, курсив и интервал пропали.</p>
  <p class="base ok">base + полные свойства — жирный курсив и интервал на месте.</p>
</body>
</html>
```

</details>

То же с `background`: `background: url(bg.png)` сбрасывает `background-color` в `transparent`,
`background-size` в `auto`, `background-repeat` в `repeat` и так далее.

```css
.card { background-color: #fff; }
.card.promo { background: url(stripe.png) no-repeat; }
/* у .promo фон больше не белый: background-color сброшен в transparent */
```

### 4.2. Порядок: сначала сокращение, потом уточнение

Сокращение задаёт базу, полные свойства **после него** её уточняют:

```css
.btn {
  border: 1px solid #ccc;
  border-bottom-color: #999;   /* работает: идёт после сокращения */
}
```

Наоборот — уточнение до сокращения — уточнение будет стёрто, если у объявлений одинаковая
специфичность и сокращение идёт позже.

### 4.3. Правило «по часовой стрелке» для 1–4 значений

`margin`, `padding`, `border-width`, `border-style`, `border-color`, `inset`:

| Значения | Как раскладываются |
|---|---|
| `a` | все четыре стороны = a |
| `a b` | верх/низ = a, лево/право = b |
| `a b c` | верх = a, лево/право = b, низ = c |
| `a b c d` | верх, право, низ, лево — по часовой стрелке |

У `border-radius` — свой порядок по углам: левый верхний, правый верхний, правый нижний, левый
нижний; а через `/` — отдельно горизонтальные и вертикальные радиусы.

### 4.4. Неоднозначность внутри сокращения

Когда одинаковые типы стоят рядом, порядок становится значащим. В `font` обязательно: `font-size`
и `font-family` есть, `font-family` последний, `line-height` — сразу после размера через `/`:

```css
font: italic 700 16px/1.5 system-ui, sans-serif;
```

В `background` два `<length-percentage>` подряд — это `background-position`, а размер, если есть,
идёт после `/`: `background: url(a.png) center / cover no-repeat`. В `transition` и `animation`
первое время — это длительность, второе — задержка.

### 4.5. Сокращения и пользовательские свойства

Если в сокращении есть `var()`, браузер не может разобрать его заранее. Подсвойства получают
**значение в ожидании подстановки** (pending-substitution value), и если после подстановки значение
окажется недействительным, все подсвойства станут… не предыдущими, а `unset`-значениями. Подробнее — в
курсе [Пользовательские свойства и темы](LEARN_CSS_CUSTOM_PROPERTIES_COURSE.md).

## 5. Логические свойства

`margin-left` описывает **физическую** сторону. Но в арабском тексте (`dir="rtl"`) «начало строки» —
справа, а в вертикальном японском (`writing-mode: vertical-rl`) строки идут сверху вниз. Модуль
CSS Logical Properties вводит стороны относительно **потока**:

- **inline** — ось строки (направление, в котором идут буквы);
- **block** — ось блоков (направление, в котором идут абзацы);
- **start / end** — начало и конец по оси.

| Физическое (ltr, горизонтальное письмо) | Логическое |
|---|---|
| `margin-left` | `margin-inline-start` |
| `margin-right` | `margin-inline-end` |
| `margin-top` | `margin-block-start` |
| `padding-left` + `padding-right` | `padding-inline` |
| `width` | `inline-size` |
| `height` | `block-size` |
| `top`, `right`, `bottom`, `left` | `inset-block-start`, `inset-inline-end`, … |
| `border-top-left-radius` | `border-start-start-radius` |
| `text-align: left` | `text-align: start` (начальное значение `text-align` — уже `start`) |
| `float: left` | `float: inline-start` |

Стили браузера сами давно логические: у `p` в спецификации HTML написано `margin-block: 1em`, у
`ul` — `padding-inline-start: 40px`. Поэтому в `dir="rtl"` маркеры списка сами уходят вправо.

Сокращения `margin-inline: auto` (центрирование по оси строки) и `padding-block: 1rem` (только
верх и низ) удобны и без всякого RTL: короче и точнее, чем `margin: 0 auto`, который заодно
обнуляет вертикальные отступы.

<details>
<summary>Логические и физические отступы при смене направления</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-properties.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.4 system-ui, sans-serif; margin: 16px; }
  .card { border: 2px solid #369; margin-bottom: 10px; width: 300px; background: #eef; }
  .phys { border-left: 8px solid #c03; padding-left: 40px; }
  .logi { border-inline-start: 8px solid #2a2; padding-inline-start: 40px; }
  .v { writing-mode: vertical-rl; height: 140px; width: auto; }
</style>
</head>
<body>
  <div class="card phys">ltr, физические: полоса слева</div>
  <div class="card logi">ltr, логические: полоса в начале строки</div>
  <div class="card phys" dir="rtl">rtl, физические: полоса всё равно слева — неправильно</div>
  <div class="card logi" dir="rtl">rtl, логические: полоса справа, в начале строки</div>
  <div class="card logi v">вертикальное письмо: начало строки сверху</div>
</body>
</html>
```

</details>

Правило каскада для пар «физическое / логическое»: они задают **одно и то же** вычисленное значение,
и побеждает то, что объявлено позже (с учётом специфичности). `margin-left: 0` после
`margin-inline-start: 20px` в ltr отменит отступ.

## 6. Общие ключевые слова

Любое свойство принимает пять **общих ключевых слов** (CSS-wide keywords). Они не перечислены в
строке Value — они разрешены всегда:

| Ключевое слово | Результат |
|---|---|
| `initial` | начальное значение из спецификации |
| `inherit` | вычисленное значение родителя (даже для ненаследуемых) |
| `unset` | для наследуемых — `inherit`, для ненаследуемых — `initial` |
| `revert` | откат к значению из **предыдущего источника каскада**: обычно к стилям браузера |
| `revert-layer` | откат к значению из предыдущего **слоя каскада** (`@layer`) |

`initial` против `revert` — важное различие. Хотите вернуть `<div>` нормальное поведение после
`display: none` в чужом CSS? `display: initial` даст `inline` — это неправильно. `display: revert`
вернёт `block` из стилей браузера.

Свойство `all` — сокращение для **всех** свойств, кроме `direction`, `unicode-bidi` и
пользовательских. `all: unset` превращает элемент в «чистый лист» — так сбрасывают стили кнопки,
чтобы сделать из неё что-то своё (но не забудьте вернуть `cursor` и видимый фокус).

<details>
<summary>initial, unset и revert на кнопке и div</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-properties.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.4 system-ui, sans-serif; margin: 16px; color: #036; }
  div { background: #fd9; margin: 4px 0; }
  .ini { display: initial; }
  .rev { display: revert; }
  button { margin: 4px; }
  .b1 { all: unset; }
  .b2 { all: revert; }
  .b3 { all: unset; cursor: pointer; padding: 6px 12px; background: #36c; color: #fff; border-radius: 6px; }
  .b3:focus-visible { outline: 2px solid #f80; outline-offset: 2px; }
</style>
</head>
<body>
  <div class="ini">div с display: initial — стал строчным,</div> <div class="ini">как span</div>
  <div class="rev">div с display: revert — снова блок</div>
  <p>Нажмите Tab, чтобы увидеть фокус третьей кнопки.</p>
  <button>обычная</button>
  <button class="b1">all: unset</button>
  <button class="b2">all: revert</button>
  <button class="b3">unset + свои стили</button>
</body>
</html>
```

</details>

Кнопка с `all: unset` унаследовала тёмно-синий цвет текста от `body` (свойство `color`
наследуется), но потеряла рамку, фон и отступы.

## 7. Как разобраться в незнакомом свойстве: алгоритм

Допустим, вы встретили `text-underline-offset`. Вместо экспериментов — пять вопросов к таблице:

1. **Value**: `auto | <length> | <percentage>` — значит, можно `0.2em`.
2. **Initial**: `auto` — по умолчанию решает браузер.
3. **Applies to**: все элементы — но действует только там, где есть подчёркивание.
4. **Inherited**: yes — достаточно задать на `body`, и все ссылки получат его. Значит, `em`
   наследуется уже вычисленным?.. Смотрим следующую строку.
5. **Computed value**: «указанное ключевое слово или длина или процент» — процент **остаётся
   процентом** и пересчитывается от шрифта каждого потомка. Длина в `em` превращается в пиксели
   и наследуется готовой. Вывод: для единообразия у ссылок с разным размером шрифта выгоднее
   `%` или задавать `em` прямо на `a`.

Эти пять вопросов — и есть «чтение свойства». Через месяц такой практики спецификация читается
быстрее, чем статья в блоге.

<details>
<summary>text-underline-offset: em наследуется готовым, процент пересчитывается</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-properties.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.8 system-ui, sans-serif; margin: 16px; }
  .em { text-underline-offset: 0.3em; }
  .pc { text-underline-offset: 30%; }
  big { font-size: 40px; }
  a { text-decoration-thickness: 2px; }
</style>
</head>
<body>
  <p class="em">em на родителе: <a href="#">мелкая</a> и <big><a href="#">крупная</a></big> — отступ одинаковый (4.8px)</p>
  <p class="pc">% на родителе: <a href="#">мелкая</a> и <big><a href="#">крупная</a></big> — отступ растёт со шрифтом</p>
</body>
</html>
```

</details>

## Итог

- У каждого свойства есть таблица: **Value, Initial, Applies to, Inherited, Percentages, Computed
  value, Animation type**. Она отвечает на все вопросы о поведении свойства.
- Недействительное объявление отбрасывается целиком — на этом строятся запасные значения.
- **Начальное значение** задаёт спецификация, а не стили браузера: `display: initial` — это `inline`.
- Вертикальные `padding`/`margin` в процентах считаются от **ширины**.
- Наследуется **вычисленное** значение — поэтому `line-height` пишут числом.
- Нотация: пробел — по порядку, `&&` — все в любом порядке, `||` — хотя бы одно, `|` — одно, `#` —
  список через запятую.
- **Сокращение сбрасывает всё, что в нём не указано**. Уточняйте полными свойствами *после* сокращения.
- **Логические свойства** привязаны к потоку текста, а не к сторонам экрана.
- `revert` возвращает стили браузера, `initial` — значение из спецификации.

## Проверьте себя

1. Почему `background-color: linear-gradient(red, blue)` ничего не делает и не ломает предыдущее
   объявление?
2. У родителя ширина 600px и высота 200px. Чему равен `margin-top: 10%` у ребёнка?
3. Что случится с `font-weight: 700`, если ниже в том же правиле написать `font: 1rem serif`?
4. Прочитайте грамматику `<color>? && <length>{2,3}` и скажите, какие из записей верны:
   `red 1px 2px`, `1px red 2px`, `1px 2px 3px red`.
5. Чем `display: initial` отличается от `display: revert` для `<li>`?
6. Каким логическим свойством заменить `margin: 0 auto`, чтобы не трогать вертикальные отступы?

Дальше: [Единицы и вычисление значений](LEARN_CSS_UNITS_VALUES_COURSE.md).
