const chr=(v)=>String.fromCharCode(v===0?33:v<=61?34+v:35+v);function ord(c,i){const x=c.charCodeAt(0);if(x===33)return 0;if(x>=35&&x<=95)return x-34;if(x>=97&&x<=125)return x-35;throw new Error(`invalid character "${c}" at ${i+1}`);}
function base92Encode(bytes){if(!bytes.length)return'~';let out='';let acc=0,n=0;for(let i=0;i<bytes.length;i++){acc=((acc<<8)|bytes[i])&0x1fffff;n+=8;if(n>=13){n-=13;const v=(acc>>>n)&8191;out+=chr(Math.floor(v/91))+chr(v%91);}}
if(n>0){if(n<7)out+=chr((acc<<(6-n))&63);else{const v=(acc<<(13-n))&8191;out+=chr(Math.floor(v/91))+chr(v%91);}}
return out;}
function base92Decode(text){const s=String(text).replace(/\s+/g,'');if(s==='~'||s==='')return new Uint8Array(0);const out=[];let acc=0,n=0;const pairs=Math.floor(s.length/2);for(let i=0;i<pairs;i++){const v=ord(s[2*i],2*i)*91+ord(s[2*i+1],2*i+1);if(v>8191)throw new Error(`pair ${i+1} is out of range`);acc=((acc<<13)|v)>>>0;n+=13;while(n>=8){n-=8;out.push((acc>>>n)&255);acc&=(1<<n)-1;}}
if(s.length%2){const v=ord(s[s.length-1],s.length-1);if(v>63)throw new Error('last character is out of range');acc=(acc<<6)|v;n+=6;while(n>=8){n-=8;out.push((acc>>>n)&255);acc&=(1<<n)-1;}}
return Uint8Array.from(out);}
export{base92Encode,base92Decode};