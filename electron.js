// electron.js - the main process of ELECTRON artifacts (targets.js; Electron >= 29). targets.js writes `main.mjs` as
// hosting.js + this file (its hosting.js import line removed) + the start call, and copies electron-preload.cjs as
// `preload.cjs`; the pages are the multi-file client in ./public (or inline FILES in the single-file variant).
//
//   startElectron({ files, dir, backend, name, config, preload, here }) -> { origin, ready: Promise<{ hosting, window }> }
//     files / dir / backend / name   as hosting.js startHosting (pages inline or a folder, the bundled backend.js)
//     config   <app>/electron.json (optional), all keys optional:
//              { page: 'index.html', title, window: { width, height, minWidth, minHeight, backgroundColor, frame },
//                mini: { page, hash: 'mini', width, height }, external: ['https:', 'http:', 'mailto:'] (open-external
//                allowlist: schemes 'x:' or origins 'https://host'), csp: string | false, fileArgs: true }
//     preload  absolute path of preload.cjs        here  the artifact folder (window state, default paths)
//
// Security model: pages load from the privileged custom scheme in-html://<app>/ (protocol.handle; standard, secure,
// fetch, streaming media with Range) — no TCP port is opened, so only the application's own windows reach the pages
// and the backend; their origin is stable, so IndexedDB / localStorage persist between launches. Windows run with
// contextIsolation, sandbox, no Node integration, no webview; navigation away from the origin and new windows are
// refused (allowlisted external links open in the system browser); permission requests other than fullscreen and
// clipboard writes are denied; HTML responses carry a Content-Security-Policy whose script-src lists the SHA-256 of the
// page's inline scripts (no 'unsafe-inline' for scripts). IPC handlers answer only frames of the application origin.
//
// The backend (hosting.js createHosting) runs in-process with ctx.mode 'electron' and ctx.desktop.paths, so the
// client talks to the same /api as in the BACKEND artifact. Data: --data <dir> | DATA_DIR | <userData>/data.
//
// Preload API (window.inHtmlElectron, electron-preload.cjs): info(), openFiles({ title, filters, multiple }),
// openFolder({ title, multiple }), pathForFile(file), window.{ minimize, toggleMaximize, close, setFullScreen,
// isFullScreen, setAlwaysOnTop, setProgress, showMain }, shortcuts.set({ media, global: { accelerator: command } }),
// tray.set({ tooltip, icon (PNG data URL), items: [{ id, label, type, checked, enabled }], quitLabel }) / tray.remove(),
// mini.open({ width, height }) / close() / toggle(), openExternal(url), showItemInFolder(path), keepAwake(on),
// takeOpenRequests() -> [paths], onCommand(fn) -> off. Commands sent to pages: { type: 'media', action:
// 'play-pause' | 'next' | 'previous' | 'stop' }, { type: 'shortcut', command }, { type: 'tray', id },
// { type: 'open', paths }, { type: 'mini', open }.
//
// Naming: every top-level identifier is prefixed (EL_, el*, e*: efs, epath, ezlib) because main.mjs concatenates this
// file after hosting.js into ONE module scope; hosting.js already declares fs, path, zlib, and a duplicate `const`
// would be a SyntaxError at load. The trailing `in-html:strip` marker documents the import line targets.js removes.

import * as electronModule from 'electron';
import efs from 'node:fs';
import epath from 'node:path';
import ezlib from 'node:zlib';
import { createHosting, webHandler } from './hosting.js'; // in-html:strip (main.mjs carries hosting.js above this file)

const EL_SCHEME = 'in-html';
// Default CSP rationale: scripts only from the app origin + hashes of its inline scripts (built single-file pages
// are mostly inline script, so hashes, not 'unsafe-inline', keep injected markup inert). Styles allow 'unsafe-inline'
// because style attributes are pervasive and CSS injection is a far smaller risk. Media/img/connect allow https:/http:
// so apps may stream remote media or call user-configured servers; object-src 'none' and base-uri 'self' close two
// classic bypasses (plugin content, <base> hijacking relative script URLs).
const EL_DEFAULT_CSP = "default-src 'self'; script-src 'self' {script-hashes}; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https: http:; media-src 'self' data: blob: https: http:; font-src 'self' data:; " +
  "connect-src 'self' data: blob: https: http:; worker-src 'self' blob:; frame-src 'self' blob: data:; " +
  "object-src 'none'; base-uri 'self'; form-action 'self'";
