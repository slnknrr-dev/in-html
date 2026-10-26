// Development server for this application (sources import ../ libraries, so the repository root is served).
// Dev-only; the published app is five static pages sharing one localStorage model.
import { serve } from '../server.js';

serve({ app: import.meta.url });
