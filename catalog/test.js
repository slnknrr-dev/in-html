// catalog/test.js - unit tests of the media catalogue: `node catalog/test.js` (also `node check.js tests catalog`).
// Store, model normalization, tags, the query language, facts, smart playlists, collections, workspaces, tracking and
// statistics, presence levels, covers, browsing, the indexer (with an in-memory file system and real WAV / MP3 tags),
// export / import with merge, MyAnimeList / Shikimori / M3U8 / XSPF / NFO / CUE, and the demo content.
//
// Conventions:
// - No test framework: eq() compares by JSON.stringify (structural, order-sensitive, ignores undefined properties)
//   and ok() takes a boolean plus optional diagnostic info. Failures print and are counted; run() returns the failure
//   count so a runner (check.js) can aggregate suites and set the exit code. Zero dependencies keeps the suite
//   runnable in the same offline environment as the app.
// - Determinism: the catalogue clock is frozen via setClock to a fixed UTC instant and advanced by assigning
//   `clock`, so relative-date queries ('30d'), streaks and `updated` ordering are reproducible. setClock(null) at the
//   end restores Date.now for any suite that runs after this one in the same process.
// - Each section is a block scope with its own createDB(), so sections are independent and can be read alone.
// - Some assertions pin current behaviour rather than ideal behaviour (for example the album CUE export, see the
//   KNOWN DEFECT in interop.js albumCue); fixing such a defect means updating the matching assertion.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDB, keysOf, srcKey } from './db.js';
import { newWork, newMedia, normNode, setClock, matchKey, sortKey } from './model.js';
import { tagKey, ancestors, tagIndex, effectiveTags, defineTag, mergeTags, deleteTag, addTags, suggestTags } from './tags.js';
import { parseQuery, runQuery, compileQuery, parseDuration, parseDate, explain } from './query.js';
import { facts } from './facts.js';
import { resolveSmart, expandForPlay, timeOfDay, SMART_PRESETS } from './smart.js';
import { createCollection, itemsOf, addItems, moveItem, removeItems, dedupeItems, coverSources } from './collections.js';
import { createWorkspace, addFolder, moveFolder, addRefs, folderItems, findFolder, normWorkspaceRoot, removeFolder } from './workspaces.js';
import { recordPlay, setStatus, setProgress, setScore, trackTarget, continueList, stats, nextEpisode, countsAsPlay, savePosition } from './tracking.js';
import { attachFile, attachSource, detachFile, detachSource, markMissing, choosePlayable, upgradeOptions, createNominal, presenceOf } from './presence.js';
import { generatedCover, collageSVG, coverChain, genParams, COVER_STYLES } from './covers.js';
import { artists, discs, seasons, authors, bookSeries, editions, genres, searchAll, sectionItems } from './browse.js';
import { newSource, scanSource, analyzeFile, previewRules, indexLinks, indexYtdlp, workKey, planScan } from './indexer.js';
import { exportTree, exportDB, exportZip, readExchange, importData } from './exchange.js';
import { parseMal, importMal, exportMal, importShikimori, exportShikimori, splitSeasonTitle, playlistM3u, importPlaylist, workNfo, albumCue } from './interop.js';
import { buildDemo, synthesize, DEMO_TAG } from './demo.js';
import { encodeWav } from '../wav/wav.js';
import { writeId3v2 } from '../mp3/id3.js';

