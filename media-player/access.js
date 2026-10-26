// media-player/access.js - files and links as the page can reach them in each artifact:
//   fs       a mount of the page's own backend (backend / Electron / dev): the file API with Range
//   remote   a mount of another server the user configured (address + token, CORS)
//   fsa      a folder picked with the File System Access API (Chromium; the handle is kept in IndexedDB and asked for
//            permission again after a reload)
//   blob     bytes in the catalogue's blob store (files copied into the library, demo pieces, covers)
//   url      a direct media URL the user added      session   a file picked or dropped for this session only
// Electron: native dialogs and dropped files give real paths, which the backend grants as mounts (fs).
//
//   initAccess(store) ; fileClient(serverId) ; mediaURL(media, { mode }) -> url | null ; coverURL(ref, size) -> url | null
//   pickFolderFSA() -> { handle id, name } ; fsaPermission(id, ask) -> boolean
//   addSessionFiles(files) -> [{ name, file }] ; sessionFile(name)
//   grantPaths(paths) -> [{ mount, path, dir }] (Electron / own backend)
//   scanIO(source) -> io for catalog/indexer.js scanSource (fsa and remote sources; fs sources scan on the server)
//   readTagsOfFile(file) -> MediaInfo     (mediatags on a File)
//   importFiles(files, { copy }) -> [{ name, loc, info, file }]

// DESIGN: a location (loc) is data stored in the catalogue ({ kind, ... }), never a URL. URLs are derived at play time
// by locURL(), because they are not stable: blob: URLs die with the page, token query strings change, a File System
// Access handle needs permission again after reload. Storing URLs would leave a catalogue full of dead links.
import { createFileClient } from '../fileapi/client.js';
import { readMedia } from '../mediatags/read.js';
import { blobSource } from '../mediatags/source.js';
import { generatedCover, genParams } from '../catalog/covers.js';
import { own, serverById, settings, api, apiURL } from './env.js';
import { httpFetch } from './net.js';

let store = null;
const clients = new Map();
// Object URLs are cached per key: creating one per call would leak (each pins its Blob until revoked) and change the
// src string, which makes a media element reload.
const objectURLs = new Map();
const session = new Map();

export function initAccess(s) { store = s; }

export function fileClient(serverId = 'own') {
  if (clients.has(serverId)) return clients.get(serverId);
  const s = serverById(serverId);
  if (!s) return null;
  const c = createFileClient({ base: (s.base.endsWith('/') ? s.base : s.base + '/') + 'fs/', token: s.token || '' });
  clients.set(serverId, c);
  return c;
}
export function resetClients() { clients.clear(); }

const handles = new Map();
async function handleOf(id) {
  if (handles.has(id)) return handles.get(id);
  const h = store && await store.kv.get('fsa:' + id);
  if (h) handles.set(id, h);
  return h || null;
}

// queryPermission never prompts; requestPermission prompts but only inside a user gesture. Callers pass ask=true
// only from click handlers; background paths (playback resolve) use ask=false and report "unavailable".
export async function fsaPermission(id, ask = false) {
  const h = await handleOf(id);
  if (!h || !h.queryPermission) return false;
  if ((await h.queryPermission({ mode: 'read' })) === 'granted') return true;
  if (!ask) return false;
  try { return (await h.requestPermission({ mode: 'read' })) === 'granted'; } catch { return false; }
}

export async function pickFolderFSA() {
  const h = await globalThis.showDirectoryPicker({ mode: 'read', id: 'media-player' });
  // Handles are structured-cloneable and kept in IndexedDB (kv store); the catalogue references them by this id only.
  const id = 'h' + Math.random().toString(36).slice(2, 10);
  await store.kv.set('fsa:' + id, h);
  handles.set(id, h);
  return { id, name: h.name };
}

async function fsaFile(id, path) {
  const h = await handleOf(id);
  if (!h) return null;
  if (!(await fsaPermission(id, false))) return null;
  let dir = h;
  const parts = String(path || '').split('/').filter(Boolean);
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
  const fh = await dir.getFileHandle(parts[parts.length - 1]);
  return fh.getFile();
}

