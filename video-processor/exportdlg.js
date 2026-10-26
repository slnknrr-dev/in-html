// video-processor/exportdlg.js - the export dialog: video (format, resolution, frame rate, quality or bit
// rate, sound) through WebCodecs or the real-time fallback, audio (WAV / MP3 / Ogg Opus / WebM), the current frame
// (PNG / JPEG); progress and cancel. The same settings drive the encoder options of the ffmpeg description.
//
// The dialog edits app.out() in place (persisted by app.outChanged) so the same settings feed both the real export
// and the ffmpeg command description. Only one export runs at a time (`busy` holds its AbortController); closing
// the dialog aborts it.
import { field, seg, select, toggle, toast } from '../ui/app.js';
import { h } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';
import { t } from '../ui/i18n.js';
import { downloadBlob, fmtBytes, safeFileName } from '../ui/files.js';
import { openDialog } from '../ui/overlays.js';
import { FPS, frameSize } from '../timeline/model.js';
import { exportAudio, exportVideo, targetBitrate } from './export.js';

export const SHORT = [2160, 1440, 1080, 720, 540, 480, 360];
// 0 = automatic (targetBitrate from resolution, fps, quality and codec efficiency).
const BITRATES = [0, 1e6, 2e6, 4e6, 6e6, 8e6, 12e6, 20e6, 40e6];
const AF = { wav: '=WAV · PCM 16-bit', mp3: '=MP3', opus: '=Ogg Opus', weba: '=WebM · Opus' };

