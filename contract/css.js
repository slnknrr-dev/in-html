// contract/css.js - stylesheets of contracts: the paper (a sheet of the template's page size with its margins, the
// typography of legal documents, numbered clauses, tables, signature columns, appendices on new pages, bilingual
// columns, placeholder chips on screen and blank lines in print, @page) and the interface of compiled fill-in pages.
//
//   paperCSS(page) -> CSS     page: template.page ({ size, margins: [top, right, bottom, left] mm, font, fontSize })
//   formCSS() -> CSS          the field controls of contract/form.js (ct-f-* classes; --ctf-* tokens)
//   pageCSS() -> CSS          the compiled page shell (ctp-* classes), light and dark
import { PAGE_SIZES } from '../paper/base.js';
//
// CONTRACT of these stylesheets (comments live here because the CSS is a JS template literal; a comment inside the
// literal would ship in every compiled page, and the brief forbids touching literals):
// - Namespaces: ct-* paper (shared by the editor preview and compiled pages), ct-f-* form controls, ctp-* page shell.
//   Single-class selectors (0,1,0) almost everywhere, so rules compose by source order, not by specificity wars.
// - Tokens: paper colours are literal (#111 on #fff) on purpose. A contract is a printed legal document: it must look
//   identical in dark mode, hence `color-scheme:light` on .ct-sheet. Only the UI around it (--ctf-*) follows the theme.
// - !important policy: only for transient state overlays (.ct-hot, .ct-bad-*, .ct-f-bad) that must beat the chip
//   background of `.ct-chips .ct-v[data-f]` (0,3,0), and in @media print to strip every screen-only decoration
//   regardless of which state classes remain on the node.
// - Units: the sheet is sized in mm and typeset in pt (physical units) so screen preview == printed page geometry.
//
// paperCSS notes, rule by rule where non-obvious:
// - .ct-sheet padding == @page margin: on screen the padding draws the margins; in print the padding is reset to 0
//   and @page applies the same margins, so the text block has the same width in both (no reflow at print time).
// - Font stacks list a Georgian-capable face (Noto ... Georgian) before generic fallbacks: Times/Arial have no Mkhedruli
//   glyphs; without it the browser picks a per-glyph fallback with different metrics, ruining justified lines.
// - text-align:justify + hyphens:auto: legal typesetting convention; hyphens needs the <html lang> set by compile.js,
//   otherwise browsers do not hyphenate and justify opens rivers of whitespace.
// - print-color-adjust:exact: keeps table header shading; browsers drop backgrounds in print by default.
// - break-after:avoid on headings + orphans/widows on clauses: a heading is never the last line of a page. Both the
//   modern break-* and legacy page-break-* forms are emitted because WebKit print honoured only the latter for years.
// - thead{display:table-header-group}: repeats the header row on every printed page of a long table.
// - .ct-split margin-bottom !important: beats `.ct-doc p` margin (0,1,1) when the split is a <p>; a specificity bump
//   would have to repeat the parent chain.
// - Chips (.ct-chips .ct-v[data-f]): inset box-shadow underline instead of border/text-decoration: takes no layout space,
//   so toggling chips on/off never reflows the justified text; works across line wraps of an inline element.
// - .ct-empty in print: transparent text over a bottom border = a blank line to fill by hand, keeping the placeholder
//   width (min-width:7em) so short placeholders still leave room to write.
// - .ct-off[data-when]::before shows the condition that disabled a clause (authoring aid); hidden in print.
// - :target flash: links from the issue list jump to a clause; the animation tells the eye where it landed.
//
// Trust boundary: page values are interpolated raw into CSS. That is safe only because every caller passes a
// template through normalizeTemplate (model.js clamps margins to numbers 0..60 and size to PAGE_SIZES keys); calling
// paperCSS with an unnormalized page would allow CSS injection via a margin string.
export function paperCSS(page = {}) {
  const size = PAGE_SIZES[page.size] || PAGE_SIZES.A4;
  const [mt, mr, mb, ml] = Array.isArray(page.margins) && page.margins.length === 4 ? page.margins : [20, 15, 20, 25];
  return `
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
}`;
}

// formCSS notes:
// - min-width:0 on flex/grid children (.ct-fg, .ct-f, row items): flex items default to min-width:auto, so a long
//   unbroken value inside an input would push the sidebar wider than its grid track.
// - <fieldset> reset (border/margin/padding 0, min-width:0): fieldsets have an intrinsic min-width:min-content in
//   most engines, the same overflow bug in a different element.
// - Focus ring via box-shadow + color-mix: follows the accent token in both themes without a second token; outline is
//   removed only because an equally visible replacement is drawn (a11y: never remove focus without one).
// - .ct-f-bad / .ct-f-warnin use !important to beat the :focus border-color (0,2,0) so an invalid field stays red
//   while being edited.
// - .ct-f-sub auto-fill minmax grid: compound fields (address, passport) reflow from 1 to N columns with no media query.
// - Segmented control state is aria-pressed, not a class: one attribute serves both styling and screen readers.
export function formCSS() {
  return `
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
@keyframes ct-fflash{from{background:color-mix(in srgb,var(--ctf-accent) 22%,transparent)}to{background:transparent}}`;
}

// pageCSS notes:
// - Tokens on :root, redefined under prefers-color-scheme:dark; color-scheme set alongside so native controls
//   (select, scrollbars) match. The paper itself opts out (see .ct-sheet above).
// - Sticky header with color-mix(...92%, transparent) + backdrop-filter: content scrolling under it stays faintly
//   visible; without backdrop-filter support it degrades to a near-opaque panel, still legible.
// - .ctp-side sticky top:110px / max-height calc(100vh - 126px): offsets clear the sticky header + modifier bar so
//   the form scrolls independently of the document. The numbers are tuned to the header height, not derived; a
//   wrapped header (many modifiers) overlaps the side panel top. Acceptable: it still scrolls.
// - <=900px: one column, tabs switch form/doc via [data-tab] on .ctp-main (one attribute, CSS does the hiding, so
//   JS never toggles display per element). zoom on the sheet scales the mm-sized page into a phone width; transform
//   would keep the layout box at full width and leave horizontal scroll.
// - Print: every UI part hidden with !important (beats any state), the stage forced visible even if the doc tab
//   was hidden on mobile, zoom reset to 1 so print geometry stays physical.
export function pageCSS() {
  return `
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
@media print{.ctp-top,.ctp-mods,.ctp-tabs,.ctp-side,.ctp-foot,.ctp-issues,.ctp-hint{display:none!important}.ctp-main{display:block;padding:0}.ctp-stage{padding:0;overflow:visible}.ctp-main[data-tab] .ctp-stage{display:block!important}.ctp-stage .ct-sheet{zoom:1}}`;
}
