// landing-studio/viewer-theme-kvevri.js - theme preset "kvevri" (winery template).

// ===== Theme preset: kvevri — ivory paper, wine red, amber clay (winery template) =====
// A light design (the dark cellar palette is derived by the design system): ivory paper page with parchment cards,
// deep wine accent, amber-clay second accent, refined serif headings over a humanist body, thin rules and double
// "wine label" frames, a kvevri flourish under section titles and a kvevri/diamond frieze for ornament section edges.
// Ornaments are CSS masks painted with theme tokens, so they follow the light / dark palette and the section tones.
// One rule per line; every selector starts with .lp-root.lp-t-kvevri; each at-rule line has a single owner.

// url("data:image/svg+xml,…") for CSS masks; `body` uses single quotes only, < and > are percent-encoded.
function kvSvgURL(viewBox, body) {
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='" + viewBox + "'>" + body + '</svg>';
  return 'url("data:image/svg+xml,' + svg.replace(/</g, '%3C').replace(/>/g, '%3E') + '")';
}

// Flourish under section titles (120×16): rules, diamonds, grapes and a kvevri jar (rim, egg-shaped body, pointed base).
const KV_FLOURISH = kvSvgURL('0 0 120 16',
  "<path d='M0 7.6h40v.8H0zM80 7.6h40v.8H80zM43 8l3-3 3 3-3 3zM71 8l3-3 3 3-3 3zM55.5.8h9v1.5h-9z'/>"
  + "<path d='M57 2.3h6c3 1.4 4.8 3.7 4.8 6.3 0 3-2.8 5.2-7.8 7-5-1.8-7.8-4-7.8-7 0-2.6 1.8-4.9 4.8-6.3z'/>"
  + "<circle cx='51.6' cy='8' r='1.2'/><circle cx='68.4' cy='8' r='1.2'/>");
// Frieze tile (56×18) for section shape 'ornament' and the footer edge: a thin rule broken by kvevri jars, grapes and
// half diamonds that join into whole diamonds between tiles.
const KV_FRIEZE = kvSvgURL('0 0 56 18',
  "<path d='M0 8.5h19v1H0zM37 8.5h19v1H37zM0 5.5l3.5 3.5L0 12.5zM56 5.5l-3.5 3.5 3.5 3.5zM23.5 1h9v1.6h-9z'/>"
  + "<path d='M25 2.6h6c3.2 1.5 5 3.9 5 6.6 0 3.2-3 5.6-8 8.1-5-2.5-8-4.9-8-8.1 0-2.7 1.8-5.1 5-6.6z'/>"
  + "<circle cx='11' cy='9' r='1.3'/><circle cx='45' cy='9' r='1.3'/>");

