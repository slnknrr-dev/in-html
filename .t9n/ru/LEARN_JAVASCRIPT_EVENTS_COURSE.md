# События

> Курс 35 из программы. Для тех, кто уже умеет находить элементы селекторами
> ([Селекторы в JavaScript](LEARN_JAVASCRIPT_SELECTORS_COURSE.md)) и хочет понимать, **как событие
> путешествует по дереву**, почему один обработчик на списке лучше тысячи на пунктах и откуда берутся
> «утечки слушателей».

**Что вы будете понимать после курса**

- три фазы распространения события (capture → target → bubble) и как их увидеть своими глазами;
- все параметры `addEventListener`: `capture`, `once`, `passive`, `signal` — и зачем каждый появился;
- делегирование событий через `closest()` и где оно ломается;
- разницу между `preventDefault`, `stopPropagation` и `stopImmediatePropagation`;
- что такое действие по умолчанию (default action) и почему его отменяют не все события;
- `event.target` против `event.currentTarget`, а также `composedPath()`;
- клавиатуру: `key` против `code`, ввод через IME и `isComposing`;
- единую модель Pointer Events вместо раздельных мыши и касаний;
- события фокуса: почему `focus`/`blur` не всплывают, а `focusin`/`focusout` всплывают;
- собственные события (`CustomEvent`), доверенные события (`isTrusted`) и уборку слушателей через
  `AbortController`.

---

## 1. Что такое событие в DOM

Событие (event) — это объект, который браузер (или ваш код) **отправляет** (dispatch) в конкретный узел
дерева. У объекта есть тип (`type`: `"click"`, `"keydown"`…), цель (`target`) и набор флагов. Слушатель
(event listener) — функция, зарегистрированная на узле для определённого типа.

Важная мысль: событие отправляется **в один узел**, но слушатели срабатывают **на целом пути** от
`window` до этого узла и обратно. Этот путь (event path) вычисляется **один раз в момент отправки**:
если обработчик удалит элемент из дерева, событие всё равно пройдёт по исходному пути.

```js
button.addEventListener('click', (event) => {
  console.log(event.type, event.target, event.currentTarget, event.eventPhase);
});
```

Старый способ — свойство `button.onclick = fn` или атрибут `onclick="..."`. У него ровно один слот:
второе присваивание затирает первое. `addEventListener` позволяет сколько угодно слушателей и даёт
параметры. Атрибуты `on*` в HTML ещё и выполняются как строка кода в странной области видимости
(с `with`-подобным доступом к `form` и `document`) и запрещаются строгой CSP без `'unsafe-inline'`.

## 2. Три фазы: capture, target, bubble

Спецификация DOM описывает отправку так:

| Фаза | `eventPhase` | Куда идёт | Кто срабатывает |
|---|---|---|---|
| Погружение (capturing phase) | `1` | от `window` вниз к родителю цели | слушатели с `capture: true` |
| На цели (at target) | `2` | сама цель | все слушатели цели, в порядке регистрации |
| Всплытие (bubbling phase) | `3` | от родителя цели вверх к `window` | слушатели без `capture` |

Подробности, которые часто путают:

- **Не все события всплывают.** Флаг `event.bubbles` говорит, будет ли фаза 3. `focus`, `blur`,
  `mouseenter`, `mouseleave`, `load` на элементах, `scroll` на элементах — не всплывают. Но **фаза
  погружения есть всегда**: поэтому слушатель с `capture: true` на предке поймает даже `focus`.
- На самой цели раньше слушатели вызывались строго в порядке регистрации, независимо от `capture`.
  Сейчас Chrome и Firefox (с 2021–2022 годов) вызывают на цели сначала capture-слушатели, потом
  остальные. Не стройте логику на этом порядке.
- Путь включает `document` и `window` (для большинства событий).

