// media-player/edit.js - changing the catalogue by hand: the context menu of a work (play, play next, queue, add to a
// playlist or workspace folder, tags, tracking, presence actions, convert, export NFO / CUE, cover, delete), the work
// editor (fields of the kind, people with roles, alternative titles, tags with suggestions, lyrics with a tap-to-sync
// tool, intro / outro markers, external ids; edited fields become locked so scans keep them), the presence dialog
// (attach a file, a link or a yt-dlp reference; download or stream it with yt-dlp; nominal information), the "add
// media" flow (files, folders, links, nominal cards, imports, the demo) and dropped files (real paths in Electron).

import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { openDialog, openMenu, toast, promptDialog, confirmDialog } from '../ui/overlays.js';
import { download } from '../ui/app.js';
import { pickFiles } from '../ui/files.js';
import { facts } from '../catalog/facts.js';
import { newWork, newMedia, KINDS, ROLES, FORMATS, setPeople } from '../catalog/model.js';
import { attachFile, attachSource, detachFile, detachSource, setNominalInfo, createNominal } from '../catalog/presence.js';
import { addTags, removeTags, suggestTags, tagKey } from '../catalog/tags.js';
import { addItems, createCollection } from '../catalog/collections.js';
import { addRefs } from '../catalog/workspaces.js';
import { setStatus } from '../catalog/tracking.js';
import { workNfo, albumCue, chaptersCue } from '../catalog/interop.js';
import { DOMAINS } from '../catalog/facts.js';
import { parseName } from '../mediatags/names.js';
import { kindOf } from '../mediatags/detect.js';
import { parseLrc, serializeLrc, isLrc } from '../mediatags/lrc.js';
import { parseSource, formatSource } from '../mediajobs/ytdlp.js';
import { bridge, own, api, caps } from './env.js';
import { importFiles, readTagsOfFile, pickFolderFSA } from './access.js';
import { fmtTime, tagChip, inputRow, textField, selectField, checkField, btn, iconEl } from './ui.js';

// --- context menu -----------------------------------------------------------------------------------------------------

