let TABLE=null;function table(){if(TABLE)return TABLE;TABLE=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;TABLE[n]=c>>>0;}
return TABLE;}
function crc32(bytes,start=0,end=bytes.length,prev=0){const T=table();let c=(prev^0xffffffff)>>>0;for(let i=start;i<end;i++)c=T[(c^bytes[i])&0xff]^(c>>>8);return(c^0xffffffff)>>>0;}
export{crc32};