<details>
<summary>Живая трассировка фаз</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-events.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  div { padding: 16px; border: 2px solid; margin: 4px; }
  #outer { border-color: #c62828; background: #ffebee; }
  #middle { border-color: #1565c0; background: #e3f2fd; }
  #inner { border-color: #2e7d32; background: #e8f5e9; cursor: pointer; }
  ol { font: 13px ui-monospace, monospace; }
  .cap { color: #6a1b9a; } .bub { color: #e65100; } .tgt { color: #2e7d32; font-weight: bold; }
</style>
</head>
<body>
<p>Щёлкните по зелёному блоку (или по синему) и посмотрите порядок.</p>
<div id="outer">outer<div id="middle">middle<div id="inner">inner</div></div></div>
<button id="clear">Очистить</button>
<ol id="log"></ol>
<script>
  const log = document.getElementById('log');
  const names = { 1: 'capture', 2: 'target', 3: 'bubble' };
  function note(where, e) {
    const li = document.createElement('li');
    li.className = e.eventPhase === 1 ? 'cap' : e.eventPhase === 2 ? 'tgt' : 'bub';
    li.textContent = where + ' — ' + names[e.eventPhase];
    log.append(li);
  }
  for (const id of ['outer', 'middle', 'inner']) {
    const el = document.getElementById(id);
    el.addEventListener('click', (e) => note(id, e), { capture: true });
    el.addEventListener('click', (e) => note(id, e));
  }
  document.getElementById('clear').onclick = () => log.replaceChildren();
</script>
</body>
</html>
```

</details>

Щелчок по `inner` даёт: `outer capture`, `middle capture`, затем дважды `inner target`, затем
`middle bubble`, `outer bubble`. Обратите внимание: на цели оба слушателя показывают фазу `2`, хотя один
из них зарегистрирован с `capture`.

### 2.1. Зачем вообще погружение

Погружение — способ **перехватить** событие раньше всех. Типичные применения:

- закрыть выпадающее меню по щелчку где угодно, даже если внутренний код вызвал `stopPropagation`;
- логирование и аналитика «до всех»;
- ловля невсплывающих событий (`focus`, `scroll`, `load` картинок) одним слушателем на предке.

```js
// Поймать load любой картинки на странице: load не всплывает, но погружается.
document.addEventListener('load', (e) => {
  if (e.target.tagName === 'IMG') e.target.classList.add('ready');
}, true);
```

## 3. Параметры `addEventListener`

Третий аргумент — либо `true`/`false` (старая форма, означает `capture`), либо объект:

| Параметр | По умолчанию | Смысл |
|---|---|---|
| `capture` | `false` | слушать на фазе погружения |
| `once` | `false` | автоматически удалить после первого вызова |
| `passive` | `false`* | обещание не вызывать `preventDefault()` |
| `signal` | — | `AbortSignal`: когда он прерван, слушатель удаляется |

\* Исключение: для `touchstart`, `touchmove`, `wheel`, `mousewheel` на `window`, `document` и `body`
браузеры по умолчанию считают `passive: true` (вмешательство ради прокрутки, Chrome 56+, затем
остальные).

### 3.1. Идентичность слушателя

Слушатель определяется тройкой **(тип, функция, capture)**. Отсюда две классические ошибки:

```js
el.addEventListener('click', () => go());       // анонимная функция
el.removeEventListener('click', () => go());    // ДРУГАЯ функция — ничего не удалит

el.addEventListener('click', go, true);
el.removeEventListener('click', go);            // capture не совпал — ничего не удалит
```

Повторный `addEventListener` с той же тройкой **не добавляет** второй экземпляр. `once`, `passive`
и `signal` в идентичность не входят.

### 3.2. `passive` и прокрутка

Пока выполняется слушатель `touchmove` или `wheel`, браузер не знает, отменит ли он прокрутку. Значит,
композитор вынужден ждать главный поток. `passive: true` снимает ожидание: прокрутка идёт сразу, а
вызов `preventDefault()` внутри просто игнорируется (с предупреждением в консоли).

Если вам действительно нужно запретить жест — лучше объявить это в CSS: `touch-action: none` (или
`pan-y`) на элементе. Браузер узнаёт о запрете **до** события и не ждёт JavaScript.

### 3.3. `signal` — уборка одной строкой

```js
const ctrl = new AbortController();
window.addEventListener('resize', onResize, { signal: ctrl.signal });
document.addEventListener('keydown', onKey, { signal: ctrl.signal });
el.addEventListener('pointermove', onMove, { signal: ctrl.signal });
// …компонент уничтожается:
ctrl.abort(); // все три слушателя сняты, ссылки на функции хранить не нужно
```

Подробнее об утечках — в разделе 12.

<details>
<summary>once, passive и signal в действии</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-events.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  button { margin: 4px; padding: 6px 12px; }
  #box { height: 120px; overflow: auto; border: 2px solid #1565c0; margin-top: 8px; }
  #box div { height: 400px; background: linear-gradient(#e3f2fd, #1565c0); }
  output { display: block; font: 13px ui-monospace, monospace; margin-top: 8px; white-space: pre; }
</style>
</head>
<body>
<button id="one">Сработаю один раз (once)</button>
<button id="arm">Включить счётчик колеса</button>
<button id="stop">Снять счётчик (abort)</button>
<div id="box"><div></div></div>
<output id="out">Прокрутите колесом синий блок после включения счётчика.</output>
<script>
  const out = document.getElementById('out');
  document.getElementById('one').addEventListener('click', () => {
    out.textContent = 'once: слушатель уже удалён, второй щелчок ничего не сделает';
  }, { once: true });
  let ctrl = null, n = 0;
  document.getElementById('arm').onclick = () => {
    if (ctrl) return;
    ctrl = new AbortController();
    document.getElementById('box').addEventListener('wheel', () => {
      out.textContent = 'wheel (passive): ' + (++n);
    }, { passive: true, signal: ctrl.signal });
    out.textContent = 'Счётчик включён';
  };
  document.getElementById('stop').onclick = () => {
    if (ctrl) { ctrl.abort(); ctrl = null; out.textContent = 'Слушатель снят через AbortController'; }
  };
</script>
</body>
</html>
```

</details>

## 4. `target`, `currentTarget` и путь события

- `event.target` — узел, **в который** отправлено событие (самый глубокий элемент под курсором).
- `event.currentTarget` — узел, **чей** слушатель выполняется прямо сейчас. Внутри обычной функции
  это то же, что `this`; в стрелочной функции `this` не привязан, используйте `currentTarget`.
- `event.composedPath()` — массив узлов пути, от цели до `window`.

`currentTarget` существует только во время отправки: после неё он равен `null`. Если вы сохранили
событие и смотрите на него в `setTimeout` или в консоли — увидите `null`. Это не баг.

Ещё одна тонкость — Shadow DOM: для слушателя снаружи теневого дерева `target` **перенацеливается**
(retargeting) на хозяина (host), чтобы не раскрывать внутренности компонента. `composedPath()` при
открытом корне (`mode: 'open'`) покажет настоящий путь. Событие вообще выходит за границу теневого
дерева, только если у него `composed: true` (у встроенных UI-событий так и есть).

<details>
<summary>target против currentTarget</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-events.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  ul { border: 2px dashed #6a1b9a; padding: 12px 32px; width: 280px; }
  li { padding: 6px; margin: 4px 0; background: #f3e5f5; }
  b { color: #c62828; }
  output { font: 13px ui-monospace, monospace; white-space: pre; display: block; }
</style>
</head>
<body>
<p>Щёлкните по слову внутри пункта, по пункту и по пустому месту списка.</p>
<ul id="list">
  <li>Пункт <b>с жирным</b> словом</li>
  <li>Обычный пункт</li>
</ul>
<output id="out"></output>
<script>
  document.getElementById('list').addEventListener('click', (e) => {
    document.getElementById('out').textContent =
      'target:        <' + e.target.tagName.toLowerCase() + '>\n' +
      'currentTarget: <' + e.currentTarget.tagName.toLowerCase() + '>\n' +
      'path: ' + e.composedPath().map(n => n.nodeName || 'window').join(' → ');
  });
</script>
</body>
</html>
```

</details>

## 5. Делегирование событий

Вместо слушателя на каждом из тысячи пунктов — **один** слушатель на общем предке. Всплытие доставит
ему щелчок по любому потомку, а `closest()` найдёт «интересный» элемент:

```js
list.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn || !list.contains(btn)) return;   // щелчок мимо или по кнопке вне списка
  actions[btn.dataset.action](btn.closest('li'));
});
```

Почему `closest`, а не `e.target.matches(...)`: цель — самый глубокий узел. Внутри кнопки может быть
`<svg>`, `<span>` с иконкой — и `target` окажется ими. `closest` поднимается от цели вверх, включая её
саму. Проверка `list.contains(btn)` нужна, когда списки вложены или подходящий предок лежит **выше**
слушателя.

Плюсы делегирования:

- одна функция вместо N — меньше памяти и времени на привязку;
- элементы, добавленные позже (после `innerHTML` или перерисовки), работают **без** повторной
  привязки;
- нечего отвязывать при удалении элементов.

Где оно ломается:

| Ситуация | Почему | Что делать |
|---|---|---|
| `focus`, `blur`, `mouseenter` | не всплывают | `focusin`/`focusout`, `pointerover`/`pointerout` или capture |
| кто-то вызвал `stopPropagation` | всплытие оборвано | слушать на фазе погружения |
| `pointermove` на большой области | вызывается очень часто, `closest` на каждом | вешать прямо на элемент |
| текстовый узел как цель | у `Text` нет `closest` | в UI-событиях цель — элемент; для своих событий проверяйте `instanceof Element` |

<details>
<summary>Делегирование: список задач</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-events.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  li { display: flex; gap: 8px; align-items: center; padding: 4px; }
  li.done span { text-decoration: line-through; color: #888; }
  button { border: 1px solid #999; background: #fff; border-radius: 4px; padding: 2px 8px; }
  button svg { width: 12px; height: 12px; pointer-events: none; }
</style>
</head>
<body>
<p>Один слушатель на <code>&lt;ul&gt;</code>. Добавленные пункты работают сразу.</p>
<input id="txt" value="Новая задача"> <button id="add">Добавить</button>
<ul id="list">
  <li><span>Прочитать про фазы</span>
    <button data-action="toggle">готово</button>
    <button data-action="remove" aria-label="Удалить"><svg viewBox="0 0 10 10"><path d="M1 1L9 9M9 1L1 9" stroke="#c62828" stroke-width="2"/></svg></button></li>
</ul>
<script>
  const list = document.getElementById('list');
  const tpl = list.firstElementChild.cloneNode(true);
  const actions = {
    toggle: (li) => li.classList.toggle('done'),
    remove: (li) => li.remove(),
  };
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !list.contains(btn)) return;
    actions[btn.dataset.action](btn.closest('li'));
  });
  document.getElementById('add').onclick = () => {
    const li = tpl.cloneNode(true);
    li.querySelector('span').textContent = document.getElementById('txt').value;
    list.append(li);
  };
</script>
</body>
</html>
```

</details>

В примере у `<svg>` стоит `pointer-events: none`: так целью щелчка всегда будет кнопка. Это второй
способ решить проблему «глубокой цели», но `closest` надёжнее — он не зависит от CSS.

## 6. Действие по умолчанию и три способа «остановить» событие

Многие события имеют **действие по умолчанию** (default action): щелчок по ссылке — переход, `submit`
— отправка формы, `keydown` пробела — прокрутка, `contextmenu` — меню, `wheel` — прокрутка, `dragstart`
— начало перетаскивания. Браузер выполняет его **после** отправки события, если никто не отменил.

| Метод | Что делает | Чего не делает |
|---|---|---|
| `preventDefault()` | отменяет действие по умолчанию; `defaultPrevented` → `true` | не останавливает распространение |
| `stopPropagation()` | не пускает событие к **следующим узлам** пути | не отменяет действие по умолчанию; остальные слушатели **этого** узла выполнятся |
| `stopImmediatePropagation()` | как предыдущий + не вызывает оставшиеся слушатели **этого** узла | не отменяет действие по умолчанию |

Подробности:

- `preventDefault()` действует, только если `event.cancelable === true`. У `scroll`, `focus`, `load`,
  `input` (кроме `beforeinput`) отменять нечего.
- `return false` из обработчика отменяет действие только для `on*`-свойств и атрибутов, не для
  `addEventListener`. В jQuery `return false` означало и `preventDefault`, и `stopPropagation` — отсюда
  путаница в старых ответах.
- `stopPropagation` почти всегда — запах кода. Он ломает делегирование, закрытие меню «по щелчку
  снаружи» и аналитику в чужом коде. Лучше проверьте `e.defaultPrevented` или пометьте событие.
- Отменить переход по ссылке на `pointerdown` нельзя: переход привязан к `click`.

<details>
<summary>preventDefault против stopPropagation</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-events.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  .zone { border: 2px solid #1565c0; padding: 16px; background: #e3f2fd; }
  label { display: block; margin: 6px 0; }
  ol { font: 13px ui-monospace, monospace; }
</style>
</head>
<body>
<label><input type="checkbox" id="pd"> вызывать preventDefault()</label>
<label><input type="checkbox" id="sp"> вызывать stopPropagation()</label>
<label><input type="checkbox" id="sip"> вызывать stopImmediatePropagation()</label>
<div class="zone" id="zone">
  <a href="#jumped" id="link">Ссылка на #jumped</a>
</div>
<ol id="log"></ol>
<script>
  const log = (s) => { const li = document.createElement('li'); li.textContent = s; document.getElementById('log').append(li); };
  const link = document.getElementById('link');
  link.addEventListener('click', (e) => {
    log('ссылка: слушатель 1');
    if (pd.checked) e.preventDefault();
    if (sp.checked) e.stopPropagation();
    if (sip.checked) e.stopImmediatePropagation();
  });
  link.addEventListener('click', () => log('ссылка: слушатель 2'));
  document.getElementById('zone').addEventListener('click', (e) => log('zone: всплыло, defaultPrevented=' + e.defaultPrevented));
  addEventListener('hashchange', () => log('переход: hash = ' + location.hash));
</script>
</body>
</html>
```

</details>

## 7. Клавиатура

### 7.1. `key` против `code`

- `event.key` — **что получилось**: символ с учётом раскладки и Shift (`"ф"`, `"A"`, `"!"`) или имя
  (`"Enter"`, `"ArrowLeft"`, `"Escape"`, `" "` для пробела).
- `event.code` — **какая физическая клавиша** нажата, по положению на американской раскладке:
  `"KeyA"`, `"Digit1"`, `"Space"`, `"ShiftLeft"`. Не зависит от раскладки.

Правило выбора: **сочетания и игры (WASD) — по `code`**, ввод текста и смысловые клавиши — по `key`.
Пример: горячая клавиша «Ctrl+Z» по `key` не сработает в русской раскладке (там `key === "я"`), а по
`code === "KeyZ"` сработает. Зато на AZERTY физическая `KeyZ` подписана «W» — за это `code` и критикуют
для текстовых сочетаний. Компромисс: проверять `key`, а при не-латинском символе падать на `code`.

`keyCode`, `which` и `charCode` устарели: их значения различались между браузерами и раскладками.
Событие `keypress` тоже устарело — используйте `keydown` (и `beforeinput` для ввода).

Модификаторы: `ctrlKey`, `shiftKey`, `altKey`, `metaKey` (Cmd на macOS). Повтор при удержании —
`event.repeat === true`.

### 7.2. IME и композиция

Японский, китайский, корейский текст (и многие мобильные клавиатуры) вводится через редактор метода
ввода (IME): человек набирает несколько клавиш, видит подчёркнутый черновик и только потом
подтверждает. Во время черновика идут `compositionstart` → `compositionupdate`… → `compositionend`, а
у `keydown` будет `isComposing === true` (и `key === "Process"` в части браузеров).

Классическая ошибка: «отправлять сообщение по Enter». Японец нажимает Enter, чтобы **подтвердить**
черновик, а сообщение улетает недописанным. Правильно:

```js
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) send();
});
```

(`keyCode === 229` — исторический признак IME, нужен для старого Safari, где `isComposing` у Enter
приходил `false`.)

<details>
<summary>Инспектор клавиш</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-events.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  input { font-size: 18px; padding: 6px; width: 280px; }
  table { border-collapse: collapse; margin-top: 8px; font: 13px ui-monospace, monospace; }
  td, th { border: 1px solid #bbb; padding: 4px 8px; text-align: left; }
</style>
</head>
<body>
<p>Поставьте курсор в поле и понажимайте клавиши в разных раскладках (попробуйте Ctrl+Z в русской).</p>
<input id="i" placeholder="печатайте здесь">
<table>
  <tr><th>key</th><td id="k"></td></tr>
  <tr><th>code</th><td id="c"></td></tr>
  <tr><th>модификаторы</th><td id="m"></td></tr>
  <tr><th>repeat / isComposing</th><td id="r"></td></tr>
  <tr><th>композиция</th><td id="comp">—</td></tr>
</table>
<script>
  const $ = (id) => document.getElementById(id);
  $('i').addEventListener('keydown', (e) => {
    $('k').textContent = JSON.stringify(e.key);
    $('c').textContent = e.code;
    $('m').textContent = ['ctrl', 'shift', 'alt', 'meta'].filter(m => e[m + 'Key']).join('+') || '—';
    $('r').textContent = e.repeat + ' / ' + e.isComposing;
  });
  $('i').addEventListener('compositionstart', () => $('comp').textContent = 'start');
  $('i').addEventListener('compositionupdate', (e) => $('comp').textContent = 'update: ' + e.data);
  $('i').addEventListener('compositionend', (e) => $('comp').textContent = 'end: ' + e.data);
</script>
</body>
</html>
```

