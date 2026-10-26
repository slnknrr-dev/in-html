// media-player/jobs.js - the converter's jobs: validated parameters -> mediajobs specs (the same builders in the
// browser, which shows the commands to copy, and on the server, which runs them). The server never runs argv sent by
// a client: it rebuilds every job from these parameters, and inputs / outputs are paths inside mounts of the file API.
//
//   JOB_KINDS { kind: { tool, input: 'media' | 'work' | 'collection' | 'ref' | 'image', formats?, output } }
//   buildJob(kind, params, env) -> { spec, outputs: [{ path, role }], after: { … } }
//     env (server): { pathOf(media) -> abs | null, outPath(abs, ext, suffix, outDir) -> abs, work(id), media(id),
//                     facts(work), chapters(book) -> [{ path, title, duration }], downloads -> abs dir, tmp -> abs dir }
//     env (browser preview): the same with display paths (file names) instead of absolute paths
//   tagsOf(env, work) -> { title, artist, album, albumArtist, track, disc, year, genre, comment }
//   FORMATS_AUDIO, FORMATS_VIDEO, QUALITIES

import * as ff from '../mediajobs/ffmpeg.js';
import { probeJob } from '../mediajobs/ffprobe.js';
import { infoJob, downloadJob } from '../mediajobs/ytdlp.js';
import { coverJob, collageJob, convertJob } from '../mediajobs/magick.js';

// VALIDATION RULE: every client parameter passes a whitelist (oneOf) or a clamped number (num) before reaching a
// builder; anything else falls back to a default instead of erroring, so an old client never breaks a job. Paths
// never come from params as strings: media / work ids are looked up in the catalogue and resolved by env (mounts),
// and links must parse as http(s) source references (mediajobs/ytdlp.js resolve()), so a value starting with '-'
// can never be injected as a tool option.
export const FORMATS_AUDIO = ['mp3', 'opus', 'aac', 'm4a', 'flac', 'wav', 'ogg'];
export const FORMATS_VIDEO = ['mp4', 'webm', 'mkv'];
export const QUALITIES = ['low', 'med', 'high', 'lossless'];

export const JOB_KINDS = {
  convertAudio: { tool: 'ffmpeg', input: 'media', formats: FORMATS_AUDIO },
  convertVideo: { tool: 'ffmpeg', input: 'media', formats: FORMATS_VIDEO },
  remux: { tool: 'ffmpeg', input: 'media', formats: ['mp4', 'mkv', 'webm', 'm4a', 'mka'] },
  extractAudio: { tool: 'ffmpeg', input: 'media', formats: FORMATS_AUDIO },
  normalize: { tool: 'ffmpeg', input: 'media', formats: FORMATS_AUDIO },
  split: { tool: 'ffmpeg', input: 'media', formats: FORMATS_AUDIO },
  joinChapters: { tool: 'ffmpeg', input: 'work', formats: ['m4b', 'm4a', 'mka'] },
  embedMeta: { tool: 'ffmpeg', input: 'media' },
  probe: { tool: 'ffprobe', input: 'media' },
  frame: { tool: 'ffmpeg', input: 'media' },
  cover: { tool: 'magick', input: 'image' },
  collage: { tool: 'magick', input: 'collection' },
  ytdlpInfo: { tool: 'yt-dlp', input: 'ref' },
  ytdlpDownload: { tool: 'yt-dlp', input: 'ref', formats: ['best', 'video', 'audio'] },
};

const oneOf = (v, list, d) => (list.includes(v) ? v : d);
// Clamp, not reject: a bitrate of 9999 becomes 512. Number.isFinite(+v) also rejects NaN / Infinity / '' tricks.
const num = (v, d, lo, hi) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);

// Tags written into converted files come from the catalogue's facts (the user's edits), not from the source file,
// so a conversion also fixes metadata. Empty values are deleted so ffmpeg does not write empty tags over existing ones.
export function tagsOf(env, w) {
  if (!w) return {};
  const f = env.facts(w);
  const genre = [...f.tags].filter((t) => t.startsWith('genre:')).map((t) => t.slice(6).split('/').pop());
  const out = {
    title: f.title, artist: (f.artist.length ? f.artist : f.author).join(', ') || undefined, album: f.album || f.book || f.show || undefined,
    albumArtist: f.albumartist[0] || undefined, track: f.track || f.episode || undefined, disc: f.disc || undefined, year: f.year || undefined,
    genre: genre[0] || undefined, comment: w.description ? String(w.description).slice(0, 500) : undefined,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === '') delete out[k];
  return out;
}

