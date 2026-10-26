# Цвет и фон

> Курс 18 из программы. Для тех, кто знает блочную модель и каскад и пользуется пользовательскими
> свойствами ([Пользовательские свойства и темы](LEARN_CSS_CUSTOM_PROPERTIES_COURSE.md)). Разберём, как CSS
> описывает цвет, почему «светлота» в HSL обманывает, кто на самом деле рисует фон страницы и почему
> фон «наследуется», хотя `background` не наследуемое свойство.

**Что вы будете понимать после курса**

- чем отличаются записи `#rgb`, `rgb()`, `hsl()`, `oklch()` и что такое **цветовое пространство**;
- почему два цвета HSL с одинаковой светлотой выглядят разными по яркости, а в OKLCH — нет;
- как смешивать цвета (`color-mix()`) и делать полупрозрачные варианты из одного токена;
- что такое `currentColor` и почему это самое недооценённое ключевое слово CSS;
- как устроен фон: слои, порядок рисования, `background-clip` и `background-origin`;
- как фон `body` оказывается на всём **холсте** (canvas) и что из этого следует;
- как строить градиенты без «грязной середины» и как сохранить фоны при печати.

---

## 1. Как CSS записывает цвет

### 1.1. sRGB: три канала

Классические записи описывают одно и то же пространство **sRGB** — стандарт мониторов 1990-х:

```css
color: #2563eb;                 /* шестнадцатеричная: RR GG BB */
color: #2563eb80;               /* + альфа (80 = 128/255 ≈ 50%) */
color: #26e;                    /* краткая: каждая цифра удваивается → #2266ee */
color: rgb(37 99 235);          /* современная запись через пробелы */
color: rgb(37 99 235 / 50%);    /* альфа после косой черты */
color: rgba(37, 99, 235, .5);   /* старая запись с запятыми: тоже работает */
```

С CSS Color Level 4 `rgb()` и `rgba()` — синонимы, альфу принимают обе. Запятые и пробелы нельзя
смешивать в одной функции.

### 1.2. HSL: удобно, но обманчиво

`hsl(тон насыщенность светлота)` — та же sRGB, но в цилиндрических координатах: тон — угол на
цветовом круге (0 — красный, 120 — зелёный, 240 — синий). Удобно для человека: «тот же цвет, но
светлее» — это изменить третье число.

Проблема: светлота в HSL **не соответствует воспринимаемой яркости**. `hsl(60 100% 50%)` (жёлтый) и
`hsl(240 100% 50%)` (синий) имеют одинаковые 50%, но жёлтый глаз видит почти белым, а синий — тёмным.
Палитра, построенная «шагом светлоты», получается неровной, а контраст текста непредсказуем.

### 1.3. OKLCH: воспринимаемые координаты

`oklch(L C H)` описывает цвет в пространстве **Oklab**, построенном так, чтобы равные шаги чисел
давали примерно равные шаги восприятия:

| Компонент | Диапазон | Смысл |
|---|---|---|
| `L` — lightness | 0–1 (или 0–100%) | воспринимаемая светлота |
| `C` — chroma | от 0, на практике до ~0.37 | насыщенность, «сколько цвета» |
| `H` — hue | 0–360 | тон, угол |

<details>
<summary>Одинаковая светлота: HSL против OKLCH</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-colors-backgrounds.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 13px/1.3 system-ui; }
  .row { display: flex; gap: 4px; margin: 6px 0; }
  .row div { flex: 1; height: 56px; border-radius: 6px; display: grid; place-items: center; color: black; }
  .hsl div:nth-child(1) { background: hsl(0 90% 50%); }
  .hsl div:nth-child(2) { background: hsl(60 90% 50%); }
  .hsl div:nth-child(3) { background: hsl(120 90% 50%); }
  .hsl div:nth-child(4) { background: hsl(240 90% 50%); }
  .ok div:nth-child(1) { background: oklch(0.7 0.15 25); }
  .ok div:nth-child(2) { background: oklch(0.7 0.15 100); }
  .ok div:nth-child(3) { background: oklch(0.7 0.15 145); }
  .ok div:nth-child(4) { background: oklch(0.7 0.15 265); }
</style>
</head>
<body>
  <p>hsl(H 90% 50%) — светлота одна, яркость скачет; чёрный текст на синем не читается:</p>
  <div class="row hsl"><div>0</div><div>60</div><div>120</div><div>240</div></div>
  <p>oklch(0.7 0.15 H) — яркость ровная, чёрный текст читается везде:</p>
  <div class="row ok"><div>25</div><div>100</div><div>145</div><div>265</div></div>
