import{edgeChain,edgeById}from"./piece.js";import{plLength,splitAt,reversed,pointAt}from"./geom.js";const pieceOf=(pieces,id)=>(Array.isArray(pieces)?pieces.find((p)=>p.id===id):pieces[id])||null;function itemRuns(pieces,item){const[pid,base,rev,s0,s1]=item;const p=pieceOf(pieces,pid);if(!p)throw new Error(`seam: no piece ${pid}`);let ids=edgeChain(p,base);if(!ids.length){const e=edgeById(p,base);if(!e)throw new Error(`seam: no edge ${pid}.${base}`);ids=[e.id];}
let runs=ids.map((id)=>edgeById(p,id).pts.map((q)=>q.slice()));if(s0!=null||s1!=null){const total=runs.reduce((s,r)=>s+plLength(r),0);const a=Math.max(0,s0??0),b=Math.min(total,s1??total);const out=[];let acc=0;for(const r of runs){const L=plLength(r);const lo=Math.max(a,acc),hi=Math.min(b,acc+L);if(hi>lo+1e-9)out.push(splitAt(splitAt(r,hi-acc)[0],lo-acc)[1]);acc+=L;}
runs=out;}
if(rev)runs=runs.reverse().map(reversed);return runs.map((pts)=>({piece:pid,pts,len:plLength(pts)}));}
const pathRuns=(pieces,path)=>path.flatMap((it)=>itemRuns(pieces,it));const seamPathLength=(pieces,path)=>pathRuns(pieces,path).reduce((s,r)=>s+r.len,0);function pathSampler(pieces,path){const runs=pathRuns(pieces,path);const length=runs.reduce((s,r)=>s+r.len,0);return{runs,length,at(s){let k=0,x=Math.max(0,Math.min(length,s));while(k<runs.length-1&&x>runs[k].len){x-=runs[k].len;k++;}
const q=pointAt(runs[k].pts,x);return{piece:runs[k].piece,p:q.p,tangent:q.tangent,run:k};},};}
function checkSeams(d,{tol=0.05}={}){const out=[];for(const s of d.seams){let la,lb;try{la=seamPathLength(d.pieces,s.a);lb=seamPathLength(d.pieces,s.b);}catch(e){out.push({id:s.id,kind:s.kind,error:e.message,ok:false});continue;}
const diff=lb-la-(s.ease||0);const judged=!/Lining$/.test(s.id);out.push({id:s.id,kind:s.kind,a:la,b:lb,ease:s.ease||0,diff,ok:!judged||Math.abs(diff)<=tol,judged});}
return out;}
function seamNotches(d){const out=[];for(const s of d.seams){if(s.kind==='dart'||!s.notches?.length)continue;for(const side of[s.a,s.b]){let sm;try{sm=pathSampler(d.pieces,side);}catch{continue;}
for(const f of s.notches){const q=sm.at(sm.length*f);out.push({piece:q.piece,p:q.p,dir:q.tangent,seam:s.id});}}}
return out;}
export{seamNotches,checkSeams};