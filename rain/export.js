// rain/export.js - standalone HTML page and embeddable <canvas> snippet of a configured digital rain. The renderer
// (rainEngine) and the small page boot code are serialized with Function.prototype.toString, the parameters are
// inlined as JSON, and the result is minified with minify/: one offline file, no fonts, no network.
import { rainEngine } from './engine.js';
import { engineParams } from './params.js';
import { minifyJS } from '../minify/js.js';
import { minifyCSS } from '../minify/css.js';
import { minifyHTML } from '../minify/html.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
// JSON inside <script>: no '</script', no '<!--', no raw U+2028/9.
// '<' escaped as < stops a value from closing the script ('</script>') or opening an HTML comment ('<!--');
// U+2028 / U+2029 are escaped because older engines treated them as line terminators inside string literals.
const jsonScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));
// Defence in depth for code (not data): any literal '</script' in serialised function source is broken up.
const safeScript = (s) => s.replace(/<\/(script)/gi, '<\\/$1');

// Page behaviour of the standalone export (serialized; references only its parameters and browser globals).
// ES5 style (var, function) because it is serialised into a standalone page and must not depend on the module
// scope or a transpiler. Promise rejections from fullscreen / wake lock are swallowed: denial is a normal outcome.
function rainBoot(E, O) {
  var d = document, de = d.documentElement, hideT = 0, lock = null;
  function full() {
    if (d.fullscreenElement) { if (d.exitFullscreen) d.exitFullscreen().catch(function () {}); }
    else if (de.requestFullscreen) de.requestFullscreen().catch(function () {});
  }
  addEventListener('dblclick', full);
  addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') full();
    else if (e.key === ' ') { e.preventDefault(); E.toggle(); }
  });
  var b = d.getElementById('fs');
  if (b) b.addEventListener('click', function (e) { e.stopPropagation(); full(); });
  if (O.saver) {
    // Screensaver: the pointer and the button hide when idle, a click enters full screen, the screen stays awake.
    var idle = function () {
      clearTimeout(hideT);
      de.classList.remove('idle');
      hideT = setTimeout(function () { de.classList.add('idle'); }, 2500);
    };
    addEventListener('pointermove', idle);
    addEventListener('pointerdown', idle);
    idle();
    addEventListener('click', function () { if (!d.fullscreenElement) full(); });
    var wake = function () {
      if (lock || d.visibilityState !== 'visible' || !navigator.wakeLock) return;
      navigator.wakeLock.request('screen').then(function (l) { lock = l; l.addEventListener('release', function () { lock = null; }); }).catch(function () {});
    };
    wake();
    d.addEventListener('visibilitychange', wake);
  }
  var h = d.getElementById('hint');
  if (h) setTimeout(function () { h.className = 'out'; }, 4000);
}

// Embedded snippet behaviour: animate only while the canvas is on screen.
// Pauses when scrolled out of view: an off-screen canvas would still burn CPU and battery at full frame rate.
function rainEmbed(E) {
  if (typeof IntersectionObserver === 'undefined') return;
  new IntersectionObserver(function (es) {
    if (es[es.length - 1].isIntersecting) E.start(); else E.stop();
  }).observe(E.canvas);
}

const FS_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';

/**
 * Standalone single-file HTML of the effect.
 *   title       page title           label      accessible name of the animation
 *   lang        <html lang>          hint       text of the start hint ('' = none)
 *   button      full-screen button   buttonLabel its accessible name
 *   saver       screensaver mode (idle pointer hidden, click for full screen, wake lock)
 *   withImage   keep the background image (else an image background falls back to its colour)
 *   minify      default true
 * Returns { html, bytes }.
 */
// The engine source is embedded via toString(), which is why engine.js must stay self-contained (no imports, no
// module-level references). The result is one file that runs offline.
export function effectHTML(params, o = {}) {
  const p = engineParams(params);
  if (o.withImage === false && p.bgMode === 'image') { p.bgMode = 'color'; p.bgImage = ''; }
  if (p.bgMode !== 'image') p.bgImage = '';
  const bg = p.bgMode === 'transparent' ? 'transparent' : p.bg;
  const css = `html,body{margin:0;height:100%;overflow:hidden;background:${bg}}
canvas{position:fixed;inset:0;width:100%;height:100%;display:block}
#hint{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:calc(100vw - 32px);padding:8px 16px;border-radius:999px;
background:rgba(0,0,0,.6);color:#fff;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;pointer-events:none;transition:opacity .8s}
#hint.out{opacity:0}
#fs{position:fixed;right:16px;bottom:16px;display:grid;place-items:center;width:42px;height:42px;padding:0;border:1px solid rgba(255,255,255,.28);
border-radius:12px;background:rgba(0,0,0,.5);color:#fff;cursor:pointer;opacity:0;transition:opacity .3s}
html:hover #fs,#fs:focus-visible{opacity:.9}
#fs:focus-visible{outline:2px solid #fff;outline-offset:2px}
.idle,.idle *{cursor:none!important}
.idle #fs{opacity:0!important}
@media (prefers-reduced-motion:reduce){#hint,#fs{transition:none}}`;
  const opts = { saver: !!o.saver };
  const js = `(function(){var E=(${rainEngine.toString()})(document.getElementById('rain'),${jsonScript(p)},{auto:true});(${rainBoot.toString()})(E,${jsonScript(opts)});})();`;
  const label = o.label || 'Digital rain animation';
  let html = `<!doctype html>
<html lang="${esc(o.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="generator" content="digitalrain-effect">
<title>${esc(o.title || 'Digital rain')}</title>
<style>${css}</style>
</head>
<body>
<canvas id="rain" role="img" aria-label="${esc(label)}"></canvas>
${o.hint ? `<div id="hint" role="status">${esc(o.hint)}</div>` : ''}
${o.button ? `<button id="fs" type="button" aria-label="${esc(o.buttonLabel || 'Full screen')}" title="${esc(o.buttonLabel || 'Full screen')}">${FS_ICON}</button>` : ''}
<script>${safeScript(js)}</script>
</body>
</html>
`;
  if (o.minify !== false) html = minifyHTML(html, { js: (c) => safeScript(minifyJS(c)), css: (c) => minifyCSS(c) }).trim() + '\n';
  return { html, bytes: new TextEncoder().encode(html).length };
}

/**
 * Embeddable snippet: a <canvas> (width 100%, given CSS height) and a classic <script> that animates it while it is
 * visible. id: element id (made unique by the caller), height: CSS px, label: accessible name.
 */
export function embedSnippet(params, o = {}) {
  const p = engineParams(params);
  if (p.bgMode !== 'image' || o.withImage === false) { if (p.bgMode === 'image') p.bgMode = 'color'; p.bgImage = ''; }
  const id = String(o.id || 'digital-rain').replace(/[^A-Za-z0-9_-]/g, '') || 'digital-rain';
  const height = Math.max(40, Math.min(4000, Math.round(+o.height || 360)));
  const bg = p.bgMode === 'transparent' ? 'transparent' : p.bg;
  let engine = rainEngine.toString(), embed = rainEmbed.toString();
  if (o.minify !== false) { engine = minifyJS(engine); embed = minifyJS(embed); }
  const js = `(function(){var c=document.getElementById(${JSON.stringify(id)});if(!c)return;var E=(${engine})(c,${jsonScript(p)},{auto:true});(${embed})(E);})();`;
  return `<canvas id="${esc(id)}" role="img" aria-label="${esc(o.label || 'Digital rain animation')}" style="display:block;width:100%;height:${height}px;background:${bg}"></canvas>\n<script>${safeScript(js)}</script>\n`;
}
