# CSS для печати

> Курс 21 из программы. Для тех, кто владеет каскадом, `@media` и блочной моделью. Печать — забытая
> среда: у неё нет прокрутки, нет наведения, нет бесконечной высоты. Зато есть **страницы**, и вся
> раскладка начинает делиться на фрагменты. Разберём, как браузер режет документ на листы и как этим
> управлять.

**Что вы будете понимать после курса**

- чем **страничный носитель** (paged media) отличается от непрерывного (continuous media) экрана;
- как подключать печатные стили и какие из способов блокируют отрисовку экрана;
- что делает `@page`: размер листа, поля, левые/правые и первая страница;
- почему в печати честно работают физические единицы и как они связаны с `px`;
- как управлять разрывами: `break-before`, `break-after`, `break-inside`, `orphans`, `widows`;
- почему фоны по умолчанию не печатаются и что с этим делает `print-color-adjust`;
- как спрятать интерфейс и показать адреса ссылок через `::after` и `attr(href)`;
- как тестировать печать, не изводя бумагу.

---

## 1. Страничный носитель

На экране содержимое течёт в бесконечно высоком окне (viewport) с прокруткой. При печати область
содержимого — это **страничный блок** (page box) фиксированного размера. Когда содержимое не
помещается, браузер **фрагментирует** (fragmentation) его: строки, блоки, ячейки таблиц продолжаются
на следующей странице. Всё, что в этом курсе, — способы повлиять на фрагментацию и на сам лист.

Чего на бумаге нет:

| Есть на экране | При печати |
|---|---|
| прокрутка, `position: sticky` | нет прокрутки; `sticky` ведёт себя как в начальном положении |
| `:hover`, `:focus`, анимации | нет взаимодействия, печатается состояние на момент печати |
| ширина окна | ширина области страницы (лист минус поля) |
| цвет фона | по умолчанию **не печатается** |
| ссылки кликабельны | на бумаге не видно, куда ведёт ссылка (в PDF ссылки обычно сохраняются) |

## 2. Как подключить печатные стили

Три варианта, все равноправны для каскада:

```html
<link rel="stylesheet" href="print.css" media="print">
```

```css
@media print { nav { display: none; } }
```

```css
@import url("print.css") print;
```

Разница — в загрузке. Таблица стилей с несовпадающим `media` всё равно **скачивается** (браузер
не знает, не начнёте ли вы печатать через секунду), но с низким приоритетом и **не блокирует
отрисовку** экрана. А `@import` выстраивает загрузку цепочкой — об этом в курсе
[Производительность CSS](LEARN_CSS_PERFORMANCE_COURSE.md). Обычно лучший вариант — блок
`@media print` в основном файле: печатных правил мало, отдельный запрос того не стоит.

Медиатипы: в современном CSS остались `all`, `screen`, `print`. Остальные (`handheld`, `tv`,
`projection`, …) устарели и ничему не соответствуют. Обратное условие — `@media not print`
или `@media screen`.

Есть и `@media print and (orientation: landscape)`: ориентация определяется по размерам страничного
блока.

## 3. `@page`: лист и поля

### 3.1. Размер

```css
@page { size: A4; }              /* 210 × 297 мм */
@page { size: A4 landscape; }
@page { size: 148mm 210mm; }     /* A5 явными размерами */
@page { size: letter; }          /* 8.5 × 11 дюймов, стандарт США */
```

`size` — подсказка: в Chrome она задаёт размер по умолчанию в диалоге печати (и блокирует выбор
другого формата), остальные браузеры могут подчиняться настройкам пользователя. На бумаге принтер
всё равно печатает на том, что заправлено. Для генерации PDF из браузера `size` работает надёжно.

### 3.2. Поля

```css
@page { margin: 20mm 15mm; }
@page :first { margin-top: 40mm; }        /* титульная страница */
@page :left  { margin-left: 25mm; }       /* для двусторонней печати */
@page :right { margin-right: 25mm; }
@page :blank { }                           /* пустые страницы, возникшие от разрывов */
```

