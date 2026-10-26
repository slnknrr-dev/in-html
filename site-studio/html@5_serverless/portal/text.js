import{escapeHTML}from"../html/escape.js";const MARKS=/[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;function fold(s){let t=String(s==null?'':s);try{t=t.normalize('NFKD');}catch{}
return t.replace(MARKS,'').toLowerCase().replace(/ё/g,'е').replace(/ß/g,'ss').replace(/\s+/g,' ').trim();}
const WORD_RE=/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;function words(s){return(fold(s).match(WORD_RE)||[]).map((w)=>w.replace(/['’-]+$/g,'')).filter(Boolean);}
function terms(q){return[...new Set(words(q))];}
const CYR_KA_END=/[аеёиоуыэюяіїєйьიაეოუ]{1,2}$/;const PLURAL_TAIL=new Set(['','s','es']);function stemOf(w){const s=String(w||'');if(s.length<5)return s;if(CYR_KA_END.test(s))return s.replace(CYR_KA_END,'').length>=4?s.replace(CYR_KA_END,''):s.slice(0,-1);return s.replace(/(?:es|s|e)$/,'');}
function stemEq(a,b){if(a===b)return true;if(!a||!b)return false;const short=a.length<=b.length?a:b;const l=short===a?b:a;if(short.length<3)return false;if(short.length<4)return l.startsWith(short)&&PLURAL_TAIL.has(l.slice(short.length));const s=stemOf(short);if(!l.startsWith(s))return false;return l.length-s.length<=(s.length>=6?7:5);}
function foldMap(s){const src=String(s==null?'':s);let out='';const map=[];for(let i=0;i<src.length;){const cp=src.codePointAt(i);const ch=String.fromCodePoint(cp);let f=ch;try{f=ch.normalize('NFKD');}catch{}
f=f.replace(MARKS,'').toLowerCase().replace(/ё/g,'е').replace(/ß/g,'ss');for(let k=0;k<f.length;k++)map.push(i);out+=f;i+=ch.length;}
map.push(src.length);return{text:out,map};}
function highlight(text,ts,{max=220}={}){const s=String(text==null?'':s0(text));if(!s)return'';const list=(ts||[]).filter(Boolean);const full=foldMap(s);let first=-1;for(const t of list){const i=full.text.indexOf(t);if(i>=0&&(first<0||i<first))first=i;}
let start=0;if(first>60&&s.length>max)start=full.map[first-50]||0;let end=Math.min(s.length,start+max);if(start>0){const sp=s.indexOf(' ',start);if(sp>0&&sp-start<20)start=sp+1;}
if(end<s.length){const sp=s.lastIndexOf(' ',end);if(sp>start+max/2)end=sp;}
const part=s.slice(start,end);const pf=foldMap(part);const marks=[];for(const t of list){let i=pf.text.indexOf(t);while(i>=0&&marks.length<60){marks.push([pf.map[i],pf.map[i+t.length]]);i=pf.text.indexOf(t,i+t.length);}}
marks.sort((x,y)=>x[0]-y[0]);let html='';let pos=0;for(const[x,y]of marks){if(x<pos)continue;html+=escapeHTML(part.slice(pos,x))+'<mark>'+escapeHTML(part.slice(x,y))+'</mark>';pos=y;}
html+=escapeHTML(part.slice(pos));return(start>0?'… ':'')+html+(end<s.length?' …':'');}
const s0=(v)=>(typeof v==='string'?v:String(v));function excerpt(text,n=160){const s=String(text==null?'':text).replace(/\s+/g,' ').trim();if(s.length<=n)return s;const cut=s.slice(0,n);const sp=cut.lastIndexOf(' ');return(sp>n*0.6?cut.slice(0,sp):cut).replace(/[,;:.\s]+$/,'')+'…';}
const TR={а:'a',б:'b',в:'v',г:'g',ґ:'g',д:'d',е:'e',є:'ye',ж:'zh',з:'z',и:'i',і:'i',ї:'yi',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',ა:'a',ბ:'b',გ:'g',დ:'d',ე:'e',ვ:'v',ზ:'z',თ:'t',ი:'i',კ:'k',ლ:'l',მ:'m',ნ:'n',ო:'o',პ:'p',ჟ:'zh',რ:'r',ს:'s',ტ:'t',უ:'u',ფ:'p',ქ:'k',ღ:'gh',ყ:'q',შ:'sh',ჩ:'ch',ც:'ts',ძ:'dz',წ:'ts',ჭ:'ch',ხ:'kh',ჯ:'j',ჰ:'h',};function slugId(s,fallback='x'){const f=fold(s);let out='';for(const ch of f)out+=Object.prototype.hasOwnProperty.call(TR,ch)?TR[ch]:ch;out=out.replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48).replace(/-+$/g,'');return out||fallback;}
function splitList(s){const out=[];const seen=new Set();for(const x of String(s==null?'':s).split(/[,;\n]+/)){const v=x.trim();const k=fold(v);if(v&&!seen.has(k)){seen.add(k);out.push(v);}}
return out;}
export{fold,slugId,words,stemEq,stemOf,WORD_RE,splitList,excerpt,terms,highlight};