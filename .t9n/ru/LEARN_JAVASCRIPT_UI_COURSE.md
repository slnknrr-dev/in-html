# Интерфейс: состояние, отрисовка, диалоги

> Курс 36 из программы. Для тех, кто прошёл [События](LEARN_JAVASCRIPT_EVENTS_COURSE.md) и хочет
> собирать настоящие интерфейсы без фреймворка: понятное состояние, предсказуемая отрисовка, доступные
> диалоги и формы, честные состояния загрузки и ошибки.

**Что вы будете понимать после курса**

- шаблон «состояние → отрисовка» и почему он побеждает «ручные правки DOM»;
- как сделать минимальную реактивность без фреймворка: подписка, пакетная перерисовка, сохранение
  фокуса;
- как написать маленький помощник `h()` для построения элементов (как `ui/dom.js` в этом репозитории)
  и почему текст должен попадать в DOM текстовыми узлами;
- `<dialog>` с `showModal()`: верхний слой (top layer), `::backdrop`, инертность фона, возврат
  значения;
- Popover API (`popover`, `popovertarget`) и чем поповер отличается от модального диалога;
- управление фокусом: куда его ставить и как возвращать;
- формы через `FormData`, встроенную валидацию и `requestSubmit()`;
- debounce ввода, отмену устаревших запросов, оптимистичный интерфейс, состояния загрузки и ошибки.

---

## 1. Состояние → отрисовка

Без дисциплины интерфейс превращается в набор обработчиков, каждый из которых что-то правит в DOM:
этот добавил класс, тот поменял текст, третий забыл обновить счётчик. Истина размазана по дереву, и
никто не знает, какое сочетание классов сейчас «правильное».

Шаблон, лежащий в основе React, Vue, Elm и любого здравого кода без них:

```
событие → изменение состояния → render(state) → DOM
```

- **Состояние** (state) — обычный объект JavaScript, единственный источник истины.
- **Отрисовка** (render) — функция, которая по состоянию строит (или обновляет) DOM. Она не читает DOM,
  чтобы узнать, «что сейчас»: всё нужное есть в состоянии.
- **Обработчики** событий только меняют состояние и просят перерисовку.

Следствие: любое состояние экрана воспроизводимо. Сохранили объект — восстановили экран. Ошибку
легко повторить, потому что вход у `render` один.

<details>
<summary>Счётчик: состояние и одна функция отрисовки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-ui.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px system-ui; }
  .n { font-size: 40px; font-weight: bold; }
  .n.neg { color: #c62828; } .n.big { color: #2e7d32; }
  button { font-size: 16px; padding: 4px 12px; }
</style>
</head>
<body>
<div id="app"></div>
<script>
  const state = { count: 0, step: 1 };
  function render() {
    const app = document.getElementById('app');
    app.innerHTML = '';
    const n = document.createElement('div');
    n.className = 'n' + (state.count < 0 ? ' neg' : state.count >= 10 ? ' big' : '');
    n.textContent = state.count;
    const minus = Object.assign(document.createElement('button'), { textContent: '−' + state.step });
    const plus = Object.assign(document.createElement('button'), { textContent: '+' + state.step });
    minus.onclick = () => { state.count -= state.step; render(); };
    plus.onclick = () => { state.count += state.step; render(); };
    const step = Object.assign(document.createElement('button'), { textContent: 'шаг: ' + state.step });
    step.onclick = () => { state.step = state.step === 1 ? 5 : 1; render(); };
    app.append(n, minus, plus, ' ', step);
  }
  render();
</script>
</body>
</html>
```

</details>

Цвет, текст и подписи кнопок выводятся из состояния в одном месте. Никакой обработчик не трогает
класс `neg` напрямую.

## 2. Помощник `h()`: элементы без `innerHTML`

`document.createElement` многословен, `innerHTML` с подстановкой строк — опасен:

```js
list.innerHTML = `<li>${user.name}</li>`;   // name = '<img src=x onerror=alert(1)>' → XSS
```

Решение — маленькая функция-построитель. В этом репозитории она живёт в `ui/dom.js`; её контракт
стоит повторить, потому что каждое правило решает реальную проблему:

```js
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;            // необязательные атрибуты прямо в литерале
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') value = v;                 // после детей: у <select> нужны option
    else if (k in el && typeof el[k] === 'boolean') el[k] = v; // checked, disabled, hidden…
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;        // условные дети: cond && h(...)
    el.append(kid instanceof Node ? kid : String(kid)); // строка → ТЕКСТОВЫЙ узел
  }
  if (value !== undefined) el.value = value;
  return el;
}
```

Почему так:

| Правило | Проблема, которую оно решает |
|---|---|
| строки → текстовые узлы | XSS невозможен: `<` в данных останется символом |
| `null`/`false` пропускаются | `'aria-current': active ? 'page' : null` без `if` |
| `checked`, `disabled` — свойствами | атрибут `checked` — **начальное** значение, свойство — текущее |
| `value` после детей | `select.value = 'b'` до появления `<option value="b">` молча не сработает |
| `on*` через `addEventListener` | несколько слушателей, параметры |
| `style` объектом | но `--переменные` нужно ставить через `style.setProperty` |

Разница между атрибутом и свойством — частый источник багов: после того как пользователь снял
галочку, `input.getAttribute('checked')` всё ещё `""`, а `input.checked === false`. Атрибут — это
разметка (и `defaultChecked`), свойство — живое состояние.

<details>
<summary>h() и безопасный текст</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-ui.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  li { padding: 4px; } li[aria-current] { background: #fff3e0; font-weight: bold; }
  .bad { border: 2px solid #c62828; padding: 6px; margin-top: 8px; }
</style>
</head>
<body>
<div id="app"></div>
<script>
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
    return el;
  }
  const users = ['Анна', '<img src=x onerror="document.body.style.background=\'red\'">', 'Борис'];
  let current = 0;
  function render() {
    document.getElementById('app').replaceChildren(
      h('p', null, 'Щёлкайте по именам. Второе имя — попытка внедрить HTML, но она показана как текст.'),
      h('ul', null, users.map((name, i) =>
        h('li', { 'aria-current': i === current ? 'true' : null, onclick: () => { current = i; render(); } }, name))),
      users.length > 2 && h('p', { class: 'bad' }, 'Через innerHTML та же строка выполнила бы onerror.')
    );
  }
  render();
</script>
</body>
</html>
```

