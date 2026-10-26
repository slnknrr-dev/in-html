// regexp-app/server.js - development server for this application. Sources import ../ libraries, so the shared
// server (../server.js) serves the repository root and opens this app; file:// would block the ES module imports.
import { serve } from '../server.js';

serve({ app: import.meta.url });
