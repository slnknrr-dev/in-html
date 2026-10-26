// kdbx/model.js - the in-memory database: groups, entries (fields, attachments, history), metadata, recycle bin,
// standard and custom icons, field references and the editing operations shared by every KeePass client.
//
// Design rules:
// - Plain classes mirroring the XML schema 1:1 (field names follow KeePass element names), so document.js is a
//   mechanical mapping and nothing a client wrote is lost: unknown children survive in `extra`.
// - Tree with parent pointers. `parent` is defined NON-enumerable so Object.assign/JSON/structured walks do not
//   follow it upward (cycles) and snapshot() does not copy it.
// - UUIDs are base64 strings (see bytes.js) and lookups are linear scans: databases hold thousands of entries at
//   most, and an index would have to be kept in sync by every mutation - a classic source of stale-state bugs.
// - Semantics copy KeePass where clients must agree for synchronisation to work: recycle bin, DeletedObjects,
//   history limits, field references, 4.1 feature detection.
import { ZERO_UUID, isZeroUuid, newUuid, now, uuidFromHex, uuidHex } from './bytes.js';
import { ProtectedValue } from './protect.js';
import { sha256 } from '../crypto/sha2.js';
import { bytesToHex } from '../crypto/encoding.js';

export const STANDARD_FIELDS = ['Title', 'UserName', 'Password', 'URL', 'Notes'];

// The standard icons of KeePass 2 (enum PwIcon): IconID = index; KeePassXC uses the same numbering.
export const ICON_NAMES = ['Key', 'World', 'Warning', 'NetworkServer', 'MarkedDirectory', 'UserCommunication', 'Parts',
  'Notepad', 'WorldSocket', 'Identity', 'PaperReady', 'Digicam', 'IRCommunication', 'MultiKeys', 'Energy', 'Scanner',
  'WorldStar', 'CDRom', 'Monitor', 'EMail', 'Configuration', 'ClipboardReady', 'PaperNew', 'Screen', 'EnergyCareful',
  'EMailBox', 'Disk', 'Drive', 'PaperQ', 'TerminalEncrypted', 'Console', 'Printer', 'ProgramIcons', 'Run', 'Settings',
  'WorldComputer', 'Archive', 'Homebanking', 'DriveWindows', 'Clock', 'EMailSearch', 'PaperFlag', 'Memory', 'TrashBin',
  'Note', 'Expired', 'Info', 'Package', 'Folder', 'FolderOpen', 'FolderPackage', 'LockOpen', 'PaperLocked', 'Checked',
  'Pen', 'Thumbnail', 'Book', 'List', 'UserKey', 'Tool', 'Home', 'Star', 'Tux', 'Feather', 'Apple', 'Wiki', 'Money',
  'Certificate', 'BlackBerry'];
// IconID by name: ICON.Folder === 48, ICON.TrashBin === 43.
export const ICON = Object.freeze(Object.fromEntries(ICON_NAMES.map((n, i) => [n, i])));

// Field references of KeePass ({REF:<wanted>@<search in>:<text>}): wanted / searched fields by letter.
const REF_FIELD = { T: 'Title', U: 'UserName', P: 'Password', A: 'URL', N: 'Notes' };
// Wanted: T U P A N or I (the UUID itself); search-in additionally O (other = custom fields). Case-insensitive like
// KeePass. The value part stops at the first '}', so references cannot contain '}' (same limitation as KeePass).
const REF_RE = /\{REF:([TUPANI])@([TUPANIO]):([^}]*)\}/gi;
const REF_DEPTH = 12;
// KeePass "memory protection" setting of each standard field (Meta/MemoryProtection).
const PROTECT_KEY = { Title: 'title', UserName: 'userName', Password: 'password', URL: 'url', Notes: 'notes' };