</details>

## 3. Минимальная реактивность

Вызывать `render()` руками после каждой правки утомительно и легко забыть. Сделаем хранилище,
которое само зовёт подписчиков, и **объединим** несколько изменений в одну перерисовку:

```js
function createStore(initial) {
  let state = initial, scheduled = false;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => { scheduled = false; subs.forEach(fn => fn(state)); });
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
```

- **Неизменяемые обновления** (`{ ...state, ...patch }`) дают дешёвую проверку «изменилось ли»:
  `prev.items === next.items`.
- **Пакетирование** через `queueMicrotask`: три `set()` подряд в одном обработчике → одна перерисовка
  до того, как браузер нарисует кадр. Вариант — `requestAnimationFrame`, если обновления очень частые
  (например, при `pointermove`).
- `Proxy` позволяет сделать «магическое» `state.count++`, как во Vue, но цена — сложнее отладка и
  ловушки с вложенными объектами. Явный `set` проще.

### 3.1. Полная перерисовка и её цена

«Снести и построить заново» (`replaceChildren(render(state))`) — самый простой и честный способ. Он
быстрее, чем кажется: создание нескольких сотен элементов — доли миллисекунды. Но он **теряет**:

- фокус и позицию каретки в поле ввода (элемент заменён другим);
- выделение текста, прокрутку внутренних контейнеров;
- состояние `<details open>`, воспроизводимое видео, CSS-переходы.

Три стратегии:

| Стратегия | Как | Когда |
|---|---|---|
| Полная замена | `root.replaceChildren(view(state))` | маленькие области без полей ввода |
| Точечное обновление | держать ссылки на узлы, менять `textContent`/классы | счётчики, статусы, частые обновления |
| Ключевое согласование (keyed) | `Map` ключ → элемент, переиспользовать узлы и переставлять | списки с полями ввода, анимации |

Этот репозиторий использует первую стратегию по умолчанию и точечную — где важен фокус. Виртуальный
DOM — это автоматизация третьей, и без неё прекрасно живут, пока не нужно согласовывать тысячи узлов.

