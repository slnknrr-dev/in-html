// media-player/manage.js - organising: playlists (manual with reordering, smart with a live query editor, mood / time
// of day, groups of playlists; collage covers; M3U8 / XSPF export), the virtual tag manager (namespaces, hierarchy,
// aliases, implications, colours, rename / merge / delete), tracking lists like MyAnimeList (status tabs, scores,
// progress; MyAnimeList XML and Shikimori JSON import / export from files) with statistics, and workspaces (folder
// trees of references with virtual folders, their own skin and layout).

import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { toast, promptDialog, confirmDialog, openDialog } from '../ui/overlays.js';
import { download } from '../ui/app.js';
import { pickFiles } from '../ui/files.js';
import { facts } from '../catalog/facts.js';
import { parseQuery, explain } from '../catalog/query.js';
import { itemsOf, createCollection, moveItem, removeItems, addItems, collectionDuration } from '../catalog/collections.js';
import { SMART_PRESETS } from '../catalog/smart.js';
import { allTags, defineTag, mergeTags, deleteTag, tagKey, NAMESPACES, parseTag } from '../catalog/tags.js';
import { STATUSES } from '../catalog/model.js';
import { setStatus, setScore, setProgress, stats } from '../catalog/tracking.js';
import { importMal, exportMal, importShikimori, exportShikimori, playlistM3u, playlistXspf } from '../catalog/interop.js';
import { createWorkspace, addFolder, updateFolder, removeFolder, moveFolder, folderItems, findFolder, walkFolders } from '../catalog/workspaces.js';
import { BUILTIN_SKINS } from '../player/skins.js';
import { BUILTIN_LAYOUTS } from '../player/layouts.js';
import { workRow, workCard, coverEl, tagChip, section, grid, shelf, empty, btn, iconBtn, tabs, fmtDuration, iconEl, inputRow, textField, selectField, checkField } from './ui.js';
import { header, collCard } from './views.js';

// --- playlists ----------------------------------------------------------------------------------------------------------

function playlists(app, main) {
  const { db } = app;
  main.append(header(t('mp.nav.playlists'), null,
    btn(t('mp.pl.new'), 'plus', async () => { const n = await promptDialog(t('mp.pl.new'), t('mp.name'), ''); if (n) app.nav('playlist/' + createCollection(db, 'playlist', { name: n }).id); }, 'primary'),
    btn(t('mp.pl.newSmart'), 'wand', async () => { const n = await promptDialog(t('mp.pl.newSmart'), t('mp.name'), ''); if (n) app.nav('playlist/' + createCollection(db, 'smart', { name: n, query: '', pick: 'all', sort: 'title' }).id); }),
    btn(t('mp.pl.newMood'), 'moon', () => app.nav('playlist/' + createCollection(db, 'mood', { name: t('mp.pl.moodName'), tod: 'auto', kinds: ['track'] }).id)),
    btn(t('mp.pl.newGroup'), 'layers', async () => { const n = await promptDialog(t('mp.pl.newGroup'), t('mp.name'), ''); if (n) app.nav('playlist/' + createCollection(db, 'group', { name: n, children: [] }).id); }),
    btn(t('mp.pl.import'), 'upload', async () => { const [f] = await pickFiles({ accept: '.m3u,.m3u8,.xspf,.pls' }); if (!f) return; const { importPlaylist } = await import('../catalog/interop.js'); const r = importPlaylist(db, await f.text(), { name: f.name.replace(/\.[^.]+$/, '') }); toast(t('mp.pl.imported', r), 'ok'); app.nav('playlist/' + r.collection); })));
  const colls = db.all('collection');
  main.append(colls.length ? grid(colls.map((c) => collCard(app, c))) : empty(t('mp.pl.empty')));
  main.append(section(t('mp.pl.presets'), h('div', { class: 'mp-chips' }, SMART_PRESETS.map((p) => h('button', { type: 'button', class: 'mp-chip', onclick: () => app.nav('playlist/' + createCollection(db, 'smart', { name: t('mp.smart.' + p.id), query: p.query, kinds: p.kinds, sort: p.sort, pick: p.pick, limit: p.limit, spread: p.spread, playable: p.playable }).id) }, iconEl('wand'), t('mp.smart.' + p.id))))));
}

