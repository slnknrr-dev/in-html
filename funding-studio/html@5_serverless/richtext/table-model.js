function tblCell(src){return{html:{},cs:1,rs:1,m:false,bg:'',align:(src&&src.align)||'',va:(src&&src.va)||'',th:false};}
function tblCreate(rows=3,cols=3){const R=Math.max(1,Math.min(200,Math.floor(+rows)||1));const C=Math.max(1,Math.min(40,Math.floor(+cols)||1));return{rows:Array.from({length:R},()=>Array.from({length:C},()=>tblCell())),cols:Array.from({length:C},()=>({w:null})),};}
function tblInt(v,d=1){const n=Math.floor(+v);return Number.isFinite(n)&&n>=1?n:d;}
function tblNormalize(tb){if(!Array.isArray(tb.rows))tb.rows=[];tb.rows=tb.rows.filter(Array.isArray);if(!tb.rows.length)tb.rows=[[]];if(!Array.isArray(tb.cols))tb.cols=[];const C=Math.max(1,tb.cols.length,...tb.rows.map((r)=>r.length));tb.cols=Array.from({length:C},(_,i)=>{const o=tb.cols[i]&&typeof tb.cols[i]==='object'?tb.cols[i]:{};const w=o.w;return{...o,w:typeof w==='number'&&w>0&&w<=100?w:null};});const R=tb.rows.length;for(const row of tb.rows){for(let c=0;c<C;c++){let x=row[c];if(!x||typeof x!=='object')x=row[c]=tblCell();if(!x.html||typeof x.html!=='object'||Array.isArray(x.html))x.html={};x.cs=tblInt(x.cs);x.rs=tblInt(x.rs);x.m=!!x.m;x.th=!!x.th;for(const k of['bg','align','va'])if(typeof x[k]!=='string')x[k]='';}
row.length=C;}
const cov=Array.from({length:R},()=>new Array(C).fill(false));for(let r=0;r<R;r++){for(let c=0;c<C;c++){const x=tb.rows[r][c];if(cov[r][c]){x.m=true;x.cs=1;x.rs=1;continue;}
x.m=false;let cs=Math.min(x.cs,C-c);let k=0;while(k<cs&&!cov[r][c+k])k++;cs=Math.max(1,k);const rsMax=Math.min(x.rs,R-r);let rs=1;while(rs<rsMax){let free=true;for(let j=0;j<cs;j++)if(cov[r+rs][c+j]){free=false;break;}
if(!free)break;rs++;}
x.cs=cs;x.rs=rs;for(let i=0;i<rs;i++)for(let j=0;j<cs;j++)cov[r+i][c+j]=true;}}
return tb;}
function tblMap(tb){const R=tb.rows.length;const C=tb.cols.length;const map=Array.from({length:R},()=>new Array(C).fill(null));for(let r=0;r<R;r++){for(let c=0;c<C;c++){const x=tb.rows[r][c];if(!x||x.m)continue;for(let i=0;i<x.rs&&r+i<R;i++)for(let j=0;j<x.cs&&c+j<C;j++)if(!map[r+i][c+j])map[r+i][c+j]=[r,c];}}
for(let r=0;r<R;r++)for(let c=0;c<C;c++)if(!map[r][c])map[r][c]=[r,c];return map;}
function tblOrigin(tb,r,c){const m=tblMap(tb);r=Math.max(0,Math.min(tb.rows.length-1,r));c=Math.max(0,Math.min(tb.cols.length-1,c));return m[r][c];}
function tblExpand(tb,r1,c1,r2,c2,map=tblMap(tb)){const R=tb.rows.length;const C=tb.cols.length;const cl=(v,n)=>Math.max(0,Math.min(n-1,Math.floor(+v)||0));let a=Math.min(cl(r1,R),cl(r2,R));let b=Math.min(cl(c1,C),cl(c2,C));let e=Math.max(cl(r1,R),cl(r2,R));let g=Math.max(cl(c1,C),cl(c2,C));let changed=true;while(changed){changed=false;for(let r=a;r<=e;r++){for(let c=b;c<=g;c++){const[or,oc]=map[r][c];const x=tb.rows[or][oc];const er=or+x.rs-1;const ec=oc+x.cs-1;if(or<a){a=or;changed=true;}
if(oc<b){b=oc;changed=true;}
if(er>e){e=er;changed=true;}
if(ec>g){g=ec;changed=true;}}}}
return{r1:a,c1:b,r2:e,c2:g};}
function tblOrigins(tb,rect){const out=[];for(let r=rect.r1;r<=rect.r2;r++){for(let c=rect.c1;c<=rect.c2;c++)if(!tb.rows[r][c].m)out.push([r,c]);}
return out;}
function tblRescale(tb){const ws=tb.cols.map((c)=>c.w);if(!ws.length||ws.some((w)=>typeof w!=='number'))return;const sum=ws.reduce((s,w)=>s+w,0);if(sum<=0)return;let acc=0;tb.cols.forEach((c,i)=>{if(i===tb.cols.length-1)c.w=Math.round((100-acc)*10)/10;else{c.w=Math.round((c.w*100/sum)*10)/10;acc+=c.w;}});}
function tblInsertRow(tb,at){tblNormalize(tb);const R=tb.rows.length;const C=tb.cols.length;at=Math.max(0,Math.min(R,Math.floor(+at)||0));const map=tblMap(tb);const ref=map[at>0?at-1:0];const bumped=new Set();const row=[];for(let c=0;c<C;c++){const[fr,fc]=ref[c];const nc=tblCell(tb.rows[fr][fc]);if(at>0&&at<R){const[or,oc]=map[at][c];if(or<at){nc.m=true;const key=or+':'+oc;if(!bumped.has(key)){tb.rows[or][oc].rs++;bumped.add(key);}}}
row.push(nc);}
tb.rows.splice(at,0,row);return at;}
function tblInsertCol(tb,at){tblNormalize(tb);const R=tb.rows.length;const C=tb.cols.length;at=Math.max(0,Math.min(C,Math.floor(+at)||0));const map=tblMap(tb);const bumped=new Set();for(let r=0;r<R;r++){const[fr,fc]=map[r][at>0?at-1:0];const nc=tblCell(tb.rows[fr][fc]);if(at>0&&at<C){const[or,oc]=map[r][at];if(oc<at){nc.m=true;const key=or+':'+oc;if(!bumped.has(key)){tb.rows[or][oc].cs++;bumped.add(key);}}}
tb.rows[r].splice(at,0,nc);}
const numeric=tb.cols.every((c)=>typeof c.w==='number');tb.cols.splice(at,0,{w:numeric?100/C:null});if(numeric)tblRescale(tb);return at;}
function tblDeleteRows(tb,r1,r2){tblNormalize(tb);const R=tb.rows.length;const C=tb.cols.length;r1=Math.max(0,Math.min(R-1,Math.floor(+r1)||0));r2=Math.max(0,Math.min(R-1,Math.floor(+(r2==null?r1:r2))||0));if(r1>r2)[r1,r2]=[r2,r1];if(r1===0&&r2===R-1)return false;for(let r=0;r<R;r++){for(let c=0;c<C;c++){const x=tb.rows[r][c];if(x.m)continue;const er=r+x.rs-1;if(er<r1||r>r2)continue;const overlap=Math.min(er,r2)-Math.max(r,r1)+1;if(r<r1)x.rs-=overlap;else if(er>r2){Object.assign(tb.rows[r2+1][c],{...x,m:false,rs:er-r2,cs:x.cs});}}}
tb.rows.splice(r1,r2-r1+1);tblNormalize(tb);return true;}
function tblDeleteCols(tb,c1,c2){tblNormalize(tb);const R=tb.rows.length;const C=tb.cols.length;c1=Math.max(0,Math.min(C-1,Math.floor(+c1)||0));c2=Math.max(0,Math.min(C-1,Math.floor(+(c2==null?c1:c2))||0));if(c1>c2)[c1,c2]=[c2,c1];if(c1===0&&c2===C-1)return false;for(let r=0;r<R;r++){for(let c=0;c<C;c++){const x=tb.rows[r][c];if(x.m)continue;const ec=c+x.cs-1;if(ec<c1||c>c2)continue;const overlap=Math.min(ec,c2)-Math.max(c,c1)+1;if(c<c1)x.cs-=overlap;else if(ec>c2)Object.assign(tb.rows[r][c2+1],{...x,m:false,cs:ec-c2,rs:x.rs});}}
for(const row of tb.rows)row.splice(c1,c2-c1+1);tb.cols.splice(c1,c2-c1+1);tblRescale(tb);tblNormalize(tb);return true;}
function tblHasText(s){return typeof s==='string'&&(/\S/.test(s.replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;|\u00a0/g,' '))||/<hr\b/i.test(s));}
function tblMerge(tb,r1,c1,r2,c2){tblNormalize(tb);const rect=tblExpand(tb,r1,c1,r2,c2);const list=tblOrigins(tb,rect);if(list.length<2)return null;const o=tb.rows[rect.r1][rect.c1];const langs=new Set();for(const[r,c]of list)for(const k of Object.keys(tb.rows[r][c].html||{}))langs.add(k);const html={};for(const lang of langs){const parts=list.map(([r,c])=>tb.rows[r][c].html[lang]).filter(tblHasText).map((s)=>(/^\s*<(p|h3|h4|ul|ol|blockquote|pre|hr)\b/i.test(s)?s:`<p>${s}</p>`));if(parts.length)html[lang]=parts.join('');}
for(let r=rect.r1;r<=rect.r2;r++){for(let c=rect.c1;c<=rect.c2;c++){if(r===rect.r1&&c===rect.c1)continue;Object.assign(tb.rows[r][c],tblCell(o),{m:true,th:o.th,bg:o.bg});}}
o.html=html;o.cs=rect.c2-rect.c1+1;o.rs=rect.r2-rect.r1+1;o.m=false;return rect;}
function tblSplit(tb,r,c){tblNormalize(tb);const[or,oc]=tblOrigin(tb,r,c);const o=tb.rows[or][oc];if(o.cs===1&&o.rs===1)return null;const rect={r1:or,c1:oc,r2:or+o.rs-1,c2:oc+o.cs-1};for(let i=rect.r1;i<=rect.r2;i++){for(let j=rect.c1;j<=rect.c2;j++){if(i===or&&j===oc)continue;Object.assign(tb.rows[i][j],tblCell(o),{th:o.th,bg:o.bg});}}
o.cs=1;o.rs=1;return rect;}
function tblSetCells(tb,rect,props){for(const[r,c]of tblOrigins(tb,rect))Object.assign(tb.rows[r][c],props);}
function tblClear(tb,rect,lang){for(const[r,c]of tblOrigins(tb,rect)){const x=tb.rows[r][c];if(!x.html||typeof x.html!=='object')x.html={};x.html[lang]='';}}
function tblDistribute(tb){const n=tb.cols.length;tb.cols.forEach((c,i)=>{c.w=i===n-1?Math.round((100-Math.round(1000/n)/10*(n-1))*10)/10:Math.round(1000/n)/10;});}
function tblNextCell(tb,r,c,dir){const all=tblOrigins(tb,{r1:0,c1:0,r2:tb.rows.length-1,c2:tb.cols.length-1});const[or,oc]=tblOrigin(tb,r,c);const i=all.findIndex(([a,b])=>a===or&&b===oc);const n=all[i+(dir<0?-1:1)];return n||null;}
export{tblNormalize,tblExpand,tblOrigins,tblOrigin,tblInsertRow,tblInsertCol,tblDeleteRows,tblDeleteCols,tblMerge,tblSplit,tblSetCells,tblDistribute,tblClear,tblNextCell,tblRescale,tblCreate};