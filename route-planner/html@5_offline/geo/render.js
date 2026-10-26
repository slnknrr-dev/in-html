import"./osm.js";import"./mercator.js";import"./sphere.js";const r1=(v)=>Math.round(v*10)/10;const MIN_STEP=0.4;const escXml=(s)=>String(s).replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);function pathD(px,close){if(px.length<2)return'';const out=[];let lx=NaN,ly=NaN;for(let i=0;i<px.length;i++){const[x,y]=px[i];if(i&&i<px.length-1&&Math.abs(x-lx)<MIN_STEP&&Math.abs(y-ly)<MIN_STEP)continue;out.push((out.length?'L':'M')+r1(x)+' '+r1(y));lx=x;ly=y;}
if(out.length<2)return'';return out.join('')+(close?'Z':'');}
function boxOf(c){const a=(c.angle*Math.PI)/180,w=c.w/2+(c.pad??2),h=c.h/2+(c.pad??2);const cos=Math.cos(a),sin=Math.sin(a);return[[-w,-h],[w,-h],[w,h],[-w,h]].map(([x,y])=>[c.x+x*cos-y*sin,c.y+x*sin+y*cos]);}
function overlap(p,q){for(const poly of[p,q]){for(let i=0;i<4;i++){const a=poly[i],b=poly[(i+1)%4];const nx=b[1]-a[1],ny=a[0]-b[0];let pMin=Infinity,pMax=-Infinity,qMin=Infinity,qMax=-Infinity;for(const v of p){const d=v[0]*nx+v[1]*ny;if(d<pMin)pMin=d;if(d>pMax)pMax=d;}
for(const v of q){const d=v[0]*nx+v[1]*ny;if(d<qMin)qMin=d;if(d>qMax)qMax=d;}
if(pMax<qMin||qMax<pMin)return false;}}
return true;}
function placeLabels(candidates,{width=Infinity,height=Infinity,spacing=220,margin=2}={}){const list=(candidates||[]).slice().sort((a,b)=>(a.priority??9)-(b.priority??9)||b.w-a.w);const done=[],boxes=[],byText=new Map();for(const c of list){const box=boxOf(c);if(box.some(([x,y])=>x<margin||y<margin||x>width-margin||y>height-margin))continue;const same=byText.get(c.text)||[];if(same.some((o)=>Math.hypot(o.x-c.x,o.y-c.y)<spacing))continue;if(boxes.some((b)=>overlap(b,box)))continue;done.push(c);boxes.push(box);same.push(c);byText.set(c.text,same);}
return done;}
export{escXml,pathD,placeLabels};