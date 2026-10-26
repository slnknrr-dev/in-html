// site-studio/viewer-theme-supra.js - theme preset "supra" (dance template).

// ===== Theme preset: supra — dramatic stage night (dance template) =====
// Near-black and deep burgundy, gold and ivory, display-serif headings, Georgian ornament accents
// (diamond eyebrow marks, kilim lattice on dark tones, candle-glow buttons, gold passe-partout frames).
// One rule per line; every selector starts with .lp-root.lp-t-supra; each at-rule line has a single owner.

// Shape: { key, vars, css }. vars feed the design system (viewer-design.js), which derives the full token set (tints,
// on-accent text and the rest) from these few values; css adds the preset's character on
// top. Every selector is scoped to .lp-root.lp-t-<key> (specificity 0,2,0 plus the target), which outranks the base
// library's single-class rules without !important and never leaks into pages using another theme.
const THEME_SUPRA = {
  key: 'supra',
  vars: {
    accent: '#d4a54c', accent2: '#8c1c2e', bg: '#0e090a', surface: '#1b1012', text: '#f2e8d5', muted: '#b8a58c',
    border: '#3b2427', fontBody: 'humanist', fontHead: 'display', radius: 4, buttons: 'solid', headings: 'normal',
    scheme: 'dark',
  },
  css: `
.lp-root.lp-t-supra{--lp-shadow:0 1px 0 rgba(255,236,200,.04) inset,0 18px 40px -20px rgba(0,0,0,.85);--lp-shadow-lg:0 30px 80px -28px rgba(0,0,0,.9),0 0 0 1px color-mix(in srgb,var(--lp-accent) 16%,transparent);scrollbar-color:color-mix(in srgb,var(--lp-accent) 45%,transparent) transparent}
.lp-root.lp-t-supra ::selection{background:color-mix(in srgb,var(--lp-accent) 42%,transparent);color:var(--lp-text)}
.lp-root.lp-t-supra .lp-h{font-weight:500;letter-spacing:.012em;text-wrap:balance}
.lp-root.lp-t-supra .lp-h1{font-weight:400;letter-spacing:.02em;line-height:1.04}
.lp-root.lp-t-supra .lp-h2{font-weight:400;letter-spacing:.015em}
.lp-root.lp-t-supra .lp-h3{letter-spacing:.01em}
.lp-root.lp-t-supra .lp-h:lang(ka){letter-spacing:0}
.lp-root.lp-t-supra .lp-eyebrow{color:var(--lp-accent);font-family:var(--lp-font);font-weight:600;letter-spacing:.26em;text-transform:uppercase;font-size:.76em}
.lp-root.lp-t-supra .lp-eyebrow::before{content:"";display:inline-block;width:.5em;height:.5em;margin-inline-end:.9em;border:1px solid currentColor;transform:translateY(-.12em) rotate(45deg);box-shadow:0 0 10px color-mix(in srgb,currentColor 55%,transparent)}
.lp-root.lp-t-supra .lp-eyebrow:lang(ka){text-transform:none;letter-spacing:.05em;font-size:.84em}
.lp-root.lp-t-supra .lp-lead{color:color-mix(in srgb,var(--lp-text) 80%,var(--lp-accent))}
.lp-root.lp-t-supra .lp-rich a{color:var(--lp-accent);text-decoration-color:color-mix(in srgb,var(--lp-accent) 45%,transparent);text-underline-offset:.2em}
.lp-root.lp-t-supra .lp-rich a:hover{text-decoration-color:currentColor}
.lp-root.lp-t-supra .lp-rich blockquote{border-inline-start-color:var(--lp-accent);font-family:var(--lp-font-h);font-style:italic}
.lp-root.lp-t-supra .lp-rich li::marker{color:var(--lp-accent)}
.lp-root.lp-t-supra .lp-btn{letter-spacing:.06em;font-weight:600;transition:background-color .25s var(--lp-ease),border-color .25s var(--lp-ease),box-shadow .3s var(--lp-ease),transform .25s var(--lp-ease),color .25s var(--lp-ease)}
.lp-root.lp-t-supra .lp-btn:lang(ka){letter-spacing:.01em}
.lp-root.lp-t-supra:not(.lp-btn-outline) .lp-btn-primary{background:linear-gradient(180deg,color-mix(in srgb,var(--lp-accent) 78%,#fff) 0%,var(--lp-accent) 52%,color-mix(in srgb,var(--lp-accent) 82%,#000) 100%);color:var(--lp-on-accent);border-color:transparent;box-shadow:0 0 0 1px color-mix(in srgb,var(--lp-accent) 55%,#000) inset,0 12px 30px -12px color-mix(in srgb,var(--lp-accent) 75%,transparent)}
.lp-root.lp-t-supra:not(.lp-btn-outline) .lp-btn-primary:hover{transform:translateY(-1px);box-shadow:0 0 0 1px color-mix(in srgb,var(--lp-accent) 55%,#000) inset,0 0 36px -6px color-mix(in srgb,var(--lp-accent) 80%,transparent)}
.lp-root.lp-t-supra .lp-btn-secondary{background:color-mix(in srgb,var(--lp-bg) 45%,transparent);color:var(--lp-text);border:1px solid color-mix(in srgb,var(--lp-accent) 62%,transparent);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.lp-root.lp-t-supra .lp-btn-secondary:hover{border-color:var(--lp-accent);color:var(--lp-accent);box-shadow:0 0 26px -8px color-mix(in srgb,var(--lp-accent) 70%,transparent)}
.lp-root.lp-t-supra .lp-btn-ghost:hover{color:var(--lp-accent)}
.lp-root.lp-t-supra .lp-card{background:linear-gradient(180deg,color-mix(in srgb,var(--lp-surface) 90%,var(--lp-accent2)) 0%,var(--lp-surface) 70%);border-color:color-mix(in srgb,var(--lp-accent) 15%,var(--lp-border));box-shadow:var(--lp-shadow)}
.lp-root.lp-t-supra .lp-card-hover{transition:border-color .3s var(--lp-ease),box-shadow .3s var(--lp-ease),transform .3s var(--lp-ease)}
.lp-root.lp-t-supra .lp-card-hover:hover{border-color:color-mix(in srgb,var(--lp-accent) 42%,transparent);box-shadow:var(--lp-shadow-lg);transform:translateY(-2px)}
.lp-root.lp-t-supra .lp-icbox{color:var(--lp-accent);background:radial-gradient(circle at 50% 45%,color-mix(in srgb,var(--lp-accent) 24%,transparent),transparent 72%);border:1px solid color-mix(in srgb,var(--lp-accent) 48%,transparent);border-radius:2px;transform:rotate(45deg) scale(.84);box-shadow:0 0 22px -6px color-mix(in srgb,var(--lp-accent) 55%,transparent)}
.lp-root.lp-t-supra .lp-icbox>*{transform:rotate(-45deg) scale(1.16)}
.lp-root.lp-t-supra .lp-badge{background:color-mix(in srgb,var(--lp-accent) 15%,transparent);color:var(--lp-accent);border:1px solid color-mix(in srgb,var(--lp-accent) 42%,transparent);letter-spacing:.06em}
.lp-root.lp-t-supra .lp-chip{background:transparent;border:1px solid color-mix(in srgb,var(--lp-accent) 32%,var(--lp-border));color:color-mix(in srgb,var(--lp-text) 82%,var(--lp-accent))}
.lp-root.lp-t-supra .lp-price-now{font-family:var(--lp-font-h);color:var(--lp-accent);letter-spacing:.01em}
.lp-root.lp-t-supra .lp-price-old{opacity:.7}
.lp-root.lp-t-supra .lp-media{box-shadow:0 0 0 1px color-mix(in srgb,var(--lp-accent) 18%,transparent),var(--lp-shadow)}
.lp-root.lp-t-supra .lp-input{background:color-mix(in srgb,var(--lp-bg) 55%,transparent);border-color:color-mix(in srgb,var(--lp-accent) 22%,var(--lp-border));color:var(--lp-text)}
.lp-root.lp-t-supra .lp-input:focus{border-color:var(--lp-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--lp-accent) 22%,transparent)}
.lp-root.lp-t-supra .lp-label{letter-spacing:.03em;color:color-mix(in srgb,var(--lp-text) 86%,var(--lp-accent))}
.lp-root.lp-t-supra .lp-kv dt{color:var(--lp-muted)}
.lp-root.lp-t-supra .lp-totop{color:var(--lp-accent);border:1px solid color-mix(in srgb,var(--lp-accent) 55%,transparent);background:color-mix(in srgb,var(--lp-bg) 82%,transparent);box-shadow:0 0 24px -8px color-mix(in srgb,var(--lp-accent) 60%,transparent)}
.lp-root.lp-t-supra .lp-tone-muted{background-image:radial-gradient(ellipse 85% 60% at 50% 0%,color-mix(in srgb,var(--lp-accent2) 30%,transparent),transparent 72%)}
.lp-root.lp-t-supra .lp-tone-dark{background-image:radial-gradient(ellipse 70% 50% at 50% 0%,color-mix(in srgb,var(--lp-accent2) 22%,transparent),transparent 75%),repeating-linear-gradient(45deg,color-mix(in srgb,var(--lp-accent) 6%,transparent) 0 1px,transparent 1px 26px),repeating-linear-gradient(-45deg,color-mix(in srgb,var(--lp-accent) 6%,transparent) 0 1px,transparent 1px 26px)}
.lp-root.lp-t-supra .lp-b-nav{border-bottom:1px solid color-mix(in srgb,var(--lp-accent) 18%,transparent)}
.lp-root.lp-t-supra .lp-b-nav a{letter-spacing:.04em}
.lp-root.lp-t-supra .lp-b-hero .lp-h1{font-size:clamp(3rem,10.5cqi,8.6rem);background:linear-gradient(180deg,#fff6e2 0%,color-mix(in srgb,var(--lp-accent) 62%,#fff) 46%,var(--lp-accent) 100%);-webkit-background-clip:text;background-clip:text;color:transparent;caret-color:var(--lp-accent);filter:drop-shadow(0 0 26px color-mix(in srgb,var(--lp-accent) 38%,transparent))}
.lp-root.lp-t-supra .lp-b-hero .lp-lead{color:color-mix(in srgb,var(--lp-text) 88%,var(--lp-accent))}
.lp-root.lp-t-supra .lp-b-section .lp-h2{color:color-mix(in srgb,var(--lp-text) 90%,var(--lp-accent))}
.lp-root.lp-t-supra .lp-b-quote{font-family:var(--lp-font-h);font-size:1.18em}
.lp-root.lp-t-supra .lp-b-testimonials .lp-rich{font-family:var(--lp-font-h);font-style:italic;font-size:1.06em}
.lp-root.lp-t-supra .lp-b-faq summary{font-family:var(--lp-font-h);font-size:1.1em}
.lp-root.lp-t-supra .lp-b-faq summary::marker{color:var(--lp-accent)}
.lp-root.lp-t-supra .lp-b-works .lp-media{box-shadow:0 0 0 1px color-mix(in srgb,var(--lp-accent) 30%,transparent),0 22px 40px -22px rgba(0,0,0,.9)}
.lp-root.lp-t-supra .lp-b-gallery .lp-media{transition:box-shadow .35s var(--lp-ease)}
.lp-root.lp-t-supra .lp-b-gallery .lp-media:hover{box-shadow:0 0 0 1px color-mix(in srgb,var(--lp-accent) 55%,transparent),0 0 40px -10px color-mix(in srgb,var(--lp-accent) 55%,transparent)}
.lp-root.lp-t-supra .lp-b-team .lp-media-round{box-shadow:0 0 0 3px var(--lp-bg),0 0 0 4px color-mix(in srgb,var(--lp-accent) 62%,transparent),0 16px 30px -14px rgba(0,0,0,.85)}
.lp-root.lp-t-supra .lp-b-footer{border-top:1px solid color-mix(in srgb,var(--lp-accent) 22%,transparent);background-image:linear-gradient(180deg,color-mix(in srgb,var(--lp-accent2) 16%,transparent),transparent 65%)}
@container lp (max-width:600px){.lp-root.lp-t-supra .lp-eyebrow{letter-spacing:.16em}}
@container lp (max-width:600px){.lp-root.lp-t-supra .lp-b-hero .lp-h1{letter-spacing:0}}
@media (prefers-reduced-motion:reduce){.lp-root.lp-t-supra .lp-btn,.lp-root.lp-t-supra .lp-btn:hover{transition:none;transform:none}}
@media (prefers-reduced-motion:reduce){.lp-root.lp-t-supra .lp-card-hover,.lp-root.lp-t-supra .lp-card-hover:hover{transition:none;transform:none}}`,
};

export {
  THEME_SUPRA
};
