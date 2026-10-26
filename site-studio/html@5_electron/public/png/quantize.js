const WR=3,WG=4,WB=2,WA=3;function hasTranslucency(rgba){for(let i=3;i<rgba.length;i+=4)if(rgba[i]!==255)return true;return false;}
function histogram(rgba,alpha){const bits=alpha?20:15;const counts=new Uint32Array(1<<bits);const n=rgba.length>>2;const keys=new Uint32Array(n);for(let i=0,p=0;i<n;i++,p+=4){const a=rgba[p+3];let k;if(alpha)k=a<8?0:((rgba[p]>>3)<<15)|((rgba[p+1]>>3)<<10)|((rgba[p+2]>>3)<<5)|(a>>3);else k=((rgba[p]>>3)<<10)|((rgba[p+1]>>3)<<5)|(rgba[p+2]>>3);keys[i]=k;counts[k]++;}
const slot=new Int32Array(1<<bits);let m=0;for(let k=0;k<counts.length;k++)if(counts[k])slot[k]=m++;const r=new Float64Array(m),g=new Float64Array(m),b=new Float64Array(m),al=new Float64Array(m),w=new Float64Array(m);for(let i=0,p=0;i<n;i++,p+=4){const s=slot[keys[i]];const a=rgba[p+3];if(alpha&&a<8){w[s]++;continue;}
r[s]+=rgba[p];g[s]+=rgba[p+1];b[s]+=rgba[p+2];al[s]+=a;w[s]++;}
for(let s=0;s<m;s++){const isClear=alpha&&al[s]===0&&r[s]===0&&g[s]===0&&b[s]===0;if(isClear)continue;r[s]/=w[s];g[s]/=w[s];b[s]/=w[s];al[s]=alpha?al[s]/w[s]:255;}
return{r,g,b,a:al,w,m};}
function medianCut(H,colors,alpha){const chans=alpha?[H.r,H.g,H.b,H.a]:[H.r,H.g,H.b];const wts=[WR,WG,WB,WA];const order=new Int32Array(H.m);for(let i=0;i<H.m;i++)order[i]=i;const stats=(start,end)=>{let W=0;const s1=[0,0,0,0],s2=[0,0,0,0];for(let k=start;k<end;k++){const e=order[k],w=H.w[e];W+=w;for(let c=0;c<chans.length;c++){const v=chans[c][e];s1[c]+=w*v;s2[c]+=w*v*v;}}
let sse=0,axis=0,best=-1;for(let c=0;c<chans.length;c++){const v=(s2[c]-(s1[c]*s1[c])/W)*wts[c];sse+=v;if(v>best){best=v;axis=c;}}
return{start,end,W,sse:end-start>1?sse:0,axis};};const boxes=[stats(0,H.m)];while(boxes.length<colors){let bi=-1,top=0;for(let i=0;i<boxes.length;i++)if(boxes[i].sse>top){top=boxes[i].sse;bi=i;}
if(bi<0)break;const bx=boxes[bi];const ch=chans[bx.axis];const sub=Array.from(order.subarray(bx.start,bx.end)).sort((x,y)=>ch[x]-ch[y]);order.set(sub,bx.start);let tw=0,ts=0,tq=0;for(const e of sub){const w=H.w[e],v=ch[e];tw+=w;ts+=w*v;tq+=w*v*v;}
let lw=0,ls=0,lq=0,cut=1,bestErr=Infinity;for(let k=0;k<sub.length-1;k++){const e=sub[k],w=H.w[e],v=ch[e];lw+=w;ls+=w*v;lq+=w*v*v;if(ch[sub[k+1]]===v)continue;const rw=tw-lw,rs=ts-ls,rq=tq-lq;const err=(lq-(ls*ls)/lw)+(rq-(rs*rs)/rw);if(err<bestErr){bestErr=err;cut=k+1;}}
if(bestErr===Infinity){bx.sse=0;continue;}
boxes.splice(bi,1,stats(bx.start,bx.start+cut),stats(bx.start+cut,bx.end));}
const pal=[];for(const bx of boxes){let W=0,r=0,g=0,b=0,a=0;for(let k=bx.start;k<bx.end;k++){const e=order[k],w=H.w[e];W+=w;r+=w*H.r[e];g+=w*H.g[e];b+=w*H.b[e];a+=w*H.a[e];}
pal.push([r/W,g/W,b/W,alpha?a/W:255]);}
return pal;}
function octree(H,colors,alpha){const DEPTH=5,FAN=alpha?16:8;const levels=Array.from({length:DEPTH},()=>[]);const root={kids:null,leaf:false,w:0,r:0,g:0,b:0,a:0};let leaves=0;for(let e=0;e<H.m;e++){const w=H.w[e];const R=Math.min(255,Math.round(H.r[e])),G=Math.min(255,Math.round(H.g[e])),B=Math.min(255,Math.round(H.b[e])),A=Math.min(255,Math.round(H.a[e]));let node=root;for(let lv=0;lv<DEPTH;lv++){const sh=7-lv;const ix=(((R>>sh)&1)<<3)|(((G>>sh)&1)<<2)|(((B>>sh)&1)<<1)|(alpha?(A>>sh)&1:0);const ci=alpha?ix:ix>>1;if(!node.kids){node.kids=new Array(FAN).fill(null);levels[lv].push(node);}
let k=node.kids[ci];if(!k){k=node.kids[ci]={kids:null,leaf:lv===DEPTH-1,w:0,r:0,g:0,b:0,a:0};if(k.leaf)leaves++;}
node=k;}
node.w+=w;node.r+=w*H.r[e];node.g+=w*H.g[e];node.b+=w*H.b[e];node.a+=w*H.a[e];}
const sum=(n)=>{if(!n.kids)return n;for(const k of n.kids)if(k){sum(k);}
if(!n.leaf){n.w=0;n.r=n.g=n.b=n.a=0;for(const k of n.kids)if(k){n.w+=k.w;n.r+=k.r;n.g+=k.g;n.b+=k.b;n.a+=k.a;}}
return n;};sum(root);for(let lv=DEPTH-1;lv>=0&&leaves>colors;lv--){const list=levels[lv].filter((n)=>n.kids).sort((x,y)=>x.w-y.w);for(const n of list){if(leaves<=colors)break;let c=0;for(const k of n.kids)if(k)c++;n.kids=null;n.leaf=true;leaves-=c-1;}}
const pal=[];const walk=(n)=>{if(n.leaf||!n.kids){if(n.w>0)pal.push([n.r/n.w,n.g/n.w,n.b/n.w,alpha?n.a/n.w:255]);return;}
for(const k of n.kids)if(k)walk(k);};walk(root);return pal.slice(0,colors);}
function nearest(pal,n,r,g,b,a){let best=0,bd=Infinity;for(let i=0,p=0;i<n;i++,p+=4){const dr=r-pal[p],dg=g-pal[p+1],db=b-pal[p+2],da=a-pal[p+3];const d=WR*dr*dr+WG*dg*dg+WB*db*db+WA*da*da;if(d<bd){bd=d;best=i;if(d===0)break;}}
return best;}
function refinePalette(H,pal,rounds,alpha){const n=pal.length;const P=new Float64Array(n*4);pal.forEach((c,i)=>P.set(c,i*4));for(let it=0;it<rounds;it++){const acc=new Float64Array(n*5);for(let e=0;e<H.m;e++){const k=nearest(P,n,H.r[e],H.g[e],H.b[e],H.a[e]);const w=H.w[e],o=k*5;acc[o]+=w;acc[o+1]+=w*H.r[e];acc[o+2]+=w*H.g[e];acc[o+3]+=w*H.b[e];acc[o+4]+=w*H.a[e];}
for(let k=0;k<n;k++){const o=k*5;if(acc[o]>0){P[k*4]=acc[o+1]/acc[o];P[k*4+1]=acc[o+2]/acc[o];P[k*4+2]=acc[o+3]/acc[o];P[k*4+3]=alpha?acc[o+4]/acc[o]:255;}}}
return Array.from({length:n},(_,k)=>[P[k*4],P[k*4+1],P[k*4+2],P[k*4+3]]);}
function buildPalette(rgba,{colors=256,method='mediancut',refine=2}={}){colors=Math.max(2,Math.min(256,colors|0));const alpha=hasTranslucency(rgba);const H=histogram(rgba,alpha);let pal=method==='octree'?octree(H,colors,alpha):medianCut(H,colors,alpha);if(refine>0&&pal.length>1)pal=refinePalette(H,pal,refine,alpha);const seen=new Set();const out=[];for(const c of pal){const q=c.map((v)=>Math.max(0,Math.min(255,Math.round(v))));if(q[3]<4){q[0]=q[1]=q[2]=q[3]=0;}
const key=((q[0]<<24)|(q[1]<<16)|(q[2]<<8)|q[3])>>>0;if(seen.has(key))continue;seen.add(key);out.push(q);}
const res=new Uint8Array(out.length*4);out.forEach((q,i)=>res.set(q,i*4));return res;}
function mapToPalette(rgba,width,height,palette,{dither=0}={}){const n=palette.length>>2;const P=Float64Array.from(palette);const alpha=hasTranslucency(rgba)||Array.from({length:n},(_,i)=>palette[i*4+3]).some((a)=>a!==255);const idx=new Uint8Array(width*height);const cache=new Int16Array(1<<(alpha?19:18)).fill(-1);const keyOf=alpha?(r,g,b,a)=>((r>>3)<<14)|((g>>3)<<9)|((b>>3)<<4)|(a>>4):(r,g,b)=>((r>>2)<<12)|((g>>2)<<6)|(b>>2);const look=(r,g,b,a)=>{const k=keyOf(r,g,b,a);let v=cache[k];if(v<0){v=cache[k]=nearest(P,n,r,g,b,alpha?a:255);}
return v;};const strength=dither===true?1:Math.max(0,Math.min(1,+dither||0));if(!strength){for(let i=0,p=0;i<idx.length;i++,p+=4)idx[i]=look(rgba[p],rgba[p+1],rgba[p+2],rgba[p+3]);return idx;}
const W4=(width+2)*4;let cur=new Float32Array(W4),next=new Float32Array(W4);const cl=(v)=>(v<0?0:v>255?255:v);for(let y=0;y<height;y++){const ltr=(y&1)===0;next.fill(0);for(let s=0;s<width;s++){const x=ltr?s:width-1-s;const p=(y*width+x)*4,e=(x+1)*4;const a0=rgba[p+3];const r=cl(rgba[p]+cur[e]),g=cl(rgba[p+1]+cur[e+1]),b=cl(rgba[p+2]+cur[e+2]),a=alpha?cl(a0+cur[e+3]):255;const k=look(r|0,g|0,b|0,a|0);idx[y*width+x]=k;if(alpha&&a0===0)continue;const q=k*4;const er=(r-P[q])*strength,eg=(g-P[q+1])*strength,eb=(b-P[q+2])*strength,ea=alpha?(a-P[q+3])*strength:0;const d=ltr?4:-4;cur[e+d]+=er*0.4375;cur[e+d+1]+=eg*0.4375;cur[e+d+2]+=eb*0.4375;cur[e+d+3]+=ea*0.4375;next[e-d]+=er*0.1875;next[e-d+1]+=eg*0.1875;next[e-d+2]+=eb*0.1875;next[e-d+3]+=ea*0.1875;next[e]+=er*0.3125;next[e+1]+=eg*0.3125;next[e+2]+=eb*0.3125;next[e+3]+=ea*0.3125;next[e+d]+=er*0.0625;next[e+d+1]+=eg*0.0625;next[e+d+2]+=eb*0.0625;next[e+d+3]+=ea*0.0625;}
const t=cur;cur=next;next=t;}
return idx;}
function quantize(rgba,width,height,{colors=256,method='mediancut',dither=0,refine=2}={}){const palette=buildPalette(rgba,{colors,method,refine});const indices=mapToPalette(rgba,width,height,palette,{dither});return{palette,indices,colors:palette.length>>2};}
export{quantize};