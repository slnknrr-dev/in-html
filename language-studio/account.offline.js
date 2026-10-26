// language-studio/account.offline.js - account.js for offline and serverless artifacts (bundle.js variant 'offline'):
// the same exports without accounts or any network code. Progress lives in this browser only (IndexedDB).
// Why a separate module instead of an `if (offline)` inside account.js: the offline artifact must contain no network
// API at all (the build's policy check scans for fetch and friends), and dead code behind a flag would still ship.
// The bundler swaps the module by name, so callers import './account.js' in every build. Keep the exports in sync.
import { t } from '../ui/i18n.js';

export const networked = false;

export async function startAccount() { return null; }

export const errText = (e) => t('ls.err.generic', { msg: (e && e.message) || String(e) });
