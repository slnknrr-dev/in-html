# Производительность JavaScript в браузере

> Курс 38 из программы. Для тех, кто уже уверенно пишет обработчики событий и меняет DOM
> (курсы [DOM](LEARN_JAVASCRIPT_DOM_COURSE.md) и [События](LEARN_JAVASCRIPT_EVENTS_COURSE.md)) и
> знает, как браузер превращает дерево в пиксели
> ([конвейер отрисовки](LEARN_WEB_RENDERING_PIPELINE_COURSE.md)). Здесь мы учимся не «ускорять
> код вообще», а понимать, **где именно** браузер тратит время и почему ваш скрипт ему мешает.

**Что вы будете понимать после курса**

- что такое главный поток (main thread) и почему любой долгий скрипт «замораживает» страницу;
- что такое **принудительная синхронная раскладка** (forced synchronous layout) и «дребезг
  раскладки» (layout thrashing), какие свойства её вызывают и как группировать чтения и записи;
- как работает `requestAnimationFrame` и чем он лучше `setTimeout` для анимации;
- что такое длинные задачи (long tasks) и метрика INP (Interaction to Next Paint), как дробить работу;
- `debounce` и `throttle`: когда какой, и почему часто нужен ни тот ни другой;
- пассивные обработчики (passive listeners) и почему прокрутка не должна ждать скрипт;
- `IntersectionObserver` и `ResizeObserver` вместо обработчиков `scroll` и `resize`;
- когда выносить работу в Web Worker;
- откуда берутся утечки памяти: отсоединённые узлы (detached nodes), забытые обработчики, замыкания;
- как измерять: `performance.now()`, `PerformanceObserver`, User Timing, панель Performance в DevTools.

---

## 1. Один поток на всё

У каждой вкладки есть **главный поток** (main thread). На нём выполняются почти все важные дела:

| Работа | Где выполняется |
|---|---|
| ваш JavaScript (обработчики, таймеры, промисы) | главный поток |
| вычисление стилей (style recalc) | главный поток |
| раскладка (layout) | главный поток |
| отрисовка в списки команд (paint) | главный поток |
| композиция слоёв, растеризация | поток композитора и GPU |
| прокрутка без JS-обработчиков | может идти на потоке композитора |

Главный поток работает по **циклу событий** (event loop): берёт задачу (task) из очереди,
выполняет её **до конца**, выполняет все микрозадачи (microtasks: промисы, `queueMicrotask`),
и — если пора — даёт браузеру нарисовать кадр. Пока ваша задача работает, браузер **не может**
ни отреагировать на клик, ни нарисовать кадр. Отсюда главное правило курса:

> Производительность в браузере — это прежде всего **короткие задачи** и **отсутствие лишней
> работы для движка отрисовки**, а не быстрые циклы.

При частоте экрана 60 Гц на кадр приходится ≈ 16,7 мс, и в них должен уложиться и ваш скрипт, и
стиль, и раскладка, и отрисовка. На экранах 120 Гц — уже ≈ 8,3 мс.

