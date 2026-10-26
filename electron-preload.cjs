// electron-preload.cjs - the preload script of ELECTRON artifacts (targets.js copies it as preload.cjs; electron.js is
// the main process). It runs sandboxed with context isolation and exposes one small, explicit API to the page as
// window.inHtmlElectron — native file / folder dialogs that return real paths, the real path of a dropped File,
// window controls, global shortcuts and media keys, the tray, the mini-player window, opening allowlisted links in
// the system browser and revealing a file — nothing more powerful (no Node, no fs, no arbitrary IPC). Every call goes
// to a fixed ipcMain handler that checks the calling frame's origin. Pages detect the bridge with
// `globalThis.inHtmlElectron` (and IN_HTML_ARTIFACT.mode === 'electron').
//
// Why CommonJS (.cjs): sandboxed preloads cannot load ES modules; `require` here is Electron's restricted shim that only
// offers 'electron' and a few safe modules. Security model: the page never receives ipcRenderer itself (that would
// let it invoke any channel); it gets closures bound to fixed 'in-html:*' channels, and every option object is
// re-built field by field so a page cannot smuggle getters, prototypes or extra keys across the bridge. Values are
// coerced (!!, Number, String) so the main process sees primitives of the expected type.
'use strict';

const electron = require('electron');
const { contextBridge, ipcRenderer } = electron;
// webUtils.getPathForFile (Electron >= 29) replaced File.path, which was removed for sandboxed renderers; the fallback
// keeps older builds working. try/catch: property access itself may throw in some sandbox configurations.
let webUtils = null;
try { webUtils = electron.webUtils || null; } catch { webUtils = null; }

const call = (channel, ...args) => ipcRenderer.invoke('in-html:' + channel, ...args);
// One IPC subscription fans out to page listeners: page callbacks never see the IPC event object (it carries `sender`,
// a handle the page must not hold), and a throwing listener cannot stop the others.
const listeners = new Set();
ipcRenderer.on('in-html:command', (_event, cmd) => {
  for (const fn of listeners) { try { fn(cmd); } catch (e) { console.error(e); } }
});

contextBridge.exposeInMainWorld('inHtmlElectron', {
  version: 1,
  info: () => call('info'),
  openFiles: (o) => call('openFiles', o && typeof o === 'object' ? { title: o.title, filters: o.filters, multiple: o.multiple } : {}),
  openFolder: (o) => call('openFolder', o && typeof o === 'object' ? { title: o.title, multiple: o.multiple } : {}),
  pathForFile: (file) => {
    try { return (webUtils ? webUtils.getPathForFile(file) : file && file.path) || ''; } catch { return ''; }
  },
  window: {
    minimize: () => call('win', 'minimize'),
    toggleMaximize: () => call('win', 'toggleMaximize'),
    close: () => call('win', 'close'),
    setFullScreen: (on) => call('win', 'setFullScreen', !!on),
    isFullScreen: () => call('win', 'isFullScreen'),
    setAlwaysOnTop: (on) => call('win', 'setAlwaysOnTop', !!on),
    setProgress: (p) => call('win', 'setProgress', Number(p)),
    showMain: () => call('win', 'showMain'),
  },
  shortcuts: { set: (spec) => call('shortcuts', spec && typeof spec === 'object' ? { media: !!spec.media, global: spec.global || {} } : {}) },
  tray: {
    set: (spec) => call('tray', spec && typeof spec === 'object' ? { tooltip: spec.tooltip, icon: spec.icon, items: spec.items, quitLabel: spec.quitLabel } : {}),
    remove: () => call('tray', null),
  },
  mini: {
    open: (o) => call('mini', 'open', o && typeof o === 'object' ? { width: o.width, height: o.height } : {}),
    close: () => call('mini', 'close'),
    toggle: (o) => call('mini', 'toggle', o && typeof o === 'object' ? { width: o.width, height: o.height } : {}),
    isOpen: () => call('mini', 'state'),
  },
  openExternal: (url) => call('openExternal', String(url)),
  showItemInFolder: (p) => call('showItemInFolder', String(p)),
  keepAwake: (on) => call('keepAwake', !!on),
  takeOpenRequests: () => call('takeOpen'),
  onCommand: (fn) => {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
});
