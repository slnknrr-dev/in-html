// kdbx/document.js - the XML document inside a KDBX file <-> the model (model.js): metadata, groups, entries, history,
// attachments (inner-header binaries of KDBX 4, Meta/Binaries of KDBX 3), custom icons, custom data, deleted objects.
// Protected values are XORed with the inner random stream in document order, on reading and on writing.
// Unknown elements are kept (entry.extra, group.extra, meta.extra) and written back.
//
// Design: read in two passes - (1) walk the raw XML tree once in document order and unmask every Protected value
// into node.plain, (2) map elements to model objects in any order. Decoupling the stream from the mapping means the
// mapper can skip, reorder or recurse freely without desynchronising the keystream. Writing has no second pass:
// stream.apply runs while the element tree is BUILT, so the construction order of el(...) calls below must equal
// serialisation order. JS evaluates arguments left to right, which makes "argument order = document order" hold.
// Parsers are lenient with defaults (int/bool fallbacks, missing elements ignored): files from many KeePass clients
// differ in which optional elements they write, and refusing one would lock the user out of their passwords.
import { attr, child, children, el, parseXML, root, serializeXML, textOf } from '../xml/xml.js';
import { base64ToBytes, bytesToBase64 } from '../crypto/encoding.js';
import { decompress } from '../codec/deflate.js';
import { ZERO_UUID, isZeroUuid, timeFromXml, timeToXml } from './bytes.js';
import { KdbxBinary, KdbxEntry, KdbxGroup, KdbxMeta, KdbxTimes, STANDARD_FIELDS } from './model.js';
import { ProtectedValue } from './protect.js';

const kids = (nd) => (nd ? nd.children.filter((c) => c.type === 'element') : []);
const txt = (nd) => (nd ? textOf(nd) : '');
const bool = (s, def = false) => { const v = String(s).trim().toLowerCase(); return v === 'true' ? true : v === 'false' ? false : def; };
// nbool: tri-state (true / false / null = "inherit from parent group"), the KeePass meaning of 'null' in
// EnableAutoType / EnableSearching. A two-state bool would silently turn "inherit" into an explicit value on save.
const nbool = (s) => { const v = String(s).trim().toLowerCase(); return v === 'true' ? true : v === 'false' ? false : null; };
const int = (s, def = 0) => { const n = parseInt(String(s).trim(), 10); return Number.isFinite(n) ? n : def; };
const time = (nd, def) => timeFromXml(txt(nd)) || def;
const uuid = (nd) => txt(nd).trim() || ZERO_UUID;
// CustomIconUUID: the zero UUID means "no custom icon" (KeePass omits the element then).
const iconRef = (v) => { const u = String(v).trim(); return isZeroUuid(u) ? null : u; };

// --- reading ------------------------------------------------------------------------------------------------

// stream: inner random stream; binaries: KdbxBinary[] of the inner header (KDBX 4).
export async function readDocument(xmlText, { stream, binaries = [] }) {
  // trim: false - whitespace in field values (notes, passwords) is data and must survive a round trip.
  const doc = parseXML(xmlText, { trim: false });
  const r = root(doc);
  if (!r || r.name !== 'KeePassFile') throw new Error('not a KeePass XML document');
  // Protected values in document order (the stream position depends on it).
  const visit = (nd) => {
    for (const c of nd.children) {
      if (c.type !== 'element') continue;
      if (attr(c, 'Protected') === 'True' || attr(c, 'Protected') === 'true') {
        const raw = base64ToBytes(textOf(c).trim());
        c.plain = stream.apply(raw);
      }
      visit(c);
    }
  };
  visit(r);
  const metaEl = child(r, 'Meta'), rootEl = child(r, 'Root');
  // One attachment pool for both versions: KDBX 4 fills it from the inner header, KDBX 3 from Meta/Binaries (readMeta
  // writes into it by ID). Entries then resolve <Value Ref="n"/> against the pool regardless of version.
  const pool = [...binaries];
  const meta = await readMeta(metaEl, pool);
  const groupEl = child(rootEl, 'Group');
  if (!groupEl) throw new Error('the database has no root group');
  const group = readGroup(groupEl, pool, meta);
  const deleted = children(child(rootEl, 'DeletedObjects'), 'DeletedObject').map((d) => ({ uuid: uuid(child(d, 'UUID')), time: time(child(d, 'DeletionTime'), new Date()) }));
  return { meta, root: group, deletedObjects: deleted };
}