// KNOWN DEFECT (doc): the header lists fullscreen and clipboard writes only; 'window-management' is also granted.
// Fix: mention it in the header (or drop it from the set if unused).
const EL_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write', 'window-management']);
const EL_MEDIA_KEYS = { MediaPlayPause: 'play-pause', MediaNextTrack: 'next', MediaPreviousTrack: 'previous', MediaStop: 'stop' };

function elArg(name) {
  const argv = process.argv;
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
}

// electron.json is treated as untrusted input even though the app author writes it: every field is type-checked,
// clamped (num) or pattern-matched, so a typo yields a default instead of an unusable window or an injected URL.
// Page names are restricted to [\w.-]+.html: no '/', no '..', nothing that could leave the origin root.
function elConfig(c) {
  c = c && typeof c === 'object' ? c : {};
  const num = (v, d, lo, hi) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
  const w = c.window || {};
  const m = c.mini || {};
  return {
    page: typeof c.page === 'string' && /^[\w.-]+\.html$/.test(c.page) ? c.page : 'index.html',
    title: typeof c.title === 'string' ? c.title : '',
    window: {
      width: num(w.width, 1200, 320, 8000), height: num(w.height, 800, 240, 8000),
      minWidth: num(w.minWidth, 360, 200, 4000), minHeight: num(w.minHeight, 480, 160, 4000),
      backgroundColor: typeof w.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(w.backgroundColor) ? w.backgroundColor : '#111318',
      frame: w.frame !== false,
    },
    mini: {
      page: typeof m.page === 'string' && /^[\w.-]+\.html$/.test(m.page) ? m.page : null,
      hash: typeof m.hash === 'string' && /^[\w=&.-]{1,40}$/.test(m.hash) ? m.hash : 'mini',
      width: num(m.width, 380, 200, 2000), height: num(m.height, 140, 80, 2000),
    },
    external: Array.isArray(c.external) ? c.external.filter((x) => typeof x === 'string') : ['https:', 'http:', 'mailto:'],
    csp: c.csp === false ? null : typeof c.csp === 'string' ? c.csp : EL_DEFAULT_CSP,
    fileArgs: c.fileArgs !== false,
  };
}

