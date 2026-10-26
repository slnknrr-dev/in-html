const FIRST=0x1f3f7;function base100Encode(bytes){let out='';for(let i=0;i<bytes.length;i++)out+=String.fromCodePoint(FIRST+bytes[i]);return out;}
function base100Decode(text){const out=[];let i=0;for(const ch of String(text)){i++;if(/\s/.test(ch))continue;const b=ch.codePointAt(0)-FIRST;if(!(b>=0&&b<=255))throw new Error(`"${ch}" is not a Base100 symbol (at ${i})`);out.push(b);}
return Uint8Array.from(out);}
export{base100Encode,base100Decode};