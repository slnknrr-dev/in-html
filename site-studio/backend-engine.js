// site-studio/backend-engine.js - entry of lib/site.mjs, the Node module of a backend archive (CONTRACT.md
// §16): the landing engine (normalize, render, export — the editor's own code), the site builder, the server and the
// admin console. The editor embeds it with `new URL('./backend-engine.js?bundle', import.meta.url)`: bundle.js turns
// that into a gzip-compressed ES module bundle whose default export is this module's namespace.
export { BLOCK_TYPES, VERSION, exportHTML, normalizeDoc, walkBlocks } from './viewer.js';
export { buildSite, collectionJSON, planBackend, readmeText } from './backend-site.js';
export { startServer } from './backend-server.js';
export { adminHTML } from './backend-admin.js';
export { readZip, writeZip } from '../zip/zip.js';