</details>

## 8. Pointer Events: одна модель для мыши, пера и пальца

Исторически было два мира: `mouse*` и `touch*`. Касание порождало «эмулированные» события мыши с
задержкой (300 мс ждали двойного тапа), а `TouchEvent` хранил списки пальцев. Pointer Events
объединяют всё: каждый указатель (pointer) имеет `pointerId`, `pointerType` (`"mouse"`, `"pen"`,
`"touch"`), `pressure`, `width`/`height`, наклон пера и т. д.

| Событие | Аналог | Всплывает |
|---|---|---|
| `pointerdown` / `pointerup` | `mousedown` / `mouseup` | да |
| `pointermove` | `mousemove` | да |
| `pointerover` / `pointerout` | `mouseover` / `mouseout` | да |
| `pointerenter` / `pointerleave` | `mouseenter` / `mouseleave` | нет |
| `pointercancel` | `touchcancel` | да |

Ключевые приёмы:

- **`setPointerCapture(pointerId)`** — все дальнейшие события этого указателя идут в элемент, даже если
  палец ушёл за его пределы. Без этого перетаскивание «срывается», когда курсор быстро выскакивает.
- **`touch-action`** в CSS. На сенсорном экране браузер сам решает, что палец — это прокрутка или
  масштаб, и тогда шлёт `pointercancel`. Для области рисования или ползунка задайте
  `touch-action: none`.
