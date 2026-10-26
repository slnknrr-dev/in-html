import{decodeICO,encodeICO}from"./ico/ico.js";import{decodePNG}from"./png/decode.js";import{encodePNG}from"./png/encode.js";import{resize}from"./raster/resample.js";import{blank,copyImage}from"./paint.js";const SIZES=[32,48,64,128,256];const MASTER=256;const HISTORY_MAX=80;function createDoc(name='icon'){const doc={name,master:blank(MASTER),sizes:{},sel:{},undo:[],redo:[],rev:0};for(const n of SIZES)doc.sizes[n]={on:true,custom:false,img:blank(n)};return doc;}
const imageOf=(doc,n)=>(n===MASTER?doc.master:doc.sizes[n].img);const enabledSizes=(doc)=>SIZES.filter((n)=>doc.sizes[n].on);function scaleTo(img,n){if(img.width===n&&img.height===n)return copyImage(img);if(n>img.width&&n%img.width===0&&img.width===img.height){const k=n/img.width,out=blank(n);for(let y=0;y<n;y++)for(let x=0;x<n;x++)out.data.set(img.data.subarray((((y/k)|0)*img.width+((x/k)|0))*4,(((y/k)|0)*img.width+((x/k)|0))*4+4),(y*n+x)*4);return out;}
const r=resize(img,n,n,'lanczos3');return{width:n,height:n,data:new Uint8ClampedArray(r.data)};}
function regenerate(doc){for(const n of SIZES){if(n===MASTER){doc.sizes[n].img=doc.master;continue;}
if(!doc.sizes[n].custom)doc.sizes[n].img=scaleTo(doc.master,n);}
doc.rev++;}
function snapshot(doc,which){const list=which==='all'?[MASTER,...SIZES.filter((n)=>n!==MASTER)]:[which];return list.map((n)=>({n,data:new Uint8ClampedArray(imageOf(doc,n).data),custom:n===MASTER?false:doc.sizes[n].custom,on:n===MASTER?true:doc.sizes[n].on,sel:doc.sel[n]?Uint8Array.from(doc.sel[n]):null,}));}
function restore(doc,snap){for(const s of snap){doc.sizes[s.n].on=s.on;doc.sel[s.n]=s.sel;if(s.n===MASTER){doc.master.data.set(s.data);continue;}
doc.sizes[s.n].custom=s.custom;if(s.custom)doc.sizes[s.n].img={width:s.n,height:s.n,data:new Uint8ClampedArray(s.data)};}
regenerate(doc);}
function record(doc,n,label=''){const which=n===MASTER?'all':n;doc.undo.push({label,snap:snapshot(doc,which)});if(doc.undo.length>HISTORY_MAX)doc.undo.shift();doc.redo.length=0;}
function undo(doc){const e=doc.undo.pop();if(!e)return null;doc.redo.push({label:e.label,snap:snapshot(doc,e.snap.length>1?'all':e.snap[0].n)});restore(doc,e.snap);return e.label;}
function redo(doc){const e=doc.redo.pop();if(!e)return null;doc.undo.push({label:e.label,snap:snapshot(doc,e.snap.length>1?'all':e.snap[0].n)});restore(doc,e.snap);return e.label;}
function makeCustom(doc,n){if(n===MASTER||doc.sizes[n].custom)return;doc.sizes[n].custom=true;doc.sizes[n].img=copyImage(doc.sizes[n].img);}
function makeAuto(doc,n){if(n===MASTER)return;doc.sizes[n].custom=false;regenerate(doc);}
function cropSquare(src,rect,n=MASTER){const s=Math.max(1,Math.round(rect.size));const sq=blank(s);const x0=Math.round(rect.x),y0=Math.round(rect.y);for(let y=0;y<s;y++){const sy=y0+y;if(sy<0||sy>=src.height)continue;const a=Math.max(0,-x0),b=Math.min(s,src.width-x0);if(b>a)sq.data.set(src.data.subarray((sy*src.width+x0+a)*4,(sy*src.width+x0+b)*4),(y*s+a)*4);}
return scaleTo(sq,n);}
const centreSquare=(w,h)=>{const size=Math.min(w,h);return{x:Math.floor((w-size)/2),y:Math.floor((h-size)/2),size};};function setMaster(doc,img){doc.master.data.set(scaleTo(img,MASTER).data);doc.sel[MASTER]=null;regenerate(doc);}
function importICO(doc,bytes){const list=decodeICO(bytes).filter((e)=>e.width===e.height);if(!list.length)throw new Error('no square images in the icon');doc.master.data.set(scaleTo(list[0],MASTER).data);const taken=[];for(const n of SIZES){doc.sizes[n].custom=false;if(n===MASTER)continue;const e=list.find((x)=>x.width===n);if(e&&e!==list[0]){doc.sizes[n].custom=true;doc.sizes[n].img={width:n,height:n,data:new Uint8ClampedArray(e.data)};taken.push(n);}}
doc.sel={};regenerate(doc);return taken;}
function exportICO(doc,opts={}){const sizes=enabledSizes(doc);if(!sizes.length)throw new Error('no sizes');return encodeICO(sizes.map((n)=>imageOf(doc,n)),opts);}
const exportPNG=(doc,n)=>encodePNG(imageOf(doc,n),{level:9});const B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';function toB64(bytes){let s='';for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2];s+=B64[a>>2]+B64[((a&3)<<4)|((b??0)>>4)]+(b===undefined?'=':B64[((b&15)<<2)|((c??0)>>6)])+(c===undefined?'=':B64[c&63]);}
return s;}
function fromB64(s){const clean=String(s).replace(/[^A-Za-z0-9+/]/g,'');const out=new Uint8Array(Math.floor((clean.length*3)/4));let o=0;for(let i=0;i<clean.length;i+=4){const v=[0,1,2,3].map((k)=>(i+k<clean.length?B64.indexOf(clean[i+k]):0));const n=(v[0]<<18)|(v[1]<<12)|(v[2]<<6)|v[3];if(o<out.length)out[o++]=(n>>16)&255;if(o<out.length)out[o++]=(n>>8)&255;if(o<out.length)out[o++]=n&255;}
return out;}
const pngOf=(b64,n)=>{const r=decodePNG(fromB64(b64));if(r.width!==n||r.height!==n)throw new Error(`bad ${n} px image`);return{width:n,height:n,data:new Uint8ClampedArray(r.data)};};function saveProject(doc){const sizes={};for(const n of SIZES){const s=doc.sizes[n];sizes[n]={on:s.on,custom:s.custom};if(s.custom)sizes[n].png=toB64(encodePNG(s.img,{level:9}));}
return JSON.stringify({format:'icon-creator',version:1,name:doc.name,master:toB64(encodePNG(doc.master,{level:9})),sizes});}
function loadProject(text){const p=JSON.parse(text);if(!p||p.format!=='icon-creator'||typeof p.master!=='string')throw new Error('not an icon-creator project');const doc=createDoc(String(p.name||'icon').slice(0,80));doc.master=pngOf(p.master,MASTER);for(const n of SIZES){const s=(p.sizes&&p.sizes[n])||{};doc.sizes[n].on=s.on!==false;if(s.custom&&s.png&&n!==MASTER){doc.sizes[n].custom=true;doc.sizes[n].img=pngOf(s.png,n);}}
regenerate(doc);return doc;}
export{MASTER,imageOf,saveProject,SIZES,record,makeAuto,makeCustom,enabledSizes,regenerate,undo,redo,loadProject,importICO,cropSquare,setMaster,centreSquare,exportICO,exportPNG,createDoc};