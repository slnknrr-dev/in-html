# Single-file offline build

`html@5_offline_singlefile/` holds the designer (`index.html`) and the guests page (`guests.html`) as self-contained
HTML: scripts, styles and icons are inlined and nothing is fetched — the build fails on any network API or remote
resource. Open a file from disk (`file://`). The exported invitation is itself one self-contained page with zero
network use.
