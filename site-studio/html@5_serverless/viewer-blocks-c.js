import{uid}from"./util/id.js";import{optList,numOpts,ALIGN3}from"./doc/schema.js";import{qrSVG}from"./qr/qr.js";import{formFieldsHTML}from"./viewer-blocks-b.js";import{mediaBox,objectHTML,attCardHTML}from"./viewer-render.js";import{REGIONS}from"./viewer-base.js";import{isImage,attOf,mimeBase,previewKind}from"./doc/attach.js";import{pickText}from"./i18n/text.js";import{uiText}from"./doc/dict.js";import{escapeAttr,escapeHTML}from"./html/escape.js";import{normURL}from"./html/url.js";import{feature,hrefAttr,icon,ui,grp,fld,has,txt,needUi,plainIn,di,noItems,addItemBox,plainOf}from"./doc/render.js";import{intlSupports,intl}from"./i18n/intl.js";import{num,str,own,pad2,isObj,oneOf}from"./util/value.js";import{primary}from"./i18n/lang.js";const bcPd=(ctx)=>ctx.pd||ctx.doc;const bcInt=(v,def,min,max)=>Math.round(num(v,def,min,max));const BC_SKU_RE=/^[A-Za-z0-9._-]{1,40}$/;function bcSku(v){const s=typeof v==='string'?v.trim():'';return BC_SKU_RE.test(s)?s:'';}
function bcAmount(v){if(v==null||v===''||typeof v==='boolean')return null;const n=typeof v==='number'?v:Number(String(v).trim().replace(',','.'));return Number.isFinite(n)&&n>=0&&n<1e12?n:null;}
const bcCur=(doc)=>{const c=doc&&doc.shop&&doc.shop.currency;return typeof c==='string'&&/^[A-Z]{3}$/.test(c)?c:'USD';};const bcQuote=(doc)=>!!(doc&&doc.shop&&doc.shop.mode==='quote');function bcVar(ctx,type,prop,v){const s=ctx.use&&ctx.use.variants;if(s&&typeof s.add==='function')s.add(type+':'+prop+'='+v);}
function bcNeedAtt(ctx,a,feat){if(ctx.edit||!a)return;const u=ctx.use||{};if(u.blob&&typeof u.blob.add==='function')u.blob.add(a.id);if(u.atts&&typeof u.atts.add==='function')u.atts.add(a.id);if(feat)feature(ctx,feat);}
function bcHref(ctx,raw){let u=str(raw).trim();if(!u)return'';if(u[0]!=='#')u=normURL(u)||u;return hrefAttr(ctx,u);}
const BC_RATIOS=['auto','16/9','4/3','1/1','3/4'];const bcRatio=(v,def,allowed=BC_RATIOS)=>(allowed.includes(v)?v:def);const bcRatioOpts=(...vals)=>vals.map((v)=>(v==='auto'?{v,l:'o.ratioAuto'}:{v,l:v.replace('/',':')}));function bcZoom(ctx,html,group){if(ctx.edit||!html||/\sdata-lp-zoom\b/.test(html))return html;return html.replace(/<img\b/,`<img data-lp-zoom="${escapeAttr(group)}" tabindex="0" role="button" aria-haspopup="dialog"`);}
function bcPh(ctx,path,ic,cls){return`<div class="lp-ph${cls?' '+cls:''}" data-att-key="${escapeAttr(path)}">${icon(ctx,ic)}`
+`<span>${escapeHTML(uiText('edit.pickFile',ctx.uiLang,ctx.doc))}</span></div>`;}
const BC_SYM_FIX={GEL:[/ლ/g,'₾']};const BC_DEC_COMMA=/^(ru|uk|be|kk|ka|hy|az|de|fr|es|it|pt|pl|cs|sk|sl|hr|sr|bg|ro|tr|nl|da|nb|nn|sv|fi|et|lv|lt|el|hu|id)$/;function formatPrice(n,cur,lang){const v=bcAmount(n);if(v==null)return'';const c=typeof cur==='string'&&/^[A-Z]{3}$/.test(cur)?cur:'USD';const l=typeof lang==='string'&&lang?lang:'en';const whole=Math.abs(v-Math.round(v))<1e-9;if(intlSupports('NumberFormat',l)){for(const display of['narrowSymbol','symbol']){try{const o={style:'currency',currency:c,currencyDisplay:display};if(whole){o.minimumFractionDigits=0;o.maximumFractionDigits=0;}
let s=intl('NumberFormat',l,o).format(v);const fix=own(BC_SYM_FIX,c);if(fix)s=s.replace(fix[0],fix[1]);return s;}catch(e){}}}
const[i,f]=(whole?String(Math.round(v)):v.toFixed(2)).split('.');return i.replace(/\B(?=(\d{3})+(?!\d))/g,' ')+(f?(BC_DEC_COMMA.test(primary(l))?',':'.')+f:'')+' '+c;}
function priceHTML(ctx,price,old,unit,o={}){const cur=bcCur(ctx.doc);const p=bcAmount(price);const q=bcAmount(old);let s;if(p==null){s=`<span class="lp-price-req">${ui(ctx,'priceOnRequest')}</span>`;}else{s=`<span class="lp-price-now">${grp(ctx,(l)=>escapeHTML(o.from?uiText('from',l,ctx.doc,{price:formatPrice(p,cur,l)}):formatPrice(p,cur,l)),false)}</span>`;if(q!=null&&q>p){s+=`<del class="lp-price-old"><span class="lp-sr">${ui(ctx,'oldPrice')} </span>`
+`${grp(ctx,(l)=>escapeHTML(formatPrice(q,cur,l)),false)}</del>`;}}
let u='';if(ctx.edit&&o.blk&&o.unitPath){u=fld(ctx,o.blk,o.unitPath,'plain','span','lp-price-unit','ph.prodUnit',{ecls:'lp-opt'});}else if(p!=null&&unit&&has(ctx,unit)){u=`<span class="lp-price-unit">${grp(ctx,(l)=>{const t=str(pickText(unit,l,bcPd(ctx))).trim();return t?escapeHTML(uiText('perUnit',l,ctx.doc,{unit:t})):'';},false)}</span>`;}
return`<div class="lp-price${o.cls?' '+o.cls:''}">${s}${u}</div>`;}
function bcBuyLabel(ctx,o,key){if(ctx.edit&&o.blk&&o.path){return fld(ctx,o.blk,o.path,'plain','span','lp-buy-t',null,{ph:uiText(key,ctx.lang,ctx.doc)});}
return`<span class="lp-buy-t">${o.label&&has(ctx,o.label)?txt(ctx,o.label):ui(ctx,key)}</span>`;}
function bcOffBtn(ctx,key,sm){return`<span class="lp-btn lp-btn-secondary lp-buy-off${sm?' lp-btn-sm':''}" aria-disabled="true">${ui(ctx,key)}</span>`;}
function buyHTML(ctx,sku,o={}){const s=bcSku(sku);if(!s)return'';const sm=o.sm?' lp-btn-sm':'';if(o.out)return`<div class="lp-buy">${bcOffBtn(ctx,o.outKey||'soldOut',o.sm)}</div>`;const quote=bcQuote(ctx.doc);const key=o.labelKey||(quote?'addToQuote':'addToCart');const kind=o.kind==='secondary'?'secondary':'primary';const ic=icon(ctx,o.icon||(quote?'plus':'cart'));const min=bcInt(o.min,1,1,9999);const step=bcInt(o.step,1,1,9999);const label=bcBuyLabel(ctx,o,key);if(ctx.edit){const qty=o.qty?`<span class="lp-qty-look" aria-hidden="true"><span>−</span><span>${min}</span><span>+</span></span>`:'';return`<div class="lp-buy">${qty}<span class="lp-btn lp-btn-${kind}${sm}">${ic}${label}</span></div>`;}
feature(ctx,'cart');if(ctx.use)ctx.use.shop=true;needUi(ctx,'qty','decrease','increase');let qty='';if(o.qty){let lab='';let aria;if(ctx.langs.length>1){ctx.bcSeq=(ctx.bcSeq||0)+1;const id='lp-qn-'+ctx.bcSeq;lab=`<span class="lp-sr lp-js-only" id="${id}">${ui(ctx,'qty')}</span>`;aria=` aria-labelledby="${id}"`;}else{aria=` aria-label="${escapeAttr(uiText('qty',ctx.lang,ctx.doc))}"`;}
const sa=escapeAttr(s);qty=`${lab}<div class="lp-qty lp-js-only" data-lp-qty="${sa}">`
+`<button type="button" data-lp-dec><span aria-hidden="true">−</span><span class="lp-sr">${ui(ctx,'decrease')}</span></button>`
+`<input type="number" inputmode="numeric" min="${min}" max="9999" step="${step}" value="${min}"${aria}>`
+`<button type="button" data-lp-inc><span aria-hidden="true">+</span><span class="lp-sr">${ui(ctx,'increase')}</span></button></div>`;}
return`<div class="lp-buy">${qty}<button type="button" class="lp-btn lp-btn-${kind}${sm} lp-js-only" data-lp-add="${escapeAttr(s)}">${ic}${label}</button></div>`;}
const BC_DAYS={en:['Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec','January February March April May June July August September October November December','Sun Mon Tue Wed Thu Fri Sat','{M} {d}, {y}','{M} {d}'],ru:['янв. февр. мар. апр. мая июн. июл. авг. сент. окт. нояб. дек.','января февраля марта апреля мая июня июля августа сентября октября ноября декабря','вс пн вт ср чт пт сб','{d} {M} {y}','{d} {M}'],uk:['січ. лют. бер. квіт. трав. черв. лип. серп. вер. жовт. лист. груд.','січня лютого березня квітня травня червня липня серпня вересня жовтня листопада грудня','нд пн вт ср чт пт сб','{d} {M} {y}','{d} {M}'],de:['Jan. Feb. März Apr. Mai Juni Juli Aug. Sept. Okt. Nov. Dez.','Januar Februar März April Mai Juni Juli August September Oktober November Dezember','So Mo Di Mi Do Fr Sa','{d}. {M} {y}','{d}. {M}'],fr:['janv. févr. mars avr. mai juin juil. août sept. oct. nov. déc.','janvier février mars avril mai juin juillet août septembre octobre novembre décembre','dim. lun. mar. mer. jeu. ven. sam.','{d} {M} {y}','{d} {M}'],es:['ene feb mar abr may jun jul ago sept oct nov dic','enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre','dom lun mar mié jue vie sáb','{d} de {M} de {y}','{d} {M}'],ka:['იან თებ მარ აპრ მაი ივნ ივლ აგვ სექ ოქტ ნოე დეკ','იანვარი თებერვალი მარტი აპრილი მაისი ივნისი ივლისი აგვისტო სექტემბერი ოქტომბერი ნოემბერი დეკემბერი','კვი ორშ სამ ოთხ ხუთ პარ შაბ','{d} {M}, {y}','{d} {M}'],};const bcDayTable=(l)=>own(BC_DAYS,l)||own(BC_DAYS,primary(l))||null;function bcParseDay(ymd){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof ymd==='string'?ymd.trim():'');if(!m)return null;const y=+m[1],mo=+m[2],d=+m[3];const t=new Date(Date.UTC(y,mo-1,d));if(t.getUTCFullYear()!==y||t.getUTCMonth()!==mo-1||t.getUTCDate()!==d)return null;return{y,mo,d,wd:t.getUTCDay(),t};}
function bcToday(){const d=new Date();return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());}
function formatDay(ymd,lang,doc,fmt='long'){const p=bcParseDay(ymd);if(!p)return'';const l=typeof lang==='string'&&lang?lang:'en';if(intlSupports('DateTimeFormat',l)){const opt=fmt==='short'?{day:'numeric',month:'short'}:fmt==='full'?{weekday:'short',day:'numeric',month:'long',year:'numeric'}:{day:'numeric',month:'long',year:'numeric'};opt.timeZone='UTC';try{const parts=intl('DateTimeFormat',l,opt).formatToParts(p.t);while(parts.length>1&&parts[parts.length-1].type==='literal'&&parts[parts.length-2].type==='year')parts.pop();while(parts.length&&parts[0].type==='literal')parts.shift();return parts.map((x)=>x.value).join('');}catch(e){}}
const t=bcDayTable(l);if(!t)return p.y+'-'+pad2(p.mo)+'-'+pad2(p.d);const s=(fmt==='short'?t[4]:t[3]).replace('{d}',String(p.d)).replace('{M}',t[fmt==='short'?0:1].split(' ')[p.mo-1]).replace('{y}',String(p.y));return fmt==='full'?t[2].split(' ')[p.wd]+', '+s:s;}
function bcDayParts(p,l){if(intlSupports('DateTimeFormat',l)){try{const parts=intl('DateTimeFormat',l,{day:'numeric',month:'short',timeZone:'UTC'}).formatToParts(p.t);const pick=(k)=>{const x=parts.find((y)=>y.type===k);return x?x.value:'';};const w=intl('DateTimeFormat',l,{weekday:'short',timeZone:'UTC'}).format(p.t);return{d:pick('day')||String(p.d),m:pick('month').replace(/\.$/,''),w};}catch(e){}}
const t=bcDayTable(l)||BC_DAYS.en;return{d:String(p.d),m:t[0].split(' ')[p.mo-1].replace(/\.$/,''),w:t[2].split(' ')[p.wd]};}
const bcHM=(v)=>(typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim())?v.trim():'');function bcTime(hm,l){const v=bcHM(hm);if(!v)return'';const h=+v.slice(0,2),m=+v.slice(3);if(intlSupports('DateTimeFormat',l)){try{return intl('DateTimeFormat',l,{hour:'numeric',minute:'2-digit',timeZone:'UTC'}).format(new Date(Date.UTC(1970,0,1,h,m)));}catch(e){}}
return primary(l)==='en'?((h%12)||12)+':'+pad2(m)+(h<12?' AM':' PM'):v;}
function collectProducts(doc){const out=new Map();if(!isObj(doc)||!isObj(doc.regions))return out;let langs=Array.isArray(doc.langs)?doc.langs.filter((l)=>typeof l==='string'&&l):[];if(!langs.length)langs=[typeof doc.defaultLang==='string'&&doc.defaultLang?doc.defaultLang:'en'];const dl=langs.includes(doc.defaultLang)?doc.defaultLang:langs[0];const today=bcToday();const names=(i18n,extra)=>{const o={};for(const l of langs){const v=[str(pickText(i18n,l,doc)).trim(),extra?extra(l):''].filter(Boolean).join(' · ');if(v)o[l]=v.slice(0,300);}
return o;};const img=(id)=>{const a=typeof id==='string'&&isObj(doc.attachments)?own(doc.attachments,id):null;return isObj(a)&&isImage(a)?id:null;};const add=(raw,e)=>{const sku=bcSku(raw);if(!sku||out.has(sku))return;if(!Object.keys(e.name).length)e.name={[dl]:sku};out.set(sku,e);};const visit=(list,depth)=>{if(!Array.isArray(list)||depth>12)return;for(const b of list){if(!isObj(b)||b.hidden)continue;const items=Array.isArray(b.items)?b.items.filter(isObj):[];if(b.type==='products'){for(const it of items){if(it.stock==='out')continue;add(it.sku,{type:'product',block:b.id,price:bcAmount(it.price),old:bcAmount(it.old),name:names(it.name),unit:names(it.unit),min:bcInt(it.min,1,1,9999),step:bcInt(it.step,1,1,9999),img:img(it.image)});}}else if(b.type==='pricing'){for(const it of items){add(it.sku,{type:'plan',block:b.id,price:bcAmount(it.price),old:null,name:names(it.name),unit:names(it.period),min:1,step:1,img:null});}}else if(b.type==='events'){for(const it of items){if(it.status==='soldout'||it.status==='cancelled')continue;const day=bcParseDay(it.date)?it.date.trim():'';if(day&&day<today)continue;add(it.sku,{type:'ticket',block:b.id,price:bcAmount(it.price),old:null,name:names(it.title,(l)=>[day?formatDay(day,l,doc,'long'):'',str(pickText(it.city,l,doc)).trim()].filter(Boolean).join(', ')),unit:{},min:1,step:1,img:null});}}else if(b.type==='collection'){for(const it of items){add(it.sku,{type:'item',block:b.id,price:bcAmount(it.price),old:bcAmount(it.old),name:names(it.title),unit:names(it.unit),min:1,step:1,img:img(it.cover)});}}
if(Array.isArray(b.blocks))visit(b.blocks,depth+1);if(Array.isArray(b.cols))for(const c of b.cols)if(isObj(c))visit(c.blocks,depth+1);}};const regions=REGIONS;for(const r of regions)visit(doc.regions[r],0);return out;}
const BC_STOCK={in:'inStock',low:'lowStock',out:'outOfStock',pre:'preorder'};const BC_PR_RATIOS=['1/1','4/3','3/4','16/9'];function bcStock(ctx,st){return`<span class="lp-stock lp-stock-${st}">${ui(ctx,BC_STOCK[st])}</span>`;}
function bcMin(ctx,it){const min=bcInt(it.min,1,1,9999);if(min<=1)return'';return`<span class="lp-pr-min">${grp(ctx,(l)=>{const u=str(pickText(it.unit,l,bcPd(ctx))).trim();return escapeHTML(uiText('minOrder',l,ctx.doc,{n:min})+(u?' '+u:''));},false)}</span>`;}
function bcSpecRows(text){const out=[];for(const raw of String(text||'').split(/\r?\n/)){const line=raw.trim();if(!line)continue;const m=/^([^:：]{1,80})[:：]\s*(.*)$/.exec(line);out.push(m?[m[1].trim(),m[2].trim()]:[line,'']);if(out.length>=40)break;}
return out;}
function bcSpecs(ctx,i18n,extra){if(!has(ctx,i18n))return'';return grp(ctx,(l)=>{const rows=bcSpecRows(pickText(i18n,l,bcPd(ctx)));if(!rows.length)return'';return`<dl class="lp-kv lp-pr-specs${extra||''}">`
+rows.map(([k,v])=>`<div><dt>${escapeHTML(k)}</dt><dd>${escapeHTML(v)}</dd></div>`).join('')+'</dl>';},true);}
function bcProductBuy(ctx,b,it,st,sm){const sku=bcSku(it.sku);if(!sku)return'';if(st==='out')return buyHTML(ctx,sku,{out:true,outKey:'outOfStock',sm});return buyHTML(ctx,sku,{qty:!!b.qty,min:it.min,step:it.step,label:b.buy,sm});}
function bcProductCard(ctx,b,it,i,v){const p='items.'+i+'.';const compact=v==='compact';const name=fld(ctx,b,p+'name','plain','h3','lp-pr-name','ph.product');const media=mediaBox(ctx,it.image,{ratio:compact?'1/1':bcRatio(b.ratio,'4/3',BC_PR_RATIOS),fit:'cover',cls:'lp-pr-img',alt:(l)=>plainIn(ctx,it.name,l),path:p+'image',});if(!ctx.edit&&!name&&!media)return'';const st=oneOf(it.stock,['in','low','out','pre'],'in');const badge=fld(ctx,b,p+'badge','plain','span','lp-badge lp-pr-badge','ph.prodBadge',{ecls:'lp-opt'});const desc=compact?'':fld(ctx,b,p+'html','rich','div','lp-pr-desc lp-rich','ph.prodDesc',{ecls:'lp-opt'});const specs=compact?'':bcSpecs(ctx,it.specs);const buy=bcProductBuy(ctx,b,it,st,compact);const chip=st==='out'&&buy?'':bcStock(ctx,st);const price=priceHTML(ctx,it.price,it.old,it.unit,{blk:b,unitPath:p+'unit'});const sku=bcSku(it.sku);const root=!ctx.edit&&sku&&st!=='out'?` data-lp-product="${escapeAttr(sku)}"`:'';const top=media?`<div class="lp-pr-top">${media}${badge}</div>`:'';return`<article class="lp-pr"${di(ctx,i)}${root}>${top}<div class="lp-pr-body">${media?'':badge}${name}${desc}${specs}`
+`<div class="lp-pr-foot"><div class="lp-pr-pb">${price}<div class="lp-pr-meta">${chip}${bcMin(ctx,it)}</div></div>${buy}</div></div></article>`;}
function bcProductRow(ctx,b,it,i,showBuy){const p='items.'+i+'.';const name=fld(ctx,b,p+'name','plain','span','lp-pr-name','ph.product');if(!ctx.edit&&!name)return'';const media=mediaBox(ctx,it.image,{ratio:'1/1',fit:'cover',cls:'lp-pr-thumb',alt:(l)=>plainIn(ctx,it.name,l),path:p+'image'});const st=oneOf(it.stock,['in','low','out','pre'],'in');const badge=fld(ctx,b,p+'badge','plain','span','lp-badge lp-pr-badge','ph.prodBadge',{ecls:'lp-opt'});const buy=showBuy?bcProductBuy(ctx,b,it,st,true):'';const chip=st==='out'&&buy?'':bcStock(ctx,st);const sku=bcSku(it.sku);const root=!ctx.edit&&sku&&st!=='out'?` data-lp-product="${escapeAttr(sku)}"`:'';return`<tr class="lp-pr-row"${di(ctx,i)}${root}><td class="lp-pr-tc-n"><div class="lp-pr-c">${media}<div class="lp-pr-ci">`
+`<div class="lp-pr-nl">${name}${badge}</div>${bcSpecs(ctx,it.specs,' lp-pr-specs-in')}<div class="lp-pr-meta">${chip}${bcMin(ctx,it)}</div>`
+`</div></div></td><td class="lp-pr-tc-p">${priceHTML(ctx,it.price,it.old,it.unit,{blk:b,unitPath:p+'unit'})}</td>`
+`${showBuy?`<td class="lp-pr-tc-b">${buy}</td>`:''}</tr>`;}
function bcProducts(b,ctx){if(noItems(ctx,b))return addItemBox(ctx);const v=oneOf(b.variant,['cards','list','compact','table'],'cards');bcVar(ctx,'products','variant',v);const items=Array.isArray(b.items)?b.items:[];let s='';if(v==='table'){const showBuy=ctx.edit||items.some((it)=>isObj(it)&&bcSku(it.sku));for(let i=0;i<items.length;i++)if(isObj(items[i]))s+=bcProductRow(ctx,b,items[i],i,showBuy);if(!s)return'';const head=`<thead><tr><th scope="col">${ui(ctx,'colProduct')}</th><th scope="col" class="lp-pr-tc-p">${ui(ctx,'colPrice')}</th>`
+`${showBuy?`<th scope="col" class="lp-pr-tc-b"><span class="lp-sr">${ui(ctx,'colOrder')}</span></th>`:''}</tr></thead>`;return`<div class="lp-prs lp-prs-table"><table class="lp-pr-tbl">${head}<tbody>${s}</tbody></table></div>`;}
for(let i=0;i<items.length;i++)if(isObj(items[i]))s+=bcProductCard(ctx,b,items[i],i,v);if(!s)return'';if(v==='list')return`<div class="lp-prs lp-prs-list"><div class="lp-prs-items">${s}</div></div>`;return`<div class="lp-prs lp-prs-${v}"><div class="lp-grid" style="--lp-cols:${oneOf(b.columns,[2,3,4],3)}">${s}</div></div>`;}
function bcPlanLink(ctx,b,it,p,kind){if(ctx.edit)return`<span class="lp-btn lp-btn-${kind}">${fld(ctx,b,p+'label','plain','span','lp-buy-t','ph.planBtn')}</span>`;if(!has(ctx,it.label))return'';const h=bcHref(ctx,it.href);return h?`<a class="lp-btn lp-btn-${kind}"${h}>${txt(ctx,it.label)}</a>`:'';}
function bcPlan(ctx,b,it,i){const p='items.'+i+'.';const name=fld(ctx,b,p+'name','plain','h3','lp-plan-name','ph.plan');const body=fld(ctx,b,p+'html','rich','div','lp-plan-body lp-rich','ph.planBody',{ecls:'lp-opt'});const price=bcAmount(it.price);if(!ctx.edit&&!name&&!body&&price==null)return'';const feat=!!it.featured;const kind=feat?'primary':'secondary';const sku=bcSku(it.sku);const cta=sku?buyHTML(ctx,sku,{label:it.label,kind,blk:b,path:p+'label'}):bcPlanLink(ctx,b,it,p,kind);const root=!ctx.edit&&sku?` data-lp-product="${escapeAttr(sku)}"`:'';return`<article class="lp-plan${feat?' lp-plan-feat':''}"${di(ctx,i)}${root}>`
+`${feat?`<span class="lp-plan-rib">${ui(ctx,'popular')}</span>`:''}<div class="lp-plan-head">${name}`
+`${priceHTML(ctx,price,null,it.period,{blk:b,unitPath:p+'period',cls:'lp-plan-price'})}</div>`
+`${body}${cta?`<div class="lp-plan-cta">${cta}</div>`:''}</article>`;}
function bcPricing(b,ctx){if(noItems(ctx,b))return addItemBox(ctx);const items=Array.isArray(b.items)?b.items:[];let s='';for(let i=0;i<items.length;i++)if(isObj(items[i]))s+=bcPlan(ctx,b,items[i],i);if(!s)return'';return`<div class="lp-plans"><div class="lp-grid" style="--lp-cols:${oneOf(b.columns,[2,3,4],3)}">${s}</div></div>`;}
function bcChip(ctx,kind,key){return`<span class="lp-chip lp-ev-st lp-ev-st-${kind}">${ui(ctx,key)}</span>`;}
function bcEvTile(ctx,day,tm){const P=bcParseDay(day);if(!P)return ctx.edit?'<span class="lp-ev-date lp-ev-nod" aria-hidden="true">—</span>':'';const vis=grp(ctx,(l)=>{const q=bcDayParts(P,l);return`<span class="lp-ev-d">${escapeHTML(q.d)}</span><span class="lp-ev-m">${escapeHTML(q.m)}</span><span class="lp-ev-w">${escapeHTML(q.w)}</span>`;},false);const full=grp(ctx,(l)=>escapeHTML(formatDay(day,l,ctx.doc,'full')+(tm?', '+bcTime(tm,l):'')),false);return`<time class="lp-ev-date" datetime="${escapeAttr(day+(tm?'T'+tm:''))}"><span class="lp-ev-dv" aria-hidden="true">${vis}</span>`
+`<span class="lp-sr">${full}</span></time>`;}
function bcEvent(ctx,b,it,i,o){const p='items.'+i+'.';const st=oneOf(it.status,['on','few','soldout','cancelled'],'on');const{day,past}=o;const tm=bcHM(it.time);const sku=bcSku(it.sku);const live=!past&&st!=='cancelled';let title;if(ctx.edit){title=fld(ctx,b,p+'title','plain','h3','lp-ev-title','ph.event');}else{if(!has(ctx,it.title))return'';const h=sku&&live&&st!=='soldout'?bcHref(ctx,it.href):'';title=`<h3 class="lp-ev-title">${h?`<a${h}>${txt(ctx,it.title)}</a>`:txt(ctx,it.title)}</h3>`;}
const venue=fld(ctx,b,p+'venue','plain','span','lp-ev-venue','ph.evVenue',{ecls:'lp-opt'});const city=fld(ctx,b,p+'city','plain','span','lp-ev-city','ph.evCity',{ecls:'lp-opt'});const place=venue||city?`<span class="lp-ev-place">${icon(ctx,'location')}<span>${venue}${venue&&city?'<span class="lp-ev-sep">, </span>':''}${city}</span></span>`:'';const when=tm?`<span class="lp-ev-time">${icon(ctx,'clock')}<span>${grp(ctx,(l)=>escapeHTML(bcTime(tm,l)),false)}</span></span>`:'';const meta=when||place?`<p class="lp-ev-meta">${when}${place}</p>`:'';let chip='';if(past)chip=bcChip(ctx,'past','pastEvent');else if(st==='cancelled')chip=bcChip(ctx,'cx','cancelled');else if(st==='few')chip=bcChip(ctx,'few','fewLeft');else if(st==='soldout'&&!sku&&!str(it.href).trim())chip=bcChip(ctx,'out','soldOut');const amount=bcAmount(it.price);const price=live&&amount!=null?priceHTML(ctx,amount,null,null,{from:true,cls:'lp-ev-price'}):'';let act='';let buys=false;if(live){if(st==='soldout'){if(sku||str(it.href).trim())act=bcOffBtn(ctx,'soldOut',true);}else if(sku){act=buyHTML(ctx,sku,{labelKey:'buyTicket',label:b.buy,icon:'ticket',sm:true});buys=!ctx.edit;}else if(ctx.edit){if(str(it.href).trim())act=`<span class="lp-btn lp-btn-secondary lp-btn-sm">${icon(ctx,'ticket')}<span>${has(ctx,b.linkLabel)?txt(ctx,b.linkLabel):ui(ctx,'tickets')}</span></span>`;}else{const h=bcHref(ctx,it.href);if(h)act=`<a class="lp-btn lp-btn-secondary lp-btn-sm"${h}>${icon(ctx,'ticket')}<span>${has(ctx,b.linkLabel)?txt(ctx,b.linkLabel):ui(ctx,'tickets')}</span></a>`;}}
const side=chip||price||act?`<div class="lp-ev-side">${chip}${price}${act}</div>`:'';const cls='lp-ev'+(st==='cancelled'?' lp-ev-cx':'')+(past?' lp-ev-past':'');const attrs=di(ctx,i)+(!ctx.edit&&o.hide&&day?` data-lp-date="${day}"`:'')
+(buys?` data-lp-product="${escapeAttr(sku)}"`:'');return`<article class="${cls}"${attrs}>${bcEvTile(ctx,day,tm)}<div class="lp-ev-main">${title}${meta}</div>${side}</article>`;}
function bcEvents(b,ctx){if(noItems(ctx,b))return addItemBox(ctx);const v=oneOf(b.variant,['list','cards'],'list');bcVar(ctx,'events','variant',v);const hide=!!b.hidePast;const today=bcToday();const items=Array.isArray(b.items)?b.items:[];let s='';let dated=0;for(let i=0;i<items.length;i++){const it=items[i];if(!isObj(it))continue;const day=bcParseDay(it.date)?it.date.trim():'';const past=!!day&&day<today;if(!ctx.edit&&hide&&past)continue;const h=bcEvent(ctx,b,it,i,{day,past,hide});if(!h)continue;s+=h;if(day)dated++;}
const none=`<p class="lp-ev-none${s?'':' lp-ev-none-on'}">${ui(ctx,'noEvents')}</p>`;if(!s)return!ctx.edit&&hide&&items.some(isObj)?`<div class="lp-evs lp-evs-${v}">${none}</div>`:'';if(!ctx.edit&&hide&&dated)feature(ctx,'events');const list=v==='cards'?`<div class="lp-grid" style="--lp-cols:${oneOf(b.columns,[2,3,4],3)}">${s}</div>`:`<div class="lp-evs-rows">${s}</div>`;return`<div class="lp-evs lp-evs-${v}">${list}${!ctx.edit&&hide&&dated?none:''}</div>`;}
function bcFieldsLook(ctx,fields){let s='';for(const f of fields.slice(0,40)){if(!isObj(f))continue;const label=str(pickText(f.label,ctx.lang,ctx.doc)).trim()||str(f.key);const req=f.required?'<span class="lp-cartb-req" aria-hidden="true"> *</span>':'';if(f.type==='checkbox'){s+=`<div class="lp-field"><span class="lp-check lp-cartb-fk"><span class="lp-cartb-box1"></span><span>${escapeHTML(label)}${req}</span></span></div>`;continue;}
s+=`<div class="lp-field${f.half?' lp-field-half':''}"><span class="lp-label">${escapeHTML(label)}${req}</span>`
+`<span class="lp-input lp-cartb-fake${f.type==='textarea'?' lp-cartb-fake-ta':''}"></span></div>`;}
return s;}
function bcCart(b,ctx){const quote=bcQuote(ctx.doc);const k=(a,q)=>(quote?q:a);const co=ctx.doc.shop&&isObj(ctx.doc.shop.checkout)?ctx.doc.shop.checkout:{};const canCo=(co.method||'request')!=='none';const form=!!b.form&&canCo;const fields=Array.isArray(co.fields)?co.fields:[];const title=fld(ctx,b,'title','plain','h2','lp-cartb-h lp-h lp-h3','ph.cartTitle',{ecls:'lp-opt'});const text=fld(ctx,b,'text','rich','div','lp-cartb-text lp-rich','ph.cartText',{ecls:'lp-opt'});const note=has(ctx,co.note)?`<p class="lp-cartb-note">${txt(ctx,co.note)}</p>`:'';const one=form?'':' lp-cartb-one';if(ctx.edit){const go=!form&&canCo?`<div class="lp-cartb-actions"><span class="lp-btn lp-btn-primary">${ui(ctx,k('cb.checkout','cb.checkoutQuote'))}</span></div>`:'';const box=`<div class="lp-cartb-box"><div class="lp-cartb-demo">${icon(ctx,quote?'plus':'cart')}`
+`<span>${escapeHTML(uiText('cb.edit',ctx.uiLang,ctx.doc))}</span></div>`
+`<div class="lp-cartb-sum"><span>${ui(ctx,'cb.total')}</span><strong>—</strong></div>${go}</div>`;const area=form?`<div class="lp-cartb-co">${note}<div class="lp-form">${bcFieldsLook(ctx,fields)}</div>`
+`<p class="lp-cartb-hint">${escapeHTML(uiText('cb.fields',ctx.uiLang,ctx.doc))}</p>`
+`<div class="lp-cartb-actions"><span class="lp-btn lp-btn-primary lp-btn-lg">${ui(ctx,k('cb.send','cb.sendQuote'))}</span></div></div>`:'';return`<div class="lp-cartb">${title}${text}<div class="lp-cartb-grid${one}">${box}${area}</div></div>`;}
feature(ctx,'cart');if(ctx.use)ctx.use.shop=true;const go=!form&&canCo?`<div class="lp-cartb-actions"><button type="button" class="lp-btn lp-btn-primary" data-lp-cart-open aria-haspopup="dialog" aria-controls="lp-cart">`
+`${ui(ctx,k('cb.checkout','cb.checkoutQuote'))}</button></div>`:'';const box=`<div class="lp-cartb-box">`
+`<p class="lp-cartb-empty" data-lp-cart-empty>${icon(ctx,quote?'plus':'cart')}<span>${ui(ctx,k('cb.empty','cb.emptyQuote'))}</span></p>`
+`<ul class="lp-cartb-list" data-lp-cart-list></ul>`
+`<div class="lp-cartb-sum"><span>${ui(ctx,'cb.total')}</span><strong data-lp-cart-total></strong></div>`
+`<div class="lp-cartb-bar"><p class="lp-cartb-status" data-lp-cart-status data-state="local"></p>`
+`<button type="button" class="lp-btn lp-btn-ghost lp-btn-sm" data-lp-cart-clear>${ui(ctx,k('cb.clear','cb.clearQuote'))}</button></div>`
+`${go}</div>`;let area='';if(form){const scope='co'+str(b.id).replace(/[^A-Za-z0-9]/g,'');const inner=formFieldsHTML(ctx,fields,{scope});const okText=has(ctx,co.success)?`<div class="lp-co-ok" data-lp-co-ok hidden>${txt(ctx,co.success)}</div>`:'';area=`<div class="lp-cartb-co" data-lp-checkout-area>${note}<form class="lp-form" data-lp-checkout novalidate>${inner}`
+`<div class="lp-cartb-actions"><button type="submit" class="lp-btn lp-btn-primary lp-btn-lg">${ui(ctx,k('cb.send','cb.sendQuote'))}</button></div>`
+`</form><div class="lp-form-result" data-lp-co-result></div>${okText}</div>`;}
return`<div class="lp-cartb" data-lp-cart-view>${title}${text}<div class="lp-cartb-grid${one} lp-js-only">${box}${area}</div>`
+`<p class="lp-cartb-nojs">${ui(ctx,'cb.nojs')}</p></div>`;}
function bcImage(b,ctx){const a=attOf(ctx,b.att);const shape=oneOf(b.shape,['rect','rounded','circle'],'rect');const ratio=shape==='circle'?'1/1':bcRatio(b.ratio,'auto');const link=!ctx.edit&&str(b.link).trim()?bcHref(ctx,b.link):'';const zoom=!!b.zoom&&!str(b.link).trim();let m=mediaBox(ctx,b.att,{ratio,fit:oneOf(b.fit,['cover','contain'],'cover'),cls:'lp-fig-media',round:shape==='circle',path:'att',zoom:zoom&&!ctx.edit,alt:(l)=>plainIn(ctx,b.caption,l)||(a?plainIn(ctx,a.title,l)||str(a.name):''),});if(!m)return'';if(zoom&&!ctx.edit){m=bcZoom(ctx,m,b.id);feature(ctx,'lightbox');}
if(link)m=`<a class="lp-fig-a"${link}>${m}</a>`;const anchor=!ctx.edit&&a&&ctx.attAnchor instanceof Map&&ctx.attAnchor.get(a.id)===b.id?` id="att-${escapeAttr(a.id)}"`:'';const cap=fld(ctx,b,'caption','plain','figcaption','lp-fig-cap','ph.imgCaption',{ecls:'lp-opt'});return`<figure class="lp-fig lp-fig-${oneOf(b.align,['left','center','right'],'center')} lp-fig-${shape}"`
+` style="--lp-fw:${bcInt(b.width,100,10,100)}%"${anchor}>${m}${cap}</figure>`;}
function bcGallery(b,ctx){if(noItems(ctx,b))return addItemBox(ctx);const v=oneOf(b.variant,['grid','masonry','slider','mosaic'],'grid');bcVar(ctx,'gallery','variant',v);const ratio=v==='masonry'?'auto':v==='mosaic'?'1/1':bcRatio(b.ratio,'4/3',BC_RATIOS.slice(1));const zoom=!!b.zoom&&!ctx.edit;const items=Array.isArray(b.items)?b.items:[];let s='';let n=0;for(let i=0;i<items.length;i++){const it=items[i];if(!isObj(it))continue;const a=attOf(ctx,it.att);let m=mediaBox(ctx,it.att,{ratio,fit:'cover',cls:'lp-gal-media',zoom,path:'items.'+i+'.att',alt:(l)=>plainIn(ctx,it.caption,l)||(a?plainIn(ctx,a.title,l):''),});if(!m)continue;if(zoom)m=bcZoom(ctx,m,b.id);const cap=fld(ctx,b,'items.'+i+'.caption','plain','figcaption','lp-gal-cap','ph.galCaption',{ecls:'lp-opt'});s+=`<figure class="lp-gal-it"${di(ctx,i)}>${m}${cap}</figure>`;n++;}
if(!s)return'';if(zoom)feature(ctx,'lightbox');const st=`--lp-cols:${oneOf(b.columns,[2,3,4,5],3)};--lp-ggap:${bcInt(b.gap,12,0,64)}px`;if(v==='slider'){const tid='trk-'+str(b.id).replace(/[^A-Za-z0-9-]/g,'');let nav='';if(!ctx.edit&&n>1){feature(ctx,'slider');const btn=(dir,ic,key)=>`<button type="button" class="lp-gal-nav lp-gal-${dir} lp-js-only" data-lp-slide="${dir}" aria-controls="${tid}">`
+`${icon(ctx,ic)}<span class="lp-sr">${ui(ctx,key)}</span></button>`;nav=btn('prev','chevron-left','gal.prev')+btn('next','chevron-right','gal.next');}
const lab=ctx.edit?'':`<span class="lp-sr" id="${tid}-l">${ui(ctx,'gal.label')}</span>`;return`<div class="lp-gal lp-gal-slider" style="${st}">${lab}<div class="lp-gal-track" id="${tid}" data-lp-track`
+`${ctx.edit?'':` tabindex="0" role="region" aria-labelledby="${tid}-l"`}>${s}</div>${nav}</div>`;}
return`<div class="lp-gal lp-gal-${v}" style="${st}"><div class="lp-gal-list${v==='grid'?' lp-grid':''}">${s}</div></div>`;}
function bcEmbed(b,ctx){const a=attOf(ctx,b.att);if(!a)return ctx.edit?bcPh(ctx,'att','paperclip','lp-emb-ph'):'';const card=b.display==='card';const mt=mimeBase(a.mime);const av=/^(audio|video)\//.test(mt);const player=b.player==='native'&&av?'native':'object';const title=plainOf(ctx,b.caption)||plainOf(ctx,a.title)||str(a.name);let prev='';if(!card){if(isImage(a)){prev=mediaBox(ctx,a.id,{ratio:'auto',fit:'contain',cls:'lp-emb-img',zoom:!ctx.edit,path:'att',alt:(l)=>plainIn(ctx,b.caption,l)||plainIn(ctx,a.title,l)||str(a.name)});if(prev&&!ctx.edit){prev=bcZoom(ctx,prev,b.id);feature(ctx,'lightbox');}}else{prev=objectHTML(ctx,a,{height:bcInt(b.height,520,120,1200),ratio:oneOf(b.ratio,['auto','16/9','4/3'],'auto'),player,title});if(player==='native')bcNeedAtt(ctx,a,'media');else if(previewKind(a.mime))bcNeedAtt(ctx,a,'embed');}}
if(b.dl||b.op)bcNeedAtt(ctx,a,'embed');const head=attCardHTML(ctx,a,{blk:b,dl:!!b.dl,op:!!b.op,desc:true});const anchor=!ctx.edit&&ctx.attAnchor instanceof Map&&ctx.attAnchor.get(a.id)===b.id?` id="att-${escapeAttr(a.id)}"`:'';const kind=av?(mt.startsWith('video/')?' lp-emb-video':' lp-emb-audio'):'';return`<div class="lp-att lp-emb${card?' lp-att-card lp-emb-card':''}${kind}"${anchor}>${head}`
+`${prev?`<div class="lp-att-prev lp-emb-prev">${prev}</div>`:''}</div>`;}
function bcQrInk(ctx){const m=/^#([0-9a-f]{6})$/i.exec(str(ctx.doc.theme&&ctx.doc.theme.text));if(!m)return'#000000';const n=parseInt(m[1],16);const lum=(0.299*(n>>16)+0.587*((n>>8)&255)+0.114*(n&255))/255;return lum<0.35?'#'+m[1]:'#000000';}
function bcQR(b,ctx){const raw=str(b.url).trim();const url=raw?normURL(raw):'';const size=bcInt(b.size,160,64,480);const al=oneOf(b.align,['left','center','right'],'left');const cap=fld(ctx,b,'label','plain','figcaption','lp-qr-l','ph.qrLabel',{ecls:'lp-opt'});const ph=()=>`<figure class="lp-qr lp-qr-${al}"><span class="lp-qr-code lp-qr-ph" style="width:${size}px">${icon(ctx,'qr')}</span>${cap}</figure>`;if(!url||url[0]==='#')return ctx.edit?ph():'';let svg='';try{svg=qrSVG(url,{ec:oneOf(b.ec,['L','M','Q','H'],'M'),fg:bcQrInk(ctx)});}catch(e){svg='';}
if(!svg)return ctx.edit?ph():'';const sr=`<span class="lp-sr">${ctx.edit?escapeHTML(uiText('qrScan',ctx.uiLang,ctx.doc)):ui(ctx,'qrScan')}: ${escapeHTML(url)}</span>`;let code=`<span class="lp-qr-code" style="width:${size}px">${svg}${sr}</span>`;if(!ctx.edit){const h=hrefAttr(ctx,url);if(h)code=`<a class="lp-qr-a"${h}>${code}</a>`;}
return`<figure class="lp-qr lp-qr-${al}">${code}${cap}</figure>`;}
const BC_STOCK_OPTS=[{v:'in',l:'o.stIn'},{v:'low',l:'o.stLow'},{v:'out',l:'o.stOut'},{v:'pre',l:'o.stPre'}];const BC_EV_OPTS=[{v:'on',l:'o.evOn'},{v:'few',l:'o.evFew'},{v:'soldout',l:'o.evSoldout'},{v:'cancelled',l:'o.evCancelled'}];const BC_PRICE_F={type:'number',nullable:true,min:0,max:999999999,step:0.01};const BT_C={products:{category:'commerce',icon:'bag',container:false,variants:['variant'],i18nFields:['buy'],itemI18nFields:['name','html','unit','badge','specs'],itemRichFields:{html:'rich'},itemLabel:'name',defaults:()=>({variant:'cards',columns:3,ratio:'4/3',qty:false,buy:{},items:[]}),schema:[{key:'variant',type:'select',label:'f.variant',options:optList('cards','list','compact','table')},{key:'columns',type:'select',label:'f.columns',options:numOpts(2,3,4),when:{variant:['cards','compact']}},{key:'ratio',type:'select',label:'f.imgRatio',options:bcRatioOpts('1/1','4/3','3/4','16/9'),when:{variant:['cards','list']}},{key:'qty',type:'checkbox',label:'f.qty'},{key:'buy',type:'i18n',label:'f.buyLabel',hint:'hint.c.buy'},],itemSchema:[{key:'sku',type:'text',label:'f.sku',hint:'hint.c.sku'},{key:'name',type:'i18n',label:'f.name'},{key:'price',label:'f.price',...BC_PRICE_F},{key:'old',label:'f.old',...BC_PRICE_F},{key:'unit',type:'i18n',label:'f.unit',hint:'hint.c.unit'},{key:'image',type:'att',label:'f.image',accept:'image/'},{key:'badge',type:'i18n',label:'f.badge'},{key:'stock',type:'select',label:'f.stock',options:BC_STOCK_OPTS},{key:'min',type:'number',label:'f.min',min:1,max:9999,step:1},{key:'step',type:'number',label:'f.step',min:1,max:9999,step:1},{key:'specs',type:'i18n',label:'f.specs',multiline:true,rows:4,hint:'hint.c.specs'},{key:'html',type:'i18n',label:'f.html'},],itemDefaults:()=>({id:uid(),sku:'',name:{},html:{},price:null,old:null,unit:{},image:null,badge:{},specs:{},min:1,step:1,stock:'in'}),render:bcProducts,},pricing:{category:'commerce',icon:'tag',container:false,variants:[],i18nFields:[],itemI18nFields:['name','period','html','label'],itemRichFields:{html:'rich'},itemLabel:'name',defaults:()=>({columns:3,items:[]}),schema:[{key:'columns',type:'select',label:'f.columns',options:numOpts(2,3,4)},],itemSchema:[{key:'name',type:'i18n',label:'f.name'},{key:'price',label:'f.price',...BC_PRICE_F},{key:'period',type:'i18n',label:'f.period',hint:'hint.c.period'},{key:'featured',type:'checkbox',label:'f.featured'},{key:'label',type:'i18n',label:'f.btnLabel'},{key:'href',type:'text',label:'f.btnHref',suggest:'anchors'},{key:'sku',type:'text',label:'f.sku',hint:'hint.c.planSku'},{key:'html',type:'i18n',label:'f.planBody'},],itemDefaults:()=>({id:uid(),name:{},price:null,period:{},html:{},featured:false,label:{},href:'',sku:''}),render:bcPricing,},events:{category:'commerce',icon:'calendar',container:false,variants:['variant'],i18nFields:['buy','linkLabel'],itemI18nFields:['title','city','venue'],itemLabel:'title',defaults:()=>({variant:'list',columns:3,hidePast:false,buy:{},linkLabel:{},items:[]}),schema:[{key:'variant',type:'select',label:'f.variant',options:optList('list','cards')},{key:'columns',type:'select',label:'f.columns',options:numOpts(2,3,4),when:{variant:'cards'}},{key:'hidePast',type:'checkbox',label:'f.hidePast',hint:'hint.c.hidePast'},{key:'buy',type:'i18n',label:'f.buyLabel'},{key:'linkLabel',type:'i18n',label:'f.linkLabel'},],itemSchema:[{key:'date',type:'day',label:'f.date'},{key:'time',type:'time',label:'f.time'},{key:'title',type:'i18n',label:'f.title'},{key:'venue',type:'i18n',label:'f.venue'},{key:'city',type:'i18n',label:'f.city'},{key:'status',type:'select',label:'f.status',options:BC_EV_OPTS},{key:'price',label:'f.ticketPrice',...BC_PRICE_F},{key:'sku',type:'text',label:'f.ticketSku',hint:'hint.c.ticketSku'},{key:'href',type:'text',label:'f.ticketHref',suggest:'anchors'},],itemDefaults:()=>({id:uid(),date:'',time:'',title:{},city:{},venue:{},href:'',price:null,sku:'',status:'on'}),render:bcEvents,},cart:{category:'commerce',icon:'cart',container:false,variants:[],i18nFields:['title','text'],richFields:{text:'rich'},defaults:()=>({title:{},text:{},form:true}),schema:[{key:'title',type:'i18n',label:'f.title'},{key:'form',type:'checkbox',label:'f.coForm',hint:'hint.c.coForm'},],render:bcCart,},image:{category:'media',icon:'image',container:false,variants:[],i18nFields:['caption'],defaults:()=>({att:null,width:100,align:'center',shape:'rect',ratio:'auto',fit:'cover',zoom:false,caption:{},link:''}),schema:[{key:'att',type:'att',label:'f.image',accept:'image/'},{key:'width',type:'range',label:'f.width',min:10,max:100,step:1,unit:'%'},{key:'align',type:'select',label:'f.align',options:ALIGN3},{key:'shape',type:'select',label:'f.shape',options:optList('rect','rounded','circle')},{key:'ratio',type:'select',label:'f.ratio',options:bcRatioOpts('auto','16/9','4/3','1/1','3/4'),when:{shape:['rect','rounded']}},{key:'fit',type:'select',label:'f.fit',options:[{v:'cover',l:'o.fitCover'},{v:'contain',l:'o.fitContain'}],when:{ratio:['16/9','4/3','1/1','3/4']}},{key:'zoom',type:'checkbox',label:'f.zoom',hint:'hint.c.zoomImg'},{key:'link',type:'text',label:'f.link',suggest:'anchors'},],render:bcImage,},gallery:{category:'media',icon:'images',container:false,variants:['variant'],i18nFields:[],itemI18nFields:['caption'],itemLabel:'caption',defaults:()=>({variant:'grid',columns:3,ratio:'4/3',zoom:true,gap:12,items:[]}),schema:[{key:'variant',type:'select',label:'f.variant',options:optList('grid','masonry','slider','mosaic')},{key:'columns',type:'select',label:'f.columns',options:numOpts(2,3,4,5)},{key:'ratio',type:'select',label:'f.ratio',options:bcRatioOpts('16/9','4/3','1/1','3/4'),when:{variant:['grid','slider']}},{key:'gap',type:'range',label:'f.gap',min:0,max:64,step:1,unit:'px'},{key:'zoom',type:'checkbox',label:'f.zoom'},],itemSchema:[{key:'att',type:'att',label:'f.image',accept:'image/'},{key:'caption',type:'i18n',label:'f.caption'},],itemDefaults:()=>({id:uid(),att:null,caption:{}}),render:bcGallery,},embed:{category:'media',icon:'paperclip',container:false,variants:[],i18nFields:['caption'],defaults:()=>({att:null,display:'embed',player:'object',height:520,ratio:'auto',caption:{},dl:true,op:true}),schema:[{key:'att',type:'att',label:'f.att',accept:''},{key:'display',type:'select',label:'f.display',options:optList('embed','card')},{key:'player',type:'select',label:'f.player',options:[{v:'object',l:'o.plObject'},{v:'native',l:'o.plNative'}],when:{display:'embed'},hint:'hint.c.player'},{key:'height',type:'number',label:'f.height',min:120,max:1200,step:1,unit:'px',when:{display:'embed'}},{key:'ratio',type:'select',label:'f.ratio',options:bcRatioOpts('auto','16/9','4/3'),when:{display:'embed'},hint:'hint.c.ratioVideo'},{key:'caption',type:'i18n',label:'f.caption'},{key:'dl',type:'checkbox',label:'f.dl'},{key:'op',type:'checkbox',label:'f.op'},],render:bcEmbed,},qr:{category:'media',icon:'qr',container:false,variants:[],i18nFields:['label'],defaults:()=>({url:'',size:160,label:{},ec:'M',align:'left'}),schema:[{key:'url',type:'text',label:'f.url'},{key:'size',type:'number',label:'f.size',min:64,max:480,step:1,unit:'px'},{key:'ec',type:'select',label:'f.ec',options:optList('L','M','Q','H')},{key:'align',type:'select',label:'f.align',options:ALIGN3},],render:bcQR,},};const BC_CSS_BUY=`
.lp-buy{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.lp-buy .lp-btn{white-space:nowrap}
.lp-buy .lp-btn .lp-ic{flex:none}
.lp-buy-off{opacity:.62;cursor:default;pointer-events:none;box-shadow:none}
.lp-qty-look{display:inline-flex;align-items:center;height:2.5em;border:1px solid var(--lp-border);border-radius:var(--lp-radius-s);overflow:hidden;font-variant-numeric:tabular-nums}
.lp-qty-look>span{display:inline-flex;align-items:center;justify-content:center;min-width:2.3em;height:100%;color:var(--lp-muted)}
.lp-qty-look>span+span{border-inline-start:1px solid var(--lp-border)}
`;const CSS_BLOCKS_C={products:BC_CSS_BUY+`
.lp-prs{min-width:0}
.lp-pr{position:relative;display:flex;flex-direction:column;min-width:0;background:var(--lp-surface);color:var(--lp-text);border:1px solid var(--lp-border);border-radius:var(--lp-radius);overflow:hidden;container:lp-pr/inline-size;transition:transform .3s var(--lp-ease),box-shadow .3s var(--lp-ease),border-color .3s var(--lp-ease)}
.lp-pr:hover{transform:translateY(-4px);box-shadow:var(--lp-shadow-lg);border-color:color-mix(in srgb,var(--lp-accent) 26%,var(--lp-border))}
.lp-pr:focus-within{border-color:color-mix(in srgb,var(--lp-accent) 45%,var(--lp-border))}
.lp-pr-top{position:relative;overflow:hidden}
.lp-pr-top .lp-media{border-radius:0}
.lp-pr-top .lp-media img{transition:transform .7s var(--lp-ease)}
.lp-pr:hover .lp-pr-top .lp-media img{transform:scale(1.045)}
.lp-pr-top>.lp-pr-badge{position:absolute;top:12px;inset-inline-start:12px;z-index:1;box-shadow:var(--lp-shadow)}
.lp-pr-body{display:flex;flex-direction:column;gap:10px;flex:1;min-width:0;padding:18px 20px 20px}
.lp-pr-body>.lp-pr-badge{align-self:flex-start}
.lp-pr-name{margin:0;font-family:var(--lp-font-h);font-size:1.12em;font-weight:650;line-height:1.25;overflow-wrap:anywhere;hyphens:auto}
.lp-pr-desc{color:var(--lp-muted);font-size:.94em;overflow-wrap:anywhere}
.lp-pr-desc>:first-child{margin-top:0}
.lp-pr-desc>:last-child{margin-bottom:0}
.lp-pr-specs{display:block;margin:0;font-size:.86em}
.lp-pr-specs>div{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px dashed var(--lp-border)}
.lp-pr-specs>div:last-child{border-bottom:0}
.lp-kv.lp-pr-specs :is(dt,dd){padding:0;border-bottom:0}
.lp-pr-specs dt{margin:0;color:var(--lp-muted);font-weight:400}
.lp-pr-specs dd{margin:0;font-weight:550;text-align:end;overflow-wrap:anywhere}
.lp-pr-foot{margin-top:auto;padding-top:6px;display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px}
.lp-pr-pb{display:flex;flex-direction:column;gap:6px;min-width:0}
.lp-pr .lp-price-now{font-size:1.3em}
.lp-pr-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px}
.lp-pr-meta:empty{display:none}
.lp-pr-min{font-size:.8em;color:var(--lp-muted)}
.lp-stock{display:inline-flex;align-items:center;gap:6px;font-size:.8em;font-weight:550;line-height:1.2;color:var(--lp-muted)}
.lp-stock::before{content:"";flex:none;width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px color-mix(in srgb,currentColor 18%,transparent)}
.lp-stock-in{color:color-mix(in srgb,#15803d 72%,var(--lp-text))}
.lp-stock-low{color:color-mix(in srgb,#b45309 78%,var(--lp-text))}
.lp-stock-out{color:color-mix(in srgb,#b91c1c 70%,var(--lp-text))}
.lp-stock-pre{color:var(--lp-accent)}
@container lp-pr (max-width:300px){.lp-pr-foot{flex-direction:column;align-items:stretch}.lp-pr-foot .lp-buy .lp-btn{flex:1 1 auto;justify-content:center}}
@media (prefers-reduced-motion:reduce){.lp-pr,.lp-pr-top .lp-media img{transition:none}.lp-pr:hover,.lp-pr:hover .lp-pr-top .lp-media img{transform:none}}
.lp-root[data-mode=edit] .lp-pr:hover,.lp-root[data-mode=edit] .lp-pr:hover .lp-pr-top .lp-media img{transform:none}
.lp-root[data-mode=edit] .lp-pr-top>.lp-pr-badge:empty{box-shadow:none}
`,pricing:BC_CSS_BUY+`
.lp-plans .lp-grid{align-items:stretch;padding-top:14px}
.lp-plan{position:relative;display:flex;flex-direction:column;gap:20px;min-width:0;padding:34px 28px 28px;background:var(--lp-surface);color:var(--lp-text);border:1px solid var(--lp-border);border-radius:var(--lp-radius);transition:transform .3s var(--lp-ease),box-shadow .3s var(--lp-ease)}
.lp-plan:hover{transform:translateY(-3px);box-shadow:var(--lp-shadow-lg)}
.lp-plan-feat{border:2px solid var(--lp-accent);box-shadow:var(--lp-shadow-lg);background:linear-gradient(180deg,var(--lp-tint),var(--lp-surface) 46%)}
.lp-plan-rib{position:absolute;top:0;left:50%;transform:translate(-50%,-50%);max-width:calc(100% - 24px);padding:5px 14px;border-radius:999px;background:var(--lp-accent);color:var(--lp-on-accent);font-size:.74em;font-weight:650;letter-spacing:.07em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:var(--lp-shadow)}
.lp-plan-rib:lang(ka),.lp-plan-rib :lang(ka){text-transform:none;letter-spacing:.02em}
.lp-plan-head{display:flex;flex-direction:column;gap:12px}
.lp-plan-name{margin:0;font-family:var(--lp-font-h);font-size:1.16em;font-weight:650;line-height:1.25;overflow-wrap:anywhere}
.lp-plan-feat .lp-plan-name{color:var(--lp-link)}
.lp-plan-price{flex-wrap:wrap;align-items:baseline;gap:4px 8px}
.lp-plan .lp-price-now{font-family:var(--lp-font-h);font-size:clamp(1.9em,1.3em + 1.4cqi,2.6em);font-weight:700;letter-spacing:-.02em;line-height:1.05}
.lp-plan .lp-price-req{font-family:var(--lp-font-h);font-size:1.35em;font-weight:650}
.lp-plan-body{flex:1;font-size:.95em;overflow-wrap:anywhere}
.lp-plan-body>:first-child{margin-top:0}
.lp-plan-body>:last-child{margin-bottom:0}
.lp-plan-body ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.lp-plan-body li{position:relative;margin:0;padding-inline-start:1.8em}
.lp-plan-body li::before{content:"";position:absolute;inset-inline-start:0;top:.18em;width:1.15em;height:1.15em;border-radius:50%;background:var(--lp-tint)}
.lp-plan-body li::after{content:"";position:absolute;inset-inline-start:.42em;top:.4em;width:.3em;height:.55em;border:solid var(--lp-accent);border-width:0 2px 2px 0;transform:rotate(45deg)}
.lp-plan-cta .lp-buy{flex-direction:column;align-items:stretch}
.lp-plan-cta .lp-btn{width:100%;justify-content:center}
@media (prefers-reduced-motion:reduce){.lp-plan{transition:none}.lp-plan:hover{transform:none}}
.lp-root[data-mode=edit] .lp-plan:hover{transform:none}
`,events:BC_CSS_BUY+`
.lp-evs{min-width:0}
.lp-ev{min-width:0}
.lp-ev[hidden]{display:none}
.lp-ev-date{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:none;width:76px;min-height:76px;padding:8px 6px;border-radius:var(--lp-radius-s);background:var(--lp-tint);color:var(--lp-accent);text-align:center;line-height:1.1}
.lp-ev-dv>span,.lp-ev-dv>[data-l]>span{display:block}
.lp-ev-d{font-family:var(--lp-font-h);font-size:1.9em;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.lp-ev-m{margin-top:3px;font-size:.74em;font-weight:650;letter-spacing:.08em;text-transform:uppercase}
.lp-ev-m:lang(ka),.lp-ev-m :lang(ka){text-transform:none;letter-spacing:.01em}
.lp-ev-w{margin-top:2px;font-size:.7em;color:var(--lp-muted)}
.lp-ev-nod{font-size:1.4em;color:var(--lp-muted)}
.lp-ev-main{display:flex;flex-direction:column;gap:6px;min-width:0}
.lp-ev-title{margin:0;font-family:var(--lp-font-h);font-size:1.16em;font-weight:650;line-height:1.25;overflow-wrap:anywhere}
.lp-ev-title a{color:inherit;text-decoration:none}
.lp-ev-title a:hover{color:var(--lp-accent);text-decoration:underline;text-underline-offset:.18em}
.lp-ev-meta{display:flex;flex-wrap:wrap;gap:4px 18px;margin:0;color:var(--lp-muted);font-size:.9em}
.lp-ev-meta>span{display:inline-flex;align-items:flex-start;gap:6px;min-width:0}
.lp-ev-meta .lp-ic{flex:none;width:1.05em;height:1.05em;margin-top:.15em}
.lp-ev-side{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:10px 16px}
.lp-ev-price .lp-price-now{font-size:1.06em;white-space:nowrap}
.lp-ev-st{font-size:.78em;font-weight:600;white-space:nowrap}
.lp-ev-st-few{color:color-mix(in oklab,#b45309 55%,var(--lp-text));background:color-mix(in srgb,#f59e0b 14%,transparent)}
.lp-ev-st-out,.lp-ev-st-cx{color:color-mix(in oklab,#b91c1c 55%,var(--lp-text));background:color-mix(in srgb,#ef4444 12%,transparent)}
.lp-ev-st-past{color:var(--lp-muted)}
.lp-ev-cx .lp-ev-title{color:var(--lp-muted);text-decoration:line-through;text-decoration-thickness:1.5px}
.lp-ev-past{opacity:.6}
.lp-ev-none{display:none;margin:0;padding:28px 12px;color:var(--lp-muted);text-align:center}
.lp-ev-none-on,.lp-evs:not(:has(.lp-ev:not([hidden]))) .lp-ev-none{display:block}
`,cart:`
.lp-cartb{display:grid;gap:20px;min-width:0}
.lp-cartb-h{margin:0}
.lp-cartb-text>:first-child{margin-top:0}
.lp-cartb-text>:last-child{margin-bottom:0}
.lp-cartb-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:28px;align-items:start}
.lp-cartb-one{grid-template-columns:minmax(0,1fr);max-width:760px}
.lp-cartb-box,.lp-cartb-co{min-width:0;padding:24px;background:var(--lp-surface);color:var(--lp-text);border:1px solid var(--lp-border);border-radius:var(--lp-radius);box-shadow:var(--lp-shadow)}
.lp-cartb-empty,.lp-cartb-demo{display:flex;flex-direction:column;align-items:center;gap:10px;margin:0;padding:26px 8px;color:var(--lp-muted);text-align:center}
.lp-cartb-empty .lp-ic,.lp-cartb-demo .lp-ic{width:34px;height:34px;padding:8px;box-sizing:content-box;border-radius:50%;background:var(--lp-tint);color:var(--lp-accent)}
.lp-cartb-empty[hidden]{display:none}
:where(.lp-cartb-list){list-style:none;margin:0;padding:0}
.lp-cartb-list:empty{display:none}
:where(.lp-cartb-list)>*{display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid var(--lp-border)}
:where(.lp-cartb-list) img{flex:none;width:56px;height:56px;object-fit:cover;border-radius:var(--lp-radius-s)}
.lp-cartb-sum{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding-top:16px;font-size:1.06em}
.lp-cartb-sum strong{font-family:var(--lp-font-h);font-size:1.3em;font-weight:700;font-variant-numeric:tabular-nums}
.lp-cartb-sum:has([data-lp-cart-total]:empty),.lp-cartb-sum:has([data-lp-cart-total][hidden]),.lp-cartb-box:has([data-lp-cart-empty]:not([hidden])) .lp-cartb-sum{display:none}
.lp-cartb-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-top:12px}
.lp-cartb-status{margin:0;font-size:.82em;color:var(--lp-muted)}
.lp-cartb-box:has([data-lp-cart-empty]:not([hidden])) [data-lp-cart-clear]{visibility:hidden}
.lp-cartb-grid:has([data-lp-cart-empty]:not([hidden])){grid-template-columns:minmax(0,1fr)}
.lp-cartb:has([data-lp-cart-empty]:not([hidden])) .lp-cartb-co,.lp-cartb:has([data-lp-cart-empty]:not([hidden])) .lp-cartb-actions{display:none}
.lp-cartb-note{margin:0 0 16px;color:var(--lp-muted);font-size:.92em}
.lp-cartb-hint{margin:12px 0 0;font-size:.8em;color:var(--lp-muted)}
.lp-cartb-actions{margin-top:18px}
.lp-cartb-actions .lp-btn{width:100%;justify-content:center}
.lp-cartb .lp-form-result:empty{display:none}
.lp-cartb .lp-form-result{margin-top:14px}
.lp-cartb-nojs{display:none;margin:0;padding:18px 20px;border:1px dashed var(--lp-border);border-radius:var(--lp-radius);color:var(--lp-muted)}
html:not(.lp-js) .lp-cartb-nojs{display:block}
.lp-cartb-fake{display:block;min-height:2.75em;pointer-events:none}
.lp-cartb-fake-ta{min-height:6em}
.lp-cartb-fk{display:inline-flex;align-items:center;gap:10px}
.lp-cartb-box1{display:inline-block;flex:none;width:1.1em;height:1.1em;border:1.5px solid var(--lp-border);border-radius:4px}
.lp-cartb-req{color:var(--lp-accent)}
@container lp (max-width:900px){.lp-cartb-grid{grid-template-columns:minmax(0,1fr)}}
@container lp (max-width:600px){.lp-cartb-box,.lp-cartb-co{padding:18px}}
.lp-root[data-mode=edit] .lp-cartb-demo{border:1.5px dashed var(--lp-border);border-radius:var(--lp-radius-s)}
`,image:`
.lp-fig{margin:0;width:max(var(--lp-fw,100%),min(100%,240px));max-width:100%}
.lp-fig-center{margin-inline:auto}
.lp-fig-right{margin-inline-start:auto}
.lp-fig .lp-media{overflow:hidden}
.lp-fig-rounded .lp-media{border-radius:var(--lp-radius)}
.lp-fig-circle .lp-media{border-radius:50%}
.lp-fig-a{display:block;border-radius:var(--lp-radius-s);transition:opacity .2s}
.lp-fig-a:hover{opacity:.92}
.lp-fig-a:focus-visible{outline:2px solid var(--lp-accent);outline-offset:3px}
.lp-fig-cap{margin-top:10px;font-size:.88em;line-height:1.45;color:var(--lp-muted);text-align:center;overflow-wrap:anywhere}
.lp-fig-left .lp-fig-cap{text-align:start}
.lp-fig-right .lp-fig-cap{text-align:end}
.lp-fig img[data-lp-zoom]{cursor:zoom-in}
.lp-fig img[data-lp-zoom]:focus-visible{outline:2px solid var(--lp-accent);outline-offset:3px}
`,gallery:`
.lp-gal{min-width:0}
.lp-gal-list{margin:0;padding:0}
.lp-gal-grid .lp-gal-list{gap:var(--lp-ggap,12px)}
.lp-gal-it{position:relative;margin:0;min-width:0}
.lp-gal-it .lp-media{overflow:hidden;border-radius:var(--lp-radius-s)}
.lp-gal-cap{margin-top:8px;font-size:.86em;line-height:1.4;color:var(--lp-muted);overflow-wrap:anywhere}
.lp-gal img[data-lp-zoom]{cursor:zoom-in;transition:transform .6s var(--lp-ease)}
.lp-gal-it:hover img[data-lp-zoom]{transform:scale(1.04)}
.lp-gal img[data-lp-zoom]:focus-visible{outline:2px solid var(--lp-accent);outline-offset:-2px}
@media (prefers-reduced-motion:reduce){.lp-gal img[data-lp-zoom]{transition:none}.lp-gal-it:hover img[data-lp-zoom]{transform:none}}
`,embed:`
.lp-emb{min-width:0}
.lp-emb-prev{min-width:0}
.lp-emb-prev object,.lp-emb-prev iframe{display:block;width:100%;max-width:100%;border:0}
.lp-emb-prev video,.lp-emb-prev audio{display:block;width:100%;max-width:100%}
.lp-emb-audio .lp-emb-prev{padding:14px 16px}
.lp-emb-img{margin:0 auto;max-width:100%}
.lp-emb-img img{max-height:min(80vh,900px);object-fit:contain}
.lp-emb-img img[data-lp-zoom]{cursor:zoom-in}
.lp-emb-ph{min-height:120px}
`,qr:`
.lp-qr{margin:0;display:flex;flex-direction:column;gap:8px;width:max-content;max-width:100%}
.lp-qr-center{margin-inline:auto;align-items:center;text-align:center}
.lp-qr-right{margin-inline-start:auto;align-items:flex-end;text-align:end}
.lp-qr-code{display:block;max-width:100%;border-radius:var(--lp-radius-s);overflow:hidden;box-shadow:0 0 0 1px var(--lp-border)}
.lp-qr-code svg{display:block;width:100%;height:auto}
.lp-qr-a{display:block;line-height:0;border-radius:var(--lp-radius-s)}
.lp-qr-a:focus-visible{outline:2px solid var(--lp-accent);outline-offset:3px}
.lp-qr-l{max-width:18em;font-size:.86em;line-height:1.35;color:var(--lp-muted)}
.lp-qr-ph{display:flex;align-items:center;justify-content:center;aspect-ratio:1;border:1.5px dashed var(--lp-border);box-shadow:none;color:var(--lp-muted)}
.lp-qr-ph .lp-ic{width:40%;height:40%;opacity:.6}
`,};const CSS_VARIANTS_C={products:{'variant=cards':`
.lp-prs-cards .lp-pr-body{padding:20px 22px 22px}
`,'variant=list':`
.lp-prs-items{display:flex;flex-direction:column;gap:var(--lp-gap)}
.lp-prs-list .lp-pr{flex-direction:row;align-items:stretch}
.lp-prs-list .lp-pr-top{flex:0 0 clamp(150px,32%,320px)}
.lp-prs-list .lp-pr-top .lp-media{height:100%;min-height:100%}
.lp-prs-list .lp-pr-body{padding:24px 28px;gap:12px}
.lp-prs-list .lp-pr-name{font-size:1.28em}
.lp-prs-list .lp-pr:hover{transform:translateY(-2px)}
@container lp (max-width:600px){.lp-prs-list .lp-pr{flex-direction:column}.lp-prs-list .lp-pr-top{flex-basis:auto}.lp-prs-list .lp-pr-top .lp-media{height:auto}.lp-prs-list .lp-pr-body{padding:18px 20px 20px}}
`,'variant=compact':`
.lp-prs-compact .lp-pr-body{gap:6px;padding:12px 14px 14px}
.lp-prs-compact .lp-pr-name{font-size:.98em}
.lp-prs-compact .lp-pr .lp-price-now{font-size:1.08em}
.lp-prs-compact .lp-pr-foot{flex-direction:column;align-items:stretch;gap:10px}
.lp-prs-compact .lp-buy .lp-btn{flex:1 1 auto;justify-content:center}
.lp-prs-compact .lp-pr-top>.lp-pr-badge{top:8px;inset-inline-start:8px}
@container lp (max-width:600px){.lp-prs-compact .lp-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`,'variant=table':`
.lp-prs-table{overflow-x:auto}
.lp-pr-tbl{width:100%;border-collapse:separate;border-spacing:0;background:var(--lp-surface);color:var(--lp-text);border:1px solid var(--lp-border);border-radius:var(--lp-radius);overflow:hidden;font-variant-numeric:tabular-nums}
.lp-pr-tbl th{padding:12px 18px;text-align:start;font-size:.78em;font-weight:650;letter-spacing:.05em;color:var(--lp-muted);background:var(--lp-tint2);border-bottom:1px solid var(--lp-border)}
.lp-pr-tbl td{padding:14px 18px;vertical-align:middle;border-bottom:1px solid var(--lp-border)}
.lp-pr-tbl tbody tr:last-child>td{border-bottom:0}
.lp-pr-row{transition:background-color .2s}
.lp-pr-row:hover{background:color-mix(in srgb,var(--lp-tint) 55%,transparent)}
.lp-pr-c{display:flex;align-items:center;gap:14px;min-width:0}
.lp-pr-c>.lp-media{flex:0 0 60px;width:60px;border-radius:var(--lp-radius-s)}
.lp-pr-ci{display:flex;flex-direction:column;gap:4px;min-width:0}
.lp-pr-nl{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.lp-pr-row .lp-pr-name{font-size:1em}
.lp-pr-specs-in{display:flex;flex-wrap:wrap;gap:2px 14px;font-size:.8em}
.lp-pr-specs-in>div{display:inline-flex;gap:4px;padding:0;border:0}
.lp-pr-specs-in dt::after{content:":"}
.lp-pr-specs-in dd{text-align:start;font-weight:500}
.lp-pr-tc-p{text-align:end}
.lp-pr-tc-p .lp-price{justify-content:flex-end}
.lp-pr-tc-p .lp-price-now{white-space:nowrap;font-size:1.06em}
.lp-pr-tc-b{width:1%;text-align:end}
.lp-pr-tc-b .lp-buy{justify-content:flex-end;flex-wrap:nowrap}
@container lp (max-width:600px){.lp-pr-tbl thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.lp-pr-tbl,.lp-pr-tbl tbody,.lp-pr-tbl td{display:block}.lp-pr-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--lp-border)}.lp-pr-tbl tbody .lp-pr-row:last-child{border-bottom:0}.lp-pr-tbl td{padding:0;border:0}.lp-pr-tc-n{grid-column:1/-1}.lp-pr-tc-p{text-align:start}.lp-pr-tc-p .lp-price{justify-content:flex-start}.lp-pr-tc-b{width:auto}}
`,},events:{'variant=list':`
.lp-evs-rows{display:flex;flex-direction:column;border-top:1px solid var(--lp-border)}
.lp-evs-list .lp-ev{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:14px 24px;padding:20px 4px;border-bottom:1px solid var(--lp-border);transition:background-color .2s}
.lp-evs-list .lp-ev:hover{background:color-mix(in srgb,var(--lp-tint) 45%,transparent)}
.lp-evs-list .lp-ev[hidden]{display:none}
@container lp (max-width:600px){.lp-evs-list .lp-ev{grid-template-columns:auto minmax(0,1fr);gap:12px 16px}.lp-evs-list .lp-ev-side{grid-column:1/-1;justify-content:space-between}.lp-evs-list .lp-ev-date{width:64px;min-height:64px}}
`,'variant=cards':`
.lp-evs-cards .lp-grid{align-items:stretch}
.lp-evs-cards .lp-ev{display:flex;flex-direction:column;align-items:flex-start;gap:14px;padding:22px;background:var(--lp-surface);color:var(--lp-text);border:1px solid var(--lp-border);border-radius:var(--lp-radius);transition:transform .3s var(--lp-ease),box-shadow .3s var(--lp-ease)}
.lp-evs-cards .lp-ev:hover{transform:translateY(-3px);box-shadow:var(--lp-shadow-lg)}
.lp-evs-cards .lp-ev[hidden]{display:none}
.lp-evs-cards .lp-ev-main{align-self:stretch}
.lp-evs-cards .lp-ev-side{align-self:stretch;justify-content:space-between;margin-top:auto;padding-top:14px;border-top:1px solid var(--lp-border)}
@media (prefers-reduced-motion:reduce){.lp-evs-cards .lp-ev{transition:none}.lp-evs-cards .lp-ev:hover{transform:none}}
.lp-root[data-mode=edit] .lp-evs-cards .lp-ev:hover{transform:none}
`,},gallery:{'variant=grid':`
@container lp (max-width:600px){.lp-gal-grid .lp-gal-list{grid-template-columns:repeat(2,minmax(0,1fr))}}
`,'variant=masonry':`
.lp-gal-masonry .lp-gal-list{columns:var(--lp-cols,3);column-gap:var(--lp-ggap,12px)}
.lp-gal-masonry .lp-gal-it{break-inside:avoid;margin-bottom:var(--lp-ggap,12px)}
@container lp (max-width:900px){.lp-gal-masonry .lp-gal-list{columns:2}}
`,'variant=slider':`
.lp-gal-slider{position:relative}
.lp-gal-track{display:grid;grid-auto-flow:column;grid-auto-columns:calc((100% - (var(--lp-cols,3) - 1) * var(--lp-ggap,12px)) / var(--lp-cols,3));gap:var(--lp-ggap,12px);overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;padding-bottom:12px;scrollbar-width:thin;scrollbar-color:var(--lp-border) transparent}
.lp-gal-track>.lp-gal-it{scroll-snap-align:start}
.lp-gal-track:focus-visible{outline:2px solid var(--lp-accent);outline-offset:4px;border-radius:var(--lp-radius-s)}
@media (prefers-reduced-motion:no-preference){.lp-gal-track{scroll-behavior:smooth}}
.lp-gal-nav{position:absolute;top:calc(50% - 34px);z-index:2;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0;border:1px solid var(--lp-border);border-radius:50%;background:color-mix(in srgb,var(--lp-surface) 92%,transparent);color:var(--lp-text);box-shadow:var(--lp-shadow);cursor:pointer;transition:background-color .2s,color .2s,opacity .2s,border-color .2s}
.lp-gal-nav:hover{background:var(--lp-accent);border-color:var(--lp-accent);color:var(--lp-on-accent)}
.lp-gal-nav:focus-visible{outline:2px solid var(--lp-accent);outline-offset:2px}
.lp-gal-nav[disabled]{opacity:.35;cursor:default;pointer-events:none}
.lp-gal-nav .lp-ic{width:20px;height:20px}
.lp-gal-prev{inset-inline-start:-16px}
.lp-gal-next{inset-inline-end:-16px}
[dir=rtl] .lp-gal-nav .lp-ic{transform:scaleX(-1)}
@container lp (max-width:900px){.lp-gal-track{grid-auto-columns:calc((100% - var(--lp-ggap,12px)) / 2)}.lp-gal-prev{inset-inline-start:6px}.lp-gal-next{inset-inline-end:6px}}
@container lp (max-width:600px){.lp-gal-track{grid-auto-columns:84%}.lp-gal-nav{display:none}}
.lp-root[data-mode=edit] .lp-gal-track{scroll-snap-type:none}
`,'variant=mosaic':`
.lp-gal-mosaic .lp-gal-list{display:grid;grid-template-columns:repeat(var(--lp-cols,3),minmax(0,1fr));grid-auto-flow:dense;gap:var(--lp-ggap,12px)}
.lp-gal-mosaic .lp-gal-it{aspect-ratio:1/1}
.lp-gal-mosaic .lp-gal-it:nth-child(6n+1){grid-column:span 2;grid-row:span 2}
.lp-gal-mosaic .lp-media{height:100%;aspect-ratio:auto}
.lp-gal-mosaic .lp-gal-cap{position:absolute;inset:auto 0 0;margin:0;padding:30px 14px 12px;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.66));border-radius:0 0 var(--lp-radius-s) var(--lp-radius-s);pointer-events:none}
@container lp (max-width:600px){.lp-gal-mosaic .lp-gal-list{grid-template-columns:repeat(2,minmax(0,1fr))}}
.lp-root[data-mode=edit] .lp-gal-mosaic .lp-gal-cap{pointer-events:auto}
`,},};const BLOCK_DEPS_C={products:['grid','media','chip','price','qty','kv'],pricing:['grid','price'],events:['grid','chip','price'],cart:['price','qty','form'],image:['media'],gallery:['grid','media'],embed:['att','media'],qr:[],};const OWN_C=[[/\.lp-(prs?|stock)\b/,'products'],[/\.lp-plans?\b/,'pricing'],[/\.lp-evs?\b/,'events'],[/\.lp-cartb\b/,'cart'],[/\.lp-fig\b/,'image'],[/\.lp-gal\b/,'gallery'],[/\.lp-emb\b/,'embed'],[/\.lp-qr\b/,'qr'],];const UI_C={en:{addToCart:'Add to cart',addToQuote:'Add to request',priceOnRequest:'Price on request',oldPrice:'Old price',perUnit:'/ {unit}',from:'from {price}',minOrder:'Min. order: {n}',inStock:'In stock',lowStock:'Low stock',outOfStock:'Out of stock',preorder:'Pre-order',qty:'Quantity',decrease:'Decrease quantity',increase:'Increase quantity',colProduct:'Product',colPrice:'Price',colOrder:'Order',popular:'Most popular',soldOut:'Sold out',fewLeft:'Few places left',cancelled:'Cancelled',pastEvent:'Past event',noEvents:'No upcoming events yet. Check back soon.',tickets:'Tickets',buyTicket:'Buy ticket','cb.empty':'Your cart is empty.','cb.emptyQuote':'Your request list is empty.','cb.total':'Total','cb.clear':'Clear cart','cb.clearQuote':'Clear list','cb.checkout':'Checkout','cb.checkoutQuote':'Request a quote','cb.send':'Place order','cb.sendQuote':'Send request','cb.nojs':'The cart needs JavaScript. Please enable it or contact us directly.','cb.edit':'Items added by visitors appear here.','cb.fields':'Checkout fields are set up in the Shop settings.','gal.prev':'Previous','gal.next':'Next','gal.label':'Gallery',qrScan:'Scan the QR code','edit.pickFile':'Double-click to choose a file','ph.product':'Product name','ph.prodDesc':'Short description…','ph.prodBadge':'Badge','ph.prodUnit':'unit','ph.plan':'Plan name','ph.planBody':'What is included…','ph.planBtn':'Button text','ph.event':'Event title','ph.evCity':'City','ph.evVenue':'Venue','ph.cartTitle':'Your order','ph.cartText':'Text above the cart…','ph.galCaption':'Caption','ph.imgCaption':'Caption','ph.qrLabel':'Visible text',},ru:{addToCart:'В корзину',addToQuote:'В запрос',priceOnRequest:'Цена по запросу',oldPrice:'Старая цена',perUnit:'/ {unit}',from:'от {price}',minOrder:'Мин. заказ: {n}',inStock:'В наличии',lowStock:'Мало на складе',outOfStock:'Нет в наличии',preorder:'Предзаказ',qty:'Количество',decrease:'Уменьшить количество',increase:'Увеличить количество',colProduct:'Товар',colPrice:'Цена',colOrder:'Заказ',popular:'Популярный выбор',soldOut:'Билеты проданы',fewLeft:'Осталось мало мест',cancelled:'Отменено',pastEvent:'Уже прошло',noEvents:'Ближайших событий пока нет. Загляните позже.',tickets:'Билеты',buyTicket:'Купить билет','cb.empty':'Корзина пуста.','cb.emptyQuote':'Список запроса пуст.','cb.total':'Итого','cb.clear':'Очистить корзину','cb.clearQuote':'Очистить список','cb.checkout':'Оформить заказ','cb.checkoutQuote':'Запросить предложение','cb.send':'Отправить заказ','cb.sendQuote':'Отправить запрос','cb.nojs':'Для работы корзины нужен JavaScript. Включите его или свяжитесь с нами напрямую.','cb.edit':'Здесь появятся товары, которые добавит посетитель.','cb.fields':'Поля оформления заказа настраиваются в параметрах магазина.','gal.prev':'Назад','gal.next':'Вперёд','gal.label':'Галерея',qrScan:'Отсканируйте QR-код','edit.pickFile':'Дважды щёлкните, чтобы выбрать файл','ph.product':'Название товара','ph.prodDesc':'Краткое описание…','ph.prodBadge':'Метка','ph.prodUnit':'ед. изм.','ph.plan':'Название тарифа','ph.planBody':'Что входит…','ph.planBtn':'Текст кнопки','ph.event':'Название события','ph.evCity':'Город','ph.evVenue':'Площадка','ph.cartTitle':'Ваш заказ','ph.cartText':'Текст над корзиной…','ph.galCaption':'Подпись','ph.imgCaption':'Подпись','ph.qrLabel':'Видимый текст',},uk:{addToCart:'До кошика',addToQuote:'До запиту',priceOnRequest:'Ціна за запитом',oldPrice:'Стара ціна',perUnit:'/ {unit}',from:'від {price}',minOrder:'Мін. замовлення: {n}',inStock:'В наявності',lowStock:'Закінчується',outOfStock:'Немає в наявності',preorder:'Передзамовлення',qty:'Кількість',decrease:'Зменшити кількість',increase:'Збільшити кількість',colProduct:'Товар',colPrice:'Ціна',colOrder:'Замовлення',popular:'Найпопулярніший',soldOut:'Квитки продано',fewLeft:'Залишилось мало місць',cancelled:'Скасовано',pastEvent:'Уже відбулося',noEvents:'Найближчих подій поки немає. Завітайте пізніше.',tickets:'Квитки',buyTicket:'Купити квиток','cb.empty':'Кошик порожній.','cb.emptyQuote':'Список запиту порожній.','cb.total':'Разом','cb.clear':'Очистити кошик','cb.clearQuote':'Очистити список','cb.checkout':'Оформити замовлення','cb.checkoutQuote':'Запросити пропозицію','cb.send':'Надіслати замовлення','cb.sendQuote':'Надіслати запит','cb.nojs':'Для роботи кошика потрібен JavaScript. Увімкніть його або зв’яжіться з нами напряму.','cb.edit':'Тут з’являться товари, які додасть відвідувач.','cb.fields':'Поля оформлення замовлення налаштовуються в параметрах магазину.','gal.prev':'Назад','gal.next':'Далі','gal.label':'Галерея',qrScan:'Відскануйте QR-код','edit.pickFile':'Двічі клацніть, щоб вибрати файл','ph.product':'Назва товару','ph.prodDesc':'Короткий опис…','ph.prodBadge':'Мітка','ph.prodUnit':'од. виміру','ph.plan':'Назва тарифу','ph.planBody':'Що входить…','ph.planBtn':'Текст кнопки','ph.event':'Назва події','ph.evCity':'Місто','ph.evVenue':'Майданчик','ph.cartTitle':'Ваше замовлення','ph.cartText':'Текст над кошиком…','ph.galCaption':'Підпис','ph.imgCaption':'Підпис','ph.qrLabel':'Видимий текст',},de:{addToCart:'In den Warenkorb',addToQuote:'Zur Anfrage',priceOnRequest:'Preis auf Anfrage',oldPrice:'Alter Preis',perUnit:'/ {unit}',from:'ab {price}',minOrder:'Mindestmenge: {n}',inStock:'Auf Lager',lowStock:'Nur noch wenige',outOfStock:'Nicht auf Lager',preorder:'Vorbestellung',qty:'Menge',decrease:'Menge verringern',increase:'Menge erhöhen',colProduct:'Produkt',colPrice:'Preis',colOrder:'Bestellen',popular:'Am beliebtesten',soldOut:'Ausverkauft',fewLeft:'Nur noch wenige Plätze',cancelled:'Abgesagt',pastEvent:'Vergangen',noEvents:'Derzeit keine anstehenden Termine. Schauen Sie bald wieder vorbei.',tickets:'Tickets',buyTicket:'Ticket kaufen','cb.empty':'Ihr Warenkorb ist leer.','cb.emptyQuote':'Ihre Anfrageliste ist leer.','cb.total':'Gesamt','cb.clear':'Warenkorb leeren','cb.clearQuote':'Liste leeren','cb.checkout':'Zur Kasse','cb.checkoutQuote':'Angebot anfordern','cb.send':'Bestellung absenden','cb.sendQuote':'Anfrage senden','cb.nojs':'Der Warenkorb benötigt JavaScript. Bitte aktivieren Sie es oder kontaktieren Sie uns direkt.','cb.edit':'Hier erscheinen die Artikel, die Besucher hinzufügen.','cb.fields':'Die Bestellfelder werden in den Shop-Einstellungen festgelegt.','gal.prev':'Zurück','gal.next':'Weiter','gal.label':'Galerie',qrScan:'QR-Code scannen','edit.pickFile':'Doppelklicken, um eine Datei zu wählen','ph.product':'Produktname','ph.prodDesc':'Kurzbeschreibung…','ph.prodBadge':'Label','ph.prodUnit':'Einheit','ph.plan':'Tarifname','ph.planBody':'Was enthalten ist…','ph.planBtn':'Button-Text','ph.event':'Veranstaltungstitel','ph.evCity':'Stadt','ph.evVenue':'Veranstaltungsort','ph.cartTitle':'Ihre Bestellung','ph.cartText':'Text über dem Warenkorb…','ph.galCaption':'Bildunterschrift','ph.imgCaption':'Bildunterschrift','ph.qrLabel':'Sichtbarer Text',},fr:{addToCart:'Ajouter au panier',addToQuote:'Ajouter à la demande',priceOnRequest:'Prix sur demande',oldPrice:'Ancien prix',perUnit:'/ {unit}',from:'dès {price}',minOrder:'Commande min. : {n}',inStock:'En stock',lowStock:'Stock limité',outOfStock:'Rupture de stock',preorder:'Précommande',qty:'Quantité',decrease:'Diminuer la quantité',increase:'Augmenter la quantité',colProduct:'Produit',colPrice:'Prix',colOrder:'Commander',popular:'Le plus populaire',soldOut:'Complet',fewLeft:'Dernières places',cancelled:'Annulé',pastEvent:'Passé',noEvents:'Aucun événement à venir pour le moment. Revenez bientôt.',tickets:'Billets',buyTicket:'Acheter un billet','cb.empty':'Votre panier est vide.','cb.emptyQuote':'Votre liste de demande est vide.','cb.total':'Total','cb.clear':'Vider le panier','cb.clearQuote':'Vider la liste','cb.checkout':'Commander','cb.checkoutQuote':'Demander un devis','cb.send':'Envoyer la commande','cb.sendQuote':'Envoyer la demande','cb.nojs':'Le panier nécessite JavaScript. Activez-le ou contactez-nous directement.','cb.edit':'Les articles ajoutés par les visiteurs apparaissent ici.','cb.fields':'Les champs de commande se règlent dans les paramètres de la boutique.','gal.prev':'Précédent','gal.next':'Suivant','gal.label':'Galerie',qrScan:'Scannez le code QR','edit.pickFile':'Double-cliquez pour choisir un fichier','ph.product':'Nom du produit','ph.prodDesc':'Brève description…','ph.prodBadge':'Badge','ph.prodUnit':'unité','ph.plan':'Nom de la formule','ph.planBody':'Ce qui est inclus…','ph.planBtn':'Texte du bouton','ph.event':'Titre de l’événement','ph.evCity':'Ville','ph.evVenue':'Lieu','ph.cartTitle':'Votre commande','ph.cartText':'Texte au-dessus du panier…','ph.galCaption':'Légende','ph.imgCaption':'Légende','ph.qrLabel':'Texte visible',},es:{addToCart:'Añadir al carrito',addToQuote:'Añadir a la solicitud',priceOnRequest:'Precio a consultar',oldPrice:'Precio anterior',perUnit:'/ {unit}',from:'desde {price}',minOrder:'Pedido mín.: {n}',inStock:'En stock',lowStock:'Pocas unidades',outOfStock:'Agotado',preorder:'Reserva',qty:'Cantidad',decrease:'Reducir cantidad',increase:'Aumentar cantidad',colProduct:'Producto',colPrice:'Precio',colOrder:'Pedido',popular:'El más popular',soldOut:'Entradas agotadas',fewLeft:'Quedan pocas plazas',cancelled:'Cancelado',pastEvent:'Finalizado',noEvents:'No hay próximos eventos por ahora. Vuelve pronto.',tickets:'Entradas',buyTicket:'Comprar entrada','cb.empty':'Tu carrito está vacío.','cb.emptyQuote':'Tu lista de solicitud está vacía.','cb.total':'Total','cb.clear':'Vaciar carrito','cb.clearQuote':'Vaciar lista','cb.checkout':'Finalizar compra','cb.checkoutQuote':'Solicitar presupuesto','cb.send':'Enviar pedido','cb.sendQuote':'Enviar solicitud','cb.nojs':'El carrito necesita JavaScript. Actívalo o contáctanos directamente.','cb.edit':'Aquí aparecerán los artículos que añadan los visitantes.','cb.fields':'Los campos del pedido se configuran en los ajustes de la tienda.','gal.prev':'Anterior','gal.next':'Siguiente','gal.label':'Galería',qrScan:'Escanea el código QR','edit.pickFile':'Haz doble clic para elegir un archivo','ph.product':'Nombre del producto','ph.prodDesc':'Descripción breve…','ph.prodBadge':'Etiqueta','ph.prodUnit':'unidad','ph.plan':'Nombre del plan','ph.planBody':'Qué incluye…','ph.planBtn':'Texto del botón','ph.event':'Título del evento','ph.evCity':'Ciudad','ph.evVenue':'Lugar','ph.cartTitle':'Tu pedido','ph.cartText':'Texto sobre el carrito…','ph.galCaption':'Pie de foto','ph.imgCaption':'Pie de foto','ph.qrLabel':'Texto visible',},ka:{addToCart:'კალათაში დამატება',addToQuote:'მოთხოვნაში დამატება',priceOnRequest:'ფასი მოთხოვნით',oldPrice:'ძველი ფასი',perUnit:'/ {unit}',from:'{price}-დან',minOrder:'მინ. შეკვეთა: {n}',inStock:'მარაგშია',lowStock:'მცირე მარაგი',outOfStock:'არ არის მარაგში',preorder:'წინასწარი შეკვეთა',qty:'რაოდენობა',decrease:'რაოდენობის შემცირება',increase:'რაოდენობის გაზრდა',colProduct:'პროდუქტი',colPrice:'ფასი',colOrder:'შეკვეთა',popular:'ყველაზე პოპულარული',soldOut:'ბილეთები გაყიდულია',fewLeft:'ცოტა ადგილი დარჩა',cancelled:'გაუქმებულია',pastEvent:'უკვე ჩატარდა',noEvents:'მომავალი ღონისძიებები ჯერ არ არის. შემოგვიარეთ მოგვიანებით.',tickets:'ბილეთები',buyTicket:'ბილეთის ყიდვა','cb.empty':'კალათა ცარიელია.','cb.emptyQuote':'მოთხოვნის სია ცარიელია.','cb.total':'სულ','cb.clear':'კალათის გასუფთავება','cb.clearQuote':'სიის გასუფთავება','cb.checkout':'შეკვეთის გაფორმება','cb.checkoutQuote':'ფასის მოთხოვნა','cb.send':'შეკვეთის გაგზავნა','cb.sendQuote':'მოთხოვნის გაგზავნა','cb.nojs':'კალათას JavaScript სჭირდება. ჩართეთ ის ან დაგვიკავშირდით პირდაპირ.','cb.edit':'აქ გამოჩნდება ვიზიტორის მიერ დამატებული პროდუქტები.','cb.fields':'შეკვეთის ველები მაღაზიის პარამეტრებში იმართება.','gal.prev':'წინა','gal.next':'შემდეგი','gal.label':'გალერეა',qrScan:'დაასკანერეთ QR კოდი','edit.pickFile':'ფაილის ასარჩევად ორჯერ დააწკაპუნეთ','ph.product':'პროდუქტის დასახელება','ph.prodDesc':'მოკლე აღწერა…','ph.prodBadge':'ნიშანი','ph.prodUnit':'ერთეული','ph.plan':'პაკეტის სახელი','ph.planBody':'რას მოიცავს…','ph.planBtn':'ღილაკის ტექსტი','ph.event':'ღონისძიების სახელი','ph.evCity':'ქალაქი','ph.evVenue':'ადგილი','ph.cartTitle':'თქვენი შეკვეთა','ph.cartText':'ტექსტი კალათის თავზე…','ph.galCaption':'წარწერა','ph.imgCaption':'წარწერა','ph.qrLabel':'ხილული ტექსტი',},};export{formatDay,collectProducts,bcNeedAtt,bcAmount,bcSku,priceHTML,buyHTML,bcHref,bcVar,formatPrice,CSS_BLOCKS_C,CSS_VARIANTS_C,BLOCK_DEPS_C,OWN_C,UI_C,BT_C};