<details>
<summary>Полная перерисовка теряет фокус, точечная — нет</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-ui.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  section { border: 2px solid #1565c0; padding: 8px; margin: 8px 0; }
  section.b { border-color: #2e7d32; }
  input { font-size: 16px; }
</style>
</head>
<body>
<p>Печатайте в оба поля.</p>
<section id="a"></section>
<section class="b" id="b"></section>
<script>
  let textA = '';
  function renderA() {
    const input = document.createElement('input');
    input.value = textA;
    input.oninput = () => { textA = input.value; renderA(); };
    const p = document.createElement('p');
    p.textContent = 'Полная замена: символов ' + textA.length + ' (фокус теряется после каждой буквы)';
    document.getElementById('a').replaceChildren(input, p);
  }
  renderA();

  const b = document.getElementById('b');
  const inputB = document.createElement('input');
  const pB = document.createElement('p');
  b.append(inputB, pB);
  function renderB(text) { pB.textContent = 'Точечное обновление: символов ' + text.length; }
  inputB.oninput = () => renderB(inputB.value);
  renderB('');
</script>
</body>
</html>
```

</details>

Если всё же нужна полная замена с полем ввода — запомните перед отрисовкой, какой элемент был в фокусе
(по `id` или `data-key`) и `selectionStart`/`selectionEnd`, а после — восстановите.

## 4. `<dialog>`: модальные окна по-настоящему

Модальное окно, собранное из `<div>`, требует: затемнения, блокировки фона, ловушки фокуса, закрытия по
Esc, возврата фокуса, роли `dialog` для экранных чтецов. Элемент `<dialog>` даёт всё это из коробки
(во всех движках с 2022 года).

| Метод / атрибут | Что даёт |
|---|---|
| `dialog.showModal()` | модальный режим: верхний слой, `::backdrop`, всё остальное **инертно**, Esc закрывает |
| `dialog.show()` | немодальный: просто показывает, фон доступен |
| `dialog.close(value)` | закрывает, `returnValue = value`, событие `close` |
| `<form method="dialog">` | отправка формы закрывает диалог, `returnValue` = `value` нажатой кнопки |
| атрибут `open` | только отражает состояние; ставить его руками ≈ `show()`, без модальности |
| событие `cancel` | Esc (отменяемо через `preventDefault`, с оговорками), затем `close` |

Ключевые понятия:

- **Верхний слой** (top layer) — отдельный слой отрисовки поверх всего документа. Элемент в нём не
  зависит от `z-index` и `overflow: hidden` предков. Поэтому модальный диалог нельзя «обрезать»
  родителем — вечная беда самодельных модалок.
- **`::backdrop`** — псевдоэлемент сразу под диалогом в верхнем слое; стилизуйте его как затемнение.
- **Инертность** (inert): при `showModal()` всё вне диалога становится инертным — по нему нельзя
  щёлкнуть, перейти Tab-ом, найти через поиск по странице, экранные чтецы его не видят. Тот же эффект
  вручную даёт атрибут `inert` на любом поддереве.
- **Начальный фокус**: при открытии фокус ставится на элемент с `autofocus` внутри диалога, иначе — на
  первый фокусируемый (поведение уточнялось; надёжнее явно указать `autofocus`).
- **Возврат фокуса**: при закрытии браузеры возвращают фокус элементу, который был в фокусе до
  `showModal()`.

Закрытие по щелчку на фоне не встроено (в новых браузерах есть атрибут `closedby="any"`, но он ещё не
везде). Классический приём: щелчок по `::backdrop` приходит в сам `<dialog>` как `target`.

```js
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close('backdrop'); });
```

Чтобы это работало, содержимое должно занимать всю площадь диалога (обёртка с `padding`, а у самого
`dialog` — `padding: 0`), иначе щелчок по внутреннему отступу тоже даст `target === dialog`.

<details>
<summary>Модальный диалог с формой и returnValue</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-ui.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; }
  dialog { padding: 0; border: 2px solid #1565c0; border-radius: 8px; }
  dialog::backdrop { background: rgb(0 0 0 / 0.45); backdrop-filter: blur(2px); }
  dialog form { padding: 16px; display: grid; gap: 10px; min-width: 260px; }
  menu { display: flex; gap: 8px; justify-content: end; padding: 0; margin: 0; }
  .clip { overflow: hidden; height: 40px; border: 2px dashed #c62828; padding: 6px; position: relative; z-index: 1; }
  output { display: block; margin-top: 8px; font: 13px ui-monospace, monospace; }
</style>
</head>
<body>
<div class="clip">Родитель с overflow:hidden и z-index — <button id="open">Открыть диалог</button></div>
<p>Попробуйте: Tab по фону, Esc, щелчок по затемнению, кнопки.</p>
<a href="#">ссылка на фоне (станет инертной)</a>
<output id="out"></output>
<dialog id="dlg">
  <form method="dialog">
    <strong>Удалить файл?</strong>
    <label>Причина <input name="why" autofocus></label>
    <menu>
      <button value="cancel" formnovalidate>Отмена</button>
      <button value="ok">Удалить</button>
    </menu>
  </form>
</dialog>
<script>
  const dlg = document.getElementById('dlg'), out = document.getElementById('out');
  document.querySelector('.clip').append(dlg);
  document.getElementById('open').onclick = () => { dlg.returnValue = ''; dlg.showModal(); };
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('backdrop'); });
  dlg.addEventListener('close', () => {
    out.textContent = 'returnValue = ' + JSON.stringify(dlg.returnValue) +
      '; фокус вернулся на: ' + document.activeElement.textContent;
  });
</script>
</body>
</html>
```

