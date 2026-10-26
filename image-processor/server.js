// Development server for this application (sources import ../ libraries, so the repository root is served).
// Dev-only; images are processed entirely in the browser (and its workers), nothing is uploaded.
import { serve } from '../server.js';

serve({ app: import.meta.url });
