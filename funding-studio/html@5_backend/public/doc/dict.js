import{primary}from"../i18n/lang.js";import{pluralCat,interp}from"../i18n/intl.js";import{UI}from"./product.js";import{own}from"../util/value.js";function uiLookup(key,lang,doc){const fb=doc&&doc.output&&doc.output.uiFallback;for(const l of[lang,primary(lang),fb,'en']){if(!l)continue;const d=own(UI,l);if(d&&own(d,key)!=null)return[d[key],l];}
return[key,'en'];}
function uiText(key,lang,doc,vars){let[v,l]=uiLookup(key,lang,doc);if(v&&typeof v==='object'){const n=vars&&vars.n!=null?Number(vars.n):0;v=own(v,pluralCat(l,n))??own(v,'other')??'';}
return interp(String(v),vars);}
export{uiText,uiLookup};