export class KdbxTimes {
  constructor(t = now()) {
    this.creation = t;
    this.lastModification = t;
    this.lastAccess = t;
    this.expiry = t;
    this.expires = false;
    this.usageCount = 0;
    this.locationChanged = t;
  }
  touch() { this.lastModification = this.lastAccess = now(); }
  clone() { return Object.assign(new KdbxTimes(), this); }
}

// An attachment's content, shared by every entry (and history state) that references it.
export class KdbxBinary {
  constructor(data, isProtected = false) { this.data = data; this.protected = !!isProtected; }
  get size() { return this.data.length; }
  // Content identity for de-duplication on save.
  // Lazily computed and memoised: hashing every attachment on load would cost time for nothing. The memo assumes
  // `data` is never mutated in place - replace the KdbxBinary instead.
  get hash() { return this._hash || (this._hash = bytesToHex(sha256(this.data))); }
}

export class KdbxEntry {
  constructor() {
    this.uuid = newUuid();
    this.icon = 0;
    this.customIcon = null;
    this.fgColor = '';
    this.bgColor = '';
    this.overrideUrl = '';
    this.tags = [];
    this.times = new KdbxTimes();
    this.fields = new Map();          // name -> string | ProtectedValue
    this.binaries = new Map();        // attachment name -> KdbxBinary
    this.autoType = { enabled: true, obfuscation: 0, defaultSequence: '', items: [] };
    this.customData = new Map();      // key -> { value, lastModified }
    this.history = [];
    this.qualityCheck = null;
    this.previousParentGroup = null;
    this.extra = [];                  // unknown XML children, written back unchanged
    Object.defineProperty(this, 'parent', { value: null, writable: true, enumerable: false });
  }

  // Text of a field ('' when missing).
  get(name) {
    const v = this.fields.get(name);
    return v == null ? '' : v instanceof ProtectedValue ? v.getText() : v;
  }

  isProtected(name) { return this.fields.get(name) instanceof ProtectedValue; }

  // protect undefined -> keep the field's current protection (or take it from a ProtectedValue argument): editing a
  // password must not silently unprotect it. `??` (not ||) so an explicit false is honoured.
  set(name, value, protect) {
    const p = protect ?? (value instanceof ProtectedValue || this.isProtected(name));
    if (value instanceof ProtectedValue) this.fields.set(name, p ? value : value.getText());
    else this.fields.set(name, p ? ProtectedValue.fromString(value ?? '') : String(value ?? ''));
    return this;
  }

  remove(name) { this.fields.delete(name); return this; }

  get title() { return this.get('Title'); }
  get customFields() { return [...this.fields.keys()].filter((k) => !STANDARD_FIELDS.includes(k)); }

  // A copy of the current state for the history (KeePass keeps the state before every edit).
  // Copy depth is chosen per member: containers the editor mutates are copied (fields, tags, autoType items, maps),
  // ProtectedValues are cloned (destroying one state must not wipe another), binaries are shared by reference
  // (immutable content, possibly megabytes). customData items are shared objects - safe as long as edits replace
  // items rather than mutate them. A snapshot never carries its own history.
  snapshot() {
    const e = new KdbxEntry();
    Object.assign(e, this, {
      times: this.times.clone(),
      tags: [...this.tags],
      fields: new Map([...this.fields].map(([k, v]) => [k, v instanceof ProtectedValue ? v.clone() : v])),
      binaries: new Map(this.binaries),
      autoType: { ...this.autoType, items: this.autoType.items.map((i) => ({ ...i })) },
      customData: new Map(this.customData),
      extra: [...this.extra],
      history: [],
    });
    e.parent = null;
    return e;
  }

  // A deep copy (fields, attachments by reference, history); a new UUID unless given, the history follows it.
  clone({ uuid = newUuid(), history = true } = {}) {
    const e = this.snapshot();
    e.uuid = uuid;
    e.history = history ? this.history.map((x) => Object.assign(x.snapshot(), { uuid })) : [];
    return e;
  }

