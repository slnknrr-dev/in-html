# Доступность

> Курс 30 из программы. Для тех, кто знает семантические элементы, формы и основы CSS. Доступность
> здесь — не список «правил для галочки», а ещё одно дерево, которое браузер строит из вашей
> разметки и отдаёт вспомогательным технологиям. Поймёте, как оно строится, — и большинство правил
> станут очевидными.

**Что вы будете понимать после курса**

- что такое **дерево доступности** и как оно получается из DOM;
- откуда у элемента берётся **роль**, **имя** и **состояние**;
- как браузер вычисляет **доступное имя** и в каком порядке перебирает источники;
- первое правило ARIA и почему `<div role="button">` — почти всегда ошибка;
- ориентиры (landmarks) и заголовки как навигация;
- порядок фокуса, видимый фокус и правила `tabindex`;
- стандартные клавиатурные паттерны, включая «перемещаемый tabindex» (roving tabindex);
- четыре способа скрыть содержимое и что каждый скрывает — от глаз, от диктора, от клавиатуры;
- живые области (live regions), контраст цвета, `prefers-reduced-motion`.

---

## 1. Кто пользуется страницей, кроме глаз и мыши

| Способ | Что нужно от страницы |
|---|---|
| Экранный диктор (screen reader): NVDA, JAWS, VoiceOver, TalkBack | правильные роли, имена, структура заголовков |
| Только клавиатура | доступность всего через Tab/Enter/Space/стрелки, видимый фокус |
| Экранная лупа, увеличение 200–400 % | вёрстка, не ломающаяся при масштабе; перенос строк вместо горизонтальной прокрутки |
| Голосовое управление («нажми Отправить») | видимый текст кнопки совпадает с её доступным именем |
| Переключатели (switch), айтрекеры | крупные цели, предсказуемый порядок |
| Плохое зрение, дальтонизм, яркое солнце | контраст, информация не только цветом |
| Вестибулярные расстройства | возможность отключить движение |

Официальный ориентир — **WCAG** (Web Content Accessibility Guidelines), уровни A, AA, AAA.
Юридические требования обычно ссылаются на уровень AA.

## 2. Дерево доступности

Браузер строит из DOM ещё одно дерево — **дерево доступности** (accessibility tree) — и через API
операционной системы (UIA в Windows, NSAccessibility в macOS, AT-SPI в Linux) отдаёт его
вспомогательным технологиям. Диктор не читает ваш HTML и не видит пиксели: он видит **только**
это дерево.

У каждого узла четыре главных свойства:

| Свойство | Пример | Откуда берётся |
|---|---|---|
| **Роль** (role) | `button`, `link`, `heading`, `navigation` | из элемента или атрибута `role` |
| **Имя** (accessible name) | «Отправить» | содержимое, `<label>`, `alt`, `aria-label`… |
| **Описание** (accessible description) | «Не менее 8 символов» | `aria-describedby`, `title` |
| **Состояния и свойства** | `checked`, `expanded`, `disabled`, уровень заголовка | атрибуты HTML и `aria-*` |

В дерево попадает не всё: элементы с `display: none`, `visibility: hidden`, `hidden`,
`aria-hidden="true"` выпадают; чисто оформительские `<div>` и `<span>` без роли схлопываются
(их текст остаётся, обёртка исчезает).

Посмотреть дерево можно в инструментах разработчика: Chrome — вкладка Elements → Accessibility
(там есть переключатель «full-page accessibility tree»), Firefox — отдельная вкладка
Accessibility.

### 2.1. Роли из семантики

Большинство ролей вы получаете бесплатно, просто выбрав правильный элемент. Это **неявные роли**
(implicit roles):

| HTML | Неявная роль | Комментарий |
|---|---|---|
| `<button>` | `button` | фокусируется, Enter и Space нажимают |
| `<a href>` | `link` | без `href` — роли нет, и он не фокусируется |
| `<h1>`–`<h6>` | `heading` + уровень | |
| `<nav>` | `navigation` | ориентир |
| `<main>` | `main` | ориентир, должен быть один видимый |
| `<header>` | `banner` | только если не вложен в `article`, `aside`, `main`, `nav`, `section` |
| `<footer>` | `contentinfo` | то же условие |
| `<aside>` | `complementary` | |
| `<section>` | `region` | только если есть доступное имя |
| `<form>` | `form` | ориентир, тоже только с именем |
| `<ul>`, `<ol>` | `list` | диктор скажет «список, 5 элементов» |
| `<input type="checkbox">` | `checkbox` + состояние `checked` | |
| `<img alt="">` | `presentation` (`none`) | выпадает из дерева |
| `<table>` | `table` | с заголовками строк и столбцов |

