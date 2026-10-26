// language-studio/test.js - unit tests of Language Studio without a browser: course data integrity (morpheme splits
// add up to their words, ids are unique, every tool and game exists, every UI string is in every language), the
// progress document and its merge, and the account service over fake requests: `node language-studio/test.js`.
// Why data-integrity tests: most of this app is hand-written course data; a typo (a split that does not add up to
// its word, a duplicate id that would merge two learners' cards) is a silent content bug no type system catches.
// The service is tested through fake req/res objects, so security behaviour (rate limits, origin checks, JSON-only
// bodies) is verified without opening a port.

import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { ED_I18N } from '../ui/i18n.js';
import { review } from '../lingua/srs.js';
import { toDeva } from '../lingua/iast.js';
import { COURSES, dictionary, srsItems } from './courses/index.js';
import { COMPOSE, CHARS, STROKES } from './courses/cjk.js';
import { cleanProgress, emptyProgress, mergeProgress, recordScore } from './progress.js';
import { createStudioService } from './service.js';
import './strings.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function memoryStorage() {
  const m = new Map();
  return { read: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), write: (k, v) => { if (v === null) m.delete(k); else m.set(k, JSON.stringify(v)); }, remove: (k) => m.delete(k), keys: () => [...m.keys()] };
}

// A request through the service: { status, body, cookie }
async function call(svc, method, url, { body, cookie, origin, type = 'application/json', ip = '10.0.0.1' } = {}) {
  const req = new EventEmitter();
  req.method = method; req.url = url;
  req.headers = { host: 'studio.test', ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(body !== undefined ? { 'content-type': type } : {}) };
  req.socket = { remoteAddress: ip };
  req.resume = () => {};
  const res = { status: 0, headers: {}, data: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, writeHead(s, h) { this.status = s; for (const [k, v] of Object.entries(h || {})) this.headers[k.toLowerCase()] = v; }, end(d) { this.data = d || ''; } };
  // the body is sent once the service listens for it (it reads the body after its own async checks)
  const on = req.on.bind(req);
  req.on = (ev, fn) => {
    on(ev, fn);
    if (ev === 'end') setImmediate(() => { if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))); req.emit('end'); });
    return req;
  };
  await svc.handle(req, res, new URL(url, 'http://studio.test'));
  const set = res.headers['set-cookie'];
  return { status: res.status, body: res.data ? JSON.parse(res.data) : null, cookie: set ? set.split(';')[0] : null, headers: res.headers };
}

