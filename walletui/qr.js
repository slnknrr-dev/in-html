// walletui/qr.js - QR codes in the wallet applications: a QR element for addresses, payment URIs and transactions,
// a dialog that shows one (or several parts of a long text, cycling), and a scanner dialog that reads codes from the
// camera or from a picture file (qr/decode.js, no network) and joins multi-part texts.
//
//   qrElement(text, { size = 220, ec = 'M', label }) -> element (SVG; long texts: ec 'L')
//   showQr(text, { title, caption, maxChars = 1200 }) -> Promise (texts above maxChars are split into "pXofN " parts)
//   splitParts(text, maxChars) -> ['p1of3 …', …], joinParts(parts) -> text | null
//   scanQr({ title, accept }) -> Promise<text | null>   (camera when allowed, else a picture file)
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { openDialog } from '../ui/overlays.js';
import { iconEl } from '../ui/icons.js';
import { pickFiles } from '../ui/files.js';
import { qrSVG } from '../qr/qr.js';
import { decodeQR } from '../qr/decode.js';

// Error-correction level: M normally, L for long texts (L fits ~25 % more data at the same module size, and big
// codes are shown on screens where damage is unlikely).
export function qrElement(text, { size = 220, ec = null, label = '' } = {}) {
  const level = ec || (text.length > 600 ? 'L' : 'M');
  let svg;
  try { svg = qrSVG(text, { ec: level, margin: 2, title: label || 'QR' }); } catch { return h('div', { class: 'wu-qr wu-qr-err' }, t('wu.qrTooLong')); }
  return h('div', { class: 'wu-qr', style: { width: size + 'px', maxWidth: '100%' }, role: 'img', 'aria-label': label || t('wu.qr'), html: svg });
}

// Animated multi-part QR for texts beyond what one code scans reliably (signed transactions). Equal-size parts and
// a "pXofN " prefix let the scanner collect parts in any order and know when it has all of them.
export function splitParts(text, maxChars = 1200) {
  if (text.length <= maxChars) return [text];
  const n = Math.ceil(text.length / maxChars);
  const size = Math.ceil(text.length / n);
  return Array.from({ length: n }, (_, i) => `p${i + 1}of${n} ${text.slice(i * size, (i + 1) * size)}`);
}

export function joinParts(parts) {
  const map = new Map();
  let total = 0;
  for (const p of parts) {
    const m = /^p(\d+)of(\d+) ([\s\S]*)$/.exec(p);
    if (!m) return null;
    total = +m[2];
    map.set(+m[1], m[3]);
  }
  if (!total || map.size !== total) return null;
  return Array.from({ length: total }, (_, i) => map.get(i + 1)).join('');
}

export function showQr(text, { title = t('wu.qr'), caption = '', maxChars = 1200 } = {}) {
  const parts = splitParts(text, maxChars);
  let i = 0, timer = null;
  const box = h('div', { class: 'wu-qr-box' });
  const counter = h('div', { class: 'wu-muted wu-center' });
  const paint = () => {
    box.textContent = '';
    box.append(qrElement(parts[i], { size: 300 }));
    counter.textContent = parts.length > 1 ? t('wu.qrPart', { i: i + 1, n: parts.length }) : '';
  };
  paint();
  if (parts.length > 1) timer = setInterval(() => { i = (i + 1) % parts.length; paint(); }, 900);
  const body = h('div', { class: 'wu-col wu-center' }, box, counter, caption ? h('div', { class: 'wu-mono wu-break wu-small' }, caption) : null);
  return openDialog({ title, body, buttons: [{ label: t('dlg.close'), value: null }] }).finally(() => clearInterval(timer));
}

// Decodes a picture (File) to text, or null.
// Downscaled to 1600 px: phone photos are 12+ MP and decoding cost grows with pixels, while QR modules stay well
// above one pixel at that size.
async function decodeFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const r = decodeQR(ctx.getImageData(0, 0, c.width, c.height));
    return r ? r.text : null;
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

// Camera frames are sampled every 160 ms at <= 720 px with the fast decoder effort: enough for a held-up code without
// burning the phone's CPU. done guards every exit path (found, cancelled, dialog closed) so the camera track is
// always stopped exactly once; a stream obtained after cancel is stopped immediately.
export function scanQr({ title = t('wu.scan') } = {}) {
  return new Promise((resolve) => {
    let stream = null, timer = null, done = false;
    const parts = [];
    const video = h('video', { class: 'wu-scan-video', muted: true, playsinline: true, autoplay: true });
    video.muted = true;
    const status = h('div', { class: 'wu-muted wu-center' }, t('wu.scanHint'));
    const frame = document.createElement('canvas');
    const stop = () => { clearInterval(timer); if (stream) for (const tr of stream.getTracks()) tr.stop(); stream = null; };
    let closeDlg = null;
    const finish = (text) => { if (done) return; done = true; stop(); resolve(text); if (closeDlg) closeDlg(null); };
    const accept = (text) => {
      if (/^p\d+of\d+ /.test(text)) {
        if (!parts.includes(text)) parts.push(text);
        const joined = joinParts(parts);
        const m = /^p\d+of(\d+)/.exec(text);
        status.textContent = t('wu.qrPart', { i: parts.length, n: m[1] });
        if (joined) finish(joined);
        return;
      }
      finish(text);
    };
    const fileBtn = h('button', { type: 'button', class: 'ed-btn', onclick: async () => {
      const [f] = await pickFiles({ accept: 'image/*' });
      if (!f) return;
      const text = await decodeFile(f);
      if (text) accept(text); else status.textContent = t('wu.scanNone');
    } }, iconEl('upload'), t('wu.scanFile'));
    const body = h('div', { class: 'wu-col wu-center' }, h('div', { class: 'wu-scan' }, video), status, fileBtn);
    openDialog({
      title, body, buttons: [{ label: t('dlg.cancel'), value: null }],
      onMount: ({ close }) => { closeDlg = close; },
    }).then(() => finish(null));
    (async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no camera');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (done) { stop(); return; }
        video.srcObject = stream;
        timer = setInterval(() => {
          if (!video.videoWidth) return;
          const s = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
          frame.width = Math.round(video.videoWidth * s); frame.height = Math.round(video.videoHeight * s);
          const ctx = frame.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, frame.width, frame.height);
          const r = decodeQR(ctx.getImageData(0, 0, frame.width, frame.height), { effort: 'fast' });
          if (r && r.text) accept(r.text);
        }, 160);
      } catch {
        video.remove();
        status.textContent = t('wu.noCamera');
      }
    })();
  });
}
