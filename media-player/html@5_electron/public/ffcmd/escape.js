function escapeValue(v){return String(v).replace(/[\\':]/g,(c)=>'\\'+c);}
function escapeGraph(s){return String(s).replace(/[\\'[\],;]/g,(c)=>'\\'+c);}
function num(x,digits=3){const v=Number(x);if(!Number.isFinite(v))return'0';const k=10**digits;let r=Math.round(v*k)/k;if(Object.is(r,-0)||r===0)r=0;let s=r.toFixed(digits);if(s.includes('.'))s=s.replace(/0+$/,'').replace(/\.$/,'');return s==='-0'?'0':s;}
const seconds=(x)=>num(x,3);export{num,escapeValue,escapeGraph,seconds};