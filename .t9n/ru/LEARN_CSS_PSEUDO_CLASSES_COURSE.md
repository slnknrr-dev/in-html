# Псевдоклассы: `:hover`, `:focus-visible`, `:has()`

> Курс 11 из программы. Для тех, кто уже знает [селекторы](LEARN_CSS_SELECTORS_COURSE.md) и
> умеет считать [специфичность](LEARN_CSS_CASCADE_COURSE.md). Здесь мы разберём, откуда браузер
> берёт знание о «состоянии» элемента, которого нет в разметке, и почему некоторые псевдоклассы
> ведут себя неожиданно.

**Что вы будете понимать после курса**

- что такое **псевдокласс** (pseudo-class) и чем он отличается от класса и от псевдоэлемента;
- почему `:hover` срабатывает у всех предков сразу и почему на телефоне он «залипает»;
- разницу между `:focus`, `:focus-visible` и `:focus-within` и какой из них ставить на кольцо фокуса;
- зачем нужен порядок LVHA и почему `:visited` почти ничего не умеет;
- как работают `:nth-child(An+B of S)`, `-of-type` и где они ломаются;
- состояния форм: `:checked`, `:disabled`, `:invalid` против `:user-invalid`, `:placeholder-shown`;
- `:is()`, `:where()`, `:not()`, `:has()` — и как каждый из них считает специфичность;
- `:target`, `:empty`, `:root`.

---

## 1. Что такое псевдокласс

Обычный селектор проверяет то, что записано в дереве: имя элемента, атрибуты, положение среди
родственников. Но у элемента есть и сведения, которых в разметке нет: «на него наведён указатель»,
«в нём фокус», «флажок отмечен», «он третий по счёту». **Псевдокласс** — это условие на такое
сведение. Синтаксически он пишется через одно двоеточие и в специфичности весит **как класс** —
(0,1,0).

Псевдоклассы делятся на группы по источнику знания:

| Группа | Примеры | Откуда браузер знает |
|---|---|---|
| Действия пользователя | `:hover`, `:active`, `:focus` | события ввода |
| Ссылки и местоположение | `:link`, `:visited`, `:target` | история, адрес страницы |
| Структурные | `:nth-child()`, `:first-child`, `:empty`, `:root` | дерево |
| Состояния форм | `:checked`, `:disabled`, `:invalid` | свойства элементов форм |
| Логические | `:is()`, `:where()`, `:not()`, `:has()` | другие селекторы |

Важное следствие: состояние меняется **без изменения DOM**. Браузер при каждом изменении
состояния заново проверяет затронутые правила (style invalidation). Поэтому `:hover` на огромном
дереве с тяжёлыми селекторами вроде `body:hover *` может стоить заметного времени — подробнее в
[производительности CSS](LEARN_CSS_PERFORMANCE_COURSE.md).

Псевдокласс приклеивается к составному селектору без пробела: `a:hover` — «ссылка под указателем»,
а `a :hover` — «любой элемент под указателем внутри ссылки». Один пробел меняет смысл полностью.

## 2. Действия пользователя

### 2.1. `:hover` и почему он «всплывает» к предкам

По спецификации HTML `:hover` подходит к элементу, на который указывает устройство, **и ко всем
его предкам** в плоском дереве (flat tree). Если указатель стоит на `<span>` внутри `<li>` внутри
`<ul>`, то `:hover` верен для `span`, `li`, `ul`, `body` и `html` одновременно. Это не всплытие
событий в смысле JavaScript, это определение псевдокласса: «элемент или его потомок находится
под указателем».

Отсюда два практических приёма:

- `li:hover` срабатывает, даже если указатель над вложенной ссылкой — меню с подменю работает
  без JavaScript;
- `.card:hover .button` — подсвечиваем кнопку, когда навели на любую часть карточки.

И одна ловушка: дочерний элемент, вынесенный позиционированием за пределы родителя, всё равно
держит `:hover` у родителя — ведь он остаётся потомком по дереву, а не по геометрии.

