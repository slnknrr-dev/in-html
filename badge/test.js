// badge/test.js - unit tests of the badge library: node badge/test.js (also node check.js tests badge).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseShields, buildShields, colorHex, isShields, localLabel, presetVars } from './shields.js';
import { badgeSVG, badgeDataURI, textWidth } from './svg.js';

let failed = 0, passed = 0;
const ok = (c, name, info) => { if (c) passed++; else { failed++; console.log('x badge: ' + name + (info !== undefined ? ' ' + JSON.stringify(info) : '')); } };

export function run() {
  const s = parseShields('https://img.shields.io/badge/build--tool-pass__ing_now-brightgreen?style=flat-square&logo=github&logoColor=white');
  ok(s.kind === 'static' && s.label === 'build-tool' && s.message === 'pass_ing now' && s.color === 'brightgreen', 'static badge escapes', s);
  ok(s.style === 'flat-square' && s.logo === 'github' && s.logoColor === 'white', 'query options', s);
  ok(buildShields(s) === 'https://img.shields.io/badge/build--tool-pass__ing_now-brightgreen?style=flat-square&logo=github&logoColor=white', 'static round trip', buildShields(s));
  ok(parseShields('https://img.shields.io/badge/passing-green').label === '' && parseShields('https://img.shields.io/badge/passing-green').message === 'passing', 'two-part static badge');
  const g = parseShields('https://img.shields.io/github/stars/user/repo?style=social&label=Stars');
  ok(g.kind === 'gh-stars' && g.vars.user === 'user' && g.vars.repo === 'repo' && g.labelOverride === 'Stars', 'GitHub preset', g);
  ok(buildShields(g) === 'https://img.shields.io/github/stars/user/repo?label=Stars&style=social', 'preset round trip', buildShields(g));
  const c = parseShields('https://img.shields.io/gitea/v/release/me/app?gitea_url=https://codeberg.org');
  ok(c.kind === 'cb-release' && buildShields(c).includes('gitea_url=https://codeberg.org'), 'Codeberg preset', c);
  ok(parseShields('https://img.shields.io/gitea/v/release/me/app').kind === 'custom', 'Gitea path without gitea_url is a custom badge');
  ok(parseShields('https://img.shields.io/badge/dynamic/json?url=https://x/d.json&query=$.v').kind === 'json', 'dynamic JSON');
  ok(parseShields('https://example.com/x.svg') === null && isShields('https://img.shields.io/badge/a-b-c') && !isShields('https://shields.io.evil/x'), 'only shields.io');
  ok(presetVars('gh-ci').join() === 'user,repo,workflow', 'preset variables');
  ok(colorHex('brightgreen') === '#44cc11' && colorHex('ff69b4') === '#ff69b4' && colorHex('nope', '#000') === '#000', 'colours');
  ok(localLabel(g).label === 'Stars' && localLabel(g).live, 'local label of a dynamic badge');

  const svg = badgeSVG({ label: 'license', message: 'MIT', color: 'blue' });
  ok(/^<svg[^>]+width="\d+" height="20"/.test(svg) && svg.includes('>license<') && svg.includes('#007ec6'), 'flat badge SVG', svg.slice(0, 120));
  ok(badgeSVG({ label: 'a', message: 'b', style: 'for-the-badge' }).includes('height="28"') && badgeSVG({ label: 'a', message: 'b', style: 'for-the-badge' }).includes('>A<'), 'for-the-badge upper case');
  ok(!badgeSVG({ label: '<x>', message: '"&' }).includes('<x>'), 'text escaped');
  ok(badgeSVG({ message: 'x', color: 'white' }).includes('fill="#333"'), 'dark text on light colours');
  ok(badgeSVG({ label: 'Stars', message: '12', style: 'social' }).includes('#fcfcfc'), 'social style');
  ok(textWidth('mmm') > textWidth('iii') && badgeDataURI({ message: 'x' }).startsWith('data:image/svg+xml'), 'widths and data URI');

  console.log(`badge: ${passed} passed, ${failed} failed`);
  return failed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run() ? 1 : 0;
