// Development server for this application (sources import ../ libraries, so the repository root is served; the
// shared ../server.js resolves the app folder from import.meta.url and mounts <app>/backend.js when one exists).
import { serve } from '../server.js';

serve({ app: import.meta.url });