Поля `@page` — это **поля листа**, а не `margin` у `body`. Внутри области страницы `body` по-прежнему
имеет свои `8px` из стилей браузера (их часто обнуляют для печати).

Поля листа — также место, куда браузер выводит **колонтитулы**: дату, заголовок документа, адрес и
номер страницы. Пользователь отключает их в диалоге печати. Если поставить `@page { margin: 0 }`,
им негде поместиться — Chrome их перестаёт печатать. Это популярный приём, но тогда ваше содержимое
окажется вплотную к краю, куда многие принтеры физически не печатают; верните отступ через `padding`
у `body`.

### 3.3. Поля-области (margin boxes)

Спецификация CSS Paged Media описывает 16 полей-областей: `@top-left`, `@top-center`,
`@bottom-right` и т. д., со счётчиками `counter(page)` и `counter(pages)`:

```css
@page {
  @bottom-center { content: "Стр. " counter(page) " из " counter(pages); }
}
```

Это давно работает в специализированных движках печати (Prince, WeasyPrint, Paged.js), а в Chromium
появилось с версии 131. В других браузерах — проверяйте перед использованием, иначе правило просто
игнорируется.

### 3.4. Именованные страницы

```css
@page wide { size: A4 landscape; }
.big-table { page: wide; }
```

Элемент со свойством `page` начинается с новой страницы указанного типа. Так одна широкая таблица
печатается в альбомной ориентации посреди книжного документа (Chrome; в Firefox — с версии 110,
Safari — не во всех версиях).

