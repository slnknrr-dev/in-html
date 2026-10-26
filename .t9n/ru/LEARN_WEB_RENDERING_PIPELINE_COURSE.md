# Как браузер рисует страницу: от байтов до пикселей

> Курс 3 из программы. Для тех, кто прошёл [Документ HTML](LEARN_HTML_DOCUMENT_COURSE.md) и
> [Введение в CSS](LEARN_CSS_INTRODUCTION_COURSE.md). Здесь мы проходим весь конвейер браузера и
> узнаём, какой его этап запускает каждая строчка вашего кода и сколько она стоит.

**Что вы будете понимать после курса**

- этапы конвейера отрисовки: байты → DOM → CSSOM → стили → раскладка → отрисовка → композиция;
- почему CSS **блокирует отрисовку**, а обычный `<script>` **блокирует парсер** и чем помогают
  `defer`, `async`, `type="module"`;
- что такое предварительный сканер и почему «невидимые» ресурсы грузятся поздно;
- чем **перераскладка** (reflow) отличается от **перерисовки** (repaint) и почему `transform`
  дешевле `left`;
- что такое принудительная синхронная раскладка и как её избегать.

---

## 1. Конвейер целиком

Термины ниже общие для Chromium, Gecko и WebKit, хотя внутренние имена у движков разные.

| Этап | Английский | Вход | Выход |
|---|---|---|---|
| 1. Разбор HTML | parsing | байты HTML | **DOM** |
| 2. Разбор CSS | CSS parsing | байты CSS | **CSSOM** — объектная модель таблиц стилей |
| 3. Вычисление стилей | style recalculation | DOM + CSSOM | вычисленные значения для каждого элемента |
| 4. Раскладка | layout (reflow) | стили | геометрия коробок: позиции и размеры |
| 5. Отрисовка | paint | геометрия + стили | списки команд рисования по слоям |
| 6. Композиция | composite | слои | готовый кадр на экране |

Главная мысль курса: **каждый этап зависит от предыдущего**. Изменение на раннем этапе тянет за
собой все поздние. Поменяли класс — пересчитываются стили, и если поменялась геометрия, то раскладка,
отрисовка и композиция. Поменяли только `transform` — достаточно композиции. Отсюда вся
производительность интерфейсов.

## 2. Байты → DOM

Это курс 1 в одной строке: декодирование → токенизация → построение дерева. Важная деталь для этого
курса — парсер HTML работает **потоково** (incrementally): он строит DOM по мере прихода байтов и
не ждёт конца файла. Браузер может показать начало длинной страницы, пока её конец ещё в пути.

Но у потоковости есть враг — то, что может **изменить сам поток**. Это классический `<script>`.

## 3. CSSOM: почему CSS блокирует отрисовку

Таблица стилей превращается в CSSOM. В отличие от HTML, CSS **нельзя применить частично с
пользой**: правило в конце файла может перекрыть правило в начале (каскад, курс 2). Поэтому
браузер не рисует страницу, пока не получит и не разберёт все таблицы, которые к ней относятся.
Это называется **блокировка отрисовки** (render-blocking).

Если бы браузер рисовал до прихода CSS, пользователь увидел бы **FOUC** (flash of unstyled
content) — мелькание голой разметки, которая затем «прыгает» в оформленный вид. Блокировка —
сознательный выбор: лучше подождать, чем показать мусор.

Что блокирует отрисовку:

| Ресурс | Блокирует? |
|---|---|
| `<link rel="stylesheet">` без `media` или с подходящим `media` | да |
| `<link rel="stylesheet" media="print">` на экране | нет (скачивается с низким приоритетом) |
| `<style>` | да, но он уже в документе — ждать сети не нужно |
| `@import` внутри CSS | да, и удлиняет цепочку |
| `<link rel="preload" as="style">` | нет: только скачивает, не применяет |

Следствие: **CSS должен быть маленьким и приходить рано**. Ссылки на таблицы — в `<head>`.

Популярный приём «асинхронной таблицы»:

```html
<link rel="stylesheet" href="later.css" media="print" onload="this.media='all'">
```

Таблица для `print` не блокирует экран; после загрузки `media` переключается, и стили применяются.
Платить за это приходится тем самым FOUC для правил из `later.css`, поэтому туда кладут только то,
что не нужно для первого экрана.

## 4. Скрипты блокируют парсер

