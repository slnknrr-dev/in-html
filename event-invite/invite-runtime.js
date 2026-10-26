// event-invite/invite-runtime.js - the script of an exported invitation (never imported by the designer: bundles.js
// carries it as `invite-runtime.js?bundle` and the export inlines it). It reads the data from #iv-data, the guest
// from #guest=… (or the one baked into a personalised file), picks the language, shows the envelope and opens it
// (a click, Enter or Space; no animation under prefers-reduced-motion), renders the card, switches languages, saves
// the event as .ics, and turns the RSVP form into a reply: the text, a mailto: / sms: link, a copy button and a QR
// code. With an RSVP server (invite-net.js on the page defines globalThis.ivNet) the reply is also posted, confirmed
// and the live counts shown; when posting fails the offline reply stays. Without it nothing is ever fetched.
//
// Design: the same pure HTML builders of invite.js render the designer preview, the exported file and this runtime,
// so what the host sees is byte-for-byte what guests get. The runtime is a small state machine:
//   envelope (opened=false) -> card (opened=true) -> reply shown | sending -> sent.
// Every transition re-renders root.innerHTML from state (D, lang, guest, F, sent); no incremental DOM patching, so
// a language switch can never leave half-translated widgets. F keeps form values across re-renders.
// Every builder escapes text (esc); D comes from the host but #guest= comes from any URL, so escaping is mandatory.
import { esc, cardHTML, decodeGuest, envelopeHTML, guestDisplayName, icsText, pickLang, replyPanelHTML, replyQRText, replyText, localDay, tr } from './invite.js';
import { qrSVG } from '../qr/qr.js';

// The guest token sits in the fragment (#guest=...), which browsers never send to the server hosting the file.
// Any decode error = no guest: a mangled link must still show the generic invitation.
function hashGuest() {
  try { return decodeGuest(new URLSearchParams(String(location.hash || '').slice(1)).get('guest')); } catch { return null; }
}

