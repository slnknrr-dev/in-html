// portal/models.js - the data models of the portal blocks, written once in a neutral schema that each application
// converts to its own block registry (landing-studio: doc/ schema + itemSchema; knowledge-processor: blocks.js
// fields), so both editors, normalizers and admin forms come from the same definition.
//
//   PT_TYPES                                   block types: act, terms, directory, board, hub, checklist, finder
//   PT_BLOCKS[type] = { icon, fields: [Field], item: { label, fields: [Field] } | null }
//   Field = { key, t, o?: [values], d?: default, min?, max?, step?, rows?, label?: editor label name (default: key) }
//     t: 'text'   one line, translatable           (landing i18n; knowledge inline markup line)
//        'long'   several lines, translatable      (landing multi-line i18n; knowledge markup text)
//        'code'   one line, not translated (numbers, keys, phone numbers, language codes)
//        'link'   URL or in-site link             'day' YYYY-MM-DD        'num' number (null = empty)
//        'bool'   switch                           'select' one of `o` (first is the default)
//        'image'  picture (attachment / media)    'file' any file (PDF of an act …)
//   Editor labels: 'b.<type>', 'bd.<type>' (palette), 'pt.f.<key>' (fields), 'pt.fh.<key>' (hints, when present),
//   'pt.o.<key>.<value>' (options) — PT_EDITOR in strings.js, all 7 languages.
//   defaults(type) / itemDefaults(type) -> plain values (strings '' for text kinds; hosts wrap translatable ones)
// Compact field constructor: the schema stays readable as a table, and every field has the same shape.
const F = (key, t, o = {}) => ({ key, t, ...o });

export const PT_TYPES = ['act', 'terms', 'directory', 'board', 'hub', 'checklist', 'finder'];

