// Development server for this application (sources import ../ libraries, so the repository root is served); it also
// mounts backend.js, so the file API, the catalogue, scans and jobs work at /media-player/api/ (trusted, mode 'dev').
// Folders: MP_ROOTS=<dir>;<dir> node media-player/server.js
import { serve } from '../server.js';

serve({ app: import.meta.url });
