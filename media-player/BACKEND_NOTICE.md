# Server build (home media server)

`html@5_backend/` is the media player with its own server for **Node.js 18 or newer** (no packages):
`server.mjs` (hosting.js), `backend.mjs` (the player's server) and `public/` (the pages).

```bash
MP_ROOTS=/srv/music:/srv/video node server.mjs 8080 --host 0.0.0.0     # Windows: set MP_ROOTS=D:\Music;D:\Video
node server.mjs --root /srv/music --root /srv/audiobooks --data /var/lib/media-player
```

- The start prints the **owner token**; open `http://<host>:<port>/#token=<token>` once (the page remembers it).
  `MP_TOKEN` chooses the token, `MP_GUEST_TOKEN` adds a read-and-play token for others.
- **Roots** (`MP_ROOTS`, `--root`) are read-only folders (`MP_WRITABLE=1` makes them writable); the owner can add more
  in the page. Downloads and converter outputs go to `MP_DOWNLOADS` or `<data>/downloads`.
- **Tools:** yt-dlp, ffmpeg, ffprobe and ImageMagick on PATH or `MP_YTDLP` / `MP_FFMPEG` / `MP_FFPROBE` / `MP_MAGICK`.
  Jobs are built from parameters on the server and touch only paths inside the mounted folders.
- **Other pages** (the serverless build, another device) connect with the address and a token when their origin is
  allowed: `MP_CORS=https://player.example,null` or Settings → Storage and servers.
- Data: `catalog.json` (the catalogue, written atomically), `blobs/`, `thumbs/`, `work/`, `owner-token.json` in the
  data folder (default `./data` next to `server.mjs`). Put it behind HTTPS (a reverse proxy) on the internet.
