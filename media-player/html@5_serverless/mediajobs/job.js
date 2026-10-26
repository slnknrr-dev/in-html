function makeStep({tool,argv=[],groups=null,comment='',files=null,capture=null,parse=null,progress=null,duration=null}={}){const list=argv.filter((a)=>a!=null&&a!==false).map((a)=>(typeof a==='number'?a:String(a)));const ok=Array.isArray(groups)&&groups.every((n)=>Number.isInteger(n)&&n>0)&&groups.reduce((a,b)=>a+b,0)===list.length;return{tool,argv:list,groups:ok?groups:null,comment:String(comment||''),files:files&&Object.keys(files).length?{...files}:{},capture:capture||null,parse:parse||null,progress:progress||null,duration:Number.isFinite(+duration)&&+duration>0?+duration:null,};}
function makeJob(kind,title,steps,outputs=[],extra={}){const spec={kind,title:String(title||kind),steps,outputs:outputs.filter(Boolean).map(String)};for(const[k,v]of Object.entries(extra))if(v!=null&&!(Array.isArray(v)&&!v.length))spec[k]=v;return spec;}
class Args{constructor(){this.list=[];}
add(...words){const g=words.flat().filter((w)=>w!=null&&w!==false).map(String);if(g.length)this.list.push(g);return this;}
addIf(cond,...words){return cond?this.add(...words):this;}
opt(flag,value){return value==null||value===''?this:this.add(flag,value);}
get argv(){return this.list.flat();}
get groups(){return this.list.map((g)=>g.length);}
step(fields={}){return makeStep({...fields,argv:this.argv,groups:this.groups});}}
function varStep(spec,name){const ns=String(name).split('.')[0];return(spec?.steps||[]).findIndex((s)=>s.parse===ns);}
function usesWork(spec){return(spec?.steps||[]).some((s)=>(s.files&&Object.keys(s.files).length)||(s.argv||[]).some((a)=>String(a).includes('{work}')));}
function parseTime(x){if(x==null||x==='')return null;if(typeof x==='number')return Number.isFinite(x)?x:null;const s=String(x).trim();if(/^-?\d+(\.\d+)?$/.test(s))return+s;const m=/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(s);if(!m)return null;return(+(m[1]||0))*3600+(+m[2])*60+(+m[3]);}
const RESERVED=/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i;const utf8Len=(s)=>{let n=0;for(const c of s){const k=c.codePointAt(0);n+=k<0x80?1:k<0x800?2:k<0x10000?3:4;}return n;};function cutBytes(s,max){let out='',n=0;for(const c of s){const k=c.codePointAt(0);const b=k<0x80?1:k<0x800?2:k<0x10000?3:4;if(n+b>max)break;out+=c;n+=b;}
return out;}
function fileSafe(name,{maxBytes=200,replacement='_'}={}){let s=String(name??'').normalize('NFC').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/[<>:"/\\|?*]/g,replacement).replace(/\s+/g,' ').trim().replace(/[. ]+$/,'');if(RESERVED.test(s))s=replacement+s;if(!s||/^\.+$/.test(s))s=replacement;if(utf8Len(s)>maxBytes){const m=/(\.[A-Za-z0-9]{1,8})$/.exec(s);const ext=m?m[1]:'';s=cutBytes(s.slice(0,s.length-ext.length),maxBytes-ext.length).replace(/[. ]+$/,'')+ext;}
return s;}
function joinPath(dir,name){if(dir==null||dir==='')return String(name);const d=String(dir);if(/[\\/]$/.test(d))return d+name;const sep=d.includes('\\')&&!d.includes('/')?'\\':'/';return d+sep+name;}
const baseName=(p)=>String(p??'').split(/[\\/]/).pop();function extOf(p){const b=baseName(p);const i=b.lastIndexOf('.');return i>0?b.slice(i+1).toLowerCase():'';}
const argPath=(p)=>(/^-/.test(String(p))?'./'+p:String(p));function plainText(s,max=120){const t=String(s??'').replace(/[&|<>^%!"\\\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim();return t.length>max?t.slice(0,max-1)+'…':t;}
function hashId(value){let s;try{s=JSON.stringify(value)??'';}catch{s=String(value);}
let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193);}
return(h>>>0).toString(16).padStart(8,'0');}
export{Args,makeJob,hashId,varStep,plainText,usesWork,extOf,parseTime,baseName,argPath,fileSafe,joinPath};