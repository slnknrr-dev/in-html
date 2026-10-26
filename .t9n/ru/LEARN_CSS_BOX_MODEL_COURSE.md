# Блочная модель и схлопывание отступов

> Курс 7 из программы. Для тех, кто знает каскад и наследование
> ([Наследование](LEARN_CSS_INHERITANCE_COURSE.md)) и хочет понимать, откуда берутся размеры и
> «лишние» промежутки. Главная загадка курса — зазор над `<header>`, которого вы не писали.

**Что вы будете понимать после курса**

- из чего состоит **коробка** (box): содержимое, внутренний отступ, рамка, внешний отступ;
- что меняет `box-sizing` и почему `border-box` стал стандартом де-факто;
- как работает **схлопывание внешних отступов** (margin collapsing) во всех трёх случаях: соседи,
  родитель и ребёнок, пустой блок;
- почему у `<body><header><h1>` появляется зазор сверху и шесть способов его убрать;
- что такое **контекст блочного форматирования** (block formatting context, BFC) и `display: flow-root`;
- как ведут себя отрицательные отступы и почему процентный `padding-top` считается от **ширины**.

---

## 1. Четыре области коробки

Каждый элемент в раскладке порождает коробку (обычно одну) из четырёх вложенных прямоугольников:

| Область | Англ. термин | Задаётся | Фон рисуется? |
|---|---|---|---|
| содержимое | content box | `width`, `height` | да |
| внутренний отступ | padding box | `padding` | да |
| рамка | border box | `border` | да, под рамкой |
| внешний отступ | margin box | `margin` | **нет**, всегда прозрачен |

Внешний отступ — это расстояние **между** коробками, а не часть элемента. На нём не срабатывает
клик, его не закрашивает фон, его не видно в `outline`. Сам `outline` вообще не занимает места: он
рисуется поверх, не сдвигая соседей.

