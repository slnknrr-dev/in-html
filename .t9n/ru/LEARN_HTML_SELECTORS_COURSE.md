# HTML как набор крючков для селекторов

> Курс 26 из программы. Для тех, кто уже знает [Селекторы CSS](LEARN_CSS_SELECTORS_COURSE.md),
> [Каскад](LEARN_CSS_CASCADE_COURSE.md) и [Атрибуты](LEARN_HTML_ATTRIBUTES_COURSE.md). Теперь смотрим
> с другой стороны: не «как выбрать элемент», а «как написать разметку, чтобы её было легко и дёшево
> выбирать» — из CSS, из JavaScript и из тестов.

**Что вы будете понимать после курса**

- чем отличаются `id`, `class`, `data-*` и ARIA-атрибуты как **крючки** (hooks) и какой для чего;
- почему состояние лучше хранить в атрибуте (`aria-expanded`, `aria-current`), а не в классе `.is-open`;
- как держать **специфичность плоской** и почему это важнее любой методологии;
- что такое БЭМ (BEM), префиксы-пространства имён (как `ed-`, `ap-`, `uc-` в этом репозитории);
- зачем разделять крючки для стилей и для скриптов (`js-*`, `data-action`);
- какие ловушки скрывает `id`: глобальные свойства `window`, уникальность, специфичность.

---

## 1. Разметка — это интерфейс

Каждый атрибут, на который опирается селектор, — это **контракт**. CSS говорит «я крашу всё, у чего
есть класс `card`», JavaScript — «я вешаю обработчик на элемент с `data-action="save"`», тест —
«я нажимаю кнопку с ролью `button` и именем „Сохранить“». Если кто-то переименует класс, сломается
не та часть, которую он трогал.

Отсюда первый принцип: **у каждого крючка должен быть один хозяин и одна цель**. Класс для
оформления, атрибут данных для поведения, ARIA для состояния, которое видит и пользователь
вспомогательных технологий.

| Крючок | Специфичность | Сколько на странице | Кто читает | Типичная цель |
|---|---|---|---|---|
| `id` | (1,0,0) | ровно один | CSS, JS, ссылки `#якорь`, `for`, `aria-*` | цель ссылки, связь `label`/`aria-labelledby` |
| `class` | (0,1,0) | сколько угодно | CSS, JS | оформление, компонент |
| `[data-*]` | (0,1,0) | сколько угодно | CSS, JS (`dataset`) | поведение, параметры, состояние без семантики |
| `[aria-*]` | (0,1,0) | сколько угодно | CSS, JS, **скринридер** | состояние, видимое пользователю |
| тип (`button`) | (0,0,1) | — | CSS | базовые стили элемента |

Специфичность записана тройкой (id, класс/атрибут/псевдокласс, тип/псевдоэлемент). Обратите внимание:
класс и атрибутный селектор весят **одинаково**. `[data-state="open"]` ничем не «тяжелее» `.is-open`.

## 2. `id`: сильный, уникальный и коварный

### 2.1. Уникальность — требование, а не совет

Спецификация требует, чтобы `id` был уникален в своём дереве. Браузер при нарушении не ругается, но:

- `document.getElementById('x')` вернёт **первый** элемент в порядке дерева;
- `label for="x"` свяжется с первым — щелчок по второй подписи фокусирует чужое поле;
- `#x` в CSS покрасит **все** элементы — селектору уникальность безразлична;
- переход по ссылке `#x` прокрутит к первому.

Дубли обычно появляются, когда компонент вставляют на страницу дважды. Поэтому `id` внутри
переиспользуемого фрагмента генерируют (`field-1`, `field-2`) или избегают вовсе.

### 2.2. Именованный доступ: `id` становится переменной

Исторически (со времён IE) элементы с `id` доступны как свойства `window` — это стандартизировано
как **именованный доступ к Window** (named access on the Window object).

