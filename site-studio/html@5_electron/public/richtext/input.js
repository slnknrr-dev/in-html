import{canvas}from"../studio/state.js";import{RT_ZW,RT_S}from"./sanitize.js";import{rtFlush,rtCaretEnd,rtSetRange,rtSchedule,rtCurRange,rtUp,rtFieldOf,rtKind,rtNormalizeEl,rtIsUI,rtActive,rtRestoreSel}from"./field.js";import{rtCmd,rtRun,rtIndent}from"./ops.js";import{rtSchedUpdate,rtPopClose,rtBuildBar,rtUpdateBar}from"./toolbar.js";import{rtOnPaste,rtOnCopy}from"./clipboard.js";import{tblTab,tblMultiCells,tblClearSel,tblOp,tblOnCellFocus,TBL_S,tblPaint}from"./table-ui.js";import{P}from"../doc/product.js";function rtFields(){return[...canvas.querySelectorAll('[data-f][contenteditable="true"]')].filter((el)=>el.getClientRects().length);}
function rtNextField(f,dir){const all=rtFields();const nx=all[all.indexOf(f)+dir];if(!nx)return;rtFlush();nx.focus({preventScroll:true});rtCaretEnd(nx);nx.scrollIntoView({block:'nearest'});}
function rtInsertBr(f){const sel=getSelection();if(!sel.rangeCount)return;const r=sel.getRangeAt(0);r.deleteContents();const br=document.createElement('br');r.insertNode(br);const rest=document.createRange();rest.setStartAfter(br);rest.setEnd(f,f.childNodes.length);const fr=rest.cloneContents();if(fr.textContent===''&&!fr.querySelector('br'))br.after(document.createElement('br'));const c=document.createRange();c.setStartAfter(br);c.collapse(true);rtSetRange(c);rtSchedule(f);}
function rtSelLi(f){const r=rtCurRange(f);return r?rtUp(r.startContainer,f,(a)=>a.localName==='li'):null;}
function rtOnKeyDown(e){const f=rtFieldOf(e.target);if(!f||e.isComposing||e.keyCode===229)return;const kind=rtKind(f);const mod=e.ctrlKey||e.metaKey;const k=e.key;if(mod&&!e.altKey){const lk=k.length===1?k.toLowerCase():k;const run=(fn)=>{e.preventDefault();if(kind!=='plain')fn();};if(!e.shiftKey&&lk==='b')return run(()=>rtCmd('bold'));if(!e.shiftKey&&lk==='i')return run(()=>rtCmd('italic'));if(!e.shiftKey&&lk==='u')return run(()=>rtCmd('underline'));if(!e.shiftKey&&lk==='k')return run(()=>rtCmd('link'));if(e.shiftKey&&e.code==='KeyX')return run(()=>rtCmd('strike'));if(!e.shiftKey&&e.code==='Period')return run(()=>rtCmd('sup'));if(!e.shiftKey&&e.code==='Comma')return run(()=>rtCmd('sub'));if(e.code==='Backslash')return run(()=>rtCmd('clear'));if(e.shiftKey&&e.code==='Digit7')return run(()=>kind==='rich'&&rtCmd('ol'));if(e.shiftKey&&e.code==='Digit8')return run(()=>kind==='rich'&&rtCmd('ul'));return;}
if(k==='Enter'&&!e.altKey){if(kind==='plain'){e.preventDefault();if(!e.shiftKey)rtNextField(f,1);return;}
if(kind==='inline'){e.preventDefault();rtInsertBr(f);return;}
return;}
if(k==='Tab'&&!e.altKey){if(kind==='rich'&&rtSelLi(f)){e.preventDefault();rtRun((ff,r)=>rtIndent(ff,r,e.shiftKey?-1:1),{need:'rich',multi:false});return;}
if(f.matches('td,th')){e.preventDefault();tblTab(f,e.shiftKey?-1:1);return;}
return;}
if(k==='Escape'){if(tblMultiCells()){e.preventDefault();e.stopPropagation();tblClearSel();return;}
rtFlush();f.blur();return;}
if((k==='Delete'||k==='Backspace')&&tblMultiCells()){e.preventDefault();e.stopPropagation();tblOp('clear');}}
function rtIsBare(f){return!f.querySelector('p,h3,h4,ul,ol,blockquote,pre,hr')&&f.textContent.replace(RT_ZW,'')==='';}
function rtOnBeforeInput(e){const f=rtFieldOf(e.target);if(!f)return;const kind=rtKind(f);const it=e.inputType||'';if(it==='historyUndo'||it==='historyRedo'){e.preventDefault();return;}
if(kind==='plain'&&(it.startsWith('format')||it==='insertParagraph'||it==='insertLineBreak')){e.preventDefault();return;}
if(kind==='inline'){if(it==='insertParagraph'){e.preventDefault();rtInsertBr(f);return;}
if(/^format(Justify|Indent|Outdent|SetBlockTextDirection)/.test(it)){e.preventDefault();return;}}
if(kind==='rich'&&it==='insertText'&&rtIsBare(f)){f.innerHTML='<p><br></p>';const r=document.createRange();r.setStart(f.firstChild,0);r.collapse(true);rtSetRange(r);}}
function rtOnInput(e){const f=rtFieldOf(e.target);if(!f)return;const it=e.inputType||'';if(!RT_S.busy&&(it==='insertFromDrop'||it==='insertFromPaste'||it==='insertReplacementText')){RT_S.busy=true;try{rtNormalizeEl(f,true);}finally{RT_S.busy=false;}}
if(f.classList.contains(P.prefix+'-missing')||f.dataset.rtMissing){f.dataset.rtMissing='1';f.classList.toggle(P.prefix+'-missing',f.textContent.replace(RT_ZW,'').trim()==='');}
rtSchedule(f);rtSchedUpdate();}
function rtOnce(){if(RT_S.once)return;RT_S.once=true;for(const[c,v]of[['defaultParagraphSeparator','p'],['styleWithCSS',false],['enableObjectResizing',false],['enableInlineTableEditing',false],['enableAbsolutePositionEditor',false]]){try{document.execCommand(c,false,v);}catch{}}}
function rtOnFocusIn(e){const tg=e.target;const f=rtFieldOf(tg);if(f){rtOnce();if(RT_S.field!==f)RT_S.range=null;RT_S.field=f;if(f.matches('td[data-r],th[data-r]'))tblOnCellFocus(f);else if(!TBL_S.keep)tblClearSel(true);}else if(!rtIsUI(tg)){RT_S.field=null;RT_S.range=null;if(canvas.contains(tg))tblClearSel(true);}
rtSchedUpdate();}
function rtOnFocusOut(e){const f=rtFieldOf(e.target);if(!f)return;if(e.relatedTarget&&rtIsUI(e.relatedTarget))return;setTimeout(()=>{if(document.activeElement===f||RT_S.busy)return;rtFlush();if(f.isConnected&&!rtIsUI(document.activeElement))rtNormalizeEl(f,false);if(RT_S.field===f&&!rtIsUI(document.activeElement)){RT_S.field=null;RT_S.range=null;}
rtSchedUpdate();},0);}
function rtOnSelChange(){if(RT_S.busy)return;const sel=getSelection();if(sel.rangeCount){const r=sel.getRangeAt(0);const f=rtFieldOf(r.startContainer);if(f&&f===rtFieldOf(r.endContainer)){RT_S.field=f;RT_S.range=r.cloneRange();}}
rtSchedUpdate();}
function rtOnDocDown(e){const p=RT_S.pop;if(p&&!p.el.contains(e.target)&&!p.anchor.contains(e.target))rtPopClose();}
function rtOnDocKey(e){if(e.key==='Escape'&&RT_S.pop){e.preventDefault();rtPopClose();const f=rtActive();if(f)rtRestoreSel(f);}}
function rtInit(){rtBuildBar();if(RT_S.inited)return;RT_S.inited=true;document.addEventListener('selectionchange',rtOnSelChange);document.addEventListener('focusin',rtOnFocusIn);document.addEventListener('focusout',rtOnFocusOut);document.addEventListener('mousedown',rtOnDocDown,true);document.addEventListener('keydown',rtOnDocKey);window.addEventListener('resize',rtPopClose);canvas.addEventListener('beforeinput',rtOnBeforeInput);canvas.addEventListener('input',rtOnInput);canvas.addEventListener('keydown',rtOnKeyDown);canvas.addEventListener('paste',rtOnPaste);canvas.addEventListener('copy',(e)=>rtOnCopy(e,false));canvas.addEventListener('cut',(e)=>rtOnCopy(e,true));document.addEventListener('click',rtSchedUpdate);}
function rtOnRender(){if(RT_S.field&&!RT_S.field.isConnected){RT_S.field=null;RT_S.range=null;}
const ae=document.activeElement&&rtFieldOf(document.activeElement);if(ae)RT_S.field=ae;if(TBL_S.hover&&!TBL_S.hover.cell.isConnected)TBL_S.hover=null;tblPaint();rtUpdateBar();}
export{rtOnRender,rtInit};