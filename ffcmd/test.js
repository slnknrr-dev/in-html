// ffcmd/test.js - unit tests of the ffmpeg command text: `node ffcmd/test.js` (importing the module runs nothing).
// The escaping is checked against a re-implementation of ffmpeg's own parsing (libavutil av_get_token,
// av_opt_get_key_value, libavfilter graph syntax): a value must come back unchanged after both levels. Commands
// rendered with references must equal cmdline's commandLine / script output; where bash / cmd.exe exist, rendered
// commands also run through the real shells and the filter graph the program receives is parsed back.

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { commandLine, quote, script } from '../cmdline/quote.js';
import { color, escapeGraph, escapeValue, num } from './escape.js';
import { Graph, f, raw } from './graph.js';
import { plainArgv, ref, renderCommand, renderScript } from './command.js';
import { bitrate, encodeArgs } from './codecs.js';
import { checkGraph, parseGraph } from './parse.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// --- shells ----------------------------------------------------------------------------------------------------------

function shellRuns(shell) {
  try {
    if (shell === 'bash') execFileSync('bash', ['-c', 'true'], { stdio: 'ignore' });
    else if (process.platform === 'win32') execFileSync('cmd.exe', ['/d', '/c', 'exit 0'], { stdio: 'ignore' });
    else return false;
    return true;
  } catch { return false; }
}

