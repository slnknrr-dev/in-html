import{toBytes,concatBytes}from"./crypto/encoding.js";import{hmac}from"./crypto/hmac.js";class Hash{static run(steps,ctx,value){for(let i=0;i<steps.length;i++){value=steps[i](ctx,value);if(value&&typeof value.then==='function'){const rest=steps.slice(i+1);return value.then((v)=>Hash.run(rest,ctx,v));}}
return value;}
static tag(step,meta){return Object.assign(step,meta);}
static engine(fn,params={}){return Hash.tag((ctx)=>{ctx.engine=fn.create({...params,...(fn.xof&&ctx.options.dkLen?{dkLen:ctx.options.dkLen}:{})});ctx.fn=fn;},{outputLen:params.dkLen||fn.outputLen,blockLen:fn.blockLen,xof:!!fn.xof});}
static hmac(fn){return Hash.tag((ctx)=>{if(ctx.options.key!=null&&toBytes(ctx.options.key).length){ctx.engine=hmac.create(fn,ctx.options.key);ctx.keyed=true;}},{keyed:true});}
static keyedEngine(fn,params={}){return Hash.tag((ctx)=>{const key=ctx.options.key!=null?toBytes(ctx.options.key):null;ctx.engine=fn.create({...params,...(key&&key.length?{key:key.subarray(0,params.maxKey||64)}:{})});ctx.keyed=!!(key&&key.length);},{keyed:true,outputLen:params.dkLen||fn.outputLen});}
static mac(make,keyLen){return Hash.tag((ctx)=>{const key=toBytes(ctx.options.key||new Uint8Array(0));if(key.length!==keyLen)throw new Error(`key must be ${keyLen} bytes`);ctx.engine=make(key);ctx.keyed=true;},{keyed:'required',keyLen});}
static bytes(ctx,value){return toBytes(value);}
static absorb(ctx,value){ctx.engine.update(value);ctx.length+=value.length;return value;}
static collect(ctx,value){ctx.parts.push(value.slice());ctx.length+=value.length;return value;}
static squeeze(ctx){return ctx.engine.digest();}
static derive(derive,defaults={}){return Hash.tag((ctx)=>{const input=concatBytes(...ctx.parts);ctx.parts.length=0;return derive(input,{...defaults,...ctx.options});},{kdf:true,defaults});}}
class HashContext{constructor(def,options){this.def=def;this.options=options||{};this.engine=null;this.keyed=false;this.length=0;this.parts=[];Hash.run(def.initialize,this,this.options);}
update(data){Hash.run(this.def.update,this,data);return this;}
digest(){return Hash.run(this.def.finalize,this,undefined);}}
class DiscoverableHash extends Hash{static registry=new Map();constructor(id,spec){super();const all=[...spec.initialize,...spec.update,...spec.finalize];const find=(k)=>all.find((s)=>s[k]!=null);this.id=id;this.label=spec.label||id;this.group=spec.group||'other';this.note=spec.note||'';this.initialize=spec.initialize;this.update=spec.update;this.finalize=spec.finalize;this.keyed=find('keyed')?find('keyed').keyed:false;this.keyLen=find('keyLen')?find('keyLen').keyLen:0;this.kdf=!!find('kdf');this.defaults=this.kdf?find('kdf').defaults:{};this.outputLen=find('outputLen')?find('outputLen').outputLen:this.defaults.dkLen||32;this.xof=!!(find('xof')&&find('xof').xof);DiscoverableHash.registry.set(id,this);}
create(options){return new HashContext(this,options);}}
function getHashes(){return[...DiscoverableHash.registry.keys()];}
function getHash(id){return DiscoverableHash.registry.get(id)||null;}
function createHash(id,...args){const hash=DiscoverableHash.registry.get(id);if(!hash)
throw new Error(`unknown hash: ${id}`);return hash.create(...args);}
export{DiscoverableHash,Hash,createHash,getHashes,getHash};