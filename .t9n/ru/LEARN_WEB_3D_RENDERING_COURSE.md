# 3D-рендеринг в вебе

> Курс 41 из программы, заключительный. Для тех, кто знает [конвейер отрисовки](LEARN_WEB_RENDERING_PIPELINE_COURSE.md),
> [позиционирование и контексты наложения](LEARN_CSS_POSITIONING_COURSE.md) и уверенно пишет
> JavaScript. Мы начнём с 3D, которое умеет CSS, затем спустимся до видеокарты: как треугольник
> превращается в пиксели, что такое шейдер и зачем нужны матрицы. Цель — не выучить API наизусть,
> а понимать, **что происходит** между вашим кодом и экраном.

**Что вы будете понимать после курса**

- как устроены CSS-трансформации в 3D: `perspective`, `perspective-origin`, `transform-style:
  preserve-3d`, `backface-visibility`, и почему 3D «ломается» от `overflow` или `opacity`;
- чем отличаются Canvas 2D, WebGL и WebGPU и когда что выбирать;
- конвейер видеокарты: вершины, вершинный шейдер, сборка примитивов, растеризация, фрагментный
  шейдер, тест глубины;
- как написать минимальный треугольник на WebGL с нуля;
- почему холст «мылится» на экранах высокой плотности и как правильно учитывать `devicePixelRatio`;
- как устроен цикл отрисовки на `requestAnimationFrame`;
- интуицию матриц: модель, вид, проекция — и почему 4 × 4.

---

## 1. Три способа рисовать 3D в браузере

| Способ | Что это | Сильные стороны | Ограничения |
|---|---|---|---|
| CSS 3D-трансформации | обычные элементы DOM, повёрнутые в пространстве | текст, ссылки, доступность, ноль математики | нет освещения, нет пересечения плоскостей, сотни элементов — предел |
| Canvas 2D (`getContext('2d')`) | растровое рисование командами | просто, хорош для графиков и 2D-игр | 3D только «вручную» проекцией на CPU |
| WebGL / WebGL 2 | API к GPU на основе OpenGL ES 2.0 / 3.0 | везде поддерживается, миллионы треугольников | многословный, устаревшая модель состояний |
| WebGPU | современный API к GPU (идеи Vulkan, Metal, Direct3D 12) | вычислительные шейдеры, меньше накладных расходов | Chrome 113+ (2023), Safari 26, Firefox — постепенно; нужна проверка `navigator.gpu` |

На практике WebGL используют через библиотеки — three.js, Babylon.js, PlayCanvas. Но библиотеки
скрывают ровно то, что нужно понимать для отладки и производительности, поэтому в курсе мы
пишем «голый» WebGL.

## 2. CSS 3D: пространство из обычных элементов

### 2.1. Ось Z и перспектива

У CSS-трансформаций есть третья ось: Z направлена **к зрителю**. `translateZ(100px)` приближает
элемент, `rotateY(45deg)` поворачивает его вокруг вертикальной оси.

Но без перспективы всё рисуется **ортографически**: повёрнутый элемент просто становится уже, а
сдвиг по Z ничего не меняет. Перспектива задаёт **расстояние от зрителя до плоскости z = 0**:

| Способ | Где | Эффект |
|---|---|---|
| `perspective: 600px` | на **родителе** | общая точка схода для всех детей — единая сцена |
| `transform: perspective(600px) rotateY(…)` | на самом элементе | у каждого элемента своя точка схода |
| `perspective-origin: 50% 50%` | на родителе | где находится глаз (по умолчанию — центр родителя) |

Чем **меньше** значение `perspective`, тем ближе глаз и тем сильнее искажения. 1000–2000 px —
мягко, 200–400 px — «рыбий глаз». Важно: функция `perspective()` должна идти в `transform`
**первой**, ведь функции применяются справа налево к элементу (подробнее в разделе 8).