// Runs a rendered command line in the shell with node standing in for ffmpeg: the arguments it receives.
function received(line, shell) {
  const fake = `${quote(process.execPath, shell)} -e ${quote('process.stdout.write(JSON.stringify(process.argv.slice(1)))', shell)} --`;
  const full = line.replace(/^ffmpeg\b/, fake);
  const out = shell === 'bash'
    ? execFileSync('bash', ['-s'], { input: full, encoding: 'utf8' })
    : execFileSync('cmd.exe', ['/d', '/s', '/c', `"${full.replace(/ \^\n {2}/g, ' ')}"`], { encoding: 'utf8', windowsVerbatimArguments: true });
  return JSON.parse(out);
}

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const throws = (name, fn) => { try { fn(); fail++; console.log(`FAIL ${name}: no error`); } catch { pass++; } };

  // Escaping: the example of ffmpeg-filters "Notes on filtergraph escaping".
  const doc = "this is a 'string': may contain one, or more, special characters";
  eq('level 1 (docs)', escapeValue(doc), "this is a \\'string\\'\\: may contain one, or more, special characters");
  eq('level 2 (docs)', 'drawtext=text=' + escapeGraph(escapeValue(doc)), "drawtext=text=this is a \\\\\\'string\\\\\\'\\\\: may contain one\\, or more\\, special characters");
  eq('f() = docs', f('drawtext', { text: doc }), "drawtext=text=this is a \\\\\\'string\\\\\\'\\\\: may contain one\\, or more\\, special characters");

  // Round trips through the parser: every tricky value survives both levels.
  const TRICKY = ["It's 10:30", 'a\\b', 'C:\\Users\\me\\font.ttf', '[x];y,z', "''", 'a:b:c', '100%', 'tab\tin', 'Привет, мир', '\\', ':', "'", 'semi;colon', 'x=y'];
  for (const v of TRICKY) {
    const g = parseGraph(f('drawtext', { text: v, x: 10 }));
    eq('round trip ' + JSON.stringify(v), g[0].filters[0].opts, [['text', v], ['x', '10']]);
  }
  eq('positional', parseGraph(f('scale', 1280, -2))[0].filters[0].opts, [[null, '1280'], [null, '-2']]);
  eq('expression commas', f('overlay', { x: '(W-w)/2', enable: 'between(t,1,3)' }), 'overlay=x=(W-w)/2:enable=between(t\\,1\\,3)');
  eq('expression parsed', parseGraph(f('overlay', { enable: 'between(t,1,3)' }))[0].filters[0].opts, [['enable', 'between(t,1,3)']]);
  eq('raw value', f('x', { a: raw('p\\:q') }), 'x=a=p\\\\:q');
  eq('no args', f('hflip'), 'hflip');
  eq('null options skipped', f('eq', { brightness: 0.1, contrast: null, saturation: false }), 'eq=brightness=0.1');

  // Numbers and colours.
  eq('num', [num(2), num(0.5), num(1 / 3), num(-0.0001), num(1e-7), num(12.3456, 2), num(NaN)], ['2', '0.5', '0.333', '0', '0', '12.35', '0']);
  eq('color', [color('#ffffff'), color('#000000', 0.5), color('#FF8800'), color('#abc'), color('nope')], ['white', 'black@0.5', '#ff8800', '#aabbcc', 'black']);

  // Graphs.
  const g = new Graph();
  const v1 = g.label('v');
  g.chain(['0:v'], [f('scale', 640, -2), { text: f('hflip'), ref: 'c2' }], [v1], 'c1');
  g.chain([v1, '1:v'], [f('overlay', 10, 10)], ['tmp'], 'o1');
  g.relabel('tmp', 'vout');
  eq('graph text', g.text(), '[0:v]scale=640:-2,hflip[v1];[v1][1:v]overlay=10:10[vout]');
  eq('graph pieces', g.pieces(), [{ text: '[0:v]scale=640:-2,', ref: 'c1' }, { text: 'hflip[v1];', ref: 'c2' }, { text: '[v1][1:v]overlay=10:10[vout]', ref: 'o1' }]);
  eq('graph parses', parseGraph(g.text()).map((c) => [c.ins, c.filters.map((x) => x.name), c.outs]), [[['0:v'], ['scale', 'hflip'], ['v1']], [['v1', '1:v'], ['overlay'], ['vout']]]);
  eq('labels counted per prefix', [g.label('v'), g.label('a'), g.label('v')], ['v2', 'a1', 'v3']);
  throws('parser rejects junk', () => parseGraph('[a]scale=1:2[b] x'));
  eq('check ok', checkGraph(parseGraph(g.text()), { inputs: 2, outputs: ['vout'] }), []);
  eq('check problems', checkGraph(parseGraph('[0:v]null[a];[a]null[b];[a][3:v]overlay[c]'), { inputs: 2, outputs: ['vout'] }),
    ['input 3:v does not exist', 'label a consumed 2 times', 'label b consumed 0 times', 'label c consumed 0 times', 'output vout missing']);

  // Commands with references = cmdline's text.
  const graph = new Graph();
  graph.chain(['0:v'], [{ text: f('drawtext', { text: "It's \"quoted\" 50% & more", fontsize: 40 }), ref: 'o1' }], ['v'], 'o1');
  graph.chain(['v'], [{ text: f('fade', { t: 'in', st: 0, d: 1 }), ref: 'c1' }], ['vout'], 'c1');
  const argv = ['ffmpeg', ref('c1', '-ss', '1.5', '-t', '3', '-i', 'my clip.mp4'), ref('project', '-filter_complex', graph), ref('output', '-map', '[vout]'),
    ['-c:v', 'libx264'], ref('output', 'out file.mp4')];
  for (const shell of ['bash', 'cmd']) {
    for (const width of [0, 60]) {
      for (const batch of [false, true]) {
        const r = renderCommand(argv, shell, { width, batch });
        eq(`render = commandLine ${shell} w${width}${batch ? ' batch' : ''}`, r.text, commandLine(plainArgv(argv), shell, { width, batch }));
        eq(`pieces join ${shell} w${width}`, r.pieces.map((p) => p.text).join(''), r.text);
      }
    }
    const r = renderCommand(argv, shell, {});
    const o1 = r.pieces.filter((p) => p.ref === 'o1').map((p) => p.text).join('');
    eq(`o1 piece has drawtext (${shell})`, /drawtext=/.test(o1) && !/fade=/.test(o1), true);
    eq(`c1 pieces (${shell})`, r.pieces.filter((p) => p.ref === 'c1').map((p) => p.text).join('|').includes('my clip.mp4') && r.pieces.some((p) => p.ref === 'c1' && /fade=t=in/.test(p.text)), true);
  }
  const steps = [{ comment: 'first', argv: ['ffmpeg', '-i', 'a.mp4', 'b.mp4'], ref: 'c1' }, { argv: argv }];
  for (const shell of ['bash', 'cmd']) {
    eq(`script = cmdline script (${shell})`, renderScript(steps, shell, { width: 70 }).text, script(steps.map((s) => ({ comment: s.comment, argv: plainArgv(s.argv) })), shell, { width: 70 }));
  }
  // A -vf graph that needs no quoting stays bare.
  const simple = new Graph();
  simple.chain([], [f('hflip')], [], 'c1');
  eq('bare -vf', renderCommand(['ffmpeg', ['-vf', simple]], 'bash').text, 'ffmpeg -vf hflip');

  // Codecs.
  eq('bitrate', [bitrate(6e6), bitrate(2.5e6), bitrate(800000), bitrate(192000)], ['6M', '2.5M', '800k', '192k']);
  eq('h264', encodeArgs('mp4-h264', { quality: 'high' }), [['-c:v', 'libx264'], ['-preset', 'medium'], ['-crf', '18'], ['-pix_fmt', 'yuv420p'], ['-c:a', 'aac'], ['-b:a', '192k'], ['-movflags', '+faststart']]);
  eq('vp9 bitrate', encodeArgs('webm-vp9', { videoBitrate: 4e6, audio: false }), [['-c:v', 'libvpx-vp9'], ['-b:v', '4M'], ['-row-mt', '1'], ['-pix_fmt', 'yuv420p'], '-an']);
  eq('vp8 crf caps', encodeArgs('webm-vp8', {})[1], ['-crf', '16', '-b:v', '8M']);

  // Real shells: the graph the program receives parses back to the original values.
  for (const shell of ['bash', 'cmd']) {
    if (!shellRuns(shell)) { console.log(`ffcmd: ${shell} not available, round trips skipped`); continue; }
    const r = renderCommand(argv, shell, { width: shell === 'cmd' ? 0 : 60 });
    const args = received(r.text, shell);
    const gi = args.indexOf('-filter_complex');
    eq(`${shell}: arguments`, args.slice(0, gi), ['-ss', '1.5', '-t', '3', '-i', 'my clip.mp4']);
    const parsed = parseGraph(args[gi + 1]);
    eq(`${shell}: drawtext text`, parsed[0].filters[0].opts.find((o) => o[0] === 'text')[1], "It's \"quoted\" 50% & more");
    eq(`${shell}: tail`, args.slice(gi + 2), ['-map', '[vout]', '-c:v', 'libx264', 'out file.mp4']);
  }

  console.log(`ffcmd: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
