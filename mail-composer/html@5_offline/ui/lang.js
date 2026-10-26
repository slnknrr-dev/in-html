import{langName}from"../i18n/lang.js";import"../i18n/intl.js";import"../util/value.js";import"./i18n.js";function canonLang(code){try{return Intl.getCanonicalLocales(String(code).trim().replace(/_/g,'-'))[0]||null;}catch{return null;}}
function langLabel(code){try{return langName(code,'native')||code;}catch{return code;}}
export{canonLang,langLabel};