const B91='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~"';const IDX=new Map([...B91].map((c,i)=>[c,i]));function base91Encode(bytes){let out='';let b=0,n=0;for(let i=0;i<bytes.length;i++){b|=bytes[i]<<n;n+=8;if(n>13){let v=b&8191;if(v>88){b>>>=13;n-=13;}else{v=b&16383;b>>>=14;n-=14;}
out+=B91[v%91]+B91[Math.floor(v/91)];}}
if(n){out+=B91[b%91];if(n>7||b>90)out+=B91[Math.floor(b/91)];}
return out;}
function base91Decode(text){const out=[];let v=-1,b=0,n=0;for(const c of String(text)){const d=IDX.get(c);if(d===undefined)continue;if(v<0){v=d;continue;}
v+=d*91;b|=v<<n;n+=(v&8191)>88?13:14;do{out.push(b&255);b>>>=8;n-=8;}while(n>7);v=-1;}
if(v>-1)out.push((b|(v<<n))&255);return Uint8Array.from(out);}
export{base91Encode,base91Decode};