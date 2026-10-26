class Graph{constructor(){this.chains=[];this.counters={};}
get empty(){return this.chains.length===0;}
label(prefix='v'){this.counters[prefix]=(this.counters[prefix]||0)+1;return prefix+this.counters[prefix];}
chain(ins,filters,outs,ref=null){const list=filters.filter(Boolean).map((x)=>(typeof x==='string'?{text:x,ref}:{text:x.text,ref:x.ref??ref}));if(!list.length)list.push({text:ins.length>1?'concat':'null',ref});const c={ins:[...ins],filters:list,outs:[...outs],ref};this.chains.push(c);return c;}
relabel(from,to){for(const c of this.chains){c.ins=c.ins.map((x)=>(x===from?to:x));c.outs=c.outs.map((x)=>(x===from?to:x));}}
pieces(){const out=[];this.chains.forEach((c,ci)=>{const last=ci===this.chains.length-1;c.filters.forEach((fl,i)=>{let text=fl.text;if(i===0)text=c.ins.map((x)=>`[${x}]`).join('')+text;if(i===c.filters.length-1)text+=c.outs.map((x)=>`[${x}]`).join('')+(last?'':';');else text+=',';out.push({text,ref:fl.ref});});});return out;}
text(){return this.pieces().map((p)=>p.text).join('');}}
export{Graph};