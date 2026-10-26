// schema/tags.js - tags defined without code: a tag type has a label, an icon, a colour, where it may be put
// (building, unit), up to six fields (number with a registry unit converted on input or a free unit label and an
// optional scale; text; select) and text variants per language, of which the first whose variables are all set is
// shown ("beach: {dist}, {walk} min walk" -> "beach {dist}" -> the label). A link template builds a URL from the tag
// (%m text, %t label, %p the object, %i / %o dates, {field}) and only http(s), tel and mailto survive. A unit inherits
// the marks of its building, may switch one off or override field values one by one. Search tokens name a tag, a
// select option or a scale step; two tag types collide by key or by a label in any language.
//
//   TAG_WHERE, TAG_FIELD_KINDS, SAFE_LINK
//   normalizeTagDef(raw) -> def | null      normalizeTagField(raw) -> field | null
//   normalizeTagValues(def, raw) -> { key: value }    ({ value, unit } numbers are converted to the field unit)
//   tagFieldText(field, v, lang)   tagText(def, values, lang, { scales, html: { esc, value } })
//   tagLinkUrl(def, values, lang, { prop, checkIn, checkOut }, scales) -> url | ''
//   inheritMarks(buildingMarks, unitMarks) -> [{ tag, values, from: 'building' | 'unit' | 'both' }]
//   tagIndexTokens(id, def, values, scales) -> ['t12', 't12.mall.metro', 't12.dist~0']
//   parseTagTokens(raw) / tagTokenGroup(token) / TAG_TOKEN_RE
//   tagsCollide(a, b)  tagCompare(mine, shared, lang)  migrateTagValues(from, to, values) -> { values, dropped }

//
// Security: tag definitions are shared between agencies, so every string is capped, colours are whitelisted to
// #rrggbb, and links are checked against SAFE_LINK both when the definition is stored and after substitution
// (substituted values are percent-encoded and cannot change the scheme, but the check is cheap insurance).
// tagText escapes literal template text and values separately through opts.html.esc, so a label containing '<' is
// safe in HTML output while the caller can still inject trusted markup for values (opts.html.value).
import { cleanKey, i18n, pick } from './text.js';
import { scaleStepIndex, scaleWord } from '../units/scales.js';
import { convert, unit as unitOf } from '../units/registry.js';
import { formatQuantity } from '../units/format.js';

export const TAG_WHERE = ['building', 'unit'];
export const TAG_FIELD_KINDS = ['number', 'text', 'select'];
export const SAFE_LINK = /^(https?:\/\/|tel:|mailto:)/i;

const cleanOpt = (v) => { const s = String(v ?? '').trim().toLowerCase(); return /^[a-z0-9_-]{1,40}$/.test(s) ? s : ''; };
const cleanColor = (v) => { const s = String(v ?? '').trim(); return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : ''; };

// A select without any valid option is rejected (null): it could never hold a value.
export function normalizeTagField(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const key = cleanKey(raw.key);
  if (!key) return null;
  const kind = TAG_FIELD_KINDS.includes(raw.kind) ? raw.kind : 'text';
  const options = [];
  if (kind === 'select') {
    for (const o of (Array.isArray(raw.options) ? raw.options : []).slice(0, 40)) {
      const v = cleanOpt(o?.v);
      const label = i18n(o?.label ?? o?.name, 60);
      if (v && !options.some((x) => x.v === v)) options.push({ v, label: Object.keys(label).length ? label : { en: v } });
    }
    if (!options.length) return null;
  }
  const unit = kind === 'number' && unitOf(raw.unit) ? raw.unit : '';
  return {
    key, label: i18n(raw.label ?? raw.name, 60), kind, unit,
    unitText: kind === 'number' && !unit ? i18n(raw.unitText, 30) : {},
    scale: kind === 'number' ? cleanKey(raw.scale) : '', options,
  };
}

export function normalizeTagDef(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const key = cleanKey(raw.key);
  const label = i18n(raw.label ?? raw.name, 60);
  if (!key || !Object.keys(label).length) return null;
  const fields = [];
  for (const f of (Array.isArray(raw.fields) ? raw.fields : []).slice(0, 6)) { const x = normalizeTagField(f); if (x && !fields.some((y) => y.key === x.key)) fields.push(x); }
  const texts = [];
  for (const t of (Array.isArray(raw.texts) ? raw.texts : []).slice(0, 6)) { const x = i18n(t, 200); if (Object.keys(x).length) texts.push(x); }
  const where = (Array.isArray(raw.where) ? raw.where : []).filter((w) => TAG_WHERE.includes(w));
  const link = String(raw.link ?? '').trim().slice(0, 400);
  return {
    key, label, icon: String(raw.icon ?? '').trim().slice(0, 8), color: cleanColor(raw.color),
    where: where.length ? [...new Set(where)] : ['unit'], fields, texts, link: SAFE_LINK.test(link) ? link : '',
  };
}