<details>
<summary>Поля листа и обнулённый body: откройте печать</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-print.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 15mm 20mm; }
  @page :first { margin-top: 50mm; }
  body { font: 12pt/1.5 Georgia, serif; }
  @media print { body { margin: 0; } }
  h1 { border-bottom: 2pt solid #000; }
  .screen-only { background: #ffe; border: 1px dashed #c90; padding: 8px; }
  @media print { .screen-only { display: none; } }
</style>
</head>
<body>
  <p class="screen-only">Нажмите Ctrl+P (Cmd+P): первая страница начнётся ниже, у остальных поля 15 мм.
    <button onclick="print()">Печать</button></p>
  <h1>Отчёт</h1>
  <script>
    for (var i = 1; i <= 40; i++)
      document.write('<p>Абзац ' + i + '. Текст, который будет разрезан на страницы по правилам фрагментации.</p>');
  </script>
</body>
</html>
```

</details>

## 4. Физические единицы

На экране `1cm` почти никогда не равен сантиметру линейки. В CSS все **абсолютные единицы**
жёстко связаны через `px`:

| Единица | Равна |
|---|---|
| `1in` | `96px` = `2.54cm` = `72pt` = `6pc` |
| `1cm` | `≈ 37.8px` |
| `1mm` | `≈ 3.78px` |
| `1pt` | `1/72in` ≈ `1.333px` |
| `1Q` | `0.25mm` |

На экране «якорь» — пиксель (так называемый референсный пиксель, привязанный к углу зрения), и
сантиметры выводятся из него. **На печати якорь — физический дюйм**, и пиксель выводится из
него: `1px` = `1/96in`. Поэтому в печатных стилях `mm` и `pt` — честные единицы: `border: 0.5pt` —
действительно тонкая линия, `font-size: 11pt` — действительно 11 пунктов типографской системы.

Рекомендации для печатного CSS:

- размер шрифта — `pt` (10–12pt для основного текста), или оставьте `rem`, если корневой задан в `pt`;
- поля и отступы между блоками — `mm`/`cm`;
- ширина колонок — `%`, а не `px`: область страницы A4 с полями 20 мм — около 170 мм, это ≈ 643px,
  и блок `width: 960px` «вылезет» или будет сжат.

О сжатии: если содержимое шире страницы, Chrome и Firefox по умолчанию **масштабируют** всю страницу
(«уместить по ширине»), и текст мельчает. Это признак, что для печати не сброшены фиксированные
ширины.

## 5. Разрывы страниц

### 5.1. Свойства

| Свойство | Значения | Смысл |
|---|---|---|
| `break-before` | `auto`, `page`, `avoid`, `left`, `right`, `avoid-page`, `column`… | разрыв перед блоком |
| `break-after` | то же | разрыв после блока |
| `break-inside` | `auto`, `avoid`, `avoid-page`, `avoid-column` | можно ли рвать внутри блока |
| `orphans` | число, по умолчанию `2` | минимум строк абзаца внизу страницы |
| `widows` | число, по умолчанию `2` | минимум строк абзаца вверху следующей |

Это общие свойства **фрагментации** (CSS Fragmentation): те же `break-*` работают в многоколоночной
раскладке (`columns`), где значения `column` и `avoid-column` относятся к колонкам.

Старые имена — `page-break-before`, `page-break-after`, `page-break-inside` со значениями `always`,
`avoid`. Браузеры поддерживают их как псевдонимы (`page-break-before: always` → `break-before: page`).
В старых кодовых базах встречаются оба.

`orphans` и `widows` поддерживают Chrome и Safari; Firefox — нет. Без них браузер всё равно избегает
одиноких строк по умолчанию в той мере, в какой умеет.

### 5.2. «Избегать» — не «запретить»

`break-inside: avoid` — **пожелание**. Если блок выше страницы, рвать его придётся. А при
`break-inside: avoid` на высоком блоке он сначала уезжает на новую страницу, оставив на предыдущей
пустое место, и *всё равно* рвётся. Поэтому `avoid` ставят на небольшие единицы: фигуры, карточки,
строки таблиц, пары «заголовок + первый абзац».

```css
@media print {
  h1 { break-before: page; }                /* каждая глава с новой страницы */
  h2, h3 { break-after: avoid; }            /* заголовок не остаётся сиротой внизу */
  figure, tr, .card, pre { break-inside: avoid; }
}
```

Где разрывы **не работают**: в старых браузерах — внутри flex- и grid-контейнеров, у абсолютно
позиционированных элементов, у плавающих (`float`). Chrome с движком LayoutNG (с 2021–2022 годов)
корректно фрагментирует flex и grid, но если вы видите, что `break-*` игнорируются, первое, что
стоит сделать в печатных стилях, — `display: block` у обёрток.

<details>
<summary>Разрывы: главы с новой страницы, карточки не рвутся</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-print.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 12pt/1.4 system-ui, sans-serif; }
  .card { border: 1.5pt solid #357; padding: 4mm; margin: 0 0 4mm; height: 55mm; background: #eef4ff; }
  h2 { color: #357; }
  @media print {
    h2 { break-before: page; break-after: avoid; }
    h2:first-of-type { break-before: auto; }
    .card { break-inside: avoid; }
  }
  .hint { background: #ffe; padding: 6px; }
  @media print { .hint { display: none; } }
</style>
</head>
<body>
  <p class="hint">Откройте предпросмотр печати: каждая глава начнётся с нового листа, карточки не разрежутся.</p>
  <script>
    for (var c = 1; c <= 3; c++) {
      document.write('<h2>Глава ' + c + '</h2>');
      for (var k = 1; k <= 5; k++) document.write('<div class="card">Карточка ' + c + '.' + k + '</div>');
    }
  </script>
</body>
</html>
```

</details>

### 5.3. Таблицы на нескольких страницах

Элемент `<thead>` имеет `display: table-header-group`, а браузеры **повторяют** группу заголовка
таблицы на каждой странице, где продолжается таблица; так же поступают с `<tfoot>`
(`table-footer-group`). Это один из сильнейших доводов писать `thead` явно. Добавьте
`tr { break-inside: avoid; }`, чтобы строка не разрывалась пополам.

<details>
<summary>Длинная таблица: заголовок повторяется</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-print.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 11pt system-ui, sans-serif; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: .75pt solid #555; padding: 2mm 3mm; text-align: left; }
  thead th { background: #dde; }
  @media print {
    thead th { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    tr { break-inside: avoid; }
  }
</style>
</head>
<body>
  <p>Откройте предпросмотр печати: шапка таблицы будет на каждой странице.</p>
  <table>
    <thead><tr><th>№</th><th>Позиция</th><th>Количество</th></tr></thead>
    <tbody id="t"></tbody>
  </table>
  <script>
    var h = '';
    for (var i = 1; i <= 120; i++) h += '<tr><td>' + i + '</td><td>Товар ' + i + '</td><td>' + (i * 7 % 13 + 1) + '</td></tr>';
    document.getElementById('t').innerHTML = h;
  </script>
</body>
</html>
```

</details>

## 6. Цвет и фоны: `print-color-adjust`

По умолчанию браузеры **не печатают фоновые цвета и изображения** — экономят тонер; в диалоге есть
галочка «Фоновая графика». Иногда браузер ещё и подправляет цвета (например, светлый текст на тёмном
фоне печатает тёмным). Это поведение описывает свойство `print-color-adjust`:

- `economy` (по умолчанию) — браузеру разрешено менять цвета и выбрасывать фоны;
- `exact` — автор просит печатать как задано.

```css
.badge { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
```

Префиксная версия нужна для Safari и старых Chrome (без префикса — Chrome 136+, Firefox 97+).
Свойство наследуется. Не ставьте `exact` на весь документ: пользователь просил экономить тонер,
уважайте это для крупных заливок; включайте его точечно — для легенды графика, цветовых меток,
полосок прогресса, где цвет и есть информация.

Безопасный путь: в печатных стилях переводить смысл с цвета на форму. Вместо зелёной/красной заливки —
рамка и текст «✓ оплачено». Монохромный принтер всё равно превратит цвета в оттенки серого.

<details>
<summary>Фоны в печати: economy и exact</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-print.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 12pt system-ui, sans-serif; padding: 10px; }
  .tag { display: inline-block; padding: 2mm 4mm; margin: 2mm; color: #fff; background: #c33; border-radius: 2mm; }
  .exact { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .robust { background: #c33; }
  @media print {
    .robust { background: none; color: #000; border: 1.5pt solid #000; }
    .robust::before { content: "\26A0  "; }
  }
</style>
</head>
<body>
  <p>Откройте предпросмотр печати с выключенной «Фоновой графикой».</p>
  <span class="tag">economy: белый текст пропадёт</span>
  <span class="tag exact">exact: фон останется</span>
  <span class="tag robust">печатная версия: рамка и знак</span>
</body>
</html>
```

</details>

## 7. Прячем интерфейс, показываем смысл

### 7.1. Что убрать

Навигация, кнопки, формы поиска, баннеры, чат-виджеты, видео — бессмысленны на бумаге.

```css
@media print {
  nav, header .menu, footer .social, button, .cookie-banner, video, iframe, [aria-hidden="true"] { display: none !important; }
  body { background: #fff; color: #000; }
  main, article { width: auto; max-width: none; margin: 0; padding: 0; float: none; }
  a { color: inherit; text-decoration: underline; }
}
```

`!important` здесь оправдан: компонентные стили часто имеют специфичность выше, чем ваш печатный
селектор, а вы хотите «гарантированно спрятать». Удобный паттерн — служебные классы
`.no-print { }` и `.print-only { display: none }` с противоположными правилами в `@media print`.

Особый случай — `position: fixed`. Шапка с `fixed` при печати в большинстве браузеров повторяется на
каждой странице поверх текста. Либо прячьте её, либо делайте `position: static`.

### 7.2. Адреса ссылок

Ссылка «подробнее» на бумаге бесполезна. Генерируемое содержимое с функцией `attr()` выводит значение
атрибута:

```css
@media print {
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 90%; word-break: break-all; }
  a[href^="#"]::after, a[href^="javascript:"]::after { content: none; }
  abbr[title]::after { content: " (" attr(title) ")"; }
}
```

Разбор селектора: `[href^="http"]` — атрибут **начинается** с `http`, то есть внешние ссылки
(включая `https`). Внутренние якоря (`#…`) печатать бессмысленно. `attr(href)` выводит значение
атрибута как написано в разметке, а не абсолютный адрес: для относительных ссылок можно добавить
префикс вручную (`content: " (https://example.org" attr(href) ")"` на `a[href^="/"]`).
`word-break: break-all` нужен потому, что длинный адрес без пробелов иначе вылезет за поле.

Если ссылок много, адреса в тексте мешают чтению. Альтернатива — сноски: JS перед печатью собирает
ссылки в нумерованный список в конце (см. события `beforeprint` ниже).

<details>
<summary>Печатная версия статьи: ссылки с адресами</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-print.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 600px; margin: 20px auto; padding: 0 12px; }
  nav { background: #234; color: #fff; padding: 8px; }
  nav a { color: #9cf; margin-right: 10px; }
  @media print {
    nav, .btn { display: none; }
    body { font: 11pt/1.45 Georgia, serif; max-width: none; margin: 0; }
    a { color: #000; }
    a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 90%; word-break: break-all; }
    a[href^="#"]::after { content: none; }
  }
  html.as-print nav, html.as-print .btn { display: none; }
  html.as-print body { font: 11pt/1.45 Georgia, serif; }
  html.as-print a { color: #000; }
  html.as-print a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 90%; word-break: break-all; }
</style>
</head>
<body>
  <nav><a href="#">Главная</a><a href="#">Статьи</a></nav>
  <p><button class="btn" onclick="document.documentElement.classList.toggle('as-print')">Имитация печати</button></p>
  <article>
    <h1>Статья</h1>
    <p>Подробности — в <a href="https://developer.mozilla.org/">справочнике MDN</a>
      и в <a href="https://www.w3.org/TR/css-page-3/">спецификации Paged Media</a>.
      Вернуться к <a href="#top">началу</a>.</p>
  </article>
</body>
</html>
```

</details>

Кнопка «Имитация печати» в этом примере дублирует печатные правила под классом — так удобно
разрабатывать, но в реальном проекте лучше пользоваться эмуляцией в DevTools (раздел 9).

## 8. Типографика для бумаги

- **Шрифт.** Засечки на бумаге читаются не хуже, чем без засечек; главное — не мельче 10pt и не
  тоньше `font-weight: 300`: тонкие начертания плохо пропечатываются.
- **Цвет текста** — чистый чёрный. Серый `#666` на лазерном принтере превращается в растр точек.
- **Ширина строки.** На A4 с полями 20 мм и 11pt выходит около 85–95 знаков в строке — длинновато;
  можно увеличить поля или использовать `columns: 2` для справочных материалов.
- **Переносы.** `hyphens: auto` при `lang="ru"` выравнивает правый край и уменьшает «рваность»;
  особенно полезно с `text-align: justify`.
- **Заголовки** не должны отрываться от текста: `break-after: avoid`.

## 9. Как тестировать печать

1. **Предпросмотр печати** — Ctrl+P / Cmd+P. Это настоящий движок фрагментации: разрывы, поля,
   колонтитулы видны только здесь. Сохранение «в PDF» — бесплатная бумага.
2. **Эмуляция медиатипа.** Chrome: DevTools → ⋮ → More tools → Rendering → *Emulate CSS media type:
   print*. Firefox: в инспекторе есть кнопка переключения печатной симуляции. Это применяет `@media
   print`, но страница остаётся **непрерывной**: разрывов не видно. Удобно для отладки правил и
   инспектирования, но не для проверки разбиения.
3. **Из JavaScript:** `window.print()` открывает диалог; `matchMedia('print')` позволяет реагировать,
   а события `beforeprint` и `afterprint` — подготовить документ (развернуть свёрнутые
   `<details>`, отрисовать график в статичную картинку, построить сноски) и вернуть как было.

<details>
<summary>beforeprint: раскрыть свёрнутые ответы перед печатью</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-print.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 12px; }
  .qa { border: 1px solid #aac; margin: 6px 0; padding: 6px; } .qa button { font-weight: bold; }
  #log { color: #575; font-size: 13px; }
</style>
</head>
<body>
  <p>Свёрнутые блоки раскроются только на время печати. Нажмите Ctrl+P или <button onclick="print()">Печать</button>.</p>
  <div class="qa"><button onclick="this.nextElementSibling.hidden^=1">Вопрос 1</button><p hidden>Ответ 1.</p></div>
  <div class="qa"><button onclick="this.nextElementSibling.hidden^=1">Вопрос 2</button><p hidden>Ответ 2.</p></div>
  <p id="log"></p>
  <script>
    var opened = [];
    addEventListener('beforeprint', function () {
      opened = [];
      document.querySelectorAll('.qa p[hidden]').forEach(function (p) { p.hidden = false; opened.push(p); });
      document.getElementById('log').textContent = 'beforeprint: раскрыто ' + opened.length;
    });
    addEventListener('afterprint', function () {
      opened.forEach(function (p) { p.hidden = true; });
      document.getElementById('log').textContent += '; afterprint: свёрнуто обратно';
    });
  </script>
</body>
</html>
```

</details>

## 10. Контрольный список печатных стилей

```css
@media print {
  @page { margin: 15mm; }
  body { margin: 0; font: 11pt/1.45 Georgia, serif; color: #000; background: #fff; }
  nav, aside, .no-print, button, video, iframe { display: none !important; }
  main, article, .container { width: auto; max-width: none; float: none; }
  .layout { display: block; }                 /* flex/grid обёртки → блоки */
  a { color: inherit; }
  a[href^="http"]::after { content: " (" attr(href) ")"; word-break: break-all; }
  h1, h2, h3 { break-after: avoid; }
  img, figure, pre, tr, blockquote { break-inside: avoid; }
  img { max-width: 100% !important; }
  p { orphans: 3; widows: 3; }
  .legend { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
```

## Итог

- Печать — страничный носитель: документ фрагментируется на страничные блоки фиксированного размера.
- `media="print"` и `@media print` не блокируют отрисовку экрана; лучше всего — блок в основном CSS.
- `@page` задаёт размер листа (`size`), поля и особые страницы (`:first`, `:left`, `:right`); в полях
  живут колонтитулы браузера.
- На печати физические единицы честные: `1in = 96px = 72pt = 2.54cm`.
- Разрывы: `break-before/after: page`, `break-inside: avoid`; `avoid` — пожелание, не запрет.
  `<thead>` повторяется на каждой странице.
- Фоны не печатаются по умолчанию; `print-color-adjust: exact` — точечно, где цвет несёт смысл.
- Прячьте интерфейс, показывайте адреса ссылок через `a[href^="http"]::after { content: attr(href) }`.
- Проверяйте разрывы в предпросмотре печати, правила — в эмуляции медиатипа.

## Проверьте себя

1. Почему таблица стилей с `media="print"` скачивается, хотя страница показывается на экране, и
   блокирует ли она отрисовку?
2. Чем поля `@page { margin }` отличаются от `body { margin }`? Что произойдёт с колонтитулами при
   `@page { margin: 0 }`?
3. Блок высотой полторы страницы получил `break-inside: avoid`. Что увидит читатель?
4. Как напечатать адреса только внешних ссылок и почему `attr(href)` у ссылки `href="/about"` даст
   не полный адрес?
5. Почему цветная метка статуса пропала в печати и какие два способа это исправить?

Дальше: [Производительность CSS](LEARN_CSS_PERFORMANCE_COURSE.md).
