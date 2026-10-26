// mediatags/playlist.js - playlists: M3U / M3U8 (extended), PLS, XSPF (xml/xml.js).
//
//   parseM3u(text, { base = '' }) -> { header: boolean, title (#PLAYLIST) | null, attrs (of #EXTM3U), entries: [{
//       path (local, as written; backslashes -> '/') | url (scheme://...), resolved? (path joined to `base` when
//       relative and a base is given), title, artist, duration (s; -1 -> null), attrs: { 'tvg-logo': ... },
//       extra: { album (#EXTALB), artist (#EXTART), image (#EXTIMG), genre (#EXTGENRE), group (#EXTGRP) } }] }
//     '#EXTINF:<s> <attrs>,<artist> - <title>': the first ' - ' splits artist and title; #EXT* lines apply to the
//     next entry; other comments are skipped.
//   writeM3u({ title, entries }, { extended = true }) -> M3U8 text ('#EXTM3U', '#PLAYLIST:', '#EXTINF:<int s>,<artist> -
//       <title>', #EXTALB / #EXTART / #EXTIMG / #EXTGENRE from entry.extra (or entry.album / entry.image), the path)
//   parsePls(text) -> { title | null, entries: [{ path | url, title, duration }] }
//   writePls({ title, entries }) -> text
//   parseXspf(text) -> { title, creator, annotation, info, location, identifier, image, date, entries: [{ location,
//       locations? (more than one), identifier?, title, creator, album, trackNum, duration (s), image, annotation,
//       info, meta: { rel: value } }] }   (absent values null; malformed XML -> { entries: [] , error })
//   writeXspf({ title, creator, annotation, info, image, date, entries }) -> XSPF 1.0 text (durations in ms; locations
//       written as given)

import { attr, child, children, el, parseXML, root, serializeXML, textOf } from '../xml/xml.js';

//
// Design: playlists are line formats with no reliable spec (M3U) or an INI dialect (PLS) or XML (XSPF). Parsers keep
// locations exactly as written (path vs url distinguished by a scheme), and only optionally resolve relative paths
// against a caller-given base: a playlist moved with its folder must keep working, so we never absolutise on write.

// A URL has a scheme followed by '://'; 'C:/x' (drive letter) is not a URL because the scheme must be followed by //.
const isUrl = (s) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
const isAbs = (s) => /^([a-z]:)?\//i.test(s);

// Lexical join with '.' / '..' resolution; '..' above the root is kept (a relative base cannot be resolved further),
// and an empty first segment preserves a leading '/' of an absolute base.
function joinPath(base, rel) {
  const parts = (base.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + rel).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') { if (out.length && out[out.length - 1] !== '..' && out[out.length - 1] !== '') out.pop(); else out.push(p); }
    else if (p !== '.' && !(p === '' && out.length)) out.push(p);
  }
  return out.join('/');
}

