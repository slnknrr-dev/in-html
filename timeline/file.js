// timeline/file.js - project files. A project is JSON ("type": "in-html-video-project"); saved with its media it is a
// ZIP archive: project.json + media/<media id>/<file name> (stored, media are compressed already).
//
//   projectJSON(p) -> string               parseProject(text) -> project (throws when it is not a project)
//   packProject(p, files) -> Promise<Uint8Array>     files: Map(mediaId -> Uint8Array)
//   unpackProject(bytes) -> Promise<{ project, files: Map(mediaId -> { name, bytes }) }>
//   isZip(bytes)

import { readZip, writeZip } from '../zip/zip.js';
import { PROJECT_TYPE, normalizeProject } from './model.js';

export function projectJSON(p) {
  return JSON.stringify(normalizeProject(p), null, 1);
}

// Explicit type marker and version gate: a random JSON file is refused with a clear message instead of being
// "normalised" into an empty project, and a file from a newer version is refused rather than silently losing the
// fields this version does not know.
export function parseProject(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('not a project file (invalid JSON)'); }
  if (!raw || typeof raw !== 'object' || raw.type !== PROJECT_TYPE) throw new Error('not a video project');
  if (Number(raw.version) > 1) throw new Error('the project was saved by a newer version');
  return normalizeProject(raw);
}

export const isZip = (b) => b && b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

// ZIP entry names from user file names: path separators and Windows-reserved characters replaced, so an archive
// can never contain '../' traversal or names that fail to extract on Windows.
const safeName = (s) => String(s || 'media').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || 'media';

export async function packProject(p, files) {
  const proj = normalizeProject(p);
  const entries = [{ name: 'project.json', data: JSON.stringify(proj, null, 1) }];
  for (const m of proj.media) {
    const data = files.get(m.id);
    if (data) entries.push({ name: `media/${m.id}/${safeName(m.name)}`, data, store: true });
  }
  return writeZip(entries);
}

export async function unpackProject(bytes) {
  const entries = readZip(bytes);
  const pj = entries.find((e) => e.name === 'project.json');
  if (!pj) throw new Error('not a video project archive (no project.json)');
  const project = parseProject(await pj.text());
  const files = new Map();
  for (const e of entries) {
    const m = /^media\/([^/]+)\/(.+)$/.exec(e.name);
    if (!m || e.dir || !project.media.some((x) => x.id === m[1])) continue;
    files.set(m[1], { name: m[2], bytes: await e.data() });
  }
  return { project, files };
}
