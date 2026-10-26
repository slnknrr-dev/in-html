# Элементы и семантическая вёрстка

> Курс 24 из программы. Для тех, кто знает, как браузер строит дерево и раскладывает блоки, и
> хочет выбирать элементы не «по внешнему виду», а по смыслу: понимать, что разрешено внутри чего,
> во что превращается каждый тег для скринридера и почему `<div>` — последний, а не первый выбор.

**Что вы будете понимать после курса**

- что такое **категории содержимого** и **модель содержимого** и почему именно они, а не «блочный
  и строчный», решают, что можно вкладывать;
- как парсер «чинит» неправильную вложенность и почему из-за этого ломаются стили;
- секционирующие элементы и их **ориентиры** (landmarks) в дереве доступности;
- почему «алгоритм структуры документа» — миф и как на самом деле расставлять заголовки;
- разницу `em`/`i`, `strong`/`b`, смысл `small`, `mark`, `time`, `abbr`, `code`, `kbd`, `samp`;
- списки, `figure`, `details`/`summary`, `dialog`;
- почему «блочный» и «строчный» — свойство CSS, а не HTML.

---

## 1. Элемент — это смысл, а не вид

Каждый элемент HTML имеет **значение** (semantics), записанное в спецификации: `<p>` — абзац,
`<nav>` — блок навигации, `<em>` — смысловое ударение. Внешний вид — это всего лишь стили браузера
(user-agent stylesheet), которые вы переопределите одной строкой CSS. Значение переопределить
нельзя: его читают

- **дерево доступности** (accessibility tree) — из него скринридер узнаёт, что перед ним
  навигация, список из пяти пунктов, заголовок второго уровня;
- поисковики и режимы чтения (Reader View выбрасывает `nav`, `aside`, `footer`);
- браузер: `<a href>` фокусируется с клавиатуры, `<button>` нажимается пробелом, `<dialog>`
  уходит в верхний слой;
- ваши же селекторы: `nav a` понятнее, чем `.menu-wrap-inner > .item > .link`. Об этом курс
  [HTML как набор крючков для селекторов](LEARN_HTML_SELECTORS_COURSE.md).

## 2. Категории и модель содержимого

### 2.1. Категории

Спецификация HTML относит каждый элемент к одной или нескольким **категориям содержимого**
(content categories):

| Категория | Что это | Примеры |
|---|---|---|
| Метаданные (metadata) | описание документа | `title`, `meta`, `link`, `style`, `script` |
| Потоковое (flow) | почти всё, что бывает в `body` | `p`, `div`, `ul`, `a`, `em`, текст |
| Секционирующее (sectioning) | задаёт границы раздела | `article`, `section`, `nav`, `aside` |
| Заголовочное (heading) | заголовок раздела | `h1`–`h6`, `hgroup` |
| Фразовое (phrasing) | текст и разметка внутри абзаца | `em`, `a`, `span`, `img`, `code`, текст |
| Встроенное (embedded) | внешний контент | `img`, `video`, `iframe`, `svg`, `canvas` |
| Интерактивное (interactive) | то, с чем взаимодействуют | `a[href]`, `button`, `input`, `details`, `label` |

Категории пересекаются: `<a>` — потоковое, фразовое и (с `href`) интерактивное.

### 2.2. Модель содержимого

Для каждого элемента спецификация пишет **модель содержимого** (content model) — каких детей он
допускает:

- `<p>` — только **фразовое** содержимое. Внутри абзаца не бывает `<div>`, `<ul>`, `<h2>`;
- `<ul>`, `<ol>` — только `<li>` (и `script`/`template`);
- `<button>`, `<a>` — нельзя вкладывать **интерактивное** (кнопку в ссылку, ссылку в ссылку);
- `<a>`, `<ins>`, `<del>`, `<object>` — **прозрачная** модель (transparent): разрешено то, что
  разрешено их родителю. Поэтому `<a>` внутри `<div>` может содержать целую карточку с `<h3>` и
  `<p>`, а `<a>` внутри `<p>` — только фразовое.