Курьёз Safari: если у списка отключены маркеры (`list-style: none`), VoiceOver перестаёт
объявлять его списком. Это сделано намеренно — так «списками» часто верстали меню. Вернуть роль
можно явным `role="list"`.

## 3. Доступное имя: как браузер его вычисляет

Алгоритм называется **Accessible Name and Description Computation** (accname). Упрощённо браузер
перебирает источники **по порядку** и берёт первый непустой:

1. `aria-labelledby` — ссылка на один или несколько элементов по `id`; их текст склеивается.
   Работает даже со скрытыми элементами.
2. `aria-label` — строка.
3. **Нативный источник** элемента: `<label>` для поля, `alt` для `<img>`, `<caption>` для таблицы,
   `<legend>` для `<fieldset>`, `<figcaption>` для `<figure>`, `<title>` для SVG.
4. **Содержимое** — только для ролей, которые разрешают «имя из содержимого» (button, link,
   heading, cell, option, tab, menuitem…). У `<nav>` или `<div>` текст внутри **не** становится
   именем.
5. `title` (и `placeholder` у полей ввода) — последнее средство.

Отсюда практические выводы:

- `aria-label` **перекрывает** видимый текст. `<button aria-label="Закрыть">Отмена</button>` для
  диктора называется «Закрыть», а пользователь голосового управления скажет «нажми Отмена» и
  ничего не произойдёт. Правило (WCAG 2.5.3 Label in Name): видимый текст должен входить в имя.
- `placeholder` — не подпись. Он исчезает при вводе, у него обычно слабый контраст, а как имя он
  используется лишь в крайнем случае.
- `title` показывается только при наведении мыши; на сенсорных экранах и с клавиатуры его нет.
- `aria-label` на элементе без подходящей роли (`<div aria-label="…">`, `<span>`) запрещён
  спецификацией и большинством дикторов игнорируется.

<details>
<summary>Имена из разных источников: проверьте в DevTools</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-accessibility.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui; margin: 16px; }
  .row { margin: 10px 0; padding: 8px; border: 1px dashed #aaa; }
  code { background: #f2f2f2; padding: 0 4px; }
</style>
</head>
<body>
  <p>Откройте DevTools → Accessibility и посмотрите поле Name у каждого элемента.</p>
  <div class="row"><button>Сохранить</button> — имя из содержимого: <code>Сохранить</code></div>
  <div class="row"><button aria-label="Удалить черновик">🗑</button> — aria-label: <code>Удалить черновик</code></div>
  <div class="row">
    <span id="a">Купить</span> <span id="b">Билет на 12 мая</span>
    <button aria-labelledby="a b">→</button> — склеено из двух id: <code>Купить Билет на 12 мая</code>
  </div>
  <div class="row"><label>Почта <input type="email"></label> — из label: <code>Почта</code></div>
  <div class="row"><input placeholder="Поиск"> — только placeholder: <code>Поиск</code> (плохо)</div>
  <div class="row"><input> — без имени: диктор скажет просто «поле ввода»</div>
</body>
</html>
```

</details>

## 4. ARIA: что это и первое правило

**WAI-ARIA** (Accessible Rich Internet Applications) — набор атрибутов `role` и `aria-*`, которые
**переопределяют** то, что браузер кладёт в дерево доступности. Ключевое слово — *только* в
дерево. ARIA не меняет поведения:

- `role="button"` не делает элемент фокусируемым;
- не добавляет реакцию на Enter и Space;
- не отправляет форму;
- `aria-disabled="true"` не блокирует клик.

**Первое правило ARIA**: если можно использовать нативный элемент HTML с нужной семантикой и
поведением — используйте его, а не добавляйте роль к чужому элементу.

Сравните, сколько нужно написать, чтобы `<div>` стал кнопкой:

```html
<div role="button" tabindex="0"
     onclick="save()"
     onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); save(); }">
  Сохранить
