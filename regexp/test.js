// regexp/test.js - unit tests of the validators and the pattern generators: `node regexp/test.js` (importing the module
// runs nothing). Validators: the rules of validators.js (no wildcards, lint clean, fast on adversarial input), every
// example, and oracles (Node's net.isIPv4 / isIPv6, the Gregorian calendar, ISO weeks, Buffer's Base64, the RFC 4648
// codec, the official SemVer pattern, the JavaScript parser, Roman numeral arithmetic). Number generator: exhaustive
// and random range checks in several bases with variant characters, grouping, padding, decimals. Word lists.

import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { VALIDATORS } from './validators.js';
import { NUMBER_PRESETS, ALPHABETS, alphabetOf, formatNumber, numberPattern } from './numbers.js';
import { alternation, wordListPattern } from './wordlist.js';
import { parseRegExp, walk } from './parse.js';
import { lint } from './lint.js';
import { B32, bitsDecode, bitsEncode } from '../codec/rfc4648.js';

const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function mulberry(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Wildcards the validators must not use: '.', negated classes, \D \W \S, and negated \P{...}. The walk covers
// lookarounds too: the rule is about the whole pattern, not only the consuming part.
function wildcards(parsed) {
  const found = [];
  walk(parsed.ast, (n) => {
    if (n.type === 'CharacterSet' && (n.kind === 'any' || n.negate)) found.push(parsed.source.slice(n.start, n.end));
    if (n.type === 'CharacterClass' && n.negate) found.push(parsed.source.slice(n.start, n.end));
  });
  return found;
}

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; if (fail < 60) console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)?.slice(0, 300)}\n  want ${JSON.stringify(want)?.slice(0, 300)}`); }
  };
  const rnd = mulberry(20261013);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const byKey = Object.fromEntries(VALIDATORS.map((v) => [v.key, v]));
  // g / m stripped: g makes test() stateful through lastIndex, m would let one line of a multi-line input pass.
  const compile = (v) => new RegExp(v.source, v.flags.replace(/[gm]/g, ''));

  // --- validators: rules and examples ----------------------------------------------------------------------------
  const keys = new Set();
  for (const v of VALIDATORS) {
    eq(`${v.key} unique key`, keys.has(v.key), false);
    keys.add(v.key);
    const parsed = parseRegExp(v.source, v.flags);
    eq(`${v.key} parses`, parsed.ok, true);
    if (!parsed.ok) continue;
    eq(`${v.key} anchored`, v.source.startsWith('^') && v.source.endsWith('$'), true);
    eq(`${v.key} no wildcards`, wildcards(parsed), []);
    eq(`${v.key} lint`, lint(parsed).filter((w) => w.severity !== 'info').map((w) => w.code), []);
    eq(`${v.key} has named groups`, parsed.names.length > 0, true);
    eq(`${v.key} has examples`, v.valid.length > 1 && v.invalid.length > 1, true);
    const re = compile(v);
    for (const s of v.valid) eq(`${v.key} accepts ${JSON.stringify(s)}`, re.test(s), true);
    for (const s of v.invalid) eq(`${v.key} rejects ${JSON.stringify(s)}`, re.test(s), false);
    // Adversarial inputs: long runs of the characters of every example, with and without a failing tail. The 60 ms
    // threshold is generous for linear patterns and far below what exponential backtracking takes at these lengths.
    let worst = 0;
    for (const s of [...v.valid, ...v.invalid].slice(0, 6)) {
      const chars = [...new Set(Array.from(s))].slice(0, 6);
      const inputs = [s.repeat(40) + '\u0001', s.slice(0, -1).repeat(40), ...chars.map((c) => c.repeat(3000) + '!'), ...chars.map((c) => s + c.repeat(2000))];
      for (const x of inputs) { const t0 = performance.now(); re.test(x); worst = Math.max(worst, performance.now() - t0); }
    }
    eq(`${v.key} fast on adversarial input`, worst < 60 ? 'fast' : `${worst.toFixed(1)} ms`, 'fast');
  }

  // Oracles: independent implementations (Node's parsers, procedural rules) decide the expected answer, so the
  // tests do not merely restate the regex. Seeded PRNG keeps failures reproducible.
  // --- oracles ------------------------------------------------------------------------------------------------
  // IPv4 / IPv6 against Node's parser.
  const ipv4 = compile(byKey.ipv4), ipv6 = compile(byKey.ipv6);
  for (let i = 0; i < 4000; i++) {
    const octet = () => pick([String(Math.floor(rnd() * 256)), String(Math.floor(rnd() * 400)), '0' + Math.floor(rnd() * 99), '00', '']);
    const s = Array.from({ length: pick([3, 4, 4, 4, 5]) }, octet).join('.');
    eq(`ipv4 oracle ${s}`, ipv4.test(s), net.isIPv4(s));
  }
  const h16 = () => Math.floor(rnd() * 65536).toString(16).padStart(pick([1, 2, 4]), '0');
  for (let i = 0; i < 6000; i++) {
    let groups = Array.from({ length: 8 }, h16);
    if (rnd() < 0.3) groups = [...groups.slice(0, 6), [1, 2, 3, 4].map(() => Math.floor(rnd() * 260)).join('.')];
    let s = groups.join(':');
    if (rnd() < 0.6) { // compress a run
      const a = Math.floor(rnd() * groups.length), b = a + Math.floor(rnd() * (groups.length - a));
      s = groups.slice(0, a).join(':') + '::' + groups.slice(b + 1).join(':');
    }
    if (rnd() < 0.15) s = s.replace(/[0-9a-f]/, pick(['g', ':', '', '::']));
    if (rnd() < 0.1) s = s.toUpperCase();
    if (rnd() < 0.05) s += ':' + h16();
    eq(`ipv6 oracle ${s}`, ipv6.test(s), net.isIPv6(s));
  }
  // Calendar dates: every day of 1896–2104 and of the leap-year edge centuries, plus Feb 29 of every year.
  const date = compile(byKey.date);
  const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = (y, m) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  const p2 = (n) => String(n).padStart(2, '0'), p4 = (n) => String(n).padStart(4, '0');
  let dateBad = 0;
  for (const y of [...Array.from({ length: 209 }, (_, i) => 1896 + i), 0, 4, 100, 400, 1600, 1700, 2400, 9996, 9999]) {
    for (let m = 0; m <= 13; m++) for (let d = 0; d <= 32; d++) {
      const ok = m >= 1 && m <= 12 && d >= 1 && d <= dim(y, m);
      if (date.test(`${p4(y)}-${p2(m)}-${p2(d)}`) !== ok) dateBad++;
    }
  }
  for (let y = 0; y <= 9999; y++) if (date.test(`${p4(y)}-02-29`) !== leap(y)) dateBad++;
  eq('date oracle', dateBad, 0);
  // Ordinal dates and ISO week dates (53-week years from the Gregorian calendar via Date).
  const ordinal = compile(byKey.ordinalDate), week = compile(byKey.weekDate);
  // ISO 8601: a year has 53 weeks when 1 January is a Thursday, or a Wednesday in a leap year.
  const jan1 = (y) => { const d = new Date(Date.UTC(2000, 0, 1)); d.setUTCFullYear(y); return d.getUTCDay(); };
  const weeksIn = (y) => (jan1(y) === 4 || (leap(y) && jan1(y) === 3) ? 53 : 52);
  let weekBad = 0, ordBad = 0;
  for (let y = 1; y <= 9999; y++) {
    if (week.test(`${p4(y)}-W53`) !== (weeksIn(y) === 53)) weekBad++;
    if (ordinal.test(`${p4(y)}-366`) !== leap(y)) ordBad++;
  }
  eq('week-53 oracle', weekBad, 0);
  eq('ordinal-366 oracle', ordBad, 0);
  // Base64 / Base64url canonical forms against Buffer; Base32 against the RFC 4648 codec.
  const b64 = compile(byKey.base64), b64url = compile(byKey.base64url), b32 = compile(byKey.base32);
  const alpha64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  for (let i = 0; i < 3000; i++) {
    const bytes = Buffer.from(Array.from({ length: Math.floor(rnd() * 12) }, () => Math.floor(rnd() * 256)));
    eq('base64 encodes', b64.test(bytes.toString('base64')), true);
    eq('base64url encodes', b64url.test(bytes.toString('base64url')), true);
    eq('base32 encodes', b32.test(bitsEncode(bytes, B32, { pad: true })), true);
    const s = Array.from({ length: Math.floor(rnd() * 10) }, () => pick([...alpha64])).join('');
    eq(`base64 canonical ${s}`, b64.test(s), /^[A-Za-z0-9+/]*={0,2}$/.test(s) && s.length % 4 === 0 && Buffer.from(s, 'base64').toString('base64') === s);
    const u = s.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    eq(`base64url canonical ${u}`, b64url.test(u), u.length % 4 !== 1 && Buffer.from(u, 'base64url').toString('base64url') === u);
    const t = Array.from({ length: 8 * Math.floor(rnd() * 3) }, () => pick([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567='])).join('');
    let canon32 = false;
    try { canon32 = /^(?:[A-Z2-7]{8})*(?:[A-Z2-7]{2}={6}|[A-Z2-7]{4}={4}|[A-Z2-7]{5}={3}|[A-Z2-7]{7}=)?$/.test(t) && bitsEncode(bitsDecode(t, B32), B32, { pad: true }) === t; } catch { canon32 = false; }
    eq(`base32 canonical ${t}`, b32.test(t), canon32);
  }
  // SemVer against the official pattern of semver.org (on identifiers within the documented limits).
  const official = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
  const semver = compile(byKey.semver);
  const part = () => pick(['0', '1', '01', '10', 'a', '0a', 'alpha', '-', '00', 'x-y', '']);
  for (let i = 0; i < 3000; i++) {
    let s = [pick(['0', '1', '12', '01']), pick(['0', '3', '00']), pick(['0', '7'])].join('.');
    if (rnd() < 0.6) s += '-' + Array.from({ length: 1 + Math.floor(rnd() * 3) }, part).join('.');
    if (rnd() < 0.4) s += '+' + Array.from({ length: 1 + Math.floor(rnd() * 3) }, part).join('.');
    eq(`semver oracle ${s}`, semver.test(s), official.test(s));
  }
  // JavaScript identifiers against the engine's own parser (strict mode).
  const ident = compile(byKey.jsIdentifier);
  for (const s of ['a', 'Ωmega', '_', '$1', 'a‍b', '1a', 'class', 'yield', 'let', 'static', 'enum', 'implements', 'café', 'x-y', '℘', '℮', 'a·b', '゛', 'ゝ', '𝑥', 'ab cd', 'null', 'true', 'undefined', 'NaN', 'arguments']) {
    let engine;
    try { new Function(`"use strict"; let ${s};`); engine = true; } catch { engine = false; }
    if (s === 'arguments') engine = true; // valid identifier, only special in some positions
    eq(`js identifier ${s}`, ident.test(s), engine);
  }
  // Roman numerals: every canonical numeral 1–3999 matches, other strings of the same letters do not.
  const roman = compile(byKey.roman);
  const toRoman = (n) => [['M', 1000], ['CM', 900], ['D', 500], ['CD', 400], ['C', 100], ['XC', 90], ['L', 50], ['XL', 40], ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]]
    .reduce((acc, [s, v]) => { while (n >= v) { acc += s; n -= v; } return acc; }, '');
  const canonical = new Set(Array.from({ length: 3999 }, (_, i) => toRoman(i + 1)));
  let romanBad = 0;
  for (const s of canonical) if (!roman.test(s)) romanBad++;
  for (let i = 0; i < 20000; i++) {
    const s = Array.from({ length: 1 + Math.floor(rnd() * 7) }, () => pick([...'MDCLXVI'])).join('');
    if (roman.test(s) !== canonical.has(s)) romanBad++;
  }
  eq('roman oracle', romanBad, 0);
  // Host names: the rules of RFC 1123 written procedurally.
  const host = compile(byKey.hostname);
  const hostOk = (s) => {
    const t = s.endsWith('.') ? s.slice(0, -1) : s;
    if (!t.length || t.length > 253) return false;
    return t.split('.').every((l) => l.length >= 1 && l.length <= 63 && /^[a-z0-9-]+$/i.test(l) && !l.startsWith('-') && !l.endsWith('-'));
  };
  for (let i = 0; i < 4000; i++) {
    const s = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => Array.from({ length: Math.floor(rnd() * (rnd() < 0.05 ? 70 : 8)) }, () => pick([...'ab9-_.Z'])).join('')).join('.');
    eq(`hostname oracle ${s}`, host.test(s), hostOk(s));
  }

  // --- number generator -----------------------------------------------------------------------------------------
  const BIGS = ['0', '1', '-1', '7', '9', '10', '99', '100', '127', '128', '255', '256', '999', '1000', '-128', '-129', '-1000', '4095', '65535'];
  // Exhaustive membership over a window of values for random small ranges, in several alphabets with variants.
  for (const alphabet of ['dec', 'hex', 'bin', 'oct', 'arabicIndic', 'chinese', 'decAnyScript']) {
    const digits = alphabetOf(alphabet);
    for (let k = 0; k < 6; k++) {
      let a = BigInt(Math.floor(rnd() * 3000) - (k % 2 ? 1500 : 0)), b = a + BigInt(Math.floor(rnd() * (k < 3 ? 300 : 3000)));
      if (k === 0) { a = 0n; b = 255n; }
      for (const leadingZeros of ['no', 'yes']) {
        const r = numberPattern({ alphabet, kind: 'integer', min: String(a), max: String(b), leadingZeros, sign: 'minus' });
        if (r.error) { eq(`range ${alphabet} [${a},${b}] error`, r.error, null); continue; }
        eq(`range ${alphabet} [${a},${b}] examples`, r.mismatches, []);
        const re = new RegExp(r.source, 'u');
        let bad = [];
        for (let v = a - 40n; v <= b + 40n; v++) {
          const s = formatNumber(v, { groupSep: [','], minus: ['-'], plus: ['+'] }, { digits, rnd });
          if (re.test(s) !== (v >= a && v <= b)) bad.push(s);
          if (leadingZeros === 'no' && v > 0n && re.test(digits[0][0] + s)) bad.push('0' + s);
        }
        eq(`range ${alphabet} [${a},${b}] zeros:${leadingZeros}`, bad.slice(0, 5), []);
      }
    }
  }
  // Large ranges (int64, uint64, 128-bit) with values near the edges.
  for (const [lo, hi] of [[-(2n ** 63n), 2n ** 63n - 1n], [0n, 2n ** 64n - 1n], [-(10n ** 30n), 10n ** 38n], [123456789n, 987654321987n]]) {
    const r = numberPattern({ kind: 'integer', min: String(lo), max: String(hi) });
    const re = new RegExp(r.source, 'u');
    const bad = [];
    for (const v of [lo, hi, lo - 1n, hi + 1n, lo + 1n, hi - 1n, 0n, -1n, 1n, (lo + hi) / 2n, hi / 7n, lo / 3n, hi * 10n, lo * 10n]) {
      if (re.test(String(v)) !== (v >= lo && v <= hi)) bad.push(String(v));
    }
    eq(`range [${lo},${hi}]`, bad, []);
  }
  // Grouping (required / optional, western and Indian) and fixed width.
  const western = new RegExp(numberPattern({ kind: 'integer', min: '0', max: '9999999', grouping: 'required' }).source, 'u');
  eq('grouped required', ['0', '999', '1,000', '9,999,999'].map((s) => western.test(s)), [true, true, true, true]);
  eq('grouped required rejects', ['1000', '10,00', '1,0000', '10,000,000', ',100'].map((s) => western.test(s)), [false, false, false, false, false]);
  const indianR = new RegExp(numberPattern({ kind: 'integer', min: '0', max: '99999999', grouping: 'optional', groupStyle: 'indian' }).source, 'u');
  eq('indian optional', ['1,00,000', '100000', '12,34,567', '9,99,99,999', '1,000', '1000'].map((s) => indianR.test(s)), [true, true, true, true, true, true]);
  eq('indian optional rejects', ['100,000', '1,00,0000', '99,99,99,999'].map((s) => indianR.test(s)), [false, false, false]);
  const fixed = new RegExp(numberPattern({ alphabet: 'hex', kind: 'integer', min: '0', max: '4095', leadingZeros: 'pad', width: 3 }).source, 'u');
  eq('fixed width hex', ['000', 'fff', 'FfF', '0aB', 'ff', '1000'].map((s) => fixed.test(s)), [true, true, true, true, false, false]);
  for (const s of BIGS) eq(`uint8 ${s}`, new RegExp(numberPattern(NUMBER_PRESETS.uint8).source, 'u').test(s), BigInt(s) >= 0n && BigInt(s) <= 255n && !/^-/.test(s));
  // Every preset: examples agree with the pattern, the pattern parses, has no wildcards and lints clean.
  for (const [k, p] of Object.entries(NUMBER_PRESETS)) {
    for (const anchor of ['line', 'find']) {
      const r = numberPattern({ ...p, anchor });
      eq(`preset ${k}/${anchor} ok`, !r.error && r.valid.length > 0 && r.invalid.length > 0, true);
      eq(`preset ${k}/${anchor} examples`, r.mismatches, []);
      const parsed = parseRegExp(r.source, r.flags);
      eq(`preset ${k}/${anchor} parses`, parsed.ok, true);
      if (parsed.ok && anchor === 'line') eq(`preset ${k} lint`, lint(parsed).filter((w) => w.severity !== 'info').map((w) => w.code), []);
    }
  }
  // Decimals against an independent grammar (C-like double, JSON).
  const dbl = new RegExp(numberPattern(NUMBER_PRESETS.double).source, 'u'), json = new RegExp(numberPattern(NUMBER_PRESETS.json).source, 'u');
  const refDouble = /^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;
  const refJson = (s) => { if (!/^[-0-9.eE+]+$/.test(s)) return false; try { JSON.parse(s); return true; } catch { return false; } };
  for (let i = 0; i < 6000; i++) {
    const s = Array.from({ length: 1 + Math.floor(rnd() * 7) }, () => pick([...'0123456789.eE+-'])).join('');
    eq(`double ${s}`, dbl.test(s), refDouble.test(s) && !/^[+-]?0[0-9]/.test(s));
    eq(`json ${s}`, json.test(s), refJson(s));
  }
  // Find mode: whole numbers only, not parts of words or of out-of-range numbers.
  const finder = new RegExp(numberPattern({ ...NUMBER_PRESETS.int8, anchor: 'find' }).source, 'gu');
  eq('find int8', 'a -5, 127 and 128, x12, -128 1.5 300 -129'.match(finder), ['-5', '127', '-128']);
  // Alphabet errors are reported, not thrown.
  eq('duplicate digit', numberPattern({ digits: [['0'], ['1', '0']] }).error, 'alphabetDup');
  eq('multi-char digit', numberPattern({ digits: [['0'], ['10']] }).error, 'alphabetChar');
  eq('alphabets valid', ALPHABETS.every((a) => !numberPattern({ alphabet: a.key }).error), true);

  // --- word lists ---------------------------------------------------------------------------------------------
  const words = ['cat', 'car', 'cart', 'carton', 'dog', 'do', 'Привет', 'привал', 'a.b', 'x+y', 'C++'];
  const wl = wordListPattern(words, { whole: 'line' });
  const wre = new RegExp(wl.source, wl.flags.replace('g', ''));
  eq('wordlist all', words.every((w) => wre.test(w)), true);
  eq('wordlist none', ['ca', 'carto', 'cats', 'd', 'aXb', 'C+', 'привет'].some((w) => wre.test(w)), false);
  eq('wordlist trie', alternation(['cat', 'car', 'cart']), 'ca(?:t|rt?)');
  const ci = wordListPattern(words, { whole: 'word', caseless: true });
  const cre = new RegExp(ci.source, ci.flags);
  eq('wordlist caseless words', 'CART, the Dog and привет; cartoons'.match(cre), ['CART', 'Dog', 'привет']);
  for (let i = 0; i < 200; i++) {
    const list = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => pick([...'abcab.'])).join(''));
    const r = new RegExp(wordListPattern(list, { whole: 'line' }).source, 'u');
    const probe = [...list, ...Array.from({ length: 20 }, () => Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => pick([...'abc.'])).join(''))];
    eq(`wordlist random ${i}`, probe.filter((s) => r.test(s) !== list.includes(s)), []);
  }

  console.log(`regexp: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