// DESIGN: every edit goes through db.patch / db.batch, so it replicates (other tabs, the server) and is undoable as
// one revision; dialogs never write half a form. Destructive actions (delete) always pass through confirmDialog.
export function workMenu(app, w, anchor, extra = {}) {
  const { db } = app;
  const f = facts(db, w);
  const c = caps();
  const playlists = db.all('collection').filter((x) => x.kind === 'playlist');
  const m = extra.media || db.mediaOf(w.id)[0] || null;
  const items = [
    { label: t('mp.play'), icon: 'play', action: () => app.playWork(w) },
    { label: t('mp.playNextQ'), icon: 'next', action: () => app.engine.enqueue([w.id], 'next') },
    { label: t('mp.addQueue'), icon: 'queue', action: () => app.engine.enqueue([w.id], 'end') },
    { sep: true },
    { label: t('mp.open'), icon: 'eye', action: () => app.open(w) },
    { label: t('mp.edit'), icon: 'edit', action: () => app.edit(w) },
    { label: t('mp.tags.add'), icon: 'tag', action: () => tagDialog(app, [w.id]) },
    { label: w.favorite ? t('mp.unlike') : t('mp.like'), icon: 'heart', action: () => db.patch(w.id, { favorite: !w.favorite }) },
    { label: t('mp.toPlaylist'), icon: 'list', action: async () => {
      const sel = selectField([['', t('mp.pl.newDots')], ...playlists.map((p) => [p.id, p.name])], playlists[0] ? playlists[0].id : '', () => {});
      const v = await openDialog({ title: t('mp.toPlaylist'), body: inputRow(t('mp.nav.playlists'), sel), buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), value: 'ok', primary: true }] });
      if (v !== 'ok') return;
      let id = sel.value;
      if (!id) { const n = await promptDialog(t('mp.pl.new'), t('mp.name'), ''); if (!n) return; id = createCollection(db, 'playlist', { name: n }).id; }
      addItems(db, id, [w.id]);
      toast(t('mp.added'), 'ok');
    } },
    db.count('workspace') ? { label: t('mp.toWorkspace'), icon: 'folderTree', action: () => toWorkspace(app, w) } : null,
    { label: t('mp.track.set'), icon: 'chart', action: () => openMenu(anchor, ['current', 'completed', 'paused', 'dropped', 'planned', 'repeating'].map((s) => ({ label: t('mp.status.' + s + '.' + (f.domain === 'audiobook' ? 'book' : f.domain === 'music' ? 'music' : 'video')), action: () => setStatus(db, w.id, s) }))) },
    { sep: true },
    { label: t('mp.makePlayable'), icon: 'link', action: () => attachDialog(app, w, {}) },
    m && m.source && c.ytdlp ? { label: t('mp.ytdlp.download'), icon: 'download2', action: () => ytdlpDownload(app, m) } : null,
    m && m.presence === 'file' ? { label: t('mp.nav.convert'), icon: 'convert', action: () => app.nav('convert?media=' + m.id) } : null,
    m && m.presence === 'file' && m.loc && m.loc.kind === 'fs' && bridge ? { label: t('mp.reveal'), icon: 'folder', action: () => api(own, `fs/stat/${m.loc.mount}/${m.loc.path.split('/').map(encodeURIComponent).join('/')}`).then(() => toast(m.loc.path)) } : null,
    m && m.source ? { label: t('mp.openLink'), icon: 'export', action: () => { const u = m.source.url || m.source.ref; if (bridge) bridge.openExternal(u); else window.open(u, '_blank', 'noopener,noreferrer'); } } : null,
    { label: t('mp.cover.edit'), icon: 'palette', action: () => app.nav('studio/covers?target=' + w.id) },
    { label: t('mp.exportNfo'), icon: 'download', action: () => { const n = workNfo(db, w); download(n.text, n.name, 'application/xml'); } },
    w.kind === 'album' ? { label: t('mp.exportCue'), icon: 'download', action: () => download(albumCue(db, w.id), (w.title || 'album') + '.cue', 'text/plain') } : null,
    m && (m.chapters || []).length ? { label: t('mp.exportChaptersCue'), icon: 'download', action: () => download(chaptersCue(db, m.id), (w.title || 'chapters') + '.cue', 'text/plain') } : null,
    { sep: true },
    { label: t('mp.delete'), icon: 'trash', danger: true, action: async () => { if (await confirmDialog(t('mp.delete'), t('mp.deleteQ', { title: f.title }), t('mp.delete'), true)) { db.remove(w.id); toast(t('mp.deleted'), 'ok', { label: t('mp.undo'), fn: () => db.undo() }); } } },
  ];
  openMenu(anchor, items.filter(Boolean), { label: f.title });
}

async function toWorkspace(app, w) {
  const { db } = app;
  const opts = [];
  for (const ws of db.all('workspace')) {
    opts.push([ws.id + '|', ws.name]);
    const walk = (fo, depth) => { for (const c of fo.children || []) { opts.push([ws.id + '|' + c.id, ws.name + ' / ' + '· '.repeat(depth) + c.name]); walk(c, depth + 1); } };
    walk(ws.root, 0);
  }
  const sel = selectField(opts, opts[0][0], () => {});
  const v = await openDialog({ title: t('mp.toWorkspace'), body: sel, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), value: 'ok', primary: true }] });
  if (v !== 'ok') return;
  const [wsId, folder] = sel.value.split('|');
  addRefs(db, wsId, folder || null, [w.id]);
  toast(t('mp.added'), 'ok');
}

export async function tagDialog(app, ids) {
  const { db } = app;
  const input = h('input', { class: 'ed-input', list: 'mp-tag-suggest', placeholder: 'genre:jazz, mood:calm' });
  const dl = h('datalist', { id: 'mp-tag-suggest' });
  input.addEventListener('input', () => { dl.textContent = ''; for (const s of suggestTags(db, input.value.split(',').pop(), 15)) dl.append(h('option', { value: s })); });
  const current = [...new Set(ids.flatMap((id) => (db.get(id).tags || [])))];
  const chips = h('div', { class: 'mp-chips' }, current.map((k) => tagChip(db, tagKey(k), { onRemove: (x) => { removeTags(db, ids, [x]); chips.querySelector(`[data-k="${x}"]`)?.remove(); } })));
  const v = await openDialog({ title: t('mp.tags.add'), body: h('div', { class: 'mp-form' }, chips, input, dl, h('p', { class: 'mp-muted' }, t('mp.tags.addHint'))), buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), value: 'ok', primary: true }] });
  if (v !== 'ok') return;
  const add = input.value.split(',').map((x) => x.trim()).filter(Boolean);
  if (add.length) addTags(db, ids, add);
}

