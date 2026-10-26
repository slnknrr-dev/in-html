// img2ascii-app/controls.js - the settings panel: source, characters, tone and colour cards.
// Pattern: build once from the state, then refresh() toggles visibility, labels and disabled states. Controls never
// re-render themselves on change: a slider being dragged must not be replaced mid-drag. Every control writes through
// api.update(patch); this module holds no state of its own. Stable ids (asc-*) are hooks for tests and labels.
import { button, card, colorInput, field, range, seg, select, textInput, toggle } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { RAMP_IDS, rampSample } from '../ascii/ramps.js';

// Linear ramps map brightness to one glyph per cell; braille (2x4 dots) and half blocks (2 pixels) encode sub-cell
// structure, so edge glyphs (/ \ | -) make no sense for them.
const LINEAR = (ramp) => ramp !== 'braille' && ramp !== 'half';
// Puts the id on the actual form element inside a composite control, so a field's <label for> reaches it.
const withId = (ctl, id) => { (ctl.matches('input, select, textarea') ? ctl : ctl.querySelector('input, select, textarea')).id = id; return ctl; };

// Ramp tiles: native radio buttons (arrow keys move between them) with a live glyph strip of each ramp.
function rampPicker(s, onPick) {
  const g = h('div', { class: 'asc-ramps', role: 'radiogroup', 'aria-label': t('asc.ramp') });
  const tiles = {};
  for (const id of RAMP_IDS) {
    const inp = h('input', { type: 'radio', name: 'asc-ramp', value: id, checked: s.ramp === id, class: 'asc-ramp-in' });
    inp.addEventListener('change', () => { if (inp.checked) onPick(id); });
    const strip = h('span', { class: 'asc-ramp-g', 'aria-hidden': 'true' }, rampSample(id, s.chars, s.order));
    const tile = h('label', { class: 'asc-ramp' + (s.ramp === id ? ' asc-on' : ''), dataset: { ramp: id } }, inp, strip, h('span', { class: 'asc-ramp-n' }, t('asc.ramp.' + id)));
    tiles[id] = { tile, strip };
    g.append(tile);
  }
  return { el: g, tiles };
}

/**
 * Builds the panel from the current state. api: update(patch), sourceTab(tab), useSample(), camToggle(),
 * camFreeze(), reset(). keep: long-lived elements re-attached on every build (drop zone, thumbnail, camera box).
 * Returns { cards, refresh() } — refresh() syncs visibility and labels that depend on the state.
 */
