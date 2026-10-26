import{primary}from"./lang.js";const intlCache=new Map();function intl(kind,lang,opts){const key=kind+'|'+lang+'|'+JSON.stringify(opts||{});let f=intlCache.get(key);if(!f){const C=Intl[kind];try{f=new C(lang,opts);}catch(e){f=new C('en',opts);}
if(intlCache.size<512)intlCache.set(key,f);}
return f;}
const intlOKCache=new Map();function intlSupports(kind,lang){const key=kind+'|'+lang;let ok=intlOKCache.get(key);if(ok==null){try{const p=primary(lang).toLowerCase();ok=Intl[kind].supportedLocalesOf([lang]).some((l)=>primary(l).toLowerCase()===p);}catch(e){ok=false;}
if(intlOKCache.size<512)intlOKCache.set(key,ok);}
return ok;}
function pluralCat(lang,n){try{return intl('PluralRules',lang).select(n);}catch(e){return n===1?'one':'other';}}
function interp(s,vars){if(!vars)return s;return s.replace(/\{(\w+)\}/g,(m,k)=>(vars[k]!=null?String(vars[k]):m));}
export{intlSupports,intl,pluralCat,interp};