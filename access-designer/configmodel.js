// access-designer/configmodel.js - the layered configuration of the project: the key list comes from the project
// (`config.schema`: key, type, secret flag), each type has a cleaner; secret keys (flagged, or named like a secret)
// never enter the layer schema, so normalizeLayer drops them from every layer; the layers are code defaults -> site ->
// the host row a request Host resolves to; the snapshot gives the source of every value; layerLosses lists what a
// layer loses on the way (unknown keys, secret keys at any depth) for the stripping preview.
import { CLEANERS, SECRETISH, defineConfig, mergeLayers, normalizeLayer, resolveHost, snapshotConfig } from '../access/config.js';
import { P } from './common.js';

// Type cleaners: values typed in the UI arrive as strings; number accepts a decimal comma, list accepts a comma
// separated string. A cleaner returning undefined means "invalid, drop the key" in normalizeLayer.
const CLEAN = {
  string: CLEANERS.string,
  number: (v) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : undefined; },
  bool: CLEANERS.bool,
  list: (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x ?? '').trim()).filter(Boolean),
  object: CLEANERS.object,
};

/** A key is secret when flagged or when its name looks like a secret (the library refuses such keys in a schema). */
// Secrets never belong in layered config (it is shown, exported and diffed): flagged keys and names matching the
// library's SECRETISH pattern (password, token, key, secret...) are excluded from the schema entirely.
export const isSecretKey = (k) => !!k.secret || SECRETISH.test(k.key);
// Keys are identifier-like paths (dots allowed for namespacing): safe as JSON keys and environment-style names.
export const validKey = (key) => /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key);

export function schemaOf() {
  const spec = {};
  for (const k of P.config.schema) if (validKey(k.key) && !isSecretKey(k)) spec[k.key] = CLEAN[k.type] || CLEAN.string;
  return defineConfig(spec);
}

/** Keys a raw layer loses: [{ path, why: 'unknown' | 'secret' }] (secrets found at any depth). */
// Preview of what normalisation will strip, so the user sees why a value "disappears": unknown keys at top level,
// secret-looking names at any depth (walks arrays and objects).
export function layerLosses(raw) {
  const out = [];
  if (!raw || typeof raw !== 'object') return out;
  const schema = schemaOf();
  const secret = new Set(P.config.schema.filter(isSecretKey).map((k) => k.key));
  const walk = (v, path) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (SECRETISH.test(k)) out.push({ path: `${path}.${k}`, why: 'secret' });
      else walk(x, `${path}.${k}`);
    }
  };
  for (const [k, v] of Object.entries(raw)) {
    if (secret.has(k) || SECRETISH.test(k)) out.push({ path: k, why: 'secret' });
    else if (!Object.prototype.hasOwnProperty.call(schema, k)) out.push({ path: k, why: 'unknown' });
    else walk(v, k);
  }
  return out;
}

// Effective configuration for a probe Host: defaults -> site -> matching host row (exact host or alias, via
// resolveHost). The snapshot records which layer supplied each value.
export function configSnapshot(probe = P.config.probe) {
  const c = P.config;
  const schema = schemaOf();
  const host = resolveHost(probe, c.hosts);
  const layers = [
    { name: 'default', values: normalizeLayer(c.defaults, schema) },
    { name: 'site', values: normalizeLayer(c.site, schema) },
  ];
  if (host.row) layers.push({ name: 'host:' + host.row.host, values: normalizeLayer(host.row.values, schema) });
  const snapshot = snapshotConfig(layers, schema);
  const effective = mergeLayers(layers.map((l) => l.values), schema);
  return { host, layers, snapshot, effective, problems: [] };
}
