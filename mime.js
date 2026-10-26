// mime.js - file extension -> media type table shared by the dev server and the single-file builder.
//
// One table for both consumers on purpose: if the dev server and the builder disagreed, a page could work under
// `node server.js` and break as a built artifact (or the reverse). Text types carry `charset=utf-8` explicitly: without
// it browsers sniff, and a UTF-8 page without a BOM can be read as windows-1252 from some servers.
// '.js' is text/javascript (the RFC 9239 canonical type); module scripts are refused under a non-JavaScript type.

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

// Last extension only ('.tar.gz' -> '.gz'); the class [^./\\] stops at a directory separator, so 'a.b/c' has none.
export function mimeOf(file, fallback = 'application/octet-stream') {
  const m = /\.[^./\\]+$/.exec(file);
  return (m && MIME[m[0].toLowerCase()]) || fallback;
}

// data: URI for file contents (text types are percent-encoded when that is shorter than base64).
export function dataURI(file, bytes) {
  // Percent-encoding wins for text/SVG (base64 inflates by 4/3; ASCII-heavy text grows far less). The safe characters
  // are un-escaped back because URI data parsers accept them literally; quotes are forced escaped because the URI is
  // usually embedded inside an HTML attribute or CSS url("..."), where a raw quote would end the string.
  // SVG gets no charset parameter: image/svg+xml is XML and declares its own encoding.
  const type = mimeOf(file).replace(/; charset=utf-8$/, '');
  const buf = Buffer.from(bytes);
  if (type === 'image/svg+xml' || type.startsWith('text/')) {
    const text = buf.toString('utf8');
    const enc = encodeURIComponent(text).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%3A/g, ':')
      .replace(/%2F/g, '/').replace(/%2C/g, ',').replace(/%3B/g, ';').replace(/'/g, '%27').replace(/"/g, '%22');
    const b64 = buf.toString('base64');
    if (enc.length < b64.length) return `data:${type}${type === 'image/svg+xml' ? '' : ';charset=utf-8'},${enc}`;
    return `data:${type};base64,${b64}`;
  }
  return `data:${type};base64,${buf.toString('base64')}`;
}