// Smart playlist = stored query + options, evaluated live (catalog/smart.js), never a stored list of ids, so new
// matching works appear automatically. The query is parsed on every keystroke only to explain it (explain(ast)) and
// show warnings; it is saved on `change` (blur / Enter) to avoid a catalogue write per character.
function smartEditor(app, c, onChange) {
  const { db } = app;
  const q = textField(c.query || '', () => {}, { multiline: true, rows: 3, placeholder: 'genre:jazz mood:calm -kind:show', 'aria-label': t('mp.pl.query') });
  const info = h('p', { class: 'mp-muted mp-explain' });
  const upd = () => { const p = parseQuery(q.value); info.textContent = explain(p.ast) + (p.warnings.length ? ' · ' + p.warnings.join(', ') : ''); };
  q.addEventListener('input', upd);
  q.addEventListener('change', () => { db.patch(c.id, { query: q.value }); onChange(); });
  upd();
  const kinds = ['track', 'album', 'episode', 'show', 'movie', 'book', 'chapter', 'musicvideo'];
  const kindBox = h('div', { class: 'mp-chips' }, kinds.map((k) => { const on = (c.kinds || []).includes(k); return h('button', { type: 'button', class: 'mp-chip' + (on ? ' mp-on' : ''), onclick: () => { const ks = new Set(c.kinds || []); if (on) ks.delete(k); else ks.add(k); db.patch(c.id, { kinds: [...ks] }); onChange(); } }, t('mp.kind.' + k)); }));
  const pick = selectField(['all', 'random', 'top-rated', 'most-played', 'least-played', 'newest', 'oldest', 'forgotten'].map((p) => [p, t('mp.pick.' + p)]), c.pick || 'all', (v) => { db.patch(c.id, { pick: v }); onChange(); });
  const sort = selectField([['title', t('mp.sort.title')], ['artist album track', t('mp.sort.artist')], ['-added', t('mp.sort.added')], ['-year', t('mp.sort.year')], ['-plays', t('mp.sort.plays')], ['-score', t('mp.sort.score')], ['random', t('mp.sort.random')]], c.sort || 'title', (v) => { db.patch(c.id, { sort: v }); onChange(); });
  const lim = c.limit || {};
  const count = h('input', { type: 'number', class: 'ed-input mp-num', min: 0, value: lim.count || '', placeholder: '∞' });
  const minutes = h('input', { type: 'number', class: 'ed-input mp-num', min: 0, value: lim.minutes || '', placeholder: '∞' });
  const saveLim = () => { db.patch(c.id, { limit: { count: Number(count.value) || undefined, minutes: Number(minutes.value) || undefined } }); onChange(); };
  count.addEventListener('change', saveLim); minutes.addEventListener('change', saveLim);
  const spread = selectField([['', t('mp.spread.none')], ['artist', t('mp.spread.artist')], ['album', t('mp.spread.album')], ['show', t('mp.spread.show')]], c.spread || '', (v) => { db.patch(c.id, { spread: v || undefined }); onChange(); });
  const playable = checkField(t('mp.pl.onlyPlayable'), c.playable !== false, (v) => { db.patch(c.id, { playable: v }); onChange(); });
  const parts = [inputRow(t('mp.pl.query'), q), info, inputRow(t('mp.pl.kinds'), kindBox), h('div', { class: 'mp-formrow' }, inputRow(t('mp.pl.pick'), pick), inputRow(t('mp.sort'), sort), inputRow(t('mp.pl.count'), count), inputRow(t('mp.pl.minutes'), minutes), inputRow(t('mp.pl.spread'), spread)), playable];
  if (c.kind === 'mood') parts.splice(0, 0, inputRow(t('mp.pl.tod'), selectField(['auto', 'morning', 'afternoon', 'evening', 'night'].map((x) => [x, t('mp.tod.' + x)]), c.tod || 'auto', (v) => { db.patch(c.id, { tod: v }); onChange(); })));
  return h('div', { class: 'mp-card-box mp-smart' }, ...parts);
}

