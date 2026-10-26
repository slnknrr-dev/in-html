// csv/csv.js - delimiter-separated values (RFC 4180): parsing (quoted fields, doubled quotes, embedded newlines,
// CRLF / LF / CR), serializing, delimiter / quote / newline sniffing, header detection and incremental parsing of
// large inputs (text chunks as they arrive, or a whole text in slices that yield to the event loop).
//
//   parseCSV(text, { delimiter = ',', quote = '"', maxRows }) -> string[][]
//   serializeCSV(rows, { delimiter = ',', quote = '"', newline = '\r\n', quoteAll = false, guard = false }) -> string
//   sniffCSV(text, { delimiters }) -> { delimiter, quote, newline, header }
//   hasHeader(rows) -> boolean
//   new CSVParser(opts): push(chunk) -> rows completed so far, end() -> the remaining rows
//   parseCSVAsync(text, { delimiter, quote, sliceRows, onProgress, signal }) -> Promise<string[][]>
//
// One core (parseInto) serves the three entry points: whole text, streamed chunks (final = false: stop before a
// record that may continue) and time-sliced parsing (maxRows). Parsing is lenient by design (unterminated quotes,
// junk after a closing quote are kept as text) because real exports from spreadsheets and banks violate RFC 4180,
// and losing a user's row is worse than accepting it imperfectly.

import { parseBool, parseDate, parseNumber } from './infer.js';

const reCache = new Map();
// Unquoted fields are sliced with one sticky-position regex search for the next delimiter / CR / LF instead of a
// per-character loop: the regex engine scans natively, which is several times faster on large files.
// Cached per delimiter because the parser restarts the search for every field.
function stopRe(delim) {
  let re = reCache.get(delim);
  if (!re) {
    re = new RegExp('[' + delim.replace(/[\\\]^-]/g, '\\$&') + '\\r\\n]', 'g');
    reCache.set(delim, re);
  }
  return re;
}

// Parses records from text[start..]; complete records go to `out`. Returns the offset where parsing stopped: the end,
// the start of an unfinished record (final = false: it may continue in the next chunk) or after `maxRows` records.
function parseInto(text, start, delim, quote, final, out, maxRows = Infinity) {
  const n = text.length;
  const D = delim.charCodeAt(0);
  const Q = quote ? quote.charCodeAt(0) : -1;
  const re = stopRe(delim);
  let i = start;
  let recStart = i;
  let row = [];
  let made = 0;
  while (i < n) {
    let field;
    if (text.charCodeAt(i) === Q) {
      let seg = i + 1;
      let s = '';
      for (;;) {
        const q = text.indexOf(quote, seg);
        if (q < 0) {
          if (!final) return recStart;
          s += text.slice(seg); // unterminated quote: the rest of the text is the field
          i = n;
          break;
        }
        // Chunk boundary between the two quotes of an escaped "" must not be read as the closing quote.
        if (q + 1 >= n && !final) return recStart; // a doubled quote may follow in the next chunk
        if (text.charCodeAt(q + 1) === Q) { s += text.slice(seg, q + 1); seg = q + 2; continue; }
        s += text.slice(seg, q);
        i = q + 1;
        break;
      }
      // Lenient: characters between the closing quote and the next separator belong to the field.
      if (i < n) {
        const c = text.charCodeAt(i);
        if (c !== D && c !== 10 && c !== 13) {
          re.lastIndex = i;
          const m = re.exec(text);
          const j = m ? m.index : n;
          s += text.slice(i, j);
          i = j;
        }
      }
      field = s;
    } else {
      re.lastIndex = i;
      const m = re.exec(text);
      const j = m ? m.index : n;
      field = text.slice(i, j);
      i = j;
    }
    row.push(field);
    if (i >= n) {
      if (!final) return recStart;
      out.push(row);
      row = null;
      break;
    }
    const c = text.charCodeAt(i);
    if (c === D) {
      i++;
      if (i >= n) {
        if (!final) return recStart;
        row.push('');
        out.push(row);
        row = null;
        break;
      }
      continue;
    }
      // CR, CRLF and LF all end a record; a CR at the very end of a chunk waits, since its LF may be in the next one.
    if (c === 13) {
      if (i + 1 >= n && !final) return recStart;
      i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
    } else i++;
    out.push(row);
    row = [];
    recStart = i;
    if (++made >= maxRows) return i;
  }
  return n;
}

