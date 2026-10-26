// photo/jobs.js - the heavy pixel work of the photo editor as plain jobs that a Worker can run (an application
// forwards them through its own worker; without one they run in the page):
//   { op: 'filter', type, params, img }            -> { img }   (photo/adjust.js filters)
//   { op: 'resize', img, width, height, filter }   -> { img }   (raster/resample.js)
// Images are { width, height, data: Uint8ClampedArray } and travel as transferables.

// Why a job protocol: blur / unsharp / Lanczos resize on a 24 MP image take seconds on the main thread and freeze the
// UI. Plain-data jobs (no closures, no canvases) are structured-cloneable, so the same function runs in a Worker or,
// as fallback, inline; the caller decides. Transferring the pixel buffer moves it in O(1) instead of copying ~100 MB.
import { applyFilter } from './adjust.js';
import { resize } from '../raster/resample.js';

export function runPhotoJob(job) {
  if (job.op === 'filter') return { img: applyFilter(job.type, job.img, job.params) };
  if (job.op === 'resize') return { img: resize(job.img, job.width, job.height, job.filter || 'lanczos3') };
  throw new Error('unknown photo job ' + job.op);
}

/** Buffers to transfer with a job result. */
// After transfer the sender's buffer is detached (length 0): the worker must not touch res.img afterwards.
export const photoTransfer = (res) => (res && res.img ? [res.img.data.buffer] : []);
