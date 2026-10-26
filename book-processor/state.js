// book-processor/state.js - shared state of the application (current view, open book, open draft), the
// application's icons and small helpers used by the library, the reader and the writer.
import { addIcons } from '../ui/icons.js';
import { personName } from '../book/model.js';
import { ED_I18N, UI_STATE, t } from '../ui/i18n.js';
import { primary } from '../i18n/lang.js';

// One mutable state object plus `hooks` for cross-module calls: library, reader and writer import each other only
// through S.hooks, which avoids circular ES module imports (a cycle would expose half-initialised bindings).
export const S = {
  view: 'library',        // 'library' | 'reader' | 'writer'
  shelf: [],              // shelf records (db.js)
  reader: null,           // reader session (reader.js)
  writer: null,           // writer session (writer.js)
  hooks: {},              // cross-module calls: route(view, arg), refreshLibrary(), openReader(id), openWriter(id)
};

addIcons({
  book: 'M4 5.5C6.7 4.2 9.3 4.4 12 6c2.7-1.6 5.3-1.8 8-.5V19c-2.7-1.3-5.3-1.1-8 .5-2.7-1.6-5.3-1.8-8-.5zM12 6v13.5',
  shelf: 'M4 3v18M8 3v18M12 4l4 17M17 3h3v18h-3zM2 21h20',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  feather: 'M20.2 3.8a6 6 0 0 0-8.5 0L5 10.5V19h8.5l6.7-6.7a6 6 0 0 0 0-8.5zM16 8 2 22M17.5 15H9',
  bookmark: 'M6 3h12v18l-6-4.5L6 21z',
  highlight: 'M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4',
  toc: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  aa: 'M3 19 8 5h1l5 14M4.8 14h7.4M15 19l3.4-9h.6l3.4 9M16 16.5h5',
  fullscreen: 'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5',
  fullscreenExit: 'M8 3v5H3M21 8h-5V3M16 21v-5h5M3 16h5v5',
  arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  note: 'M4 4h16v12H8l-4 4zM8 9h8M8 12h5',
  poem: 'M4 6h10M4 10h14M4 14h8M4 18h12M19 15l2 2-2 2',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z',
  italic: 'M19 4h-9M14 20H5M15 4 9 20',
  strike: 'M4 12h16M16 6a4 3 0 0 0-4-2c-2.8 0-4.5 1.5-4.5 3.3 0 4.2 9.5 3 9.5 8 0 2-2 3.7-5 3.7a5 4 0 0 1-5-2.5',
  sub: 'M4 5l8 10M12 5 4 15M17 20h4c0-2-4-2-4-4.5a2 2 0 0 1 4 0',
  sup: 'M4 9l8 10M12 9l-8 10M17 10h4c0-2-4-2-4-4.5a2 2 0 0 1 4 0',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  clearFormat: 'M4 7V4h16v3M9 20h6M12 4v16M3 3l18 18',
  scene: 'M4 10.5l3 3M7 10.5l-3 3M10.5 10.5l3 3M13.5 10.5l-3 3M17 10.5l3 3M20 10.5l-3 3',
  footnote: 'M4 6h10M4 10h10M4 14h7M17 4v6M15 6h4M4 19h16',
  indent: 'M3 6h18M11 10h10M11 14h10M3 18h18M3 9l4 3-4 3',
  outdent: 'M3 6h18M11 10h10M11 14h10M3 18h18M7 9l-4 3 4 3',
  addChild: 'M4 4v10a3 3 0 0 0 3 3h7M14 13l4 4-4 4M12 4h8M16 0v8',
  dots: 'M12 5h.01M12 12h.01M12 19h.01',
  wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4M12.2 6.2l-1.4-1.4M3 21l9-9',
  shuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  library: 'M4 19V5a1 1 0 0 1 1-1h3v15M8 19V4h4v15M14.5 5.2l3.4-.9 3.6 13.6-3.4.9zM3 19h18',
  read: 'M2 6c3-1.5 6.5-1.5 10 1 3.5-2.5 7-2.5 10-1v13c-3-1.5-6.5-1.5-10 1-3.5-2.5-7-2.5-10-1zM12 7v13',
  spread: 'M2 5c3-1 6.5-1 10 1 3.5-2 7-2 10-1v14c-3-1-6.5-1-10 1-3.5-2-7-2-10-1zM12 6v14',
  scroll: 'M8 3h8M8 21h8M12 7v10M9 14l3 3 3-3M9 10l3-3 3 3',
  page: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4',
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
});

export const LOGO = 'M4 5.5C6.7 4.2 9.3 4.4 12 6c2.7-1.6 5.3-1.8 8-.5V19c-2.7-1.3-5.3-1.1-8 .5-2.7-1.6-5.3-1.8-8-.5zM12 6v13.5';

export const authorsText = (book) => (book.meta.authors || []).map(personName).filter(Boolean).join(', ');

// Relative time via Intl.RelativeTimeFormat (localised "yesterday", "3 hours ago"); older than a week switches to an
// absolute date, which reads better than "47 days ago".
export function fmtWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  try {
    const rtf = new Intl.RelativeTimeFormat(UI_STATE.lang, { numeric: 'auto' });
    if (diff < 60e3) return rtf.format(0, 'second');
    if (diff < 3600e3) return rtf.format(-Math.round(diff / 60e3), 'minute');
    if (diff < 86400e3) return rtf.format(-Math.round(diff / 3600e3), 'hour');
    if (diff < 7 * 86400e3) return rtf.format(-Math.round(diff / 86400e3), 'day');
    return new Intl.DateTimeFormat(UI_STATE.lang, { dateStyle: 'medium' }).format(d);
  } catch { return d.toISOString().slice(0, 10); }
}

export const pct = (x) => Math.round(Math.max(0, Math.min(1, x || 0)) * 100) + '%';

// Localized label of an FB2 genre code (English from the library when the dictionary has none).
export function genreLabel(code, fallback) {
  const k = 'genre.' + code;
  return ED_I18N[UI_STATE.lang]?.[k] || ED_I18N.en[k] ? t(k) : fallback || code;
}

export const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

// A UI string in the book's language (template chapter names, generated headings), English when the application
// has no dictionary for it.
// Temporarily switches the UI language to produce text in the book's language (e.g. "Chapter 1" inside a Georgian
// book), restored in finally so an exception cannot leave the whole UI in another language. Falls back from a
// regional tag to its primary language, then to English.
export function tLang(lang, key, vars) {
  const prev = UI_STATE.lang;
  UI_STATE.lang = ED_I18N[lang] ? lang : ED_I18N[primary(lang)] ? primary(lang) : 'en';
  try { return t(key, vars); } finally { UI_STATE.lang = prev; }
}
