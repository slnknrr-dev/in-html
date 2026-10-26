import{markdownToDoc}from"./markdown-doc.js";import{tplMakePDF}from"./sample/pdf.js";import{tplImagePNG}from"./sample/png.js";import{b64decode}from"./codec/base64.js";const DOCS_PDF={producer:'dc docs',creator:'dc docs templates'};function flat(doc){const out=[];const walk=(list)=>{for(const b of list||[]){out.push(b);if(b.type==='section')walk(b.blocks);if(b.type==='columns')for(const c of b.cols)walk(c.blocks);}};for(const k of['header','main','side'])walk(doc.regions[k]);return out;}
function mergeLang(V,base,other,lang){const a=flat(base),b=flat(other);if(a.length!==b.length)throw new Error(`template text "${lang}" has ${b.length} blocks, expected ${a.length}`);const copy=(to,from)=>{if(to&&from)to[lang]=from[lang]??'';};a.forEach((x,i)=>{const y=b[i];if(x.type!==y.type)throw new Error(`template text "${lang}": block ${i} is ${y.type}, expected ${x.type}`);const t=V.BLOCK_TYPES[x.type];for(const k of t.i18nFields||[])copy(x[k],y[k]);for(const k of t.itemI18nFields||[])(x.items||[]).forEach((it,j)=>copy(it[k],y.items[j]&&y.items[j][k]));if(x.type==='table')x.rows.forEach((r,ri)=>r.forEach((c,ci)=>copy(c.html,y.rows[ri]&&y.rows[ri][ci]&&y.rows[ri][ci].html)));if(x.att&&y.att)copy(base.attachments[x.att]&&base.attachments[x.att].title,other.attachments[y.att]&&other.attachments[y.att].title);});copy(base.meta.title,other.meta.title);}
function fromMarkdown(V,texts,files,o={}){const langs=Object.keys(texts);const fileMap=new Map(Object.entries(files||{}).map(([k,v])=>[k,b64decode(v)]));const docs=langs.map((l)=>V.normalizeDoc(markdownToDoc(texts[l],{lang:l,files:fileMap})));const doc=docs[0];docs.slice(1).forEach((d,i)=>mergeLang(V,doc,d,langs[i+1]));doc.langs=langs;doc.defaultLang=langs[0];doc.name=o.name||doc.name;const preset=V.THEMES[o.preset]?o.preset:doc.theme.preset;doc.theme={...doc.theme,...V.THEMES[preset].vars,preset,...(o.theme||{})};doc.layout={...doc.layout,type:o.layout||'single'};doc.page={...doc.page,...(o.page||{})};doc.meta={...doc.meta,description:o.description||{},author:o.author||''};for(const b of flat(doc))if(o.each)o.each(b,doc);return V.normalizeDoc(doc);}
const ARTICLE={en:`# Offline first, by design

*A short guide to tools that keep working when the network does not.*

[TOC]

## Why offline matters

Networks fail in the places where work happens: trains, basements, field sites. A tool that needs a server for every click turns each outage into lost time.

Offline-first tools keep **all data on the device** and treat the network as an optional extra.

> [!TIP]
> Ask one question of every feature: *does it still work in airplane mode?*

## Patterns that work

### Keep the state local

Store documents in the browser (IndexedDB) and save them to files on request. The file *is* the backup.

\`\`\`js
// Save the current document as a downloadable file.
const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
const url = URL.createObjectURL(blob);
\`\`\`

### Ship one file

A single HTML file with inline styles and scripts opens anywhere, from a USB stick or an e-mail attachment.

- No installation
- No accounts
- Nothing to keep online

![A single file on a sunny day](sunrise.png)

## Conclusion

Design for the outage first: the online case then comes for free.
`,ru:`# Офлайн прежде всего

*Короткое руководство по инструментам, которые работают, когда сеть — нет.*

[TOC]

## Почему офлайн важен

Сеть пропадает там, где идёт работа: в поездах, подвалах, на объектах. Инструмент, которому нужен сервер на каждый клик, превращает каждый сбой в потерянное время.

Офлайн-инструменты хранят **все данные на устройстве**, а сеть считают необязательным дополнением.

> [!TIP]
> Задавайте каждой функции один вопрос: *работает ли она в режиме полёта?*

## Работающие приёмы

### Храните состояние локально

Держите документы в браузере (IndexedDB) и сохраняйте их в файлы по запросу. Файл *и есть* резервная копия.

\`\`\`js
// Сохранить текущий документ как файл для скачивания.
const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
const url = URL.createObjectURL(blob);
\`\`\`

### Поставляйте один файл

Один HTML-файл со встроенными стилями и скриптами открывается где угодно — с флешки или из вложения письма.

- Без установки
- Без учётных записей
- Ничего не нужно держать онлайн

![Один файл солнечным днём](sunrise.png)

## Вывод

Сначала проектируйте под отсутствие сети — работа онлайн получится сама собой.
`,};function tplBuildArticle(V){return fromMarkdown(V,ARTICLE,{'sunrise.png':tplImagePNG(28,384,216)},{name:'Offline first',preset:'article',description:{en:'A short guide to offline-first tools.',ru:'Короткое руководство по офлайн-инструментам.'},author:'Docs',});}
const REPORT={en:`# Project Atlas — Q3 report

| | |
|:--|:--|
| Prepared by | Maya Ortiz, project lead |
| Period | July – September |
| Status | On track |

[TOC]

## Summary

The quarter closed with **all three milestones delivered**. Field testing started two weeks early, and the budget stays within 4% of the plan.

## Key figures

| Metric | Target | Actual |
|:--|--:|--:|
| Sites onboarded | 12 | 14 |
| Uptime | 99.5% | 99.8% |
| Open defects | < 20 | 11 |

> [!NOTE]
> Figures cover production sites only; pilot sites are reported separately.

## Risks

1. Supplier lead times for sensors grew to eight weeks.
2. Two field engineers leave in November.

## Next steps

- [x] Approve the Q4 budget
- [ ] Order sensors for the northern sites
- [ ] Hire and onboard two field engineers

[Detailed figures (PDF)](q3-figures.pdf)
`,ru:`# Проект «Атлас» — отчёт за III квартал

| | |
|:--|:--|
| Подготовила | Майя Ортис, руководитель проекта |
| Период | Июль – сентябрь |
| Статус | По плану |

[TOC]

## Итоги

Квартал закрыт с **выполнением всех трёх вех**. Полевые испытания начались на две недели раньше, бюджет отклоняется от плана не более чем на 4%.

## Ключевые показатели

| Показатель | План | Факт |
|:--|--:|--:|
| Подключено объектов | 12 | 14 |
| Доступность | 99,5% | 99,8% |
| Открытые дефекты | < 20 | 11 |

> [!NOTE]
> Показатели учитывают только рабочие объекты; пилотные объекты — в отдельном отчёте.

## Риски

1. Сроки поставки датчиков выросли до восьми недель.
2. Два полевых инженера уходят в ноябре.

## Следующие шаги

- [x] Утвердить бюджет на IV квартал
- [ ] Заказать датчики для северных объектов
- [ ] Нанять и ввести в работу двух полевых инженеров

[Подробные показатели (PDF)](q3-figures.pdf)
`,};function tplBuildReport(V){const pdf=tplMakePDF('Project Atlas - Q3 figures',['> Project Atlas - quarterly figures','# Sites onboarded','- July: 4 sites (target 4)','- August: 5 sites (target 4)','- September: 5 sites (target 4)','','# Uptime by month','- July: 99.7%','- August: 99.9%','- September: 99.8%','','# Defects','- Opened: 37, closed: 41, open at quarter end: 11',],{...DOCS_PDF,accent:'#0b4f6c'});return fromMarkdown(V,REPORT,{'q3-figures.pdf':pdf},{name:'Project Atlas — Q3 report',preset:'report',page:{pageNumbers:true},description:{en:'Quarterly project report.',ru:'Квартальный отчёт по проекту.'},each:(b,doc)=>{if(b.type==='toc'){b.numbered=true;b.depth=2;}
if(b.type==='checklist')b.look='strike';if(b.type==='table'&&b===doc.regions.main.find((x)=>x.type==='table')){b.header='col';b.style='lines';}},});}
const MEETING={en:`# Weekly sync — product team

| | |
|:--|:--|
| Date | Monday, 10:00–10:45 |
| Attendees | Ana, Giorgi, Lena, Tom |
| Notes by | Lena |

## Agenda

1. Release 2.4 status
2. Feedback from the pilot customers
3. Holiday schedule

## Discussion

The release candidate passed regression testing; two minor layout issues remain on small screens. Pilot customers asked for **Markdown export** and a darker print theme.

> [!IMPORTANT]
> Decision: release 2.4 ships on Thursday; Markdown export moves into 2.5.

## Action items

- [ ] Fix the small-screen layout issues — Giorgi
- [ ] Draft the 2.4 release notes — Ana
- [x] Share the holiday calendar — Tom
`,ru:`# Еженедельная встреча — команда продукта

| | |
|:--|:--|
| Дата | Понедельник, 10:00–10:45 |
| Участники | Ана, Гиорги, Лена, Том |
| Протокол вела | Лена |

## Повестка

1. Состояние релиза 2.4
2. Отзывы пилотных клиентов
3. График отпусков

## Обсуждение

Релиз-кандидат прошёл регрессионное тестирование; на маленьких экранах остались две мелкие проблемы с вёрсткой. Пилотные клиенты просят **экспорт в Markdown** и более тёмную тему печати.

> [!IMPORTANT]
> Решение: релиз 2.4 выходит в четверг; экспорт в Markdown переносится в 2.5.

## Поручения

- [ ] Исправить вёрстку на маленьких экранах — Гиорги
- [ ] Подготовить описание релиза 2.4 — Ана
- [x] Разослать график отпусков — Том
`,};function tplBuildMeeting(V){return fromMarkdown(V,MEETING,{},{name:'Weekly sync',preset:'modern',description:{en:'Meeting notes with decisions and action items.',ru:'Протокол встречи с решениями и поручениями.'},each:(b)=>{if(b.type==='table'){b.header='col';b.style='lines';}},});}
const TECHNICAL={en:`# sync-cli — setup notes

A command-line tool that mirrors a folder to removable storage. These notes cover installation, configuration and day-to-day use.

[TOC]

## Install

\`\`\`sh
npm install --global sync-cli
sync-cli --version
\`\`\`

## Configure

Create \`sync.json\` next to the folder you want to mirror:

\`\`\`json
{
  "source": "./projects",
  "target": "E:/backup",
  "exclude": ["node_modules", "*.tmp"],
  "verify": true
}
\`\`\`

| Option | Default | Meaning |
|:--|:--|:--|
| \`exclude\` | \`[]\` | Glob patterns that are skipped |
| \`verify\` | \`false\` | Compare checksums after copying |
| \`dryRun\` | \`false\` | Only print what would change |

> [!WARNING]
> The target folder is overwritten. Run with \`--dry-run\` first.

## Use from a script

\`\`\`js
import { sync } from 'sync-cli';

const report = await sync({ source: './projects', target: 'E:/backup' });
console.log(\`\${report.copied} files copied\`);
\`\`\`

## Checklist before a release

- [x] Tests pass on Windows, macOS and Linux
- [ ] Changelog updated
- [ ] Version bumped
`,ru:`# sync-cli — заметки по настройке

Консольная утилита, которая зеркалирует папку на съёмный носитель. Здесь описаны установка, настройка и повседневная работа.

[TOC]

## Установка

\`\`\`sh
npm install --global sync-cli
sync-cli --version
\`\`\`

## Настройка

Создайте \`sync.json\` рядом с папкой, которую нужно зеркалировать:

\`\`\`json
{
  "source": "./projects",
  "target": "E:/backup",
  "exclude": ["node_modules", "*.tmp"],
  "verify": true
}
\`\`\`

| Параметр | По умолчанию | Назначение |
|:--|:--|:--|
| \`exclude\` | \`[]\` | Шаблоны путей, которые пропускаются |
| \`verify\` | \`false\` | Сверять контрольные суммы после копирования |
| \`dryRun\` | \`false\` | Только показать, что изменится |

> [!WARNING]
> Целевая папка перезаписывается. Сначала запустите с \`--dry-run\`.

## Вызов из скрипта

\`\`\`js
import { sync } from 'sync-cli';

const report = await sync({ source: './projects', target: 'E:/backup' });
console.log(\`скопировано файлов: \${report.copied}\`);
\`\`\`

## Проверка перед выпуском

- [x] Тесты проходят на Windows, macOS и Linux
- [ ] Обновлён список изменений
- [ ] Увеличен номер версии
`,};function tplBuildTechnical(V){return fromMarkdown(V,TECHNICAL,{},{name:'sync-cli — setup notes',preset:'technical',description:{en:'Installation and configuration notes.',ru:'Заметки по установке и настройке.'},each:(b)=>{if(b.type==='code'&&b.lang==='js')b.lineNumbers=true;},});}
const LETTER={en:`**Nino Kapanadze**\\
12 Rustaveli Avenue, Tbilisi\\
nino@example.org

14 October

**Riverside Library**\\
Attn: Events Committee

### Proposal: a monthly offline-tools workshop

Dear members of the committee,

I would like to propose a free monthly workshop on tools that work without an internet connection: note-taking, document editing and safe backups for people with unreliable access.

Each session would last ninety minutes and needs only the reading room and a projector. Participants bring their own laptops; materials are shared as single files on USB sticks.

I would be glad to present the programme at your next meeting.

Kind regards,

Nino Kapanadze
`,ru:`**Нино Капанадзе**\\
пр. Руставели, 12, Тбилиси\\
nino@example.org

14 октября

**Библиотека «Риверсайд»**\\
Комитету по мероприятиям

### Предложение: ежемесячный практикум по офлайн-инструментам

Уважаемые члены комитета!

Предлагаю проводить бесплатный ежемесячный практикум по инструментам, которые работают без интернета: заметки, редактирование документов и надёжное резервное копирование для тех, у кого связь ненадёжна.

Каждое занятие длится девяносто минут, нужны только читальный зал и проектор. Участники приходят со своими ноутбуками; материалы раздаются отдельными файлами на флешках.

Буду рада представить программу на вашем ближайшем заседании.

С уважением,

Нино Капанадзе
`,};function tplBuildLetter(V){return fromMarkdown(V,LETTER,{},{name:'Letter — workshop proposal',preset:'classic',theme:{baseSize:11.5,lineHeight:1.55},page:{margin:{top:22,right:22,bottom:22,left:22}},description:{en:'A formal letter.',ru:'Официальное письмо.'},});}
function tplBuildBlank(V,lang='en',opts={}){if(typeof lang!=='string'||!/^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(lang))lang='en';return V.normalizeDoc(V.newDoc({langs:[lang],name:opts.name||'Untitled document'}));}
const TEMPLATES=[{id:'article',name:{en:'Article',ru:'Статья',de:'Artikel',fr:'Article',es:'Artículo',uk:'Стаття',ka:'სტატია'},desc:{en:'Long read with a lead, table of contents, tip box, code sample and an illustration.',ru:'Лонгрид с подводкой, содержанием, советом, примером кода и иллюстрацией.',de:'Längerer Text mit Vorspann, Inhaltsverzeichnis, Tipp-Box, Codebeispiel und Illustration.',fr:'Article long avec chapeau, sommaire, encadré astuce, exemple de code et illustration.',es:'Artículo largo con entradilla, índice, recuadro de consejo, ejemplo de código e ilustración.',uk:'Лонгрид із підводкою, змістом, порадою, прикладом коду та ілюстрацією.',ka:'ვრცელი სტატია შესავლით, სარჩევით, რჩევით, კოდის მაგალითითა და ილუსტრაციით.',},langs:['en','ru'],build:tplBuildArticle,},{id:'report',name:{en:'Project report',ru:'Отчёт по проекту',de:'Projektbericht',fr:'Rapport de projet',es:'Informe de proyecto',uk:'Звіт про проєкт',ka:'პროექტის ანგარიში'},desc:{en:'Numbered contents, key figures table, risks, next steps and a PDF attachment; page numbers in print.',ru:'Нумерованное содержание, таблица показателей, риски, следующие шаги и PDF-вложение; номера страниц при печати.',de:'Nummeriertes Inhaltsverzeichnis, Kennzahlentabelle, Risiken, nächste Schritte und PDF-Anhang; Seitenzahlen im Druck.',fr:'Sommaire numéroté, tableau des indicateurs, risques, prochaines étapes et pièce jointe PDF ; numéros de page à l’impression.',es:'Índice numerado, tabla de indicadores, riesgos, próximos pasos y un PDF adjunto; números de página al imprimir.',uk:'Нумерований зміст, таблиця показників, ризики, наступні кроки та PDF-вкладення; номери сторінок під час друку.',ka:'დანომრილი სარჩევი, მაჩვენებლების ცხრილი, რისკები, შემდეგი ნაბიჯები და PDF დანართი; გვერდების ნომრები ბეჭდვისას.',},langs:['en','ru'],build:tplBuildReport,},{id:'meeting',name:{en:'Meeting notes',ru:'Протокол встречи',de:'Besprechungsnotizen',fr:'Compte rendu de réunion',es:'Acta de reunión',uk:'Протокол зустрічі',ka:'შეხვედრის ოქმი'},desc:{en:'Details, agenda, discussion, a highlighted decision and action items.',ru:'Сведения, повестка, обсуждение, выделенное решение и поручения.',de:'Eckdaten, Tagesordnung, Diskussion, hervorgehobene Entscheidung und Aufgaben.',fr:'Informations, ordre du jour, discussion, décision mise en avant et actions à mener.',es:'Datos, orden del día, debate, decisión destacada y tareas.',uk:'Відомості, порядок денний, обговорення, виділене рішення та доручення.',ka:'დეტალები, დღის წესრიგი, განხილვა, გამოყოფილი გადაწყვეტილება და დავალებები.',},langs:['en','ru'],build:tplBuildMeeting,},{id:'technical',name:{en:'Technical note',ru:'Техническая заметка',de:'Technische Notiz',fr:'Note technique',es:'Nota técnica',uk:'Технічна нотатка',ka:'ტექნიკური ჩანაწერი'},desc:{en:'Highlighted shell, JSON and JavaScript, an options table, a warning and a release checklist.',ru:'Подсветка shell, JSON и JavaScript, таблица параметров, предупреждение и чек-лист выпуска.',de:'Hervorgehobener Shell-, JSON- und JavaScript-Code, Optionstabelle, Warnhinweis und Release-Checkliste.',fr:'Shell, JSON et JavaScript colorés, tableau des options, avertissement et liste de contrôle de version.',es:'Shell, JSON y JavaScript resaltados, tabla de opciones, advertencia y lista de comprobación de versión.',uk:'Підсвітка shell, JSON і JavaScript, таблиця параметрів, попередження та чек-лист випуску.',ka:'გამოყოფილი shell, JSON და JavaScript, პარამეტრების ცხრილი, გაფრთხილება და გამოშვების საკონტროლო სია.',},langs:['en','ru'],build:tplBuildTechnical,},{id:'letter',name:{en:'Letter',ru:'Письмо',de:'Brief',fr:'Lettre',es:'Carta',uk:'Лист',ka:'წერილი'},desc:{en:'Formal letter with sender, date, recipient and subject; wide margins for printing.',ru:'Официальное письмо: отправитель, дата, адресат и тема; широкие поля для печати.',de:'Förmlicher Brief mit Absender, Datum, Empfänger und Betreff; breite Ränder für den Druck.',fr:'Lettre formelle avec expéditeur, date, destinataire et objet ; larges marges pour l’impression.',es:'Carta formal con remitente, fecha, destinatario y asunto; márgenes amplios para imprimir.',uk:'Офіційний лист: відправник, дата, адресат і тема; широкі поля для друку.',ka:'ოფიციალური წერილი: გამგზავნი, თარიღი, ადრესატი და თემა; ფართო ველები ბეჭდვისთვის.',},langs:['en','ru'],build:tplBuildLetter,},{id:'blank',name:{en:'Blank',ru:'Пустой',de:'Leer',fr:'Vierge',es:'En blanco',uk:'Порожній',ka:'ცარიელი'},desc:{en:'An empty page with a title. Tip: open a Markdown file to start from it.',ru:'Пустая страница с заголовком. Совет: откройте файл Markdown, чтобы начать с него.',de:'Leere Seite mit Titel. Tipp: Öffnen Sie eine Markdown-Datei, um damit zu beginnen.',fr:'Page vide avec un titre. Astuce : ouvrez un fichier Markdown pour partir de celui-ci.',es:'Página vacía con título. Consejo: abra un archivo Markdown para empezar desde él.',uk:'Порожня сторінка із заголовком. Порада: відкрийте файл Markdown, щоб почати з нього.',ka:'ცარიელი გვერდი სათაურით. რჩევა: გახსენით Markdown ფაილი, რომ მისგან დაიწყოთ.',},langs:['en'],userLang:true,build:tplBuildBlank,},];export{TEMPLATES};