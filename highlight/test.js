// highlight/test.js - unit tests of the highlighter: node highlight/test.js (also node check.js tests highlight).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS, guessLang, highlight, langOf, HIGHLIGHT_CSS, HIGHLIGHT_CSS_DARK } from './highlight.js';

let failed = 0, passed = 0;
const ok = (c, name, info) => { if (c) passed++; else { failed++; console.log('x highlight: ' + name + (info !== undefined ? ' ' + JSON.stringify(info) : '')); } };
// highlight(code, lang) contains every expected span.
const has = (lang, code, spans) => {
  const h = highlight(code, lang);
  const miss = spans.filter((s) => !h.includes(s));
  ok(!miss.length, lang + ' highlighting', { miss, h });
};
const plainText = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const SAMPLES = {
  js: ['const x = 1; // note\nconsole.log(`a${x}`, /re/g)', ['<span class="hl-k">const</span>', '<span class="hl-c">// note</span>', '<span class="hl-r">/re/g</span>']],
  py: ['def f(x):\n    return None  # c', ['<span class="hl-k">def</span>', '<span class="hl-f">f</span>', '<span class="hl-c"># c</span>']],
  sh: ['echo "$HOME" && ls', ['<span class="hl-b">echo</span>', '<span class="hl-s">&quot;$HOME&quot;</span>', '<span class="hl-o">&amp;&amp;</span>']],
  json: ['{"a": true}', ['<span class="hl-p">&quot;a&quot;</span>', '<span class="hl-k">true</span>']],
  html: ['<a href="x">y</a>', ['<span class="hl-t">&lt;a</span>', '<span class="hl-a">href</span>']],
  diff: ['diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old line\n+new line\n context - not deleted', ['<span class="hl-m">diff --git a/x b/x</span>', '<span class="hl-b">@@ -1 +1 @@</span>', '<span class="hl-d">-old line</span>', '<span class="hl-i">+new line</span>']],
  dockerfile: ['FROM node:20 AS build\nRUN npm ci && echo $HOME\nCOPY --chown=app . .', ['<span class="hl-k">FROM</span>', '<span class="hl-k">AS</span>', '<span class="hl-k">RUN</span>', '<span class="hl-v">$HOME</span>', '<span class="hl-a">--chown</span>']],
  ini: ['; comment\n[section]\nkey = value\nflag=true', ['<span class="hl-c">; comment</span>', '<span class="hl-h">[section]</span>', '<span class="hl-p">key</span>', '<span class="hl-k">true</span>']],
  toml: ['[package]\nname = "x"\nversion.major = 1\ndate = 2024-01-02\n[[bin]]', ['<span class="hl-h">[package]</span>', '<span class="hl-p">name</span>', '<span class="hl-p">version.major</span>', '<span class="hl-n">2024-01-02</span>', '<span class="hl-h">[[bin]]</span>']],
  makefile: ['CC := gcc\n.PHONY: all\nall: main.o\n\t$(CC) -o $@ $^\nifeq ($(X),1)\nendif', ['<span class="hl-p">CC</span>', '<span class="hl-f">all</span>', '<span class="hl-v">$(CC)</span>', '<span class="hl-v">$@</span>', '<span class="hl-k">ifeq</span>']],
  lua: ['local t = {} -- c\nfunction f() return nil end', ['<span class="hl-k">local</span>', '<span class="hl-c">-- c</span>', '<span class="hl-k">nil</span>']],
  ruby: ['class Foo\n  def bar?(x) = @y || :sym\nend # c', ['<span class="hl-k">class</span>', '<span class="hl-t">Foo</span>', '<span class="hl-v">@y</span>', '<span class="hl-s">:sym</span>', '<span class="hl-c"># c</span>']],
  php: ['<?php\nfunction f($a) { echo "x"; return $a->b; }', ['<span class="hl-m">&lt;?php</span>', '<span class="hl-k">function</span>', '<span class="hl-v">$a</span>', '<span class="hl-o">-&gt;</span>']],
  swift: ['@MainActor\nstruct V { let x: Int = 1; func f() async throws {} }', ['<span class="hl-m">@MainActor</span>', '<span class="hl-k">struct</span>', '<span class="hl-b">Int</span>', '<span class="hl-k">async</span>']],
  kotlin: ['data class P(val x: Int)\nfun main() { println(listOf(1)?.size ?: 0) }', ['<span class="hl-k">data</span>', '<span class="hl-k">val</span>', '<span class="hl-b">println</span>', '<span class="hl-o">?:</span>']],
  dart: ["import 'x.dart';\nFuture<void> main() async { final s = 'a'; }", ['<span class="hl-k">import</span>', '<span class="hl-b">Future</span>', '<span class="hl-k">final</span>']],
  powershell: ['$files = Get-ChildItem -Path . -Recurse # c\nif ($x -eq 1) { Write-Host "ok" }', ['<span class="hl-v">$files</span>', '<span class="hl-b">Get-ChildItem</span>', '<span class="hl-a">-Path</span>', '<span class="hl-o">-eq</span>', '<span class="hl-k">if</span>']],
  graphql: ['query Q($id: ID!) { user(id: $id) @include(if: true) { name } }', ['<span class="hl-k">query</span>', '<span class="hl-v">$id</span>', '<span class="hl-m">@include</span>', '<span class="hl-t">ID</span>']],
  nginx: ['server {\n  listen 80;\n  location / { proxy_pass http://app; }\n  return 301 $scheme;\n}', ['<span class="hl-k">server</span>', '<span class="hl-p">listen</span>', '<span class="hl-k">location</span>', '<span class="hl-v">$scheme</span>']],
  perl: ['my @a = (1); print "$x\\n" if defined $h{k};', ['<span class="hl-k">my</span>', '<span class="hl-v">@a</span>', '<span class="hl-k">print</span>']],
  r: ['x <- c(1, 2) # c\nf <- function(a) a %in% x', ['<span class="hl-o">&lt;-</span>', '<span class="hl-b">c</span>', '<span class="hl-k">function</span>', '<span class="hl-o">%in%</span>']],
  elixir: ['defmodule M do\n  def f(x), do: x |> IO.puts() # c\nend', ['<span class="hl-k">defmodule</span>', '<span class="hl-t">M</span>', '<span class="hl-o">|&gt;</span>', '<span class="hl-p">do:</span>']],
  haskell: ['main :: IO ()\nmain = putStrLn "hi" -- c', ['<span class="hl-o">::</span>', '<span class="hl-t">IO</span>', '<span class="hl-b">putStrLn</span>', '<span class="hl-c">-- c</span>']],
  scala: ['object M extends App { val s = s"x$y"; println(Some(1)) }', ['<span class="hl-k">object</span>', '<span class="hl-k">val</span>', '<span class="hl-s">s&quot;x$y&quot;</span>', '<span class="hl-b">Some</span>']],
  cs: ['#nullable enable\nusing System;\npublic record P(string Name) { var s = $"{Name}"; }', ['<span class="hl-m">#nullable</span>', '<span class="hl-k">using</span>', '<span class="hl-k">record</span>', '<span class="hl-s">$&quot;{Name}&quot;</span>']],
};