<details>
<summary>perspective на родителе и на каждом элементе</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-3d-rendering.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; padding: 16px; }
  .row { display: flex; gap: 12px; padding: 20px; border: 1px dashed #94a3b8; margin-bottom: 16px; }
  .row div { width: 70px; height: 90px; background: #3b82f6; color: #fff; display: grid;
             place-items: center; border-radius: 6px; font-weight: 700; }
  .flat div { transform: rotateY(50deg); }
  .scene { perspective: 400px; }
  .scene div { transform: rotateY(50deg); }
  .own div { transform: perspective(400px) rotateY(50deg); }
  label { display: block; margin: 12px 0; }
</style>
</head>
<body>
  <div>Без перспективы: элементы просто сузились</div>
  <div class="row flat"><div>1</div><div>2</div><div>3</div><div>4</div></div>
  <div>perspective на родителе: одна точка схода, видна «стена»</div>
  <div class="row scene" id="scene"><div>1</div><div>2</div><div>3</div><div>4</div></div>
  <div>perspective() в transform: каждый со своей точкой схода</div>
  <div class="row own"><div>1</div><div>2</div><div>3</div><div>4</div></div>
  <label>perspective родителя: <input id="p" type="range" min="150" max="2000" value="400">
    <output id="v">400px</output></label>
  <script>
    const p = document.getElementById('p');
    p.oninput = () => {
      document.getElementById('scene').style.perspective = p.value + 'px';
      document.getElementById('v').textContent = p.value + 'px';
    };
  </script>
</body>
</html>
```

</details>

### 2.2. `transform-style: preserve-3d` — общее пространство

По умолчанию (`transform-style: flat`) каждый элемент с трансформацией **сплющивает** своих детей в
свою плоскость: дети рисуются как картинка на поверхности родителя. Чтобы дети жили в **общем**
трёхмерном пространстве с родителем, нужно `transform-style: preserve-3d` на родителе.

Это и есть способ собрать куб: шесть граней внутри контейнера с `preserve-3d`, каждая повёрнута и
выдвинута на половину ребра.

Подвох: некоторые свойства **принудительно** делают группировку плоской (спецификация называет их
grouping properties) — тогда `preserve-3d` молча перестаёт работать:

| Свойство на элементе с `preserve-3d` | Итог |
|---|---|
| `overflow` не `visible` (и не `clip` в части движков) | плоско |
| `opacity` меньше 1 | плоско |
| `filter` не `none` | плоско |
| `clip-path`, `mask` | плоско |
| `isolation: isolate`, `mix-blend-mode` | плоско |
| `contain: paint` | плоско |

Если куб «сложился», ищите одно из этих свойств на контейнере — и переносите его на обёртку
выше или на грани.

### 2.3. `backface-visibility`

У каждой плоскости есть лицевая сторона и изнанка. По умолчанию изнанка видна — зеркально.
`backface-visibility: hidden` скрывает элемент, когда он повёрнут к зрителю тыльной стороной.
Классический пример — переворачивающаяся карточка: лицевая и обратная стороны наложены друг на
друга, обратная заранее повёрнута на 180°.

<details>
<summary>Куб из шести граней</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-3d-rendering.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; padding: 16px; }
  .scene { width: 160px; height: 160px; margin: 40px auto; perspective: 600px; }
  .cube { width: 100%; height: 100%; position: relative; transform-style: preserve-3d;
          animation: spin 8s linear infinite; }
  .cube.flat { transform-style: flat; }
  .cube.paused { animation-play-state: paused; }
  .face { position: absolute; inset: 0; display: grid; place-items: center; font: 700 28px system-ui;
          color: #fff; border: 2px solid #fff8; opacity: .9; }
  .f1 { background: #ef4444; transform: rotateY(0deg)   translateZ(80px); }
  .f2 { background: #f59e0b; transform: rotateY(90deg)  translateZ(80px); }
  .f3 { background: #22c55e; transform: rotateY(180deg) translateZ(80px); }
  .f4 { background: #3b82f6; transform: rotateY(-90deg) translateZ(80px); }
  .f5 { background: #a855f7; transform: rotateX(90deg)  translateZ(80px); }
  .f6 { background: #64748b; transform: rotateX(-90deg) translateZ(80px); }
  @keyframes spin { to { transform: rotateX(360deg) rotateY(720deg); } }
  label { display: block; text-align: center; }
</style>
</head>
<body>
  <div class="scene"><div class="cube" id="c">
    <div class="face f1">1</div><div class="face f2">2</div><div class="face f3">3</div>
    <div class="face f4">4</div><div class="face f5">5</div><div class="face f6">6</div>
  </div></div>
  <label><input type="checkbox" id="flat"> transform-style: flat (куб сплющится)</label>
  <label><input type="checkbox" id="pause"> пауза</label>
  <script>
    const c = document.getElementById('c');
    document.getElementById('flat').onchange = e => c.classList.toggle('flat', e.target.checked);
    document.getElementById('pause').onchange = e => c.classList.toggle('paused', e.target.checked);
  </script>
</body>
</html>
```

</details>

Каждая грань сначала поворачивается, а потом сдвигается по **своей** новой оси Z на половину
ребра (80 px) — так она встаёт на место. Порядок функций в `transform` важен: `translateZ(80px)
rotateY(90deg)` дал бы другой результат.

<details>
<summary>Переворачивающаяся карточка и backface-visibility</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-3d-rendering.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  .wrap { display: flex; gap: 24px; flex-wrap: wrap; }
  .card { width: 180px; height: 240px; perspective: 800px; cursor: pointer; }
  .inner { position: relative; width: 100%; height: 100%; transform-style: preserve-3d;
           transition: transform .7s; }
  .card:hover .inner, .card:focus-visible .inner { transform: rotateY(180deg); }
  .side { position: absolute; inset: 0; border-radius: 14px; display: grid; place-items: center;
          font: 700 22px system-ui; color: #fff; }
  .front { background: linear-gradient(135deg, #0ea5e9, #6366f1); }
  .back { background: linear-gradient(135deg, #f97316, #db2777); transform: rotateY(180deg); }
  .hidden .side { backface-visibility: hidden; -webkit-backface-visibility: hidden; }
</style>
</head>
<body>
  <p>Наведите курсор на карточку (или перейдите к ней клавишей Tab).</p>
  <div class="wrap">
    <div>
      <div class="card" tabindex="0"><div class="inner">
        <div class="side front">Лицо</div><div class="side back">Оборот</div>
      </div></div>
      <p>visible: изнанка просвечивает</p>
    </div>
    <div>
      <div class="card hidden" tabindex="0"><div class="inner">
        <div class="side front">Лицо</div><div class="side back">Оборот</div>
      </div></div>
      <p>hidden: правильно</p>
    </div>
  </div>
</body>
</html>
```

</details>

В левой карточке после поворота обе стороны оказываются в одной плоскости, и что
показать — изнанку лицевой стороны (зеркальную надпись «Лицо») или оборот — решают сортировка по
глубине и порядок в DOM, то есть движок. Надёжный результат даёт только `backface-visibility:
hidden` на обеих сторонах. Safari до недавних версий требовал префикс `-webkit-`.

### 2.4. Пределы CSS 3D

- Нет **пересечения плоскостей**: если две грани пересекаются, браузеры рисуют их неверно
  (каждая плоскость сортируется целиком, а не попиксельно, хотя Chrome умеет разрезать плоскости
  в части случаев).
- Нет **освещения** — тени и блики имитируют градиентами.
- Каждый элемент в 3D обычно становится **слоем композитора**: сотни граней — сотни слоёв и
  много памяти GPU.
- Зато текст остаётся текстом: выделяется, читается экранным диктором, ссылки кликабельны.

## 3. Canvas 2D, WebGL, WebGPU

### 3.1. Немедленный и сохранённый режим

DOM и SVG — **сохранённый режим** (retained mode): вы описываете сцену, браузер помнит её и
перерисовывает сам. `<canvas>` — **немедленный режим** (immediate mode): вы командуете «нарисуй
здесь пиксели», и холст не помнит, что это было. Нет объектов, нет событий на фигурах, нет
доступности — всё это ваша забота (курс [Медиа](LEARN_HTML_MEDIA_COURSE.md)).

### 3.2. Сравнение

| | Canvas 2D | WebGL | WebGPU |
|---|---|---|---|
| где считается | в основном браузер (часто тоже на GPU, но через его 2D-движок) | ваши шейдеры на GPU | ваши шейдеры на GPU |
| язык шейдеров | — | GLSL ES | WGSL |
| модель | вызовы рисования | глобальная машина состояний | явные объекты: конвейеры, буферы команд |
| вычисления общего назначения | нет | только через трюки с текстурами | вычислительные шейдеры (compute) |
| в воркере | `OffscreenCanvas` | `OffscreenCanvas` | да |
| поддержка | везде | везде (WebGL 2 — с Safari 15) | проверяйте `navigator.gpu` |

Выбор: графики, диаграммы, простые 2D-игры — Canvas 2D. 3D, тысячи спрайтов, эффекты по
пикселям — WebGL (через three.js или вручную). Тяжёлые вычисления на GPU (машинное обучение,
симуляции) и новые проекты, готовые к запасному пути, — WebGPU.

## 4. Конвейер видеокарты

GPU умеет одну вещь очень быстро: рисовать **треугольники**, выполняя маленькие программы на
тысячах ядер параллельно. Всё — от куба до шрифта — разбивается на треугольники.

| Шаг | Вход | Кто управляет | Выход |
|---|---|---|---|
| 1. Вершинные данные | массивы чисел в буфере GPU | вы (JS) | атрибуты вершин |
| 2. **Вершинный шейдер** (vertex shader) | одна вершина | ваша программа | положение в пространстве отсечения (`gl_Position`) |
| 3. Сборка примитивов, отсечение | вершины | GPU | треугольники в пределах экрана |
| 4. Перспективное деление, область вывода | координаты отсечения | GPU | пиксельные координаты |
| 5. **Растеризация** | треугольник | GPU | фрагменты — «кандидаты в пиксели» |
| 6. **Фрагментный шейдер** (fragment shader) | один фрагмент | ваша программа | цвет |
| 7. Тест глубины, смешивание | фрагмент + буфер кадра | GPU (настраиваете вы) | итоговый пиксель |

Ключевые понятия:

- **Пространство отсечения** (clip space): вершинный шейдер обязан выдать `vec4(x, y, z, w)`.
  GPU делит `x, y, z` на `w` и получает **нормализованные координаты устройства** (NDC): видимое
  — от −1 до 1 по каждой оси. Всё за пределами отсекается.
- **Интерполяция** (varying): значения, которые вершинный шейдер передал дальше, растеризатор
  плавно смешивает между тремя вершинами для каждого фрагмента. Так получается градиент на
  треугольнике.
- **Буфер глубины** (depth buffer, z-buffer): для каждого пикселя хранится расстояние до
  ближайшего нарисованного фрагмента; более дальний отбрасывается. Именно это решает задачу
  пересечения плоскостей, с которой не справляется CSS.

## 5. Минимальный треугольник на WebGL

Пять шагов: получить контекст, скомпилировать два шейдера и связать в программу, загрузить
вершины в буфер, описать, как атрибут читает буфер, нарисовать.

<details>
<summary>Треугольник на WebGL с нуля</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-3d-rendering.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 16px; font: 14px system-ui, sans-serif; background: #f8fafc; }
  canvas { width: 100%; max-width: 480px; aspect-ratio: 4 / 3; display: block; background: #0f172a; border-radius: 10px; }
</style>
</head>
<body>
  <canvas id="c" width="480" height="360"></canvas>
  <p id="msg"></p>
  <script id="vs" type="x-shader/x-vertex">#version 300 es
    // Атрибуты: положение и цвет вершины
    in vec2 aPos;
    in vec3 aColor;
    out vec3 vColor;            // передаём цвет дальше, он будет интерполирован
    void main() {
      vColor = aColor;
      gl_Position = vec4(aPos, 0.0, 1.0); // сразу в пространство отсечения
    }
  </script>
  <script id="fs" type="x-shader/x-fragment">#version 300 es
    precision mediump float;
    in vec3 vColor;
    out vec4 outColor;
    void main() { outColor = vec4(vColor, 1.0); }
  </script>
  <script>
    const gl = document.getElementById('c').getContext('webgl2');
    if (!gl) { document.getElementById('msg').textContent = 'WebGL 2 недоступен'; throw 0; }

    // 1. Компиляция шейдера с выводом ошибок
    function shader(type, id) {
      const s = gl.createShader(type);
      gl.shaderSource(s, document.getElementById(id).textContent.trim());
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    // 2. Программа = вершинный + фрагментный шейдер
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, 'vs'));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, 'fs'));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));

    // 3. Вершины: x, y, r, g, b (чередуются в одном буфере)
    const data = new Float32Array([
       0.0,  0.8,   1, 0.2, 0.3,
      -0.8, -0.7,   0.2, 0.9, 0.4,
       0.8, -0.7,   0.2, 0.5, 1,
    ]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    // 4. Как атрибуты читают буфер: шаг 5 чисел по 4 байта
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const stride = 5 * 4;
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
    const aColor = gl.getAttribLocation(prog, 'aColor');
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, stride, 2 * 4);

    // 5. Рисуем
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0.06, 0.09, 0.16, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  </script>
</body>
</html>
```

</details>

Что здесь стоит заметить:

- Шейдеры лежат в `<script type="x-shader/x-vertex">`: браузер не знает такого типа и **не
  выполняет** содержимое, а мы читаем его как текст. Строка `#version 300 es` должна быть самой
  первой — поэтому `.trim()`.
- Мы задали всего **три** цвета, а видим плавный градиент — это интерполяция `vColor`
  растеризатором.
- Координаты от −1 до 1 не зависят от размера холста: треугольник растянется вместе с ним. Если
  холст не квадратный, «правильные» пропорции придётся вводить матрицей проекции (раздел 8).
- Ошибки компиляции шейдеров **не попадают** в консоль сами — их надо запросить через
  `getShaderInfoLog`.

## 6. Размер холста и `devicePixelRatio`

### 6.1. Два размера у каждого холста

| Размер | Чем задаётся | Что значит |
|---|---|---|
| **размер буфера** (drawing buffer) | атрибуты `width`/`height` (по умолчанию 300 × 150) | сколько реальных пикселей в картинке |
| **размер на странице** | CSS (`width`, `height`) | сколько CSS-пикселей занимает элемент |

Если они не совпадают, браузер **растягивает** картинку как обычное изображение. Отсюда два
классических дефекта: искажённые пропорции (CSS изменил только ширину) и мыло.

### 6.2. `devicePixelRatio`

На экране высокой плотности один CSS-пиксель — это несколько физических. `devicePixelRatio`
(DPR) = физические / CSS: 1 на обычном мониторе, 2 на Retina, 2.625–3 на телефонах, дробное
значение при масштабе Windows 125 % или при масштабе страницы в браузере.

Холст 300 × 300 атрибутов, растянутый CSS на 300 × 300 CSS-пикселей при DPR 2, показывается на
600 × 600 физических пикселях — каждый пиксель буфера растянут вчетверо, линии размыты.

Правильный размер буфера = размер на странице × DPR:

```js
function fit(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  const w = Math.round(width * dpr), h = Math.round(height * dpr);
  if (canvas.width !== w || canvas.height !== h) {   // менять только при изменении:
    canvas.width = w; canvas.height = h;              // присваивание очищает холст
    return true;
  }
  return false;
}
```

Для Canvas 2D после этого рисуйте в CSS-пикселях, задав масштаб: `ctx.setTransform(dpr, 0, 0,
dpr, 0, 0)`. Для WebGL — `gl.viewport(0, 0, canvas.width, canvas.height)`.

Тонкости:

- Самый точный способ — `ResizeObserver` с `devicePixelContentBoxSize` (Chrome, Firefox): он
  даёт **целое** число физических пикселей без ошибок округления. Safari — запасной путь через
  `contentBoxSize × dpr`.
- DPR меняется, когда окно переносят на другой монитор или меняют масштаб страницы. Отследить:
  `matchMedia('(resolution: ' + dpr + 'dppx)')` с событием `change`.
- Буфер 3× на телефоне — это в 9 раз больше пикселей, чем 1×. Для тяжёлых сцен ограничивают:
  `Math.min(devicePixelRatio, 2)`.

<details>
<summary>Мыльный и чёткий холст рядом</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-3d-rendering.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; padding: 16px; }
  .row { display: flex; gap: 16px; flex-wrap: wrap; }
  canvas { width: 220px; height: 140px; border: 1px solid #94a3b8; border-radius: 6px; }
</style>
</head>
<body>
  <p>devicePixelRatio = <b id="dpr"></b>. На экране с DPR больше 1 левый холст заметно размыт.
     Попробуйте масштаб страницы Ctrl + колесо.</p>
  <div class="row">
    <figure><canvas id="a"></canvas><figcaption>буфер = CSS-размер</figcaption></figure>
    <figure><canvas id="b"></canvas><figcaption>буфер = CSS-размер × DPR</figcaption></figure>
  </div>
  <script>
    function draw(canvas, useDpr) {
      const dpr = useDpr ? devicePixelRatio : 1;
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // дальше рисуем в CSS-пикселях
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.width, r.height);
      ctx.strokeStyle = '#1e293b';
      for (let i = 0; i < 12; i++) {
        ctx.beginPath(); ctx.arc(110, 70, 6 + i * 5, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = '#be123c'; ctx.font = '13px system-ui';
      ctx.fillText('Мелкий текст 13 px', 8, 130);
    }
    function all() {
      document.getElementById('dpr').textContent = devicePixelRatio;
      draw(document.getElementById('a'), false);
      draw(document.getElementById('b'), true);
    }
    all();
    // Отслеживаем смену DPR (масштаб, другой монитор)
    (function watch() {
      matchMedia('(resolution: ' + devicePixelRatio + 'dppx)')
        .addEventListener('change', () => { all(); watch(); }, { once: true });
    })();
  </script>
</body>
</html>
```

</details>

## 7. Цикл отрисовки

Анимация на холсте — это перерисовка **всего кадра** в каждом колбэке `requestAnimationFrame`
(курс [Производительность JavaScript](LEARN_JAVASCRIPT_PERFORMANCE_COURSE.md)):

```js
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1); // секунды; ограничение после паузы вкладки
  last = now;
  fit(canvas);          // размер мог измениться
  update(dt);           // физика и состояние — от времени
  render();             // очистить и нарисовать
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

Правила:

- **Состояние — от времени** (`dt`), а не от числа кадров: на 120 Гц иначе всё вдвое быстрее.
- **Ограничивайте `dt`**: после переключения вкладки rAF стоял, и первый кадр получит `dt` в
  десятки секунд — объекты «телепортируются».
- **Не создавайте ресурсы в цикле**: буферы, шейдеры, текстуры — один раз при старте. В цикле —
  только `uniform`-значения и вызовы рисования.
- Нечего анимировать — **не запускайте цикл**; перерисовывайте по событию.
- Контекст WebGL может быть **потерян** (драйвер, нехватка памяти, слишком много контекстов):
  слушайте `webglcontextlost` (с `preventDefault()`) и `webglcontextrestored`, чтобы пересоздать
  ресурсы.

## 8. Матрицы: интуиция

### 8.1. Зачем матрица

Любое сочетание поворотов, масштабов и сдвигов можно записать **одной** матрицей, а применение к
точке — одним умножением. Тысячи вершин × одна матрица — идеальная работа для GPU.

Поворот и масштаб на плоскости — матрица 2 × 2: её **столбцы** — это то, куда переходят единичные
векторы осей. Повернуть на угол θ: ось X уходит в (cos θ, sin θ), ось Y — в (−sin θ, cos θ).

Но **сдвиг** линейной матрицей не выразить: ноль всегда остаётся нулём. Решение — **однородные
координаты** (homogeneous coordinates): добавляем к точке ещё одну компоненту `w = 1`. Тогда 2D
использует матрицы 3 × 3, а 3D — **4 × 4**, и сдвиг становится последним столбцом. CSS
`matrix3d()` и `gl_Position` — это ровно они.

### 8.2. Три матрицы конвейера

```
позиция в клипе = Проекция × Вид × Модель × позиция вершины
```

| Матрица | Из какого пространства | В какое | Смысл |
|---|---|---|---|
| Модель (model) | локальное (вершины объекта) | мировое | где стоит и как повёрнут объект |
| Вид (view) | мировое | пространство камеры | обратная к положению камеры: «двигаем мир, а не камеру» |
| Проекция (projection) | камеры | отсечения | перспектива: дальше — меньше |

Порядок важен: умножение матриц **не коммутативно**. «Повернуть, затем сдвинуть» и «сдвинуть,
затем повернуть» — разные результаты. Тот же принцип в CSS: в `transform: rotate(45deg)
translateX(100px)` функции применяются к элементу **справа налево** — сначала сдвиг, потом
поворот вокруг исходной точки — то есть элемент описывает дугу.

### 8.3. Откуда берётся перспектива

Перспективная матрица записывает в `w` значение, пропорциональное **глубине** точки. Затем GPU
делит `x, y, z` на `w` (перспективное деление, шаг 4 конвейера) — далёкие точки делятся на
большее число и оказываются ближе к центру. CSS `perspective: d` делает то же: точка на глубине
`z` масштабируется в `d / (d − z)` раз.

Стандартная перспективная матрица (WebGL, правая система координат, камера смотрит вдоль −Z):

```js
function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  return new Float32Array([      // столбцы подряд (column-major), как ждёт WebGL
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}
```

`aspect` — отношение ширины к высоте холста: именно он исправляет растянутый треугольник из
раздела 5.

<details>
<summary>Вращающийся куб на WebGL: матрицы, глубина, DPR и цикл</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-3d-rendering.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 16px; font: 14px system-ui, sans-serif; }
  canvas { width: 100%; height: 320px; display: block; background: #020617; border-radius: 10px; }
  label { display: inline-block; margin: 10px 16px 0 0; }
</style>
</head>
<body>
  <canvas id="c"></canvas>
  <label><input type="checkbox" id="depth" checked> тест глубины</label>
  <label>угол обзора <input type="range" id="fov" min="20" max="120" value="50"></label>
  <script id="vs" type="x-shader/x-vertex">#version 300 es
    in vec3 aPos;
    in vec3 aColor;
    uniform mat4 uMVP;          // Проекция × Вид × Модель, посчитана на CPU
    out vec3 vColor;
    void main() { vColor = aColor; gl_Position = uMVP * vec4(aPos, 1.0); }
  </script>
  <script id="fs" type="x-shader/x-fragment">#version 300 es
    precision mediump float;
    in vec3 vColor;
    out vec4 o;
    void main() { o = vec4(vColor, 1.0); }
  </script>
  <script>
    const canvas = document.getElementById('c');
    const gl = canvas.getContext('webgl2');
    function sh(t, id) {
      const s = gl.createShader(t);
      gl.shaderSource(s, document.getElementById(id).textContent.trim());
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, 'vs'));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, 'fs'));
    gl.linkProgram(p);

    // Куб: 6 граней × 2 треугольника × 3 вершины, у каждой грани свой цвет
    const faces = [
      [[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1], [0.94,0.27,0.27]],
      [[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1], [0.96,0.62,0.04]],
      [[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1], [0.13,0.77,0.37]],
      [[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1], [0.23,0.51,0.96]],
      [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1], [0.66,0.33,0.97]],
      [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1], [0.39,0.45,0.55]],
    ];
    const v = [];
    for (const [a, b, c, d, col] of faces)
      for (const q of [a, b, c, a, c, d]) v.push(...q, ...col);
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(p, 'aPos'), aColor = gl.getAttribLocation(p, 'aColor');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 24, 12);
    const uMVP = gl.getUniformLocation(p, 'uMVP');

    // Матрицы 4×4 по столбцам (column-major)
    const mul = (a, b) => {
      const r = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k];
        r[c * 4 + row] = s;
      }
      return r;
    };
    const persp = (fov, asp, n, f) => {
      const t = 1 / Math.tan(fov / 2), nf = 1 / (n - f);
      return new Float32Array([t / asp,0,0,0, 0,t,0,0, 0,0,(f + n) * nf,-1, 0,0,2 * f * n * nf,0]);
    };
    const transl = (x, y, z) => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]);
    const rotY = a => { const c = Math.cos(a), s = Math.sin(a);
      return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]); };
    const rotX = a => { const c = Math.cos(a), s = Math.sin(a);
      return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]); };

    function fit() {
      const dpr = Math.min(devicePixelRatio, 2);
      const r = canvas.getBoundingClientRect();
      const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }
    function frame(t) {
      fit();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.01, 0.02, 0.09, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      document.getElementById('depth').checked ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST);
      const fov = document.getElementById('fov').value * Math.PI / 180;
      const model = mul(rotY(t / 1500), rotX(t / 2300));
      const view = transl(0, 0, -6);                         // камера отодвинута: мир сдвинут на −6
      const proj = persp(fov, canvas.width / canvas.height, 0.1, 100);
      gl.useProgram(p);
      gl.uniformMatrix4fv(uMVP, false, mul(proj, mul(view, model)));
      gl.drawArrays(gl.TRIANGLES, 0, 36);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  </script>
