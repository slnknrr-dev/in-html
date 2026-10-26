# Каскад и специфичность

> Курс 5 из программы. Для тех, кто уже знает, что такое селектор и объявление
> ([Селекторы CSS](LEARN_CSS_SELECTORS_COURSE.md)), и хочет перестать «угадывать», какое правило
> победит. После этого курса `!important` перестанет быть молотком, а станет инструментом.

**Что вы будете понимать после курса**

- что такое **каскад** (cascade) как алгоритм: какие у него входы, шаги и выход;
- три **источника** (origins) стилей — браузера, пользователя, автора — и почему `!important`
  переворачивает их порядок;
- как работают **слои** `@layer` и почему стиль без слоя сильнее любого слоя;
- как считать **специфичность** (specificity) любого селектора, включая `:is()`, `:not()`, `:where()`,
  `:has()` и псевдоэлементы;
- когда решает **порядок в исходнике**, а когда — **близость области** `@scope`;
- где в этой картине атрибут `style` и почему почти каждое `!important` — это долг.

---

## 1. Зачем вообще нужен каскад

Одному элементу почти всегда адресовано несколько объявлений одного свойства. Стили браузера говорят
`p { margin: 1em 0 }`, ваш сброс — `* { margin: 0 }`, компонент — `.card p { margin-bottom: 8px }`.
У свойства же в итоге может быть ровно **одно** значение. Каскад — это алгоритм, который из списка
объявлений-кандидатов выбирает одно, **каскадное значение** (cascaded value).

Важно сразу развести три механизма, которые новички путают:

| Механизм | Вопрос, на который отвечает | Курс |
|---|---|---|
| Каскад | несколько объявлений одного свойства для одного элемента — какое победит? | этот |
| Наследование | объявлений нет вовсе — откуда взять значение? | [Наследование](LEARN_CSS_INHERITANCE_COURSE.md) |
| Вычисление значений | победитель найден — во что превратить `2em`, `50%`, `currentColor`? | [Единицы](LEARN_CSS_UNITS_VALUES_COURSE.md) |

Каскад работает **по каждому свойству отдельно**. Правило не побеждает «целиком»: из одного правила
может победить `color`, а из другого — `margin`.

## 2. Алгоритм целиком

Спецификация CSS Cascading and Inheritance описывает сортировку кандидатов по критериям. Следующий
критерий смотрят, только если по предыдущему ничья:

1. **Источник и важность** (origin and importance).
2. **Контекст** (context) — теневое дерево против светлого; для Shadow DOM, здесь не разбираем.
3. **Прикреплённые к элементу стили** (element-attached styles) — атрибут `style`.
4. **Слои** (cascade layers) — `@layer`.
5. **Специфичность** (specificity).
6. **Близость области** (scope proximity) — `@scope`.
7. **Порядок появления** (order of appearance).

Запомните главное следствие: **специфичность — только пятый критерий**. Селектор `#a#b#c.x.y`
проигрывает простому `p`, если `p` стоит в более сильном источнике или в более сильном слое.

## 3. Источники: браузер, пользователь, автор

- **Стили браузера** (user-agent origin). Например, `body { margin: 8px }`, `h1 { font-size: 2em;
  margin-block: 0.67em }`, `ul { padding-inline-start: 40px }`, `[hidden] { display: none }`.
- **Стили пользователя** (user origin). Настройки читателя: минимальный размер шрифта, расширение
  с пользовательским CSS, высококонтрастная тема.
- **Стили автора** (author origin). Всё, что пишете вы: `<link>`, `<style>`, атрибут `style`.

Для **обычных** объявлений порядок силы такой: браузер < пользователь < автор. Логика очевидна: автор
знает страницу лучше всех, а стили браузера — запасной вариант.

### 3.1. `!important` переворачивает порядок

Для **важных** объявлений порядок обратный: автор < пользователь < браузер. Полная шкала от слабого
к сильному:

| № | Кандидаты |
|---|---|
| 1 | браузер, обычные |
| 2 | пользователь, обычные |
| 3 | автор, обычные |
| 4 | анимации CSS (`@keyframes`) |
| 5 | автор, `!important` |
| 6 | пользователь, `!important` |
| 7 | браузер, `!important` |
| 8 | переходы CSS (`transition`) |

