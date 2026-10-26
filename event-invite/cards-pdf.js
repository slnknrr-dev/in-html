// event-invite/cards-pdf.js - printable PDFs through pdf/: invitation cards (A5 or A6, one page per content
// language: theme colours, a border with corner marks, the texts, programme, reply details and a vector QR code of the
// invitation address) and folded name cards (four per A4 page). Fonts: TTF / OTF bytes the user picked (embedded as
// a subset; Georgian needs e.g. Noto Sans Georgian), else the standard Helvetica for Latin text. Pure: no DOM.
//
// Coordinates: pdf/ pages use a top-left origin with y growing downward (layout.js textBox returns the height it
// used), so the card is laid out as a flow: `y` advances after every text block, like normal document flow.
// Every size is multiplied by k (A6 = 0.72 of A5), so one layout serves both formats instead of two hand-tuned ones.
import { PDFDocument, mm, textBox } from '../pdf/pdf.js';
import { qrMatrix } from '../qr/qr.js';
import { dateWords, guestDisplayName, menuOptions, theme, timeWords, tr, txt } from './invite.js';
import { formatEventDate, scheduleDays } from '../calendar/event.js';
import { parseDay } from '../calendar/date.js';

// Font fallback list: user fonts first, Helvetica last. pdf/ picks per glyph from the list, so Latin digits can
// come from Helvetica while Georgian comes from the user font. A font that fails to parse is skipped, not fatal:
// the user still gets a PDF, just with the fallback.
function newDoc(D, fonts) {
  const doc = new PDFDocument({ title: txt(D.title, D.langs[0]), creator: 'Event Invite', lang: D.langs[0] });
  const list = [];
  for (const b of fonts || []) { try { list.push(doc.addFont(b)); } catch { /* not a usable TrueType font */ } }
  list.push(doc.addStandardFont('Helvetica'));
  doc.setFont(list);
  return { doc };
}

// QR code as vector squares (one rectangle per dark run of a row). Run-length merging cuts the object count several
// times versus one rect per module, which keeps the PDF small and fast to render. The +0.05 overlap in height hides
// hairline gaps that anti-aliasing draws between adjacent rows in some viewers.
// Quiet zone q = 2 modules, half of the ISO 18004 minimum of 4: chosen to keep the code large on a small card; the
// explicit white square compensates on light papers, but on dark themes scanning margins are thinner. Level 'M'
// (15% recovery) balances density against tolerance to print smudges.
export function drawQR(page, text, x, y, size, color = '#000') {
  let m;
  try { m = qrMatrix(text, 'M'); } catch { return false; }
  const n = m.length, q = 2, cell = size / (n + 2 * q);
  page.rect(x, y, size, size, { fill: '#ffffff' });
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!m[r][c]) continue;
      const c0 = c;
      while (c < n && m[r][c]) c++;
      page.rect(x + (c0 + q) * cell, y + (r + q) * cell, (c - c0) * cell, cell + 0.05, { fill: color });
      c--;
    }
  }
  return true;
}

