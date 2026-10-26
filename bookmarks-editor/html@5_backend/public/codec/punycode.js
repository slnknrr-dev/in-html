const BASE=36,TMIN=1,TMAX=26,SKEW=38,DAMP=700,INITIAL_BIAS=72,INITIAL_N=128;function adapt(delta,numPoints,first){delta=first?Math.floor(delta/DAMP):delta>>1;delta+=Math.floor(delta/numPoints);let k=0;while(delta>((BASE-TMIN)*TMAX)>>1){delta=Math.floor(delta/(BASE-TMIN));k+=BASE;}
return k+Math.floor(((BASE-TMIN+1)*delta)/(delta+SKEW));}
function value(c){const x=c.charCodeAt(0);if(x>=48&&x<=57)return x-22;if(x>=65&&x<=90)return x-65;if(x>=97&&x<=122)return x-97;throw new Error(`invalid Punycode character "${c}"`);}
function punycodeDecode(input){const s=String(input);const out=[];let basic=s.lastIndexOf('-');if(basic<0)basic=0;for(let j=0;j<basic;j++){if(s.charCodeAt(j)>=128)throw new Error('non-ASCII character in the basic part');out.push(s.charCodeAt(j));}
let n=INITIAL_N,i=0,bias=INITIAL_BIAS;for(let p=basic>0?basic+1:0;p<s.length;){const oldi=i;for(let w=1,k=BASE;;k+=BASE){if(p>=s.length)throw new Error('truncated input');const d=value(s[p++]);i+=d*w;const t=k<=bias?TMIN:k>=bias+TMAX?TMAX:k-bias;if(d<t)break;w*=BASE-t;if(!Number.isSafeInteger(i)||!Number.isSafeInteger(w))throw new Error('overflow');}
bias=adapt(i-oldi,out.length+1,oldi===0);n+=Math.floor(i/(out.length+1));i%=out.length+1;if(n>0x10ffff)throw new Error('code point out of range');out.splice(i++,0,n);}
return String.fromCodePoint(...out);}
const SEP=/[.。．｡]/;function domainToUnicode(domain){return String(domain).split(SEP).map((label)=>(/^xn--/i.test(label)?punycodeDecode(label.slice(4).toLowerCase()):label)).join('.');}
export{domainToUnicode};