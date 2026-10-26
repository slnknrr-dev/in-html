// Development server for this application (sources import ../ libraries, so the repository root is served); it also
// mounts backend.js, so the backend API answers at /ethereum-wallet/api/ (configure it with the ETH_* variables, see
// README.md). Why the root: modules use relative imports such as ../ethereum/rpc.js; serving only this folder would
// 404 them. Dev-only, not part of any build artifact.
import { serve } from '../server.js';

serve({ app: import.meta.url });
