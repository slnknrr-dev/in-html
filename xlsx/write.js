// xlsx/write.js - writes the workbook model of xlsx/cells.js as an Office Open XML spreadsheet (.xlsx) that Excel,
// LibreOffice and Google Sheets open: several sheets, shared strings, numbers, booleans, errors, Dates, formulas with
// cached values (spilled results as array formulas), number formats, bold / italic / underline / strike, font and
// fill colours, alignment and wrapping, merged cells, column widths, frozen panes, hyperlinks and hidden sheets.
// Excel recalculates formulas when the file opens (calcPr fullCalcOnLoad).
//
//   writeXLSX(book, { creator, title, level }) -> Promise<Uint8Array>
//   sheetName(name, taken) -> a valid, unique sheet name (31 characters, no []:*?/\)

//
// Strategy: emit the minimal part set every consumer accepts (workbook, sheets, sharedStrings, styles, rels, content
// types, docProps) as strings joined once; no XML DOM. Strings go to the shared string table (smaller files, what
// Excel itself writes); formula results use t="str" inline because their value is recomputed anyway.
// Determinism: the same book yields the same bytes except docProps timestamps, which keeps diffs and tests stable.
import { writeZip } from '../zip/zip.js';
import { escapeXML, escapeXMLAttr } from '../xml/xml.js';
import { CellError, FILE_ERRORS, colName, dateToSerial, formatRange, isRich } from './cells.js';
import { builtinId } from './numfmt.js';
import { toFileFormula } from './ftext.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
// Excel's hard limit per cell; longer text makes Excel "repair" the file and drop content.
const MAX_TEXT = 32767;

// Control characters are not allowed in XML: OOXML escapes them as _xHHHH_ (and a literal "_x" sequence as _x005F_).
// U+FFFE / U+FFFF (noncharacters, also illegal in XML) are included in the class as literal characters.
function escText(s) {
  return escapeXML(String(s).replace(/_(x[0-9A-Fa-f]{4}_)/g, '_x005F_$1').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g,
    (c) => '_x' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') + '_'));
}

// Excel rules: 31 characters, none of []:*?/\, no leading/trailing apostrophe, case-insensitive uniqueness, and
// 'History' is reserved (used by shared-workbook change tracking). Violations make Excel refuse the file.
export function sheetName(name, taken = new Set()) {
  let s = String(name ?? '').replace(/[[\]:*?/\\\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Sheet';
  if (/^history$/i.test(s)) s = 'History 1';
  let out = s, i = 2;
  while (taken.has(out.toLowerCase())) { const suf = ' (' + i++ + ')'; out = s.slice(0, 31 - suf.length) + suf; }
  taken.add(out.toLowerCase());
  return out;
}

const hex8 = (c) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || ''));
  return m ? 'FF' + m[1].toUpperCase() : null;
};

// Style registry: fonts, fills and number formats deduplicated into cellXfs.
// Keys are strings so equal styles from different objects collapse to one xf (Excel caps cellXfs at ~64k).
// The WeakMap short-circuits repeated style objects (a column of cells sharing one s), skipping key building.
// fonts / fills use indexOf: linear, but the lists stay tiny (distinct styles of one workbook).
class Styles {
  constructor() {
    this.fonts = ['b0i0u0s0c'];      // keys; index 0 = default font
    this.fills = ['none', 'gray125']; // required first two fills
    this.numFmts = new Map();        // code -> id (custom ids from 164)
    this.xfs = ['0:0:0::'];          // keys; index 0 = default
    this.xfIndex = new Map([['0:0:0::', 0]]);
    this.cache = new WeakMap();
  }

  fontId(s) {
    const key = `b${s.bold ? 1 : 0}i${s.italic ? 1 : 0}u${s.underline ? 1 : 0}s${s.strike ? 1 : 0}c${hex8(s.color) || ''}`;
    let i = this.fonts.indexOf(key);
    if (i < 0) { i = this.fonts.length; this.fonts.push(key); }
    return i;
  }

