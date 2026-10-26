// bookmarks-editor/backend.js - the hosted bookmark service as an artifact backend (targets.js / hosting.js contract):
// the default export receives the hosting context { dataDir, storage, log, name, node } and returns { handle }.
// Data: <data folder>/accounts.json, sessions.json, config.json and lib.<user id>.json (one revision log per user).
import { createBookmarkService } from './service.js';

export default function backend(ctx) {
  return createBookmarkService({ storage: ctx.storage, log: ctx.log, node: ctx.node || null });
}