<details>
<summary>Четыре области одной коробки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-box-model.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px sans-serif; background: repeating-linear-gradient(45deg, #fff 0 6px, #eee 6px 12px); }
  .box { width: 200px; padding: 20px; border: 10px solid rgba(200, 30, 30, .6);
         margin: 30px; background: #9fd8ff; background-clip: border-box; }
  .content { background: #fff3; outline: 1px dashed #000; }
</style>
</head>
<body>
  <div class="box"><div class="content">содержимое 200px</div></div>
  <p>Голубое — padding, под полупрозрачной рамкой тоже голубое (фон до края рамки),
     полосатое вокруг — margin: прозрачен, виден фон body.</p>
</body>
</html>
```

</details>

### 1.1. Ширина `auto` и ширина в пикселях

У блочного элемента в нормальном потоке `width: auto` значит «заполнить доступную ширину»:
`margin-left + border-left + padding-left + width + padding-right + border-right + margin-right`
равно ширине **содержащего блока** (containing block). Если `width` задан явно, а сумма не
сходится, браузер подгоняет `margin-right` (в направлении `ltr`) — так и работает
`margin: 0 auto` для центрирования: оба `auto` делят остаток поровну.

`height: auto` — наоборот, «по содержимому». Поэтому центрировать по вертикали через `margin: auto`
в обычном потоке нельзя (в flex и grid — можно).

## 2. `box-sizing`

По умолчанию `box-sizing: content-box`: `width` — ширина **только содержимого**. Видимая ширина —
`width + padding + border`. Отсюда вечная ошибка: `width: 100%; padding: 16px` вылезает за родителя.

`box-sizing: border-box`: `width` включает `padding` и `border`, содержимое ужимается.

<details>
<summary>content-box против border-box</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-box-model.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px sans-serif; }
  .wrap { width: 300px; border: 2px solid #333; padding: 4px; }
  .item { width: 100%; padding: 16px; border: 4px solid crimson; margin: 4px 0; background: #ffe9a8; }
  .cb { box-sizing: content-box; } /* 300 + 32 + 8 = 340px: вылезает */
  .bb { box-sizing: border-box; }  /* ровно 300px */
</style>
</head>
<body>
  <div class="wrap">
    <div class="item cb">content-box — вылез</div>
    <div class="item bb">border-box — точно по ширине</div>
  </div>
</body>
</html>
```

</details>

Распространённый сброс, который позволяет компонентам вернуть себе `content-box`:

```css
html { box-sizing: border-box; }
*, *::before, *::after { box-sizing: inherit; }
```

`box-sizing` не наследуется, поэтому `inherit` здесь — сознательный выбор: компонент может
поставить `content-box` на корне, и он распространится на его потомков.

Историческая справка: в quirks mode старых Internet Explorer ширина считалась именно как
`border-box`. Стандарт выбрал `content-box`; позже `box-sizing` вернул выбор авторам. Поля форм
(`input`, `select`, `button`) в стилях браузеров до сих пор частично `border-box`.

## 3. Схлопывание внешних отступов

Главное правило, которое объясняет большую часть «необъяснимых» промежутков:

> **Вертикальные** внешние отступы блоков в **нормальном потоке**, которые **соприкасаются** (между
> ними нет рамки, внутреннего отступа, строчного содержимого или зазора `clear`), сливаются в один.

Как считается итог:

| Отступы | Результат | Пример |
|---|---|---|
| все положительные | наибольший | 20 и 30 → 30 |
| все отрицательные | наименьший (самый отрицательный) | −10 и −25 → −25 |
| разных знаков | наибольший положительный + наименьший отрицательный | 30 и −10 → 20 |

Почему так задумано? Типографика. Абзацы имеют `margin: 1em 0`. Между двумя абзацами должен быть
один `1em`, а не два. Заголовок с `margin-bottom: 0.67em` перед абзацем с `1em` — промежуток `1em`.
Схлопывание делает так, что каждый элемент описывает «сколько мне нужно места вокруг», а не
«сколько прибавить к соседу».

Горизонтальные отступы не схлопываются никогда. Схлопывание бывает только в **блочном потоке** —
у строчных, flex- и grid-элементов, у плавающих и абсолютно позиционированных его нет.

### 3.1. Случай 1: соседние блоки

<details>
<summary>Соседи: 30px и 20px дают 30px</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-box-model.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px sans-serif; }
  .a { margin-bottom: 30px; background: #9fd8ff; }
  .b { margin-top: 20px;    background: #ffd36e; }
  .c { margin-top: -10px;   background: #b9f0b0; }
  div { padding: 8px; }
</style>
</head>
<body>
  <div class="a">margin-bottom: 30px</div>
  <div class="b">margin-top: 20px — между нами 30, а не 50</div>
  <div class="c">margin-top: −10px — с 0 у соседа: наезжаем на 10px</div>
</body>
</html>
```

</details>

### 3.2. Случай 2: родитель и первый (последний) ребёнок

Если у родителя **нет** верхней рамки, верхнего `padding`, строчного содержимого перед ребёнком
и родитель не создаёт BFC, то верхний отступ первого ребёнка **соприкасается** с верхним отступом
родителя — и они схлопываются. Итоговый отступ оказывается **снаружи** родителя: ребёнок «выталкивает»
родителя вниз, а фон родителя начинается ниже, чем вы ожидали.

Для нижнего края то же самое, плюс условие: у родителя `height: auto` (и `min-height` не мешает).

### 3.3. Загадка `<body><header>`

```html
<body>
  <header style="background: navy; color: white"><h1>Сайт</h1></header>
</body>
```

Ожидание: тёмная полоса прижата к верху окна (ну, с 8px у `body`). Реальность: над тёмной полосой
белый зазор больше 20px. Разбор по стилям браузера:

1. `h1` — `font-size: 2em` (32px) и `margin-block: 0.67em` → 0.67 × 32 = **21.44px**.
2. У `header` нет рамки и `padding` → отступ `h1` соприкасается с отступом `header` (0).
3. У `body` тоже нет рамки и `padding` → цепочка продолжается к отступу `body` (8px).
4. Корневой `html` создаёт BFC, дальше схлопывание не идёт.
5. Итог: один общий отступ max(21.44, 0, 8) = **21.44px** над `body`, `header` и `h1` одновременно.
   Фон `header` начинается под ним. Снизу то же самое.

<details>
<summary>Зазор над header: отступ h1 выпал наружу</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-box-model.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  /* Стили браузера не трогаем: body 8px, h1 0.67em */
  header { background: navy; color: white; }
  main { font: 14px sans-serif; }
</style>
</head>
<body>
  <header><h1>Сайт</h1></header>
  <main>Белая полоса над синей шапкой — это отступ h1, схлопнутый через header и body.</main>
</body>
</html>
```

</details>

Способы убрать зазор — и чем они отличаются:

| Способ | Что делает | Побочный эффект |
|---|---|---|
| `h1 { margin-top: 0 }` | убирает сам отступ | надо помнить про каждый первый элемент |
| `header { padding-top: 1px }` или любой `padding` | разрывает соприкосновение | меняет размер |
| `header { border-top: 1px solid transparent }` | то же | меняет размер на 1px |
| `header { display: flow-root }` | новый BFC: отступы детей остаются внутри | нет; лучший вариант |
| `header { overflow: hidden }` (или `auto`) | тоже BFC | обрезает тени, выпадающие меню |
| `header { display: flex; flex-direction: column }` | у flex-элементов схлопывания нет | другая модель раскладки |
| `body { margin: 0 }` | убирает 8px, но **не** 21.44px | зазор остаётся |

<details>
<summary>Четыре способа удержать отступ внутри шапки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-box-model.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 13px sans-serif; margin: 0; }
  header { background: navy; color: white; margin-bottom: 10px; }
  h1 { font-size: 20px; margin: 16px 0; }
  .pad  { padding: 0.1px 12px; }
  .bord { border-top: 1px solid navy; }
  .bfc  { display: flow-root; }
  .flex { display: flex; flex-direction: column; }
</style>
</head>
<body>
  <header><h1>без защиты: отступ снаружи</h1></header>
  <header class="pad"><h1>padding</h1></header>
  <header class="bord"><h1>border</h1></header>
  <header class="bfc"><h1>display: flow-root</h1></header>
  <header class="flex"><h1>flex</h1></header>
</body>
</html>
```

</details>

### 3.4. Случай 3: пустой блок

Если у блока нет содержимого, `padding`, рамки, `height`/`min-height` больше нуля, его **собственные**
верхний и нижний отступы соприкасаются и схлопываются. А результат может схлопнуться ещё и с соседями
— сквозь пустой блок.

<details>
<summary>Пустой блок: его отступы растворяются в соседних</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-box-model.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px sans-serif; }
  .p { margin: 20px 0; padding: 8px; background: #ffd36e; }
  .empty { margin: 40px 0; }          /* 40 сверху и 40 снизу */
  .empty.border { border-top: 1px solid crimson; } /* рамка разрывает схлопывание */
</style>
</head>
<body>
  <div class="p">Абзац 1</div>
  <div class="empty"></div>
  <div class="p">Абзац 2: промежуток 40px, а не 20+40+40+20</div>
  <div class="empty border"></div>
  <div class="p">Абзац 3: с рамкой у пустого блока — 40 + 1 + 40</div>
</body>
</html>
```

</details>

Так ведут себя, например, пустой `<p></p>` или `<div>` с одним абсолютно позиционированным ребёнком.

## 4. Что останавливает схлопывание

Собираем всё в одну таблицу:

| Условие | Почему |
|---|---|
| `padding` или `border` между отступами | отступы перестают соприкасаться |
| строчное содержимое (текст) между ними | то же |
| родитель создаёт **BFC** | отступы детей не выходят за границу BFC |
| элементы flex- или grid-контейнера | у них свои правила, схлопывания нет |
| `float`, `position: absolute/fixed` | вышли из нормального потока |
| `display: inline-block` | создаёт BFC внутри и сам строчный |
| `clear` с зазором (clearance) | зазор разделяет отступы |
| `height`/`min-height` (для нижнего края с ребёнком и для пустого блока) | край определяется высотой |

### 4.1. BFC и `display: flow-root`

**Контекст блочного форматирования** — независимая область раскладки: внутри него блоки идут
сверху вниз, отступы схлопываются только между собой, плавающие элементы не выходят наружу
(блок растягивается, чтобы их вместить), а снаружи плавающие элементы его не обтекают.

BFC создают: корень `html`, `float`, `position: absolute/fixed`, `display: inline-block`,
`table-cell`, `flow-root`, `overflow` не `visible`/`clip`, элементы flex и grid, `contain: layout`,
мультиколонки.

`display: flow-root` появился специально, чтобы создавать BFC **без побочных эффектов**. До него
пользовались `overflow: hidden` (обрезает) или хаком clearfix с `::after { content: ""; display:
table; clear: both }`.

<details>
<summary>BFC вмещает плавающий элемент</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-box-model.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px sans-serif; }
  .box { border: 3px solid #333; margin-bottom: 30px; background: #eef; }
  .f { float: left; width: 90px; height: 90px; background: crimson; margin: 6px; }
  .root { display: flow-root; }
</style>
</head>
<body>
  <div class="box"><div class="f"></div>Обычный блок: float выпал наружу.</div>
  <div class="box root"><div class="f"></div>flow-root: блок вместил float.</div>
</body>
</html>
```

</details>

## 5. Отрицательные отступы

Отрицательный `margin` — легальный инструмент, а не хак:

- `margin-top: -20px` сдвигает элемент вверх, и он наезжает на предыдущего;
- `margin-bottom: -20px` подтягивает **следующий** элемент на себя, сам элемент не двигается;
- `margin-left/right` отрицательные у блока с `width: auto` **увеличивают** его ширину — так делают
  «выход за поля» (full-bleed) в статье с ограниченной колонкой.

<details>
<summary>Отрицательные отступы: сдвиг и расширение</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-box-model.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px sans-serif; }
  .col { width: 300px; margin: 0 auto; padding: 0 20px; background: #f4f4f4; }
  .bleed { margin: 0 -20px; padding: 10px 20px; background: #9fd8ff; } /* шире колонки */
  .up { margin-top: -18px; background: #ffd36ecc; padding: 6px; }
</style>
</head>
<body>
  <div class="col">
    <p>Колонка 300px с полями 20px.</p>
    <div class="bleed">margin: 0 −20px — блок стал на 40px шире и лёг на поля.</div>
    <p>Обычный абзац.</p>
    <div class="up">margin-top: −18px — наехал на абзац выше.</div>
  </div>
</body>
</html>
```

</details>

## 6. Проценты в `padding` и `margin` — от ширины

Неочевидное правило: процентные `padding` и `margin` **по всем четырём сторонам** считаются от
**ширины** (точнее, от размера в строчном направлении, inline size) содержащего блока. Даже
`padding-top: 50%`.

Почему? Высота родителя часто зависит от детей. Если бы `padding-top` считался от высоты родителя,
получился бы цикл: высота ребёнка зависит от высоты родителя, а та — от ребёнка. Ширина же известна
сверху вниз.

Отсюда старый приём **блока с пропорциями**: `padding-top: 56.25%` = 9/16 ширины → коробка 16:9 при
любой ширине. Сегодня для этого есть `aspect-ratio: 16 / 9`, но приём всё ещё встречается в коде.

<details>
<summary>Пропорции: старый приём и aspect-ratio</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-box-model.html#example-9">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px sans-serif; }
  .wrap { width: 60%; border: 2px solid #333; padding: 6px; resize: horizontal; overflow: auto; }
  .old { height: 0; padding-top: 56.25%; position: relative; background: #ffd36e; }
  .old span { position: absolute; inset: 0; display: grid; place-items: center; }
  .new { aspect-ratio: 16 / 9; background: #9fd8ff; display: grid; place-items: center; margin-top: 6px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="old"><span>padding-top: 56.25%</span></div>
    <div class="new">aspect-ratio: 16 / 9</div>
  </div>
  <p>Потяните правый нижний угол рамки — обе коробки сохраняют 16:9.</p>
</body>
</html>
```

</details>

## 7. Строчные элементы и блочная модель

У строчных (`display: inline`) коробок:

- `width` и `height` игнорируются;
- горизонтальные `padding`, `border`, `margin` раздвигают текст;
- вертикальные `padding` и `border` **рисуются**, но **не влияют** на высоту строки, а вертикальный
  `margin` игнорируется полностью.

Если нужна полноценная коробка внутри строки — `display: inline-block`.

## 8. Логические свойства

`margin-top` привязан к физической стороне. `margin-block-start` — к началу **блочного** направления,
которое зависит от `writing-mode`. Стили браузеров уже давно пишут логически: `p { margin-block: 1em }`,
`ul { padding-inline-start: 40px }`. В вертикальном японском тексте эти отступы окажутся справа и
слева, и это правильно. Пишите `margin-inline`, `padding-block`, `inset-inline-start` — и интерфейс
без правок перевернётся для арабского (`dir="rtl"`).

## Итог

- Коробка: содержимое → `padding` → `border` → `margin`. Фон рисуется до края рамки, отступ прозрачен.
- `box-sizing: border-box` включает `padding` и `border` в `width`; ставьте его глобально.
- Вертикальные отступы в блочном потоке, которые соприкасаются, сливаются: соседи, родитель с
  первым/последним ребёнком, пустой блок.
- Зазор над `<header>` — отступ `h1`, вытолкнутый через `header` и `body`. Лечится `display:
  flow-root`, `padding`, `border` или flex.
- BFC изолирует отступы и вмещает float; `display: flow-root` создаёт его без побочных эффектов.
- Процентные `padding`/`margin` считаются от ширины содержащего блока — даже вертикальные.

## Проверьте себя

1. Чему равен промежуток между блоками с `margin-bottom: 25px` и `margin-top: -10px`? А при `-30px`
   и `-10px`?
2. Почему `body { margin: 0 }` не убирает зазор над шапкой с `h1` внутри?
3. Почему у flex-контейнера отступы детей не выходят наружу?
4. Блок шириной 400px внутри родителя шириной 800px и высотой 100px получает `padding-top: 10%`.
   Сколько это пикселей?
5. Пустой `div` с `margin: 30px 0` стоит между абзацами с `margin: 1em 0` (16px). Какой промежуток?

Дальше: [Нормальный поток и `display`](LEARN_CSS_DISPLAY_FLOW_COURSE.md).