  // Saves the current state to the history, trimmed to the database limits (item count; size estimate).
  // Limits as KeePass applies them: oldest states dropped first; a negative limit means unlimited; the size limit
  // never removes the last remaining state. Size is an estimate (string length in UTF-16 units for plain fields,
  // byte length for protected ones, plus attachment bytes) - it only needs to be monotone, not exact.
  pushHistory(db) {
    this.history.push(this.snapshot());
    const max = db ? db.meta.historyMaxItems : 10;
    if (max >= 0) while (this.history.length > max) this.history.shift();
    if (db && db.meta.historyMaxSize >= 0) {
      while (this.history.length > 1 && this.history.reduce((n, h) => n + entrySize(h), 0) > db.meta.historyMaxSize) this.history.shift();
    }
  }
}

const entrySize = (e) => {
  let n = 0;
  for (const [k, v] of e.fields) n += k.length + (v instanceof ProtectedValue ? v.length : v.length);
  for (const b of e.binaries.values()) n += b.size;
  return n;
};

export class KdbxGroup {
  constructor(name = '') {
    this.uuid = newUuid();
    this.name = name;
    this.notes = '';
    this.icon = 48; // folder
    this.customIcon = null;
    this.times = new KdbxTimes();
    this.isExpanded = true;
    this.defaultAutoTypeSequence = '';
    this.enableAutoType = null;
    this.enableSearching = null;
    this.lastTopVisibleEntry = ZERO_UUID;
    this.tags = [];
    this.previousParentGroup = null;
    this.customData = new Map();
    this.groups = [];
    this.entries = [];
    this.extra = [];
    Object.defineProperty(this, 'parent', { value: null, writable: true, enumerable: false });
  }

  // Pre-order generators: lazy (find-first stops early) and no intermediate arrays. Recursion depth = tree depth.
  *allGroups() { yield this; for (const g of this.groups) yield* g.allGroups(); }
  *allEntries() { for (const g of this.allGroups()) yield* g.entries; }
}

export class KdbxMeta {
  constructor() {
    const t = now();
    this.generator = 'in-html kdbx';
    this.name = '';
    this.nameChanged = t;
    this.description = '';
    this.descriptionChanged = t;
    this.defaultUser = '';
    this.defaultUserChanged = t;
    this.maintenanceHistoryDays = 365;
    this.color = '';
    this.masterKeyChanged = t;
    this.masterKeyChangeRec = -1;
    this.masterKeyChangeForce = -1;
    this.memoryProtection = { title: false, userName: false, password: true, url: false, notes: false };
    this.customIcons = new Map(); // uuid -> { data: Uint8Array, name, lastModified }
    this.recycleBinEnabled = true;
    this.recycleBinUuid = ZERO_UUID;
    this.recycleBinChanged = t;
    this.entryTemplatesGroup = ZERO_UUID;
    this.entryTemplatesGroupChanged = t;
    this.historyMaxItems = 10;
    this.historyMaxSize = 6 * 1024 * 1024;
    this.lastSelectedGroup = ZERO_UUID;
    this.lastTopVisibleGroup = ZERO_UUID;
    this.customData = new Map();
    this.settingsChanged = null;
    this.extra = [];
  }
}

export class KdbxDatabase {
  constructor() {
    this.header = {
      major: 4, minor: 0, cipher: 'aes256', compression: true,
      kdf: { type: 'argon2d', memory: 64 * 1024 * 1024, iterations: 2, parallelism: 2, version: 0x13 },
      publicCustomData: null,
    };
    this.meta = new KdbxMeta();
    this.root = new KdbxGroup('Database');
    this.deletedObjects = [];
    this.credentials = null;
    this.keyCache = null; // { params, salt, key }: the transformed key of the last open / save (save without re-deriving)
    this.recycleBinName = 'Recycle Bin'; // name of the bin when it gets created (applications localize it)
  }

  // --- lookup ---

