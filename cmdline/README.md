# cmdline/

Command lines as text in two syntaxes, Linux bash and Windows cmd.exe: the image and video processors describe what
they do as equivalent ImageMagick / ffmpeg commands. Strings to read and copy; nothing is executed.

| file | contents |
| --- | --- |
| `quote.js` | `quote(arg, shell, { batch })`, `commandLine(argv, shell, { width, batch })` (argv items: strings, or arrays kept on one line), `script(steps, shell)` (`[{ comment, argv }]`, `#` / `REM` comments), `NULL_DEVICE` |
| `test.js` | unit tests: `node cmdline/test.js`; every quoted command also runs through the real bash and cmd.exe when they exist and the received arguments are compared |

**bash**: safe arguments stay bare, the others go in single quotes (`'` becomes `'\''`); a lone `(` or `)` (ImageMagick's
image-list parentheses) is written `\(` `\)` as in ImageMagick's documentation; continuation ` \`.

**cmd.exe**: programs read their arguments by the Microsoft C runtime rules. An argument with spaces or special
characters (including `, ; =`, which cmd treats as separators) is put in double quotes; backslashes before a quote and
at the end are doubled; a quote inside is written `""`, which keeps cmd's own quote state balanced so `& | < > ^ ( )`
stay literal. `%name%` expands in an interactive window only when the variable exists (so `frame%04d.png` is safe
there); `{ batch: true }` doubles every `%` for `.bat` / `.cmd` files. Continuation ` ^`.
