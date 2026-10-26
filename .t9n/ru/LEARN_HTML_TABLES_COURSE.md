# Таблицы

> Курс 28 из программы. Для тех, кто прошёл [Формы](LEARN_HTML_FORMS_COURSE.md) и знает основы
> [Каскада](LEARN_CSS_CASCADE_COURSE.md). Таблица — единственная часть HTML, у которой есть
> собственная двумерная модель раскладки, собственные слои отрисовки и полтора десятка лет истории
> злоупотреблений. Здесь — только **таблицы данных**: зачем они, как устроены и как их стилизовать.

**Что вы будете понимать после курса**

- когда таблица — правильный выбор, а когда нет, и откуда взялась вёрстка таблицами;
- из чего состоит таблица: `caption`, `thead`, `tbody`, `tfoot`, `tr`, `th`, `td`, и что парсер
  достраивает сам;
- как `th` с `scope` и `headers` связывает ячейку с её заголовками;
- что можно стилизовать через `colgroup`/`col`, а что нельзя — и почему;
- чем отличаются `border-collapse: collapse` и `separate`, что делает `table-layout: fixed`;
- почему «зебру» красят на ячейках, как сделать липкую шапку и таблицу для узкого экрана.

---

## 1. Таблица — это данные с двумя осями

Таблица уместна, когда у каждого значения есть **строка и столбец**, и оба что-то значат: «цена» ×
«тариф», «месяц» × «показатель». Проверка простая: если прочитать ячейку можно только вместе с её
заголовками («в марте выручка 120») — это таблица. Если строки можно переставить в список карточек
без потери смысла — скорее всего, это список.

### 1.1. Почему не таблицы для раскладки

В конце 1990-х у CSS не было ни способа поставить блоки рядом, ни поддержки в браузерах. Таблица
была единственным инструментом сетки: сайты резали на ячейки, вкладывали таблицы в таблицы, а
промежутки делали прозрачной картинкой 1×1 (spacer GIF). Последствия:

- **смысл** терялся: скринридер объявлял «таблица, 3 столбца, 12 строк» для меню и подвала;
- **порядок чтения** задавался сеткой, а не содержанием;
- **адаптивность** невозможна: ячейки не умеют переноситься на новую строку;
- **отрисовка**: в автоматической раскладке ширина столбцов зависит от содержимого всех строк,
  и старые браузеры не показывали таблицу, пока она не загрузится целиком.

Сегодня для раскладки есть Flexbox и Grid. Если таблицу всё же использовали для вида (например,
в HTML-письмах, где почтовые клиенты плохо понимают CSS), ставят `role="presentation"` — тогда
вспомогательные технологии не объявляют её таблицей.

## 2. Анатомия

