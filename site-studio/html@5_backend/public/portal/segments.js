import{escapeHTML}from"../html/escape.js";const TOKEN=/\x3C!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</g;const SKIP_TAGS=['a','code','pre','kbd','script','style','textarea','button','select','option','label','summary','h1','h2','h3','h4','h5','h6','svg','math','template','sup','dfn','abbr'];const VOID=new Set(['br','hr','img','input','wbr','meta','link','source','track','col','area','base','embed','param']);const ENT={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};function decodeText(s){return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(m,e)=>{if(e[0]==='#'){const n=e[1]==='x'||e[1]==='X'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);return Number.isFinite(n)&&n>0&&n<0x110000?String.fromCodePoint(n):m;}
const k=e.toLowerCase();return Object.prototype.hasOwnProperty.call(ENT,k)?ENT[k]:m;});}
function mapText(html,fn,{skip=SKIP_TAGS}={}){const skipSet=new Set(skip);const stack=[];let skipping=0;let out='';TOKEN.lastIndex=0;let m;const src=String(html==null?'':html);while((m=TOKEN.exec(src))){const tok=m[0];if(tok[0]==='<'&&m[1]){const name=m[1].toLowerCase();if(tok[1]==='/'){const i=stack.lastIndexOf(name);if(i>=0){for(let k=stack.length-1;k>=i;k--)if(skipSet.has(stack[k]))skipping--;stack.length=i;}}else if(!VOID.has(name)&&!/\/>$/.test(tok)){stack.push(name);if(skipSet.has(name))skipping++;}
out+=tok;continue;}
if(tok[0]==='<'){out+=tok==='<'?'&lt;':tok;continue;}
if(skipping>0||!/[\p{L}\p{N}]/u.test(tok)){out+=tok;continue;}
const r=fn(decodeText(tok));out+=r==null?tok:r;}
return out;}
function wrapSpans(text,spans){const s=String(text);const list=(spans||[]).filter((x)=>x&&x.end>x.start).sort((a,b)=>a.start-b.start||b.end-a.end);let out='';let pos=0;for(const sp of list){if(sp.start<pos)continue;out+=escapeHTML(s.slice(pos,sp.start))+sp.open+escapeHTML(s.slice(sp.start,sp.end))+sp.close;pos=sp.end;}
return out+escapeHTML(s.slice(pos));}
export{mapText,wrapSpans};