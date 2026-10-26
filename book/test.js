// book/test.js - unit tests of the book library: `node book/test.js` (importing the module runs nothing).
// Round trips (FB2, EPUB 3, EPUB 2, Markdown, JSON keep the structure), the structural validators on everything the
// library writes, foreign-style files (an EPUB 2 with superscript note links, a split chapter and HTML entities; a
// windows-1251 FB2; malformed FB2), text / HTML / Markdown import, search, covers, and the reader's offset contract
// (rendered text content of every unit equals blockPlain).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseXML } from '../xml/xml.js';
import { writeZip } from '../zip/zip.js';
import { decodeEntities, decodeText, parseMarkup, textContent } from './markup.js';
import { blockPlain, bookStats, inlineText, normalizeBook, readingUnits, titlePlain } from './model.js';
import { renderBlock, renderContext, renderTitle, blocksFromHTML, htmlToBook } from './html.js';
import { readFB2, writeFB2 } from './fb2.js';
import { readEpub, writeEpub } from './epub.js';
import { bookToMarkdown, bookToText, markdownToBook } from './text.js';
import { detectFormat, readBook, writeBook, toJSON, fromJSON } from './open.js';
import { checkEpub, checkFB2, checkText, validateBook } from './validate.js';
import { searchUnits } from './search.js';
import { COVER_DESIGNS, COVER_PALETTES, coverSVG } from './cover.js';
import { sampleBook } from './sample.js';

//
// Test philosophy: compare structure, not bytes. signature() projects a book onto what every format must preserve
// (tree shape, titles, block types and plain texts, notes, image sizes, style ids); format-specific details that
// legitimately differ (generated ids, whitespace, metadata a format cannot hold) are left out, so a round-trip
// assertion fails only on real information loss. Fixtures are inline strings built in code: no binary test files.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const te = new TextEncoder();

// Structure of a book as comparable data: section tree with titles, block types and texts, notes, images, styles.
// lists/code switches: FB2 has no list or code block, so its round trip is compared with lists flattened to
// numbered/bulleted paragraphs and code reduced to its presence.
export function signature(book, { lists = true, code = true } = {}) {
  const blk = (b) => {
    if (b.type === 'list' && !lists) return b.items.flatMap((it, i) => it.map((x) => ['p', (b.ordered ? `${i + 1}. ` : '• ') + blockPlain(x)]));
    if (b.type === 'code' && !code) return ['code'];
    const s = [b.type, blockPlain(b).replace(/\s+/g, ' ').trim()];
    if (b.style) s.push('style:' + b.style);
    return [s];
  };
  const sec = (s) => ({ t: s.title ? titlePlain(s.title) : null, b: s.blocks.flatMap(blk), s: s.sections.map(sec) });
  return {
    title: book.meta.title, authors: book.meta.authors.map((p) => [p.first, p.last].join(' ')), lang: book.meta.lang,
    series: book.meta.series, cover: !!book.meta.cover, front: book.front.flatMap(blk), sections: book.sections.map(sec),
    notes: book.notes.map((n) => [inlineText(n.label), n.blocks.map(blockPlain).join(' | ')]),
    images: Object.values(book.images).map((im) => im.data.length).sort(), styles: book.styles.map((s) => s.id).sort(),
  };
}

const FB2_1251 = `<?xml version="1.0" encoding="windows-1251"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>prose_contemporary</genre><author><first-name>Анна</first-name><last-name>Соколова</last-name></author>
<book-title>Ёлка во дворе</book-title><lang>ru</lang><sequence name="Зимние истории" number="2"/></title-info>
<document-info><author><nickname>test</nickname></author><date>2026</date><id>t-1</id><version>1.0</version></document-info></description>
<body><section id="c1"><title><p>Глава 1</p><p>Снег</p></title><epigraph><p>Зима приходит без стука.</p><text-author>Поговорка</text-author></epigraph>
<p>Утром двор был <emphasis>совсем</emphasis> белым<a l:href="#n1" type="note">1</a>.</p><empty-line/><subtitle>* * *</subtitle>
<poem><stanza><v>Тихо падает снег,</v><v>засыпая скамейки.</v></stanza></poem></section>
<section id="c2"><title><p>Глава 2</p></title><p>Вечером зажгли огни.</p></section></body>
<body name="notes"><section id="n1"><title><p>1</p></title><p>Первый снег в том году выпал рано.</p></section></body>
</FictionBook>`;

