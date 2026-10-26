# Сенсорный ввод

> Курс 39 из программы. Для тех, кто знает модель событий DOM (курс
> [События](LEARN_JAVASCRIPT_EVENTS_COURSE.md)) и основы адаптивной вёрстки (курс
> [Адаптивность](LEARN_CSS_RESPONSIVE_COURSE.md)). Палец — не мышь: у него нет наведения, он
> толстый, их бывает несколько, а браузер сам решает, что палец «имел в виду» — прокрутку,
> масштаб или нажатие. Этот курс о том, как с этим договориться.

**Что вы будете понимать после курса**

- три поколения событий: мышь, касания (Touch Events) и указатели (Pointer Events), и почему
  сегодня основной выбор — Pointer Events;
- как браузер на каждый палец решает «это жест или моё событие», и при чём здесь `touch-action`
  и `pointercancel`;
- откуда взялась задержка нажатия 300 мс и как её убрал `<meta name="viewport">`;
- почему `touchmove` должен быть пассивным и как отменять прокрутку правильно;
- как сделать жест щипка (pinch) и перетаскивание с захватом указателя (pointer capture);
- размеры целей нажатия (hit targets), проблему `:hover` на сенсорных экранах и медиазапросы
  `pointer`, `hover`, `any-pointer`;
- `overscroll-behavior` и особенности iOS Safari.

---

## 1. Три поколения событий

### 1.1. Мышь и эмуляция

Веб создавался для мыши: `mousedown`, `mousemove`, `mouseup`, `click`. Когда в 2007 году появился
iPhone, миллионы сайтов уже слушали только мышь. Поэтому мобильные браузеры **эмулируют** мышь:
после короткого нажатия пальцем они генерируют совместимые события (compatibility mouse events)
в таком порядке:

```
touchstart → touchend → (пауза) → mouseover → mousemove → mousedown → mouseup → click
```

Заметьте: все mouse-события идут **после** отпускания пальца и только для нажатия (tap). При
перетаскивании пальцем `mousemove` не приходит вовсе — палец прокручивает страницу.

### 1.2. Touch Events (Apple, 2007 → стандарт W3C)

`touchstart`, `touchmove`, `touchend`, `touchcancel`. Событие несёт **списки касаний**:

| Свойство | Что содержит |
|---|---|
| `touches` | все пальцы на экране сейчас |
| `targetTouches` | пальцы, которые начали касание на этом же целевом элементе |
| `changedTouches` | пальцы, изменившиеся в этом событии (для `touchend` — те, что подняты) |

У каждого `Touch` есть `identifier`, `clientX/Y`, `target` и др. Важная особенность: `target`
касания — элемент, на котором палец **начал** касание, даже если палец уехал далеко.

### 1.3. Pointer Events (Microsoft, 2012 → стандарт W3C)

Одна модель для мыши, пера и пальца: `pointerdown`, `pointermove`, `pointerup`, `pointercancel`,
`pointerover/out/enter/leave`, `gotpointercapture`, `lostpointercapture`. Событие `PointerEvent`
наследует `MouseEvent` и добавляет:

| Свойство | Значение |
|---|---|
| `pointerId` | номер указателя (каждый палец — свой) |
| `pointerType` | `"mouse"`, `"pen"`, `"touch"` |
| `isPrimary` | первый палец мультитача, основная мышь |
| `width`, `height` | размер пятна контакта в CSS-пикселях |
| `pressure` | 0…1 (мышь с нажатой кнопкой — 0.5) |
| `tiltX`, `tiltY`, `twist` | наклон и поворот пера |

Safari поддерживает Pointer Events с версии 13 (2019), и с тех пор их можно считать
универсальными. Touch Events в настольном Firefox и Chrome без сенсорного экрана могут быть не
определены.

### 1.4. Что выбирать

