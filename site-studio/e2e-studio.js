// site-studio/e2e-studio.js - a "backend + constructor" package: the site editor at /_studio/ (the single-file Site
// Studio behind the server's host script) loads the live project for an administrator, publishes a change and the site
// shows it. Run by e2e-modes.mjs.
export default async function scenario() {
  // Harness conventions (shared by every in-page scenario of this folder):
  // - The default export runs inside the page check.js opened; its return value (R) is the report check.js prints.
  // - `until` polls a predicate instead of awaiting app events: the scenario observes the UI like a user, so it needs
  //   no test hooks in production code and survives refactors of internal event names. Throwing predicates count as
  //   "not yet"; the timeout message carries the predicate's source so a failure names what was awaited.
  // - `step` never throws: every step runs and reports ok / FAIL, so one broken feature does not hide the rest.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 30000) => {
    const t0 = Date.now();
    for (;;) { let v; try { v = await f(); } catch { v = null; } if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + f.toString().slice(0, 100)); await sleep(100); }
  };
  const R = { steps: [] };
  const step = async (name, fn) => { try { R.steps.push([name, 'ok', await fn()]); } catch (e) { R.steps.push([name, 'FAIL', String((e && e.stack) || e).slice(0, 400)]); } };
  const json = (url, method = 'GET', body) => fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

  await step('the constructor is announced to administrators', async () => {
    const r = await json('/api/_auth/register', 'POST', { email: 'owner@example.org', password: 'a long password' });
    const info = await json('/api/_admin/info');
    return [r.user.role, info.studio];
  });

  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:99999;background:#fff';
  await step('/_studio/ opens the editor with the live project', async () => {
    document.body.append(frame);
    frame.src = '/_studio/';
    const w = await until(() => frame.contentWindow && frame.contentWindow.__edReady && frame.contentWindow);
    const name = await until(() => w.__ed.S.doc && /Lens/.test(w.__ed.S.doc.name) && w.__ed.S.doc.name);
    await until(() => w.document.querySelector('.ss-rm'));
    return [name, !!w.SS_REMOTE];
  });

  await step('a change in the constructor is published to the site', async () => {
    const w = frame.contentWindow;
    w.__ed.commit('e2e title', () => { w.__ed.S.doc.meta.title = { en: 'Lens — edited live', ru: 'Lens — правка вживую' }; });
    w.document.querySelector('.ss-rm-pub').click();
    const html = await until(async () => { const t = await fetch('/', { cache: 'no-store' }).then((x) => x.text()); return /edited live|правка вживую/.test(t) && t; });
    return /<title>[^<]*(edited live|правка вживую)/.test(html);
  });

  await step('a visitor gets no constructor API', async () => {
    await json('/api/_auth/logout', 'POST', {});
    const r = await fetch('/api/_admin/site.json', { credentials: 'same-origin' });
    return r.status;
  });
  frame.remove();
  return R;
}
