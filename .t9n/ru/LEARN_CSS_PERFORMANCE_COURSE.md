# Производительность CSS

> Курс 22 из программы. Для тех, кто пишет CSS уверенно и хочет понимать, **чего он стоит**. Здесь
> нет советов вроде «минифицируйте всё»: мы разберём, какую работу делает браузер на каждом этапе,
> какие решения в CSS умножают эту работу, а какие — мифы двадцатилетней давности.

**Что вы будете понимать после курса**

- из каких этапов состоит **конвейер отрисовки** (rendering pipeline) и что каждый этап стоит;
- от чего зависит цена **пересчёта стилей** (style recalculation) и почему «медленные селекторы»
  почти всегда миф, а иногда — нет;
- что такое **принудительная синхронная раскладка** (forced synchronous layout) и где её искать;
- как `contain` и `content-visibility` ограничивают работу браузера частью страницы;
- что такое **композитные слои** (compositing layers) и почему `will-change` на всём подряд вредит;
- почему CSS **блокирует отрисовку** (render-blocking), что такое критический CSS и чем плох `@import`;
- как загружаются шрифты и как не получить невидимый текст или прыжок раскладки.

---

## 1. Конвейер: пять этапов кадра

Каждый раз, когда что-то меняется (DOM, классы, размер окна, прокрутка, анимация), браузер может
пройти этапы:

| Этап | Что делает | Вход → выход |
|---|---|---|
| **Стиль** (style) | для каждого элемента вычисляет значения всех свойств | DOM + CSSOM → вычисленные стили |
| **Раскладка** (layout, в Firefox — reflow) | геометрия: позиции и размеры блоков | стили → дерево фрагментов |
| **Отрисовка** (paint) | списки команд рисования: фоны, текст, рамки | геометрия → display list |
| **Растеризация** (raster) | команды → пиксели (часто на GPU, плитками) | display list → текстуры |
| **Композиция** (composite) | сборка слоёв в кадр с учётом `transform`, `opacity` | слои → кадр |

Ключевое правило: **изменение запускает свой этап и все последующие**. Поменяли `width` — стиль,
раскладка, отрисовка, композиция. Поменяли `color` — раскладка пропускается. Поменяли `transform` у
элемента на отдельном слое — только композиция. Бюджет кадра при 60 Гц — 16,7 мс на всё, включая ваш
JavaScript; при 120 Гц — 8,3 мс.

Цена этапов не постоянна: она пропорциональна **числу затронутых элементов**. Отсюда вся стратегия
этого курса — уменьшать область, которую браузер вынужден пересчитать.

## 2. Пересчёт стилей

### 2.1. Что на самом деле стоит денег

Цена пересчёта ≈ (число элементов, чьи стили надо пересчитать) × (число правил, которые нужно
проверить для каждого) × (цена проверки одного селектора). Каждый множитель важен по-своему:

1. **Число элементов** — главный. Добавить класс на `<body>` — значит потенциально пересчитать
   весь документ. Добавить на конкретную карточку — только её поддерево (а с правилами вроде
   `.card.active + .card` — ещё и соседей).
2. **Число правил-кандидатов.** Браузер не проверяет каждое правило. Он раскладывает правила по
   «корзинам» по **крайнему правому составному селектору** (его называют ключевым, key selector):
   по id, классу, тегу. Для элемента `<li class="item">` проверяются только правила из корзин
   `li`, `.item` и универсальной. Тысяча правил вида `.x-123 { }` почти ничего не стоит элементам без
   этих классов.
3. **Цена одного селектора.** Селекторы проверяются **справа налево** (курс
   [Документ HTML](LEARN_HTML_DOCUMENT_COURSE.md)). `.menu a` для каждой ссылки поднимается по
   предкам, пока не найдёт `.menu`. Браузеры ускоряют это **фильтром Блума** (Bloom filter) по
   предкам: за одну операцию узнают, что `.menu` среди предков точно нет.

### 2.2. Мифы и реальность о селекторах

