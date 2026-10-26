import{crc32 as crcFn}from"../codec/crc32.js";import{toBytes}from"./encoding.js";class Running{constructor(fn,init){this.fn=fn;this.value=init;this.blockLen=1;this.outputLen=4;this.done=false;}
update(data){if(this.done)throw new Error('digest already computed');const d=toBytes(data);this.value=this.fn(d,0,d.length,this.value);return this;}
digest(){this.done=true;const v=this.value;return new Uint8Array([v>>>24,(v>>>16)&0xff,(v>>>8)&0xff,v&0xff]);}
restoreFrom(o){this.value=o.value;this.done=o.done;return this;}
clone(){const c=new Running(this.fn,this.value);c.done=this.done;return c;}}
const make=(algo,fn,init)=>{const h=(data)=>new Running(fn,init).update(data).digest();h.create=()=>new Running(fn,init);h.algo=algo;h.blockLen=1;h.outputLen=4;h.checksum=true;return h;};const crc32=make('crc32',crcFn,0);export{crc32};