// Neutral schema: each host converts it to its own editor / normalizer format, so the field list of a block exists
// exactly once. 'select' fields list the default first; renderers still re-check values they receive.
export const PT_BLOCKS = {
  act: {
    icon: 'scale',
    fields: [
      F('title', 'text'), F('actType', 'text'), F('number', 'code'), F('issuer', 'text'),
      F('adopted', 'day'), F('effective', 'day'), F('revised', 'day'),
      F('status', 'select', { o: ['force', 'amended', 'pending', 'repealed', 'draft'] }),
      F('key', 'code'), F('aliases', 'text'), F('topics', 'text'),
      F('source', 'link'), F('successor', 'link'), F('file', 'file'),
      F('summary', 'long', { rows: 4 }), F('changes', 'long', { rows: 3 }),
      F('toc', 'select', { o: ['side', 'top', 'none'] }),
      F('find', 'bool', { d: true }), F('xrefs', 'bool', { d: true }), F('autolink', 'bool', { d: true }),
    ],
    item: {
      label: 'title',
      fields: [
        F('kind', 'select', { o: ['article', 'chapter', 'section', 'part', 'text'] }), F('num', 'code'), F('title', 'text'),
        F('body', 'long', { rows: 8 }), F('status', 'select', { o: ['valid', 'amended', 'new', 'repealed'] }), F('note', 'text'), F('tags', 'text'),
      ],
    },
  },
  terms: {
    icon: 'book',
    fields: [
      F('title', 'text'), F('layout', 'select', { o: ['cards', 'list', 'columns'] }),
      F('alpha', 'bool', { d: true }), F('caps', 'bool'), F('find', 'bool', { d: true }),
      F('autolink', 'select', { o: ['site', 'page', 'off'] }),
    ],
    item: {
      label: 'term',
      fields: [F('term', 'text'), F('alt', 'text'), F('def', 'long', { rows: 5 }), F('source', 'text', { label: 'sourceText' }), F('href', 'link'), F('related', 'text'), F('tags', 'text')],
    },
  },
  directory: {
    icon: 'users',
    fields: [
      F('title', 'text'), F('variant', 'select', { o: ['cards', 'list', 'compact'] }), F('columns', 'num', { d: 3, min: 1, max: 4, step: 1 }),
      F('find', 'bool', { d: true }), F('tabs', 'bool', { d: true }), F('facetArea', 'bool', { d: true }), F('facetCity', 'bool', { d: true }),
      F('facetLang', 'bool'), F('sort', 'bool', { d: true }), F('alpha', 'bool'), F('more', 'num', { d: 12, min: 0, max: 200, step: 1 }),
      F('currency', 'code', { d: 'GEL' }), F('contacts', 'select', { o: ['masked', 'shown', 'none'] }), F('cta', 'text'),
    ],
    item: {
      label: 'name',
      fields: [
        F('kind', 'select', { o: ['person', 'firm', 'org'] }), F('name', 'text'), F('photo', 'image'), F('role', 'text'),
        F('areas', 'text'), F('langs', 'text'), F('city', 'text'),
        F('years', 'num', { min: 0, max: 80, step: 1 }), F('rating', 'num', { min: 0, max: 5, step: 0.1 }), F('reviews', 'num', { min: 0, max: 1000000, step: 1 }),
        F('price', 'num', { min: 0, max: 1e9 }), F('priceKind', 'select', { o: ['from', 'fixed', 'hour', 'free', 'ask'] }),
        F('verified', 'bool'), F('isNew', 'bool'), F('tier', 'text'), F('badges', 'text'), F('bio', 'long', { rows: 4 }),
        F('phone', 'code'), F('email', 'code'), F('site', 'link'), F('href', 'link', { label: 'profile' }),
        F('status', 'select', { o: ['available', 'busy', 'away'] }),
      ],
    },
  },
  board: {
    icon: 'clipboard',
    fields: [
      F('title', 'text'), F('variant', 'select', { o: ['cards', 'list'] }),
      F('find', 'bool', { d: true }), F('facetCategory', 'bool', { d: true }), F('facetCity', 'bool', { d: true }), F('facetStatus', 'bool', { d: true }),
      F('sort', 'bool', { d: true }), F('more', 'num', { d: 10, min: 0, max: 200, step: 1 }), F('currency', 'code', { d: 'GEL' }),
      F('match', 'num', { d: 3, min: 0, max: 8, step: 1 }), F('cap', 'num', { d: 5, min: 0, max: 99, step: 1 }),
      F('cta', 'text'), F('ctaHref', 'link'),
    ],
    item: {
      label: 'title',
      fields: [
        F('title', 'text'), F('body', 'long', { rows: 4 }), F('category', 'text'),
        F('budgetKind', 'select', { o: ['fixed', 'range', 'hour', 'unsure'] }), F('budget', 'num', { min: 0, max: 1e9 }), F('budgetMax', 'num', { min: 0, max: 1e9 }),
        F('city', 'text'), F('remote', 'bool'), F('langs', 'text'), F('posted', 'day'), F('closes', 'day'),
        F('status', 'select', { o: ['open', 'progress', 'closed'] }), F('responses', 'num', { min: 0, max: 999, step: 1 }), F('author', 'text'), F('href', 'link'),
      ],
    },
  },
  hub: {
    icon: 'compass',
    fields: [
      F('title', 'text'), F('topic', 'text'), F('lead', 'long', { rows: 3 }), F('stats', 'bool', { d: true }),
      F('limit', 'num', { d: 6, min: 1, max: 50, step: 1 }),
    ],
    item: {
      label: 'title',
      fields: [F('title', 'text'), F('topic', 'text'), F('text', 'long', { rows: 2 }), F('href', 'link')],
    },
  },
  checklist: {
    icon: 'check',
    fields: [F('title', 'text'), F('lead', 'long', { rows: 3 }), F('persist', 'bool', { d: true }), F('progress', 'bool', { d: true })],
    item: {
      label: 'label',
      fields: [F('label', 'text'), F('body', 'long', { rows: 3 }), F('due', 'text'), F('ref', 'text'), F('group', 'bool'), F('tags', 'text')],
    },
  },
  finder: {
    icon: 'search',
    fields: [F('title', 'text'), F('placeholder', 'text'), F('suggest', 'text'), F('tabs', 'bool', { d: true }), F('limit', 'num', { d: 20, min: 5, max: 200, step: 1 })],
    item: null,
  },
};

const TEXT_KINDS = new Set(['text', 'long']);
export const isText = (f) => TEXT_KINDS.has(f.t);

// Default per kind: null for numbers / files (distinguishes "empty" from 0), first option for selects.
function valueOf(f) {
  if (f.d !== undefined) return f.d;
  switch (f.t) {
    case 'num': return null;
    case 'bool': return false;
    case 'select': return f.o[0];
    case 'image': case 'file': return null;
    default: return '';
  }
}

export function defaults(type) {
  const spec = PT_BLOCKS[type];
  const out = {};
  for (const f of spec ? spec.fields : []) out[f.key] = valueOf(f);
  return out;
}

export function itemDefaults(type) {
  const spec = PT_BLOCKS[type];
  const out = {};
  for (const f of spec && spec.item ? spec.item.fields : []) out[f.key] = valueOf(f);
  return out;
}
