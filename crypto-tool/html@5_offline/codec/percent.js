const UNRESERVED=/[A-Za-z0-9\-._~]/;const RESERVED=/[:/?#[\]@!$&'()*+,;=]/;const FORM=/[A-Za-z0-9*\-._]/;const HEX='0123456789ABCDEF';function percentEncode(bytes,{mode='component',lower=false}={}){let out='';for(let i=0;i<bytes.length;i++){const b=bytes[i];const c=b<128?String.fromCharCode(b):'';const keep=mode!=='all'&&c&&(mode==='form'?FORM.test(c):UNRESERVED.test(c)||(mode==='uri'&&RESERVED.test(c)));if(keep)out+=c;else if(mode==='form'&&b===32)out+='+';else{const h='%'+HEX[b>>4]+HEX[b&15];out+=lower?h.toLowerCase():h;}}
return out;}
function percentDecode(text,{plus=false}={}){const s=String(text);const out=[];const enc=new TextEncoder();for(let i=0;i<s.length;i++){const c=s[i];if(c==='%'&&/^[0-9A-Fa-f]{2}$/.test(s.slice(i+1,i+3))){out.push(parseInt(s.slice(i+1,i+3),16));i+=2;continue;}
if(c==='+'&&plus){out.push(32);continue;}
const code=s.codePointAt(i);if(code>0xffff)i++;for(const b of enc.encode(String.fromCodePoint(code)))out.push(b);}
return Uint8Array.from(out);}
export{percentEncode,percentDecode};