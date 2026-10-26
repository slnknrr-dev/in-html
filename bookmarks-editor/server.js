// Development server for this application (sources import ../ libraries, so the repository root is served); it
// mounts ./backend.js like the generated servers do (data in bookmarks-editor/.data/).
import { serve } from '../server.js';

serve({ app: import.meta.url });