  *allGroups() { yield* this.root.allGroups(); }
  *allEntries() { yield* this.root.allEntries(); }
  getGroup(uuid) { for (const g of this.allGroups()) if (g.uuid === uuid) return g; return null; }
  getEntry(uuid) { for (const e of this.allEntries()) if (e.uuid === uuid) return e; return null; }

  // Wires parent pointers after loading.
  link(group = this.root, parent = null) {
    group.parent = parent;
    for (const e of group.entries) e.parent = group;
    for (const g of group.groups) this.link(g, group);
  }

  // --- groups and entries ---

  createGroup(parent, name) {
    const g = new KdbxGroup(name);
    g.parent = parent;
    parent.groups.push(g);
    parent.times.touch();
    return g;
  }

  createEntry(group) {
    const e = new KdbxEntry();
    for (const f of STANDARD_FIELDS) e.set(f, '', !!this.meta.memoryProtection[PROTECT_KEY[f]]);
    if (this.meta.defaultUser) e.set('UserName', this.meta.defaultUser);
    e.parent = group;
    group.entries.push(e);
    return e;
  }

  // Whether `item` (group or entry) is the recycle bin or inside it.
  inRecycleBin(item) {
    const bin = this.recycleBin(false);
    for (let g = item; g; g = g.parent) if (g === bin) return true;
    return false;
  }

  isAncestor(group, item) { for (let g = item; g; g = g.parent) if (g === group) return true; return false; }

  // The bin is found by Meta/RecycleBinUUID (not by name - names are localised and user-editable) and created lazily
  // on first delete, with KeePass's attributes: trash icon, excluded from auto-type and search, collapsed.
  recycleBin(create = true) {
    if (!isZeroUuid(this.meta.recycleBinUuid)) {
      const g = this.getGroup(this.meta.recycleBinUuid);
      if (g) return g;
    }
    if (!create || !this.meta.recycleBinEnabled) return null;
    const g = this.createGroup(this.root, this.recycleBinName);
    g.icon = 43;
    g.enableAutoType = false;
    g.enableSearching = false;
    g.isExpanded = false;
    this.meta.recycleBinUuid = g.uuid;
    this.meta.recycleBinChanged = now();
    return g;
  }

  // Cycle guard first (a group into its own subtree would detach it from the root). PreviousParentGroup and
  // LocationChanged are what synchronisation and "restore from recycle bin" rely on.
  move(item, to) {
    const from = item.parent;
    if (!from || from === to) return;
    if (item instanceof KdbxGroup && this.isAncestor(item, to)) throw new Error('a group cannot be moved into itself');
    const list = item instanceof KdbxGroup ? from.groups : from.entries;
    list.splice(list.indexOf(item), 1);
    (item instanceof KdbxGroup ? to.groups : to.entries).push(item);
    item.previousParentGroup = from.uuid;
    item.parent = to;
    item.times.locationChanged = now();
  }

  // To the recycle bin; items already in it (or with the bin disabled) are deleted for good and recorded in
  // DeletedObjects (synchronization). Returns 'recycled' | 'deleted'.
  remove(item) {
    if (item === this.root) throw new Error('the root group cannot be deleted');
    const bin = this.meta.recycleBinEnabled ? this.recycleBin(true) : null;
    if (bin && !this.inRecycleBin(item) && item !== bin) { this.move(item, bin); return 'recycled'; }
    const from = item.parent;
    const list = item instanceof KdbxGroup ? from.groups : from.entries;
    list.splice(list.indexOf(item), 1);
    const t = now();
    if (item instanceof KdbxGroup) {
      for (const g of item.allGroups()) this.deletedObjects.push({ uuid: g.uuid, time: t });
      for (const e of item.allEntries()) this.deletedObjects.push({ uuid: e.uuid, time: t });
      if (item.uuid === this.meta.recycleBinUuid) this.meta.recycleBinUuid = ZERO_UUID;
    } else this.deletedObjects.push({ uuid: item.uuid, time: t });
    item.parent = null;
    return 'deleted';
  }

