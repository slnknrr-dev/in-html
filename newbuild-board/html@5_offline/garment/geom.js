const dist=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);function area(poly){let s=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];s+=a[0]*b[1]-b[0]*a[1];}
return s/2;}
function bbox(pts){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const p of pts){if(p[0]<x0)x0=p[0];if(p[1]<y0)y0=p[1];if(p[0]>x1)x1=p[0];if(p[1]>y1)y1=p[1];}
return{x0,y0,x1,y1,w:x1-x0,h:y1-y0};}
export{area,dist,bbox};