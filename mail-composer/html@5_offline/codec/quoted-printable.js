const HEX='0123456789ABCDEF';const esc=(b)=>'='+HEX[b>>4]+HEX[b&15];function qpEncode(bytes,{binary=false,lineLength=76,eol='\r\n'}={}){const lines=[];let cur='';const put=(tok)=>{if(cur.length+tok.length>lineLength-1){lines.push(cur+'=');cur='';}
cur+=tok;};const hard=()=>{lines.push(cur);cur='';};for(let i=0;i<bytes.length;i++){const b=bytes[i];if(!binary&&(b===13||b===10)){if(b===13&&bytes[i+1]===10)i++;hard();continue;}
const atEnd=i===bytes.length-1||(!binary&&(bytes[i+1]===13||bytes[i+1]===10));if((b===32||b===9)&&!atEnd)put(String.fromCharCode(b));else if(b>=33&&b<=126&&b!==61)put(String.fromCharCode(b));else put(esc(b));}
lines.push(cur);return lines.join(eol);}
function qpDecode(text){const s=String(text).replace(/\r\n?/g,'\n');const out=[];const lines=s.split('\n');lines.forEach((raw,li)=>{const line=raw.replace(/[ \t]+$/,'');let soft=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='='){if(i===line.length-1){soft=true;break;}
const h=line.slice(i+1,i+3);if(/^[0-9A-Fa-f]{2}$/.test(h)){out.push(parseInt(h,16));i+=2;continue;}
out.push(61);continue;}
const x=c.charCodeAt(0);if(x>255)for(const b of new TextEncoder().encode(c))out.push(b);else out.push(x);}
if(!soft&&li<lines.length-1)out.push(13,10);});return Uint8Array.from(out);}
export{qpEncode,qpDecode};