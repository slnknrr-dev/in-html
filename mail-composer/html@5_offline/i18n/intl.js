import{primary}from"./lang.js";const intlOKCache=new Map();function intlSupports(kind,lang){const key=kind+'|'+lang;let ok=intlOKCache.get(key);if(ok==null){try{const p=primary(lang).toLowerCase();ok=Intl[kind].supportedLocalesOf([lang]).some((l)=>primary(l).toLowerCase()===p);}catch(e){ok=false;}
if(intlOKCache.size<512)intlOKCache.set(key,ok);}
return ok;}
export{intlSupports};