function playlistPage(app, main, [id]) {
  const { db } = app;
  const c = db.get(id);
  if (!c) { main.append(empty(t('mp.notFound'))); return; }
  const items = itemsOf(db, c);
  const top = h('div', { class: 'mp-hero' },
    h('div', { class: 'mp-hero-art mp-collage' }, ...(c.cover ? [coverEl(db, c, { size: 512 })] : items.slice(0, 4).length >= 4 ? items.slice(0, 4).map((w) => coverEl(db, w, { size: 256 })) : [coverEl(db, items[0] || c, { size: 512 })])),
    h('div', { class: 'mp-hero-info' }, h('div', { class: 'mp-kicker' }, t('mp.coll.' + c.kind)), h('h1', { class: 'mp-h1' }, c.name || t('mp.untitled')),
      h('p', { class: 'mp-sub' }, [t('mp.nItems', { n: items.length }), fmtDuration(collectionDuration(db, c))].filter(Boolean).join(' · ')),
      c.description ? h('p', { class: 'mp-desc' }, c.description) : null,
      h('div', { class: 'mp-actions' },
        btn(t('mp.playAll'), 'play', () => app.playList(items), 'primary'), btn(t('mp.shuffle'), 'shuffle', () => app.playList(items, { shuffle: 'artist' })),
        btn(t('mp.rename'), 'edit', async () => { const n = await promptDialog(t('mp.rename'), t('mp.name'), c.name || ''); if (n) db.patch(c.id, { name: n }); }),
        btn(t('mp.cover.edit'), 'palette', () => app.nav('studio/covers?target=' + c.id)),
        btn('M3U8', 'download', () => download(playlistM3u(db, c), (c.name || 'playlist') + '.m3u8', 'audio/x-mpegurl')),
        btn('XSPF', 'download', () => download(playlistXspf(db, c), (c.name || 'playlist') + '.xspf', 'application/xspf+xml')),
        btn(t('mp.delete'), 'trash', async () => { if (await confirmDialog(t('mp.delete'), t('mp.pl.deleteQ', { name: c.name }), t('mp.delete'), true)) { db.remove(c.id); app.nav('playlists'); } }, 'danger'))));
  main.append(top);
  if (c.kind === 'smart' || c.kind === 'mood') main.append(smartEditor(app, c, () => app.refresh()));
  if (c.kind === 'group') {
    const others = db.all('collection').filter((x) => x.id !== c.id);
    main.append(section(t('mp.pl.members'), h('div', { class: 'mp-chips' }, others.map((o) => { const on = (c.children || []).includes(o.id); return h('button', { type: 'button', class: 'mp-chip' + (on ? ' mp-on' : ''), onclick: () => db.patch(c.id, { children: on ? c.children.filter((x) => x !== o.id) : [...(c.children || []), o.id] }) }, o.name); }))));
  }
  if (c.kind === 'playlist') {
    const raw = c.items || [];
    main.append(h('div', { class: 'mp-list mp-sortable' }, raw.map((it, i) => {
      const w = db.get(typeof it === 'string' ? it : it.ref);
      if (!w) return null;
      const row = workRow(app, w, { onPlay: (x) => app.playWork(x, { list: items }), onOpen: (x) => app.playWork(x, { list: items }) });
      row.draggable = true;
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-mp-index', String(i)); });
      row.addEventListener('dragover', (e) => e.preventDefault());
      // KNOWN DEFECT: dropping anything else on a row (a file, a link) makes getData return '', Number('') is 0 and
      // finite, so the first item is moved to this position. Fix: read the string first and return when it is empty.
      row.addEventListener('drop', (e) => { e.preventDefault(); const from = Number(e.dataTransfer.getData('text/x-mp-index')); if (Number.isFinite(from)) moveItem(db, c.id, from, i); });
      row.querySelector('.mp-row-r').prepend(iconBtn('up', t('mp.moveUp'), (e) => { e.stopPropagation(); moveItem(db, c.id, i, i - 1); }), iconBtn('close', t('mp.remove'), (e) => { e.stopPropagation(); removeItems(db, c.id, [i]); }));
      return row;
    })));
    if (!raw.length) main.append(empty(t('mp.pl.emptyItems')));
  } else main.append(items.length ? h('div', { class: 'mp-list' }, items.slice(0, 1000).map((w) => workRow(app, w, { onPlay: (x) => app.playWork(x, { list: items }) }))) : empty(t('mp.pl.noMatches')));
}

// --- tags ------------------------------------------------------------------------------------------------------------

