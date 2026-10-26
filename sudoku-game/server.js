// Development server for this application (sources import ../ libraries, so the repository root is served).
import { serve } from '../server.js';

serve({ app: import.meta.url });
