// event-invite/invite-net.js - the network part of an exported invitation, added to the page only when the host set
// an RSVP server (bundles.js netCode; offline builds never carry it). It defines globalThis.ivNet, which
// invite-runtime.js uses: send(D, reply) posts the reply (JSON, three tries with back-off), counts(D) reads the live
// counts when the host allows them. Any failure leaves the runtime's offline reply (mailto / SMS / QR / copy).
// D = the invitation data embedded in the exported page (endpoint, event id). encodeURIComponent on the event id:
// it is host-chosen text and must not inject path segments.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = (D) => String(D.endpoint || '').replace(/\/+$/, '') + '/api/events/' + encodeURIComponent(D.event || '');

// Retry policy: up to `tries` attempts, 12s timeout each, exponential back-off 700ms, 1.4s. Retries only what can
// succeed later: network errors / timeouts (catch), 5xx and 429. Other 4xx (bad request, closed event) break at once;
// repeating them only delays the fallback UI. Guests often reply from weak mobile connections, hence retries at all.
async function request(url, init, tries) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const tm = setTimeout(() => ctl.abort(), 12000);
      const r = await fetch(url, { ...init, signal: ctl.signal }).finally(() => clearTimeout(tm));
      const data = await r.json().catch(() => ({}));
      if (r.ok) return data;
      last = new Error(data.error || 'HTTP ' + r.status);
      if (r.status < 500 && r.status !== 429) break;
    } catch (e) { last = e; }
    if (i < tries - 1) await sleep(700 * 2 ** i);
  }
  throw last || new Error('failed');
}

// A global, not an export: the exported page inlines this file as its own <script type="module"> ahead of the runtime, which
// feature-detects globalThis.ivNet and falls back to offline replies when it is absent. counts() gets one try: it is
// decorative, a failure just hides the counter.
globalThis.ivNet = {
  send: (D, reply) => request(base(D) + '/rsvp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reply) }, 3),
  counts: (D) => request(base(D) + '/counts', { method: 'GET' }, 1),
};