Ещё одна деталь из HTML: если `:hover` (или `:active`) верен для `<label>`, то он верен и для
связанного с ним элемента управления.

<details>
<summary>:hover у всех предков</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-pseudo-classes.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.4 system-ui, sans-serif; padding: 16px; }
  div { padding: 16px; border: 2px solid #999; margin: 4px; }
  div:hover { border-color: crimson; background: rgb(220 20 60 / .08); }
  .pop { position: relative; left: 260px; width: 120px; border-style: dashed; }
</style>
</head>
<body>
  <p>Наведите курсор на самый внутренний блок: подсветятся все три.
     Затем наведите на пунктирный блок справа: он вне рамок родителя, но родитель тоже подсветится.</p>
  <div>внешний
    <div>средний
      <div>внутренний</div>
      <div class="pop">вынесен вправо</div>
    </div>
  </div>
</body>
</html>
```

</details>

### 2.2. Залипающий hover на сенсорных экранах

На экране без указателя наведения нет. Чтобы старые сайты с меню на `:hover` хоть как-то
работали, мобильные браузеры **эмулируют** его: после касания элемент считается «наведённым» до
касания в другом месте. Отсюда «залипшая» подсветка кнопки после нажатия.

Решение — медиазапрос возможностей ввода (interaction media features):

```css
@media (hover: hover) and (pointer: fine) {
  .button:hover { background: #def; }
}
```

| Запрос | Значит |
|---|---|
| `(hover: hover)` | **основное** устройство ввода умеет наводить |
| `(hover: none)` | основное устройство наводить не умеет (палец) |
| `(any-hover: hover)` | **хотя бы одно** из устройств умеет (планшет с мышью) |
| `(pointer: coarse)` | основное устройство неточное — делайте цели крупнее |

Правило проектирования: наведение — это **подсказка**, а не единственный способ что-то открыть.
Всё, что открывается по `:hover`, должно открываться и по фокусу или клику.

### 2.3. `:active`

`:active` верен, пока элемент «активируется»: зажата основная кнопка мыши, палец на экране,
нажат пробел на кнопке. Как и `:hover`, он распространяется на предков. На iOS Safari `:active`
исторически не срабатывал, пока на элементе или предке нет обработчика `touchstart`; поэтому
в старых проектах встречается пустой `ontouchstart=""` на `<body>`.

### 2.4. `:focus`, `:focus-visible`, `:focus-within`

| Псевдокласс | Верен, когда | Для чего |
|---|---|---|
| `:focus` | элемент в фокусе — любым способом | логика, которой важен сам факт фокуса |
| `:focus-visible` | элемент в фокусе **и** браузер считает, что фокус надо показать | кольцо фокуса |
| `:focus-within` | фокус на элементе **или на потомке** | подсветить всю форму или поле с подписью |

`:focus-visible` — эвристика браузера. Упрощённо: фокус с клавиатуры — показывать; клик мышью
по кнопке — не показывать; фокус на текстовом поле — показывать всегда, даже после клика, потому
что пользователь сейчас будет печатать там. Стиль браузера по умолчанию повешен именно на
`:focus-visible` (в Chrome это `outline: -webkit-focus-ring-color auto 1px`).

Отсюда главное правило доступности: **никогда не пишите `:focus { outline: none }` без замены**.
Если кольцо мешает дизайну при клике, замените стиль на `:focus-visible`, а не уберите его:

```css
.button:focus-visible { outline: 3px solid #1a73e8; outline-offset: 2px; }
```

`outline` не занимает места в блочной модели и не сдвигает соседей — поэтому кольцо фокуса
рисуют им, а не `border`.

<details>
<summary>:focus против :focus-visible против :focus-within</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-pseudo-classes.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.4 system-ui, sans-serif; padding: 16px; }
  button, input { font: inherit; padding: 6px 12px; margin: 4px; }
  .a:focus { outline: 3px solid orange; }
  .b:focus { outline: none; }
  .b:focus-visible { outline: 3px solid #1a73e8; outline-offset: 2px; }
  fieldset { border: 2px solid #ccc; margin-top: 12px; }
  fieldset:focus-within { border-color: seagreen; background: #efe; }
</style>
</head>
<body>
  <p>Щёлкните мышью по обеим кнопкам, затем походите по странице клавишей Tab.</p>
  <button class="a">:focus — рамка и при клике</button>
  <button class="b">:focus-visible — рамка только с клавиатуры</button>
  <fieldset>
    <legend>:focus-within</legend>
    <input placeholder="фокус сюда подсветит всю группу">
  </fieldset>
</body>
</html>
```

</details>

## 3. Ссылки: `:link`, `:visited` и порядок LVHA

`:link` — ссылка (`<a>` или `<area>` с атрибутом `href`), ещё не посещённая; `:visited` —
посещённая. `<a>` без `href` не подходит ни под один из них. Есть и общий `:any-link` — «любая
ссылка с `href`».

### 3.1. Почему именно L-V-H-A

У `a:link`, `a:visited`, `a:hover`, `a:active` одинаковая специфичность (0,1,1). Значит,
при конфликте побеждает **последнее** правило в коде. Ссылка может быть одновременно посещённой,
наведённой и нажатой. Если написать `:hover` раньше `:visited`, посещённые ссылки не будут
реагировать на наведение: правило `:visited` ниже и перекрывает. Отсюда мнемоника «LoVe HAte»:

```css
a:link    { color: #0645ad; }
a:visited { color: #0b0080; }
a:hover   { color: #d33; }   /* перекрывает и :link, и :visited */
a:active  { color: #000; }   /* последним: нажатие важнее наведения */
```

`:focus` обычно ставят рядом с `:hover` (LVFHA) — эти состояния часто стилизуют одинаково:
`a:is(:hover, :focus-visible)`.

### 3.2. Почему `:visited` почти ничего не умеет

В 2000-х сайты вычисляли историю посетителя: ставили сотни невидимых ссылок и через
`getComputedStyle` проверяли, какие стали `:visited`. В 2010 году браузеры закрыли эту утечку,
и с тех пор действуют ограничения:

- в правилах с `:visited` применяются только **свойства цвета**: `color`, `background-color`,
  `border-*-color`, `outline-color`, `column-rule-color`, `text-decoration-color`, `fill`,
  `stroke`; размеры, фон-картинка, `display` игнорируются;
- прозрачность берётся из стиля непосещённой ссылки: сделать ссылку видимой только после
  посещения нельзя;
- `getComputedStyle` и подобные API всегда отвечают так, будто ссылка **не** посещена;
- селекторы вида `:visited + span` и `:has(:visited)` не дают узнать состояние ссылки.

Поэтому «галочка у прочитанной статьи» через `a:visited::after` не сработает: менять можно
только цвет. Кроме того, браузеры постепенно разделяют историю посещений по сайтам, так что
ссылка, посещённая с другого сайта, может не считаться `:visited` на вашем.

## 4. Структурные псевдоклассы

### 4.1. `:nth-child(An+B)`

Формула: элемент подходит, если его **позиция среди всех детей-элементов** родителя (с 1) равна
`A·n + B` при некотором целом n ≥ 0.

| Запись | Позиции | Смысл |
|---|---|---|
| `:nth-child(3)` | 3 | ровно третий |
| `:nth-child(2n)` или `even` | 2, 4, 6… | чётные |
| `:nth-child(2n+1)` или `odd` | 1, 3, 5… | нечётные |
| `:nth-child(n+4)` | 4, 5, 6… | начиная с четвёртого |
| `:nth-child(-n+3)` | 3, 2, 1 | первые три |
| `:nth-child(n+3):nth-child(-n+6)` | 3…6 | диапазон: пересечение условий |
| `:nth-last-child(2)` | второй с конца | счёт с конца |

Текстовые узлы и комментарии не считаются, считаются только элементы — но **все** элементы,
а не только того типа, что в селекторе. `p:nth-child(2)` значит «второй ребёнок, и он `p`»,
а не «второй `p`».

### 4.2. `-of-type` и `of S`

`:nth-of-type()` считает только братьев **с тем же именем элемента**. Это решает задачу «второй
абзац», но не задачу «второй элемент с классом `.item`»: классы в `-of-type` не участвуют.

Для этого в Selectors 4 есть синтаксис `:nth-child(An+B of S)` — счёт только среди детей,
подходящих под список селекторов `S`. Поддерживается всеми современными браузерами (Firefox —
с 2023 года).

```css
li:nth-of-type(2)               /* второй li среди li */
.item:nth-of-type(2)            /* НЕ «второй .item»: второй своего типа, и у него есть .item */
:nth-child(2 of .item)          /* второй среди .item */
tr:nth-child(even of :not([hidden]))  /* «зебра», не сбивающаяся от скрытых строк */
```

Специфичность `:nth-child(… of S)` — один псевдокласс плюс самый специфичный селектор из `S`.

### 4.3. Первые, последние, единственные

`:first-child` = `:nth-child(1)`, `:last-child` = `:nth-last-child(1)`, `:only-child` —
одновременно первый и последний. Аналоги с типом: `:first-of-type`, `:last-of-type`,
`:only-of-type`. Классическая ловушка: `p:last-child` не сработает, если после последнего абзаца
в том же родителе стоит, например, `<script>` или `<button>`.

Популярный приём — разделители «между» элементами без лишнего у последнего:

```css
li:not(:last-child) { border-bottom: 1px solid #ddd; }
li + li            { border-top: 1px solid #ddd; }  /* то же через соседство, без псевдокласса */
```

<details>
<summary>nth-child, nth-of-type и of S</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-pseudo-classes.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.4 system-ui, sans-serif; padding: 16px; display: grid; gap: 16px; grid-template-columns: repeat(3, 1fr); }
  section { border: 1px solid #ccc; padding: 8px; }
  h3 { margin: 0 0 6px; font: 600 14px monospace; }
  span, b { display: block; padding: 2px 6px; margin: 2px 0; background: #eee; }
  .s1 > :nth-child(2) { background: gold; }
  .s2 > span:nth-of-type(2) { background: gold; }
  .s3 > :nth-child(2 of .item) { background: gold; }
</style>
</head>
<body>
  <section class="s1"><h3>:nth-child(2)</h3>
    <b>b</b><span class="item">span .item</span><span>span</span><span class="item">span .item</span></section>
  <section class="s2"><h3>span:nth-of-type(2)</h3>
    <b>b</b><span class="item">span .item</span><span>span</span><span class="item">span .item</span></section>
  <section class="s3"><h3>:nth-child(2 of .item)</h3>
    <b>b</b><span class="item">span .item</span><span>span</span><span class="item">span .item</span></section>
</body>
</html>
```

</details>

Заметьте: в первой колонке подсвечен `<b>`, а не первый `span` — заголовок `h3` тоже ребёнок
секции и занимает позицию 1.

### 4.4. `:empty`, `:root`

`:empty` подходит элементу без детей — ни элементов, ни текста. Комментарии не мешают, а вот
**пробел или перенос строки — мешает**: `<p> </p>` не пуст. (В черновике Selectors 4 предлагали
игнорировать пробельный текст, но браузеры этого не сделали.) Типичное применение — спрятать
пустой контейнер для сообщений: `.errors:empty { display: none; }`.

`:root` — корень документа. В HTML это всегда `<html>`, но специфичность выше: (0,1,0) против
(0,0,1) у `html`. На `:root` принято объявлять [пользовательские свойства](LEARN_CSS_CUSTOM_PROPERTIES_COURSE.md).
В SVG-файле, открытом отдельно, `:root` — это `<svg>`.

### 4.5. `:target`

`:target` подходит элементу, чей `id` совпадает с фрагментом адреса (`#раздел`). Меняется без
перезагрузки: щелчок по `<a href="#faq">` делает `#faq` целью. Так делали «вкладки без
JavaScript» и подсветку раздела, к которому перешли:

<details>
<summary>:target подсвечивает раздел</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-pseudo-classes.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.4 system-ui, sans-serif; padding: 16px; }
  section { border-left: 4px solid #ddd; padding: 4px 12px; margin: 8px 0; }
  section:target { border-color: crimson; background: #fff0f0; }
  section:not(:target) p { color: #888; }
</style>
</head>
<body>
  <nav><a href="#a">Раздел A</a> · <a href="#b">Раздел B</a> · <a href="#c">Раздел C</a></nav>
  <section id="a"><h3>A</h3><p>Щёлкните по ссылкам выше.</p></section>
  <section id="b"><h3>B</h3><p>Цель выделяется рамкой.</p></section>
  <section id="c"><h3>C</h3><p>Адрес меняется, страница не перезагружается.</p></section>
</body>
</html>
```

</details>

Минус приёма: каждое переключение добавляет запись в историю и прокручивает к цели.

## 5. Состояния форм

| Псевдокласс | Верен, когда |
|---|---|
| `:checked` | флажок или переключатель отмечен; `<option>` выбран |
| `:indeterminate` | флажок с `el.indeterminate = true`; группа радио без выбранного |
| `:disabled` / `:enabled` | элемент отключён атрибутом или через `<fieldset disabled>` |
| `:required` / `:optional` | есть или нет атрибута `required` |
| `:valid` / `:invalid` | значение проходит или не проходит проверку (constraint validation) |
| `:user-valid` / `:user-invalid` | то же, но только **после взаимодействия** пользователя |
| `:in-range` / `:out-of-range` | число в пределах `min`/`max` |
| `:placeholder-shown` | поле показывает `placeholder` (то есть пусто) |
| `:read-only` / `:read-write` | можно ли редактировать |
| `:default` | кнопка отправки по умолчанию, изначально отмеченный флажок |

### 5.1. `:invalid` против `:user-invalid`

`:invalid` проверяет значение **сразу**. Пустое поле с `required` невалидно ещё до того, как
человек что-то ввёл, — и форма встречает его красными рамками. Это плохой опыт.

`:user-invalid` (поддерживается во всех основных браузерах с конца 2023 года) становится верным
только после того, как пользователь изменил поле и ушёл с него, или попытался отправить форму.
До его появления то же имитировали так:

```css
input:not(:placeholder-shown):invalid { border-color: crimson; }
```

Трюк работает только при непустом `placeholder` (можно даже `placeholder=" "`) и не ловит пустое
обязательное поле — для него `:user-invalid` честнее.

<details>
<summary>:invalid против :user-invalid</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-pseudo-classes.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.4 system-ui, sans-serif; padding: 16px; }
  label { display: block; margin: 10px 0; }
  input { font: inherit; padding: 6px; border: 2px solid #aaa; border-radius: 4px; }
  .now:invalid { border-color: crimson; }
  .user:user-invalid { border-color: crimson; }
  .user:user-valid { border-color: seagreen; }
  input:placeholder-shown { background: #fafae6; }
</style>
</head>
<body>
  <p>Первое поле красное сразу. Второе — только после ввода неверного адреса и ухода из поля (Tab).
     Жёлтый фон — :placeholder-shown.</p>
  <label>:invalid <input class="now" type="email" required placeholder="you@example.org"></label>
  <label>:user-invalid <input class="user" type="email" required placeholder="you@example.org"></label>
</body>
</html>
```

</details>

### 5.2. `:checked` как переключатель состояния

Связка «скрытый флажок + `<label>` + `:checked` + комбинатор соседа» — исторический способ
сделать раскрывашку без JavaScript. Сейчас для этого есть `<details>`, а для своих
переключателей — `:has()` (ниже). Но сам приём полезно понимать:

```css
#menu-toggle:checked ~ .menu { display: block; }
```

Ограничение: `~` и `+` смотрят только **вперёд и на братьев**. Повлиять на родителя или на
предыдущего брата они не могут. Это ограничение и снял `:has()`.

## 6. Логические псевдоклассы и специфичность

### 6.1. `:is()` и `:where()`

Оба принимают **список селекторов** и подходят, если подходит хоть один. Разница — только в
специфичности:

| | Специфичность |
|---|---|
| `:is(A, B)` | как у **самого специфичного** аргумента |
| `:where(A, B)` | всегда **0** |

```css
:is(#nav, .menu) a     /* (1,0,1): #nav поднимает весь :is, даже если совпал .menu */
:where(#nav, .menu) a  /* (0,0,1): легко перекрыть чем угодно */
```

Ещё одно свойство — **прощающий разбор** (forgiving selector list): если один из аргументов
неизвестен браузеру, `:is()`/`:where()` просто пропускают его. Обычный список `A, B` в такой
ситуации отбрасывает всё правило целиком.

Практика: `:where()` — для базовых стилей библиотек и сбросов (reset), которые должно быть легко
перекрыть; `:is()` — чтобы сократить запись, не меняя веса привычным образом.

### 6.2. `:not()`

`:not(S)` — элемент, не подходящий ни под один селектор из списка. Специфичность — как у самого
специфичного аргумента; сам `:not` ничего не добавляет. `:not(.a, .b)` весит (0,1,0), а
`:not(.a):not(.b)` — (0,2,0). С Selectors 4 внутри можно писать сложные селекторы:
`:not(nav a)`.

Ловушка: `:not(.x) p` значит «`p` внутри **какого-нибудь** предка без `.x`», а такой предок
(`html`, `body`) найдётся почти всегда. Нужно `p:not(.x p)`.

### 6.3. `:has()` — «родительский селектор» и больше

`:has(относительный селектор)` подходит элементу, если от него можно найти совпадение:

```css
.card:has(img)            /* карточка, в которой есть картинка */
.card:has(> img)          /* картинка — прямой ребёнок */
h2:has(+ p)               /* заголовок, за которым сразу абзац: смотрим на «следующего» */
label:has(+ input:invalid) /* подпись невалидного поля */
form:has(:user-invalid) button[type=submit] { opacity: .5; }
:root:has(#dark:checked)  { color-scheme: dark; }
```

Специфичность `:has()` — как у самого специфичного аргумента. Внутри `:has()` нельзя писать
псевдоэлементы и другой `:has()`.

Почему его так долго не было: браузер проверяет селекторы справа налево, и изменение глубоко
в дереве при `:has()` может требовать перепроверки всех предков. Реализации (Safari 15.4 в 2022,
затем Chrome и Firefox) используют специальные структуры инвалидации, но цена остаётся:
избегайте `:has()` на `*` или `body` с широким аргументом вроде `body:has(*:hover)`.

<details>
<summary>:has() стилизует родителя и предыдущего брата</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-pseudo-classes.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.4 system-ui, sans-serif; padding: 16px; }
  .card { border: 2px solid #ccc; padding: 12px; margin: 8px 0; border-radius: 8px; }
  .card:has(input:checked) { border-color: seagreen; background: #efe; }
  .field { margin: 12px 0; }
  .field label { display: block; }
  label:has(+ input:user-invalid) { color: crimson; }
  label:has(+ input:user-invalid)::after { content: " — проверьте"; }
  input { font: inherit; padding: 4px; }
</style>
</head>
<body>
  <label class="card"><input type="checkbox"> Отметьте — и рамка карточки станет зелёной</label>
  <label class="card"><input type="checkbox"> Эта карточка независима</label>
  <div class="field">
    <label for="n">Число от 1 до 10</label>
    <input id="n" type="number" min="1" max="10">
  </div>
  <p>Введите 99 и нажмите Tab: подпись ПЕРЕД полем станет красной.</p>
</body>
</html>
```

</details>

### 6.4. Сводная задача на специфичность

| Селектор | Специфичность |
|---|---|
| `a:hover` | (0,1,1) |
| `:root` | (0,1,0) |
| `li:nth-child(2n of .item)` | (0,2,1) |
| `:is(#a, .b) span` | (1,0,1) |
| `:where(#a, .b) span` | (0,0,1) |
| `:not(.a, #b)` | (1,0,0) |
| `.card:has(> img.cover)` | (0,2,1) |
| `input:not(:placeholder-shown):invalid` | (0,2,1) |

## 7. Ещё несколько полезных

- `:lang(ru)` — учитывает наследование `lang` от предков, чего не умеет `[lang="ru"]`.
- `:dir(rtl)` — направление текста, вычисленное браузером.
- `:defined` — пользовательский элемент уже зарегистрирован; помогает спрятать «вспышку»
  неопределённых компонентов: `my-widget:not(:defined) { visibility: hidden; }`.
- `:popover-open`, `:modal`, `:fullscreen`, `:open` (для `<details>` и `<dialog>`, поддержка
  ещё распространяется) — состояния верхнего слоя.
- `:scope` — в `querySelector` означает элемент, на котором вызван поиск:
  `el.querySelectorAll(':scope > li')`.

Псевдоклассы работают и в JavaScript: `el.matches(':hover')`, `form.querySelectorAll(':invalid')`.

<details>
<summary>Меню на hover и focus-within, безопасное для сенсора</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-pseudo-classes.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.4 system-ui, sans-serif; padding: 16px; }
  .menu { position: relative; display: inline-block; }
  .menu > button { font: inherit; padding: 6px 12px; }
  .menu ul { display: none; position: absolute; margin: 0; padding: 4px; list-style: none;
             background: #fff; border: 1px solid #aaa; min-width: 160px; }
  .menu:focus-within ul { display: block; }
  @media (hover: hover) { .menu:hover ul { display: block; } }
  .menu a { display: block; padding: 4px 8px; }
  .menu a:is(:hover, :focus-visible) { background: #e8f0fe; }
</style>
</head>
<body>
  <p>Наведите мышь — меню откроется. Или перейдите Tab на кнопку: откроется по фокусу.
     На телефоне откроется по касанию (фокус), без «залипшего» hover.</p>
  <div class="menu">
    <button>Меню ▾</button>
    <ul><li><a href="#">Первый</a></li><li><a href="#">Второй</a></li><li><a href="#">Третий</a></li></ul>
  </div>
</body>
</html>
```

</details>

## Итог

- Псевдокласс — условие на состояние, которого нет в разметке; весит как класс.
- `:hover` и `:active` верны и для всех предков; на сенсоре hover эмулируется и залипает —
  оборачивайте его в `@media (hover: hover)`.
- Кольцо фокуса — на `:focus-visible`; `outline: none` без замены — ошибка доступности.
- LVHA — следствие одинаковой специфичности: побеждает последнее правило.
- `:visited` меняет только цвета и лжёт скриптам — ради приватности истории.
- `:nth-child` считает всех братьев-элементов; `-of-type` — по имени; `of S` — по селектору.
- `:user-invalid` вместо `:invalid` — ошибки показываются после взаимодействия.
- `:is`/`:not`/`:has` берут специфичность самого тяжёлого аргумента, `:where` — ноль.

## Проверьте себя

1. Почему при наведении на ссылку внутри `<li>` срабатывает правило `li:hover`?
2. Что пойдёт не так, если записать `a:hover` выше `a:visited`?
3. Под что подойдёт `.item:nth-of-type(2)` в списке `<li class=item>`, `<li>`, `<li class=item>`?
4. Почему `<div class="errors"> </div>` не прячется правилом `.errors:empty { display: none }`?
5. Посчитайте специфичность `nav :is(.link, #home):not(.off)`.
6. Как с помощью `:has()` стилизовать `<form>`, в которой есть хотя бы одно поле `:user-invalid`?

Дальше: [Псевдоэлементы: `::before`, `::marker`, `::selection`](LEARN_CSS_PSEUDO_ELEMENTS_COURSE.md).
