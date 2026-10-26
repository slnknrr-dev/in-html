// mediajobs/tools.js - the external programs (ffmpeg, ffprobe, yt-dlp, ImageMagick): where they are and which
// version they have. Node APIs come in as parameters (no node: imports), so a bundled backend can use it.
//
//   TOOLS                 { ffmpeg: { bin: 'ffmpeg' }, ffprobe: { bin: 'ffprobe' }, ytdlp: { bin: 'yt-dlp' },
//                           magick: { bin: 'magick' } } (+ name, versionArg); step.tool uses the bin names
//   toolId(bin)           'yt-dlp' -> 'ytdlp' (TOOLS key)
//   toolCommand(tools, bin) -> [program, ...leading args] | null. tools is keyed by bin name or TOOLS id; a value is
//                           a path string, an array (program + leading args, e.g. ['python', '-m', 'yt_dlp']), or
//                           { path, args? } (the result of detectTools); null / missing -> null
//   findTool(bin, { env, platform, fs, path, extra: [dirs], configured: path | null }) -> absolute path | null
//                           order: the configured file (or a folder holding the program), PATH (Windows: the
//                           PATHEXT extensions except .bat / .cmd, which cannot be spawned without a shell), the
//                           extra folders, then common install folders:
//                             Windows  C:\Program Files\ImageMagick-* (newest first), C:\ffmpeg\bin,
//                                      %ProgramFiles%\ffmpeg\bin, %LOCALAPPDATA%\Microsoft\WinGet\Links,
//                                      scoop shims (%SCOOP% or ~\scoop, and C:\ProgramData\scoop), chocolatey\bin
//                             macOS    /opt/homebrew/bin, /usr/local/bin, /opt/local/bin, ~/.local/bin
//                             Linux    /usr/bin, /usr/local/bin, ~/.local/bin, /snap/bin, /bin
//                           For 'magick' outside Windows the ImageMagick 6 'convert' is the fallback (Windows has a
//                           system convert.exe that is not ImageMagick).
//   parseVersion(bin, stdout) -> '7.1.2-0' | '6.1.1' | '2024.08.06' | null
//   detectTools({ spawn, env, platform, fs, path, configured: { ffmpeg, ffprobe, 'yt-dlp', magick }, timeout = 5000 })
//                         -> { ffmpeg: { path, version, legacy? } | null, ffprobe, 'yt-dlp', magick }
//                           runs `-version` (`--version` for yt-dlp) with a timeout; a program that cannot start is
//                           null, one whose version cannot be read has version null; never throws

// Dependency injection of fs/path/spawn/env (no node: imports): the module stays importable by the browser bundle
// (for toolCommand / parseVersion) and fully testable with fake file systems for every platform from one OS.
export const TOOLS = {
  ffmpeg: { bin: 'ffmpeg', name: 'FFmpeg', versionArg: '-version' },
  ffprobe: { bin: 'ffprobe', name: 'FFprobe', versionArg: '-version' },
  ytdlp: { bin: 'yt-dlp', name: 'yt-dlp', versionArg: '--version' },
  magick: { bin: 'magick', name: 'ImageMagick', versionArg: '-version' },
};

const BIN_IDS = Object.fromEntries(Object.entries(TOOLS).map(([id, t]) => [t.bin, id]));
export const toolId = (bin) => BIN_IDS[bin] || bin;
const binOf = (key) => TOOLS[key]?.bin || key;

// Lookup accepts three key spellings (bin name, TOOLS id, bin of an id) because settings files, detectTools output
// and step.tool historically use different ones. Array form supports interpreters ('python -m yt_dlp').
export function toolCommand(tools, bin) {
  const t = tools || {};
  const v = t[bin] ?? t[toolId(bin)] ?? t[binOf(bin)];
  if (v == null || v === false || v === '') return null;
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.length ? v.map(String) : null;
  if (typeof v === 'object' && v.path) return [String(v.path), ...(Array.isArray(v.args) ? v.args.map(String) : [])];
  return null;
}

// --- finding ----------------------------------------------------------------------------------------------------

// Windows environment variable names are case-insensitive (Path vs PATH); Node's process.env emulates that, but a
// plain-object env passed in (tests, Electron) does not, hence the manual search.
function envGet(env, name, win) {
  if (!env) return undefined;
  if (!win) return env[name];
  const k = Object.keys(env).find((x) => x.toUpperCase() === name.toUpperCase());
  return k ? env[k] : undefined;
}

