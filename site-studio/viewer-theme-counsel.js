// site-studio/viewer-theme-counsel.js - theme preset "counsel" (legal services template).

// ===== Theme preset: counsel — editorial, trustworthy, quiet (legal services template) =====
// Warm paper page with white panels, deep navy ink and accent, brass hairlines; serif headings, small-caps labels,
// a brass rule under section titles, ruled-paper muted bands, navy bands with a brass glow, square corners,
// greyscale portraits that warm up on hover. Colours come from the token API only, so the derived dark scheme and
// every tone stay AA (brass is decoration only, text uses --lp-text / --lp-link). One rule per line; every
// selector starts with .lp-root.lp-t-counsel; each at-rule line has a single owner.

// Shape: { key, vars, css }. vars feed the design system (viewer-design.js), which derives the full token set (tints,
// on-accent text and the rest) from these few values; css adds the preset's character on
// top. Every selector is scoped to .lp-root.lp-t-<key> (specificity 0,2,0 plus the target), which outranks the base
// library's single-class rules without !important and never leaks into pages using another theme.
const THEME_COUNSEL = {
  key: 'counsel',
  vars: {
    accent: '#1f3a5f', accent2: '#b08d57', bg: '#faf8f4', surface: '#ffffff', text: '#16202e', muted: '#566070',
    border: '#e4ded3', fontBody: 'humanist', fontHead: 'serif', baseSize: 17, lineHeight: 1.65, radius: 2,
    buttons: 'square', headings: 'normal', width: 1160, space: 'airy', scheme: 'light',
  },
  css: `
.lp-root.lp-t-counsel{--lp-hw:600;--lp-hk:1.02;scrollbar-color:color-mix(in srgb,var(--lp-text) 30%,transparent) transparent}
.lp-root.lp-t-counsel ::selection{background:color-mix(in srgb,var(--lp-accent2) 38%,transparent)}
.lp-root.lp-t-counsel .lp-h{letter-spacing:-.008em}
.lp-root.lp-t-counsel .lp-h1{line-height:1.08;letter-spacing:-.016em}
.lp-root.lp-t-counsel .lp-h4{font-family:var(--lp-font);font-weight:650;letter-spacing:.01em}
.lp-root.lp-t-counsel .lp-eyebrow{gap:.9em;color:var(--lp-text);font-size:.7em;font-weight:650;letter-spacing:.2em}
.lp-root.lp-t-counsel .lp-eyebrow::before{content:"";flex:none;width:2.2em;height:1px;background:var(--lp-accent2)}
.lp-root.lp-t-counsel .lp-sec-t::after{content:"";display:block;width:48px;height:2px;margin-top:.5em;background:var(--lp-accent2)}
.lp-root.lp-t-counsel .lp-sec-a-center .lp-sec-t::after{margin-inline:auto}
.lp-root.lp-t-counsel .lp-lead{font-family:var(--lp-font-h);font-size:clamp(1.08rem,1rem + .4cqi,1.28rem);line-height:1.6}
.lp-root.lp-t-counsel .lp-rich a{text-decoration-color:color-mix(in srgb,var(--lp-accent2) 70%,transparent);text-underline-offset:.22em}
.lp-root.lp-t-counsel .lp-rich li::marker{color:var(--lp-accent2)}
.lp-root.lp-t-counsel .lp-rich blockquote{border-inline-start:2px solid var(--lp-accent2);font-family:var(--lp-font-h)}
.lp-root.lp-t-counsel .lp-btn{font-size:.9em;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.lp-root.lp-t-counsel .lp-btn-sm{font-size:.8em}
.lp-root.lp-t-counsel:not(.lp-btn-outline) .lp-btn-primary{box-shadow:inset 0 -2px 0 color-mix(in srgb,var(--lp-accent2) 70%,transparent)}
.lp-root.lp-t-counsel .lp-btn-secondary{border-width:1px;border-color:color-mix(in srgb,var(--lp-text) 45%,transparent)}
.lp-root.lp-t-counsel .lp-btn-secondary:hover{border-color:var(--lp-accent2);background:color-mix(in srgb,var(--lp-accent2) 10%,transparent);color:var(--lp-text)}
.lp-root.lp-t-counsel .lp-btn-ghost{text-decoration:underline;text-decoration-color:var(--lp-accent2);text-underline-offset:.4em}
.lp-root.lp-t-counsel .lp-card{box-shadow:none}
.lp-root.lp-t-counsel .lp-card-hover:is(:hover,:focus-within){transform:none;border-color:color-mix(in srgb,var(--lp-accent2) 65%,var(--lp-border));box-shadow:inset 0 2px 0 var(--lp-accent2),0 22px 44px -32px color-mix(in srgb,var(--lp-text) 55%,transparent)}
.lp-root.lp-t-counsel .lp-icbox{border-radius:50%;background:transparent;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--lp-accent2) 70%,transparent);color:var(--lp-link)}
.lp-root.lp-t-counsel .lp-badge{border-radius:1px;letter-spacing:.12em}
.lp-root.lp-t-counsel .lp-chip{border-radius:1px}
.lp-root.lp-t-counsel .lp-input{border-radius:1px;background:var(--lp-surface)}
.lp-root.lp-t-counsel .lp-input:focus{border-color:var(--lp-link);box-shadow:0 0 0 3px color-mix(in srgb,var(--lp-accent2) 32%,transparent)}
.lp-root.lp-t-counsel .lp-label{font-size:.78em;letter-spacing:.08em;text-transform:uppercase}
.lp-root.lp-t-counsel .lp-media:not(.lp-media-round){border-radius:1px}
.lp-root.lp-t-counsel .lp-att{border-radius:1px}
.lp-root.lp-t-counsel .lp-att-ic{border-radius:50%;background:transparent;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--lp-accent2) 70%,transparent)}
.lp-root.lp-t-counsel .lp-att-title{font-family:var(--lp-font-h);font-size:1.08em;font-weight:600}
.lp-root.lp-t-counsel .lp-totop{border-radius:1px;border-color:var(--lp-accent2)}
.lp-root.lp-t-counsel .lp-nav-brand{font-weight:600;letter-spacing:.01em}
.lp-root.lp-t-counsel .lp-nav-a{font-size:.9em;letter-spacing:.05em;text-transform:uppercase}
.lp-root.lp-t-counsel .lp-nav-a::after{height:1px;bottom:3px;background:var(--lp-accent2)}
.lp-root.lp-t-counsel .lp-nav-sticky{border-bottom-color:color-mix(in srgb,var(--lp-accent2) 40%,transparent)}
.lp-root.lp-t-counsel .lp-hero::before{background:radial-gradient(55% 70% at 88% 0%,color-mix(in srgb,var(--lp-accent2) 18%,transparent),transparent 70%),radial-gradient(50% 60% at 0% 100%,color-mix(in srgb,var(--lp-accent) 7%,transparent),transparent 72%)}
.lp-root.lp-t-counsel .lp-hero-t{font-size:clamp(2.3rem,1rem + 4.4cqi,4.6rem);font-weight:500;line-height:1.06}
.lp-root.lp-t-counsel .lp-hero-badge{border-radius:1px;border-color:color-mix(in srgb,var(--lp-accent2) 70%,transparent);background:transparent;letter-spacing:.04em}
.lp-root.lp-t-counsel .lp-hero-badge::before{border-radius:0;background:var(--lp-accent2);box-shadow:none;transform:rotate(45deg)}
.lp-root.lp-t-counsel .lp-hero-media{border-radius:1px;box-shadow:0 0 0 1px color-mix(in srgb,var(--lp-accent2) 45%,transparent),0 30px 60px -36px color-mix(in srgb,var(--lp-text) 60%,transparent)}
.lp-root.lp-t-counsel .lp-sec.lp-tone-muted{background-image:repeating-linear-gradient(180deg,transparent 0 31px,color-mix(in srgb,var(--lp-link) 4%,transparent) 31px 32px)}
.lp-root.lp-t-counsel .lp-sec.lp-tone-dark,.lp-root.lp-t-counsel .lp-foot.lp-tone-dark,.lp-root.lp-t-counsel .lp-cta.lp-tone-dark{background-image:radial-gradient(ellipse 55% 75% at 88% 0%,color-mix(in srgb,var(--lp-accent2) 20%,transparent),transparent 70%),repeating-linear-gradient(135deg,transparent 0 22px,color-mix(in srgb,var(--lp-accent2) 6%,transparent) 22px 23px)}
.lp-root.lp-t-counsel .lp-feat-t{font-family:var(--lp-font-h);font-size:1.22em;font-weight:600}
.lp-root.lp-t-counsel .lp-feat-cards .lp-feat-i{border-top:2px solid color-mix(in srgb,var(--lp-accent2) 75%,transparent)}
.lp-root.lp-t-counsel .lp-stat-v{color:var(--lp-text);font-weight:500;letter-spacing:-.02em}
.lp-root.lp-t-counsel .lp-stat-s{color:var(--lp-link)}
.lp-root.lp-t-counsel .lp-stat-l{font-size:.86em;letter-spacing:.04em}
.lp-root.lp-t-counsel .lp-stat-band{border-radius:1px}
.lp-root.lp-t-counsel .lp-stat-plain .lp-stat-i{border-inline-start:1px solid var(--lp-accent2)}
.lp-root.lp-t-counsel .lp-step-numbers .lp-step-i{border-top:1px solid color-mix(in srgb,var(--lp-accent2) 70%,transparent)}
.lp-root.lp-t-counsel .lp-step-numbers .lp-step-n{font-weight:400;-webkit-text-stroke:1px var(--lp-accent2)}
.lp-root.lp-t-counsel .lp-step-t{font-family:var(--lp-font-h);font-size:1.2em;font-weight:600}
.lp-root.lp-t-counsel .lp-tl-date{border-radius:1px;background:transparent;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--lp-accent2) 75%,transparent);color:var(--lp-text);letter-spacing:.08em}
.lp-root.lp-t-counsel .lp-tl-dot{border-width:2px;border-color:var(--lp-accent2);box-shadow:0 0 0 4px var(--lp-bg)}
.lp-root.lp-t-counsel .lp-tl::before{width:1px;background:color-mix(in srgb,var(--lp-accent2) 60%,transparent)}
.lp-root.lp-t-counsel .lp-tl-alternate .lp-tl-card{border-radius:1px;box-shadow:none}
.lp-root.lp-t-counsel .lp-tm-name{font-weight:600}
.lp-root.lp-t-counsel .lp-tm-role{color:var(--lp-link);font-size:.78em;letter-spacing:.1em;text-transform:uppercase}
.lp-root.lp-t-counsel .lp-tm-photo img{filter:grayscale(.9) contrast(1.04);transition:filter .5s var(--lp-ease)}
.lp-root.lp-t-counsel .lp-tm-item:is(:hover,:focus-within) .lp-tm-photo img{filter:none}
.lp-root.lp-t-counsel .lp-ts-q{font-family:var(--lp-font-h);font-size:1.08em;font-style:italic}
.lp-root.lp-t-counsel .lp-ts-fig.lp-card::after{font-family:var(--lp-font-h);color:var(--lp-accent2);opacity:.55}
.lp-root.lp-t-counsel .lp-ts-name{font-weight:650;letter-spacing:.02em}
.lp-root.lp-t-counsel .lp-qt-pull .lp-qt-body{font-style:italic;font-weight:400}
.lp-root.lp-t-counsel .lp-qt-mark{fill:var(--lp-accent2)}
.lp-root.lp-t-counsel .lp-qt-callout{border-radius:1px}
.lp-root.lp-t-counsel .lp-faq-q{font-weight:600}
.lp-root.lp-t-counsel .lp-faq-ic{background:transparent;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--lp-accent2) 70%,transparent);color:var(--lp-link)}
.lp-root.lp-t-counsel .lp-faq-details .lp-faq-item{border-radius:1px}
.lp-root.lp-t-counsel .lp-faq-details .lp-faq-item[open]{border-color:color-mix(in srgb,var(--lp-accent2) 65%,var(--lp-border));box-shadow:inset 2px 0 0 var(--lp-accent2)}
.lp-root.lp-t-counsel .lp-plan{border-radius:1px}
.lp-root.lp-t-counsel .lp-plan-feat{border-width:1px;border-color:var(--lp-accent);background:var(--lp-surface);box-shadow:inset 0 3px 0 var(--lp-accent2),var(--lp-shadow-lg)}
.lp-root.lp-t-counsel .lp-plan-rib{border-radius:1px;letter-spacing:.14em}
.lp-root.lp-t-counsel .lp-plan-name{font-weight:600}
.lp-root.lp-t-counsel .lp-plan .lp-price-now{font-weight:500}
.lp-root.lp-t-counsel .lp-plan-body li::before{background:transparent;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--lp-accent2) 75%,transparent)}
.lp-root.lp-t-counsel .lp-ev-date{border-radius:1px;background:transparent;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--lp-accent2) 75%,transparent);color:var(--lp-text)}
.lp-root.lp-t-counsel .lp-ev-d{font-weight:500;color:var(--lp-link)}
.lp-root.lp-t-counsel .lp-tbl-t th{font-family:var(--lp-font);font-size:.78em;font-weight:650;letter-spacing:.08em;text-transform:uppercase}
.lp-root.lp-t-counsel .lp-tbs-minimal th{border-bottom:1px solid var(--lp-accent2)}
.lp-root.lp-t-counsel .lp-formb-card{border-radius:1px;box-shadow:inset 0 3px 0 var(--lp-accent2),var(--lp-shadow-lg)}
.lp-root.lp-t-counsel .lp-ct-k{font-size:.74em;letter-spacing:.12em;text-transform:uppercase}
.lp-root.lp-t-counsel .lp-ct-map{border-radius:1px;box-shadow:0 0 0 1px var(--lp-border)}
.lp-root.lp-t-counsel .lp-logos-strip .lp-logo-img{opacity:.85}
.lp-root.lp-t-counsel .lp-cta-t{font-weight:500}
.lp-root.lp-t-counsel .lp-foot-name{font-weight:600}
.lp-root.lp-t-counsel .lp-foot-h{letter-spacing:.16em}
@container lp (max-width:600px){.lp-root.lp-t-counsel .lp-eyebrow{letter-spacing:.12em}}
@container lp (max-width:600px){.lp-root.lp-t-counsel .lp-tools .lp-tb-lang{min-width:30px;padding-inline:6px}}
@container lp (max-width:430px){.lp-root.lp-t-counsel .lp-tools .lp-tb-btn{display:none}}
@container lp-ts (max-width:600px){.lp-root.lp-t-counsel .lp-ts-list{grid-template-columns:minmax(0,1fr)}}
@media (prefers-reduced-motion:reduce){.lp-root.lp-t-counsel .lp-tm-photo img{transition:none}}`,
};

export {
  THEME_COUNSEL
};
