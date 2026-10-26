// png/png.js - the PNG library in one import: decoder, encoder, quantizer and chunk tools (see README.md).
//
// Synchronous by design (zlib in JS, no CompressionStream): works in workers, in Node and inside build steps where
// awaiting per image would complicate callers; sizes handled here (icons, exports) keep the cost small.
export { ADAM7, COLOR_TYPES, decodePNG, pngInfo } from './decode.js';
export { analyzePNG, encodePNG } from './encode.js';
export { buildPalette, mapToPalette, quantize } from './quantize.js';
export {
  apngInfo, isPNG, makeChunk, parseTextChunk, PNG_SIGNATURE, readChunks, readText, setText, stripMetadata, textChunk, writeChunks,
} from './chunks.js';