function isFile(fs, p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}
function isDir(fs, p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// .bat/.cmd are excluded from PATHEXT candidates: child_process.spawn without shell:true cannot execute them, and
// since the CVE-2024-27980 fix Node refuses to (EINVAL). Running them through a shell would reintroduce quoting
// injection risk for every argument, so a .cmd shim is simply not considered found.
function names(bin, win, env) {
  if (!win) return [bin];
  const exts = String(envGet(env, 'PATHEXT', true) || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.trim().toLowerCase()).filter((e) => e && !/^\.(bat|cmd)$/.test(e));
  if (!exts.includes('.exe')) exts.push('.exe');
  const lower = bin.toLowerCase();
  if (exts.some((e) => lower.endsWith(e))) return [bin];
  // .exe first: the usual form, and the one people expect when both exist
  return [...new Set(['.exe', ...exts])].map((e) => bin + e);
}

// Fallback folders for GUI-launched apps: an Electron app started from the Dock/Start menu does not inherit the
// shell's PATH (notably macOS, where Homebrew's /opt/homebrew/bin is only added by shell profiles).
// ImageMagick folders are sorted newest-first with numeric collation (7.1.10 > 7.1.9); for non-magick tools they are
// searched LAST so a dedicated ffmpeg install wins over the copy bundled by the ImageMagick installer.
function commonDirs(bin, { env, win, mac, fs, path }) {
  const home = envGet(env, 'HOME', win) || envGet(env, 'USERPROFILE', win) || '';
  const dirs = [];
  if (win) {
    const pf = [envGet(env, 'ProgramFiles', true), envGet(env, 'ProgramW6432', true), envGet(env, 'ProgramFiles(x86)', true), 'C:\\Program Files']
      .filter(Boolean).filter((v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
    const im = [];
    for (const base of pf) {
      let list = [];
      try { list = fs.readdirSync(base).map(String).filter((n) => /^ImageMagick-/i.test(n)); } catch { /* none */ }
      list.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
      for (const d of list) im.push(path.join(base, d));
    }
    // ImageMagick's Windows installer can bring ffmpeg.exe along: its folders are searched for every tool.
    if (bin === 'magick') dirs.push(...im);
    dirs.push('C:\\ffmpeg\\bin');
    for (const base of pf) dirs.push(path.join(base, 'ffmpeg', 'bin'));
    const lad = envGet(env, 'LOCALAPPDATA', true);
    if (lad) dirs.push(path.join(lad, 'Microsoft', 'WinGet', 'Links'));
    const scoop = envGet(env, 'SCOOP', true);
    if (scoop) dirs.push(path.join(scoop, 'shims'));
    if (home) dirs.push(path.join(home, 'scoop', 'shims'));
    dirs.push('C:\\ProgramData\\scoop\\shims');
    dirs.push(path.join(envGet(env, 'ChocolateyInstall', true) || 'C:\\ProgramData\\chocolatey', 'bin'));
    if (bin !== 'magick') dirs.push(...im);
  } else if (mac) {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin');
    if (home) dirs.push(path.join(home, '.local', 'bin'));
  } else {
    dirs.push('/usr/bin', '/usr/local/bin');
    if (home) dirs.push(path.join(home, '.local', 'bin'));
    dirs.push('/snap/bin', '/bin');
  }
  return dirs;
}

// Search order encodes trust/intent: an explicit configuration beats PATH, PATH beats guessed folders. PATH entries
// are unquoted ("C:\Program Files\x" is legal in Windows PATH). The ImageMagick 6 `convert` fallback is skipped on
// Windows, where convert.exe is the FAT-to-NTFS system utility.
export function findTool(bin, { env = {}, platform = 'linux', fs = null, path = null, extra = [], configured = null } = {}) {
  if (!fs || !path) return configured || null;
  const win = platform === 'win32';
  const mac = platform === 'darwin';
  const abs = (p) => (path.isAbsolute(p) ? p : path.resolve(p));
  const list = names(bin, win, env);
  const inDir = (dir) => {
    for (const n of list) { const p = path.join(dir, n); if (isFile(fs, p)) return abs(p); }
    return null;
  };
  if (configured) {
    if (isFile(fs, configured)) return abs(configured);
    if (isDir(fs, configured)) { const p = inDir(configured); if (p) return p; }
  }
  const delim = win ? ';' : ':';
  const PATH = String(envGet(env, 'PATH', win) || '').split(delim).map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
  for (const dir of [...PATH, ...extra.filter(Boolean), ...commonDirs(bin, { env, win, mac, fs, path })]) {
    const p = inDir(dir);
    if (p) return p;
  }
  if (bin === 'magick' && !win) return findTool('convert', { env, platform, fs, path, extra, configured: null });
  return null;
}

// --- versions ---------------------------------------------------------------------------------------------------

// Tool-specific patterns first (ffmpeg "version n6.1", yt-dlp prints a bare date-like version line, ImageMagick
// "Version: ImageMagick 7.1.2-0"), then a generic dotted-number fallback for renamed binaries and forks.
export function parseVersion(bin, stdout) {
  const name = String(bin || '').split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|com)$/, '');
  const text = String(stdout || '');
  let m = null;
  if (/^(ffmpeg|ffprobe|ffplay)$/.test(name)) m = /\b(?:ffmpeg|ffprobe|ffplay) version (\S+)/i.exec(text);
  else if (/^(yt-dlp|ytdlp|yt_dlp|youtube-dl)$/.test(name)) m = /^\s*(\d{4}\.\d{1,2}\.\d{1,2}(?:\.\d+)?)\s*$/m.exec(text);
  else if (/^(magick|convert|identify)$/.test(name)) m = /Version:\s*ImageMagick\s+(\S+)/i.exec(text);
  if (!m) m = /\b(\d+\.\d+(?:\.\d+)*(?:-[0-9A-Za-z.]+)?)\b/.exec(text);
  return m ? m[1] : null;
}

// Never rejects: every failure mode (spawn throws synchronously, 'error' event, timeout) resolves with a status.
// `done` guards against double resolution ('error' and 'close' can both fire). Output is capped at 64 KiB per stream
// so a misbehaving binary cannot grow memory without bound; stdin is 'ignore' so a tool waiting for input gets EOF.
function runVersion(spawn, program, args, { env, timeout }) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(program, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch { resolve({ started: false }); return; }
    let out = '', err = '', done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish({ started: true, stdout: out, stderr: err, timedOut: true }); }, timeout);
    const text = (b) => (typeof b === 'string' ? b : new TextDecoder().decode(b));
    try {
      child.stdout?.on('data', (b) => { if (out.length < 65536) out += text(b); });
      child.stderr?.on('data', (b) => { if (err.length < 65536) err += text(b); });
      child.on('error', () => finish({ started: false }));
      child.on('close', (code) => finish({ started: true, stdout: out, stderr: err, code }));
    } catch { finish({ started: false }); }
  });
}

