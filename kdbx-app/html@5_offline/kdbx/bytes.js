import{readU32LE,readU64LE,writeU32LE,writeU64LE,bytesToBase64,bytesToHex,base64ToBytes,bytesToUtf8,utf8ToBytes}from"../crypto/encoding.js";import{randomBytes}from"../crypto/random.js";class Reader{constructor(bytes,pos=0){this.b=bytes;this.pos=pos;}
need(n){if(this.pos+n>this.b.length)throw new Error('unexpected end of data');}
u8(){this.need(1);return this.b[this.pos++];}
u16(){this.need(2);const v=this.b[this.pos]|(this.b[this.pos+1]<<8);this.pos+=2;return v;}
u32(){this.need(4);const v=readU32LE(this.b,this.pos);this.pos+=4;return v;}
i32(){return this.u32()|0;}
u64(){this.need(8);const v=readU64LE(this.b,this.pos);this.pos+=8;return v;}
bytes(n){this.need(n);const v=this.b.subarray(this.pos,this.pos+n);this.pos+=n;return v;}
get left(){return this.b.length-this.pos;}}
class Writer{constructor(){this.parts=[];this.length=0;}
push(b){this.parts.push(b);this.length+=b.length;return this;}
u8(v){return this.push(new Uint8Array([v]));}
u16(v){return this.push(new Uint8Array([v&255,(v>>>8)&255]));}
u32(v){const b=new Uint8Array(4);writeU32LE(b,0,v>>>0);return this.push(b);}
u64(v){const b=new Uint8Array(8);writeU64LE(b,0,v);return this.push(b);}
bytes(b){return this.push(b);}
done(){const out=new Uint8Array(this.length);let o=0;for(const p of this.parts){out.set(p,o);o+=p.length;}
return out;}}
const ZERO_UUID='AAAAAAAAAAAAAAAAAAAAAA==';const newUuid=()=>bytesToBase64(randomBytes(16));const isZeroUuid=(u)=>!u||u===ZERO_UUID;const uuidHex=(u)=>bytesToHex(base64ToBytes(u)).toUpperCase();const uuidFromHex=(hex)=>bytesToBase64(Uint8Array.from(String(hex).match(/[0-9a-f]{2}/gi)||[],(x)=>parseInt(x,16)));function uuidString(b){const h=bytesToHex(b);return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
const EPOCH_DIFF=62135596800;function timeFromXml(text){const s=String(text||'').trim();if(!s)return null;if(/^\d{4}-\d\d-\d\d/.test(s)){const d=new Date(s);return isNaN(d)?null:d;}
try{const b=base64ToBytes(s);if(b.length!==8)return null;return new Date((readU64LE(b,0)-EPOCH_DIFF)*1000);}catch{return null;}}
function timeToXml(date,v4){const d=date instanceof Date&&!isNaN(date)?date:new Date();if(!v4)return d.toISOString().replace(/\.\d{3}Z$/,'Z');const b=new Uint8Array(8);writeU64LE(b,0,Math.max(0,Math.floor(d.getTime()/1000)+EPOCH_DIFF));return bytesToBase64(b);}
const now=()=>new Date(Math.floor(Date.now()/1000)*1000);const VD={UInt32:0x04,UInt64:0x05,Bool:0x08,Int32:0x0c,Int64:0x0d,String:0x18,Bytes:0x42};function readVariantDictionary(bytes){const r=new Reader(bytes);const version=r.u16();if((version&0xff00)>0x0100)throw new Error('unsupported VariantDictionary version');const map=new Map();for(;;){const type=r.u8();if(type===0)break;const name=bytesToUtf8(r.bytes(r.i32()));const data=r.bytes(r.i32());const d=new Reader(data);let value;switch(type){case VD.UInt32:value=d.u32();break;case VD.Int32:value=d.i32();break;case VD.UInt64:value=d.u64();break;case VD.Int64:{const lo=d.u32(),hi=d.i32();value=hi*0x100000000+lo;break;}
case VD.Bool:value=data[0]!==0;break;case VD.String:value=bytesToUtf8(data);break;case VD.Bytes:value=data.slice();break;default:value=data.slice();}
map.set(name,{type,value});}
return map;}
function writeVariantDictionary(map){const w=new Writer().u16(0x0100);for(const[name,{type,value}]of map){let data;switch(type){case VD.UInt32:case VD.Int32:data=new Uint8Array(4);writeU32LE(data,0,value>>>0);break;case VD.UInt64:case VD.Int64:data=new Uint8Array(8);writeU64LE(data,0,value);break;case VD.Bool:data=new Uint8Array([value?1:0]);break;case VD.String:data=utf8ToBytes(value);break;default:data=value;}
const nm=utf8ToBytes(name);w.u8(type).u32(nm.length).bytes(nm).u32(data.length).bytes(data);}
return w.u8(0).done();}
export{now,newUuid,ZERO_UUID,isZeroUuid,uuidHex,uuidFromHex,timeFromXml,timeToXml,Reader,uuidString,readVariantDictionary,VD,writeVariantDictionary,Writer};