Почему переворот? `!important` задумывался как **право вето** для того, кто стоит ниже. Пользователь
с плохим зрением пишет `* { font-size: 20px !important }` — и никакой автор не должен иметь
возможности это отменить. Браузер помечает важными вещи, которые нельзя ломать (например, некоторые
свойства полей форм в особых состояниях).

Отсюда неочевидный факт: **анимация побеждает любое обычное авторское правило, но проигрывает
авторскому `!important`**. А идущий переход поверх всего — иначе плавный переход «сломался» бы на
середине.

<details>
<summary>Анимация сильнее обычного правила, но слабее !important</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-cascade.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  @keyframes paint { from, to { background: gold; } }
  .box { width: 220px; padding: 12px; margin: 8px; font: 14px sans-serif;
         animation: paint 1s infinite; }
  /* Очень специфичный, но обычный: проигрывает анимации */
  html body div.box#a { background: lightblue; }
  /* Важный: побеждает анимацию */
  #b { background: lightgreen !important; }
</style>
</head>
<body>
  <div class="box" id="a">#a: золотой — анимация победила</div>
  <div class="box" id="b">#b: зелёный — !important победил</div>
</body>
</html>
```

</details>

## 4. Слои `@layer`

До слоёв у автора был один способ управлять силой — специфичность. Отсюда гонка вооружений:
`.btn` → `.nav .btn` → `#header .nav .btn` → `!important`. Слои добавляют критерий, который стоит
**выше** специфичности и полностью ею управляется вами.

```css
@layer reset, base, components, utilities; /* объявили порядок заранее */

@layer reset      { * { margin: 0; } }
@layer components { .card p { margin-bottom: 8px; } }
@layer utilities  { .mt-0 { margin-top: 0; } }
```

Правила для **обычных** объявлений:

- слой, объявленный **позже**, сильнее объявленного раньше (порядок задаёт **первое упоминание** имени);
- стили **вне слоёв** образуют неявный последний слой — они сильнее **любого** именованного слоя.

Внутри одного слоя дальше работают специфичность и порядок.

