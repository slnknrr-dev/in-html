import{mulDivRound}from"./money.js";const scaled=(rate)=>Math.round(Number(rate)*1000);function vatIncluded(amount,rate,mode='half-up'){if(!rate)return 0;const r=scaled(rate);return mulDivRound(amount,r,100_000+r,mode);}
const key=(rate)=>String(Number(rate));function vatBreakdown(lines,{method='line',mode='half-up'}={}){const rates={};let exempt=0,gross=0;for(const l of lines){gross+=l.total;if(l.vatRate==null){exempt+=l.total;continue;}
const k=key(l.vatRate);const x=(rates[k]??={rate:Number(l.vatRate),gross:0,vat:0,net:0});x.gross+=l.total;if(method==='line')x.vat+=l.vat??vatIncluded(l.total,l.vatRate,mode);}
let vat=0;for(const x of Object.values(rates)){if(method==='rate')x.vat=vatIncluded(x.gross,x.rate,mode);x.net=x.gross-x.vat;vat+=x.vat;}
const out={};for(const k of Object.keys(rates).sort((a,b)=>Number(b)-Number(a))){const{rate,...rest}=rates[k];out[k]=rest;}
return{rates:out,exempt,vat,gross};}
function addBreakdown(a,b,sign=1){const rates=Object.fromEntries(Object.entries(a.rates).map(([k,x])=>[k,{...x}]));for(const[k,x]of Object.entries(b.rates)){const y=(rates[k]??={gross:0,vat:0,net:0});y.gross+=sign*x.gross;y.vat+=sign*x.vat;y.net+=sign*x.net;}
return{rates,exempt:a.exempt+sign*b.exempt,vat:a.vat+sign*b.vat,gross:a.gross+sign*b.gross};}
const emptyBreakdown=()=>({rates:{},exempt:0,vat:0,gross:0});export{emptyBreakdown,addBreakdown,vatIncluded,vatBreakdown};