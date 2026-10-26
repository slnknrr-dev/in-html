// garment/layers.js - garments worn over garments: every layer of an outfit has a thickness (its shell, a lining, the
// loft of an insulation), and a garment drafted over others needs that much more room. The girths a pattern is
// drafted from grow by 2 pi times the thickness of the layers under it where they lie (a shirt under a jacket adds to
// the chest, the waist, the arms; a tucked shirt adds to the trousers' waist; trousers add to the hips of a coat).
//
//   REGION[garment]                 'top' | 'bottom' | 'full' | 'waist' | 'bag'
//   layerThickness(spec, mmOf)      cm of one garment: mmOf(material) -> fabric thickness in mm (fabric/fabric.js props)
//   outfitLayers(specs, mmOf, over) per garment of an outfit (inside -> outside): the `under` list for draftGarment;
//                                   over(i) -> a thickness override in cm or null
//   layeredMeasurements(m, under, region) -> the measurements with the room for the layers beneath

//
// Model: a layer of thickness t wrapped round a body of girth G raises the girth of the next layer to G + 2 pi t
// (circumference of a circle grows by 2 pi per unit radius). Real cross-sections are not circles, so the extra is
// distributed with empirical factors per region (hips 0.8 of the torso layer, partial transfer of tucked tops).
export const REGION = {
  tshirt: 'top', longsleeve: 'top', tank: 'top', sweatshirt: 'top', hoodie: 'top', shirt: 'top', waistcoat: 'top', jacket: 'top',
  bomber: 'top', puffer: 'top', trucker: 'top', kosovorotka: 'top', cummerbund: 'waist', belt: 'waist',
  trousers: 'bottom', skirt: 'bottom',
  dress: 'full', chokha: 'full', arkhaluk: 'full', kartuli: 'full', kaftan: 'full', rubakha: 'full', sarafan: 'full', parka: 'full',
  tote: 'bag',
};
const SLEEVED = new Set(['tshirt', 'longsleeve', 'sweatshirt', 'hoodie', 'shirt', 'jacket', 'bomber', 'puffer', 'trucker', 'kosovorotka', 'dress', 'chokha', 'arkhaluk', 'kartuli', 'kaftan', 'rubakha', 'parka']);
// Garments worn tucked in (their hem lies inside the waistband of the bottoms put on over them).
const TUCKED = new Set(['shirt', 'tshirt', 'longsleeve', 'tank', 'kosovorotka']);

const has = (spec, type) => Array.isArray(spec.details) && spec.details.some((c) => c.type === type);

/** Thickness of one garment in cm: shell, lining, insulation (wadding with its loft), plus a little air. */
// Fabric thickness comes from the material model in mm and is converted to cm; insulation uses the explicit loft or
// a wadding default; +0.05 cm models the air gap between layers.
export function layerThickness(spec, mmOf = () => 0.4) {
  let t = (mmOf('shell') || 0.4) / 10;
  if (has(spec, 'lining')) t += (mmOf('lining') || 0.12) / 10;
  const loft = spec.opts?.loft || 0;
  if (loft || has(spec, 'quilting')) t += loft || (mmOf('wadding') || 5) / 10;
  return t + 0.05;
}

/** The `under` list of every garment of an outfit. */
// Order is inside -> outside: each garment gets all earlier garments as its `under` list. Bags do not add room.
export function outfitLayers(specs, mmOf = () => () => 0.4, over = () => null) {
  const layers = specs.map((s, i) => ({
    region: REGION[s.garment] || 'top', sleeves: SLEEVED.has(s.garment) && s.opts?.sleeve !== 'none', tucked: TUCKED.has(s.garment) && s.opts?.tucked !== false,
    t: over(i) ?? layerThickness(s, mmOf(i)), garment: s.garment,
  }));
  return layers.map((_, i) => layers.slice(0, i).filter((x) => x.region !== 'bag'));
}

/** Measurements with the room for the layers under a garment of `region`. */
// Returns a new object (inputs untouched) with every girth-derived measurement updated consistently, including widths
// derived from the bust (back/chest width) and a small shoulder-length increase; the totals are stored in r.layers
// for display. Unchanged measurements return the same object m (cheap identity check for callers).
export function layeredMeasurements(m, under, region) {
  if (!under || !under.length || region === 'bag') return m;
  let torso = 0, waist = 0, hip = 0, arm = 0;
  for (const u of under) {
    const ring = 2 * Math.PI * u.t;
    if (region === 'top' || region === 'full') {
      if (u.region === 'top' || u.region === 'full') { torso += ring; waist += ring; hip += ring * 0.8; if (u.sleeves) arm += ring; }
      if (u.region === 'bottom') { waist += ring; hip += ring; }
      if (u.region === 'waist') waist += ring;
      if (region === 'full' && u.region === 'bottom') hip += ring * 0.2;
    } else if (region === 'bottom') {
      if (u.region === 'bottom' || u.region === 'full') { waist += ring; hip += ring; }
      else if (u.region === 'top' && u.tucked) { waist += ring; hip += ring * 0.6; }
    } else if (region === 'waist') {
      waist += ring;
      hip += ring * 0.5;
    }
  }
  if (!torso && !waist && !hip && !arm) return m;
  const r = { ...m, layers: { torso, waist, hip, arm } };
  r.B = m.B + torso; r.W = m.W + waist; r.Hp = m.Hp + hip;
  if (m.bust != null) r.bust = m.bust + torso;
  if (m.chest != null) r.chest = m.chest + torso;
  r.waist = m.waist + waist; r.hip = m.hip + hip; r.highHip = (m.highHip ?? m.hip) + (waist + hip) / 2;
  r.upperArm = m.upperArm + arm; r.elbow = (m.elbow ?? m.upperArm) + arm; r.wrist = m.wrist + arm * 0.5;
  r.neckBase = m.neckBase + torso * 0.25;
  r.backWidth = (m.backWidth ?? m.B * 0.39) + torso * 0.18;
  r.chestWidth = (m.chestWidth ?? m.B * 0.37) + torso * 0.16;
  r.shoulderLength = m.shoulderLength + torso / (2 * Math.PI) * 0.4;
  r.thigh = (m.thigh ?? m.hip * 0.56) + (region === 'bottom' ? hip * 0.5 : 0);
  return r;
}
