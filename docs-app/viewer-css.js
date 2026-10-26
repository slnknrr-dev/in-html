// docs-app/viewer-css.js - CSS of the docs blocks for the paper CSS library (paper/css.js reads it as P.paperCSS): code with
// syntax colours derived from the theme text colour (readable in light and dark schemes), table of contents and
// checklist. Class prefixes are written as __P__.
//
// The CSS is written with a __P__ placeholder instead of the dc- prefix: paper/css.js substitutes the product prefix,
// so the same block CSS could serve another product. Colours are derived from the theme's text colour with
// color-mix(), never fixed, so code, TOC and checklist follow every theme and the dark scheme automatically.

// Token hue mixed into the text colour: dark text darkens the hue, light (dark scheme) text lightens it.
const hue = (kind, color, extra = '') => `.__P__-pre .hl-${kind}{color:color-mix(in oklab,${color} 72%,var(--__P__-text))${extra}}`;

// printKeep: selectors that must not break across pages; classOwner: which block owns a selector (used to ship only
// the CSS of block types a document actually uses).
const DOCS_CSS = {
  blocks: {
    code: `
.__P__-code{position:relative;margin:0}
.__P__-pre{margin:0;padding:.8em 1em;background:color-mix(in srgb,var(--__P__-text) 4.5%,var(--__P__-bg));border:1px solid var(--__P__-line);border-radius:var(--__P__-radius);overflow:auto;font:.85em/1.55 ui-monospace,"Cascadia Code","SF Mono",Menlo,Consolas,"DejaVu Sans Mono",monospace;tab-size:2;white-space:pre;-webkit-hyphens:none;hyphens:none}
.__P__-root .__P__-pre code{display:block;background:none;padding:0;border-radius:0;font:inherit}
.__P__-pre.__P__-wrap{white-space:pre-wrap;overflow-wrap:anywhere}
.__P__-code-tag .__P__-pre{padding-top:1.75em}
.__P__-code-lang{position:absolute;top:.6em;inset-inline-end:.75em;font:600 .62em/1 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.07em;text-transform:uppercase;color:var(--__P__-muted);opacity:.8;pointer-events:none}
.__P__-code-ln .__P__-pre{counter-reset:ln;padding-inline-start:.4em}
.__P__-line{counter-increment:ln}
.__P__-line::before{content:counter(ln);display:inline-block;width:2.2em;margin-inline-end:.9em;text-align:end;color:var(--__P__-muted);opacity:.55;-webkit-user-select:none;user-select:none}
.__P__-code-cap{font-size:.84em;color:var(--__P__-muted);margin-top:.45em}
${hue('k', '#7c3aed')}${hue('s', '#0f766e')}${hue('c', 'var(--__P__-muted)', ';font-style:italic')}${hue('n', '#c2410c')}${hue('f', '#2563eb')}
${hue('t', '#be123c')}${hue('a', '#b45309')}${hue('p', '#1d4ed8')}${hue('o', 'var(--__P__-muted)')}${hue('b', '#0e7490')}${hue('v', '#9333ea')}
${hue('r', '#c2410c')}${hue('h', '#1d4ed8', ';font-weight:700')}${hue('m', 'var(--__P__-muted)')}
@media print{.__P__-pre{white-space:pre-wrap;overflow:visible;overflow-wrap:anywhere}}
`,
    toc: `
.__P__-toc-list{list-style:none;margin:0;padding:0}
.__P__-toc-list li{display:flex;align-items:baseline;gap:.65em;padding:.16em 0;break-inside:avoid}
.__P__-toc-l1{font-weight:600}
.__P__-toc-l1:not(:first-child){margin-top:.25em}
.__P__-toc-l2{padding-inline-start:1.5em!important}
.__P__-toc-l3{padding-inline-start:3em!important;font-size:.95em}
.__P__-toc-l4{padding-inline-start:4.5em!important;font-size:.92em;color:var(--__P__-muted)}
.__P__-toc-no{flex:none;min-width:1.6em;color:var(--__P__-muted);font-variant-numeric:tabular-nums}
.__P__-root .__P__-toc a{color:inherit;text-decoration:none;flex:1;border-bottom:1px dotted transparent}
.__P__-root .__P__-toc a:hover{color:var(--__P__-accent);border-bottom-color:currentColor}
.__P__-toc-empty{color:var(--__P__-muted);font-style:italic}
`,
    checklist: `
.__P__-ck{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.38em}
.__P__-ck-item{display:flex;align-items:flex-start;gap:.65em}
.__P__-ck-box{flex:none;display:inline-flex;align-items:center;justify-content:center;width:1.05em;height:1.05em;margin-top:.2em;border:1.5px solid color-mix(in srgb,var(--__P__-text) 42%,transparent);border-radius:.24em}
.__P__-ck-box.__P__-on{background:var(--__P__-accent);border-color:var(--__P__-accent);color:var(--__P__-on-accent,#fff)}
.__P__-ck-box .__P__-ic{width:.78em;height:.78em;stroke-width:3.2}
.__P__-ck-t{flex:1;min-width:0}
.__P__-ck-strike .__P__-ck-done .__P__-ck-t{text-decoration:line-through;text-decoration-thickness:.06em;color:var(--__P__-muted)}
`,
  },
  printKeep: { checklist: '.__P__-ck-item', toc: '.__P__-toc-list li' },
  classOwner: [[/\.__P__-(code|pre|line)\b|\.__P__-code-/, 'code'], [/\.__P__-toc/, 'toc'], [/\.__P__-ck/, 'checklist']],
  edit: `.__P__-root[data-mode=edit] .__P__-code-ph{display:flex;align-items:center;justify-content:center;gap:8px;min-height:64px;padding:12px;border:1.5px dashed color-mix(in srgb,var(--__P__-text) 24%,transparent);border-radius:6px;color:var(--__P__-muted);font:12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif}
.__P__-root[data-mode=edit] .__P__-toc a{pointer-events:none}
`,
};

export {
  DOCS_CSS
};