// --- the editor ------------------------------------------------------------------------------------------------------

const KIND_FIELDS = {
  track: ['title', 'order', 'disc', 'year', 'bpm', 'energy', 'rating', 'language'], album: ['title', 'year', 'releaseGroup', 'compilation', 'label'],
  book: ['title', 'year', 'order', 'series'], bookseries: ['title'], chapter: ['title', 'order'], show: ['title', 'year', 'format', 'total', 'airing', 'cour'],
  season: ['title', 'season', 'total', 'year', 'format'], episode: ['title', 'season', 'episode', 'absolute', 'special', 'date'], movie: ['title', 'year', 'edition'],
  musicvideo: ['title', 'year'], podcast: ['title'],
};
const NUMERIC = new Set(['order', 'disc', 'year', 'bpm', 'energy', 'rating', 'total', 'season', 'episode', 'absolute', 'cour']);

// The editor tracks which fields the user touched (`changed`) and writes only those: untouched fields keep values a
// scan may still refresh. Multi-value fields are edited as plain text lines ("role: name (character)",
// "lang: title", "key: id") because a line-per-entry textarea is faster to edit and paste than nested widgets.
export async function editWork(app, w) {
  const { db } = app;
  const fields = {};
  const changed = new Set();
  const form = h('div', { class: 'mp-form mp-editor' });
  const mark = (k) => changed.add(k);
  const kind = selectField(KINDS.map((k) => [k, t('mp.kind.' + k)]), w.kind, () => mark('kind'));
  const domain = selectField([['', t('mp.auto')], ...DOMAINS.map((d) => [d, t('mp.domain.' + d)])], w.domain || '', () => mark('domain'));
  form.append(h('div', { class: 'mp-formrow' }, inputRow(t('mp.kind'), kind), inputRow(t('mp.domain'), domain)));
  for (const k of KIND_FIELDS[w.kind] || ['title']) {
    let ctl;
    if (k === 'format') ctl = selectField([['', '—'], ...FORMATS.map((x) => [x, t('mp.format.' + x)])], w.format || '', () => mark(k));
    else if (k === 'compilation' || k === 'special') ctl = checkField(t('mp.f.' + k), !!w[k], () => mark(k));
    else if (k === 'airing') ctl = selectField([['', '—'], ['airing', t('mp.airing.airing')], ['finished', t('mp.airing.finished')], ['upcoming', t('mp.airing.upcoming')]], w.airing || '', () => mark(k));
    else ctl = textField(w[k] ?? '', () => mark(k), { type: NUMERIC.has(k) ? 'number' : 'text' });
    fields[k] = ctl;
    form.append(k === 'compilation' || k === 'special' ? ctl : inputRow(t('mp.f.' + k), ctl));
  }
  // alternative titles
  const titles = textField(Object.entries(w.titles || {}).map(([k, v]) => `${k}: ${v}`).join('\n'), () => mark('titles'), { multiline: true, rows: 3, placeholder: 'romaji: …\nnative: …\nen: …' });
  form.append(inputRow(t('mp.f.titles'), titles, t('mp.f.titlesHint')));
  // people
  const people = textField((w.people || []).map((p) => `${p.role}: ${p.name}${p.character ? ' (' + p.character + ')' : ''}`).join('\n'), () => mark('people'), { multiline: true, rows: 3, placeholder: 'artist: …\ncomposer: …\nnarrator: …' });
  form.append(inputRow(t('mp.f.people'), people, t('mp.f.peopleHint', { roles: ROLES.join(', ') })));
  const desc = textField(w.description || '', () => mark('description'), { multiline: true, rows: 3 });
  form.append(inputRow(t('mp.f.description'), desc));
  // tags
  const tags = textField((w.tags || []).join(', '), () => mark('tags'), { list: 'mp-tag-suggest2' });
  const dl = h('datalist', { id: 'mp-tag-suggest2' });
  tags.addEventListener('input', () => { dl.textContent = ''; for (const s of suggestTags(db, tags.value.split(',').pop(), 15)) dl.append(h('option', { value: s })); });
  form.append(inputRow(t('mp.nav.tags'), h('div', {}, tags, dl)));
  // lyrics
  let lyricsText = w.lyrics ? (w.lyrics.lrc || w.lyrics.text || '') : '';
  const lyr = textField(lyricsText, (v) => { lyricsText = v; mark('lyrics'); }, { multiline: true, rows: 6, placeholder: '[00:12.00]First line\n…' });
  form.append(inputRow(t('mp.lyrics'), lyr, t('mp.lyrics.hint')), btn(t('mp.lyrics.sync'), 'sync', () => syncLyrics(app, w, lyr, () => { lyricsText = lyr.value; mark('lyrics'); })));
  // markers
  const mk = (n) => textField(w.markers && w.markers[n] ? w.markers[n].map((x) => fmtTime(x)).join(' - ') : '', () => mark('markers'), { placeholder: '1:30 - 2:58' });
  const intro = mk('intro'), outro = mk('outro');
  if (['episode', 'movie', 'season', 'show'].includes(w.kind)) form.append(h('div', { class: 'mp-formrow' }, inputRow(t('mp.f.intro'), intro), inputRow(t('mp.f.outro'), outro)));
  // ids
  const ids = textField(Object.entries(w.ids || {}).map(([k, v]) => `${k}: ${v}`).join('\n'), () => mark('ids'), { multiline: true, rows: 2, placeholder: 'mal: 16498\nimdb: tt…' });
  form.append(inputRow(t('mp.f.ids'), ids));
  if ((w.locked || []).length) form.append(h('p', { class: 'mp-muted' }, t('mp.f.locked', { list: w.locked.join(', ') }), ' ', h('button', { type: 'button', class: 'ed-btn', onclick: () => { db.patch(w.id, { locked: undefined }); toast(t('mp.f.unlocked')); } }, t('mp.f.unlock'))));
  const v = await openDialog({ title: t('mp.edit') + ' · ' + (w.title || ''), body: form, wide: true, buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('mp.save'), value: 'ok', primary: true }] });
  if (v !== 'ok' || !changed.size) return;
  const patch = {};
  const parseTime = (s) => { const p = String(s).trim().split(':').map(Number); return p.some((x) => !Number.isFinite(x)) ? null : p.reduce((a, x) => a * 60 + x, 0); };
  // "1:10 - 1:40" -> [70, 100]; rejects reversed or unparsable ranges (undefined clears the marker).
  const pair = (s) => { const m = String(s).split(/\s*[-–]\s*/); const a = parseTime(m[0]), b = parseTime(m[1] || ''); return a != null && b != null && b > a ? [a, b] : undefined; };
  for (const k of changed) {
    if (fields[k]) {
      const ctl = fields[k];
      const val = ctl.querySelector ? (ctl.querySelector('input[type=checkbox]') ? ctl.querySelector('input').checked : ctl.value) : ctl.value;
      patch[k] = typeof val === 'boolean' ? val || undefined : val === '' ? undefined : NUMERIC.has(k) ? Number(val) : val;
    }
  }
  if (changed.has('kind')) patch.kind = kind.value;
  if (changed.has('domain')) patch.domain = domain.value || undefined;
  if (changed.has('titles')) patch.titles = Object.fromEntries(titles.value.split('\n').map((l) => /^\s*([a-z]{2,8}(?:-[A-Za-z0-9]+)?)\s*:\s*(.+)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
  if (changed.has('people')) {
    // Note: `out` is never used (leftover); harmless.
    const out = { ...w };
    delete out.people;
    const lines = people.value.split('\n').map((l) => /^\s*([a-z]+)\s*:\s*(.+?)(?:\s*\((.+)\))?\s*$/.exec(l)).filter(Boolean);
    patch.people = lines.map((m) => ({ role: ROLES.includes(m[1]) ? m[1] : 'artist', name: m[2], ...(m[3] ? { character: m[3] } : {}) }));
    if (!patch.people.length) patch.people = undefined;
  }
  if (changed.has('description')) patch.description = desc.value || undefined;
  if (changed.has('tags')) patch.tags = tags.value.split(',').map((x) => x.trim()).filter(Boolean);
  if (changed.has('lyrics')) patch.lyrics = lyricsText.trim() ? (isLrc(lyricsText) ? { lrc: lyricsText } : { text: lyricsText }) : undefined;
  if (changed.has('markers')) patch.markers = { ...(w.markers || {}), intro: pair(intro.value), outro: pair(outro.value) };
  if (changed.has('ids')) patch.ids = Object.fromEntries(ids.value.split('\n').map((l) => /^\s*([a-z][a-z0-9_]*)\s*:\s*(\S+)/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
  // Field locking: a field edited by hand is added to `locked`, and the indexer (catalog/indexer.js) never overwrites
  // locked fields on rescans. Without it, the next scan would restore the file's wrong tag over the user's fix.
  patch.locked = [...new Set([...(w.locked || []), ...changed])];
  db.patch(w.id, patch);
  toast(t('mp.saved'), 'ok');
}

// Tap to sync: plays the work and stamps each line with the current time when Space / the button is pressed.
// Capture phase listener (true) with stopPropagation: Space must stamp a line, not reach the global keymap, where it
// would toggle playback and ruin the timing.
async function syncLyrics(app, w, area, done) {
  const lines = (parseLrc(area.value).lines.map((l) => l.text).filter((x) => x !== undefined)).filter(Boolean);
  if (!lines.length) { toast(t('mp.lyrics.syncNeedText'), 'warn'); return; }
  await app.playWork(w);
  app.engine.seek(0);
  let i = 0;
  const times = [];
  const cur = h('p', { class: 'mp-sync-line' }, lines[0]);
  const stamp = () => { times[i] = app.engine.state.position; i++; if (i >= lines.length) close(); else cur.textContent = lines[i]; };
  let close = () => {};
  const key = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); stamp(); } };
  window.addEventListener('keydown', key, true);
  await openDialog({ title: t('mp.lyrics.sync'), body: h('div', { class: 'mp-form' }, h('p', { class: 'mp-muted' }, t('mp.lyrics.syncHelp')), cur, btn(t('mp.lyrics.stamp'), 'check', stamp, 'primary')), buttons: [{ label: t('mp.done'), value: 'ok', primary: true }], onMount: (d) => { close = () => d.close('ok'); } });
  window.removeEventListener('keydown', key, true);
  if (!times.length) return;
  area.value = serializeLrc({ meta: {}, lines: lines.map((text, k) => ({ time: times[k] ?? null, text, words: null })).filter((l) => l.time != null), synced: true });
  done();
}

