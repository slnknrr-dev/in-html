// bookmarks/test.js - unit tests of the bookmark library: `node bookmarks/test.js` (importing the module runs nothing).
// Clocks and records (merge laws), the library API, URL normal forms, every import format with hand-written samples
// of real exports (Chrome, Firefox, Pinboard, Pocket, Raindrop, Instapaper, broken nesting, windows-1251), export
// round trips, the search language, duplicates, Atom feeds, page metadata, IP address classes, and property tests:
// several clients edit concurrently in random orders and every replica converges.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClock, isStamp, parseStamp, newId } from './clock.js';
import { cloneRecord, deleteRecord, mergeRecord, newRecord, sanitizeRecord, setFields, valueOf } from './record.js';
import { Library, mergedFields } from './library.js';
import { cleanURL, displayURL, findURLs, hostOf, isLinkable, parseUserURL, titleFromURL, urlKey } from './url.js';
import { detectFormat, parseImport, toTime } from './import.js';
import { toCSV, toJSONBackup, toMarkdown, toNetscape } from './export.js';
import { compileQuery, parseDateTerm, parseQuery, searchItems, suggest, tagCloud } from './search.js';
import { syncLog } from './sync.js';
import { tagURI, toAtom } from './atom.js';
import { extractMeta, pickIcon, charsetOf } from './meta.js';
import { classifyIP, isPublicIP, parseIPv6 } from './address.js';
import { parseXML, root, children, child, textOf, attr } from '../xml/xml.js';
import { seededRandom } from '../prng/prng.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// --- hand-written samples of real exports ------------------------------------------------------------------------------

const CHROME_HTML = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000100" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://developer.mozilla.org/en-US/" ADD_DATE="1700000001" ICON="data:image/png;base64,iVBORw0KGgo=">MDN Web Docs</A>
        <DT><H3 ADD_DATE="1700000002" LAST_MODIFIED="1700000003">Dev &amp; Tools</H3>
        <DL><p>
            <DT><A HREF="https://github.com/" ADD_DATE="1700000004">GitHub</A>
            <DT><A HREF="https://nodejs.org/api/" ADD_DATE="1700000005">Node.js &#8212; API</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://example.com/?utm_source=x&amp;id=1" ADD_DATE="1700000006">Example</A>
</DL><p>
`;

const FIREFOX_HTML = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'none'; img-src data: *; object-src 'none'"></meta>
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks Menu</H1>

<DL><p>
    <DT><A HREF="place:parent=menu________&type=6" ADD_DATE="1700000000">Recent Tags</A>
    <HR>    <DT><A HREF="https://www.mozilla.org/en-US/firefox/" ADD_DATE="1700000010" LAST_MODIFIED="1700000011" TAGS="browser,mozilla">Firefox</A>
    <DD>The browser from Mozilla
    <DT><H3 ADD_DATE="1700000012" LAST_MODIFIED="1700000013" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks Toolbar</H3>
    <DL><p>
        <DT><A HREF="https://news.ycombinator.com/" ADD_DATE="1700000014" SHORTCUTURL="hn">Hacker News</A>
    </DL><p>
    <DT><H3 ADD_DATE="1700000015" UNFILED_BOOKMARKS_FOLDER="true">Other Bookmarks</H3>
    <DL><p>
    </DL><p>
</DL>
`;

const PINBOARD_HTML = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Pinboard Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p><DT><A HREF="https://pinboard.in/" ADD_DATE="1600000000" PRIVATE="0" TOREAD="1" TAGS="bookmarking,tools">Pinboard</A>
<DD>Social bookmarking
for introverts.
<DT><A HREF="https://example.org/private" ADD_DATE="1600000100" PRIVATE="1" TOREAD="0" TAGS="">Private one</A>
</DL></p>
`;

const POCKET_HTML = `<!DOCTYPE html>
<html>
	<!--So long and thanks for all the fish-->
	<head>
		<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
		<title>Pocket Export</title>
	</head>
	<body>
		<h1>Unread</h1>
		<ul>
			<li><a href="https://example.com/article-one" time_added="1650000000" tags="reading,longform">Article One</a></li>
		</ul>

		<h1>Read Archive</h1>
		<ul>
			<li><a href="https://example.com/article-two" time_added="1640000000" tags="">Article Two</a></li>
		</ul>
	</body>
