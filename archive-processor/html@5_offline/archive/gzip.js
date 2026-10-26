import{crc32}from"../codec/crc32.js";import{Inflater}from"../codec/zlib.js";import{fail,corrupt,unixTime,decodeText}from"./io.js";const OS=['FAT','Amiga','VMS','Unix','VM/CMS','Atari TOS','HPFS','Macintosh','Z-System','CP/M','TOPS-20','NTFS','QDOS','Acorn RISCOS'];function readHeader(next,charset='auto'){const id1=next(),id2=next();if(id1!==0x1f||id2!==0x8b)return null;const cm=next(),flg=next();if(cm!==8)fail('unsupported','not supported: gzip compression method '+cm);if(flg&0xe0)corrupt('gzip flags');let t=0;for(let i=0;i<4;i++)t+=next()*2**(8*i);const xfl=next(),os=next();if(os<0||xfl<0)fail('truncated','unexpected end of gzip header');const h={mtime:t?unixTime(t):null,os:OS[os]||(os===255?'unknown':'OS '+os),name:'',comment:'',extra:null,length:10};if(flg&4){const n=next()|(next()<<8);h.extra=new Uint8Array(n);for(let i=0;i<n;i++){const b=next();if(b<0)fail('truncated','unexpected end of gzip header');h.extra[i]=b;}
h.length+=2+n;}
const zstr=()=>{const b=[];for(let c;(c=next())!==0;){if(c<0)fail('truncated','unexpected end of gzip header');b.push(c);}
h.length+=b.length+1;return decodeText(Uint8Array.from(b),charset);};if(flg&8)h.name=zstr();if(flg&16)h.comment=zstr();if(flg&2){next();next();h.length+=2;}
return h;}
function gzipHeader(bytes,charset){let i=0;try{return readHeader(()=>(i<bytes.length?bytes[i++]:-1),charset);}catch{return null;}}
function gzipStream(reader,{multi=true}={}){let inf=null,crc=0,size=0,done=false,members=0;const startMember=()=>{const h=readHeader(()=>reader.byte());if(!h){if(!members)corrupt('gzip signature');return false;}
inf=new Inflater(reader);crc=0;size=0;members++;return true;};return{read(max=1<<20){while(!done){if(!inf&&!startMember()){done=true;break;}
const out=inf.read(max);if(out){crc=crc32(out,0,out.length,crc);size+=out.length;return out;}
const t=[];for(let i=0;i<8;i++){const b=inf.alignedByte();if(b<0)fail('truncated','unexpected end of gzip data (trailer)');t.push(b);}
const wantCrc=(t[0]|(t[1]<<8)|(t[2]<<16)|(t[3]<<24))>>>0;const wantSize=(t[4]|(t[5]<<8)|(t[6]<<16)|(t[7]<<24))>>>0;if(wantCrc!==crc)fail('checksum','gzip CRC-32 mismatch');if(wantSize!==size%4294967296)corrupt('gzip size');inf=null;if(!multi)done=true;else{const b=reader.byte();if(b<0||b!==0x1f)done=true;else reader.unread();}}
return null;},};}
function lzwStream(reader){const flags=reader.u8('compress header');const maxBits=flags&0x1f,block=(flags&0x80)!==0;if(maxBits<9||maxBits>16)corrupt('compress header');const maxCode=1<<maxBits;const prefix=new Uint16Array(maxCode),suffix=new Uint8Array(maxCode),stack=new Uint8Array(maxCode+1);for(let i=0;i<256;i++)suffix[i]=i;let bits=9,free=block?257:256,old=-1,fin=0,bb=0,bc=0,done=false;let pos=0,start=0,out=new Uint8Array(1<<16);const code=()=>{while(bc<bits){const c=reader.byte();if(c<0)return-1;bb|=c<<bc;bc+=8;}
const v=bb&((1<<bits)-1);bb>>>=bits;bc-=bits;pos+=bits;return v;};const align=()=>{const g=bits*8;const target=start+Math.ceil((pos-start)/g)*g;let need=target-pos;if(need<=bc){bb>>>=need;bc-=need;}else{need-=bc;bb=0;bc=0;for(;need>0;need-=8)if(reader.byte()<0)break;}
pos=start=target;};return{read(max=1<<20){if(done)return null;if(out.length<max+maxCode)out=new Uint8Array(max+maxCode);let o=0;while(o<max){const c=code();if(c<0){done=true;break;}
if(c===256&&block){align();free=257;old=-1;bits=9;continue;}
if(old<0){if(c>255)corrupt('compress data');old=fin=c;out[o++]=c;continue;}
let cur=c,sp=0;if(cur>=free){if(cur>free)corrupt('compress data');stack[sp++]=fin;cur=old;}
while(cur>255){stack[sp++]=suffix[cur];cur=prefix[cur];}
fin=cur;out[o++]=fin;while(sp)out[o++]=stack[--sp];if(free<maxCode){prefix[free]=old;suffix[free]=fin;free++;if(free>=1<<bits&&bits<maxBits){align();bits++;}}
old=c;}
return o?out.subarray(0,o):null;},};}
export{gzipStream,lzwStream,gzipHeader};