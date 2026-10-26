# Формы

> Курс 27 из программы. Для тех, кто прошёл [Атрибуты](LEARN_HTML_ATTRIBUTES_COURSE.md) и
> [HTML как набор крючков для селекторов](LEARN_HTML_SELECTORS_COURSE.md). Форма — самая «умная»
> часть HTML: она умеет собирать данные, проверять их, отправлять на сервер и подсказывать
> клавиатуре телефона, какие кнопки показать. Большую часть этого не нужно писать на JavaScript.

**Что вы будете понимать после курса**

- как подпись связывается с полем и почему это важно не только для скринридера;
- какие бывают типы полей и как `type`, `inputmode`, `autocomplete`, `enterkeyhint` управляют
  мобильной клавиатурой и автозаполнением;
- как работает встроенная проверка: `required`, `pattern`, `min`/`max`, `:user-invalid`,
  `setCustomValidity`;
- зачем нужны `fieldset` и `legend`;
- почему кнопка без `type` отправляет форму и что такое неявная отправка по Enter;
- что именно уходит на сервер: `name`/`value`, `GET`/`POST`, `enctype`, `FormData`;
- что умеют `select`, `datalist` и `output`.

---

## 1. Что такое форма с точки зрения браузера

Элемент `<form>` — это **владелец** (form owner) набора **управляющих элементов** (form controls):
`input`, `select`, `textarea`, `button`, `output`, `fieldset`, `object`. При отправке браузер
обходит их в порядке дерева и строит **набор данных формы** (form data set) — список пар
«имя — значение». Всё остальное — проверка, кодирование, навигация — строится вокруг этого списка.

Поле принадлежит форме, если лежит внутри неё **или** указывает на неё атрибутом `form`:

```html
<form id="search">…</form>
<input name="q" form="search">  <!-- снаружи, но отправится с формой search -->
```

Формы нельзя вкладывать друг в друга: парсер просто проигнорирует внутренний тег `<form>`.

## 2. Подпись: `label`

### 2.1. Два способа связи

| Способ | Разметка | Плюсы | Минусы |
|---|---|---|---|
| явный | `<label for="email">` + `<input id="email">` | поле и подпись можно разнести в разметке | нужен уникальный `id` |
| неявный (обёртка) | `<label>Email <input></label>` | не нужен `id` | раскладка жёстче; часть старых связок вспомогательных технологий хуже понимала |
| оба сразу | обёртка + `for` | максимальная совместимость | многословно |

Что даёт связь:

- **доступное имя** (accessible name): скринридер прочитает «Email, поле ввода», а не «поле ввода»;
- **щелчок по подписи** фокусирует поле, а у флажка — переключает его. Крошечный чекбокс получает
  большую область нажатия — на телефоне это ощутимо;
- `input.labels` возвращает все связанные подписи.

`placeholder` — **не** подпись: исчезает при вводе, обычно низкоконтрастный, а как доступное имя
используется только в крайнем случае. Подсказку формата в нём держать можно, название поля — нет.

