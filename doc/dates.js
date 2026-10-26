// doc/dates.js - document date values: 'YYYY' | 'YYYY-MM' | 'present' (ranges of resume timelines and the like).
// Values are partial dates on purpose: a resume says "2019-05", not a day; storing full Dates would invent precision
// and drag time zones in. Arithmetic is done in "months since year 0" integers.
import { formatYearMonth } from '../i18n/dates.js';
import { uiText } from './dict.js';

// Localized text. fmt: month | monthLong | year | numeric. 'present' uses the product's UI key `present`.
export function formatDate(ym, lang, fmt = 'month', doc) {
  if (!ym) return '';
  if (ym === 'present') return uiText('present', lang, doc);
  const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(String(ym));
  if (!m) return String(ym);
  const y = +m[1];
  const mo = m[2] ? +m[2] : 0;
  if (!mo || mo > 12 || fmt === 'year') return String(y);
  return formatYearMonth(y, mo, lang, fmt);
}

// Months since year 0 (end of the year for a bare year when endOfYear); 'present' = now (render time).
// UTC fields of now: the result must not change at local midnight differently from the export machine's zone.
// The regex is anchored at the start only, so '2019-05-01' is accepted as '2019-05' (day ignored).
export function parseYM(v, endOfYear) {
  if (!v) return null;
  if (v === 'present') {
    const d = new Date();
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  }
  const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(v);
  if (!m) return null;
  return +m[1] * 12 + (m[2] ? +m[2] - 1 : endOfYear ? 11 : 0);
}

// Duration of a closed range with the product's plural UI keys `dur.y` / `dur.m`; ongoing work must say
// end:'present' (an item with only a start - a certificate, an award - is a point in time, not a period up to today).
export function formatDuration(start, end, lang, doc) {
  if (!start || !end) return '';
  const a = parseYM(start, false);
  const b = parseYM(end, true);
  if (a == null || b == null || b < a) return '';
  const total = b - a + 1; // inclusive months
  const y = Math.floor(total / 12);
  const mo = total % 12;
  const out = [];
  if (y) out.push(uiText('dur.y', lang, doc, { n: y }));
  if (mo) out.push(uiText('dur.m', lang, doc, { n: mo }));
  return out.join(' ');
}