- `click` по-прежнему приходит после `pointerup` для основной кнопки — для простых кнопок слушайте
  `click`: он срабатывает и от клавиатуры (Enter/пробел), а `pointerdown` — нет.
- Задержка 300 мс давно убрана на страницах с `<meta name="viewport" content="width=device-width">`.

<details>
<summary>Рисование указателем с захватом</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-events.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  canvas { border: 2px solid #2e7d32; touch-action: none; background: #fafafa; }
  output { display: block; font: 13px ui-monospace, monospace; }
</style>
</head>
<body>
<p>Рисуйте мышью, пером или пальцем. Выведите курсор за рамку, не отпуская: линия не прервётся.</p>
<canvas id="c" width="320" height="180"></canvas>
<output id="o">—</output>
<script>
  const c = document.getElementById('c'), ctx = c.getContext('2d'), o = document.getElementById('o');
  let last = null;
  c.addEventListener('pointerdown', (e) => {
    c.setPointerCapture(e.pointerId);
    last = [e.offsetX, e.offsetY];
  });
  c.addEventListener('pointermove', (e) => {
    o.textContent = e.pointerType + ' #' + e.pointerId + ' давление ' + e.pressure.toFixed(2);
    if (!last) return;
    ctx.lineWidth = 1 + e.pressure * 6;
    ctx.lineCap = 'round';
    ctx.strokeStyle = e.pointerType === 'pen' ? '#6a1b9a' : '#2e7d32';
    ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(e.offsetX, e.offsetY); ctx.stroke();
    last = [e.offsetX, e.offsetY];
  });
  const end = () => { last = null; };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
</script>
</body>
</html>
```

</details>

## 9. События фокуса

| Событие | Всплывает | Когда |
|---|---|---|
| `focus` | нет | элемент получил фокус |
| `blur` | нет | элемент потерял фокус |
| `focusin` | да | то же, что `focus`, но всплывает |
| `focusout` | да | то же, что `blur`, но всплывает |

Порядок при переходе с A на B в современных браузерах: `blur` → `focusout` на A, затем `focus` →
`focusin` на B (спецификация UI Events когда-то описывала иной порядок, и старые браузеры
различались). Надёжный вывод один: **в момент `focusout` фокус ещё не на B**, а у события есть `relatedTarget` — элемент,
который получает фокус (или `null`, если фокус уходит в никуда или в другое окно).

Отсюда стандартный приём: «закрыть панель, когда фокус ушёл **из неё целиком**»:

```js
panel.addEventListener('focusout', (e) => {
  if (!panel.contains(e.relatedTarget)) close();
});
```

`focus`/`blur` не всплывают по историческим причинам: изначально они были событиями окна. Для
делегирования либо `focusin`/`focusout`, либо `addEventListener('focus', fn, true)`.

Не путайте фокус и `:focus-visible`: событие `focus` приходит и от щелчка, а кольцо фокуса браузер
рисует по своей эвристике (клавиатура — да, мышь по кнопке — нет).

<details>
<summary>focus не всплывает, focusin всплывает</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-events.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  fieldset { border: 2px solid #1565c0; padding: 12px; }
  fieldset.inside { background: #e3f2fd; }
  input { display: block; margin: 6px 0; }
  ol { font: 13px ui-monospace, monospace; }
</style>
</head>
<body>
<p>Переходите между полями клавишей Tab и выходите из группы.</p>
<fieldset id="fs"><legend>Группа</legend><input placeholder="A"><input placeholder="B"></fieldset>
<input placeholder="Вне группы">
<ol id="log"></ol>
<script>
  const fs = document.getElementById('fs');
  const log = (s) => { const li = document.createElement('li'); li.textContent = s; document.getElementById('log').prepend(li); };
  fs.addEventListener('focus', () => log('focus на fieldset — сюда никогда не придёт'));
  fs.addEventListener('focusin', (e) => { fs.classList.add('inside'); log('focusin: ' + e.target.placeholder); });
  fs.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    log('focusout: ' + e.target.placeholder + ' → ' + (to ? to.placeholder : 'null'));
    if (!fs.contains(to)) fs.classList.remove('inside');
  });
</script>
</body>
</html>
```

</details>

## 10. Собственные события

```js
const ev = new CustomEvent('cart:add', {
  detail: { id: 42, qty: 1 },   // произвольные данные
  bubbles: true,                // по умолчанию false!
  cancelable: true,             // чтобы слушатель мог сказать «нет»
  composed: false,              // выходить ли из shadow DOM
});
const allowed = button.dispatchEvent(ev);   // false, если кто-то вызвал preventDefault()
if (allowed) addToCart();
```

Отличия от встроенных событий:

- `dispatchEvent` **синхронный**: все слушатели выполнятся до возврата, исключения в слушателях не
  ломают ваш код (сообщаются через `window.onerror`), а возвращаемое значение — это «не отменено».
  Встроенные события браузер ставит в очередь задач (кроме части, вызываемых методами вроде
  `el.focus()`, которые тоже отправляют синхронно).
- По умолчанию `bubbles: false` и `cancelable: false` — забыв это, получите «не работает
  делегирование».
- Имена событий принято снабжать пространством имён (`cart:add`, `app-ready`), чтобы не столкнуться
  с будущими встроенными.

Для обмена сообщениями без DOM есть `EventTarget` как самостоятельный класс:

```js
class Store extends EventTarget {
  set(v) { this.v = v; this.dispatchEvent(new Event('change')); }
}
```

<details>
<summary>CustomEvent с отменой</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-events.html#example-9">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  .card { border: 2px solid #e65100; padding: 12px; width: 260px; }
  output { display: block; margin-top: 8px; font: 13px ui-monospace, monospace; }
</style>
</head>
<body>
<label><input type="checkbox" id="block"> запретить удаление (слушатель вызовет preventDefault)</label>
<div class="card" id="card">Карточка <button id="del">Удалить</button></div>
<output id="out"></output>
<script>
  const card = document.getElementById('card'), out = document.getElementById('out');
  document.body.addEventListener('card:remove', (e) => {
    if (document.getElementById('block').checked) e.preventDefault();
    out.textContent = 'body услышал card:remove, detail.id = ' + e.detail.id;
  });
  document.getElementById('del').addEventListener('click', () => {
    const ok = card.dispatchEvent(new CustomEvent('card:remove', {
      detail: { id: 7 }, bubbles: true, cancelable: true,
    }));
    out.textContent += ok ? '\nудалено' : '\nотменено слушателем';
    if (ok) card.remove();
  });
</script>
</body>
</html>
```

</details>

## 11. Доверенные события

`event.isTrusted === true` только у событий, созданных браузером в ответ на действие пользователя
(или внутренние процессы). У всего, что отправлено через `dispatchEvent`, — `false`, и подделать это
нельзя.

Последствия:

- `el.dispatchEvent(new MouseEvent('click'))` вызовет слушатели, но **не выполнит** большинство
  действий по умолчанию. Исключение по историческим причинам — синтетический `click` активирует
  ссылки, чекбоксы и кнопки (то же делает метод `el.click()`).
- Синтетический `KeyboardEvent` не впечатает символ в поле.
- **Пользовательская активация** (user activation): открыть всплывающее окно, перейти в полноэкранный
  режим, запустить звук, записать в буфер обмена, вызвать `showPicker()` — разрешено только в ответ на
  доверенное событие (щелчок, нажатие клавиши) и недолго после него. Поэтому `window.open` после
  `await fetch(...)` может быть заблокирован: активация «протухла» (в Chrome — около 5 секунд).

## 12. Утечки слушателей и `AbortController`

Слушатель держит ссылку на функцию, функция — на замыкание, замыкание — на всё, что в нём упомянуто
(элементы, большие массивы). Пока слушатель зарегистрирован на **долгоживущем** объекте (`window`,
`document`, глобальная шина событий), всё это не будет собрано сборщиком мусора.

Типичный сценарий утечки — компонент, который при создании подписывается на `window.resize`, а при
удалении из DOM забывает отписаться. Сам компонент удалён, но его замыкание живёт, а обработчик
продолжает работать над «отсоединённым» деревом (detached DOM tree — так это и называется в профилировщике
памяти Chrome).

Слушатели **на самом удаляемом элементе** не утекают: элемент и его слушатели собираются вместе.
Проблема — только ссылки «снизу вверх» на долгоживущие цели.

Рецепт:

```js
function mount(root) {
  const ac = new AbortController();
  const { signal } = ac;
  window.addEventListener('resize', () => layout(root), { signal });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close(), { signal });
  fetch('/api/data', { signal }).then(fill).catch(() => {});  // тот же сигнал отменит и запрос
  return () => ac.abort();   // функция уборки
}
```

Один сигнал можно передать и в `fetch`, и в `addEventListener`, и в собственные асинхронные функции
(через `signal.addEventListener('abort', …)` или `signal.throwIfAborted()`). `AbortSignal.any([a, b])`
объединяет сигналы, `AbortSignal.timeout(ms)` прерывается по таймеру.

<details>
<summary>Утечка и её устранение</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/javascript-events.html#example-10">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; }
  .widget { border: 2px solid #1565c0; padding: 8px; margin: 4px 0; background: #e3f2fd; }
  button { margin: 2px; }
  output { display: block; font: 13px ui-monospace, monospace; margin-top: 8px; }
</style>
</head>
<body>
<p>Создайте и удалите несколько виджетов в обоих режимах, затем меняйте ширину окна или жмите «resize».</p>
<button id="leak">Создать (без уборки)</button>
<button id="clean">Создать (с AbortController)</button>
<button id="kill">Удалить все виджеты</button>
<button id="fire">Отправить resize</button>
<div id="host"></div>
<output id="out">Живых обработчиков resize: 0</output>
<script>
  const host = document.getElementById('host'), out = document.getElementById('out');
  let alive = 0;
  const cleanups = [];
  function make(withAbort) {
    const el = document.createElement('div');
    el.className = 'widget';
    el.textContent = withAbort ? 'виджет с уборкой' : 'виджет без уборки';
    host.append(el);
    const ac = withAbort ? new AbortController() : null;
    alive++;
    window.addEventListener('resize', () => { el.dataset.w = innerWidth; }, ac ? { signal: ac.signal } : {});
    if (ac) cleanups.push(() => { ac.abort(); alive--; });
    show();
  }
  function show() { out.textContent = 'Живых обработчиков resize: ' + alive; }
  document.getElementById('leak').onclick = () => make(false);
  document.getElementById('clean').onclick = () => make(true);
  document.getElementById('kill').onclick = () => {
    host.replaceChildren();
    cleanups.splice(0).forEach(f => f());
    show();
  };
  document.getElementById('fire').onclick = () => dispatchEvent(new Event('resize'));
</script>
</body>
</html>
```

