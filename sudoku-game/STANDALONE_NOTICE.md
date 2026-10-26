# Standalone build

`html@5_standalone/index.html` is the whole game in one HTML file that also opens from `file://`. It plays alone and
against bots without any network; for online rooms the player enters the address of a game server (a BACKEND build of
this game), which the page reaches over HTTPS with CORS. No server is preset.
