// event-invite/e2e.js - in-page scenario (node check.js e2e event-invite/html@5_offline_singlefile/index.html
// event-invite/e2e.js): a template is chosen, a date set, the calendar text holds DTSTART, the exported page answers
// an RSVP with a reply tag, the e-mail (.eml) and PDF exports are well formed, the exported HTML has no network code
// without a server and posts replies to a (mocked) server with one (online builds), and the guests page (in a frame)
// adds guests, takes statuses, shows the summary and reads a pasted reply back.
// Test style: each step records [name, ok|FAIL, observed value]; the value makes a failure diagnosable from the log
// alone. until() polls (100ms) instead of fixed sleeps where the UI renders asynchronously; plain sleeps remain only
// where nothing observable changes (debounced saves).
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  const until = async (fn, n = 60) => { for (let i = 0; i < n; i++) { try { const v = fn(); if (v) return v; } catch { /* not yet */ } await sleep(100); } return null; };
  // set(): assigning .value does not fire events; the app listens for input/change, so both are dispatched (bubbling,
  // because handlers may be delegated to a parent).
  const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };

  // Switching to another template and back proves applyScenario really rewrites state, not just the chip highlight.
  document.querySelector('.ei-tpl[data-k="supra"]').click();
  await sleep(200);
  document.querySelector('.ei-tpl[data-k="wedding"]').click();
  await sleep(200);
  step('template applied', document.querySelector('.ei-tpl[data-k="wedding"]').getAttribute('aria-checked') === 'true', document.querySelector('.ei-texts input')?.value);
  set(document.querySelector('#ei-day'), '2027-06-12');
  set(document.querySelector('#ei-time'), '16:00');
  await sleep(300);
  const words = document.querySelector('.ei-when-words').textContent;
  step('when in words', /2027/.test(words) && /12/.test(words), words);
  const ics = document.querySelector('.ei-ics-text').textContent;
  step('ics DTSTART', /DTSTART[^\n]*20270612T160000/.test(ics), ics.split('\n').find((l) => l.startsWith('DTSTART')));

  // The exported page (same document as the preview), without sandbox so the scenario can drive it.
  // The preview iframe is sandboxed; a fresh unsandboxed frame with the same srcdoc gives the test DOM access.
  const src = await until(() => document.querySelector('#ei-preview').srcdoc);
  step('preview built', !!src && src.includes('iv-data'), src && src.length);
  const f = document.createElement('iframe');
  f.style.cssText = 'width:420px;height:800px';
  f.srcdoc = src;
  document.body.append(f);
  const fd = await until(() => f.contentDocument.querySelector('.iv-form') && f.contentDocument);
  step('invitation renders', !!fd, fd && fd.querySelector('.iv-title')?.textContent);
  if (fd) {
    fd.querySelector('input[value="yes"]').click();
    set(fd.querySelector('[name="iv-name"]'), 'Test Guest');
    fd.querySelector('.iv-form').dispatchEvent(new Event('submit', { cancelable: true }));
    const reply = await until(() => fd.querySelector('.iv-reply-text')?.textContent);
    // Reply tag format [RSVP|guest|answer|plus|name...]: '-' = no guest token (the generic link).
    step('reply tag', /\[RSVP\|-\|yes\|0\|Test Guest/.test(reply || ''), reply);
    step('reply qr', !!fd.querySelector('.iv-qr svg'), '');
    // `var` on purpose: function-scoped, so the reply text survives the block and feeds the guests-page import below.
    var replyText = reply;
  }
  f.remove();

  // Downloads are captured instead of saved: the exporters create <a download> and call click(); patching the
  // prototype intercepts every one of them. Restored after the export steps so later code behaves normally.
  const got = [];
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) got.push({ name: this.download, href: this.href }); else realClick.call(this); };
  const grab = async (x) => {
    got.length = 0;
    document.querySelector('[data-x="' + x + '"]').click();
    const d = await until(() => got[0], 80);
    return d ? new Uint8Array(await (await fetch(d.href)).arrayBuffer()) : new Uint8Array();
  };
  const txt = (b) => new TextDecoder().decode(b);
  const eml = txt(await grab('ei.x.eml'));
  // The base64 alternative covers an .ics attachment encoded as base64 rather than quoted-printable.
  step('eml multipart/alternative + text/calendar', /multipart\/alternative/.test(eml) && /text\/calendar/.test(eml) && /BEGIN:VCALENDAR|QkVHSU46VkNBTEVOREFS/.test(eml), eml.length);
  const pdf = await grab('ei.x.pdfA5');
  const pdfText = new TextDecoder('latin1').decode(pdf);
  step('pdf cards', pdfText.startsWith('%PDF') && (pdfText.match(/\/Type\s*\/Page\b/g) || []).length >= 1, pdf.length);
  const plain = txt(await grab('ei.x.html'));
  // "No network code" heuristic: no fetch( and no ivNet object literal in the exported HTML.
  step('html without server has no network code', plain.length > 1000 && !/fetch\s*\(/.test(plain) && !plain.includes('ivNet={') && !plain.includes('ivNet = {'), plain.length);

  // Online builds: with a server the exported page posts the reply (to a mocked fetch) and confirms it.
  // The .ei-sv-url field exists only when ONLINE; offline builds skip this block entirely.
  const urlIn = document.querySelector('.ei-sv-url');
  if (urlIn) {
    set(urlIn, 'https://rsvp.example.test');
    set(document.querySelector('.ei-sv-event'), 'evtest');
    await sleep(100);
    const live = txt(await grab('ei.x.html'));
    step('html with server carries the poster', live.includes('ivNet') && live.includes('rsvp.example.test'), live.length);
    const h2 = document.createElement('iframe');
    h2.style.cssText = 'width:420px;height:800px';
    h2.srcdoc = live;
    document.body.append(h2);
    const hd = await until(() => h2.contentWindow.ivNet && h2.contentDocument.querySelector('.iv-open, .iv-form') && h2.contentDocument, 80);
    if (hd) {
      const calls = [];
      // fetch replaced on the frame's window after it started: invite-net.js looks up the global fetch per call.
      h2.contentWindow.fetch = async (url, init) => { calls.push({ url: String(url), body: init && init.body }); return new Response(JSON.stringify({ ok: true, id: 'r1' }), { status: 201, headers: { 'Content-Type': 'application/json' } }); };
      hd.querySelector('.iv-open')?.click();
      const form = await until(() => hd.querySelector('.iv-form'), 60);
      form.querySelector('input[value="yes"]').click();
      set(form.querySelector('[name="iv-name"]'), 'Online Guest');
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      const ok = await until(() => hd.querySelector('.iv-sent'), 60);
      const post = calls.find((c) => /\/api\/events\/evtest\/rsvp$/.test(c.url));
      step('posts the reply to the server', !!ok && !!post && /"answer":"yes"/.test(post.body), post && post.url);
    } else step('posts the reply to the server', false, 'page did not start');
    h2.remove();
    set(urlIn, '');
    set(document.querySelector('.ei-sv-event'), '');
  }
  HTMLAnchorElement.prototype.click = realClick;

  // Guests page (after the designer has saved, so its storage event does not reach the new frame).
  // The 700ms wait outlasts the designer's debounced save, so the guests page reads the final state at load.
  await sleep(700);
  const g = document.createElement('iframe');
  g.style.cssText = 'width:1300px;height:900px';
  g.src = document.getElementById('pg-guests').href;
  document.body.append(g);
  const gd = await until(() => g.contentDocument?.querySelector('.ei-paste') && g.contentDocument, 80);
  step('guests page', !!gd, '');
  if (gd) {
    gd.querySelector('.ei-paste').value = 'Nino Beridze <nino@example.com>\nGiorgi Kapanadze\nAna, Анна <ana@example.com>';
    gd.querySelector('.ei-add').click();
    await sleep(200);
    const rows = gd.querySelectorAll('.ei-g-row:not(.ei-g-head)');
    step('guests added', rows.length === 3, rows.length + ' ' + (gd.querySelector('.ed-toast')?.textContent || ''));
    if (rows.length < 3) return { steps };
    set(rows[0].querySelector('.ei-g-status'), 'yes');
    set(rows[0].querySelector('.ei-g-coming'), '1');
    set(rows[1].querySelector('.ei-g-status'), 'no');
    await sleep(200);
    const n = (k) => gd.querySelector(`.ei-tile[data-k="${k}"] .ei-tile-n`)?.textContent;
    step('summary', n('yes') === '1' && n('no') === '1' && n('none') === '1' && n('seats') === '2', { yes: n('yes'), no: n('no'), none: n('none'), seats: n('seats') });
    gd.querySelector('.ei-replies').value = 'mail text\n' + (replyText || '');
    gd.querySelector('.ei-import').click();
    await sleep(200);
    step('reply imported', n('total') === '4' && n('yes') === '2' && n('seats') === '3', { total: n('total'), yes: n('yes'), seats: n('seats') });
  }
  g.remove();
  return { steps };
}
