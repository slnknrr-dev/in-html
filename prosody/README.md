# prosody/

Rhyme and meter of English, Russian and Georgian verse: phonemes, syllables and stress of words, the meter of a line
and of a poem, the distance between two rhymes, the rhyme scheme, how well a line "catches" the line it must rhyme
with, and what to put at its end (the same word with other endings, other rhyming words). Pure ES modules without
dependencies and without DOM; they work in Node and in a page. Used by the rhyme and meter workshop of
`language-studio/` (`rhyme-tools.js`). Tests: `node prosody/test.js`.

## Files

| file | contents |
|---|---|
| `phonemes.js` | IPA segments with articulatory features (vowel height / backness / rounding; consonant place, manner, voice, softness, ejective / aspirated); `segDistance(a, b)` 0…1 |
| `phon-ru.js` | Russian: stress (`stressRu`: the user's mark, ё, one syllable, `dict-ru.js` with variants, analogy with dictionary words of the same ending), `transcribeRu` (softness, iotation, akanye / ikanye, devoicing and voicing assimilation, -ого, что, -тся, silent consonants, сч), syllables (`syllableSplit`), `analyzeRu`, `wordsRu`, `knownRu`, `RU_CLITICS` |
| `phon-en.js` | English: `pronounceEn` (CMUdict subset, then a dictionary stem with -s / -ed / -ing / -'d / -'st / -est / -eth / un- …, archaic forms, then spelling rules), syllables by maximal onsets, letters of each syllable, the syllables a poet may drop (ev'ry, heav'n, pow'r), `analyzeEn`, `EN_FUNCTION` |
| `phon-ka.js` | Georgian: Mkhedruli → IPA (one letter, one phoneme, old letters ჱ ჲ ჳ ჴ ჵ too), syllables (a vowel each, consonants open the next syllable), weak stress on the first syllable (secondary on the antepenult in words of five syllables and more), `analyzeKa` |
| `words.js` | `tokenize(line, lang)`, `analyzeWord(word, lang, { overrides })`, `detectLang`, `normWord` |
| `meter.js` | `METERS` (iamb, trochee, dactyl, amphibrach, anapest; Georgian shairi high 4+4+4+4, low 5+3+5+3, mixed per half-line; 12, 10, 8 syllables; syllabic; prose), `scanLine(words, lang, meter?, feet?)`, `detectMeter(lines, lang)`, `template(meter, feet, clausula)` |
| `rhyme.js` | `rhymeUnit(W, { from })`, `compareRhyme(U1, U2)` → `{ score, kind, clausula, segs }`, `rhymeDistance`, `CLAUSULA`, `KINDS` |
| `scheme.js` | `SCHEMES` (couplet, cross, enclosing, mono, rubai, sonnet, Onegin stanza, terza rima, free), `expandScheme`, `detectScheme`, `partners`, `schemeString` |
| `poem.js` | `analyzePoem(text, { lang, scheme, meter, overrides })`: words, meter, scheme, the target of every line, its rhyme, rhythm and catch scores, verdicts per line and per word; `completeScheme`, `lineEnd` |
| `morph.js` | `morphemes(word, lang)` and `splitEnding(word, lang)` through `lingua/` (Russian / English / Georgian morpheme parsers, the Georgian grammar and lexicon) |
| `suggest.js` | `modifiers(word, lang, { target, need })` (Russian case / number / agreement / person / tense / aspect / diminutive forms, Georgian cases, plurals, postpositions and screeves from `lingua/` paradigms or by rule, English -s / -ed / -ing / -er / -ness / -ly …), `endings`, `rhymeWords(target, lang, { need })` from the word lists, `needOf(line)`, `meterFit` |
| `quotes.js` | public-domain example stanzas (see below) |
| `dict-en.js`, `dict-ru.js` | generated pronunciation dictionaries (see below); `dict-codes.js` the ARPAbet codes; `frontcode.js` their reader |
| `build-dict.js` | Node script that builds `dict-en.js` and `dict-ru.js` from the sources (importing it runs nothing) |
| `test.js` | unit tests (stress, phonemes, known rhymes and non-rhymes, distance order, the meter and scheme of every example stanza, suggestions) |

## Words

A word is analysed into `W = { text, norm, lang, syl: [{ t, ph, v, st }], stress, src, alt, fn, elide }`: the letters
and IPA segments of every syllable, the stressed one, where the stress comes from (`user`, `yo`, `mono`, `dict`,
`suffix`, `guess`, `rule`, `meter`), the other stresses the dictionary knows (Russian homographs: за́мок / замо́к,
ле́су / лесу́ — the meter of the line chooses), whether the word is a clitic or function word, and the syllables that
may be elided. The user's stress marks come in as `overrides: Map(norm → syllable)`.

Russian texts often write е for ё; the dictionary records which е-forms are ё-words (звезды → звёзды, ее → её) unless
the е-form is a frequent word of its own (все, тем).

## Meter

Accentual-syllabic meters are fitted by dynamic programming over the words: every syllable costs by its level (the
stress of a polysyllable, a secondary stress, an unstressed syllable, a stressable or a clitic monosyllable) on a
strong or weak place; a word may take another stress the dictionary knows or drop an elidable syllable; the ictus of
the rhyme must carry the last stress (English may rhyme on a promoted syllable: temperate / date). The poem's meter is
the one with the least total cost, then every line is read again preferring the poem's number of feet. Issues per
syllable: `shift` (a word stress on a weak place), `pyrrhic`, `spondee`, `elided`, `caesura`, `extra`. Georgian verse
is fitted to syllabic meters: the syllable count and word boundaries at the caesuras.

## Rhyme

The rhyming part starts at the stressed vowel (Russian, English) or at the vowel of the penultimate syllable
(Georgian, whose rhyme is of two syllables, deeper with a third). Two parts compare by the stressed vowel (features,
и = ы in Russian), the material after it (an edit distance with feature costs; post-tonic reduced vowels are close,
a final й is cheap: лютый — смуты), the supporting consonant before the vowel, and the clausula (masculine, feminine,
dactylic, hyperdactylic must agree). Kinds: rich, exact, identical, poor (Russian open masculine without a supporting
consonant), slant, assonance, consonance, none. Similarities fall steeply, so a rhyme needs near identity.

The scheme is detected greedily (a line joins the best earlier line within four that it rhymes with above 0.7) and
then completed by the named scheme that agrees best with it, so that a line not rhymed yet still has a target; two
unrhymed lines are a couplet, more are free verse. The catch of a line is 0.6 × its rhyme with the target + 0.4 × its
rhythm (the meter fit less 0.15 per missing or extra syllable); ≥ 0.75 good, ≥ 0.5 fair.

## Dictionaries: sources and licences

`build-dict.js` builds both files (`node prosody/build-dict.js --cmu … --mfa … --en … --ru …`, see its header):

- **English** (`dict-en.js`, 25 000 words, ≈ 326 KB): pronunciations from **CMUdict** (Copyright © 1993-2015 Carnegie
  Mellon University; BSD-2-Clause-style licence: redistribution with the copyright notice, the conditions and the
  disclaimer, reproduced here), the variant with the most syllables. Words chosen by frequency in the Tatoeba
  English sentences.
- **Russian** (`dict-ru.js`, 30 000 word forms with stress + 2 400 frequent monosyllables, ≈ 238 KB in UTF-8): stress derived
  from the **Russian MFA dictionary v2.0.0a** by Michael McAuliffe and Morgan Sonderegger (Montreal Forced Aligner,
  **CC BY 4.0**, https://github.com/MontrealCorpusTools/mfa-models). MFA writes no stress marks; the stressed vowel
  is the one unreduced vowel of the transcription. Word forms chosen by frequency in the Tatoeba Russian sentences.
- **Frequencies**: Tatoeba sentences (https://tatoeba.org, **CC BY 2.0 FR**) — only counted, no sentence is included.
- **Georgian** needs no dictionary (phonemic spelling); candidate words come from `lingua/kartuli-lexicon.js` and its
  paradigms.

CMUdict licence (as required for redistribution):

> Copyright (C) 1993-2015 Carnegie Mellon University. All rights reserved. Redistribution and use in source and binary
> forms, with or without modification, are permitted provided that the following conditions are met: 1.
> Redistributions of source code must retain the above copyright notice, this list of conditions and the following
> disclaimer. The contents of this file are deemed to be source code. 2. Redistributions in binary form must reproduce
> the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other
> materials provided with the distribution. THIS SOFTWARE IS PROVIDED BY CARNEGIE MELLON UNIVERSITY "AS IS" AND ANY
> EXPRESSED OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
> FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL CARNEGIE MELLON UNIVERSITY NOR ITS EMPLOYEES BE LIABLE FOR
> ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
> PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED
> AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
> ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Example stanzas (quotes.js)

Short excerpts with work, author, translator, the translator's year of death, the publication, the source and the
scheme and meter the author meant. A translation is included only when its translator died at least 70 years ago.

| id | text | translator (died) |
|---|---|---|
| `shakespeare-18`, `shakespeare-130` | Shakespeare, Sonnets 18 and 130 (English, ed. Rolfe 1883) | — |
| `shakespeare-18-tchaikovsky` | Sonnet 18 in Russian (1914) | Modest Tchaikovsky (1916) |
| `shakespeare-130-gerbel` | Sonnet 130 in Russian | Nikolay Gerbel (1883) |
| `rustaveli` | Rustaveli, The Knight in the Panther's Skin, stanzas 1–2 (Georgian) | — |
| `rustaveli-balmont` | the same in Russian (1933) | Konstantin Balmont (1942) |
| `rustaveli-wardrop` | the same in English prose (1912) | Marjory Wardrop (1909) |
| `dante-longfellow` | Dante, Inferno I 1–9 in English (1867) | Henry W. Longfellow (1882) |
| `dante-min` | the same in Russian (1852, spelling modernised) | Dmitry Min (1885) |
| `dante-lozinsky` | the same in Russian (1939) | Mikhail Lozinsky (1955): public domain in Russia since 1 January 2026; in the USA the 1939–1945 publication may still be protected |

No Italian Dante is included. Not included: a public-domain Georgian Dante (the Georgian Divine Comedy is by
Konstantine Gamsakhurdia, died 1975) and Ivane Machabeli's Georgian Shakespeare (public domain, but no digitised text
could be checked against an edition).

## Limits

- Stress outside the dictionaries is a guess: Russian by analogy of endings (then the penultimate), English by spelling
  rules; homographs take the first dictionary variant unless the meter of the line prefers another. Click a syllable
  to correct it.
- English is General American (CMUdict); historical and British rhymes (love / prove, temperate / date) show as weak.
- Georgian stress is weak and described differently by different grammars; Georgian meters are syllabic only.
- Word modifiers built by rule and found in no dictionary are shown only when they rhyme best, marked "by rule".
