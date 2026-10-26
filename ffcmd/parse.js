// ffcmd/parse.js - reads filter graph text back the way ffmpeg does (libavutil av_get_token and
// av_opt_get_key_value, libavfilter's graph syntax), to check generated graphs: labels, filter names and the option
// values after both levels of escaping.
//
//   getToken(s, pos, terminators) -> { value, pos }   backslash takes the next character, '…' is literal, leading
//                                                    and trailing whitespace is dropped
//   parseOptions(args) -> [[key | null, value]]      null key: a positional value
//   parseGraph(text) -> [{ ins, filters: [{ name, args, opts }], outs }]   throws on syntax errors
//   checkGraph(chains, { inputs, outputs }) -> [problem]   every pad label produced once and consumed once, stream
//                                                    specifiers point at existing inputs, the expected outputs exist

const WS = ' \n\t\r';

// Port of av_get_token: `end` remembers the last position produced by an escape or a quote, so trailing whitespace
// is trimmed only if it was unescaped (an escaped trailing space survives, exactly as in ffmpeg).
export function getToken(s, pos, term) {
  let out = '', end = 0, p = pos;
  while (p < s.length && WS.includes(s[p])) p++;
  while (p < s.length && !term.includes(s[p])) {
    const c = s[p++];
    if (c === '\\' && p < s.length) { out += s[p++]; end = out.length; }
    else if (c === "'") {
      while (p < s.length && s[p] !== "'") out += s[p++];
      if (p < s.length) { p++; end = out.length; }
    } else out += c;
  }
  let k = out.length;
  while (k > end && WS.includes(out[k - 1])) k--;
  return { value: out.slice(0, k), pos: p };
}

// av_opt_get_key_value semantics: 'key=value' when a valid key is followed by '=', otherwise a positional value.
export function parseOptions(args) {
  const out = [];
  let p = 0;
  while (p < args.length) {
    let q = p;
    while (q < args.length && WS.includes(args[q])) q++;
    const k0 = q;
    while (q < args.length && /[A-Za-z0-9_\-/.]/.test(args[q])) q++;
    let key = null, r = q;
    while (r < args.length && WS.includes(args[r])) r++;
    if (q > k0 && args[r] === '=') { key = args.slice(k0, q); p = r + 1; }
    const t = getToken(args, p, ':');
    out.push([key, t.value]);
    p = t.pos;
    if (args[p] === ':') p++; else break;
  }
  return out;
}

// A verifier, not a general parser: used by tests to prove generated graphs round-trip through ffmpeg's rules.
// Labels are allowed only before the first filter and after the last one of a chain, as in libavfilter.
export function parseGraph(s) {
  const chains = [];
  let p = 0;
  const skip = () => { while (p < s.length && WS.includes(s[p])) p++; };
  const labels = () => {
    const out = [];
    skip();
    while (s[p] === '[') {
      const e = s.indexOf(']', p);
      if (e < 0) throw new Error('unterminated label');
      out.push(s.slice(p + 1, e));
      p = e + 1;
      skip();
    }
    return out;
  };
  let chain = { ins: [], filters: [], outs: [] };
  for (;;) {
    const ins = labels();
    if (!chain.filters.length) chain.ins = ins;
    else if (ins.length) throw new Error('labels inside a chain');
    const nm = getToken(s, p, '=,;[');
    p = nm.pos;
    if (!nm.value) throw new Error('missing filter name at ' + p);
    let args = '';
    if (s[p] === '=') { const a = getToken(s, p + 1, '[],;'); args = a.value; p = a.pos; }
    chain.filters.push({ name: nm.value, args, opts: parseOptions(args) });
    const outs = labels();
    if (s[p] === ',') {
      if (outs.length) throw new Error('labels inside a chain');
      p++;
      continue;
    }
    chain.outs = outs;
    chains.push(chain);
    if (s[p] === ';') { p++; chain = { ins: [], filters: [], outs: [] }; continue; }
    skip();
    if (p < s.length) throw new Error(`unexpected '${s[p]}' at ${p}`);
    return chains;
  }
}

// Graph well-formedness: each internal label produced once and consumed once, '<n>:v' / '<n>:a' stream specifiers
// within range, declared outputs produced and not consumed. ffmpeg reports these only at run time, with less context.
export function checkGraph(chains, { inputs = Infinity, outputs = [] } = {}) {
  const problems = [];
  const made = new Map(), used = new Map();
  for (const c of chains) {
    for (const l of c.outs) made.set(l, (made.get(l) || 0) + 1);
    for (const l of c.ins) {
      const m = /^(\d+):[va]$/.exec(l);
      if (m) { if (+m[1] >= inputs) problems.push(`input ${l} does not exist`); continue; }
      used.set(l, (used.get(l) || 0) + 1);
    }
  }
  for (const [l, n] of made) {
    if (n > 1) problems.push(`label ${l} produced ${n} times`);
    const u = used.get(l) || 0;
    if (outputs.includes(l)) { if (u) problems.push(`output ${l} is also consumed`); }
    else if (u !== 1) problems.push(`label ${l} consumed ${u} times`);
  }
  for (const l of used.keys()) if (!made.has(l)) problems.push(`label ${l} is never produced`);
  for (const l of outputs) if (!made.has(l)) problems.push(`output ${l} missing`);
  return problems;
}