<details>
<summary>Долгая задача замораживает страницу</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-performance.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px system-ui, sans-serif; padding: 16px; }
  .spin { width: 40px; height: 40px; border: 6px solid #cbd5e1; border-top-color: #2563eb;
          border-radius: 50%; animation: s 1s linear infinite; display: inline-block; }
  .bar { width: 40px; height: 40px; background: #16a34a; display: inline-block; margin-left: 16px; }
  @keyframes s { to { transform: rotate(1turn); } }
  button { font: inherit; margin: 12px 8px 0 0; }
</style>
</head>
<body>
  <div class="spin"></div><div class="bar" id="bar"></div>
  <p>Синее колесо крутится через композитор (transform), зелёный квадрат двигает JavaScript.</p>
  <button id="block">Занять главный поток на 2 с</button>
  <p id="out"></p>
  <script>
    // Квадрат двигается каждым кадром из JS
    const bar = document.getElementById('bar');
    function tick(t) {
      bar.style.transform = 'translateX(' + (Math.sin(t / 300) * 60 + 60) + 'px)';
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    document.getElementById('block').onclick = () => {
      const end = performance.now() + 2000;
      while (performance.now() < end) {} // занятый цикл
      document.getElementById('out').textContent = 'Готово. Квадрат стоял, колесо, скорее всего, нет.';
    };
  </script>
</body>
</html>
```

</details>

Нажмите кнопку: квадрат замирает на 2 секунды, кнопка не «отжимается», текст не выделяется. А вот
CSS-анимация `transform` в Chrome и Firefox обычно продолжает крутиться — она выполняется на потоке
композитора. Это первый практический вывод: **анимируйте `transform` и `opacity`**, их можно
продолжать без главного потока (подробно — в [Производительности CSS](LEARN_CSS_PERFORMANCE_COURSE.md)).

## 2. Раскладка по требованию и её дребезг

### 2.1. Браузер ленив — и это хорошо

Когда вы пишете `el.style.width = '200px'`, браузер **ничего не пересчитывает сразу**. Он
помечает дерево как «грязное» (dirty) и откладывает стиль и раскладку до ближайшего кадра. Сто
записей подряд — одна раскладка.

Но если после записи вы **читаете** геометрию, браузер обязан ответить точно — и ему приходится
пересчитать стиль и раскладку **прямо сейчас, синхронно**, внутри вашего скрипта. Это и есть
принудительная синхронная раскладка (forced synchronous layout, forced reflow).

```js
el.style.width = '200px';    // запись: дерево «грязное»
const h = el.offsetHeight;   // чтение: браузер вынужден сделать layout сейчас
```

Одна такая пара — не беда. Беда — **чередование** в цикле: запись, чтение, запись, чтение… Каждое
чтение снова запускает раскладку. Это называется layout thrashing — «дребезг раскладки».

### 2.2. Какие свойства и методы заставляют считать раскладку

Неполный, но практически достаточный список (Пол Айриш поддерживает известный перечень
«What forces layout/reflow»):

| Группа | Примеры |
|---|---|
| размеры и смещения элемента | `offsetWidth/Height/Top/Left`, `offsetParent` |
| клиентская область | `clientWidth/Height/Top/Left` |
| прокрутка | `scrollWidth/Height`, `scrollTop/Left` (чтение), `scrollIntoView()`, `scrollTo()` |
| геометрия | `getBoundingClientRect()`, `getClientRects()` |
| вычисленный стиль | `getComputedStyle(el).width` и другие свойства, зависящие от раскладки |
| окно | `innerWidth/Height`, `scrollX/Y` (в части движков) |
| текст | `innerText` (зависит от отрисовки, `textContent` — нет), `focus()` |
| выделение и диапазоны | `Range.getBoundingClientRect()`, `elementFromPoint()` |

Заметьте: `getComputedStyle(el).color` требует только пересчёта **стиля**, а `.width` — ещё и
раскладки. Стоимость зависит от того, что именно спросить.

### 2.3. Лечение: сначала все чтения, потом все записи

```js
// Плохо: N раскладок
for (const el of items) {
  el.style.width = el.parentNode.offsetWidth / 2 + 'px';
}

// Хорошо: одна раскладка
const widths = items.map(el => el.parentNode.offsetWidth); // все чтения
items.forEach((el, i) => { el.style.width = widths[i] / 2 + 'px'; }); // все записи
```

Варианты, когда код разбросан по модулям и вручную не сгруппировать:

1. **Фазы кадра.** Все записи выполнять в `requestAnimationFrame`, а чтения — сразу (тогда
   данные берутся с прошлой раскладки). Так устроены библиотеки вроде fastdom.
2. **Кэшировать геометрию.** Если размер меняется только при `resize`, держите его в переменной,
   обновляемой `ResizeObserver` (раздел 6).
3. **Не читать вовсе.** Часто то, что вы считаете в JS, можно выразить в CSS: `width: 50%`,
   `calc()`, контейнерные запросы.

<details>
<summary>Дребезг раскладки: замер двух вариантов</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-performance.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  #box { display: grid; grid-template-columns: repeat(20, 1fr); gap: 2px; margin: 12px 0; }
  #box div { height: 8px; background: #93c5fd; }
  button { font: inherit; margin-right: 8px; }
  output { display: block; margin-top: 8px; font-family: ui-monospace, monospace; }
</style>
</head>
<body>
  <button id="bad">Чередовать чтение и запись</button>
  <button id="good">Сначала читать, потом писать</button>
  <output id="out">Нажмите кнопку</output>
  <div id="box"></div>
  <script>
    const box = document.getElementById('box');
    for (let i = 0; i < 2000; i++) box.append(document.createElement('div'));
    const cells = [...box.children];
    const out = document.getElementById('out');
    function run(label, fn) {
      const t0 = performance.now();
      fn();
      out.textContent = label + ': ' + (performance.now() - t0).toFixed(1) + ' мс';
    }
    document.getElementById('bad').onclick = () => run('Чередование', () => {
      for (const c of cells) {
        c.style.height = (c.offsetWidth % 7 + 6) + 'px'; // чтение после записи
      }
    });
    document.getElementById('good').onclick = () => run('Группировка', () => {
      const w = cells.map(c => c.offsetWidth);
      cells.forEach((c, i) => { c.style.height = (w[i] % 7 + 6) + 'px'; });
    });
  </script>
</body>
</html>
```

</details>

Разница обычно в десятки и сотни раз: в первом варианте каждая запись высоты делает дерево
грязным, и каждое следующее `offsetWidth` пересчитывает раскладку всей сетки.

## 3. `requestAnimationFrame`: работать в ритме экрана

### 3.1. Где rAF стоит в кадре

Упрощённо один кадр в Chromium выглядит так:

1. задачи ввода (клики, `pointermove`, `wheel` — ввод обычно выравнивается по кадрам);
2. **колбэки `requestAnimationFrame`**;
3. пересчёт стилей → раскладка → отрисовка;
4. композиция и вывод на экран.

`requestAnimationFrame(cb)` гарантирует: `cb` выполнится **перед следующей отрисовкой**, ровно один
раз, с аргументом-временем (`DOMHighResTimeStamp`, то же начало отсчёта, что у
`performance.now()`). В фоновой вкладке колбэки приостанавливаются — анимация не жжёт батарею.

### 3.2. Почему не `setTimeout(fn, 16)`

| | `setTimeout(fn, 16)` | `requestAnimationFrame(fn)` |
|---|---|---|
| синхронизация с экраном | нет: «плывёт» относительно vsync | да |
| экран 120 Гц | всё равно ~60 обновлений | 120 обновлений |
| фоновая вкладка | минимум 1 с между вызовами (троттлинг) | остановлен |
| результат | пропущенные или двойные кадры, рывки | ровно одно обновление на кадр |

### 3.3. Анимация от времени, а не от количества кадров

```js
let start;
function frame(t) {
  start ??= t;
  const p = Math.min((t - start) / 1000, 1); // прогресс 0..1 за 1 секунду
  el.style.transform = `translateX(${p * 300}px)`;
  if (p < 1) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

Если прибавлять «по 5 px за кадр», на 120-герцовом экране анимация пойдёт вдвое быстрее, а при
пропусках кадров — замедлится. От времени — одинаково везде.

### 3.4. rAF как «склейка» частых событий

`pointermove` или `scroll` могут прийти несколько раз до кадра. Рисовать чаще экрана бессмысленно:

```js
let pending = false, lastX = 0;
addEventListener('pointermove', e => {
  lastX = e.clientX;                 // только запоминаем
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {      // рисуем не чаще раза за кадр
    pending = false;
    dot.style.transform = `translateX(${lastX}px)`;
  });
});
```

<details>
<summary>Анимация от времени: rAF против setInterval</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-performance.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  .track { position: relative; height: 32px; background: #f1f5f9; margin: 8px 0 16px; border-radius: 6px; }
  .dot { position: absolute; left: 0; top: 4px; width: 24px; height: 24px; border-radius: 50%; }
  #a { background: #2563eb; } #b { background: #dc2626; }
</style>
</head>
<body>
  <div>requestAnimationFrame, позиция от времени</div>
  <div class="track"><div class="dot" id="a"></div></div>
  <div>setInterval(16 мс), «по шагу за вызов»</div>
  <div class="track"><div class="dot" id="b"></div></div>
  <p>На экране с частотой выше 60 Гц разница в плавности видна сразу.</p>
  <script>
    const a = document.getElementById('a'), b = document.getElementById('b');
    const W = () => a.parentNode.clientWidth - 24;
    const w = W(); // ширину читаем один раз, а не каждый кадр
    function frame(t) {
      const p = (t / 2000) % 2;              // туда и обратно за 4 с
      const x = (p < 1 ? p : 2 - p) * w;
      a.style.transform = 'translateX(' + x + 'px)';
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    let x = 0, dir = 1;
    setInterval(() => {
      x += dir * w / 125;                    // «шаг за вызов»
      if (x > w || x < 0) { dir = -dir; x = Math.max(0, Math.min(w, x)); }
      b.style.transform = 'translateX(' + x + 'px)';
    }, 16);
  </script>
</body>
</html>
```

</details>

## 4. Длинные задачи и INP

### 4.1. Определения

- **Длинная задача** (long task) — задача главного потока дольше **50 мс**. Почему 50: модель RAIL
  требует ответить на ввод за 100 мс, и если задачи не длиннее 50 мс, любой ввод дождётся
  своей очереди не позже чем через 50 мс.
- **INP** (Interaction to Next Paint) — метрика Core Web Vitals (с марта 2024 года заменила FID).
  Для каждого взаимодействия (клик, тап, нажатие клавиши; прокрутка и наведение не считаются)
  измеряется время от ввода **до следующей отрисовки**, и берётся почти худшее значение за визит.
  «Хорошо» — до 200 мс, «плохо» — больше 500 мс.

Задержка взаимодействия складывается из трёх частей:

| Часть | Что это | Как уменьшить |
|---|---|---|
| input delay | ввод ждёт, пока закончится чужая задача | дробить длинные задачи |
| processing time | ваши обработчики | делать в обработчике минимум |
| presentation delay | стиль, раскладка, отрисовка после обработчика | меньше DOM-изменений, `content-visibility` |

### 4.2. Уступать главный поток (yielding)

Большую работу режут на куски и между кусками **отдают управление** браузеру, чтобы он успел
обработать ввод и нарисовать кадр.

```js
// Универсальный способ: новая задача через setTimeout
const yieldToMain = () => new Promise(r => setTimeout(r, 0));

// Новый способ (Chromium 129+, поддержка в других движках появляется): продолжение сохраняет приоритет
const yieldNow = () =>
  globalThis.scheduler?.yield ? scheduler.yield() : yieldToMain();

async function processAll(items) {
  let last = performance.now();
  for (const item of items) {
    process(item);
    if (performance.now() - last > 40) { // уступаем примерно каждые 40 мс
      await yieldNow();
      last = performance.now();
    }
  }
}
```

Почему не `await Promise.resolve()`: это **микрозадача**, она выполняется до того, как браузер
получит шанс что-либо сделать. Уступить можно только новой **задачей** (`setTimeout`,
`MessageChannel`) или `scheduler.yield()`.

### 4.3. Сначала отклик, потом работа

Пользователь нажал кнопку — сначала покажите, что нажатие принято, а тяжёлое отложите:

```js
button.addEventListener('click', async () => {
  button.classList.add('busy');   // мгновенная обратная связь
  await yieldNow();               // дать браузеру нарисовать её
  heavyWork();
});
```

<details>
<summary>Дробление работы: страница остаётся живой</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-performance.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  button { font: inherit; margin: 0 8px 8px 0; }
  progress { width: 100%; height: 16px; }
  #counter { font: 24px ui-monospace, monospace; }
</style>
</head>
<body>
  <button id="one">Одна задача на 3 с</button>
  <button id="chunks">То же, кусками</button>
  <progress id="p" max="1" value="0"></progress>
  <p>Пока идёт работа, нажимайте эту кнопку:
     <button id="click">+1</button> <span id="counter">0</span></p>
  <script>
    const p = document.getElementById('p');
    let n = 0;
    document.getElementById('click').onclick = () => {
      document.getElementById('counter').textContent = ++n;
    };
    const step = () => { const e = performance.now() + 1; while (performance.now() < e) {} };
    const yieldNow = () => (window.scheduler && scheduler.yield)
      ? scheduler.yield() : new Promise(r => setTimeout(r, 0));
    document.getElementById('one').onclick = () => {
      for (let i = 0; i < 3000; i++) step();   // 3000 шагов по 1 мс
      p.value = 1;
    };
    document.getElementById('chunks').onclick = async () => {
      let last = performance.now();
      for (let i = 0; i < 3000; i++) {
        step();
        if (performance.now() - last > 30) {
          p.value = i / 3000;
          await yieldNow();
          last = performance.now();
        }
      }
      p.value = 1;
    };
  </script>
</body>
</html>
```

</details>

В первом случае счётчик «прыгает» только после окончания работы, во втором — растёт сразу, а
полоска прогресса движется. Общее время во втором случае чуть больше, но страница отзывчива.

## 5. `debounce`, `throttle` и пассивные обработчики

### 5.1. Два способа проредить события

| | debounce («устранение дребезга») | throttle («дроссель») |
|---|---|---|
| когда вызывает | через `wait` мс **после последнего** события | не чаще раза в `wait` мс |
| пока события идут | молчит | вызывает регулярно |
| типичное применение | поиск по мере ввода, сохранение черновика, валидация | позиция при перетаскивании, прогресс прокрутки |

```js
function debounce(fn, wait) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

function throttle(fn, wait) {
  let last = 0, t;
  return function (...args) {
    const now = performance.now();
    const rest = wait - (now - last);
    clearTimeout(t);
    if (rest <= 0) { last = now; fn.apply(this, args); }
    else t = setTimeout(() => { last = performance.now(); fn.apply(this, args); }, rest);
  };
}
```

Throttle выше вызывает функцию ещё раз в конце серии — иначе последнее положение потеряется.
Для визуальных обновлений обычно лучше не throttle по времени, а **склейка через rAF** (раздел
3.4): она точно совпадает с кадрами.

<details>
<summary>Сырые события, debounce и throttle</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-performance.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  #pad { height: 120px; background: #f1f5f9; border: 2px dashed #94a3b8; border-radius: 8px;
         display: grid; place-items: center; color: #475569; user-select: none; }
  table { border-collapse: collapse; margin-top: 12px; }
  td { padding: 4px 12px; border-bottom: 1px solid #e2e8f0; font-family: ui-monospace, monospace; }
</style>
</head>
<body>
  <div id="pad">Водите курсором (или пальцем) по этой области</div>
  <table>
    <tr><td>сырые pointermove</td><td id="raw">0</td></tr>
    <tr><td>throttle 200 мс</td><td id="thr">0</td></tr>
    <tr><td>debounce 300 мс</td><td id="deb">0</td></tr>
  </table>
  <script>
    const c = { raw: 0, thr: 0, deb: 0 };
    const show = k => document.getElementById(k).textContent = ++c[k];
    function debounce(fn, w) { let t; return () => { clearTimeout(t); t = setTimeout(fn, w); }; }
    function throttle(fn, w) {
      let last = 0, t;
      return () => {
        const rest = w - (performance.now() - last);
        clearTimeout(t);
        if (rest <= 0) { last = performance.now(); fn(); }
        else t = setTimeout(() => { last = performance.now(); fn(); }, rest);
      };
    }
    const thr = throttle(() => show('thr'), 200);
    const deb = debounce(() => show('deb'), 300);
    document.getElementById('pad').addEventListener('pointermove', () => {
      show('raw'); thr(); deb();
    });
  </script>
</body>
</html>
```

</details>

### 5.2. Пассивные обработчики

Обработчик `touchstart`, `touchmove` или `wheel` может вызвать `preventDefault()` и отменить
прокрутку. Значит, браузер, увидев такой обработчик, **обязан дождаться** его выполнения, прежде
чем прокрутить — а главный поток может быть занят. Отсюда «залипающая» прокрутка.

Флаг `{ passive: true }` — обещание: «я не буду отменять действие по умолчанию». Тогда прокрутка
идёт на композиторе сразу, а обработчик выполняется параллельно.

```js
addEventListener('touchmove', onMove, { passive: true });
```

С 2017 года Chrome (и затем Firefox и Safari) **по умолчанию** делает пассивными `touchstart`,
`touchmove`, `wheel` и `mousewheel`, если они повешены на `window`, `document` или `body`.
Вызов `preventDefault()` в таком обработчике игнорируется с предупреждением в консоли. Если вам
действительно нужно отменять прокрутку — пишите `{ passive: false }` явно и вешайте обработчик
на **конкретный элемент**, а лучше используйте CSS `touch-action` и `overscroll-behavior` (курс
[Сенсорный ввод](LEARN_WEB_TOUCH_INPUT_COURSE.md)).

## 6. Наблюдатели вместо `scroll` и `resize`

### 6.1. Чем плох обработчик `scroll`

Классический ленивый загрузчик:

```js
addEventListener('scroll', () => {
  for (const img of imgs) {
    if (img.getBoundingClientRect().top < innerHeight) load(img); // раскладка на каждое событие
  }
});
```

Проблемы: событие приходит много раз за кадр (в современных браузерах — не чаще кадра, но всё
равно каждый кадр), каждое `getBoundingClientRect()` может вызвать раскладку, и всё это — на
главном потоке во время прокрутки.

### 6.2. `IntersectionObserver`

Браузер **сам** вычисляет пересечения элементов с областью видимости в рамках своего кадра (после
раскладки, без принудительных пересчётов) и вызывает колбэк только при **пересечении порогов**.

```js
const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (e.isIntersecting) { load(e.target); io.unobserve(e.target); }
  }
}, { rootMargin: '200px 0px', threshold: 0 }); // начинать за 200 px до появления
imgs.forEach(img => io.observe(img));
```

Для изображений есть и встроенное решение — `loading="lazy"` (курс
[Медиа](LEARN_HTML_MEDIA_COURSE.md)); `IntersectionObserver` нужен для всего остального:
бесконечные списки, анимации при появлении, учёт показов, «прилипающие» заголовки.

<details>
<summary>IntersectionObserver: карточки проявляются при прокрутке</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-performance.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; margin: 0; }
  header { position: sticky; top: 0; background: #1e293b; color: #fff; padding: 8px 16px; }
  .card { margin: 24px 16px; height: 120px; border-radius: 10px; background: #e2e8f0;
          display: grid; place-items: center; font-size: 20px;
          opacity: 0.15; transform: translateY(24px); transition: opacity .5s, transform .5s; }
  .card.seen { opacity: 1; transform: none; background: #bfdbfe; }
</style>
</head>
<body>
  <header>Прокручивайте вниз. Видно сейчас: <span id="n">0</span></header>
  <div id="list"></div>
  <script>
    const list = document.getElementById('list');
    for (let i = 1; i <= 30; i++) {
      const d = document.createElement('div');
      d.className = 'card'; d.textContent = 'Карточка ' + i;
      list.append(d);
    }
    const visible = new Set();
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add('seen'); visible.add(e.target); }
        else visible.delete(e.target);
      }
      document.getElementById('n').textContent = visible.size;
    }, { threshold: 0.5 }); // «видна», если показана хотя бы половина
    list.querySelectorAll('.card').forEach(c => io.observe(c));
  </script>
