const AB=[['ა','a','а','ɑ','ანი'],['ბ','b','б','b','ბანი'],['გ','g','г','ɡ','განი'],['დ','d','д','d','დონი'],['ე','e','э','ɛ','ენი'],['ვ','v','в','v','ვინი'],['ზ','z','з','z','ზენი'],['თ','t','т','tʰ','თანი'],['ი','i','и','i','ინი'],['კ',"k'",'к’','kʼ','კანი'],['ლ','l','л','l','ლასი'],['მ','m','м','m','მანი'],['ნ','n','н','n','ნარი'],['ო','o','о','ɔ','ონი'],['პ',"p'",'п’','pʼ','პარი'],['ჟ','zh','ж','ʒ','ჟანი'],['რ','r','р','r','რაე'],['ს','s','с','s','სანი'],['ტ',"t'",'т’','tʼ','ტარი'],['უ','u','у','u','უნი'],['ფ','p','п','pʰ','ფარი'],['ქ','k','к','kʰ','ქანი'],['ღ','gh','гъ','ɣ','ღანი'],['ყ',"q'",'къ','qʼ','ყარი'],['შ','sh','ш','ʃ','შინი'],['ჩ','ch','ч','tʃʰ','ჩინი'],['ც','ts','ц','tsʰ','ცანი'],['ძ','dz','дз','dz','ძილი'],['წ',"ts'",'ц’','tsʼ','წილი'],['ჭ',"ch'",'ч’','tʃʼ','ჭარი'],['ხ','kh','х','χ','ხანი'],['ჯ','j','дж','dʒ','ჯანი'],['ჰ','h','һ','h','ჰაე'],['ჷ','ə','ы','ə','ჷნ (yn)'],['ჸ','ʔ','ʼ','ʔ','ჸ (elifi)'],['ჲ','y','й','j','ჲე (hie)'],];const EXTRA_NOTES={'ჷ':{ru:'Шва: неясный гласный, средний между ы и э; часто в конце слова на месте -ი (კოჩი ~ კოჩჷ) и в безударных слогах.',en:'Schwa: a neutral vowel between Russian ы and э; often word-finally in place of -i (k\'oči ~ k\'očə) and in unstressed syllables.'},'ჸ':{ru:'Гортанная смычка (как пауза в «не-а»). Обычно соответствует грузинскому ყ: ყური «ухо» — ჸუჯი. В части текстов пишут ყ.',en:'Glottal stop (the catch in "uh-oh"). Usually corresponds to Georgian ყ: ყური "ear" — ჸუჯი. Some texts write ყ instead.'},'ჲ':{ru:'Полугласный й. Встречается редко, в основном между гласными и в заимствованиях.',en:'The glide y. Rare, mostly between vowels and in loanwords.'},'ჰ':{ru:'В мегрельском h почти не встречается: в междометиях и заимствованиях.',en:'h is marginal in Mingrelian: interjections and loanwords.'},'ყ':{ru:'В мегрельском ყ во многих словах перешёл в гортанную смычку ჸ; в некоторых словах и говорах ყ сохраняется.',en:'In many Mingrelian words ყ became the glottal stop ჸ; some words and varieties keep ყ.'},};const ALPHABET=AB.map(([ch,lat,ru,ipa,name])=>({ch,lat,ru,ipa,name,extra:'ჷჸჲ'.includes(ch),note:EXTRA_NOTES[ch]||null}));const NOT_USED=[{ch:'ჴ',name:'ჴარ (har)',ru:'увулярный q: древнегрузинский и сванский, не мегрельский',en:'uvular q: Old Georgian and Svan, not Mingrelian'},{ch:'ჵ',name:'ჵე (hoe)',ru:'долгое ō: древнегрузинский и сванский',en:'long ō: Old Georgian and Svan'},{ch:'ჳ',name:'ჳე (we)',ru:'древнегрузинское w',en:'Old Georgian w'},];const MAP={lat:{},ru:{},ipa:{}};for(const a of ALPHABET){MAP.lat[a.ch]=a.lat;MAP.ru[a.ch]=a.ru;MAP.ipa[a.ch]=a.ipa;};const GEO=/[ა-ჰჷჸჲ]/u;function translit(text,to='lat'){const map=MAP[to]||MAP.lat;return[...String(text)].map((c)=>map[c]??c).join('');}
const LAT_IN=[["ts'",'წ'],["ch'",'ჭ'],["k'",'კ'],["p'",'პ'],["t'",'ტ'],["q'",'ყ'],['ts','ც'],['ch','ჩ'],['dz','ძ'],['zh','ჟ'],['sh','შ'],['kh','ხ'],['gh','ღ'],['č','ჩ'],['š','შ'],['ž','ჟ'],['ǯ','ჯ'],['ʒ','ძ'],['ɣ','ღ'],['x','ხ'],['c','ც'],['q','ყ'],['ə','ჷ'],['ǝ','ჷ'],['ʔ','ჸ'],["'",'ჸ'],['’','ჸ'],['y','ჲ'],['a','ა'],['b','ბ'],['g','გ'],['d','დ'],['e','ე'],['v','ვ'],['w','ვ'],['z','ზ'],['t','თ'],['i','ი'],['k','ქ'],['l','ლ'],['m','მ'],['n','ნ'],['o','ო'],['p','ფ'],['r','რ'],['s','ს'],['u','უ'],['j','ჯ'],['h','ჰ'],];const RU_IN=[['ц’','წ'],['ч’','ჭ'],['к’','კ'],['п’','პ'],['т’','ტ'],["ц'",'წ'],["ч'",'ჭ'],["к'",'კ'],["п'",'პ'],["т'",'ტ'],['дж','ჯ'],['дз','ძ'],['гъ','ღ'],['къ','ყ'],['ʼ','ჸ'],['’','ჸ'],["'",'ჸ'],['а','ა'],['б','ბ'],['г','გ'],['д','დ'],['е','ე'],['э','ე'],['в','ვ'],['з','ზ'],['т','თ'],['и','ი'],['к','ქ'],['л','ლ'],['м','მ'],['н','ნ'],['о','ო'],['п','ფ'],['ж','ჟ'],['р','რ'],['с','ს'],['у','უ'],['ф','ფ'],['х','ხ'],['ш','შ'],['ч','ჩ'],['ц','ც'],['ы','ჷ'],['й','ჲ'],['һ','ჰ'],];function convertIn(text,table){const s=String(text).toLowerCase();let out='';for(let i=0;i<s.length;){const hit=table.find(([k])=>s.startsWith(k,i));if(hit){out+=hit[1];i+=hit[0].length;}else{out+=s[i];i++;}}
return out;}
const fromLatin=(text)=>convertIn(text,LAT_IN);const fromRussian=(text)=>convertIn(text,RU_IN);function toScript(text){const s=String(text);if(GEO.test(s)&&!/[a-zа-я]/i.test(s))return s;return/[а-яё]/i.test(s)?fromRussian(s):fromLatin(s);}
const LEX=`
# family
დიდა | n | мать | mother | დედა |
ნანა | n | мама (ласковое) | mum | ნანა | ?
მუმა | n | отец | father | მამა |
ჯიმა | n | брат | brother | ძმა |
და | n | сестра | sister | და |
სქუა | n | ребёнок; сын | child; son | — |
ბაღანა | n | дитя, малыш | child, baby | — |
ცირა | n | девушка, девочка | girl | — |
ბოში | n | мальчик, парень | boy, lad | — |
ჩილი | n | жена | wife | — |
ქომონჯი | n | муж | husband | — |
ნოსა | n | невестка | daughter-in-law | — | ?
მოთა | n | внук, внучка | grandchild | — | ?
სიძე | n | зять | son-in-law | სიძე | ?
ბებუ | n | бабушка | grandmother | ბებია | ?
ბაბუ | n | дедушка | grandfather | ბაბუა | ?
ბიძია | n | дядя | uncle | ბიძა | ?
სქუალეფი | n | дети | children | — | ?
ოჯახი | n | семья | family | ოჯახი | ?
# people
კოჩი | n | человек; мужчина | person; man | კაცი |
ოსური | n | женщина | woman | — |
მარგალი | n | мегрел | Mingrelian (person) | მეგრელი |
სამარგალო | n | Мегрелия | Mingrelia | სამეგრელო |
საქორთუო | n | Грузия | Georgia | საქართველო |
მარგალური | a | мегрельский | Mingrelian | მეგრული |
ქორთული | a | грузинский (язык) | Georgian (language) | ქართული | ?
ნინა | n | язык (речь и орган) | language; tongue | ენა | k?
ჯოხო | n | имя | name | — |
ღორონთი | n | Бог | God | ღმერთი | k?
ქიანა | n | мир, страна, земля | world, country | ქვეყანა | k?
ოხორი | n | дом | house | — |
ნოღა | n | город; рынок | town; market | — | ?
ოხვამე | n | церковь (место молитвы) | church (place of prayer) | — | ?
ოფუტე | n | село, деревня | village | — | ?
ჸუდე | n | дом | house | — | ?
მეზობელი | n | сосед | neighbour | მეზობელი | ?
სტუმარი | n | гость | guest | სტუმარი | ?
ნოსი | n | ум, разум | mind | — | ?
მარდი | phrase | спасибо (благодарность) | thank you | მადლი | k?
# body
დუდი | n | голова | head | — |
თოლი | n | глаз | eye | თვალი |
ჸუჯი | n | ухо | ear | ყური |
ცხვინდი | n | нос | nose | ცხვირი |
პიჯი | n | рот | mouth | პირი |
ხე | n | рука | hand, arm | ხელი |
კუჩხი | n | нога | foot, leg | — |
კითი | n | палец | finger | თითი | ?
გური | n | сердце | heart | გული |
კიბირი | n | зуб | tooth | კბილი |
თომა | n | волосы | hair | თმა |
ზისხირი | n | кровь | blood | სისხლი | ?
თვალეფი | n | глаза | eyes | თვალები | ?
ხეეფი | n | руки | hands | ხელები | ?
# nature
ბჟა | n | солнце; день | sun; day | მზე |
თუთა | n | луна; месяц | moon; month | — |
მურიცხი | n | звезда | star | — |
ცა | n | небо | sky | ცა |
დიხა | n | земля, почва | earth, soil | — |
ქვა | n | камень | stone | ქვა |
ჯა | n | дерево | tree | — |
დაჩხირი | n | огонь | fire | — |
წყარი | n | вода | water | წყალი |
ზუღა | n | море | sea | ზღვა |
ღალი | n | река | river | — | ?
ნიარი | n | ветер | wind | — | ?
ჭვიმა | n | дождь | rain | წვიმა | ?
ტყა | n | лес | forest | ტყე | ?
ჸონა | n | нива, поле | field | ყანა | ?
ჭყონი | n | дуб | oak | — | ?
თხირი | n | лесной орех, фундук | hazelnut | თხილი | ?
ქვინჩი | n | птица | bird | — | ?
ბჟალია | n | мята | mint | — | ?
მთა | n | гора | mountain | მთა | ?
ჭალა | n | пойма, луг у реки | riverside meadow | ჭალა | ?
# time
დღა | n | день | day | დღე |
სერი | n | ночь | night | — |
წანა | n | год | year | წელი | k?
ანდღა | adv | сегодня | today | დღეს | k?
ღუმა | adv | вчера | yesterday | — | ?
ასე | adv | сейчас | now | — | ?
ბჟაშხა | n | воскресенье (день солнца) | Sunday (day of the sun) | — |
თუთაშხა | n | понедельник (день луны) | Monday (day of the moon) | — | ?
ობიშხა | n | пятница | Friday | — | ?
საბატონი | n | суббота | Saturday | შაბათი | ? k?
ჩხოლე | adv | завтра | tomorrow | — | ?
# animals
ჯოღორი | n | собака | dog | ძაღლი |
კატუ | n | кошка | cat | კატა | ?
ფუ | n | корова | cow | ფური |
ცხენი | n | лошадь | horse | ცხენი |
ღეჯი | n | свинья | pig | ღორი |
ქოთომი | n | курица | hen | ქათამი |
ჩხომი | n | рыба | fish | — |
მგერი | n | волк | wolf | მგელი |
ხოჯი | n | бык, вол | ox | ხარი |
თხა | n | коза | goat | თხა | ?
ქვინჩეფი | n | птицы | birds | — | ?
ჩხომეფი | n | рыбы | fish (pl.) | — | ?
# food
ქობალი | n | хлеб | bread | — |
ქვალი | n | сыр | cheese | ყველი |
ღვინი | n | вино | wine | ღვინო |
ღომი | n | гоми (кукурузная каша) | gomi (maize porridge) | ღომი |
ელარჯი | n | эларджи (гоми с сыром) | elarji (gomi with cheese) | ელარჯი |
გებჟალია | n | гебжалия (сыр в мятной заправке) | gebzhalia (cheese in a mint dressing) | გებჟალია |
ჭვიშტარი | n | чвиштари (кукурузная лепёшка с сыром) | chvishtari (maize cake with cheese) | ჭვიშტარი |
კუჭმაჭი | n | кучмачи (блюдо из потрохов) | kuchmachi (a dish of offal) | კუჭმაჭი |
აჯიკა | n | аджика | ajika (hot paste) | აჯიკა |
უშქური | n | яблоко | apple | ვაშლი | k?
თაფური | n | мёд | honey | თაფლი | ?
ჯიმი | n | соль | salt | — | ?
ოჭკომალი | n | еда | food | — |
ლობიო | n | фасоль | beans | ლობიო | ?
ხორცი | n | мясо | meat | ხორცი | ?
ჭადი | n | кукурузная лепёшка | maize bread | მჭადი | ? k?
# qualities
ჯგირი | a | хороший | good | — |
დიდი | a | большой | big | დიდი |
ჭიჭე | a | маленький | small | — | ?
ჯვეში | a | старый | old | ძველი |
ახალი | a | новый | new | ახალი | ?
ჩე | a | белый | white | — | ?
უჩა | a | чёрный | black | — |
ჭითა | a | красный | red | წითელი |
ბრელი | a | много, многий | much, many | — |
გინძე | a | длинный | long | გრძელი | ?
ტიბუ | a | тёплый | warm | თბილი | k?
ჯგირო | adv | хорошо | well | — | ?
ლამაზი | a | красивый | beautiful | ლამაზი | ?
# pronouns
მა | pron | я | I | მე |
სი | pron | ты | you (sg.) | — |
თინა | pron | он, она; тот | he, she; that | — |
ათე | pron | этот | this | — |
ჩქი | pron | мы | we | ჩვენ |
თქვა | pron | вы | you (pl.) | თქვენ |
თინეფი | pron | они | they | — | ?
ჩქიმი | pron | мой | my | ჩემი |
სქანი | pron | твой | your (sg.) | შენი | k?
ჩქინი | pron | наш | our | ჩვენი |
თქვანი | pron | ваш | your (pl.) | თქვენი |
მუში | pron | его, её | his, her | — | ?
# questions
მუ | q | что | what | — |
მი | q | кто | who | — |
სო | q | где | where | სად |
მუჭო | q | как | how | — |
მუშენ | q | почему, зачем | why | — |
მუჟამს | q | когда | when | — | ?
# particles
დო | conj | и | and | და |
მარა | conj | но | but | — | ?
ვა | part | не | not | — |
ვარ | part | нет | no | — |
ქო | part | да; утвердительная частица | yes; affirmative particle | — | ?
ვო | int | о! (восклицание) | oh! | — | ?
რე | form | есть (связка «является») | is (copula) | არის | k?
მუთუნ | pron | ничто; что-нибудь | nothing; anything | — | ?
მითინ | pron | никто; кто-нибудь | nobody; anybody | — | ?
ირფელი | pron | всё | everything | — | ?
ირკოჩი | pron | каждый человек | everyone | — | ?
# numbers
არტი | num | один | one | ერთი |
ჟირი | num | два | two | — |
სუმი | num | три | three | სამი |
ოთხი | num | четыре | four | ოთხი |
ხუთი | num | пять | five | ხუთი |
ამშვი | num | шесть | six | ექვსი |
შქვითი | num | семь | seven | შვიდი |
რუო | num | восемь | eight | რვა |
ჩხორო | num | девять | nine | ცხრა |
ვითი | num | десять | ten | ათი | k?
ვითარტი | num | одиннадцать | eleven | — | ?
ვითოჟირი | num | двенадцать | twelve | — | ?
ეჩი | num | двадцать | twenty | ოცი |
ეჩდოვითი | num | тридцать (20 и 10) | thirty (20 and 10) | ოცდაათი | ? k?
ჟარნეჩი | num | сорок (2 × 20) | forty (2 × 20) | — | ?
ოში | num | сто | hundred | ასი |
ანთასი | num | тысяча | thousand | ათასი | ?
მაჟირა | num | второй | second | მეორე | ?
მასუმა | num | третий | third | მესამე | ? k?
სუმეჩი | num | шестьдесят (3 × 20) | sixty (3 × 20) | სამოცი | ? k?
ოთხოეჩი | num | восемьдесят (4 × 20) | eighty (4 × 20) | ოთხმოცი | ?
# verbs
ჭარუა | v | писать | write | წერა |
ჭკომა | v | есть, кушать | eat | ჭამა |
შუმა | v | пить | drink | სმა |
ულა | v | идти | go | — |
მოულა | v | приходить | come | — | ?
ძირაფა | v | видеть | see | — |
თქუალა | v | сказать, говорить | say | თქმა | ?
ჸოროფა | v | любовь; любить | love | სიყვარული | k?
ღურა | v | умирать; смерть | die; death | — |
ჩინება | v | узнавать, знать | recognise, know | ცნობა | ?
კითხუა | v | читать; спрашивать | read; ask | კითხვა | ?
ბღარა | v | плакать | cry | — | ?
გეხეა | v | сесть | sit down | — | ?
ბირა | v | петь; песня | sing; song | — | ?
ხვამა | v | молиться; молитва | pray; prayer | — | ?
გურაფა | v | учить, учёба | learn, study | — | ?
რაგადი | v | разговор; говорить | talk; to talk | — | ?
ჭოფა | v | брать, взять | take | — | ?
ქიმინუა | v | делать | do, make | — | ?
გოშინაფა | v | вспоминать, память | remember, memory | — | ?
ჭყაფა | v | рвать | tear | — | ? r
ხანდა | v | работа, работать | work | — | ? r
`;const POS={n:{ru:'существительное',en:'noun'},a:{ru:'прилагательное',en:'adjective'},v:{ru:'глагол (масдар)',en:'verb (masdar)'},pron:{ru:'местоимение',en:'pronoun'},q:{ru:'вопросительное слово',en:'question word'},num:{ru:'числительное',en:'numeral'},adv:{ru:'наречие',en:'adverb'},conj:{ru:'союз',en:'conjunction'},part:{ru:'частица',en:'particle'},int:{ru:'междометие',en:'interjection'},phrase:{ru:'выражение',en:'phrase'},form:{ru:'словоформа',en:'word form'},};const GROUPS={family:{ru:'Семья',en:'Family'},people:{ru:'Люди и страна',en:'People and country'},body:{ru:'Тело',en:'Body'},nature:{ru:'Природа',en:'Nature'},time:{ru:'Время',en:'Time'},animals:{ru:'Животные',en:'Animals'},food:{ru:'Еда',en:'Food'},qualities:{ru:'Качества и цвета',en:'Qualities and colours'},pronouns:{ru:'Местоимения',en:'Pronouns'},questions:{ru:'Вопросы',en:'Questions'},particles:{ru:'Союзы и частицы',en:'Conjunctions and particles'},numbers:{ru:'Числа',en:'Numbers'},verbs:{ru:'Глаголы',en:'Verbs'},};const LEXICON=(()=>{const out=[];let group='';for(const raw of LEX.split('\n')){const line=raw.trim();if(!line)continue;if(line.startsWith('#')){group=line.slice(1).trim();continue;}
const[w,pos,ru,en,ka,flags='']=line.split('|').map((s)=>s.trim());const fl=flags.split(/\s+/);out.push({w,pos,ru,en,ka:ka&&ka!=='—'?ka:null,kaSure:!fl.includes('k?'),group,unverified:fl.includes('?'),usage:fl.includes('r')?'rare':'common'});}
return out;})();const BY_WORD=new Map(LEXICON.map((e)=>[e.w,e]));const lexByWord=(w)=>BY_WORD.get(w)||null;const lexStats=()=>({total:LEXICON.length,verified:LEXICON.filter((e)=>!e.unverified).length,cognates:LEXICON.filter((e)=>e.ka).length});const CASES=[{id:'nom',c:'ი',v:'',ru:'именительный',en:'nominative',note:{ru:'подлежащее непереходного глагола и прямое дополнение в аористе; на конце часто -ჷ вместо -ი',en:'subject of an intransitive verb, object in the aorist; often written -ə instead of -i'}},{id:'erg',c:'ქ',v:'ქ',alt:['იქ'],ru:'эргативный (мотхробити) -ქ',en:'ergative (narrative) -k',note:{ru:'подлежащее в серии аориста — в мегрельском у любого глагола, не только у переходного',en:'the subject in the aorist series — in Mingrelian of every verb, not only transitive ones'},unverifiedC:true},{id:'dat',c:'ს',v:'ს',ru:'дательный -ს',en:'dative -s',note:{ru:'косвенное и (в настоящем) прямое дополнение; также «в, на» — место',en:'indirect and (in the present) direct object; also "in, at" — place'}},{id:'gen',c:'იში',v:'ში',alt:['იშ','შ'],ru:'родительный -იში',en:'genitive -iši',note:{ru:'чей; груз. -ის. Часто укорочен до -იშ',en:'whose; Georgian -is. Often shortened to -iš'}},{id:'ins',c:'ით',v:'თ',alt:['ითი','თი'],ru:'творительный -ით',en:'instrumental -it',note:{ru:'чем, с помощью чего; груз. -ით',en:'with what, by means of; Georgian -it'},unverifiedV:true},{id:'adv',c:'ო',v:'ო',alt:['ოთ'],ru:'обстоятельственный -ო(თ)',en:'adverbial -o(t)',note:{ru:'как, в качестве; груз. -ად: ჯგირ-ი «хороший» → ჯგირ-ო «хорошо»',en:'how, as; Georgian -ad: ǯgir-i "good" → ǯgir-o "well"'},unverified:true},{id:'all',c:'იშა',v:'შა',ru:'направительный -იშა',en:'allative -iša',note:{ru:'куда, к кому; в грузинском такого падежа нет (ср. -კენ, -თან)',en:'where to, towards; Georgian has no such case (cf. -ken, -tan)'}},{id:'abl',c:'იშე',v:'შე',ru:'исходный -იშე',en:'ablative -iše',note:{ru:'откуда, от кого; груз. -დან, -გან',en:'where from, from whom; Georgian -dan, -gan'}},{id:'cau',c:'იშენ',v:'შენ',alt:['იშენი','შენი'],ru:'причинный -იშენ',en:'causal -išen',note:{ru:'для, ради, из-за; груз. -ისთვის, -ის გამო. მუშენ «почему» = «для чего»',en:'for, because of; Georgian -istvis, -is gamo. mušen "why" = "for what"'}},];const PLURAL={s:'ეფ',ru:'множественное число -ეფ- (груз. -ებ-: ბ ↔ ფ)',en:'plural -ep- (Georgian -eb-: b ↔ p)'};const VOWELS='აეიოუჷ';const isV=(c)=>VOWELS.includes(c);const nounStem=(w)=>(w.length>2&&/[იჷ]$/.test(w)&&!isV(w.at(-2))?{stem:w.slice(0,-1),vowel:false}:{stem:w,vowel:true});function decline(entry){const w=typeof entry==='string'?entry:entry.w;const{stem,vowel}=nounStem(w);const P=(s,role,gloss)=>({s,role,gloss});const form=(st,extra,c)=>{const end=vowel&&!extra?c.v:c.c;const parts=[P(st,'stem')];if(extra)parts.push(P(extra,'plural',{ru:PLURAL.ru,en:PLURAL.en}));if(end)parts.push(P(end,'case',{ru:c.ru,en:c.en}));const unverified=!!(c.unverified||(!vowel||extra?c.unverifiedC:c.unverifiedV));return{id:c.id,form:st+extra+end,parts,unverified};};const plStem=vowel?stem.replace(/ა$/,''):stem;const sg=CASES.map((c)=>form(stem,'',c));const pl=CASES.map((c)=>({...form(plStem,PLURAL.s,c),unverified:form(plStem,PLURAL.s,c).unverified||vowel}));return{stem,vowel,sg,pl};}
const PREVERBS=[{s:'გინო',ka:'გადა',ru:'через, пере-',en:'across, over',unverified:true},{s:'მე',ka:'მი',ru:'туда, от говорящего',en:'thither, away from the speaker'},{s:'მო',ka:'მო',ru:'сюда, к говорящему',en:'hither, towards the speaker'},{s:'გე',ka:'ჩა / და',ru:'вниз',en:'down'},{s:'გა',ka:'გა',ru:'наружу, вы-',en:'out'},{s:'გო',ka:'შემო',ru:'вокруг, по-',en:'around',unverified:true},{s:'დო',ka:'და',ru:'завершённость (как груз. და-)',en:'completion (like Georgian da-)'},{s:'ე',ka:'ა',ru:'вверх',en:'up'},];const AFFIRMATIVE=['ქო','ქი','ქე','ქუ'];const VERBS=[{id:'write',masdar:'ჭარუა',root:'ჭარ',ts:'უ',pv:'დო',ka:'წერ',ru:'писать',en:'write',present:true},{id:'eat',masdar:'ჭკომა',root:'ჭკომ',ts:'უ',pv:'დო',ka:'ჭამ',ru:'есть',en:'eat',present:true},{id:'drink',masdar:'შუმა',root:'შუმ',ts:'უ',pv:'დო',ka:'სმ',ru:'пить',en:'drink',present:false},{id:'see',masdar:'ძირაფა',root:'ძირ',ts:'უ',pv:'ქო',ka:null,ru:'видеть',en:'see',present:false},{id:'die',masdar:'ღურა',root:'ღურ',ts:'უ',pv:'დო',ka:null,ru:'умирать',en:'die',present:false},];const PERSONS=['1sg','2sg','3sg','1pl','2pl','3pl'];const SERIES1={'1sg':'ქ','2sg':'ქ','3sg':'ს','1pl':'თ','2pl':'თ','3pl':'ა'};const PAST={'1sg':'ი','2sg':'ი','3sg':'უ','1pl':'ით','2pl':'ით','3pl':'ეს'};const ENDING_GLOSS={'ქ':{ru:'окончание 1-го / 2-го лица ед. ч. (настоящее): -ქ',en:'ending of the 1st / 2nd person singular (present): -k'},'ს':{ru:'окончание 3-го лица ед. ч.: -ს (как в грузинском)',en:'ending of the 3rd person singular: -s (as in Georgian)'},'თ':{ru:'множественное число 1-го / 2-го лица: -თ (как в грузинском)',en:'plural of the 1st / 2nd person: -t (as in Georgian)'},'ა':{ru:'3-е лицо мн. ч. (настоящее): -ა (груз. -ენ / -ან)',en:'3rd person plural (present): -a (Georgian -en / -an)'},'ი':{ru:'1-е / 2-е лицо ед. ч. прошедшего: -ი',en:'1st / 2nd person singular of the past: -i'},'უ':{ru:'3-е лицо ед. ч. прошедшего: -უ (груз. -ა / -ო)',en:'3rd person singular of the past: -u (Georgian -a / -o)'},'ით':{ru:'1-е / 2-е лицо мн. ч. прошедшего: -ით',en:'1st / 2nd person plural of the past: -it'},'ეს':{ru:'3-е лицо мн. ч. прошедшего: -ეს (как в грузинском)',en:'3rd person plural of the past: -es (as in Georgian)'},};const G={v:{ru:'префикс субъекта 1-го лица ვ- (как в грузинском)',en:'subject prefix of the 1st person v- (as in Georgian)'},ts:{ru:'тематический суффикс -უ-',en:'thematic suffix -u-'},n:{ru:'показатель серии настоящего -ნ-',en:'marker of the present series -n-'},d:{ru:'показатель имперфекта -დ- (как в грузинском)',en:'imperfect marker -d- (as in Georgian)'},aff:{ru:'утвердительная частица ქ- («ведь, действительно»): в грузинском её нет',en:'affirmative particle k- ("indeed"): Georgian has none'},};const person1=(p)=>p==='1sg'||p==='1pl';function series1(verb,extra,endings,unverified){return PERSONS.map((p)=>{const parts=[];if(person1(p))parts.push({s:'ვ',role:'subj',gloss:G.v});parts.push({s:verb.root,role:'root',gloss:{ru:verb.ru,en:verb.en}},{s:verb.ts,role:'ts',gloss:G.ts},{s:'ნ',role:'screeve',gloss:G.n});if(extra)parts.push({s:extra,role:'screeve',gloss:G.d});parts.push({s:endings[p],role:'ending',gloss:ENDING_GLOSS[endings[p]]||null});return{s:p,form:parts.map((x)=>x.s).join(''),parts,unverified};});}
const IMPF={'1sg':'ი','2sg':'ი','3sg':'უ','1pl':'ით','2pl':'ით','3pl':'ეს'};const present=(verb)=>series1(verb,'',SERIES1,!verb.present);const imperfect=(verb)=>series1(verb,'დ',IMPF,true);function aorist(verb){return PERSONS.map((p)=>{const parts=[{s:verb.pv,role:'preverb',gloss:PREVERBS.find((x)=>x.s===verb.pv)||G.aff}];if(person1(p))parts.push({s:'ვ',role:'subj',gloss:G.v});parts.push({s:verb.root,role:'root',gloss:{ru:verb.ru,en:verb.en}},{s:PAST[p],role:'ending',gloss:ENDING_GLOSS[PAST[p]]});return{s:p,form:parts.map((x)=>x.s).join(''),parts,unverified:true};});}
const SCREEVES=[{id:'present',ru:'настоящее',en:'present',make:present},{id:'imperfect',ru:'имперфект',en:'imperfect',make:imperfect},{id:'aorist',ru:'аорист',en:'aorist',make:aorist},];const X=(w,lemma,ru,en,parts,tags,unverified=false)=>({w,lemma,ru,en,parts,tags,unverified});const EXCEPTIONS=[X('ვორექ','რე','я есть','I am',[['ვ','subj'],['ორე','root'],['ქ','ending']],{s:'1sg'}),X('რექ','რე','ты есть','you are',[['რე','root'],['ქ','ending']],{s:'2sg'}),X('რე','რე','есть, является (груз. არის / -ა)','is (Georgian aris / -a)',[['რე','root']],{s:'3sg'}),X('ვორეთ','რე','мы есть','we are',[['ვ','subj'],['ორე','root'],['თ','ending']],{s:'1pl'}),X('რეთ','რე','вы есть','you (pl.) are',[['რე','root'],['თ','ending']],{s:'2pl'}),X('რენა','რე','они есть','they are',[['რე','root'],['ნა','ending']],{s:'3pl'},true),X('მიჩქუ','ჩქუ','я знаю','I know',[['მ','obj'],['ი','version'],['ჩქ','root'],['უ','ts']],{s:'1sg',inverted:true}),X('გიჩქუ','ჩქუ','ты знаешь','you know',[['გ','obj'],['ი','version'],['ჩქ','root'],['უ','ts']],{s:'2sg',inverted:true}),X('უჩქუ','ჩქუ','он / она знает','he / she knows',[['უ','version'],['ჩქ','root'],['უ','ts']],{s:'3sg',inverted:true}),X('მიჸორს','ჸოროფა','я люблю (его / её)','I love (him / her)',[['მ','obj'],['ი','version'],['ჸორ','root'],['ს','ending']],{s:'1sg',inverted:true},true),X('გიჸორს','ჸოროფა','ты любишь (его / её)','you love (him / her)',[['გ','obj'],['ი','version'],['ჸორ','root'],['ს','ending']],{s:'2sg',inverted:true},true),X('უჸორს','ჸოროფა','он / она любит','he / she loves',[['უ','version'],['ჸორ','root'],['ს','ending']],{s:'3sg',inverted:true},true),X('მიჸორქ','ჸოროფა','я тебя люблю','I love you',[['მ','obj'],['ი','version'],['ჸორ','root'],['ქ','ending']],{s:'1sg',o:'2sg',inverted:true},true),X('მოკო','ოკო','я хочу; мне нужно','I want; I need',[['მ','obj'],['ოკო','root']],{s:'1sg',inverted:true},true),X('გოკო','ოკო','ты хочешь','you want',[['გ','obj'],['ოკო','root']],{s:'2sg',inverted:true},true),].map((e)=>({...e,parts:e.parts.map(([s,role])=>({s,role}))}));const EXC=new Map(EXCEPTIONS.map((e)=>[e.w,e]));const R=(id,ru,en)=>({id,ru,en});const PARSE_RULES={exception:R('exception','неправильная или инвертированная форма из списка исключений','an irregular or inverted form from the exceptions list'),lexicon:R('lexicon','словарная форма','dictionary form'),noun:R('noun','основа + (мн. ч. -ეფ-) + падежное окончание','stem + (plural -ep-) + case ending'),nounGuess:R('noun-guess','похоже на падежную форму, но основы нет в словаре','looks like a case form, but the stem is not in the lexicon'),present:R('verb-present','серия настоящего: (ვ-) корень + -უ- + -ნ- + окончание лица (-ქ, -ს, -თ, -ა)','present series: (v-) root + -u- + -n- + person ending (-k, -s, -t, -a)'),imperfect:R('verb-imperfect','имперфект: (ვ-) корень + -უნ- + -დ- + окончание прошедшего','imperfect: (v-) root + -un- + -d- + past ending'),aorist:R('verb-aorist','аорист: преверб + (ვ-) корень + окончание прошедшего (-ი, -უ, -ით, -ეს)','aorist: preverb + (v-) root + past ending (-i, -u, -it, -es)'),verbGuess:R('verb-guess','похоже на глагол серии настоящего (-უნ- + окончание), корень неизвестен','looks like a present-series verb (-un- + ending), the root is unknown'),};const clean=(w)=>toScript(String(w).trim()).replace(/[.,!?;:«»"“”()—–-]+/g,'');const variants=(w)=>(w.endsWith('ჷ')?[w,w.slice(0,-1)+'ი']:[w]);const nounLike=(e)=>e&&['n','a','pron','num'].includes(e.pos);function nounReadings(w){const out=[];const endings=[];for(const c of CASES){for(const[end,vowelStem,alt]of[[c.c,false,false],[c.v,true,false],...(c.alt||[]).map((a)=>[a,!a.startsWith('ი')&&a!=='ო'&&a!=='ოთ',true])]){if(c.id==='nom'&&end==='')continue;endings.push({c,end,vowelStem,alt});}}
for(const{c,end,vowelStem,alt}of endings){if(!w.endsWith(end)||w.length<=end.length)continue;let base=w.slice(0,w.length-end.length);let plural=false;if(base.endsWith(PLURAL.s)&&base.length>2){plural=true;base=base.slice(0,-2);}
if(plural&&vowelStem)continue;const lemmas=plural?[[base+'ი',false],[base+'ა',true],[base,true]]:vowelStem?[[base,true]]:[[base+'ი',false]];if(!plural&&!vowelStem&&['ქ','ს'].includes(end)&&isV(base.at(-1)||''))lemmas.push([base,true]);for(const[lemma,vStem]of lemmas){const e=lexByWord(lemma);if(e&&nounStem(e.w).vowel!==vStem)continue;if(c.id==='nom'&&!plural&&lemma===w&&e)continue;const parts=[{s:base,role:'stem',gloss:e?{ru:e.ru,en:e.en}:null}];if(plural)parts.push({s:PLURAL.s,role:'plural',gloss:{ru:PLURAL.ru,en:PLURAL.en}});parts.push({s:end,role:'case',gloss:{ru:c.ru,en:c.en}});if(parts.map((p)=>p.s).join('')!==w)continue;const known=nounLike(e);const unv=!!(c.unverified||alt||(c.id==='erg'&&(!vStem||plural))||(plural&&vStem));out.push({lemma,pos:known?e.pos:'n',gloss:known?{ru:e.ru,en:e.en}:null,ka:known?e.ka:null,parts,tags:{case:c.id,number:plural?'pl':'sg'},rule:known?PARSE_RULES.noun:PARSE_RULES.nounGuess,score:(known?0.9:0.25+end.length*0.01)-(unv?0.1:0)-(alt?0.05:0),unverified:unv||!!(known&&e.unverified),entry:known?e:null,});}}
return out;}
function prefixes(w){const out=[{rest:w,parts:[]}];for(const a of AFFIRMATIVE)if(w.startsWith(a))out.push({rest:w.slice(a.length),parts:[{s:a,role:'aff',gloss:G.aff}]});for(const o of[...out]){for(const p of PREVERBS)if(o.rest.startsWith(p.s)&&o.rest.length>p.s.length+1)out.push({rest:o.rest.slice(p.s.length),parts:[...o.parts,{s:p.s,role:'preverb',gloss:{ru:`${p.ru} (груз. ${p.ka}-)`,en:`${p.en} (Georgian ${p.ka}-)`}}]});}
return out;}
function verbReadings(w){const out=[];for(const pre of prefixes(w)){for(const first of[false,true]){let rest=pre.rest;if(first){if(!rest.startsWith('ვ'))continue;rest=rest.slice(1);}
const head=[...pre.parts,...(first?[{s:'ვ',role:'subj',gloss:G.v}]:[])];for(const v of VERBS){const tries=[['present',v.root+v.ts+'ნ',SERIES1,PARSE_RULES.present,[[v.ts,'ts',G.ts],['ნ','screeve',G.n]]],['imperfect',v.root+v.ts+'ნდ',IMPF,PARSE_RULES.imperfect,[[v.ts,'ts',G.ts],['ნ','screeve',G.n],['დ','screeve',G.d]]],['aorist',v.root,PAST,PARSE_RULES.aorist,[]],];for(const[screeve,stem,table,rule,mids]of tries){if(!rest.startsWith(stem))continue;const end=rest.slice(stem.length);const persons=PERSONS.filter((p)=>table[p]===end&&person1(p)===first);if(!persons.length)continue;if(screeve==='aorist'&&!pre.parts.some((p)=>p.role==='preverb'))continue;if(screeve!=='aorist'&&end==='')continue;const parts=[...head,{s:v.root,role:'root',gloss:{ru:v.ru,en:v.en}},...mids.map(([s,role,gloss])=>({s,role,gloss})),{s:end,role:'ending',gloss:ENDING_GLOSS[end]||null}];const unv=screeve!=='present'||!v.present;out.push({lemma:v.masdar,pos:'v',gloss:{ru:v.ru,en:v.en},ka:v.ka,parts,tags:{screeve,s:persons.join('/'),preverb:pre.parts.find((p)=>p.role==='preverb')?.s||null,aff:pre.parts.some((p)=>p.role==='aff')},rule,score:(unv?0.7:0.88)-pre.parts.length*0.03,unverified:unv,entry:lexByWord(v.masdar),});}}}}
const m=/^(ვ?)(.{2,}?)(უ)(ნ)(ქ|ს|თ|ა)$/.exec(w);if(m&&!out.length){const[,v1,root,ts,n,end]=m;const persons=PERSONS.filter((p)=>SERIES1[p]===end&&person1(p)===!!v1);if(persons.length){out.push({lemma:root+'უა',pos:'v',gloss:null,ka:null,parts:[...(v1?[{s:v1,role:'subj',gloss:G.v}]:[]),{s:root,role:'root',gloss:null},{s:ts,role:'ts',gloss:G.ts},{s:n,role:'screeve',gloss:G.n},{s:end,role:'ending',gloss:ENDING_GLOSS[end]}],tags:{screeve:'present',s:persons.join('/')},rule:PARSE_RULES.verbGuess,score:0.3,unverified:true,entry:null,});}}
return out;}
function parse(word){const w0=clean(word);if(!w0)return[];const out=[];for(const w of variants(w0)){const ex=EXC.get(w);if(ex)out.push({lemma:ex.lemma,pos:'form',gloss:{ru:ex.ru,en:ex.en},ka:null,parts:ex.parts,tags:ex.tags,rule:PARSE_RULES.exception,score:1,unverified:ex.unverified,entry:lexByWord(ex.lemma)});const e=lexByWord(w);if(e)out.push({lemma:e.w,pos:e.pos,gloss:{ru:e.ru,en:e.en},ka:e.ka,parts:[{s:w,role:e.pos==='v'?'root':'stem',gloss:{ru:e.ru,en:e.en}}],tags:e.pos==='v'?{masdar:true}:nounLike(e)?{case:'nom',number:'sg'}:{},rule:PARSE_RULES.lexicon,score:0.97,unverified:e.unverified,entry:e});out.push(...nounReadings(w),...verbReadings(w));}
const seen=new Set();const sure=out.some((r)=>r.score>=0.6);return out.map((r)=>({...r,score:Math.round(r.score*100)/100})).filter((r)=>!sure||r.score>=0.4).sort((a,b)=>b.score-a.score).filter((r)=>{const k=r.parts.map((p)=>p.s+':'+p.role).join('|')+r.lemma;if(seen.has(k))return false;seen.add(k);return true;});}
const RL=(id,ka,xmf,cost,ru,en,ex,where='any')=>({id,ka,xmf,cost,ru,en,ex,where,sporadic:cost>1});const RULES=[RL('a-o','ა','ო',1,'груз. а ↔ мегр. о','Georgian a ↔ Mingrelian o',[['კაცი','კოჩი'],['ქათამი','ქოთომი'],['ასი','ოში'],['და','დო']]),RL('e-a','ე','ა',1,'груз. э ↔ мегр. а','Georgian e ↔ Mingrelian a',[['მე','მა'],['დღე','დღა'],['ყველი','ქვალი'],['თქვენი','თქვანი']]),RL('s-sh','ს','შ',1,'свистящий ↔ шипящий: с ↔ ш','sibilant ↔ hushing: s ↔ sh',[['ასი','ოში'],['სმა','შუმა']]),RL('z-zh','ზ','ჟ',1,'свистящий ↔ шипящий: з ↔ ж','sibilant ↔ hushing: z ↔ zh',[['მზე','ბჟა']]),RL('c-ch','ც','ჩ',1,'свистящий ↔ шипящий: ц ↔ ч','sibilant ↔ hushing: ts ↔ ch',[['კაცი','კოჩი'],['ცხრა','ჩხორო'],['ოცი','ეჩი']]),RL('dz-j','ძ','ჯ',1,'свистящий ↔ шипящий: дз ↔ дж','sibilant ↔ hushing: dz ↔ j',[['ძმა','ჯიმა'],['ძაღლი','ჯოღორი'],['ძველი','ჯვეში']]),RL('ts-ch','წ','ჭ',1,'свистящий ↔ шипящий: ц’ ↔ ч’',"sibilant ↔ hushing: ts' ↔ ch'",[['წერა','ჭარუა'],['წითელი','ჭითა'],['წვიმა','ჭვიმა']]),RL('l-r','ლ','რ',1,'груз. л ↔ мегр. р','Georgian l ↔ Mingrelian r',[['გული','გური'],['კბილი','კიბირი'],['მგელი','მგერი'],['წყალი','წყარი']]),RL('q-glottal','ყ','ჸ',1,'груз. къ (ყ) ↔ мегр. гортанная смычка ჸ',"Georgian q' ↔ Mingrelian glottal stop ʔ",[['ყური','ჸუჯი'],['ყანა','ჸონა']]),RL('q-k','ყ','ქ',2,'груз. ყ ↔ мегр. ქ (в отдельных словах)',"Georgian q' ↔ Mingrelian k (a few words)",[['ყველი','ქვალი']]),RL('r-j','რ','ჯ',2,'груз. р ↔ мегр. дж (в отдельных словах)','Georgian r ↔ Mingrelian j (a few words)',[['ყური','ჸუჯი'],['პირი','პიჯი'],['ხარი','ხოჯი']]),RL('va-o','ვა','ო',2,'груз. ва ↔ мегр. о','Georgian va ↔ Mingrelian o',[['თვალი','თოლი']]),RL('v-u','ვ','უ',2,'груз. в ↔ мегр. у','Georgian v ↔ Mingrelian u',[['რვა','რუო']]),RL('m-b','მ','ბ',2,'груз. м ↔ мегр. б перед з / ж','Georgian m ↔ Mingrelian b before z / zh',[['მზე','ბჟა']],'before-z'),RL('o-i','ო','ი',2,'конечное о ↔ и','final o ↔ i',[['ღვინო','ღვინი']],'final'),];const EPENTHESIS={id:'epenthesis',cost:2,vowels:['ი','ო','უ'],ru:'вставной гласный разбивает группу согласных',en:'an inserted vowel breaks a consonant cluster',ex:[['კბილი','კიბირი'],['თმა','თომა'],['ძმა','ჯიმა'],['ცხრა','ჩხორო']]};const ruleById=(id)=>(id===EPENTHESIS.id?EPENTHESIS:RULES.find((r)=>r.id===id)||null);const isC=(c)=>!!c&&/[ა-ჰჸ]/.test(c)&&!isV(c);function generate(word,dir,{maxCost=6,beam=400}={}){const fwd=dir==='ka>xmf';const rules=RULES.map((r)=>({...r,from:fwd?r.ka:r.xmf,to:fwd?r.xmf:r.ka}));let states=[{i:0,out:'',cost:0,used:[],ep:false}];const done=[];for(let guard=0;states.length&&guard<word.length*3+6;guard++){const next=[];for(const st of states){if(st.i>=word.length){done.push(st);continue;}
const ch=word[st.i];next.push({i:st.i+1,out:st.out+ch,cost:st.cost,used:st.used,ep:false});for(const r of rules){if(!word.startsWith(r.from,st.i))continue;if(r.where==='final'&&st.i+r.from.length!==word.length)continue;if(r.where==='before-z'&&!'ზჟ'.includes(word[st.i+r.from.length]||''))continue;if(st.cost+r.cost>maxCost)continue;next.push({i:st.i+r.from.length,out:st.out+r.to,cost:st.cost+r.cost,used:[...st.used,r.id],ep:false});}
if(st.cost+EPENTHESIS.cost<=maxCost&&!st.ep){if(fwd&&isC(st.out.at(-1))&&isC(ch))for(const v of EPENTHESIS.vowels)next.push({i:st.i,out:st.out+v,cost:st.cost+EPENTHESIS.cost,used:[...st.used,EPENTHESIS.id],ep:true});if(!fwd&&EPENTHESIS.vowels.includes(ch)&&isC(st.out.at(-1))&&isC(word[st.i+1]))next.push({i:st.i+1,out:st.out,cost:st.cost+EPENTHESIS.cost,used:[...st.used,EPENTHESIS.id],ep:true});}}
next.sort((a,b)=>a.cost-b.cost);states=next.slice(0,beam);}
const best=new Map();for(const d of done.sort((a,b)=>a.cost-b.cost))if(!best.has(d.out))best.set(d.out,d);return[...best.values()];}
const scoreOf=(c)=>(c.attested?2:0)+(c.known?1:0)+1/(1+c.cost);function ranked(list,limit){return list.sort((a,b)=>scoreOf(b)-scoreOf(a)||a.cost-b.cost).slice(0,limit).map((c)=>({...c,score:Math.round(scoreOf(c)*100)/100}));}
function toMegruli(kaWord,{known=null,limit=10,maxCost=6}={}){const ka=String(kaWord).trim();if(!ka)return[];const attested=new Set(LEXICON.filter((e)=>e.ka===ka).map((e)=>e.w));const list=generate(ka,'ka>xmf',{maxCost}).filter((d)=>d.cost>0||lexByWord(d.out)).map((d)=>({form:d.out,rules:d.used,cost:d.cost,attested:attested.has(d.out),known:!!lexByWord(d.out)||!!(known&&known(d.out))}));for(const w of attested)if(!list.some((c)=>c.form===w))list.push({form:w,rules:[],cost:9,attested:true,known:true,irregular:true});return ranked(list,limit);}
function toGeorgian(xmfWord,{known=null,limit=10,maxCost=6}={}){const w=String(xmfWord).trim();if(!w)return[];const e=lexByWord(w);const att=e&&e.ka?e.ka:null;const list=generate(w,'xmf>ka',{maxCost}).filter((d)=>d.cost>0||d.out===att||(known&&known(d.out))).map((d)=>({form:d.out,rules:d.used,cost:d.cost,attested:d.out===att,known:!!(known&&known(d.out))}));if(att&&!list.some((c)=>c.form===att))list.push({form:att,rules:[],cost:9,attested:true,known:true,irregular:true});return ranked(list,limit);}
const lev=(a,b)=>{const d=Array.from({length:a.length+1},(_,i)=>[i,...Array(b.length).fill(0)]);for(let j=1;j<=b.length;j++)d[0][j]=j;for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[a.length][b.length];};function explainPair(xmf,ka){const all=generate(ka,'ka>xmf',{maxCost:10,beam:3000});const hit=all.find((d)=>d.out===xmf);if(hit)return{reached:true,rules:hit.used,rest:0,via:hit.out};let best=null;for(const d of all){const r=lev(d.out,xmf);if(!best||r<best.rest||(r===best.rest&&d.cost<best.cost))best={rest:r,rules:d.used,via:d.out,cost:d.cost};}
return{reached:false,rules:best?best.rules:[],rest:best?best.rest:lev(ka,xmf),via:best?best.via:ka};}
export{translit,ALPHABET,ruleById,explainPair,GROUPS,LEXICON,decline,CASES,VERBS,RULES,EPENTHESIS,lexStats,NOT_USED,present,imperfect,aorist,PREVERBS,EXCEPTIONS,fromLatin,SCREEVES,POS,toScript,parse,lexByWord,toGeorgian,toMegruli};