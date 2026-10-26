// book/css.js - the stylesheet of book content (the classes book/html.js renders) and of the book's own named
// styles. Relative units only and no fonts or colours of its own, so reading systems (and the reader's settings)
// stay in charge of typography. The same rules style EPUB content documents, the HTML export, the reader and the
// editor (scoped there).
//
//   bookCSS({ scope = '' }) -> CSS text (scope: a selector every rule is nested under, e.g. '.bk-text')
//   stylesCSS(styles, { scope = '' }) -> CSS of named styles (.s-<id>), each rule followed by a comment that carries
//     the style definition so readStylesCSS can recover it (EPUB round trips)
//   readStylesCSS(css) -> [style]

import { normStyle } from './model.js';

//
// CONTRACT: these rules style book content inside reading systems, so they must stay overridable.
// Specificity budget: element and single-class selectors (0,0,1 .. 0,1,1), no ids, no !important: a reading system's
// user stylesheet or the reader's font/size settings win with ordinary specificity. Lengths in em only, so the
// reader's font size scales everything consistently.
// Paragraphs: text-indent instead of vertical margins, the typographic convention of fiction; orphans/widows 2 for
// paginated readers. break-after: avoid plus the legacy page-break-after: older EPUB 2 engines (Adobe RMSDK) only
// know page-break-*.
// hyphens: manual on headings: automatic hyphenation inside a centred title looks broken; -webkit- prefix for Safari
// and Apple Books, which still need it.
// .verse: hanging indent (negative text-indent + equal padding) so wrapped verse lines read as continuations.
// hr.scene-break: the rule line is replaced by a "* * *" glyph via ::after; border 0 + background none clear the UA
// rule styling, color: inherit keeps it legible on dark reading themes.
// td, th: border in currentColor, which follows the text colour of any theme instead of a fixed grey.
// a.noteref: line-height 0 keeps the superscript from enlarging the line box (uneven line spacing at every note).
const RULES = [
  ['p', 'margin: 0; text-indent: 1.5em; orphans: 2; widows: 2'],
  ['h1, h2, h3, h4, h5, h6', 'text-align: center; text-indent: 0; hyphens: manual; -webkit-hyphens: manual; break-after: avoid; page-break-after: avoid; line-height: 1.25; margin: 1.6em 0 1em'],
  ['h1', 'font-size: 1.6em'], ['h2', 'font-size: 1.35em'], ['h3', 'font-size: 1.2em'], ['h4, h5, h6', 'font-size: 1.05em'],
  ['.section', 'margin: 0'],
  ['.body-title', 'text-align: center; text-indent: 0; font-size: 1.4em; font-weight: bold; margin: 2em 0 1.5em; line-height: 1.3'],
  ['.subtitle', 'text-align: center; text-indent: 0; font-weight: bold; margin: 1em 0; break-after: avoid; page-break-after: avoid'],
  ['.empty-line', 'text-indent: 0; min-height: 1em'],
  ['hr.scene-break', 'border: 0; height: auto; margin: 1em 0; text-align: center; overflow: visible; color: inherit; background: none'],
  ['hr.scene-break::after', 'content: "* * *"; letter-spacing: .6em; padding-left: .6em'],
  ['blockquote', 'margin: 1em 0 1em 2em'],
  ['.epigraph', 'margin: 1.2em 0 1.4em 30%; font-style: italic'],
  ['.epigraph p, .cite p, .note p', 'text-indent: 0'],
  ['.epigraph .text-author', 'font-style: normal'],
  ['.cite', 'margin: 1em 1.5em'],
  ['.text-author', 'text-align: right; text-indent: 0; font-weight: bold; margin-top: .3em'],
  ['.poem', 'margin: 1em 0 1em 12%; text-align: left'],
  ['.poem-title, .stanza-title', 'text-indent: 0; font-weight: bold; margin: 0 0 .6em'],
  ['.stanza-subtitle', 'text-indent: 0; font-style: italic; margin-bottom: .3em'],
  ['.stanza', 'margin: 0 0 1em; break-inside: avoid; page-break-inside: avoid'],
  ['.verse', 'text-indent: -1.5em; padding-left: 1.5em; text-align: left; hyphens: manual; -webkit-hyphens: manual'],
  ['.poem-date', 'text-indent: 0; font-style: italic; margin-top: .3em'],
  ['figure.image, div.image', 'margin: 1em 0; text-align: center; text-indent: 0; break-inside: avoid; page-break-inside: avoid'],
  ['figure.image img, div.image img', 'max-width: 100%; height: auto'],
  ['figcaption, .caption', 'font-size: .9em; font-style: italic; text-indent: 0; margin-top: .4em'],
  ['img.inline', 'height: 1.2em; width: auto; vertical-align: middle'],
  ['pre.code', 'white-space: pre-wrap; font-family: monospace; font-size: .85em; line-height: 1.4; margin: 1em 0; text-align: left; hyphens: none'],
  ['code', 'font-family: monospace; font-size: .92em'],
  ['a.noteref', 'vertical-align: super; font-size: .7em; line-height: 0; text-decoration: none; padding: 0 .1em'],
  ['table', 'border-collapse: collapse; margin: 1em auto; text-indent: 0'],
  ['td, th', 'border: 1px solid currentColor; padding: .25em .5em; vertical-align: top'],
  ['ul, ol', 'margin: .6em 0; padding-left: 1.8em'],
  ['li p', 'text-indent: 0'],
  ['.note', 'margin: 0 0 1em'],
  ['.note-label', 'font-weight: bold; text-indent: 0'],
];

