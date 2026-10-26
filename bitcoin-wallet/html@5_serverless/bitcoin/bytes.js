import{hexToBytes,bytesToHex}from"../crypto/encoding.js";class Writer{constructor(size=256){this.buf=new Uint8Array(size);this.pos=0;}
ensure(n){if(this.pos+n<=this.buf.length)return;let size=this.buf.length*2;while(size<this.pos+n)size*=2;const b=new Uint8Array(size);b.set(this.buf.subarray(0,this.pos));this.buf=b;}
u8(n){this.ensure(1);this.buf[this.pos++]=n&0xff;return this;}
u16(n){this.ensure(2);this.buf[this.pos++]=n&0xff;this.buf[this.pos++]=(n>>>8)&0xff;return this;}
u32(n){this.ensure(4);const b=this.buf,o=this.pos;b[o]=n&0xff;b[o+1]=(n>>>8)&0xff;b[o+2]=(n>>>16)&0xff;b[o+3]=(n>>>24)&0xff;this.pos+=4;return this;}
i32(n){return this.u32(n>>>0);}
u64(n){if(typeof n==='bigint'){if(n<0n||n>=1n<<64n)throw new Error('u64 out of range');return this.u32(Number(n&0xffffffffn)).u32(Number(n>>32n));}
if(!Number.isSafeInteger(n)||n<0)throw new Error('u64 out of range');return this.u32(n%0x100000000).u32(Math.floor(n/0x100000000));}
varint(n){if(n<0xfd)return this.u8(n);if(n<=0xffff)return this.u8(0xfd).u16(n);if(n<=0xffffffff)return this.u8(0xfe).u32(n);return this.u8(0xff).u64(n);}
bytes(b){this.ensure(b.length);this.buf.set(b,this.pos);this.pos+=b.length;return this;}
varbytes(b){return this.varint(b.length).bytes(b);}
finish(){return this.buf.slice(0,this.pos);}}
const varintSize=(n)=>(n<0xfd?1:n<=0xffff?3:n<=0xffffffff?5:9);class Reader{constructor(bytes,pos=0){this.b=bytes;this.pos=pos;}
get left(){return this.b.length-this.pos;}
done(){return this.pos>=this.b.length;}
need(n){if(this.pos+n>this.b.length)throw new Error('unexpected end of data');}
u8(){this.need(1);return this.b[this.pos++];}
u16(){this.need(2);const b=this.b,o=this.pos;this.pos+=2;return b[o]|(b[o+1]<<8);}
u32(){this.need(4);const b=this.b,o=this.pos;this.pos+=4;return(b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0;}
i32(){return this.u32()|0;}
u64(){const lo=this.u32(),hi=this.u32();if(hi>0x1fffff)throw new Error('64-bit value above 2^53');return hi*0x100000000+lo;}
u64big(){const lo=this.u32(),hi=this.u32();return(BigInt(hi)<<32n)|BigInt(lo);}
varint(){const p=this.u8();if(p<0xfd)return p;if(p===0xfd){const n=this.u16();if(n<0xfd)throw new Error('non-canonical CompactSize');return n;}
if(p===0xfe){const n=this.u32();if(n<=0xffff)throw new Error('non-canonical CompactSize');return n;}
const n=this.u64();if(n<=0xffffffff)throw new Error('non-canonical CompactSize');return n;}
bytes(n){this.need(n);const out=this.b.subarray(this.pos,this.pos+n);this.pos+=n;return out;}
varbytes(){return this.bytes(this.varint());}}
const hexToBytesLE=(hex)=>hexToBytes(hex).reverse();const bytesToHexLE=(b)=>bytesToHex(Uint8Array.from(b).reverse());export{Writer,Reader,bytesToHexLE,hexToBytesLE,varintSize};