# Адаптивность: `@media`, контейнерные запросы, viewport

> Курс 16 из программы. Для тех, кто владеет Flexbox, Grid и единицами CSS. Адаптивность — это не
> «три брейкпоинта под телефон, планшет и десктоп», а набор механизмов, каждый из которых отвечает на
> свой вопрос: каков экран, каков контейнер, что предпочитает пользователь.

**Что вы будете понимать после курса**

- что делает `<meta name="viewport">` и что было бы без него;
- как писать медиазапросы: старый синтаксис `min-width` и новый диапазонный `width >= 600px`;
- запросы предпочтений: `prefers-color-scheme`, `prefers-reduced-motion`, `hover`, `pointer` и другие;
- почему «сначала мобильные» (mobile-first) — не мода, а следствие каскада;
- как работают **контейнерные запросы** и единицы `cqi`, `cqw`;
- как сделать плавную типографику через `clamp()` и не сломать масштабирование;
- почему `100vh` на телефоне врёт и что такое `dvh`, `svh`, `lvh`.

---

## 1. Viewport ещё раз

В [первом курсе](LEARN_HTML_DOCUMENT_COURSE.md) мы написали строку:

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

Зачем она? Когда в 2007 году вышел первый iPhone, почти все сайты были свёрстаны под ширину ~1000px.
Мобильный Safari решил так: рисовать страницу в **виртуальном окне шириной 980 CSS-пикселей**, а потом
уменьшать картинку под экран. Сайты выглядели «как на компьютере», только мелко.

Это поведение по умолчанию сохраняется до сих пор: без мета-тега мобильные браузеры считают окно
шириной около 980px. Ваш `@media (width < 600px)` **никогда не сработает**, а текст будет крошечным.

| Часть `content` | Смысл |
|---|---|
| `width=device-width` | ширина окна просмотра (layout viewport) = ширина экрана в CSS-пикселях (например, 390) |
| `initial-scale=1` | начальный масштаб 1:1; также чинит старые ошибки iOS при повороте экрана |
| `maximum-scale=1`, `user-scalable=no` | запрет масштабирования — **не используйте**: это нарушение доступности (WCAG 1.4.4); современный Safari по умолчанию его игнорирует |
| `viewport-fit=cover` | разрешить рисовать под вырезом экрана; затем отступы через `env(safe-area-inset-*)` |
| `interactive-widget=resizes-content` | экранная клавиатура уменьшает окно просмотра, а не накрывает его (Chrome для Android) |

### 1.1. CSS-пиксель — не пиксель экрана

`1px` в CSS — единица, примерно постоянного **углового** размера. На экране с плотностью 3
(`devicePixelRatio = 3`) один CSS-пиксель — это 3×3 физических. Поэтому телефон с экраном 1170
физических пикселей в ширину показывает `device-width` = 390.

Плотность экрана проверяется медиазапросом `resolution`: `@media (resolution >= 2dppx)`. Нужен он
редко — для картинок есть `srcset` (раздел 7).

### 1.2. Два окна просмотра

На мобильных их два:

- **окно раскладки** (layout viewport) — от него считаются `vw`, `%` у `fixed`, медиазапросы;
- **визуальное окно** (visual viewport) — то, что видно прямо сейчас при щипковом масштабировании.

При масштабировании пальцами раскладка не меняется — меняется только визуальное окно. Из JavaScript
оно доступно как `window.visualViewport`.

## 2. Медиазапросы

```css
@media (width >= 600px) {
  .layout { grid-template-columns: 200px 1fr; }
}
```

`@media` — условное групповое правило: правила внутри участвуют в каскаде, только если условие истинно.
Специфичность при этом **не повышается**: правило внутри `@media` конкурирует с внешними по обычным
правилам, поэтому важен порядок в файле.

### 2.1. Типы носителей

`screen`, `print` и `all` — всё, что осталось от длинного списка CSS 2 (`handheld`, `tv`, `tty`, …
устарели и ни с чем не совпадают). Тип можно не писать: по умолчанию `all`.

```css
@media print { nav { display: none; } }   /* см. курс «CSS для печати» */
```

### 2.2. Диапазонный синтаксис

Старый синтаксис — префиксы `min-` и `max-`:

```css
@media (min-width: 600px) and (max-width: 899.98px) { … }
```

