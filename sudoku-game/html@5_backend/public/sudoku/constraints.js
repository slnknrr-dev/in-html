import{fullMask,lowBit,popcount,bitsOf,minVal,maxVal,isSingle}from"./bits.js";const ENUM_LIMIT=6000;function houseCons(cells,n){const full=fullMask(n);return{kind:'house',cells,level:1,prop(cand,narrow){let once=0,twice=0;for(let i=0;i<cells.length;i++){const m=cand[cells[i]];twice|=once&m;once|=m;}
if(once!==full)return false;const uniq=once&~twice;if(!uniq)return true;for(let i=0;i<cells.length;i++){const c=cells[i],m=cand[c]&uniq;if(!m)continue;if(m&(m-1))return false;if(cand[c]!==m&&!narrow(c,m))return false;}
return true;},};}
const TABLES=new Map();function pairTable(key,n,rel){const k=key+'/'+n;let t=TABLES.get(k);if(!t){const fwd=new Int32Array(n),rev=new Int32Array(n);for(let a=0;a<n;a++)for(let b=0;b<n;b++)if(rel(a+1,b+1,n)){fwd[a]|=1<<b;rev[b]|=1<<a;}
t={fwd,rev};TABLES.set(k,t);}
return t;}
function pairCons(kind,a,b,table,level=1){const{fwd,rev}=table;return{kind,cells:Int32Array.of(a,b),level,prop(cand,narrow){const A=cand[a];const B=cand[b];let na=0;for(let m=A;m;m&=m-1){const v=lowBit(m);if(fwd[v]&B)na|=1<<v;}
if(na!==A&&!narrow(a,na))return false;const A2=cand[a];let nb=0;for(let m=B;m;m&=m-1){const v=lowBit(m);if(rev[v]&A2)nb|=1<<v;}
if(nb!==B&&!narrow(b,nb))return false;return true;},};}
const REL={neq:(x,y)=>x!==y,eq:(x,y)=>x===y,less:(x,y)=>x<y,consec:(x,y)=>Math.abs(x-y)===1,nonconsec:(x,y)=>Math.abs(x-y)!==1,double:(x,y)=>x===2*y||y===2*x,kropkiNone:(x,y)=>Math.abs(x-y)!==1&&x!==2*y&&y!==2*x,sum5:(x,y)=>x+y===5,sum10:(x,y)=>x+y===10,xvNone:(x,y)=>x+y!==5&&x+y!==10,parity:(x,y)=>(x+y)%2===1,whisper:(x,y,n)=>Math.abs(x-y)>=Math.ceil(n/2),dutch:(x,y,n)=>Math.abs(x-y)>=Math.floor(n/2),};const relCons=(kind,rel,a,b,n,level=1)=>pairCons(kind,a,b,pairTable(rel,n,REL[rel]),level);function enumerate(cells,cand,narrow,check,limit=ENUM_LIMIT){const L=cells.length;let product=1;for(let i=0;i<L;i++){product*=popcount(cand[cells[i]]);if(product>limit)return null;}
const vals=new Int32Array(L);const support=new Int32Array(L);const doms=Array.from(cells,(c)=>bitsOf(cand[c]));const rec=(k)=>{const d=doms[k];for(let j=0;j<d.length;j++){vals[k]=d[j]+1;if(!check(vals,k))continue;if(k===L-1){for(let i=0;i<L;i++)support[i]|=1<<(vals[i]-1);}
else rec(k+1);}};rec(0);for(let i=0;i<L;i++){if(!support[i])return false;if(support[i]!==cand[cells[i]]&&!narrow(cells[i],support[i]))return false;}
return true;}
function enumCons(kind,cells,check,level=2){return{kind,cells:Int32Array.from(cells),level,prop(cand,narrow){const r=enumerate(this.cells,cand,narrow,check);return r!==false;},};}
function linearCons(kind,pos,neg,k,level=2){const cells=Int32Array.from([...pos,...neg]);const P=pos.length;const sign=Array.from(cells,(_,i)=>(i<P?1:-1));const check=(vals,at)=>{let s=0;for(let i=0;i<=at;i++)s+=sign[i]*vals[i];if(at===cells.length-1)return s===k;return s+sufMin[at+1]<=k&&s+sufMax[at+1]>=k;};const sufMin=new Float64Array(cells.length+1),sufMax=new Float64Array(cells.length+1);return{kind,cells,level,prop(cand,narrow){for(;;){let lo=0,hi=0;for(let i=0;i<cells.length;i++){const m=cand[cells[i]];if(sign[i]>0){lo+=minVal(m);hi+=maxVal(m);}else{lo-=maxVal(m);hi-=minVal(m);}}
if(lo>k||hi<k)return false;let changed=false;for(let i=0;i<cells.length;i++){const c=cells[i],m=cand[c];const mn=minVal(m),mx=maxVal(m);let a,b;if(sign[i]>0){a=k-(hi-mx);b=k-(lo-mn);}
else{a=(lo+mx)-k;b=(hi+mn)-k;}
if(a<=mn&&b>=mx)continue;const keep=rangeMask(a,b)&m;if(!keep||!narrow(c,keep))return false;changed=true;}
if(!changed)break;}
sufMin[cells.length]=0;sufMax[cells.length]=0;for(let i=cells.length-1;i>=0;i--){const m=cand[cells[i]];if(sign[i]>0){sufMin[i]=sufMin[i+1]+minVal(m);sufMax[i]=sufMax[i+1]+maxVal(m);}
else{sufMin[i]=sufMin[i+1]-maxVal(m);sufMax[i]=sufMax[i+1]-minVal(m);}}
return enumerate(cells,cand,narrow,check)!==false;},};}
function rangeMask(a,b){a=Math.max(1,a);b=Math.min(31,b);if(a>b)return 0;const hi=b>=31?0x7fffffff:(1<<b)-1;return hi&~((1<<(a-1))-1);}
function combosCons(kind,cells,combos,level=2){cells=Int32Array.from(cells);const set=new Set(combos);const L=cells.length;const check=(vals,k)=>{let used=0;for(let i=0;i<=k;i++){const b=1<<(vals[i]-1);if(used&b)return false;used|=b;}
if(k===L-1)return set.has(used);for(const c of liveCombos)if((used&c)===used)return true;return false;};let liveCombos=combos;return{kind,cells,level,combos,prop(cand,narrow){let any=0,fixed=0;for(let i=0;i<L;i++){const m=cand[cells[i]];any|=m;if(isSingle(m)){if(fixed&m)return false;fixed|=m;}}
let union=0,inter=-1;const live=[];for(const C of combos){if((fixed&~C)||(any&C)!==C)continue;let ok=true;for(let i=0;i<L;i++)if(!(cand[cells[i]]&C)){ok=false;break;}
if(!ok)continue;live.push(C);union|=C;inter&=C;}
if(!union)return false;for(let i=0;i<L;i++){const c=cells[i];if((cand[c]&union)!==cand[c]&&!narrow(c,union))return false;}
for(let m=inter;m;m&=m-1){const b=m&-m;let at=-1,cnt=0;for(let i=0;i<L;i++)if(cand[cells[i]]&b){cnt++;at=cells[i];}
if(!cnt)return false;if(cnt===1&&cand[at]!==b&&!narrow(at,b))return false;}
liveCombos=live;return enumerate(cells,cand,narrow,check)!==false;},};}
const COMBO_CACHE=new Map();function sumCombos(n,k,s){const key=`${n}/${k}/${s}`;if(COMBO_CACHE.has(key))return COMBO_CACHE.get(key);const out=[];const rec=(start,left,sum,mask)=>{if(left===0){if(sum===s)out.push(mask);return;}
for(let v=start;v<=n;v++){if(sum+v*left+(left*(left-1))/2>s)break;rec(v+1,left-1,sum+v,mask|(1<<(v-1)));}};rec(1,k,0,0);COMBO_CACHE.set(key,out);return out;}
function runCombos(n,k){const out=[];for(let s=1;s+k-1<=n;s++)out.push(rangeMask(s,s+k-1));return out;}
function sandwichCons(cells,s,n){cells=Int32Array.from(cells);const L=cells.length,ONE=1,TOP=1<<(n-1);return{kind:'sandwich',cells,level:2,prop(cand,narrow){let okOne=0,okTop=0;for(let i=0;i<L;i++){if(!(cand[cells[i]]&ONE))continue;for(let j=0;j<L;j++){if(j===i||!(cand[cells[j]]&TOP))continue;const a=Math.min(i,j),b=Math.max(i,j);let lo=0,hi=0,bad=false;for(let x=a+1;x<b;x++){const m=cand[cells[x]]&~(ONE|TOP);if(!m){bad=true;break;}
lo+=minVal(m);hi+=maxVal(m);}
const len=b-a-1;const dLo=len*(len+3)/2,dHi=len*(2*n-1-len)/2;if(bad||lo>s||hi<s||dLo>s||dHi<s)continue;okOne|=1<<i;okTop|=1<<j;}}
if(!okOne||!okTop)return false;let one=-1,top=-1;for(let i=0;i<L;i++){const c=cells[i];let keep=cand[c];if(!(okOne>>i&1))keep&=~ONE;if(!(okTop>>i&1))keep&=~TOP;if(keep!==cand[c]&&!narrow(c,keep))return false;if(cand[c]===ONE)one=i;if(cand[c]===TOP)top=i;}
if(one>=0&&top>=0){const a=Math.min(one,top),b=Math.max(one,top);const inner=[];for(let x=a+1;x<b;x++)inner.push(cells[x]);if(!inner.length)return s===0;return sumBounds(inner,s,cand,narrow);}
return true;},};}
function sumBounds(cells,s,cand,narrow){for(;;){let lo=0,hi=0;for(const c of cells){lo+=minVal(cand[c]);hi+=maxVal(cand[c]);}
if(lo>s||hi<s)return false;let changed=false;for(const c of cells){const m=cand[c],mn=minVal(m),mx=maxVal(m);const a=s-(hi-mx),b=s-(lo-mn);if(a<=mn&&b>=mx)continue;const keep=rangeMask(a,b)&m;if(!keep||!narrow(c,keep))return false;changed=true;}
if(!changed)return true;}}
function skyscraperCons(cells,count,n){cells=Int32Array.from(cells);const L=cells.length;const caps=Array.from({length:L},(_,d)=>rangeMask(1,Math.min(n,n-count+1+d)));const visible=(vals,k)=>{let mx=0,v=0;for(let i=0;i<=k;i++)if(vals[i]>mx){mx=vals[i];v++;}
return[v,mx];};const check=(vals,k)=>{for(let i=0;i<k;i++)if(vals[i]===vals[k])return false;const[v,mx]=visible(vals,k);if(k===L-1)return v===count;if(v>count)return false;return v+Math.min(L-1-k,n-mx)>=count;};return{kind:'skyscraper',cells,level:2,prop(cand,narrow){for(let d=0;d<L;d++){const c=cells[d];let keep=cand[c]&caps[d];if(count===1&&d===0)keep&=1<<(n-1);if(count===n)keep&=1<<d;if(keep!==cand[c]&&!narrow(c,keep))return false;}
let mx=0,v=0,d=0;for(;d<L&&isSingle(cand[cells[d]]);d++){const x=lowBit(cand[cells[d]])+1;if(x>mx){mx=x;v++;}}
if(v>count)return false;if(d===L||mx===n){if(v!==count)return false;}
else if(v+Math.min(L-d,n-mx)<count)return false;return enumerate(cells,cand,narrow,check,3000)!==false;},};}
function xsumCons(cells,s,n){cells=Int32Array.from(cells);return{kind:'xsum',cells,level:2,prop(cand,narrow){const first=cells[0];let keep=0;for(let m=cand[first];m;m&=m-1){const x=lowBit(m)+1;if(x>cells.length)continue;let lo=x,hi=x;for(let i=1;i<x;i++){const cm=cand[cells[i]]&~(1<<(x-1));if(!cm){lo=Infinity;break;}lo+=minVal(cm);hi+=maxVal(cm);}
if(lo<=s&&hi>=s)keep|=1<<(x-1);}
if(!keep)return false;if(keep!==cand[first]&&!narrow(first,keep))return false;if(isSingle(cand[first])){const x=lowBit(cand[first])+1;if(x===1)return s===1;return sumBounds(Array.from(cells.subarray(1,x)),s-x,cand,narrow);}
return true;},};}
function betweenCons(a,b,inner){const cells=Int32Array.from([a,b,...inner]);return{kind:'between',cells,level:2,prop(cand,narrow){let sa=0,sb=0;const si=new Int32Array(inner.length);for(let ma=cand[a];ma;ma&=ma-1){const x=lowBit(ma)+1;for(let mb=cand[b];mb;mb&=mb-1){const y=lowBit(mb)+1;if(x===y)continue;const mid=rangeMask(Math.min(x,y)+1,Math.max(x,y)-1);let ok=true;for(let i=0;i<inner.length;i++)if(!(cand[inner[i]]&mid)){ok=false;break;}
if(!ok)continue;sa|=1<<(x-1);sb|=1<<(y-1);for(let i=0;i<inner.length;i++)si[i]|=cand[inner[i]]&mid;}}
if(!sa)return false;if(sa!==cand[a]&&!narrow(a,sa))return false;if(sb!==cand[b]&&!narrow(b,sb))return false;for(let i=0;i<inner.length;i++)if(si[i]!==cand[inner[i]]&&!narrow(inner[i],si[i]))return false;return true;},};}
function zipperCons(line){const L=line.length;const mid=L%2?line[(L-1)/2]:-1;const pairs=[];for(let i=0;i<Math.floor(L/2);i++)pairs.push([line[i],line[L-1-i]]);return{kind:'zipper',cells:Int32Array.from(line),level:2,prop(cand,narrow){const sup=pairs.map(()=>[0,0]);let smid=0;const totals=mid>=0?bitsOf(cand[mid]).map((v)=>v+1):Array.from({length:61},(_,i)=>i+2);for(const t of totals){const part=[];let ok=true;for(const[p,q]of pairs){let sp=0,sq=0;for(let m=cand[p];m;m&=m-1){const x=lowBit(m)+1,y=t-x;if(y>=1&&y<=31&&cand[q]&(1<<(y-1))){sp|=1<<(x-1);sq|=1<<(y-1);}}
if(!sp){ok=false;break;}
part.push([sp,sq]);}
if(!ok)continue;if(mid>=0)smid|=1<<(t-1);part.forEach(([sp,sq],i)=>{sup[i][0]|=sp;sup[i][1]|=sq;});}
if(mid>=0){if(!smid)return false;if(smid!==cand[mid]&&!narrow(mid,smid))return false;}
for(let i=0;i<pairs.length;i++){const[p,q]=pairs[i];if(!sup[i][0])return false;if(sup[i][0]!==cand[p]&&!narrow(p,sup[i][0]))return false;if(sup[i][1]!==cand[q]&&!narrow(q,sup[i][1]))return false;}
return true;},};}
function quadCons(cells,digits){cells=Int32Array.from(cells);const need=new Map();for(const d of digits)need.set(d,(need.get(d)||0)+1);const check=(vals,k)=>{if(k<cells.length-1){let missing=0;for(const[d,cnt]of need){let have=0;for(let i=0;i<=k;i++)if(vals[i]===d)have++;missing+=Math.max(0,cnt-have);}
return missing<=cells.length-1-k;}
for(const[d,cnt]of need){let have=0;for(let i=0;i<=k;i++)if(vals[i]===d)have++;if(have<cnt)return false;}
return true;};return{kind:'quad',cells,level:2,prop(cand,narrow){for(const[d,cnt]of need){const b=1<<(d-1);let places=0,at=-1;for(const c of cells)if(cand[c]&b){places++;at=c;}
if(places<cnt)return false;if(places===1&&cand[at]!==b&&!narrow(at,b))return false;}
if(digits.length===cells.length){const m=digits.reduce((a,d)=>a|(1<<(d-1)),0);for(const c of cells)if((cand[c]&m)!==cand[c]&&!narrow(c,m))return false;}
return enumerate(cells,cand,narrow,check,7000)!==false;},};}
export{linearCons,enumCons,combosCons,sumCombos,runCombos,betweenCons,zipperCons,quadCons,sandwichCons,skyscraperCons,xsumCons,relCons,houseCons};