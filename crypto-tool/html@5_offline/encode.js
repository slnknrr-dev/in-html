import{toBytes,bytesToUtf8,utf8ToBytes}from"./crypto/encoding.js";class Encode{static run(steps,ctx,value){for(const step of steps)value=step(ctx,value);return value;}
static tag(step,meta){return Object.assign(step,meta);}
static opt(key,def,extra={}){const type=extra.choices?'choice':typeof def==='boolean'?'bool':typeof def==='number'?'number':'text';return{key,def,type,...extra};}
static codec(fn,...opts){return Encode.tag((ctx,v)=>fn(v,ctx.options),{opts});}
static bytes(ctx,value){return toBytes(value);}
static text=Encode.tag((ctx,value)=>(typeof value==='string'?value:bytesToUtf8(toBytes(value))),{textual:true});static utf8(ctx,value){return utf8ToBytes(value);}
static strip(ctx,value){return String(value).replace(/\s+/g,'');}
static facts(ctx,value){const{bytes,...rest}=value;Object.assign(ctx.info,rest);return bytes;}
static wrap(def,lengths=[64,76]){return Encode.tag((ctx,s)=>{const n=+ctx.options.wrap;return n>0&&s.length>n?s.match(new RegExp(`.{1,${n}}`,'g')).join('\n'):s;},{opts:[Encode.opt('wrap',def,{choices:[{v:0,l:'opt.none'},...lengths.map((v)=>({v,l:'='+v}))]})]});}
static padding(def){return Encode.tag((ctx,s)=>(ctx.options.pad?s:s.replace(/=+$/,'')),{opts:[Encode.opt('pad',def)]});}}
class EncodingContext{constructor(def,options){this.def=def;this.options={...def.defaults,...(options||{})};this.info={};}
encode(data){this.info={};return Encode.run(this.def.encode,this,data);}
decode(text){this.info={};return Encode.run(this.def.decode,this,text);}}
class DiscoverableEncoding extends Encode{static registry=new Map();constructor(id,spec){super();const all=[...spec.encode,...spec.decode];const has=(k)=>all.some((s)=>s[k]);this.id=id;this.label=spec.label||id;this.group=spec.group||'other';this.note=spec.note||'';this.ext=spec.ext||'txt';this.encode=spec.encode;this.decode=spec.decode;const options=new Map();for(const[dir,steps]of[['encode',spec.encode],['decode',spec.decode]]){for(const o of steps.flatMap((s)=>s.opts||[])){const seen=options.get(o.key);options.set(o.key,seen&&seen.dir!==dir?{...seen,dir:'both'}:{...o,dir});}}
this.options=[...options.values()];this.defaults=Object.fromEntries(this.options.map((o)=>[o.key,o.def]));this.textual=has('textual');this.binary=has('binary');this.caseless=has('caseless');this.checksum=has('checksum');const q=all.find((s)=>s.quadratic);this.quadratic=q?q.quadratic:false;DiscoverableEncoding.registry.set(id,this);}
isQuadratic(options){return typeof this.quadratic==='function'?!!this.quadratic({...this.defaults,...(options||{})}):this.quadratic;}
create(options){return new EncodingContext(this,options);}}
function getEncodings(){return[...DiscoverableEncoding.registry.keys()];}
function getEncoding(id){return DiscoverableEncoding.registry.get(id)||null;}
function createEncoding(id,...args){const enc=DiscoverableEncoding.registry.get(id);if(!enc)
throw new Error(`unknown encoding: ${id}`);return enc.create(...args);}
export{Encode,DiscoverableEncoding,getEncodings,getEncoding,createEncoding};