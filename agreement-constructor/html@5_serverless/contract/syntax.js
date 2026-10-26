import{parsePipe,parseExpr,refsOf}from"./expr.js";const TOKEN=/\{\{([\s\S]*?)\}\}|\[\[\s*(if|elif|else\s+if|else|end|\/if|\/each|each)\b([\s\S]*?)\]\]/g;const cache=new Map();const MAX_TEXT=40000;function parseText(src){const s=typeof src==='string'?src.slice(0,MAX_TEXT):'';const hit=cache.get(s);if(hit)return hit;const errors=[];const root={body:[]};const stack=[{kind:'root',body:root.body}];const top=()=>stack[stack.length-1];let last=0;TOKEN.lastIndex=0;let m;while((m=TOKEN.exec(s))){if(m.index>last)top().body.push({t:'text',v:s.slice(last,m.index)});last=TOKEN.lastIndex;const raw=m[0];if(m[1]!==undefined){const inner=m[1].trim();if(inner.startsWith('#')){const id=inner.slice(1).trim();if(id===''||/^[A-Za-z_][\w-]*$/.test(id))top().body.push({t:'num',id});else{errors.push({msg:'bad reference',at:m.index});top().body.push({t:'err',src:raw,msg:'bad reference'});}
continue;}
const p=parsePipe(inner);if(p.error){errors.push({msg:p.error,at:m.index});top().body.push({t:'err',src:raw,msg:p.error});}
else top().body.push({t:'ph',src:inner,ast:p.ast,filters:p.filters});continue;}
const kw=m[2].replace(/\s+/g,' ');const arg=(m[3]||'').trim();if(kw==='if'||kw==='each'){let node;if(kw==='if'){const p=parseExpr(arg);if(p.error){errors.push({msg:p.error,at:m.index});}
node={t:'if',branches:[{cond:p.ast,src:arg,body:[]}],els:null};top().body.push(node);stack.push({kind:'if',node,body:node.branches[0].body,at:m.index,open:raw});}else{const em=/^([\s\S]*?)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/.exec(arg);const p=parseExpr(em[1]);if(p.error)errors.push({msg:p.error,at:m.index});node={t:'each',src:em[1],ast:p.ast,as:em[2]||'item',body:[]};top().body.push(node);stack.push({kind:'each',node,body:node.body,at:m.index,open:raw});}
continue;}
const cur=top();if(kw==='elif'||kw==='else if'){if(cur.kind!=='if'||cur.node.els){errors.push({msg:'elif without if',at:m.index});cur.body.push({t:'err',src:raw,msg:'elif without if'});continue;}
const p=parseExpr(arg);if(p.error)errors.push({msg:p.error,at:m.index});const br={cond:p.ast,src:arg,body:[]};cur.node.branches.push(br);cur.body=br.body;continue;}
if(kw==='else'){if(cur.kind!=='if'||cur.node.els){errors.push({msg:'else without if',at:m.index});cur.body.push({t:'err',src:raw,msg:'else without if'});continue;}
cur.node.els=[];cur.body=cur.node.els;continue;}
const want=kw==='/if'?'if':kw==='/each'?'each':null;if(cur.kind==='root'||(want&&cur.kind!==want)){errors.push({msg:'unexpected '+raw,at:m.index});cur.body.push({t:'err',src:raw,msg:'unexpected end'});continue;}
stack.pop();}
if(last<s.length)top().body.push({t:'text',v:s.slice(last)});while(stack.length>1){const b=stack.pop();errors.push({msg:'unclosed '+b.kind,at:b.at});}
const res={nodes:root.body,errors};if(cache.size>2000)cache.clear();cache.set(s,res);return res;}
function textRefs(nodes,out=new Set(),locals=[]){const add=(ast)=>{for(const p of refsOf(ast)){const head=p.split('.')[0];if(!locals.includes(head))out.add(p);}};for(const n of nodes||[]){if(n.t==='ph'){add(n.ast);for(const f of n.filters)for(const a of f.args)add(a);}else if(n.t==='if'){for(const b of n.branches){add(b.cond);textRefs(b.body,out,locals);}
if(n.els)textRefs(n.els,out,locals);}else if(n.t==='each'){add(n.ast);textRefs(n.body,out,[...locals,n.as,'index']);}}
return out;}
export{textRefs,parseText};