  emptyRecycleBin() {
    const bin = this.recycleBin(false);
    if (!bin) return;
    for (const g of [...bin.groups]) this.remove(g);
    for (const e of [...bin.entries]) this.remove(e);
  }

  // --- attachments and icons ---

  // Reuses an existing binary with the same content.
  // Size compared before hash, so the SHA-256 of an existing binary is computed only on a size collision.
  addBinary(data, isProtected = false) {
    const b = new KdbxBinary(data, isProtected);
    for (const e of this.allEntries()) for (const x of [e, ...e.history]) for (const y of x.binaries.values()) if (y.size === b.size && y.hash === b.hash) return y;
    return b;
  }

  // Adds a custom icon (PNG bytes); an icon with the same content is reused (a missing name is filled in).
  addCustomIcon(data, name = '') {
    const same = this.findCustomIcon(data);
    if (same) {
      const ic = this.meta.customIcons.get(same);
      if (name && !ic.name) { ic.name = name; ic.lastModified = now(); }
      return same;
    }
    const uuid = newUuid();
    this.meta.customIcons.set(uuid, { data, name, lastModified: now() });
    return uuid;
  }

  // UUID of the custom icon with exactly these bytes, or null.
  findCustomIcon(data) {
    for (const [uuid, ic] of this.meta.customIcons) {
      if (ic.data.length === data.length && ic.data.every((b, i) => b === data[i])) return uuid;
    }
    return null;
  }

  // Groups and entries (current states, not their history) that show a custom icon.
  customIconUsers(uuid) {
    const out = [];
    for (const g of this.allGroups()) {
      if (g.customIcon === uuid) out.push(g);
      for (const e of g.entries) if (e.customIcon === uuid) out.push(e);
    }
    return out;
  }

  // Custom icons that no group or entry shows (history states do not count).
  unusedCustomIcons() {
    const used = new Set();
    for (const g of this.allGroups()) {
      if (g.customIcon) used.add(g.customIcon);
      for (const e of g.entries) if (e.customIcon) used.add(e.customIcon);
    }
    return [...this.meta.customIcons.keys()].filter((u) => !used.has(u));
  }

  // Deletes a custom icon: every reference (history included) falls back to the standard icon, and the deletion is
  // recorded in DeletedObjects for synchronization like KeePass does. Returns the number of references cleared.
  removeCustomIcon(uuid) {
    if (!this.meta.customIcons.has(uuid)) return 0;
    let n = 0;
    for (const g of this.allGroups()) {
      if (g.customIcon === uuid) { g.customIcon = null; n++; }
      for (const e of g.entries) for (const x of [e, ...e.history]) if (x.customIcon === uuid) { x.customIcon = null; n++; }
    }
    this.meta.customIcons.delete(uuid);
    this.deletedObjects.push({ uuid, time: now() });
    return n;
  }

  // --- duplicates and field references ---

  // KeePass "Duplicate entry": a copy right after the original with a new UUID and fresh times; options: a title
  // suffix (' - Copy'), user name and password replaced by references to the original ({REF:U@I:...},
  // {REF:P@I:...}), the history copied or not.
  duplicateEntry(entry, { suffix = ' - Copy', references = false, history = false } = {}) {
    const e = entry.clone({ history });
    const t = now();
    Object.assign(e.times, { creation: t, lastModification: t, lastAccess: t, locationChanged: t, usageCount: 0 });
    if (suffix) e.set('Title', entry.get('Title') + suffix);
    if (references) {
      const hex = uuidHex(entry.uuid);
      e.set('UserName', `{REF:U@I:${hex}}`);
      e.set('Password', `{REF:P@I:${hex}}`);
    }
    const group = entry.parent;
    e.parent = group;
    const i = group.entries.indexOf(entry);
    group.entries.splice(i < 0 ? group.entries.length : i + 1, 0, e);
    return e;
  }