// --- presence: make playable / nominal info ----------------------------------------------------------------------

export async function attachDialog(app, w, { reason } = {}) {
  const { db } = app;
  const c = caps();
  const f = facts(db, w);
  const msg = reason === 'nominal' ? t('mp.attach.nominal', { title: f.title }) : t('mp.attach.sub');
  const link = textField('', () => {}, { placeholder: 'https://… · youtube:ID · https://example.org/song.mp3' });
  const lyr = textField(w.lyrics ? w.lyrics.text || '' : '', () => {}, { multiline: true, rows: 3 });
  const body = h('div', { class: 'mp-form' }, h('p', {}, msg),
    h('div', { class: 'mp-actions' },
      btn(t('mp.attach.file'), 'file2', async () => {
        if (bridge) { const [p] = await bridge.openFiles({ multiple: false }); if (!p) return; const [r] = await importFiles([], { paths: [p] }); if (r) { attachFile(db, w.id, r.loc, { name: p.split(/[\\/]/).pop() }); finish(); } return; }
        const [file] = await pickFiles({ accept: 'audio/*,video/*' });
        if (!file) return;
        const [r] = await importFiles([file], { copy: true });
        const info = await readTagsOfFile(file).catch(() => null);
        attachFile(db, w.id, r.loc, { name: file.name, size: file.size, duration: info && info.duration || undefined, mime: file.type, kind: kindOf(file.name) === 'video' ? 'video' : 'audio', audio: info && info.audio || undefined, video: info && info.video || undefined, chapters: info && info.chapters && info.chapters.length ? info.chapters : undefined });
        finish();
      }, 'primary')),
    inputRow(t('mp.attach.link'), link, t('mp.attach.linkHint')),
    btn(t('mp.attach.addLink'), 'link', () => {
      const v = link.value.trim();
      if (!v) return;
      const p = parseSource(v);
      const ref = p && p.extractor !== 'generic' && p.id ? formatSource(p) : v;
      if (/^https?:\/\/\S+\.(mp3|m4a|aac|ogg|oga|opus|flac|wav|webm|mp4|m4v)(\?\S*)?$/i.test(v)) attachFile(db, w.id, { kind: 'url', url: v }, { name: v.split('/').pop() });
      else attachSource(db, w.id, ref, { url: p && p.url ? p.url : /^https?:/.test(v) ? v : undefined, extractor: p && p.extractor, id: p && p.id });
      finish();
    }),
    c.ytdlp ? h('p', { class: 'mp-muted' }, t('mp.attach.ytdlpOk')) : h('p', { class: 'mp-muted' }, t('mp.attach.ytdlpNo')),
    inputRow(t('mp.attach.lyrics'), lyr, t('mp.attach.lyricsHint')),
    btn(t('mp.attach.saveInfo'), 'card', () => { setNominalInfo(db, w.id, { lyrics: lyr.value }); finish(); }));
  const media = db.mediaOf(w.id);
  if (media.length) body.append(h('div', { class: 'mp-list' }, media.map((m) => h('div', { class: 'mp-media-row' }, h('span', {}, t('mp.presence.' + m.presence)), h('div', { class: 'mp-row-main' }, m.name || (m.source && m.source.ref) || ''),
    m.source && c.ytdlp ? btn(t('mp.ytdlp.download'), 'download2', () => { ytdlpDownload(app, m); finish(); }) : null,
    m.presence === 'file' ? btn(t('mp.attach.forgetFile'), 'close', () => { detachFile(db, m.id); finish(); }) : null,
    m.source ? btn(t('mp.attach.forgetLink'), 'close', () => { detachSource(db, m.id); finish(); }) : null))));
  let closeFn = () => {};
  const finish = () => { closeFn('done'); };
  const v = await openDialog({ title: t('mp.makePlayable'), body, buttons: [{ label: t('dlg.close'), value: null }], onMount: (d) => { closeFn = d.close; } });
  return v === 'done' && facts(db, db.get(w.id)).presence !== 'nominal';
}