function boot() {
  // Guards make the module inert outside a page with the expected markup (e.g. imported by a test runner).
  if (typeof document === 'undefined') return;
  const dataEl = document.getElementById('iv-data'), root = document.getElementById('iv-app');
  if (!dataEl || !root) return;
  let D;
  // Data as <script type="application/json">: parsed, never executed; invalid JSON just leaves the static page.
  try { D = JSON.parse(dataEl.textContent); } catch { return; }
  if (!D || !Array.isArray(D.langs) || !D.langs.length) return;
  const preview = D.preview || {};
  // Language priority: designer preview choice, the guest's language, then the browser's languages (pickLang).
  let guest = hashGuest() || D.guest || null;
  let lang = pickLang(D, preview.lang || (guest && guest.l), navigator.languages || [navigator.language]);
  // Motion is off if the host disabled it or the OS asks for reduced motion; evaluated at open time, not cached,
  // so a setting changed while the page is open is respected.
  const still = () => D.design?.motion === false || matchMedia('(prefers-reduced-motion: reduce)').matches;
  let opened = !D.design?.envelope || !!preview.open;
  const F = { response: '', name: '', plus: 0, menu: '', diet: '', msg: '' };
  let sent = '';
  let replyShown = false;

  function render(focusTitle) {
    document.documentElement.lang = lang;
    // documentElement.lang follows the content language: screen readers switch voice and hyphenation follows.
    root.innerHTML = opened ? cardHTML(D, lang, { guest, today: localDay(), F }) : envelopeHTML(D, lang, guest);
    if (opened) { bindCard(); if (sent) showSent(); else if (replyShown) showReply(); refreshCounts(); }
    else bindEnvelope();
    // Focus moves to the title after opening, so keyboard and screen-reader users land on the content, not on a
    // button that no longer exists. preventScroll: the scroll is handled separately after the animation.
    if (focusTitle) root.querySelector('.iv-title')?.focus({ preventScroll: true });
  }

  function bindEnvelope() {
    const stage = root.querySelector('.iv-env-stage'), env = root.querySelector('.iv-env');
    // busy: a double click during the 1.7s animation must not start a second timeline.
    let busy = false;
    const open = () => {
      if (busy) return;
      busy = true;
      if (still()) { opened = true; render(true); return; }
      stage.classList.add('iv-opening');
      // Two timers mirror the CSS animation: 1250ms = the envelope fades (iv-gone), 1700ms = the card replaces it. They
      // must stay in sync with the .iv-opening / .iv-gone transition timings in the invite.js CSS.
      setTimeout(() => stage.classList.add('iv-gone'), 1250);
      setTimeout(() => {
        opened = true;
        render(true);
        root.querySelector('.iv-card')?.classList.add('iv-in');
        window.scrollTo({ top: 0 });
      }, 1700);
    };
    env.addEventListener('click', open);
    // The envelope is a role=button element (not a <button>, it holds complex art): Enter and Space are wired by hand,
    // preventDefault stops Space from scrolling the page.
    env.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    root.querySelector('.iv-open')?.addEventListener('click', open);
  }

  function readForm(form) {
    const fd = new FormData(form);
    F.response = String(fd.get('iv-r') || '');
    F.name = String(fd.get('iv-name') || '').trim();
    // Plus-ones clamped to the input's own max (set from the guest's allowance), not trusted from the field value.
    F.plus = Math.max(0, +fd.get('iv-plus') || 0);
    const max = +(form.querySelector('[name="iv-plus"]')?.max || 0);
    if (F.plus > max) F.plus = max;
    F.menu = String(fd.get('iv-menu') || '');
    F.diet = String(fd.get('iv-diet') || '').trim();
    F.msg = String(fd.get('iv-msg') || '');
  }

  function bindCard() {
    // After a language switch the clicked button is re-created; focus is restored to its replacement.
    for (const b of root.querySelectorAll('[data-lang]')) b.addEventListener('click', () => { lang = b.dataset.lang; render(); root.querySelector(`[data-lang="${lang}"]`)?.focus(); });
    root.querySelector('[data-ics]')?.addEventListener('click', () => {
      const text = icsText(D, lang);
      if (!text) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
      a.download = (String(D.uid || 'event').replace(/[^\w-]+/g, '') || 'event') + '.ics';
      document.body.append(a); a.click(); a.remove();
      // Revoke later, not immediately: some browsers start the download asynchronously after click().
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
    const form = root.querySelector('.iv-form');
    if (!form) return;
    const sync = () => {
      readForm(form);
      for (const el of form.querySelectorAll('.iv-if-yes')) el.hidden = F.response !== 'yes';
    };
    // change toggles the "yes only" fields (radio clicks); input just records text so re-renders keep it.
    form.addEventListener('change', sync);
    form.addEventListener('input', () => readForm(form));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      readForm(form);
      const err = form.querySelector('.iv-err');
      err.textContent = !F.response ? tr(D, lang, 'ei.inv.needAnswer') : !F.name ? tr(D, lang, 'ei.inv.needName') : '';
      if (err.textContent) { replyShown = false; root.querySelector('.iv-reply').hidden = true; return; }
      replyShown = true;
      // With a server: post and confirm; without one (or offline builds, where ivNet is never defined): offline reply.
      if (globalThis.ivNet && D.endpoint && D.event) post(); else showReply(true);
    });
  }

  function showReply(focus) {
    const box = root.querySelector('.iv-reply');
    if (!box || !F.response || !F.name) return;
    const text = replyText(D, lang, { ...F, id: guest && guest.i });
    let qr = '';
    // QR error-correction 'L': the reply text is long, and the QR is scanned from a screen (no print damage), so the
    // smallest, least dense code wins.
    try { qr = qrSVG(replyQRText(D, lang, text), { ec: 'L', margin: 2, title: tr(D, lang, 'ei.inv.qr') }); } catch { qr = ''; }
    box.innerHTML = replyPanelHTML(D, lang, text, qr);
    box.hidden = false;
    box.querySelector('[data-copy]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      let ok = false;
      // Clipboard API first; fallback for file:// and older browsers where it is unavailable or denied: select the text
      // and execCommand('copy'), deprecated but still the only synchronous option there.
      try { await navigator.clipboard.writeText(text); ok = true; } catch {
        const pre = box.querySelector('.iv-reply-text');
        const r = document.createRange(); r.selectNodeContents(pre);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
        try { ok = document.execCommand('copy'); } catch { ok = false; }
      }
      if (ok) { const was = btn.textContent; btn.textContent = tr(D, lang, 'ei.inv.copied'); setTimeout(() => { btn.textContent = was; }, 1600); }
    });
    if (focus) box.querySelector('.iv-reply-text')?.focus({ preventScroll: false });
  }

  // Live preview of the designer: new data (and stylesheet) by message from the parent frame, the scroll stays.
  // Only installed when D.preview is set (designer frames), never in exported pages. e.source === window.parent
  // rejects messages from any other window; a srcdoc frame has an opaque origin, so an origin check would not help.
  if (preview && D.preview) {
    window.addEventListener('message', (e) => {
      if (e.source !== window.parent || !e.data || e.data.iv !== 'update') return;
      const nd = e.data.D;
      if (!nd || !Array.isArray(nd.langs) || !nd.langs.length) return;
      D = nd;
      const style = document.querySelector('style');
      if (style && typeof e.data.css === 'string') style.textContent = e.data.css;
      document.body.classList.toggle('iv-still', D.design?.motion === false);
      if (D.preview?.lang && D.langs.includes(D.preview.lang)) lang = D.preview.lang;
      else if (!D.langs.includes(lang)) lang = D.langs[0];
      if (!D.design?.envelope) opened = true;
      render();
    });
  }
  // esc() on every interpolated value: the guest name is user input echoed into innerHTML.
  function showSent() {
    const box = root.querySelector('.iv-reply');
    if (!box) return;
    box.innerHTML = '<div class="iv-sent" role="status" tabindex="-1"><b>' + esc(tr(D, lang, 'ei.inv.sent')) + '</b>' + esc(sent) + '</div>';
    box.hidden = false;
  }
  // Optimistic UI is avoided: "sending" is shown until the server confirms, because a false "sent" would make a
  // guest believe the host has the reply. On failure the offline reply appears with an alert (role=alert announces).
  function post() {
    const box = root.querySelector('.iv-reply');
    box.hidden = false;
    box.innerHTML = '<p class="iv-hint" role="status">' + esc(tr(D, lang, 'ei.inv.sending')) + '</p>';
    const r = { guest: (guest && guest.i) || '', name: F.name, answer: F.response, plus: F.response === 'yes' ? F.plus : 0, menu: F.response === 'yes' ? F.menu : '', diet: F.response === 'yes' ? F.diet : '', msg: F.msg, lang };
    globalThis.ivNet.send(D, r).then(() => {
      sent = F.name + ': ' + tr(D, lang, 'ei.inv.r.' + F.response) + (r.plus ? ' ' + tr(D, lang, 'ei.inv.r.plus', { n: r.plus }) : '');
      showSent();
      root.querySelector('.iv-sent')?.focus();
      refreshCounts();
    }).catch(() => {
      showReply(true);
      box.insertAdjacentHTML('afterbegin', '<p class="iv-err" role="alert">' + esc(tr(D, lang, 'ei.inv.sendFail')) + '</p>');
    });
  }
  // Counts are decorative: every failure is swallowed. Note: called on every render, so each language switch costs
  // one GET; acceptable for an occasional action.
  function refreshCounts() {
    const el = root.querySelector('.iv-live');
    if (!el || !globalThis.ivNet) return;
    globalThis.ivNet.counts(D).then((c) => {
      if (!c || !Number.isFinite(+c.yes)) return;
      el.textContent = tr(D, lang, 'ei.inv.live', { n: +c.yes, seats: +c.seats || 0 });
      el.hidden = false;
    }).catch(() => {});
  }

  // A personal link opened in an already-open tab only changes the hash; re-render for the new guest.
  window.addEventListener('hashchange', () => {
    const g = hashGuest();
    if (g) { guest = g; if (g.l && D.langs.includes(g.l)) lang = g.l; render(); }
  });
  // A token without a usable name is treated as no guest, so the card never says "Dear ,".
  if (guest && !guestDisplayName(guest, lang, D.langs[0])) guest = null;
  render();
}

boot();