function err(msg) { const e = new Error(msg); e.status = 400; return e; }

export function buildJob(kind, params = {}, env) {
  const def = JOB_KINDS[kind];
  if (!def) throw err('unknown job kind: ' + kind);
  const p = params || {};
  const media = p.media ? env.media(p.media) : null;
  const work = media ? env.work(media.work) : p.work ? env.work(p.work) : null;
  const input = def.input === 'media' ? env.pathOf(media) : null;
  if (def.input === 'media' && !input) throw err('the media has no file this server can read');
  const quality = oneOf(p.quality, QUALITIES, 'high');
  const segment = media && media.segment ? media.segment : null;
  // A CUE segment converts as just its window of the file; explicit start / end override it.
  const start = p.start != null ? num(p.start, 0, 0, 1e7) : segment ? segment.start : undefined;
  const end = p.end != null ? num(p.end, 0, 0, 1e7) : segment && segment.end ? segment.end : undefined;
  const duration = media && media.duration ? media.duration : undefined;
  const outputs = [];
  let spec;
  const after = { addVersion: !!p.addVersion, work: work ? work.id : null, media: media ? media.id : null };
  switch (kind) {
    case 'convertAudio': case 'extractAudio': case 'normalize': {
      const format = oneOf(p.format, FORMATS_AUDIO, 'mp3');
      // Raw .aac (ADTS) has no metadata or seek index; AAC goes into an MP4 container (.m4a) instead.
      const ext = format === 'aac' ? 'm4a' : format;
      const output = env.outPath(input, ext, p.suffix || (kind === 'normalize' ? 'normalized' : ''), p.outDir);
      const tags = p.tags === false ? undefined : tagsOf(env, work);
      if (kind === 'extractAudio') spec = ff.extractAudio({ input, output, copy: !!p.copy, format, duration });
      else if (kind === 'normalize') spec = ff.normalize({ input, output, target: { I: num(p.I, -16, -40, -5), TP: num(p.TP, -1.5, -9, 0), LRA: num(p.LRA, 11, 1, 30) }, format, duration });
      else spec = ff.convertAudio({ input, output, format, quality, bitrate: p.bitrate ? num(p.bitrate, 192, 32, 512) : undefined, tags, start, end, loudnorm: p.loudnorm ? { I: num(p.I, -16, -40, -5), TP: -1.5, LRA: 11 } : null, duration: end && start != null ? end - start : duration, cover: p.cover ? env.coverPath(work) || undefined : undefined });
      outputs.push({ path: output, role: 'media' });
      break;
    }
    case 'convertVideo': case 'remux': {
      const format = oneOf(p.format, kind === 'remux' ? JOB_KINDS.remux.formats : FORMATS_VIDEO, kind === 'remux' ? 'mkv' : 'mp4');
      const output = env.outPath(input, format, p.suffix || (kind === 'remux' ? 'remux' : ''), p.outDir);
      spec = kind === 'remux' ? ff.remux({ input, output, duration }) : ff.convertVideo({ input, output, format, quality, maxHeight: p.maxHeight ? num(p.maxHeight, 1080, 144, 4320) : undefined, audio: p.audio !== false, subtitles: oneOf(p.subtitles, ['copy', 'burn', 'none'], 'none'), start, end, duration });
      outputs.push({ path: output, role: 'media' });
      break;
    }
    case 'split': {
      const tracks = (env.segments(media) || []).map((t, i) => ({ number: t.number || i + 1, title: t.title, artist: t.artist, start: t.start, end: t.end }));
      if (!tracks.length) throw err('no CUE tracks or chapters to split by');
      const outDir = env.outDirOf(input, p.outDir, (work && env.facts(work).album) || 'split');
      spec = ff.splitTracks({ input, tracks, outDir, format: oneOf(p.format, FORMATS_AUDIO, 'flac'), copy: !!p.copy, album: work ? env.facts(work).album : undefined, albumArtist: work ? env.facts(work).albumartist[0] : undefined, year: work ? env.facts(work).year : undefined });
      for (const o of spec.outputs || []) outputs.push({ path: o, role: 'track' });
      break;
    }
    // Audiobook join: chapter files -> one .m4b with chapter marks, tags and cover; always added as a new version of the
    // book (after.addVersion) because it replaces many presences with one.
    case 'joinChapters': {
      const inputs = env.chapters(work);
      if (!inputs || inputs.length < 2) throw err('the book needs at least two chapter files');
      const format = oneOf(p.format, JOB_KINDS.joinChapters.formats, 'm4b');
      const output = env.outPath(inputs[0].path, format, 'book', p.outDir, (work && work.title) || 'book');
      spec = ff.joinChapters({ inputs, output, tags: tagsOf(env, work), cover: env.coverPath(work) || undefined, bitrate: p.bitrate ? num(p.bitrate, 64, 24, 320) : undefined });
      outputs.push({ path: output, role: 'media' });
      after.addVersion = true;
      break;
    }
    case 'embedMeta': {
      const output = env.outPath(input, null, 'tagged', p.outDir);
      spec = ff.embedMeta({ input, output, tags: tagsOf(env, work), cover: env.coverPath(work) || undefined, chapters: media.chapters && media.chapters.length ? media.chapters : undefined });
      outputs.push({ path: output, role: 'media' });
      break;
    }
    case 'probe': spec = probeJob(input); after.probe = true; break;
    case 'frame': {
      const output = env.tmpFile('frame-' + media.id + '.jpg');
      spec = ff.frame({ input, output, at: num(p.at, Math.min(60, (duration || 20) * 0.1), 0, 1e7), width: num(p.width, 640, 64, 3840) });
      outputs.push({ path: output, role: 'cover' });
      after.cover = work ? work.id : null;
      break;
    }
    case 'cover': {
      const src = p.blob ? env.blobPath(p.blob) : p.image ? env.resolve(p.image.mount, p.image.path) : null;
      if (!src) throw err('no picture to convert');
      const output = env.tmpFile('cover-' + Date.now().toString(36) + '.jpg');
      spec = coverJob({ input: src, output, size: num(p.size, 600, 64, 3000), format: 'jpg', fit: oneOf(p.fit, ['crop', 'pad', 'none'], 'crop') });
      outputs.push({ path: output, role: 'cover' });
      after.cover = p.target || null;
      break;
    }
    case 'collage': {
      const images = env.collageInputs(p.collection);
      if (!images.length) throw err('no covers in the collection');
      const output = env.tmpFile('collage-' + p.collection + '.jpg');
      spec = collageJob({ inputs: images.slice(0, 4), output, size: num(p.size, 600, 128, 3000) });
      outputs.push({ path: output, role: 'cover' });
      after.cover = p.collection;
      break;
    }
    case 'ytdlpInfo': {
      const ref = String(p.ref || (media && media.source && (media.source.url || media.source.ref)) || '');
      if (!ref) throw err('no link');
      spec = infoJob(ref, { flat: p.flat !== false });
      after.info = { sourceId: p.sourceId || null, media: media ? media.id : null };
      break;
    }
    case 'ytdlpDownload': {
      const ref = String(p.ref || (media && media.source && (media.source.url || media.source.ref)) || '');
      if (!ref) throw err('no link');
      const mode = oneOf(p.mode, JOB_KINDS.ytdlpDownload.formats, media && media.kind === 'video' ? 'video' : 'best');
      spec = downloadJob(ref, {
        outDir: p.outDir ? env.resolve(p.outDir.mount, p.outDir.path || '') : env.downloads, mode,
        audioFormat: oneOf(p.audioFormat, ['best', 'opus', 'mp3', 'm4a', 'flac'], 'best'), maxHeight: p.maxHeight ? num(p.maxHeight, 1080, 144, 4320) : undefined,
        subs: p.subs ? { langs: String(p.subs).split(/[,\s]+/).filter((x) => /^[a-zA-Z-]{2,10}$/.test(x)).slice(0, 8), auto: false, embed: false } : undefined,
        // Playlist item spec reduced to yt-dlp's own syntax characters (1,3-5,::2); subtitle languages are validated as
        // language tags. Both end up in argv, so free text is never passed through.
        thumbnail: true, embedMetadata: true, embedChapters: true, infoJson: true, playlistItems: p.items ? String(p.items).replace(/[^\d,\-:]/g, '') : undefined,
        ffmpegLocation: env.ffmpegDir || undefined,
      });
      after.download = { media: media ? media.id : null, ref };
      break;
    }
    default: throw err('unknown job kind');
  }
  return { spec, outputs, after };
}
