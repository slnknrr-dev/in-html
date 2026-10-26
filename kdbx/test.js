// kdbx/test.js - unit tests of the KDBX library: `node kdbx/test.js` (importing the module runs nothing).
// A KDBX 3.1 file built here independently with node:crypto and node:zlib (AES-KDF, AES-256-CBC, hashed block stream,
// gzip, Salsa20-protected values) and KDBX 4.0 / 4.1 files written by the library are read back: standard icons
// (IconID, including values outside the standard range), custom icons (CustomIconUUID of groups, entries and history
// states; Meta/CustomIcons with the KDBX 4.1 Name and LastModificationTime), the zero UUID, the choice between 4.0 and
// 4.1 on saving, custom icon de-duplication, usage and removal, duplicated entries with field references.
//
// Why the KDBX 3.1 fixture is built with node:crypto / node:zlib rather than the library's own primitives: a reader
// tested only against its own writer can share a bug with it (e.g. the same wrong byte order) and still pass. An
// independent writer on a different crypto stack is the oracle; the library writes only KDBX 4, so 3.1 can be
// checked no other way without shipping binary fixtures. KDF rounds are tiny (64) to keep the suite fast - the KDF
// algorithm is the same at any round count.

import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { ICON, ICON_NAMES, KdbxCredentials, createKdbx, openKdbx, readHeader, saveKdbx, uuidFromHex, uuidHex } from './kdbx.js';
import { writeDocument } from './document.js';
import { createInnerStream } from './protect.js';
import { Salsa20 } from '../crypto/salsa.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const b64 = (u) => Buffer.from(u).toString('base64');
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const sha = (b) => new Uint8Array(crypto.createHash('sha256').update(b).digest());
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const uid = () => b64(crypto.randomBytes(16));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Two 1x1 PNG images (transparent and red).
const PNG1 = fromB64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
const PNG2 = fromB64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==');

