// resume-app/viewer-blocks.js - resume blocks: profile, contacts, timeline, skills, languages, key-value list (the generic
// document blocks come from paper/blocks.js).
//
// Block definition contract (consumed by doc/product.js and the studio):
//   category / icon      palette placement;  container: false = a leaf block (no child blocks)
//   i18nFields           per-language block fields ({ lang: text }); itemI18nFields the same for list items
//   richFields           fields edited as rich text ('rich' = paragraphs, 'inline' = inline markup only)
//   defaults / itemDefaults   factories (functions, so every new block gets fresh objects, never shared ones)
//   schema / itemSchema  property panel description; the studio builds forms from it, no per-block UI code
//   render(b, ctx)       returns an HTML string; ctx carries mode (edit / export), languages, attachments
// Renderers serve both the editor canvas and the exported page: ctx.edit adds placeholders and editable fields,
// export mode drops empty parts so the printed resume has no blank boxes. Every value that reaches HTML goes through
// fld()/txt() (sanitised per field kind) or escapeHTML / escapeAttr.
// Class names are written with the 'rv' prefix here, matching prefix 'rv' in viewer.js; the CSS chunks use __P__.
import { htmlToText, pickFrom, pickText } from '../i18n/text.js';
import { escapeAttr, escapeHTML } from '../html/escape.js';
import { normURL } from '../html/url.js';
import { CONTACT_KINDS, LANG_LEVELS, LEVEL_STEPS } from './viewer-base.js';
import { uiText } from '../doc/dict.js';
import { uid } from '../util/id.js';
import { num, oneOf, own, str } from '../util/value.js';
import { numOpts, optList } from '../doc/schema.js';
import { attOf, attSrc, imgAttr, isImage } from '../doc/attach.js';
import { addItemBox, altAttr, breakable, di, extAttrs, fld, grp, has, icon, noItems, plainIn, txt, ui } from '../doc/render.js';
import { formatDate, formatDuration, parseYM } from '../doc/dates.js';

