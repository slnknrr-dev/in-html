function words(langs,text){const out=[];let group='';for(const raw of String(text).split('\n')){const line=raw.trim();if(!line)continue;if(line.startsWith('#')){group=line.slice(1).trim();continue;}
const[main,note]=line.split(' // ');const cols=main.split('|').map((s)=>s.trim());const m={};langs.forEach((l,i)=>{if(cols[2+i])m[l]=cols[2+i];});const e={w:cols[0],tr:cols[1]||'',m};if(note)e.note={[langs[0]]:note.trim()};if(group)e.group=group;out.push(e);}
return out;}
function lines(langs,text){return words(langs,text).map((e)=>{const mm=/^([^:：]{1,24})[:：]\s*(.+)$/.exec(e.w);return mm?{...e,who:mm[1].trim(),w:mm[2].trim()}:e;});}
const T=(ru,en)=>(en===undefined?{ru}:{ru,en});export{T,words,lines};