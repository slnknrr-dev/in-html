// walletui/format.js - display helpers of the wallet applications (pure, Node-importable): shortened hashes and
// addresses, relative and absolute times in the UI language, byte sizes, numbers with grouping, percentages.
//
//   short(text, head = 8, tail = 6), ago(unixSeconds, lang, now) ('5 min ago'), dateTime(unixSeconds, lang),
//   num(n, lang, maxFraction), bytes(n), pct(x), plural-free counts

export const short = (s, head = 8, tail = 6) => {
  const t = String(s ?? '');
  return t.length > head + tail + 1 ? `${t.slice(0, head)}…${t.slice(-tail)}` : t;
};

// Formatter cache per language; null cached for unsupported locales so the throwing constructor runs once.
const rtf = new Map();
function relFormat(lang) {
  if (!rtf.has(lang)) { try { rtf.set(lang, new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' })); } catch { rtf.set(lang, null); } }
  return rtf.get(lang);
}

export function ago(sec, lang = 'en', now = Date.now() / 1000) {
  if (!sec) return '';
  const d = sec - now;
  const f = relFormat(lang);
  const abs = Math.abs(d);
  const [v, u] = abs < 60 ? [Math.round(d), 'second'] : abs < 3600 ? [Math.round(d / 60), 'minute'] : abs < 86400 ? [Math.round(d / 3600), 'hour'] : abs < 86400 * 60 ? [Math.round(d / 86400), 'day'] : [Math.round(d / 86400 / 30), 'month'];
  return f ? f.format(v, u) : `${v} ${u}`;
}

export function dateTime(sec, lang = 'en') {
  if (!sec) return '';
  try { return new Date(sec * 1000).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return new Date(sec * 1000).toISOString(); }
}

export function num(n, lang = 'en', maxFraction = 2) {
  try { return new Intl.NumberFormat(lang, { maximumFractionDigits: maxFraction }).format(n); } catch { return String(n); }
}

export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const pct = (x, digits = 1) => `${(x * 100).toFixed(digits)} %`;
