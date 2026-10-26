// codec/deflate.js - deflate / inflate through the platform Compression Streams (browsers, Node >= 18, Bun).
//   compress(bytes|string, format) / decompress(bytes, format) -> Uint8Array; format: 'deflate-raw' (default),
//   'deflate' (zlib) or 'gzip'. deflate(input) -> raw deflate bytes; inflate(bytes) -> UTF-8 text.
//
// Why the platform codec and not codec/zlib.js: native code, multi-MB in milliseconds, zero bundle cost. zlib.js
// exists for the places this cannot reach (synchronous code paths, engines without CompressionStream).
// Default 'deflate-raw': no zlib header/Adler trailer - the smallest form, used where the container supplies its own
// framing and checksum (zip entries, URL-embedded state).
// Errors: corrupt input rejects the promise with the platform's TypeError; nothing is caught here (fail-fast).

// Strings are UTF-8 encoded; ArrayBuffer / array-likes are wrapped without copying where possible.
const toBytes = (input) => (typeof input === 'string' ? new TextEncoder().encode(input)
  : input instanceof Uint8Array ? input : new Uint8Array(input));

// Blob.stream() -> transform -> Response.arrayBuffer(): the shortest standard way to run bytes through a
// TransformStream and collect the whole output, without hand-writing reader/writer loops (which deadlock if you
// write everything before reading, since the transform's queue fills up and backpressure stalls the writer).
async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function compress(input, format = 'deflate-raw') {
  return pipe(toBytes(input), new CompressionStream(format));
}

async function decompress(input, format = 'deflate-raw') {
  return pipe(toBytes(input), new DecompressionStream(format));
}

async function deflate(input) {
  return compress(input, 'deflate-raw');
}

// TextDecoder defaults to non-fatal: invalid UTF-8 becomes U+FFFD instead of throwing. Fine for display; callers
// needing exact bytes use decompress().
async function inflate(bytes) {
  return new TextDecoder().decode(await decompress(bytes, 'deflate-raw'));
}

export {
  compress,
  decompress,
  deflate,
  inflate
};