</html>
`;

const BROKEN_HTML = `<DL><p>
<DT><H3>Unclosed</H3>
<DL><p>
<DT><A HREF="https://a.example/">A</A>
<DT><H3>Empty no DL</H3>
<DT><A HREF="https://b.example/">B
<DT><A HREF="https://c.example/">C &amp; <b>bold</b></A>
</DL>
</DL>
</DL>
<DT><A HREF="https://d.example/">D</A>
<DT><A>no href</A>
`;

const CHROME_JSON = `{
   "checksum": "0123456789abcdef0123456789abcdef",
   "roots": {
      "bookmark_bar": {
         "children": [ {
            "date_added": "13340000000000000",
            "date_last_used": "0",
            "guid": "8f1b5c1e-0000-4000-8000-000000000001",
            "id": "5",
            "meta_info": { "power_bookmark_meta": "" },
            "name": "Wikipedia",
            "type": "url",
            "url": "https://www.wikipedia.org/"
         }, {
            "children": [ {
               "date_added": "13340000001000000",
               "guid": "8f1b5c1e-0000-4000-8000-000000000003",
               "id": "7",
               "name": "Rust",
               "type": "url",
               "url": "https://www.rust-lang.org/"
            } ],
            "date_added": "13340000000500000",
            "date_modified": "13340000001000000",
            "guid": "8f1b5c1e-0000-4000-8000-000000000002",
            "id": "6",
            "name": "Languages",
            "type": "folder"
         } ],
         "date_added": "13330000000000000",
         "date_modified": "0",
         "guid": "0bc5d13f-2cba-5d74-951f-3f233fe6c908",
         "id": "1",
         "name": "Bookmarks bar",
         "type": "folder"
      },
      "other": { "children": [ ], "date_added": "13330000000000000", "date_modified": "0", "guid": "82b081ec-3dd3-529c-8475-ab6c344590dd", "id": "2", "name": "Other bookmarks", "type": "folder" },
      "synced": { "children": [ ], "date_added": "13330000000000000", "date_modified": "0", "guid": "4cf2e351-0e85-532b-bb37-df045d8f8d0f", "id": "3", "name": "Mobile bookmarks", "type": "folder" }
   },
   "version": 1
}
`;

const FIREFOX_JSON = '{"guid":"root________","title":"","index":0,"dateAdded":1690000000000000,"lastModified":1690000000000000,"id":1,"typeCode":2,"type":"text/x-moz-place-container","root":"placesRoot","children":[' +
  '{"guid":"menu________","title":"menu","index":0,"dateAdded":1690000000000000,"lastModified":1690000000000000,"id":2,"typeCode":2,"type":"text/x-moz-place-container","root":"bookmarksMenuFolder","children":[' +
  '{"guid":"abcdefghijkl","title":"Mozilla","index":0,"dateAdded":1690000001000000,"lastModified":1690000002000000,"id":10,"typeCode":1,"tags":"web,browser","type":"text/x-moz-place","uri":"https://www.mozilla.org/"},' +
  '{"guid":"separator001","title":"","index":1,"dateAdded":1690000003000000,"lastModified":1690000003000000,"id":11,"typeCode":3,"type":"text/x-moz-place-separator"},' +
  '{"guid":"folder000001","title":"Reading","index":2,"dateAdded":1690000004000000,"lastModified":1690000004000000,"id":12,"typeCode":2,"type":"text/x-moz-place-container","children":[' +
  '{"guid":"smartbm00001","title":"Smart","index":0,"dateAdded":1690000005000000,"lastModified":1690000005000000,"id":13,"typeCode":1,"type":"text/x-moz-place","uri":"place:sort=8&maxResults=10"},' +
  '{"guid":"mdn000000001","title":"MDN","index":1,"dateAdded":1690000006000000,"lastModified":1690000006000000,"id":14,"typeCode":1,"type":"text/x-moz-place","uri":"https://developer.mozilla.org/","keyword":"mdn"}]}]},' +
  '{"guid":"toolbar_____","title":"toolbar","index":1,"dateAdded":1690000000000000,"lastModified":1690000000000000,"id":3,"typeCode":2,"type":"text/x-moz-place-container","root":"toolbarFolder","children":[]},' +
  '{"guid":"unfiled_____","title":"unfiled","index":3,"dateAdded":1690000000000000,"lastModified":1690000000000000,"id":5,"typeCode":2,"type":"text/x-moz-place-container","root":"unfiledBookmarksFolder"}]}';

const PINBOARD_JSON = '[{"href":"https:\\/\\/pinboard.in\\/","description":"Pinboard","extended":"Bookmarking for introverts","meta":"0a1b","hash":"2c3d","time":"2020-01-02T03:04:05Z","shared":"no","toread":"yes","tags":"tools bookmarking"},' +
  '{"href":"https:\\/\\/example.net\\/","description":"Example","extended":"","meta":"4e5f","hash":"6a7b","time":"2021-02-03T04:05:06Z","shared":"yes","toread":"no","tags":""}]';

const RAINDROP_CSV = `id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite
123,"Example, Inc",My note,An excerpt,https://example.com/,Work / Projects,"design, ux",2023-05-01T10:00:00.000Z,,,true
124,Second,,,https://example.org/page,Unsorted,,2023-05-02T10:00:00.000Z,,,false
`;

const INSTAPAPER_CSV = `URL,Title,Selection,Folder,Timestamp,Tags
https://example.com/a,Article A,,Unread,1680000000,[]
https://example.com/b,Article B,Quote here,Archive,1680000100,"[""x""]"
https://example.com/c,Article C,,Tech,1680000200,
`;

const GENERIC_CSV = `Link;Name;Labels;Starred
https://one.example/;One;a|b;yes
https://two.example/;Two;;no
`;

const URL_LIST = `# my links
https://one.example/
Some title https://two.example/path
www.three.example
not a url
<https://four.example/x>
`;

const MARKDOWN = `# Bookmarks