async function readMeta(nd, pool) {
  const m = new KdbxMeta();
  m.generator = '';
  if (!nd) return m;
  const v3bins = [];
  for (const c of kids(nd)) {
    const v = txt(c);
    switch (c.name) {
      case 'Generator': m.generator = v; break;
      case 'HeaderHash': break; // KDBX 3.1 only; checked by the reader of the outer format when needed
      case 'SettingsChanged': m.settingsChanged = timeFromXml(v); break;
      case 'DatabaseName': m.name = v; break;
      case 'DatabaseNameChanged': m.nameChanged = time(c, m.nameChanged); break;
      case 'DatabaseDescription': m.description = v; break;
      case 'DatabaseDescriptionChanged': m.descriptionChanged = time(c, m.descriptionChanged); break;
      case 'DefaultUserName': m.defaultUser = v; break;
      case 'DefaultUserNameChanged': m.defaultUserChanged = time(c, m.defaultUserChanged); break;
      case 'MaintenanceHistoryDays': m.maintenanceHistoryDays = int(v, 365); break;
      case 'Color': m.color = v; break;
      case 'MasterKeyChanged': m.masterKeyChanged = time(c, m.masterKeyChanged); break;
      case 'MasterKeyChangeRec': m.masterKeyChangeRec = int(v, -1); break;
      case 'MasterKeyChangeForce': m.masterKeyChangeForce = int(v, -1); break;
      case 'MemoryProtection':
        for (const p of kids(c)) {
          const k = { ProtectTitle: 'title', ProtectUserName: 'userName', ProtectPassword: 'password', ProtectURL: 'url', ProtectNotes: 'notes' }[p.name];
          if (k) m.memoryProtection[k] = bool(txt(p));
        }
        break;
      case 'CustomIcons':
        for (const ic of children(c, 'Icon')) {
          m.customIcons.set(uuid(child(ic, 'UUID')), { data: base64ToBytes(txt(child(ic, 'Data')).trim()), name: txt(child(ic, 'Name')), lastModified: timeFromXml(txt(child(ic, 'LastModificationTime'))) });
        }
        break;
      case 'RecycleBinEnabled': m.recycleBinEnabled = bool(v, true); break;
      case 'RecycleBinUUID': m.recycleBinUuid = v.trim() || ZERO_UUID; break;
      case 'RecycleBinChanged': m.recycleBinChanged = time(c, m.recycleBinChanged); break;
      case 'EntryTemplatesGroup': m.entryTemplatesGroup = v.trim() || ZERO_UUID; break;
      case 'EntryTemplatesGroupChanged': m.entryTemplatesGroupChanged = time(c, m.entryTemplatesGroupChanged); break;
      case 'HistoryMaxItems': m.historyMaxItems = int(v, 10); break;
      case 'HistoryMaxSize': m.historyMaxSize = int(v, 6 * 1024 * 1024); break;
      case 'LastSelectedGroup': m.lastSelectedGroup = v.trim() || ZERO_UUID; break;
      case 'LastTopVisibleGroup': m.lastTopVisibleGroup = v.trim() || ZERO_UUID; break;
      case 'Binaries': v3bins.push(...children(c, 'Binary')); break;
      case 'CustomData': m.customData = readCustomData(c); break;
      default: m.extra.push(c);
    }
  }
  // KDBX 3: attachments live in Meta/Binaries (optionally gzip-compressed), referenced by ID.
  for (const b of v3bins) {
    let data = b.plain || base64ToBytes(txt(b).trim());
    if (bool(attr(b, 'Compressed') || '')) data = await decompress(data, 'gzip');
    pool[int(attr(b, 'ID'), pool.length)] = new KdbxBinary(data, !!b.plain);
  }
  return m;
}

function readCustomData(nd) {
  const map = new Map();
  for (const it of children(nd, 'Item')) map.set(txt(child(it, 'Key')), { value: txt(child(it, 'Value')), lastModified: timeFromXml(txt(child(it, 'LastModificationTime'))) });
  return map;
}

function readTimes(nd) {
  const t = new KdbxTimes();
  for (const c of kids(nd)) {
    switch (c.name) {
      case 'CreationTime': t.creation = time(c, t.creation); break;
      case 'LastModificationTime': t.lastModification = time(c, t.lastModification); break;
      case 'LastAccessTime': t.lastAccess = time(c, t.lastAccess); break;
      case 'ExpiryTime': t.expiry = time(c, t.expiry); break;
      case 'Expires': t.expires = bool(txt(c)); break;
      case 'UsageCount': t.usageCount = int(txt(c)); break;
      case 'LocationChanged': t.locationChanged = time(c, t.locationChanged); break;
      default:
    }
  }
  return t;
}

