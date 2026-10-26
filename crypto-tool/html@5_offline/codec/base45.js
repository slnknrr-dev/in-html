const B45='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';function base45Encode(bytes){let out='';for(let i=0;i+1<bytes.length;i+=2){const n=bytes[i]*256+bytes[i+1];out+=B45[n%45]+B45[Math.floor(n/45)%45]+B45[Math.floor(n/2025)];}
if(bytes.length%2){const n=bytes[bytes.length-1];out+=B45[n%45]+B45[Math.floor(n/45)];}
return out;}
function base45Decode(text){const s=String(text);const v=[...s].map((c,i)=>{const d=B45.indexOf(c);if(d<0)throw new Error(`invalid character "${c}" at ${i+1}`);return d;});if(v.length%3===1)throw new Error('impossible length');const out=new Uint8Array(Math.floor(v.length/3)*2+(v.length%3?1:0));let o=0;for(let i=0;i<v.length;i+=3){if(i+2<v.length){const n=v[i]+v[i+1]*45+v[i+2]*2025;if(n>0xffff)throw new Error(`group ${i/3+1} is out of range`);out[o++]=n>>8;out[o++]=n&255;}else{const n=v[i]+v[i+1]*45;if(n>0xff)throw new Error('last group is out of range');out[o++]=n;}}
return out;}
export{base45Encode,base45Decode};