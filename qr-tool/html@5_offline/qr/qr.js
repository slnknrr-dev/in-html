import{ALNUM,charCountBits,dataCodewords,ecBlockCount,ecCodewordsPerBlock,rawModules,formatWord,EC_BITS,alignmentPositions,versionWord,maskBit}from"./spec.js";const QR_GF=(()=>{const exp=new Uint8Array(512),log=new Uint8Array(256);for(let i=0,x=1;i<255;i++){exp[i]=x;log[x]=i;x<<=1;if(x&256)x^=0x11d;}
for(let i=255;i<512;i++)exp[i]=exp[i-255];return{exp,log};})();const QR_GEN_CACHE=new Map();function qr_mul(a,b){return a&&b?QR_GF.exp[QR_GF.log[a]+QR_GF.log[b]]:0;}
function qr_rsGen(n){let g=QR_GEN_CACHE.get(n);if(g)return g;g=[1];for(let i=0;i<n;i++){const ng=new Array(g.length+1).fill(0);for(let j=0;j<g.length;j++){ng[j]^=g[j];ng[j+1]^=qr_mul(g[j],QR_GF.exp[i]);}
g=ng;}
QR_GEN_CACHE.set(n,g);return g;}
function qr_rsRem(data,n){const gen=qr_rsGen(n),rem=new Array(n).fill(0);for(const b of data){const f=b^rem.shift();rem.push(0);for(let j=0;j<n;j++)rem[j]^=qr_mul(gen[j+1],f);}
return rem;}
function qr_segment(text){const bits=[];const put=(val,len)=>{for(let i=len-1;i>=0;i--)bits.push((val>>>i)&1);};if(text&&/^[0-9]*$/.test(text)){for(let i=0;i<text.length;i+=3){const g=text.slice(i,i+3);put(+g,g.length*3+1);}
return{mode:1,count:text.length,bits};}
if(text&&/^[0-9A-Z $%*+\-./:]*$/.test(text)){for(let i=0;i<text.length;i+=2){const a=ALNUM.indexOf(text[i]);if(i+1<text.length)put(a*45+ALNUM.indexOf(text[i+1]),11);else put(a,6);}
return{mode:2,count:text.length,bits};}
const bytes=new TextEncoder().encode(text);for(const b of bytes)put(b,8);return{mode:4,count:bytes.length,bits};}
function qr_encode(text,ec){const seg=qr_segment(text);let v=1,cap=0;for(;;v++){if(v>40)throw new RangeError('QR: data too long');const cc=charCountBits(seg.mode,v);cap=dataCodewords(v,ec)*8;if(seg.count<2**cc&&4+cc+seg.bits.length<=cap)break;}
const bits=[];const put=(val,len)=>{for(let i=len-1;i>=0;i--)bits.push((val>>>i)&1);};put(seg.mode,4);put(seg.count,charCountBits(seg.mode,v));for(const b of seg.bits)bits.push(b);put(0,Math.min(4,cap-bits.length));put(0,(8-(bits.length%8))%8);const data=[];for(let i=0;i<bits.length;i+=8){let b=0;for(let j=0;j<8;j++)b=(b<<1)|bits[i+j];data.push(b);}
for(let p=0xec;data.length<cap/8;p^=0xec^0x11)data.push(p);return{v,data};}
function qr_interleave(data,v,ec){const nb=ecBlockCount(v,ec),ecLen=ecCodewordsPerBlock(v,ec);const raw=rawModules(v)>>3;const nShort=nb-(raw%nb),shortLen=Math.floor(raw/nb);const blocks=[];for(let i=0,k=0;i<nb;i++){const len=shortLen-ecLen+(i<nShort?0:1);const d=data.slice(k,k+len);k+=len;blocks.push([d,qr_rsRem(d,ecLen)]);}
const out=[];for(let i=0;i<=shortLen-ecLen;i++)for(const[d]of blocks)if(i<d.length)out.push(d[i]);for(let i=0;i<ecLen;i++)for(const[,e]of blocks)out.push(e[i]);return out;}
function qr_drawFormat(m,fn,ec,mask){const size=m.length,bits=formatWord(ec,mask);const set=(x,y,i)=>{m[y][x]=((bits>>>i)&1)===1;fn[y][x]=true;};for(let i=0;i<=5;i++)set(8,i,i);set(8,7,6);set(8,8,7);set(7,8,8);for(let i=9;i<15;i++)set(14-i,8,i);for(let i=0;i<8;i++)set(size-1-i,8,i);for(let i=8;i<15;i++)set(8,size-15+i,i);m[size-8][8]=true;fn[size-8][8]=true;}
function qr_penalty(m){const size=m.length;let p=0,dark=0;const line=(get)=>{let run=0,prev=null;for(let i=0;i<size;i++){const c=get(i);if(c===prev)run++;else{if(run>=5)p+=run-2;run=1;prev=c;}}
if(run>=5)p+=run-2;const at=(i)=>(i>=0&&i<size?get(i):false);for(let i=-4;i<=size;i++){if(at(i)||at(i+1)||at(i+2)||at(i+3))continue;if(at(i+4)&&!at(i+5)&&at(i+6)&&at(i+7)&&at(i+8)&&!at(i+9)&&at(i+10))p+=40;if(at(i-7)&&!at(i-6)&&at(i-5)&&at(i-4)&&at(i-3)&&!at(i-2)&&at(i-1))p+=40;}};for(let y=0;y<size;y++)line((x)=>m[y][x]);for(let x=0;x<size;x++)line((y)=>m[y][x]);for(let y=0;y<size;y++){for(let x=0;x<size;x++){const c=m[y][x];if(c)dark++;if(x<size-1&&y<size-1&&c===m[y][x+1]&&c===m[y+1][x]&&c===m[y+1][x+1])p+=3;}}
const total=size*size;p+=(Math.ceil(Math.abs(dark*20-total*10)/total)-1)*10;return p;}
function qrMatrix(text,ec='M'){ec=String(ec||'M').toUpperCase();if(!(ec in EC_BITS))ec='M';const{v,data}=qr_encode(String(text??''),ec);const cw=qr_interleave(data,v,ec);const size=v*4+17;const m=Array.from({length:size},()=>new Array(size).fill(false));const fn=Array.from({length:size},()=>new Array(size).fill(false));const set=(x,y,d)=>{m[y][x]=d;fn[y][x]=true;};for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0);}
for(const[cx,cy]of[[3,3],[size-4,3],[3,size-4]]){for(let dy=-4;dy<=4;dy++){for(let dx=-4;dx<=4;dx++){const x=cx+dx,y=cy+dy;if(x<0||y<0||x>=size||y>=size)continue;const d=Math.max(Math.abs(dx),Math.abs(dy));set(x,y,d!==2&&d!==4);}}}
const ap=alignmentPositions(v),last=ap.length-1;for(let i=0;i<=last;i++){for(let j=0;j<=last;j++){if((i===0&&j===0)||(i===0&&j===last)||(i===last&&j===0))continue;for(let dy=-2;dy<=2;dy++){for(let dx=-2;dx<=2;dx++)set(ap[i]+dx,ap[j]+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);}}}
qr_drawFormat(m,fn,ec,0);if(v>=7){const vb=versionWord(v);for(let i=0;i<18;i++){const d=((vb>>>i)&1)===1,a=size-11+(i%3),b=Math.floor(i/3);set(a,b,d);set(b,a,d);}}
let bit=0;const nbits=cw.length*8;for(let right=size-1;right>=1;right-=2){if(right===6)right=5;const up=((right+1)&2)===0;for(let k=0;k<size;k++){const y=up?size-1-k:k;for(let j=0;j<2;j++){const x=right-j;if(fn[y][x])continue;if(bit<nbits)m[y][x]=((cw[bit>>>3]>>>(7-(bit&7)))&1)===1;bit++;}}}
const applyMask=(k)=>{for(let y=0;y<size;y++){for(let x=0;x<size;x++)if(!fn[y][x]&&maskBit(k,y,x))m[y][x]=!m[y][x];}};let best=0,bestP=Infinity;for(let k=0;k<8;k++){applyMask(k);qr_drawFormat(m,fn,ec,k);const p=qr_penalty(m);if(p<bestP){bestP=p;best=k;}
applyMask(k);}
applyMask(best);qr_drawFormat(m,fn,ec,best);return m;}
export{qrMatrix};