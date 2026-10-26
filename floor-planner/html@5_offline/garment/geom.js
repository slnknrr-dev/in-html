const dist=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);const add2=(a,b)=>[a[0]+b[0],a[1]+b[1]];const sub2=(a,b)=>[a[0]-b[0],a[1]-b[1]];const mul2=(a,s)=>[a[0]*s,a[1]*s];const dot2=(a,b)=>a[0]*b[0]+a[1]*b[1];function area(poly){let s=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];s+=a[0]*b[1]-b[0]*a[1];}
return s/2;}
function bbox(pts){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const p of pts){if(p[0]<x0)x0=p[0];if(p[1]<y0)y0=p[1];if(p[0]>x1)x1=p[0];if(p[1]>y1)y1=p[1];}
return{x0,y0,x1,y1,w:x1-x0,h:y1-y0};}
function inside(poly,p){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<((b[0]-a[0])*(p[1]-a[1]))/(b[1]-a[1])+a[0])c=!c;}
return c;}
function segDist(p,a,b){const ab=sub2(b,a),l2=dot2(ab,ab);const t=l2?Math.max(0,Math.min(1,dot2(sub2(p,a),ab)/l2)):0;return dist(p,add2(a,mul2(ab,t)));}
export{area,dist,segDist,inside,bbox};