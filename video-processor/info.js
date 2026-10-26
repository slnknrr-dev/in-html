// video-processor/info.js - the media info panel: container, size, duration, bit rate, metadata and one
// block per track, from the probe of the format libraries.
import { h } from '../ui/dom.js';
import { fmtBytes } from '../ui/files.js';
import { t } from '../ui/i18n.js';
import { fmtTime } from './geometry.js';

const kbps = (b) => (b ? (b >= 1e6 ? (b / 1e6).toFixed(2) + ' Mbps' : Math.round(b / 1000) + ' kbps') : '');
const yesNo = (v) => (v === 'yes' ? t('vp.i.yes') : v === 'no' ? t('vp.i.no') : v);
const META = ['title', 'artist', 'album', 'albumArtist', 'date', 'year', 'genre', 'track', 'comment', 'encoder', 'composer', 'copyright', 'software'];

// Key/value list that skips empty values, so tracks without a field (audio has no fps) do not show blank rows.
function kv(rows) {
  const dl = h('dl', { class: 'ap-kv' });
  for (const [k, v] of rows) if (v !== undefined && v !== null && v !== '') dl.append(h('dt', {}, k), h('dd', {}, String(v)));
  return dl;
}

/** Info panel content for a source (null: an empty-state line). */
export function renderInfo(src) {
  if (!src) return h('p', { class: 'ap-empty' }, t('vp.empty'));
  const p = src.probe || {};
  const box = h('div', { class: 'vp-info' });
  box.append(h('div', { class: 'vp-info-name' }, src.name));
  box.append(kv([
    [t('vp.i.container'), p.label || '?'],
    [t('vp.i.size'), fmtBytes(src.size)],
    [t('vp.i.duration'), src.duration ? fmtTime(src.duration, 3) : ''],
    [t('vp.i.bitrate'), kbps(p.bitrate)],
    ...p.extra?.map(([k, v]) => [t(k), yesNo(v)]) || [],
    ...(src.fixed ? [[t('vp.i.seekable'), t('vp.i.fixed')]] : []),
  ]));
  const meta = META.filter((k) => p.meta?.[k]).map((k) => [t('vp.m.' + k), p.meta[k]]);
  if (meta.length || p.cover) {
    const sec = h('div', { class: 'vp-info-sec' }, h('h3', { class: 'vp-info-h' }, t('vp.i.tags')));
    if (p.cover) {
      // KNOWN DEFECT: this object URL is never revoked, so every re-render of the panel leaks one Blob of cover art
      // until the page closes. Fix: revoke it on the image load event (img.onload = () => URL.revokeObjectURL(url)).
      const url = URL.createObjectURL(new Blob([p.cover.data], { type: p.cover.mime }));
      sec.append(h('img', { class: 'vp-cover', src: url, alt: t('vp.i.cover') }));
    }
    sec.append(kv(meta));
    box.append(sec);
  }
  (p.tracks || []).forEach((tr, i) => {
    const isV = tr.type === 'video';
    const rows = [
      [t('vp.i.codec'), tr.codecName && tr.codecName !== tr.codec ? `${tr.codecName} (${tr.codec})` : tr.codec],
      isV ? [t('vp.i.resolution'), tr.width ? `${tr.width} × ${tr.height}` : ''] : [t('vp.i.rate'), tr.sampleRate ? `${Math.round(tr.sampleRate)} Hz` : ''],
      isV ? [t('vp.i.fps'), tr.fps ? (Math.round(tr.fps * 100) / 100) + ' fps' : ''] : [t('vp.i.channels'), tr.channels || ''],
      [t('vp.i.depth'), tr.bitDepth ? tr.bitDepth + ' bit' : ''],
      [t('vp.i.bitrate'), kbps(tr.bitrate)],
      [t('vp.i.frames'), tr.frames || ''],
      [t('vp.i.rotation'), tr.rotation ? tr.rotation + '°' : ''],
      [t('vp.i.lang'), tr.language && !['und', 'eng'].includes(tr.language) ? tr.language : ''],
    ];
    const kind = isV ? t('vp.i.video') : tr.type === 'audio' ? t('vp.i.audio') : tr.type;
    box.append(h('div', { class: 'vp-info-sec' }, h('h3', { class: 'vp-info-h' }, `${t('vp.i.track')} ${i + 1} · ${kind}`), kv(rows)));
  });
  if (p.error) box.append(h('p', { class: 'ed-hint ed-hint-warn' }, t('vp.i.partial', { msg: p.error })));
  return box;
}