  fillId(s) {
    const c = hex8(s.fill);
    if (!c) return 0;
    let i = this.fills.indexOf(c);
    if (i < 0) { i = this.fills.length; this.fills.push(c); }
    return i;
  }

  // Built-in codes reuse their id (no numFmt entry needed); custom ids start at 164, the first id Excel leaves free.
  fmtId(code) {
    if (!code || code === 'General') return 0;
    const b = builtinId(code);
    if (b >= 0) return b;
    let id = this.numFmts.get(code);
    if (id === undefined) { id = 164 + this.numFmts.size; this.numFmts.set(code, id); }
    return id;
  }

  // Index of the cell format for a style object (or a bare number format code for dates).
  id(style, fmt) {
    if (!style && !fmt) return 0;
    if (style && !fmt) { const hit = this.cache.get(style); if (hit !== undefined) return hit; }
    const s = style || {};
    const key = [this.fmtId(fmt || s.fmt), this.fontId(s), this.fillId(s), s.align || '', s.wrap ? 1 : ''].join(':');
    let i = this.xfIndex.get(key);
    if (i === undefined) { i = this.xfs.length; this.xfs.push(key); this.xfIndex.set(key, i); }
    if (style && !fmt) this.cache.set(style, i);
    return i;
  }

  xml() {
    const out = [DECL, `<styleSheet xmlns="${NS}">`];
    if (this.numFmts.size) {
      out.push(`<numFmts count="${this.numFmts.size}">`);
      for (const [code, id] of this.numFmts) out.push(`<numFmt numFmtId="${id}" formatCode="${escapeXMLAttr(code)}"/>`);
      out.push('</numFmts>');
    }
    out.push(`<fonts count="${this.fonts.length}">`);
    for (const k of this.fonts) {
      const m = /^b(\d)i(\d)u(\d)s(\d)c(.*)$/.exec(k);
      out.push('<font>' + (m[1] === '1' ? '<b/>' : '') + (m[2] === '1' ? '<i/>' : '') + (m[4] === '1' ? '<strike/>' : '') + (m[3] === '1' ? '<u/>' : '') +
        '<sz val="11"/>' + (m[5] ? `<color rgb="${m[5]}"/>` : '<color theme="1"/>') + '<name val="Calibri"/><family val="2"/><scheme val="minor"/></font>');
    }
    out.push('</fonts>', `<fills count="${this.fills.length}">`);
    for (const f of this.fills) {
      if (f === 'none' || f === 'gray125') out.push(`<fill><patternFill patternType="${f}"/></fill>`);
      else out.push(`<fill><patternFill patternType="solid"><fgColor rgb="${f}"/><bgColor indexed="64"/></patternFill></fill>`);
    }
    out.push('</fills>', '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>');
    out.push('<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>');
    out.push(`<cellXfs count="${this.xfs.length}">`);
    for (const k of this.xfs) {
      const [fmt, font, fill, align, wrap] = k.split(':');
      const al = align || wrap ? `<alignment${align ? ` horizontal="${align}"` : ''}${wrap ? ' wrapText="1"' : ''}/>` : '';
      out.push(`<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="0" xfId="0"` +
        (fmt !== '0' ? ' applyNumberFormat="1"' : '') + (font !== '0' ? ' applyFont="1"' : '') + (fill !== '0' ? ' applyFill="1"' : '') +
        (al ? ' applyAlignment="1">' + al + '</xf>' : '/>'));
    }
    out.push('</cellXfs>', '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>');
    out.push('<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>');
    return out.join('');
  }
}

const DATE_FMT = 'yyyy-mm-dd';
const DATETIME_FMT = 'yyyy-mm-dd hh:mm:ss';

