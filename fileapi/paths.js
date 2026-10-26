// fileapi/paths.js - safe relative paths below mount roots, hidden names, stable mount ids. Pure: Node modules are
// passed in (`{ fs, path }`), so the module also loads in browsers (where only the string helpers are useful).
//
//   normRel(rel, { platform }?)   -> normalized relative path with '/' separators ('' = the root) or null when unsafe.
//                                    `rel` is already percent-decoded text. Refused: '..' segments, NUL and control
//                                    characters, ':' anywhere (drive letters, NTFS alternate data streams), a leading
//                                    '/' or '\' (absolute), Windows device names (CON, NUL, COM1, LPT1.txt, ...),
//                                    segments ending with a dot or a space (Windows strips them: 'a.' is 'a', '.. ' is
//                                    '..'), segments longer than 255 characters, paths longer than 4096; with
//                                    platform 'win32' also the characters < > " | ? * (wildcards there). '\' is a
//                                    separator like '/'; '.' and empty segments collapse.
//   joinRel(a, b)                 -> normRel(a + '/' + b) (null when unsafe)
//   parentRel(rel)                -> the parent ('' for top-level entries and for the root)
//   baseName(rel)                 -> the last segment ('' for the root)
//   extOf(name)                   -> lower-case extension without the dot ('' when none; '.bashrc' has none)
//   isHiddenName(name)            -> dotfiles and system clutter: $RECYCLE.BIN, RECYCLER, System Volume Information,
//                                    Thumbs.db, desktop.ini, @eaDir, .DS_Store, lost+found, ...
//   compareNames(a, b)            -> natural order ('2' < '10', case-insensitive, then code points for stability)
//   resolveSafe({ fs, path }, rootAbs, rel, { allowHidden = false, platform }?) -> absolute path or null:
//                                    normRel + join + fs.realpathSync check that the real path stays inside the real
//                                    root (symlinks / junctions that escape are refused). The target may not exist
//                                    yet (uploads): the real path of its deepest existing ancestor is checked.
//   isInside(rootReal, real, platform, sep) -> true when `real` is `rootReal` or below it (case-insensitive on win32)
//   mountId(absPath, platform?)   -> stable 10-character lower-case base32 id of a normalized absolute path
//                                    (FNV-1a 64 of the UTF-8 bytes; win32 paths are compared case-insensitively and
//                                    with either separator)
//   fnv64(text)                   -> FNV-1a 64 hash of the UTF-8 bytes as 16 hex digits (cache keys)

// Defence in depth: the string checks (normRel) reject what is never legitimate, on EVERY platform - a share mounted
// from Linux may be served to Windows tools later, and a file named 'CON' or 'a:b' would be unreachable or worse
// there. The filesystem check (resolveSafe) then catches what strings cannot see: symlinks and junctions.
// Device names match with any extension ('nul.txt' is still the device on Windows) and the superscript digits that
// Windows also treats as COM/LPT ports.
const DEVICE = /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\s*\..*)?$/i;
const CONTROL = /[\x00-\x1f\x7f]/;
const WIN_BAD = /[<>"|?*]/;

const HIDDEN = new Set(['$recycle.bin', 'recycler', 'system volume information', 'thumbs.db', 'ehthumbs.db', 'desktop.ini',
  '@eadir', '.ds_store', 'lost+found', '$windows.~bt', '$windows.~ws', 'pagefile.sys', 'hiberfil.sys', 'swapfile.sys']);

const defaultPlatform = () => (globalThis.process && typeof globalThis.process.platform === 'string' ? globalThis.process.platform : 'linux');

// Reject, never repair: '..' is refused rather than resolved, because "normalising" an attack path into a valid one
// hides the attack and invites double-decoding tricks. Input must already be percent-decoded exactly once by the
// caller; decoding here again would let '%252e%252e' become '..'.
export function normRel(rel, { platform } = {}) {
  if (rel === undefined || rel === null) return '';
  if (typeof rel !== 'string') return null;
  if (rel.length > 4096 || CONTROL.test(rel) || rel.includes(':')) return null;
  if (rel[0] === '/' || rel[0] === '\\') return null;
  if (platform === 'win32' && WIN_BAD.test(rel)) return null;
  const out = [];
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return null;
    if (seg.length > 255) return null;
    if (/[. ]$/.test(seg)) return null;
    if (DEVICE.test(seg)) return null;
    out.push(seg);
  }
  return out.join('/');
}

export function joinRel(a, b) {
  const x = normRel(a), y = normRel(b);
  if (x === null || y === null) return null;
  return normRel(x && y ? x + '/' + y : x || y);
}

