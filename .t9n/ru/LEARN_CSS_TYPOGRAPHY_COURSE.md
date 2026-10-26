# Типографика

> Курс 19 из программы. Для тех, кто понимает наследование и вычисленные значения
> ([Наследование](LEARN_CSS_INHERITANCE_COURSE.md)). Текст — основное содержимое почти любой страницы, и
> большая часть «мелких» ошибок вёрстки — это ошибки типографики: прыгающий шрифт при загрузке, слипшиеся
> строки во вложенных блоках, вылезающие из колонки ссылки, многоточие, которое не появляется.

**Что вы будете понимать после курса**

- как браузер выбирает шрифт **для каждого символа** и почему список шрифтов — это не «запасной вариант
  на случай отсутствия»;
- как загружаются веб-шрифты, что такое FOIT и FOUT и как ими управлять через `font-display`;
- почему `line-height: 1.5` и `line-height: 1.5em` ведут себя по-разному при наследовании;
- как строить вертикальный ритм и зачем единицы `lh`, `rlh`, `ch`, `cap`;
- как включать табличные цифры, лигатуры и другие возможности OpenType;
- от чего зависят переносы (`hyphens`, `lang`) и балансировка строк (`text-wrap`);
- чем отличаются `overflow-wrap` и `word-break`, и какие **четыре** условия нужны для многоточия.

---

## 1. Стек шрифтов и подбор по символам

### 1.1. Список — это очередь для каждого символа

```css
font-family: "Inter", "Segoe UI", Roboto, system-ui, sans-serif;
```

Браузер не выбирает «один шрифт для элемента». Для **каждого символа** он идёт по списку и берёт первый
шрифт, в котором есть глиф этого символа. Если ни в одном нет — включается **системный подбор** (system
font fallback): браузер ищет любой установленный шрифт с нужным глифом. Поэтому строка «Hello, мир 👋»
может быть набрана тремя разными шрифтами.

Следствия:

- Шрифт только с латиницей набирает латиницу, а кириллица уходит к следующему в списке. Смешение двух
  гарнитур в одном слове заметно — выбирайте шрифт с кириллицей или подключайте подмножество
  (`unicode-range`, раздел 2.4).
- Список **всегда** заканчивается **родовым семейством** (generic family): `serif`, `sans-serif`,
  `monospace`, `system-ui`, `ui-monospace`, `cursive`, `fantasy`, `math`. Родовое имя пишется **без кавычек**:
  `"sans-serif"` в кавычках — это поиск шрифта с таким названием.
- Имена с пробелами берут в кавычки (`"Segoe UI"`). Без кавычек они тоже работают, если состоят из
  идентификаторов, но кавычки снимают неоднозначность.

### 1.2. Системный стек

```css
font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
```

Системный шрифт уже установлен, загружать нечего, он хорошо хинтован для экрана. `system-ui` даёт
шрифт интерфейса ОС; остальные имена — для старых браузеров. Минус: на разных системах страница выглядит
по-разному, а метрики (ширина, высота) различаются.

### 1.3. Ловушка `monospace`

```css
code { font-family: monospace; }   /* исторически уменьшается до 13px */
code { font-family: ui-monospace, Consolas, monospace; }  /* нормальный размер */
```

Стили браузера по умолчанию задают моноширинным шрифтам **меньший** размер (в Chrome и Firefox — 13px против 16px).
Срабатывает это, когда в `font-family` стоит **только** родовое `monospace`. Старый трюк
`font-family: monospace, monospace` отключает уменьшение. Надёжнее — указать конкретные шрифты перед
родовым именем.

## 2. Веб-шрифты и их загрузка

### 2.1. `@font-face`

```css
@font-face {
  font-family: "Inter";                          /* имя, которое вы используете в font-family */
  src: url(/fonts/inter-var.woff2) format("woff2");
  font-weight: 100 900;                          /* диапазон: вариативный шрифт */
  font-style: normal;
  font-display: swap;
}
```

