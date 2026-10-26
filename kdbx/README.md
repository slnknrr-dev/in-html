# kdbx

KeePass databases (KDBX) in pure JavaScript: read KDBX 3.1, 4.0 and 4.1, write KDBX 4.0 / 4.1 files that KeePass and
KeePassXC open. Vanilla ES modules over `crypto/` (AES, ChaCha20, Salsa20, Argon2, SHA-2, HMAC), `codec/deflate.js`
(gzip through Compression Streams) and `xml/xml.js`; no DOM, so it runs in browsers, Node and Bun.

Verified against KeePassXC 2.7.12 (`keepassxc-cli`): databases created by KeePassXC (KDBX 3.1 with AES-KDF and the
Salsa20 inner stream, key-file-only databases) open, and files written by the library are read by KeePassXC with every
field, protected values, attachments, groups, the recycle bin, TOTP codes, key files (XML v2.0, password + key file)
and every KDF / cipher combination. Reference files built independently with `node:crypto` and `zlib` (Argon2id,
ChaCha20 and AES-256-CBC payloads, ChaCha20 inner stream, HMAC block stream) open with the expected values.

## Usage

```js
import { KdbxCredentials, openKdbx, saveKdbx, createKdbx, entryOtp, otpCode } from '../kdbx/kdbx.js';

const credentials = new KdbxCredentials({ password: 'secret', keyFile: keyFileBytes /* optional */ });
const db = await openKdbx(fileBytes, credentials, { onProgress: ({ phase, fraction }) => {} });
for (const entry of db.allEntries()) console.log(entry.get('Title'), entry.get('UserName'));

const entry = db.createEntry(db.root);
entry.set('Title', 'Example');
entry.set('Password', 'p4ss', true);            // protected
entry.pushHistory(db);                           // before an edit: keep the old state
const bytes = await saveKdbx(db);                // Uint8Array, KDBX 4

const fresh = createKdbx({ name: 'Passwords', credentials, kdf: 'argon2id', cipher: 'chacha20' });
```

## API

