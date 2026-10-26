import{nextId,normalizeMedia,mediaMap,normalizeClip,normalizeAudioClip,normalizeItem,layout,MIN_LEN,isStill,clampView,kenBurnsAt}from"./model.js";const r3=(v)=>Math.round(v*1000)/1000;const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));const copy=(o)=>JSON.parse(JSON.stringify(o));const endOf=(x)=>(x.end!=null?x.end:x.start+(x.out-x.in));function find(p,id){for(const list of['main','overlays','audio']){const i=p[list].findIndex((x)=>x.id===id);if(i>=0)return{list,index:i,item:p[list][i]};}
return null;}
function addMedia(p,info){const id=typeof info.id==='string'&&!p.media.some((m)=>m.id===info.id)&&!find(p,info.id)?info.id:nextId(p,'m');const m=normalizeMedia({...info,id});if(m)p.media.push(m);return m;}
function addClip(p,mediaId,{index,duration=3}={}){const m=mediaMap(p).get(mediaId);if(!m||m.kind==='audio')return null;const c=normalizeClip({id:nextId(p,'c'),in:0,out:m.kind==='image'?duration:m.duration},m);p.main.splice(index==null?p.main.length:clamp(index,0,p.main.length),0,c);return c;}
function freeRow(items,start,end,prefer=0,ignoreId=null){const busy=(row)=>items.some((o)=>o.id!==ignoreId&&o.row===row&&o.start<end-1e-6&&endOf(o)>start+1e-6);if(!busy(prefer))return prefer;for(let r=0;r<32;r++)if(!busy(r))return r;return prefer;}
function addAudio(p,mediaId,start=0,row=0){const m=mediaMap(p).get(mediaId);if(!m?.hasAudio)return null;const c=normalizeAudioClip({id:nextId(p,'a'),start,in:0,out:m.duration},m);c.row=freeRow(p.audio,c.start,endOf(c),row);p.audio.push(c);return c;}
function addOverlay(p,item){const it=normalizeItem({...item,id:nextId(p,'o')},mediaMap(p));if(!it)return null;it.row=freeRow(p.overlays,it.start,it.end,item.row??0);p.overlays.push(it);return it;}
function split(p,id,t){const f=find(p,id);if(!f)return null;if(f.list==='main'){const L=layout(p);const e=L.main[f.index],c=e.clip;if(t<=e.start+MIN_LEN/2||t>=e.end-MIN_LEN/2)return null;const b={...copy(c),id:nextId(p,'c')};if(isStill(e.media)){const len=c.out-c.in;c.in=0;c.out=r3(t-e.start);b.in=0;b.out=r3(Math.max(MIN_LEN,len-c.out));if(c.kenburns){const mid=clampView(kenBurnsAt(c.kenburns,(t-e.start)/e.len));b.kenburns={from:mid,to:c.kenburns.to};c.kenburns={from:c.kenburns.from,to:mid};}}else{const s=r3(c.in+(t-e.start)*c.speed);c.out=s;b.in=s;}
b.transition=c.transition;c.transition=null;c.fadeOut=0;c.vfadeOut=0;b.fadeIn=0;b.vfadeIn=0;p.main.splice(f.index+1,0,b);return[c,b];}
const a=f.item;if(t<=a.start+MIN_LEN/2||t>=endOf(a)-MIN_LEN/2)return null;const b={...copy(a),id:nextId(p,f.list==='audio'?'a':'o')};if(f.list==='overlays'){a.end=r3(t);b.start=r3(t);a.animOut={...a.animOut,type:'none'};b.animIn={...b.animIn,type:'none'};}else{const s=r3(a.in+(t-a.start));a.out=s;b.in=s;b.start=r3(t);a.fadeOut=0;b.fadeIn=0;}
p[f.list].splice(f.index+1,0,b);return[a,b];}
function trimTo(p,id,edge,t){const f=find(p,id);if(!f)return;const c=f.item;if(f.list==='main'){const L=layout(p);const e=L.main[f.index];const still=isStill(e.media);if(edge==='start'){const dt=t-e.start;if(still)c.out=r3(clamp(c.out-dt,MIN_LEN,3600));else c.in=r3(clamp(c.in+dt*c.speed,0,c.out-MIN_LEN*c.speed));}else{const dt=t-e.end;if(still)c.out=r3(clamp(c.out+dt,MIN_LEN,3600));else c.out=r3(clamp(c.out+dt*c.speed,c.in+MIN_LEN*c.speed,e.media.duration));}
return;}
if(f.list==='overlays'){if(edge==='start')c.start=r3(clamp(t,0,c.end-MIN_LEN));else c.end=r3(Math.max(c.start+MIN_LEN,t));return;}
const dur=mediaMap(p).get(c.media)?.duration||c.out;if(edge==='start'){const dt=clamp(t-c.start,-c.in,c.out-c.in-MIN_LEN);const dt2=Math.max(dt,-c.start);c.in=r3(c.in+dt2);c.start=r3(c.start+dt2);}else c.out=r3(clamp(c.in+(t-c.start),c.in+MIN_LEN,dur));}
function moveMain(p,id,index){const i=p.main.findIndex((c)=>c.id===id);if(i<0)return;const[c]=p.main.splice(i,1);p.main.splice(clamp(index,0,p.main.length),0,c);}
function moveItem(p,id,start,row=null){const f=find(p,id);if(!f||f.list==='main')return;const it=f.item;const len=endOf(it)-it.start;const s=r3(Math.max(0,start));const list=p[f.list];if(f.list==='overlays'){it.start=s;it.end=r3(s+len);}else it.start=s;it.row=freeRow(list,s,s+len,row==null?it.row:clamp(Math.round(row),0,31),it.id);}
function duplicate(p,id){const f=find(p,id);if(!f)return null;if(f.list==='main'){const b={...copy(f.item),id:nextId(p,'c')};p.main.splice(f.index+1,0,b);return b;}
const a=f.item;const b={...copy(a),id:nextId(p,f.list==='audio'?'a':'o')};const len=endOf(a)-a.start;b.start=r3(endOf(a));if(f.list==='overlays')b.end=r3(b.start+len);b.row=freeRow(p[f.list],b.start,b.start+len,a.row);p[f.list].splice(f.index+1,0,b);return b;}
function remove(p,id){const f=find(p,id);if(f)p[f.list].splice(f.index,1);return!!f;}
function removeMedia(p,mediaId){p.main=p.main.filter((c)=>c.media!==mediaId);p.audio=p.audio.filter((c)=>c.media!==mediaId);p.overlays=p.overlays.filter((o)=>o.media!==mediaId);p.media=p.media.filter((m)=>m.id!==mediaId);}
function setTransition(p,id,tr){const f=find(p,id);if(f?.list!=='main')return;f.item.transition=tr&&tr.type?{type:tr.type,duration:r3(clamp(+tr.duration||0.5,0.1,5))}:null;}
function insertStill(p,clipId,t,mediaId,duration=2){const m=mediaMap(p).get(mediaId);if(!m||m.kind!=='image')return null;let index=p.main.length;const f=clipId?find(p,clipId):null;if(f?.list==='main'){const parts=split(p,clipId,t);const L=layout(p);const e=L.main[f.index];index=parts?f.index+1:(t<=e.start+(e.end-e.start)/2?f.index:f.index+1);}
return addClip(p,mediaId,{index,duration});}
function replaceMedia(p,clipId,mediaId){const f=find(p,clipId);const m=mediaMap(p).get(mediaId);if(!f||!m)return;if(f.list==='main'&&m.kind==='image')f.item.media=mediaId;else if(f.list==='overlays'&&f.item.type==='image'&&m.kind==='image')f.item.media=mediaId;}
function fixRows(p){for(const list of[p.overlays,p.audio]){const placed=[];for(const x of[...list].sort((a,b)=>a.row-b.row||a.start-b.start)){x.row=freeRow(placed,x.start,endOf(x),x.row);placed.push(x);}}
compactRows(p);}
function compactRows(p){for(const list of[p.overlays,p.audio]){const rows=[...new Set(list.map((x)=>x.row))].sort((a,b)=>a-b);const map=new Map(rows.map((r,i)=>[r,i]));for(const x of list)x.row=map.get(x.row);}}
function snapPoints(L,excludeId=null){const s=new Set([0]);for(const e of L.main)if(e.clip.id!==excludeId){s.add(e.start);s.add(e.end);}
for(const o of L.overlays)if(o.item.id!==excludeId){s.add(o.start);s.add(o.end);}
for(const a of L.audio)if(a.clip.id!==excludeId){s.add(a.start);s.add(a.end);}
return[...s].sort((a,b)=>a-b);}
function snap(t,points,threshold){let best=t,bd=threshold;for(const q of points){const d=Math.abs(q-t);if(d<=bd){bd=d;best=q;}}
return best;}
export{find,addOverlay,snapPoints,snap,trimTo,moveItem,moveMain,compactRows,addClip,addAudio,addMedia,fixRows,split,duplicate,setTransition,remove,insertStill,replaceMedia,removeMedia};