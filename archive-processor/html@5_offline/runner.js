import{runJob,errInfo,cancelJob}from"./engine.js";function workerURL(){const here=import.meta.url;let src;if(/\/runner\.js(?:[?#].*)?$/.test(here))src=`import { workerMain } from ${JSON.stringify(here.replace(/runner\.js(?:[?#].*)?$/,'engine.js'))};\nworkerMain();\n`;else{const inline=Array.from(document.querySelectorAll('script[type="module"]')).find((s)=>!s.src&&s.textContent.length>1000);if(!inline)throw new Error('no inline module');src=inline.textContent;}
return URL.createObjectURL(new Blob([src],{type:'text/javascript'}));}
function createRunner({onMode}={}){let worker=null,mode='starting',seq=0,current=null;const waiting=[];let readyWait=[];const setMode=(m)=>{mode=m;if(onMode)onMode(m);if(m!=='starting'){for(const r of readyWait)r();readyWait=[];}pump();};function finish(err,res){const c=current;current=null;if(c){if(err)c.reject(err);else c.resolve(res);}
pump();}
function start(){let url;try{url=workerURL();worker=new Worker(url,{type:'module'});}catch{setMode('inline');return;}
const timer=setTimeout(()=>{if(mode==='starting')fallback();},10000);const fallback=()=>{clearTimeout(timer);try{worker.terminate();}catch{}worker=null;setMode('inline');};worker.onmessage=(e)=>{const m=e.data||{};if(m.type==='ready'){clearTimeout(timer);URL.revokeObjectURL(url);setMode('worker');return;}
if(!current||m.id!==current.id)return;if(m.type==='progress'){if(current.onProgress)current.onProgress(m.p);}
else if(m.type==='done')finish(null,m.result);else if(m.type==='error')finish(Object.assign(new Error(m.error.message),{code:m.error.code}));};worker.onerror=(e)=>{if(e&&e.preventDefault)e.preventDefault();if(mode==='starting'){fallback();return;}
restart();finish(Object.assign(new Error((e&&e.message)||'the background worker stopped'),{code:'crash'}));};}
function restart(){try{worker.terminate();}catch{}
worker=null;mode='starting';start();}
async function runInline(c){try{finish(null,await runJob({...c.job,jobId:c.id},(p)=>c.onProgress&&c.onProgress(p)));}catch(e){const i=errInfo(e);finish(Object.assign(new Error(i.message),{code:i.code}));}}
function pump(){if(current||mode==='starting'||!waiting.length)return;current=waiting.shift();current.id=++seq;if(mode==='worker')worker.postMessage({type:'job',id:current.id,job:current.job});else runInline(current);}
if(typeof Worker==='function')start();else setMode('inline');return{get mode(){return mode;},get busy(){return!!current;},ready:()=>(mode==='starting'?new Promise((r)=>readyWait.push(r)):Promise.resolve()),run(job,onProgress){return new Promise((resolve,reject)=>{waiting.push({job,onProgress,resolve,reject});pump();});},cancel(){if(!current)return;if(mode==='worker')worker.postMessage({type:'cancel',id:current.id});else cancelJob(current.id);},kill(){if(!current)return;if(mode!=='worker'){cancelJob(current.id);return;}
restart();finish(Object.assign(new Error('cancelled'),{code:'aborted'}));},};}
export{createRunner};