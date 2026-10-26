import{fail,le32,corrupt}from"./io.js";const MASK_ALLOWED=[true,true,true,false,true,false,false,false];const MASK_BIT=[0,1,2,2,3,3,3,3];const test86=(b)=>b===0||b===0xff;function x86(data,size,ip,state){if(size<5)return 0;let pos=0,prevPos=-1,mask=state.mask&7;ip+=5;for(;;){const limit=size-4;while(pos<limit&&(data[pos]&0xfe)!==0xe8)pos++;if(pos>=limit)break;const d=pos-prevPos;if(d>3)mask=0;else{mask=(mask<<(d-1))&7;if(mask!==0){const b=data[pos+4-MASK_BIT[mask]];if(!MASK_ALLOWED[mask]||test86(b)){prevPos=pos;mask=((mask<<1)&7)|1;pos++;continue;}}}
prevPos=pos;if(test86(data[pos+4])){let src=(data[pos+1]|(data[pos+2]<<8)|(data[pos+3]<<16)|(data[pos+4]<<24))>>>0;let dest;for(;;){dest=(src-(ip+pos))>>>0;if(mask===0)break;const idx=MASK_BIT[mask]*8;const b=(dest>>>(24-idx))&0xff;if(!test86(b))break;src=(dest^((2**(32-idx))-1))>>>0;}
data[pos+4]=~(((dest>>>24)&1)-1)&0xff;data[pos+3]=dest>>>16;data[pos+2]=dest>>>8;data[pos+1]=dest;pos+=5;}else{mask=((mask<<1)&7)|1;pos++;}}
const d=pos-prevPos;state.mask=d>3?0:(mask<<(d-1))&7;return pos;}
function arm(data,size,ip){if(size<4)return 0;let i=0;ip+=8;for(;i<=size-4;i+=4){if(data[i+3]===0xeb){const src=((data[i+2]<<16)|(data[i+1]<<8)|data[i])<<2;const dest=((src-(ip+i))>>>2)&0xffffff;data[i+2]=dest>>>16;data[i+1]=dest>>>8;data[i]=dest;}}
return i;}
function armt(data,size,ip){if(size<4)return 0;let i=0;ip+=4;for(;i<=size-4;i+=2){if((data[i+1]&0xf8)===0xf0&&(data[i+3]&0xf8)===0xf8){const src=(((data[i+1]&7)<<19)|(data[i]<<11)|((data[i+3]&7)<<8)|data[i+2])<<1;const dest=(src-(ip+i))>>>1;data[i+1]=0xf0|((dest>>>19)&7);data[i]=dest>>>11;data[i+3]=0xf8|((dest>>>8)&7);data[i+2]=dest;i+=2;}}
return i;}
function ppc(data,size,ip){if(size<4)return 0;let i=0;for(;i<=size-4;i+=4){if((data[i]>>2)===0x12&&(data[i+3]&3)===1){const src=((data[i]&3)<<24)|(data[i+1]<<16)|(data[i+2]<<8)|(data[i+3]&~3);const dest=(src-(ip+i))>>>0;data[i]=0x48|((dest>>>24)&3);data[i+1]=dest>>>16;data[i+2]=dest>>>8;data[i+3]=(data[i+3]&3)|(dest&0xfc);}}
return i;}
function sparc(data,size,ip){if(size<4)return 0;let i=0;for(;i<=size-4;i+=4){if((data[i]===0x40&&(data[i+1]&0xc0)===0)||(data[i]===0x7f&&(data[i+1]&0xc0)===0xc0)){const src=((data[i]<<24)|(data[i+1]<<16)|(data[i+2]<<8)|data[i+3])<<2;let dest=(src-(ip+i))>>>2;dest=(((0-((dest>>>22)&1))<<22)&0x3fffffff)|(dest&0x3fffff)|0x40000000;data[i]=dest>>>24;data[i+1]=dest>>>16;data[i+2]=dest>>>8;data[i+3]=dest;}}
return i;}
const IA64_BRANCH=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,4,6,6,0,0,7,7,4,4,0,0,4,4,0,0];function ia64(data,size,ip){if(size<16)return 0;let i=0;for(;i<=size-16;i+=16){const mask=IA64_BRANCH[data[i]&0x1f];for(let slot=0,bitPos=5;slot<3;slot++,bitPos+=41){if(((mask>>slot)&1)===0)continue;const bytePos=bitPos>>3,bitRes=BigInt(bitPos&7);let inst=0n;for(let j=0;j<6;j++)inst|=BigInt(data[i+j+bytePos])<<BigInt(8*j);let norm=inst>>bitRes;if(((norm>>37n)&0xfn)===0x5n&&((norm>>9n)&0x7n)===0n){let src=Number((norm>>13n)&0xfffffn);src|=Number((norm>>36n)&1n)<<20;src<<=4;const dest=((src-(ip+i))>>>4)>>>0;norm&=~(0x8fffffn<<13n);norm|=BigInt(dest&0xfffff)<<13n;norm|=BigInt(dest&0x100000)<<(36n-20n);inst&=(1n<<bitRes)-1n;inst|=norm<<bitRes;for(let j=0;j<6;j++)data[i+j+bytePos]=Number((inst>>BigInt(8*j))&0xffn);}}}
return i;}
function arm64(data,size,ip){const end=size&~3;const flag=1<<20,mask=(1<<24)-(flag<<1);for(let i=0;i<end;i+=4){let v=(data[i]|(data[i+1]<<8)|(data[i+2]<<16)|(data[i+3]<<24))>>>0;const pc=(ip+i)>>>0;if((((v-0x94000000)>>>0)&0xfc000000)===0){const c=pc>>>2;v=((((v-c)>>>0)&0x03ffffff)|0x94000000)>>>0;}else{v=(v-0x90000000)>>>0;if((v&0x9f000000)!==0)continue;v=(v+flag)>>>0;if(v&mask)continue;let z=((v&0xffffffe0)|(v>>>26))>>>0;const c=((pc>>>(12-3))&~7)>>>0;z=(z-c)>>>0;v&=0x1f;v|=0x90000000;v|=z<<26;v|=0x00ffffe0&((z&((flag<<1)-1))-flag);v>>>=0;}
data[i]=v;data[i+1]=v>>>8;data[i+2]=v>>>16;data[i+3]=v>>>24;}
return end;}
const rd32=(d,i)=>(d[i]|(d[i+1]<<8)|(d[i+2]<<16)|(d[i+3]<<24))>>>0;const wr32=(d,i,v)=>{d[i]=v;d[i+1]=v>>>8;d[i+2]=v>>>16;d[i+3]=v>>>24;};function riscv(data,size,ip){if(size<8)return 0;const lim=size-8;let i=0;for(;i<=lim;i+=2){let inst=data[i];if(inst===0xef){const b1=data[i+1];if(b1&0x0d)continue;const b2=data[i+2],b3=data[i+3];let addr=((b1&0xf0)<<13)|(b2<<9)|(b3<<1);addr=(addr-((ip+i)>>>0))>>>0;data[i+1]=(b1&0x0f)|((addr>>>8)&0xf0);data[i+2]=((addr>>>16)&0x0f)|((addr>>>7)&0x10)|((addr<<4)&0xe0);data[i+3]=((addr>>>4)&0x7f)|((addr>>>13)&0x80);i+=2;continue;}
if((inst&0x7f)!==0x17)continue;inst=rd32(data,i);let inst2;if(inst&0xe80){inst2=rd32(data,i+4);if((((inst<<8)^(inst2-3))&0xf8003)!==0){i+=4;continue;}
const n=((inst&0xfffff000)|(inst2>>>20))>>>0;inst=(0x117|(inst2<<12))>>>0;inst2=n;}else{const rs1=inst>>>27;if((((inst-0x3117)<<18)>>>0)>=(rs1&0x1d)){i+=2;continue;}
let addr=((data[i+4]<<24)|(data[i+5]<<16)|(data[i+6]<<8)|data[i+7])>>>0;addr=(addr-((ip+i)>>>0))>>>0;inst2=((inst>>>12)|(addr<<20))>>>0;inst=(0x17|(rs1<<7)|((addr+0x800)&0xfffff000))>>>0;}
wr32(data,i,inst);wr32(data,i+4,inst2);i+=6;}
return i;}
function swap2(data,size){const n=size&~1;for(let i=0;i<n;i+=2){const t=data[i];data[i]=data[i+1];data[i+1]=t;}return n;}
function swap4(data,size){const n=size&~3;for(let i=0;i<n;i+=4){let t=data[i];data[i]=data[i+3];data[i+3]=t;t=data[i+1];data[i+1]=data[i+2];data[i+2]=t;}
return n;}
const FILTERS={x86,arm,armt,arm64,riscv,ppc,sparc,ia64,swap2,swap4};function convStream(stream,conv,ip0){let buf=new Uint8Array(1<<16),len=0,keep=0,ip=ip0,done=false;const state={mask:0};return{size:stream.size,read(max){for(;;){if(keep){buf.copyWithin(0,len-keep,len);len=keep;keep=0;}else if(!done)len=0;if(done){if(!len)return null;const r=buf.subarray(0,len);len=0;return r;}
const c=stream.read(max);if(!c){done=true;continue;}
if(len+c.length>buf.length){const nb=new Uint8Array(len+c.length+4096);nb.set(buf.subarray(0,len));buf=nb;}
buf.set(c,len);len+=c.length;const n=conv(buf,len,ip,state);keep=len-n;ip=(ip+n)>>>0;if(n>0)return buf.subarray(0,n);}},};}
function deltaStream(stream,dist){const hist=new Uint8Array(256);let hp=0;return{size:stream.size,read(max){const c=stream.read(max);if(!c)return null;const out=c.slice();for(let i=0;i<out.length;i++){const v=(out[i]+hist[(hp-dist)&255])&255;out[i]=v;hist[hp]=v;hp=(hp+1)&255;}
return out;},};}
function filterStream(stream,name,props){if(name==='delta'){const dist=(props&&props.length?props[0]:0)+1;return deltaStream(stream,dist);}
const conv=FILTERS[name];if(!conv)fail('unsupported','not supported: filter '+name);const start=props&&props.length>=4?le32(props,0):0;return convStream(stream,conv,start);}
function bcj2Stream(main,call,jump,rc,{size}={}){const prob=new Uint16Array(258).fill(1024);let range=0xffffffff,code=0,started=false,prev=0,total=0,over=0;const pend=new Uint8Array(4);let pn=0,pp=0;const rcByte=()=>{const b=rc.byte();if(b<0){over++;return 0;}return b;};const be=(r)=>{let v=0;for(let i=0;i<4;i++){const b=r.byte();if(b<0)fail('truncated','unexpected end of a BCJ2 stream');v=v*256+b;}
return v;};let out=null;return{size,read(max=1<<16){if(!started){started=true;for(let i=0;i<5;i++)code=(code*256+rcByte())%4294967296;}
if(!out||out.length<max)out=new Uint8Array(Math.max(16,max));let n=0;const cap=size!=null?Math.min(max,size-total):max;while(n<cap){if(pp<pn){out[n++]=pend[pp++];total++;continue;}
const b=main.byte();if(b<0)break;out[n++]=b;total++;if((b&0xfe)!==0xe8&&!(prev===0x0f&&(b&0xf0)===0x80)){prev=b;continue;}
const i=b===0xe8?prev:b===0xe9?256:257;const p=prob[i];const bound=(range>>>11)*p;let taken;if(code<bound){range=bound;prob[i]=p+((2048-p)>>5);taken=false;}
else{range-=bound;code-=bound;prob[i]=p-(p>>5);taken=true;}
if(range<16777216){range*=256;code=code*256+rcByte();}
if(!taken){prev=b;continue;}
const src=be(b===0xe8?call:jump);const dest=(src-(total+4))>>>0;pend[0]=dest;pend[1]=dest>>>8;pend[2]=dest>>>16;pend[3]=dest>>>24;pn=4;pp=0;prev=dest>>>24;}
if(over>1)corrupt('BCJ2 range coder');if(n===0){if(size!=null&&total<size)fail('truncated','unexpected end of a BCJ2 stream');return null;}
return out.subarray(0,n);},};}
export{filterStream,bcj2Stream};