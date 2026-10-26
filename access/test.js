// access/test.js - unit tests of the access library: `node access/test.js` (importing the module runs nothing).
// Roles with inheritance and revocation, explanations and the matrix, member grants with expiry and objects, view-as;
// the data policy cascade (modes, overrides reset by a lower mode, own records, the trace); session scopes (parse,
// store, ratchet, intersection, read-only allowlist, effective = rights ∩ scope, lifetime, idle polls); need tokens;
// the module catalogue (deps, cascading disable, views cascade, stranded embeds); layered configuration (sparse
// layers, empty overrides, snapshot sources, secrets, validation, hosts). Ported from the portal and retail suites.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGrants, roleChain, roleGrants, explainGrant, can, memberGrant, grantsWithin, canViewAs, objectAllowed, modulesOf, grantMatrix, isLive } from './roles.js';
import { definePolicy, resolvePolicy, explainRule, policyAccess, isOwn, canView, canEdit, allowed, filterVisible } from './policy.js';
import { createScopeModel, FULL_SCOPE, normalizeScope, parseScope, scopeText, isFullScope, scopeWithin, scopeIntersect, scopeAllowsGroup, scopeDrops, scopeAllowsWrite, applyScope, effectiveRights, cleanTtlDays, cleanIdleSec, sessionAlive, shouldTouchSeen, isIdleSilent } from './scope.js';
import { tokenSet, hasToken, parseNeed, needMet, needAllMet, filterByNeed } from './tokens.js';
import { VIEWS, checkCatalog, withDeps, dependents, enableModule, disableModule, viewsFor, applyModules, moduleVisible, embedPoints } from './modules.js';
import { SECRETISH, stripSecrets, defineConfig, normalizeLayer, mergeLayers, snapshotConfig, validateConfig, langInLocales, httpUrl, normalizeHost, resolveHost, cleanLocales } from './config.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const throws = (name, fn, re) => { try { fn(); fail++; console.log(`FAIL ${name}: no throw`); } catch (e) { eq(name, re.test(e.message), true); } };
  const sets = (m) => Object.fromEntries([...m].map(([k, v]) => [k, [...v].sort()]));

  // --- roles --------------------------------------------------------------------------------------------------------
  eq('grants normalized', normalizeGrants({ pos: true, catalog: ['view', 'edit', 'view'], x: [], y: '*', '': ['view'] }), { pos: ['*'], catalog: ['view', 'edit'], y: ['*'] });
  eq('grants from a section list', normalizeGrants(['pos', 'cash']), { pos: ['*'], cash: ['*'] });
  const roles = [
    { id: 'staff', grants: { catalog: ['view'], tasks: ['view', 'create'] } },
    { id: 'seller', parent: 'staff', grants: { pos: '*', catalog: ['view', 'edit'] } },
    { id: 'trainee', parent: 'seller', revoke: { pos: '*', catalog: ['edit'] } },
    { id: 'loop1', parent: 'loop2', grants: ['a'] }, { id: 'loop2', parent: 'loop1', grants: ['b'] },
    { id: 'orphan', parent: 'missing', grants: ['c'] },
  ];
  eq('role chain', roleChain(roles, 'trainee'), ['staff', 'seller', 'trainee']);
  eq('role chain cycle-safe', roleChain(roles, 'loop1'), ['loop2', 'loop1']);
  eq('role chain missing parent', roleChain(roles, 'orphan'), ['orphan']);
  eq('role grants inherit', sets(roleGrants(roles, 'seller')), { catalog: ['edit', 'view'], tasks: ['create', 'view'], pos: ['*'] });
  eq('role grants revoke', sets(roleGrants(roles, 'trainee')), { catalog: ['view'], tasks: ['create', 'view'] });
  eq('can', [can(roleGrants(roles, 'seller'), 'pos', 'refund'), can(roleGrants(roles, 'trainee'), 'pos'), can(roleGrants(roles, 'staff'), 'tasks', 'delete')], [true, false, false]);
  eq('explain', explainGrant(roles, 'trainee', 'catalog', 'edit'), { allowed: false, trail: [{ role: 'seller', change: 'grant' }, { role: 'trainee', change: 'revoke' }] });
  eq('explain granted', explainGrant(roles, 'trainee', 'catalog', 'view'), { allowed: true, trail: [{ role: 'staff', change: 'grant' }] });
  const mx = grantMatrix(roles.slice(0, 3), ['catalog', 'pos'], ['view', 'edit']);
  eq('matrix', [mx.trainee.catalog.edit, mx.seller.pos.edit, mx.staff.pos.view], [{ allowed: false, from: null, revokedAt: 'trainee' }, { allowed: true, from: 'seller', revokedAt: null }, { allowed: false, from: null, revokedAt: null }]);
  const now = Date.UTC(2026, 9, 24);
  const day = 86400000;
  eq('is live', [isLive(null, now), isLive(now + 1, now), isLive(now, now), isLive('2026-10-25', now), isLive('garbage', now)], [true, true, false, true, false]);
  const g1 = memberGrant({ roleId: 'seller', objects: ['shop1'] }, { roles, extra: [{ grants: { docs: ['view'] }, objects: ['shop2'], expiresAt: now + day }, { grants: ['admin'], expiresAt: now - day }], now });
  eq('member grant', [sets(g1.grants), g1.objects, g1.roleId, g1.lapsed], [{ catalog: ['edit', 'view'], tasks: ['create', 'view'], pos: ['*'], docs: ['view'] }, ['shop1', 'shop2'], 'seller', ['grant']]);
  eq('expired role gives nothing', sets(memberGrant({ roleId: 'seller', roleExpiresAt: now - 1 }, { roles, now }).grants), {});
  eq('expired objects give none', memberGrant({ roleId: 'staff', objects: null, objectsExpiresAt: now - 1 }, { roles, now }).objects, []);
  eq('expired membership = no access', memberGrant({ roleId: 'staff', expiresAt: now - 1 }, { roles, now }), null);
  eq('null objects = all', memberGrant({ roleId: 'staff' }, { roles, extra: [{ grants: ['x'], objects: ['a'] }], now }).objects, null);
  eq('within', [grantsWithin({ catalog: ['view'] }, roleGrants(roles, 'seller')), grantsWithin({ pos: ['refund'] }, { pos: '*' }), grantsWithin({ pos: '*' }, { pos: ['refund'] }), grantsWithin({ docs: ['view'] }, { pos: '*' })], [true, true, false, false]);
  const admin = { grants: { admin: '*', catalog: ['view', 'edit'], pos: '*' }, objects: ['s1', 's2'] };
  eq('view as', [
    canViewAs({ isOwner: true }, { grants: { x: '*' } }),
    canViewAs(admin, { grants: { catalog: ['view'] }, objects: ['s1'] }),
    canViewAs(admin, { grants: { docs: ['view'] }, objects: ['s1'] }),
    canViewAs(admin, { grants: { catalog: ['view'] }, objects: null }),
    canViewAs({ grants: { catalog: '*' }, objects: null }, { grants: { catalog: ['view'] } }),
  ], [true, true, false, false, false]);
  eq('object allowed', [objectAllowed({ objects: null }, 'x'), objectAllowed({ objects: ['a'] }, 'x'), objectAllowed({ objects: ['a'] }, 'a')], [true, false, true]);
  eq('modules of', modulesOf({ pos: '*', inventory: ['view'], cash: ['view'] }, { pos: ['pos', 'inventory'], cash: ['cash', 'pos'], wms: ['wms', 'inventory'] }), ['pos', 'cash']);

  // --- policy -------------------------------------------------------------------------------------------------------
  const model = definePolicy({
    entities: { receipts: { own: ['created_by', 'responsible'] }, sales: { own: ['created_by', 'seller'] } },
    permissions: { 'sidebar.edit': { open: 'allow', medium: 'allow', closed: 'deny' } },
  });
  eq('policy actions', model.actions, ['receipts.view', 'receipts.edit', 'sales.view', 'sales.edit']);
  eq('override values', [model.overrideValues('sidebar.edit'), model.overrideValues('sales.edit'), model.overrideValues('nope')], [['allow', 'deny'], ['all', 'own'], null]);
  const def = resolvePolicy(model, []);
  eq('default medium', [def.mode, def.modeFrom, def.rules['receipts.view'].value, def.rules['receipts.edit'].value, def.rules['sidebar.edit'].value], ['medium', 'default', 'all', 'own', 'allow']);
  const org = { scope: 'org', id: null, label: 'org', mode: 'open', overrides: { 'sales.edit': 'own' } };
  const role = { scope: 'role', id: 'r1', mode: null, overrides: { 'receipts.edit': 'own', 'bogus.key': 'all', 'sales.view': 'maybe' } };
  const member = { scope: 'member', id: 'u1', mode: null, overrides: { 'sidebar.edit': 'deny' } };
  const p1 = resolvePolicy(model, [org, role, member]);
  eq('cascade', [p1.mode, p1.rules['receipts.view'].value, p1.rules['receipts.edit'].value, p1.rules['sales.edit'].value, p1.rules['sidebar.edit'].value, p1.rules['sales.view'].from], ['open', 'all', 'own', 'own', 'deny', 'mode']);
  eq('decided by', [p1.rules['receipts.edit'].from.id, p1.rules['sales.edit'].from.label, p1.modeFrom.label], ['r1', 'org', 'org']);
  const p2 = resolvePolicy(model, [org, { ...role, mode: 'closed' }, member]);
  eq('a lower mode resets the overrides above it', [p2.mode, p2.rules['sales.edit'].value, p2.rules['sales.view'].value, p2.rules['receipts.edit'].from.id], ['closed', 'own', 'own', 'r1']);
  const tr = explainRule(p2, 'sales.edit');
  eq('trace', tr.map((x) => [x.level, x.mode, x.override, !!x.ignored, x.decided]), [['default', null, null, false, false], ['org', 'open', 'own', true, false], ['role:r1', 'closed', null, false, true], ['member:u1', null, null, false, false]]);
  const acc = policyAccess(model, p2, { ref: 'u1' });
  const mine = { created_by: 'u1' }, theirs = { created_by: 'u2', seller: 'u3' };
  eq('closed: own only', [canView(acc, 'sales', mine), canView(acc, 'sales', theirs), canEdit(acc, 'sales', mine), canEdit(acc, 'sales', theirs)], [true, false, true, false]);
  const accMed = policyAccess(model, def, { ref: 'u2' });
  eq('medium: sees all, edits own', [canView(accMed, 'receipts', mine), canEdit(accMed, 'receipts', mine), canEdit(accMed, 'receipts', { responsible: 'u2' })], [true, false, true]);
  eq('exempt', [canEdit(policyAccess(model, p2, { exempt: true }), 'sales', theirs), allowed(policyAccess(model, p2, { exempt: true }), 'sidebar.edit')], [true, true]);
  eq('allowed', [allowed(acc, 'sidebar.edit'), allowed(accMed, 'sidebar.edit')], [false, true]);
  eq('own needs a ref', isOwn(policyAccess(model, def), 'sales', { created_by: null }), false);
  eq('filter visible', filterVisible(acc, 'sales', [mine, theirs, { seller: 'u1' }]).length, 2);

  // --- session scope ------------------------------------------------------------------------------------------------
  const sm = createScopeModel({
    rights: ['developer', 'editor', 'chief', 'can_publish_site', 'can_impersonate', 'outsource'],
    groups: ['dash', 'market', 'users', 'content', 'refs', 'dev', 'account'], always: 'account',
    readonlyAllow: ['/api/signout', '/api/session/scope'],
    idlePaths: ['/api/session', '/api/status'],
    idlePolls: [{ path: '/api/notifications', param: 'limit', value: '1' }, { path: /^\/api\/chat\/threads\/[^/]+\/messages$/, param: 'after' }],
  });
  const s = normalizeScope({ panel: ['content', 'nope'], drop: ['developer', 'root', 'developer'], readonly: 1 }, sm);
  eq('junk dropped silently', s, { panel: ['account', 'content'], drop: ['developer'], readonly: true });
  eq('always group added', [normalizeScope({ panel: [] }, sm).panel, normalizeScope({}, sm).panel], [['account'], null]);
  const all = normalizeScope({ panel: ['dash', 'market', 'users', 'content', 'refs', 'dev'] }, sm);
  eq('everything = no restriction', [all.panel, isFullScope(all)], [null, true]);
  eq('stored empty = full', [parseScope('', sm), parseScope(null, sm), parseScope('{broken', sm)], [FULL_SCOPE, FULL_SCOPE, FULL_SCOPE]);
  eq('full scope stored as empty', [scopeText(FULL_SCOPE), scopeText(s) !== ''], ['', true]);
  eq('round trip', parseScope(scopeText(s), sm), s);
  const narrow = normalizeScope({ panel: ['content'], drop: ['developer'], readonly: true }, sm);
  eq('within self', scopeWithin(narrow, narrow), true);
  eq('narrow further on each axis', [
    scopeWithin(normalizeScope({ panel: [], drop: ['developer'], readonly: true }, sm), narrow),
    scopeWithin(normalizeScope({ panel: ['content'], drop: ['developer', 'editor'], readonly: true }, sm), narrow),
    scopeWithin(narrow, normalizeScope({ panel: ['content', 'refs'] }, sm)),
  ], [true, true, true]);
  eq('never widen', [
    scopeWithin(normalizeScope({ panel: ['content', 'dev'], drop: ['developer'], readonly: true }, sm), narrow),
    scopeWithin(normalizeScope({ drop: ['developer'], readonly: true }, sm), narrow),
    scopeWithin(normalizeScope({ panel: ['content'], readonly: true }, sm), narrow),
    scopeWithin(normalizeScope({ panel: ['content'], drop: ['developer'] }, sm), narrow),
    scopeWithin(FULL_SCOPE, narrow),
  ], [false, false, false, false, false]);
  eq('from full anywhere', [scopeWithin(narrow, FULL_SCOPE), scopeWithin(FULL_SCOPE, FULL_SCOPE)], [true, true]);
  const mineS = normalizeScope({ panel: ['content', 'refs'], drop: ['developer'] }, sm);
  const ticket = scopeIntersect(mineS, normalizeScope({ panel: ['content', 'dev'], drop: [] }, sm), sm);
  eq('ticket never wider', [scopeWithin(ticket, mineS), ticket.panel, ticket.drop], [true, ['account', 'content'], ['developer']]);
  eq('readonly sticky', [scopeIntersect(normalizeScope({ readonly: true }, sm), FULL_SCOPE, sm).readonly, scopeIntersect(FULL_SCOPE, normalizeScope({ readonly: true }, sm), sm).readonly], [true, true]);
  eq('full does not narrow', scopeIntersect(FULL_SCOPE, s, sm), s);
  eq('groups', [scopeAllowsGroup(s, 'content', sm), scopeAllowsGroup(s, 'dev', sm), scopeAllowsGroup(FULL_SCOPE, 'dev', sm), scopeAllowsGroup(normalizeScope({ panel: [] }, sm), 'account', sm), scopeAllowsGroup(s, 'grp-content', sm)], [true, false, true, true, true]);
  eq('drops', [scopeDrops(s, 'developer'), scopeDrops(s, 'editor')], [true, false]);
  eq('readonly writes', [scopeAllowsWrite(s, 'GET', '/api/x', sm), scopeAllowsWrite(s, 'POST', '/api/x', sm), scopeAllowsWrite(s, 'post', '/api/signout', sm), scopeAllowsWrite(s, 'PUT', '/api/session/scope/x', sm), scopeAllowsWrite(s, 'POST', '/api/signout-all', sm), scopeAllowsWrite(FULL_SCOPE, 'DELETE', '/api/x', sm)], [true, false, true, true, false, true]);
  const rights = { developer: true, editor: true, chief: false };
  eq('effective = rights ∩ scope', [applyScope(rights, s), effectiveRights(rights, s), applyScope(rights, FULL_SCOPE) === rights], [{ developer: false, editor: true, chief: false }, ['editor'], true]);
  eq('scope never adds', effectiveRights({ editor: false }, normalizeScope({ drop: [] }, sm)), []);
  eq('ttl', [cleanTtlDays('8h', 30), cleanTtlDays('90', 30), cleanTtlDays('junk', 7), cleanTtlDays(5, 0)], [8 / 24, 30, 7, 5]);
  eq('idle', [cleanIdleSec('15m'), cleanIdleSec(-5), cleanIdleSec('x'), cleanIdleSec(1e9)], [900, 0, 0, 30 * 86400]);
  const t0 = Date.parse('2026-10-24T12:00:00Z');
  eq('alive', [
    sessionAlive(t0, '2026-10-25T00:00:00Z', 0, ''), sessionAlive(t0, '2026-10-24T11:00:00Z', 0, ''),
    sessionAlive(t0, '2026-10-25T00:00:00Z', 900, '2026-10-24T11:50:00Z'), sessionAlive(t0, '2026-10-25T00:00:00Z', 900, '2026-10-24T11:40:00Z'),
    sessionAlive(t0, '2026-10-25T00:00:00Z', 900, '', '2026-10-24T11:59:00Z'), sessionAlive(t0, 'junk', 0, ''),
  ], [true, false, true, false, true, false]);
  eq('touch seen', [shouldTouchSeen(t0, '', 0), shouldTouchSeen(t0, '2026-10-24T11:59:30Z', 0), shouldTouchSeen(t0, '2026-10-24T11:58:00Z', 0), shouldTouchSeen(t0, '2026-10-24T11:59:00Z', 300)], [true, false, true, true]);
  eq('idle silent', [
    isIdleSilent('/api/session', '', sm), isIdleSilent('/api/status/x', '', sm), isIdleSilent('/api/sessions', '', sm),
    isIdleSilent('/api/notifications', '?limit=1', sm), isIdleSilent('/api/notifications', '?limit=30', sm),
    isIdleSilent('/api/chat/threads/ab12/messages', 'after=5', sm), isIdleSilent('/api/chat/threads/ab12/messages', 'limit=5', sm),
  ], [true, true, false, true, false, true, false]);

  // --- need tokens --------------------------------------------------------------------------------------------------
  const VOC = ['guest', 'user', 'staff', 'author', 'lot:new.fields', 'lot:edit.sold', 'lot:delete', 'booking', 'see'];
  const set = tokenSet(['see', 'user', 'lot:edit.sold', 'bogus', 'user'], VOC);
  eq('token set sorted, unknown removed, frozen', [set, Object.isFrozen(set)], [['user', 'lot:edit.sold', 'see'], true]);
  eq('has token', [hasToken(set, 'lot:*'), hasToken(set, 'team:*'), hasToken(set, 'see'), hasToken(null, 'see')], [true, false, true, false]);
  eq('parse need', [parseNeed('booking, lot:*  BOOKING;see'), parseNeed(['a', 'a', ' b ']), parseNeed(Array.from({ length: 30 }, (_, i) => 'x' + i)).length], [['booking', 'lot:*', 'see'], ['a', 'b'], 16]);
  eq('need met', [needMet([], set), needMet(['booking', 'see'], set), needMet(['bookng'], set), needMet(['bookng'], null)], [true, true, false, true]);
  eq('need all', [needAllMet([['lot:*'], ['see', 'x']], set), needAllMet([['lot:*'], ['booking']], set), needAllMet(null, set)], [true, false, false]);
  eq('filter by need', filterByNeed([{ id: 1 }, { id: 2, need: 'booking' }, { id: 3, need: 'see lot:delete' }, { id: 4, need: 'typo' }], set).map((x) => x.id), [1, 3]);
  eq('filter by need with door need', filterByNeed([{ id: 1, door: ['lot:delete'] }, { id: 2, door: ['see'] }], set, (x) => x.need, (x) => x.door).map((x) => x.id), [2]);
  eq('filter preview', filterByNeed([{ need: 'x' }], null).length, 1);

  // --- modules ------------------------------------------------------------------------------------------------------
  const CAT = {
    iams: { sections: ['equipment'], deps: [], views: ['standalone', 'hidden'], default: 'standalone', embeds: [] },
    bi: { sections: ['analytics'], deps: [], views: ['standalone', 'hidden'], default: 'standalone' },
    pos: { sections: ['pos'], deps: [], views: ['standalone', 'hidden'], default: 'standalone' },
    plan: { sections: ['plan'], deps: ['iams'], carriers: ['iams', 'bi'], views: VIEWS, default: 'embedded', embeds: ['object.plan'] },
    loyalty: { sections: ['loyalty'], deps: ['pos'], carriers: ['pos'], views: VIEWS, default: 'standalone', embeds: ['pos.customer'] },
    cash: { sections: ['cash'], deps: ['pos'], carriers: ['pos'], views: VIEWS, default: 'embedded', embeds: ['pos.cash'] },
    promo: { sections: ['promo'], deps: ['loyalty'], views: VIEWS, default: 'standalone' },
  };
  eq('catalog ok', checkCatalog(CAT), []);
  eq('catalog problems', checkCatalog({ a: { deps: ['b', 'zz'], carriers: ['yy'], default: 'odd', views: VIEWS }, b: { deps: ['a'] } }).map((p) => p.problem + ':' + p.ref), ['dep:zz', 'carrier:yy', 'default:odd', 'cycle:a -> b -> a']);
  eq('with deps (transitive, catalog order)', withDeps(['promo', 'plan', 'nope'], CAT), ['iams', 'pos', 'plan', 'loyalty', 'promo']);
  eq('dependents', [dependents('pos', CAT), dependents('pos', CAT, { transitive: false })], [['loyalty', 'cash', 'promo'], ['loyalty', 'cash']]);
  eq('enable', enableModule(['bi'], 'promo', CAT), { enabled: ['bi', 'pos', 'loyalty', 'promo'], added: ['pos', 'loyalty', 'promo'] });
  eq('disable cascades', disableModule(['iams', 'pos', 'plan', 'loyalty', 'cash', 'promo'], 'pos', CAT), { enabled: ['iams', 'plan'], removed: ['pos', 'loyalty', 'cash', 'promo'] });
  const levels = [
    { scope: 'org', views: { plan: 'standalone', iams: 'weird', bi: 'hidden' } },
    { scope: 'role', id: 'cashier', views: { iams: 'hidden', cash: 'standalone', pos: 'embedded' } },
    { scope: 'member', id: 'u1', views: { plan: 'embedded', promo: 'hidden' } },
  ];
  const v = viewsFor(CAT, ['iams', 'bi', 'pos', 'plan', 'cash'], levels);
  eq('views cascade', v.views, { iams: 'hidden', bi: 'hidden', pos: 'standalone', plan: 'embedded', loyalty: 'off', cash: 'standalone', promo: 'off' });
  eq('views from', [v.from.iams, v.from.plan, v.from.pos, v.from.loyalty], ['role:cashier', 'member:u1', 'default', 'off']);
  eq('stranded embed', v.stranded, ['plan']);
  eq('preview overrides', viewsFor(CAT, ['iams', 'plan'], levels, { iams: 'standalone' }).stranded, []);
  eq('sections without hidden / off modules', [...applyModules(['equipment', 'pos', 'plan', 'cash', 'core', 'analytics'], v.views, CAT)], ['pos', 'plan', 'cash', 'core']);
  eq('visible', [moduleVisible(v.views, 'plan'), moduleVisible(v.views, 'iams'), moduleVisible(v.views, 'loyalty')], [true, false, false]);
  eq('embed points', embedPoints(v.views, CAT), { 'object.plan': ['plan'] });

  // --- layered configuration ----------------------------------------------------------------------------------------
  const schema = defineConfig({ site_title: 'string', default_lang: 'lang', locales: 'locales', canonical_url: 'string', modules: 'flags', accent_city: 'uint', seo: 'object', sync: (x) => (x && typeof x === 'object' ? { enabled: !!x.enabled, sourceUrl: String(x.sourceUrl ?? '').trim(), intervalSec: Math.max(60, Math.min(86400, Math.round(Number(x.intervalSec) || 3600))) } : undefined) });
  throws('secret keys refused in the schema', () => defineConfig({ sync_token: 'string' }), /secret/);
  throws('unknown cleaner', () => defineConfig({ a: 'nope' }), /unknown cleaner/);
  eq('secretish', ['sync_token', 'password_hash', 'apiKey', 'smtp_host', 'site_title', 'locales'].map((k) => SECRETISH.test(k)), [true, true, true, true, false, false]);
  eq('unknown keys dropped', Object.keys(normalizeLayer({ site_title: 'X', bogus: 1, sync_token: 's' }, schema)), ['site_title']);
  eq('missing keys never added', normalizeLayer({}, schema), {});
  eq('empty override survives', normalizeLayer({ site_title: '', modules: {} }, schema), { site_title: '', modules: {} });
  eq('undefined means untouched', Object.keys(normalizeLayer({ site_title: undefined }, schema)), []);
  eq('locales', [normalizeLayer({ locales: ['RU', 'en', 'ru', 'ka', 'xxx', 5] }, schema).locales, cleanLocales('ru, ka')], [['ru', 'en', 'ka'], ['ru', 'ka']]);
  const lay = normalizeLayer({ sync: { enabled: 1, sourceUrl: ' https://d.example ', intervalSec: 5, token: 'secret' }, seo: { robots: 'noindex', apiKey: 'k', nested: [{ password: 'p', ok: 1 }] } }, schema);
  eq('cleaned and stripped', lay, { sync: { enabled: true, sourceUrl: 'https://d.example', intervalSec: 60 }, seo: { robots: 'noindex', nested: [{ ok: 1 }] } });
  eq('strip secrets deep', stripSecrets({ a: { secret: 1, b: [{ token: 2, c: 3 }] } }), { a: { b: [{ c: 3 }] } });
  const defaults = { site_title: 'Portal', default_lang: 'en', locales: ['en'], modules: { market: true, events: true }, accent_city: 0 };
  const site = { site_title: 'Batumi', locales: ['ka', 'ru', 'en'], modules: { market: true, events: false } };
  const host = normalizeLayer({ site_title: '', modules: { market: false }, default_lang: 'ka' }, schema);
  const eff = mergeLayers([defaults, site, host], schema);
  eq('merge per key, no deep merge', [eff.site_title, eff.modules, eff.locales, eff.default_lang, eff.accent_city], ['', { market: false }, ['ka', 'ru', 'en'], 'ka', 0]);
  const snap = snapshotConfig([{ name: 'default', values: defaults }, { name: 'site', values: site }, { name: 'host', values: host }], schema);
  eq('snapshot sources', [snap.site_title, snap.locales.source, snap.accent_city.source, snap.canonical_url], [{ value: '', source: 'host', shadowed: ['default', 'site'] }, 'site', 'default', { value: undefined, source: null, shadowed: [] }]);
  const checks = [langInLocales(), httpUrl('canonical_url'), httpUrl('sync', (x) => x.sourceUrl)];
  eq('valid', validateConfig(eff, checks), []);
  eq('lang outside locales and bad urls', validateConfig({ default_lang: 'de', locales: ['ka', 'ru'], canonical_url: 'batumi.su', sync: { sourceUrl: 'ftp://x' } }, checks), [{ key: 'default_lang', error: 'not_in_locales' }, { key: 'canonical_url', error: 'not_http_url' }, { key: 'sync', error: 'not_http_url' }]);
  eq('normalize host', ['BatuMi.SU', 'batumi.su:3000', 'batumi.su.', ' batumi.su:443 ', null, '[::1]:3000', '[2001:db8::1]', 'www.batumi.su'].map(normalizeHost), ['batumi.su', 'batumi.su', 'batumi.su', 'batumi.su', '', '[::1]', '[2001:db8::1]', 'www.batumi.su']);
  const rows = [
    { host: 'batume.li', enabled: true, isPrimary: true, aliases: [] },
    { host: 'batumi.su', enabled: true, isPrimary: false, aliases: ['batumi.example'] },
    { host: 'off.example', enabled: false, isPrimary: false, aliases: [] },
  ];
  eq('resolve host', [resolveHost('batumi.su', rows).row.host, resolveHost('batumi.su', rows).matched, resolveHost('BATUMI.EXAMPLE:8080', rows).row.host, resolveHost('www.batumi.su', rows).row.host], ['batumi.su', true, 'batumi.su', 'batumi.su']);
  eq('explicit www row wins', resolveHost('www.batumi.su', [...rows, { host: 'www.batumi.su', enabled: true }]).row.host, 'www.batumi.su');
  const unknown = resolveHost('evil.invalid', rows);
  eq('unknown host -> primary, not matched', [unknown.row.host, unknown.matched, resolveHost('', rows).matched], ['batume.li', false, false]);
  eq('disabled host does not answer', [resolveHost('off.example', rows).matched, resolveHost('off.example', rows).row.host], [false, 'batume.li']);
  eq('no rows', resolveHost('a.b', []), { row: null, matched: false, host: 'a.b' });

  console.log(`access: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
