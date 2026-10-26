# i18n

**Internationalization.** Language tags and names, text direction, Intl helpers with ICU-data probes and month fallbacks, per-language text values.

| module | contents |
| --- | --- |
| `dates.js` | month / year formatting that never prints the wrong language: Intl when the engine really has the locale, else built-in month tables for the common UI languages, else a neutral numeric form. |
| `intl.js` | Intl helpers: intl(kind, lang, opts) cached formatters, intlSupports(lang) (ICU data probe), pluralCat(n, lang), interp(text, vars). |
| `lang.js` | language tags: canonLang (canonical BCP 47 form), primary (primary subtag), langName (native name or code), langDir (ltr / rtl), LANG_NAMES. |
| `text.js` | per-language texts ({ lang: value }): pickText / pickFrom with fallbacks, normI18n, isEmptyText, htmlToText. |

The header comment of each module documents its API.
