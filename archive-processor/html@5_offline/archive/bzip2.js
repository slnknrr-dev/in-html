import{fail,corrupt}from"./io.js";let CRC=null;function crcTable(){if(CRC)return CRC;CRC=new Int32Array(256);for(let i=0;i<256;i++){let c=i<<24;for(let k=0;k<8;k++)c=c&0x80000000?(c<<1)^0x04c11db7:c<<1;CRC[i]=c;}
return CRC;}
const MAX_GROUPS=6,GROUP=50,MAX_LEN=20,FAST=10;class BitIn{constructor(r){this.r=r;this.bb=0;this.bc=0;}
bits(n){while(this.bc<n){const c=this.r.byte();if(c<0)fail('truncated','unexpected end of bzip2 data');this.bb=((this.bb<<8)|c)>>>0;this.bc+=8;}
this.bc-=n;return(this.bb>>>this.bc)&((1<<n)-1);}
bit(){return this.bits(1);}
peek20(){while(this.bc<MAX_LEN){let c=this.r.byte();if(c<0){c=0;this.pad=(this.pad||0)+8;}
this.bb=((this.bb<<8)|c)>>>0;this.bc+=8;}
return(this.bb>>>(this.bc-MAX_LEN))&0xfffff;}
skip(n){this.bc-=n;if(this.pad&&this.bc<this.pad)fail('truncated','unexpected end of bzip2 data');}
align(){this.bc-=this.bc&7;}}
function makeTable(lens,n){let minLen=32,maxLen=0;for(let i=0;i<n;i++){if(lens[i]>maxLen)maxLen=lens[i];if(lens[i]<minLen)minLen=lens[i];}
const perm=new Uint16Array(n),limit=new Int32Array(MAX_LEN+2),base=new Int32Array(MAX_LEN+2);let pp=0;for(let l=minLen;l<=maxLen;l++)for(let s=0;s<n;s++)if(lens[s]===l)perm[pp++]=s;const count=new Int32Array(MAX_LEN+2);for(let i=0;i<n;i++)count[lens[i]]++;let code=0,idx=0;for(let l=1;l<=MAX_LEN;l++){base[l]=idx-code;code+=count[l];idx+=count[l];limit[l]=code-1;code<<=1;}
const fast=new Int32Array(1<<FAST);for(let v=0;v<1<<FAST;v++){for(let l=minLen;l<=Math.min(maxLen,FAST);l++){const c=v>>(FAST-l);if(c<=limit[l]){fast[v]=(perm[base[l]+c]<<5)|l;break;}}}
return{fast,limit,base,perm,minLen,maxLen};}
function bzip2Stream(reader,{size,multi=true}={}){const bits=new BitIn(reader);const T=crcTable();let level=0,tt=null,streamCrc=0,done=false;let left=0,tPos=0,blockCrc=0,wantCrc=0,last=-1,run=0,rep=0,repByte=0,total=0;let out=new Uint8Array(1<<16);const header=()=>{if(bits.bits(8)!==0x42||bits.bits(8)!==0x5a||bits.bits(8)!==0x68)corrupt('bzip2 signature');const l=bits.bits(8)-0x30;if(l<1||l>9)corrupt('bzip2 block size');level=l;if(!tt||tt.length<level*100000)tt=new Int32Array(level*100000);streamCrc=0;};const block=()=>{for(;;){const m1=bits.bits(24),m2=bits.bits(24);if(m1===0x177245&&m2===0x385090){const c=bits.bits(16)*65536+bits.bits(16);if(c!==streamCrc>>>0)fail('checksum','bzip2 stream CRC mismatch');bits.align();if(!multi)return false;const pad=bits.pad||0;let b;if(bits.bc-pad>=8){b=bits.bits(8);bits.bc+=8;}else if(bits.bc>0)b=-1;else{b=reader.byte();if(b>=0){bits.bb=((bits.bb<<8)|b)>>>0;bits.bc+=8;}}
if(b!==0x42)return false;header();continue;}
if(m1!==0x314159||m2!==0x265359)corrupt('bzip2 block signature');break;}
wantCrc=bits.bits(16)*65536+bits.bits(16);if(bits.bit())fail('unsupported','not supported: randomised bzip2 blocks (bzip2 0.9.0 and older)');const origPtr=bits.bits(24);const used=bits.bits(16);const seqToUnseq=new Uint8Array(256);let nInUse=0;for(let i=0;i<16;i++){if(!(used&(0x8000>>i)))continue;const g=bits.bits(16);for(let j=0;j<16;j++)if(g&(0x8000>>j))seqToUnseq[nInUse++]=i*16+j;}
if(!nInUse)corrupt('bzip2 symbol map');const alpha=nInUse+2;const nGroups=bits.bits(3);if(nGroups<2||nGroups>MAX_GROUPS)corrupt('bzip2 table count');const nSel=bits.bits(15);if(!nSel)corrupt('bzip2 selectors');const mtfSel=[0,1,2,3,4,5].slice(0,nGroups);const selectors=new Uint8Array(nSel);for(let i=0;i<nSel;i++){let j=0;while(bits.bit()){j++;if(j>=nGroups)corrupt('bzip2 selector');}
const v=mtfSel[j];mtfSel.splice(j,1);mtfSel.unshift(v);selectors[i]=v;}
const tables=[];const lens=new Uint8Array(alpha);for(let g=0;g<nGroups;g++){let cur=bits.bits(5);for(let s=0;s<alpha;s++){for(;;){if(cur<1||cur>MAX_LEN)corrupt('bzip2 code length');if(!bits.bit())break;cur+=bits.bit()?-1:1;}
lens[s]=cur;}
tables.push(makeTable(lens,alpha));}
const counts=new Int32Array(256);const mtf=new Uint8Array(256);for(let i=0;i<256;i++)mtf[i]=i;const eob=nInUse+1,max=level*100000;let n=0,sel=0,gLeft=0,t=null,runLen=0,runBit=1;let bb=bits.bb,bc=bits.bc,pad=bits.pad||0,fast=null;for(;;){if(!gLeft){if(sel>=nSel)corrupt('bzip2 selector overflow');t=tables[selectors[sel++]];fast=t.fast;gLeft=GROUP;}
gLeft--;while(bc<MAX_LEN){let c=reader.byte();if(c<0){c=0;pad+=8;}
bb=((bb<<8)|c)>>>0;bc+=8;}
const v20=(bb>>>(bc-MAX_LEN))&0xfffff;let s;const f=fast[v20>>>(MAX_LEN-FAST)];if(f){bc-=f&31;s=f>>5;}
else{s=-1;for(let l=Math.max(t.minLen,FAST+1);l<=t.maxLen;l++){const c=v20>>>(MAX_LEN-l);if(c<=t.limit[l]){bc-=l;s=t.perm[t.base[l]+c];break;}}
if(s<0)corrupt('bzip2 Huffman code');}
if(bc<pad)fail('truncated','unexpected end of bzip2 data');if(s<=1){runLen+=runBit<<s;runBit<<=1;if(runLen>max)corrupt('bzip2 run');continue;}
if(runLen){if(n+runLen>max)corrupt('bzip2 block overflow');const v=seqToUnseq[mtf[0]];counts[v]+=runLen;tt.fill(v,n,n+runLen);n+=runLen;runLen=0;runBit=1;}
if(s===eob)break;if(n>=max)corrupt('bzip2 block overflow');const k=s-1;const v=mtf[k];if(k<16){for(let j=k;j>0;j--)mtf[j]=mtf[j-1];}else mtf.copyWithin(1,0,k);mtf[0]=v;const b=seqToUnseq[v];counts[b]++;tt[n++]=b;}
bits.bb=bb;bits.bc=bc;bits.pad=pad;if(origPtr>=n)corrupt('bzip2 origin pointer');const cf=new Int32Array(256);for(let i=0,s=0;i<256;i++){cf[i]=s;s+=counts[i];}
for(let i=0;i<n;i++){const b=tt[i]&255;tt[cf[b]++]|=i<<8;}
tPos=tt[origPtr]>>>8;left=n;blockCrc=-1;last=-1;run=0;rep=0;return true;};let started=false,inBlock=false;return{size,read(max=1<<20){if(done)return null;if(!started){started=true;header();}
if(out.length<max)out=new Uint8Array(max);let o=0;while(o<max){if(rep>0){const n=Math.min(rep,max-o);out.fill(repByte,o,o+n);for(let i=0;i<n;i++)blockCrc=(blockCrc<<8)^T[((blockCrc>>>24)^repByte)&255];o+=n;rep-=n;continue;}
if(!inBlock||left===0){if(inBlock){const c=~blockCrc>>>0;if(c!==wantCrc)fail('checksum','bzip2 block CRC mismatch');streamCrc=(((streamCrc<<1)|(streamCrc>>>31))^c)>>>0;inBlock=false;}
if(!block()){done=true;if(size!=null&&total+o!==size)corrupt('bzip2 size');break;}
inBlock=true;continue;}
while(left>0&&o<max){const e=tt[tPos];const b=e&255;tPos=e>>>8;left--;if(run===4){run=0;if(b){rep=b;repByte=last;break;}
continue;}
if(b===last)run++;else{run=1;last=b;}
out[o++]=b;blockCrc=(blockCrc<<8)^T[((blockCrc>>>24)^b)&255];}}
total+=o;return o?out.subarray(0,o):null;},};}
export{bzip2Stream};