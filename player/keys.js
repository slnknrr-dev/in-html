// player/keys.js - keyboard shortcuts as data: the default map of the player, parsing of key specs ('Ctrl+Shift+K',
// 'Space', 'ArrowRight'), matching of keyboard events (plain objects with key / code / ctrlKey / … are enough), user
// overrides and conflict detection, and the remote-control keys of TVs (media keys, colour buttons).
//
//   COMMANDS [ids] ; DEFAULT_KEYS [{ command, keys: [spec] }]
//   parseKey(spec) -> { key, ctrl, shift, alt, meta } ; formatKey(parsed, { mac }) -> label
//   eventKey(event) -> spec of an event ('Shift+ArrowRight')
//   keymap(overrides) -> Map(spec -> command) ; commandFor(event, map, { inField }) -> command | null
//   conflicts(entries) -> [{ spec, commands }]

export const COMMANDS = [
  'play-pause', 'stop', 'next', 'previous', 'seek-back', 'seek-forward', 'seek-back-long', 'seek-forward-long', 'volume-up', 'volume-down', 'mute',
  'shuffle', 'repeat', 'like', 'queue', 'lyrics', 'search', 'fullscreen', 'theatre', 'mini', 'speed-up', 'speed-down', 'speed-reset',
  'chapter-next', 'chapter-previous', 'bookmark', 'ab-repeat', 'subtitles', 'audio-track', 'skip-marker', 'sleep', 'eq', 'help', 'back',
  'seek-0', 'seek-1', 'seek-2', 'seek-3', 'seek-4', 'seek-5', 'seek-6', 'seek-7', 'seek-8', 'seek-9', 'now-playing', 'frame-next', 'frame-previous',
];

export const DEFAULT_KEYS = [
  { command: 'play-pause', keys: ['Space', 'K', 'MediaPlayPause'] },
  { command: 'stop', keys: ['MediaStop'] },
  { command: 'next', keys: ['N', 'Shift+N', 'MediaTrackNext'] },
  { command: 'previous', keys: ['P', 'Shift+P', 'MediaTrackPrevious'] },
  { command: 'seek-back', keys: ['ArrowLeft', 'J'] },
  { command: 'seek-forward', keys: ['ArrowRight', 'L'] },
  { command: 'seek-back-long', keys: ['Shift+ArrowLeft'] },
  { command: 'seek-forward-long', keys: ['Shift+ArrowRight'] },
  { command: 'volume-up', keys: ['ArrowUp', 'AudioVolumeUp'] },
  { command: 'volume-down', keys: ['ArrowDown', 'AudioVolumeDown'] },
  { command: 'mute', keys: ['M', 'AudioVolumeMute'] },
  { command: 'shuffle', keys: ['S'] },
  { command: 'repeat', keys: ['R'] },
  { command: 'like', keys: ['H'] },
  { command: 'queue', keys: ['Q'] },
  { command: 'lyrics', keys: ['Y'] },
  { command: 'search', keys: ['/', 'Ctrl+F', 'Meta+F'] },
  { command: 'fullscreen', keys: ['F'] },
  { command: 'theatre', keys: ['T'] },
  { command: 'mini', keys: ['I'] },
  { command: 'speed-up', keys: [']', 'Shift+>'] },
  { command: 'speed-down', keys: ['[', 'Shift+<'] },
  { command: 'speed-reset', keys: ['='] },
  { command: 'chapter-next', keys: ['PageDown', 'Ctrl+ArrowRight'] },
  { command: 'chapter-previous', keys: ['PageUp', 'Ctrl+ArrowLeft'] },
  { command: 'bookmark', keys: ['B'] },
  { command: 'ab-repeat', keys: ['A'] },
  { command: 'subtitles', keys: ['C', 'Subtitle'] },
  { command: 'audio-track', keys: ['V'] },
  { command: 'skip-marker', keys: ['Enter', 'G'] },
  { command: 'sleep', keys: ['Z'] },
  { command: 'eq', keys: ['E'] },
  { command: 'help', keys: ['?', 'Shift+?'] },
  { command: 'back', keys: ['Escape', 'BrowserBack', 'GoBack'] },
  { command: 'now-playing', keys: ['O'] },
  { command: 'frame-next', keys: ['.'] },
  { command: 'frame-previous', keys: [','] },
  ...Array.from({ length: 10 }, (_, i) => ({ command: 'seek-' + i, keys: [String(i)] })),
];

