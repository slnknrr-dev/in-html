import{toBytes,wipe}from"./encoding.js";class HMAC{constructor(hashFn,key){if(!hashFn||!hashFn.create||hashFn.xof||hashFn.checksum)throw new Error('HMAC needs a block hash function');const bl=hashFn.blockLen;let k=toBytes(key);if(k.length>bl)k=hashFn(k);const pad=new Uint8Array(bl);pad.set(k);for(let i=0;i<bl;i++)pad[i]^=0x36;this.inner=hashFn.create().update(pad);for(let i=0;i<bl;i++)pad[i]^=0x36^0x5c;this.outer=hashFn.create().update(pad);wipe(pad);this.blockLen=bl;this.outputLen=hashFn.outputLen;}
update(data){this.inner.update(data);return this;}
digest(){return this.outer.update(this.inner.digest()).digest();}
clone(){const c=Object.create(HMAC.prototype);Object.assign(c,this,{inner:this.inner.clone(),outer:this.outer.clone()});return c;}}
function hmac(hashFn,key,data){return new HMAC(hashFn,key).update(data).digest();}
hmac.create=(hashFn,key)=>new HMAC(hashFn,key);export{hmac};