// portal/catalog.js - everything the portal blocks of a site hold, gathered once per render (pure): the acts with their
// articles and paragraphs (cross-references resolve against them), the defined terms (glossary linking and tooltips),
// the directory (request matching), requests, checklist items and the topics that tie them together (topic hubs), plus
// the entries of the unified search. Anchors of articles, terms and entries are assigned here, so every block and every
// page links to the same ids.
//
//   buildCatalog(sources, host) -> cat
//     sources: [{ block, page (page id), href(anchor) -> URL of that anchor from the page being rendered }]
//     host:    { langs, lang, plain(value, lang) -> text, raw(value, lang) -> source text }
//   cat.anchor(blockId, index) -> 'tax-a12' | 't-vat' | …       cat.actBase(blockId) -> 'tax'
//   cat.resolveRef({ act, art, para, sub }) -> href | null       cat.aliases: [{ key, words }]
//   cat.termMatcher(lang, page) -> matcher (glossary.js)         cat.term(id) -> { id, href, names(l), def(l), source(l) }
//   cat.people / cat.requests / cat.checks / cat.acts            cat.match(request, limit) -> [{ entry, why }]
//   cat.topics(lang) -> [{ key, label, n, counts }]              cat.topic(name, lang) -> { key, label, groups: { type: [hit] } }
//   cat.entries(lang) -> unified search entries (search.js)
import { slugId, splitList, excerpt, fold } from './text.js';
import { aliasWords, numKey, numText, parseBody, unitAnchor } from './legal.js';
import { termKey, termMatcher } from './glossary.js';
import { matchEntries } from './records.js';

