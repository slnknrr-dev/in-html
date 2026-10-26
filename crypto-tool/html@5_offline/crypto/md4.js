import{MDHasher,wordsLE,hasher}from"./hasher.js";const R2=[0,4,8,12,1,5,9,13,2,6,10,14,3,7,11,15];const R3=[0,8,4,12,2,10,6,14,1,9,5,13,3,11,7,15];const S1=[3,7,11,19],S2=[3,5,9,13],S3=[3,9,11,15];const rotl=(x,n)=>(x<<n)|(x>>>(32-n));class MD4 extends MDHasher{constructor(){super(64,16,8,true);this.state=new Int32Array([0x67452301,0xefcdab89,0x98badcfe,0x10325476]);this.w=new Int32Array(16);}
process(b,o){const w=this.w,st=this.state;for(let i=0;i<16;i++,o+=4)w[i]=b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24);let a=st[0],bb=st[1],c=st[2],d=st[3],t;for(let i=0;i<16;i++){t=rotl((a+((bb&c)|(~bb&d))+w[i])|0,S1[i&3]);a=d;d=c;c=bb;bb=t;}
for(let i=0;i<16;i++){t=rotl((a+((bb&c)|(bb&d)|(c&d))+w[R2[i]]+0x5a827999)|0,S2[i&3]);a=d;d=c;c=bb;bb=t;}
for(let i=0;i<16;i++){t=rotl((a+(bb^c^d)+w[R3[i]]+0x6ed9eba1)|0,S3[i&3]);a=d;d=c;c=bb;bb=t;}
st[0]=(st[0]+a)|0;st[1]=(st[1]+bb)|0;st[2]=(st[2]+c)|0;st[3]=(st[3]+d)|0;}
output(){return wordsLE(this.state,16);}}
const md4=hasher('md4',()=>new MD4(),64,16);export{md4};