// Scoping is a descendant prefix per comma-separated selector part; ::after stays attached to its compound selector.
// The scope adds (0,1,0) specificity in the editor/reader, which lets these rules beat the app's own resets.
export function bookCSS({ scope = '' } = {}) {
  const pre = scope ? scope + ' ' : '';
  return RULES.map(([sel, body]) => `${sel.split(',').map((s) => pre + s.trim()).join(', ')} { ${body}; }`).join('\n') + '\n';
}

// Generic-family fallbacks end each stack: the book never ships fonts, so the last resort must always exist.
const FONTS = {
  serif: 'Georgia, "Times New Roman", serif', sans: 'system-ui, "Segoe UI", Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, Consolas, monospace', script: '"Segoe Script", "Brush Script MT", cursive',
};
const SIZES = { xs: '.75em', s: '.875em', m: '1em', l: '1.2em', xl: '1.45em' };

// Values are interpolated unescaped: safe only because model.normStyle whitelists every prop (enum values,
// #rrggbb colour). Do not feed styles that bypassed normStyle.
export function styleRule(st) {
  const p = st.props || {};
  const d = [];
  if (p.font) d.push(`font-family: ${FONTS[p.font]}`);
  if (p.size) d.push(`font-size: ${SIZES[p.size]}`);
  if (p.bold) d.push('font-weight: bold');
  if (p.italic) d.push('font-style: italic');
  if (p.smallCaps) d.push('font-variant: small-caps');
  if (p.underline) d.push('text-decoration: underline');
  if (p.color) d.push(`color: ${p.color}`);
  if (st.kind === 'block') {
    if (p.align) d.push(`text-align: ${p.align}`);
    if (p.indent === 'none') d.push('text-indent: 0');
    else if (p.indent === 'first') d.push('text-indent: 1.5em');
    else if (p.indent === 'hanging') d.push('text-indent: -1.5em; padding-left: 1.5em');
    else if (p.indent === 'block') d.push('text-indent: 0; margin-left: 2em; margin-right: 2em');
    if (p.spaceBefore) d.push(`margin-top: ${p.spaceBefore}em`);
    if (p.spaceAfter) d.push(`margin-bottom: ${p.spaceAfter}em`);
  }
  return d.join('; ');
}

// Each rule carries its own definition as JSON in a trailing comment: EPUB has no place for style metadata, but a
// CSS file survives every reading system and editor untouched, so the named styles round-trip. A star-slash
// sequence inside the JSON is escaped with a backslash so the comment cannot terminate early.
// Block styles target p.s-id and inline styles span.s-id (0,1,1): a block class cannot leak onto inline spans.
export function stylesCSS(styles, { scope = '' } = {}) {
  const pre = scope ? scope + ' ' : '';
  return (styles || []).map((st) => {
    const sel = st.kind === 'block' ? `${pre}p.s-${st.id}` : `${pre}span.s-${st.id}`;
    const def = JSON.stringify({ id: st.id, name: st.name, kind: st.kind, props: st.props }).replace(/\*\//g, '*\\/');
    return `${sel} { ${styleRule(st)}; } /* book-style ${def} */`;
  }).join('\n') + (styles && styles.length ? '\n' : '');
}

// A lazy brace match up to the first closing brace followed by the comment end recovers each JSON; anything that
// does not parse or normalise is skipped, since a foreign stylesheet may contain look-alike comments.
export function readStylesCSS(css) {
  const out = [];
  const re = /\/\* book-style (\{[\s\S]*?\}) \*\//g;
  let m;
  while ((m = re.exec(String(css || '')))) {
    try { const st = normStyle(JSON.parse(m[1].replace(/\*\\\//g, '*/'))); if (st && !out.some((x) => x.id === st.id)) out.push(st); } catch { /* not ours */ }
  }
  return out;
}
