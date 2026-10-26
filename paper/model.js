// paper/model.js - shape of paper documents: defaults, common block props (print flags, block style in mm) and
// top-level normalization (the engine in doc/model.js normalizes blocks, items, lists and attachments). The product
// supplies its format and name (P.format, P.name), defaults (P.paperDefaults: { layout, theme }) and the blocks of a
// new document (P.paperRegions()).
//
// Design rules:
// - Normalization is a total function: any JSON (imported file, old version, hand-edited, hostile) maps to a valid
//   document. Every field is rebuilt from scratch with a typed coercer (bool / num(v, def, min, max) / oneOf / str /
//   safeColor); unknown keys are dropped. Renderers can then trust the shape (isNormalized) without defensive checks.
// - Defaults are factories (() => ({...})), never shared objects: a shared default mutated by the editor would leak into
//   every later new document.
// - Numeric ranges here are the hard limits; editor field ranges (paper/editor.js) may be narrower, never wider.
// - Ids are validated against /^[a-z0-9]{3,32}$/i because they are interpolated into element ids and selectors.
import { safeColor } from '../color/color.js';
import { canonLang } from '../i18n/lang.js';
import { normI18n } from '../i18n/text.js';
import { docLangs, normAttachments, normContext, normList } from '../doc/model.js';
import { P, THEMES } from '../doc/product.js';
import { PAGE_SIZES } from './base.js';
import { DENSITY, FONT_STACKS, HEADING_STYLES, LAYOUTS } from './themes.js';
import { uid } from '../util/id.js';
import { bool, clone, isObj, num, oneOf, own, str } from '../util/value.js';

export const COMMON_DEFAULTS = () => ({
  hidden: false, langs: null, keep: false, breakBefore: false, print: 'both',
  style: { mt: null, mb: null, bg: '', color: '', align: '', pad: null },
});

const DEFAULT_OUTPUT = () => ({
  autodetect: true, switcher: 'buttons', langLabels: 'native', printButton: true, themeToggle: false,
  toolbarPos: 'top-right', uiFallback: 'en',
  appendix: { enabled: true, title: {}, embed: false, print: true },
  printAttachments: 'card', paper: true,
});
const DEFAULT_PAGE = () => ({
  size: 'A4', margin: { top: 14, right: 14, bottom: 14, left: 14 }, pageNumbers: false, numberFormat: 'n/N',
  header: {}, footer: {},
});
const defLayout = () => (P.paperDefaults && P.paperDefaults.layout) || 'sidebar-left';
const defTheme = () => (P.paperDefaults && own(THEMES, P.paperDefaults.theme) ? P.paperDefaults.theme : 'modern');
const DEFAULT_LAYOUT = () => ({ type: defLayout(), sideWidth: 32, gap: 8, headerFull: true, sideInSingle: 'after' });
const themeDefaults = (preset) => ({
  preset, ...clone(THEMES[preset].vars), baseSize: 10.5, lineHeight: 1.45, density: 'normal', scheme: 'light',
});

// Common block props: print flags, and the block style (mm) unless the type uses `style` as its variant name
// (timeline, skills, languages, keyvalue, table).
// `def.style` doubles as a variant enum on some types; checking its default's type avoids a per-type exclusion list
// that would rot as products add blocks. Margins allow negatives (-50) so a user can pull a block up; padding not.
export function normCommon(out, b, ctx, def) {
  out.keep = bool(b.keep, false);
  out.breakBefore = bool(b.breakBefore, false);
  out.print = oneOf(b.print, ['both', 'screen', 'print'], 'both');
  if (typeof def.style !== 'string') {
    const s = isObj(b.style) ? b.style : {};
    out.style = {
      mt: s.mt == null || s.mt === '' ? null : num(s.mt, null, -50, 100),
      mb: s.mb == null || s.mb === '' ? null : num(s.mb, null, -50, 100),
      bg: safeColor(s.bg), color: safeColor(s.color),
      align: oneOf(s.align, ['', 'left', 'center', 'right', 'justify'], ''),
      pad: s.pad == null || s.pad === '' ? null : num(s.pad, null, 0, 50),
    };
  }
}

export function attachmentExtra(out, src) {
  out.appendix = bool(src.appendix, true);
}

// Languages are canonicalized and de-duplicated; the default language must be one of them, else the first wins
// (a document whose default language has no content would render empty).
export function newDoc(opts = {}) {
  let langs = Array.isArray(opts.langs) ? [...new Set(opts.langs.map(canonLang).filter(Boolean))] : [];
  if (!langs.length) langs = ['en'];
  const dl0 = canonLang(opts.defaultLang);
  const defaultLang = langs.includes(dl0) ? dl0 : langs[0];
  const preset = own(THEMES, opts.theme) ? opts.theme : defTheme();
  const now = new Date().toISOString();
  const regions = { header: [], main: [], side: [], ...(P.paperRegions ? P.paperRegions() : {}) };
  return {
    format: P.format, version: 1, id: uid(),
    name: str(opts.name, P.name) || P.name,
    meta: { title: {}, description: {}, author: '', keywords: '', created: now, modified: now },
    langs, defaultLang,
    output: DEFAULT_OUTPUT(),
    page: DEFAULT_PAGE(),
    theme: themeDefaults(preset),
    layout: { ...DEFAULT_LAYOUT(), type: LAYOUTS.includes(opts.layout) ? opts.layout : defLayout() },
    regions,
    attachments: {},
  };
}

