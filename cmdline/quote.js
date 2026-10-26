// cmdline/quote.js - command lines as text in two syntaxes: Linux bash and Windows cmd.exe. Applications use it to
// describe what they do as equivalent ffmpeg / ImageMagick commands (strings to read and copy, never executed).
//
//   quote(arg, shell, { batch })       one argument; shell 'bash' | 'cmd'
//   commandLine(argv, shell, options)  a whole command: argv items are strings or arrays (kept on one line, e.g.
//                                      ['-vf', 'scale=640:-2']); options { width = 0 (no wrapping), batch }
//   script(steps, shell, options)      several commands with comments: [{ comment?, argv }] → text
//   NULL_DEVICE                        { bash: '/dev/null', cmd: 'NUL' }
//
// bash: arguments made of safe characters stay bare; others go in single quotes (' becomes '\''), a lone ( or )
// (ImageMagick's image-list parentheses) is written \( \); line continuation is " \".
// cmd.exe: the program receives its arguments by the Microsoft C runtime rules, so an argument with spaces or
// special characters goes in double quotes, backslashes before a quote are doubled and a quote inside is written
// "" (one argument for the runtime, and cmd's quote state stays balanced, so & | < > ^ ( ) remain literal). In an
// interactive window %name% expands only when the variable exists (ffmpeg's frame%04d.png stays as typed); with
// { batch: true } every % is doubled for .bat / .cmd files. Line continuation is " ^".

// cmd.exe also splits on , ; = (and the runtime keeps them), so they are quoted there.
// Whitelists, not blacklists: anything outside the set is quoted. A blacklist of shell metacharacters always misses
// one (newline, '!' history expansion, glob '*?[', '~' expansion) and the result runs something unintended.
const SAFE = { bash: /^[A-Za-z0-9_@%+=:,./-]+$/, cmd: /^[A-Za-z0-9_@+:./\\-]+$/ };

export const NULL_DEVICE = { bash: '/dev/null', cmd: 'NUL' };

export function quote(arg, shell = 'bash', { batch = false } = {}) {
  let s = String(arg);
  if (shell === 'cmd') {
    // Before quoting: cmd expands %var% even inside double quotes, so quotes do not protect '%'.
    if (batch) s = s.replace(/%/g, '%%');
    if (s && SAFE.cmd.test(s)) return s;
    // Backslashes before a quote and at the end are doubled (they precede a quote in the result).
    let out = '"';
    let slashes = 0;
    for (const c of s) {
      if (c === '\\') { slashes++; continue; }
      if (c === '"') { out += '\\'.repeat(slashes * 2) + '""'; slashes = 0; continue; }
      out += '\\'.repeat(slashes) + c;
      slashes = 0;
    }
    return out + '\\'.repeat(slashes * 2) + '"';
  }
  if (s && SAFE.bash.test(s)) return s;
  // ImageMagick's parentheses as its documentation writes them
  if (s === '(' || s === ')') return '\\' + s;
  // Inside single quotes bash interprets nothing, not even backslash, so a quote is written by closing, emitting an
  // escaped quote, and reopening: ' -> '\''. Double quotes would still expand $ and backticks.
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

const CONT = { bash: ' \\', cmd: ' ^' };

// Greedy wrapping on word boundaries; grouped items (arrays) are one word so an option never separates from its
// value. Continuation lines are indented two spaces, which both shells ignore.
export function commandLine(argv, shell = 'bash', { width = 0, batch = false } = {}) {
  const items = argv.filter((a) => a != null && a !== false).map((a) => (Array.isArray(a) ? a.filter((x) => x != null) : [a]));
  const words = items.map((g) => g.map((a) => quote(a, shell, { batch })).join(' ')).filter(Boolean);
  if (!width) return words.join(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && cur.length + 1 + w.length + CONT[shell].length > width) { lines.push(cur + CONT[shell]); cur = '  ' + w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

export function script(steps, shell = 'bash', options = {}) {
  const out = [];
  for (const step of steps) {
    if (step.comment) out.push((shell === 'cmd' ? 'REM ' : '# ') + step.comment);
    if (step.argv) out.push(commandLine(step.argv, shell, options));
  }
  return out.join('\n');
}
