import{corrupt,unsupported,fail}from"./io.js";const OUT=1<<16,DLE=0x90;const clampMax=(max)=>(max>0&&max<OUT?max:OUT);class Bits{constructor(r){this.r=r;this.bb=0;this.bc=0;this.pad=0;}
need(n){while(this.bc<n){let c=this.r.byte();if(c<0){c=0;this.pad+=8;}
this.bb|=c<<this.bc;this.bc+=8;}}
get(n){this.need(n);const v=this.bb&((1<<n)-1);this.bb>>>=n;this.bc-=n;return v;}
peek(n){this.need(n);return this.bb&((1<<n)-1);}
drop(n){this.bb>>>=n;this.bc-=n;}
get over(){return this.pad>this.bc;}}
function limited(s,size){if(size==null)return s;let left=size;return{size,read(max){if(left<=0)return null;const b=s.read(Math.min(clampMax(max),left));if(!b){left=0;return null;}
left-=b.length;return b;},};}
const N_SHRINK=8192,FREE=0xffff;function unshrinkStream(r,{size}={}){const parent=new Uint16Array(N_SHRINK).fill(FREE),suffix=new Uint8Array(N_SHRINK);const stack=new Uint8Array(N_SHRINK+1),isParent=new Uint8Array(N_SHRINK);for(let i=0;i<256;i++){parent[i]=0;suffix[i]=i;}
const bits=new Bits(r);let width=9,head=257,prev=-1,prevFirst=0;const partialClear=()=>{isParent.fill(0);for(let i=257;i<N_SHRINK;i++)if(parent[i]!==FREE&&parent[i]>256)isParent[parent[i]]=1;for(let i=257;i<N_SHRINK;i++)if(!isParent[i])parent[i]=FREE;head=257;};const top=stack.length,out=new Uint8Array(OUT);let sp=top,done=false;const next=()=>{for(;;){const code=bits.get(width);if(bits.over)return false;if(code===256){const sub=bits.get(width);if(bits.over)return false;if(sub===1){if(width===13)corrupt('shrink code width');width++;}else if(sub===2)partialClear();else corrupt('shrink control code '+sub);continue;}
let f=-1;if(prev>=0){f=head;while(f<N_SHRINK&&parent[f]!==FREE)f++;}
let c=code,p=top;if(c>256&&parent[c]===FREE){if(c!==f)corrupt('shrink code '+c);stack[--p]=prevFirst;c=prev;}
while(c>255){if(p<2||parent[c]===FREE)corrupt('shrink string');stack[--p]=suffix[c];c=parent[c];}
stack[--p]=c;if(f>=0&&f<N_SHRINK){parent[f]=prev;suffix[f]=c;head=f+1;}
prev=code;prevFirst=c;sp=p;return true;}};return limited({read(max){if(done)return null;max=clampMax(max);let n=0;while(n<max){if(sp===top&&!next()){done=true;break;}
const k=Math.min(top-sp,max-n);for(let i=0;i<k;i++)out[n+i]=stack[sp+i];n+=k;sp+=k;}
return n?out.subarray(0,n):null;},},size);}
const L_MASK=[0,0x7f,0x3f,0x1f,0x0f];function unreduceStream(r,factor,{size}={}){if(!(factor>=1&&factor<=4))unsupported('reduce factor '+factor);const bits=new Bits(r);const count=new Uint8Array(256),fol=new Uint8Array(256*32),width=new Uint8Array(256);const lmask=L_MASK[factor],dshift=8-factor;const W=8192,M=W-1,win=new Uint8Array(W),out=new Uint8Array(OUT);let loaded=false,pos=0,last=0,state=0,V=0,len=0,copy=0,dist=0,done=false;const load=()=>{for(let x=255;x>=0;x--){const n=bits.get(6);if(n>32)corrupt('reduce follower set');count[x]=n;width[x]=n<=2?1:32-Math.clz32(n-1);for(let i=0;i<n;i++)fol[x*32+i]=bits.get(8);}
if(bits.over)fail('truncated','unexpected end of reduced data');loaded=true;};const middle=()=>{const n=count[last];let c;if(!n||bits.get(1))c=bits.get(8);else{const i=bits.get(width[last]);if(i>=n&&!bits.over)corrupt('reduce follower index');c=fol[last*32+i];}
if(bits.over){if(size!=null)fail('truncated','unexpected end of reduced data');return-1;}
return(last=c);};return{size,read(max){if(done)return null;if(!loaded){if(size===0){done=true;return null;}
load();}
max=clampMax(max);const lim=size!=null?Math.min(max,size-pos):max;let n=0;while(n<lim){if(copy){const k=Math.min(copy,lim-n);for(let i=0;i<k;i++){const b=win[(pos-dist)&M];win[pos&M]=b;out[n++]=b;pos++;}
copy-=k;continue;}
const c=middle();if(c<0){done=true;break;}
if(state===0){if(c!==DLE){win[pos&M]=c;out[n++]=c;pos++;}else state=1;}else if(state===1){if(c){V=c;len=V&lmask;state=len===lmask?2:3;}else{win[pos&M]=DLE;out[n++]=DLE;pos++;state=0;}}else if(state===2){len+=c;state=3;}else{dist=((V>>dshift)<<8)+c+1;copy=len+3;state=0;}}
if(size!=null&&pos>=size)done=true;return n?out.subarray(0,n):((done=true),null);},};}
function sfTree(r,n){const pairs=r.byte()+1;if(!pairs)fail('truncated','unexpected end of imploded data');const lens=new Uint8Array(n);let k=0;for(let i=0;i<pairs;i++){const b=r.byte();if(b<0)fail('truncated','unexpected end of imploded data');const len=(b&15)+1,cnt=(b>>4)+1;if(k+cnt>n)corrupt('Shannon-Fano tree');lens.fill(len,k,k+cnt);k+=cnt;}
if(k!==n)corrupt('Shannon-Fano tree');const order=Array.from({length:n},(_,i)=>i).sort((a,b)=>lens[a]-lens[b]||a-b);let code=0,inc=0,last=0,maxLen=0;const codes=new Uint32Array(n);for(let i=n-1;i>=0;i--){const s=order[i];code+=inc;if(lens[s]!==last){last=lens[s];inc=1<<(16-last);}
if(code>0xffff)corrupt('Shannon-Fano tree');codes[s]=code;if(last>maxLen)maxLen=last;}
const table=new Uint16Array(1<<maxLen);for(let s=0;s<n;s++){const len=lens[s];let v=codes[s]>>>(16-len),rev=0;for(let i=0;i<len;i++){rev=(rev<<1)|(v&1);v>>>=1;}
for(let j=rev;j<table.length;j+=1<<len){if(table[j])corrupt('Shannon-Fano tree');table[j]=(s<<5)|len;}}
return{table,bits:maxLen};}
function explodeStream(r,{bigDictionary=false,literalTree=false,size}={}){const minMatch=literalTree?3:2,lowBits=bigDictionary?7:6;const W=8192,M=W-1,win=new Uint8Array(W),out=new Uint8Array(OUT);let lit=null,lenT=null,distT=null,bits=null,pos=0,copy=0,dist=0,done=false;const decode=(t)=>{const e=t.table[bits.peek(t.bits)];if(!e)corrupt('Shannon-Fano code');bits.drop(e&31);return e>>5;};return{size,read(max){if(done)return null;if(!bits){if(size===0){done=true;return null;}
if(literalTree)lit=sfTree(r,256);lenT=sfTree(r,64);distT=sfTree(r,64);bits=new Bits(r);}
max=clampMax(max);const lim=size!=null?Math.min(max,size-pos):max;let n=0;while(n<lim){if(copy){const k=Math.min(copy,lim-n);for(let i=0;i<k;i++){const b=win[(pos-dist)&M];win[pos&M]=b;out[n++]=b;pos++;}
copy-=k;continue;}
if(bits.get(1)){const c=lit?decode(lit):bits.get(8);if(bits.over)break;win[pos&M]=c;out[n++]=c;pos++;}else{const low=bits.get(lowBits);const d=((decode(distT)<<lowBits)|low)+1;let l=decode(lenT);if(l===63)l+=bits.get(8);if(bits.over)break;dist=d;copy=l+minMatch;}}
if(bits.over){if(size!=null)fail('truncated','unexpected end of imploded data');done=true;}
if(size!=null&&pos>=size)done=true;return n?out.subarray(0,n):((done=true),null);},};}
export{unshrinkStream,unreduceStream,explodeStream};