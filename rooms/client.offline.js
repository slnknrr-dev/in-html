// rooms/client.offline.js - rooms/client.js for offline artifacts (bundle.js variant 'offline'): local rooms only.
// The exports are the same, so the application code does not change; connect() returns a server whose calls fail,
// and `networked` is false so the interface can hide online play. This file contains no network API.
//
// Swapped in at bundle time instead of client.js, so the offline artifact contains no fetch / EventSource code at
// all: the build's policy check (no network APIs in offline files) passes by construction, not by dead-code hope.

export { localRoom } from './local.js';
export const networked = false;

const unavailable = () => Promise.reject(Object.assign(new Error('this offline build has no online play'), { status: 0 }));

export function connect(serverUrl = '') {
  return { url: serverUrl, info: unavailable, list: unavailable, create: unavailable, join: unavailable, open: () => { throw new Error('this offline build has no online play'); } };
}

export function inviteLink(pageUrl, serverUrl, roomId, invite) {
  const p = String(pageUrl).split('#')[0];
  const q = new URLSearchParams({ room: roomId, ...(serverUrl ? { server: serverUrl } : {}), ...(invite ? { invite } : {}) });
  return `${p}#${q}`;
}

export function parseInvite() { return null; }