// Strict windows-1251 encoder for the Cyrillic range used above.
// Hand-rolled encoder because TextEncoder only produces UTF-8; covers exactly the ranges the fixture uses
// (А..я, Ё, ё) and maps anything else to '?', so a fixture change outside that range is visible.
function cp1251(s) {
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 128) out.push(c);
    else if (c >= 0x410 && c <= 0x44f) out.push(c - 0x410 + 0xc0);
    else if (c === 0x401) out.push(0xa8);
    else if (c === 0x451) out.push(0xb8);
    else out.push(63);
  }
  return Uint8Array.from(out);
}

// An EPUB 2 in the style of older converters: XHTML 1.1 with entities, notes as superscript links into a notes file,
// a chapter split over two files, an NCX with a part and chapters, a cover image named by <meta name="cover">.
async function foreignEpub() {
  const x = (body, title = 'x') => `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><link href="../Styles/s.css" rel="stylesheet" type="text/css"/></head><body>${body}</body></html>`;
  const png = sampleBook().images['lighthouse.png'].data;
  const files = [
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OPS/book.opf', data: `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
<dc:title>The Weather Diary</dc:title><dc:creator opf:role="aut" opf:file-as="Hale, Thomas">Thomas Hale</dc:creator><dc:creator opf:role="trl">Mira Lind</dc:creator><dc:language>en-GB</dc:language><dc:identifier id="uid" opf:scheme="ISBN">978-0-00-000000-2</dc:identifier>
<dc:description>&lt;p&gt;A diary of &lt;b&gt;weather&lt;/b&gt;.&lt;/p&gt;</dc:description><dc:subject>Diaries</dc:subject><meta name="cover" content="cov"/><meta name="calibre:series" content="Seasons"/><meta name="calibre:series_index" content="3.0"/></metadata>
<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="cov" href="Images/cover.png" media-type="image/png"/><item id="css" href="Styles/s.css" media-type="text/css"/>
<item id="c0" href="Text/cover.xhtml" media-type="application/xhtml+xml"/><item id="t" href="Text/title.xhtml" media-type="application/xhtml+xml"/><item id="p1" href="Text/part1.xhtml" media-type="application/xhtml+xml"/>
<item id="c1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/><item id="c1b" href="Text/ch1_split.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="Text/ch2.xhtml" media-type="application/xhtml+xml"/><item id="n" href="Text/notes.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine toc="ncx"><itemref idref="c0"/><itemref idref="t"/><itemref idref="p1"/><itemref idref="c1"/><itemref idref="c1b"/><itemref idref="c2"/><itemref idref="n"/></spine><guide><reference type="cover" href="Text/cover.xhtml"/></guide></package>` },
    { name: 'OPS/toc.ncx', data: `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>The Weather Diary</text></docTitle><navMap>
<navPoint id="a" playOrder="1"><navLabel><text>Spring</text></navLabel><content src="Text/part1.xhtml"/>
<navPoint id="b" playOrder="2"><navLabel><text>Rain in March</text></navLabel><content src="Text/ch1.xhtml"/></navPoint>
<navPoint id="c" playOrder="3"><navLabel><text>April Fog</text></navLabel><content src="Text/ch2.xhtml#top"/></navPoint></navPoint>
<navPoint id="d" playOrder="4"><navLabel><text>Notes</text></navLabel><content src="Text/notes.xhtml"/></navPoint></navMap></ncx>` },
    { name: 'OPS/Styles/s.css', data: 'p { margin: 0 }' },
    { name: 'OPS/Images/cover.png', data: png },
    { name: 'OPS/Text/cover.xhtml', data: x('<div class="cover"><img src="../Images/cover.png" alt="cover"/></div>') },
    { name: 'OPS/Text/title.xhtml', data: x('<h1 class="t">The Weather Diary</h1><p class="a">Thomas Hale</p>') },
    { name: 'OPS/Text/part1.xhtml', data: x('<h1>Part One&nbsp;&mdash; Spring</h1>') },
    { name: 'OPS/Text/ch1.xhtml', data: x('<h2 class="chapter">Rain in March</h2><p class="calibre1">It rained for nine days<sup><a href="notes.xhtml#fn1" id="r1">1</a></sup>, and on the tenth day it rained harder.</p><div class="poem"><p>Rain on the roof,<br/>rain on the road,</p><p>rain on the letter<br/>I never sent.</p></div><p>See <a href="ch2.xhtml#fog">the fog</a>.</p>') },
    { name: 'OPS/Text/ch1_split.xhtml', data: x('<p class="calibre1">The river rose &amp; the bridge &#8212; the old one &#8212; closed.</p>') },
    { name: 'OPS/Text/ch2.xhtml', data: x('<div id="top"><h2>April Fog</h2><p id="fog">The fog came in like a slow tide<sup><a href="notes.xhtml#fn2">2</a></sup>.</p><blockquote><p>Fog is only a cloud that lost its way.</p><p class="attribution">Grandmother</p></blockquote></div>') },
    { name: 'OPS/Text/notes.xhtml', data: x('<h1>Notes</h1><p id="fn1"><a href="ch1.xhtml#r1">1</a> The longest rain since records began.</p><div id="fn2"><p><a href="ch2.xhtml">2</a> Sea fog, locally called “haar”.</p></div>') },
  ];
  return writeZip(files);
}

