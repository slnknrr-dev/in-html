import"../xlsx/cells.js";const reCache=new Map();function stopRe(delim){let re=reCache.get(delim);if(!re){re=new RegExp('['+delim.replace(/[\\\]^-]/g,'\\$&')+'\\r\\n]','g');reCache.set(delim,re);}
return re;}
function parseInto(text,start,delim,quote,final,out,maxRows=Infinity){const n=text.length;const D=delim.charCodeAt(0);const Q=quote?quote.charCodeAt(0):-1;const re=stopRe(delim);let i=start;let recStart=i;let row=[];let made=0;while(i<n){let field;if(text.charCodeAt(i)===Q){let seg=i+1;let s='';for(;;){const q=text.indexOf(quote,seg);if(q<0){if(!final)return recStart;s+=text.slice(seg);i=n;break;}
if(q+1>=n&&!final)return recStart;if(text.charCodeAt(q+1)===Q){s+=text.slice(seg,q+1);seg=q+2;continue;}
s+=text.slice(seg,q);i=q+1;break;}
if(i<n){const c=text.charCodeAt(i);if(c!==D&&c!==10&&c!==13){re.lastIndex=i;const m=re.exec(text);const j=m?m.index:n;s+=text.slice(i,j);i=j;}}
field=s;}else{re.lastIndex=i;const m=re.exec(text);const j=m?m.index:n;field=text.slice(i,j);i=j;}
row.push(field);if(i>=n){if(!final)return recStart;out.push(row);row=null;break;}
const c=text.charCodeAt(i);if(c===D){i++;if(i>=n){if(!final)return recStart;row.push('');out.push(row);row=null;break;}
continue;}
if(c===13){if(i+1>=n&&!final)return recStart;i+=text.charCodeAt(i+1)===10?2:1;}else i++;out.push(row);row=[];recStart=i;if(++made>=maxRows)return i;}
return n;}
const stripBOM=(s)=>(s.charCodeAt(0)===0xfeff?s.slice(1):s);function parseCSV(text,{delimiter=',',quote='"',maxRows}={}){const out=[];parseInto(stripBOM(String(text)),0,delimiter,quote,true,out,maxRows);return out;}
export{parseCSV};