function evaluate(job){const clock=typeof performance==='object'&&performance&&typeof performance.now==='function'?()=>performance.now():()=>Date.now();const t0=clock();const source=String(job.source??''),flags=String(job.flags??''),text=String(job.text??'');const limit=job.limit>0?job.limit:5000,budget=job.budget>0?job.budget:1500;const names=Array.isArray(job.names)?job.names:[];const unicode=flags.includes('u')||flags.includes('v');let re,reD=null;try{re=new RegExp(source,flags);}catch(e){return{error:String((e&&e.message)||e)};}
if(!flags.includes('d')){try{reD=new RegExp(source,flags+'d');}catch{reD=null;}}else reD=re;const advance=(s,i)=>{if(!unicode||i+1>=s.length)return i+1;const c=s.charCodeAt(i);if(c<0xd800||c>0xdbff)return i+1;const d=s.charCodeAt(i+1);return d>=0xdc00&&d<=0xdfff?i+2:i+1;};const pack=(m)=>{const groups=[];for(let k=1;k<m.length;k++){let start=-1,end=-1;const g=m[k];if(m.indices&&m.indices[k]){start=m.indices[k][0];end=m.indices[k][1];}
else if(g!==undefined){const at=m[0].indexOf(g);start=m.index+Math.max(0,at);end=start+g.length;}
groups.push({n:k,name:names[k]||null,start,end,text:g===undefined?null:g});}
const res={index:m.index,end:m.index+m[0].length,text:m[0],groups};Object.defineProperty(res,'caps',{value:m.groups,enumerable:false});return res;};const run=reD||re;const all=run.global;const matches=[];let truncated=null,count=0;run.lastIndex=0;for(;;){const m=run.exec(text);if(!m)break;count++;if(matches.length<limit)matches.push(pack(m));if(!all)break;if(m[0]==='')run.lastIndex=advance(text,run.lastIndex);if(matches.length>=limit){truncated='count';break;}
if((count&63)===0&&clock()-t0>budget){truncated='time';break;}}
const out={matches,count,truncated,indices:reD?'d':'search'};if(job.mode==='replace'){const tpl=String(job.replacement??'');const sub=(m)=>{const caps=m.groups.length;let r='';for(let i=0;i<tpl.length;i++){const c=tpl[i];if(c!=='$'||i+1>=tpl.length){r+=c;continue;}
const d=tpl[i+1];if(d==='$'){r+='$';i++;}
else if(d==='&'){r+=m.text;i++;}
else if(d==='`'){r+=text.slice(0,m.index);i++;}
else if(d==='\''){r+=text.slice(Math.min(m.end,text.length));i++;}
else if(d>='0'&&d<='9'){let digits=1,idx=+d;const d2=tpl[i+2];if(d2>='0'&&d2<='9'){digits=2;idx=idx*10+ +d2;if(idx>caps){digits=1;idx=+d;}}
if(idx>=1&&idx<=caps){const g=m.groups[idx-1].text;r+=g==null?'':g;}
else r+=tpl.slice(i,i+1+digits);i+=digits;}else if(d==='<'&&m.caps){const close=tpl.indexOf('>',i+2);if(close<0){r+='$<';i++;}
else{const g=m.caps[tpl.slice(i+2,close)];r+=g==null?'':String(g);i=close;}}else r+='$';}
return r;};const pieces=[];let last=0,output='';const list=truncated==='count'?null:matches;const each=(m)=>{if(m.index>last)pieces.push({text:text.slice(last,m.index),replaced:false});const r=sub(m);pieces.push({text:r,replaced:true,from:m.index,to:m.end});output+=text.slice(last,m.index)+r;last=m.end;};if(list)list.forEach(each);else{run.lastIndex=0;for(;;){const m=run.exec(text);if(!m)break;each(pack(m));if(!all)break;if(m[0]==='')run.lastIndex=advance(text,run.lastIndex);if(clock()-t0>budget){out.truncated='time';break;}}}
if(last<text.length)pieces.push({text:text.slice(last),replaced:false});output+=text.slice(last);out.output=output;out.pieces=pieces;}else if(job.mode==='split'){const lim=job.splitLimit>0?job.splitLimit>>>0:4294967295;let sp;try{sp=new RegExp(source,flags.includes('y')?flags:flags+'y');}catch(e){return{error:String((e&&e.message)||e)};}
const parts=[];const size=text.length;if(lim===0){}else if(size===0){sp.lastIndex=0;if(!sp.exec(text))parts.push({text,capture:0});}else{let p=0,q=0;while(q<size){sp.lastIndex=q;const z=sp.exec(text);if(!z){q=advance(text,q);continue;}
const e=Math.min(sp.lastIndex,size);if(e===p){q=advance(text,q);continue;}
parts.push({text:text.slice(p,q),capture:0});if(parts.length===lim)break;p=e;for(let k=1;k<z.length;k++){parts.push({text:z[k]===undefined?null:z[k],capture:k});if(parts.length===lim)break;}
if(parts.length===lim)break;q=p;if(clock()-t0>budget){out.truncated='time';break;}}
if(parts.length<lim)parts.push({text:text.slice(p),capture:0});}
out.parts=parts;}
out.ms=clock()-t0;return out;}
function createRunner({timeout=1000,grace=120}={}){const canWorker=typeof Worker==='function'&&typeof Blob==='function'&&typeof URL==='function'&&typeof URL.createObjectURL==='function';let worker=null,url=null,seq=0,busy=null,queued=null,mode=canWorker?'worker':'inline';function spawn(){const src='const evaluate = '+evaluate.toString()+';\n'
+'self.onmessage = function (e) { var r; try { r = evaluate(e.data.job); } catch (err) { r = { error: String((err && err.message) || err) }; } self.postMessage({ id: e.data.id, result: r }); };\n';try{url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));worker=new Worker(url);}catch{worker=null;mode='inline';return false;}
worker.onmessage=(e)=>{const d=e.data||{};if(!busy||d.id!==busy.id)return;const b=busy;busy=null;clearTimeout(b.timer);b.resolve(d.result);next();};worker.onerror=(e)=>{if(e&&e.preventDefault)e.preventDefault();const b=busy;busy=null;kill();if(b){clearTimeout(b.timer);b.resolve({error:String((e&&e.message)||'worker error')});}
next();};return true;}
function kill(){if(worker){try{worker.terminate();}catch{}}
worker=null;if(url){try{URL.revokeObjectURL(url);}catch{}}
url=null;}
function start(item){if(!worker&&!spawn()){item.resolve(evaluate(item.job));next();return;}
busy=item;item.began=Date.now();item.timer=setTimeout(()=>{if(busy!==item)return;busy=null;kill();item.resolve({timeout:true,ms:timeout});next();},timeout);worker.postMessage({id:item.id,job:item.job});}
function next(){if(busy||!queued)return;const q=queued;queued=null;start(q);}
function run(job){if(mode==='inline')return Promise.resolve().then(()=>evaluate(job));return new Promise((resolve)=>{const item={id:++seq,job,resolve,timer:0,began:0};if(queued)queued.resolve({cancelled:true});queued=item;if(busy&&Date.now()-busy.began>grace){const b=busy;busy=null;clearTimeout(b.timer);kill();b.resolve({cancelled:true});}
next();});}
return{run,terminate(){kill();if(busy){clearTimeout(busy.timer);busy.resolve({cancelled:true});busy=null;}if(queued){queued.resolve({cancelled:true});queued=null;}},get mode(){return mode;},};}
export{createRunner};