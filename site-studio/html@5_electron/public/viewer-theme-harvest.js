const THEME_HARVEST={key:'harvest',vars:{accent:'#2e7d3a',accent2:'#e9a922',bg:'#fdfbf4',surface:'#f5efdf',text:'#1c2a1b',muted:'#56614f',border:'#e3dbc6',fontBody:'humanist',fontHead:'rounded',baseSize:17,lineHeight:1.65,radius:18,buttons:'pill',headings:'normal',width:1200,space:'normal',scheme:'light',},css:`
.lp-root.lp-t-harvest{--lp-hw:760;scrollbar-color:color-mix(in srgb,var(--lp-accent) 40%,transparent) transparent}
.lp-root.lp-t-harvest ::selection{background:color-mix(in srgb,var(--lp-accent2) 42%,transparent)}
.lp-root.lp-t-harvest .lp-h{letter-spacing:-.018em}
.lp-root.lp-t-harvest .lp-h1{line-height:1.04;letter-spacing:-.032em}
.lp-root.lp-t-harvest .lp-eyebrow{padding:.45em 1.05em .45em .8em;border-radius:999px;background:color-mix(in srgb,var(--lp-accent2) 22%,transparent);color:var(--lp-text);font-size:.74em;font-weight:700;letter-spacing:.08em}
.lp-root.lp-t-harvest .lp-eyebrow::before{content:"";flex:none;width:.85em;height:.85em;border-radius:0 85% 0 85%;background:var(--lp-accent);transform:rotate(-12deg)}
.lp-root.lp-t-harvest .lp-sec-t::after{content:"";display:block;width:68px;height:12px;margin-top:.3em;background:var(--lp-accent2);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 68 12'%3E%3Cpath d='M2 7c5-6 10-6 16 0s11 6 16 0 11-6 16 0 11 6 16 0' fill='none' stroke='%23000' stroke-width='3.4' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 68 12'%3E%3Cpath d='M2 7c5-6 10-6 16 0s11 6 16 0 11-6 16 0 11 6 16 0' fill='none' stroke='%23000' stroke-width='3.4' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat}
.lp-root.lp-t-harvest .lp-sec-a-center .lp-sec-t::after{margin-inline:auto}
.lp-root.lp-t-harvest .lp-rich li::marker{color:var(--lp-accent2)}
.lp-root.lp-t-harvest .lp-rich blockquote{border-inline-start-color:var(--lp-accent2)}
.lp-root.lp-t-harvest .lp-btn{font-weight:700;letter-spacing:.01em}
.lp-root.lp-t-harvest:not(.lp-btn-outline) .lp-btn-primary{box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 12px 26px -14px color-mix(in srgb,var(--lp-accent) 85%,transparent)}
.lp-root.lp-t-harvest:not(.lp-btn-outline) .lp-btn-primary:hover{box-shadow:inset 0 1px 0 rgba(255,255,255,.2),0 18px 32px -14px color-mix(in srgb,var(--lp-accent) 90%,transparent)}
.lp-root.lp-t-harvest .lp-btn-secondary{border-color:color-mix(in srgb,var(--lp-accent) 42%,var(--lp-border-s));background:color-mix(in srgb,var(--lp-bg) 82%,transparent)}
.lp-root.lp-t-harvest .lp-btn-secondary:hover{border-color:var(--lp-accent);background:color-mix(in srgb,var(--lp-accent) 10%,var(--lp-bg));color:var(--lp-text)}
.lp-root.lp-t-harvest .lp-card{border-color:color-mix(in srgb,var(--lp-border) 65%,transparent);box-shadow:0 1px 2px color-mix(in srgb,var(--lp-text) 6%,transparent),0 16px 36px -24px color-mix(in srgb,var(--lp-text) 34%,transparent)}
.lp-root.lp-t-harvest .lp-card-hover:is(:hover,:focus-within){border-color:color-mix(in srgb,var(--lp-accent2) 60%,var(--lp-border))}
.lp-root.lp-t-harvest .lp-icbox{border-radius:50%;background:color-mix(in srgb,var(--lp-accent2) 26%,transparent);color:var(--lp-link)}
.lp-root.lp-t-harvest .lp-badge{background:var(--lp-accent2);color:var(--lp-on-accent2);letter-spacing:.05em}
.lp-root.lp-t-harvest .lp-chip{background:color-mix(in srgb,var(--lp-accent2) 18%,transparent)}
.lp-root.lp-t-harvest .lp-media:not(.lp-media-round){border-radius:calc(var(--lp-radius) * .85)}
.lp-root.lp-t-harvest .lp-input{border-radius:14px;background:var(--lp-bg)}
.lp-root.lp-t-harvest .lp-input:focus{border-color:var(--lp-accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--lp-accent2) 30%,transparent)}
.lp-root.lp-t-harvest .lp-att{border-color:transparent;box-shadow:0 1px 2px color-mix(in srgb,var(--lp-text) 6%,transparent),0 14px 30px -22px color-mix(in srgb,var(--lp-text) 34%,transparent)}
.lp-root.lp-t-harvest .lp-att-ic{border-radius:50%;background:color-mix(in srgb,var(--lp-accent2) 28%,transparent)}
.lp-root.lp-t-harvest .lp-totop{border-color:color-mix(in srgb,var(--lp-accent2) 60%,transparent)}
.lp-root.lp-t-harvest .lp-nav-brand{font-weight:800;letter-spacing:-.02em}
.lp-root.lp-t-harvest .lp-nav-a::after{height:3px;background:var(--lp-accent2)}
.lp-root.lp-t-harvest .lp-hero-t{font-size:clamp(2.3rem,1rem + 4cqi,4.3rem);letter-spacing:-.035em}
.lp-root.lp-t-harvest .lp-hero-left.lp-hero-bgd .lp-hero-bg::after{background:linear-gradient(100deg,var(--lp-bg) 0%,var(--lp-bg) 24%,color-mix(in srgb,var(--lp-bg) 55%,transparent) 48%,transparent 76%)}
.lp-root.lp-t-harvest .lp-hero-bgd .lp-hero-x{color:color-mix(in srgb,var(--lp-text) 90%,transparent)}
.lp-root.lp-t-harvest .lp-hero-badge{border-color:color-mix(in srgb,var(--lp-accent2) 60%,transparent);background:color-mix(in srgb,var(--lp-accent2) 22%,transparent)}
.lp-root.lp-t-harvest .lp-hero-badge::before{background:var(--lp-accent2);box-shadow:0 0 0 .25em color-mix(in srgb,var(--lp-accent2) 32%,transparent)}
.lp-root.lp-t-harvest .lp-hero-media{border-radius:calc(var(--lp-radius) * 1.6)}
.lp-root.lp-t-harvest .lp-sec.lp-tone-muted{background-image:radial-gradient(ellipse 55% 70% at 100% 0%,color-mix(in srgb,var(--lp-accent2) 16%,transparent),transparent 70%),repeating-linear-gradient(-14deg,transparent 0 26px,color-mix(in srgb,var(--lp-accent2) 6%,transparent) 26px 28px)}
.lp-root.lp-t-harvest .lp-sec.lp-tone-dark,.lp-root.lp-t-harvest .lp-foot.lp-tone-dark{background-image:radial-gradient(ellipse 60% 80% at 92% 0%,color-mix(in srgb,var(--lp-accent2) 14%,transparent),transparent 70%),radial-gradient(ellipse 50% 70% at 0% 100%,color-mix(in srgb,var(--lp-accent) 24%,transparent),transparent 72%)}
.lp-root.lp-t-harvest .lp-hr-accent{height:4px;background:linear-gradient(90deg,var(--lp-accent),var(--lp-accent2))}
.lp-root.lp-t-harvest .lp-qt-callout{border-inline-start-width:5px}
.lp-root.lp-t-harvest .lp-feat-t{font-weight:760}
.lp-root.lp-t-harvest .lp-feat-list .lp-feat-chk{background:color-mix(in srgb,var(--lp-accent2) 30%,transparent);color:var(--lp-link)}
.lp-root.lp-t-harvest .lp-feat-split .lp-feat-media{border-radius:calc(var(--lp-radius) * 1.6)}
.lp-root.lp-t-harvest .lp-stat-v{column-gap:.16em;color:var(--lp-link);font-size:clamp(2rem,1.1rem + 2.5cqi,3.3rem);font-weight:800;letter-spacing:-.035em}
.lp-root.lp-t-harvest .lp-stat-plain .lp-stat-i{border-inline-start:3px solid var(--lp-accent2)}
.lp-root.lp-t-harvest .lp-stat-band{border-radius:var(--lp-radius)}
.lp-root.lp-t-harvest .lp-step-cards .lp-step-n{border-radius:50%;background:var(--lp-accent2);color:var(--lp-on-accent2)}
.lp-root.lp-t-harvest .lp-step-line .lp-step-n{border-color:var(--lp-accent2);background:color-mix(in srgb,var(--lp-accent2) 16%,var(--lp-bg));color:var(--lp-text)}
.lp-root.lp-t-harvest .lp-step-numbers .lp-step-n{-webkit-text-stroke-color:var(--lp-accent2)}
.lp-root.lp-t-harvest .lp-tm-role{color:var(--lp-link)}
.lp-root.lp-t-harvest .lp-tm-round .lp-tm-photo{box-shadow:0 0 0 5px var(--lp-bg),0 0 0 8px color-mix(in srgb,var(--lp-accent2) 72%,transparent)}
.lp-root.lp-t-harvest .lp-ts-fig.lp-card::after{color:var(--lp-accent2);opacity:.6}
.lp-root.lp-t-harvest .lp-ts-photo{box-shadow:0 0 0 3px color-mix(in srgb,var(--lp-accent2) 55%,transparent)}
.lp-root.lp-t-harvest .lp-logos-grid .lp-logo{border-color:transparent;background:var(--lp-surface)}
.lp-root.lp-t-harvest .lp-faq-ic{background:color-mix(in srgb,var(--lp-accent2) 28%,transparent);color:var(--lp-link)}
.lp-root.lp-t-harvest .lp-faq-details .lp-faq-item{border-color:transparent;box-shadow:0 1px 2px color-mix(in srgb,var(--lp-text) 6%,transparent),0 12px 28px -22px color-mix(in srgb,var(--lp-text) 30%,transparent)}
.lp-root.lp-t-harvest .lp-faq-details .lp-faq-item[open]{border-color:color-mix(in srgb,var(--lp-accent2) 55%,transparent)}
.lp-root.lp-t-harvest .lp-cta-t{letter-spacing:-.028em}
.lp-root.lp-t-harvest .lp-ct-cards .lp-ct-item,.lp-root.lp-t-harvest .lp-ct-map{border-radius:var(--lp-radius)}
.lp-root.lp-t-harvest .lp-tbl{border-radius:calc(var(--lp-radius) * .7)}
.lp-root.lp-t-harvest .lp-tbs-grid th{background:color-mix(in srgb,var(--lp-accent2) 18%,transparent)}
.lp-root.lp-t-harvest .lp-tbl-t th{font-weight:750}
.lp-root.lp-t-harvest .lp-formb-card{border-color:transparent}
.lp-root.lp-t-harvest .lp-pr{border-color:transparent;box-shadow:0 1px 2px color-mix(in srgb,var(--lp-text) 6%,transparent),0 18px 38px -26px color-mix(in srgb,var(--lp-text) 40%,transparent)}
.lp-root.lp-t-harvest .lp-pr:hover{border-color:color-mix(in srgb,var(--lp-accent2) 60%,transparent)}
.lp-root.lp-t-harvest .lp-pr-name{font-weight:760;letter-spacing:-.012em}
.lp-root.lp-t-harvest .lp-pr .lp-price-now{color:var(--lp-link)}
.lp-root.lp-t-harvest .lp-pr-min{padding:.2em .7em;border-radius:999px;background:color-mix(in srgb,var(--lp-accent2) 22%,transparent);color:var(--lp-text);font-weight:650}
.lp-root.lp-t-harvest .lp-cartb-box,.lp-root.lp-t-harvest .lp-cartb-co{border-color:transparent}
.lp-root.lp-t-harvest .lp-ev-date{border-radius:16px;background:color-mix(in srgb,var(--lp-accent2) 22%,transparent);color:var(--lp-text)}
.lp-root.lp-t-harvest .lp-ev-d{color:var(--lp-link)}
.lp-root.lp-t-harvest .lp-ev-w{color:var(--lp-text)}
.lp-root.lp-t-harvest .lp-evs-list .lp-ev{padding-inline:10px;border-radius:14px}
.lp-root.lp-t-harvest .lp-gal-it .lp-media{border-radius:var(--lp-radius)}
.lp-root.lp-t-harvest .lp-foot-name{font-weight:800}
@container lp (max-width:600px){.lp-root.lp-t-harvest .lp-sec-t::after{width:54px;height:10px}}
@container lp (max-width:600px){.lp-root.lp-t-harvest .lp-hero-left.lp-hero-bgd .lp-hero-bg::after{background:var(--lp-bg)}}
@container lp (max-width:600px){.lp-root.lp-t-harvest .lp-tools .lp-tb-lang{min-width:30px;padding-inline:6px}}
@container lp-ts (max-width:600px){.lp-root.lp-t-harvest .lp-ts-list{grid-template-columns:minmax(0,1fr)}}
@media (prefers-reduced-motion:reduce){.lp-root.lp-t-harvest .lp-btn,.lp-root.lp-t-harvest .lp-card-hover{transition:none}}`,};export{THEME_HARVEST};