function tagsView(app, main) {
  const { db } = app;
  const list = allTags(db);
  main.append(header(t('mp.nav.tags'), t('mp.tags.sub'), btn(t('mp.tags.define'), 'plus', () => editTag(app, null), 'primary')));
  const byNs = new Map();
  for (const x of list) { const { ns } = parseTag(x.key); const k = ns || '#'; if (!byNs.has(k)) byNs.set(k, []); byNs.get(k).push(x); }
  if (!list.length) main.append(empty(t('mp.tags.empty')));
  for (const [ns, tags] of [...byNs].sort((a, b) => a[0].localeCompare(b[0]))) {
    const hint = NAMESPACES.find((n) => n.ns === ns);
    main.append(section(ns === '#' ? t('mp.tags.plain') : ns + ':', hint ? h('p', { class: 'mp-muted' }, hint.hint) : null, h('div', { class: 'mp-taglist' }, tags.map((x) => {
      const depth = parseTag(x.key).path.length - 1;
      return h('div', { class: 'mp-tagrow', style: { paddingInlineStart: depth * 18 + 'px' } }, tagChip(db, x.key, { onClick: (k) => app.nav('tag/' + encodeURIComponent(k)) }), h('span', { class: 'mp-muted' }, String(x.count)),
        x.def && (x.def.implies || []).length ? h('span', { class: 'mp-muted' }, '→ ' + x.def.implies.join(', ')) : null, x.def && (x.def.aliases || []).length ? h('span', { class: 'mp-muted' }, '= ' + x.def.aliases.join(', ')) : null,
        h('span', { class: 'ed-spacer' }), iconBtn('edit', t('mp.edit'), () => editTag(app, x.key)));
    }))));
  }
}

async function editTag(app, key) {
  const { db } = app;
  const d = key ? db.all('tagdef').find((x) => tagKey(x.name) === key) : null;
  const name = textField(d ? d.name : key || '', () => {}, { placeholder: 'mood:calm' });
  const label = textField(d && d.label || '', () => {}, {});
  const aliases = textField(d ? (d.aliases || []).join(', ') : '', () => {}, { placeholder: 'mood:chill, mood:relaxed' });
  const implies = textField(d ? (d.implies || []).join(', ') : '', () => {}, { placeholder: 'energy:low' });
  const color = h('input', { type: 'color', class: 'mp-color', value: d && d.color || '#5b8cff' });
  const rename = textField('', () => {}, { placeholder: t('mp.tags.renamePh') });
  const body = h('div', { class: 'mp-form' }, inputRow(t('mp.tags.name'), name, t('mp.tags.nameHint')), inputRow(t('mp.tags.label'), label), inputRow(t('mp.tags.aliases'), aliases), inputRow(t('mp.tags.implies'), implies, t('mp.tags.impliesHint')), inputRow(t('mp.tags.color'), color),
    key ? inputRow(t('mp.tags.renameMerge'), rename, t('mp.tags.renameHint')) : null);
  const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const v = await openDialog({ title: key ? t('mp.tags.edit') : t('mp.tags.define'), body, buttons: [...(key ? [{ label: t('mp.delete'), value: 'delete', danger: true }] : []), { label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), value: 'ok', primary: true }] });
  if (v === 'delete' && await confirmDialog(t('mp.delete'), t('mp.tags.deleteQ', { tag: key }), t('mp.delete'), true)) { deleteTag(db, key); return; }
  if (v !== 'ok' || !name.value.trim()) return;
  defineTag(db, name.value.trim(), { label: label.value.trim() || undefined, color: color.value, aliases: list(aliases.value), implies: list(implies.value) });
  if (key && rename.value.trim()) mergeTags(db, [key], rename.value.trim());
}

// --- tracking ------------------------------------------------------------------------------------------------------

const TRACK_KINDS = { anime: ['show', 'season', 'movie'], series: ['show', 'season'], movie: ['movie'], audiobook: ['book'], music: ['album'] };

