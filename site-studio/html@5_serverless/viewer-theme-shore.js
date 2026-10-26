const SHORE_WAVE="url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 10'%3E%3Cpath d='M1 6.5q3.25-4 6.5 0t6.5 0t6.5 0t6.5 0' fill='none' stroke='%23000' stroke-width='2.4' stroke-linecap='round'/%3E%3C/svg%3E\") center/contain no-repeat";const THEME_SHORE={key:'shore',vars:{accent:'#1d6a6e',accent2:'#d9bb8c',bg:'#ffffff',surface:'#f8f4ed',text:'#14302f',muted:'#53676a',border:'#e8e0d2',fontBody:'humanist',fontHead:'geometric',baseSize:17,lineHeight:1.62,radius:16,buttons:'pill',headings:'normal',width:1200,space:'airy',scheme:'light',},css:`
.lp-root.lp-t-shore{--lp-hw:600;scrollbar-color:color-mix(in srgb,var(--lp-accent) 35%,transparent) transparent}
.lp-root.lp-t-shore ::selection{background:color-mix(in srgb,var(--lp-accent2) 45%,transparent)}
.lp-root.lp-t-shore .lp-h{letter-spacing:-.022em}
.lp-root.lp-t-shore .lp-h1{line-height:1.04;letter-spacing:-.036em}
.lp-root.lp-t-shore .lp-h4{letter-spacing:-.01em}
.lp-root.lp-t-shore .lp-eyebrow{gap:.75em;font-size:.72em;font-weight:700;letter-spacing:.2em}
.lp-root.lp-t-shore .lp-eyebrow::before{content:"";flex:none;width:2em;height:.72em;background:var(--lp-accent2);-webkit-mask:${SHORE_WAVE};mask:${SHORE_WAVE}}
.lp-root.lp-t-shore .lp-sec-t{font-weight:550}
.lp-root.lp-t-shore .lp-sec-t::after{content:"";display:block;width:64px;height:3px;margin-top:.5em;border-radius:3px;background:linear-gradient(90deg,var(--lp-accent),var(--lp-accent2))}
.lp-root.lp-t-shore .lp-sec-a-center .lp-sec-t::after{margin-inline:auto}
.lp-root.lp-t-shore .lp-lead{line-height:1.6}
.lp-root.lp-t-shore .lp-rich li::marker{color:var(--lp-link)}
.lp-root.lp-t-shore .lp-rich blockquote{border-inline-start-color:var(--lp-accent2)}
.lp-root.lp-t-shore .lp-btn{font-weight:600;letter-spacing:.012em}
.lp-root.lp-t-shore:not(.lp-btn-outline) .lp-btn-primary{box-shadow:0 1px 2px color-mix(in srgb,var(--lp-text) 14%,transparent),0 12px 26px -14px color-mix(in srgb,var(--lp-accent) 80%,transparent)}
.lp-root.lp-t-shore:not(.lp-btn-outline) .lp-btn-primary:hover{box-shadow:0 2px 4px color-mix(in srgb,var(--lp-text) 14%,transparent),0 18px 32px -14px color-mix(in srgb,var(--lp-accent) 85%,transparent)}
.lp-root.lp-t-shore .lp-btn-secondary{border-color:color-mix(in srgb,var(--lp-accent) 38%,var(--lp-border-s));background:color-mix(in srgb,var(--lp-bg) 85%,transparent)}
.lp-root.lp-t-shore .lp-btn-secondary:hover{border-color:var(--lp-accent);background:color-mix(in srgb,var(--lp-accent2) 16%,var(--lp-bg));color:var(--lp-text)}
.lp-root.lp-t-shore .lp-card{border-color:color-mix(in srgb,var(--lp-border) 70%,transparent);box-shadow:0 1px 2px color-mix(in srgb,var(--lp-text) 5%,transparent),0 20px 44px -32px color-mix(in srgb,var(--lp-text) 40%,transparent)}
.lp-root.lp-t-shore .lp-card-hover:is(:hover,:focus-within){border-color:color-mix(in srgb,var(--lp-accent2) 70%,var(--lp-border))}
.lp-root.lp-t-shore .lp-icbox{border-radius:50%;background:color-mix(in srgb,var(--lp-accent2) 30%,transparent);color:var(--lp-link)}
.lp-root.lp-t-shore .lp-badge{background:var(--lp-accent2);color:var(--lp-on-accent2);letter-spacing:.08em}
.lp-root.lp-t-shore .lp-chip{border:1px solid var(--lp-border);background:transparent;font-weight:500}
.lp-root.lp-t-shore .lp-input{border-radius:12px;background:var(--lp-bg)}
.lp-root.lp-t-shore .lp-input:focus{border-color:var(--lp-link);box-shadow:0 0 0 4px color-mix(in srgb,var(--lp-accent2) 34%,transparent)}
.lp-root.lp-t-shore .lp-label{font-weight:600;letter-spacing:.01em}
.lp-root.lp-t-shore .lp-att{border-color:transparent;box-shadow:0 1px 2px color-mix(in srgb,var(--lp-text) 6%,transparent),0 16px 34px -26px color-mix(in srgb,var(--lp-text) 40%,transparent)}
.lp-root.lp-t-shore .lp-att-ic{border-radius:50%;background:color-mix(in srgb,var(--lp-accent2) 30%,transparent)}
.lp-root.lp-t-shore .lp-totop{border-color:color-mix(in srgb,var(--lp-accent2) 70%,transparent)}
.lp-root.lp-t-shore .lp-nav-brand{font-weight:650;letter-spacing:-.01em}
.lp-root.lp-t-shore .lp-nav-a{font-size:.95em}
.lp-root.lp-t-shore .lp-nav-a::after{height:2px;background:var(--lp-accent2)}
.lp-root.lp-t-shore .lp-hero::before{background:radial-gradient(52% 70% at 92% 4%,color-mix(in srgb,var(--lp-accent2) 30%,transparent),transparent 70%),radial-gradient(46% 60% at 0% 100%,color-mix(in srgb,var(--lp-accent) 9%,transparent),transparent 72%)}
.lp-root.lp-t-shore .lp-hero-t{font-weight:550;letter-spacing:-.04em}
.lp-root.lp-t-shore .lp-hero-badge{border-color:color-mix(in srgb,var(--lp-accent2) 70%,transparent);background:color-mix(in srgb,var(--lp-accent2) 20%,transparent)}
.lp-root.lp-t-shore .lp-hero-badge::before{background:var(--lp-accent2);box-shadow:0 0 0 .25em color-mix(in srgb,var(--lp-accent2) 35%,transparent)}
.lp-root.lp-t-shore .lp-hero-media{border-radius:28px;box-shadow:16px 16px 0 color-mix(in srgb,var(--lp-accent2) 42%,transparent),0 30px 60px -36px color-mix(in srgb,var(--lp-text) 55%,transparent)}
.lp-root.lp-t-shore .lp-hero-c .lp-btns:has(>.lp-btn-ghost:first-child){flex-wrap:nowrap;gap:6px;max-width:36rem;padding:6px;border:1px solid var(--lp-border);border-radius:999px;background:var(--lp-bg);box-shadow:0 2px 4px color-mix(in srgb,var(--lp-text) 5%,transparent),0 22px 44px -26px color-mix(in srgb,var(--lp-text) 45%,transparent)}
.lp-root.lp-t-shore .lp-hero-c .lp-btns>.lp-btn-ghost:first-child{flex:1 1 auto;justify-content:flex-start;min-width:0;padding-inline:1.1em;color:var(--lp-muted);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lp-root.lp-t-shore .lp-hero-c .lp-btns>.lp-btn-ghost:first-child:hover{background:var(--lp-hover);color:var(--lp-text)}
.lp-root.lp-t-shore .lp-hero-c .lp-btns>.lp-btn-ghost:first-child .lp-ic{color:var(--lp-link)}
.lp-root.lp-t-shore .lp-sec.lp-tone-muted{background-image:radial-gradient(ellipse 50% 60% at 100% 0%,color-mix(in srgb,var(--lp-accent2) 16%,transparent),transparent 70%),radial-gradient(ellipse 40% 50% at 0% 100%,color-mix(in srgb,var(--lp-accent) 6%,transparent),transparent 70%)}
.lp-root.lp-t-shore .lp-sec.lp-tone-dark,.lp-root.lp-t-shore .lp-foot.lp-tone-dark,.lp-root.lp-t-shore .lp-cta.lp-tone-dark{background-image:radial-gradient(ellipse 55% 75% at 90% 0%,color-mix(in srgb,var(--lp-accent2) 18%,transparent),transparent 70%),radial-gradient(ellipse 50% 70% at 0% 100%,color-mix(in srgb,var(--lp-accent) 30%,transparent),transparent 72%)}
.lp-root.lp-t-shore .lp-feat-t{font-weight:600}
.lp-root.lp-t-shore .lp-feat-split .lp-feat-media{border-radius:24px;box-shadow:14px 14px 0 color-mix(in srgb,var(--lp-accent2) 40%,transparent),0 26px 50px -34px color-mix(in srgb,var(--lp-text) 50%,transparent)}
.lp-root.lp-t-shore .lp-feat-split .lp-feat-i:nth-child(even) .lp-feat-media{box-shadow:-14px 14px 0 color-mix(in srgb,var(--lp-accent2) 40%,transparent),0 26px 50px -34px color-mix(in srgb,var(--lp-text) 50%,transparent)}
.lp-root.lp-t-shore .lp-feat-list .lp-feat-chk{background:color-mix(in srgb,var(--lp-accent2) 32%,transparent);color:var(--lp-link)}
.lp-root.lp-t-shore .lp-stat-band{border-color:transparent;border-radius:24px;background:color-mix(in srgb,var(--lp-accent2) 40%,var(--lp-border))}
.lp-root.lp-t-shore .lp-stat-v{color:var(--lp-link);font-weight:300;letter-spacing:-.04em}
.lp-root.lp-t-shore .lp-stat-s{font-weight:500}
.lp-root.lp-t-shore .lp-step-cards .lp-step-n{border-radius:50%;background:transparent;box-shadow:inset 0 0 0 2px var(--lp-accent2);color:var(--lp-link)}
.lp-root.lp-t-shore .lp-step-line .lp-step-n{border-color:var(--lp-accent2);background:color-mix(in srgb,var(--lp-accent2) 18%,var(--lp-bg));color:var(--lp-link)}
.lp-root.lp-t-shore .lp-step-line .lp-step-i:not(:last-child)::after{background:linear-gradient(90deg,var(--lp-accent2),color-mix(in srgb,var(--lp-accent2) 30%,transparent))}
.lp-root.lp-t-shore .lp-step-t{font-weight:600}
.lp-root.lp-t-shore .lp-tm-role{color:var(--lp-link);font-size:.8em;font-weight:600;letter-spacing:.04em}
.lp-root.lp-t-shore .lp-tm-cards .lp-tm-photo img{transition:transform .6s var(--lp-ease)}
.lp-root.lp-t-shore .lp-tm-cards .lp-tm-item:is(:hover,:focus-within) .lp-tm-photo img{transform:scale(1.04)}
.lp-root.lp-t-shore .lp-ts-fig.lp-card::after{color:var(--lp-accent2);opacity:.8}
.lp-root.lp-t-shore .lp-ts-name{font-weight:650}
.lp-root.lp-t-shore .lp-qt-callout{border-radius:var(--lp-radius)}
.lp-root.lp-t-shore .lp-qt-mark{fill:var(--lp-accent2)}
.lp-root.lp-t-shore .lp-qt-pull .lp-qt-body{font-family:var(--lp-font-h);font-weight:400;letter-spacing:-.015em}
.lp-root.lp-t-shore .lp-faq-ic{background:color-mix(in srgb,var(--lp-accent2) 32%,transparent);color:var(--lp-link)}
.lp-root.lp-t-shore .lp-faq-details .lp-faq-item{border-color:transparent;background:var(--lp-surface)}
.lp-root.lp-t-shore .lp-faq-details .lp-faq-item[open]{border-color:color-mix(in srgb,var(--lp-accent2) 70%,transparent);background:var(--lp-bg);box-shadow:0 18px 40px -30px color-mix(in srgb,var(--lp-text) 45%,transparent)}
.lp-root.lp-t-shore .lp-plan{border-radius:24px;border-color:transparent;box-shadow:0 1px 2px color-mix(in srgb,var(--lp-text) 5%,transparent),0 20px 44px -32px color-mix(in srgb,var(--lp-text) 40%,transparent)}
.lp-root.lp-t-shore .lp-plan-feat{border:2px solid var(--lp-accent);background:linear-gradient(180deg,color-mix(in srgb,var(--lp-accent2) 18%,var(--lp-surface)),var(--lp-surface) 50%)}
.lp-root.lp-t-shore .lp-plan-rib{background:var(--lp-accent2);color:var(--lp-on-accent2)}
.lp-root.lp-t-shore .lp-plan .lp-price-now{color:var(--lp-link);font-weight:600}
.lp-root.lp-t-shore .lp-ev-date{border-radius:18px;background:color-mix(in srgb,var(--lp-accent2) 26%,transparent);color:var(--lp-text)}
.lp-root.lp-t-shore .lp-ev-d{color:var(--lp-link);font-weight:500}
.lp-root.lp-t-shore .lp-tbl-t th{color:var(--lp-link);font-weight:650}
.lp-root.lp-t-shore .lp-tbs-lines th{border-bottom:2px solid var(--lp-accent2)}
.lp-root.lp-t-shore .lp-formb-card{border-color:transparent;border-radius:24px;box-shadow:0 1px 2px color-mix(in srgb,var(--lp-text) 6%,transparent),0 26px 54px -34px color-mix(in srgb,var(--lp-text) 50%,transparent)}
.lp-root.lp-t-shore .lp-ct-map{border-radius:24px}
.lp-root.lp-t-shore .lp-ct-cards .lp-ct-item{border-radius:var(--lp-radius)}
.lp-root.lp-t-shore .lp-gal-it .lp-media{border-radius:var(--lp-radius)}
.lp-root.lp-t-shore .lp-logos-grid .lp-logo{border-color:transparent;background:var(--lp-bg)}
.lp-root.lp-t-shore .lp-cta-t{font-weight:550;letter-spacing:-.03em}
.lp-root.lp-t-shore .lp-foot-name{font-weight:650}
.lp-root.lp-t-shore .lp-cl-card{border-color:color-mix(in srgb,var(--lp-border) 70%,transparent);border-radius:calc(var(--lp-radius) * 1.25);background:var(--lp-bg);box-shadow:0 1px 2px color-mix(in srgb,var(--lp-text) 5%,transparent),0 22px 46px -34px color-mix(in srgb,var(--lp-text) 45%,transparent)}
.lp-root.lp-t-shore .lp-cl-card:hover{border-color:color-mix(in srgb,var(--lp-accent2) 75%,var(--lp-border))}
.lp-root.lp-t-shore .lp-cl-title{font-weight:600;letter-spacing:-.012em}
.lp-root.lp-t-shore .lp-cl-attrs{gap:4px 18px;padding:.6em 0;border-block:1px solid var(--lp-border)}
.lp-root.lp-t-shore .lp-cl-attrs dt{font-size:.92em}
.lp-root.lp-t-shore .lp-cl-price .lp-price-now{color:var(--lp-link);font-weight:650}
.lp-root.lp-t-shore .lp-cl-cv>.lp-cl-badge{box-shadow:0 6px 16px -6px color-mix(in srgb,var(--lp-text) 45%,transparent)}
.lp-root.lp-t-shore .lp-cl-v-feature .lp-cl-hero .lp-cl-body{background:linear-gradient(160deg,color-mix(in srgb,var(--lp-accent2) 14%,var(--lp-bg)),var(--lp-bg) 60%)}
.lp-root.lp-t-shore .lp-cl-bar{padding:14px;border:1px solid var(--lp-border);border-radius:28px;background:var(--lp-surface)}
.lp-root.lp-t-shore .lp-cl-info{padding-inline:6px}
.lp-root.lp-t-shore .lp-cl-chip[aria-pressed="true"]{border-color:var(--lp-accent);background:var(--lp-accent);color:var(--lp-on-accent)}
.lp-root.lp-t-shore .lp-cl-file{border-radius:14px}
.lp-root.lp-t-shore .lp-cl-fic{color:var(--lp-link)}
@container lp (max-width:900px){.lp-root.lp-t-shore .lp-feat-split .lp-feat-i:nth-child(even) .lp-feat-media{box-shadow:14px 14px 0 color-mix(in srgb,var(--lp-accent2) 40%,transparent)}}
@container lp (max-width:600px){.lp-root.lp-t-shore .lp-eyebrow{letter-spacing:.14em}}
@container lp (max-width:600px){.lp-root.lp-t-shore .lp-hero-c .lp-btns:has(>.lp-btn-ghost:first-child){flex-wrap:wrap;border-radius:26px}.lp-root.lp-t-shore .lp-hero-c .lp-btns:has(>.lp-btn-ghost:first-child)>.lp-btn{flex:1 1 100%}}
@container lp (max-width:600px){.lp-root.lp-t-shore .lp-hero-media{box-shadow:10px 10px 0 color-mix(in srgb,var(--lp-accent2) 42%,transparent)}}
@container lp (max-width:600px){.lp-root.lp-t-shore .lp-cl-bar{padding:10px;border-radius:22px}}
@container lp (max-width:600px){.lp-root.lp-t-shore .lp-tools .lp-tb-lang{min-width:30px;padding-inline:6px}}
@container lp (max-width:430px){.lp-root.lp-t-shore .lp-tools .lp-tb-btn{display:none}}
@container lp-ts (max-width:600px){.lp-root.lp-t-shore .lp-ts-list{grid-template-columns:minmax(0,1fr)}}
@media (prefers-reduced-motion:reduce){.lp-root.lp-t-shore .lp-tm-cards .lp-tm-photo img{transition:none}}`,};export{THEME_SHORE};