async function ytdlpDownload(app, m) {
  const mode = selectField([['best', t('mp.ytdlp.best')], ['video', t('mp.ytdlp.video')], ['audio', t('mp.ytdlp.audio')]], m.kind === 'video' ? 'video' : 'best', () => {});
  const fmt = selectField([['best', t('mp.ytdlp.fmtBest')], ['opus', 'Opus'], ['mp3', 'MP3'], ['m4a', 'M4A'], ['flac', 'FLAC']], 'best', () => {});
  const subs = textField('', () => {}, { placeholder: 'en, ja' });
  const v = await openDialog({ title: t('mp.ytdlp.download'), body: h('div', { class: 'mp-form' }, inputRow(t('mp.ytdlp.mode'), mode), inputRow(t('mp.ytdlp.audioFormat'), fmt), inputRow(t('mp.ytdlp.subs'), subs)), buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('mp.ytdlp.start'), value: 'ok', primary: true }] });
  if (v !== 'ok') return;
  try {
    const r = await api(own, 'jobs', { method: 'POST', body: { kind: 'ytdlpDownload', params: { media: m.id, mode: mode.value, audioFormat: fmt.value, subs: subs.value || undefined } } });
    toast(t('mp.cv.queued', { title: r.title }), 'ok', { label: t('mp.nav.convert'), fn: () => app.nav('convert') });
  } catch (e) { toast(t('mp.err.generic', { msg: e.message }), 'error'); }
}