| Утверждение | Реальность |
|---|---|
| «`*` медленный» | `* { box-sizing: border-box }` — одно правило, совпадает сразу. Дёшево. |
| «Вложенность глубже трёх — медленно» | Длина почти не важна, если ключевой селектор узкий. |
| «id быстрее класса» | Разница неизмерима на реальных страницах. |
| «`div.foo` хуже `.foo`» | Неизмеримо; но `div.foo` хуже для **поддержки** — выше специфичность. |
| «`[class*="col-"]` медленный» | Подстроковые атрибутные селекторы в ключевой позиции действительно попадают в универсальную корзину и проверяются для всех элементов. На огромных DOM заметно. |
| «`:has()` дорогой» | Может быть: изменение потомка требует проверить предков. Браузеры оптимизируют, но `:has()` в ключевой позиции с широким аргументом (`body:has(*:hover)`) — плохая идея. |

Вывод: на страницах обычного размера селекторы не являются узким местом. Узкие места — **размер DOM**
(десятки тысяч элементов), **частота** пересчётов и **ширина** инвалидации.

### 2.3. Инвалидация

Когда меняется класс, браузер не пересчитывает всё. Он строит **наборы инвалидации** (invalidation
sets): «если у элемента появился класс `.open`, перепроверь потомков с классом `.panel`». Чем
точнее селектор, тем уже набор.

```css
/* Широкая инвалидация: смена .dark на html пересчитывает всё */
.dark p { color: #eee; }

/* Тема через пользовательские свойства: смена .dark меняет значения переменных,
   наследование доносит их; браузер всё равно пересчитает наследников,
   но правила проверять заново не нужно */
:root.dark { --fg: #eee; }
p { color: var(--fg); }
```

Смена темы — редкое событие, и это допустимо. Плохо, когда класс на `<body>` переключается **каждый
кадр** (например, при прокрутке) — тогда каждый кадр пересчитывается весь документ. Ставьте
динамические классы как можно ближе к тем элементам, которые меняются.

Пользовательские свойства, заданные на `:root` и меняемые из JS каждый кадр (`--mouse-x`), имеют ту же
проблему: свойство наследуется, значит, меняется вычисленный стиль **всех** элементов. Задавайте такие
свойства на элементе, где они нужны, или регистрируйте через `@property` с `inherits: false`.

## 3. Раскладка и «трэшинг»

Раскладка — обычно самый дорогой этап. Браузер откладывает её до конца кадра, чтобы сделать один
раз. Но если JS **читает** геометрию (`offsetHeight`, `getBoundingClientRect()`, `scrollTop`,
`getComputedStyle(el).width`) после изменения стилей, браузер обязан посчитать раскладку немедленно —
это **принудительная синхронная раскладка**. Чередование «запись—чтение—запись—чтение» в цикле
называется **layout thrashing** и может стоить сотни миллисекунд.

<details>
<summary>Чтение и запись вперемешку против пакетной обработки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-performance.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; padding: 10px; }
  #box div { height: 4px; background: #38c; margin: 1px 0; width: 50px; }
  output { display: block; margin: 6px 0; font-weight: bold; }
</style>
</head>
<body>
  <button id="bad">Вперемешку</button>
  <button id="good">Сначала чтение, потом запись</button>
  <output id="o">Нажмите кнопку</output>
  <div id="box"></div>
  <script>
    var box = document.getElementById('box'), html = '';
    for (var i = 0; i < 1500; i++) html += '<div></div>';
    box.innerHTML = html;
    var items = box.children;
    function reset() { for (var i = 0; i < items.length; i++) items[i].style.width = '50px'; box.offsetWidth; }
    document.getElementById('bad').onclick = function () {
      reset(); var t = performance.now();
      for (var i = 0; i < items.length; i++) {
        var w = items[i].offsetWidth;          // чтение: заставляет считать раскладку
        items[i].style.width = (w + 1) + 'px'; // запись: делает раскладку устаревшей
      }
      box.offsetWidth;
      document.getElementById('o').textContent = 'Вперемешку: ' + (performance.now() - t).toFixed(1) + ' мс';
    };
    document.getElementById('good').onclick = function () {
      reset(); var t = performance.now(), ws = [];
      for (var i = 0; i < items.length; i++) ws.push(items[i].offsetWidth);
      for (var j = 0; j < items.length; j++) items[j].style.width = (ws[j] + 1) + 'px';
      box.offsetWidth;
      document.getElementById('o').textContent = 'Пакетом: ' + (performance.now() - t).toFixed(1) + ' мс';
    };
  </script>
