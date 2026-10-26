import"../crypto/encoding.js";function toBigInt(value,what='value'){if(typeof value==='bigint')return value;if(typeof value==='number'){if(!Number.isSafeInteger(value))throw new Error(`${what}: integer expected (use bigint above 2^53)`);return BigInt(value);}
if(typeof value==='string'){const t=value.trim();if(/^0x[0-9a-f]+$/i.test(t))return BigInt(t);if(/^0x$/i.test(t))return 0n;if(/^-?\d+$/.test(t))return BigInt(t);}
throw new Error(`${what}: integer expected, got ${typeof value==='string'?JSON.stringify(value):typeof value}`);}
export{toBigInt};