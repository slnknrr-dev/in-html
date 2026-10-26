// funding-studio/e2e-run.js - runs the end-to-end scenarios of this application in headless Chrome (check.js e2e) at a
// desktop (1280x900) and a phone (390x844, mobile emulation) size, against one local server that serves the repository
// and mounts backend.js with in-memory storage, configured for the mock providers of payments/mock.js (nothing reaches
// a real provider or the network):
//   node funding-studio/e2e-run.js            run e2e.js (editor) and e2e-backend.js (published page + console)
//   node funding-studio/e2e-run.js --serve    only start the servers and print the URLs (Ctrl+C to stop)
// The backend scenario gets the admin token and the published page in the console's URL hash (#e2e=…).
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// Storage double with the hosting contract (read/write/list/remove). Values are stored as JSON text, not objects, so
// the backend gets fresh copies on read exactly as with file storage - aliasing bugs that only show with a real disk
// are not hidden by shared references.
function memoryStorage() {
  const m = new Map();
  return {
    read: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null),
    write: (k, v) => { m.set(k, JSON.stringify(v)); },
    list: (p = '') => [...m.keys()].filter((k) => k.startsWith(p)),
    remove: (k) => m.delete(k),
  };
}

async function api(base, method, p, token, body) {
  const r = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${JSON.stringify(j)}`);
  return j;
}

// Mock providers + the repository server with the backend; a published charity site.
export async function startE2E() {
  const { startMockProviders } = await import('../payments/mock.js');
  const { createServer } = await import('../server.js');
  const { default: backend } = await import('./backend.js');
  const V = await import('./viewer.js');
  const { TEMPLATES } = await import('./templates.js');
  const token = 'e2e-' + crypto.randomBytes(12).toString('hex');
  const prev = process.env.FS_ADMIN_TOKEN;
  process.env.FS_ADMIN_TOKEN = token;
  const logs = [];
  const be = backend({ dataDir: '', storage: memoryStorage(), log: (...a) => logs.push(a.join(' ')), name: 'funding-studio', node: { http, https, dns, net, zlib } });
  if (prev === undefined) delete process.env.FS_ADMIN_TOKEN; else process.env.FS_ADMIN_TOKEN = prev;
  const mock = await startMockProviders({ stripe: { secretKey: 'sk_test_e2e', webhookSecret: 'whsec_e2e' }, paypal: { clientId: 'e2e-client', secret: 'e2e-secret', webhookId: 'WH-E2E' } });
  const server = createServer({ root: ROOT, quiet: true, backend: be });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}/`;
  const base = origin + 'funding-studio/';
  await api(base, 'PUT', 'api/admin/settings', token, {
    stripe: { secretKey: 'sk_test_e2e', webhookSecret: 'whsec_e2e', api: mock.url + '/stripe' },
    paypal: { clientId: 'e2e-client', secret: 'e2e-secret', webhookId: 'WH-E2E', sandbox: true, api: mock.url + '/paypal' },
  });
  mock.config.stripe.webhookURL = base + 'api/webhooks/stripe';
  mock.config.paypal.webhookURL = base + 'api/webhooks/paypal';
  const doc = V.normalizeDoc(TEMPLATES.find((t) => t.id === 'charity').build(V));
  doc.pay.bank = { ...doc.pay.bank, holder: 'Lantern Table e.V.', iban: 'DE89370400440532013000', epc: true };
  const pub = await api(base, 'PUT', 'api/admin/sites/' + doc.id, token, { doc });
  const site = new URL(pub.url, base).href;
  const close = () => new Promise((r) => { mock.close(); server.close(() => r()); if (server.closeAllConnections) server.closeAllConnections(); });
  return { base, token, site, siteId: doc.id, mock, be, logs, close };
}

function run(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'check.js'), ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
}

async function main() {
  const E = await startE2E();
  if (process.argv.includes('--serve')) {
    console.log(`editor   ${E.base}index.html\nconsole  ${E.base}admin.html#e2e=${encodeURIComponent(JSON.stringify({ token: E.token, site: E.site }))}\npage     ${E.site}\ntoken    ${E.token}`);
    return;
  }
  const SIZES = [['desktop', ['--size', '1280x900']], ['phone', ['--size', '390x844', '--mobile']]];
  const hash = '#e2e=' + encodeURIComponent(JSON.stringify({ token: E.token, site: E.site, siteId: E.siteId }));
  const jobs = [['editor', E.base + 'index.html', 'funding-studio/e2e.js'], ['backend', E.base + 'admin.html' + hash, 'funding-studio/e2e-backend.js']];
  let bad = 0;
  try {
    for (const [name, url, file] of jobs) {
      for (const [size, flags] of SIZES) {
        const r = await run(['e2e', url, file, ...flags]);
        console.log(`--- ${name} @ ${size}: ${r.code === 0 ? 'ok' : 'FAILED'}\n${r.out.trim().replace(E.token, '<token>')}`);
        if (r.code !== 0) bad++;
      }
    }
    const st = [...E.mock.stripe.sessions.values()];
    console.log(`mock Stripe: ${st.length} checkout sessions, ${E.mock.stripe.events.length} webhook events (no real provider was called)`);
  } finally { await E.close(); }
  console.log(bad ? `funding-studio e2e: ${bad} run(s) failed` : 'funding-studio e2e: all runs passed');
  process.exitCode = bad ? 1 : 0;
}

if (isMain) main().catch((e) => { console.error(e); process.exitCode = 1; });
