const ANSI16=Object.freeze([[0,0,0],[205,0,0],[0,205,0],[205,205,0],[0,0,238],[205,0,205],[0,205,205],[229,229,229],[127,127,127],[255,0,0],[0,255,0],[255,255,0],[92,92,255],[255,0,255],[0,255,255],[255,255,255],]);const CUBE_LEVELS=Object.freeze([0,95,135,175,215,255]);function colorDistance(r1,g1,b1,r2,g2,b2){const rm=(r1+r2)/2,dr=r1-r2,dg=g1-g2,db=b1-b2;return((512+rm)*dr*dr)/256+4*dg*dg+((767-rm)*db*db)/256;}
function nearest16(r,g,b){let best=0,bd=Infinity;for(let i=0;i<16;i++){const p=ANSI16[i];const d=colorDistance(r,g,b,p[0],p[1],p[2]);if(d<bd){bd=d;best=i;}}
return best;}
const cubeIndex=(v)=>(v<48?0:v<115?1:Math.min(5,((v-35)/40)|0));function nearest256(r,g,b){const ri=cubeIndex(r),gi=cubeIndex(g),bi=cubeIndex(b);const dc=colorDistance(r,g,b,CUBE_LEVELS[ri],CUBE_LEVELS[gi],CUBE_LEVELS[bi]);const gIdx=Math.max(0,Math.min(23,Math.round(((r+g+b)/3-8)/10)));const gv=8+10*gIdx;return colorDistance(r,g,b,gv,gv,gv)<dc?232+gIdx:16+36*ri+6*gi+bi;}
function ansi256RGB(i){if(i<16)return ANSI16[i].slice();if(i>=232){const v=8+10*(i-232);return[v,v,v];}
const k=i-16;return[CUBE_LEVELS[(k/36)|0],CUBE_LEVELS[((k/6)|0)%6],CUBE_LEVELS[k%6]];}
const PAL256=(()=>{const t=new Uint8Array(768);for(let i=0;i<256;i++)t.set(ansi256RGB(i),i*3);return t;})();function hex(r,g,b){const s=((1<<24)|(r<<16)|(g<<8)|b).toString(16).slice(1);return s[0]===s[1]&&s[2]===s[3]&&s[4]===s[5]?'#'+s[0]+s[2]+s[4]:'#'+s;}
function parseHex(s){const m=/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(s||'').trim());if(!m)return null;const x=m[1].length===3?m[1].replace(/./g,'$&$&'):m[1];return[parseInt(x.slice(0,2),16),parseInt(x.slice(2,4),16),parseInt(x.slice(4,6),16)];}
const luma=(r,g,b)=>(0.2126*r+0.7152*g+0.0722*b)/255;function quantizeColors(rgb,mode){const n=rgb.length/3;if(mode==='ansi16'||mode==='ansi256'){const idx=new Uint8Array(n);const cache=new Map();for(let i=0,p=0;i<n;i++,p+=3){const key=(rgb[p]<<16)|(rgb[p+1]<<8)|rgb[p+2];let k=cache.get(key);if(k===undefined){k=mode==='ansi16'?nearest16(rgb[p],rgb[p+1],rgb[p+2]):nearest256(rgb[p],rgb[p+1],rgb[p+2]);cache.set(key,k);}
idx[i]=k;rgb[p]=PAL256[k*3];rgb[p+1]=PAL256[k*3+1];rgb[p+2]=PAL256[k*3+2];}
return idx;}
if(mode==='html')for(let p=0;p<rgb.length;p++)rgb[p]=Math.round(rgb[p]/17)*17;return null;}
export{quantizeColors,parseHex,luma,hex,nearest16,nearest256};