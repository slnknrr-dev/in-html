// bookmarks/atom.js - Atom 1.0 feeds (RFC 4287) of bookmarks.
//
//   toAtom({ id, title, subtitle, link, self, updated, author, entries, generator }) -> xml text
//     id / link / self   absolute IRIs (feed id, the HTML page, the feed's own URL)
//     entries            [{ id, title, link, summary, published, updated, categories: [term] }] (times in ms)
//   tagURI(host, date, path) -> 'tag:example.org,2026-10-13:bookmarks/ann/abc'   (RFC 4151 ids that never change)

// XML 1.0 forbids most C0 control characters and U+FFFE/U+FFFF even when escaped; they are removed, then the five
// markup characters are escaped. A stray control character in a title would otherwise make the whole feed invalid.
const esc = (s) => String(s ?? '')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const date = (ms) => new Date(ms || 0).toISOString().replace(/\.\d{3}Z$/, 'Z');

// RFC 4151 tag URIs: an entry id must never change even if the bookmark URL or the server address changes, so it
// is minted from the host and the creation day plus a stable path, not from the link.
export function tagURI(host, day, path) {
  const h = String(host || 'localhost').toLowerCase().replace(/:\d+$/, '').replace(/[^a-z0-9.-]/g, '-');
  const d = new Date(day || 0).toISOString().slice(0, 10);
  return `tag:${h},${d}:${String(path).replace(/[^A-Za-z0-9._~/-]/g, (c) => encodeURIComponent(c))}`;
}

export function toAtom({ id, title, subtitle = '', link, self, updated, author = '', entries = [], generator = 'in-html bookmarks' }) {
  const last = updated || entries.reduce((m, e) => Math.max(m, e.updated || e.published || 0), 0) || Date.now();
  const out = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${esc(id)}</id>`,
    `  <title>${esc(title)}</title>`,
  ];
  if (subtitle) out.push(`  <subtitle>${esc(subtitle)}</subtitle>`);
  out.push(`  <updated>${date(last)}</updated>`);
  if (link) out.push(`  <link rel="alternate" type="text/html" href="${esc(link)}"/>`);
  if (self) out.push(`  <link rel="self" type="application/atom+xml" href="${esc(self)}"/>`);
  out.push(`  <author><name>${esc(author || title)}</name></author>`);
  out.push(`  <generator>${esc(generator)}</generator>`);
  for (const e of entries) {
    out.push('  <entry>');
    out.push(`    <id>${esc(e.id)}</id>`);
    out.push(`    <title type="text">${esc(e.title || e.link)}</title>`);
    out.push(`    <link rel="alternate" href="${esc(e.link)}"/>`);
    out.push(`    <published>${date(e.published || e.updated)}</published>`);
    out.push(`    <updated>${date(e.updated || e.published)}</updated>`);
    for (const c of e.categories || []) out.push(`    <category term="${esc(c)}"/>`);
    if (e.summary) out.push(`    <summary type="text">${esc(e.summary)}</summary>`);
    out.push('  </entry>');
  }
  out.push('</feed>');
  return out.join('\n') + '\n';
}
