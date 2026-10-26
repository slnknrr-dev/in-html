// funding-studio/runtime-net.offline.js - offline variant of runtime-net.js: R.json of exported funding pages (serialized with Function.prototype.toString like
// runtime.js): fetch with a timeout, JSON in and out, HTTP errors rejected with .status.

// Same signature as runtime-net.js so every caller works unchanged; status 0 is what a network failure looks like,
// so callers take their usual "unreachable" path. The build swaps the file, so offline pages contain no fetch at all.
function rtNet(R) {
  // pages built offline talk to no backend: every request fails like an unreachable server
  R.json = function () {
    var e = new Error('offline');
    e.status = 0;
    return Promise.reject(e);
  };
}

export { rtNet };