### 4.1. Почему

Классический `<script>` без атрибутов может вызвать `document.write()` и вставить в поток новую
разметку. Парсер не знает, сделает ли скрипт так, поэтому обязан **остановиться**: скачать скрипт,
выполнить его и только потом продолжить разбор. Это **блокировка парсера** (parser-blocking).

<details>
<summary>document.write вставляет разметку прямо в поток парсера</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-rendering-pipeline.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font-family: sans-serif; }
  b { color: crimson; }
</style>
</head>
<body>
  <p>Первый абзац из файла.</p>
  <script>
    // Пока скрипт выполняется, парсер стоит; написанное попадает в поток
    // ровно на место скрипта, раньше следующего абзаца из файла
    document.write('<p><b>Абзац, которого нет в файле.</b></p>');
  </script>
  <p>Второй абзац из файла.</p>
</body>
</html>
```

</details>

`document.write` сегодня считается устаревшим приёмом, но сама его возможность заставляет парсер
ждать каждый классический скрипт.

### 4.2. Скрипт ждёт CSS

Ещё одна неочевидная связь: скрипт может спросить стиль (`getComputedStyle(el)`,
`el.offsetWidth`). Чтобы ответ был верным, CSSOM должен быть готов. Поэтому классический скрипт,
стоящий **после** `<link rel="stylesheet">`, не выполнится, пока таблица не загрузится. Медленный
CSS задерживает скрипт, а скрипт — разбор всего, что ниже. Цепочка блокировок:

```text
<link css>  ──(скачивание CSS)──┐
<script>    ─────────ждёт CSS───┴─(выполнение)─┐
<p>…        ───────────────── парсер ждёт ─────┴─ разбор продолжается
```

### 4.3. `defer`, `async`, `type="module"`

| Вариант | Скачивание | Выполнение | Порядок между скриптами | Блокирует парсер |
|---|---|---|---|---|
| `<script src>` | сразу, парсер стоит | сразу после скачивания | по порядку в документе | да |
| `<script defer src>` | параллельно с разбором | после разбора всего HTML, до `DOMContentLoaded` | по порядку | нет |
| `<script async src>` | параллельно | как только скачался | любой | нет (но прерывает разбор на время выполнения) |
| `<script type="module">` | параллельно | как `defer` | по порядку | нет |
| `<script type="module" async>` | параллельно | как `async` | любой | нет |

`defer` и `async` работают только для внешних скриптов (с `src`). Встроенный модуль ведёт себя как
отложенный, а встроенный классический скрипт выполняется сразу.

Правило выбора:

- код, который работает с DOM и зависит от других скриптов, — `defer` или модуль;
- независимый код вроде счётчика статистики — `async`;
- классический скрипт в конце `<body>` — старый способ получить почти то же, что `defer`,
  но скачивание начнётся позже.

<details>
<summary>Блокирующий скрипт не видит то, что ниже него</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-rendering-pipeline.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font-family: sans-serif; }
  pre { background: #f4f4f4; padding: 6px; }
</style>
<script>
  // Классический скрипт в head: парсер дошёл только досюда
  var log = ['в head: body = ' + document.body];
  document.addEventListener('DOMContentLoaded', function () {
    log.push('DOMContentLoaded: абзацев = ' + document.querySelectorAll('p').length);
    document.getElementById('out').textContent = log.join('\n');
  });
</script>
</head>
<body>
  <p>Первый абзац.</p>
  <script>
    // Посередине body: первый абзац уже в дереве, второго ещё нет
    log.push('между абзацами: абзацев = ' + document.querySelectorAll('p').length);
  </script>
  <p>Второй абзац.</p>
  <pre id="out"></pre>
</body>
</html>
```

</details>

### 4.4. Предварительный сканер

Пока парсер стоит на блокирующем скрипте, браузер не бездельничает: **предварительный сканер**
(preload scanner) пробегает остаток HTML и заранее запускает загрузку найденных `src` и `href`.
Поэтому даже блокирующие скрипты подряд скачиваются параллельно.

Но сканер видит только **разметку**. Он не найдёт:

- картинку из CSS (`background-image: url(hero.jpg)`) — она станет известна после вычисления стилей;
- шрифт из `@font-face` — он загружается, только когда текст с этим шрифтом реально понадобился;
- ресурс, который вставляет скрипт.

Для таких случаев есть подсказки:

