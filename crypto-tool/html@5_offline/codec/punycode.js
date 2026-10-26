const BASE=36,TMIN=1,TMAX=26,SKEW=38,DAMP=700,INITIAL_BIAS=72,INITIAL_N=128;function adapt(delta,numPoints,first){delta=first?Math.floor(delta/DAMP):delta>>1;delta+=Math.floor(delta/numPoints);let k=0;while(delta>((BASE-TMIN)*TMAX)>>1){delta=Math.floor(delta/(BASE-TMIN));k+=BASE;}
return k+Math.floor(((BASE-TMIN+1)*delta)/(delta+SKEW));}
const digit=(d)=>String.fromCharCode(d<26?97+d:22+d);function value(c){const x=c.charCodeAt(0);if(x>=48&&x<=57)return x-22;if(x>=65&&x<=90)return x-65;if(x>=97&&x<=122)return x-97;throw new Error(`invalid Punycode character "${c}"`);}
function punycodeEncode(input){const cps=Array.from(String(input),(c)=>c.codePointAt(0));let out=cps.filter((c)=>c<128).map((c)=>String.fromCharCode(c)).join('');const b=out.length;let h=b;if(b>0)out+='-';let n=INITIAL_N,delta=0,bias=INITIAL_BIAS;while(h<cps.length){let m=Infinity;for(const c of cps)if(c>=n&&c<m)m=c;if((m-n)*(h+1)>Number.MAX_SAFE_INTEGER-delta)throw new Error('overflow');delta+=(m-n)*(h+1);n=m;for(const c of cps){if(c<n)delta++;if(c===n){let q=delta;for(let k=BASE;;k+=BASE){const t=k<=bias?TMIN:k>=bias+TMAX?TMAX:k-bias;if(q<t)break;out+=digit(t+((q-t)%(BASE-t)));q=Math.floor((q-t)/(BASE-t));}
out+=digit(q);bias=adapt(delta,h+1,h===b);delta=0;h++;}}
delta++;n++;}
return out;}
function punycodeDecode(input){const s=String(input);const out=[];let basic=s.lastIndexOf('-');if(basic<0)basic=0;for(let j=0;j<basic;j++){if(s.charCodeAt(j)>=128)throw new Error('non-ASCII character in the basic part');out.push(s.charCodeAt(j));}
let n=INITIAL_N,i=0,bias=INITIAL_BIAS;for(let p=basic>0?basic+1:0;p<s.length;){const oldi=i;for(let w=1,k=BASE;;k+=BASE){if(p>=s.length)throw new Error('truncated input');const d=value(s[p++]);i+=d*w;const t=k<=bias?TMIN:k>=bias+TMAX?TMAX:k-bias;if(d<t)break;w*=BASE-t;if(!Number.isSafeInteger(i)||!Number.isSafeInteger(w))throw new Error('overflow');}
bias=adapt(i-oldi,out.length+1,oldi===0);n+=Math.floor(i/(out.length+1));i%=out.length+1;if(n>0x10ffff)throw new Error('code point out of range');out.splice(i++,0,n);}
return String.fromCodePoint(...out);}
const SEP=/[.。．｡]/;function domainToASCII(domain){return String(domain).split(SEP).map((label)=>{if(/^[\x00-\x7f]*$/.test(label))return label;return'xn--'+punycodeEncode(label.normalize('NFC').toLowerCase());}).join('.');}
function domainToUnicode(domain){return String(domain).split(SEP).map((label)=>(/^xn--/i.test(label)?punycodeDecode(label.slice(4).toLowerCase()):label)).join('.');}
export{domainToASCII,punycodeEncode,domainToUnicode,punycodeDecode};