// Numbers are rounded to 4 decimals after unit conversion so "1 mi" stored in km does not keep 1.609344000000001.
// Only keys declared by def survive: values of removed fields drop out on the next save.
export function normalizeTagValues(def, raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const f of def.fields) {
    const v = raw[f.key];
    if (v === undefined || v === null || v === '') continue;
    if (f.kind === 'number') {
      let n = null;
      if (typeof v === 'object' && !Array.isArray(v)) {
        const x = Number(String(v.value ?? '').replace(',', '.'));
        n = f.unit && v.unit && unitOf(v.unit) ? convert(x, v.unit, f.unit) : Number.isFinite(x) ? x : null;
      } else { const x = Number(String(v).replace(',', '.')); n = Number.isFinite(x) ? x : null; }
      if (n !== null && Number.isFinite(n)) out[f.key] = Math.round(n * 10000) / 10000;
    } else if (f.kind === 'select') {
      const s = cleanOpt(v);
      if (f.options.some((o) => o.v === s)) out[f.key] = s;
    } else {
      const s = String(v).trim().slice(0, 120);
      if (s) out[f.key] = s;
    }
  }
  return out;
}

export function tagFieldText(f, v, lang = 'en') {
  if (v === undefined || v === null || v === '') return '';
  if (f.kind === 'select') { const o = f.options.find((x) => x.v === String(v)); return o ? pick(o.label, lang) || o.v : ''; }
  if (f.kind === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    if (f.unit) return formatQuantity(n, f.unit, { lang });
    const u = pick(f.unitText, lang), t = String(Math.round(n * 100) / 100);
    return u ? t + ' ' + u : t;
  }
  return String(v);
}

const VAR_RE = /\{([a-z][a-z0-9_]{0,39})(?::([a-z][a-z0-9_]{0,39}))?\}/gi;

// Variants are tried in order; the first whose every variable renders wins (all-or-nothing per variant, unlike the
// segment rule of rules.js). The tag label is the guaranteed last fallback, so the result is never empty.
export function tagText(def, values, lang = 'en', opts = {}) {
  const esc = opts.html ? opts.html.esc : (s) => s;
  const scales = opts.scales || [];
  for (const variant of def.texts) {
    const tpl = pick(variant, lang);
    if (!tpl) continue;
    let ok = true, out = '', last = 0;
    for (const m of tpl.matchAll(VAR_RE)) {
      const f = def.fields.find((x) => x.key === m[1].toLowerCase());
      const v = f ? values[f.key] : undefined;
      let piece = '';
      if (f && v !== undefined && v !== '') {
        if (m[2]) { const sc = scales.find((s) => s.key === m[2].toLowerCase()); const w = sc ? scaleWord(sc, v, lang) : ''; piece = w ? esc(w) : ''; }
        else { const h = opts.html?.value ? opts.html.value(f, v) : null; piece = h ?? esc(tagFieldText(f, v, lang)); }
      }
      if (!piece) { ok = false; break; }
      out += esc(tpl.slice(last, m.index)) + piece;
      last = m.index + m[0].length;
    }
    if (!ok) continue;
    out += esc(tpl.slice(last));
    const clean = out.replace(/\s{2,}/g, ' ').trim();
    if (clean) return clean;
  }
  return esc(pick(def.label, lang) || def.key);
}

/** One pass of replacement (a value containing '%p' does not become a template); only safe schemes come out. */
export function tagLinkUrl(def, values, lang = 'en', vars = {}, scales = []) {
  if (!def.link) return '';
  const enc = (s) => encodeURIComponent(String(s ?? ''));
  const map = { '%m': enc(tagText(def, values, lang, { scales })), '%t': enc(pick(def.label, lang) || def.key), '%p': enc(String(vars.prop ?? '').slice(0, 300)), '%i': enc(vars.checkIn), '%o': enc(vars.checkOut) };
  const url = def.link.replace(/%[mtpio]|\{([a-z][a-z0-9_]{0,39})(?::([a-z][a-z0-9_]{0,39}))?\}/gi, (all, k, s) => {
    if (!k) return map[all.toLowerCase()] ?? all;
    const f = def.fields.find((x) => x.key === k.toLowerCase());
    const v = f ? values[f.key] : undefined;
    if (!f || v === undefined) return '';
    if (s) { const sc = scales.find((x) => x.key === s.toLowerCase()); return enc(sc ? scaleWord(sc, v, lang) : ''); }
    return enc(tagFieldText(f, v, lang));
  });
  return SAFE_LINK.test(url) ? url : '';
}