</body>
</html>
```

</details>

Как с этим бороться со стороны JS (`requestAnimationFrame`, `ResizeObserver`, разделение чтений и
записей) — в курсе [Производительность JavaScript в браузере](LEARN_JAVASCRIPT_PERFORMANCE_COURSE.md).
Со стороны CSS задача — сделать каждую раскладку **дешевле** и **локальнее**.

Что делает раскладку дорогой со стороны CSS:

- большие таблицы с `table-layout: auto` — ширины колонок зависят от содержимого всех строк;
  `table-layout: fixed` считает их по первой строке;
- вложенные flex/grid с размерами «по содержимому» (`auto`, `min-content`, `fit-content`) — браузеру
  приходится измерять детей несколько раз;
- изменения, у которых **неограниченная зона влияния**: смена размера шрифта у `<html>`, изменение
  ширины колонки, от которой зависит всё под ней.

## 4. `contain`: обещание браузеру

Свойство `contain` — это **обещание**: «то, что внутри этого элемента, не влияет на то, что снаружи
(в указанном смысле)». Браузер этим обещанием пользуется, ограничивая пересчёты.

| Значение | Обещание | Побочные эффекты |
|---|---|---|
| `layout` | раскладка внутри не влияет на внешнюю | создаёт контекст форматирования и контекст наложения; становится содержащим блоком для `fixed`/`absolute` потомков |
| `paint` | потомки не рисуются за границами | обрезка как `overflow: clip`; тоже контекст наложения и содержащий блок |
| `size` | размер не зависит от содержимого | без явных размеров элемент схлопнется в 0 |
| `inline-size` | ширина не зависит от содержимого | основа контейнерных запросов (`container-type: inline-size`) |
| `style` | счётчики и `quotes` не выходят наружу | влияние минимально |
| `content` | `layout paint style` | безопасный набор для виджетов |
| `strict` | `size layout paint style` | только при явных размерах |

Когда внутри элемента с `contain: layout` что-то меняется, браузер знает: внешняя раскладка не
зависит от внутренней, — и может пересчитать только поддерево (если размер самого элемента не
изменился). Типичные кандидаты: карточки в ленте, виджеты, чат, сторонние встраивания, элементы
бесконечного списка.

<details>
<summary>contain: paint обрезает и изолирует</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-performance.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; padding: 16px; display: flex; gap: 40px; }
  .w { width: 160px; height: 100px; border: 2px solid #357; position: relative; background: #eef4ff; }
  .w .out { position: absolute; left: 110px; top: 60px; width: 100px; height: 60px; background: #c33; color: #fff; padding: 4px; }
  .w .fx { position: fixed; right: 10px; bottom: 10px; background: #3a5; color: #fff; padding: 4px; }
  .c { contain: paint; }
</style>
</head>
<body>
  <div><div class="w"><div class="out">вылезаю</div><div class="fx">fixed</div></div><p>без contain</p></div>
  <div><div class="w c"><div class="out">обрезан</div><div class="fx">fixed</div></div><p>contain: paint</p></div>
  <p style="align-self:end">Зелёный fixed слева привязан к окну; справа — к контейнеру с contain.</p>
</body>
</html>
```

</details>

Пример показывает, почему `contain` нельзя расставлять бездумно: обещание меняет поведение. Меню,
выпадающее за пределы карточки с `contain: paint`, будет обрезано, а `position: fixed` внутри
перестанет быть привязанным к окну.

## 5. `content-visibility`: не рисовать то, что не видно

`content-visibility: auto` — самое сильное средство для длинных страниц. Пока элемент далеко от
экрана, браузер **пропускает стиль, раскладку и отрисовку его потомков** целиком, применяя к элементу
`contain: size layout paint style`. Когда элемент приближается к области видимости, всё считается.