```html
<link rel="preload" href="hero.jpg" as="image">
<link rel="preload" href="font.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preconnect" href="https://cdn.example">
```

## 5. Вычисление стилей

Для каждого элемента браузер находит подходящие правила (сопоставление селекторов — курс 4),
проводит каскад, применяет наследование и вычисляет значения. На выходе — **вычисленный стиль**
каждого элемента.

Элементы с `display: none` **не получают коробок**: они есть в DOM, но не участвуют в раскладке и
отрисовке. `visibility: hidden` — иначе: коробка есть, место занято, просто ничего не рисуется.

| Способ скрыть | Коробка и место | Отрисовка | Доступен событиям | Видят программы чтения экрана |
|---|---|---|---|---|
| `display: none` | нет | нет | нет | нет |
| `visibility: hidden` | да | нет | нет | нет |
| `opacity: 0` | да | да (прозрачно) | да | да |

<details>
<summary>Три способа скрыть: что остаётся от коробки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-rendering-pipeline.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font-family: sans-serif; }
  .row { display: flex; gap: 6px; margin-bottom: 10px; outline: 1px dashed gray; }
  .row div { width: 70px; height: 40px; background: teal; color: white; padding: 4px; }
  .none div:nth-child(2) { display: none; }
  .vis  div:nth-child(2) { visibility: hidden; }
  .op   div:nth-child(2) { opacity: 0; }
</style>
</head>
<body>
  <p>display: none — место исчезло</p>
  <div class="row none"><div>1</div><div onclick="alert('клик')">2</div><div>3</div></div>
  <p>visibility: hidden — место осталось</p>
  <div class="row vis"><div>1</div><div onclick="alert('клик')">2</div><div>3</div></div>
  <p>opacity: 0 — место осталось, и невидимый блок ловит клик (щёлкните между 1 и 3)</p>
  <div class="row op"><div>1</div><div onclick="alert('клик по невидимому')">2</div><div>3</div></div>
</body>
</html>
```

</details>

## 6. Раскладка

**Раскладка** (layout; в Gecko исторически — reflow) вычисляет геометрию каждой коробки: где она и
какого размера. Это самый «связный» этап: ширина родителя определяет ширину детей, высота детей —
высоту родителя, перенос строки в одном слове может сдвинуть всё, что ниже.

Раскладку запускают изменения, влияющие на геометрию:

- размеры и отступы: `width`, `height`, `margin`, `padding`, `border-width`;
- положение в потоке: `display`, `position`, `float`, `top/left` у позиционированных;
- текст: `font-size`, `font-family`, `line-height`, само содержимое;
- добавление и удаление узлов;
- изменение размера окна.

Браузеры стараются ограничить раскладку **поддеревом**, но многое влияет на соседей и предков.
Свойство `contain: layout` (и `content-visibility`) явно обещает браузеру, что внутренности
элемента не влияют на внешний мир, — подробно в [Производительность CSS](LEARN_CSS_PERFORMANCE_COURSE.md).

## 7. Отрисовка и композиция

**Отрисовка** (paint) превращает коробки в команды рисования: залить фон, нарисовать рамку, текст,
тень. Порядок задаётся правилами наложения (фон блока → потомки → … → позиционированные элементы по
`z-index`; подробно — в [Позиционирование, `z-index` и контекст наложения](LEARN_CSS_POSITIONING_COURSE.md)).

Страница может быть разделена на **слои** (layers). Каждый слой рисуется отдельно, а затем
**композитор** (compositor) складывает их в кадр, обычно на видеокарте и в отдельном потоке.
Свойства, которые меняют только то, *как* слой накладывается, не требуют ни раскладки, ни
перерисовки:

- `transform` (сдвиг, поворот, масштаб);
- `opacity`;
- `filter` — во многих случаях.

Отдельный слой браузер создаёт сам по своим эвристикам: для анимации `transform`/`opacity`, для
`<video>`, `position: fixed` и других случаев. Подсказка `will-change: transform` просит создать
слой заранее. Каждый слой стоит памяти, поэтому `will-change` ставят точечно и лучше на время
анимации, а не «на всё».

## 8. Перераскладка и перерисовка

| Что поменяли | Стили | Раскладка | Отрисовка | Композиция |
|---|---|---|---|---|
| `width`, `margin`, `font-size`, `top` | да | **да** | да | да |
| `color`, `background-color`, `box-shadow`, `outline` | да | нет | **да** | да |
| `transform`, `opacity` (на своём слое) | да | нет | нет | **да** |

Отсюда правило анимаций: **двигайте `transform`, а не `left`/`top`/`margin`**. Анимация `left`
запускает раскладку в каждом кадре; при 60 кадрах в секунду на всё — около 16,7мс, а раскладка
большой страницы легко занимает больше. Анимация `transform` отдаётся композитору и остаётся
плавной, даже когда главный поток занят JavaScript.

<details>
<summary>left против transform под нагрузкой главного потока</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-rendering-pipeline.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font-family: sans-serif; }
  .track { position: relative; height: 44px; margin: 8px 0; background: #eef; }
  .ball { position: absolute; width: 40px; height: 40px; top: 2px; border-radius: 50%; }
  .by-left { background: crimson; animation: byLeft 2s linear infinite alternate; }
  .by-transform { background: seagreen; animation: byTransform 2s linear infinite alternate; }
  @keyframes byLeft { from { left: 0; } to { left: calc(100% - 40px); } }
  @keyframes byTransform { from { transform: translateX(0); } to { transform: translateX(calc(100vw - 80px)); } }
</style>
</head>
<body>
  <p>Нажмите кнопку: главный поток будет занят 2 секунды.
     Красный (left) замрёт, зелёный (transform) обычно продолжит движение.</p>
  <div class="track"><div class="ball by-left"></div></div>
  <div class="track"><div class="ball by-transform"></div></div>
  <button onclick="var t = Date.now(); while (Date.now() - t < 2000) {}">занять поток на 2 с</button>
</body>
</html>
```

