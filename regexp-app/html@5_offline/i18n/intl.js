import{primary}from"./lang.js";const intlCache=new Map();function intl(kind,lang,opts){const key=kind+'|'+lang+'|'+JSON.stringify(opts||{});let f=intlCache.get(key);if(!f){const C=Intl[kind];try{f=new C(lang,opts);}catch(e){f=new C('en',opts);}
if(intlCache.size<512)intlCache.set(key,f);}
return f;}
const intlOKCache=new Map();function intlSupports(kind,lang){const key=kind+'|'+lang;let ok=intlOKCache.get(key);if(ok==null){try{const p=primary(lang).toLowerCase();ok=Intl[kind].supportedLocalesOf([lang]).some((l)=>primary(l).toLowerCase()===p);}catch(e){ok=false;}
if(intlOKCache.size<512)intlOKCache.set(key,ok);}
return ok;}
export{intlSupports,intl};