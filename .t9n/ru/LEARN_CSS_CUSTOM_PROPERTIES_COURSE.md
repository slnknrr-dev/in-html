# Пользовательские свойства и темы

> Курс 17 из программы. Для тех, кто уже знает каскад, наследование и вычисленные значения
> ([Каскад](LEARN_CSS_CASCADE_COURSE.md)). Здесь мы разберём, чем «переменные» CSS на самом деле
> отличаются от переменных препроцессоров, и построим на них систему тем, которая не мигает и не ломается.

**Что вы будете понимать после курса**

- почему пользовательское свойство — это **свойство**, а не переменная, и что из этого следует;
- почему оно **наследуется**, хотя большинство свойств — нет, и как это использовать;
- в какой момент подставляется `var()` и что значит «недействительно во время вычисления значения»;
- как работают запасные значения и почему `var(--a, var(--b, red))` — нормальная практика;
- что даёт регистрация через `@property` и зачем она нужна анимациям;
- как устроена тема: `prefers-color-scheme`, ручное переключение через `data-theme`, свойство `color-scheme`;
- как организовать **дизайн-токены** в два уровня, чтобы тема менялась одной строкой.

---

## 1. Это свойство, а не переменная

Объявление `--accent: #2563eb` выглядит как присваивание, но по спецификации (CSS Custom Properties for
Cascading Variables) это **пользовательское свойство** (custom property). Оно живёт по тем же правилам,
что `color` или `margin`:

| Вопрос | Ответ для пользовательского свойства |
|---|---|
| Где объявляется? | в блоке объявлений правила, как любое свойство |
| Как выбирается победитель? | каскадом: происхождение, `!important`, слои, специфичность, порядок |
| Наследуется? | **да**, по умолчанию |
| Начальное значение (initial)? | «гарантированно недействительное» (guaranteed-invalid value) |
| Разбирается ли значение? | почти нет: хранится как последовательность токенов |
| Чувствительно к регистру имени? | **да**: `--Accent` и `--accent` — два разных свойства |

Препроцессорная переменная (`$accent` в Sass) исчезает при сборке: в CSS попадает уже готовое значение.
Пользовательское свойство доживает до браузера, участвует в каскаде **для каждого элемента отдельно** и
может меняться в медиазапросе, по `:hover` или из JavaScript. Это главное различие.

```css
:root   { --gap: 8px; }
.cards  { --gap: 24px; }   /* внутри .cards — своё значение */
.item   { margin: var(--gap); }
```

Элемент `.item` внутри `.cards` получит 24px, снаружи — 8px. Ни одна переменная Sass так не умеет:
у неё лексическая область видимости (по тексту файла), а здесь — **по дереву документа**.

### 1.1. Значение почти не проверяется

Парсер почти не проверяет значение пользовательского свойства. Запрещены лишь несбалансированные скобки,
одиночные `;` и `!` вне `!important` на верхнем уровне и ещё несколько токенов. Всё остальное сохраняется
как есть:

```css
:root {
  --shadow: 0 1px 2px rgb(0 0 0 / .2);   /* кусок значения box-shadow */
  --font: 600 1rem/1.4 system-ui;         /* кусок font */
  --nonsense: {}{}ага;                    /* тоже допустимо — проверят при использовании */
}
```

Ошибка «не того типа» обнаружится только там, где значение подставят. Отсюда весь раздел 3.

## 2. Наследование: почему тема «протекает» вниз

Большинство свойств, связанных с коробками (`margin`, `border`, `background`), **не наследуются**.
Пользовательские свойства — наследуются. Поэтому объявление на `:root` видно во всём документе: каждый
элемент получает значение от родителя, если сам его не переопределил.

Важная тонкость: наследуется **вычисленное значение** (computed value) пользовательского свойства, а для
незарегистрированного свойства это та же последовательность токенов, где уже подставлены `var()`. Сами
`em` или `%` внутри **не** пересчитываются — они пока просто текст.

