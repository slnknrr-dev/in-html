const cleanKey=(v)=>{const s=String(v??'').trim().toLowerCase();return/^[a-z][a-z0-9_]{0,39}$/.test(s)?s:'';};const cleanFieldKey=(v)=>{const s=typeof v==='string'?v.trim():'';return/^[\p{L}\p{N}_]{1,64}$/u.test(s)?s:'';};function i18n(v,max=200,defLang='en'){const out={};if(typeof v==='string'){const s=v.trim().slice(0,max);if(s)out[defLang]=s;return out;}
if(!v||typeof v!=='object'||Array.isArray(v))return out;for(const[k,x]of Object.entries(v)){if(!/^[a-z]{2}$/.test(k)||x==null||typeof x==='object')continue;const s=String(x).trim().slice(0,max);if(s)out[k]=s;}
return out;}
function pick(labels,lang='en',fallbacks=['en']){if(!labels||typeof labels!=='object')return typeof labels==='string'?labels:'';if(labels[lang])return labels[lang];for(const f of fallbacks)if(labels[f])return labels[f];return Object.values(labels).find((x)=>typeof x==='string'&&x)||'';}
function slugList(v,cap=20){const raw=Array.isArray(v)?v:String(v??'').split(',');const out=[];for(const x of raw){const s=String(x??'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,40);if(s&&!out.includes(s))out.push(s);if(out.length>=cap)break;}
return out;}
export{cleanKey,i18n,cleanFieldKey,slugList,pick};