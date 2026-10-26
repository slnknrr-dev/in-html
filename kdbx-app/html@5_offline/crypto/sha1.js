import{MDHasher,wordsBE,hasher}from"./hasher.js";class SHA1 extends MDHasher{constructor(){super(64,20,8,false);this.state=new Int32Array([0x67452301,0xefcdab89,0x98badcfe,0x10325476,0xc3d2e1f0]);this.w=new Int32Array(80);}
process(b,o){const w=this.w,st=this.state;for(let i=0;i<16;i++,o+=4)w[i]=(b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3];for(let i=16;i<80;i++){const x=w[i-3]^w[i-8]^w[i-14]^w[i-16];w[i]=(x<<1)|(x>>>31);}
let a=st[0],bb=st[1],c=st[2],d=st[3],e=st[4];for(let i=0;i<80;i++){let f,k;if(i<20){f=(bb&c)|(~bb&d);k=0x5a827999;}
else if(i<40){f=bb^c^d;k=0x6ed9eba1;}
else if(i<60){f=(bb&c)|(bb&d)|(c&d);k=0x8f1bbcdc;}
else{f=bb^c^d;k=0xca62c1d6;}
const t=(((a<<5)|(a>>>27))+f+e+k+w[i])|0;e=d;d=c;c=(bb<<30)|(bb>>>2);bb=a;a=t;}
st[0]=(st[0]+a)|0;st[1]=(st[1]+bb)|0;st[2]=(st[2]+c)|0;st[3]=(st[3]+d)|0;st[4]=(st[4]+e)|0;}
output(){return wordsBE(this.state,20);}}
const sha1=hasher('sha1',()=>new SHA1(),64,20);export{sha1};