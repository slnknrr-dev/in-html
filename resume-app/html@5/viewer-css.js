const RESUME_CSS={blocks:{profile:`
.__P__-pf{display:flex;align-items:center;gap:calc(var(--__P__-gap) * 6mm)}
.__P__-pf-photo{flex:none;display:block;object-fit:cover;background:var(--__P__-tint)}
.__P__-pf-main{flex:1;min-width:0}
.__P__-pf-name{font-size:2.35em;line-height:1.08;letter-spacing:-.01em}
.__P__-pf-title{margin:.3em 0 0;font-size:1.16em;color:var(--__P__-accent);font-weight:500;line-height:1.3}
.__P__-pf-sum{margin-top:.8em}
.__P__-pf-center{flex-direction:column;align-items:center;text-align:center;gap:calc(var(--__P__-gap) * 4mm)}
.__P__-pf-center .__P__-pf-main{width:100%}
.__P__-pf-split{flex-direction:row-reverse}
.__P__-side .__P__-pf{flex-direction:column;gap:calc(var(--__P__-gap) * 3.5mm)}
.__P__-side .__P__-pf:not(.__P__-pf-center){align-items:flex-start}
.__P__-side .__P__-pf-name{font-size:1.7em}
@media screen and (max-width:560px){.__P__-pf:not(.__P__-pf-center),.__P__-pf-split{flex-direction:column;align-items:flex-start}.__P__-pf-name{font-size:1.95em}}
`,contacts:`
.__P__-ct{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.42em}
.__P__-ct-inline{flex-direction:row;flex-wrap:wrap;gap:.35em 1.35em}
.__P__-b[style*="text-align:center"] .__P__-ct-inline{justify-content:center}
.__P__-header:has(.__P__-pf-center) .__P__-ct-inline{justify-content:center}
.__P__-b[style*="text-align:right"] .__P__-ct-inline{justify-content:flex-end}
[dir=rtl] .__P__-b[style*="text-align:right"] .__P__-ct-inline{justify-content:flex-start}[dir=rtl] .__P__-b[style*="text-align:left"] .__P__-ct-inline{justify-content:flex-end}
.__P__-ct-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,15em),1fr));gap:.45em 1.35em}
.__P__-ct-item{display:flex;align-items:flex-start;gap:.5em;min-width:0}
.__P__-ct-ic{color:var(--__P__-accent);margin-top:.14em}
.__P__-ct-t{min-width:0;display:flex;flex-direction:column}
.__P__-ct-k{font-size:.74em;text-transform:uppercase;letter-spacing:.07em;color:var(--__P__-muted);line-height:1.3}
.__P__-ct-v{color:inherit;text-decoration:none;overflow-wrap:break-word;min-width:0}
.__P__-root a.__P__-ct-v{color:inherit;text-decoration:none}
.__P__-root a.__P__-ct-v:hover{color:var(--__P__-accent);text-decoration:underline}
`,timeline:`
.__P__-b-timeline{container-type:inline-size}
.__P__-tl{display:flex;flex-direction:column;gap:calc(var(--__P__-gap) * 3.8mm)}
.__P__-tl-item{display:grid;grid-template-columns:minmax(6.5em,8.6em) minmax(0,1fr);column-gap:1.1em;position:relative;break-inside:avoid}
.__P__-tl-date{color:var(--__P__-muted);font-size:.86em;line-height:1.35;padding-top:.2em;font-variant-numeric:tabular-nums;text-wrap:balance}
.__P__-tl-d{display:inline-block}
.__P__-tl-dur{display:block;opacity:.85;font-size:.92em;margin-top:.12em}
.__P__-tl-head{display:flex;flex-direction:column;gap:.1em}
.__P__-tl-title{font-size:1.04em;line-height:1.3}
.__P__-tl-title a{color:inherit;text-decoration:none}
.__P__-tl-title a:hover{color:var(--__P__-accent);text-decoration:underline}
.__P__-tl-sub{color:var(--__P__-accent);font-weight:600;font-size:.95em}
.__P__-tl-loc{color:var(--__P__-muted);font-weight:400}
.__P__-tl-org:not(:empty)+.__P__-tl-loc:not(:empty)::before{content:"·";margin:0 .45em;color:var(--__P__-muted)}
.__P__-tl-text{margin-top:.38em}
.__P__-tl-tags{display:flex;flex-wrap:wrap;gap:.3em;margin-top:.5em}
.__P__-tl-tags>[data-l]{display:contents}
.__P__-tl-pright .__P__-tl-item{grid-template-columns:minmax(0,1fr) auto}
.__P__-tl-pright .__P__-tl-date{order:2;text-align:end;padding-inline-start:1em}
.__P__-tl-pinline .__P__-tl-item{grid-template-columns:minmax(0,1fr)}
.__P__-tl-pinline .__P__-tl-date{padding:0 0 .15em}
.__P__-tl-pinline .__P__-tl-dur{display:inline;margin-inline-start:.6em}
.__P__-tl-line{gap:0}
.__P__-tl-line .__P__-tl-item{padding:0 0 calc(var(--__P__-gap) * 3.8mm);padding-inline-start:1.5em;margin-inline-start:.42em;border-inline-start:2px solid color-mix(in srgb,var(--__P__-accent) 25%,transparent)}
.__P__-tl-line .__P__-tl-item:last-child{border-inline-start-color:transparent;padding-bottom:0}
.__P__-tl-line .__P__-tl-item::before{content:"";position:absolute;inset-inline-start:calc(-.42em - 1px);top:.3em;width:.84em;height:.84em;border-radius:50%;background:var(--__P__-bg);border:2px solid var(--__P__-accent)}
.__P__-tl-compact{gap:calc(var(--__P__-gap) * 2.2mm)}
.__P__-tl-compact .__P__-tl-item{grid-template-columns:5.8em minmax(0,1fr);column-gap:.8em}
.__P__-tl-compact .__P__-tl-head{flex-direction:row;flex-wrap:wrap;align-items:baseline;column-gap:.55em}
.__P__-tl-compact .__P__-tl-title{font-size:1em}
.__P__-tl-compact .__P__-tl-sub{font-size:.92em}
.__P__-tl-compact .__P__-tl-text{margin-top:.18em;font-size:.95em}
.__P__-tl-cards{gap:calc(var(--__P__-gap) * 2.8mm)}
.__P__-tl-cards .__P__-tl-item{border:1px solid var(--__P__-line);border-radius:var(--__P__-radius);padding:.8em 1em;background:color-mix(in srgb,var(--__P__-accent) 3%,var(--__P__-bg))}
@container (max-width:30em){.__P__-tl .__P__-tl-item{grid-template-columns:minmax(0,1fr)}.__P__-tl .__P__-tl-date{order:0;text-align:start;padding:0 0 .15em}.__P__-tl .__P__-tl-dur{display:inline;margin-inline-start:.6em}}
`,skills:`
.__P__-b-skills{container-type:inline-size}
.__P__-sk-grp+.__P__-sk-grp{margin-top:calc(var(--__P__-gap) * 3.2mm)}
.__P__-sk-g{font-size:.8em;text-transform:uppercase;letter-spacing:.09em;color:var(--__P__-muted);margin:0 0 .5em}
.__P__-sk-grid,.__P__-sk-list{display:grid;grid-template-columns:repeat(var(--__P__-skc,1),minmax(0,1fr));gap:.55em 1.4em}
.__P__-sk-list{list-style:none;margin:0;padding:0;gap:.32em 1.4em}
.__P__-sk-item{min-width:0}
.__P__-sk-bars .__P__-sk-item,.__P__-sk-card{display:flex;flex-direction:column;gap:.3em}
.__P__-sk-dots .__P__-sk-item,.__P__-sk-list .__P__-sk-item{display:flex;align-items:center;gap:.8em}
.__P__-sk-dots .__P__-sk-n,.__P__-sk-list .__P__-sk-n{flex:1;min-width:0}
.__P__-sk-list .__P__-sk-item::before{content:"";flex:none;width:.4em;height:.4em;border-radius:50%;background:var(--__P__-accent);margin-inline-end:-.25em}
.__P__-sk-card{padding:.55em .7em;border:1px solid var(--__P__-line);border-radius:var(--__P__-radius)}
.__P__-sk-card .__P__-sk-n{font-weight:600}
.__P__-sk-tags{display:flex;flex-wrap:wrap;gap:.38em}
.__P__-dots-sm{font-size:.6em;margin-inline-start:.6em}
.__P__-sk-tags .__P__-lv5,.__P__-sk-tags .__P__-lv4{background:color-mix(in srgb,var(--__P__-accent) 20%,transparent)}
@container (max-width:22em){.__P__-sk-grid,.__P__-sk-list{grid-template-columns:minmax(0,1fr)}}
`,languages:`
.__P__-lg{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.5em}
.__P__-lg-item{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;column-gap:.8em}
.__P__-lg-n{font-weight:600}
.__P__-lg-l{color:var(--__P__-muted);font-size:.9em}
.__P__-lg-l b{color:var(--__P__-accent);font-weight:700}
.__P__-lg-note{display:block;flex-basis:100%;font-size:.85em;color:var(--__P__-muted)}
.__P__-lg-bars .__P__-lg-item,.__P__-lg-dots .__P__-lg-item{display:block}
.__P__-lg-top{display:flex;align-items:center;justify-content:space-between;gap:.8em}
.__P__-lg-sub{display:block;font-size:.8em}
.__P__-seg{display:grid;grid-template-columns:repeat(6,1fr);gap:3px;margin-top:.32em}
.__P__-seg>i{height:.36em;border-radius:2px;background:color-mix(in srgb,var(--__P__-accent) 17%,transparent)}
.__P__-seg>i.on{background:var(--__P__-accent)}
.__P__-lgt{border-collapse:collapse;width:100%}
.__P__-lgt th,.__P__-lgt td{text-align:start;padding:.32em 0;padding-inline-end:.7em;border-bottom:1px solid var(--__P__-line);vertical-align:baseline}
.__P__-lgt th{font-weight:600}
.__P__-lgt .__P__-lg-note{font-size:.88em}
.__P__-b-languages{container-type:inline-size}
@container (max-width:22em){.__P__-lg-list .__P__-lg-item{display:grid;grid-template-columns:minmax(0,1fr);row-gap:.05em}.__P__-lg-list .__P__-lg-l{font-size:.85em}}
`,keyvalue:`
.__P__-kv{margin:0;display:grid;grid-template-columns:repeat(var(--__P__-kvc,1),minmax(0,1fr));gap:0 1.6em}
.__P__-kv dt,.__P__-kv dd{margin:0}
.__P__-kv-k{font-weight:600;color:var(--__P__-muted)}
.__P__-kv-table .__P__-kv-row{display:grid;grid-template-columns:minmax(5.5em,38%) minmax(0,1fr);gap:.8em;padding:.34em 0;border-bottom:1px solid var(--__P__-line)}
.__P__-kv-inline .__P__-kv-row{padding:.14em 0}
.__P__-kv-inline dt,.__P__-kv-inline dd{display:inline}
.__P__-kv-inline dt::after{content:":";margin-inline-end:.35em}
.__P__-kv-stacked .__P__-kv-row{padding:.28em 0}
.__P__-kv-stacked dt{font-size:.76em;text-transform:uppercase;letter-spacing:.07em}
@media screen and (max-width:560px){.__P__-kv{grid-template-columns:minmax(0,1fr)}}
`,},deps:{timeline:['chips'],skills:['chips','meter'],languages:['meter']},kaNoCaps:{profile:['.__P__-pf-name','.__P__-pf-title'],contacts:['.__P__-ct-k'],skills:['.__P__-sk-g'],keyvalue:['.__P__-kv-stacked dt']},printKeep:{keyvalue:'.__P__-kv-row',skills:'.__P__-sk-item',languages:'.__P__-lg-item',profile:'.__P__-pf',timeline:'.__P__-tl-item'},classOwner:[[/\.__P__-tl-/,'timeline'],[/\.__P__-sk-/,'skills'],[/\.__P__-(lg|lgt)\b|\.__P__-lg-/,'languages'],[/\.__P__-kv/,'keyvalue'],[/\.__P__-pf/,'profile'],[/\.__P__-ct/,'contacts'],],edit:`.__P__-root[data-mode=edit] .__P__-ct-auto:empty::before{font-style:normal;color:inherit;opacity:.92}
.__P__-root[data-mode=edit] .__P__-pf-photo.__P__-att-missing{min-height:0;padding:0}
.__P__-root[data-mode=edit] .__P__-tl-tags .__P__-f{font-size:.86em;color:var(--__P__-muted)}
.__P__-root[data-mode=edit] .__P__-tl-date:empty{min-height:1em}
`,};export{RESUME_CSS};