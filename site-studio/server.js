// Development server for this application (sources import ../ libraries, so the repository root is served). The mock
// JSON API (/api/*) lets configured requests be tried against a real HTTP endpoint during development.
import { serve } from '../server.js';

serve({ app: import.meta.url, api: true });
