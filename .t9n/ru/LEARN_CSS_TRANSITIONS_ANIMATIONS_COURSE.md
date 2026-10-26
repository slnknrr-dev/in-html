# Переходы и анимации

> Курс 20 из программы. Для тех, кто уже понимает каскад, вычисленные значения и конвейер отрисовки
> хотя бы в общих чертах. Мы не будем «делать красиво»: мы разберём, **что именно** браузер
> интерполирует, в какой момент, на каком этапе конвейера и почему одна анимация плавная, а другая
> дёргается.

**Что вы будете понимать после курса**

- что такое **интерполяция** (interpolation) и почему одни свойства анимируются плавно, другие —
  скачком, а третьи не анимируются вовсе;
- как работает `transition`: что его запускает, от какого значения к какому, что происходит при
  прерывании;
- почему `display: none` «убивает» переход и как это исправляют `transition-behavior: allow-discrete`
  и `@starting-style`;
- как устроены функции времени: `cubic-bezier()`, `steps()`, `linear()`;
- как `@keyframes` и `animation-*` встраиваются в каскад и что делает `animation-fill-mode`;
- почему `transform` и `opacity` дешёвые, а `width`, `top` и `box-shadow` — нет;
- как уважать `prefers-reduced-motion`;
- что такое View Transitions и когда они нужны.

---

## 1. Анимация — это смена вычисленного значения во времени

В CSS нет «движения». Есть **вычисленное значение** (computed value) свойства, и есть механизм,
который на время подменяет его промежуточными значениями. Таких механизмов два:

| Механизм | Что запускает | Откуда берутся значения |
|---|---|---|
| **Переход** (transition) | смена вычисленного значения (класс, `:hover`, JS) | старое → новое |
| **Анимация** (animation) | появление `animation-name` на элементе | кадры `@keyframes` |

Оба работают через одну операцию — **интерполяцию**: по двум значениям `A`, `B` и доле `p` от 0 до 1
построить промежуточное значение. Для `opacity: 0.2` и `opacity: 1` при `p = 0.5` это `0.6`. Для
цветов — смешение в цветовом пространстве (по умолчанию для переходов — `srgb` с премультиплицированной
альфой). Для `transform` — либо поэлементная интерполяция функций, либо разложение матриц.

Каждое свойство в спецификации имеет строку **Animation type**:

| Тип | Пример | Как ведёт себя |
|---|---|---|
| по вычисленному значению (by computed value) | `width`, `color`, `opacity` | плавно, если оба значения однотипны |
| дискретный (discrete) | `display`, `font-style`, `position` | скачок на середине (`p = 0.5`) |
| не анимируется (not animatable) | `animation-name`, `transition-property` | никак |
| особый | `visibility` | см. ниже |

### 1.1. Что значит «однотипны»

`width: 100px` → `width: 300px` интерполируется. `width: 100px` → `width: 50%` тоже: обе величины —
`<length-percentage>`, промежуточное значение — `calc(...)`. А вот `width: 100px` → `width: auto`
**не интерполируется**: `auto` — ключевое слово, у него нет числового вида на этапе вычисленного
значения. Поведение — дискретное, то есть скачок. Отсюда вечная проблема «анимировать высоту до
`auto`», к которой вернёмся в разделе 4.

