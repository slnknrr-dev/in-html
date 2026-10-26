import{Matcher,matchLen}from"./lz.js";const LC=3,LP=0,PB=2;const PROPS=(PB*5+LP)*9+LC;const MAX_LEN=273;function lzmaLevel(level=6){const l=Math.max(0,Math.min(9,Math.round(level)));const dict=[1<<18,1<<20,1<<21,1<<22,1<<22,1<<23,1<<23,1<<24,1<<25,1<<26][l];const depth=[4,8,12,16,24,32,48,64,96,128][l];const nice=[16,24,32,48,64,96,128,192,273,273][l];return{dict,depth,nice,lazy:l>=2};}
class RangeEncoder{constructor(cap=1<<16){this.buf=new Uint8Array(cap);this.pos=0;this.low=0;this.range=0xffffffff;this.cache=0;this.cacheSize=1;}
byte(b){if(this.pos>=this.buf.length){const n=new Uint8Array(this.buf.length*2);n.set(this.buf);this.buf=n;}this.buf[this.pos++]=b;}
shiftLow(){if(this.low<0xff000000||this.low>=0x100000000){const carry=this.low>=0x100000000?1:0;let temp=this.cache;do{this.byte((temp+carry)&0xff);temp=0xff;}while(--this.cacheSize!==0);this.cache=Math.floor(this.low/0x1000000)&0xff;}
this.cacheSize++;this.low=(this.low%0x1000000)*256;}
bit(p,i,b){const prob=p[i];const bound=(this.range>>>11)*prob;if(!b){this.range=bound;p[i]=prob+((2048-prob)>>5);}else{this.low+=bound;this.range=(this.range-bound)>>>0;p[i]=prob-(prob>>5);}
while(this.range<0x1000000){this.range=(this.range<<8)>>>0;this.shiftLow();}}
direct(v,n){for(let k=n-1;k>=0;k--){this.range>>>=1;if((v>>>k)&1)this.low+=this.range;while(this.range<0x1000000){this.range=(this.range<<8)>>>0;this.shiftLow();}}}
tree(p,base,n,v){let m=1;for(let k=n-1;k>=0;k--){const b=(v>>>k)&1;this.bit(p,base+m,b);m=(m<<1)|b;}}
reverse(p,base,n,v){let m=1;for(let k=0;k<n;k++){const b=v&1;this.bit(p,base+m,b);m=(m<<1)|b;v>>>=1;}}
flush(){for(let i=0;i<5;i++)this.shiftLow();return this.buf.subarray(0,this.pos);}
get size(){return this.pos+this.cacheSize+5;}}
const probs=(n)=>new Uint16Array(n).fill(1024);class LenCoder{constructor(){this.p=probs(2+16*8*2+256);}
encode(rc,l,posState){const p=this.p;if(l<8){rc.bit(p,0,0);rc.tree(p,2+posState*8,3,l);}
else if(l<16){rc.bit(p,0,1);rc.bit(p,1,0);rc.tree(p,2+128+posState*8,3,l-8);}
else{rc.bit(p,0,1);rc.bit(p,1,1);rc.tree(p,2+256,8,l-16);}}}
const posSlotOf=(d)=>{if(d<4)return d;const n=31-Math.clz32(d);return(n<<1)|((d>>>(n-1))&1);};class LzmaEncoder{constructor(data,level){this.d=data;this.cfg=lzmaLevel(level);if(this.cfg.dict>data.length)this.cfg.dict=Math.max(1<<12,2**Math.ceil(Math.log2(Math.max(1,data.length))));this.mf=new Matcher(data,{window:this.cfg.dict,depth:this.cfg.depth,nice:this.cfg.nice});this.resetState();}
resetState(){this.state=0;this.reps=[0,0,0,0];this.isMatch=probs(12<<4);this.isRep=probs(12);this.isRepG0=probs(12);this.isRepG1=probs(12);this.isRepG2=probs(12);this.isRep0Long=probs(12<<4);this.lit=probs(0x300<<(LC+LP));this.posSlot=probs(4*64);this.posSpecial=probs(1+114+16);this.align=probs(16);this.len=new LenCoder();this.repLen=new LenCoder();}
literal(rc,i){const d=this.d;const prev=i>0?d[i-1]:0;const base=0x300*(((i&((1<<LP)-1))<<LC)+(prev>>(8-LC)));rc.bit(this.isMatch,(this.state<<4)|(i&3),0);let sym=d[i]|0x100;if(this.state>=7){let match=d[i-this.reps[0]-1],offs=0x100;do{match<<=1;rc.bit(this.lit,base+offs+(match&offs)+(sym>>8),(sym>>7)&1);sym<<=1;offs&=~(match^sym);}while(sym<0x10000);}else{do{rc.bit(this.lit,base+(sym>>8),(sym>>7)&1);sym<<=1;}while(sym<0x10000);}
this.state=this.state<4?0:this.state<10?this.state-3:this.state-6;}
match(rc,i,len,dist){const ps=i&3,s=this.state;rc.bit(this.isMatch,(s<<4)|ps,1);rc.bit(this.isRep,s,0);this.len.encode(rc,len-2,ps);const d=dist-1;const slot=posSlotOf(d);rc.tree(this.posSlot,Math.min(len-2,3)*64,6,slot);if(slot>=4){const footer=(slot>>>1)-1;const base=(2|(slot&1))<<footer;const red=d-base;if(slot<14)rc.reverse(this.posSpecial,base-slot,footer,red);else{rc.direct(red>>>4,footer-4);rc.reverse(this.align,0,4,red&15);}}
const r=this.reps;r[3]=r[2];r[2]=r[1];r[1]=r[0];r[0]=d;this.state=s<7?7:10;}
rep(rc,i,len,idx){const ps=i&3,s=this.state,r=this.reps;rc.bit(this.isMatch,(s<<4)|ps,1);rc.bit(this.isRep,s,1);if(idx===0){rc.bit(this.isRepG0,s,0);rc.bit(this.isRep0Long,(s<<4)|ps,len===1?0:1);if(len===1){this.state=s<7?9:11;return;}}else{rc.bit(this.isRepG0,s,1);const dd=r[idx];if(idx===1)rc.bit(this.isRepG1,s,0);else{rc.bit(this.isRepG1,s,1);rc.bit(this.isRepG2,s,idx-2);if(idx===3)r[3]=r[2];r[2]=r[1];}
if(idx>=1){r[1]=r[0];r[0]=dd;}}
this.repLen.encode(rc,len-2,ps);this.state=s<7?8:11;}
choose(i){const d=this.d,n=d.length;const left=n-i;if(left<2)return this.shortRepOk(i)?[3,1,0]:[0,1,0];const maxLen=Math.min(MAX_LEN,left);let repLen=0,repIdx=0;for(let k=0;k<4;k++){const l=matchLen(d,i,this.reps[k]+1,maxLen);if(l>repLen){repLen=l;repIdx=k;}}
if(repLen>=this.cfg.nice)return[2,repLen,repIdx];let mainLen=this.mf.find(i,maxLen,3),mainDist=this.mf.dist;if(mainLen>=this.cfg.nice)return[1,mainLen,mainDist];if(repLen>=2&&(repLen+1>=mainLen||(repLen+2>=mainLen&&mainDist>=512)||(repLen+3>=mainLen&&mainDist>=32768)))return[2,repLen,repIdx];if(mainLen===3&&mainDist>=1<<14)mainLen=0;if(mainLen<3)return this.shortRepOk(i)?[3,1,0]:[0,1,0];if(this.cfg.lazy&&left>mainLen+1){const next=this.mf.find(i+1,maxLen,3),nd=this.mf.dist;if(next>mainLen+1||(next===mainLen+1&&nd<=mainDist*2))return this.shortRepOk(i)?[3,1,0]:[0,1,0];}
return[1,mainLen,mainDist];}
shortRepOk(i){const j=i-this.reps[0]-1;return j>=0&&this.d[j]===this.d[i]&&i>0;}
emit(rc,i,c){switch(c[0]){case 0:this.literal(rc,i);break;case 1:this.match(rc,i,c[1],c[2]);break;case 2:this.rep(rc,i,c[1],c[2]);break;default:this.rep(rc,i,1,0);}}}
function lzma2DictProp(dict){for(let p=0;p<40;p++)if((2|(p&1))*2**((p>>1)+11)>=dict)return p;return 40;}
function lzma2(data,{level=6}={}){const enc=new LzmaEncoder(data,level);const out=[];let total=0;const push=(b)=>{out.push(b);total+=b.length;};const n=data.length;let pos=0,first=true,propsSent=false,needReset=false;while(pos<n){const rc=new RangeEncoder();const start=pos;while(pos<n&&pos-start+MAX_LEN<=1<<21&&rc.size+40<=1<<16){const c=enc.choose(pos);enc.emit(rc,pos,c);pos+=c[1];}
const packed=rc.flush();const usize=pos-start;if(packed.length>=usize||packed.length>1<<16){for(let o=start;o<pos;o+=1<<16){const e=Math.min(pos,o+(1<<16));push(Uint8Array.of(first?1:2,(e-o-1)>>8,(e-o-1)&255));push(data.subarray(o,e));first=false;}
enc.resetState();needReset=true;continue;}
const reset=first?3:!propsSent?2:needReset?1:0;const u=usize-1,p=packed.length-1;const head=[0x80|(reset<<5)|(u>>>16),(u>>8)&255,u&255,p>>8,p&255];if(reset>=2)head.push(PROPS);push(Uint8Array.from(head));push(packed.slice());first=false;propsSent=true;needReset=false;}
push(Uint8Array.of(0));const res=new Uint8Array(total);let o=0;for(const b of out){res.set(b,o);o+=b.length;}
res.dictSize=enc.cfg.dict;return res;}
function lzmaAlone(data,{level=6}={}){const enc=new LzmaEncoder(data,level);const rc=new RangeEncoder(Math.max(1<<16,data.length>>1));for(let i=0;i<data.length;){const c=enc.choose(i);enc.emit(rc,i,c);i+=c[1];}
const body=rc.flush();const out=new Uint8Array(13+body.length);out[0]=PROPS;const dict=enc.cfg.dict;out[1]=dict;out[2]=dict>>>8;out[3]=dict>>>16;out[4]=dict>>>24;let s=data.length;for(let k=0;k<8;k++){out[5+k]=s%256;s=Math.floor(s/256);}
out.set(body,13);return out;}
export{lzma2,lzma2DictProp,lzmaAlone};