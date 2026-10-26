// Development server for this application (sources import ../ libraries, so the repository root is served; the
// shared ../server.js resolves this app from import.meta.url and mounts backend.js when the app has one).
import { serve } from '../server.js';

serve({ app: import.meta.url });
