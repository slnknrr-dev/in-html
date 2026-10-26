const THEME_FOLIO={key:'folio',vars:{accent:'#0e5a6b',accent2:'#d39a35',bg:'#f7f2e8',surface:'#fffcf6',text:'#132a30',muted:'#56605f',border:'#e3dbca',fontBody:'humanist',fontHead:'slab',baseSize:17,lineHeight:1.62,radius:10,buttons:'pill',headings:'normal',width:1200,space:'normal',scheme:'light',},css:`
.lp-root.lp-t-folio{--lp-hw:700;--lp-hk:1;--lp-wood:color-mix(in srgb,var(--lp-accent2) 46%,#5b3a1e);scrollbar-color:color-mix(in srgb,var(--lp-accent) 45%,transparent) transparent}
.lp-root.lp-t-folio ::selection{background:color-mix(in srgb,var(--lp-accent2) 40%,transparent)}
.lp-root.lp-t-folio .lp-h{letter-spacing:-.01em}
.lp-root.lp-t-folio .lp-h1{line-height:1.06;letter-spacing:-.02em}
.lp-root.lp-t-folio .lp-h4{font-family:var(--lp-font);font-weight:700}
.lp-root.lp-t-folio .lp-eyebrow{gap:.7em;color:var(--lp-link);font-size:.72em;font-weight:750;letter-spacing:.16em}
.lp-root.lp-t-folio .lp-eyebrow::before{content:"";flex:none;width:.62em;height:1.05em;background:var(--lp-accent2);clip-path:polygon(0 0,100% 0,100% 100%,50% 74%,0 100%)}
.lp-root.lp-t-folio .lp-sec-t::after{content:"";display:block;width:60px;height:7px;margin-top:.42em;border-top:3px solid var(--lp-accent2);border-bottom:1px solid var(--lp-accent2)}
.lp-root.lp-t-folio .lp-sec-a-center .lp-sec-t::after{margin-inline:auto}
.lp-root.lp-t-folio .lp-lead{font-size:clamp(1.04rem,1rem + .3cqi,1.2rem)}
.lp-root.lp-t-folio .lp-rich a{text-decoration-color:color-mix(in srgb,var(--lp-accent2) 75%,transparent);text-decoration-thickness:2px;text-underline-offset:.2em}
.lp-root.lp-t-folio .lp-rich li::marker{color:var(--lp-accent2)}
.lp-root.lp-t-folio .lp-rich blockquote{border-inline-start:3px solid var(--lp-accent2);font-style:italic}
.lp-root.lp-t-folio .lp-btn{font-weight:700;letter-spacing:.01em}
.lp-root.lp-t-folio:not(.lp-btn-outline) .lp-btn-primary{box-shadow:inset 0 -3px 0 color-mix(in srgb,#000 18%,transparent),0 10px 22px -14px var(--lp-accent)}
.lp-root.lp-t-folio:not(.lp-btn-outline) .lp-btn-primary:hover{box-shadow:inset 0 -3px 0 color-mix(in srgb,#000 22%,transparent),0 14px 28px -14px var(--lp-accent)}
.lp-root.lp-t-folio .lp-btn-secondary{border-color:color-mix(in srgb,var(--lp-accent) 40%,var(--lp-border-s));background:color-mix(in srgb,var(--lp-surface) 80%,transparent)}
.lp-root.lp-t-folio .lp-btn-secondary:hover{border-color:var(--lp-accent2);background:color-mix(in srgb,var(--lp-accent2) 12%,var(--lp-bg));color:var(--lp-text)}
.lp-root.lp-t-folio .lp-card{box-shadow:0 1px 0 color-mix(in srgb,var(--lp-text) 6%,transparent),0 14px 30px -24px color-mix(in srgb,var(--lp-text) 45%,transparent)}
.lp-root.lp-t-folio .lp-card-hover:is(:hover,:focus-within){border-color:color-mix(in srgb,var(--lp-accent2) 60%,var(--lp-border));box-shadow:inset 0 3px 0 var(--lp-accent2),0 22px 40px -26px color-mix(in srgb,var(--lp-text) 55%,transparent)}
.lp-root.lp-t-folio .lp-icbox{border-radius:12px;background:color-mix(in srgb,var(--lp-accent2) 22%,transparent);color:var(--lp-link)}
.lp-root.lp-t-folio .lp-badge{padding-inline-end:1.15em;border-radius:3px 0 0 3px;background:var(--lp-accent2);color:var(--lp-on-accent2);clip-path:polygon(0 0,100% 0,calc(100% - .5em) 50%,100% 100%,0 100%)}
.lp-root.lp-t-folio .lp-chip{border-radius:6px;background:color-mix(in srgb,var(--lp-accent) 9%,transparent)}
.lp-root.lp-t-folio .lp-input{border-radius:8px;background:var(--lp-surface)}
.lp-root.lp-t-folio .lp-input:focus{border-color:var(--lp-link);box-shadow:0 0 0 4px color-mix(in srgb,var(--lp-accent2) 30%,transparent)}
.lp-root.lp-t-folio .lp-label{font-weight:650}
.lp-root.lp-t-folio .lp-att-ic{border-radius:10px;background:color-mix(in srgb,var(--lp-accent2) 22%,transparent)}
.lp-root.lp-t-folio .lp-totop{border-color:color-mix(in srgb,var(--lp-accent2) 60%,transparent)}
.lp-root.lp-t-folio .lp-nav-brand{font-family:var(--lp-font-h);font-weight:700;letter-spacing:-.01em}
.lp-root.lp-t-folio .lp-nav-a{font-weight:600}
.lp-root.lp-t-folio .lp-nav-a::after{height:3px;border-radius:2px;background:var(--lp-accent2)}
.lp-root.lp-t-folio .lp-nav-sticky{border-bottom-color:color-mix(in srgb,var(--lp-accent2) 35%,var(--lp-border))}
.lp-root.lp-t-folio .lp-hero::before{background:radial-gradient(60% 70% at 85% 30%,color-mix(in srgb,var(--lp-accent2) 20%,transparent),transparent 70%)}
.lp-root.lp-t-folio .lp-hero-t{font-size:clamp(2.3rem,1rem + 4.2cqi,4.4rem);line-height:1.04;letter-spacing:-.025em}
.lp-root.lp-t-folio .lp-hero-badge{border-color:color-mix(in srgb,var(--lp-accent2) 65%,transparent);background:color-mix(in srgb,var(--lp-accent2) 16%,transparent)}
.lp-root.lp-t-folio .lp-hero-badge::before{background:var(--lp-accent2);box-shadow:0 0 0 .25em color-mix(in srgb,var(--lp-accent2) 30%,transparent)}
.lp-root.lp-t-folio .lp-hero-media{border:10px solid var(--lp-surface);border-radius:calc(var(--lp-radius) * 1.4);box-shadow:0 0 0 1px var(--lp-border),0 34px 60px -34px color-mix(in srgb,var(--lp-text) 60%,transparent)}
.lp-root.lp-t-folio .lp-sec.lp-tone-muted{background-image:repeating-linear-gradient(180deg,transparent 0 33px,color-mix(in srgb,var(--lp-link) 5%,transparent) 33px 34px)}
.lp-root.lp-t-folio .lp-sec.lp-tone-dark,.lp-root.lp-t-folio .lp-foot.lp-tone-dark,.lp-root.lp-t-folio .lp-cta.lp-tone-dark{background-image:radial-gradient(ellipse 50% 70% at 88% 0%,color-mix(in srgb,var(--lp-accent2) 22%,transparent),transparent 70%),repeating-linear-gradient(90deg,transparent 0 13px,color-mix(in srgb,var(--lp-text) 4%,transparent) 13px 15px,transparent 15px 22px,color-mix(in srgb,var(--lp-accent2) 5%,transparent) 22px 25px,transparent 25px 34px)}
.lp-root.lp-t-folio .lp-cta.lp-tone-accent{background-image:radial-gradient(ellipse 45% 90% at 100% 50%,color-mix(in srgb,var(--lp-accent2) 30%,transparent),transparent 72%)}
.lp-root.lp-t-folio .lp-feat-t{font-family:var(--lp-font-h);font-size:1.18em;font-weight:700}
.lp-root.lp-t-folio .lp-feat-cards .lp-feat-i{border-top:3px solid var(--lp-accent2)}
.lp-root.lp-t-folio .lp-feat-media{border-radius:calc(var(--lp-radius) * .8)}
.lp-root.lp-t-folio .lp-stat-v{color:var(--lp-link);font-family:var(--lp-font-h);font-weight:700;letter-spacing:-.02em}
.lp-root.lp-t-folio .lp-stat-band{border-radius:var(--lp-radius)}
.lp-root.lp-t-folio .lp-stat-l{font-size:.9em}
.lp-root.lp-t-folio .lp-step-numbers .lp-step-n{font-family:var(--lp-font-h);font-weight:700;-webkit-text-stroke:1.5px var(--lp-accent2)}
.lp-root.lp-t-folio .lp-step-numbers .lp-step-i{border-top:3px double color-mix(in srgb,var(--lp-accent2) 70%,transparent)}
.lp-root.lp-t-folio .lp-step-t{font-family:var(--lp-font-h);font-size:1.16em;font-weight:700}
.lp-root.lp-t-folio .lp-tm-name{font-family:var(--lp-font-h);font-weight:700}
.lp-root.lp-t-folio .lp-tm-role{color:var(--lp-link);font-weight:650}
.lp-root.lp-t-folio .lp-tm-round .lp-tm-photo{box-shadow:0 0 0 5px var(--lp-bg),0 0 0 7px var(--lp-accent2),0 0 0 10px var(--lp-bg),0 0 0 11px color-mix(in srgb,var(--lp-accent2) 60%,transparent)}
.lp-root.lp-t-folio .lp-ts-fig.lp-card::after{color:var(--lp-accent2);opacity:.6}
.lp-root.lp-t-folio .lp-faq-q{font-weight:650}
.lp-root.lp-t-folio .lp-faq-ic{border-radius:8px;background:color-mix(in srgb,var(--lp-accent2) 24%,transparent);color:var(--lp-link)}
.lp-root.lp-t-folio .lp-faq-details .lp-faq-item[open]{border-color:color-mix(in srgb,var(--lp-accent2) 60%,var(--lp-border));box-shadow:inset 3px 0 0 var(--lp-accent2)}
.lp-root.lp-t-folio .lp-plan{padding-bottom:46px}
.lp-root.lp-t-folio .lp-plan::after{content:"";position:absolute;bottom:12px;left:50%;width:16px;height:16px;margin-left:-8px;border-radius:50%;background:var(--lp-bg);box-shadow:inset 0 1px 3px color-mix(in srgb,var(--lp-text) 35%,transparent)}
.lp-root.lp-t-folio .lp-plan-feat{border-color:var(--lp-accent);box-shadow:inset 0 4px 0 var(--lp-accent2),var(--lp-shadow-lg)}
.lp-root.lp-t-folio .lp-plan-name{font-family:var(--lp-font-h);font-weight:700}
.lp-root.lp-t-folio .lp-plan-rib{background:var(--lp-accent2);color:var(--lp-on-accent2)}
.lp-root.lp-t-folio .lp-ev-date{border:2px dashed color-mix(in srgb,var(--lp-link) 70%,transparent);border-radius:8px;background:transparent;color:var(--lp-link);transform:rotate(-3deg)}
.lp-root.lp-t-folio .lp-ev-d{font-family:var(--lp-font-h);color:var(--lp-link)}
.lp-root.lp-t-folio .lp-ev-m,.lp-root.lp-t-folio .lp-ev-w{color:var(--lp-text)}
.lp-root.lp-t-folio .lp-ev-title{font-family:var(--lp-font-h)}
.lp-root.lp-t-folio .lp-formb-card{border-top:4px solid var(--lp-accent2)}
.lp-root.lp-t-folio .lp-ct-map{border:8px solid var(--lp-surface);box-shadow:0 0 0 1px var(--lp-border),var(--lp-shadow)}
.lp-root.lp-t-folio .lp-ct-k{letter-spacing:.06em}
.lp-root.lp-t-folio .lp-cta-t{font-weight:700}
.lp-root.lp-t-folio .lp-cta-x{color:var(--lp-text)}
.lp-root.lp-t-folio .lp-foot-name{font-family:var(--lp-font-h);font-weight:700}
.lp-root.lp-t-folio .lp-foot-h{color:var(--lp-text);letter-spacing:.14em}
.lp-root.lp-t-folio .lp-chat{border-color:color-mix(in srgb,var(--lp-accent2) 45%,var(--lp-border))}
.lp-root.lp-t-folio .lp-chat-head{background-image:radial-gradient(ellipse 60% 120% at 100% 0%,color-mix(in srgb,var(--lp-accent2) 32%,transparent),transparent 70%)}
.lp-root.lp-t-folio .lp-chat-t{font-family:var(--lp-font-h)}
.lp-root.lp-t-folio .lp-chat-op{opacity:1}
.lp-root.lp-t-folio .lp-cl-title{font-family:var(--lp-font-h);font-weight:700}
.lp-root.lp-t-folio .lp-cl-card{box-shadow:0 1px 0 color-mix(in srgb,var(--lp-text) 6%,transparent),0 16px 32px -26px color-mix(in srgb,var(--lp-text) 50%,transparent)}
.lp-root.lp-t-folio .lp-cl-card:hover{border-color:color-mix(in srgb,var(--lp-accent2) 60%,var(--lp-border))}
.lp-root.lp-t-folio .lp-cl-attrs dt{font-size:.92em}
.lp-root.lp-t-folio .lp-cl-fab{background:var(--lp-accent2);color:var(--lp-on-accent2)}
.lp-root.lp-t-folio .lp-cl-fab:hover{box-shadow:0 14px 30px -8px rgba(0,0,0,.6),0 0 0 6px color-mix(in srgb,var(--lp-accent2) 30%,transparent)}
.lp-root.lp-t-folio .lp-cl-file{border-style:dashed;background:var(--lp-surface)}
.lp-root.lp-t-folio .lp-cl-v-shelf .lp-cl-book{gap:0}
.lp-root.lp-t-folio .lp-cl-v-shelf .lp-cl-book .lp-cl-cv{border-radius:2px 5px 5px 2px}
.lp-root.lp-t-folio .lp-cl-v-shelf .lp-cl-bk{margin-inline:calc(clamp(7px,1cqi,12px) * -1);padding:12px clamp(7px,1cqi,12px) 0;border-top:9px solid var(--lp-wood);background:linear-gradient(180deg,color-mix(in srgb,#000 14%,transparent),transparent 12px) no-repeat}
.lp-root.lp-t-folio .lp-cl-v-feature .lp-cl-hero{border-color:color-mix(in srgb,var(--lp-accent2) 55%,var(--lp-border))}
.lp-root.lp-t-folio .lp-cl-q,.lp-root.lp-t-folio .lp-cl-pill,.lp-root.lp-t-folio .lp-cl-sel{background-color:var(--lp-surface)}
.lp-root.lp-t-folio .lp-cl-chip{border-radius:8px 8px 3px 3px;background:var(--lp-surface)}
.lp-root.lp-t-folio .lp-cl-chip[aria-pressed="true"]{border-color:var(--lp-accent);background:var(--lp-accent);color:var(--lp-on-accent);box-shadow:inset 0 -3px 0 var(--lp-accent2)}
.lp-root.lp-t-folio .lp-cl-pn{background:var(--lp-accent2);color:var(--lp-on-accent2)}
.lp-root.lp-t-folio .lp-cl-none{border-color:color-mix(in srgb,var(--lp-accent2) 55%,var(--lp-border-s));background:var(--lp-surface)}
.lp-root.lp-t-folio .lp-cartb-box,.lp-root.lp-t-folio .lp-cartb-co{border-top:4px solid var(--lp-accent2)}
.lp-root.lp-t-folio .lp-check-t .lp-req{color:var(--lp-link)}
.lp-root.lp-t-folio .lp-ev-st-few{color:var(--lp-text);background:color-mix(in srgb,#f59e0b 24%,transparent)}
@container lp (max-width:600px){.lp-root.lp-t-folio .lp-eyebrow{letter-spacing:.1em}}
@container lp (max-width:600px){.lp-root.lp-t-folio .lp-hero-media{border-width:6px}}
@container lp (max-width:600px){.lp-root.lp-t-folio .lp-nav-brand{flex:0 1 auto;gap:9px;font-size:1.02em}.lp-root.lp-t-folio .lp-nav-name{line-height:1.12}}
@container lp (max-width:600px){.lp-root.lp-t-folio .lp-tools .lp-tb-lang{min-width:30px;padding-inline:6px}}
@container lp (max-width:430px){.lp-root.lp-t-folio .lp-tools .lp-tb-btn{display:none}}
@media (prefers-reduced-motion:reduce){.lp-root.lp-t-folio .lp-ev-date{transform:none}}`,};export{THEME_FOLIO};