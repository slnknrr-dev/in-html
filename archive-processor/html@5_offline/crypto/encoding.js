const enc=new TextEncoder();function toBytes(data){if(data instanceof Uint8Array)return data.constructor===Uint8Array?data:new Uint8Array(data.buffer,data.byteOffset,data.byteLength);if(typeof data==='string')return enc.encode(data);if(data instanceof ArrayBuffer)return new Uint8Array(data);if(ArrayBuffer.isView(data))return new Uint8Array(data.buffer,data.byteOffset,data.byteLength);if(data==null)return new Uint8Array(0);throw new TypeError('bytes expected');}
function concatBytes(...parts){let n=0;for(const p of parts)n+=p.length;const out=new Uint8Array(n);let o=0;for(const p of parts){out.set(p,o);o+=p.length;}
return out;}
function wipe(...arrays){for(const a of arrays)if(a&&typeof a.fill==='function')a.fill(0);}
export{toBytes,wipe,concatBytes};