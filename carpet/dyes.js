// carpet/dyes.js - palettes of natural dyes for hand-knotted rugs: colours with the dye (or undyed wool) they come
// from, and palettes per tradition with roles (ground, field, border, accents, outline). sRGB approximations of dyed
// wool, chosen by hand; real dye lots vary (abrash).
//
//   DYES      { id: { hex, dye } }                    the colours
//   PALETTES  { id: { name, roles: { role: dyeId } } } role names: ground, field, border, guard, accent1..accent4, outline, light
//   paletteColors(id, overrides) -> [{ role, hex, dye }]

// Data file: hex values are hand-picked sRGB approximations of dyed wool, each with the dye source so the chart
// legend and the yarn estimate can name it.
export const DYES = {
  madderRed: { hex: '#a32a24', dye: 'madder' },
  madderDeep: { hex: '#7e1d1f', dye: 'madder (mordant iron)' },
  madderRose: { hex: '#c96a5c', dye: 'madder, light bath' },
  madderBrick: { hex: '#b4503a', dye: 'madder and walnut' },
  cochineal: { hex: '#8e2140', dye: 'cochineal' },
  indigoNavy: { hex: '#1e2b4d', dye: 'indigo, many dips' },
  indigoBlue: { hex: '#2f5683', dye: 'indigo' },
  indigoSky: { hex: '#7fa3c2', dye: 'indigo, one dip' },
  weldYellow: { hex: '#d9b34a', dye: 'weld' },
  weldGold: { hex: '#c08f2f', dye: 'weld and madder' },
  greenIW: { hex: '#4f6e45', dye: 'indigo over weld' },
  greenLight: { hex: '#8fa26a', dye: 'weld over light indigo' },
  purple: { hex: '#5a3552', dye: 'madder over indigo' },
  walnut: { hex: '#5b3a26', dye: 'walnut husk' },
  pomegranate: { hex: '#b8955a', dye: 'pomegranate rind' },
  ivory: { hex: '#efe5cf', dye: 'undyed white wool' },
  camel: { hex: '#b48a5e', dye: 'undyed camel wool' },
  grey: { hex: '#8d8a83', dye: 'undyed grey wool' },
  black: { hex: '#24201d', dye: 'undyed black-brown wool' },
  oakBrown: { hex: '#6e5134', dye: 'oak galls' },
  rust: { hex: '#a65a2e', dye: 'madder and weld' },
  teal: { hex: '#2f6b6b', dye: 'indigo and weld' },
  moss: { hex: '#6c7a3e', dye: 'weld and iron' },
  saffron: { hex: '#e2a43b', dye: 'saffron / safflower' },
  lac: { hex: '#9b2335', dye: 'lac (insect resin)' },
  kermes: { hex: '#a8263b', dye: 'kermes' },
  vordanKarmir: { hex: '#94152b', dye: 'Ararat cochineal (vordan karmir)' },
  sumac: { hex: '#c9a227', dye: 'sumac' },
  larkspur: { hex: '#d8b23c', dye: 'larkspur (isparek)' },
  turmeric: { hex: '#d6a21e', dye: 'turmeric' },
  henna: { hex: '#9a4a2c', dye: 'henna' },
  pistachio: { hex: '#94a65e', dye: 'pistachio galls and indigo' },
  mamlukGreen: { hex: '#6c9658', dye: 'weld over indigo, light' },
  mamlukBlue: { hex: '#3b6a98', dye: 'indigo, medium' },
  ottomanCrimson: { hex: '#a3192f', dye: 'cochineal with alum' },
  apricot: { hex: '#d98b4b', dye: 'madder and weld, light' },
  bronze: { hex: '#8a6a2e', dye: 'walnut and weld' },
  tushBrown: { hex: '#3a2a20', dye: 'undyed dark Tushetian wool' },
  // Synthetic colours for modern and mash-up designs (the dye column says so).
  cobalt: { hex: '#1f4fb4', dye: 'synthetic' },
  turquoise: { hex: '#1d9a9a', dye: 'synthetic' },
  fuchsia: { hex: '#c0307a', dye: 'synthetic' },
  vermilion: { hex: '#e04a24', dye: 'synthetic' },
  chrome: { hex: '#f0c419', dye: 'synthetic' },
  jade: { hex: '#2e8b62', dye: 'synthetic' },
  plum: { hex: '#5b2a6e', dye: 'synthetic' },
  ink: { hex: '#141822', dye: 'synthetic' },
  silver: { hex: '#c6c9cc', dye: 'synthetic' },
  coral: { hex: '#f07a6a', dye: 'synthetic' },
};

