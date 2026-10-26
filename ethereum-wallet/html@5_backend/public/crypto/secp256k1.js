import{bytesToHex,hexToBytes,toBytes,concatBytes}from"./encoding.js";import{hmac}from"./hmac.js";import"./random.js";import{sha256}from"./sha2.js";const P=0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;const N=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;const GX=0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;const GY=0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;const HALF_N=N>>1n;const CURVE=Object.freeze({p:P,n:N,Gx:GX,Gy:GY,a:0n,b:7n,h:1n});function mod(a,m=P){const r=a%m;return r<0n?r+m:r;}
function pow(b,e,m=P){let r=1n;b=mod(b,m);while(e>0n){if(e&1n)r=(r*b)%m;b=(b*b)%m;e>>=1n;}
return r;}
function invert(a,m=P){let x=mod(a,m);if(x===0n)throw new Error('inverse of zero');let b=m,u=1n,s=0n;while(x!==0n){const q=b/x;[b,x]=[x,b-q*x];[s,u]=[u,s-q*u];}
if(b!==1n)throw new Error('no inverse');return mod(s,m);}
function sqrt(a){const r=pow(a,(P+1n)>>2n);return(r*r)%P===mod(a)?r:null;}
const bytesToNumber=(b)=>(b.length?BigInt('0x'+bytesToHex(b)):0n);function numberToBytes(n,len=32){if(n<0n)throw new Error('negative number');const hex=n.toString(16).padStart(len*2,'0');if(hex.length>len*2)throw new Error('number too large');return hexToBytes(hex);}
function bytes32(v,what='value'){if(typeof v==='bigint')return numberToBytes(v,32);const b=typeof v==='string'?hexToBytes(v):toBytes(v);if(b.length!==32)throw new Error(`${what}: 32 bytes expected`);return b;}
function privNum(priv){const d=typeof priv==='bigint'?priv:bytesToNumber(bytes32(priv,'private key'));if(d<=0n||d>=N)throw new Error('invalid private key');return d;}
const INF=[0n,1n,0n];const M=(a)=>{const r=a%P;return r<0n?r+P:r;};function jdouble(p){const[X1,Y1,Z1]=p;if(Z1===0n||Y1===0n)return INF;const A=M(X1*X1),B=M(Y1*Y1),C=M(B*B);const t=X1+B;const D=M(2n*(t*t-A-C));const E=3n*A,F=M(E*E);const X3=M(F-2n*D);return[X3,M(E*(D-X3)-8n*C),M(2n*Y1*Z1)];}
function jadd(p,q){const[X1,Y1,Z1]=p,[X2,Y2,Z2]=q;if(Z1===0n)return q;if(Z2===0n)return p;const Z1Z1=M(Z1*Z1),Z2Z2=M(Z2*Z2);const U1=M(X1*Z2Z2),U2=M(X2*Z1Z1);const S1=M(Y1*Z2*Z2Z2),S2=M(Y2*Z1*Z1Z1);const H=M(U2-U1),r=M(S2-S1);if(H===0n)return r===0n?jdouble(p):INF;const HH=M(H*H),HHH=M(H*HH),V=M(U1*HH);const X3=M(r*r-HHH-2n*V);return[X3,M(r*(V-X3)-S1*HHH),M(Z1*Z2*H)];}
function jaddAffine(p,x2,y2){const[X1,Y1,Z1]=p;if(Z1===0n)return[x2,y2,1n];const Z1Z1=M(Z1*Z1);const U2=M(x2*Z1Z1),S2=M(y2*Z1*Z1Z1);const H=M(U2-X1),r=M(S2-Y1);if(H===0n)return r===0n?jdouble(p):INF;const HH=M(H*H),HHH=M(H*HH),V=M(X1*HH);const X3=M(r*r-HHH-2n*V);return[X3,M(r*(V-X3)-Y1*HHH),M(Z1*H)];}
const jneg=([X,Y,Z])=>[X,M(-Y),Z];function toAffine(p){const[X,Y,Z]=p;if(Z===0n)return null;if(Z===1n)return[X,Y];const zi=invert(Z),zi2=M(zi*zi);return[M(X*zi2),M(Y*zi2*zi)];}
function batchAffine(points){const acc=new Array(points.length);let prod=1n;for(let i=0;i<points.length;i++){acc[i]=prod;prod=M(prod*points[i][2]);}
let inv=invert(prod);const out=new Array(points.length);for(let i=points.length-1;i>=0;i--){const[X,Y,Z]=points[i];const zi=M(inv*acc[i]);inv=M(inv*Z);const zi2=M(zi*zi);out[i]=[M(X*zi2),M(Y*zi2*zi)];}
return out;}
let TABLE=null;function baseTable(){if(TABLE)return TABLE;const all=[];let base=[GX,GY,1n];for(let w=0;w<64;w++){let acc=base;for(let d=1;d<=15;d++){all.push(acc);acc=jadd(acc,base);}
base=acc;}
const aff=batchAffine(all);TABLE=[];for(let w=0;w<64;w++)TABLE.push(aff.slice(w*15,w*15+15));return TABLE;}
function mulBase(k){const T=baseTable();let R=INF,dummy=INF;for(let w=0;w<64;w++){const d=Number((k>>BigInt(4*w))&15n);if(d){const[x,y]=T[w][d-1];R=jaddAffine(R,x,y);}else{const[x,y]=T[w][w&7];dummy=jaddAffine(dummy,x,y);}}
return R;}
function mulPoint(p,k){if(k===0n||p[2]===0n)return INF;const tbl=[p];for(let i=1;i<15;i++)tbl.push(jadd(tbl[i-1],p));let R=INF;for(let i=252;i>=0;i-=4){R=jdouble(jdouble(jdouble(jdouble(R))));const d=Number((k>>BigInt(i))&15n);if(d)R=jadd(R,tbl[d-1]);}
return R;}
const onCurve=(x,y)=>M(y*y-x*x*x-7n)===0n;class Point{constructor(x,y){this.x=x;this.y=y;Object.freeze(this);}
static fromJacobian(j){const a=toAffine(j);return a?new Point(a[0],a[1]):Point.ZERO;}
static fromBytes(bytes){const b=typeof bytes==='string'?hexToBytes(bytes):toBytes(bytes);if(b.length===33&&(b[0]===2||b[0]===3)){const x=bytesToNumber(b.subarray(1));const p=liftXNum(x);if(!p)throw new Error('invalid public key: x is not on the curve');return(p.y&1n)===BigInt(b[0]&1)?p:new Point(p.x,P-p.y);}
if(b.length===65&&b[0]===4){const x=bytesToNumber(b.subarray(1,33)),y=bytesToNumber(b.subarray(33));if(x>=P||y>=P||!onCurve(x,y))throw new Error('invalid public key: not on the curve');return new Point(x,y);}
throw new Error('invalid public key encoding');}
static fromPrivateKey(priv){return Point.fromJacobian(mulBase(privNum(priv)));}
get isZero(){return this.x===null;}
jacobian(){return this.x===null?INF:[this.x,this.y,1n];}
toBytes(compressed=true){if(this.x===null)throw new Error('the point at infinity has no encoding');const x=numberToBytes(this.x);if(compressed)return concatBytes(Uint8Array.of(this.y&1n?3:2),x);return concatBytes(Uint8Array.of(4),x,numberToBytes(this.y));}
toHex(compressed=true){return bytesToHex(this.toBytes(compressed));}
hasEvenY(){return(this.y&1n)===0n;}
equals(o){return this.x===o.x&&this.y===o.y;}
negate(){return this.x===null?this:new Point(this.x,mod(-this.y));}
add(o){return Point.fromJacobian(jadd(this.jacobian(),o.jacobian()));}
subtract(o){return this.add(o.negate());}
double(){return Point.fromJacobian(jdouble(this.jacobian()));}
multiply(k){const s=mod(typeof k==='bigint'?k:bytesToNumber(toBytes(k)),N);if(this.x===GX&&this.y===GY)return Point.fromJacobian(mulBase(s));return Point.fromJacobian(mulPoint(this.jacobian(),s));}}
Point.BASE=new Point(GX,GY);Point.ZERO=new Point(null,null);function liftXNum(x){if(x<=0n||x>=P)return null;const y=sqrt(M(x*x*x+7n));if(y===null)return null;return new Point(x,y&1n?P-y:y);}
function isValidPrivateKey(priv){try{privNum(priv);return true;}catch{return false;}}
const getPublicKey=(priv,compressed=true)=>Point.fromPrivateKey(priv).toBytes(compressed);function isValidPublicKey(pub){try{Point.fromBytes(pub);return true;}catch{return false;}}
const convertPublicKey=(pub,compressed=true)=>Point.fromBytes(pub).toBytes(compressed);function privateAdd(priv,tweak){const t=bytesToNumber(bytes32(tweak,'tweak'));if(t>=N)throw new Error('tweak out of range');const r=mod(privNum(priv)+t,N);if(r===0n)throw new Error('tweaked private key is zero');return numberToBytes(r);}
function publicAdd(pub,tweak,compressed=true){const t=bytesToNumber(bytes32(tweak,'tweak'));if(t>=N)throw new Error('tweak out of range');const r=Point.fromJacobian(jadd(Point.fromBytes(pub).jacobian(),mulBase(t)));if(r.isZero)throw new Error('tweaked public key is infinity');return r.toBytes(compressed);}
class Signature{constructor(r,s,recovery){this.r=r;this.s=s;this.recovery=recovery;}
static fromCompact(bytes){const b=typeof bytes==='string'?hexToBytes(bytes):toBytes(bytes);if(b.length!==64)throw new Error('compact signature: 64 bytes expected');return new Signature(bytesToNumber(b.subarray(0,32)),bytesToNumber(b.subarray(32)));}
static fromDER(bytes,{strict=true}={}){const b=typeof bytes==='string'?hexToBytes(bytes):toBytes(bytes);const fail=(why)=>{throw new Error('invalid DER signature: '+why);};if(b.length<8||b.length>72)fail('length');if(b[0]!==0x30)fail('no sequence');if(b[1]!==b.length-2)fail('sequence length');let o=2;const int=()=>{if(b[o]!==0x02)fail('no integer');const len=b[o+1];if(!len||o+2+len>b.length)fail('integer length');const v=b.subarray(o+2,o+2+len);if(strict){if(v[0]&0x80)fail('negative integer');if(len>1&&v[0]===0&&!(v[1]&0x80))fail('integer padding');}
o+=2+len;return bytesToNumber(v);};const r=int(),s=int();if(o!==b.length)fail('trailing bytes');return new Signature(r,s);}
toCompact(){return concatBytes(numberToBytes(this.r),numberToBytes(this.s));}
toDER(){const int=(n)=>{let v=numberToBytes(n);let i=0;while(i<31&&v[i]===0)i++;v=v.subarray(i);if(v[0]&0x80)v=concatBytes(Uint8Array.of(0),v);return concatBytes(Uint8Array.of(2,v.length),v);};const body=concatBytes(int(this.r),int(this.s));return concatBytes(Uint8Array.of(0x30,body.length),body);}
hasHighS(){return this.s>HALF_N;}
normalizeS(){if(!this.hasHighS())return this;return new Signature(this.r,N-this.s,this.recovery===undefined?undefined:this.recovery^1);}
recoverPublicKey(hash,compressed=true){return ecdsaRecover(this,this.recovery,hash,compressed);}}
const hashNum=(hash)=>bytesToNumber(bytes32(hash,'message hash'));function*rfc6979(hash,priv,extraEntropy=null){const x=numberToBytes(privNum(priv));const h=numberToBytes(mod(hashNum(hash),N));const extra=extraEntropy?toBytes(extraEntropy):new Uint8Array(0);let V=new Uint8Array(32).fill(1),K=new Uint8Array(32);K=hmac(sha256,K,concatBytes(V,Uint8Array.of(0),x,h,extra));V=hmac(sha256,K,V);K=hmac(sha256,K,concatBytes(V,Uint8Array.of(1),x,h,extra));V=hmac(sha256,K,V);for(;;){V=hmac(sha256,K,V);const k=bytesToNumber(V);if(k>=1n&&k<N)yield k;K=hmac(sha256,K,concatBytes(V,Uint8Array.of(0)));V=hmac(sha256,K,V);}}
function ecdsaSign(hash,priv,{lowS=true,extraEntropy=null,lowR=false}={}){if(lowR){let sig=ecdsaSign(hash,priv,{lowS,extraEntropy});for(let counter=1;sig.r>>255n;counter++){const e=new Uint8Array(32);e[0]=counter&0xff;e[1]=(counter>>>8)&0xff;e[2]=(counter>>>16)&0xff;e[3]=counter>>>24;sig=ecdsaSign(hash,priv,{lowS,extraEntropy:e});}
return sig;}
const d=privNum(priv);const z=mod(hashNum(hash),N);for(const k of rfc6979(hash,d,extraEntropy)){const R=toAffine(mulBase(k));const r=mod(R[0],N);if(r===0n)continue;const s=mod(invert(k,N)*(z+r*d),N);if(s===0n)continue;const sig=new Signature(r,s,(R[1]&1n?1:0)|(R[0]>=N?2:0));return lowS?sig.normalizeS():sig;}
throw new Error('unreachable');}
const asSignature=(sig)=>(sig instanceof Signature?sig:Signature.fromCompact(sig));function ecdsaRecover(sig,recovery,hash,compressed=true){const{r,s}=asSignature(sig);if(!(recovery>=0&&recovery<=3))throw new Error('recovery id must be 0..3');if(r<=0n||r>=N||s<=0n||s>=N)throw new Error('invalid signature');const x=recovery&2?r+N:r;const R0=liftXNum(x);if(!R0)throw new Error('invalid signature: R is not on the curve');const R=(R0.y&1n)===BigInt(recovery&1)?R0:R0.negate();const ri=invert(r,N);const z=mod(hashNum(hash),N);const Q=Point.fromJacobian(jadd(mulPoint(R.jacobian(),mod(s*ri,N)),jneg(mulBase(mod(z*ri,N)))));if(Q.isZero)throw new Error('invalid signature: recovered infinity');return Q.toBytes(compressed);}
export{isValidPrivateKey,isValidPublicKey,bytesToNumber,CURVE,getPublicKey,privateAdd,publicAdd,convertPublicKey,ecdsaSign,numberToBytes,ecdsaRecover};