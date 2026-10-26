// site-studio/backend.js - the backend of the application's BACKEND / ELECTRON artifacts (hosting.js mounts it).
// Contract: default export (ctx) => ({ handle(req, res, url) }). Wiki bases of a team (wiki-backend.js).
import wiki from './wiki-backend.js';

export default function backend(ctx) {
  const parts = [wiki(ctx)];
  return { async handle(req, res, url) { for (const p of parts) if (await p.handle(req, res, url)) return true; return false; } };
}