// Tracking mirrors MyAnimeList's model (status tabs, score, progress) so its XML export / import round-trips.
function tracking(app, main, [domain = 'anime', status = 'current']) {
  const { db } = app;
  main.append(header(t('mp.nav.tracking'), null,
    btn(t('mp.stats'), 'chart', () => app.nav('stats')),
    btn(t('mp.track.importMal'), 'upload', async () => { const [f] = await pickFiles({ accept: '.xml,.gz' }); if (!f) return; try { const r = importMal(db, await f.text()); toast(t('mp.track.imported', { n: r.entries, a: r.added, u: r.updated }), 'ok'); } catch (e) { toast(e.message, 'error'); } }),
    btn(t('mp.track.importShiki'), 'upload', async () => { const [f] = await pickFiles({ accept: '.json' }); if (!f) return; try { const r = importShikimori(db, await f.text()); toast(t('mp.track.imported', { n: r.entries, a: r.added, u: r.updated }), 'ok'); } catch (e) { toast(e.message, 'error'); } }),
    btn(t('mp.track.exportMal'), 'download', () => download(exportMal(db, {}), 'animelist.xml', 'application/xml')),
    btn(t('mp.track.exportShiki'), 'download', () => download(exportShikimori(db), 'shikimori.json', 'application/json'))));
  main.append(tabs(Object.keys(TRACK_KINDS).map((d) => [d, t('mp.domain.' + d)]), domain, (k) => app.nav('tracking/' + k + '/' + status)));
  const all = db.all('work').filter((w) => TRACK_KINDS[domain].includes(w.kind) && facts(db, w).domain === domain && (w.track || !w.parent));
  const counts = Object.fromEntries(['all', ...STATUSES].map((s) => [s, s === 'all' ? all.length : all.filter((w) => w.track && w.track.status === s).length]));
  const fam = domain === 'audiobook' ? 'book' : domain === 'music' ? 'music' : 'video';
  main.append(tabs(['all', ...STATUSES].map((s) => [s, (s === 'all' ? t('mp.all') : t('mp.status.' + s + '.' + fam)) + ` (${counts[s]})`]), status, (k) => app.nav('tracking/' + domain + '/' + k)));
  const list = all.filter((w) => status === 'all' || (w.track && w.track.status === status)).sort((a, b) => (b.track?.updated || 0) - (a.track?.updated || 0));
  if (!list.length) { main.append(empty(t('mp.track.empty'))); return; }
  const table = h('div', { class: 'mp-tracktable', role: 'table' }, h('div', { class: 'mp-tt-h', role: 'row' }, h('span', {}, ''), h('span', {}, t('mp.title')), h('span', {}, t('mp.track.status')), h('span', {}, t('mp.track.score')), h('span', {}, t('mp.track.progress')), h('span', {}, t('mp.type'))));
  for (const w of list) {
    const f = facts(db, w);
    const tr = w.track || {};
    const total = f.total || db.children(w.id).filter((c) => !c.special).length || (w.kind === 'movie' ? 1 : 0);
    const st = selectField([['', '—'], ...STATUSES.map((s) => [s, t('mp.status.' + s + '.' + fam)])], tr.status || '', (v) => (v ? setStatus(db, w.id, v) : db.patch(w.id, { track: undefined })));
    const sc = selectField([['', '—'], ...Array.from({ length: 10 }, (_, i) => [String(10 - i), String(10 - i)])], tr.score ? String(Math.round(tr.score)) : '', (v) => setScore(db, w.id, v ? Number(v) : null));
    const parentTitle = w.kind === 'season' && w.parent && db.get(w.parent) ? db.get(w.parent).title + ' · ' : '';
    table.append(h('div', { class: 'mp-tt-r', role: 'row' }, coverEl(db, w, { size: 96, cls: 'mp-tt-cover' }), h('a', { href: '#/work/' + w.id }, parentTitle + f.title), st, sc,
      h('span', { class: 'mp-inline' }, iconBtn('minus', '-1', () => setProgress(db, w.id, (tr.progress || 0) - 1)), h('b', {}, `${tr.progress || 0}${total ? '/' + total : ''}`), iconBtn('plus', '+1', () => setProgress(db, w.id, (tr.progress || 0) + 1))),
      h('span', { class: 'mp-muted' }, f.format ? t('mp.format.' + f.format) : t('mp.kind.' + w.kind))));
  }
  main.append(table);
}

function bars(rows, { fmt = String, max = null } = {}) {
  const m = max || Math.max(1, ...rows.map((r) => r[1]));
  return h('div', { class: 'mp-bars' }, rows.map(([label, v]) => h('div', { class: 'mp-barrow' }, h('span', { class: 'mp-sb-l' }, String(label)), h('span', { class: 'mp-sb-t' }, h('i', { style: { width: Math.round((v / m) * 100) + '%' } })), h('span', { class: 'mp-sb-v' }, fmt(v)))));
}