/** A unit sees the marks of its building; `off` on the unit removes one; unit values override per field. */
export function inheritMarks(building, unit) {
  const out = new Map();
  for (const m of building || []) if (!m.off) out.set(m.tag, { tag: m.tag, values: { ...m.values }, from: 'building' });
  for (const m of unit || []) {
    const b = out.get(m.tag);
    if (m.off) { out.delete(m.tag); continue; }
    out.set(m.tag, b ? { tag: m.tag, values: { ...b.values, ...m.values }, from: 'both' } : { tag: m.tag, values: { ...m.values }, from: 'unit' });
  }
  return [...out.values()];
}

// Search tokens are flat strings so a plain inverted index (or SQL LIKE / array contains) can serve faceted search:
// 't12' = has tag 12, 't12.mall.metro' = select value, 't12.dist~0' = scale step 0. Scale steps instead of raw numbers
// keep the token space finite ("under 500 m" is one token, not every distance).
export function tagIndexTokens(id, def, values, scales = []) {
  const t = 't' + Math.trunc(id);
  const out = [t];
  for (const f of def.fields) {
    const v = values[f.key];
    if (v === undefined || v === '') continue;
    if (f.kind === 'select') out.push(`${t}.${f.key}.${v}`);
    if (f.kind === 'number' && f.scale) {
      const sc = scales.find((s) => s.key === f.scale);
      const i = sc ? scaleStepIndex(sc, v) : -1;
      if (i >= 0) out.push(`${t}.${f.key}~${i}`);
    }
  }
  return out;
}

export const TAG_TOKEN_RE = /^t\d{1,9}(\.[a-z][a-z0-9_]{0,39}(\.[a-z0-9_-]{1,40}|~\d{1,2}))?$/;
export function parseTagTokens(raw) {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  const out = [];
  for (const x of list) {
    const s = String(x ?? '').trim().toLowerCase();
    if (TAG_TOKEN_RE.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= 20) break;
  }
  return out;
}
/** Tokens of one group are OR-ed (two malls at once), groups are AND-ed. */
export const tagTokenGroup = (tok) => tok.replace(/(\.[a-z0-9_-]{1,40}|~\d{1,2})$/, '');

// Collision key for names: case-folded, ё folded to е (Russian writers use both), punctuation collapsed.
const nameKey = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function tagsCollide(a, b) {
  if (a.key === b.key) return true;
  const an = new Set(Object.values(a.label).map(nameKey).filter(Boolean));
  return Object.values(b.label).map(nameKey).some((n) => n && an.has(n));
}

export function tagCompare(mine, shared, lang = 'en') {
  const keys = [...new Set([...mine.fields.map((f) => f.key), ...shared.fields.map((f) => f.key)])];
  const label = (f) => (f ? `${pick(f.label, lang) || f.key} · ${f.kind}` : '');
  return {
    fields: keys.map((k) => {
      const a = mine.fields.find((f) => f.key === k), b = shared.fields.find((f) => f.key === k);
      return { key: k, mine: label(a), shared: label(b), same: !!a && !!b && a.kind === b.kind };
    }),
    texts: JSON.stringify(mine.texts) === JSON.stringify(shared.texts),
    link: mine.link === shared.link,
    where: JSON.stringify([...mine.where].sort()) === JSON.stringify([...shared.where].sort()),
  };
}

/** Values moved to another tag type: same key and kind move, options by code then by label, units converted. */
export function migrateTagValues(from, to, values) {
  const out = {}, dropped = [];
  for (const [k, v] of Object.entries(values)) {
    const a = from.fields.find((f) => f.key === k), b = to.fields.find((f) => f.key === k);
    if (!a || !b || a.kind !== b.kind) { dropped.push(k); continue; }
    if (b.kind === 'select') {
      const aLabel = a.options.find((o) => o.v === String(v))?.label || {};
      const hit = b.options.find((o) => o.v === String(v)) || b.options.find((o) => Object.values(o.label).some((n) => Object.values(aLabel).map(nameKey).includes(nameKey(n))));
      if (hit) out[k] = hit.v; else dropped.push(k);
    } else if (b.kind === 'number' && a.unit && b.unit && a.unit !== b.unit) {
      const n = convert(v, a.unit, b.unit);
      if (n === null) dropped.push(k); else out[k] = Math.round(n * 10000) / 10000;
    } else out[k] = v;
  }
  return { values: out, dropped };
}