// Async generator: entries stream to the scanner without building the whole tree first. Dot entries (.git, .DS_Store)
// are skipped; depth 30 guards against pathological trees (FSA does not follow symlinks).
async function* walkFSA(dir, prefix = '', depth = 0) {
  if (depth > 30) return;
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith('.')) continue;
    const rel = prefix ? prefix + '/' + name : name;
    if (h.kind === 'directory') yield* walkFSA(h, rel, depth + 1);
    else { try { const f = await h.getFile(); yield { path: rel, size: f.size, mtime: f.lastModified }; } catch { /* unreadable */ } }
  }
}

export function addSessionFiles(files) {
  const out = [];
  for (const f of files) { session.set(f.name, f); out.push({ name: f.name, file: f }); }
  return out;
}
export const sessionFile = (name) => session.get(name) || null;

const cacheURL = (key, blob) => {
  if (objectURLs.has(key)) return objectURLs.get(key);
  const u = URL.createObjectURL(blob);
  objectURLs.set(key, u);
  return u;
};

function encPath(p) { return String(p || '').split('/').map(encodeURIComponent).join('/'); }

/** The bytes of a location: local kinds as their Blob, the rest from the URL through net.js. */
export async function readLoc(loc, url) {
  let b = null;
  if (loc && loc.kind === 'blob') b = await store.blobs.get(loc.blob);
  else if (loc && loc.kind === 'fsa') b = await fsaFile(loc.handle, loc.path).catch(() => null);
  else if (loc && loc.kind === 'session') b = session.get(loc.name) || null;
  if (b) return b;
  const r = await httpFetch(url || (await locURL(loc)));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.blob();
}

export async function locURL(loc, { thumb = 0 } = {}) {
  if (!loc) return null;
  switch (loc.kind) {
    case 'blob': return store.blobs.url(loc.blob);
    case 'url': return loc.url;
    case 'fs': case 'remote': {
      const c = fileClient(loc.kind === 'fs' ? 'own' : loc.server);
      if (!c) return null;
      return thumb ? c.thumbURL(loc.mount, loc.path, thumb) : c.rawURL(loc.mount, loc.path);
    }
    case 'fsa': { const f = await fsaFile(loc.handle, loc.path).catch(() => null); return f ? cacheURL('fsa:' + loc.handle + ':' + loc.path, f) : null; }
    case 'session': { const f = session.get(loc.name); return f ? cacheURL('s:' + loc.name, f) : null; }
    default: return null;
  }
}

// The URL a media element plays: the file, else (with yt-dlp on the own backend) the stream proxy of a source.
// Resolution order: a present file; else the own backend's yt-dlp stream proxy (same origin, so the audio graph
// works); else a source URL that is itself a direct media file (by extension). Page URLs (YouTube etc.) without
// yt-dlp return null and the engine reports 'unavailable'.
export async function mediaURL(m, { mode = 'audio', ytdlp = false } = {}) {
  if (!m) return null;
  if (m.presence === 'file' && m.loc && !m.missing) { const u = await locURL(m.loc); if (u) return u; }
  if (m.source && ytdlp && own) return apiURL(own, `stream?media=${encodeURIComponent(m.id)}&mode=${mode}`);
  if (m.source && /^https?:\/\/\S+\.(mp3|m4a|aac|ogg|oga|opus|flac|wav|webm|mp4|m4v)(\?\S*)?$/i.test(m.source.url || m.source.ref || '')) return m.source.url || m.source.ref;
  return null;
}

const svgURL = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