// Area a formula's array result spilled into (ghost cells { v, sp: formulaCell } to the right / below).
// Dynamic-array spills are written as legacy array formulas (t="array" ref=...) with cached values in every cell:
// opened in any version the results are visible, and Excel recalculates the same area.
function spillArea(rows, r, c, cell) {
  let w = 1, h = 1;
  while (isRich(rows[r][c + w]) && rows[r][c + w].sp === cell) w++;
  while (rows[r + h] && isRich(rows[r + h][c]) && rows[r + h][c].sp === cell) h++;
  return h > 1 || w > 1 ? { h, w } : null;
}

function sheetXML(sheet, sst, styles, selected) {
  const out = [DECL, `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">`];
  const rows = sheet.rows || [];
  let maxC = 0, maxR = 0;
  for (let r = 0; r < rows.length; r++) if (rows[r] && rows[r].length) { maxR = r + 1; if (rows[r].length > maxC) maxC = rows[r].length; }
  out.push(`<dimension ref="${maxR && maxC ? formatRange({ r1: 0, c1: 0, r2: maxR - 1, c2: maxC - 1 }) : 'A1'}"/>`);
  // view: selection and frozen panes
  const fr = sheet.freeze || {};
  const fRows = Math.max(0, fr.rows | 0), fCols = Math.max(0, fr.cols | 0);
  out.push(`<sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ''}>`);
  if (fRows || fCols) {
    const pane = fRows && fCols ? 'bottomRight' : fRows ? 'bottomLeft' : 'topRight';
    out.push(`<pane${fCols ? ` xSplit="${fCols}"` : ''}${fRows ? ` ySplit="${fRows}"` : ''} topLeftCell="${colName(fCols)}${fRows + 1}" activePane="${pane}" state="frozen"/>`);
    out.push(`<selection pane="${pane}" activeCell="${colName(fCols)}${fRows + 1}" sqref="${colName(fCols)}${fRows + 1}"/>`);
  }
  out.push('</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>');
  // column widths (runs of equal widths)
  const cols = sheet.cols || [];
  const colRuns = [];
  for (let c = 0; c < cols.length; c++) {
    const k = cols[c];
    if (!k || !(k.width > 0 || k.hidden)) continue;
    const w = k.width > 0 ? Math.min(255, Math.round(k.width * 100) / 100) : 8.43;
    const last = colRuns[colRuns.length - 1];
    if (last && last.max === c && last.w === w && last.hidden === !!k.hidden) last.max = c + 1;
    else colRuns.push({ min: c + 1, max: c + 1, w, hidden: !!k.hidden });
  }
  if (colRuns.length) {
    out.push('<cols>');
    for (const r of colRuns) out.push(`<col min="${r.min}" max="${r.max}" width="${r.w}" customWidth="1"${r.hidden ? ' hidden="1"' : ''}/>`);
    out.push('</cols>');
  }
  const colFmt = cols.map((k) => (k && k.fmt) || null);
  out.push('<sheetData>');
  const links = [];
  const names = [];
  for (let c = 0; c < maxC; c++) names.push(colName(c));
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length) continue;
    const rn = r + 1;
    const parts = [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell == null) continue;
      let v = cell, f = null, st = null, link = null, arr = null;
      if (isRich(cell)) {
        v = cell.v === undefined ? null : cell.v;
        st = cell.s || null;
        if (cell.f != null && cell.f !== '' && !cell.sp) {
          f = String(cell.f).replace(/^=/, '');
          arr = spillArea(rows, r, c, cell);
        }
        link = cell.link || null;
      }
      const wasDate = v instanceof Date;
      // Dates are taken as local wall-clock time: what the user saw in a date picker is what Excel shows.
      if (wasDate) v = Number.isNaN(v.getTime()) ? null : dateToSerial(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds()));
      if (link) links.push({ ref: names[c] + rn, link });
      let dateFmt = null;
      if (wasDate && v !== null) dateFmt = v % 1 ? DATETIME_FMT : DATE_FMT;
      // a column's default number format applies to its numbers (text keeps the plain style)
      const s = styles.id(st, st && st.fmt ? null : dateFmt || (typeof v === 'number' ? colFmt[c] : null) || null);
      const ref = names[c] + rn;
      const sa = s ? ` s="${s}"` : '';
      let fx = '';
      if (f) fx = arr ? `<f t="array" ref="${ref}:${names[c + arr.w - 1] || colName(c + arr.w - 1)}${rn + arr.h - 1}">${escapeXML(toFileFormula(f))}</f>` : `<f>${escapeXML(toFileFormula(f))}</f>`;
      if (typeof v === 'number') {
        if (Number.isFinite(v)) parts.push(`<c r="${ref}"${sa}>${fx}<v>${v}</v></c>`);
        else parts.push(`<c r="${ref}"${sa} t="e">${fx}<v>#NUM!</v></c>`);
      } else if (typeof v === 'string') {
        const text = v.length > MAX_TEXT ? v.slice(0, MAX_TEXT) : v;
        if (f) parts.push(`<c r="${ref}"${sa} t="str">${fx}<v>${escText(text)}</v></c>`);
        else {
          let i = sst.map.get(text);
          if (i === undefined) { i = sst.list.length; sst.list.push(text); sst.map.set(text, i); }
          sst.count++;
          parts.push(`<c r="${ref}"${sa} t="s"><v>${i}</v></c>`);
        }
      } else if (typeof v === 'boolean') parts.push(`<c r="${ref}"${sa} t="b">${fx}<v>${v ? 1 : 0}</v></c>`);
      else if (v instanceof CellError) {
        // Engine-only errors (#CIRC!, #ERROR!) do not exist in the file format and would make Excel repair the file.
        const code = FILE_ERRORS.includes(v.code) ? v.code : f ? '#VALUE!' : '#N/A';
        parts.push(`<c r="${ref}"${sa} t="e">${fx}<v>${code}</v></c>`);
      } else if (f) parts.push(`<c r="${ref}"${sa}>${fx}</c>`);
      else if (s) parts.push(`<c r="${ref}"${sa}/>`);
    }
    if (parts.length) out.push(`<row r="${rn}">`, ...parts, '</row>');
  }
  out.push('</sheetData>');
  const merges = (sheet.merges || []).filter((g) => g && (g.r2 > g.r1 || g.c2 > g.c1));
  if (merges.length) {
    out.push(`<mergeCells count="${merges.length}">`);
    for (const g of merges) out.push(`<mergeCell ref="${formatRange(g)}"/>`);
    out.push('</mergeCells>');
  }
  const rels = [];
  if (links.length) {
    out.push('<hyperlinks>');
    for (const l of links) {
      const s = String(l.link);
      if (s.startsWith('#')) out.push(`<hyperlink ref="${l.ref}" location="${escapeXMLAttr(s.slice(1))}" display="${escapeXMLAttr(s.slice(1))}"/>`);
      else {
        const id = 'rId' + (rels.length + 1);
        rels.push(`<Relationship Id="${id}" Type="${REL}hyperlink" Target="${escapeXMLAttr(s)}" TargetMode="External"/>`);
        out.push(`<hyperlink ref="${l.ref}" r:id="${id}"/>`);
      }
    }
    out.push('</hyperlinks>');
  }
  out.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>');
  return { xml: out.join(''), rels };
}

