const EARTH_RADIUS=6371008.8;const RAD=Math.PI/180;const DEG=180/Math.PI;function latLng(p){if(!p)return null;const lat=Array.isArray(p)?p[0]:p.lat;const lng=Array.isArray(p)?p[1]:p.lng??p.lon;return Number.isFinite(+lat)&&Number.isFinite(+lng)&&lat!==null&&lng!==null?[+lat,+lng]:null;}
function haversine(a,b,radius=EARTH_RADIUS){const p=latLng(a),q=latLng(b);if(!p||!q)return NaN;const dLat=(q[0]-p[0])*RAD,dLng=(q[1]-p[1])*RAD;const h=Math.sin(dLat/2)**2+Math.cos(p[0]*RAD)*Math.cos(q[0]*RAD)*Math.sin(dLng/2)**2;return 2*radius*Math.asin(Math.min(1,Math.sqrt(h)));}
function pathLength(points){let m=0,prev=null;for(const x of points||[]){const p=latLng(x);if(!p)continue;if(prev)m+=haversine(prev,p);prev=p;}
return m;}
function bboxOf(points){let s=90,w=180,n=-90,e=-180,any=false;for(const x of points||[]){const p=latLng(x);if(!p)continue;any=true;if(p[0]<s)s=p[0];if(p[0]>n)n=p[0];if(p[1]<w)w=p[1];if(p[1]>e)e=p[1];}
return any?{south:s,west:w,north:n,east:e}:null;}
function bboxAround(p,m){const q=latLng(p);if(!q)return null;const dLat=(m/EARTH_RADIUS)*DEG;const dLng=dLat/Math.max(1e-9,Math.cos(q[0]*RAD));return{south:Math.max(-90,q[0]-dLat),west:q[1]-dLng,north:Math.min(90,q[0]+dLat),east:q[1]+dLng};}
const bboxIntersects=(a,b)=>!!a&&!!b&&a.south<=b.north&&b.south<=a.north&&a.west<=b.east&&b.west<=a.east;function bboxPad(b,f=0.1){if(!b)return null;const v=(b.north-b.south)*f,h=(b.east-b.west)*f;return{south:b.south-v,west:b.west-h,north:b.north+v,east:b.east+h};}
export{haversine,latLng,pathLength,bboxOf,bboxAround,bboxIntersects,bboxPad};