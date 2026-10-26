// util/id.js - short random ids.

// For DOM ids and local record keys, not secrets or global uniqueness: 26 * 36^7 ~ 2e12 values, so the birthday
// bound puts a 50 % collision chance near 1.7e6 ids. Callers storing millions of records need a longer id.
// Modulo bias (256 % 36 = 4, 256 % 26 = 22) makes a few characters slightly likelier. Accepted: these are not
// security tokens, and rejection sampling would add code for no observable gain.
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

// 8 chars [a-z0-9]; the first one is a letter so ids are always valid fragment/CSS identifiers.
export function uid() {
  const bytes = new Uint8Array(8);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  // Fallback for runtimes without Web Crypto: uniqueness only, never unpredictability.
  else for (let i = 0; i < 8; i++) bytes[i] = (Math.random() * 256) | 0;
  let s = ID_CHARS[bytes[0] % 26];
  for (let i = 1; i < 8; i++) s += ID_CHARS[bytes[i] % 36];
  return s;
}
