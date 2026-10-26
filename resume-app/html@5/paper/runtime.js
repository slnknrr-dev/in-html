import{rtBlob,rtI18n,rtTheme}from"../doc/runtime-features.js";const FEATURE_ORDER=['core','blob','i18n','theme','print','attach','links'];function rtCore(R){var d=document;R.$=function(s,r){return(r||d).querySelector(s);};R.$$=function(s,r){return Array.prototype.slice.call((r||d).querySelectorAll(s));};R.cfg={};try{var c=d.getElementById('__P__-cfg');if(c)R.cfg=JSON.parse(c.textContent)||{};}catch(e){R.cfg={};}
R.store={get:function(k){try{return window.localStorage.getItem(k);}catch(e){return null;}},set:function(k,v){try{window.localStorage.setItem(k,v);}catch(e){}},};}
function rtPrint(R){document.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('[data-__P__-print]'):null;if(!b)return;e.preventDefault();try{window.print();}catch(err){}});}
function rtAttach(R){var d=document;function base(id){return String(R.meta(id).mime||'').split(';')[0].replace(/\s+/g,'').toLowerCase();}
function active(id){return/html|xml|svg|javascript|ecmascript/.test(base(id));}
function hydrate(el){var id=el.getAttribute('data-att');if(el.tagName==='IFRAME'?el.getAttribute('sandbox')!=='':(active(id)||!/^(application\/pdf|text\/plain|video\/(mp4|webm|ogg)|audio\/(mpeg|ogg|wav|webm))$/.test(base(id))))return;R.url(id).then(function(u){if(el.tagName==='IFRAME'){el.src=u;return;}
var o=el.cloneNode(true);o.setAttribute('data',base(id)==='application/pdf'?u+'#toolbar=0&navpanes=0&view=FitH':u);if(el.parentNode)el.parentNode.replaceChild(o,el);}).catch(function(){});}
var els=R.$$('object[data-att],iframe[data-att]');if('IntersectionObserver'in window){var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){io.unobserve(en.target);hydrate(en.target);}});},{rootMargin:'400px 0px'});els.forEach(function(el){io.observe(el);});}else{els.forEach(hydrate);}
function download(id){R.url(id).then(function(u){var a=d.createElement('a');a.href=u;a.download=R.meta(id).name;a.style.display='none';d.body.appendChild(a);a.click();setTimeout(function(){if(a.parentNode)a.parentNode.removeChild(a);},1500);}).catch(function(){});}
function pop(u){var w=null;try{w=window.open(u,'_blank');}catch(e){w=null;}
if(!w)return false;try{w.opener=null;}catch(e){}
return true;}
function open(id){if(active(id)){download(id);return;}
if(R.u[id]){if(!pop(R.u[id]))download(id);return;}
var w=null;try{w=window.open('','_blank');}catch(e){w=null;}
if(w){try{w.opener=null;}catch(e){}}
R.url(id).then(function(u){if(w&&!w.closed)w.location.href=u;else if(!pop(u))download(id);}).catch(function(){if(w)w.close();});}
function printAtt(id){var b=base(id);var isImg=/^image\//.test(b);if(!(isImg||b==='application/pdf'||b==='text/plain')){download(id);return;}
R.url(id).then(function(u){var f=d.createElement('iframe');var done=false;f.setAttribute('aria-hidden','true');f.tabIndex=-1;f.style.cssText='position:fixed;right:0;bottom:0;width:2px;height:2px;border:0;opacity:.01;pointer-events:none';function cleanup(){setTimeout(function(){if(f.parentNode)f.parentNode.removeChild(f);},400);}
function go(){if(done)return;done=true;try{var cw=f.contentWindow;try{cw.addEventListener('afterprint',cleanup);}catch(e1){}
cw.focus();cw.print();}catch(e){cleanup();if(!pop(u))download(id);}}
setTimeout(cleanup,60000);if(isImg){f.onload=function(){var im=f.contentDocument&&f.contentDocument.images[0];if(im&&!im.complete){im.onload=go;im.onerror=go;}else go();};f.srcdoc='<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:10mm}html,body{margin:0;height:100%}'
+'body{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100vh;object-fit:contain}'
+'</style></head><body><img src="'+u+'" alt=""></body></html>';}else{f.onload=function(){setTimeout(go,300);};f.src=u;}
d.body.appendChild(f);}).catch(function(){open(id);});}
function label(k){var a=(R.cfg&&R.cfg.aria)||{};var v=(a[d.documentElement.lang]||{})[k];return v!=null?v:(a[R.cfg.defaultLang]||{})[k]||'';}
function lightbox(img){var prev=d.activeElement;var lb=d.createElement('div');var im=d.createElement('img');var x=d.createElement('button');lb.className='__P__-lb __P__-noprint';lb.setAttribute('role','dialog');lb.setAttribute('aria-modal','true');lb.setAttribute('aria-label',img.alt||'');im.src=img.currentSrc||img.src;im.alt=img.alt||'';x.type='button';x.className='__P__-lb-x';x.setAttribute('aria-label',label('close'));x.textContent='×';lb.appendChild(im);lb.appendChild(x);function key(e){if(e.key==='Escape'){e.preventDefault();close();}else if(e.key==='Tab'){e.preventDefault();x.focus();}}
function close(){d.removeEventListener('keydown',key,true);if(lb.parentNode)lb.parentNode.removeChild(lb);var t=prev&&prev!==d.body&&prev.focus?prev:img;try{t.focus({preventScroll:true});}catch(e){}}
lb.addEventListener('click',close);d.addEventListener('keydown',key,true);d.body.appendChild(lb);x.focus();}
var ZOOM='.__P__-b-attachment img[data-att-img],.__P__-app-item img[data-att-img]';function zoomKey(e){var t=e.target;if(!(e.key==='Enter'||e.key===' ')||!t||!t.matches||!t.matches(ZOOM)||t.closest('a'))return;e.preventDefault();if((e.type==='keydown')===(e.key==='Enter')&&!e.repeat)lightbox(t);}
d.addEventListener('keydown',zoomKey);d.addEventListener('keyup',zoomKey);var SEL='[data-att-dl],[data-att-pr],[data-att-op]';d.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;var b=t.closest(SEL);if(b){e.preventDefault();var id=b.getAttribute('data-att');if(b.hasAttribute('data-att-dl'))download(id);else if(b.hasAttribute('data-att-pr'))printAtt(id);else open(id);return;}
var img=t.closest(ZOOM);if(img&&!t.closest('a')){e.preventDefault();lightbox(img);}});function warm(e){var b=e.target&&e.target.closest?e.target.closest(SEL):null;if(b)R.url(b.getAttribute('data-att')).catch(function(){});}
d.addEventListener('pointerover',warm);d.addEventListener('focusin',warm);}
function rtLinks(R){var d=document;function flash(el){if(!el||!el.classList)return;el.classList.remove('__P__-flash');void el.offsetWidth;el.classList.add('__P__-flash');setTimeout(function(){el.classList.remove('__P__-flash');},1900);}
function go(id,save){var t=d.getElementById(id);if(!t)return false;var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;try{t.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'});}catch(e){t.scrollIntoView();}
if(save){try{history.replaceState(null,'','#'+id);}catch(e){}}
flash(t);return true;}
d.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a.__P__-xref'):null;if(!a||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;var id=(a.getAttribute('href')||'').slice(1);if(id&&go(id,true))e.preventDefault();});var h=location.hash.slice(1);if(/^(att|b)-[a-z0-9]+$/i.test(h))setTimeout(function(){go(h,false);},80);}
const RUNTIME={core:rtCore,blob:rtBlob,i18n:rtI18n,print:rtPrint,attach:rtAttach,links:rtLinks,theme:rtTheme};export{FEATURE_ORDER,RUNTIME};