// --- adding media ------------------------------------------------------------------------------------------------

export async function addMediaDialog(app, { domain = null } = {}) {
  const c = caps();
  let closeFn = () => {};
  const go = (fn) => async () => { closeFn(null); await fn(); };
  const tile = (ic, label, hint, fn, show = true) => (show ? h('button', { type: 'button', class: 'mp-addtile', onclick: go(fn) }, iconEl(ic), h('b', {}, label), h('span', {}, hint)) : null);
  const body = h('div', { class: 'mp-addgrid' },
    tile('folder', t('mp.addm.folder'), c.server ? t('mp.addm.folderServer') : t('mp.addm.folderFsa'), () => app.nav('sources'), c.server || c.fsa),
    tile('file2', t('mp.addm.files'), bridge ? t('mp.addm.filesNative') : t('mp.addm.filesBrowser'), () => addFiles(app, domain)),
    tile('link', t('mp.addm.link'), t('mp.addm.linkHint'), () => addLink(app, domain)),
    tile('card', t('mp.addm.nominal'), t('mp.addm.nominalHint'), () => addNominal(app, domain)),
    tile('upload', t('mp.addm.import'), t('mp.addm.importHint'), () => app.nav('settings/exchange')),
    tile('chart', t('mp.addm.lists'), t('mp.addm.listsHint'), () => app.nav('tracking')),
    tile('wand', t('mp.demo.load'), t('mp.addm.demoHint'), () => app.seedDemo(true)));
  await openDialog({ title: t('mp.add'), body, wide: true, buttons: [{ label: t('dlg.close'), value: null }], onMount: (d) => { closeFn = d.close; } });
}

