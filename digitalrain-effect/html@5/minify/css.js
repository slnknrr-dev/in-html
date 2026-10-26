const PUNCT='{}()[];:,>+~=!<*^$|';const isWS=(c)=>/\s/.test(c);function tokenize(src){const toks=[];const n=src.length;let i=0;const fuses=(c)=>c!==undefined&&(/[A-Za-z0-9_\-\\%]/.test(c)||c>'\x7f');while(i<n){const c=src[i];if(isWS(c)){while(i<n&&isWS(src[i]))i++;toks.push({t:'ws',v:' '});continue;}
if(c==='/'&&src[i+1]==='*'){const e=src.indexOf('*/',i+2);i=e<0?n:e+2;const last=toks[toks.length-1];if(last&&last.t==='w'&&fuses(last.v[last.v.length-1])&&fuses(src[i]))toks.push({t:'ws',v:' '});continue;}
if(c==='"'||c==='\''){let j=i+1;while(j<n){const d=src[j];if(d==='\\'){j+=2;continue;}
if(d===c){j++;break;}
if(d==='\n')break;j++;}
toks.push({t:'str',v:src.slice(i,j)});i=j;continue;}
if(PUNCT.includes(c)){toks.push({t:'p',v:c});i++;continue;}
let j=i;while(j<n){const d=src[j];if(d==='\\'){j++;if(/[0-9a-fA-F]/.test(src[j]||'')){let k=0;while(k<6&&/[0-9a-fA-F]/.test(src[j]||'')){j++;k++;}
if(src[j]==='\r'&&src[j+1]==='\n')j+=2;else if(isWS(src[j]||'x'))j++;}else if(j<n)j++;continue;}
if(isWS(d)||PUNCT.includes(d)||d==='"'||d==='\''||(d==='/'&&src[j+1]==='*'))break;j++;}
if(j===i)j++;let v=src.slice(i,j);if(/^url$/i.test(v)&&src[j]==='('){let k=j+1;while(k<n&&isWS(src[k]))k++;if(src[k]!=='"'&&src[k]!=='\''){let e=k;while(e<n&&src[e]!==')')e+=src[e]==='\\'?2:1;v+='('+src.slice(k,e).trim()+')';j=Math.min(e+1,n);}}
toks.push({t:'w',v});i=j;}
return toks;}
function join(toks,mode){let s=0,e=toks.length;while(s<e&&toks[s].t==='ws')s++;while(e>s&&toks[e-1].t==='ws')e--;let out='';let depth=0;for(let k=s;k<e;k++){const tk=toks[k];if(tk.t!=='ws'){if(tk.v==='(')depth++;else if(tk.v===')')depth--;out+=tk.v;continue;}
if(toks[k-1].t==='ws')continue;let m=k+1;while(toks[m].t==='ws')m++;const a=toks[k-1],b=toks[m];const av=a.t==='p'?a.v:'',bv=b.t==='p'?b.v:'';let drop=av==='('||av==='['||av===','||bv===')'||bv===']'||bv===',';if(!drop&&mode==='sel'){drop='>+~='.includes(av||'#')||'>+~='.includes(bv||'#')||('^$|*'.includes(bv||'#')&&toks[m+1]&&toks[m+1].v==='=');}
if(!drop&&mode==='at'){drop='<>='.includes(av||'#')||'<>='.includes(bv||'#')||av===':'||(bv===':'&&depth>0);}
if(!drop&&mode==='val')drop=av==='!'||bv==='!';if(!drop)out+=' ';}
return out;}
function declaration(toks){let k=0;while(k<toks.length&&toks[k].t==='ws')k++;if(k===toks.length)return'';if(toks[k].t==='w'&&toks[k].v[0]==='@')return join(toks,'at');const colon=toks.findIndex((tk)=>tk.t==='p'&&tk.v===':');if(colon<0)return join(toks,'val');const prop=toks.slice(0,colon).filter((tk)=>tk.t!=='ws').map((tk)=>tk.v).join('');const val=join(toks.slice(colon+1),'val');return prop+':'+(val===''&&prop.startsWith('--')?' ':val);}
function minifyCSSStrict(src){const toks=tokenize(String(src));let out='';let seg=[];let paren=0,brack=0;let lastAt=false;for(const tk of toks){if(tk.t==='p'){if(tk.v==='(')paren++;else if(tk.v===')')paren=Math.max(0,paren-1);else if(tk.v==='[')brack++;else if(tk.v===']')brack=Math.max(0,brack-1);else if(paren===0&&brack===0&&(tk.v==='{'||tk.v==='}'||tk.v===';')){if(tk.v==='{'){const first=seg.find((x)=>x.t!=='ws');out+=join(seg,first&&first.t==='w'&&first.v[0]==='@'?'at':'sel')+'{';}else{const d=declaration(seg);if(tk.v===';'){if(d){out+=d+';';lastAt=d[0]==='@';}}else{if(d)out+=d;else if(out.endsWith(';')&&!lastAt)out=out.slice(0,-1);out+='}';}}
seg=[];continue;}}
seg.push(tk);}
out+=declaration(seg);return out;}
function minifyCSS(src){try{return minifyCSSStrict(src);}catch{return String(src);}}
export{minifyCSS};