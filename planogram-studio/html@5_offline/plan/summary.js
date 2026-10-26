import{corners,pointInPolygon}from"./geom.js";import{stencil}from"./stencils.js";import"./model.js";import{segDist}from"../garment/geom.js";function isSolid(s){const st=stencil(s.kind);return!(st.room||st.zone||st.flat||st.plain||['door','window','dancefloor','rect','ellipse'].includes(st.key));}
function penetration(a,b){let best=Infinity;for(const poly of[a,b]){for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length];const n=[q[1]-p[1],p[0]-q[0]],l=Math.hypot(n[0],n[1])||1;const ax=[n[0]/l,n[1]/l];let a0=Infinity,a1=-Infinity,b0=Infinity,b1=-Infinity;for(const v of a){const d=v[0]*ax[0]+v[1]*ax[1];a0=Math.min(a0,d);a1=Math.max(a1,d);}
for(const v of b){const d=v[0]*ax[0]+v[1]*ax[1];b0=Math.min(b0,d);b1=Math.max(b1,d);}
best=Math.min(best,Math.min(a1,b1)-Math.max(a0,b0));if(best<=0)return best;}}
return best;}
function polygonGap(a,b){if(penetration(a,b)>=0)return 0;let d=Infinity;for(let i=0;i<a.length;i++)for(const v of b)d=Math.min(d,segDist(v,a[i],a[(i+1)%a.length]));for(let i=0;i<b.length;i++)for(const v of a)d=Math.min(d,segDist(v,b[i],b[(i+1)%b.length]));return d;}
function overlaps(page,{filter=isSolid,tol=1e-6}={}){const list=page.shapes.filter(filter).map((s)=>({s,c:corners(s)}));const out=[];for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const d=penetration(list[i].c,list[j].c);if(d>tol)out.push({a:list[i].s.id,b:list[j].s.id,depth:Math.round(d*1000)/1000});}
return out;}
function narrowAisles(page,min=0.9,{filter=isSolid}={}){const list=page.shapes.filter(filter).map((s)=>({s,c:corners(s)}));const out=[];for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const g=polygonGap(list[i].c,list[j].c);if(g>1e-6&&g<min-1e-9)out.push({a:list[i].s.id,b:list[j].s.id,gap:Math.round(g*1000)/1000});}
return out;}
function outsidePage(page,{filter=(s)=>!stencil(s.kind).flat}={}){const poly=page.outline??[[0,0],[page.w,0],[page.w,page.h],[0,page.h]];return page.shapes.filter(filter).filter((s)=>corners(s).some((p)=>!pointInPolygon(poly,p,1e-6))).map((s)=>s.id);}
export{overlaps,narrowAisles,outsidePage};