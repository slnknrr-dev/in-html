// site-studio/viewer-migrate.js - document migrations run by normalizeTop before the blocks are normalized:
// the domain-specific `works` block (portfolio set to music) becomes the generic `collection` block.
import { isObj, str } from '../util/value.js';
//
// Design rules: migrations are pure data rewrites on plain JSON, idempotent (a migrated block no longer has type
// 'works', so a second pass is a no-op) and lossless for what the new block can show. Ids are preserved so links,
// comments and anchors that reference the block keep working. Unknown fields ride along via the object spread.

// Attribute labels of migrated `works` fields per UI language (the document's languages pick by primary subtag).
const MG_LABELS = {
  music: { en: 'Music', ru: 'Музыка', uk: 'Музика', de: 'Musik', fr: 'Musique', es: 'Música', ka: 'მუსიკა' },
  year: { en: 'Year', ru: 'Год', uk: 'Рік', de: 'Jahr', fr: 'Année', es: 'Año', ka: 'წელი' },
  duration: { en: 'Duration', ru: 'Длительность', uk: 'Тривалість', de: 'Dauer', fr: 'Durée', es: 'Duración', ka: 'ხანგრძლივობა' },
};

// 'pt-BR' -> 'pt': label tables are keyed by primary subtag only; regional variants share a label.
const mgPrimary = (l) => str(l).toLowerCase().split('-')[0];

// {lang: label} of a migrated field for the document languages.
function mgLabel(key, langs) {
  const t = MG_LABELS[key];
  const o = {};
  for (const l of langs) o[l] = t[mgPrimary(l)] || t.en;
  return o;
}

// i18n value (object or string → {dl: string}); `strip` drops a leading "<label>:" the old field rendered itself.
function mgText(v, dl, strip) {
  const o = {};
  if (typeof v === 'string') { if (v.trim()) o[dl] = v; } else if (isObj(v)) {
    // '__proto__' guard: assigning o['__proto__'] would set the prototype instead of copying a key (pollution).
    for (const k of Object.keys(v)) if (typeof v[k] === 'string' && v[k].trim() && k !== '__proto__') o[k] = v[k];
  }
  if (strip) {
    for (const k of Object.keys(o)) {
      const labs = [strip[k], strip[mgPrimary(k)], MG_LABELS.music.en].filter(Boolean);
      for (const lab of labs) {
        // Escape the label: user-visible text may contain regex metacharacters. The class accepts the full-width
        // colon used in CJK text as well as ASCII ':'.
        const re = new RegExp('^\\s*' + lab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:：]\\s*', 'i');
        if (re.test(o[k])) { o[k] = o[k].replace(re, ''); break; }
      }
    }
  }
  return o;
}

const mgEmpty = (o) => !Object.values(o).some((s) => String(s).trim());

/**
 * One `works` block → a `collection` block with the same id and common props. Mapping: title → title, genre →
 * subtitle, music / year / duration → attributes "Music" / "Year" / "Duration" (labels in the document languages; a
 * leading "Music:" in the credit is dropped, the card shows the label), cover → cover, media → files[0], html → html,
 * tags → tags; variant grid / list / feature and columns kept, play 'inline' → media 'inline'; details 'none' and
 * 3 attributes on the cards keep everything on the card as before.
 */
function worksToCollection(b, langs, dl) {
  const ls = Array.isArray(langs) && langs.length ? langs : [dl || 'en'];
  const d = dl || ls[0];
  const music = mgLabel('music', ls);
  const items = (Array.isArray(b.items) ? b.items : []).filter(isObj).map((it) => {
    const attrs = [];
    const add = (key, v, strip) => { const value = mgText(v, d, strip); if (!mgEmpty(value)) attrs.push({ label: mgLabel(key, ls), value }); };
    add('music', it.music, music);
    add('year', typeof it.year === 'number' ? String(it.year) : it.year);
    add('duration', it.duration);
    const out = {
      title: it.title, subtitle: it.genre, cover: it.cover ?? null, html: it.html, tags: it.tags, attrs,
      files: typeof it.media === 'string' && it.media ? [{ att: it.media, label: {}, kind: 'auto' }] : [],
    };
    if (typeof it.id === 'string') out.id = it.id;
    return out;
  });
  const out = { ...b, type: 'collection', items, details: 'none', cardAttrs: 3, ratio: '4/3', media: b.play === 'inline' ? 'inline' : 'reader' };
  delete out.play;
  if (!['grid', 'list', 'feature'].includes(out.variant)) out.variant = 'grid';
  return out;
}

// Block lists of the regions (nested section `blocks` and `cols[].blocks` included), migrated in place.
function migrateBlocks(list, langs, dl, depth = 0) {
  // Depth cap: documents are untrusted input; an absurdly nested structure must not blow the stack.
  if (!Array.isArray(list) || depth > 12) return;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (!isObj(b)) continue;
    if (b.type === 'works') list[i] = worksToCollection(b, langs, dl);
    const x = list[i];
    if (Array.isArray(x.blocks)) migrateBlocks(x.blocks, langs, dl, depth + 1);
    if (Array.isArray(x.cols)) for (const c of x.cols) if (isObj(c)) migrateBlocks(c.blocks, langs, dl, depth + 1);
  }
}

function migrateRegions(regions, langs, dl) {
  if (!isObj(regions)) return;
  for (const k of Object.keys(regions)) migrateBlocks(regions[k], langs, dl);
}

export {
  MG_LABELS,
  migrateBlocks,
  migrateRegions,
  worksToCollection
};
