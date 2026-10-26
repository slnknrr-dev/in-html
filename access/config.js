// access/config.js - layered configuration: code defaults -> site (the whole instance) -> host (one domain), where a
// layer stores only what it overrides. A key absent from a layer inherits; a key present with '' / false / [] is
// overridden with an empty value - the difference that lets a domain switch off what the site switches on. Keys are a
// closed list with a cleaner each; unknown keys are dropped silently; nested values are merged whole (no deep merge).
// A snapshot tells where every effective value came from. Secrets never live in an override layer: keys that look
// like secrets (token, password, hash, api key, smtp, credential) are stripped at any depth. Host names are
// normalised (case, port, trailing dot, IPv6 brackets) and an unknown host falls back to the primary row, marked as
// not matched so nothing is written on its behalf.
//
//   SECRETISH  stripSecrets(value)   CLEANERS   defineConfig({ key: cleaner name | fn })
//   normalizeLayer(raw, schema) -> sparse layer      mergeLayers(layers, schema) -> effective values
//   snapshotConfig([{ name, values }], schema) -> { key: { value, source, shadowed: [names] } }
//   validateConfig(effective, checks) -> [{ key, error }]     checks: langInLocales(), httpUrl(key)
//   normalizeHost(raw)   resolveHost(rawHost, rows: [{ host, enabled, isPrimary, aliases }]) -> { row, matched, host }

export const SECRETISH = /(token|password|passwd|secret|hash|api[_-]?key|smtp|credential|private[_-]?key)/i;

// Defence in depth: even if an admin form posts a secret-looking key, it never reaches an override layer (which may
// be exported, diffed or shown in a UI). Key-name matching is a heuristic and errs on the side of stripping.
export function stripSecrets(value) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) if (!SECRETISH.test(k)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  return walk(value);
}

const asStr = (v) => String(v ?? '').trim();
const lang2 = (v) => { const s = asStr(v).toLowerCase(); return /^[a-z]{2}$/.test(s) ? s : ''; };
export function cleanLocales(v) {
  const out = [];
  for (const x of Array.isArray(v) ? v : String(v ?? '').split(',')) { const s = lang2(x); if (s && !out.includes(s)) out.push(s); }
  return out;
}

export const CLEANERS = {
  string: asStr,
  bool: (v) => v === true || v === 'true' || v === 1 || v === '1',
  int: (v) => Math.round(Number(v) || 0),
  uint: (v) => Math.max(0, Math.round(Number(v) || 0)),
  lang: lang2,
  locales: cleanLocales,
  url: (v) => { const s = asStr(v); return s === '' || /^https?:\/\/[^\s/]+/i.test(s) ? s : ''; },
  flags: (v) => Object.fromEntries(Object.entries(v && typeof v === 'object' && !Array.isArray(v) ? v : {}).map(([k, x]) => [k, !!x])),
  object: (v) => (v && typeof v === 'object' ? v : undefined),
  any: (v) => v,
};

/** schema: { key: 'string' | 'bool' | … | (v) => cleaned (undefined = drop) } */
export function defineConfig(spec) {
  const schema = {};
  for (const [k, c] of Object.entries(spec)) {
    if (SECRETISH.test(k)) throw new Error(`config: "${k}" looks like a secret and cannot be an overridable key`);
    const fn = typeof c === 'function' ? c : CLEANERS[c];
    if (!fn) throw new Error(`config: unknown cleaner "${c}" for ${k}`);
    schema[k] = fn;
  }
  return schema;
}

/** A sparse layer: unknown keys dropped, undefined = "do not touch", missing keys are never filled in. */
export function normalizeLayer(raw, schema) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of Object.keys(src)) {
    if (!Object.prototype.hasOwnProperty.call(schema, k) || src[k] === undefined) continue;
    const v = schema[k](src[k]);
    if (v !== undefined) out[k] = v;
  }
  return stripSecrets(out);
}

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

// Shallow by design: a nested value set in a higher layer replaces the lower one whole. Deep merge would make it
// impossible for a domain to remove an entry the site added.
export function mergeLayers(layers, schema = null) {
  const out = {};
  const keys = schema ? Object.keys(schema) : [...new Set(layers.flatMap((l) => Object.keys(l || {})))];
  for (const l of layers) for (const k of keys) if (has(l, k)) out[k] = l[k];
  return out;
}

/** Where each value comes from: the last layer that has the key; `shadowed` lists lower layers it overrides. */
export function snapshotConfig(layers, schema = null) {
  const keys = schema ? Object.keys(schema) : [...new Set(layers.flatMap((l) => Object.keys(l.values || {})))];
  const out = {};
  for (const k of keys) {
    const with_ = layers.filter((l) => has(l.values, k));
    const top = with_[with_.length - 1];
    out[k] = top ? { value: top.values[k], source: top.name, shadowed: with_.slice(0, -1).map((l) => l.name) } : { value: undefined, source: null, shadowed: [] };
  }
  return out;
}

export function validateConfig(effective, checks = []) {
  const out = [];
  for (const c of checks) { const p = c(effective); if (p) out.push(...(Array.isArray(p) ? p : [p])); }
  return out;
}

/** The default language must be one of the locales of the effective (merged) config. */
export const langInLocales = (langKey = 'default_lang', localesKey = 'locales') => (e) => {
  const locales = cleanLocales(e[localesKey]), lang = lang2(e[langKey]);
  return lang && locales.length && !locales.includes(lang) ? { key: langKey, error: 'not_in_locales' } : null;
};
export const httpUrl = (key, pick = (v) => v) => (e) => {
  const v = e[key] == null ? '' : pick(e[key]);
  return v && !/^https?:\/\/[^\s/]+/i.test(String(v)) ? { key, error: 'not_http_url' } : null;
};

// --- hosts --------------------------------------------------------------------------------------------------------

/** Lower case, no port, no trailing dot; '[::1]:3000' -> '[::1]'; 'www.' is kept (it may be a host of its own). */
export function normalizeHost(raw) {
  let h = asStr(raw).toLowerCase();
  if (!h) return '';
  if (h.startsWith('[')) { const end = h.indexOf(']'); if (end > 0) h = h.slice(0, end + 1); }
  else { const colon = h.lastIndexOf(':'); if (colon > 0 && /^\d+$/.test(h.slice(colon + 1))) h = h.slice(0, colon); }
  while (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

/**
 * The Host header is chosen by the client: an unknown host gets the primary row and matched: false (never a new
 * row, never a 404); 'www.' is an alias by default, unless an explicit row exists. Disabled rows do not answer.
 */
// The Host header is attacker-controlled, so an unknown host never creates state: it maps to the primary row with
// matched = false, and callers must not write on its behalf (host-header injection into stored config).
export function resolveHost(rawHost, rows) {
  const host = normalizeHost(rawHost);
  const live = (rows || []).filter((r) => r.enabled !== false);
  const primary = live.find((r) => r.isPrimary) || live[0] || null;
  const byName = (h) => live.find((r) => normalizeHost(r.host) === h) || live.find((r) => (r.aliases || []).some((a) => normalizeHost(a) === h)) || null;
  if (host) {
    const exact = byName(host);
    if (exact) return { row: exact, matched: true, host };
    if (host.startsWith('www.')) { const bare = byName(host.slice(4)); if (bare) return { row: bare, matched: true, host }; }
  }
  return { row: primary, matched: false, host };
}
