# Flexbox

> Курс 13 из программы. Для тех, кто знает [нормальный поток и `display`](LEARN_CSS_DISPLAY_FLOW_COURSE.md)
> и [блочную модель](LEARN_CSS_BOX_MODEL_COURSE.md). Мы не будем запоминать свойства по картинкам:
> мы разберём **алгоритм**, по которому браузер раздаёт место, и посчитаем его руками.

**Что вы будете понимать после курса**

- что такое **flex-контейнер**, **flex-элементы**, **главная** и **поперечная** оси;
- как `flex-grow`, `flex-shrink` и `flex-basis` превращаются в пиксели — с числами;
- почему элемент «не сжимается» и что такое ловушка `min-width: auto`;
- чем `justify-*` отличается от `align-*` и почему `justify-items` во флексе не работает;
- `gap`, перенос строк, `align-content`;
- почему `order` опасен для доступности;
- трюки с `margin: auto`.

---

## 1. Контейнер, элементы, оси

`display: flex` делает элемент **flex-контейнером** (flex container), а его детей в потоке —
**flex-элементами** (flex items). Снаружи контейнер ведёт себя как блок (`flex`) или как строчный
блок (`inline-flex`); внутри действует своя раскладка — **flex layout**.

Что меняется для детей:

- каждый ребёнок становится блокоподобным: `display: inline` у `<span>` превращается в `block`
  (blockification); текст напрямую в контейнере заворачивается в анонимный flex-элемент;
- `float` и `clear` у элементов игнорируются;
- `vertical-align` не действует;
- **отступы между соседями не схлопываются** (margin collapsing во флексе нет);
- абсолютно позиционированные дети не участвуют в раскладке.

**Оси** задаёт `flex-direction`:

| `flex-direction` | Главная ось (main axis) | Поперечная ось (cross axis) |
|---|---|---|
| `row` (по умолчанию) | по строке текста: слева направо в `ltr` | сверху вниз |
| `row-reverse` | по строке, но в обратную сторону | сверху вниз |
| `column` | сверху вниз | по строке |
| `column-reverse` | снизу вверх | по строке |

Оси логические: в `dir="rtl"` `row` идёт справа налево, в вертикальном письме (`writing-mode`)
поворачивается. Поэтому в спецификации нет слов «горизонтально» и «вертикально» — только
**main** и **cross**, **start** и **end**. И размеры: **главный размер** (main size — ширина при
`row`) и **поперечный** (cross size).