| Задача | Выбор |
|---|---|
| нажатие на кнопку | просто `click` — он работает для всех устройств и клавиатуры |
| перетаскивание, рисование, слайдер | Pointer Events + `touch-action` + pointer capture |
| мультитач-жесты | Pointer Events (храните `Map` по `pointerId`) |
| нужен `preventDefault` на старте касания в старом iOS | Touch Events как дополнение |

> Не делайте `click` из `touchend` «для скорости»: задержки больше нет (раздел 3), а вы сломаете
> клавиатуру, прокрутку (палец уехал — нажатия не было) и вспомогательные технологии.

<details>
<summary>Журнал событий: мышь, палец, перо</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-touch-input.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 14px system-ui, sans-serif; padding: 16px; }
  #pad { height: 140px; background: #e0f2fe; border: 2px solid #0284c7; border-radius: 10px;
         display: grid; place-items: center; user-select: none; }
  ol { font-family: ui-monospace, monospace; font-size: 12px; max-height: 260px; overflow: auto;
       background: #f8fafc; padding: 8px 8px 8px 40px; }
  .t { color: #b45309; } .p { color: #1d4ed8; } .m { color: #15803d; } .c { color: #be123c; font-weight: 700; }
</style>
</head>
<body>
  <div id="pad">Коснитесь, нажмите мышью, проведите</div>
  <button id="clr">Очистить</button>
  <ol id="log"></ol>
  <script>
    const pad = document.getElementById('pad'), log = document.getElementById('log');
    let last = '';
    function add(cls, text) {
      if (text === last) return;           // не забиваем журнал одинаковыми move
      last = text;
      const li = document.createElement('li');
      li.className = cls; li.textContent = text;
      log.append(li); log.scrollTop = log.scrollHeight;
    }
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(t =>
      pad.addEventListener(t, e => add('t', t + ' пальцев: ' + e.touches.length), { passive: true }));
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(t =>
      pad.addEventListener(t, e => add(t === 'pointercancel' ? 'c' : 'p',
        t + ' ' + e.pointerType + ' id=' + e.pointerId)));
    ['mousedown', 'mousemove', 'mouseup', 'click'].forEach(t =>
      pad.addEventListener(t, () => add('m', t)));
    document.getElementById('clr').onclick = () => { log.textContent = ''; last = ''; };
  </script>
</body>
</html>
```

</details>

На телефоне коснитесь и сразу отпустите — увидите весь порядок с эмулированными `mouse*` в конце.
Теперь проведите пальцем вертикально: после пары `pointermove` придёт **`pointercancel`**, и
события указателя прекратятся. Почему — следующий раздел.

## 2. Кто владеет пальцем: `touch-action`

### 2.1. Решение принимается в начале касания

Когда палец опускается, браузер должен быстро решить: это **жест браузера** (прокрутка, масштаб,
двойное нажатие для увеличения) или палец отдан странице. Решение принимается по CSS-свойству
`touch-action` элементов под пальцем — **в момент `pointerdown`**, и потом не пересматривается.

Если браузер начал прокрутку, он посылает `pointercancel` и больше не шлёт события этого
указателя. С Touch Events иначе: `touchmove` продолжают приходить, но их нельзя отменить
(`cancelable === false`).

### 2.2. Значения

| Значение | Браузер обрабатывает сам | Странице достаётся |
|---|---|---|
| `auto` (по умолчанию) | всё: прокрутку, масштаб, двойной тап | только нажатия |
| `none` | ничего | все движения пальца |
| `pan-x` / `pan-y` | горизонтальную / вертикальную прокрутку | движения по другой оси |
| `pan-left`, `pan-right`, `pan-up`, `pan-down` | прокрутку в одну сторону | остальное |
| `pinch-zoom` | масштаб двумя пальцами | (комбинируется с `pan-*`) |
| `manipulation` | прокрутку и щипок, **без двойного тапа** | — |

Ключевые тонкости:

- Свойство **не наследуется**, но действует как пересечение: разрешённые жесты — это пересечение
  значений элемента и всех его предков вплоть до ближайшего прокручиваемого контейнера.
- Оно **не влияет на мышь** и колесо — только на касания и перо.
- Применяется к элементам, у которых есть размеры (не к строчным неразрывным `inline`).

Для холста рисования — `touch-action: none`. Для горизонтальной карусели внутри вертикальной
страницы — `touch-action: pan-y`: вертикальную прокрутку браузер оставит себе, горизонтальные
движения отдаст вам.

<details>
<summary>touch-action: три области</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-touch-input.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 14px system-ui, sans-serif; padding: 16px; min-height: 200vh; }
  .zone { height: 110px; margin: 12px 0; border-radius: 10px; position: relative; overflow: hidden;
          border: 2px solid; display: grid; place-items: center; text-align: center; }
  #a { touch-action: auto; border-color: #64748b; background: #f1f5f9; }
  #b { touch-action: pan-y; border-color: #0284c7; background: #e0f2fe; }
  #c { touch-action: none; border-color: #dc2626; background: #fee2e2; }
  .dot { position: absolute; width: 28px; height: 28px; margin: -14px; border-radius: 50%;
         background: #111827; pointer-events: none; }
</style>
</head>
<body>
  <p>Проведите пальцем по каждой области в разных направлениях.</p>
  <div class="zone" id="a">auto: прокрутка, точка почти не следует</div>
  <div class="zone" id="b">pan-y: вертикально листает, горизонтально двигает точку</div>
  <div class="zone" id="c">none: точка следует всегда, страница не листается</div>
  <script>
    document.querySelectorAll('.zone').forEach(z => {
      const dot = document.createElement('div'); dot.className = 'dot'; z.append(dot);
      const move = e => {
        const r = z.getBoundingClientRect();
        dot.style.left = (e.clientX - r.left) + 'px'; dot.style.top = (e.clientY - r.top) + 'px';
      };
      z.addEventListener('pointerdown', move);
      z.addEventListener('pointermove', move);
      z.addEventListener('pointercancel', () => dot.style.background = '#dc2626');
      z.addEventListener('pointerdown', () => dot.style.background = '#111827');
    });
  </script>
</body>
</html>
```

</details>

Точка краснеет при `pointercancel` — это и есть момент, когда браузер забрал палец себе.

## 3. Задержка 300 мс: история и конец

### 3.1. Откуда она взялась

Первый iPhone показывал настольные сайты, уменьшенные до 980 px шириной. Чтобы читать, нужно было
**увеличить** страницу — и Apple ввела жест **двойного тапа** (double-tap to zoom). Но тогда после
первого нажатия браузер не знает, будет ли второе. Он ждёт около 300 мс и только потом посылает
`click`. Отсюда знаменитая «вязкость» мобильных сайтов 2010-х и библиотека FastClick, которая
синтезировала `click` из `touchend`.

### 3.2. Как она исчезла

Логика браузеров: если страница **уже адаптирована** под ширину устройства, увеличивать её двойным
тапом незачем — значит, и ждать незачем.

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

- Chrome для Android 32 (2014) убрал задержку для страниц с `width=device-width`.
- Safari iOS 9.3 (2016) — то же самое; а с iOS 13 и для `touch-action: manipulation`.
- `touch-action: manipulation` (или `none`) снимает задержку на конкретном элементе в любом
  современном браузере, даже без viewport.

Сегодня с правильным `<meta name="viewport">` задержки нет, и FastClick только вредит.

> **Не пишите `user-scalable=no` и `maximum-scale=1`.** Это запрещает людям с плохим зрением
> увеличивать страницу (нарушение WCAG 1.4.4). iOS Safari с версии 10 вообще игнорирует запрет
> масштабирования по умолчанию — именно по соображениям доступности.

<details>
<summary>Сравнение: задержка между касанием и click</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-touch-input.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  button { font: inherit; padding: 16px 20px; margin: 0 8px 8px 0; border-radius: 10px; border: 2px solid #334155; }
  #m { touch-action: manipulation; background: #dcfce7; }
  #a { touch-action: auto; background: #fef3c7; }
  output { display: block; font-family: ui-monospace, monospace; margin-top: 8px; }
</style>
</head>
<body>
  <p>Коснитесь кнопок на телефоне. Измеряется время от pointerup до click.</p>
  <button id="m">manipulation</button>
  <button id="a">auto</button>
  <output id="out"></output>
  <script>
    // При наличии viewport выше обе кнопки, как правило, без задержки.
    let up = 0;
    document.querySelectorAll('button').forEach(b => {
      b.addEventListener('pointerup', () => up = performance.now());
      b.addEventListener('click', () => {
        document.getElementById('out').textContent =
          b.id === 'm' ? 'manipulation: ' : 'auto: ';
        document.getElementById('out').textContent += Math.round(performance.now() - up) + ' мс';
      });
    });
  </script>
</body>
</html>
```

</details>

## 4. Прокрутка и пассивные обработчики

Если на элементе висит **непассивный** `touchstart`/`touchmove`, браузер не может начать
прокрутку, пока не выполнит обработчик: вдруг там `preventDefault()`. При занятом главном потоке
прокрутка «залипает». Поэтому (подробно в курсе
[Производительность JavaScript](LEARN_JAVASCRIPT_PERFORMANCE_COURSE.md)):

1. Слушаете касания только чтобы **узнать** о них — `{ passive: true }`.
2. На `window`, `document`, `body` такие обработчики пассивны **по умолчанию**.
3. Нужно запретить прокрутку над элементом — сначала попробуйте `touch-action`. Это
   декларативно, браузер знает о запрете **заранее**, на потоке композитора, и ничего не ждёт.
4. Только если правило зависит от состояния, которое известно лишь в JS, — обработчик
   `{ passive: false }` на конкретном элементе.

```js
// Плохо: глобальный блокирующий обработчик, к тому же preventDefault будет проигнорирован
document.addEventListener('touchmove', e => e.preventDefault());

// Хорошо: декларативно
canvas.style.touchAction = 'none';
```

## 5. Перетаскивание и захват указателя

### 5.1. Проблема «палец соскользнул»

Палец быстро уходит с маленького ползунка — и `pointermove` начинает приходить другому элементу.
Решение — **захват указателя** (pointer capture): все события этого `pointerId` направляются
выбранному элементу, где бы ни был палец.

```js
thumb.addEventListener('pointerdown', e => {
  thumb.setPointerCapture(e.pointerId);
});
thumb.addEventListener('pointermove', e => {
  if (!thumb.hasPointerCapture(e.pointerId)) return;
  // двигаем
});
// захват снимается автоматически на pointerup / pointercancel
```

Для касаний браузер делает **неявный захват** (implicit capture) сам: `target` всех событий пальца
— элемент, где касание началось. Явный `setPointerCapture` нужен прежде всего для мыши и пера, но
писать его стоит всегда — код станет одинаковым для всех типов.

<details>
<summary>Перетаскивание с pointer capture</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-touch-input.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  #field { position: relative; height: 260px; background:
           repeating-linear-gradient(0deg, #f1f5f9 0 19px, #e2e8f0 19px 20px); border-radius: 10px;
           border: 2px solid #94a3b8; overflow: hidden; }
  .card { position: absolute; width: 96px; height: 64px; border-radius: 10px; display: grid;
          place-items: center; color: #fff; font-weight: 700; cursor: grab;
          touch-action: none; user-select: none; box-shadow: 0 2px 6px #0003; }
  .card.drag { cursor: grabbing; box-shadow: 0 10px 24px #0005; scale: 1.05; }
</style>
</head>
<body>
  <p>Перетаскивайте карточки мышью или пальцами (можно двумя сразу).</p>
  <div id="field"></div>
  <script>
    const field = document.getElementById('field');
    [['#2563eb', 20, 20], ['#16a34a', 150, 90], ['#db2777', 60, 160]].forEach(([c, x, y], i) => {
      const el = document.createElement('div');
      el.className = 'card'; el.textContent = i + 1; el.style.background = c;
      el.style.left = x + 'px'; el.style.top = y + 'px';
      field.append(el);
      let dx = 0, dy = 0;
      el.addEventListener('pointerdown', e => {
        el.setPointerCapture(e.pointerId);
        el.classList.add('drag');
        dx = e.clientX - el.offsetLeft; dy = e.clientY - el.offsetTop;
        field.append(el);                 // поднять наверх
      });
      el.addEventListener('pointermove', e => {
        if (!el.hasPointerCapture(e.pointerId)) return;
        el.style.left = (e.clientX - dx) + 'px'; el.style.top = (e.clientY - dy) + 'px';
      });
      el.addEventListener('lostpointercapture', () => el.classList.remove('drag'));
    });
  </script>
</body>
</html>
```

</details>

Обратите внимание на `touch-action: none` у карточки: без него первое же движение пальца станет
прокруткой, и придёт `pointercancel`.

## 6. Мультитач: щипок и поворот

С Pointer Events каждый палец — отдельный поток событий со своим `pointerId`. Жест собирается
вручную: храним последние координаты всех активных пальцев и при каждом движении сравниваем
расстояние и угол между двумя пальцами с исходными.

```js
const pts = new Map();             // pointerId → {x, y}
let start = null;                  // исходные расстояние и угол

function geom() {
  const [a, b] = [...pts.values()];
  return { d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
}
```

Масштаб = текущее расстояние / исходное; поворот = текущий угол − исходный. Точка опоры — середина
между пальцами.

Safari дополнительно поддерживает нестандартные `gesturestart`, `gesturechange`, `gestureend` со
свойствами `scale` и `rotation` (на iOS и в настольном Safari для трекпада — см. курс
[Тачпад и трекпад](LEARN_WEB_TOUCHPAD_TRACKPAD_COURSE.md)). Рассчитывать только на них нельзя.

<details>
<summary>Щипок и поворот двумя пальцами</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-touch-input.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  #stage { height: 320px; background: #0f172a; border-radius: 12px; touch-action: none;
           display: grid; place-items: center; overflow: hidden; }
  #img { width: 140px; height: 140px; border-radius: 16px; pointer-events: none;
         background: conic-gradient(#f43f5e, #f59e0b, #22c55e, #3b82f6, #a855f7, #f43f5e);
         display: grid; place-items: center; color: #fff; font: 700 40px system-ui; }
  output { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
  <p>На сенсорном экране сведите, разведите или поверните два пальца внутри тёмной области.</p>
  <div id="stage"><div id="img">Аб</div></div>
  <output id="out">масштаб 1.00, угол 0°</output>
  <script>
    const stage = document.getElementById('stage'), img = document.getElementById('img');
    const pts = new Map();
    let scale = 1, rot = 0, base = null;
    const geom = () => {
      const [a, b] = [...pts.values()];
      return { d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
    };
    stage.addEventListener('pointerdown', e => {
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) base = { ...geom(), scale, rot };
    });
    stage.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size !== 2 || !base) return;
      const g = geom();
      scale = Math.min(4, Math.max(0.3, base.scale * g.d / base.d));
      rot = base.rot + (g.ang - base.ang) * 180 / Math.PI;
      img.style.transform = 'rotate(' + rot + 'deg) scale(' + scale + ')';
      document.getElementById('out').textContent =
        'масштаб ' + scale.toFixed(2) + ', угол ' + Math.round(rot) + '°';
    });
    const end = e => { pts.delete(e.pointerId); base = null; };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  </script>
</body>
</html>
```

</details>

## 7. Цели нажатия

### 7.1. Размеры

Палец касается пятном диаметром порядка 8–10 мм, а точку нажатия браузер вычисляет как центр
пятна — с погрешностью. Рекомендации:

| Источник | Минимум |
|---|---|
| WCAG 2.2, критерий 2.5.8 (AA) | 24 × 24 CSS px (или достаточный зазор до соседей) |
| WCAG 2.1, критерий 2.5.5 (AAA) | 44 × 44 CSS px |
| Apple Human Interface Guidelines | 44 × 44 pt |
| Material Design | 48 × 48 dp |

CSS-пиксель на телефоне — это несколько физических (см. `devicePixelRatio`), поэтому 44 px — это
около 7–9 мм на реальном экране.

### 7.2. Увеличить область, не увеличивая вид

Маленькая иконка может иметь большую зону нажатия:

```css
.icon-btn { position: relative; }
.icon-btn::after {
  content: ""; position: absolute; inset: -12px;   /* зона нажатия шире на 12 px с каждой стороны */
}
```

Псевдоэлемент — часть кнопки, клик по нему — клик по кнопке. Альтернативы: `padding` с
отрицательным `margin`, или просто больший `padding`.

<details>
<summary>Цели нажатия: маленькие, большие и расширенные</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-touch-input.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  .row { display: flex; gap: 4px; margin: 8px 0 20px; align-items: center; }
  button { font: inherit; border: 1px solid #334155; background: #e2e8f0; border-radius: 6px; padding: 0; }
  .s button { width: 18px; height: 18px; font-size: 11px; }
  .l button { width: 48px; height: 48px; }
  .x { gap: 30px; }
  .x button { width: 18px; height: 18px; font-size: 11px; position: relative; }
  .x button::after { content: ""; position: absolute; inset: -14px; outline: 1px dashed #f43f5e; }
  output { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
  <p>Попробуйте попасть пальцем по кнопке с номером 3 в каждом ряду.</p>
  <div>18 px вплотную</div>
  <div class="row s"><button>1</button><button>2</button><button>3</button><button>4</button><button>5</button></div>
  <div>48 px</div>
  <div class="row l"><button>1</button><button>2</button><button>3</button><button>4</button><button>5</button></div>
  <div>18 px с невидимой зоной 46 px (пунктир)</div>
  <div class="row x"><button>1</button><button>2</button><button>3</button><button>4</button><button>5</button></div>
  <output id="out">Нажато: —</output>
  <script>
    document.querySelectorAll('button').forEach(b => b.onclick = () =>
      document.getElementById('out').textContent = 'Нажато: ' + b.textContent);
  </script>
</body>
</html>
```

</details>

## 8. `:hover` на сенсорном экране и медиазапросы ввода

### 8.1. «Липкий» hover

У пальца нет наведения. Но мобильные браузеры ради совместимости после тапа считают элемент
«наведённым» — и `:hover` **остаётся** включённым, пока вы не коснётесь чего-то другого. Кнопка
«залипает» подсвеченной. Ещё хуже — меню, открывающиеся только по `:hover`: на телефоне первое
касание показывает меню (iOS делает такой «первый тап — hover, второй — click», если `:hover`
меняет видимость содержимого), и поведение становится непредсказуемым.

### 8.2. Медиазапросы возможностей ввода (Media Queries Level 4)

| Запрос | Про какое устройство | Значения |
|---|---|---|
| `pointer` | **основное** устройство указания | `none`, `coarse` (палец), `fine` (мышь, перо) |
| `hover` | может ли основное устройство наводить | `none`, `hover` |
| `any-pointer` | **хоть одно** из имеющихся | `none`, `coarse`, `fine` |
| `any-hover` | хоть одно умеет наводить | `none`, `hover` |

```css
/* Подсветка только там, где наведение реально есть */
@media (hover: hover) and (pointer: fine) {
  .btn:hover { background: #dbeafe; }
}

/* Увеличить цели, если основной ввод — палец */
@media (pointer: coarse) {
  .btn { min-height: 44px; padding-inline: 16px; }
}
```

Нюансы и границы:

- Ноутбук с сенсорным экраном: `pointer: fine` (основное — тачпад), но `any-pointer: coarse`.
- Планшет с подключённой мышью: основным может остаться палец. Браузер не переключает значение
  в зависимости от того, чем вы **сейчас** пользуетесь.
- Поэтому медиазапрос — это подсказка о **возможностях**, а не о текущем вводе. Текущий тип ввода
  знает только `event.pointerType`.
- Не скрывайте функции за `:hover`: всё, что открывается наведением, должно открываться и нажатием,
  и с клавиатуры (`:focus-within`).

<details>
<summary>Что сообщает ваше устройство</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-touch-input.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  table { border-collapse: collapse; }
  td { border: 1px solid #cbd5e1; padding: 6px 10px; font-family: ui-monospace, monospace; }
  .yes { background: #dcfce7; } .no { color: #94a3b8; }
  .btn { display: inline-block; margin-top: 16px; padding: 10px 16px; border-radius: 8px;
         border: 2px solid #2563eb; background: #fff; font: inherit; }
  .btn.naive:hover { background: #fde68a; }
  @media (hover: hover) { .btn.smart:hover { background: #fde68a; } }
  .btn:active { background: #bfdbfe; }
</style>
</head>
<body>
  <table id="t"></table>
  <p>Коснитесь обеих кнопок на телефоне, затем пустого места.</p>
  <button class="btn naive">:hover всегда</button>
  <button class="btn smart">:hover только при (hover: hover)</button>
  <p>Последний тип указателя: <b id="pt">—</b></p>
  <script>
    const qs = ['(pointer: coarse)', '(pointer: fine)', '(hover: hover)', '(hover: none)',
                '(any-pointer: coarse)', '(any-pointer: fine)', '(any-hover: hover)'];
    const t = document.getElementById('t');
    for (const q of qs) {
      const ok = matchMedia(q).matches;
      t.insertAdjacentHTML('beforeend',
        '<tr><td>' + q + '</td><td class="' + (ok ? 'yes' : 'no') + '">' + ok + '</td></tr>');
    }
    addEventListener('pointerdown', e => document.getElementById('pt').textContent = e.pointerType);
  </script>
</body>
</html>
```

</details>

## 9. `overscroll-behavior`: цепочка прокрутки

Когда вложенный прокручиваемый блок доходит до края, прокрутка **передаётся** родителю — это
цепочка прокрутки (scroll chaining). В модальном окне это выглядит как «страница под ним уехала».
А у корня документа край вызывает **эффект края** (пружину в iOS, свечение в Android) и в Chrome
для Android — обновление страницы жестом «потянуть вниз» (pull-to-refresh).

| Значение | Цепочка к родителю | Эффект края |
|---|---|---|
| `auto` | да | да |
| `contain` | нет | да (внутри элемента) |
| `none` | нет | нет |

```css
.modal-body { overflow: auto; overscroll-behavior: contain; }
html { overscroll-behavior-y: none; } /* отключить pull-to-refresh в веб-приложении */
```

Есть и пара `overscroll-behavior-x` / `-y`. Safari поддерживает свойство с версии 16.

<details>
<summary>Цепочка прокрутки: auto против contain</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-touch-input.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; min-height: 250vh;
         background: repeating-linear-gradient(#fff 0 40px, #f1f5f9 40px 80px); }
  .wrap { display: flex; gap: 12px; position: sticky; top: 16px; }
  .box { flex: 1; height: 200px; overflow: auto; border: 2px solid; border-radius: 10px; background: #fff; }
  .box p { margin: 0; padding: 10px; border-bottom: 1px solid #e2e8f0; }
  #a { border-color: #f59e0b; }
  #b { border-color: #16a34a; overscroll-behavior: contain; }
</style>
</head>
<body>
  <p>Долистайте каждый блок до конца и продолжайте крутить (колесом или пальцем).</p>
  <div class="wrap">
    <div class="box" id="a"></div>
    <div class="box" id="b"></div>
  </div>
  <script>
    for (const [id, name] of [['a', 'auto'], ['b', 'contain']]) {
      const box = document.getElementById(id);
      for (let i = 1; i <= 12; i++) box.insertAdjacentHTML('beforeend', '<p>' + name + ': строка ' + i + '</p>');
    }
  </script>
</body>
</html>
```

</details>

## 10. Особенности iOS Safari

Safari на iOS — главный источник «странностей» сенсорного веба. Все браузеры на iOS исторически
обязаны использовать WebKit, так что это касается и «Chrome на iPhone» (кроме ЕС с iOS 17.4, где
разрешены другие движки).

| Особенность | Что происходит | Что делать |
|---|---|---|
| `click` не всплывает до `document` с «неинтерактивных» элементов | делегированный обработчик на `document` не видит тап по `<div>` | `cursor: pointer` на элементе, или обработчик ближе, или используйте `<button>` |
| `100vh` больше видимой области | панели браузера сворачиваются и разворачиваются | `100dvh` / `100svh` / `100lvh` (курс [Единицы](LEARN_CSS_UNITS_VALUES_COURSE.md)) |
| автоувеличение при фокусе на поле | поля со шрифтом меньше 16 px увеличиваются | `font-size: 16px` у полей (не `maximum-scale`!) |
| подсветка тапа | серая заливка при касании ссылки | `-webkit-tap-highlight-color: transparent` + свой `:active` |
| `:active` не срабатывает | без обработчика касания на странице | `document.addEventListener('touchstart', () => {}, { passive: true })` — старый приём |
| вырез и закругления экрана | содержимое под «бровью» | `viewport-fit=cover` + `env(safe-area-inset-*)` |
| долгое нажатие | меню ссылки, выделение текста, лупа | `-webkit-touch-callout: none`, `user-select: none` — только для элементов управления |
| жест «назад» от края экрана | горизонтальный свайп у левого края уводит со страницы | не размещайте важные свайпы у самого края |

```css
.app-header {
  padding-top: max(12px, env(safe-area-inset-top)); /* учитываем вырез */
}
```

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

## Итог

- Мышь, Touch Events, Pointer Events — три слоя истории. Для нажатий хватит `click`, для
  перетаскиваний и жестов — Pointer Events.
- Браузер решает судьбу пальца **в начале касания** по `touch-action`. Забрал палец — пришлёт
  `pointercancel`.
- Задержку 300 мс убрал `width=device-width`; `user-scalable=no` для этого не нужен и вреден.
- Обработчики касаний — пассивные; запрет прокрутки — через `touch-action`, а не `preventDefault`.
- Перетаскивание: `setPointerCapture` + `touch-action: none`. Мультитач: `Map` по `pointerId`.
- Цели нажатия — не меньше 24 px (лучше 44–48), зону можно расширить псевдоэлементом.
- `:hover` — за `@media (hover: hover)`; `pointer`/`any-pointer` описывают возможности, а не текущий
  ввод.
- `overscroll-behavior: contain` останавливает цепочку прокрутки и pull-to-refresh.

## Проверьте себя

1. Почему при вертикальном свайпе по элементу с `touch-action: auto` перестают приходить
   `pointermove`? Какое событие придёт последним?
2. Что убирает задержку 300 мс в современных браузерах? Назовите два способа.
3. Чем `touch-action: pan-y` отличается от `touch-action: none` для горизонтальной карусели?
4. Ноутбук с сенсорным экраном: что вернут `(pointer: coarse)` и `(any-pointer: coarse)`?
5. Зачем `setPointerCapture`, если для касаний захват и так неявный?
6. Модальное окно с прокруткой: как не дать странице под ним прокручиваться, когда список дошёл до
   конца?

Дальше: [Тачпад и трекпад](LEARN_WEB_TOUCHPAD_TRACKPAD_COURSE.md).
