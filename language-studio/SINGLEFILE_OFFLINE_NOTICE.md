# Single-file offline build

`html@5_offline_singlefile/index.html` is Language Studio as one self-contained HTML file: scripts, styles, icons and
all six courses are inlined and nothing is fetched — the build fails on any network API or remote resource. Open it
from disk (`file://`), put it on a USB stick or host it anywhere. Progress (spaced-repetition cards, game results)
stays in the browser's IndexedDB; it can be exported and imported as a JSON file. There are no accounts in this build.
