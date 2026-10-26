const LONG=new Set(['ā','ī','ū','ṝ','ḹ','e','ai','o','au']);const V_IND={a:'अ','ā':'आ',i:'इ','ī':'ई',u:'उ','ū':'ऊ','ṛ':'ऋ','ṝ':'ॠ','ḷ':'ऌ','ḹ':'ॡ',e:'ए',ai:'ऐ',o:'ओ',au:'औ'};const V_SIGN={a:'','ā':'ा',i:'ि','ī':'ी',u:'ु','ū':'ू','ṛ':'ृ','ṝ':'ॄ','ḷ':'ॢ','ḹ':'ॣ',e:'े',ai:'ै',o:'ो',au:'ौ'};const C_DEVA={k:'क',kh:'ख',g:'ग',gh:'घ','ṅ':'ङ',c:'च',ch:'छ',j:'ज',jh:'झ','ñ':'ञ','ṭ':'ट','ṭh':'ठ','ḍ':'ड','ḍh':'ढ','ṇ':'ण',t:'त',th:'थ',d:'द',dh:'ध',n:'न',p:'प',ph:'फ',b:'ब',bh:'भ',m:'म',y:'य',r:'र',l:'ल',v:'व','ś':'श','ṣ':'ष',s:'स',h:'ह','ḻ':'ळ','ḻh':'ळ्ह',};const MARK={'ṃ':'ं','ḥ':'ः','m̐':'ँ',"'":'ऽ'};const VIRAMA='्',UDATTA='॑',ANUDATTA='॒';const DIGITS='०१२३४५६७८९';const DANDA={'|':'।','||':'॥'};const ACUTE='́',GRAVE='̀';function letters(text){const d=String(text).normalize('NFD');const out=[];for(let i=0;i<d.length;i++){const ch=d[i];if(/[̀-ͯ]/.test(ch)){const last=out[out.length-1];if(!last)continue;if(ch===ACUTE)last.acc='u';else if(ch===GRAVE)last.acc='s';else last.s=(last.s+ch).normalize('NFC');continue;}
out.push({s:ch.toLowerCase(),acc:''});}
for(const l of out)l.s=l.s.normalize('NFC');return out;}
function tokens(text){const L=letters(text);const out=[];for(let i=0;i<L.length;i++){const a=L[i].s,b=L[i+1]?L[i+1].s:'';let acc=L[i].acc;if(a==='|'&&b==='|'){out.push({k:'sp',s:'||',acc:''});i++;continue;}
if((a==='a'&&(b==='i'||b==='u'))&&!L[i+1].acc){out.push({k:'v',s:a+b,acc});i++;continue;}
if((a==='a'&&(b==='i'||b==='u'))&&L[i+1].acc&&!acc){out.push({k:'v',s:a+b,acc:L[i+1].acc});i++;continue;}
if(['k','g','c','j','ṭ','ḍ','t','d','p','b'].includes(a)&&b==='h'){out.push({k:'c',s:a+'h',acc:''});i++;continue;}
if(a==='ḷ'){const prevV=out.length&&out[out.length-1].k==='v';const hNext=b==='h';const nextS=hNext?(L[i+2]?L[i+2].s:''):b;if(prevV&&/^[aāiīuūṛeo]/.test(nextS)){out.push({k:'c',s:hNext?'ḻh':'ḻ',acc:''});if(hNext)i++;continue;}
out.push({k:'v',s:'ḷ',acc});continue;}
if(a==='m'&&b==='̐'){out.push({k:'m',s:'m̐',acc:''});i++;continue;}
if(a==='m̐'){out.push({k:'m',s:'m̐',acc:''});continue;}
if(V_IND[a]){out.push({k:'v',s:a,acc});continue;}
if(C_DEVA[a]){out.push({k:'c',s:a,acc:''});continue;}
if(a==='ṃ'||a==='ṁ'){out.push({k:'m',s:'ṃ',acc:''});continue;}
if(a==='ḥ'){out.push({k:'m',s:'ḥ',acc:''});continue;}
if(a==="'"||a==='’'){out.push({k:'m',s:"'",acc:''});continue;}
out.push({k:'sp',s:a,acc:''});}
return out;}
function vedicMarks(vowels){const n=vowels.length;const m=new Array(n).fill('');for(let i=0;i<n;i++)if(vowels[i].acc==='u')m[i]='U';for(let i=0;i<n;i++){if(vowels[i].acc==='u'){if(i>0&&!m[i-1])m[i-1]='A';if(i+1<n&&!vowels[i+1].acc&&m[i+1]!=='U')m[i+1]='S';}else if(vowels[i].acc==='s'){m[i]='S';if(i>0&&!m[i-1])m[i-1]='A';}}
return m;}
function toDeva(text,{accents=true}={}){const T=tokens(text);const vowels=T.filter((x)=>x.k==='v');const marks=accents?vedicMarks(vowels):vowels.map(()=>'');let vi=0,out='';for(let i=0;i<T.length;i++){const x=T[i],next=T[i+1];if(x.k==='c'){out+=C_DEVA[x.s];if(next&&next.k==='v'){out+=V_SIGN[next.s];const mk=marks[vi++];out+=mk==='A'?ANUDATTA:mk==='S'?UDATTA:'';i++;}else out+=VIRAMA;}else if(x.k==='v'){out+=V_IND[x.s];const mk=marks[vi++];out+=mk==='A'?ANUDATTA:mk==='S'?UDATTA:'';}else if(x.k==='m')out+=MARK[x.s];else if(DANDA[x.s])out+=DANDA[x.s];else if(/[0-9]/.test(x.s))out+=DIGITS[+x.s];else out+=x.s;}
return out;}
const REV_C=Object.fromEntries(Object.entries(C_DEVA).filter(([k])=>k!=='ḻh').map(([k,v])=>[v,k]));const REV_VI=Object.fromEntries(Object.entries(V_IND).map(([k,v])=>[v,k]));const REV_VS=Object.fromEntries(Object.entries(V_SIGN).filter(([k])=>k!=='a').map(([k,v])=>[v,k]));const REV_M=Object.fromEntries(Object.entries(MARK).map(([k,v])=>[v,k]));function fromDeva(text){const s=String(text).replace(/[॒॑]/g,'');let out='';for(let i=0;i<s.length;i++){const ch=s[i];if(REV_C[ch]){out+=REV_C[ch];const n=s[i+1];if(n===VIRAMA){i++;continue;}
if(REV_VS[n]){out+=REV_VS[n];i++;continue;}
out+='a';}else if(REV_VI[ch])out+=REV_VI[ch];else if(REV_M[ch])out+=REV_M[ch];else if(ch==='।')out+='|';else if(ch==='॥')out+='||';else if(DIGITS.includes(ch))out+=String(DIGITS.indexOf(ch));else out+=ch;}
return out;}
function syllables(text){const T=tokens(text).filter((x)=>x.k!=='sp'||x.s===' ');const out=[];let onset='';for(let i=0;i<T.length;i++){const x=T[i];if(x.k==='c'){onset+=x.s;continue;}
if(x.k==='sp'){onset+=onset?'':'';continue;}
if(x.k==='m'){if(out.length){out[out.length-1].text+=x.s;out[out.length-1].coda=true;}continue;}
let j=i+1,cons=0,coda=false;while(j<T.length&&T[j].k!=='v'){if(T[j].k==='c')cons+=T[j].s.length>1&&T[j].s.endsWith('h')&&T[j].s!=='ḻh'?1:T[j].s==='ḻh'?2:1;if(T[j].k==='m'&&T[j].s!=="'")coda=true;j++;}
const last=j>=T.length;const long=LONG.has(x.s);const heavy=long||coda||cons>=2;out.push({text:onset+x.s,v:x.s,acc:x.acc,heavy,why:long?'long':coda?'coda':cons>=2?'cluster':last&&cons===1?'final':'short',coda});onset='';}
if(onset&&out.length)out[out.length-1].text+=onset;return out;}
export{syllables,toDeva,fromDeva};