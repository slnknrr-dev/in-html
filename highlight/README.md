# highlight

**Syntax highlighting.** A small regex-driven highlighter for code blocks. Languages: JavaScript / TypeScript, Python, shell, PowerShell, JSON, HTML / XML, CSS, SQL, C / C++, C#, Java, Kotlin, Scala, Swift, Dart, Go, Rust, PHP, Ruby, Perl, Lua, R, Elixir, Haskell, YAML, TOML, INI / properties, Markdown, Dockerfile, Makefile, nginx, GraphQL and diff, with the usual aliases (`ts`, `ps1`, `rb`, `kt`, `patch`, `docker`, `mk`, `gql`, `yml`, `cpp`, `csharp` …). Output is escaped HTML with `hl-<kind>` spans; colours come from the product CSS (`HIGHLIGHT_CSS` / `HIGHLIGHT_CSS_DARK` are defaults).

| module | contents |
| --- | --- |
| `highlight.js` | `highlight(code, lang)` → safe HTML; `LANGS` ([key, label] of every grammar), `langOf(name)` (aliases → key, '' when unknown), `guessLang(code)`, `HIGHLIGHT_CSS`, `HIGHLIGHT_CSS_DARK`. Kinds: `k` keyword, `s` string, `c` comment, `n` number, `f` function, `t` tag / type, `a` attribute / parameter, `p` property / key, `o` operator, `b` builtin, `v` variable, `r` regexp, `h` heading / section, `m` meta, `i` / `d` inserted / deleted diff lines. |
| `test.js` | unit tests: `node highlight/test.js` (also `node check.js tests highlight`) |

A grammar is a list of `[kind, regexp, bol]` rules tried in order at each position (words are matched whole, `bol`
rules only at the start of a line).

## Limits

- Tokens, not parsing: nested template strings, heredocs and context-dependent syntax (Ruby / Perl regex literals,
  shell quoting) are approximated.
- `guessLang` recognises only a few unmistakable shapes; label code fences for reliable colours.
