const synth=()=>(typeof window!=='undefined'&&window.speechSynthesis)||null;let ready=null;function voicesReady(){if(ready)return ready;ready=new Promise((resolve)=>{const s=synth();if(!s){resolve([]);return;}
const done=()=>resolve(s.getVoices());if(s.getVoices().length){done();return;}
s.addEventListener?.('voiceschanged',done,{once:true});setTimeout(done,1500);});return ready;}
function voiceFor(lang){const s=synth();if(!s)return null;const vs=s.getVoices();const base=lang.split('-')[0];return vs.find((v)=>v.lang===lang)||vs.find((v)=>v.lang.replace('_','-').toLowerCase().startsWith(base+'-'))||vs.find((v)=>v.lang.toLowerCase()===base)||null;}
const canSpeak=(lang)=>!!voiceFor(lang);function speak(text,lang,rate=0.8){const s=synth();const v=voiceFor(lang);if(!s||!v)return false;s.cancel();const u=new SpeechSynthesisUtterance(String(text));u.voice=v;u.lang=v.lang;u.rate=rate;s.speak(u);return true;}
export{canSpeak,speak,voicesReady};