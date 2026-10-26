const THEME_QUIRE={key:'quire',vars:{accent:'#c8361f',accent2:'#2b3fbf',bg:'#faf8f3',surface:'#ffffff',text:'#141414',muted:'#5b5852',border:'#e2ddd2',fontBody:'serif',fontHead:'display',baseSize:18,lineHeight:1.6,radius:0,buttons:'square',headings:'normal',width:1180,space:'normal',scheme:'light',},css:`
.lp-root.lp-t-quire{--lp-hw:700;--lp-hk:1.06;--lp-mono:ui-monospace,"Cascadia Code","SF Mono",Menlo,Consolas,"DejaVu Sans Mono","Noto Sans Mono",monospace;scrollbar-color:var(--lp-text) transparent}
.lp-root.lp-t-quire ::selection{background:color-mix(in srgb,var(--lp-accent) 30%,transparent)}
.lp-root.lp-t-quire .lp-h{letter-spacing:-.012em}
.lp-root.lp-t-quire .lp-h1{line-height:1;letter-spacing:-.025em}
.lp-root.lp-t-quire .lp-h4{font-family:var(--lp-mono);font-size:.82em;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.lp-root.lp-t-quire .lp-eyebrow{gap:.5em;padding:.28em .62em;background:var(--lp-accent);color:var(--lp-on-accent);font-family:var(--lp-mono);font-size:.7em;font-weight:600;letter-spacing:.12em}
.lp-root.lp-t-quire .lp-sec-head{padding-top:18px;border-top:3px solid var(--lp-text)}
.lp-root.lp-t-quire .lp-sec-t em{font-style:italic;color:var(--lp-link)}
.lp-root.lp-t-quire .lp-lead{font-size:clamp(1.05rem,1rem + .35cqi,1.24rem);font-style:italic}
.lp-root.lp-t-quire .lp-rich a{text-decoration-color:var(--lp-accent);text-decoration-thickness:2px;text-underline-offset:.18em}
.lp-root.lp-t-quire .lp-rich li::marker{color:var(--lp-link);font-family:var(--lp-mono)}
.lp-root.lp-t-quire .lp-rich blockquote{border-inline-start:4px solid var(--lp-accent);font-style:italic}
.lp-root.lp-t-quire .lp-btn{font-family:var(--lp-mono);font-size:.84em;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.lp-root.lp-t-quire .lp-btn-primary,.lp-root.lp-t-quire .lp-btn-secondary{box-shadow:4px 4px 0 var(--lp-text);transition:transform .15s var(--lp-ease),box-shadow .15s var(--lp-ease)}
.lp-root.lp-t-quire .lp-btn-primary:hover,.lp-root.lp-t-quire .lp-btn-secondary:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 var(--lp-text)}
.lp-root.lp-t-quire .lp-btn-primary:active,.lp-root.lp-t-quire .lp-btn-secondary:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--lp-text)}
.lp-root.lp-t-quire .lp-btn-secondary{border:2px solid var(--lp-text);background:var(--lp-surface);color:var(--lp-text)}
.lp-root.lp-t-quire .lp-btn-sm{font-size:.74em}
.lp-root.lp-t-quire .lp-card{border-color:var(--lp-text);box-shadow:none}
.lp-root.lp-t-quire .lp-card-hover:is(:hover,:focus-within){transform:translate(-3px,-3px);border-color:var(--lp-text);box-shadow:6px 6px 0 var(--lp-accent2)}
.lp-root.lp-t-quire .lp-icbox{border:2px solid var(--lp-text);border-radius:0;background:transparent;color:var(--lp-link)}
.lp-root.lp-t-quire .lp-badge{border-radius:0;font-family:var(--lp-mono);font-weight:600;letter-spacing:.08em}
.lp-root.lp-t-quire .lp-chip{border-radius:0;border:1px solid var(--lp-border-s);background:transparent;font-family:var(--lp-mono);font-size:.74em}
.lp-root.lp-t-quire .lp-input{border:1.5px solid var(--lp-text);border-radius:0;background:var(--lp-surface)}
.lp-root.lp-t-quire .lp-input:focus{border-color:var(--lp-text);box-shadow:4px 4px 0 var(--lp-accent)}
.lp-root.lp-t-quire .lp-label{font-family:var(--lp-mono);font-size:.74em;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.lp-root.lp-t-quire .lp-att{border-color:var(--lp-text);border-radius:0}
.lp-root.lp-t-quire .lp-att-ic{border-radius:0;background:var(--lp-accent);color:var(--lp-on-accent)}
.lp-root.lp-t-quire .lp-totop{border-radius:0;border:2px solid var(--lp-text);box-shadow:3px 3px 0 var(--lp-text)}
.lp-root.lp-t-quire .lp-nav-brand{font-family:var(--lp-font-h);font-size:1.12em;font-style:italic;font-weight:700}
.lp-root.lp-t-quire .lp-nav-a{font-family:var(--lp-mono);font-size:.78em;letter-spacing:.08em;text-transform:uppercase}
.lp-root.lp-t-quire .lp-nav-a::after{height:2px;background:var(--lp-accent)}
.lp-root.lp-t-quire .lp-nav-sticky{border-bottom:2px solid var(--lp-text)}
.lp-root.lp-t-quire .lp-hero-t{font-size:clamp(2.6rem,1rem + 5.4cqi,5.6rem);line-height:.98;letter-spacing:-.03em}
.lp-root.lp-t-quire .lp-hero-media{border:2px solid var(--lp-text);box-shadow:10px 10px 0 var(--lp-accent)}
.lp-root.lp-t-quire .lp-hero::before{background:radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--lp-text) 14%,transparent) 1px,transparent 1.6px) 0 0/14px 14px;-webkit-mask:linear-gradient(115deg,transparent 45%,#000 85%);mask:linear-gradient(115deg,transparent 45%,#000 85%)}
.lp-root.lp-t-quire .lp-sec.lp-tone-muted{background-image:radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--lp-text) 9%,transparent) 1px,transparent 1.6px);background-size:12px 12px}
.lp-root.lp-t-quire .lp-sec.lp-tone-dark,.lp-root.lp-t-quire .lp-foot.lp-tone-dark{background-image:radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--lp-accent) 22%,transparent) 1px,transparent 1.7px);background-size:13px 13px}
.lp-root.lp-t-quire .lp-sec.lp-tone-dark .lp-sec-head,.lp-root.lp-t-quire .lp-sec.lp-tone-accent .lp-sec-head{border-top-color:var(--lp-text)}
.lp-root.lp-t-quire .lp-feat-t{font-family:var(--lp-font-h);font-size:1.3em;font-weight:700}
.lp-root.lp-t-quire .lp-feat-cards .lp-feat-i{border:1.5px solid var(--lp-text);box-shadow:6px 6px 0 color-mix(in srgb,var(--lp-text) 12%,transparent)}
.lp-root.lp-t-quire .lp-feat-ic{color:var(--lp-link)}
.lp-root.lp-t-quire .lp-feat-x ol{padding-inline-start:1.4em;font-family:var(--lp-font-h);font-size:1.08em;font-style:italic}
.lp-root.lp-t-quire .lp-stat-v{font-weight:700}
.lp-root.lp-t-quire .lp-step-n{font-family:var(--lp-font-h)}
.lp-root.lp-t-quire .lp-tm-cards .lp-tm-item{border:1.5px solid var(--lp-text);border-radius:0;box-shadow:6px 6px 0 color-mix(in srgb,var(--lp-text) 10%,transparent)}
.lp-root.lp-t-quire .lp-tm-photo img{filter:grayscale(1) contrast(1.08);transition:filter .4s var(--lp-ease)}
.lp-root.lp-t-quire .lp-tm-item:is(:hover,:focus-within) .lp-tm-photo img{filter:none}
.lp-root.lp-t-quire .lp-tm-name{font-family:var(--lp-font-h);font-size:1.2em;font-weight:700}
.lp-root.lp-t-quire .lp-tm-role{color:var(--lp-link);font-family:var(--lp-mono);font-size:.72em;letter-spacing:.04em}
.lp-root.lp-t-quire .lp-ts-fig.lp-card{border-width:1.5px;border-color:var(--lp-text)}
.lp-root.lp-t-quire .lp-ts-fig.lp-card::after{color:var(--lp-accent);font-family:var(--lp-font-h);opacity:1}
.lp-root.lp-t-quire .lp-ts-q{font-family:var(--lp-font-h);font-size:1.18em;font-style:italic;line-height:1.4}
.lp-root.lp-t-quire .lp-ts-name{font-family:var(--lp-mono);font-size:.82em;letter-spacing:.04em}
.lp-root.lp-t-quire .lp-star.lp-on{color:var(--lp-accent)}
.lp-root.lp-t-quire .lp-faq-item{border-radius:0}
.lp-root.lp-t-quire .lp-plans .lp-grid{gap:28px}
.lp-root.lp-t-quire .lp-plan{border:1.5px solid var(--lp-text);border-radius:0;background:var(--lp-surface)}
.lp-root.lp-t-quire .lp-plan:hover{transform:translate(-3px,-3px);box-shadow:6px 6px 0 var(--lp-text)}
.lp-root.lp-t-quire .lp-plan-feat{border-width:2px;background:var(--lp-surface);box-shadow:8px 8px 0 var(--lp-accent)}
.lp-root.lp-t-quire .lp-plan-feat .lp-plan-name{color:var(--lp-text)}
.lp-root.lp-t-quire .lp-plan-rib{border-radius:0;font-family:var(--lp-mono)}
.lp-root.lp-t-quire .lp-plan-name{font-family:var(--lp-mono);font-size:.9em;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.lp-root.lp-t-quire .lp-plan-body li::before{border-radius:0;background:var(--lp-text)}
.lp-root.lp-t-quire .lp-plan-body li::after{border-color:var(--lp-bg)}
.lp-root.lp-t-quire .lp-ev{border-radius:0}
.lp-root.lp-t-quire .lp-evs-cards .lp-ev{border:1.5px solid var(--lp-text);box-shadow:6px 6px 0 color-mix(in srgb,var(--lp-accent) 70%,transparent)}
.lp-root.lp-t-quire .lp-ev-date{border-radius:0;background:var(--lp-text);color:var(--lp-bg);box-shadow:inset 0 5px 0 var(--lp-accent)}
.lp-root.lp-t-quire .lp-ev-d{color:var(--lp-bg)}
.lp-root.lp-t-quire .lp-ev-m,.lp-root.lp-t-quire .lp-ev-w{color:var(--lp-bg);font-family:var(--lp-mono)}
.lp-root.lp-t-quire .lp-ev-title{font-family:var(--lp-font-h);font-size:1.25em}
.lp-root.lp-t-quire .lp-ev-st{border-radius:0;font-family:var(--lp-mono)}
.lp-root.lp-t-quire .lp-formb-card{border:1.5px solid var(--lp-text);border-radius:0;box-shadow:10px 10px 0 color-mix(in srgb,var(--lp-text) 12%,transparent)}
.lp-root.lp-t-quire .lp-formb-t{font-family:var(--lp-font-h);font-style:italic}
.lp-root.lp-t-quire .lp-ct-ic{border-radius:0;background:var(--lp-text);color:var(--lp-bg)}
.lp-root.lp-t-quire .lp-ct-k{font-family:var(--lp-mono);font-size:.72em;letter-spacing:.08em;text-transform:uppercase}
.lp-root.lp-t-quire .lp-foot-name{font-family:var(--lp-font-h);font-style:italic}
.lp-root.lp-t-quire .lp-foot-h{font-family:var(--lp-mono);letter-spacing:.12em}
.lp-root.lp-t-quire .lp-cartb-box,.lp-root.lp-t-quire .lp-cartb-co{border:1.5px solid var(--lp-text);border-radius:0;box-shadow:8px 8px 0 color-mix(in srgb,var(--lp-text) 10%,transparent)}
.lp-root.lp-t-quire .lp-cartb-h{font-family:var(--lp-font-h);font-style:italic}
.lp-root.lp-t-quire .lp-cl-title{font-family:var(--lp-font-h);font-weight:700}
.lp-root.lp-t-quire .lp-cl-sub{font-family:var(--lp-mono);font-size:.78em;letter-spacing:.02em}
.lp-root.lp-t-quire .lp-cl-card{border-color:var(--lp-text);border-radius:0}
.lp-root.lp-t-quire .lp-cl-card:hover{transform:translate(-3px,-3px);border-color:var(--lp-text);box-shadow:6px 6px 0 var(--lp-accent2)}
.lp-root.lp-t-quire .lp-cl-badge{background:var(--lp-accent);color:var(--lp-on-accent);box-shadow:none}
.lp-root.lp-t-quire .lp-cl-fab{border-radius:0;background:var(--lp-text);color:var(--lp-bg);box-shadow:3px 3px 0 var(--lp-accent)}
.lp-root.lp-t-quire .lp-cl-fab:hover{transform:translate(-2px,-2px);box-shadow:5px 5px 0 var(--lp-accent)}
.lp-root.lp-t-quire .lp-cl-file{border-radius:0;border-color:var(--lp-text);background:var(--lp-surface)}
.lp-root.lp-t-quire .lp-cl-v-shelf .lp-cl-book .lp-cl-cv{border-radius:0;box-shadow:7px 7px 0 color-mix(in srgb,var(--lp-text) 85%,transparent)}
.lp-root.lp-t-quire .lp-cl-v-shelf .lp-cl-book:hover .lp-cl-cv{transform:translate(-3px,-3px);box-shadow:10px 10px 0 var(--lp-accent)}
.lp-root.lp-t-quire .lp-cl-v-shelf .lp-cl-items{row-gap:clamp(30px,3.6cqi,48px)}
.lp-root.lp-t-quire .lp-cl-book .lp-cl-bk{padding-top:8px}
.lp-root.lp-t-quire .lp-cl-book .lp-cl-title{font-size:1.12em}
.lp-root.lp-t-quire .lp-cl-price .lp-price-now{font-family:var(--lp-mono);font-weight:600}
.lp-root.lp-t-quire .lp-cl-tbl{border:1.5px solid var(--lp-text);border-radius:0}
.lp-root.lp-t-quire .lp-cl-tbl th{background:var(--lp-text);color:var(--lp-bg);font-family:var(--lp-mono);letter-spacing:.08em;text-transform:uppercase}
.lp-root.lp-t-quire .lp-cl-thumb .lp-media{border-radius:0;box-shadow:3px 3px 0 var(--lp-text)}
.lp-root.lp-t-quire .lp-cl-q,.lp-root.lp-t-quire .lp-cl-pill,.lp-root.lp-t-quire .lp-cl-sel,.lp-root.lp-t-quire .lp-cl-chip,.lp-root.lp-t-quire .lp-cl-num{border-radius:0;border:1.5px solid var(--lp-text);background-color:var(--lp-surface)}
.lp-root.lp-t-quire .lp-cl-pill,.lp-root.lp-t-quire .lp-cl-sel,.lp-root.lp-t-quire .lp-cl-chip{font-family:var(--lp-mono);font-size:.8em;letter-spacing:.03em}
.lp-root.lp-t-quire .lp-cl-dd[open]>.lp-cl-pill,.lp-root.lp-t-quire .lp-cl-pill.lp-on{border-color:var(--lp-text);background:var(--lp-text);color:var(--lp-bg)}
.lp-root.lp-t-quire .lp-cl-chip[aria-pressed="true"]{border-color:var(--lp-accent);background:var(--lp-accent);color:var(--lp-on-accent)}
.lp-root.lp-t-quire .lp-cl-pop{border:1.5px solid var(--lp-text);border-radius:0;box-shadow:6px 6px 0 color-mix(in srgb,var(--lp-text) 15%,transparent)}
.lp-root.lp-t-quire .lp-cl-pn{border-radius:0;background:var(--lp-accent);color:var(--lp-on-accent)}
.lp-root.lp-t-quire .lp-cl-none{border-radius:0;border-color:var(--lp-text)}
.lp-root.lp-t-quire .lp-check-t .lp-req{color:var(--lp-link)}
.lp-root.lp-t-quire .lp-ev-st-few{color:var(--lp-text);background:color-mix(in srgb,#f59e0b 24%,transparent)}
@container lp (max-width:600px){.lp-root.lp-t-quire .lp-hero-media{box-shadow:6px 6px 0 var(--lp-accent)}}
@container lp (max-width:600px){.lp-root.lp-t-quire .lp-nav-brand{flex:0 1 auto;gap:9px;font-size:1.02em}.lp-root.lp-t-quire .lp-nav-name{line-height:1.12}}
@container lp (max-width:600px){.lp-root.lp-t-quire .lp-tools .lp-tb-lang{min-width:30px;padding-inline:6px}}
@container lp (max-width:430px){.lp-root.lp-t-quire .lp-tools .lp-tb-btn{display:none}}
@container lp (max-width:600px){.lp-root.lp-t-quire .lp-cl-v-shelf .lp-cl-book .lp-cl-cv{box-shadow:4px 4px 0 color-mix(in srgb,var(--lp-text) 85%,transparent)}}
@media (prefers-reduced-motion:reduce){.lp-root.lp-t-quire .lp-btn-primary,.lp-root.lp-t-quire .lp-btn-secondary{transition:none}}
@media (prefers-reduced-motion:reduce){.lp-root.lp-t-quire .lp-tm-photo img{transition:none}}`,};export{THEME_QUIRE};