</div>
```

И всё равно это хуже `<button>`: кнопка нажимается по Space при **отпускании** клавиши, а не при
нажатии; учитывает атрибут `disabled`; участвует в формах; правильно работает в режиме высокой
контрастности Windows. Всего этого у `<div>` нет.

Остальные правила, коротко:

- не меняйте нативную семантику без причины (`<h2 role="tab">` — плохо, оберните);
- всё интерактивное с ARIA-ролью должно работать с клавиатуры;
- не ставьте `role="presentation"` или `aria-hidden="true"` на фокусируемый элемент;
- у каждого интерактивного элемента должно быть доступное имя.

Неправильная ARIA хуже отсутствующей: она уверенно сообщает ложь. Исследования автоматических
проверок регулярно показывают, что страницы с ARIA в среднем содержат **больше** ошибок
доступности, чем без неё.

Когда ARIA действительно нужна: для состояний, которых нет в HTML (`aria-expanded` у кнопки
раскрытия меню, `aria-current="page"` у текущей ссылки, `aria-pressed` у кнопки-переключателя,
`aria-invalid` и `aria-describedby` у поля с ошибкой), для живых областей и для сложных виджетов
(вкладки, древовидные списки, комбобоксы), у которых нет HTML-аналога.

## 5. Структура: ориентиры и заголовки

Пользователь диктора не читает страницу сверху вниз. Он **прыгает**: по заголовкам (клавиша H в
NVDA/JAWS, ротор в VoiceOver), по ориентирам (D или R), по ссылкам, по полям форм. По опросам
WebAIM, навигация по заголовкам — самый частый способ найти нужное на длинной странице.

### 5.1. Ориентиры (landmarks)

```html
<header>…логотип, поиск…</header>          <!-- banner -->
<nav aria-label="Основное меню">…</nav>     <!-- navigation -->
<main>…</main>                              <!-- main -->
<aside>…</aside>                            <!-- complementary -->
<footer>…</footer>                          <!-- contentinfo -->
```

- Если ориентиров одного типа несколько (два `<nav>`), дайте каждому имя: `aria-label="Основное
  меню"`, `aria-label="Хлебные крошки"`. Слово «навигация» в имя не включайте — диктор скажет его
  сам.
- Весь значимый контент должен лежать внутри какого-то ориентира.
- Ссылка «Перейти к содержимому» (skip link) первой в документе — давний и всё ещё нужный приём для
  пользователей клавиатуры: без неё они проходят Tab'ом всё меню на каждой странице.

```html
<a class="skip" href="#main">Перейти к содержимому</a>
…
<main id="main" tabindex="-1">…</main>
```

`tabindex="-1"` на цели нужен, чтобы фокус надёжно переместился в `<main>` во всех браузерах, а не
только прокрутка.

### 5.2. Заголовки

- Уровень заголовка — это **структура**, а не размер шрифта. Размер задаёт CSS.
- Не пропускайте уровни вниз (`h2` → `h4`): диктор объявит «заголовок 4 уровня», и пользователь
  будет искать пропавший третий.
- Один `<h1>` — название страницы или главного содержимого. Формально несколько `h1` допустимы,
  но так структура понятнее.
- «Алгоритм структуры документа» (outline algorithm), по которому `<h1>` во вложенной
  `<section>` будто бы становился вторым уровнем, **никогда не был реализован** браузерами и удалён
  из спецификации в 2022 году. Уровень заголовка — это цифра в теге.

