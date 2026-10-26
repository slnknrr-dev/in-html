function tplLatin1(str){const b=new Uint8Array(str.length);for(let i=0;i<str.length;i++)b[i]=str.charCodeAt(i)&255;return b;}
function tplHash(str){let h=0x811c9dc5;for(const ch of String(str)){h^=ch.codePointAt(0);h=Math.imul(h,0x01000193)>>>0;}
return h>>>0;}
function tplRand(seed){let a=seed>>>0;return()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function tplHslToRgb(h,s,l){h=(((h%360)+360)%360)/360;s/=100;l/=100;if(s===0){const v=Math.round(l*255);return[v,v,v];}
const q=l<0.5?l*(1+s):l+s-l*s;const p=2*l-q;const f=(t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};return[Math.round(f(h+1/3)*255),Math.round(f(h)*255),Math.round(f(h-1/3)*255)];}
export{tplLatin1,tplRand,tplHash,tplHslToRgb};