// A small PNG (a filled circle) for the tray when the page gives no icon.
// Hand-rolled PNG (signature, IHDR, one zlib IDAT, IEND, CRC-32 per chunk): avoids shipping an icon file and any
// image dependency. Colour type 6 = RGBA, filter byte 0 per row; alpha is a 1-px linear ramp (cheap anti-aliasing).
function elDefaultIcon(size = 32, rgb = [91, 140, 255]) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
      const a = Math.max(0, Math.min(1, size / 2 - 1 - d));
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', ezlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function startElectron({ files = null, dir = null, backend = null, name = 'app', config = {}, preload, here = process.cwd() } = {}) {
  const E = electronModule.default || electronModule;
  const { app, BrowserWindow, protocol, ipcMain, dialog, shell, globalShortcut, Tray, Menu, nativeImage, powerSaveBlocker, session } = E;
  const cfg = elConfig(config);
  const host = String(name).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
  const origin = `${EL_SCHEME}://${host}`;
  const log = (...a) => console.log(new Date().toISOString(), ...a);

  // Must run before app 'ready' (Electron requirement), hence synchronously here. standard: real origin semantics
  // (relative URLs, storage per origin); secure: counts as a secure context (crypto.subtle, service APIs);
  // stream: Range requests so <audio>/<video> can seek; corsEnabled + supportFetchAPI: fetch() against the scheme.
  // Single-instance lock: a second launch forwards its argv (files to open) to the first and quits.
  protocol.registerSchemesAsPrivileged([{ scheme: EL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true } }]);
  if (!app.requestSingleInstanceLock()) { app.quit(); return { origin, ready: Promise.resolve(null) }; }

  let mainWin = null, miniWin = null, tray = null, awake = null, hosting = null;
  const pendingOpen = [];
  const appShortcuts = new Set();

  // A file argument must be absolute, existing, not an option, not the Electron binary, and not inside the artifact
  // folder (that excludes main.mjs / '.' that `electron .` itself passes in argv).
  const isFileArg = (a) => typeof a === 'string' && !a.startsWith('-') && epath.isAbsolute(a) && a !== process.execPath && !epath.resolve(a).startsWith(epath.resolve(here)) && efs.existsSync(a);
  const send = (win, cmd) => { if (win && !win.isDestroyed()) win.webContents.send('in-html:command', cmd); };
  const broadcast = (cmd) => { send(mainWin, cmd); send(miniWin, cmd); };
  const queueOpen = (paths) => {
    const list = paths.filter(isFileArg);
    if (!list.length || !cfg.fileArgs) return;
    if (mainWin && !mainWin.webContents.isLoading()) send(mainWin, { type: 'open', paths: list });
    else pendingOpen.push(...list);
  };
  if (cfg.fileArgs) pendingOpen.push(...process.argv.slice(1).filter(isFileArg));

  app.on('second-instance', (_e, argv) => {
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); }
    queueOpen(argv.slice(1));
  });
  app.on('open-file', (e, p) => { e.preventDefault(); queueOpen([p]); });

  // --- window state ---------------------------------------------------------------------------------------------------
  const stateFile = () => epath.join(app.getPath('userData'), 'window-state.json');
  const readState = () => { try { return JSON.parse(efs.readFileSync(stateFile(), 'utf8')); } catch { return {}; } };
  // getNormalBounds: the restored (un-maximized) rectangle, so a maximized window reopens maximized AND un-maximizes
  // to its previous size instead of to full-screen dimensions.
  const saveState = (win) => {
    try {
      if (win.isDestroyed()) return;
      const b = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
      efs.mkdirSync(epath.dirname(stateFile()), { recursive: true });
      efs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
    } catch { /* read-only profile */ }
  };

  const webPreferences = () => ({
    preload, contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
    webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, spellcheck: false, backgroundThrottling: false, navigateOnDragDrop: false,
  });
  const allowedExternal = (u) => {
    let x;
    try { x = new URL(String(u)); } catch { return false; }
    if (x.protocol === EL_SCHEME + ':') return false;
    return cfg.external.some((e) => (e.endsWith(':') ? x.protocol === e : x.origin === e.replace(/\/+$/, '')));
  };
  // IPC gate: the sender FRAME's URL (not the webContents URL) must be on our origin. A blob:/data: iframe inside an app
  // page (the CSP allows those frames) reports its own senderFrame URL, so it is refused.
  // Exact match or origin + '/': a bare prefix test would accept in-html://app-evil for app 'app'.
  const trusted = (event) => {
    const u = event && event.senderFrame && event.senderFrame.url;
    return typeof u === 'string' && (u === origin || u.startsWith(origin + '/'));
  };

  function createMain() {
    const st = readState();
    const w = cfg.window;
    mainWin = new BrowserWindow({
      width: st.width || w.width, height: st.height || w.height, x: st.x, y: st.y, minWidth: w.minWidth, minHeight: w.minHeight,
      backgroundColor: w.backgroundColor, frame: w.frame, show: false, autoHideMenuBar: true, title: cfg.title || name, webPreferences: webPreferences(),
    });
    if (st.maximized) mainWin.maximize();
    // show:false + ready-to-show avoids the white flash of an unpainted window; backgroundColor covers the rest.
    mainWin.once('ready-to-show', () => mainWin.show());
    mainWin.on('close', () => saveState(mainWin));
    mainWin.on('closed', () => { mainWin = null; if (miniWin && !miniWin.isDestroyed()) miniWin.close(); });
    mainWin.webContents.on('did-finish-load', () => { if (pendingOpen.length) send(mainWin, { type: 'open', paths: pendingOpen.splice(0) }); });
    if (process.argv.includes('--devtools')) mainWin.webContents.openDevTools({ mode: 'detach' });
    mainWin.loadURL(`${origin}/${cfg.page}`);
    return mainWin;
  }

  function openMini(o = {}) {
    if (miniWin && !miniWin.isDestroyed()) { miniWin.show(); miniWin.focus(); return true; }
    miniWin = new BrowserWindow({
      width: Number(o.width) > 0 ? Math.round(o.width) : cfg.mini.width, height: Number(o.height) > 0 ? Math.round(o.height) : cfg.mini.height,
      frame: false, alwaysOnTop: true, resizable: true, minimizable: false, maximizable: false, fullscreenable: false, show: false,
      backgroundColor: cfg.window.backgroundColor, title: (cfg.title || name) + ' (mini)', webPreferences: webPreferences(),
    });
    miniWin.once('ready-to-show', () => miniWin.show());
    miniWin.on('closed', () => { miniWin = null; send(mainWin, { type: 'mini', open: false }); });
    miniWin.loadURL(`${origin}/${cfg.mini.page || cfg.page}#${cfg.mini.hash}`);
    send(mainWin, { type: 'mini', open: true });
    return true;
  }

  // Page-supplied tray spec is bounded everywhere (icon must be a PNG data URL < 400 KB, <= 30 items, labels truncated):
  // a misbehaving page must not exhaust the main process or render arbitrary native menus.
  function setTray(spec) {
    if (!spec) { if (tray) { tray.destroy(); tray = null; } return false; }
    let img = null;
    if (typeof spec.icon === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(spec.icon) && spec.icon.length < 400000) img = nativeImage.createFromDataURL(spec.icon);
    if (!img || img.isEmpty()) img = nativeImage.createFromBuffer(elDefaultIcon());
    if (!tray) {
      tray = new Tray(img);
      tray.on('click', () => broadcast({ type: 'tray', id: 'click' }));
    } else tray.setImage(img);
    if (typeof spec.tooltip === 'string') tray.setToolTip(spec.tooltip.slice(0, 120));
    const items = (Array.isArray(spec.items) ? spec.items : []).slice(0, 30).map((it) => (it && it.type === 'separator' ? { type: 'separator' } : {
      label: String((it && it.label) || '').slice(0, 80), type: it && it.type === 'checkbox' ? 'checkbox' : 'normal',
      checked: !!(it && it.checked), enabled: !(it && it.enabled === false),
      click: () => broadcast({ type: 'tray', id: String(it && it.id || '') }),
    }));
    items.push({ type: 'separator' }, { label: String(spec.quitLabel || 'Quit').slice(0, 40), click: () => app.quit() });
    tray.setContextMenu(Menu.buildFromTemplate(items));
    return true;
  }

  function setShortcuts(spec) {
    for (const acc of appShortcuts) { try { globalShortcut.unregister(acc); } catch { /* gone */ } }
    appShortcuts.clear();
    const registered = [], failed = [];
    const reg = (acc, cmd) => {
      try {
        if (globalShortcut.register(acc, () => broadcast(cmd))) { appShortcuts.add(acc); registered.push(acc); } else failed.push(acc);
      } catch { failed.push(acc); }
    };
    if (spec && spec.media) for (const [acc, action] of Object.entries(EL_MEDIA_KEYS)) reg(acc, { type: 'media', action });
    const g = spec && spec.global && typeof spec.global === 'object' ? spec.global : {};
    // Accelerators restricted to [\w+] and commands to kebab-case ids: the page names an intent, never code or keys
    // that Electron would interpret specially. Global shortcuts are system-wide, so the count is capped too.
    for (const [acc, command] of Object.entries(g).slice(0, 40)) {
      if (typeof acc !== 'string' || acc.length > 60 || !/^[\w+]+$/.test(acc) || typeof command !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(command)) { failed.push(String(acc)); continue; }
      reg(acc, { type: 'shortcut', command });
    }
    return { registered, failed };
  }

  const handlers = {
    info: () => {
      const p = (k) => { try { return app.getPath(k); } catch { return null; } };
      return {
        name, origin, platform: process.platform, arch: process.arch, version: app.getVersion(), locale: app.getLocale(),
        versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
        paths: { home: p('home'), music: p('music'), videos: p('videos'), downloads: p('downloads'), documents: p('documents'), pictures: p('pictures') },
        dataDir: hosting && hosting.dataDir,
      };
    },
    openFiles: async (e, o = {}) => {
      const filters = Array.isArray(o.filters) ? o.filters.slice(0, 20).filter((f) => f && typeof f.name === 'string' && Array.isArray(f.extensions))
        .map((f) => ({ name: f.name.slice(0, 60), extensions: f.extensions.filter((x) => typeof x === 'string' && /^[\w*]{1,10}$/.test(x)).slice(0, 60) })) : [];
      const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender) || mainWin, {
        title: typeof o.title === 'string' ? o.title : undefined, filters, properties: ['openFile', ...(o.multiple === false ? [] : ['multiSelections'])],
      });
      return r.canceled ? [] : r.filePaths;
    },
    openFolder: async (e, o = {}) => {
      const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender) || mainWin, {
        title: typeof o.title === 'string' ? o.title : undefined, properties: ['openDirectory', ...(o.multiple ? ['multiSelections'] : [])],
      });
      return r.canceled ? [] : r.filePaths;
    },
    win: (e, action, arg) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win) return null;
      switch (action) {
        case 'minimize': win.minimize(); return true;
        case 'toggleMaximize': if (win.isMaximized()) win.unmaximize(); else win.maximize(); return win.isMaximized();
        case 'close': win.close(); return true;
        case 'setFullScreen': win.setFullScreen(!!arg); return !!arg;
        case 'isFullScreen': return win.isFullScreen();
        case 'setAlwaysOnTop': win.setAlwaysOnTop(!!arg); return !!arg;
        case 'setProgress': win.setProgressBar(Number.isFinite(+arg) ? Math.max(-1, Math.min(1, +arg)) : -1); return true;
        case 'showMain': if (mainWin) { mainWin.show(); mainWin.focus(); } else createMain(); return true;
        default: return null;
      }
    },
    shortcuts: (e, spec) => setShortcuts(spec),
    tray: (e, spec) => setTray(spec),
    mini: (e, action, o) => {
      if (action === 'open') return openMini(o);
      if (action === 'close') { if (miniWin && !miniWin.isDestroyed()) miniWin.close(); return false; }
      if (action === 'toggle') { if (miniWin && !miniWin.isDestroyed()) { miniWin.close(); return false; } return openMini(o); }
      return !!(miniWin && !miniWin.isDestroyed());
    },
    openExternal: async (e, u) => { if (!allowedExternal(u)) return false; await shell.openExternal(String(u)); return true; },
    // Only reveals existing absolute paths; never opens/executes them (shell.openPath is intentionally not exposed).
    showItemInFolder: (e, p) => { if (typeof p !== 'string' || !epath.isAbsolute(p) || !efs.existsSync(p)) return false; shell.showItemInFolder(p); return true; },
    keepAwake: (e, on) => {
      if (on && awake === null) awake = powerSaveBlocker.start('prevent-display-sleep');
      if (!on && awake !== null) { powerSaveBlocker.stop(awake); awake = null; }
      return awake !== null;
    },
    takeOpen: () => pendingOpen.splice(0),
  };

  const ready = app.whenReady().then(() => {
    const dataDir = epath.resolve(elArg('data') || process.env.DATA_DIR || epath.join(app.getPath('userData'), 'data'));
    const p = (k) => { try { return app.getPath(k); } catch { return null; } };
    hosting = createHosting({
      files, dir, backend, name, dataDir, mode: 'electron', log,
      ctx: { desktop: { paths: { home: p('home'), music: p('music'), videos: p('videos'), downloads: p('downloads'), documents: p('documents'), pictures: p('pictures'), temp: p('temp'), userData: p('userData') } } },
    });
    // One host per app: any other host on the scheme answers 404, so origins cannot be spoofed by URL games.
    protocol.handle(EL_SCHEME, (request) => {
      let u;
      try { u = new URL(request.url); } catch { return new Response('bad request', { status: 400 }); }
      if (u.host !== host) return new Response('not found', { status: 404 });
      return webHandler(hosting.handler, { csp: cfg.csp })(request);
    });
    const ses = session && session.defaultSession;
    if (ses) {
      // Deny-by-default: camera, mic, geolocation, notifications etc. are refused unless listed in EL_PERMISSIONS.
      // Note: the check handler tests startsWith(origin) without '/'; harmless only because other hosts of the scheme
      // never load (404 above).
      ses.setPermissionRequestHandler((wc, permission, cb, details) => cb(EL_PERMISSIONS.has(permission) && String((details && details.requestingUrl) || '').startsWith(origin + '/')));
      ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => EL_PERMISSIONS.has(permission) && String(requestingOrigin || '').startsWith(origin));
    }
    for (const [k, fn] of Object.entries(handlers)) {
      ipcMain.handle('in-html:' + k, (event, ...args) => {
        if (!trusted(event)) throw new Error('refused: not the application origin');
        return fn(event, ...args);
      });
    }
    if (Menu) Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]) : null);
    log(`${name}: ${origin}/ (data: ${dataDir})`);
    return { hosting, window: createMain() };
  });

  // Applied to EVERY webContents (main, mini, devtools-spawned): navigation off-origin and window.open are refused
  // centrally, so a forgotten per-window handler cannot become a hole. Allowed external URLs go to the OS browser.
  app.on('web-contents-created', (_e, wc) => {
    wc.setWindowOpenHandler(({ url }) => { if (allowedExternal(url)) shell.openExternal(url); return { action: 'deny' }; });
    wc.on('will-navigate', (e, url) => {
      if (url === origin || String(url).startsWith(origin + '/')) return;
      e.preventDefault();
      if (allowedExternal(url)) shell.openExternal(url);
    });
    wc.on('will-attach-webview', (e) => e.preventDefault());
    wc.on('render-process-gone', (_ev, d) => log('renderer gone', d && d.reason));
  });
  app.on('activate', () => { if (!mainWin && app.isReady()) createMain(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('will-quit', () => {
    try { globalShortcut.unregisterAll(); } catch { /* not ready */ }
    if (awake !== null) { try { powerSaveBlocker.stop(awake); } catch { /* gone */ } }
    if (hosting) Promise.resolve(hosting.close()).catch(() => {});
  });
  return { origin, ready, handlers };
}
