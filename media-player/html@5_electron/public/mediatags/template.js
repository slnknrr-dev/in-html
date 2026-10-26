const NUMERIC=new Set(['track','disc','season','episode','absolute','year','part','chapter','volume','seriesPart','trackTotal','discTotal','index']);const DECIMAL=new Set(['episode','absolute','part','chapter','volume','seriesPart']);const escRe=(s)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const safeSegment=(v)=>String(v).replace(/[\\/]/g,'-').replace(/[<>:"|?*]/g,'_').replace(/[\u0000-\u001f]/g,'').trim();function tokenize(tpl){const out=[];let lit='';const flush=()=>{if(lit){out.push({lit});lit='';}};for(let i=0;i<tpl.length;){const c=tpl[i];if(c==='{'&&tpl[i+1]==='{'){lit+='{';i+=2;continue;}
if(c==='}'&&tpl[i+1]==='}'){lit+='}';i+=2;continue;}
if(c==='{'){const e=tpl.indexOf('}',i);if(e<0)throw new Error(`template: unclosed { at ${i}`);const body=tpl.slice(i+1,e).trim();const m=/^([A-Za-z_][\w]*)(\?)?(?::(0*\d+))?(\?)?$/.exec(body);if(!m)throw new Error(`template: bad field {${body}}`);flush();const name=m[1];out.push({field:name,pad:m[3]?+m[3]:0,optional:!!(m[2]||m[4]),ignore:name==='_'||name==='ignore'});i=e+1;continue;}
if(c==='*'){flush();if(tpl[i+1]==='*'){out.push({globstar:true,slash:tpl[i+2]==='/'});i+=tpl[i+2]==='/'?3:2;}
else{out.push({star:true});i++;}
continue;}
lit+=c;i++;}
flush();return out;}
const SEP=/[\s\-_.,;–—]+/;function sepSplit(text,side){if(side==='prefix'){const m=new RegExp(`(${SEP.source})$`).exec(text);return m?[text.slice(0,m.index),m[1]]:[text,''];}
const m=new RegExp(`^(${SEP.source})`).exec(text);return m?[m[1],text.slice(m[1].length)]:['',text];}
function compileTemplate(tpl){const source=String(tpl);const anchored=source.startsWith('/');const tokens=tokenize(anchored?source.slice(1):source);const parts=[];for(let i=0;i<tokens.length;i++){const t=tokens[i];if(t.field&&t.optional){const next=tokens[i+1],prev=parts[parts.length-1];if(next&&next.lit!=null){const[sep,rest]=sepSplit(next.lit,'suffix');if(sep&&rest!==undefined){parts.push({...t,sepAfter:sep});tokens[i+1]={lit:rest};continue;}}
if(prev&&prev.lit!=null){const[rest,sep]=sepSplit(prev.lit,'prefix');if(sep){prev.lit=rest;parts.push({...t,sepBefore:sep});continue;}}}
parts.push(t);}
const fields=[];const groups=[];let rx=anchored?'^':'(?:^|/)';const fieldRe=(t)=>{if(t.field==='ext')return'[^/.]+';if(t.field==='year')return'\\d{4}';if(NUMERIC.has(t.field))return DECIMAL.has(t.field)&&!t.pad?'\\d+(?:\\.\\d+)?':'\\d+';return'[^/]+?';};for(const t of parts){if(t.lit!=null){rx+=escRe(t.lit);continue;}
if(t.star){rx+='[^/]*';continue;}
if(t.globstar){rx+=t.slash?'(?:[^/]+/)*':'.*';continue;}
let g;if(t.ignore)g=`(?:${fieldRe(t)})`;else{if(!fields.includes(t.field))fields.push(t.field);groups.push(t.field);g=`(${fieldRe(t)})`;}
if(t.optional){const before=t.sepBefore?escRe(t.sepBefore):'',after=t.sepAfter?escRe(t.sepAfter):'';rx+=`(?:${before}${g}${after})?`;}else rx+=g;}
rx+='$';const regex=new RegExp(rx,'i');function match(relPath){const p=String(relPath||'').replace(/\\/g,'/').replace(/^\.?\/+/,'');const m=regex.exec(p);if(!m)return null;const out={};for(let i=0;i<groups.length;i++){const raw=m[i+1];if(raw==null)continue;const name=groups[i];const v=NUMERIC.has(name)?Number(raw):raw.trim();if(name in out){const same=typeof v==='number'?out[name]===v:String(out[name]).toLowerCase()===String(v).toLowerCase();if(!same)return null;}else out[name]=v;}
return out;}
function format(values={}){let s='';for(const t of parts){if(t.lit!=null){s+=t.lit;continue;}
if(t.star||t.ignore)continue;if(t.globstar)continue;const v=values[t.field];const missing=v==null||v==='';if(missing){if(t.optional)continue;throw new Error(`template: missing value for {${t.field}}`);}
let txt=typeof v==='number'&&t.pad?String(Math.trunc(v)).padStart(t.pad,'0')+(Number.isInteger(v)?'':String(v).replace(/^\d+/,'')):String(v);if(t.pad&&typeof v!=='number'&&/^\d+$/.test(txt))txt=txt.padStart(t.pad,'0');s+=(t.sepBefore||'')+safeSegment(txt)+(t.sepAfter||'');}
return s.replace(/\/{2,}/g,'/');}
return{source,fields,anchored,regex,match,format};}
export{compileTemplate};