const stripBOM = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

export function parseCSV(text, { delimiter = ',', quote = '"', maxRows } = {}) {
  const out = [];
  parseInto(stripBOM(String(text)), 0, delimiter, quote, true, out, maxRows);
  return out;
}

export class CSVParser {
  constructor({ delimiter = ',', quote = '"' } = {}) {
    this.delimiter = delimiter;
    this.quote = quote;
    this.buf = '';
    this.first = true;
  }

  // Re-parses the unfinished tail from its record start on each push. Linear for normal records; a single record
  // spanning many chunks (a huge quoted field) is rescanned each time, quadratic in that record's size.
  push(chunk) {
    this.buf += chunk;
    if (this.first && this.buf.length) { this.buf = stripBOM(this.buf); this.first = false; }
    const out = [];
    const pos = parseInto(this.buf, 0, this.delimiter, this.quote, false, out);
    this.buf = this.buf.slice(pos);
    return out;
  }

  end() {
    const out = [];
    parseInto(this.buf, 0, this.delimiter, this.quote, true, out);
    this.buf = '';
    return out;
  }
}

// A macrotask (not a microtask): only macrotasks let the browser render and handle input between slices.
const tick = () => new Promise((r) => setTimeout(r, 0));

// Whole text, parsed `sliceRows` records at a time with a macrotask between slices (the page stays responsive).
export async function parseCSVAsync(text, { delimiter = ',', quote = '"', sliceRows = 20000, onProgress, signal } = {}) {
  const s = stripBOM(String(text));
  const out = [];
  let pos = 0;
  while (pos < s.length) {
    if (signal && signal.aborted) throw new DOMException('aborted', 'AbortError');
    pos = parseInto(s, pos, delimiter, quote, true, out, sliceRows);
    if (onProgress) onProgress(pos / s.length, out.length);
    if (pos < s.length) await tick();
  }
  return out;
}

// --- writing -----------------------------------------------------------------------------

const cellText = (v) => (v == null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));

// guard: prefix ' to text starting with = + - @ (spreadsheet formula injection) unless it is a plain number.
// Quotes a field only when needed (delimiter, quote, newline, or leading / trailing whitespace that importers would
// trim). Formula-injection guard (OWASP CSV injection): cells starting with = + - @ TAB CR are executed by
// spreadsheets; a leading apostrophe makes them text, except plain numbers like -5, which must stay numeric.
export function serializeCSV(rows, { delimiter = ',', quote = '"', newline = '\r\n', quoteAll = false, guard = false } = {}) {
  const needs = new RegExp('[' + (delimiter + quote).replace(/[\\\]^-]/g, '\\$&') + '\\r\\n]|^\\s|\\s$');
  const dq = quote + quote;
  const lines = new Array(rows.length);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    const parts = new Array(row.length);
    for (let c = 0; c < row.length; c++) {
      let s = cellText(row[c]);
      if (guard && /^[=+\-@\t\r]/.test(s) && !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) s = "'" + s;
      parts[c] = quote && (quoteAll || needs.test(s)) ? quote + s.split(quote).join(dq) + quote : s;
    }
    lines[r] = parts.join(delimiter);
  }
  return lines.join(newline) + (lines.length ? newline : '');
}

// --- sniffing ----------------------------------------------------------------------------

const kindOf = (s) => {
  const t = String(s).trim();
  if (!t) return 'empty';
  if (parseNumber(t, '.') || parseNumber(t, ',')) return 'number';
  if (parseDate(t, 'mdy') || parseDate(t, 'dmy')) return 'date';
  if (parseBool(t) !== null) return 'bool';
  return 'text';
};

