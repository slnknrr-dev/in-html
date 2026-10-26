import{buildSite}from"./site.js";import{kbToJSON}from"./model.js";import{singleDocument,staticRoutes,pageDocument,notFoundDocument,jsonScript}from"./pages.js";import{readerCSS}from"./reader-css.js";import{routeFile,sitemapXML,robotsTXT}from"./spa/prerender.js";import{normBase}from"./spa/base.js";import{b64encode,b64decode}from"./codec/base64.js";const toB64=(d)=>(typeof d==='string'?d:b64encode(d));const toBytes=(d)=>(typeof d==='string'?b64decode(d):d);async function exportSingle(kb,{mediaData,readerCode=''}={}){const site=buildSite(kb);const media={};for(const id of Object.keys(site.media)){const d=mediaData?await mediaData(id):null;if(d)media[id]=toB64(d);}
return singleDocument(site,{media,readerCode,css:readerCSS(site)});}
async function exportStatic(kb,{mediaData,readerCode='',style='clean',base='',siteURL=''}={}){const site=buildSite(kb);const files=new Map();for(const route of staticRoutes(site))files.set(routeFile(route,style),pageDocument(site,route,{mode:'static',style}).html);files.set('404.html',notFoundDocument(site,{base:base?normBase(base):'',style}));files.set('_kp/kb.js','window.KP_DATA='+jsonScript({site,style,base:base?normBase(base):''})+';\n');files.set('_kp/kb.css',readerCSS(site));files.set('_kp/reader.js',readerCode);for(const[id,m]of Object.entries(site.media)){const d=mediaData?await mediaData(id):null;if(d)files.set('_kp/media/'+m.f,toBytes(d));}
files.set('.nojekyll','');if(siteURL){files.set('sitemap.xml',sitemapXML(siteURL,site.pages.filter((p)=>!p.hidden&&p.kind!=='redirect').map((p)=>({route:p.slug===site.home?'':p.slug,lastmod:(p.updated||'').slice(0,10)})),style));files.set('robots.txt',robotsTXT(siteURL));}
return files;}
const README=(kb,style,base)=>`# ${kb.title}

A knowledge base made with Knowledge Processor, packaged as a server for Node.js 18 or newer (no dependencies).

    node server.mjs [port] [--host 0.0.0.0] [--data <dir>] [--base ${base}] [--style ${style}] [--token <token>] [--read-only]

- Pages have real URLs (URL style \`${style}\`), unknown pages answer 404, secret ("451") pages stay encrypted and
  are opened in the browser with \`#?451=<password>\`.
- \`data/kb.json\` is the knowledge base, \`data/media/\` its files, \`public/_kp/reader.js\` the reader.
- Editing API (for the Knowledge Processor editor's "Publish to server", or scripts):
  \`GET|PUT <base>_kp/api/kb\`, \`PUT|DELETE <base>_kp/api/media/<id>\` with \`Authorization: Bearer <token>\`;
  the token is \`--token\`, \`KP_TOKEN\` or generated into \`data/token.txt\` on the first start. \`--read-only\` turns
  the API off. Environment: PORT, HOST, DATA_DIR, BASE, KP_TOKEN, SITE_URL (enables sitemap.xml).
`;async function exportServer(kb,{mediaData,readerCode='',serverCode='',style='clean',base='/'}={}){const files=new Map();const b=normBase(base);files.set('server.mjs','#!/usr/bin/env node\n// '+kb.title.replace(/[\r\n]/g,' ')+': knowledge base server (Knowledge Processor; Node >= 18, no dependencies).\n'+"import http from 'node:http';\nimport fs from 'node:fs';\nimport path from 'node:path';\nimport crypto from 'node:crypto';\nimport { fileURLToPath } from 'node:url';\n"+"if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;\n"+serverCode+'\n;globalThis[Symbol.for("bundle:kb-server.js")].main({ http, fs, path, crypto, dir: path.dirname(fileURLToPath(import.meta.url)), argv: process.argv.slice(2), env: process.env });\n');const site=buildSite(kb);const plain=JSON.parse(await kbToJSON(kb,null));for(const[id,m]of Object.entries(plain.media)){if(m.secret)delete plain.media[id];else delete m.data;}
for(const p of plain.pages)for(const s of p.secrets||[]){s.label='';s.route='';}
files.set('data/kb.json',JSON.stringify(plain));files.set('data/server.json',JSON.stringify({base:b,style},null,2)+'\n');for(const[id,m]of Object.entries(site.media)){const d=mediaData?await mediaData(id):null;if(d)files.set('data/media/'+m.f,toBytes(d));}
files.set('public/_kp/reader.js',readerCode);files.set('README.md',README(kb,style,b));return files;}
async function exportJSON(kb,{mediaData}={}){const text=await kbToJSON(kb,async(id)=>{if(kb.media[id]&&kb.media[id].secret)return null;const d=mediaData?await mediaData(id):kb.media[id]&&kb.media[id].data;return d?toB64(d):null;});const v=JSON.parse(text);for(const m of Object.values(v.media))if(m.secret)delete m.data;delete v.remote;return JSON.stringify(v);}
export{exportSingle,exportStatic,exportServer,exportJSON};