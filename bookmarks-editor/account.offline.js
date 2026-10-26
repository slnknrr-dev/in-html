// bookmarks-editor/account.offline.js - account.js for offline artifacts (bundle.js variant 'offline'): the same
// exports without accounts, synchronisation or any network code. The library lives in this browser only.
import { t } from '../ui/i18n.js';

export const networked = false;

export async function startAccount() {
  return { dbName: 'in-html-bookmarks', account: null };
}

export const errText = (e) => t('bm.err.generic', { msg: (e && e.message) || String(e) });

export function bookmarklet() { return ''; }
