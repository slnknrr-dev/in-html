import{uid}from"./util/id.js";import{navTools,buttonsHTML,mediaBox}from"./viewer-render.js";import{getPath,isObj,oneOf,num,str}from"./util/value.js";import{escapeAttr,escapeHTML}from"./html/escape.js";import{attOf,isImage,attSrc,mimeBase,hasData}from"./doc/attach.js";import{fld,txt,altAttr,plainIn,di,hrefAttr,addItemBox,ui,feature,renderList,icon,noItems}from"./doc/render.js";import{optList,numOpts}from"./doc/schema.js";import{TONES}from"./viewer-base.js";import{leadLists,navPageLinks}from"./viewer-pages.js";const BA_BTN_KINDS=['primary','secondary','ghost'];const BA_QUOTE_TONES=['note','info','success','warning','accent'];function baItems(b){return Array.isArray(b.items)?b.items:[];}
function baIn(ctx,b,path,kind,phKey,o={}){if(ctx.edit)return fld(ctx,b,path,kind,kind==='rich'?'div':'span',o.cls||'',phKey,o);return txt(ctx,getPath(b,path),kind);}
function baWrap(ctx,b,path,kind,tag,cls,phKey,o){const v=baIn(ctx,b,path,kind,phKey,o);return v?`<${tag} class="${cls}">${v}</${tag}>`:'';}
function baImg(ctx,id,path,cls,o={}){const a=attOf(ctx,id);if(!a||!isImage(a))return'';const src=attSrc(ctx,a);if(!src)return'';const alt=typeof o.alt==='function'?altAttr(ctx,(l)=>o.alt(a,l)):' alt=""';const load=o.load==='high'?' decoding="async" fetchpriority="high"':o.load==='eager'?' decoding="async"':' loading="lazy" decoding="async"';const h=o.h?` height="${o.h}"`:'';return`<img class="${cls}" src="${escapeAttr(src)}"${alt}${h}${load}${ctx.edit?` data-att-key="${escapeAttr(path)}"`:''}>`;}
function baAttTitle(ctx,a,l){return a?plainIn(ctx,a.title,l)||'':'';}
function baEverywhere(ctx,b){if(!isObj(b)||b.hidden||(b.device&&b.device!=='all'))return false;if(!Array.isArray(b.langs)||!b.langs.length)return true;return ctx.langs.every((l)=>b.langs.includes(l)||b.langs.includes(String(l).split('-')[0]));}
function baRenders(ctx,b){if(!isObj(b))return false;if(ctx.edit)return true;if(b.hidden)return false;if(!Array.isArray(b.langs)||!b.langs.length)return true;return ctx.langs.some((l)=>b.langs.includes(l)||b.langs.includes(String(l).split('-')[0]));}
function baHeroBg(ctx,h){const bg=attOf(ctx,h.bg);const v=attOf(ctx,h.bgVideo);const img=bg&&isImage(bg)?bg:null;const vid=v&&/^video\//.test(mimeBase(v.mime))&&hasData(ctx,v)?v:null;return{img,vid};}
function baHeroTone(ctx,h){const t=oneOf(h.tone,['auto','dark','light'],'auto');if(t!=='auto')return t;const m=baHeroBg(ctx,h);return m.img||m.vid?'dark':'';}
function baLeadHero(ctx){let lead=null;for(const list of leadLists(ctx)){const first=list.find((x)=>baRenders(ctx,x));if(!(first&&first.type==='hero'&&baEverywhere(ctx,first)))return null;if(!lead)lead=first;}
return lead;}
function baSecTone(ctx,b){const t=oneOf(b.tone,TONES,'auto');if(t!=='auto')return t;const a=attOf(ctx,b.bgImage);return a&&isImage(a)?'dark':'';}
function baBtnSchema(){return[{key:'label',type:'i18n',label:'f.label'},{key:'href',type:'text',label:'f.href',suggest:'anchors',placeholder:'pl.href'},{key:'kind',type:'select',label:'f.kind',options:optList(...BA_BTN_KINDS)},{key:'icon',type:'icon',label:'f.icon'},];}
const BA_QUOTE_SVG='<svg class="lp-qt-mark" viewBox="0 0 49 36" aria-hidden="true" focusable="false"><path d="M0 36V22C0 9.6 6.4 2.3 19.2 0l2 4.6C14 6.8 10.7 11 10.3 17H20v19zm27 0V22C27 9.6 33.4 2.3 46.2 0l2 4.6C41 6.8 37.7 11 37.3 17H47v19z"/></svg>';const BA_ORN_SVG='<svg class="lp-hr-orn" viewBox="0 0 60 20" aria-hidden="true" focusable="false"><path fill-rule="evenodd" d="M30 1l9 9-9 9-9-9zm0 4l-5 5 5 5 5-5z"/><path d="M30 8l2 2-2 2-2-2zM17 7l3 3-3 3-3-3zM43 7l3 3-3 3-3-3zM0 9.4h11v1.2H0zM49 9.4h11v1.2H49z"/></svg>';const BA_CHECK_SVG='<svg class="lp-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12.5l5 5L20 6.5"/></svg>';function baSvgURL(viewBox,body,stretch){const svg=`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}'${stretch?" preserveAspectRatio='none'":''}>${body}</svg>`;return'url("data:image/svg+xml,'+svg.replace(/</g,'%3C').replace(/>/g,'%3E')+'")';}
const BA_MASK_WAVE=baSvgURL('0 0 1440 80',"<path d='M0 56C160 22 330 6 520 18S860 74 1060 66 1330 30 1440 24V80H0Z'/>",true);const BA_MASK_SLANT=baSvgURL('0 0 1440 80',"<path d='M0 80L1440 0V80Z'/>",true);const BA_MASK_ZIGZAG=baSvgURL('0 0 28 14',"<path d='M0 14L14 0L28 14Z'/>",true);const BA_MASK_ORN=baSvgURL('0 0 48 18',"<path fill-rule='evenodd' d='M24 1l8 8-8 8-8-8zm0 3.6L19.6 9l4.4 4.4L28.4 9z'/><path d='M24 7l2 2-2 2-2-2zM0 5l4 4-4 4zM48 5l-4 4 4 4zM0 8.4h16v1.2H0zM32 8.4h16v1.2H32z'/>",false);function baCutCSS(name,img,h,tile){const size=tile?`${tile} var(--lp-shp)`:'100% var(--lp-shp)';const rep=tile?'repeat-x':'no-repeat';const m=`${img} 0 0/${size} ${rep},linear-gradient(#000 0 0) 0 calc(var(--lp-shp) - 1px)/100% 100% no-repeat`;return`
.lp-b-section:has(>.lp-sh-${name}){--lp-shp:${h};-webkit-mask:${m};mask:${m}}
.lp-b-section:has(>.lp-sh-${name}):not(:first-child){margin-top:calc(-1 * var(--lp-shp))}
.lp-sh-${name}{padding-top:calc(var(--lp-sec-py) + var(--lp-shp))}
`;}
function baRenderNav(b,ctx){const E=ctx.edit;const variant=oneOf(b.variant,['bar','center','split'],'bar');const logoH=Math.round(num(b.logoH,36,20,96));const nameIn=baIn(ctx,b,'brand','plain','pa.brand');const showName=E||!!nameIn;const logo=baImg(ctx,b.logo,'logo','lp-nav-logo',{load:'eager',h:logoH,alt:showName?null:(a,l)=>baAttTitle(ctx,a,l)||plainIn(ctx,ctx.doc.meta&&ctx.doc.meta.title,l)||a.name||'',});const name=nameIn?`<span class="lp-nav-name">${nameIn}</span>`:'';let brand='';if(E)brand=`<span class="lp-nav-brand">${logo}${name}</span>`;else if(logo||name)brand=`<a class="lp-nav-brand" href="#top">${logo}${name}</a>`;let lis=b.pages!==false?navPageLinks(ctx):'';baItems(b).forEach((it,i)=>{if(!isObj(it))return;if(E){lis+=`<li class="lp-nav-li"${di(ctx,i)}><span class="lp-nav-a">${baIn(ctx,b,`items.${i}.label`,'plain','pa.navLink')}</span></li>`;return;}
const label=txt(ctx,it.label);if(!label)return;const h=hrefAttr(ctx,it.href);lis+=h?`<li class="lp-nav-li"><a class="lp-nav-a"${h}>${label}</a></li>`:`<li class="lp-nav-li"><span class="lp-nav-a">${label}</span></li>`;});let list='';if(lis)list=`<ul class="lp-nav-ul" role="list">${lis}${E&&!baItems(b).length?`<li class="lp-nav-li">${addItemBox(ctx)}</li>`:''}</ul>`;else if(E)list=`<div class="lp-nav-ul">${addItemBox(ctx)}</div>`;let cta='';if(E){cta=`<span class="lp-btn lp-btn-primary lp-btn-sm lp-nav-cta">${fld(ctx,b,'ctaLabel','plain','span','','pa.cta',{ecls:'lp-opt'})}</span>`;}else{const l=txt(ctx,b.ctaLabel);const h=l?hrefAttr(ctx,b.ctaHref):'';if(h)cta=`<a class="lp-btn lp-btn-primary lp-btn-sm lp-nav-cta"${h}>${l}</a>`;}
const tools=navTools(ctx)||'';if(!E&&!brand&&!list&&!cta&&!tools)return'';let burger='';let menu='';if(list||cta){const mid='lp-nm-'+escapeAttr(b.id);burger=`<details class="lp-nav-m"${E?' open':''}><summary class="lp-nav-tg" aria-controls="${mid}">`
+'<span class="lp-nav-bars" aria-hidden="true"></span>'
+`<span class="lp-sr lp-nav-lo">${ui(ctx,'openMenu')}</span><span class="lp-sr lp-nav-lc">${ui(ctx,'closeMenu')}</span>`
+'</summary></details>';menu=`<div class="lp-nav-menu" id="${mid}">${list}${cta}</div>`;}
const lead=b.overlay?baLeadHero(ctx):null;let cls='lp-nav lp-nav-'+variant;if(b.sticky)cls+=' lp-nav-sticky';if(lead){cls+=' lp-nav-over';const ht=baHeroTone(ctx,lead);if(ht)cls+=' lp-tone-'+ht;}else{const tone=oneOf(b.tone,TONES,'auto');if(tone!=='auto')cls+=` lp-tone-${tone} lp-nav-toned`;}
if(logoH>48)cls+=' lp-nav-xl';return`<nav class="${cls}" style="--lp-logo-h:${logoH}px"><div class="lp-wrap lp-nav-in">${brand}${burger}${menu}`
+`${tools?`<div class="lp-nav-tools">${tools}</div>`:''}</div></nav>`;}
function baRenderHero(b,ctx){const E=ctx.edit;const layout=oneOf(b.layout,['center','left','split','split-rev'],'center');const split=layout==='split'||layout==='split-rev';const height=oneOf(b.height,['auto','tall','screen'],'auto');const{img,vid}=baHeroBg(ctx,b);const tone=baHeroTone(ctx,b);let bg='';if(img||vid){let layer=img?baImg(ctx,img.id,'bg','lp-hero-img',{load:'high'}):'';if(vid){if(E){const src=attSrc(ctx,vid);if(src)layer+=`<video class="lp-hero-video" src="${escapeAttr(src)}" muted playsinline preload="metadata" tabindex="-1" data-att-key="bgVideo"></video>`;}else{layer+=`<video class="lp-hero-video" data-att="${escapeAttr(vid.id)}" muted autoplay loop playsinline preload="none" tabindex="-1" disablepictureinpicture disableremoteplayback></video>`;feature(ctx,'media');if(ctx.use.blob instanceof Set)ctx.use.blob.add(vid.id);if(ctx.use.atts instanceof Set)ctx.use.atts.add(vid.id);}}
if(layer)bg=`<div class="lp-hero-bg" aria-hidden="true">${layer}</div>`;}
const badge=baWrap(ctx,b,'badge','plain','p','lp-hero-badge','pa.badge',{ecls:'lp-opt'});const eyebrow=baWrap(ctx,b,'eyebrow','plain','p','lp-eyebrow lp-hero-eb','pa.eyebrow',{ecls:'lp-opt'});const title=baWrap(ctx,b,'title','plain','h1','lp-h lp-h1 lp-hero-t','pa.heroTitle');const text=fld(ctx,b,'text','rich','div','lp-rich lp-lead lp-hero-x','pa.heroText',{ecls:'lp-opt'});const btns=buttonsHTML(ctx,b,'items',{size:'lg',align:layout==='center'?'center':'left'})||'';let media='';if(split){const ma=attOf(ctx,b.media);media=mediaBox(ctx,b.media,{ratio:'4/3',fit:'cover',cls:'lp-hero-media',eager:true,path:'media',alt:(l)=>baAttTitle(ctx,ma,l),})||'';}
if(!E&&!badge&&!eyebrow&&!title&&!text&&!btns&&!media&&!bg)return'';let cls=`lp-hero lp-hero-${layout} lp-hero-h-${height}`;if(tone)cls+=` lp-tone-${tone} lp-hero-toned`;if(bg)cls+=' lp-hero-bgd';if(split&&!media)cls+=' lp-hero-nomedia';const ov=Math.round(num(b.overlay,45,0,90))/100;return`<section class="${cls}"${bg?` style="--lp-ov:${ov}"`:''}>${bg}<div class="lp-wrap lp-hero-in"><div class="lp-hero-grid">`
+`<div class="lp-hero-c">${badge}${eyebrow}${title}${text}${btns}</div>${media}</div></div></section>`;}
function baRenderFooter(b,ctx){const E=ctx.edit;const variant=oneOf(b.variant,['columns','simple','center'],'columns');const tone=oneOf(b.tone,TONES,'auto');const logoH=Math.round(num(b.logoH,40,20,96));const nameIn=baIn(ctx,b,'brand','plain','pa.brand');const logo=baImg(ctx,b.logo,'logo','lp-foot-logo',{h:logoH,alt:E||nameIn?null:(a,l)=>baAttTitle(ctx,a,l)||a.name||'',});const name=nameIn?`<p class="lp-foot-name">${nameIn}</p>`:'';const text=fld(ctx,b,'text','rich','div','lp-rich lp-foot-x','pa.footText',{ecls:'lp-opt'});const brandIn=logo+name+text;const brand=brandIn?`<div class="lp-foot-brand">${brandIn}</div>`:'';let cols='';baItems(b).forEach((it,i)=>{if(!isObj(it))return;const p=`items.${i}.`;const t=baWrap(ctx,b,p+'title','plain','h2','lp-foot-h','pa.colTitle',{ecls:'lp-opt'});const html=fld(ctx,b,p+'html','rich','div','lp-rich lp-foot-links','pa.colLinks');if(!E&&!t&&!html)return;cols+=`<div class="lp-foot-col"${di(ctx,i)}>${t}${html}</div>`;});if(!cols&&E)cols=addItemBox(ctx);const copy=fld(ctx,b,'copy','plain','p','lp-foot-copy','pa.copy',{ecls:'lp-opt'});if(!E&&!brand&&!cols&&!copy)return'';let cls='lp-foot lp-foot-'+variant;if(tone!=='auto')cls+=` lp-tone-${tone} lp-foot-toned`;if(!brand||!cols)cls+=' lp-foot-solo';const top=brand||cols?`<div class="lp-foot-top">${brand}${cols?`<div class="lp-foot-cols">${cols}</div>`:''}</div>`:'';const bottom=copy?`<div class="lp-foot-bottom">${copy}</div>`:'';return`<div class="${cls}" style="--lp-logo-h:${logoH}px"><div class="lp-wrap lp-foot-in">${top}${bottom}</div></div>`;}
function baRenderSection(b,ctx){const E=ctx.edit;const body=renderList(ctx,b.blocks,b.id+':blocks','div','lp-sec-body','',false);const kids=body.includes('class="lp-b ');const eyebrow=baWrap(ctx,b,'eyebrow','plain','p','lp-eyebrow lp-sec-eb','pa.eyebrow',{ecls:'lp-opt'});const title=baWrap(ctx,b,'title','plain','h2','lp-h lp-h2 lp-sec-t','pa.secTitle');const lead=fld(ctx,b,'lead','rich','div','lp-rich lp-lead lp-sec-lead','pa.secLead',{ecls:'lp-opt'});if(!E&&!kids&&!eyebrow&&!title&&!lead)return'';const head=eyebrow||title||lead?`<div class="lp-sec-head">${eyebrow}${title}${lead}</div>`:'';const width=oneOf(b.width,['narrow','normal','wide','full'],'normal');const pad=oneOf(b.pad,['none','s','m','l','xl'],'m');const align=oneOf(b.align,['left','center'],'left');const shape=oneOf(b.shape,['none','wave','slant','zigzag','ornament'],'none');const tone=baSecTone(ctx,b);const bgImg=baImg(ctx,b.bgImage,'bgImage','lp-sec-img');let cls=`lp-sec lp-sec-w-${width} lp-sec-p-${pad} lp-sec-a-${align}`;if(tone)cls+=` lp-tone-${tone} lp-sec-toned`;if(bgImg)cls+=' lp-sec-hasbg';if(shape!=='none')cls+=` lp-sh-${shape}${shape==='ornament'?'':' lp-sec-cut'}`;const ov=Math.round(num(b.overlay,50,0,90))/100;const bg=bgImg?`<div class="lp-sec-bg" aria-hidden="true">${bgImg}</div>`:'';const orn=shape==='ornament'?'<div class="lp-sec-orn" aria-hidden="true"></div>':'';return`<section class="${cls}"${bgImg?` style="--lp-ov:${ov}"`:''}>${bg}${orn}<div class="lp-wrap"><div class="lp-sec-in">`
+`${head}${E||kids?body:''}</div></div></section>`;}
function baRenderColumns(b,ctx){const cols=Array.isArray(b.cols)?b.cols.filter(isObj):[];if(!cols.length)return'';let inner='';cols.forEach((c,i)=>{inner+=renderList(ctx,c.blocks,`${b.id}:cols.${i}.blocks`,'div','lp-col',`flex:${num(c.w,50,1,100)} 1 0%`,false);});if(!ctx.edit&&!inner.includes('class="lp-b '))return'';const va=oneOf(b.valign,['top','center','bottom'],'top');return`<div class="lp-cols lp-cols-n${Math.min(cols.length,4)}${va==='top'?'':' lp-cols-va-'+va}" style="--lp-cg:${Math.round(num(b.gap,24,0,80))}px">${inner}</div>`;}
function baRenderDivider(b){const v=oneOf(b.variant,['solid','dashed','dotted','double','accent','ornament'],'solid');const w=Math.round(num(b.thickness,1,1,6));if(v==='ornament')return`<div class="lp-hr lp-hr-ornament" role="separator" style="--lp-hrw:${w}px">${BA_ORN_SVG}</div>`;return`<hr class="lp-hr lp-hr-${v}" style="--lp-hrw:${w}px">`;}
function baRenderSpacer(b){return`<div class="lp-spacer" style="--lp-sph:${Math.round(num(b.h,32,4,240))}px" aria-hidden="true"></div>`;}
function baRenderHeading(b,ctx){const lv=oneOf(b.level,[1,2,3,4],2);const t=baIn(ctx,b,'text','plain','pa.headline');const eb=baWrap(ctx,b,'eyebrow','plain','p','lp-eyebrow lp-hdg-eb','pa.eyebrow',{ecls:'lp-opt'});if(!t&&!eb)return'';const ic=b.icon?icon(ctx,b.icon,'lp-hdg-ic'):'';const al=oneOf(b.align,['left','center','right'],'left');const h=t?`<h${lv} class="lp-h lp-h${lv}">${ic}${t}</h${lv}>`:'';return`<div class="lp-hdg lp-a-${al}">${eb}${h}</div>`;}
function baRenderText(b,ctx){const size=oneOf(b.size,['s','m','l'],'m');const two=oneOf(b.cols,[1,2],1)===2;return fld(ctx,b,'html','rich','div',`lp-rich lp-tx lp-tx-${size}${two?' lp-tx-c2':''}`,'pa.paragraph');}
function baRenderQuote(b,ctx){const v=oneOf(b.variant,['callout','pull'],'callout');const tone=oneOf(b.tone,BA_QUOTE_TONES,'note');const pull=v==='pull';const body=fld(ctx,b,'html','rich',pull?'blockquote':'div','lp-rich lp-qt-body','pa.quote');if(!body)return'';const au=baWrap(ctx,b,'author','plain',pull?'figcaption':'p','lp-qt-a','pa.author',{ecls:'lp-opt'});if(pull){const mark=b.icon?icon(ctx,b.icon,'lp-qt-mark'):BA_QUOTE_SVG;return`<figure class="lp-qt lp-qt-pull lp-qt-t-${tone}">${mark}${body}${au}</figure>`;}
const ic=b.icon?icon(ctx,b.icon,'lp-qt-ic'):'';return`<div class="lp-qt lp-qt-callout lp-qt-t-${tone}" role="note">${ic}<div class="lp-qt-main">${body}${au}</div></div>`;}
function baRenderButtons(b,ctx){if(noItems(ctx,b))return addItemBox(ctx);const al=oneOf(b.align,['left','center','right'],'left');const row=buttonsHTML(ctx,b,'items',{align:al});return row?`<div class="lp-btnb lp-btnb-${al}">${row}</div>`:'';}
function baRenderFeatures(b,ctx){if(noItems(ctx,b))return addItemBox(ctx);const E=ctx.edit;const v=oneOf(b.variant,['cards','icons','list','split'],'cards');const cols=oneOf(b.columns,[2,3,4],3);let lis='';baItems(b).forEach((it,i)=>{if(!isObj(it))return;const p=`items.${i}.`;const t=baWrap(ctx,b,p+'title','plain','h3','lp-feat-t','pa.featTitle');const x=fld(ctx,b,p+'html','rich','div','lp-rich lp-feat-x','pa.featText',{ecls:'lp-opt'});let media='';if(v==='split'||(v!=='list'&&it.image&&attOf(ctx,it.image))){const ma=attOf(ctx,it.image);media=mediaBox(ctx,it.image,{ratio:v==='split'?'4/3':'16/9',fit:'cover',cls:'lp-feat-media',path:p+'image',alt:(l)=>baAttTitle(ctx,ma,l),})||'';}
let ic='';if(it.icon&&(!media||v==='split')){const s=icon(ctx,it.icon);if(s)ic=`<span class="lp-icbox lp-feat-ic">${s}</span>`;}else if(v==='list'){ic=`<span class="lp-feat-ic lp-feat-chk">${icon(ctx,'check')||BA_CHECK_SVG}</span>`;}
if(!E&&!t&&!x&&!media)return;const cl='lp-feat-i'+(v==='cards'?' lp-card lp-card-hover':'')+(v==='split'&&!media?' lp-feat-nom':'');lis+=`<li class="${cl}"${di(ctx,i)}>${media}${ic&&v!=='split'?ic:''}<div class="lp-feat-b">${v==='split'?ic:''}${t}${x}</div></li>`;});if(!lis)return'';const grid=v==='split'?'':' lp-grid';return`<ul class="lp-feat lp-feat-${v}${grid}"${grid?` style="--lp-cols:${cols}"`:''} role="list">${lis}</ul>`;}
function baRenderStats(b,ctx){if(noItems(ctx,b))return addItemBox(ctx);const E=ctx.edit;const v=oneOf(b.variant,['plain','cards','band'],'plain');const cols=oneOf(b.columns,[2,3,4,5],4);const count=!E&&!!b.count;let lis='';baItems(b).forEach((it,i)=>{if(!isObj(it))return;const p=`items.${i}.`;const val=str(it.value).trim();const vh=val?escapeHTML(val):E?'<span class="lp-stat-ph" aria-hidden="true">0</span>':'';const suf=baWrap(ctx,b,p+'suffix','plain','span','lp-stat-s','pa.statSuffix',{ecls:'lp-opt'});const lab=baWrap(ctx,b,p+'label','plain','span','lp-stat-l','pa.statLabel');if(!E&&!val&&!lab)return;const cn=count&&/\d/.test(val);if(cn)feature(ctx,'counter');lis+=`<li class="lp-stat-i${v==='cards'?' lp-card':''}"${di(ctx,i)}><span class="lp-stat-v"><span class="lp-stat-n"${cn?' data-lp-count':''}>${vh}</span>${suf}</span>${lab}</li>`;});if(!lis)return'';return`<ul class="lp-stat lp-stat-${v}${v==='band'?'':' lp-grid'}" style="--lp-cols:${cols}" role="list">${lis}</ul>`;}
function baRenderSteps(b,ctx){if(noItems(ctx,b))return addItemBox(ctx);const E=ctx.edit;const v=oneOf(b.variant,['numbers','line','cards'],'numbers');let lis='';let n=0;baItems(b).forEach((it,i)=>{if(!isObj(it))return;const p=`items.${i}.`;const t=baWrap(ctx,b,p+'title','plain','h3','lp-step-t','pa.stepTitle');const x=fld(ctx,b,p+'html','rich','div','lp-rich lp-step-x','pa.stepText',{ecls:'lp-opt'});if(!E&&!t&&!x)return;const ic=it.icon?icon(ctx,it.icon):'';n++;lis+=`<li class="lp-step-i${v==='cards'?' lp-card':''}"${di(ctx,i)}><span class="lp-step-n${ic?' lp-step-icn':''}" aria-hidden="true">${ic}</span>`
+`<div class="lp-step-b">${t}${x}</div></li>`;});if(!lis)return'';const cap=v==='cards'?4:5;const cols=n<=cap?n:n%3===0?3:4;const vert=v==='line'&&n>5;return`<ol class="lp-step lp-step-${v}${vert?' lp-step-vert':''}" style="--lp-cols:${cols};--lp-cols2:${Math.min(cols,2)}" role="list">${lis}</ol>`;}
const BT_A={nav:{category:'structure',icon:'nav',container:false,full:true,region:'header',i18nFields:['brand','ctaLabel'],itemI18nFields:['label'],itemLabel:'label',variants:['variant'],defaults:()=>({brand:{},logo:null,logoH:36,items:[],ctaLabel:{},ctaHref:'',sticky:true,overlay:false,variant:'bar',tone:'auto',pages:true,}),schema:[{key:'variant',type:'select',label:'f.variant',options:optList('bar','center','split')},{key:'pages',type:'checkbox',label:'f.navPages',hint:'hint.navPages'},{key:'logo',type:'att',label:'f.logo',accept:'image/'},{key:'logoH',type:'number',label:'f.logoH',min:20,max:96,step:1,unit:'px'},{key:'ctaHref',type:'text',label:'f.ctaHref',suggest:'anchors',placeholder:'pl.href'},{key:'sticky',type:'checkbox',label:'f.sticky'},{key:'overlay',type:'checkbox',label:'f.overNav',hint:'hint.overNav'},{key:'tone',type:'select',label:'f.tone',options:optList(...TONES),hint:'hint.navTone'},],itemSchema:[{key:'label',type:'i18n',label:'f.label'},{key:'href',type:'text',label:'f.href',suggest:'anchors',placeholder:'pl.href'},],itemDefaults:()=>({id:uid(),label:{},href:''}),render:baRenderNav,},hero:{category:'structure',icon:'hero',container:false,full:true,i18nFields:['badge','eyebrow','title','text'],itemI18nFields:['label'],itemLabel:'label',richFields:{text:'rich'},variants:['layout'],defaults:()=>({badge:{},eyebrow:{},title:{},text:{},items:[],layout:'center',media:null,bg:null,bgVideo:null,overlay:45,height:'auto',tone:'auto',}),schema:[{key:'layout',type:'select',label:'f.layout',options:optList('center','left','split','split-rev')},{key:'media',type:'att',label:'f.media',accept:'image/',when:{layout:['split','split-rev']}},{key:'height',type:'select',label:'f.height',options:optList('auto','tall','screen')},{key:'tone',type:'select',label:'f.tone',options:optList('auto','dark','light'),hint:'hint.heroTone'},{key:'bg',type:'att',label:'f.bg',accept:'image/'},{key:'bgVideo',type:'att',label:'f.bgVideo',accept:'video/',hint:'hint.bgVideo'},{key:'overlay',type:'range',label:'f.overlay',min:0,max:90,step:5,unit:'%'},],itemSchema:baBtnSchema(),itemDefaults:()=>({id:uid(),label:{},href:'',kind:'primary',icon:''}),render:baRenderHero,},footer:{category:'structure',icon:'footer',container:false,full:true,region:'footer',i18nFields:['brand','text','copy'],itemI18nFields:['title','html'],itemLabel:'title',richFields:{text:'rich'},itemRichFields:{html:'rich'},variants:['variant'],defaults:()=>({brand:{},logo:null,logoH:40,text:{},items:[],copy:{},variant:'columns',tone:'auto'}),schema:[{key:'variant',type:'select',label:'f.variant',options:optList('columns','simple','center')},{key:'logo',type:'att',label:'f.logo',accept:'image/'},{key:'logoH',type:'number',label:'f.logoH',min:20,max:96,step:1,unit:'px'},{key:'tone',type:'select',label:'f.tone',options:optList(...TONES)},],itemSchema:[{key:'title',type:'i18n',label:'f.title'},{key:'html',type:'i18n',label:'f.html'},],itemDefaults:()=>({id:uid(),title:{},html:{}}),render:baRenderFooter,},section:{category:'layout',icon:'section',container:true,lists:['blocks'],full:true,i18nFields:['eyebrow','title','lead'],richFields:{lead:'rich'},variants:['shape'],defaults:()=>({eyebrow:{},title:{},lead:{},blocks:[],width:'normal',pad:'m',tone:'auto',bgImage:null,overlay:50,align:'left',shape:'none',}),schema:[{key:'width',type:'select',label:'f.width',options:optList('narrow','normal','wide','full')},{key:'pad',type:'select',label:'f.pad',options:optList('none','s','m','l','xl')},{key:'align',type:'select',label:'f.align',options:optList('left','center')},{key:'tone',type:'select',label:'f.tone',options:optList(...TONES)},{key:'shape',type:'select',label:'f.shape',options:optList('none','wave','slant','zigzag','ornament'),hint:'hint.shape'},{key:'bgImage',type:'att',label:'f.bgImage',accept:'image/'},{key:'overlay',type:'range',label:'f.overlay',min:0,max:90,step:5,unit:'%'},],render:baRenderSection,},columns:{category:'layout',icon:'columns',container:true,lists:['cols.*.blocks'],i18nFields:[],defaults:()=>({cols:[{id:uid(),w:50,blocks:[]},{id:uid(),w:50,blocks:[]}],gap:24,valign:'top'}),schema:[{key:'gap',type:'number',label:'f.gap',min:0,max:80,step:1,unit:'px'},{key:'valign',type:'select',label:'f.valign',options:optList('top','center','bottom')},],render:baRenderColumns,},divider:{category:'layout',icon:'divider',container:false,i18nFields:[],variants:['variant'],defaults:()=>({variant:'solid',thickness:1}),schema:[{key:'variant',type:'select',label:'f.variant',options:optList('solid','dashed','dotted','double','accent','ornament')},{key:'thickness',type:'number',label:'f.thickness',min:1,max:6,step:1,unit:'px'},],render:baRenderDivider,},spacer:{category:'layout',icon:'spacer',container:false,i18nFields:[],defaults:()=>({h:32}),schema:[{key:'h',type:'number',label:'f.h',min:4,max:240,step:1,unit:'px'}],render:baRenderSpacer,},heading:{category:'content',icon:'heading',container:false,i18nFields:['text','eyebrow'],defaults:()=>({text:{},eyebrow:{},level:2,icon:'',align:'left'}),schema:[{key:'level',type:'select',label:'f.level',options:numOpts(1,2,3,4)},{key:'align',type:'select',label:'f.align',options:optList('left','center','right')},{key:'icon',type:'icon',label:'f.icon'},],render:baRenderHeading,},text:{category:'content',icon:'text',container:false,i18nFields:['html'],richFields:{html:'rich'},defaults:()=>({html:{},cols:1,size:'m'}),schema:[{key:'size',type:'select',label:'f.size',options:[{v:'s',l:'o.small'},{v:'m',l:'o.medium'},{v:'l',l:'o.large'}]},{key:'cols',type:'select',label:'f.cols',options:numOpts(1,2)},],render:baRenderText,},quote:{category:'content',icon:'quote',container:false,i18nFields:['html','author'],richFields:{html:'rich'},variants:['variant'],defaults:()=>({html:{},author:{},variant:'callout',tone:'note',icon:''}),schema:[{key:'variant',type:'select',label:'f.variant',options:optList('callout','pull')},{key:'tone',type:'select',label:'f.tone',options:optList(...BA_QUOTE_TONES)},{key:'icon',type:'icon',label:'f.icon'},],render:baRenderQuote,},buttons:{category:'content',icon:'buttons',container:false,i18nFields:[],itemI18nFields:['label'],itemLabel:'label',defaults:()=>({items:[],align:'left'}),schema:[{key:'align',type:'select',label:'f.align',options:optList('left','center','right')}],itemSchema:baBtnSchema(),itemDefaults:()=>({id:uid(),label:{},href:'',kind:'primary',icon:''}),render:baRenderButtons,},features:{category:'content',icon:'features',container:false,i18nFields:[],itemI18nFields:['title','html'],itemLabel:'title',itemRichFields:{html:'rich'},variants:['variant'],defaults:()=>({items:[],variant:'cards',columns:3}),schema:[{key:'variant',type:'select',label:'f.variant',options:optList('cards','icons','list','split')},{key:'columns',type:'select',label:'f.columns',options:numOpts(2,3,4),when:{variant:['cards','icons','list']}},],itemSchema:[{key:'icon',type:'icon',label:'f.icon'},{key:'title',type:'i18n',label:'f.title'},{key:'html',type:'i18n',label:'f.html'},{key:'image',type:'att',label:'f.image',accept:'image/'},],itemDefaults:()=>({id:uid(),icon:'',title:{},html:{},image:null}),render:baRenderFeatures,},stats:{category:'content',icon:'stats',container:false,i18nFields:[],itemI18nFields:['suffix','label'],itemLabel:'label',variants:['variant'],defaults:()=>({items:[],variant:'plain',columns:4,count:false}),schema:[{key:'variant',type:'select',label:'f.variant',options:optList('plain','cards','band')},{key:'columns',type:'select',label:'f.columns',options:numOpts(2,3,4,5)},{key:'count',type:'checkbox',label:'f.count',hint:'fh.count'},],itemSchema:[{key:'value',type:'text',label:'f.value',placeholder:'pl.statValue'},{key:'suffix',type:'i18n',label:'f.suffix'},{key:'label',type:'i18n',label:'f.label'},],itemDefaults:()=>({id:uid(),value:'',suffix:{},label:{}}),render:baRenderStats,},steps:{category:'content',icon:'steps',container:false,i18nFields:[],itemI18nFields:['title','html'],itemLabel:'title',itemRichFields:{html:'rich'},variants:['variant'],defaults:()=>({items:[],variant:'numbers'}),schema:[{key:'variant',type:'select',label:'f.variant',options:optList('numbers','line','cards')}],itemSchema:[{key:'title',type:'i18n',label:'f.title'},{key:'html',type:'i18n',label:'f.html'},{key:'icon',type:'icon',label:'f.icon'},],itemDefaults:()=>({id:uid(),title:{},html:{},icon:''}),render:baRenderSteps,},};const CSS_BLOCKS_A={nav:`
.lp-nav{position:relative;z-index:30;color:var(--lp-text);font-size:.96em;line-height:1.3}
.lp-nav-toned{background:var(--lp-bg)}
.lp-cbg>.lp-nav{background:transparent;color:inherit}
.lp-nav-in{display:flex;align-items:center;gap:clamp(14px,2.2cqi,32px);min-height:calc(max(var(--lp-logo-h,36px),40px) + 32px);padding-block:10px}
.lp-nav-brand{display:inline-flex;align-items:center;gap:12px;flex:0 1 auto;max-width:100%;min-width:0;color:inherit;font-family:var(--lp-font-h);font-size:1.2em;font-weight:700;line-height:1.1;letter-spacing:-.01em;text-decoration:none}
.lp-nav-brand:lang(ka){letter-spacing:0}
.lp-nav-logo{display:block;flex:none;width:auto;height:var(--lp-logo-h,36px);max-width:min(240px,42cqi);object-fit:contain}
.lp-nav-name{min-width:0;overflow-wrap:break-word}
.lp-nav-menu{display:flex;align-items:center;gap:clamp(14px,2cqi,28px);min-width:0;margin-inline-start:auto}
.lp-nav-ul{display:flex;flex-wrap:wrap;align-items:center;gap:2px clamp(14px,2.1cqi,30px);margin:0;padding:0;list-style:none}
.lp-nav-li{margin:0}
.lp-nav-a{position:relative;display:inline-block;padding:8px 0;color:inherit;font-weight:500;text-decoration:none;opacity:.82;transition:opacity .2s var(--lp-ease,ease)}
.lp-nav-a::after{content:"";position:absolute;inset-inline:0;bottom:2px;height:2px;border-radius:2px;background:var(--lp-accent);transform:scaleX(0);transition:transform .25s var(--lp-ease,ease)}
a.lp-nav-a:hover,a.lp-nav-a:focus-visible,a.lp-nav-a[aria-current]{opacity:1}
a.lp-nav-a:hover::after,a.lp-nav-a[aria-current]::after{transform:scaleX(1)}
.lp-nav-cta{flex:none}
.lp-nav-tools{display:flex;align-items:center;gap:8px;flex:none}
.lp-nav-m{display:none}
.lp-nav-tg{display:grid;place-items:center;width:44px;height:44px;margin:0;border-radius:var(--lp-radius-s,8px);color:inherit;list-style:none;cursor:pointer;-webkit-tap-highlight-color:transparent}
.lp-nav-tg::-webkit-details-marker{display:none}
.lp-nav-tg::marker{content:""}
.lp-nav-tg:hover{background:color-mix(in srgb,currentColor 9%,transparent)}
.lp-nav-bars{position:relative;display:block;width:22px;height:2px;border-radius:2px;background:currentColor;transition:background-color .2s}
.lp-nav-bars::before,.lp-nav-bars::after{content:"";position:absolute;left:0;width:22px;height:2px;border-radius:2px;background:currentColor;transition:transform .25s var(--lp-ease,ease)}
.lp-nav-bars::before{top:-7px}
.lp-nav-bars::after{top:7px}
.lp-nav-m[open] .lp-nav-bars{background-color:transparent}
.lp-nav-m[open] .lp-nav-bars::before{transform:translateY(7px) rotate(45deg)}
.lp-nav-m[open] .lp-nav-bars::after{transform:translateY(-7px) rotate(-45deg)}
.lp-nav-m[open] .lp-nav-lo,.lp-nav-m:not([open]) .lp-nav-lc{display:none}
.lp-header:has(.lp-nav-sticky){position:sticky;top:0;z-index:40}
.lp-main .lp-b-nav:has(>.lp-nav-sticky){position:sticky;top:0;z-index:40}
.lp-nav-sticky{background:color-mix(in srgb,var(--lp-bg) 86%,transparent);-webkit-backdrop-filter:saturate(1.5) blur(14px);backdrop-filter:saturate(1.5) blur(14px);border-bottom:1px solid color-mix(in srgb,var(--lp-border) 70%,transparent)}
.lp-nav-toned.lp-nav-sticky{background:color-mix(in srgb,var(--lp-bg) 93%,transparent)}
@supports (animation-timeline:scroll()){.lp-nav-sticky:not(.lp-nav-over){animation:lp-nav-lift linear both;animation-timeline:scroll();animation-range:0 120px}}
@keyframes lp-nav-lift{to{box-shadow:var(--lp-shadow)}}
.lp-header:has(.lp-nav-over){position:relative;z-index:40;height:0}
.lp-header:has(.lp-nav-over.lp-nav-sticky){position:sticky;top:0}
.lp-nav.lp-nav-over{background:transparent;border-bottom-color:transparent;-webkit-backdrop-filter:none;backdrop-filter:none}
.lp-nav.lp-nav-over.lp-nav-sticky{background:color-mix(in srgb,var(--lp-bg) 55%,transparent);-webkit-backdrop-filter:saturate(1.4) blur(12px);backdrop-filter:saturate(1.4) blur(12px)}
@supports (animation-timeline:scroll()){.lp-nav.lp-nav-over.lp-nav-sticky{background:transparent;-webkit-backdrop-filter:none;backdrop-filter:none;animation:lp-nav-solid linear both;animation-timeline:scroll();animation-range:0 200px}}
@keyframes lp-nav-solid{to{background:color-mix(in srgb,var(--lp-bg) 90%,transparent);-webkit-backdrop-filter:saturate(1.5) blur(14px);backdrop-filter:saturate(1.5) blur(14px);box-shadow:var(--lp-shadow)}}
.lp-root:has(>.lp-header .lp-nav-over)>.lp-main>.lp-b-hero:first-child{--lp-over-h:76px;--lp-nav-space:0px}
.lp-root:has(>.lp-header .lp-nav-over.lp-nav-xl)>.lp-main>.lp-b-hero:first-child{--lp-over-h:128px}
@container lp (max-width:900px){.lp-nav-in{gap:8px}.lp-nav-brand{margin-inline-end:auto}.lp-nav-logo{max-width:46cqi}.lp-nav-tools{order:2}.lp-nav-m{display:block;order:3}.lp-nav-menu{position:absolute;top:100%;inset-inline:0;z-index:5;flex-direction:column;align-items:stretch;gap:18px;margin:0;padding:6px clamp(16px,5cqi,32px) 24px;background:var(--lp-bg);color:var(--lp-text);border-top:1px solid var(--lp-border);box-shadow:var(--lp-shadow-lg);max-height:calc(var(--lp-vh,1vh)*100 - 76px);overflow-y:auto;overscroll-behavior:contain}.lp-nav-m:not([open])~.lp-nav-menu{display:none}.lp-nav-ul{flex-direction:column;align-items:stretch;gap:0}.lp-nav-li{border-bottom:1px solid var(--lp-border)}.lp-nav-a{display:block;padding:14px 2px;font-size:1.06em;opacity:1}.lp-nav-a::after{display:none}.lp-nav-cta{align-self:flex-start}}
@media (prefers-reduced-motion:reduce){.lp-nav-a,.lp-nav-a::after,.lp-nav-bars,.lp-nav-bars::before,.lp-nav-bars::after{transition:none}}
@media print{.lp-header{position:static!important;height:auto!important}.lp-nav{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;box-shadow:none!important}.lp-nav-m,.lp-nav-tools{display:none!important}.lp-nav-menu{display:flex!important;position:static!important;box-shadow:none!important}}
.lp-root[data-mode=edit] .lp-header:has(.lp-nav-sticky),.lp-root[data-mode=edit] .lp-main .lp-b-nav:has(>.lp-nav-sticky){position:relative}
.lp-root[data-mode=edit] .lp-nav-cta,.lp-root[data-mode=edit] .lp-nav-tg{pointer-events:auto}
.lp-root[data-mode=edit] .lp-nav-cta:has(>.lp-f:empty){opacity:.55}
.lp-root[data-mode=edit] .lp-nav-a{opacity:1}
.lp-root[data-mode=edit] .lp-nav-pgl .lp-nav-a{cursor:pointer;opacity:.82}
.lp-root[data-mode=edit] .lp-nav-pgl .lp-nav-cur{opacity:1}
.lp-root[data-mode=edit] .lp-nav-pgl .lp-nav-cur::after{transform:scaleX(1)}
.lp-root[data-mode=edit] .lp-nav-ul>.lp-add-item{min-height:0;padding:6px 14px}
@container lp (max-width:900px){.lp-root[data-mode=edit] .lp-nav-in{flex-wrap:wrap}.lp-root[data-mode=edit] .lp-nav-menu{position:static;flex-basis:100%;order:4;padding:0 0 12px;border-top:0;background:transparent;box-shadow:none;max-height:none}}
`,hero:`
.lp-hero{position:relative;isolation:isolate;overflow:hidden;--lp-hero-py:clamp(64px,8.5cqi,132px);padding-block:calc(var(--lp-hero-py) + var(--lp-over-h,0px)) var(--lp-hero-py);color:var(--lp-text)}
.lp-hero-toned{background:var(--lp-bg)}
.lp-cbg>.lp-hero{background:transparent;color:inherit}
.lp-hero::before{content:"";position:absolute;inset:0;z-index:-2;pointer-events:none;background:radial-gradient(60% 75% at 86% 0%,color-mix(in srgb,var(--lp-accent) 15%,transparent),transparent 70%),radial-gradient(55% 65% at 0% 100%,color-mix(in srgb,var(--lp-accent2,var(--lp-accent)) 12%,transparent),transparent 72%)}
.lp-hero-bgd::before{display:none}
.lp-hero-bg{position:absolute;inset:0;z-index:-1;overflow:hidden;background:var(--lp-bg)}
.lp-hero-img,.lp-hero-video{position:absolute;inset:0;display:block;width:100%;height:100%;max-width:none;object-fit:cover}
.lp-hero-bg::after{content:"";position:absolute;inset:0;background:var(--lp-bg);opacity:var(--lp-ov,.45)}
.lp-hero-in{position:relative}
.lp-hero-h-tall,.lp-hero-h-screen{display:flex;flex-direction:column;justify-content:center}
.lp-hero-h-tall{min-height:calc(var(--lp-vh,1vh)*72)}
.lp-hero-h-screen{min-height:calc(var(--lp-vh,1vh)*100 - var(--lp-nav-space,72px))}
.lp-hero-h-tall>.lp-hero-in,.lp-hero-h-screen>.lp-hero-in{width:100%}
.lp-hero-grid{display:grid;grid-template-columns:minmax(0,1fr);align-items:center;gap:clamp(36px,5cqi,80px)}
.lp-hero-c{min-width:0}
.lp-hero-center .lp-hero-c{max-width:60rem;margin-inline:auto;text-align:center}
.lp-hero-left .lp-hero-c,.lp-hero-nomedia .lp-hero-c{max-width:46rem}
.lp-hero-badge{display:inline-flex;align-items:center;gap:.6em;max-width:100%;margin:0 0 22px;padding:.42em 1em .42em .8em;border:1px solid color-mix(in srgb,var(--lp-accent) 32%,transparent);border-radius:999px;background:color-mix(in srgb,var(--lp-accent) 10%,transparent);font-size:.84em;font-weight:600;line-height:1.3}
.lp-hero-badge::before{content:"";flex:none;width:.5em;height:.5em;border-radius:50%;background:var(--lp-accent);box-shadow:0 0 0 .25em color-mix(in srgb,var(--lp-accent) 22%,transparent)}
.lp-hero-eb{margin:0 0 16px}
.lp-hero-t{margin:0;font-size:clamp(2.3rem,1.1rem + 4.8cqi,5.1rem);line-height:1.04;letter-spacing:-.028em;text-wrap:balance;overflow-wrap:break-word}
.lp-hero-t:lang(ka){letter-spacing:0;line-height:1.2}
.lp-hero-x{margin-top:clamp(18px,2.2cqi,28px);font-size:clamp(1.05rem,.95rem + .55cqi,1.32rem);line-height:1.6;color:var(--lp-muted);text-wrap:pretty}
.lp-hero-center .lp-hero-x{max-width:44rem;margin-inline:auto}
.lp-hero-c .lp-btns{margin-top:clamp(26px,3.2cqi,40px)}
.lp-hero-center .lp-btns{justify-content:center}
.lp-hero-media{border-radius:calc(var(--lp-radius,10px)*1.6 + 4px);overflow:hidden;box-shadow:var(--lp-shadow-lg)}
@container lp (max-width:600px){.lp-hero{--lp-hero-py:clamp(48px,14cqi,72px)}.lp-hero-badge{margin-bottom:16px}}
@media (prefers-reduced-motion:reduce){.lp-hero-video{display:none}}
@media print{.lp-hero-video{display:none}.lp-hero{min-height:0!important}}
.lp-root[data-mode=edit] .lp-hero-badge:has(>.lp-f:empty){opacity:.55}
.lp-root[data-mode=edit] .lp-hero-video{pointer-events:none}
`,footer:`
.lp-foot{position:relative;padding-block:clamp(48px,6cqi,88px) 28px;color:var(--lp-text);border-top:1px solid var(--lp-border);font-size:.95em}
.lp-foot-toned{background:var(--lp-bg);border-top-color:transparent}
.lp-cbg>.lp-foot{background:transparent;color:inherit}
.lp-foot-top{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,2fr);gap:clamp(32px,5cqi,80px)}
.lp-foot-solo .lp-foot-top{grid-template-columns:minmax(0,1fr)}
.lp-foot-brand{display:flex;flex-direction:column;align-items:flex-start;gap:14px;min-width:0;max-width:28rem}
.lp-foot-logo{display:block;width:auto;height:var(--lp-logo-h,40px);max-width:240px;object-fit:contain}
.lp-foot-name{margin:0;font-family:var(--lp-font-h);font-size:1.3em;font-weight:700;line-height:1.15;letter-spacing:-.01em;overflow-wrap:break-word}
.lp-foot-x{color:var(--lp-muted)}
.lp-foot-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:28px clamp(20px,3cqi,44px);min-width:0}
.lp-foot-col{min-width:0}
.lp-foot-h{margin:0 0 14px;font-family:var(--lp-font);font-size:.76em;font-weight:700;line-height:1.3;letter-spacing:.1em;text-transform:uppercase;color:var(--lp-muted)}
.lp-foot-h:lang(ka){text-transform:none;letter-spacing:.02em}
.lp-foot-links{line-height:1.5;overflow-wrap:break-word}
.lp-foot-links ul,.lp-foot-links ol{margin:0;padding:0;list-style:none}
.lp-foot-links li,.lp-foot-links p{margin:0 0 10px}
.lp-foot-links a{color:inherit;text-decoration:none;opacity:.86;transition:opacity .2s,color .2s}
.lp-foot-links a:hover{opacity:1;color:var(--lp-accent)}
.lp-foot-bottom{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 24px;margin-top:clamp(36px,5cqi,64px);padding-top:22px;border-top:1px solid var(--lp-border);color:var(--lp-muted);font-size:.88em}
.lp-foot-copy{margin:0}
@container lp (max-width:900px){.lp-foot-top{grid-template-columns:minmax(0,1fr)}}
@container lp (max-width:600px){.lp-foot-cols{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (prefers-reduced-motion:reduce){.lp-foot-links a{transition:none}}
.lp-root[data-mode=edit] .lp-foot-cols>.lp-add-item{grid-column:1/-1}
`,section:`
.lp-sec{position:relative;isolation:isolate;--lp-sec-py:var(--lp-sec,clamp(56px,8cqi,112px));padding-block:var(--lp-sec-py)}
.lp-sec-p-none{--lp-sec-py:0px}
.lp-sec-p-s{--lp-sec-py:calc(var(--lp-sec,clamp(56px,8cqi,112px))*.5)}
.lp-sec-p-l{--lp-sec-py:calc(var(--lp-sec,clamp(56px,8cqi,112px))*1.35)}
.lp-sec-p-xl{--lp-sec-py:calc(var(--lp-sec,clamp(56px,8cqi,112px))*1.8)}
.lp-sec-toned{background:var(--lp-bg);color:var(--lp-text)}
.lp-cbg>.lp-sec{background:transparent;color:inherit}
.lp-b-section.lp-cbg,.lp-b-hero.lp-cbg,.lp-b-nav.lp-cbg,.lp-b-footer.lp-cbg{border-radius:0}
.lp-sec-bg{position:absolute;inset:0;z-index:-1;overflow:hidden;background:var(--lp-bg)}
.lp-sec-img{position:absolute;inset:0;display:block;width:100%;height:100%;max-width:none;object-fit:cover}
.lp-sec-bg::after{content:"";position:absolute;inset:0;background:var(--lp-bg);opacity:var(--lp-ov,.5)}
.lp-sec-in{min-width:0}
.lp-sec-w-narrow>.lp-wrap>.lp-sec-in{max-width:48rem;margin-inline:auto}
.lp-sec-w-wide>.lp-wrap{max-width:calc(var(--lp-w,1160px) + 240px)}
.lp-sec-w-full>.lp-wrap{max-width:none}
.lp-sec-head{max-width:50rem;margin-bottom:clamp(30px,4.2cqi,60px)}
.lp-sec-head:last-child{margin-bottom:0}
.lp-sec-a-center>.lp-wrap>.lp-sec-in>.lp-sec-head{margin-inline:auto;text-align:center}
.lp-sec-eb{margin:0 0 14px}
.lp-sec-t{margin:0;font-size:clamp(1.85rem,1.05rem + 2.6cqi,3.1rem);line-height:1.1;letter-spacing:-.02em;text-wrap:balance;overflow-wrap:break-word}
.lp-sec-t:lang(ka){letter-spacing:0;line-height:1.25}
.lp-sec-lead{margin-top:clamp(14px,1.8cqi,22px);font-size:clamp(1.02rem,.96rem + .35cqi,1.2rem);color:var(--lp-muted);text-wrap:pretty}
.lp-sec-body{min-width:0}
.lp-sec-body .lp-sec>.lp-wrap{max-width:none;padding-inline:0}
.lp-sec-body .lp-sec-toned>.lp-wrap,.lp-sec-body .lp-sec-hasbg>.lp-wrap{padding-inline:clamp(20px,4cqi,48px)}
.lp-sec-body .lp-sec-toned,.lp-sec-body .lp-sec-hasbg{border-radius:calc(var(--lp-radius,10px)*1.5);overflow:hidden}
.lp-root[data-mode=edit] .lp-sec-body{min-height:48px}
`,columns:`
.lp-cols{display:flex;gap:var(--lp-cg,24px);align-items:flex-start}
.lp-cols-va-center{align-items:center}
.lp-cols-va-bottom{align-items:flex-end}
.lp-col{min-width:0}
@container lp (max-width:900px){.lp-cols-n3,.lp-cols-n4{flex-wrap:wrap}.lp-cols-n3>.lp-col,.lp-cols-n4>.lp-col{flex:1 1 calc(50% - var(--lp-cg,24px))!important}}
@container lp (max-width:600px){.lp-cols{flex-direction:column;align-items:stretch}.lp-cols>.lp-col{flex:none!important;width:100%}}
.lp-root[data-mode=edit] .lp-col{align-self:stretch;min-height:48px}
`,divider:`
.lp-hr{display:block;height:0;margin:6px 0;border:0;border-top:var(--lp-hrw,1px) solid var(--lp-border);color:var(--lp-border)}
`,spacer:`
.lp-spacer{display:block;height:var(--lp-sph,32px)}
.lp-b.lp-b-spacer{margin:var(--lp-mt,0px) 0 var(--lp-mb,0px)}
@container lp (max-width:600px){.lp-spacer{height:calc(var(--lp-sph,32px)*.6)}}
.lp-root[data-mode=edit] .lp-spacer{border-radius:4px;background:repeating-linear-gradient(-45deg,color-mix(in srgb,var(--lp-text) 9%,transparent) 0 5px,transparent 5px 10px)}
`,heading:`
.lp-hdg-eb{margin:0 0 10px}
.lp-hdg>.lp-h{margin:0;text-wrap:balance;overflow-wrap:break-word}
.lp-hdg-ic{width:1em;height:1em;margin-inline-end:.35em;vertical-align:-.12em;color:var(--lp-accent)}
`,text:`
.lp-tx{overflow-wrap:break-word}
.lp-tx:not(.lp-tx-c2){max-width:72ch}
.lp-b[style*="text-align:center"] .lp-tx{margin-inline:auto}
.lp-b[style*="text-align:right"] .lp-tx{margin-inline-start:auto}
.lp-tx-s{font-size:.92em}
.lp-tx-l{font-size:clamp(1.08rem,1rem + .45cqi,1.28rem);line-height:1.6}
.lp-tx-c2{columns:2;column-gap:clamp(28px,4cqi,64px)}
.lp-tx-c2 li,.lp-tx-c2 blockquote{break-inside:avoid}
.lp-tx-c2 h3,.lp-tx-c2 h4{break-after:avoid}
@container lp (max-width:600px){.lp-tx-c2{columns:1}}
`,quote:`
.lp-qt{--lp-qc:var(--lp-muted)}
.lp-qt-t-info{--lp-qc:var(--lp-info,#2563eb)}
.lp-qt-t-success{--lp-qc:var(--lp-success,#16a34a)}
.lp-qt-t-warning{--lp-qc:var(--lp-warning,#d97706)}
.lp-qt-t-accent{--lp-qc:var(--lp-accent)}
.lp-qt-body{margin:0;min-width:0}
.lp-qt-a{margin:12px 0 0;font-size:.92em;font-weight:600;color:var(--lp-muted)}
`,buttons:`
.lp-btnb-center .lp-btns{justify-content:center}
.lp-btnb-right .lp-btns{justify-content:flex-end}
`,features:`
.lp-feat{margin:0;padding:0;list-style:none}
.lp-feat-i{position:relative;min-width:0;margin:0}
.lp-feat-ic{margin-bottom:18px}
.lp-feat-t{margin:0 0 8px;font-size:1.16em;line-height:1.28;letter-spacing:-.01em;overflow-wrap:break-word}
.lp-feat-t:lang(ka){letter-spacing:0}
.lp-feat-x{color:var(--lp-muted)}
.lp-feat-media{margin-bottom:20px;border-radius:var(--lp-radius,10px);overflow:hidden}
`,stats:`
.lp-stat{margin:0;padding:0;list-style:none}
.lp-stat-i{display:flex;flex-direction:column;gap:8px;min-width:0;margin:0}
.lp-stat-v{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 .06em;font-family:var(--lp-font-h);font-size:clamp(2.2rem,1.25rem + 2.9cqi,3.75rem);font-weight:700;line-height:1;letter-spacing:-.03em;color:var(--lp-accent);font-variant-numeric:tabular-nums lining-nums;overflow-wrap:anywhere}
.lp-stat-s{font-size:.58em;letter-spacing:0}
.lp-stat-l{color:var(--lp-muted);line-height:1.4;overflow-wrap:break-word}
.lp-root[data-mode=edit] .lp-stat-ph{opacity:.3}
`,steps:`
.lp-step{--lp-sgap:clamp(20px,3cqi,40px);display:grid;grid-template-columns:repeat(var(--lp-cols,3),minmax(0,1fr));gap:var(--lp-sgap);margin:0;padding:0;list-style:none;counter-reset:lp-step}
.lp-step-i{position:relative;min-width:0;margin:0;counter-increment:lp-step}
.lp-step-n{display:inline-grid;place-items:center;font-family:var(--lp-font-h);font-weight:700;line-height:1;color:var(--lp-accent);font-variant-numeric:tabular-nums}
.lp-step-n:not(.lp-step-icn)::before{content:counter(lp-step,decimal-leading-zero)}
.lp-step-n .lp-ic{width:1.5em;height:1.5em}
.lp-step-t{margin:0 0 8px;font-size:1.14em;line-height:1.28;overflow-wrap:break-word}
.lp-step-x{color:var(--lp-muted)}
@container lp (max-width:900px){.lp-step{grid-template-columns:repeat(var(--lp-cols2,2),minmax(0,1fr))}}
@container lp (max-width:600px){.lp-step{grid-template-columns:minmax(0,1fr)}}
`,};const CSS_VARIANTS_A={nav:{'variant=bar':'','variant=center':`
.lp-nav-center .lp-nav-in{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);grid-template-areas:"a b c" "m m m";align-items:center;row-gap:2px;padding-block:16px 6px}
.lp-nav-center .lp-nav-brand{grid-area:b;justify-self:center;font-size:1.35em}
.lp-nav-center .lp-nav-tools{grid-area:c;justify-self:end}
.lp-nav-center .lp-nav-menu{grid-area:m;justify-self:center;margin:0}
.lp-nav-center .lp-nav-m{grid-area:a}
@container lp (max-width:900px){.lp-nav-center .lp-nav-in{display:flex;padding-block:10px}.lp-nav-center .lp-nav-brand{font-size:1.2em}}
`,'variant=split':`
.lp-nav-split .lp-nav-menu{flex:1;margin-inline-start:clamp(16px,3cqi,48px)}
.lp-nav-split .lp-nav-ul{margin-inline:auto}
@container lp (max-width:900px){.lp-nav-split .lp-nav-menu{margin:0}.lp-nav-split .lp-nav-ul{margin:0}}
`,},hero:{'layout=center':'','layout=left':'','layout=split':`
.lp-hero-split .lp-hero-grid{grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr)}
.lp-hero-split.lp-hero-nomedia .lp-hero-grid{grid-template-columns:minmax(0,1fr)}
@container lp (max-width:900px){.lp-hero-split .lp-hero-grid{grid-template-columns:minmax(0,1fr)}}
`,'layout=split-rev':`
.lp-hero-split-rev .lp-hero-grid{grid-template-columns:minmax(0,.95fr) minmax(0,1.05fr)}
.lp-hero-split-rev .lp-hero-media{order:-1}
.lp-hero-split-rev.lp-hero-nomedia .lp-hero-grid{grid-template-columns:minmax(0,1fr)}
@container lp (max-width:900px){.lp-hero-split-rev .lp-hero-grid{grid-template-columns:minmax(0,1fr)}.lp-hero-split-rev .lp-hero-media{order:0}}
`,},footer:{'variant=columns':'','variant=simple':`
.lp-foot-simple{padding-block:clamp(28px,3.5cqi,44px)}
.lp-foot-simple .lp-foot-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px 40px}
.lp-foot-simple .lp-foot-brand{flex-direction:row;flex-wrap:wrap;align-items:center;gap:6px 12px;max-width:none}
.lp-foot-simple .lp-foot-x{flex-basis:100%;font-size:.94em}
.lp-foot-simple .lp-foot-cols{display:flex;flex-wrap:wrap;align-items:center;gap:10px 32px}
.lp-foot-simple .lp-foot-col{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px}
.lp-foot-simple .lp-foot-h{margin:0}
.lp-foot-simple .lp-foot-links ul,.lp-foot-simple .lp-foot-links ol{display:flex;flex-wrap:wrap;gap:6px 20px}
.lp-foot-simple .lp-foot-links li,.lp-foot-simple .lp-foot-links p{margin:0}
.lp-foot-simple .lp-foot-bottom{margin-top:20px;padding-top:16px}
`,'variant=center':`
.lp-foot-center .lp-foot-top{grid-template-columns:minmax(0,1fr);justify-items:center;text-align:center}
.lp-foot-center .lp-foot-brand{align-items:center}
.lp-foot-center .lp-foot-cols{display:flex;flex-wrap:wrap;justify-content:center;gap:20px 48px}
.lp-foot-center .lp-foot-links ul,.lp-foot-center .lp-foot-links ol{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 22px}
.lp-foot-center .lp-foot-links li{margin:0}
.lp-foot-center .lp-foot-bottom{justify-content:center;text-align:center}
`,},section:{'shape=none':'','shape=wave':baCutCSS('wave',BA_MASK_WAVE,'clamp(26px,4.4cqi,64px)'),'shape=slant':baCutCSS('slant',BA_MASK_SLANT,'clamp(24px,5cqi,80px)'),'shape=zigzag':baCutCSS('zigzag',BA_MASK_ZIGZAG,'14px','28px'),'shape=ornament':`
.lp-sh-ornament{padding-top:calc(var(--lp-sec-py) + 18px)}
.lp-sec-orn{position:absolute;top:0;inset-inline:0;z-index:1;height:18px;color:var(--lp-accent);background:currentColor;-webkit-mask:${BA_MASK_ORN} 50% 50%/48px 18px repeat-x;mask:${BA_MASK_ORN} 50% 50%/48px 18px repeat-x;pointer-events:none}
@media (forced-colors:active){.lp-sec-orn{display:none}}
`,},divider:{'variant=solid':'','variant=dashed':`
.lp-hr-dashed{border-top-style:dashed}
`,'variant=dotted':`
.lp-hr-dotted{border-top-style:dotted}
`,'variant=double':`
.lp-hr-double{border-top-style:double;border-top-width:max(3px,calc(var(--lp-hrw,1px)*3))}
`,'variant=accent':`
.lp-hr-accent{height:max(2px,var(--lp-hrw,1px));border:0;border-radius:99px;background:linear-gradient(90deg,var(--lp-accent),var(--lp-accent2,var(--lp-accent)))}
`,'variant=ornament':`
.lp-hr-ornament{display:flex;align-items:center;gap:14px;height:auto;border:0;color:var(--lp-accent)}
.lp-hr-ornament::before,.lp-hr-ornament::after{content:"";flex:1;height:var(--lp-hrw,1px);background:linear-gradient(90deg,transparent,currentColor)}
.lp-hr-ornament::after{background:linear-gradient(90deg,currentColor,transparent)}
.lp-hr-orn{display:block;flex:none;width:60px;height:20px;fill:currentColor}
`,},quote:{'variant=callout':`
.lp-qt-callout{display:flex;gap:14px;padding:18px 22px;border:1px solid color-mix(in srgb,var(--lp-qc) 24%,transparent);border-inline-start:4px solid var(--lp-qc);border-radius:var(--lp-radius,10px);background:color-mix(in srgb,var(--lp-qc) 7%,var(--lp-surface,var(--lp-bg)))}
.lp-qt-ic{flex:none;width:1.4em;height:1.4em;margin-top:.1em;color:var(--lp-qc)}
.lp-qt-main{flex:1;min-width:0}
.lp-qt-callout .lp-qt-a{margin-top:8px}
`,'variant=pull':`
.lp-qt-pull{margin:0}
.lp-qt-pull.lp-qt-t-note{--lp-qc:var(--lp-accent)}
.lp-qt-mark{display:block;width:clamp(36px,4cqi,52px);height:auto;margin-bottom:16px;fill:var(--lp-qc);color:var(--lp-qc)}
.lp-qt-mark.lp-ic{height:clamp(36px,4cqi,52px);fill:none}
.lp-qt-pull .lp-qt-body{font-family:var(--lp-font-h);font-size:clamp(1.3rem,1.02rem + 1.25cqi,2.05rem);font-weight:500;line-height:1.38;letter-spacing:-.012em;text-wrap:pretty}
.lp-qt-pull .lp-qt-body:lang(ka){letter-spacing:0}
.lp-qt-pull .lp-qt-a{display:flex;align-items:center;gap:12px;margin-top:22px;font-size:.95em;color:var(--lp-text)}
.lp-qt-pull .lp-qt-a::before{content:"";flex:none;width:28px;height:2px;border-radius:2px;background:var(--lp-qc)}
.lp-b[style*="text-align:center"] .lp-qt-mark{margin-inline:auto}
.lp-b[style*="text-align:center"] .lp-qt-pull .lp-qt-a{justify-content:center}
`,},features:{'variant=cards':`
.lp-feat-cards .lp-feat-i{--lp-fp:clamp(22px,2.4cqi,32px);display:flex;flex-direction:column;padding:var(--lp-fp);overflow:hidden}
.lp-feat-cards .lp-feat-media{margin:calc(-1*var(--lp-fp)) calc(-1*var(--lp-fp)) 22px;border-radius:0}
.lp-feat-cards .lp-feat-b{flex:1}
`,'variant=icons':`
.lp-feat-icons .lp-feat-ic{width:56px;height:56px;margin-bottom:20px;border-radius:16px}
.lp-feat-icons .lp-feat-ic .lp-ic{width:26px;height:26px}
.lp-feat-icons .lp-feat-t{font-size:1.22em}
.lp-b[style*="text-align:center"] .lp-feat-icons .lp-feat-ic{margin-inline:auto}
`,'variant=list':`
.lp-feat-list .lp-feat-i{display:flex;align-items:flex-start;gap:16px}
.lp-feat-list .lp-feat-ic{flex:none;margin:0}
.lp-feat-list .lp-feat-b{flex:1;min-width:0}
.lp-feat-list .lp-icbox{width:40px;height:40px}
.lp-feat-chk{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--lp-tint,color-mix(in srgb,var(--lp-accent) 12%,transparent));color:var(--lp-accent)}
.lp-feat-chk .lp-ic{width:16px;height:16px;stroke-width:2.6}
.lp-feat-list .lp-feat-t{margin-bottom:4px;font-size:1.06em}
`,'variant=split':`
.lp-feat-split{display:flex;flex-direction:column;gap:clamp(48px,7cqi,112px)}
.lp-feat-split .lp-feat-i{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center;gap:clamp(28px,5cqi,88px)}
.lp-feat-split .lp-feat-nom{grid-template-columns:minmax(0,1fr)}
.lp-feat-split .lp-feat-media{margin:0;border-radius:calc(var(--lp-radius,10px)*1.5 + 2px);box-shadow:var(--lp-shadow-lg)}
.lp-feat-split .lp-feat-i:nth-child(even) .lp-feat-media{order:2}
.lp-feat-split .lp-feat-t{margin-bottom:14px;font-size:clamp(1.4rem,1.05rem + 1.3cqi,2.15rem);line-height:1.15;letter-spacing:-.018em}
.lp-feat-split .lp-feat-x{font-size:1.05em}
@container lp (max-width:600px){.lp-feat-split .lp-feat-i{grid-template-columns:minmax(0,1fr)}.lp-feat-split .lp-feat-i:nth-child(even) .lp-feat-media{order:0}}
`,},stats:{'variant=plain':`
.lp-stat-plain .lp-stat-i{padding-inline-start:20px;border-inline-start:2px solid color-mix(in srgb,var(--lp-accent) 38%,transparent)}
`,'variant=cards':`
.lp-stat-cards .lp-stat-i{padding:clamp(22px,2.4cqi,32px)}
`,'variant=band':`
.lp-stat-band{display:flex;flex-wrap:wrap;gap:1px;overflow:hidden;border:1px solid var(--lp-border);border-radius:calc(var(--lp-radius,10px)*1.5);background:var(--lp-border)}
.lp-stat-band .lp-stat-i{flex:1 1 calc(100% / var(--lp-cols,4) - 1px);align-items:center;justify-content:center;padding:clamp(24px,3cqi,40px) 20px;text-align:center;background:var(--lp-surface,var(--lp-bg))}
.lp-stat-band .lp-stat-v{justify-content:center}
@container lp (max-width:900px){.lp-stat-band .lp-stat-i{flex-basis:calc(50% - 1px)}}
`,},steps:{'variant=numbers':`
.lp-step-numbers .lp-step-i{padding-top:20px;border-top:1px solid var(--lp-border)}
.lp-step-numbers .lp-step-n{margin-bottom:16px;font-size:clamp(2.3rem,1.6rem + 2.2cqi,3.3rem);letter-spacing:-.04em;color:transparent;-webkit-text-stroke:1.5px var(--lp-accent)}
.lp-step-numbers .lp-step-icn{color:var(--lp-accent);font-size:1.6em;-webkit-text-stroke:0}
@media (forced-colors:active){.lp-step-numbers .lp-step-n{color:CanvasText;-webkit-text-stroke:0}}
`,'variant=line':`
.lp-step-line{--lp-dot:46px}
.lp-step-line .lp-step-n{position:relative;z-index:1;width:var(--lp-dot);height:var(--lp-dot);margin-bottom:20px;border:2px solid var(--lp-accent);border-radius:50%;background:var(--lp-cbg,var(--lp-bg));font-size:.95em}
.lp-step-line .lp-step-n .lp-ic{width:22px;height:22px}
.lp-step-line .lp-step-i:not(:last-child)::after{content:"";position:absolute;top:calc(var(--lp-dot)/2 - 1px);inset-inline-start:calc(var(--lp-dot) + 12px);inset-inline-end:calc(12px - var(--lp-sgap));height:2px;border-radius:2px;background:color-mix(in srgb,var(--lp-accent) 40%,var(--lp-border))}
.lp-step.lp-step-vert{grid-template-columns:minmax(0,1fr)}
.lp-step-vert .lp-step-i{display:grid;grid-template-columns:var(--lp-dot) minmax(0,1fr);column-gap:20px;align-items:start}
.lp-step-vert .lp-step-n{margin:0}
.lp-step-vert .lp-step-b{padding-top:calc(var(--lp-dot)/2 - .75em)}
.lp-step-vert .lp-step-i:not(:last-child)::after{top:calc(var(--lp-dot) + 8px);bottom:calc(8px - var(--lp-sgap));inset-inline-start:calc(var(--lp-dot)/2 - 1px);inset-inline-end:auto;width:2px;height:auto}
@container lp (max-width:900px){.lp-step.lp-step-line{grid-template-columns:minmax(0,1fr)}.lp-step-line .lp-step-i{display:grid;grid-template-columns:var(--lp-dot) minmax(0,1fr);column-gap:20px;align-items:start}.lp-step-line .lp-step-n{margin:0}.lp-step-line .lp-step-b{padding-top:calc(var(--lp-dot)/2 - .75em)}.lp-step-line .lp-step-i:not(:last-child)::after{top:calc(var(--lp-dot) + 8px);bottom:calc(8px - var(--lp-sgap));inset-inline-start:calc(var(--lp-dot)/2 - 1px);inset-inline-end:auto;width:2px;height:auto}}
`,'variant=cards':`
.lp-step-cards .lp-step-i{padding:clamp(22px,2.4cqi,30px)}
.lp-step-cards .lp-step-n{width:46px;height:46px;margin-bottom:20px;border-radius:calc(var(--lp-radius,10px) + 2px);background:var(--lp-accent);color:var(--lp-on-accent);font-size:.98em}
.lp-step-cards .lp-step-n .lp-ic{width:22px;height:22px}
`,},};const BLOCK_DEPS_A={hero:['media'],features:['grid','card','icbox','media'],stats:['grid','card'],steps:['card'],};const OWN_A=[[/\.lp-nav/,'nav'],[/\.lp-hero/,'hero'],[/\.lp-foot(?!er)/,'footer'],[/\.lp-sec(?![\w-])|\.lp-sec-|\.lp-sh-/,'section'],[/\.lp-cols?(?![\w])/,'columns'],[/\.lp-hr(?![\w])/,'divider'],[/\.lp-spacer/,'spacer'],[/\.lp-hdg/,'heading'],[/\.lp-tx(?![\w])/,'text'],[/\.lp-qt/,'quote'],[/\.lp-btnb/,'buttons'],[/\.lp-feat/,'features'],[/\.lp-stat/,'stats'],[/\.lp-step/,'steps'],];const UI_A={en:{openMenu:'Open menu',closeMenu:'Close menu','pa.brand':'Brand name','pa.navLink':'Link','pa.cta':'Button','pa.badge':'Badge, e.g. “New season”','pa.eyebrow':'Small label above the title','pa.heroTitle':'Main headline of the page','pa.heroText':'A sentence or two about what you offer and for whom','pa.secTitle':'Section title','pa.secLead':'Introductory text (optional)','pa.headline':'Heading','pa.paragraph':'Start typing…','pa.quote':'Quote or note','pa.author':'Author','pa.featTitle':'Benefit','pa.featText':'Short description','pa.statLabel':'What the number means','pa.statSuffix':'+','pa.stepTitle':'Step','pa.stepText':'What happens at this step','pa.footText':'Address, opening hours or a short description','pa.colTitle':'Column title','pa.colLinks':'Links, one per line','pa.copy':'© Company name',},ru:{openMenu:'Открыть меню',closeMenu:'Закрыть меню','pa.brand':'Название бренда','pa.navLink':'Ссылка','pa.cta':'Кнопка','pa.badge':'Плашка, например «Новый сезон»','pa.eyebrow':'Короткая надпись над заголовком','pa.heroTitle':'Главный заголовок страницы','pa.heroText':'Одно-два предложения о том, что вы предлагаете и для кого','pa.secTitle':'Заголовок раздела','pa.secLead':'Вводный текст (необязательно)','pa.headline':'Заголовок','pa.paragraph':'Начните печатать…','pa.quote':'Цитата или примечание','pa.author':'Автор','pa.featTitle':'Преимущество','pa.featText':'Краткое описание','pa.statLabel':'Что означает число','pa.statSuffix':'+','pa.stepTitle':'Шаг','pa.stepText':'Что происходит на этом шаге','pa.footText':'Адрес, часы работы или краткое описание','pa.colTitle':'Заголовок колонки','pa.colLinks':'Ссылки, по одной в строке','pa.copy':'© Название компании',},uk:{openMenu:'Відкрити меню',closeMenu:'Закрити меню','pa.brand':'Назва бренду','pa.navLink':'Посилання','pa.cta':'Кнопка','pa.badge':'Плашка, наприклад «Новий сезон»','pa.eyebrow':'Короткий напис над заголовком','pa.heroTitle':'Головний заголовок сторінки','pa.heroText':'Одне-два речення про те, що ви пропонуєте і для кого','pa.secTitle':'Заголовок розділу','pa.secLead':'Вступний текст (необов’язково)','pa.headline':'Заголовок','pa.paragraph':'Почніть друкувати…','pa.quote':'Цитата або примітка','pa.author':'Автор','pa.featTitle':'Перевага','pa.featText':'Короткий опис','pa.statLabel':'Що означає число','pa.statSuffix':'+','pa.stepTitle':'Крок','pa.stepText':'Що відбувається на цьому кроці','pa.footText':'Адреса, години роботи або короткий опис','pa.colTitle':'Заголовок колонки','pa.colLinks':'Посилання, по одному в рядку','pa.copy':'© Назва компанії',},de:{openMenu:'Menü öffnen',closeMenu:'Menü schließen','pa.brand':'Markenname','pa.navLink':'Link','pa.cta':'Button','pa.badge':'Hinweis, z. B. „Neue Saison“','pa.eyebrow':'Kurzer Text über der Überschrift','pa.heroTitle':'Hauptüberschrift der Seite','pa.heroText':'Ein, zwei Sätze dazu, was Sie anbieten und für wen','pa.secTitle':'Titel des Abschnitts','pa.secLead':'Einleitungstext (optional)','pa.headline':'Überschrift','pa.paragraph':'Text eingeben …','pa.quote':'Zitat oder Hinweis','pa.author':'Autor','pa.featTitle':'Vorteil','pa.featText':'Kurze Beschreibung','pa.statLabel':'Was die Zahl bedeutet','pa.statSuffix':'+','pa.stepTitle':'Schritt','pa.stepText':'Was in diesem Schritt passiert','pa.footText':'Adresse, Öffnungszeiten oder eine kurze Beschreibung','pa.colTitle':'Spaltentitel','pa.colLinks':'Links, einer pro Zeile','pa.copy':'© Firmenname',},fr:{openMenu:'Ouvrir le menu',closeMenu:'Fermer le menu','pa.brand':'Nom de la marque','pa.navLink':'Lien','pa.cta':'Bouton','pa.badge':'Pastille, p. ex. « Nouvelle saison »','pa.eyebrow':'Petit texte au-dessus du titre','pa.heroTitle':'Titre principal de la page','pa.heroText':'Une ou deux phrases sur ce que vous proposez et pour qui','pa.secTitle':'Titre de la section','pa.secLead':'Texte d’introduction (facultatif)','pa.headline':'Titre','pa.paragraph':'Commencez à écrire…','pa.quote':'Citation ou remarque','pa.author':'Auteur','pa.featTitle':'Atout','pa.featText':'Brève description','pa.statLabel':'Ce que signifie le chiffre','pa.statSuffix':'+','pa.stepTitle':'Étape','pa.stepText':'Ce qui se passe à cette étape','pa.footText':'Adresse, horaires ou brève description','pa.colTitle':'Titre de colonne','pa.colLinks':'Liens, un par ligne','pa.copy':'© Nom de l’entreprise',},es:{openMenu:'Abrir menú',closeMenu:'Cerrar menú','pa.brand':'Nombre de la marca','pa.navLink':'Enlace','pa.cta':'Botón','pa.badge':'Distintivo, p. ej. «Nueva temporada»','pa.eyebrow':'Texto breve sobre el título','pa.heroTitle':'Titular principal de la página','pa.heroText':'Una o dos frases sobre lo que ofreces y para quién','pa.secTitle':'Título de la sección','pa.secLead':'Texto introductorio (opcional)','pa.headline':'Título','pa.paragraph':'Empieza a escribir…','pa.quote':'Cita o nota','pa.author':'Autor','pa.featTitle':'Ventaja','pa.featText':'Descripción breve','pa.statLabel':'Qué significa la cifra','pa.statSuffix':'+','pa.stepTitle':'Paso','pa.stepText':'Qué ocurre en este paso','pa.footText':'Dirección, horario o una breve descripción','pa.colTitle':'Título de la columna','pa.colLinks':'Enlaces, uno por línea','pa.copy':'© Nombre de la empresa',},ka:{openMenu:'მენიუს გახსნა',closeMenu:'მენიუს დახურვა','pa.brand':'ბრენდის სახელი','pa.navLink':'ბმული','pa.cta':'ღილაკი','pa.badge':'ნიშანი, მაგ. „ახალი სეზონი“','pa.eyebrow':'მოკლე წარწერა სათაურის ზემოთ','pa.heroTitle':'გვერდის მთავარი სათაური','pa.heroText':'ერთი-ორი წინადადება იმაზე, რას სთავაზობთ და ვის','pa.secTitle':'სექციის სათაური','pa.secLead':'შესავალი ტექსტი (არასავალდებულო)','pa.headline':'სათაური','pa.paragraph':'დაიწყეთ წერა…','pa.quote':'ციტატა ან შენიშვნა','pa.author':'ავტორი','pa.featTitle':'უპირატესობა','pa.featText':'მოკლე აღწერა','pa.statLabel':'რას ნიშნავს ეს რიცხვი','pa.statSuffix':'+','pa.stepTitle':'ნაბიჯი','pa.stepText':'რა ხდება ამ ნაბიჯზე','pa.footText':'მისამართი, სამუშაო საათები ან მოკლე აღწერა','pa.colTitle':'სვეტის სათაური','pa.colLinks':'ბმულები, თითო ხაზზე','pa.copy':'© კომპანიის სახელი',},};export{CSS_BLOCKS_A,CSS_VARIANTS_A,BLOCK_DEPS_A,OWN_A,BT_A,UI_A};