// The active tab must be a visible sheet (Excel refuses a hidden active sheet), so the first visible one is chosen and
// is never written as hidden. fullCalcOnLoad: cached values may come from a different engine; Excel recomputes.
export async function writeXLSX(book, { creator = 'Sheets', title = '', level } = {}) {
  const taken = new Set();
  const sheets = (book.sheets || []).length ? book.sheets : [{ name: 'Sheet1', rows: [] }];
  const names = sheets.map((s) => sheetName(s.name, taken));
  const styles = new Styles();
  const sst = { list: [], map: new Map(), count: 0 };
  let active = sheets.findIndex((s) => !s.hidden);
  if (active < 0) active = 0;
  const files = [];
  const parts = sheets.map((s, i) => sheetXML(s, sst, styles, i === active));
  parts.forEach((p, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: p.xml });
    if (p.rels.length) files.push({ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: `${DECL}<Relationships xmlns="${NS_PR}">${p.rels.join('')}</Relationships>` });
  });
  const ssx = [DECL, `<sst xmlns="${NS}" count="${sst.count}" uniqueCount="${sst.list.length}">`];
  // xml:space="preserve" only when needed: without it XML consumers may strip leading/trailing whitespace.
  for (const s of sst.list) ssx.push(/^\s|\s$|\n/.test(s) ? `<si><t xml:space="preserve">${escText(s)}</t></si>` : `<si><t>${escText(s)}</t></si>`);
  ssx.push('</sst>');
  files.push({ name: 'xl/sharedStrings.xml', data: ssx.join('') });
  files.push({ name: 'xl/styles.xml', data: styles.xml() });
  const wb = [DECL, `<workbook xmlns="${NS}" xmlns:r="${NS_R}"><workbookPr defaultThemeVersion="164011"/>`,
    `<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12300" activeTab="${active}"/></bookViews><sheets>`];
  names.forEach((n, i) => wb.push(`<sheet name="${escapeXMLAttr(n)}" sheetId="${i + 1}"${sheets[i].hidden && i !== active ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`));
  wb.push('</sheets>');
  const defined = (book.names || []).filter((n) => n && /^[A-Za-z_\\][\w.\\]*$/.test(n.name) && n.ref);
  if (defined.length) {
    wb.push('<definedNames>');
    for (const n of defined) wb.push(`<definedName name="${escapeXMLAttr(n.name)}">${escapeXML(toFileFormula(String(n.ref)))}</definedName>`);
    wb.push('</definedNames>');
  }
  wb.push('<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
  files.push({ name: 'xl/workbook.xml', data: wb.join('') });
  const wbRels = [DECL, `<Relationships xmlns="${NS_PR}">`];
  names.forEach((n, i) => wbRels.push(`<Relationship Id="rId${i + 1}" Type="${REL}worksheet" Target="worksheets/sheet${i + 1}.xml"/>`));
  const k = names.length;
  wbRels.push(`<Relationship Id="rId${k + 1}" Type="${REL}styles" Target="styles.xml"/>`);
  wbRels.push(`<Relationship Id="rId${k + 2}" Type="${REL}sharedStrings" Target="sharedStrings.xml"/>`);
  wbRels.push('</Relationships>');
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: wbRels.join('') });
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files.push({ name: 'docProps/core.xml', data: `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${title ? `<dc:title>${escapeXML(title)}</dc:title>` : ''}<dc:creator>${escapeXML(creator)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` });
  files.push({ name: 'docProps/app.xml', data: `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>${escapeXML(creator)}</Application></Properties>` });
  files.push({ name: '_rels/.rels', data: `${DECL}<Relationships xmlns="${NS_PR}"><Relationship Id="rId1" Type="${REL}officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}extended-properties" Target="docProps/app.xml"/></Relationships>` });
  const ct = [DECL, '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>',
    `<Override PartName="/xl/workbook.xml" ContentType="${CT}sheet.main+xml"/>`];
  names.forEach((n, i) => ct.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT}worksheet+xml"/>`));
  ct.push(`<Override PartName="/xl/styles.xml" ContentType="${CT}styles+xml"/>`, `<Override PartName="/xl/sharedStrings.xml" ContentType="${CT}sharedStrings+xml"/>`,
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
  // [Content_Types].xml first, as Office writes it
  return writeZip([{ name: '[Content_Types].xml', data: ct.join('') }, ...files], level ? { level } : {});
}
