# Standalone build

`html@5_standalone/index.html` is one self-contained HTML file that opens from `file://` and plays offline, and also
connects to Durak servers over HTTPS (CORS, no cookies). It has no preset servers: the player enters an address. The
constructor's export writes a copy of this page with a list of servers built in.