`@font-face` ничего **не загружает** сам по себе. Файл скачивается, только когда на странице есть текст,
которому нужен этот шрифт (с подходящими `font-weight`/`font-style`). Это экономит трафик, но означает
позднее начало загрузки: браузер узнаёт о шрифте только после построения CSSOM и стилей.

Формат сегодня — **WOFF2** (сжатие Brotli). TTF/OTF без сжатия тяжелее; EOT и SVG-шрифты устарели.

### 2.2. FOIT, FOUT и `font-display`

Пока шрифт грузится, браузер должен решить, что делать с текстом:

- **FOIT** (flash of invisible text) — текст невидим, потом появляется сразу нужным шрифтом;
- **FOUT** (flash of unstyled text) — текст сразу виден запасным шрифтом, потом подменяется.

`font-display` задаёт стратегию через два периода: **блокировки** (текст невидим) и **подмены** (текст
виден запасным, и при загрузке шрифт подменится):

| Значение | Блокировка | Подмена | Когда выбирать |
|---|---|---|---|
| `auto` | решает браузер (обычно как `block`) | | не выбирать |
| `block` | короткая, около 3 с | бесконечная | иконочные шрифты: вместо глифа нельзя показывать букву |
| `swap` | очень короткая (≈0) | бесконечная | основной текст, заголовки — текст виден сразу |
| `fallback` | очень короткая (≈100 мс) | короткая (≈3 с) | компромисс: позже не подменять, чтобы не прыгало |
| `optional` | очень короткая (≈100 мс) | нет | шрифт — украшение; если не успел, остаётся запасной; в кэше появится к следующему визиту |

Точные длительности — рекомендация спецификации, а не обязательство.

### 2.3. Прыжок раскладки и `size-adjust`

FOUT опасен **сдвигом раскладки** (layout shift): у запасного шрифта другая ширина букв и высота
строки, и при подмене абзацы меняют длину. Смягчить можно, подогнав метрики запасного шрифта:

```css
@font-face {
  font-family: "Inter Fallback";
  src: local("Arial");
  size-adjust: 107%;          /* масштаб глифов */
  ascent-override: 90%;       /* высота над базовой линией */
  descent-override: 22%;
  line-gap-override: 0%;
}
body { font-family: "Inter", "Inter Fallback", sans-serif; }
```

Цифры подбирают под конкретную пару шрифтов (это делают инструменты сборки и фреймворки
автоматически).

### 2.4. Ускорение загрузки

- **`<link rel="preload" as="font" type="font/woff2" href="…" crossorigin>`** — сообщить о шрифте до
  разбора CSS. Атрибут `crossorigin` обязателен **даже для своего домена**: шрифты всегда запрашиваются
  в режиме CORS, и без атрибута предзагрузка не совпадёт с настоящим запросом — файл скачается дважды.
  Предзагружайте 1–2 действительно нужных файла, не все начертания.
- **`unicode-range`** — разбить шрифт на подмножества; браузер скачает только те, символы из которых есть
  на странице:

  ```css
  @font-face { font-family: "Inter"; src: url(inter-cyr.woff2) format("woff2"); unicode-range: U+0400-045F; }
  @font-face { font-family: "Inter"; src: url(inter-lat.woff2) format("woff2"); unicode-range: U+0000-00FF; }
  ```

- **Вариативный шрифт** — один файл на все начертания (`font-weight: 100 900`) вместо отдельного файла на
  каждую насыщенность.
- **`local()`** в `src` — сначала попробовать установленный шрифт. Осторожно: локальная версия может
  отличаться от вашей.

### 2.5. Синтез начертаний

Если просить `font-weight: 700`, а подключено только обычное начертание, браузер **синтезирует** жирный
(утолщает обводку) и курсив (наклоняет). Выглядит грубо. Свойство `font-synthesis: none` запрещает
синтез — полезно, чтобы заметить, что забыли подключить файл.

