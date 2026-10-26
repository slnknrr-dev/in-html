import{corrupt,unsupported}from"./io.js";import{crc32}from"../codec/crc32.js";import{Unpacker,DecodeTable}from"./rarbits.js";import{e8e9}from"./unpack50.js";import{RangeDecoderRar,Ppmd7}from"./ppmd7.js";const NC=299,DC=60,LDC=17,RC=28,BC=20,HUFF=NC+DC+LDC+RC;const UNPACK29_FILTER_MAX=0x40000;const VM_MEMSIZE=0x40000,VM_MEMMASK=VM_MEMSIZE-1,MAX_FILTERS=8192,MAX_CHANNELS=1024;const LOW_DIST_REP_COUNT=16;const LDECODE=new Uint8Array([0,1,2,3,4,5,6,7,8,10,12,14,16,20,24,28,32,40,48,56,64,80,96,112,128,160,192,224]);const LBITS=new Uint8Array([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5]);const SDDECODE=new Uint8Array([0,4,8,16,32,64,128,192]);const SDBITS=new Uint8Array([2,2,3,4,5,6,6,6]);const DDECODE=new Int32Array(DC),DBITS=new Uint8Array(DC);{const counts=[4,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,14,0,12];for(let b=0,slot=0,dist=0;b<counts.length;b++){for(let j=0;j<counts[b];j++,slot++,dist+=1<<b){DDECODE[slot]=dist;DBITS[slot]=b;}}};const STANDARD=[[53,0xad576887,'e8'],[57,0x3cd7e57e,'e8e9'],[120,0x3769893f,'itanium'],[29,0x0e06077d,'delta'],[149,0x1c2c5dc8,'rgb'],[216,0xbc85e701,'audio']];function standardFilter(code){let x=0;for(let i=1;i<code.length;i++)x^=code[i];if(!code.length||x!==code[0])return null;const c=crc32(code);for(const[n,crc,kind]of STANDARD)if(n===code.length&&crc===c)return kind;return null;}
class ArrayBits{constructor(b){this.b=b;this.pos=0;this.bit=0;}
getbits(){const b=this.b,p=this.pos;return((((b[p]<<16)|(b[p+1]<<8)|b[p+2])>>>(8-this.bit))&0xffff);}
addbits(n){n+=this.bit;this.pos+=n>>3;this.bit=n&7;}}
function vmData(r){const d=r.getbits();switch(d&0xc000){case 0:r.addbits(6);return(d>>10)&0xf;case 0x4000:if((d&0x3c00)===0){r.addbits(14);return(0xffffff00|((d>>2)&0xff))>>>0;}
r.addbits(10);return(d>>6)&0xff;case 0x8000:{r.addbits(2);const v=r.getbits();r.addbits(16);return v;}
default:{r.addbits(2);const hi=r.getbits();r.addbits(16);const lo=r.getbits();r.addbits(16);return hi*65536+lo;}}}
class Unpack29 extends Unpacker{constructor(size){super(size);this.chain=true;this.BD=new DecodeTable(BC);this.LD=new DecodeTable(NC);this.DD=new DecodeTable(DC);this.LDD=new DecodeTable(LDC);this.RD=new DecodeTable(RC);this.old=new Uint8Array(HUFF);this.table=new Uint8Array(HUFF);this.bl=new Uint8Array(BC);this.od=new Int32Array(4);this.lastLen=0;this.prevLow=0;this.lowRep=0;this.tablesRead=false;this.ppm=false;this.esc=2;this.model=null;this.modelMem=0;this.rc=null;this.progs=[];this.oldLens=[];this.lastFilter=0;this.mem=new Uint8Array(VM_MEMSIZE+4);this.started=false;}
init(solid){if(!solid){this.tablesRead=false;this.old.fill(0);this.esc=2;this.ppm=false;this.od.fill(0);this.lastLen=0;this.progs=[];this.oldLens=[];this.lastFilter=0;}
this.started=false;}
readTables(){const inp=this.inp,bl=this.bl,t=this.table,old=this.old;if(inp.pos>inp.border)inp.refill();inp.align();const bf=inp.getbits();if(bf&0x8000){this.ppm=true;this.initPpm();return;}
this.ppm=false;this.prevLow=0;this.lowRep=0;if(!(bf&0x4000))old.fill(0);inp.addbits(2);for(let i=0;i<BC;i++){const l=inp.bits(4);if(l===15){let z=inp.bits(4);if(z===0)bl[i]=15;else{z+=2;while(z-- >0&&i<BC)bl[i++]=0;i--;}}else bl[i]=l;}
this.BD.build(bl,0,BC);for(let i=0;i<HUFF;){if(inp.pos>inp.border){inp.refill();if(inp.over())corrupt('RAR Huffman table beyond the data');}
const n=this.BD.decode(inp);if(n<16){t[i]=(n+old[i])&15;i++;}
else if(n<18){let c=n===16?inp.bits(3)+3:inp.bits(7)+11;if(i===0)corrupt('RAR Huffman table');for(;c>0&&i<HUFF;c--,i++)t[i]=t[i-1];}else{let c=n===18?inp.bits(3)+3:inp.bits(7)+11;for(;c>0&&i<HUFF;c--)t[i++]=0;}}
if(inp.over())corrupt('RAR Huffman table beyond the data');this.tablesRead=true;this.LD.build(t,0,NC);this.DD.build(t,NC,DC);this.LDD.build(t,NC+DC,LDC);this.RD.build(t,NC+DC+LDC,RC);old.set(t);}
initPpm(){const inp=this.inp;const flags=inp.byte(),reset=(flags&0x20)!==0;const mb=reset?inp.byte():0;if(!reset&&!this.model)corrupt('RAR PPMd block without a model');if(flags&0x40)this.esc=inp.byte();this.rc=new RangeDecoderRar(inp);if(reset){let order=(flags&0x1f)+1;if(order>16)order=16+(order-16)*3;if(order===1)corrupt('RAR PPMd order');const mem=(mb+1)<<20;if(!this.model||this.modelMem!==mem){this.model=new Ppmd7(mem);this.modelMem=mem;}
this.model.init(order);}}
endOfBlock(){const inp=this.inp,bf=inp.getbits();let newTable,newFile=false;if(bf&0x8000){newTable=true;inp.addbits(1);}
else{newFile=true;newTable=(bf&0x4000)!==0;inp.addbits(2);}
this.tablesRead=!newTable;if(newFile)return false;this.readTables();return true;}
readVMCode(){const inp=this.inp;const first=inp.bits(8);let len=(first&7)+1;if(len===7)len=inp.bits(8)+7;else if(len===8)len=inp.bits(16);if(len===0)corrupt('RAR filter definition');const code=new Uint8Array(len+4);for(let i=0;i<len;i++){if(inp.pos>inp.border){inp.refill();if(inp.over()&&i<len-1)corrupt('RAR filter definition beyond the data');}
code[i]=inp.bits(8);}
this.addVMCode(first,code,len);}
readVMCodePpm(){const first=this.ppmChar();if(first<0)return false;let len=(first&7)+1;if(len===7){const b=this.ppmChar();if(b<0)return false;len=b+7;}
else if(len===8){const b1=this.ppmChar(),b2=b1<0?-1:this.ppmChar();if(b2<0)return false;len=b1*256+b2;}
if(len===0)return false;const code=new Uint8Array(len+4);for(let i=0;i<len;i++){const c=this.ppmChar();if(c<0)return false;code[i]=c;}
this.addVMCode(first,code,len);return true;}
addVMCode(first,code,size){const r=new ArrayBits(code);let n;if(first&0x80){n=vmData(r);if(n===0){this.progs=[];this.oldLens=[];this.lastFilter=0;this.filters.length=0;}
else n--;}else n=this.lastFilter;if(n>this.progs.length||n>this.oldLens.length)corrupt('RAR filter number');this.lastFilter=n;const isNew=n===this.progs.length;let prog;if(isNew){if(n>MAX_FILTERS)corrupt('too many RAR filters');prog={kind:null};this.progs.push(prog);this.oldLens.push(0);}else prog=this.progs[n];if(this.filters.length>MAX_FILTERS)corrupt('too many RAR filters');let start=vmData(r);if(first&0x40)start+=258;let length;if(first&0x20){length=vmData(r);this.oldLens[n]=length;}
else length=n<this.oldLens.length?this.oldLens[n]:0;const R=new Uint32Array(7);R[4]=length;if(first&0x10){const mask=r.getbits()>>>9;r.addbits(7);for(let i=0;i<7;i++)if(mask&(1<<i))R[i]=vmData(r);}
if(isNew){const len=vmData(r);if(len>=0x10000||len===0||r.pos+len>size)corrupt('RAR filter code size');const vm=new Uint8Array(len);for(let i=0;i<len;i++){vm[i]=r.getbits()>>>8;r.addbits(8);}
prog.kind=standardFilter(vm);}
this.filters.push({start:this.abs+start,length,kind:prog.kind,r:R});}
ppmChar(){return this.model.decodeSymbol(this.rc);}
applyFilter(f,data,fileOffset){if(!f.kind)unsupported('RAR filter program (not one of the standard RarVM filters)');const R=f.r.slice(),mem=this.mem;R[6]=fileOffset%4294967296;mem.set(data.length>VM_MEMSIZE?data.subarray(0,VM_MEMSIZE):data,0);const size=R[4]&VM_MEMMASK;const ok=runStandard(f.kind,mem,R);if(f.kind==='delta'||f.kind==='rgb'||f.kind==='audio'){return 2*size>VM_MEMSIZE||!ok?mem.subarray(0,size):mem.subarray(size,2*size);}
return mem.subarray(0,size);}
run(target){const inp=this.inp,win=this.win,W=this.W,od=this.od;if(!this.started){this.started=true;if(!this.tablesRead)this.readTables();}
const limit=this.fileStart+this.size;let ptr=this.ptr,abs=this.abs,len=0,dist=0;while(abs<target){if(inp.pos>inp.border){inp.refill();if(inp.over()){this.done=true;break;}}
if(this.size>=0&&abs>limit){this.done=true;break;}
if(this.ppm){const ch=this.ppmChar();if(ch<0){this.ppm=false;this.done=true;break;}
if(ch===this.esc){const next=this.ppmChar();if(next===0){this.ptr=ptr;this.abs=abs;this.readTables();continue;}
if(next<0||next===2){this.done=true;break;}
if(next===3){this.ptr=ptr;this.abs=abs;if(!this.readVMCodePpm()){this.done=true;break;}
continue;}
if(next===4){let d=0,l=0,bad=false;for(let i=0;i<4&&!bad;i++){const c=this.ppmChar();if(c<0)bad=true;else if(i===3)l=c;else d=d*256+c;}
if(bad){this.done=true;break;}
len=l+32;dist=d+2;}else if(next===5){const l=this.ppmChar();if(l<0){this.done=true;break;}
len=l+4;dist=1;}else{win[ptr++]=ch;abs++;if(ptr===W)ptr=0;continue;}}else{win[ptr++]=ch;abs++;if(ptr===W)ptr=0;continue;}}else{const n=this.LD.decode(inp);if(n<256){win[ptr++]=n;abs++;if(ptr===W)ptr=0;continue;}
if(n>=271){const k=n-271;len=LDECODE[k]+3;let b=LBITS[k];if(b)len+=inp.bits(b);const dn=this.DD.decode(inp);dist=DDECODE[dn]+1;b=DBITS[dn];if(b){if(dn>9){if(b>4){dist+=(inp.getbits()>>>(20-b))<<4;inp.addbits(b-4);}
if(this.lowRep>0){this.lowRep--;dist+=this.prevLow;}
else{const low=this.LDD.decode(inp);if(low===16){this.lowRep=LOW_DIST_REP_COUNT-1;dist+=this.prevLow;}
else{dist+=low;this.prevLow=low;}}}else dist+=inp.bits(b);}
if(dist>=0x2000){len++;if(dist>=0x40000)len++;}
od[3]=od[2];od[2]=od[1];od[1]=od[0];od[0]=dist;this.lastLen=len;}else if(n===256){this.ptr=ptr;this.abs=abs;if(!this.endOfBlock()){this.done=true;break;}
continue;}else if(n===257){this.ptr=ptr;this.abs=abs;this.readVMCode();continue;}else if(n===258){if(this.lastLen===0)continue;len=this.lastLen;dist=od[0];}else if(n<263){const k=n-259;dist=od[k];for(let i=k;i>0;i--)od[i]=od[i-1];od[0]=dist;const ln=this.RD.decode(inp);len=LDECODE[ln]+2;if(LBITS[ln])len+=inp.bits(LBITS[ln]);this.lastLen=len;}else{const k=n-263;dist=SDDECODE[k]+1;if(SDBITS[k])dist+=inp.bits(SDBITS[k]);od[3]=od[2];od[2]=od[1];od[1]=od[0];od[0]=dist;this.lastLen=len=2;}}
if(dist>abs||dist>W){for(let k=0;k<len;k++){win[ptr++]=0;if(ptr===W)ptr=0;}}else{let src=ptr-dist;if(src<0)src+=W;if(src+len<=W&&ptr+len<=W){for(let k=0;k<len;k++)win[ptr+k]=win[src+k];ptr+=len;if(ptr===W)ptr=0;}else{for(let k=0;k<len;k++){win[ptr++]=win[src++];if(ptr===W)ptr=0;if(src===W)src=0;}}}
abs+=len;}
this.ptr=ptr;this.abs=abs;}}
function runStandard(kind,mem,R){const size=R[4];switch(kind){case'e8':case'e8e9':if(size>VM_MEMSIZE||size<4)return false;e8e9(mem.subarray(0,size),R[6],kind==='e8e9',false);return true;case'itanium':return itanium(mem,size,R[6]);case'delta':{const ch=R[0];if(size>VM_MEMSIZE/2||ch>MAX_CHANNELS||ch===0)return false;let src=0;for(let c=0;c<ch;c++){let prev=0;for(let d=size+c;d<2*size;d+=ch)mem[d]=prev=(prev-mem[src++])&0xff;}
return true;}
case'rgb':return rgb(mem,size,(R[0]-3)>>>0,R[1]);case'audio':return audio(mem,size,R[0]);}
return false;}
const IT_MASKS=new Uint8Array([4,4,6,6,0,0,7,7,4,4,0,0,4,4,0,0]);function itGet(d,bitPos,n){const a=bitPos>>>3;const v=(d[a]|(d[a+1]<<8)|(d[a+2]<<16)|(d[a+3]<<24))>>>(bitPos&7);return(v&(0xffffffff>>>(32-n)))>>>0;}
function itSet(d,v,bitPos,n){const a=bitPos>>>3,s=bitPos&7;let and=~((0xffffffff>>>(32-n))<<s);v=(v<<s)>>>0;for(let i=0;i<4;i++){d[a+i]=(d[a+i]&and)|v;and=(and>>>8)|0xff000000;v>>>=8;}}
function itanium(mem,size,fileOffset){if(size>VM_MEMSIZE||size<21)return false;let fo=fileOffset>>>4;for(let p=0;p<size-21;p+=16,fo++){const b=(mem[p]&0x1f)-0x10;if(b<0)continue;const mask=IT_MASKS[b];if(!mask)continue;const d=mem.subarray(p,p+16+4);for(let i=0;i<=2;i++){if(!(mask&(1<<i)))continue;const start=i*41+5;if(itGet(d,start+37,4)===5){const off=itGet(d,start+13,20);itSet(d,(off-fo)&0xfffff,start+13,20);}}}
return true;}
function rgb(mem,size,width,posR){if(size>VM_MEMSIZE/2||size<3||width>size||posR>2)return false;const dst=size;let src=0;for(let c=0;c<3;c++){let prev=0;for(let i=c;i<size;i+=3){let pred=prev;if(i>=width+3){const up=dst+i-width,upper=mem[up],upperLeft=mem[up-3];pred=prev+upper-upperLeft;const pa=Math.abs(pred-prev),pb=Math.abs(pred-upper),pc=Math.abs(pred-upperLeft);pred=pa<=pb&&pa<=pc?prev:pb<=pc?upper:upperLeft;}
mem[dst+i]=prev=(pred-mem[src++])&0xff;}}
for(let i=posR,b=size-2;i<b;i+=3){const g=mem[dst+i+1];mem[dst+i]+=g;mem[dst+i+2]+=g;}
return true;}
function audio(mem,size,channels){if(size>VM_MEMSIZE/2||channels>128||channels===0)return false;const dst=size,dif=new Uint32Array(7);let src=0;for(let c=0;c<channels;c++){let prevByte=0,prevDelta=0,d1=0,d2=0,d3=0,k1=0,k2=0,k3=0;dif.fill(0);for(let i=c,count=0;i<size;i+=channels,count++){d3=d2;d2=prevDelta-d1;d1=prevDelta;let p=((8*prevByte+k1*d1+k2*d2+k3*d3)>>>3)&0xff;const cur=mem[src++];p=(p-cur)&0xff;mem[dst+i]=p;prevDelta=((p-prevByte)<<24)>>24;prevByte=p;const d=((cur<<24)>>24)*8;dif[0]+=Math.abs(d);dif[1]+=Math.abs(d-d1);dif[2]+=Math.abs(d+d1);dif[3]+=Math.abs(d-d2);dif[4]+=Math.abs(d+d2);dif[5]+=Math.abs(d-d3);dif[6]+=Math.abs(d+d3);if((count&0x1f)===0){let min=dif[0],num=0;dif[0]=0;for(let j=1;j<7;j++){if(dif[j]<min){min=dif[j];num=j;}
dif[j]=0;}
switch(num){case 1:if(k1>=-16)k1--;break;case 2:if(k1<16)k1++;break;case 3:if(k2>=-16)k2--;break;case 4:if(k2<16)k2++;break;case 5:if(k3>=-16)k3--;break;case 6:if(k3<16)k3++;break;}}}}
return true;}
export{LDECODE,LBITS,DDECODE,DBITS,SDDECODE,SDBITS,Unpack29,UNPACK29_FILTER_MAX};