// key="v" | key='v' | key=v attributes (IPTV extensions such as tvg-logo, group-title).
function attrsOf(s) {
  const attrs = {};
  for (const m of s.matchAll(/([\w-]+)=("([^"]*)"|'([^']*)'|(\S+))/g)) attrs[m[1]] = m[3] ?? m[4] ?? m[5];
  return attrs;
}

function locate(entry, line, base) {
  const p = line.trim();
  if (isUrl(p)) entry.url = p;
  else {
    entry.path = p.replace(/\\/g, '/');
    if (base && !isAbs(entry.path)) entry.resolved = joinPath(base, entry.path);
  }
}

// #EXTINF and the #EXT* extras are pending state applied to the next location line, then reset; this is how players
// interpret them. Plain '#' lines are comments. Duration -1 (unknown / live) is normalised to null.
export function parseM3u(text, { base = '' } = {}) {
  const ls = String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const out = { header: false, title: null, attrs: {}, entries: [] };
  let inf = null, extra = {};
  for (const raw of ls) {
    const l = raw.trim();
    if (!l) continue;
    if (/^#EXTM3U/i.test(l)) { out.header = true; Object.assign(out.attrs, attrsOf(l.slice(7))); continue; }
    if (/^#PLAYLIST:/i.test(l)) { out.title = l.slice(10).trim(); continue; }
    if (/^#EXTINF:/i.test(l)) {
      const body = l.slice(8);
      // duration, attributes (values may hold commas inside quotes), then ',' and the display title
      const m = /^\s*(-?\d+(?:\.\d+)?)?((?:\s+[\w-]+=(?:"[^"]*"|'[^']*'|[^\s,]+))*)\s*,(.*)$/.exec(body);
      // If the strict form fails, everything after the first comma is the title (else branch below).
      let duration = null, attrs = {}, disp = '';
      if (m) {
        duration = m[1] != null ? Number(m[1]) : null;
        attrs = attrsOf(m[2] || '');
        disp = m[3].trim();
      } else disp = body.replace(/^[^,]*,?/, '').trim();
      if (duration != null && duration < 0) duration = null;
      const k = disp.indexOf(' - ');
      inf = { title: k > 0 ? disp.slice(k + 3).trim() : disp || null, artist: k > 0 ? disp.slice(0, k).trim() : null, duration, attrs };
      continue;
    }
    const x = /^#(EXTALB|EXTART|EXTIMG|EXTGENRE|EXTGRP):(.*)$/i.exec(l);
    if (x) { extra[{ EXTALB: 'album', EXTART: 'artist', EXTIMG: 'image', EXTGENRE: 'genre', EXTGRP: 'group' }[x[1].toUpperCase()]] = x[2].trim(); continue; }
    if (l.startsWith('#')) continue;
    const e = { title: inf?.title ?? null, artist: inf?.artist ?? null, duration: inf?.duration ?? null, attrs: inf?.attrs || {}, extra };
    locate(e, l, base);
    out.entries.push(e);
    inf = null;
    extra = {};
  }
  return out;
}

// Writes M3U8 (UTF-8 implied). Duration is rounded to whole seconds (the classic integer form most players expect);
// quotes inside attribute values are replaced since M3U has no escaping. #EXTINF is omitted when there is nothing to say.
export function writeM3u({ title, entries = [] } = {}, { extended = true } = {}) {
  const out = [];
  if (extended) { out.push('#EXTM3U'); if (title) out.push(`#PLAYLIST:${title}`); }
  for (const e of entries) {
    const x = { album: e.album, artist: e.extra?.artist, image: e.image, genre: e.genre, ...(e.extra || {}) };
    if (extended) {
      const attrs = Object.entries(e.attrs || {}).map(([k, v]) => ` ${k}="${String(v).replace(/"/g, "'")}"`).join('');
      const disp = e.artist ? `${e.artist} - ${e.title ?? ''}` : e.title ?? '';
      if (disp || e.duration != null || attrs) out.push(`#EXTINF:${e.duration != null ? Math.round(e.duration) : -1}${attrs},${disp}`);
      if (x.album) out.push(`#EXTALB:${x.album}`);
      if (x.artist) out.push(`#EXTART:${x.artist}`);
      if (x.genre) out.push(`#EXTGENRE:${x.genre}`);
      if (x.image) out.push(`#EXTIMG:${x.image}`);
      if (x.group) out.push(`#EXTGRP:${x.group}`);
    }
    out.push(e.url || e.path || e.location || '');
  }
  return out.join('\n') + '\n';
}

// PLS: FileN / TitleN / LengthN keyed by N; entries may appear in any order and with gaps, so they are collected in a
// map and emitted by N. NumberOfEntries is ignored (it is often wrong). An entry without FileN is dropped.
export function parsePls(text) {
  const out = { title: null, entries: [] };
  const map = new Map();
  for (const raw of String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const m = /^\s*(File|Title|Length)(\d+)\s*=(.*)$/i.exec(raw);
    if (m) {
      const n = +m[2];
      if (!map.has(n)) map.set(n, {});
      map.get(n)[m[1].toLowerCase()] = m[3].trim();
      continue;
    }
    const t = /^\s*(?:PlaylistName|Title)\s*=(.*)$/i.exec(raw);
    if (t) out.title = t[1].trim();
  }
  for (const n of [...map.keys()].sort((a, b) => a - b)) {
    const x = map.get(n);
    if (!x.file) continue;
    const e = { title: x.title || null, duration: x.length != null && +x.length >= 0 ? +x.length : null };
    locate(e, x.file, '');
    out.entries.push(e);
  }
  return out;
}

// PLS has no artist field: 'Artist - Title' is folded into TitleN (as Winamp does), so parsePls returns it as title.
export function writePls({ title, entries = [] } = {}) {
  const out = ['[playlist]'];
  if (title) out.push(`PlaylistName=${title}`);
  entries.forEach((e, i) => {
    out.push(`File${i + 1}=${e.url || e.path || e.location || ''}`);
    if (e.title) out.push(`Title${i + 1}=${e.artist ? e.artist + ' - ' : ''}${e.title}`);
    out.push(`Length${i + 1}=${e.duration != null ? Math.round(e.duration) : -1}`);
  });
  out.push(`NumberOfEntries=${entries.length}`, 'Version=2');
  return out.join('\n') + '\n';
}

const txt = (n, name) => { const c = child(n, name); const t = c ? textOf(c).trim() : ''; return t || null; };

// XSPF: durations are milliseconds, trackNum a non-negative integer; anything else becomes null rather than NaN.
// Malformed XML returns an error field instead of throwing (playlists come from users).
export function parseXspf(text) {
  let doc;
  try { doc = parseXML(String(text || '')); } catch (e) { return { title: null, entries: [], error: String(e.message || e) }; }
  const pl = root(doc);
  const out = {};
  for (const k of ['title', 'creator', 'annotation', 'info', 'location', 'identifier', 'image', 'date']) out[k] = txt(pl, k);
  out.entries = children(child(pl, 'trackList'), 'track').map((t) => {
    const locations = children(t, 'location').map((x) => textOf(x).trim()).filter(Boolean);
    const e = { location: locations[0] || null };
    if (locations.length > 1) e.locations = locations;
    const ids = children(t, 'identifier').map((x) => textOf(x).trim()).filter(Boolean);
    if (ids.length) e.identifier = ids[0];
    for (const k of ['title', 'creator', 'album', 'image', 'annotation', 'info']) e[k] = txt(t, k);
    const tn = txt(t, 'trackNum');
    e.trackNum = tn != null && /^\d+$/.test(tn) ? +tn : null;
    const d = txt(t, 'duration');
    e.duration = d != null && /^\d+$/.test(d) ? +d / 1000 : null;
    e.meta = {};
    for (const m of children(t, 'meta')) { const rel = attr(m, 'rel'); if (rel) e.meta[rel] = textOf(m).trim(); }
    return e;
  });
  return out;
}

// Element order follows the XSPF 1.0 schema for <track> (location, identifier, title, creator, annotation, info, image,
// album, trackNum, duration, meta), which strict validators check.
export function writeXspf({ title, creator, annotation, info, image, date, entries = [] } = {}) {
  const opt = (name, v) => (v == null || v === '' ? null : el(name, {}, String(v)));
  const tracks = entries.map((e) => {
    const locs = e.locations || (e.location != null ? [e.location] : e.path != null ? [e.path] : e.url != null ? [e.url] : []);
    return el('track', {},
      locs.map((l) => el('location', {}, l)),
      opt('identifier', e.identifier), opt('title', e.title), opt('creator', e.creator ?? e.artist), opt('annotation', e.annotation),
      opt('info', e.info), opt('image', e.image), opt('album', e.album), opt('trackNum', e.trackNum),
      e.duration != null ? el('duration', {}, String(Math.round(e.duration * 1000))) : null,
      Object.entries(e.meta || {}).map(([rel, v]) => el('meta', { rel }, String(v))));
  });
  const doc = el('playlist', { version: '1', xmlns: 'http://xspf.org/ns/0/' },
    opt('title', title), opt('creator', creator), opt('annotation', annotation), opt('info', info), opt('image', image), opt('date', date),
    el('trackList', {}, tracks));
  return serializeXML(doc, { indent: '  ' }) + '\n';
}
