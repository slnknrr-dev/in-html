import{ERR,CellError,cellError,MAX_ROWS,MAX_COLS}from"../xlsx/cells.js";import{Ref,isMatrix,toNumber,isErr,toText,toBool,compare}from"./values.js";const FUNCTIONS=new Map();function defineFunction(name,spec){FUNCTIONS.set(name,{lazy:false,volatile:false,...spec,min:spec.min??spec.fn.min??0,max:spec.max??spec.fn.max??255});}
const VOLATILE=new Set();function deref(v,ctx){if(!(v instanceof Ref))return v;if(v.single)return ctx.value(v.s,v.r1,v.c1);return ctx.deref(v);}
function toMatrix(v,ctx){if(v instanceof Ref)return v.single?[[ctx.value(v.s,v.r1,v.c1)]]:ctx.deref(v);return isMatrix(v)?v:[[v]];}
function first(v,ctx){if(v instanceof Ref)return ctx.value(v.s,v.r1,v.c1);if(isMatrix(v))return v.length&&v[0].length?v[0][0]:null;return v;}
function broadcast(vals,fn){let h=1,w=1;for(const v of vals)if(isMatrix(v)){h=Math.max(h,v.length);w=Math.max(w,v[0]?v[0].length:0);}
const out=new Array(h);const xs=new Array(vals.length);for(let i=0;i<h;i++){const row=new Array(w);for(let j=0;j<w;j++){for(let k=0;k<vals.length;k++){const v=vals[k];if(!isMatrix(v)){xs[k]=v;continue;}
const vr=v.length===1?v[0]:v[i];if(!vr){xs[k]=ERR.NA;continue;}
xs[k]=vr.length===1?vr[0]:j<vr.length?vr[j]:ERR.NA;}
row[j]=fn(xs);}
out[i]=row;}
return out;}
function parseSig(sig){const types=[];let rest=false;for(const ch of sig){if(ch==='?')types[types.length-1].opt=true;else if(ch==='*')rest=true;else types.push({t:ch,opt:false});}
return{types,rest};}
function coerce(t,v){switch(t){case'n':return toNumber(v);case'i':{const n=toNumber(v);return isErr(n)?n:Math.trunc(n);}
case's':return toText(v);case'b':return toBool(v);default:return v;}}
function lift(sig,impl){const{types,rest}=parseSig(sig);const typeAt=(i)=>types[Math.min(i,types.length-1)]||{t:'v'};const apply=(vals)=>{const out=new Array(vals.length);for(let i=0;i<vals.length;i++){const v=vals[i];const t=typeAt(i).t;if(v===undefined||t==='e'||t==='a'||t==='r'){out[i]=v;continue;}
const x=coerce(t,v);if(x instanceof CellError)return x;out[i]=x;}
return impl(...out);};const fn=(args,ctx)=>{if(!rest&&args.length>types.length)return ERR.VALUE;const vals=new Array(args.length);const lifted=[];for(let i=0;i<args.length;i++){const t=typeAt(i).t;if(t==='r'){vals[i]=args[i];continue;}
const d=deref(args[i],ctx);if(t==='a'){vals[i]=isMatrix(d)?d:[[d]];continue;}
if(isMatrix(d)){if(d.length===1&&d[0].length===1){vals[i]=d[0][0];continue;}
lifted.push(i);}
vals[i]=d;}
if(!lifted.length)return apply(vals);return broadcast(lifted.map((i)=>vals[i]),(xs)=>{const call=vals.slice();lifted.forEach((i,k)=>{call[i]=xs[k];});const r=apply(call);return isMatrix(r)?first(r,ctx):r instanceof Ref?ctx.value(r.s,r.r1,r.c1):r;});};fn.min=types.filter((t)=>!t.opt).length;fn.max=rest?255:types.length;return fn;}
function arith(op,x,y){const a=toNumber(x);if(a instanceof CellError)return a;const b=toNumber(y);if(b instanceof CellError)return b;let r;switch(op){case'+':r=a+b;break;case'-':r=a-b;break;case'*':r=a*b;break;case'/':if(b===0)return ERR.DIV0;r=a/b;break;default:if(a===0&&b===0)return ERR.NUM;if(a===0&&b<0)return ERR.DIV0;r=a**b;}
return Number.isFinite(r)?r:ERR.NUM;}
function binop(op,x,y){if(x instanceof CellError)return x;if(y instanceof CellError)return y;switch(op){case'&':return toText(x)+toText(y);case'=':return compare(x,y)===0&&(typeof x!=='string'||typeof y!=='string'||x.toLowerCase()===y.toLowerCase());case'<>':return compare(x,y)!==0;case'<':return compare(x,y)<0;case'>':return compare(x,y)>0;case'<=':return compare(x,y)<=0;case'>=':return compare(x,y)>=0;default:return arith(op,x,y);}}
function unop(op,v){if(v instanceof CellError)return v;const n=toNumber(v);if(n instanceof CellError)return n;return op==='-'?-n:op==='%'?n/100:n;}
function intersect(v,ctx){if(v instanceof Ref){if(v.single)return ctx.value(v.s,v.r1,v.c1);if(v.c1===v.c2&&ctx.r>=v.r1&&ctx.r<=v.r2)return ctx.value(v.s,ctx.r,v.c1);if(v.r1===v.r2&&ctx.c>=v.c1&&ctx.c<=v.c2)return ctx.value(v.s,v.r1,ctx.c);return ERR.VALUE;}
return first(v,ctx);}
function sheetOf(name,ctx){if(name==null)return ctx.s;return ctx.sheetIndex(name);}
function evaluate(n,ctx){switch(n.type){case'num':case'str':case'bool':return n.v;case'err':return cellError(n.v);case'missing':return null;case'ref':{const s=sheetOf(n.sheet,ctx);return s<0?ERR.REF:new Ref(s,n.r,n.c,n.r,n.c);}
case'range':{const s=sheetOf(n.sheet,ctx);if(s<0)return ERR.REF;return n.r1==null?new Ref(s,0,n.c1,MAX_ROWS-1,n.c2):n.c1==null?new Ref(s,n.r1,0,n.r2,MAX_COLS-1):new Ref(s,n.r1,n.c1,n.r2,n.c2);}
case'name':{const ast=ctx.name(n.name,n.sheet);return ast?evaluate(ast,ctx):ERR.NAME;}
case'paren':return evaluate(n.a,ctx);case'unary':{if(n.op==='@')return intersect(evaluate(n.a,ctx),ctx);const v=deref(evaluate(n.a,ctx),ctx);return isMatrix(v)?broadcast([v],(xs)=>unop(n.op,xs[0])):unop(n.op,v);}
case'postfix':{const v=deref(evaluate(n.a,ctx),ctx);return isMatrix(v)?broadcast([v],(xs)=>unop('%',xs[0])):unop('%',v);}
case'bin':{if(n.op===':'){const a=evaluate(n.a,ctx),b=evaluate(n.b,ctx);if(!(a instanceof Ref)||!(b instanceof Ref)||a.s!==b.s)return a instanceof CellError?a:b instanceof CellError?b:ERR.VALUE;return new Ref(a.s,Math.min(a.r1,b.r1),Math.min(a.c1,b.c1),Math.max(a.r2,b.r2),Math.max(a.c2,b.c2));}
const a=deref(evaluate(n.a,ctx),ctx);const b=deref(evaluate(n.b,ctx),ctx);if(isMatrix(a)||isMatrix(b))return broadcast([a,b],(xs)=>binop(n.op,xs[0],xs[1]));return binop(n.op,a,b);}
case'call':{const def=FUNCTIONS.get(n.name);if(!def)return ERR.NAME;if(n.args.length<def.min||n.args.length>def.max)return ERR.VALUE;if(def.lazy)return def.fn(n.args,ctx,(a)=>evaluate(a,ctx));const args=new Array(n.args.length);for(let i=0;i<n.args.length;i++)args[i]=evaluate(n.args[i],ctx);return def.fn(args,ctx);}
case'array':{return n.rows.map((row)=>row.map((c)=>evaluate(c,ctx)));}
default:return ERR.VALUE;}}
function eachValue(args,ctx,fn){for(const a of args){if(a instanceof Ref||isMatrix(a)){const m=toMatrix(a,ctx);for(const row of m)for(const v of row)if(fn(v,true)===false)return;}else if(fn(a,false)===false)return;}}
function numbers(args,ctx,{directText=true}={}){const out=[];let err=null;eachValue(args,ctx,(v,fromRange)=>{if(typeof v==='number')out.push(v);else if(v instanceof CellError){err=v;return false;}
else if(!fromRange&&v!=null){if(typeof v==='string'&&!directText)return undefined;const n=toNumber(v);if(n instanceof CellError){err=n;return false;}
out.push(n);}
return undefined;});return err||out;}
function numbersA(args,ctx){const out=[];let err=null;eachValue(args,ctx,(v,fromRange)=>{if(v instanceof CellError){err=v;return false;}
if(v==null)return undefined;if(typeof v==='number')out.push(v);else if(typeof v==='boolean')out.push(v?1:0);else if(fromRange)out.push(0);else{const n=toNumber(v);if(n instanceof CellError){err=n;return false;}out.push(n);}
return undefined;});return err||out;}
export{defineFunction,lift,FUNCTIONS,numbers,numbersA,eachValue,deref,broadcast,first,toMatrix,VOLATILE,evaluate};