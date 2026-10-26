// language-studio/e2e.js - browser scenario through the interface: the six courses on the home page, lessons of every
// kind, the Georgian splitter and verb constructor, Sanskrit transliteration and meter scan, the character constructor,
// a letters game played to the end (score recorded, cards scheduled), the drawing game (a stroke-perfect kanji and a
// scribble), review cards, the dictionary search, the progress page, and — when the page has a server — registration,
// synchronisation and sign-in again. Run against the dev server or a built page, at desktop and phone widths:
//   node check.js e2e http://localhost:8080/language-studio/ language-studio/e2e.js --lang en
//   node check.js e2e http://localhost:8080/language-studio/ language-studio/e2e.js --lang en --mobile --size 390x844
// The scenario function is serialized into the page (Function.prototype.toString): it may use only browser globals.
// (The opening list says six courses; the home page now shows eight, see courses/index.js.)
// Strategy: wait for body[data-ready] (set at the end of boot, after storage and voices), then drive the UI through
// real events and routes; each step records ok/FAIL and the run continues.

export default async function scenario() {
  const steps = [];
  const step = (name, ok, v) => steps.push([name, ok ? 'ok' : 'FAIL', v]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(60); } return null; };
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason && e.reason.message)));
  // the page re-renders on hashchange (asynchronously): wait for a new first child of #main, then for the selector
  const go = async (hash, sel) => { const before = $('#main').firstElementChild; location.hash = hash; await until(() => $('#main').firstElementChild !== before || decodeURIComponent(location.hash.slice(1)) === hash && !before); return until(() => $(sel)); };
  const text = () => $('#main').innerText;

  const ready = await until(() => document.body.dataset.ready === '1', 15000);
  step('app ready', !!ready && $$('.ls-course').length === 8, $$('.ls-course').map((a) => a.dataset.course));
  const LS = window.__languageStudio;

  // --- lessons of every kind
  await go('ka/learn/phrases', '.ls-parse');
  step('Georgian expressions taken apart', $$('.ls-parse').length >= 10 && /ნახვამდის/.test(text()) && $$('.ls-part').length > 30, $$('.ls-parse').length);
  await go('ka/learn/supra', '.ls-dialogue');
  step('multi-party dialogue', $$('.ls-who').length >= 6, $$('.ls-who').length);
  await go('ka/learn/cases', '.ls-decl');
  step('declension tables in a lesson', /სახლიდან/.test(text()) && /დედასთან/.test(text()), null);
  await go('sa/learn/quotes', '.ls-poem');
  const scanBtn = $('.ls-poem .ls-line button.ed-sm');
  scanBtn.click();
  step('Rigveda in Devanagari with a meter scan', /अ॒ग्नि/.test(text()) && !!(await until(() => $('.ls-scan-box .ls-heavy'))), null);
  await go('ja/learn/compare', '.ls-variants');
  step('Japanese / traditional / simplified table', $$('.ls-variants tbody tr').length >= 30 && /氣/.test(text()), $$('.ls-variants tbody tr').length);
  await go('zh/learn/hanzi', '.ls-char');
  step('hanzi with traditional forms', $$('.ls-char').length >= 40 && /繁 國/.test(text()), $$('.ls-char').length);
  await go('ru/learn/neutral', '.ls-orig');
  step('Russian: original vs narrowed sense', /co-feel/.test(text()) && $$('.ls-orig').length >= 15, $$('.ls-orig').length);
  await go('en/learn/it', '.ls-word');
  step('English IT naming culture', /Уилхайт|Wilhite/.test(text()), null);

  // --- explanation language switch (Japanese: Russian / Chinese)
  await go('ja/learn/kana', '.ls-explain-sel select');
  const sel = $('.ls-explain-sel select');
  sel.value = 'zh'; sel.dispatchEvent(new Event('change'));
  step('explanations in Chinese', !!(await until(() => /平假名/.test(text()) && /日语有三种文字/.test(text()))), LS.doc.prefs['explain.ja']);

  // --- tools
  await go('ka/tools/ka-split', '.ls-tool input');
  const kin = $('.ls-tool input');
  kin.value = 'გამიკეთებს'; kin.dispatchEvent(new Event('input'));
  step('Georgian splitter', !!(await until(() => $$('.ls-out .ls-part b').map((b) => b.textContent).join('+') .startsWith('გა+მ+ი+კეთ+ებ+ს'))), $$('.ls-out .ls-part b').map((b) => b.textContent).join('+'));
  await go('ka/tools/ka-verb', '.ls-paradigm');
  const verSel = $$('.ls-ctl select')[2];
  verSel.value = 'objective'; verSel.dispatchEvent(new Event('change'));
  step('verb constructor: objective version', !!(await until(() => /ვუწერ/.test(text()))), null);
  await go('ka/tools/ka-number', '.ls-tool input');
  const num = $('.ls-tool input'); num.value = '99'; num.dispatchEvent(new Event('input'));
  step('vigesimal numbers', /ოთხმოცდაცხრამეტი/.test(text()), null);
  await go('sa/tools/sa-sandhi', '.ls-out');
  step('sandhi chain explained', /devendretyasti/.test(text()) && $$('.ls-steps li').length >= 2, null);
  await go('sa/tools/sa-meter', '.ls-scan-box');
  step('meter scanner: gāyatrī', /gāyatrī/.test(text()), null);
  await go('ja/tools/cjk-compose', '.ls-key');
  $$('.ls-key').find((b) => b.textContent === '日').click();
  $$('.ls-key').find((b) => b.textContent === '月').click();
  step('character constructor: 日 + 月 = 明', !!(await until(() => /明/.test($('.ls-out').innerText))), null);
  await go('zh/tools/zh-pinyin', '.ls-table');
  step('pinyin analysis with tone sandhi', /nǐ hǎo/.test(text()) && /→ 2/.test(text()), null);
  await go('ru/tools/ru-split', '.ls-out .ls-part');
  step('Russian morphemes', /чувств/.test(text()), null);

  // --- the Georgian workbench and text analysis
  await go('ka/tools/ka-type', '.lx-word');
  const ta = $('.ls-tool textarea');
  ta.value = "k'artuli ena"; ta.dispatchEvent(new Event('input'));
  step('transcription becomes Georgian, a wrong mark is flagged', !!(await until(() => /ქართული ენა/.test($('.ls-big').textContent) && $('.lx-fix'))), $('.ls-big').textContent);
  await go('ka/tools/ka-forms/' + encodeURIComponent('წერა'), '.lx-table');
  step('word forms of a verb', /ვწერ/.test($('.lx-table').textContent) && $$('.lx-table tr').length >= 6, null);
  await go('ka/tools/ka-forms/' + encodeURIComponent('ფანჯარა'), '.lx-table');
  step('noun cases with syncope and postpositions', /ფანჯრის/.test($('.lx-table').textContent) && $$('.lx-posts .ed-chip').length >= 5, null);
  await go('ka/tools/ka-sentence', '.lx-graph svg');
  step('sentence designer with case reasons and a graph', /მომცა/.test($('.ls-big').textContent) && $$('.lx-table tr').length >= 3, $('.ls-big').textContent);
  await go('ka/tools/text', '.lx-text');
  step('text analysis: entities, dialogue, graphs', $$('.lx-ent').length >= 8 && $$('.lx-speech').length >= 2 && !!$('.lx-graph svg') && /flowchart/.test($('.lx-mermaid pre').textContent), $$('.lx-ent').length);
  $$('.ls-tool .ed-seg-btn').find((b) => b.dataset.v === 'topic').click();
  step('topic chain graph', !!(await until(() => $('.lx-graph svg') && /S1/.test($('.lx-graph').textContent))), null);
  await go('ru/tools/text', '.lx-text');
  step('text analysis in Russian', $$('.lx-ent').length >= 4, $$('.lx-ent').length);
  await go('ka/dict', '.ls-word');
  step('the big dictionary in the course', $$('.ls-word').length >= 300 && !!$('.lx-formslink'), $$('.ls-word').length);
  // dictionary filters by labels: everyday words only
  const before = $$('.ls-word').length;
  $$('.mo-filter .ed-chip').find((b) => b.dataset.v === 'everyday').click();
  step('dictionary filtered by everyday use', !!(await until(() => $$('.ls-word').length > 0 && $$('.mo-wl').every((x) => /обиходн|everyday/.test(x.textContent)))), [before, $$('.ls-word').length]);

  // --- morphemes: a word before the dictionary, search by preverb, possible words of a root
  await go('ka/tools/morph', '.mo-reading');
  const mw = $('.mo-tool > .ed-field input');
  mw.value = 'უსახლო'; mw.dispatchEvent(new Event('input'));
  step('Georgian morphemes with the probable rule', !!(await until(() => /უ.*სახლ.*ო/.test($('.mo-reading .mo-parts').textContent.replace(/s/g, '')) && $('.mo-reading').textContent.includes(':'))), $('.mo-reading').textContent.slice(0, 80));
  const pv = $$('.mo-ctl select')[0];
  pv.value = 'გადა'; pv.dispatchEvent(new Event('change'));
  step('search by preverb', !!(await until(() => $$('.mo-hit').length >= 5 && $$('.mo-hit b').every((b) => b.textContent.startsWith('გადა')))), $$('.mo-hit').length);
  const ri = $('.mo-ctl input');
  ri.value = 'წერ'; ri.dispatchEvent(new Event('change'));
  step('possible words of a root, attested or not', !!(await until(() => $$('.mo-pw').length >= 10 && $$('.mo-pw-new').length >= 1)), $$('.mo-pw').length);
  const lf = $$('.mo-tool .mo-filter .ed-chip').find((b) => b.dataset.v === 'colloquial');
  await go('ru/tools/morph', '.mo-reading');
  const rw = $('.mo-tool > .ed-field input');
  rw.value = 'ложить'; rw.dispatchEvent(new Event('input'));
  step('Russian: substandard flagged', !!(await until(() => /просторечн|substandard/.test($('.mo-reading').textContent))), $('.mo-reading').textContent.slice(0, 80));
  await go('en/tools/morph', '.mo-reading');
  step('English morphemes', !!$('.mo-reading .mo-root'), null);

  // --- Korean and Mingrelian
  await go('ko/tools/ko-hangul', '.ko-block');
  step('Korean syllable blocks', $$('.ko-block').length >= 2, $$('.ko-block').length);
  await go('ko/tools/ko-parse', '.ko-word');
  step('Korean word parser', $$('.ko-word').length >= 1, $$('.ko-word').length);
  await go('ko/learn', '.ls-section, .ls-sec, section');
  step('Korean lessons', /한글|Hangul|хангыль/i.test(text()), null);
  await go('xmf/tools/xmf-parse', '.xmf-head');
  step('Mingrelian word parser', !!$('.xmf-head'), null);
  await go('xmf/tools/xmf-cognate', '.ls-tool');
  step('Mingrelian cognates', /ქართ|Georgian|грузин/i.test(text()), null);

  // --- C1 / C2 lessons (adv-*.js): a C1 lesson in each of English, Russian and Georgian, its quiz and try links
  await go('en/learn', '.ls-sec-link');
  step('C1 and C2 lessons listed', $$('.ls-sec-link .ed-tag').filter((x) => x.textContent === 'C1').length >= 4 && $$('.ls-sec-link .ed-tag').some((x) => x.textContent === 'C2'), $$('.ls-sec-link .ed-tag').map((x) => x.textContent).join(''));
  await go('en/learn/c1-inversion', '.xl-quiz');
  const q0 = $$('.xl-q')[0];
  q0.querySelectorAll('.ls-choice')[0].click();
  step('English C1: inversion with a quiz answered', /Never have I seen/.test(text()) && $('.ls-sec-head .ed-tag').textContent === 'C1' && !!q0.querySelector('.ls-ok') && !q0.querySelector('.xl-why').hidden && /1/.test($('.xl-qscore').textContent), $('.xl-qscore').textContent);
  await go('ru/learn/c1-participles', '.xl-try');
  step('Russian C1: participles', /читающий/.test(text()) && $('.ls-sec-head .ed-tag').textContent === 'C1' && $$('.xl-quiz .xl-q').length === 2, null);
  $$('.xl-trylink')[0].click();
  step('a try link opens the morpheme parser on the word', !!(await until(() => /morph/.test(location.hash) && $('.mo-reading') && /чит/.test($('.mo-reading').textContent))), location.hash);
  await go('ka/learn/c1-series3', '.xl-quiz');
  step('Georgian C1: series III and the evidential', /დამიწერია/.test(text()) && /оказывается/.test(text()) && $('.ls-sec-head .ed-tag').textContent === 'C1', null);
  await go('ka/learn/c2-legend', '.ls-poem');
  step('Georgian C2 reading with transcription', /მოხარშულა/.test(text()) && $$('.ls-poem .ls-tr').length >= 6, null);

  // --- across languages (xl-tools.js): families in the morpheme parser, the dictionary both ways, the sentence
  // designer against Russian and English, parallel texts, typing, decks between any pair, letters across scripts
  await go('ru/tools/morph/' + encodeURIComponent('независимость'), '.mo-reading');
  step('Russian word → its family in English and Georgian', !!(await until(() => $('.xl-inline') && /დამოუკიდებლობა/.test($('.xl-inline').textContent) && /independence/.test($('.xl-inline').textContent))), null);
  await go('ka/tools/xl/dict/' + encodeURIComponent('вода'), '.xl-entry');
  step('dictionary across languages: Russian → Georgian back-lookup, the Mingrelian cognate', $$('.xl-entry').some((e) => /წყალი/.test(e.textContent) && e.querySelector('.xl-back')) && /წყარი/.test(text()), $$('.xl-entry').length);
  await go('ka/tools/ka-sentence', '.xl-contrast');
  const conRu = $('.xl-contrast').textContent;
  $$('.xl-contrast .ed-seg-btn').find((b) => b.dataset.v === 'en').click();
  step('sentence designer: the same structure in Russian and English', /эргатив/i.test(conRu) && !!(await until(() => /Past Simple/.test($('.xl-contrast').textContent))), null);
  await go('ka/tools/xl/parallel', '.xl-par');
  step('parallel texts aligned, names matched across scripts', $$('.xl-par tbody tr').length >= 5 && $$('.xl-anchor').some((x) => /vahtang|tbilis/.test(x.textContent)) && $$('.xl-entpair').length >= 1, [$$('.xl-par tbody tr').length, $$('.xl-entpair').length]);
  await go('ru/tools/xl/type', '.xl-typed');
  const tin = $('.xl-panel textarea');
  tin.value = "privet, zhizn'"; tin.dispatchEvent(new Event('input'));
  step('Latin typing for Cyrillic', !!(await until(() => $('.xl-typed').textContent === 'привет, жизнь')), $('.xl-typed').textContent);
  await go('ka/tools/xl/deck', '.xl-deck-info');
  const [fromSel, toSel] = $$('.xl-deck-ctl select');
  fromSel.value = 'ka'; fromSel.dispatchEvent(new Event('change'));
  toSel.value = 'ko'; toSel.dispatchEvent(new Event('change'));
  $('.xl-deck-info .ed-primary').click();
  const shw = await until(() => $$('.xl-deck button').find((b) => !b.hidden && b.classList.contains('ed-primary')));
  shw.click();
  (await until(() => $('.xl-deck .ls-g2'))).click();
  step('a deck Georgian → Korean through the shared gloss', Object.keys(LS.doc.cards).some((k) => k.startsWith('x:ka>ko:')), Object.keys(LS.doc.cards).filter((k) => k.startsWith('x:')).length);
  await go('ka/games/x-letters', '.ls-choice');
  $('.ls-choice').click();
  const drawBtn = await until(() => $$('.ls-stage .ap-actions .ed-btn').find((b) => !b.classList.contains('ed-primary')));
  drawBtn.click();
  const xpad = await until(() => $('.ls-game')._pad);
  xpad.setStrokes([[[0.3, 0.2], [0.7, 0.8]]]);
  $$('.xl-drawbox .ls-draw-side button')[0].click();
  step('same sound in another script, then drawn', !!(await until(() => $('.xl-drawbox .ls-draw-res .ls-big'))) && !!$('.ls-explain') && Object.keys(LS.doc.cards).some((k) => k.startsWith('x:letters:Geor>')), $('.ls-explain') && $('.ls-explain').textContent.slice(0, 60));
  await go('ru/dict', '.ls-word');
  step('Russian dictionary rows show the word in other languages', $$('.ls-word .xl-equiv').length >= 3, $$('.ls-word .xl-equiv').length);

  // --- the rhyme and meter workshop: two lines get a catch score, a suggested ending makes the rhyme word green
  await go('ru/tools/rhyme', '.rh-text');
  const rta = $('.rh-text');
  rta.value = 'Нет, ты милее длительной красою:\nВесна проходит краткой полосой';
  rta.dispatchEvent(new Event('input'));
  const missed = await until(() => { const l = $('.rh-line[data-i="1"]'); return $$('.rh-line').length === 2 && l && /\d+ %/.test((l.querySelector('.rh-pill') || {}).textContent || '') && !l.querySelector('.rh-w.rh-end.rh-good') && l; });
  step('rhyme workshop: two lines get a catch score', !!missed && $$('.rh-slot').length >= 10 && $$('.rh-seg').length >= 4, missed && missed.querySelector('.rh-pill').textContent);
  $('.rh-line[data-i="1"]').click();
  const endOpt = await until(() => $$('.rh-end-opt').find((b) => b.dataset.word === 'полосою'));
  if (endOpt) endOpt.click();
  step('a suggested ending catches the rhyme: the word turns green', !!(await until(() => $('.rh-line[data-i="1"] .rh-w.rh-end.rh-good') && /полосою/.test($('.rh-text').value))), ($('.rh-line[data-i="1"] .rh-pill') || {}).textContent);
  await go('ka/tools/rhyme/rustaveli', '.rh-line');
  step('Rustaveli: shairi, one rhyme per stanza, all caught', $$('.rh-line .rh-pill.rh-good').length === 8 && /shairi|шаири|шаїрі|შაირი|chaïri/i.test($('.rh-summary').textContent), $('.rh-summary').textContent.slice(0, 60));

  // --- a letters game to the end
  await go('ka/games/sym2sound:mkhedruli', '.ls-choice');
  let rounds = 0;
  while (rounds < 12) {
    const c = await until(() => $('.ls-choice:not(:disabled)') || $('.ls-final'));
    if (!c || c.classList.contains('ls-final')) break;
    c.click();
    rounds++;
    const nx = await until(() => $('.ls-next'));
    if (nx) nx.click();
  }
  const fin = await until(() => $('.ls-final'));
  step('letters game finished', !!fin && rounds === 10 && !!LS.doc.scores['ka:sym2sound:mkhedruli'], { rounds, score: LS.doc.scores['ka:sym2sound:mkhedruli'] });
  step('letters scheduled for repetition', Object.keys(LS.doc.cards).filter((k) => k.startsWith('ka:mkhedruli:')).length === 10, Object.keys(LS.doc.cards).length);

  // --- drawing: a kanji traced exactly, then a scribble
  await go('ja/games/trace:kanji', '.ls-pad');
  const host = $('.ls-game');
  const pad = await until(() => host._pad);
  const ch = $('.ls-q .ls-glyph-sm').textContent;
  // the model strokes are drawn in grey on the pad; take them from the page's data via the numbered start points is not
  // possible, so draw the character's strokes from a small table of the simplest ones when it is one of them
  const SIMPLE = { '一': [[[0.1, 0.5], [0.9, 0.5]]], '二': [[[0.25, 0.3], [0.75, 0.3]], [[0.1, 0.72], [0.9, 0.72]]], '十': [[[0.1, 0.45], [0.9, 0.45]], [[0.5, 0.1], [0.5, 0.92]]] };
  pad.setStrokes(SIMPLE[ch] || [[[0.2, 0.2], [0.8, 0.8]]]);
  $$('.ls-draw-side button')[0].click();
  const res = await until(() => $('.ls-draw-res .ls-big'));
  const score = res ? parseInt(res.textContent, 10) : -1;
  step('drawing evaluated', score >= 0 && score <= 100 && (!SIMPLE[ch] || score >= 85), { ch, score });
  $('.ls-next').click();
  await until(() => !$('.ls-draw-res .ls-big'));
  const pad2 = await until(() => host._pad);
  pad2.setStrokes([[[0.1, 0.9], [0.15, 0.85]]]);
  $$('.ls-draw-side button')[0].click();
  const res2 = await until(() => $('.ls-draw-res .ls-big'));
  step('a scribble scores low and gets verdicts', res2 && parseInt(res2.textContent, 10) < 50 && $$('.ls-draw-res li').length >= 1, res2 && res2.textContent);

  // --- learning a word list with cards
  await go('ka/learn/greetings', '.ls-sec-head .ed-primary');
  $('.ls-sec-head .ed-primary').click();
  const show = await until(() => $$('.ls-stage button').find((b) => !b.hidden && b.classList.contains('ed-primary')));
  show.click();
  const good = await until(() => $('.ls-g2'));
  good.click();
  step('word card graded', !!Object.entries(LS.doc.cards).find(([k, c]) => k.startsWith('ka:greetings:') && c.n === 1), null);

  // --- dictionary and progress
  await go('ka/dict', '.ls-search');
  const q = $('.ls-search'); q.value = 'хлеб'; q.dispatchEvent(new Event('input'));
  step('dictionary search', !!(await until(() => $$('.ls-word').length === 1 && /პური/.test(text()))), $$('.ls-word').length);
  await go('progress', '.ls-progress table');
  step('progress page', /mkhedruli|ka:sym2sound/.test(text()), null);

  // --- account (only when the page has a server)
  let hasServer = false;
  if (/^https?:/.test(location.protocol)) { try { hasServer = (await fetch('/api/info', { cache: 'no-store' })).ok; } catch { hasServer = false; } }
  if (hasServer && !/offline/.test(document.documentElement.dataset.mode || '')) {
    await go('', '.ls-acc');
    const reg = $$('.ls-acc button').find((b) => /register|Зарег|Create/i.test(b.textContent)) || $$('.ls-acc button')[1];
    if (reg) {
      reg.click();
      const name = 'e2e' + Date.now().toString(36);
      const inName = await until(() => $('#ls-a-name'));
      inName.value = name; $('#ls-a-pw').value = 'e2e-password'; $('#ls-a-pw2').value = 'e2e-password';
      $('.ed-dialog .ed-primary').click();
      step('registered and signed in', !!(await until(() => new RegExp(name).test(text()))), name);
      await sleep(900);
      const r = await (await fetch('/api/progress', { cache: 'no-store' })).json();
      step('progress synchronised to the server', r.doc && Object.keys(r.doc.cards).length >= 10 && r.doc.scores['ka:sym2sound:mkhedruli'], r.doc && Object.keys(r.doc.cards).length);
      $$('.ls-acc button').find((b) => /Sign out|Выйти/.test(b.textContent)).click();
      step('signed out', !!(await until(() => $$('.ls-acc button').some((b) => /Sign in|Войти/.test(b.textContent)))), null);
    }
  } else step('no server: progress stays in the browser', /IndexedDB|browser|браузере/.test((await go('', '.ls-acc-note')) ? text() : ''), null);

  step('no errors', !errors.length, errors);
  return { steps };
}