export function buildControls(S, api, keep) {
  const s = S.set;

  // Source
  const srcSeg = seg([{ v: 'image', l: 'asc.src.image', icon: 'image' }, { v: 'camera', l: 'asc.src.camera', icon: 'camera' }],
    s.srcTab, (v) => api.sourceTab(v), 'asc.source');
  srcSeg.id = 'asc-srctab';
  srcSeg.classList.add('asc-wide');
  const imagePane = h('div', { class: 'asc-pane' },
    keep.drop,
    h('div', { class: 'asc-src' }, keep.thumb, h('div', { class: 'asc-src-meta' }, keep.srcName, keep.srcSize),
      button('asc.sample', 'sparkle', api.useSample, 'sm')),
    h('p', { class: 'ed-hint' }, t('asc.pasteHint')));
  const camBtn = button('asc.cam.start', 'camera', api.camToggle, 'primary');
  camBtn.id = 'asc-cam';
  const freezeBtn = button('asc.cam.freeze', 'pause', api.camFreeze);
  freezeBtn.id = 'asc-freeze';
  const camPane = h('div', { class: 'asc-pane' },
    keep.camBox,
    h('div', { class: 'ap-row asc-cam-row' }, camBtn, freezeBtn),
    field('asc.cam.mirror', withId(toggle(s.mirror, (v) => api.update({ mirror: v })), 'asc-mirror')),
    h('p', { class: 'ed-hint' }, t('asc.cam.hint')));

  // Characters
  // Braille dots are on / off: without dithering every mid-tone vanishes, so picking braille turns it on.
  const picker = rampPicker(s, (id) => api.update(id === 'braille' && s.dither === 'none' ? { ramp: id, dither: 'fs' } : { ramp: id }));
  const customIn = textInput(s.chars, (v) => api.update({ chars: v }), { placeholder: t('asc.customPh'), id: 'asc-custom', class: 'ed-input asc-mono-in', maxlength: '200' });
  const customBox = h('div', { class: 'asc-sub' },
    field('asc.custom', customIn),
    field('asc.order', withId(select(['auto', 'dense', 'sparse'].map((v) => ({ v, l: 'asc.order.' + v })), s.order, (v) => api.update({ order: v })), 'asc-order')));
  const rampHint = h('p', { class: 'ed-hint asc-ramp-hint' });
  const cols = field('asc.columns', withId(range({ min: 20, max: 400, step: 1, value: s.columns, onInput: (v) => api.update({ columns: v }) }), 'asc-columns'));
  const aspect = field('asc.aspect', withId(range({ min: 1, max: 3, step: 0.05, value: s.aspect, onInput: (v) => api.update({ aspect: v }) }), 'asc-aspect'), 'asc.aspectHint');

  // Tone
  const slider = (key, id, min, max, step, unit = '') => field('asc.' + key, withId(range({ min, max, step, value: s[key], unit, onInput: (v) => api.update({ [key]: v }) }), id));
  const edgeToggle = withId(toggle(s.edgeGlyphs, (v) => api.update({ edgeGlyphs: v })), 'asc-edgeglyphs');
  const edgeGlyphs = field('asc.edgeGlyphs', edgeToggle, 'asc.edgeHint');
  const threshold = slider('edgeThreshold', 'asc-edgethr', 5, 90, 1, '%');
  const ditherSel = withId(select(['none', 'fs', 'bayer4', 'bayer8'].map((v) => ({ v, l: 'asc.dither.' + v })), s.dither, (v) => api.update({ dither: v })), 'asc-dither');
  const dither = field('asc.dither', ditherSel);

  // Colour
  const modeSeg = seg(['mono', 'ansi16', 'ansi256', 'truecolor', 'html'].map((v) => ({ v, l: 'asc.mode.' + v })), s.color, (v) => api.update({ color: v }), 'asc.mode');
  modeSeg.id = 'asc-mode';
  modeSeg.classList.add('asc-wide');
  const modeHint = h('p', { class: 'ed-hint' });
  const targetSeg = seg([{ v: 'fg', l: 'asc.target.fg' }, { v: 'bg', l: 'asc.target.bg' }], s.target, (v) => api.update({ target: v }), 'asc.target');
  targetSeg.id = 'asc-target';
  targetSeg.classList.add('asc-wide');
  // A <span> label, not <label>: a segmented control is a radiogroup with its own aria-label, not a form element.
  const target = h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('asc.target')), targetSeg);
  const vivid = slider('vivid', 'asc-vivid', 0, 100, 1, '%');
  const bgSeg = seg(['auto', 'dark', 'light', 'custom'].map((v) => ({ v, l: 'asc.bgc.' + v })), s.bgMode, (v) => api.update({ bgMode: v }), 'asc.bgc');
  bgSeg.id = 'asc-bgmode';
  bgSeg.classList.add('asc-wide');
  const bgPick = colorInput(s.bgCustom, (v) => api.update({ bgCustom: v }));
  bgPick.id = 'asc-bgpick';
  bgPick.setAttribute('aria-label', t('asc.bgcPick'));
  bgPick.title = t('asc.bgcPick');

  const cards = [
    card('asc.source', srcSeg, imagePane, camPane),
    card('asc.chars', picker.el, rampHint, customBox, cols, aspect),
    card('asc.tone',
      slider('brightness', 'asc-bright', -100, 100, 1), slider('contrast', 'asc-contrast', -100, 100, 1), slider('gamma', 'asc-gamma', 0.2, 3, 0.05),
      h('div', { class: 'asc-toggles' }, field('asc.invert', withId(toggle(s.invert, (v) => api.update({ invert: v })), 'asc-invert')),
        field('asc.levels', withId(toggle(s.autoLevels, (v) => api.update({ autoLevels: v })), 'asc-levels'))),
      dither, slider('edges', 'asc-edges', 0, 100, 1, '%'), edgeGlyphs, threshold),
    card('asc.color',
      h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('asc.mode')), modeSeg), modeHint, target, vivid,
      h('div', { class: 'ed-field' }, h('span', { class: 'ed-label' }, t('asc.bgc')), h('div', { class: 'asc-bgrow' }, bgSeg, bgPick))),
    h('div', { class: 'asc-side-foot' }, button('asc.reset', 'refresh', api.reset, 'sm')),
  ];

  // Dependent visibility: options irrelevant to the current choice are hidden (custom chars only for the custom
  // ramp, colour target not for mono or half blocks, vivid only for foreground colour), so the panel never offers a
  // control that has no effect. The dither select is synced because picking braille may switch dithering on.
  function refresh() {
    imagePane.hidden = s.srcTab !== 'image';
    camPane.hidden = s.srcTab !== 'camera';
    const cam = S.cam;
    camBtn.lastChild.textContent = t(cam.live ? 'asc.cam.stop' : 'asc.cam.start');
    camBtn.classList.toggle('ed-primary', !cam.live);
    freezeBtn.disabled = !cam.live;
    freezeBtn.lastChild.textContent = t(cam.frozen ? 'asc.cam.resume' : 'asc.cam.freeze');
    for (const [id, { tile }] of Object.entries(picker.tiles)) tile.classList.toggle('asc-on', id === s.ramp);
    picker.tiles.custom.strip.textContent = rampSample('custom', s.chars, s.order);
    customBox.hidden = s.ramp !== 'custom';
    if (ditherSel.value !== s.dither) ditherSel.value = s.dither;
    rampHint.textContent = s.ramp === 'braille' ? t('asc.hint.braille') : s.ramp === 'half' ? t('asc.hint.half') : '';
    rampHint.hidden = !rampHint.textContent;
    edgeToggle.disabled = !LINEAR(s.ramp);
    edgeGlyphs.classList.toggle('asc-dim', !LINEAR(s.ramp));
    threshold.hidden = !s.edgeGlyphs || !LINEAR(s.ramp);
    modeHint.textContent = t('asc.modeHint.' + s.color);
    target.hidden = s.color === 'mono' || s.ramp === 'half';
    vivid.hidden = target.hidden || s.target !== 'fg';
    bgPick.hidden = s.bgMode !== 'custom';
  }
  refresh();
  return { cards, refresh };
}