Почему `899.98`? Потому что `max-width: 900px` включает 900, а `min-width: 900px` у следующего
диапазона тоже включает 900 — на ровно 900px сработали бы оба. А при дробной ширине окна (масштаб 110 %
даёт и такие) `max-width: 899px` оставлял бы дыру между 899 и 900.

Диапазонный синтаксис (Media Queries Level 4) решает это строгими сравнениями:

```css
@media (600px <= width < 900px) { … }
```

Он поддерживается всеми основными браузерами с 2023 года. Используйте его в новом коде.

### 2.3. Логика

| Запись | Смысл |
|---|---|
| `(a) and (b)` | оба условия |
| `(a), (b)` | или (список запросов через запятую) |
| `(a) or (b)` | или (Level 4) |
| `not (a)` | отрицание |
| `only screen` | исторический трюк, чтобы старые браузеры не поняли запрос; сегодня не нужен |

### 2.4. Почему брейкпоинты в `em`

`@media (width >= 40em)` — в медиазапросах `em` всегда равен **начальному** размеру шрифта браузера
(обычно 16px), а не `font-size` у `html`. Если пользователь увеличил шрифт в настройках до 24px,
брейкпоинт сдвинется до 960px, и раскладка переключится в «узкий» режим, где крупному тексту
просторнее. С `px` такого не будет.