Проблема: с `contain: size` пустой элемент имеет нулевую высоту, полоса прокрутки прыгает. Решение —
`contain-intrinsic-size`, оценка размера:

```css
.article-section {
  content-visibility: auto;
  contain-intrinsic-size: auto 600px;
}
```

`auto 600px` означает: пока элемент ни разу не отрисован, считай высоту 600px; после того как
отрисован — **запомни реальный размер** и используй его, когда элемент снова уйдёт за экран.

Значения: `visible` (по умолчанию), `auto`, `hidden` (содержимое не рендерится никогда, но в отличие
от `display: none` сохраняется состояние отрисовки — быстро показать снова). Поддержка: Chrome 85,
Firefox 125, Safari 18.

Что продолжает работать при `auto`: содержимое доступно для поиска по странице (Ctrl+F), для
навигации по якорям и для программ экранного доступа — оно в DOM и в дереве доступности. Это
принципиальное отличие от «виртуальных списков», которые удаляют элементы из DOM.

<details>
<summary>content-visibility: auto на 3000 блоках</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-performance.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; padding: 10px; }
  .item { padding: 8px; margin: 4px 0; border: 1px solid #ccd; display: flex; gap: 6px; flex-wrap: wrap; }
  .item span { padding: 2px 4px; background: #eef; border-radius: 3px; }
  .cv .item { content-visibility: auto; contain-intrinsic-size: auto 90px; }
  output { font-weight: bold; }
</style>
</head>
<body>
  <button onclick="run(false)">Построить без content-visibility</button>
  <button onclick="run(true)">Построить с content-visibility</button>
  <output id="o"></output>
  <div id="list"></div>
  <script>
    function run(cv) {
      var list = document.getElementById('list'), h = '';
      for (var i = 0; i < 3000; i++) {
        h += '<div class="item"><b>' + i + '</b>';
        for (var k = 0; k < 20; k++) h += '<span>метка ' + k + '</span>';
        h += '</div>';
      }
      list.className = cv ? 'cv' : '';
      var t = performance.now();
      list.innerHTML = h;
      list.offsetHeight;
      document.getElementById('o').textContent = ' стиль и раскладка: ' + (performance.now() - t).toFixed(0) + ' мс';
    }
  </script>
</body>
</html>
```

</details>

Ловушки:

- элементы с `content-visibility: auto` получают `contain: paint` — тени и выпадающие меню за
  границей обрезаются;
- `contain-intrinsic-size` без `auto` при сильно разных реальных размерах вызывает скачки полосы
  прокрутки;
- выигрыш виден только на **больших** поддеревьях вне экрана; на короткой странице — ноль.

## 6. Слои и композиция

### 6.1. Что такое слой

Браузер может рисовать часть страницы в отдельную текстуру — **композитный слой** — и затем собирать
кадр из слоёв на GPU. Перемещение слоя (`transform`) или изменение его прозрачности (`opacity`) не
требует перерисовки: текстура уже есть, меняются лишь параметры сборки. Поэтому эти два свойства —
«дешёвые» (подробно — в курсе [Переходы и анимации](LEARN_CSS_TRANSITIONS_ANIMATIONS_COURSE.md)).

Элемент получает собственный слой, например, когда:

- у него активна анимация или переход `transform`/`opacity`;
- у него `will-change: transform` (или `opacity`);
- у него 3D-преобразование (`translateZ(0)` — старый «хак ускорения»);
- это `<video>`, `<canvas>` с WebGL, `<iframe>`;
- у него `position: fixed` (в Chrome при прокрутке, в зависимости от условий);
- он перекрывает другой слой и обязан рисоваться поверх — **неявное повышение** (implicit
  compositing, layer explosion).

### 6.2. Цена слоя

Слой — это текстура в памяти видеокарты: ширина × высота × 4 байта. Полноэкранный слой 1920×1080 —
около 8 МБ, на экране с плотностью 2× — около 33 МБ. На телефоне память GPU ограничена: сотни слоёв
ведут к выгрузке текстур, мерцанию и падению вкладки. Кроме того, каждым слоем надо управлять при
композиции.

### 6.3. `will-change`: правильно и неправильно

```css
/* Плохо: слой на каждом элементе навсегда */
* { will-change: transform; }
.card { will-change: transform, opacity, top, left; }

/* Хорошо: подсказка перед реальной анимацией и только для неё */
.drawer { will-change: transform; }      /* элемент, который часто двигается */
```

`will-change` говорит браузеру: «скоро это свойство будет меняться, подготовься». Подготовка — создать
слой заранее, чтобы первый кадр анимации не ждал растеризации. Побочные эффекты те же, что у самого
свойства: `will-change: transform` создаёт контекст наложения и содержащий блок для `fixed`
потомков — даже до начала анимации.

Правила:

1. Не ставьте его «на всякий случай» и не ставьте на много элементов.
2. Для редких анимаций добавляйте его из JS незадолго до старта (по `pointerenter`) и снимайте после
   (`animationend`).
3. Не пишите `translateZ(0)` вместо `will-change`: это тот же слой, но без смысла в коде.
4. Растеризованный слой при масштабировании (`scale`) может выглядеть размыто: браузер не
   перерастеризует текстуру, пока идёт анимация, — плата за скорость.

<details>
<summary>will-change меняет поведение position: fixed</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-performance.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; padding: 16px; height: 600px; }
  .card { width: 260px; padding: 12px; margin: 10px 0; border: 2px solid #357; background: #eef4ff; }
  .toast { position: fixed; top: 8px; right: 8px; padding: 6px 10px; background: #c33; color: #fff; }
  .wc { will-change: transform; }
</style>
</head>
<body>
  <div class="card">Обычная карточка<div class="toast">fixed: к окну</div></div>
  <div class="card wc">will-change: transform<div class="toast">fixed: к карточке!</div></div>
  <p>Второй «toast» привязан к карточке, а не к окну: will-change создал содержащий блок.</p>
</body>
</html>
```

</details>

### 6.4. Как смотреть

Chrome DevTools: панель **Layers** (слои и причины их создания), **Rendering → Paint flashing**
(зелёным подсвечиваются перерисованные области), **Layout Shift Regions**, и главное — панель
**Performance**: запись показывает фиолетовые (стиль, раскладка) и зелёные (отрисовка) блоки в
каждом кадре, с указанием, какой JS вызвал принудительную раскладку.

## 7. CSS блокирует отрисовку

### 7.1. Почему

Браузер **не показывает страницу**, пока не загружены и не разобраны все таблицы стилей из
`<link rel="stylesheet">` в `<head>` (с подходящим `media`). Причина: показать документ без стилей,
а через полсекунды — со стилями, значит устроить «вспышку нестилизованного содержимого» (FOUC,
flash of unstyled content) и прыжки раскладки. Поэтому CSS — **ресурс, блокирующий отрисовку**
(render-blocking).

Вторая блокировка: синхронный `<script>`, стоящий **после** `<link rel="stylesheet">`, не
выполнится, пока таблица стилей не загрузится, — скрипт может спросить `getComputedStyle`, и ответ
должен быть правильным. Так медленный CSS задерживает и JS, и разбор HTML после скрипта.

```html
<link rel="stylesheet" href="app.css">          <!-- блокирует отрисовку -->
<link rel="stylesheet" href="print.css" media="print">        <!-- не блокирует -->
<link rel="stylesheet" href="wide.css" media="(min-width: 1200px)"> <!-- блокирует только если условие истинно -->
```

Таблицы с несовпадающим `media` всё равно загружаются, но с низким приоритетом и без блокировки.

### 7.2. Критический CSS

**Критический CSS** — минимальный набор правил для содержимого первого экрана (above the fold),
встроенный прямо в `<style>` в `<head>`. Остальной CSS загружается без блокировки:

```html
<head>
  <style>/* критические правила: шапка, сетка, первый экран, ~10–15 КБ */</style>
  <link rel="stylesheet" href="full.css" media="print" onload="this.media='all'">
  <noscript><link rel="stylesheet" href="full.css"></noscript>
</head>
```

Приём с `media="print"` использует сказанное выше: таблица «для печати» не блокирует, а по загрузке
скрипт переключает её на `all`. Альтернатива — `<link rel="preload" as="style" onload="this.rel='stylesheet'">`.

Почему 14 КБ — частая цифра? Начальное окно перегрузки TCP — 10 сегментов, около 14 КБ: столько
сервер успеет отправить в первом ответе без ожидания подтверждений. Если HTML с критическим CSS
укладывается в это, первая отрисовка возможна после одного обмена (round trip). С HTTP/3 и сжатием
цифра условна, но идея та же: первый экран не должен ждать дополнительных запросов.

Цена критического CSS: правила дублируются (в HTML и в файле), встроенный CSS не кэшируется отдельно
от HTML, а сборку надо поддерживать. Для небольших сайтов разумнее **маленький единый CSS-файл** с
хорошим кэшированием — один запрос, кэш на годы.

### 7.3. `@import` — цепочка запросов

```css
/* main.css */
@import url("reset.css");
@import url("theme.css");
```

Браузер узнает о `reset.css`, только **скачав и разобрав** `main.css`. Получается водопад: HTML →
`main.css` → `reset.css` и `theme.css`. Каждое звено — полный сетевой обмен, и всё это время отрисовка
заблокирована. **Сканер предзагрузки** (preload scanner), который быстро пробегает HTML в поисках
ресурсов, видит `<link>` в HTML, но не видит `@import` внутри внешних CSS-файлов.

Решения: несколько `<link>` в HTML (загружаются параллельно), или сборка в один файл. `@import` уместен
только тогда, когда сборщик всё равно склеит файлы (Sass, PostCSS, esbuild), а также с
`@import ... layer(name)` — для назначения слоёв каскада стороннему CSS, опять же при сборке.

<details>
<summary>Водопад @import и параллельные link: модель по времени</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-performance.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 13px system-ui, sans-serif; padding: 10px; }
  .row { position: relative; height: 22px; margin: 3px 0; }
  .bar { position: absolute; height: 18px; color: #fff; padding: 0 6px; line-height: 18px; white-space: nowrap; border-radius: 3px; }
  .h { background: #555; } .c { background: #38c; } .i { background: #c63; } .p { background: #c33; }
  .axis { border-top: 1px solid #999; margin-top: 6px; color: #777; }
  h3 { margin: 14px 0 4px; }
</style>
</head>
<body>
  <p>Каждая полоса — один запрос длиной 100 мс (1 мс = 1 px). Красная — первая отрисовка.</p>
  <h3>@import внутри main.css</h3>
  <div class="row"><div class="bar h" style="left:0;width:100px">HTML</div></div>
  <div class="row"><div class="bar c" style="left:100px;width:100px">main.css</div></div>
  <div class="row"><div class="bar i" style="left:200px;width:100px">reset.css</div></div>
  <div class="row"><div class="bar i" style="left:200px;width:100px">theme.css</div></div>
  <div class="row"><div class="bar p" style="left:300px;width:110px">отрисовка</div></div>
  <h3>Три link в HTML</h3>
  <div class="row"><div class="bar h" style="left:0;width:100px">HTML</div></div>
  <div class="row"><div class="bar c" style="left:100px;width:100px">main.css</div></div>
  <div class="row"><div class="bar c" style="left:100px;width:100px">reset.css</div></div>
  <div class="row"><div class="bar c" style="left:100px;width:100px">theme.css</div></div>
  <div class="row"><div class="bar p" style="left:200px;width:110px">отрисовка</div></div>
  <div class="axis">0 мс … 400 мс</div>
</body>
</html>
```

</details>

### 7.4. Размер CSS

Неиспользуемые правила стоят загрузки и разбора (разбор CSS быстрый: сотни КБ — миллисекунды) и
памяти, но почти не стоят пересчёта стилей — их ключевые селекторы ни с чем не совпадают. Вкладка
**Coverage** в DevTools показывает долю неиспользованных байтов. Важно сжатие (`gzip`, `brotli`): CSS
сжимается в 5–10 раз; минификация после сжатия даёт уже скромный выигрыш.

## 8. Шрифты

### 8.1. Как загружается веб-шрифт

`@font-face` сам по себе **ничего не загружает**. Браузер скачивает шрифт, только когда после
вычисления стилей обнаруживает текст, которому этот шрифт нужен. Значит, цепочка такая: HTML → CSS
→ стиль и раскладка → запрос шрифта. Шрифт узнаётся поздно, и всё это время текст либо невидим,
либо показан запасным шрифтом.

| Явление | Что видит пользователь |
|---|---|
| FOIT (flash of invisible text) | текст невидим, пока шрифт грузится |
| FOUT (flash of unstyled text) | сначала запасной шрифт, затем замена — и сдвиг раскладки |

### 8.2. `font-display`

```css
@font-face {
  font-family: "Inter";
  src: url("/fonts/inter-var.woff2") format("woff2");
  font-display: swap;
}
```

| Значение | Период блокировки (невидимый текст) | Период замены | Поведение |
|---|---|---|---|
| `auto` | на усмотрение браузера (обычно как `block`) | — | — |
| `block` | ~3 с | бесконечный | FOIT; для иконочных шрифтов |
| `swap` | ~0 (очень короткий) | бесконечный | сразу запасной, замена когда угодно |
| `fallback` | ~100 мс | ~3 с | если не успел за 3 с — остаётся запасной |
| `optional` | ~100 мс | нет | шрифт используется, только если успел (или из кэша); без сдвигов |

`optional` — лучший выбор для Core Web Vitals: на первой загрузке может показаться запасной шрифт,
но шрифт попадёт в кэш, и на следующих страницах он будет сразу.

### 8.3. Ускорить и уменьшить

- **Предзагрузка** важнейшего начертания:
  `<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>`.
  Атрибут `crossorigin` **обязателен** даже для своего домена: шрифты всегда запрашиваются в режиме
  CORS, и без него предзагруженный файл не совпадёт с запросом и скачается дважды.
- **WOFF2** — единственный нужный сегодня формат (сжатие Brotli внутри).
- **Подмножества** (subsetting) и `unicode-range`: браузер скачает файл, только если на странице есть
  символы из диапазона. Кириллица и латиница — отдельными файлами.
- **Вариативный шрифт** (variable font) — один файл вместо четырёх начертаний, если нужно
  больше двух-трёх.
- **Свой хостинг** вместо стороннего CDN: с 2020 года кэш браузеров разделён по сайтам, и «шрифт уже
  в кэше с другого сайта» больше не работает; а лишнее соединение стоит времени.
- **Системный стек** — `font-family: system-ui, sans-serif` — ноль байтов.

### 8.4. Убрать прыжок при замене

Запасной шрифт другой ширины даёт сдвиг раскладки при замене. Дескрипторы `@font-face` подгоняют
метрики запасного шрифта под веб-шрифт:

```css
@font-face {
  font-family: "Inter Fallback";
  src: local("Arial");
  size-adjust: 107%;
  ascent-override: 90%;
  descent-override: 22%;
  line-gap-override: 0%;
}
body { font-family: "Inter", "Inter Fallback", sans-serif; }
```

Значения подбираются под конкретную пару шрифтов (есть генераторы). Подробнее о шрифтах — в курсе
[Типографика](LEARN_CSS_TYPOGRAPHY_COURSE.md).

<details>
<summary>size-adjust: подгонка запасного шрифта</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-performance.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  @font-face { font-family: "Narrow Fallback"; src: local("Arial"), local("Helvetica"); size-adjust: 85%; }
  @font-face { font-family: "Wide Fallback"; src: local("Arial"), local("Helvetica"); size-adjust: 115%; }
  body { font: 16px system-ui, sans-serif; padding: 12px; }
  p { width: 340px; border: 1px solid #aac; padding: 6px; margin: 8px 0; }
  .a { font-family: Arial, Helvetica, sans-serif; }
  .n { font-family: "Narrow Fallback", sans-serif; }
  .w { font-family: "Wide Fallback", sans-serif; }
</style>
</head>
<body>
  <p class="a">Arial как есть: строки ломаются вот здесь, в этом месте текста.</p>
  <p class="n">Arial с size-adjust 85%: строки ломаются вот здесь, в этом месте текста.</p>
  <p class="w">Arial с size-adjust 115%: строки ломаются вот здесь, в этом месте текста.</p>
  <p>Тот же шрифт, иной масштаб глифов: так запасной шрифт подгоняют под ширину веб-шрифта.</p>
</body>
</html>
```

</details>

## 9. Сдвиги раскладки (CLS) — со стороны CSS

Метрика Cumulative Layout Shift наказывает неожиданные смещения видимого содержимого. Источники,
которые решает CSS:

- изображения и видео без размеров — задавайте `width`/`height` в атрибутах (браузер выведет
  `aspect-ratio`) или `aspect-ratio` в CSS;
- замена шрифта — `font-display: optional` или подгонка метрик;
- баннеры, вставляемые сверху, — резервируйте место (`min-height`) или выводите поверх
  (`position: fixed`);
- анимации через `top`/`margin` — сдвигают соседей; `transform` их не сдвигает и в CLS не считается.

## 10. Порядок действий при оптимизации

1. **Измерьте.** Панель Performance, Lighthouse, Web Vitals в реальных данных. Не оптимизируйте
   селекторы, пока профиль не показал долгий Recalculate Style.
2. **Первая отрисовка:** меньше блокирующего CSS, никаких цепочек `@import`, шрифты с
   `preload` и `font-display`.
3. **Длинные страницы:** `content-visibility: auto` для секций ниже первого экрана.
4. **Взаимодействие:** динамические классы — ближе к меняющимся элементам; изолируйте виджеты через
   `contain`; не чередуйте чтение и запись геометрии в JS.
5. **Анимации:** только `transform`/`opacity`, `will-change` — точечно.
6. **DOM:** если элементов десятки тысяч, никакой CSS не спасёт — нужна виртуализация или пагинация.

## Итог

- Конвейер: стиль → раскладка → отрисовка → растеризация → композиция. Изменение запускает свой этап
  и все следующие; цена пропорциональна числу затронутых элементов.
- Селекторы проверяются справа налево и раскладываются по корзинам ключевого селектора; «медленные
  селекторы» редко важны, важны размер DOM и ширина инвалидации.
- Чтение геометрии после записи вызывает принудительную раскладку; чередование — layout thrashing.
- `contain` — обещание, ограничивающее пересчёт; меняет поведение (`fixed`, обрезка).
- `content-visibility: auto` + `contain-intrinsic-size: auto …` пропускает работу для невидимых секций.
- Слой стоит памяти GPU; `will-change` — точечно и временно.
- CSS блокирует отрисовку; `media` с ложным условием — нет. Критический CSS встраивают, остальное
  грузят без блокировки; `@import` создаёт водопад.
- Шрифты узнаются поздно: `preload` с `crossorigin`, WOFF2, `unicode-range`, `font-display`,
  подгонка метрик запасного шрифта.

## Проверьте себя

1. Почему смена класса на `<html>` каждый кадр при прокрутке дорогая, даже если правила простые? Как
   переделать?
2. Чем `[class*="icon-"]` хуже `.icon` с точки зрения сопоставления селекторов?
3. Какие три побочных эффекта даёт `contain: paint` и почему его нельзя ставить на карточку с
   выпадающим меню?
4. Зачем в `contain-intrinsic-size: auto 600px` слово `auto`?
5. Почему `<link rel="preload" as="font">` без `crossorigin` скачивает шрифт дважды?
6. Покажите на временной шкале, почему `@import` в CSS-файле задерживает первую отрисовку.

Дальше: [Метаданные: `<meta>`, `<link>`, соцсети, поисковики](LEARN_HTML_METADATA_COURSE.md).
