import{romanize,kontsevich,JAMO,decompose,pronounce,SOUND_RULES}from"../lingua/hangul.js";import{conjugate}from"../lingua/korean.js";import{T}from"./util.js";const tr=(w)=>`${romanize(w)} · ${kontsevich(w)}`;function kw(text){const out=[];let group='';for(const raw of String(text).split('\n')){const line=raw.trim();if(!line)continue;if(line.startsWith('#')){group=line.slice(1).trim();continue;}
const[main,note]=line.split(' // ');const[w,ru,en]=main.split('|').map((s)=>s.trim());const e={w,tr:tr(w.replace(/[?!.,…]/g,'')),m:T(ru,en||ru)};if(note){const[nr,ne]=note.split(' | ');e.note=T(nr.trim(),(ne||nr).trim());}
if(group)e.group=group;out.push(e);}
return out;}
const kl=(text)=>kw(text).map((e)=>{const m=/^([^:]{1,24}):\s*(.+)$/.exec(e.w);return m?{...e,who:m[1].trim(),w:m[2].trim(),tr:tr(m[2])}:e;});const C_HINT={ㄱ:['к в начале слова, г между гласными; рисует корень языка, прижатый к нёбу','k at the start, g between vowels; draws the back of the tongue touching the velum'],ㄴ:['н; кончик языка у зубов','n; the tongue tip at the teeth ridge'],ㄷ:['т / д; ㄴ с чертой сверху — смычка сильнее','t / d; ㄴ with a stroke on top — a firmer closure'],ㄹ:['р между гласными, ль в конце слога; ㄹㄹ = лл','r between vowels, l at the end of a syllable; ㄹㄹ = ll'],ㅁ:['м; рисует сомкнутые губы','m; draws the closed lips'],ㅂ:['п / б; ㅁ с «ушками» — губы размыкаются','p / b; ㅁ with "ears" — the lips burst open'],ㅅ:['с; перед и, я, ё, ю — мягкое щ-образное «сь»; рисует зуб','s; before i and y-vowels a soft "sh"-like s; draws a tooth'],ㅇ:['в начале слога немая (рамка для гласной), в конце — нг (ŋ); рисует горло','silent at the start (a frame for the vowel), ng at the end; draws the throat'],ㅈ:['ч / дж; ㅅ с чертой','ch / j; ㅅ with a stroke'],ㅊ:['чх: ч с придыханием (ещё одна черта)','aspirated ch (one more stroke)'],ㅋ:['кх: к с придыханием (ㄱ + черта)','aspirated k (ㄱ + a stroke)'],ㅌ:['тх: т с придыханием (ㄷ + черта)','aspirated t (ㄷ + a stroke)'],ㅍ:['пх: п с придыханием','aspirated p'],ㅎ:['х (лёгкое h); рисует горло с «дыханием» сверху','h; the throat with breath on top'],ㄲ:['кк: напряжённое к — без придыхания, с зажатой гортанью','tense k — no breath, a tight throat'],ㄸ:['тт: напряжённое т','tense t'],ㅃ:['пп: напряжённое п','tense p'],ㅆ:['сс: напряжённое с','tense s'],ㅉ:['чч: напряжённое ч','tense ch'],};const V_HINT={ㅏ:['а; черта вправо от «человека» ㅣ','a; a stroke to the right of the "man" ㅣ'],ㅓ:['о открытое, почти «э-о» (Концевич: о)','an open o, like "uh" (eo)'],ㅗ:['о губное (точка-«небо» над «землёй» ㅡ)','o with rounded lips (the "heaven" dot above the "earth" ㅡ)'],ㅜ:['у («небо» под «землёй»)','u ("heaven" below "earth")'],ㅡ:['ы без округления губ («земля»)','eu, an unrounded u ("earth")'],ㅣ:['и («человек»)','i ("man")'],ㅐ:['э (ㅏ + ㅣ)','ae, like e in "bed" (ㅏ + ㅣ)'],ㅔ:['е / э (ㅓ + ㅣ); сегодня звучит как ㅐ','e (ㅓ + ㅣ); today said like ㅐ'],ㅑ:['я: вторая черта = й-','ya: the second stroke adds y-'],ㅕ:['ё (йо открытое)','yeo'],ㅛ:['ё (йо губное)','yo'],ㅠ:['ю','yu'],ㅒ:['йе (ㅑ + ㅣ)','yae (ㅑ + ㅣ)'],ㅖ:['йе; после согласных — е','ye; after consonants e'],ㅘ:['ва (ㅗ + ㅏ)','wa (ㅗ + ㅏ)'],ㅙ:['вэ (ㅗ + ㅐ)','wae (ㅗ + ㅐ)'],ㅚ:['ве (ㅗ + ㅣ)','oe, said we (ㅗ + ㅣ)'],ㅝ:['во (ㅜ + ㅓ)','wo (ㅜ + ㅓ)'],ㅞ:['ве (ㅜ + ㅔ)','we (ㅜ + ㅔ)'],ㅟ:['ви (ㅜ + ㅣ)','wi (ㅜ + ㅣ)'],ㅢ:['ый (ㅡ + ㅣ); после согласного — и, частица 의 — э','ui (ㅡ + ㅣ); after a consonant i, the particle 의 said e'],};const KO_LETTER={ㄱ:'к / г',ㄴ:'н',ㄷ:'т / д',ㄹ:'р / ль',ㅁ:'м',ㅂ:'п / б',ㅅ:'с',ㅇ:'— / н(г)',ㅈ:'ч / дж',ㅊ:'чх',ㅋ:'кх',ㅌ:'тх',ㅍ:'пх',ㅎ:'х',ㄲ:'кк',ㄸ:'тт',ㅃ:'пп',ㅆ:'сс',ㅉ:'чч'};const CONS_TR={ㄱ:'g',ㄷ:'d',ㄹ:'r',ㅂ:'b',ㅇ:'ng'};const CONSONANTS=JAMO.filter((j)=>j.kind==='c').map((j)=>({ch:j.ch,tr:CONS_TR[j.ch]||j.rr,ipa:j.ipa,name:`${j.name} (${j.nameRr})`,reading:KO_LETTER[j.ch],say:j.name,hint:T(C_HINT[j.ch][0],C_HINT[j.ch][1]),}));const VOWELS=JAMO.filter((j)=>j.kind==='v').map((j)=>({ch:j.ch,tr:j.rr,ipa:j.ipa,name:j.name,reading:kontsevich(j.name),say:j.name,hint:T(V_HINT[j.ch][0],V_HINT[j.ch][1]),}));const BLOCKS=['가','나','다','라','마','바','사','아','자','하','고','누','드','리','머','보','수','어','주','호','한','글','국','말','밥','물','집','꽃','닭','값','왜','의','뭐','쥐','빵','쌀'].map((ch)=>({ch,tr:romanize(ch),reading:kontsevich(ch),say:ch,hint:T(blockNote(ch,'ru'),blockNote(ch,'en'))}));function blockNote(ch,l){const d=decompose(ch);const parts=[d.L==='ㅇ'?(l==='ru'?'ㅇ (немая)':'ㅇ (silent)'):d.L,d.V,d.T].filter(Boolean).join(' + ');const pr=pronounce(ch).text;return parts+(pr!==ch?(l==='ru'?' · читается [':' · said [')+pr+']':'');}
const consRows=CONSONANTS.map((c)=>[c.ch,c.name,c.tr==='ng'?'— / ng':JAMO.find((j)=>j.ch===c.ch).rr,c.reading,'/'+c.ipa+'/']);const vowRows=VOWELS.map((v)=>[v.ch,v.tr,v.reading,'/'+v.ipa+'/']);const SOUND_EXAMPLES=[['liaison','한국어','корейский язык','Korean'],['liaison','읽어요','читаю','I read'],['h-drop','좋아요','хорошо','good'],['h-asp','좋고','хороший и…','good and…'],['h-asp','축하해요','поздравляю','congratulations'],['h-s','좋습니다','хорошо (офиц.)','good (formal)'],['palatal','같이','вместе','together'],['palatal','굳이','непременно','insistently'],['cluster','닭','курица','chicken'],['cluster','앉다','садиться','to sit'],['neutral','옷','одежда','clothes'],['neutral','꽃','цветок','flower'],['nasal','감사합니다','спасибо','thank you'],['nasal','먹는','который ест','eating'],['nasal','있는','который есть','existing'],['l-n','종로','Чонно (улица в Сеуле)','Jongno (a Seoul street)'],['l-n','국립','национальный','national'],['lateral','신라','Силла (древнее царство)','Silla (an ancient kingdom)'],['lateral','설날','Новый год по лунному календарю','Lunar New Year'],['tense','학교','школа','school'],['tense','식당','столовая','restaurant'],['tense','없어요','нет','there is none'],];const soundRows=SOUND_EXAMPLES.map(([rule,w,ru,en])=>[w,'['+pronounce(w).text+']',romanize(w),kontsevich(w),ru+' / '+en,rule]);const SCRIPT_SECTIONS=[{id:'hangul',kind:'text',topic:'rules',level:'A1',title:T('Хангыль: как устроен алфавит','Hangul: how the alphabet works'),blocks:[{p:T('Корейский алфавит хангыль (한글) создан при короле Седжоне: опубликован в 1446 году в книге «Хунмин чоным» (훈민정음, «Правильные звуки для наставления народа»). До того писали китайскими иероглифами (ханча), и простым людям грамота была почти недоступна.','The Korean alphabet, Hangul (한글), was created under King Sejong and published in 1446 as Hunminjeongeum (훈민정음, "The correct sounds for instructing the people"). Before that Korean was written in Chinese characters (hanja), out of reach for most people.')},{p:T('Согласные рисуют органы речи: ㄱ — корень языка у нёба, ㄴ — кончик языка у зубов, ㅁ — сомкнутые губы, ㅅ — зуб, ㅇ — горло. Дополнительная черта добавляет силу или придыхание: ㄱ → ㅋ, ㄴ → ㄷ → ㅌ, ㅅ → ㅈ → ㅊ. Удвоение даёт напряжённые: ㄲ ㄸ ㅃ ㅆ ㅉ.','Consonants draw the speech organs: ㄱ the back of the tongue at the velum, ㄴ the tongue tip at the teeth, ㅁ the lips, ㅅ a tooth, ㅇ the throat. An extra stroke adds force or breath: ㄱ → ㅋ, ㄴ → ㄷ → ㅌ, ㅅ → ㅈ → ㅊ. Doubling gives the tense ones: ㄲ ㄸ ㅃ ㅆ ㅉ.')},{p:T('Гласные собраны из трёх знаков: точка — небо, ㅡ — земля, ㅣ — человек. Точка справа от ㅣ даёт ㅏ, слева — ㅓ; над ㅡ — ㅗ, под ㅡ — ㅜ. Вторая точка (черта) добавляет й: ㅑ ㅕ ㅛ ㅠ.','Vowels are built from three signs: a dot for heaven, ㅡ for earth, ㅣ for man. The dot right of ㅣ gives ㅏ, left ㅓ; above ㅡ ㅗ, below ㅡ ㅜ. A second dot (stroke) adds y: ㅑ ㅕ ㅛ ㅠ.')},{p:T('Три ряда смычных: простые (ㄱ ㄷ ㅂ ㅈ — слабые, звонкие между гласными), придыхательные (ㅋ ㅌ ㅍ ㅊ — с сильным выдохом) и напряжённые (ㄲ ㄸ ㅃ ㅉ — без выдоха, с зажатым горлом). Для русского уха простые и напряжённые часто звучат одинаково: слушайте и сравнивайте 가 / 카 / 까.','There are three series of stops: plain (ㄱ ㄷ ㅂ ㅈ — lax, voiced between vowels), aspirated (ㅋ ㅌ ㅍ ㅊ — a strong puff of air) and tense (ㄲ ㄸ ㅃ ㅉ — no breath, a tight throat). Listen and compare 가 / 카 / 까.')},{h:T('Согласные','Consonants')},{table:{head:['','название / name','RR','Концевич','МФА / IPA'],rows:consRows}},{h:T('Гласные','Vowels')},{table:{head:['','RR','Концевич','МФА / IPA'],rows:vowRows}},],},{id:'blocks',kind:'text',topic:'rules',level:'A1',title:T('Слоговые блоки','Syllable blocks'),blocks:[{p:T('Буквы пишутся не в строку, а складываются в квадратный слог: начальный согласный + гласный + (конечный согласный, 받침 «подставка»). Вертикальные гласные (ㅏ ㅓ ㅣ) ставятся справа: 가; горизонтальные (ㅗ ㅜ ㅡ) — снизу: 고; 받침 — всегда внизу: 각, 곡.','Letters are not written in a row but stacked into a square syllable: initial consonant + vowel + (final consonant, 받침 "support"). Vertical vowels (ㅏ ㅓ ㅣ) go to the right: 가; horizontal ones (ㅗ ㅜ ㅡ) below: 고; the final always at the bottom: 각, 곡.')},{p:T('Слог не может начинаться с гласной: пустое место занимает немая ㅇ (아, 오, 우). В конце слога та же ㅇ звучит как «нг»: 강 kang. Конечных может быть два (ㄳ ㄵ ㄶ ㄺ ㄻ ㄼ ㄽ ㄾ ㄿ ㅀ ㅄ), но произносится один, пока следом не придёт гласная.','A syllable cannot start with a vowel: the silent ㅇ fills the place (아, 오, 우). At the end of a syllable the same ㅇ is ng: 강 gang. A syllable can have two finals (ㄳ ㄵ ㄶ ㄺ ㄻ ㄼ ㄽ ㄾ ㄿ ㅀ ㅄ), but only one is said until a vowel follows.')},{table:{head:['слог / block','части / parts','RR','Концевич'],rows:BLOCKS.filter((b)=>['한','글','꽃','닭','값','왜','의','뭐'].includes(b.ch)).map((b)=>[b.ch,b.hint.en,b.tr,b.reading])}},{p:T('Всего возможных блоков 11 172 (19 начальных × 21 гласный × 28 вариантов конца), употребляется около двух тысяч. Инструмент «Слоги» собирает блок из букв и показывает произношение.','There are 11,172 possible blocks (19 initials × 21 vowels × 28 endings); about two thousand are in use. The "Syllables" tool builds a block from letters and shows how it is said.')},],},{id:'sounds',kind:'text',topic:'rules',level:'A2',title:T('Звуковые изменения: пишется одно — читается другое','Sound changes: written one way, said another'),intro:T('Орфография хангыля морфологическая: корень пишется всегда одинаково, а на стыке слогов звуки меняются по правилам. Романизация RR следует произношению (но не отмечает напряжение), транскрипция Концевича — тоже.','Hangul spelling is morphological: a root is always spelled the same, and sounds change at syllable boundaries by rule. The Revised Romanization follows the pronunciation (but does not mark tensing), and so does the Kontsevich transcription.'),blocks:[...Object.entries(SOUND_RULES).map(([,r])=>({p:r})),{table:{head:['пишется / written','читается / said','RR','Концевич','значение / meaning','правило / rule'],rows:soundRows}},],},];const conjRow=(stem,o,label)=>[label,...['seumnida','ayo','a',o.pos==='a'?'da':'neunda'].map((end)=>conjugate(stem,{...o,end}).form)];const SPEECH_ROWS=[conjRow('가',{},'가다 идти / go'),conjRow('먹',{},'먹다 есть / eat'),conjRow('하',{},'하다 делать / do'),conjRow('살',{},'살다 жить / live'),conjRow('듣',{cls:'d'},'듣다 слушать / listen'),conjRow('좋',{pos:'a'},'좋다 хороший / good'),conjRow('춥',{cls:'b',pos:'a'},'춥다 холодный / cold'),];const TENSE_ROWS=[['가',{}],['먹',{}],['하',{}],['오',{}],['마시',{}],['모르',{}]].map(([s,o])=>[s+'다',conjugate(s,{...o,end:'ayo'}).form,conjugate(s,{...o,past:true,end:'ayo'}).form,conjugate(s,{...o,end:'l'}).form+' 거예요',conjugate(s,{...o,hon:true,end:'ayo'}).form,conjugate(s,{...o,hon:true,past:true,end:'seumnida'}).form]);const IRR_ROWS=[['덥','b','ㅂ'],['돕','b-o','ㅂ (와)'],['듣','d','ㄷ'],['낫','s','ㅅ'],['모르','','르'],['그렇','h','ㅎ'],['바쁘','','으'],['살','','ㄹ']].map(([s,cls,k])=>[k,s+'다',conjugate(s,{cls,end:'ayo'}).form,conjugate(s,{cls,past:true,end:'ayo'}).form,conjugate(s,{cls,end:'myeon'}).form,conjugate(s,{cls,end:'n'}).form,conjugate(s,{cls,end:'seumnida'}).form]);const WORD_SECTIONS=[{id:'greet',kind:'words',topic:'situation',level:'A1',title:T('Приветствия и вежливые фразы','Greetings and polite phrases'),words:kw(`
안녕하세요 | здравствуйте | hello // букв. «вы в мире (благополучии)?»: 안녕 «мир» + 하 + -시- (почтение) + -어요 | lit. "are you at peace?": 안녕 "peace" + 하 + honorific -시- + -어요
안녕하십니까 | здравствуйте (официально) | hello (formal) // то же в 합니다체: дикторы, военные, приветствие начальства | the same in 합니다체: news, army, greeting superiors
안녕 | привет; пока | hi; bye // к друзьям и младшим (반말) | to friends and juniors (반말)
안녕히 가세요 | до свидания (уходящему) | goodbye (to one leaving) // «идите спокойно» | "go in peace"
안녕히 계세요 | до свидания (остающемуся) | goodbye (to one staying) // «оставайтесь спокойно»: 계시다 — почтительное «быть» | "stay in peace": 계시다 is honorific "be"
감사합니다 | спасибо | thank you // 감사 (感謝) — китайское слово + 하다 | 감사 (感謝) is Sino-Korean + 하다
고맙습니다 | спасибо | thank you // исконное слово, чуть теплее; 고마워요 — вежливо-разговорное | the native word, a little warmer; 고마워요 is polite casual
죄송합니다 | извините (официально) | I am sorry (formal) // 죄송 (罪悚) «трепещу от вины» | 죄송 (罪悚) "I tremble at my fault"
미안해요 | извините | sorry
괜찮아요 | ничего, всё в порядке | it is all right
네 | да | yes // также «слушаю», «понятно»; вежливее — 예 | also "I am listening", "I see"; more formal 예
아니요 | нет | no
반갑습니다 | рад(а) познакомиться | nice to meet you // 반갑다 — радость при встрече | 반갑다 is the joy of meeting
처음 뵙겠습니다 | впервые вас вижу (рад знакомству) | how do you do // 뵙다 — смиренное «видеть» | 뵙다 is humble "see"
잘 부탁드립니다 | прошу любить и жаловать | please treat me well // «хорошо прошу (вас)»; 드리다 — смиренное «давать» | "I ask well"; 드리다 is humble "give"
잘 먹겠습니다 | (говорят перед едой) | (said before a meal) // «хорошо поем»: -겠- — намерение | "I will eat well": -겠- is intention
잘 먹었습니다 | спасибо за еду | thank you for the meal // «хорошо поел» | "I ate well"
수고하셨습니다 | спасибо за труд | thank you for your work // «вы потрудились» | "you have toiled"
축하해요 | поздравляю | congratulations
생일 축하합니다 | с днём рождения | happy birthday
실례합니다 | извините (за беспокойство) | excuse me
잠깐만요 | минутку | just a moment
여보세요 | алло | hello (on the phone) // «посмотрите сюда» | "look here"
어서 오세요 | добро пожаловать | welcome // «скорее приходите» — в магазинах и кафе | "come quickly" — in shops and cafes
사랑해요 | я люблю тебя / вас | I love you
화이팅 | давай!, держись! | go for it! // из английского fighting | from English "fighting"
`),},{id:'numbers',kind:'text',topic:'rules',level:'A1',title:T('Числа: исконные и китайские','Numbers: native and Sino-Korean'),blocks:[{p:T('В корейском две системы чисел. Исконные (하나, 둘, 셋…) — для счёта предметов и людей, часов и возраста; до 99. Китайские (일, 이, 삼…) — для дат, минут, денег, номеров, этажей и больших чисел. Перед счётным словом 하나 → 한, 둘 → 두, 셋 → 세, 넷 → 네, 스물 → 스무: 한 개, 두 명, 세 시.','Korean has two number systems. Native (하나, 둘, 셋…) count things and people, hours and age, up to 99. Sino-Korean (일, 이, 삼…) give dates, minutes, money, numbers, floors and large numbers. Before a counter 하나 → 한, 둘 → 두, 셋 → 세, 넷 → 네, 스물 → 스무: 한 개, 두 명, 세 시.')},{table:{head:['','исконное / native','китайское / Sino-Korean'],rows:[[1,'하나 (한)','일 一'],[2,'둘 (두)','이 二'],[3,'셋 (세)','삼 三'],[4,'넷 (네)','사 四'],[5,'다섯','오 五'],[6,'여섯','육 六'],[7,'일곱','칠 七'],[8,'여덟','팔 八'],[9,'아홉','구 九'],[10,'열','십 十'],[20,'스물 (스무)','이십'],[30,'서른','삼십'],[40,'마흔','사십'],[50,'쉰','오십'],[100,'—','백 百'],[1000,'—','천 千'],['10 000','—','만 萬'],['100 000 000','—','억 億']].map((r)=>r.map(String))}},{p:T('Большие числа считают по 10 000 (만), а не по тысячам: 50 000 = 오만, 1 000 000 = 백만 («сто десятков тысяч»). Время: три часа двадцать минут = 세 시 이십 분 — часы исконными, минуты китайскими.','Large numbers go by 10,000 (만), not by thousands: 50,000 = 오만, 1,000,000 = 백만 ("a hundred ten-thousands"). Time: 3:20 = 세 시 이십 분 — native hours, Sino-Korean minutes.')},{ex:kw(`
한 개 | одна штука | one thing // 개 — счётное слово для предметов | 개 counts things
두 명 | два человека | two people // 명 — для людей; почтительно 분: 두 분 | 명 counts people; honorific 분
고양이 세 마리 | три кошки | three cats // 마리 — для животных | 마리 counts animals
스무 살 | двадцать лет (возраст) | twenty years old
세 시 | три часа | three o'clock
삼십 분 | тридцать минут | thirty minutes
만 원 | десять тысяч вон | ten thousand won
이천이십육 년 | 2026 год | the year 2026
삼 층 | третий этаж | third floor
공일공 | ноль-один-ноль (в телефоне) | zero-one-zero (in a phone number) // 공 «пусто» — ноль в номерах | 공 "empty" — zero in numbers
`)},],},{id:'particles',kind:'text',topic:'grammar',level:'A1',title:T('Частицы: роль слова в предложении','Particles: the role of a word'),blocks:[{p:T('Порядок слов — подлежащее, дополнение, сказуемое (глагол в конце). Роли показывают частицы после слова; у многих две формы: после согласного и после гласного.','Word order is subject — object — verb (the verb at the end). Roles are shown by particles after the word; many have two forms: after a consonant and after a vowel.')},{table:{head:['после согл. / after C','после гл. / after V','роль / role','пример / example'],rows:[['은','는','тема «что касается» / topic','저는 학생이에요 — я студент'],['이','가','подлежащее, новое / subject, new','비가 와요 — идёт дождь'],['을','를','прямое дополнение / object','책을 읽어요 — читаю книгу'],['에','에','где, куда, когда / at, to, in','학교에 가요 — иду в школу'],['에서','에서','где происходит; откуда / place of action; from','집에서 쉬어요 — отдыхаю дома'],['으로','로','куда; чем / towards; by','버스로 가요 — еду на автобусе'],['과','와','и, с / and, with','빵과 우유 — хлеб и молоко'],['의','의','чей / of','친구의 집 — дом друга'],['에게 / 한테','에게 / 한테','кому / to (a person)','친구한테 줘요 — даю другу'],['도','도','тоже / also','저도요 — я тоже'],['만','만','только / only','물만 마셔요 — пью только воду'],['까지','까지','до / until','다섯 시까지 — до пяти'],['부터','부터','с / from','아침부터 — с утра'],]}},{p:T('은/는 и 이/가 — главная трудность. 은/는 выносит тему («что до меня — …», известное, сопоставление), 이/가 отмечает подлежащее как новое или важное: 제가 할게요 «это я сделаю (а не кто-то другой)». Частицы в разговоре часто опускают.','은/는 versus 이/가 is the main difficulty. 은/는 sets the topic ("as for me…", known, in contrast), 이/가 marks the subject as new or in focus: 제가 할게요 "I (not someone else) will do it". Particles are often dropped in speech.')},],},{id:'endings',kind:'text',topic:'grammar',level:'A2',title:T('Окончания глагола и стили речи','Verb endings and speech levels'),blocks:[{p:T('Корейский глагол не меняется по лицам, зато меняется по отношению к собеседнику. Основа — слово без -다 (가다 → 가-), к ней присоединяются суффиксы и окончания: 가 + 시 + 었 + 습니다 = 가셨습니다 «(он) изволил уйти».','A Korean verb does not change for person, but it changes for the listener. The stem is the word without -다 (가다 → 가-); suffixes and endings follow: 가 + 시 + 었 + 습니다 = 가셨습니다 "(he, honoured) went".')},{table:{head:['','합니다체 (официальный / formal)','해요체 (вежливый / polite)','반말 (на «ты» / intimate)','해라체 (письменный / plain)'],rows:SPEECH_ROWS}},{p:T('해요체 — основной вежливый стиль: с незнакомыми, коллегами, в магазине. 합니다체 — официальный: новости, доклады, обслуживание, армия. 반말 («полуречь») — с близкими друзьями, младшими, детьми. 해라체 — книги, газеты, дневники и словарная форма.','해요체 is the everyday polite style: strangers, colleagues, shops. 합니다체 is formal: news, reports, service, the army. 반말 ("half speech") is for close friends, juniors, children. 해라체 is for books, newspapers, diaries.')},{p:T('Выбор 아 / 어: после основы с ㅏ или ㅗ — 아 (살아요, 좋아요), иначе — 어 (먹어요, 읽어요); 하다 → 해요. Гласные основы сливаются: 가+아요 → 가요, 오+아요 → 와요, 마시+어요 → 마셔요.','아 or 어: after a stem with ㅏ or ㅗ comes 아 (살아요), otherwise 어 (먹어요); 하다 → 해요. Stem vowels merge: 가+아요 → 가요, 오+아요 → 와요, 마시+어요 → 마셔요.')},{h:T('Времена и почтение','Tenses and honorifics')},{table:{head:['','настоящее / present','прошедшее / past','будущее / future','почтит. / honorific','почтит. прош. офиц.'],rows:TENSE_ROWS}},{h:T('Неправильные основы','Irregular stems')},{table:{head:['тип / type','','-아/어요','прош. / past','-(으)면','-(으)ㄴ','-습니다'],rows:IRR_ROWS}},{p:T('Отрицание: коротко — 안 перед глаголом (안 가요 «не иду»), 못 — «не могу» (못 가요); длинно — -지 않다 (가지 않아요), -지 못하다 (가지 못해요). Запрет: -지 마세요 (가지 마세요 «не уходите»). У 하다-глаголов 안 встаёт перед 하다: 공부 안 해요.','Negation: short — 안 before the verb (안 가요 "I do not go"), 못 "cannot" (못 가요); long — -지 않다 (가지 않아요), -지 못하다. Prohibition: -지 마세요 ("do not go"). With 하다 verbs 안 comes before 하다: 공부 안 해요.')},{p:T('Связки: -고 «и», -지만 «но», -아서/어서 «и потом; потому что», -(으)면 «если», -(으)니까 «раз, потому что», -는데 «а; и вот». Причастия: -는 (сейчас: 먹는 사람 «едящий»), -(으)ㄴ (прошлое: 먹은 사람 «тот, кто поел»; у прилагательных — просто определение: 큰 집), -(으)ㄹ (будущее: 먹을 것 «то, что будем есть»).','Connectives: -고 "and", -지만 "but", -아서/어서 "and then; because", -(으)면 "if", -(으)니까 "since", -는데 "and, but". Adnominals: -는 (now: 먹는 사람 "the one eating"), -(으)ㄴ (past; plain attribute for adjectives: 큰 집), -(으)ㄹ (future: 먹을 것 "something to eat").')},],},{id:'honor',kind:'text',topic:'grammar',level:'A2',title:T('Почтительность: о ком и с кем говорим','Honorifics: whom we speak about and to'),blocks:[{p:T('Корейская вежливость двухслойна. Стиль речи (해요체, 합니다체, 반말) — это отношение к слушателю. Почтительный суффикс -(으)시- и особые слова — отношение к тому, о ком говорят: 선생님이 오셨어요 «учитель пришёл» (с почтением к учителю, вежливо к слушателю).','Korean politeness has two layers. The speech level (해요체, 합니다체, 반말) is about the listener. The honorific -(으)시- and special words are about the person talked about: 선생님이 오셨어요 "the teacher came" (honouring the teacher, polite to the listener).')},{p:T('Возвышают другого — почтительные слова; принижают себя — скромные: я 저 (а не 나), мы 저희, «давать» 드리다 (а не 주다), «видеть» 뵙다, «спрашивать» 여쭈다. Частицы тоже: 께서 вместо 이/가, 께 вместо 에게.','One raises the other with honorific words and lowers oneself with humble ones: I 저 (not 나), we 저희, "give" 드리다 (not 주다), "see" 뵙다, "ask" 여쭈다. Particles too: 께서 for 이/가, 께 for 에게.')},{table:{head:['обычное / plain','почтительное / honorific','значение / meaning'],rows:[['있다','계시다','быть, находиться / be'],['먹다','드시다, 잡수시다','есть / eat'],['자다','주무시다','спать / sleep'],['죽다','돌아가시다','умереть / die'],['말하다','말씀하시다','говорить / speak'],['주다','드리다 (скромно / humble)','давать / give'],['집','댁','дом / house'],['밥','진지','еда / meal'],['나이','연세','возраст / age'],['이름','성함','имя / name'],['사람','분','человек / person'],['이/가','께서','подлежащее / subject'],['에게','께','кому / to']]}},{ex:kw(`
할머니께서 주무세요 | бабушка спит | grandmother is sleeping // 께서 + 주무시다: двойное почтение | 께서 + 주무시다: double honour
성함이 어떻게 되세요? | как вас зовут? | may I have your name? // букв. «как получается ваше имя?» | lit. "how does your name come out?"
연세가 어떻게 되세요? | сколько вам лет? | how old are you? (to an elder)
제가 도와 드릴게요 | я вам помогу | I will help you // -아/어 드리다: сделать для старшего | -아/어 드리다: do for an elder
식사하셨어요? | вы поели? | have you eaten? // обычное приветствие старшим | a common greeting to elders
`)},],},];const TALK_SECTIONS=[{id:'meet',kind:'dialogue',topic:'situation',level:'A1',title:T('Знакомство','Meeting someone'),lines:kl(`
민수: 안녕하세요. 저는 김민수예요. | Здравствуйте. Я Ким Минсу. | Hello. I am Kim Minsu. // фамилия впереди: 김 — самая частая | the surname first: 김 is the most common
안나: 안녕하세요. 저는 안나예요. 만나서 반갑습니다. | Здравствуйте. Я Анна. Рада познакомиться. | Hello. I am Anna. Nice to meet you. // 만나서 «встретившись» + 반갑다 | 만나서 "having met" + 반갑다
민수: 어느 나라 사람이에요? | Вы из какой страны? | Where are you from? // букв. «человек какой страны?» | lit. "a person of which country?"
안나: 러시아 사람이에요. 모스크바에서 왔어요. | Я из России. Приехала из Москвы. | I am Russian. I came from Moscow. // 에서 «из» + 왔어요 (오다, прош.) | 에서 "from" + 왔어요 (오다, past)
민수: 한국어를 잘하시네요! | Вы хорошо говорите по-корейски! | Your Korean is good! // -시- почтение, -네요 удивление | honorific -시-, -네요 surprise
안나: 아니에요, 아직 잘 못해요. | Что вы, я ещё плохо говорю. | Oh no, I am not good yet. // скромный ответ на похвалу | the modest answer to praise
민수: 무슨 일을 하세요? | Кем вы работаете? | What do you do? // «какое дело делаете?» | "what work do you do?"
안나: 대학교에서 한국어를 공부해요. | Учу корейский в университете. | I study Korean at university.
`),},{id:'cafe',kind:'dialogue',topic:'situation',level:'A1',title:T('В кафе','At a cafe'),lines:kl(`
직원: 어서 오세요. 뭐 드릴까요? | Добро пожаловать. Что вам подать? | Welcome. What can I get you? // 드리다 скромно + -ㄹ까요 «не…ли?» | humble 드리다 + -ㄹ까요 "shall I…?"
손님: 아이스 아메리카노 한 잔 주세요. | Один айс-американо, пожалуйста. | One iced americano, please. // 잔 — счётное «чашка», 한 — от 하나 | 잔 counts cups, 한 from 하나
직원: 사이즈는 어떻게 해 드릴까요? | Какой размер? | What size would you like?
손님: 큰 걸로 주세요. 여기서 마실게요. | Большой, пожалуйста. Выпью здесь. | A large one, please. I will drink it here. // 큰 것으로 → 큰 걸로; -ㄹ게요 обещание | 큰 것으로 → 큰 걸로; -ㄹ게요 promise
직원: 사천오백 원입니다. 카드 되세요? | 4 500 вон. Картой можно? | That is 4,500 won. Card? // китайские числа для денег | Sino-Korean numbers for money
손님: 네, 여기 있어요. | Да, вот. | Yes, here you are.
직원: 감사합니다. 맛있게 드세요! | Спасибо. Приятного аппетита! | Thank you. Enjoy! // «вкусно кушайте» | "eat deliciously"
`),},{id:'way',kind:'dialogue',topic:'situation',level:'A2',title:T('Как пройти, такси, магазин','Directions, taxi, shopping'),lines:kl(`
여행자: 실례합니다. 지하철역이 어디에 있어요? | Извините, где станция метро? | Excuse me, where is the subway station?
행인: 저기 은행 옆에 있어요. 오 분쯤 걸어가세요. | Вон там, рядом с банком. Идите минут пять. | Over there, next to the bank. Walk about five minutes. // 옆에 «сбоку», 쯤 «примерно» | 옆에 "beside", 쯤 "about"
여행자: 기사님, 서울역으로 가 주세요. | Водитель, на Сеульский вокзал, пожалуйста. | Driver, to Seoul Station, please. // 님 — почтительный суффикс; -아/어 주세요 просьба | 님 honorific; -아/어 주세요 request
기사: 네, 알겠습니다. | Да, понял. | Yes, certainly. // -겠- вежливое «понял(а)» | -겠- in a polite "understood"
손님: 이거 얼마예요? | Сколько это стоит? | How much is this?
점원: 만 이천 원이에요. | 12 000 вон. | 12,000 won.
손님: 너무 비싸요. 좀 깎아 주세요. | Слишком дорого. Сбавьте немного. | Too expensive. Please give me a discount. // 깎다 «строгать, срезать» | 깎다 "to shave off"
점원: 그럼 만 원에 드릴게요. | Тогда отдам за 10 000. | Then I will give it to you for 10,000.
`),},{id:'phrases',kind:'parse',topic:'speech',level:'A2',title:T('Фразы по частям','Phrases taken apart'),intro:T('Устойчивые фразы — обычные формы глаголов; разбор показывает, из чего они сложены (проверьте в инструменте «Разбор слова»).','Set phrases are ordinary verb forms; the breakdown shows what they are made of (try them in the "Word parser" tool).'),items:[{w:'안녕하세요',fused:true,tr:tr('안녕하세요'),m:T('здравствуйте','hello'),parts:[['안녕','安寧 «мир, покой»'],['하','하다 «быть, делать»'],['시','-(으)시- почтение к собеседнику'],['어요','вежливое окончание; 시+어요 → 세요']],lit:T('«вы пребываете в мире?»','"are you at peace?"'),note:T('Вопрос о благополучии стал приветствием — как старое русское «здравствуйте» («будьте здоровы»).','A question about well-being turned into a greeting.')},{w:'잘 먹겠습니다',tr:tr('잘 먹겠습니다'),m:T('(перед едой)','(before a meal)'),parts:[['잘','«хорошо»'],['먹','먹다 «есть»'],['겠','-겠- намерение'],['습니다','официальное окончание']],lit:T('«я (намерен) хорошо поесть»','"I intend to eat well"'),note:T('Благодарность хозяину или тому, кто платит; после еды — 잘 먹었습니다 (прошедшее -었-).','Thanks to the host or whoever pays; afterwards 잘 먹었습니다 (past -었-).')},{w:'수고하셨습니다',fused:true,tr:tr('수고하셨습니다'),m:T('спасибо за работу','thank you for your work'),parts:[['수고','受苦 «принять тяготы»'],['하','하다'],['시','почтение'],['었','прошедшее'],['습니다','официально']],lit:T('«вы потрудились (претерпели тяготы)»','"you have endured the toil"'),note:T('Говорят коллегам в конце дня, таксисту, продавцу. Старшему лучше 고생 많으셨습니다.','Said to colleagues at the end of the day, to a driver, a clerk.')},{w:'어떻게 지내세요',tr:tr('어떻게 지내세요'),m:T('как поживаете?','how are you?'),parts:[['어떻','어떻다 «каков» (ㅎ-неправильный)'],['게','-게 наречие: «как»'],['지내','지내다 «проводить время, жить»'],['세요','-(으)시- + -어요']],lit:T('«как вы проводите (время)?»','"how do you spend your days?"'),note:T('Ответ: 잘 지내요 «живу хорошо».','Answer: 잘 지내요 "I am well".')},{w:'배고파요',fused:true,tr:tr('배고파요'),m:T('я голоден','I am hungry'),parts:[['배','«живот»'],['고프','고프다 «пустой» (о животе)'],['아요','-아요; ㅡ выпадает: 고프+아요 → 고파요']],lit:T('«живот пуст»','"the belly is empty"'),note:T('Правило выпадения ㅡ: 아프다 → 아파요, 바쁘다 → 바빠요.','The ㅡ-drop rule: 아프다 → 아파요, 바쁘다 → 바빠요.')},{w:'모르겠어요',tr:tr('모르겠어요'),m:T('не знаю',"I don't know"),parts:[['모르','모르다 «не знать»'],['겠','-겠- смягчение: «кажется, не…»'],['어요','вежливо']],lit:T('«(похоже,) не знаю»','"it seems I do not know"'),note:T('Мягче, чем 몰라요; -겠- здесь не будущее, а осторожность.','Softer than 몰라요; -겠- here is not future but tact.')},],},];const THEME_SECTIONS=[{id:'w-people',kind:'words',topic:'objects',level:'A1',title:T('Люди и семья','People and family'),words:kw(`
# 가족 · семья
가족 | семья | family
어머니 | мать | mother
아버지 | отец | father
엄마 | мама | mum
아빠 | папа | dad
부모님 | родители | parents // 님 — почтительный суффикс | 님 is an honorific suffix
할머니 | бабушка | grandmother
할아버지 | дедушка | grandfather
형 | старший брат (у мужчины) | older brother (of a man) // старших родных называют по-разному мужчины и женщины | men and women name older siblings differently
오빠 | старший брат (у женщины) | older brother (of a woman)
누나 | старшая сестра (у мужчины) | older sister (of a man)
언니 | старшая сестра (у женщины) | older sister (of a woman)
동생 | младший брат / сестра | younger sibling
남동생 | младший брат | younger brother
여동생 | младшая сестра | younger sister
아들 | сын | son
딸 | дочь | daughter
남편 | муж | husband
아내 | жена | wife
아이 | ребёнок | child
아기 | малыш | baby
# 사람 · люди
사람 | человек | person
친구 | друг | friend
남자 | мужчина | man
여자 | женщина | woman
학생 | студент | student
선생님 | учитель | teacher
의사 | врач | doctor
간호사 | медсестра | nurse
회사원 | служащий | office worker
가수 | певец | singer
배우 | актёр | actor
요리사 | повар | cook
경찰 | полиция | police
손님 | гость, клиент | guest, customer
이웃 | сосед | neighbour
`),},{id:'w-food',kind:'words',topic:'objects',level:'A1',title:T('Еда и напитки','Food and drink'),words:kw(`
밥 | рис, еда | rice, meal // 밥 먹었어요? — «ты поел?» — почти приветствие | "have you eaten?" is almost a greeting
김치 | кимчхи | kimchi
불고기 | пулькоги (жареное мясо) | bulgogi // 불 «огонь» + 고기 «мясо» | 불 "fire" + 고기 "meat"
비빔밥 | пибимпап | bibimbap // 비비다 «перемешивать» + 밥 | 비비다 "to mix" + 밥
김밥 | кимпап | gimbap // 김 «сушёные водоросли» + 밥 | 김 "laver" + 밥
떡볶이 | токпокки | tteokbokki // 떡 «рисовый хлебец» + 볶다 «жарить» | 떡 "rice cake" + 볶다 "stir-fry"
라면 | рамён | ramyeon
냉면 | холодная лапша | cold noodles // 冷麵
국 | суп | soup
찌개 | густой суп, рагу | stew
고기 | мясо | meat
닭고기 | курица (мясо) | chicken
돼지고기 | свинина | pork
소고기 | говядина | beef
생선 | рыба (еда) | fish
야채 | овощи | vegetables
과일 | фрукты | fruit
사과 | яблоко | apple
배 | груша; живот; корабль | pear; belly; ship
포도 | виноград | grapes
딸기 | клубника | strawberry
수박 | арбуз | watermelon
빵 | хлеб | bread // из португальского pão | from Portuguese pão
계란 | яйцо | egg
물 | вода | water
차 | чай | tea
커피 | кофе | coffee
우유 | молоко | milk
주스 | сок | juice
술 | алкоголь | alcohol
소주 | соджу | soju
맥주 | пиво | beer
소금 | соль | salt
설탕 | сахар | sugar
맛있다 | вкусный | tasty // 맛 «вкус» + 있다 «есть» | 맛 "taste" + 있다 "there is"
맛없다 | невкусный | tasteless
맵다 | острый | spicy
달다 | сладкий | sweet
짜다 | солёный | salty
`),},{id:'w-city',kind:'words',topic:'objects',level:'A1',title:T('Дом и город','Home and city'),words:kw(`
# 집 · дом
집 | дом | house
방 | комната | room
문 | дверь | door
창문 | окно | window
부엌 | кухня | kitchen
화장실 | туалет, ванная | bathroom
침대 | кровать | bed
책상 | письменный стол | desk
의자 | стул | chair
컴퓨터 | компьютер | computer
전화 | телефон | telephone
핸드폰 | мобильный | mobile phone
텔레비전 | телевизор | television
냉장고 | холодильник | fridge
책 | книга | book
열쇠 | ключ | key
# 도시 · город
도시 | город | city
길 | дорога, улица | road
학교 | школа | school
대학교 | университет | university
회사 | компания | company
은행 | банк | bank
병원 | больница | hospital
약국 | аптека | pharmacy
시장 | рынок | market
가게 | магазин | shop
편의점 | круглосуточный магазин | convenience store
식당 | ресторан | restaurant
카페 | кафе | cafe
도서관 | библиотека | library
공원 | парк | park
호텔 | гостиница | hotel
교회 | церковь | church
절 | буддийский храм | Buddhist temple
# 교통 · транспорт
버스 | автобус | bus
지하철 | метро | subway
역 | станция | station
택시 | такси | taxi
기차 | поезд | train
비행기 | самолёт | plane
공항 | аэропорт | airport
자동차 | автомобиль | car
자전거 | велосипед | bicycle
배 | корабль | ship
표 | билет | ticket
`),},{id:'w-time',kind:'words',topic:'objects',level:'A1',title:T('Время, погода, природа','Time, weather, nature'),words:kw(`
# 시간 · время
오늘 | сегодня | today
내일 | завтра | tomorrow
어제 | вчера | yesterday
지금 | сейчас | now
아침 | утро; завтрак | morning; breakfast
점심 | полдень; обед | noon; lunch
저녁 | вечер; ужин | evening; dinner
밤 | ночь | night
시간 | время; час | time; hour
주말 | выходные | weekend
월요일 | понедельник | Monday // 月 «луна» | 月 "moon"
화요일 | вторник | Tuesday // 火 «огонь» | 火 "fire"
수요일 | среда | Wednesday // 水 «вода» | 水 "water"
목요일 | четверг | Thursday // 木 «дерево» | 木 "wood"
금요일 | пятница | Friday // 金 «металл» | 金 "metal"
토요일 | суббота | Saturday // 土 «земля» | 土 "earth"
일요일 | воскресенье | Sunday // 日 «солнце» | 日 "sun"
# 날씨 · погода
날씨 | погода | weather
비 | дождь | rain
눈 | снег; глаз | snow; eye
바람 | ветер | wind
구름 | облако | cloud
덥다 | жарко | hot
춥다 | холодно | cold
따뜻하다 | тепло | warm
시원하다 | прохладно, свежо | cool // также о супе: «освежающий» | also of soup: "refreshing"
봄 | весна | spring
여름 | лето | summer
가을 | осень | autumn
겨울 | зима | winter
# 자연 · природа
하늘 | небо | sky
해 | солнце; год | sun; year
달 | луна; месяц | moon; month
별 | звезда | star
산 | гора | mountain
강 | река | river
바다 | море | sea
꽃 | цветок | flower
나무 | дерево | tree
개 | собака | dog
고양이 | кошка | cat
새 | птица | bird
물고기 | рыба (живая) | fish
`),},{id:'w-body',kind:'words',topic:'objects',level:'A2',title:T('Тело и здоровье','Body and health'),words:kw(`
몸 | тело | body
머리 | голова; волосы | head; hair
얼굴 | лицо | face
눈 | глаз | eye
코 | нос | nose
입 | рот | mouth
귀 | ухо | ear
이 | зуб | tooth
목 | шея; горло | neck; throat
어깨 | плечо | shoulder
팔 | рука (от плеча) | arm
손 | кисть руки | hand
손가락 | палец | finger
배 | живот | belly
다리 | нога | leg
발 | ступня | foot
마음 | душа, сердце | heart, mind
아프다 | болеть | hurt, be ill
감기 | простуда | cold (illness)
약 | лекарство | medicine
열 | жар; десять | fever; ten
건강하다 | здоровый | healthy
피곤하다 | усталый | tired
`),},{id:'w-verbs',kind:'words',topic:'objects',level:'A1',title:T('Главные глаголы','Core verbs'),words:kw(`
가다 | идти, ехать | go
오다 | приходить | come
하다 | делать | do
있다 | быть, иметься | be, have
없다 | не быть, не иметься | not be, not have
먹다 | есть | eat
마시다 | пить | drink
보다 | смотреть | see
듣다 | слушать | listen // ㄷ-неправильный: 들어요 | ㄷ-irregular: 들어요
읽다 | читать | read
쓰다 | писать; использовать | write; use
말하다 | говорить | speak
배우다 | учиться (чему) | learn
가르치다 | учить (кого) | teach
공부하다 | заниматься, учиться | study
일하다 | работать | work
자다 | спать | sleep
일어나다 | вставать | get up
만나다 | встречать | meet
기다리다 | ждать | wait
사다 | покупать | buy
팔다 | продавать | sell
주다 | давать | give
받다 | получать | receive
알다 | знать | know // ㄹ-основа: 아는, 압니다 | ㄹ-stem: 아는, 압니다
모르다 | не знать | not know // 르-неправильный: 몰라요 | 르-irregular: 몰라요
살다 | жить | live
만들다 | делать, создавать | make
좋아하다 | любить, нравиться | like
사랑하다 | любить | love
생각하다 | думать | think
찾다 | искать; найти | look for; find
열다 | открывать | open
닫다 | закрывать | close
앉다 | садиться | sit
서다 | стоять | stand
걷다 | ходить пешком | walk // ㄷ-неправильный: 걸어요 | ㄷ-irregular: 걸어요
타다 | садиться (в транспорт) | ride
놀다 | играть, гулять | play
쉬다 | отдыхать | rest
돕다 | помогать | help // ㅂ-неправильный: 도와요 | ㅂ-irregular: 도와요
울다 | плакать | cry
웃다 | смеяться | laugh
입다 | надевать | wear
씻다 | мыть | wash
`),},{id:'w-adj',kind:'words',topic:'objects',level:'A1',title:T('Прилагательные','Adjectives'),intro:T('Корейские прилагательные — это глаголы состояния: 크다 «быть большим» спрягается как глагол (커요 «большой»), а перед словом стоит в форме причастия: 큰 집 «большой дом».','Korean adjectives are stative verbs: 크다 "to be big" conjugates like a verb (커요 "it is big") and before a noun takes the adnominal form: 큰 집 "a big house".'),words:kw(`
크다 | большой | big
작다 | маленький | small
많다 | многочисленный | many
적다 | немногочисленный | few
좋다 | хороший | good
나쁘다 | плохой | bad
예쁘다 | красивый | pretty
아름답다 | прекрасный | beautiful
귀엽다 | милый | cute
멋있다 | классный, стильный | cool, stylish
새롭다 | новый | new
오래되다 | старый (давний) | old
비싸다 | дорогой | expensive
싸다 | дешёвый | cheap
쉽다 | лёгкий | easy
어렵다 | трудный | difficult
바쁘다 | занятой | busy
재미있다 | интересный | fun
재미없다 | скучный | boring
길다 | длинный | long
짧다 | короткий | short
높다 | высокий | high
낮다 | низкий | low
빠르다 | быстрый | fast
느리다 | медленный | slow
가깝다 | близкий | near
멀다 | далёкий | far
기쁘다 | радостный | glad
슬프다 | грустный | sad
행복하다 | счастливый | happy
조용하다 | тихий | quiet
깨끗하다 | чистый | clean
빨갛다 | красный | red // ㅎ-неправильный: 빨간, 빨개요 | ㅎ-irregular: 빨간, 빨개요
파랗다 | синий | blue
노랗다 | жёлтый | yellow
하얗다 | белый | white
까맣다 | чёрный | black
`),},{id:'w-abstract',kind:'words',topic:'abstract',level:'B1',title:T('Понятия и чувства','Concepts and feelings'),intro:T('Многие отвлечённые слова — китайского происхождения (한자어); их иероглифы помогают угадать смысл: 사랑 исконное, а 행복 = 幸福.','Many abstract words are Sino-Korean (한자어); their characters hint at the meaning: 사랑 is native, 행복 = 幸福.'),words:kw(`
사랑 | любовь | love
마음 | сердце, душа | heart, mind
생각 | мысль | thought
꿈 | мечта; сон | dream
행복 | счастье | happiness // 幸福
자유 | свобода | freedom // 自由
평화 | мир | peace // 平和
희망 | надежда | hope // 希望
시간 | время | time // 時間
세상 | мир, свет | the world // 世上
인생 | жизнь (человеческая) | life // 人生
문화 | культура | culture // 文化
역사 | история | history // 歷史
정 | привязанность, тепло | affection // 情: тёплая связь, что растёт со временем | 情: a warm bond that grows over time
한 | затаённая скорбь | han, deep sorrow // 恨: долгая невыплаканная обида — частая тема песен | 恨: a long unwept grief, a frequent theme of songs
눈치 | чутьё, умение читать ситуацию | nunchi, social tact // «мерка глаз»: понять, не дожидаясь слов | "measure of the eyes": understanding without words
우리 | мы, наш | we, our // говорят 우리 엄마 «наша мама» даже о своей | people say 우리 엄마 "our mum" even of their own
기분 | настроение | mood // 氣分
걱정 | беспокойство | worry
약속 | обещание; встреча | promise; appointment // 約束
`),},];const POEM_SECTIONS=[{id:'sijo',kind:'poem',topic:'poetry',level:'B2',title:T('Сиджо: «Песня о верном сердце» и ответ','Sijo: the "Song of a Loyal Heart" and its question'),intro:T('Сиджо (시조) — корейское трёхстишие XIV–XIX веков: каждая строка из двух полустиший по 3–4 + 3–4 слога (всего около 45), третья строка начинается с поворота в три слога. Около 1392 года будущий король Ли Банвон спросил верного прежней династии Чон Мончжу в стихах «Хаёга» (하여가), а тот ответил «Тансимга» (단심가). Тексты — XIV век, общественное достояние; перевод учебный.','Sijo (시조) is the Korean three-line poem of the 14th–19th centuries: each line has two halves of 3–4 + 3–4 syllables (about 45 in all); the third line opens with a three-syllable turn. Around 1392 the future king Yi Bangwon questioned Jeong Mongju, loyal to the old dynasty, in "Hayeoga" (하여가), and Jeong answered with "Dansimga" (단심가). 14th-century texts, public domain; a study translation.'),lines:kl(`
이방원: 이런들 어떠하며 저런들 어떠하리 | Так ли будет — что с того? Эдак ли — что с того? | What if it be this way, what if it be that? // -ㄴ들 «пусть даже»; -리 — старое окончание риторического вопроса | -ㄴ들 "even if"; -리 an old rhetorical ending
이방원: 만수산 드렁칡이 얽어진들 어떠하리 | Пусть на горе Мансусан сплелись лозы кудзу — что с того? | What if the arrowroot vines on Mansu Hill entwine? // 칡 «кудзу» — образ союза | 칡 "arrowroot" — an image of union
이방원: 우리도 이같이 얽어져 백 년까지 누리리라 | Сплетёмся и мы так же — и проживём сто лет. | Let us entwine like them and enjoy a hundred years. // призыв перейти на сторону новой династии | a call to join the new dynasty
정몽주: 이 몸이 죽고 죽어 일백 번 고쳐 죽어 | Пусть это тело умрёт и умрёт, сто раз умрёт заново, | Though this body die and die, die a hundred times over, // 고쳐 «заново, переделав» | 고쳐 "again, remade"
정몽주: 백골이 진토되어 넋이라도 있고 없고 | пусть белые кости станут прахом, будь то с душой или без, | though white bones turn to dust, whether a soul remains or not, // 진토 塵土 «прах»; 넋 «душа» | 진토 塵土 "dust"; 넋 "soul"
정몽주: 임 향한 일편단심이야 가실 줄이 있으랴 | верное сердце, обращённое к государю, — разве может оно измениться? | can a single loyal heart turned to my lord ever change? // 일편단심 一片丹心 «кусочек алого сердца» — идиома верности | 일편단심 一片丹心 "a piece of crimson heart" — the idiom of loyalty
`),note:T('Ответ стоил Чон Мончжу жизни: его убили на мосту Сончжуккё в Кэсоне. Идиома 일편단심 живёт в языке до сих пор.','The answer cost Jeong Mongju his life: he was killed on the Seonjuk Bridge in Kaesong. The idiom 일편단심 is still in use.'),},{id:'sijo2',kind:'poem',topic:'poetry',level:'B2',title:T('Хван Чини: «Лазурный поток в зелёных горах»','Hwang Jini: "Blue Stream in the Green Hills"'),intro:T('Хван Чини (XVI век) — поэтесса-кисэн из Кэсона. Здесь игра слов: 벽계수 «лазурный поток» — и прозвище знатного гостя, 명월 «ясная луна» — её собственное имя кисэн.','Hwang Jini (16th century) was a kisaeng poet of Kaesong. A play on words: 벽계수 "blue stream" is also the name of a noble guest, 명월 "bright moon" her own kisaeng name.'),lines:kl(`
청산리 벽계수야 수이 감을 자랑 마라 | Лазурный поток в зелёных горах, не хвались, что бежишь так быстро: | Blue stream among green hills, do not boast of your swift going: // -야 обращение; 마라 — запрет (말다) | -야 vocative; 마라 prohibition (말다)
일도창해하면 다시 오기 어려우니 | раз достигнешь моря — вернуться будет трудно. | once you reach the sea, it is hard to come back. // 일도창해 一到滄海 «единожды достичь моря» | 一到滄海 "once reach the blue sea"
명월이 만공산하니 쉬어 간들 어떠리 | Ясная луна залила пустые горы — отчего бы не отдохнуть, прежде чем уйти? | The bright moon fills the empty hills — why not rest a while before you go? // 쉬어 가다 «отдохнув, пойти» | 쉬어 가다 "rest, then go"
`),},];const NOTE_SECTIONS=[{id:'grammar',kind:'text',topic:'grammar',level:'A2',title:T('Заметки о грамматике','Grammar notes'),blocks:[{p:T('Корейский — агглютинативный язык: к основе одно за другим присоединяются суффиксы, каждый со своим значением (가 + 시 + 었 + 겠 + 습니다). Поэтому одно слово (어절, «то, что между пробелами») часто равно целой русской фразе.','Korean is agglutinative: suffixes, each with one meaning, attach one after another to the stem (가 + 시 + 었 + 겠 + 습니다). One word (어절, "what is between spaces") often equals a whole English phrase.')},{p:T('Подлежащее опускают, если понятно из ситуации: 어디 가요? «Куда (ты) идёшь?». Местоимения «ты / вы» почти не употребляют: обращаются по имени, должности или родству (선생님, 언니, 사장님).','The subject is dropped when it is clear: 어디 가요? "Where are (you) going?". "You" is rarely said: people use names, titles or kinship terms (선생님, 언니, 사장님).')},{p:T('Определение всегда стоит перед определяемым, даже целое придаточное: 어제 제가 산 책 «книга, которую я вчера купил» (букв. «вчера я купленная книга»).','Modifiers always come before what they modify, even a whole clause: 어제 제가 산 책 "the book I bought yesterday" (lit. "yesterday I bought book").')},{p:T('Около 60 % словаря — китайского происхождения (한자어), как латинские корни в русском и английском. Исконные слова (고유어) и заимствования (외래어: 커피, 컴퓨터) — остальное. Ханча сегодня пишут редко, но знание корней (學 학 «учиться»: 학교, 학생, 대학) помогает.','About 60% of the vocabulary is Sino-Korean (한자어), like Latin roots in English. Native words (고유어) and loans (외래어: 커피, 컴퓨터) make up the rest. Hanja are rarely written today, but knowing roots (學 학 "learn": 학교, 학생, 대학) helps.')},{p:T('Закон начального звука (두음법칙): в начале слова ㄹ и ㄴ перед и / й в китайских словах меняются: 力 력 → 역도 «тяжёлая атлетика», 女 녀 → 여자 «женщина», 老 로 → 노인 «старик». В КНДР пишут без этой замены: 녀자, 로인.','The initial sound law (두음법칙): at the start of Sino-Korean words ㄹ and ㄴ before i / y change: 力 력 → 역도, 女 녀 → 여자, 老 로 → 노인. North Korea writes them unchanged: 녀자, 로인.')},{ex:kw(`
저는 한국어를 공부해요 | я учу корейский | I study Korean // тема + дополнение + глагол | topic + object + verb
어제 친구를 만났어요 | вчера я встретился с другом | I met a friend yesterday
한국에 가고 싶어요 | хочу поехать в Корею | I want to go to Korea // -고 싶다 | -고 싶다
비가 와서 집에 있었어요 | шёл дождь, и я был дома | it rained, so I stayed home // -아서 причина | -아서 cause
시간이 있으면 같이 가요 | если будет время, пойдём вместе | if you have time, let's go together // -(으)면 условие; 가요 и «пойдём» | -(으)면 condition; 가요 also "let's go"
이건 제가 만든 김치예요 | это кимчхи, которое сделала я | this is kimchi I made // причастие 만든 (ㄹ выпало) | adnominal 만든 (ㄹ dropped)
`)},],},{id:'culture',kind:'text',topic:'culture',level:'B1',title:T('Хангыль и культура','Hangul and culture'),blocks:[{p:T('9 октября в Южной Корее — День хангыля (한글날), 15 января в КНДР — День чосонгыля (조선글). Король Седжон в предисловии к «Хунмин чоным» писал, что буквы созданы, чтобы каждый мог выучить их за одно утро.','October 9 is Hangul Day (한글날) in South Korea; North Korea marks Chosŏn’gŭl Day on January 15. In his preface King Sejong wrote that the letters were made so that anyone could learn them in a single morning.')},{p:T('Корейские фамилии короткие и немногочисленные: Ким (김), Ли (이), Пак (박), Чхве (최), Чон (정) — у половины населения. Женщины при замужестве фамилию не меняют.','Korean surnames are short and few: Kim (김), Lee (이), Park (박), Choi (최), Jeong (정) cover half the population. Women keep their surname when they marry.')},{p:T('Возраст и статус определяют речь: при знакомстве спрашивают год рождения, чтобы выбрать стиль. С 2023 года официально считают «международный» возраст (만 나이), а не традиционный, где ребёнку при рождении уже год.','Age and status shape speech: on meeting, people ask the birth year to choose the speech level. Since 2023 the "international" age (만 나이) is official instead of the traditional count where a newborn is already one.')},{p:T('Корё-сарам (고려 사람) — корейцы бывшего СССР, депортированные в 1937 году с Дальнего Востока в Среднюю Азию. Их язык, корё-мар, сохранил северо-восточные диалектные черты; морковча (морковь по-корейски) — их кухня, в самой Корее её не знали.','Koryo-saram (고려 사람) are the Koreans of the former USSR, deported in 1937 from the Far East to Central Asia. Their language, Koryo-mal, keeps north-eastern dialect features; "Korean carrots" are their cuisine, unknown in Korea itself.')},],},];const SECTIONS=[...SCRIPT_SECTIONS,...WORD_SECTIONS,...TALK_SECTIONS,...THEME_SECTIONS,...POEM_SECTIONS,...NOTE_SECTIONS];const COURSE={id:'ko',native:'한국어',speech:'ko-KR',explain:['ru','en'],script:'Kore',name:{ru:'Корейский',en:'Korean',uk:'Корейська',de:'Koreanisch',fr:'Coréen',es:'Coreano',ka:'კორეული'},scripts:[{id:'consonants',name:T('Согласные','Consonants'),letters:CONSONANTS},{id:'vowels',name:T('Гласные','Vowels'),letters:VOWELS},{id:'blocks',name:T('Слоги','Syllable blocks'),letters:BLOCKS},],tools:['ko-hangul','ko-parse'],games:[],sections:SECTIONS,};export{kw,COURSE};