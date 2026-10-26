// Development server for this application (sources import ../ libraries, so the repository root is served).
// ES modules do not load from file:// in most browsers (CORS on module scripts), hence a server for development;
// the single-file build (singlefile.js) inlines everything and needs none.
import { serve } from '../server.js';

serve({ app: import.meta.url });
