# kdbx-app

A KeePass-compatible password manager in one offline HTML file (`html@5_offline_singlefile/index.html`, an offline
artifact with zero network). It opens `.kdbx` files of KeePass 2.x and KeePassXC (KDBX 3.1, 4.0, 4.1) and saves KDBX 4 files they
open, using the `kdbx/` and `crypto/` libraries. Nothing ever leaves the device: the file is read from a drop or the
file picker, decrypted in memory, and saved back as a download with the same file name.

## Features

- **Unlock** with a master password and / or a key file (XML v1 / v2, 32 bytes, 64 hex characters, any file);
  the key derivation parameters of the file are shown before unlocking; the derivation has **no time limit** and runs
  in Workers (Argon2d / Argon2id in one, the two independent halves of AES-KDF in two at once — about twice as fast),
  with progress, elapsed time, an estimate of the remaining time and Cancel, so databases tuned to be expensive open
  however long they take; clear messages for a wrong key, a file that is not a database or a derivation that needs
  more memory than the browser can give. Opening and saving count as activity for the inactivity lock (a long
  derivation does not lock the vault again the moment it finishes).
- **Create** a database: name, password (twice, strength shown), optional key file (a new XML v2.0 key file is
  generated and downloaded, or an existing one chosen), key derivation and cipher.
- **Browse**: group tree (ARIA tree: arrow keys, Home / End, F2 renames, Delete; expand / collapse, entry counts,
  recycle bin), entry list (sorted, TOTP and attachment markers, expired entries struck through), entry details;
  search across every entry (fields, tags, attachment names; protected fields are not searched; the recycle bin is
  skipped).
- **Icons**: groups and entries show their KeePass icon — the 69 standard icons (`IconID` 0–68 in KeePass's order,
  drawn for this app: own artwork, one themed accent colour each) or a custom icon of the database (PNG) — in the
  tree, the list, the details and the editor. The icon picker (click the icon in the details or the editor, or
  "Change icon…" in a menu) has the standard icons with their names and the database's custom icons in
  keyboard-navigable grids (arrows, Home / End, Enter, double click); "Add from an image…" takes any image the
  browser decodes (PNG, JPEG, GIF, WebP, SVG, ICO…), scales it to at most 64 × 64 on a canvas, stores PNG, reuses an
  icon with the same content and names it after the file; unused custom icons can be deleted (one, or all unused).
  For groups the icon can also go to the group's entries or to every subgroup and entry below it (like KeePassXC's
  "Apply icon to…"). New entries take the group's icon unless it is a folder icon (then the key). Icons of several
  selected entries change at once. No favicon is ever downloaded.
- **Context menus**: the right mouse button, a long press by touch or pen (instead of the text selection and the
  system callout; the lift does not also click), the Menu key and Shift+F10 open the menu of what is under the
  pointer or focused: entries (copy user name / password / URL / one-time code, open the URL in a new tab, edit,
  duplicate, change icon, move, restore from the recycle bin, copy the entry, select, delete / delete for good),
  several selected entries (bulk duplicate, icon, move, copy, delete), the list background (new entry, paste copied
  entries, select all, empty the recycle bin), groups (new entry, new group, paste, rename, change icon, move, expand
  / collapse all, empty the recycle bin, delete) and the fields of the details (copy, show / hide, open URL, view /
  download attachments). Text selected in the details keeps the browser's menu; inputs keep theirs.
- **Multiple selection**: Ctrl / ⌘ click toggles, Shift click and Shift + arrows select ranges, Ctrl+A selects the
  list, Escape clears; on touch screens "Select" in the long-press menu starts a selection mode with check boxes
  where a tap toggles and a bar offers select all / move / icon / delete. Several entries drag onto a group at once;
  the details pane summarizes the selection with bulk actions.
- **Use**: copy user name, password, URL, custom fields and TOTP codes (field references `{REF:…}` resolved); the
  clipboard is emptied after 20 seconds; protected values are masked until revealed; TOTP codes with a countdown
  ring (KeePassXC `otp`, legacy `TOTP Seed`, KeePass `TimeOtp-*` / `HmacOtp-*`, Steam codes); open the URL in a new
  tab (http, https, ftp, mailto or a host name; other schemes are refused); password strength as in KeePassXC.
- **Password generator** (toolbar, entry editor): passwords from KeePassXC's character groups (upper, lower, digits,
  braces, punctuation, quotes, dashes, math, logograms) plus extended ASCII (Latin-1), Cyrillic, Greek and emoji,
  own characters to add or leave out, look-alike characters excluded, a character of every group (uniform, exact
  entropy), 1–128 characters; passphrases of 1–32 words from the common English list (7776 words), the short
  built-in list or an own list (kept in this page only), with a separator, letter case, a digit and a symbol. The
  result is **editable**: large monospace text (spell check, autocorrect and capitalization off) with digits,
  symbols and other alphabets coloured; typing, paste, IME and the caret are a text area's own; visible by default,
  hidden it becomes a password input. The strength line describes the current text: the exact entropy of the
  generator while the text is its output, else the zxcvbn estimate of the actual string marked "edited", with
  KeePassXC's quality words and zxcvbn's warning and advice. "Generate again" replaces the text and offers Undo of
  a replaced manual edit. Copy and "Use this password" take the text as edited. The settings (not passwords) are
  remembered in localStorage.
