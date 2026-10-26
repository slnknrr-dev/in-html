import{buildSite,planBackend,readmeText}from"./backend-site.js";import{siteReadme}from"./site-readme.js";function launcher(name){return`#!/usr/bin/env node
// server.mjs - the backend of "${String(name||'Landing').replace(/[\r\n*/]/g,' ')}" (exported by Site Studio; see README.md).
//   node server.mjs [--port 8080] [--host 127.0.0.1] [--log]      Node >= 20
//   bun server.mjs        deno run --allow-net --allow-read --allow-write --allow-env server.mjs
// lib/site.mjs holds the server, the admin console and the site engine (generated; do not edit).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import net from 'node:net';
import tls from 'node:tls';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import site from './lib/site.mjs';

await site.startServer({
  http, fs, path, crypto, zlib, net, tls, Buffer,
  root: path.dirname(fileURLToPath(import.meta.url)),
  argv: process.argv.slice(2),
  env: process.env,
});
`;}
async function archiveFiles(doc,opts={}){const target=opts.target==='backend'||opts.target==='hybrid'?opts.target:'static';const site=await buildSite(doc,{...opts,target});if(target==='static'){const out=site.files.filter((f)=>!f.private).map((f)=>({name:f.path,data:f.data}));if(!out.some((f)=>f.name==='README.md'))out.push({name:'README.md',data:siteReadme(site.doc,'static')});return out;}
if(typeof opts.engine!=='string'||!/export default/.test(opts.engine))throw new Error('the backend engine is not available in this build');const d=site.doc;const created=opts.created||new Date().toISOString();const plan=planBackend(d,target,opts);const build={v:1,target,created,langs:site.page.report.langs,defaultLang:site.page.report.defaultLang,minify:opts.minify!==false,split:!!opts.split,virtual:!!opts.virtual,labels:opts.labels||{},};return[{name:'README.md',data:siteReadme(d,typeof opts.studio==='string'&&opts.studio?'studio':target)+'\n'
+readmeText({name:d.name,target,plan,created,editor:opts.editor}).replace(/^# .*\n/,'## Server details\n')},{name:'server.mjs',data:launcher(d.name)},{name:'lib/site.mjs',data:opts.engine},{name:'data/site.json',data:JSON.stringify(d)},{name:'data/build.json',data:JSON.stringify(build,null,1)+'\n'},...site.files.map((f)=>({name:(f.private?'data/':'public/')+f.path,data:f.data})),{name:'public/.pages.json',data:JSON.stringify((site.pages||[]).filter((p)=>!p.startsWith('private/')))},...(typeof opts.studio==='string'&&opts.studio?[{name:'studio/index.html',data:opts.studio}]:[]),];}
export{archiveFiles};