export async function detectTools({ spawn, env = {}, platform = 'linux', fs = null, path = null, configured = {}, extra = [], timeout = 5000 } = {}) {
  const result = {};
  await Promise.all(Object.values(TOOLS).map(async ({ bin, versionArg }) => {
    try {
      const conf = configured?.[bin] ?? configured?.[toolId(bin)] ?? null;
      const p = findTool(bin, { env, platform, fs, path, extra, configured: conf });
      if (!p) { result[bin] = null; return; }
      if (typeof spawn !== 'function') { result[bin] = { path: p, version: null }; return; }
      const r = await runVersion(spawn, p, [versionArg], { env, timeout });
      if (!r.started) { result[bin] = null; return; }
      const text = (r.stdout || '') + '\n' + (r.stderr || '');
      // A found 'magick' that is really `convert` (IM6 fallback) is marked legacy: IM6 has no `magick` front-end, so
      // builders must emit `convert ...` syntax. Output without "ImageMagick" means some other program of that name.
      const legacy = !/^magick(\.exe)?$/i.test(p.split(/[\\/]/).pop()) && bin === 'magick';
      if (bin === 'magick' && !r.timedOut && !/ImageMagick/i.test(text)) { result[bin] = null; return; }
      result[bin] = { path: p, version: parseVersion(legacy ? 'convert' : bin, text) };
      if (legacy) result[bin].legacy = true;
    } catch {
      result[bin] = null;
    }
  }));
  return { ffmpeg: result.ffmpeg ?? null, ffprobe: result.ffprobe ?? null, 'yt-dlp': result['yt-dlp'] ?? null, magick: result.magick ?? null };
}
