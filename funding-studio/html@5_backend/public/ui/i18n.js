import{primary}from"../i18n/lang.js";import{lsGet,$$}from"./dom.js";import{canonLang}from"./lang.js";const ED_I18N={en:{}};const UI_STATE={lang:'en',storageKey:'ed-ui',titleKey:'app.name'};function addDicts(dicts){for(const[lang,d]of Object.entries(dicts))ED_I18N[lang]=Object.assign(ED_I18N[lang]||{},d);}
function humanize(key){const s=String(key);const tail=s.includes('.')&&!/\.\s*$/.test(s)?s.slice(s.indexOf('.')+1):s;const words=tail.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[-_]+/g,' ').trim();if(!words)return s;return words.charAt(0).toUpperCase()+words.slice(1).toLowerCase();}
const pluralRules=new Map();function pluralCat(lang,n){let pr=pluralRules.get(lang);if(!pr){try{pr=new Intl.PluralRules(lang);}catch{pr=null;}
pluralRules.set(lang,pr);}
try{return pr?pr.select(n):(n===1?'one':'other');}catch{return'other';}}
function t(key,vars){const ui=UI_STATE.lang;const pr=primary(ui);let s=ED_I18N[ui]?.[key],from=ui;if(s==null){s=ED_I18N[pr]?.[key];from=pr;}
if(s==null){s=ED_I18N.en[key];from='en';}
if(s==null){if(/^[a-z]/i.test(key)&&typeof window!=='undefined')(window.__edMissingKeys||=new Set()).add(key);s=humanize(key);}
if(s&&typeof s==='object'){const n=Number(vars?.n);const cat=Number.isFinite(n)?pluralCat(from,n):'other';s=s[cat]??s.other??Object.values(s)[0]??'';}
if(vars)s=String(s).replace(/\{(\w+)\}/g,(m,k)=>(vars[k]!=null?String(vars[k]):m));return s;}
function detectUILang(){const avail=Object.keys(ED_I18N);const saved=lsGet(UI_STATE.storageKey,null);if(saved&&avail.includes(saved))return saved;const prefs=(navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||'en']);for(const p of prefs){const c=canonLang(p);if(c&&avail.includes(c))return c;}
for(const p of prefs){const pr=String(p).toLowerCase().split('-')[0];if(avail.includes(pr))return pr;}
return'en';}
function pickUI(o){if(!o)return'';if(typeof o==='string')return o;const ui=UI_STATE.lang;return o[ui]||o[ui.split('-')[0]]||o.en||Object.values(o).find((v)=>v)||'';}
function applyStaticI18n(root=document){if(root===document)document.title=t(UI_STATE.titleKey);for(const el of $$('[data-i18n]',root))el.textContent=t(el.dataset.i18n);for(const el of $$('[data-i18n-title]',root))el.title=t(el.dataset.i18nTitle);for(const el of $$('[data-i18n-aria]',root))el.setAttribute('aria-label',t(el.dataset.i18nAria));for(const el of $$('[data-i18n-ph]',root))el.setAttribute('placeholder',t(el.dataset.i18nPh));}
export{UI_STATE,addDicts,t,detectUILang,applyStaticI18n,ED_I18N,pickUI};