export async function coverURL(ref, size = 512) {
  if (!ref) return null;
  try {
    if (ref.gen) return svgURL(generatedCover(ref.gen, { size }));
    if (ref.blob) return store.blobs.url(ref.blob);
    if (ref.loc) return locURL(ref.loc, { thumb: ref.loc.kind === 'fs' || ref.loc.kind === 'remote' ? size : 0 });
    // Remote cover URLs are opt-in: loading them reveals the user's library to third-party hosts (privacy) and breaks
    // offline use; the generated cover is the default fallback.
    if (ref.url) return settings.remoteImages ? ref.url : null;
    if (ref.frame) return null;
  } catch { return null; }
  return null;
}
export const generatedURL = (node, size = 512, overrides = {}) => svgURL(generatedCover({ ...genParams(node), ...overrides }, { size }));

export async function grantPaths(paths) {
  if (!own || !paths.length) return [];
  return api(own, 'fs/grant', { method: 'POST', body: { paths } });
}

export function readTagsOfFile(file) {
  return readMedia(blobSource(file), { name: file.name, cover: true });
}

// io for scanSource: the browser reads fsa folders and other servers' mounts itself.
// The browser scans only what it can read itself (FSA folders, other servers' mounts over the file API); own-backend
// folders are scanned server-side (POST api/scan), which avoids streaming every file's tags over HTTP.
export function scanIO(source) {
  const saveCover = async (pic) => ({ blob: await store.blobs.put(new Blob([pic.data], { type: pic.mime || 'image/jpeg' }), pic.mime || 'image/jpeg') });
  if (source.kind === 'fsa') {
    const id = source.loc && source.loc.handle;
    return {
      async list() {
        const h = await handleOf(id);
        if (!h) throw new Error('folder handle lost');
        if (!(await fsaPermission(id, true))) throw new Error('permission denied');
        const out = [];
        for await (const e of walkFSA(h)) out.push(e);
        return out;
      },
      readMedia: async (p) => { const f = await fsaFile(id, p); return f ? readMedia(blobSource(f), { name: p, cover: true }) : null; },
      readText: async (p) => { const f = await fsaFile(id, p); return f && f.size < 2e6 ? f.text() : null; },
      loc: (p) => ({ kind: 'fsa', handle: id, path: p }),
      saveCover,
      concurrency: 3,
    };
  }
  if (source.kind === 'remote') {
    const { server, mount, path: base = '' } = source.loc || {};
    const c = fileClient(server);
    return {
      async list() {
        const r = await c.list(mount, base, { recursive: true });
        const cut = base ? base.length + 1 : 0;
        return r.entries.filter((e) => !e.dir).map((e) => ({ path: e.path.slice(cut), size: e.size, mtime: e.mtime }));
      },
      readMedia: async (p) => readMedia(await c.source(mount, base ? base + '/' + p : p), { name: p, cover: true }),
      readText: async (p) => { const b = await c.read(mount, base ? base + '/' + p : p, 0, 2e6); return new TextDecoder().decode(b); },
      loc: (p) => ({ kind: 'remote', server, mount, path: base ? base + '/' + p : p }),
      saveCover,
      concurrency: 3,
    };
  }
  throw new Error('this source is scanned by its server');
}

// Picked / dropped files: real paths in Electron (granted as mounts), else copied into the blob store or kept for
// this session.
// With real paths (Electron) files are referenced in place via granted mounts: no copy of a 40 GB library. In a
// browser, copy=true stores bytes as blobs (persist across reloads); copy=false keeps them for this session only.
export async function importFiles(files, { copy = true, paths = null } = {}) {
  const out = [];
  if (paths && paths.length && own) {
    const granted = await grantPaths(paths);
    granted.forEach((g, i) => { if (g && g.mount) out.push({ name: files[i] ? files[i].name : paths[i].split(/[\\/]/).pop(), loc: { kind: 'fs', mount: g.mount, path: g.path }, file: files[i] || null }); });
    return out;
  }
  for (const f of files) {
    const loc = copy ? { kind: 'blob', blob: await store.blobs.put(f, f.type || 'application/octet-stream') } : { kind: 'session', name: f.name };
    if (!copy) session.set(f.name, f);
    out.push({ name: f.name, loc, file: f });
  }
  return out;
}

export { encPath };
