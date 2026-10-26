// agreement-constructor/state.js - the state of the page shared by its panes, and the action table that main.js
// fills (the panes call actions, never each other).
//
//   S: { store, templates, docs, tpl, doc, docId (null: the template's example values), lang, second, edit,
//        showHidden, showAll, oldVersion, latest, result (last render), issues, userIssues, userRun, added, tab }
//   A: actions (main.js): refresh, refreshSoon, setValue, setModifier, setLevel, setLang, setSecond, changeTemplate,
//        open, openDoc, openTemplate, newDoc, newTemplate, duplicate, rename, remove, exportJSON, importJSON, compile,
//        print, updateToLatest, focusField, jump, runValidator, setEdit
//
// Why a shared state object plus an action table instead of imports between panes: nav.js, editor.js and side.js
// all need to trigger things that live in main.js (open a document, re-render). If panes imported main.js and main.js
// imported the panes, the modules would form a cycle; with A filled by main.js at startup, the dependency graph stays
// a tree (panes -> state.js <- main.js). The cost: A's members exist only after main.js ran, so panes must not call
// them at import time.
export const S = {
  store: null, templates: [], docs: [], tpl: null, doc: null, docId: null,
  lang: '', second: '', edit: false, showHidden: true, showAll: false,
  oldVersion: false, latest: 0, versionOwned: false,
  result: null, issues: [], userIssues: [], userRun: { ms: 0, error: '', timedOut: false, running: false, at: 0 },
  added: [], unused: [], tab: 'doc', search: '',
};
export const A = {};

// Text of a per-language value in the contract language (then the main language, then any).
// Fallback chain for per-language texts: the contract language, the template's main language, then any non-empty.
export const pick = (o, lang = S.lang) => (o && (o[lang] || (S.tpl && o[S.tpl.main]) || Object.values(o).find(Boolean))) || '';
