function source(){const c=globalThis.crypto;if(!c||typeof c.getRandomValues!=='function')throw new Error('no secure random source (crypto.getRandomValues)');return c;}
function randomBytes(n){const out=new Uint8Array(n),c=source();for(let o=0;o<n;o+=65536)c.getRandomValues(out.subarray(o,Math.min(n,o+65536)));return out;}
export{randomBytes};