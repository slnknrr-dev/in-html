import{PAGE_SIZES}from"../paper/base.js";function paperCSS(page={}){const size=PAGE_SIZES[page.size]||PAGE_SIZES.A4;const[mt,mr,mb,ml]=Array.isArray(page.margins)&&page.margins.length===4?page.margins:[20,15,20,25];return`
.ct-sheet{box-sizing:border-box;width:${size.w}mm;min-height:${size.h}mm;padding:${mt}mm ${mr}mm ${mb}mm ${ml}mm;margin:0 auto;background:#fff;color:#111;box-shadow:0 1px 3px rgba(0,0,0,.12),0 8px 28px rgba(0,0,0,.12);color-scheme:light}
.ct-doc{font-family:var(--ct-font);font-size:var(--ct-fs,12pt);line-height:1.42;color:#111;text-align:justify;hyphens:auto;-webkit-hyphens:auto;overflow-wrap:break-word;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.ct-font-serif{--ct-font:"Times New Roman","Liberation Serif","Noto Serif","Noto Serif Georgian","DejaVu Serif",Georgia,serif}
.ct-font-sans{--ct-font:Arial,"Liberation Sans","Noto Sans","Noto Sans Georgian","DejaVu Sans",Helvetica,sans-serif}
.ct-doc p{margin:0 0 .32em}
.ct-title{font-size:1.12em;font-weight:700;text-align:center;margin:0 0 1.1em;letter-spacing:.01em}
.ct-h{font-size:1em;font-weight:700;text-align:center;margin:1em 0 .45em;break-after:avoid;page-break-after:avoid}
.ct-h-ref{text-align:right;margin:0 0 1em;font-size:.95em;line-height:1.3}
.ct-plain .ct-cl p{text-indent:1.25em}
.ct-plain .ct-cl p.ct-split,.ct-cl p.ct-np{text-indent:0}
.ct-cl{orphans:2;widows:2}
.ct-ct{font-weight:700}
.ct-split{display:flex;justify-content:space-between;gap:1em;text-align:left;margin-bottom:1em!important}
.ct-split>span:last-child{text-align:right}
.ct-tab{border-collapse:collapse;width:100%;margin:.35em 0 .55em;font-size:.9em;line-height:1.3;text-align:left}
.ct-tab th,.ct-tab td{border:1px solid #555;padding:2px 5px;vertical-align:top}
.ct-tab th{font-weight:700;background:#f3f3f3}
.ct-tab thead{display:table-header-group}
.ct-tab tr{break-inside:avoid;page-break-inside:avoid}
.ct-tab tfoot td{font-weight:700}
.ct-r{text-align:right;white-space:nowrap}.ct-c{text-align:center;width:2.2em}
.ct-part td{font-style:italic}.ct-note{font-size:.86em;font-weight:400}
.ct-sigs{break-inside:avoid;page-break-inside:avoid;margin-top:1.2em}
.ct-sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.6em;text-align:left}
.ct-sig p{text-align:left}
.ct-app{break-before:page;page-break-before:always;margin-top:2em}
.ct-bi{display:grid;grid-template-columns:1fr 1fr;gap:1.4em}
.ct-bilingual .ct-doc,.ct-bilingual{font-size:calc(var(--ct-fs,12pt) * .9)}
.ct-v{border-radius:2px}
.ct-chips .ct-v[data-f]{background:rgba(37,99,235,.08);box-shadow:inset 0 -1px rgba(37,99,235,.45);cursor:pointer}
.ct-chips .ct-v[data-f]:hover{background:rgba(37,99,235,.18)}
.ct-chips .ct-vb[data-f]{outline:1px dashed rgba(37,99,235,.35);outline-offset:2px;cursor:pointer}
.ct-empty{color:#b45309;background:rgba(245,158,11,.12);box-shadow:inset 0 -1px rgba(217,119,6,.7);font-style:italic;padding:0 2px}
.ct-v.ct-hot,.ct-vb.ct-hot{background:rgba(37,99,235,.28)!important}
.ct-bad-error{box-shadow:inset 0 -2px #dc2626!important;background:rgba(220,38,38,.1)!important}
.ct-bad-warning{box-shadow:inset 0 -2px #d97706!important}
.ct-fb{outline:1px dashed rgba(217,119,6,.7);outline-offset:2px}
.ct-off{opacity:.42}
.ct-off[data-when]::before{content:attr(data-when);display:inline-block;font:11px/1.6 ui-monospace,Consolas,monospace;color:#6b21a8;background:#f3e8ff;border-radius:4px;padding:0 5px;margin:0 0 2px}
.ct-err{color:#b91c1c;background:#fee2e2;font-family:ui-monospace,Consolas,monospace;font-size:.85em}
.ct-cl:target,.ct-sec:target{animation:ct-flash 1.2s ease-out}
@keyframes ct-flash{from{background:rgba(250,204,21,.45)}to{background:transparent}}
@page{size:${size.w}mm ${size.h}mm;margin:${mt}mm ${mr}mm ${mb}mm ${ml}mm}
@media print{
html,body{background:#fff!important}
.ct-sheet{width:auto;min-height:0;padding:0;margin:0;box-shadow:none}
.ct-v,.ct-chips .ct-v[data-f]{background:none!important;box-shadow:none!important;outline:none!important}
.ct-chips .ct-vb[data-f]{outline:none!important}
.ct-empty{color:transparent!important;display:inline-block;min-width:7em;border-bottom:1px solid #000;font-style:normal}
.ct-fb{outline:none}.ct-off{display:none}
}`;}
function formCSS(){return`
.ct-form{display:flex;flex-direction:column;gap:14px;font-size:13.5px}
.ct-fg{border:0;margin:0;padding:0;display:flex;flex-direction:column;gap:10px;min-width:0}
.ct-fg>legend{padding:0 0 4px;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ctf-muted)}
.ct-f{display:flex;flex-direction:column;gap:4px;min-width:0}
.ct-f-l{font-weight:600;font-size:12.5px;display:flex;gap:6px;align-items:baseline}
.ct-f-l .ct-req{color:var(--ctf-danger)}
.ct-f-id{font:11px var(--ctf-mono);color:var(--ctf-faint);margin-left:auto;cursor:pointer;background:none;border:0;padding:0}
.ct-f-help{font-size:11.5px;color:var(--ctf-muted);line-height:1.35}
.ct-f-in,.ct-f select,.ct-f textarea{box-sizing:border-box;width:100%;min-height:32px;padding:5px 8px;border:1px solid var(--ctf-border);border-radius:7px;background:var(--ctf-input);color:var(--ctf-text);font:inherit}
.ct-f textarea{min-height:56px;resize:vertical;line-height:1.4}
.ct-f-in:focus,.ct-f select:focus,.ct-f textarea:focus{outline:none;border-color:var(--ctf-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--ctf-accent) 30%,transparent)}
.ct-f-bad{border-color:var(--ctf-danger)!important}
.ct-f-warnin{border-color:var(--ctf-warn)!important}
.ct-f-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ct-f-row>*{flex:1 1 120px;min-width:0}
.ct-f-row>.ct-f-unit{flex:0 0 auto;color:var(--ctf-muted)}
.ct-f-sub{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px 8px;padding:8px;border:1px solid var(--ctf-border);border-radius:9px;background:var(--ctf-panel2)}
.ct-f-sub .ct-f-wide{grid-column:1/-1}
.ct-f-sub label{display:flex;flex-direction:column;gap:2px;font-size:11.5px;color:var(--ctf-muted);min-width:0}
.ct-f-check{flex-direction:row;align-items:center;gap:8px;font-weight:600}
.ct-f-check input{width:17px;height:17px;margin:0;accent-color:var(--ctf-accent)}
.ct-f-seg{display:inline-flex;gap:2px;padding:2px;border-radius:7px;background:var(--ctf-hover);flex:0 0 auto!important}
.ct-f-seg button{border:0;background:none;padding:3px 10px;border-radius:5px;font:inherit;font-size:12px;color:var(--ctf-muted);cursor:pointer}
.ct-f-seg button[aria-pressed=true]{background:var(--ctf-input);color:var(--ctf-text);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.ct-f-out{padding:5px 8px;border-radius:7px;background:var(--ctf-hover);font-variant-numeric:tabular-nums}
.ct-f-list{display:flex;flex-direction:column;gap:6px}
.ct-f-item{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:6px;align-items:start;padding:6px;border:1px solid var(--ctf-border);border-radius:9px;background:var(--ctf-panel2)}
.ct-f-item>b{font-size:12px;color:var(--ctf-muted);padding-top:7px;text-align:right}
.ct-f-item .ct-f-sub{padding:0;border:0;background:none;grid-template-columns:repeat(auto-fill,minmax(110px,1fr))}
.ct-f-tools{display:flex;flex-direction:column;gap:2px}
.ct-f-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:28px;padding:0 10px;border:1px solid var(--ctf-border);border-radius:7px;background:var(--ctf-input);color:var(--ctf-text);font:inherit;font-size:12px;cursor:pointer}
.ct-f-btn:hover{background:var(--ctf-hover)}
.ct-f-tools .ct-f-btn{min-height:22px;width:24px;padding:0;font-size:11px}
.ct-f-msg{font-size:11.5px;color:var(--ctf-danger)}
.ct-f-msg.ct-w{color:var(--ctf-warn)}
.ct-f-sum{font-size:12px;color:var(--ctf-muted)}
.ct-f.ct-flash{animation:ct-fflash 1.4s ease-out}
@keyframes ct-fflash{from{background:color-mix(in srgb,var(--ctf-accent) 22%,transparent)}to{background:transparent}}`;}
function pageCSS(){return`
:root{--ctf-bg:#eef0f4;--ctf-panel:#fff;--ctf-panel2:#f8f9fb;--ctf-hover:#eef1f5;--ctf-border:#d9dde4;--ctf-text:#1d2330;--ctf-muted:#677083;--ctf-faint:#9aa1ad;--ctf-accent:#2563eb;--ctf-accent-text:#fff;--ctf-danger:#dc2626;--ctf-warn:#b45309;--ctf-input:#fff;--ctf-mono:ui-monospace,Consolas,monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--ctf-bg:#13161b;--ctf-panel:#1b1f26;--ctf-panel2:#20252d;--ctf-hover:#262c35;--ctf-border:#323944;--ctf-text:#e6e9ef;--ctf-muted:#9aa3b2;--ctf-faint:#6f7886;--ctf-accent:#6b96ff;--ctf-accent-text:#0b1220;--ctf-danger:#f87171;--ctf-warn:#fbbf24;--ctf-input:#15191f;color-scheme:dark}}
*{box-sizing:border-box}
body.ctp{margin:0;min-height:100vh;background:var(--ctf-bg);color:var(--ctf-text);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Georgian",sans-serif}
.ctp-top{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 14px;background:color-mix(in srgb,var(--ctf-panel) 92%,transparent);border-bottom:1px solid var(--ctf-border);backdrop-filter:blur(8px)}
.ctp-top h1{margin:0 auto 0 0;font-size:15px;font-weight:650;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctp-mods{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 14px;border-bottom:1px solid var(--ctf-border);background:var(--ctf-panel)}
.ctp-mod{min-height:30px;padding:0 12px;border:1px solid var(--ctf-border);border-radius:999px;background:var(--ctf-input);color:var(--ctf-text);font:inherit;font-size:13px;cursor:pointer}
.ctp-mod[aria-pressed=true]{background:var(--ctf-accent);border-color:var(--ctf-accent);color:var(--ctf-accent-text)}
.ctp-btn{min-height:30px;padding:0 12px;border:1px solid var(--ctf-border);border-radius:8px;background:var(--ctf-input);color:var(--ctf-text);font:inherit;font-size:13px;cursor:pointer}
.ctp-btn:hover,.ctp-mod:hover{filter:brightness(.97)}
.ctp-btn.ctp-primary{background:var(--ctf-accent);border-color:var(--ctf-accent);color:var(--ctf-accent-text)}
.ctp-top select{min-height:30px;border:1px solid var(--ctf-border);border-radius:8px;background:var(--ctf-input);color:var(--ctf-text);font:inherit;padding:0 6px}
.ctp-main{display:grid;grid-template-columns:minmax(300px,400px) minmax(0,1fr);gap:16px;padding:16px;align-items:start}
.ctp-side{position:sticky;top:110px;max-height:calc(100vh - 126px);overflow:auto;padding:14px;border:1px solid var(--ctf-border);border-radius:14px;background:var(--ctf-panel)}
.ctp-stage{min-width:0;overflow:auto;padding:4px 0 24px}
.ctp-issues{margin:0 0 12px;padding:10px 12px;border-radius:10px;background:var(--ctf-panel2);border:1px solid var(--ctf-border);font-size:12.5px}
.ctp-issues ul{margin:6px 0 0;padding-left:18px}.ctp-issues li{cursor:pointer}
.ctp-issues .ctp-e{color:var(--ctf-danger)}.ctp-issues .ctp-w{color:var(--ctf-warn)}
.ctp-hint{margin:0 0 12px;color:var(--ctf-muted);font-size:12.5px}
.ctp-foot{padding:10px 16px 20px;text-align:center;color:var(--ctf-muted);font-size:12px}
.ctp-tabs{display:none}
.ctp-static{padding:16px;overflow:auto}
@media (max-width:900px){
.ctp-main{grid-template-columns:minmax(0,1fr);padding:10px}
.ctp-side{position:static;max-height:none}
.ctp-tabs{display:flex;gap:4px;padding:6px 10px;background:var(--ctf-panel);border-bottom:1px solid var(--ctf-border)}
.ctp-tabs button{flex:1;min-height:32px;border:1px solid var(--ctf-border);border-radius:8px;background:var(--ctf-input);color:var(--ctf-text);font:inherit}
.ctp-tabs button[aria-pressed=true]{background:var(--ctf-accent);color:var(--ctf-accent-text);border-color:var(--ctf-accent)}
.ctp-main[data-tab=form] .ctp-stage,.ctp-main[data-tab=doc] .ctp-side{display:none}
.ctp-stage .ct-sheet{zoom:var(--ctp-zoom,1)}
}
@media print{.ctp-top,.ctp-mods,.ctp-tabs,.ctp-side,.ctp-foot,.ctp-issues,.ctp-hint{display:none!important}.ctp-main{display:block;padding:0}.ctp-stage{padding:0;overflow:visible}.ctp-main[data-tab] .ctp-stage{display:block!important}.ctp-stage .ct-sheet{zoom:1}}`;}
export{pageCSS,formCSS,paperCSS};