<details>
<summary>Медиазапрос с диапазонным синтаксисом</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-responsive.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 16px system-ui, sans-serif; margin: 16px; }
  .badge { padding: 16px; color: white; background: #64748b; }
  .badge::after { content: "узко: width < 30em"; }
  @media (30em <= width < 50em) {
    .badge { background: #0891b2; }
    .badge::after { content: "средне: 30em <= width < 50em"; }
  }
  @media (width >= 50em) {
    .badge { background: #7c3aed; }
    .badge::after { content: "широко: width >= 50em"; }
  }
</style>
</head>
<body>
  <p>Меняйте ширину окна предпросмотра.</p>
  <div class="badge"></div>
</body>
</html>
```

</details>

## 3. Запросы возможностей и предпочтений

Ширина экрана — плохой заменитель вопроса «есть ли мышь». Планшет с клавиатурой широк и сенсорен,
маленькое окно на ноутбуке узко и с мышью. Для этого есть отдельные признаки.

| Запрос | Значения | Для чего |
|---|---|---|
| `hover` | `hover`, `none` | может ли **основное** устройство ввода наводить курсор |
| `pointer` | `fine`, `coarse`, `none` | точность основного указателя: мышь или палец |
| `any-hover`, `any-pointer` | те же | хотя бы **одно** из подключённых устройств |
| `prefers-color-scheme` | `light`, `dark` | тема системы |
| `prefers-reduced-motion` | `reduce`, `no-preference` | пользователь просит меньше анимации |
| `prefers-contrast` | `more`, `less`, `custom`, `no-preference` | повышенный контраст |
| `forced-colors` | `active`, `none` | режим принудительных цветов (Windows «Контрастные темы») |
| `prefers-reduced-transparency` | `reduce`, `no-preference` | меньше полупрозрачности |
| `orientation` | `portrait`, `landscape` | высота больше ширины или нет |
| `display-mode` | `browser`, `standalone`, … | сайт запущен как установленное приложение |

Примеры:

```css
/* увеличить зону нажатия, если основной указатель — палец */
@media (pointer: coarse) { .btn { min-height: 44px; } }

/* эффекты наведения — только там, где наведение существует */
@media (hover: hover) { .card:hover { transform: translateY(-2px); } }

/* уважать просьбу о меньшей анимации */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
```

Зачем `@media (hover: hover)`? На сенсорном экране `:hover` «залипает» после касания: элемент остаётся в
наведённом состоянии до касания в другом месте. Подробнее — в курсе
[Сенсорный ввод](LEARN_WEB_TOUCH_INPUT_COURSE.md).

Тёмную тему подробно разбирает курс [Пользовательские свойства и темы](LEARN_CSS_CUSTOM_PROPERTIES_COURSE.md);
здесь отметим только, что вместе с `prefers-color-scheme` нужно объявлять `color-scheme: light dark` —
иначе полосы прокрутки и поля формы останутся светлыми.

<details>
<summary>Запросы предпочтений: тема, анимация, указатель</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-responsive.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  body { font: 15px system-ui, sans-serif; margin: 16px; background: #fff; color: #111; }
  @media (prefers-color-scheme: dark) { body { background: #111827; color: #e5e7eb; } }
  li { margin: 6px 0; }
  .yes { display: none; font-weight: bold; color: #16a34a; }
  @media (prefers-color-scheme: dark)      { .dark .yes { display: inline; } }
  @media (prefers-reduced-motion: reduce)  { .motion .yes { display: inline; } }
  @media (hover: hover)                    { .hover .yes { display: inline; } }
  @media (pointer: coarse)                 { .coarse .yes { display: inline; } }
  @media (forced-colors: active)           { .forced .yes { display: inline; } }
  .spin { display: inline-block; animation: spin 2s linear infinite; }
  @keyframes spin { to { transform: rotate(1turn); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
</head>
<body>
  <p>Что сообщает ваше устройство (переключите тему системы и сравните):</p>
  <ul>
    <li class="dark">тёмная тема <span class="yes">да</span></li>
    <li class="motion">меньше анимации <span class="yes">да</span></li>
    <li class="hover">основной указатель умеет наводить <span class="yes">да</span></li>
    <li class="coarse">грубый указатель (палец) <span class="yes">да</span></li>
    <li class="forced">принудительные цвета <span class="yes">да</span></li>
  </ul>
  <p><span class="spin">⚙</span> крутится, если вы не просили меньше анимации</p>
</body>
</html>
```

</details>

Из JavaScript те же запросы проверяются через `matchMedia('(prefers-color-scheme: dark)')`; у
результата есть событие `change`.

## 4. Mobile-first против desktop-first

Два способа организовать одни и те же стили:

```css
/* mobile-first: база — узкая, запросы по min/>= добавляют сложность */
.layout { display: block; }
@media (width >= 48em) { .layout { display: grid; grid-template-columns: 1fr 3fr; } }

/* desktop-first: база — широкая, запросы по max/< отменяют сложность */
.layout { display: grid; grid-template-columns: 1fr 3fr; }
@media (width < 48em) { .layout { display: block; } }
```

Почему почти все выбирают первый:

- **меньше отмен**. Узкая раскладка обычно проще: одна колонка, нормальный поток. Широкая добавляет
  сетку. Добавлять легче, чем отменять: отмена требует знать исходные значения (`grid-template-columns:
  none`, `float: none`, `position: static`…), и каждую отмену легко забыть.
- **каскад работает на вас**. Запросы `>=` идут в порядке возрастания, и каждый следующий переопределяет
  предыдущий — порядок в файле совпадает с логикой.
- **по умолчанию — рабочий вариант**. Если запрос не сработал (старый браузер, странное устройство),
  пользователь получает одну колонку, которая читается везде.

Desktop-first оправдан, когда вы адаптируете старый широкий сайт: проще добавить узкие исключения, чем
переписать всё.

### 4.1. Где ставить брейкпоинты

Не по устройствам («iPhone — 390, iPad — 768»): устройств тысячи и их размеры меняются каждый год.
Ставьте брейкпоинт там, **где ломается ваша вёрстка**: сужайте окно, пока строка не станет слишком
длинной, а колонка слишком узкой. Ещё лучше — обходитесь без брейкпоинтов там, где можно: `auto-fill`
в Grid, `flex-wrap`, `clamp()`, контейнерные запросы.

<details>
<summary>Mobile-first: одна колонка, затем две, затем три</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-responsive.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 15px system-ui, sans-serif; margin: 16px; }
  .layout { display: grid; gap: 8px; }
  .layout > * { padding: 16px; border: 1px solid #334155; }
  nav { background: #fde68a; } main { background: #bbf7d0; } aside { background: #bfdbfe; }
  @media (width >= 36em) {
    .layout { grid-template-columns: 10em 1fr; }
    aside { grid-column: 1 / -1; }
  }
  @media (width >= 56em) {
    .layout { grid-template-columns: 10em 1fr 12em; }
    aside { grid-column: auto; }
  }
</style>
</head>
<body>
  <div class="layout">
    <nav>nav</nav>
    <main>main: база без запросов — одна колонка</main>
    <aside>aside</aside>
  </div>
</body>
</html>
```

</details>

## 5. Контейнерные запросы

Медиазапрос спрашивает про **окно**. Но компонент — карточка товара — может стоять и в узкой боковой
колонке, и в широкой основной, на одном и том же экране. Ему важно, сколько места у **него**.

```css
.slot { container-type: inline-size; }       /* объявили контейнер */

@container (width >= 400px) {                 /* условие о ближайшем контейнере-предке */
  .card { display: grid; grid-template-columns: 120px 1fr; }
}
```

### 5.1. Как это устроено

Проблема, которую решали годами: если стили ребёнка зависят от размера родителя, а размер родителя — от
ребёнка, получается цикл. Решение — **сдерживание** (containment). `container-type: inline-size`
объявляет: «мой строчный размер (ширина) **не зависит от содержимого**». Тогда браузер может сначала
вычислить ширину контейнера, потом применить запросы к детям.

| `container-type` | Что можно спрашивать | Цена |
|---|---|---|
| `normal` (по умолчанию) | только стилевые запросы (`@container style(...)`) | нет |
| `inline-size` | ширину (строчный размер) | ширина контейнера не может зависеть от детей: в shrink-to-fit-контексте (`float`, `inline-block`, `position: absolute` без ширины) он схлопнется в 0 |
| `size` | ширину и высоту | высота тоже не зависит от детей: без явной высоты контейнер станет нулевой высоты |

Почти всегда нужен `inline-size`. Следствия, о которых надо помнить:

- **контейнер не может запросить сам себя** — условие проверяется для потомков, а стилизуются они;
  поэтому часто нужна обёртка-контейнер вокруг компонента;
- контейнер создаёт содержащий блок для `absolute` и `fixed` и контекст наложения (см.
  [Позиционирование](LEARN_CSS_POSITIONING_COURSE.md)).

### 5.2. Имена

```css
.sidebar { container: side / inline-size; }   /* сокращение: имя / тип */
@container side (width < 250px) { … }
```

Без имени запрос обращается к ближайшему контейнеру-предку. С именем — к ближайшему с этим именем.

<details>
<summary>Одна карточка в узкой и широкой колонке</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-responsive.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; margin: 16px; display: grid; grid-template-columns: 180px 1fr; gap: 16px; }
  .slot { container-type: inline-size; outline: 2px dashed #94a3b8; }
  .card { border: 1px solid #0f766e; background: #f0fdfa; padding: 8px; display: grid; gap: 8px; }
  .pic { aspect-ratio: 4 / 3; background: linear-gradient(135deg, #14b8a6, #0e7490); }
  @container (width >= 300px) {
    .card { grid-template-columns: 120px 1fr; align-items: start; }
  }
</style>
</head>
<body>
  <div class="slot">
    <div class="card"><div class="pic"></div><div>Узкая колонка: картинка над текстом</div></div>
  </div>
  <div class="slot">
    <div class="card"><div class="pic"></div><div>Широкая колонка: картинка слева. Окно одно, стили разные.</div></div>
  </div>
</body>
</html>
```

</details>

### 5.3. Контейнерные единицы

Внутри контейнера доступны единицы относительно его размеров:

| Единица | 1 единица = |
|---|---|
| `cqw` / `cqh` | 1 % ширины / высоты контейнера |
| `cqi` / `cqb` | 1 % строчного / блочного размера (логические варианты, предпочтительнее) |
| `cqmin` / `cqmax` | меньшее / большее из `cqi` и `cqb` |

Если подходящего контейнера нет, они считаются от **малого окна просмотра** (как `svw`/`svh`).
Главное применение — размер шрифта, зависящий от ширины компонента: `font-size: clamp(1rem, 5cqi, 2rem)`.

<details>
<summary>Заголовок масштабируется по ширине контейнера</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-responsive.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; margin: 16px; }
  .slot { container-type: inline-size; border: 2px dashed #a855f7; margin-bottom: 12px; padding: 8px; }
  h2 { margin: 0; font-size: clamp(1rem, 8cqi, 3rem); }
</style>
</head>
<body>
  <div class="slot" style="width: 200px"><h2>Заголовок</h2></div>
  <div class="slot" style="width: 360px"><h2>Заголовок</h2></div>
  <div class="slot"><h2>Заголовок</h2></div>
</body>
</html>
```

</details>

### 5.4. Стилевые запросы

`@container style(--variant: compact) { … }` проверяет значение **пользовательского свойства** у
контейнера. В Chrome и Safari работает; в Firefox на момент написания — нет, так что используйте их
только как улучшение.

## 6. Плавная типографика: `clamp()`

Вместо трёх брейкпоинтов для заголовка — одна формула:

```css
h1 { font-size: clamp(1.75rem, 1.2rem + 2.5vw, 3rem); }
```

`clamp(MIN, ЖЕЛАЕМОЕ, MAX)` = `max(MIN, min(ЖЕЛАЕМОЕ, MAX))`. Размер растёт с шириной окна, но не выходит
за пределы.

### 6.1. Почему не просто `5vw`

- `font-size: 5vw` **не реагирует на масштаб страницы** (Ctrl +): при увеличении окно в CSS-пикселях
  сужается, и текст пропорционально становится меньше в CSS-пикселях — на экране размер почти не
  меняется. Это нарушает WCAG 1.4.4 (возможность увеличить текст до 200 %).
- Добавка в `rem` (`1.2rem + 2.5vw`) сохраняет зависимость от настроек шрифта и масштаба. Чем больше доля
  `rem` в формуле, тем честнее масштабирование.

### 6.2. Как вычислить формулу

Хотим 28px при ширине 360px и 48px при 1200px:

```text
наклон   = (48 − 28) / (1200 − 360) = 0.0238  →  2.38vw
смещение = 28 − 0.0238 × 360 = 19.4px ≈ 1.21rem
итог     = clamp(1.75rem, 1.21rem + 2.38vw, 3rem)
```

Ту же формулу можно строить на `cqi` вместо `vw` — тогда шрифт зависит от компонента, а не от окна.

<details>
<summary>clamp против чистого vw</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-responsive.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 16px system-ui, sans-serif; margin: 16px; }
  .a { font-size: 6vw; margin: 0 0 8px; color: #b91c1c; }
  .b { font-size: clamp(1.5rem, 1rem + 3vw, 3rem); margin: 0; color: #15803d; }
  p { color: #555; }
</style>
</head>
<body>
  <h1 class="a">6vw</h1>
  <h1 class="b">clamp(1.5rem, 1rem + 3vw, 3rem)</h1>
  <p>Сужайте окно: красный становится нечитаемо мелким, зелёный упирается в минимум. Расширяйте:
  красный растёт без предела, зелёный останавливается на 3rem.</p>
</body>
</html>
```

</details>

`clamp()` хорош не только для шрифта: `padding: clamp(1rem, 4vw, 3rem)`, `gap`, ширина колонки.

## 7. Адаптивные изображения — коротко

CSS здесь отвечает за немногое: `img { max-width: 100%; height: auto; }` (картинка не шире контейнера и
сохраняет пропорции) и `object-fit: cover` для обрезки. Выбор **файла** под экран — задача HTML:
`srcset` с дескрипторами `w` и `x`, `sizes` и `<picture>` с `<source media>`. Их разбирает курс
[Медиа: изображения, видео, SVG](LEARN_HTML_MEDIA_COURSE.md).

Не забывайте атрибуты `width` и `height` у `<img>`: по ним браузер заранее вычисляет `aspect-ratio` и
резервирует место, страница не прыгает при загрузке.

## 8. Высота окна на мобильных: `vh`, `svh`, `lvh`, `dvh`

На телефоне адресная строка и панель браузера **прячутся при прокрутке** и появляются снова. Видимая
высота окна постоянно меняется. Какой из этих высот равен `100vh`?

Браузеры решили: **наибольшей** — когда панели спрятаны. Пересчитывать `vh` при каждом движении
пальца — значит перестраивать раскладку во время прокрутки, это дёргает страницу. Последствие: блок
`height: 100vh` на только что открытой странице **выше видимой области**, а кнопка внизу экрана
спрятана под панелью браузера.

Решение — три набора единиц (CSS Values 4):

| Единица | Высота окна | Когда пользоваться |
|---|---|---|
| `svh` (small) | при **показанных** панелях — наименьшая | «первый экран», который точно виден целиком |
| `lvh` (large) | при **скрытых** панелях — наибольшая (= старый `vh`) | фон, которому не страшно уйти под панель |
| `dvh` (dynamic) | текущая, меняется при появлении и скрытии панелей | полноэкранные приложения, модальные окна |

Аналогично есть `svw`/`lvw`/`dvw`, `svi`, `dvb` и т. д. Поддержка — во всех основных браузерах с 2023 года.

```css
.hero {
  min-height: 100vh;    /* запасной вариант для старых браузеров */
  min-height: 100svh;   /* перезапишет, если единица известна */
}
```

Почему `min-height`, а не `height`: при крупном шрифте или повороте содержимое может не поместиться, и
жёсткая высота обрежет его.

`dvh` используйте осторожно: высота меняется во время прокрутки, и всё, что от неё зависит, будет
перестраиваться — дорого и заметно глазу.

### 8.1. Клавиатура и вырезы

- Экранная клавиатура по умолчанию **не меняет** окно раскладки в Safari и Chrome (только визуальное
  окно). Изменить это в Chrome можно `interactive-widget=resizes-content` в мета-теге viewport.
- Под вырезом камеры и над «полоской» навигации отступы дают `env(safe-area-inset-top)` и другие (работает
  с `viewport-fit=cover`): `padding-bottom: max(16px, env(safe-area-inset-bottom))`.

<details>
<summary>svh, lvh, dvh в сравнении</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-responsive.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; font: 14px system-ui, sans-serif; display: flex; gap: 4px; align-items: flex-start; }
  .bar { flex: 1; color: white; padding: 6px; box-sizing: border-box; writing-mode: vertical-rl; }
  .s { height: 100svh; background: #15803d; }
  .d { height: 100dvh; background: #0369a1; }
  .l { height: 100lvh; background: #b91c1c; }
</style>
</head>
<body>
  <div class="bar s">100svh — видна целиком при открытых панелях</div>
  <div class="bar d">100dvh — следует за панелями браузера</div>
  <div class="bar l">100lvh = 100vh — уходит под панели</div>
</body>
</html>
```

</details>

На компьютере все три столбца одинаковы. Откройте пример на телефоне и прокрутите — разница появится.

## 9. Собираем вместе

Порядок принятия решений для нового компонента:

1. Сделайте его гибким **без запросов**: `flex-wrap`, `auto-fill`, `minmax`, `clamp()`, `max-width`.
2. Если раскладка компонента должна меняться — **контейнерный запрос**: компонент станет переносимым.
3. Если меняется раскладка **страницы** — медиазапрос по ширине, mobile-first, в `em`.
4. Добавьте запросы **предпочтений**: тема, анимация, `hover`, `pointer`.
5. Проверьте масштаб 200 %, крупный системный шрифт, поворот экрана и реальный телефон.

## Итог

- Без `<meta name="viewport" content="width=device-width, initial-scale=1">` мобильный браузер
  притворяется экраном в 980px; запрещать масштабирование нельзя.
- Медиазапросы не повышают специфичность; пишите диапазонный синтаксис `600px <= width < 900px` и
  брейкпоинты в `em`.
- `hover`, `pointer`, `prefers-*` отвечают на вопросы, на которые ширина экрана не отвечает.
- Mobile-first: база простая, запросы `>=` добавляют сложность, каскад идёт по порядку.
- Контейнерные запросы требуют `container-type: inline-size`, контейнер не запрашивает сам себя;
  единицы `cqi` делают размеры зависимыми от компонента.
- `clamp(min, rem + vw, max)` — плавная типографика, сохраняющая масштабирование.
- `100vh` на мобильных — высота при скрытых панелях; для первого экрана — `100svh`.

## Проверьте себя

1. Сайт без мета-тега viewport. Сработает ли на телефоне `@media (width < 600px)`? Почему?
2. Почему `max-width: 900px` и `min-width: 900px` в соседних запросах — ошибка, и как её устраняет новый
   синтаксис?
3. Карточка в боковой колонке должна быть вертикальной, в основной — горизонтальной. Почему медиазапрос
   здесь не подходит и что нужно написать?
4. Почему `font-size: 4vw` плох для доступности, а `clamp(1rem, 0.8rem + 1vw, 1.5rem)` — нет?
5. Кнопка внизу полноэкранного блока `height: 100vh` не видна на телефоне при открытии страницы. Что
   случилось и как исправить?

Дальше: [Пользовательские свойства и темы](LEARN_CSS_CUSTOM_PROPERTIES_COURSE.md).