<details>
<summary>Skip link: нажмите Tab после загрузки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-accessibility.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.5 system-ui; margin: 0; }
  .skip { position: absolute; left: 8px; top: -100px; background: #000; color: #fff;
          padding: 8px 12px; z-index: 1; }
  .skip:focus { top: 8px; }
  nav { background: #eef; padding: 40px 16px 12px; }
  nav a { margin-right: 12px; }
  main { padding: 16px; }
  main:focus { outline: 3px solid #f80; }
</style>
</head>
<body>
  <a class="skip" href="#main">Перейти к содержимому</a>
  <nav aria-label="Основное меню">
    <a href="#">Главная</a><a href="#">Каталог</a><a href="#">Доставка</a>
    <a href="#">Оплата</a><a href="#">Контакты</a><a href="#">Блог</a>
  </nav>
  <main id="main" tabindex="-1">
    <h1>Содержимое</h1>
    <p>Кликните внутрь примера и нажмите Tab: первой появится ссылка пропуска.
       Enter перенесёт фокус сюда, мимо меню. Следующий Tab пойдёт от main.</p>
    <a href="#">Ссылка в содержимом</a>
  </main>
</body>
</html>
```

</details>

## 6. Фокус

### 6.1. Порядок фокуса

Последовательная навигация (sequential focus navigation) по Tab идёт по элементам, которые
фокусируемы по умолчанию — `<a href>`, `<button>`, поля форм, `<summary>`, `<iframe>`, элементы
с `contenteditable`, — в **порядке DOM**. Не в визуальном порядке.

Отсюда главная ловушка CSS: `order` во flex и grid, `flex-direction: row-reverse`, размещение по
`grid-area`, абсолютное позиционирование меняют только картинку. Фокус по-прежнему идёт по
исходнику и прыгает по экрану хаотично. Правило: визуальный порядок должен совпадать с порядком
DOM, а если нет — меняйте разметку, а не CSS. (В CSS обсуждается свойство `reading-flow`, которое
позволит связать эти порядки, но на него пока нельзя рассчитывать.)

<details>
<summary>order ломает порядок Tab</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-accessibility.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px system-ui; margin: 16px; }
  .bar { display: flex; gap: 8px; }
  button { padding: 10px 16px; font: inherit; }
  button:focus-visible { outline: 3px solid #e60; outline-offset: 2px; }
  .b1 { order: 3; } .b2 { order: 1; } .b3 { order: 2; }
</style>
</head>
<body>
  <p>Кликните сюда и нажимайте Tab. Визуально порядок 2-3-1, но фокус идёт 1 → 2 → 3, как в DOM.</p>
  <div class="bar">
    <button class="b1">Первая в DOM</button>
    <button class="b2">Вторая в DOM</button>
    <button class="b3">Третья в DOM</button>
  </div>
</body>
</html>
```

</details>

### 6.2. Правила `tabindex`

| Значение | Эффект | Когда использовать |
|---|---|---|
| не указан | фокусируется, только если элемент фокусируем по природе | по умолчанию |
| `0` | добавляет элемент в порядок Tab на его место в DOM | собственный виджет без нативного аналога |
| `-1` | фокусируется только программно (`el.focus()`) и кликом, но не Tab'ом | цель skip link, заголовок диалога, неактивные пункты в roving tabindex |
| положительное (`1`, `5`) | элемент идёт **раньше** всех нулевых, по возрастанию | **никогда** |

Положительный `tabindex` создаёт второй, параллельный порядок фокуса. Как только на странице
появляется компонент от другого автора, порядки перемешиваются. Его не используют.

`tabindex="0"` на некликабельном тексте («чтобы диктор прочитал») — тоже ошибка: диктор читает
текст и без фокуса, а пользователь клавиатуры получает пустые остановки.

### 6.3. Видимый фокус

Самая частая ошибка доступности десятилетия — `outline: none` в «сбросе» стилей. Пользователь
клавиатуры теряет курсор.

`:focus-visible` решает исходную претензию дизайнеров («кольцо появляется при клике мышью»):
браузер сам эвристически решает, нужно ли показывать фокус. При клике мышью по кнопке — нет, при
навигации Tab'ом — да, при фокусе на текстовом поле — всегда (туда будут печатать).

```css
:focus { outline: none; }              /* так нельзя без замены */
:focus-visible { outline: 3px solid #1a73e8; outline-offset: 2px; }
```

Почему именно `outline`, а не `border` или `box-shadow`:

- `outline` не занимает места и не сдвигает вёрстку;
- в режиме принудительных цветов (Windows High Contrast, `forced-colors: active`) браузер
  **убирает** `box-shadow`, а `outline` перекрашивает и оставляет. Если делаете кольцо тенью,
  добавьте `outline: 2px solid transparent` — в обычном режиме его не видно, в контрастном он
  станет видимым.

<details>
<summary>:focus против :focus-visible (кликните мышью, потом нажмите Tab)</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-accessibility.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px system-ui; margin: 16px; }
  button { font: inherit; padding: 10px 16px; margin: 6px; border: 1px solid #888;
           border-radius: 6px; background: #f6f6f6; }
  .f:focus { outline: 3px solid crimson; }
  .fv:focus { outline: none; }
  .fv:focus-visible { outline: 3px solid seagreen; outline-offset: 2px; }
  .bad:focus { outline: none; }
</style>
</head>
<body>
  <p>Кликните мышью по каждой кнопке, затем пройдитесь по ним клавишей Tab.</p>
  <button class="f">:focus — кольцо и при клике</button>
  <button class="fv">:focus-visible — только с клавиатуры</button>
  <button class="bad">outline: none — фокус потерян</button>
</body>
</html>
```

</details>

### 6.4. Управление фокусом

Когда интерфейс меняется без перезагрузки, фокус надо переносить вручную:

- открыли модальное окно — фокус внутрь; закрыли — вернуть на кнопку, которая его открыла;
- удалили элемент, на котором был фокус, — фокус уходит на `<body>`, и пользователь клавиатуры
  оказывается в начале страницы. Перенесите его на соседний элемент;
- в одностраничном приложении после смены «страницы» — на новый `<h1>` (с `tabindex="-1"`).

Элемент `<dialog>`, открытый через `showModal()`, делает большую часть работы сам: переносит фокус
внутрь, делает остальную страницу инертной, закрывается по Esc и возвращает фокус. Это пример того,
почему нативный элемент лучше самодельного.

## 7. Клавиатурные паттерны

Правило композитных виджетов: **Tab переходит между виджетами, стрелки — внутри виджета**. Группа
радиокнопок, вкладки, меню, листбокс, дерево — это одна остановка Tab'а, а выбор внутри —
стрелками. Так ведут себя нативные `<input type="radio">` и `<select>`, и пользователь ожидает того
же от ваших компонентов. Справочник паттернов — **ARIA Authoring Practices Guide** (APG).

| Клавиша | Ожидаемое действие |
|---|---|
| Tab / Shift+Tab | к следующему/предыдущему виджету |
| Enter | активировать ссылку или кнопку |
| Space | нажать кнопку, переключить флажок |
| Стрелки | двигаться внутри группы |
| Home / End | к первому/последнему пункту группы |
| Esc | закрыть всплывающее (меню, диалог, подсказку) |

**Перемещаемый tabindex** (roving tabindex): у активного пункта группы `tabindex="0"`, у остальных
`-1`. Стрелка переносит `0` на соседа и вызывает `focus()`. Tab уходит из группы, а при возврате
попадает на последний активный пункт.

<details>
<summary>Вкладки с roving tabindex (стрелки влево/вправо, Home, End)</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-accessibility.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px system-ui; margin: 16px; }
  [role=tablist] { display: flex; gap: 4px; border-bottom: 2px solid #333; }
  [role=tab] { font: inherit; padding: 8px 14px; border: 2px solid #333; border-bottom: 0;
               background: #eee; border-radius: 6px 6px 0 0; }
  [role=tab][aria-selected=true] { background: #333; color: #fff; }
  [role=tab]:focus-visible { outline: 3px solid #e80; outline-offset: 2px; }
  [role=tabpanel] { padding: 12px; border: 2px solid #333; border-top: 0; }
</style>
</head>
<body>
  <p>Кликните на вкладку, затем используйте стрелки. Tab уводит из группы сразу в панель.</p>
  <div role="tablist" aria-label="Тарифы">
    <button role="tab" id="t1" aria-selected="true" aria-controls="p1" tabindex="0">Базовый</button>
    <button role="tab" id="t2" aria-selected="false" aria-controls="p2" tabindex="-1">Плюс</button>
    <button role="tab" id="t3" aria-selected="false" aria-controls="p3" tabindex="-1">Про</button>
  </div>
  <div role="tabpanel" id="p1" aria-labelledby="t1" tabindex="0">Базовый: 5 проектов.</div>
  <div role="tabpanel" id="p2" aria-labelledby="t2" tabindex="0" hidden>Плюс: 50 проектов.</div>
  <div role="tabpanel" id="p3" aria-labelledby="t3" tabindex="0" hidden>Про: без ограничений.</div>
  <script>
    const tabs = [...document.querySelectorAll('[role=tab]')];
    function select(tab) {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute('aria-selected', on);
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      }
      tab.focus();
    }
    for (const t of tabs) {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', e => {
        const i = tabs.indexOf(t), n = tabs.length;
        const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
        if (next !== undefined) { e.preventDefault(); select(tabs[next]); }
      });
    }
  </script>
</body>
</html>
```

</details>

Здесь ARIA оправдана: в HTML нет элемента «вкладки». Роли `tablist`, `tab`, `tabpanel`, состояние
`aria-selected` и связь `aria-controls`/`aria-labelledby` сообщают диктору: «вкладка 2 из 3,
выбрана».

## 8. Как скрыть содержимое: четыре разных «скрыть»

«Скрыть» означает три разных вещи: от глаз, от дерева доступности, от фокуса и взаимодействия.
Каждый приём скрывает свой набор.

| Приём | Видно глазам | В дереве доступности | Фокусируется / кликается |
|---|---|---|---|
| `display: none`, атрибут `hidden` | нет | нет | нет |
| `visibility: hidden` | нет (место занято) | нет | нет |
| класс `.visually-hidden` | нет | **да** | да (если фокусируем) |
| `aria-hidden="true"` | **да** | нет | **да** — опасно |
| атрибут `inert` | да (браузер не затемняет сам) | нет | нет |
| `opacity: 0` | нет (место занято) | да | да |

### 8.1. `visually-hidden` — только для диктора

Канонический класс (его вариации есть в Bootstrap, Tailwind — `sr-only`, и т. д.):

```css
.visually-hidden {
  position: absolute !important;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);        /* устаревшее, но надёжное */
  clip-path: inset(50%);
  white-space: nowrap;        /* иначе слова «складываются» и диктор склеивает их */
  border: 0;
}
```

Почему не `width: 0; height: 0`? Некоторые дикторы пропускают элементы нулевого размера. Почему не
`left: -9999px`? В языках с письмом справа налево это создаёт огромную горизонтальную прокрутку,
а при фокусе браузер прокручивает страницу к элементу.

Применения: подпись к полю поиска, где видна только иконка-лупа; уточнение для ссылок «Подробнее»
(`Подробнее<span class="visually-hidden"> о тарифе Про</span>`); текст «(откроется в новой вкладке)».

### 8.2. `aria-hidden="true"` — только от диктора

Убирает элемент **и всех потомков** из дерева доступности, но оставляет видимым и интерактивным.
Правильно: декоративные иконки рядом с текстом, дублирующие картинки. Опасно: если внутри есть
ссылка или кнопка, пользователь клавиатуры попадёт на неё Tab'ом, а диктор промолчит — «пустая
остановка». Отменить `aria-hidden` у потомка (`aria-hidden="false"`) нельзя.

### 8.3. `inert` — от всех, кроме глаз

Атрибут `inert` (поддерживается во всех основных браузерах с 2023 года) делает поддерево
неинтерактивным: нельзя кликнуть, сфокусировать, выделить текст, найти через поиск по странице, а
из дерева доступности оно исчезает. Это ровно то, что нужно для фона под самодельным модальным
окном или для закрытой выезжающей панели меню, которую анимируют `transform`'ом вместо
`display: none`.

<details>
<summary>Четыре способа скрыть: проверьте Tab'ом и DevTools</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-accessibility.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.5 system-ui; margin: 16px; }
  .row { border: 1px dashed #999; padding: 8px; margin: 8px 0; }
  button:focus-visible { outline: 3px solid #e60; }
  .vh { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden;
        clip-path: inset(50%); white-space: nowrap; border: 0; padding: 0; }
  [inert] { opacity: .5; }
</style>
</head>
<body>
  <p>Нажимайте Tab: какие кнопки получают фокус? Сравните с панелью Accessibility.</p>
  <div class="row">display:none → <button style="display:none">A</button> (кнопки не видно и не достать)</div>
  <div class="row">visually-hidden → <button class="vh">B: невидима, но фокусируется</button> (Tab в неё попадёт)</div>
  <div class="row">aria-hidden → <span aria-hidden="true"><button>C: видна, фокусируется, диктор молчит</button></span></div>
  <div class="row" inert>inert → <button>D: видна, но мертва</button> (полупрозрачность добавлена в CSS)</div>
</body>
</html>
```

</details>

## 9. Живые области

Диктор читает то, на чём фокус. Если сообщение появилось где-то ещё («Товар добавлен в корзину»,
«Найдено 12 результатов»), пользователь о нём не узнает. **Живая область** (live region) — элемент,
изменения внутри которого диктор зачитывает сам.

| Разметка | Вежливость | Применение |
|---|---|---|
| `aria-live="polite"`, `role="status"` | дождаться паузы | статусы, счётчики результатов, «сохранено» |
| `aria-live="assertive"`, `role="alert"` | прервать речь | ошибки, требующие немедленного внимания |
| `role="log"` | polite, добавления | чат, журнал событий |
| `<output>` | неявный `status` | результат вычисления в форме |

Главная ловушка: живая область должна **существовать в DOM до** изменения. Браузер начинает
следить за элементом, когда тот появился; если вставить в документ сразу `<div role="alert">Ошибка</div>`,
многие дикторы ничего не скажут. Правильно — пустой контейнер заранее, текст позже.

Ещё советы: не превращайте в живую область большой блок (диктор зачитает его целиком), не
злоупотребляйте `assertive`, и при повторе одного и того же сообщения сначала очистите контейнер —
иначе изменения нет и объявления не будет.

<details>
<summary>Живая область: role="status" заранее в DOM</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-accessibility.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px system-ui; margin: 16px; }
  #msg { min-height: 1.5em; padding: 6px 10px; background: #eef8ee; border-left: 4px solid #4a4; margin-top: 12px; }
  button { font: inherit; padding: 8px 14px; }
</style>
</head>
<body>
  <p>С включённым диктором (NVDA, VoiceOver) нажмите кнопку: сообщение прозвучит, хотя фокус остаётся на кнопке.</p>
  <button id="add">Добавить в корзину</button>
  <div id="msg" role="status"></div>
  <script>
    let n = 0;
    add.onclick = () => {
      n++;
      msg.textContent = '';
      // небольшая задержка, чтобы диктор заметил изменение
      setTimeout(() => { msg.textContent = 'Товар добавлен. В корзине: ' + n; }, 50);
    };
  </script>
</body>
</html>
```

</details>

## 10. Цвет и контраст

WCAG определяет **коэффициент контраста** (contrast ratio) через относительную яркость
(relative luminance) двух цветов: `(L1 + 0.05) / (L2 + 0.05)`, от 1:1 (одинаковые) до 21:1 (чёрный
на белом).

| Требование (уровень AA) | Минимум |
|---|---|
| Обычный текст | 4.5 : 1 |
| Крупный текст (от 24 px, или от 18.66 px жирный) | 3 : 1 |
| Нетекстовые элементы: границы полей, иконки, кольцо фокуса | 3 : 1 к соседнему цвету |
| Уровень AAA для обычного текста | 7 : 1 |

Примеры: `#767676` на белом — около 4.54:1, минимальный серый, проходящий AA; популярный
«светло-серый плейсхолдер» `#aaa` на белом — около 2.3:1, не проходит.

Ещё два правила:

- **Не передавайте информацию только цветом** (WCAG 1.4.1). Поле с ошибкой — не только красная
  рамка, но и иконка с текстом. Ссылка в абзаце — не только другим цветом, но и подчёркиванием.
- Контраст проверяется в инструментах разработчика: в Chrome пипетка выбора цвета показывает
  коэффициент и линии AA/AAA.

<details>
<summary>Шкала контраста серого на белом</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-accessibility.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px system-ui; margin: 16px; background: #fff; }
  p { margin: 6px 0; }
  span { display: inline-block; width: 220px; font-family: monospace; color: #000; }
</style>
</head>
<body>
  <p style="color:#000"><span>#000 — 21:1</span>Съешь же ещё этих мягких булок</p>
  <p style="color:#595959"><span>#595959 — ≈7:1 (AAA)</span>Съешь же ещё этих мягких булок</p>
  <p style="color:#767676"><span>#767676 — ≈4.5:1 (AA)</span>Съешь же ещё этих мягких булок</p>
  <p style="color:#949494"><span>#949494 — ≈3:1 (только крупный)</span>Съешь же ещё этих мягких булок</p>
  <p style="color:#aaa"><span>#aaa — ≈2.3:1 (провал)</span>Съешь же ещё этих мягких булок</p>
</body>
</html>
```

</details>

## 11. Движение и пользовательские настройки

Медиазапрос `prefers-reduced-motion: reduce` срабатывает, когда пользователь включил в системе
«уменьшить движение». Для людей с вестибулярными нарушениями параллакс, масштабирование при
переходах и бесконечные анимации вызывают головокружение и тошноту.

Два подхода:

```css
/* 1. убрать движение, когда попросили */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* 2. добавлять движение, только если не возражают (надёжнее) */
@media (prefers-reduced-motion: no-preference) {
  .card { transition: transform .3s; }
}
```

Почему `0.01ms`, а не `none`? Скрипты часто ждут события `animationend`/`transitionend`; при
`animation: none` оно не наступит, и интерфейс «зависнет». Короткая длительность сохраняет события.

«Уменьшить движение» — не «убрать всё». Плавное появление прозрачности обычно безопасно; опасны
крупные перемещения и масштаб.

Родственные настройки: `prefers-contrast`, `forced-colors: active` (режим высокой контрастности
Windows: браузер заменяет ваши цвета системными, и фоновые картинки-иконки исчезают),
`prefers-color-scheme`.

<details>
<summary>prefers-reduced-motion в действии</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-accessibility.html#example-9">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; margin: 16px; }
  .ball { width: 40px; height: 40px; border-radius: 50%; background: #e64; }
  @media (prefers-reduced-motion: no-preference) {
    .ball { animation: move 1.2s ease-in-out infinite alternate; }
  }
  @keyframes move { to { transform: translateX(240px); } }
  .note::after { content: "Движение разрешено: шарик анимирован."; }
  @media (prefers-reduced-motion: reduce) {
    .note::after { content: "Включено «уменьшить движение»: шарик стоит."; }
  }
</style>
</head>
<body>
  <p class="note"></p>
  <div class="ball"></div>
  <p><small>Включите «уменьшить движение» в настройках ОС (или эмуляцию в DevTools → Rendering) и перезагрузите пример.</small></p>
</body>
</html>
```

</details>

## 12. Как проверять

1. **Клавиатура**: отложите мышь и пройдите сценарий Tab'ом. Виден ли фокус? Логичен ли порядок?
   Можно ли закрыть всё по Esc? Не застревает ли фокус?
2. **Увеличение** до 200 % и ширина окна 320 CSS px (WCAG 1.4.10 Reflow): не должно быть
   горизонтальной прокрутки у текста.
3. **Автоматические проверки** (Lighthouse, axe) находят лишь часть проблем — по разным оценкам,
   около трети. Они видят отсутствие `alt`, но не видят бессмысленный `alt`.
4. **Диктор**: VoiceOver (встроен в macOS и iOS), NVDA (бесплатен для Windows), TalkBack (Android).
   Пройдите страницу по заголовкам и ориентирам.

## Итог

- Вспомогательные технологии видят **дерево доступности**: роль, имя, описание, состояния.
- Роли бесплатно приходят из семантических элементов. Первое правило ARIA — не использовать ARIA,
  если есть нативный элемент.
- ARIA меняет только дерево, но не поведение: ни фокуса, ни клавиш.
- Имя: `aria-labelledby` → `aria-label` → нативный источник → содержимое → `title`. Видимый
  текст должен входить в имя.
- Ориентиры и правильные уровни заголовков — это оглавление для диктора.
- Фокус идёт по DOM, а не по картинке. Положительный `tabindex` — никогда. `:focus-visible` вместо
  удаления `outline`.
- Tab — между виджетами, стрелки — внутри (roving tabindex).
- `display: none` скрывает от всех, `.visually-hidden` — только от глаз, `aria-hidden` — только от
  диктора, `inert` — от всего, кроме глаз.
- Живая область должна быть в DOM до изменения.
- Контраст 4.5:1 для текста, 3:1 для крупного и для элементов интерфейса; не только цветом.
- `prefers-reduced-motion` — уважайте.

## Проверьте себя

1. Какое доступное имя у `<button aria-label="Закрыть" title="Закрыть окно">×</button>`? Почему не
   «×» и не «Закрыть окно»?
2. Чем плох `<div role="button" tabindex="0">` по сравнению с `<button>`, если обработчик Enter уже
   написан?
3. Почему кнопка внутри `aria-hidden="true"` — ошибка, а внутри `inert` — нет?
4. Карточки переставлены CSS-свойством `order`. Что увидит пользователь клавиатуры и как это
   исправить?
5. Скрипт вставляет в страницу готовый `<div role="alert">Ошибка оплаты</div>`, но диктор молчит.
   Почему, и как переписать?
6. Почему в правиле для `prefers-reduced-motion` ставят `0.01ms`, а не `animation: none`?

Дальше: [История, quirks mode и странности](LEARN_HTML_HISTORY_QUIRKS_COURSE.md).