</details>

Обратите внимание: диалог намеренно вложен в элемент с `overflow: hidden`, но не обрезан — верхний
слой выше любой иерархии наложения (stacking context).

## 5. Popover API

Атрибут `popover` (Baseline с 2024 года) делает любой элемент «всплывающим»: подсказки, меню,
уведомления. Тоже верхний слой, но **без** инертности фона.

```html
<button popovertarget="menu">Меню</button>
<div id="menu" popover>…</div>
```

| | `popover` / `popover="auto"` | `popover="manual"` | `<dialog>` + `showModal()` |
|---|---|---|---|
| Верхний слой | да | да | да |
| Лёгкое закрытие (light dismiss): щелчок снаружи, Esc | да | нет | Esc — да |
| Закрывает другие `auto`-поповеры | да (кроме вложенных) | нет | — |
| Фон инертен | нет | нет | да |
| Нужен JavaScript | нет | нет (`popovertarget`) | да (`showModal`) |

Также доступны `popovertargetaction="show|hide|toggle"`, методы `showPopover()`, `hidePopover()`,
`togglePopover()`, событие `toggle` (с `newState`/`oldState`) и псевдокласс `:popover-open`. Связь
кнопки и поповера даёт экранным чтецам `aria-expanded` автоматически, а при закрытии фокус
возвращается на кнопку.

Позиционирование: по умолчанию поповер центрируется в окне (UA-стили: `position: fixed; inset: 0;
margin: auto`). Привязать к кнопке позволяет CSS Anchor Positioning (`anchor-name`, `position-anchor`)
— он поддерживается не везде, поэтому в примере используется расчёт через `getBoundingClientRect`.

<details>
<summary>Поповер-меню с лёгким закрытием</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-ui.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; }
  [popover] { margin: 0; padding: 6px; border: 2px solid #6a1b9a; border-radius: 6px; }
  [popover] button { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 6px 10px; }
  [popover] button:hover, [popover] button:focus-visible { background: #f3e5f5; }
  #toast { inset: auto 16px 16px auto; background: #e8f5e9; border-color: #2e7d32; }
  output { display: block; margin-top: 8px; font: 13px ui-monospace, monospace; }
</style>
</head>
<body>
<p>Откройте меню и щёлкните мимо или нажмите Esc. Уведомление (manual) само не закрывается.</p>
<button id="btn" popovertarget="menu">Действия ▾</button>
<button popovertarget="toast" popovertargetaction="show">Показать уведомление</button>
<div id="menu" popover>
  <button>Переименовать</button><button>Дублировать</button><button>Удалить</button>
</div>
<div id="toast" popover="manual">Сохранено <button popovertarget="toast" popovertargetaction="hide">×</button></div>
<output id="out"></output>
<script>
  const menu = document.getElementById('menu'), btn = document.getElementById('btn');
  menu.addEventListener('toggle', (e) => {
    document.getElementById('out').textContent = 'toggle: ' + e.oldState + ' → ' + e.newState;
    if (e.newState === 'open') {
      const r = btn.getBoundingClientRect();
      menu.style.left = r.left + 'px';
      menu.style.top = r.bottom + 4 + 'px';
    }
  });
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('button');
    if (!item) return;
    document.getElementById('out').textContent = 'выбрано: ' + item.textContent;
    menu.hidePopover();
  });