</body>
</html>
```

</details>

Снимите галочку «тест глубины»: грани начнут рисоваться в порядке их следования в буфере, и
задние будут перекрывать передние. Двигайте угол обзора: малый — почти ортографический вид,
большой — сильные перспективные искажения, тот же эффект, что маленькое значение CSS `perspective`.

## 9. Взгляд на WebGPU

WebGPU делает то же самое, но **явно**: вместо глобального состояния — объекты.

| Понятие WebGPU | Аналог в WebGL |
|---|---|
| `GPUAdapter`, `GPUDevice` | контекст |
| `GPURenderPipeline` | программа + всё состояние (смешивание, глубина, формат вершин) |
| `GPUBuffer` | буфер |
| `GPUBindGroup` | набор `uniform` и текстур |
| `GPUCommandEncoder` → `queue.submit()` | вызовы `draw*`, выполняемые сразу |
| WGSL | GLSL |

Почему это быстрее: всё состояние конвейера проверяется **один раз** при его создании, а не при
каждом вызове рисования; команды записываются в буфер и отправляются пачкой. И есть
вычислительные шейдеры — GPU как параллельный процессор общего назначения.

<details>
<summary>Треугольник на WebGPU (с проверкой поддержки)</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/web-3d-rendering.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 16px; font: 14px system-ui, sans-serif; }
  canvas { width: 100%; max-width: 480px; aspect-ratio: 4 / 3; display: block; background: #0f172a; border-radius: 10px; }
</style>
</head>
<body>
  <canvas id="c" width="480" height="360"></canvas>
  <p id="msg"></p>
  <script type="module">
    const msg = document.getElementById('msg');
    if (!navigator.gpu) {
      msg.textContent = 'WebGPU недоступен в этом браузере. Работает в Chrome и Edge 113+, Safari 26.';
    } else {
      const adapter = await navigator.gpu.requestAdapter();
      const device = await adapter.requestDevice();
      const ctx = document.getElementById('c').getContext('webgpu');
      const format = navigator.gpu.getPreferredCanvasFormat();
      ctx.configure({ device, format, alphaMode: 'opaque' });
      // WGSL: вершины прямо в шейдере, без буфера
      const code = `
        struct Out { @builtin(position) pos: vec4f, @location(0) col: vec3f };
        @vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
          var p = array(vec2f(0.0, 0.8), vec2f(-0.8, -0.7), vec2f(0.8, -0.7));
          var c = array(vec3f(1, 0.2, 0.3), vec3f(0.2, 0.9, 0.4), vec3f(0.2, 0.5, 1));
          return Out(vec4f(p[i], 0, 1), c[i]);
        }
        @fragment fn fs(in: Out) -> @location(0) vec4f { return vec4f(in.col, 1); }`;
      const module = device.createShaderModule({ code });
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        clearValue: { r: 0.06, g: 0.09, b: 0.16, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipeline);
      pass.draw(3);
      pass.end();
      device.queue.submit([enc.finish()]);
      msg.textContent = 'Нарисовано через WebGPU.';
    }
  </script>
</body>
</html>
```