<details>
<summary>Полная таблица со всеми частями</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-tables.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; }
  table { border-collapse: collapse; }
  caption { font-weight: bold; padding: 6px; caption-side: top; }
  th, td { border: 1px solid #94a3b8; padding: 6px 10px; }
  thead { background: #dbeafe; }
  tbody { background: #fff; }
  tfoot { background: #fef3c7; font-weight: bold; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
  <table>
    <caption>Продажи по кварталам, тыс. ₾</caption>
    <thead>
      <tr><th scope="col">Отдел</th><th scope="col">I кв.</th><th scope="col">II кв.</th></tr>
    </thead>
    <tbody>
      <tr><th scope="row">Север</th><td class="num">120</td><td class="num">98</td></tr>
      <tr><th scope="row">Юг</th><td class="num">87</td><td class="num">1 104</td></tr>
    </tbody>
    <tfoot>
      <tr><th scope="row">Итого</th><td class="num">207</td><td class="num">1 202</td></tr>
    </tfoot>
  </table>
</body>
</html>
```

</details>

| Элемент | Значение | `display` |
|---|---|---|
| `table` | таблица | `table` |
| `caption` | заголовок — доступное имя таблицы | `table-caption` |
| `colgroup`, `col` | группы и столбцы | `table-column-group`, `table-column` |
| `thead`, `tbody`, `tfoot` | группы строк | `table-header-group`, `table-row-group`, `table-footer-group` |
| `tr` | строка | `table-row` |
| `th` | ячейка-заголовок | `table-cell` |
| `td` | ячейка данных | `table-cell` |

Порядок детей `table` строгий: `caption`, затем `colgroup`, затем `thead`, затем `tbody` (или `tr`),
затем `tfoot`. Раньше `tfoot` разрешалось ставить перед `tbody`, чтобы браузер мог показать итог,
не дождавшись длинного тела; сейчас — только после. При печати длинной таблицы `thead` и `tfoot`
повторяются на каждой странице.

### 2.1. Что достраивает парсер

- `tr` прямо в `table` → парсер оборачивает его в **`tbody`**. Поэтому селектор `table > tr`
  **никогда** не совпадёт в HTML-документе, а `table > tbody > tr` совпадёт, хотя `tbody` вы не
  писали.
- Текст или `div` между ячейками нельзя: парсер **выносит** их перед таблицей (foster parenting).
- `</td>`, `</th>`, `</tr>` можно опустить — они закрываются следующим `td`/`tr`.

<details>
<summary>Невидимый tbody и вынесенный текст</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-tables.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; }
  td { border: 1px solid #64748b; padding: 4px 8px; }
  table > tr td { background: #fee2e2; }        /* не сработает */
  table > tbody > tr td { outline: 2px solid #16a34a; } /* сработает */
  div.lost { background: #fde047; }
  pre { background: #f1f5f9; padding: 6px; }
</style>
</head>
<body>
  <table id="t">
    <tr><td>A</td><td>B</td>
    <div class="lost">Я div внутри таблицы</div>
    <tr><td>C</td><td>D</td>
  </table>
  <pre id="out"></pre>
  <script>
    const t = document.getElementById('t');
    document.getElementById('out').textContent =
      'Дети table: ' + [...t.children].map(n => n.tagName).join(', ') +
      '\nПеред таблицей: ' + t.previousElementSibling.className;
  </script>
</body>
</html>
```

</details>

### 2.2. Значения по умолчанию

Стили браузера для таблиц (с небольшими различиями): `table { border-collapse: separate;
border-spacing: 2px; box-sizing: border-box; text-indent: initial; }`, у ячеек `padding: 1px`,
`vertical-align: middle` (наследуется от групп строк), `th { font-weight: bold; text-align: center }`
(в Chrome — внутреннее значение, которое наследуется в `th` из `thead`, но не из `body`). Отсюда
привычный «первый шаг» сброса: `border-collapse: collapse` и `text-align: start` у `th`.

### 2.3. Объединение: `colspan`, `rowspan`

`colspan="2"` растягивает ячейку на два столбца, `rowspan="2"` — на две строки. Таблица всё равно
остаётся прямоугольной сеткой: ячейка с `rowspan` «занимает» место в следующей строке, и там
ячеек нужно писать на одну меньше. `rowspan="0"` тянет ячейку до конца группы строк.

## 3. Заголовки: `th`, `scope`, `headers`

Скринридер в таблице читает ячейку **вместе с её заголовками**: «II кв., Юг, 1 104». Для этого
он должен знать, какие `th` относятся к какой `td`.

- **`scope="col"`** — заголовок столбца, **`scope="row"`** — строки.
- `scope="colgroup"`/`"rowgroup"` — заголовок над группой столбцов или строк.
- Без `scope` браузер угадывает по положению, обычно верно для простой таблицы, но не всегда.
- **`headers="id1 id2"`** на `td` — явный список заголовков для сложных таблиц, где угадать нельзя
  (несколько уровней, объединённые ячейки).
- Первый столбец с названиями строк — тоже заголовки: `th scope="row"`, а не `td` с жирным шрифтом.

<details>
<summary>Двухуровневая шапка: scope и headers</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-tables.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #94a3b8; padding: 5px 10px; }
  thead th { background: #ede9fe; }
  tbody th { background: #f8fafc; text-align: start; }
  td { text-align: right; }
  /* Подсветка заголовков ячейки при наведении: читаем атрибут headers */
  th.hl { background: #fde047; }
</style>
</head>
<body>
  <p>Наведите курсор на число — подсветятся его заголовки из <code>headers</code>.</p>
  <table>
    <caption>Посещаемость</caption>
    <thead>
      <tr><td></td><th id="d" colspan="2" scope="colgroup">Десктоп</th><th id="m" colspan="2" scope="colgroup">Мобильные</th></tr>
      <tr><td></td><th id="d1" scope="col">2025</th><th id="d2" scope="col">2026</th><th id="m1" scope="col">2025</th><th id="m2" scope="col">2026</th></tr>
    </thead>
    <tbody>
      <tr><th id="r1" scope="row">Блог</th>
        <td headers="d d1 r1">410</td><td headers="d d2 r1">380</td><td headers="m m1 r1">520</td><td headers="m m2 r1">790</td></tr>
      <tr><th id="r2" scope="row">Магазин</th>
        <td headers="d d1 r2">1 200</td><td headers="d d2 r2">1 150</td><td headers="m m1 r2">900</td><td headers="m m2 r2">1 640</td></tr>
    </tbody>
  </table>
  <script>
    document.querySelector('table').addEventListener('mouseover', e => {
      document.querySelectorAll('.hl').forEach(n => n.classList.remove('hl'));
      const td = e.target.closest('td[headers]');
      if (td) td.getAttribute('headers').split(' ').forEach(id => document.getElementById(id).classList.add('hl'));
    });
  </script>
</body>
</html>
```

</details>

`caption` — лучший способ дать таблице имя: он и виден, и становится её доступным именем. Если
подпись не нужна визуально, её прячут классом «только для скринридера», а не удаляют. Положение
меняется свойством `caption-side: top | bottom`.

## 4. `colgroup` и `col`: стилизация столбцов

Желание естественное: «покрасить третий столбец», «выровнять столбец сумм вправо». Но **ячейки не
являются потомками `col`** — в дереве они дети `tr`. Поэтому наследование от `col` не работает, и к
столбцу применяются только четыре свойства:

| Свойство на `col` | Работает? | Почему |
|---|---|---|
| `background` | да | столбец — отдельный слой отрисовки под ячейками |
| `border` | да, только при `border-collapse: collapse` | границы столбца участвуют в разрешении конфликтов |
| `width` | да | задаёт ширину столбца при раскладке |
| `visibility: collapse` | да | убирает столбец, не пересчитывая раскладку остальных |
| `text-align`, `color`, `font`, `padding` | **нет** | наследуются по дереву, а ячейки не внутри `col` |

Для остального — селектор по позиции: `td:nth-child(3)` (осторожно с `colspan`: он сбивает
нумерацию) или класс на ячейках.

<details>
<summary>Что col умеет, а что нет</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-tables.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #cbd5e1; padding: 5px 12px; }
  col.price { background: #dcfce7; width: 9em; border: 3px solid #16a34a; }
  /* Эти свойства на col игнорируются: */
  col.price { text-align: right; color: #dc2626; font-weight: bold; }
  /* Работающий способ: */
  td:nth-child(3) { text-align: right; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
  <table>
    <colgroup>
      <col>
      <col span="1">
      <col class="price">
    </colgroup>
    <tr><th>Товар</th><th>Ед.</th><th>Цена</th></tr>
    <tr><td>Бумага</td><td>пачка</td><td>12,50</td></tr>
    <tr><td>Карандаш</td><td>шт.</td><td>1,20</td></tr>
  </table>
  <p>Фон, рамка и ширина столбца «Цена» пришли от <code>col</code>. Цвет и жирность — нет.
  Выравнивание вправо сделано через <code>:nth-child(3)</code>.</p>
</body>
</html>
```

</details>

## 5. Слои отрисовки и «зебра»

### 5.1. Шесть слоёв

Фоны в таблице рисуются стопкой, снизу вверх:

1. `table`
2. группы столбцов (`colgroup`)
3. столбцы (`col`)
4. группы строк (`thead`, `tbody`, `tfoot`)
5. строки (`tr`)
6. ячейки (`td`, `th`)

Верхний слой виден, только если нижние прозрачны **в этом месте**. Фон ячейки закрывает фон строки,
фон строки — фон столбца. Это та же логика, что и в обычном потоке: фон не наследуется, он
**просвечивает** сквозь прозрачные слои сверху.

### 5.2. Почему зебру красят на `td`

`tr:nth-child(even) { background: … }` работает — но хрупко:

- любой фон на ячейке (подсветка, `th` с фоном, **липкая ячейка**, которой фон нужен, чтобы не
  просвечивало прокручиваемое содержимое) закрывает полосу строки;
- `border`, `padding`, `border-radius` у `tr` не действуют (у строки нет своих полей, а рамку она
  получает только в модели `collapse`);
- в модели `separate` фон строки виден только под её ячейками, а щели `border-spacing` показывают
  фон таблицы — полоса получается «рваной», что сбивает с толку при отладке.

Надёжная запись — переносить полосу на ячейки: `tbody tr:nth-child(even) > *`. Тогда фон живёт на
том же слое, что и прочие фоны ячеек, и правила каскада между ними прозрачны: побеждает
специфичность и порядок, а не слой.

<details>
<summary>Зебра на tr ломается, на td нет</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-tables.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; display: flex; gap: 20px; flex-wrap: wrap; align-items: start; }
  table { border-collapse: collapse; }
  th, td { padding: 5px 10px; border-bottom: 1px solid #cbd5e1; }
  tbody th { background: white; text-align: start; } /* фон нужен, например, для липкого столбца */
  .tr-zebra tbody tr:nth-child(even) { background: #e0e7ff; }
  .td-zebra tbody tr:nth-child(even) > * { background: #e0e7ff; }
</style>
</head>
<body>
  <table class="tr-zebra">
    <caption>Полоса на tr</caption>
    <tbody>
      <tr><th>Пн</th><td>3</td><td>7</td></tr>
      <tr><th>Вт</th><td>5</td><td>2</td></tr>
      <tr><th>Ср</th><td>1</td><td>8</td></tr>
      <tr><th>Чт</th><td>4</td><td>6</td></tr>
    </tbody>
  </table>
  <table class="td-zebra">
    <caption>Полоса на ячейках</caption>
    <tbody>
      <tr><th>Пн</th><td>3</td><td>7</td></tr>
      <tr><th>Вт</th><td>5</td><td>2</td></tr>
      <tr><th>Ср</th><td>1</td><td>8</td></tr>
      <tr><th>Чт</th><td>4</td><td>6</td></tr>
    </tbody>
  </table>
</body>
</html>
```

</details>

Слева белый фон `th` закрыл полосу строки — в первом столбце она прерывается. Справа полоса стоит на
ячейках, и правило `.td-zebra tbody tr:nth-child(even) > *` (0,2,2) перевешивает `tbody th` (0,0,2).

## 6. Границы: `separate` против `collapse`

| | `border-collapse: separate` (по умолчанию) | `border-collapse: collapse` |
|---|---|---|
| у каждой ячейки | своя рамка | рамки соседей **сливаются в одну** |
| промежуток | `border-spacing` | нет |
| рамка у `tr`, `col`, `tbody` | не рисуется | рисуется |
| `border-radius` ячеек | работает | не работает |
| `empty-cells: hide` | работает | не применяется |

В модели `collapse` при встрече двух разных рамок побеждает одна по правилам **разрешения
конфликтов** (border conflict resolution): `hidden` побеждает всё; затем более **широкая**; при
равной ширине — по стилю (от сильного к слабому: `double`, `solid`, `dashed`, `dotted`, `ridge`,
`outset`, `groove`, `inset`); при равенстве — по источнику: ячейка > строка > группа строк > столбец > группа
столбцов > таблица. `none` проигрывает всем.

<details>
<summary>separate, collapse и конфликт рамок</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-tables.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; display: flex; gap: 24px; flex-wrap: wrap; align-items: start; }
  table { border: 3px solid #1e293b; }
  td { border: 1px solid #94a3b8; padding: 6px 12px; }
  .sep { border-collapse: separate; border-spacing: 6px; }
  .sep td { border-radius: 6px; background: #f1f5f9; }
  .col { border-collapse: collapse; }
  /* Строка с толстой рамкой: работает только в collapse */
  tr.hot { border: 3px dashed #dc2626; }
  /* Ячейка с ещё более толстой: побеждает по ширине */
  td.wide { border: 5px solid #2563eb; }
</style>
</head>
<body>
  <table class="sep">
    <caption>separate</caption>
    <tr><td>1</td><td>2</td><td>3</td></tr>
    <tr class="hot"><td>4</td><td class="wide">5</td><td>6</td></tr>
  </table>
  <table class="col">
    <caption>collapse</caption>
    <tr><td>1</td><td>2</td><td>3</td></tr>
    <tr class="hot"><td>4</td><td class="wide">5</td><td>6</td></tr>
  </table>
</body>
</html>
```

</details>

Скруглить углы таблицы при `collapse` нельзя: используют `separate` с `border-spacing: 0`, а рамки
рисуют только справа и снизу у ячеек, чтобы они не удваивались.

## 7. Раскладка: `auto` против `fixed`

По умолчанию (`table-layout: auto`) ширина столбцов зависит от **содержимого всех ячеек**: браузер
находит минимальную и максимальную ширину каждого столбца и распределяет место. Это удобно, но:

- одна длинная строка без пробелов (URL, хеш) растягивает весь столбец и таблицу;
- пока не известно содержимое последней строки, ширины окончательно не известны.

`table-layout: fixed` считает ширины по **первой строке** (или по `col`) и ширине таблицы —
содержимое остальных строк не влияет. Обязательное условие: у таблицы задана ширина (не `auto`),
иначе свойство не действует. Плюсы: предсказуемость, скорость на тысячах строк, и наконец работают
`overflow: hidden` + `text-overflow: ellipsis` в ячейках.

<details>
<summary>auto против fixed с длинной строкой</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-tables.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; max-width: 520px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #94a3b8; padding: 4px 8px; text-align: start; }
  .fixed { table-layout: fixed; }
  .fixed th:first-child { width: 6em; }
  .fixed td { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wrap { outline: 2px dashed #f59e0b; }
</style>
</head>
<body>
  <div class="wrap">
    <table>
      <caption>table-layout: auto</caption>
      <tr><th>Файл</th><th>SHA-256</th></tr>
      <tr><td>a.zip</td><td>9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08</td></tr>
    </table>
  </div>
  <table class="fixed">
    <caption>table-layout: fixed</caption>
    <tr><th>Файл</th><th>SHA-256</th></tr>
    <tr><td>a.zip</td><td title="9f86d0…">9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08</td></tr>
  </table>
</body>
</html>
```

</details>

## 8. Липкая шапка и узкий экран

### 8.1. `position: sticky` на `th`

Шапку закрепляют на ячейках: `thead th { position: sticky; top: 0 }`. Липкий элемент прилипает к
ближайшему **прокручиваемому предку** (scroll container), поэтому обёртка с `overflow: auto` и
ограниченной высотой становится «окном», в котором шапка держится.

Две обязательные детали:

- **фон** у липких ячеек — иначе строки просвечивают сквозь шапку при прокрутке (вот где зебра на
  `tr` и ломается окончательно);
- в модели `collapse` рамки принадлежат таблице, а не ячейке, и при прилипании «уезжают» с
  содержимым. Используйте `separate` с `border-spacing: 0` или рисуйте нижнюю линию через
  `box-shadow`.

### 8.2. Обёртка с прокруткой

Таблица по природе не сжимается уже суммы минимальных ширин столбцов. На телефоне она выдавит
страницу вбок. Простое и честное решение — обёртка:

```html
<div class="table-scroll" role="region" aria-labelledby="cap1" tabindex="0">
  <table>…<caption id="cap1">…</caption>…</table>
</div>
```

`tabindex="0"` позволяет прокручивать с клавиатуры, `role="region"` с именем объясняет, что это за
область. Перестраивать таблицу в карточки через `display: block` на ячейках тоже можно, но в
некоторых браузерах смена `display` у табличных элементов убирала табличную семантику для
вспомогательных технологий — после такого её приходится возвращать явными `role`.

<details>
<summary>Липкая шапка и первый столбец (прокрутите)</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-tables.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  .ap-scroll { max-height: 180px; max-width: 360px; overflow: auto; border: 2px solid #334155; }
  .ap-scroll:focus-visible { outline: 3px solid #f59e0b; }
  table { border-collapse: separate; border-spacing: 0; }
  th, td { padding: 6px 12px; white-space: nowrap; border-bottom: 1px solid #e2e8f0; background: white; }
  thead th { position: sticky; top: 0; background: #1e293b; color: white; z-index: 1; }
  tbody th { position: sticky; left: 0; background: #f1f5f9; text-align: start; }
  thead th:first-child { left: 0; z-index: 2; } /* угол: липкий в обе стороны, поверх всех */
  tbody tr:nth-child(even) > td { background: #f8fafc; }
</style>
</head>
<body>
  <div class="ap-scroll" role="region" aria-labelledby="cap" tabindex="0">
    <table id="t">
      <caption id="cap">Содержимое архива</caption>
      <thead><tr><th>Имя</th><th>Размер</th><th>Сжато</th><th>Метод</th><th>Изменён</th><th>CRC32</th></tr></thead>
      <tbody></tbody>
    </table>
  </div>
  <script>
    const tb = document.querySelector('#t tbody');
    for (let i = 1; i <= 20; i++) {
      tb.insertAdjacentHTML('beforeend',
        '<tr><th scope="row">file-' + i + '.txt</th><td>' + i * 1024 + '</td><td>' + i * 300 +
        '</td><td>deflate</td><td>2026-10-' + String(i).padStart(2, '0') + '</td><td>' +
        (i * 2654435761 >>> 0).toString(16) + '</td></tr>');
    }
  </script>
</body>
</html>
```

</details>

## 9. Полезные мелочи

- **Числа** выравнивают вправо и задают `font-variant-numeric: tabular-nums` — цифры одной ширины,
  разряды стоят друг под другом.
- **Сортировка**: состояние столбца — в `aria-sort="ascending" | "descending"` на `th`; кнопку
  сортировки кладут **внутрь** `th`. Стилизуйте по `th[aria-sort]` (см. [HTML как набор крючков для
  селекторов](LEARN_HTML_SELECTORS_COURSE.md)).
- **DOM-API**: `table.rows`, `table.tBodies`, `row.cells`, `table.insertRow()`, `row.insertCell()`,
  `cell.cellIndex` (номер в строке, без учёта объединений).
- Пустая `td` в модели `separate` рисует рамку, `empty-cells: hide` её убирает.
- `vertical-align` в ячейке работает иначе, чем в строке текста: `top`, `middle`, `bottom`,
  `baseline` выравнивают **содержимое** ячейки внутри строки.

## Итог

- Таблица — для данных с двумя значимыми осями. Для раскладки — Grid и Flexbox; историческая
  вёрстка таблицами ломала смысл, порядок чтения и адаптивность.
- Парсер сам вставляет `tbody` и выносит лишнее из таблицы; `table > tr` не совпадает никогда.
- `caption` — имя таблицы; `th` со `scope` — связь заголовков; `headers` — для сложных шапок.
- `col` принимает только `background`, `border`, `width`, `visibility`: ячейки не его потомки.
- Фоны рисуются слоями (таблица → столбцы → строки → ячейки), поэтому зебру и прочие фоны держат
  на ячейках.
- `collapse` сливает рамки по правилам конфликтов, `separate` — даёт промежутки и скругления.
- `table-layout: fixed` + ширина таблицы — предсказуемые столбцы и работающий `ellipsis`.
- Липкая шапка — `position: sticky` на `th` с фоном; узкий экран — обёртка с `overflow: auto`.

## Проверьте себя

1. Почему `col { text-align: right }` не выравнивает ячейки, а `col { background: … }` красит их?
2. Вы написали `<table><tr>…</tr></table>`. Какой будет цепочка предков у `td`?
3. Две соседние ячейки: у одной `border: 2px dotted`, у другой `2px solid`, `border-collapse:
   collapse`. Какая линия будет видна?
4. При каком условии `table-layout: fixed` не действует?
5. Зачем липким `th` явный фон?
6. Почему таблица на узком экране не сжимается, а выдавливает страницу вбок?

Дальше: [Медиа: изображения, видео, SVG](LEARN_HTML_MEDIA_COURSE.md).
