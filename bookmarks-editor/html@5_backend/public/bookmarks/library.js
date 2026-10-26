import{randomClientId,createClock,newId}from"./clock.js";import{setFields,sanitizeRecord,maxStamp,mergeRecord,valueOf,isDeleted,newRecord,SCHEMA,deleteRecord,cleanTag}from"./record.js";import{hostOf,urlKey,cleanURL}from"./url.js";const byName=(a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})||(a.id<b.id?-1:1);class Library{constructor({client=randomClientId(),now=()=>Date.now()}={}){this.clock=createClock(client,now);this.now=now;this.records=new Map();this.listeners=new Set();this.version=0;this._views=new Map();this._cache={};this._pending=null;}
on(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
_invalidate(records){this.version++;let folders=false;for(const r of records){this._views.delete(r.id);if(r.type==='folder')folders=true;}
if(folders)this._views.clear();this._cache={};}
_changed(records,origin){this._invalidate(records);for(const fn of this.listeners){try{fn({origin,records});}catch(e){console.error(e);}}}
transact(fn){const outer=!this._pending;if(outer)this._pending=new Map();try{return fn();}finally{if(outer){const recs=[...this._pending.values()];this._pending=null;if(recs.length)this._changed(recs,'local');}}}
_touch(rec){if(this._pending){this._pending.set(rec.id,rec);this._invalidate([rec]);}
else this._changed([rec],'local');}
_set(rec,fields){if(setFields(rec,fields,this.clock.next()))this._touch(rec);}
record(id){return this.records.get(id)||null;}
allRecords(){return[...this.records.values()];}
load(records){this.records.clear();for(const r of records||[]){const rec=sanitizeRecord(r);if(!rec)continue;this.records.set(rec.id,rec);this.clock.observe(maxStamp(rec));}
this._views.clear();this._changed([],'load');}
merge(records){const changed=[];for(const r of records||[]){const rec=sanitizeRecord(r);if(!rec)continue;this.clock.observe(maxStamp(rec));const mine=this.records.get(rec.id);if(!mine){this.records.set(rec.id,rec);changed.push(rec);}
else if(mineType(mine,rec)&&mergeRecord(mine,rec))changed.push(mine);}
if(changed.length)this._changed(changed,'remote');return changed;}
view(rec){let v=this._views.get(rec.id);if(!v){v=valueOf(rec);this._views.set(rec.id,v);}
return v;}
get(id){const r=this.records.get(id);return r&&!isDeleted(r)?this.view(r):null;}
bookmarks({archived=true}={}){const key=archived?'bm':'bmNoArch';if(this._cache[key])return this._cache[key];const out=[];for(const r of this.records.values()){if(r.type!=='bookmark'||isDeleted(r))continue;const v=this.view(r);if(!archived&&v.archived)continue;out.push(v);}
return(this._cache[key]=out);}
folders(){if(this._cache.folders)return this._cache.folders;const out=[];for(const r of this.records.values())if(r.type==='folder'&&!isDeleted(r))out.push(this.view(r));return(this._cache.folders=out.sort(byName));}
tree(){if(this._cache.tree)return this._cache.tree;const live=this.folders();const byId=new Map(live.map((f)=>[f.id,f]));const parent=new Map();for(const f of live)parent.set(f.id,f.parent&&byId.has(f.parent)&&f.parent!==f.id?f.parent:'');for(let pass=0;pass<=live.length;pass++){let fixed=false;for(const f of live){const seen=[];let x=f.id;while(x&&!seen.includes(x)){seen.push(x);x=parent.get(x);}
if(!x)continue;const cycle=seen.slice(seen.indexOf(x));const stampOf=(id)=>this.records.get(id).s.parent||'';cycle.sort((a,b)=>(stampOf(b)>stampOf(a)?1:stampOf(b)<stampOf(a)?-1:a<b?-1:1));parent.set(cycle[0],'');fixed=true;}
if(!fixed)break;}
const children=new Map([['',[]]]);for(const f of live){const p=parent.get(f.id);if(!children.has(p))children.set(p,[]);children.get(p).push(f);}
for(const list of children.values())list.sort(byName);const paths=new Map();const pathOf=(id)=>{if(!id||!byId.has(id))return[];let p=paths.get(id);if(!p){p=[...pathOf(parent.get(id)),byId.get(id).name];paths.set(id,p);}
return p;};const descendants=(id)=>{const out=new Set([id]);const walk=(x)=>{for(const c of children.get(x)||[]){out.add(c.id);walk(c.id);}};walk(id);return out;};return(this._cache.tree={byId,children:(id)=>children.get(id||'')||[],parentOf:(id)=>parent.get(id)??'',path:pathOf,pathString:(id)=>pathOf(id).join('/'),descendants,depth:(id)=>pathOf(id).length,});}
folderOf(b){return b.folder&&this.tree().byId.has(b.folder)?b.folder:'';}
folderCount(id,deep=true){const key='fc'+(deep?1:0);if(!this._cache[key]){const direct=new Map();for(const b of this.bookmarks({archived:false})){const f=this.folderOf(b);direct.set(f,(direct.get(f)||0)+1);}
if(!deep)this._cache[key]=direct;else{const t=this.tree();const total=new Map();const sum=(fid)=>{let n=direct.get(fid)||0;for(const c of t.children(fid))n+=sum(c.id);total.set(fid,n);return n;};sum('');this._cache[key]=total;}}
return this._cache[key].get(id||'')||0;}
tags(){if(this._cache.tags)return this._cache.tags;const m=new Map();for(const b of this.bookmarks()){for(const t of b.tags){const k=t.toLowerCase();let e=m.get(k);if(!e)m.set(k,(e={tag:t,count:0,spell:new Map()}));e.count++;e.spell.set(t,(e.spell.get(t)||0)+1);}}
const lower=(s)=>(s===s.toLowerCase()?0:1);const out=[...m.values()].map((e)=>({tag:[...e.spell].sort((a,b)=>b[1]-a[1]||lower(a[0])-lower(b[0])||(a[0]<b[0]?-1:1))[0][0],count:e.count}));return(this._cache.tags=out.sort((a,b)=>b.count-a.count||a.tag.localeCompare(b.tag)));}
hosts(){if(this._cache.hosts)return this._cache.hosts;const m=new Map();for(const b of this.bookmarks()){const h=hostOf(b.url);if(h)m.set(h,(m.get(h)||0)+1);}
return(this._cache.hosts=[...m].map(([host,count])=>({host,count})).sort((a,b)=>b.count-a.count||a.host.localeCompare(b.host)));}
stats(){if(this._cache.stats)return this._cache.stats;const s={all:0,unread:0,fav:0,archived:0,untagged:0,public:0,total:0};for(const b of this.bookmarks()){s.total++;if(b.archived){s.archived++;continue;}
s.all++;if(b.unread)s.unread++;if(b.fav)s.fav++;if(!b.tags.length)s.untagged++;if(b.public)s.public++;}
return(this._cache.stats=s);}
findByURL(url,keyOpts={}){const k=urlKey(url,keyOpts);return this.bookmarks().filter((b)=>urlKey(b.url,keyOpts)===k);}
duplicates(keyOpts={}){const m=new Map();for(const b of this.bookmarks()){const k=urlKey(b.url,keyOpts);if(!m.has(k))m.set(k,[]);m.get(k).push(b);}
return[...m].filter(([,list])=>list.length>1).map(([key,items])=>({key,items:items.sort((a,b)=>a.created-b.created||(a.id<b.id?-1:1))})).sort((a,b)=>b.items.length-a.items.length||(a.key<b.key?-1:1));}
add(fields={},{id}={}){return this.transact(()=>{const now=this.now();const rid=id&&!this.records.has(id)?id:newId();const rec=newRecord('bookmark',rid);this.records.set(rid,rec);const f={...fields};delete f.del;if(!f.created)f.created=now;if(!f.modified)f.modified=f.created;setFields(rec,{...defaultsOf('bookmark'),...f},this.clock.next());this._touch(rec);return this.view(rec);});}
update(id,fields){const rec=this.records.get(id);if(!rec||isDeleted(rec))return false;const cur=valueOf(rec);const diff={};for(const[k,v]of Object.entries(fields)){if(k==='id'||k==='type'||k==='del'||!SCHEMA[rec.type][k])continue;if(JSON.stringify(cur[k])!==JSON.stringify(v))diff[k]=v;}
if(!Object.keys(diff).length)return false;if(rec.type==='bookmark'&&!('modified'in diff)&&!onlyReadState(diff))diff.modified=this.now();this._set(rec,diff);return true;}
updateMany(ids,fieldsOrFn){return this.transact(()=>{let n=0;for(const id of ids){const v=this.get(id);if(!v)continue;const f=typeof fieldsOrFn==='function'?fieldsOrFn(v):fieldsOrFn;if(f&&this.update(id,f))n++;}
return n;});}
snapshot(ids){return[...new Set(ids)].map((id)=>{const r=this.records.get(id);return{id,type:r?r.type:'bookmark',value:r&&!isDeleted(r)?valueOf(r):null};});}
restore(snapshot){return this.transact(()=>{for(const{id,type,value}of snapshot||[]){let rec=this.records.get(id);if(!value){if(rec&&!isDeleted(rec)&&deleteRecord(rec,this.clock.next()))this._touch(rec);continue;}
if(!rec){rec=newRecord(type,id);this.records.set(id,rec);}
const f={...value,del:false};delete f.id;delete f.type;this._set(rec,f);}});}
remove(ids){const snap=this.snapshot(ids);this.transact(()=>{for(const id of ids){const rec=this.records.get(id);if(rec&&!isDeleted(rec)&&deleteRecord(rec,this.clock.next()))this._touch(rec);}});return snap.filter((x)=>x.value);}
addFolder({name,parent=''}={},{id}={}){return this.transact(()=>{const rid=id&&!this.records.has(id)?id:newId();const rec=newRecord('folder',rid);this.records.set(rid,rec);setFields(rec,{name:String(name||'').trim()||'Folder',parent:parent&&this.get(parent)?parent:'',created:this.now(),del:false},this.clock.next());this._touch(rec);return this.view(rec);});}
renameFolder(id,name){const n=String(name||'').trim();return!!n&&this.update(id,{name:n});}
moveFolder(id,parent=''){if(!this.get(id)||(parent&&!this.get(parent)))return false;if(parent&&this.tree().descendants(id).has(parent))return false;return this.update(id,{parent});}
removeFolder(id){if(!this.get(id))return[];const ids=[...this.tree().descendants(id)];const inside=new Set(ids);for(const b of this.bookmarks())if(inside.has(this.folderOf(b)))ids.push(b.id);return this.remove(ids);}
folderByPath(names,parent='',create=true){let cur=parent||'';for(const raw of names||[]){const name=String(raw||'').trim();if(!name)continue;const kids=this.tree().children(cur);const hit=kids.find((f)=>f.name===name)||kids.find((f)=>f.name.toLowerCase()===name.toLowerCase());if(hit){cur=hit.id;continue;}
if(!create)return null;cur=this.addFolder({name,parent:cur}).id;}
return cur;}
addTags(ids,tags){const add=tags.map(cleanTag).filter(Boolean);return this.updateMany(ids,(b)=>{const have=new Set(b.tags.map((t)=>t.toLowerCase()));const more=add.filter((t)=>!have.has(t.toLowerCase()));return more.length?{tags:[...b.tags,...more]}:null;});}
removeTags(ids,tags){const drop=new Set(tags.map((t)=>cleanTag(t).toLowerCase()));return this.updateMany(ids,(b)=>(b.tags.some((t)=>drop.has(t.toLowerCase()))?{tags:b.tags.filter((t)=>!drop.has(t.toLowerCase()))}:null));}
mergeTags(froms,into){const to=cleanTag(into);const drop=new Set(froms.map((t)=>cleanTag(t).toLowerCase()));if(!to)return 0;return this.updateMany(this.bookmarks().map((b)=>b.id),(b)=>{if(!b.tags.some((t)=>drop.has(t.toLowerCase())))return null;const out=[];const seen=new Set();for(const t of b.tags){const x=drop.has(t.toLowerCase())?to:t;if(seen.has(x.toLowerCase()))continue;seen.add(x.toLowerCase());out.push(x);}
return{tags:out};});}
renameTag(from,to){return this.mergeTags([from],to);}
deleteTag(tag){return this.removeTags(this.bookmarks().map((b)=>b.id),[tag]);}
mergeGroup(ids,keepId){const items=ids.map((id)=>this.get(id)).filter(Boolean);if(items.length<2)return[];const keep=items.find((b)=>b.id===keepId)||items.slice().sort((a,b)=>a.created-b.created)[0];const snap=this.snapshot(items.map((b)=>b.id));this.transact(()=>{const others=items.filter((b)=>b!==keep);this.update(keep.id,mergedFields(keep,others));this.remove(others.map((b)=>b.id));});return snap;}
previewImport(data,{duplicates='skip',stripTracking=true,keyOpts={},into=''}={}){const known=new Set(this.bookmarks().map((b)=>urlKey(b.url,keyOpts)));const inData=new Set();let dupes=0,inFile=0,added=0,invalid=0;const tags=new Set();for(const it of data.items||[]){if(!it.url){invalid++;continue;}
const k=urlKey(stripTracking?cleanURL(it.url):it.url,keyOpts);if(known.has(k))dupes++;else if(inData.has(k))inFile++;else added++;inData.add(k);for(const t of it.tags||[])tags.add(t.toLowerCase());}
const paths=new Set();for(const p of[...(data.folders||[]),...(data.items||[]).map((i)=>i.folder||[])]){for(let i=1;i<=p.length;i++)paths.add(p.slice(0,i).join('\u0000'));}
let folders=0;for(const p of paths)if(this.folderByPathReadOnly(p.split('\u0000'),into)===null)folders++;const keepAll=duplicates==='keep';return{total:(data.items||[]).length,added:keepAll?added+dupes+inFile:added,duplicates:dupes,inFile,skipped:duplicates==='skip'?dupes+inFile:0,merged:duplicates==='merge'?dupes+inFile:0,invalid,folders,tags:tags.size,};}
folderByPathReadOnly(names,parent=''){return this.folderByPath(names,parent,false);}
importItems(data,{into='',duplicates='skip',stripTracking=true,keyOpts={},unread=null}={}){const res={added:0,merged:0,skipped:0,invalid:0,ids:[],snapshot:[]};const before=new Map();this.transact(()=>{const known=new Map();for(const b of this.bookmarks()){const k=urlKey(b.url,keyOpts);if(!known.has(k))known.set(k,b.id);}
const folderIds=new Set(this.folders().map((f)=>f.id));for(const p of data.folders||[])this.folderByPath(p,into);for(const it of data.items||[]){if(!it.url){res.invalid++;continue;}
const url=stripTracking?cleanURL(it.url):it.url;const k=urlKey(url,keyOpts);const dup=known.get(k);if(dup&&duplicates!=='keep'){if(duplicates==='skip'){res.skipped++;continue;}
const cur=this.get(dup);if(!cur)continue;if(!before.has(dup))before.set(dup,this.snapshot([dup])[0]);const f=mergedFields(cur,[{...defaultsOf('bookmark'),...it,url}]);this.update(dup,f);res.merged++;continue;}
const folder=it.folder&&it.folder.length?this.folderByPath(it.folder,into):into;const fields={...it,url,folder};delete fields.id;if(unread!==null)fields.unread=unread;const v=this.add(fields);known.set(k,v.id);res.ids.push(v.id);res.added++;}
const newFolders=this.folders().filter((f)=>!folderIds.has(f.id)).map((f)=>({id:f.id,type:'folder',value:null}));res.snapshot=[...before.values(),...res.ids.map((id)=>({id,type:'bookmark',value:null})),...newFolders];});return res;}
restoreBackup(data){const res={added:0,updated:0,snapshot:[]};const folders=Array.isArray(data.folders)?data.folders:[];const items=Array.isArray(data.bookmarks)?data.bookmarks:[];const ids=[...folders,...items].map((x)=>x&&x.id).filter((id)=>typeof id==='string');res.snapshot=this.snapshot(ids);this.transact(()=>{for(const[list,type]of[[folders,'folder'],[items,'bookmark']]){for(const x of list){if(!x||typeof x.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(x.id))continue;const f={...defaultsOf(type),...x,del:false};delete f.id;delete f.type;let rec=this.records.get(x.id);if(rec&&rec.type!==type)continue;if(!rec){rec=newRecord(type,x.id);this.records.set(x.id,rec);res.added++;}else res.updated++;this._set(rec,f);}}});return res;}}
function mineType(a,b){return a.type===b.type;}
function defaultsOf(type){const o={};for(const[k,[def]]of Object.entries(SCHEMA[type]))if(k!=='del')o[k]=Array.isArray(def)?def.slice():def;return o;}
const onlyReadState=(diff)=>Object.keys(diff).every((k)=>k==='visited'||k==='unread');function mergedFields(keep,others){const all=[keep,...others];const f={};if(!keep.title||keep.title===keep.url){const t=others.find((o)=>o.title&&o.title!==o.url);if(t)f.title=t.title;}
const notes=[];for(const b of all){const n=(b.notes||'').trim();if(n&&!notes.some((x)=>x.includes(n)))notes.push(n);}
if(notes.join('\n\n')!==(keep.notes||'').trim())f.notes=notes.join('\n\n');const tags=[],seen=new Set();for(const b of all)for(const t of b.tags||[]){if(!seen.has(t.toLowerCase())){seen.add(t.toLowerCase());tags.push(t);}}
if(tags.length!==keep.tags.length)f.tags=tags;const created=Math.min(...all.map((b)=>b.created||Infinity));if(Number.isFinite(created)&&created!==keep.created)f.created=created;const visited=Math.max(...all.map((b)=>b.visited||0));if(visited>(keep.visited||0))f.visited=visited;if(all.some((b)=>b.fav)&&!keep.fav)f.fav=true;if(keep.unread&&all.some((b)=>!b.unread))f.unread=false;if(keep.public&&all.some((b)=>!b.public))f.public=false;if(keep.archived&&all.some((b)=>!b.archived))f.archived=false;if(!keep.icon){const i=others.find((o)=>o.icon);if(i)f.icon=i.icon;}
return f;}
export{Library};