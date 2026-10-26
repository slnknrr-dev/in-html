// language-studio/backend.js - the server side of Language Studio for BACKEND builds and the development server
// (targets.js / hosting.js contract): accounts and the progress of each learner (service.js).
// Data: <data folder>/accounts.json, sessions.json and progress.<user id>.json.
import { createStudioService } from './service.js';

export default function backend(ctx) {
  return createStudioService({ storage: ctx.storage, log: ctx.log });
}
