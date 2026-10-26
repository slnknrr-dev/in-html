const SEG_BAD=/[\u0000-\u001f\u007f]/g;function normPath(s){const out=[];for(const seg of String(s==null?'':s).replace(/\\/g,'/').split('/')){if(seg===''||seg==='.')continue;if(seg==='..'){out.pop();continue;}
out.push(seg.replace(SEG_BAD,''));}
return out.join('/');}
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
function formatRoute(r){const route=typeof r==='string'?splitRoute(r):r||{};const q=formatQuery(route.query);return encodePath(route.path||'')+(q?'?'+q:'')+(route.frag?'#'+encodeURIComponent(route.frag):'');}
function hashRoute(hash){const s=String(hash==null?'':hash).replace(/^#/,'');if(s===''||s==='/')return{path:'',query:{},frag:''};if(s[0]!=='/'&&s[0]!=='?')return null;return splitRoute(s[0]==='?'?s:s.slice(1));}
function routeHash(r){return'#/'+formatRoute(r);}
export{normPath,encodePath,decodePath,splitRoute,hashRoute,parseQuery,formatQuery,routeHash,formatRoute};