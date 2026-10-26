const PT_CSS={base:`
.__P__-pt{position:relative;container:pt/inline-size;color:var(--pt-text,inherit);--pt-r:var(--pt-radius,10px);--pt-line:var(--pt-border,#d8dde6);--pt-soft:var(--pt-tint,color-mix(in srgb,var(--pt-accent,#2563eb) 9%,transparent));--pt-ok:color-mix(in srgb,#16a34a 78%,var(--pt-text,#111));--pt-warn:color-mix(in srgb,#d97706 82%,var(--pt-text,#111));--pt-bad:color-mix(in srgb,#dc2626 80%,var(--pt-text,#111))}
.__P__-pt *{box-sizing:border-box}
.__P__-pt :where(h2,h3,h4,h5,h6){margin:0;font-family:var(--pt-font-h,inherit);line-height:1.25;overflow-wrap:anywhere;text-wrap:balance}
.__P__-pt :where(p,dl,ul,ol){margin:0}
.__P__-pt [id]{scroll-margin-top:calc(var(--pt-top,0px) + 16px)}
.__P__-pt:not([data-pt-js]) .__P__-pt-js{display:none!important}
.__P__-pt [hidden]{display:none!important}
.__P__-pt-head{display:grid;gap:6px;margin-bottom:18px}
.__P__-pt-h{font-size:clamp(1.35em,1.1em + 1.2cqi,1.9em)}
.__P__-pt-h3{font-size:1.08em}
.__P__-pt-sub,.__P__-pt-muted{color:var(--pt-muted,#5b6574)}
.__P__-pt-small{font-size:.88em}
.__P__-pt-over{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:.78em;letter-spacing:.06em;text-transform:uppercase;color:var(--pt-muted,#5b6574)}
.__P__-pt-over:lang(ka){text-transform:none;letter-spacing:0}
.__P__-pt-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.__P__-pt-ic{width:1.05em;height:1.05em;flex:none;vertical-align:-.15em;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.__P__-pt-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:42px;padding:8px 16px;border:1px solid var(--pt-accent,#2563eb);border-radius:var(--pt-r);background:var(--pt-accent,#2563eb);color:var(--pt-on-accent,#fff);font:inherit;font-weight:600;line-height:1.2;text-decoration:none;cursor:pointer}
.__P__-pt-btn:hover{filter:brightness(1.07)}
.__P__-pt-btn2{background:transparent;color:var(--pt-accent,#2563eb)}
.__P__-pt-btn2:hover{background:var(--pt-soft)}
.__P__-pt-btn-sm{min-height:36px;padding:6px 12px;font-size:.92em}
.__P__-pt-link{border:0;background:none;padding:0;color:var(--pt-accent,#2563eb);font:inherit;text-decoration:underline;cursor:pointer}
.__P__-pt-badge{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:.78rem;font-weight:600;letter-spacing:0;text-transform:none;line-height:1.5;white-space:nowrap;background:var(--pt-soft);color:var(--pt-accent,#2563eb)}
.__P__-pt-b-force,.__P__-pt-b-open,.__P__-pt-b-available{background:color-mix(in srgb,var(--pt-ok) 13%,transparent);color:var(--pt-ok)}
.__P__-pt-b-amended,.__P__-pt-b-pending,.__P__-pt-b-progress,.__P__-pt-b-busy,.__P__-pt-b-new{background:color-mix(in srgb,var(--pt-warn) 14%,transparent);color:var(--pt-warn)}
.__P__-pt-b-repealed,.__P__-pt-b-closed,.__P__-pt-b-away{background:color-mix(in srgb,var(--pt-text,#111) 9%,transparent);color:var(--pt-muted,#5b6574)}
.__P__-pt-b-draft{background:transparent;border:1px dashed var(--pt-line);color:var(--pt-muted,#5b6574)}
.__P__-pt-b-tier{background:color-mix(in srgb,#b8860b 16%,transparent);color:color-mix(in srgb,#8a6100 80%,var(--pt-text,#111))}
.__P__-pt-chips{display:flex;flex-wrap:wrap;gap:6px}
.__P__-pt-chip{display:inline-flex;align-items:center;padding:3px 10px;border:1px solid var(--pt-line);border-radius:999px;font-size:.84em;background:none;color:inherit;font-family:inherit;cursor:default}
button.__P__-pt-chip,a.__P__-pt-chip{cursor:pointer;text-decoration:none}
button.__P__-pt-chip:hover,a.__P__-pt-chip:hover{border-color:var(--pt-accent,#2563eb);color:var(--pt-accent,#2563eb)}
.__P__-pt-pill{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--pt-soft);color:var(--pt-muted,#5b6574);font-size:.75em;font-weight:600;vertical-align:.12em}
.__P__-pt-card{background:var(--pt-surface,#fff);border:1px solid var(--pt-line);border-radius:var(--pt-r);padding:clamp(14px,2.4cqi,22px)}
.__P__-pt-callout{border:1px solid color-mix(in srgb,var(--pt-warn) 45%,transparent);background:color-mix(in srgb,var(--pt-warn) 8%,transparent);border-radius:var(--pt-r);padding:14px 18px;margin:0 0 18px}
.__P__-pt-callout .__P__-pt-h3{display:flex;align-items:center;gap:8px;margin-bottom:8px;color:var(--pt-warn)}
.__P__-pt-copy{display:inline-grid;place-items:center;width:30px;height:30px;margin-inline-start:6px;border:0;border-radius:8px;background:none;color:var(--pt-muted,#5b6574);cursor:pointer;opacity:.55;vertical-align:middle}
.__P__-pt-copy:hover,.__P__-pt-copy:focus-visible{opacity:1;background:var(--pt-soft);color:var(--pt-accent,#2563eb)}
.__P__-pt-copy[data-pt-copied]{opacity:1;color:var(--pt-ok)}
.__P__-pt-empty{padding:28px 12px;text-align:center;color:var(--pt-muted,#5b6574)}
.__P__-pt-morew{display:flex;justify-content:center;margin-top:18px}
.__P__-pt-rich>:first-child{margin-top:0}.__P__-pt-rich>:last-child{margin-bottom:0}
.__P__-pt-rich p{margin:0 0 .7em}
.__P__-pt-xref{text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px}
.__P__-pt-term{color:inherit;text-decoration:underline;text-decoration-style:dashed;text-decoration-color:color-mix(in srgb,var(--pt-accent,#2563eb) 60%,transparent);text-underline-offset:3px}
.__P__-pt-term:hover{color:var(--pt-accent,#2563eb)}
.__P__-pt-clamp{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
`,tools:`
.__P__-pt-tools{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px 12px;margin:0 0 18px;padding:12px;border:1px solid var(--pt-line);border-radius:var(--pt-r);background:var(--pt-surface,transparent)}
.__P__-pt-q{position:relative;display:flex;align-items:center;flex:1 1 240px;min-width:0}
.__P__-pt-q>.__P__-pt-ic{position:absolute;inset-inline-start:12px;color:var(--pt-muted,#5b6574);pointer-events:none}
.__P__-pt-qi{width:100%;min-height:42px;padding:8px 12px 8px 38px;border:1px solid var(--pt-line);border-radius:calc(var(--pt-r) - 2px);background:var(--pt-bg,#fff);color:inherit;font:inherit}
.__P__-pt-qi:focus{outline:2px solid var(--pt-accent,#2563eb);outline-offset:1px}
.__P__-pt-fl{display:grid;gap:3px;flex:0 1 190px;min-width:0;font-size:.85em}
.__P__-pt-fll{color:var(--pt-muted,#5b6574)}
.__P__-pt-sel{width:100%;min-height:42px;padding:6px 10px;border:1px solid var(--pt-line);border-radius:calc(var(--pt-r) - 2px);background:var(--pt-bg,#fff);color:inherit;font:inherit;font-size:1.05em}
.__P__-pt-count{flex:1 1 100%;margin:0;font-size:.88em;color:var(--pt-muted,#5b6574)}
.__P__-pt-reset{border:0;background:none;padding:0;color:var(--pt-accent,#2563eb);font:inherit;font-size:.88em;text-decoration:underline;cursor:pointer}
.__P__-pt-tabs{display:flex;flex-wrap:wrap;gap:6px;flex:1 1 100%}
.__P__-pt-tab{min-height:38px;padding:6px 14px;border:1px solid var(--pt-line);border-radius:999px;background:none;color:inherit;font:inherit;font-weight:600;cursor:pointer}
.__P__-pt-tab span{color:var(--pt-muted,#5b6574);font-weight:400}
.__P__-pt-tab[aria-pressed=true]{background:var(--pt-accent,#2563eb);border-color:var(--pt-accent,#2563eb);color:var(--pt-on-accent,#fff)}
.__P__-pt-tab[aria-pressed=true] span{color:inherit;opacity:.8}
@container pt (max-width:560px){.__P__-pt-fl{flex:1 1 100%}}
`,toc:`
.__P__-pt-toc{font-size:.92em}
.__P__-pt-toch{cursor:pointer;font-weight:700;padding:6px 0;list-style-position:inside}
.__P__-pt-tocl,.__P__-pt-tocl ol{list-style:none;margin:0;padding:0}
.__P__-pt-tocl ol{padding-inline-start:12px;border-inline-start:1px solid var(--pt-line);margin:2px 0 6px 4px}
.__P__-pt-tocl a{display:block;padding:4px 8px;border-radius:6px;color:inherit;text-decoration:none;line-height:1.35}
.__P__-pt-tocl a:hover{background:var(--pt-soft)}
.__P__-pt-tocl a[aria-current]{background:var(--pt-soft);color:var(--pt-accent,#2563eb);font-weight:600;box-shadow:inset 3px 0 0 var(--pt-accent,#2563eb)}
.__P__-pt-tg>a{font-weight:600}
.__P__-pt-tn{display:inline-block;min-width:2.6em;font-variant-numeric:tabular-nums;color:var(--pt-accent,#2563eb);font-weight:600}
.__P__-pt-tl.__P__-pt-gone>a{color:var(--pt-muted,#5b6574)}
.__P__-pt-actb{display:grid;gap:24px}
.__P__-pt-toc-side{grid-template-columns:minmax(13rem,17rem) minmax(0,1fr);align-items:start}
.__P__-pt-toc-side>.__P__-pt-toc{position:sticky;top:calc(var(--pt-top,0px) + 12px);max-height:calc(100vh - var(--pt-top,0px) - 24px);overflow:auto;padding:10px;border:1px solid var(--pt-line);border-radius:var(--pt-r);background:var(--pt-surface,transparent)}
.__P__-pt-toc-top>.__P__-pt-toc{padding:10px 14px;border:1px solid var(--pt-line);border-radius:var(--pt-r)}
.__P__-pt-toc-top .__P__-pt-tocl{columns:2 16rem;column-gap:24px}
@container pt (max-width:760px){.__P__-pt-toc-side{grid-template-columns:minmax(0,1fr)}.__P__-pt-toc-side>.__P__-pt-toc{position:static;max-height:none}.__P__-pt-toc-top .__P__-pt-tocl{columns:1}}
`,act:`
.__P__-pt-acth{display:grid;gap:10px;padding-bottom:18px;margin-bottom:18px;border-bottom:1px solid var(--pt-line)}
.__P__-pt-actt{font-size:clamp(1.4em,1.1em + 1.5cqi,2.1em)}
.__P__-pt-kind{font-weight:700;color:var(--pt-accent,#2563eb)}
.__P__-pt-num{font-variant-numeric:tabular-nums}
.__P__-pt-meta{display:flex;flex-wrap:wrap;gap:6px 22px;font-size:.92em}
.__P__-pt-meta>div{display:flex;gap:6px}
.__P__-pt-meta dt{color:var(--pt-muted,#5b6574)}
.__P__-pt-meta dd{margin:0;font-weight:600}
.__P__-pt-acts{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.__P__-pt-succ{padding:8px 12px;border-radius:var(--pt-r);background:var(--pt-soft)}
.__P__-pt-summary{margin-bottom:18px}
.__P__-pt-summary .__P__-pt-h3{margin-bottom:8px}
.__P__-pt-chl{display:grid;gap:6px;padding-inline-start:18px}
.__P__-pt-chl time{font-weight:700;font-variant-numeric:tabular-nums}
.__P__-pt-units{display:grid;gap:4px}
.__P__-pt-grp{display:grid;gap:4px;margin-top:14px}
.__P__-pt-gh{padding:10px 0 6px;font-size:1.12em}
.__P__-pt-gl{display:block;font-size:.72em;letter-spacing:.08em;text-transform:uppercase;color:var(--pt-muted,#5b6574)}
.__P__-pt-gl:lang(ka){text-transform:none;letter-spacing:0}
.__P__-pt-art{padding:14px 0 16px;border-top:1px solid var(--pt-line)}
.__P__-pt-arth{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;font-size:1.04em;margin-bottom:8px}
.__P__-pt-artn{color:var(--pt-accent,#2563eb);text-decoration:none;font-variant-numeric:tabular-nums;white-space:nowrap}
.__P__-pt-artn:hover{text-decoration:underline}
.__P__-pt-artt{font-weight:600}
.__P__-pt-gone .__P__-pt-artt,.__P__-pt-gone>.__P__-pt-px,li.__P__-pt-gone{color:var(--pt-muted,#5b6574);font-style:italic}
.__P__-pt-note{margin:-2px 0 8px;font-size:.86em;color:var(--pt-muted,#5b6574)}
.__P__-pt-body{display:grid;gap:8px;max-width:72ch;line-height:1.75}
.__P__-pt-para{position:relative}
.__P__-pt-pn{font-weight:700;color:inherit;text-decoration:none;font-variant-numeric:tabular-nums}
.__P__-pt-pn:hover{color:var(--pt-accent,#2563eb)}
.__P__-pt-subs{list-style:none;margin:6px 0 0;padding-inline-start:clamp(14px,3cqi,28px);display:grid;gap:4px}
.__P__-pt-sn{font-weight:600;margin-inline-end:2px}
.__P__-pt-txt{padding:10px 0;max-width:72ch}
.__P__-pt-art:target,.__P__-pt-para:target,.__P__-pt-subs>li:target{background:var(--pt-soft);border-radius:6px;box-shadow:0 0 0 6px var(--pt-soft)}
.__P__-pt-doc{display:inline-flex;align-items:center;gap:10px;padding:6px 12px 6px 6px;border:1px solid var(--pt-line);border-radius:var(--pt-r);color:inherit;text-decoration:none;background:var(--pt-surface,transparent)}
.__P__-pt-doc:hover{border-color:var(--pt-accent,#2563eb)}
.__P__-pt-doci{display:grid;place-items:center;width:38px;height:44px;border-radius:6px;background:color-mix(in srgb,var(--pt-bad) 14%,transparent);color:var(--pt-bad);font-size:.7em;font-weight:800}
.__P__-pt-docb{display:grid;line-height:1.25}
.__P__-pt-docb small{color:var(--pt-muted,#5b6574);overflow-wrap:anywhere}
`,az:`
.__P__-pt-az{position:sticky;top:var(--pt-top,0px);z-index:2;display:flex;gap:2px;overflow-x:auto;margin:0 0 16px;padding:6px;border:1px solid var(--pt-line);border-radius:var(--pt-r);background:var(--pt-bg,#fff);scrollbar-width:thin}
.__P__-pt-az>*{display:grid;place-items:center;flex:none;min-width:34px;height:34px;padding:0 6px;border-radius:7px;font-weight:700;text-decoration:none;color:inherit}
.__P__-pt-az>a:hover{background:var(--pt-soft)}
.__P__-pt-az>a[aria-current]{background:var(--pt-accent,#2563eb);color:var(--pt-on-accent,#fff)}
.__P__-pt-az>[aria-disabled]{color:var(--pt-muted,#5b6574);opacity:.4;pointer-events:none}
.__P__-pt-letter{margin:0 0 22px}
.__P__-pt-lh{display:flex;align-items:baseline;gap:10px;margin:0 0 10px;padding-bottom:6px;border-bottom:2px solid transparent;border-image:linear-gradient(90deg,var(--pt-accent,#2563eb),transparent) 1;font-size:1.6em}
.__P__-pt-lh small{font-size:.5em;color:var(--pt-muted,#5b6574);font-weight:600}
`,terms:`
.__P__-pt-tl-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,19rem),1fr));gap:12px}
.__P__-pt-tl-list{display:grid;gap:0}
.__P__-pt-tl-list>.__P__-pt-tcard{border:0;border-bottom:1px solid var(--pt-line);border-radius:0;background:none;padding:12px 0}
.__P__-pt-tl-columns{columns:2 18rem;column-gap:28px}
.__P__-pt-tl-columns>.__P__-pt-tcard{break-inside:avoid;border:0;background:none;padding:6px 0 12px}
.__P__-pt-tcard{display:grid;gap:8px;align-content:start;padding:16px;border:1px solid var(--pt-line);border-radius:var(--pt-r);background:var(--pt-surface,transparent)}
.__P__-pt-tt{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:1.08em}
.__P__-pt-tt dfn{font-style:normal}
.__P__-pt-alt{font-size:.88em;color:var(--pt-muted,#5b6574)}
.__P__-pt-def{display:grid;gap:4px;padding-inline-start:12px;border-inline-start:3px solid var(--pt-soft)}
.__P__-pt-def+.__P__-pt-def{margin-top:6px}
.__P__-pt-dtext{line-height:1.7;max-width:70ch}
.__P__-pt-dsrc,.__P__-pt-rel{font-size:.86em}
.__P__-pt-dsrc>span,.__P__-pt-rel>span{color:var(--pt-muted,#5b6574)}
.__P__-pt-tcard:target{outline:2px solid var(--pt-accent,#2563eb);outline-offset:2px}
`,cards:`
.__P__-pt-grid{display:grid;grid-template-columns:repeat(var(--pt-cols,3),minmax(0,1fr));gap:14px}
.__P__-pt-v-list>.__P__-pt-grid,.__P__-pt-grid.__P__-pt-v-list{grid-template-columns:minmax(0,1fr)}
.__P__-pt-v-compact .__P__-pt-grid,.__P__-pt-grid.__P__-pt-v-compact{grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),1fr))}
@container pt (max-width:900px){.__P__-pt-grid{grid-template-columns:repeat(min(var(--pt-cols,3),2),minmax(0,1fr))}}
@container pt (max-width:560px){.__P__-pt-grid{grid-template-columns:minmax(0,1fr)}}
.__P__-pt-cn{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:1.06em}
.__P__-pt-cf{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:12px;border-top:1px solid var(--pt-line)}
.__P__-pt-card:target{outline:2px solid var(--pt-accent,#2563eb);outline-offset:2px}
`,dir:`
.__P__-pt-pc{display:flex;flex-direction:column;gap:12px;padding:0;overflow:hidden;transition:transform .15s ease,box-shadow .15s ease}
.__P__-pt-pc:hover{transform:translateY(-2px);box-shadow:var(--pt-shadow,0 10px 30px rgba(15,23,42,.1))}
.__P__-pt-ph{position:relative;display:grid;place-items:center;aspect-ratio:16/10;background:var(--pt-soft);overflow:hidden}
.__P__-pt-phi{width:100%;height:100%;object-fit:cover;display:block}
.__P__-pt-ph0>span{font:700 2.2em/1 var(--pt-font-h,inherit);color:var(--pt-accent,#2563eb)}
.__P__-pt-k-firm .__P__-pt-ph,.__P__-pt-k-org .__P__-pt-ph{aspect-ratio:16/8}
.__P__-pt-k-firm .__P__-pt-phi,.__P__-pt-k-org .__P__-pt-phi{object-fit:contain;padding:18px;background:var(--pt-bg,#fff)}
.__P__-pt-newb{position:absolute;top:10px;inset-inline-start:10px;padding:2px 9px;border-radius:999px;background:#c99a2e;color:#1c1405;font-size:.72em;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.__P__-pt-cb{display:grid;gap:6px;padding:0 16px}
.__P__-pt-pc>.__P__-pt-cf{margin:0 16px 16px}
.__P__-pt-role{color:var(--pt-muted,#5b6574);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden}
.__P__-pt-areas{font-size:.9em;font-weight:600;color:var(--pt-accent,#2563eb);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.__P__-pt-facts{display:flex;flex-wrap:wrap;gap:4px 14px;list-style:none;padding:0;font-size:.88em}
.__P__-pt-facts li{display:inline-flex;align-items:center;gap:5px}
.__P__-pt-stars{position:relative;display:inline-block;color:color-mix(in srgb,var(--pt-text,#111) 18%,transparent);letter-spacing:1px;font-size:.95em;line-height:1}
.__P__-pt-stars::after{content:"★★★★★";position:absolute;inset:0;width:var(--pt-st,0);overflow:hidden;color:#e0a100;white-space:nowrap}
.__P__-pt-ver{display:inline-block;position:relative}
.__P__-pt-ver>summary{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--pt-ok);color:#fff;cursor:pointer;list-style:none}
.__P__-pt-ver>summary::-webkit-details-marker{display:none}
.__P__-pt-ver>summary .__P__-pt-ic{width:14px;height:14px;stroke-width:3}
.__P__-pt-verp{position:absolute;z-index:3;top:28px;inset-inline-start:-8px;width:min(16rem,70cqi);padding:10px 12px;border:1px solid var(--pt-line);border-radius:8px;background:var(--pt-bg,#fff);box-shadow:var(--pt-shadow,0 10px 30px rgba(15,23,42,.14));font-size:.85rem;font-weight:400}
.__P__-pt-bio{font-size:.92em;color:var(--pt-muted,#5b6574)}
.__P__-pt-contacts{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:.9em}
.__P__-pt-contacts a{display:inline-flex;align-items:center;gap:5px}
.__P__-pt-mask .__P__-pt-real{display:none}
.__P__-pt:not([data-pt-js]) .__P__-pt-mask .__P__-pt-real,.__P__-pt-mask[data-pt-shown] .__P__-pt-real{display:inline-flex}
.__P__-pt-mask[data-pt-shown] .__P__-pt-masked,.__P__-pt-mask[data-pt-shown] [data-pt-reveal]{display:none}
.__P__-pt-masked{font-variant-numeric:tabular-nums;color:var(--pt-muted,#5b6574)}
.__P__-pt-price{display:grid;font-weight:700;font-size:1.05em}
.__P__-pt-price small{font-weight:400;font-size:.76em;color:var(--pt-muted,#5b6574)}
.__P__-pt-v-list .__P__-pt-pc{flex-direction:row;align-items:stretch}
.__P__-pt-v-list .__P__-pt-ph{flex:0 0 clamp(96px,22cqi,180px);aspect-ratio:auto}
.__P__-pt-v-list .__P__-pt-cb{flex:1;padding:16px 0}
.__P__-pt-v-list .__P__-pt-pc>.__P__-pt-cf{flex:0 0 auto;flex-direction:column;align-items:flex-end;justify-content:center;border:0;margin:16px}
.__P__-pt-v-compact .__P__-pt-pc{flex-direction:row;align-items:center;gap:12px;padding:12px}
.__P__-pt-v-compact .__P__-pt-ph{flex:0 0 48px;width:48px;height:48px;aspect-ratio:1;border-radius:50%}
.__P__-pt-v-compact .__P__-pt-ph0>span{font-size:1em}
.__P__-pt-v-compact .__P__-pt-newb,.__P__-pt-v-compact .__P__-pt-areas,.__P__-pt-v-compact .__P__-pt-chips,.__P__-pt-v-compact .__P__-pt-contacts,.__P__-pt-v-compact .__P__-pt-pc>.__P__-pt-cf{display:none}
.__P__-pt-v-compact .__P__-pt-cb{padding:0}
@container pt (max-width:560px){.__P__-pt-v-list .__P__-pt-pc{flex-direction:column}.__P__-pt-v-list .__P__-pt-ph{flex-basis:auto;aspect-ratio:16/9}.__P__-pt-v-list .__P__-pt-cb{padding:0 16px}.__P__-pt-v-list .__P__-pt-pc>.__P__-pt-cf{align-items:stretch;flex-direction:row;margin:0 16px 16px;border-top:1px solid var(--pt-line)}}
`,board:`
.__P__-pt-rqtop{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin:0 0 16px}
.__P__-pt-big{display:flex;align-items:baseline;gap:10px;font-size:1.05em;color:var(--pt-muted,#5b6574)}
.__P__-pt-big b{font:800 clamp(2em,1.4em + 2.4cqi,3.2em)/1 var(--pt-font-h,inherit);color:var(--pt-text,inherit);font-variant-numeric:tabular-nums}
.__P__-pt-rq{display:flex;flex-direction:column;gap:10px}
.__P__-pt-rqh{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:.88em}
.__P__-pt-cat{color:var(--pt-muted,#5b6574);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.__P__-pt-rqb{color:var(--pt-muted,#5b6574);font-size:.94em}
.__P__-pt-rqm{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:.88em}
.__P__-pt-rqm>div{display:flex;gap:5px;align-items:center}
.__P__-pt-rqm dt{color:var(--pt-muted,#5b6574)}
.__P__-pt-rqm dd{margin:0;display:inline-flex;align-items:center;gap:5px}
.__P__-pt-money{font-weight:700}
.__P__-pt-rqm time[data-pt-soon="1"],.__P__-pt-warn{color:var(--pt-warn);font-weight:600}
.__P__-pt-resp{font-size:.86em;color:var(--pt-muted,#5b6574)}
.__P__-pt-resp0::before{content:"";display:inline-block;width:8px;height:8px;margin-inline-end:6px;border-radius:50%;background:var(--pt-warn);vertical-align:.05em}
.__P__-pt-match{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 10px;border-radius:8px;background:var(--pt-soft);font-size:.86em}
.__P__-pt-matchh{color:var(--pt-muted,#5b6574)}
.__P__-pt-mini{display:inline-flex;align-items:center;gap:6px;padding:2px 8px 2px 2px;border-radius:999px;background:var(--pt-bg,#fff);color:inherit;text-decoration:none;font-weight:600}
.__P__-pt-avi{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;object-fit:cover;background:var(--pt-soft);font-size:.7em;color:var(--pt-accent,#2563eb)}
.__P__-pt-rs-closed{opacity:.72}
.__P__-pt-v-list .__P__-pt-rq .__P__-pt-rqb{display:block}
`,hub:`
.__P__-pt-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,9rem),1fr));gap:10px;margin:0 0 20px}
.__P__-pt-stats>div{display:flex;flex-direction:column-reverse;gap:2px;padding:14px 16px;border:1px solid var(--pt-line);border-radius:var(--pt-r);background:var(--pt-surface,transparent);box-shadow:inset 3px 0 0 var(--pt-accent,#2563eb)}
.__P__-pt-stats dt{font-size:.85em;color:var(--pt-muted,#5b6574)}
.__P__-pt-stats dd{margin:0;font:800 1.9em/1 var(--pt-font-h,inherit);font-variant-numeric:tabular-nums}
.__P__-pt-hgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr));gap:14px}
.__P__-pt-hs{padding:16px;border:1px solid var(--pt-line);border-radius:var(--pt-r);background:var(--pt-surface,transparent)}
.__P__-pt-hs .__P__-pt-h3{margin-bottom:10px}
.__P__-pt-hl{list-style:none;padding:0;display:grid;gap:8px}
.__P__-pt-hl li{display:grid;gap:1px}
.__P__-pt-hl small{color:var(--pt-muted,#5b6574);font-size:.84em}
.__P__-pt-lead{max-width:70ch;color:var(--pt-muted,#5b6574)}
.__P__-pt-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr));gap:12px}
.__P__-pt-tile{display:grid;gap:6px;align-content:start;padding:16px;border:1px solid var(--pt-line);border-radius:var(--pt-r);background:var(--pt-surface,transparent);color:inherit;text-decoration:none;transition:border-color .15s ease,transform .15s ease}
a.__P__-pt-tile:hover{border-color:var(--pt-accent,#2563eb);transform:translateY(-2px)}
.__P__-pt-tile-t{font-weight:700;font-family:var(--pt-font-h,inherit)}
.__P__-pt-tile-x{font-size:.9em;color:var(--pt-muted,#5b6574)}
.__P__-pt-tile-n{font-size:.8em;font-weight:600;color:var(--pt-accent,#2563eb)}
`,check:`
.__P__-pt-prog{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:0 0 14px}
.__P__-pt-prog progress{flex:1 1 200px;height:10px;accent-color:var(--pt-accent,#2563eb)}
.__P__-pt-ckl-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.__P__-pt-ckg{padding-top:10px}
.__P__-pt-cki{display:grid;gap:6px;padding:12px 14px;border:1px solid var(--pt-line);border-radius:var(--pt-r);background:var(--pt-surface,transparent)}
.__P__-pt-ckl{display:flex;align-items:flex-start;gap:10px;font-weight:600;cursor:pointer}
.__P__-pt-ckl input{flex:none;width:20px;height:20px;margin:2px 0 0;accent-color:var(--pt-accent,#2563eb)}
.__P__-pt-cki:has(input:checked) .__P__-pt-ckl span{text-decoration:line-through;text-decoration-color:var(--pt-muted,#5b6574);color:var(--pt-muted,#5b6574)}
.__P__-pt-ckb,.__P__-pt-ckm{padding-inline-start:30px;font-size:.92em}
.__P__-pt-ckm>span{color:var(--pt-muted,#5b6574)}
`,find:`
.__P__-pt-ff{display:flex;gap:8px;margin:0 0 12px}
.__P__-pt-ff .__P__-pt-q{flex:1}
.__P__-pt-sugg{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 14px;font-size:.9em}
.__P__-pt-sugg>span:first-child{color:var(--pt-muted,#5b6574)}
.__P__-pt-ftabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
.__P__-pt-ftabs button{min-height:36px;padding:5px 12px;border:1px solid var(--pt-line);border-radius:999px;background:none;color:inherit;font:inherit;font-weight:600;cursor:pointer}
.__P__-pt-ftabs button span{color:var(--pt-muted,#5b6574);font-weight:400}
.__P__-pt-ftabs button[aria-pressed=true]{background:var(--pt-accent,#2563eb);border-color:var(--pt-accent,#2563eb);color:var(--pt-on-accent,#fff)}
.__P__-pt-ftabs button[aria-pressed=true] span{color:inherit}
.__P__-pt-fgroups{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 10px;font-size:.86em;color:var(--pt-muted,#5b6574)}
.__P__-pt-fgroups [data-pt-chip]{padding:2px 9px;border-radius:999px;background:var(--pt-soft);color:var(--pt-text,inherit)}
.__P__-pt-fres{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.__P__-pt-fres li{display:grid;gap:3px;padding:12px 14px;border:1px solid var(--pt-line);border-radius:var(--pt-r);background:var(--pt-surface,transparent)}
.__P__-pt-fres [data-pt-kind]{font-size:.72em;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--pt-accent,#2563eb)}
.__P__-pt-fres a{font-weight:700}
.__P__-pt-fres small{color:var(--pt-muted,#5b6574)}
.__P__-pt-fres p{font-size:.92em;color:var(--pt-muted,#5b6574)}
.__P__-pt-fres mark,.__P__-pt-fres a mark{background:color-mix(in srgb,#facc15 45%,transparent);color:inherit;border-radius:2px}
`,tips:`
[data-pt-pop]{position:absolute;z-index:40;width:max-content;max-width:min(22rem,calc(100% - 16px));padding:10px 12px;border:1px solid var(--pt-line,#d8dde6);border-radius:10px;background:var(--pt-bg,#fff);color:var(--pt-text,#111);box-shadow:var(--pt-shadow,0 12px 32px rgba(15,23,42,.18));font-size:.9rem;line-height:1.5;pointer-events:none}
[data-pt-pop] b{display:block;margin-bottom:2px}
`,print:`
@media print{html[data-pt-print] body *{visibility:hidden}html[data-pt-print] [data-pt-printing],html[data-pt-print] [data-pt-printing] *{visibility:visible}html[data-pt-print] [data-pt-printing]{position:absolute;inset:0 0 auto 0}
.__P__-pt-js,.__P__-pt-copy,.__P__-pt-toc,.__P__-pt-tools,.__P__-pt-az{display:none!important}.__P__-pt-actb{display:block}.__P__-pt-art{break-inside:avoid-page}.__P__-pt [hidden]{display:block!important}}
`,};const PT_TYPE_CHUNKS={act:['base','tools','toc','act','tips','print'],terms:['base','tools','az','terms','tips'],directory:['base','tools','az','cards','dir'],board:['base','tools','cards','board'],hub:['base','hub'],checklist:['base','check','tips'],finder:['base','tools','find'],};const ORDER=Object.keys(PT_CSS);function portalCSS(prefix,types){const want=new Set();if(!types)for(const k of ORDER)want.add(k);else for(const t of types)for(const c of PT_TYPE_CHUNKS[t]||[])want.add(c);return ORDER.filter((k)=>want.has(k)).map((k)=>PT_CSS[k]).join('').replace(/__P__/g,prefix).trim()+'\n';}
export{portalCSS};