export function openExport(app) {
  const caps = app.caps();
  const o = app.out();
  let busy = null, closeDlg = null;
  const body = h('div', { class: 'vp-exp' });
  // role=progressbar with aria-valuenow updated on every progress call; the text line is a polite live region so
  // screen readers hear the phase and percentage without focus moving.
  const prog = h('div', { class: 'ap-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, h('i'));
  const progText = h('span', { class: 'vp-prog-t', 'aria-live': 'polite' });
  const busyBox = h('div', { class: 'vp-busy', hidden: true }, h('div', { class: 'ap-row' }, progText, h('span', { class: 'ed-spacer' }),
    h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => busy?.abort() }, iconEl('close'), t('vp.cancel'))), prog);
  const progress = (f, phase) => {
    const p = Math.round(Math.min(1, Math.max(0, f)) * 100);
    prog.firstChild.style.width = p + '%';
    prog.setAttribute('aria-valuenow', String(p));
    progText.textContent = `${t('vp.phase.' + (phase || 'video'))} ${p}%`;
  };
  const baseName = () => safeFileName(app.p.name || 'video', 'video');
  const L = () => app.L;

  // Playback is paused first: the export drives its own decoding and must not compete with the preview elements.
  const run = async (kind) => {
    if (busy || L().total <= 0) return;
    const ac = new AbortController();
    busy = ac;
    app.pause();
    paint();
    progress(0, kind === 'video' ? 'video' : 'audio');
    try {
      let r, name;
      if (kind === 'video') {
        const fmt = caps.formats.find((f) => f.id === o.format);
        r = await exportVideo({ project: app.p, L: L(), store: app.store, compositor: app.comp, format: fmt, short: o.short, fps: o.fps || app.p.fps, quality: o.quality, bitrate: o.bitrate, audio: o.withAudio, signal: ac.signal, onProgress: progress });
        name = `${baseName()}.${fmt.ext}`;
        // The real-time fallback (MediaRecorder on a canvas stream) records sound only when the browser can capture
        // the mixed audio; warn instead of silently delivering a mute video.
        if (r.realtime && !r.audio && o.withAudio) toast(t('vp.noAudioRec'), 'warn');
      } else {
        r = await exportAudio({ project: app.p, L: L(), store: app.store, format: o.audio, mp3Bitrate: o.mp3, signal: ac.signal, onProgress: progress });
        name = `${baseName()}.${r.ext}`;
      }
      app.exported(r.blob, name);
      downloadBlob(r.blob, name);
      toast(t('vp.exported', { name, size: fmtBytes(r.blob.size) }), 'ok');
    } catch (e) {
      // Cancel is not an error: AbortError gets a neutral info toast.
      if (e && e.name === 'AbortError') toast(t('vp.canceled'), 'info');
      else toast(t('vp.exportErr', { msg: (e && e.message) || String(e) }), 'error');
    } finally {
      busy = null;
      if (body.isConnected) paint();
    }
  };

  // Rebuilt on every option change (cheap: a handful of fields). Format list comes from capability probing
  // (app.caps): only encoders this browser actually has are offered.
  const paint = () => {
    body.textContent = '';
    const dis = !!busy;
    busyBox.hidden = !busy;
    const size = frameSize(app.p.aspect, o.short);
    const hasV = app.L.total > 0;
    const hasA = app.hasAudio();
    // Video.
    const vsec = h('section', { class: 'vp-sec' }, h('h3', { class: 'vp-sec-h' }, iconEl('film'), t('vp.video')));
    if (caps.formats.length) {
      if (!caps.formats.some((f) => f.id === o.format)) o.format = caps.formats[0].id;
      const fmt = caps.formats.find((f) => f.id === o.format);
      const sizes = SHORT.map((s) => { const z = frameSize(app.p.aspect, s); return { v: s, l: `=${s}p · ${z.width} × ${z.height}` }; });
      const fpsSel = select([{ v: 0, l: '=' + t('vp.exp.projectFps', { fps: app.p.fps }) },...FPS.map((v) => ({ v, l: `=${v} fps` }))], o.fps, (v) => { o.fps = +v; app.outChanged(); });
      const br = select(BITRATES.map((v) => ({ v, l: v ? `=${v / 1e6} Mbit/s` : 'vp.exp.auto' })), o.bitrate, (v) => { o.bitrate = +v; app.outChanged(); paint(); });
      const go = h('button', { type: 'button', class: 'ed-btn ed-primary', disabled: dis || !hasV, onclick: () => run('video') }, iconEl('export'), t('vp.exportVideo'));
      const auto = targetBitrate(size.width, size.height, o.fps || app.p.fps, o.quality, fmt.video, o.bitrate);
      vsec.append(
        field('vp.format', select(caps.formats.map((f) => ({ v: f.id, l: f.label })), o.format, (v) => { o.format = v; app.outChanged(); paint(); })),
        h('div', { class: 'ed-grid2' }, field('vp.exp.resolution', select(sizes, o.short, (v) => { o.short = +v; app.outChanged(); paint(); })), field('vp.fps', fpsSel)),
        field('vp.quality', seg([{ v: 'low', l: 'vp.q.low' }, { v: 'med', l: 'vp.q.med' }, { v: 'high', l: 'vp.q.high' }], o.quality, (v) => { o.quality = v; app.outChanged(); paint(); }, 'vp.quality')),
        // Size estimate = (video bitrate + 160 kbps audio when included) / 8 * duration: an upper-bound guide, real
        // encoders undershoot on static content.
        field('vp.bitrate', br, '=' + t('vp.exp.estimate', { rate: (auto / 1e6).toFixed(1), size: fmtBytes(((auto + (hasA && o.withAudio ? 160000 : 0)) / 8) * app.L.total) })),
        field('vp.exp.withAudio', toggle(o.withAudio && hasA, (v) => { o.withAudio = v; app.outChanged(); })),
        h('div', { class: 'ap-actions' }, go));
      if (fmt.realtime) vsec.append(h('p', { class: 'ed-hint ed-hint-warn' }, t('vp.realtime')));
    } else vsec.append(h('p', { class: 'ed-hint ed-hint-warn' }, t('vp.noEncoder')));
    // Audio.
    if (!caps.audioFormats.includes(o.audio)) o.audio = 'mp3';
    const asec = h('section', { class: 'vp-sec' }, h('h3', { class: 'vp-sec-h' }, iconEl('wave'), t('vp.audio')));
    asec.append(h('div', { class: 'ed-grid2' }, field('vp.format', select(caps.audioFormats.map((v) => ({ v, l: AF[v] })), o.audio, (v) => { o.audio = v; paint(); })),
      o.audio === 'mp3' ? field('vp.bitrate', select([96, 128, 160, 192, 256, 320].map((v) => ({ v, l: `=${v} kbps` })), o.mp3, (v) => { o.mp3 = +v; })) : h('span')),
    h('div', { class: 'ap-actions' }, h('button', { type: 'button', class: 'ed-btn', disabled: dis || !hasA, onclick: () => run('audio') }, iconEl('download'), t('vp.exportAudio'))));
    if (!hasA) asec.append(h('p', { class: 'ed-hint' }, t('vp.noAudio')));
    // Frame.
    const fsec = h('section', { class: 'vp-sec' }, h('h3', { class: 'vp-sec-h' }, iconEl('camera'), t('vp.frame')),
      h('div', { class: 'ap-actions vp-mt0' },
        h('button', { type: 'button', class: 'ed-btn', disabled: dis || !hasV, onclick: () => app.grabFrame('image/png', o.short) }, iconEl('image'), 'PNG'),
        h('button', { type: 'button', class: 'ed-btn', disabled: dis || !hasV, onclick: () => app.grabFrame('image/jpeg', o.short) }, iconEl('image'), 'JPEG')));
    const cmd = h('button', { type: 'button', class: 'ed-btn ed-sm', onclick: () => { closeDlg?.(null); app.setMode('cmd'); } }, iconEl('terminal'), t('vp.exp.showCommand'));
    body.append(busyBox, vsec, asec, fsec, h('div', { class: 'vp-exp-foot' }, h('p', { class: 'ed-hint' }, t('vp.exp.hint')), cmd));
  };
  paint();
  openDialog({ title: t('vp.export'), body, className: 'vp-exp-dlg', buttons: [{ label: t('dlg.close'), value: null }], onMount: ({ close }) => { closeDlg = close; } })
    .then(() => { busy?.abort(); });
}
