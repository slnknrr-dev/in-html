# Метаданные: `<meta>`, `<link>`, соцсети, поисковики

> Курс 23 из программы. Для тех, кто уже понимает дерево документа, каскад и адаптивность и хочет
> знать, что на самом деле делает каждая строка в `<head>`: кто её читает (парсер, браузер, поисковый
> робот, мессенджер), когда и что ломается, если её нет или она стоит не там.

**Что вы будете понимать после курса**

- что такое метаданные и почему у одной строки `<head>` бывает четыре разных «читателя»;
- как браузер выбирает кодировку и почему у `<meta charset>` есть жёсткий лимит в 1024 байта;
- все параметры `viewport` и почему `user-scalable=no` — ошибка, а не «настройка»;
- `description`, `robots`, `theme-color`, `color-scheme`, `referrer` и директивы `http-equiv`;
- разметку Open Graph и Twitter-карточек: что и как читают соцсети;
- типы связей `<link rel>`: иконки, манифест, `canonical`, `alternate` + `hreflang`, подсказки
  загрузки `preload` / `preconnect` / `modulepreload`, стили с `media`;
- чем опасен `<base>`;
- в каком порядке писать `<head>` и почему порядок — это не вкусовщина.

---

## 1. Что такое метаданные и кто их читает

**Метаданные** (metadata content) — элементы, которые описывают документ, а не показывают
содержимое: `<title>`, `<meta>`, `<link>`, `<base>`, `<style>`, `<script>`, `<noscript>`,
`<template>`. Их место — `<head>`, хотя некоторые (`<link>` с «body-ok» связями, `<meta itemprop>`)
разрешены и в `<body>`.

У каждой строки свой читатель, и от этого зависят правила:

| Читатель | Когда читает | Что ему важно | Пример |
|---|---|---|---|
| Парсер HTML | во время разбора байтов | позиция в потоке | `<meta charset>` |
| Браузер (после разбора) | при построении страницы | наличие в DOM | `viewport`, `theme-color`, `<link rel=stylesheet>` |
| Поисковый робот | при индексации, часто без JS | текст в исходнике | `robots`, `canonical`, `hreflang` |
| Сборщик превью (мессенджер, соцсеть) | при вставке ссылки | только исходный HTML, JS почти никогда | `og:*`, `twitter:*` |

Последняя строка таблицы — главный практический вывод: **превью ссылки строится из ответа сервера,
а не из того, что дорисовал ваш JavaScript**. Одностраничное приложение, которое ставит `og:title`
скриптом, в Telegram и Slack покажет пустую карточку.

У `<meta>` три взаимоисключающих режима:

```html
<meta charset="utf-8">                         <!-- объявление кодировки -->
<meta name="description" content="...">        <!-- именованные метаданные документа -->
<meta http-equiv="refresh" content="5">        <!-- «прагма»: имитация HTTP-заголовка -->
```

Плюс четвёртый, не из HTML: `<meta property="og:...">` — это атрибут RDFa, его ввёл Open Graph.
Валидатор HTML его терпит, браузер игнорирует, соцсети читают.

## 2. `<meta charset>`: кодировка и предварительное сканирование

Парсеру нужно превратить байты в символы **до** токенизации. Порядок выбора кодировки в спецификации:

1. **BOM** (метка порядка байтов) в начале файла — побеждает всё;
2. **HTTP-заголовок** `Content-Type: text/html; charset=...`;
3. **предварительное сканирование** (prescan) первых **1024 байт** в поисках `<meta charset>` или
   `<meta http-equiv="Content-Type" content="text/html; charset=...">`;
4. кодировка родительского документа (для фрейма), эвристики, локаль пользователя.

Отсюда правила:

- `<meta charset="utf-8">` — **первый** элемент `<head>`. Комментарий с лицензией на 2 КБ перед ним
  выталкивает его за 1024 байта — и prescan его не увидит.
- Если prescan не нашёл объявление, а парсер встретил его позже, браузер может **перезапустить
  разбор** с новой кодировкой. Это медленно, и уже выполненные скрипты не «откатываются».
- Значение регистронезависимо, но писать стоит `utf-8`: для HTML это единственная допустимая
  кодировка новых документов.
