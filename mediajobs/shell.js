// mediajobs/shell.js - a job as a copyable script for bash or cmd.exe: comments, auxiliary files, the work folder,
// every step's command through ffcmd/command.js (so quoting and line wrapping are exactly cmdline/quote.js's), with
// pieces that know which step or file they come from.
//
//   renderJob(job, shell = 'bash' | 'cmd', { tools, width = 100, batch = false, workDir, progress = true })
//       -> { text, pieces: [{ text, ref }], work }
//     job       a spec or a queue job ({ id, spec }); its id (or a hash of the spec) names the work folder
//     tools     { ffmpeg: path, 'yt-dlp': [...], … } as for tools.js toolCommand; the bin name otherwise
//     workDir   the folder that {work} becomes (default 'job-<id>', relative to the current folder)
//     batch     cmd: text for a .bat / .cmd file (% doubled, @echo off, stop after a failed step)
//     progress  false drops the runner-only progress flags (ffmpeg -progress pipe:1 -nostats, yt-dlp --newline and
//               --progress-template) so the command reads like one typed by hand
//     refs      'job' (title, notes), 'file:<name>' (an auxiliary file), 'step:<i>' (a step's comment and command);
//               glue between them has ref null
//
// Auxiliary files (ffconcat lists, FFMETADATA1 chapters):
//   bash  mkdir -p job-x, then  cat > job-x/name <<'EOF' … EOF  (quoted delimiter: nothing in the text expands; the
//         delimiter changes when a line equals it; the file ends with a line break)
//   cmd   echo cannot write a file byte for byte (CRLF line ends, the console code page, % ^ & | < > " ! to escape),
//         so the text goes through base64 and certutil (part of every Windows): the exact UTF-8 bytes with LF line
//         ends. REM lines above it show the text for reading. A non-ASCII script starts with chcp 65001 (save .bat
//         files as UTF-8).
// Variables of later steps ({var:loudnorm.input_i}) are shown as <input_i from step 1>: fill them in from the output of
// that step before running the next command. cmd.exe cannot pass a line break inside an argument: such arguments are
// shown with spaces and a note.

import { quote } from '../cmdline/quote.js';
import { ref, renderCommand } from '../ffcmd/command.js';
import { b64encode } from '../codec/base64.js';
import { toolCommand } from './tools.js';
import { hashId, plainText, usesWork, varStep } from './job.js';

// Flags that take NO value, per tool. Needed only by guessGroups for layout: without the list, `-y input.mp4` would
// be grouped as a flag/value pair and printed on one line as if -y consumed the file name. A wrong guess changes
// line wrapping only, never the argv (groups are a presentation hint).
const NO_VALUE = {
  ffmpeg: new Set(['-y', '-n', '-nostdin', '-hide_banner', '-nostats', '-stats', '-vn', '-an', '-sn', '-dn', '-shortest', '-copyts', '-re', '-ignore_unknown']),
  ffprobe: new Set(['-show_format', '-show_streams', '-show_chapters', '-show_programs', '-show_entries', '-hide_banner', '-pretty']),
  'yt-dlp': new Set(['-J', '-j', '-x', '-k', '-q', '-s', '--flat-playlist', '--no-warnings', '--no-progress', '--progress', '--newline', '--embed-thumbnail', '--write-thumbnail',
    '--embed-metadata', '--embed-chapters', '--embed-subs', '--write-subs', '--write-auto-subs', '--write-info-json', '--no-playlist', '--yes-playlist', '--ignore-config',
    '--no-simulate', '--no-mtime', '--restrict-filenames', '--windows-filenames']),
  magick: new Set(['-auto-orient', '-strip', '-composite', '-flip', '-flop', '+repage', '-negate', '-append', '+append', '-flatten', '-trim', '-ping']),
};

// Argument groups when a step has none (only the line layout depends on them).
function guessGroups(tool, argv) {
  const skip = NO_VALUE[tool] || new Set();
  const isOpt = (w) => /^--?[A-Za-z]/.test(w) || (tool === 'magick' && /^\+[A-Za-z]/.test(w));
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const w = argv[i], n = argv[i + 1];
    if (isOpt(w) && !skip.has(w) && n != null && !isOpt(n) && n !== '(' && n !== ')') { out.push([w, n]); i++; } else out.push([w]);
  }
  return out;
}