// Link target of a contact. Explicit href wins (normURL rejects unsafe schemes). Otherwise derived per kind from a
// bare value: handles become profile URLs, phones keep digits and '+' only (dialers choke on spaces and brackets).
// Values that already are http(s) URLs pass through, so pasting a full profile link always works.
// Mastodon needs user@instance: without the instance a handle cannot be resolved, so no link is better than a guess.
function contactHref(item) {
  if (!item) return '';
  const href = str(item.href).trim();
  if (href) return normURL(href);
  const v = str(item.value).trim();
  if (!v) return '';
  const isURL = /^https?:\/\//i.test(v);
  const handle = v.replace(/^@/, '');
  switch (item.kind) {
    case 'email': return /^mailto:/i.test(v) ? v : 'mailto:' + v.replace(/\s+/g, '');
    case 'phone': return 'tel:' + v.replace(/[^\d+]/g, '');
    case 'whatsapp': return isURL ? v : 'https://wa.me/' + v.replace(/\D/g, '');
    case 'web': return isURL ? v : normURL(v) || 'https://' + v.replace(/\s+/g, '');
    case 'github': return isURL ? v : 'https://github.com/' + handle;
    case 'codeberg': return isURL ? v : 'https://codeberg.org/' + handle;
    case 'gitlab': return isURL ? v : 'https://gitlab.com/' + handle;
    case 'linkedin': return isURL ? v : 'https://www.linkedin.com/in/' + handle;
    case 'telegram': return isURL ? v : 'https://t.me/' + handle;
    case 'x': return isURL ? v : 'https://x.com/' + handle;
    case 'mastodon': {
      if (isURL) return v;
      const m = /^@?([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(v);
      return m ? 'https://' + m[2] + '/@' + m[1] : '';
    }
    default: return ''; // location, birth, skype, other → no link
  }
}

// Item ids (uid) are stable keys for editor selection and drag-and-drop; indexes would shift on reorder.
const RESUME_BLOCKS = {
  profile: {
    category: 'resume', icon: 'user', container: false,
    i18nFields: ['name', 'title', 'summary'], richFields: { summary: 'rich' },
    defaults: () => ({ name: {}, title: {}, summary: {}, photo: null, photoShape: 'circle', photoSize: 32, align: 'left' }),
    schema: [
      { key: 'photo', type: 'att', label: 'f.photo', accept: 'image/' },
      { key: 'photoShape', type: 'select', label: 'f.photoShape', options: optList('circle', 'rounded', 'square') },
      { key: 'photoSize', type: 'number', label: 'f.photoSize', min: 15, max: 70, step: 1, unit: 'mm' },
      { key: 'align', type: 'select', label: 'f.align', options: optList('left', 'center', 'split') },
    ],
    render: renderProfile,
  },
  contacts: {
    category: 'resume', icon: 'idcard', container: false,
    i18nFields: [], itemI18nFields: ['label'],
    defaults: () => ({ items: [], layout: 'list', icons: true, showLabels: false }),
    schema: [
      { key: 'layout', type: 'select', label: 'f.layout', options: optList('list', 'inline', 'grid') },
      { key: 'icons', type: 'checkbox', label: 'f.icons' },
      { key: 'showLabels', type: 'checkbox', label: 'f.showLabels' },
    ],
    itemSchema: [
      { key: 'kind', type: 'select', label: 'f.kind', options: CONTACT_KINDS.map((k) => ({ v: k, l: 'ck.' + k })) },
      { key: 'value', type: 'text', label: 'f.value' },
      { key: 'href', type: 'text', label: 'f.href' },
      { key: 'label', type: 'i18n', label: 'f.label' },
    ],
    itemDefaults: () => ({ id: uid(), kind: 'email', value: '', href: '', label: {} }),
    render: renderContacts,
  },
  timeline: {
    category: 'resume', icon: 'timeline', container: false,
    i18nFields: [], itemI18nFields: ['title', 'org', 'location', 'tags', 'html'], itemRichFields: { html: 'rich' },
    defaults: () => ({ items: [], style: 'classic', dateFormat: 'month', showDuration: false, datePos: 'left' }),
    schema: [
      { key: 'style', type: 'select', label: 'f.style', options: optList('classic', 'line', 'compact', 'cards') },
      { key: 'dateFormat', type: 'select', label: 'f.dateFormat', options: optList('month', 'monthLong', 'year', 'numeric') },
      { key: 'showDuration', type: 'checkbox', label: 'f.showDuration', hint: 'fld.durationHint' },
      { key: 'datePos', type: 'select', label: 'f.datePos', options: optList('left', 'right', 'inline') },
    ],
    itemSchema: [
      { key: 'start', type: 'date', label: 'f.start' },
      { key: 'end', type: 'date', label: 'f.end', allowPresent: true },
      { key: 'url', type: 'text', label: 'f.url' },
      { key: 'title', type: 'i18n', label: 'f.title' },
      { key: 'org', type: 'i18n', label: 'f.org' },
      { key: 'location', type: 'i18n', label: 'f.location' },
      { key: 'tags', type: 'i18n', label: 'f.tags' },
    ],
    itemDefaults: () => ({ id: uid(), start: '', end: '', url: '', title: {}, org: {}, location: {}, tags: {}, html: {} }),
    render: renderTimeline,
  },
  skills: {
    category: 'resume', icon: 'bars', container: false,
    i18nFields: [], itemI18nFields: ['name', 'group'],
    defaults: () => ({ items: [], style: 'bars', showLevel: true, columns: 1, groupBy: false }),
    schema: [
      { key: 'style', type: 'select', label: 'f.style', options: optList('bars', 'dots', 'tags', 'list', 'grid') },
      { key: 'showLevel', type: 'checkbox', label: 'f.showLevel' },
      { key: 'columns', type: 'select', label: 'f.columns', options: numOpts(1, 2, 3) },
      { key: 'groupBy', type: 'checkbox', label: 'f.groupBy' },
    ],
    itemSchema: [
      { key: 'name', type: 'i18n', label: 'f.name' },
      { key: 'level', type: 'range', label: 'f.level', min: 0, max: 5, step: 1 },
      { key: 'group', type: 'i18n', label: 'f.group' },
    ],
    itemDefaults: () => ({ id: uid(), name: {}, level: 3, group: {} }),
    render: renderSkills,
  },
  languages: {
    category: 'resume', icon: 'language', container: false,
    i18nFields: [], itemI18nFields: ['name', 'note'],
    defaults: () => ({ items: [], style: 'list' }),
    schema: [
      { key: 'style', type: 'select', label: 'f.style', options: optList('list', 'bars', 'dots', 'table') },
    ],
    itemSchema: [
      { key: 'name', type: 'i18n', label: 'f.name' },
      { key: 'level', type: 'select', label: 'f.level', options: optList(...LANG_LEVELS) },
      { key: 'note', type: 'i18n', label: 'f.note' },
    ],
    itemDefaults: () => ({ id: uid(), name: {}, level: 'B2', note: {} }),
    render: renderLanguages,
  },
  keyvalue: {
    category: 'resume', icon: 'list', container: false,
    i18nFields: [], itemI18nFields: ['k', 'v'], itemRichFields: { v: 'inline' }, itemLabel: 'k',
    defaults: () => ({ items: [], cols: 1, style: 'table' }),
    schema: [
      { key: 'cols', type: 'select', label: 'f.cols', options: numOpts(1, 2) },
      { key: 'style', type: 'select', label: 'f.style', options: optList('table', 'inline', 'stacked') },
    ],
    itemSchema: [
      { key: 'k', type: 'i18n', label: 'f.k' },
      { key: 'v', type: 'i18n', label: 'f.v' },
    ],
    itemDefaults: () => ({ id: uid(), k: {}, v: {} }),
    render: renderKeyValue,
  },
};

/* ---------- block renderers ---------- */

// The photo is sized in mm (paper units, it prints at the chosen size). Alt text falls back to the person's name
// per language. In the editor a missing attachment shows a placeholder so the user sees what is broken; on export
// it simply disappears.
function renderProfile(b, ctx) {
  let photo = '';
  const a = attOf(ctx, b.photo);
  const sz = num(b.photoSize, 32, 15, 70);
  const shape = oneOf(b.photoShape, ['circle', 'rounded', 'square'], 'circle');
  const box = `class="rv-pf-photo rv-sh-${shape}`;
  if (a && isImage(a)) {
    const src = attSrc(ctx, a);
    if (src) {
      const alt = altAttr(ctx, (l) => plainIn(ctx, b.name, l) || a.name);
      photo = `<img ${box}" src="${escapeAttr(src)}"${alt} style="width:${sz}mm;height:${sz}mm"${imgAttr(ctx, a)}>`;
    }
  }
  if (!photo && b.photo && ctx.edit) {
    photo = `<div ${box} rv-att-missing" style="width:${sz}mm;height:${sz}mm">${icon(ctx, 'user')}</div>`;
  }
  const name = fld(ctx, b, 'name', 'plain', 'h1', 'rv-pf-name', 'ph.name');
  const title = fld(ctx, b, 'title', 'plain', 'p', 'rv-pf-title', 'ph.title');
  const sum = fld(ctx, b, 'summary', 'rich', 'div', 'rv-pf-sum rv-rich', 'ph.summary', { ecls: 'rv-opt' });
  // Nothing to show = no wrapper at all: an empty profile must not leave an empty flex row in the export.
  if (!photo && !name && !title && !sum) return '';
  return `<div class="rv-pf rv-pf-${oneOf(b.align, ['left', 'center', 'split'], 'left')}">${photo}<div class="rv-pf-main">${name}${title}${sum}</div></div>`;
}

// URL_KINDS display without scheme and "www." (shorter, as people write them). BREAK_KINDS get breakable() markup
// (soft break opportunities after / . @) so a long address wraps in a narrow sidebar instead of overflowing.
const URL_KINDS = ['web', 'github', 'codeberg', 'gitlab', 'linkedin', 'telegram', 'x', 'mastodon', 'whatsapp'];
const BREAK_KINDS = ['email', 'skype', ...URL_KINDS];
function contactText(it) {
  const v = str(it.value).trim();
  if (URL_KINDS.includes(it.kind) && /^https?:\/\//i.test(v)) return v.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  return v;
}

function renderContacts(b, ctx) {
  if (noItems(ctx, b)) return addItemBox(ctx);
  let s = '';
  (b.items || []).forEach((it, i) => {
    const kind = CONTACT_KINDS.includes(it.kind) ? it.kind : 'other';
    const value = contactText(it);
    const ic = b.icons ? icon(ctx, kind, 'rv-ct-ic') : '';
    const k = b.showLabels ? `<span class="rv-ct-k">${ui(ctx, 'ck.' + kind)}</span>` : '';
    let v;
    // Edit mode edits the label; the value is shown as the placeholder, so an empty label means "use the value".
    if (ctx.edit) {
      v = fld(ctx, b, `items.${i}.label`, 'plain', 'span', 'rv-ct-v', null,
        { ph: value || uiText('ck.' + kind, ctx.uiLang, ctx.doc), ecls: value ? 'rv-ct-auto' : '' });
    } else {
      const lbl = has(ctx, it.label);
      if (!lbl && !value) return;
      // Unknown kinds may still look like an e-mail or URL; detect them so they wrap too.
      const brk = BREAK_KINDS.includes(kind) || /^[^\s@]+@[^\s@]+$|^(https?:\/\/|www\.)\S+$/i.test(value);
      const shown = lbl ? txt(ctx, it.label) : brk ? breakable(value) : escapeHTML(value);
      const href = contactHref(it);
      v = href ? `<a class="rv-ct-v" href="${escapeAttr(href)}"${extAttrs(href)}>${shown}</a>` : `<span class="rv-ct-v">${shown}</span>`;
    }
    s += `<li class="rv-ct-item rv-ct-${kind}"${di(ctx, i)}>${ic}<span class="rv-ct-t">${k}${v}</span></li>`;
  });
  if (!s && !ctx.edit) return '';
  return `<ul class="rv-ct rv-ct-${oneOf(b.layout, ['list', 'inline', 'grid'], 'list')}">${s}</ul>`;
}

function tlDate(ctx, b, it) {
  if (!it.start && !it.end) return '';
  let from = it.start;
  let to = it.end;
  // An inverted range (end before start: a data-entry slip the editor warns about) is shown in chronological order and
  // its duration taken from the swapped pair, instead of printing "May 2021 – Feb 2019" without a duration.
  if (from && to && to !== 'present') {
    const a = parseYM(from, false);
    const z = parseYM(to, true);
    if (a != null && z != null && z < a) [from, to] = [to, from];
  }
  return grp(ctx, (l) => {
    const s = formatDate(from, l, b.dateFormat, ctx.doc);
    const e = formatDate(to, l, b.dateFormat, ctx.doc);
    // Each endpoint is an inline-block (CSS .rv-tl-d) carrying the dash after the start, so a narrow column breaks only
    // after "–"; an endpoint wider than the column ("настоящее время" in the compact style) still wraps inside its box
    // instead of overflowing, which white-space:nowrap would do.
    const d = (x) => `<span class="rv-tl-d">${escapeHTML(x)}</span>`;
    const r = s && e ? (s === e ? d(s) : d(s + '\u00a0–') + ' ' + d(e)) : d(s || e);
    let html = `<span class="rv-tl-range">${r}</span>`;
    if (b.showDuration && from && to) {
      const dur = formatDuration(from, to, l, ctx.doc);
      if (dur) html += `<span class="rv-tl-dur">${escapeHTML(dur)}</span>`;
    }
    return html;
  });
}

// Tags are one comma-separated text per language, split at render time (also Arabic ، and ideographic 、 commas),
// so translating tags is editing one field, not a list per language.
function tagChips(ctx, i18n) {
  return grp(ctx, (l) => pickText(i18n, l, ctx.pd).split(/[,;،、]\s*/).map((x) => x.trim()).filter(Boolean)
    .map((x) => `<span class="rv-tag">${escapeHTML(x)}</span>`).join(''), false, (l) => pickFrom(i18n, l, ctx.pd)[1]);
}

function renderTimeline(b, ctx) {
  if (noItems(ctx, b)) return addItemBox(ctx);
  let s = '';
  (b.items || []).forEach((it, i) => {
    const p = `items.${i}.`;
    const url = normURL(it.url);
    // Title links only for http(s): normURL may return mailto: or other schemes not meant for a job title.
    const title = fld(ctx, b, p + 'title', 'plain', 'h3', 'rv-tl-title', 'ph.itemTitle', { href: /^https?:/i.test(url) ? url : '' });
    const org = fld(ctx, b, p + 'org', 'plain', 'span', 'rv-tl-org', 'ph.org');
    const loc = fld(ctx, b, p + 'location', 'plain', 'span', 'rv-tl-loc', 'ph.location', { ecls: 'rv-opt' });
    const text = fld(ctx, b, p + 'html', 'rich', 'div', 'rv-tl-text rv-rich', 'ph.details', { ecls: 'rv-opt' });
    let tags;
    if (ctx.edit) tags = `<div class="rv-tl-tags">${fld(ctx, b, p + 'tags', 'plain', 'span', 'rv-tl-tagsf', 'ph.tags', { ecls: 'rv-opt' })}</div>`;
    else {
      const chips = tagChips(ctx, it.tags);
      tags = chips ? `<div class="rv-tl-tags">${chips}</div>` : '';
    }
    const date = tlDate(ctx, b, it);
    // In export an item with no content at all is skipped; location alone does not justify an entry.
    if (!ctx.edit && !title && !org && !text && !date) return;
    const sub = org || loc ? `<div class="rv-tl-sub">${org}${loc}</div>` : '';
    s += `<div class="rv-tl-item"${di(ctx, i)}><div class="rv-tl-date">${date}</div>`
      + `<div class="rv-tl-body"><div class="rv-tl-head">${title}${sub}</div>${text}${tags}</div></div>`;
  });
  if (!s && !ctx.edit) return '';
  const st = oneOf(b.style, ['classic', 'line', 'compact', 'cards'], 'classic');
  return `<div class="rv-tl rv-tl-${st} rv-tl-p${oneOf(b.datePos, ['left', 'right', 'inline'], 'left')}">${s}</div>`;
}

// Level dots are decorative (aria-hidden); the level is announced through a visually hidden .rv-sr text instead.
function dots(n, total, cls) {
  let s = '';
  for (let i = 0; i < total; i++) s += i < n ? '<i class="on"></i>' : '<i></i>';
  return `<span class="${cls}" aria-hidden="true">${s}</span>`;
}

function renderSkills(b, ctx) {
  if (noItems(ctx, b)) return addItemBox(ctx);
  const st = oneOf(b.style, ['bars', 'dots', 'tags', 'list', 'grid'], 'bars');
  const cols = oneOf(b.columns, [1, 2, 3], 1);
  const show = !!b.showLevel;
  const items = b.items || [];
  const one = (i) => {
    const it = items[i];
    const name = fld(ctx, b, `items.${i}.name`, 'plain', 'span', 'rv-sk-n', 'ph.skill');
    if (!name) return '';
    // Level 0..5, rounded and clamped by num(): stored data may come from older versions or hand-edited files.
    const L = Math.round(num(it.level, 0, 0, 5));
    const sr = show ? `<span class="rv-sr">${ui(ctx, 'skillLevel', { n: L })}</span>` : '';
    const d = di(ctx, i);
    if (st === 'tags') return `<span class="rv-tag rv-sk-item rv-lv${L}"${d}>${name}${show ? dots(L, 5, 'rv-dots rv-dots-sm') + sr : ''}</span>`;
    if (st === 'list') return `<li class="rv-sk-item"${d}>${name}${show ? dots(L, 5, 'rv-dots') + sr : ''}</li>`;
    if (st === 'dots') return `<div class="rv-sk-item"${d}>${name}${show ? dots(L, 5, 'rv-dots') + sr : ''}</div>`;
    // Bar width through an inline custom property (--v), so the meter CSS stays generic and static.
    const meter = show ? `<span class="rv-meter" style="--v:${L * 20}%" aria-hidden="true"><i></i></span>${sr}` : '';
    return `<div class="rv-sk-item${st === 'grid' ? ' rv-sk-card' : ''}"${d}>${name}${meter}</div>`;
  };
  const wrap = (idx) => {
    const inner = idx.map(one).join('');
    if (!inner && !ctx.edit) return '';
    if (st === 'tags') return `<div class="rv-sk-tags">${inner}</div>`;
    if (st === 'list') return `<ul class="rv-sk-list" style="--rv-skc:${cols}">${inner}</ul>`;
    return `<div class="rv-sk-grid" style="--rv-skc:${cols}">${inner}</div>`;
  };
  let body = '';
  if (!b.groupBy) body = wrap(items.map((_, i) => i));
  else {
    // Groups keyed by the group text in the key language (default/editing language), first-appearance order.
    const groups = new Map();
    items.forEach((it, i) => {
      const key = htmlToText(pickText(it.group, ctx.lang, ctx.pd)).toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    });
    for (const idx of groups.values()) {
      const list = wrap(idx);
      if (!list) continue;
      const head = fld(ctx, b, `items.${idx[0]}.group`, 'plain', 'h4', 'rv-sk-g', 'ph.group');
      body += `<div class="rv-sk-grp">${head}${list}</div>`;
    }
  }
  if (!body && !ctx.edit) return '';
  return `<div class="rv-sk rv-sk-${st}">${body}</div>`;
}

function renderLanguages(b, ctx) {
  if (noItems(ctx, b)) return addItemBox(ctx);
  const st = oneOf(b.style, ['list', 'bars', 'dots', 'table'], 'list');
  let rows = '';
  (b.items || []).forEach((it, i) => {
    if (!ctx.edit && !has(ctx, it.name)) return;
    // Unknown level falls back to B2 (the default of new items) instead of dropping the row.
    const L = LANG_LEVELS.includes(it.level) ? it.level : 'B2';
    const lvl = L === 'native' ? ui(ctx, 'lvl.native') : `<b>${ui(ctx, 'lvl.' + L)}</b> · ${ui(ctx, 'lvlName.' + L)}`;
    const lvlHTML = `<span class="rv-lg-l">${lvl}</span>`;
    const note = fld(ctx, b, `items.${i}.note`, 'plain', 'span', 'rv-lg-note', 'ph.note', { ecls: 'rv-opt' });
    const d = di(ctx, i);
    if (st === 'table') {
      // Table style: the language name is a <th> (row header), so screen readers announce it for the level cells.
      const name = fld(ctx, b, `items.${i}.name`, 'plain', 'th', 'rv-lg-n', 'ph.language', { keep: true });
      rows += `<tr class="rv-lg-item"${d}>${name}<td>${lvlHTML}</td><td>${note}</td></tr>`;
      return;
    }
    const name = fld(ctx, b, `items.${i}.name`, 'plain', 'span', 'rv-lg-n', 'ph.language');
    // own() reads only own properties: a level like "constructor" from tampered data cannot hit Object.prototype.
    const steps = own(LEVEL_STEPS, L) || 4;
    if (st === 'bars') {
      let seg = '';
      for (let k = 1; k <= 6; k++) seg += k <= steps ? '<i class="on"></i>' : '<i></i>';
      rows += `<li class="rv-lg-item"${d}><div class="rv-lg-top">${name}${lvlHTML}</div><span class="rv-seg" aria-hidden="true">${seg}</span>${note}</li>`;
    } else if (st === 'dots') {
      rows += `<li class="rv-lg-item"${d}><div class="rv-lg-top">${name}${dots(steps, 6, 'rv-dots')}</div>`
        + `<span class="rv-lg-l rv-lg-sub">${lvl}</span>${note}</li>`;
    } else {
      rows += `<li class="rv-lg-item"${d}>${name}${lvlHTML}${note}</li>`;
    }
  });
  if (!rows && !ctx.edit) return '';
  if (st === 'table') return `<table class="rv-lgt"><tbody>${rows}</tbody></table>`;
  return `<ul class="rv-lg rv-lg-${st}">${rows}</ul>`;
}

function renderKeyValue(b, ctx) {
  if (noItems(ctx, b)) return addItemBox(ctx);
  let s = '';
  (b.items || []).forEach((it, i) => {
    if (!ctx.edit && !has(ctx, it.k) && !has(ctx, it.v)) return;
    // <div> wrappers inside <dl> are valid HTML (WHATWG) and let CSS grid treat each key/value pair as one row.
    s += `<div class="rv-kv-row"${di(ctx, i)}>`
      + fld(ctx, b, `items.${i}.k`, 'plain', 'dt', 'rv-kv-k', 'ph.key', { keep: true })
      + fld(ctx, b, `items.${i}.v`, 'inline', 'dd', 'rv-kv-v', 'ph.value', { keep: true })
      + '</div>';
  });
  if (!s && !ctx.edit) return '';
  const st = oneOf(b.style, ['table', 'inline', 'stacked'], 'table');
  return `<dl class="rv-kv rv-kv-${st}" style="--rv-kvc:${oneOf(b.cols, [1, 2], 1)}">${s}</dl>`;
}

export {
  RESUME_BLOCKS,
  contactHref
};
