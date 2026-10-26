// body/sizes.js - size charts as data and the nearest size of a body. The charts are typical retail body-dimension
// tables (EN 13402-3 style key girths with German / continental sizes as the row key); every brand runs its own
// table, so these are a reasonable default, not a standard. Conversions: women RU = EU + 6 (RU size = bust / 2),
// UK = EU - 26, US = EU - 30; men RU = EU (= chest / 2), UK / US = chest in inches (EU - 10). Children (and teenagers
// up to 14) wear the height sizes of EN 13402 (EU / RU = the height in cm), UK and INT by age in years, US by age
// with the toddler 'T' sizes.
//
//   SIZE_SYSTEMS, SIZE_CHARTS { female: rows, male: rows, child: rows }   row = { eu, bust|chest, waist, hip, height, int }
//   sizeLabel(row, system, sex)          -> '38' / '10' / 'M' ...
//   sizeRows(sex)                        -> rows
//   nearestSize(m, sex, system?, age?)   -> { row, label, labels, delta: { key: body - chart }, score, second, child }
//   sizeBody(sex, eu)                    -> a body description whose girths are the chart's (for graded drafting)

import { normalizeBody } from './body.js';

// Data, not formulas: real charts are not linear (steps widen from 4 to 6 cm at larger sizes), and a table can be
// swapped for a brand's own without touching code. Labels for other systems are derived by fixed offsets because
// those systems are themselves defined as offsets of the continental size.
export const SIZE_SYSTEMS = ['EU', 'US', 'UK', 'RU', 'INT'];

const W = (eu, bust, waist, hip, int) => ({ eu, bust, waist, hip, height: 168, int });
const Mn = (eu, chest, waist, hip, int) => ({ eu, chest, waist, hip, height: 178, int });
// Children: height size, chest, waist, hip and the age it usually fits.
const C = (height, chest, waist, hip, age) => ({ eu: height, height, chest, waist, hip, age, int: String(age) });

export const SIZE_CHARTS = {
  female: [
    W(32, 76, 60, 84, 'XXS'), W(34, 80, 64, 88, 'XS'), W(36, 84, 68, 92, 'S'), W(38, 88, 72, 96, 'M'), W(40, 92, 76, 100, 'M'),
    W(42, 96, 80, 104, 'L'), W(44, 100, 84, 108, 'XL'), W(46, 106, 90, 114, 'XXL'), W(48, 112, 96, 120, 'XXL'),
    W(50, 118, 102, 126, '3XL'), W(52, 124, 108, 132, '3XL'), W(54, 130, 114, 138, '4XL'),
  ],
  male: [
    Mn(44, 88, 76, 92, 'XS'), Mn(46, 92, 80, 96, 'S'), Mn(48, 96, 84, 100, 'M'), Mn(50, 100, 88, 104, 'M'), Mn(52, 104, 92, 106, 'L'),
    Mn(54, 108, 96, 110, 'XL'), Mn(56, 112, 101, 114, 'XXL'), Mn(58, 116, 106, 118, 'XXL'), Mn(60, 120, 111, 122, '3XL'),
    Mn(62, 124, 116, 126, '3XL'),
  ],
  child: [
    C(86, 51, 49, 53, 1.5), C(92, 53, 50, 55, 2), C(98, 54, 51, 56, 3), C(104, 55, 51, 58, 4), C(110, 57, 52, 60, 5), C(116, 59, 53, 62, 6),
    C(122, 61, 54, 64, 7), C(128, 63, 56, 67, 8), C(134, 66, 57, 70, 9), C(140, 69, 59, 73, 10), C(146, 72, 60, 77, 11), C(152, 75, 62, 81, 12),
    C(158, 79, 64, 85, 13), C(164, 83, 66, 89, 14),
  ],
};

export const sizeRows = (sex) => SIZE_CHARTS[sex === 'child' ? 'child' : sex === 'male' ? 'male' : 'female'];
const usChild = (age) => (age < 2 ? '18M' : age <= 4 ? Math.round(age) + 'T' : String(Math.round(age)));