const tagList = (s) => String(s).split(/[,;]/).map((x) => x.trim()).filter(Boolean);

function readGroup(nd, pool, meta) {
  const g = new KdbxGroup('');
  for (const c of kids(nd)) {
    const v = txt(c);
    switch (c.name) {
      case 'UUID': g.uuid = v.trim(); break;
      case 'Name': g.name = v; break;
      case 'Notes': g.notes = v; break;
      case 'IconID': g.icon = int(v); break;
      case 'CustomIconUUID': g.customIcon = iconRef(v); break;
      case 'Times': g.times = readTimes(c); break;
      case 'IsExpanded': g.isExpanded = bool(v, true); break;
      case 'DefaultAutoTypeSequence': g.defaultAutoTypeSequence = v; break;
      case 'EnableAutoType': g.enableAutoType = nbool(v); break;
      case 'EnableSearching': g.enableSearching = nbool(v); break;
      case 'LastTopVisibleEntry': g.lastTopVisibleEntry = v.trim() || ZERO_UUID; break;
      case 'Tags': g.tags = tagList(v); break;
      case 'PreviousParentGroup': g.previousParentGroup = v.trim() || null; break;
      case 'CustomData': g.customData = readCustomData(c); break;
      case 'Group': { const s = readGroup(c, pool, meta); s.parent = g; g.groups.push(s); break; }
      case 'Entry': { const e = readEntry(c, pool, meta); e.parent = g; g.entries.push(e); break; }
      default: g.extra.push(c);
    }
  }
  return g;
}

// String fields: a Protected value (unmasked in pass 1) becomes a ProtectedValue and the plaintext buffer is zeroed
// immediately; ProtectInMemory (KeePass's XML export flag for unencrypted exports) also yields a ProtectedValue.
// Binaries: Ref into the pool, or inline data (some exporters). History is read one level deep only - KeePass never
// nests history inside history, and refusing to recurse bounds the work on a malicious file.
function readEntry(nd, pool, meta, inHistory = false) {
  const e = new KdbxEntry();
  for (const c of kids(nd)) {
    const v = txt(c);
    switch (c.name) {
      case 'UUID': e.uuid = v.trim(); break;
      case 'IconID': e.icon = int(v); break;
      case 'CustomIconUUID': e.customIcon = iconRef(v); break;
      case 'ForegroundColor': e.fgColor = v; break;
      case 'BackgroundColor': e.bgColor = v; break;
      case 'OverrideURL': e.overrideUrl = v; break;
      case 'Tags': e.tags = tagList(v); break;
      case 'Times': e.times = readTimes(c); break;
      case 'QualityCheck': e.qualityCheck = nbool(v); break;
      case 'PreviousParentGroup': e.previousParentGroup = v.trim() || null; break;
      case 'String': {
        const key = txt(child(c, 'Key'));
        const val = child(c, 'Value');
        if (val && val.plain) e.fields.set(key, ProtectedValue.fromBytes(val.plain));
        else if (val && (attr(val, 'ProtectInMemory') === 'True')) e.fields.set(key, ProtectedValue.fromString(txt(val)));
        else e.fields.set(key, txt(val));
        if (val && val.plain) val.plain.fill(0);
        break;
      }
      case 'Binary': {
        const key = txt(child(c, 'Key'));
        const val = child(c, 'Value');
        const ref = attr(val, 'Ref');
        if (ref != null) { const b = pool[int(ref, -1)]; if (b) e.binaries.set(key, b); }
        else if (val) e.binaries.set(key, new KdbxBinary(val.plain || base64ToBytes(txt(val).trim()), !!val.plain));
        break;
      }
      case 'AutoType': {
        const at = { enabled: true, obfuscation: 0, defaultSequence: '', items: [] };
        for (const a of kids(c)) {
          if (a.name === 'Enabled') at.enabled = bool(txt(a), true);
          else if (a.name === 'DataTransferObfuscation') at.obfuscation = int(txt(a));
          else if (a.name === 'DefaultSequence') at.defaultSequence = txt(a);
          else if (a.name === 'Association') at.items.push({ window: txt(child(a, 'Window')), sequence: txt(child(a, 'KeystrokeSequence')) });
        }
        e.autoType = at;
        break;
      }
      case 'CustomData': e.customData = readCustomData(c); break;
      case 'History':
        if (!inHistory) for (const h of children(c, 'Entry')) e.history.push(readEntry(h, pool, meta, true));
        break;
      default: e.extra.push(c);
    }
  }
  return e;
}

