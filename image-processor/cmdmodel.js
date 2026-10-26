// image-processor/cmdmodel.js - the model of the Transform command card (photo/cmdview.js): the selected
// image's command, or the batch loops over every image that follows the shared settings, with localized step labels,
// fidelity notes and remarks (own settings, colliding names, overwriting the original).

import { quote } from '../cmdline/quote.js';
import { t } from '../ui/app.js';
import { batchScript, fidelityOf, outputExt, patternsOf, singleCommand, transformSteps } from './commands.js';
import { outputFormat, outputName } from './pipeline.js';

// Localized label of a step ({part} placeholders inside the vars are names of colour operations).
// Step labels arrive as [i18n key, vars] from commands.js so the command text itself stays language-neutral; only
// the human labels are translated here.
function label(step) {
  const [key, vars] = step.label;
  const v = { ...vars };
  if (typeof v.parts === 'string') v.parts = v.parts.replace(/\{(\w+)\}/g, (m, p) => t('ip.step.' + p + 'Name'));
  return t(key, v);
}

const noteText = (key) => (key ? t('cmd.note.' + key) : '');
const argsText = (step, shell) => step.args.map((g) => g.map((a) => quote(a, shell)).join(' ')).join(' ');

const display = (steps, shell) => steps.map((s) => ({ id: s.id, section: s.section, fidelity: s.fidelity, label: label(s), note: noteText(s.note), argsText: argsText(s, shell) }));

/**
 * ctx: { items, sel (item), settingsOf(item), global, scope ('image' | 'batch'), shell, wrap, bat }
 * -> { segments, steps, notes, batch, title } for createCommandView().render
 */
// Two scopes: the selected image (one exact command) or a batch script for every image following the shared
// settings, with one loop per output format because the file extension selects the encoder. Notes warn about
// overwriting the original (same output name) and about output name clashes (two inputs mapping to one output).
export function commandModel(ctx) {
  const { items, sel, shell, wrap } = ctx;
  if (!items.length) return { segments: [], steps: [], title: t('cmd.title') };
  if (ctx.scope === 'image' && sel) {
    const s = ctx.settingsOf(sel);
    const m = sel.meta || {};
    const info = { name: sel.name, kind: m.kind || 'unknown', width: m.width || 0, height: m.height || 0, orientation: m.orientation || 1 };
    const { steps, format } = transformSteps(s, info);
    const { ext, prefix } = outputExt(format, s);
    const output = outputName(sel.name, s, ext);
    const notes = [];
    if (output.toLowerCase() === sel.name.toLowerCase()) notes.push({ icon: 'warn', text: t('ip.cmdSameName') });
    if (!m.width) notes.push({ icon: 'info', text: t('ip.cmdNoSize') });
    if (format === 'webp') notes.push({ icon: 'info', text: t('ip.cmdWebp') });
    return { segments: singleCommand(steps, { input: sel.name, output, prefix }, shell, { wrap }), steps: display(steps, shell), notes, batch: false, title: t('ip.cmdTitleImage'), fidelity: fidelityOf(steps) };
  }
  // batch: every image without its own settings, one loop per output format (the extension decides the encoder)
  const s = ctx.global;
  const shared = items.filter((it) => !it.own);
  const own = items.length - shared.length;
  const notes = [{ icon: 'folder', text: t('ip.cmdFolder', { folder: 'images' }) }];
  if (own) notes.push({ icon: 'info', text: t('ip.cmdOwn', { n: own }) });
  if (!shared.length) return { segments: [], steps: [], notes, batch: true, title: t('ip.cmdTitleBatch'), empty: t('ip.cmdAllOwn') };
  const byFormat = new Map();
  for (const it of shared) {
    const kind = (it.meta && it.meta.kind) || 'unknown';
    const f = outputFormat(s, kind);
    if (!byFormat.has(f)) byFormat.set(f, { names: [], kinds: new Set() });
    byFormat.get(f).names.push(it.name);
    byFormat.get(f).kinds.add(kind);
  }
  // one step list for the card: the pixel steps (the same in every loop) and each loop's output steps
  const groups = [], all = [];
  for (const [, g] of byFormat) {
    const { steps, format } = transformSteps(s, null, { kinds: [...g.kinds] });
    const map = steps.map((st, i) => {
      if (st.section !== 'output' && all.length && all[i] && all[i].id === st.id) return i;
      all.push(st);
      return all.length - 1;
    });
    groups.push({ patterns: patternsOf(g.names, shell), steps, map, ...outputExt(format, s) });
  }
  const segs = batchScript(groups.map((g) => ({ ...g, steps: g.steps })), shell, { wrap, bat: shell === 'cmd' && ctx.bat, folder: 'images', suffix: s.output.suffix });
  // Assumption of the remap: within one loop, segment step indexes never decrease, so a non-increasing index marks
  // the start of the next loop.
  // remap step indexes of the loops to the merged list (segments are emitted loop by loop, in order)
  let gi = -1, last = Infinity;
  for (const sg of segs) {
    if (sg.step == null) continue;
    if (sg.step <= last) gi++;
    last = sg.step;
    sg.step = groups[gi].map[sg.step];
  }
  const names = new Map();
  for (const it of shared) {
    const f = outputFormat(s, (it.meta && it.meta.kind) || 'unknown');
    const n = outputName(it.name, s, outputExt(f, s).ext).toLowerCase();
    names.set(n, (names.get(n) || 0) + 1);
  }
  const clashes = [...names.values()].filter((c) => c > 1).length;
  if (clashes) notes.push({ icon: 'warn', text: t('ip.cmdClash', { n: clashes }) });
  if (shell === 'cmd' && ctx.bat) notes.push({ icon: 'info', text: t('ip.cmdBat') });
  else if (shell === 'cmd') notes.push({ icon: 'info', text: t('ip.cmdWindow') });
  return { segments: segs, steps: display(all, shell), notes, batch: true, title: t('ip.cmdTitleBatch', { n: shared.length }), fidelity: fidelityOf(all) };
}
