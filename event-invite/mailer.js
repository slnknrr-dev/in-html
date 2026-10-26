// event-invite/mailer.js - the invitation as e-mail: an .eml (mail/mime.js buildMessage) with multipart/alternative
// (plain text + HTML made for mail clients: one centred table, inline styles, no scripts, no remote images, no
// forms) and the event attached as text/calendar, optionally personalised for one guest (greeting, language, the
// personal link), and a mail-merge ZIP of one .eml per guest with an e-mail address. Pure: no DOM.
import { buildMessage, emlFileName } from '../mail/mime.js';
import { writeZip } from '../zip/zip.js';
import { FONTS, dateWords, esc, guestDisplayName, icsText, mapLinks, menuOptions, theme, timeWords, tr, txt } from './invite.js';
import { formatEventDate, scheduleDays } from '../calendar/event.js';
import { parseDay } from '../calendar/date.js';

// Mail clients ignore <style> blocks and web fonts unevenly: the font stack goes inline and its double quotes
// become single quotes, because it is embedded inside style="..." attributes.
const mailFont = (D) => (D.design?.font === 'sans' ? FONTS.sans : FONTS.serif).replace(/"/g, "'");

// HTML body for mail clients (tables and inline styles only).
// Why tables: Outlook (Word renderer) and several webmail clients drop flex/grid, max-width on divs and <style>.
// A 600px centred table with width="100%" fallback is the layout every client renders. role="presentation" tells
// screen readers the tables are layout, not data. Every interpolated text goes through esc(): titles and names are
// user input, and an unescaped '<' would break the markup or inject links.
export function emailHTML(D, lang, { guest = null, link = '' } = {}) {
  const th = theme(D.design?.theme), m = D.langs[0], font = mailFont(D);
  const p = (text, style = '') => (text ? `<p style="margin:0 0 10px;${style}">${esc(text).replace(/\n/g, '<br>')}</p>` : '');
  const h2 = (text) => `<p style="margin:22px 0 8px;font:600 12px/1.3 ${font};letter-spacing:2px;text-transform:uppercase;color:${th.accent}">${esc(text)}</p>`;
  const gname = guestDisplayName(guest, lang, m);
  const prog = scheduleDays((D.programme || []).filter((x) => txt(x.title, lang, m))).flatMap((g) => g.items.map((x) => `<tr><td style="padding:4px 12px 4px 0;color:${th.accent};font-weight:600;white-space:nowrap;vertical-align:top">${esc(x.at || '')}</td><td style="padding:4px 0;color:${th.ink}">${esc(txt(x.title, lang, m))}</td></tr>`)).join('');
  const venue = [txt(D.venue?.name, lang, m), txt(D.venue?.address, lang, m)].filter(Boolean);
  const map = mapLinks(D, lang);
  const r = D.rsvp || {};
  const btn = (href, label) => `<a href="${esc(href)}" style="display:inline-block;margin:4px;padding:10px 20px;border-radius:999px;background:${th.accent};color:${th.paper};font:600 14px ${font};text-decoration:none">${esc(label)}</a>`;
  // '@' restored after encodeURIComponent: some clients do not decode %40 in the mailto address part.
  const replyMail = r.email ? `mailto:${encodeURIComponent(r.email).replace(/%40/g, '@')}?subject=${encodeURIComponent(tr(D, lang, 'ei.inv.subject', { title: txt(D.title, lang, m) }))}` : '';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(txt(D.title, lang, m))}</title></head>
<body style="margin:0;padding:0;background:${th.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${th.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${th.paper};border:1px solid ${th.accent};border-radius:8px">
<tr><td align="center" style="padding:36px 28px;font:16px/1.6 ${font};color:${th.ink};text-align:center">
<p style="margin:0 0 12px;font:600 12px/1.3 ${font};letter-spacing:3px;text-transform:uppercase;color:${th.muted}">${esc(tr(D, lang, 'ei.inv.kind.' + D.type))}</p>
${gname ? p(tr(D, lang, 'ei.inv.dear', { name: gname }), `font-style:italic;color:${th.muted}`) : ''}
${p(txt(D.hosts, lang, m), `font-size:22px;color:${th.accent}`)}
${p(txt(D.message, lang, m), `color:${th.muted}`)}
<h1 style="margin:10px 0 18px;font:400 34px/1.15 ${font};color:${th.ink}">${esc(txt(D.title, lang, m))}</h1>
${parseDay(D.day) ? p(dateWords(D, lang), 'font-size:18px;font-weight:600') + p(timeWords(D), `color:${th.muted}`) : ''}
${venue.length ? h2(tr(D, lang, 'ei.inv.where')) + venue.map((v, i) => p(v, i ? `color:${th.muted}` : 'font-weight:600')).join('') + (map ? `<p style="margin:0 0 10px"><a href="${esc(map.osm)}" style="color:${th.accent}">${esc(tr(D, lang, 'ei.inv.map'))}</a></p>` : '') : ''}
${prog ? h2(tr(D, lang, 'ei.inv.programme')) + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="font:15px/1.5 ${font};text-align:left">${prog}</table>` : ''}
${D.dress?.code && D.dress.code !== 'none' ? h2(tr(D, lang, 'ei.inv.dress')) + p(tr(D, lang, 'ei.inv.dress.' + D.dress.code)) + p(txt(D.dress.note, lang, m), `color:${th.muted}`) : ''}
${h2(tr(D, lang, 'ei.inv.rsvp'))}
${parseDay(r.deadline) ? p(tr(D, lang, 'ei.inv.deadline', { date: formatEventDate(r.deadline, lang, { time: false }) })) : ''}
${menuOptions(D, lang).length ? p(tr(D, lang, 'ei.inv.menu') + ': ' + menuOptions(D, lang).join(', '), `color:${th.muted}`) : ''}
<p style="margin:8px 0 0">${link ? btn(link, tr(D, lang, 'ei.inv.open')) : ''}${replyMail ? btn(replyMail, tr(D, lang, 'ei.inv.send')) : ''}</p>
${p(txt(r.note, lang, m), `margin-top:10px;color:${th.muted}`)}
</td></tr></table>
</td></tr></table>
</body></html>`;
}

// Plain-text alternative. Required in practice: spam filters score HTML-only mail higher, and text-only clients show
// it. The final filter collapses runs of blank lines left by empty optional sections.
export function emailText(D, lang, { guest = null, link = '' } = {}) {
  const m = D.langs[0], gname = guestDisplayName(guest, lang, m);
  const out = [];
  if (gname) out.push(tr(D, lang, 'ei.inv.dear', { name: gname }), '');
  out.push(txt(D.hosts, lang, m), txt(D.message, lang, m), '', txt(D.title, lang, m).toUpperCase(), '');
  if (parseDay(D.day)) out.push(dateWords(D, lang) + (timeWords(D) ? ', ' + timeWords(D) : ''));
  const venue = [txt(D.venue?.name, lang, m), txt(D.venue?.address, lang, m)].filter(Boolean).join(', ');
  if (venue) out.push(tr(D, lang, 'ei.inv.where') + ': ' + venue);
  const prog = scheduleDays((D.programme || []).filter((x) => txt(x.title, lang, m))).flatMap((g) => g.items.map((x) => `  ${x.at || ''}  ${txt(x.title, lang, m)}`));
  if (prog.length) out.push('', tr(D, lang, 'ei.inv.programme') + ':', ...prog);
  if (D.dress?.code && D.dress.code !== 'none') out.push('', tr(D, lang, 'ei.inv.dress') + ': ' + tr(D, lang, 'ei.inv.dress.' + D.dress.code));
  if (parseDay(D.rsvp?.deadline)) out.push('', tr(D, lang, 'ei.inv.deadline', { date: formatEventDate(D.rsvp.deadline, lang, { time: false }) }));
  if (link) out.push('', tr(D, lang, 'ei.inv.open') + ': ' + link);
  return out.filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim() + '\n';
}

// One .eml: { name, text }. o: { guest, link, to, lang, date }.
// From falls back to an address under .invalid (RFC 6761: guaranteed non-routable), never a guessed real domain.
// The Message-ID includes the guest id, so each file of a mail merge is unique even when built in the same ms.
// quoted-printable keeps mostly-ASCII HTML readable and robust against 998-octet line limits of SMTP.
// method=PUBLISH on the .ics = an announcement, not a meeting request that clients would try to accept/decline.
export function buildEml(D, o = {}) {
  const lang = o.lang && D.langs.includes(o.lang) ? o.lang : D.langs[0];
  const subject = tr(D, lang, 'ei.inv.kind.' + D.type) + ': ' + txt(D.title, lang, D.langs[0]);
  const ics = icsText(D, lang);
  const from = D.rsvp?.email ? { name: txt(D.hosts, lang, D.langs[0]), address: D.rsvp.email } : { name: txt(D.hosts, lang, D.langs[0]), address: 'invitation@example.invalid' };
  const text = buildMessage({
    from, to: o.to ? [o.to] : [], subject, date: o.date || Date.now(),
    messageId: `${(D.uid || 'event')}.${o.guest ? o.guest.i : 'all'}.${Date.now().toString(36)}@event-invite.invalid`,
    text: emailText(D, lang, o), html: emailHTML(D, lang, o), encoding: 'quoted-printable',
    attachments: ics ? [{ filename: 'invitation.ics', data: ics, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] : [],
  });
  return { name: emlFileName(subject + (o.guest ? ' - ' + guestDisplayName(o.guest, lang, D.langs[0]) : '')), text };
}

// Mail merge: entries [{ D (personalised data), guest, link, to, lang }] -> ZIP bytes of .eml files.
// Name clashes (two guests with the same display name) get " (2)", " (3)": ZIP entries with equal names would
// overwrite each other on extraction.
export async function mailMergeZip(entries) {
  const used = new Set();
  const files = entries.map((e) => {
    const m = buildEml(e.D, e);
    let name = m.name, i = 2;
    while (used.has(name)) name = m.name.replace(/\.eml$/, ` (${i++}).eml`);
    used.add(name);
    return { name, data: m.text };
  });
  return writeZip(files);
}
