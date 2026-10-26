import{normalizeFieldDef,normalizeField,sortFields}from"./fields.js";import"./text.js";function resolveSchema(chain,opts={}){const fields=new Map();const values={};const hidden=[];const errors=[];for(const node of chain){for(const raw of node.fields||[]){const{def,errors:errs}=normalizeFieldDef(raw,{inherited:new Set(fields.keys()),types:opts.types});if(!def){errors.push({at:node.id,key:raw&&raw.key,errors:errs});continue;}
if(def.hidden){if(fields.delete(def.key))hidden.push({key:def.key,at:node.id});continue;}
const base=fields.get(def.key);const merged={...(base||{})};const set=[];for(const[k,v]of Object.entries(def))if(v!=null&&k!=='hidden'&&k!=='key'){merged[k]=v;set.push(k);}
merged.key=def.key;merged.origin=base?base.origin:node.id;merged.definedAt=node.id;merged.overridden=!!base;merged.trail=[...(base?base.trail:[]),{at:node.id,set}];fields.set(def.key,merged);}
for(const[k,v]of Object.entries(node.values||{}))values[k]={value:v,from:node.id};}
const list=[...fields.values()].map((m)=>({...normalizeField(m),origin:m.origin,definedAt:m.definedAt,overridden:m.overridden,trail:m.trail}));return{chain:chain.map((n)=>({id:n.id,name:n.name})),fields:sortFields(list),values,hidden,errors};}
function inheritValues(levels){const values={},from={};for(const l of levels){for(const[k,v]of Object.entries(l.values||{})){if(v===undefined)continue;if(v===null){delete values[k];from[k]=l.id;continue;}
values[k]=v;from[k]=l.id;}}
for(const k of Object.keys(from))if(!(k in values))delete from[k];return{values,from};}
export{resolveSchema,inheritValues};