</details>

Виджеты «без уборки» после удаления продолжают держать обработчики на `window` — счётчик не
уменьшается. Это и есть утечка: элемент вне документа, но живёт.

## 13. Порядок и время: как события встроены в цикл событий

- Пользовательские события ставятся в **очередь задач** (task queue). Один щелчок порождает
  последовательность `pointerdown` → `mousedown` → (фокус) → `pointerup` → `mouseup` → `click`.
- После **каждого** слушателя выполняется очередь микрозадач (microtasks): `Promise.then`, внутри
  одного щелчка, сработает между слушателями, а не после всех.
- Частые события (`pointermove`, `scroll`, `resize`) браузер выравнивает по кадрам (coalescing): в
  Chrome `pointermove` приходит не чаще раза за кадр, а пропущенные точки доступны через
  `e.getCoalescedEvents()` (для рисования пером).
- Тяжёлая работа в слушателе задерживает отрисовку — это прямо видно по метрике INP (Interaction to
  Next Paint). Подробнее — в [Производительность JavaScript в браузере](LEARN_JAVASCRIPT_PERFORMANCE_COURSE.md).

## Итог

- Событие отправляется в один узел, но проходит путь: погружение → цель → всплытие. Путь фиксируется
  при отправке.
- `capture` перехватывает раньше всех и ловит невсплывающие события; `once` удаляет слушатель сам;
  `passive` разрешает прокрутку без ожидания; `signal` снимает пачку слушателей разом.
