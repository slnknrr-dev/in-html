# badge

**Badges.** The shields.io badge URL as a model and badges drawn locally, so a README editor can build badges and
preview static ones without the network. Pure ES modules, importable in Node; nothing is fetched.

| module | contents |
| --- | --- |
| `shields.js` | `parseShields(url)` / `buildShields(model)`: static badges (`/badge/label-message-color` with shields.io's `--` / `__` / `_` escapes), presets for GitHub, Codeberg / Gitea, npm, PyPI, crates.io, Docker Hub, Codecov, Discord, websites and dynamic JSON (`PRESETS`, `presetVars`), query options (style, logo, logoColor, labelColor, color, label, logoSize); `COLORS`, `colorHex`, `STYLES`, `isShields`, `localLabel` (what a local preview shows) |
| `svg.js` | `badgeSVG({ label, message, color, labelColor, style })` in the five styles (flat, flat-square, plastic, for-the-badge, social) with Verdana-like text widths and dark text on light colours; `badgeDataURI`, `textWidth` |
| `test.js` | unit tests: `node badge/test.js` (also `node check.js tests badge`) |

## Limits

- Logos (simple-icons) are not bundled: local badges leave them out.
- Dynamic badges have no value locally (`…`); shields.io fills it when the README is viewed online.
- Text widths are estimates of Verdana 11 px; a local badge may be a pixel or two wider or narrower than shields.io's.
