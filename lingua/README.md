# lingua

Language primitives without DOM, used by `language-studio/`. Tests: `node lingua/test.js`.

| module | contents |
|---|---|
| `srs.js` | spaced repetition (compact SM-2): `review(card, grade)`, `dueItems`, `strength`, `merge` |
| `iast.js` | Sanskrit IAST ↔ Devanagari with Rigvedic accent marks (udātta unmarked, anudātta ॒ before, svarita ॑ after), Vedic ḷ, syllables with their weight |
| `sandhi.js` | external sandhi: vowels (savarṇa, guṇa, vṛddhi, yaṇ, ay / av, avagraha), visarga, final consonants; every rule explained in Russian and English |
| `meter.js` | Vedic scansion: pādas, guru / laghu, the meter by syllable counts with restored syllables, cadence check |
| `kana.js` | hiragana / katakana tables, romaji ↔ kana (small tsu, yōon, long vowels) |
| `pinyin.js` | tone numbers ↔ marks, syllable = initial + final + tone, third-tone sandhi |
| `kartuli.js` | Georgian: transliteration (Latin, Russian), noun cases, plural and postpositions (with syncope), verb forms by slots (preverb, person, version, root, thematic suffix, screeve, ending) in six screeves and three versions, a splitter, vigesimal numbers |
| `russian.js` | Russian morpheme analysis by inventory (prefixes, roots with alternations, interfixes, suffixes, endings, -ся / -те) with glosses; transliteration |
| `kartuli-lexicon.js`, `kartuli-lexicon-more.js` | a Georgian dictionary of about 1 900 headwords (the extra list only adds words the main one lacks) for learners (nouns with stem types and syncope, proper names, adjectives, pronouns, numerals, postpositions, conjunctions, particles, adverbs, interjections, verbs with class, preverb and principal parts), Russian and English glosses, frequency tiers, unverified forms marked |
| `kartuli-grammar.js` | full noun paradigms (seven cases, -ებ- and the old -ნი / -თა plural, postpositions), adjective agreement, pronouns, verbs in all three series with person markers, versions, inversion and suppletive verbs, the case frame of each verb class and series, a word-form analyser by reverse lookup |
| `kartuli-input.js` | Georgian typed in Latin (national romanisation, ISO 9984-like, loose spellings) or Russian transcription; ambiguous sounds resolved by the lexicon, wrongly marked ejectives / aspirates / uvulars flagged with an explanation; IPA and sound notes |
| `kartuli-syntax.js` | the sentence builder (arguments put into the cases the verb class and series demand, with the reason for each) and the sentence analyser (readings, clauses on conjunctions and relative words, predicate and arguments, agreement issues, participle and masdar constructions, quotative particles) |
| `discourse.js` | text analysis for Georgian, Russian and English: sentences, clauses, who does what to whom, entities with coreference, the topic chain, events, dialogue lines with speakers, addressees and the author's words; clause / entity / topic graphs for `diagram/` and their Mermaid text |
| `morph.js` | a morpheme parser before (and beside) a dictionary: slots of prefixes / preverbs, roots (an unknown root when nothing fits, compounds after a linking vowel), suffixes, endings and postfixes searched by inventories; derivation rules give the probable rule and the meaning of the word; register labels on three axes — everyday use, correctness, literariness — and "not found in literature, but with its own meaning by rule" for well-formed words no source attests |
| `morph-ka.js`, `roots-ka.js` | Georgian on `morph.js`: preverbs, circumfixes (მე-…-ე, სა-…-ე / -ო, უ-…-ო, სი-…-ე, ნა-…-ი, მ-…-ელი, უ-…-ესი), suffixes, cases and postpositions; roots from the dictionary and seeded word families with flags; search by preverb / prefix / root / suffix; the possible words of a root |
| `morph-ru.js`, `roots-ru.js` | Russian on `morph.js`: prefixes, roots with alternants (seeded families plus the inventory of `russian.js`), derivational and formative suffixes, endings, -ся; compounds; substandard / colloquial / bookish / archaic labels; prefixed verbs with assimilation (рас- / ис-) |
| `morph-en.js` | English on `morph.js`: prefixes, Latin, Greek and Germanic roots with families, suffixes and inflections, labels (substandard irregardless, colloquial gonna) |
| `hangul.js`, `korean.js`, `korean-lexicon.js` | Korean: Hangul blocks ↔ jamo, the keyboard automaton, the standard pronunciation with every sound change and its rule, Revised Romanization, Kontsevich Cyrillic, Latin → Hangul; morphology by rule (a forward conjugator with the irregular classes and a parser into stem + suffixes + ending or noun + particles, with rule, confidence, speech level and register); a seed dictionary of ~420 words; tests in `hangul-test.js` |
| `megruli.js` | Mingrelian: the alphabet (+ ჷ ჸ ჲ) with IPA, transliteration both ways, a learner's lexicon with Georgian cognates and unverified flags, cases, plural, preverbs, screeves, a rule-first parser, Georgian ↔ Mingrelian sound correspondences that propose and explain cognates; tests in `megruli-test.js` |
| `strokes.js` | handwriting against a model: resampling, fitting, stroke matching (count, order, direction, shape), chamfer distance fields and ink comparison |
| `translit.js` | official romanisations: Georgian national system 2002 (`romanizeKa`, with or without apostrophes; `kaFromLatin` back), Russian ICAO 9303 (`romanizeRu`), Ukrainian KMU 2010 (`romanizeUk`), `romanize(text, { lang })` for mixed text, ASCII URL slugs `slugify(text, { lang, max, sep })`; tests in `translit-test.js` |
| `scripts.js` | writing systems of identifiers: `scriptOf`, `scriptsOf`, `mixesScripts`, homoglyph `skeleton` / `confusable`, `cleanId`, `checkId(raw, { min, max, reserved })` → `{ id, reason }` |
| `xlinks.js` | word links across languages: Indo-European cognates (Russian, English, Sanskrit), loanwords with their path, calques, Sino-xenic words (Chinese, Japanese, Korean), Georgian ↔ Mingrelian cognates, false friends; `linksFor(lang, word, { root })` finds a word, an inflected form or a morpheme root; `searchLinks` |
| `bilex.js` | one dictionary over several lexicons: entries indexed by headword and by every gloss (`glossKeys`), `lookup` from either side (back-lookup Russian / English → Georgian…), `equivalents` of an entry in other languages through a pivot gloss |
| `typein.js` | Latin typing of every script: Georgian, Mingrelian, Russian Cyrillic (`latinToCyrillic`: scholarly, passport and chat spellings), Devanagari (IAST, Harvard-Kyoto, Velthuis: `asciiToIast`), hiragana / katakana, Hangul with alternatives, pinyin tone marks; `typeIn(text, target)` |
| `decks.js` | spaced-repetition decks between any two languages: `deckPairs(entries, from, to)` direct from glosses or through a pivot language (Georgian → Korean via Russian), stable card ids `x:from>to:word` |
| `contrast.js` | a Georgian sentence (`kartuli-syntax.js` `buildSentence`) against Russian or English: the case or position of each argument, the tense and aspect for the screeve, word order, notes on the ergative, the dative subject, the evidential, ვერ |
| `align.js` | parallel texts: `sentencesOf`, `alignSentences` / `alignTexts` (Gale–Church length cost with 1-0 … 2-2 beads plus name and number anchors romanised across scripts, `nameKey`), `matchEntities` (by name, by a dictionary callback, by co-occurrence as a mutual best), `mapSentences` between two splits |
| `sounds.js` | the same sound in another script: letters of Georgian, Cyrillic, Hangul, Devanagari and English IPA with their sounds, `features`, `distance` (place, manner, voice, the laryngeal series, vowel height / backness / rounding / length), `counterparts(script, letter, toScript)` with what differs |