### 2.3. Что делает парсер с нарушениями

Нарушение модели содержимого бывает двух видов. Одно — просто «невалидно», дерево строится как
написано (например, `<div>` внутри `<span>`). Другое — парсер **перестраивает дерево**: правила
построения дерева (tree construction) закрывают элементы автоматически.

Классика: `<p>` закрывается, как только парсер встречает открывающий тег блочного по смыслу
элемента — `div`, `ul`, `h1`–`h6`, `table`, `section` и т. п. Закрывающий `</p>`, оставшийся без
пары, превращается в **новый пустой абзац**.

<details>
<summary>Парсер разрывает абзац</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-elements.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Автозакрытие p</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  p { outline: 2px solid #3a7bd5; background: #eef6ff; min-height: 1em; margin: 8px 0; }
  div { outline: 2px dashed #c33; background: #ffecec; }
  pre { background: #f4f4f4; padding: 8px; }
</style>
</head>
<body>
  <section id="src">
    <p>Начало абзаца <div>вложенный div</div> хвост</p>
  </section>
  <p>Синие рамки — элементы p, красная — div. Пустой синий прямоугольник появился из лишнего &lt;/p&gt;.
     Дерево после разбора:</p>
  <pre id="out"></pre>
  <script>
    document.getElementById('out').textContent = document.getElementById('src').innerHTML.trim();
  </script>
</body>
</html>
```

</details>

Практическое следствие: стиль `p div { ... }` здесь не применится никогда — в дереве `div` не внутри
`p`. Отлаживайте **DOM** в инструментах разработчика, а не исходник. Ещё примеры: вложенная `<a>`
закрывает предыдущую; `<li>` закрывает предыдущий `<li>`; текст между `<tr>` выносится перед
таблицей (foster parenting) — см. [Таблицы](LEARN_HTML_TABLES_COURSE.md).

## 3. Секционирующие элементы и ориентиры

### 3.1. Элементы

| Элемент | Значение | Ориентир (роль ARIA) |
|---|---|---|
| `<header>` | вводная часть: логотип, заголовок, навигация | `banner` — только если не внутри `article`, `aside`, `main`, `nav`, `section` |
| `<footer>` | заключение: автор, права, связанные ссылки | `contentinfo` — с тем же ограничением |
| `<main>` | основное содержимое страницы | `main` |
| `<nav>` | основной блок навигационных ссылок | `navigation` |
| `<aside>` | косвенно связанное: врезка, реклама, боковая колонка | `complementary` |
| `<article>` | самостоятельная, переносимая единица: пост, комментарий, карточка товара | `article` (не ориентир, но структурная роль) |
| `<section>` | тематический раздел с заголовком | `region` — **только если есть доступное имя** |
| `<search>` | область поиска или фильтрации | `search` |

**Ориентиры** (landmarks) — это «оглавление» страницы для скринридера: пользователь VoiceOver или
NVDA открывает список ориентиров и сразу прыгает к навигации или основному тексту. Без них страница
для него — сплошной поток.

Ключевые правила:

- `<main>` — один видимый на странице (можно несколько, если остальные `hidden`); не внутри
  `article`, `aside`, `header`, `footer`, `nav`;
- `<header>` внутри `<article>` — это шапка статьи, а не страницы, поэтому роли `banner` у неё нет;
- `<section>` без заголовка или `aria-label` — просто `<div>` с другим именем. Если не можете
  придумать разделу заголовок, вероятно, это не раздел;
- несколько `<nav>` различают подписями: `<nav aria-label="Основное">`, `<nav aria-label="Хлебные крошки">`;
- `<article>` проверяется вопросом: «имеет ли смысл этот кусок в RSS-ленте или на чужом сайте?»

<details>
<summary>Каркас страницы с ориентирами</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-elements.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Ориентиры</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 12px; display: grid; gap: 8px;
         grid-template-columns: 1fr 180px; grid-template-areas: "h h" "m a" "f f"; }
  body > header { grid-area: h; } main { grid-area: m; } aside { grid-area: a; } body > footer { grid-area: f; }
  header, footer, main, nav, aside, article, section { position: relative; padding: 22px 8px 8px; border: 2px solid; }
  /* Подпись с именем элемента и ролью */
  [data-role]::before { content: attr(data-role); position: absolute; top: 0; left: 0;
                        font: 11px monospace; padding: 1px 4px; color: #fff; background: #333; }
  body > header { color: #8a5a00; background: #fff4dc; }
  nav { color: #1b6e3a; background: #e6f6ec; }
  main { color: #234f9c; background: #eaf0fc; }
  article { color: #6b2fa0; background: #f4ecfb; }
  aside { color: #9c2a2a; background: #fcecec; }
  body > footer { color: #555; background: #f0f0f0; }
  h1, h2, h3, p { color: #222; margin: 4px 0; }
</style>
</head>
<body>
  <header data-role="header → banner"><h1>Сайт</h1>
    <nav aria-label="Основное" data-role="nav → navigation"><a href="#">Курсы</a> · <a href="#">О нас</a></nav>
  </header>
  <main data-role="main → main">
    <article data-role="article → article">
      <header data-role="header в article → нет роли"><h2>Статья</h2></header>
      <p>Текст статьи.</p>
    </article>
  </main>
  <aside data-role="aside → complementary"><h2>Врезка</h2></aside>
  <footer data-role="footer → contentinfo"><p>© 2026</p></footer>
</body>
</html>
```

</details>

### 3.2. Миф об алгоритме структуры

HTML5 (2008–2014) описывал **алгоритм структуры документа** (outline algorithm): каждый
`<section>` начинает новый уровень, поэтому в каждом разделе можно писать `<h1>`, а уровень
вычислится по вложенности. Звучало удобно, но **ни один браузер и ни один скринридер этот алгоритм
не реализовал**. В 2022 году его удалили из спецификации.

Что из этого следует:

- уровень заголовка — это **только** цифра в имени тега. `<h1>` в трёх вложенных `<section>` для
  скринридера — всё ещё заголовок первого уровня;
- расставляйте `h1`–`h6` так, как выглядело бы оглавление: один `h1` (тема страницы), без пропуска
  уровней вниз (`h2` → `h4` — пропуск), вверх прыгать можно;
- размер шрифта заголовков — дело CSS. Нужен маленький `h2` — пишите `h2` и уменьшайте стилем, а не
  берите `h5` «потому что он меньше».

Наследие мифа живёт в стилях браузера: долгое время там было правило, уменьшающее `h1` внутри
`article`, `aside`, `nav`, `section`. Браузеры его постепенно убирают, поэтому не полагайтесь на
него — задавайте размеры заголовков явно.

`<hgroup>` сегодня означает «заголовок + подзаголовок/надзаголовок в абзацах»:

```html
<hgroup>
  <h1>Метаданные</h1>
  <p>Курс 23 из 41</p>
</hgroup>
```

## 4. Текстовая семантика

### 4.1. Пары, которые путают

| Элемент | Значение | Не путать с |
|---|---|---|
| `<em>` | **смысловое ударение**: меняет смысл фразы («Я *не* говорил») | `<i>` |
| `<i>` | **иной голос**: термин, иностранное слово, мысль героя, название судна | `<em>` |
| `<strong>` | **важность, серьёзность, срочность** («Внимание: файл удалится») | `<b>` |
| `<b>` | **привлечь внимание без важности**: ключевые слова в аннотации, имя в обзоре | `<strong>` |
| `<small>` | **побочный комментарий**: мелкий шрифт договора, права, оговорка | «просто мелкий текст» |
| `<s>` | **больше не верно**: старая цена | `<del>` |
| `<del>` / `<ins>` | **правка документа**: удалено / вставлено (с `datetime`, `cite`) | `<s>`, `<u>` |
| `<u>` | **неречевая пометка**: орфографическая ошибка, имя собственное в китайском | подчёркивание для красоты |

`<i>` и `<b>` не устаревшие и не «презентационные»: в HTML5 у них появились смыслы. Устарели
`<font>`, `<center>`, `<big>`, `<tt>`. Вложенность усиливает: `<em><em>очень</em></em>` — сильнее
ударение, `<strong><strong>` — выше важность.

Как это звучит: большинство скринридеров по умолчанию **не меняют интонацию** ни для `em`, ни для
`strong`. Семантика всё равно важна — для режима чтения, перевода, поиска и будущих инструментов.

### 4.2. Полезные малоизвестные элементы

- `<mark>` — **выделение по релевантности**: найденное слово в результатах поиска, место в цитате,
  на которое автор обращает внимание сейчас;
- `<time datetime="2026-10-26T09:00+03:00">` — дата в машиночитаемом виде; текст внутри
  произвольный («вчера утром»);
- `<abbr title="Content Security Policy">CSP</abbr>` — сокращение. Подсказка `title` не видна на
  сенсорных экранах, поэтому при первом упоминании расшифровку пишут текстом;
- `<dfn>` — место, где термин **определяется**;
- `<code>` — фрагмент кода; `<kbd>` — то, что вводит пользователь (`<kbd><kbd>Ctrl</kbd>+<kbd>C</kbd></kbd>`);
  `<samp>` — вывод программы; `<var>` — переменная в формуле или коде;
- `<q>` — короткая цитата, браузер сам добавит кавычки по языку (`quotes` в CSS); `<blockquote>` —
  блочная; `<cite>` — **название произведения**, а не имя автора;
- `<bdi>` — изолирует текст с неизвестным направлением (имя пользователя на арабском в русской
  строке);
- `<wbr>` — место, где разрешён перенос длинного слова или URL;
- `<data value="...">` — машиночитаемое значение для чего угодно, кроме дат.

<details>
<summary>Текстовая семантика в одном абзаце</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-elements.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Текстовая семантика</title>
<style>
  body { font: 17px/1.7 Georgia, serif; margin: 16px; max-width: 60ch; }
  kbd { font: 13px monospace; border: 1px solid #999; border-bottom-width: 3px; border-radius: 4px; padding: 0 5px; background: #fafafa; }
  kbd kbd { border: 0; padding: 0; background: none; }
  code, samp { font: 14px monospace; background: #f0f0f0; padding: 1px 4px; }
  samp { background: #112; color: #9f9; }
  abbr[title] { text-decoration: underline dotted; cursor: help; }
  mark { background: #ffe066; }
  small { color: #666; }
  dfn { font-style: normal; font-weight: 700; }
</style>
</head>
<body>
  <p><dfn>Селектор</dfn> — шаблон над деревом. Я <em>не</em> говорил, что он медленный: слово
    <i lang="en">selector</i> просто звучит строго. <strong>Не удаляйте</strong> файл
    <code>config.js</code>, а нажмите <kbd><kbd>Ctrl</kbd>+<kbd>S</kbd></kbd>; программа ответит
    <samp>Сохранено</samp>. Политику задаёт <abbr title="Content Security Policy">CSP</abbr>,
    принятая <time datetime="2012-11-15">в 2012 году</time>. В результатах поиска найдено:
    «каскад и <mark>селектор</mark>». Цена: <s>990 ₽</s> 490 ₽. <q>Короткая цитата</q>.
    <small>Предложение не является офертой.</small></p>
  <p>Наведите курсор на «CSP», чтобы увидеть title.</p>
</body>
</html>
```

</details>

## 5. Списки

| Элемент | Когда | Особенности |
|---|---|---|
| `<ul>` | порядок не важен | маркеры `::marker`, `list-style-type` |
| `<ol>` | порядок важен: шаги, рейтинг | атрибуты `start`, `reversed`, `type`; у `<li>` — `value` |
| `<dl>` | пары «термин — описание», метаданные | `<dt>` и `<dd>`; группу можно обернуть в `<div>` |
| `<menu>` | список команд (панель инструментов) | для браузера то же, что `ul` |

Скринридер объявляет «список, 5 пунктов» — это бесценная подсказка о размере. Отсюда известная
ловушка: **Safari (VoiceOver) убирает семантику списка, если у него `list-style: none`** — так WebKit
борется со списками, использованными для раскладки. Если список без маркеров — всё равно список
(меню, теги), верните роль явно: `<ul role="list">`.

<details>
<summary>Возможности ol и dl</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-elements.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Списки</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; display: flex; gap: 24px; flex-wrap: wrap; }
  section { border: 2px solid #3a7bd5; padding: 8px 16px; border-radius: 6px; }
  h2 { font-size: 15px; margin: 0 0 4px; }
  ol li::marker { color: #c33; font-weight: 700; }
  dl div { display: grid; grid-template-columns: 90px 1fr; border-bottom: 1px solid #ddd; }
  dt { font-weight: 700; } dd { margin: 0; }
</style>
</head>
<body>
  <section><h2>reversed start="3"</h2>
    <ol reversed start="3"><li>Бронза</li><li>Серебро</li><li>Золото</li></ol></section>
  <section><h2>type="i", value</h2>
    <ol type="i"><li>Раз</li><li value="10">Десять</li><li>Дальше счёт идёт с 10</li></ol></section>
  <section><h2>dl с div-группами</h2>
    <dl>
      <div><dt>Автор</dt><dd>Ю. С.</dd></div>
      <div><dt>Теги</dt><dd>HTML</dd><dd>CSS</dd></div>
    </dl></section>
</body>
</html>
```

</details>

## 6. `figure`, `details`, `dialog`

### 6.1. `<figure>` и `<figcaption>`

`<figure>` — самостоятельная иллюстрация к тексту, которую можно перенести в приложение, не потеряв
смысл: картинка, схема, листинг кода, цитата с подписью. `<figcaption>` (первым или последним
ребёнком) становится её **доступным именем**. Это не замена `alt`: `alt` описывает изображение
тому, кто его не видит, подпись — комментирует для всех.

### 6.2. `<details>` и `<summary>`

Раскрывающийся блок без единой строки JS: клавиатура, состояние и семантика встроены. Атрибут
`open` отражает состояние, событие `toggle` сообщает о смене. Атрибут `name` объединяет несколько
`<details>` в **эксклюзивную группу** — аккордеон, где открыт только один. Маркер треугольника — это
`::marker` у `<summary>` (у которого `display: list-item`).

<details>
<summary>Аккордеон на details name</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-elements.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>details name</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; max-width: 480px; }
  details { border: 2px solid #3a7bd5; border-radius: 6px; margin: 6px 0; padding: 0 12px; }
  details[open] { background: #eef6ff; }
  summary { cursor: pointer; padding: 8px 0; font-weight: 600; }
  summary::marker { color: #c33; }
  #log { color: #666; font-size: 14px; }
</style>
</head>
<body>
  <p>Откройте пункты по очереди: открытый ранее закроется сам.</p>
  <div id="faq"></div>
  <p id="log"></p>
  <script>
    // Элементы собираются скриптом только ради формата курса; в жизни пишите их разметкой
    const items = [
      ['Что такое модель содержимого?', 'Список допустимых детей элемента.'],
      ['Почему p разрывается?', 'Парсер закрывает p перед div.'],
      ['Есть ли алгоритм структуры?', 'Нет, его не реализовали и удалили.']
    ];
    items.forEach(([q, a], n) => {
      const d = document.createElement('details');
      d.setAttribute('name', 'faq');
      d.open = n === 0;
      const s = document.createElement('summary');
      s.textContent = q;
      const p = document.createElement('p');
      p.textContent = a;
      d.append(s, p);
      document.getElementById('faq').append(d);
    });
    document.querySelectorAll('details').forEach(d =>
      d.addEventListener('toggle', e => {
        document.getElementById('log').textContent =
          'toggle: «' + d.querySelector('summary').textContent + '» → ' + e.newState;
      }));
  </script>
</body>
</html>
```

</details>

Ограничение: `<summary>` получает роль кнопки, поэтому заголовок внутри него для части скринридеров
теряет семантику, а интерактивные элементы внутри `<summary>` недопустимы.

### 6.3. `<dialog>`

Два способа открыть — две разные вещи:

| | `dialog.show()` | `dialog.showModal()` |
|---|---|---|
| Слой | обычный поток, `z-index` | **верхний слой** (top layer), поверх всего |
| Остальная страница | доступна | **инертна** (`inert`): ни клика, ни фокуса, ни скринридера |
| `::backdrop` | нет | есть |
| `Esc` | не закрывает | закрывает (событие `cancel`) |

`<form method="dialog">` внутри закрывает диалог при отправке, а `dialog.returnValue` получает
`value` нажатой кнопки. После закрытия фокус возвращается туда, откуда диалог открыли. Всего этого
не даёт `<div class="modal">` без сотни строк JS. Подробнее — в
[Интерфейс: состояние, отрисовка, диалоги](LEARN_JAVASCRIPT_UI_COURSE.md).

<details>
<summary>Модальный dialog с returnValue</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-elements.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>dialog</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  dialog { border: 3px solid #3a7bd5; border-radius: 10px; padding: 16px 20px; }
  dialog::backdrop { background: rgb(0 0 0 / .45); backdrop-filter: blur(2px); }
  #out { font-weight: 600; color: #3a7bd5; }
</style>
</head>
<body>
  <button id="open">Удалить файл…</button>
  <p>Результат: <span id="out">нет</span></p>
  <p>Пока диалог открыт, попробуйте нажать эту кнопку: <button>Недоступна</button>. Esc закрывает.</p>
  <dialog id="dlg">
    <form method="dialog">
      <p><strong>Удалить безвозвратно?</strong></p>
      <button value="cancel">Отмена</button>
      <button value="ok" autofocus>Удалить</button>
    </form>
  </dialog>
  <script>
    const dlg = document.getElementById('dlg');
    document.getElementById('open').onclick = () => dlg.showModal();
    dlg.addEventListener('close', () => {
      document.getElementById('out').textContent = dlg.returnValue || '(Esc, пустая строка)';
      dlg.returnValue = '';
    });
  </script>
</body>
</html>
```

</details>

## 7. `div` и `span` — последнее средство

`<div>` и `<span>` не значат **ничего**. Это правильный выбор, когда обёртка нужна только для
стилей или скриптов: колонка сетки, контейнер для `display: flex`, кусок текста для подсветки.
Неправильный — когда для смысла есть элемент:

| Вместо | Пишите | Что получаете бесплатно |
|---|---|---|
| `<div onclick>` | `<button>` | фокус Tab, Enter/Space, роль `button`, `disabled` |
| `<span class="link" onclick>` | `<a href>` | открытие в новой вкладке, история, контекстное меню |
| `<div class="title">` | `<h2>` | навигация по заголовкам в скринридере |
| `<div class="list"><div>` | `<ul><li>` | «список, N пунктов» |
| `<div class="modal">` | `<dialog>` | верхний слой, инертность фона, Esc, возврат фокуса |

Первое правило ARIA: если есть родной элемент с нужным смыслом — используйте его, а не
`<div role="button" tabindex="0">` с ручной обработкой клавиш. Подробнее — в
[Доступность](LEARN_HTML_ACCESSIBILITY_COURSE.md).

## 8. «Блочный» и «строчный» — это CSS

В HTML 4 элементы делились на block-level и inline, и это смешивало два вопроса: что можно
вкладывать и как раскладывать. HTML5 их развёл:

- **что можно вкладывать** решают категории и модели содержимого (раздел 2);
- **как раскладывать** решает свойство CSS `display`. «Блочность» `<div>` — это строка стилей
  браузера `div { display: block }`, а `<span>` строчный просто потому, что начальное значение
  `display` — `inline`, и браузер его не меняет.

Поэтому:

- `span { display: block }` не делает `<span>` «блочным элементом» в смысле HTML: внутри `<p>` он
  по-прежнему разрешён, а `<div>` внутри `<p>` — нет;
- `<a>` с `display: inline` может законно содержать `<div>` (прозрачная модель), если сама стоит в
  потоковом контексте;
- у неизвестного элемента (`<my-card>`) `display: inline` — у браузера для него нет правил.

<details>
<summary>display меняет вид, но не модель содержимого</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-elements.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>display и модель содержимого</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  span, div, a, my-card { outline: 2px solid; padding: 2px 4px; }
  span { color: #1b6e3a; } div { color: #9c2a2a; } a { color: #234f9c; } my-card { color: #6b2fa0; }
  .as-block { display: block; }
  .as-inline { display: inline; }
  pre { background: #f4f4f4; padding: 8px; font-size: 13px; }
</style>
</head>
<body>
  <p id="p1">Абзац: <span class="as-block">span с display:block остаётся внутри p</span> хвост.</p>
  <p id="p2">Абзац: <div class="as-inline">div с display:inline всё равно выброшен из p</div> хвост.</p>
  <a href="#"><div>div внутри a — допустимо: модель a прозрачна</div></a>
  <p><my-card>неизвестный элемент — inline по умолчанию</my-card></p>
  <pre id="out"></pre>
  <script>
    document.getElementById('out').textContent =
      'Дети #p1: ' + [...document.getElementById('p1').children].map(e => e.localName).join(', ') +
      '\nДети #p2: ' + ([...document.getElementById('p2').children].map(e => e.localName).join(', ') || 'нет');
  </script>
</body>
</html>
```

</details>

О том, как `display` порождает блоки и строки, — курс
[Нормальный поток и `display`](LEARN_CSS_DISPLAY_FLOW_COURSE.md).

## Итог

- Элемент выбирают по **смыслу**: его читают дерево доступности, поисковики, режим чтения, селекторы.
- Что можно вкладывать — **модель содержимого**; часть нарушений парсер «чинит», меняя дерево
  (`<p>` закрывается перед `<div>`).
- `header`/`footer` становятся `banner`/`contentinfo` только на уровне страницы; `section` —
  `region` только с именем.
- Алгоритма структуры нет: уровень заголовка — цифра в теге, без пропусков вниз.
- `em` — ударение, `i` — иной голос; `strong` — важность, `b` — внимание; `small` — побочный
  комментарий; `mark` — релевантность.
- `list-style: none` в Safari убирает семантику списка — возвращайте `role="list"`.
- `details name` — аккордеон без JS; `showModal()` даёт верхний слой, инертный фон и Esc.
- `div`/`span` — когда смысла нет. «Блочный» и «строчный» — значения `display`, а не свойства HTML.

## Проверьте себя

1. Почему стиль `p ul { color: red }` не действует на `<p>Текст <ul><li>пункт</li></ul></p>`?
2. Когда `<header>` получает роль `banner`, а когда нет?
3. На странице три вложенных `<section>`, в каждом `<h1>`. Какие уровни услышит пользователь
   скринридера и почему?
4. Выберите элемент: название корабля в тексте; предупреждение «Не выключайте питание»; найденное
   слово в результатах поиска.
5. Чем `dialog.show()` отличается от `dialog.showModal()` для пользователя клавиатуры?
6. Можно ли поместить `<div>` внутрь `<a>`? А внутрь `<span>` с `display: block`?

Дальше: [Атрибуты](LEARN_HTML_ATTRIBUTES_COURSE.md).
