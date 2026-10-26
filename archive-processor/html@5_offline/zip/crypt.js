import{AES}from"../crypto/aes.js";import{hmac}from"../crypto/hmac.js";import{pbkdf2}from"../crypto/kdf.js";import{sha1}from"../crypto/sha1.js";let T=null;function table(){if(T)return T;T=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;T[n]=c;}
return T;}
class ZipCrypto{constructor(password){this.t=table();this.k0=0x12345678;this.k1=0x23456789;this.k2=0x34567890;for(const c of password)this.update(c);}
update(c){const t=this.t;this.k0=(this.k0>>>8)^t[(this.k0^c)&255];this.k1=(Math.imul((this.k1+(this.k0&255))|0,134775813)+1)|0;this.k2=(this.k2>>>8)^t[(this.k2^(this.k1>>>24))&255];}
decrypt(chunk){const out=new Uint8Array(chunk.length);for(let i=0;i<chunk.length;i++){const tmp=(this.k2|2)&0xffff;const p=chunk[i]^((Math.imul(tmp,tmp^1)>>>8)&255);out[i]=p;this.update(p);}
return out;}
header(h){const d=this.decrypt(h);return d[11];}}
const AES_SALT={1:8,2:12,3:16};function aesKeys(password,salt,strength){const n={1:16,2:24,3:32}[strength];if(!n)throw new Error('bad WinZip AES strength '+strength);const dk=pbkdf2(sha1,password,salt,1000,2*n+2);return{key:dk.slice(0,n),macKey:dk.slice(n,2*n),verifier:dk.slice(2*n)};}
class WinZipAes{constructor(key,macKey){this.aes=new AES(key);this.mac=hmac.create(sha1,macKey);this.ctr=new Uint8Array(16);this.ks=new Uint8Array(16);this.used=16;}
decrypt(chunk){this.mac.update(chunk);const out=new Uint8Array(chunk.length);const ctr=this.ctr,ks=this.ks;for(let i=0;i<chunk.length;i++){if(this.used===16){for(let k=0;k<16;k++)if(++ctr[k]!==256)break;else ctr[k]=0;this.aes.encryptBlock(ctr,ks);this.used=0;}
out[i]=chunk[i]^ks[this.used++];}
return out;}
tag(){return this.mac.digest().subarray(0,10);}}
export{AES_SALT,aesKeys,WinZipAes,ZipCrypto};