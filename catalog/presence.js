// catalog/presence.js - the three presence levels of an item and the ways between them.
//   file     a real file: fs (backend / Electron file API), fsa (a File System Access handle), remote (another
//            server's file API), blob (the catalogue's blob store), url (a direct media URL), session (picked now)
//   source   a link or a yt-dlp reference (`youtube:<id>`, any URL yt-dlp understands): resolved, streamed or downloaded
//            into a file by the backend / Electron; in the browser a direct media URL plays as is
//   nominal  only a description: cover, lyrics, metadata — a card that cannot play
//
//   attachFile(db, workId, loc, info, { media }) -> media      upgrade to file (reuses a nominal / source media of the
//                                                               work, or `media`, keeping its source and versions)
//   attachSource(db, workId, ref, { title, url, media }) -> media    upgrade nominal -> source (or add a source)
//   detachFile(db, mediaId) -> media      file -> source (when a source is known) or nominal; the file is forgotten
//   detachSource(db, mediaId) -> media    source -> nominal (a file stays a file)
//   markMissing(db, mediaId) -> media     a scan did not find the file: missing + downgrade, metadata kept
//   setNominalInfo(db, workId, { lyrics, lrc, image, text }) -> work / media   information-only representation
//   createNominal(db, fields) -> work     a nominal work (song known by its lyrics or cover, an episode not owned yet)
//   presenceOf(db, workId) -> 'file' | 'source' | 'nominal'
//   choosePlayable(db, workId, { can, prefer }) -> { media, mode: 'file' | 'stream' | 'download' | null }
//     can: { fs, fsa, remote, blob, url, session, ytdlp } — what this artifact can open; prefer: { lang, quality,
//     version } — preferred audio language / quality label / version label
//   upgradeOptions(db, workId, can) -> ['attach-file', 'attach-link', 'download', 'stream', 'play']
//
// Key decisions:
// - Upgrades reuse an existing media node instead of adding a new one. Attaching a file to a work known only by its
//   YouTube link turns that media into a file that still remembers its source; a second node would show up as a
//   duplicate version and split play position / bookmarks between the two.
// - Downgrades never delete: a lost file falls back to its link, a lost link to nominal. Metadata (duration, subs,
//   bookmarks) earned by the file survives, so re-attaching restores the full card.
// - Every multi-step change runs in one db.batch: one undo step, one change event.
// - What this runtime can open is a parameter (`can`), not detected here: the same catalogue runs in a sandboxed
//   browser page, in Electron and behind a backend, and only the host knows which loc kinds it can read.

import { newMedia, newWork, PRESENCE_RANK } from './model.js';
import { facts } from './facts.js';

export function presenceOf(db, workId) {
  const w = db.get(workId);
  return w ? facts(db, w).presence : 'nominal';
}

// The media to upgrade in place: the explicit one if it belongs to this work (an id from another work is ignored,
// not trusted), else the first media of the preferred presence, else a nominal one, else none (caller creates).
function pickMedia(db, workId, mediaId, prefer) {
  if (mediaId) { const m = db.get(mediaId); if (m && m.work === workId) return m; }
  const list = db.mediaOf(workId);
  return list.find((m) => m.presence === prefer) || list.find((m) => m.presence === 'nominal') || null;
}

export function attachFile(db, workId, loc, info = {}, { media = null } = {}) {
  return db.batch(() => {
    const base = pickMedia(db, workId, media, 'source');
    // missing: undefined deletes the flag (db.patch semantics): a re-found file is no longer missing.
    // An existing *file* media is only overwritten when named explicitly; otherwise a second file becomes a new
    // version rather than silently replacing the first.
    const fields = { ...info, loc, presence: 'file', missing: undefined };
    if (base && (base.presence !== 'file' || base.id === media)) return db.patch(base.id, fields);
    return db.put(newMedia(workId, fields));
  }, { label: 'attach file' });
}

export function attachSource(db, workId, ref, { title, url, media = null, extractor, id } = {}) {
  const source = { ref: String(ref) };
  if (title) source.title = title;
  if (url) source.url = url;
  if (extractor) source.extractor = extractor;
  if (id) source.id = id;
  return db.batch(() => {
    const base = pickMedia(db, workId, media, 'nominal');
    // Only a media without a source is extended; one that already has a link keeps it and the new link becomes a
    // separate media (another version / mirror). A file stays 'file': a link never downgrades it.
    if (base && !base.source) return db.patch(base.id, { source, presence: base.presence === 'file' ? 'file' : 'source' });
    return db.put(newMedia(workId, { presence: 'source', source }));
  }, { label: 'attach source' });
}

export function detachFile(db, mediaId) {
  const m = db.get(mediaId);
  if (!m) return null;
  return db.patch(mediaId, { loc: undefined, presence: m.source ? 'source' : 'nominal', position: undefined, missing: undefined });
}

export function detachSource(db, mediaId) {
  const m = db.get(mediaId);
  if (!m) return null;
  return db.patch(mediaId, { source: undefined, presence: m.presence === 'file' ? 'file' : 'nominal' });
}

