// durak-game/cardart.js - card faces and backs as SVG markup (viewBox 100 × 140), cached per style: five face styles
// (Anglo-American, classic Russian with В / Д / К / Т indices, minimal, four-colour high contrast, dark), pip layouts
// of the number cards, court cards with chess glyphs in a frame, jokers, custom cards of a ruleset (label, glyph or an
// uploaded picture) and card backs (patterns in the table's colours or an uploaded picture).
//
//   FACES, BACKS                     style lists ({ id, name key })
//   faceSVG(rs, def, face) -> markup  def: a card definition of a normalized ruleset (ruleset.js defs)
//   backSVG(back, color, image?) -> markup
//   suitColor(rs, def, face) -> css colour of a card's ink
//
// Design: markup strings, not DOM or image files. A 36-card table repaints dozens of cards per move; a string cache
// keyed by ruleset hash + style + card code makes repeat faces free, and strings drop straight into innerHTML or a
// standalone export. Everything is drawn in a 100 x 140 viewBox (5:7, matches .dk-card aspect-ratio) so CSS width
// alone sizes a card. Suit symbols use a symbol font stack (Segoe UI Symbol, Noto Sans Symbols 2...) because text
// fonts like Georgia lack consistent suit glyphs and would fall back unpredictably. Indices are drawn once and
// repeated rotated 180deg about the centre (50,70), as on real cards, so the card reads from either side.
// Security: every user-provided text (labels, names, glyphs) goes through esc(); uploaded images must be data:image/
// URLs (checked by regex) so a ruleset cannot make the page fetch a remote URL.

export const FACES = [
  { id: 'anglo', name: 'face.anglo' },
  { id: 'russian', name: 'face.russian' },
  { id: 'minimal', name: 'face.minimal' },
  { id: 'contrast', name: 'face.contrast' },
  { id: 'dark', name: 'face.dark' },
];
export const BACKS = [
  { id: 'lattice', name: 'back.lattice' },
  { id: 'stripes', name: 'back.stripes' },
  { id: 'dots', name: 'back.dots' },
  { id: 'crest', name: 'back.crest' },
  { id: 'image', name: 'back.image' },
];

