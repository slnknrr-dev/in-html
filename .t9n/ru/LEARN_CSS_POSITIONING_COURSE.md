# Позиционирование, `z-index` и контекст наложения

> Курс 15 из программы. Для тех, кто понимает нормальный поток и блочную модель. Здесь мы выводим
> элементы из потока, двигаем их относительно разных «опорных» прямоугольников и разбираемся, почему
> `z-index: 9999` иногда проигрывает `z-index: 1`.

**Что вы будете понимать после курса**

- пять значений `position` и что каждое делает с потоком;
- что такое **содержащий блок** (containing block) и как он выбирается для каждого случая — включая
  то, почему `transform` у предка ломает `position: fixed`;
- как работают `inset`, `top/right/bottom/left` и автоматические размеры абсолютного элемента;
- что такое **контекст наложения** (stacking context), что его создаёт и в каком порядке рисуются слои;
- почему `position: sticky` «не работает» в 90 % жалоб и как это диагностировать.

---

## 1. Пять значений `position`

| Значение | Остаётся в потоке? | Смещается относительно | Создаёт контекст наложения |
|---|---|---|---|
| `static` (по умолчанию) | да | не смещается, `top` и `z-index` игнорируются | нет |
| `relative` | да, место сохраняется | своего обычного положения | только при `z-index` ≠ `auto` |
| `absolute` | **нет** | содержащего блока (ближайший позиционированный предок) | только при `z-index` ≠ `auto` |
| `fixed` | **нет** | окна просмотра (viewport) — обычно | всегда |
| `sticky` | да | ведёт себя как `relative`, пока не «прилипнет» к краю прокручиваемого предка | всегда |

**Позиционированным** (positioned) называют элемент с любым `position`, кроме `static`. Это слово
понадобится постоянно: от него зависит, кто станет содержащим блоком для `absolute`.

### 1.1. `relative`: сдвиг без последствий

`position: relative; top: 10px` сдвигает **отрисовку** элемента на 10px вниз, но в потоке он
занимает прежнее место: соседи не двигаются, а сдвинутый элемент может налезть на них. Это смещение
похоже на `transform: translate`, только старше и влияет на позиционирование потомков.

Чаще всего `relative` пишут **без смещений** — просто чтобы сделать элемент содержащим блоком для
абсолютных детей и разрешить ему `z-index`.

