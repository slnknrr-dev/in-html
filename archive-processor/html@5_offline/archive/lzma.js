import{corrupt,le32,fail}from"./io.js";const STATES=12,POS_BITS_MAX=4,LEN_TO_POS=4,END_POS_MODEL=14,FULL_DISTANCES=128,ALIGN_BITS=4;const LEN_LOW=2,LEN_MID=130,LEN_HIGH=258,LEN_SIZE=514;const TOP=16777216;function lzmaProps(p){let d=p[0];if(d>=225)corrupt('LZMA properties');const lc=d%9;d=(d/9)|0;return{lc,lp:d%5,pb:(d/5)|0,dictSize:le32(p,1)};}
function lzma2DictSize(prop){if(prop>40)corrupt('LZMA2 dictionary size');return prop===40?0xffffffff:(2|(prop&1))*2**((prop>>1)+11);}
class LzmaDecoder{constructor(dictSize,outSize){this.dictSize=Math.max(4096,dictSize);this.bufMax=outSize!=null&&outSize<this.dictSize?Math.max(1,outSize):this.dictSize;if(this.bufMax>0x7fe00000)fail('limit','LZMA dictionary too large for this browser: '+this.dictSize+' bytes');this.buf=new Uint8Array(Math.min(this.bufMax,1<<20));this.pos=0;this.hist=0;this.total=0;this.lc=0;this.lp=0;this.pb=0;this.lit=null;this.isMatch=new Uint16Array(STATES<<POS_BITS_MAX);this.isRep=new Uint16Array(STATES);this.isRepG0=new Uint16Array(STATES);this.isRepG1=new Uint16Array(STATES);this.isRepG2=new Uint16Array(STATES);this.isRep0Long=new Uint16Array(STATES<<POS_BITS_MAX);this.posSlot=new Uint16Array(LEN_TO_POS<<6);this.posDec=new Uint16Array(1+FULL_DISTANCES-END_POS_MODEL);this.align=new Uint16Array(1<<ALIGN_BITS);this.lenDec=new Uint16Array(LEN_SIZE);this.repLenDec=new Uint16Array(LEN_SIZE);this.state=0;this.rep0=0;this.rep1=0;this.rep2=0;this.rep3=0;this.remain=0;this.range=0;this.code=0;this.in=null;this.over=0;this.left=Infinity;this.eos=false;}
setProps(lc,lp,pb){const n=0x300<<(lc+lp);if(!this.lit||this.lit.length!==n)this.lit=new Uint16Array(n);this.lc=lc;this.lp=lp;this.pb=pb;}
resetState(){for(const a of[this.lit,this.isMatch,this.isRep,this.isRepG0,this.isRepG1,this.isRepG2,this.isRep0Long,this.posSlot,this.posDec,this.align,this.lenDec,this.repLenDec])a.fill(1024);this.state=0;this.rep0=this.rep1=this.rep2=this.rep3=0;this.remain=0;}
resetDict(){this.hist=0;this.total=0;this.remain=0;}
initRange(input){this.in=input;if(input.byte()!==0)corrupt('LZMA range coder');let c=0;for(let i=0;i<4;i++){const b=input.byte();if(b<0)fail('truncated','unexpected end of LZMA data');c=c*256+b;}
this.range=0xffffffff;this.code=c;if(c===0xffffffff)corrupt('LZMA range coder');}
next(){const b=this.in.byte();if(b>=0)return b;this.over++;return 0;}
bit(p,i){const prob=p[i];const bound=(this.range>>>11)*prob;let b;if(this.code<bound){this.range=bound;p[i]=prob+((2048-prob)>>5);b=0;}
else{this.range-=bound;this.code-=bound;p[i]=prob-(prob>>5);b=1;}
if(this.range<TOP){this.range*=256;this.code=this.code*256+this.next();}
return b;}
tree(p,base,n){let m=1;for(let i=0;i<n;i++)m=(m<<1)|this.bit(p,base+m);return m-(1<<n);}
revTree(p,base,n){let m=1,sym=0;for(let i=0;i<n;i++){const b=this.bit(p,base+m);m=(m<<1)|b;sym|=b<<i;}
return sym;}
direct(n){let res=0;for(let i=0;i<n;i++){this.range=Math.floor(this.range/2);if(this.code>=this.range){this.code-=this.range;res=res*2+1;}else res*=2;if(this.range<TOP){this.range*=256;this.code=this.code*256+this.next();}}
return res;}
len(p,posState){if(!this.bit(p,0))return this.tree(p,LEN_LOW+(posState<<3),3);if(!this.bit(p,1))return 8+this.tree(p,LEN_MID+(posState<<3),3);return 16+this.tree(p,LEN_HIGH,8);}
room(){if(this.pos<this.buf.length)return;if(this.buf.length<this.bufMax){const nb=new Uint8Array(Math.min(this.bufMax,this.buf.length*2));nb.set(this.buf);this.buf=nb;}else this.pos=0;}
copy(dist,n){const buf=this.buf,size=buf.length;let pos=this.pos,src=pos-dist;if(src<0)src+=size;this.total+=n;if(src+n<=size&&dist>=n){buf.copyWithin(pos,src,src+n);pos+=n;}
else for(let k=0;k<n;k++){buf[pos++]=buf[src++];if(src===size)src=0;}
this.pos=pos;this.hist=Math.min(this.bufMax,this.hist+n);}
decode(limit){if(this.remain>0){const n=Math.min(this.remain,limit-this.pos,this.left);this.copy(this.rep0+1,n);this.remain-=n;this.left-=n;}
const pbMask=(1<<this.pb)-1,lpMask=(1<<this.lp)-1,lc=this.lc;const lit=this.lit,isMatch=this.isMatch,buf=this.buf,size=buf.length;while(this.pos<limit&&this.left>0&&!this.eos){const posState=this.total&pbMask;let state=this.state;if(!this.bit(isMatch,(state<<POS_BITS_MAX)+posState)){const prev=this.hist?buf[this.pos>0?this.pos-1:size-1]:0;const base=0x300*(((this.total&lpMask)<<lc)+(prev>>(8-lc)));let sym=1;if(state>=7){let src=this.pos-this.rep0-1;if(src<0)src+=size;let match=buf[src];do{const mb=(match>>7)&1;match<<=1;const b=this.bit(lit,base+((1+mb)<<8)+sym);sym=(sym<<1)|b;if(mb!==b)break;}while(sym<0x100);}
while(sym<0x100)sym=(sym<<1)|this.bit(lit,base+sym);buf[this.pos++]=sym&255;this.total++;this.left--;if(this.hist<this.bufMax)this.hist++;this.state=state<4?0:state<10?state-3:state-6;continue;}
let len;if(this.bit(this.isRep,state)){if(!this.hist)corrupt('LZMA repeated match at the start');if(!this.bit(this.isRepG0,state)){if(!this.bit(this.isRep0Long,(state<<POS_BITS_MAX)+posState)){this.state=state<7?9:11;let src=this.pos-this.rep0-1;if(src<0)src+=size;buf[this.pos++]=buf[src];this.total++;this.left--;if(this.hist<this.bufMax)this.hist++;continue;}}else{let dist;if(!this.bit(this.isRepG1,state))dist=this.rep1;else{if(!this.bit(this.isRepG2,state))dist=this.rep2;else{dist=this.rep3;this.rep3=this.rep2;}
this.rep2=this.rep1;}
this.rep1=this.rep0;this.rep0=dist;}
len=this.len(this.repLenDec,posState);this.state=state<7?8:11;}else{this.rep3=this.rep2;this.rep2=this.rep1;this.rep1=this.rep0;len=this.len(this.lenDec,posState);this.state=state<7?7:10;const slot=this.tree(this.posSlot,(len<LEN_TO_POS?len:LEN_TO_POS-1)<<6,6);let dist;if(slot<4)dist=slot;else{const nd=(slot>>1)-1;dist=((2|(slot&1))<<nd)>>>0;if(slot<END_POS_MODEL)dist+=this.revTree(this.posDec,dist-slot,nd);else dist+=this.direct(nd-ALIGN_BITS)*16+this.revTree(this.align,0,ALIGN_BITS);}
if(dist===0xffffffff){this.eos=true;break;}
this.rep0=dist;}
if(this.rep0>=this.hist)corrupt('LZMA distance');len+=2;const n=Math.min(len,limit-this.pos,this.left);this.copy(this.rep0+1,n);this.left-=n;this.remain=this.left>0?len-n:0;}
if(this.over)fail('truncated','unexpected end of LZMA data');}}
function lzmaStream(reader,props,{size}={}){const p=lzmaProps(props);const d=new LzmaDecoder(p.dictSize,size);d.setProps(p.lc,p.lp,p.pb);d.resetState();let started=false,done=false;d.left=size==null?Infinity:size;return{size,read(max=1<<20){if(done)return null;if(!started){started=true;if(d.left===0){done=true;return null;}d.initRange(reader);}
d.room();const start=d.pos;d.decode(Math.min(d.buf.length,start+Math.max(1,max)));if(d.pos===start){done=true;if(d.left>0&&size!=null)fail('truncated','LZMA data ended early (end marker before the end)');return null;}
return d.buf.subarray(start,d.pos);},};}
function lzmaAloneStream(reader){const head=reader.bytes(13,'LZMA header');let unknown=true;for(let i=5;i<13;i++)if(head[i]!==255)unknown=false;const size=unknown?undefined:le32(head,5)+le32(head,9)*4294967296;return lzmaStream(reader,head.subarray(0,5),{size});}
function lzma2Stream(reader,dictProp,{size}={}){const d=new LzmaDecoder(lzma2DictSize(dictProp),size);let mode=0,done=false,produced=0;let packEnd=0,havePropsState=false,first=true;const header=()=>{const c=reader.byte();if(c<0)fail('truncated','unexpected end of LZMA2 data');if(c===0){done=true;return;}
if(c===1||c===2){if(c===1)d.resetDict();else if(first)corrupt('LZMA2 missing dictionary reset');d.left=((reader.u8()<<8)|reader.u8())+1;mode=1;first=false;return;}
if(c<0x80)corrupt('LZMA2 chunk type');const unpack=((c&0x1f)<<16)+(reader.u8()<<8)+reader.u8()+1;const pack=(reader.u8()<<8)+reader.u8()+1;const reset=(c>>5)&3;if(reset===3)d.resetDict();else if(first)corrupt('LZMA2 missing dictionary reset');if(reset>=2){const p=reader.u8();if(p>224)corrupt('LZMA2 properties');const lc=p%9,rest=(p/9)|0,lp=rest%5,pb=(rest/5)|0;if(lc+lp>4)corrupt('LZMA2 properties');d.setProps(lc,lp,pb);havePropsState=false;}else if(!d.lit)corrupt('LZMA2 missing properties');if(reset>=1){d.resetState();havePropsState=true;}else if(!havePropsState)corrupt('LZMA2 missing state reset');d.remain=0;d.eos=false;d.left=unpack;const at=reader.pos;d.initRange(reader);packEnd=at+pack;mode=2;first=false;};return{size,read(max=1<<20){while(!done){if(mode===0){header();continue;}
d.room();const start=d.pos;const limit=Math.min(d.buf.length,start+Math.max(1,max));if(mode===1){while(d.pos<limit&&d.left>0){const c=reader.chunk(Math.min(limit-d.pos,d.left));if(!c)fail('truncated','unexpected end of LZMA2 data');d.buf.set(c,d.pos);d.pos+=c.length;d.left-=c.length;d.total+=c.length;d.hist=Math.min(d.bufMax,d.hist+c.length);}}else d.decode(limit);if(d.left===0||d.eos){if(mode===2){if(d.eos||d.remain)corrupt('LZMA2 chunk');if(reader.pos!==packEnd)corrupt('LZMA2 packed size');}
mode=0;}
if(d.pos>start){produced+=d.pos-start;return d.buf.subarray(start,d.pos);}}
if(size!=null&&produced!==size)corrupt('LZMA2 size ('+produced+' of '+size+' bytes)');return null;},};}
export{lzma2Stream,lzmaAloneStream,lzmaStream,lzmaProps,lzma2DictSize};