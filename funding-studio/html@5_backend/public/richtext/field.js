import{canvas,S}from"../studio/state.js";import{findBlock,getField,setField}from"../studio/doc.js";import{commit}from"../studio/history.js";import{RT_S,sanitizeHTML}from"./sanitize.js";function rtKind(f){return(f&&f.dataset&&f.dataset.kind)||'plain';}
function rtFieldOf(node){const el=node&&(node.nodeType===1?node:node.parentElement);const f=el&&el.closest?el.closest('[data-f]'):null;return f&&f.isContentEditable&&canvas.contains(f)?f:null;}
function rtBid(f){const b=f&&f.closest('[data-bid]');return b?b.dataset.bid:null;}
function rtActive(){const f=RT_S.field;return f&&f.isConnected&&f.isContentEditable?f:null;}
function rtIsUI(el){return!!(el&&el.closest&&el.closest('#ed-format, .rt-pop, #ed-overlays'));}
function rtEl(tag,attrs={},...kids){const el=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(v==null||v===false)continue;if(k==='class')el.className=v;else if(k==='html')el.innerHTML=v;else if(k==='text')el.textContent=v;else if(k.startsWith('on')&&typeof v==='function')el.addEventListener(k.slice(2),v);else el.setAttribute(k,v===true?'':v);}
for(const c of kids)if(c!=null)el.append(c);return el;}
function rtMac(){const n=typeof navigator!=='undefined'?navigator:null;return/Mac|iPhone|iPad|iPod/.test((n&&((n.userAgentData&&n.userAgentData.platform)||n.platform||n.userAgent))||'');}
function rtKey(k,shift=false){return rtMac()?(shift?'⇧':'')+'⌘'+k:'Ctrl+'+(shift?'Shift+':'')+k;}
function rtUp(node,f,pred){for(let a=node&&(node.nodeType===1?node:node.parentNode);a&&a!==f;a=a.parentNode){if(a.nodeType===1&&pred(a))return a;}
return null;}
function rtUnwrap(el){if(el.parentNode)el.replaceWith(...el.childNodes);}
function rtSetRange(r){const sel=getSelection();sel.removeAllRanges();sel.addRange(r);RT_S.range=r.cloneRange();}
function rtCaretEnd(el){const r=document.createRange();r.selectNodeContents(el);r.collapse(false);rtSetRange(r);}
function rtRestoreSel(f){const sel=getSelection();const cur=sel.rangeCount?sel.getRangeAt(0):null;const r=cur&&f.contains(cur.startContainer)&&f.contains(cur.endContainer)?cur.cloneRange():RT_S.range;if(document.activeElement!==f)f.focus({preventScroll:true});if(r&&f.contains(r.startContainer)&&f.contains(r.endContainer))rtSetRange(r);else rtCaretEnd(f);}
function rtCurRange(f){const sel=getSelection();if(sel.rangeCount){const r=sel.getRangeAt(0);if(f.contains(r.startContainer)&&f.contains(r.endContainer))return r;}
const s=RT_S.range;return s&&f.contains(s.startContainer)&&f.contains(s.endContainer)?s:null;}
function rtMark(range){const mk=(k)=>{const s=document.createElement('span');s.setAttribute('data-rt-mark',k);return s;};if(!range.collapsed){const r=range.cloneRange();r.collapse(false);r.insertNode(mk('e'));}
const r=range.cloneRange();r.collapse(true);r.insertNode(mk('s'));}
function rtMarkRange(f){const s=f.querySelector('[data-rt-mark="s"]');const e=f.querySelector('[data-rt-mark="e"]');const r=document.createRange();if(s)r.setStartAfter(s);else r.setStart(f,0);if(e)r.setEndBefore(e);else r.collapse(true);return r;}
function rtLen(n){return n.nodeType===3?n.length:n.childNodes.length;}
function rtDropMark(m){const p=m.parentNode;const prev=m.previousSibling;const next=m.nextSibling;m.remove();if(prev&&prev.nodeType===3){const off=prev.length;if(next&&next.nodeType===3){prev.appendData(next.data);next.remove();}
return[prev,off];}
if(next&&next.nodeType===3)return[next,0];return[p,prev?Array.prototype.indexOf.call(p.childNodes,prev)+1:0];}
function rtUnmark(f,doSelect=true){const s=f.querySelector('[data-rt-mark="s"]');const sp=s?rtDropMark(s):null;const e=f.querySelector('[data-rt-mark="e"]');const ep=e?rtDropMark(e):null;for(const m of f.querySelectorAll('[data-rt-mark]'))m.remove();if(!doSelect)return;const r=document.createRange();if(sp&&sp[0].isConnected&&f.contains(sp[0])){r.setStart(sp[0],Math.min(sp[1],rtLen(sp[0])));if(ep&&ep[0].isConnected&&f.contains(ep[0]))r.setEnd(ep[0],Math.min(ep[1],rtLen(ep[0])));else r.collapse(true);}else{r.selectNodeContents(f);r.collapse(false);}
rtSetRange(r);}
function rtNormalizeEl(f,keepSel){if(!f||!f.isConnected)return;const kind=rtKind(f);if(kind==='plain'){if(f.firstElementChild){f.textContent=sanitizeHTML(f.innerHTML,'plain');if(keepSel&&document.activeElement===f)rtCaretEnd(f);}
return;}
let marked=!!f.querySelector('[data-rt-mark]');if(!marked&&keepSel){const r=rtCurRange(f);if(r){rtMark(r);marked=true;}}
const cur=f.innerHTML;const clean=sanitizeHTML(cur,kind,{marks:marked});if(clean!==cur)f.innerHTML=clean;if(marked)rtUnmark(f,keepSel);}
function rtSchedule(f){const p=RT_S.pend;if(p&&p.f!==f)rtFlush();if(!RT_S.pend)RT_S.pend={f,bid:rtBid(f),path:f.dataset.f,lang:S.lang,kind:rtKind(f),timer:0};clearTimeout(RT_S.pend.timer);RT_S.pend.timer=setTimeout(rtFlush,350);}
function rtFlush(){const p=RT_S.pend;if(!p)return;RT_S.pend=null;clearTimeout(p.timer);rtCommitVal(p.bid,p.path,p.lang,sanitizeHTML(p.f.innerHTML,p.kind),'type',true);}
function rtCommitVal(bid,path,lang,val,label,coalesce){if(!bid||!path)return false;const fb=findBlock(bid);if(!fb)return false;if((getField(fb.block,path,lang)||'')===val)return false;const opts={render:'none'};if(coalesce)opts.coalesce=`field:${bid}:${path}:${lang}`;commit(label,()=>{const x=findBlock(bid);if(x)setField(x.block,path,lang,val);},opts);return true;}
function rtCommitNow(f,label){if(RT_S.pend&&RT_S.pend.f===f){clearTimeout(RT_S.pend.timer);RT_S.pend=null;}else rtFlush();rtCommitVal(rtBid(f),f.dataset.f,S.lang,sanitizeHTML(f.innerHTML,rtKind(f)),label,false);}
export{rtBid,rtCaretEnd,rtFlush,rtEl,rtKey,rtActive,rtKind,rtCurRange,rtUp,rtRestoreSel,rtSetRange,rtMark,rtUnwrap,rtNormalizeEl,rtCommitNow,rtMarkRange,rtSchedule,rtFieldOf,rtIsUI};