</script>
</body>
</html>
```

</details>

## 6. Управление фокусом

Фокус — это «курсор» клавиатуры и экранного чтеца. Интерфейс, который его теряет, непригоден без мыши.
Правила:

1. **Открыли что-то — переведите фокус внутрь**: в диалог, на заголовок новой страницы при навигации в
   одностраничном приложении, на первое поле с ошибкой после отправки формы.
2. **Закрыли — верните фокус** туда, откуда пришли. `<dialog>` и `popover` делают это сами;
   самодельным компонентам нужно запомнить `document.activeElement` перед открытием.
3. **Удалили элемент с фокусом — переведите фокус на соседа.** Иначе фокус падает на `<body>`, и
   пользователь клавиатуры оказывается в начале страницы.
4. Чтобы сфокусировать неинтерактивный элемент (заголовок, контейнер), дайте ему `tabindex="-1"`: он
   станет фокусируемым программно, но не попадёт в порядок Tab. Положительный `tabindex` (`1`, `2`…)
   ломает естественный порядок — не используйте.
5. `el.focus({ preventScroll: true })` — не прокручивать к элементу; `focusVisible: true` — попросить
   показать кольцо (поддержка неполная).

<details>
<summary>Удаление с переносом фокуса</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-ui.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  li { display: flex; gap: 8px; padding: 3px; }
  button:focus-visible { outline: 3px solid #e65100; outline-offset: 2px; }
  h2:focus { outline: 2px dashed #1565c0; }
</style>
</head>
<body>
<p>Перейдите Tab-ом к кнопкам «Удалить» и нажимайте Enter. Фокус переходит на соседа, а в конце — на заголовок.</p>
<h2 id="title" tabindex="-1">Файлы</h2>
<ul id="list"></ul>
<script>
  const list = document.getElementById('list');
  for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.textContent = 'Удалить';
    b.setAttribute('aria-label', 'Удалить ' + name);
    li.append(name, b);
    list.append(li);
  }
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const li = btn.closest('li');
    const next = (li.nextElementSibling || li.previousElementSibling);
    li.remove();
    (next ? next.querySelector('button') : document.getElementById('title')).focus();
  });
</script>
</body>
</html>
```

</details>

## 7. Формы и `FormData`

Форма — уже готовая модель данных. Не нужно читать каждое поле по `id`:

```js
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(form, e.submitter);   // submitter: учесть name/value нажатой кнопки
  const obj = Object.fromEntries(data);           // { email: '…', plan: 'pro' }
  const tags = data.getAll('tag');                // повторяющиеся имена (чекбоксы) — массивом
  await fetch('/api', { method: 'POST', body: data });  // multipart/form-data, файлы включены
});
```

Детали, которые стоит знать:

- В `FormData` попадают только поля **с атрибутом `name`**, не `disabled`, и только отмеченные
  чекбоксы/радио. Неотмеченный чекбокс отсутствует вовсе — проверяйте `data.has('agree')`.
- `Object.fromEntries` теряет повторы: для них — `getAll`.
- `new URLSearchParams(data)` превратит форму в `application/x-www-form-urlencoded` (без файлов).
- **Встроенная валидация**: `required`, `type="email"`, `pattern`, `min`/`max`, `minlength`. Событие
  `submit` вообще не наступит, пока форма невалидна (если нет `novalidate`). Проверить вручную —
  `form.checkValidity()` / `reportValidity()`; своя ошибка — `input.setCustomValidity('текст')`
  (пустая строка снимает).
- `:user-invalid` (Baseline 2023) подсвечивает ошибку только **после** взаимодействия с полем, в
  отличие от `:invalid`, который краснит пустую форму сразу.
- `form.submit()` **не** запускает событие `submit` и валидацию. `form.requestSubmit(button?)` —
  запускает, как настоящее нажатие.
- Enter в текстовом поле отправляет форму (неявная отправка, implicit submission), если в ней есть
  кнопка отправки — ещё одна причина использовать `<form>`, а не `<div>` с кнопкой.

<details>
<summary>FormData, валидация и :user-invalid</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-ui.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  form { display: grid; gap: 8px; max-width: 320px; }
  input:user-invalid { border: 2px solid #c62828; background: #ffebee; }
  pre { background: #f5f5f5; padding: 8px; font-size: 12px; }
</style>
</head>
<body>
<form id="f">
  <label>Почта <input name="email" type="email" required></label>
  <label>Имя (латиница) <input name="nick" pattern="[a-z]{3,}" required></label>
  <fieldset><legend>Теги</legend>
    <label><input type="checkbox" name="tag" value="js" checked> js</label>
    <label><input type="checkbox" name="tag" value="css"> css</label>
  </fieldset>
  <label><input type="checkbox" name="agree"> согласен</label>
  <input name="ignored" value="без name не бывает" disabled>
  <div><button name="plan" value="free">Бесплатно</button> <button name="plan" value="pro">Pro</button></div>
</form>
<pre id="out">Заполните и отправьте. Поля краснеют только после взаимодействия.</pre>
<script>
  const f = document.getElementById('f');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(f, e.submitter);
    document.getElementById('out').textContent =
      'fromEntries: ' + JSON.stringify(Object.fromEntries(data), null, 1) +
      '\ngetAll(tag): ' + JSON.stringify(data.getAll('tag')) +
      '\nhas(agree): ' + data.has('agree');
  });