// Trust explicit groups only when they partition argv exactly; a stale groups array (argv edited later) would
// misalign every line, so it falls back to guessing.
function stepGroups(step) {
  const argv = (step.argv || []).map(String);
  if (Array.isArray(step.groups) && step.groups.reduce((a, b) => a + b, 0) === argv.length) {
    const out = [];
    let k = 0;
    for (const n of step.groups) { out.push(argv.slice(k, k + n)); k += n; }
    return out;
  }
  return guessGroups(step.tool, argv);
}

// Removes runner-only machine-readable progress flags (and the value after -progress / --progress-template) so a
// copied command prints the tool's normal human progress. Works on groups, dropping groups left empty.
function stripProgress(tool, groups) {
  const out = [];
  for (const g of groups) {
    const keep = [];
    for (let i = 0; i < g.length; i++) {
      const w = g[i];
      if (tool === 'ffmpeg' && w === '-progress') { i++; continue; }
      if (tool === 'ffmpeg' && w === '-nostats') continue;
      if (tool === 'yt-dlp' && w === '--progress-template') { i++; continue; }
      if (tool === 'yt-dlp' && w === '--newline') continue;
      keep.push(w);
    }
    if (keep.length) out.push(keep);
  }
  return out;
}

// Quoted delimiter (<<'EOF') disables all expansion in the body ($, `, \ stay literal), so arbitrary file text is
// written byte for byte. The only way content could end the heredoc early is a line equal to the delimiter, hence
// EOF_1, EOF_2, ... until no line matches. Trailing newline is removed here and restored by the heredoc itself.
function heredoc(content) {
  const lines = content.replace(/\n$/, '').split('\n');
  let d = 'EOF';
  for (let k = 1; lines.includes(d); k++) d = `EOF_${k}`;
  return { body: lines, delim: d };
}