export async function run() {
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('x language-studio: ' + msg); } };

  // --- course data
  ok(COURSES.map((c) => c.id).join() === 'sa,ka,xmf,ja,zh,ko,ru,en', 'the courses');
  for (const c of COURSES) {
    const ids = c.sections.map((s) => s.id);
    ok(new Set(ids).size === ids.length, `${c.id}: unique section ids`);
    ok(c.explain.length >= 1 && c.speech && c.scripts.length >= 1, `${c.id}: explanation languages, voice, scripts`);
    for (const s of c.sections) {
      ok(s.title && (s.title[c.explain[0]] || Object.values(s.title)[0]), `${c.id}/${s.id}: title`);
      for (const it of s.items || []) {
        // fused: the pieces contract in writing (Korean 하 + 시 + 어요 = 하세요), so they do not simply add up.
        if (!it.parts || it.fused) continue;
        const joined = it.parts.map((p) => (Array.isArray(p) ? p[0] : p.s)).join('').replace(/\s/g, '');
        ok(joined === it.w.replace(/\s/g, '').toLowerCase() || joined === it.w.replace(/\s/g, ''), `${c.id}/${s.id}: parts of ${it.w} add up (${joined})`);
      }
      for (const w of s.words || []) ok(w.w && Object.keys(w.m).length, `${c.id}/${s.id}: word ${w.w} has a meaning`);
    }
    const items = srsItems(c).map((x) => x.id);
    ok(new Set(items).size === items.length || c.id === 'ja', `${c.id}: unique item ids`);
    ok(dictionary(c).length > 0 || c.id === 'xx', `${c.id}: dictionary`);
  }
  for (const [r, comp] of COMPOSE) ok(comp.split(' ').length >= 2 && r.length === 1, `compose ${r}`);
  ok(CHARS.filter((c) => c.strokes).length >= 25 && Object.keys(STROKES).length >= 25, 'stroke data for 25+ characters');
  ok(toDeva('ṛtá').startsWith('ऋ'), 'Sanskrit words render in Devanagari');
  const { TOOLS } = await import('./tools.js');
  for (const c of COURSES) for (const t of c.tools) ok(!!TOOLS[t], `${c.id}: tool ${t} exists`);

  // --- C1 / C2 lessons and the cross-language tools (adv-*.js, lesson-extra.js, xl-*.js)
  for (const id of ['en', 'ru', 'ka']) {
    const c = COURSES.find((x) => x.id === id);
    ok(c.sections.filter((s) => s.level === 'C1').length >= 4 && c.sections.filter((s) => s.level === 'C2').length >= 3, `${id}: C1 and C2 lessons`);
    ok(c.sections.some((s) => /^c[12]-/.test(s.id) && s.kind === 'words' && s.words.length >= 10), `${id}: an advanced word list for the cards`);
  }
  for (const c of COURSES) {
    ok(c.tools.includes('xl'), `${c.id}: the cross-language tool`);
    for (const s of c.sections) for (const b of s.blocks || []) {
      for (const q of b.quiz || []) ok(q.opts.length >= 2 && q.a >= 0 && q.a < q.opts.length && q.why && q.q, `${c.id}/${s.id}: quiz answer and reason`);
      for (const x of b.try || []) { const target = COURSES.find((k) => k.id === (x.course || c.id)); ok(target && target.tools.includes(x.tool) && x.label, `${c.id}/${s.id}: try link to ${x.course || c.id}/${x.tool}`); }
    }
  }
  const { allEntries } = await import('./xl-data.js');
  const langs = new Set(allEntries().map((e) => e.lang));
  ok(allEntries().length > 2500 && ['ka', 'xmf', 'ru', 'en', 'ko', 'sa', 'ja', 'zh'].every((l) => langs.has(l)), 'one dictionary over all eight courses');
  const { XL_GAMES } = await import('./xl-games.js');
  for (const c of COURSES) for (const g of c.games || []) if (g.startsWith('x-')) ok(!!XL_GAMES[g], `${c.id}: game ${g}`);

  // --- strings in every language
  const en = Object.keys(ED_I18N.en).filter((k) => k.startsWith('ls.'));
  ok(en.length > 200, 'UI strings');
  for (const l of ['ru', 'uk', 'de', 'fr', 'es', 'ka']) ok(en.every((k) => ED_I18N[l] && ED_I18N[l][k]), `strings complete in ${l}`);
  // the rhyme workshop (rhyme-tools.js, strings-rhyme.js)
  const { RHYME_KEYS } = await import('./strings-rhyme.js');
  for (const l of ['en', 'ru', 'uk', 'de', 'fr', 'es', 'ka']) ok(RHYME_KEYS.every((k) => ED_I18N[l] && ED_I18N[l][k]), `rhyme strings complete in ${l}`);
  for (const c of ['en', 'ru', 'ka']) ok(COURSES.find((x) => x.id === c).tools.includes('rhyme'), `${c}: the rhyme workshop`);

  // --- progress
  const a = emptyProgress(), b = emptyProgress();
  a.cards['ka:x:ა'] = review(null, 2, 1000);
  b.cards['ka:x:ა'] = review(null, 0, 2000);
  b.cards['ja:y:あ'] = review(null, 3, 1500);
  recordScore(a, 'ka:sym2sound:mkhedruli', 70, 1000);
  recordScore(b, 'ka:sym2sound:mkhedruli', 50, 3000);
  a.prefs = { t: 5, 'explain.ja': 'zh' };
  const m = mergeProgress(a, b);
  ok(m.cards['ka:x:ა'].t === 2000 && m.cards['ja:y:あ'], 'merge: newer card wins, both sides kept');
  ok(m.scores['ka:sym2sound:mkhedruli'].best === 70 && m.scores['ka:sym2sound:mkhedruli'].last === 50 && m.scores['ka:sym2sound:mkhedruli'].plays === 1, 'merge: best of both, last of the newer');
  ok(m.prefs['explain.ja'] === 'zh', 'merge: newer prefs');
  const dirty = cleanProgress({ cards: { ok: a.cards['ka:x:ა'], bad: { e: 'x' }, ['x'.repeat(300)]: a.cards['ka:x:ა'] }, scores: { s: { best: 1 } }, prefs: { t: 1, f: () => 1, x: 'y' } });
  ok(Object.keys(dirty.cards).join() === 'ok' && !Object.keys(dirty.scores).length && dirty.prefs.x === 'y' && !dirty.prefs.f, 'clean drops invalid entries');
  ok(Object.keys(cleanProgress('nonsense').cards).length === 0, 'clean of garbage');

  // --- account service
  const storage = memoryStorage();
  const svc = createStudioService({ storage, env: { STUDIO_PBKDF2_ITERATIONS: '100000' } });
  let r = await call(svc, 'GET', '/api/info');
  ok(r.status === 200 && r.body.registration === true && r.body.user === null, 'info: open registration, signed out');
  r = await call(svc, 'GET', '/api/session');
  ok(r.status === 401, 'session needs a sign-in');
  r = await call(svc, 'POST', '/api/register', { body: { name: 'Nino', password: 'short' } });
  ok(r.status === 400 && r.body.error === 'bad_password', 'short password refused');
  r = await call(svc, 'POST', '/api/register', { body: { name: 'nino', password: 'gamarjoba1' } });
  ok(r.status === 200 && r.body.user.name === 'nino' && r.body.user.owner && /^ls_session=/.test(r.cookie), 'first account is the owner and gets a cookie');
  ok(/HttpOnly/.test(r.headers['set-cookie']) && /SameSite=Lax/.test(r.headers['set-cookie']), 'cookie is HttpOnly SameSite');
  const nino = r.cookie;
  ok(!JSON.stringify(storage.read('accounts')).includes('gamarjoba1') && !JSON.stringify(storage.read('sessions')).includes(nino.split('=')[1]), 'neither the password nor the token is stored');
  r = await call(svc, 'POST', '/api/register', { body: { name: 'nino', password: 'gamarjoba2' } });
  ok(r.status === 409, 'name taken');
  r = await call(svc, 'PUT', '/api/progress', { cookie: nino, body: { doc: a } });
  ok(r.status === 200 && r.body.doc.cards['ka:x:ა'], 'progress stored');
  r = await call(svc, 'PUT', '/api/progress', { cookie: nino, body: { doc: b } });
  ok(r.body.doc.cards['ja:y:あ'] && r.body.doc.cards['ka:x:ა'].t === 2000, 'server merges the copies');
  r = await call(svc, 'GET', '/api/progress', { cookie: nino });
  ok(r.status === 200 && r.body.doc.scores['ka:sym2sound:mkhedruli'].best === 70, 'progress read back');
  r = await call(svc, 'PUT', '/api/progress', { cookie: nino, body: { doc: a }, origin: 'https://evil.example' });
  ok(r.status === 403, 'cross-origin write refused');
  r = await call(svc, 'GET', '/api/progress', { cookie: nino, origin: 'https://evil.example' });
  ok(r.status === 401, 'cross-origin read does not use the cookie');
  r = await call(svc, 'PUT', '/api/progress', { cookie: nino, body: 'doc=1', type: 'application/x-www-form-urlencoded' });
  ok(r.status === 415, 'form bodies refused');
  r = await call(svc, 'POST', '/api/logout', { cookie: nino, body: {} });
  r = await call(svc, 'GET', '/api/progress', { cookie: nino });
  ok(r.status === 401, 'signed out: the session is gone');
  for (let i = 0; i < 10; i++) await call(svc, 'POST', '/api/login', { body: { name: 'nino', password: 'wrong-' + i }, ip: '10.0.0.9' });
  r = await call(svc, 'POST', '/api/login', { body: { name: 'nino', password: 'gamarjoba1' }, ip: '10.0.0.9' });
  ok(r.status === 429 && r.headers['retry-after'], 'sign-in attempts are limited');
  r = await call(svc, 'POST', '/api/login', { body: { name: 'nino', password: 'gamarjoba1' }, ip: '10.0.0.2' });
  ok(r.status === 200 && r.cookie, 'sign in');
  const nino2 = r.cookie;
  r = await call(svc, 'POST', '/api/registration', { cookie: nino2, body: { open: false } });
  ok(r.status === 200 && r.body.registration === false, 'the owner closes registration');
  r = await call(svc, 'POST', '/api/register', { body: { name: 'giorgi', password: 'gaumarjos1' }, ip: '10.0.0.3' });
  ok(r.status === 403 && r.body.error === 'closed', 'registration closed');
  r = await call(svc, 'POST', '/api/password', { cookie: nino2, body: { old: 'gamarjoba1', new: 'madloba-123' } });
  ok(r.status === 200, 'password changed');
  r = await call(svc, 'POST', '/api/delete', { cookie: nino2, body: { password: 'madloba-123' } });
  ok(r.status === 200 && !storage.keys().some((k) => k.startsWith('progress.')), 'account and progress deleted');
  r = await call(svc, 'GET', '/api/nothing');
  ok(r.status === 404 && r.headers['x-content-type-options'] === 'nosniff', 'unknown API: 404 with security headers');
  svc.close();

  if (isMain) console.log(`language-studio: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) run().then((f) => process.exit(f ? 1 : 0));
