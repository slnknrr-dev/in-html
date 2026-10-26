// paper/icons.js - icon set of paper documents: SVG path data for a 24x24 viewBox. DATA TABLE.
//
// Rendering contract (doc/render.js icon() + .__P__-ic in paper/css.js): fill:none; stroke:currentColor; round caps and
// joins; stroke-width 1.9. Paths are therefore drawn as open strokes, not filled shapes; a filled design would render
// as an outline. currentColor makes every icon follow text / accent colour and the dark scheme with zero extra CSS.
// Strings instead of SVG files: zero requests, and an export inlines only the icons it used (ctx.use tracking).
// Multiple subpaths are separated by " M"; a dot is drawn as a zero-length segment ("h.01") relying on round caps.
//
// Structure: contact kinds (keyed by the contact kind name so ICONS[kind] works without a mapping table), files and
// actions, UI and topic icons (heading picker), block palette icons. Products extend via definePaperProduct({icons}).
const PAPER_ICONS = {
  // contacts
  email: 'M3 5.5h18v13H3z M3.5 6.5 12 13l8.5-6.5',
  phone: 'M5 3.5h3.5l2 5-2.4 1.6a11 11 0 0 0 5.8 5.8l1.6-2.4 5 2v3.5a2 2 0 0 1-2 2A17 17 0 0 1 3 5.5a2 2 0 0 1 2-2z',
  web: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z M3.5 9h17 M3.5 15h17 M12 3c-2.6 2.6-3.6 5.6-3.6 9s1 6.4 3.6 9 M12 3c2.6 2.6 3.6 5.6 3.6 9s-1 6.4-3.6 9',
  location: 'M12 21.5s-7-6.3-7-12a7 7 0 0 1 14 0c0 5.7-7 12-7 12z M12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z',
  linkedin: 'M4 3.5h16a.5.5 0 0 1 .5.5v16a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z M8 10.5V17 M8 7.2v.1 M11.5 17v-6.5 M11.5 13.2c0-1.6 1.1-2.7 2.6-2.7s2.4 1 2.4 2.7V17',
  github: 'M6.2 6.4 6.6 3l3 1.9h4.8l3-1.9.4 3.4c.9 1.1 1.4 2.4 1.4 3.9 0 3.8-3 6.2-7.2 6.2s-7.2-2.4-7.2-6.2c0-1.5.5-2.8 1.4-3.9z M9.6 16.4v4.6 M14.4 16.4v4.6 M9.6 19c-2.6.6-4.2-.4-5.1-2 M9.8 10.5v.5 M14.2 10.5v.5',
  codeberg: 'M12 3.5 2.5 20.5h19z M12 9.5l-5.2 9.2 M12 9.5l5.2 9.2 M12 13.5v5',
  gitlab: 'M12 21 3 13.6l1.8-9.1 2.7 6.4h9l2.7-6.4 1.8 9.1z M7.5 10.9 12 21l4.5-10.1',
  telegram: 'M21 3.8 2.8 11l6 2.3 2.1 6.4 3.3-4.1 5.1 3.7z M8.8 13.3 21 3.8 M10.9 19.7l.6-4.9',
  whatsapp: 'M3.8 20.2l1.3-4.3A8.6 8.6 0 1 1 8.2 19z M9.2 8.2l1.3-.2.9 2.1-.9 1a5.4 5.4 0 0 0 2.4 2.4l1-.9 2.1.9-.2 1.3c-.2.8-1 1.2-1.8 1.1a7.3 7.3 0 0 1-5.9-5.9c-.1-.8.3-1.6 1.1-1.8z',
  x: 'M4 4h4.6L20 20h-4.6z M19.6 4l-6.6 7.2 M4.4 20l6.6-7.2',
  mastodon: 'M7.5 3.5h9a3.5 3.5 0 0 1 3.5 3.5v5.5a3.5 3.5 0 0 1-3.5 3.5h-4c-1.8 0-3 .9-3 2.3 0 1.9 3.4 2.3 6.5 1.4 M4 7v6.5c0 3.5 1.7 5.2 4.6 5.8 M8.5 12V8.8a1.6 1.6 0 0 1 3.2 0V11 M11.7 11V8.8a1.6 1.6 0 0 1 3.2 0V12',
  skype: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 1 1 0-17z M15 9.3c-.6-1-1.7-1.5-3.1-1.5-1.8 0-3 .9-3 2.1 0 2.9 6.2 1.5 6.2 4.4 0 1.3-1.3 2.2-3.2 2.2-1.6 0-2.7-.6-3.2-1.7',
  birth: 'M4 20.5h16 M5 20.5v-7h14v7 M5 16.5c2.3 1.2 4.7 1.2 7 0s4.7-1.2 7 0 M12 13.5V10 M12 7.3c-1-.9-1-2 0-3.6 1 1.6 1 2.7 0 3.6z',
  other: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  // files & actions
  file: 'M6 2.8h8l5 5v13.4H6z M14 2.8v5h5 M9 13h6 M9 16.5h6',
  pdf: 'M6 2.8h8l5 5v13.4H6z M14 2.8v5h5 M8.6 18v-5h1.6a1.5 1.5 0 0 1 0 3H8.6 M13.4 18v-5h.9a2.5 2.5 0 0 1 0 5z',
  image: 'M3 4.5h18v15H3z M3 16l5-5 4.5 4.5 3-3L21 18 M15.5 8.5h.01',
  download: 'M12 3.5v12 M7 10.5l5 5 5-5 M4 20h16',
  print: 'M7 9V3.5h10V9 M7 17.5H4V9.5h16v8h-3 M7 13.5h10v7H7z M16.5 12h.01',
  open: 'M14 3.5h6.5V10 M20.5 3.5 11 13 M18 14v6.5H3.5V6H10',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  paperclip: 'M20 11.4l-8.3 8.3a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8',
  close: 'M6 6l12 12 M18 6 6 18',
  // ui & topics
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z M3.5 9h17 M3.5 15h17 M12 3c-2.6 2.6-3.6 5.6-3.6 9s1 6.4 3.6 9 M12 3c2.6 2.6 3.6 5.6 3.6 9s-1 6.4-3.6 9',
  sun: 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9z M12 2v2.2 M12 19.8V22 M4.9 4.9l1.6 1.6 M17.5 17.5l1.6 1.6 M2 12h2.2 M19.8 12H22 M4.9 19.1l1.6-1.6 M17.5 6.5l1.6-1.6',
  moon: 'M20 14.6A8.5 8.5 0 1 1 9.4 4a6.8 6.8 0 0 0 10.6 10.6z',
  briefcase: 'M3 7.5h18v12.5H3z M8.5 7.5V5.2A1.7 1.7 0 0 1 10.2 3.5h3.6a1.7 1.7 0 0 1 1.7 1.7v2.3 M3 12.5h18 M10.5 12.5v1.5h3v-1.5',
  graduation: 'M2 9.5 12 4.5l10 5-10 5z M6 11.5V16c3.3 2.6 8.7 2.6 12 0v-4.5 M22 9.5V15',
  award: 'M12 3a6 6 0 1 0 0 12 6 6 0 1 0 0-12z M8.6 14 7 21l5-2.8 5 2.8-1.6-7',
  code: 'M8 7l-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16',
  user: 'M12 3.5a4 4 0 1 0 0 8 4 4 0 1 0 0-8z M4 21c0-4.2 3.6-6.8 8-6.8s8 2.6 8 6.8',
  star: 'M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 3 1.1-6.2L3 9.7l6.2-.9z',
  heart: 'M12 20.5S3.5 15.6 3.5 9.4A4.6 4.6 0 0 1 12 6.8a4.6 4.6 0 0 1 8.5 2.6c0 6.2-8.5 11.1-8.5 11.1z',
  book: 'M3.5 4.5H9a3 3 0 0 1 3 3v13a2.3 2.3 0 0 0-2.3-2.3H3.5z M20.5 4.5H15a3 3 0 0 0-3 3v13a2.3 2.3 0 0 1 2.3-2.3h6.2z',
  calendar: 'M3.5 5.5h17v15h-17z M3.5 10h17 M8 3v4.5 M16 3v4.5 M7.5 14h.01 M12 14h.01 M16.5 14h.01 M7.5 17.5h.01 M12 17.5h.01',
  language: 'M3 5.5h11 M8.5 3v2.5 M5 5.5c1 3.9 3.9 6.9 7 8 M12 5.5c-1 3.9-3.9 6.9-7.5 8 M12.5 21l4.2-9.5 4.3 9.5 M14 17.8h5.5',
  quote: 'M4 11.5h5v6.5H4v-5.2c0-3.3 1.4-5.4 4.4-6.6 M14 11.5h5v6.5h-5v-5.2c0-3.3 1.4-5.4 4.4-6.6',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z M12 11v5.5 M12 7.6v.01',
  warning: 'M12 3.5 2.2 20.5h19.6z M12 10v4.5 M12 17.4v.01',
  check: 'M4 12.5l5 5L20 6.5',
  success: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z M8 12.3l2.8 2.8L16.2 9.5',
  note: 'M5 3.5h10l4 4v13H5z M15 3.5v4h4 M8.5 12h7 M8.5 15.5h7 M8.5 8.5h3',
  home: 'M3.5 11 12 4l8.5 7 M5.5 9.5v11h13v-11 M10 20.5v-6h4v6',
  flag: 'M5 21V3.5 M5 4h12.5l-2.5 4.5 2.5 4.5H5',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z M12 7a5 5 0 1 0 0 10 5 5 0 1 0 0-10z M12 11a1 1 0 1 0 0 2 1 1 0 1 0 0-2z',
  lightbulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.8 10.6c.6.6.8 1.3.8 2.4h6c0-1.1.2-1.8.8-2.4A6 6 0 0 0 12 3z',
  tools: 'M14.7 6.3a4 4 0 0 0 5 5L21 10a5.5 5.5 0 0 1-6.6 1.9l-8.2 8.2a2 2 0 0 1-2.8-2.8l8.2-8.2A5.5 5.5 0 0 1 13.5 2.6l-1.3 1.2a4 4 0 0 0 2.5 2.5z',
  rocket: 'M14 4.5c2.5-1.3 4.8-1.2 5.7-.9.3.9.4 3.2-.9 5.7-1.4 2.7-4.4 5.3-7.3 6.7l-3.5-3.5c1.4-2.9 4-5.9 6-7.5z M8 12.5 4.5 12l2.5-3h4 M11.5 16l.5 3.5 3-2.5v-4 M15 7.5a1.5 1.5 0 1 0 0 .01 M6.5 17.5c-1 .5-2 2-2 2s1.5-1 2-2',
  chat: 'M4 4.5h16v11.5H9.5L4 20.5z M8 9h8 M8 12.5h5',
  camera: 'M3 7.5h4l1.8-2.5h6.4L17 7.5h4V19H3z M12 9.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 1 0 0-7z',
  music: 'M9 18V5l11-2v13 M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z M20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z',
  car: 'M4 16.5v-4l2-5h12l2 5v4z M4 12.5h16 M7 19.5v-3 M17 19.5v-3 M7.5 14.5h.01 M16.5 14.5h.01',
  plane: 'M10.5 20.5 12 15l-5-1-2 2-1.5-.5 1.5-3-1.5-3L5 9l2 2 5-1-1.5-5.5h2L16 10h3.5a1.5 1.5 0 0 1 0 3H16l-3.5 7.5z',
  // block palette
  heading: 'M6 4v16 M18 4v16 M6 12h12',
  text: 'M4 6h16 M4 10h16 M4 14h16 M4 18h10',
  idcard: 'M3 5h18v14H3z M8.5 9a2 2 0 1 0 0 4 2 2 0 1 0 0-4z M5.5 16.5c.5-1.6 1.6-2.4 3-2.4s2.5.8 3 2.4 M14 10h4 M14 13.5h4',
  timeline: 'M6 3v18 M4.5 6h3 M4.5 12h3 M4.5 18h3 M10 6h10 M10 12h10 M10 18h7',
  bars: 'M4 20.5V11 M10 20.5V4 M16 20.5v-7.5 M2.5 20.5h19',
  list: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01',
  table: 'M3 5h18v14H3z M3 9.7h18 M3 14.3h18 M9 5v14 M15 5v14',
  section: 'M3 4h18v16H3z M3 9h18 M6 6.5h6',
  columns: 'M3 4h18v16H3z M12 4v16',
  divider: 'M3 12h18 M7 6.5h10 M7 17.5h10',
  spacer: 'M12 3v18 M8 7l4-4 4 4 M8 17l4 4 4-4',
  pagebreak: 'M5 3v6h14V3 M5 21v-6h14v6 M3 12h2 M8 12h2 M14 12h2 M19 12h2',
  qr: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2.5v2.5H14z M17.5 17.5H20V20h-2.5z M17.5 14H20 M14 17.5V20',
};

export {
  PAPER_ICONS
};