async function addFiles(app, domain) {
  if (bridge) { const paths = await bridge.openFiles({ multiple: true, filters: [{ name: t('mp.media'), extensions: ['mp3', 'flac', 'm4a', 'm4b', 'ogg', 'opus', 'wav', 'aac', 'mp4', 'mkv', 'webm', 'mov', 'avi'] }] }); return handleDroppedFiles(app, [], paths, domain); }
  const files = await pickFiles({ accept: 'audio/*,video/*,.mkv,.m4b,.flac,.opus', multiple: true });
  if (files.length) return handleDroppedFiles(app, files, [], domain);
}

// Dropped files: with paths (Electron) they are referenced in place; in a browser the user chooses copy (persistent
// blobs, costs storage) or session-only (no storage, gone on reload), with the total size shown to decide. Works
// are created from tags first, then from the file name parser (parseName), with the section's domain as a hint.
export async function handleDroppedFiles(app, files, paths = [], domain = null) {
  const { db } = app;
  if (!files.length && !paths.length) return;
  let copy = true;
  if (!paths.length && files.length) {
    const total = files.reduce((s, f) => s + f.size, 0);
    const v = await openDialog({ title: t('mp.addm.files'), body: h('div', {}, h('p', {}, t('mp.drop.q', { n: files.length, size: (total / 1048576).toFixed(1) })), h('p', { class: 'mp-muted' }, t('mp.drop.hint'))), buttons: [{ label: t('mp.drop.session'), value: 'session' }, { label: t('mp.drop.copy'), value: 'copy', primary: true }] });
    if (!v) return;
    copy = v === 'copy';
  }
  const media = files.filter((f) => ['audio', 'video'].includes(kindOf(f.name)));
  const list = paths.length ? await importFiles([], { paths }) : await importFiles(media, { copy });
  const ids = [];
  // Note: an empty batch, a no-op; tags are read asynchronously below, so works are put one by one.
  db.batch(() => {}, {});
  for (const r of list) {
    const name = r.name;
    const file = r.file;
    const info = file ? await readTagsOfFile(file).catch(() => null) : null;
    const tg = info && info.tags ? info.tags : {};
    const n = parseName(name, { hint: domain === 'audiobook' ? 'audiobook' : domain === 'anime' ? 'anime' : domain === 'series' ? 'series' : domain === 'movie' ? 'movie' : 'auto' });
    const isVideo = kindOf(name) === 'video' || (info && info.kind === 'video');
    const kind = domain === 'audiobook' ? 'book' : n.kind === 'episode' ? 'episode' : n.kind === 'movie' || (isVideo && domain === 'movie') ? 'movie' : isVideo ? 'musicvideo' : 'track';
    const w = newWork({ kind, title: tg.title || n.title || name.replace(/\.[^.]+$/, ''), domain: domain || undefined, year: tg.year || n.year || undefined, order: tg.track || n.track || undefined, episode: n.episode, season: n.season });
    const artists = tg.artists && tg.artists.length ? tg.artists : tg.artist ? [tg.artist] : n.artist ? [].concat(n.artist) : [];
    if (artists.length) setPeople(w, kind === 'book' ? 'author' : 'artist', artists);
    if (tg.lyrics) w.lyrics = { text: tg.lyrics };
    if (info && info.syncedLyrics) w.lyrics = { ...(w.lyrics || {}), lrc: info.syncedLyrics };
    if (tg.genre && tg.genre.length) w.tags = tg.genre.map((g) => 'genre:' + String(g).toLowerCase());
    if (tg.album) w.ext = { album: tg.album };
    let cover;
    if (info && info.cover && info.cover.data) cover = { blob: await app.store.blobs.put(new Blob([info.cover.data], { type: info.cover.mime }), info.cover.mime) };
    db.batch(() => {
      db.put(w);
      db.put(newMedia(w.id, { presence: 'file', loc: r.loc, name, size: file ? file.size : undefined, duration: info && info.duration || undefined, mime: file ? file.type : undefined, kind: isVideo ? 'video' : 'audio', audio: info && info.audio || undefined, video: info && info.video || undefined, chapters: info && info.chapters && info.chapters.length ? info.chapters : undefined, replaygain: info && info.replaygain || undefined, cover }));
    }, { label: 'add files' });
    ids.push(w.id);
  }
  if (ids.length) { toast(t('mp.drop.added', { n: ids.length }), 'ok', { label: t('mp.play'), fn: () => app.playList(ids) }); }
  else toast(t('mp.drop.none'), 'warn');
}

