import{parseColor,contrastRatio,onAccent}from"./color/color.js";import{collectUsage}from"./doc/render.js";import{ensureDoc}from"./doc/model.js";import{fontStack,shakeRules,langCSS}from"./doc/css.js";import{BLOCK_TYPES,THEMES}from"./doc/product.js";import{primary}from"./i18n/lang.js";import{own,isObj}from"./util/value.js";const GEO_SANS='"Noto Sans Georgian", "BPG Glaho", "BPG Arial", Sylfaen, "DejaVu Sans"';const GEO_SERIF='"Noto Serif Georgian", "BPG Nino Medium", Sylfaen, "DejaVu Serif"';const FONT_STACKS={sans:'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", '+GEO_SANS+', sans-serif',humanist:'"Segoe UI", Candara, Optima, "Fira Sans", "PT Sans", Ubuntu, "Noto Sans", '+GEO_SANS+', sans-serif',geometric:'Avenir, "Avenir Next", Montserrat, "Century Gothic", Futura, "Trebuchet MS", "Noto Sans", '+GEO_SANS+', sans-serif',rounded:'ui-rounded, "SF Pro Rounded", Nunito, "Varela Round", "Segoe UI", "Noto Sans", '+GEO_SANS+', sans-serif',serif:'Charter, "Bitstream Charter", "Sitka Text", Cambria, "PT Serif", Georgia, "Noto Serif", '+GEO_SERIF+', serif',slab:'Rockwell, "Rockwell Nova", "Roboto Slab", "Zilla Slab", "Noto Serif", Georgia, '+GEO_SERIF+', serif',condensed:'"Bahnschrift SemiCondensed", "Roboto Condensed", "Avenir Next Condensed", "Arial Narrow", "Liberation Sans Narrow", "Noto Sans", '+GEO_SANS+', sans-serif',mono:'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Noto Sans Mono", '+GEO_SANS+', monospace',};const THEMES_FD={clean:{vars:{accent:'#2563eb',accent2:'#0ea5e9',bg:'#ffffff',surface:'#f4f6f9',text:'#1f2937',muted:'#5b6472',border:'#dfe3ea',fontBody:'sans',fontHead:'sans',radius:12,buttons:'solid',scheme:'auto'},css:'',},hearth:{vars:{accent:'#c2410c',accent2:'#d97706',bg:'#fffaf3',surface:'#fbf1e4',text:'#2b1d14',muted:'#6b5747',border:'#ead9c4',fontBody:'humanist',fontHead:'serif',radius:16,buttons:'pill',scheme:'light'},css:['.fd-t-hearth .fd-h1,.fd-t-hearth .fd-h2{font-weight:700;letter-spacing:-.01em}','.fd-t-hearth .fd-eyebrow{font-family:var(--fd-font-h);font-style:italic;text-transform:none;letter-spacing:0;font-size:1.05em}','.fd-t-hearth .fd-hero-img{border-radius:999px 999px var(--fd-radius) var(--fd-radius)}','.fd-t-hearth .fd-don{box-shadow:0 18px 40px -24px rgba(120,53,15,.45)}',].join('\n'),},source:{vars:{accent:'#047857',accent2:'#0e7490',bg:'#fbfcfb',surface:'#eef4f1',text:'#10201a',muted:'#4b5e55',border:'#d3e2da',fontBody:'sans',fontHead:'geometric',radius:8,buttons:'square',scheme:'auto'},css:['.fd-t-source .fd-eyebrow{font-family:ui-monospace,"Cascadia Code",Menlo,Consolas,monospace;text-transform:none;letter-spacing:0}','.fd-t-source .fd-eyebrow::before{content:"$ ";color:var(--fd-accent2)}','.fd-t-source .fd-tier-a,.fd-t-source .fd-raised{font-family:ui-monospace,"Cascadia Code",Menlo,Consolas,monospace}','.fd-t-source .fd-bar-fill{background:repeating-linear-gradient(90deg,var(--fd-accent) 0 10px,color-mix(in srgb,var(--fd-accent) 82%,#fff) 10px 12px)}',].join('\n'),},studio:{vars:{accent:'#7c3aed',accent2:'#db2777',bg:'#fdfbff',surface:'#f5f0fd',text:'#22163a',muted:'#62577a',border:'#e6dcf6',fontBody:'rounded',fontHead:'rounded',radius:20,buttons:'pill',scheme:'auto'},css:['.fd-t-studio .fd-h1{background:linear-gradient(90deg,var(--fd-accent),var(--fd-accent2));-webkit-background-clip:text;background-clip:text;color:transparent}','.fd-t-studio .fd-tier{border-width:2px}','.fd-t-studio .fd-ava{background:linear-gradient(135deg,var(--fd-accent),var(--fd-accent2));color:#fff}',].join('\n'),},schoolyard:{vars:{accent:'#1d4ed8',accent2:'#f59e0b',bg:'#fffdf5',surface:'#fdf6dc',text:'#1c2333',muted:'#575d6c',border:'#ece1bb',fontBody:'humanist',fontHead:'slab',radius:12,buttons:'solid',scheme:'light'},css:['.fd-t-schoolyard .fd-h2::after{content:"";display:block;width:56px;height:5px;margin-top:10px;border-radius:3px;background:var(--fd-accent2)}','.fd-t-schoolyard .fd-al-center .fd-h2::after,.fd-t-schoolyard .fd-don-head .fd-h2::after{margin-inline:auto}','.fd-t-schoolyard .fd-bar-fill{background:var(--fd-accent2)}',].join('\n'),},alert:{vars:{accent:'#dc2626',accent2:'#f97316',bg:'#ffffff',surface:'#f5f5f5',text:'#111111',muted:'#4d4d4d',border:'#dcdcdc',fontBody:'sans',fontHead:'condensed',radius:4,buttons:'square',scheme:'light'},css:['.fd-t-alert .fd-h1,.fd-t-alert .fd-h2{text-transform:uppercase;letter-spacing:.01em;font-weight:800}','.fd-t-alert .fd-eyebrow{background:var(--fd-accent);color:var(--fd-on-accent);padding:4px 10px;display:inline-block;justify-self:start}','.fd-t-alert .fd-hero-center .fd-eyebrow{justify-self:center}','.fd-t-alert .fd-bar{height:16px;border-radius:0}','.fd-t-alert .fd-bar-fill{border-radius:0;background:var(--fd-accent)}',].join('\n'),},};const hex=(rgb)=>'#'+rgb.map((v)=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');function mix(a,b,t){const x=parseColor(a);const y=parseColor(b);if(!x||!y)return a;return hex(x.map((v,i)=>v+(y[i]-v)*t));}
function ensure(c,bg,ratio,to){let out=c;for(let k=0;k<=20&&!(contrastRatio(out,bg)>=ratio);k++)out=mix(c,to,k/20);return out;}
function palette(th,dark){if(!dark){const link=ensure(th.accent,th.bg,4.5,'#000000');return{accent:th.accent,onAccent:onAccent(th.accent)||'#fff',accentH:mix(th.accent,'#000000',0.12),accent2:th.accent2,link,bg:th.bg,surface:th.surface,text:th.text,muted:ensure(th.muted,th.surface,4.5,th.text),border:th.border,borderS:ensure(mix(th.border,th.text,0.25),th.bg,3,th.text),tint:mix(th.bg,th.accent,0.1),tint2:mix(th.bg,th.accent2,0.1),ok:'#15803d',danger:'#b91c1c',shadow:'0 10px 30px -18px rgba(15,23,42,.35)',shadowLg:'0 30px 60px -30px rgba(15,23,42,.45)',scheme:'light',};}
const bg=mix('#111318',th.accent,0.05);const surface=mix(bg,'#ffffff',0.055);const accent=ensure(th.accent,bg,4.5,'#ffffff');const accent2=ensure(th.accent2,bg,3,'#ffffff');return{accent,onAccent:onAccent(accent)||'#111827',accentH:mix(accent,'#ffffff',0.12),accent2,link:accent,bg,surface,text:'#eceef2',muted:ensure('#a3abb8',surface,4.5,'#ffffff'),border:mix(bg,'#ffffff',0.13),borderS:mix(bg,'#ffffff',0.3),tint:mix(bg,accent,0.16),tint2:mix(bg,accent2,0.14),ok:'#4ade80',danger:'#f87171',shadow:'0 10px 30px -18px rgba(0,0,0,.7)',shadowLg:'0 30px 60px -30px rgba(0,0,0,.8)',scheme:'dark',};}
const palVars=(p)=>`--fd-accent:${p.accent};--fd-on-accent:${p.onAccent};--fd-accent-h:${p.accentH};--fd-accent2:${p.accent2};--fd-link:${p.link};`
+`--fd-bg:${p.bg};--fd-surface:${p.surface};--fd-text:${p.text};--fd-muted:${p.muted};--fd-border:${p.border};--fd-border-s:${p.borderS};`
+`--fd-tint:${p.tint};--fd-tint2:${p.tint2};--fd-ok:${p.ok};--fd-danger:${p.danger};--fd-shadow:${p.shadow};--fd-shadow-lg:${p.shadowLg};color-scheme:${p.scheme}`;function varsCSS(doc,opts,faces){const th=doc.theme;const edit=opts.mode==='edit';const sel=edit?'.fd-root':':root';const L=palette(th,false);const D=palette(th,true);const font=fontStack(doc,th.fontBody,opts,faces,FONT_STACKS);const fontH=fontStack(doc,th.fontHead,opts,faces,FONT_STACKS);const btnR=th.buttons==='pill'?'999px':th.buttons==='square'?'2px':'var(--fd-radius-s)';const shape=`--fd-font:${font};--fd-font-h:${fontH};--fd-fs:${th.baseSize}px;--fd-radius:${th.radius}px;--fd-radius-s:${Math.max(2,Math.round(th.radius*0.66))}px;`
+`--fd-btn-r:${btnR};--fd-w:${th.width}px;--fd-gap:24px;--fd-gut:clamp(16px,4cqi,32px);--fd-sec:clamp(40px,7cqi,96px);--fd-bs:clamp(18px,2.4cqi,28px)`;let s=`${sel}{${shape};${palVars(th.scheme==='dark'?D:L)}}\n`;if(edit){s+=`[data-scheme=dark] .fd-root{${palVars(D)}}\n`;return s;}
if(th.scheme==='dark')s+=`:root[data-scheme=light]{${palVars(L)}}\n`;else{s+=`:root[data-scheme=dark]{${palVars(D)}}\n`;if(th.scheme==='auto')s+=`@media (prefers-color-scheme:dark){:root:not([data-scheme=light]){${palVars(D)}}}\n`;}
return s;}
const CSS_BASE=`
.fd-root{container:fd/inline-size;background:var(--fd-bg);color:var(--fd-text);font-family:var(--fd-font);font-size:var(--fd-fs);line-height:1.6;-webkit-text-size-adjust:100%;text-rendering:optimizeLegibility}
.fd-root *,.fd-root *::before,.fd-root *::after{box-sizing:border-box}
.fd-root img{max-width:100%}
.fd-root a{color:var(--fd-link)}
.fd-root :focus-visible{outline:3px solid color-mix(in srgb,var(--fd-accent) 70%,transparent);outline-offset:2px}
.fd-wrap{max-width:var(--fd-w);margin-inline:auto;padding-inline:var(--fd-gut)}
.fd-narrow{max-width:min(var(--fd-w),820px)}
.fd-wide{max-width:calc(var(--fd-w) + 200px)}
.fd-main>.fd-top:not(.fd-b-hero):not(.fd-b-section){padding-block:calc(var(--fd-sec) * .5)}
.fd-main>.fd-top:not(.fd-b-hero):not(.fd-b-section):first-child{padding-top:var(--fd-sec)}
.fd-main>.fd-top:not(.fd-b-hero):not(.fd-b-section):last-child{padding-bottom:var(--fd-sec)}
.fd-tone-muted{background:var(--fd-surface)}
.fd-tone-accent{background:var(--fd-tint)}
.fd-tone-dark{background:#14171c;color:#eef0f3;--fd-text:#eef0f3;--fd-muted:#b3bac6;--fd-surface:#1d2128;--fd-border:#2d333d;--fd-border-s:#4a5260;--fd-bg:#14171c;--fd-link:#9cc4ff}
.fd-h1{font-family:var(--fd-font-h);font-size:clamp(2em,1.3em + 3cqi,3.3em);line-height:1.1;margin:0;font-weight:800;letter-spacing:-.02em;text-wrap:balance}
.fd-h2{font-family:var(--fd-font-h);font-size:clamp(1.5em,1.1em + 1.6cqi,2.15em);line-height:1.2;margin:0 0 .3em;font-weight:750;letter-spacing:-.01em;text-wrap:balance}
.fd-eyebrow{margin:0;font-size:.82em;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--fd-link)}
.fd-lead{margin:0;color:var(--fd-muted);font-size:1.08em;max-width:44em}
.fd-blk-head{margin-bottom:clamp(14px,2cqi,24px)}
.fd-blk-head .fd-h2{margin-bottom:.25em}
.fd-rich>:first-child{margin-top:0}
.fd-rich>:last-child{margin-bottom:0}
.fd-rich h3,.fd-rich h4{font-family:var(--fd-font-h);line-height:1.3}
.fd-rich blockquote{margin:1em 0;padding-inline-start:1em;border-inline-start:3px solid var(--fd-accent);color:var(--fd-muted)}
.fd-rich .fd-i1{margin-inline-start:2em}.fd-rich .fd-i2{margin-inline-start:4em}.fd-rich .fd-i3{margin-inline-start:6em}.fd-rich .fd-i4{margin-inline-start:8em}
.fd-ic{width:1.15em;height:1.15em;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;vertical-align:-.2em}
.fd-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5em;padding:.72em 1.25em;border-radius:var(--fd-btn-r);background:var(--fd-accent);color:var(--fd-on-accent);font:inherit;font-weight:700;line-height:1.2;text-decoration:none;border:2px solid transparent;cursor:pointer;transition:background .15s,transform .15s}
.fd-root a.fd-btn{color:var(--fd-on-accent)}
.fd-btn:hover{background:var(--fd-accent-h)}
.fd-btn-secondary{background:var(--fd-surface);color:var(--fd-text);border-color:var(--fd-border-s)}
.fd-root a.fd-btn-secondary{color:var(--fd-text)}
.fd-btn-secondary:hover{background:var(--fd-tint);border-color:var(--fd-accent)}
.fd-btn-ghost{background:transparent;color:var(--fd-text);border-color:var(--fd-border-s)}
.fd-root a.fd-btn-ghost{color:var(--fd-text)}
.fd-btn-ghost:hover{background:var(--fd-tint)}
.fd-btn-sm{padding:.5em .95em;font-size:.92em}
.fd-btn-lg{padding:.85em 1.6em;font-size:1.06em}
.fd-btn-off{opacity:.5;pointer-events:none}
.fd-btn-ic{width:1.1em;height:1.1em}
.fd-btns{display:flex;flex-wrap:wrap;gap:10px}
.fd-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.fd-muted{color:var(--fd-muted)}
.fd-small{font-size:.88em}
.fd-mono{font-family:ui-monospace,"Cascadia Code",Menlo,Consolas,monospace;font-size:.95em;overflow-wrap:anywhere}
.fd-qr{width:180px;max-width:100%;background:#fff;padding:6px;border-radius:8px;line-height:0}
.fd-qr svg{width:100%;height:auto;display:block}
.fd-dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 14px;margin:0;align-items:baseline}
.fd-dl dt{color:var(--fd-muted);font-size:.9em}
.fd-dl dd{margin:0;overflow-wrap:anywhere}
.fd-addr{margin:0;padding:8px 10px;border-radius:var(--fd-radius-s);background:var(--fd-surface);user-select:all;overflow-wrap:anywhere}
.fd-copyrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.fd-select{font:inherit;padding:8px 10px;border-radius:var(--fd-radius-s);border:1px solid var(--fd-border-s);background:var(--fd-bg);color:var(--fd-text)}
.fd-row2{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.fd-status{display:flex;align-items:center;gap:8px;margin:0;font-weight:600}
.fd-status-ok{color:var(--fd-ok)}
.fd-status-bad{color:var(--fd-danger)}
.fd-status-wait::before{content:"";width:14px;height:14px;flex:none;border-radius:50%;border:2px solid var(--fd-accent);border-right-color:transparent;animation:fd-spin .8s linear infinite}
@keyframes fd-spin{to{transform:rotate(1turn)}}
.fd-prog{display:grid;gap:10px}
.fd-prog-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}
.fd-raised{font-family:var(--fd-font-h);font-size:1.6em;font-weight:800;line-height:1.1;color:var(--fd-text)}
.fd-goal{color:var(--fd-muted)}
.fd-bar{position:relative;height:12px;border-radius:999px;background:color-mix(in srgb,var(--fd-border) 80%,transparent);overflow:hidden}
.fd-bar-lg{height:18px}
.fd-bar-sm{height:8px}
.fd-bar-fill{position:absolute;inset-block:0;inset-inline-start:0;width:var(--p);border-radius:inherit;background:linear-gradient(90deg,var(--fd-accent),var(--fd-accent2));transition:width 1.4s cubic-bezier(.2,.7,.2,1)}
.fd-bar-match{position:absolute;inset-block:0;inset-inline-start:0;width:var(--m);background:repeating-linear-gradient(45deg,transparent 0 6px,rgba(255,255,255,.35) 6px 10px)}
.fd-facts{display:flex;flex-wrap:wrap;gap:6px 18px;color:var(--fd-muted);font-size:.93em}
.fd-fact{display:inline-flex;align-items:center;gap:6px}
.fd-pct{margin-inline-start:auto;font-weight:700;color:var(--fd-link)}
.fd-empty{padding:14px;border:1.5px dashed var(--fd-border-s);border-radius:var(--fd-radius-s);color:var(--fd-muted);text-align:center;font-size:.92em}
.fd-img-ph{display:grid;place-items:center;min-height:180px;border-radius:var(--fd-radius);background:var(--fd-surface);border:1.5px dashed var(--fd-border-s);color:var(--fd-muted)}
.fd-img-ph .fd-ic{width:40px;height:40px}
.fd-tools{display:flex;align-items:center;gap:4px}
.fd-tool-lang,.fd-tool-btn{font:inherit;font-size:.82em;font-weight:700;min-width:36px;height:34px;padding:0 8px;border-radius:999px;border:1px solid transparent;background:transparent;color:var(--fd-muted);cursor:pointer;display:inline-grid;place-items:center}
.fd-tool-lang[aria-pressed=true]{color:var(--fd-text);border-color:var(--fd-border-s);background:var(--fd-surface)}
.fd-tool-lang:hover,.fd-tool-btn:hover{color:var(--fd-text)}
.fd-tool-sel{font:inherit;font-size:.9em;padding:6px 8px;border-radius:var(--fd-radius-s);border:1px solid var(--fd-border-s);background:var(--fd-bg);color:var(--fd-text)}
.fd-i-sun{display:none}
`;const CSS_VIEW=`
html,body{margin:0;background:var(--fd-bg)}
.fd-root{min-height:100vh}
html:not(.fd-js) .fd-js-only{display:none!important}
html.fd-js .fd-nojs-only{display:none!important}
[data-scheme=dark] .fd-i-moon{display:none}[data-scheme=dark] .fd-i-sun{display:inline}
@container fd (max-width:600px){.fd-dev-desktop{display:none!important}}
@container fd (min-width:601px){.fd-dev-mobile{display:none!important}}
html.fd-js .fd-prog:not(.fd-in) .fd-bar-fill{width:0}
@media (prefers-reduced-motion:reduce){.fd-bar-fill{transition:none}.fd-status-wait::before{animation:none}html.fd-js .fd-prog:not(.fd-in) .fd-bar-fill{width:var(--p)}}
@media print{.fd-nav-sticky{position:static}.fd-tools,.fd-toolbar,.fd-don-box,.fd-share{display:none!important}html:not(.fd-js) .fd-js-only{display:none!important}}
`;const CSS_AUTO_ICON='@media (prefers-color-scheme:dark){:root:not([data-scheme=light]) .fd-i-moon{display:none}:root:not([data-scheme=light]) .fd-i-sun{display:inline}}';const CSS_DARK_ICON=':root:not([data-scheme=light]) .fd-i-moon{display:none}:root:not([data-scheme=light]) .fd-i-sun{display:inline}';const CSS_PAGES='html.fd-js .fd-main:not(.fd-on){display:none}';const CSS_TOOLBAR='.fd-toolbar{position:fixed;top:12px;inset-inline-end:12px;z-index:40;display:flex;gap:4px;padding:4px;border-radius:999px;background:color-mix(in srgb,var(--fd-bg) 92%,transparent);border:1px solid var(--fd-border);box-shadow:var(--fd-shadow);backdrop-filter:blur(8px)}';const CSS_EDIT=`
.fd-root[data-mode=edit] .fd-f{outline:none;cursor:text;border-radius:3px;min-width:1ch;transition:background-color .12s,box-shadow .12s}
.fd-root[data-mode=edit] span.fd-f:empty{display:inline-block;min-width:2em}
.fd-root[data-mode=edit] .fd-f:empty::before{content:attr(data-ph);color:currentColor;opacity:.5;font-style:italic;font-weight:400;text-transform:none;letter-spacing:normal;pointer-events:none}
.fd-root[data-mode=edit] .fd-f:hover{background-color:color-mix(in srgb,currentColor 7%,transparent)}
.fd-root[data-mode=edit] .fd-f:focus{background-color:color-mix(in srgb,var(--fd-accent) 9%,transparent);box-shadow:0 0 0 2px color-mix(in srgb,var(--fd-accent) 55%,transparent)}
.fd-root[data-mode=edit] .fd-missing{box-shadow:inset 0 -2px 0 rgba(217,119,6,.65)}
.fd-root[data-mode=edit] .fd-missing:empty::before{color:#d97706;opacity:.95}
.fd-root[data-mode=edit] .fd-hidden{opacity:.4;background-image:repeating-linear-gradient(-45deg,rgba(100,116,139,.15) 0 6px,transparent 6px 12px)}
.fd-root[data-mode=edit] .fd-langhidden{opacity:.55;outline:1.5px dashed rgba(217,119,6,.85);outline-offset:-2px}
.fd-root[data-mode=edit] .fd-b{min-height:1.2em}
.fd-root[data-mode=edit] .fd-empty{display:flex;align-items:center;justify-content:center;min-height:56px;margin:6px 0;-webkit-user-select:none;user-select:none}
.fd-root[data-mode=edit] :is(.fd-header,.fd-main,.fd-footer)>.fd-empty{min-height:76px;margin:12px var(--fd-gut)}
.fd-root[data-mode=edit] .fd-add-item{min-height:0;padding:.7em;cursor:pointer}
.fd-root[data-mode=edit] .fd-add-item:hover{border-color:var(--fd-accent);color:var(--fd-accent)}
.fd-root[data-mode=edit] :is(.fd-btn,.fd-amt,.fd-m,.fd-seg-b,.fd-net){cursor:default;transform:none!important}
.fd-root[data-mode=edit] .fd-btn .fd-f{cursor:text}
.fd-root[data-mode=edit] [data-att-key]{cursor:pointer}
.fd-root[data-mode=edit] [data-att-key]:hover{outline:2px dashed color-mix(in srgb,var(--fd-accent) 75%,transparent);outline-offset:-2px}
.fd-root[data-mode=edit] :is(input,textarea,select,button){pointer-events:none}
.fd-root[data-mode=edit] .fd-main{min-height:240px}
@container fd (max-width:600px){.fd-root[data-mode=edit] .fd-dev-desktop{opacity:.42;outline:1.5px dashed rgba(100,116,139,.75);outline-offset:-2px}}
@container fd (min-width:601px){.fd-root[data-mode=edit] .fd-dev-mobile{opacity:.42;outline:1.5px dashed rgba(100,116,139,.75);outline-offset:-2px}}
`;const kaCSS=(edit)=>`${edit?'.fd-root:lang(ka),.fd-root :lang(ka)':':lang(ka)'}{text-transform:none!important;letter-spacing:normal!important}`;const CSS_BLOCKS={};const CLASS_OWNERS=[];const CSS_FEATURES={};function buildCSS(doc,opts={}){doc=ensureDoc(doc);const edit=opts.mode==='edit';const use=edit?null:opts.usage||collectUsage(doc,opts);const faces=new Map();const types=new Set(edit?Object.keys(BLOCK_TYPES):use.types);const feats=edit?new Set():use.features;const out=[];const vars=varsCSS(doc,{...opts,mode:edit?'edit':'view'},faces);for(const f of faces.values())out.push(f);out.push(vars,CSS_BASE);if(!edit){out.push(CSS_VIEW);if(doc.theme.scheme==='auto')out.push(CSS_AUTO_ICON);if(doc.theme.scheme==='dark')out.push(CSS_DARK_ICON);if(feats.has('pages'))out.push(CSS_PAGES);if(use.toolbar)out.push(CSS_TOOLBAR);}
for(const k of Object.keys(CSS_BLOCKS))if(types.has(k)&&CSS_BLOCKS[k])out.push(CSS_BLOCKS[k]);for(const k of Object.keys(CSS_FEATURES))if(feats.has(k)&&CSS_FEATURES[k])out.push(CSS_FEATURES[k]);const th=own(THEMES,doc.theme.preset);if(isObj(th)&&th.css)out.push(edit?th.css:shakeRules(th.css,CLASS_OWNERS,(o)=>types.has(o)));const langs=edit?doc.langs:use.langs;if(!edit&&langs.length>1)out.push(langCSS(langs));if([...langs,...doc.langs].some((l)=>primary(l)==='ka'))out.push(kaCSS(edit));if(edit)out.push(CSS_EDIT);return out.filter(Boolean).join('\n');}
export{CSS_BLOCKS,CLASS_OWNERS,THEMES_FD,buildCSS,FONT_STACKS,palette};