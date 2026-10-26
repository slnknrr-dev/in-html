const FIELD_SYMMETRIES=['none','mirrorX','mirrorY','mirrorXY','rot2','rot4','d4'];const WALLPAPER=['p1','p2','pm','pg','cm','pmm','pmg','pgg','cmm','p4','p4m','p4g'];function orbit(sym,x,y,w,h){const fx=(p)=>[w-1-p[0],p[1]],fy=(p)=>[p[0],h-1-p[1]],r2=(p)=>[w-1-p[0],h-1-p[1]];const r4=(p)=>[w-1-p[1],p[0]],tr=(p)=>[p[1],p[0]];const p=[x,y];const square=w===h;switch(sym){case'mirrorX':return[p,fx(p)];case'mirrorY':return[p,fy(p)];case'rot2':return[p,r2(p)];case'mirrorXY':return[p,fx(p),fy(p),r2(p)];case'rot4':return square?[p,r4(p),r4(r4(p)),r4(r4(r4(p)))]:[p,fx(p),fy(p),r2(p)];case'd4':return square?[p,r4(p),r4(r4(p)),r4(r4(r4(p))),tr(p),fx(p),fy(p),tr(r2(p))]:[p,fx(p),fy(p),r2(p)];default:return[p];}}
function fieldFold(sym,x,y,w,h){let best=null;for(const q of orbit(sym,x,y,w,h))if(!best||q[1]<best[1]||(q[1]===best[1]&&q[0]<best[0]))best=q;return best;}
const mod=(a,n)=>((a%n)+n)%n;function wallpaperFold(group,x,y,tw,th){const[fu,fv]=wallpaperFoldF(group,x+0.5,y+0.5,tw,th);const W=tw,H=group.startsWith('p4')?tw:th;return[Math.max(0,Math.min(W-1,Math.floor(fu))),Math.max(0,Math.min(H-1,Math.floor(fv)))];}
function wallpaperFoldF(group,x,y,tw,th){const W=tw,H=group.startsWith('p4')?tw:th;const row=Math.floor(y/H);let u=mod(x,W);const v=mod(y,H);if(group==='cm'||group==='cmm'){if(mod(row,2)===1)u=mod(u+W/2,W);}
const m=(a,n)=>Math.min(a,n-a);let fu=u,fv=v;switch(group){case'p2':if(v>=H/2){fu=W-u;fv=H-v;}break;case'pm':case'cm':fu=m(u,W);break;case'pg':if(v>=H/2){fu=W-u;fv=v-H/2;}break;case'pmm':case'cmm':fu=m(u,W);fv=m(v,H);break;case'pmg':if(v<H/2)fu=m(u,W);else{fu=m(mod(u+W/2,W),W);fv=H-v;}break;case'pgg':if(u<W/2&&v<H/2){}
else if(u>=W/2&&v<H/2){fu=u-W/2;fv=H/2-v;}
else if(u<W/2){fu=W/2-u;fv=v-H/2;}
else{fu=W-u;fv=H-v;}
break;case'p4':case'p4m':case'p4g':{let a=u-W/2,b=v-W/2;for(let k=0;k<4&&!(a>=0&&b>=0);k++)[a,b]=[b,-a];if(group==='p4m'&&b>a)[a,b]=[b,a];if(group==='p4g'&&a+b>W/2)[a,b]=[W/2-b,W/2-a];fu=a;fv=b;break;}
default:break;}
return[fu,fv];}
export{WALLPAPER,wallpaperFoldF,fieldFold,wallpaperFold,orbit,FIELD_SYMMETRIES};