// --- writing --------------------------------------------------------------------------------------------------

// opts: { stream (inner random stream), binaryIndex: Map(KdbxBinary -> index), minor (KDBX 4 minor version) }.
// Always writes KDBX 4 conventions: binary timestamps, binaries by Ref into the inner header (no Meta/Binaries).
// KDBX 4.1-only elements (SettingsChanged, icon Name, QualityCheck, group Tags, PreviousParentGroup, CustomData item
// times) are emitted only when v41, so a 4.0 file stays valid for 4.0 readers.
// Protection on write: a value is protected when it already is a ProtectedValue, or when it is a standard field the
// database's MemoryProtection says to protect (Password by default) - KeePass's rule.
// Element order follows KeePass's own writer; some clients parse positionally-sensitive (e.g. Times before Strings).
export function writeDocument(db, { stream, binaryIndex, minor = 0 }) {
  const v41 = minor >= 1;
  const T = (d) => timeToXml(d, true);
  const B = (b) => (b ? 'True' : 'False');
  const N = (b) => (b == null ? 'null' : B(b));
  const value = (v, protect) => {
    if (!protect) return el('Value', {}, v instanceof ProtectedValue ? v.getText() : v);
    const plain = v instanceof ProtectedValue ? v.getBytes() : new TextEncoder().encode(String(v));
    const masked = stream.apply(plain);
    plain.fill(0);
    return el('Value', { Protected: 'True' }, bytesToBase64(masked));
  };
  const customData = (map) => (map && map.size ? el('CustomData', {}, [...map].map(([k, it]) => el('Item', {},
    el('Key', {}, k), el('Value', {}, it.value), v41 && it.lastModified ? el('LastModificationTime', {}, T(it.lastModified)) : null))) : null);
  const times = (t) => el('Times', {},
    el('CreationTime', {}, T(t.creation)), el('LastModificationTime', {}, T(t.lastModification)), el('LastAccessTime', {}, T(t.lastAccess)),
    el('ExpiryTime', {}, T(t.expiry)), el('Expires', {}, B(t.expires)), el('UsageCount', {}, String(t.usageCount)), el('LocationChanged', {}, T(t.locationChanged)));

  const m = db.meta;
  const mp = m.memoryProtection;
  const protectStd = { Title: mp.title, UserName: mp.userName, Password: mp.password, URL: mp.url, Notes: mp.notes };

  const meta = el('Meta', {},
    el('Generator', {}, m.generator || 'in-html kdbx'),
    v41 && m.settingsChanged ? el('SettingsChanged', {}, T(m.settingsChanged)) : null,
    el('DatabaseName', {}, m.name), el('DatabaseNameChanged', {}, T(m.nameChanged)),
    el('DatabaseDescription', {}, m.description), el('DatabaseDescriptionChanged', {}, T(m.descriptionChanged)),
    el('DefaultUserName', {}, m.defaultUser), el('DefaultUserNameChanged', {}, T(m.defaultUserChanged)),
    el('MaintenanceHistoryDays', {}, String(m.maintenanceHistoryDays)), el('Color', {}, m.color),
    el('MasterKeyChanged', {}, T(m.masterKeyChanged)), el('MasterKeyChangeRec', {}, String(m.masterKeyChangeRec)),
    el('MasterKeyChangeForce', {}, String(m.masterKeyChangeForce)),
    el('MemoryProtection', {}, el('ProtectTitle', {}, B(mp.title)), el('ProtectUserName', {}, B(mp.userName)),
      el('ProtectPassword', {}, B(mp.password)), el('ProtectURL', {}, B(mp.url)), el('ProtectNotes', {}, B(mp.notes))),
    m.customIcons.size ? el('CustomIcons', {}, [...m.customIcons].map(([id, ic]) => el('Icon', {}, el('UUID', {}, id), el('Data', {}, bytesToBase64(ic.data)),
      v41 && ic.name ? el('Name', {}, ic.name) : null, v41 && ic.lastModified ? el('LastModificationTime', {}, T(ic.lastModified)) : null))) : null,
    el('RecycleBinEnabled', {}, B(m.recycleBinEnabled)), el('RecycleBinUUID', {}, m.recycleBinUuid || ZERO_UUID), el('RecycleBinChanged', {}, T(m.recycleBinChanged)),
    el('EntryTemplatesGroup', {}, m.entryTemplatesGroup || ZERO_UUID), el('EntryTemplatesGroupChanged', {}, T(m.entryTemplatesGroupChanged)),
    el('HistoryMaxItems', {}, String(m.historyMaxItems)), el('HistoryMaxSize', {}, String(m.historyMaxSize)),
    el('LastSelectedGroup', {}, m.lastSelectedGroup || ZERO_UUID), el('LastTopVisibleGroup', {}, m.lastTopVisibleGroup || ZERO_UUID),
    customData(m.customData) || el('CustomData'),
    m.extra);

  // Binaries missing from binaryIndex are dropped silently (saveKdbx indexes every binary of entries and history, so
  // this only filters inconsistent states). History is emitted after the entry's own fields, so its protected values
  // follow the current ones in stream order - the same order the reader's document walk sees.
  const entry = (e, inHistory) => el('Entry', {},
    el('UUID', {}, e.uuid), el('IconID', {}, String(e.icon)), e.customIcon ? el('CustomIconUUID', {}, e.customIcon) : null,
    el('ForegroundColor', {}, e.fgColor), el('BackgroundColor', {}, e.bgColor), el('OverrideURL', {}, e.overrideUrl),
    v41 && e.qualityCheck === false ? el('QualityCheck', {}, 'False') : null,
    el('Tags', {}, e.tags.join(',')),
    v41 && e.previousParentGroup ? el('PreviousParentGroup', {}, e.previousParentGroup) : null,
    times(e.times),
    [...e.fields].map(([k, v]) => el('String', {}, el('Key', {}, k), value(v, v instanceof ProtectedValue || (STANDARD_FIELDS.includes(k) && protectStd[k])))),
    [...e.binaries].filter(([, b]) => binaryIndex.has(b)).map(([k, b]) => el('Binary', {}, el('Key', {}, k), el('Value', { Ref: String(binaryIndex.get(b)) }))),
    el('AutoType', {}, el('Enabled', {}, B(e.autoType.enabled)), el('DataTransferObfuscation', {}, String(e.autoType.obfuscation || 0)),
      e.autoType.defaultSequence ? el('DefaultSequence', {}, e.autoType.defaultSequence) : null,
      e.autoType.items.map((a) => el('Association', {}, el('Window', {}, a.window), el('KeystrokeSequence', {}, a.sequence)))),
    customData(e.customData),
    e.extra,
    inHistory ? null : el('History', {}, e.history.map((h) => entry(h, true))));

  // Entries before subgroups: matches KeePass output and, crucially, the order in which values are masked here.
  const group = (g) => el('Group', {},
    el('UUID', {}, g.uuid), el('Name', {}, g.name), el('Notes', {}, g.notes), el('IconID', {}, String(g.icon)),
    g.customIcon ? el('CustomIconUUID', {}, g.customIcon) : null,
    times(g.times), el('IsExpanded', {}, B(g.isExpanded)), el('DefaultAutoTypeSequence', {}, g.defaultAutoTypeSequence),
    el('EnableAutoType', {}, N(g.enableAutoType)), el('EnableSearching', {}, N(g.enableSearching)),
    el('LastTopVisibleEntry', {}, g.lastTopVisibleEntry || ZERO_UUID),
    v41 && g.tags.length ? el('Tags', {}, g.tags.join(',')) : null,
    v41 && g.previousParentGroup ? el('PreviousParentGroup', {}, g.previousParentGroup) : null,
    customData(g.customData),
    g.extra,
    g.entries.map((e) => entry(e, false)),
    g.groups.map(group));

  // Document order of creation = stream order: Meta (no protected values here in KDBX 4) before Root.
  const rootEl = el('Root', {}, group(db.root),
    el('DeletedObjects', {}, db.deletedObjects.map((d) => el('DeletedObject', {}, el('UUID', {}, d.uuid), el('DeletionTime', {}, T(d.time))))));
  return serializeXML({ type: 'document', children: [el('KeePassFile', {}, meta, rootEl)] }, { declaration: true, indent: '\t' });
}

