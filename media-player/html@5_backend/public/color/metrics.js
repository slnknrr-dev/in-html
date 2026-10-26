import{toLinear}from"./space.js";function luminance(rgb){const[r,g,b]=rgb.map((v)=>toLinear(Math.min(1,Math.max(0,v))));return 0.2126*r+0.7152*g+0.0722*b;}
function contrastRatio(rgb1,rgb2){const a=luminance(rgb1);const b=luminance(rgb2);return(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);}
export{contrastRatio};