function statsView(app, main) {
  const { db } = app;
  const s = stats(db, { now: Date.now() });
  const hours = (sec) => (sec / 3600).toFixed(1) + ' ' + t('mp.hoursShort');
  main.append(header(t('mp.stats'), t('mp.stats.sub', { plays: s.plays, hours: (s.seconds / 3600).toFixed(1) })));
  main.append(h('div', { class: 'mp-kpis' }, [[t('mp.stats.plays'), s.plays], [t('mp.stats.time'), hours(s.seconds)], [t('mp.stats.completed'), s.completed], [t('mp.stats.mean'), s.meanScore ?? '—'], [t('mp.stats.streak'), t('mp.stats.days', { n: s.streak.current })], [t('mp.stats.longest'), t('mp.stats.days', { n: s.streak.longest })]].map(([k, v]) => h('div', { class: 'mp-kpi' }, h('b', {}, String(v)), h('span', {}, k)))));
  main.append(section(t('mp.stats.byDomain'), bars(Object.entries(s.byDomain).map(([d, x]) => [t('mp.domain.' + d), x.seconds]), { fmt: hours })));
  main.append(section(t('mp.stats.scores'), bars(s.scores.map((n, i) => [i, n]).slice(1).reverse())));
  if (s.genres.length) main.append(section(t('mp.music.genres'), bars(s.genres, { fmt: hours })));
  if (s.artists.length) main.append(section(t('mp.stats.artists'), bars(s.artists)));
  if (s.shows.length) main.append(section(t('mp.stats.shows'), bars(s.shows, { fmt: hours })));
  main.append(section(t('mp.stats.hours'), h('div', { class: 'mp-hourmap' }, s.byHour.map((v, i) => h('i', { title: `${i}:00 · ${hours(v)}`, style: { '--v': String(v / Math.max(1, ...s.byHour)) } })))));
  const days = new Map(s.byDay);
  const cells = [];
  const today = Date.now();
  for (let i = 181; i >= 0; i--) { const d = new Date(today - i * 864e5).toISOString().slice(0, 10); cells.push(h('i', { title: d, style: { '--v': String(Math.min(1, (days.get(d) || 0) / 3600)) } })); }
  main.append(section(t('mp.stats.days180'), h('div', { class: 'mp-daymap' }, cells)));
  for (const [d, st] of Object.entries(s.statuses)) main.append(section(t('mp.domain.' + d), bars(Object.entries(st).map(([k, v]) => [t('mp.status.' + k + '.' + (d === 'audiobook' ? 'book' : d === 'music' ? 'music' : 'video')), v]))));
  if (s.years.length) main.append(section(t('mp.music.years'), bars(s.years.slice(-30))));
}

// --- workspaces ------------------------------------------------------------------------------------------------------

