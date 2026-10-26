import{crc32}from"../codec/crc32.js";class ArchiveError extends Error{constructor(code,message,detail){super(message);this.name='ArchiveError';this.code=code;if(detail)Object.assign(this,detail);}}
const fail=(code,message,detail)=>{throw new ArchiveError(code,message,detail);};const corrupt=(what)=>fail('corrupt','corrupt data: '+what);const unsupported=(what)=>fail('unsupported','not supported: '+what);const EMPTY=new Uint8Array(0);const toU8=(b)=>(b instanceof Uint8Array?b:ArrayBuffer.isView(b)?new Uint8Array(b.buffer,b.byteOffset,b.byteLength):new Uint8Array(b));function bytesSource(bytes,name=''){const b=toU8(bytes);return{name,size:b.length,bytes:b,read:(off,len)=>b.subarray(Math.min(off,b.length),Math.min(b.length,off+len))};}
function fileSource(file,name=file.name||''){const reader=new FileReaderSync();const BLOCK=65536,KEEP=32;const cache=new Map();const stats={read:0};const raw=(off,len)=>{const b=new Uint8Array(reader.readAsArrayBuffer(file.slice(off,off+len)));stats.read+=b.length;return b;};const block=(i)=>{let b=cache.get(i);if(b){cache.delete(i);cache.set(i,b);return b;}
b=raw(i*BLOCK,BLOCK);cache.set(i,b);if(cache.size>KEEP)cache.delete(cache.keys().next().value);return b;};return{name,size:file.size,stats,file,read(off,len){len=Math.max(0,Math.min(len,file.size-off));if(len<=0)return EMPTY;if(len>=4*BLOCK)return raw(off,len);const first=Math.floor(off/BLOCK),last=Math.floor((off+len-1)/BLOCK);if(first===last){const b=block(first);return b.subarray(off-first*BLOCK,off-first*BLOCK+len);}
const out=new Uint8Array(len);for(let i=first,o=0;i<=last;i++){const b=block(i);const s=i===first?off-first*BLOCK:0;const e=Math.min(b.length,off+len-i*BLOCK);out.set(b.subarray(s,e),o);o+=e-s;}
return out;},};}
function concatSource(sources,name=sources[0]?sources[0].name:''){if(sources.length===1)return sources[0];const starts=[];let size=0;for(const s of sources){starts.push(size);size+=s.size;}
return{name,size,parts:sources,starts,read(off,len){len=Math.max(0,Math.min(len,size-off));if(len<=0)return EMPTY;let i=0;while(i+1<sources.length&&starts[i+1]<=off)i++;if(off+len<=starts[i]+sources[i].size)return sources[i].read(off-starts[i],len);const out=new Uint8Array(len);for(let o=0;o<len;i++){const b=sources[i].read(off+o-starts[i],Math.min(len-o,sources[i].size-(off+o-starts[i])));out.set(b,o);o+=b.length;if(!b.length)break;}
return out;},};}
function readAt(src,off,len){const b=src.read(off,len);if(b.length<len)fail('truncated',`unexpected end of ${src.name||'archive'} at ${off+b.length}`);return b;}
const CHUNK=1<<20;function sourceStream(src,offset=0,length=src.size-offset,chunk=CHUNK){let pos=offset;const end=offset+length;return{size:length,read(max=chunk){if(pos>=end)return null;const b=src.read(pos,Math.min(max,chunk,end-pos));if(!b.length)fail('truncated',`unexpected end of ${src.name||'archive'} at ${pos}`);pos+=b.length;return b;},};}
function bytesStream(bytes){let b=toU8(bytes),done=false;return{size:b.length,read(max=CHUNK){if(done||!b.length){done=true;return null;}const r=b.subarray(0,max);b=b.subarray(r.length);return r;}};}
function concatStreams(streams){let i=0;const size=streams.every((s)=>s.size!=null)?streams.reduce((n,s)=>n+s.size,0):undefined;return{size,read(max){while(i<streams.length){const s=typeof streams[i]==='function'?(streams[i]=streams[i]()):streams[i];const b=s.read(max);if(b&&b.length)return b;i++;}
return null;},};}
function limitStream(stream,n,what='data'){let left=n;return{size:n,read(max=CHUNK){if(left<=0)return null;const b=stream.read(Math.min(max,left));if(!b||!b.length)fail('truncated',`unexpected end of ${what}`);const r=b.length>left?b.subarray(0,left):b;left-=r.length;return r;},};}
function readAll(stream,limit=Infinity){const parts=[];let n=0;for(let b;(b=stream.read(CHUNK));){n+=b.length;if(n>limit)fail('limit','data larger than '+limit+' bytes');parts.push(b.slice());}
return concat(parts,n);}
function hashStream(stream,update,check,{name='',size}={}){let n=0,done=false;return{size:stream.size??size,read(max){if(done)return null;const b=stream.read(max);if(b&&b.length){update(b);n+=b.length;return b;}
done=true;if(size!=null&&n!==size)fail('corrupt',`size mismatch${name?': '+name:''} (${n} of ${size} bytes)`);if(!check())fail('checksum',`checksum mismatch${name?': '+name:''}`,{file:name});return null;},};}
function crcStream(stream,expected,opts={}){let c=0;return hashStream(stream,(b)=>{c=crc32(b,0,b.length,c);},()=>expected==null||c===expected>>>0,opts);}
class Reader{constructor(stream,chunk=CHUNK){this.s=stream;this.chunkSize=chunk;this.b=EMPTY;this.p=0;this.e=0;this.base=0;this.done=false;}
get pos(){return this.base+this.p;}
fill(){if(this.done)return false;const c=this.s.read(this.chunkSize);if(!c||!c.length){this.done=true;return false;}
this.base+=this.e;this.b=c;this.p=0;this.e=c.length;return true;}
byte(){if(this.p<this.e)return this.b[this.p++];return this.fill()?this.b[this.p++]:-1;}
eof(){return this.p>=this.e&&!this.fill();}
unread(){if(this.p>0)this.p--;}
chunk(max){if(this.p>=this.e&&!this.fill())return null;const n=Math.min(max,this.e-this.p);const r=this.b.subarray(this.p,this.p+n);this.p+=n;return r;}
bytes(n,what='data'){const out=new Uint8Array(n);for(let o=0;o<n;){const c=this.chunk(n-o);if(!c)fail('truncated','unexpected end of '+what);out.set(c,o);o+=c.length;}
return out;}
skip(n,what='data'){while(n>0){const c=this.chunk(Math.min(n,CHUNK));if(!c)fail('truncated','unexpected end of '+what);n-=c.length;}}
u8(what){const v=this.byte();if(v<0)fail('truncated','unexpected end of '+(what||'data'));return v;}
u16(what){return this.u8(what)|(this.u8(what)<<8);}
u32(what){return(this.u16(what)|(this.u16(what)<<16))>>>0;}}
const le16=(b,o)=>b[o]|(b[o+1]<<8);const le32=(b,o)=>(b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0;const le64=(b,o)=>le32(b,o)+le32(b,o+4)*4294967296;function concat(parts,total){if(parts.length===1&&(total==null||parts[0].length===total))return parts[0];const n=total??parts.reduce((s,p)=>s+p.length,0);const out=new Uint8Array(n);let o=0;for(const p of parts){out.set(p,o);o+=p.length;}
return out;}
function dosDateTime(time,date){if(!date&&!time)return null;const d=new Date(((date>>9)&0x7f)+1980,((date>>5)&0xf)-1,date&0x1f,(time>>11)&0x1f,(time>>5)&0x3f,(time&0x1f)*2);return isNaN(d)?null:d;}
const unixTime=(s)=>(Number.isFinite(s)?new Date(s*1000):null);function fileTime(lo,hi){if(!lo&&!hi)return null;const ms=(hi*4294967296+lo)/10000-11644473600000;return Number.isFinite(ms)?new Date(ms):null;}
const UTF8=new TextDecoder('utf-8');const UTF8_FATAL=new TextDecoder('utf-8',{fatal:true});const utf8=(b)=>UTF8.decode(b);const latin1=(b)=>{let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return s;};const isUtf8=(b)=>{try{UTF8_FATAL.decode(b);return true;}catch{return false;}};const isAscii=(b)=>{for(let i=0;i<b.length;i++)if(b[i]>0x7e||(b[i]<0x20&&b[i]!==9))return false;return true;};const CP437='ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';const cp437=(b)=>{let s='';for(let i=0;i<b.length;i++)s+=b[i]<128?String.fromCharCode(b[i]):CP437[b[i]-128];return s;};const DECODERS=new Map();function decoderFor(label){if(!DECODERS.has(label)){try{DECODERS.set(label,new TextDecoder(label));}catch{DECODERS.set(label,null);}}
return DECODERS.get(label);}
function decodeText(b,charset='auto'){if(isAscii(b))return latin1(b);if(charset==='auto'){if(isUtf8(b))return utf8(b);charset=guessCharset(b);}
if(charset==='utf-8')return utf8(b);if(charset==='cp437')return cp437(b);const d=decoderFor(charset);return d?d.decode(b):cp437(b);}
function guessCharset(b){let n866=0,n1251=0,high=0;for(let i=0;i<b.length;i++){const c=b[i];if(c<0x80)continue;high++;if(c<=0xaf||(c>=0xe0&&c<=0xf1))n866++;if(c>=0xc0)n1251++;}
if(!high)return'cp437';if(n866/high>0.85&&n866>=n1251)return'ibm866';if(n1251/high>0.85)return'windows-1251';return'cp437';}
export{fail,corrupt,unsupported,readAt,utf8,unixTime,fileTime,concatStreams,sourceStream,Reader,hashStream,ArchiveError,bytesStream,EMPTY,readAll,decodeText,isUtf8,concatSource,limitStream,le32,le16,dosDateTime,latin1,le64,crcStream,fileSource,bytesSource};