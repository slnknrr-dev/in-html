import{normKB,pageById}from"./model.js";import{openWith,sealWith}from"./secret.js";import{putKB}from"./store.js";const S={kb:null,pageId:'',sid:'',versionId:'',blockId:'',unlocked:new Map(),saving:false,savedAt:0,dirty:false,readOnly:false,};const listeners=new Map();function on(ev,fn){(listeners.get(ev)||listeners.set(ev,new Set()).get(ev)).add(fn);return()=>listeners.get(ev).delete(fn);}
function emit(ev,info){for(const fn of listeners.get(ev)||[]){try{fn(info);}catch(e){console.error(e);}}}
const MAX_UNDO=80;let past=[],future=[],lastKey='',lastAt=0;const snap=()=>JSON.stringify(S.kb);function setKB(kb){S.kb=kb;past=[];future=[];lastKey='';S.unlocked=new Map();S.pageId=kb.pages.some((p)=>p.id===kb.home)?kb.home:(kb.pages[0]||{}).id||'';S.sid='';S.versionId='';S.blockId='';S.dirty=false;emit('kb',{});emit('change',{structure:true});}
function commit(fn,{key='',structure=false}={}){if(!S.kb||S.readOnly)return;const now=Date.now();const coalesce=key&&key===lastKey&&now-lastAt<1200;if(!coalesce){past.push(snap());if(past.length>MAX_UNDO)past.shift();}
future=[];lastKey=key;lastAt=now;fn(S.kb);S.kb.updated=new Date().toISOString();S.dirty=true;scheduleSave();emit('change',{structure});}
function restore(json){const remote=S.kb.remote;S.kb=normKB(JSON.parse(json));if(remote)S.kb.remote=remote;for(const[sid,u]of S.unlocked){const e=findSecret(sid);const p=e&&openWith(u.keys,e.secret.env);if(p){delete p.media;u.payload=p;}else S.unlocked.delete(sid);}
if(!pageById(S.kb,S.pageId))S.pageId=S.kb.home;if(S.sid&&!findSecret(S.sid))S.sid='';lastKey='';S.dirty=true;scheduleSave();emit('change',{structure:true});}
function undo(){if(!past.length)return;future.push(snap());restore(past.pop());}
function redo(){if(!future.length)return;past.push(snap());restore(future.pop());}
const canUndo=()=>past.length>0;const canRedo=()=>future.length>0;let saveTimer=0;const savers=[];function addSaver(fn){savers.push(fn);}
function scheduleSave(ms=700){clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,ms);}
async function saveNow(){clearTimeout(saveTimer);if(!S.kb||!S.dirty)return;S.saving=true;const kb=S.kb;try{await putKB(kb);for(const fn of savers)await fn(kb);if(kb===S.kb){S.dirty=false;S.savedAt=Date.now();}}catch(e){emit('error',e);}finally{S.saving=false;emit('saved',{});}}
function select(o={}){if(o.pageId!==undefined&&o.pageId!==S.pageId){S.pageId=o.pageId;S.sid='';S.versionId='';S.blockId='';}
if(o.sid!==undefined&&o.sid!==S.sid){S.sid=o.sid;S.versionId='';S.blockId='';}
if(o.versionId!==undefined){S.versionId=o.versionId;S.blockId='';}
if(o.blockId!==undefined)S.blockId=o.blockId;emit('select',o);}
const curPage=()=>(S.kb?pageById(S.kb,S.pageId):null);function findSecret(sid){for(const p of S.kb?S.kb.pages:[]){const i=(p.secrets||[]).findIndex((s)=>s.id===sid);if(i>=0)return{page:p,secret:p.secrets[i],index:i};}
return null;}
function target(){const page=curPage();if(!page)return null;if(page.access==='secret'){const s=page.secrets[0];const u=s&&S.unlocked.get(s.id);return u?{obj:u.payload,kind:'secretPage',secret:s,page}:{obj:null,kind:'locked',secret:s,page};}
if(S.sid){const s=(page.secrets||[]).find((x)=>x.id===S.sid);const u=s&&S.unlocked.get(s.id);if(s)return u?{obj:u.payload,kind:'variant',secret:s,page}:{obj:null,kind:'locked',secret:s,page};}
return{obj:page,kind:'page',page};}
const hooks={payloadMedia:null};function reseal(kb,sid){const u=S.unlocked.get(sid);if(!u)return;const media=hooks.payloadMedia?hooks.payloadMedia(u.payload):null;const payload=media?{...u.payload,media}:u.payload;for(const p of kb.pages)for(const s of p.secrets||[])if(s.id===sid)s.env=sealWith(u.keys,payload);}
function commitTarget(fn,opts={}){const tg=target();if(!tg||!tg.obj)return;commit((kb)=>{if(tg.kind==='page')fn(pageById(kb,tg.page.id));else{fn(tg.obj);tg.page.updated=new Date().toISOString();const p=pageById(kb,tg.page.id);if(p)p.updated=tg.page.updated;reseal(kb,tg.secret.id);}},opts);}
function curVersion(obj){const vs=(obj&&obj.versions)||[];return vs.find((v)=>v.id===S.versionId)||vs[0]||null;}
export{S,commit,on,findSecret,select,emit,target,commitTarget,curVersion,saveNow,addSaver,setKB,hooks,undo,redo,canUndo,canRedo};