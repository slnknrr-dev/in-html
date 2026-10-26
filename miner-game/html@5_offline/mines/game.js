import{normalizeConfig}from"./config.js";import{topology}from"./topology.js";import{startCell,noGuessSteps,generateLayout,runSteps,countNumbers,bbbv}from"./layout.js";import{seededRandom,cryptoRandom}from"../prng/prng.js";const HIDDEN=0,OPEN=1,FLAG=2,MARK=3;const MOVE={reveal:0,flag:1,chord:2,undo:3};const UNDO_DEPTH=300;class Game{constructor(cfg,source={kind:'crypto'}){this.cfg=normalizeConfig(cfg);this.topo=topology(this.cfg);this.n=this.topo.n;this.kind=source.kind==='seeded'||source.kind==='layout'?source.kind:'crypto';this.seed=this.kind==='seeded'?String(source.seed):null;this.rng=this.kind==='seeded'?seededRandom(this.seed):cryptoRandom();this.st=new Uint8Array(this.n);this.mine=null;this.num=null;this.status='ready';this.opened=0;this.flags=0;this.first=-1;this.start=-1;this.boom=[];this.moves=[];this.history=[];this.hints=0;this.undos=0;this.time=0;this.layoutOk=true;this.clicks=0;this.nb=new Int32Array(this.topo.maxN);if(this.kind==='layout'){this.setLayout(Uint8Array.from(source.mine));if(source.start>=0&&source.start<this.n)this.start=source.start;}else if(this.cfg.first==='marked')this.start=startCell(this.topo,this.rng.fork('start'));}
get assisted(){return this.hints>0||this.undos>0;}
get over(){return this.status==='won'||this.status==='lost';}
get safeTotal(){return this.n-this.cfg.mines;}
get remaining(){return this.cfg.mines-this.flags;}
needsLayout(){return!this.mine;}
layoutFirst(i){if(this.cfg.first==='marked')return this.start;if(this.cfg.first==='off')return-1;return i;}
*layoutSteps(first){let res;if(this.cfg.noGuess&&first>=0)res=yield*noGuessSteps(this.cfg,this.topo,this.rng,first);else res=generateLayout(this.cfg,this.topo,this.rng,first);this.layoutOk=res.ok!==false;this.setLayout(res.mine);return res;}
prepare(first){return runSteps(this.layoutSteps(first));}
setLayout(mine){this.mine=mine;let m=0;for(let i=0;i<this.n;i++)m+=mine[i]?1:0;this.cfg.mines=m;this.num=countNumbers(this.topo,mine);this.bbbv=bbbv(this.topo,mine,this.num);}
layoutBits(){const out=new Uint8Array(Math.ceil(this.n/8));if(this.mine)for(let i=0;i<this.n;i++)if(this.mine[i])out[i>>3]|=1<<(i&7);return out;}
begin(){return{cells:[],prev:[],status:this.status,opened:this.opened,flags:this.flags,boom:this.boom,first:this.first,time:this.time};}
set(d,i,s){d.cells.push(i);d.prev.push(this.st[i]);this.st[i]=s;}
commit(d,t,code,cell){this.moves.push([Math.max(0,Math.round(t)),code,cell]);if(!d.cells.length&&d.status===this.status)return null;this.clicks++;this.history.push(d);if(this.history.length>UNDO_DEPTH)this.history.shift();return this.result(d);}
result(d){const opened=[];for(let k=0;k<d.cells.length;k++)if(this.st[d.cells[k]]===OPEN&&d.prev[k]!==OPEN)opened.push(d.cells[k]);return{opened,cells:d.cells,lost:this.status==='lost',won:this.status==='won',boom:this.boom};}
flood(d,i){const stack=[i];const nb=this.nb;while(stack.length){const c=stack.pop();if(this.st[c]===OPEN||this.st[c]===FLAG)continue;this.set(d,c,OPEN);this.opened++;if(this.num[c]===0){const k=this.topo.neighbors(c,nb);for(let j=0;j<k;j++){const x=nb[j];if(this.st[x]!==OPEN&&this.st[x]!==FLAG&&!this.mine[x])stack.push(x);}}}}
started(i,t){if(this.status!=='ready')return;this.status='playing';this.first=i;}
finish(d,t){if(this.status==='playing'&&this.opened===this.safeTotal){this.status='won';this.time=Math.max(0,Math.round(t));for(let i=0;i<this.n;i++)if(this.mine[i]&&this.st[i]!==FLAG){this.set(d,i,FLAG);this.flags++;}}}
lose(d,cells,t){this.status='lost';this.boom=cells;this.time=Math.max(0,Math.round(t));for(const c of cells)this.set(d,c,OPEN);}
reveal(i,t=0){if(this.over||i<0||i>=this.n)return null;if(this.needsLayout())throw new Error('reveal: the layout is not created yet (prepare)');const s=this.st[i];if(s===OPEN||s===FLAG)return null;const d=this.begin();this.started(i,t);if(this.mine[i])this.lose(d,[i],t);else{this.flood(d,i);this.finish(d,t);}
return this.commit(d,t,MOVE.reveal,i);}
chordable(i){if(this.over||this.st[i]!==OPEN||!this.num||!this.num[i]||this.mine[i])return false;const nb=this.nb,k=this.topo.neighbors(i,nb);let flags=0,hidden=0;for(let j=0;j<k;j++){const s=this.st[nb[j]];if(s===FLAG)flags++;else if(s!==OPEN)hidden++;}
return flags===this.num[i]&&hidden>0;}
chord(i,t=0){if(!this.chordable(i))return null;const nb=Int32Array.from(this.nb.subarray(0,this.topo.neighbors(i,this.nb)));const d=this.begin();const booms=[];for(const x of nb)if(this.st[x]!==OPEN&&this.st[x]!==FLAG&&this.mine[x])booms.push(x);if(booms.length)this.lose(d,booms,t);else{for(const x of nb)if(this.st[x]===HIDDEN||this.st[x]===MARK)this.flood(d,x);this.finish(d,t);}
return this.commit(d,t,MOVE.chord,i);}
flag(i,t=0){if(this.over||i<0||i>=this.n)return null;const s=this.st[i];if(s===OPEN)return null;const d=this.begin();if(s===HIDDEN){this.set(d,i,FLAG);this.flags++;}
else if(s===FLAG){this.set(d,i,this.cfg.marks?MARK:HIDDEN);this.flags--;}
else this.set(d,i,HIDDEN);return this.commit(d,t,MOVE.flag,i);}
canUndo(){return this.history.length>0&&this.status!=='won';}
undo(t=0){if(!this.canUndo())return null;const d=this.history.pop();for(let k=d.cells.length-1;k>=0;k--)this.st[d.cells[k]]=d.prev[k];this.status=d.status;this.opened=d.opened;this.flags=d.flags;this.boom=d.boom;this.first=d.first;this.time=d.time;this.undos++;this.moves.push([Math.max(0,Math.round(t)),MOVE.undo,-1]);return{opened:[],cells:d.cells,lost:false,won:false,boom:[],undone:true};}
apply([t,code,cell]){if(code===MOVE.reveal){if(this.needsLayout())this.prepare(this.layoutFirst(cell));return this.reveal(cell,t);}
if(code===MOVE.flag)return this.flag(cell,t);if(code===MOVE.chord)return this.chord(cell,t);if(code===MOVE.undo)return this.undo(t);return null;}
view(){return{open:(i)=>this.st[i]===OPEN&&!(this.mine&&this.mine[i]),num:this.num,mines:this.cfg.mines,flagged:(i)=>this.st[i]===FLAG,};}
progress(){return this.safeTotal?this.opened/this.safeTotal:0;}}
export{FLAG,OPEN,MARK,Game,HIDDEN};