</script>
</body>
</html>
```

</details>

Второй аргумент конструктора `FormData(form, submitter)` поддерживается браузерами с 2022–2023 годов;
без него значение нажатой кнопки в данные не попадёт.

## 8. Debounce, throttle и отмена устаревших запросов

Поиск «по мере ввода» без защиты отправит запрос на каждую букву. Два инструмента:

- **debounce** («подождать тишины») — вызвать функцию, когда события перестали приходить на N мс.
  Для поиска, автосохранения, валидации на сервере.
- **throttle** («не чаще чем») — вызывать не чаще раза в N мс (или раз за кадр через
  `requestAnimationFrame`). Для прокрутки, `pointermove`, `resize`.

```js
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
```

Debounce уменьшает число запросов, но **не решает гонку**: ответ на «ja» может прийти позже ответа на
«java» и затереть его. Нужна отмена устаревших запросов:

```js
let ctrl;
async function search(q) {
  ctrl?.abort();                       // предыдущий запрос больше не нужен
  ctrl = new AbortController();
  try {
    const res = await fetch('/s?q=' + encodeURIComponent(q), { signal: ctrl.signal });
    render(await res.json());
  } catch (e) {
    if (e.name !== 'AbortError') showError(e);
  }
}
```

Если отменить нельзя (не `fetch`), используйте счётчик запросов: запомните номер, а ответ с номером
меньше текущего проигнорируйте.

Совет по удобству: для ввода с IME дождитесь `compositionend`, а событие `input` — с
`e.isComposing === true` — пропускайте.

<details>
<summary>Debounce и гонка ответов</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-ui.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  input { font-size: 16px; width: 260px; }
  label { display: block; margin: 6px 0; }
  ol { font: 12px ui-monospace, monospace; max-height: 160px; overflow: auto; }
  .res { padding: 6px; border: 2px solid #2e7d32; margin-top: 6px; }
</style>
</head>
<body>
<label><input type="checkbox" id="deb" checked> debounce 300 мс</label>
<label><input type="checkbox" id="abort" checked> отменять устаревшие запросы</label>
<input id="q" placeholder="быстро напечатайте слово">
<div class="res" id="res">Результат: —</div>
<ol id="log"></ol>
<script>
  // Имитация сервера: короткие запросы отвечают медленнее, чтобы показать гонку.
  function fakeFetch(q, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve('результаты для «' + q + '»'), 900 - Math.min(q.length, 8) * 100);
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('abort', 'AbortError')); });
    });
  }
  const log = (s) => { const li = document.createElement('li'); li.textContent = s; document.getElementById('log').prepend(li); };
  let ctrl = null, timer;
  async function search(q) {
    if (document.getElementById('abort').checked && ctrl) ctrl.abort();
    const my = ctrl = new AbortController();
    log('запрос «' + q + '»');
    try {
      const r = await fakeFetch(q, my.signal);
      document.getElementById('res').textContent = 'Результат: ' + r;
      log('ответ «' + q + '»');
    } catch (e) { log('отменён «' + q + '»'); }
  }
  document.getElementById('q').addEventListener('input', (e) => {
    const q = e.target.value;
    if (!document.getElementById('deb').checked) return search(q);
    clearTimeout(timer);
    timer = setTimeout(() => search(q), 300);
  });
</script>
</body>
</html>
```

</details>

Выключите обе галочки и напечатайте слово быстро: последний «Результат» окажется от короткого
префикса, потому что он ответил позже. Это и есть гонка.

## 9. Состояния загрузки и ошибки

Асинхронные данные — это не «есть / нет», а минимум четыре состояния. Моделируйте их явно, одним полем,
а не набором флагов `isLoading`/`hasError`/`data`, которые могут противоречить друг другу:

```js
// state.users: { status: 'idle' } | { status: 'loading' } |
//              { status: 'ok', data } | { status: 'error', error }
```