// Unlike detachFile, the loc is kept: if the drive comes back, the next scan can match the same path and clear
// `missing`. Early return when already missing makes repeated scans no-ops (no change events, no undo spam).
export function markMissing(db, mediaId) {
  const m = db.get(mediaId);
  if (!m || m.missing) return m;
  return db.patch(mediaId, { missing: true, presence: m.source ? 'source' : 'nominal' });
}

// undefined = "leave as is", '' / null = "clear". Lyrics live on the work (shared by all its media); image / text
// live on a nominal media (created on demand), i.e. a representation, so they behave like any other version.
export function setNominalInfo(db, workId, { lyrics, lrc, image, text } = {}) {
  return db.batch(() => {
    const w = db.get(workId);
    if (!w) return null;
    if (lyrics !== undefined || lrc !== undefined) {
      const l = { ...(w.lyrics || {}) };
      if (lyrics !== undefined) l.text = lyrics || undefined;
      if (lrc !== undefined) l.lrc = lrc || undefined;
      db.patch(workId, { lyrics: l.text || l.lrc ? l : undefined });
    }
    if (image !== undefined || text !== undefined) {
      const m = db.mediaOf(workId).find((x) => x.presence === 'nominal') || db.put(newMedia(workId, { presence: 'nominal' }));
      db.patch(m.id, { nominal: { ...(m.nominal || {}), ...(image !== undefined ? { image } : {}), ...(text !== undefined ? { text } : {}) } });
    }
    return db.get(workId);
  }, { label: 'nominal info' });
}

export function createNominal(db, fields) {
  return db.batch(() => {
    const { lyrics, lrc, image, text, ...rest } = fields;
    const w = db.put(newWork(rest));
    if (lyrics || lrc || image || text) setNominalInfo(db, w.id, { lyrics, lrc, image, text });
    return db.get(w.id);
  }, { label: 'nominal' });
}

// Conservative defaults = what a plain browser page can always open. Filesystem, remote server and yt-dlp must be
// declared by the host; assuming them would offer Play buttons that fail.
const DEFAULT_CAN = { fs: false, fsa: false, remote: false, blob: true, url: true, session: true, ytdlp: false };

// Lexicographic preference packed into one number: presence (x1000) dominates everything. A missing file loses
// only half a level (2000 - 500 = 1500 > 1000), so it still sorts above a link; choosePlayable compensates by
// skipping missing files explicitly in its first pass. Then version > language > quality, and up to
// +20 for resolution (height / 100, capped) as the final tie-break.
function score(m, prefer) {
  let s = PRESENCE_RANK[m.presence] * 1000;
  if (m.missing) s -= 500;
  if (prefer.lang && m.lang && String(m.lang).toLowerCase().startsWith(prefer.lang)) s += 50;
  if (prefer.quality && m.quality === prefer.quality) s += 30;
  if (prefer.version && m.version === prefer.version) s += 40;
  if (m.video && m.video.height) s += Math.min(20, m.video.height / 100);
  return s;
}

export function choosePlayable(db, workId, { can = {}, prefer = {} } = {}) {
  const c = { ...DEFAULT_CAN, ...can };
  const list = db.mediaOf(workId).slice().sort((a, b) => score(b, prefer) - score(a, prefer));
  // Three passes in strict priority, each over the preference-sorted list:
  // 1. a local file this host can open; 2. a direct URL loc; 3. a link: streamed via yt-dlp if available, else played
  // directly when the URL ends in a media extension (the browser can play it, no extractor needed). A YouTube page
  // URL without yt-dlp is unplayable and falls through to the final fallback (mode null or 'download').
  // Note: pass 2 does not check `missing`, unlike pass 1; a url loc is not scanned, so it is never marked missing.
  for (const m of list) if (m.presence === 'file' && m.loc && c[m.loc.kind] && !m.missing) return { media: m, mode: 'file' };
  for (const m of list) if (m.loc && m.loc.kind === 'url' && c.url) return { media: m, mode: 'file' };
  for (const m of list) {
    if (m.presence !== 'source' && !(m.presence === 'file' && m.source)) continue;
    if (c.ytdlp) return { media: m, mode: 'stream' };
    const ref = m.source.url || m.source.ref;
    if (c.url && /^https?:\/\/[^\s]+\.(mp3|m4a|aac|ogg|oga|opus|flac|wav|webm|mp4|m4v|m3u8)(\?[^\s]*)?$/i.test(ref)) return { media: m, mode: 'file', url: ref };
  }
  const any = list.find((m) => m.presence === 'source');
  return { media: any || list[0] || null, mode: any && c.ytdlp ? 'download' : null };
}

// Actions to offer on a card, derived from presence and host capabilities, so the UI never shows a button the host
// cannot honour (no 'download' without yt-dlp).
export function upgradeOptions(db, workId, can = {}) {
  const c = { ...DEFAULT_CAN, ...can };
  const p = presenceOf(db, workId);
  const out = [];
  const playable = choosePlayable(db, workId, { can: c });
  if (playable.mode === 'file' || playable.mode === 'stream') out.push('play');
  if (p !== 'file') out.push('attach-file');
  if (p === 'nominal') out.push('attach-link');
  if (p === 'source' && c.ytdlp) out.push('download', 'stream');
  return out;
}
