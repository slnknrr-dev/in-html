import{CellError,ERR}from"../xlsx/cells.js";import{parseNumber,parseDate,dateSerial}from"../csv/infer.js";class Ref{constructor(s,r1,c1,r2,c2){this.s=s;this.r1=r1;this.c1=c1;this.r2=r2;this.c2=c2;}
get h(){return this.r2-this.r1+1;}
get w(){return this.c2-this.c1+1;}
get single(){return this.r1===this.r2&&this.c1===this.c2;}}
const isErr=(v)=>v instanceof CellError;const isMatrix=(v)=>Array.isArray(v);function numToText(n){if(!Number.isFinite(n))return'#NUM!';if(Number.isInteger(n)&&Math.abs(n)<1e15)return String(n);const p=Number(n.toPrecision(15));const a=Math.abs(p);if(a!==0&&(a<1e-9||a>=1e21)){const[m,e]=p.toExponential().split('e');return m+'E'+(+e<0?'-':'+')+String(Math.abs(+e)).padStart(2,'0');}
let s=String(p);if(/e/.test(s))s=p.toFixed(Math.min(20,15-Math.floor(Math.log10(a)))).replace(/\.?0+$/,'');return s;}
const round15=(n)=>(n===0||!Number.isFinite(n)?n:Number(n.toPrecision(15)));function textToNumber(s){const t=String(s).trim();if(!t)return null;const n=parseNumber(t,'.');if(n)return n.v;const d=parseDate(t,'mdy');return d?dateSerial(d):null;}
function toNumber(v){if(typeof v==='number')return v;if(v==null)return 0;if(typeof v==='boolean')return v?1:0;if(v instanceof CellError)return v;if(typeof v==='string'){const n=textToNumber(v);return n===null?ERR.VALUE:n;}
return ERR.VALUE;}
function toText(v){if(typeof v==='string')return v;if(v==null)return'';if(typeof v==='number')return numToText(v);if(typeof v==='boolean')return v?'TRUE':'FALSE';if(v instanceof CellError)return v;return String(v);}
function toBool(v){if(typeof v==='boolean')return v;if(v==null)return false;if(typeof v==='number')return v!==0;if(v instanceof CellError)return v;const s=String(v).trim().toUpperCase();if(s==='TRUE')return true;if(s==='FALSE')return false;return ERR.VALUE;}
const RANK=(v)=>(typeof v==='number'?0:typeof v==='string'?1:typeof v==='boolean'?2:3);const collator=typeof Intl!=='undefined'?new Intl.Collator(undefined,{sensitivity:'accent',numeric:false}):null;const compareText=(a,b)=>{const x=a.toLowerCase(),y=b.toLowerCase();if(x===y)return 0;return collator?Math.sign(collator.compare(x,y))||(x<y?-1:1):x<y?-1:1;};function compare(a,b){if(a==null&&b==null)return 0;if(a==null)a=typeof b==='string'?'':typeof b==='boolean'?false:0;if(b==null)b=typeof a==='string'?'':typeof a==='boolean'?false:0;const ra=RANK(a),rb=RANK(b);if(ra!==rb)return ra<rb?-1:1;if(ra===0){const x=round15(a),y=round15(b);return x<y?-1:x>y?1:0;}
if(ra===1)return compareText(a,b);if(ra===2)return a===b?0:a?1:-1;return 0;}
function equals(a,b){if(typeof a==='string'&&typeof b==='string')return a.toLowerCase()===b.toLowerCase();return compare(a,b)===0;}
const wcCache=new Map();function wildcardRe(pattern){let re=wcCache.get(pattern);if(re)return re;let s='';for(let i=0;i<pattern.length;i++){const ch=pattern[i];if(ch==='~'&&i+1<pattern.length){s+=pattern[++i].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');continue;}
s+=ch==='*'?'[\\s\\S]*':ch==='?'?'[\\s\\S]':ch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
re=new RegExp('^'+s+'$','i');if(wcCache.size>200)wcCache.clear();wcCache.set(pattern,re);return re;}
const hasWildcard=(s)=>/[*?~]/.test(s);const cmpOp=(op,c)=>(op==='<'?c<0:op==='>'?c>0:op==='<='?c<=0:c>=0);function makeCriteria(crit){if(crit instanceof CellError)return(v)=>v===crit;if(typeof crit==='number'){const c=round15(crit);return(v)=>(typeof v==='number'?round15(v)===c:typeof v==='string'&&textToNumber(v)===crit);}
if(typeof crit==='boolean')return(v)=>v===crit;if(crit==null)return(v)=>v==null||v==='';const m=/^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(String(crit));const op=m[1]||'=';const rest=m[2];let num=null;const pn=parseNumber(rest,'.');if(pn)num=pn.v;else{const d=parseDate(rest,'mdy');if(d)num=dateSerial(d);}
const upper=rest.toUpperCase();const bool=upper==='TRUE'?true:upper==='FALSE'?false:null;if(num!==null){const c=round15(num);const test={'=':(x)=>x===c,'<>':(x)=>x!==c,'<':(x)=>x<c,'>':(x)=>x>c,'<=':(x)=>x<=c,'>=':(x)=>x>=c}[op];return(v)=>{if(typeof v==='number')return test(round15(v));if(op==='='&&typeof v==='string')return textToNumber(v)===num;return op==='<>';};}
if(bool!==null){if(op==='=')return(v)=>v===bool;if(op==='<>')return(v)=>v!==bool;return(v)=>typeof v==='boolean'&&cmpOp(op,compare(v,bool));}
if(op==='='||op==='<>'){let test;if(rest==='')test=(v)=>v==null||v==='';else if(hasWildcard(rest)){const re=wildcardRe(rest);test=(v)=>typeof v==='string'&&re.test(v);}
else{const lo=rest.toLowerCase();test=(v)=>typeof v==='string'&&v.toLowerCase()===lo;}
return op==='='?test:(v)=>!test(v);}
return(v)=>{if(typeof v!=='string')return false;return cmpOp(op,compareText(v,rest));};}
export{Ref,isMatrix,toNumber,isErr,toText,toBool,compare,round15,textToNumber,makeCriteria,wildcardRe,hasWildcard,equals,numToText};