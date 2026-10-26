// landing-studio/viewer-runtime-net.offline.js - offline variant of viewer-runtime-net.js: R.net of exported landing pages (serialized with Function.prototype.toString
// like viewer-runtime.js): configured requests with timeouts, headers, bodies and JSON answers.

function rtNet(R) {
  // Same signature as the online rtNet so callers need no branch; the build picks this file for offline bundles
  // (the .offline.js suffix), guaranteeing such pages make no network requests at all.
  // pages built offline send nothing: every configured request ends as 'offline'
  var res = R.reqRes;
  R.net = function (raw, q, v, m, body, opt, finish) { finish(res(false, 0, null, 'offline')); };
}

export { rtNet };