| export | description |
|---|---|
| `openKdbx(bytes, credentials, { onProgress, signal })` | decrypts and parses; throws `KdbxError` (`code`: `BadSignature`, `Unsupported`, `InvalidKey`, `Corrupted`) |
| `saveKdbx(db, { onProgress, signal })` | KDBX 4.0, or 4.1 when the database was opened as 4.1 or uses 4.1 elements (`db.usesKdbx41()`: custom icon names or modification times, group tags, `PreviousParentGroup`, entries excluded from quality checks, custom data modification times; KDBX 4.0 readers open 4.1 files, the minor version is not critical); new master seed, IV and inner stream key on every save; the transformed key is reused while credentials and KDF parameters are unchanged (no slow re-derivation), otherwise a new KDF salt is drawn |
| `createKdbx({ name, credentials, kdf: 'argon2d' \| 'argon2id' \| 'aes', cipher: 'aes256' \| 'chacha20' })` | empty KDBX 4 database (Argon2: 64 MiB, 2 iterations, 2 lanes; AES-KDF: 100,000 rounds) |
| `readHeader(bytes)` | version, cipher, compression, KDF parameters, without decrypting |
| `KdbxCredentials({ password, keyFile })` | composite key: SHA-256 over SHA-256(password) and the key-file key; `.destroy()` |
| `keyFileKey(bytes)`, `generateKeyFile()` | key files: XML v1.0 (base64) and v2.0 (hex + hash check), 32 raw bytes, 64 hex characters, else SHA-256 of the file; generation writes XML v2.0 |
| `ProtectedValue` | `fromString`, `fromBytes`, `getText`, `getBytes`, `equals`, `destroy`; kept XOR-masked in memory |
| `entryOtp(entry)`, `otpCode(otp, timeMs)` | OTP settings from KeePassXC `otp` (otpauth URI), legacy `TOTP Seed` / `TOTP Settings`, KeePass `TimeOtp-*` / `HmacOtp-*`; code and seconds left |
| `hotp`, `totp`, `parseOtpUri`, `buildOtpUri`, `setEntryOtp` | RFC 4226 / 6238 (SHA-1/256/512, Steam) |
| `ICON_NAMES`, `ICON` | the 69 standard icons of KeePass 2 (`PwIcon`, also KeePassXC's numbering): `ICON_NAMES[IconID]`, `ICON.Folder === 48`, `ICON.TrashBin === 43` |
| `uuidHex(uuid)`, `uuidFromHex(hex)` | base64 UUID <-> the 32 hex digits of field references |

### Model (`model.js`)

- `KdbxDatabase`: `header` (`major`, `minor`, `cipher`, `compression`, `kdf { type, rounds | memory, iterations,
  parallelism, version, salt }`), `meta`, `root`, `deletedObjects`, `credentials`; `allGroups()`, `allEntries()`,
  `getGroup(uuid)`, `getEntry(uuid)`, `createGroup(parent, name)`, `createEntry(group)` (memory-protection settings
  and default user applied), `move(item, group)`, `remove(item)` (to the recycle bin, created on demand; items
  already there are deleted and recorded in `deletedObjects`), `emptyRecycleBin()`, `recycleBin(create)`,
  `inRecycleBin(item)`, `addBinary(data, protected)` (de-duplicated), `search(query)`, `destroy()` (lock: wipes
  protected values and keys).
  Custom icons: `addCustomIcon(png, name)` (an icon with the same bytes is reused; returns its UUID),
  `findCustomIcon(png)`, `customIconUsers(uuid)` (groups and entries showing it), `unusedCustomIcons()`,
  `removeCustomIcon(uuid)` (references, history included, fall back to the standard icon; recorded in
  `deletedObjects`).
  Duplicates and references: `duplicateEntry(entry, { suffix = ' - Copy', references, history })` (KeePass's
  duplicate: placed after the original, new UUID and times; `references` replaces the user name and password by
  `{REF:U@I:...}` / `{REF:P@I:...}`), `resolveReferences(text)` (`{REF:<T|U|P|A|N|I>@<T|U|P|A|N|I|O>:<text>}`, by
  UUID or the first entry whose field contains the text, 12 levels deep), `fieldValue(entry, name)`,
  `findReference(searchIn, text)`; `usesKdbx41()`.
- `KdbxGroup`: `uuid` (base64), `name`, `notes`, `icon` (IconID, default 48 Folder), `customIcon` (UUID or null),
  `times`, `isExpanded`, `enableAutoType`, `enableSearching`, `tags`, `customData`, `groups`, `entries`, `parent`.
- `KdbxEntry`: `uuid`, `icon` (IconID, default 0 Key), `customIcon`, `fgColor`, `bgColor`, `overrideUrl`, `tags`,
  `times`, `fields` (`Map` name -> string | `ProtectedValue`; `get`, `set(name, value, protect)`, `remove`,
  `isProtected`, `customFields`), `binaries` (`Map` name -> `KdbxBinary { data, protected }`), `autoType`,
  `customData`, `history` (`pushHistory(db)` trims to `meta.historyMaxItems` / `historyMaxSize`), `parent`,
  `clone({ uuid, history })`.
- `KdbxTimes`: `creation`, `lastModification`, `lastAccess`, `expiry`, `expires`, `usageCount`, `locationChanged`
  (`Date`), `touch()`.
- `KdbxMeta`: name, description, default user, colour, memory protection, custom icons (`Map` UUID ->
  `{ data (PNG), name, lastModified }`), recycle bin, history limits, custom data, ... Unknown XML elements of meta,
  groups and entries are kept and written back.

Icons are kept losslessly: `IconID` (any integer, also outside 0-68) and `CustomIconUUID` of groups, entries and
history states, custom icon data, and the KDBX 4.1 `Name` / `LastModificationTime` of custom icons (a zero
`CustomIconUUID` reads as "none").

## Files

| file | contents |
|---|---|
| `kdbx.js` | public API (re-exports) and `createKdbx` |
| `format.js` | header, key transformation (AES-KDF, Argon2d/id), payload ciphers, block streams, inner header, load / save |
| `document.js` | the XML document <-> model, protected values in document order |
| `model.js` | database, groups, entries, times, binaries, operations |
| `keys.js` | credentials and key files |
| `protect.js` | `ProtectedValue`, inner random streams (Salsa20, ChaCha20) |
| `otp.js` | HOTP / TOTP and the entry field conventions |
| `bytes.js` | little-endian reader / writer, UUIDs, timestamps, VariantDictionary |
| `test.js` | unit tests (`node kdbx/test.js`, also run by `node check.js tests`): a KDBX 3.1 file built independently with `node:crypto` / `node:zlib` and library-written KDBX 4.0 / 4.1 files read back (icons, custom icons, history, protected values), the 4.0 / 4.1 choice, custom icon de-duplication / removal, duplicates and field references |

## Key derivation

`transformKey(composite, kdf, run)` derives the key (AES-KDF or Argon2d / Argon2id) with progress and `run.signal`; there
is no time limit. `openKdbx` / `saveKdbx` accept `run.deriveKey` to replace it (the vault app runs it in Workers);
AES-KDF exposes its two independent halves as `aesKdfHalf(seed, half, rounds, run)` and `aesKdfFinish(lo, hi)` so they
can run in parallel.

## Limits

- Not supported: KeePass 1.x `.kdb`, the Twofish cipher (plugin), ArcFour inner streams, Windows-user-account and
  challenge-response (YubiKey) key components, KDBX 3.1 writing (files are always saved as KDBX 4).
- Pure JavaScript key derivation: Argon2 needs about 0.6-0.8 s per pass over 64 MiB, AES-KDF about 3 million
  rounds per second; databases tuned for "1 second" on native code take several times longer to open.
- KDBX 4.1 elements (group tags, custom icon names, `PreviousParentGroup`, ...) make the saved file KDBX 4.1; KeePass 2.48+
  and KeePassXC 2.7+ read them, older KDBX 4.0 readers open the file and skip them.
