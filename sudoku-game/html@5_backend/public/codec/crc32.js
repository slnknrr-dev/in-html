function adler32(bytes,start=0,end=bytes.length,prev=1){let a=prev&0xffff,b=(prev>>>16)&0xffff;for(let i=start;i<end;){const stop=Math.min(end,i+3800);for(;i<stop;i++){a+=bytes[i];b+=a;}
a%=65521;b%=65521;}
return((b<<16)|a)>>>0;}
export{adler32};