import"../xlsx/cells.js";const CURRENCY='$€£¥₽₴₾₹₩₺₪₫฿';const reCache=new Map();function numRe(decimal){let re=reCache.get(decimal);if(re)return re;const D=decimal===','?',':'\\.';const G=decimal===','?"[. \\u00a0\\u202f']":"[, \\u00a0\\u202f']";re=new RegExp(`^(?:(\\d+)(?:${D}(\\d*))?|${D}(\\d+)|(\\d{1,3}(?:(${G})\\d{3})(?:\\5\\d{3})*)(?:${D}(\\d*))?|(\\d+(?:${D}\\d*)?|${D}\\d+)[eE]([-+]?\\d+))$`);reCache.set(decimal,re);return re;}
function parseNumber(text,decimal='.'){let s=String(text).trim();if(!s||s.length>40)return null;let neg=false,pct=false,cur='',curAfter=false;if(s[0]==='('&&s[s.length-1]===')'){neg=true;s=s.slice(1,-1).trim();}
if(s[0]==='-'||s[0]==='+'||s[0]==='−'){neg=neg!==(s[0]!=='+');s=s.slice(1).trim();}
if(s&&CURRENCY.includes(s[0])){cur=s[0];s=s.slice(1).trim();}
else if(s&&CURRENCY.includes(s[s.length-1])){cur=s[s.length-1];curAfter=true;s=s.slice(0,-1).trim();}
if(s[0]==='-'&&cur&&!neg){neg=true;s=s.slice(1).trim();}
if(s[s.length-1]==='%'){pct=true;s=s.slice(0,-1).trim();}
if(!s||(pct&&cur))return null;const m=numRe(decimal).exec(s);if(!m)return null;let core,dec=0,grouped=false;if(m[1]!=null){core=m[1]+(m[2]?'.'+m[2]:'');dec=m[2]?m[2].length:0;}
else if(m[3]!=null){core='0.'+m[3];dec=m[3].length;}
else if(m[4]!=null){core=m[4].split(m[5]).join('')+(m[6]?'.'+m[6]:'');dec=m[6]?m[6].length:0;grouped=true;}
else{core=m[7].replace(',','.')+'e'+m[8];dec=0;}
const digits=core.replace(/[^\d]/g,'').replace(/^0+/,'');if(digits.length>15&&!/e/.test(core))return null;let v=Number(core);if(!Number.isFinite(v))return null;if(neg)v=-v;if(pct)v/=100;return{v,pct,cur,curAfter,dec,grouped,lead0:/^0\d/.test(m[1]||'')};}
const TRUE_WORDS=new Set(['true','истина','істина','wahr','vrai','verdadero']);const FALSE_WORDS=new Set(['false','ложь','хибність','falsch','faux','falso']);function parseBool(text){const s=String(text).trim().toLowerCase();return TRUE_WORDS.has(s)?true:FALSE_WORDS.has(s)?false:null;}
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];const monthOf=(w)=>{const k=w.toLowerCase().slice(0,3);const i=MONTHS.indexOf(k==='sept'?'sep':k);return i<0||(w.length>3&&!/^(january|february|march|april|may|june|july|august|september|october|november|december|sept)\.?$/i.test(w))?-1:i+1;};const TIME='(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:[.,](\\d{1,6}))?)?\\s*([AaPp][Mm])?';const RE_ISO=new RegExp(`^(\\d{4})([-/.])(\\d{1,2})\\2(\\d{1,2})(?:(?:T|\\s+)${TIME})?(?:Z|[+-]\\d{2}:?\\d{2})?$`);const RE_NUM=new RegExp(`^(\\d{1,2})([-/.])(\\d{1,2})\\2(\\d{4}|\\d{2})(?:,?\\s+${TIME})?$`);const RE_DMONY=new RegExp(`^(\\d{1,2})[ -]([A-Za-z]{3,9})\\.?[ -](\\d{4}|\\d{2})(?:,?\\s+${TIME})?$`);const RE_MONDY=new RegExp(`^([A-Za-z]{3,9})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})(?:,?\\s+${TIME})?$`);const RE_TIME=new RegExp(`^${TIME}$`);const daysIn=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();const year2=(y)=>(y.length===2?(+y<30?2000+ +y:1900+ +y):+y);function timeParts(g,i){if(g[i]==null)return{hh:0,mm:0,ss:0,ms:0,time:false,secs:false};let hh=+g[i];const mm=+g[i+1],ss=g[i+2]?+g[i+2]:0;const ms=g[i+3]?Math.round(+('0.'+g[i+3])*1000):0;const ap=g[i+4]?g[i+4].toLowerCase():'';if(ap){if(hh<1||hh>12)return null;hh=(hh%12)+(ap==='pm'?12:0);}
if(hh>23||mm>59||ss>59)return null;return{hh,mm,ss,ms,time:true,secs:g[i+2]!=null};}
function mk(y,m,d,t,style){if(!t||m<1||m>12||d<1||y<1000||y>9999||d>daysIn(y,m))return null;return{y,m,d,...t,dateless:false,style};}
function parseDate(text,order='mdy'){const s=String(text).trim();if(s.length<4||s.length>40)return null;let g;if((g=RE_ISO.exec(s)))return mk(+g[1],+g[3],+g[4],timeParts(g,5),g[2]==='-'?'iso':'ymd'+g[2]);if((g=RE_NUM.exec(s))){const a=+g[1],b=+g[3],y=year2(g[4]);const dmy=g[2]==='.'||order==='dmy';return mk(y,dmy?b:a,dmy?a:b,timeParts(g,5),(dmy?'dmy':'mdy')+g[2]);}
if((g=RE_DMONY.exec(s))){const m=monthOf(g[2]);return m<0?null:mk(year2(g[3]),m,+g[1],timeParts(g,4),'dmon');}
if((g=RE_MONDY.exec(s))){const m=monthOf(g[1]);return m<0?null:mk(+g[3],m,+g[2],timeParts(g,4),'mond');}
if((g=RE_TIME.exec(s))){const t=timeParts(g,1);return t?{y:0,m:0,d:0,...t,dateless:true,style:'time'}:null;}
return null;}
export{parseNumber,parseDate,parseBool};