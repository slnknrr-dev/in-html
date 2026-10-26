// language-studio/courses/util.js - compact notation for course data.
//
//   words(['ru', 'zh'], `word | transcription | ru meaning | zh meaning`) -> [{ w, tr, m: { ru, zh }, note? }]
//     one entry per line; a line `# title` starts a group; an extra last column after `//` is a note in the first
//     language. Empty lines are skipped.
//   lines(langs, text) -> the same for dialogue and poem lines: `who: text | transcription | meanings…`
//   T(ru, en?) -> { ru, en }  (and Tz / Tj helpers for the CJK courses)

// Why a text notation: course authors write hundreds of words; one pipe-separated line per word is far easier to
// review and diff than object literals, and it parses in microseconds at import. Limits of the format: a literal "|"
// or " // " cannot appear inside a field; such entries are written as objects instead.
export function words(langs, text) {
  const out = [];
  let group = '';
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) { group = line.slice(1).trim(); continue; }
    const [main, note] = line.split(' // ');
    const cols = main.split('|').map((s) => s.trim());
    const m = {};
    langs.forEach((l, i) => { if (cols[2 + i]) m[l] = cols[2 + i]; });
    const e = { w: cols[0], tr: cols[1] || '', m };
    if (note) e.note = { [langs[0]]: note.trim() };
    if (group) e.group = group;
    out.push(e);
  }
  return out;
}

// Speaker prefix "who: text" up to 24 characters; the full-width colon (：) is accepted for Chinese/Japanese lines.
// The length cap keeps a colon inside an ordinary sentence from being read as a speaker name.
export function lines(langs, text) {
  return words(langs, text).map((e) => {
    const mm = /^([^:：]{1,24})[:：]\s*(.+)$/.exec(e.w);
    return mm ? { ...e, who: mm[1].trim(), w: mm[2].trim() } : e;
  });
}

export const T = (ru, en) => (en === undefined ? { ru } : { ru, en });
