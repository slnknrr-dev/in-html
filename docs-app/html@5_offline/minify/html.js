const RAW=new Set(['script','style','textarea','title','xmp']);function tokenizeHTML(src){const toks=[];const n=src.length;let i=0;let text='';const flush=()=>{if(text)toks.push({t:'text',v:text});text='';};while(i<n){const c=src[i];if(c!=='<'){const j=src.indexOf('<',i);text+=src.slice(i,j<0?n:j);i=j<0?n:j;continue;}
if(src.startsWith('\x3C!--',i)){flush();const e=src.indexOf('-->',i+4);const end=e<0?n:e+3;toks.push({t:'comment',v:src.slice(i,end)});i=end;continue;}
if(src.startsWith('<![CDATA[',i)){flush();const e=src.indexOf(']]>',i);const end=e<0?n:e+3;toks.push({t:'cdata',v:src.slice(i,end)});i=end;continue;}
if(src[i+1]==='!'||src[i+1]==='?'){flush();const e=src.indexOf('>',i);const end=e<0?n:e+1;toks.push({t:'doctype',v:src.slice(i,end)});i=end;continue;}
if(src[i+1]==='/'&&/[A-Za-z]/.test(src[i+2]||'')){flush();const e=src.indexOf('>',i);const end=e<0?n:e+1;const m=/^<\/([^\s/>]+)/.exec(src.slice(i,end));toks.push({t:'close',name:m[1].toLowerCase()});i=end;continue;}
if(!/[A-Za-z]/.test(src[i+1]||'')){text+=c;i++;continue;}
flush();let j=i+1;while(j<n&&!/[\s/>]/.test(src[j]))j++;const tag={t:'open',name:src.slice(i+1,j).toLowerCase(),attrs:[],selfClose:false};for(;;){while(j<n&&/[\s/]/.test(src[j])){if(src[j]==='/'&&src[j+1]==='>'){tag.selfClose=true;}
j++;}
if(j>=n||src[j]==='>'){j++;break;}
let k=j;while(k<n&&!/[\s/>=]/.test(src[k]))k++;if(k===j)k++;const name=src.slice(j,k);j=k;while(j<n&&/\s/.test(src[j]))j++;if(src[j]==='='){j++;while(j<n&&/\s/.test(src[j]))j++;const q=src[j];if(q==='"'||q==='\''){const e=src.indexOf(q,j+1);const end=e<0?n:e;tag.attrs.push({name,value:src.slice(j+1,end),quote:q});j=end+1;}else{let e=j;while(e<n&&!/[\s>]/.test(src[e]))e++;tag.attrs.push({name,value:src.slice(j,e),quote:''});j=e;}}else{tag.attrs.push({name,value:null,quote:''});}}
i=j;toks.push(tag);if(RAW.has(tag.name)&&!tag.selfClose){const re=new RegExp('</'+tag.name+'(?=[\\s/>])','i');const m=re.exec(src.slice(i));const end=m?i+m.index:n;toks.push({t:'raw',name:tag.name,v:src.slice(i,end)});i=end;}}
flush();return toks;}
function attr(tag,name){const a=tag.attrs.find((x)=>x.name.toLowerCase()===name);return a?(a.value??''):null;}
export{tokenizeHTML,attr};