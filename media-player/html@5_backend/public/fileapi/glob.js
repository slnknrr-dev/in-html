const ESC=/[.*+?^${}()|[\]\\]/g;const esc=(s)=>s.replace(ESC,'\\$&');function compile(src,dot){let i=0;const lead=dot?'':'(?!\\.)';const SEG=lead+'[^/]+';function charClass(){let j=i+1;let neg=false;if(src[j]==='!'||src[j]==='^'){neg=true;j++;}
let body='';let first=true;while(j<src.length){const c=src[j];if(c===']'&&!first){i=j+1;return neg?`[^/${body}]`:`(?!/)[${body}]`;}
if(c==='\\'&&j+1<src.length){const n=src[j+1];body+=/\w/.test(n)?n:'\\'+n;j+=2;first=false;continue;}
body+=c==='\\'||c===']'||c==='['||c==='^'?'\\'+c:c;j++;first=false;}
return null;}
function seq(inBrace,atStart){let out='';while(i<src.length){const c=src[i];if(inBrace&&(c===','||c==='}'))break;if(c==='\\'){if(i+1<src.length){out+=esc(src[i+1]);i+=2;}else{out+='\\\\';i++;}
atStart=false;continue;}
if(c==='/'){out+='/';i++;atStart=true;continue;}
if(c==='*'){let j=i;while(src[j]==='*')j++;const after=src[j];const endsSeg=after===undefined||after==='/'||(inBrace&&(after===','||after==='}'));if(j-i>=2&&atStart&&endsSeg){if(after==='/'){out+=`(?:${SEG}/)*`;i=j+1;atStart=true;continue;}
if(out.endsWith('/'))out=out.slice(0,-1)+`(?:/${SEG})*`;else out+=`(?:${SEG}(?:/${SEG})*)?`;i=j;atStart=false;continue;}
out+=(atStart?lead:'')+'[^/]*';i=j;atStart=false;continue;}
if(c==='?'){out+=(atStart?lead:'')+'[^/]';i++;atStart=false;continue;}
if(c==='['){const save=i;const cls=charClass();if(cls){out+=(atStart?lead:'')+cls;atStart=false;continue;}
i=save+1;out+='\\[';atStart=false;continue;}
if(c==='{'){const save=i;i++;const alts=[];let closed=false;for(;;){alts.push(seq(true,atStart));if(src[i]===','){i++;continue;}
if(src[i]==='}'){i++;closed=true;}
break;}
if(closed&&alts.length>1){out+='(?:'+alts.join('|')+')';atStart=false;continue;}
i=save+1;out+='\\{';atStart=false;continue;}
out+=esc(c);i++;atStart=false;}
return out;}
return seq(false,true);}
const cache=new Map();function globToRegExp(glob,{nocase=true,dot=false}={}){const key=`${nocase?1:0}${dot?1:0}${glob}`;let re=cache.get(key);if(re)return re;let g=String(glob??'');let anchored=false;if(g.startsWith('./'))g=g.slice(2);if(g.startsWith('/')){anchored=true;g=g.replace(/^\/+/,'');}
if(g.length>1)g=g.replace(/\/+$/,'');const hasSlash=/(^|[^\\])\//.test(g);const prefix=anchored||hasSlash?'':`(?:${dot?'':'(?!\\.)'}[^/]+/)*`;const flags=nocase?'i':'';try{re=new RegExp('^'+prefix+compile(g,dot)+'$',flags);}catch{re=new RegExp('^'+prefix+esc(g)+'$',flags);}
if(cache.size>500)cache.clear();cache.set(key,re);return re;}
const matchGlob=(relPath,glob,opts)=>globToRegExp(glob,opts).test(String(relPath));function matchAny(relPath,globs,opts){if(!globs)return false;for(const g of Array.isArray(globs)?globs:[globs])if(g!==''&&g!=null&&matchGlob(relPath,g,opts))return true;return false;}
function excludedPath(p,exclude,opts){const segs=String(p).split('/');for(let k=1;k<=segs.length;k++)if(matchAny(segs.slice(0,k).join('/'),exclude,opts))return true;return false;}
function filterPaths(paths,{include=[],exclude=[]}={},opts){const inc=(Array.isArray(include)?include:[include]).filter((g)=>g!==''&&g!=null);const exc=(Array.isArray(exclude)?exclude:[exclude]).filter((g)=>g!==''&&g!=null);return paths.filter((p)=>(!inc.length||matchAny(p,inc,opts))&&!(exc.length&&excludedPath(p,exc,opts)));}
export{filterPaths};