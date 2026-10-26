function encodeValue(v,out){let n=v<0?~(v<<1):v<<1;while(n>=0x20){out.push(String.fromCharCode((0x20|(n&0x1f))+63));n>>>=5;}
out.push(String.fromCharCode(n+63));}
function encodePolyline(points,precision=5){const k=10**precision;const out=[];let plat=0,plng=0;for(const p of points||[]){const lat=Math.round((Array.isArray(p)?p[0]:p.lat)*k),lng=Math.round((Array.isArray(p)?p[1]:p.lng??p.lon)*k);if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;encodeValue(lat-plat,out);encodeValue(lng-plng,out);plat=lat;plng=lng;}
return out.join('');}
export{encodePolyline};