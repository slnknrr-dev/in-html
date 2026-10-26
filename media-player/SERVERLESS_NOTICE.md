# Serverless build

`html@5_serverless/` is the media player as a static site for any static host (or a local web server). It needs no
server of ours and calls no third-party service by default:

- The catalogue, covers and files you copy in stay in this browser (IndexedDB); export the tree or the whole database
  (JSON / ZIP) at any time.
- Files come from file picks and drops (copied into the library or kept for the session), and from folders opened with
  the File System Access API (Chromium browsers; the folder is re-read on scans and asked for permission again after a
  reload).
- The only requests are the ones you configure: a media-player server (the backend or desktop build) you add with its
  address and token, whose folders you can index and play, or whose catalogue you can use instead of the browser's;
  direct media URLs you add; pictures of other sites only when you allow them.
- Links that need yt-dlp stay "sources" here; the converter shows the commands to run yourself and converts to WAV,
  MP3 and Opus in the browser.
