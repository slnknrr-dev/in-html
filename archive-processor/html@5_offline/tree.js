let nid=0;function node(name,path,dir,parent){return{id:++nid,name,path,dir,parent,depth:parent?parent.depth+1:-1,dirs:dir?new Map():null,list:dir?[]:null,entry:null,files:0,size:0,packed:0,sel:0,open:false,checked:false,mtime:null};}
function buildTree(entries){const root=node('','',true,null);root.open=true;const byId=new Map();const dirChild=(n,name)=>{let c=n.dirs.get(name);if(!c){c=node(name,n.path?n.path+'/'+name:name,true,n);n.dirs.set(name,c);n.list.push(c);}
return c;};for(const e of entries){const segs=e.path.split('/');let n=root;for(let i=0;i<segs.length-1;i++)n=dirChild(n,segs[i]);const name=segs[segs.length-1];let leaf;if(e.dir)leaf=dirChild(n,name);else{leaf=node(name,e.path,false,n);n.list.push(leaf);}
leaf.entry=e;leaf.mtime=e.mtime;byId.set(e.id,leaf);}
let dirs=0;const sum=(n)=>{if(n.dir&&n.depth>=0)dirs++;if(!n.dir){n.files=1;n.size=n.entry.size||0;n.packed=n.entry.packed||0;return;}
for(const c of n.list){sum(c);n.files+=c.files;n.size+=c.size;n.packed+=c.packed;}};sum(root);if(root.list.length===1&&root.list[0].dir)root.list[0].open=true;return{root,byId,dirs};}
const COLL=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});const KEYS={name:(a,b)=>COLL.compare(a.name,b.name),size:(a,b)=>a.size-b.size,packed:(a,b)=>a.packed-b.packed,mtime:(a,b)=>(a.mtime||0)-(b.mtime||0),method:(a,b)=>String((a.entry&&a.entry.method)||'').localeCompare(String((b.entry&&b.entry.method)||'')),order:(a,b)=>((a.entry&&a.entry.id)??1e12)-((b.entry&&b.entry.id)??1e12),};function sortTree(root,key='name',dir=1){const cmp=KEYS[key]||KEYS.name;const f=(a,b)=>(a.dir!==b.dir?(a.dir?-1:1):cmp(a,b)*dir||KEYS.name(a,b));const walk=(n)=>{if(!n.dir)return;n.list.sort(f);for(const c of n.list)walk(c);};walk(root);}
function treeRows(root){const out=[];const walk=(n)=>{for(const c of n.list){out.push(c);if(c.dir&&c.open)walk(c);}};walk(root);return out;}
function matcher(q){const s=q.trim().toLowerCase();if(!s)return null;if(/[*?]/.test(s)){const re=new RegExp('^'+s.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')+'$','i');return s.includes('/')?(n)=>re.test(n.path):(n)=>re.test(n.name);}
return(n)=>n.path.toLowerCase().includes(s);}
function searchRows(root,match){const out=[];const walk=(n)=>{for(const c of n.list){if(match(c))out.push(c);if(c.dir)walk(c);}};walk(root);return out;}
function bump(n,d){for(let p=n.parent;p;p=p.parent)p.sel+=d;}
function setChecked(n,on){if(!n.dir){if(n.checked===on)return;n.checked=on;bump(n,on?1:-1);return;}
for(const c of n.list)setChecked(c,on);if(n.files===0)n.checked=on;}
function checkState(n){if(!n.dir)return n.checked?'all':'none';if(n.files===0)return n.checked?'all':'none';return n.sel===0?'none':n.sel===n.files?'all':'some';}
function selection(root){const ids=[];let size=0,files=0;const walk=(n)=>{for(const c of n.list){if(c.dir){const st=checkState(c);if(st==='none')continue;if(st==='all'&&c.entry)ids.push(c.entry.id);walk(c);}else if(c.checked){ids.push(c.entry.id);size+=c.entry.size||0;files++;}}};walk(root);return{ids,size,files};}
function entriesUnder(n){const ids=[];const walk=(x)=>{if(x.entry)ids.push(x.entry.id);if(x.dir)for(const c of x.list)walk(c);};walk(n);return ids;}
export{checkState,buildTree,sortTree,setChecked,entriesUnder,matcher,searchRows,treeRows,selection};