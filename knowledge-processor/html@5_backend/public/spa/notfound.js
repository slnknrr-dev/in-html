function spaNotFoundBoot(o){var d=document,w=window,path=location.pathname,cands=[],i=0;try{path=decodeURI(path);}catch(e){}
function add(b){if(typeof b==='string'&&b.charAt(0)==='/'&&b.charAt(b.length-1)==='/'&&path.indexOf(b)===0&&cands.indexOf(b)<0)cands.push(b);}
if(o.base)add(o.base);try{add(w.localStorage.getItem(o.key));}catch(e){}
var segs=path.split('/');for(var k=segs.length-1;k>=1;k--)add(segs.slice(0,k).join('/')+'/');function get(obj,p){var parts=String(p||'').split('.');for(var j=0;j<parts.length&&obj!=null;j++)obj=obj[parts[j]];return obj;}
function done(b){w.SPA_BASE=b;try{w.localStorage.setItem(o.key,b);}catch(e){}
var list=o.load||[];for(var j=0;j<list.length;j++){var x=list[j],el;if(x.css){el=d.createElement('link');el.rel='stylesheet';el.href=encodeURI(b)+x.css;}
else{el=d.createElement('script');if(x.module)el.type='module';el.src=encodeURI(b)+x.js;}
d.head.appendChild(el);}
d.documentElement.className+=' spa-ready';}
function next(){if(i>=cands.length){d.documentElement.className+=' spa-failed';return;}
var b=cands[i++],s=d.createElement('script');try{delete w[o.global];}catch(e){w[o.global]=undefined;}
s.src=encodeURI(b)+o.probe;s.onload=function(){if(get(w[o.global],o.idPath)===o.id)done(b);else{s.parentNode&&s.parentNode.removeChild(s);next();}};s.onerror=function(){s.parentNode&&s.parentNode.removeChild(s);next();};d.head.appendChild(s);}
next();}
const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));function notFoundPage({lang='en',title='Not found',head='',body='',boot}){const opts=JSON.stringify(boot||{}).replace(/</g,'\\u003c');return'<!doctype html>\n<html lang="'+esc(lang)+'">\n<head>\n<meta charset="utf-8">\n'+'<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n'+'<title>'+esc(title)+'</title>\n'+head+'\n<script>('+spaNotFoundBoot.toString()+')('+opts+');\x3C/script>\n</head>\n<body>\n'+body+'\n</body>\n</html>\n';}
export{notFoundPage};