// Votes per column (in the spirit of Python's csv.Sniffer): a column whose body is numeric / dates / booleans and
// whose first cell is text votes for a header; text columns of a fixed width vote by the first cell's length.
// Heuristic, not proof: a header row is detected when its cells differ in kind from the column bodies (text over
// numbers or dates) or in length from fixed-width text columns. Duplicate labels count against a header. Only the
// first 200 body rows are inspected to bound cost.
export function hasHeader(rows) {
  const data = rows.filter((r) => r.length > 1 || (r[0] != null && String(r[0]).trim() !== ''));
  if (data.length < 2) return false;
  const head = data[0];
  const body = data.slice(1, 201);
  const filled = head.filter((h) => String(h ?? '').trim() !== '');
  if (filled.length < Math.ceil(head.length / 2)) return false;
  let votes = 0;
  for (let c = 0; c < head.length; c++) {
    const vals = body.map((r) => r[c]).filter((v) => v != null && String(v).trim() !== '');
    if (!vals.length) continue;
    const kinds = vals.map(kindOf);
    const k0 = kinds[0];
    const hk = kindOf(head[c]);
    if (k0 !== 'text' && kinds.filter((k) => k === k0).length >= vals.length * 0.9) votes += hk === k0 ? -1 : hk === 'text' ? 1 : 0;
    else {
      const lens = new Set(vals.map((v) => String(v).length));
      if (lens.size === 1 && vals.length > 1) votes += String(head[c] ?? '').length !== vals[0].length ? 1 : -1;
    }
  }
  const lower = filled.map((h) => String(h).trim().toLowerCase());
  if (new Set(lower).size < lower.length) votes -= 1;
  if (votes) return votes > 0;
  // No evidence either way: text labels that never repeat in their column look like a header.
  if (filled.some((h) => kindOf(h) !== 'text')) return false;
  for (let c = 0; c < head.length; c++) {
    const h = String(head[c] ?? '').trim().toLowerCase();
    if (h && body.some((r) => String(r[c] ?? '').trim().toLowerCase() === h)) return false;
  }
  return true;
}

// Delimiter choice = the candidate whose parse gives the most consistent field count (mode frequency) with more
// than one field; ties break toward the earlier candidate. Parsing with the real quote rules (not counting raw
// characters) keeps delimiters inside quoted fields from skewing the vote.
export function sniffCSV(text, { delimiters = [',', ';', '\t', '|'], sampleSize = 65536 } = {}) {
  let sample = stripBOM(String(text)).slice(0, sampleSize);
  const complete = text.length <= sampleSize;
  const crlf = (sample.match(/\r\n/g) || []).length;
  const lf = (sample.match(/(^|[^\r])\n/g) || []).length;
  const cr = (sample.match(/\r(?!\n)/g) || []).length;
  const newline = crlf >= lf && crlf >= cr && crlf ? '\r\n' : cr > lf ? '\r' : '\n';
  // Single quotes only when they clearly enclose fields and double quotes do not.
  const sq = (sample.match(/(^|[,;\t|])'[^'\r\n]*'(?=[,;\t|]|\r|\n|$)/gm) || []).length;
  const dq = (sample.match(/(^|[,;\t|])"/gm) || []).length;
  const quote = sq > dq && sq >= 2 ? "'" : '"';
  let best = { delimiter: ',', score: -1, rows: [] };
  delimiters.forEach((d, order) => {
    const rows = [];
    parseInto(sample, 0, d, quote, complete, rows, 200);
    const lines = rows.filter((r) => !(r.length === 1 && r[0] === ''));
    if (!lines.length) return;
    const freq = new Map();
    for (const r of lines) freq.set(r.length, (freq.get(r.length) || 0) + 1);
    let mode = 1, mf = 0;
    for (const [k, f] of freq) if (f > mf || (f === mf && k > mode)) { mode = k; mf = f; }
    const score = mode > 1 ? (mf / lines.length) * 1000 + Math.min(mode, 50) - order * 0.01 : 0;
    if (score > best.score) best = { delimiter: d, score, rows: lines };
  });
  return { delimiter: best.delimiter, quote, newline, header: hasHeader(best.rows) };
}
