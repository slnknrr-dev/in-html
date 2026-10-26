// Development server for this application (sources import ../ libraries, so the repository root is served).
// Dev-only: the published artifact is a single offline HTML file built by singlefile.js; no backend exists.
import { serve } from '../server.js';

serve({ app: import.meta.url });
