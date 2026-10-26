// lingua/korean-lexicon.js - a seed dictionary for the Korean parser (lingua/korean.js): common verbs and adjectives
// with their irregular class, nouns, pronouns and adverbs, Russian and English glosses and register labels.
//
//   entry: `word|pos[:class][@register]|ru|en`, entries separated by ';' or new lines.
//   pos: v verb, a adjective, n noun, pr pronoun, adv adverb, num numeral, x auxiliary verb
//   class (verbs / adjectives): b ㅂ-irregular (b-o: 도와 type), d ㄷ-irregular, s ㅅ-irregular, h ㅎ-irregular,
//     reu 르-irregular, reg regular despite the shape (따르다 → 따라); ㄹ-stems, 하다 and 으-stems are found by shape
//   register: hon honorific (높임), hum humble (겸양), plain (낮춤 / familiar), formal
//   KO_LEXICON() -> [{ w, stem, pos, cls, reg, ru, en }]
//
// Data as one compact template string, not an array of objects: ~5x fewer bytes in the bundle and easy to edit by
// hand. Parsed lazily on first call and cached (module import stays free for pages that never parse Korean).
// Large data table: rows not commented individually.

const DATA = `
가다|v|идти, ехать|go; 오다|v|приходить|come; 하다|v|делать|do; 되다|v|становиться; получаться|become; 있다|a|быть, иметься|be, exist, have; 없다|a|не быть, не иметься|not be, not have
먹다|v|есть|eat; 마시다|v|пить|drink; 자다|v|спать|sleep; 보다|v|смотреть, видеть|see, watch; 읽다|v|читать|read; 쓰다|v|писать; использовать|write; use
듣다|v:d|слушать, слышать|listen, hear; 걷다|v:d|ходить пешком|walk; 묻다|v:d|спрашивать|ask; 싣다|v:d|грузить|load; 깨닫다|v:d|осознавать|realise
받다|v|получать|receive; 닫다|v|закрывать|close; 믿다|v|верить|believe; 얻다|v|добывать|obtain
말하다|v|говорить|speak; 이야기하다|v|рассказывать|talk; 공부하다|v|учиться|study; 일하다|v|работать|work; 운동하다|v|заниматься спортом|exercise; 요리하다|v|готовить|cook
사랑하다|v|любить|love; 좋아하다|v|любить, нравиться|like; 싫어하다|v|не любить|dislike; 시작하다|v|начинать|begin; 생각하다|v|думать|think; 전화하다|v|звонить|phone
노래하다|v|петь|sing; 여행하다|v|путешествовать|travel; 결혼하다|v|жениться, выходить замуж|marry; 청소하다|v|убирать|clean; 숙제하다|v|делать домашнее задание|do homework
안녕하다|a|благополучный, мирный|be well, be at peace; 감사하다|a|благодарный|be thankful; 미안하다|a|виноватый|be sorry; 피곤하다|a|усталый|be tired; 행복하다|a|счастливый|be happy; 조용하다|a|тихий|be quiet; 깨끗하다|a|чистый|be clean
따뜻하다|a|тёплый|be warm; 시원하다|a|прохладный|be cool; 똑똑하다|a|умный|be smart; 친절하다|a|любезный|be kind; 유명하다|a|знаменитый|be famous; 중요하다|a|важный|be important
필요하다|a|нужный|be needed; 건강하다|a|здоровый|be healthy; 편하다|a|удобный|be comfortable; 심심하다|a|скучающий|be bored; 비슷하다|a|похожий|be similar; 이상하다|a|странный|be strange
알다|v|знать|know; 살다|v|жить|live; 만들다|v|делать, создавать|make; 놀다|v|играть, отдыхать|play; 열다|v|открывать|open; 팔다|v|продавать|sell; 울다|v|плакать|cry
들다|v|поднимать; входить|lift; enter; 걸다|v|вешать; звонить|hang; call; 길다|a|длинный|be long; 멀다|a|далёкий|be far; 힘들다|a|трудный, тяжёлый|be hard; 달다|a|сладкий|be sweet
모르다|v:reu|не знать|not know; 부르다|v:reu|звать; петь|call; sing; 고르다|v:reu|выбирать|choose; 빠르다|a:reu|быстрый|be fast; 다르다|a:reu|другой|be different; 마르다|v:reu|сохнуть|dry
자르다|v:reu|резать|cut; 오르다|v:reu|подниматься|climb; 기르다|v:reu|растить|raise; 흐르다|v:reu|течь|flow; 누르다|v:reu|нажимать|press; 따르다|v:reg|следовать; наливать|follow; pour
바쁘다|a|занятой|be busy; 기쁘다|a|радостный|be glad; 슬프다|a|грустный|be sad; 아프다|a|больной|be ill, hurt; 예쁘다|a|красивый|be pretty; 나쁘다|a|плохой|be bad; 크다|a|большой|be big
배고프다|a|голодный|be hungry; 끄다|v|выключать|switch off; 뜨다|v|всплывать; открывать (глаза)|rise; open (eyes); 잠그다|v|запирать|lock; 모으다|v|собирать|collect
덥다|a:b|жаркий|be hot; 춥다|a:b|холодный (о погоде)|be cold; 쉽다|a:b|лёгкий|be easy; 어렵다|a:b|трудный|be difficult; 맵다|a:b|острый|be spicy; 가깝다|a:b|близкий|be near
무겁다|a:b|тяжёлый|be heavy; 가볍다|a:b|лёгкий (по весу)|be light; 고맙다|a:b|благодарный|be grateful; 반갑다|a:b|радостный (при встрече)|be glad to see; 귀엽다|a:b|милый|be cute
아름답다|a:b|прекрасный|be beautiful; 즐겁다|a:b|весёлый|be joyful; 무섭다|a:b|страшный|be scary; 시끄럽다|a:b|шумный|be noisy; 더럽다|a:b|грязный|be dirty; 차갑다|a:b|холодный (на ощупь)|be cold (to touch)
뜨겁다|a:b|горячий|be hot (to touch); 부럽다|a:b|завидный|be envious; 외롭다|a:b|одинокий|be lonely; 돕다|v:b-o|помогать|help; 굽다|v:b|жарить, печь|roast, bake; 눕다|v:b|ложиться|lie down
입다|v|надевать (одежду)|wear; 잡다|v|ловить, держать|catch, hold; 좁다|a|узкий|be narrow; 씹다|v|жевать|chew; 넓다|a|широкий|be wide; 짧다|a|короткий|be short; 밟다|v|наступать|step on
낫다|v:s|выздоравливать; быть лучше|recover; be better; 짓다|v:s|строить|build; 붓다|v:s|наливать; опухать|pour; swell; 잇다|v:s|соединять|connect; 웃다|v|смеяться|laugh; 씻다|v|мыть|wash; 벗다|v|снимать (одежду)|take off
그렇다|a:h|такой|be so; 이렇다|a:h|такой (как этот)|be like this; 저렇다|a:h|такой (как тот)|be like that; 어떻다|a:h|какой|be how; 파랗다|a:h|синий|be blue; 빨갛다|a:h|красный|be red
노랗다|a:h|жёлтый|be yellow; 하얗다|a:h|белый|be white; 까맣다|a:h|чёрный|be black; 좋다|a|хороший|be good; 놓다|v|класть|put; 넣다|v|вкладывать|put in; 낳다|v|рожать|give birth; 싫다|a|неприятный|be disliked
많다|a|многочисленный|be many; 괜찮다|a|в порядке, ничего|be all right; 않다|x|не (после -지)|not (after -ji); 못하다|x|не мочь (после -지)|cannot (after -ji); 말다|x|не делать (запрет, после -지)|do not (after -ji);앉다|v|садиться|sit; 끊다|v|прерывать, бросать|cut off, quit; 잃다|v|терять|lose
만나다|v|встречаться|meet; 기다리다|v|ждать|wait; 가르치다|v|учить (кого-то)|teach; 배우다|v|учиться (чему-то)|learn; 주다|v|давать|give; 드리다|v@hum|давать (смиренно)|give (humble); 찾다|v|искать|look for
사다|v|покупать|buy; 타다|v|ехать (на чём-то)|ride; 내리다|v|выходить, спускаться|get off; 다니다|v|ходить (регулярно)|attend; 보내다|v|отправлять|send; 지내다|v|проводить время|spend time
바꾸다|v|менять|change; 끝나다|v|заканчиваться|end; 나가다|v|выходить|go out; 들어가다|v|входить|go in; 나오다|v|выходить (сюда)|come out; 돌아가다|v|возвращаться|go back
일어나다|v|вставать|get up; 쉬다|v|отдыхать|rest; 춤추다|v|танцевать|dance; 치다|v|бить; играть (на инструменте)|hit; play; 던지다|v|бросать|throw; 켜다|v|включать|switch on
세다|a|сильный|be strong; 서다|v|стоять|stand; 건너다|v|переходить|cross; 느끼다|v|чувствовать|feel; 지나다|v|проходить|pass; 빌리다|v|занимать, брать взаймы|borrow
싸다|a|дешёвый|be cheap; 비싸다|a|дорогой|be expensive; 짜다|a|солёный|be salty; 작다|a|маленький|be small; 높다|a|высокий|be high; 낮다|a|низкий|be low; 맛있다|a|вкусный|be tasty
맛없다|a|невкусный|be tasteless; 재미있다|a|интересный|be fun; 재미없다|a|скучный|be boring; 멋있다|a|классный|be cool; 늦다|a|поздний|be late; 이르다|a:reu|ранний|be early; 젊다|a|молодой|be young
늙다|v|стареть|grow old; 같다|a|одинаковый|be the same; 알맞다|a|подходящий|be suitable; 싶다|x|хотеть (после -고)|want (after -go); 보이다|v|виднеться|be seen; 들리다|v|слышаться|be heard
계시다|v@hon|быть, находиться (почтит. к 있다)|be (honorific of 있다); 드시다|v@hon|есть, пить (почтит.)|eat, drink (honorific); 잡수시다|v@hon|кушать (очень почтит.)|eat (very honorific)
주무시다|v@hon|спать (почтит.)|sleep (honorific); 돌아가시다|v@hon|скончаться (почтит.)|pass away (honorific); 말씀하시다|v@hon|говорить (почтит.)|speak (honorific); 뵙다|v@hum|видеть (смиренно)|see (humble)
여쭈다|v@hum|спрашивать (смиренно)|ask (humble); 모시다|v@hum|сопровождать (почтительно)|accompany (humbly); 아니다|a|не являться|not be; 이다|cop|являться (связка)|be (copula)
사람|n|человек|person; 안녕|n|благополучие, мир|peace, well-being; 친구|n|друг|friend; 가족|n|семья|family; 어머니|n|мать|mother; 아버지|n|отец|father; 엄마|n|мама|mum; 아빠|n|папа|dad; 부모님|n@hon|родители|parents
형|n|старший брат (для мужчины)|older brother (of a man); 오빠|n|старший брат (для женщины)|older brother (of a woman); 누나|n|старшая сестра (для мужчины)|older sister (of a man)
언니|n|старшая сестра (для женщины)|older sister (of a woman); 동생|n|младший брат, сестра|younger sibling; 아들|n|сын|son; 딸|n|дочь|daughter; 할머니|n|бабушка|grandmother; 할아버지|n|дедушка|grandfather
남편|n|муж|husband; 아내|n|жена|wife; 아이|n|ребёнок|child; 학생|n|студент, ученик|student; 선생님|n@hon|учитель|teacher; 의사|n|врач|doctor; 회사원|n|служащий|office worker
이름|n|имя|name; 나라|n|страна|country; 한국|n|Корея|Korea; 러시아|n|Россия|Russia; 미국|n|США|USA; 중국|n|Китай|China; 일본|n|Япония|Japan; 서울|n|Сеул|Seoul
한국어|n|корейский язык|Korean; 한국말|n|корейская речь|Korean (speech); 러시아어|n|русский язык|Russian; 영어|n|английский|English; 말|n|речь, слово; лошадь|speech, word; horse; 말씀|n@hon|слово (почтит.)|words (honorific)
집|n|дом|house; 댁|n@hon|дом (почтит.)|house (honorific); 학교|n|школа|school; 회사|n|компания|company; 은행|n|банк|bank; 병원|n|больница|hospital; 약국|n|аптека|pharmacy; 시장|n|рынок|market
식당|n|ресторан, столовая|restaurant; 가게|n|магазин|shop; 카페|n|кафе|cafe; 도서관|n|библиотека|library; 공항|n|аэропорт|airport; 역|n|станция|station; 호텔|n|гостиница|hotel; 방|n|комната|room
화장실|n|туалет|toilet; 길|n|дорога|road; 버스|n|автобус|bus; 지하철|n|метро|subway; 택시|n|такси|taxi; 기차|n|поезд|train; 비행기|n|самолёт|plane; 차|n|машина; чай|car; tea
밥|n|рис, еда|rice, meal; 진지|n@hon|еда (почтит.)|meal (honorific); 물|n|вода|water; 커피|n|кофе|coffee; 우유|n|молоко|milk; 술|n|алкоголь|alcohol; 빵|n|хлеб|bread; 고기|n|мясо|meat
김치|n|кимчхи|kimchi; 과일|n|фрукты|fruit; 사과|n|яблоко; извинение|apple; apology; 음식|n|еда|food; 맛|n|вкус|taste; 책|n|книга|book; 책상|n|стол (письменный)|desk; 의자|n|стул|chair
문|n|дверь|door; 창문|n|окно|window; 컴퓨터|n|компьютер|computer; 전화|n|телефон|telephone; 핸드폰|n|мобильный|mobile phone; 돈|n|деньги|money; 옷|n|одежда|clothes; 신발|n|обувь|shoes
가방|n|сумка|bag; 시간|n|время; час|time; hour; 오늘|n|сегодня|today; 내일|n|завтра|tomorrow; 어제|n|вчера|yesterday; 지금|n|сейчас|now; 아침|n|утро; завтрак|morning; breakfast
점심|n|полдень; обед|noon; lunch; 저녁|n|вечер; ужин|evening; dinner; 밤|n|ночь|night; 주말|n|выходные|weekend; 생일|n|день рождения|birthday; 연세|n@hon|возраст (почтит.)|age (honorific); 나이|n|возраст|age
날씨|n|погода|weather; 비|n|дождь|rain; 눈|n|снег; глаз|snow; eye; 바람|n|ветер|wind; 봄|n|весна|spring; 여름|n|лето|summer; 가을|n|осень|autumn; 겨울|n|зима|winter
산|n|гора|mountain; 바다|n|море|sea; 강|n|река|river; 하늘|n|небо|sky; 꽃|n|цветок|flower; 나무|n|дерево|tree; 개|n|собака|dog; 고양이|n|кошка|cat; 새|n|птица|bird
마음|n|сердце, душа|heart, mind; 사랑|n|любовь|love; 생각|n|мысль|thought; 꿈|n|мечта, сон|dream; 일|n|дело, работа; один|work; one; 공부|n|учёба|study; 운동|n|спорт|sport; 노래|n|песня|song
영화|n|фильм|film; 음악|n|музыка|music; 여행|n|путешествие|travel; 문제|n|задача, проблема|problem; 질문|n|вопрос|question; 대답|n|ответ|answer; 거|n|вещь (разг. 것)|thing (colloquial); 것|n|вещь|thing
때|n|время, когда|time, when; 수|n|возможность|way, possibility; 곳|n|место|place; 앞|n|перед|front; 뒤|n|зад|back; 위|n|верх|top; 아래|n|низ|bottom; 안|n|внутри; не|inside; not; 밖|n|снаружи|outside; 옆|n|бок, рядом|side
저|pr@hum|я (скромно)|I (humble); 나|pr@plain|я|I (plain); 우리|pr|мы, наш|we, our; 저희|pr@hum|мы (скромно)|we (humble); 너|pr@plain|ты|you (plain); 당신|pr|вы (супругам, в песнях)|you
그|pr|он; тот|he; that; 그녀|pr|она|she; 누구|pr|кто|who; 무엇|pr|что|what; 뭐|pr|что (разг.)|what (colloquial); 어디|pr|где, куда|where; 언제|pr|когда|when; 왜|adv|почему|why
여기|pr|здесь|here; 거기|pr|там|there; 저기|pr|вон там|over there; 이것|pr|это|this; 그것|pr|то|that; 저것|pr|вон то|that over there; 이거|pr|это (разг.)|this (colloquial)
잘|adv|хорошо|well; 아주|adv|очень|very; 너무|adv|слишком, очень|too; 정말|adv|правда, действительно|really; 진짜|adv|по-настоящему|really (colloquial); 조금|adv|немного|a little; 좀|adv|немного; пожалуйста|a bit; please
많이|adv|много|a lot; 빨리|adv|быстро|quickly; 천천히|adv|медленно|slowly; 같이|adv|вместе|together; 다시|adv|снова|again; 또|adv|ещё, опять|again; 다|adv|всё|all; 제일|adv|самый|most; 더|adv|больше|more
안|adv|не|not; 못|adv|не мочь|cannot; 아마|adv|наверное|probably; 벌써|adv|уже|already; 아직|adv|ещё (не)|still, not yet; 항상|adv|всегда|always; 자주|adv|часто|often; 가끔|adv|иногда|sometimes
안녕히|adv|спокойно, благополучно|in peace; 어서|adv|скорее, добро пожаловать|quickly, welcome; 그리고|adv|и, а также|and; 그런데|adv|но, кстати|but, by the way; 그래서|adv|поэтому|so; 하지만|adv|однако|however
네|adv|да|yes; 예|adv|да (вежл.)|yes (polite); 아니요|adv|нет|no; 응|adv@plain|ага|yeah; 아니|adv@plain|нет; не|no
하나|num|один|one; 둘|num|два|two; 셋|num|три|three; 넷|num|четыре|four; 다섯|num|пять|five; 여섯|num|шесть|six; 일곱|num|семь|seven; 여덟|num|восемь|eight; 아홉|num|девять|nine; 열|num|десять|ten
`;

