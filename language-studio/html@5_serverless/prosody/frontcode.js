function decodeFront(data,split){const out=new Map();let prev='';for(const e of data.split(',')){if(!e)continue;const k=e.charCodeAt(0)-48;const[tail,payload]=split(e.slice(1));const w=prev.slice(0,k)+tail;out.set(w,payload);prev=w;}
return out;}
export{decodeFront};