</details>

## 10. Производительность и доступность 3D

- **Меньше вызовов рисования.** Каждый `draw*` стоит времени CPU; объединяйте геометрию,
  используйте инстансинг (`drawArraysInstanced`).
- **Не читайте с GPU синхронно.** `gl.readPixels` и `getError` в цикле останавливают конвейер,
  заставляя CPU ждать GPU — аналог принудительной раскладки из курса о производительности.
- **Ограничивайте DPR** и размер буфера для тяжёлых сцен; на телефоне можно рисовать в
  пониженном разрешении.
- **`prefers-reduced-motion`**: вращение и параллакс могут вызывать укачивание — дайте паузу.
- **Холст непрозрачен для экранных дикторов.** Дайте текстовую альтернативу: подпись,
  `aria-label` или скрытый HTML-эквивалент, а интерактивные элементы — обычными кнопками рядом.
- **Запасной путь**: нет WebGPU — WebGL; нет WebGL — статичное изображение.

## Итог

- CSS 3D: `perspective` на родителе — общая сцена, `preserve-3d` — общее пространство для детей,
  `backface-visibility` — изнанка. `overflow`, `opacity`, `filter` на контейнере сплющивают 3D.
- Canvas — немедленный режим: холст не помнит фигур. Canvas 2D для 2D, WebGL — универсальный GPU,
  WebGPU — современный и явный.
