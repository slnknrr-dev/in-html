function source(){const c=globalThis.crypto;if(!c||typeof c.getRandomValues!=='function')throw new Error('no secure random source (crypto.getRandomValues)');return c;}
function randomBytes(n){const out=new Uint8Array(n),c=source();for(let o=0;o<n;o+=65536)c.getRandomValues(out.subarray(o,Math.min(n,o+65536)));return out;}
function randomInt(max){if(!(max>=1&&max<=0x100000000))throw new Error('randomInt: max must be 1..2^32');if(max===1)return 0;const limit=0x100000000-(0x100000000%max),buf=new Uint32Array(1),c=source();for(;;){c.getRandomValues(buf);if(buf[0]<limit)return buf[0]%max;}}
function shuffle(list){for(let i=list.length-1;i>0;i--){const j=randomInt(i+1);const t=list[i];list[i]=list[j];list[j]=t;}
return list;}
export{randomBytes,randomInt,shuffle};