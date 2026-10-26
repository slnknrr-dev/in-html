// Development server for this application (sources import ../ libraries, so the repository root is served); it also
// mounts backend.js, so the API and the admin console work at /funding-studio/api and /funding-studio/admin.html.
// The shared dev server discovers backend.js next to this file (app: import.meta.url) and mounts its handle() before
// static file serving. ES modules need http(s) anyway (module scripts are blocked from file://).
import { serve } from '../server.js';

serve({ app: import.meta.url });
