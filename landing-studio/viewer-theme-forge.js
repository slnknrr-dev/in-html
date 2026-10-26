// landing-studio/viewer-theme-forge.js - theme preset "forge" (industry template).

// ===== Theme preset: forge — heavy industry, steel and safety orange (industry template) =====
// Cool steel-grey page with white panels, graphite ink, safety-orange accent and blueprint blue; condensed uppercase
// headings, monospace technical labels, hazard-stripe marks, chamfered primary buttons, registration-mark card corners
// and blueprint grids on dark / muted bands. Colours come from the token API only, so the derived dark scheme and
// every tone stay AA (accent-coloured text uses --lp-link). One rule per line; every selector starts with
// .lp-root.lp-t-forge; each at-rule line has a single owner.

// Shape: { key, vars, css }. vars feed the design system (viewer-design.js), which derives the full token set (tints,
// on-accent text and the rest) from these few values; css adds the preset's character on
// top. Every selector is scoped to .lp-root.lp-t-<key> (specificity 0,2,0 plus the target), which outranks the base
// library's single-class rules without !important and never leaks into pages using another theme.
const THEME_FORGE = {
  key: 'forge',
  vars: {
    accent: '#ea5b0c', accent2: '#2e6a94', bg: '#eef1f4', surface: '#ffffff', text: '#141a21', muted: '#545e69',
    border: '#d3d9e0', fontBody: 'sans', fontHead: 'condensed', baseSize: 17, lineHeight: 1.6, radius: 3,
    buttons: 'square', headings: 'caps', width: 1200, space: 'normal', scheme: 'light',
  },
  css: `
.lp-root.lp-t-forge{--lp-hw:700;--lp-mono:ui-monospace,"Cascadia Mono","Cascadia Code","SF Mono",Menlo,Consolas,"Liberation Mono","DejaVu Sans Mono",monospace;--lp-hz:repeating-linear-gradient(-45deg,var(--lp-accent) 0 10px,#15191e 10px 20px);scrollbar-color:color-mix(in srgb,var(--lp-text) 32%,transparent) transparent}
.lp-root.lp-t-forge ::selection{background:color-mix(in srgb,var(--lp-accent) 34%,transparent)}
.lp-root.lp-t-forge .lp-h{font-weight:700;letter-spacing:.004em}
.lp-root.lp-t-forge .lp-h1{line-height:.98;letter-spacing:-.004em}
.lp-root.lp-t-forge .lp-h2{line-height:1.02}
.lp-root.lp-t-forge .lp-h3,.lp-root.lp-t-forge .lp-h4{letter-spacing:.012em}
.lp-root.lp-t-forge .lp-eyebrow{gap:.9em;font-family:var(--lp-mono);font-size:.72em;font-weight:600;letter-spacing:.14em;color:var(--lp-link)}
.lp-root.lp-t-forge .lp-eyebrow::before{content:"";flex:none;width:2.4em;height:.7em;background:repeating-linear-gradient(-45deg,var(--lp-accent) 0 3px,transparent 3px 6px)}
.lp-root.lp-t-forge .lp-lead{max-width:46em}
.lp-root.lp-t-forge .lp-rich blockquote{border-inline-start-width:4px;font-style:normal}
.lp-root.lp-t-forge .lp-rich li::marker{color:var(--lp-accent)}
.lp-root.lp-t-forge .lp-btn{font-family:var(--lp-font-h);font-size:1em;font-weight:700;text-transform:uppercase;letter-spacing:.07em}
.lp-root.lp-t-forge:not(.lp-btn-outline) .lp-btn-primary{--lp-fb:var(--lp-accent);border-color:transparent;background:linear-gradient(135deg,transparent 9px,var(--lp-fb) 9.5px calc(100% - 9.5px),transparent calc(100% - 9px))}
.lp-root.lp-t-forge:not(.lp-btn-outline) .lp-btn-primary:hover{--lp-fb:var(--lp-accent-h)}
.lp-root.lp-t-forge .lp-btn-secondary{border-width:2px;border-color:color-mix(in srgb,currentColor 58%,transparent);background:color-mix(in srgb,var(--lp-bg) 60%,transparent)}
.lp-root.lp-t-forge .lp-btn-secondary:hover{border-color:var(--lp-accent);background:color-mix(in srgb,var(--lp-accent) 12%,transparent);color:var(--lp-text)}
.lp-root.lp-t-forge .lp-btn-ghost:hover{background:color-mix(in srgb,var(--lp-accent) 12%,transparent)}
.lp-root.lp-t-forge .lp-media:not(.lp-media-round){border-radius:2px}
.lp-root.lp-t-forge .lp-card{box-shadow:0 1px 0 color-mix(in srgb,var(--lp-text) 7%,transparent)}
.lp-root.lp-t-forge .lp-card::before{content:"";position:absolute;top:0;left:0;z-index:2;width:16px;height:16px;border-top:3px solid var(--lp-accent);border-left:3px solid var(--lp-accent);pointer-events:none}
.lp-root.lp-t-forge .lp-card-hover:is(:hover,:focus-within){border-color:color-mix(in srgb,var(--lp-accent) 55%,var(--lp-border));box-shadow:0 22px 44px -26px color-mix(in srgb,var(--lp-text) 55%,transparent)}
.lp-root.lp-t-forge .lp-icbox{border-radius:2px;background:color-mix(in srgb,var(--lp-accent) 12%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--lp-accent) 40%,transparent);color:var(--lp-link)}
.lp-root.lp-t-forge .lp-badge{border-radius:1px;font-family:var(--lp-mono);font-weight:700;letter-spacing:.08em}
.lp-root.lp-t-forge .lp-chip{border-radius:2px}
.lp-root.lp-t-forge .lp-price-req{font-family:var(--lp-font-h);font-size:1.1em;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.lp-root.lp-t-forge .lp-kv dt{font-family:var(--lp-mono);font-size:.86em}
.lp-root.lp-t-forge .lp-input{border-radius:2px;background:var(--lp-surface)}
.lp-root.lp-t-forge .lp-input:focus{border-color:var(--lp-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--lp-accent) 28%,transparent)}
.lp-root.lp-t-forge .lp-label{font-family:var(--lp-mono);font-size:.76em;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.lp-root.lp-t-forge .lp-att{border-radius:2px}
.lp-root.lp-t-forge .lp-att-ic{border-radius:2px;background:var(--lp-accent);color:var(--lp-on-accent)}
.lp-root.lp-t-forge .lp-att-title{font-family:var(--lp-font-h);font-size:1.1em;text-transform:uppercase;letter-spacing:.03em}
.lp-root.lp-t-forge .lp-att-info{font-family:var(--lp-mono);letter-spacing:.04em}
.lp-root.lp-t-forge .lp-totop{border-radius:2px;border-color:var(--lp-accent)}
.lp-root.lp-t-forge .lp-nav{border-bottom:3px solid var(--lp-accent)}
.lp-root.lp-t-forge .lp-nav-brand{font-size:1.34em;text-transform:uppercase;letter-spacing:.07em}
.lp-root.lp-t-forge .lp-nav-a{font-family:var(--lp-font-h);font-size:1.04em;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
.lp-root.lp-t-forge .lp-nav-a::after{bottom:-1px;height:3px;border-radius:0}
.lp-root.lp-t-forge .lp-hero-toned{background-image:linear-gradient(color-mix(in srgb,var(--lp-text) 5%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--lp-text) 5%,transparent) 1px,transparent 1px);background-size:32px 32px;background-position:-1px -1px}
.lp-root.lp-t-forge .lp-hero::after{content:"";position:absolute;inset:auto 0 0;height:6px;background:var(--lp-hz)}
.lp-root.lp-t-forge .lp-hero-t{font-size:clamp(2.5rem,1.1rem + 5cqi,5.5rem);line-height:.97}
.lp-root.lp-t-forge .lp-hero-x{max-width:36em}
.lp-root.lp-t-forge .lp-hero-media{border-radius:2px;box-shadow:0 0 0 1px color-mix(in srgb,var(--lp-text) 16%,transparent),0 34px 70px -34px rgba(0,0,0,.75)}
.lp-root.lp-t-forge .lp-hero-badge{border-radius:2px;font-family:var(--lp-mono);font-size:.76em;letter-spacing:.05em}
.lp-root.lp-t-forge .lp-hero-badge::before{border-radius:0}
.lp-root.lp-t-forge .lp-sec-t{font-size:clamp(2rem,1.05rem + 3cqi,3.45rem)}
.lp-root.lp-t-forge .lp-sec.lp-tone-dark,.lp-root.lp-t-forge .lp-foot.lp-tone-dark,.lp-root.lp-t-forge .lp-cta.lp-tone-dark{background-image:linear-gradient(color-mix(in srgb,var(--lp-text) 7%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--lp-text) 7%,transparent) 1px,transparent 1px),linear-gradient(color-mix(in srgb,var(--lp-text) 3%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--lp-text) 3%,transparent) 1px,transparent 1px);background-size:128px 128px,128px 128px,16px 16px,16px 16px;background-position:-1px -1px}
.lp-root.lp-t-forge .lp-sec.lp-tone-muted{background-image:linear-gradient(color-mix(in srgb,var(--lp-text) 4%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--lp-text) 4%,transparent) 1px,transparent 1px);background-size:32px 32px;background-position:-1px -1px}
.lp-root.lp-t-forge .lp-hr-accent{height:6px;border-radius:0;background:var(--lp-hz)}
.lp-root.lp-t-forge .lp-qt-callout{border-radius:2px}
.lp-root.lp-t-forge .lp-feat-t{text-transform:uppercase;letter-spacing:.03em;line-height:1.12}
.lp-root.lp-t-forge .lp-feat:not(.lp-feat-split) .lp-feat-t{font-size:1.26em}
.lp-root.lp-t-forge .lp-feat-list .lp-feat-chk{border-radius:2px;background:var(--lp-accent);color:var(--lp-on-accent)}
.lp-root.lp-t-forge .lp-stat-v{column-gap:.14em;font-weight:700;letter-spacing:-.004em;color:var(--lp-text)}
.lp-root.lp-t-forge .lp-stat-s{color:var(--lp-link);font-weight:700}
.lp-root.lp-t-forge .lp-stat-l{font-family:var(--lp-mono);font-size:.74em;letter-spacing:.08em;text-transform:uppercase}
.lp-root.lp-t-forge .lp-stat-band{border-radius:2px}
.lp-root.lp-t-forge .lp-stat-band .lp-stat-i{box-shadow:inset 0 3px 0 var(--lp-accent)}
.lp-root.lp-t-forge .lp-stat-plain .lp-stat-i{border-inline-start:3px solid var(--lp-accent)}
.lp-root.lp-t-forge .lp-step-t{font-size:1.24em;text-transform:uppercase;letter-spacing:.03em}
.lp-root.lp-t-forge .lp-step-line .lp-step-n{border-width:3px;border-radius:2px;font-family:var(--lp-mono)}
.lp-root.lp-t-forge .lp-step-line .lp-step-i:not(:last-child)::after{border-radius:0;background:repeating-linear-gradient(180deg,var(--lp-accent) 0 8px,transparent 8px 14px)}
.lp-root.lp-t-forge .lp-step-cards .lp-step-n{border-radius:2px;font-family:var(--lp-mono)}
.lp-root.lp-t-forge .lp-tm-name{font-size:1.24em;text-transform:uppercase;letter-spacing:.03em}
.lp-root.lp-t-forge .lp-tm-role{color:var(--lp-link);font-family:var(--lp-mono);font-size:.74em;letter-spacing:.06em;text-transform:uppercase}
.lp-root.lp-t-forge .lp-ts-fig.lp-card::after{font-family:var(--lp-font-h);color:var(--lp-accent);opacity:.32}
.lp-root.lp-t-forge .lp-ts-name{font-family:var(--lp-font-h);font-size:1.08em;text-transform:uppercase;letter-spacing:.04em}
.lp-root.lp-t-forge .lp-logos-grid .lp-logo{border-radius:2px}
.lp-root.lp-t-forge .lp-faq-q{font-weight:700;letter-spacing:.01em}
.lp-root.lp-t-forge .lp-faq-ic{border-radius:2px;background:var(--lp-accent);color:var(--lp-on-accent)}
.lp-root.lp-t-forge .lp-faq-details .lp-faq-item{border-radius:2px}
.lp-root.lp-t-forge .lp-faq-details .lp-faq-item[open]{box-shadow:inset 3px 0 0 var(--lp-accent),var(--lp-shadow)}
.lp-root.lp-t-forge .lp-cta-t{letter-spacing:.004em}
.lp-root.lp-t-forge .lp-cta-banner::before{border-radius:0;background:radial-gradient(closest-side,color-mix(in srgb,var(--lp-accent) 26%,transparent),transparent)}
.lp-root.lp-t-forge .lp-ct-k{font-family:var(--lp-mono);font-size:.72em;letter-spacing:.1em;text-transform:uppercase}
.lp-root.lp-t-forge .lp-ct-map{border-radius:2px;box-shadow:0 0 0 1px var(--lp-border)}
.lp-root.lp-t-forge .lp-tbl-t th{font-family:var(--lp-font-h);text-transform:uppercase;letter-spacing:.04em}
.lp-root.lp-t-forge .lp-tbs-minimal th{border-bottom-width:3px}
.lp-root.lp-t-forge .lp-formb-card{border-radius:2px;border-top:4px solid var(--lp-accent)}
.lp-root.lp-t-forge .lp-pr{border-radius:2px}
.lp-root.lp-t-forge .lp-pr:hover{border-color:var(--lp-accent);box-shadow:0 24px 48px -28px color-mix(in srgb,var(--lp-text) 60%,transparent)}
.lp-root.lp-t-forge .lp-pr-name{font-size:1.3em;font-weight:700;line-height:1.06;text-transform:uppercase;letter-spacing:.02em}
.lp-root.lp-t-forge .lp-pr-specs{font-family:var(--lp-mono);font-size:.76em}
.lp-root.lp-t-forge .lp-pr-specs>div{border-bottom-style:dotted}
.lp-root.lp-t-forge .lp-pr-tbl{border-radius:2px}
.lp-root.lp-t-forge .lp-pr-tbl th{background:#20272f;color:#e9edf1;border-bottom:3px solid var(--lp-accent);font-family:var(--lp-mono);letter-spacing:.1em;text-transform:uppercase}
.lp-root.lp-t-forge .lp-pr-row .lp-pr-name{font-size:1.06em}
.lp-root.lp-t-forge .lp-cartb-box,.lp-root.lp-t-forge .lp-cartb-co{border-radius:2px;border-top:4px solid var(--lp-accent)}
.lp-root.lp-t-forge .lp-gal-it .lp-media{border-radius:2px}
.lp-root.lp-t-forge .lp-gal-cap{font-family:var(--lp-mono);font-size:.74em;letter-spacing:.05em;text-transform:uppercase}
.lp-root.lp-t-forge .lp-gal-mosaic .lp-gal-cap{border-radius:0;font-size:.72em;line-height:1.35}
.lp-root.lp-t-forge .lp-foot{border-top:0}
.lp-root.lp-t-forge .lp-foot::before{content:"";position:absolute;inset:0 0 auto;height:6px;background:var(--lp-hz)}
.lp-root.lp-t-forge .lp-foot-name{text-transform:uppercase;letter-spacing:.07em}
.lp-root.lp-t-forge .lp-foot-h{font-family:var(--lp-mono);color:var(--lp-link)}
@container lp (min-width:901px){.lp-root.lp-t-forge .lp-step-line:not(.lp-step-vert) .lp-step-i:not(:last-child)::after{height:3px;background:repeating-linear-gradient(90deg,var(--lp-accent) 0 8px,transparent 8px 14px)}}
@container lp (max-width:600px){.lp-root.lp-t-forge .lp-eyebrow{letter-spacing:.08em}}
@container lp (max-width:600px){.lp-root.lp-t-forge .lp-nav-brand{font-size:1.14em;letter-spacing:.04em}}
@container lp (max-width:600px){.lp-root.lp-t-forge .lp-tools .lp-tb-lang{min-width:30px;padding-inline:6px}}
@container lp-ts (max-width:600px){.lp-root.lp-t-forge .lp-ts-list{grid-template-columns:minmax(0,1fr)}}
@container lp (max-width:600px){.lp-root.lp-t-forge .lp-hero-t{font-size:clamp(2.2rem,12cqi,3.4rem)}}
@media (prefers-reduced-motion:reduce){.lp-root.lp-t-forge .lp-btn,.lp-root.lp-t-forge .lp-card-hover{transition:none}}`,
};

export {
  THEME_FORGE
};