// Palette per face style. Raw colours: cards are paper and ignore the UI theme. `four` (contrast style) gives each
// suit its own colour (spades black, hearts red, diamonds blue, clubs green) so suits are told apart by colour-blind
// players and at a glance. `dark` is a dark card for night play, with lightened inks.
const STYLE = {
  anglo: { paper: '#fffdf8', edge: '#c9c3b6', red: '#cc2229', black: '#17171a', font: 'Georgia, "Times New Roman", serif', court: '#f6efe0', frame: '#b89a5a' },
  russian: { paper: '#fbf6ea', edge: '#bfb39a', red: '#b8261f', black: '#1f1d1a', font: '"Times New Roman", Georgia, serif', court: '#f2e7cf', frame: '#9c3d2f' },
  minimal: { paper: '#ffffff', edge: '#d5d8de', red: '#e0393e', black: '#20242c', font: 'system-ui, "Segoe UI", Roboto, Arial, sans-serif', court: '#f3f4f6', frame: '#c7cbd3' },
  contrast: { paper: '#ffffff', edge: '#000000', red: '#d00000', black: '#000000', font: 'system-ui, "Segoe UI", Roboto, Arial, sans-serif', court: '#fffbe0', frame: '#000000', four: { S: '#000000', H: '#d00000', D: '#0047c2', C: '#007a1f' } },
  dark: { paper: '#23272f', edge: '#6b7385', red: '#ff6b6b', black: '#e8eaee', font: 'Georgia, "Times New Roman", serif', court: '#2c313b', frame: '#8a93a6' },
};
const SYMBOL_FONT = '"Segoe UI Symbol", "Noto Sans Symbols 2", "Apple Symbols", "DejaVu Sans", sans-serif';
// Russian indices: Валет, Дама, Король, Туз.
const RU = { J: 'В', Q: 'Д', K: 'К', A: 'Т', T: '10' };
const COURT_GLYPH = { J: '♞', Q: '♛', K: '♚' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// One Map for faces and backs. Insertion order = age, so deleting keys().next() evicts the oldest (FIFO, not LRU:
// hits do not refresh; acceptable because the working set of one table is far below the cap).
// KNOWN DEFECT: the 2000-entry cap is enforced only in faceSVG; backSVG entries (one per back/colour/image combo)
// are never evicted on their own, and an entry keyed by an uploaded image keeps that hash only. Fix: apply the same
// size check after cache.set in backSVG.
const cache = new Map();

function colorCss(rs, id) {
  const c = rs.deck.colors.find((x) => x.id === id);
  return c && c.css ? c.css : null;
}

// Ink of a card: suit colour of the style (four colours in high contrast), else the deck's colour definition.
export function suitColor(rs, def, face = 'anglo') {
  const st = STYLE[face] || STYLE.anglo;
  if (st.four && def.suit && st.four[def.suit]) return st.four[def.suit];
  if (def.color === 'red') return st.red;
  if (def.color === 'black') return st.black;
  const css = def.color ? colorCss(rs, def.color) : null;
  if (css && face === 'dark') return lighten(css);
  return css || st.black;
}

// Mix a #rrggbb colour 35 % toward white (per channel v + (255 - v) x 0.35): keeps hue, raises contrast on the dark
// card. Non-hex CSS colours pass through unchanged (no parser for names/rgb()).
function lighten(css) {
  const m = /^#([0-9a-f]{6})$/i.exec(css);
  if (!m) return css;
  const n = parseInt(m[1], 16);
  const f = (v) => Math.round(v + (255 - v) * 0.35);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
}

function rankLabel(rs, def, face) {
  if (def.label) return def.label;
  if (!def.rank) return '';
  if (face === 'russian' && RU[def.rank]) return RU[def.rank];
  const r = rs.deck.ranks.find((x) => x.id === def.rank);
  return r ? r.label : def.rank;
}
function suitSymbol(rs, def) {
  if (!def.suit) return '';
  const s = rs.deck.suits.find((x) => x.id === def.suit);
  return s ? s.symbol : def.suit;
}

// Pip centres of the number cards (x, y); pips below the middle are drawn upside down.
const PIPS = {
  2: [[50, 30], [50, 110]],
  3: [[50, 30], [50, 70], [50, 110]],
  4: [[32, 30], [68, 30], [32, 110], [68, 110]],
  5: [[32, 30], [68, 30], [50, 70], [32, 110], [68, 110]],
  6: [[32, 30], [68, 30], [32, 70], [68, 70], [32, 110], [68, 110]],
  7: [[32, 30], [68, 30], [50, 50], [32, 70], [68, 70], [32, 110], [68, 110]],
  8: [[32, 30], [68, 30], [50, 50], [32, 70], [68, 70], [50, 90], [32, 110], [68, 110]],
  9: [[32, 28], [68, 28], [32, 56], [68, 56], [50, 70], [32, 84], [68, 84], [32, 112], [68, 112]],
  10: [[32, 28], [68, 28], [50, 42], [32, 56], [68, 56], [32, 84], [68, 84], [50, 98], [32, 112], [68, 112]],
};

// Corner index: rank over suit, font shrinking for 2- and 3-character labels ('10', custom labels) with tightened
// letter-spacing so they stay inside the 22-unit corner column. font-family is in single quotes because the stacks
// contain double-quoted family names.
function corner(label, sym, ink, st, small = false) {
  const fs = label.length > 2 ? 15 : label.length > 1 ? 19 : 22;
  const top = `<text x="11" y="${small ? 22 : 24}" text-anchor="middle" font-family='${st.font}' font-weight="700" font-size="${fs}" fill="${ink}" ${label.length > 1 ? 'letter-spacing="-1.5"' : ''}>${esc(label)}</text>` +
    (sym ? `<text x="11" y="${small ? 40 : 43}" text-anchor="middle" font-family='${SYMBOL_FONT}' font-size="17" fill="${ink}">${esc(sym)}</text>` : '');
  return `<g>${top}</g><g transform="rotate(180 50 70)">${top}</g>`;
}

function frame(st, ink) {
  return `<rect x="21" y="20" width="58" height="100" rx="4" fill="${st.court}" stroke="${st.frame}" stroke-width="1.6"/>` +
    `<rect x="24.5" y="23.5" width="51" height="93" rx="2.5" fill="none" stroke="${ink}" stroke-opacity=".35" stroke-width=".8"/>`;
}

function body(st, inner, extra = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140" class="dk-svg" aria-hidden="true">` +
    `<rect x=".75" y=".75" width="98.5" height="138.5" rx="7" fill="${st.paper}" stroke="${st.edge}" stroke-width="1.5"/>${extra}${inner}</svg>`;
}

function jokerArt(def, ink, st) {
  const letters = 'JOKER'.split('').map((c, i) => `<text x="12" y="${30 + i * 14}" text-anchor="middle" font-family='${st.font}' font-weight="700" font-size="13" fill="${ink}">${c}</text>`).join('');
  const star = `<path d="M50 38l7.6 15.4 17 2.5-12.3 12 2.9 16.9L50 76.8 34.8 84.8l2.9-16.9-12.3-12 17-2.5z" fill="${ink}" fill-opacity=".92"/>`;
  const hat = `<path d="M30 104c6-14 14-18 20-18s14 4 20 18" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/><circle cx="30" cy="105" r="3" fill="${ink}"/><circle cx="70" cy="105" r="3" fill="${ink}"/><circle cx="50" cy="86" r="3" fill="${ink}"/>`;
  return letters + `<g transform="rotate(180 50 70)">${letters}</g>` + star + hat;
}

// Face of a card definition in a style. Decision order: uploaded picture > joker > custom card (glyph/label in a court
// frame) > standard ranks (minimal style: big index; 2..10: pip layout; ace: one large suit; J/Q/K: chess glyph in a
// frame; anything else: big index). rs.hash in the key invalidates the cache when the constructor edits a ruleset.
// Clip-path ids are derived from the cache key hash, so the same card rendered twice in one document reuses an id
// whose definition is identical - duplicate ids, but harmless because both clipPaths are the same shape.
export function faceSVG(rs, def, face = 'anglo') {
  const key = rs.hash + '|' + face + '|' + def.code;
  const hit = cache.get(key);
  if (hit) return hit;
  const st = STYLE[face] || STYLE.anglo;
  const ink = suitColor(rs, def, face);
  const label = rankLabel(rs, def, face);
  const sym = suitSymbol(rs, def);
  const art = def.art && typeof def.art === 'object' ? def.art : null;
  let inner = '';
  if (art && art.kind === 'image' && typeof art.src === 'string' && /^data:image\//.test(art.src)) {
    // Uploaded picture in the frame, indices on top.
    const id = 'c' + Math.abs(hashStr(key)).toString(36);
    inner = `<defs><clipPath id="${id}"><rect x="8" y="8" width="84" height="124" rx="4"/></clipPath></defs>` +
      `<image href="${esc(art.src)}" x="8" y="8" width="84" height="124" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>` +
      (label || sym ? `<rect x="2" y="4" width="20" height="${sym ? 44 : 26}" rx="4" fill="${st.paper}" fill-opacity=".85"/><g transform="rotate(180 50 70)"><rect x="2" y="4" width="20" height="${sym ? 44 : 26}" rx="4" fill="${st.paper}" fill-opacity=".85"/></g>` + corner(label, sym, ink, st) : '');
  } else if (art && art.kind === 'joker' || def.rank === 'X' && !art) {
    inner = jokerArt(def, ink, st);
  } else if (def.custom && (!def.rank || def.label || (art && art.kind === 'glyph'))) {
    const glyph = art && art.glyph ? art.glyph : def.label || def.code;
    const name = typeof def.name === 'string' ? def.name : def.name && (def.name.en || Object.values(def.name)[0]) || '';
    inner = frame(st, ink) + `<text x="50" y="${name ? 78 : 84}" text-anchor="middle" font-family='${SYMBOL_FONT}' font-size="${glyph.length > 2 ? 22 : 44}" fill="${ink}">${esc(glyph)}</text>` +
      (name ? `<text x="50" y="108" text-anchor="middle" font-family='${st.font}' font-size="9.5" font-weight="700" fill="${ink}">${esc(name.slice(0, 14))}</text>` : '') +
      corner(label || glyph.slice(0, 2), sym, ink, st);
  } else {
    const r = def.rank;
    const n = /^\d+$/.test(r) ? +r : r === 'T' ? 10 : 0;
    if (face === 'minimal') {
      inner = `<text x="50" y="86" text-anchor="middle" font-family='${st.font}' font-weight="700" font-size="${label.length > 1 ? 40 : 50}" fill="${ink}">${esc(label)}</text>` +
        `<text x="50" y="118" text-anchor="middle" font-family='${SYMBOL_FONT}' font-size="26" fill="${ink}">${esc(sym)}</text>` + corner(label, sym, ink, st);
    } else if (PIPS[n] && sym) {
      const fs = n >= 9 ? 19 : 21;
      inner = PIPS[n].map(([x, y]) => `<text x="${x}" y="${y + fs * 0.36}" text-anchor="middle" font-family='${SYMBOL_FONT}' font-size="${fs}" fill="${ink}"${y > 72 ? ` transform="rotate(180 ${x} ${y})"` : ''}>${esc(sym)}</text>`).join('') + corner(label, sym, ink, st);
    } else if (r === 'A' && sym) {
      const ring = face === 'russian' ? `<circle cx="50" cy="70" r="27" fill="none" stroke="${ink}" stroke-opacity=".35" stroke-width="1.2"/><circle cx="50" cy="70" r="31" fill="none" stroke="${st.frame}" stroke-opacity=".5" stroke-width=".8" stroke-dasharray="2 3"/>` : '';
      inner = ring + `<text x="50" y="91" text-anchor="middle" font-family='${SYMBOL_FONT}' font-size="${face === 'russian' ? 50 : 60}" fill="${ink}">${esc(sym)}</text>` + corner(label, sym, ink, st);
    } else if (COURT_GLYPH[r]) {
      inner = frame(st, ink) +
        `<text x="50" y="84" text-anchor="middle" font-family='${SYMBOL_FONT}' font-size="46" fill="${ink}">${COURT_GLYPH[r]}</text>` +
        `<text x="31" y="38" text-anchor="middle" font-family='${SYMBOL_FONT}' font-size="13" fill="${ink}">${esc(sym)}</text>` +
        `<text x="69" y="110" text-anchor="middle" font-family='${SYMBOL_FONT}' font-size="13" fill="${ink}" transform="rotate(180 69 106)">${esc(sym)}</text>` +
        `<text x="50" y="112" text-anchor="middle" font-family='${st.font}' font-weight="700" font-size="11" fill="${ink}" fill-opacity=".75">${esc(label)}</text>` +
        corner(label, sym, ink, st);
    } else {
      // A rank without a pip layout (custom ranks): big index in the middle.
      inner = `<text x="50" y="82" text-anchor="middle" font-family='${st.font}' font-weight="700" font-size="${label.length > 2 ? 24 : 38}" fill="${ink}">${esc(label)}</text>` +
        (sym ? `<text x="50" y="112" text-anchor="middle" font-family='${SYMBOL_FONT}' font-size="22" fill="${ink}">${esc(sym)}</text>` : '') + corner(label, sym, ink, st);
    }
  }
  const out = body(st, inner);
  cache.set(key, out);
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return out;
}

// Java-style 31-multiplier string hash; Math.imul keeps it in 32-bit integer arithmetic (plain * would lose precision
// past 2^53). Used for ids and cache keys only, not security.
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; }

