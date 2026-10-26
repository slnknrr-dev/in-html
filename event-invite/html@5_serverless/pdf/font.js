import{standardMetrics,winAnsiCode,standardWidth}from"./standard.js";class TrueTypeFont{constructor(ttf,res){this.kind='truetype';this.ttf=ttf;this.res=res;this.name=ttf.postscriptName;this.ascent=ttf.ascent;this.descent=ttf.descent;this.lineGap=ttf.lineGap;this.capHeight=ttf.capHeight;this.xHeight=ttf.xHeight;this.used=new Map();}
has(cp){return this.ttf.gidFor(cp)>0;}
glyph(cp){return this.ttf.gidFor(cp);}
advance(g){return this.ttf.widthOf(g);}
mark(g,cp){if(!this.used.has(g))this.used.set(g,String.fromCodePoint(cp));}
encode(glyphs){let h='<';for(const g of glyphs)h+=g.toString(16).padStart(4,'0');return h+'>';}}
class StandardFont{constructor(name,res){this.kind='standard';this.name=name;this.res=res;const m=standardMetrics(name);this.ascent=m.ascent;this.descent=m.descent;this.lineGap=0;this.capHeight=m.capHeight;this.xHeight=m.xHeight;this.bbox=m.bbox;this.used=new Map();}
has(cp){return winAnsiCode(cp)>0;}
glyph(cp){return winAnsiCode(cp)||63;}
advance(code){return standardWidth(this.name,code);}
mark(code,cp){if(!this.used.has(code))this.used.set(code,String.fromCodePoint(cp));}
encode(codes){let s='(';for(const b of codes){if(b===0x28||b===0x29||b===0x5c)s+='\\'+String.fromCharCode(b);else if(b<0x20||b>0x7e)s+='\\'+b.toString(8).padStart(3,'0');else s+=String.fromCharCode(b);}
return s+')';}}
const fontList=(f)=>(Array.isArray(f)?f.filter(Boolean):f?[f]:[]);const INVISIBLE=/[\u0000-\u0008\u000a-\u001f\u007f­​-‍⁠﻿]/g;const cleanText=(text)=>String(text??'').normalize('NFC').replace(/\t/g,' ').replace(INVISIBLE,'');function shapeText(text,fonts){const list=fontList(fonts);if(!list.length)throw new Error('PDF: no font to set text with');const runs=[];for(const ch of cleanText(text)){const cp=ch.codePointAt(0);let font=list.find((f)=>f.has(cp))||list[0];const g=font.glyph(cp);const prev=runs[runs.length-1];const w=font.advance(g);if(prev&&prev.font===font){prev.glyphs.push(g);prev.cps.push(cp);prev.width+=w;}
else runs.push({font,glyphs:[g],cps:[cp],width:w});}
return runs;}
function measureText(text,fonts,size=12,{charSpacing=0}={}){let w=0,n=0;for(const r of shapeText(text,fonts)){w+=r.width;n+=r.glyphs.length;}
return(w*size)/1000+charSpacing*n;}
function lineMetrics(fonts,size=12){const list=fontList(fonts);const ascent=Math.max(...list.map((f)=>f.ascent)),descent=Math.min(...list.map((f)=>f.descent));const gap=Math.max(...list.map((f)=>f.lineGap||0));return{ascent:(ascent*size)/1000,descent:(descent*size)/1000,gap:(gap*size)/1000,height:((ascent-descent+gap)*size)/1000};}
export{measureText,shapeText,TrueTypeFont,StandardFont,fontList,lineMetrics};