// Development server for this application (sources import ../ libraries, so the repository root is served); it also
// mounts backend.js, so the backend API answers at /bitcoin-wallet/api/ (configure it with the BTC_* variables, see
// README.md).
import { serve } from '../server.js';

serve({ app: import.meta.url });