<details>
<summary>Тема для поддерева: значение переопределяется на контейнере</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-custom-properties.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  :root { --bg: #f1f5f9; --fg: #0f172a; --accent: #2563eb; }
  .danger { --accent: #dc2626; --bg: #fef2f2; }
  .box {
    background: var(--bg); color: var(--fg);
    border: 3px solid var(--accent);
    padding: 12px; margin: 8px; border-radius: 8px;
    font: 15px/1.4 system-ui;
  }
  button { background: var(--accent); color: white; border: 0; padding: 6px 12px; border-radius: 6px; }
</style>
</head>
<body>
  <div class="box">Обычный блок <button>Кнопка</button></div>
  <div class="box danger">
    Блок .danger — свойства переопределены здесь
    <div class="box">Вложенный блок ничего не объявляет, но наследует --accent и --bg <button>Кнопка</button></div>
  </div>
</body>
</html>
```

</details>

Вложенный блок не знает о `.danger`: он просто унаследовал значения от родителя. Компонент
не нужно переписывать под каждую тему — достаточно переопределить свойства на предке.

### 2.1. Ловушка: вычисление происходит там, где объявлено

```css
:root  { --size: 1em; --pad: calc(var(--size) * 2); }
.big   { --size: 2em; font-size: 20px; padding: var(--pad); }
```

Многие ожидают, что `.big` получит `padding: calc(2em * 2)`. Но `--pad` вычислено **на `:root`**: туда
подставлено `--size` корня, и наследуется уже готовая строка `calc(1em * 2)`. Переопределение `--size`
на `.big` на `--pad` не влияет. А вот `1em` в этой строке относится уже к `.big` (40px), потому что
единицы разрешаются там, где значение используется обычным свойством.

Решение — объявлять производное свойство там же, где меняется исходное, или на универсальном селекторе
(с оглядкой на стоимость):

<details>
<summary>Производное свойство: где оно вычисляется</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-custom-properties.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.4 system-ui; }
  :root { --hue: 220; --color: hsl(var(--hue) 80% 45%); }
  .a { --hue: 0; }
  .b { --hue: 0; --color: hsl(var(--hue) 80% 45%); }
  .box { color: white; background: var(--color); padding: 10px; margin: 6px; border-radius: 6px; }
</style>
</head>
<body>
  <div class="box">Корень: --hue 220, синий</div>
  <div class="box a">.a: --hue: 0, но --color уже вычислен на :root — всё ещё синий</div>
  <div class="box b">.b: --color объявлен заново рядом с --hue — красный</div>
</body>
</html>
```

</details>

### 2.2. Отключение наследования

Иногда наследование мешает: например, `--span` для одной карточки сетки не должен перейти к её детям.
Есть три пути:

1. Сбрасывать на детях: `.card > * { --span: initial; }`.
2. Зарегистрировать свойство с `inherits: false` (раздел 5).
3. Использовать свойство только на том элементе, которому оно адресовано, и не рассчитывать на значение
   «снизу».

## 3. Подстановка и «недействительно во время вычисления»

### 3.1. Когда подставляется `var()`

Браузер разбирает `color: var(--fg)` при загрузке CSS и **не может** знать, что окажется в `--fg` —
это зависит от элемента. Поэтому объявление с `var()` при разборе считается допустимым всегда, а
подстановка происходит **во время вычисления значения** (computed-value time), отдельно для каждого
элемента.

Следствие, которое удивляет: обычное правило запасного варианта «напиши два объявления, браузер возьмёт
последнее понятное» **не работает** с `var()`.

```css
.x {
  color: red;
  color: var(--maybe-not-a-color);   /* при разборе допустимо — значит, побеждает в каскаде */
}
```

Каскад уже выбрал второе объявление. Если после подстановки окажется, что `--maybe-not-a-color: 20px`,
вернуться к `red` невозможно: первое объявление давно отброшено.

### 3.2. Что тогда происходит

Значение становится **недействительным во время вычисления** (invalid at computed-value time, IACVT).
Свойство ведёт себя как `unset`:

- наследуемое (`color`, `font-size`) — получает значение родителя;
- ненаследуемое (`background-color`, `margin`) — получает начальное значение (`transparent`, `0`).

<details>
<summary>IACVT: неверный тип после подстановки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-custom-properties.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.4 system-ui; color: green; }
  .box { --c: 20px; padding: 10px; margin: 6px; border: 2px dashed #94a3b8; }
  .one { color: red; color: var(--c); }
  .two { background: yellow; background-color: var(--c); }
</style>
</head>
<body>
  <div class="box one">color: red, затем color: var(--c) со значением 20px.
    Текст не красный, а зелёный — унаследован от body.</div>
  <div class="box two">background-color: var(--c) недействителен — фон прозрачный (initial), а не жёлтый.</div>
</body>
</html>
```

</details>

Если пользовательское свойство вообще не определено (или равно `initial`), это тоже приводит к IACVT,
если не указан запасной вариант.

### 3.3. Циклы

```css
:root { --a: var(--b); --b: var(--a); }
```

Свойства, участвующие в цикле, становятся гарантированно недействительными, а с ними и все `var()`, которые
на них ссылаются. Для незарегистрированных свойств зависимость через единицы циклом не считается:
`--x: 2em; font-size: var(--x);` на одном элементе — нормально, потому что `--x` хранит токены, а не длину.
Для свойства, зарегистрированного с типом `<length>` (раздел 5), то же сочетание уже цикл: чтобы вычислить
`2em` в пиксели, нужен `font-size`, а `font-size` ждёт `--x`.

## 4. Запасные значения

Второй аргумент `var()` — **запасное значение** (fallback). Оно используется, когда свойство не определено
или гарантированно недействительно:

```css
color: var(--fg, #111);
font-family: var(--font, system-ui, sans-serif);  /* всё после первой запятой — одно запасное значение */
border-color: var(--accent, var(--brand, currentColor));  /* цепочка */
```

| Ситуация | Что подставится в `var(--x, blue)` |
|---|---|
| `--x` не объявлено нигде | `blue` |
| `--x: initial` | `blue` |
| `--x: red` | `red` |
| `--x: 20px` (неверный тип для свойства) | `20px` → IACVT. Запасное **не** используется |
| `--x: ;` (пустое значение) | пусто → для `color` это IACVT |

Третья строка — самое частое недоразумение: запасное значение срабатывает при **отсутствии** значения,
а не при **неподходящем**. Проверка типа появляется только после регистрации через `@property`.

### 4.1. Пустое значение как переключатель

Пустое значение допустимо и полезно для приёма «переключатель» (space toggle): одно свойство равно
либо пробелу (пусто), либо `initial`.

```css
.card       { --dark: initial; }        /* выключено: var(--dark) недействителен */
.card.night { --dark: ; }               /* включено: пусто */
.card {
  /* включено: получится « #111»; выключено: IACVT, фон станет initial */
  background: var(--dark) #111;
}
```

Приём хрупкий и сегодня его вытесняют `@container style()` и `light-dark()`, но в старом коде он
встречается, и понимать его полезно: это прямое следствие правил подстановки.

## 5. `@property`: свойство с типом

Незарегистрированное свойство — просто текст. Браузер не знает, что `--angle: 30deg` — угол, поэтому
не может его **интерполировать**: переход меняет значение скачком на середине длительности.
Регистрация решает это:

```css
@property --angle {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}
```

| Дескриптор | Смысл |
|---|---|
| `syntax` | грамматика: `'<length>'`, `'<color>'`, `'<number> \| <percentage>'`, `'<length>+'`, `'*'` (любое) |
| `inherits` | обязательный: наследовать ли значение |
| `initial-value` | обязательно, если `syntax` не `'*'`; должно быть вычислительно независимым (не `em`, не `var()`) |

Что меняется после регистрации:

1. **Тип проверяется при вычислении.** Неподходящее значение даёт `initial-value`, а не IACVT для
   соседних свойств.
2. **Вычисленное значение — настоящее.** `--w: 2em` для `<length>` вычисляется в пиксели на
   том элементе, где объявлено, и наследуется уже как длина.
3. **Появляется интерполяция.** Можно анимировать угол градиента, цвет, число.
4. `inherits: false` отрезает наследование.

<details>
<summary>Анимация угла градиента: зарегистрированное и обычное свойство</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-custom-properties.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  @property --a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
  body { font: 14px/1.4 system-ui; display: flex; gap: 16px; }
  .g {
    width: 160px; height: 120px; border-radius: 10px;
    display: grid; place-items: center; color: white; text-align: center;
    background: linear-gradient(var(--a, 0deg), #7c3aed, #f59e0b);
    transition: --a 1s, --b 1s;
  }
  .g:hover { --a: 180deg; --b: 180deg; }
  .plain { background: linear-gradient(var(--b, 0deg), #7c3aed, #f59e0b); }
</style>
</head>
<body>
  <div class="g">@property --a<br>наведите курсор: плавно</div>
  <div class="g plain">обычное --b<br>наведите курсор: скачок</div>
</body>
</html>
```

</details>

Регистрировать можно и из JavaScript: `CSS.registerProperty({ name: '--a', syntax: '<angle>',
inherits: false, initialValue: '0deg' })`. Разница: `@property` действует, пока подключена таблица стилей,
а повторный вызов `registerProperty` с тем же именем бросит исключение.

## 6. Пользовательские свойства и JavaScript

```js
const root = document.documentElement;
root.style.setProperty('--accent', '#16a34a');              // инлайн-стиль на <html>
getComputedStyle(root).getPropertyValue('--accent');         // ' #16a34a' или '#16a34a'
root.style.removeProperty('--accent');
```

- Обращаться нужно через `setProperty`/`getPropertyValue`: запись `style['--accent']` не работает в старых
  движках, а `style.accent` — вообще другое.
- Для незарегистрированного свойства `getPropertyValue` вернёт токены как есть; ведущие пробелы
  браузеры сейчас обрезают, но на это лучше не полагаться — делайте `.trim()`.
- Одна запись `--x` на корне пересчитывает стиль всех потомков, которые его используют. Для частых
  изменений (координаты курсора) ставьте свойство на **ближайший** нужный элемент, а не на `:root`.

<details>
<summary>Свойство как канал из JavaScript в CSS</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-custom-properties.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px/1.4 system-ui; margin: 0; }
  .pad {
    --x: 50%; --y: 50%;
    height: 200px; margin: 12px; border-radius: 12px; border: 2px solid #334155;
    background: radial-gradient(circle at var(--x) var(--y), #fde047, #0f172a 40%);
    display: grid; place-items: center; color: white;
  }
</style>
</head>
<body>
  <div class="pad">Водите курсором по прямоугольнику</div>
  <script>
    const pad = document.querySelector('.pad');
    pad.addEventListener('pointermove', e => {
      const r = pad.getBoundingClientRect();
      // Записываем только свойства, логика рисования остаётся в CSS
      pad.style.setProperty('--x', (e.clientX - r.left) + 'px');
      pad.style.setProperty('--y', (e.clientY - r.top) + 'px');
    });
  </script>
</body>
</html>
```

</details>

Разделение ответственности: скрипт сообщает **данные** (координаты), CSS решает, **как** их показывать.
Тот же приём используют для прогресса (`--progress: 0.42`) и для размеров, измеренных скриптом.

## 7. Темы: светлая и тёмная

### 7.1. Свойство `color-scheme`

Прежде чем менять свои цвета, нужно сообщить браузеру, в каких схемах страница умеет отображаться:

```css
:root { color-scheme: light dark; }
```

или в разметке, раньше стилей, чтобы браузер знал это до первой отрисовки:

```html
<meta name="color-scheme" content="light dark">
```

Что это меняет:

- **canvas** (холст под страницей) и стандартные цвета текста становятся тёмными в тёмной схеме;
- элементы форм, полосы прокрутки, `<select>`, флажки рисуются в тёмном варианте;
- системные цвета (`Canvas`, `CanvasText`, `LinkText`) получают тёмные значения;
- работает функция `light-dark(светлый, тёмный)`.

Без `color-scheme` вы можете перекрасить фон в чёрный, но полоса прокрутки и поля ввода останутся
светлыми, а при загрузке мелькнёт белый холст.

### 7.2. Узнать предпочтение пользователя

Медиазапрос `prefers-color-scheme: dark` отражает настройку операционной системы или браузера. Самая
простая тема — без единой строки JavaScript:

<details>
<summary>Тема по системной настройке</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-custom-properties.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<style>
  :root { --bg: #ffffff; --fg: #1e293b; --muted: #64748b; --accent: #2563eb; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0f172a; --fg: #e2e8f0; --muted: #94a3b8; --accent: #60a5fa; }
  }
  body { background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui; padding: 12px; }
  small { color: var(--muted); }
  a { color: var(--accent); }
</style>
</head>
<body>
  <p>Переключите тему системы — цвета изменятся. <a href="#">Ссылка</a></p>
  <p><small>Поле ввода и прокрутка следуют color-scheme:</small> <input value="текст"> <input type="checkbox" checked></p>
</body>
</html>
```

</details>

### 7.3. Ручной переключатель: шаблон `data-theme`

Пользователь хочет переопределить системную настройку на одном сайте. Нужно три состояния: «как в системе»,
«светлая», «тёмная». Стандартный шаблон — атрибут на `<html>`:

```css
:root {                                  /* светлая по умолчанию */
  color-scheme: light;
  --bg: #fff; --fg: #1e293b;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {      /* система тёмная и пользователь не выбрал светлую */
    color-scheme: dark;
    --bg: #0f172a; --fg: #e2e8f0;
  }
}
:root[data-theme="dark"] {               /* явный выбор тёмной — при любой системе */
  color-scheme: dark;
  --bg: #0f172a; --fg: #e2e8f0;
}
```

Почему именно так:

- `:not([data-theme="light"])` позволяет явному выбору светлой темы победить системную тёмную;
- `:root[data-theme="dark"]` вне медиазапроса включает тёмную тему, даже если система светлая;
- специфичность: `:root` — (0,1,0), `:root:not([…])` и `:root[…]` — (0,2,0), так что правила тем
  побеждают базовое независимо от порядка;
- тёмные значения повторены дважды. От повтора избавляют `light-dark()` или токены второго уровня (раздел 8).

<details>
<summary>Три состояния темы: система, светлая, тёмная</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-custom-properties.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: light; --bg: #f8fafc; --fg: #0f172a; --card: #ffffff; --line: #cbd5e1; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { color-scheme: dark; --bg: #020617; --fg: #e2e8f0; --card: #1e293b; --line: #475569; }
  }
  :root[data-theme="dark"] { color-scheme: dark; --bg: #020617; --fg: #e2e8f0; --card: #1e293b; --line: #475569; }
  body { background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui; padding: 12px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
  button[aria-pressed="true"] { outline: 2px solid #3b82f6; }
</style>
</head>
<body>
  <div class="card">
    <p>Нажмите кнопку: выбор хранится в атрибуте data-theme на html.</p>
    <button data-v="">Как в системе</button>
    <button data-v="light">Светлая</button>
    <button data-v="dark">Тёмная</button>
    <p>Сейчас: <code id="out"></code></p>
  </div>
  <script>
    const html = document.documentElement;
    function set(v) {
      if (v) html.dataset.theme = v; else delete html.dataset.theme;
      document.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v));
      document.getElementById('out').textContent = v ? 'data-theme="' + v + '"' : 'атрибута нет';
    }
    document.querySelectorAll('button').forEach(b => b.onclick = () => set(b.dataset.v));
    set('');
  </script>
</body>
</html>
```

</details>

### 7.4. Без мигания при загрузке

Если выбор хранится в `localStorage` и применяется скриптом в конце `body`, страница сначала
отрисуется в системной теме, а потом перекрасится — «вспышка неправильной темы». Лекарство:
**маленький синхронный скрипт в `<head>`** до таблиц стилей.

```html
<head>
  <meta charset="utf-8">
  <script>
    try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
  </script>
  <link rel="stylesheet" href="site.css">
</head>
```

Синхронный скрипт блокирует парсер, но он крошечный и не обращается к сети. `try` нужен, потому что
доступ к хранилищу может бросить исключение (приватный режим, запрет cookies).

### 7.5. `light-dark()`

Функция `light-dark(a, b)` возвращает первый цвет при используемой схеме `light` и второй — при `dark`.
Схему определяет свойство `color-scheme` **этого элемента** (оно наследуется), а не медиазапрос:

```css
:root { color-scheme: light dark; }
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"]  { color-scheme: dark; }
:root { --bg: light-dark(#fff, #0f172a); --fg: light-dark(#1e293b, #e2e8f0); }
```

Медиазапрос больше не нужен: при `color-scheme: light dark` браузер сам выберет схему по системной
настройке, а атрибут сужает выбор. Ограничение: `light-dark()` принимает только **цвета** (в
текущих браузерах), поэтому тени, картинки и толщины по-прежнему требуют медиазапроса или
отдельных свойств.

<details>
<summary>light-dark() и локальная схема на части страницы</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-custom-properties.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: light; }
  body { font: 15px/1.5 system-ui; padding: 12px; }
  .panel {
    background: light-dark(#e0f2fe, #082f49);
    color: light-dark(#0c4a6e, #e0f2fe);
    border-radius: 10px; padding: 12px; margin: 8px 0;
  }
  .night { color-scheme: dark; }
</style>
</head>
<body>
  <div class="panel">Корень в светлой схеме — первый аргумент <input value="поле"></div>
  <div class="panel night">У этого блока color-scheme: dark — второй аргумент, поле ввода тоже тёмное <input value="поле"></div>
</body>
</html>
```

</details>

## 8. Дизайн-токены

**Токен** — именованное проектное решение: цвет, отступ, радиус, длительность. Пользовательские свойства —
естественный носитель токенов, но одного уровня мало.

### 8.1. Два уровня: примитивы и смысл

```css
:root {
  /* уровень 1 — примитивы: палитра, не зависят от темы */
  --blue-600: #2563eb;  --blue-300: #93c5fd;
  --slate-50: #f8fafc;  --slate-900: #0f172a;

  /* уровень 2 — семантика: «для чего», меняются с темой */
  --color-bg: var(--slate-50);
  --color-fg: var(--slate-900);
  --color-accent: var(--blue-600);
}
:root[data-theme="dark"] {
  --color-bg: var(--slate-900);
  --color-fg: var(--slate-50);
  --color-accent: var(--blue-300);
}
.button { background: var(--color-accent); }   /* компонент знает только семантику */
```

Правила хорошей системы:

- Компоненты ссылаются **только** на семантические токены. Тогда тема — это переназначение второго уровня,
  а не поиск по всем файлам.
- Имена описывают роль (`--color-danger`, `--space-3`), а не внешний вид (`--red`, `--12px`):
  в тёмной теме «опасный» может быть розовым.
- Масштабы (отступы, размеры шрифта) — дискретные ступени: `--space-1 … --space-6`. Это главное оружие
  против «13px тут, 14px там».
- Третий, необязательный уровень — **компонентные** токены: `--button-bg: var(--color-accent)`. Они
  дают точку настройки конкретного компонента без переопределения внутренних правил.

### 8.2. Компонентный API

<details>
<summary>Компонент с настраиваемыми свойствами и умолчаниями</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-custom-properties.html#example-9">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  :root { --color-accent: #2563eb; --radius: 8px; --space-2: 8px; --space-3: 12px; }
  body { font: 15px/1.4 system-ui; padding: 12px; display: flex; gap: 10px; flex-wrap: wrap; }
  .btn {
    /* открытые параметры компонента с запасными значениями */
    background: var(--btn-bg, var(--color-accent));
    border-radius: var(--btn-radius, var(--radius));
    padding: var(--space-2) var(--space-3);
    color: white; border: 0; font: inherit;
  }
  .btn.ghost { --btn-bg: transparent; color: var(--color-accent); outline: 2px solid currentColor; }
  .pill { --btn-radius: 999px; }
  .promo { --color-accent: #db2777; }
</style>
</head>
<body>
  <button class="btn">Обычная</button>
  <button class="btn ghost">Ghost</button>
  <button class="btn pill">Pill</button>
  <span class="promo"><button class="btn">В .promo</button> <button class="btn ghost">Ghost в .promo</button></span>
</body>
</html>
```

</details>

Приём `var(--btn-bg, var(--color-accent))` не объявляет `--btn-bg` на самом компоненте. Будь там
`--btn-bg: var(--color-accent)`, переопределить его с предка было бы невозможно: объявление на
элементе сильнее наследования. Запасное значение оставляет «дырку», которую может заполнить кто угодно
выше по дереву.

### 8.3. Производительность

- Свойства на `:root` наследуются всеми элементами. Сотни токенов — это сотни значений у каждого узла.
  Движки хранят унаследованные данные общими блоками, так что обычно это дёшево. Дорого их **менять**:
  запись в `:root` инвалидирует стиль всего документа.
- Длинные цепочки `var()` в `var()` вычисляются при каждом пересчёте стиля; на практике это заметно
  только в анимациях.
- Свойство с `inherits: false` не копируется потомкам — полезно для «локальных» значений анимации.

## Итог

- Пользовательское свойство — полноценное **свойство**: каскад, наследование, значение для каждого
  элемента. Имя чувствительно к регистру.
- Оно **наследуется** по умолчанию — поэтому тема, объявленная на предке, видна всему поддереву.
- `var()` подставляется во время вычисления значения. Неподходящий тип даёт **IACVT** — свойство ведёт себя
  как `unset`, предыдущее объявление уже не спасёт.
- Запасное значение работает при **отсутствии** значения, а не при неверном типе.
- Производные свойства вычисляются там, где объявлены: переопределение исходного ниже по дереву на них не
  влияет.
- `@property` даёт тип, проверку, настоящее вычисленное значение, интерполяцию и `inherits: false`.
- Тема: `color-scheme` + `prefers-color-scheme` + `data-theme` с `:not([data-theme="light"])`; скрипт выбора — в
  `<head>`; `light-dark()` убирает дублирование цветов.
- Токены — в два уровня: примитивы и семантика; компоненты читают только семантику.

## Проверьте себя

1. Почему после `color: blue; color: var(--x);` текст может оказаться цвета родителя, а не синим?
2. На `:root` объявлено `--gap: 1rem; --gap2: calc(var(--gap) * 2)`. На `.card` переопределено
   `--gap: 2rem`. Чему равен `var(--gap2)` внутри `.card` и почему?
3. В каком случае `var(--c, red)` подставит `red`, а в каком — нет, хотя `--c` «плохое»?
4. Зачем в шаблоне тем селектор `:root:not([data-theme="light"])` внутри медиазапроса?
5. Почему переход по незарегистрированному `--angle` идёт скачком, и что нужно изменить?
6. Что изменится на странице после `color-scheme: light dark`, если ни одного цвета вы не меняли?

Дальше: [Цвет и фон](LEARN_CSS_COLORS_BACKGROUNDS_COURSE.md).