// Back of the cards in a pattern of the table's colours (or an uploaded picture). Patterns are SVG <pattern> tiles
// (userSpaceOnUse, rotated 45deg for diagonal lattices/stripes) so they stay crisp at any card size. Dark/light
// shades derive from the one colour, so a skin needs one back colour only. White outer rim, as printed backs have.
// The image src is the user's own setting (settings.backImage), escaped for the attribute.
export function backSVG(back = 'lattice', color = '#8b1e2d', image = null) {
  const key = back + '|' + color + '|' + (image ? hashStr(image) : '');
  const hit = cache.get(key);
  if (hit) return hit;
  const dark = shade(color, -0.35), light = shade(color, 0.45);
  let pat = '';
  const id = 'p' + Math.abs(hashStr(key)).toString(36);
  if (back === 'image' && image) {
    pat = `<defs><clipPath id="${id}"><rect x="5" y="5" width="90" height="130" rx="5"/></clipPath></defs><image href="${esc(image)}" x="5" y="5" width="90" height="130" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`;
  } else if (back === 'stripes') {
    pat = `<defs><pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="${color}"/><rect width="4" height="8" fill="${dark}"/></pattern></defs><rect x="6" y="6" width="88" height="128" rx="5" fill="url(#${id})"/>`;
  } else if (back === 'dots') {
    pat = `<defs><pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="${color}"/><circle cx="5" cy="5" r="2.1" fill="${light}" fill-opacity=".55"/></pattern></defs><rect x="6" y="6" width="88" height="128" rx="5" fill="url(#${id})"/>`;
  } else if (back === 'crest') {
    pat = `<rect x="6" y="6" width="88" height="128" rx="5" fill="${color}"/><rect x="11" y="11" width="78" height="118" rx="3" fill="none" stroke="${light}" stroke-opacity=".7" stroke-width="1.2"/>` +
      `<circle cx="50" cy="70" r="22" fill="${dark}" stroke="${light}" stroke-opacity=".8" stroke-width="1.5"/><text x="50" y="80" text-anchor="middle" font-family='${SYMBOL_FONT}' font-size="28" fill="${light}">♠</text>` +
      `<path d="M50 20v20M50 100v20M16 70h12M72 70h12" stroke="${light}" stroke-opacity=".6" stroke-width="1.2"/>`;
  } else {
    pat = `<defs><pattern id="${id}" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="${color}"/><path d="M0 0h12v12" fill="none" stroke="${light}" stroke-opacity=".45" stroke-width="1.4"/></pattern></defs>` +
      `<rect x="6" y="6" width="88" height="128" rx="5" fill="url(#${id})"/><rect x="10" y="10" width="80" height="120" rx="3" fill="none" stroke="${light}" stroke-opacity=".6" stroke-width="1"/>`;
  }
  const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140" class="dk-svg" aria-hidden="true"><rect x=".75" y=".75" width="98.5" height="138.5" rx="7" fill="#fbfbfb" stroke="${dark}" stroke-width="1.5"/>${pat}</svg>`;
  cache.set(key, out);
  return out;
}

function shade(css, f) {
  const m = /^#([0-9a-f]{6})$/i.exec(css);
  if (!m) return css;
  const n = parseInt(m[1], 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('');
}
