import{Solver}from"./solver.js";function protectedCells(topo,cfg,first){const keep=new Uint8Array(topo.n);if(first<0)return keep;keep[first]=1;if(cfg.first==='opening'||cfg.first==='marked'){const nb=new Int32Array(topo.maxN),k=topo.neighbors(first,nb);for(let j=0;j<k;j++)keep[nb[j]]=1;}
return keep;}
function placeMines(topo,count,rng,keep){const cand=[];for(let i=0;i<topo.n;i++)if(!keep||!keep[i])cand.push(i);count=Math.min(count,cand.length);const mine=new Uint8Array(topo.n);for(let k=0;k<count;k++){const j=k+rng.int(cand.length-k);const t=cand[k];cand[k]=cand[j];cand[j]=t;mine[cand[k]]=1;}
return mine;}
function countNumbers(topo,mine){const num=new Uint8Array(topo.n),nb=new Int32Array(topo.maxN);for(let i=0;i<topo.n;i++){if(!mine[i])continue;const k=topo.neighbors(i,nb);for(let j=0;j<k;j++)num[nb[j]]++;}
return num;}
function startCell(topo,rng){const m=topo.wrap?0:2;const w=topo.w-2*m,h=topo.h-2*m;if(w<1||h<1)return rng.int(topo.n);return(m+rng.int(h))*topo.w+m+rng.int(w);}
function generateLayout(cfg,topo,rng,first){const mine=placeMines(topo,cfg.mines,rng,protectedCells(topo,cfg,first));return{mine,num:countNumbers(topo,mine)};}
function solveFrom(topo,num,mines,first){const s=new Solver(topo,num,{mines,open:true});s.openCell(first);s.run();return s;}
function flip(topo,mine,num,x,nb){const d=mine[x]?-1:1;mine[x]^=1;const k=topo.neighbors(x,nb);for(let j=0;j<k;j++)num[nb[j]]+=d;}
function pickUnknown(s,mine,rng,want,isMine,skip){if(!want)return[];const n=s.t.n,K=s.K;const out=[],taken=new Set();const ok=(i,interior)=>K[i]===-1&&mine[i]===isMine&&!skip.has(i)&&!taken.has(i)&&(!interior||s.cn[i]===0);for(const interior of[true,false]){for(let tries=0;tries<48*want&&out.length<want;tries++){const i=rng.int(n);if(ok(i,interior)){taken.add(i);out.push(i);}}
if(out.length===want)return out;}
const start=rng.int(n);for(let k=0;k<n&&out.length<want;k++){const i=(start+k)%n;if(ok(i,false)){taken.add(i);out.push(i);}}
return out.length===want?out:null;}
function perturb(topo,mine,num,s,rng,nb){if(s.actN===0)return pocket(topo,mine,num,s,rng,nb);const c=s.act[rng.int(s.actN)];const U=[];const k=s.unknownOf(c,nb);for(let j=0;j<k;j++)U.push(nb[j]);const skip=new Set(U);const mined=U.filter((x)=>mine[x]);const free=U.filter((x)=>!mine[x]);const order=rng.int(2)?['clear','fill']:['fill','clear'];for(const how of order){const others=how==='clear'?pickUnknown(s,mine,rng,mined.length,0,skip):pickUnknown(s,mine,rng,free.length,1,skip);if(!others)continue;const changed=[...(how==='clear'?mined:free),...others];for(const x of changed)flip(topo,mine,num,x,nb);s.touched(changed);return'ok';}
return'fail';}
function pocket(topo,mine,num,s,rng,nb){const K=s.K,n=topo.n,cands=[];const nb2=new Int32Array(topo.maxN);for(let i=0;i<n;i++){if(K[i]!==1)continue;const k=topo.neighbors(i,nb);let unknown=false;for(let j=0;j<k&&!unknown;j++)if(K[nb[j]]===-1)unknown=true;if(unknown&&s.cn[i]>0)cands.push(i);}
if(!cands.length)return'fail';const m=cands[rng.int(cands.length)];const k=topo.neighbors(m,nb2);const skip=new Set([m]);for(let j=0;j<k;j++)skip.add(nb2[j]);const to=pickUnknown(s,mine,rng,1,0,skip)||pickUnknown(s,mine,rng,1,0,new Set([m]));if(!to)return'fail';flip(topo,mine,num,m,nb);flip(topo,mine,num,to[0],nb);return'restart';}
function*noGuessSteps(cfg,topo,rng,first,{maxAttempts=30}={}){const n=topo.n,safeTotal=n-cfg.mines;const keep=protectedCells(topo,cfg,first);const nb=new Int32Array(topo.maxN);let mine=null,num=null,moves=0;for(let attempt=1;attempt<=maxAttempts;attempt++){mine=placeMines(topo,cfg.mines,rng,keep);num=countNumbers(topo,mine);let s=solveFrom(topo,num,cfg.mines,first);let budget=Math.max(300,n);for(;;){if(s.solved()){const v=solveFrom(topo,num,cfg.mines,first);if(v.solved())return{mine,num,ok:true,attempts:attempt,moves};s=v;}
if(budget--<=0)break;const r=perturb(topo,mine,num,s,rng,nb);if(r==='fail')break;moves++;if(r==='restart')s=solveFrom(topo,num,cfg.mines,first);else s.run();yield Math.min(0.99,s.knownSafe/safeTotal);}
yield 0;}
return{mine,num,ok:false,attempts:maxAttempts,moves};}
function runSteps(gen){for(;;){const r=gen.next();if(r.done)return r.value;}}
async function runStepsAsync(gen,{slice=14,onProgress,signal}={}){for(;;){const t0=Date.now();let r,last=0;do{r=gen.next();if(!r.done)last=r.value;}while(!r.done&&Date.now()-t0<slice);if(r.done)return r.value;if(onProgress)onProgress(last);await new Promise((res)=>setTimeout(res,0));if(signal&&signal.aborted)return null;}}
function bbbv(topo,mine,num){const n=topo.n,seen=new Uint8Array(n),nb=new Int32Array(topo.maxN);let count=0;const stack=[];for(let i=0;i<n;i++){if(mine[i]||num[i]||seen[i])continue;count++;seen[i]=1;stack.push(i);while(stack.length){const c=stack.pop();const k=topo.neighbors(c,nb);for(let j=0;j<k;j++){const x=nb[j];if(seen[x]||mine[x])continue;seen[x]=1;if(!num[x])stack.push(x);}}}
for(let i=0;i<n;i++)if(!mine[i]&&!seen[i])count++;return count;}
export{startCell,noGuessSteps,generateLayout,runSteps,countNumbers,bbbv,runStepsAsync};