// A KDBX 3.1 file (AES-256-CBC, AES-KDF, Salsa20 inner stream, gzip); xml(P) builds the document, P(text) masks a
// protected value with the inner stream (called in document order).
function kdbx31(password, xml, rounds = 64) {
  const masterSeed = crypto.randomBytes(32), transformSeed = crypto.randomBytes(32), iv = crypto.randomBytes(16);
  const streamKey = crypto.randomBytes(32), start = crypto.randomBytes(32);
  const parts = [u32(0x9aa2d903), u32(0xb54bfb67), u32((3 << 16) | 1)];
  const field = (id, data) => parts.push(Buffer.from([id]), u16(data.length), Buffer.from(data));
  field(2, Buffer.from('31c1f2e6bf714350be5805216afc5aff', 'hex'));
  field(3, u32(1));
  field(4, masterSeed); field(5, transformSeed); field(6, u64(rounds)); field(7, iv); field(8, streamKey); field(9, start); field(10, u32(2));
  field(0, Buffer.from('\r\n\r\n'));
  const header = Buffer.concat(parts);
  // AES-KDF: the composite key encrypted `rounds` times with AES-256-ECB keyed by the transform seed, then hashed.
  let k = Buffer.from(sha(sha(Buffer.from(password, 'utf8'))));
  const ecb = crypto.createCipheriv('aes-256-ecb', transformSeed, null);
  ecb.setAutoPadding(false);
  for (let i = 0; i < rounds; i++) k = ecb.update(k);
  const key = sha(Buffer.concat([masterSeed, sha(k)]));
  const salsa = new Salsa20(sha(streamKey), new Uint8Array([0xe8, 0x30, 0x09, 0x4b, 0x97, 0x20, 0x5d, 0x2a]));
  const P = (text) => b64(salsa.update(new Uint8Array(Buffer.from(text, 'utf8'))));
  const doc = Buffer.from(xml(P, b64(sha(header))), 'utf8');
  const data = zlib.gzipSync(doc);
  const blocks = Buffer.concat([u32(0), Buffer.from(sha(data)), u32(data.length), data, u32(1), Buffer.alloc(32), u32(0)]);
  const cbc = crypto.createCipheriv('aes-256-cbc', key, iv);
  const body = Buffer.concat([cbc.update(Buffer.concat([start, blocks])), cbc.final()]);
  return new Uint8Array(Buffer.concat([header, body]));
}

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, v) => eq(name, !!v, true);
  const creds = () => new KdbxCredentials({ password: 'test' });
  const fast = (db) => { db.header.kdf = { type: 'aes', rounds: 32 }; return db; };
  const reopen = async (db) => { const bytes = await saveKdbx(db); return { bytes, db: await openKdbx(bytes, creds()) }; };
  const entryBy = (db, title) => [...db.allEntries()].find((e) => e.get('Title') === title);
  const groupBy = (db, name) => [...db.allGroups()].find((g) => g.name === name);

  // --- the standard icons -------------------------------------------------------------------------------------
  eq('icon count', ICON_NAMES.length, 69);
  eq('icon names unique', new Set(ICON_NAMES).size, 69);
  eq('icon ids', [ICON.Key, ICON.World, ICON.NetworkServer, ICON.EMail, ICON.TerminalEncrypted, ICON.TrashBin, ICON.Expired, ICON.Folder, ICON.FolderOpen,
    ICON.FolderPackage, ICON.UserKey, ICON.Tux, ICON.Certificate, ICON.BlackBerry], [0, 1, 3, 19, 29, 43, 45, 48, 49, 50, 58, 62, 67, 68]);
  const u = uid();
  eq('uuid hex round trip', uuidFromHex(uuidHex(u)), u);
  eq('uuid hex', uuidHex('AAECAwQFBgcICQoLDA0ODw=='), '000102030405060708090A0B0C0D0E0F');

  // --- KDBX 3.1 reference file ---------------------------------------------------------------------------------
  const IC1 = uid(), IC2 = uid(), G0 = uid(), G1 = uid(), E1 = uid(), E2 = uid();
  const T = '<Times><CreationTime>2024-05-01T10:00:00Z</CreationTime><LastModificationTime>2024-05-02T10:00:00Z</LastModificationTime>' +
    '<LastAccessTime>2024-05-02T10:00:00Z</LastAccessTime><ExpiryTime>2024-05-01T10:00:00Z</ExpiryTime><Expires>False</Expires>' +
    '<UsageCount>0</UsageCount><LocationChanged>2024-05-01T10:00:00Z</LocationChanged></Times>';
  const v3 = kdbx31('test', (P, hash) => `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<KeePassFile><Meta><Generator>reference</Generator><HeaderHash>${hash}</HeaderHash><DatabaseName>Icons 3.1</DatabaseName>
<MemoryProtection><ProtectTitle>False</ProtectTitle><ProtectUserName>False</ProtectUserName><ProtectPassword>True</ProtectPassword><ProtectURL>False</ProtectURL><ProtectNotes>False</ProtectNotes></MemoryProtection>
<CustomIcons><Icon><UUID>${IC1}</UUID><Data>${b64(PNG1)}</Data></Icon><Icon><UUID>${IC2}</UUID><Data>${b64(PNG2)}</Data></Icon></CustomIcons>
<RecycleBinEnabled>True</RecycleBinEnabled><RecycleBinUUID>AAAAAAAAAAAAAAAAAAAAAA==</RecycleBinUUID></Meta>
<Root><Group><UUID>${G0}</UUID><Name>Root</Name><Notes></Notes><IconID>49</IconID>${T}<IsExpanded>True</IsExpanded>
<Group><UUID>${G1}</UUID><Name>Banking</Name><Notes></Notes><IconID>37</IconID><CustomIconUUID>${IC2}</CustomIconUUID>${T}<IsExpanded>True</IsExpanded>
<Entry><UUID>${E1}</UUID><IconID>66</IconID><CustomIconUUID>${IC1}</CustomIconUUID><ForegroundColor></ForegroundColor><BackgroundColor></BackgroundColor><OverrideURL></OverrideURL><Tags></Tags>${T}
<String><Key>Title</Key><Value>Bank</Value></String><String><Key>UserName</Key><Value>alice</Value></String>
<String><Key>Password</Key><Value Protected="True">${P('s3cr3t')}</Value></String>
<AutoType><Enabled>True</Enabled><DataTransferObfuscation>0</DataTransferObfuscation></AutoType>
<History><Entry><UUID>${E1}</UUID><IconID>0</IconID><CustomIconUUID>${IC2}</CustomIconUUID>${T}
<String><Key>Title</Key><Value>Old bank</Value></String><String><Key>Password</Key><Value Protected="True">${P('old')}</Value></String>
<AutoType><Enabled>True</Enabled><DataTransferObfuscation>0</DataTransferObfuscation></AutoType></Entry></History></Entry>
<Entry><UUID>${E2}</UUID><IconID>13</IconID><CustomIconUUID>AAAAAAAAAAAAAAAAAAAAAA==</CustomIconUUID>${T}
<String><Key>Title</Key><Value>Keys</Value></String><String><Key>Password</Key><Value Protected="True">${P('k')}</Value></String>
<AutoType><Enabled>True</Enabled><DataTransferObfuscation>0</DataTransferObfuscation></AutoType><History/></Entry>
</Group></Group><DeletedObjects/></Root></KeePassFile>`);

  try {
    eq('3.1 header', [readHeader(v3).major, readHeader(v3).minor], [3, 1]);
    const db = await openKdbx(v3, creds());
    const g0 = db.root, g1 = groupBy(db, 'Banking'), e1 = entryBy(db, 'Bank'), e2 = entryBy(db, 'Keys');
    eq('3.1 root icon', [g0.icon, g0.customIcon], [49, null]);
    eq('3.1 group icon', [g1.icon, g1.customIcon], [37, IC2]);
    eq('3.1 entry icon', [e1.icon, e1.customIcon], [66, IC1]);
    eq('3.1 history icon', [e1.history[0].icon, e1.history[0].customIcon, e1.history[0].get('Title')], [0, IC2, 'Old bank']);
    eq('3.1 zero custom icon uuid', [e2.icon, e2.customIcon], [13, null]);
    eq('3.1 protected values', [e1.get('Password'), e1.history[0].get('Password'), e2.get('Password')], ['s3cr3t', 'old', 'k']);
    eq('3.1 custom icons', [...db.meta.customIcons.keys()], [IC1, IC2]);
    ok('3.1 custom icon data', same(db.meta.customIcons.get(IC1).data, PNG1) && same(db.meta.customIcons.get(IC2).data, PNG2));
    eq('3.1 custom icon name / time', [db.meta.customIcons.get(IC1).name, db.meta.customIcons.get(IC1).lastModified], ['', null]);
    ok('3.1 no 4.1 elements', !db.usesKdbx41());

    // Saved as KDBX 4.0 (nothing needs 4.1), read back unchanged.
    const r1 = await reopen(db);
    eq('3.1 -> 4.0 header', [readHeader(r1.bytes).major, readHeader(r1.bytes).minor], [4, 0]);
    const d1 = r1.db;
    eq('4.0 group icon', [groupBy(d1, 'Banking').icon, groupBy(d1, 'Banking').customIcon], [37, IC2]);
    eq('4.0 entry icon', [entryBy(d1, 'Bank').icon, entryBy(d1, 'Bank').customIcon], [66, IC1]);
    eq('4.0 history icon', [entryBy(d1, 'Bank').history[0].icon, entryBy(d1, 'Bank').history[0].customIcon], [0, IC2]);
    eq('4.0 no custom icon', entryBy(d1, 'Keys').customIcon, null);
    ok('4.0 custom icon data', same(d1.meta.customIcons.get(IC1).data, PNG1) && same(d1.meta.customIcons.get(IC2).data, PNG2));
    eq('4.0 passwords', [entryBy(d1, 'Bank').get('Password'), entryBy(d1, 'Bank').history[0].get('Password')], ['s3cr3t', 'old']);

    // A name on a custom icon needs KDBX 4.1: the file is upgraded and keeps the name and the modification time.
    eq('dedupe returns the existing icon', d1.addCustomIcon(PNG1.slice(), 'Bank logo'), IC1);
    ok('named icon needs 4.1', d1.usesKdbx41());
    const named = d1.meta.customIcons.get(IC1);
    const r2 = await reopen(d1);
    eq('4.1 header', readHeader(r2.bytes).minor, 1);
    const n2 = r2.db.meta.customIcons.get(IC1);
    eq('4.1 icon name', n2.name, 'Bank logo');
    eq('4.1 icon time', n2.lastModified && n2.lastModified.getTime(), named.lastModified.getTime());
    eq('4.1 unnamed icon', [r2.db.meta.customIcons.get(IC2).name, r2.db.meta.customIcons.get(IC2).lastModified], ['', null]);
    // A database read as 4.1 stays 4.1.
    const r3 = await reopen(r2.db);
    eq('4.1 stays 4.1', readHeader(r3.bytes).minor, 1);
    eq('4.1 again: name', r3.db.meta.customIcons.get(IC1).name, 'Bank logo');
  } catch (e) { fail++; console.log('FAIL KDBX 3.1 round trip: ' + (e.stack || e.message)); }

  // --- KDBX 4 written by the library --------------------------------------------------------------------------
  try {
    const db = fast(createKdbx({ name: 'Icons', credentials: creds() }));
    const g = db.createGroup(db.root, 'Mail');
    g.icon = ICON.EMail;
    const icA = db.addCustomIcon(PNG1, '');
    db.meta.customIcons.get(icA).lastModified = null; // as read from a 4.0 file
    const icB = db.addCustomIcon(PNG2, 'Red');
    eq('distinct icons', db.meta.customIcons.size, 2);
    eq('find custom icon', [db.findCustomIcon(PNG1), db.findCustomIcon(PNG2), db.findCustomIcon(new Uint8Array(3))], [icA, icB, null]);
    g.customIcon = icB;
    const e = db.createEntry(g);
    e.set('Title', 'Webmail'); e.set('UserName', 'bob'); e.set('Password', 'pw1', true);
    e.icon = ICON.WorldStar; e.customIcon = icA;
    e.pushHistory(db);
    e.icon = ICON.Certificate; e.customIcon = null; e.set('Password', 'pw2');
    const odd = db.createEntry(g);
    odd.set('Title', 'Odd'); odd.icon = 200; // outside the standard range: kept as it is
    const { bytes, db: back } = await reopen(db);
    eq('library file is 4.1 (named icon)', readHeader(bytes).minor, 1);
    const g2 = groupBy(back, 'Mail'), e2 = entryBy(back, 'Webmail');
    eq('group icon kept', [g2.icon, g2.customIcon], [19, icB]);
    eq('entry icon kept', [e2.icon, e2.customIcon], [67, null]);
    eq('history icon kept', [e2.history[0].icon, e2.history[0].customIcon, e2.history[0].get('Password')], [16, icA, 'pw1']);
    eq('odd icon kept', entryBy(back, 'Odd').icon, 200);
    eq('icon names after save', [back.meta.customIcons.get(icA).name, back.meta.customIcons.get(icB).name], ['', 'Red']);

    // Usage and removal: references (history included) fall back to the standard icon; the deletion is recorded.
    eq('icon users', back.customIconUsers(icB).map((x) => x.name || x.get('Title')), ['Mail']);
    eq('unused icons', back.unusedCustomIcons(), [icA]); // only a history state shows it
    eq('remove icon', back.removeCustomIcon(icA), 1);
    eq('history reference cleared', entryBy(back, 'Webmail').history[0].customIcon, null);
    ok('deletion recorded', back.deletedObjects.some((d) => d.uuid === icA));
    eq('remove missing icon', back.removeCustomIcon(icA), 0);
    const again = (await reopen(back)).db;
    eq('removed icon gone', [...again.meta.customIcons.keys()], [icB]);
    eq('group icon still there', groupBy(again, 'Mail').customIcon, icB);

    // XML: KDBX 4.0 leaves out the 4.1 elements of custom icons, 4.1 writes them.
    const xml = (minor) => writeDocument(again, { stream: createInnerStream(3, new Uint8Array(64)), binaryIndex: new Map(), minor });
    ok('4.0 xml: no icon name', !/<Icon>(?:(?!<\/Icon>).)*<Name>/s.test(xml(0)));
    ok('4.1 xml: icon name', /<Icon>\s*<UUID>[^<]+<\/UUID>\s*<Data>[^<]+<\/Data>\s*<Name>Red<\/Name>\s*<LastModificationTime>/.test(xml(1)));
    ok('xml: IconID and CustomIconUUID', /<IconID>19<\/IconID>\s*<CustomIconUUID>[^<]+<\/CustomIconUUID>/.test(xml(1)));
  } catch (e) { fail++; console.log('FAIL KDBX 4 icons: ' + (e.stack || e.message)); }

  // --- 4.0 stays 4.0 without 4.1 elements --------------------------------------------------------------------------
  try {
    const db = fast(createKdbx({ name: 'Plain', credentials: creds() }));
    const e = db.createEntry(db.root);
    e.set('Title', 'One'); e.icon = ICON.Money;
    const { bytes } = await reopen(db);
    eq('plain database is 4.0', readHeader(bytes).minor, 0);
    db.move(e, db.createGroup(db.root, 'Other')); // PreviousParentGroup is a 4.1 element
    ok('moved entry needs 4.1', db.usesKdbx41());
    eq('moved: 4.1', readHeader((await reopen(db)).bytes).minor, 1);
  } catch (e) { fail++; console.log('FAIL 4.0 / 4.1 choice: ' + (e.stack || e.message)); }

  // --- duplicates and field references ------------------------------------------------------------------------------
  try {
    const db = fast(createKdbx({ name: 'Refs', credentials: creds() }));
    const g = db.createGroup(db.root, 'Web');
    const a = db.createEntry(g);
    a.set('Title', 'Forum'); a.set('UserName', 'carol'); a.set('Password', 'p@ss', true); a.set('URL', 'https://forum.example');
    a.icon = ICON.UserCommunication;
    a.pushHistory(db);
    a.set('Password', 'p@ss2');
    const tail = db.createEntry(g);
    tail.set('Title', 'Tail');
    const d = db.duplicateEntry(a, { references: true, history: true });
    eq('duplicate placed after the original', g.entries.map((x) => x.get('Title')), ['Forum', 'Forum - Copy', 'Tail']);
    ok('duplicate has a new uuid', d.uuid !== a.uuid && d.history.every((x) => x.uuid === d.uuid));
    eq('duplicate history copied', d.history.length, 1);
    eq('duplicate icon', d.icon, ICON.UserCommunication);
    eq('references', [d.get('UserName'), d.get('Password')], [`{REF:U@I:${uuidHex(a.uuid)}}`, `{REF:P@I:${uuidHex(a.uuid)}}`]);
    ok('reference password stays protected', d.isProtected('Password'));
    eq('resolved', [db.fieldValue(d, 'UserName'), db.fieldValue(d, 'Password'), db.fieldValue(d, 'URL')], ['carol', 'p@ss2', 'https://forum.example']);
    eq('resolve by title search', db.resolveReferences('{REF:A@T:forum}|{ref:u@a:FORUM.EXAMPLE}'), 'https://forum.example|carol');
    eq('resolve uuid', db.resolveReferences(`{REF:I@T:Tail}`), uuidHex(tail.uuid));
    eq('unresolved reference kept', db.resolveReferences('{REF:P@I:00000000000000000000000000000000}'), '{REF:P@I:00000000000000000000000000000000}');
    // A reference to itself does not loop.
    const self = db.createEntry(g);
    self.set('Title', 'Loop');
    self.set('Password', `x{REF:P@I:${uuidHex(self.uuid)}}`);
    ok('self reference ends', db.fieldValue(self, 'Password').startsWith('xxxx'));
    const plain = db.duplicateEntry(tail, { suffix: '', references: false, history: false });
    eq('plain duplicate', [plain.get('Title'), plain.history.length], ['Tail', 0]);
    const back = (await reopen(db)).db;
    eq('references after saving', back.fieldValue(entryBy(back, 'Forum - Copy'), 'Password'), 'p@ss2');
  } catch (e) { fail++; console.log('FAIL duplicates / references: ' + (e.stack || e.message)); }

  // --- wrong key ----------------------------------------------------------------------------------------------------
  try {
    const db = fast(createKdbx({ name: 'Key', credentials: creds() }));
    const bytes = await saveKdbx(db);
    let code = '';
    try { await openKdbx(bytes, new KdbxCredentials({ password: 'nope' })); } catch (e) { code = e.code; }
    eq('wrong password', code, 'InvalidKey');
  } catch (e) { fail++; console.log('FAIL wrong key: ' + (e.stack || e.message)); }

  console.log(`kdbx: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
