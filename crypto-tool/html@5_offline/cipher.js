import{toBytes,concatBytes}from"./crypto/encoding.js";class Cipher{static run(steps,ctx,value){for(const step of steps)value=step(ctx,value);return value;}
static tag(step,meta){return Object.assign(step,meta);}
static key(...sizes){return Cipher.tag((ctx,o)=>{const k=toBytes(o.key||new Uint8Array(0));if(!sizes.includes(k.length))throw new Error(`key must be ${sizes.join(' / ')} bytes`);ctx.key=k;return o;},{keySizes:sizes});}
static iv(...sizes){return Cipher.tag((ctx,o)=>{const v=toBytes(o.iv||new Uint8Array(0));if(!sizes.includes(v.length))throw new Error(`IV / nonce must be ${sizes.join(' / ')} bytes`);ctx.iv=v;return o;},{ivSizes:sizes});}
static engine(make,meta={}){return Cipher.tag((ctx,o)=>{ctx.engine=make(ctx,o);return o;},meta);}
static bytes(ctx,value){return toBytes(value);}
static detachTag(n){return Cipher.tag((ctx,value)=>{if(!ctx.decrypt)return value;const all=ctx.tail?concatBytes(ctx.tail,value):value;const cut=Math.max(0,all.length-n);ctx.tail=all.slice(cut);return all.subarray(0,cut);},{tagLength:n,aead:true});}
static transform(ctx,value){return ctx.engine.update(value);}
static verifyTag(ctx,value){if(ctx.decrypt){const tag=ctx.options.tag?toBytes(ctx.options.tag):ctx.tail;if(!tag||tag.length<12)throw new Error('ciphertext too short: the authentication tag is missing');ctx.engine.setTag(tag);}
return value;}
static flush(ctx){return ctx.engine.final();}
static appendTag(ctx,value){if(ctx.decrypt)return value;ctx.tag=ctx.engine.getTag();return ctx.options.detachedTag?value:concatBytes(value,ctx.tag);}}
class CipherContext{constructor(def,options={}){this.def=def;this.options=options;this.decrypt=!!options.decrypt;this.engine=null;this.tail=null;this.tag=null;Cipher.run(def.initialize,this,options);}
update(chunk){return Cipher.run(this.def.update,this,chunk);}
final(){return Cipher.run(this.def.finalize,this,undefined);}}
class DiscoverableCipher extends Cipher{static registry=new Map();constructor(id,spec){super();const all=[...spec.initialize,...spec.update,...spec.finalize];const find=(k)=>all.find((s)=>s[k]!=null);this.id=id;this.label=spec.label||id;this.group=spec.group||'other';this.note=spec.note||'';this.initialize=spec.initialize;this.update=spec.update;this.finalize=spec.finalize;this.keySizes=find('keySizes')?find('keySizes').keySizes:[];this.ivSizes=find('ivSizes')?find('ivSizes').ivSizes:[];this.aead=!!find('aead');this.tagLength=find('tagLength')?find('tagLength').tagLength:0;this.padding=!!find('padding');this.block=find('blockSize')?find('blockSize').blockSize:1;DiscoverableCipher.registry.set(id,this);}
create(options){return new CipherContext(this,options);}
apply(data,options){const c=this.create(options);return concatBytes(c.update(data),c.final());}}
function getCiphers(){return[...DiscoverableCipher.registry.keys()];}
function getCipher(id){return DiscoverableCipher.registry.get(id)||null;}
function createCipher(id,...args){const cipher=DiscoverableCipher.registry.get(id);if(!cipher)
throw new Error(`unknown cipher: ${id}`);return cipher.create(...args);}
export{DiscoverableCipher,Cipher,getCipher,getCiphers,createCipher};