// site-studio/templates.js - the template catalogue of Site Studio in three groups (gallery sections, studio/gallery.js):
//   kb       knowledge base & wiki — wikis, documentation, study and law bases (templates-wiki.js builds the knowledge
//            base templates as sites: wiki blocks, versions, layers, 451 sections)
//   landing  landing & serverless — one file or static hosting with the owner's endpoints
//   backend  backend site — sites with their own server: accounts, roles, closed sections, content edited online
// Each template says the least it needs (mode: offline = green, serverless = yellow, backend = red; the label the
// gallery shows), which modules it uses (modules.req) or may use (modules.opt), and a note on what changes in a
// simpler package.
import { TPL_DANCE } from './templates-dance.js';
import { TPL_WINERY } from './templates-winery.js';
import { TPL_METALLURGY } from './templates-industry.js';
import { TPL_AGRO } from './templates-agro.js';
import { TPL_LEGAL } from './templates-legal.js';
import { TPL_REALTY } from './templates-realty.js';
import { TPL_LIBRARY } from './templates-library.js';
import { TPL_BOOKS } from './templates-books.js';
import { TPL_AUDIO } from './templates-audio.js';
import { TPL_PORTAL } from './templates-portal.js';
import { TPL_BLANK } from './templates-blank.js';
import { TPL_APARTMENTS, TPL_EVENT, TPL_FUND, TPL_README, TPL_SHOP_LITE, TPL_SPECIALIST, both } from './templates-landing2.js';
import { TPL_AGENCY, TPL_CONFERENCE, TPL_HOTEL, TPL_MEMBERS, TPL_REGION, TPL_RETAIL, TPL_SCHOOL, TPL_STORE } from './templates-backend.js';
import { TPL_DOCS, TPL_TEAMKB } from './templates-kb2.js';
import { WIKI_SITE_TEMPLATES } from './templates-wiki.js';

// Knowledge base templates are looked up by id from the generated list; a missing id yields undefined, which the
// gallery would show as a broken card, so test.js checks every catalogue entry's metadata.
const KBT = (id) => WIKI_SITE_TEMPLATES.find((x) => x.id === 'kb-' + id);

export const TEMPLATE_GROUPS = [
  { id: 'kb', label: 'tpg.kb', desc: 'tpg.kbD' },
  { id: 'landing', label: 'tpg.landing', desc: 'tpg.landingD' },
  { id: 'backend', label: 'tpg.backend', desc: 'tpg.backendD' },
];

// Metadata is attached here for the older landing templates (their modules predate the gallery groups); newer modules
// declare group / mode themselves. Spread copy: the imported template object is never mutated.
const meta = (tpl, group, mode, req, opt, note) => ({ ...tpl, group, mode, modules: { req, opt }, ...(note ? { note } : {}) });

// Array order is the gallery order within each group.
export const TEMPLATES = [
  // knowledge base & wiki
  KBT('wiki'), TPL_DOCS, meta(TPL_PORTAL, 'kb', 'serverless', ['portal', 'search', 'pages'], ['forms', 'seo']),
  ...['fandom', 'news', 'songs', 'gaudiya', 'japanese', 'georgian', 'portal'].map(KBT), TPL_TEAMKB, KBT('blank'),
  // landing & serverless
  TPL_SPECIALIST, TPL_EVENT, TPL_APARTMENTS, TPL_SHOP_LITE, TPL_FUND, TPL_README,
  meta(TPL_DANCE, 'landing', 'serverless', ['events', 'forms', 'pages'], ['cart', 'media']),
  meta(TPL_WINERY, 'landing', 'serverless', ['cart', 'checkout', 'events'], ['map', 'langs']),
  meta(TPL_METALLURGY, 'landing', 'serverless', ['cart', 'forms', 'collection'], ['table']),
  meta(TPL_AGRO, 'landing', 'serverless', ['cart', 'forms', 'collection'], ['map']),
  meta(TPL_LEGAL, 'landing', 'serverless', ['forms', 'pages'], ['contract', 'chat']),
  meta(TPL_REALTY, 'landing', 'serverless', ['collection', 'forms'], ['estate', 'map']),
  meta(TPL_LIBRARY, 'landing', 'offline', ['collection', 'reader'], ['search']),
  meta(TPL_BOOKS, 'landing', 'serverless', ['cart', 'collection', 'reader'], ['payments']),
  meta(TPL_AUDIO, 'landing', 'offline', ['media', 'collection'], ['cart']),
  meta(TPL_BLANK, 'landing', 'offline', ['pages'], []),
  // backend sites
  TPL_REGION, TPL_STORE, TPL_AGENCY, TPL_MEMBERS, TPL_HOTEL, TPL_SCHOOL, TPL_CONFERENCE, TPL_RETAIL,
];
