import{Salsa20}from"../crypto/salsa.js";import{ChaCha20}from"../crypto/chacha.js";import{sha256,sha512}from"../crypto/sha2.js";import{utf8ToBytes,wipe,bytesToUtf8}from"../crypto/encoding.js";import{randomBytes}from"../crypto/random.js";class ProtectedValue{constructor(masked,pad){this.masked=masked;this.pad=pad;}
static fromBytes(bytes){const pad=randomBytes(bytes.length),masked=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i++)masked[i]=bytes[i]^pad[i];return new ProtectedValue(masked,pad);}
static fromString(s){const b=utf8ToBytes(String(s));const v=ProtectedValue.fromBytes(b);wipe(b);return v;}
getBytes(){const out=new Uint8Array(this.masked.length);for(let i=0;i<out.length;i++)out[i]=this.masked[i]^this.pad[i];return out;}
getText(){const b=this.getBytes();const s=bytesToUtf8(b);wipe(b);return s;}
get length(){return this.masked.length;}
get byteLength(){return this.masked.length;}
equals(other){const a=this.getBytes(),b=other instanceof ProtectedValue?other.getBytes():utf8ToBytes(String(other));let d=a.length^b.length;for(let i=0;i<Math.min(a.length,b.length);i++)d|=a[i]^b[i];wipe(a,b);return d===0;}
clone(){return new ProtectedValue(this.masked.slice(),this.pad.slice());}
destroy(){wipe(this.masked,this.pad);}
toString(){return'[protected]';}
toJSON(){return'[protected]';}}
const INNER_STREAM={none:0,arcfour:1,salsa20:2,chacha20:3};const SALSA_IV=new Uint8Array([0xe8,0x30,0x09,0x4b,0x97,0x20,0x5d,0x2a]);function createInnerStream(id,key){let cipher;if(id===INNER_STREAM.salsa20)cipher=new Salsa20(sha256(key),SALSA_IV);else if(id===INNER_STREAM.chacha20){const h=sha512(key);cipher=new ChaCha20(h.subarray(0,32),h.subarray(32,44));}else if(id===INNER_STREAM.none)cipher={update:(b)=>b.slice()};else throw new Error('unsupported inner random stream '+id);return{apply:(bytes)=>cipher.update(bytes),destroy:()=>cipher.destroy&&cipher.destroy()};}
export{ProtectedValue,INNER_STREAM,createInnerStream};