- **Edit**: icon, title, user name, password (inline generation with the remembered generator settings, the
  generator, a live strength line, memory protection), URL, notes, tags, expiry, custom fields (protected or not),
  TOTP (otpauth link or Base32 secret), attachments (add, remove, view text and images, download). Every edit keeps
  the previous state in the entry history (limits of the database); history versions can be viewed and restored.
- **Organize**: new / rename / move / delete groups, move entries (dialog, drag and drop onto a group, several at
  once), duplicate entries like KeePass (" - Copy" suffix, user name and password as field references to the
  original, history copied or not), copy and paste entries (also several; in this page until the vault locks),
  restore recycled entries to the group they came from, delete to the recycle bin (created on demand, localized
  name), delete for good from the bin, empty the bin.
- **Settings**: name, description, default user name, recycle bin, history size, cipher (AES-256 / ChaCha20), key
  derivation and its parameters, compression, change of the master key (password and / or key file).
- **Save** (button or Ctrl+S) downloads the database under its file name; the transformed key is reused, so saving
  is instant unless the key or the key derivation changed.
- **Lock** wipes protected values and keys from memory (the encrypted file stays, to unlock again); locking with
  unsaved changes asks to save, discard or cancel; leaving the page with unsaved changes asks for confirmation;
  the vault locks itself after 15 minutes without activity when nothing is unsaved.
- Keyboard: Ctrl+F search, Ctrl+B / Ctrl+C / Ctrl+U copy the user name / password / URL (when no text is selected),
  Ctrl+Shift+U opens the URL, Ctrl+E edits, Ctrl+K duplicates, Ctrl+A selects all entries, Delete deletes, arrow
  keys / Home / End / Page keys in the entry list (with Shift: ranges) and in the tree, the Menu key or Shift+F10 opens
  the context menu, Escape cancels editing or clears a multiple selection.
- 7 UI languages (en, ru, uk, de, fr, es, ka), light and dark schemes, one pane at a time with back buttons below
  860 px.

## Files

| file | role |
|---|---|
| `index.html` | the page |
| `main.js` | boot, lock / unlock, save, unsaved-change guards, shortcuts, inactivity lock |
| `lock.js` | lock screen and the new-database dialog |
| `kdf.js` | key derivation in Workers (no time limit, parallel AES-KDF halves, in-page fallback), parameter summary |
| `vault.js` | toolbar, group tree, entry list (multiple selection), details, context menus attached to the panes, shortcuts |
| `editor.js` | the entry editor (icon, inline generation, strength line, fields, TOTP, attachments) |
| `actions.js` | selection and the operations on entries and groups shared by panes, menus and keys (copy, open URL, duplicate, move, icons, delete, restore, copy / paste entries) |
| `menus.js` | the items of the context menus (entries, several entries, list background, groups, fields) |
| `generator.js` | password generator dialog, quick generation, the editable coloured password box, the strength line (zxcvbn) |
| `icons.js` | the 69 standard KeePass icons as SVG (own drawings, themed accent colours) |
| `iconpicker.js` | icons of groups and entries, the icon picker, custom icons from images, "apply to" for groups |
| `dialogs.js` | settings, move, duplicate, history, attachment viewer, busy overlay |
| `state.js` | shared state (selection included), clipboard with auto-clear, formatting helpers, app icons |
| `strings.js` | UI strings in 7 languages |
| `app.css` | styles on top of `ui/base.css` and `ui/app.css` |

## Limits

- Key derivation runs in JavaScript: databases tuned for "one second" on native KeePassXC (for example AES-KDF with
  millions of rounds or Argon2 with many iterations) take several times longer to open here (AES-KDF ≈ 4–5 million
  rounds per second with both halves in parallel, Argon2 ≈ 150 MiB per second and pass, one lane at a time). The
  settings accept every value the formats allow (64-bit rounds, Argon2 memory below 4 TiB, up to 2^24 − 1 lanes);
  only the browser's memory limit applies.
- The browser decides where downloads go; saving cannot overwrite the original file in place.
- No auto-type, browser integration, YubiKey challenge-response, Twofish or KeePass 1.x `.kdb` files.
- Clipboard clearing works while the page may still write to the clipboard (focused tab).
- Copied entries live in this page only (not the system clipboard, unlike KeePass's encrypted clipboard format);
  locking wipes them, so they cannot be carried to another database.
- No favicon download (zero network): custom icons come from image files only. Custom icons are stored as given
  when they are PNG files of at most 64 × 64, otherwise re-encoded; the browser decides which image formats it reads.
- Field references are resolved for display, copying and opening (`{REF:T|U|P|A|N|I@T|U|P|A|N|I|O:…}`); other
  KeePass placeholders (`{USERNAME}`, `{DT_…}`, …) are shown as written.
- Saving with a custom icon name, a moved item (PreviousParentGroup) or group tags writes KDBX 4.1 (KeePass 2.48+ and
  KeePassXC 2.7+ read it; older 4.0 readers open it and skip those elements).