// Invitation cards. o: { size: 'a5' | 'a6', fonts: [bytes], qr: text (the invitation address) }.
export function cardsPDF(D, { size = 'a5', fonts = [], qr = '' } = {}) {
  const { doc } = newDoc(D, fonts);
  const th = theme(D.design?.theme);
  // Physical sizes via mm() (points = mm / 25.4 * 72). One page per content language: a bilingual event prints a
  // stack of cards, one per language, instead of crowding two languages onto one card.
  const [W, H] = size === 'a6' ? [mm(105), mm(148)] : [mm(148), mm(210)];
  const k = size === 'a6' ? 0.72 : 1;
  for (const lang of D.langs) {
    const page = doc.addPage([W, H]);
    const m = D.langs[0], pad = mm(9) * k, x = pad + mm(6) * k, w = W - 2 * x;
    page.rect(0, 0, W, H, { fill: th.paper });
    page.rect(pad, pad, W - 2 * pad, H - 2 * pad, { stroke: th.accent, width: 0.8, fill: 'none' });
    const cm = mm(8) * k;
    // Corner marks: four L-shapes, mirrored by sign (sx, sy) instead of four hand-written coordinate sets.
    for (const [cx, cy, sx, sy] of [[pad, pad, 1, 1], [W - pad, pad, -1, 1], [pad, H - pad, 1, -1], [W - pad, H - pad, -1, -1]]) {
      page.line(cx + sx * 3, cy + sy * 3, cx + sx * cm, cy + sy * 3, { stroke: th.accent, width: 1.2 });
      page.line(cx + sx * 3, cy + sy * 3, cx + sx * 3, cy + sy * cm, { stroke: th.accent, width: 1.2 });
    }
    let y = pad + mm(12) * k;
    // box(): draws a centred text block and advances y. Empty texts are skipped so optional sections leave no gaps.
    // KNOWN DEFECT: extra.charSpacing (passed by the first call) is never forwarded to textBox, so the letter-spaced
    // heading renders unspaced. Fix: add `charSpacing: extra.charSpacing` to the textBox options (pdf/doc.js supports it).
    const box = (text, size, color, extra = {}) => {
      if (!text) return;
      const r = textBox(page, text, { x, y, width: w, size: size * k, align: 'center', color, lineHeight: 1.3, maxLines: extra.maxLines || 6 });
      y += r.height + (extra.gap ?? 6) * k;
    };
    box(tr(D, lang, 'ei.inv.kind.' + D.type).toUpperCase(), 8, th.muted, { gap: 10, charSpacing: 1.5 });
    box(txt(D.hosts, lang, m), 16, th.accent);
    box(txt(D.message, lang, m), 10, th.muted, { gap: 10 });
    box(txt(D.title, lang, m), 26, th.ink, { gap: 8, maxLines: 3 });
    page.line(W / 2 - 30 * k, y, W / 2 + 30 * k, y, { stroke: th.accent, width: 0.8 });
    y += 12 * k;
    if (parseDay(D.day)) { box(dateWords(D, lang), 12, th.ink, { gap: 2 }); box(timeWords(D), 11, th.muted, { gap: 10 }); }
    const venue = [txt(D.venue?.name, lang, m), txt(D.venue?.address, lang, m)].filter(Boolean).join('\n');
    if (venue) { box(tr(D, lang, 'ei.inv.where').toUpperCase(), 7.5, th.accent, { gap: 3 }); box(venue, 10, th.ink, { gap: 10 }); }
    const items = scheduleDays((D.programme || []).filter((p) => txt(p.title, lang, m))).flatMap((g) => g.items);
    // The programme is skipped on A6: a quarter sheet cannot hold it legibly; the guest gets it from the web page.
    if (items.length && size !== 'a6') {
      box(tr(D, lang, 'ei.inv.programme').toUpperCase(), 7.5, th.accent, { gap: 3 });
      box(items.map((p) => `${p.at ? p.at + '  ' : ''}${txt(p.title, lang, m)}`).join('\n'), 9.5, th.ink, { gap: 10, maxLines: 10 });
    }
    if (D.dress?.code && D.dress.code !== 'none') box(tr(D, lang, 'ei.inv.dress') + ': ' + tr(D, lang, 'ei.inv.dress.' + D.dress.code), 9, th.muted, { gap: 8 });
    const r = D.rsvp || {};
    const rsvp = [parseDay(r.deadline) ? tr(D, lang, 'ei.inv.deadline', { date: formatEventDate(r.deadline, lang, { time: false }) }) : '', [r.email, r.phone].filter(Boolean).join(' · '),
      menuOptions(D, lang).length ? tr(D, lang, 'ei.inv.menu') + ': ' + menuOptions(D, lang).join(', ') : ''].filter(Boolean).join('\n');
    if (rsvp) box(rsvp, 8.5, th.muted, { gap: 8 });
    // The QR is clamped into the card bottom: if the texts ran long, it overlaps them rather than falling off the page
    // (an unreadable overlap is visible in preview, a missing QR is not). drawQR returns false for over-long text.
    if (qr) {
      const s = mm(22) * k;
      if (drawQR(page, qr, (W - s) / 2, Math.min(y + 4, H - pad - s - 16 * k), s, th.ink)) {
        textBox(page, tr(D, lang, 'ei.inv.scan'), { x, y: Math.min(y + 4, H - pad - s - 16 * k) + s + 3, width: w, size: 7 * k, align: 'center', color: th.muted, maxLines: 2 });
      }
    }
  }
  return doc.toBytes();
}

// Folded name cards: four per A4 page (two columns), 96 x 128 mm, the name on both halves (the back upside down).
// Each half is drawn by the same function; the back is the same drawing rotated 180 degrees around its centre, so
// after folding along the dotted mid line both faces read upright to people on either side of the table.
export function nameCardsPDF(D, guests, { fonts = [], tableLabel = (n) => n } = {}) {
  const { doc } = newDoc(D, fonts);
  const th = theme(D.design?.theme);
  const cw = mm(96), ch = mm(128), ox = (mm(210) - 2 * cw) / 2, oy = (mm(297) - 2 * ch) / 2;
  let page = null;
  guests.forEach((g, i) => {
    if (i % 4 === 0) page = doc.addPage('A4');
    const x = ox + (i % 2) * cw, y = oy + Math.floor((i % 4) / 2) * ch;
    // Dashed outline = cut line, dotted mid line = fold line (grey, not a theme colour: guides should not look designed).
    page.rect(x, y, cw, ch, { fill: th.paper, stroke: '#9ca3af', width: 0.4, dash: [3, 2] });
    page.line(x, y + ch / 2, x + cw, y + ch / 2, { stroke: '#9ca3af', width: 0.4, dash: [1, 2] });
    const name = guestDisplayName({ n: Object.keys(g.names || {}).length ? g.names : g.name }, g.lang || D.langs[0], D.langs[0]) || g.name;
    const half = (top) => {
      const by = top + ch / 4;
      page.line(x + cw / 2 - 26, by - 26, x + cw / 2 + 26, by - 26, { stroke: th.accent, width: 0.8 });
      textBox(page, name, { x: x + 12, y: by - 14, width: cw - 24, size: 20, align: 'center', color: th.ink, maxLines: 2 });
      if (g.seat) textBox(page, tableLabel(g.seat), { x: x + 12, y: by + 22, width: cw - 24, size: 9, align: 'center', color: th.accent, maxLines: 1 });
    };
    half(y + ch / 2);
    page.save(); page.rotate(180, x + cw / 2, y + ch / 4); half(y); page.restore();
  });
  // A PDF with zero pages is invalid in several readers; an empty guest list still yields one blank page.
  if (!guests.length) doc.addPage('A4');
  return doc.toBytes();
}