<details>
<summary>id как глобальная переменная</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-selectors.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px system-ui; }
  pre { background: #f1f5f9; padding: 8px; border-left: 4px solid #0ea5e9; }
</style>
</head>
<body>
  <p id="status">Я абзац с id="status"</p>
  <div id="top">div с id="top"</div>
  <pre id="out"></pre>
  <script>
    // Никаких getElementById: id стал свойством window
    const lines = [];
    lines.push('typeof window.status: ' + typeof window.status);
    lines.push('typeof top: ' + typeof top + ' (это окно верхнего уровня, а не div)');
    lines.push('out === document.getElementById("out"): ' + (out === document.getElementById('out')));
    out.textContent = lines.join('\n');
  </script>
</body>
</html>
```

</details>

Что видно в примере:

- `out` работает без объявления — опечатка в имени переменной может «найти» элемент и молча работать;
- `status` и `top` — уже существующие свойства окна (`window.status` — строка, `window.top` — окно),
  поэтому элемент **не** перекрывает их. Именованный доступ проигрывает настоящим свойствам и
  переменным, объявленным в скрипте;
- то же у форм: `<input name="submit">` перекрывает `form.submit()`, а `<input name="action">` —
  свойство `form.action`. Классическая ловушка: `form.submit is not a function`.

Вывод: не полагайтесь на именованный доступ, всегда ищите элемент явно.

### 2.3. Специфичность `id` ломает каскад

Одно правило с `#` перевешивает любое количество классов. `#sidebar a` (1,0,1) нельзя перебить
`.nav .link.is-active` (0,3,0). Начинается гонка: ещё один `id`, затем `!important`.

<details>
<summary>id перевешивает три класса</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-selectors.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px system-ui; }
  a { display: inline-block; padding: 6px 10px; margin: 4px; border: 2px solid; text-decoration: none; }
  /* (1,0,1) */
  #sidebar a { color: #64748b; }
  /* (0,3,0) хотим, чтобы активная ссылка была красной, но проигрываем */
  .nav .link.is-active { color: #dc2626; }
  /* Выход без id: та же ссылка во втором меню */
  .nav2 .link { color: #64748b; }
  .nav2 .link[aria-current="page"] { color: #dc2626; }
</style>
</head>
<body>
  <nav id="sidebar" class="nav">
    <a class="link" href="#">Главная</a>
    <a class="link is-active" href="#">Текущая (должна быть красной)</a>
  </nav>
  <nav class="nav2">
    <a class="link" href="#">Главная</a>
    <a class="link" href="#" aria-current="page">Текущая</a>
  </nav>
</body>
</html>
```

</details>

Если нужно сослаться на элемент с `id`, но без веса `id`, используйте атрибутный селектор
`[id="sidebar"]` (0,1,0) или `:where(#sidebar)` (0,0,0).

## 3. Плоская специфичность

Цель — чтобы почти все правила имели специфичность **(0,1,0)** или **(0,2,0)**. Тогда побеждает
тот, кто ниже в файле, и порядок правил становится понятным инструментом, а не войной.

| Привычка | Проблема | Плоская альтернатива |
|---|---|---|
| `.header .nav ul li a` | (0,2,3), зависит от структуры | `.nav-link` |
| `#main .title` | (1,1,0) | `.main-title` |
| `div.card` | лишний тип, (0,1,1) | `.card` |
| `.card.is-open` | (0,2,0), нормально | `.card[aria-expanded="true"]` — тоже (0,2,0) |
| сброс через `!important` | ломает слои | `@layer` или `:where()` |

`:where()` обнуляет вес аргумента — удобно для базовых стилей, которые легко перебить:

```css
:where(.btn) { padding: 6px 12px; }     /* (0,0,0) */
.toolbar button { padding: 2px; }        /* (0,1,1) — победит без борьбы */
```

`:is()` наоборот берёт вес **самого тяжёлого** аргумента: `:is(#a, .b)` весит (1,0,0) даже для `.b`.

Длинные цепочки потомков плохи ещё и тем, что привязывают стиль к структуре: переставили `ul` в
`div` — стиль отвалился. Подробнее про подсчёт — в [Каскаде](LEARN_CSS_CASCADE_COURSE.md).

## 4. Соглашения об именах

### 4.1. БЭМ

БЭМ (Блок, Элемент, Модификатор; BEM, Block Element Modifier) родился в Яндексе. Суть — имя класса
само описывает место в компоненте, поэтому вложенные селекторы не нужны:

```html
<article class="card card--featured">
  <h3 class="card__title">…</h3>
  <p class="card__text">…</p>
</article>
```

- **блок** `card` — самостоятельный компонент;
- **элемент** `card__title` — часть блока, вне его смысла не имеет;
- **модификатор** `card--featured` — вариант блока или элемента.

Все селекторы — один класс, (0,1,0). Цена — длинные имена. Важная деталь: модификатор описывает
**постоянный вариант** (крупная, тёмная), а не **состояние** (открыта, выбрана). Для состояния есть
атрибуты (раздел 5).

### 4.2. Префиксы-пространства имён

В этом репозитории каждое приложение получает короткий префикс: `ed-` у редактора, `ap-` у
архиватора, `uc-` у конвертера единиц. Это то же, что пространство имён в языке программирования:
`.ed-toolbar` не столкнётся с `.ap-toolbar`, даже если оба CSS-файла окажутся на одной странице или
встроятся в чужой сайт.

| Подход | Пример | Плюс | Минус |
|---|---|---|---|
| без префикса | `.toolbar` | коротко | конфликт с чужим CSS |
| префикс приложения | `.ed-toolbar` | изоляция, легко искать | длиннее |
| префикс + БЭМ | `.ed-toolbar__btn--primary` | всё сразу | очень длинно |
| Shadow DOM | `<ed-toolbar>` | полная изоляция | другие правила стилей |

Бонус префиксов, о котором редко говорят: **поиск по проекту**. `grep ed-panel` находит и CSS, и
HTML, и JS — у короткого `.panel` будут сотни ложных совпадений.

<details>
<summary>Префиксы спасают от конфликта</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-selectors.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; display: grid; gap: 12px; }
  /* «Чужой» CSS сайта, куда встроили виджеты */
  .button { background: #fde047; border: 3px dashed #a16207; }
  /* Виджет без префикса: его правило совпало с чужим и смешалось */
  .button { color: white; background-color: #2563eb; padding: 6px 12px; }
  /* Виджет с префиксом: чужое правило не задело */
  .uc-button { color: white; background: #16a34a; border: 0; padding: 6px 12px; border-radius: 4px; }
</style>
</head>
<body>
  <div>Без префикса: <button class="button">Конвертировать</button> — пунктир достался от сайта</div>
  <div>С префиксом: <button class="uc-button">Конвертировать</button></div>
</body>
</html>
```

</details>

## 5. Состояние: класс или атрибут

### 5.1. Проблема `.is-open`

Классический подход: JavaScript добавляет `.is-open`, CSS по нему показывает панель. Работает, но
**пользователь скринридера ничего не узнаёт** — класс для него невидим. Значит, надо ещё ставить
`aria-expanded`. Теперь состояние хранится дважды, и рано или поздно эти копии разойдутся.

Решение: **хранить состояние в одном месте — в ARIA-атрибуте — и стилизовать по нему**.

```css
.disclosure[aria-expanded="true"] + .panel { display: block; }
```

Селектор сам гарантирует, что визуальное состояние совпадает с тем, что объявлено вспомогательным
технологиям. Забыли обновить `aria-expanded` — сломалось и визуально, ошибку заметят сразу.

<details>
<summary>Состояние в aria-expanded (нажмите кнопку)</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-selectors.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px system-ui; }
  .ap-toggle { padding: 6px 12px; border: 2px solid #334155; background: white; cursor: pointer; }
  .ap-toggle::before { content: "▸ "; }
  /* Стиль читает то же состояние, что и скринридер */
  .ap-toggle[aria-expanded="true"] { background: #e0f2fe; border-color: #0284c7; }
  .ap-toggle[aria-expanded="true"]::before { content: "▾ "; }
  .ap-panel { border: 2px dashed #0284c7; padding: 8px; margin-top: 6px; }
</style>
</head>
<body>
  <button class="ap-toggle" aria-expanded="false" aria-controls="p1" data-action="toggle">Подробности</button>
  <div class="ap-panel" id="p1" hidden>Содержимое панели. Скрыто атрибутом hidden.</div>
  <script>
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-action="toggle"]');
      if (!btn) return;
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      document.getElementById(btn.getAttribute('aria-controls')).hidden = !open;
    });
  </script>
</body>
</html>
```

</details>

Внимание: значения ARIA — **строки**. `aria-expanded="false"` — это не отсутствие атрибута, и
селектор `[aria-expanded]` совпадёт в обоих состояниях. Пишите значение явно.

### 5.2. Каталог полезных атрибутов-состояний

| Атрибут | Смысл | Типичный селектор |
|---|---|---|
| `aria-expanded` | раскрыто/свёрнуто | `[aria-expanded="true"]` |
| `aria-current` | текущий элемент набора: `page`, `step`, `date`, `true` | `[aria-current="page"]` |
| `aria-selected` | выбранная вкладка, вариант списка | `[role="tab"][aria-selected="true"]` |
| `aria-pressed` | кнопка-переключатель | `[aria-pressed="true"]` |
| `aria-checked` | состояние у ролей `checkbox`, `switch`, `menuitemcheckbox` | `[aria-checked="mixed"]` |
| `aria-disabled` | недоступно, но фокусируемо | `[aria-disabled="true"]` |
| `aria-invalid` | ошибка ввода | `[aria-invalid="true"]` |
| `aria-busy` | идёт загрузка | `[aria-busy="true"]` |

Не каждое состояние нужно ARIA. «Тёмная тема», «перетаскивается», «анимация завершилась» —
пользователю скринридера это не сообщается, такие состояния хранят в `data-*`:
`[data-theme="dark"]`, `[data-dragging]`. Правило: **ARIA, если состояние имеет смысл для человека;
`data-*`, если только для оформления или логики**.

И ещё: где есть родной элемент или атрибут, ARIA не нужна. `<details open>`, `<input checked>`,
`<button disabled>`, `<dialog open>` уже дают селекторы `[open]`, `:checked`, `:disabled`.

<details>
<summary>aria-current для навигации и шагов</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-selectors.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; }
  .ed-nav { display: flex; gap: 4px; margin-bottom: 16px; }
  .ed-nav a { padding: 6px 12px; border-radius: 6px; color: #334155; text-decoration: none; }
  .ed-nav a[aria-current="page"] { background: #1e293b; color: white; }
  .ed-steps { display: flex; gap: 0; list-style: none; padding: 0; counter-reset: s; }
  .ed-steps li { counter-increment: s; padding: 6px 14px; border: 2px solid #cbd5e1; margin-right: -2px; }
  .ed-steps li::before { content: counter(s) ". "; }
  /* Все шаги до текущего: соседний комбинатор не умеет назад, используем :has() */
  .ed-steps li:has(~ [aria-current="step"]) { background: #dcfce7; }
  .ed-steps [aria-current="step"] { border-color: #16a34a; font-weight: bold; position: relative; }
</style>
</head>
<body>
  <nav class="ed-nav">
    <a href="#">Главная</a>
    <a href="#" aria-current="page">Документы</a>
    <a href="#">Настройки</a>
  </nav>
  <ol class="ed-steps">
    <li>Корзина</li>
    <li>Адрес</li>
    <li aria-current="step">Оплата</li>
    <li>Готово</li>
  </ol>
</body>
</html>
```

</details>

## 6. Крючки для JavaScript отдельно от стилей

### 6.1. Почему нельзя вешать поведение на класс оформления

Скрипт делает `document.querySelectorAll('.btn-primary')` и навешивает отправку формы. Через месяц
дизайнер меняет кнопку на `.btn-secondary` — отправка пропала. Никто не догадается, что класс
оформления был ещё и контрактом со скриптом.

Два распространённых решения:

| Подход | Пример | Плюсы | Минусы |
|---|---|---|---|
| класс `js-*` | `class="btn js-save"` | дёшево, понятно | смешивается со стилями, легко нарушить договор «не стилизовать `js-`» |
| `data-action` | `data-action="save"` | отдельное пространство, несёт значение, читается из `dataset` | чуть длиннее |
| роль и имя | `getByRole('button', {name: 'Сохранить'})` | тест проверяет то, что видит пользователь | для тестов, не для продакшен-кода |

`data-action` хорошо сочетается с **делегированием** (event delegation): один обработчик на корне,
`closest('[data-action]')` и таблица действий. Новые кнопки, вставленные позже, работают сами.

<details>
<summary>Делегирование через data-action</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-selectors.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; }
  .uc-btn { padding: 6px 12px; margin: 4px; border: 2px solid #475569; border-radius: 4px; background: white; }
  .uc-btn--danger { border-color: #dc2626; color: #dc2626; }
  output { display: block; margin-top: 8px; padding: 8px; background: #f1f5f9; min-height: 1.2em; }
</style>
</head>
<body>
  <div class="uc-toolbar" id="bar">
    <!-- Классы для вида, data-action для поведения: независимо меняются -->
    <button class="uc-btn" data-action="add" data-step="1">+1</button>
    <button class="uc-btn" data-action="add" data-step="10">+10</button>
    <button class="uc-btn uc-btn--danger" data-action="reset">Сброс</button>
    <button class="uc-btn" data-action="spawn">Добавить кнопку +100</button>
  </div>
  <output id="res">0</output>
  <script>
    let n = 0;
    const actions = {
      add: el => { n += Number(el.dataset.step); },
      reset: () => { n = 0; },
      spawn: () => {
        bar.insertAdjacentHTML('beforeend', '<button class="uc-btn" data-action="add" data-step="100">+100</button>');
      }
    };
    bar.addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (!el || !bar.contains(el)) return;
      actions[el.dataset.action](el);
      res.textContent = n;
    });
  </script>
</body>
</html>
```

</details>

(В примере мы обращались к `bar` и `res` по именованному доступу ради краткости — именно так, как
раздел 2.2 советует не делать в настоящем коде.)

### 6.2. `data-*` и `dataset`

Имя `data-step-size` превращается в `el.dataset.stepSize`: дефисы убираются, следующая буква
становится заглавной. Значение всегда строка — `Number()` обязателен. Заглавные буквы в имени
атрибута HTML-парсер приводит к строчным, поэтому `data-stepSize` превратится в `data-stepsize`.

В CSS значение `data-*` можно не только сравнить, но и вывести: `content: attr(data-label)`.

## 7. Атрибутные селекторы как инструмент

Крючок-атрибут даёт больше возможностей, чем класс, потому что у него есть **значение**:

| Селектор | Совпадает, если значение… |
|---|---|
| `[data-size="lg"]` | ровно `lg` |
| `[data-tags~="new"]` | содержит слово `new` в списке через пробел |
| `[href^="https:"]` | начинается с |
| `[href$=".pdf"]` | заканчивается на |
| `[class*="ed-"]` | содержит подстроку (осторожно: совпадёт и `need-x`) |
| `[data-kind="Note" i]` | без учёта регистра |

Один атрибут с перечислимым значением заменяет группу взаимоисключающих классов. С классами можно
случайно получить `.size-sm.size-lg`; атрибут физически хранит одно значение.

<details>
<summary>Один атрибут вместо набора классов</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-selectors.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .ap-badge { padding: 2px 8px; border-radius: 999px; border: 2px solid; }
  .ap-badge[data-status="ok"]      { color: #15803d; background: #dcfce7; }
  .ap-badge[data-status="warn"]    { color: #a16207; background: #fef9c3; }
  .ap-badge[data-status="error"]   { color: #b91c1c; background: #fee2e2; }
  .ap-badge[data-tags~="new"]::after { content: " ★"; }
  a[href$=".pdf"]::after { content: " (PDF)"; color: #64748b; }
  a[href^="http"]:not([href*="example.org"])::after { content: " ↗"; }
</style>
</head>
<body>
  <span class="ap-badge" data-status="ok">распаковано</span>
  <span class="ap-badge" data-status="warn" data-tags="new beta">битый CRC</span>
  <span class="ap-badge" data-status="error">пароль неверен</span>
  <a href="/doc/manual.pdf">Руководство</a>
  <a href="https://codeberg.org/">Внешняя ссылка</a>
  <a href="https://example.org/x">Своя ссылка</a>
</body>
</html>
```

</details>

## 8. Сводные правила

1. **`id`** — только для связей (`for`, `aria-labelledby`, `aria-controls`, якоря). В CSS — почти
   никогда.
2. **Классы** — для оформления, с префиксом приложения, по возможности один класс на селектор.
3. **Модификатор** (`--featured`) — постоянный вариант. **Состояние** — атрибут.
4. **ARIA** — для состояния, которое важно пользователю; стилизуйте прямо по нему.
5. **`data-*`** — для поведения (`data-action`) и для служебного состояния.
6. **Специфичность** держите в диапазоне (0,1,0)–(0,2,0); базу пишите в `:where()`.
7. Не опирайтесь на **структуру** (`> li > a`), если можно опереться на имя.

<details>
<summary>Всё вместе: вкладки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-selectors.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; }
  .ed-tabs__list { display: flex; gap: 2px; border-bottom: 2px solid #1e293b; }
  .ed-tabs__tab { padding: 6px 14px; border: 2px solid #cbd5e1; border-bottom: 0; background: #f8fafc; cursor: pointer; }
  /* Вид активной вкладки следует из ARIA-состояния */
  .ed-tabs__tab[aria-selected="true"] { background: #1e293b; color: white; border-color: #1e293b; }
  .ed-tabs__tab:focus-visible { outline: 3px solid #f59e0b; outline-offset: 2px; }
  .ed-tabs__panel { padding: 10px; border: 2px solid #1e293b; border-top: 0; }
</style>
</head>
<body>
  <div class="ed-tabs" data-component="tabs">
    <div class="ed-tabs__list" role="tablist" aria-label="Режим">
      <button class="ed-tabs__tab" role="tab" id="t1" aria-controls="p1" aria-selected="true">Текст</button>
      <button class="ed-tabs__tab" role="tab" id="t2" aria-controls="p2" aria-selected="false" tabindex="-1">Код</button>
    </div>
    <div class="ed-tabs__panel" role="tabpanel" id="p1" aria-labelledby="t1">Панель текста</div>
    <div class="ed-tabs__panel" role="tabpanel" id="p2" aria-labelledby="t2" hidden>Панель кода</div>
  </div>
  <script>
    for (const root of document.querySelectorAll('[data-component="tabs"]')) {
      root.addEventListener('click', e => {
        const tab = e.target.closest('[role="tab"]');
        if (!tab) return;
        for (const t of root.querySelectorAll('[role="tab"]')) {
          const on = t === tab;
          t.setAttribute('aria-selected', String(on));
          t.tabIndex = on ? 0 : -1;
          document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
        }
      });
    }
  </script>
</body>
</html>
```

</details>

В примере у каждой части своя роль: БЭМ-классы с префиксом `ed-` — внешний вид; `role` и
`aria-selected` — смысл и состояние; `data-component` — точка входа скрипта; `id` — только связи
между вкладкой и панелью. Полная клавиатурная навигация (стрелки) опущена ради краткости.

## Итог

- Каждый атрибут, на который смотрит селектор, — контракт. Один крючок — одна цель.
- `id` уникален, весит (1,0,0), становится свойством `window` и полями формы перекрывает её методы.
  Используйте его для связей, а не для стилей.
- Класс и атрибутный селектор весят одинаково, поэтому стилизация по `[aria-expanded="true"]` ничего
  не стоит, но убирает дублирование состояния.
- БЭМ и префиксы (`ed-`, `ap-`, `uc-`) дают плоскую специфичность, изоляцию и удобный поиск.
- Поведение — через `data-action` и делегирование, отдельно от классов оформления.

## Проверьте себя

1. Почему `<input name="submit">` внутри формы ломает вызов `form.submit()`?
2. Какая специфичность у `.tabs [aria-selected="true"]` и у `#tabs .tab`? Какое правило победит?
3. Чем плох селектор `[aria-expanded]` без значения?
4. Когда состояние стоит хранить в `data-*`, а не в `aria-*`?
5. Как сослаться на элемент с `id="main"` в CSS, не получив вес (1,0,0)? Назовите два способа.

Дальше: [Формы](LEARN_HTML_FORMS_COURSE.md).
