// studio/gallery.js - the template gallery (live thumbnails of the product's templates).
// Optional, per product: ED.templateGroups = [{ id, label (key), desc (key) }] shows the templates in sections by
// tpl.group; a template may carry mode ('offline' | 'serverless' | 'backend': a coloured label tpm.<mode> with the
// hint tpm.<mode>D), modules { req: [id], opt: [id] } (tags mod.<id> under tp.req / tp.opt), note ({ lang: text }),
// preview (data: URL of a picture instead of the live thumbnail) and href (a page that opens the template elsewhere,
// e.g. another editor of the same application, instead of build()).
import { normalizeDoc } from '../doc/model.js';
import { exportHTML } from '../doc/export.js';
import { uid } from '../util/id.js';
import { clone, h, nowISO } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pickUI, t } from '../ui/i18n.js';
import { openDialog, toast } from '../ui/overlays.js';
import { initialContentLang, startProject } from './projects.js';
import { ED } from './config.js';
import { P } from '../doc/product.js';

// ===========================================================================
// 22. Templates gallery
// ===========================================================================

// Design: each template is a function build(V, ...) -> raw document, not stored JSON: templates stay small, are
// always built against the current block registry, and the thumbnail is the real clean export of that document.

// Extra build() arguments: the blank template starts in the user's language, named like a blank document.
const tplArgs = (tpl) => (tpl.userLang ? [initialContentLang(), { name: t('pj.untitled') }] : []);

// Defensive: ED.templates is product-supplied (may be a getter that throws); a broken list hides the gallery
// instead of breaking boot, which calls this on first run.
function templatesList() {
  try { return Array.isArray(ED.templates) ? ED.templates : []; } catch { return []; }
}

const MODES = ['offline', 'serverless', 'backend'];

// One card = one <button>: keyboard and screen-reader activation for free; the thumbnail is aria-hidden decoration,
// the accessible name comes from the text inside. The mode is whitelisted because it becomes part of a class name.
function card(tpl, onPick) {
  const frameBox = h('div', { class: 'ed-tpl-prev', 'aria-hidden': 'true' });
  const mode = MODES.includes(tpl.mode) ? tpl.mode : '';
  const mods = tpl.modules || {};
  const tags = [...(mods.req || []).map((m) => [m, true]), ...(mods.opt || []).map((m) => [m, false])];
  const el = h('button', { type: 'button', class: 'ed-tpl' + (mode ? ' ed-tpl-m-' + mode : ''), onclick: () => onPick(tpl) },
    frameBox,
    h('span', { class: 'ed-tpl-info' },
      h('span', { class: 'ed-tpl-head' }, h('strong', {}, pickUI(tpl.name) || tpl.id),
        mode ? h('span', { class: 'ed-tpl-mode ed-tpl-mode-' + mode, title: t('tpm.' + mode + 'D') }, t('tpm.' + mode)) : null),
      h('small', { class: 'ed-muted' }, pickUI(tpl.desc)),
      tags.length ? h('span', { class: 'ed-tpl-tags' }, tags.map(([m, req]) => h('span', { class: 'ed-tpl-tag' + (req ? '' : ' ed-tpl-tag-opt'), title: t(req ? 'tp.req' : 'tp.opt') }, t('mod.' + m)))) : null,
      tpl.note ? h('small', { class: 'ed-tpl-note' }, pickUI(tpl.note)) : null,
      tpl.langs?.length ? h('small', { class: 'ed-tpl-langs' }, (tpl.userLang ? [initialContentLang()] : tpl.langs).map((l) => l.toUpperCase()).join(' · ')) : null));
  if (tpl.preview) frameBox.append(h('img', { class: 'ed-tpl-img', src: tpl.preview, alt: '', loading: 'lazy' }));
  else if (tpl.href) frameBox.append(h('span', { class: 'ed-tpl-fallback', html: icon(tpl.icon || 'template') }));
  else buildTplPreview(tpl, frameBox);
  return el;
}

function openTemplates() {
  let api = null;
  // href templates navigate away (another editor of the app); new URL() resolves it relative to this page so the
  // build may rewrite paths. The dialog closes only when the project actually started (useTemplate may be refused).
  const pick = (tpl) => {
    if (tpl.href) { api?.close(null); location.assign(new URL(tpl.href, location.href).href); return; }
    useTemplate(tpl).then((ok) => { if (ok) api?.close(null); });
  };
  const all = templatesList();
  const groups = Array.isArray(ED.templateGroups) && ED.templateGroups.length ? ED.templateGroups : null;
  let body;
  if (groups) {
    body = h('div', {}, h('p', { class: 'ed-hint' }, t('tp.hint')),
      h('p', { class: 'ed-tpl-legend' }, MODES.map((m) => h('span', { class: 'ed-tpl-mode ed-tpl-mode-' + m }, t('tpm.' + m))).flatMap((x, i) => [x, h('small', { class: 'ed-muted' }, ' ' + t('tpm.' + MODES[i] + 'D') + ' ')])),
      ...groups.map((g) => {
        const list = all.filter((x) => x.group === g.id);
        if (!list.length) return null;
        return h('section', { class: 'ed-tpl-group' }, h('h3', { class: 'ed-tpl-gh' }, t(g.label)), g.desc ? h('p', { class: 'ed-muted ed-tpl-gd' }, t(g.desc)) : null,
          h('div', { class: 'ed-tpl-grid' }, list.map((tpl) => card(tpl, pick))));
      }));
  } else {
    body = h('div', {}, h('p', { class: 'ed-hint' }, t('tp.hint')), h('div', { class: 'ed-tpl-grid' }, all.map((tpl) => card(tpl, pick))));
  }
  openDialog({
    title: t('tp.title'), body, wide: true, className: 'ed-dlg-tpl',
    buttons: [{ label: t('dlg.close'), value: null }],
    onMount: (a) => { api = a; },
  });
}

// Scaled live mini preview: the real (clean) export rendered in a sandboxed iframe without scripts.
// sandbox='' = everything off (scripts, forms, same origin): dozens of thumbnails must not run code or steal focus;
// tabindex -1 keeps them out of the tab order; loading=lazy defers off-screen cards. The injected style hides
// scrollbars and the page toolbar, which only make sense at full size. Scaling itself is CSS (editor.css).
async function buildTplPreview(tpl, box) {
  try {
    const doc = normalizeDoc(tpl.build(ED.api, ...tplArgs(tpl)));
    const { html } = await exportHTML(doc, { mode: 'clean', minify: false, embedSource: false });
    const fr = h('iframe', { class: 'ed-tpl-frame', sandbox: '', tabindex: '-1', title: pickUI(tpl.name) || tpl.id, loading: 'lazy' });
    fr.srcdoc = html.replace('</head>', `<style>html,body{overflow:hidden!important}.${P.prefix}-toolbar{display:none!important}</style></head>`);
    box.append(fr);
  } catch (e) {
    console.warn('template preview', tpl.id, e);
    box.append(h('span', { class: 'ed-tpl-fallback', html: icon('template') }));
  }
}

// clone(): build() may return shared constants; the project must own its objects. A fresh id and timestamps make
// it a new project even when the same template is picked twice.
async function useTemplate(tpl) {
  let doc;
  try { doc = tpl.build(ED.api, ...tplArgs(tpl)); } catch (e) { toast(t('tp.err', { msg: e.message }), 'error'); return false; }
  doc = clone(doc);
  doc.id = uid();
  if (!doc.meta) doc.meta = {};
  doc.meta.created = doc.meta.modified = nowISO();
  return startProject(doc);
}

export {
  openTemplates,
  templatesList
};
