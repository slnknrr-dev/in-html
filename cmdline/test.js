// cmdline/test.js - unit tests of the command-line quoting: `node cmdline/test.js` (importing the module runs nothing).
// Expected strings for both shells; where bash / cmd.exe exist on the machine, every quoted command is also run
// through the real shell and the arguments the program receives are compared with the originals.

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { commandLine, quote, script } from './quote.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// Each entry breaks a naive quoter: embedded quotes, trailing backslash before the closing quote (C runtime rule),
// cmd metacharacters, % expansion, bash single quote, cmd separators , ; =, lone parentheses, non-ASCII, empty string.
const TRICKY = ['plain', 'a b', 'a"b', 'a\\"b', 'C:\\Program Files\\x\\', 'x&y|z<w>^', '100%', "it's", 'semi;colon', 'k=v,w', '(paren)', '(', ')', 'Привет мир',
  'scale=640:-2,fps=30', '[0:v][1:v]overlay=10:10[out]', 'frame%04d.png', 'tab\there', 'back\\slash\\\\', ''];

function shellRuns(shell) {
  try {
    if (shell === 'bash') execFileSync('bash', ['-c', 'true'], { stdio: 'ignore' });
    else if (process.platform === 'win32') execFileSync('cmd.exe', ['/d', '/c', 'exit 0'], { stdio: 'ignore' });
    else return false;
    return true;
  } catch { return false; }
}

// The arguments a program receives when the command line runs in the shell.
function received(line, shell) {
  const probe = `${quote(process.execPath, shell)} -e ${quote('process.stdout.write(JSON.stringify(process.argv.slice(1)))', shell)}`;
  const full = `${probe} ${line}`;
  const out = shell === 'bash'
    ? execFileSync('bash', ['-s'], { input: full, encoding: 'utf8' }) // stdin: no Windows command-line parsing on the way
    : execFileSync('cmd.exe', ['/d', '/s', '/c', `"${full}"`], { encoding: 'utf8', windowsVerbatimArguments: true });
  return JSON.parse(out);
}

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };

  eq('bash bare', quote('in.mp4', 'bash'), 'in.mp4');
  eq('bash spaces', quote('my file.mp4', 'bash'), "'my file.mp4'");
  eq('bash apostrophe', quote("it's", 'bash'), "'it'\\''s'");
  eq('bash empty', quote('', 'bash'), "''");
  eq('bash parentheses', [quote('(', 'bash'), quote(')', 'bash'), quote('(x)', 'bash')], ['\\(', '\\)', "'(x)'"]);
  eq('cmd parentheses', quote('(', 'cmd'), '"("');
  eq('cmd bare', quote('C:\\in\\a.mp4', 'cmd'), 'C:\\in\\a.mp4');
  eq('cmd spaces', quote('my file.mp4', 'cmd'), '"my file.mp4"');
  eq('cmd quote', quote('a"b', 'cmd'), '"a""b"');
  eq('cmd trailing backslash', quote('C:\\a b\\', 'cmd'), '"C:\\a b\\\\"');
  eq('cmd filter graph', quote('scale=640:-2,fps=30', 'cmd'), '"scale=640:-2,fps=30"');
  eq('cmd batch percent', quote('frame%04d.png', 'cmd', { batch: true }), '"frame%%04d.png"');
  eq('command', commandLine(['ffmpeg', ['-i', 'in put.mp4'], ['-vf', 'scale=640:-2'], 'out.mp4'], 'bash'), "ffmpeg -i 'in put.mp4' -vf scale=640:-2 out.mp4");
  eq('wrapped bash', commandLine(['magick', 'input.jpg', ['-resize', '50%'], ['-quality', '85'], 'output.jpg'], 'bash', { width: 30 }),
    'magick input.jpg -resize 50% \\\n  -quality 85 output.jpg');
  eq('wrapped cmd', commandLine(['magick', 'input.jpg', ['-resize', '50%'], ['-quality', '85'], 'output.jpg'], 'cmd', { width: 30 }),
    'magick input.jpg ^\n  -resize "50%" -quality 85 ^\n  output.jpg');
  eq('script', script([{ comment: 'resize', argv: ['magick', 'a.png', ['-resize', '50%'], 'b.png'] }], 'cmd'), 'REM resize\nmagick a.png -resize "50%" b.png');

  // Round trips through the real shells.
  for (const shell of ['bash', 'cmd']) {
    if (!shellRuns(shell)) { console.log(`cmdline: ${shell} not available, round trips skipped`); continue; }
    const args = shell === 'cmd' ? TRICKY.filter((a) => !/[\t%]/.test(a) || a === 'frame%04d.png') : TRICKY;
    eq(`${shell} round trip`, received(args.map((a) => quote(a, shell)).join(' '), shell), args);
  }

  console.log(`cmdline: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
