// language-studio/courses/adv-en.js - English C1 and C2 for Russian speakers: inversion, cleft sentences, advanced
// modality, collocations, register, idioms, the subjunctive, understatement and irony, word formation; readings
// from Dickens (1859) and Shakespeare (1609), both in the public domain, with the studio's own translations.
// The sections join the course in courses/index.js.
//
// Structure: arrays of lesson sections in the same shape as the course files' SECTIONS; courses/index.js appends them
// to the matching course at import. Data, not logic: header and structure comment only. Section ids must stay
// stable (spaced-repetition keys contain them).
import { lines, T, words } from './util.js';

const L = ['ru'];

export const SECTIONS_EN = [
  // --- C1 --------------------------------------------------------------------------------------------------------------
  {
    id: 'c1-inversion', kind: 'text', topic: 'grammar', level: 'C1', title: T('Инверсия после отрицательных и ограничительных слов'),
    blocks: [
      { p: T('Если предложение начинается с отрицательного или ограничительного наречия (never, rarely, hardly, no sooner, not only, only then, little, under no circumstances), подлежащее и вспомогательный глагол меняются местами — как в вопросе. Нет вспомогательного — появляется do / does / did. Это книжный и выразительный порядок: в разговоре чаще говорят без инверсии (I have never seen…).') },
      { table: { head: ['English', 'перевод', 'схема'], rows: [
        ['Never have I seen such a mess.', 'Никогда я не видел такого беспорядка.', 'Never + have + S'],
        ['Hardly had we arrived when it started to rain.', 'Едва мы приехали, как пошёл дождь.', 'Hardly … when'],
        ['No sooner had she left than the phone rang.', 'Не успела она уйти, как зазвонил телефон.', 'No sooner … than'],
        ['Not only did he lie, but he also blamed me.', 'Он не только солгал, но ещё и обвинил меня.', 'Not only + did + S'],
        ['Only then did I understand.', 'Только тогда я понял.', 'Only then + did'],
        ['Little did they know what awaited them.', 'Они и не подозревали, что их ждёт.', 'Little + did'],
        ['Under no circumstances should you open it.', 'Ни в коем случае не открывайте.', 'Under no circumstances + should'],
        ['So tired was he that he fell asleep at once.', 'Он так устал, что сразу уснул.', 'So + adj + be + S'],
      ] } },
      { h: T('Условие без if') },
      { p: T('В книжной речи if опускают и ставят вспомогательный глагол вперёд: Had I known = If I had known, Were it not for = If it were not for, Should you need = If you should need. Русский делает то же самое повелительным наклонением: «Знай я…», «Будь у меня время…».') },
      { table: { head: ['English', 'перевод'], rows: [['Had I known, I would have come.', 'Знай я, я бы пришёл.'], ['Were it not for your help, we would have failed.', 'Если бы не ваша помощь, мы бы не справились.'], ['Should you need anything, call me.', 'Если что-то понадобится, звоните.']] } },
      { quiz: [
        { q: T('«Едва я вошёл, как погас свет».'), opts: ['Hardly had I entered when the lights went out.', 'Hardly I had entered when the lights went out.', 'Hardly did I entered than the lights went out.'], a: 0, why: T('Hardly … when; вспомогательный had стоит перед подлежащим.') },
        { q: T('«Ни при каких условиях не нажимайте эту кнопку».'), opts: ['Under no circumstances you should press this button.', 'Under no circumstances should you press this button.', 'In no circumstances press you this button.'], a: 1, why: T('После under no circumstances — инверсия should + you.') },
        { q: T('«Если бы я знал, я бы помог» — без if.'), opts: ['Did I know, I would have helped.', 'Had I known, I would have helped.', 'Have I known, I would helped.'], a: 1, why: T('Had I known = If I had known (условие о прошлом).') },
      ] },
    ],
  },
  {
    id: 'c1-cleft', kind: 'text', topic: 'grammar', level: 'C1', title: T('Расщеплённые предложения: как выделить главное'),
    blocks: [
      { p: T('Порядок слов в английском почти жёсткий, поэтому логическое ударение выносят в особую конструкцию: It is / was … who / that … (it-cleft) или What … is … (wh-cleft). Русский делает то же частицами «именно», «-то», «вот» и порядком слов; грузинский — местом перед глаголом и словом სწორედ «именно».') },
      { table: { head: ['English', 'перевод'], rows: [
        ['It was John who broke the window.', 'Окно разбил (именно) Джон.'],
        ['It was the window that John broke.', 'Джон разбил именно окно.'],
        ['What I need is a holiday.', 'Что мне нужно — так это отпуск.'],
        ['All I did was ask a question.', 'Я всего лишь задал вопрос.'],
        ['The reason I called is that I was worried.', 'Звоню я потому, что волновался.'],
        ['It\'s not that I dislike him — it\'s that I don\'t trust him.', 'Дело не в том, что он мне не нравится, а в том, что я ему не доверяю.'],
        ['What happened was that the server crashed.', 'А случилось вот что: упал сервер.'],
        ['I do like it!', 'Мне правда нравится! (усилительное do)'],
      ] } },
      { p: T('После All / What … did was ставится глагол без to: All he did was arrive late. Усилительное do звучит с ударением и часто спорит с собеседником: «But I did call you!» — «Но я же звонил!».') },
      { quiz: [
        { q: T('«Мне нужен именно ты».'), opts: ['It\'s you that I need.', 'It\'s you what I need.', 'What I need it\'s you.'], a: 0, why: T('It is … that / who: что выделяем — после it is, остальное — в придаточном.') },
        { q: T('«Он всего лишь опоздал на минуту».'), opts: ['All he did was arrive a minute late.', 'All he did was arrived a minute late.', 'All what he did was arriving late.'], a: 0, why: T('All … did was + инфинитив без to; «all what» по-английски не говорят.') },
      ] },
      { try: [{ tool: 'text', label: T('Анализ текста: кто что делает') }, { course: 'ka', tool: 'ka-sentence', label: T('Грузинский: порядок слов в конструкторе предложений') }] },
    ],
  },
  {
    id: 'c1-modality', kind: 'text', topic: 'grammar', level: 'C1', title: T('Модальность: вывод, упрёк, план'),
    blocks: [
      { p: T('Модальные глаголы говорят о двух вещах: насколько говорящий уверен (эпистемическая модальность: must, might, can\'t) и что требуется или разрешено (деонтическая: must, should, may). С перфектным инфинитивом (have done) речь идёт о прошлом.') },
      { table: { head: ['форма', 'смысл', 'пример', 'по-русски'], rows: [
        ['must have done', 'уверенный вывод', 'She must have forgotten.', 'Она, должно быть, забыла.'],
        ['can\'t / couldn\'t have done', 'уверенное «нет»', 'He can\'t have seen us.', 'Не может быть, чтобы он нас видел.'],
        ['might / may / could have done', 'возможно', 'They might have missed the train.', 'Возможно, они опоздали на поезд.'],
        ['should / ought to have done', 'упрёк, сожаление', 'You should have told me.', 'Тебе следовало мне сказать.'],
        ['needn\'t have done', 'сделал — а зря', 'You needn\'t have cooked.', 'Зря ты готовил.'],
        ['didn\'t need to do', 'не требовалось', 'I didn\'t need to cook.', 'Мне не нужно было готовить.'],
        ['be to do', 'план, предписание', 'The minister is to visit Tbilisi.', 'Министр посетит Тбилиси (запланировано).'],
        ['be bound to', 'неизбежно', 'It\'s bound to rain.', 'Обязательно пойдёт дождь.'],
        ['be supposed to', 'ожидается, положено', 'You\'re supposed to knock.', 'Вообще-то положено стучать.'],
        ['would rather', 'предпочтение', 'I\'d rather you didn\'t.', 'Я бы предпочёл, чтобы ты этого не делал.'],
        ['had better', 'совет-предупреждение', 'You\'d better hurry.', 'Лучше поторопись.'],
      ] } },
      { p: T('Вывод по следам («должно быть, забыла») грузинский выражает перфектом серии III: დავიწყებია «(оказывается) забыла» — см. урок C1 грузинского курса о серии III.') },
      { quiz: [
        { q: T('«Зря ты купил билеты: вход бесплатный».'), opts: ['You needn\'t have bought tickets.', 'You didn\'t need buy tickets.', 'You mustn\'t have bought tickets.'], a: 0, why: T('needn\'t have done — сделал, хотя не было нужды.') },
        { q: T('«Не может быть, чтобы он это сказал».'), opts: ['He mustn\'t have said that.', 'He can\'t have said that.', 'He shouldn\'t say that.'], a: 1, why: T('Отрицание уверенного вывода — can\'t have, а mustn\'t значит «нельзя».') },
      ] },
    ],
  },
  {
    id: 'c1-colloc', kind: 'words', topic: 'abstract', level: 'C1', title: T('Сочетаемость: какие слова дружат'),
    intro: T('Коллокации нельзя вывести по смыслу: по-английски дождь «тяжёлый», а кофе «крепкий», решение «делают», а внимание «платят». Учите их парами — карточками.'),
    words: words(L, `
make a decision | /meɪk ə dɪˈsɪʒn/ | принять решение // не do a decision. Ср. груз. გადაწყვეტილების მიღება «принятие решения» — тот же образ, что в русском.
take a risk | /teɪk ə rɪsk/ | пойти на риск
pay attention | /peɪ əˈtenʃn/ | обращать внимание // внимание «платят»
draw a conclusion | /drɔː ə kənˈkluːʒn/ | сделать вывод // «вытянуть» вывод
raise a question | /reɪz ə ˈkwestʃən/ | поднять вопрос
meet a deadline | /miːt ə ˈdedlaɪn/ | уложиться в срок
bear responsibility | /beə rɪˌspɒnsəˈbɪləti/ | нести ответственность // bear = нести, как в русском
strike a balance | /straɪk ə ˈbæləns/ | найти равновесие
heavy rain | /ˈhevi reɪn/ | сильный дождь // не strong rain
strong coffee | /strɒŋ ˈkɒfi/ | крепкий кофе // но не heavy coffee
bitterly disappointed | /ˈbɪtəli ˌdɪsəˈpɔɪntɪd/ | горько разочарован
highly unlikely | /ˈhaɪli ʌnˈlaɪkli/ | крайне маловероятно
deeply rooted | /ˈdiːpli ˈruːtɪd/ | глубоко укоренившийся
fully aware | /ˈfʊli əˈweə/ | вполне осознающий
widely accepted | /ˈwaɪdli əkˈseptɪd/ | общепринятый
a matter of time | /ə ˈmætər əv taɪm/ | вопрос времени
come to terms with | /kʌm tə tɜːmz wɪð/ | смириться с; принять
run a business | /rʌn ə ˈbɪznəs/ | вести дело
keep a promise | /kiːp ə ˈprɒmɪs/ | сдержать обещание
commit a crime | /kəˈmɪt ə kraɪm/ | совершить преступление // commit — только о плохом: a crime, a mistake, suicide
`),
  },
  {
    id: 'c1-register', kind: 'text', topic: 'speech', level: 'C1', title: T('Регистр: книжное и разговорное'),
    blocks: [
      { p: T('У английского два слоя словаря: германский (короткие слова, фразовые глаголы) и романский, пришедший с нормандцами и латынью. Германский звучит разговорно, романский — официально. Это наследие 1066 года: см. урок «Наборы заимствований».') },
      { table: { head: ['официально', 'нейтрально / разговорно', 'смысл'], rows: [
        ['postpone', 'put off', 'отложить'], ['investigate', 'look into', 'расследовать, разобраться'], ['tolerate', 'put up with', 'терпеть'],
        ['establish', 'set up', 'основать'], ['discover', 'find out', 'узнать'], ['continue', 'carry on', 'продолжать'], ['reduce', 'cut down on', 'сократить'],
        ['assist', 'help', 'помочь'], ['obtain', 'get', 'получить'], ['commence', 'start', 'начать'], ['reside', 'live', 'проживать'],
        ['sufficient', 'enough', 'достаточно'], ['prior to', 'before', 'до'], ['subsequently', 'later', 'впоследствии'], ['nevertheless', 'still, but', 'тем не менее'],
      ] } },
      { h: T('Смягчение (hedging)') },
      { p: T('Академический и деловой английский избегает категоричности: It would appear that…, arguably, to some extent, tends to, may suggest. Русский научный стиль делает то же («по-видимому», «можно предположить»), но реже, и прямота по-русски звучит мягче, чем по-английски.') },
      { h: T('Номинализация') },
      { p: T('Книжный стиль превращает действия в существительные: They failed to agree, so the talks collapsed → The failure to reach an agreement led to the collapse of the talks. Русский канцелярит злоупотребляет тем же («осуществление контроля» вместо «контролировать») — см. урок C2 русского курса.') },
      { quiz: [
        { q: T('Какой вариант уместен в официальном письме?'), opts: ['We need to put off the meeting.', 'We regret that the meeting must be postponed.', 'Gotta push the meeting, sorry.'], a: 1, why: T('Романское postpone, пассив и формула сожаления — признаки официального регистра.') },
      ] },
      { try: [{ tool: 'morph', arg: 'investigation', label: T('Разобрать investigation') }, { tool: 'xl', arg: 'links/influence', label: T('Кальки: influence → влияние') }] },
    ],
  },
  {
    id: 'c1-idioms', kind: 'words', topic: 'speech', level: 'C1', title: T('Идиомы и их происхождение'),
    intro: T('Идиома — это образ, который уже не переводится по словам. Часть из них совпадает с русскими (break the ice — растопить лёд), часть — нет.'),
    words: words(L, `
a blessing in disguise | /ə ˈblesɪŋ ɪn dɪsˈɡaɪz/ | нет худа без добра // букв. «благословение под маской»
bite the bullet | /baɪt ðə ˈbʊlɪt/ | стиснуть зубы и сделать неприятное // по преданию, раненым при операции давали прикусить пулю
the elephant in the room | /ði ˈelɪfənt ɪn ðə ruːm/ | очевидная проблема, о которой все молчат
beat around the bush | /biːt əˈraʊnd ðə bʊʃ/ | ходить вокруг да около // из охоты: загонщики били по кустам, а не ловили дичь
cut corners | /kʌt ˈkɔːnəz/ | халтурить, экономить на качестве // срезать углы, чтобы прийти быстрее
a red herring | /ə red ˈherɪŋ/ | ложный след // копчёной селёдкой будто бы сбивали собак со следа
the last straw | /ðə lɑːst strɔː/ | последняя капля // the straw that broke the camel's back: соломинка, сломавшая спину верблюду
get cold feet | /ɡet kəʊld fiːt/ | струсить в последний момент
hit the nail on the head | /hɪt ðə neɪl ɒn ðə hed/ | попасть в точку
on thin ice | /ɒn θɪn aɪs/ | в рискованном положении
let the cat out of the bag | /let ðə kæt aʊt əv ðə bæɡ/ | проговориться // ср. «кота в мешке» — но смысл другой
once in a blue moon | /wʌns ɪn ə bluː muːn/ | раз в сто лет // «голубая луна» — второе полнолуние в одном месяце
spill the beans | /spɪl ðə biːnz/ | выболтать секрет
under the weather | /ˈʌndə ðə ˈweðə/ | неважно себя чувствовать
break the ice | /breɪk ði aɪs/ | растопить лёд (начать разговор) // тот же образ в русском — так бывает с идиомами-путешественницами
burn the midnight oil | /bɜːn ðə ˈmɪdnaɪt ɔɪl/ | засиживаться за работой допоздна // жечь масло лампы до полуночи
`),
  },
  {
    id: 'c1-reading', kind: 'poem', topic: 'poetry', level: 'C1', title: T('Чтение: Диккенс, «Повесть о двух городах» (1859)'),
    intro: T('Начало романа — цепь антитез и анафор (it was … it was …): каждая пара противоположностей описывает 1775 год, но автор говорит и о своём времени. Перевод — построчный, студии.'),
    lines: lines(L, `
Dickens: It was the best of times, it was the worst of times, | | Это было лучшее из времён, это было худшее из времён, // антитеза: best ↔ worst
Dickens: it was the age of wisdom, it was the age of foolishness, | | век мудрости, век глупости,
Dickens: it was the epoch of belief, it was the epoch of incredulity, | | эпоха веры, эпоха неверия, // incredulity — книжное латинское слово: in- + credulus «доверчивый»
Dickens: it was the season of Light, it was the season of Darkness, | | пора Света, пора Тьмы,
Dickens: it was the spring of hope, it was the winter of despair, | | весна надежды, зима отчаяния,
Dickens: we had everything before us, we had nothing before us, | | у нас было всё впереди, у нас ничего не было впереди,
Dickens: we were all going direct to Heaven, we were all going direct the other way | | все мы шли прямо в рай, все мы шли прямо в обратную сторону // the other way — эвфемизм: в ад
`),
    note: T('Обратите внимание: одна длинная фраза без союзов (асиндетон), ритм создаётся повтором it was. Попробуйте вставить текст в «Анализ текста» — он покажет одинаковое строение всех частей.'),
  },
  // --- C2 --------------------------------------------------------------------------------------------------------------
  {
    id: 'c2-subjunctive', kind: 'text', topic: 'grammar', level: 'C2', title: T('Сослагательное наклонение и застывшие формулы'),
    blocks: [
      { p: T('После глаголов и оборотов требования и необходимости (insist, demand, recommend, it is essential / vital that) в книжном английском стоит голый глагол без -s и без времени — мандативное сослагательное: that he be, that she leave. В британском английском чаще говорят that he should be; американский сохраняет голую форму.') },
      { table: { head: ['English', 'перевод'], rows: [
        ['It is essential that he be informed.', 'Необходимо, чтобы его известили.'],
        ['I insist that she leave at once.', 'Я настаиваю, чтобы она немедленно ушла.'],
        ['They recommended that the law not be changed.', 'Рекомендовали закон не менять. (not — перед глаголом)'],
        ['If I were you, I would wait.', 'На вашем месте я бы подождал. (were для всех лиц)'],
      ] } },
      { h: T('Застывшие формулы') },
      { table: { head: ['формула', 'смысл'], rows: [
        ['Be that as it may, …', 'Как бы то ни было…'], ['Come what may, …', 'Будь что будет…'], ['Suffice it to say that …', 'Достаточно сказать, что…'],
        ['Far be it from me to …', 'Я далёк от того, чтобы…'], ['So be it.', 'Да будет так.'], ['God save the King.', 'Боже, храни короля.'], ['… lest we forget', '…дабы мы не забыли (lest = чтобы не)'],
      ] } },
      { p: T('Русский выражает то же союзом «чтобы» с прошедшим временем («чтобы его известили»), грузинский — оптативом после რომ: მინდა, რომ დაწეროს «хочу, чтобы он написал».') },
      { quiz: [
        { q: T('«Комитет потребовал, чтобы отчёт был опубликован».'), opts: ['The committee demanded that the report be published.', 'The committee demanded that the report is publishing.', 'The committee demanded the report to be publish.'], a: 0, why: T('demand that + голая форма be.') },
        { q: T('He spoke quietly lest he wake the baby. Что значит lest?'), opts: ['чтобы не', 'пока', 'хотя'], a: 0, why: T('lest — книжное «дабы не»; глагол после него тоже в голой форме (wake).') },
      ] },
      { try: [{ course: 'ka', tool: 'ka-forms', arg: 'წერა', label: T('Грузинский оптатив: формы глагола წერა') }] },
    ],
  },
  {
    id: 'c2-style', kind: 'text', topic: 'speech', level: 'C2', title: T('Недосказанность, литота, ирония'),
    blocks: [
      { p: T('Британская речь любит преуменьшать: сказанное слабее того, что имеется в виду. Литота — утверждение через отрицание противоположного: not bad («хорошо»), not unlike («похоже»), no mean feat («большое достижение»), not without merit («есть достоинства»). Русский знает литоту («неглупый», «небезызвестный»), но пользуется ею реже.') },
      { table: { head: ['говорят', 'имеют в виду'], rows: [
        ['It\'s a bit chilly. (в метель)', 'Ужасно холодно.'], ['I was slightly annoyed.', 'Я был в ярости.'], ['That\'s an interesting idea.', 'Сомневаюсь.'],
        ['With the greatest respect, …', 'Вы ошибаетесь.'], ['I\'d be inclined to disagree.', 'Я не согласен.'], ['Could you possibly …?', 'Сделайте, пожалуйста…'], ['Not the brightest idea.', 'Глупая идея.'],
      ] } },
      { h: T('Фигуры') },
      { p: T('Зевгма — одно слово управляет двумя разными смыслами: She lost her keys and her temper («потеряла ключи и самообладание»). Хиазм — зеркальный повтор: Eat to live, not live to eat. Эвфемизм — смягчённое имя: pass away вместо die, let go вместо fire.') },
      { quiz: [
        { q: T('This is no mean feat — что это значит?'), opts: ['это большое достижение', 'это подлый поступок', 'это пустяк'], a: 0, why: T('mean здесь «посредственный»; no mean — литота: «отнюдь не посредственный».') },
        { q: T('With the greatest respect, I think you\'re mistaken. Каков тон?'), opts: ['твёрдое несогласие', 'восхищение собеседником', 'просьба о помощи'], a: 0, why: T('Формула уважения перед несогласием только усиливает его.') },
      ] },
    ],
  },
  {
    id: 'c2-wordform', kind: 'text', topic: 'rules', level: 'C2', title: T('Словообразование: обратное, конверсия, слияния'),
    blocks: [
      { p: T('Обратное словообразование отбрасывает «суффикс», которого никогда не было: editor → to edit, burglar → to burgle, television → to televise, babysitter → to babysit. Конверсия меняет часть речи без суффикса: a google → to google, to must → a must, up → to up the price. Слияния склеивают слова: smog, brunch, chortle (chuckle + snort, Льюис Кэрролл).') },
      { p: T('Латинские приставки складываются в цепочки: re-con-struct-ion «снова-вместе-строить-ние»; русский повторяет такие слова кальками (вос-со-зда-ни-е). Разбор в «Морфемах» показывает и правило, и смысл.') },
      { table: { head: ['слово', 'части', 'русская калька'], rows: [['reconstruction', 're + con + struct + ion', 'вос-со-зда-ние'], ['independence', 'in + de + pend + ence', 'не-за-вис-им-ость'], ['influence', 'in + flu + ence', 'в-ли-яние'], ['impression', 'im + press + ion', 'в-печат-ление']] } },
      { try: [{ tool: 'morph', arg: 'reconstruction', label: T('Разобрать reconstruction') }, { tool: 'morph', arg: 'transportation', label: T('Разобрать transportation') }, { tool: 'xl', arg: 'links/independence', label: T('independence в трёх языках') }, { course: 'ru', tool: 'morph', arg: 'независимость', label: T('Русское «независимость»') }] },
      { quiz: [
        { q: T('Какое слово получено обратным словообразованием?'), opts: ['to edit', 'to write', 'to read'], a: 0, why: T('Сначала было editor (лат. editor «издатель»), глагол edit «вычли» из него позже.') },
      ] },
    ],
  },
  {
    id: 'c2-words', kind: 'words', topic: 'abstract', level: 'C2', title: T('Книжная лексика и эпонимы'),
    intro: T('Слова уровня C2 часто прозрачны для того, кто знает латынь, греческий или историю. Происхождение — в примечании.'),
    words: words(L, `
ubiquitous | /juːˈbɪkwɪtəs/ | вездесущий // лат. ubique «повсюду»
ephemeral | /ɪˈfemərəl/ | мимолётный // греч. ephēmeros «однодневный»
quintessential | /ˌkwɪntɪˈsenʃl/ | типичнейший, образцовый // quinta essentia «пятая сущность» — эфир алхимиков
serendipity | /ˌserənˈdɪpəti/ | счастливая случайность // слово Хораса Уолпола (1754) по сказке о трёх принцах Серендипа (Цейлона)
pernicious | /pəˈnɪʃəs/ | пагубный // лат. pernicies «гибель»
sanguine | /ˈsæŋɡwɪn/ | оптимистичный // лат. sanguis «кровь»: по теории темпераментов
perfunctory | /pəˈfʌŋktəri/ | формальный, «для галочки» // лат. perfungi «отделаться»
magnanimous | /mæɡˈnænɪməs/ | великодушный // magnus «великий» + animus «дух» — русское «велико-душный» построено так же
recalcitrant | /rɪˈkælsɪtrənt/ | непокорный // лат. calx «пятка»: «брыкающийся»
equivocal | /ɪˈkwɪvəkl/ | двусмысленный // aequus «равный» + vox «голос»
laconic | /ləˈkɒnɪk/ | немногословный // Лакония — земля спартанцев
quixotic | /kwɪkˈsɒtɪk/ | донкихотский, благородно-непрактичный // Дон Кихот
mercurial | /mɜːˈkjʊəriəl/ | переменчивый // Меркурий и ртуть (mercury)
draconian | /drəˈkəʊniən/ | драконовский // Драконт, законодатель Афин VII в. до н. э.
Pyrrhic victory | /ˈpɪrɪk ˈvɪktəri/ | пиррова победа // царь Пирр: «ещё одна такая победа — и мы погибли»
byzantine | /bɪˈzæntaɪn/ | запутанный, интриганский // о византийском дворе
nostalgia | /nɒˈstældʒə/ | ностальгия // греч. nostos «возвращение» + algos «боль»; слово врача Иоганна Хофера (1688)
procrastinate | /prəʊˈkræstɪneɪt/ | откладывать на потом // лат. cras «завтра»
ineffable | /ɪnˈefəbl/ | невыразимый // in- + effari «высказать»
obfuscate | /ˈɒbfʌskeɪt/ | затуманивать, запутывать // ob- + fuscus «тёмный»
`),
  },
  {
    id: 'c2-sonnet', kind: 'poem', topic: 'poetry', level: 'C2', title: T('Чтение: Шекспир, сонет 18 (1609)'),
    intro: T('Пятистопный ямб (da-DUM × 5), рифма ABAB CDCD EFEF GG. Старые формы: thee / thou / thy — «тебя / ты / твой», art = are, hath = has, -st во 2-м лице (ow\'st, wander\'st, grow\'st). Перевод — подстрочный, студии.'),
    lines: lines(L, `
Shall I compare thee to a summer's day? | | Сравню ли я тебя с летним днём?
Thou art more lovely and more temperate: | | Ты прелестнее и ровнее нравом: // temperate — «умеренный», без крайностей жары и холода
Rough winds do shake the darling buds of May, | | Резкие ветры треплют милые майские бутоны, // do shake — усилительное do ради размера
And summer's lease hath all too short a date; | | И у аренды лета слишком короткий срок; // lease — юридическая метафора: лето взято взаймы
Sometime too hot the eye of heaven shines, | | Порой слишком жарко светит око небес,
And often is his gold complexion dimm'd; | | И часто тускнеет его золотой лик; // инверсия is his … dimm'd
And every fair from fair sometime declines, | | И всё прекрасное когда-нибудь теряет красоту, // fair — и «красавица», и «красота»
By chance or nature's changing course untrimm'd; | | Лишённое убора случаем или изменчивым ходом природы;
But thy eternal summer shall not fade, | | Но твоё вечное лето не увянет
Nor lose possession of that fair thou ow'st; | | И не утратит красоты, которой ты владеешь; // ow'st = ownest: owe здесь «владеть»
Nor shall Death brag thou wander'st in his shade, | | И Смерть не похвастает, что ты бродишь в её тени, // Death — мужского рода (his)
When in eternal lines to time thou grow'st: | | Когда в вечных строках ты врастаешь во время:
So long as men can breathe or eyes can see, | | Пока люди дышат и глаза видят,
So long lives this, and this gives life to thee. | | Живёт эта строка — и даёт жизнь тебе. // заключительное двустишие: стих бессмертнее лета
`),
    note: T('Шекспир умер в 1616 году, текст давно в общественном достоянии; известные русские переводы (например, Маршака) ещё охраняются, поэтому здесь — свой подстрочник.'),
  },
];
