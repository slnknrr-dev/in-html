# Тачпад и трекпад

> Курс 40 из программы. Продолжение [Сенсорного ввода](LEARN_WEB_TOUCH_INPUT_COURSE.md): там палец
> касался самого экрана, здесь — поверхности рядом с клавиатурой. Тачпад (touchpad, в мире Apple —
> trackpad) для страницы почти невидим: он не посылает событий касания, а притворяется мышью и
> колесом. Курс о том, что именно приходит в браузер, чего по этим данным узнать нельзя и как
> делать прокрутку и масштаб, не ломая привычки пользователя.

**Что вы будете понимать после курса**

- как жесты тачпада превращаются в события `pointer*`, `wheel` и прокрутку;
- событие `wheel`: `deltaX/Y/Z`, `deltaMode` (пиксели, строки, страницы) и почему нельзя слушать
  устаревшие `mousewheel`/`DOMMouseScroll`;
- эвристики «тачпад или колесо мыши» и почему они принципиально ненадёжны;
- почему щипок на тачпаде приходит как `wheel` с `ctrlKey: true` и как этим пользоваться;
- нестандартные события `gesture*` в Safari;
- инерционная прокрутка (momentum), её фазы и что из этого видно в JS;
- `scroll-behavior: smooth`, `scrollTo({ behavior })`, `scroll-snap` и событие `scrollend`;
- как отменять масштабирование ответственно — только внутри своего холста.

---

## 1. Что тачпад сообщает странице

Операционная система сама распознаёт жесты тачпада и передаёт браузеру уже **результат**:

| Жест на тачпаде | Что получает страница |
|---|---|
| движение одним пальцем | `pointermove` / `mousemove` с `pointerType: "mouse"` |
| нажатие или тап | `pointerdown/up`, `mousedown/up`, `click` |
| два пальца вверх-вниз, вбок | `wheel` с маленькими дробными `deltaY` / `deltaX`, потом прокрутка |
| щипок двумя пальцами | `wheel` с `ctrlKey: true` (Chrome, Edge, Firefox); в Safari — события `gesture*` |
| три-четыре пальца | системные жесты (переключение окон, «назад»); странице обычно ничего |
| двойной тап двумя пальцами (macOS) | «умное увеличение» — браузер масштабирует сам |

Главное: `pointerType` для тачпада — **`"mouse"`**. Событий `touch*` от тачпада нет (кроме
специальных режимов, недоступных обычной странице). Узнать «это тачпад» напрямую невозможно —
спецификации намеренно не дают такой информации.

## 2. Событие `wheel`

### 2.1. Свойства

`WheelEvent` наследует `MouseEvent`. Кроме координат и модификаторов (`ctrlKey`, `shiftKey` и т. д.):

| Свойство | Смысл |
|---|---|
| `deltaY` | прокрутка по вертикали; положительная — «вниз» (содержимое уезжает вверх) |
| `deltaX` | по горизонтали; положительная — «вправо» |
| `deltaZ` | ось Z (почти никогда не используется) |
| `deltaMode` | единица измерения delta: `0` — пиксели, `1` — строки, `2` — страницы |

Константы: `WheelEvent.DOM_DELTA_PIXEL = 0`, `DOM_DELTA_LINE = 1`, `DOM_DELTA_PAGE = 2`.

Знак `deltaY` не зависит от настройки «естественной прокрутки» (natural scrolling) в macOS:
система уже учла её, и `deltaY > 0` всегда означает «показать то, что ниже».

### 2.2. `deltaMode` и нормализация

Исторически Firefox на Windows и Linux для колеса мыши отдавал `deltaMode = 1` (строки, обычно 3
за щелчок). Chrome всегда отдаёт пиксели. С Firefox 88+ ситуация сложнее: если страница **прочла**
`deltaY` раньше `deltaMode`, Firefox может отдать пиксели — ради совместимости с сайтами, которые
`deltaMode` игнорируют. Вывод: **всегда проверяйте `deltaMode`** и переводите в пиксели.

