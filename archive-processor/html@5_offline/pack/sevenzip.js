import{crc32}from"../codec/crc32.js";import{lzma2,lzma2DictProp}from"./lzma.js";const SIG=[0x37,0x7a,0xbc,0xaf,0x27,0x1c,0,4];class Out{constructor(){this.a=[];}
b(...v){for(const x of v)this.a.push(x&255);return this;}
bytes(u){for(const x of u)this.a.push(x);return this;}
num(v){let n=0;while(n<8&&v>=2**(7*(n+1)))n++;const low=[];let x=v;for(let i=0;i<n;i++){low.push(x%256);x=Math.floor(x/256);}
const first=n===8?0xff:((0xff00>>n)&0xff)|x;this.a.push(first,...low);return this;}
u32(v){return this.b(v,v>>>8,v>>>16,v>>>24);}
u64(v){let x=BigInt(v);for(let i=0;i<8;i++){this.a.push(Number(x&255n));x>>=8n;}return this;}
get length(){return this.a.length;}
u8(){return Uint8Array.from(this.a);}}
function bitVector(bits){const out=new Uint8Array(Math.ceil(bits.length/8));bits.forEach((on,i)=>{if(on)out[i>>3]|=0x80>>(i&7);});return out;}
const msOf=(t)=>(t instanceof Date?t.getTime():typeof t==='number'?t:null);const fileTime=(ms)=>(BigInt(Math.round(ms))+11644473600000n)*10000n;function sevenZip(entries,{level=5}={}){const files=entries.map((e)=>{const dir=!!e.dir||e.kind==='dir';const link=e.kind==='symlink'&&e.link!=null;const data=link?new TextEncoder().encode(e.link):!dir&&e.data?e.data:null;return{name:String(e.path).replace(/\\/g,'/').replace(/^\/+|\/+$/g,''),dir,data,mtime:msOf(e.mtime),mode:link?0o120777:e.mode,attrib:e.attrib};});const streams=files.filter((f)=>f.data&&f.data.length);const total=streams.reduce((n,f)=>n+f.data.length,0);let packed=new Uint8Array(0),coder=null;if(streams.length){const all=new Uint8Array(total);let o=0;for(const f of streams){all.set(f.data,o);o+=f.data.length;}
const z=lzma2(all,{level});if(z.length<total){packed=z;coder=[0x21,lzma2DictProp(z.dictSize)];}else{packed=all;coder=[0x00];}}
const h=new Out();if(files.length){h.b(0x01);if(streams.length){h.b(0x04);h.b(0x06).num(0).num(1).b(0x09).num(packed.length).b(0x00);h.b(0x07,0x0b).num(1).b(0x00).num(1);if(coder.length>1)h.b(0x21,coder[0]).num(1).b(coder[1]);else h.b(0x01,0x00);h.b(0x0c).num(total).b(0x00);h.b(0x08,0x0d).num(streams.length);if(streams.length>1){h.b(0x09);for(const f of streams.slice(0,-1))h.num(f.data.length);}
h.b(0x0a,0x01);for(const f of streams)h.u32(crc32(f.data));h.b(0x00,0x00);}
h.b(0x05).num(files.length);const empty=files.map((f)=>!(f.data&&f.data.length));if(empty.some(Boolean)){const ev=bitVector(empty);h.b(0x0e).num(ev.length).bytes(ev);const emptyFiles=files.filter((f,i)=>empty[i]).map((f)=>!f.dir);if(emptyFiles.some(Boolean)){const fv=bitVector(emptyFiles);h.b(0x0f).num(fv.length).bytes(fv);}}
const names=new Out().b(0x00);for(const f of files){for(const c of f.name){const u=c.codePointAt(0);if(u>0xffff){const v=u-0x10000;names.b(0xd800+(v>>10),(0xd800+(v>>10))>>8,0xdc00+(v&1023),(0xdc00+(v&1023))>>8);}else names.b(u,u>>8);}names.b(0,0);}
h.b(0x11).num(names.length).bytes(names.a);if(files.some((f)=>f.mtime!=null)){const defined=files.map((f)=>f.mtime!=null);const all=defined.every(Boolean);const t=new Out();if(all)t.b(0x01);else t.b(0x00).bytes(bitVector(defined));t.b(0x00);for(const f of files)if(f.mtime!=null)t.u64(fileTime(f.mtime));h.b(0x14).num(t.length).bytes(t.a);}
const at=new Out().b(0x01,0x00);for(const f of files){let a=f.attrib!=null?f.attrib:f.dir?0x10:0x20;if(f.mode!=null)a=(a|0x8000|((f.mode&0xffff)<<16))>>>0;at.u32(a);}
h.b(0x15).num(at.length).bytes(at.a);h.b(0x00,0x00);}
const header=h.u8();const start=new Out().u64(packed.length).u64(header.length).u32(header.length?crc32(header):0).u8();const out=new Uint8Array(32+packed.length+header.length);out.set(SIG,0);const sc=crc32(start);out.set([sc&255,(sc>>>8)&255,(sc>>>16)&255,sc>>>24],8);out.set(start,12);out.set(packed,32);out.set(header,32+packed.length);return out;}
export{sevenZip};