export function run() {
  for (const [lang, [code, spans]] of Object.entries(SAMPLES)) {
    has(lang, code, spans);
    ok(plainText(highlight(code, lang)) === code, lang + ' keeps the text');
    ok(LANGS.some(([k]) => k === lang), lang + ' is listed');
  }
  // Every grammar key that langOf can return is listed (docs-app shows LANGS in a select).
  const aliases = ['ts', 'python', 'bash', 'ps1', 'pwsh', 'rb', 'kt', 'kts', 'patch', 'docker', 'mk', 'make', 'gql', 'csharp', 'toml', 'yml', 'properties', 'exs', 'hs', 'golang', 'cpp'];
  for (const a of aliases) ok(langOf(a) && LANGS.some(([k]) => k === langOf(a)), 'alias ' + a, langOf(a));
  ok(langOf('ps1') === 'powershell' && langOf('rb') === 'ruby' && langOf('patch') === 'diff' && langOf('mk') === 'makefile' && langOf('gql') === 'graphql' && langOf('kt') === 'kotlin', 'new aliases');
  ok(langOf('JavaScript') === 'js' && langOf('nope') === '' && langOf('') === '', 'langOf');
  ok(LANGS.every((x) => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && typeof x[1] === 'string'), 'LANGS pairs');
  ok(highlight('<b>&"', 'nope') === '&lt;b&gt;&amp;&quot;', 'unknown languages are escaped');
  ok(!highlight('<script>alert(1)</script>', 'js').includes('<script'), 'code is escaped');
  ok(!highlight('x-1', 'diff').includes('hl-d'), 'diff marks only line starts');
  ok(!highlight('constant', 'js').includes('hl-k'), 'keywords only as whole words');
  ok(guessLang('{"a": 1}') === 'json' && guessLang('diff --git a b\n--- a\n+++ b\n+x') === 'diff' && guessLang('FROM node\nRUN x') === 'dockerfile' && guessLang('<?php echo 1;') === 'php' && guessLang('const a = 1') === 'js', 'guessLang');
  ok(/\.hl-i\{/.test(HIGHLIGHT_CSS) && /\.hl-d\{/.test(HIGHLIGHT_CSS_DARK), 'CSS of inserted / deleted lines');

  console.log(`highlight: ${passed} passed, ${failed} failed`);
  return failed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run() ? 1 : 0;