// Output model: a list of blocks, each a list of pieces { text, ref }; adjacent pieces with the same ref are merged
// at the end. The ref lets the UI highlight which step/file a span of the script came from (hover sync between the
// job editor and the script view) without re-parsing shell text.
// The work folder id is sanitized to [\w.-]: it ends up unquoted in paths and in `mkdir`, so it must be inert.
export function renderJob(job, shell = 'bash', { tools = {}, width = 100, batch = false, workDir = null, progress = true } = {}) {
  const spec = job && job.spec && Array.isArray(job.spec.steps) ? job.spec : job;
  if (!spec || !Array.isArray(spec.steps)) throw new Error('renderJob: not a job spec');
  const cmd = shell === 'cmd';
  const id = String(job?.id ?? spec.id ?? hashId(spec)).replace(/[^\w.-]/g, '_');
  const work = workDir || `job-${id}`;
  const workPath = (rest) => (cmd ? [work.replace(/\//g, '\\'), ...rest].join('\\') : [work, ...rest].join('/'));
  const q = (s) => quote(s, shell, { batch });
  const blocks = [];
  const line = (text, r = null) => blocks.push([{ text, ref: r }]);
  const comment = (text, r = null) => line((cmd ? 'REM ' : '# ') + text, r);
  let newlineNote = false;

  // Placeholders in argv for a HUMAN-run script: {work}/a/b becomes a real path in the shell's separator style;
  // {var:...} cannot be known before the earlier step runs, so it is printed as an obvious <hole> to fill in.
  // The {work} sub-path charset excludes quotes, whitespace and separators used in ffmpeg filter syntax (: ; , = [ ])
  // so the regex never swallows the rest of a filter graph argument.
  const show = (s) => {
    let t = String(s).replace(/\{work\}((?:\/[^/\s'":;,[\]=]+)*)/g, (m, rest) => workPath(rest ? rest.split('/').filter(Boolean) : []));
    t = t.replace(/\{var:([A-Za-z0-9_.-]+)\}/g, (m, name) => {
      const i = varStep(spec, name);
      const field = name.split('.').slice(1).join('.') || name;
      return i >= 0 ? `<${field} from step ${i + 1}>` : `<${name}>`;
    });
    if (cmd && /[\r\n]/.test(t)) { newlineNote = true; t = t.replace(/\r?\n|\r/g, ' '); }
    return t;
  };

  if (cmd && batch) line('@echo off');
  // chcp 65001 switches the console to UTF-8 so non-ASCII file names in arguments survive; emitted only when needed
  // because it also changes the console for the rest of the session.
  if (cmd && /[^\x00-\x7f]/.test(JSON.stringify(spec) + JSON.stringify(tools || {}))) line('chcp 65001 >NUL');
  comment(plainText(spec.title || spec.kind || 'job', 200), 'job');
  const titleAt = blocks.length;
  for (const n of spec.notes || []) comment('note: ' + plainText(n, 200), 'job');
  const usesVars = spec.steps.some((s) => (s.argv || []).some((a) => /\{var:/.test(String(a))));
  if (usesVars) comment('<name from step N>: a value step N prints at the end of its output; fill it in before running that command', 'job');
  if (usesWork(spec)) {
    const w = q(cmd ? work.replace(/\//g, '\\') : work);
    line(cmd ? `if not exist ${w} mkdir ${w}` : `mkdir -p ${w}`, 'job');
  }

  spec.steps.forEach((step, i) => {
    const r = `step:${i}`;
    for (const [name, content0] of Object.entries(step.files || {})) {
      // Auxiliary file names are interpolated into shell text and paths: a strict whitelist (no separators, no
      // quotes, no '..' traversal beyond literal dots within one name) is cheaper than proving quoting correct.
      if (!/^[\w.-]+$/.test(name)) throw new Error('renderJob: bad auxiliary file name ' + JSON.stringify(name));
      const fr = `file:${name}`;
      const content = String(content0).replace(/\{work\}((?:\/[^/\s'":;,[\]=]+)*)/g, (m, rest) => [work, ...rest.split('/').filter(Boolean)].join('/'));
      const target = workPath([name]);
      if (!cmd) {
        const { body, delim } = heredoc(content);
        blocks.push([{ text: [`cat > ${q(target)} <<'${delim}'`, ...body, delim].join('\n'), ref: fr }]);
      } else {
        comment(`${target}:`, fr);
        for (const l of content.replace(/\n$/, '').split('\n')) {
          let t = l.replace(/\r/g, '');
          if (batch) t = t.replace(/%/g, '%%');
          // A trailing ^ is cmd's line-continuation character even after REM; it would glue the next line into the
          // comment and hide a real command. A space after it neutralizes that.
          if (/\^$/.test(t)) t += ' ';
          line('REM   ' + t, fr);
        }
        // certutil -decode is the only built-in Windows tool that writes exact bytes from text. base64 lines of 76
        // chars (MIME width) stay well below cmd's 8191-char line limit; the ( ... ) > file block writes them in one
        // redirection. `type NUL >` creates an empty file, since certutil rejects empty input.
        const bytes = new TextEncoder().encode(content);
        if (!bytes.length) line(`type NUL > ${q(target)}`, fr);
        else {
          const b64 = b64encode(bytes).match(/.{1,76}/g);
          const tmp = q(target + '.b64');
          blocks.push([{ text: ['(', ...b64.map((x) => 'echo ' + x), `) > ${tmp}`, `certutil -f -decode ${tmp} ${q(target)} >NUL`, `del ${tmp}`].join('\n'), ref: fr }]);
        }
      }
    }
    if (step.comment) comment(plainText(step.comment, 200), r);
    let groups = stepGroups(step);
    if (!progress) groups = stripProgress(step.tool, groups);
    const program = toolCommand(tools, step.tool) || [step.tool];
    const units = [ref(r, ...program), ...groups.map((g) => ref(r, ...g.map(show)))];
    blocks.push(renderCommand(units, shell, { width, batch }).pieces);
    // A .bat file does not stop on errors by default (no `set -e` equivalent): an explicit errorlevel check after
    // each step but the last prevents later steps from running on a missing intermediate file.
    if (cmd && batch && spec.steps.length > 1 && i < spec.steps.length - 1) line('if errorlevel 1 exit /b 1', r);
  });
  if (newlineNote) blocks.splice(titleAt, 0, [{ text: 'REM note: cmd.exe cannot pass line breaks inside an argument; they are shown as spaces', ref: 'job' }]);

  const pieces = [];
  blocks.forEach((b, i) => {
    if (i) pieces.push({ text: '\n', ref: null });
    for (const p of b) {
      const last = pieces[pieces.length - 1];
      if (last && last.ref === p.ref) last.text += p.text; else pieces.push({ text: p.text, ref: p.ref });
    }
  });
  return { text: pieces.map((p) => p.text).join(''), pieces, work };
}