<details>
<summary>font-display на практике: таймлайн загрузки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-typography.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui; padding: 10px; }
  .t { border-left: 4px solid; padding: 6px 10px; margin: 8px 0; }
  .ok { border-color: #16a34a; } .mid { border-color: #f59e0b; } .no { border-color: #dc2626; }
  .bar { height: 14px; display: flex; border-radius: 4px; overflow: hidden; margin-top: 4px; font-size: 11px; }
  .bar span { display: grid; place-items: center; color: white; }
  .blk { background: #475569; } .swp { background: #2563eb; } .fin { background: #16a34a; }
</style>
</head>
<body>
  <div class="t no">block — текст невидим до 3 с
    <div class="bar"><span class="blk" style="flex:3">невидим</span><span class="fin" style="flex:3">шрифт</span></div></div>
  <div class="t ok">swap — сразу запасной, затем подмена
    <div class="bar"><span class="swp" style="flex:3">запасной</span><span class="fin" style="flex:3">шрифт</span></div></div>
  <div class="t mid">fallback — 100 мс невидим, до 3 с можно подменить, позже — нет
    <div class="bar"><span class="blk" style="flex:.3"></span><span class="swp" style="flex:3">запасной</span><span class="fin" style="flex:2.7">или шрифт, или запасной навсегда</span></div></div>
  <div class="t mid">optional — 100 мс; не успел — запасной до конца визита
    <div class="bar"><span class="blk" style="flex:.3"></span><span class="swp" style="flex:5.7">запасной</span></div></div>
</body>
</html>
```

</details>

## 3. Размер шрифта и единицы

- Размер по умолчанию — **16px**, если пользователь не изменил его в настройках браузера.
  Задавайте корню `font-size` в процентах или не задавайте вовсе: `html { font-size: 10px }` ломает
  пользовательскую настройку.
- `em` — от `font-size` **родителя** (в самом `font-size`) или своего элемента (в остальных свойствах).
  Вложенные `font-size: 1.2em` накапливаются.
- `rem` — от `font-size` корня, не накапливается.
- Ключевые слова `smaller`/`larger` и `small`, `medium`, `x-large` — тоже работают; `medium` = размер по
  умолчанию.
- Плавный размер: `font-size: clamp(1.25rem, 1rem + 1.5vw, 2rem)`. Слагаемое в `rem` обязательно: чистое
  `vw` не реагирует на масштаб страницы, и пользователь не сможет увеличить текст.

Типографские единицы, которые стоит знать:

| Единица | Равна |
|---|---|
| `ch` | ширине глифа «0» шрифта — удобна для ширины колонки: `max-width: 65ch` |
| `ex` | высоте строчной «x» |
| `cap` | высоте прописных букв |
| `lh` | вычисленной высоте строки элемента |
| `rlh` | высоте строки корня |

Удобная длина строки для чтения — примерно 45–75 символов: отсюда `max-width: 60ch…70ch` у текстовых
колонок. Для кириллицы `ch` (ширина нуля) заметно уже среднего русского слова на символ — проверяйте глазами.

## 4. `line-height` и ловушка наследования

### 4.1. Четыре вида значений

```css
line-height: normal;   /* по умолчанию: из метрик шрифта, обычно ≈1.1–1.3 */
line-height: 1.5;      /* число — множитель */
line-height: 1.5em;    /* длина */
line-height: 150%;     /* процент — тоже вычисляется в длину */
```

Для одного элемента `1.5`, `1.5em` и `150%` дают **одинаковую** высоту строки. Различие проявляется у
потомков:

- **число** наследуется **как число**. Каждый потомок умножает его на **свой** `font-size`;
- **длина и процент** вычисляются в пиксели **на родителе**, и потомки наследуют готовые пиксели.

```css
article { font-size: 16px; line-height: 1.5em; }   /* вычисляется 24px — и наследуется 24px */
article h2 { font-size: 32px; }                    /* строки 24px при буквах 32px: налезают друг на друга */
```

<details>
<summary>line-height: число против em при наследовании</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-typography.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font-family: system-ui; display: flex; gap: 12px; }
  .col { width: 46%; font-size: 14px; padding: 8px; border: 2px solid #94a3b8; }
  .em { line-height: 1.5em; }
  .num { line-height: 1.5; }
  h2 { font-size: 30px; margin: 0 0 6px; background: #fef3c7; }
</style>
</head>
<body>
  <div class="col em"><h2>line-height: 1.5em на родителе — заголовок наследует 21px</h2>текст колонки 14px</div>
  <div class="col num"><h2>line-height: 1.5 на родителе — заголовок считает 1.5 × 30px</h2>текст колонки 14px</div>
</body>
</html>
```

</details>

Правило: **`line-height` — без единиц**. Единицы допустимы, когда нужна точная высота строки в одном
месте (однострочная кнопка, сетка ритма), и тогда задавайте её на том же элементе, а не на предке.

### 4.2. Как устроена строка

Высота строки — это не «расстояние между базовыми линиями» в прямом смысле. У каждого встроенного
фрагмента есть **встроенная коробка** (inline box) высотой `line-height`. Разница между `line-height` и
высотой глифов (content area) делится **пополам** — **полуинтерлиньяж** (half-leading) — и добавляется
сверху и снизу. **Строковая коробка** (line box) охватывает все встроенные коробки строки.

Отсюда две практические вещи:

- У первой строки абзаца сверху есть полуинтерлиньяж — текст не прижат к краю блока, и при точной
  вёрстке это «лишний» отступ. Свойство `text-box: trim-both cap alphabetic` (новое, поддерживается не везде)
  обрезает его до высоты прописных.
- Крупный встроенный элемент (иконка, `<sup>`, `<span>` с бо́льшим шрифтом) **раздвигает** строку. Отсюда
  неровные интервалы в абзацах со сносками. Лечится `line-height: 0` или `vertical-align` у такого
  элемента.

<details>
<summary>sup раздвигает строку</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-typography.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.5 Georgia, serif; display: flex; gap: 14px; }
  p { width: 45%; margin: 0; background: repeating-linear-gradient(#fff 0 23px, #93c5fd 23px 24px); }
  .fix sup { line-height: 0; }
</style>
</head>
<body>
  <p>Строки ровные по линейке, пока в тексте нет сноски<sup>1</sup>, после которой строка становится выше, и линейка расходится с текстом.</p>
  <p class="fix">Тот же абзац со сноской<sup>1</sup>, но у sup line-height: 0, и строки остаются на линейке до самого конца абзаца.</p>
</body>
</html>
```

</details>

## 5. Вертикальный ритм

**Вертикальный ритм** — все вертикальные расстояния кратны базовому шагу, обычно высоте строки
основного текста. Глаз считывает такую страницу как упорядоченную.

```css
:root { --step: 1.5rem; line-height: 1.5; }            /* 24px при 16px */
p, ul, ol, blockquote { margin-block: 0 var(--step); }
h2 { font-size: 1.5rem; line-height: var(--step); margin-block: calc(var(--step) * 2) var(--step); }
```

Современный способ — единицы `lh` и `rlh`: `margin-block-end: 1rlh` — ровно одна строка основного текста,
без пользовательских свойств.

Практические решения:

- Отступы задавайте **в одну сторону** (`margin-block-end`), чтобы не думать о схлопывании
  (о нём — в курсе [Блочная модель](LEARN_CSS_BOX_MODEL_COURSE.md)).
- Приём «совы» (lobotomized owl): `.flow > * + * { margin-block-start: 1rlh; }` — отступ только *между*
  элементами, ни сверху у первого, ни снизу у последнего.
- Абсолютно строгую сетку (каждая базовая линия на линейке) в вебе держать трудно: картинки и встроенные
  элементы её ломают. Стремитесь к согласованным отступам, а не к пиксельной сетке.

## 6. Возможности OpenType

Шрифты содержат альтернативные глифы, которые включаются **функциями** (features). Высокоуровневые
свойства — предпочтительный способ:

| Свойство | Значение | Что даёт |
|---|---|---|
| `font-variant-numeric` | `tabular-nums` | цифры одинаковой ширины — столбцы в таблицах, таймеры |
| | `oldstyle-nums` | «минускульные» цифры с выносными элементами — для текста |
| | `slashed-zero` | ноль с чертой — коды, пароли |
| | `diagonal-fractions` | 1/2 → дробь |
| `font-variant-ligatures` | `none`, `common-ligatures` | лигатуры fi, fl |
| `font-variant-caps` | `small-caps`, `all-small-caps` | капитель |
| `font-kerning` | `normal`, `none` | кернинг пар |
| `font-feature-settings` | `"tnum" 1, "ss01" 1` | низкоуровневый доступ к любой функции |

`font-feature-settings` перезаписывает **весь** список целиком: правило ниже по каскаду с `"ss01"`
выключит ваш `"tnum"`. Поэтому для стандартных функций используйте `font-variant-*` — они
складываются независимо.

<details>
<summary>tabular-nums: цифры одинаковой ширины</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-typography.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 18px/1.4 system-ui, sans-serif; display: flex; gap: 30px; }
  table { border-collapse: collapse; }
  td { text-align: right; padding: 2px 10px; border-bottom: 1px solid #e2e8f0; }
  .tab td { font-variant-numeric: tabular-nums; }
  caption { font-size: 13px; color: #64748b; }
  .timer { font-variant-numeric: tabular-nums; font-size: 28px; }
</style>
</head>
<body>
  <table><caption>пропорциональные</caption>
    <tr><td>111,11</td></tr><tr><td>888,88</td></tr><tr><td>101,01</td></tr></table>
  <table class="tab"><caption>tabular-nums</caption>
    <tr><td>111,11</td></tr><tr><td>888,88</td></tr><tr><td>101,01</td></tr></table>
  <div><div id="a"></div><div class="timer" id="b"></div></div>
  <script>
    // Верхний счётчик дрожит, нижний (tabular-nums) стоит на месте
    let n = 0;
    setInterval(() => { n += 7; a.textContent = (n / 100).toFixed(2); b.textContent = (n / 100).toFixed(2); }, 60);
    a.style.fontSize = '28px';
  </script>
</body>
</html>
```

</details>

Не все шрифты содержат все функции: если в шрифте нет `tnum`, свойство ничего не изменит. Системные
шрифты (Segoe UI, San Francisco, Roboto) табличные цифры поддерживают.

## 7. Переносы и балансировка

### 7.1. `hyphens` и `lang`

```css
p { hyphens: auto; }
```

| Значение | Поведение |
|---|---|
| `none` | не переносить даже по мягкому переносу |
| `manual` (по умолчанию) | переносить только по `&shy;` (U+00AD) и по явному дефису |
| `auto` | браузер расставляет переносы по словарю языка |

`hyphens: auto` работает, только если **язык известен**: браузер берёт словарь по `lang` элемента
(наследуется от `<html lang="ru">`). Без `lang` переносов не будет вовсе, а с неверным `lang="en"`
русский текст будет переноситься по английским правилам. Словари для языков есть не во всех
браузерах и системах — проверяйте.

Перенос особенно важен для `text-align: justify` в узкой колонке: без него между словами появляются
«реки» пробелов. Для управления есть `hyphenate-limit-chars: 6 3 2` (минимум букв в слове, до и после
переноса) — поддержка неполная.

<details>
<summary>hyphens: auto зависит от lang</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-typography.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.4 Georgia, serif; display: flex; gap: 10px; }
  p { width: 130px; margin: 0; padding: 6px; border: 2px solid #94a3b8; text-align: justify; }
  .h { hyphens: auto; }
</style>
</head>
<body>
  <p>Достопримечательности высокопроизводительного программирования.</p>
  <p class="h">Достопримечательности высокопроизводительного программирования.</p>
  <p class="h" lang="">Достопримечательности высокопроизводительного программирования.</p>
</body>
</html>
```

</details>

Первый блок — без переносов: длинные слова не помещаются, строки растянуты. Второй — с `hyphens: auto`
и унаследованным `lang="ru"`. Третий — `lang=""` (язык неизвестен): переносов нет, хотя свойство то же.

### 7.2. `text-wrap: balance` и `pretty`

Обычный алгоритм переноса **жадный** (greedy): набивает строку до отказа и переходит к следующей. В
заголовке это даёт «висячее» одно слово на последней строке.

- `text-wrap: balance` — выравнивает длины всех строк блока. Дорогая операция, поэтому браузеры
  ограничивают её небольшим числом строк. Для заголовков, подписей, цитат — не для абзацев.
- `text-wrap: pretty` — более медленный алгоритм для абзацев; главное, чего он добивается, — не оставлять
  одно короткое слово в последней строке (висячую строку). Где не поддерживается, ведёт себя как обычный перенос.

<details>
<summary>text-wrap: обычный, balance, pretty</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-typography.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.4 system-ui; }
  h2 { width: 330px; font-size: 24px; line-height: 1.2; margin: 6px 0 14px; padding: 4px; border: 2px dashed #94a3b8; }
  .b { text-wrap: balance; }
  p { width: 330px; margin: 6px 0; padding: 4px; border: 2px dashed #94a3b8; }
  .p { text-wrap: pretty; }
</style>
</head>
<body>
  <h2>Как браузер выбирает шрифт для каждого символа</h2>
  <h2 class="b">Как браузер выбирает шрифт для каждого символа</h2>
  <p>Обычный абзац с жадным переносом строк, который оставляет в конце одно короткое слово.</p>
  <p class="p">Обычный абзац с жадным переносом строк, который оставляет в конце одно короткое слово.</p>
</body>
</html>
```

</details>

### 7.3. Неразрывность в русском тексте

Предлоги и союзы в конце строки («в», «и», «на») по традиции русской вёрстки переносят на следующую
строку вместе со словом. CSS этого не делает: используйте неразрывный пробел `&nbsp;` (U+00A0) после
коротких слов, перед тире (`слово&nbsp;— слово`) и между числом и единицей (`10&nbsp;км`). Обычно это
делает типограф при сборке текста.

## 8. Длинные слова: `overflow-wrap` и `word-break`

URL, хеш, длинное слово в узкой колонке не помещаются и **вылезают** за пределы блока: по умолчанию
браузер переносит только в допустимых местах (пробелы, дефисы).

| Свойство | Что делает | Влияет на min-content |
|---|---|---|
| `overflow-wrap: break-word` | разрывает слово в любом месте, **только если** иначе оно не помещается | **нет** |
| `overflow-wrap: anywhere` | то же самое | **да** — блок может сжиматься до одной буквы |
| `word-break: break-all` | разрешает разрыв между **любыми** буквами всегда, даже если слово поместилось бы целиком | да |
| `word-break: keep-all` | запрещает разрывы внутри слов в китайском, японском, корейском | |
| `line-break: anywhere` | разрыв везде, даже перед знаками препинания | |

Ключевая разница — **min-content** (минимальная ширина содержимого, курс о раскладке). С
`break-word` длинный URL всё равно определяет минимальную ширину: во flex-элементе или ячейке таблицы
блок не сожмётся, а растянется. С `anywhere` минимальная ширина — одна буква, и блок спокойно
сжимается.

`word-wrap` — старое имя `overflow-wrap`, оставлено как синоним. `word-break: break-word` — устаревшее
значение, равное `overflow-wrap: anywhere` + `word-break: normal`.

<details>
<summary>Длинный URL: варианты переноса</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-typography.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px/1.4 system-ui; }
  .row { display: flex; gap: 8px; margin: 8px 0; width: 520px; }
  .row > div { border: 2px solid #94a3b8; padding: 4px; }
  .label { flex: 0 0 120px; background: #f1f5f9; }
  .bw { overflow-wrap: break-word; }
  .aw { overflow-wrap: anywhere; }
  .ba { word-break: break-all; }
  .narrow { width: 150px; border: 2px solid #94a3b8; padding: 4px; margin: 8px 0; }
</style>
</head>
<body>
  <p>Во flex-строке шириной 520px (метка + текст):</p>
  <div class="row"><div class="label">по умолчанию</div><div>https://example.com/very/long/path/without/any/spaces/at/all</div></div>
  <div class="row"><div class="label">break-word</div><div class="bw">https://example.com/very/long/path/without/any/spaces/at/all</div></div>
  <div class="row"><div class="label">anywhere</div><div class="aw">https://example.com/very/long/path/without/any/spaces/at/all</div></div>
  <p>В обычном блоке шириной 150px:</p>
  <div class="narrow bw">break-word: обычный текст и https://example.com/a/long/path</div>
  <div class="narrow ba">break-all: обычный текст и https://example.com/a/long/path</div>
</body>
</html>
```

</details>

Во flex-строке без переноса и с `break-word` текст вылезает или распирает строку (минимальная ширина
flex-элемента — `auto`, то есть его min-content). С `anywhere` элемент сжимается. В обычном блоке
`break-word` рвёт только длинный URL, а `break-all` режет и обычные слова посередине.

Для пользовательского содержимого (комментарии, имена) надёжная настройка: `overflow-wrap: anywhere` на
контейнере.

## 9. Многоточие

### 9.1. Одна строка: четыре условия

`text-overflow: ellipsis` работает, только если выполнены **все** условия:

1. элемент — **блочный контейнер** (block container): `block`, `inline-block`, ячейка таблицы, flex-элемент
   (у него блочное содержимое), но не `inline`;
2. ширина **ограничена**: задана явно или ограничена родителем;
3. текст **не переносится**: `white-space: nowrap` (или `text-wrap-mode: nowrap`);
4. **`overflow` не `visible`**: `hidden` или `clip`.

```css
.ellipsis {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
```

Классическая ловушка — многоточие внутри flex-строки: flex-элемент по умолчанию имеет `min-width: auto` (не
меньше min-content), а у текста с `nowrap` min-content — вся строка. Элемент не сжимается, многоточия нет.
Лечится `min-width: 0` на flex-элементе (для grid — `minmax(0, 1fr)` или `min-width: 0`).

<details>
<summary>Многоточие: условия и ловушка flex</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-typography.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px/1.4 system-ui; width: 360px; }
  .e { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .box { border: 2px solid #94a3b8; padding: 4px; margin: 6px 0; }
  .flex { display: flex; gap: 8px; border: 2px solid #94a3b8; padding: 4px; margin: 6px 0; }
  .flex .icon { flex: none; width: 24px; height: 20px; background: #2563eb; border-radius: 4px; }
  .fix { min-width: 0; }
</style>
</head>
<body>
  <div class="box e">Блок: все четыре условия выполнены, поэтому длинный текст обрезан многоточием</div>
  <div class="box"><span class="e">span (inline): не блочный контейнер, многоточия нет, текст переносится</span></div>
  <div class="flex"><div class="icon"></div><div class="e">flex-элемент без min-width: 0 не сжимается и выталкивает текст наружу</div></div>
  <div class="flex"><div class="icon"></div><div class="e fix">flex-элемент с min-width: 0 сжимается, и многоточие появляется</div></div>
</body>
</html>
```

</details>

### 9.2. Несколько строк

Многострочное многоточие делается через свойство из старого WebKit, которое сейчас поддерживают все
основные браузеры:

```css
.clamp {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}
```

Все четыре строки обязательны. Без `display: -webkit-box` и `-webkit-box-orient` свойство не работает.
Обрезанный текст остаётся в DOM: он доступен поиску по странице и читалке экрана, поэтому показывайте
полный текст по ссылке или в `title`, если он важен.

<details>
<summary>line-clamp: три строки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-typography.html#example-9">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui; }
  .card { width: 300px; border: 2px solid #94a3b8; border-radius: 8px; padding: 10px; }
  .clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
</style>
</head>
<body>
  <div class="card"><p class="clamp" style="margin:0">Длинное описание карточки, которое должно занимать не больше трёх строк.
    Всё, что не поместилось, заканчивается многоточием в конце третьей строки, а высота карточки
    остаётся предсказуемой для сетки, сколько бы текста ни пришло с сервера.</p></div>
</body>
</html>
```

</details>

## 10. Прочие полезные свойства

- `text-rendering: optimizeLegibility` — включает кернинг и лигатуры в старых движках; в современных они
  уже включены, а на больших текстах свойство замедляет раскладку.
- `-webkit-font-smoothing: antialiased` — влияет только на macOS; делает светлый текст на тёмном фоне
  тоньше. Не «улучшает» шрифт в целом.
- `text-underline-offset`, `text-decoration-thickness`, `text-decoration-skip-ink` — аккуратные
  подчёркивания ссылок вместо `border-bottom`.
- `font-optical-sizing: auto` — вариативные шрифты с осью `opsz` подстраивают рисунок под размер.
- `letter-spacing` у заглавных и капители: прописные выглядят лучше с небольшой разрядкой (0.05em), а
  строчные разрядка портит.

## Итог

- Шрифт выбирается **для каждого символа** по очереди списка; список заканчивается родовым семейством без кавычек.
- `@font-face` загружает файл только по требованию. `font-display: swap` — для текста, `block` — для
  иконок, `optional` — для украшений; `size-adjust` уменьшает прыжок раскладки.
- Предзагрузка шрифта требует `crossorigin` даже для своего домена.
- `line-height` — **без единиц**: число наследуется как множитель, длина — как готовые пиксели.
- Ритм — кратные шаги; `lh`/`rlh` дают их без вычислений. Отступы — в одну сторону.
- `font-variant-numeric: tabular-nums` — для таблиц и счётчиков; `font-feature-settings` перезаписывает
  список целиком.
- `hyphens: auto` без правильного `lang` не работает. `text-wrap: balance` — для заголовков, `pretty` —
  для абзацев.
- `overflow-wrap: anywhere` в отличие от `break-word` уменьшает min-content; `word-break: break-all` режет
  любое слово.
- Многоточие: блочный контейнер, ограниченная ширина, `nowrap`, `overflow` не `visible`; во flex — ещё
  `min-width: 0`.

## Проверьте себя

1. Почему `font-family: "sans-serif"` в кавычках может не дать шрифта без засечек?
2. В блоке задано `font-size: 16px; line-height: 1.25em`. Какая высота строки будет у его потомка с
   `font-size: 40px`, и что изменится при `line-height: 1.25`?
3. Какое значение `font-display` выбрать для иконочного шрифта и почему не `swap`?
4. Почему `hyphens: auto` не переносит слова на странице без атрибута `lang`?
5. У flex-элемента заданы `overflow: hidden; white-space: nowrap; text-overflow: ellipsis`, но многоточия
   нет. Что добавить?
6. Чем `overflow-wrap: anywhere` отличается от `overflow-wrap: break-word` в ячейке таблицы?

Дальше: [Переходы и анимации](LEARN_CSS_TRANSITIONS_ANIMATIONS_COURSE.md).
