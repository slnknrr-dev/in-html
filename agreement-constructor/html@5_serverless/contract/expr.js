import{isoDate,addDays,addMonths,diffDays,monthsBetween,parseDate}from"./dates.js";const MAX_SRC=4000;const MAX_DEPTH=64;const BAD_KEYS=new Set(['__proto__','constructor','prototype']);function tokenize(src){const out=[];let i=0;const s=String(src);while(i<s.length){const c=s[i];if(/\s/.test(c)){i++;continue;}
if(/[0-9]/.test(c)||(c==='.'&&/[0-9]/.test(s[i+1]||''))){const m=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));out.push({t:'num',v:+m[0],at:i});i+=m[0].length;continue;}
if(c==='"'||c==="'"){let j=i+1,v='';while(j<s.length&&s[j]!==c){if(s[j]==='\\'&&j+1<s.length){const e=s[j+1];v+=e==='n'?'\n':e==='t'?'\t':e;j+=2;}else v+=s[j++];}
if(j>=s.length)throw new SyntaxError('unterminated string');out.push({t:'str',v,at:i});i=j+1;continue;}
if(/[A-Za-z_$]/.test(c)){const m=/^[A-Za-z_$][A-Za-z0-9_$]*/.exec(s.slice(i));out.push({t:'id',v:m[0],at:i});i+=m[0].length;continue;}
const three=s.slice(i,i+3),two=s.slice(i,i+2);if(three==='==='||three==='!=='){out.push({t:'p',v:three.slice(0,2),at:i});i+=3;continue;}
if(['==','!=','<=','>=','&&','||','??'].includes(two)){out.push({t:'p',v:two,at:i});i+=2;continue;}
if('()[],.?:+-*/%!<>|#'.includes(c)){out.push({t:'p',v:c,at:i});i++;continue;}
throw new SyntaxError(`unexpected "${c}"`);}
out.push({t:'end',at:s.length});return out;}
const KEYWORD_OPS={and:'&&',or:'||',not:'!'};const LITERALS={true:true,false:false,null:null};class Parser{constructor(tokens){this.k=tokens;this.i=0;this.depth=0;}
peek(){return this.k[this.i];}
next(){return this.k[this.i++];}
isP(v){const t=this.peek();return(t.t==='p'&&t.v===v)||(t.t==='id'&&KEYWORD_OPS[t.v]===v);}
eat(v){if(this.isP(v)){this.i++;return true;}return false;}
want(v){if(!this.eat(v))throw new SyntaxError(`expected "${v}"`);}
enter(){if(++this.depth>MAX_DEPTH)throw new SyntaxError('expression too deep');}
expr(){this.enter();const c=this.or();let r=c;if(this.eat('?')){const a=this.expr();this.want(':');const b=this.expr();r={t:'cond',c,a,b};}
this.depth--;return r;}
bin(next,ops){let a=next();for(;;){const op=ops.find((o)=>this.isP(o));if(!op)return a;this.i++;a={t:'bin',op,a,b:next()};}}
or(){return this.bin(()=>this.coalesce(),['||']);}
coalesce(){return this.bin(()=>this.and(),['??']);}
and(){return this.bin(()=>this.eq(),['&&']);}
eq(){return this.bin(()=>this.rel(),['==','!=']);}
rel(){return this.bin(()=>this.add(),['<=','>=','<','>']);}
add(){return this.bin(()=>this.mul(),['+','-']);}
mul(){return this.bin(()=>this.unary(),['*','/','%']);}
unary(){if(this.eat('!')){this.enter();const a=this.unary();this.depth--;return{t:'un',op:'!',a};}
if(this.eat('-')){this.enter();const a=this.unary();this.depth--;return{t:'un',op:'-',a};}
if(this.eat('+'))return this.unary();return this.postfix();}
postfix(){let n=this.primary();for(;;){if(this.eat('.')){const t=this.next();if(t.t!=='id')throw new SyntaxError('expected a name after "."');n=n.t==='ref'?{t:'ref',path:n.path+'.'+t.v}:{t:'mem',o:n,k:{t:'lit',v:t.v}};}else if(this.eat('[')){const k=this.expr();this.want(']');n=n.t==='ref'&&k.t==='lit'&&Number.isInteger(k.v)&&k.v>=0?{t:'ref',path:n.path+'.'+k.v}:{t:'mem',o:n,k};}else if(this.isP('(')){if(n.t!=='ref'||n.path.includes('.'))throw new SyntaxError('only functions can be called');this.i++;const args=[];if(!this.eat(')')){do args.push(this.expr());while(this.eat(','));this.want(')');}
if(!Object.prototype.hasOwnProperty.call(FUNCTIONS,n.path))throw new SyntaxError(`unknown function ${n.path}()`);n={t:'call',name:n.path,args};}else return n;}}
primary(){const t=this.next();if(t.t==='num'||t.t==='str')return{t:'lit',v:t.v};if(t.t==='id'){if(Object.prototype.hasOwnProperty.call(LITERALS,t.v))return{t:'lit',v:LITERALS[t.v]};if(KEYWORD_OPS[t.v])throw new SyntaxError(`unexpected "${t.v}"`);return{t:'ref',path:t.v};}
if(t.t==='p'&&t.v==='('){const e=this.expr();this.want(')');return e;}
if(t.t==='p'&&t.v==='['){const items=[];if(!this.eat(']')){do items.push(this.expr());while(this.eat(','));this.want(']');}
return{t:'arr',items};}
throw new SyntaxError(t.t==='end'?'unexpected end':`unexpected "${t.v}"`);}}
function parseExpr(src){const s=String(src??'');if(s.length>MAX_SRC)return{ast:null,error:'too long'};try{const p=new Parser(tokenize(s));const ast=p.expr();if(p.peek().t!=='end')throw new SyntaxError(`unexpected "${p.peek().v}"`);return{ast,error:null};}catch(e){return{ast:null,error:String(e.message||e)};}}
function parsePipe(src){const s=String(src??'');if(s.length>MAX_SRC)return{ast:null,filters:[],error:'too long'};try{const p=new Parser(tokenize(s));const ast=p.expr();const filters=[];while(p.eat('|')){const t=p.next();if(t.t!=='id')throw new SyntaxError('expected a filter name after "|"');const args=[];if(p.eat(':')){do args.push(p.expr());while(p.eat(','));}
filters.push({name:t.v,args});}
if(p.peek().t!=='end')throw new SyntaxError(`unexpected "${p.peek().v}"`);return{ast,filters,error:null};}catch(e){return{ast:null,filters:[],error:String(e.message||e)};}}
function refsOf(ast,out=new Set()){if(!ast||typeof ast!=='object')return out;if(ast.t==='ref')out.add(ast.path);for(const k of['a','b','c','o','k'])if(ast[k])refsOf(ast[k],out);for(const x of ast.args||ast.items||[])refsOf(x,out);return out;}
function truthy(v){if(Array.isArray(v))return v.length>0;if(v&&typeof v==='object')return Object.keys(v).length>0;return!!v;}
const isNumeric=(v)=>typeof v==='number'||(typeof v==='string'&&v.trim()!==''&&Number.isFinite(+v));function looseEq(a,b){const ea=a==null||a==='',eb=b==null||b==='';if(ea||eb)return ea&&eb;if(typeof a==='boolean'||typeof b==='boolean')return truthy(a)===truthy(b);if(isNumeric(a)&&isNumeric(b))return+a===+b;return String(a)===String(b);}
const num=(v)=>(v==null||v===''?0:typeof v==='number'?v:Number.isFinite(+v)?+v:NaN);const fin=(v)=>(typeof v==='number'&&!Number.isFinite(v)?null:v);function member(o,k){if(o==null||typeof o!=='object')return typeof o==='string'&&k==='length'?o.length:null;if(Array.isArray(o)&&k==='length')return o.length;const key=String(k);if(BAD_KEYS.has(key)||!Object.prototype.hasOwnProperty.call(o,key))return null;return o[key];}
const listOf=(v)=>(Array.isArray(v)?v:[]);const roundP=(x,p=0)=>{const f=10**Math.min(Math.max(Math.trunc(num(p))||0,0),8);return Math.round((num(x)+Math.sign(num(x))*Number.EPSILON)*f)/f;};const FUNCTIONS={round:(x,p)=>roundP(x,p),floor:(x)=>Math.floor(num(x)),ceil:(x)=>Math.ceil(num(x)),abs:(x)=>Math.abs(num(x)),min:(...a)=>(a.length?Math.min(...a.flat().map(num)):null),max:(...a)=>(a.length?Math.max(...a.flat().map(num)):null),sum:(list,prop)=>listOf(list).reduce((s,x)=>s+num(prop!=null?member(x,prop):x),0),count:(list)=>listOf(list).length,len:(x)=>(Array.isArray(x)?x.length:String(x??'').length),upper:(s)=>String(s??'').toLocaleUpperCase(),lower:(s)=>String(s??'').toLocaleLowerCase(),trim:(s)=>String(s??'').trim(),concat:(...a)=>a.map((x)=>(x==null?'':String(x))).join(''),join:(list,sep=', ',prop)=>listOf(list).map((x)=>(prop!=null?member(x,prop):x)).filter((x)=>x!=null&&x!=='').join(String(sep)),pick:(list,prop)=>listOf(list).map((x)=>member(x,prop)),contains:(h,x)=>(Array.isArray(h)?h.some((y)=>looseEq(y,x)):String(h??'').includes(String(x??''))),if:(c,a,b)=>(truthy(c)?a:b),default:(a,b)=>(a==null||a===''||(Array.isArray(a)&&!a.length)?b:a),number:(x)=>(Number.isFinite(+x)&&x!==''&&x!=null?+x:null),string:(x)=>(x==null?'':String(x)),date:(y,m,d)=>(m==null?isoDate(String(y??'')):isoDate(`${y}-${m}-${d}`)),addDays:(d,n)=>addDays(d,num(n))||null,addMonths:(d,n)=>addMonths(d,num(n))||null,days:(a,b)=>diffDays(a,b),months:(a,b)=>monthsBetween(a,b),year:(d)=>parseDate(d)?.y??null,month:(d)=>parseDate(d)?.m??null,day:(d)=>parseDate(d)?.d??null,today:null,words:null,money:null,fmtDate:null,plural:null,};function ev(n,env,depth){if(++env.steps>20000||depth>MAX_DEPTH)throw new RangeError('expression too costly');switch(n.t){case'lit':return n.v;case'arr':return n.items.map((x)=>ev(x,env,depth+1));case'ref':{if(env.vars){const dot=n.path.indexOf('.');const head=dot<0?n.path:n.path.slice(0,dot);if(Object.prototype.hasOwnProperty.call(env.vars,head)){let v=env.vars[head];if(dot>=0)for(const k of n.path.slice(dot+1).split('.'))v=member(v,k);return v;}}
return env.get(n.path);}
case'mem':return member(ev(n.o,env,depth+1),ev(n.k,env,depth+1));case'un':{const a=ev(n.a,env,depth+1);return n.op==='!'?!truthy(a):fin(-num(a));}
case'cond':return truthy(ev(n.c,env,depth+1))?ev(n.a,env,depth+1):ev(n.b,env,depth+1);case'call':{const args=n.args.map((x)=>ev(x,env,depth+1));if(n.name==='today')return env.today||null;const f=FUNCTIONS[n.name];if(typeof f==='function')return fin(f(...args));return env.call?fin(env.call(n.name,args)):null;}
case'bin':{if(n.op==='&&'){const a=ev(n.a,env,depth+1);return truthy(a)?ev(n.b,env,depth+1):a;}
if(n.op==='||'){const a=ev(n.a,env,depth+1);return truthy(a)?a:ev(n.b,env,depth+1);}
if(n.op==='??'){const a=ev(n.a,env,depth+1);return a==null||a===''?ev(n.b,env,depth+1):a;}
const a=ev(n.a,env,depth+1),b=ev(n.b,env,depth+1);switch(n.op){case'==':return looseEq(a,b);case'!=':return!looseEq(a,b);case'<':case'<=':case'>':case'>=':{if(a==null||b==null||a===''||b==='')return false;const both=isNumeric(a)&&isNumeric(b);const x=both?+a:String(a),y=both?+b:String(b);return n.op==='<'?x<y:n.op==='<='?x<=y:n.op==='>'?x>y:x>=y;}
case'+':if((typeof a==='string'&&!isNumeric(a))||(typeof b==='string'&&!isNumeric(b)))return(a??'')+''+(b??'');return fin(num(a)+num(b));case'-':return fin(num(a)-num(b));case'*':return fin(num(a)*num(b));case'/':return num(b)===0?null:fin(num(a)/num(b));case'%':return num(b)===0?null:fin(num(a)%num(b));}
return null;}}
return null;}
function evaluate(ast,env){if(!ast)return null;let e=env;if(env.steps==null){e=Object.create(env);e.steps=0;}
try{const v=ev(ast,e,0);return v===undefined||(typeof v==='number'&&Number.isNaN(v))?null:v;}catch(err){if(env.onError)env.onError(String(err.message||err));return null;}}
export{parsePipe,parseExpr,refsOf,evaluate,truthy};