// crypto-tool/cipher.js - the cipher registry: Cipher (static primitives), DiscoverableCipher (self-registering
// declarative algorithms), getCiphers / getCipher / createCipher.
// 
// Registry pattern shared by cipher.js, hash.js and encode.js: an algorithm is declared as data — lists of small
// step functions per phase — instead of a subclass with overridden methods. Steps carry metadata (Object.assign on the
// function), and the registry reads capabilities back from the steps (key sizes, AEAD, keyed, options), so the UI is
// generated from the same declaration that runs the algorithm and cannot drift from it. Adding an algorithm = one
// declaration; nothing else in the app changes.
// Phases: initialize (key, IV, engine), update (bytes in -> bytes out, streaming), finalize (padding, tag).
/* PoC / demo code from https://codeberg.org/slnknrr/in-html/src/branch/all-in-one/
 *
 * The goal is a self-contained HTML artifact and serverless crypto-app example,
 * not production use or serious security-sensitive deployment.
*/
import { concatBytes, toBytes } from '../crypto/encoding.js';

// A step is a function (context, value) -> value; phases are pipelines of steps. The context carries the options
// ({ key, iv, decrypt, aad, padding, tag }), the engine (a streaming cipher of the crypto library) and scratch state.
class Cipher {
  static run(steps, ctx, value) {
    for (const step of steps) value = step(ctx, value);
    return value;
  }

  static tag(step, meta) { return Object.assign(step, meta); }

  // initialize: the key, checked against the accepted lengths (bytes).
  // Key length is checked here, before any engine is built: a wrong-length key is a usage error, reported with the accepted sizes.
  static key(...sizes) {
    return Cipher.tag((ctx, o) => {
      const k = toBytes(o.key || new Uint8Array(0));
      if (!sizes.includes(k.length)) throw new Error(`key must be ${sizes.join(' / ')} bytes`);
      ctx.key = k;
      return o;
    }, { keySizes: sizes });
  }

  // initialize: the IV / nonce (sizes: accepted lengths; the first one is the recommended length).
  static iv(...sizes) {
    return Cipher.tag((ctx, o) => {
      const v = toBytes(o.iv || new Uint8Array(0));
      if (!sizes.includes(v.length)) throw new Error(`IV / nonce must be ${sizes.join(' / ')} bytes`);
      ctx.iv = v;
      return o;
    }, { ivSizes: sizes });
  }

  // initialize: the streaming engine, make(ctx) -> { update(chunk) -> bytes, final() -> bytes, getTag?, setTag? }.
  static engine(make, meta = {}) {
    return Cipher.tag((ctx, o) => { ctx.engine = make(ctx, o); return o; }, meta);
  }

  // update: any input as bytes.
  static bytes(ctx, value) { return toBytes(value); }

  // update (AEAD decryption): holds back the last `n` bytes of the stream, the tag appended by tagged().
  // AEAD decryption of a stream: the tag is the last n bytes of the input, but chunk boundaries are arbitrary, so the
  // last n bytes seen so far are always held back (ctx.tail) and released when more input arrives. At final() the tail is
  // the tag.
  static detachTag(n) {
    return Cipher.tag((ctx, value) => {
      if (!ctx.decrypt) return value;
      const all = ctx.tail ? concatBytes(ctx.tail, value) : value;
      const cut = Math.max(0, all.length - n);
      ctx.tail = all.slice(cut);
      return all.subarray(0, cut);
    }, { tagLength: n, aead: true });
  }

  // update: the engine transforms the bytes.
  static transform(ctx, value) { return ctx.engine.update(value); }

  // finalize (AEAD decryption): hands the held-back tag (or options.tag) to the engine before final().
  // Minimum 12 bytes: shorter inputs cannot contain a full tag; failing early gives a clear error instead of a generic auth failure.
  static verifyTag(ctx, value) {
    if (ctx.decrypt) {
      const tag = ctx.options.tag ? toBytes(ctx.options.tag) : ctx.tail;
      if (!tag || tag.length < 12) throw new Error('ciphertext too short: the authentication tag is missing');
      ctx.engine.setTag(tag);
    }
    return value;
  }

  // finalize: the engine's last bytes (padding, authentication check).
  static flush(ctx) { return ctx.engine.final(); }

  // finalize (AEAD encryption): appends the tag to the output (ciphertext || tag), unless options.detachedTag.
  // Output format ciphertext || tag (the common convention of libsodium / WebCrypto); detachedTag keeps them apart for protocols that store the tag separately.
  static appendTag(ctx, value) {
    if (ctx.decrypt) return value;
    ctx.tag = ctx.engine.getTag();
    return ctx.options.detachedTag ? value : concatBytes(value, ctx.tag);
  }
}

// The running state of one encryption / decryption, created by createCipher.
// One encryption or decryption: initialize runs in the constructor, so a bad key or IV throws before any data is processed.
class CipherContext {
  constructor(def, options = {}) {
    this.def = def;
    this.options = options;
    this.decrypt = !!options.decrypt;
    this.engine = null;
    this.tail = null;
    this.tag = null;
    Cipher.run(def.initialize, this, options);
  }

  update(chunk) { return Cipher.run(this.def.update, this, chunk); }

  final() { return Cipher.run(this.def.finalize, this, undefined); }
}

class DiscoverableCipher extends Cipher {
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
    // Capabilities come from the first step that declares them; the UI builds key/IV fields and padding toggles from these.
    this.keySizes = find('keySizes') ? find('keySizes').keySizes : [];
    this.ivSizes = find('ivSizes') ? find('ivSizes').ivSizes : [];
    this.aead = !!find('aead');
    this.tagLength = find('tagLength') ? find('tagLength').tagLength : 0;
    this.padding = !!find('padding');
    this.block = find('blockSize') ? find('blockSize').blockSize : 1;
    DiscoverableCipher.registry.set(id, this);
  }

  create(options) { return new CipherContext(this, options); }

  // One shot: the whole input at once.
  // One-shot helper; for large inputs callers stream with create().update()/final().
  apply(data, options) {
    const c = this.create(options);
    return concatBytes(c.update(data), c.final());
  }
}

function getCiphers() {
  return [...DiscoverableCipher.registry.keys()];
}

function getCipher(id) {
  return DiscoverableCipher.registry.get(id) || null;
}

function createCipher(id, ...args) {
  const cipher = DiscoverableCipher.registry.get(id);
  if (!cipher)
    throw new Error(`unknown cipher: ${id}`);
  return cipher.create(...args);
}

export {
  Cipher, CipherContext,
  DiscoverableCipher, getCiphers, getCipher, createCipher
};
