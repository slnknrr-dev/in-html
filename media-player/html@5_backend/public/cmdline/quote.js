const SAFE={bash:/^[A-Za-z0-9_@%+=:,./-]+$/,cmd:/^[A-Za-z0-9_@+:./\\-]+$/};function quote(arg,shell='bash',{batch=false}={}){let s=String(arg);if(shell==='cmd'){if(batch)s=s.replace(/%/g,'%%');if(s&&SAFE.cmd.test(s))return s;let out='"';let slashes=0;for(const c of s){if(c==='\\'){slashes++;continue;}
if(c==='"'){out+='\\'.repeat(slashes*2)+'""';slashes=0;continue;}
out+='\\'.repeat(slashes)+c;slashes=0;}
return out+'\\'.repeat(slashes*2)+'"';}
if(s&&SAFE.bash.test(s))return s;if(s==='('||s===')')return'\\'+s;return"'"+s.replace(/'/g,"'\\''")+"'";}
export{quote};