export function parentRel(rel) {
  const n = String(rel || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const i = n.lastIndexOf('/');
  return i < 0 ? '' : n.slice(0, i);
}

export function baseName(rel) {
  const n = String(rel || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return n.slice(n.lastIndexOf('/') + 1);
}

export function extOf(name) {
  const b = baseName(name);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}

export function isHiddenName(name) {
  const n = String(name || '');
  return n.startsWith('.') || HIDDEN.has(n.toLowerCase());
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator('en', { numeric: true, sensitivity: 'base' }) : null;

export function compareNames(a, b) {
  const c = collator ? collator.compare(a, b) : 0;
  return c || (a < b ? -1 : a > b ? 1 : 0);
}

// Prefix test WITH a trailing separator: plain startsWith would accept '/srv/media-private' as inside '/srv/media'.
export function isInside(rootReal, real, platform = defaultPlatform(), sep = platform === 'win32' ? '\\' : '/') {
  const fold = platform === 'win32' ? (s) => s.toLowerCase() : (s) => s;
  const r = fold(rootReal), x = fold(real);
  if (x === r) return true;
  const pre = r.endsWith(sep) || r.endsWith('/') ? r : r + sep;
  return x.startsWith(pre);
}

// Returns `abs` (the joined path), not the real path, so error messages and listings keep the user's view of the
// tree. Limitation inherent to check-then-use: a symlink swapped in between this check and the later open (TOCTOU)
// is not caught; that requires an attacker with write access inside the mount, which the threat model excludes.
// Any realpath error other than "does not exist" (EACCES, ELOOP) refuses - fail closed.
export function resolveSafe({ fs, path }, rootAbs, rel, { allowHidden = false, platform = defaultPlatform() } = {}) {
  const n = normRel(rel, { platform });
  if (n === null) return null;
  if (!allowHidden && n && n.split('/').some(isHiddenName)) return null;
  let rootReal;
  try { rootReal = fs.realpathSync(rootAbs); } catch { return null; }
  const abs = n ? path.join(rootAbs, ...n.split('/')) : path.resolve(rootAbs);
  // The real path of the target, or of its deepest existing ancestor plus the names that do not exist yet.
  let probe = abs;
  const tail = [];
  for (let guard = 0; guard < 4096; guard++) {
    let real;
    try { real = fs.realpathSync(probe); } catch (e) {
      if (!e || (e.code !== 'ENOENT' && e.code !== 'ENOTDIR')) return null;
      const parent = path.dirname(probe);
      if (parent === probe) return null;
      tail.unshift(path.basename(probe));
      probe = parent;
      continue;
    }
    const full = tail.length ? path.join(real, ...tail) : real;
    return isInside(rootReal, full, platform, path.sep) ? abs : null;
  }
  return null;
}

// FNV-1a 64 over the UTF-8 bytes (BigInt arithmetic: synchronous, identical in Node and browsers).
const FNV_OFFSET = 0xcbf29ce484222325n, FNV_PRIME = 0x100000001b3n, MASK64 = 0xffffffffffffffffn;
const utf8 = new TextEncoder();

function fnvBig(text) {
  let h = FNV_OFFSET;
  for (const b of utf8.encode(String(text))) { h ^= BigInt(b); h = (h * FNV_PRIME) & MASK64; }
  return h;
}

export const fnv64 = (text) => fnvBig(text).toString(16).padStart(16, '0');

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

export function normAbs(absPath, platform = defaultPlatform()) {
  let p = String(absPath || '');
  if (platform === 'win32') {
    const unc = /^[\\/]{2}[^\\/]/.test(p);
    p = p.replace(/[\\/]+/g, '\\');
    if (unc) p = '\\' + p;
    if (/^[a-z]:\\?$/i.test(p)) return (p.slice(0, 2) + '\\').toLowerCase();
    return (p.replace(/\\+$/, '') || '\\').toLowerCase();
  }
  p = p.replace(/\/{2,}/g, '/');
  return p.length > 1 ? p.replace(/\/+$/, '') || '/' : p;
}

// Derived, not stored: the same folder gets the same id after a restart or on another machine with the same path,
// so bookmarked URLs survive. 50 bits keep collisions negligible for any realistic number of mounts.
export function mountId(absPath, platform = defaultPlatform()) {
  let h = fnvBig(normAbs(absPath, platform)) >> 14n; // the top 50 bits
  let out = '';
  for (let i = 0; i < 10; i++) { out = B32[Number(h & 31n)] + out; h >>= 5n; }
  return out;
}
