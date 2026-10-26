const B85='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~';const Z85='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#';const A85=Array.from({length:85},(_,i)=>String.fromCharCode(33+i)).join('');function encodeGroups(bytes,alphabet,zero,spaces){let out='';for(let i=0;i<bytes.length;i+=4){const k=Math.min(4,bytes.length-i);let n=0;for(let j=0;j<4;j++)n=n*256+(j<k?bytes[i+j]:0);if(k===4&&n===0&&zero){out+=zero;continue;}
if(k===4&&n===0x20202020&&spaces){out+=spaces;continue;}
const g=new Array(5);for(let j=4;j>=0;j--){g[j]=alphabet[n%85];n=Math.floor(n/85);}
out+=g.slice(0,k+1).join('');}
return out;}
function decodeGroups(s,alphabet,zero,spaces){const map=new Map([...alphabet].map((c,i)=>[c,i]));const out=[];let group=[];const flush=(k)=>{while(group.length<5)group.push(84);let n=0;for(const d of group)n=n*85+d;if(n>0xffffffff)throw new Error('group out of range');for(let j=0;j<k;j++)out.push((n>>>(24-8*j))&255);group=[];};for(let i=0;i<s.length;i++){const c=s[i];if(/\s/.test(c))continue;if(zero&&c===zero&&!group.length){out.push(0,0,0,0);continue;}
if(spaces&&c===spaces&&!group.length){out.push(32,32,32,32);continue;}
const d=map.get(c);if(d===undefined)throw new Error(`invalid character "${c}" at ${i+1}`);group.push(d);if(group.length===5)flush(4);}
if(group.length===1)throw new Error('impossible length');if(group.length)flush(group.length-1);return Uint8Array.from(out);}
function base85Encode(bytes,alphabet=B85){return encodeGroups(bytes,alphabet,null,null);}
function base85Decode(text,alphabet=B85){return decodeGroups(String(text),alphabet,null,null);}
function ascii85Encode(bytes,{adobe=false,foldSpaces=false,wrap=0}={}){let body=encodeGroups(bytes,A85,'z',foldSpaces?'y':null);if(wrap>0&&body.length>wrap)body=body.match(new RegExp(`.{1,${wrap}}`,'g')).join('\n');return adobe?`<~${body}~>`:body;}
function ascii85Decode(text,{foldSpaces=true}={}){let s=String(text).trim();if(s.startsWith('<~'))s=s.slice(2);if(s.endsWith('~>'))s=s.slice(0,-2);return decodeGroups(s,A85,'z',foldSpaces?'y':null);}
export{base85Encode,base85Decode,ascii85Encode,ascii85Decode,Z85};