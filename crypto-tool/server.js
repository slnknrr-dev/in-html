// crypto-tool/server.js - development server for this application. Sources import ../ libraries, so the shared
// server (../server.js) serves the repository root; file:// would block ES module imports.
import { serve } from '../server.js';

serve({ app: import.meta.url });
