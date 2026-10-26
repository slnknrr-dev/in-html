# language-studio

Language Studio: eight languages from their letters to their poetry. Each course has lessons, its scripts, constructors
and analysers, mini-games and a dictionary; the explanations are in the languages the learners of that course speak.

| course | explained in | special |
|---|---|---|
| Vedic Sanskrit (sa) | Russian, English | Devanagari ↔ IAST with Rigvedic accent marks, sandhi with every rule explained, compound constructor, meter scanner (gāyatrī, anuṣṭubh, triṣṭubh, jagatī…), recitation and pitch accent, Rigveda quotations, concepts and modifiers |
| Georgian (ka) | Russian | typing in Latin or Russian transcription with corrections for wrongly marked sounds, a word-form explorer over a dictionary of ~1 600 headwords (every case, number and postposition; every screeve and person with the case frame), a sentence designer that explains each case, text analysis; word splitter (preverb, person, version, root, thematic suffix, screeve, ending — ნა+ხვ+ა+მ+დ+ის), verb constructor with versions and screeves, analogues with other preverbs, cases and postpositions, vigesimal numbers, situations, a supra with several speakers, Rustaveli and Baratashvili |
| Mingrelian (xmf) | Russian, English | the Georgian letters with ჷ ჸ ჲ, sound correspondences with Georgian (a ↔ o, e ↔ a, sibilant ↔ hushing, l ↔ r, q' ↔ ʔ) shown on every word, nine cases, the verb with the 1st / 2nd person -k, a rule-first word parser and a cognate explorer; forms not confirmed in the standard grammars and dictionaries are marked unverified |
| Japanese (ja) | Russian, Chinese | hiragana, katakana, kanji with on / kun readings, comparison with traditional and simplified Chinese, false friends, character constructor, haiku |
| Chinese (zh) | Russian, Japanese | pinyin and tones (initial / final / tone, tone sandhi), simplified and traditional hanzi, compounds and their literal sense, character constructor, Tang poetry with the Japanese kanbun reading |
| Korean (ko) | Russian, English | Hangul by letters and syllable blocks, the standard pronunciation with every sound change explained, Revised Romanization and Kontsevich Cyrillic, typing in Latin, a word parser (stem, -(으)시-, tense, ending or noun and particles, with the rule and a confidence), native and Sino-Korean numbers, speech levels and honorifics, dialogues, classical sijo |
| Russian (ru) | English | morpheme analyser, the original neutral sense of words against their modern narrowing (сочувствую = "I co-feel", not only condolence), prefixes, Pushkin, Lermontov, Tyutchev |
| English (en) | Russian | the sounds (IPA), etymologies, sets of borrowings, why spelling and pronunciation differ, IT naming and abbreviation culture (the GIF question), history |

**Morphemes** (Georgian, Russian, English): any word taken apart before the dictionary — preverb or prefix, root,
suffixes, ending — with the probable rule and what it makes the word mean; search by preverb, prefix, root and suffix
with filters by everyday use, correctness and literariness; every word the rules build from a root, attested or marked
"not found in literature, but with its own meaning by rule". The dictionary of these courses filters by the same labels.

**Text analysis** (Georgian, Russian, English): paste a sentence or a text and get sentences and clauses, who does
what to whom, entities followed through the text (pronouns and dropped subjects too), the topic chain (continued /
shifted / returned / new), events in order, dialogue lines with speakers, addressees and the author's words, complex
constructions; the annotated text, clause / entity / topic graphs drawn with `diagram/` and their Mermaid text.

**Mini-games everywhere**: symbol → sound, sound → symbol, type the transcription, listen and choose (with an
installed system voice), **draw the letter** from its sound or **trace** it over the model. The drawing is compared
with the model by ink (a distance transform against the system font glyph, any script) and, for characters with
stroke data, by stroke count, order, direction and shape; a heat map shows where the line went off.
Spaced-repetition cards (SM-2) for letters and words. Course games: build a Georgian verb from its morphemes, sandhi
quiz, heavy / light syllables, Chinese tones, compose a character, find the Russian root, where an English word comes
from.

**C1 and C2** (`courses/adv-*.js`, joined to their courses in `courses/index.js`). Before: English, Russian, Korean
and Chinese reached B2, Japanese and Mingrelian B1, Georgian and Sanskrit had one C1 lesson each. Now:

| course | C1 | C2 |
|---|---|---|
| English | inversion; cleft sentences; modality (must have done, needn't have, be to…); collocations (20 cards); register and hedging; idioms (16 cards); Dickens, *A Tale of Two Cities* (1859) | the subjunctive and set formulas; understatement, litotes, irony; word formation (back-formation, conversion, Latin chains); learned words and eponyms (20 cards); Shakespeare, sonnet 18 (1609) |
| Russian | participles; verbal adverbs and the same-subject rule; aspect in detail; long words taken apart; idioms (14 cards); Chekhov, "The Death of a Civil Servant" (1883) | functional styles and канцелярит; particles and theme / rheme order; bookish and archaic words (14 cards); Tyutchev, "Silentium!" (1830) |
| Georgian | series II (aorist, optative and its uses); series III (the evidential perfect, the pluperfect); versions; causatives; participles and masdars; idioms (12 cards) | the legend of Tbilisi told with the evidential (written for the studio); politeness and register; abstract vocabulary (15 cards); long words taken apart |
| Vedic Sanskrit | (one lesson already) | the Hymn of Creation (RV 10.129) read whole; its vocabulary (12 cards) |
| Japanese | keigo; Kamo no Chōmei, *Hōjōki* (1212) | — |
| Chinese | the Analects 1.1 with the Japanese kanbun reading; chengyu with their Japanese counterparts (10 cards) | — |
| Korean | reported speech and its contractions; Sino-Korean words with their characters in Chinese and Japanese (14 cards) | — |
| Mingrelian | — | — |

Each grammar lesson ends with a **quiz** (answered in place, with the reason) and **try** links that open a constructor
or parser on a word, also in another course (`lesson-extra.js`: blocks `{ quiz }` and `{ try }`); word lists are
spaced-repetition cards like every `words` lesson. Readings are public-domain originals (authors dead for centuries or
more than 70 years) or texts written for the studio; all translations are the studio's own (Marshak's and other
copyrighted translations are not used). Not done, on purpose: C2 for Japanese, Chinese and Korean would need a
character base far beyond the courses' 50 characters; Mingrelian has no standard literary norm or graded corpus, and its
learner lexicon (~200 words, part unverified) cannot carry C1 material without inventing forms.

**Across languages** (`xl-tools.js`, one tool tab in every course with five panels, route
`#course/tools/xl/<panel>/<arg>`; the logic in `lingua/` `xlinks.js`, `bilex.js`, `typein.js`, `decks.js`,
`contrast.js`, `align.js`, `sounds.js`):

- **Word families**: Indo-European cognates (Russian · English · Sanskrit), loanwords with their path (тамада,
  Vauxhall → вокзал → ვაგზალი), calques (небоскрёб / ცათამბჯენი, независимость / დამოუკიდებლობა / independence),
  one Chinese word in Chinese, Japanese and Korean, Georgian ↔ Mingrelian, false friends (მამა / мама). Every word opens
  in its course. The **morpheme workbench** shows the families of the parsed word or its root under the parse.
- **Dictionary across languages**: one index over every course's words and the Georgian, Mingrelian and Korean lexicons;
  a word or a meaning in any language finds headwords and back-lookups (вода / water → წყალი, წყარი, 물), each entry with
  its equivalents through the shared gloss, the Mingrelian ↔ Georgian cognate and its word family. The **course
  dictionaries** show the same equivalents on every row (Russian and English words with their Georgian, Korean… counterparts);
  the Mingrelian cognate explorer links to the Georgian word forms.
- **Type any script**: Latin input for Georgian, Mingrelian, Russian Cyrillic, Devanagari (IAST, Harvard-Kyoto,
  Velthuis), hiragana, katakana, Hangul and pinyin with tone marks (with the course's characters for each syllable).
- **Cards: any pair**: spaced repetition between any two of the eight languages, direct or through a pivot gloss
  (Georgian → Korean via Russian), stored with the rest of the progress.
- **Parallel texts** (Georgian, Russian, English courses): two texts written in three languages for the studio or your own
  pair; sentences aligned by length and by names and numbers read across scripts; entities of both texts matched by
  name, through the dictionary or by co-occurrence, and coloured alike on both sides.
- **The sentence designer** (Georgian) shows the same sentence's structure in Russian or English: the case or position
  of each argument, the tense and aspect for the screeve, word order, and what differs (ergative, dative subject,
  evidential, ვერ).
- **Same sound, another script** (game in the Georgian, Mingrelian, Russian, Korean, Sanskrit and English courses): a
  letter's sound is matched in Georgian, Cyrillic, Hangul, Devanagari or IPA, with what differs (aspirated ქ = ㅋ = ख,
  while Russian к is plain), then the counterpart is drawn and compared with its font glyph.

Not joined, on purpose: stroke-order data exists only for CJK characters, so cross-script drawing is judged by ink;
kana and hanzi are syllabic / logographic and stay out of the sound game; text analysis (entities, clauses) stays
Georgian, Russian and English.

**Rhyme and meter** (English, Russian, Georgian; `rhyme-tools.js` on [`prosody/`](../prosody/)): lines of verse with
their words split into syllables (click one to move the stress, remembered in the progress document), grey blocks of
the syllables the meter needs under each line (stressed places larger), coloured blocks of the rhyme sounds that catch
the target line, the catch score of each line and its words in green / yellow / red, the ending of the active line's
last word in editable squares with suggested endings, word modifiers (case, number, person, tense, aspect,
diminutive…) and rhyme words ranked by distance and meter fit, morphemes; the scheme and meter detected or chosen;
public-domain examples: Shakespeare, Rustaveli in Georgian and in Balmont's and Wardrop's translations, Dante in
Longfellow's, Min's and Lozinsky's (`#ru/tools/rhyme/dante-min`).

Modes:

- **backend** (`BACKEND_NOTICE.md`): registration, sign-in, accounts; progress stored on the server and merged with the
  browser's copy;
- **serverless** and **offline** (`SERVERLESS_NOTICE.md`, `SINGLEFILE_OFFLINE_NOTICE.md`): progress in IndexedDB,
  export / import as JSON; the offline build has no network code at all (`account.offline.js`).

Artifacts: `node singlefile.js language-studio`; the demo `demo/language-studio.html` in the Pages repository
(`DEMO_NOTICE.md`). Development: `node language-studio/server.js` (mounts the backend; data in `language-studio/.data/`),
then open `/language-studio/`.

## Files

| file | contents |
|---|---|
| `main.js` | shell, routing (`#course/learn|letters|tools|games|dict`), home, letters, dictionary, progress, account box |
| `views.js` | lesson renderers: texts, words, morpheme chips, dialogues, poems, etymologies, characters, variants, paradigms, declension |
| `tools.js` | constructors and analysers of each course |
| `ko-tools.js`, `xmf-tools.js` | the Korean syllable composer and word parser; the Mingrelian word parser and cognate explorer |
| `morph-tools.js` | the morpheme workbench and the label filters of the dictionary |
| `text-tools.js` | the Georgian workbench (transcription input, word forms, sentence designer) and the text analysis of the Georgian, Russian and English courses |
| `rhyme-tools.js`, `strings-rhyme.js`, `rhyme.css` | the rhyme and meter workshop, its UI strings (7 languages) and styles |
| `games.js` | the mini-games and their shell (rounds, scores, spaced repetition) |
| `draw.js` | drawing pad, model raster (font or stroke data), evaluation and heat map |
| `speech.js` | pronunciation through the system's speech voices (Web Speech API) |
| `progress.js` | the progress document, validation and merge (shared with the server) |
| `store.js` | IndexedDB storage (localStorage fallback) |
| `account.js` / `account.offline.js` | sign-in, registration, synchronisation / the offline stand-in |
| `service.js`, `backend.js` | the account and progress API |
| `courses/*.js` | the six courses (`ka`, `en`, `ja`, `zh`, `sa`, `ru`), shared CJK data (`cjk.js`), notation helpers (`util.js`) |
| `strings.js` | UI strings (en, ru, uk, de, fr, es, ka) |
| `courses/adv-*.js`, `lesson-extra.js` | the C1 / C2 lessons of English, Russian, Georgian, Sanskrit, Japanese, Chinese and Korean; the quiz and try lesson blocks |
| `xl-tools.js`, `xl-games.js`, `xl-data.js`, `strings-xl.js` | the cross-language tool (word families, dictionary, typing, decks, parallel texts) and the panels it lends to the morpheme workbench, the sentence designer and the dictionaries; the letter game across scripts; the shared data and parallel texts; their UI strings |
| `test.js`, `e2e.js` | unit tests (`node language-studio/test.js`), browser check (`node check.js e2e URL language-studio/e2e.js`) |

The language logic lives in the library [`lingua/`](../lingua/): spaced repetition, IAST and Devanagari, sandhi,
meters, kana, pinyin, Georgian and Russian morphology, stroke comparison.