<details>
<summary>Слой побеждает специфичность</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-cascade.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  @layer base, utilities;
  /* Специфичность (1,1,1), но слой base раньше */
  @layer base { #note p.text { color: crimson; } }
  /* Специфичность (0,1,0), слой utilities позже: побеждает */
  @layer utilities { .ok { color: seagreen; } }
  /* Вне слоёв: (0,0,1), но сильнее любого слоя */
  em { color: royalblue; }
  body { font: 16px sans-serif; }
</style>
</head>
<body>
  <div id="note">
    <p class="text ok">Зелёный: слой utilities сильнее base. <em>Синий: стиль без слоя.</em></p>
  </div>
</body>
</html>
```

</details>

### 4.1. Слои и `!important`: снова переворот

Для важных объявлений порядок слоёв тоже переворачивается — по той же логике вето:

- важное в **раннем** слое сильнее важного в позднем;
- важное **в слое** сильнее важного **вне слоёв**.

Так слой `reset` может сказать `[hidden] { display: none !important }`, и ни один компонент выше это
не перебьёт даже своим `!important`.

<details>
<summary>!important в раннем слое сильнее !important без слоя</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-cascade.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  @layer reset;
  @layer reset { .tag { color: crimson !important; } }
  .tag { color: royalblue !important; } /* без слоя, но проигрывает */
  body { font: 16px sans-serif; }
</style>
</head>
<body>
  <p class="tag">Красный: важное из слоя reset сильнее важного вне слоёв.</p>
</body>
</html>
```

</details>

### 4.2. Вложенные и анонимные слои, `@import`

- `@layer a { @layer b { … } }` создаёт слой `a.b`; вложенные слои упорядочены внутри родителя.
- `@layer { … }` без имени — анонимный слой: в него нельзя дописать правила позже.
- `@import url(lib.css) layer(vendor);` кладёт чужую библиотеку целиком в слой. Это лучший способ
  укротить внешний CSS: объявите `@layer vendor, app;` — и ваш `app` всегда сильнее.

## 5. Специфичность

Специфичность — это тройка чисел **(A, B, C)**:

- **A** — число селекторов идентификатора `#id`;
- **B** — число классов `.x`, атрибутов `[type="text"]` и псевдоклассов `:hover`;
- **C** — число селекторов типа `p` и псевдоэлементов `::before`.

Не учитываются: универсальный `*`, комбинаторы (` `, `>`, `+`, `~`), а также `:where()`.
Сравнение **поразрядное**, как у слов в словаре: сначала A, при равенстве B, потом C. Это не
десятичное число: 11 классов **не** перевешивают один `#id` — (0,11,0) < (1,0,0).

### 5.1. Особые псевдоклассы

| Запись | Вклад |
|---|---|
| `:where(…)` | всегда 0 |
| `:is(…)`, `:not(…)`, `:has(…)` | специфичность **самого специфичного** аргумента |
| `:nth-child(2n of .x)` | как псевдокласс (0,1,0) **плюс** самый специфичный аргумент после `of` |
| `::before`, `::marker` | (0,0,1), как тип |
| `:root` | (0,1,0) — это псевдокласс, а не тип |
| `[id="a"]` | (0,1,0) — атрибут, даже если это id |

### 5.2. Разбор примеров

| Селектор | A | B | C | Пояснение |
|---|---|---|---|---|
| `*` | 0 | 0 | 0 | универсальный не считается |
| `li` | 0 | 0 | 1 | |
| `ul li` | 0 | 0 | 2 | комбинатор не считается |
| `ul > li + li` | 0 | 0 | 3 | |
| `.nav a` | 0 | 1 | 1 | |
| `a:hover` | 0 | 1 | 1 | псевдокласс = класс |
| `a::after` | 0 | 0 | 2 | псевдоэлемент = тип |
| `input[type="email"]:focus` | 0 | 2 | 1 | |
| `#menu .item.active` | 1 | 2 | 0 | |
| `#menu #item` | 2 | 0 | 0 | |
| `:root` | 0 | 1 | 0 | |
| `html` | 0 | 0 | 1 | поэтому `:root` перебивает `html` |
| `:is(#a, .b) span` | 1 | 0 | 1 | берётся самый сильный аргумент `#a` — даже для элемента внутри `.b`! |
| `:where(#a, .b) span` | 0 | 0 | 1 | |
| `:not(.x, #y)` | 1 | 0 | 0 | |
| `li:nth-child(odd)` | 0 | 1 | 1 | |
| `li:nth-child(2n of .x)` | 0 | 2 | 1 | |
| `.card:has(> img)` | 0 | 1 | 1 | |
| `[id="menu"]` | 0 | 1 | 0 | слабее `#menu` |
| `.a.a.a` | 0 | 3 | 0 | повтор считается — известный приём поднять силу |

Обратите внимание на `:is(#a, .b)`: ловушка в том, что вес не зависит от того, **какой** аргумент
совпал. Если нужна группировка без побочного веса — `:where()`.

### 5.3. Специфичность списка селекторов

`h1, .title, #main` — это три отдельных селектора, у каждого свой вес. Элемент `<h1>` получит
правило с весом (0,0,1), а не (1,0,0).

<details>
<summary>Калькулятор: какое правило победило и почему</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-cascade.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px sans-serif; }
  /* (0,0,2) */ ul li            { color: gray; }
  /* (0,1,1) */ li.item          { color: darkorange; }
  /* (0,2,0) */ .list .item      { color: seagreen; }   /* побеждает (0,1,1) */
  /* (0,1,0) */ :where(#l) .hot  { color: crimson; }    /* :where обнулил #l */
  /* (1,0,1) */ :is(#l, .zzz) b  { color: royalblue; }
  pre { background: #f4f4f4; padding: 8px; }
</style>
</head>
<body>
  <ul class="list" id="l">
    <li class="item">Зелёный: (0,2,0) сильнее (0,1,1)</li>
    <li class="item hot">Зелёный: .hot всего (0,1,0)</li>
    <li class="item"><b>Синий: :is(#l, …) даёт (1,0,1)</b></li>
  </ul>
  <pre id="out"></pre>
  <script>
    // Показываем вычисленный цвет каждого пункта.
    document.getElementById('out').textContent = [...document.querySelectorAll('li, b')]
      .map(e => e.tagName + ': ' + getComputedStyle(e).color).join('\n');
  </script>
</body>
</html>
```

</details>

## 6. Порядок появления

При полной ничьей побеждает объявление, встреченное **позже**. «Позже» — в порядке, в котором браузер
собирает таблицы стилей: `<link>` и `<style>` по порядку в документе, `@import` — на месте импорта
(в начале своей таблицы), правила внутри — сверху вниз, объявления в блоке — слева направо.

Отсюда два полезных приёма:

```css
.btn { background: gray; background: color-mix(in oklab, gray, white 20%); }
/* Старый браузер не поймёт второе значение, отбросит его и оставит первое */

a:link {} a:visited {} a:focus-visible {} a:hover {} a:active {}
/* Порядок «LVFHA»: веса одинаковы (0,1,1), решает порядок — :active должен быть последним */
```

<details>
<summary>Порядок псевдоклассов ссылки (наведите и нажмите)</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-cascade.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 18px sans-serif; display: flex; gap: 40px; }
  /* Правильно: :hover до :active */
  .good a:hover  { color: darkorange; }
  .good a:active { color: crimson; }
  /* Неправильно: :active раньше — :hover его всегда перекрывает */
  .bad a:active  { color: crimson; }
  .bad a:hover   { color: darkorange; }
</style>
</head>
<body>
  <p class="good"><a href="#">Правильный порядок</a><br>нажатие — красный</p>
  <p class="bad"><a href="#">Неправильный порядок</a><br>нажатие — всё ещё оранжевый</p>
</body>
</html>
```

</details>

## 7. Близость области `@scope`

`@scope (.card) to (.content) { img { … } }` применяет правила только к элементам внутри `.card`,
но не глубже `.content`. Сама область **не добавляет** специфичности к `img` (как будто `:where`),
если не использовать `:scope` или `&` в селекторе.

Новый критерий — **близость** (proximity): при равных слое и специфичности побеждает правило, чей
корень области **ближе** к элементу по числу шагов вверх по дереву. Он стоит **после** специфичности,
но **до** порядка. Классический пример — вложенные темы:

<details>
<summary>Ближайшая область побеждает, а не последняя</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-cascade.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px sans-serif; }
  div { padding: 10px; border: 2px solid #999; margin: 6px; }
  @scope (.light) { p { color: black; background: white; } }
  @scope (.dark)  { p { color: white; background: #222; } }
  /* Без @scope последнее правило (.dark) побеждало бы везде */
</style>
</head>
<body>
  <div class="dark">
    <p>Тёмная тема</p>
    <div class="light">
      <p>Светлая внутри тёмной: ближайший корень — .light</p>
    </div>
  </div>
</body>
</html>
```

</details>

Если ваш браузер ещё не поддерживает `@scope`, оба абзаца станут тёмными: правила с непонятным
@-правилом отбрасываются целиком. Это хорошая иллюстрация того, что без `@scope` работает порядок.

## 8. Атрибут `style`

`<p style="color: red">` — объявления **автора**, прикреплённые к элементу. Раньше их описывали как
«специфичность (1,0,0,0)». В современной спецификации это отдельный критерий 3: он стоит **выше слоёв
и специфичности**, но **ниже** источника и важности. Поэтому:

- `style="color:red"` побеждает любой селектор автора без `!important`, в том числе в любом слое;
- `.x { color: blue !important }` побеждает `style="color:red"`;
- `style="color:red !important"` побеждает авторское `!important` из таблиц.

Атрибут `style` удобен из JavaScript (`el.style.setProperty('--x', '10px')`) и для пользовательских
свойств, но как способ оформления он плох: его невозможно переопределить без `!important`, он не
поддерживает `:hover` и `@media`, его может запретить Content Security Policy (`style-src` без
`'unsafe-inline'`).

## 9. `!important`: когда уместно и почему это долг

Каждое авторское `!important` переносит объявление на шкале из пункта 3.1 на этаж выше. Перебить его
можно только другим `!important`, причём там снова работают слои (в обратном порядке), специфичность
и порядок. Так рождается вторая, параллельная гонка вооружений.

Уместные случаи:

1. **Утилиты, которые обязаны работать**: `.visually-hidden { … !important }`, `[hidden] { display:
   none !important }`. Смысл — «это не обсуждается».
2. **Перебить чужой встроенный `style`**, который вы не контролируете (виджет, CMS).
3. **Пользовательский CSS** — ради него `!important` и придумали.

Плохие случаи и замены:

| Симптом | Лучше |
|---|---|
| «Библиотека перебивает мои стили» | положить библиотеку в ранний слой `@import … layer(vendor)` |
| «Нужно чуть сильнее» | `:is()`/повтор класса `.btn.btn` или слой, а не `!important` |
| «Сброс слишком сильный» | сброс через `:where()` или в слое `reset` |
| «Не работает transition/animation» | помнить: важное авторское сильнее анимации |

И ещё ловушка: `!important` **в `@keyframes` игнорируется** — такое объявление просто отбрасывается.

<details>
<summary>Сброс на :where() не мешает компонентам</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-cascade.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px sans-serif; }
  /* Сброс с весом (0,0,0): любой селектор его перебьёт */
  :where(ul.reset) { list-style: none; padding: 0; margin: 0; }
  /* Обычный сброс с весом (0,1,1) перебил бы .menu-padding */
  ul.reset2 { list-style: none; padding: 0; margin: 0; }
  .menu { padding: 10px; background: #eef; }
</style>
</head>
<body>
  <ul class="reset menu"><li>:where-сброс: отступ .menu работает</li></ul>
  <ul class="reset2 menu"><li>обычный сброс: отступ .menu потерян</li></ul>
</body>
</html>
```

</details>

## 10. Отладка: как увидеть каскад

- Инструменты разработчика, панель **Styles**: перечёркнутые объявления проиграли каскад, сверху —
  победители. Наведение на селектор показывает специфичность (в Chrome и Firefox).
- Панель **Computed**: итоговое значение и ссылка на победившее правило.
- Из JavaScript: `getComputedStyle(el).color` — значение уже после каскада, наследования и вычисления.
- Объявление серым или с предупреждением — невалидно и отброшено **ещё до** каскада: невалидные
  объявления в каскаде не участвуют вообще.

<details>
<summary>Невалидное объявление не участвует в каскаде</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-cascade.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px sans-serif; }
  p { color: seagreen; }
  /* Более позднее и сильное, но значение невалидно: отброшено */
  body p { color: зелёный; }
  /* Опечатка в имени свойства тоже отбрасывается */
  p { colr: crimson; }
</style>
</head>
<body>
  <p>Остаюсь зелёным: невалидные объявления выбыли до каскада.</p>
</body>
</html>
```

</details>

## 11. Ключевые слова, работающие с каскадом

Их подробно разбирает следующий курс, здесь — только связь с каскадом:

- `revert` — откатить значение **к предыдущему источнику**: из авторского — к пользовательскому
  или браузерному. `display: revert` у `div` даст `block`, а не `inline`.
- `revert-layer` — откатить к **предыдущему слою** того же источника.
- `all: revert` — откатить все свойства сразу (кроме `direction`, `unicode-bidi` и
  пользовательских свойств).

<details>
<summary>revert-layer: вернуть значение из нижнего слоя</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-cascade.html#example-9">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  @layer base, theme;
  @layer base  { button { background: lightgreen; padding: 8px 14px; font: 15px sans-serif; } }
  @layer theme { button { background: crimson; color: white; }
                 button.plain { background: revert-layer; color: revert-layer; } }
</style>
</head>
<body>
  <button>Тема: красная</button>
  <button class="plain">revert-layer: из base</button>
</body>
</html>
```

</details>

## Итог

- Каскад выбирает одно значение **для каждого свойства** по критериям: источник и важность →
  контекст → `style` → слои → специфичность → близость области → порядок.
- `!important` переворачивает порядок источников и слоёв: это право вето для нижних уровней.
- Анимации сильнее обычных авторских стилей, переходы — сильнее всего.
- Стили вне слоёв сильнее любого слоя; важное в раннем слое сильнее важного вне слоёв.
- Специфичность — поразрядная тройка (A,B,C); `:where()` = 0, `:is()/:not()/:has()` = самый сильный
  аргумент.
- Невалидные объявления отбрасываются до каскада.

## Проверьте себя

1. Посчитайте специфичность: `nav > ul li:not(.active) a::after`, `:is(header, #top) .logo`,
   `input:where([type="text"]):focus-visible`.
2. Правило `#main p { color: red }` лежит в слое `base`, правило `p { color: blue }` — вне слоёв.
   Какого цвета абзац в `#main`? А если в первом добавить `!important`?
3. Почему пользовательское `!important` сильнее авторского, хотя обычное — слабее?
4. Почему `:hover` должен стоять раньше `:active` и при чём тут специфичность?
5. Атрибут `style="color: red"` и правило `.x { color: blue }` в слое `utilities`. Кто победит?

Дальше: [Наследование и значения по умолчанию](LEARN_CSS_INHERITANCE_COURSE.md).
