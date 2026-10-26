function escapeValue(v){return String(v).replace(/[\\':]/g,(c)=>'\\'+c);}
function escapeGraph(s){return String(s).replace(/[\\'[\],;]/g,(c)=>'\\'+c);}
function num(x,digits=3){const v=Number(x);if(!Number.isFinite(v))return'0';const k=10**digits;let r=Math.round(v*k)/k;if(Object.is(r,-0)||r===0)r=0;let s=r.toFixed(digits);if(s.includes('.'))s=s.replace(/0+$/,'').replace(/\.$/,'');return s==='-0'?'0':s;}
const NAMED={'#ffffff':'white','#000000':'black'};function color(hex,alpha=1){let c=String(hex||'#000000').toLowerCase();if(/^#[0-9a-f]{3}$/.test(c))c='#'+c[1]+c[1]+c[2]+c[2]+c[3]+c[3];if(!/^#[0-9a-f]{6}$/.test(c))c='#000000';const base=NAMED[c]||c;return alpha>=0.999?base:`${base}@${num(Math.max(0,alpha),2)}`;}
export{num,escapeValue,escapeGraph,color};