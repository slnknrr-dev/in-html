# Serverless build

`html@5_serverless/` is the game as a static site for any static host (itch.io, Codeberg Pages, GitHub Pages, a CDN):
`index.html`, the game modules and only the library modules they use, each tree-shaken and minified. Everything runs
in the browser. For online rooms the player enters the address of a game server (a BACKEND build of this game); the
page talks to it over HTTPS with CORS, so the static host and the game server can be different machines.
