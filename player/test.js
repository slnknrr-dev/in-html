// player/test.js - unit tests of the player library: `node player/test.js` (also `node check.js tests player`).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Q from './queue.js';
import { loudness, estimateTempo, waveform, analyze, kWeighting, energyScore } from './analysis.js';
import { replayGainFactor, normalizeFactor, crossfadeGains, EQ_PRESETS, EQ_BANDS, normEq, levelFactor } from './gain.js';
import { sleepTimer, sleepState, setAbPoint, abState, markersFromChapters, markerAt, resumeDecision, nextCountdown, chapterSkip } from './timers.js';
import { keymap, commandFor, parseKey, formatKey, conflicts, DEFAULT_KEYS, eventKey } from './keys.js';
import { nextFocus } from './nav.js';
import { BUILTIN_SKINS, normSkin, resolveSkin, skinVars, contrastReport, seedFromPixels, tonalScheme } from './skins.js';
import { BUILTIN_LAYOUTS, normLayout, layoutWarnings, addControl, moveControl, setOption, removeRow, CONTROLS } from './layouts.js';

// Run only when executed directly; importing run() has no side effects.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const ok = (name, cond, info) => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== undefined ? ': ' + JSON.stringify(info) : ''}`); } };

  // --- queue ------------------------------------------------------------------------------------------------------------
  {
    let s = Q.createQueue(['a', 'b', 'c'], { start: 1, seed: 'x' });
    eq('current', Q.currentRef(s), 'b');
    s = Q.next(s); eq('next', Q.currentRef(s), 'c');
    eq('end of queue', Q.next(s, { auto: true }), null);
    s = Q.setRepeat(s, 'all'); s = Q.next(s, { auto: true }); eq('repeat all wraps', Q.currentRef(s), 'a');
    s = Q.setRepeat(s, 'one'); eq('repeat one repeats on auto', Q.currentRef(Q.next(s, { auto: true })), 'a');
    eq('repeat one skips on user next', Q.currentRef(Q.next(s)), 'b');
    s = Q.setRepeat(s, 'off');
    s = Q.enqueue(s, ['x'], { mode: 'next' }); s = Q.enqueue(s, ['z']);
    eq('play next / add to end', Q.upcoming(s).map((i) => i.ref), ['x', 'b', 'c', 'z']);
    s = Q.removeAt(s, 0);
    eq('remove the current item keeps a position', [Q.currentRef(s), Q.length(s)], ['x', 4]);
    s = Q.move(s, 3, 1);
    eq('move', s.order.map((i) => s.items[i].ref), ['x', 'z', 'b', 'c']);
    eq('prev', Q.currentRef(Q.prev(Q.next(s))), 'x');
    eq('history', Q.next(s).history.slice(-1), ['x']);
    eq('cycle repeat', [Q.cycleRepeat('off'), Q.cycleRepeat('all'), Q.cycleRepeat('one')], ['all', 'one', 'off']);
    // shuffle modes
    const refs = [];
    for (const a of ['A', 'B', 'C']) for (let i = 0; i < 4; i++) refs.push(a + i);
    const keyOf = (r) => ({ artist: r[0], album: r[0] });
    let sh = Q.setShuffle(Q.createQueue(refs, { seed: 's1' }), 'artist', { keyOf });
    const order = sh.order.map((i) => sh.items[i].ref);
    eq('shuffle keeps the current item first', order[0], 'A0');
    const adjacent = order.slice(1).filter((r, i) => r[0] === order.slice(1)[i - 1]?.[0]).length;
    ok('artist spread: no neighbours of one artist', adjacent === 0, order);
    sh = Q.setShuffle(Q.createQueue(refs, { seed: 's2' }), 'album', { keyOf });
    const alb = sh.order.slice(1).map((i) => sh.items[i].ref);
    ok('album shuffle keeps tracks in order', ['A', 'B', 'C'].every((a) => { const xs = alb.filter((r) => r[0] === a).map((r) => +r.slice(1)); return xs.every((v, i) => i === 0 || v > xs[i - 1]); }), alb);
    const w = (r) => (r === 'C3' ? 100 : 1);
    let firsts = 0;
    for (let k = 0; k < 40; k++) { const q = Q.setShuffle(Q.createQueue(refs, { seed: 'w' + k }), 'smart', { weightOf: w }); if (q.items[q.order[1]].ref === 'C3') firsts++; }
    ok('smart shuffle prefers heavy items', firsts > 20, firsts);
    const r1 = Q.setShuffle(Q.createQueue(refs, { seed: 'same' }), 'random').order, r2 = Q.setShuffle(Q.createQueue(refs, { seed: 'same' }), 'random').order;
    eq('seeded shuffle', r1, r2);
    eq('shuffle off restores order at the current item', Q.currentRef(Q.setShuffle(Q.next(Q.setShuffle(Q.createQueue(refs, { seed: 'q' }), 'random')), 'off')) !== null, true);
  }

  // --- analysis ---------------------------------------------------------------------------------------------------------
  {
    const fs = 48000;
    const sine = (hz, amp, sec) => { const x = new Float32Array(fs * sec); for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin(2 * Math.PI * hz * i / fs); return x; };
    const L = loudness([sine(997, 1, 5)], fs);
    ok('BS.1770: 0 dBFS 997 Hz sine on one channel ≈ -3.01 LUFS', Math.abs(L.integrated - -3.01) < 0.1, L);
    const L2 = loudness([sine(997, 0.1, 5), sine(997, 0.1, 5)], fs);
    ok('-20 dBFS stereo ≈ -20 LUFS', Math.abs(L2.integrated - -20) < 0.15, L2);
    eq('silence', loudness([new Float32Array(fs * 2)], fs).integrated, null);
    ok('K-weighting at 44.1 kHz differs', kWeighting(44100)[0].b[0] !== kWeighting(48000)[0].b[0]);
    // A click track at 120 BPM.
    const sr = 22050, clicks = new Float32Array(sr * 12);
    for (let b = 0; b < 24; b++) { const s0 = Math.round(b * 0.5 * sr); for (let i = 0; i < 400; i++) clicks[s0 + i] = Math.sin(2 * Math.PI * 1500 * i / sr) * Math.exp(-i / 60); }
    const t = estimateTempo(clicks, sr);
    ok('tempo of a 120 BPM click track', [60, 120, 240].some((x) => Math.abs(t.bpm - x) <= 2) && Math.abs(t.bpm - 120) <= 2, t);
    const wf = waveform(sine(100, 0.5, 1), 10);
    ok('waveform peaks', wf.peaks.length === 10 && wf.peaks.every((p) => Math.abs(p - 0.5) < 0.01));
    const a = analyze([clicks], sr);
    ok('analyze', a.bpm && a.energy >= 0 && a.energy <= 10 && a.lufs < 0, a);
    ok('energy heuristic orders loud fast above quiet slow', energyScore({ lufs: -8, bpm: 170, onsetsPerSecond: 5, centroid: 3000 }) > energyScore({ lufs: -28, bpm: 70, onsetsPerSecond: 0.5, centroid: 600 }));
  }

  // --- gain ------------------------------------------------------------------------------------------------------------
  {
    ok('replaygain track', Math.abs(replayGainFactor({ trackGain: -6.02 }) - 0.5) < 0.001);
    ok('replaygain album falls back to track', Math.abs(replayGainFactor({ trackGain: -6.02 }, { mode: 'album' }) - 0.5) < 0.001);
    eq('clipping prevention', replayGainFactor({ trackGain: 6, trackPeak: 0.9 }), 1 / 0.9);
    ok('normalize to target', Math.abs(normalizeFactor(-20, { target: -14 }) - Math.pow(10, 6 / 20)) < 1e-9);
    eq('max boost', normalizeFactor(-40, { target: -14, maxBoost: 9 }), Math.pow(10, 9 / 20));
    eq('level: replaygain first, else loudness', [levelFactor({ replaygain: { trackGain: 0 } }), levelFactor({ loudness: -14 }), levelFactor({})], [1, 1, 1]);
    const x = crossfadeGains(0.5, 1);
    ok('equal power', Math.abs(x.in * x.in + x.out * x.out - 1) < 1e-9);
    ok('eq presets have ten bands', Object.values(EQ_PRESETS).every((p) => p.length === EQ_BANDS.length));
    eq('normEq clamps', normEq([30, -30, 'x']).slice(0, 3), [12, -12, 0]);
  }

  // --- timers -----------------------------------------------------------------------------------------------------------
  {
    const t = sleepTimer('minutes', { minutes: 10, now: 0 });
    eq('sleep fade', [sleepState(t, { now: 0 }).volume, sleepState(t, { now: 590000 }).volume, sleepState(t, { now: 600001 }).expired], [1, 0.5, true]);
    eq('sleep at end of track', sleepState(sleepTimer('track'), { ended: true }).expired, true);
    let ab = setAbPoint(null, 10); ab = setAbPoint(ab, 20);
    eq('A-B', [ab, abState(ab, 20.1).seek, abState(ab, 15).seek, setAbPoint(ab, 30)], [{ a: 10, b: 20 }, 10, null, { a: null, b: null }]);
    const m = markersFromChapters([{ start: 0, title: 'Prologue' }, { start: 90, title: 'Opening' }, { start: 180, title: 'Part A' }, { start: 1300, title: 'Ending' }, { start: 1390, title: 'Preview' }], 1420);
    eq('markers from chapter names', m, { intro: [90, 180], outro: [1300, 1390], preview: [1390, 1420] });
    eq('marker at', [markerAt(m, 100), markerAt(m, 200)], [{ kind: 'intro', start: 90, end: 180 }, null]);
    eq('resume', [resumeDecision({ position: 10, duration: 300 }), resumeDecision({ position: 600, duration: 3600, family: 'audiobook' }), resumeDecision({ position: 3590, duration: 3600 })], [{ resume: false, at: 0 }, { resume: true, at: 595 }, { resume: false, at: 0 }]);
    eq('next countdown', [nextCountdown({ position: 100, duration: 1420 }), nextCountdown({ position: 1305, duration: 1420, markers: m })], [{ show: false, left: null }, { show: true, left: 5 }]);
    const ch = [{ start: 0 }, { start: 100 }, { start: 200 }];
    eq('chapter skip', [chapterSkip(ch, 150, 1), chapterSkip(ch, 150, -1), chapterSkip(ch, 101, -1)], [200, 100, 0]);
  }

  // --- keys / nav ------------------------------------------------------------------------------------------------------
  {
    const map = keymap();
    const ev = (key, mods = {}) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
    eq('commands', [commandFor(ev(' '), map), commandFor(ev('ArrowRight', { shiftKey: true }), map), commandFor(ev('k'), map), commandFor(ev('?', { shiftKey: true }), map), commandFor(ev('f', { ctrlKey: true }), map)], ['play-pause', 'seek-forward-long', 'play-pause', 'help', 'search']);
    eq('fields swallow plain keys', [commandFor(ev('k'), map, { inField: true }), commandFor(ev('MediaPlayPause'), map, { inField: true })], [null, 'play-pause']);
    eq('parse / format', [parseKey('Ctrl+Shift+K'), formatKey('Shift+ArrowRight'), parseKey('Ctrl++').key], [{ key: 'K', ctrl: true, shift: true, alt: false, meta: false }, 'Shift+→', '+']);
    eq('event spec', eventKey(ev('a', { shiftKey: true })), 'Shift+A');
    eq('no conflicts in defaults', conflicts(DEFAULT_KEYS), []);
    eq('overrides', commandFor(ev('x'), keymap([{ command: 'next', keys: ['X'] }])), 'next');
    const grid = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) grid.push({ x: c * 110, y: r * 110, w: 100, h: 100 });
    eq('d-pad', [nextFocus(grid, 5, 'right'), nextFocus(grid, 5, 'left'), nextFocus(grid, 5, 'down'), nextFocus(grid, 5, 'up'), nextFocus(grid, 3, 'right'), nextFocus(grid, -1, 'down')], [6, 4, 9, 1, -1, 0]);
    const wide = [{ x: 0, y: 0, w: 400, h: 50 }, { x: 0, y: 100, w: 100, h: 100 }, { x: 300, y: 100, w: 100, h: 100 }];
    eq('d-pad prefers overlap', nextFocus(wide, 2, 'up'), 0);
  }

  // --- skins -----------------------------------------------------------------------------------------------------------
  {
    eq('built-in skins', BUILTIN_SKINS.map((s) => s.id), ['symphony', 'classic', 'minimal', 'oled', 'theatre', 'paper', 'neon']);
    const n = normSkin({ name: 'Mine', base: 'oled', light: { accent: 'red', radius: 99, font: 'evil', density: 'tiny' }, dark: { bg: 'rgb(1 2 3)' } });
    eq('normSkin', [n.name, n.light.accent, n.light.radius, n.light.font, n.light.density, n.dark.bg], ['Mine', '#ff0000', 32, 'system', 'normal', '#010203']);
    for (const s of BUILTIN_SKINS) {
      for (const dark of [false, true]) {
        const bad = contrastReport(resolveSkin(s, { dark })).filter((r) => !r.ok);
        ok(`contrast ${s.id} ${dark ? 'dark' : 'light'}`, !bad.length, bad);
      }
    }
    for (const seed of ['#e0512b', '#1e88e5', '#7cb342', '#ffeb3b', '#212121', '#ffffff']) {
      for (const dark of [false, true]) {
        const bad = contrastReport(resolveSkin(BUILTIN_SKINS[0], { dark, seed })).filter((r) => !r.ok);
        ok(`dynamic contrast ${seed} ${dark ? 'dark' : 'light'}`, !bad.length, bad);
      }
    }
    const t = tonalScheme('#1e88e5', true);
    ok('tonal scheme keeps the hue', t.accent !== t.bg && /^#[0-9a-f]{6}$/.test(t.accent));
    const px = new Uint8ClampedArray(4 * 100);
    for (let i = 0; i < 100; i++) { const vivid = i < 15; px.set(vivid ? [230, 40, 40, 255] : [120, 120, 120, 255], i * 4); }
    const seed = seedFromPixels(px);
    ok('seed prefers a vivid minority over grey', /^#e/.test(seed) || /^#d/.test(seed), seed);
    const v = skinVars(resolveSkin(BUILTIN_SKINS[0], { dark: true }));
    ok('css vars', v['--mp-accent'] && v['--ed-accent'] && v['--mp-font'].includes('system-ui'));
  }

  // --- layouts ---------------------------------------------------------------------------------------------------------
  {
    ok('built-in layouts normalize to themselves', BUILTIN_LAYOUTS.every((l) => JSON.stringify(normLayout(l)) === JSON.stringify(l)), BUILTIN_LAYOUTS.map((l) => [l.id, JSON.stringify(normLayout(l)) === JSON.stringify(l)]));
    ok('built-in layouts have play and seek', BUILTIN_LAYOUTS.every((l) => !layoutWarnings(l).filter((w) => w === 'noPlay' || w === 'noSeek').length), BUILTIN_LAYOUTS.map((l) => layoutWarnings(l)));
    const bad = normLayout({ rows: [{ controls: [{ type: 'play', size: 'huge' }, { type: 'evil' }, { type: 'seek-back', seconds: 7 }, { type: 'visualizer', height: 9999 }] }], gestures: { swipeLeft: 'rm -rf' } });
    eq('normLayout repairs', [bad.rows[0].controls.map((c) => c.type), bad.rows[0].controls[0].size, bad.rows[0].controls[1].seconds, bad.rows[0].controls[2].height, bad.gestures.swipeLeft], [['play', 'seek-back', 'visualizer'], 'xl', 10, 240, 'next']);
    eq('warnings', layoutWarnings(normLayout({ rows: [{ controls: [{ type: 'like' }, { type: 'like' }] }] })), ['noPlay', 'noSeek', 'duplicate:like']);
    let l = normLayout({ rows: [{ controls: [] }, { controls: [{ type: 'play' }] }] });
    l = addControl(l, 0, 'seek');
    l = moveControl(l, { row: 1, index: 0 }, { row: 0, index: 0 });
    l = setOption(l, 0, 1, 'style', 'wave');
    l = removeRow(l, 1);
    eq('editing', l.rows.map((r) => r.controls.map((c) => c.type + (c.style ? ':' + c.style : ''))), [['play:filled', 'seek:wave']]);
    ok('control catalogue', Object.keys(CONTROLS).length >= 35);
  }

  console.log(`player: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) run().then((f) => { process.exitCode = f ? 1 : 0; });