<details>
<summary>relative: место в потоке остаётся</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-positioning.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; margin: 16px; }
  .box { width: 220px; padding: 10px; margin-bottom: 6px; background: #dbeafe; border: 1px solid #1d4ed8; }
  .moved { position: relative; top: 20px; left: 40px; background: #fecaca; border-color: #b91c1c; }
</style>
</head>
<body>
  <div class="box">Первый</div>
  <div class="box moved">Сдвинут: top 20px, left 40px</div>
  <div class="box">Третий не сдвинулся: место второго сохранено</div>
</body>
</html>
```

</details>

### 1.2. `absolute`: вне потока

Абсолютный элемент **удаляется из потока**: родитель его «не видит» при расчёте своей высоты, соседи
занимают его место. Он позиционируется в своём содержащем блоке, а его `display` **блокофицируется**
(`inline` → `block`). Поля абсолютных элементов не схлопываются.

### 1.3. `fixed`: привязка к окну

Как `absolute`, но содержащий блок — окно просмотра. При прокрутке элемент остаётся на месте. При
печати `fixed`-элемент повторяется на каждой странице.

## 2. Содержащий блок

**Содержащий блок** — прямоугольник, от которого считаются проценты размеров и смещения
`top/left/…`. Правила его выбора (CSS 2.1 §10.1 и CSS Position):

| `position` элемента | Содержащий блок |
|---|---|
| `static`, `relative`, `sticky` | **область содержимого** (content box) ближайшего предка-блока |
| `absolute` | **область внутренних отступов** (padding box) ближайшего предка с `position` ≠ `static`; если такого нет — **начальный содержащий блок** (initial containing block, прямоугольник размером с окно в начале документа) |
| `fixed` | окно просмотра — **если только** у какого-то предка нет `transform`, `filter` и т. п. (ниже) |

Обратите внимание на **padding box**: `top: 0; left: 0` ставит абсолютный элемент к внутреннему краю
рамки родителя, а не к краю его содержимого. Внутренние отступы родителя игнорируются.

### 2.1. Кто ещё становится содержащим блоком

Содержащим блоком для `absolute` **и для `fixed`** становится также предок, у которого есть:

- `transform` или `translate`/`rotate`/`scale`, отличные от `none`, или `perspective`;
- `filter` или `backdrop-filter`, отличный от `none`;
- `contain: layout`, `contain: paint`, `contain: strict` или `contain: content`;
- `container-type` со значением, отличным от `normal` (контейнерные запросы);
- `will-change`, перечисляющий одно из этих свойств.

Именно поэтому «модальное окно с `position: fixed` вдруг прокручивается вместе со страницей»: где-то
сверху у обёртки есть `transform: translateZ(0)` (старый трюк для GPU-слоя), анимация через
`transform` или `filter: blur()`. Модалка становится привязанной к этой обёртке, а не к окну.

Лечение: выносить модальные окна в конец `body` (или использовать `<dialog>` и **верхний слой**, top
layer — он вне любой иерархии, см. [Интерфейс](LEARN_JAVASCRIPT_UI_COURSE.md)).

<details>
<summary>transform у предка ломает position: fixed</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-positioning.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; margin: 16px; height: 1500px; }
  .wrap { margin-top: 140px; padding: 16px; height: 300px; border: 2px dashed #6d28d9; }
  .t { transform: translateX(0); }
  .fixed { position: fixed; top: 10px; right: 10px; padding: 8px 12px; color: white; }
  .ok .fixed { background: #15803d; }
  .t .fixed { background: #b91c1c; top: 50px; }
</style>
</head>
<body>
  <p>Прокрутите страницу. Зелёная плашка остаётся у края окна. Красная — внутри рамки с transform: она
  привязана к рамке и уезжает вместе с ней.</p>
  <div class="wrap ok"><div class="fixed">fixed, обычный предок</div></div>
  <div class="wrap t"><div class="fixed">fixed, предок с transform</div></div>
</body>
</html>
```

</details>

## 3. Смещения и `inset`

`top`, `right`, `bottom`, `left` задают расстояние от соответствующего края содержащего блока до края
**внешних полей** (margin box) элемента. `inset` — сокращение для всех четырёх в порядке как у
`margin`: `inset: 0` = `top: 0; right: 0; bottom: 0; left: 0`. Есть логические варианты:
`inset-inline-start`, `inset-block`, …

### 3.1. Размеры абсолютного элемента

Для абсолютного элемента действует уравнение по каждой оси:

```text
left + margin-left + border + padding + width + padding + border + margin-right + right = ширина содержащего блока
```

Отсюда несколько стандартных приёмов:

| Объявление | Результат |
|---|---|
| только `top: 0; left: 0` | ширина «сжата по содержимому» (shrink-to-fit) |
| `left: 0; right: 0` без `width` | элемент растягивается на всю ширину |
| `inset: 0` без размеров | закрывает родителя целиком — подложка, кликабельная область карточки |
| `inset: 0; width: 200px; height: 100px; margin: auto` | **центрирование**: `auto`-поля делят остаток поровну |
| ни одного смещения | **статическая позиция** (static position): элемент остаётся там, где стоял бы в потоке, но потоку не мешает |

Статическая позиция — малоизвестная, но полезная вещь: значок, который должен стоять ровно после текста,
но не влиять на перенос строки.

<details>
<summary>Четыре способа задать абсолютный элемент</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-positioning.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 13px system-ui, sans-serif; margin: 16px; display: grid; grid-template-columns: repeat(2, 200px); gap: 16px; }
  .cb { position: relative; height: 120px; padding: 20px; border: 4px solid #334155; background: #f1f5f9; }
  .a { position: absolute; background: #fde047; outline: 1px solid #a16207; }
  .one .a { top: 0; left: 0; }
  .two .a { left: 0; right: 0; bottom: 0; }
  .three .a { inset: 0; opacity: .6; }
  .four .a { inset: 0; width: 90px; height: 40px; margin: auto; }
</style>
</head>
<body>
  <div class="cb one">padding 20px игнорируется<span class="a">top/left: 0</span></div>
  <div class="cb two">растянут по ширине<span class="a">left/right/bottom: 0</span></div>
  <div class="cb three">накрыт целиком<span class="a">inset: 0</span></div>
  <div class="cb four"><span class="a">inset: 0 + margin: auto</span></div>
</body>
</html>
```

</details>

### 3.2. Проценты

`top: 50%` — половина **высоты** содержащего блока, `left: 50%` — половина ширины. А вот
`margin-top: 50%` — половина **ширины** (все проценты полей и внутренних отступов считаются от ширины).
Отсюда старое центрирование `top: 50%; left: 50%; transform: translate(-50%, -50%)`: проценты в
`transform` — от размера **самого элемента**.

## 4. Порядок отрисовки и `z-index`

Без всяких `z-index` браузер рисует содержимое контекста наложения в строго определённом порядке
(CSS 2.1, приложение E). Упрощённо, снизу вверх:

1. фон и рамки элемента, создающего контекст;
2. потомки-контексты с **отрицательным** `z-index` (по возрастанию);
3. блочные потомки в потоке (фоны, рамки);
4. плавающие (`float`) потомки;
5. строчное содержимое в потоке (текст, `inline-block`);
6. позиционированные потомки с `z-index: auto` или `0` — **в порядке дерева**;
7. потомки-контексты с **положительным** `z-index` (по возрастанию, равные — в порядке дерева).

Два вывода, которые объясняют большинство сюрпризов:

- **позиционированный элемент без `z-index` рисуется поверх непозиционированных**, даже если стоит
  в дереве раньше — шаг 6 идёт после шагов 3–5;
- текст обычного блока (шаг 5) оказывается **над** фоном следующего блока с отрицательным полем (шаг 3):
  фоны всех блоков рисуются раньше всего текста.

`z-index` применяется к позиционированным элементам, а также к **элементам flex и grid** — даже со
`static`.

## 5. Контекст наложения

**Контекст наложения** — группа, внутри которой `z-index` потомков сравниваются между собой. Снаружи вся
группа — один слой, со своим единственным местом в родительском контексте. Это как папка: файлы внутри
сортируются, но папка целиком лежит в одной позиции.

Отсюда главное правило: **`z-index` ребёнка не может поднять его выше «дяди», если родитель создал
контекст и проиграл дяде.** `z-index: 9999` внутри контекста с `z-index: 1` всё равно ниже соседа с
`z-index: 2`.

### 5.1. Что создаёт контекст наложения

- корневой элемент `html`;
- `position: absolute` или `relative` с `z-index` ≠ `auto`;
- `position: fixed` или `sticky` — **всегда**;
- элемент flex или grid с `z-index` ≠ `auto`;
- `opacity` меньше 1;
- `transform`, `translate`, `rotate`, `scale`, `perspective`, `filter`, `backdrop-filter`,
  `clip-path`, `mask` — любое значение, кроме `none`;
- `mix-blend-mode` ≠ `normal`;
- `isolation: isolate`;
- `contain: layout`, `paint`, `strict`, `content`; `container-type: size` или `inline-size`;
- `will-change` с одним из перечисленных свойств;
- элементы в верхнем слое (`<dialog>` через `showModal()`, popover, полноэкранный режим).

Самые коварные — `opacity` и `transform`: их добавляют ради анимации, не думая о слоях, и выпадающее
меню внутри карточки вдруг уходит под соседнюю карточку.

<details>
<summary>z-index: 9999 проигрывает z-index: 2</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-positioning.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; margin: 16px; }
  .card { position: relative; width: 240px; height: 80px; padding: 8px; border: 2px solid; }
  .a { z-index: 1; background: #dbeafe; border-color: #1d4ed8; }
  .b { z-index: 2; background: #fef3c7; border-color: #b45309; margin-top: -30px; margin-left: 40px; }
  .menu { position: absolute; top: 40px; left: 20px; z-index: 9999; width: 160px; height: 70px;
          background: #fca5a5; border: 2px solid #991b1b; padding: 4px; }
</style>
</head>
<body>
  <div class="card a">
    Карточка A, z-index: 1
    <div class="menu">Меню, z-index: 9999 — но оно внутри контекста A</div>
  </div>
  <div class="card b">Карточка B, z-index: 2 — накрывает меню</div>
</body>
</html>
```

</details>

### 5.2. Как решать z-index-головоломки

1. Найдите два элемента, порядок которых вас не устраивает.
2. Поднимитесь от каждого вверх до **общего контекста наложения**.
3. Сравнивайте `z-index` (и порядок в дереве) тех двух предков, которые являются прямыми
   участниками общего контекста. Значения ниже — не важны.

Способы починки, от лучшего к худшему:

- убрать лишний контекст (`z-index` у обёртки, ненужный `transform`);
- поднять `z-index` у предка, а не у ребёнка;
- вынести всплывающий элемент из карточки (в конец `body`, в верхний слой через popover или `<dialog>`);
- никогда — «ещё больше девяток».

### 5.3. `isolation: isolate` — контекст без побочных эффектов

Иногда контекст нужен **специально**: компонент внутри использует `z-index: -1` (подложка под текстом) и
не должен проваливаться под фон родителя. `isolation: isolate` создаёт контекст, не трогая ни
позиционирование, ни прозрачность, ни слои GPU.

<details>
<summary>z-index: -1 и isolation</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-positioning.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px system-ui, sans-serif; margin: 16px; }
  .section { background: #e2e8f0; padding: 16px; margin-bottom: 12px; }
  .btn { position: relative; display: inline-block; padding: 10px 18px; color: #111; }
  .btn::before { content: ""; position: absolute; inset: 0; z-index: -1;
                 background: #facc15; transform: skew(-12deg); }
  .iso .btn { isolation: isolate; }
</style>
</head>
<body>
  <div class="section"><span class="btn">Без isolation: подложка ушла под серый фон</span></div>
  <div class="section iso"><span class="btn">С isolation: isolate — подложка видна</span></div>
</body>
</html>
```

</details>

Почему в первом случае подложка исчезает: у `.btn` нет `z-index`, значит, она не создаёт контекст.
`::before` с `z-index: -1` уходит в ближайший контекст — корневой — на шаг 2, **под** фон `.section`
(шаг 3). `isolation: isolate` на `.btn` создаёт контекст, и шаг 2 теперь внутри кнопки: подложка рисуется над её
(прозрачным) фоном, а значит, и над уже нарисованным серым фоном секции.

## 6. `position: sticky`

Липкий элемент ведёт себя как `relative`, пока его край не достигнет порога, заданного смещением, — и
тогда «прилипает» к краю **ближайшего прокручиваемого предка** (scrollport). Отлипает, когда кончается
его **родитель**: липкий элемент никогда не выходит за пределы содержащего блока.

```css
th { position: sticky; top: 0; }   /* заголовок таблицы при прокрутке */
```

### 6.1. Почему sticky «не работает»

| Причина | Как узнать | Что сделать |
|---|---|---|
| Не задано смещение (`top`, `bottom`, …) | в стилях только `position: sticky` | добавить `top: 0`; без порога липнуть не к чему |
| У предка `overflow: hidden`, `auto` или `scroll` | элемент липнет к этому предку, а он сам не прокручивается | убрать `overflow` или заменить на `overflow: clip` — он обрезает, но не создаёт прокручиваемую область |
| Родитель не выше самого элемента | липкому некуда ехать внутри родителя | сделать липким элемент уровнем выше |
| Flex или grid растянули элемент на всю высоту | `align-items: stretch`: элемент высотой с родителя | `align-self: start` |
| Смещение «не с той стороны» | `bottom: 0` у элемента в начале длинного списка | `bottom` липнет к нижнему краю, когда элемент ниже видимой области |

Самая частая — вторая. `overflow-x: hidden` на `body` или обёртке «чтобы не было горизонтальной
прокрутки» превращает её в прокручиваемый контейнер (по другой оси значение `visible` вычисляется в
`auto`), и вся липкость внутри тихо пропадает. Для этой задачи придуман `overflow-x: clip`.

<details>
<summary>sticky работает и не работает</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-positioning.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; margin: 16px; display: flex; gap: 16px; align-items: flex-start; }
  .scroller { height: 200px; width: 200px; overflow: auto; border: 2px solid #334155; }
  .bar { position: sticky; background: #0ea5e9; color: white; padding: 6px; }
  .ok .bar { top: 0; }
  .wrap { overflow: hidden; }
  .item { padding: 6px; border-bottom: 1px solid #cbd5e1; }
</style>
</head>
<body>
  <div class="scroller ok">
    <div class="bar">top: 0 — прилипает</div>
    <div class="item">1</div><div class="item">2</div><div class="item">3</div><div class="item">4</div>
    <div class="item">5</div><div class="item">6</div><div class="item">7</div><div class="item">8</div>
    <div class="item">9</div><div class="item">10</div>
  </div>
  <div class="scroller">
    <div class="bar">нет top — уезжает</div>
    <div class="item">1</div><div class="item">2</div><div class="item">3</div><div class="item">4</div>
    <div class="item">5</div><div class="item">6</div><div class="item">7</div><div class="item">8</div>
    <div class="item">9</div><div class="item">10</div>
  </div>
  <div class="scroller ok">
    <div class="wrap">
      <div class="bar">overflow: hidden у обёртки — уезжает</div>
      <div class="item">1</div><div class="item">2</div><div class="item">3</div><div class="item">4</div>
      <div class="item">5</div><div class="item">6</div><div class="item">7</div><div class="item">8</div>
      <div class="item">9</div><div class="item">10</div>
    </div>
  </div>
</body>
</html>
```

</details>

Прокрутите все три колонки. В третьей обёртка с `overflow: hidden` стала ближайшим «прокручиваемым»
предком — у неё нет своей прокрутки, поэтому липкий элемент ни к чему не прилипает.

### 6.2. Липкие заголовки разделов

Если у каждого раздела свой липкий заголовок, следующий **выталкивает** предыдущий: каждый заголовок
ограничен своим разделом-родителем. Это поведение бесплатно, без JavaScript.

<details>
<summary>Заголовки разделов выталкивают друг друга</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-positioning.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; margin: 16px; }
  .list { height: 220px; width: 240px; overflow: auto; border: 2px solid #334155; }
  h3 { position: sticky; top: 0; margin: 0; padding: 6px; background: #4f46e5; color: white; }
  p { margin: 0; padding: 6px; border-bottom: 1px solid #e2e8f0; }
</style>
</head>
<body>
  <div class="list">
    <section><h3>А</h3><p>Анна</p><p>Антон</p><p>Арсений</p><p>Алла</p><p>Артём</p></section>
    <section><h3>Б</h3><p>Борис</p><p>Белла</p><p>Богдан</p><p>Берта</p></section>
    <section><h3>В</h3><p>Вера</p><p>Виктор</p><p>Влад</p><p>Валентина</p><p>Варвара</p></section>
  </div>
</body>
</html>
```

</details>

## 7. Практические шаблоны

- **Кликабельная карточка целиком**: ссылка внутри заголовка, у её `::after` — `position: absolute;
  inset: 0`, у карточки — `position: relative`. Вся карточка кликабельна, а в дереве доступности одна
  ссылка с осмысленным текстом.
- **Значок в углу**: `position: absolute; top: -6px; right: -6px` внутри `relative`-кнопки.
- **Шапка, прилипающая к верху**: `position: sticky; top: 0` вместо `fixed` — не нужно компенсировать
  её высоту отступом у `body`.
- **Якоря под липкой шапкой**: `scroll-margin-top: 4rem` на целевых заголовках, чтобы переход по `#id`
  не прятал их под шапку.

<details>
<summary>Кликабельная карточка через ::after</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-positioning.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; margin: 16px; }
  .card { position: relative; width: 260px; padding: 12px; border: 1px solid #94a3b8; border-radius: 8px; }
  .card:hover { box-shadow: 0 4px 12px rgb(0 0 0 / .2); }
  .card a::after { content: ""; position: absolute; inset: 0; }
  .card a { color: #1d4ed8; }
</style>
</head>
<body>
  <article class="card">
    <h3><a href="#card">Заголовок статьи</a></h3>
    <p>Наведите курсор и кликните в любом месте карточки: срабатывает единственная ссылка.</p>
  </article>
</body>
</html>
```

</details>

## Итог

- `relative` сдвигает отрисовку, сохраняя место; `absolute` и `fixed` удаляют элемент из потока.
- Содержащий блок для `absolute` — padding box ближайшего позиционированного предка; для `fixed` —
  окно, если ни у одного предка нет `transform`, `filter`, `contain` и им подобных.
- `inset: 0` + размеры + `margin: auto` центрирует; без смещений элемент встаёт в статическую позицию.
- `z-index` сравнивается только внутри одного контекста наложения; контексты создают `opacity`,
  `transform`, `filter`, `fixed`, `sticky`, `isolation` и позиционирование с `z-index`.
- Sticky нужен порог и отсутствие `overflow` у предков между ним и прокручиваемой областью;
  `overflow: clip` — безопасная замена `hidden`.

## Проверьте себя

1. От какого прямоугольника отсчитывается `top: 0` абсолютного элемента, если у родителя
   `position: relative; padding: 20px`?
2. Модальное окно с `position: fixed` прокручивается вместе с контентом. Назовите три возможные причины.
3. Элемент с `z-index: 100` оказался под элементом с `z-index: 1`. Опишите алгоритм поиска причины.
4. Почему `::before` с `z-index: -1` иногда исчезает под фоном родителя секции, и как это исправить
   одной строкой?
5. Заголовок с `position: sticky; top: 0` не прилипает. Перечислите, что проверить.

Дальше: [Адаптивность: `@media`, контейнерные запросы, viewport](LEARN_CSS_RESPONSIVE_COURSE.md).
