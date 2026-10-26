# walletui

The user interface shared by the wallet applications (`bitcoin-wallet/`, `ethereum-wallet/`): the encrypted vault and
its screens, recovery phrases, QR codes, the address book, endpoint choice, charts, the section frame and its styles,
strings in the seven UI languages. Built on `ui/` (dialogs, menus, i18n), `qr/`, `crypto/` and `hdkey/`.

| module | contents |
| --- | --- |
| `vault.js` | `sealVault` / `openVault` (password → Argon2id `m = 64 MiB, t = 3` or scrypt → AES-256-GCM, a JSON envelope), `sealWithKey` / `openWithKey` (re-encryption while unlocked), `VaultSession` (create, unlock, save, lock, auto-lock after inactivity, change password, export / import the encrypted backup, destroy) |
| `lock.js` | `lockScreen` (first run, unlock with progress, restore a backup, reset), `vaultSettings` (auto-lock delay, lock now, change password, backup download) |
| `mnemonic.js` | `mnemonicGrid` (hidden until revealed, with the backup warning), `backupCheck` (asks for random words), `mnemonicInput` (completion from every official BIP-39 list, word and checksum feedback) |
| `qr.js` | `qrElement`, `showQr` (long texts as cycling `pXofN` parts), `scanQr` (camera or picture, joins parts), `splitParts`, `joinParts` |
| `addressbook.js` | `addressBookView` (list, context menu by right click / long press), `editContact`, `pickContact` |
| `endpoints.js` | `endpointPicker`: presets are only listed — nothing is contacted until the user picks one and accepts the privacy note; custom URLs; the application's own backend |
| `chart.js` | `lineChart` (single series over time, crosshair tooltip), `barChart`, `dataTable` (SVG, theme tokens) |
| `shell.js` | `ARTIFACT`, `MODE`, `OFFLINE`, hash routes (`route`, `go`, `onRoute`), `tabBar` (a bottom bar on phones), `section`, `kv`, `busy`, `statusLine`, `linkTo`, `mono`, `copyable` |
| `net.js` / `net.offline.js` | `probeBackend(app)`, `backendCall(path, opts)`, `apiBase()`, `ONLINE` — the offline twin has no network code |
| `format.js` | `short`, `ago`, `dateTime`, `num`, `bytes`, `pct` |
| `strings.js`, `strings-*.js` | the shared strings (`wu.*`) in en, ru, uk, de, fr, es, ka |
| `wallet.css` | styles (`wu-*`) on top of `ui/base.css` and `ui/app.css` |
| `test.js` | `node walletui/test.js`: vault encryption (Argon2id, scrypt, wrong password, tampering), the session and auto-lock, QR parts, formatting |

Secrets live only inside the vault object while it is unlocked; locking overwrites the derived key and drops the
data. JavaScript cannot erase copies made by the engine (strings, garbage collection), so the vault limits exposure
rather than guaranteeing erasure.