## Romanisation and slugs

`translit.js` follows the official tables, not reading aids (those are `kartuli.js` / `russian.js` `translit`):

- Georgian 2002: ქ k / კ k', ფ p / პ p', თ t / ტ t', ც ts / წ ts', ჩ ch / ჭ ch', ყ q', ღ gh, ხ kh, ჟ zh, შ sh, ძ dz, ჯ j;
  `apostrophes: false` drops the ejective marks as passports and road signs do. Mtavruli capitals become capitals.
  `kaFromLatin` reads the national system back (longest unit first, `t's` = ტს); loose spellings need
  `kartuli-input.js`.
- Russian ICAO 9303 (passports since 2014): ё e, й i, х kh, ц ts, щ shch, ъ ie, ь dropped, ю iu, я ia.
- Ukrainian KMU 2010: г h, ґ g, и y, і i; є ї й ю я are ye yi y yu ya at the start of a word and ie i i iu ia inside it
  (also after an apostrophe: Знам'янка → Znamianka); зг → zgh; ь and the apostrophe are dropped.
- Case: Щука → Shchuka, ЩУКА → SHCHUKA. `romanize` with `lang: 'auto'` treats Cyrillic as Ukrainian when the text
  has і ї є ґ.

`slugify` romanises (Georgian without apostrophes), strips accents (é → e, ß → ss), lower-cases and joins the
remaining `[a-z0-9]` runs with `sep`, cut at `max` without a trailing separator; `spa/route.js` `slugify` instead keeps
the original script.

## Identifiers and scripts

`checkId` admits user-chosen ids (group names, handles): lower case, Unicode letters kept, one letter script per id
(digits and `-` belong to none; Han with kana / Hangul count as one), reserved words refused also through look-alikes
(`skeleton` maps Cyrillic а е о р с у х і ј, Greek ο α ν ρ…, 0 → o, 1 → l, rn → m to one Latin shape). Reasons:
`empty`, `no-letters`, `too-short`, `mixed-scripts`, `reserved`.

## Across languages

`xlinks.js`, `bilex.js`, `typein.js`, `decks.js`, `contrast.js`, `align.js` and `sounds.js` join the single-language
modules; tests in `xlang-test.js`. They hold no DOM and no course data: `language-studio/xl-data.js` feeds them the
words of every course.

- Word links are curated and each set says what kind of link it is. Cognates are given only where the common ancestor
  is established (Russian красный is not related to English red, руда is); a Georgian word is never a cognate of an
  Indo-European one — Georgian enters as a loan source or target, through calques and as a false friend.
- The dictionary across languages pivots on glosses, so it is as good as the glosses: equivalents are candidates with the
  pivot language shown, not translations.
- Decks: a direct card comes from a word list that glosses its words in the other language; a pivot card joins two words
  whose glosses share a sense key. Card ids live in the same progress document as the course cards.
- Alignment works for any pair of scripts; entities exist only where `discourse.js` analyses the text (Georgian, Russian,
  English).
- Sound counterparts use broad phonemic values (Russian ш as /ʂ/, Korean lax ㄱ as /k/); `exact` means the same features,
  otherwise `diff` lists what differs.