| Состояние | Что показывать | Нюанс |
|---|---|---|
| `idle` | приглашение или ничего | до первого запроса |
| `loading` | индикатор **с задержкой** ~300 мс | быстрые ответы не должны «мигать» спиннером |
| `ok` | данные; отдельно — пустой результат | «ничего не найдено» — тоже состояние |
| `error` | понятный текст + «Повторить» | не терять введённые пользователем данные |

Доступность: область, где появляется статус, помечают `aria-live="polite"` (или `role="status"`), чтобы
экранный чтец объявил «Загрузка…» и «Ошибка». Кнопку на время отправки — `disabled` или
`aria-disabled="true"` (вторая не убирает её из порядка фокуса). Атрибут `aria-busy="true"` на
обновляемой области просит не зачитывать её до конца обновления.

При повторной загрузке, когда старые данные уже есть, обычно лучше **оставить их видимыми** и показать
небольшой индикатор, а не заменять всё спиннером («stale-while-revalidate» на уровне интерфейса).

## 10. Оптимистичный интерфейс

Пользователь поставил лайк — сервер ответит через 300 мс или 3 секунды. Оптимистичный интерфейс
(optimistic UI) **сразу** показывает результат, а при ошибке откатывает:

```js
async function toggleLike(id) {
  const prev = store.get().likes[id];
  store.set(s => ({ likes: { ...s.likes, [id]: !prev } }));   // сразу
  try {
    await api.like(id, !prev);
  } catch {
    store.set(s => ({ likes: { ...s.likes, [id]: prev } }));  // откат
    toast('Не удалось сохранить, попробуйте ещё раз');
  }
}
```

Когда это уместно: действие почти всегда успешно, легко обратимо и дёшево (лайк, галочка, порядок в
списке). Когда нет: оплата, удаление без корзины, всё, где «показалось, что сделано» вредит.

Подводные камни:

- быстрые повторные нажатия: два запроса в полёте, второй ответ приходит первым. Решения — блокировать
  повтор до ответа, отправлять **итоговое** значение (а не «переключить»), сравнивать версии;
- откат должен восстанавливать то, что было **на момент** действия, а не перезаписывать изменения,
  сделанные позже.