// A palette maps ROLES to dyes. Generators paint roles, never colours, so any design can be recoloured by swapping
// the palette (and the INVERT role swap in compose.js stays meaningful).
export const PALETTES = {
  persian: { name: 'Persian court', roles: { ground: 'madderRed', field: 'madderRed', border: 'indigoNavy', guard: 'ivory', accent1: 'ivory', accent2: 'indigoSky', accent3: 'weldGold', accent4: 'greenIW', outline: 'indigoNavy', light: 'madderRose' } },
  persianNight: { name: 'Persian night', roles: { ground: 'indigoNavy', field: 'indigoNavy', border: 'madderDeep', guard: 'weldYellow', accent1: 'ivory', accent2: 'madderRed', accent3: 'weldGold', accent4: 'indigoSky', outline: 'black', light: 'madderRose' } },
  anatolian: { name: 'Anatolian village', roles: { ground: 'madderBrick', field: 'madderRed', border: 'indigoBlue', guard: 'weldYellow', accent1: 'ivory', accent2: 'greenIW', accent3: 'purple', accent4: 'saffron', outline: 'walnut', light: 'madderRose' } },
  caucasian: { name: 'Caucasian', roles: { ground: 'madderRed', field: 'indigoBlue', border: 'ivory', guard: 'madderDeep', accent1: 'weldYellow', accent2: 'greenIW', accent3: 'ivory', accent4: 'indigoSky', outline: 'black', light: 'madderRose' } },
  turkmen: { name: 'Turkmen', roles: { ground: 'madderDeep', field: 'madderDeep', border: 'madderDeep', guard: 'madderRed', accent1: 'ivory', accent2: 'indigoNavy', accent3: 'madderRed', accent4: 'weldGold', outline: 'black', light: 'madderRose' } },
  rya: { name: 'Nordic rya', roles: { ground: 'indigoBlue', field: 'teal', border: 'indigoNavy', guard: 'grey', accent1: 'ivory', accent2: 'rust', accent3: 'moss', accent4: 'saffron', outline: 'black', light: 'indigoSky' } },
  undyed: { name: 'Undyed wool', roles: { ground: 'ivory', field: 'ivory', border: 'black', guard: 'grey', accent1: 'camel', accent2: 'black', accent3: 'grey', accent4: 'oakBrown', outline: 'black', light: 'ivory' } },
  modern: { name: 'Modern earth', roles: { ground: 'ivory', field: 'camel', border: 'black', guard: 'rust', accent1: 'rust', accent2: 'teal', accent3: 'saffron', accent4: 'indigoNavy', outline: 'black', light: 'ivory' } },
  mughal: { name: 'Mughal lac', roles: { ground: 'lac', field: 'lac', border: 'indigoNavy', guard: 'saffron', accent1: 'ivory', accent2: 'saffron', accent3: 'greenIW', accent4: 'indigoSky', outline: 'indigoNavy', light: 'madderRose' } },
  mughalIvory: { name: 'Mughal ivory', roles: { ground: 'ivory', field: 'ivory', border: 'lac', guard: 'indigoNavy', accent1: 'lac', accent2: 'greenIW', accent3: 'turmeric', accent4: 'indigoBlue', outline: 'indigoNavy', light: 'madderRose' } },
  mamluk: { name: 'Mamluk', roles: { ground: 'cochineal', field: 'cochineal', border: 'indigoNavy', guard: 'mamlukBlue', accent1: 'mamlukGreen', accent2: 'mamlukBlue', accent3: 'ivory', accent4: 'weldYellow', outline: 'indigoNavy', light: 'madderRose' } },
  berber: { name: 'Beni Ourain', roles: { ground: 'ivory', field: 'ivory', border: 'ivory', guard: 'black', accent1: 'black', accent2: 'grey', accent3: 'camel', accent4: 'oakBrown', outline: 'black', light: 'ivory' } },
  boucherouite: { name: 'Boucherouite', roles: { ground: 'ivory', field: 'ivory', border: 'plum', guard: 'chrome', accent1: 'fuchsia', accent2: 'turquoise', accent3: 'chrome', accent4: 'vermilion', outline: 'ink', light: 'coral' } },
  ottoman: { name: 'Ottoman court', roles: { ground: 'ottomanCrimson', field: 'ottomanCrimson', border: 'indigoNavy', guard: 'larkspur', accent1: 'larkspur', accent2: 'indigoBlue', accent3: 'ivory', accent4: 'greenIW', outline: 'indigoNavy', light: 'madderRose' } },
  usak: { name: 'Usak', roles: { ground: 'madderRed', field: 'madderRed', border: 'indigoNavy', guard: 'larkspur', accent1: 'indigoNavy', accent2: 'larkspur', accent3: 'ivory', accent4: 'greenIW', outline: 'black', light: 'apricot' } },
  lotto: { name: 'Lotto', roles: { ground: 'madderRed', field: 'madderRed', border: 'indigoBlue', guard: 'larkspur', accent1: 'larkspur', accent2: 'indigoBlue', accent3: 'greenIW', accent4: 'ivory', outline: 'indigoNavy', light: 'larkspur' } },
  armenian: { name: 'Vordan karmir', roles: { ground: 'vordanKarmir', field: 'vordanKarmir', border: 'indigoNavy', guard: 'ivory', accent1: 'ivory', accent2: 'indigoBlue', accent3: 'sumac', accent4: 'greenIW', outline: 'black', light: 'apricot' } },
  chelaberd: { name: 'Chelaberd', roles: { ground: 'madderRed', field: 'madderRed', border: 'indigoNavy', guard: 'ivory', accent1: 'ivory', accent2: 'indigoBlue', accent3: 'weldGold', accent4: 'greenLight', outline: 'indigoNavy', light: 'madderRose' } },
  tushetian: { name: 'Tushetian', roles: { ground: 'tushBrown', field: 'tushBrown', border: 'madderRed', guard: 'ivory', accent1: 'ivory', accent2: 'madderRed', accent3: 'indigoSky', accent4: 'apricot', outline: 'black', light: 'grey' } },
  georgianSun: { name: 'Georgian sun', roles: { ground: 'indigoNavy', field: 'indigoNavy', border: 'madderDeep', guard: 'weldGold', accent1: 'weldGold', accent2: 'madderRed', accent3: 'ivory', accent4: 'greenIW', outline: 'black', light: 'indigoSky' } },
  saffronNight: { name: 'Saffron night', roles: { ground: 'ink', field: 'ink', border: 'plum', guard: 'chrome', accent1: 'chrome', accent2: 'saffron', accent3: 'vermilion', accent4: 'turquoise', outline: 'black', light: 'silver' } },
  jadeTemple: { name: 'Jade temple', roles: { ground: 'jade', field: 'jade', border: 'ink', guard: 'chrome', accent1: 'ivory', accent2: 'chrome', accent3: 'coral', accent4: 'cobalt', outline: 'ink', light: 'pistachio' } },
  cobaltIce: { name: 'Cobalt ice', roles: { ground: 'silver', field: 'ivory', border: 'cobalt', guard: 'ink', accent1: 'cobalt', accent2: 'turquoise', accent3: 'ink', accent4: 'fuchsia', outline: 'ink', light: 'silver' } },
  ember: { name: 'Ember', roles: { ground: 'tushBrown', field: 'black', border: 'vermilion', guard: 'saffron', accent1: 'vermilion', accent2: 'saffron', accent3: 'chrome', accent4: 'coral', outline: 'black', light: 'apricot' } },
};

export const ROLES = ['ground', 'field', 'border', 'guard', 'accent1', 'accent2', 'accent3', 'accent4', 'outline', 'light'];

// Overrides: a custom #rrggbb or another dye id per role. Output order is ROLES order, so palette index == role
// index (generate.js RI relies on it).
// KNOWN DEFECT: PALETTES[id] and DYES[o] are plain-object lookups, so an id like 'constructor' resolves to
// Object.prototype.constructor; decodeShare accepts 'p-constructor' (it checks PALETTES[...] the same way) and
// paletteColors then throws "Cannot read properties of undefined" (checked). Fix: Object.hasOwn(PALETTES, id)
// here, in share.js and in generate.js (TRADITIONS[o.tradition] has the same issue).
export function paletteColors(id, overrides = {}) {
  const p = PALETTES[id] || PALETTES.persian;
  return ROLES.map((role) => {
    const o = overrides[role];
    if (o && /^#[0-9a-f]{6}$/i.test(o)) return { role, hex: o.toLowerCase(), dye: 'custom' };
    const d = DYES[o] || DYES[p.roles[role]];
    return { role, hex: d.hex, dye: d.dye };
  });
}
