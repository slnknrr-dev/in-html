// seo-kit/kit.js - the site model of SEO Kit: the library module seo/site.js (shared with Site Studio).
export * from '../seo/site.js';
// Re-export instead of a copy: one site model (schema, normalisation, generators) for both apps, and the build
// bundles it once. This file is the app's seam: pages import ./kit.js, so the library path can move without
// touching them.
