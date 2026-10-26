// Development server for this application (sources import ../ libraries, so the repository root is served); it also
// mounts backend.js, so online rooms work at /api.
import { serve } from '../server.js';

serve({ app: import.meta.url });
