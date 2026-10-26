# Медиа: изображения, видео, SVG

> Курс 29 из программы. Для тех, кто уже уверенно владеет потоком, блочной и строчной моделью и
> каскадом. Здесь мы разбираем, как браузер загружает, измеряет и рисует **замещаемые элементы**
> (replaced elements) — картинки, видео, фреймы — и почему они ведут себя не как обычный текст.

**Что вы будете понимать после курса**

- что такое замещаемый элемент и откуда у него берётся размер;
- как правильно писать `alt` и когда он должен быть пустым;
- почему `width` и `height` у `<img>` снова обязательны и как они связаны с `aspect-ratio`;
- как браузер выбирает файл из `srcset` и что на самом деле означает `sizes`;
- чем `<picture>` (художественная подстановка, art direction) отличается от `srcset` (выбор разрешения);
- откуда берётся щель под картинкой и почему её чинят двумя разными способами;
- правила автозапуска видео, субтитры и `<track>`;
- три способа вставить SVG и что умеет каждый, включая `currentColor`;
- как ограничить `<iframe>` атрибутами `sandbox` и `allow`.

---

## 1. Замещаемый элемент: содержимое снаружи CSS

Обычный элемент рисует то, что внутри него в дереве: текст, дочерние блоки. **Замещаемый
элемент** (replaced element) рисует то, что находится вне CSS-модели: растровый файл, кадр видео,
целый другой документ. CSS управляет только рамкой вокруг этого содержимого.

| Элемент | Содержимое | Естественный размер (natural size) |
|---|---|---|
| `<img>` | растр или SVG | размер файла в CSS-пикселях с учётом плотности |
| `<video>` | кадры | размер видеопотока; до загрузки — 300×150 |
| `<iframe>` | другой документ | своего нет, по умолчанию 300×150 |
| `<canvas>` | битмап | атрибуты `width`/`height`, по умолчанию 300×150 |
| `<input type="image">`, `<embed>`, `<object>` | разное | разное |

Три следствия, которые объясняют половину курса:

1. У замещаемого элемента есть **естественные размеры** (intrinsic/natural dimensions) и
   **естественное соотношение сторон** (natural aspect ratio). Если задать только ширину, высота
   вычислится из пропорции — у `div` так не бывает.
2. По умолчанию `<img>` — строчный элемент (`display: inline`), но ведёт себя как
   `inline-block`: у него есть ширина и высота, он сидит на базовой линии строки.
3. Псевдоэлементы `::before`/`::after` у `<img>` не работают: у него нет «внутренности», куда
   их вставить. (Firefox и Chrome рисуют их только для битой картинки — на это нельзя полагаться.)

## 2. `<img>`: атрибуты, которые нельзя пропускать

### 2.1. `alt` — не подпись, а замена

`alt` — **текстовая альтернатива** (text alternative): то, что должно оказаться на месте картинки,
если её не видно. Его читает экранный диктор, его показывает браузер при ошибке загрузки, его
индексирует поиск. Правило одно: представьте, что картинку заменили текстом. Какой текст нужен,
чтобы смысл фразы не пострадал?

| Роль картинки | Правильный `alt` |
|---|---|
| Несёт информацию («график роста продаж») | то, что из неё надо узнать: «Продажи выросли втрое за 2025 год» |
| Единственное содержимое ссылки или кнопки | действие: `alt="На главную"`, а не «логотип» |
| Декоративная (рамка, фоновая фотография) | **пустой**: `alt=""` |
| Дублирует текст рядом («иконка телефона» перед номером) | пустой: `alt=""` |
| Сложная (схема, диаграмма) | краткий `alt` плюс подробное описание рядом в тексте или `<figcaption>` |

Пустой `alt=""` и **отсутствие** `alt` — разные вещи. Пустой атрибут говорит: «картинка
декоративная, пропустите её», и в дереве доступности она исчезает (роль `presentation`).
Отсутствующий атрибут означает «автор забыл», и диктор, чтобы хоть что-то сказать, зачитает имя
файла: «IMG underscore 2041 точка jpeg».

Не начинайте `alt` словами «картинка» или «изображение»: диктор уже сказал «изображение».

### 2.2. `width` и `height` — против сдвига вёрстки

Пока файл не загружен, браузер не знает его размера. Если размера нет и в разметке, картинка
сначала занимает 0×0, а после загрузки раздвигает текст. Этот скачок называется **сдвигом макета**
(layout shift) и измеряется метрикой CLS (Cumulative Layout Shift).

