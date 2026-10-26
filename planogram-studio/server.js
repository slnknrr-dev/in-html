// Development server for this application (sources import ../ libraries, so the repository root is served).
// Dev-only; the published app is two static pages with the project kept in localStorage.
import { serve } from '../server.js';

serve({ app: import.meta.url });
