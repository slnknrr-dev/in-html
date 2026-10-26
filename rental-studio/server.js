// Development server for this application (sources import ../ libraries, so the repository root is served).
// Dev-only; the published app is static HTML (four pages) with all data in the browser's localStorage.
import { serve } from '../server.js';

serve({ app: import.meta.url });