  // The entry a field reference points at: by UUID (I) or the first entry whose field (T, U, P, A, N, or O: any
  // custom field) contains the text, ignoring case.
  findReference(searchIn, text) {
    const s = String(searchIn).toUpperCase();
    if (s === 'I') return /^[0-9a-f]{32}$/i.test(text) ? this.getEntry(uuidFromHex(text)) : null;
    const needle = String(text).toLowerCase();
    for (const e of this.allEntries()) {
      const names = s === 'O' ? e.customFields : [REF_FIELD[s]];
      if (names.some((n) => e.get(n).toLowerCase().includes(needle))) return e;
    }
    return null;
  }

  // The text with every {REF:...} replaced by the referenced value (recursively, at most 12 levels deep like KeePass);
  // references that point nowhere stay as they are.
  // The depth cap is also the cycle breaker: A -> B -> A stops after 12 levels and leaves the remaining reference text
  // in place instead of recursing forever. Fast exit when the text has no '{' (the common case).
  resolveReferences(text, depth = 0) {
    const s = String(text ?? '');
    if (depth >= REF_DEPTH || !s.includes('{')) return s;
    return s.replace(REF_RE, (m, wanted, searchIn, value) => {
      const e = this.findReference(searchIn, value);
      if (!e) return m;
      const w = wanted.toUpperCase();
      return w === 'I' ? uuidHex(e.uuid) : this.resolveReferences(e.get(REF_FIELD[w]), depth + 1);
    });
  }

  // A field of an entry with its references resolved.
  fieldValue(entry, name) { return this.resolveReferences(entry.get(name)); }

  // Whether saving needs KDBX 4.1 (the elements KeePass 2.48+ and KeePassXC 2.7 added): custom icon names or
  // modification times, group tags, PreviousParentGroup, an entry excluded from quality checks, or custom data items
  // with a modification time.
  usesKdbx41() {
    const cd = (map) => [...map.values()].some((it) => it.lastModified);
    for (const ic of this.meta.customIcons.values()) if (ic.name || ic.lastModified) return true;
    if (cd(this.meta.customData)) return true;
    for (const g of this.allGroups()) {
      if (g.tags.length || g.previousParentGroup || cd(g.customData)) return true;
      for (const e of g.entries) {
        for (const x of [e, ...e.history]) if (x.previousParentGroup || x.qualityCheck === false || cd(x.customData)) return true;
      }
    }
    return false;
  }

  // --- search ---

  // Entries whose fields (protected ones excluded unless asked), tags or attachment names contain every word.
  // AND of substrings over one lower-cased haystack per entry: simple, predictable, no index to maintain. Protected
  // values are excluded by default so typing part of a password does not reveal which entry it belongs to.
  search(query, { protectedFields = false, includeRecycleBin = false } = {}) {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    for (const e of this.allEntries()) {
      if (!includeRecycleBin && this.inRecycleBin(e)) continue;
      let hay = e.tags.join(' ') + ' ' + [...e.binaries.keys()].join(' ');
      for (const [k, v] of e.fields) if (protectedFields || !(v instanceof ProtectedValue)) hay += ' ' + (v instanceof ProtectedValue ? v.getText() : v) + ' ' + k;
      hay = hay.toLowerCase();
      if (words.every((w) => hay.includes(w))) out.push(e);
    }
    return out;
  }

  // Drops secrets from memory (lock).
  // Best effort (see protect.js): masked values and keys are zeroed, the tree is replaced so plain-string fields
  // become unreachable; strings already handed to the UI stay until the GC collects them.
  destroy() {
    for (const e of this.allEntries()) for (const x of [e, ...e.history]) for (const v of x.fields.values()) if (v instanceof ProtectedValue) v.destroy();
    if (this.credentials) this.credentials.destroy();
    if (this.keyCache) this.keyCache.key.fill(0);
    this.credentials = null;
    this.keyCache = null;
    this.root = new KdbxGroup('');
  }
}

export { ProtectedValue };