export function sizeLabel(row, system = 'EU', sex = 'female') {
  const male = sex === 'male';
  if (row.age != null) {
    if (system === 'US') return usChild(row.age);
    if (system === 'UK' || system === 'INT') return row.age < 2 ? '12-18m' : `${Math.round(row.age)}-${Math.round(row.age) + 1}y`;
    return String(row.height);
  }
  switch (system) {
    case 'RU': return String(male ? row.eu : row.eu + 6);
    case 'UK': return String(male ? row.eu - 10 : row.eu - 26);
    case 'US': return String(male ? row.eu - 10 : row.eu - 30);
    case 'INT': return row.int;
    default: return String(row.eu);
  }
}

// Weights encode fit priority: the bust / chest decides tops; hip and waist are secondary. A plain Euclidean distance
// would let a big waist difference override a perfect bust match.
const KEYS = { female: [['bust', 1], ['hip', 0.8], ['waist', 0.6]], male: [['chest', 1], ['waist', 0.7], ['hip', 0.5]] };

// Nearest chart row by weighted squared girth differences; `second` is the runner-up (a body between two sizes).
export function nearestSize(m, sex = 'female', system = 'EU', age = 30) {
  // Children's charts stop at 164 cm: a tall 14-year-old is matched against adult charts instead.
  const child = age < 15 && (m.stature || 170) <= 168;
  const s = child ? 'child' : sex === 'male' ? 'male' : 'female';
  // children's sizes go by height first, then the chest
  const keys = child ? [['stature', 1.2], ['chest', 0.6], ['waist', 0.3]] : KEYS[s];
  const scored = sizeRows(s).map((row) => {
    let score = 0;
    for (const [k, w] of keys) { const rk = k === 'stature' ? row.height : row[k]; const d = (m[k] ?? (k === 'chest' ? m.bust : m.chest) ?? rk) - rk; score += w * d * d; }
    return { row, score };
  }).sort((a, b) => a.score - b.score);
  const best = scored[0];
  const delta = {};
  for (const [k] of keys) delta[k] = (m[k] ?? row0(m, k)) - (k === 'stature' ? best.row.height : best.row[k]);
  return {
    row: best.row, label: sizeLabel(best.row, system, s), score: Math.sqrt(best.score),
    labels: Object.fromEntries(SIZE_SYSTEMS.map((sys) => [sys, sizeLabel(best.row, sys, s)])), delta,
    second: scored[1] ? { row: scored[1].row, label: sizeLabel(scored[1].row, system, s) } : null, child,
  };
}
const row0 = (m, k) => (k === 'chest' ? m.bust : m.chest) ?? 0;

// Body of a children's height size (sex as given): the chart girths on a body of that height and age.
// Weight from a fixed BMI of 16, only to give normalizeBody a plausible starting point;
// the chart girths are then forced via overrides.
export function childSizeBody(sex, height) {
  const rows = SIZE_CHARTS.child;
  const row = rows.find((r) => r.height === Number(height)) || rows[Math.floor(rows.length / 2)];
  const weight = 16 * (row.height / 100) ** 2;
  const B = sex === 'male' ? 'chest' : 'bust';
  return normalizeBody({ sex, height: row.height, weight, age: Math.max(2, Math.round(row.age)), overrides: { [B]: row.chest, waist: row.waist, hip: row.hip } });
}

// Body of a chart size: the chart girths as overrides on an average body of the chart height.
export function sizeBody(sex, eu) {
  const rows = sizeRows(sex);
  const row = rows.find((r) => r.eu === Number(eu)) || rows[Math.floor(rows.length / 2)];
  const B = sex === 'male' ? 'chest' : 'bust';
  const ref = sex === 'male' ? 100 : 92; // girth of the middle of the chart; weight follows it
  const height = row.height;
  const weight = (sex === 'male' ? 76 : 62) * Math.pow(row[B] / ref, 2.1) * (height / (sex === 'male' ? 178 : 168)) ** 1.0;
  const overrides = { [B]: row[B], waist: row.waist, hip: row.hip };
  if (sex !== 'male') overrides.underbust = row.bust - 13;
  return normalizeBody({ sex, height, weight, age: 30, overrides });
}
