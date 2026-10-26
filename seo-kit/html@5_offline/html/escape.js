const ESC={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};function escapeHTML(s){return s==null?'':String(s).replace(/[&<>"']/g,(c)=>ESC[c]);}
function escapeAttr(s){return s==null?'':String(s).replace(/[&<>"']/g,(c)=>ESC[c]).replace(/\r?\n/g,'&#10;');}
export{escapeAttr,escapeHTML};