</body>
</html>
```

</details>

### 6.3. `ResizeObserver`

`resize` на `window` знает только размер окна. А элементу важен **его собственный** размер,
который меняется и от окна, и от соседей, и от содержимого. `ResizeObserver` сообщает об
изменении размеров конкретных элементов; колбэки вызываются после раскладки, перед отрисовкой, и
размеры уже есть в `entry.contentBoxSize` / `borderBoxSize` — читать `offsetWidth` не нужно.

```js
const ro = new ResizeObserver(entries => {
  for (const e of entries) {
    const { inlineSize } = e.contentBoxSize[0];
    e.target.classList.toggle('narrow', inlineSize < 400);
  }
});
ro.observe(panel);
```

Ловушка: если в колбэке изменить размер наблюдаемого элемента, браузер повторит цикл, а при
зацикливании выдаст ошибку «ResizeObserver loop completed with undelivered notifications». Часто
вместо `ResizeObserver` достаточно контейнерных запросов CSS (курс
[Адаптивность](LEARN_CSS_RESPONSIVE_COURSE.md)).

<details>
<summary>ResizeObserver: элемент знает свою ширину</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-performance.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  #panel { resize: horizontal; overflow: auto; width: 480px; min-width: 160px; max-width: 100%;
           border: 2px solid #2563eb; border-radius: 8px; padding: 12px; }
  #panel.narrow { border-color: #dc2626; background: #fef2f2; }
  output { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
  <p>Потяните за правый нижний угол рамки.</p>
  <div id="panel">Ширина содержимого: <output id="w"></output> px</div>
  <script>
    const panel = document.getElementById('panel');
    new ResizeObserver(([e]) => {
      const w = Math.round(e.contentBoxSize[0].inlineSize);
      document.getElementById('w').textContent = w;
      panel.classList.toggle('narrow', w < 300); // меняем цвет, а не размер: без зацикливания
    }).observe(panel);
  </script>
</body>
</html>
```