- Объявление в `<meta>` проигрывает HTTP-заголовку. Если сервер шлёт `charset=windows-1251`,
  строка в файле не поможет: чинить сервер.

<details>
<summary>Какую кодировку выбрал браузер</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-metadata.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Кодировка</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  output { display: block; padding: 8px 12px; background: #eef6ff; border-left: 4px solid #3a7bd5; margin: 6px 0; }
</style>
</head>
<body>
  <p>Данные о документе, которые браузер вывел при разборе:</p>
  <output id="cs"></output>
  <output id="mode"></output>
  <output id="pos"></output>
  <script>
    document.getElementById('cs').textContent = 'document.characterSet = ' + document.characterSet;
    document.getElementById('mode').textContent = 'document.compatMode = ' + document.compatMode;
    // Позиция meta charset среди детей head: должна быть 0
    const metas = [...document.head.children];
    const i = metas.findIndex(el => el.hasAttribute('charset'));
    document.getElementById('pos').textContent = 'meta charset стоит в head под номером ' + i;
  </script>
</body>
</html>
```

</details>

## 3. `viewport`: страница на мобильном экране

### 3.1. Зачем он вообще нужен

Первый iPhone (2007) столкнулся с тем, что сайты свёрстаны под 1000 пикселей. Safari стал рисовать
страницу в **виртуальном окне** шириной 980 CSS-пикселей и уменьшать картинку под экран. Это
поведение по умолчанию живёт до сих пор: без `viewport` ваш адаптивный `@media (max-width: 600px)`
не сработает — ширина макетного окна (layout viewport) будет 980.

Строка, которую пишут всегда:

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

- `width=device-width` — ширина макетного окна равна ширине устройства в CSS-пикселях;
- `initial-scale=1` — начальный масштаб 1:1. Исторически без него iOS при повороте экрана
  сохранял ширину и увеличивал страницу.

Подробнее об окнах (layout viewport и visual viewport) — в курсе
[Адаптивность](LEARN_CSS_RESPONSIVE_COURSE.md).

### 3.2. Все параметры

| Параметр | Значения | Что делает | Совет |
|---|---|---|---|
| `width` | `device-width` или число | ширина макетного окна | только `device-width` |
| `height` | `device-height` или число | высота окна | почти никогда не нужен |
| `initial-scale` | 0.1–10 | начальный масштаб | `1` |
| `minimum-scale` | 0.1–10 | нижняя граница зума | не трогать |
| `maximum-scale` | 0.1–10 | верхняя граница зума | не ограничивать |
| `user-scalable` | `yes` / `no` | разрешить зум жестом | никогда `no` |
| `viewport-fit` | `auto` / `contain` / `cover` | заходить ли под «чёлку» и скругления | `cover` + `env(safe-area-inset-*)` |
| `interactive-widget` | `resizes-visual` / `resizes-content` / `overlays-content` | как экранная клавиатура меняет окна | см. ниже |

Параметры разделяются **запятой**. Точка с запятой — частая ошибка, которую браузеры прощают с
предупреждением в консоли.

### 3.3. `user-scalable=no` и `maximum-scale=1`

Запрет зума ломает доступность: человек со слабым зрением не может увеличить текст (критерий WCAG
1.4.4 «Изменение размера текста»). Поэтому Safari с iOS 10 **игнорирует** `user-scalable=no` и
`maximum-scale`, а Chrome на Android даёт пользователю включить принудительный зум в настройках.

Запрет обычно ставили ради двух вещей, и у обеих есть правильное решение:

- **задержка 300 мс на касание** (браузер ждал второго тапа для двойного зума) — исчезает сама при
  `width=device-width`; дополнительно — `touch-action: manipulation` на элементе;
- **зум при фокусе на поле ввода в iOS** — Safari увеличивает страницу, если `font-size` поля
  меньше 16px. Лечится `font-size: 16px` (или больше) у `input`, а не запретом зума.

### 3.4. `interactive-widget` и `viewport-fit`

По умолчанию (`resizes-visual`) экранная клавиатура уменьшает только визуальное окно: макет не
перестраивается, `100dvh` не меняется. `resizes-content` заставляет браузер ужать макетное окно —
удобно для чатов, где поле ввода прибито к низу. Поддержка — в Chromium; Safari этот параметр
игнорирует.

`viewport-fit=cover` растягивает страницу под вырезы экрана; после этого отступы от «чёлки» ваша
забота:

```css
header { padding-top: env(safe-area-inset-top); }
```

## 4. Именованные метаданные: `name="..."`

### 4.1. `description`

```html
<meta name="description" content="Курс о метаданных: meta, link, Open Graph и порядок head.">
```

Поисковики **могут** взять его в сниппет под ссылкой, но не обязаны: если текст страницы лучше
отвечает на запрос, сниппет соберут из него. На позицию в выдаче описание не влияет. Пишите
150–160 символов, своё для каждой страницы: одинаковые описания на всём сайте поисковик считает
бесполезными.

`<meta name="keywords">` Google не учитывает с 2009 года — из-за злоупотреблений. Писать его не нужно.

### 4.2. `robots`

```html
<meta name="robots" content="noindex, nofollow">
<meta name="googlebot" content="nosnippet">   <!-- только для одного робота -->
```

| Директива | Смысл |
|---|---|
| `noindex` | не показывать страницу в выдаче |
| `nofollow` | не переходить по ссылкам страницы |
| `noarchive` | не показывать сохранённую копию |
| `nosnippet` | не показывать сниппет |
| `max-snippet:50` | ограничить длину сниппета |
| `max-image-preview:large` | разрешить крупное превью картинки |
| `none` | то же, что `noindex, nofollow` |

Значение по умолчанию — `index, follow`; писать его бессмысленно.

**Ловушка:** если страница закрыта в `robots.txt` (`Disallow`), робот её **не скачивает** — и
никогда не увидит ваш `noindex`. Такая страница может попасть в выдачу по внешним ссылкам, просто
без описания. Чтобы убрать страницу из поиска, её надо **открыть** для обхода и поставить `noindex`.
Для не-HTML файлов (PDF) та же директива передаётся заголовком `X-Robots-Tag`.

### 4.3. `theme-color` и `media`

Цвет интерфейса браузера вокруг страницы (адресная строка в мобильном Chrome, строка заголовка
установленного PWA, вкладки Safari):

```html
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111418" media="(prefers-color-scheme: dark)">
```

Браузер берёт **первый** `theme-color`, у которого `media` подходит. Атрибут `media` у `<meta>`
разрешён только для `theme-color`. Значение — любой цвет CSS, кроме зависящих от контекста.

### 4.4. `color-scheme`

```html
<meta name="color-scheme" content="light dark">
```

Говорит браузеру: «страница умеет обе схемы». Браузер тогда сам перекрашивает **свои** части —
фон холста, цвет текста по умолчанию, поля ввода, полосы прокрутки — в тёмные, если система
тёмная. Это то же, что CSS-свойство `color-scheme: light dark` на `:root`, но работает **до
загрузки CSS**: нет белой вспышки при открытии тёмной страницы.

<details>
<summary>color-scheme перекрашивает элементы браузера</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-metadata.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>color-scheme</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin: 12px 0; }
  .box { height: 80px; overflow: auto; width: 220px; border: 1px solid; padding: 6px; }
</style>
</head>
<body>
  <p>Включите в системе тёмную тему: фон, текст, поля и полоса прокрутки поменяются,
     хотя в CSS нет ни одного цвета.</p>
  <div class="row">
    <input value="Поле ввода">
    <select><option>Список</option></select>
    <button>Кнопка</button>
    <input type="checkbox" checked>
  </div>
  <div class="box">Прокручиваемый блок.<br>1<br>2<br>3<br>4<br>5<br>6</div>
</body>
</html>
```

</details>

Цвета берутся из **системных цветов** (system colors) `Canvas` и `CanvasText`; их можно
использовать и в своём CSS. См. [Цвет и фон](LEARN_CSS_COLORS_BACKGROUNDS_COURSE.md).

### 4.5. `referrer`

Управляет заголовком `Referer` (да, с ошибкой в слове — это историческая опечатка HTTP), который
браузер шлёт при переходе по ссылке и загрузке ресурсов:

```html
<meta name="referrer" content="strict-origin-when-cross-origin">
```

| Политика | На свой сайт | На чужой сайт (HTTPS) | С HTTPS на HTTP |
|---|---|---|---|
| `no-referrer` | ничего | ничего | ничего |
| `origin` | только origin | только origin | только origin |
| `same-origin` | полный URL | ничего | ничего |
| `strict-origin-when-cross-origin` | полный URL | только origin | ничего |
| `unsafe-url` | полный URL | полный URL | полный URL |

`strict-origin-when-cross-origin` — **значение по умолчанию** во всех современных браузерах, так
что тег нужен, только чтобы ужесточить. Зачем ужесточать: если в URL есть токен или поисковый
запрос (`/reset?token=...`), полный адрес утечёт на сторонние сервера — аналитику, CDN шрифтов.
Точечно то же делает атрибут `referrerpolicy` у `<a>`, `<img>`, `<script>` и `rel="noreferrer"`.

### 4.6. Прочие имена

- `application-name` — имя веб-приложения (если отличается от `<title>`);
- `author`, `generator` — информационные, ни на что не влияют;
- `format-detection` с `telephone=no` — запрещает Safari на iOS превращать числа, похожие на
  телефон, в ссылки.

## 5. `http-equiv`: заголовки внутри документа

«HTTP-эквивалент» — попытка задать заголовок ответа из разметки. Спецификация разрешает
ограниченный список значений.

### 5.1. `content-security-policy`

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; img-src 'self' data:; object-src 'none'">
```

Работает почти как заголовок, но с важными отличиями:

- **не поддерживаются** директивы `frame-ancestors`, `report-uri`, `sandbox`;
- политика действует только на то, что парсер встретит **после** тега. Всё, что выше, уже
  загружено. Поэтому CSP-тег ставят сразу после `charset`;
- политику из `<meta>` нельзя ослабить, только добавить ещё одну (политики пересекаются).

<details>
<summary>CSP из meta блокирует картинку</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-metadata.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="img-src 'none'">
<title>CSP</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  img { width: 80px; height: 80px; border: 2px dashed #c33; display: block; margin: 8px 0; }
  #log { color: #c33; font-weight: 600; }
</style>
</head>
<body>
  <p>Картинка задана data-URI. Политика <code>img-src 'none'</code> запрещает любые изображения:</p>
  <img alt="квадрат"
       src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' fill='%233a7bd5'/%3E%3C/svg%3E"
       onerror="document.getElementById('log').textContent = 'Загрузка заблокирована политикой (см. консоль).'">
  <p id="log"></p>
</body>
</html>
```

</details>

Обратите внимание: обработчик `onerror` в атрибуте сработал, потому что политика не ограничила
`script-src`. Добавьте `script-src 'self'` — и молча откажет уже он.

### 5.2. `refresh`

```html
<meta http-equiv="refresh" content="5">                         <!-- перезагрузить через 5 с -->
<meta http-equiv="refresh" content="0; url=https://example.org/new">  <!-- редирект -->
```

Проблемы: пользователь теряет место чтения, кнопка «Назад» зацикливается, скринридер внезапно
начинает сначала (критерий WCAG 2.2.1). Для переезда страницы правильный путь — ответ сервера `301`.
`refresh` с `0` поисковики понимают как редирект, но это запасной вариант для статических хостингов
без настройки сервера.

### 5.3. Остальное

- `content-type` — старая форма объявления кодировки; вместе с `charset` в одном документе запрещена;
- `default-style` — имя набора стилей по умолчанию (см. раздел 7.5);
- `x-ua-compatible` с `IE=edge` — команда Internet Explorer не включать режим совместимости. IE
  больше нет, строку можно удалять.

Заголовков `Cache-Control`, `Expires`, `Set-Cookie` через `<meta>` не бывает: браузеры их
игнорируют (в спецификации `set-cookie` прямо запрещён). Кешированием управляет только сервер.

## 6. Open Graph и Twitter-карточки

### 6.1. Open Graph

Протокол Facebook (2010), который стал стандартом де-факто: его читают Telegram, Slack, Discord,
VK, LinkedIn, WhatsApp, iMessage.

```html
<meta property="og:type" content="article">
<meta property="og:title" content="Метаданные: meta, link, соцсети">
<meta property="og:description" content="Что делает каждая строка в head.">
<meta property="og:url" content="https://example.org/ru/course/metadata">
<meta property="og:image" content="https://example.org/og/metadata.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Схема элемента head">
<meta property="og:site_name" content="Курсы">
<meta property="og:locale" content="ru_RU">
```

Правила, о которые спотыкаются:

- атрибут — **`property`**, не `name` (RDFa). Многие сборщики прощают `name`, но не все;
- `og:image` и `og:url` — **абсолютные** URL. Относительный путь сборщику не к чему приложить;
- размер картинки 1200×630 (соотношение 1.91:1) — его понимают все. Указание `width`/`height`
  позволяет показать превью сразу, без скачивания картинки;
- соцсети **кешируют** превью. Поменяли картинку — меняйте и её URL (`?v=2`), иначе ещё недели
  будет показываться старая;
- `og:locale` пишется с подчёркиванием (`ru_RU`), в отличие от `lang="ru-RU"`.

### 6.2. Twitter (X)

```html
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@account">
```

Здесь атрибут уже `name`. Для заголовка, описания и картинки Twitter **падает обратно** на `og:*`,
поэтому дублировать `twitter:title` не нужно. Единственное обязательное — `twitter:card`: `summary`
(квадратная миниатюра) или `summary_large_image` (широкая).

### 6.3. Что ещё читают поисковики

Структурированные данные (schema.org) обычно пишут не в `<meta>`, а в `<script type="application/ld+json">`.
Браузер такой скрипт не выполняет (тип не JavaScript), робот читает как JSON. Это не метаданные в
смысле HTML, но живут они тоже в `<head>`.

## 7. `<link>`: связи документа с другими ресурсами

`<link>` описывает **связь** (link type) между документом и ресурсом. `rel` — список типов через
пробел, `href` — адрес. Типы делятся на два вида:

- **внешний ресурс** (external resource) — браузер его загружает и использует: `stylesheet`,
  `icon`, `preload`, `manifest`;
- **гиперссылка** (hyperlink) — просто сведения для кого-то: `canonical`, `alternate`, `author`,
  `license`.

### 7.1. Иконки

```html
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">   <!-- 180×180 -->
<link rel="manifest" href="/site.webmanifest">
```

- Без `<link rel="icon">` браузер всё равно запросит `/favicon.ico` из корня сайта — это
  историческое поведение IE5. Отсюда 404 в логах у сайтов без иконки.
- Из нескольких иконок браузер выбирает по `sizes` и `type`; SVG-иконка может реагировать на
  тёмную тему через `@media (prefers-color-scheme: dark)` **внутри** файла.
- `apple-touch-icon` нужен Safari для ярлыка на домашнем экране; прозрачность там заливается
  чёрным, поэтому фон рисуют в самой картинке.
- `manifest` — JSON с именем, иконками 192 и 512 пикселей, `start_url`, `display`. С ним сайт можно
  установить как приложение.
- `rel="shortcut icon"` — наследие IE; слово `shortcut` ничего не значит, браузеры его пропускают.

### 7.2. `canonical`

```html
<link rel="canonical" href="https://example.org/ru/course/metadata">
```

Одна статья доступна по многим URL: с `?utm_source=...`, с `/` на конце и без, через `http` и
`https`, с `www`. `canonical` говорит поисковику, какой адрес **главный**, чтобы рейтинг не
распылялся. Это подсказка, а не приказ. Ошибка, которая выкидывает сайт из поиска: копирование
шаблона, где у **всех** страниц canonical указывает на главную.

### 7.3. `alternate`: языковые версии и ленты

```html
<link rel="alternate" hreflang="ru" href="https://example.org/ru/">
<link rel="alternate" hreflang="en" href="https://example.org/en/">
<link rel="alternate" hreflang="x-default" href="https://example.org/">
<link rel="alternate" type="application/rss+xml" title="Новости" href="/feed.xml">
```

- Связи `hreflang` должны быть **взаимными**: русская страница ссылается на английскую, английская
  на русскую, и каждая на **саму себя**. Связь в одну сторону поисковик отбрасывает.
- `x-default` — для пользователей, чей язык не подошёл ни к одной версии.
- `type="application/rss+xml"` — лента; браузерные расширения и читалки находят её по этой строке.

### 7.4. Подсказки загрузки

Браузер находит ресурсы, разбирая HTML; шрифт, указанный в CSS, он узнаёт только после загрузки и
разбора CSS. Подсказки сообщают о ресурсах заранее.

| Связь | Что делает | Когда нужна |
|---|---|---|
| `dns-prefetch` | только DNS-запрос | дешёвый запасной вариант для `preconnect` |
| `preconnect` | DNS + TCP + TLS | сторонний домен, с которого точно будут ресурсы |
| `preload` | скачать ресурс с высоким приоритетом | шрифт, картинка LCP, критический ресурс из CSS |
| `modulepreload` | скачать, разобрать и закешировать ES-модуль | зависимости модульного скрипта |
| `prefetch` | скачать с низким приоритетом для **следующей** страницы | вероятный следующий переход |

```html
<link rel="preconnect" href="https://fonts.example.net" crossorigin>
<link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="modulepreload" href="/js/app.js">
```

Подводные камни:

- у `preload` **обязателен** `as` — по нему браузер ставит приоритет, заголовок `Accept` и
  проверку CSP. Без `as` ресурс скачается дважды;
- шрифты всегда загружаются в режиме CORS, поэтому `preload` шрифта **без `crossorigin`** не
  совпадёт с реальным запросом — снова двойная загрузка, даже для своего домена;
- `preload` ресурса, который не используется в первые секунды, даёт предупреждение в консоли и
  отнимает полосу у действительно нужного;
- `preconnect` держит соединение около 10 секунд; больше 3–4 доменов — расточительство.

Подробнее о цене загрузки — в [Производительность CSS](LEARN_CSS_PERFORMANCE_COURSE.md).

### 7.5. Стили: `media`, `disabled`, альтернативные наборы

`<link rel="stylesheet">` **блокирует отрисовку** (render-blocking): браузер не покажет страницу,
пока не загрузит CSS, — иначе была бы вспышка нестилизованного содержимого (FOUC). Но только если
`media` подходит:

```html
<link rel="stylesheet" href="print.css" media="print">
<link rel="stylesheet" href="wide.css" media="(min-width: 900px)">
```

Неподходящий по `media` файл **всё равно скачивается** (вдруг окно расширят), но с низким
приоритетом и без блокировки отрисовки. На этом основан старый трюк асинхронной загрузки CSS:
`media="print" onload="this.media='all'"`.

<details>
<summary>Стиль, подключённый только для узкого окна</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-metadata.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>link media</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  .card { padding: 16px; border: 3px solid #3a7bd5; background: #eef6ff; }
  .card::after { content: " Широкое окно: подключён только встроенный стиль."; }
</style>
<!-- Этот файл применяется только при ширине до 500px -->
<link rel="stylesheet" media="(max-width: 500px)"
      href="data:text/css,.card{border-color:%23c33;background:%23ffecec}.card::after{content:' Узкое окно: подключился link с media.'}">
</head>
<body>
  <div class="card">Меняйте ширину окна предпросмотра.</div>
</body>
</html>
```

</details>

**Альтернативные наборы стилей** — забытая возможность: стили с `title` образуют именованные
наборы, а `rel="alternate stylesheet"` — выключенный по умолчанию. Firefox до сих пор показывает их
в меню «Вид → Стиль страницы». Из скрипта набор переключают свойством `disabled`.

<details>
<summary>Переключение наборов стилей через disabled</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-metadata.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Наборы стилей</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  .note { padding: 16px; border: 2px solid currentColor; }
</style>
<link rel="stylesheet" title="Светлый" href="data:text/css,body{background:%23fff;color:%23222}">
<link rel="alternate stylesheet" title="Контраст" href="data:text/css,body{background:%23000;color:%23ff0}">
</head>
<body>
  <p>
    <button data-t="Светлый">Светлый</button>
    <button data-t="Контраст">Контраст</button>
  </p>
  <div class="note">Нажмите кнопку: включается один из link с title, остальные выключаются.</div>
  <script>
    const sheets = [...document.querySelectorAll('link[title]')];
    document.querySelectorAll('button').forEach(b => b.onclick = () => {
      // Сначала включаем нужный, потом выключаем остальные
      sheets.forEach(l => { if (l.title === b.dataset.t) l.disabled = false; });
      sheets.forEach(l => { if (l.title !== b.dataset.t) l.disabled = true; });
    });
  </script>
</body>
</html>
```

</details>

Стили **без** `title` — «постоянные» (persistent): они применяются всегда, при любом выбранном наборе.

## 8. `<base>`: один тег, который меняет все адреса

```html
<base href="https://cdn.example.org/assets/" target="_blank">
```

`<base>` задаёт адрес, относительно которого разрешаются **все** относительные URL документа, и цель
по умолчанию для ссылок. Правила:

- учитывается только **первый** `<base href>` (и первый `<base target>`);
- он должен стоять **до** любого элемента с URL-атрибутом, иначе ранние адреса разрешатся по старой
  базе;
- он действует и на ссылки-якоря: `href="#part2"` превращается в
  `https://cdn.example.org/assets/#part2` — клик уводит **с текущей страницы**;
- `target="_blank"` открывает в новой вкладке вообще всё, включая отправку форм.

<details>
<summary>base ломает якорную ссылку</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-metadata.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<base href="https://example.org/docs/">
<title>base</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 16px; }
  td, th { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  table { border-collapse: collapse; margin-top: 12px; }
  code { background: #f2f2f2; padding: 0 4px; }
</style>
</head>
<body>
  <p><a id="a1" href="#part2">#part2</a> · <a id="a2" href="guide.html">guide.html</a> ·
     <a id="a3" href="/about">/about</a></p>
  <p>Не кликайте: посмотрите, куда на самом деле ведут ссылки.</p>
  <table id="t"><tr><th>Атрибут href</th><th>Свойство href (итоговый URL)</th></tr></table>
  <script>
    for (const a of document.querySelectorAll('a')) {
      const tr = document.getElementById('t').insertRow();
      tr.insertCell().innerHTML = '<code></code>';
      tr.cells[0].firstChild.textContent = a.getAttribute('href');
      tr.insertCell().textContent = a.href;
    }
  </script>
</body>
</html>
```

</details>

Вывод: `<base>` почти никогда не нужен; адреса лучше писать от корня сайта (`/assets/...`). Для
безопасности CSP-директива `base-uri 'self'` (или `'none'`) запрещает внедрённому через XSS `<base>`
перенаправить все ваши скрипты на чужой сервер.

## 9. Порядок в `<head>`

Порядок важен из-за трёх механизмов: prescan кодировки, построчного разбора (CSP и `<base>` действуют
только вниз) и приоритетов загрузки (браузер обнаруживает ресурсы в порядке их появления).

```html
<head>
  <meta charset="utf-8">                                    <!-- 1. в пределах 1024 байт -->
  <meta http-equiv="Content-Security-Policy" content="..."> <!-- 2. до всего, что грузит ресурсы -->
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base href="...">                                         <!-- 3. если без него никак: до URL -->
  <title>Страница — Сайт</title>                            <!-- 4. виден во вкладке сразу -->
  <link rel="preconnect" href="https://cdn.example.net" crossorigin>
  <link rel="preload" href="/hero.avif" as="image">         <!-- 5. подсказки раньше ресурсов -->
  <link rel="stylesheet" href="/app.css">                   <!-- 6. блокирующий CSS -->
  <script src="/app.js" defer></script>                      <!-- 7. скрипты: defer или module -->
  <meta name="description" content="...">                   <!-- 8. всё «пассивное» -->
  <meta name="theme-color" content="#fff">
  <meta property="og:title" content="...">
  <link rel="canonical" href="...">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
</head>
```

Почему так:

- **Обычный `<script>` без `defer` перед CSS** заставляет парсер ждать скрипт; а если скрипт стоит
  после CSS и читает стили, он ждёт CSS. В обоих случаях страница появляется позже. `defer` и
  `type="module"` снимают проблему — подробнее в
  [Введение: как скрипт попадает на страницу](LEARN_JAVASCRIPT_INTRODUCTION_COURSE.md).
- **Предварительный сканер** (preload scanner) браузера бежит по HTML впереди парсера и заранее
  запрашивает ресурсы; чем выше ресурс, тем раньше запрос.
- `<title>` хорошо стоять рано: при медленной сети вкладка сразу получает имя.
- «Пассивные» метаданные (`description`, `og:*`, `canonical`) никого не блокируют; их место — в
  конце.

### 9.1. Что произойдёт с метаданными в `<body>`

Парсер не переносит `<meta>` и `<link>` из `<body>` в `<head>`: они остаются там, где написаны.
`<link rel="stylesheet">` в `<body>` работает (и блокирует отрисовку того, что ниже), а
`<meta name="viewport">` или `<meta charset>` там уже бесполезны или недопустимы. Посмотреть, как
выглядит `<head>` после разбора, можно прямо из скрипта.

<details>
<summary>Что на самом деле оказалось в head</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-metadata.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Содержимое head</title>
<link rel="icon" href="data:,">
<style>
  body { font: 15px/1.4 system-ui, sans-serif; margin: 16px; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid #bbb; padding: 4px 8px; text-align: left; }
  .body { background: #fff3cd; }
</style>
</head>
<body>
  <meta name="description" content="Написано внутри body">
  <table id="t"><tr><th>Родитель</th><th>Элемент</th><th>Ключевой атрибут</th></tr></table>
  <script>
    const t = document.getElementById('t');
    for (const el of document.querySelectorAll('meta, link, title, style')) {
      const r = t.insertRow();
      if (el.parentElement === document.body) r.className = 'body';
      r.insertCell().textContent = el.parentElement.localName;
      r.insertCell().textContent = el.localName;
      const a = el.getAttribute('charset') ? 'charset' : el.getAttribute('name') ? 'name' : el.getAttribute('rel') ? 'rel' : '';
      r.insertCell().textContent = a ? a + '=' + el.getAttribute(a) : el.textContent.trim().slice(0, 30);
    }
  </script>
</body>
</html>
```

</details>

Пустая иконка `href="data:,"` в этом примере — приём, чтобы браузер не запрашивал `/favicon.ico`
у демонстрационной страницы.

## Итог

- У метаданных разные читатели: парсер, браузер, робот, сборщик превью. Сборщики превью не
  выполняют JS — `og:*` должны быть в ответе сервера.
- `<meta charset="utf-8">` — первым, в пределах 1024 байт; BOM и HTTP-заголовок важнее него.
- `viewport`: `width=device-width, initial-scale=1`. Зум не запрещают; зум на полях в iOS лечат
  шрифтом 16px.
- `theme-color` бывает с `media`; `color-scheme` перекрашивает элементы браузера до загрузки CSS;
  `referrer` по умолчанию уже `strict-origin-when-cross-origin`.
- CSP в `<meta>` действует только вниз и без `frame-ancestors`; `refresh` вредит доступности.
- Open Graph: `property`, абсолютные URL, 1200×630; Twitter берёт недостающее из `og:*`.
- `preload` требует `as`, шрифты — `crossorigin`; неподходящий по `media` CSS скачивается, но не
  блокирует отрисовку.
- `<base>` меняет и якорные ссылки; почти всегда без него лучше.
- Порядок `<head>`: кодировка → CSP → viewport → title → подсказки → CSS → скрипты → пассивное.

## Проверьте себя

1. Почему `noindex` на странице, закрытой в `robots.txt`, не убирает её из поиска?
2. Сайт отдаёт заголовок `Content-Type: text/html; charset=windows-1251`, а в файле `<meta charset="utf-8">`.
   Какую кодировку применит браузер и как это исправить?
3. Зачем у `<link rel="preload" as="font">` атрибут `crossorigin`, если шрифт лежит на своём домене?
4. Ссылка `<a href="#top">` на странице с `<base href="/docs/">` открывает другую страницу. Почему?
5. Какие две проблемы раньше решали запретом зума и как их решают правильно?
6. Почему `<meta name="color-scheme">` даёт результат, которого не даёт то же свойство в
   подключаемом CSS-файле?

Дальше: [Элементы и семантическая вёрстка](LEARN_HTML_ELEMENTS_COURSE.md).