// Single pass over all portal blocks of a site: assigns every anchor once, so every renderer and every page links to
// the same ids. Host functions (plain / raw) abstract how each application stores translated values.
// NOTE: act anchors are reserved with used.add() as acts are met, while terms / entries go through uniq(); a term
// block processed BEFORE an act block whose key is 't' could take an id like 't-a12' that the act later reuses.
// Real act keys make this practically impossible, but the order dependence is real.
export function buildCatalog(sources, host) {
  const langs = host.langs && host.langs.length ? host.langs : [host.lang || 'en'];
  const L0 = host.lang || langs[0];
  const plain = (v, l = L0) => String(host.plain(v, l) || '').trim();
  const raw = (v, l = L0) => String((host.raw || host.plain)(v, l) || '');
  const used = new Set();
  const uniq = (base) => {
    let id = base;
    let n = 2;
    while (used.has(id)) id = base + '-' + n++;
    used.add(id);
    return id;
  };
  const anchors = new Map();
  const bases = new Map();
  const acts = new Map();
  const terms = [];
  const people = [];
  const requests = [];
  const checks = [];

  for (const src of sources || []) {
    const b = src.block;
    if (!b || !Array.isArray(b.items)) continue;
    const href = typeof src.href === 'function' ? src.href : (a) => '#' + a;
    // Act base keys are unique per site (tax, tax2, ...); articles get anchors only when numbered and not duplicated within the act.
    if (b.type === 'act') {
      const want = slugId(plain(b.key) || '', '') || 'act' + (acts.size + 1);
      let base = want;
      let n = 2;
      while ([...bases.values()].includes(base)) base = want + n++;
      bases.set(b.id, base);
      const key = base;
      const units = new Map();
      b.items.forEach((u, i) => {
        if (u.kind !== 'article' || !u.num) return;
        const k = numKey(u.num);
        if (!k || units.has(k)) return;
        const a = unitAnchor(base, k);
        used.add(a);
        anchors.set(b.id + ':' + i, a);
        const paras = new Map();
        for (const p of parseBody(raw(u.body))) if (p.kind === 'p' && p.key) paras.set(p.key, new Set(p.subs.map((s) => s.key)));
        units.set(k, { anchor: a, paras, i, unit: u });
      });
      const names = [];
      for (const l of langs) names.push(plain(b.title, l), plain(b.aliases, l));
      acts.set(key, { key, block: b, page: src.page, href, units, aliases: aliasWords(...names), title: (l) => plain(b.title, l) });
    // Several items with the same term in one block share one anchor and one entry (multiple definitions).
    } else if (b.type === 'terms') {
      const local = new Map();
      b.items.forEach((it, i) => {
        const name = plain(it.term);
        if (!name) return;
        const tk = termKey(name);
        if (local.has(tk)) { anchors.set(b.id + ':' + i, local.get(tk).anchor); local.get(tk).items.push(it); return; }
        const a = uniq('t-' + slugId(name, 'term'));
        anchors.set(b.id + ':' + i, a);
        const e = {
          id: a, anchor: a, href: href(a), block: b, page: src.page, items: [it], scope: b.autolink || 'site',
          names: (l) => [plain(it.term, l) || name, ...splitList(plain(it.alt, l))].filter(Boolean),
          def: (l) => excerpt(plain(it.def, l), 240), source: (l) => plain(it.source, l), tags: (l) => splitList(plain(it.tags, l)),
          title: (l) => plain(it.term, l) || name,
        };
        local.set(tk, e);
        terms.push(e);
      });
    } else if (b.type === 'directory' || b.type === 'board' || b.type === 'checklist') {
      const pre = b.type === 'directory' ? 'pr-' : b.type === 'board' ? 'rq-' : 'ck-';
      b.items.forEach((it, i) => {
        const name = plain(b.type === 'directory' ? it.name : b.type === 'board' ? it.title : it.label);
        if (!name || (b.type === 'checklist' && it.group)) return;
        const a = uniq(pre + slugId(name, 'x'));
        anchors.set(b.id + ':' + i, a);
        const e = { anchor: a, href: href(a), block: b, page: src.page, item: it, title: (l) => plain(b.type === 'directory' ? it.name : b.type === 'board' ? it.title : it.label, l) || name };
        if (b.type === 'directory') {
          Object.assign(e, {
            kind: it.kind || 'person', areas: (l) => splitList(plain(it.areas, l)), city: (l) => plain(it.city, l), langs: splitList(plain(it.langs)),
            verified: !!it.verified, rating: Number(it.rating) || 0, reviews: Number(it.reviews) || 0, years: Number(it.years) || 0, status: it.status || 'available',
            sub: (l) => plain(it.role, l),
          });
          people.push(e);
        } else if (b.type === 'board') {
          Object.assign(e, { areas: (l) => splitList(plain(it.category, l)), city: (l) => plain(it.city, l), langs: splitList(plain(it.langs)), remote: !!it.remote, status: it.status || 'open', sub: (l) => plain(it.category, l) });
          requests.push(e);
        } else {
          Object.assign(e, { sub: (l) => plain(it.due, l), tags: (l) => splitList(plain(it.tags, l)) });
          checks.push(e);
        }
      });
    }
  }

  const aliases = [...acts.values()].map((a) => ({ key: a.key, words: a.aliases }));

  // A reference resolves only to targets that exist (paragraph / subparagraph ids are derived from the parsed body), so no dead links are emitted.
  function resolveRef({ act, art, para, sub }) {
    const a = acts.get(act);
    if (!a || !art) return null;
    const u = a.units.get(art);
    if (!u) return null;
    let anchor = u.anchor;
    if (para && u.paras.has(para)) {
      anchor += '-p' + para;
      if (sub && u.paras.get(para).has(sub)) anchor += '-' + sub;
    }
    return a.href(anchor);
  }

  const matchers = new Map();
  function termsFor(page) {
    return terms.filter((e) => e.scope !== 'off' && (e.scope === 'site' || e.page === page));
  }
  // Matchers are cached per language and page scope: building one indexes every term name.
  function termMatcherFor(lang, page) {
    const k = lang + '\u0000' + (page || '');
    if (!matchers.has(k)) matchers.set(k, termMatcher(termsFor(page).map((e) => ({ id: e.id, names: e.names(lang) }))));
    return matchers.get(k);
  }
  const termById = new Map(terms.map((e) => [e.id, e]));

  function match(req, limit = 3, lang = L0) {
    const r = { areas: req.areas(lang), city: req.city(lang), langs: req.langs, remote: req.remote };
    const list = people.map((p) => ({ areas: p.areas(lang), city: p.city(lang), langs: p.langs, verified: p.verified, rating: p.rating, reviews: p.reviews, years: p.years, status: p.status, p }));
    return matchEntries(r, list, { limit }).map((m) => ({ entry: m.entry.p, why: m.why, score: m.score }));
  }

  // Topics: act topics and article tags, term tags, directory areas, request categories, checklist tags.
  // Topics are normalized by termKey so "Tax" and "taxes" gather in one hub.
  function topicHits(lang) {
    const out = [];
    const add = (name, type, hit) => { const k = termKey(name); if (k) out.push({ k, name, type, hit }); };
    for (const a of acts.values()) {
      const at = { title: a.title(lang), href: a.href(a.key), sub: plain(a.block.actType, lang) };
      for (const t of splitList(plain(a.block.topics, lang))) add(t, 'act', at);
      for (const u of a.units.values()) {
        for (const t of splitList(plain(u.unit.tags, lang))) add(t, 'article', { title: articleTitle(u.unit, lang), href: a.href(u.anchor), sub: a.title(lang) });
      }
    }
    for (const e of terms) for (const t of e.tags(lang)) add(t, 'term', { title: e.title(lang), href: e.href, sub: e.def(lang) });
    for (const e of people) for (const t of e.areas(lang)) add(t, e.kind, { title: e.title(lang), href: e.href, sub: e.sub(lang) });
    for (const e of requests) for (const t of e.areas(lang)) add(t, 'request', { title: e.title(lang), href: e.href, sub: e.city(lang) });
    for (const e of checks) for (const t of e.tags(lang)) add(t, 'check', { title: e.title(lang), href: e.href, sub: e.sub(lang) });
    return out;
  }
  function articleTitle(u, lang) {
    return (host.unitLabel ? host.unitLabel('article', numText(u.num), lang) : numText(u.num)) + (plain(u.title, lang) ? '. ' + plain(u.title, lang) : '');
  }
  function topics(lang = L0) {
    const map = new Map();
    for (const h of topicHits(lang)) {
      const t = map.get(h.k) || { key: h.k, label: h.name, n: 0, counts: {} };
      t.n++;
      t.counts[h.type] = (t.counts[h.type] || 0) + 1;
      map.set(h.k, t);
    }
    return [...map.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  }
  function topic(name, lang = L0) {
    const k = termKey(name);
    const groups = {};
    let label = name;
    for (const h of topicHits(lang)) {
      if (h.k !== k && !(k && h.k.startsWith(k + ' '))) continue;
      label = h.k === k ? h.name : label;
      (groups[h.type] = groups[h.type] || []).push(h.hit);
    }
    return { key: k, label, groups };
  }

  function entries(lang = L0) {
    const out = [];
    for (const a of acts.values()) {
      const t = a.title(lang);
      const base = a.href(a.key);
      out.push({ id: 'act:' + a.key, type: 'act', title: t, text: plain(a.block.summary, lang), href: base, sub: plain(a.block.actType, lang) });
      for (const u of a.units.values()) {
        out.push({ id: u.anchor, type: 'article', title: articleTitle(u.unit, lang), text: plain(u.unit.body, lang), href: a.href(u.anchor), sub: t, group: { key: a.key, label: t, href: base } });
      }
    }
    for (const e of terms) out.push({ id: e.id, type: 'term', title: e.title(lang), text: e.items.map((it) => plain(it.def, lang)).join(' '), href: e.href, sub: e.source(lang) });
    for (const e of people) out.push({ id: e.anchor, type: e.kind, title: e.title(lang), text: [e.sub(lang), e.areas(lang).join(', '), e.city(lang), plain(e.item.bio, lang)].filter(Boolean).join(' · '), href: e.href, sub: e.sub(lang) });
    for (const e of requests) out.push({ id: e.anchor, type: 'request', title: e.title(lang), text: [plain(e.item.body, lang), e.areas(lang).join(', '), e.city(lang)].filter(Boolean).join(' · '), href: e.href, sub: e.sub(lang) });
    for (const e of checks) out.push({ id: e.anchor, type: 'check', title: e.title(lang), text: plain(e.item.body, lang), href: e.href, sub: e.sub(lang) });
    return out;
  }

  return {
    langs, lang: L0, acts, terms, people, requests, checks, aliases,
    anchor: (blockId, i) => anchors.get(blockId + ':' + i) || '',
    actBase: (blockId) => bases.get(blockId) || '',
    resolveRef, termMatcher: termMatcherFor, term: (id) => termById.get(id) || null, match, topics, topic, entries,
    hasTerms: (page) => termsFor(page).length > 0,
    fold,
  };
}
