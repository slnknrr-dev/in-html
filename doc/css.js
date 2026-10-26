// doc/css.js - helpers for the products' CSS builders (tree-shaken theme rules, asset fonts, language groups).
//
// Everything here emits CSS text that is later inlined into <style> of an exported page, so each helper must be
// injection-safe on its own: user strings never reach CSS except via cssStr or a strict URL whitelist.
import { isB64 } from '../codec/base64.js';
import { langDir } from '../i18n/lang.js';
import { MIME_RE, isObj, own, str } from '../util/value.js';
import { P } from './product.js';

// CSS string literal (safe inside <style>: '<' escaped).
// CSS escapes are hex code points terminated by a space: '\a ' is a newline, '\3c ' is '<'. Escaping '<' stops a
// value like "</style><script>" from closing the style element (the HTML tokenizer does not know CSS strings).
export function cssStr(s) {
  return '"' + String(s).replace(/[\\"]/g, '\\$&').replace(/\r?\n/g, '\\a ').replace(/</g, '\\3c ') + '"';
}

// Splits a selector list on top-level commas (not inside :is() / :not() / [attr="a,b"]).
// Single pass with a depth counter and a quote state; enough for selectors the products write themselves.
// Limitation: a backslash-escaped quote inside an attribute string ([a="x\"y"]) ends the string early.
export function splitSelectors(s) {
  const out = [];
  let depth = 0;
  let q = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}

// Theme rules are one per line: drop lines that only style unused blocks. Plain `selectors{body}` rules keep the
// selectors whose owners are used; at-rules (@media / @supports / @container ...) are kept or dropped as a whole.
// owners: [[/class prefix/, owner], ...]; has(owner) -> whether that block type / shared chunk is used.
// Line-based by contract, not a CSS parser: theme sources are written one rule per line exactly so this stays O(n)
// and tiny. A multi-line rule would be kept or dropped line by line, i.e. corrupted. used(line) on at-rules tests the
// whole line, so one unused owner inside an @media drops the entire at-rule.
export function shakeRules(css, owners, has) {
  const used = (sel) => {
    for (const [re, owner] of owners) if (re.test(sel) && !has(owner)) return false;
    return true;
  };
  const out = [];
  for (const line of css.split('\n')) {
    const t = line.trim();
    const b = t.indexOf('{');
    if (!t || t[0] === '@' || b < 0) {
      if (used(line)) out.push(line);
      continue;
    }
    const keep = splitSelectors(t.slice(0, b)).filter(used);
    if (keep.length) out.push(keep.join(',') + t.slice(b));
  }
  return out.join('\n');
}

// Font stack for a theme font key: a stacks entry, or 'asset:<attId>' (an uploaded font) declared through
// @font-face in `faces` (Map family -> rule). Only a strict data: / blob: URL may reach url("...") (no quote, paren,
// semicolon or brace -> no CSS injection). Unknown keys fall back to stacks[fallback].
export function fontStack(doc, key, opts, faces, stacks, fallback = 'sans') {
  if (own(stacks, key)) return stacks[key];
  const fb = stacks[fallback];
  const m = /^asset:([a-z0-9]{3,32})$/i.exec(String(key || ''));
  const a = m ? own(doc.attachments, m[1]) : null;
  if (!isObj(a)) return fb;
  const id = m[1];
  const fam = P.prefix + 'f-' + id;
  let url = '';
  if (opts.mode === 'edit' && typeof opts.attURL === 'function') url = str(opts.attURL(id));
  if (!url && isB64(a.data) && MIME_RE.test(str(a.mime))) url = `data:${a.mime};base64,${a.data}`;
  if (!url && typeof opts.attURL === 'function') url = str(opts.attURL(id));
  if (!/^(data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/]*={0,2}|blob:[\w.:/%-]+)$/.test(url)) return fb;
  if (!faces.has(fam)) faces.set(fam, `@font-face{font-family:"${fam}";src:url("${url}");font-display:swap}`);
  return `"${fam}", ${fb}`;
}

// Per-language groups (data-l) visible only under html[lang] of their language; right-to-left languages.
// Language groups are toggled purely by CSS on html[lang]: works without JS (clean export) and the i18n runtime only
// has to set one attribute. !important: a block's own display (flex, grid) has higher specificity and would show the
// hidden language. [data-l~=x] is a whitespace-token match, so one group can carry several languages.
// The tag whitelist guards the attribute selector against injection (tags are also canonicalised upstream).
export function langCSS(langs) {
  const ok = langs.filter((l) => /^[A-Za-z0-9-]+$/.test(l));
  const rtl = ok.filter((l) => langDir(l) === 'rtl');
  return `.${P.prefix}-rich>[data-l]>:last-child{margin-bottom:0}` + ok
    .map((l) => `html[lang="${l}"] [data-l]:not([data-l~="${l}"]){display:none!important}`).join('\n')
    + (rtl.length ? '\n' + rtl.map((l) => `html[lang="${l}"]`).join(',') + '{direction:rtl}' : '');
}