// The separator ';' is overloaded (between entries and between senses of a gloss); disambiguated by lookahead: a
// fragment is a new entry only if it starts with Hangul + '|' + a pos letter. Verbal entries store the stem without
// the dictionary ending 다 (the conjugator works on stems). Returns the shared cached array: callers must not mutate.
let cache = null;
export function KO_LEXICON() {
  if (cache) return cache;
  cache = [];
  // a gloss may itself contain ';': a fragment that does not start with 'word|pos' continues the previous entry
  const entries = [];
  for (const line of DATA.split('\n')) {
    for (const f of line.split(';')) {
      if (!/^\s*[가-힣]+\|[a-z]/.test(f) && entries.length && f.trim()) entries[entries.length - 1] += ';' + f;
      else if (f.trim()) entries.push(f);
    }
  }
  for (const raw of entries) {
    const e = raw.trim();
    const [w, tag, ru, en] = e.split('|').map((s) => s.trim());
    const [pc, reg = ''] = tag.split('@');
    const [pos, cls = ''] = pc.split(':');
    const verbal = pos === 'v' || pos === 'a' || pos === 'x' || pos === 'cop';
    cache.push({ w, stem: verbal ? w.slice(0, -1) : w, pos, cls, reg, ru, en });
  }
  return cache;
}
