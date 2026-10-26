// crypto-tool/hash.js - the hash registry: Hash (static primitives), DiscoverableHash (self-registering declarative
// algorithms), getHashes / getHash / createHash.
// 
// Registry pattern shared by cipher.js, hash.js and encode.js: an algorithm is declared as data — lists of small
// step functions per phase — instead of a subclass with overridden methods. Steps carry metadata (Object.assign on the
// function), and the registry reads capabilities back from the steps (key sizes, AEAD, keyed, options), so the UI is
// generated from the same declaration that runs the algorithm and cannot drift from it. Adding an algorithm = one
// declaration; nothing else in the app changes.
// Phases: initialize (engine, optional HMAC / keyed mode), update (absorb or collect bytes), finalize (squeeze a digest
// or derive a key). Key derivation steps return promises; Hash.run switches to async from that step on, so plain hashes
// stay synchronous (fast path for text hashing on every keystroke).
/* PoC / demo code from https://codeberg.org/slnknrr/in-html/src/branch/all-in-one/
 *
 * The goal is a self-contained HTML artifact and serverless crypto-app example,
 * not production use or serious security-sensitive deployment.
*/
import { concatBytes, toBytes } from '../crypto/encoding.js';
import { hmac } from '../crypto/hmac.js';

// A step is a function (context, value) -> value; a phase is a list of steps run as a pipeline. Steps may return
// promises (key derivation); the rest of the phase then continues asynchronously.
class Hash {
  // Runs a phase: each step receives the previous step's result.
  // Sync until a step returns a thenable, then the remaining steps chain on it: one runner serves sync hashes and async KDFs.
  static run(steps, ctx, value) {
    for (let i = 0; i < steps.length; i++) {
      value = steps[i](ctx, value);
      if (value && typeof value.then === 'function') {
        const rest = steps.slice(i + 1);
        return value.then((v) => Hash.run(rest, ctx, v));
      }
    }
    return value;
  }

  // Marks a step with metadata the registry reads back (keyed, kdf, ...).
  static tag(step, meta) { return Object.assign(step, meta); }

  // initialize: the running engine of a library hash function (params: fixed options such as { dkLen }).
  // XOFs (SHAKE) take their output length from options.dkLen; fixed-length hashes ignore it.
  static engine(fn, params = {}) {
    return Hash.tag((ctx) => {
      ctx.engine = fn.create({ ...params, ...(fn.xof && ctx.options.dkLen ? { dkLen: ctx.options.dkLen } : {}) });
      ctx.fn = fn;
    }, { outputLen: params.dkLen || fn.outputLen, blockLen: fn.blockLen, xof: !!fn.xof });
  }

  // initialize: replaces the engine with HMAC over `fn` when the options carry a key.
  // HMAC replaces the plain engine only when a non-empty key is given: the same declaration is the plain hash and its HMAC.
  static hmac(fn) {
    return Hash.tag((ctx) => {
      if (ctx.options.key != null && toBytes(ctx.options.key).length) { ctx.engine = hmac.create(fn, ctx.options.key); ctx.keyed = true; }
    }, { keyed: true });
  }

  // initialize: native keyed mode (BLAKE2): the key goes into the engine parameters.
  // BLAKE2 native keyed mode (key in the parameter block, one pass) instead of HMAC; keys longer than the maximum are truncated.
  static keyedEngine(fn, params = {}) {
    return Hash.tag((ctx) => {
      const key = ctx.options.key != null ? toBytes(ctx.options.key) : null;
      ctx.engine = fn.create({ ...params, ...(key && key.length ? { key: key.subarray(0, params.maxKey || 64) } : {}) });
      ctx.keyed = !!(key && key.length);
    }, { keyed: true, outputLen: params.dkLen || fn.outputLen });
  }

  // initialize: a MAC that needs its key (Poly1305).
  // Poly1305 is unusable without its one-time 32-byte key: keyed 'required' hides it from plain digest lists.
  static mac(make, keyLen) {
    return Hash.tag((ctx) => {
      const key = toBytes(ctx.options.key || new Uint8Array(0));
      if (key.length !== keyLen) throw new Error(`key must be ${keyLen} bytes`);
      ctx.engine = make(key);
      ctx.keyed = true;
    }, { keyed: 'required', keyLen });
  }

  // update: any input (string, ArrayBuffer, typed array) as bytes.
  static bytes(ctx, value) { return toBytes(value); }

  // update: feeds the engine and counts bytes.
  static absorb(ctx, value) {
    ctx.engine.update(value);
    ctx.length += value.length;
    return value;
  }

  // update: keeps the input (key derivation needs all of it at once).
  // KDFs need the whole password at once; slice() copies because callers may reuse their buffer.
  static collect(ctx, value) {
    ctx.parts.push(value.slice());
    ctx.length += value.length;
    return value;
  }

  // finalize: the digest of the engine.
  static squeeze(ctx) { return ctx.engine.digest(); }

  // finalize: key derivation over the collected input: derive(input, options) -> Promise<Uint8Array> | Uint8Array.
  // Options spread over defaults. Caveat: an option passed as undefined overrides its default with undefined (spread
  // copies own undefined properties), so callers must omit unset options rather than pass undefined.
  static derive(derive, defaults = {}) {
    return Hash.tag((ctx) => {
      const input = concatBytes(...ctx.parts);
      ctx.parts.length = 0;
      return derive(input, { ...defaults, ...ctx.options });
    }, { kdf: true, defaults });
  }
}

// The running state of one computation, created by createHash.
// One computation. update() returns this for chaining; digest() is a Uint8Array, or a Promise of one for KDFs.
class HashContext {
  constructor(def, options) {
    this.def = def;
    this.options = options || {};
    this.engine = null;
    this.keyed = false;
    this.length = 0;
    this.parts = [];
    Hash.run(def.initialize, this, this.options);
  }

  update(data) { Hash.run(this.def.update, this, data); return this; }

  // Uint8Array, or a Promise of it for key derivation functions.
  digest() { return Hash.run(this.def.finalize, this, undefined); }
}

class DiscoverableHash extends Hash {
  static registry = new Map();

  // spec: { initialize: [...steps], update: [...steps], finalize: [...steps], label?, group?, note? }
  constructor(id, spec) {
    super();
    const all = [...spec.initialize, ...spec.update, ...spec.finalize];
    const find = (k) => all.find((s) => s[k] != null);
    this.id = id;
    this.label = spec.label || id;
    this.group = spec.group || 'other';
    this.note = spec.note || '';
    this.initialize = spec.initialize;
    this.update = spec.update;
    this.finalize = spec.finalize;
    // Capabilities read back from the steps the algorithm is built of.
    this.keyed = find('keyed') ? find('keyed').keyed : false;
    this.keyLen = find('keyLen') ? find('keyLen').keyLen : 0;
    this.kdf = !!find('kdf');
    this.defaults = this.kdf ? find('kdf').defaults : {};
    this.outputLen = find('outputLen') ? find('outputLen').outputLen : this.defaults.dkLen || 32;
    this.xof = !!(find('xof') && find('xof').xof);
    DiscoverableHash.registry.set(id, this);
  }

  create(options) { return new HashContext(this, options); }
}

function getHashes() {
  return [...DiscoverableHash.registry.keys()];
}

function getHash(id) {
  return DiscoverableHash.registry.get(id) || null;
}

function createHash(id, ...args) {
  const hash = DiscoverableHash.registry.get(id);
  if (!hash)
    throw new Error(`unknown hash: ${id}`);
  return hash.create(...args);
}

export {
  Hash, HashContext,
  DiscoverableHash, getHashes, getHash, createHash
};
