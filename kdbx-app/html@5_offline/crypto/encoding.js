import{b64encode,b64decode}from"../codec/base64.js";const enc=new TextEncoder();const dec=new TextDecoder('utf-8');const decStrict=new TextDecoder('utf-8',{fatal:true});const utf8ToBytes=(s)=>enc.encode(String(s));const bytesToUtf8=(b,fatal=false)=>(fatal?decStrict:dec).decode(b);function toBytes(data){if(data instanceof Uint8Array)return data.constructor===Uint8Array?data:new Uint8Array(data.buffer,data.byteOffset,data.byteLength);if(typeof data==='string')return enc.encode(data);if(data instanceof ArrayBuffer)return new Uint8Array(data);if(ArrayBuffer.isView(data))return new Uint8Array(data.buffer,data.byteOffset,data.byteLength);if(data==null)return new Uint8Array(0);throw new TypeError('bytes expected');}
const HEX=Array.from({length:256},(_,i)=>i.toString(16).padStart(2,'0'));function bytesToHex(b){let s='';for(let i=0;i<b.length;i++)s+=HEX[b[i]];return s;}
function hexToBytes(hex){const s=String(hex).replace(/[\s:-]+/g,'');if(s.length%2||/[^0-9a-f]/i.test(s))throw new Error('invalid hex');const out=new Uint8Array(s.length/2);for(let i=0;i<out.length;i++)out[i]=parseInt(s.substr(i*2,2),16);return out;}
const bytesToBase64=(b)=>b64encode(b);function base64ToBytes(s){const t=String(s).replace(/\s+/g,'');if(!/^[A-Za-z0-9+/_-]*={0,2}$/.test(t)||t.replace(/=+$/,'').length%4===1)throw new Error('invalid base64');return b64decode(t);}
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';function bytesToBase32(b,pad=true){let out='',bits=0,acc=0;for(let i=0;i<b.length;i++){acc=(acc<<8)|b[i];bits+=8;while(bits>=5){out+=B32[(acc>>>(bits-5))&31];bits-=5;}
acc&=0xff;}
if(bits)out+=B32[(acc<<(5-bits))&31];if(pad)while(out.length%8)out+='=';return out;}
function base32ToBytes(s){const t=String(s).toUpperCase().replace(/[\s=-]+/g,'');const out=new Uint8Array(Math.floor((t.length*5)/8));let bits=0,acc=0,o=0;for(let i=0;i<t.length;i++){const v=B32.indexOf(t[i]);if(v<0)throw new Error('invalid base32');acc=((acc<<5)|v)&0xffff;bits+=5;if(bits>=8){out[o++]=(acc>>>(bits-8))&0xff;bits-=8;}}
return out;}
function concatBytes(...parts){let n=0;for(const p of parts)n+=p.length;const out=new Uint8Array(n);let o=0;for(const p of parts){out.set(p,o);o+=p.length;}
return out;}
function equalBytes(a,b){if(!a||!b||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0;}
function wipe(...arrays){for(const a of arrays)if(a&&typeof a.fill==='function')a.fill(0);}
const readU32LE=(b,o)=>(b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0;function writeU32LE(b,o,v){b[o]=v;b[o+1]=v>>>8;b[o+2]=v>>>16;b[o+3]=v>>>24;}
const readU64LE=(b,o)=>readU32LE(b,o)+readU32LE(b,o+4)*0x100000000;function writeU64LE(b,o,v){writeU32LE(b,o,v>>>0);writeU32LE(b,o+4,Math.floor(v/0x100000000)>>>0);}
export{readU32LE,readU64LE,writeU32LE,writeU64LE,bytesToBase64,bytesToHex,base64ToBytes,bytesToUtf8,utf8ToBytes,toBytes,wipe,concatBytes,hexToBytes,equalBytes,base32ToBytes,bytesToBase32};