- Делегирование: один слушатель + `closest()` + проверка `contains()`.
- `preventDefault` отменяет действие, `stopPropagation` — путь, `stopImmediatePropagation` — ещё и
  соседей на узле. Останавливать всплытие — крайняя мера.
- `target` — куда, `currentTarget` — где мы сейчас.
- `key` — что напечатано, `code` — какая клавиша. Enter во время IME — не отправка.
- Pointer Events + `setPointerCapture` + `touch-action` — современный путь для жестов.
- `focus`/`blur` не всплывают, `focusin`/`focusout` — да; `relatedTarget` говорит, куда ушёл фокус.
- `CustomEvent` по умолчанию не всплывает и не отменяется; `dispatchEvent` синхронен.
- `isTrusted` нельзя подделать; пользовательская активация нужна для попапов, буфера обмена и т. п.
- Слушатели на `window`/`document` снимайте через `AbortController`.

## Проверьте себя

1. Слушатель с `capture: true` висит на `<form>`. Поймает ли он `focus` вложенного `<input>`? А без
   `capture`?
2. Почему `removeEventListener('click', () => f())` ничего не удаляет? Как сделать уборку без хранения
   ссылки на функцию?
3. Внутри `<button>` лежит `<svg><use></use></svg>`. Какой будет `e.target` при щелчке по иконке и как
   написать делегирование, которое не зависит от этого?
4. Чем отличаются `e.key` и `e.code` при нажатии клавиши Z в русской раскладке?
5. Как закрыть выпадающую панель, когда фокус ушёл за её пределы, но не закрывать при переходе между
   её собственными полями?
6. Почему `window.open` внутри `.then()` после долгого запроса может быть заблокирован?

Дальше: [Интерфейс: состояние, отрисовка, диалоги](LEARN_JAVASCRIPT_UI_COURSE.md).
