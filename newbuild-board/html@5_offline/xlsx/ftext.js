import{colIndex,MAX_ROWS,colName}from"./cells.js";const TOKEN=/"(?:[^"]|"")*"|'(?:[^']|'')*'|[A-Za-z_\\][\w.\\]*\s*\(|\$?[A-Za-z]{1,3}\$?\d{1,7}(?![\w(.!])|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}(?![\w(.!])|\$?\d{1,7}:\$?\d{1,7}(?![\w(.])|\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|[A-Za-z_\\][\w.\\]*/g;function mapTokens(text,fn){let out='',last=0,m;TOKEN.lastIndex=0;while((m=TOKEN.exec(text))){out+=text.slice(last,m.index)+fn(m[0]);last=TOKEN.lastIndex;}
return out+text.slice(last);}
function fromFileFormula(text){const s=String(text).replace(/^=/,'');if(!/_xl/i.test(s))return s;return mapTokens(s,(t)=>(/\($/.test(t)?t.replace(/^(_xlfn\.)?(_xlws\.)?/i,''):t));}
function shiftRef(t,dr,dc){let m=/^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(t);if(m){const c=colIndex(m[2])+(m[1]?0:dc),r=+m[4]-1+(m[3]?0:dr);if(c<0||r<0||r>=MAX_ROWS||colIndex(m[2])<0)return'#REF!';return m[1]+colName(c)+m[3]+(r+1);}
if((m=/^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})$/.exec(t))){const a=colIndex(m[2])+(m[1]?0:dc),b=colIndex(m[4])+(m[3]?0:dc);return a<0||b<0?'#REF!':m[1]+colName(a)+':'+m[3]+colName(b);}
if((m=/^(\$?)(\d+):(\$?)(\d+)$/.exec(t))){const a=+m[2]+(m[1]?0:dr),b=+m[4]+(m[3]?0:dr);return a<1||b<1?'#REF!':m[1]+a+':'+m[3]+b;}
return t;}
function shiftFormulaText(text,dr,dc){if(!dr&&!dc)return String(text);return mapTokens(String(text),(t)=>(/^\$?[A-Za-z]{1,3}\$?\d|^\$?[A-Za-z]{1,3}:|^\$?\d+:/.test(t)?shiftRef(t,dr,dc):t));}
export{shiftFormulaText,fromFileFormula};