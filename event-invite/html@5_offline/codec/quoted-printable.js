const HEX='0123456789ABCDEF';const esc=(b)=>'='+HEX[b>>4]+HEX[b&15];function qpEncode(bytes,{binary=false,lineLength=76,eol='\r\n'}={}){const lines=[];let cur='';const put=(tok)=>{if(cur.length+tok.length>lineLength-1){lines.push(cur+'=');cur='';}
cur+=tok;};const hard=()=>{lines.push(cur);cur='';};for(let i=0;i<bytes.length;i++){const b=bytes[i];if(!binary&&(b===13||b===10)){if(b===13&&bytes[i+1]===10)i++;hard();continue;}
const atEnd=i===bytes.length-1||(!binary&&(bytes[i+1]===13||bytes[i+1]===10));if((b===32||b===9)&&!atEnd)put(String.fromCharCode(b));else if(b>=33&&b<=126&&b!==61)put(String.fromCharCode(b));else put(esc(b));}
lines.push(cur);return lines.join(eol);}
export{qpEncode};