async function addLink(app, domain) {
  const url = textField('', () => {}, { placeholder: 'https://www.youtube.com/watch?v=… · https://example.org/a.mp3' });
  const title = textField('', () => {}, {});
  const kind = selectField(['track', 'musicvideo', 'episode', 'movie', 'book', 'podcast'].map((k) => [k, t('mp.kind.' + k)]), domain === 'movie' ? 'movie' : domain === 'audiobook' ? 'book' : 'track', () => {});
  const v = await openDialog({ title: t('mp.addm.link'), body: h('div', { class: 'mp-form' }, inputRow(t('mp.attach.link'), url), inputRow(t('mp.title'), title), inputRow(t('mp.kind'), kind), h('p', { class: 'mp-muted' }, caps().ytdlp ? t('mp.attach.ytdlpOk') : t('mp.attach.ytdlpNo'))), buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), value: 'ok', primary: true }] });
  if (v !== 'ok' || !url.value.trim()) return;
  const u = url.value.trim();
  const p = parseSource(u);
  const w = app.db.put(newWork({ kind: kind.value, title: title.value.trim() || (p && p.id) || u.split('/').pop(), domain: domain || undefined }));
  if (/^https?:\/\/\S+\.(mp3|m4a|aac|ogg|oga|opus|flac|wav|webm|mp4|m4v)(\?\S*)?$/i.test(u)) attachFile(app.db, w.id, { kind: 'url', url: u }, { name: u.split('/').pop() });
  else attachSource(app.db, w.id, p && p.id && p.extractor !== 'generic' ? formatSource(p) : u, { url: p && p.url || u });
  app.open(w);
}

async function addNominal(app, domain) {
  const kind = selectField(KINDS.map((k) => [k, t('mp.kind.' + k)]), domain === 'anime' || domain === 'series' ? 'show' : domain === 'movie' ? 'movie' : domain === 'audiobook' ? 'book' : 'track', () => {});
  const title = textField('', () => {}, {});
  const who = textField('', () => {}, { placeholder: t('mp.addm.whoPh') });
  const year = textField('', () => {}, { type: 'number' });
  const lyrics = textField('', () => {}, { multiline: true, rows: 4, placeholder: t('mp.addm.lyricsPh') });
  const v = await openDialog({ title: t('mp.addm.nominal'), body: h('div', { class: 'mp-form' }, h('p', { class: 'mp-muted' }, t('mp.addm.nominalHelp')), inputRow(t('mp.kind'), kind), inputRow(t('mp.title'), title), inputRow(t('mp.addm.who'), who), inputRow(t('mp.f.year'), year), inputRow(t('mp.lyrics'), lyrics)), buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), value: 'ok', primary: true }] });
  if (v !== 'ok' || !title.value.trim()) return;
  const role = ['book', 'chapter', 'bookseries'].includes(kind.value) ? 'author' : ['movie', 'show'].includes(kind.value) ? 'director' : 'artist';
  const w = createNominal(app.db, { kind: kind.value, title: title.value.trim(), domain: domain || undefined, year: Number(year.value) || undefined, people: who.value.trim() ? [{ name: who.value.trim(), role }] : undefined, ...(lyrics.value.trim() ? (isLrc(lyrics.value) ? { lrc: lyrics.value } : { lyrics: lyrics.value }) : {}) });
  app.open(w);
}

export { pickFolderFSA };
