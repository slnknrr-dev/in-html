// Development server for this application (sources import ../ libraries, so the repository root is served).
import { serve } from '../server.js';

// `app: import.meta.url` lets the shared server locate this app's folder from the module URL itself: no path
// literal to drift when the folder is renamed. The repository root is the document root because every source
// imports siblings via '../' (ui/, codec/, minify/); serving only this folder would 404 those imports.
serve({ app: import.meta.url });