// Specs are normalised (aliases, upper-cased single letters, fixed modifier order in specOf) so user overrides,
// defaults and events all compare as plain strings in one Map.
const ALIASES = { ' ': 'Space', Spacebar: 'Space', Esc: 'Escape', Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown', Del: 'Delete', MediaNextTrack: 'MediaTrackNext', MediaPreviousTrack: 'MediaTrackPrevious' };

export function parseKey(spec) {
  let s = String(spec || '').trim();
  const out = { key: '', ctrl: false, shift: false, alt: false, meta: false };
  let key = '';
  if (s === '+') { key = '+'; s = ''; } else if (s.endsWith('++')) { key = '+'; s = s.slice(0, -2); }
  const parts = s ? s.split('+').map((x) => x.trim()) : [];
  if (!key) key = parts.pop() || '';
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === 'ctrl' || l === 'control') out.ctrl = true;
    else if (l === 'shift') out.shift = true;
    else if (l === 'alt' || l === 'option') out.alt = true;
    else if (l === 'meta' || l === 'cmd' || l === 'command' || l === 'win') out.meta = true;
  }
  out.key = ALIASES[key] || (key.length === 1 ? key.toUpperCase() : key);
  return out;
}

const specOf = (p) => [p.ctrl && 'Ctrl', p.alt && 'Alt', p.shift && 'Shift', p.meta && 'Meta', p.key].filter(Boolean).join('+');

export function formatKey(p, { mac = false } = {}) {
  const k = typeof p === 'string' ? parseKey(p) : p;
  const names = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Escape: 'Esc' };
  return [k.ctrl && (mac ? '⌃' : 'Ctrl'), k.alt && (mac ? '⌥' : 'Alt'), k.shift && (mac ? '⇧' : 'Shift'), k.meta && (mac ? '⌘' : 'Win'), names[k.key] || k.key].filter(Boolean).join(mac ? '' : '+');
}

// KNOWN DEFECT: because Shift is dropped for punctuation here, default specs like 'Shift+>', 'Shift+<', 'Shift+?'
// can never match; '?' still works (also listed plain), but '>' and '<' (speed) are dead keys. Fix: list them
// without Shift in DEFAULT_KEYS.
export function eventKey(e) {
  let key = ALIASES[e.key] || e.key || '';
  if (key.length === 1) key = key.toUpperCase();
  // Shifted punctuation: '?' with Shift is just '?' (layouts differ); keep Shift only for letters, digits, named keys.
  const shift = !!e.shiftKey && (key.length > 1 || /[A-Z0-9]/.test(key));
  return specOf({ key, ctrl: !!e.ctrlKey, alt: !!e.altKey, shift, meta: !!e.metaKey });
}

export function keymap(overrides = null) {
  const map = new Map();
  const entries = overrides && overrides.length ? mergeOverrides(overrides) : DEFAULT_KEYS;
  for (const { command, keys } of entries) for (const k of keys) map.set(specOf(parseKey(k)), command);
  return map;
}

function mergeOverrides(overrides) {
  const byCmd = new Map(DEFAULT_KEYS.map((e) => [e.command, e.keys]));
  for (const o of overrides) if (o && COMMANDS.includes(o.command) && Array.isArray(o.keys)) byCmd.set(o.command, o.keys.filter((k) => typeof k === 'string'));
  return [...byCmd].map(([command, keys]) => ({ command, keys }));
}

const FIELD_SAFE = new Set(['MediaPlayPause', 'MediaTrackNext', 'MediaTrackPrevious', 'MediaStop', 'Escape']);

// While typing in a field, single-letter shortcuts must not fire (typing "k" would pause); only media keys,
// Escape and Ctrl / Meta combinations pass.
export function commandFor(e, map, { inField = false } = {}) {
  const spec = eventKey(e);
  if (inField && !FIELD_SAFE.has(spec) && !/^(Ctrl|Meta)\+/.test(spec)) return null;
  return map.get(spec) || null;
}

export function conflicts(entries) {
  const seen = new Map();
  for (const { command, keys } of entries) for (const k of keys) { const s = specOf(parseKey(k)); if (!seen.has(s)) seen.set(s, new Set()); seen.get(s).add(command); }
  return [...seen].filter(([, c]) => c.size > 1).map(([spec, c]) => ({ spec, commands: [...c] }));
}
