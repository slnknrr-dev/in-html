// landing-studio/viewer-theme-nocturne.js - theme preset "nocturne" (audio template).

// ===== Theme preset: nocturne — listening after dark (audio template) =====
// Designed dark: deep indigo night with lifted violet panels, a warm coral accent and violet as the second accent;
// geometric sans throughout, pill controls, soft glows (coral and violet orbs on the hero and bands), equalizer bars
// under section titles, gradient-edged cards, round play buttons that glow, numbered episode rows, gradient rings
// around narrators and a coral-to-violet edge on the featured plan. The light alternative (theme toggle) is derived
// by the engine; colours come from the token API only, so both schemes and every tone stay AA (coloured text uses
// --lp-link). One rule per line; every selector starts with .lp-root.lp-t-nocturne; each at-rule line has one owner.

// Shape: { key, vars, css }. vars feed the design system (viewer-design.js), which derives the full token set (tints,
// on-accent text and the rest) from these few values; css adds the preset's character on
// top. Every selector is scoped to .lp-root.lp-t-<key> (specificity 0,2,0 plus the target), which outranks the base
// library's single-class rules without !important and never leaks into pages using another theme.
const THEME_NOCTURNE = {
  key: 'nocturne',
  vars: {
    accent: '#ff7a5c', accent2: '#8f7cff', bg: '#0e0c1b', surface: '#18152b', text: '#efeaf8', muted: '#a8a2c2',
    border: '#2b2745', fontBody: 'geometric', fontHead: 'geometric', baseSize: 17, lineHeight: 1.6, radius: 18,
    buttons: 'pill', headings: 'normal', width: 1200, space: 'normal', scheme: 'dark',
  },
  css: `
.lp-root.lp-t-nocturne{--lp-hw:750;--lp-glow:color-mix(in srgb,var(--lp-accent) 45%,transparent);--lp-edge:linear-gradient(135deg,color-mix(in srgb,var(--lp-accent2) 55%,var(--lp-border)),var(--lp-border) 40%,var(--lp-border) 60%,color-mix(in srgb,var(--lp-accent) 45%,var(--lp-border)));scrollbar-color:color-mix(in srgb,var(--lp-accent2) 55%,transparent) transparent}
.lp-root.lp-t-nocturne ::selection{background:color-mix(in srgb,var(--lp-accent2) 45%,transparent)}
.lp-root.lp-t-nocturne .lp-h{letter-spacing:-.02em}
.lp-root.lp-t-nocturne .lp-h1{line-height:1.02;letter-spacing:-.035em}
.lp-root.lp-t-nocturne .lp-eyebrow{gap:.6em;color:var(--lp-link);font-size:.74em;font-weight:700;letter-spacing:.14em}
.lp-root.lp-t-nocturne .lp-eyebrow::before{content:"";flex:none;width:.5em;height:.5em;border-radius:50%;background:var(--lp-accent);box-shadow:0 0 0 .22em color-mix(in srgb,var(--lp-accent) 25%,transparent),0 0 14px var(--lp-glow)}
.lp-root.lp-t-nocturne .lp-sec-t::after{content:"";display:block;width:46px;height:14px;margin-top:.5em;background:linear-gradient(var(--lp-accent),var(--lp-accent)) 0 100%/6px 40% no-repeat,linear-gradient(var(--lp-accent),var(--lp-accent)) 10px 100%/6px 100% no-repeat,linear-gradient(var(--lp-accent2),var(--lp-accent2)) 20px 100%/6px 65% no-repeat,linear-gradient(var(--lp-accent2),var(--lp-accent2)) 30px 100%/6px 85% no-repeat,linear-gradient(var(--lp-accent),var(--lp-accent)) 40px 100%/6px 30% no-repeat}
.lp-root.lp-t-nocturne .lp-sec-a-center .lp-sec-t::after{margin-inline:auto}
.lp-root.lp-t-nocturne .lp-rich a{text-decoration-color:color-mix(in srgb,var(--lp-accent) 70%,transparent);text-underline-offset:.2em}
.lp-root.lp-t-nocturne .lp-rich li::marker{color:var(--lp-accent)}
.lp-root.lp-t-nocturne .lp-btn{font-weight:700;letter-spacing:.01em}
.lp-root.lp-t-nocturne:not(.lp-btn-outline) .lp-btn-primary{background-image:linear-gradient(120deg,var(--lp-accent),color-mix(in srgb,var(--lp-accent) 70%,var(--lp-accent2)));box-shadow:0 10px 30px -12px var(--lp-glow)}
.lp-root.lp-t-nocturne:not(.lp-btn-outline) .lp-btn-primary:hover{box-shadow:0 14px 36px -10px var(--lp-glow)}
.lp-root.lp-t-nocturne .lp-btn-secondary{border-color:color-mix(in srgb,var(--lp-accent2) 55%,var(--lp-border-s));background:color-mix(in srgb,var(--lp-accent2) 10%,transparent)}
.lp-root.lp-t-nocturne .lp-btn-secondary:hover{border-color:var(--lp-accent2);background:color-mix(in srgb,var(--lp-accent2) 20%,transparent);color:var(--lp-text)}
.lp-root.lp-t-nocturne .lp-card{border-color:transparent;background:linear-gradient(var(--lp-surface),var(--lp-surface)) padding-box,var(--lp-edge) border-box}
.lp-root.lp-t-nocturne .lp-card-hover:is(:hover,:focus-within){box-shadow:0 24px 48px -28px color-mix(in srgb,var(--lp-accent2) 60%,transparent)}
.lp-root.lp-t-nocturne .lp-icbox{border-radius:50%;background:color-mix(in srgb,var(--lp-accent2) 18%,transparent);color:var(--lp-link)}
.lp-root.lp-t-nocturne .lp-badge{box-shadow:0 0 18px -4px var(--lp-glow)}
.lp-root.lp-t-nocturne .lp-chip{background:color-mix(in srgb,var(--lp-accent2) 16%,transparent);color:var(--lp-text)}
.lp-root.lp-t-nocturne .lp-input{border-radius:14px;background:color-mix(in srgb,var(--lp-surface) 70%,var(--lp-bg))}
.lp-root.lp-t-nocturne .lp-input:focus{border-color:var(--lp-accent2);box-shadow:0 0 0 4px color-mix(in srgb,var(--lp-accent2) 28%,transparent)}
.lp-root.lp-t-nocturne .lp-att-ic{border-radius:50%;background:color-mix(in srgb,var(--lp-accent2) 20%,transparent)}
.lp-root.lp-t-nocturne .lp-nav-brand{font-weight:800;letter-spacing:-.02em}
.lp-root.lp-t-nocturne .lp-nav-a{font-weight:600}
.lp-root.lp-t-nocturne .lp-nav-a::after{height:3px;border-radius:3px;background:linear-gradient(90deg,var(--lp-accent),var(--lp-accent2))}
.lp-root.lp-t-nocturne .lp-nav-sticky{-webkit-backdrop-filter:blur(14px) saturate(1.3);backdrop-filter:blur(14px) saturate(1.3)}
.lp-root.lp-t-nocturne .lp-hero-t{font-size:clamp(2.5rem,1rem + 5cqi,5.2rem);font-weight:800;letter-spacing:-.04em}
.lp-root.lp-t-nocturne .lp-hero-badge{border-color:color-mix(in srgb,var(--lp-accent) 55%,transparent);background:color-mix(in srgb,var(--lp-accent) 16%,transparent);color:var(--lp-text)}
.lp-root.lp-t-nocturne .lp-hero-badge::before{background:var(--lp-accent);box-shadow:0 0 0 .25em color-mix(in srgb,var(--lp-accent) 30%,transparent),0 0 12px var(--lp-glow)}
.lp-root.lp-t-nocturne .lp-hero-bgd{padding-bottom:calc(var(--lp-hero-py) + 64px)}
.lp-root.lp-t-nocturne .lp-hero::before{background:radial-gradient(45% 60% at 82% 10%,color-mix(in srgb,var(--lp-accent) 22%,transparent),transparent 70%),radial-gradient(50% 70% at 5% 95%,color-mix(in srgb,var(--lp-accent2) 24%,transparent),transparent 72%)}
.lp-root.lp-t-nocturne .lp-sec.lp-tone-muted{background-image:radial-gradient(40% 60% at 100% 0%,color-mix(in srgb,var(--lp-accent2) 14%,transparent),transparent 70%),radial-gradient(35% 50% at 0% 100%,color-mix(in srgb,var(--lp-accent) 10%,transparent),transparent 70%)}
.lp-root.lp-t-nocturne .lp-sec.lp-tone-dark{background-image:radial-gradient(50% 70% at 50% 120%,color-mix(in srgb,var(--lp-accent2) 30%,transparent),transparent 70%),repeating-linear-gradient(90deg,transparent 0 6px,color-mix(in srgb,var(--lp-accent2) 6%,transparent) 6px 8px)}
.lp-root.lp-t-nocturne .lp-foot{border-top:1px solid color-mix(in srgb,var(--lp-accent2) 30%,var(--lp-border))}
.lp-root.lp-t-nocturne .lp-cta-card .lp-cta-box{background-image:radial-gradient(70% 120% at 100% 0%,color-mix(in srgb,var(--lp-accent2) 45%,transparent),transparent 70%);box-shadow:0 30px 60px -30px var(--lp-glow)}
.lp-root.lp-t-nocturne .lp-feat-ic{color:var(--lp-link);filter:drop-shadow(0 0 10px var(--lp-glow))}
.lp-root.lp-t-nocturne .lp-feat-t{font-weight:750}
.lp-root.lp-t-nocturne .lp-stat-v{background:linear-gradient(120deg,var(--lp-text),var(--lp-link));-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:800}
.lp-root.lp-t-nocturne .lp-stat-s{color:var(--lp-link);-webkit-text-fill-color:var(--lp-link)}
.lp-root.lp-t-nocturne .lp-stat-plain .lp-stat-i{border-inline-start:2px solid color-mix(in srgb,var(--lp-accent2) 60%,transparent)}
.lp-root.lp-t-nocturne .lp-tm-cards .lp-tm-item{border:1px solid transparent;background:linear-gradient(var(--lp-surface),var(--lp-surface)) padding-box,var(--lp-edge) border-box}
.lp-root.lp-t-nocturne .lp-tm-photo{box-shadow:inset 0 -60px 60px -40px color-mix(in srgb,var(--lp-accent2) 40%,transparent)}
.lp-root.lp-t-nocturne .lp-tm-name{font-weight:750}
.lp-root.lp-t-nocturne .lp-tm-role{color:var(--lp-link);font-weight:650}
.lp-root.lp-t-nocturne .lp-faq-details .lp-faq-item{border-color:transparent;background:linear-gradient(var(--lp-surface),var(--lp-surface)) padding-box,var(--lp-edge) border-box}
.lp-root.lp-t-nocturne .lp-faq-ic{border-radius:50%;background:color-mix(in srgb,var(--lp-accent) 18%,transparent);color:var(--lp-link)}
.lp-root.lp-t-nocturne .lp-faq-details .lp-faq-item[open]{box-shadow:0 18px 40px -28px var(--lp-glow)}
.lp-root.lp-t-nocturne .lp-plan{border-color:transparent;background:linear-gradient(var(--lp-surface),var(--lp-surface)) padding-box,var(--lp-edge) border-box}
.lp-root.lp-t-nocturne .lp-plan-feat{border:2px solid transparent;background:linear-gradient(var(--lp-surface),var(--lp-surface)) padding-box,linear-gradient(135deg,var(--lp-accent),var(--lp-accent2)) border-box;box-shadow:0 30px 60px -30px var(--lp-glow)}
.lp-root.lp-t-nocturne .lp-plan-rib{background-image:linear-gradient(90deg,var(--lp-accent),color-mix(in srgb,var(--lp-accent) 60%,var(--lp-accent2)))}
.lp-root.lp-t-nocturne .lp-plan .lp-price-now{font-weight:800;letter-spacing:-.03em}
.lp-root.lp-t-nocturne .lp-formb-card{border-color:transparent;background:linear-gradient(var(--lp-surface),var(--lp-surface)) padding-box,var(--lp-edge) border-box}
.lp-root.lp-t-nocturne .lp-cartb-box,.lp-root.lp-t-nocturne .lp-cartb-co{border-color:color-mix(in srgb,var(--lp-accent2) 40%,var(--lp-border))}
.lp-root.lp-t-nocturne .lp-cl-card{border-color:transparent;background:linear-gradient(var(--lp-surface),var(--lp-surface)) padding-box,var(--lp-edge) border-box}
.lp-root.lp-t-nocturne .lp-cl-card:hover{border-color:transparent;box-shadow:0 26px 50px -30px color-mix(in srgb,var(--lp-accent2) 70%,transparent)}
.lp-root.lp-t-nocturne .lp-cl-card .lp-cl-cv{margin:10px 10px 0;border-radius:calc(var(--lp-radius) * .8)}
.lp-root.lp-t-nocturne .lp-cl-title{font-weight:750;letter-spacing:-.012em}
.lp-root.lp-t-nocturne .lp-cl-fab{background-image:linear-gradient(135deg,var(--lp-accent),color-mix(in srgb,var(--lp-accent) 65%,var(--lp-accent2)));box-shadow:0 0 0 6px color-mix(in srgb,var(--lp-accent) 18%,transparent),0 10px 30px -6px var(--lp-glow)}
.lp-root.lp-t-nocturne .lp-cl-fab:hover{box-shadow:0 0 0 9px color-mix(in srgb,var(--lp-accent) 22%,transparent),0 14px 34px -6px var(--lp-glow)}
.lp-root.lp-t-nocturne .lp-cl-attrs dd{color:var(--lp-text)}
.lp-root.lp-t-nocturne .lp-cl-files{counter-reset:lp-ep}
.lp-root.lp-t-nocturne .lp-cl-file{counter-increment:lp-ep;border-color:transparent;border-radius:14px;background:color-mix(in srgb,var(--lp-accent2) 9%,transparent)}
.lp-root.lp-t-nocturne .lp-cl-file::before{content:counter(lp-ep,decimal-leading-zero);min-width:2ch;color:var(--lp-muted);font-size:.86em;font-weight:700;font-variant-numeric:tabular-nums}
.lp-root.lp-t-nocturne .lp-cl-fic{color:var(--lp-link)}
.lp-root.lp-t-nocturne .lp-cl-v-list .lp-cl-cv{align-self:flex-start;margin:12px;margin-inline-end:0;border-radius:calc(var(--lp-radius) * .8)}
.lp-root.lp-t-nocturne .lp-cl-v-list .lp-cl-cv .lp-media{height:auto;min-height:0;aspect-ratio:1/1}
.lp-root.lp-t-nocturne .lp-cl-v-feature .lp-cl-hero{background:linear-gradient(var(--lp-surface),var(--lp-surface)) padding-box,linear-gradient(135deg,var(--lp-accent),var(--lp-accent2)) border-box}
.lp-root.lp-t-nocturne .lp-cl-v-feature .lp-cl-hero .lp-cl-cv{margin:12px;margin-inline-end:0}
.lp-root.lp-t-nocturne .lp-cl-q,.lp-root.lp-t-nocturne .lp-cl-pill,.lp-root.lp-t-nocturne .lp-cl-sel{background-color:color-mix(in srgb,var(--lp-surface) 80%,transparent);border-color:color-mix(in srgb,var(--lp-accent2) 35%,var(--lp-border-s))}
.lp-root.lp-t-nocturne .lp-cl-q:focus{border-color:var(--lp-accent2);box-shadow:0 0 0 4px color-mix(in srgb,var(--lp-accent2) 25%,transparent)}
.lp-root.lp-t-nocturne .lp-cl-dd[open]>.lp-cl-pill,.lp-root.lp-t-nocturne .lp-cl-pill.lp-on{border-color:var(--lp-accent2);background:color-mix(in srgb,var(--lp-accent2) 22%,transparent);color:var(--lp-text)}
.lp-root.lp-t-nocturne .lp-cl-chip{background:transparent;border-color:color-mix(in srgb,var(--lp-accent2) 35%,var(--lp-border))}
.lp-root.lp-t-nocturne .lp-cl-chip[aria-pressed="true"]{border-color:transparent;background-image:linear-gradient(120deg,var(--lp-accent),color-mix(in srgb,var(--lp-accent) 70%,var(--lp-accent2)))}
.lp-root.lp-t-nocturne .lp-cl-pop{border-color:color-mix(in srgb,var(--lp-accent2) 35%,var(--lp-border));background:var(--lp-surface)}
.lp-root.lp-t-nocturne .lp-cl-pn{background:var(--lp-accent2);color:var(--lp-on-accent2)}
.lp-root.lp-t-nocturne .lp-check-t .lp-req{color:var(--lp-link)}
.lp-root.lp-t-nocturne .lp-ev-st-few{color:var(--lp-text);background:color-mix(in srgb,#f59e0b 24%,transparent)}
@container lp (max-width:600px){.lp-root.lp-t-nocturne .lp-cl-v-list .lp-cl-cv{margin:10px 10px 0}}
@container lp (max-width:600px){.lp-root.lp-t-nocturne .lp-hero-bgd{padding-bottom:calc(var(--lp-hero-py) + 96px)}}
@container lp (max-width:900px){.lp-root.lp-t-nocturne .lp-cl-v-feature .lp-cl-hero .lp-cl-cv{margin:10px 10px 0}}
@container lp (max-width:600px){.lp-root.lp-t-nocturne .lp-nav-brand{flex:0 1 auto;gap:9px;font-size:1.02em}.lp-root.lp-t-nocturne .lp-nav-name{line-height:1.12}}
@container lp (max-width:600px){.lp-root.lp-t-nocturne .lp-tools .lp-tb-lang{min-width:30px;padding-inline:6px}}
@container lp (max-width:430px){.lp-root.lp-t-nocturne .lp-tools .lp-tb-btn{display:none}}`,
};

export {
  THEME_NOCTURNE
};
