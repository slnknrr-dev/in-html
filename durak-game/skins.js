// durak-game/skins.js - the look of the table: table themes (CSS custom properties on the table element), the card
// face and back styles of cardart.js, user pictures (table background, card back) scaled down to data URLs that fit
// into room settings, and the skin object rooms synchronise: { table, face, back, tableImage?, backImage? }.
//
//   TABLES                          [{ id, name, vars }]
//   skinOf(settings, roomSkin?) -> skin   the effective skin (the room's look wins when `useRoomSkin` is on)
//   applySkin(el, skin)             sets data-table and the CSS variables on the table element
//   backColor(skin) -> css          the theme's card back colour
//   fitImage(file, maxSide, quality) -> Promise<dataURL>   scaled JPEG / PNG (keeps transparency) for uploads

// Each theme is a set of --dk-* values (see app.css CONTRACT): felt/felt2 = gradient centre/edge, rim, ink (text on
// the table), muted, accent (primary buttons), back (card back colour), glow (highlights). Light tables (wood,
// paper) flip ink to dark; app.css adds [data-table="paper"|"wood"] overrides for translucent controls. 'contrast'
// is pure black/yellow for low vision. 'image' keeps neutral dark values under the user's photo.
export const TABLES = [
  { id: 'felt', name: 'table.felt', vars: { felt: '#1e6b46', felt2: '#0e4029', rim: '#5b3a1e', ink: '#f2f7f1', muted: '#b9d6c3', accent: '#ffd166', back: '#9b2335', glow: '#ffe28a' } },
  { id: 'casino', name: 'table.casino', vars: { felt: '#7c1d33', felt2: '#3f0b19', rim: '#1f130b', ink: '#fbeff0', muted: '#e2b6bf', accent: '#f4c95d', back: '#1d3d7a', glow: '#ffe08a' } },
  { id: 'navy', name: 'table.navy', vars: { felt: '#1f3a5f', felt2: '#0c1a2e', rim: '#0a1220', ink: '#eef4fb', muted: '#a9bfd9', accent: '#8ecae6', back: '#b23a48', glow: '#b8ecff' } },
  { id: 'wood', name: 'table.wood', vars: { felt: '#b27c45', felt2: '#7a4f27', rim: '#3e2611', ink: '#2a1709', muted: '#4f3218', accent: '#fff1b8', back: '#2f5d50', glow: '#fff3b0', wood: '1' } },
  { id: 'slate', name: 'table.slate', vars: { felt: '#262b34', felt2: '#121419', rim: '#07080a', ink: '#e8ebf1', muted: '#9aa3b2', accent: '#7aa2ff', back: '#3b4a6b', glow: '#9ec0ff' } },
  { id: 'paper', name: 'table.paper', vars: { felt: '#f3efe6', felt2: '#e2dccd', rim: '#c9c0ac', ink: '#2b2925', muted: '#6d6759', accent: '#2563eb', back: '#2563eb', glow: '#2563eb' } },
  { id: 'contrast', name: 'table.contrast', vars: { felt: '#000000', felt2: '#000000', rim: '#ffd400', ink: '#ffffff', muted: '#ffe866', accent: '#ffd400', back: '#ffd400', glow: '#ffd400' } },
  { id: 'image', name: 'table.image', vars: { felt: '#1b2a24', felt2: '#0b1210', rim: '#060908', ink: '#f4f7f5', muted: '#c4d3cc', accent: '#ffd166', back: '#9b2335', glow: '#ffe28a' } },
];

export const DEFAULT_SKIN = { table: 'felt', face: 'anglo', back: 'lattice', tableImage: null, backImage: null };

const tableById = (id) => TABLES.find((x) => x.id === id) || TABLES[0];

// A room's skin comes from another player (over the network), so each field is validated: the table must be a known
// id, images must pass isImage; invalid fields fall back to the player's own choice (or to no image).
export function skinOf(settings, roomSkin = null) {
  const own = {
    table: settings.table || DEFAULT_SKIN.table, face: settings.face || DEFAULT_SKIN.face, back: settings.back || DEFAULT_SKIN.back,
    tableImage: settings.tableImage || null, backImage: settings.backImage || null,
  };
  if (roomSkin && typeof roomSkin === 'object' && settings.useRoomSkin !== false) {
    return {
      table: TABLES.some((x) => x.id === roomSkin.table) ? roomSkin.table : own.table,
      face: typeof roomSkin.face === 'string' ? roomSkin.face : own.face,
      back: typeof roomSkin.back === 'string' ? roomSkin.back : own.back,
      tableImage: isImage(roomSkin.tableImage) ? roomSkin.tableImage : null,
      backImage: isImage(roomSkin.backImage) ? roomSkin.backImage : null,
    };
  }
  return own;
}

// Only base64 data: URLs of raster types: no remote URL (privacy: a room cannot make you fetch a tracker), no SVG (can
// carry script), and the base64 alphabet cannot contain '"' or ')', so the value is safe inside url("...") below.
// < 3 MB keeps room settings messages bounded.
export const isImage = (s) => typeof s === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(s) && s.length < 3_000_000;

// Inline custom properties on the element override the :root defaults for its subtree only, so the home hero and
// the table can show different skins at once. 'image' without an image falls back to felt.
export function applySkin(el, skin) {
  const t = tableById(skin.table === 'image' && !skin.tableImage ? 'felt' : skin.table);
  el.dataset.table = t.id;
  for (const [k, v] of Object.entries(t.vars)) el.style.setProperty('--dk-' + k, v);
  el.style.setProperty('--dk-image', skin.table === 'image' && skin.tableImage ? `url("${skin.tableImage}")` : 'none');
}

export const backColor = (skin) => tableById(skin.table).vars.back;

// Scales a picture down so that its longer side is at most maxSide pixels: JPEG unless it has transparency.
// Transparency test samples every 7th pixel's alpha (stride 4 x 7 bytes): a full scan of a 1024px image is 1M reads,
// sampling is enough to detect a transparent background or cut-out. Re-encoding also strips EXIF metadata (location)
// before the image is shared with a room. The object URL is revoked on both paths to free the file blob.
export function fitImage(file, maxSide = 1024, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, w, h);
        let alpha = false;
        if (/png|webp|gif/.test(file.type)) {
          const d = g.getImageData(0, 0, w, h).data;
          for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) { alpha = true; break; }
        }
        resolve(alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', quality));
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
    img.src = url;
  });
}