```js
function wheelPx(e) {
  const k = e.deltaMode === 1 ? 16            // строка ≈ 16 px (или line-height)
          : e.deltaMode === 2 ? innerHeight   // страница ≈ высота окна
          : 1;
  return { x: e.deltaX * k, y: e.deltaY * k };
}
```

Нажатый `Shift` при вертикальном колесе в большинстве систем превращает прокрутку в
горизонтальную — браузер может сам переложить значение в `deltaX`, а может оставить `deltaY` с
`shiftKey: true`. Учитывайте оба случая, если делаете горизонтальную ленту.

### 2.3. Устаревшие события

`mousewheel` (WebKit/старый IE, `wheelDelta` кратно 120 с обратным знаком) и `DOMMouseScroll`
(старый Firefox) — нестандартные. Слушайте только `wheel`.

<details>
<summary>Журнал событий wheel</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-touchpad-trackpad.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; padding: 16px; }
  #pad { height: 150px; border: 2px solid #7c3aed; background: #f5f3ff; border-radius: 10px;
         display: grid; place-items: center; text-align: center; }
  table { border-collapse: collapse; margin-top: 12px; font-family: ui-monospace, monospace; font-size: 12px; }
  td, th { border-bottom: 1px solid #e2e8f0; padding: 3px 8px; text-align: right; }
  .z { background: #fef3c7; }
</style>
</head>
<body>
  <div id="pad">Крутите колесо мыши, ведите двумя пальцами<br>или делайте щипок на тачпаде над этой областью</div>
  <table>
    <thead><tr><th>#</th><th>deltaX</th><th>deltaY</th><th>mode</th><th>ctrl</th><th>shift</th><th>мс</th></tr></thead>
    <tbody id="log"></tbody>
  </table>
  <script>
    const log = document.getElementById('log');
    let n = 0, prev = 0;
    document.getElementById('pad').addEventListener('wheel', e => {
      e.preventDefault(); // не листать страницу во время эксперимента
      const now = performance.now();
      const tr = document.createElement('tr');
      if (e.ctrlKey) tr.className = 'z';
      tr.innerHTML = [++n, e.deltaX.toFixed(2), e.deltaY.toFixed(2), e.deltaMode,
                      e.ctrlKey ? 'да' : '', e.shiftKey ? 'да' : '', Math.round(now - prev)]
        .map(v => '<td>' + v + '</td>').join('');
      prev = now;
      log.prepend(tr);
      while (log.children.length > 14) log.lastChild.remove();
    }, { passive: false });
  </script>
</body>
</html>
```

</details>

Сравните: колесо мыши даёт редкие «круглые» значения (например, 100 или 120 в Chrome на Windows,
`deltaMode 1` и 3 в некоторых конфигурациях Firefox), тачпад — частый поток маленьких дробных
чисел, которые после отрыва пальцев ещё долго затухают (инерция). Щипок подсвечивается жёлтым.

## 3. Тачпад или колесо: эвристики и их пределы

### 3.1. Зачем это хотят

Карта или редактор хотят: колесо мыши — масштаб, два пальца тачпада — панорамирование (как в
Figma). Для этого надо отличить устройства. Типичные признаки:

| Признак | Колесо мыши | Тачпад |
|---|---|---|
| `deltaMode` | иногда `1` (строки) | всегда `0` |
| величина | крупная, кратная шагу (100, 120, 53, 4.0…) | мелкая, дробная |
| `deltaX` | почти всегда 0 | часто ненулевая (пальцы не идут строго вертикально) |
| частота | событие на щелчок | поток с частотой ~60–120 Гц |
| затухание | нет | плавное затухание после отрыва (инерция) |

### 3.2. Почему это ненадёжно

- **Мыши с «бесшумным» колесом** (Logitech MX и подобные, режим free-spin) дают поток мелких
  событий, неотличимых от тачпада.
- **Плавная прокрутка в Windows** и драйверы прецизионных тачпадов (Precision Touchpad) могут
  отдавать события с шагом, похожим на колесо.
- **Magic Mouse** от Apple — это сенсорная поверхность; события как у трекпада.
- **Браузеры и ОС меняют значения** между версиями: множители, ускорение, округление.
- Первое событие серии почти ничего не говорит; решение приходится принимать сразу.

```js
// Типовая эвристика — с осознанием, что она будет ошибаться
function looksLikeTrackpad(e) {
  if (e.deltaMode !== 0) return false;              // строки — точно колесо
  if (e.deltaX !== 0) return true;                  // диагональ — скорее тачпад
  return !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40;
}
```

### 3.3. Как поступать на практике

1. **Не различайте**, если можно. Пусть `wheel` прокручивает (это ожидание пользователя), а
   масштаб — через `Ctrl + wheel` и щипок (они приходят одинаково, раздел 4).
2. Если различаете — дайте **настройку** («Колесо: прокрутка / масштаб»), как делают Figma и
   графические редакторы.
3. Решение «тачпад или нет» привязывайте к **серии** событий (жесту), а не к каждому событию, и
   сбрасывайте после паузы ~200–300 мс — иначе на затухании инерции режим будет «прыгать».

<details>
<summary>Эвристика в действии (и где она ошибается)</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-touchpad-trackpad.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  #pad { height: 170px; border: 2px solid #334155; border-radius: 10px; display: grid;
         place-items: center; font-size: 22px; transition: background .2s; }
  .mouse { background: #fee2e2; } .pad { background: #dcfce7; }
  small { color: #64748b; }
</style>
</head>
<body>
  <div id="pad">Крутите над этой областью</div>
  <p><small>Решение принимается для серии событий и сбрасывается после паузы 250 мс.
     Мышь с колесом без щелчков может ошибочно считаться тачпадом.</small></p>
  <script>
    const pad = document.getElementById('pad');
    let mode = null, timer;
    function guess(e) {
      if (e.deltaMode !== 0) return 'mouse';
      if (e.deltaX !== 0) return 'pad';
      return (!Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40) ? 'pad' : 'mouse';
    }
    pad.addEventListener('wheel', e => {
      e.preventDefault();
      if (!mode) mode = guess(e);       // решаем по первому событию серии
      clearTimeout(timer);
      timer = setTimeout(() => { mode = null; pad.className = ''; pad.textContent = 'Крутите над этой областью'; }, 250);
      pad.className = mode;
      pad.textContent = mode === 'pad' ? 'Похоже на тачпад' : 'Похоже на колесо мыши';
    }, { passive: false });
  </script>
</body>
</html>
```

</details>

## 4. Щипок как `wheel` с `ctrlKey`

### 4.1. Соглашение

Chrome (с 2014 года на Windows и macOS), затем Edge и Firefox договорились: щипок на тачпаде
отправляется странице как **`wheel` с `ctrlKey: true`**, где `deltaY < 0` — раздвигание пальцев
(увеличить), `deltaY > 0` — сведение (уменьшить). Клавиша Ctrl на самом деле **не нажата**.
Логика: `Ctrl + колесо` и так всегда означало «масштаб», поэтому сайты, которые уже обрабатывают
`Ctrl + колесо`, получили поддержку щипка бесплатно.

Если страница **не отменит** такое событие, браузер выполнит своё масштабирование: на настольных
системах это обычно масштаб всей страницы (как `Ctrl` + `+`), в Chrome на macOS при щипке —
визуальное увеличение (pinch-zoom) без перераскладки.

### 4.2. Масштаб вокруг курсора

Чтобы точка под курсором осталась на месте, сдвиг пересчитывается так: новый сдвиг = курсор −
(курсор − старый сдвиг) × (новый масштаб / старый).

```js
el.addEventListener('wheel', e => {
  if (!e.ctrlKey) return;               // обычная прокрутка — браузеру
  e.preventDefault();                   // свой масштаб вместо масштаба страницы
  const k = Math.exp(-e.deltaY * 0.01); // экспонента: плавно и симметрично
  zoomAt(e.clientX, e.clientY, k);
}, { passive: false });
```

Почему экспонента: при щипке приходят маленькие `deltaY` (единицы), при `Ctrl + колесо` —
большие (около 100). `exp(-delta × c)` даёт одинаковое поведение «туда и обратно» и разумно
масштабируется для обоих случаев; для колеса можно ограничить шаг через `Math.max/min`.

<details>
<summary>Масштаб щипком и Ctrl + колесо вокруг курсора</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-touchpad-trackpad.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; padding: 16px; }
  #view { position: relative; height: 320px; overflow: hidden; border: 2px solid #0f766e;
          border-radius: 10px; background: #f0fdfa; cursor: crosshair; touch-action: none; }
  #world { position: absolute; left: 0; top: 0; transform-origin: 0 0; width: 600px; height: 400px;
           background:
             linear-gradient(#99f6e4 1px, transparent 1px) 0 0 / 40px 40px,
             linear-gradient(90deg, #99f6e4 1px, transparent 1px) 0 0 / 40px 40px; }
  .pin { position: absolute; width: 60px; height: 60px; border-radius: 50%; display: grid;
         place-items: center; color: #fff; font-weight: 700; }
  output { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
  <p>Щипок на тачпаде или Ctrl + колесо — масштаб вокруг курсора. Два пальца без щипка — сдвиг.</p>
  <div id="view">
    <div id="world">
      <div class="pin" style="left:80px;top:60px;background:#e11d48">A</div>
      <div class="pin" style="left:300px;top:200px;background:#2563eb">B</div>
      <div class="pin" style="left:480px;top:90px;background:#ca8a04">C</div>
    </div>
  </div>
  <output id="out">масштаб 1.00</output>
  <script>
    const view = document.getElementById('view'), world = document.getElementById('world');
    let s = 1, tx = 0, ty = 0;
    const apply = () => {
      world.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
      document.getElementById('out').textContent = 'масштаб ' + s.toFixed(2);
    };
    view.addEventListener('wheel', e => {
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : 1;
      const r = view.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (e.ctrlKey) {
        const ns = Math.min(8, Math.max(0.2, s * Math.exp(-e.deltaY * k * 0.01)));
        tx = x - (x - tx) * ns / s;      // точка под курсором остаётся на месте
        ty = y - (y - ty) * ns / s;
        s = ns;
      } else {
        tx -= e.deltaX * k; ty -= e.deltaY * k;
      }
      apply();
    }, { passive: false });
    apply();
  </script>
</body>
</html>
```

</details>

## 5. События `gesture*` в Safari

Safari (на macOS для трекпада и на iOS для касаний) поддерживает нестандартные события
`gesturestart`, `gesturechange`, `gestureend`. У `GestureEvent` есть:

- `scale` — накопленный масштаб относительно начала жеста (1 в начале);
- `rotation` — накопленный поворот в градусах (поворот двумя пальцами на трекпаде).

Это единственный способ получить **поворот** с трекпада: стандартных событий для него нет.

```js
let base = 1;
el.addEventListener('gesturestart', e => { e.preventDefault(); base = currentScale; });
el.addEventListener('gesturechange', e => {
  e.preventDefault();
  setScale(base * e.scale);
  setRotation(e.rotation);
});
el.addEventListener('gestureend', e => e.preventDefault());
```

Если вы обрабатываете и `gesture*`, и `wheel + ctrlKey`, в Safari один щипок может прийти двумя
путями. Определите, какой путь используете: например, при наличии `'ongesturechange' in window`
и `pointerType`-мыши в настольном Safari — только `gesture*`, иначе — `wheel`.

<details>
<summary>Поворот и масштаб жестом в Safari</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-touchpad-trackpad.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  #stage { height: 260px; border-radius: 12px; background: #1e1b4b; display: grid;
           place-items: center; overflow: hidden; }
  #card { width: 120px; height: 160px; border-radius: 12px; background: linear-gradient(135deg, #f472b6, #818cf8);
          display: grid; place-items: center; color: #fff; font: 700 24px system-ui; }
  output { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
  <p>В Safari на трекпаде сделайте щипок или поворот двумя пальцами над тёмной областью.</p>
  <div id="stage"><div id="card">Safari</div></div>
  <output id="out"></output>
  <script>
    const out = document.getElementById('out'), card = document.getElementById('card');
    const stage = document.getElementById('stage');
    if (!('ongesturechange' in window)) {
      out.textContent = 'Этот браузер не поддерживает события gesture*. Откройте пример в Safari.';
    } else {
      let s = 1, r = 0, bs = 1, br = 0;
      stage.addEventListener('gesturestart', e => { e.preventDefault(); bs = s; br = r; });
      stage.addEventListener('gesturechange', e => {
        e.preventDefault();
        s = Math.min(4, Math.max(0.3, bs * e.scale)); r = br + e.rotation;
        card.style.transform = 'rotate(' + r + 'deg) scale(' + s + ')';
        out.textContent = 'scale ' + e.scale.toFixed(2) + ', rotation ' + e.rotation.toFixed(1) + '°';
      });
      stage.addEventListener('gestureend', e => e.preventDefault());
    }
  </script>
</body>
</html>
```

</details>

## 6. Инерционная прокрутка

### 6.1. Что происходит после отрыва пальцев

Когда пальцы покидают тачпад с некоторой скоростью, система продолжает прокрутку с затуханием —
**инерция** (momentum, kinetic scrolling). На macOS это давно часть системы, на Windows —
прецизионные тачпады и браузерная реализация.

В нативных API у событий прокрутки есть **фазы**: начало жеста, изменения, конец жеста, начало
инерции, конец инерции. **В вебе фаз нет**: инерционные события `wheel` приходят точно так же, как
события от пальцев, просто с затухающими значениями. Страница не может достоверно отличить
«пальцы ещё на тачпаде» от «катимся по инерции».

Следствия:

- Свой «перелистывающий» интерфейс (одно движение — один слайд) на `wheel` будет срабатывать
  **несколько раз** за один жест из-за инерционного хвоста. Классический обходной путь —
  игнорировать события после срабатывания, пока не наступит пауза или пока величина не перестанет
  уменьшаться. Лучший путь — `scroll-snap` (раздел 8), где эту работу делает браузер.
- Если вы отменяете `wheel` и прокручиваете сами, инерцию вы получите «бесплатно» (она в данных),
  но её затухание определяет система, а не вы.

### 6.2. Инерция на iOS

На iOS до версии 13 вложенные прокручиваемые блоки по умолчанию прокручивались без инерции, и
требовалось `-webkit-overflow-scrolling: touch`. С iOS 13 инерция включена всегда, свойство
устарело.

## 7. Плавная прокрутка из кода

### 7.1. Способы

```css
html { scroll-behavior: smooth; } /* якорные ссылки и scrollTo без behavior — плавно */
```

```js
window.scrollTo({ top: 0, behavior: 'smooth' });
el.scrollIntoView({ behavior: 'smooth', block: 'start' });
box.scrollBy({ left: 300, behavior: 'smooth' });
```

| Способ | Плюс | Минус |
|---|---|---|
| `scroll-behavior: smooth` | ноль JS, работают якоря | влияет на всё, включая поиск Ctrl+F в части браузеров |
| `behavior: 'smooth'` | точечно | нельзя задать длительность и кривую |
| своя анимация через rAF | полный контроль | надо уважать `prefers-reduced-motion`, прерываться при вводе |

Уважайте настройки пользователя:

```css
@media (prefers-reduced-motion: no-preference) {
  html { scroll-behavior: smooth; }
}
```

### 7.2. `scrollend`

Событие `scrollend` (Chrome 114, Firefox 109; в Safari появилось позже — проверяйте
`'onscrollend' in window`) приходит, когда прокрутка **полностью** завершилась: пальцы подняты,
инерция закончилась, плавная анимация доехала. Раньше это приходилось угадывать таймером
«нет `scroll` 100 мс».

```js
const onEnd = () => saveScrollPosition();
if ('onscrollend' in window) box.addEventListener('scrollend', onEnd);
else {
  let t;
  box.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(onEnd, 150); }, { passive: true });
}
```

## 8. `scroll-snap`: точки притяжения

Вместо «каруселей на JavaScript» браузер умеет сам довести прокрутку до ближайшей точки — и
делает это с учётом инерции тачпада, касания, колеса и клавиатуры.

```css
.gallery {
  display: flex; overflow-x: auto;
  scroll-snap-type: x mandatory;     /* ось и строгость */
  scroll-padding-inline: 16px;       /* отступ области притяжения */
  overscroll-behavior-x: contain;
}
.gallery > * {
  flex: 0 0 80%;
  scroll-snap-align: start;          /* какая сторона элемента притягивается */
  scroll-snap-stop: always;          /* не пролетать элементы при сильном жесте */
}
```

| Свойство | Значения | На ком |
|---|---|---|
| `scroll-snap-type` | `x`/`y`/`block`/`inline`/`both` + `mandatory`/`proximity` | контейнер |
| `scroll-padding` | отступы «окна» притяжения (например, под фиксированную шапку) | контейнер |
| `scroll-snap-align` | `start`, `center`, `end`, `none` | дочерний |
| `scroll-margin` | отступ точки притяжения у элемента | дочерний |
| `scroll-snap-stop` | `normal`, `always` | дочерний |

`mandatory` — всегда останавливаться на точке; `proximity` — только если прокрутка закончилась
рядом. Осторожно с `mandatory`, если элемент выше контейнера: часть содержимого может стать
недоступной (браузеры стараются это обрабатывать, но лучше `proximity`).

<details>
<summary>Галерея на scroll-snap без JavaScript</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-touchpad-trackpad.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  .gallery { display: flex; gap: 12px; overflow-x: auto; padding: 8px 16px 16px;
             scroll-snap-type: x mandatory; scroll-padding-inline: 16px;
             overscroll-behavior-x: contain; }
  .slide { flex: 0 0 75%; height: 180px; border-radius: 14px; scroll-snap-align: start;
           display: grid; place-items: center; color: #fff; font: 700 32px system-ui; }
  .stop .slide { scroll-snap-stop: always; }
  output { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
  <p>Листайте двумя пальцами по горизонтали, колесом с Shift или пальцем.</p>
  <div class="gallery" id="g"></div>
  <p>Со scroll-snap-stop: always (сильный жест не пролетает слайды):</p>
  <div class="gallery stop" id="g2"></div>
  <output id="out"></output>
  <script>
    const colors = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6'];
    for (const id of ['g', 'g2']) {
      const g = document.getElementById(id);
      colors.forEach((c, i) => g.insertAdjacentHTML('beforeend',
        '<div class="slide" style="background:' + c + '">' + (i + 1) + '</div>'));
      const report = () => document.getElementById('out').textContent =
        'scrollend: ' + id + ' остановился на ' + g.scrollLeft.toFixed(0) + ' px';
      if ('onscrollend' in window) g.addEventListener('scrollend', report);
    }
  </script>
</body>
</html>
```

</details>

## 9. Отменять масштаб ответственно

Пользователь масштабирует страницу щипком или `Ctrl + колесо`, потому что ему **нужно** — мелкий
шрифт, плохое зрение. Правила:

1. **Никогда не отменяйте масштаб глобально.** Обработчик `wheel` на `document`, глушащий
   `ctrlKey`, отнимает у человека системную функцию. К тому же на `document` обработчик `wheel`
   по умолчанию пассивен (курс [Производительность JavaScript](LEARN_JAVASCRIPT_PERFORMANCE_COURSE.md)),
   и `preventDefault()` просто проигнорируется.
2. Отменяйте **только над своим холстом**, где у масштаба есть собственный смысл (карта, редактор,
   просмотрщик изображений), и **давайте замену** — ваш масштаб.
3. Обработчик — на конкретном элементе с `{ passive: false }`.
4. Для касаний — `touch-action: none` (или `pan-x pan-y`) на холсте, а не `user-scalable=no` в
   viewport (курс [Сенсорный ввод](LEARN_WEB_TOUCH_INPUT_COURSE.md)).
5. Клавиатурный масштаб `Ctrl` + `+`/`−` не трогайте вовсе: перехват `keydown` для этого
   работает непоследовательно и всегда вредит доступности.

```js
canvas.addEventListener('wheel', e => {
  if (e.ctrlKey) { e.preventDefault(); myZoom(e); }
  // без ctrlKey не отменяем: страница должна прокручиваться дальше
}, { passive: false });
```

Тонкость для холстов, занимающих всю ширину: если вы отменяете **все** `wheel` над холстом,
пользователь не сможет прокрутить страницу дальше, когда курсор над ним. Распространённое решение
(Google Maps на встроенных картах) — прокручивать страницу, а масштабировать только с `Ctrl` и
показывать подсказку «Чтобы изменить масштаб, удерживайте Ctrl».

<details>
<summary>Встроенная карта: прокрутка проходит, масштаб с Ctrl</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-touchpad-trackpad.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; min-height: 220vh; }
  #map { position: relative; height: 240px; border-radius: 12px; overflow: hidden;
         background: radial-gradient(circle at 30% 40%, #86efac, #166534); }
  #dot { position: absolute; left: 50%; top: 50%; width: 40px; height: 40px; margin: -20px;
         border-radius: 50%; background: #fbbf24; border: 3px solid #fff; transition: transform .1s; }
  #hint { position: absolute; inset: 0; display: grid; place-items: center; color: #fff;
          background: #0009; font-size: 18px; opacity: 0; transition: opacity .3s; pointer-events: none; }
  #hint.on { opacity: 1; }
</style>
</head>
<body>
  <p>Крутите колесо над картой: страница прокручивается дальше. С Ctrl или щипком — масштаб.</p>
  <div id="map"><div id="dot"></div><div id="hint">Чтобы изменить масштаб, удерживайте Ctrl</div></div>
  <p>Ниже ещё содержимое, чтобы было что прокручивать.</p>
  <script>
    const map = document.getElementById('map'), dot = document.getElementById('dot');
    const hint = document.getElementById('hint');
    let s = 1, t;
    map.addEventListener('wheel', e => {
      if (!e.ctrlKey) {                     // не мешаем прокрутке страницы
        hint.classList.add('on');
        clearTimeout(t); t = setTimeout(() => hint.classList.remove('on'), 900);
        return;
      }
      e.preventDefault();                   // свой масштаб вместо масштаба страницы
      hint.classList.remove('on');
      s = Math.min(6, Math.max(0.3, s * Math.exp(-e.deltaY * 0.01)));
      dot.style.transform = 'scale(' + s + ')';
    }, { passive: false });
  </script>
</body>
</html>
```

</details>

## Итог

- Тачпад для страницы — это мышь (`pointerType: "mouse"`) и поток событий `wheel`; событий касания
  нет.
- `wheel` несёт `deltaX/Y/Z` и `deltaMode`; всегда приводите к пикселям, старые `mousewheel` и
  `DOMMouseScroll` не используйте.
- «Тачпад или колесо» определить достоверно нельзя: эвристики (дробность, `deltaX`, частота)
  ошибаются на мышах без щелчков и на Magic Mouse. Лучше не различать или дать настройку.
- Щипок приходит как `wheel` с `ctrlKey: true`; отмените его только над своим холстом и
  масштабируйте вокруг курсора. Поворот трекпада есть только в Safari через `gesture*`.
- Инерция в вебе не имеет фаз — она неотличима от движения пальцев; для «пошаговых» интерфейсов
  используйте `scroll-snap`.
- Плавная прокрутка — `scroll-behavior`/`behavior: 'smooth'` с учётом `prefers-reduced-motion`,
  окончание — `scrollend`.

## Проверьте себя

1. Почему значения `deltaY` надо умножать на коэффициент, зависящий от `deltaMode`? Когда
   `deltaMode` равен 1?
2. Назовите два устройства, на которых эвристика «дробные delta — значит тачпад» ошибётся.
3. Что увидит обработчик `wheel`, когда пользователь сводит пальцы на тачпаде в Chrome? Что
   произойдёт, если его не отменить?
4. Почему «перелистывающий» интерфейс на событиях `wheel` часто перелистывает два-три слайда за
   один жест? Как этого избежать без JavaScript?
5. Почему обработчик на `document`, отменяющий `wheel` с `ctrlKey`, — плохая идея, даже если бы
   он работал?

Дальше: [3D-рендеринг в вебе](LEARN_WEB_3D_RENDERING_COURSE.md).
