// crypto-tool/encode.js - the encoding registry: Encode (static primitives), DiscoverableEncoding (self-registering
// declarative encodings), getEncodings / getEncoding / createEncoding.
// 
// Registry pattern shared by cipher.js, hash.js and encode.js: an algorithm is declared as data — lists of small
// step functions per phase — instead of a subclass with overridden methods. Steps carry metadata (Object.assign on the
// function), and the registry reads capabilities back from the steps (key sizes, AEAD, keyed, options), so the UI is
// generated from the same declaration that runs the algorithm and cannot drift from it. Adding an algorithm = one
// declaration; nothing else in the app changes.
// Phases: encode (bytes -> text, or bytes for 8-bit encodings) and decode (text -> bytes). Options are declared by the
// steps that read them (Encode.opt), so the options card of the UI is generated per encoding and direction.
/* PoC / demo code from https://codeberg.org/slnknrr/in-html/src/branch/all-in-one/
 *
 * The goal is a self-contained HTML artifact and serverless crypto-app example,
 * not production use or serious security-sensitive deployment.
*/
import { bytesToUtf8, toBytes, utf8ToBytes } from '../crypto/encoding.js';

// A step is a function (context, value) -> value; the encode phase turns bytes into text, the decode phase text into
// bytes. Steps carry metadata (the options they read, binary output, …) that the registry reads back.
class Encode {
  static run(steps, ctx, value) {
    for (const step of steps) value = step(ctx, value);
    return value;
  }

  static tag(step, meta) { return Object.assign(step, meta); }

  // An option a step reads from ctx.options: { key, def, choices?: [{ v, l }], min?, max? }. The type follows the
  // default (boolean, number, string) unless choices are given.
  // Option type inferred from the default value: no separate schema to keep in sync.
  static opt(key, def, extra = {}) {
    const type = extra.choices ? 'choice' : typeof def === 'boolean' ? 'bool' : typeof def === 'number' ? 'number' : 'text';
    return { key, def, type, ...extra };
  }

  // The codec itself: fn(value, options) -> value; opts: the options it reads.
  static codec(fn, ...opts) { return Encode.tag((ctx, v) => fn(v, ctx.options), { opts }); }

  // encode: any input (string as UTF-8, ArrayBuffer, typed array) as bytes.
  static bytes(ctx, value) { return toBytes(value); }

  // encode: the input as Unicode text (bytes are read as UTF-8): encodings of text such as Punycode.
  // Textual encodings (Punycode) work on characters, not bytes: bytes input is decoded as UTF-8 first.
  static text = Encode.tag((ctx, value) => (typeof value === 'string' ? value : bytesToUtf8(toBytes(value))), { textual: true });

  // decode: text back to UTF-8 bytes (after a text-level decoder).
  static utf8(ctx, value) { return utf8ToBytes(value); }

  // decode: drops whitespace (line breaks, indentation of pasted text).
  static strip(ctx, value) { return String(value).replace(/\s+/g, ''); }

  // decode: a decoder's result { bytes, ...facts } -> bytes; the facts (file name, checksum status, …) go to ctx.info.
  // Some decoders learn metadata (uu file name, yEnc CRC status, Bech32 prefix); it travels in ctx.info, separate from the bytes.
  static facts(ctx, value) {
    const { bytes, ...rest } = value;
    Object.assign(ctx.info, rest);
    return bytes;
  }

  // encode: cuts a single-line result into lines of options.wrap characters (0: one line).
  // 64 = PEM line length, 76 = MIME (RFC 2045) line length.
  static wrap(def, lengths = [64, 76]) {
    return Encode.tag((ctx, s) => {
      const n = +ctx.options.wrap;
      return n > 0 && s.length > n ? s.match(new RegExp(`.{1,${n}}`, 'g')).join('\n') : s;
    }, { opts: [Encode.opt('wrap', def, { choices: [{ v: 0, l: 'opt.none' }, ...lengths.map((v) => ({ v, l: '=' + v }))] })] });
  }

  // encode: removes the '=' padding unless options.pad.
  static padding(def) {
    return Encode.tag((ctx, s) => (ctx.options.pad ? s : s.replace(/=+$/, '')), { opts: [Encode.opt('pad', def)] });
  }
}

// The running state of one conversion, created by createEncoding.
class EncodingContext {
  constructor(def, options) {
    this.def = def;
    this.options = { ...def.defaults, ...(options || {}) };
    this.info = {};
  }

  // Bytes (or a string, read as UTF-8) -> string (Uint8Array for 8-bit encodings: def.binary).
  encode(data) { this.info = {}; return Encode.run(this.def.encode, this, data); }

  // String (or bytes, for 8-bit encodings) -> Uint8Array; facts about the input land in this.info.
  decode(text) { this.info = {}; return Encode.run(this.def.decode, this, text); }
}

class DiscoverableEncoding extends Encode {
  static registry = new Map();

  // spec: { encode: [...steps], decode: [...steps], label?, group?, note?, ext? }
  constructor(id, spec) {
    super();
    const all = [...spec.encode, ...spec.decode];
    const has = (k) => all.some((s) => s[k]);
    this.id = id;
    this.label = spec.label || id;
    this.group = spec.group || 'other';
    this.note = spec.note || '';
    this.ext = spec.ext || 'txt';
    this.encode = spec.encode;
    this.decode = spec.decode;
    // Options read back from the steps; an option of both phases applies to both directions.
    const options = new Map();
    for (const [dir, steps] of [['encode', spec.encode], ['decode', spec.decode]]) {
      for (const o of steps.flatMap((s) => s.opts || [])) {
        const seen = options.get(o.key);
        options.set(o.key, seen && seen.dir !== dir ? { ...seen, dir: 'both' } : { ...o, dir });
      }
    }
    // An option read by both phases is merged into one control with dir 'both'.
    this.options = [...options.values()];
    this.defaults = Object.fromEntries(this.options.map((o) => [o.key, o.def]));
    this.textual = has('textual');   // encodes Unicode text rather than bytes
    this.binary = has('binary');     // 8-bit output (Uint8Array)
    this.caseless = has('caseless'); // the decoder ignores letter case
    this.checksum = has('checksum'); // the decoder verifies a checksum (a successful decoding is strong evidence)
    const q = all.find((s) => s.quadratic);
    // Big-number encodings (Base58, Base62 …) are O(n²); the UI refuses very long inputs for them instead of freezing.
    this.quadratic = q ? q.quadratic : false; // big-number arithmetic, slow on long inputs: true or a test of the options
    DiscoverableEncoding.registry.set(id, this);
  }

  // Whether these options make the encoding quadratic in the input length.
  isQuadratic(options) {
    return typeof this.quadratic === 'function' ? !!this.quadratic({ ...this.defaults, ...(options || {}) }) : this.quadratic;
  }

  create(options) { return new EncodingContext(this, options); }
}

function getEncodings() {
  return [...DiscoverableEncoding.registry.keys()];
}

function getEncoding(id) {
  return DiscoverableEncoding.registry.get(id) || null;
}

function createEncoding(id, ...args) {
  const enc = DiscoverableEncoding.registry.get(id);
  if (!enc)
    throw new Error(`unknown encoding: ${id}`);
  return enc.create(...args);
}

export {
  Encode, EncodingContext,
  DiscoverableEncoding, getEncodings, getEncoding, createEncoding
};
