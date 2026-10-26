// site-studio/templates-kit.js - landing template building kit (on sample/kit.js).
//
// Shared primitives of the template modules: pure builders (same input, same output; randomness only from seeded
// tplRand / tplHash), returning plain document fragments, SVG strings or bytes. Templates compose them; nothing here
// reads editor state or the DOM, so they run in tests and in Node.
import { tplBaseKit, tplSampleFiles } from '../sample/kit.js';

// Sample PDFs of the landing templates.
const LANDING_PDF = { producer: 'lp landing builder', creator: 'lp landing templates' };

/**
 * Landing builder kit: the shared base kit (sample/kit.js: L, B, id, icon, addAtt, svg, text, cell, mcell, table) plus
 *   btn(label, href, kind)  hero/cta/buttons item.
 *   item(props)     generic list item with an id (props copied; i18n values must already be L(...)).
 *   head / sec      heading and section blocks.
 *   doc(o)          base landing doc: o = {name, title, description, author, keywords, preset, theme, output,
 *                   shop, requests, defaultLang}; theme preset vars are copied in as the editor does.
 * Templates fill d.regions.header / main / footer and return V.normalizeDoc(d).
 */
function tplKit(V, langs) {
  const files = tplSampleFiles(V, { pdf: LANDING_PDF });
  const K = tplBaseKit(V, langs, files);
  const { L, B, id } = K;
  return Object.assign(K, {
    btn: (label, href = '#', kind = 'primary', icon = '') => ({ id: id(), label: L(label), href, kind, icon }),
    item: (props = {}) => ({ id: id(), ...props }),
    head: (text, level = 2, extra = {}) => B('heading', { text: L(text), level, ...extra }),
    sec: (o, blocks) => B('section', {
      ...o,
      eyebrow: L(o.eyebrow || ''), title: L(o.title || ''), lead: L(o.lead || ''),
      blocks: blocks || [],
    }),
    doc(o) {
      const d = V.newDoc({ langs, defaultLang: o.defaultLang || langs[0] });
      const now = new Date().toISOString();
      d.name = o.name;
      d.langs = langs.slice();
      d.defaultLang = o.defaultLang || langs[0];
      d.meta = {
        ...(d.meta || {}),
        title: L(o.title || ''), description: L(o.description || ''),
        author: o.author || '', keywords: o.keywords || '', created: now, modified: now,
        ...(o.meta || {}),
      };
      const preset = V.THEMES && Object.prototype.hasOwnProperty.call(V.THEMES, o.preset) ? V.THEMES[o.preset] : null;
      d.theme = { ...(d.theme || {}), ...((preset && preset.vars) || {}), preset: preset ? o.preset : (d.theme && d.theme.preset), ...(o.theme || {}) };
      d.output = { ...(d.output || {}), ...(o.output || {}) };
      if (o.output && o.output.ageGate) d.output.ageGate = { ...((d.output && d.output.ageGate) || {}), ...o.output.ageGate };
      if (o.shop) {
        d.shop = { ...(d.shop || {}), ...o.shop };
        d.shop.checkout = { ...((d.shop && d.shop.checkout) || {}), ...(o.shop.checkout || {}) };
      }
      d.requests = Array.isArray(o.requests) ? o.requests : (d.requests || []);
      d.regions = { header: [], main: [], footer: [] };
      d.attachments = K.atts;
      return d;
    },
  });
}

export {
  tplKit
};