<details>
<summary>Оптимистичный лайк с откатом</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-ui.html#example-9">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; }
  .like { font-size: 18px; padding: 6px 14px; border: 2px solid #c62828; border-radius: 20px; background: #fff; }
  .like[aria-pressed="true"] { background: #c62828; color: #fff; }
  .like.pending { opacity: 0.7; }
  #status { min-height: 1.4em; margin-top: 8px; }
  #status.err { color: #c62828; }
</style>
</head>
<body>
<label><input type="checkbox" id="fail"> сервер отвечает ошибкой</label>
<p><button class="like" id="like" aria-pressed="false">♥ <span id="n">10</span></button></p>
<div id="status" role="status" aria-live="polite"></div>
<script>
  const state = { liked: false, count: 10, pending: false, error: '' };
  const api = (liked) => new Promise((ok, fail) =>
    setTimeout(() => document.getElementById('fail').checked ? fail(new Error('500')) : ok(liked), 1200));
  function render() {
    const b = document.getElementById('like');
    b.setAttribute('aria-pressed', state.liked);
    b.classList.toggle('pending', state.pending);
    document.getElementById('n').textContent = state.count;
    const s = document.getElementById('status');
    s.textContent = state.error || (state.pending ? 'Сохраняем…' : '');
    s.className = state.error ? 'err' : '';
  }
  document.getElementById('like').onclick = async () => {
    if (state.pending) return;
    const prev = { liked: state.liked, count: state.count };
    Object.assign(state, { liked: !prev.liked, count: prev.count + (prev.liked ? -1 : 1), pending: true, error: '' });
    render();
    try { await api(state.liked); }
    catch { Object.assign(state, prev, { error: 'Не удалось сохранить, вернули как было' }); }
    state.pending = false;
    render();
  };
  render();
</script>
</body>
</html>
```

</details>

## 11. Собираем всё вместе

Маленькое приложение по образцу всего вышесказанного: хранилище с пакетной перерисовкой, `h()`,
делегирование, явные состояния загрузки, диалог подтверждения, перенос фокуса.

<details>
<summary>Мини-приложение: заметки</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-ui.html#example-10">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; max-width: 420px; }
  form { display: flex; gap: 6px; }
  input { flex: 1; font-size: 15px; }
  li { display: flex; justify-content: space-between; padding: 4px; border-bottom: 1px solid #ddd; }
  .muted { color: #888; }
  dialog { border: 2px solid #c62828; border-radius: 8px; }
  dialog::backdrop { background: rgb(0 0 0 / 0.4); }
</style>
</head>
<body>
<div id="app"></div>
<dialog id="confirm"><form method="dialog">
  <p>Удалить заметку «<span id="what"></span>»?</p>
  <button value="no" autofocus>Отмена</button> <button value="yes">Удалить</button>
</form></dialog>
<script>
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c);
    return el;
  }
  let state = { status: 'loading', notes: [] }, queued = false;
  function set(patch) {
    state = { ...state, ...patch };
    if (!queued) { queued = true; queueMicrotask(() => { queued = false; render(); }); }
  }
  function render() {
    const app = document.getElementById('app');
    const hadFocus = document.activeElement && document.activeElement.id === 'new';
    app.replaceChildren(
      h('h2', { id: 'title', tabindex: '-1' }, 'Заметки (' + state.notes.length + ')'),
      h('form', { onsubmit: add }, h('input', { id: 'new', name: 'text', required: true, placeholder: 'текст', autocomplete: 'off' }), h('button', null, 'Добавить')),
      state.status === 'loading' ? h('p', { class: 'muted', role: 'status' }, 'Загрузка…')
        : state.notes.length === 0 ? h('p', { class: 'muted' }, 'Пока пусто')
        : h('ul', { onclick: onList }, state.notes.map(n =>
            h('li', { 'data-id': n.id }, n.text, h('button', { 'aria-label': 'Удалить ' + n.text }, '×'))))
    );
    if (hadFocus) document.getElementById('new').focus();
  }
  function add(e) {
    e.preventDefault();
    const text = new FormData(e.target).get('text').trim();
    if (text) set({ notes: [...state.notes, { id: Date.now(), text }] });
  }
  function onList(e) {
    const li = e.target.closest('button') && e.target.closest('li');
    if (!li) return;
    const note = state.notes.find(n => n.id === +li.dataset.id);
    const dlg = document.getElementById('confirm');
    document.getElementById('what').textContent = note.text;
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'yes') return;
      set({ notes: state.notes.filter(n => n !== note) });
      queueMicrotask(() => queueMicrotask(() => document.getElementById('title').focus()));
    }, { once: true });
  }
  render();
  setTimeout(() => set({ status: 'ok', notes: [{ id: 1, text: 'Купить хлеб' }, { id: 2, text: 'Прочитать курс' }] }), 700);
</script>
</body>
</html>
```

</details>

## Итог

- Состояние — единственный источник истины; обработчики меняют состояние, `render` строит DOM.
- `h()` с текстовыми узлами вместо `innerHTML` закрывает XSS; свойства (`checked`, `value`) — живое
  состояние, атрибуты — начальное.
- Пакетируйте перерисовки (`queueMicrotask`/`requestAnimationFrame`); полная замена проста, но теряет
  фокус — для полей ввода нужна точечная или ключевая стратегия.
- `<dialog>` + `showModal()`: верхний слой, `::backdrop`, инертный фон, Esc, `returnValue`, возврат
  фокуса — бесплатно.
- `popover`: верхний слой и лёгкое закрытие без JavaScript, но фон не инертен.
- Фокус: внутрь при открытии, обратно при закрытии, к соседу при удалении; `tabindex="-1"` для
  программного фокуса.
- `FormData(form, submitter)`, `getAll` для повторов, `requestSubmit()` вместо `submit()`,
  `:user-invalid`.
- Debounce уменьшает число запросов, `AbortController` убирает гонки.
- Явные состояния `idle/loading/ok/error`, спиннер с задержкой, `aria-live` для статуса.
- Оптимистичный интерфейс — для частых, обратимых действий, с аккуратным откатом.

## Проверьте себя

1. Почему после снятия галочки `input.getAttribute('checked')` всё ещё возвращает `""`?
2. Что произойдёт, если в `h()` присвоить `value` у `<select>` до добавления `<option>`?
3. Чем модальный `<dialog>` отличается от элемента с атрибутом `popover` с точки зрения клавиатуры и
   экранного чтеца?
4. Модальное окно лежит внутри блока с `overflow: hidden; z-index: 1`. Почему оно не обрезается?
5. Вы используете debounce в поиске. Почему результаты всё равно иногда «скачут» и как это исправить?
6. Какие две ошибки легко допустить при откате оптимистичного обновления?

Дальше: [Хранилища браузера](LEARN_JAVASCRIPT_STORAGE_COURSE.md).
