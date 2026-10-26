const SAFE=Number.MAX_SAFE_INTEGER;function mulDivRound(a,m,b,mode='half-up'){if(!Number.isInteger(a)||!Number.isInteger(m)||!Number.isInteger(b)||b===0)throw new RangeError('integers expected, divisor non-zero');const p=a*m;if(Math.abs(p)<=SAFE)return roundQuotient(p,b,mode,Number);return Number(roundQuotient(BigInt(a)*BigInt(m),BigInt(b),mode,BigInt));}
function roundQuotient(n,d,mode,T){const zero=T(0),one=T(1),two=T(2);if(d<zero){n=-n;d=-d;}
const neg=n<zero;const an=neg?-n:n;let q=T===Number?Math.floor(an/d):an/d;let r=an-q*d;while(r<zero){q-=one;r+=d;}
while(r>=d){q+=one;r-=d;}
if(r!==zero){const twice=r*two;if(mode==='up')q+=one;else if(mode==='half-up'){if(twice>=d)q+=one;}
else if(mode==='half-even'){if(twice>d||(twice===d&&q%two!==zero))q+=one;}
else if(mode!=='down')throw new RangeError(`unknown rounding mode: ${mode}`);}
return neg?-q:q;}
const percentOf=(amount,pct,mode='half-up')=>mulDivRound(amount,Math.round(Number(pct)*10000),1_000_000,mode);function formatMoney(minor,{digits=2,decimal='.',group='',plus=false}={}){const neg=minor<0;const s=String(Math.abs(Math.trunc(minor))).padStart(digits+1,'0');let int=digits?s.slice(0,-digits):s;const frac=digits?s.slice(-digits):'';if(group)int=int.replace(/\B(?=(\d{3})+(?!\d))/g,group);return(neg?'-':plus&&minor>0?'+':'')+int+(digits?decimal+frac:'');}
export{percentOf,formatMoney};