// Shape: { key, vars, css }. vars feed the design system (viewer-design.js), which derives the full token set (tints,
// on-accent text and the rest) from these few values; css adds the preset's character on
// top. Every selector is scoped to .lp-root.lp-t-<key> (specificity 0,2,0 plus the target), which outranks the base
// library's single-class rules without !important and never leaks into pages using another theme.
const THEME_KVEVRI = {
  key: 'kvevri',
  vars: {
    accent: '#7b2335', accent2: '#a8642b', bg: '#f8f3ea', surface: '#f1e7d7', text: '#2a1915', muted: '#6c5647',
    border: '#e1d1b9', fontBody: 'humanist', fontHead: 'serif', baseSize: 17, lineHeight: 1.65, radius: 6,
    buttons: 'solid', headings: 'normal', width: 1180, space: 'airy', scheme: 'light',
  },
  css: `
.lp-root.lp-t-kvevri{--lp-hw:500;--lp-kv-rule:color-mix(in srgb,var(--lp-accent2) 34%,transparent);background-image:radial-gradient(130% 70% at 50% -10%,color-mix(in srgb,var(--lp-accent2) 7%,transparent),transparent 62%)}
.lp-root.lp-t-kvevri ::selection{background:color-mix(in srgb,var(--lp-accent) 24%,transparent)}
.lp-root.lp-t-kvevri .lp-h{letter-spacing:-.008em;font-feature-settings:"liga","onum"}
.lp-root.lp-t-kvevri .lp-h1{font-weight:400;letter-spacing:-.018em;line-height:1.04}
.lp-root.lp-t-kvevri .lp-h2{font-weight:400;letter-spacing:-.012em}
.lp-root.lp-t-kvevri .lp-h3{font-weight:600}
.lp-root.lp-t-kvevri .lp-eyebrow{gap:.85em;color:var(--lp-link);font-weight:600;font-size:.74em;letter-spacing:.24em}
.lp-root.lp-t-kvevri .lp-eyebrow::before{content:"";flex:none;width:2.4em;height:1px;background:currentColor;opacity:.55}
.lp-root.lp-t-kvevri .lp-a-center .lp-eyebrow::after,.lp-root.lp-t-kvevri .lp-sec-a-center .lp-sec-eb::after,.lp-root.lp-t-kvevri .lp-hero-center .lp-eyebrow::after{content:"";flex:none;width:2.4em;height:1px;background:currentColor;opacity:.55}
.lp-root.lp-t-kvevri .lp-eyebrow:lang(ka){font-size:.84em}
.lp-root.lp-t-kvevri .lp-lead{color:color-mix(in srgb,var(--lp-muted) 82%,var(--lp-text))}
.lp-root.lp-t-kvevri .lp-sec-head::after{content:"";display:block;width:120px;height:16px;margin-top:clamp(18px,2.2cqi,26px);background:var(--lp-accent2);-webkit-mask:${KV_FLOURISH} 0 50%/contain no-repeat;mask:${KV_FLOURISH} 0 50%/contain no-repeat}
.lp-root.lp-t-kvevri .lp-sec-a-center .lp-sec-head::after{margin-inline:auto;-webkit-mask-position:50% 50%;mask-position:50% 50%}
.lp-root.lp-t-kvevri .lp-sec-orn{color:var(--lp-accent2);-webkit-mask-image:${KV_FRIEZE};mask-image:${KV_FRIEZE};-webkit-mask-size:56px 18px;mask-size:56px 18px;opacity:.85}
.lp-root.lp-t-kvevri .lp-sec-t{font-weight:400}
.lp-root.lp-t-kvevri .lp-rich a{text-decoration-color:color-mix(in srgb,var(--lp-link) 40%,transparent)}
.lp-root.lp-t-kvevri .lp-rich blockquote{border-inline-start:1px solid var(--lp-accent2);font-family:var(--lp-font-h);font-size:1.12em}
.lp-root.lp-t-kvevri .lp-rich li::marker{color:var(--lp-accent2)}
.lp-root.lp-t-kvevri .lp-btn{font-size:.82em;font-weight:600;letter-spacing:.1em;text-transform:uppercase;padding:.9em 1.7em}
.lp-root.lp-t-kvevri .lp-btn:lang(ka){font-size:.9em}
.lp-root.lp-t-kvevri .lp-btn-sm{padding:.62em 1.15em;font-size:.76em}
.lp-root.lp-t-kvevri .lp-btn-lg{font-size:.88em;padding:1.05em 2em}
.lp-root.lp-t-kvevri:not(.lp-btn-outline) .lp-btn-primary{background-image:linear-gradient(180deg,color-mix(in srgb,#fff 9%,transparent),transparent 55%);box-shadow:0 1px 0 color-mix(in srgb,#fff 18%,transparent) inset,0 10px 24px -14px var(--lp-accent)}
.lp-root.lp-t-kvevri .lp-btn-secondary{border-width:1px;border-color:color-mix(in srgb,var(--lp-accent2) 60%,var(--lp-border-s))}
.lp-root.lp-t-kvevri .lp-btn-secondary:hover{border-color:var(--lp-link);background:var(--lp-tint);color:var(--lp-link)}
.lp-root.lp-t-kvevri .lp-card{border-color:var(--lp-kv-rule);box-shadow:0 1px 0 color-mix(in srgb,#fff 50%,transparent) inset}
.lp-root.lp-t-kvevri .lp-card::before{content:"";position:absolute;inset:5px;z-index:0;border:1px solid color-mix(in srgb,var(--lp-accent2) 20%,transparent);border-radius:max(0px,calc(var(--lp-radius) - 4px));pointer-events:none}
.lp-root.lp-t-kvevri .lp-card-hover:is(:hover,:focus-within){border-color:color-mix(in srgb,var(--lp-accent2) 60%,transparent);box-shadow:var(--lp-shadow-lg)}
.lp-root.lp-t-kvevri .lp-icbox{border-radius:50%;background:transparent;border:1px solid var(--lp-kv-rule);color:var(--lp-link);box-shadow:0 0 0 4px var(--lp-tint2)}
.lp-root.lp-t-kvevri .lp-chip{background:transparent;border:1px solid var(--lp-kv-rule);color:var(--lp-text);letter-spacing:.02em}
.lp-root.lp-t-kvevri .lp-badge{border-radius:2px;letter-spacing:.14em;padding:.4em .8em}
.lp-root.lp-t-kvevri .lp-price-now{font-family:var(--lp-font-h);font-weight:500;font-size:1.45em;color:var(--lp-link);letter-spacing:0}
.lp-root.lp-t-kvevri .lp-price-unit{font-style:italic}
.lp-root.lp-t-kvevri .lp-media{border-radius:calc(var(--lp-radius) - 2px)}
.lp-root.lp-t-kvevri .lp-media-round{border-radius:50%;box-shadow:0 0 0 4px var(--lp-bg),0 0 0 5px var(--lp-kv-rule)}
.lp-root.lp-t-kvevri .lp-input{background:color-mix(in srgb,var(--lp-bg) 70%,#fff 30%);border-color:color-mix(in srgb,var(--lp-accent2) 30%,var(--lp-border-s))}
.lp-root.lp-t-kvevri .lp-label{font-weight:600;letter-spacing:.01em}
.lp-root.lp-t-kvevri .lp-kv :is(dt,dd){border-bottom-style:dotted;border-bottom-color:var(--lp-kv-rule)}
.lp-root.lp-t-kvevri .lp-kv dd{font-weight:500}
.lp-root.lp-t-kvevri .lp-totop{border-color:var(--lp-kv-rule);color:var(--lp-link)}
.lp-root.lp-t-kvevri .lp-tone-dark{background-image:radial-gradient(90% 70% at 50% 0%,color-mix(in srgb,var(--lp-accent2) 16%,transparent),transparent 70%)}
.lp-root.lp-t-kvevri .lp-tone-muted{background-image:linear-gradient(180deg,color-mix(in srgb,var(--lp-accent2) 5%,transparent),transparent 40%)}
.lp-root.lp-t-kvevri .lp-tone-accent{background-image:radial-gradient(80% 90% at 85% 0%,color-mix(in srgb,#fff 10%,transparent),transparent 60%)}
.lp-root.lp-t-kvevri .lp-nav-name{font-family:var(--lp-font-h);font-size:1.32em;font-weight:500;letter-spacing:.01em}
.lp-root.lp-t-kvevri .lp-nav-a{letter-spacing:.02em}
.lp-root.lp-t-kvevri .lp-nav-sticky{border-bottom-color:var(--lp-kv-rule)}
.lp-root.lp-t-kvevri .lp-hero-t{font-weight:400;font-size:clamp(2.6rem,1.1rem + 5.2cqi,5.7rem);letter-spacing:-.02em}
.lp-root.lp-t-kvevri .lp-hero-t:lang(ka){font-size:clamp(2.1rem,1rem + 3.9cqi,4.3rem);letter-spacing:0}
.lp-root.lp-t-kvevri .lp-hero-badge{display:flex;width:fit-content;border-radius:2px;letter-spacing:.06em;background:color-mix(in srgb,var(--lp-bg) 25%,transparent);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.lp-root.lp-t-kvevri .lp-hero-toned .lp-eyebrow{color:color-mix(in srgb,var(--lp-text) 80%,var(--lp-accent2))}
.lp-root.lp-t-kvevri .lp-hero-toned .lp-hero-x{color:color-mix(in srgb,var(--lp-text) 86%,transparent)}
.lp-root.lp-t-kvevri .lp-qt-pull{font-family:var(--lp-font-h)}
.lp-root.lp-t-kvevri .lp-qt-mark{color:var(--lp-accent2);opacity:.7}
.lp-root.lp-t-kvevri .lp-stat-n{font-family:var(--lp-font-h);font-weight:400;color:var(--lp-link)}
.lp-root.lp-t-kvevri .lp-stat-s{font-family:var(--lp-font-h)}
.lp-root.lp-t-kvevri .lp-step-n{font-family:var(--lp-font-h);font-weight:500;background:var(--lp-bg);color:var(--lp-link);box-shadow:0 0 0 1px var(--lp-kv-rule),0 0 0 5px var(--lp-bg),0 0 0 6px color-mix(in srgb,var(--lp-accent2) 18%,transparent)}
.lp-root.lp-t-kvevri .lp-step-t{font-family:var(--lp-font-h);font-size:1.2em}
.lp-root.lp-t-kvevri .lp-tl-date{font-family:var(--lp-font-h);color:var(--lp-link);letter-spacing:.02em}
.lp-root.lp-t-kvevri .lp-tm-name{font-family:var(--lp-font-h);font-size:1.25em;font-weight:500}
.lp-root.lp-t-kvevri .lp-tm-role{color:var(--lp-link);font-size:.78em;font-weight:600;letter-spacing:.14em;text-transform:uppercase}
.lp-root.lp-t-kvevri .lp-ts-q{font-family:var(--lp-font-h);font-size:1.08em;font-style:italic}
.lp-root.lp-t-kvevri .lp-faq-q{font-family:var(--lp-font-h);font-size:1.12em;font-weight:500}
.lp-root.lp-t-kvevri .lp-pr-name{font-family:var(--lp-font-h);font-weight:500;font-size:1.3em}
.lp-root.lp-t-kvevri .lp-pr-top .lp-media{border-radius:0}
.lp-root.lp-t-kvevri .lp-ev-date{font-family:var(--lp-font-h);border-color:var(--lp-kv-rule)}
.lp-root.lp-t-kvevri .lp-ev-title{font-family:var(--lp-font-h);font-weight:500}
.lp-root.lp-t-kvevri .lp-wk-title{font-family:var(--lp-font-h);font-weight:500}
.lp-root.lp-t-kvevri .lp-gal-cap{font-family:var(--lp-font-h);font-style:italic}
.lp-root.lp-t-kvevri .lp-hr-ornament{color:var(--lp-accent2)}
.lp-root.lp-t-kvevri .lp-foot{position:relative}
.lp-root.lp-t-kvevri .lp-foot-name{font-family:var(--lp-font-h);font-size:1.5em;font-weight:500}
.lp-root.lp-t-kvevri .lp-foot-h{color:var(--lp-link);font-family:var(--lp-font);font-size:.74em;font-weight:700;letter-spacing:.2em;text-transform:uppercase}
.lp-root.lp-t-kvevri .lp-foot::before{content:"";position:absolute;top:-9px;inset-inline:0;z-index:1;height:18px;background:var(--lp-accent2);opacity:.8;pointer-events:none;-webkit-mask:${KV_FRIEZE} 50% 50%/56px 18px repeat-x;mask:${KV_FRIEZE} 50% 50%/56px 18px repeat-x}
@container lp (max-width:600px){.lp-root.lp-t-kvevri .lp-eyebrow{letter-spacing:.16em}}
@container lp (max-width:600px){.lp-root.lp-t-kvevri .lp-btn{letter-spacing:.06em}}
@container lp (max-width:600px){.lp-root.lp-t-kvevri .lp-nav-name{font-size:1.12em}}
@media (forced-colors:active){.lp-root.lp-t-kvevri .lp-sec-head::after,.lp-root.lp-t-kvevri .lp-foot::before{display:none}}`,
};

export {
  THEME_KVEVRI
};