</body>
</html>
```

</details>

Практические следствия:

- Палитру строят в OKLCH: фиксируют `C` и `H`, шагают по `L` — ступени получаются ровными.
- Тёмная тема — во многом «отражение» по `L` при том же тоне.
- OKLCH умеет описывать цвета **вне sRGB** (широкий охват Display P3 на современных экранах). Если экран
  их не показывает, браузер **отображает в охват** (gamut mapping) — приближает к ближайшему доступному.

Есть и другие функции: `lab()`, `lch()`, `oklab()`, а также `color(display-p3 1 0 0)` для явного указания
пространства. Для повседневной работы хватает `oklch()`.

### 1.4. Относительный цвет

Синтаксис относительного цвета (relative color syntax) разбирает исходный цвет на каналы и позволяет
собрать новый:

```css
--accent: oklch(0.6 0.2 260);
--accent-hover: oklch(from var(--accent) calc(l - 0.08) c h);   /* чуть темнее */
--accent-soft:  oklch(from var(--accent) l c h / 15%);           /* полупрозрачный */
```

Это вычисляется в браузере, а значит, работает и после смены темы: токен-источник меняется — производные
пересчитываются сами.

## 2. Альфа и прозрачность

Есть три разных способа сделать «прозрачно», и они не взаимозаменяемы:

| Способ | Что становится прозрачным | Создаёт контекст наложения |
|---|---|---|
| альфа в цвете `rgb(0 0 0 / .5)` | только этот цвет (фон, рамка, текст) | нет |
| `opacity: .5` | **весь** элемент с потомками, как одна картинка | да |
| `transparent` | ключевое слово, равное `rgb(0 0 0 / 0)` | нет |

<details>
<summary>Альфа фона против opacity</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-colors-backgrounds.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.4 system-ui; padding: 12px;
    background: repeating-linear-gradient(45deg, #e2e8f0 0 10px, #fff 10px 20px); }
  .box { padding: 14px; margin: 8px 0; border-radius: 8px; color: #0f172a; font-weight: 600; }
  .a { background: rgb(37 99 235 / .4); }
  .b { background: rgb(37 99 235); opacity: .4; }
</style>
</head>
<body>
  <div class="box a">Альфа в фоне: полоски видны сквозь фон, текст чёткий</div>
  <div class="box b">opacity: .4 — прозрачен и текст тоже</div>
</body>
</html>
```

</details>

### 2.1. `transparent` в градиентах

Раньше `linear-gradient(red, transparent)` давал сероватую середину: `transparent` — это **прозрачный
чёрный**, и браузер смешивал красный с чёрным. Сегодня спецификация требует интерполяции в
**предумноженной альфе** (premultiplied alpha): цвет с нулевой альфой не вносит свой оттенок, и
переход идёт к прозрачному красному. В старом коде можно встретить `rgb(255 0 0 / 0)` вместо
`transparent` — это обход той исторической ошибки.

## 3. `currentColor`

`currentColor` — значение свойства `color` **того же элемента**. Это ключевое слово уже стоит по
умолчанию во многих местах:

- начальное значение `border-color`, `text-decoration-color`, `column-rule-color`; `caret-color: auto`
  на практике тоже берёт цвет текста;
- `fill="currentColor"` в SVG делает иконку цвета текста.

Отсюда приём: **задавайте только `color`**, а рамки, иконки и подчёркивания пусть следуют за ним.

