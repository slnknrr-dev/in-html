function b64encode(bytes){const u=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);const CH=0x6000;const parts=[];for(let i=0;i<u.length;i+=CH){const sub=u.subarray(i,i+CH);let bin='';for(let j=0;j<sub.length;j+=0x2000)bin+=String.fromCharCode.apply(null,sub.subarray(j,j+0x2000));parts.push(btoa(bin));}
return parts.join('');}
function b64decode(str){const s=String(str||'').replace(/[\s]/g,'').replace(/-/g,'+').replace(/_/g,'/').replace(/=+$/,'');const out=new Uint8Array(Math.floor((s.length*3)/4));const CH=0x8000;let o=0;for(let i=0;i<s.length;i+=CH){let part=s.slice(i,i+CH);if(part.length%4)part+='==='.slice(0,4-(part.length%4));const bin=atob(part);for(let j=0;j<bin.length;j++)out[o++]=bin.charCodeAt(j);}
return o===out.length?out:out.subarray(0,o);}
export{b64decode,b64encode};