function workspaces(app, main, [wsId, folderId]) {
  const { db } = app;
  const list = db.all('workspace');
  const ws = db.get(wsId) || list[0] || null;
  main.append(header(t('mp.nav.workspaces'), t('mp.ws.sub'), btn(t('mp.ws.new'), 'plus', async () => { const n = await promptDialog(t('mp.ws.new'), t('mp.name'), ''); if (n) app.nav('workspaces/' + createWorkspace(db, n).id); }, 'primary')));
  if (!ws) { main.append(empty(t('mp.ws.empty'))); return; }
  if (list.length > 1) main.append(tabs(list.map((w) => [w.id, w.name || t('mp.untitled')]), ws.id, (k) => app.nav('workspaces/' + k)));
  const folder = folderId ? findFolder(ws.root, folderId) : null;
  const cur = folder ? folder.folder : ws.root;
  const tree = h('div', { class: 'mp-tree', role: 'tree' });
  walkFolders(ws.root, (f, depth) => {
    if (depth === 0) return;
    const row = h('a', { class: 'mp-tree-row' + (f.id === cur.id ? ' mp-on' : ''), href: `#/workspaces/${ws.id}/${f.id}`, role: 'treeitem', style: { paddingInlineStart: depth * 16 + 'px' }, draggable: 'true', dataset: { focus: '1' } }, iconEl(f.query ? 'wand' : 'folder'), h('span', {}, f.name || t('mp.untitled')));
    row.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/x-mp-folder', f.id));
    row.addEventListener('dragover', (e) => e.preventDefault());
    row.addEventListener('drop', (e) => { e.preventDefault(); const from = e.dataTransfer.getData('text/x-mp-folder'); const ref = e.dataTransfer.getData('text/x-mp-work'); if (from && from !== f.id) moveFolder(db, ws.id, from, f.id); if (ref) import('../catalog/workspaces.js').then((m) => m.addRefs(db, ws.id, f.id, [ref])); });
    tree.append(row);
  });
  const items = folderItems(db, ws, cur.id);
  const side = h('div', { class: 'mp-ws-side' }, h('a', { class: 'mp-tree-row' + (cur === ws.root ? ' mp-on' : ''), href: '#/workspaces/' + ws.id }, iconEl('home'), h('b', {}, ws.name)), tree,
    h('div', { class: 'mp-actions' }, btn(t('mp.ws.folder'), 'plus', async () => { const n = await promptDialog(t('mp.ws.folder'), t('mp.name'), ''); if (n) addFolder(db, ws.id, cur === ws.root ? null : cur.id, n); }),
      btn(t('mp.ws.virtual'), 'wand', async () => { const q = await promptDialog(t('mp.ws.virtual'), t('mp.pl.query'), 'mood:calm'); if (q) addFolder(db, ws.id, cur === ws.root ? null : cur.id, q, { query: q }); })));
  const settingsBox = h('div', { class: 'mp-formrow' },
    inputRow(t('mp.ws.skin'), selectField([['', t('mp.default')], ...BUILTIN_SKINS.map((s) => [s.id, s.name]), ...db.all('skin').map((s) => [s.id, s.name])], ws.skin || '', (v) => { db.patch(ws.id, { skin: v || undefined }); if (v) { app.settings.skin = v; app.applySkin(); } })),
    inputRow(t('mp.ws.layout'), selectField([['', t('mp.default')], ...BUILTIN_LAYOUTS.map((l) => [l.id, l.name]), ...db.all('layout').map((l) => [l.id, l.name])], ws.layout || '', (v) => db.patch(ws.id, { layout: v || undefined }))),
    inputRow(t('mp.ws.view'), selectField(['auto', 'desktop', 'mobile', 'theatre'].map((v) => [v, t('mp.view.' + v)]), ws.view || 'auto', (v) => { db.patch(ws.id, { view: v }); app.setView(v); })));
  const content = h('div', { class: 'mp-ws-main' },
    h('div', { class: 'mp-head' }, h('h2', {}, cur.name || ws.name), h('div', { class: 'mp-actions' },
      btn(t('mp.playAll'), 'play', () => app.playList(items.filter((n) => n.type === 'work'))),
      cur !== ws.root ? btn(t('mp.rename'), 'edit', async () => { const n = await promptDialog(t('mp.rename'), t('mp.name'), cur.name); if (n) updateFolder(db, ws.id, cur.id, { name: n }); }) : null,
      cur !== ws.root ? btn(t('mp.ws.query'), 'wand', async () => { const q = await promptDialog(t('mp.ws.query'), t('mp.pl.query'), cur.query || ''); if (q !== null) updateFolder(db, ws.id, cur.id, { query: q || undefined }); }) : null,
      cur !== ws.root ? btn(t('mp.delete'), 'trash', () => { removeFolder(db, ws.id, cur.id); app.nav('workspaces/' + ws.id); }, 'danger') : btn(t('mp.ws.deleteWs'), 'trash', async () => { if (await confirmDialog(t('mp.delete'), t('mp.ws.deleteQ'), t('mp.delete'), true)) { db.remove(ws.id); app.nav('workspaces'); } }, 'danger'))),
    cur.query ? h('p', { class: 'mp-muted' }, t('mp.ws.queryIs', { q: cur.query })) : null, settingsBox,
    items.length ? grid(items.map((n) => (n.type === 'collection' ? collCard(app, n) : workCard(app, n)))) : empty(t('mp.ws.emptyFolder')));
  main.append(h('div', { class: 'mp-ws' }, side, content));
}

export const MANAGE_VIEWS = { playlists, playlist: playlistPage, tags: tagsView, tracking, stats: statsView, workspaces };
export { editTag };