export function normalizeTop(src) {
  const base = newDoc();
  const [langs, defaultLang] = docLangs(src.langs, src.defaultLang);
  const dl = defaultLang;
  const m = isObj(src.meta) ? src.meta : {};
  const o = isObj(src.output) ? src.output : {};
  const od = DEFAULT_OUTPUT();
  const ap = isObj(o.appendix) ? o.appendix : {};
  const p = isObj(src.page) ? src.page : {};
  const pm = isObj(p.margin) ? p.margin : {};
  const th = isObj(src.theme) ? src.theme : {};
  const preset = own(THEMES, th.preset) ? th.preset : defTheme();
  const td = themeDefaults(preset);
  // A font is either a known stack key or an uploaded asset reference; anything else (a raw CSS font list) would be injected into the stylesheet.
  const fontOK = (f, d) => (typeof f === 'string' && (own(FONT_STACKS, f) || /^asset:[a-z0-9]{3,32}$/i.test(f)) ? f : d);
  const ly = isObj(src.layout) ? src.layout : {};
  const attachments = normAttachments(src.attachments, dl);
  const ctx = normContext(dl, attachments);
  const regions = isObj(src.regions) ? src.regions : {};
  return {
    format: P.format,
    version: 1,
    id: typeof src.id === 'string' && /^[a-z0-9]{3,32}$/i.test(src.id) ? src.id : base.id,
    name: str(src.name, base.name) || base.name,
    meta: {
      title: normI18n(m.title, dl), description: normI18n(m.description, dl),
      author: str(m.author), keywords: str(m.keywords),
      created: str(m.created, base.meta.created) || base.meta.created,
      modified: str(m.modified, base.meta.modified) || base.meta.modified,
    },
    langs, defaultLang,
    output: {
      autodetect: bool(o.autodetect, od.autodetect),
      switcher: oneOf(o.switcher, ['buttons', 'select', 'none'], od.switcher),
      langLabels: oneOf(o.langLabels, ['native', 'code'], od.langLabels),
      printButton: bool(o.printButton, od.printButton),
      themeToggle: bool(o.themeToggle, od.themeToggle),
      toolbarPos: oneOf(o.toolbarPos, ['top-right', 'top-left', 'bottom-right', 'bottom-left'], od.toolbarPos),
      uiFallback: canonLang(o.uiFallback) || 'en',
      appendix: {
        enabled: bool(ap.enabled, true), title: normI18n(ap.title, dl),
        embed: bool(ap.embed, false), print: bool(ap.print, true),
      },
      printAttachments: oneOf(o.printAttachments, ['card', 'hide', 'images'], od.printAttachments),
      paper: bool(o.paper, od.paper),
    },
    page: {
      size: oneOf(p.size, Object.keys(PAGE_SIZES), 'A4'),
      margin: {
        top: num(pm.top, 14, 0, 60), right: num(pm.right, 14, 0, 60),
        bottom: num(pm.bottom, 14, 0, 60), left: num(pm.left, 14, 0, 60),
      },
      pageNumbers: bool(p.pageNumbers, false),
      numberFormat: oneOf(p.numberFormat, ['n', 'n/N', 'page'], 'n/N'),
      header: normI18n(p.header, dl), footer: normI18n(p.footer, dl),
    },
    theme: {
      preset,
      accent: safeColor(th.accent) || td.accent,
      text: safeColor(th.text) || td.text,
      muted: safeColor(th.muted) || td.muted,
      bg: safeColor(th.bg) || td.bg,
      sideBg: safeColor(th.sideBg) || td.sideBg,
      // sideText '' is meaningful (inherit page text colour), so it is kept instead of being replaced by the default.
      sideText: th.sideText === '' ? '' : safeColor(th.sideText) || td.sideText,
      fontBody: fontOK(th.fontBody, td.fontBody),
      fontHead: fontOK(th.fontHead, td.fontHead),
      baseSize: num(th.baseSize, 10.5, 7, 16),
      lineHeight: num(th.lineHeight, 1.45, 1, 2.2),
      density: oneOf(th.density, Object.keys(DENSITY), 'normal'),
      headingStyle: oneOf(th.headingStyle, HEADING_STYLES, td.headingStyle),
      radius: num(th.radius, td.radius, 0, 24),
      scheme: oneOf(th.scheme, ['light', 'auto', 'dark'], 'light'),
    },
    layout: {
      type: oneOf(ly.type, LAYOUTS, defLayout()),
      sideWidth: num(ly.sideWidth, 32, 15, 50),
      gap: num(ly.gap, 8, 0, 30),
      headerFull: bool(ly.headerFull, true),
      sideInSingle: oneOf(ly.sideInSingle, ['before', 'after'], 'after'),
    },
    regions: {
      header: normList(regions.header, ctx),
      main: normList(regions.main, ctx),
      side: normList(regions.side, ctx),
    },
    attachments,
  };
}

// Structural guard of renderers: the normalized shape (else the engine normalizes first).
// Cheap structural check, not a full validation: enough to skip renormalizing an editor document on every keystroke
// render, while an imported / foreign object still goes through normalizeTop.
export function isNormalized(doc) {
  return isObj(doc) && isObj(doc.output) && isObj(doc.output.appendix) && isObj(doc.theme)
    && !!own(THEMES, doc.theme.preset) && isObj(doc.layout) && isObj(doc.page) && isObj(doc.page.margin)
    && isObj(doc.regions) && Array.isArray(doc.regions.header) && Array.isArray(doc.regions.main)
    && Array.isArray(doc.regions.side) && isObj(doc.attachments) && Array.isArray(doc.langs) && doc.langs.length > 0;
}