// tryRun isolates async groups: one throwing round trip is reported as a failure and the rest still run.
// A fixed `now` makes writer output deterministic (timestamps), so repeated runs produce identical files.
export async function run() {
  let pass = 0, fail = 0;
  // First differing path of two JSON values (readable failures of large structures).
  const diffAt = (a, b, p = '') => {
    if (JSON.stringify(a) === JSON.stringify(b)) return null;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = diffAt(a[k], b[k], p + '/' + k); if (d) return d; }
    }
    return `${p || '/'}: ${JSON.stringify(a)?.slice(0, 300)} != ${JSON.stringify(b)?.slice(0, 300)}`;
  };
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}: ${diffAt(got, want)}`); }
  };
  const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${info}`); } };
  const tryRun = async (name, fn) => { try { await fn(); } catch (e) { fail++; console.log(`FAIL ${name}: ${e.stack || e}`); } };
  const now = new Date('2026-10-13T12:00:00Z');

  // --- markup ---
  eq('entities', decodeEntities('&amp;&lt;&nbsp;&mdash;&#8212;&#x41;&unknown;&copy &hellip;&#151;'), '&< ——A&unknown;© …—');
  const broken = parseMarkup('<p>one <b>two</p><p>three &nbsp;<i>four', { html: true });
  eq('tolerant html', textContent(broken), 'one twothree  four');
  eq('tolerant xml', textContent(parseMarkup('<a><b>x</c></b><d>y')), 'xy');
  eq('decode 1251', decodeText(cp1251(FB2_1251)).encoding, 'windows-1251');
  eq('decode utf8 bom', decodeText(Uint8Array.of(0xef, 0xbb, 0xbf, 0x41)).text, 'A');

  // --- model ---
  const junk = normalizeBook({ meta: { title: 5, authors: ['Jane Q. Public', { last: 'Doe' }, null] }, sections: [{ title: [['A']], blocks: [{ type: 'p', c: ['x', 'y', null, { t: 'em', c: [] }] }, { type: 'bogus' }, null] }, 'x'], images: { a: { data: [1, 2] } } });
  eq('normalize junk', [junk.meta.title, junk.meta.authors.map((p) => p.last), junk.sections.length, junk.sections[0].blocks, Object.keys(junk.images)], ['5', ['Public', 'Doe'], 1, [{ type: 'p', c: ['xy'] }], []]);
  const sample = sampleBook();
  const st = bookStats(sample);
  ok('stats', st.words > 800 && st.sections === 6 && st.notes === 3 && st.images === 2, JSON.stringify(st));
  eq('validate sample', validateBook(sample).filter((i) => i.level !== 'info').map((i) => i.code), []);

  // Reader contract: the text content of every rendered unit equals its plain text.
  const units = readingUnits(sample);
  const ctx = renderContext({ marks: false });
  let mism = 0;
  for (const u of units) {
    const html = u.kind === 'title' ? renderTitle(u.lines, 'h2', ctx) : renderBlock(u.block, ctx);
    const tc = textContent(parseMarkup(html, { html: true }));
    if (tc !== u.text) { mism++; if (mism < 4) console.log('  unit', u.k, JSON.stringify(tc), '!=', JSON.stringify(u.text)); }
  }
  eq('render text = blockPlain', mism, 0);
  ok('units', units.length > 30, String(units.length));

  // Editor read-back: rendered blocks parse back to the same blocks.
  const ectx = renderContext({ editable: true, imgSrc: (id) => 'blob:' + id });
  for (const s of [sample.sections[0].sections[0], sample.sections[0].sections[1], sample.sections[1].sections[0], sample.sections[2]]) {
    const html = s.blocks.map((b) => renderBlock(b, ectx)).join('\n');
    const back = normalizeBook({ sections: [{ id: 'x', blocks: blocksFromHTML(html, { styles: new Set(sample.styles.map((x) => x.id)) }) }] }).sections[0].blocks;
    eq('editor round trip ' + s.id, back.map((b) => [b.type, blockPlain(b), b.style || '']), s.blocks.map((b) => [b.type, blockPlain(b), b.style || '']));
  }

  // --- FB2 ---
  await tryRun('fb2', async () => {
    const fb2 = writeFB2(sample, { now });
    const chk = checkFB2(fb2);
    eq('fb2 check', [chk.errors.map(checkText), chk.warnings.map(checkText)], [[], []]);
    const back = readFB2(fb2);
    eq('fb2 round trip', signature(back), signature(sample, { lists: false }));
    eq('fb2 round trip 2', signature(readFB2(writeFB2(back, { now }))), signature(back));
    eq('fb2 meta', [back.meta.subtitle, back.meta.genres, back.meta.subjects, back.meta.rights, back.meta.publisher, back.meta.isbn, back.meta.keywords], [sample.meta.subtitle, sample.meta.genres, sample.meta.subjects, sample.meta.rights, sample.meta.publisher, sample.meta.isbn, sample.meta.keywords]);
    const r = await readBook(cp1251(FB2_1251), 'snow.fb2');
    const b = r.book;
    eq('fb2 1251', [r.format, r.encoding, b.meta.title, b.meta.authors[0].last, b.meta.series, b.sections.length, b.sections[0].blocks.map((x) => x.type), b.notes.map((n) => blockPlain(n.blocks[0]))],
      ['fb2', 'windows-1251', 'Ёлка во дворе', 'Соколова', [{ name: 'Зимние истории', number: '2' }], 2, ['epigraph', 'p', 'empty', 'hr', 'poem'], ['Первый снег в том году выпал рано.']]);
    const zipped = await writeZip([{ name: 'snow.fb2', data: cp1251(FB2_1251) }]);
    const rz = await readBook(zipped, 'snow.fb2.zip');
    eq('fb2.zip', [rz.format, rz.book.meta.title], ['fb2.zip', 'Ёлка во дворе']);
    // Malformed: an unknown entity, a bare ampersand, an unclosed element.
    const bad = FB2_1251.replace('encoding="windows-1251"', 'encoding="utf-8"').replace('<p>Вечером', '<p>A &nbsp; B & C <emphasis>open').replace('огни.</p>', 'огни.</p></p>');
    const bb = readFB2(te.encode(bad));
    ok('fb2 malformed', bb.sections.length === 2 && blockPlain(bb.sections[1].blocks[0]).includes('B & C open'), JSON.stringify(bb.sections[1]));
  });

  // --- EPUB ---
  await tryRun('epub3', async () => {
    const ep = await writeEpub(sample, { now });
    const chk = await checkEpub(ep);
    eq('epub3 check', [chk.version, chk.errors.map(checkText), chk.warnings.map(checkText)], ['3.0', [], []]);
    const back = await readEpub(ep);
    eq('epub3 round trip', signature(back), signature(sample));
    eq('epub3 links', JSON.stringify(back).includes('"href":"#tides"') && JSON.stringify(back).includes('"href":"#ch-1"'), true);
    eq('epub3 meta', [back.meta.subtitle, back.meta.genres, back.meta.subjects, back.meta.translators.length, back.meta.ids[0].value, back.meta.annotation.length], [sample.meta.subtitle, sample.meta.genres, sample.meta.subjects, 0, sample.meta.ids[0].value, 2]);
    eq('epub3 round trip 2', signature(await readEpub(await writeEpub(back, { now }))), signature(back));
    eq('epub detect', detectFormat(ep, 'x.bin'), 'epub');
  });
  await tryRun('epub2', async () => {
    const ep = await writeEpub(sample, { version: 2, now });
    const chk = await checkEpub(ep);
    eq('epub2 check', [chk.version, chk.errors.map(checkText), chk.warnings.map(checkText)], ['2.0', [], []]);
    eq('epub2 round trip', signature(await readEpub(ep)), signature(sample));
  });
  await tryRun('epub foreign', async () => {
    const b = await readEpub(await foreignEpub());
    const sig = signature(b);
    eq('foreign meta', [b.meta.title, b.meta.authors.map((p) => p.first + ' ' + p.last), b.meta.translators.length, b.meta.lang, b.meta.isbn, b.meta.series, b.meta.subjects, b.meta.annotation.map(blockPlain), !!b.meta.cover],
      ['The Weather Diary', ['Thomas Hale'], 1, 'en-GB', '978-0-00-000000-2', [{ name: 'Seasons', number: '3' }], ['Diaries'], ['A diary of weather.'], true]);
    eq('foreign structure', sig.sections.map((s) => [s.t, s.b.length, s.s.map((c) => [c.t, c.b.map((x) => x[0])])]),
      [['Part One — Spring', 0, [['Rain in March', ['p', 'poem', 'p', 'p']], ['April Fog', ['p', 'cite']]]]]);
    eq('foreign notes', sig.notes, [['1', 'The longest rain since records began.'], ['2', 'Sea fog, locally called “haar”.']]);
    const ch1 = b.sections[0].sections[0];
    eq('foreign poem', ch1.blocks[1].stanzas.map((s) => s.lines.length), [2, 2]);
    eq('foreign continuation', blockPlain(ch1.blocks[3]), 'The river rose & the bridge — the old one — closed.');
    const link = ch1.blocks[2].c.find((x) => x.t === 'a');
    eq('foreign link', link && link.href, '#fog');
    eq('foreign cite author', b.sections[0].sections[1].blocks[1].authors.map((a) => inlineText(a)), ['Grandmother']);
  });

  // --- Markdown, text, HTML, JSON ---
  await tryRun('markdown', async () => {
    const md = bookToMarkdown(sample);
    const back = markdownToBook(md);
    const titles = (bk) => bk.sections.map((s) => [titlePlain(s.title || []).replace(/\n/g, ' — '), s.sections.map((c) => titlePlain(c.title || []).replace(/\n/g, ' — '))]);
    eq('md titles', titles(back), titles(sample));
    eq('md meta', [back.meta.title, back.meta.authors.map((p) => p.last), back.meta.series, back.meta.genres, back.meta.lang], [sample.meta.title, ['Wren'], sample.meta.series, sample.meta.genres, 'en']);
    eq('md notes', back.notes.map((n) => blockPlain(n.blocks[0])), sample.notes.map((n) => blockPlain(n.blocks[0])));
    eq('md note refs', JSON.stringify(back.sections).match(/"t":"note"/g).length, 3);
    eq('md epigraph', back.sections[0].sections[1].blocks[0].type, 'epigraph');
    ok('md images', Object.keys(back.images).length === 1, Object.keys(back.images).join());
    eq('md detect', detectFormat(te.encode(md), 'book'), 'markdown');
  });
  await tryRun('text', async () => {
    const txt = 'Зимний сад\nОльга Берёзкина\n\nГлава 1\n\nВ саду было тихо. Снег лежал на ветках.\n\nНикто не приходил.\n\n* * *\n\nПотом пришла весна.\n\nГлава 2\nВесна\n\nДеревья зацвели.\n';
    const r = await readBook(cp1251(txt), 'garden.txt');
    eq('txt', [r.format, r.encoding, r.book.meta.title, r.book.meta.lang, r.book.sections.map((s) => [titlePlain(s.title || []), s.blocks.map((b) => b.type)])],
      ['text', 'windows-1251', 'Зимний сад', 'ru', [['Глава 1', ['p', 'p', 'hr', 'p']], ['Глава 2\nВесна', ['p']]]]);
    const out = bookToText(sample);
    ok('txt export', out.startsWith('The Clockmaker of Saltmarsh\n\nAda Wren') &&out.includes('[1]') && out.includes('The tide goes out to fetch the moon,'));
  });
  await tryRun('html', async () => {
    const html = '<!doctype html><html lang="fr"><head><title>Le Phare</title><meta name="author" content="Jean Valmy"></head><body><h1>Le Phare</h1><blockquote><p>La mer attend.</p></blockquote>'
      + '<h2>Un</h2><p>Il pleuvait<sup><a href="#fn1" id="r1">1</a></sup>.<br>Encore.</p><h2>Deux</h2><p>Le soleil <em>enfin</em>.</p><ul><li>a</li><li>b</li></ul>'
      + '<aside id="fn1" role="doc-footnote"><p><a href="#r1">↩</a> Beaucoup.</p></aside><img src="data:image/png;base64,' + Buffer.from(sample.images['cover.png'].data).toString('base64') + '" alt="x"></body></html>';
    const b = htmlToBook(html, { name: 'x' });
    eq('html import', [b.meta.title, b.meta.lang, b.meta.authors[0].last, b.front.map((x) => x.type), b.sections.map((s) => [titlePlain(s.title), s.blocks.map((x) => x.type)]), b.notes.map((n) => blockPlain(n.blocks[0])), Object.keys(b.images).length],
      ['Le Phare', 'fr', 'Valmy', ['epigraph'], [['Un', ['p']], ['Deux', ['p', 'list', 'image']]], ['Beaucoup.'], 1]);
    const out = await writeBook(sample, 'html');
    const back = htmlToBook(out.data);
    eq('html round trip titles', back.sections.map((s) => titlePlain(s.title || [])), sample.sections.map((s) => titlePlain(s.title)));
    eq('html round trip notes', back.notes.length, 3);
  });
  await tryRun('json', async () => {
    eq('json round trip', signature(fromJSON(toJSON(sample))), signature(sample));
    for (const f of ['epub', 'epub2', 'fb2', 'fb2.zip', 'markdown', 'html', 'text', 'json']) {
      const w = await writeBook(sample, f, { now, fileName: 'sample' });
      const bytes = typeof w.data === 'string' ? te.encode(w.data) : w.data;
      const r = await readBook(bytes, 'sample.' + w.ext);
      ok('write/read ' + f, r.book.meta.title === sample.meta.title && r.book.sections.length >= 3, `${r.format} ${r.book.meta.title} ${r.book.sections.length}`);
    }
  });

  // --- search, validation, covers ---
  const res = searchUnits(units, 'lighthouse');
  ok('search', res.length >= 3 && res.every((r) => /lighthouse/i.test(r.match)), String(res.length));
  eq('search whole word', searchUnits(units, 'tide', { wholeWord: true }).every((r) => r.match.toLowerCase() === 'tide'), true);
  eq('search ё', searchUnits([{ k: 0, text: 'Ёлка и елка' }], 'елка').length, 2);
  eq('search spans lines', searchUnits([{ k: 0, text: 'end of\nline' }], 'of line').length, 1);
  const broken2 = normalizeBook({ meta: { title: '', lang: 'english language' }, sections: [{ id: 'a', blocks: [{ type: 'p', c: [{ t: 'note', ref: 'nx', c: ['1'] }, { t: 'a', href: '#nowhere', c: ['x'] }, { t: 'img', src: 'none' }] }] }], notes: [{ id: 'n9', blocks: [] }] });
  eq('validate broken', validateBook(broken2).map((i) => i.code).sort(), ['badLang', 'brokenLink', 'emptyNote', 'missingImage', 'missingNote', 'noAnnotation', 'noAuthor', 'noCover', 'noGenre', 'noTitle', 'unusedNote']);
  let bad = 0;
  for (const d of COVER_DESIGNS) for (const p of Object.keys(COVER_PALETTES)) {
    try { parseXML(coverSVG({ title: 'A <long> title & “quotes” that wraps over several lines', subtitle: 'Sub', author: 'Ann O’Neil', series: 'S #1', design: d, palette: p })); } catch (e) { bad++; console.log('  cover', d, p, e.message); }
  }
  eq('covers well-formed', bad, 0);

  // Performance smoke test: 6000 paragraphs through FB2 and EPUB both ways under a generous 15 s bound. It guards
  // against accidental quadratic behaviour (e.g. repeated array scans per block), not against small slowdowns.
  // --- size ---
  await tryRun('large', async () => {
    const big = normalizeBook({ meta: { title: 'Big', authors: [{ first: 'A', last: 'B' }] }, sections: Array.from({ length: 40 }, (_, i) => ({ id: 'c' + i, title: [['Chapter ' + (i + 1)]], blocks: Array.from({ length: 150 }, (_, k) => ({ type: 'p', c: [`Paragraph ${k} of chapter ${i}: `, { t: 'em', c: ['lorem ipsum dolor sit amet'] }, ' consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.'] })) })) });
    const t0 = Date.now();
    const fb2 = writeFB2(big, { now });
    const b1 = readFB2(fb2);
    const ep = await writeEpub(big, { now });
    const b2 = await readEpub(ep);
    const ms = Date.now() - t0;
    ok('large round trip', b1.sections.length === 40 && b2.sections.length === 40 && b2.sections[39].blocks.length === 150 && ms < 15000, `${ms} ms`);
  });

  console.log(`book: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
