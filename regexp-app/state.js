// regexp-app/state.js - Regex Studio state: the working pattern, persistence (localStorage), share codes in the URL
// hash (local only, nothing is uploaded), saved patterns and the history of tried patterns.
// 
// Design rules:
// - One mutable singleton S, imported by every module. Why not a store with subscriptions: the app has one writer
//   (main.js) that repaints explicitly after each change; events would add indirection without removing any call.
// - Everything read back from storage or a URL is untrusted: assign() whitelists fields, checks types, caps lengths and
//   validates flags. A crafted share link can at worst load a slow pattern, which the worker time limit contains.
// - Size caps (MAX_*) protect localStorage (~5 MB per origin, shared by every app of the site) and keep share URLs
//   below the practical URL length limits of browsers and chat clients.
import { lsGet, lsSet } from '../ui/dom.js';
import { findPattern } from '../regexp/patterns.js';

const KEY = 'regex-state', SAVED = 'regex-saved', HISTORY = 'regex-history';
const MAX_TEXT = 200000, MAX_SAVED_TEXT = 20000, MAX_HISTORY = 30, SHARE_TEXT = 4000;
export const TABS = ['matches', 'replace', 'split', 'explain', 'diagram', 'code', 'cheat'];
export const CODE_LANGS = ['js', 'python', 'go', 'java', 'csharp', 'php', 'rust'];

// Defaults come from the pattern library (ISO date-time): a first-time user sees a working example, not an empty page.
const first = findPattern('isoDateTime');
const DEFAULTS = { source: first.source, flags: first.flags, text: first.sample, replacement: first.replacement || '', tab: 'matches', codeLang: 'js', splitLimit: '' };

// The working state; derived values (parse result, warnings, last evaluation) live next to it.
export const S = {
  ...DEFAULTS,
  parsed: null, warnings: [], result: null, status: 'idle', ms: 0,
  hot: null, // a pattern range highlighted from the Explain or Diagram view
  caret: 0, // caret offset in the pattern
};

const str = (v, d, max = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : d);
// Valid flag string: only known letters, no duplicates (Set size), never u and v together — exactly the cases where
// new RegExp() throws. Rejecting here keeps a corrupt stored value from crashing startup.
const flagsOk = (f) => typeof f === 'string' && /^[dgimsuvy]*$/.test(f) && new Set(f).size === f.length && !(f.includes('u') && f.includes('v'));

// Merges a stored or shared object into the state (unknown or ill-typed fields are ignored).
// Returns false for non-objects so callers can tell "nothing applied" from "applied"; unknown fields are dropped silently by design.
export function assign(o) {
  if (!o || typeof o !== 'object') return false;
  if (typeof o.source === 'string') S.source = o.source.slice(0, 20000);
  if (flagsOk(o.flags)) S.flags = o.flags;
  S.text = str(o.text, S.text);
  S.replacement = str(o.replacement, S.replacement, 2000);
  if (TABS.includes(o.tab)) S.tab = o.tab;
  if (CODE_LANGS.includes(o.codeLang)) S.codeLang = o.codeLang;
  if (typeof o.splitLimit === 'string' && /^\d{0,6}$/.test(o.splitLimit)) S.splitLimit = o.splitLimit;
  return true;
}

export function load() { assign(lsGet(KEY, null)); }
export function save() {
  lsSet(KEY, { source: S.source, flags: S.flags, text: S.text.slice(0, MAX_TEXT), replacement: S.replacement, tab: S.tab, codeLang: S.codeLang, splitLimit: S.splitLimit });
}
// Object.assign onto the same object: importers hold a reference to S, so S must never be replaced.
export function reset() { Object.assign(S, DEFAULTS); }

// --- share codes: 'rx1.' + base64url(UTF-8 JSON) ------------------------------------------------------------

// Chunks of 0x8000 bytes: String.fromCharCode.apply with a huge array overflows the argument limit / call stack in
// some engines. base64url (RFC 4648 §5): '+/' are not URL-safe in a fragment shared through chat clients, '=' padding
// is redundant (length is implied) and only lengthens the link.
function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// atob accepts missing padding in browsers (forgiving-base64 of the HTML spec); invalid input throws, caught by readShare.
function unb64url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/** → { code, shortened } where `code` goes after '#'. */
// Version prefix 'rx1.' allows a future format change without misreading old links. Short keys (p, f, t, r, v) shrink
// the JSON; the text is cut at SHARE_TEXT and the caller warns the user (shortened). UTF-8 via TextEncoder, because btoa
// accepts only Latin-1 code units.
export function shareCode() {
  const shortened = S.text.length > SHARE_TEXT;
  const o = { p: S.source, f: S.flags, t: S.text.slice(0, SHARE_TEXT) };
  if (S.replacement) o.r = S.replacement;
  if (S.tab !== 'matches') o.v = S.tab;
  return { code: 'rx1.' + b64url(new TextEncoder().encode(JSON.stringify(o))), shortened, limit: SHARE_TEXT };
}

/** A share code (with or without '#') → state fields, or null. */
// Anchored regex: the whole fragment must be a share code, so unrelated #anchors are ignored. Fields are validated later by assign().
export function readShare(hash) {
  const m = /^#?rx1\.([A-Za-z0-9_-]+)$/.exec(String(hash || '').trim());
  if (!m) return null;
  try {
    const o = JSON.parse(new TextDecoder().decode(unb64url(m[1])));
    if (!o || typeof o.p !== 'string') return null;
    return { source: o.p, flags: o.f, text: o.t, replacement: o.r ?? '', tab: o.v ?? 'matches' };
  } catch { return null; }
}

// --- saved patterns and history ----------------------------------------------------------------------------

// Snapshot of the current pattern; text capped smaller than the working text (MAX_SAVED_TEXT): up to 200 saved + 30 history entries share the quota.
const entry = (name) => ({ name: String(name || '').slice(0, 80), source: S.source, flags: S.flags, text: S.text.slice(0, MAX_SAVED_TEXT), replacement: S.replacement, at: Date.now() });
const valid = (e) => e && typeof e.source === 'string' && flagsOk(e.flags);

export function savedList() { const l = lsGet(SAVED, []); return Array.isArray(l) ? l.filter(valid) : []; }
export function saveCurrent(name) {
  const list = savedList().filter((e) => e.name !== name);
  list.unshift(entry(name));
  lsSet(SAVED, list.slice(0, 200));
}
// Index into the filtered list returned by savedList(); saving the filtered list back also drops invalid entries.
export function removeSaved(i) { const l = savedList(); l.splice(i, 1); lsSet(SAVED, l); }

export function historyList() { const l = lsGet(HISTORY, []); return Array.isArray(l) ? l.filter(valid) : []; }
/** Remembers the current pattern (true when the history changed). */
// History is MRU and de-duplicated by (source, flags). Same pattern on top: refresh its text in place instead of adding
// a duplicate; same text too: no write at all (returns false, no storage churn while typing).
export function remember() {
  if (!S.source || !S.parsed || !S.parsed.ok) return false;
  const list = historyList();
  if (list[0] && list[0].source === S.source && list[0].flags === S.flags) {
    if (list[0].text === S.text.slice(0, MAX_SAVED_TEXT)) return false;
    list[0] = entry('');
  } else {
    const rest = list.filter((e) => !(e.source === S.source && e.flags === S.flags));
    rest.unshift(entry(''));
    list.length = 0;
    list.push(...rest);
  }
  lsSet(HISTORY, list.slice(0, MAX_HISTORY));
  return true;
}
export function clearHistory() { lsSet(HISTORY, []); }