<details>
<summary>Подписи: щёлкните по тексту</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-forms.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px system-ui; display: grid; gap: 12px; max-width: 360px; }
  label { padding: 4px; }
  label:hover { background: #e0f2fe; outline: 1px dashed #0284c7; }
  input:focus { outline: 3px solid #f59e0b; }
</style>
</head>
<body>
  <div>
    <label for="mail">Явная связь (for/id)</label><br>
    <input id="mail" type="email">
  </div>
  <label>Обёртка: <input type="text"></label>
  <label><input type="checkbox"> Флажок: щелчок по тексту переключает</label>
  <div>
    <span>Без связи (span)</span><br>
    <input type="text" placeholder="щелчок по тексту не помогает">
  </div>
</body>
</html>
```

</details>

### 2.2. Подсказки и ошибки: `aria-describedby`

Подпись — короткое имя. Пояснение («не менее 8 символов») и текст ошибки связывают через
`aria-describedby="id1 id2"`: скринридер прочтёт их после имени.

## 3. Типы полей и клавиатуры

### 3.1. `type` меняет поведение, а не только вид

| `type` | Что делает браузер | Мобильная клавиатура |
|---|---|---|
| `text` | ничего особенного | обычная |
| `email` | проверяет формат, `multiple` разрешает список через запятую | с `@` |
| `url` | проверяет абсолютный URL | с `/` и `.com` (на некоторых) |
| `tel` | **не** проверяет: форматы телефонов слишком разные | цифровая |
| `number` | стрелки, колесо мыши, `min`/`max`/`step`, `valueAsNumber` | цифры |
| `password` | скрывает символы, менеджеры паролей реагируют | обычная, без подсказок |
| `search` | крестик очистки в части браузеров, роль `searchbox` | Enter → «Найти» |
| `date`, `time`, `datetime-local`, `month`, `week` | системный выбор даты; `value` всегда в ISO (`2026-10-26`) | календарь |
| `range` | ползунок | — |
| `color` | палитра, `value` в виде `#rrggbb` | — |
| `checkbox`, `radio` | отмечаются; radio с одним `name` — группа | — |
| `file` | выбор файлов, `accept`, `multiple` | — |
| `hidden` | не виден, но отправляется | — |

Неизвестный `type` превращается в `text` — поэтому новые типы можно использовать без страха.

### 3.2. `type="number"` — не для «чисел из цифр»

Номер карты, индекс, код из СМС — это **строки из цифр**, а не числа: ведущие нули важны, крутить
колесом бессмысленно, а `e` и `-` в поле разрешены, потому что входят в запись чисел. Для них —
`type="text"` с `inputmode="numeric"`.

### 3.3. `inputmode`, `enterkeyhint`, `autocomplete`

- `inputmode` — только **подсказка клавиатуре**, без проверки: `none`, `text`, `decimal`,
  `numeric`, `tel`, `search`, `email`, `url`.
- `enterkeyhint` — что написано на клавише Enter: `enter`, `done`, `go`, `next`, `previous`,
  `search`, `send`.
- `autocomplete` — **токены автозаполнения**: браузер и менеджер паролей знают, что подставить.

| Поле | Токен |
|---|---|
| имя | `name`, `given-name`, `family-name` |
| почта | `email` |
| логин | `username` |
| пароль при входе | `current-password` |
| пароль при регистрации/смене | `new-password` — менеджер предложит сгенерировать |
| код из СМС | `one-time-code` |
| телефон | `tel` |
| адрес | `street-address`, `postal-code`, `address-level2` (город), `country` |
| отключить | `off` (менеджеры паролей нередко игнорируют) |

Токены можно предварять секцией: `autocomplete="shipping postal-code"` и `billing postal-code`
различают два адреса на одной странице.

<details>
<summary>Клавиатуры (откройте на телефоне)</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-forms.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 16px system-ui; display: grid; gap: 10px; max-width: 380px; }
  label { display: grid; gap: 2px; }
  code { color: #7c3aed; font-size: 13px; }
  input { font: inherit; padding: 6px; }
</style>
</head>
<body>
  <label>Почта <code>type=email autocomplete=email</code>
    <input type="email" autocomplete="email" enterkeyhint="next"></label>
  <label>Код из СМС <code>inputmode=numeric one-time-code</code>
    <input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" enterkeyhint="done"></label>
  <label>Сумма <code>inputmode=decimal</code>
    <input type="text" inputmode="decimal"></label>
  <label>Телефон <code>type=tel</code>
    <input type="tel" autocomplete="tel"></label>
  <label>Поиск <code>type=search enterkeyhint=search</code>
    <input type="search" enterkeyhint="search"></label>
  <label>Количество <code>type=number</code> (попробуйте ввести e)
    <input type="number" min="0" step="1"></label>
</body>
</html>
```

</details>

Ещё два атрибута, о которых забывают: `spellcheck="false"` для логинов и кода и
`autocapitalize="off"` (или `none`), чтобы телефон не делал заглавной первую букву почты.

## 4. Встроенная проверка

### 4.1. Ограничения

| Атрибут | Состояние ошибки (`validity.*`) |
|---|---|
| `required` | `valueMissing` |
| `type="email"`/`url` | `typeMismatch` |
| `pattern` | `patternMismatch` |
| `minlength`/`maxlength` | `tooShort`/`tooLong` |
| `min`/`max` | `rangeUnderflow`/`rangeOverflow` |
| `step` | `stepMismatch` |
| `setCustomValidity('…')` | `customError` |
| — | `badInput` (браузер не смог разобрать ввод, например буквы в `number`) |

Детали, на которых спотыкаются:

- `pattern` проверяет **всё значение целиком** — неявно добавляются `^(?:` и `)$`. Пустое поле
  `pattern` не проверяет: это работа `required`. Регулярное выражение компилируется с флагом `v`.
- `maxlength` не даёт ввести лишнее, поэтому `tooLong` почти не встречается; `minlength` проверяется
  только после ввода пользователем.
- проверка срабатывает при отправке: браузер находит **первое** неверное поле, фокусирует его и
  показывает пузырь с сообщением. Атрибут `novalidate` на форме (или `formnovalidate` на кнопке)
  отключает этот шаг.

### 4.2. `:invalid` против `:user-invalid`

`:invalid` совпадает **сразу**: пустое обязательное поле красное ещё до того, как человек его
коснулся. Это раздражает. `:user-invalid` (и пара `:user-valid`) совпадает только **после
взаимодействия** — когда пользователь изменил значение и ушёл из поля или попытался отправить форму.
Поддерживается всеми современными браузерами с 2023 года.

<details>
<summary>:invalid против :user-invalid (введите и уйдите из поля)</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-forms.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  fieldset { display: grid; gap: 8px; }
  input { font: inherit; padding: 6px; border: 2px solid #94a3b8; }
  .a input:invalid { border-color: #dc2626; background: #fee2e2; }
  .b input:user-invalid { border-color: #dc2626; background: #fee2e2; }
  .b input:user-valid { border-color: #16a34a; }
</style>
</head>
<body>
  <fieldset class="a"><legend>:invalid</legend>
    <input required placeholder="обязательно">
    <input type="email" placeholder="почта">
  </fieldset>
  <fieldset class="b"><legend>:user-invalid</legend>
    <input required placeholder="обязательно">
    <input type="email" placeholder="почта">
  </fieldset>
</body>
</html>
```

</details>

### 4.3. Своя логика: `setCustomValidity`

Правило «пароли совпадают» атрибутами не выразить. `setCustomValidity(сообщение)` помечает поле
ошибкой с вашим текстом; **пустая строка** снимает ошибку. Забыть снять — значит заблокировать
форму навсегда, поэтому проверку делают на каждом `input`.

```js
repeat.addEventListener('input', () => {
  repeat.setCustomValidity(repeat.value === pass.value ? '' : 'Пароли не совпадают');
});
```

Методы: `checkValidity()` — проверить молча (вернёт `false` и пошлёт событие `invalid`),
`reportValidity()` — проверить и показать пузырь.

<details>
<summary>Совпадение паролей и сообщения</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-forms.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; }
  form { display: grid; gap: 8px; max-width: 320px; }
  input { font: inherit; padding: 6px; border: 2px solid #94a3b8; }
  input:user-invalid { border-color: #dc2626; }
  .hint { font-size: 13px; color: #64748b; }
  pre { background: #f1f5f9; padding: 8px; white-space: pre-wrap; }
</style>
</head>
<body>
  <form id="f">
    <label for="p1">Пароль</label>
    <input id="p1" type="password" required minlength="8" autocomplete="new-password" aria-describedby="h1">
    <span class="hint" id="h1">Не менее 8 символов</span>
    <label for="p2">Повторите</label>
    <input id="p2" type="password" required autocomplete="new-password">
    <button>Создать</button>
  </form>
  <pre id="log">Нажмите «Создать»</pre>
  <script>
    const f = document.getElementById('f');
    const p1 = document.getElementById('p1');
    const p2 = document.getElementById('p2');
    const sync = () => p2.setCustomValidity(p2.value === p1.value ? '' : 'Пароли не совпадают');
    p1.addEventListener('input', sync);
    p2.addEventListener('input', sync);
    f.addEventListener('submit', e => {
      e.preventDefault(); // в примере не уходим со страницы
      document.getElementById('log').textContent = 'Форма прошла проверку и была бы отправлена';
    });
    f.addEventListener('invalid', e => {
      const v = e.target.validity;
      document.getElementById('log').textContent = e.target.id + ': ' +
        Object.keys(Object.getPrototypeOf(v)).filter(k => v[k]).join(', ') + '\n' + e.target.validationMessage;
    }, true); // invalid не всплывает, ловим на фазе погружения
  </script>
</body>
</html>
```

</details>

Встроенная проверка — удобство для человека, **не защита**. Запрос можно отправить в обход
страницы, поэтому сервер проверяет всё заново.

## 5. `fieldset` и `legend`

`fieldset` группирует поля, `legend` (первый дочерний) — подпись группы. Зачем:

- **группа радиокнопок** без `legend` — это вопрос без вопроса. Скринридер прочтёт «Доставка,
  группа» перед вариантами «Курьер», «Самовывоз»;
- `<fieldset disabled>` выключает **все** поля внутри разом (кроме полей внутри его `legend`), и
  они не отправляются;
- `fieldset` — тоже элемент формы: у него есть `elements` и `validity`.

Стиль по умолчанию: рамка `2px groove`, отступы, а `legend` «врезана» в верхнюю рамку. Это особый
вид отрисовки: `legend` не участвует в обычном потоке, поэтому `display: flex` на `fieldset`
исторически работал с причудами. Сбросить вид: `border: 0; padding: 0; margin: 0; min-inline-size: 0`
— последнее нужно, потому что у `fieldset` по умолчанию `min-inline-size: min-content`, и широкая
таблица внутри растягивает его, а не сжимается.

<details>
<summary>fieldset, legend и disabled</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-forms.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; display: grid; gap: 12px; max-width: 420px; }
  fieldset { border: 2px solid #6366f1; border-radius: 6px; }
  legend { padding: 0 6px; font-weight: bold; color: #4338ca; }
  fieldset:disabled { border-color: #cbd5e1; opacity: .6; }
</style>
</head>
<body>
  <fieldset>
    <legend>Доставка</legend>
    <label><input type="radio" name="ship" value="courier" checked> Курьер</label><br>
    <label><input type="radio" name="ship" value="pickup"> Самовывоз</label>
  </fieldset>
  <label><input type="checkbox" id="gift"> Это подарок</label>
  <fieldset id="giftbox" disabled>
    <legend>Открытка</legend>
    <input placeholder="Кому"> <textarea placeholder="Текст"></textarea>
  </fieldset>
  <script>
    document.getElementById('gift').addEventListener('change', e => {
      document.getElementById('giftbox').disabled = !e.target.checked;
    });
  </script>
</body>
</html>
```

</details>

## 6. Кнопки: ловушка `type="submit"`

У `<button>` значение `type` по умолчанию — **`submit`**. Любая кнопка внутри формы без `type`
отправляет форму: «Показать пароль», «Добавить строку», «Отмена» — всё перезагружает страницу.

| `type` | Действие |
|---|---|
| `submit` (по умолчанию) | отправить форму |
| `button` | ничего; поведение — только ваш JavaScript |
| `reset` | вернуть полям исходные значения — почти всегда вредно |

Кнопка отправки может переопределить атрибуты формы: `formaction`, `formmethod`, `formenctype`,
`formnovalidate`, `formtarget`. Её собственные `name`/`value` попадают в данные — **только у той
кнопки, которой отправили**. Так одна форма различает «Сохранить» и «Сохранить как черновик».

### 6.1. Неявная отправка (implicit submission)

Enter в текстовом поле «нажимает» **кнопку по умолчанию** (default button) — первую кнопку отправки
формы в порядке дерева. Отсюда неприятности:

- первая кнопка в форме — «Удалить» без `type` → Enter удаляет;
- если кнопок отправки нет, Enter отправляет форму только когда поле, блокирующее неявную отправку,
  одно;
- `<input type="image">` тоже кнопка отправки и отправляет координаты щелчка `name.x`, `name.y`.

<details>
<summary>Ловушка: кнопка без type (нажмите кнопки и Enter)</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-forms.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; }
  form { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px; border: 2px solid #94a3b8; }
  button { padding: 6px 10px; }
  pre { background: #f1f5f9; padding: 8px; min-height: 3em; }
</style>
</head>
<body>
  <form id="f">
    <input name="title" value="Отчёт">
    <button>Показать (без type)</button>
    <button type="button">Показать (type=button)</button>
    <button name="mode" value="draft">Черновик</button>
    <button name="mode" value="publish">Опубликовать</button>
  </form>
  <pre id="log"></pre>
  <script>
    document.getElementById('f').addEventListener('submit', e => {
      e.preventDefault();
      const data = new FormData(e.target, e.submitter); // submitter добавит name/value кнопки
      document.getElementById('log').textContent =
        'ОТПРАВКА! submitter: «' + e.submitter.textContent + '»\n' +
        new URLSearchParams(data).toString();
    });
  </script>
</body>
</html>
```

</details>

Нажмите Enter в поле — отправка пойдёт через первую кнопку, «Показать (без type)».

## 7. Отправка: что уходит на сервер

### 7.1. Правила набора данных

- Поле без `name` **не отправляется**. `id` для отправки не нужен.
- `disabled` поля не отправляются; `readonly` — отправляются.
- Неотмеченные флажки и радиокнопки не отправляются **вовсе** (не `false`, а отсутствие пары).
  Отмеченный флажок без `value` отправляет `on`.
- Одинаковые имена дают несколько пар: `tag=a&tag=b`. Читайте через `getAll('tag')`.
- `select multiple` даёт пару на каждый выбранный вариант.
- `type="file"` отправляет содержимое файла, только если `enctype="multipart/form-data"`; иначе
  уходит лишь имя файла.

### 7.2. `method` и `enctype`

| | `GET` (по умолчанию) | `POST` |
|---|---|---|
| где данные | в строке запроса URL: `?q=html&page=2` | в теле запроса |
| закладки, «Назад», кэш | работают | повторная отправка спрашивает подтверждение |
| для чего | поиск, фильтры — **безопасные** запросы | создание, изменение, вход |
| ограничения | длина URL; данные видны в истории и логах | — |

`enctype` (только для `POST`):

| Значение | Формат тела | Когда |
|---|---|---|
| `application/x-www-form-urlencoded` (по умолчанию) | `a=1&b=%D0%BF` | обычные поля |
| `multipart/form-data` | части с границами, у каждой свои заголовки | есть файлы |
| `text/plain` | `a=1` построчно | почти никогда: неоднозначно разбирается |

`method="dialog"` внутри `<dialog>` не отправляет ничего на сервер, а закрывает диалог и кладёт
`value` кнопки в `dialog.returnValue`.

### 7.3. `FormData` и отправка из JavaScript

`new FormData(form)` строит тот же набор данных, что и браузер при отправке. Его можно отдать
`fetch` (тело станет `multipart/form-data`) или превратить в `URLSearchParams` (urlencoded).

```js
form.addEventListener('submit', async e => {
  e.preventDefault();
  const res = await fetch(form.action, { method: 'POST', body: new FormData(form) });
});
```

Событие `formdata` позволяет дописать поля в набор прямо перед отправкой — и при обычной отправке,
и при `new FormData(form)`. `form.requestSubmit(кнопка)` отправляет программно **с проверкой и
событием `submit`**, в отличие от старого `form.submit()`, который пропускает и то, и другое.

<details>
<summary>Что попадёт в FormData</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-forms.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  form { display: grid; gap: 6px; align-content: start; }
  pre { background: #0f172a; color: #e2e8f0; padding: 8px; margin: 0; }
  .note { color: #64748b; font-size: 12px; }
</style>
</head>
<body>
  <form id="f">
    <input name="login" value="anna">
    <input value="без name"> <span class="note">нет name — не уйдёт</span>
    <input name="ro" value="только чтение" readonly>
    <input name="off" value="выключено" disabled> <span class="note">disabled — не уйдёт</span>
    <label><input type="checkbox" name="news" checked> Новости (value нет)</label>
    <label><input type="checkbox" name="ads" value="yes"> Реклама (не отмечено)</label>
    <label><input type="checkbox" name="tag" value="html" checked> html</label>
    <label><input type="checkbox" name="tag" value="css" checked> css</label>
    <select name="lang" multiple size="3">
      <option selected>ru</option><option>en</option><option selected>ka</option>
    </select>
  </form>
  <pre id="out"></pre>
  <script>
    const f = document.getElementById('f');
    const show = () => {
      const lines = [];
      for (const [k, v] of new FormData(f)) lines.push(k + ' = ' + v);
      document.getElementById('out').textContent = lines.join('\n');
    };
    f.addEventListener('input', show);
    show();
  </script>
</body>
</html>
```

</details>

## 8. `select`, `datalist`, `output`, `textarea`

### 8.1. `select`

- `value` выбранного `option` — его атрибут `value`, а если его нет — **текст** варианта.
- Первый вариант выбран по умолчанию. Чтобы `required` имел смысл, первый вариант делают пустым:
  `<option value="">Выберите…</option>` — пустое значение и есть `valueMissing`.
- `<optgroup label="…">` группирует варианты; выбрать саму группу нельзя.
- `size` больше 1 или `multiple` превращают выпадающий список в окно со списком.

### 8.2. `datalist` — подсказки, а не ограничение

`<input list="cities">` + `<datalist id="cities">` даёт выпадающие подсказки, но пользователь
может ввести **что угодно**. Это противоположность `select`: там выбор только из списка.

### 8.3. `output` — результат вычисления

`<output for="a b">` — элемент для результата. Он связан с полями-источниками через `for`, имеет
неявную роль `status` (скринридер сообщает изменения), но **не отправляется** с формой, хоть у него
и может быть `name`.

<details>
<summary>select, datalist и output</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-forms.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; }
  form { display: grid; gap: 10px; max-width: 360px; }
  output { font-size: 24px; font-weight: bold; color: #7c3aed; }
  select:user-invalid { outline: 2px solid #dc2626; }
</style>
</head>
<body>
  <form id="calc" oninput="sum.value = (a.valueAsNumber || 0) * (b.valueAsNumber || 0)">
    <label>Город (подсказки, но можно своё)
      <input name="city" list="cities"></label>
    <datalist id="cities">
      <option value="Тбилиси"><option value="Кутаиси"><option value="Батуми">
    </datalist>
    <label>Тариф
      <select name="plan" required>
        <option value="">Выберите…</option>
        <optgroup label="Помесячно"><option value="m1">Базовый</option><option value="m2">Про</option></optgroup>
        <optgroup label="Годовой"><option value="y1">Базовый</option></optgroup>
      </select></label>
    <div>
      <input id="a" name="a" type="number" value="3" style="width:5em"> ×
      <input id="b" name="b" type="number" value="4" style="width:5em"> =
      <output name="sum" for="a b">12</output>
    </div>
  </form>
</body>
</html>
```

</details>

Здесь `a`, `b`, `sum` внутри атрибута-обработчика `oninput` найдены не через `window`, а через
**саму форму**: обработчики в атрибутах выполняются с формой в цепочке областей видимости, а
`form.a` — это поле с `name="a"`. Удобно для демонстрации, но в настоящем коде лучше
`form.elements.namedItem('a')`.

### 8.4. `textarea`

Значение — **содержимое** элемента, а не атрибут `value`. Первый перевод строки сразу после
`<textarea>` парсер отбрасывает. При отправке переводы строк нормализуются в `CRLF`. `wrap="hard"`
вставляет переводы строк по месту визуального переноса (требует `cols`).

## 9. Доступность — сводка

1. У каждого поля есть **видимая** подпись, связанная с ним.
2. Группы радиокнопок и флажков — в `fieldset` с `legend`.
3. Подсказки и ошибки — через `aria-describedby`; при ошибке — `aria-invalid="true"`, если
   проверка своя, а не встроенная.
4. Не отключайте кнопку отправки, пока форма неверна: человек не поймёт почему. Пусть нажмёт и
   увидит сообщение.
5. Ошибку сообщайте **текстом**, а не только красной рамкой: цвет различают не все.
6. Фокус должен быть видимым: не убирайте `outline` без замены (`:focus-visible`).
7. Порядок полей в DOM — порядок табуляции. Не переставляйте поля визуально через CSS.

## Итог

- Форма строит **набор пар «имя — значение»** из полей с `name`, кроме `disabled` и неотмеченных.
- `label` связывает подпись с полем: доступное имя плюс область щелчка.
- `type`, `inputmode`, `autocomplete`, `enterkeyhint` — четыре разных рычага: проверка,
  клавиатура, автозаполнение, надпись на Enter.
- Встроенная проверка даёт `validity.*`, сообщения и пузырь; `:user-invalid` подсвечивает ошибки
  после взаимодействия; `setCustomValidity` — для своих правил. Сервер проверяет всё заново.
- `<button>` по умолчанию — `submit`. Пишите `type="button"` для всего, что не отправляет форму.
- `GET` для безопасных запросов, `POST` для изменений, `multipart/form-data` для файлов.

## Проверьте себя

1. Почему для кода из СМС лучше `type="text" inputmode="numeric"`, чем `type="number"`?
2. Флажок «Подписаться» не отмечен. Что придёт на сервер? А если отмечен и у него нет `value`?
3. Чем `form.requestSubmit()` отличается от `form.submit()`?
4. В форме первая кнопка — «Удалить» без `type`. Что произойдёт, если нажать Enter в поле?
5. Почему `pattern="\d{3}"` не пропустит `1234`, хотя в строке есть три цифры подряд?
6. Отправляется ли значение `<output name="total">`?

Дальше: [Таблицы](LEARN_HTML_TABLES_COURSE.md).
