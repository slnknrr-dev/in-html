const FLAGS='dgimsuvy';const FLAG_NAMES={d:'hasIndices',g:'global',i:'ignoreCase',m:'multiline',s:'dotAll',u:'unicode',v:'unicodeSets',y:'sticky'};const MESSAGES={flagInvalid:'Unknown flag',flagDuplicate:'Duplicate flag',flagsUV:'The u and v flags cannot be combined',escapeAtEnd:'\\ at end of pattern',unterminatedGroup:'Unterminated group',unmatchedParen:'Unmatched \')\'',unterminatedClass:'Unterminated character class',nothingToRepeat:'Nothing to repeat',invalidQuantifier:'This assertion cannot be quantified',loneQuantifierBracket:'Lone quantifier bracket',incompleteQuantifier:'Incomplete quantifier',quantifierOrder:'Numbers out of order in {} quantifier',invalidGroup:'Invalid group',invalidGroupName:'Invalid capture group name',duplicateGroupName:'Duplicate capture group name',invalidNamedReference:'Invalid named reference',unknownGroupName:'Reference to an undefined group name',invalidBackreference:'Reference to a group that does not exist',invalidModifiers:'Empty modifiers group',repeatedModifier:'Repeated flag in modifiers',invalidEscape:'Invalid escape',invalidUnicodeEscape:'Invalid Unicode escape',invalidDecimalEscape:'Invalid decimal escape',invalidPropertyName:'Invalid property name',rangeOrder:'Range out of order in character class',invalidClassRange:'A character class escape cannot be a range end',invalidClassChar:'Invalid character in character class',invalidClassOperation:'Invalid set operation in character class',negatedClassStrings:'Negated character class may contain strings',};class RegExpSyntaxError extends SyntaxError{constructor(code,start,end,params=null){super(MESSAGES[code]||code);this.name='RegExpSyntaxError';this.code=code;this.start=start;this.end=Math.max(start,end);this.params=params;}}
const STRING_PROPERTIES=new Set(['Basic_Emoji','Emoji_Keycap_Sequence','RGI_Emoji_Modifier_Sequence','RGI_Emoji_Flag_Sequence','RGI_Emoji_Tag_Sequence','RGI_Emoji_ZWJ_Sequence','RGI_Emoji']);const SYNTAX=new Set('^$\\.*+?()[]{}|');const CLASS_SYNTAX=new Set('()[]{}/-\\|');const RESERVED_PUNCT=new Set('&-!#%,:;<=>@`~');const DOUBLE_PUNCT=new Set('&!#$%*+,.:;<=>?@^`~');const CONTROL={f:12,n:10,r:13,t:9,v:11};const SETS={d:['digit',false],D:['digit',true],s:['space',false],S:['space',true],w:['word',false],W:['word',true]};const ID_START=/^[$_\p{ID_Start}]$/u;const ID_PART=/^[$‌‍\p{ID_Continue}]$/u;const Q_MAX=2147483647;const clampQ=(x)=>Math.min(x,Q_MAX);const isDigit=(c)=>c>='0'&&c<='9';const isOctal=(c)=>c>='0'&&c<='7';const isHex=(c)=>(c>='0'&&c<='9')||(c>='a'&&c<='f')||(c>='A'&&c<='F');const isLetter=(c)=>(c>='a'&&c<='z')||(c>='A'&&c<='Z');const PROPERTY_CACHE=new Map();function validProperty(body,strings){const k=(strings?'v:':'u:')+body;let ok=PROPERTY_CACHE.get(k);if(ok===undefined){try{new RegExp('\\p{'+body+'}',strings?'v':'u');ok=true;}catch{ok=false;}
PROPERTY_CACHE.set(k,ok);}
return ok;}
function parseFlags(flags=''){const raw=String(flags);const out={raw,hasIndices:false,global:false,ignoreCase:false,multiline:false,dotAll:false,unicode:false,unicodeSets:false,sticky:false,error:null};for(let i=0;i<raw.length;i++){const c=raw[i],name=FLAG_NAMES[c];if(!name){out.error={code:'flagInvalid',start:i,end:i+1,params:{flag:c}};break;}
if(out[name]){out.error={code:'flagDuplicate',start:i,end:i+1,params:{flag:c}};break;}
out[name]=true;}
if(!out.error&&out.unicode&&out.unicodeSets){const i=Math.max(raw.indexOf('u'),raw.indexOf('v'));out.error={code:'flagsUV',start:i,end:i+1,params:null};}
if(out.error)out.error.message=MESSAGES[out.error.code];return out;}
function run(src,cfg){const u=cfg.u||cfg.v,v=!!cfg.v,named=cfg.named||u;const n=src.length;let pos=0,seq=0;const groups=[],refs=[],path=[];const fail=(code,start,end=start+1,params=null)=>{throw new RegExpSyntaxError(code,start,Math.min(Math.max(end,start),n),params);};const charAt=(i)=>(u?src.codePointAt(i):src.charCodeAt(i));const size=(c)=>(c>0xffff?2:1);const char=(start,value,escape)=>({type:'Character',start,end:pos,value,escape});function disjunction(){const id=++seq,alts=[];for(let k=0;;k++){path.push([id,k]);alts.push(alternative());path.pop();if(src[pos]!=='|')return alts;pos++;}}
function alternative(){const start=pos,elements=[];while(pos<n&&src[pos]!=='|'&&src[pos]!==')')elements.push(term());return{type:'Alternative',start,end:pos,elements};}
function term(){const start=pos,c=src[pos];let atom,q=1;if(c==='^'||c==='$'){pos++;atom={type:'Assertion',start,end:pos,kind:c==='^'?'start':'end',negate:false};q=0;}else if(c==='\\'&&(src[pos+1]==='b'||src[pos+1]==='B')){pos+=2;atom={type:'Assertion',start,end:pos,kind:'word',negate:src[pos-1]==='B'};q=0;}else if(c==='\\')atom=atomEscape();else if(c==='('){atom=group();if(atom.type==='Lookaround'&&(atom.kind==='lookbehind'||u))q=-1;}else if(c==='.'){pos++;atom={type:'CharacterSet',start,end:pos,kind:'any',negate:false};}else if(c==='[')atom=characterClass();else if(c==='*'||c==='+'||c==='?')fail('nothingToRepeat',start);else if(c==='{'){const b=braces(pos);if(b)fail('nothingToRepeat',start,b.end);if(u)fail('loneQuantifierBracket',start);atom=literal();}else if((c==='}'||c===']')&&u)fail('loneQuantifierBracket',start);else atom=literal();const qs=pos;const quant=quantifier();if(!quant)return atom;if(q===0)fail('nothingToRepeat',qs,pos);if(q<0)fail('invalidQuantifier',qs,pos);return{type:'Quantifier',start,end:pos,qStart:qs,min:quant.min,max:quant.max,greedy:quant.greedy,element:atom};}
function literal(){const start=pos,c=charAt(pos);pos+=size(c);return char(start,c,null);}
function braces(i){let j=i+1;while(isDigit(src[j]))j++;if(j===i+1)return null;const min=+src.slice(i+1,j);let max=min;if(src[j]===','){const k=++j;while(isDigit(src[j]))j++;max=j===k?Infinity:+src.slice(k,j);}
if(src[j]!=='}')return null;return{min,max,end:j+1};}
function quantifier(){const s=pos,c=src[pos];let min,max;if(c==='*'){min=0;max=Infinity;pos++;}
else if(c==='+'){min=1;max=Infinity;pos++;}
else if(c==='?'){min=0;max=1;pos++;}
else if(c==='{'){const b=braces(pos);if(!b){if(u)fail('incompleteQuantifier',s);return null;}
min=b.min;max=b.max;pos=b.end;if(clampQ(min)>clampQ(max))fail('quantifierOrder',s,pos);}else return null;let greedy=true;if(src[pos]==='?'){pos++;greedy=false;}
return{min,max,greedy};}
function group(){const start=pos;pos++;let node;const capture=(name)=>{node={type:'CapturingGroup',start,end:0,index:groups.length+1,name:name?name.name:null,nameStart:name?name.start:-1,nameEnd:name?name.end:-1,alternatives:null};Object.defineProperty(node,'path',{value:path.slice(),enumerable:false});groups.push(node);};if(src[pos]!=='?')capture(null);else{const k=src[pos+1];if(k===':'){pos+=2;node={type:'Group',start,end:0,modifiers:null,alternatives:null};}
else if(k==='='||k==='!'){pos+=2;node={type:'Lookaround',start,end:0,kind:'lookahead',negate:k==='!',alternatives:null};}
else if(k==='<'&&(src[pos+2]==='='||src[pos+2]==='!')){pos+=3;node={type:'Lookaround',start,end:0,kind:'lookbehind',negate:src[pos-1]==='!',alternatives:null};}else if(k==='<'){pos++;capture(groupName());}
else if(k==='i'||k==='m'||k==='s'||k==='-'){pos++;node={type:'Group',start,end:0,modifiers:modifiers(start),alternatives:null};}
else fail('invalidGroup',start,pos+2);}
node.alternatives=disjunction();if(pos>=n)fail('unterminatedGroup',start,n);pos++;node.end=pos;return node;}
function modifiers(start){const seen=new Set(),ms=pos;let add='',remove='',neg=false;for(;;){const c=src[pos];if(c==='i'||c==='m'||c==='s'){if(seen.has(c))fail('repeatedModifier',pos);seen.add(c);if(neg)remove+=c;else add+=c;pos++;}else if(c==='-'&&!neg){neg=true;pos++;}
else if(c===':')break;else fail('invalidGroup',start,pos+1);}
if(neg&&!add&&!remove)fail('invalidModifiers',start,pos+1);const out={add,remove,start:ms,end:pos};pos++;return out;}
function groupName(){const start=pos;pos++;let name='';for(;;){if(pos>=n)fail('invalidGroupName',start,n);if(src[pos]==='>'){if(!name)fail('invalidGroupName',start,pos+1);pos++;break;}
const cs=pos;let c;if(src[pos]==='\\'){pos++;c=src[pos]==='u'?unicodeEscape(true):-1;if(c<0)fail('invalidGroupName',start,cs+2);}else{c=src.codePointAt(pos);pos+=size(c);}
if(!(name?ID_PART:ID_START).test(String.fromCodePoint(c)))fail('invalidGroupName',start,pos);name+=String.fromCodePoint(c);}
return{name,start,end:pos};}
function atomEscape(){const start=pos,c=src[pos+1];if(c===undefined)fail('escapeAtEnd',start,n);if(c>='1'&&c<='9'){let j=pos+1;while(isDigit(src[j]))j++;const num=+src.slice(pos+1,j);if(u||num<=cfg.count){pos=j;const node={type:'Backreference',start,end:pos,ref:num,named:false,groups:[]};refs.push(node);return node;}
pos++;if(c>='8'){pos++;return char(start,c.charCodeAt(0),'identity');}
return char(start,legacyOctal(),'octal');}
if(c==='k'&&named){pos+=2;if(src[pos]!=='<')fail('invalidNamedReference',start,pos);const nm=groupName();const node={type:'Backreference',start,end:pos,ref:nm.name,named:true,nameStart:nm.start,nameEnd:nm.end,groups:[]};refs.push(node);return node;}
return classEscape(start)||characterEscape(start,false);}
function classEscape(start){const c=src[pos+1],k=SETS[c];if(k){pos+=2;return{type:'CharacterSet',start,end:pos,kind:k[0],negate:k[1]};}
if(u&&(c==='p'||c==='P'))return property(start,c==='P');return null;}
function property(start,negate){pos+=2;if(src[pos]!=='{')fail('invalidPropertyName',start,pos);const close=src.indexOf('}',pos);if(close<0)fail('invalidPropertyName',start,n);const body=src.slice(pos+1,close);pos=close+1;const m=/^(?:([A-Za-z_]+)=([A-Za-z0-9_]+)|([A-Za-z0-9_]+))$/.exec(body);if(!m)fail('invalidPropertyName',start,pos);const key=m[1]||null,value=m[1]?m[2]:m[3];const strings=!key&&STRING_PROPERTIES.has(value);if(strings&&(!v||negate))fail('invalidPropertyName',start,pos);if(!validProperty(body,strings))fail('invalidPropertyName',start,pos);return{type:'CharacterSet',start,end:pos,kind:'property',negate,key,value,strings};}
function characterEscape(start,inClass){pos++;const c=src[pos];if(c===undefined)fail('escapeAtEnd',start,n);const ctl=CONTROL[c];if(ctl!==undefined){pos++;return char(start,ctl,'control');}
if(c==='c'){const l=src[pos+1];if(isLetter(l)||(inClass&&!u&&(isDigit(l)||l==='_'))){pos+=2;return char(start,l.charCodeAt(0)%32,'controlLetter');}
if(u)fail('invalidEscape',start,pos+1);return char(start,0x5c,'backslash');}
if(c==='0'&&!isDigit(src[pos+1])){pos++;return char(start,0,'null');}
if(isDigit(c)){if(u)fail(c==='0'?'invalidDecimalEscape':'invalidEscape',start,pos+1);if(c>='8'){pos++;return char(start,c.charCodeAt(0),'identity');}
return char(start,legacyOctal(),'octal');}
if(c==='x'){if(isHex(src[pos+1])&&isHex(src[pos+2])){pos+=3;return char(start,parseInt(src.slice(pos-2,pos),16),'hex');}
if(u)fail('invalidEscape',start,pos+1);pos++;return char(start,0x78,'identity');}
if(c==='u'){const brace=src[pos+1]==='{';const val=unicodeEscape(u);if(val>=0)return char(start,val,brace&&u?'unicodeBrace':'unicode');if(u)fail('invalidUnicodeEscape',start,pos+1);pos++;return char(start,0x75,'identity');}
if(u){if(SYNTAX.has(c)||c==='/'||(inClass&&c==='-')){pos++;return char(start,c.charCodeAt(0),'identity');}
fail('invalidEscape',start,pos+size(charAt(pos)));}
if(c==='k'&&named)fail('invalidEscape',start,pos+1);pos++;return char(start,c.charCodeAt(0),'identity');}
function legacyOctal(){const d=src.charCodeAt(pos)-48;let val=d;pos++;if(isOctal(src[pos])){val=val*8+src.charCodeAt(pos)-48;pos++;if(d<=3&&isOctal(src[pos])){val=val*8+src.charCodeAt(pos)-48;pos++;}}
return val;}
function unicodeEscape(uMode){if(uMode&&src[pos+1]==='{'){let j=pos+2;while(isHex(src[j]))j++;if(j===pos+2||src[j]!=='}')return-1;const val=parseInt(src.slice(pos+2,j),16);if(!(val<=0x10ffff))return-1;pos=j+1;return val;}
const hex4=(i)=>isHex(src[i])&&isHex(src[i+1])&&isHex(src[i+2])&&isHex(src[i+3]);if(!hex4(pos+1))return-1;let val=parseInt(src.slice(pos+1,pos+5),16);pos+=5;if(uMode&&val>=0xd800&&val<=0xdbff&&src[pos]==='\\'&&src[pos+1]==='u'&&hex4(pos+2)){const lo=parseInt(src.slice(pos+2,pos+6),16);if(lo>=0xdc00&&lo<=0xdfff){pos+=6;val=0x10000+((val-0xd800)<<10)+(lo-0xdc00);}}
return val;}
function characterClass(){const start=pos;pos++;const negate=src[pos]==='^';if(negate)pos++;const node={type:'CharacterClass',start,end:0,negate,unicodeSets:v,kind:'union',elements:[]};if(v)classSetContents(node);else classRanges(node);node.end=pos;if(negate&&v&&contentsMayContainStrings(node))fail('negatedClassStrings',start,pos);return node;}
function classRanges(node){const els=node.elements;for(;;){if(pos>=n)fail('unterminatedClass',node.start,n);if(src[pos]===']'){pos++;return;}
const a=classAtom();if(src[pos]==='-'&&pos+1<n&&src[pos+1]!==']'){const dash=pos;pos++;const b=classAtom();if(a.type!=='Character'||b.type!=='Character'){if(u)fail('invalidClassRange',a.start,b.end);els.push(a,{type:'Character',start:dash,end:dash+1,value:0x2d,escape:null},b);}else{if(a.value>b.value)fail('rangeOrder',a.start,b.end);els.push({type:'ClassRange',start:a.start,end:b.end,min:a,max:b});}}else els.push(a);}}
function classAtom(){const start=pos;if(src[pos]!=='\\')return literal();const c=src[pos+1];if(c===undefined)fail('escapeAtEnd',start,n);if(c==='b'){pos+=2;return char(start,8,'backspace');}
if(u&&c==='-'){pos+=2;return char(start,0x2d,'identity');}
return classEscape(start)||characterEscape(start,true);}
function classSetContents(node){const els=node.elements;if(src[pos]===']'){pos++;return;}
const first=operandOrRange(node);els.push(first);const op=src.startsWith('&&',pos)?'&&':src.startsWith('--',pos)?'--':null;if(op){if(first.type==='ClassRange')fail('invalidClassOperation',pos,pos+2);node.kind=op==='&&'?'intersection':'subtraction';for(;;){pos+=2;if(op==='&&'&&src[pos]==='&')fail('invalidClassChar',pos);els.push(operand(node));if(pos>=n)fail('unterminatedClass',node.start,n);if(src[pos]===']'){pos++;return;}
if(!src.startsWith(op,pos))fail('invalidClassOperation',pos,src.startsWith('&&',pos)||src.startsWith('--',pos)?pos+2:pos+1);}}
for(;;){if(pos>=n)fail('unterminatedClass',node.start,n);if(src[pos]===']'){pos++;return;}
if(src.startsWith('&&',pos)||src.startsWith('--',pos))fail('invalidClassOperation',pos,pos+2);els.push(operandOrRange(node));}}
function operandOrRange(node){const a=operand(node);if(src[pos]==='-'&&src[pos+1]!=='-'){if(a.type!=='Character')fail('invalidClassRange',a.start,pos+1);pos++;const b=operand(node);if(b.type!=='Character')fail('invalidClassRange',a.start,b.end);if(a.value>b.value)fail('rangeOrder',a.start,b.end);return{type:'ClassRange',start:a.start,end:b.end,min:a,max:b};}
return a;}
function operand(node){const start=pos;if(pos>=n)fail('unterminatedClass',node.start,n);if(src[pos]==='[')return characterClass();if(src[pos]==='\\'){const d=src[pos+1];if(d===undefined)fail('escapeAtEnd',start,n);if(d==='q'){if(src[pos+2]!=='{')fail('invalidEscape',start,pos+2);return stringDisjunction(node);}
const set=classEscape(start);if(set)return set;}
return classSetCharacter(node);}
function classSetCharacter(node){const start=pos;if(pos>=n)fail('unterminatedClass',node.start,n);const c=src[pos];if(c==='\\'){const d=src[pos+1];if(d===undefined)fail('escapeAtEnd',start,n);if(d==='b'){pos+=2;return char(start,8,'backspace');}
if(RESERVED_PUNCT.has(d)){pos+=2;return char(start,d.charCodeAt(0),'identity');}
return characterEscape(start,true);}
if(DOUBLE_PUNCT.has(c)&&src[pos+1]===c)fail('invalidClassOperation',start,start+2);if(CLASS_SYNTAX.has(c))fail('invalidClassChar',start);return literal();}
function stringDisjunction(node){const start=pos;pos+=3;const alts=[];let s=pos,els=[];for(;;){if(pos>=n)fail('unterminatedClass',node.start,n);const c=src[pos];if(c==='}'||c==='|'){alts.push({type:'ClassString',start:s,end:pos,elements:els});pos++;if(c==='}')break;s=pos;els=[];continue;}
els.push(classSetCharacter(node));}
return{type:'ClassStringDisjunction',start,end:pos,alternatives:alts};}
const alternatives=disjunction();if(pos<n)fail('unmatchedParen',pos);return{ast:{type:'Pattern',start:0,end:n,alternatives},groups,refs};}
function contentsMayContainStrings(cls){const els=cls.elements;if(cls.kind==='intersection')return els.every(mayContainStrings);if(cls.kind==='subtraction')return mayContainStrings(els[0]);return els.some(mayContainStrings);}
function mayContainStrings(e){if(e.type==='CharacterClass')return!e.negate&&contentsMayContainStrings(e);if(e.type==='CharacterSet')return!!e.strings;if(e.type==='ClassStringDisjunction')return e.alternatives.some((a)=>a.elements.length!==1);return false;}
function mightBothParticipate(a,b){const pa=a.path,pb=b.path;for(let i=0;i<pa.length&&i<pb.length;i++){if(pa[i][0]!==pb[i][0])return true;if(pa[i][1]!==pb[i][1])return false;}
return true;}
function finish(res,u){const byName=new Map();for(const g of res.groups){if(g.name==null)continue;const list=byName.get(g.name)||[];for(const o of list)if(mightBothParticipate(o,g))throw new RegExpSyntaxError('duplicateGroupName',g.nameStart,g.nameEnd,{name:g.name});list.push(g);byName.set(g.name,list);}
for(const r of res.refs){if(r.named){const list=byName.get(r.ref);if(!list)throw new RegExpSyntaxError('unknownGroupName',r.start,r.end,{name:r.ref});r.groups=list.map((g)=>g.index);}else{if(u&&r.ref>res.groups.length)throw new RegExpSyntaxError('invalidBackreference',r.start,r.end,{n:r.ref});r.groups=[r.ref];}}
return res;}
function parseRegExp(source,flags=''){const src=String(source);const f=parseFlags(flags);const out={ok:false,source:src,flags:f,ast:null,groups:[],groupCount:0,names:[],error:null};if(f.error){out.error={...f.error,part:'flags'};return out;}
const u=f.unicode,v=f.unicodeSets;let res;try{if(u||v)res=run(src,{u,v,named:true,count:0});else{res=run(src,{u:false,v:false,named:false,count:0});const named=res.groups.some((g)=>g.name!=null);if(named||(res.groups.length&&/\\[1-9]/.test(src)))res=run(src,{u:false,v:false,named,count:res.groups.length});}
finish(res,u||v);}catch(e){if(!(e instanceof RegExpSyntaxError))throw e;out.error={code:e.code,message:e.message,part:'pattern',start:e.start,end:e.end,params:e.params};return out;}
out.ok=true;out.ast=res.ast;out.groups=res.groups;out.groupCount=res.groups.length;out.names=[...new Set(res.groups.filter((g)=>g.name!=null).map((g)=>g.name))];return out;}
function splitLiteral(text){const s=String(text).trim();if(s.length<2||s[0]!=='/')return null;let inClass=false;for(let i=1;i<s.length;i++){const c=s[i];if(c==='\\'){i++;continue;}
if(c==='[')inClass=true;else if(c===']')inClass=false;else if(c==='/'&&!inClass){const flags=s.slice(i+1);if(!/^[a-z]*$/.test(flags)||i===1)return null;return{source:s.slice(1,i).replace(/\\\//g,'/'),flags};}else if(c==='\n'||c==='\r')return null;}
return null;}
function childrenOf(node){switch(node.type){case'Pattern':case'Group':case'CapturingGroup':case'Lookaround':case'ClassStringDisjunction':return node.alternatives;case'Alternative':case'CharacterClass':case'ClassString':return node.elements;case'Quantifier':return[node.element];case'ClassRange':return[node.min,node.max];default:return[];}}
export{childrenOf,parseRegExp,splitLiteral,FLAGS};