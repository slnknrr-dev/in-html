function rtPagesHead(c){var d=document;var h=d.documentElement;var L=location;if(!/^https?:$/.test(L.protocol))return;if(c.m==='a'&&/^#\//.test(L.hash))return;var routes={};(c.r||[]).forEach(function(s){routes[s]=1;});function parts(p){return p.split('/').filter(function(x){return x;}).map(function(x){try{return decodeURIComponent(x);}catch(e){return x;}});}
var segs=parts(L.pathname);function key(a,home,dir){a=a.slice();var idx=false;if(a.length){var last=a[a.length-1].toLowerCase();if(/^index(\.html?)?$/.test(last)){a.pop();idx=true;}else a[a.length-1]=a[a.length-1].replace(/\.html?$/i,'');}
var k=a.join('/').toLowerCase();return{k:k,ok:k?Object.prototype.hasOwnProperty.call(routes,k)&&k!=='404':home&&(dir||idx)};}
function match(list,home,dir){for(var n=0;n<=list.length;n++){var r1=key(list.slice(n),home,dir);if(r1.ok)return{b:'/'+list.slice(0,n).map(encodeURIComponent).join('/')+(n?'/':''),k:r1.k};}
return null;}
var trail=/\/$/.test(L.pathname);var base=null;var slug=null;if(c.b){var bs=parts(c.b);var pre=true;for(var j=0;j<bs.length;j++)if(!segs[j]||segs[j].toLowerCase()!==bs[j].toLowerCase())pre=false;if(pre){base=c.b;var r0=key(segs.slice(bs.length),!!c.i,trail);if(r0.ok)slug=r0.k;}}
if(base===null){var m0=match(segs,!!c.i,trail);if(m0){base=m0.b;slug=m0.k;}}
var sure=base!==null;if(base===null){try{var ref=d.referrer?new URL(d.referrer):null;if(ref&&ref.origin===L.origin){var m1=match(parts(ref.pathname),true,/\/$/.test(ref.pathname));if(m1&&L.pathname.toLowerCase().indexOf(m1.b.toLowerCase())===0){base=m1.b;sure=true;}}}catch(e){}}
if(base===null){base=segs.length>1&&/(^|\.)(github\.io|codeberg\.page|gitlab\.io)$/i.test(L.hostname)?'/'+encodeURIComponent(segs[0])+'/':'/';}
var route=slug===null?'404':slug;h.setAttribute('data-lp-base',base);h.setAttribute('data-lp-route',route);if(sure)h.setAttribute('data-lp-base-sure','');if(c.a){var b=d.createElement('base');b.setAttribute('href',base);d.head.appendChild(b);}
var st=d.createElement('style');st.id='lp-route-css';st.textContent='.lp-root>main[data-lp-page]{display:none!important}.lp-root>main[data-lp-page="'+route.replace(/["\\]/g,'')+'"]{display:block!important}';d.head.appendChild(st);}
function rtPages(R){var c=R.cfg.pg;if(!c||typeof c!=='object'||!Array.isArray(c.r))return;var d=document;var h=d.documentElement;var L=location;var hop=Object.prototype.hasOwnProperty;var NF='404';var mains=R.$$('.lp-root>main[data-lp-page]');if(!mains.length)return;var bySlug={};mains.forEach(function(m){bySlug[m.getAttribute('data-lp-page')]=m;});var info={};c.r.forEach(function(x){if(x&&typeof x.s==='string')info[x.s]=x;});var pathStyle=h.hasAttribute('data-lp-base')&&(c.m==='p'||(c.m==='a'&&h.hasAttribute('data-lp-base-sure')));var base=pathStyle?h.getAttribute('data-lp-base')||'/':'';h.classList.add('lp-route');var cur=null;function norm(p){var a=String(p||'').split('/').filter(function(x){return x;});if(a.length){var last=a[a.length-1].toLowerCase();if(/^index(\.html?)?$/.test(last))a.pop();else a[a.length-1]=a[a.length-1].replace(/\.html?$/i,'');}
return a.join('/').toLowerCase();}
function known(k){return k!==NF&&hop.call(bySlug,k);}
function target(id){if(!id)return null;var t=d.getElementById(id);if(!t){try{t=d.getElementById(decodeURIComponent(id));}catch(e){t=null;}}
return t;}
function pageOf(el){var m=el&&el.closest?el.closest('main[data-lp-page]'):null;return m&&m.parentNode&&m.parentNode.classList&&m.parentNode.classList.contains('lp-root')?m.getAttribute('data-lp-page'):null;}
function special(hs){return/^#(lang=|cart$|top$|$)/.test(hs);}
function fromURL(){var hs=L.hash||'';var m=/^#\/([^#]*)(?:#(.*))?$/.exec(hs);if(m){var k=norm(m[1]);return{s:known(k)?k:NF,a:m[2]||''};}
var an=hs.length>1&&!special(hs)?hs.slice(1):'';var s=hs.length>1&&special(hs)&&cur!==null?cur:'';if(pathStyle){var p=L.pathname;try{p=decodeURIComponent(p);}catch(e){}
var kk=p.toLowerCase().indexOf(base.toLowerCase())===0?norm(p.slice(base.length)):null;s=kk!==null&&known(kk)?kk:NF;}
if(cur===null&&h.getAttribute('data-lp-route')!==null){var hr=h.getAttribute('data-lp-route');s=known(hr)?hr:NF;}
if(an){var t=target(an);var pg=t?pageOf(t):null;if(pg!==null&&!(pathStyle&&s===NF))s=pg;}
return{s:s,a:an};}
function pick(o){if(!o)return'';var l=R.lang();if(o[l]!=null)return o[l];if(o[R.cfg.defaultLang]!=null)return o[R.cfg.defaultLang];for(var k in o)if(hop.call(o,k))return o[k];return'';}
function setMeta(sel,attr,name,value){var el=d.querySelector(sel);if(!el&&value){el=d.createElement('meta');el.setAttribute(attr,name);d.head.appendChild(el);}
if(el){if(value)el.setAttribute('content',value);else if(name==='robots')el.parentNode.removeChild(el);}}
function meta(){var x=info[cur]||{};var t=pick(x.t);if(t){d.title=t;setMeta('meta[property="og:title"]','property','og:title',t);}
var ds=pick(x.d);if(x.d){setMeta('meta[name="description"]','name','description',ds);setMeta('meta[property="og:description"]','property','og:description',ds);}
setMeta('meta[name="robots"]','name','robots',x.x?'noindex':'');}
function show(s){var m=bySlug[s]||bySlug[NF]||bySlug['']||mains[0];mains.forEach(function(x){if(x===m)x.removeAttribute('hidden');else x.setAttribute('hidden','');});var css=d.getElementById('lp-route-css');if(css&&css.parentNode)css.parentNode.removeChild(css);var prev=cur;cur=m.getAttribute('data-lp-page');R.$$('[data-lp-pg]').forEach(function(a){if(a.getAttribute('data-lp-pg')===cur)a.setAttribute('aria-current','page');else if(a.getAttribute('aria-current')==='page')a.removeAttribute('aria-current');});meta();if(prev!==cur){R.emit('lp:page',{page:cur,from:prev});try{window.dispatchEvent(new Event('resize'));}catch(e){}}}
function url(s,an){var hs=an?'#'+an:'';if(pathStyle)return base+(s&&s!==NF?s+'/':'')+hs;return L.pathname+L.search+(an?hs:'#/'+(s===NF?'':s));}
function save(){try{history.replaceState({lp:1,s:cur,y:window.pageYOffset||0},'',L.href);}catch(e){}}
function follow(t){var top=t.getBoundingClientRect().top;var n=0;var stop=false;var evs=['wheel','touchstart','keydown','mousedown'];function halt(){stop=true;}
evs.forEach(function(x){window.addEventListener(x,halt,{capture:true,passive:true});});function tick(){if(stop||++n>25||!d.documentElement.contains(t)){evs.forEach(function(x){window.removeEventListener(x,halt,true);});return;}
if(Math.abs(t.getBoundingClientRect().top-top)>1){t.scrollIntoView({block:'start'});top=t.getBoundingClientRect().top;}
setTimeout(tick,80);}
setTimeout(tick,80);}
function scrollTo(t,smooth){var soft=smooth&&!R.reduce();try{t.scrollIntoView({behavior:soft?'smooth':'auto',block:'start'});}catch(e){t.scrollIntoView();}
if(!soft)follow(t);if(!/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(t.tagName)&&!t.hasAttribute('tabindex'))t.setAttribute('tabindex','-1');try{t.focus({preventScroll:true});}catch(e){}}
function go(s,an,push){var changed=s!==cur;if(push&&(changed||an)){save();try{history.pushState({lp:1,s:s,y:0},'',url(s,an));}catch(e){}}
show(s);var t=an?target(an):null;if(t&&pageOf(t)===cur)scrollTo(t,!changed);else if(changed){window.scrollTo(0,0);var m=bySlug[cur];try{if(m)m.focus({preventScroll:true});}catch(e){}
R.live(d.title);}}
function closeMenu(a){var m=a&&a.closest?a.closest('details[open]'):null;if(m)m.removeAttribute('open');}
d.addEventListener('click',function(e){if(e.defaultPrevented||e.button>0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a||(a.target&&a.target!=='_self')||a.hasAttribute('download'))return;var raw=a.getAttribute('href')||'';var s=null;var an='';var m=/^#\/([^#]*)(?:#(.*))?$/.exec(raw);if(m){s=norm(m[1]);if(!known(s))return;an=m[2]||'';}else if(raw.charAt(0)==='#'){if(special(raw))return;var t=target(raw.slice(1));var pg=t?pageOf(t):null;if(pg===null||pg===cur)return;s=pg;an=raw.slice(1);}else if(pathStyle){var u=null;try{u=new URL(a.href,L.href);}catch(x){u=null;}
if(!u||u.origin!==L.origin)return;var p=u.pathname;try{p=decodeURIComponent(p);}catch(x2){}
if(p.toLowerCase().indexOf(base.toLowerCase())!==0)return;var rest=p.slice(base.length);if(/\.[a-z0-9]{1,5}$/i.test(rest)&&!/\.html?$/i.test(rest))return;var k=norm(rest);if(!known(k))return;s=k;an=u.hash?u.hash.slice(1):'';}else return;e.preventDefault();closeMenu(a);go(s,an,true);},true);if(c.m==='p'){window.addEventListener('click',function(e){if(e.defaultPrevented||e.button>0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;var a=e.target&&e.target.closest?e.target.closest('a[href^="#"]'):null;if(!a)return;e.preventDefault();var raw=a.getAttribute('href')||'';if(raw.length>1){try{L.hash=raw.slice(1);}catch(x){}}});}
window.addEventListener('popstate',function(e){var r=fromURL();var before=cur;show(r.s);var st=e.state;var t=r.a?target(r.a):null;if(t&&pageOf(t)===cur)scrollTo(t,false);else if(st&&st.lp&&typeof st.y==='number')window.scrollTo(0,st.y);else if(cur!==before)setTimeout(function(){window.scrollTo(0,0);},0);});R.on('lp:lang',meta);var r0=fromURL();if(pathStyle&&r0.s!==NF){var want=base+(r0.s?r0.s+'/':'')+L.search+L.hash;if(want!==L.pathname+L.search+L.hash){try{history.replaceState({lp:1,s:r0.s,y:0},'',want);}catch(e){}}}
show(r0.s);var t0=r0.a?target(r0.a):null;if(t0&&pageOf(t0)===cur)setTimeout(function(){scrollTo(t0,false);},60);else if(/^#\//.test(L.hash))setTimeout(function(){window.scrollTo(0,0);},0);}
const CSS_FEAT_PG={pages:`
.lp-root>.lp-main[data-lp-page][hidden]{display:none}
html:not(.lp-route) .lp-root>.lp-main[data-lp-page]:is(:target,:has(:target)){display:block!important}
html:not(.lp-route) .lp-root:has(>.lp-main[data-lp-page]:target,>.lp-main[data-lp-page] :target)>.lp-main[data-lp-page]:not(:target):not(:has(:target)){display:none!important}
.lp-root>.lp-main[data-lp-page]:focus{outline:none}
`,};export{rtPages,CSS_FEAT_PG,rtPagesHead};