В 2010-х атрибуты `width`/`height` вышли из моды: адаптивная вёрстка требовала `max-width: 100%`,
а фиксированная высота в пикселях ломала пропорцию. Около 2020 года браузеры изменили стиль
браузера (UA stylesheet): теперь атрибуты превращаются в правило

```css
img { aspect-ratio: auto 640 / 360; } /* из width="640" height="360" */
```

Слово `auto` значит: «пока нет файла — используй 640/360; когда файл загрузится — его настоящую
пропорцию». Поэтому современная схема такая: в разметке — натуральный размер файла, в CSS —
резина.

```css
img { max-width: 100%; height: auto; }
```

`height: auto` обязателен: иначе атрибут `height="360"` стал бы фиксированной высотой, и при
сжатой ширине картинка сплющилась бы.

<details>
<summary>Резерв места: с размерами и без</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-media.html#example-1">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 16px/1.4 system-ui; margin: 16px; }
  .col { display: inline-block; width: 45%; vertical-align: top; margin-right: 4%; }
  img { max-width: 100%; height: auto; outline: 2px dashed tomato; background: #eee; }
  p { background: #e6f0ff; margin: 8px 0; }
</style>
</head>
<body>
  <div class="col">
    <b>Без width/height</b>
    <!-- адрес не существует: картинка никогда не загрузится -->
    <img src="missing-file.jpg" alt="">
    <p>Текст сразу под картинкой: места не зарезервировано.</p>
  </div>
  <div class="col">
    <b>С width="640" height="360"</b>
    <img src="missing-file.jpg" alt="" width="640" height="360">
    <p>Здесь браузер оставил прямоугольник 16:9 ещё до загрузки.</p>
  </div>
</body>
</html>
```

</details>

### 2.3. `aspect-ratio` для всего остального

Свойство `aspect-ratio` работает и на обычных блоках. Для картинок оно полезно, когда файлы
разных пропорций нужно уложить в одинаковые карточки — вместе с `object-fit` (раздел 4).

```css
.card img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; }
```

### 2.4. `loading`, `decoding`, `fetchpriority`

| Атрибут | Значения | Что делает |
|---|---|---|
| `loading` | `eager` (по умолчанию), `lazy` | `lazy` откладывает загрузку, пока картинка не приблизится к области просмотра |
| `decoding` | `auto`, `sync`, `async` | подсказка, можно ли декодировать файл вне основного кадра отрисовки |
| `fetchpriority` | `auto`, `high`, `low` | приоритет сетевого запроса относительно других ресурсов |

Тонкости, о которых чаще всего ошибаются:

- `loading="lazy"` на **главной картинке первого экрана** (LCP-элементе) вредит: браузер узнает о
  ней позже, чем мог бы. Ленивыми делают то, что ниже сгиба.
- Ленивой картинке особенно нужны `width`/`height`: браузер решает «близко ли она», зная её
  положение, а без размеров все ленивые картинки схлопнуты в одну точку.
- `fetchpriority="high"` уместен ровно на одном-двух ресурсах: героическая картинка, ключевой
  шрифт. Если пометить так всё, приоритет снова становится одинаковым.
- `decoding="async"` почти ничего не стоит и не мешает; заметный эффект бывает на очень больших
  изображениях.

```html
<img src="hero.jpg" width="1600" height="900" alt="…" fetchpriority="high">
<img src="photo-12.jpg" width="800" height="600" alt="…" loading="lazy" decoding="async">
```

## 3. Адаптивные изображения: `srcset`, `sizes`, `<picture>`

Есть две **разные** задачи, и для них разные инструменты:

| Задача | Пример | Инструмент |
|---|---|---|
| **Выбор разрешения** (resolution switching): та же картинка, разное число пикселей | телефону — 400 px, 4K-монитору — 2400 px | `srcset` + `sizes` на `<img>` |
| **Художественная подстановка** (art direction): другое кадрирование или другая картинка | на узком экране портрет крупно, на широком — панорама | `<picture>` + `<source media>` |
| **Выбор формата** | AVIF, если умеет; иначе JPEG | `<picture>` + `<source type>` |

Ключевое различие: в `srcset` вы даёте **варианты**, а выбирает **браузер** (может учесть
экономию трафика, кэш). В `<source media>` вы даёте **приказ**: первый подходящий `source`
обязателен.

### 3.1. Дескриптор `x` — для элементов фиксированного размера

```html
<img src="logo-1x.png" srcset="logo-1x.png 1x, logo-2x.png 2x, logo-3x.png 3x"
     width="120" height="40" alt="Компания">
```

Браузер сравнивает `devicePixelRatio` экрана с дескриптором. Подходит для логотипов и аватаров,
у которых CSS-ширина не меняется.

### 3.2. Дескриптор `w` и математика `sizes`

Если ширина картинки зависит от окна, `x` не помогает: браузер не знает, сколько CSS-пикселей
займёт картинка, — CSS ещё не загружен, а выбор файла происходит очень рано, на этапе
предзагрузки (preload scanner). Поэтому вы сообщаете два факта:

- `w` — сколько **пикселей в файле** по ширине;
- `sizes` — какой **ширины будет картинка** в вёрстке (в CSS-пикселях) при разных условиях.

```html
<img src="p-800.jpg"
     srcset="p-400.jpg 400w, p-800.jpg 800w, p-1600.jpg 1600w, p-2400.jpg 2400w"
     sizes="(min-width: 1000px) 33vw, (min-width: 600px) 50vw, 100vw"
     width="1600" height="1067" alt="…">
```

Алгоритм браузера:

1. Пройти `sizes` слева направо и взять **первое** условие, которое истинно. Последний элемент —
   без условия, значение по умолчанию. Значение `sizes` по умолчанию — `100vw`.
2. Получить ширину слота в CSS-пикселях.
3. Умножить на плотность экрана — это нужное число **физических** пикселей.
4. Выбрать из `srcset` подходящий файл (обычно ближайший, не меньший).

Посчитаем для окна шириной 1200 px с плотностью 2:

- `(min-width: 1000px)` истинно → слот `33vw` = 396 CSS px;
- 396 × 2 = 792 физических пикселя;
- кандидаты: 400w (мало), **800w** — выбран.

Для телефона 390 px и плотности 3: `100vw` → 390 × 3 = 1170 → выбран 1600w.

Частые ошибки:

- **Порядок в `sizes`**. Условия проверяются по порядку, побеждает первое истинное. Если поставить
  `(min-width: 600px)` раньше `(min-width: 1000px)`, широкий экран никогда не дойдёт до второго.
- **Забыли `sizes`** при `w`-дескрипторах: тогда `100vw`, и картинка в узкой колонке скачает
  огромный файл.
- `sizes` **не задаёт** ширину картинки. Он только сообщает браузеру прогноз. Реальную ширину по-
  прежнему задаёт CSS. Если прогноз ложный, браузер скачает не тот файл, но нарисует правильно.
- `sizes="auto"` — новое значение для `loading="lazy"`: ленивая картинка загружается после
  раскладки, и браузер может сам измерить слот. Поддержка ещё не во всех браузерах, поэтому пишут
  `sizes="auto, (min-width: 1000px) 33vw, 100vw"` — старые браузеры пропустят неизвестное `auto`.

<details>
<summary>Какой файл выбрал браузер: currentSrc</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-media.html#example-2">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.4 system-ui; margin: 16px; }
  img { width: 100%; height: auto; outline: 2px solid #4a7; }
  .wrap { width: 50%; }
  output { display: block; margin-top: 8px; font-family: monospace; }
</style>
</head>
<body>
  <p>Измените ширину окна и нажмите кнопку: браузер выбирает файл по sizes и плотности экрана.
     Уменьшать окно бесполезно: уже скачанный больший файл браузер вправе не менять на меньший.</p>
  <div class="wrap">
    <img id="pic" width="400" height="200" alt="Цветные полосы"
      sizes="50vw"
      srcset="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='200'%3E%3Crect width='400' height='200' fill='%23f6c'/%3E%3Ctext x='20' y='110' font-size='40'%3E400w%3C/text%3E%3C/svg%3E 400w,
              data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='400'%3E%3Crect width='800' height='400' fill='%236cf'/%3E%3Ctext x='20' y='220' font-size='80'%3E800w%3C/text%3E%3C/svg%3E 800w,
              data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='800'%3E%3Crect width='1600' height='800' fill='%23fc6'/%3E%3Ctext x='40' y='440' font-size='160'%3E1600w%3C/text%3E%3C/svg%3E 1600w">
  </div>
  <button id="b">Показать</button>
  <output id="o"></output>
  <script>
    b.onclick = () => {
      const slot = pic.getBoundingClientRect().width;
      o.textContent = 'слот ' + Math.round(slot) + ' CSS px × dpr ' + devicePixelRatio +
        ' = ' + Math.round(slot * devicePixelRatio) + ' px; выбран: ' +
        (pic.currentSrc.match(/(\d+)w/) || ['', '?'])[1] + 'w';
    };
  </script>
</body>
</html>
```

</details>

### 3.3. `<picture>`: art direction и форматы

`<picture>` — обёртка, которая сама ничего не рисует. Рисует всегда вложенный `<img>`; элементы
`<source>` лишь подменяют его `src`. Отсюда правила:

- `<img>` внутри обязателен и стоит **последним**;
- `alt`, `width`, `height`, `loading`, классы и стили пишутся на `<img>`, а не на `<picture>`;
- браузер берёт **первый** `<source>`, у которого подходят и `media`, и `type`; если ни один —
  `<img>`.

```html
<picture>
  <!-- форматы: от лучшего к запасному -->
  <source type="image/avif" srcset="a.avif">
  <source type="image/webp" srcset="a.webp">
  <img src="a.jpg" alt="…" width="1200" height="800">
</picture>
```

Каждый `<source>` может иметь свой `srcset` с `w`-дескрипторами и свой `sizes`, а с недавнего
времени — свои `width`/`height` (нужно, когда кадрирование в разных `source` даёт разную
пропорцию).

<details>
<summary>Art direction: другой кадр на узком экране</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-media.html#example-3">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px/1.4 system-ui; margin: 16px; }
  img { display: block; max-width: 100%; height: auto; border: 3px solid #333; }
</style>
</head>
<body>
  <p>Сузьте окно меньше 600px: вместо панорамы появится квадратный кадр.</p>
  <picture>
    <source media="(max-width: 600px)" width="300" height="300"
      srcset="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Crect width='300' height='300' fill='%23cde'/%3E%3Ccircle cx='150' cy='150' r='110' fill='%23e74'/%3E%3C/svg%3E">
    <img alt="Солнце над морем" width="900" height="300"
      src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='300'%3E%3Crect width='900' height='300' fill='%23cde'/%3E%3Crect y='200' width='900' height='100' fill='%2369c'/%3E%3Ccircle cx='450' cy='170' r='60' fill='%23e74'/%3E%3C/svg%3E">
  </picture>
</body>
</html>
```

</details>

## 4. `object-fit` и `object-position`

Когда рамка замещаемого элемента не совпадает с пропорцией содержимого, `object-fit` решает, как
вписать содержимое в рамку. Это то же, что `background-size`, только для `<img>` и `<video>`.

| Значение | Поведение |
|---|---|
| `fill` (по умолчанию) | растянуть до рамки, пропорция ломается |
| `contain` | целиком внутри, по краям пустые поля |
| `cover` | заполнить рамку, лишнее обрезается |
| `none` | натуральный размер, обрезка по рамке |
| `scale-down` | меньшее из `none` и `contain` |

`object-position` (по умолчанию `50% 50%`) задаёт, какая часть остаётся видимой при `cover` или
`none`. Например, у портретов лучше `object-position: 50% 20%`, чтобы не срезать голову.

<details>
<summary>object-fit: пять значений</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-media.html#example-4">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 13px system-ui; margin: 16px; display: flex; flex-wrap: wrap; gap: 12px; }
  figure { margin: 0; text-align: center; }
  img { width: 140px; height: 140px; background: repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 16px 16px;
        outline: 2px solid #333; display: block; }
</style>
</head>
<body>
  <figure><img style="object-fit: fill" alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='120'%3E%3Crect width='240' height='120' fill='%2369c'/%3E%3Ccircle cx='120' cy='60' r='50' fill='%23fc3'/%3E%3C/svg%3E"><figcaption>fill</figcaption></figure>
  <figure><img style="object-fit: contain" alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='120'%3E%3Crect width='240' height='120' fill='%2369c'/%3E%3Ccircle cx='120' cy='60' r='50' fill='%23fc3'/%3E%3C/svg%3E"><figcaption>contain</figcaption></figure>
  <figure><img style="object-fit: cover" alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='120'%3E%3Crect width='240' height='120' fill='%2369c'/%3E%3Ccircle cx='120' cy='60' r='50' fill='%23fc3'/%3E%3C/svg%3E"><figcaption>cover</figcaption></figure>
  <figure><img style="object-fit: cover; object-position: 0 50%" alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='120'%3E%3Crect width='240' height='120' fill='%2369c'/%3E%3Ccircle cx='120' cy='60' r='50' fill='%23fc3'/%3E%3C/svg%3E"><figcaption>cover + position 0</figcaption></figure>
  <figure><img style="object-fit: none" alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='120'%3E%3Crect width='240' height='120' fill='%2369c'/%3E%3Ccircle cx='120' cy='60' r='50' fill='%23fc3'/%3E%3C/svg%3E"><figcaption>none</figcaption></figure>
</body>
</html>
```

</details>

Когда выбирать `<img>` с `object-fit`, а когда `background-image`? Правило по смыслу: если
картинка — **содержимое** (её надо описать в `alt`, её можно сохранить, её ищет поиск), это
`<img>`. Если это **оформление** — фон. У `<img>` к тому же есть `srcset`, `loading="lazy"` и
ранняя предзагрузка, а фон из CSS браузер находит только после построения стилей.

## 5. Щель под картинкой

Классическая загадка: картинка в блоке с рамкой, а под картинкой — полоска в несколько пикселей.
Отступов нет, `margin: 0` не помогает.

Причина — в строчной модели (inline formatting context). `<img>` строчный, поэтому он стоит в
**строчном блоке** (line box) рядом с невидимым «распоркой» — воображаемым символом нулевой
ширины, который спецификация называет **strut**. У каждой строки есть базовая линия (baseline), и
по умолчанию `vertical-align: baseline`: нижний край картинки садится на базовую линию. Но ниже
базовой линии у шрифта есть место для **выносных элементов** (descenders) букв «у», «р», «g».
Это место и есть щель. Её высота зависит от `font-size` и `line-height` родителя.

Решения — и почему каждое работает:

| Способ | Почему исчезает щель | Когда не подходит |
|---|---|---|
| `img { display: block }` | блочный элемент не участвует в строке: нет базовой линии, нет strut | если картинка должна стоять в строке с текстом |
| `img { vertical-align: middle }` (или `top`, `bottom`) | картинка больше не садится на базовую линию | щель может вернуться, если `line-height` родителя больше высоты картинки |
| родителю `line-height: 0` или `font-size: 0` | strut становится нулевым | ломает текст внутри родителя; хак |
| родитель `display: flex` | дети flex-контейнера становятся flex-элементами, строки нет | меняет раскладку |

В quirks mode этой щели **нет** — браузеры исторически подгоняли строку под картинку. Подробнее в
[Истории](LEARN_HTML_HISTORY_QUIRKS_COURSE.md).

<details>
<summary>Щель под картинкой и три лекарства</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-media.html#example-5">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 32px/1.5 Georgia, serif; margin: 16px; display: flex; gap: 16px; flex-wrap: wrap; }
  .box { border: 3px solid crimson; background: gold; }
  img { width: 100px; height: 60px; background: #369; }
  small { display: block; font: 13px system-ui; }
</style>
</head>
<body>
  <div><div class="box"><img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='60'%3E%3Crect width='100' height='60' fill='%23369'/%3E%3C/svg%3E"></div><small>по умолчанию: жёлтая щель</small></div>
  <div><div class="box"><img alt="" style="display:block" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='60'%3E%3Crect width='100' height='60' fill='%23369'/%3E%3C/svg%3E"></div><small>display: block</small></div>
  <div><div class="box"><img alt="" style="vertical-align:bottom" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='60'%3E%3Crect width='100' height='60' fill='%23369'/%3E%3C/svg%3E"></div><small>vertical-align: bottom</small></div>
  <div><div class="box" style="line-height:0"><img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='60'%3E%3Crect width='100' height='60' fill='%23369'/%3E%3C/svg%3E"></div><small>line-height: 0 у родителя</small></div>
</body>
</html>
```

</details>

## 6. Видео и аудио

### 6.1. Разметка

```html
<video controls width="1280" height="720" poster="cover.jpg" preload="metadata">
  <source src="clip.webm" type="video/webm">
  <source src="clip.mp4" type="video/mp4">
  <track kind="captions" src="clip.ru.vtt" srclang="ru" label="Русский" default>
  <p>Ваш браузер не воспроизводит видео. <a href="clip.mp4">Скачать</a>.</p>
</video>
```

- `<source>` перебираются по порядку, берётся первый, чей `type` браузер может проиграть.
  Атрибут `type` экономит запросы: без него браузеру пришлось бы скачать начало файла.
- `poster` — картинка до первого кадра. Без неё до загрузки виден чёрный (или пустой) прямоугольник.
- `preload`: `none`, `metadata` (длительность и размер), `auto`. Это подсказка, браузер может её
  игнорировать (например, при экономии трафика).
- `width`/`height` работают как у `<img>`: дают пропорцию до загрузки метаданных.
- Содержимое между тегами, кроме `source` и `track`, видит только браузер без поддержки
  `<video>` — сегодня это запасной вариант скорее для роботов.

### 6.2. Политика автозапуска

Браузеры запрещают видео **со звуком** начинать играть без действия пользователя. Правила
различаются в деталях, но общее ядро одинаково:

- `autoplay` + `muted` разрешён почти всегда;
- `autoplay` со звуком — только если пользователь уже взаимодействовал с сайтом (клик, нажатие
  клавиши) или браузер считает сайт «часто смотрят» (у Chrome это Media Engagement Index);
- `video.play()` из JavaScript возвращает **Promise**, который отклоняется с ошибкой
  `NotAllowedError`, если запуск запрещён. Его надо ловить.

```js
video.play().catch(() => { showPlayButton(); });
```

- `playsinline` — на iPhone без него видео при запуске разворачивается на весь экран. Для
  фонового «живого» видео в шапке нужны все три: `autoplay muted playsinline` (и обычно `loop`).
- Фоновое видео без звука — это декорация. Учитывайте `prefers-reduced-motion` (см.
  [Доступность](LEARN_HTML_ACCESSIBILITY_COURSE.md)): дайте кнопку паузы или не запускайте вовсе.

### 6.3. `<track>` и WebVTT

`<track>` подключает файл формата **WebVTT** с текстовыми дорожками. Атрибут `kind`:

| `kind` | Для кого |
|---|---|
| `subtitles` (по умолчанию) | перевод речи для тех, кто слышит, но не понимает язык |
| `captions` | для глухих и слабослышащих: речь плюс звуки («[хлопает дверь]») |
| `descriptions` | текстовое описание видеоряда для незрячих |
| `chapters` | оглавление |
| `metadata` | данные для скриптов, не показываются |

Файл WebVTT — простой текст:

```text
WEBVTT

00:00:01.000 --> 00:00:04.000
Привет! Это субтитры.

00:00:04.500 --> 00:00:07.000
[за кадром звонит телефон]
```

Важная ловушка: `<track>` подчиняется правилу одного источника. Файл с другого домена без
`crossorigin` на `<video>` и CORS-заголовков на сервере не загрузится — и ошибки на экране не будет.

<details>
<summary>Видео с poster и субтитрами из data: URL</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-media.html#example-6">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 15px system-ui; margin: 16px; }
  video { width: 100%; max-width: 480px; height: auto; background: #222; }
</style>
</head>
<body>
  <p>Видеофайла нет, поэтому виден только poster. Это и есть то, что пользователь видит до загрузки.</p>
  <video controls width="480" height="270" preload="none"
    poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='480' height='270'%3E%3Crect width='480' height='270' fill='%23246'/%3E%3Cpolygon points='210,100 210,170 270,135' fill='white'/%3E%3C/svg%3E">
    <source src="no-such-clip.mp4" type="video/mp4">
    <track kind="captions" srclang="ru" label="Русский" default
      src="data:text/vtt,WEBVTT%0A%0A00:00:00.000 --> 00:00:05.000%0AСубтитры">
  </video>
</body>
</html>
```

</details>

## 7. SVG: три способа вставки

SVG — это XML-документ с векторной графикой. На странице его можно использовать тремя
способами, и они **принципиально** различаются тем, видит ли страница его внутренности.

| | `<img src="icon.svg">` | CSS `background-image: url(icon.svg)` | встроенный `<svg>` в HTML |
|---|---|---|---|
| Где живёт | отдельный документ | отдельный документ | часть DOM страницы |
| Стилизация из CSS страницы | нет | нет | да, любые свойства |
| `currentColor` от текста страницы | нет | нет | да |
| Скрипты внутри SVG | не выполняются | не выполняются | это скрипты страницы |
| Кэширование | да | да | нет, повторяется в каждом HTML |
| Доступность | `alt` | никакой, это фон | `role="img"` + `<title>` или `aria-label` |
| Внешние ресурсы внутри SVG (шрифты, картинки) | не загружаются | не загружаются | загружаются |

Отсюда типичный выбор:

- **иконки интерфейса**, которые должны красить себя в цвет текста, — встроенный `<svg>`, часто
  через спрайт `<use href="#id">`;
- **иллюстрации** с собственными цветами — `<img>`: кэш, `loading="lazy"`, `alt`;
- **декоративные узоры** — фон в CSS.

Ещё один вариант — CSS-маска: `mask: url(icon.svg) center / contain no-repeat; background:
currentColor;` позволяет перекрашивать внешний SVG-файл, сохраняя кэш. Цена — только один цвет.

### 7.1. `currentColor`

`currentColor` — ключевое слово, равное вычисленному значению `color` элемента. Внутри
встроенного SVG `fill="currentColor"` наследует `color` от окружающего HTML, поэтому иконка в
ссылке меняет цвет вместе с текстом при `:hover`. Через `<img>` этого не будет: SVG там —
отдельный документ, каскад страницы в него не проникает.

<details>
<summary>currentColor: встроенный SVG против img (наведите курсор)</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-media.html#example-7">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 20px system-ui; margin: 16px; }
  a { color: #36c; text-decoration: none; display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 12px; border: 2px solid currentColor; border-radius: 8px; margin: 6px; }
  a:hover { color: #c30; }
  svg, img { width: 24px; height: 24px; }
</style>
</head>
<body>
  <p>Наведите курсор на обе кнопки.</p>
  <a href="#">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg>
    встроенный svg
  </a>
  <a href="#">
    <img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='currentColor' d='M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z'/%3E%3C/svg%3E">
    svg через img
  </a>
  <p><small>В img currentColor равен цвету по умолчанию внутри SVG-документа, то есть чёрному.</small></p>
</body>
</html>
```

</details>

### 7.2. `viewBox` и размер

У встроенного `<svg>` без `width`/`height` в CSS размер по умолчанию — 300×150 (как у любого
замещаемого элемента без естественного размера), а если у него есть `viewBox`, браузеры
растягивают его на всю доступную ширину. Отсюда гигантские иконки, пока CSS не загрузился.
Пишите атрибуты `width="24" height="24"` прямо в разметке — CSS их перекроет.

`viewBox="0 0 24 24"` задаёт внутреннюю систему координат, а `preserveAspectRatio` — как её
вписать в рамку (аналог `object-fit`; по умолчанию `xMidYMid meet`, то есть «contain по центру»).

### 7.3. Доступность встроенного SVG

```html
<!-- декоративная иконка рядом с текстом -->
<svg aria-hidden="true" focusable="false">…</svg>

<!-- значимая графика -->
<svg role="img" aria-labelledby="t1"><title id="t1">Рост продаж втрое</title>…</svg>
```

`role="img"` нужен, чтобы дерево доступности считало SVG одной картинкой, а не набором фигур.

## 8. `<iframe>`: чужой документ в рамке

`<iframe>` встраивает целый документ со своим `window`, своим DOM и своим каскадом. Стили страницы
внутрь не проникают — это та же изоляция, что у SVG в `<img>`, только с работающими скриптами.

### 8.1. `sandbox`

Атрибут `sandbox` без значения включает **все** ограничения:

- документ считается **непрозрачным источником** (opaque origin) — не имеет доступа к cookie и
  хранилищам своего сайта;
- скрипты не выполняются, формы не отправляются;
- запрещены всплывающие окна, переход верхнего окна (`top.location`), модальные диалоги
  (`alert`), полноэкранный режим.

Каждый токен снимает одно ограничение: `allow-scripts`, `allow-forms`, `allow-popups`,
`allow-same-origin`, `allow-top-navigation-by-user-activation`, `allow-modals`,
`allow-downloads` и другие.

Опасная комбинация: `allow-scripts allow-same-origin` для документа **с вашего же** домена. Скрипт
внутри получает тот же источник, что и родитель, может дотянуться до `parent.document`, найти свой
`<iframe>` и снять с него `sandbox`. Песочница превращается в декорацию.

### 8.2. `allow` — политика разрешений

`allow` управляет доступом к возможностям устройства (Permissions Policy): камера, микрофон,
геолокация, полноэкранный режим, автозапуск, буфер обмена.

```html
<iframe src="https://video.example/embed/42"
        allow="autoplay; fullscreen; picture-in-picture"
        loading="lazy" title="Обзор продукта"
        width="560" height="315"></iframe>
```

- `title` у `<iframe>` обязателен для доступности: диктор называет им фрейм.
- `loading="lazy"` работает и здесь — тяжёлые виджеты ниже сгиба не грузятся заранее.
- `referrerpolicy` ограничивает, какой адрес страницы уйдёт встроенному сайту.
- Встраиваемый сайт может сам **запретить** себя встраивать заголовком
  `Content-Security-Policy: frame-ancestors` (или старым `X-Frame-Options`) — защита от
  кликджекинга (clickjacking).

<details>
<summary>sandbox: скрипт внутри srcdoc запущен или нет</summary>

<a href="https://slnknrr.codeberg.page/ru/course/in-html/html-media.html#example-8">see preview & continue study</a>

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { font: 14px system-ui; margin: 16px; }
  iframe { width: 100%; height: 70px; border: 2px solid #888; margin-bottom: 12px; }
</style>
</head>
<body>
  <b>sandbox без токенов</b>
  <iframe sandbox title="Без скриптов"
    srcdoc="<p id=p>Скрипт не выполнялся</p><script>p.textContent='Скрипт выполнился'</script>"></iframe>
  <b>sandbox=&quot;allow-scripts&quot;</b>
  <iframe sandbox="allow-scripts" title="Со скриптами"
    srcdoc="<p id=p>Скрипт не выполнялся</p><script>p.textContent='Скрипт выполнился, источник: '+origin</script>"></iframe>
</body>
</html>
```

</details>

Обратите внимание: во втором фрейме `origin` равен строке `"null"` — это и есть непрозрачный
источник. Скрипт работает, но не принадлежит ни одному сайту.

## 9. `<figure>` и `<figcaption>`

`<figure>` — самостоятельная иллюстрация, на которую текст может сослаться («см. рисунок 3»), и
которую можно перенести в другое место без потери смысла. `<figcaption>` — её подпись, и она же
становится доступным именем `<figure>`.

Не путайте подпись и `alt`. Подпись видят все, она **дополняет** картинку («Рис. 3. Москва,
1912 год»). `alt` **заменяет** картинку для тех, кто её не видит. Если подпись уже описывает
содержимое полностью, `alt` может быть коротким, но пустым его оставлять нельзя: картинка в
`<figure>` почти всегда содержательная.

## Итог

- Замещаемые элементы рисуют внешнее содержимое и имеют естественный размер и пропорцию.
- `alt` — замена, а не подпись. Декоративное — `alt=""`, без `alt` — ошибка.
- `width`/`height` в разметке плюс `height: auto` в CSS: браузер резервирует место через
  `aspect-ratio: auto w / h`.
- `lazy` — только ниже первого экрана; `fetchpriority="high"` — для одной главной картинки.
- `srcset` с `w` и `sizes`: вы описываете файлы и слот, браузер выбирает. `<picture>` с `media` —
  приказ, для другого кадра; с `type` — для форматов.
- Щель под картинкой — место для выносных элементов под базовой линией. `display: block` или
  `vertical-align`.
- Видео со звуком само не запустится; `autoplay muted playsinline` — для фона, `play()` возвращает
  Promise.
- Встроенный SVG — часть DOM: CSS и `currentColor` работают. `<img>` и фон — изолированы.
- `sandbox` без токенов запрещает всё; `allow-scripts` + `allow-same-origin` для своего домена
  песочницу отменяет.

## Проверьте себя

1. Окно 800 px, плотность 2, `sizes="(min-width: 600px) 50vw, 100vw"`, `srcset` с 400w, 800w,
   1600w. Какой файл выберет браузер? А при `sizes="(min-width: 400px) 100vw, (min-width: 600px) 50vw, 100vw"`?
2. Почему `vertical-align: middle` может не убрать щель под маленькой иконкой в блоке с большим
   `line-height`?
3. Чем `<img alt="">` отличается от `<img>` без `alt` для экранного диктора?
4. Почему иконка, вставленная через `<img src="icon.svg">`, не перекрашивается при `:hover` ссылки,
   хотя внутри стоит `fill="currentColor"`?
5. Зачем фоновому видео в шапке атрибут `playsinline`, и что произойдёт с `video.play()` без
   `muted`?

Дальше: [Доступность](LEARN_HTML_ACCESSIBILITY_COURSE.md).