- Конвейер: вершины → вершинный шейдер → отсечение и деление на `w` → растеризация с
  интерполяцией → фрагментный шейдер → тест глубины.
- У холста два размера: буфер и CSS. Буфер = CSS-размер × `devicePixelRatio`, иначе мыло.
- Цикл на `requestAnimationFrame`: состояние от времени, ограниченный `dt`, ресурсы — один раз.
- Матрицы 4 × 4 с однородными координатами объединяют поворот, масштаб, сдвиг и перспективу;
  порядок умножения важен — как и порядок функций в CSS `transform`.

## Проверьте себя

1. Чем `perspective: 500px` на родителе отличается от `transform: perspective(500px)` у каждого
   ребёнка? Что увидите на ряду из четырёх повёрнутых карточек?
2. Куб на CSS внезапно стал плоским после добавления `overflow: hidden` к контейнеру. Почему и
   как исправить?
3. На каком шаге конвейера из трёх цветов вершин получается градиент?
4. Холст 300 × 150 растянут CSS на всю ширину экрана телефона с DPR 3. Что не так и как это
   исправить?
5. Почему для сдвига нужна матрица 4 × 4, а не 3 × 3 в трёхмерном пространстве?
6. Почему `rotate(45deg) translateX(100px)` и `translateX(100px) rotate(45deg)` дают разный
   результат?

Это последний курс программы. Вернуться к началу: [Документ HTML](LEARN_HTML_DOCUMENT_COURSE.md).