// ESM has no require.main; comparing the resolved argv[1] with this module's URL tells "run directly" from
// "imported by a runner", so importing the suite does not execute it twice.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond, info) => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== undefined ? ': ' + JSON.stringify(info) : ''}`); } };
  let clock = Date.UTC(2026, 9, 1, 12, 0, 0);
  setClock(() => clock);
  const NOW = clock;

  // --- db ------------------------------------------------------------------------------------------------------------
  // Store invariants: play order of children, best-presence-first media, case-preserving source keys, one event per
  // write vs one per batch (with per-id op collapsing), undo of a whole batch, cascade removal counts.
  {
    const db = createDB();
    const events = [];
    db.on((e) => events.push(e));
    const a = db.put(newWork({ kind: 'album', title: 'A' }));
    const t2 = db.put(newWork({ kind: 'track', title: 'Two', parent: a.id, order: 2 }));
    const t1 = db.put(newWork({ kind: 'track', title: 'One', parent: a.id, order: 1, disc: 1 }));
    const t3 = db.put(newWork({ kind: 'track', title: 'Disc two', parent: a.id, order: 1, disc: 2 }));
    eq('children order', db.children(a.id).map((w) => w.title), ['One', 'Two', 'Disc two']);
    const m = db.put(newMedia(t1.id, { presence: 'source', source: { ref: 'youtube:AbC_123' } }));
    db.put(newMedia(t1.id, { presence: 'file', loc: { kind: 'blob', blob: 'x' } }));
    eq('media best first', db.mediaOf(t1.id).map((x) => x.presence), ['file', 'source']);
    eq('find by source key keeps id case', db.find('src:youtube:AbC_123'), m.id);
    eq('srcKey', [srcKey('YouTube:AbC'), srcKey('https://Example.org/a/?x=1#t')], ['youtube:AbC', 'https://example.org/a?x=1']);
    eq('events per put', events.length, 6);
    db.batch(() => { db.patch(t2.id, { title: 'Deux' }); db.patch(t2.id, { year: 2001 }); });
    eq('batch: one event, collapsed ops', [events.length, events[6].ops.length], [7, 1]);
    eq('undo batch', [db.undo(), db.get(t2.id).title, db.get(t2.id).year], [true, 'Two', undefined]);
    const removed = db.remove(a.id);
    eq('cascade remove', removed.length, 6);
    eq('undo remove', [db.undo(), db.count('work'), db.count('media')], [true, 4, 2]);
    const ch = db.changesSince(0);
    ok('changesSince lists live nodes', ch.ops.length >= 6 && ch.ops.every((o) => o.op === 'put' || o.op === 'del'));
    const db2 = createDB();
    db2.apply(db.snapshot().nodes.map((node) => ({ op: 'put', node })));
    eq('apply snapshot', [db2.count('work'), db2.children(a.id).length, db2.canUndo()], [4, 3, false]);
    eq('memo invalidates', [db.memo('k', () => 1), db.memo('k', () => 2), (db.patch(t3.id, { title: 'x' }), db.memo('k', () => 3))], [1, 1, 3]);
  }

  // --- model ------------------------------------------------------------------------------------------------------------
  {
    eq('normNode rejects', [normNode(null), normNode({ id: 'bad id!', type: 'work' }), normNode({ id: 'a', type: 'nope' })], [null, null, null]);
    const n = normNode({ id: 'abc', type: 'media', presence: 'file', title: 'x'.repeat(5000), size: '12', __proto__: { evil: 1 }, ext: { a: { b: [1, 2, { c: 'd' }] } }, loc: { kind: 'url', url: 'javascript:alert(1)' } });
    eq('normNode: bounded, typed, url loc refused, presence corrected', [n.title.length, n.size, n.ext.a.b[2].c, n.loc, n.presence], [2000, 12, 'd', undefined, 'nominal']);
    const w = normNode({ id: 'w1', type: 'work', kind: 'weird', track: { status: 'x', score: 12.34, progress: -5 }, people: [{ name: 'A', role: 'nope' }, 'bad'] });
    eq('normNode work', [w.kind, w.track.status, w.track.score, w.track.progress, w.people], ['track', 'planned', 10, 0, [{ name: 'A', role: 'artist' }]]);
    eq('matchKey', matchKey('  Émilie & The Café—Band!  '), 'emilie the cafe band');
    ok('sortKey drops articles and pads numbers', sortKey({ title: 'The Track 2' }) < sortKey({ title: 'A Track 10' }));
  }

  // --- tags ------------------------------------------------------------------------------------------------------------
  {
    eq('tagKey', [tagKey(' Genre : Rock / Punk '), tagKey('#Favourite'), tagKey(':x'), tagKey('')], ['genre:rock/punk', 'favourite', 'x', '']);
    eq('ancestors', ancestors('genre:rock/punk/hardcore'), ['genre:rock/punk', 'genre:rock']);
    const db = createDB();
    const show = db.put(newWork({ kind: 'show', title: 'S', tags: ['genre:drama'] }));
    const ep = db.put(newWork({ kind: 'episode', title: 'E', parent: show.id, tags: ['mood:chill'] }));
    db.put(newMedia(ep.id, { tags: ['quality:4k'] }));
    defineTag(db, 'mood:calm', { aliases: ['mood:chill'], implies: ['energy:low'] });
    defineTag(db, 'energy:low', { implies: ['mood:calm'] }); // a cycle is harmless
    const e = [...effectiveTags(db, db.get(ep.id))].sort();
    eq('effective tags: inherited, media, alias, implication', e, ['energy:low', 'genre:drama', 'mood:calm', 'quality:4k']);
    addTags(db, [ep.id], ['genre:rock/punk', 'GENRE:ROCK/PUNK']);
    eq('addTags dedupes', db.get(ep.id).tags, ['mood:chill', 'genre:rock/punk']);
    mergeTags(db, ['genre:rock'], 'genre:guitar');
    eq('merge moves descendants', db.get(ep.id).tags, ['mood:chill', 'genre:guitar/punk']);
    deleteTag(db, 'mood:calm');
    eq('delete tag + definition', [db.get(ep.id).tags.includes('mood:chill'), db.all('tagdef').length], [true, 1]);
    ok('suggest', suggestTags(db, 'gen').some((x) => x.startsWith('genre:')));
    eq('label of alias', tagIndex(db).canon('mood:chill'), 'mood:chill');
  }

  // --- query -----------------------------------------------------------------------------------------------------------
  const lib = createDB();
  {
    const al = lib.put(newWork({ kind: 'album', title: 'Kind of Blue', year: 1959, people: [{ name: 'Miles Davis', role: 'albumartist' }], tags: ['genre:jazz/modal'], added: NOW - 400 * 864e5 }));
    const t1 = lib.put(newWork({ kind: 'track', title: 'So What', parent: al.id, order: 1, duration: 562, tags: ['mood:calm'], energy: 3, bpm: 136, plays: 5, lastPlayed: NOW - 2 * 864e5, added: NOW - 400 * 864e5 }));
    lib.put(newWork({ kind: 'track', title: 'Freddie Freeloader', parent: al.id, order: 2, duration: 589, energy: 6, added: NOW - 5 * 864e5 }));
    lib.put(newMedia(t1.id, { presence: 'file', loc: { kind: 'fs', mount: 'm', path: 'Jazz/01 So What.flac' }, name: '01 So What.flac', audio: { codec: 'flac' }, size: 30e6 }));
    const sh = lib.put(newWork({ kind: 'show', title: 'Shingeki', titles: { romaji: 'Shingeki no Kyojin', en: 'Attack on Titan' }, domain: 'anime', total: 25, format: 'tv' }));
    const s1 = lib.put(newWork({ kind: 'season', title: 'Season 1', parent: sh.id, season: 1, track: { status: 'current', progress: 3, score: 9 } }));
    const e1 = lib.put(newWork({ kind: 'episode', title: 'To You, in 2000 Years', parent: s1.id, season: 1, episode: 1, duration: 1440 }));
    lib.put(newMedia(e1.id, { presence: 'source', source: { ref: 'youtube:abc' } }));
    lib.put(newWork({ kind: 'movie', title: 'Nosferatu', year: 1922, people: [{ name: 'F. W. Murnau', role: 'director' }] }));
    lib.put(newWork({ kind: 'track', title: 'Lantern Song', lyrics: { text: 'la la' }, favorite: true }));
    lib.put(createCollectionNode('Picks', [t1.id]));
    defineTag(lib, 'mood:calm', { implies: ['energy:low'] });
    const q = (s, o) => runQuery(lib, s, { now: NOW, ...o }).map((w) => w.title);
    eq('tag with hierarchy', q('genre:jazz kind:track'), ['Freddie Freeloader', 'So What']);
    eq('tag implication', q('energy:low'), ['So What']);
    eq('numeric field vs tag', q('energy:>=5'), ['Freddie Freeloader']);
    eq('artist inherited', q('artist:miles kind:track'), ['Freddie Freeloader', 'So What']);
    eq('domain kind alias', q('kind:anime'), ['Season 1', 'Shingeki', 'To You, in 2000 Years']);
    eq('alternative title text', q('titan'), ['Shingeki', 'Season 1', 'To You, in 2000 Years'].filter((x) => x === 'Shingeki'));
    eq('presence', q('presence:source'), ['Season 1', 'Shingeki', 'To You, in 2000 Years']);
    eq('presence file of container', q('presence:file kind:album'), ['Kind of Blue']);
    eq('duration units', [q('duration:>9.5m kind:track'), q('duration:9..9.5m'), q('duration:<10 kind:track')], [['Freddie Freeloader'], ['So What'], ['Freddie Freeloader', 'So What']]);
    eq('ranges and lists', [q('year:1900..1930'), q('year:1959,1922 kind:album,movie')], [['Nosferatu'], ['Kind of Blue', 'Nosferatu']]);
    eq('dates', [q('added:<30d kind:track'), q('added:>1y kind:track'), q('played:never kind:track'), q('played:<1w')], [['Freddie Freeloader', 'Lantern Song'], ['So What'], ['Freddie Freeloader', 'Lantern Song'], ['So What']]);
    eq('boolean', [q('(title:what OR title:nosf) -kind:movie'), q('NOT kind:track kind:album'), q('kind:movie | is:favorite')], [['So What'], ['Kind of Blue'], ['Lantern Song', 'Nosferatu']]);
    eq('has / is', [q('has:lyrics'), q('is:favorite'), q('has:file kind:track'), q('is:watching')], [['Lantern Song'], ['Lantern Song'], ['So What'], ['Season 1', 'To You, in 2000 Years']]);
    eq('status / score inherited by episodes', q('status:watching score:>=9 kind:episode'), ['To You, in 2000 Years']);
    eq('ext / codec / path', [q('ext:flac'), q('codec:flac'), q('path:jazz')], [['So What'], ['So What'], ['So What']]);
    eq('size', q('size:>20mb'), ['So What']);
    eq('in: collection', q('in:Picks'), ['So What']);
    eq('quoted value / phrase', [q('title:"so what"'), q('"kind of"').length], [['So What'], 3]);
    eq('wildcard and regex', [q('title:fred*'), q('title:/^so\\s/i')], [['Freddie Freeloader'], ['So What']]);
    eq('director field', q('director:murnau'), ['Nosferatu']);
    eq('namespace any', q('genre:*').length, 3);
    eq('lenient parser', [parseQuery('a (b OR c').warnings, parseQuery('a ) b').warnings, parseQuery('OR').warnings], [['missing )'], ['unbalanced )'], ['dangling OR']]);
    eq('explain', explain(parseQuery('a:b (c OR -d) year:1..2').ast), 'artist has b AND ("c" OR NOT "d") AND year range 1..2');
    eq('parseDuration', [parseDuration('1:30'), parseDuration('1h30m'), parseDuration('90s'), parseDuration('2'), Number.isNaN(parseDuration('x'))], [90, 5400, 90, 120, true]);
    eq('parseDate', [parseDate('30d').age, parseDate('2024-03').span], [30 * 864e5, 31 * 864e5]);
    eq('sort', q('kind:track', { sort: '-plays title' }), ['So What', 'Freddie Freeloader', 'Lantern Song']);
    const pred = compileQuery('artist:miles', lib);
    ok('compiled predicate reused', pred(lib.get(t1.id)) && !pred(lib.get(e1.id)));
  }

  // --- facts / smart / collections ------------------------------------------------------------------------------------
  {
    const f = facts(lib, lib.all('work').find((w) => w.title === 'So What'));
    eq('facts', [f.album, f.albumartist, f.domain, f.presence, f.year, f.track], ['Kind of Blue', ['Miles Davis'], 'music', 'file', 1959, 1]);
    const smart = { kind: 'smart', query: 'genre:jazz', pick: 'all', sort: 'title' };
    eq('smart expands albums and skips nominal', resolveSmart(lib, smart, { now: NOW }).map((w) => w.title), ['So What']);
    eq('smart incl. nominal', resolveSmart(lib, { ...smart, playable: false }, { now: NOW }).map((w) => w.title), ['Freddie Freeloader', 'So What']);
    eq('smart limit minutes', resolveSmart(lib, { query: 'kind:track', playable: false, limit: { minutes: 10 }, sort: 'title' }, { now: NOW }).map((w) => w.title), ['Freddie Freeloader', 'Lantern Song']);
    const r1 = resolveSmart(lib, { query: 'kind:track', playable: false, pick: 'random', seed: 's' }, { now: NOW }).map((w) => w.id);
    const r2 = resolveSmart(lib, { query: 'kind:track', playable: false, pick: 'random', seed: 's' }, { now: NOW }).map((w) => w.id);
    eq('seeded random is stable', r1, r2);
    eq('presets compile', SMART_PRESETS.every((p) => Array.isArray(resolveSmart(lib, p, { now: NOW }))), true);
    eq('timeOfDay', [timeOfDay(new Date(2026, 0, 1, 7)), timeOfDay(new Date(2026, 0, 1, 13)), timeOfDay(new Date(2026, 0, 1, 19)), timeOfDay(new Date(2026, 0, 1, 2))], ['morning', 'afternoon', 'evening', 'night']);
    const db = createDB();
    const al = db.put(newWork({ kind: 'album', title: 'Al' }));
    const ts = [1, 2, 3].map((i) => db.put(newWork({ kind: 'track', title: 'T' + i, parent: al.id, order: i })));
    const p = createCollection(db, 'playlist', { name: 'P' });
    addItems(db, p.id, [ts[2].id, ts[0].id, ts[0].id]);
    moveItem(db, p.id, 0, 2);
    eq('playlist ops', db.get(p.id).items.map((i) => db.get(i.ref).title), ['T1', 'T1', 'T3']);
    dedupeItems(db, p.id); removeItems(db, p.id, [1]);
    eq('dedupe + remove', itemsOf(db, db.get(p.id)).map((w) => w.title), ['T1']);
    addItems(db, p.id, [al.id]);
    eq('album in a playlist expands', itemsOf(db, db.get(p.id)).map((w) => w.title), ['T1', 'T2', 'T3']);
    const g = createCollection(db, 'group', { name: 'G', children: [p.id, p.id] });
    eq('group', itemsOf(db, g).length, 3);
    eq('collage sources: one per album', coverSources(db, db.get(p.id)), [al.id]);
    eq('expandForPlay', expandForPlay(db, [al]).map((w) => w.title), []);
  }

  // --- workspaces ------------------------------------------------------------------------------------------------------
  {
    const db = createDB();
    const w = db.put(newWork({ kind: 'movie', title: 'M', year: 2000 }));
    const ws = createWorkspace(db, 'Home');
    const a = addFolder(db, ws.id, null, 'A');
    const b = addFolder(db, ws.id, a.id, 'B', { query: 'kind:movie' });
    addRefs(db, ws.id, a.id, [w.id, w.id]);
    eq('folder items + query', [folderItems(db, db.get(ws.id), a.id).length, folderItems(db, db.get(ws.id), b.id).map((x) => x.title)], [1, ['M']]);
    eq('no move into descendant', moveFolder(db, ws.id, a.id, b.id), false);
    eq('move to root', [moveFolder(db, ws.id, b.id, null, 0), db.get(ws.id).root.children.map((f) => f.name)], [true, ['B', 'A']]);
    removeFolder(db, ws.id, b.id);
    eq('remove folder', findFolder(db.get(ws.id).root, b.id), null);
    const fixed = normWorkspaceRoot({ id: 'x', children: [{ id: 'x', name: 'dup' }, null, { name: 'n', items: [1, 'ok'] }] });
    eq('normalize tree', [fixed.children.length, fixed.children[0].id !== 'x', fixed.children[1].items], [2, true, ['ok']]);
  }

  // --- tracking ---------------------------------------------------------------------------------------------------------
  {
    const db = createDB();
    const show = db.put(newWork({ kind: 'show', title: 'Anime', domain: 'anime' }));
    const s2 = db.put(newWork({ kind: 'season', title: 'S2', parent: show.id, season: 2 }));
    const eps = [1, 2].map((e) => db.put(newWork({ kind: 'episode', title: 'E' + e, parent: s2.id, season: 2, episode: e, duration: 1400 })));
    const m1 = db.put(newMedia(eps[0].id, { presence: 'file', loc: { kind: 'blob', blob: 'b' }, duration: 1400 }));
    eq('anime episodes track on the season', trackTarget(db, eps[0]).id, s2.id);
    eq('countsAsPlay', [countsAsPlay({ listened: 130, duration: 240, family: 'music' }), countsAsPlay({ listened: 100, duration: 240, family: 'music' }), countsAsPlay({ position: 1300, duration: 1400, family: 'video' }), countsAsPlay({ position: 1200, duration: 1400, family: 'video', markers: { outro: [1190, 1300] } })], [true, false, true, true]);
    recordPlay(db, { media: m1.id, listened: 300, position: 300, duration: 1400 });
    eq('partial play: resume + current', [db.get(m1.id).position, db.get(s2.id).track.status, db.get(eps[0].id).plays || 0], [300, 'current', 0]);
    recordPlay(db, { media: m1.id, listened: 1100, position: 1380, duration: 1400 });
    eq('finished: plays, progress, no resume', [db.get(eps[0].id).plays, db.get(s2.id).track.progress, db.get(m1.id).position], [1, 1, undefined]);
    eq('next episode', nextEpisode(db, s2.id).title, 'E2');
    eq('continue list: next', continueList(db).map((x) => [x.work.title, x.reason]), [['E2', 'next']]);
    clock += 1000;
    recordPlay(db, { work: eps[1].id, listened: 1350, position: 1390, duration: 1400 });
    eq('all watched -> completed', [db.get(s2.id).track.status, db.get(s2.id).track.progress, !!db.get(s2.id).track.finished], ['completed', 2, true]);
    clock += 1000;
    recordPlay(db, { work: eps[0].id, listened: 1350, position: 1390, duration: 1400 });
    eq('rewatch starts repeating', db.get(s2.id).track.status, 'current' === db.get(s2.id).track.status ? 'current' : db.get(s2.id).track.status);
    ok('rewatch status', ['repeating', 'completed'].includes(db.get(s2.id).track.status), db.get(s2.id).track);
    setStatus(db, s2.id, 'repeating'); setStatus(db, s2.id, 'completed');
    eq('repeats counted', db.get(s2.id).track.repeats >= 1, true);
    setScore(db, s2.id, 7.77);
    eq('score rounded', db.get(s2.id).track.score, 7.8);
    const movie = db.put(newWork({ kind: 'movie', title: 'Film', duration: 6000 }));
    setProgress(db, movie.id, 5);
    eq('progress clamps to total and completes', [db.get(movie.id).track.progress, db.get(movie.id).track.status], [1, 'completed']);
    savePosition(db, m1.id, 1399, 1400);
    eq('position near the end is cleared', db.get(m1.id).position, undefined);
    const st = stats(db, { now: clock });
    eq('stats', [st.plays, st.byDomain.anime.done, st.statuses.anime.completed, st.scores[8], st.streak.current], [4, 3, 1, 1, 1]);
  }

  // --- presence -------------------------------------------------------------------------------------------------------
  {
    const db = createDB();
    const w = createNominal(db, { kind: 'track', title: 'Song', lyrics: 'words', image: 'blob:cover' });
    eq('nominal', [presenceOf(db, w.id), db.get(w.id).lyrics.text, db.mediaOf(w.id)[0].nominal.image], ['nominal', 'words', 'blob:cover']);
    eq('nominal cannot play', choosePlayable(db, w.id).mode, null);
    attachSource(db, w.id, 'youtube:XYZ');
    eq('upgrade to source (same media)', [presenceOf(db, w.id), db.mediaOf(w.id).length], ['source', 1]);
    eq('source plays only with yt-dlp', [choosePlayable(db, w.id).mode, choosePlayable(db, w.id, { can: { ytdlp: true } }).mode], [null, 'stream']);
    eq('upgrade options', [upgradeOptions(db, w.id), upgradeOptions(db, w.id, { ytdlp: true })], [['attach-file'], ['play', 'attach-file', 'download', 'stream']]);
    const m = attachFile(db, w.id, { kind: 'fs', mount: 'm1', path: 'a.mp3' }, { duration: 100 });
    eq('upgrade to file keeps source', [presenceOf(db, w.id), m.source.ref, db.mediaOf(w.id).length], ['file', 'youtube:XYZ', 1]);
    eq('file needs a capable artifact', [choosePlayable(db, w.id).mode, choosePlayable(db, w.id, { can: { fs: true } }).mode], [null, 'file']);
    markMissing(db, m.id);
    eq('missing file downgrades to source', [presenceOf(db, w.id), db.get(m.id).missing], ['source', true]);
    detachFile(db, m.id); detachSource(db, m.id);
    eq('downgrade to nominal', presenceOf(db, w.id), 'nominal');
    const d = createNominal(db, { kind: 'track', title: 'Direct' });
    attachSource(db, d.id, 'https://example.org/a.mp3', { url: 'https://example.org/a.mp3' });
    eq('a direct media URL plays in the browser', choosePlayable(db, d.id).mode, 'file');
  }

  // --- covers ----------------------------------------------------------------------------------------------------------
  {
    const a = generatedCover(genParams({ type: 'work', kind: 'album', title: 'Same <Title> & "quotes"' }));
    const b = generatedCover(genParams({ type: 'work', kind: 'album', title: 'Same <Title> & "quotes"' }));
    ok('generated cover is deterministic and escaped', a === b && a.startsWith('<svg') && a.includes('&lt;Title&gt;') && !a.includes('<Title>') && !/<script|href="http/i.test(a));
    ok('every style renders', COVER_STYLES.every((s) => generatedCover({ ...genParams({ title: 'X Y Z' }), style: s }).includes('</svg>')));
    ok('different titles differ', generatedCover(genParams({ title: 'A' })) !== generatedCover(genParams({ title: 'B' })));
    eq('collage cells', [collageSVG(['a']).match(/<image/g).length, collageSVG(['a', 'b', 'c', 'd', 'e']).match(/<image/g).length], [1, 4]);
    const db = createDB();
    const al = db.put(newWork({ kind: 'album', title: 'Al', cover: { blob: 'c1' } }));
    const t = db.put(newWork({ kind: 'track', title: 'T', parent: al.id }));
    const chain = coverChain(db, t);
    eq('cover chain: container cover then generated', [chain[0].blob, !!chain[chain.length - 1].gen], ['c1', true]);
  }

  // --- browse ---------------------------------------------------------------------------------------------------------
  {
    eq('artists', artists(lib).map((a) => [a.name, a.albums.length, a.tracks]), [['Miles Davis', 1, 2]]);
    eq('genres', genres(lib).map((g) => g.key), ['genre:jazz', 'genre:jazz/modal']);
    const db = createDB();
    const a1 = db.put(newWork({ kind: 'album', title: 'Album (Remastered 2011)', people: [{ name: 'X', role: 'albumartist' }] }));
    const a2 = db.put(newWork({ kind: 'album', title: 'Album', people: [{ name: 'X', role: 'albumartist' }] }));
    db.put(newWork({ kind: 'track', title: 't', parent: a1.id, disc: 2, order: 1 }));
    db.put(newWork({ kind: 'track', title: 't', parent: a1.id, disc: 1, order: 1 }));
    eq('editions', editions(db, a2.id).map((x) => x.id), [a1.id]);
    eq('discs', discs(db, a1.id).map((d) => d.disc), [1, 2]);
    const sh = db.put(newWork({ kind: 'show', title: 'Sh' }));
    db.put(newWork({ kind: 'episode', title: 'sp', parent: sh.id, special: true, episode: 1 }));
    db.put(newWork({ kind: 'episode', title: 'e', parent: sh.id, season: 1, episode: 1 }));
    eq('seasons with specials last', seasons(db, sh.id).map((s) => s.season), [1, 0]);
    const bs = db.put(newWork({ kind: 'bookseries', title: 'Saga' }));
    db.put(newWork({ kind: 'book', title: 'B2', parent: bs.id, order: 2, people: [{ name: 'Au', role: 'author' }] }));
    db.put(newWork({ kind: 'book', title: 'B1', parent: bs.id, order: 1, people: [{ name: 'Au', role: 'author' }] }));
    eq('authors / series', [authors(db).map((a) => a.books.length), bookSeries(db)[0].books.map((b) => b.title)], [[2], ['B1', 'B2']]);
    eq('section items', sectionItems(db, 'music').map((w) => w.title).sort(), ['Album', 'Album (Remastered 2011)']);
    const s = searchAll(lib, 'miles');
    eq('search all', [Object.keys(s.works), s.people.map((p) => p.name)], [['music'], ['Miles Davis']]);
  }

  // --- indexer --------------------------------------------------------------------------------------------------------
  // Real tag bytes, not mocks: WAV files with RIFF INFO from the project's own encoder, and MP3s built as an ID3v2.4
  // tag followed by 20 copies of one valid MPEG-1 Layer III frame header (0xFFFB9064 = 128 kbps, 44.1 kHz; 417-byte
  // frames, joint stereo), a minimal stream the MP3 reader accepts. The io object is an in-memory filesystem,
  // exercising the indexer's I/O-injection contract.
  {
    const wav = (title, artist, album, track) => encodeWav([new Float32Array(2205)], { sampleRate: 22050, info: { title, artist, album, track: String(track) } });
    const mp3 = (tags) => {
      const id3 = writeId3v2(tags, { version: 4 });
      const frame = new Uint8Array(417); frame.set([0xff, 0xfb, 0x90, 0x64]);
      const out = new Uint8Array(id3.length + frame.length * 20);
      out.set(id3);
      for (let i = 0; i < 20; i++) out.set(frame, id3.length + i * 417);
      return out;
    };
    const files = new Map([
      ['Music/Daft Punk/2001 - Discovery/01 One More Time.mp3', mp3({ title: 'One More Time', artist: 'Daft Punk', album: 'Discovery', track: '1/14', year: '2001', genre: 'Electronic' })],
      ['Music/Daft Punk/2001 - Discovery/02 Aerodynamic.mp3', mp3({ title: 'Aerodynamic', artist: 'Daft Punk', album: 'Discovery', track: '2/14', year: '2001', genre: 'Electronic' })],
      ['Music/Daft Punk/2001 - Discovery/cover.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
      ['Music/Mix/01 a.wav', wav('A', 'Artist One', 'Summer Mix', 1)],
      ['Music/Mix/02 b.wav', wav('B', 'Artist Two', 'Summer Mix', 2)],
      ['Music/Mix/03 c.wav', wav('C', 'Artist Three', 'Summer Mix', 3)],
      ['Anime/Hoshi no Uta/[Grp] Hoshi no Uta - 01 [1080p][ABCD1234].mkv', new Uint8Array(100)],
      ['Anime/Hoshi no Uta/[Grp] Hoshi no Uta - 02 [1080p][ABCD1235].mkv', new Uint8Array(100)],
      ['Anime/Hoshi no Uta/[Grp] Hoshi no Uta - 02 [1080p][ABCD1235].en.ass', new TextEncoder().encode('[Script Info]')],
      ['TV/The Show/Season 1/The Show - S01E01 - Pilot.mkv', new Uint8Array(100)],
      ['TV/The Show/tvshow.nfo', new TextEncoder().encode('<?xml version="1.0"?><tvshow><title>The Show</title><year>2010</year><plot>A show.</plot><genre>Drama</genre></tvshow>')],
      ['Movies/Nosferatu (1922)/Nosferatu (1922).mkv', new Uint8Array(100)],
      ['Audiobooks/Lewis Carroll/Alice/01 Down the Rabbit-Hole.mp3', mp3({ title: 'Down the Rabbit-Hole', artist: 'Lewis Carroll', album: 'Alice', track: '1' })],
      ['Audiobooks/Lewis Carroll/Alice/02 The Pool of Tears.mp3', mp3({ title: 'The Pool of Tears', artist: 'Lewis Carroll', album: 'Alice', track: '2' })],
      ['Music/.hidden/x.mp3', new Uint8Array(10)],
    ]);
    const { readMedia } = await import('../mediatags/read.js');
    const io = (fs) => ({
      list: async () => [...fs].map(([p, b]) => ({ path: p, size: b.length, mtime: 1000 })),
      readMedia: async (p) => readMedia(fs.get(p), { name: p, cover: false }),
      readText: async (p) => (fs.has(p) ? new TextDecoder().decode(fs.get(p)) : null),
      loc: (p) => ({ kind: 'fs', mount: 'm1', path: p }),
      hash: async (p) => 'h:' + fs.get(p).length + ':' + p.split('/').pop().replace(/^\d+ /, ''),
    });
    const db = createDB();
    const src = db.put(newSource('folder', { name: 'Home', hint: 'auto' }));
    const rep = await scanSource(db, db.get(src.id), io(files));
    eq('scan report', [rep.considered, rep.added, rep.errors.length], [11, 11, 0]);
    const titleOf = (kind) => db.all('work').filter((w) => w.kind === kind).map((w) => w.title).sort();
    eq('albums (folder compilation detected)', titleOf('album'), ['Discovery', 'Summer Mix']);
    const mix = db.all('work').find((w) => w.title === 'Summer Mix');
    eq('compilation album artist', [mix.compilation, facts(db, mix).albumartist], [true, ['Various Artists']]);
    const disc = db.all('work').find((w) => w.title === 'Discovery');
    eq('album from tags + folder cover + genre', [db.children(disc.id).map((t) => t.title), disc.year, !!disc.cover && disc.cover.loc.path, (disc.tags || []).includes('genre:electronic')], [['One More Time', 'Aerodynamic'], 2001, 'Music/Daft Punk/2001 - Discovery/cover.jpg', true]);
    const anime = db.all('work').find((w) => w.kind === 'show' && w.title === 'Hoshi no Uta');
    eq('anime from fansub names', [anime && facts(db, anime).domain, anime && seasonsOrEpisodes(db, anime.id)], ['anime', ['1', '2']]);
    const ep2 = db.all('work').find((w) => w.kind === 'episode' && w.episode === 2 && facts(db, w).domain === 'anime');
    eq('subtitle sidecar', ep2 && db.mediaOf(ep2.id)[0].subs.map((s) => s.lang), ['en']);
    const show = db.all('work').find((w) => w.kind === 'show' && w.title === 'The Show');
    eq('series with tvshow.nfo', [show && show.year, show && show.description, show && facts(db, show).domain, show && db.children(show.id).map((s) => s.title)], [2010, 'A show.', 'series', ['Season 1']]);
    eq('movie', db.all('work').filter((w) => w.kind === 'movie').map((w) => [w.title, w.year]), [['Nosferatu', 1922]]);
    const book = db.all('work').find((w) => w.kind === 'book');
    eq('audiobook chapters', [book && book.title, book && db.children(book.id).map((c) => c.title), book && facts(db, book).author], ['Alice', ['Down the Rabbit-Hole', 'The Pool of Tears'], ['Lewis Carroll']]);
    eq('hidden excluded', db.all('media').some((m) => m.path.includes('.hidden')), false);
    // Re-scan: nothing changed.
    const rep2 = await scanSource(db, db.get(src.id), io(files));
    eq('incremental re-scan', [rep2.added, rep2.updated, rep2.unchanged], [0, 0, 11]);
    // A locked field survives, a moved file keeps its work (hash), a deleted file becomes missing.
    const one = db.all('work').find((w) => w.title === 'One More Time');
    db.patch(one.id, { title: 'One More Time (edit)', locked: ['title'] });
    const files2 = new Map(files);
    files2.set('Music/Daft Punk/2001 - Discovery/01 One More Time.mp3', mp3({ title: 'One More Time', artist: 'Daft Punk', album: 'Discovery', track: '1/14', year: '2001', genre: 'House' }));
    const moved = files2.get('Music/Daft Punk/2001 - Discovery/02 Aerodynamic.mp3');
    files2.delete('Music/Daft Punk/2001 - Discovery/02 Aerodynamic.mp3');
    files2.set('Music/Daft Punk/Discovery/02 Aerodynamic.mp3', moved);
    files2.delete('Movies/Nosferatu (1922)/Nosferatu (1922).mkv');
    db.patch(src.id, { hashMode: 'quick' });
    for (const m of db.all('media')) db.patch(m.id, { hash: 'h:' + files.get(m.path)?.length + ':' + m.path.split('/').pop().replace(/^\d+ /, '') });
    const rep3 = await scanSource(db, db.get(src.id), io(files2));
    eq('re-scan: changed, moved, missing', [rep3.updated, rep3.moved, rep3.missing], [1, 1, 1]);
    eq('locked title kept', db.get(one.id).title, 'One More Time (edit)');
    const nos = db.all('work').find((w) => w.title === 'Nosferatu');
    eq('missing file -> nominal', presenceOf(db, nos.id), 'nominal');
    eq('planScan', Object.values(planScan(db, db.get(src.id), [])).map((x) => x.length), [0, 0, 0, 11]);
    // Templates take precedence; previews for the rule editor.
    const s2 = newSource('folder', { templates: ['{artist}/{album}/{track:02} - {title}.{ext}'], hint: 'music' });
    const prev = previewRules(s2, ['Muse/Absolution/03 - Hysteria.flac']);
    eq('template preview', [prev[0].fields.artist, prev[0].fields.album, prev[0].fields.track, prev[0].fields.title, prev[0].provenance.title], [['Muse'], 'Absolution', 3, 'Hysteria', 'template']);
    eq('analyze movie name', analyzeFile({ path: 'Movies/Metropolis.1927.1080p.BluRay.x264-GRP.mkv' }, { source: newSource('folder') }).kind, 'movie');
    eq('workKey', workKey('episode', { show: 'X', season: 1, episode: 2 }, 'anime'), 'ep:anime|x|1|2');
    // Links and yt-dlp playlists (no network: an info object as yt-dlp would print it).
    const ls = db.put(newSource('links', { hint: 'music' }));
    const lr = indexLinks(db, ls, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ Never\nhttps://example.org/song.mp3\n# comment\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ');
    eq('links: source + direct file, dedupe', [lr.added, lr.existing], [2, 1]);
    const yt = db.put(newSource('ytdlp', { hint: 'auto' }));
    const yr = indexYtdlp(db, yt, { kind: 'playlist', id: 'PL1', title: 'Mix', entries: [{ source: 'youtube:aaa', url: 'https://youtu.be/aaa', title: 'A', artist: 'X', track: 'A' }, { source: 'youtube:bbb', title: 'B', duration: 60 }] });
    eq('yt-dlp playlist', [yr.added, !!yr.playlist, db.get(yr.playlist).items.length], [2, true, 2]);
  }

  // --- exchange -------------------------------------------------------------------------------------------------------
  {
    const a = createDB();
    const w = a.put(newWork({ kind: 'movie', title: 'Film', year: 2000, ids: { imdb: 'tt1' }, tags: ['x'] }));
    a.put(newMedia(w.id, { presence: 'file', loc: { kind: 'fs', mount: 'm', path: 'f.mkv' }, source: { ref: 'youtube:q' }, name: 'f.mkv', size: 5 }));
    a.put(createCollectionNode('L', [w.id]));
    const tree = exportTree(a);
    const media = tree.nodes.find((n) => n.type === 'media');
    eq('tree without files', [tree.format, media.loc, media.presence, media.name], ['in-html-media-tree', undefined, 'source', 'f.mkv']);
    const b = createDB();
    const other = b.put(newWork({ kind: 'movie', title: 'Film', year: 2000, ids: { imdb: 'TT1' }, tags: ['y'], track: { status: 'completed' } }));
    const rep = importData(b, tree);
    eq('merge by external id', [rep.matched >= 1, b.count('work'), b.get(other.id).tags.sort(), b.get(other.id).track.status], [true, 1, ['x', 'y'], 'completed']);
    eq('references remapped', b.all('collection')[0].items[0].ref, other.id);
    const keep = createDB(); keep.put({ ...a.get(w.id), title: 'Local', updated: 1 }, { keepTime: true });
    importData(keep, exportDB(a), { policy: 'keep' });
    eq('policy keep', keep.get(w.id).title, 'Local');
    importData(keep, exportDB(a), { policy: 'newer' });
    eq('policy newer', keep.get(w.id).title, 'Film');
    const copy = createDB();
    importData(copy, exportDB(a), { policy: 'copy' }); importData(copy, exportDB(a), { policy: 'copy' });
    eq('policy copy', copy.count('work'), 2);
    const zip = await exportZip(a, { blobs: { list: () => ['b1'], get: () => ({ type: 'image/png', bytes: new Uint8Array([1, 2, 3]) }) } });
    const back = await readExchange(zip);
    eq('zip round trip', [back.format, back.data.nodes.length, [...back.blobs.get('b1').bytes]], ['in-html-media-db', 3, [1, 2, 3]]);
    eq('json text', (await readExchange(JSON.stringify(tree))).data.nodes.length, 3);
  }

  // --- interop --------------------------------------------------------------------------------------------------------
  {
    const xml = `<?xml version="1.0" encoding="UTF-8" ?><myanimelist><myinfo><user_name>me</user_name></myinfo>
      <anime><series_animedb_id>16498</series_animedb_id><series_title><![CDATA[Shingeki no Kyojin]]></series_title><series_type>TV</series_type><series_episodes>25</series_episodes><my_watched_episodes>25</my_watched_episodes><my_start_date>2020-01-02</my_start_date><my_finish_date>2020-02-03</my_finish_date><my_score>9</my_score><my_status>Completed</my_status><my_times_watched>1</my_times_watched><my_rewatching>0</my_rewatching><my_tags><![CDATA[action, dark]]></my_tags><my_comments><![CDATA[]]></my_comments></anime>
      <anime><series_animedb_id>25777</series_animedb_id><series_title><![CDATA[Shingeki no Kyojin Season 2]]></series_title><series_type>TV</series_type><series_episodes>12</series_episodes><my_watched_episodes>4</my_watched_episodes><my_start_date>0000-00-00</my_start_date><my_finish_date>0000-00-00</my_finish_date><my_score>0</my_score><my_status>Watching</my_status><my_times_watched>0</my_times_watched><my_rewatching>0</my_rewatching></anime>
      <manga><series_title>x</series_title></manga></myanimelist>`;
    const p = parseMal(xml);
    eq('parse MAL', [p.user, p.entries.length, p.entries[0].score, p.skipped.manga], ['me', 2, 9, 1]);
    eq('season titles', [splitSeasonTitle('X Season 2'), splitSeasonTitle('X 2nd Season'), splitSeasonTitle('X S3'), splitSeasonTitle('Plain')], [{ show: 'X', season: 2 }, { show: 'X', season: 2 }, { show: 'X', season: 3 }, null]);
    const db = createDB();
    const r = importMal(db, xml);
    const show = db.all('work').find((w) => w.kind === 'show');
    const s2 = db.all('work').find((w) => w.kind === 'season');
    eq('import MAL: show + season 2', [r.entries, show.title, show.track.status, s2.season, s2.parent === show.id, s2.track.progress, s2.ids.mal, show.tags], [2, 'Shingeki no Kyojin', 'completed', 2, true, 4, '25777', ['mal:action', 'mal:dark']]);
    importMal(db, xml);
    eq('re-import matches by id', db.count('work'), 2);
    const out = exportMal(db, { user: 'me' });
    const again = parseMal(out);
    eq('export MAL round trip', again.entries.map((e) => [e.malId, e.title, e.status, e.watched, e.score]), [['16498', 'Shingeki no Kyojin', 'Completed', 25, 9], ['25777', 'Shingeki no Kyojin Season 2', 'Watching', 4, 0]]);
    const shiki = JSON.parse(exportShikimori(db));
    eq('export Shikimori', shiki.map((x) => [x.target_id, x.status, x.episodes]), [[16498, 'completed', 25], [25777, 'watching', 4]]);
    const db2 = createDB();
    const rs = importShikimori(db2, JSON.stringify([{ target_title: 'Hoshi', target_title_ru: 'Хоси', target_id: 5, target_type: 'Anime', score: 7, status: 'rewatching', rewatches: 2, episodes: 3, text: 'note' }, { target_type: 'Manga' }]));
    const h = db2.all('work')[0];
    eq('import Shikimori', [rs.entries, h.track.status, h.track.repeats, h.titles.ru, h.track.notes], [1, 'repeating', 2, 'Хоси', 'note']);
    // playlists
    const pl = createDB();
    const t = pl.put(newWork({ kind: 'track', title: 'Hysteria', people: [{ name: 'Muse', role: 'artist' }], duration: 227 }));
    pl.put(newMedia(t.id, { presence: 'file', loc: { kind: 'fs', mount: 'm', path: 'Muse/Hysteria.flac' } }));
    const c = pl.put(createCollectionNode('Rock', [t.id]));
    const m3u = playlistM3u(pl, c);
    ok('m3u export', m3u.startsWith('#EXTM3U') && m3u.includes('#EXTINF:227,Muse - Hysteria') && m3u.includes('Muse/Hysteria.flac'), m3u);
    const ir = importPlaylist(pl, '#EXTM3U\n#EXTINF:227,Muse - Hysteria\nD:/Music/Muse/Hysteria.flac\n#EXTINF:100,Other - Unknown\nhttps://example.org/u.mp3\n', { name: 'Imported' });
    eq('m3u import: matched + created', [ir.matched, ir.created], [1, 1]);
    const nfo = workNfo(pl, pl.put(newWork({ kind: 'movie', title: 'Film & Co', year: 1999, tags: ['genre:drama'] })));
    ok('nfo export', nfo.name === 'movie.nfo' && nfo.text.includes('<title>Film &amp; Co</title>') && nfo.text.includes('<genre>drama</genre>'), nfo.text);
    const al = pl.put(newWork({ kind: 'album', title: 'Al', people: [{ name: 'Band', role: 'albumartist' }] }));
    pl.put(newWork({ kind: 'track', title: 'One', parent: al.id, order: 1, duration: 61.5 }));
    pl.put(newWork({ kind: 'track', title: 'Two', parent: al.id, order: 2, duration: 30 }));
    const cue = albumCue(pl, al.id, { file: 'al.flac' });
    ok('cue export', cue.includes('TITLE "Al"') && cue.includes('TRACK 02 AUDIO') && cue.includes('INDEX 01 01:01:38'), cue);
  }

  // --- demo -----------------------------------------------------------------------------------------------------------
  // Demo nodes are passed through normNode here (unlike the app, which trusts them) to prove the demo is valid data
  // under the import rules. Peak <= 0.81 checks the 0.8 normalisation with float tolerance.
  {
    const s = synthesize({ notes: [[60, 1]], bpm: 60, seconds: 1 }, 8000);
    eq('synth', [s.length, Math.max(...s) <= 0.81], [8000, true]);
    const d = buildDemo({ seconds: 1, sampleRate: 8000, now: NOW });
    const db = createDB({ nodes: d.nodes.map(normNode) });
    const levels = new Set(db.all('work').map((w) => facts(db, w).presence));
    eq('demo: every presence level', [...levels].sort(), ['file', 'nominal', 'source']);
    const domains = new Set(db.all('work').map((w) => facts(db, w).domain));
    eq('demo: every domain', [...domains].sort(), ['anime', 'audiobook', 'movie', 'music', 'podcast']);
    eq('demo: blobs are WAV', [d.blobs.length, String.fromCharCode(...d.blobs[0].bytes.subarray(0, 4))], [7, 'RIFF']);
    eq('demo: all tagged', db.all().every((n) => (n.tags || []).includes(DEMO_TAG)), true);
    eq('demo: smart / mood playlists resolve', db.all('collection').map((c) => itemsOf(db, c, { now: NOW }).length > 0), [true, true, true, true]);
    eq('demo: continue list', continueList(db).length > 0, true);
    eq('demo: keys', keysOf(db.all('work').find((w) => w.kind === 'show')).filter((k) => k.startsWith('t:')).length, 3);
  }

  setClock(null);
  console.log(`catalog: ${pass} passed, ${fail} failed`);
  return fail;
}

// Raw collection node for tests that bypass newCollection. Math.random ids are fine here: only uniqueness within
// one test db matters, and ids are never asserted on.
function createCollectionNode(name, ids) {
  return { id: 'c' + Math.random().toString(36).slice(2, 9), type: 'collection', kind: 'playlist', name, items: ids.map((ref) => ({ ref })), tags: [], created: 1, updated: 1 };
}

function seasonsOrEpisodes(db, showId) {
  const out = [];
  const walk = (id) => { for (const c of db.children(id)) { if (c.kind === 'episode') out.push(String(c.episode ?? c.absolute)); else walk(c.id); } };
  walk(showId);
  return out;
}

if (isMain) run().then((f) => { process.exitCode = f ? 1 : 0; });