</details>

## 9. Принудительная синхронная раскладка

Браузер ленив в хорошем смысле: изменив стиль, вы не запускаете раскладку сразу. Браузер помечает
дерево как «грязное» и выполнит раскладку один раз перед следующим кадром. Десять изменений подряд —
одна раскладка.

Но если после изменения вы **читаете** геометрию (`offsetWidth`, `offsetTop`, `clientHeight`,
`getBoundingClientRect()`, `scrollTop`, `getComputedStyle(el).width`), браузеру некуда деваться: он
обязан выполнить раскладку **прямо сейчас**, чтобы ответ был правдой. Это **принудительная
синхронная раскладка** (forced synchronous layout). Если чтение и запись чередуются в цикле,
получается **пробуксовка раскладки** (layout thrashing): раскладка на каждой итерации.

```js
// Плохо: запись → чтение → запись → чтение… раскладка на каждом шаге
for (const el of items) {
  el.style.width = box.offsetWidth / 2 + 'px';
}

// Хорошо: сначала все чтения, потом все записи
const w = box.offsetWidth / 2;
for (const el of items) {
  el.style.width = w + 'px';
}
```

<details>
<summary>Измеряем пробуксовку раскладки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-rendering-pipeline.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font-family: sans-serif; }
  #list div { height: 2px; background: teal; margin: 1px 0; }
  pre { background: #f4f4f4; padding: 6px; }
</style>
</head>
<body>
  <button id="bad">чтение и запись вперемешку</button>
  <button id="good">сначала чтение, потом запись</button>
  <pre id="out">Нажмите кнопки и сравните время.</pre>
  <div id="list"></div>
  <script>
    var list = document.getElementById('list');
    for (var i = 0; i < 1500; i++) list.appendChild(document.createElement('div'));
    var items = list.children, out = document.getElementById('out');
    function run(name, fn) {
      var t = performance.now();
      fn();
      out.textContent = name + ': ' + (performance.now() - t).toFixed(1) + ' мс';
    }
    document.getElementById('bad').onclick = function () {
      run('вперемешку', function () {
        for (var i = 0; i < items.length; i++) {
          // Чтение offsetWidth после записи заставляет пересчитать раскладку
          items[i].style.width = (list.offsetWidth / 2 + (i % 7)) + 'px';
        }
      });
    };
    document.getElementById('good').onclick = function () {
      run('пакетно', function () {
        var w = list.offsetWidth / 2;
        for (var i = 0; i < items.length; i++) items[i].style.width = (w + (i % 7)) + 'px';
      });
    };
  </script>
</body>
</html>
```

</details>

## 10. Кадр и `requestAnimationFrame`

Браузер обновляет экран кадрами (обычно 60 раз в секунду, на быстрых экранах — 120 и больше).
Упрощённо один кадр в главном потоке выглядит так:

```text
задачи JS → requestAnimationFrame-колбэки → стили → раскладка → отрисовка → (композитор) → кадр
```

`requestAnimationFrame(fn)` вызывает `fn` непосредственно перед вычислением стилей следующего
кадра. Это правильное место для визуальных изменений: они попадут ровно в кадр, а не будут
выполнены «между» кадрами впустую.

Типичный приём — **запустить CSS-переход у только что вставленного элемента**. Если вставить элемент
и сразу поменять класс, браузер увидит лишь конечное состояние: начального стиля никогда не было
вычислено, переходить не от чего.

<details>
<summary>Переход не запускается без промежуточного вычисления стилей</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-rendering-pipeline.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font-family: sans-serif; }
  .box { width: 80px; height: 30px; margin: 6px 0; background: teal;
         opacity: 0; transform: translateX(0); transition: 0.8s; }
  .box.on { opacity: 1; transform: translateX(200px); }
</style>
</head>
<body>
  <button id="a">сразу добавить класс</button>
  <button id="b">через requestAnimationFrame</button>
  <div id="host"></div>
  <script>
    var host = document.getElementById('host');
    function make() { var d = document.createElement('div'); d.className = 'box'; host.appendChild(d); return d; }
    document.getElementById('a').onclick = function () {
      // Стили ещё не вычислялись: браузер видит сразу конечное состояние, перехода нет
      make().classList.add('on');
    };
    document.getElementById('b').onclick = function () {
      var d = make();
      // Двойной rAF: первый кадр фиксирует начальный стиль, во втором меняем класс
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { d.classList.add('on'); });
      });
    };
  </script>
</body>
</html>
```

</details>

Ещё один известный способ — прочитать `d.offsetWidth` между вставкой и сменой класса. Это та самая
принудительная раскладка, только использованная намеренно: она заодно вычисляет стили, и начальное
состояние фиксируется. Работает, но стоит раскладки.

## 11. Сводка: как писать с учётом конвейера

| Задача | Решение | Почему |
|---|---|---|
| быстрый первый экран | маленький CSS в `<head>`, критическое — в `<style>` | CSS блокирует отрисовку |
| скрипты | `defer` или `type="module"` | не блокируют парсер, сохраняют порядок |
| картинки и шрифты из CSS | `<link rel="preload">` | предварительный сканер их не видит |
| анимация движения | `transform`, `opacity` | только композиция |
| массовые изменения DOM | сначала читать, потом писать; `requestAnimationFrame` | одна раскладка вместо многих |
| длинная страница | `content-visibility: auto` | раскладка и отрисовка невидимого откладываются |

Посмотреть всё это вживую можно во вкладке Performance инструментов разработчика: там видны
блоки «Recalculate Style», «Layout», «Paint» и предупреждения о принудительной раскладке.

## Итог

- Конвейер: DOM → CSSOM → стили → раскладка → отрисовка → композиция. Изменение раннего этапа
  тянет за собой все поздние.
- CSS **блокирует отрисовку** (чтобы не было FOUC) и задерживает классические скрипты после себя.
- Классический `<script>` **блокирует парсер**; `defer` и модули — нет, и сохраняют порядок; `async`
  выполняется как придётся.
- Предварительный сканер видит только разметку; для ресурсов из CSS есть `preload`.
- Геометрия → **раскладка**; цвет → **перерисовка**; `transform`/`opacity` → только **композиция**.
- Чтение геометрии после записи вызывает **принудительную синхронную раскладку**; группируйте чтения
  и записи.

## Проверьте себя

1. Почему браузер ждёт CSS, прежде чем рисовать, но не ждёт картинок?
2. В `<head>` стоят `<link rel="stylesheet" href="slow.css">` и затем `<script>alert(1)</script>`.
   Когда появится `alert` и почему?
3. Чем `defer` отличается от `async` для двух скриптов, где второй использует функцию из первого?
4. Какие этапы конвейера запустит смена `background-color`? А смена `padding`?
5. Почему в цикле `el.style.height = el.offsetHeight + 10 + 'px'` для тысячи элементов работает
   медленно и как его переписать?

Дальше: [Селекторы CSS](LEARN_CSS_SELECTORS_COURSE.md).
