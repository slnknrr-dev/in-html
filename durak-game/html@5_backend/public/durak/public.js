import{compile}from"./ruleset.js";const LF=[0];function log2Fact(k){for(let i=LF.length;i<=k;i++)LF[i]=LF[i-1]+Math.log2(i);return LF[k];}
function track({rs,n,trumpCard=-1,trumpSuit=null,handSize=null,counts=null}){const C=compile(rs);const hs=handSize??rs.rules.handSize;const T={C,rs,n,trumpCard,trumpSuit,counts:counts?counts.slice():Array.from({length:n},()=>hs),stock:C.N-(counts?counts.reduce((a,b)=>a+b,0):n*hs),known:Array.from({length:n},()=>new Set()),located:new Set(),table:[],discard:[],out:[],defender:-1,taking:false,trumpInStock:false,history:[],step:null,run:null,events:0,};if(trumpCard>=0&&T.stock>0){T.located.add(trumpCard);T.trumpInStock=true;}
const fromHand=(seat,u)=>{T.counts[seat]--;const k=T.known[seat];if(k.has(u))k.delete(u);else{const d=C.uidDef[u];for(const v of k)if(C.uidDef[v]===d){k.delete(v);T.located.delete(v);break;}}
T.located.add(u);};T.step=(e)=>{T.events++;const[k,seat]=e;switch(k){case'L':case'+':{for(const u of e[2]){fromHand(seat,u);T.table.push({a:u,d:-1,by:seat});}
if(k==='L')T.history.push({kind:'lead',seat,cards:e[2],table:[]});else T.history.push({kind:'throw',seat,cards:e[2],table:T.table.map((p)=>p.a)});break;}
case'B':{const u=e[2],slot=e[3];fromHand(seat,u);if(T.table[slot])T.table[slot].d=u;T.defender=seat;T.history.push({kind:'beat',seat,card:u,on:T.table[slot]?T.table[slot].a:-1});break;}
case'T':{const show=!!e[3];if(show){for(const u of e[2]){T.known[seat].add(u);T.located.add(u);}}
else for(const u of e[2]){fromHand(seat,u);T.table.push({a:u,d:-1,by:seat});}
T.history.push({kind:'transfer',seat,cards:e[2],show});break;}
case'X':{T.taking=true;T.defender=seat;T.history.push({kind:'take',seat,open:T.table.filter((p)=>p.d<0).map((p)=>p.a)});break;}
case'P':{T.history.push({kind:'pass',seat,table:T.table.flatMap((p)=>(p.d>=0?[p.a,p.d]:[p.a]))});break;}
case'S':{const given=e[2],got=e[3];fromHand(seat,given);T.counts[seat]++;T.known[seat].add(got);T.located.add(got);T.trumpCard=given;T.history.push({kind:'swap',seat,given,got});break;}
case'/':{const took=e[1],def=e[2];const cards=T.table.flatMap((p)=>(p.d>=0?[p.a,p.d]:[p.a]));if(took&&def>=0){for(const u of cards)T.known[def].add(u);T.counts[def]+=cards.length;}
else T.discard.push(...cards);T.table=[];T.taking=false;break;}
case'D':{const cnt=e[2],tu=e[3];T.counts[seat]+=cnt;T.stock-=cnt;if(tu>=0){T.known[seat].add(tu);T.located.add(tu);T.trumpInStock=false;}
break;}
case'O':T.out.push(seat);break;default:break;}};T.run=(log)=>{for(const e of log)T.step(e);return T;};return T;}
function hiddenBins(T){const bins=T.counts.map((c,i)=>Math.max(0,c-T.known[i].size));bins.push(Math.max(0,T.stock-(T.trumpInStock?1:0)));return bins;}
function hiddenEntropy(T){const bins=hiddenBins(T);const U=bins.reduce((a,b)=>a+b,0);let h=log2Fact(U);for(const k of bins)h-=log2Fact(k);return Math.max(0,h);}
function initialTrump(v){let t=v.trumpCard;for(let i=v.log.length-1;i>=0;i--)if(v.log[i][0]==='S')t=v.log[i][3];return t;}
export{track,initialTrump,hiddenEntropy};