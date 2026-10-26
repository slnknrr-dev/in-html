# Desktop build (Electron)

`html@5_electron/` is the media player as a desktop application for **Electron 29 or newer**. The folder holds
`package.json`, `main.mjs` (the main process: hosting.js + electron.js), `backend.mjs` (the player's server, run
in-process), `preload.cjs` and `public/` (the pages). No packages are installed by this repository: run it with your
own Electron.

```bash
cd html@5_electron
npx electron .                    # or: npm install --save-dev electron && npm start
npx electron . --data D:\media-data --devtools
```

- **Files directly.** Folders and files you pick in the native dialogs or drop onto the window are used where they
  are (real paths, granted as folders of the built-in file API); scans run in the main process with the folder's
  rules; files play with seeking (HTTP Range through the app's private `in-html://media-player/` scheme — no network
  port is opened).
- **yt-dlp, ffmpeg, ffprobe, ImageMagick** are found on PATH (or set their paths in Converter → Tools; env MP_YTDLP,
  MP_FFMPEG, MP_FFPROBE, MP_MAGICK). Links stream or download with yt-dlp, the converter runs its jobs with ffmpeg /
  ImageMagick and shows every command for bash and cmd.exe. Without the tools those features say so and everything
  else works. Downloads go to `Downloads/Media Player`.
- **Desktop integration:** media keys (optional global shortcuts), a tray menu with the playing title, a mini-player
  window, keep-awake while a video plays, file arguments and "open with".
- **Data:** the catalogue and blobs live in `<userData>/data` (or `--data`), window state in `<userData>`. The page
  runs with context isolation and sandbox; it can reach only its own scheme and the links you open.
