const ALL='*';function normalizeGrants(v){const out={};if(Array.isArray(v)){for(const s of v)if(typeof s==='string'&&s)out[s]=[ALL];return out;}
if(!v||typeof v!=='object')return out;for(const[s,a]of Object.entries(v)){if(!s)continue;if(a===true||a===ALL)out[s]=[ALL];else if(Array.isArray(a)){const list=[...new Set(a.filter((x)=>typeof x==='string'&&x))];if(list.length)out[s]=list.includes(ALL)?[ALL]:list;}}
return out;}
const roleMap=(roles)=>(roles instanceof Map?roles:Array.isArray(roles)?new Map(roles.map((r)=>[r.id,r])):new Map(Object.entries(roles||{}).map(([id,r])=>[id,{id,...r}])));function roleChain(roles,id){const map=roleMap(roles);const chain=[],seen=new Set();let cur=id;while(cur!=null&&cur!==''&&!seen.has(cur)){seen.add(cur);const r=map.get(cur);if(!r)break;chain.unshift(r.id);cur=r.parent;}
return chain;}
const addAll=(m,grants)=>{for(const[s,acts]of Object.entries(normalizeGrants(grants))){const set=m.get(s)||new Set();for(const a of acts)set.add(a);m.set(s,set);}};const removeAll=(m,revoke)=>{for(const[s,acts]of Object.entries(normalizeGrants(revoke))){if(acts.includes(ALL)){m.delete(s);continue;}
const set=m.get(s);if(!set)continue;if(set.has(ALL))continue;for(const a of acts)set.delete(a);if(!set.size)m.delete(s);}};function roleGrants(roles,id){const map=roleMap(roles);const out=new Map();for(const rid of roleChain(map,id)){const r=map.get(rid);addAll(out,r.grants??r.sections);removeAll(out,r.revoke);}
return out;}
function explainGrant(roles,id,section,action='view'){const map=roleMap(roles);const trail=[];const m=new Map();let has=false;for(const rid of roleChain(map,id)){const r=map.get(rid);addAll(m,r.grants??r.sections);const afterGrant=can(m,section,action);if(afterGrant&&!has)trail.push({role:rid,change:'grant'});removeAll(m,r.revoke);has=can(m,section,action);if(afterGrant&&!has)trail.push({role:rid,change:'revoke'});}
return{allowed:has,trail};}
function can(grants,section,action='view'){const set=grants instanceof Map?grants.get(section):grants&&grants[section]?new Set(grants[section]):null;return!!set&&(set.has(ALL)||set.has(action));}
const ts=(v)=>(v==null||v===''?null:typeof v==='number'?v:Date.parse(v));const isLive=(expiresAt,now=Date.now())=>{const t=ts(expiresAt);return t==null||Number.isNaN(t)?t==null:t>now;};function memberGrant(member,{roles=[],extra=[],now=Date.now()}={}){const grants=new Map();const lists=[];const lapsed=[];let found=false,roleId=null;if(member){if(isLive(member.expiresAt,now)){found=true;if(member.roleId!=null){if(isLive(member.roleExpiresAt,now)){roleId=member.roleId;for(const[s,a]of roleGrants(roles,member.roleId))grants.set(s,new Set(a));}
else lapsed.push('role');}
if(isLive(member.objectsExpiresAt,now))lists.push(member.objects===undefined?null:member.objects);else{lapsed.push('objects');lists.push([]);}}else lapsed.push('membership');}
for(const g of extra||[]){if(!isLive(g.expiresAt,now)){lapsed.push('grant');continue;}
found=true;addAll(grants,g.grants??g.sections);lists.push(g.objects===undefined?null:g.objects);}
if(!found)return null;const objects=lists.some((l)=>l==null)?null:[...new Set(lists.flat())];return{grants,objects,roleId,lapsed};}
const asMap=(g)=>(g instanceof Map?g:new Map(Object.entries(normalizeGrants(g)).map(([s,a])=>[s,new Set(a)])));function grantsWithin(inner,outer){const a=asMap(inner),b=asMap(outer);for(const[s,acts]of a){const o=b.get(s);if(!o)return false;if(o.has(ALL))continue;for(const x of acts)if(x===ALL||!o.has(x))return false;}
return true;}
function canViewAs(viewer,target,{adminSection='admin'}={}){if(viewer.isOwner)return true;if(!can(asMap(viewer.grants),adminSection,'view'))return false;if(!grantsWithin(target.grants,viewer.grants))return false;if(viewer.objects==null)return true;return target.objects!=null&&target.objects.every((o)=>viewer.objects.includes(o));}
function grantMatrix(roles,sections,actions){const map=roleMap(roles);const out={};for(const id of map.keys()){out[id]={};for(const s of sections){out[id][s]={};for(const a of actions){const e=explainGrant(map,id,s,a);const last=e.trail[e.trail.length-1];out[id][s][a]={allowed:e.allowed,from:e.allowed?last.role:null,revokedAt:!e.allowed&&last?last.role:null};}}}
return out;}
export{normalizeGrants,memberGrant,roleChain,grantMatrix,roleGrants,can,explainGrant,canViewAs,grantsWithin};