function rtNet(R){var hop=Object.prototype.hasOwnProperty;var HNAME=/^[A-Za-z0-9!#$%&'*+.\^_`|~-]{1,64}$/;var res=R.reqRes;var expand=R.reqExpand;R.net=function(raw,q,v,m,body,opt,finish){var url='';try{url=raw?new URL(raw,document.baseURI).href:'';}catch(e){url='';}
if(!/^https?:\/\//i.test(url)){finish(res(false,0,null,'unconfigured'));return;}
if(typeof fetch!=='function'){finish(res(false,0,null,'unsupported'));return;}
if(navigator.onLine===false){finish(res(false,0,null,'offline'));return;}
var hd={};var hs=q.h&&typeof q.h==='object'?q.h:{};for(var n in hs)if(hop.call(hs,n)&&HNAME.test(n))hd[n]=expand(hs[n],v,false).slice(0,2000);var payload;if(m!=='GET'&&body!==undefined){payload=JSON.stringify(body);hd['Content-Type']='application/json';}
if(v.key!=null&&v.key!==''&&(m==='POST'||m==='PUT'||m==='PATCH'))hd['Idempotency-Key']=String(v.key);var tmo=Math.min(60000,Math.max(1000,Number(q.t)||8000));var tries=q.r==null?2:Math.min(5,Math.max(0,Math.floor(Number(q.r))||0));var cred=q.c==='include'||q.c==='same-origin'?q.c:'omit';var n0=0;function attempt(){var fin=false;var timedOut=false;var ac=null;try{ac=new AbortController();}catch(e){ac=null;}
var init={method:m,headers:hd,credentials:cred,cache:'no-store',redirect:'follow'};if(payload!==undefined)init.body=payload;if(ac)init.signal=ac.signal;if(opt.keepalive&&payload!==undefined&&payload.length<60000)init.keepalive=true;function end(r,retryable,wait){if(fin)return;fin=true;clearTimeout(tm);if(retryable&&n0<tries){var ms=Math.min(8000,wait||500*Math.pow(2,n0));n0++;setTimeout(attempt,ms);return;}
finish(r);}
var tm=setTimeout(function(){timedOut=true;if(ac){try{ac.abort();}catch(e){}}
end(res(false,0,null,'timeout'),true);},tmo);var p;try{p=fetch(url,init);}catch(e){end(res(false,0,null,'config'),false);return;}
p.then(function(r){return r.text().then(function(txt){var data=null;if(txt){try{data=JSON.parse(txt);}catch(e){data=txt;}}
if(r.ok){end(res(true,r.status,data,''),false);return;}
var st=r.status;var ra=0;try{ra=Number(r.headers.get('Retry-After'))*1000||0;}catch(e){ra=0;}
end(res(false,st,data,'http'),st>=500||st===429||st===408,ra);});}).catch(function(){end(res(false,0,null,timedOut?'timeout':'network'),true);});}
attempt();};}
export{rtNet};