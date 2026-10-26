let TABLE=null;function table(){if(TABLE)return TABLE;TABLE=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;TABLE[n]=c>>>0;}
return TABLE;}
function crc32(bytes,start=0,end=bytes.length,prev=0){const T=table();let c=(prev^0xffffffff)>>>0;for(let i=start;i<end;i++)c=T[(c^bytes[i])&0xff]^(c>>>8);return(c^0xffffffff)>>>0;}
function adler32(bytes,start=0,end=bytes.length,prev=1){let a=prev&0xffff,b=(prev>>>16)&0xffff;for(let i=start;i<end;){const stop=Math.min(end,i+3800);for(;i<stop;i++){a+=bytes[i];b+=a;}
a%=65521;b%=65521;}
return((b<<16)|a)>>>0;}
export{crc32,adler32};