// video-processor/geometry.js - time formatting and bit rate presets. (Frame geometry is shared with the
// ffmpeg description in timeline/frame.js.) No DOM access.

/** 83.5 -> '1:23.50'; with hours '1:02:03.04'. */
// Seconds rounded by toFixed can reach "60.00" (59.996 -> 60.00); it is clamped to 59.99 instead of carrying into the
// minutes, a deliberate display shortcut: off by at most 10 ms, never a malformed "1:60.00". Leading zero only for
// seconds below 10 (and not when rounding produced "10.00").
export function fmtTime(sec, frac = 2) {
  if (!Number.isFinite(sec)) return '--:--';
  const neg = sec < 0;
  let s = Math.abs(sec);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  let ss = s.toFixed(frac);
  if (parseFloat(ss) >= 60) ss = (59.99).toFixed(frac);
  const sPart = (s < 10 && !ss.startsWith('10') ? '0' : '') + ss;
  return (neg ? '-' : '') + (h ? `${h}:${String(m).padStart(2, '0')}:${sPart}` : `${m}:${sPart}`);
}

/** Bits per second for a quality level and output geometry (rough per-codec efficiency). */
// Bits-per-pixel heuristic: bitrate = w * h * fps * bpp * codec efficiency, clamped to 150 kbps..60 Mbps. Newer codecs
// need fewer bits for the same quality (AV1 ~0.6 of H.264, VP9/HEVC ~0.7, VP8 ~1.15).
export function videoBitrate(w, h, fps, quality, codec) {
  const bpp = { low: 0.05, med: 0.09, high: 0.16 }[quality] || 0.09;
  const eff = /^av01/.test(codec) ? 0.6 : /^vp09|^hvc1/.test(codec) ? 0.7 : /^vp8/.test(codec) ? 1.15 : 1;
  return Math.round(Math.min(60e6, Math.max(150e3, w * h * fps * bpp * eff)));
}
