class Matcher{constructor(data,{window=1<<22,depth=32,nice=64,hashBits=17}={}){this.d=data;this.n=data.length;this.window=Math.min(window,1<<26);this.wmask=(1<<Math.ceil(Math.log2(Math.max(2,Math.min(this.window,this.n||1)))))-1;this.prev=new Int32Array(this.wmask+1);this.hbits=hashBits;this.head=new Int32Array(1<<hashBits).fill(-1);this.depth=depth;this.nice=nice;this.next=0;this.dist=0;}
hash(i){const d=this.d;return(Math.imul((d[i]|(d[i+1]<<8)|(d[i+2]<<16)),0x9e3779b1)>>>(32-this.hbits));}
skipTo(end){const lim=Math.min(end,this.n-2);for(let i=this.next;i<lim;i++){const h=this.hash(i);this.prev[i&this.wmask]=this.head[h];this.head[h]=i;}
if(end>this.next)this.next=end;}
find(i,maxLen,minLen=3){this.skipTo(i);const d=this.d,n=this.n;if(i+3>n)return 0;maxLen=Math.min(maxLen,n-i);if(maxLen<minLen)return 0;const low=Math.max(0,i-Math.min(this.window,this.wmask+1)+1);let j=this.head[this.hash(i)],best=minLen-1,bestDist=0,chain=this.depth;while(j>=low&&j<i&&chain-- >0){if(d[j+best]===d[i+best]&&d[j]===d[i]&&d[j+1]===d[i+1]){let l=0;while(l<maxLen&&d[j+l]===d[i+l])l++;if(l>best){best=l;bestDist=i-j;if(l>=this.nice||l>=maxLen)break;}}
const p=this.prev[j&this.wmask];if(p>=j)break;j=p;}
this.dist=bestDist;return best>=minLen?best:0;}}
function matchLen(d,i,dist,maxLen){const j=i-dist;if(j<0)return 0;maxLen=Math.min(maxLen,d.length-i);let l=0;while(l<maxLen&&d[j+l]===d[i+l])l++;return l;}
export{Matcher,matchLen};