- [Alpha](https://alpha.example/) — first link #news #tech

## Work / Projects

- [Beta \\[draft\\]](https://beta.example/a_b) #design
* <https://gamma.example/>

### Sub

1. [Delta](https://delta.example/ "the title") some notes
`;

// windows-1251 bytes of a Netscape file with a meta charset (no UTF-8).
function cp1251(text) {
  const out = [];
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c >= 0x410 && c <= 0x44f) out.push(0xc0 + c - 0x410);
    else if (c === 0x401) out.push(0xa8);
    else if (c === 0x451) out.push(0xb8);
    else out.push(0x3f);
  }
  return new Uint8Array(out);
}
const CP1251_HTML = cp1251(`<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=windows-1251">
<TITLE>Закладки</TITLE>
<DL><p>
<DT><H3>Новости</H3>
<DL><p>
<DT><A HREF="https://example.ru/" ADD_DATE="1500000000">Пример ёлки</A>
</DL><p>
</DL><p>
`);

// --- runner ---------------------------------------------------------------------------------------------------------------

// JSON with sorted object keys: replicas may hold the same fields in another insertion order.
const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));

// Replication properties are tested the way they are specified: the same edits applied in shuffled orders and
// with duplicates must produce identical records (commutative, idempotent merge), plus round-trips through every
// import/export format.
export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (canon(got) === canon(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond, info) => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== undefined ? ': ' + JSON.stringify(info).slice(0, 600) : ''}`); } };

  // --- clock -------------------------------------------------------------------------------------------------------------
  {
    let now = 1700000000000;
    const c = createClock('abc', () => now);
    const s1 = c.next(), s2 = c.next();
    ok('clock: stamps grow within one ms', s1 < s2 && isStamp(s1) && isStamp(s2), [s1, s2]);
    now -= 5000;
    const s3 = c.next();
    ok('clock: monotonic when the wall clock goes back', s3 > s2, [s2, s3]);
    c.observe(createClock('zzz', () => now + 60000).next());
    const s4 = c.next();
    ok('clock: observe moves past remote stamps', parseStamp(s4).t >= now + 60000, s4);
    eq('clock: parse', parseStamp(s1), { t: 1700000000000, c: 0, client: 'abc' });
    ok('ids: 12 chars, letter first', /^[a-z][a-z0-9]{11}$/.test(newId()));
  }

  // --- records ----------------------------------------------------------------------------------------------------------
  {
    const a = createClock('a', () => 1000), b = createClock('b', () => 1000);
    const r1 = newRecord('bookmark', 'x1');
    setFields(r1, { url: 'https://e.example/', title: 'T', tags: ['A', 'a', ' #b ', 'c,d'] }, a.next());
    eq('record: tags cleaned', r1.v.tags, ['A', 'b', 'c d']);
    const r2 = cloneRecord(r1);
    setFields(r1, { title: 'from a' }, a.next());
    setFields(r2, { notes: 'from b' }, b.next());
    const m1 = cloneRecord(r1); mergeRecord(m1, r2);
    const m2 = cloneRecord(r2); mergeRecord(m2, r1);
    eq('record: merge is commutative', m1, m2);
    eq('record: concurrent edits of different fields survive', [m1.v.title, m1.v.notes], ['from a', 'from b']);
    const m3 = cloneRecord(m1); eq('record: merge is idempotent', mergeRecord(m3, m1), false);
    const d = cloneRecord(m1);
    deleteRecord(d, b.next());
    eq('record: tombstone keeps no values', Object.keys(d.v), ['del']);
    const late = cloneRecord(r1); setFields(late, { title: 'old edit' }, '00000000r.0000.a');
    const d2 = cloneRecord(d); mergeRecord(d2, late);
    eq('record: older edits do not come back after a delete', Object.keys(d2.v), ['del']);
    const newer = cloneRecord(m1); setFields(newer, { title: 'newer' }, createClock('c', () => 99999).next());
    const d3 = cloneRecord(d); mergeRecord(d3, newer);
    const d4 = cloneRecord(newer); mergeRecord(d4, d);
    eq('record: delete + newer edit converge', d3, d4);
    eq('record: sanitize drops junk', sanitizeRecord({ id: 'ok_1', type: 'bookmark', v: { url: 5, title: 'x', evil: 1 }, s: { url: a.next(), title: a.next(), evil: a.next() } }).v, { title: 'x' });
    eq('record: sanitize refuses bad ids', sanitizeRecord({ id: '../x', type: 'bookmark', v: {}, s: {} }), null);
    eq('record: icon must be an image data URL', sanitizeRecord({ id: 'i', type: 'bookmark', v: { icon: 'javascript:alert(1)' }, s: { icon: a.next() } }).v, {});
  }

  // --- URLs --------------------------------------------------------------------------------------------------------------
  {
    eq('url: scheme added', parseUserURL('example.com/a b'), null);
    eq('url: host only', parseUserURL('example.com'), 'https://example.com/');
    eq('url: host with port', parseUserURL('example.com:8080/x'), 'https://example.com:8080/x');
    eq('url: localhost', parseUserURL('localhost:3000'), 'http://localhost:3000/');
    eq('url: keeps absolute', parseUserURL('HTTP://Example.COM:80/A?b=1#c'), 'http://example.com/A?b=1#c');
    eq('url: IDN becomes Punycode', parseUserURL('https://bücher.example/straße'), 'https://xn--bcher-kva.example/stra%C3%9Fe');
    eq('url: not a URL', parseUserURL('hello world'), null);
    eq('url: clean drops tracking', cleanURL('https://e.example/p?utm_source=a&id=2&fbclid=x&gclid=y&mc_eid=z'), 'https://e.example/p?id=2');
    eq('url: clean keeps other schemes', cleanURL('mailto:a@b.example'), 'mailto:a@b.example');
    const k = (u, o) => urlKey(u, o);
    eq('key: case, default port, slash, sorted query, fragment',
      k('HTTPS://WWW.Example.com:443/a/b/?z=1&a=2&utm_medium=x#top'), 'https://www.example.com/a/b?a=2&z=1');
    eq('key: same pages', [k('https://example.com'), k('https://example.com/'), k('https://example.com/#x')], ['https://example.com', 'https://example.com', 'https://example.com']);
    eq('key: route fragments are kept', k('https://app.example/#/inbox'), 'https://app.example#/inbox');
    eq('key: keepFragment', k('https://e.example/a#sec', { keepFragment: true }), 'https://e.example/a#sec');
    eq('key: ignoreScheme / ignoreWww', k('http://www.e.example/a', { ignoreScheme: true, ignoreWww: true }), k('https://e.example/a', { ignoreScheme: true, ignoreWww: true }));
    eq('key: unreserved escapes', k('https://e.example/%7Euser/%41'), 'https://e.example/~user/A');
    eq('key: IDN and Punycode agree', k('https://bücher.example/'), k('https://xn--bcher-kva.example'));
    eq('host: Unicode, no www', hostOf('https://www.xn--bcher-kva.example/x'), 'bücher.example');
    eq('display: decoded', displayURL('https://xn--bcher-kva.example/stra%C3%9Fe?q=%D0%B0'), 'bücher.example/straße?q=а');
    eq('linkable', [isLinkable('https://a'), isLinkable('javascript:alert(1)'), isLinkable('data:text/html,x'), isLinkable('mailto:x')], [true, false, false, true]);
    eq('title from URL', titleFromURL('https://blog.example/2024/05/my-great-article.html'), 'My great article – blog.example');
    eq('title from URL: host', titleFromURL('https://www.example.com/'), 'example.com');
    eq('find URLs', findURLs('see (https://a.example/x_(y)), and www.b.example. Done'), ['https://a.example/x_(y)', 'https://www.b.example/']);
  }

  // --- import -------------------------------------------------------------------------------------------------------------
  {
    const c = parseImport(CHROME_HTML, { name: 'bookmarks_10_13_26.html' });
    eq('chrome html: format', c.format, 'netscape');
    eq('chrome html: items', c.items.map((i) => [i.title, i.folder.join('/'), i.created]), [
      ['MDN Web Docs', 'Bookmarks bar', 1700000001000], ['GitHub', 'Bookmarks bar/Dev & Tools', 1700000004000],
      ['Node.js — API', 'Bookmarks bar/Dev & Tools', 1700000005000], ['Example', '', 1700000006000]]);
    eq('chrome html: icon and decoded href', [c.items[0].icon, c.items[3].url], ['data:image/png;base64,iVBORw0KGgo=', 'https://example.com/?utm_source=x&id=1']);
    eq('chrome html: folders', c.folders.map((f) => f.join('/')), ['Bookmarks bar', 'Bookmarks bar/Dev & Tools']);

    const f = parseImport(FIREFOX_HTML);
    eq('firefox html: place: skipped, tags, description', f.items.map((i) => [i.title, i.tags, i.notes, i.folder.join('/')]), [
      ['Firefox', ['browser', 'mozilla'], 'The browser from Mozilla', ''], ['Hacker News', [], '', 'Bookmarks Toolbar']]);
    eq('firefox html: empty folder kept', f.folders.map((x) => x.join('/')), ['Bookmarks Toolbar', 'Other Bookmarks']);
    eq('firefox html: warning', f.warnings, [{ code: 'skipped', count: 1 }]);

    const p = parseImport(PINBOARD_HTML);
    eq('pinboard html', p.items.map((i) => [i.title, i.public, i.unread, i.tags, i.notes]), [
      ['Pinboard', true, true, ['bookmarking', 'tools'], 'Social bookmarking\nfor introverts.'], ['Private one', false, false, [], '']]);

    const pk = parseImport(POCKET_HTML, { name: 'ril_export.html' });
    eq('pocket html', pk.items.map((i) => [i.title, i.unread, i.archived, i.tags, i.created]), [
      ['Article One', true, false, ['reading', 'longform'], 1650000000000], ['Article Two', false, true, [], 1640000000000]]);

    const br = parseImport(BROKEN_HTML, { format: 'netscape' });
    eq('broken nesting: items', br.items.map((i) => [i.title, i.folder.join('/')]), [['A', 'Unclosed'], ['B', 'Unclosed'], ['C & bold', 'Unclosed'], ['D', '']]);
    eq('broken nesting: folders', br.folders.map((x) => x.join('/')), ['Unclosed', 'Unclosed/Empty no DL']);

    const cy = parseImport(CP1251_HTML);
    eq('windows-1251 via meta charset', [cy.items[0].title, cy.items[0].folder, cy.encoding], ['Пример ёлки', ['Новости'], 'windows-1251']);
    const bom = parseImport(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('https://bom.example/')]));
    eq('UTF-8 BOM', bom.items.map((i) => i.url), ['https://bom.example/']);

    const cj = parseImport(CHROME_JSON, { name: 'Bookmarks' });
    eq('chrome json', [cj.format, cj.items.map((i) => [i.title, i.folder.join('/'), i.created])], ['chrome', [
      ['Wikipedia', 'Bookmarks bar', 1695526400000], ['Rust', 'Bookmarks bar/Languages', 1695526401000]]]);
    eq('chrome json: empty roots are folders', cj.folders.map((x) => x.join('/')), ['Bookmarks bar', 'Bookmarks bar/Languages', 'Other bookmarks', 'Mobile bookmarks']);

    const fj = parseImport(FIREFOX_JSON, { name: 'bookmarks-2026-10-13.json' });
    eq('firefox json', [fj.format, fj.items.map((i) => [i.title, i.folder.join('/'), i.tags, i.created])], ['firefox', [
      ['Mozilla', 'Bookmarks Menu', ['web', 'browser'], 1690000001000], ['MDN', 'Bookmarks Menu/Reading', [], 1690000006000]]]);

    const pj = parseImport(PINBOARD_JSON);
    eq('pinboard json', [pj.format, pj.items.map((i) => [i.url, i.title, i.notes, i.tags, i.public, i.unread, i.created])], ['pinboard', [
      ['https://pinboard.in/', 'Pinboard', 'Bookmarking for introverts', ['tools', 'bookmarking'], false, true, Date.UTC(2020, 0, 2, 3, 4, 5)],
      ['https://example.net/', 'Example', '', [], true, false, Date.UTC(2021, 1, 3, 4, 5, 6)]]]);

    const rd = parseImport(RAINDROP_CSV, { name: 'raindrop.csv' });
    eq('raindrop csv', rd.items.map((i) => [i.title, i.notes, i.folder, i.tags, i.fav, i.created]), [
      ['Example, Inc', 'My note', ['Work', 'Projects'], ['design', 'ux'], true, Date.UTC(2023, 4, 1, 10)],
      ['Second', '', [], [], false, Date.UTC(2023, 4, 2, 10)]]);

    const ip = parseImport(INSTAPAPER_CSV, { name: 'instapaper-export.csv' });
    eq('instapaper csv', ip.items.map((i) => [i.title, i.notes, i.unread, i.archived, i.folder, i.tags, i.created]), [
      ['Article A', '', true, false, [], [], 1680000000000], ['Article B', 'Quote here', false, true, [], ['x'], 1680000100000],
      ['Article C', '', false, false, ['Tech'], [], 1680000200000]]);

    const gc = parseImport(GENERIC_CSV, { name: 'links.csv' });
    eq('generic csv: guessed mapping', [gc.mapping.url, gc.mapping.title, gc.mapping.tags, gc.mapping.fav], ['Link', 'Name', 'Labels', 'Starred']);
    eq('generic csv: items', gc.items.map((i) => [i.url, i.title, i.tags, i.fav]), [['https://one.example/', 'One', ['a', 'b'], true], ['https://two.example/', 'Two', [], false]]);
    const gm = parseImport(GENERIC_CSV, { name: 'links.csv', mapping: { title: '', notes: 'Name' } });
    eq('csv: explicit mapping', gm.items.map((i) => [i.title, i.notes]), [['', 'One'], ['', 'Two']]);
    const nh = parseImport('https://a.example/,Title A\nhttps://b.example/,Title B\n', { format: 'csv' });
    eq('csv without header', nh.items.map((i) => [i.url, i.title]), [['https://a.example/', 'Title A'], ['https://b.example/', 'Title B']]);

    const ul = parseImport(URL_LIST, { name: 'links.txt' });
    eq('url list', [ul.format, ul.items.map((i) => [i.url, i.title])], ['urls', [['https://one.example/', ''], ['https://two.example/path', 'Some title'],
      ['https://www.three.example/', ''], ['https://four.example/x', '']]]);

    const md = parseImport(MARKDOWN, { name: 'links.md' });
    eq('markdown', md.items.map((i) => [i.title, i.url, i.folder.join('/'), i.tags, i.notes]), [
      ['Alpha', 'https://alpha.example/', '', ['news', 'tech'], 'first link'],
      ['Beta [draft]', 'https://beta.example/a_b', 'Work/Projects', ['design'], ''],
      ['', 'https://gamma.example/', 'Work/Projects', [], ''],
      ['Delta', 'https://delta.example/', 'Work/Projects/Sub', [], 'some notes']]);

    eq('detect', [detectFormat(CHROME_HTML), detectFormat(CHROME_JSON), detectFormat(FIREFOX_JSON), detectFormat(PINBOARD_JSON), detectFormat(RAINDROP_CSV, 'x.csv'),
      detectFormat(MARKDOWN), detectFormat(URL_LIST), detectFormat('[{"url":"https://a.example/","title":"x"}]')],
    ['netscape', 'chrome', 'firefox', 'pinboard', 'csv', 'markdown', 'urls', 'json']);
    const lj = parseImport('{"count":1,"results":[{"url":"https://l.example/","title":"L","description":"d","notes":"n","tag_names":["x","y"],"is_archived":true,"unread":false,"shared":true,"date_added":"2024-01-01T00:00:00Z"}]}');
    eq('linkding json page', lj.items.map((i) => [i.url, i.title, i.notes, i.tags, i.archived, i.public, i.created]), [['https://l.example/', 'L', 'd\n\nn', ['x', 'y'], true, true, Date.UTC(2024, 0, 1)]]);
    eq('times', [toTime('1700000000'), toTime(1700000000123), toTime('1700000000123456'), toTime('2020-01-01T00:00:00Z'), toTime('')], [1700000000000, 1700000000123, 1700000000123, 1577836800000, 0]);
    eq('bad json is a warning', parseImport('{"roots": ', { format: 'chrome' }).warnings[0].code, 'error');
  }

  // --- library ----------------------------------------------------------------------------------------------------------------
  let lib;
  {
    let now = 1700000000000;
    lib = new Library({ client: 'test', now: () => now });
    const events = [];
    lib.on((c) => events.push(c.records.length));
    const dev = lib.addFolder({ name: 'Dev' });
    const js = lib.addFolder({ name: 'JS', parent: dev.id });
    const a = lib.add({ url: 'https://developer.mozilla.org/', title: 'MDN', tags: ['docs', 'web'], folder: js.id, unread: true });
    now += 1000;
    const b = lib.add({ url: 'https://nodejs.org/', title: 'Node.js', tags: ['js', 'Docs'], folder: dev.id, fav: true, public: true });
    now += 1000;
    const c = lib.add({ url: 'https://www.nodejs.org/?utm_source=x', title: 'Node again', tags: ['runtime'], notes: 'dup' });
    eq('library: events', events, [1, 1, 1, 1, 1]);
    eq('library: tree paths', [lib.tree().pathString(js.id), lib.folderCount(dev.id), lib.folderCount(dev.id, false), lib.folderCount('')], ['Dev/JS', 2, 1, 3]);
    eq('library: tags case-insensitive', lib.tags(), [{ tag: 'docs', count: 2 }, { tag: 'js', count: 1 }, { tag: 'runtime', count: 1 }, { tag: 'web', count: 1 }]);
    eq('library: stats', lib.stats(), { all: 3, unread: 1, fav: 1, archived: 0, untagged: 0, public: 1, total: 3 });
    eq('library: move into own subfolder refused', lib.moveFolder(dev.id, js.id), false);
    eq('library: duplicates (www, tracking)', lib.duplicates({ ignoreWww: true }).map((g) => g.items.map((x) => x.title)), [['Node.js', 'Node again']]);
    eq('library: no duplicates without ignoreWww', lib.duplicates().length, 0);
    const snap = lib.mergeGroup([b.id, c.id], b.id);
    eq('library: merged', [lib.get(b.id).tags, lib.get(b.id).notes, lib.get(c.id)], [['js', 'Docs', 'runtime'], 'dup', null]);
    lib.restore(snap);
    eq('library: merge undone', [lib.get(b.id).tags, lib.get(c.id) && lib.get(c.id).title], [['js', 'Docs'], 'Node again']);
    eq('library: rename tag merges case-insensitively', [lib.renameTag('DOCS', 'reference'), lib.get(a.id).tags, lib.get(b.id).tags], [2, ['reference', 'web'], ['js', 'reference']]);
    eq('library: merge tags', [lib.mergeTags(['js', 'web'], 'reference'), lib.get(a.id).tags, lib.get(b.id).tags], [2, ['reference'], ['reference']]);
    lib.addTags([a.id, c.id], ['later', '#x']);
    lib.deleteTag('x');
    eq('library: add / delete tags', [lib.get(a.id).tags, lib.get(c.id).tags], [['reference', 'later'], ['runtime', 'later']]);
    const removed = lib.removeFolder(dev.id);
    eq('library: folder removal takes its contents', [removed.length, lib.bookmarks().length, lib.folders().length], [4, 1, 0]);
    lib.restore(removed);
    eq('library: folder restored with contents', [lib.bookmarks().length, lib.tree().pathString(lib.get(a.id).folder)], [3, 'Dev/JS']);
    const del = lib.remove([c.id]);
    eq('library: delete / undo', [lib.get(c.id), (lib.restore(del), lib.get(c.id).title)], [null, 'Node again']);
    eq('library: update sets modified', (now += 5000, lib.update(a.id, { title: 'MDN Web Docs' }), lib.get(a.id).modified), now);
    eq('library: mark read keeps modified', (now += 5000, lib.update(a.id, { unread: false }), lib.get(a.id).modified), now - 5000);

    // Import into the library: duplicates skipped / merged, folders created once.
    const data = parseImport(CHROME_HTML);
    const pv = lib.previewImport(data, { duplicates: 'skip' });
    eq('import preview', [pv.total, pv.added, pv.duplicates, pv.folders], [4, 4, 0, 2]);
    const r1 = lib.importItems(data, { duplicates: 'skip' });
    eq('import: added', [r1.added, r1.skipped, lib.bookmarks().length, lib.folders().filter((x) => x.name === 'Bookmarks bar').length], [4, 0, 7, 1]);
    eq('import: tracking parameters removed', lib.get(r1.ids[3]).url, 'https://example.com/?id=1');
    const r2 = lib.importItems(data, { duplicates: 'skip' });
    eq('import again: all skipped', [r2.added, r2.skipped], [0, 4]);
    const tagged = { items: [{ ...data.items[1], tags: ['git'], notes: 'code hosting' }], folders: [] };
    const r3 = lib.importItems(tagged, { duplicates: 'merge' });
    const gh = lib.bookmarks().find((x) => x.url === 'https://github.com/');
    eq('import merge fills fields', [r3.merged, gh.tags, gh.notes], [1, ['git'], 'code hosting']);
    lib.restore(r3.snapshot);
    lib.restore(r1.snapshot);
    eq('import undone', [lib.bookmarks().length, lib.folders().length], [3, 2]);
    eq('merged fields', mergedFields({ title: '', url: 'u', notes: 'a', tags: ['x'], created: 5, fav: false, unread: true, public: true, archived: false, icon: '' },
      [{ title: 'T', url: 'u', notes: 'b', tags: ['X', 'y'], created: 3, fav: true, unread: false, public: false, archived: false, icon: 'data:image/png;base64,AA==' }]),
    { title: 'T', notes: 'a\n\nb', tags: ['x', 'y'], created: 3, fav: true, unread: false, public: false, icon: 'data:image/png;base64,AA==' });
  }

  // --- export round trips ---------------------------------------------------------------------------------------------------------
  {
    let now = 1710000000000;
    const src = new Library({ client: 'exp', now: () => now });
    const f1 = src.addFolder({ name: 'Reading & <stuff>' });
    const f2 = src.addFolder({ name: 'Deep', parent: f1.id });
    src.addFolder({ name: 'Empty' });
    src.add({ url: 'https://a.example/x?q="1"', title: 'A <b>bold</b> & "quoted"', notes: 'line 1\nline 2', tags: ['one', 'two words'], folder: f2.id, unread: true, fav: true, public: true, created: 1600000000000 });
    src.add({ url: 'https://b.example/', title: 'B', tags: [], archived: true, created: 1600000001000, visited: 1600000002000 });
    const shape = (lib2) => lib2.bookmarks().map((b) => [b.url, b.title, b.notes, b.tags, lib2.tree().pathString(lib2.folderOf(b)), b.created, b.unread, b.fav, b.public, b.archived])
      .sort((x, y) => (x[0] < y[0] ? -1 : 1));
    const html = toNetscape(src);
    const back = new Library({ client: 'imp' });
    back.importItems(parseImport(html), { stripTracking: false });
    eq('netscape round trip', shape(back), shape(src));
    eq('netscape round trip keeps empty folders', back.folders().map((f) => f.name).sort(), ['Deep', 'Empty', 'Reading & <stuff>']);
    const back2 = new Library({ client: 'imq' });
    back2.restoreBackup(JSON.parse(toJSONBackup(src)));
    eq('json backup round trip', [shape(back2), back2.allRecords().map((r) => r.id).sort()], [shape(src), src.allRecords().map((r) => r.id).sort()]);
    const back3 = new Library({ client: 'imr' });
    back3.importItems(parseImport(toCSV(src), { name: 'x.csv' }), { stripTracking: false });
    eq('csv round trip', shape(back3), shape(src));
    const md = toMarkdown(src);
    const back4 = parseImport(md, { name: 'x.md' });
    eq('markdown round trip (titles, urls, folders, tags)', back4.items.map((i) => [i.title, i.url, i.folder.join('/'), i.tags]).sort(),
      [['A <b>bold</b> & "quoted"', 'https://a.example/x?q="1"', 'Reading & <stuff>/Deep', ['one', 'two words']], ['B', 'https://b.example/', '', []]]);
    ok('netscape: header for browsers', html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>') && html.includes('TAGS="one,two words"') && html.includes('TOREAD="1"'), html.slice(0, 300));
    const sel = toNetscape(src, { ids: [src.bookmarks().find((b) => b.title === 'B').id] });
    ok('netscape: selection exports only needed folders', !sel.includes('Deep') && sel.includes('b.example'), sel);
  }

  // --- search --------------------------------------------------------------------------------------------------------------------------
  {
    const now = new Date(2026, 9, 13, 12).getTime();
    const items = [
      { id: '1', title: 'Learning Rust the hard way', url: 'https://doc.rust-lang.org/book/', notes: 'Ownership explained', tags: ['rust', 'Programming'], created: new Date(2024, 4, 17).getTime(), unread: true, fav: false, public: true, archived: false, folder: 'f1' },
      { id: '2', title: 'Café culture', url: 'https://www.example.com/cafe', notes: '', tags: ['travel'], created: new Date(2023, 0, 5).getTime(), unread: false, fav: true, public: false, archived: false, folder: '' },
      { id: '3', title: 'Rusty tools', url: 'https://gist.github.com/x', notes: 'old rust snippets', tags: [], created: new Date(2026, 9, 10).getTime(), unread: false, fav: false, public: false, archived: true, folder: 'f2' },
    ];
    const paths = { f1: 'Dev/Rust', f2: 'Dev' };
    const ctx = { path: (it) => paths[it.folder] || '', host: (it) => hostOf(it.url), now };
    const ids = (q) => searchItems(items, q, ctx).map((x) => x.item.id);
    eq('search: words (ranked: title start first)', ids('rust'), ['1', '3']);
    eq('search: accents and case', ids('CAFE'), ['2']);
    eq('search: phrase', ids('"hard way"'), ['1']);
    eq('search: exclude', ids('rust -tools'), ['1']);
    eq('search: tag / #', [ids('tag:programming'), ids('#Rust'), ids('-#rust')], [['1'], ['1'], ['2', '3']]);
    eq('search: tag prefix', ids('tag:prog*'), ['1']);
    eq('search: site with subdomains', [ids('site:github.com'), ids('site:example.com'), ids('site:rust-lang.org')], [['3'], ['2'], ['1']]);
    eq('search: folder subtree', [ids('folder:dev'), ids('folder:Dev/Rust'), ids('folder:rust'), ids('folder:/'), ids('folder:ev')], [['1', '3'], ['1'], ['1'], ['2'], []]);
    eq('search: is', [ids('is:unread'), ids('is:fav'), ids('is:public'), ids('is:private'), ids('is:archived'), ids('is:untagged'), ids('-is:read')], [['1'], ['2'], ['1'], ['2', '3'], ['3'], ['3'], ['1']]);
    eq('search: dates', [ids('before:2024'), ids('after:2024-05'), ids('after:7d'), ids('before:2024-05-18 after:2024-05-17')], [['2'], ['1', '3'], ['3'], ['1']]);
    eq('search: field ops', [ids('title:tools'), ids('url:gist'), ids('notes:ownership')], [['3'], ['3'], ['1']]);
    eq('search: has', [ids('has:notes'), ids('has:tags')], [['1', '3'], ['1', '2']]);
    eq('search: unknown op is a word', parseQuery('c++: http://x.example').terms.map((t) => t.op), ['word', 'word']);
    eq('search: empty query matches all', ids('').length, 3);
    eq('search: compile flags', [compileQuery('rust').ranked, compileQuery('is:fav').ranked, compileQuery('').empty], [true, false, true]);
    eq('date terms', [parseDateTerm('2024-02', now).start, parseDateTerm('yesterday', now).start], [new Date(2024, 1, 1).getTime(), new Date(2026, 9, 12).getTime()]);
    const sg = suggest('foo tag:pr', 10, { tags: [{ tag: 'programming', count: 3 }, { tag: 'rust', count: 1 }, { tag: 'pro tips', count: 2 }] });
    eq('suggest: tags', [sg.from, sg.to, sg.items.map((x) => x.insert)], [4, 10, ['tag:programming', 'tag:"pro tips"']]);
    eq('suggest: operators', suggest('si', 2, {}).items.map((x) => x.insert), ['site:']);
    eq('suggest: is', suggest('-is:u', 5, {}).items.map((x) => x.insert), ['-is:unread', '-is:untagged']);
    eq('tag cloud', tagCloud([{ tags: ['a', 'B'] }, { tags: ['a'] }, { tags: ['b'] }, { tags: ['c'] }]).map((x) => [x.tag, x.count, x.weight]), [['a', 2, 5], ['B', 2, 5], ['c', 1, 1]]);
  }

  // --- sync: property tests ----------------------------------------------------------------------------------------------------------
  {
    const rounds = 40;
    let converged = 0;
    for (let round = 0; round < rounds; round++) {
      const rng = seededRandom('sync-' + round);
      let clockNow = 1700000000000;
      const server = syncLog();
      const clients = ['a', 'b', 'c'].map((id) => ({ lib: new Library({ client: id + round, now: () => clockNow + rng.int(5000) - 2500 }), since: 0, out: new Map() }));
      for (const cl of clients) cl.lib.on((ch) => { if (ch.origin === 'local') for (const r of ch.records) cl.out.set(r.id, r); });
      const sync = (cl) => {
        // Lossy network: sometimes the request is lost before or after the server applied it.
        const lostBefore = rng.chance(0.1), lostAfter = rng.chance(0.1);
        if (lostBefore) return;
        const sent = [...cl.out.values()].map(cloneRecord);
        server.apply(rng.shuffle(sent.slice()), { now: clockNow });
        if (lostAfter) return;
        cl.out.clear();
        const { rev, records } = server.since(cl.since);
        cl.lib.merge(rng.shuffle(records.map(cloneRecord)));
        cl.since = rev;
      };
      for (let step = 0; step < 120; step++) {
        clockNow += rng.int(1000);
        const cl = rng.pick(clients);
        const L = cl.lib;
        const bms = L.bookmarks(), fs = L.folders();
        const op = rng.int(10);
        if (op === 0 || !bms.length) L.add({ url: `https://s${rng.int(30)}.example/`, title: 't' + rng.int(100), tags: rng.chance(0.5) ? ['x' + rng.int(5)] : [], folder: fs.length && rng.chance(0.5) ? rng.pick(fs).id : '' });
        else if (op === 1) L.update(rng.pick(bms).id, { title: 'e' + rng.int(1000) });
        else if (op === 2) L.update(rng.pick(bms).id, { notes: 'n' + rng.int(1000), unread: rng.chance(0.5) });
        else if (op === 3) L.remove([rng.pick(bms).id]);
        else if (op === 4) { const s = L.remove([rng.pick(bms).id]); if (rng.chance(0.5)) L.restore(s); }
        else if (op === 5) L.addFolder({ name: 'f' + rng.int(5), parent: fs.length && rng.chance(0.5) ? rng.pick(fs).id : '' });
        else if (op === 6 && fs.length >= 2) L.moveFolder(rng.pick(fs).id, rng.chance(0.2) ? '' : rng.pick(fs).id);
        else if (op === 7 && fs.length) { if (rng.chance(0.3)) L.removeFolder(rng.pick(fs).id); else L.update(rng.pick(bms).id, { folder: rng.pick(fs).id }); }
        else if (op === 8) L.addTags([rng.pick(bms).id], ['t' + rng.int(4)]);
        else if (op === 9) L.renameTag('x' + rng.int(5), 'y' + rng.int(3));
        if (rng.chance(0.3)) sync(rng.pick(clients));
      }
      // Quiet network: everyone syncs twice (pushes what is still unsent, then pulls the rest).
      const lossy = rng.chance;
      rng.chance = () => false;
      for (let k = 0; k < 2; k++) for (const cl of clients) sync(cl);
      rng.chance = lossy;
      const state = (L) => canon(L.allRecords().map(cloneRecord).sort((x, y) => (x.id < y.id ? -1 : 1)));
      const views = (L) => JSON.stringify([L.bookmarks().map((b) => [b.id, b.title, b.tags, L.tree().pathString(L.folderOf(b))]).sort(), L.folders().map((f) => [f.id, L.tree().pathString(f.id)]).sort()]);
      const s0 = state(clients[0].lib), v0 = views(clients[0].lib);
      const serverLib = new Library({ client: 'srv' });
      serverLib.load(server.records());
      if (clients.every((cl) => state(cl.lib) === s0 && views(cl.lib) === v0) && state(serverLib) === s0) converged++;
      else if (converged === round) console.log('diverged in round', round);
    }
    eq('sync: every replica converges (random concurrent edits, lost requests, shuffled order)', converged, rounds);

    // Merge order does not matter: the same records merged in two random orders.
    const rng = seededRandom('orders');
    const libs = ['p', 'q'].map((c) => new Library({ client: c }));
    const recs = [];
    const w = new Library({ client: 'w' });
    w.on((ch) => { for (const r of ch.records) recs.push(cloneRecord(r)); });
    const ids = [];
    for (let i = 0; i < 40; i++) {
      if (!ids.length || rng.chance(0.3)) ids.push(w.add({ url: `https://o${i}.example/` }).id);
      else if (rng.chance(0.2)) w.remove([rng.pick(ids)]);
      else w.update(rng.pick(ids), { title: 'x' + i });
    }
    libs[0].merge(rng.shuffle(recs.slice()));
    for (const r of rng.shuffle(recs.slice())) libs[1].merge([r]);
    eq('sync: merge order independence', canon(libs[0].allRecords().sort((a, b) => (a.id < b.id ? -1 : 1))), canon(libs[1].allRecords().sort((a, b) => (a.id < b.id ? -1 : 1))));

    // Concurrent folder moves that make a cycle: every replica breaks it the same way.
    const A = new Library({ client: 'ca', now: () => 1000 }), B = new Library({ client: 'cb', now: () => 2000 });
    const x = A.addFolder({ name: 'X' }), y = A.addFolder({ name: 'Y' });
    B.merge(A.allRecords().map(cloneRecord));
    A.moveFolder(x.id, y.id);
    B.moveFolder(y.id, x.id);
    A.merge(B.allRecords().map(cloneRecord));
    B.merge(A.allRecords().map(cloneRecord));
    eq('sync: folder cycle broken deterministically', [A.tree().pathString(x.id), A.tree().pathString(y.id)], [B.tree().pathString(x.id), B.tree().pathString(y.id)]);
    ok('sync: no cycle left', A.tree().depth(x.id) + A.tree().depth(y.id) === 3, [A.tree().pathString(x.id), A.tree().pathString(y.id)]);

    // Server log: revisions, future stamps rejected, saved and loaded.
    const log = syncLog();
    const c1 = new Library({ client: 'l1' });
    const bm = c1.add({ url: 'https://log.example/' });
    eq('log: apply', log.apply(c1.allRecords()).changed, [bm.id]);
    eq('log: idempotent', log.apply(c1.allRecords()).changed, []);
    const fut = new Library({ client: 'fut', now: () => Date.now() + 10 * 864e5 });
    fut.add({ url: 'https://future.example/' });
    eq('log: far future stamps rejected', log.apply(fut.allRecords()).rejected.length, 1);
    const log2 = syncLog(JSON.parse(JSON.stringify(log.toJSON())));
    eq('log: saved and loaded', [log2.rev, log2.since(0).records.length, log2.since(1).records.length], [1, 1, 0]);
  }

  // --- Atom ---------------------------------------------------------------------------------------------------------------------------
  {
    const xml = toAtom({
      id: tagURI('bm.example:8080', 1700000000000, 'bookmarks/ann'), title: 'Ann’s bookmarks & <links>', link: 'https://bm.example/u/ann',
      self: 'https://bm.example/u/ann/feed', author: 'ann',
      entries: [{ id: tagURI('bm.example', 1700000000000, 'bookmarks/ann/abc'), title: 'A & B', link: 'https://a.example/?x=1&y=2', summary: 'notes <b>', published: 1700000000000, updated: 1700000100000, categories: ['x', 'y z'] }],
    });
    const doc = parseXML(xml);
    const feed = root(doc);
    eq('atom: root and namespace', [feed.name, attr(feed, 'xmlns')], ['feed', 'http://www.w3.org/2005/Atom']);
    const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
    ok('atom: required feed elements', ['id', 'title', 'updated', 'author'].every((n) => child(feed, n)) && rfc3339.test(textOf(child(feed, 'updated'))));
    const e = children(feed, 'entry')[0];
    eq('atom: entry', [textOf(child(e, 'title')), attr(child(e, 'link'), 'href'), textOf(child(e, 'id')), children(e, 'category').map((c) => attr(c, 'term'))],
      ['A & B', 'https://a.example/?x=1&y=2', 'tag:bm.example,2023-11-14:bookmarks/ann/abc', ['x', 'y z']]);
  }

  // --- page metadata -----------------------------------------------------------------------------------------------------------------------
  {
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><base href="/sub/">
      <title>  Hello &amp; welcome
      </title><meta name="description" content="A &quot;page&quot;"><meta property="og:site_name" content="Site">
      <link rel="canonical" href="https://e.example/canonical"><link rel="icon" href="favicon-16.png" sizes="16x16">
      <link rel="icon" href="icon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple.png">
      <script>var t = '<title>no</title>';</script></head><body><title>body</title>`;
    const m = extractMeta(html, 'https://e.example/page');
    eq('meta: fields', [m.title, m.description, m.siteName, m.canonical, m.lang], ['Hello & welcome', 'A "page"', 'Site', 'https://e.example/canonical', 'de']);
    eq('meta: icons resolved against <base>', m.icons.map((i) => i.href), ['https://e.example/sub/favicon-16.png', 'https://e.example/sub/icon-32.png', 'https://e.example/apple.png']);
    eq('meta: best icon', pickIcon(m.icons, 'https://e.example/page'), 'https://e.example/sub/icon-32.png');
    eq('meta: fallback icon', pickIcon([], 'https://e.example/a/b'), 'https://e.example/favicon.ico');
    eq('meta: og title fallback', extractMeta('<meta property="og:title" content="OG">', 'https://e.example/').title, 'OG');
    eq('meta: javascript: links ignored', extractMeta('<link rel="icon" href="javascript:alert(1)">', 'https://e.example/').icons, []);
    eq('meta: charset', [charsetOf('text/html; charset=Windows-1251'), charsetOf('text/html', new TextEncoder().encode('<meta charset="koi8-r">'))], ['windows-1251', 'koi8-r']);
  }

  // --- IP addresses -------------------------------------------------------------------------------------------------------------------------
  {
    const kinds = (list) => list.map((ip) => classifyIP(ip).kind);
    eq('ip: IPv4 classes', kinds(['8.8.8.8', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.32.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.128.0.1',
      '224.0.0.1', '240.0.0.1', '255.255.255.255', '0.0.0.0', '192.0.2.1', '198.18.0.1', '203.0.113.9']),
    ['public', 'loopback', 'private', 'private', 'public', 'private', 'link-local', 'cgnat', 'public', 'multicast', 'reserved', 'broadcast', 'unspecified', 'documentation', 'benchmarking', 'documentation']);
    eq('ip: IPv6 classes', kinds(['::1', '::', 'fe80::1%eth0', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1', '2606:4700:4700::1111', '[2a00:1450:4001:80b::200e]', 'fec0::1', '3fff::1', '100::1', '2001::1']),
    ['loopback', 'unspecified', 'link-local', 'unique-local', 'unique-local', 'multicast', 'documentation', 'public', 'public', 'site-local', 'documentation', 'reserved', 'reserved']);
    eq('ip: embedded IPv4', [classifyIP('::ffff:127.0.0.1'), classifyIP('::ffff:7f00:1'), classifyIP('::ffff:8.8.8.8'), classifyIP('64:ff9b::10.0.0.1'), classifyIP('2002:c0a8:0101::1')].map((c) => [c.kind, c.via]),
      [['loopback', 'mapped'], ['loopback', 'mapped'], ['public', 'mapped'], ['private', 'nat64'], ['private', '6to4']]);
    eq('ip: invalid', [classifyIP('256.1.1.1').kind, classifyIP('01.2.3.4').kind, classifyIP('1::2::3').kind, classifyIP('example.com').kind], ['invalid', 'invalid', 'invalid', 'invalid']);
    eq('ip: parse v6', parseIPv6('1:2:3:4:5:6:7.8.9.10'), [1, 2, 3, 4, 5, 6, 0x0708, 0x090a]);
    eq('ip: public', [isPublicIP('1.1.1.1'), isPublicIP('::ffff:10.0.0.1')], [true, false]);
  }

  // A value test so a broken valueOf shows up even without the other sections.
  eq('valueOf defaults', valueOf(newRecord('folder', 'f')), { id: 'f', type: 'folder', name: '', parent: '', created: 0, del: false });

  console.log(`bookmarks: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
