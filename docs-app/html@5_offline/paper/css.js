import{safeColor,onAccent,darkAccent,DARK_BG}from"../color/color.js";import{langDir,primary}from"../i18n/lang.js";import{htmlToText,pickText}from"../i18n/text.js";import{PAGE_SIZES}from"./base.js";import{FONT_STACKS,DENSITY,LAYOUTS}from"./themes.js";import{FEATURE_ORDER}from"./runtime.js";import{ensureDoc}from"../doc/model.js";import{BLOCK_TYPES,THEMES,P}from"../doc/product.js";import{uiText}from"../doc/dict.js";import{num,isObj,own,round}from"../util/value.js";import{collectUsage}from"../doc/render.js";import{fontStack,cssStr,shakeRules,langCSS}from"../doc/css.js";const CSS_BASE=`
.__P__-root{color:var(--__P__-text);font-family:var(--__P__-font);font-size:var(--__P__-size);line-height:var(--__P__-lh);-webkit-text-size-adjust:100%;text-size-adjust:100%;font-kerning:normal;overflow-wrap:break-word;-webkit-print-color-adjust:exact;print-color-adjust:exact;--__P__-bs:calc(var(--__P__-gap) * 3.4mm);--__P__-line:color-mix(in srgb,var(--__P__-text) 14%,transparent);--__P__-tint:color-mix(in srgb,var(--__P__-accent) 11%,transparent)}
.__P__-root *,.__P__-root *::before,.__P__-root *::after{box-sizing:border-box}
.__P__-root :where(h1,h2,h3,h4){font-family:var(--__P__-font-h);line-height:1.2;margin:0;font-weight:700;color:inherit}
.__P__-root :where(p){margin:0 0 .55em}
.__P__-root :where(a){color:var(--__P__-accent);text-decoration-thickness:.07em;text-underline-offset:.17em}
.__P__-root img{max-width:100%}
.__P__-root code{font:.9em/1.4 ui-monospace,"Cascadia Code","SF Mono",Consolas,monospace;background:var(--__P__-tint);padding:.05em .3em;border-radius:3px}
.__P__-page{position:relative;background:var(--__P__-bg)}
.__P__-ic{width:1.15em;height:1.15em;flex:none;vertical-align:-.2em;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.__P__-sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.__P__-b{--__P__-mt:initial;--__P__-mb:initial;margin:var(--__P__-mt,0) 0 var(--__P__-mb,var(--__P__-bs))}
.__P__-b:last-child{margin-bottom:var(--__P__-mb,0)}
.__P__-filled{padding:calc(var(--__P__-gap) * 3mm) calc(var(--__P__-gap) * 3.6mm);border-radius:var(--__P__-radius)}
.__P__-region{min-width:0}
.__P__-header{margin-bottom:calc(var(--__P__-bs) * 1.5)}
.__P__-mcol>.__P__-header{margin-bottom:var(--__P__-bs)}
.__P__-cols{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--__P__-bs) var(--__P__-colgap);align-items:start}
.__P__-root.__P__-noside .__P__-cols{display:block}
.__P__-hx{display:flex;flex-wrap:wrap;align-items:center;gap:.4em;font-size:1.2em;margin:0 0 calc(var(--__P__-gap) * 2.6mm)}
.__P__-hd-ic{color:var(--__P__-accent);width:1.05em;height:1.05em}
.__P__-rich>:last-child{margin-bottom:0}
.__P__-rich ul,.__P__-rich ol{margin:0 0 .55em;padding-inline-start:1.35em}
.__P__-rich li{margin:.14em 0}
.__P__-rich li::marker{color:var(--__P__-accent)}
.__P__-rich h3{font-size:1.1em;margin:.75em 0 .3em}
.__P__-rich h4{font-size:1em;margin:.6em 0 .25em;color:var(--__P__-accent)}
.__P__-rich>h3:first-child,.__P__-rich>h4:first-child{margin-top:0}
.__P__-rich blockquote{margin:.5em 0;padding:.15em 0;padding-inline-start:.9em;border-inline-start:3px solid var(--__P__-accent);color:var(--__P__-muted);font-style:italic}
.__P__-rich pre{margin:.5em 0;padding:.6em .8em;background:var(--__P__-tint);border-radius:var(--__P__-radius);white-space:pre-wrap;font:.88em/1.45 ui-monospace,"Cascadia Code",Consolas,monospace}
.__P__-rich pre code{background:none;padding:0}
.__P__-rich hr{border:0;border-top:1px solid var(--__P__-line);margin:.8em 0}
.__P__-rich mark{background:#fde68a;color:#1f2937;padding:0 .12em;border-radius:2px}
.__P__-i1{margin-inline-start:1.6em!important}.__P__-i2{margin-inline-start:3.2em!important}.__P__-i3{margin-inline-start:4.8em!important}.__P__-i4{margin-inline-start:6.4em!important}
.__P__-sh-rounded{border-radius:calc(var(--__P__-radius) * 2 + 4px)}
.__P__-sh-circle{border-radius:50%}
`;const CSS_SHARED={chips:`
.__P__-tag{display:inline-flex;align-items:center;padding:.16em .62em;border-radius:99px;background:var(--__P__-tint);color:color-mix(in srgb,var(--__P__-accent) 80%,var(--__P__-text));font-size:.86em;line-height:1.35;font-weight:500}
`,meter:`
.__P__-meter{display:block;height:.42em;border-radius:99px;background:var(--__P__-tint);overflow:hidden}
.__P__-meter>i{display:block;height:100%;width:var(--v,0);background:var(--__P__-accent);border-radius:inherit}
.__P__-dots{display:inline-flex;gap:.26em;flex:none;vertical-align:middle}
.__P__-dots>i{width:.62em;height:.62em;border-radius:50%;background:color-mix(in srgb,var(--__P__-accent) 20%,transparent)}
.__P__-dots>i.on{background:var(--__P__-accent)}
`,att:`
.__P__-att{border:1px solid var(--__P__-line);border-radius:var(--__P__-radius);overflow:hidden;background:var(--__P__-bg);container-type:inline-size}
.__P__-att-head{display:flex;flex-wrap:wrap;align-items:center;gap:.5em .75em;padding:.6em .8em}
.__P__-att-ic{width:2.1em;height:2.1em;padding:.4em;border-radius:calc(var(--__P__-radius) * .8 + 2px);background:var(--__P__-tint);color:var(--__P__-accent);stroke-width:1.7}
.__P__-att-meta{flex:1 1 min(16em,calc(100% - 2.85em));min-width:0}
.__P__-att-title{font-weight:600;line-height:1.3}
.__P__-att-desc{font-size:.92em;margin-top:.12em}
.__P__-att-info{font-size:.8em;color:var(--__P__-muted);margin-top:.12em;overflow-wrap:break-word}
.__P__-att-btns{display:flex;flex-wrap:wrap;gap:.35em;justify-content:flex-end;margin-inline-start:auto}
.__P__-btn{display:inline-flex;align-items:center;gap:.4em;font:inherit;font-size:.82em;line-height:1;padding:.55em .8em;border-radius:calc(var(--__P__-radius) * .8 + 2px);border:1px solid var(--__P__-line);background:var(--__P__-bg);color:var(--__P__-text);cursor:pointer;transition:border-color .15s,color .15s,background-color .15s}
.__P__-btn:hover{border-color:var(--__P__-accent);color:var(--__P__-accent);background:var(--__P__-tint)}
.__P__-btn:focus-visible{outline:2px solid var(--__P__-accent);outline-offset:1px}
.__P__-btn .__P__-ic{width:1.15em;height:1.15em}
.__P__-att-prev{border-top:1px solid var(--__P__-line);background:color-mix(in srgb,var(--__P__-text) 4%,var(--__P__-bg))}
.__P__-att-obj{display:block;width:100%;border:0;background:color-mix(in srgb,var(--__P__-text) 6%,var(--__P__-bg))}
.__P__-att-img{text-align:center;padding:.7em}
.__P__-att-img img{display:inline-block;max-height:200mm;border-radius:calc(var(--__P__-radius) * .6)}
.__P__-att-see{padding:.55em .8em;font-size:.86em}
.__P__-att-see a{display:inline-flex;align-items:center;gap:.45em}
.__P__-att-fb{display:flex;align-items:center;justify-content:center;gap:.6em;min-height:5em;height:100%;padding:1.2em;color:var(--__P__-muted);font-size:.9em;text-align:center}
@container (max-width:30em){.__P__-att-btns{flex-basis:100%;justify-content:flex-start;padding-inline-start:calc(2.1em + .75em)}}
`,};const CSS_BLOCKS={heading:`
.__P__-hd{display:flex;align-items:center;gap:.4em;margin:0 0 calc(var(--__P__-gap) * 2.4mm)}
.__P__-b.__P__-b-heading{margin-bottom:var(--__P__-mb,0)}
.__P__-hd1{font-size:1.9em;letter-spacing:-.01em}
.__P__-hd3{font-size:1.07em}
.__P__-hd4{font-size:.86em;text-transform:uppercase;letter-spacing:.09em;color:var(--__P__-muted)}
`,text:'',table:`
.__P__-tbl{overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch}
.__P__-table{border-collapse:collapse;border-spacing:0;font-size:.95em;line-height:1.4}
.__P__-tb-fixed{table-layout:fixed}
.__P__-table th,.__P__-table td{padding:.42em .65em;vertical-align:top;text-align:start;min-width:2em;overflow-wrap:normal;word-break:normal;-webkit-hyphens:auto;hyphens:auto}
.__P__-table th{font-weight:700}
.__P__-table p{margin:0 0 .35em}
.__P__-table td>:last-child,.__P__-table th>:last-child,.__P__-table [data-l]>:last-child{margin-bottom:0}
.__P__-table ul,.__P__-table ol{margin:0 0 .35em;padding-inline-start:1.2em}
.__P__-table caption{caption-side:bottom;text-align:start;font-size:.84em;color:var(--__P__-muted);padding-top:.45em}
.__P__-tbs-grid th,.__P__-tbs-grid td{border:1px solid color-mix(in srgb,var(--__P__-text) 20%,transparent)}
.__P__-tbs-grid th{background:var(--__P__-tint)}
.__P__-tbs-lines tr{border-bottom:1px solid var(--__P__-line)}
.__P__-tbs-lines tr:first-child{border-top:1px solid var(--__P__-line)}
.__P__-tbs-lines th{color:var(--__P__-accent)}
.__P__-tbs-minimal th{border-bottom:2px solid var(--__P__-accent)}
.__P__-tbs-minimal td{border-bottom:1px solid var(--__P__-line)}
.__P__-tbs-striped tr:nth-child(even)>td{background:color-mix(in srgb,var(--__P__-text) 4.5%,transparent)}
.__P__-tbs-striped th{background:var(--__P__-accent);color:var(--__P__-on-accent,#fff)}
.__P__-tb-compact th,.__P__-tb-compact td{padding:.2em .45em}
.__P__-tb-fixed th,.__P__-tb-fixed td{overflow-wrap:break-word}
`,section:`
.__P__-sec-title .__P__-sec-t{min-width:0}
`,columns:`
.__P__-colsb{display:flex;gap:var(--__P__-cg,6mm);align-items:flex-start}
.__P__-va-center{align-items:center}
.__P__-va-bottom{align-items:flex-end}
.__P__-colb{min-width:0}
@media screen and (max-width:760px){.__P__-colsb{flex-direction:column;align-items:stretch}.__P__-colb{flex:none!important;width:100%}}
`,quote:`
.__P__-qt{--tone:var(--__P__-muted);display:flex;gap:.7em;padding:.72em .95em;border-inline-start:3px solid var(--tone);border-radius:var(--__P__-radius);border-start-start-radius:0;border-end-start-radius:0;background:color-mix(in srgb,var(--tone) 8%,transparent)}
.__P__-qt-info{--tone:#2563eb}
.__P__-qt-success{--tone:#16a34a}
.__P__-qt-warning{--tone:#d97706}
.__P__-qt-accent{--tone:var(--__P__-accent)}
.__P__-qt-ic{color:var(--tone);width:1.3em;height:1.3em;margin-top:.04em}
.__P__-qt-body{flex:1;min-width:0}
`,divider:`
.__P__-hr{border:0;border-top:var(--__P__-hrw,1px) solid color-mix(in srgb,var(--__P__-text) 22%,transparent);margin:0;height:0}
.__P__-hr-dashed{border-top-style:dashed}
.__P__-hr-dotted{border-top-style:dotted}
.__P__-hr-double{border-top-style:double;border-top-width:max(3px,var(--__P__-hrw,1px))}
.__P__-hr-accent{border-top-color:var(--__P__-accent)}
`,spacer:`
.__P__-sp{display:block}
.__P__-b.__P__-b-spacer{margin-bottom:var(--__P__-mb,0)}
`,pagebreak:`
.__P__-b.__P__-b-pagebreak{margin:0}
@media print{.__P__-b-pagebreak{break-after:page;height:0;overflow:hidden}}
`,image:`
.__P__-fig{margin:0;max-width:100%}
.__P__-fig.__P__-al-center{margin-inline:auto}
.__P__-fig.__P__-al-right{margin-inline-start:auto}
.__P__-img{display:block;width:100%;height:auto}
.__P__-img.__P__-sh-circle{aspect-ratio:1;object-fit:cover}
.__P__-fig a{display:block}
.__P__-cap{font-size:.84em;color:var(--__P__-muted);margin-top:.45em;text-align:center}
`,attachment:`
.__P__-att-card .__P__-att-head{padding:.5em .75em}
`,qr:`
.__P__-qr{margin:0;display:flex;flex-direction:column;gap:.35em;width:max-content;max-width:100%}
.__P__-qr.__P__-al-center{margin-inline:auto;align-items:center;text-align:center}
.__P__-qr.__P__-al-right{margin-inline-start:auto;align-items:flex-end;text-align:end}
.__P__-qr-code{display:block;max-width:100%}
.__P__-qr-code svg{display:block;width:100%;height:auto}
.__P__-qr-a{display:block;line-height:0}
.__P__-qr-l{font-size:.8em;color:var(--__P__-muted);max-width:16em;line-height:1.3}
.__P__-qr-ph{display:flex;align-items:center;justify-content:center;border:1.5px dashed var(--__P__-line);border-radius:4px;color:var(--__P__-muted)}
`,appendix:`
.__P__-appendix{margin-top:calc(var(--__P__-bs) * 2)}
.__P__-app-list{display:grid;gap:calc(var(--__P__-gap) * 3mm)}
.__P__-app-embed .__P__-app-list{gap:calc(var(--__P__-gap) * 5mm)}
@media print{.__P__-app-embed{break-before:page}}
`,};const BLOCK_DEPS={attachment:['att'],appendix:['att']};const CSS_HEADS={line:`.__P__-h-line .__P__-hx{color:var(--__P__-accent);padding-bottom:.32em;border-bottom:1.5px solid color-mix(in srgb,var(--__P__-accent) 32%,transparent)}`,band:`.__P__-h-band .__P__-hx{background:var(--__P__-accent);color:var(--__P__-on-accent,#fff);padding:.34em .72em;border-radius:var(--__P__-radius);font-size:1.04em;letter-spacing:.02em}.__P__-h-band .__P__-hx .__P__-hd-ic{color:inherit}`,plain:`.__P__-h-plain .__P__-hx{color:var(--__P__-accent)}`,caps:`.__P__-h-caps .__P__-hx{text-transform:uppercase;letter-spacing:.14em;font-size:.86em}.__P__-h-caps .__P__-hx::after{content:"";flex:1 1 2em;height:1px;background:var(--__P__-line);margin-inline-start:.5em}`,underline:`.__P__-h-underline .__P__-hx::after{content:"";flex:0 0 100%;height:3px;margin-top:.32em;border-radius:2px;background:linear-gradient(90deg,var(--__P__-accent) 2.6em,transparent 2.6em)}[dir=rtl] .__P__-h-underline .__P__-hx::after,.__P__-h-underline[dir=rtl] .__P__-hx::after{background:linear-gradient(270deg,var(--__P__-accent) 2.6em,transparent 2.6em)}`,side:`.__P__-h-side .__P__-hx{border-inline-start:4px solid var(--__P__-accent);padding:.06em 0;padding-inline-start:.55em}`,};const KA_NOCAPS={'':['.__P__-hx'],heading:['.__P__-hd4']};function kaNoCapsCSS(types,edit){const sel=[];const all={...KA_NOCAPS,...ext().kaNoCaps};for(const k of Object.keys(all))if(!k||types.has(k))sel.push(...all[k]);const s=sel.join(',');const self=edit?s+',.__P__-pbk':s;return`html[lang|=ka] .__P__-root :is(${self}),.__P__-root :is(${self}):lang(ka),.__P__-root :is(${s}) :lang(ka){text-transform:none}`;}
function layoutCSS(doc,type){const sw=num(doc.layout.sideWidth,32,15,50);const box=`{background:var(--__P__-side-bg);color:var(--__P__-side-text,var(--__P__-text));padding:calc(var(--__P__-gap) * 5mm) calc(var(--__P__-gap) * 4.6mm);border-radius:var(--__P__-radius);align-self:stretch}`;switch(type){case'single':return`.__P__-l-single .__P__-cols{display:flex;flex-direction:column;align-items:stretch;gap:var(--__P__-bs)}.__P__-l-single .__P__-cols>*{min-width:0;max-width:100%}.__P__-l-single .__P__-mcol{order:1}.__P__-l-single .__P__-side{order:2}.__P__-l-single.__P__-ss-before .__P__-side{order:0}`;case'sidebar-left':return`.__P__-l-sidebar-left .__P__-cols{grid-template-columns:minmax(0,${sw}fr) minmax(0,${100-sw}fr)}.__P__-l-sidebar-left .__P__-side${box}`;case'sidebar-right':return`.__P__-l-sidebar-right .__P__-cols{grid-template-columns:minmax(0,${100-sw}fr) minmax(0,${sw}fr)}.__P__-l-sidebar-right .__P__-side{grid-column:2;grid-row:1}.__P__-l-sidebar-right .__P__-mcol{grid-column:1;grid-row:1}.__P__-l-sidebar-right .__P__-side${box}`;case'two-col':return`.__P__-l-two-col .__P__-cols{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}`;default:return'';}}
const CSS_FEAT={links:`
.__P__-xref{text-decoration-style:dotted}
[id^="att-"],[id^="b-"]{scroll-margin-top:18px}
.__P__-flash{animation:__P__-flash 1.8s ease-out}
@keyframes __P__-flash{0%,35%{box-shadow:0 0 0 4px color-mix(in srgb,var(--__P__-accent) 45%,transparent);background-color:color-mix(in srgb,var(--__P__-accent) 9%,transparent)}100%{box-shadow:0 0 0 4px transparent}}
`,attach:`
.__P__-b-attachment img[data-att-img],.__P__-app-item img[data-att-img]{cursor:zoom-in}
.__P__-b-attachment img[data-att-img]:focus-visible,.__P__-app-item img[data-att-img]:focus-visible{outline:2px solid var(--__P__-accent);outline-offset:2px}
.__P__-lb{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;padding:3vmin;background:rgba(10,12,16,.86);cursor:zoom-out;animation:__P__-fade .18s ease-out}
.__P__-lb img{max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;box-shadow:0 12px 50px rgba(0,0,0,.5);background:#fff}
.__P__-lb-x{position:absolute;top:12px;inset-inline-end:12px;width:1px;height:1px;padding:0;margin:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;background:none;color:#fff;font:600 22px/1 system-ui,sans-serif;cursor:pointer}
.__P__-lb-x:focus-visible{width:40px;height:40px;clip:auto;border-radius:50%;background:rgba(255,255,255,.16);outline:2px solid #fff;outline-offset:2px}
@keyframes __P__-fade{from{opacity:0}}
@media print{.__P__-lb{display:none!important}}
`,};const CSS_TOOLBAR=`
.__P__-toolbar{position:fixed;z-index:1000;display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:4px;max-width:calc(100vw - 24px);border-radius:999px;background:rgba(255,255,255,.9);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:0 1px 2px rgba(0,0,0,.08),0 6px 24px rgba(15,23,42,.16);border:1px solid rgba(15,23,42,.08);font:500 13px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Georgian",Sylfaen,sans-serif;color:#1f2937}
.__P__-tb-top-right{top:14px;right:14px}.__P__-tb-top-left{top:14px;left:14px}.__P__-tb-bottom-right{bottom:14px;right:14px}.__P__-tb-bottom-left{bottom:14px;left:14px}
.__P__-tb-lang,.__P__-tb-btn{-webkit-appearance:none;appearance:none;border:0;background:none;color:inherit;font:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:6px 11px;border-radius:999px;transition:background-color .15s,color .15s}
.__P__-tb-lang:hover,.__P__-tb-btn:hover{background:rgba(15,23,42,.07)}
.__P__-tb-lang[aria-pressed="true"]{background:var(--__P__-a0);color:var(--__P__-on-a0,#fff)}
.__P__-tb-sel{border:0;background:transparent;color:inherit;font:inherit;min-height:32px;padding:4px 8px;border-radius:999px;cursor:pointer}
.__P__-tb-sep{width:1px;height:18px;background:rgba(15,23,42,.14);margin:0 3px}
.__P__-toolbar :focus-visible{outline:2px solid var(--__P__-a0);outline-offset:1px}
.__P__-toolbar .__P__-ic{width:17px;height:17px}
.__P__-tb-btn .__P__-i-sun{display:none}
@media screen and (max-width:760px){.__P__-toolbar{top:auto!important;left:0!important;right:0!important;bottom:calc(12px + env(safe-area-inset-bottom,0px))!important;margin-inline:auto;width:max-content;max-width:calc(100vw - 24px);transform:none;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.__P__-toolbar::-webkit-scrollbar{display:none}.__P__-tb-lang,.__P__-tb-btn,.__P__-tb-sel{flex:none}.__P__-tb-txt{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.__P__-root.__P__-root .__P__-page{padding-bottom:calc(64px + env(safe-area-inset-bottom,0px))}}
@media screen and (max-width:420px){.__P__-tb-sep{display:none}}
@media print{.__P__-toolbar{display:none!important}}
.__P__-tb-lc{display:none}
@media screen and (min-width:761px){.__P__-toolbar{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.__P__-toolbar::-webkit-scrollbar{display:none}.__P__-tb-lang,.__P__-tb-btn,.__P__-tb-sel{flex:none}}
`;const TB_HIDE='{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}';function toolbarCSS(doc){const paper=!!doc.output.paper;const top=/^top-/.test(doc.output.toolbarPos||'top-right');const bp=paper?1100:1320;let s=CSS_TOOLBAR+`@media screen and (min-width:761px) and (max-width:${bp-1}px){.__P__-tb-lc{display:inline}.__P__-tb-ln,.__P__-tb-txt${TB_HIDE}`;if(top)s+=paper?'.__P__-root.__P__-paper{padding-top:72px}':'.__P__-root .__P__-page{padding-top:72px}';s+='}';if(top){const t='.__P__-toolbar.__P__-toolbar';s+=`@media screen and (min-width:${bp}px){${t}{flex-direction:column;align-items:stretch;border-radius:16px;overflow:auto;max-height:calc(100vh - 28px)}`
+`${t} .__P__-tb-lang,${t} .__P__-tb-btn{justify-content:center;border-radius:12px}${t} .__P__-tb-sep{width:auto;height:1px;margin:3px 6px}${t} .__P__-tb-txt${TB_HIDE}}`;}
return s+'\n';}
const CSS_TOOLBAR_DARK=`.__P__-toolbar{background:rgba(28,32,38,.9);color:#e5e7eb;border-color:rgba(255,255,255,.1)}.__P__-tb-lang:hover,.__P__-tb-btn:hover{background:rgba(255,255,255,.1)}.__P__-tb-sep{background:rgba(255,255,255,.16)}.__P__-tb-btn .__P__-i-sun{display:inline}.__P__-tb-btn .__P__-i-moon{display:none}`;const CSS_EDIT=`
.__P__-root[data-mode=edit] .__P__-page{width:var(--__P__-pw);max-width:none;min-height:var(--__P__-ph);margin:0 auto;padding:var(--__P__-m);background:linear-gradient(to bottom,transparent calc(100% - 1px),rgba(220,38,38,.38) calc(100% - 1px)) 0 0/100% var(--__P__-page-ch) repeat-y content-box,var(--__P__-bg);box-shadow:0 1px 3px rgba(15,23,42,.1),0 8px 28px rgba(15,23,42,.12)}
.__P__-root[data-mode=edit] .__P__-f{outline:none;cursor:text;border-radius:2px;min-width:1ch;transition:background-color .12s,box-shadow .12s}
.__P__-root[data-mode=edit] span.__P__-f:empty{display:inline-block;min-width:2em}
.__P__-root[data-mode=edit] .__P__-f:empty::before{content:attr(data-ph);color:var(--__P__-muted);opacity:.62;font-style:italic;font-weight:400;text-transform:none;letter-spacing:normal;pointer-events:none}
.__P__-root[data-mode=edit] .__P__-f:hover{background-color:color-mix(in srgb,var(--__P__-a0) 6%,transparent)}
.__P__-root[data-mode=edit] .__P__-f:focus{background-color:color-mix(in srgb,var(--__P__-a0) 7%,transparent);box-shadow:0 0 0 2px color-mix(in srgb,var(--__P__-a0) 38%,transparent)}
.__P__-root[data-mode=edit] .__P__-opt:empty::before{opacity:.38}
.__P__-root[data-mode=edit] .__P__-missing{box-shadow:inset 0 -2px 0 rgba(217,119,6,.55)}
.__P__-root[data-mode=edit] .__P__-missing:empty::before{color:#b45309;opacity:.85}
.__P__-root[data-mode=edit] .__P__-hidden{opacity:.38;background-image:repeating-linear-gradient(-45deg,rgba(100,116,139,.13) 0 6px,transparent 6px 12px)}
.__P__-root[data-mode=edit] .__P__-langhidden{opacity:.5;outline:1.5px dashed rgba(217,119,6,.75);outline-offset:2px}
.__P__-root[data-mode=edit] .__P__-print-only{outline:1px dotted rgba(100,116,139,.6);outline-offset:2px}
.__P__-root[data-mode=edit] .__P__-region{min-height:32px}
.__P__-root[data-mode=edit] .__P__-colb,.__P__-root[data-mode=edit] .__P__-sec-body{min-height:40px}
.__P__-root[data-mode=edit] .__P__-colb{align-self:stretch}
.__P__-root[data-mode=edit] .__P__-empty{display:flex;align-items:center;justify-content:center;min-height:44px;padding:10px;border:1.5px dashed color-mix(in srgb,var(--__P__-text) 24%,transparent);border-radius:6px;color:var(--__P__-muted);font:12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;-webkit-user-select:none;user-select:none}
.__P__-root[data-mode=edit] .__P__-pbk{display:flex;align-items:center;gap:10px;padding:8px 0;color:var(--__P__-muted);font:600 10px/1 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.08em;text-transform:uppercase}
.__P__-root[data-mode=edit] .__P__-pbk::before,.__P__-root[data-mode=edit] .__P__-pbk::after{content:"";flex:1;border-top:1.5px dashed currentColor;opacity:.6}
.__P__-root[data-mode=edit] .__P__-att-missing{display:flex;align-items:center;justify-content:center;gap:.5em;min-height:4.5em;padding:1em;border:1.5px dashed var(--__P__-line);border-radius:var(--__P__-radius);color:var(--__P__-muted);font-size:.9em}
.__P__-root[data-mode=edit] .__P__-sp{background:repeating-linear-gradient(-45deg,rgba(100,116,139,.09) 0 5px,transparent 5px 10px)}
.__P__-root[data-mode=edit] .__P__-btn{pointer-events:none}
.__P__-root[data-mode=edit] .__P__-b{min-height:1.2em}
.__P__-root[data-mode=edit] .__P__-add-item{min-height:0;padding:.6em;cursor:pointer}
.__P__-root[data-mode=edit] .__P__-add-item:hover{border-color:var(--__P__-accent);color:var(--__P__-accent)}
`;function pageMargin(doc){const pm=isObj(doc.page.margin)?doc.page.margin:{};return{top:num(pm.top,14,0,60),right:num(pm.right,14,0,60),bottom:num(pm.bottom,14,0,60),left:num(pm.left,14,0,60)};}
function varsCSS(doc,opts,faces){const t=doc.theme;const P=own(PAGE_SIZES,doc.page.size)||PAGE_SIZES.A4;const m=pageMargin(doc);const c=(v,d)=>safeColor(v)||d;const v=[`--__P__-accent:${c(t.accent,'#0f766e')}`,`--__P__-a0:${c(t.accent,'#0f766e')}`,`--__P__-text:${c(t.text,'#1f2937')}`,`--__P__-muted:${c(t.muted,'#5f6672')}`,`--__P__-bg:${c(t.bg,'#ffffff')}`,`--__P__-side-bg:${c(t.sideBg,'#f1f5f9')}`,];if(safeColor(t.sideText))v.push(`--__P__-side-text:${safeColor(t.sideText)}`);const on=onAccent(c(t.accent,'#0f766e'));if(on)v.push(`--__P__-on-accent:${on}`,`--__P__-on-a0:${on}`);v.push(`--__P__-font:${fontStack(doc,t.fontBody,opts,faces,FONT_STACKS)}`,`--__P__-font-h:${fontStack(doc,t.fontHead,opts,faces,FONT_STACKS)}`,`--__P__-size:${num(t.baseSize,10.5,7,16)}pt`,`--__P__-lh:${num(t.lineHeight,1.45,1,2.2)}`,`--__P__-gap:${own(DENSITY,t.density)||1}`,`--__P__-radius:${num(t.radius,6,0,24)}px`,`--__P__-colgap:${num(doc.layout.gap,8,0,30)}mm`,`--__P__-pw:${P.w}mm`,`--__P__-ph:${P.h}mm`,`--__P__-m:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm`,`--__P__-page-h:${P.h}mm`,`--__P__-page-ch:${round(P.h-m.top-m.bottom,2)}mm`,);const sel=opts.mode!=='edit'&&opts.toolbar?'.__P__-root,.__P__-toolbar':'.__P__-root';return`${sel}{${v.join(';')}}`;}
function viewPageCSS(doc){const paper=doc.output.paper;const bg=safeColor(doc.theme.bg)||'#ffffff';let s='body{margin:0}';if(paper){s+='html{background:#e9ecef}.__P__-root.__P__-paper{padding:32px 16px 56px}'
+'.__P__-paper .__P__-page{width:var(--__P__-pw);max-width:100%;min-height:var(--__P__-ph);padding:var(--__P__-m);margin:0 auto;'
+'box-shadow:0 1px 3px rgba(15,23,42,.08),0 12px 36px rgba(15,23,42,.13);border-radius:3px}';}else{s+=`html{background:${bg}}.__P__-page{max-width:1000px;margin:0 auto;padding:clamp(22px,5vw,56px) clamp(18px,4vw,48px)}`;}
return s;}
const CSS_RESPONSIVE=`@media screen and (max-width:760px){.__P__-root.__P__-paper{padding:0}.__P__-paper .__P__-page{width:auto;min-height:0;padding:24px 18px 36px;box-shadow:none;border-radius:0}.__P__-root{font-size:max(var(--__P__-size),14.5px)}.__P__-root .__P__-cols{display:flex;flex-direction:column;align-items:stretch;gap:var(--__P__-bs)}.__P__-root .__P__-cols>*{min-width:0;max-width:100%}.__P__-root .__P__-mcol{order:1}.__P__-root .__P__-side{order:2}.__P__-root.__P__-ss-before .__P__-side{order:0}`
+'.__P__-root.__P__-side-id .__P__-cols{gap:0}.__P__-root.__P__-side-id .__P__-side{display:contents}.__P__-root.__P__-root.__P__-side-id .__P__-side{--__P__-accent:inherit;--__P__-on-accent:inherit;--__P__-muted:inherit;--__P__-bg:inherit;color:inherit}'
+'.__P__-root.__P__-side-id .__P__-side>.__P__-b{order:2;margin-bottom:var(--__P__-bs)}.__P__-root.__P__-side-id .__P__-side>.__P__-hoist{order:0}.__P__-root.__P__-side-id .__P__-mcol{order:1;margin:var(--__P__-bs) 0}}';function darkBlock(doc,pre){const a=safeColor(doc.theme.accent)||'#0f766e';const da=darkAccent(a);const vars=`--__P__-bg:${DARK_BG};--__P__-text:#e6e8eb;--__P__-muted:#9ba3ae;--__P__-side-bg:#1d2229;`
+(da?`--__P__-accent:${da};--__P__-on-accent:${onAccent(da)}`:`--__P__-accent:color-mix(in oklab,${a} 60%,#fff);--__P__-on-accent:#fff`);const htmlBg=doc.output.paper?'#0b0d10':'#16191e';return`${pre}{background:${htmlBg};color-scheme:dark}${pre} .__P__-root{${vars}}`
+`${pre} .__P__-table [style*="background"],${pre} .__P__-b[style*="background"]{color:#1f2937;--__P__-muted:#4b5563}`
+`${pre} .__P__-paper .__P__-page{box-shadow:0 0 0 1px rgba(255,255,255,.06),0 12px 36px rgba(0,0,0,.5)}`
+CSS_TOOLBAR_DARK.replace(/(^|\})([^{}]+)\{/g,(m,b,sel)=>`${b}${sel.split(',').map((s)=>pre+' '+s.trim()).join(',')}{`);}
function darkCSS(doc){const block=(pre)=>darkBlock(doc,pre);const sch=doc.theme.scheme;if(sch==='dark')return`@media screen{${block('html:not([data-scheme=light])')}}`;let s=`@media screen{${block('html[data-scheme=dark]')}}`;if(sch==='auto')s+=`@media screen and (prefers-color-scheme:dark){${block('html:not([data-scheme=light])')}}`;return s;}
const PRINT_KEEP={attachment:'.__P__-att',appendix:'.__P__-att',quote:'.__P__-qt',image:'.__P__-fig',qr:'.__P__-qr'};function printCSS(doc,use){const m=pageMargin(doc);const size=own({A4:'A4',Letter:'letter',Legal:'legal'},doc.page.size)||'A4';const pk={...PRINT_KEEP,...ext().printKeep};const keep=['.__P__-keep',...new Set([...use.types].map((t)=>own(pk,t)).filter(Boolean))].join(',');const pa=doc.output.printAttachments;const paRule=!use.types.has('attachment')&&!use.types.has('appendix')?'':pa==='hide'?'.__P__-pa-hide .__P__-b-attachment{display:none!important}':pa==='images'?'.__P__-pa-images .__P__-att-prev:not(.__P__-att-img){display:none!important}':'.__P__-pa-card .__P__-att-prev{display:none!important}';return`@page{size:${size};margin:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm}
@media screen{.__P__-print-only{display:none!important}}
@media print{html,body{background:#fff!important}
.__P__-root,.__P__-root.__P__-paper{padding:0!important}
.__P__-page{width:auto!important;max-width:none!important;min-height:0!important;margin:0!important;padding:0!important;box-shadow:none!important;border-radius:0!important}
.__P__-noprint,.__P__-screen-only{display:none!important}
${keep}{break-inside:avoid}
.__P__-brk{break-before:page}
.__P__-root h1,.__P__-root h2,.__P__-root h3,.__P__-root h4,.__P__-hx{break-after:avoid}
${use.types.has('table')?'.__P__-tbl{overflow:visible}':''}
${/^sidebar-/.test(doc.layout.type)?'.__P__-side{-webkit-box-decoration-break:clone;box-decoration-break:clone}':''}
.__P__-root a{text-decoration:none}
${paRule}}`;}
function pageBoxCSS(doc,lang){const P=doc.page;const header=htmlToText(pickText(P.header,lang,doc));const footer=htmlToText(pickText(P.footer,lang,doc));const boxes=[];const fk=doc.theme.fontBody;const ff=own(FONT_STACKS,fk)?fontStack(doc,fk,{},new Map(),FONT_STACKS):FONT_STACKS.sans;const box=(pos,content)=>`@${pos}{content:${content};font-family:${ff};font-size:8pt;color:#6b7280}`;const rtl=langDir(lang)==='rtl';if(header)boxes.push(box('top-center',cssStr(header)));if(footer)boxes.push(box(rtl?'bottom-right':'bottom-left',cssStr(footer)));if(P.pageNumbers){let c;if(P.numberFormat==='n')c='counter(page)';else if(P.numberFormat==='page'){c=uiText('pageOf',lang,doc).split(/(\{n\}|\{N\})/).filter(Boolean).map((p)=>(p==='{n}'?'counter(page)':p==='{N}'?'counter(pages)':cssStr(p))).join(' ');}else c='counter(page) " / " counter(pages)';boxes.push(box(footer?(rtl?'bottom-left':'bottom-right'):'bottom-center',c));}
return boxes.length?`@page{${boxes.join('')}}${header?'@page :first{@top-center{content:none}}':''}`:'';}
const CLASS_OWNER=[[/\.__P__-(table|tbl|tbs-|tb-)/,'table'],[/\.__P__-qt/,'quote'],[/\.__P__-hr/,'divider'],[/\.__P__-(fig|img)\b/,'image'],[/\.__P__-qr/,'qr'],[/\.__P__-att/,'att'],[/\.__P__-tag\b/,'chips'],[/\.__P__-(meter|dots|seg)\b/,'meter'],];function buildCSS(doc,opts={}){doc=ensureDoc(doc);const edit=opts.mode==='edit';const use=edit?null:opts.usage||collectUsage(doc,opts);const faces=new Map();const out=[];const vars=varsCSS(doc,{...opts,toolbar:!edit&&!!use.toolbar},faces);for(const f of faces.values())out.push(f);out.push(vars,CSS_BASE);if(!edit)out.push(viewPageCSS(doc));const types=new Set(edit?Object.keys(BLOCK_TYPES):use.types);const shared=new Set();const X=ext();for(const t of types)for(const s of own(X.deps,t)||own(BLOCK_DEPS,t)||[])shared.add(s);for(const k of Object.keys(CSS_SHARED))if(shared.has(k))out.push(CSS_SHARED[k]);for(const k of[...Object.keys(BLOCK_TYPES),'appendix']){const css=own(X.blocks,k)??own(CSS_BLOCKS,k);if(types.has(k)&&css)out.push(css);}
for(const l of edit?LAYOUTS:[doc.layout.type])out.push(layoutCSS(doc,l));out.push(own(CSS_HEADS,doc.theme.headingStyle)||'');const th=own(THEMES,doc.theme.preset);if(th&&typeof th.css==='string'&&th.css)out.push(edit?th.css:shakeRules(th.css,[...X.classOwner||[],...CLASS_OWNER],(o)=>types.has(o)||shared.has(o)));if(edit||[...use.langs,...doc.langs].some((l)=>primary(l)==='ka'))out.push(kaNoCapsCSS(types,edit));if(edit){out.push(CSS_EDIT+(X.edit||''));if(opts.darkPreview)out.push(darkBlock(doc,'[data-scheme=dark]'));}else{out.push(CSS_RESPONSIVE);for(const f of FEATURE_ORDER)if(use.features.has(f)&&CSS_FEAT[f])out.push(CSS_FEAT[f]);if(use.toolbar)out.push(toolbarCSS(doc));if(use.langs.length>1)out.push(langCSS(use.langs));if(doc.theme.scheme!=='light'||doc.output.themeToggle)out.push(darkCSS(doc));out.push(printCSS(doc,use));}
return out.filter(Boolean).join('\n').replace(/\n{2,}/g,'\n').trim().replace(/__P__/g,P.prefix)+'\n';}
function ext(){return P.paperCSS||{};}
export{buildCSS,pageBoxCSS};