</details>

## 7. Web Workers: другой поток

Если работа **вычислительная** (разбор большого JSON, сжатие, поиск, обработка изображения) и не
трогает DOM — её можно унести в Web Worker. У воркера свой поток, свой цикл событий, свой
глобальный объект; DOM ему недоступен.

```js
const worker = new Worker('worker.js', { type: 'module' });
worker.postMessage({ numbers });
worker.onmessage = e => show(e.data);
```

Цена: данные передаются **структурным клонированием** (structured clone) — копия, а копирование
большого объекта само занимает время на главном потоке. Для больших бинарных данных используйте
**передачу владения** (transfer): `postMessage(buf, [buf])` — `ArrayBuffer` переходит в воркер
без копирования, а в исходном потоке становится пустым (detached).

| Подходит воркеру | Не подходит |
|---|---|
| CPU-тяжёлые чистые вычисления | работа с DOM |
| декодирование, парсинг, шифрование | задачи на 1–2 мс (накладные расходы больше) |
| рисование в `OffscreenCanvas` | то, что упирается в раскладку и стили |

<details>
<summary>Тяжёлый расчёт в воркере из строки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-performance.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  .spin { width: 32px; height: 32px; background: #2563eb; display: inline-block; vertical-align: middle; }
  button { font: inherit; margin: 8px 8px 8px 0; }
  output { display: block; font-family: ui-monospace, monospace; }
</style>
</head>
<body>
  <div class="spin" id="sq"></div> квадрат вращается из JavaScript
  <br>
  <button id="main">Посчитать простые на главном потоке</button>
  <button id="wk">Посчитать в воркере</button>
  <output id="out"></output>
  <script>
    const sq = document.getElementById('sq');
    (function loop(t) { sq.style.transform = 'rotate(' + t / 5 + 'deg)'; requestAnimationFrame(loop); })(0);
    // Функция считает количество простых чисел до n
    const code = 'function count(n){let c=0;for(let i=2;i<n;i++){let p=1;' +
                 'for(let j=2;j*j<=i;j++)if(i%j===0){p=0;break}c+=p}return c}';
    const N = 6e6;
    const out = document.getElementById('out');
    document.getElementById('main').onclick = () => {
      const count = new Function(code + ';return count')();
      const t = performance.now();
      out.textContent = 'Главный поток: ' + count(N) + ' за ' + Math.round(performance.now() - t) + ' мс';
    };
    // Воркер создаём из Blob, чтобы пример был в одном файле
    const url = URL.createObjectURL(new Blob([code +
      ';onmessage=e=>{const t=performance.now();postMessage([count(e.data),performance.now()-t])}'],
      { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = e => out.textContent = 'Воркер: ' + e.data[0] + ' за ' + Math.round(e.data[1]) + ' мс';
    document.getElementById('wk').onclick = () => { out.textContent = 'Считаю…'; w.postMessage(N); };
  </script>
</body>
</html>
```

</details>

## 8. Утечки памяти

Сборщик мусора (garbage collector) освобождает объект, когда до него **нельзя дойти** по ссылкам
от корней (глобальный объект, стек, активные обработчики, таймеры). Утечка — это объект, который
вам больше не нужен, но ссылка на него осталась.

### 8.1. Типичные источники

| Источник | Как выглядит | Лечение |
|---|---|---|
| отсоединённые узлы (detached nodes) | элемент удалён из DOM, но на него ссылается массив или кэш | очищать ссылки, `WeakMap`/`WeakRef` для кэшей |
| забытые обработчики | `window.addEventListener('resize', this.onResize)` у компонента, который удалён | `removeEventListener` или `AbortController` |
| таймеры | `setInterval` с замыканием на большие данные | `clearInterval` при размонтировании |
| наблюдатели | `IntersectionObserver` наблюдает удалённые узлы | `disconnect()` |
| замыкания | обработчик держит в области видимости огромный массив | не захватывать лишнего |
| глобальные кэши | `Map` по id без ограничения роста | ограничить размер, `WeakMap` по объекту |

Отсоединённый узел опасен вдвойне: он держит **всё своё поддерево** (каждый узел знает родителя и
детей), а через свойства и замыкания — данные.

### 8.2. `AbortController` — один выключатель на все обработчики

```js
class Widget {
  constructor(el) {
    this.ac = new AbortController();
    const { signal } = this.ac;
    window.addEventListener('resize', () => this.layout(), { signal });
    document.addEventListener('keydown', e => this.key(e), { signal });
  }
  destroy() { this.ac.abort(); } // все обработчики сняты разом
}
```

### 8.3. `WeakMap` для данных «при элементе»

```js
const meta = new WeakMap();
meta.set(el, { clicks: 0 }); // запись исчезнет вместе с el, ключ не держит элемент
```

<details>
<summary>Утечка через отсоединённые узлы</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-performance.html#example-9">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  button { font: inherit; margin: 0 8px 8px 0; }
  #host div { display: inline-block; width: 8px; height: 8px; margin: 1px; background: #a5b4fc; }
  output { display: block; font-family: ui-monospace, monospace; margin: 8px 0; }
</style>
</head>
<body>
  <button id="leak">Создать и удалить 5000 узлов (с утечкой)</button>
  <button id="ok">То же без утечки</button>
  <button id="free">Очистить кэш</button>
  <output id="out"></output>
  <div id="host"></div>
  <p>Откройте DevTools → Memory → Heap snapshot и поищите «Detached» в фильтре.</p>
  <script>
    const host = document.getElementById('host');
    const cache = [];                       // «кэш», который никто не чистит
    const out = document.getElementById('out');
    function make(keep) {
      for (let i = 0; i < 5000; i++) {
        const d = document.createElement('div');
        host.append(d);
        if (keep) cache.push(d);
      }
      host.replaceChildren();              // узлы ушли из документа
      out.textContent = 'Удерживается отсоединённых узлов: ' + cache.length;
    }
    document.getElementById('leak').onclick = () => make(true);
    document.getElementById('ok').onclick = () => make(false);
    document.getElementById('free').onclick = () => { cache.length = 0; make(false); };
  </script>
</body>
</html>
```

</details>

В Chrome DevTools: вкладка **Memory** → **Heap snapshot** → в фильтре введите `Detached`.
Сравнение двух снимков (Comparison) показывает, что выросло между ними. Панель **Performance** с
галочкой Memory рисует график кучи: «пила», которая возвращается вниз, — нормально; лестница
вверх после повторяющихся действий — утечка.

## 9. Измерение

### 9.1. Правило

> Не оптимизируйте то, что не измерили. Измеряйте на медленном устройстве, а не на своём ноутбуке.

В DevTools Chrome есть **замедление процессора** (CPU throttling, 4× или 6×) в панели Performance —
очень полезно, ведь у ваших пользователей телефоны в разы медленнее.

### 9.2. `performance.now()` и User Timing

`performance.now()` — время в миллисекундах с дробной частью от начала жизни документа
(`performance.timeOrigin`), монотонное: не прыгает при переводе системных часов, в отличие от
`Date.now()`. Точность намеренно огрублена (в зависимости от изоляции страницы — до 5 или 100
микросекунд) — это защита от атак по времени вроде Spectre.

```js
performance.mark('filter-start');
filterList();
performance.mark('filter-end');
performance.measure('filter', 'filter-start', 'filter-end');
// метки видны в панели Performance на дорожке Timings
```

### 9.3. `PerformanceObserver`

Наблюдает за записями производительности: `longtask`, `long-animation-frame`, `event`,
`largest-contentful-paint`, `layout-shift`, `measure`, `resource`, `paint`. Флаг `buffered: true`
отдаёт и записи, случившиеся до подписки.

```js
new PerformanceObserver(list => {
  for (const e of list.getEntries()) {
    console.log(e.entryType, e.name, Math.round(e.duration), 'мс');
  }
}).observe({ type: 'longtask', buffered: true });
```

Поддержка разнится: `longtask` и `long-animation-frame` (LoAF, детальнее: показывает, какие
скрипты заняли кадр) есть в Chromium; `event` (тайминги взаимодействий) — в Chromium и Firefox.
Проверяйте `PerformanceObserver.supportedEntryTypes`.

<details>
<summary>PerformanceObserver ловит длинные задачи</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-performance.html#example-10">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  button { font: inherit; margin: 0 8px 8px 0; }
  ol { font-family: ui-monospace, monospace; font-size: 13px; }
</style>
</head>
<body>
  <button data-ms="30">Задача 30 мс</button>
  <button data-ms="80">Задача 80 мс</button>
  <button data-ms="300">Задача 300 мс</button>
  <p>Поддерживаемые типы: <code id="types"></code></p>
  <ol id="log"></ol>
  <script>
    const types = PerformanceObserver.supportedEntryTypes;
    document.getElementById('types').textContent = types.join(', ');
    const log = document.getElementById('log');
    const add = s => { const li = document.createElement('li'); li.textContent = s; log.prepend(li); };
    if (types.includes('longtask')) {
      new PerformanceObserver(l => l.getEntries().forEach(e =>
        add('longtask: ' + Math.round(e.duration) + ' мс'))).observe({ type: 'longtask' });
    }
    if (types.includes('event')) {
      new PerformanceObserver(l => l.getEntries().forEach(e =>
        add('event ' + e.name + ': от ввода до отрисовки ' + e.duration + ' мс')))
        .observe({ type: 'event', durationThreshold: 16 });
    }
    document.querySelectorAll('button').forEach(b => b.onclick = () => {
      performance.mark('a');
      const end = performance.now() + +b.dataset.ms;
      while (performance.now() < end) {}
      add('measure: ' + Math.round(performance.measure('work', 'a').duration) + ' мс');
    });
  </script>
</body>
</html>
```

</details>

Задача 30 мс не появится как `longtask` (порог 50 мс), но может появиться как `event`, если
задержка до отрисовки больше 16 мс.

### 9.4. Панель Performance: что искать

- **Красные треугольники** в углу задач — длинные задачи.
- **Фиолетовые блоки Layout с пометкой «Forced reflow»** — принудительная раскладка; во вкладке
  Summary есть ссылка на строку кода, которая её вызвала.
- Дорожка **Frames** — пропущенные и частично показанные кадры.
- **Interactions** — взаимодействия с разбивкой на input delay / processing / presentation.
- Bottom-Up по Self Time — какие функции съели больше всего времени.

## 10. Ещё несколько приёмов

- **Меньше DOM.** Каждый узел — стоимость стиля и раскладки. Длинные списки — виртуализация или
  `content-visibility: auto` (курс [Производительность CSS](LEARN_CSS_PERFORMANCE_COURSE.md)).
- **Пакетная вставка.** Собирать узлы в `DocumentFragment` или передавать массив в
  `append(...nodes)` / `replaceChildren(...)` — одна мутация вместо сотни.
- **Классы вместо стилей по одному.** `el.classList.add('open')` вместо пяти записей в `style`.
- **Делегирование событий.** Один обработчик на контейнере вместо тысячи на элементах (курс
  [События](LEARN_JAVASCRIPT_EVENTS_COURSE.md)).
- **`requestIdleCallback`** для неважной работы (аналитика, предзагрузка) — в простой между
  кадрами. В Safari долго отсутствовал — нужен запасной вариант через `setTimeout`.
- **`defer` и `type="module"`** — скрипты не блокируют парсер (курс
  [Введение в JavaScript](LEARN_JAVASCRIPT_INTRODUCTION_COURSE.md)).

## Итог

- Всё важное происходит на **одном** главном потоке; задачи длиннее 50 мс мешают вводу и кадрам.
- Чтение геометрии после записи стилей — **принудительная раскладка**. Группируйте: сначала все
  чтения, потом все записи.
- Визуальные обновления — в `requestAnimationFrame`, анимация — от времени.
- INP измеряет путь от ввода до следующей отрисовки; дробите работу и уступайте поток
  (`scheduler.yield()` или `setTimeout`), а отклик показывайте сразу.
- `debounce` — «после паузы», `throttle` — «не чаще», rAF — «не чаще кадра».
- Обработчики прокрутки и касаний — пассивные; наблюдатели вместо `scroll`/`resize`.
- Вычисления без DOM — в воркер; большие буферы — передачей владения.
- Утечки — это забытые ссылки: отсоединённые узлы, обработчики, таймеры, наблюдатели.
- Сначала измерение (`performance.mark`, `PerformanceObserver`, DevTools с замедлением CPU), потом
  оптимизация.

## Проверьте себя

1. Почему цикл `el.style.left = el.offsetLeft + 1 + 'px'` по сотне элементов медленнее, чем два
   отдельных цикла? Сколько раскладок в каждом варианте?
2. Чем `await Promise.resolve()` не подходит, чтобы уступить главный поток?
3. Какую функцию выбрать для поиска по мере ввода — `debounce` или `throttle`? А для индикатора
   прогресса прокрутки?
4. Почему `preventDefault()` в обработчике `touchmove` на `document` не отменяет прокрутку и как
   это исправить?
5. Удалённый из DOM элемент всё ещё виден в снимке кучи. Назовите три возможные причины.

Дальше: [Сенсорный ввод](LEARN_WEB_TOUCH_INPUT_COURSE.md).
