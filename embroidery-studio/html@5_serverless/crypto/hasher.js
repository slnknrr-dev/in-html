import{toBytes}from"./encoding.js";function hasher(algo,make,blockLen,outputLen){const fn=(data,opts)=>make(opts).update(data).digest();fn.create=(opts)=>make(opts);fn.algo=algo;fn.blockLen=blockLen;fn.outputLen=outputLen;return fn;}
class MDHasher{constructor(blockLen,outputLen,lengthBytes,littleEndian){this.blockLen=blockLen;this.outputLen=outputLen;this.lengthBytes=lengthBytes;this.le=littleEndian;this.buffer=new Uint8Array(blockLen);this.pos=0;this.length=0;this.done=false;}
update(data){if(this.done)throw new Error('digest already computed');const d=toBytes(data);const n=d.length,bl=this.blockLen,buf=this.buffer;this.length+=n;let i=0;if(this.pos){const take=Math.min(bl-this.pos,n);buf.set(d.subarray(0,take),this.pos);this.pos+=take;i=take;if(this.pos===bl){this.process(buf,0);this.pos=0;}}
for(;i+bl<=n;i+=bl)this.process(d,i);if(i<n){buf.set(d.subarray(i),0);this.pos=n-i;}
return this;}
digest(){if(this.done)throw new Error('digest already computed');this.done=true;const bl=this.blockLen,buf=this.buffer;buf[this.pos++]=0x80;buf.fill(0,this.pos);if(this.pos>bl-this.lengthBytes){this.process(buf,0);buf.fill(0);}
const bits=this.length*8;const hi=Math.floor(bits/0x100000000)>>>0,lo=bits>>>0;if(this.le){const o=bl-this.lengthBytes;buf[o]=lo;buf[o+1]=lo>>>8;buf[o+2]=lo>>>16;buf[o+3]=lo>>>24;buf[o+4]=hi;buf[o+5]=hi>>>8;buf[o+6]=hi>>>16;buf[o+7]=hi>>>24;}else{const o=bl-8;buf[o]=hi>>>24;buf[o+1]=hi>>>16;buf[o+2]=hi>>>8;buf[o+3]=hi;buf[o+4]=lo>>>24;buf[o+5]=lo>>>16;buf[o+6]=lo>>>8;buf[o+7]=lo;}
this.process(buf,0);const out=this.output();this.destroy();return out;}
restoreFrom(o){this.state.set(o.state);this.buffer.set(o.buffer);this.pos=o.pos;this.length=o.length;this.done=o.done;return this;}
clone(){const c=Object.create(Object.getPrototypeOf(this));for(const[k,v]of Object.entries(this))c[k]=ArrayBuffer.isView(v)?v.slice():v;return c;}
destroy(){this.buffer.fill(0);if(this.state)this.state.fill(0);}}
function wordsBE(words,n){const out=new Uint8Array(n);for(let i=0;i<n;i++)out[i]=words[i>>2]>>>(24-8*(i&3));return out;}
export{MDHasher,wordsBE,hasher};