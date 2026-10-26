// image-processor/meta.js - the metadata card of the selected image: file and format facts, the EXIF summary
// (camera, lens, exposure, date, GPS in decimal degrees), text chunks / comments, every EXIF tag in a collapsible
// table, and what the current output settings keep or remove.

import { t } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { fmtBytes } from '../ui/files.js';
import { iconEl } from '../ui/icons.js';
import { KIND_LABEL } from './input.js';

// Rows with empty values are dropped, so the card shows only what the file actually contains.
const kv = (rows) => h('dl', { class: 'ap-kv' }, rows.filter((r) => r && r[1] != null && r[1] !== '').map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
// EXIF orientation 1..8 (1 = normal, 6 = rotate 90 CW, 8 = rotate 270, 2/4/5/7 mirrored variants).
const ORIENT_LABEL = { 1: 'ip.or1', 2: 'ip.or2', 3: 'ip.or3', 4: 'ip.or4', 5: 'ip.or5', 6: 'ip.or6', 7: 'ip.or7', 8: 'ip.or8' };

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  try { return d.toLocaleString(document.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'medium' }); } catch { return iso; }
}

/** Card body for an item (meta from input.js readMeta) and the settings it exports with. */
// Privacy angle: GPS coordinates are the most sensitive metadata in photos, so their presence triggers an explicit
// note telling whether the current output settings strip or keep them. Text chunks and values are truncated
// (40 entries, 400 chars) to keep a hostile file from flooding the DOM; all values go through text nodes, never
// innerHTML, so metadata cannot inject markup.
export function metaBody(item, settings) {
  const m = item.meta;
  if (!m) return h('div', { class: 'ap-empty' }, t('ip.reading'));
  const parts = [];
  const dims = m.width ? `${m.width} × ${m.height}` : item.dims ? `${item.dims.w} × ${item.dims.h}` : null;
  parts.push(h('h3', { class: 'ip-mh' }, t('ip.mFile')));
  parts.push(kv([
    [t('ip.mName'), item.name],
    [t('ip.mFormat'), KIND_LABEL[m.kind] || item.type || '?'],
    [t('ip.mSize'), fmtBytes(item.size)],
    [t('ip.mDims'), dims],
    m.orientation !== 1 ? [t('ip.mOrientation'), t(ORIENT_LABEL[m.orientation])] : null,
    ...m.format.map(([k, v]) => [t('ip.m.' + k), v]),
  ]));
  const ex = m.exif && m.exif.summary;
  if (ex) {
    const camera = [ex.make, ex.model && ex.make && ex.model.startsWith(ex.make) ? ex.model.slice(ex.make.length).trim() : ex.model].filter(Boolean).join(' ');
    const exposure = [ex.exposureTime, ex.fNumber, ex.iso != null ? 'ISO ' + ex.iso : null, ex.focalLength && (ex.focalLength + (ex.focalLength35 && ex.focalLength35 !== ex.focalLength ? ` (${ex.focalLength35} 35mm)` : ''))].filter(Boolean).join(' · ');
    const gps = ex.gps ? `${ex.gps.lat.toFixed(6)}, ${ex.gps.lon.toFixed(6)}${ex.gps.alt != null ? ` · ${ex.gps.alt} m` : ''}` : null;
    parts.push(h('h3', { class: 'ip-mh' }, t('ip.mCamera')));
    parts.push(kv([
      [t('ip.mCameraModel'), camera || null], [t('ip.mLens'), ex.lens], [t('ip.mTaken'), fmtDate(ex.dateTime)], [t('ip.mExposure'), exposure || null],
      [t('ip.mBias'), ex.exposureBias], [t('ip.mFlash'), ex.flash ? t(ex.flash.fired ? 'ip.flashOn' : 'ip.flashOff') : null], [t('ip.mWb'), ex.whiteBalance],
      [t('ip.mSoftware'), ex.software], [t('ip.mArtist'), ex.artist], [t('ip.mCopyright'), ex.copyright], [t('ip.mDescription'), ex.description],
      [t('ip.mGps'), gps], [t('ip.mThumb'), ex.thumbnail ? fmtBytes(ex.thumbnail) : null],
    ]));
    if (ex.gps) {
      parts.push(h('p', { class: 'ip-note ' + (settings.output.strip ? 'ip-note-ok' : 'ip-note-warn') }, iconEl(settings.output.strip ? 'shield' : 'warn'), t(settings.output.strip ? 'ip.gpsRemoved' : 'ip.gpsKept')));
    }
  }
  if (m.text && m.text.length) {
    parts.push(h('h3', { class: 'ip-mh' }, t('ip.mText')));
    parts.push(kv(m.text.slice(0, 40).map((e) => [e.keyword, e.text.length > 400 ? e.text.slice(0, 400) + '…' : e.text])));
  }
  if (m.exif && m.exif.entries.length) {
    const rows = m.exif.entries.map((e) => h('tr', {}, h('td', {}, e.group), h('td', {}, e.name), h('td', {}, e.value)));
    parts.push(h('details', { class: 'ip-tags' },
      h('summary', {}, t('ip.mAllTags', { n: m.exif.entries.length })),
      h('div', { class: 'ap-table-wrap' }, h('table', { class: 'ap-table' },
        h('thead', {}, h('tr', {}, h('th', {}, t('ip.mGroup')), h('th', {}, t('ip.mTag')), h('th', {}, t('ip.mValue')))),
        h('tbody', {}, rows)))));
  }
  if (!ex && !(m.text && m.text.length)) parts.push(h('p', { class: 'ed-hint' }, t('ip.mNoMeta')));
  parts.push(h('p', { class: 'ed-hint ip-exportnote' }, t(settings.output.strip ? 'ip.exportStrips' : 'ip.exportKeeps')));
  return h('div', { class: 'ip-meta' }, parts);
}
