# ffcmd/

ffmpeg command lines as data: filter graphs with references back to what they describe, ffmpeg's own escaping, encoder
options, and rendering for bash and cmd.exe (through `../cmdline/quote.js`). The video processor uses it to show its
edits as equivalent ffmpeg commands; nothing here runs ffmpeg.

| file | contents |
| --- | --- |
| `escape.js` | `escapeValue` (level 1: `\ ' :` in an option value), `escapeGraph` (level 2: `\ ' [ ] , ;` in a filter description), `num`, `seconds`, `color` |
| `graph.js` | `f(name, ...parts)` one filter (positional values, `{ named }` options, `raw()`); `Graph`: `label`, `chain(ins, filters, outs, ref)`, `relabel`, `text()`, `pieces()` |
| `command.js` | `ref(r, ...items)`, `renderCommand(argv, shell, { width, batch })` and `renderScript(steps, shell, options)` → `{ text, pieces: [{ text, ref }] }`, `plainArgv` |
| `codecs.js` | `FORMATS`, `encodeArgs(id, { quality, videoBitrate, audioBitrate, audio })` (libx264, libvpx-vp9, libvpx, libsvtav1, aac, libopus, `+faststart`), `INTERMEDIATE`, `bitrate` |
| `parse.js` | `getToken` (av_get_token), `parseOptions`, `parseGraph`, `checkGraph` (pads produced and consumed once, inputs exist) |
| `test.js` | `node ffcmd/test.js` |

## Escaping

A filter graph is read in two levels (ffmpeg-filters, "Notes on filtergraph escaping"): inside an option value `\`,
`'` and `:` are special; inside the graph `\`, `'`, `[`, `]`, `,` and `;`. Both levels read a backslash as "take the
next character literally". `f()` applies level 1 to each value and level 2 to the argument string, and never uses
`'…'` quoting, so the graph text is the same for both shells:

```
text "It's 10:30"          drawtext=text=It\\\'s 10\\:30
enable between(t,1,3)      overlay=enable=between(t\,1\,3)
```

The shell quoting around the whole argument is `cmdline/quote.js`'s: bash `'…'` (a `'` inside becomes `'\''`),
cmd.exe `"…"` (no `'` problem at all; `"` doubled; `%` doubled for .bat files with `{ batch: true }`). drawtext gets
`expansion=none`, so `%` and `\` in its text need no third level.

## Pieces

`renderCommand` lays out and quotes exactly like `commandLine` (the tests compare the texts), and also returns the
text cut into pieces with the reference of the argument group or filter each piece comes from. A quoted filter graph is
split back into its filters through private-use marker characters that both quoting schemes copy unchanged.

## Tests

`parse.js` re-implements ffmpeg's tokenizer and option parser: every tricky value (quotes, colons, brackets, commas,
backslashes, `%`, Cyrillic) must come back unchanged from the escaped graph. Where bash and cmd.exe exist, rendered
commands run through the real shells (node stands in for ffmpeg) and the received graph is parsed back.
