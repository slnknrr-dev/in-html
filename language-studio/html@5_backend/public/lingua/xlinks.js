const KINDS={cognate:{ru:'родственные (общий предок)',en:'cognates (common ancestor)'},loan:{ru:'заимствование',en:'loanword'},calque:{ru:'калька (перевод по частям)',en:'calque (translated part by part)'},sino:{ru:'китайское слово в трёх языках',en:'one Chinese word in three languages'},kartvelian:{ru:'картвельские родственные',en:'Kartvelian cognates'},false:{ru:'ложные друзья',en:'false friends'},};const LANG_NAMES={ru:{ru:'русский',en:'Russian'},en:{ru:'английский',en:'English'},ka:{ru:'грузинский',en:'Georgian'},xmf:{ru:'мегрельский',en:'Mingrelian'},sa:{ru:'санскрит',en:'Sanskrit'},ja:{ru:'японский',en:'Japanese'},zh:{ru:'китайский',en:'Chinese'},ko:{ru:'корейский',en:'Korean'},la:{ru:'латынь',en:'Latin'},grc:{ru:'древнегреческий',en:'Ancient Greek'},de:{ru:'немецкий',en:'German'},fr:{ru:'французский',en:'French'},fa:{ru:'персидский',en:'Persian'},ar:{ru:'арабский',en:'Arabic'},};const DATA=`
cognate | ru=брат; en=brother; sa=bhrātṛ | Праиндоевропейское *bʰréh₂tēr. Грузинское ძმა «брат» не родственно: картвельские языки — другая семья. | Proto-Indo-European *bʰréh₂tēr. Georgian ძმა "brother" is unrelated: the Kartvelian languages are another family.
cognate | ru=мать[мат]; en=mother; sa=mātṛ | *méh₂tēr. Русское «мать» потеряло -р- в именительном, но сохранило в косвенных: матери. | *méh₂tēr. Russian мать lost the -r- in the nominative but keeps it elsewhere: матери.
cognate | ru=дочь; en=daughter; sa=duhitṛ | *dʰugh₂tḗr. Русское «дочери» сохраняет -р-, как «матери». | *dʰugh₂tḗr. Russian дочери keeps the -r-, like матери.
cognate | ru=сын; en=son; sa=sūnu | *suHnús «рождённый». | *suHnús "the one born".
cognate | ru=сестра; en=sister; sa=svasṛ | *swésōr; -т- в русском и английском вставлено позже. | *swésōr; the -t- of Russian and English was inserted later.
cognate | ru=вдова; en=widow; sa=vidhavā | *h₁widʰéwh₂ «лишённая, отделённая». | *h₁widʰéwh₂ "the separated one".
cognate | ru=два; en=two; sa=dva | *dwóh₁. Ср. также «двойной» — double через латынь duplus. | *dwóh₁. Compare double, via Latin duplus.
cognate | ru=три; en=three; sa=tri | *tréyes. | *tréyes.
cognate | ru=десять; en=ten; sa=daśa | *déḱm̥t. Английское ten прошло германский переход k → h и выпадение. | *déḱm̥t. English ten went through the Germanic shift k → h and lost it.
cognate | ru=сто; en=hundred; sa=śata | *ḱm̥tóm. В английском hund- — германское отражение того же корня. | *ḱm̥tóm. The hund- of hundred is the Germanic reflex of the same root.
cognate | ru=новый[нов]; en=new; sa=nava | *néwos. | *néwos.
cognate | ru=ночь; en=night; sa=nakt | *nókʷts. | *nókʷts.
cognate | ru=имя; en=name; sa=nāman | *h₁nómn̥. | *h₁nómn̥.
cognate | ru=знать[зна]; en=know; sa=jñā | *ǵneh₃- «знать»; ср. также «знак», англ. cognition (через латынь). | *ǵneh₃- "to know"; compare знак "sign" and, through Latin, cognition.
cognate | ru=есть; en=is; sa=asti | *h₁ésti «есть, существует». | *h₁ésti "is, exists".
cognate | ru=стоять[сто]; en=stand; sa=sthā | *steh₂- «стоять». | *steh₂- "to stand".
cognate | ru=дать[да]; en=donate; sa=dā | *deh₃- «давать»; в английском — только через латынь (donate, data). Исконное give — другой корень. | *deh₃- "to give"; English has it only through Latin (donate, data); native give is another root.
cognate | ru=волк; en=wolf; sa=vṛka | *wĺ̥kʷos. | *wĺ̥kʷos.
cognate | ru=мышь; en=mouse; sa=mūṣ | *muHs. Ср. muscle «мышонок» (лат. musculus) и русское «мышца». | *muHs. Compare muscle "little mouse" (Latin musculus) and Russian мышца.
cognate | ru=нос; en=nose; sa=nas | *néh₂s. | *néh₂s.
cognate | ru=бровь; en=brow; sa=bhrū | *h₃bʰrúHs. | *h₃bʰrúHs.
cognate | ru=сердце[серд]; en=heart; sa=hṛd | *ḱḗr. Ср. cordial (через латынь cor). | *ḱḗr. Compare cordial (Latin cor).
cognate | ru=око; en=eye; sa=akṣi | *h₃ekʷ-. В русском осталось в «очки», «окно» (ср. англ. window — «ветер-глаз»). | *h₃ekʷ-. Russian keeps it in очки "glasses" and окно "window" (compare English window, "wind-eye").
cognate | ru=огонь; en=ignite; sa=agni | *h₁n̥gʷnis. Английское fire — другой корень; ignite — через латынь ignis. | *h₁n̥gʷnis. English fire is another root; ignite comes from Latin ignis.
cognate | ru=иго; en=yoke; sa=yuga | *yugóm; отсюда же йога (yoga «запряжение»). | *yugóm; also yoga, "yoking".
cognate | ru=дом; en=timber; sa=dama; la=domus | *dem- «строить». Английское timber — германское отражение того же корня. | *dem- "to build". English timber is the Germanic reflex of the same root.
cognate | ru=смех[сме]; en=smile; sa=smayate | *smey- «улыбаться». | *smey- "to smile".
cognate | ru=руда, рыжий; en=red; sa=rudhira | *h₁rewdʰ- «красный»; русское «руда» — исходно «кровь», затем «рыжая (железная) руда». «Красный» — другой корень (краса). | *h₁rewdʰ- "red"; Russian руда first meant "blood", then "red (iron) ore". Russian красный is another root (краса "beauty").
loan | ka=თამადა; ru=тамада | Русское «тамада» — из грузинского თამადა «глава застолья». | Russian тамада is Georgian თამადა, "the head of a feast".
loan | ka=ხაჭაპური; ru=хачапури; en=khachapuri | ხაჭო «творог» + პური «хлеб». Попало в русский и английский вместе с блюдом. | ხაჭო "curd" + პური "bread". Russian and English took it with the dish.
loan | ka=საცივი; ru=сациви | სა-ცივ-ი: «то, что для холодного» (ცივი «холодный») — блюдо подают холодным. | სა-ცივ-ი "the thing for the cold" (ცივი "cold"): the dish is served cold.
loan | ka=ქინძი; ru=кинза | Русское «кинза» — из грузинского ქინძი «кориандр». | Russian кинза comes from Georgian ქინძი "coriander".
loan | ka=ტყემალი; ru=ткемали | Слива и соус из неё. | The plum and its sauce.
loan | ka=ჩურჩხელა; ru=чурчхела | Орехи в загущённом виноградном соке. | Nuts in thickened grape juice.
loan | ka=გენაცვალე; ru=генацвале | В русском — шутливое обращение к грузину; в грузинском — «да стану я тебе заменой». | In Russian a joking way to address a Georgian; in Georgian "may I take your place".
loan | en=Vauxhall; ru=вокзал; ka=ვაგზალი | Сады Воксхолл в Лондоне (с концертным залом) → «воксал» в Павловске при железной дороге → «вокзал»; из русского — разговорное грузинское ვაგზალი (книжное — სადგური). | Vauxhall Gardens in London (with a music hall) → the "vauxhall" at Pavlovsk station → вокзал "station"; from Russian the colloquial Georgian ვაგზალი (the standard word is სადგური).
loan | ka=დუქანი; ru=духан; ar=dukkān | Арабское dukkān «лавка» пришло в грузинский и (через тюркские языки) в русское «духан» — кавказский трактир. | Arabic dukkān "shop" reached Georgian and, through Turkic, Russian духан, a Caucasian tavern.
loan | ka=ფანჯარა; fa=panjara | Персидское panjara «решётка, окно». | Persian panjara "lattice, window".
loan | ka=ტელეფონი; ru=телефон; en=telephone; grc=tēle + phōnē | Интернационализм из греческих частей: «далеко» + «голос». | An internationalism of Greek parts: "far" + "voice".
loan | ka=უნივერსიტეტი; ru=университет; en=university; la=universitas | Латинское universitas «совокупность, корпорация» (магистров и школяров). | Latin universitas "the whole, a guild" (of masters and students).
loan | ka=დემოკრატია; ru=демократия; en=democracy; grc=dēmos + kratos | «Народ» + «власть». | "People" + "power".
loan | ka=ფილოსოფია; ru=философия; en=philosophy; grc=philos + sophia | «Любовь к мудрости». В грузинский пришло ещё из греческого, раньше, чем через русский. | "Love of wisdom". Georgian took it from Greek long before Russian contacts.
loan | en=sputnik; ru=спутник[пут] | с-пут-ник «попутчик»: тот, кто идёт тем же путём. В английском с 1957 года. | с-пут-ник "fellow traveller": one on the same path. In English since 1957.
loan | en=tsar; ru=царь; la=Caesar | Латинское Caesar → готск. kaisar → слав. цѣсарь → «царь»; обратно в английский — tsar. | Latin Caesar → Gothic kaisar → Slavic цѣсарь → царь, and back into English as tsar.
loan | en=mammoth; ru=мамонт | Из русского (вероятно, из уральских языков). | From Russian (probably from a Uralic language).
loan | ru=шампунь; en=shampoo | Хинди chāmpo «мни!»; в русский — через английский. | Hindi chāmpo "knead!"; Russian took it through English.
loan | ru=джунгли; en=jungle; sa=jāṅgala | Санскр. jāṅgala «сухая, необработанная земля» → хинди jangal → англ. jungle → рус. «джунгли». Значение перевернулось: из сухой степи в густой лес. | Sanskrit jāṅgala "dry, wild land" → Hindi jangal → English jungle → Russian джунгли. The sense flipped from dry scrub to dense forest.
loan | ru=аватар; en=avatar; sa=avatāra | ava- «вниз» + tṛ «переходить»: «нисхождение» (бога в мир). | ava- "down" + tṛ "cross": the "descent" (of a god into the world).
loan | ru=карма; en=karma; sa=karman | karman «действие» (корень kṛ «делать», тот же, что в saṃskṛta). | karman "action" (root kṛ "to do", as in saṃskṛta).
calque | en=skyscraper; ru=небоскрёб[скреб]; ka=ცათამბჯენი | Английское «скребущий небо» → русское «небоскрёб»; грузинское ცათა-მბჯენი — «подпирающий небеса» (ცათა — старый родительный мн. ч.). | English "sky-scraper" → Russian небо-скрёб; Georgian ცათა-მბჯენი is "the one propping the heavens" (ცათა is an old genitive plural).
calque | en=independence[pend]; ru=независимость[вис]; ka=დამოუკიდებლობა[კიდ] | Во всех трёх — «не висеть на ком-то»: лат. pendere «висеть», рус. «висеть», груз. კიდება «вешать» (და-მო-უ-კიდ-ებ-ელ-ი «не подвешенный»). | In all three, "not hanging from": Latin pendere "hang", Russian висеть, Georgian კიდება "to hang" (და-მო-უ-კიდ-ებ-ელ-ი "not hung onto").
calque | en=worldview; de=Weltanschauung; ru=мировоззрение[зр]; ka=მსოფლმხედველობა[ხედ] | Немецкое Welt-anschauung «мир-воззрение» переведено по частям: рус. мир-о-воз-зр-ени-е, груз. მ-სოფლ-მ-ხედ-ველ-ობა (სოფელი в старом языке — «мир»). | German Welt-anschauung "world-viewing" translated part by part: Russian мир-о-воз-зр-ени-е, Georgian მ-სოფლ-მ-ხედ-ველ-ობა (სოფელი meant "world" in Old Georgian).
calque | en=railway; de=Eisenbahn; ru=железная дорога; ka=რკინიგზა | «Железная дорога» по образцу нем. Eisenbahn и фр. chemin de fer; грузинское რკინ-ი-გზა — «железо» + «дорога» одним словом. | Russian "iron road" follows German Eisenbahn and French chemin de fer; Georgian რკინ-ი-გზა is "iron" + "road" in one word.
calque | en=peninsula; la=paeninsula; de=Halbinsel; ru=полуостров[остров]; ka=ნახევარკუნძული[კუნძულ] | Лат. paene insula «почти остров» → нем. Halb-insel «пол-остров» → рус. «полуостров» → груз. ნახევარ-კუნძული. | Latin paene insula "almost an island" → German Halb-insel "half-island" → Russian полу-остров → Georgian ნახევარ-კუნძული.
calque | en=hydrogen; ru=водород[род]; ka=წყალბადი | Греч. hydro-gen «рождающий воду» → рус. «водо-род», груз. წყალ-ბად-ი (ბადება «рождать»). | Greek hydro-gen "water-begetter" → Russian водо-род, Georgian წყალ-ბად-ი (ბადება "to give birth").
calque | en=oxygen; ru=кислород[род]; ka=ჟანგბადი | Греч. oxy-gen «рождающий кислоту» → рус. «кисло-род»; груз. ჟანგ-ბად-ი — «рождающий ржавчину» (ჟანგი «ржавчина»): тот же приём, свой образ. | Greek oxy-gen "acid-begetter" → Russian кисло-род; Georgian ჟანგ-ბად-ი is "rust-begetter" (ჟანგი "rust"): the same device, its own image.
calque | en=influence[flu]; la=influentia; ru=влияние[ли] | Лат. in-fluentia «втекание» → рус. в-ли-я-ни-е (лить). | Latin in-fluentia "flowing in" → Russian в-ли-я-ни-е (лить "to pour").
calque | en=impression[press]; ru=впечатление[печат] | Лат. im-pressio «вдавливание» → рус. в-печат-ле-ни-е (печать — оттиск). | Latin im-pressio "pressing in" → Russian в-печат-ле-ни-е (печать "a stamp").
calque | en=object[ject]; la=objectum; ru=предмет[мет] | Лат. ob-jectum «брошенное перед» → рус. пред-мет (метать). | Latin ob-jectum "thrown before" → Russian пред-мет (метать "to throw").
calque | en=insect[sect]; la=insectum; ru=насекомое[сек] | Лат. in-sectum (греч. en-tomon) «насечённое» — по перетяжкам тела → рус. на-сек-ом-ое. | Latin in-sectum (Greek en-tomon) "cut into", from the notched body → Russian на-сек-ом-ое.
calque | en=conscience[sci]; la=conscientia; ru=совесть[вес], сознание[зна] | Греч. syn-eidēsis и лат. con-scientia «со-знание» дали два русских слова: церковнославянское «со-вѣсть» (вѣдѣти «знать») и новое «со-зна-ние». | Greek syn-eidēsis and Latin con-scientia "knowing-with" gave two Russian words: Church Slavonic со-вѣсть (вѣдѣти "to know") and the newer со-зна-ние.
calque | en=goodbye; ru=до свидания; ka=ნახვამდის | Грузинское ნახვ-ამდის «до-видения» — калька русского «до свидания» (ср. нем. auf Wiedersehen). Английское goodbye — другое: «God be with ye». | Georgian ნახვ-ამდის "until the seeing" is a calque of Russian до свидания (compare German auf Wiedersehen). English goodbye is different: "God be with ye".
calque | en=signature; ru=подпись[пис]; ka=ხელმოწერა[წერ] | Лат. sub-scriptio «под-писание» → рус. «под-пись»; груз. ხელ-მო-წერ-ა — «рукоприкладство»: подпись как «рука, приписанная» к тексту. | Latin sub-scriptio "under-writing" → Russian под-пись; Georgian ხელ-მო-წერ-ა "hand-writing-on": a signature as a hand added to the text.
calque | en=keep silent; ru=набрать в рот воды; ka=პირში წყალი ჩაიგუბა | Один образ в двух языках: «набрал в рот воды» и груз. «воду в рот запрудил». Кто у кого взял — не установлено. | The same image in two languages: "to take water into one's mouth"; who took it from whom is not established.
sino | zh=学校; ja=学校 (がっこう); ko=학교 (學校) | «Учиться» + «школа». Корейские слова ханмун пишутся хангылем, но восходят к тем же иероглифам. | "Study" + "school". Sino-Korean words are written in Hangul but go back to the same characters.
sino | zh=经济; ja=経済 (けいざい); ko=경제 (經濟) | 經世濟民 «управлять миром, спасать народ» — японцы эпохи Мэйдзи взяли это сокращение для «экономики», и оно вернулось в китайский. | 經世濟民 "order the world, relieve the people": Meiji Japan used the abbreviation for "economy", and it returned to Chinese.
sino | zh=社会; ja=社会 (しゃかい); ko=사회 (社會) | «Община» + «собрание» — японская калька society эпохи Мэйдзи. | "Shrine community" + "meeting": a Meiji Japanese calque of "society".
sino | zh=文化; ja=文化 (ぶんか); ko=문화 (文化) | «Письменность, узор» + «преображать»: «преображение письменностью» — ныне «культура». | "Writing, pattern" + "transform": "transformation by letters", now "culture".
sino | zh=自由; ja=自由 (じゆう); ko=자유 (自由) | «Сам» + «по причине»: «по своей воле». | "Self" + "from": "by one's own cause".
sino | zh=图书馆; ja=図書館 (としょかん); ko=도서관 (圖書館) | «Карта, рисунок» + «книга» + «здание». Три написания одних иероглифов: упрощённое, японское синдзитай и традиционное. | "Chart" + "book" + "hall". Three spellings of the same characters: simplified, Japanese shinjitai and traditional.
sino | zh=世界; ja=世界 (せかい); ko=세계 (世界) | Буддийский термин: «поколение (время)» + «граница (пространство)». | A Buddhist term: "generation (time)" + "boundary (space)".
sino | zh=历史; ja=歴史 (れきし); ko=역사 (歷史) | «Пройденное» + «летопись». | "Passed through" + "chronicle".
sino | zh=哲学; ja=哲学 (てつがく); ko=철학 (哲學) | Японский неологизм Ниси Аманэ (1874) для «философии»: «мудрость» + «учение». | Nishi Amane's coinage (1874) for "philosophy": "wisdom" + "learning".
sino | zh=科学; ja=科学 (かがく); ko=과학 (科學) | «Разряд, отрасль» + «учение»: «знание по отраслям». | "Branch" + "learning": knowledge divided into fields.
sino | zh=时间; ja=時間 (じかん); ko=시간 (時間) | «Время» + «промежуток». | "Time" + "interval".
sino | zh=电话; ja=電話 (でんわ); ko=전화 (電話) | «Молния, электричество» + «речь»: калька telephone по смыслу, не по звуку. | "Lightning, electricity" + "speech": a calque of telephone by sense, not by sound.
kartvelian | ka=დედა; xmf=დიდა | Грузинское е ↔ мегрельское и. | Georgian e ↔ Mingrelian i.
kartvelian | ka=მამა; xmf=მუმა | Грузинское а ↔ мегрельское у в этом слове. | Georgian a ↔ Mingrelian u in this word.
kartvelian | ka=ყური; xmf=ჸუჯი | ყ ↔ ჸ (гортанная смычка), р ↔ дж. | ყ ↔ ჸ (glottal stop), r ↔ j.
kartvelian | ka=წყალი; xmf=წყარი | л ↔ р: «вода». | l ↔ r: "water".
kartvelian | ka=გული; xmf=გური | л ↔ р: «сердце». | l ↔ r: "heart".
kartvelian | ka=თვალი; xmf=თოლი | «глаз». | "eye".
kartvelian | ka=ძაღლი; xmf=ჯოღორი | «собака»: дз ↔ дж, а ↔ о. | "dog": dz ↔ j, a ↔ o.
false | ka=მამა; ru=мама | Грузинское მამა — «отец», а «мать» — დედა. Русское «мама» звучит как грузинское «папа». | Georgian მამა is "father"; "mother" is დედა. Russian мама sounds like the Georgian for "dad".
false | ka=ბაბუა; ru=баба, бабушка | ბაბუა — «дедушка»; «бабушка» — ბებია. | ბაბუა is "grandfather"; "grandmother" is ბებია.
false | ru=магазин; en=magazine; ar=makhāzin | Одно арабское makhāzin «склады»: в русском (через французский) — «лавка», в английском — «журнал» (склад статей) и «магазин» оружия. | One Arabic makhāzin "storehouses": Russian (via French) "shop", English "a periodical" (a store of articles) and an ammunition magazine.
false | ru=фамилия; en=family | Лат. familia «домочадцы»: русское — «фамилия, родовое имя», английское — «семья». | Latin familia "household": Russian "surname", English "family".
false | ru=аккуратный; en=accurate | Лат. accuratus «тщательный»: русское — «опрятный, бережный», английское — «точный». | Latin accuratus "careful": Russian "neat, tidy", English "precise".
false | ru=декада; en=decade | Греч. dekas «десяток»: русская декада — 10 дней, английская decade — 10 лет. | Greek dekas "a set of ten": a Russian декада is ten days, an English decade ten years.
false | ru=симпатичный; en=sympathetic | Греч. sympatheia «со-чувствие»: русское — «привлекательный», английское — «сочувствующий». | Greek sympatheia "co-feeling": Russian "nice-looking", English "compassionate".
false | ru=артист; en=artist | Русский артист — исполнитель (актёр, музыкант); английский artist — прежде всего художник. | A Russian артист is a performer; an English artist is first of all a painter.
false | ja=手紙 (てがみ); zh=手纸 | Японское «письмо», китайское «туалетная бумага» — одни иероглифы «рука» + «бумага». | Japanese "letter", Chinese "toilet paper": the same characters, "hand" + "paper".
`;const normWord=(s)=>String(s||'').normalize('NFC').toLowerCase().replace(/́/g,'').replace(/ё/g,'е').replace(/\s*\([^)]*\)/g,'').replace(/[.,!?;:«»"“”„()]/g,'').replace(/\s+/g,' ').trim();function parse(){const out=[];let n=0;for(const raw of DATA.split('\n')){const line=raw.trim();if(!line)continue;const[kind,ws,ru,en]=line.split(' | ').map((s)=>s.trim());const words={};for(const part of ws.split(';')){const m=/^([a-z]{2,3})=(.+)$/.exec(part.trim());if(!m||m[2].trim()==='?')continue;words[m[1]]=m[2].split(',').map((x)=>x.trim()).filter(Boolean).map((x)=>{const r=/^(.*?)\[([^\]]+)\]$/.exec(x);return r?{w:r[1].trim(),root:r[2]}:{w:x};});}
out.push({id:kind+':'+ ++n,kind,words,note:{ru,en}});}
return out;}
const LINKS=parse();function linksFor(lang,word,{root=null}={}){const q=normWord(word);const r=root?normWord(root):null;if(!q&&!r)return[];return LINKS.filter((L)=>(L.words[lang]||[]).some((x)=>{const w=normWord(x.w);if(q&&(w===q||(w.length>=4&&q.startsWith(w)&&q.length-w.length<=3)))return true;return!!(r&&x.root&&normWord(x.root)===r);}));}
function searchLinks(q,{kind=null}={}){const s=normWord(q);return LINKS.filter((L)=>(!kind||L.kind===kind)&&(!s||Object.values(L.words).some((ws)=>ws.some((x)=>normWord(x.w).includes(s)))||normWord(L.note.ru).includes(s)||normWord(L.note.en).includes(s)));}
export{LANG_NAMES,KINDS,linksFor,searchLinks,LINKS};