<details>
<summary>Плавные и дискретные свойства рядом</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-transitions-animations.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.4 system-ui, sans-serif; }
  .row { display: flex; gap: 12px; margin: 10px 0; align-items: center; }
  .box {
    width: 90px; height: 50px; background: #4a7; color: #fff;
    display: grid; place-items: center;
    transition: all 2s linear;
  }
  .demo:hover .w { width: 260px; }
  .demo:hover .c { background: #c44; }
  .demo:hover .s { font-style: italic; }
  .demo:hover .a { width: auto; padding: 0 40px; }
  .demo { border: 2px dashed #999; padding: 10px; }
</style>
</head>
<body>
  <p>Наведите курсор на рамку и держите 2 секунды.</p>
  <div class="demo">
    <div class="row"><div class="box w">width</div> длина → длина: плавно</div>
    <div class="row"><div class="box c">color</div> цвет → цвет: плавно</div>
    <div class="row"><div class="box s">курсив</div> font-style: скачок на 1-й секунде</div>
    <div class="row"><div class="box a">auto</div> width → auto: скачок, padding плавно</div>
  </div>
</body>
</html>
```

</details>

Обратите внимание на последнюю строку: дискретная половина (`width`) прыгает на середине, а
`padding` в той же декларации едет плавно. `transition: all` не делает свойства однотипными, он лишь
разрешает переход для каждого свойства по отдельности.

## 2. `transition`: механика

### 2.1. Четыре подсвойства

```css
.btn {
  transition-property: background-color, transform;
  transition-duration: 200ms, 400ms;
  transition-timing-function: ease-out;
  transition-delay: 0s;
}
/* то же самое коротко */
.btn { transition: background-color 200ms ease-out, transform 400ms ease-out; }
```

Начальные значения: `transition-property: all`, `transition-duration: 0s`,
`transition-timing-function: ease`, `transition-delay: 0s`. То есть переходы «включены» для всех
свойств, но длятся ноль секунд — потому их и не видно. В сокращённой записи первое время — это
длительность, второе — задержка.

Списки сопоставляются по индексу; если списков длительностей короче, чем свойств, они **повторяются
по кругу**.

### 2.2. Когда переход стартует

Браузер при каждом пересчёте стилей (style change event) сравнивает **вычисленное** значение свойства
до и после. Если оно изменилось и для свойства задана ненулевая продолжительность, создаётся переход.
Отсюда три следствия:

1. **Переход не стартует при первой отрисовке.** У элемента, только что вставленного в DOM, нет
   «старого» стиля. Отсюда трюки с `requestAnimationFrame` и принудительным чтением `offsetWidth` —
   и современная замена, `@starting-style` (раздел 3.3).
2. **Изменение и откат в одном кадре не дают перехода.** Если JS поставил класс и тут же снял его,
   браузер пересчитает стили один раз и разницы не увидит.
3. **Важны правила того состояния, в которое переходим.** `transition` берётся из стиля *после*
   изменения. Поэтому разные `transition` на `.btn` и на `.btn:hover` дают разную скорость «туда» и
   «обратно».

<details>
<summary>Разная скорость туда и обратно</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-transitions-animations.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 20px; }
  .card {
    width: 220px; padding: 16px; background: #eef; border: 2px solid #557;
    /* уход с наведения: медленно */
    transition: transform 1.2s ease-in-out, box-shadow 1.2s;
  }
  .card:hover {
    transform: translateY(-12px);
    box-shadow: 0 12px 20px rgb(0 0 0 / .3);
    /* наведение: быстро */
    transition-duration: .15s;
  }
</style>
</head>
<body>
  <div class="card">Наведите и уведите курсор: вверх — мгновенно, вниз — плавно.</div>
</body>
</html>
```

</details>

### 2.3. Прерывание и «обратный» переход

Если увести курсор посреди перехода, новый переход начнётся **от текущего промежуточного значения**.
Наивно это дало бы ту же длительность на меньшее расстояние — движение заметно замедлилось бы.
Спецификация это учитывает: при развороте к исходному значению длительность сокращается
пропорционально пройденному пути (reversing shortening factor). Поэтому быстрые «наведение—уход»
выглядят естественно.

### 2.4. События

`transitionrun` (создан, ещё в задержке), `transitionstart` (задержка кончилась), `transitionend`,
`transitioncancel`. Ловушка: `transitionend` приходит **на каждое свойство отдельно** и всплывает от
потомков. Проверяйте `event.propertyName` и `event.target === element`. Если переход прерван (элемент
скрыт через `display: none`, свойство изменилось обратно до конца), приходит `transitioncancel`, а
`transitionend` — нет. Код, который ждёт `transitionend`, чтобы удалить элемент, должен иметь запасной
таймер.

## 3. Появление и исчезновение: `display`, `visibility`, `@starting-style`

### 3.1. Почему `display: none` ломает переход

`display` дискретен. Но хуже другое: у элемента с `display: none` **нет блока** (box), он не
отрисовывается, и никакие промежуточные `opacity` у него не видны. Классическая ошибка:

```css
.menu { display: none; opacity: 0; transition: opacity .3s; }
.menu.open { display: block; opacity: 1; }   /* появляется мгновенно */
```

При открытии элемент получает блок и сразу `opacity: 1`: у браузера не было отрисованного «старого»
состояния с блоком, переход не виден (в старых браузерах — не создавался вовсе). При закрытии
`display: none` срабатывает сразу, и затухать нечему.

### 3.2. Старый трюк: `visibility`

`visibility` интерполируется особым образом: если одно из значений `visible`, то **все промежуточные
значения — `visible`**. Значит, при переходе `visible → hidden` элемент остаётся видимым всё время
перехода и прячется в самом конце, а при `hidden → visible` становится видимым сразу. Это ровно то,
что нужно для затухания:

```css
.menu { visibility: hidden; opacity: 0; transition: opacity .3s, visibility .3s; }
.menu.open { visibility: visible; opacity: 1; }
```

Скрытый через `visibility` элемент не получает кликов и фокуса, исчезает из дерева доступности. Но он
**занимает место** в раскладке. Для абсолютно позиционированных меню и подсказок это неважно, для
элементов в потоке — проблема.

### 3.3. Современный путь: `allow-discrete` и `@starting-style`

Два новых инструмента (Chrome 117, Safari 17.4, Firefox 129):

- `transition-behavior: allow-discrete` разрешает переходы **дискретных** свойств. Для большинства
  из них это скачок на середине, но `display` и `content-visibility` обработаны особо: когда одна из
  сторон — `none` (`hidden`), значение держится «видимым» на протяжении **всего** перехода. Это то
  же, что делает `visibility`, только для `display`.
- `@starting-style { ... }` описывает стиль, который считается «старым» для элемента, у которого
  старого стиля не было: только что вставлен в DOM или вышел из `display: none`.

<details>
<summary>Плавное появление из display: none и обратно</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-transitions-animations.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 20px; }
  .panel {
    display: none;
    opacity: 0;
    transform: translateY(-10px);
    margin-top: 10px; padding: 14px; width: 260px;
    background: #fffbe6; border: 2px solid #c90;
    transition:
      opacity .4s, transform .4s,
      display .4s allow-discrete;
  }
  .panel.open { display: block; opacity: 1; transform: none; }
  @starting-style {
    .panel.open { opacity: 0; transform: translateY(-10px); }
  }
</style>
</head>
<body>
  <button onclick="document.querySelector('.panel').classList.toggle('open')">Показать / скрыть</button>
  <div class="panel">Появляюсь из display: none и плавно туда же ухожу.</div>
</body>
</html>
```

</details>

Важно, где стоит `@starting-style`: **после** обычного правила `.panel.open`, с той же специфичностью.
`@starting-style` не добавляет специфичности, и правила внутри него соревнуются в каскаде как обычные.
Если поставить его выше, основное правило перебьёт стартовые значения.

Старый стиль в браузерах без поддержки просто игнорируется: панель будет появляться без анимации —
корректная деградация.

Для `<dialog>` и элементов с `popover` есть третий участник: свойство `overlay`. При закрытии элемент
мгновенно уходит из **верхнего слоя** (top layer), и анимация выхода разыгралась бы «под» страницей.
Добавьте `overlay .3s allow-discrete` в список переходов, чтобы элемент оставался в верхнем слое до
конца.

```css
dialog, dialog::backdrop { transition: opacity .3s, display .3s allow-discrete, overlay .3s allow-discrete; }
dialog:not([open]) { opacity: 0; }
@starting-style { dialog[open] { opacity: 0; } }
```

## 4. Высота до `auto`: три подхода

| Подход | Как | Цена |
|---|---|---|
| `max-height` | `0` → `max-height: 1000px` | «мёртвое время»: скорость рассчитана на 1000px, при закрытии ждём, пока число дойдёт до реальной высоты |
| Grid-трюк | `grid-template-rows: 0fr` → `1fr`, ребёнок `overflow: hidden; min-height: 0` | работает везде; доли (`fr`) интерполируются |
| `interpolate-size: allow-keywords` | на `:root`, затем `height: 0` → `height: auto` | только Chromium (с версии 129); в остальных — скачок |

<details>
<summary>Grid-трюк и max-height рядом</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-transitions-animations.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.4 system-ui, sans-serif; padding: 16px; display: flex; gap: 20px; }
  section { width: 230px; }
  .grid { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .5s; }
  .grid > div { overflow: hidden; min-height: 0; }
  .open .grid { grid-template-rows: 1fr; }
  .mh { max-height: 0; overflow: hidden; transition: max-height .5s; }
  .open .mh { max-height: 1000px; }
  .body { background: #e8f4ff; border-left: 4px solid #38c; padding: 0 10px; }
</style>
</head>
<body>
  <section>
    <button onclick="this.parentNode.classList.toggle('open')">Grid 0fr → 1fr</button>
    <div class="grid"><div><p class="body">Короткий текст. Закрывается сразу, без задержки.</p></div></div>
  </section>
  <section>
    <button onclick="this.parentNode.classList.toggle('open')">max-height</button>
    <div class="mh"><p class="body">Тот же текст. Закрытие начинается с паузой: max-height сначала «проезжает» пустые сотни пикселей.</p></div>
  </section>
</body>
</html>
```

</details>

Почему `min-height: 0` у ребёнка? У элемента сетки по умолчанию `min-height: auto`, а это
«не меньше содержимого». Без сброса строка `0fr` не схлопнется ниже высоты текста.

## 5. Функции времени

Функция времени (easing function) переводит долю **времени** в долю **прогресса**. Время идёт ровно;
кривая решает, где ускорить.

### 5.1. `cubic-bezier()`

Кривая Безье с концами в (0,0) и (1,1) и двумя управляющими точками. Ключевые слова — частные случаи:

| Ключевое слово | Эквивалент | Характер |
|---|---|---|
| `ease` (по умолчанию) | `cubic-bezier(.25, .1, .25, 1)` | быстрый старт, долгое торможение |
| `ease-in` | `cubic-bezier(.42, 0, 1, 1)` | разгон; хорош для ухода с экрана |
| `ease-out` | `cubic-bezier(0, 0, .58, 1)` | торможение; хорош для появления |
| `ease-in-out` | `cubic-bezier(.42, 0, .58, 1)` | симметрично |
| `linear` | `cubic-bezier(0, 0, 1, 1)` | равномерно; для вращения и прогресса |

X управляющих точек ограничен отрезком [0, 1] (время не может идти назад), а Y — нет. Y > 1 даёт
«перелёт» (overshoot): `cubic-bezier(.3, 1.6, .6, 1)` — пружинка.

### 5.2. `steps()`

`steps(4, jump-end)` делит время на 4 интервала и держит значение постоянным внутри каждого.
Параметр говорит, где прыжок: `jump-start` (сразу в начале интервала), `jump-end` (в конце, по
умолчанию; синоним `end`), `jump-none` (нет прыжка ни в начале, ни в конце — 4 шага включают оба
крайних значения), `jump-both`. Применение — спрайтовая анимация, мигающий курсор, «печатающийся» текст.

### 5.3. `linear()` — кусочно-линейная функция

`linear(0, 0.25 25%, 1)` — ломаная по точкам. С достаточно большим числом точек ею приближают
что угодно: отскок, затухающие колебания пружины. Поддержка: Chrome 113, Firefox 112, Safari 17.2.

<details>
<summary>Сравнение функций времени</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-transitions-animations.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 13px system-ui, sans-serif; padding: 10px; }
  .track { position: relative; height: 30px; margin: 6px 0; border-bottom: 1px solid #ccc; }
  .track span { position: absolute; left: 0; top: 4px; padding: 2px 6px; background: #47a; color: #fff;
    border-radius: 4px; transition: transform 2s; white-space: nowrap; }
  body.go .track span { transform: translateX(300px); }
  .a span { transition-timing-function: linear; }
  .b span { transition-timing-function: ease; }
  .c span { transition-timing-function: ease-in; }
  .d span { transition-timing-function: ease-out; }
  .e span { transition-timing-function: cubic-bezier(.3, 1.6, .6, 1); }
  .f span { transition-timing-function: steps(5, jump-end); }
  .g span { transition-timing-function: linear(0, 1.1 40%, .95 55%, 1.02 70%, 1); }
</style>
</head>
<body>
  <button onclick="document.body.classList.toggle('go')">Запустить / вернуть</button>
  <div class="track a"><span>linear</span></div>
  <div class="track b"><span>ease</span></div>
  <div class="track c"><span>ease-in</span></div>
  <div class="track d"><span>ease-out</span></div>
  <div class="track e"><span>cubic-bezier перелёт</span></div>
  <div class="track f"><span>steps(5)</span></div>
  <div class="track g"><span>linear() пружина</span></div>
</body>
</html>
```

</details>

## 6. `@keyframes` и `animation`

### 6.1. Ключевые кадры

```css
@keyframes pulse {
  from { transform: scale(1); }        /* = 0% */
  50%  { transform: scale(1.15); animation-timing-function: ease-in; }
  to   { transform: scale(1); }        /* = 100% */
}
```

Пропущенные `0%`/`100%` браузер достраивает из текущего вычисленного значения элемента. Это удобно:
`@keyframes fade-in { from { opacity: 0 } }` выведет элемент к той непрозрачности, что задана в его
стилях. `animation-timing-function` внутри кадра действует на отрезок **от этого кадра до следующего**,
а не на всю анимацию. `!important` внутри кадров игнорируется (объявление отбрасывается).

Если два блока `@keyframes` с одним именем — побеждает последний целиком (кадры не сливаются).

### 6.2. Подсвойства

| Свойство | Начальное значение | Смысл |
|---|---|---|
| `animation-name` | `none` | какие `@keyframes` |
| `animation-duration` | `auto` (= 0s для обычных анимаций) | длительность одного цикла |
| `animation-timing-function` | `ease` | кривая для каждого отрезка между кадрами |
| `animation-delay` | `0s` | отрицательная задержка — старт «с середины» |
| `animation-iteration-count` | `1` | число или `infinite`; дробные допустимы |
| `animation-direction` | `normal` | `reverse`, `alternate`, `alternate-reverse` |
| `animation-fill-mode` | `none` | см. 6.3 |
| `animation-play-state` | `running` | `paused` замораживает время |

Отрицательная задержка — полезный приём: `animation-delay: -0.5s` для каждого следующего элемента
«раскладывает» одинаковые анимации по фазам без ожидания при загрузке.

### 6.3. `animation-fill-mode` и место анимаций в каскаде

Анимация — это **отдельный уровень каскада** (origin «Animations»), и он стоит выше всех обычных
объявлений, включая ваши авторские, но ниже `!important` и переходов. (Порядок слоёв —
в курсе [Каскад и специфичность](LEARN_CSS_CASCADE_COURSE.md).) Пока анимация активна, её значения
перекрывают ваши правила. Вопрос — что происходит **до** старта (во время задержки) и **после**
окончания:

| `fill-mode` | Во время задержки | После конца |
|---|---|---|
| `none` | обычный стиль | обычный стиль (откат!) |
| `forwards` | обычный стиль | значение последнего кадра |
| `backwards` | значение первого кадра | обычный стиль |
| `both` | первый кадр | последний кадр |

<details>
<summary>animation-fill-mode в действии</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-transitions-animations.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; padding: 10px; }
  @keyframes slide { from { transform: translateX(0); background: #c33; } to { transform: translateX(240px); background: #3a5; } }
  .b { width: 120px; margin: 8px 0; padding: 6px; color: #fff; background: #888; }
  .run .b { animation: slide 1s 1s ease-out; }
  .run .f1 { animation-fill-mode: none; }
  .run .f2 { animation-fill-mode: forwards; }
  .run .f3 { animation-fill-mode: backwards; }
  .run .f4 { animation-fill-mode: both; }
</style>
</head>
<body>
  <button onclick="var r=document.getElementById('r');r.classList.remove('run');void r.offsetWidth;r.classList.add('run')">Запустить (задержка 1 с)</button>
  <p>Серый — обычный стиль. Красный — первый кадр, зелёный — последний.</p>
  <div id="r">
    <div class="b f1">none</div>
    <div class="b f2">forwards</div>
    <div class="b f3">backwards</div>
    <div class="b f4">both</div>
  </div>
</body>
</html>
```

</details>

Обратите внимание на кнопку: `void r.offsetWidth` между снятием и установкой класса. Без этого
снятие и установка попали бы в один пересчёт стилей, `animation-name` формально не изменился бы, и
анимация не перезапустилась бы. Чтение `offsetWidth` принудительно пересчитывает стили и раскладку
(подробно — в курсе [Производительность CSS](LEARN_CSS_PERFORMANCE_COURSE.md)).

Совет по `forwards`: он удерживает значения уровня анимаций **навсегда**, и ваши обычные правила
больше не могут их изменить (например, при последующем `:hover`). Часто чище по окончании анимации
поставить конечное значение в обычный стиль, а `fill-mode` не трогать — или использовать `backwards`,
чтобы элемент не мелькнул до начала.

### 6.4. Переход или анимация?

| Задача | Выбор |
|---|---|
| реакция на смену состояния (hover, класс) | `transition` |
| цикл, многоэтапное движение | `@keyframes` |
| нужно начать при загрузке | `@keyframes` или `@starting-style` |
| состояние может прерваться посередине | `transition` — он разворачивается от текущего значения |

## 7. Где в конвейере живёт анимация

Каждый кадр браузер проходит этапы **стиль → раскладка (layout) → отрисовка (paint) → композиция
(composite)**. Чем раньше этап, затронутый свойством, тем больше работы на каждый из 60 (или 120)
кадров в секунду:

| Свойство | Пересчитывает | Цена кадра |
|---|---|---|
| `width`, `height`, `top`, `left`, `margin`, `padding`, `font-size` | раскладку, отрисовку, композицию | высокая, растёт с размером страницы |
| `color`, `background-color`, `box-shadow`, `border-radius` | отрисовку и композицию | средняя, `box-shadow` и `filter: blur` дорогие |
| `transform`, `opacity` (и часто `filter`) | только композицию | низкая; может идти в потоке композитора |

`transform` и `opacity` не меняют геометрию в потоке: соседи не сдвигаются, текст не переносится.
Если элемент вынесен на отдельный **композитный слой** (compositing layer), браузер может
анимировать его в потоке композитора (compositor thread) — **без участия главного потока**. Пока
главный поток занят JavaScript, такая анимация продолжает идти плавно.

<details>
<summary>Главный поток занят: left против transform</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-transitions-animations.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui, sans-serif; padding: 10px; }
  .lane { position: relative; height: 40px; border-bottom: 1px solid #ddd; }
  .dot { position: absolute; top: 5px; width: 30px; height: 30px; border-radius: 50%; }
  .l { background: #c33; animation: byLeft 2s ease-in-out infinite alternate; }
  .t { background: #3a5; animation: byTransform 2s ease-in-out infinite alternate; }
  @keyframes byLeft { from { left: 0; } to { left: 300px; } }
  @keyframes byTransform { from { transform: translateX(0); } to { transform: translateX(300px); } }
</style>
</head>
<body>
  <button onclick="var e=Date.now()+1500;while(Date.now()<e){}">Занять главный поток на 1,5 с</button>
  <div class="lane"><div class="dot l"></div></div> красный: left
  <div class="lane"><div class="dot t"></div></div> зелёный: transform
  <p>Нажмите кнопку: красный замрёт, зелёный в Chrome и Firefox продолжит двигаться.</p>
</body>
</html>
```

</details>

Практические выводы:

- двигайте `transform: translate()`, а не `top`/`left`;
- «раскрывайте» через `transform: scale()`, когда допустимо искажение содержимого (или анимируйте
  обёртку и обратный `scale` у ребёнка — техника FLIP);
- тень анимируйте через `opacity` псевдоэлемента с готовой тенью, а не через `box-shadow`;
- `will-change: transform` заранее выносит элемент на слой, но это не «волшебная скорость» — см.
  курс о производительности.

Отдельные свойства `translate`, `rotate`, `scale` (все браузеры с 2022 года) удобны тем, что их можно
анимировать независимо: `:hover { scale: 1.1 }` не затирает `translate` из другого правила, как это
делает единый `transform`. Применяются они в порядке translate → rotate → scale → transform.

## 8. Пользовательские свойства в анимациях

Обычное пользовательское свойство (`--x`) — это просто последовательность токенов, тип ему неизвестен,
поэтому оно анимируется дискретно. `@property` регистрирует тип, и интерполяция становится плавной:

```css
@property --angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
.ring { background: conic-gradient(#38c var(--angle), #eee 0); transition: --angle 1s; }
.ring:hover { --angle: 270deg; }
```

Так анимируют то, что само по себе не интерполируется: остановки градиентов, отдельные компоненты
цвета. Подробно о `@property` — в курсе
[Пользовательские свойства и темы](LEARN_CSS_CUSTOM_PROPERTIES_COURSE.md).

<details>
<summary>Анимация угла conic-gradient через @property</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-transitions-animations.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  @property --p { syntax: "<percentage>"; inherits: false; initial-value: 0%; }
  body { font: 14px system-ui, sans-serif; padding: 20px; display: flex; gap: 30px; }
  .ring { width: 120px; aspect-ratio: 1; border-radius: 50%;
    background: conic-gradient(#38c var(--p), #e5e5e5 0); transition: --p 1.2s ease-out; }
  .ring:hover { --p: 75%; }
  .plain { --q: 0%; width: 120px; aspect-ratio: 1; border-radius: 50%;
    background: conic-gradient(#c63 var(--q), #e5e5e5 0); transition: --q 1.2s; }
  .plain:hover { --q: 75%; }
</style>
</head>
<body>
  <div><div class="ring"></div><p>@property: плавно</p></div>
  <div><div class="plain"></div><p>без @property: скачок</p></div>
</body>
</html>
```

</details>

## 9. `prefers-reduced-motion`

Пользователи с вестибулярными расстройствами могут испытывать головокружение и тошноту от крупного
движения, параллакса, масштабирования. Операционные системы дают настройку «уменьшить движение», а CSS
её видит:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

Почему `1ms`, а не `none`? Код, который ждёт `animationend`/`transitionend`, должен продолжать
работать; при `animation: none` события не придут. Это «грубый молоток» — лучше подход наоборот:

```css
.hero { opacity: 1; }
@media (prefers-reduced-motion: no-preference) {
  .hero { animation: rise .6s ease-out backwards; }
}
```

Движение добавляется только тем, кто не просил его убрать. И «уменьшить» не значит «удалить всё»:
плавная смена цвета или прозрачности обычно допустима, опасны перемещение, масштаб и вращение.
WCAG 2.3.3 (AAA) требует возможности отключить анимацию, вызванную взаимодействием, а 2.2.2 (A) —
возможности остановить любое движение, длящееся дольше 5 секунд.

<details>
<summary>Анимация только для тех, кто не против</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-transitions-animations.html#example-9">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 20px; }
  .spinner { width: 50px; height: 50px; border: 6px solid #ddd; border-top-color: #38c; border-radius: 50%; }
  @media (prefers-reduced-motion: no-preference) {
    .spinner { animation: spin 1s linear infinite; }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner { border-color: #38c; opacity: .5; animation: breathe 2s ease-in-out infinite alternate; }
  }
  @keyframes spin { to { rotate: 1turn; } }
  @keyframes breathe { to { opacity: 1; } }
</style>
</head>
<body>
  <div class="spinner"></div>
  <p>Включите «уменьшение движения» в настройках ОС (или эмулируйте в DevTools → Rendering):
  вращение сменится мягкой пульсацией прозрачности.</p>
</body>
</html>
```

</details>

## 10. View Transitions: введение

Переходы и анимации работают с одним элементом в одном DOM. А как анимировать смену **состояния
страницы**: список превратился в карточку, одна страница сменилась другой? Раньше это требовало
держать в DOM оба состояния сразу. **View Transitions API** делает это так:

1. браузер делает «снимок» текущего вида;
2. ваш колбэк меняет DOM как угодно;
3. браузер строит дерево псевдоэлементов со старым снимком и живым новым видом и анимирует между ними.

```js
document.startViewTransition(() => {
  list.hidden = true;
  card.hidden = false;
});
```

По умолчанию анимируется вся страница (имя `root`) кросс-фейдом. Элементам можно дать
`view-transition-name: hero` — тогда для них строится отдельная пара снимков, и браузер **сам**
анимирует позицию и размер от старого места к новому. Имена должны быть уникальны в момент снимка.

Псевдоэлементы, которые можно стилизовать:

```
::view-transition
└─ ::view-transition-group(hero)
   └─ ::view-transition-image-pair(hero)
      ├─ ::view-transition-old(hero)
      └─ ::view-transition-new(hero)
```

```css
::view-transition-old(root), ::view-transition-new(root) { animation-duration: .4s; }
```

Для переходов между **разными документами** одного источника (origin) достаточно CSS на обеих
страницах: `@view-transition { navigation: auto; }`. Поддержка: однодокументные — Chrome 111,
Safari 18, Firefox (с 2025 года); межстраничные — Chrome 126 и Safari 18.2. Без поддержки
`startViewTransition` отсутствует — проверяйте и вызывайте колбэк напрямую.

<details>
<summary>View Transition: элемент переезжает между состояниями</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/css-transitions-animations.html#example-10">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui, sans-serif; padding: 16px; }
  .stage { display: flex; gap: 10px; min-height: 160px; }
  .stage.big { flex-direction: column; }
  .tile { view-transition-name: tile; background: #38c; color: #fff; padding: 10px; width: 80px; height: 40px; }
  .stage.big .tile { width: 300px; height: 120px; font-size: 22px; }
  .other { background: #eee; padding: 10px; width: 80px; height: 40px; }
  ::view-transition-group(tile) { animation-duration: .6s; }
</style>
</head>
<body>
  <button id="b">Переключить</button>
  <p id="s"></p>
  <div class="stage" id="st"><div class="other">A</div><div class="tile">Плитка</div><div class="other">B</div></div>
  <script>
    var st = document.getElementById('st');
    document.getElementById('s').textContent = document.startViewTransition
      ? 'View Transitions поддерживаются.' : 'Не поддерживается: смена будет мгновенной.';
    document.getElementById('b').onclick = function () {
      var change = function () { st.classList.toggle('big'); };
      if (document.startViewTransition) document.startViewTransition(change); else change();
    };
  </script>
</body>
</html>
```

</details>

Во время перехода страница не реагирует на клики (снимки поверх неё). Анимации View Transitions — это
обычные CSS-анимации на псевдоэлементах, поэтому правило из раздела 9 про
`prefers-reduced-motion` действует и на них.

## 11. Анимации из JavaScript, кратко

Web Animations API — это тот же движок, что и у CSS-анимаций, но с доступом из JS:

```js
const a = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out', fill: 'backwards' });
await a.finished;
document.getAnimations(); // и CSS-анимации, и переходы, и созданные через animate()
```

Им удобно управлять (пауза, перемотка, `playbackRate`), и он не требует правил в таблице стилей.
Подробнее — в курсе [Производительность JavaScript в браузере](LEARN_JAVASCRIPT_PERFORMANCE_COURSE.md)
(раздел о `requestAnimationFrame`).

## Итог

- Анимация — подмена вычисленного значения промежуточными. Свойство интерполируется, только если оба
  значения одного типа; `auto` и ключевые слова — дискретны.
- `transition` стартует при изменении вычисленного значения между пересчётами стилей; при первой
  отрисовке его нет — для этого `@starting-style`.
- `display: none` убирает блок. Для плавного скрытия — `visibility`-трюк или
  `transition-behavior: allow-discrete` + `@starting-style` (+ `overlay` для верхнего слоя).
- `animation-fill-mode` решает, что видно до старта и после конца; анимации — отдельный уровень
  каскада над авторскими стилями.
- Дёшево анимировать `transform` и `opacity`: только композиция, часто вне главного потока.
- Уважайте `prefers-reduced-motion`: лучше добавлять движение в `no-preference`, чем вырезать в `reduce`.
- View Transitions анимируют смену состояния DOM снимками; для межстраничных — `@view-transition`.

## Проверьте себя

1. Почему переход `height: 0 → auto` не работает и какие есть три способа обойти это?
2. Элемент получает класс `.open` с `display: block; opacity: 1` из `display: none; opacity: 0`. Что
   нужно добавить, чтобы он плавно появлялся и плавно исчезал? Почему `@starting-style` должен идти
   после основного правила?
3. Чем отличаются `animation-fill-mode: forwards` и `backwards`? Почему `forwards` может мешать
   последующему `:hover`?
4. Почему `transform: translateX()` продолжает двигаться при занятом главном потоке, а `left` — нет?
5. Как интерполируется `visibility` и почему из-за этого работает старый трюк с затуханием?

Дальше: [CSS для печати](LEARN_CSS_PRINT_COURSE.md).