<details>
<summary>Оси при разных flex-direction</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-flexbox.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px/1.3 system-ui, sans-serif; padding: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .box { display: flex; border: 2px solid #1a73e8; padding: 4px; gap: 4px; min-height: 120px; }
  .box > div { background: #ffe08a; border: 1px solid #c90; padding: 6px 10px; }
  h4 { margin: 0 0 4px; font-family: monospace; }
</style>
</head>
<body>
  <section><h4>row</h4><div class="box" style="flex-direction: row"><div>1</div><div>2</div><div>3</div></div></section>
  <section><h4>row-reverse</h4><div class="box" style="flex-direction: row-reverse"><div>1</div><div>2</div><div>3</div></div></section>
  <section><h4>column</h4><div class="box" style="flex-direction: column"><div>1</div><div>2</div><div>3</div></div></section>
  <section><h4>row в dir=rtl</h4><div class="box" dir="rtl"><div>1</div><div>2</div><div>3</div></div></section>
</body>
</html>
```

</details>

Заметьте в колонке `column`: элементы растянулись на всю ширину. Это `align-items: stretch` —
значение по умолчанию на поперечной оси. А в `row` они растянулись по высоте.

## 2. Алгоритм размеров: basis, grow, shrink

### 2.1. Три величины

| Свойство | Начальное значение | Смысл |
|---|---|---|
| `flex-basis` | `auto` | **исходный главный размер** до раздачи места |
| `flex-grow` | `0` | доля **свободного** места, которую элемент забирает |
| `flex-shrink` | `1` | готовность отдавать место при **нехватке** |

`flex-basis: auto` значит «возьми `width` (при `row`)»; если и он `auto` — то `content`:
размер по содержимому (max-content). Значение `0` — «начни с нуля».

Сокращение `flex` — главный способ задавать всё сразу, и у него хитрые умолчания:

| Запись | Раскрывается в | Поведение |
|---|---|---|
| (не задано) | `0 1 auto` | по содержимому, не растёт, сжимается |
| `flex: auto` | `1 1 auto` | от содержимого, растёт и сжимается |
| `flex: none` | `0 0 auto` | жёсткий размер по содержимому |
| `flex: 1` | `1 1 0%` | **от нуля**: делит всё место поровну |
| `flex: 2` | `2 1 0%` | от нуля, вдвое больше доли |
| `flex: 200px` | `1 1 200px` | от 200px, растёт и сжимается |

Обратите внимание: `flex: 1` ставит basis `0%`, а не `auto`. В этом вся разница между «равные
колонки» и «колонки пропорциональны содержимому».

### 2.2. Шаг алгоритма: свободное место

Упрощённо (для одной строки, `row`):

1. Для каждого элемента определить **гипотетический главный размер** — `flex-basis`, ограниченный
   `min-width`/`max-width`.
2. **Свободное место** = внутренняя ширина контейнера − сумма basis − сумма внешних отступов
   (`margin`) − промежутки (`gap`).
3. Если место положительно — раздать по `flex-grow`; если отрицательно — отнять по `flex-shrink`.
4. Если элемент упёрся в `min`/`max` — заморозить его на границе и повторить раздачу для остальных.

Важно: при `box-sizing: content-box` basis — это ширина содержимого, а `padding` и `border`
прибавляются сверху и в раздаче не участвуют.

### 2.3. Пример: рост

Контейнер 600px, три элемента без отступов и рамок:

| | basis | grow |
|---|---|---|
| A | 100px | 1 |
| B | 200px | 2 |
| C | 100px | 1 |

Свободное место: 600 − (100 + 200 + 100) = **200px**. Сумма grow = 4, одна доля = 50px.

- A: 100 + 1 × 50 = **150px**
- B: 200 + 2 × 50 = **300px**
- C: 100 + 1 × 50 = **150px**

Здесь итог случайно вышел 1:2:1. Поменяйте basis на 300/100/100 при тех же grow 1/2/1:
свободно 100px, доля 25px, итог 325, 150, 125 — B «растёт быстрее», но остаётся уже A. grow делит
**свободное место**, а не весь контейнер. Чтобы итоговые ширины были ровно пропорциональны grow,
нужен basis 0: `flex: 1`, `flex: 2`, `flex: 1` — тогда свободно всё и делится 1:2:1.

Особый случай: если **сумма grow меньше 1**, раздаётся только эта доля свободного места.
Два элемента с `flex-grow: .25` из 200px свободных получат по 50px, а 100px останутся пустыми.

<details>
<summary>flex-grow делит свободное место, а не контейнер</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-flexbox.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px/1.3 system-ui, sans-serif; padding: 16px; }
  .row { display: flex; width: 600px; border: 2px solid #1a73e8; margin: 8px 0; }
  .row > div { box-sizing: border-box; border: 1px solid #c90; background: #ffe08a; padding: 4px; overflow: hidden; white-space: nowrap; }
  .a > div { flex-grow: 1; } .a > :nth-child(2) { flex-grow: 2; }
  .a > :nth-child(1), .a > :nth-child(3) { flex-basis: 100px; } .a > :nth-child(2) { flex-basis: 200px; }
  .b > div { flex: 1; } .b > :nth-child(2) { flex: 2; }
  .c > div { flex-basis: 100px; flex-grow: .25; }
</style>
</head>
<body>
  <p>Ширина контейнера 600px. Значения ширины выводит скрипт.</p>
  <div class="row a"><div>A: 100 + 1 доля</div><div>B: 200 + 2 доли</div><div>C: 100 + 1 доля</div></div>
  <div class="row b"><div>flex: 1</div><div>flex: 2</div><div>flex: 1</div></div>
  <div class="row c"><div>grow .25</div><div>grow .25</div></div>
  <script>
    for (const d of document.querySelectorAll('.row > div'))
      d.textContent += ' = ' + Math.round(d.getBoundingClientRect().width) + 'px';
  </script>
</body>
</html>
```

</details>

### 2.4. Пример: сжатие

Сжатие устроено иначе: место отнимается пропорционально не `flex-shrink`, а **взвешенному
коэффициенту** (scaled flex shrink factor) = `flex-shrink × flex-basis`. Логика: крупный элемент
должен отдавать больше пикселей, чем мелкий, иначе мелкие схлопнулись бы первыми.

Контейнер 400px, все `flex-shrink: 1`:

| | basis | shrink × basis | доля | отнять | итог |
|---|---|---|---|---|---|
| A | 200px | 200 | 200/600 | 66,67 | **133,33px** |
| B | 300px | 300 | 300/600 | 100 | **200px** |
| C | 100px | 100 | 100/600 | 33,33 | **66,67px** |

Нехватка: 600 − 400 = 200px. Каждый потерял одну треть basis — пропорции сохранились.
Если у C поставить `flex-shrink: 0`, он останется 100px, а те же 200px нехватки
поделят A и B в отношении 200:300 — 80 и 120: итог 120px и 180px.

### 2.5. Ловушка `min-width: auto`

Почему длинное слово, `<pre>` или картинка «распирают» контейнер, хотя `flex-shrink: 1`?

Для flex-элементов начальное `min-width: auto` (при `row`; при `column` — `min-height`) означает
не ноль, а **автоматический минимум** (automatic minimum size): примерно **min-content** —
ширину самого длинного неразрывного куска содержимого. Сжимать ниже алгоритм не станет. Длинный
URL, таблица, `white-space: nowrap` или вложенный flex с текстом — и элемент вылезает за контейнер.

Лечение — разрешить сжатие ниже содержимого:

```css
.item { min-width: 0; }          /* главное средство */
.item { overflow: hidden; }       /* тоже обнуляет автоматический минимум (любой overflow кроме visible) */
.text { overflow-wrap: anywhere; } /* или дать тексту переноситься */
```

Классика жанра — `text-overflow: ellipsis` в flex-элементе: без `min-width: 0` на **каждом**
flex-уровне многоточие не появится.

<details>
<summary>min-width: auto распирает контейнер</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-flexbox.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px/1.3 system-ui, sans-serif; padding: 16px; }
  .row { display: flex; width: 320px; border: 2px solid #1a73e8; margin: 12px 0; gap: 4px; }
  .icon { flex: none; width: 40px; background: #b8e0ff; }
  .text { background: #ffe08a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bad .text { overflow: visible; }
  .fix .text { min-width: 0; }
</style>
</head>
<body>
  <p>Сверху: min-width: auto, текст вылезает за синюю рамку. Снизу: overflow: hidden обнуляет минимум, и работает многоточие.</p>
  <div class="row bad"><div class="icon"></div><div class="text">очень-длинное-имя-файла-без-пробелов-report-final-v2.pdf</div></div>
  <div class="row fix"><div class="icon"></div><div class="text">очень-длинное-имя-файла-без-пробелов-report-final-v2.pdf</div></div>
</body>
</html>
```

</details>

### 2.6. `flex-basis` против `width`

При `row` `flex-basis` (если не `auto`) **побеждает** `width`. Но `min-width` и `max-width`
побеждают оба. Рекомендация: во flex-элементах задавать размер через `flex`, а `width` оставить
для случаев, когда элемент может оказаться и вне флекса.

## 3. Выравнивание: justify и align

Правило запоминания: **justify — по главной оси, align — по поперечной.**

| Свойство | Ось | На чём задаётся | Что двигает |
|---|---|---|---|
| `justify-content` | главная | контейнер | элементы целиком, распределяя свободное место |
| `align-items` | поперечная | контейнер | каждый элемент внутри своей строки |
| `align-self` | поперечная | элемент | один элемент, перекрывая `align-items` |
| `align-content` | поперечная | контейнер | **строки** целиком (только при переносе) |

Почему нет `justify-items` и `justify-self`: на главной оси элементы стоят вплотную друг за
другом, отдельно двигать один нельзя — место распределяет `justify-content` для всех. (В Grid
эти свойства есть, потому что там у каждого элемента своя ячейка.)

Значения `justify-content`: `flex-start`, `flex-end`, `center`, `space-between` (крайние
к краям, промежутки равны), `space-around` (по половине промежутка у краёв), `space-evenly`
(все промежутки равны, включая края). Логические `start`/`end` относятся к направлению письма,
`flex-start`/`flex-end` — к направлению оси (с учётом `-reverse`).

Значения `align-items`: `stretch` (по умолчанию; работает, только если поперечный размер
элемента `auto`), `flex-start`, `flex-end`, `center`, `baseline` (по базовой линии первой строки
текста — выравнивает подписи разного размера).

Если свободного места нет, `center` у переполненного элемента выдвигает его **за оба края** —
левую часть уже не прокрутить. Для этого есть ключевое слово `safe`: `justify-content: safe center`
(поддержка распространяется).

<details>
<summary>justify-content и align-items</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-flexbox.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 13px/1.3 system-ui, sans-serif; padding: 16px; }
  .box { display: flex; border: 2px solid #1a73e8; height: 70px; margin: 4px 0 12px; }
  .box > div { background: #ffe08a; border: 1px solid #c90; padding: 4px 10px; }
  .box > div:nth-child(2) { font-size: 22px; }
  code { font-weight: 700; }
</style>
</head>
<body>
  <code>space-between + stretch</code><div class="box" style="justify-content: space-between"><div>1</div><div>2</div><div>3</div></div>
  <code>space-around + center</code><div class="box" style="justify-content: space-around; align-items: center"><div>1</div><div>2</div><div>3</div></div>
  <code>space-evenly + baseline</code><div class="box" style="justify-content: space-evenly; align-items: baseline"><div>1</div><div>2</div><div>3</div></div>
  <code>center + flex-end</code><div class="box" style="justify-content: center; align-items: flex-end"><div>1</div><div>2</div><div>3</div></div>
</body>
</html>
```

</details>

## 4. `gap` и перенос

### 4.1. `gap`

`gap` (`row-gap`, `column-gap`) задаёт промежутки **только между** элементами — не у краёв.
Раньше вместо него писали `margin` у элементов и отрицательный `margin` у контейнера, чтобы
скомпенсировать крайние. `gap` вычитается из свободного места до раздачи `flex-grow`. Во
флексе он поддерживается всеми браузерами с 2021 года (последним был Safari 14.1).

### 4.2. `flex-wrap`

По умолчанию `nowrap`: все элементы в одну строку, даже если вылезают. `flex-wrap: wrap`
разрешает переносить на новые **flex-строки** (flex lines). Каждая строка раскладывается
**независимо**: `flex-grow` делит свободное место своей строки. Поэтому элементы последней
строки растягиваются шире остальных — флекс не умеет выравнивать колонки между строками.
Если нужна сетка с общими колонками — это задача [Grid](LEARN_CSS_GRID_COURSE.md).

Сокращение: `flex-flow: row wrap`.

`align-content` распределяет **строки** по поперечной оси, если у контейнера есть лишняя высота.
С одной строкой (`nowrap`) оно не действует.

<details>
<summary>wrap: каждая строка сама по себе</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-flexbox.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px/1.3 system-ui, sans-serif; padding: 16px; }
  .box { display: flex; flex-wrap: wrap; gap: 8px; border: 2px solid #1a73e8; padding: 8px; width: 420px; }
  .box > div { flex: 1 1 120px; background: #ffe08a; border: 1px solid #c90; padding: 8px; }
  .tall { height: 220px; align-content: space-between; margin-top: 16px; }
</style>
</head>
<body>
  <p>flex: 1 1 120px. В первой строке три элемента, в последней — два, и они шире.</p>
  <div class="box"><div>1</div><div>2</div><div>3</div><div>4</div><div>5</div></div>
  <p>align-content: space-between раздвигает строки по высоте контейнера.</p>
  <div class="box tall"><div>1</div><div>2</div><div>3</div><div>4</div><div>5</div></div>
</body>
</html>
```

</details>

## 5. `order` и доступность

`order` (по умолчанию `0`) меняет **визуальный** порядок: элементы сортируются по возрастанию
`order`, при равенстве — по порядку в DOM. То же делают `row-reverse` и `column-reverse`.

Но порядок **чтения экранным чтецом и обхода клавишей Tab** остаётся порядком DOM. Если
визуально кнопка «Купить» стоит первой, а в DOM последней, пользователь клавиатуры увидит фокус,
прыгающий по экрану в непредсказуемом порядке. Это нарушение критерия WCAG «Значимая
последовательность».

Правило: `order` и `-reverse` — только для перестановок, которые **не меняют смысл** (декор,
картинка слева или справа на разных экранах). Если порядок важен — меняйте DOM.

<details>
<summary>order ломает порядок Tab</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-flexbox.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.3 system-ui, sans-serif; padding: 16px; }
  .box { display: flex; gap: 8px; }
  button { font: inherit; padding: 8px 14px; }
  button:focus-visible { outline: 3px solid crimson; outline-offset: 2px; }
  .box > :nth-child(1) { order: 3; }
  .box > :nth-child(3) { order: -1; }
</style>
</head>
<body>
  <p>Щёлкните в пустое место и нажимайте Tab: фокус идёт в порядке DOM (1, 2, 3), а не в порядке на экране.</p>
  <div class="box"><button>1-й в DOM</button><button>2-й в DOM</button><button>3-й в DOM</button></div>
</body>
</html>
```

</details>

## 6. Трюки с `margin: auto`

Во флексе `auto`-отступы забирают **свободное место раньше** `justify-content` (после `flex-grow`:
если есть растущие элементы, места для `auto` не останется). Это даёт выравнивание отдельных
элементов на главной оси, которого нет среди свойств:

```css
.nav .logout { margin-left: auto; }   /* прижать последний пункт вправо */
.center      { margin: auto; }         /* идеальное центрирование по обеим осям */
.card .footer { margin-top: auto; }    /* при column — подвал карточки к низу */
```

В отличие от `justify-content: center`, `margin: auto` при переполнении не выталкивает элемент
за начальный край — переполнение уходит в конец, где его можно прокрутить.

<details>
<summary>margin: auto: меню, центр, подвал карточки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-flexbox.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.3 system-ui, sans-serif; padding: 16px; }
  nav { display: flex; gap: 12px; border: 2px solid #1a73e8; padding: 8px; }
  nav .push { margin-left: auto; }
  .stage { display: flex; height: 120px; border: 2px dashed #999; margin: 12px 0; }
  .stage > div { margin: auto; background: #ffe08a; padding: 8px 14px; }
  .cards { display: flex; gap: 12px; }
  .card { display: flex; flex-direction: column; flex: 1; border: 2px solid #ccc; padding: 8px; }
  .card footer { margin-top: auto; background: #b8e0ff; padding: 4px; }
</style>
</head>
<body>
  <nav><a href="#">Главная</a><a href="#">Статьи</a><a class="push" href="#">Выйти</a></nav>
  <div class="stage"><div>по центру</div></div>
  <div class="cards">
    <div class="card"><p>Короткий текст.</p><footer>подвал внизу</footer></div>
    <div class="card"><p>Длинный текст, который занимает несколько строк и делает карточку выше соседки.</p><footer>подвал внизу</footer></div>
  </div>
</body>
</html>
```

</details>

Последний пример попутно показывает, почему карточки равной высоты — это просто: `align-items:
stretch` в ряду `.cards` уже делает их одинаковыми, а `margin-top: auto` дотягивает подвалы.

## 7. Сводная шпаргалка решений

| Задача | Решение |
|---|---|
| Равные колонки | `flex: 1` у всех |
| Колонки по содержимому, остаток — одной | `flex: 1` у одной, остальным ничего |
| Фиксированная боковая + резиновая | `.side { flex: 0 0 240px } .main { flex: 1; min-width: 0 }` |
| Многоточие в элементе | `min-width: 0` на всех flex-уровнях + `overflow: hidden` |
| Прижать один пункт вправо | `margin-left: auto` |
| Центр по обеим осям | контейнер `display: flex`, ребёнок `margin: auto` (или `place-items: center` в Grid) |
| Плитки с переносом и общими колонками | Grid, не Flexbox |

## Итог

- Flexbox — одномерная раскладка вдоль **главной** оси; поперечная — для выравнивания.
- Начальное `flex: 0 1 auto`; `flex: 1` — это `1 1 0%`, старт от нуля.
- `flex-grow` делит **свободное** место; `flex-shrink` отнимает пропорционально `shrink × basis`.
- `min-width: auto` у flex-элемента — это min-content; лечится `min-width: 0` или `overflow`.
- `justify-*` — главная ось, `align-*` — поперечная; `align-content` — только для нескольких строк.
- Каждая flex-строка при переносе живёт отдельно.
- `order` и `-reverse` меняют вид, но не порядок Tab и чтения.
- `margin: auto` забирает свободное место и выравнивает отдельные элементы.

## Проверьте себя

1. Контейнер 500px, basis 100/100/100, grow 0/1/3. Какие получатся ширины?
2. Контейнер 300px, basis 200 и 200, shrink 1 и 3. Сколько отнимут у каждого?
3. Почему `flex: 1` и `flex: auto` у элементов с разным количеством текста дают разные ширины?
4. В строке иконка и `<span>` с `text-overflow: ellipsis`, но многоточия нет. Что добавить и куда?
5. Почему во флексе нет `justify-self`, но работает `margin-left: auto`?
6. Чем опасно `flex-direction: row-reverse` для навигационного меню?

Дальше: [Grid](LEARN_CSS_GRID_COURSE.md).
