const SEG_BAD=/[\u0000-\u001f\u007f]/g;function normPath(s){const out=[];for(const seg of String(s==null?'':s).replace(/\\/g,'/').split('/')){if(seg===''||seg==='.')continue;if(seg==='..'){out.pop();continue;}
out.push(seg.replace(SEG_BAD,''));}
return out.join('/');}
function slugify(text,{lower=true,slash=false,max=96,fallback='page'}={}){let s=String(text==null?'':text).normalize('NFC');if(lower)s=s.toLowerCase();const parts=(slash?s.split('/'):[s]).map((p)=>p.replace(/['’ʼ`]/g,'').replace(/[^\p{L}\p{M}\p{N}_.-]+/gu,'-').replace(/\.{2,}/g,'.').replace(/-{2,}/g,'-').replace(/^[-.]+|[-.]+$/g,'')).filter(Boolean);let out=parts.join('/');if(out.length>max)out=out.slice(0,max).replace(/[-./]+$/,'');return out||fallback;}
const enc=(s)=>encodeURIComponent(s).replace(/%20/g,'+');const dec=(s)=>{try{return decodeURIComponent(String(s).replace(/\+/g,' '));}catch{return String(s);}};function parseQuery(q){const out={};const s=String(q==null?'':q).replace(/^\?/,'');if(!s)return out;for(const part of s.split('&')){if(!part)continue;const i=part.indexOf('=');const k=dec(i<0?part:part.slice(0,i));if(!k||k==='__proto__')continue;out[k]=i<0?'':dec(part.slice(i+1));}
return out;}
function formatQuery(obj){const parts=[];for(const[k,v]of Object.entries(obj||{})){if(v==null||v===false)continue;parts.push(v===''||v===true?enc(k):enc(k)+'='+enc(String(v)));}
return parts.join('&');}
function encodePath(path){return normPath(path).split('/').map((seg)=>encodeURIComponent(seg)).join('/');}
function decodePath(path){return normPath(String(path==null?'':path).split('/').map((seg)=>{try{return decodeURIComponent(seg);}catch{return seg;}}).join('/'));}
function splitRoute(s){let str=String(s==null?'':s);let frag='';const h=str.indexOf('#');if(h>=0){frag=str.slice(h+1);str=str.slice(0,h);}
let query={};const q=str.indexOf('?');if(q>=0){query=parseQuery(str.slice(q+1));str=str.slice(0,q);}
let f=frag;try{f=decodeURIComponent(frag);}catch{}
return{path:decodePath(str),query,frag:f};}
export{slugify,normPath,encodePath,splitRoute,formatQuery,parseQuery};