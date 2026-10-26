#!/usr/bin/env sh
# codeberg-push.sh "commit message" - commit everything and push the all-in-one branch to Codeberg.
#
# The repository's own absolute links in Markdown are rewritten for the target forge first:
#   https://codeberg.org/slnknrr/<repo>/src/branch/...  <->  https://github.com/slnknrr-dev/<repo>/blob/...
#   https://codeberg.org/slnknrr/<repo>/raw/branch/...  <->  https://raw.githubusercontent.com/slnknrr-dev/<repo>/...
#   https://slnknrr.codeberg.page/...                  <->  https://slnknrr-dev.github.io/<repo>/...
# (Pages: the course sources LEARN_*_COURSE.md keep their codeberg.page preview links, course.js --check owns them.)
# Links to other repositories and bare repository URLs are left alone. <repo> is the folder above all-in-one.
# github-push.sh and codeberg-push.sh differ only in TARGET; the .bat files run them in Git Bash.

set -eu

TARGET=codeberg

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "usage: ./$TARGET-push.sh \"commit message\"" >&2
  exit 2
fi
MSG=$1

cd "$(dirname "$0")"
REPO=$(basename "$(cd .. && pwd)")
BRANCH=all-in-one
case $TARGET in
  github) URL="https://github.com/slnknrr-dev/$REPO.git" ;;
  codeberg) URL="https://codeberg.org/slnknrr/$REPO.git" ;;
esac

[ -d .git ] || git init -q

node - "$TARGET" "$REPO" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const [target, repo] = process.argv.slice(2);
const CB = `https://codeberg.org/slnknrr/${repo}/`, GH = `https://github.com/slnknrr-dev/${repo}/`;
const RAW = `https://raw.githubusercontent.com/slnknrr-dev/${repo}/`;
const CBP = 'https://slnknrr.codeberg.page/', GHP = `https://slnknrr-dev.github.io/${repo}/`;
const rules = target === 'github'
  ? [[CB + 'src/branch/', GH + 'blob/'], [CB + 'raw/branch/', RAW], [CBP, GHP, 'pages']]
  : [[GH + 'blob/', CB + 'src/branch/'], [GH + 'tree/', CB + 'src/branch/'], [RAW, CB + 'raw/branch/'], [GHP, CBP, 'pages']];
const isCourse = (name) => /^LEARN_.*_COURSE\.md$/.test(name);
// Generated artifact folders (es5@cjs, nodejs21@mjs, html@5_offline, ...) and tool folders are never touched.
const skip = (name) => name === '.git' || name === 'node_modules' || /^(es\d+|nodejs\d+|html)@/.test(name);
let files = 0, links = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!skip(e.name)) walk(p); continue; }
    if (!e.name.endsWith('.md')) continue;
    const src = fs.readFileSync(p, 'utf8');
    let out = src;
    for (const [from, to, kind] of rules) {
      if (kind === 'pages' && isCourse(e.name)) continue;
      const parts = out.split(from);
      links += parts.length - 1;
      out = parts.join(to);
    }
    if (out !== src) { fs.writeFileSync(p, out); files++; }
  }
})('.');
console.log(`links for ${target}: ${links} in ${files} file(s) rewritten`);
JS

git add -A
if git diff --cached --quiet; then
  echo 'nothing to commit'
else
  git commit -q -m "$MSG"
fi
git branch -M "$BRANCH"
git push "$URL" "$BRANCH"
