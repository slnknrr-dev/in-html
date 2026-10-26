const META_KEYS=['ti','ar','al','au','lr','by','length','offset','re','ve','la','id','tool','#'];const WORD=/<(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)>/;const r3=(x)=>Math.round(x*1000)/1000;function parseStamp(s){let m=/^(\d{1,3}):(\d{1,2})(?:([.:])(\d{1,3}))?$/.exec(s.trim());if(m){const frac=m[4]?+m[4]/10**m[4].length:0;return+m[1]*60+ +m[2]+frac;}
m=/^(\d{1,2}):(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(s.trim());if(m)return+m[1]*3600+ +m[2]*60+ +m[3]+ +m[4]/10**m[4].length;return null;}
function metaOf(body){const m=/^\s*([A-Za-z#]{1,8})\s*:(.*)$/.exec(body);if(!m)return null;const key=m[1];if(!META_KEYS.includes(key.toLowerCase())&&key!==key.toLowerCase())return null;return[key.toLowerCase(),m[2].trim()];}
function parseLrc(text){const src=String(text||'').replace(/^﻿/,'').split(/\r\n|\r|\n/);const meta={};const timed=[];const plain=[];let seq=0;for(const raw of src){let rest=raw;const times=[];let isMeta=false;for(;;){const m=/^\s*\[([^\]]*)\]/.exec(rest);if(!m)break;const t=parseStamp(m[1]);if(t!=null){times.push(t);rest=rest.slice(m[0].length);continue;}
if(!times.length){const kv=metaOf(m[1]);if(kv){meta[kv[0]]=kv[0]==='offset'?Number(kv[1])||0:kv[1];isMeta=true;rest=rest.slice(m[0].length);continue;}}
break;}
if(isMeta&&!times.length)continue;rest=rest.replace(/\s+$/,'');if(!times.length){plain.push(rest.trim());continue;}
let words=null,textOut=rest.trim();if(WORD.test(rest)){const parts=rest.split(new RegExp(WORD.source,'g'));words=[];const pre=parts[0].replace(/^\s+/,'');if(pre)words.push({time:null,text:pre});for(let i=1;i<parts.length;i+=2)words.push({time:parseStamp(parts[i]),text:parts[i+1]});textOut=words.map((w)=>w.text).join('').trim();}
for(const t of times)timed.push({stamp:t,text:textOut,words:times.length===1?words:null,seq:seq++});}
const off=(meta.offset||0)/1000;if(!timed.length){while(plain.length&&!plain[plain.length-1])plain.pop();while(plain.length&&!plain[0])plain.shift();return{meta,lines:plain.map((t)=>({time:null,text:t,words:null})),synced:false};}
timed.sort((a,b)=>a.stamp-b.stamp||a.seq-b.seq);const lines=timed.map((x)=>{const time=r3(x.stamp-off);const words=x.words?x.words.map((w)=>({time:w.time==null?time:r3(w.time-off),text:w.text})):null;return{time,text:x.text,words};});return{meta,lines,synced:true};}
function stamp(t){const ms=Math.max(0,Math.round(t*1000));const mm=Math.floor(ms/60000),ss=Math.floor(ms/1000)%60,f=ms%1000;const frac=f%10===0?String(f/10).padStart(2,'0'):String(f).padStart(3,'0');return`${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}.${frac}`;}
function serializeLrc(lrc,{enhanced=true}={}){const meta=lrc.meta||{};const out=[];const keys=[...META_KEYS.filter((k)=>k in meta),...Object.keys(meta).filter((k)=>!META_KEYS.includes(k))];for(const k of keys){const v=meta[k];if(v==null||v==='')continue;out.push(`[${k}:${v}]`);}
const off=(Number(meta.offset)||0)/1000;for(const line of lrc.lines||[]){if(line.time==null||!lrc.synced){out.push(line.text||'');continue;}
const body=enhanced&&line.words&&line.words.length?line.words.map((w)=>`<${stamp((w.time??line.time)+off)}>${w.text}`).join(''):line.text||'';out.push(`[${stamp(line.time+off)}]${body}`);}
return out.join('\n')+'\n';}
function lineAt(lrc,t){const lines=lrc.lines||[];if(!lrc.synced||!lines.length)return-1;let lo=0,hi=lines.length-1,ans=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(lines[mid].time!=null&&lines[mid].time<=t){ans=mid;lo=mid+1;}else hi=mid-1;}
return ans;}
function wordAt(line,t){const words=line&&line.words;if(!words||!words.length)return-1;let ans=-1;for(let i=0;i<words.length;i++){if(words[i].time<=t)ans=i;else break;}
return ans;}
function plainLyrics(lrc){return(lrc.lines||[]).map((l)=>l.text).join('\n');}
function isLrc(text){const lines=String(text||'').split(/\r\n|\r|\n/).map((s)=>s.trim()).filter(Boolean);let timed=0,other=0;for(const l of lines){const m=/^\[([^\]]*)\]/.exec(l);if(m&&parseStamp(m[1])!=null)timed++;else if(!(m&&metaOf(m[1])))other++;}
return timed>0&&timed>=other;}
export{isLrc,plainLyrics,parseLrc,serializeLrc,lineAt,wordAt};