<details>
<summary>currentColor: один цвет на весь компонент</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-colors-backgrounds.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.4 system-ui; padding: 12px; display: flex; gap: 10px; }
  .tag {
    border: 2px solid;             /* цвет рамки не указан — будет currentColor */
    padding: 6px 10px; border-radius: 999px;
    display: inline-flex; gap: 6px; align-items: center;
    background: color-mix(in oklch, currentColor 12%, transparent);
  }
  .tag svg { width: 16px; height: 16px; }
  .ok { color: #15803d; } .warn { color: #b45309; } .err { color: #b91c1c; }
  .tag:hover { color: #7c3aed; }
</style>
</head>
<body>
  <span class="tag ok"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/></svg>Готово</span>
  <span class="tag warn"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/></svg>Внимание</span>
  <span class="tag err"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/></svg>Ошибка</span>
</body>
</html>
```

</details>

Наведите курсор на любую метку: меняется **одно** свойство `color`, а за ним — рамка, иконка и фон.

Тонкость наследования: в наследуемых свойствах `currentColor` передаётся потомкам **как ключевое слово**,
а не как готовый цвет. Свойство `fill` в SVG наследуется, поэтому `fill: currentColor` на `<svg>` у
каждого потомка означает **его собственный** `color`: задайте `<path>` свой `color` — и он перекрасится,
хотя `fill` объявлен на предке.

## 4. `color-mix()`

```css
color-mix(in oklch, var(--accent) 30%, white)
```

Смешивает два цвета в указанном пространстве. Пространство меняет результат:

- `in srgb` — смешивание чисел каналов; серединка синего с жёлтым получается серой;
- `in oklab` — по восприятию, ровный переход без «грязи»;
- `in oklch` — через тон, середина синего и жёлтого может уйти через зелёный или красный
  (можно задать направление: `in oklch longer hue`).

<details>
<summary>Смешивание в разных пространствах</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-colors-backgrounds.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 13px/1.3 system-ui; }
  .row { display: grid; grid-template-columns: 90px repeat(5, 1fr); gap: 4px; align-items: center; margin: 4px 0; }
  .row div { height: 40px; border-radius: 4px; }
  .s div:nth-of-type(1) { background: color-mix(in srgb, blue 100%, yellow); }
  .s div:nth-of-type(2) { background: color-mix(in srgb, blue 75%, yellow); }
  .s div:nth-of-type(3) { background: color-mix(in srgb, blue 50%, yellow); }
  .s div:nth-of-type(4) { background: color-mix(in srgb, blue 25%, yellow); }
  .s div:nth-of-type(5) { background: color-mix(in srgb, blue 0%, yellow); }
  .l div:nth-of-type(1) { background: color-mix(in oklab, blue 100%, yellow); }
  .l div:nth-of-type(2) { background: color-mix(in oklab, blue 75%, yellow); }
  .l div:nth-of-type(3) { background: color-mix(in oklab, blue 50%, yellow); }
  .l div:nth-of-type(4) { background: color-mix(in oklab, blue 25%, yellow); }
  .l div:nth-of-type(5) { background: color-mix(in oklab, blue 0%, yellow); }
  .h div:nth-of-type(1) { background: color-mix(in oklch, blue 100%, yellow); }
  .h div:nth-of-type(2) { background: color-mix(in oklch, blue 75%, yellow); }
  .h div:nth-of-type(3) { background: color-mix(in oklch, blue 50%, yellow); }
  .h div:nth-of-type(4) { background: color-mix(in oklch, blue 25%, yellow); }
  .h div:nth-of-type(5) { background: color-mix(in oklch, blue 0%, yellow); }
</style>
</head>
<body>
  <div class="row s"><span>in srgb</span><div></div><div></div><div></div><div></div><div></div></div>
  <div class="row l"><span>in oklab</span><div></div><div></div><div></div><div></div><div></div></div>
  <div class="row h"><span>in oklch</span><div></div><div></div><div></div><div></div><div></div></div>
</body>
</html>
```

</details>

Типовые применения: оттенок для фона (`color-mix(in oklab, var(--accent) 10%, var(--bg))`), состояние
наведения (смешать с чёрным на 15%), полупрозрачный вариант (`color-mix(in srgb, var(--accent) 40%,
transparent)`). Если проценты в сумме меньше 100%, остаток превращается в прозрачность.

## 5. Фон: слои и порядок рисования

### 5.1. Свойства `background`

| Свойство | Начальное значение | Смысл |
|---|---|---|
| `background-color` | `transparent` | один цвет под всеми слоями |
| `background-image` | `none` | список изображений/градиентов через запятую |
| `background-position` | `0% 0%` | точка привязки |
| `background-size` | `auto` | размер слоя: `cover`, `contain`, длины |
| `background-repeat` | `repeat` | повтор |
| `background-origin` | `padding-box` | от какой коробки считается позиция |
| `background-clip` | `border-box` | до какой коробки рисуется |
| `background-attachment` | `scroll` | привязка к элементу, вьюпорту (`fixed`) или содержимому (`local`) |

`background` — краткая запись, которая **сбрасывает все** эти свойства. Частая ошибка:

```css
.a { background-image: url(pattern.svg); }
.a.active { background: red; }   /* картинка пропала: краткая запись сбросила background-image в none */
```

Если хотите сменить только цвет — пишите `background-color`.

### 5.2. Слои

`background-image` принимает список. **Первый слой — верхний.** Цвет всегда под всеми слоями и указывается
только в последнем слое краткой записи.

```css
background:
  url(badge.svg) right 8px top 8px / 24px no-repeat,    /* верхний */
  linear-gradient(to bottom, transparent, rgb(0 0 0 / .6)),
  url(photo.jpg) center / cover,                         /* нижний слой картинок */
  #334155;                                               /* цвет — под всеми */
```

Остальные свойства (`background-size`, `-position`…) тоже списки: i-е значение — для i-го слоя.
Если значений меньше, список повторяется.

### 5.3. Порядок рисования коробки

Для одного элемента браузер рисует в таком порядке (упрощённо, по модели CSS 2.1, приложение E):

1. `background-color`;
2. фоновые изображения — от **последнего** к первому;
3. рамка (`border`);
4. потомки и содержимое (текст поверх);
5. `outline` — поверх всего.

Отсюда «загадка» из курса о блочной модели: фон **не наследуется**. Ребёнок с `background: transparent`
просто не рисует ничего, и сквозь него виден фон предка. Проверить легко: задайте ребёнку
`background: inherit` — у него появится **свой** фон, и картинка-градиент начнётся заново от его
краёв.

<details>
<summary>Фон не наследуется: он просвечивает</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-colors-backgrounds.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px/1.4 system-ui; }
  .parent { background: linear-gradient(90deg, #fde68a, #f472b6); padding: 12px; }
  .child { border: 2px dashed #334155; padding: 10px; margin: 8px 0; }
  .inh { background: inherit; }
</style>
</head>
<body>
  <div class="parent">
    <div class="child">background по умолчанию transparent: градиент родителя виден насквозь и непрерывен</div>
    <div class="child inh">background: inherit — свой градиент, он начинается заново от краёв этого блока</div>
  </div>
</body>
</html>
```

</details>

### 5.4. `background-clip` и `background-origin`

Две независимые настройки:

- **origin** — система координат: от края какой коробки отсчитываются `position` и `size` (`border-box`,
  `padding-box`, `content-box`);
- **clip** — область, за пределами которой фон обрезается (те же значения плюс `text`).

По умолчанию origin — `padding-box`, а clip — `border-box`. Поэтому повторяющаяся картинка уходит под
пунктирную рамку, начиная от внутреннего края рамки, а цвет фона заполняет и область под рамкой.

<details>
<summary>clip и origin на одной коробке</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-colors-backgrounds.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 13px/1.3 system-ui; display: flex; gap: 12px; flex-wrap: wrap; }
  .b {
    width: 150px; height: 90px; padding: 14px;
    border: 12px dashed rgb(15 23 42 / .5);
    background: #fde68a url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Ccircle cx='10' cy='10' r='6' fill='%232563eb'/%3E%3C/svg%3E");
  }
  .c1 { background-clip: padding-box; }
  .c2 { background-clip: content-box; }
  .o1 { background-origin: border-box; }
  .o2 { background-origin: content-box; background-repeat: no-repeat; }
</style>
</head>
<body>
  <div class="b">по умолчанию: origin padding, clip border</div>
  <div class="b c1">clip: padding-box — под рамкой пусто</div>
  <div class="b c2">clip: content-box</div>
  <div class="b o1">origin: border-box — узор от внешнего края</div>
  <div class="b o2">origin: content-box, no-repeat</div>
</body>
</html>
```

</details>

`background-clip: text` обрезает фон по глифам текста. Текст при этом нужно сделать прозрачным
(`color: transparent`), иначе он закроет фон. Для доступности держите запасной цвет: если фон не
загрузится, прозрачный текст исчезнет.

### 5.5. Приём: рамка-градиент

Два слоя с разным `clip`: нижний — градиент до `border-box`, верхний — сплошной цвет до `padding-box`.
Рамка прозрачна, и в её области виден градиент. В отличие от `border-image` скругление `border-radius`
сохраняется.

```css
.gradient-border {
  border: 3px solid transparent;
  border-radius: 12px;
  background:
    linear-gradient(var(--bg), var(--bg)) padding-box,
    linear-gradient(135deg, #7c3aed, #f59e0b) border-box;
}
```

## 6. Распространение фона на холст

Это ответ на вопрос, который озадачивает почти каждого: почему `body { background: navy }` закрашивает
**всё окно**, хотя `body` — блок с отступами 8px и высотой по содержимому?

### 6.1. Холст

Под документом лежит **холст** (canvas) — бесконечная поверхность, на которой рисуется страница. У холста нет
своего свойства `background`. Спецификация (CSS Backgrounds, «The Canvas Background and the Root
Element») говорит:

1. Фон **корневого элемента** (`html`) становится фоном холста и покрывает его целиком, а не только
   коробку `html`. Сам корневой элемент свой фон второй раз не рисует.
2. Если у корня `background-image` равно `none` **и** `background-color` равно `transparent`, а документ — HTML
   и у `html` есть ребёнок `body`, то браузер берёт фон **`body`** и распространяет его на холст. Значение
   `body` при этом **используется как** `transparent`/`none` — второй раз он не рисуется.
3. Если и `body` без фона — холст рисуется цветом, который выбирает браузер (белым, или тёмным при
   `color-scheme: dark`).

### 6.2. Следствия

- Фон `body` заполняет окно даже на пустой странице. Это не «высота 100%», это холст.
- Как только вы зададите фон **`html`**, правило 2 перестаёт работать: фон `body` снова рисуется
  только в пределах его коробки — со всеми отступами и короткой высотой.
- Картинка-фон, распространённая на холст, **позиционируется относительно корневого элемента**
  (не вьюпорта и не `body`). `background-attachment: fixed` при этом привязывает её к вьюпорту.
- Распространяется только **фон**. `border`, `padding`, `box-shadow` у `body` остаются на месте.
- Правило — для HTML-документов. В XHTML, отданном как XML, распространения с `body` нет.

<details>
<summary>Распространение: фон body на холсте</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-colors-backgrounds.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { background: #1e3a8a; color: white; font: 15px/1.4 system-ui; outline: 3px dashed #fde047; }
</style>
</head>
<body>
  <p>Жёлтый пунктир — коробка body. Синий фон заполняет всё окно: это холст.</p>
</body>
</html>
```

</details>

<details>
<summary>Тот же body, но у html есть свой фон</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-colors-backgrounds.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  html { background: #e2e8f0; }
  body { background: #1e3a8a; color: white; font: 15px/1.4 system-ui; outline: 3px dashed #fde047; }
</style>
</head>
<body>
  <p>У html появился фон — теперь он на холсте, а фон body нарисован только внутри его коробки с отступом 8px.</p>
</body>
</html>
```

</details>

### 6.3. Как пользоваться

- Задавайте фон страницы на **одном** элементе — обычно `body` или `html`, но не оба по разным причинам.
  В темах удобно ставить на `html` (то есть `:root`), где живут токены.
- Не пишите `html, body { height: 100% }` только ради фона — холст и так заполнен.
- Если `body` — колонка фиксированной ширины с другим цветом, задайте фон окна на `html`, а колонке —
  на `body`. Это осознанное отключение распространения.
- Холст без фона получает цвет из `color-scheme`. Поэтому без `color-scheme: dark` тёмная страница
  при прокрутке за край (overscroll) и при загрузке мелькает белым.

## 7. Градиенты

Градиент — это **изображение** (`<image>`), а не цвет. Поэтому его нельзя положить в `background-color`
и его нельзя плавно сменить обычным `transition` по `background-image` (только скачком).

| Функция | Форма |
|---|---|
| `linear-gradient(угол, …)` | вдоль линии; `0deg` — снизу вверх, `90deg` — слева направо, `to right` |
| `radial-gradient(форма размер at позиция, …)` | эллипс или круг |
| `conic-gradient(from угол at позиция, …)` | вокруг точки — диаграммы, цветовые круги |
| `repeating-*` | повтор шаблона остановок |

Тонкости:

- **Остановки** (color stops) могут иметь две позиции: `red 0 30%` — сплошная полоса. Одинаковые позиции
  соседних остановок дают резкую границу — полоски без картинок.
- **Подсказка** (color hint) между остановками сдвигает середину перехода: `red, 30%, blue`.
- **Пространство интерполяции**: `linear-gradient(in oklch, blue, yellow)` — по умолчанию градиенты между
  цветами sRGB интерполируются в sRGB (ради совместимости), и середина синего с жёлтым сереет. `in oklab`
  убирает «грязь».

<details>
<summary>Градиенты: интерполяция, резкие границы, конический</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-colors-backgrounds.html#example-9">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 13px/1.3 system-ui; }
  .g { height: 44px; border-radius: 6px; margin: 6px 0; display: flex; align-items: center; padding-left: 8px; color: white; text-shadow: 0 0 3px black; }
  .a { background: linear-gradient(90deg, blue, yellow); }
  .b { background: linear-gradient(in oklab 90deg, blue, yellow); }
  .c { background: linear-gradient(90deg, #ef4444 0 33%, #f59e0b 33% 66%, #22c55e 66%); }
  .d { background: repeating-linear-gradient(45deg, #334155 0 8px, #fde047 8px 16px); }
  .pie { width: 120px; height: 120px; border-radius: 50%;
    background: conic-gradient(#2563eb 0 40%, #f59e0b 0 70%, #10b981 0); }
</style>
</head>
<body>
  <div class="g a">по умолчанию (sRGB): серая середина</div>
  <div class="g b">in oklab: чистый переход</div>
  <div class="g c">резкие границы: позиции совпадают</div>
  <div class="g d">repeating-linear-gradient: полосы</div>
  <div class="pie" title="40%, 30%, 30%"></div>
</body>
</html>
```

</details>

В круговой диаграмме вторая позиция `0` значит «не раньше предыдущей остановки» — позиция,
меньшая предыдущей, поднимается до неё. Так пишут сегменты, не повторяя чисел.

## 8. Печать и `print-color-adjust`

При печати браузеры по умолчанию **не печатают фоны** — экономят чернила. Пользователь включает их
галочкой в диалоге печати. Автор может попросить:

```css
.badge, .chart { print-color-adjust: exact; }   /* сохранить фоны и цвета как есть */
```

- `economy` (по умолчанию) — браузер вправе убрать фоны и подстроить цвета;
- `exact` — автор просит печатать точно; браузер может учесть, но пользовательская настройка важнее.

В старых WebKit-браузерах нужен префикс: `-webkit-print-color-adjust: exact`. Свойство наследуется,
поэтому можно задать на контейнере. Похожее по смыслу свойство `forced-color-adjust` касается режима
принудительных цветов (высокий контраст Windows): там браузер заменяет ваши цвета системными, и
`forced-color-adjust: none` отключает замену для элемента — пользуйтесь им только там, где цвет несёт
смысл (образцы цветов, диаграммы). Подробнее о печати — в курсе [CSS для печати](LEARN_CSS_PRINT_COURSE.md).

## 9. Контраст

Цвет текста и фона обязан быть различим. WCAG 2 требует отношения контраста не ниже **4.5:1** для
обычного текста и **3:1** для крупного (от 24px, или от 18.66px полужирного), а также 3:1 для границ
элементов управления и значимой графики. Контраст считается по относительной яркости в sRGB.
Полупрозрачный цвет проверяйте **после наложения** на реальный фон. Проверить контраст можно в
инструментах разработчика: они показывают отношение в подсказке выбора цвета. Подробнее — в курсе
[Доступность](LEARN_HTML_ACCESSIBILITY_COURSE.md).

## Итог

- `#hex`, `rgb()`, `hsl()` — одно пространство sRGB; HSL-светлота не равна воспринимаемой яркости.
  Для палитр — `oklch()`.
- Относительный цвет и `color-mix()` строят оттенки из одного токена прямо в браузере. Пространство
  смешивания меняет результат.
- Альфа в цвете прозрачит только этот цвет, `opacity` — весь элемент с потомками.
- `currentColor` — значение `color` элемента; задавайте один `color` — за ним пойдут рамки и иконки.
- Фон не наследуется: прозрачный ребёнок показывает фон предка. Первый слой — верхний, цвет — под всеми.
- По умолчанию `background-origin: padding-box`, `background-clip: border-box`.
- Фон корня — фон холста. Если у корня фона нет, на холст переносится фон `body`; фон `html` отключает
  перенос.
- Градиент — изображение; для чистых переходов — `in oklab`.
- Фоны при печати по умолчанию не печатаются; `print-color-adjust: exact` просит их сохранить.

## Проверьте себя

1. Почему `hsl(60 100% 50%)` и `hsl(240 100% 50%)` нельзя считать одинаково светлыми?
2. В каком порядке рисуются `background-color`, три фоновые картинки и рамка?
3. Вы задали `html { background: white }` и `body { background: #111 }` — почему по краям страницы
   появилась белая рамка?
4. После `.a.active { background: red }` пропала фоновая иконка. Почему и как исправить?
5. Чем `color-mix(in srgb, …)` отличается от `color-mix(in oklab, …)` для синего и жёлтого?
6. Почему прозрачный ребёнок «наследует» фон, если `background` не наследуется?

Дальше: [Типографика](LEARN_CSS_TYPOGRAPHY_COURSE.md).
