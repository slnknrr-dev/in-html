import{fail,corrupt,Reader,unsupported,le32,le16,concatSource,decodeText,dosDateTime,bytesStream,EMPTY,hashStream,sourceStream}from"./io.js";const MARK=0x1a,DLE=0x90,OUT=1<<16,NO_PRED=0xffff;const SFX_SCAN=1<<18;const RESYNC_SCAN=1<<20;const METHODS=['','Stored','Stored','Packed','Squeezed','Crunched','Crunched','Crunched','Crunched','Squashed','Crushed','Distilled'];const CRC16=new Uint16Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?(c>>>1)^0xa001:c>>>1;CRC16[n]=c;};function arcCrc16(b,crc=0){for(let i=0;i<b.length;i++)crc=(crc>>>8)^CRC16[(crc^b[i])&0xff];return crc;}
const clampMax=(max)=>(max>0&&max<OUT?max:OUT);function stringStream(stack,next){const top=stack.length,out=new Uint8Array(OUT);let sp=top,done=false;return{read(max){if(done)return null;max=clampMax(max);let n=0;while(n<max){if(sp===top){const s=next();if(s<0){done=true;break;}
sp=s;}
const k=Math.min(top-sp,max-n);for(let i=0;i<k;i++)out[n+i]=stack[sp+i];n+=k;sp+=k;}
return n?out.subarray(0,n):null;},};}
function arcRleStream(r){const out=new Uint8Array(OUT);let last=0,rep=0,dle=false;return{read(max){max=clampMax(max);let n=0;while(n<max){if(rep){const k=Math.min(rep,max-n);out.fill(last,n,n+k);n+=k;rep-=k;continue;}
const c=r.byte();if(c<0)break;if(dle){dle=false;if(c)rep=c-1;else out[n++]=DLE;}else if(c===DLE)dle=true;else out[n++]=last=c;}
return n?out.subarray(0,n):null;},};}
function unsqueezeStream(r){const out=new Uint8Array(OUT);let kids=null,cur=0,left=0,done=false;const init=()=>{const lo=r.byte();if(lo<0){done=true;return;}
const hi=r.byte();if(hi<0)fail('truncated','unexpected end of squeezed data');const nodes=((lo|(hi<<8))<<16)>>16;if(nodes<0||nodes>256)corrupt('squeeze tree size');kids=new Int16Array(2*Math.max(nodes,1)).fill(-257);for(let i=0;i<2*nodes;i++){const v=(r.u16('squeeze tree')<<16)>>16;if(v>=nodes||v<-257)corrupt('squeeze tree');kids[i]=v;}};return{read(max){if(!kids&&!done)init();max=clampMax(max);let n=0;while(n<max&&!done){let i=0,steps=0;do{if(!left){cur=r.byte();if(cur<0){done=true;break;}
left=8;}
i=kids[2*i+(cur&1)];cur>>=1;left--;if(++steps>257)corrupt('squeeze tree loop');}while(i>=0);if(done)break;if(i===-257){done=true;break;}
out[n++]=-1-i;}
return n?out.subarray(0,n):null;},};}
function uncrunchStream(r,newHash=false){const used=new Uint8Array(4096),foll=new Uint8Array(4096),next=new Uint16Array(4096),pred=new Uint16Array(4096);const hash=newHash?(p,c)=>(((p+c)&0xffff)*15073)&0xfff:(p,c)=>{const k=((p+c)|0x800)&0xffff;return(Math.imul(k,k)>>>6)&0xfff;};const add=(p,c)=>{let i=hash(p,c);if(used[i]){while(next[i])i=next[i];let j=(i+101)&0xfff;while(used[j])j=(j+1)&0xfff;next[i]=j;i=j;}
used[i]=1;next[i]=0;pred[i]=p;foll[i]=c;};for(let c=0;c<256;c++)add(NO_PRED,c);let free=4096-256,old=-1,fin=0,nib=-1;const code=()=>{if(nib<0){const a=r.byte(),b=r.byte();if(b<0)return-1;nib=b&15;return(a<<4)|(b>>4);}
const a=r.byte();if(a<0)return-1;const v=(nib<<8)|a;nib=-1;return v;};const stack=new Uint8Array(4100);return stringStream(stack,()=>{const k=code();if(k<0)return-1;let p=stack.length;if(old<0){if(!used[k])corrupt('first crunched code');old=k;stack[--p]=fin=foll[k];return p;}
let c=k;if(!used[c]){stack[--p]=fin;c=old;}
while(pred[c]!==NO_PRED){if(p<2)corrupt('crunched string');stack[--p]=foll[c];c=pred[c];}
stack[--p]=fin=foll[c];if(free){add(old,fin);free--;}
old=k;return p;});}
function arcLzwStream(r,maxBits=0){const stack=new Uint8Array((1<<16)+2),buf=new Uint8Array(19);let prefix=null,suffix=null,maxmax=0;let nbits=9,maxcode=511,free=257,clear=false,offset=0,end=0,old=-1,fin=0;const init=()=>{if(!maxBits){maxBits=r.byte();if(maxBits<0)return false;}
if(maxBits<9||maxBits>16)corrupt('LZW code size '+maxBits);maxmax=1<<maxBits;prefix=new Uint16Array(maxmax);suffix=new Uint8Array(maxmax);for(let i=0;i<256;i++)suffix[i]=i;return true;};const getcode=()=>{if(clear||offset>=end||free>maxcode){if(free>maxcode){nbits++;maxcode=nbits===maxBits?maxmax:(1<<nbits)-1;}
if(clear){nbits=9;maxcode=511;clear=false;}
let k=0;while(k<nbits){const c=r.byte();if(c<0)break;buf[k++]=c;}
if(k*8<nbits)return-1;buf.fill(0,k);offset=0;end=k*8-(nbits-1);}
const p=offset>>3;const v=((buf[p]|(buf[p+1]<<8)|(buf[p+2]<<16))>>>(offset&7))&((1<<nbits)-1);offset+=nbits;return v;};return stringStream(stack,()=>{if(!prefix&&!init())return-1;let k=getcode();if(k<0)return-1;let p=stack.length;if(old<0){if(k>255)corrupt('first LZW code');old=fin=k;stack[--p]=k;return p;}
if(k===256){clear=true;free=256;k=getcode();if(k<0)return-1;}
let c=k;if(c>=free){if(c>free)corrupt('LZW code');stack[--p]=fin;c=old;}
while(c>=256){if(p<2)corrupt('LZW string');stack[--p]=suffix[c];c=prefix[c];}
stack[--p]=fin=c;if(free<maxmax){prefix[free]=old;suffix[free]=fin;free++;}
old=k;return p;});}
function decoder(type,raw){const rd=()=>new Reader(raw);const rle=(s)=>arcRleStream(new Reader(s,OUT));switch(type){case 1:case 2:return raw;case 3:return arcRleStream(rd());case 4:return rle(unsqueezeStream(rd()));case 5:return uncrunchStream(rd(),false);case 6:return rle(uncrunchStream(rd(),false));case 7:return rle(uncrunchStream(rd(),true));case 8:return rle(arcLzwStream(rd(),0));case 9:return arcLzwStream(rd(),13);}
return unsupported('ARC method '+type);}
const knownType=(t)=>(t>=1&&t<=11)||(t>=20&&t<=30);function readHeader(src,pos,limit,strict=0){const b=src.read(pos,Math.min(29,limit-pos));if(b.length<2||b[0]!==MARK)return null;const type=b[1];if(type===0)return strict?null:{type,end:pos+2};const hlen=type===1?25:29;if(b.length<hlen)return null;let len=0;while(len<13&&b[2+len])len++;const packed=le32(b,15),off=pos+hlen,end=off+packed;if(strict){if(!len||len===13)return null;for(let i=0;i<len;i++)if(b[2+i]<0x20||b[2+i]===0x7f)return null;if(end>limit||(strict>1&&end<limit&&src.read(end,1)[0]!==MARK))return null;}
return{type,name:b.slice(2,2+len),packed,date:le16(b,19),time:le16(b,21),crc:le16(b,23),size:type===1?packed:le32(b,25),off,end,};}
const plausible=(src,pos,limit,strict=2)=>{const h=readHeader(src,pos,limit,strict);return!!h&&knownType(h.type);};function scan(src,from,limit,max){const stop=Math.min(limit,from+max);for(let pos=from;pos<stop;){const b=src.read(pos,Math.min(65536,stop-pos));if(!b.length)break;for(let i=b.indexOf(MARK);i>=0;i=b.indexOf(MARK,i+1))if(plausible(src,pos+i,limit))return pos+i;pos+=b.length;}
return-1;}
function openArc(sources,opts={}){const src=concatSource(sources);const charset=opts.charset||'auto';const entries=[],meta=[],warnings=[],methods=[];let start=0;const first=src.read(0,2);const empty=first.length===2&&first[0]===MARK&&first[1]===0;if(!empty&&!plausible(src,0,src.size,1)){start=scan(src,1,src.size,SFX_SCAN);if(start<0)fail('format','not an ARC archive');}
const frames=[];let pos=start,limit=src.size,prefix='',ended=false;for(;;){if(pos>=limit){if(!frames.length){warnings.push('the end-of-archive marker is missing');break;}
({prefix,limit,pos}=frames.pop());continue;}
const h=readHeader(src,pos,limit,false);if(!h){const next=scan(src,pos+1,limit,RESYNC_SCAN);if(next<0){warnings.push(`no entry header at offset ${pos}: the rest of the ${frames.length?'directory':'archive'} is ignored`);if(!frames.length)break;({prefix,limit,pos}=frames.pop());continue;}
warnings.push(`${next-pos} damaged bytes skipped at offset ${pos}`);pos=next;continue;}
if(h.type===0){if(!frames.length){pos=h.end;ended=true;break;}
({prefix,limit,pos}=frames.pop());continue;}
if(h.type>=20&&h.type<=29){pos=h.end;continue;}
const path=(prefix+decodeText(h.name,charset).replace(/\\/g,'/')).replace(/^\/+/,'');const mtime=dosDateTime(h.time,h.date);if(h.type===30){const e={index:entries.length,path,dir:true,kind:'dir'};if(mtime)e.mtime=mtime;entries.push(e);meta.push(null);frames.push({prefix,limit,pos:Math.min(h.end,limit)});prefix=path+'/';limit=Math.min(h.end,limit);pos=h.off;continue;}
if(!knownType(h.type)&&!readHeader(src,pos,limit,2)){warnings.push(`unknown header type ${h.type} at offset ${pos}: the rest of the archive is ignored`);break;}
const method=METHODS[h.type]||'type '+h.type;const e={index:entries.length,path,dir:false,kind:'file',size:h.size,packed:h.packed,method,crc:h.crc};if(mtime)e.mtime=mtime;if(h.type>9)e.unsupported=METHODS[h.type]?`${method} (PAK method ${h.type})`:`ARC header type ${h.type}`;entries.push(e);meta.push({type:h.type,off:h.off});if(!methods.includes(method))methods.push(method);if(h.end>limit){warnings.push(`the archive is truncated (in ${path})`);break;}
pos=h.end;}
if(ended&&pos<src.size){const tail=src.read(pos,Math.min(65536,src.size-pos));if(tail.some((c)=>c!==0&&c!==MARK))warnings.push(`${src.size-pos} bytes after the end of the archive ignored`);}
const info={methods};if(start)info.sfx=start;if(warnings.length)info.warnings=warnings;return{format:'arc',label:'ARC',entries,info,password:null,open(entry){const m=meta[entry.index];if(!m)return bytesStream(EMPTY);if(entry.unsupported)unsupported(`${entry.unsupported}: ${entry.path}`);const name=entry.path,size=entry.size;let n=0,crc=0;return hashStream(decoder(m.type,sourceStream(src,m.off,entry.packed)),(b)=>{n+=b.length;if(n>size)fail('corrupt',`size mismatch: ${name} (more than ${size} bytes)`);crc=arcCrc16(b,crc);},()=>crc===entry.crc,{name,size});},};}
export{openArc};