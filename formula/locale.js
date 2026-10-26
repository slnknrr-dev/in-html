// formula/locale.js - localized formula text: Russian function names, booleans and error literals, the ';' argument
// separator and the ',' decimal mark, translated to and from the canonical form the parser and the files use
// (English names, ',' separators, '.' decimals). Formulas are stored canonical and shown localized.
//
//   localizeFormula(text, lang = 'ru') -> text      'SUM(A1:A3,1.5)' -> 'СУММ(A1:A3;1,5)'
//   delocalizeFormula(text, lang = 'ru') -> text    'сумм(A1:A3; 1,5)' -> 'SUM(A1:A3, 1.5)' (spacing kept)
//   parseLocalizedFormula(text, lang) -> AST        parseFormula(delocalizeFormula(text, lang))
//   localFunctionName(name, lang) / canonicalFunctionName(name, lang) -> name (unknown names unchanged)
//   FUNCTION_NAMES: { ru: { SUM: 'СУММ', … } }   ERROR_NAMES, BOOL_NAMES: the same shape
//
// Cell references, sheet names, defined names and string contents are never translated. Array constants follow the
// comma-decimal convention: columns are separated by '\' and rows by ';' ({1\2;3\4} is canonical {1,2;3,4}).
// Ё and Е are interchangeable in input (СЧЕТЕСЛИ = СЧЁТЕСЛИ); the output uses the names as Excel shows them.

import { normFuncName, parseFormula, tokenize } from './parser.js';

// Russian names of the functions registered by functions.js / lookup.js (Microsoft Excel ru-RU).
// Data table (en -> localized names exactly as Excel ru-RU shows them). Reverse lookups are derived lazily, so only
// one direction is maintained by hand.
export const FUNCTION_NAMES = {
  ru: {
    SUM: 'СУММ', PRODUCT: 'ПРОИЗВЕД', AVERAGE: 'СРЗНАЧ', AVERAGEA: 'СРЗНАЧА', MIN: 'МИН', MAX: 'МАКС', MINA: 'МИНА', MAXA: 'МАКСА',
    SUMSQ: 'СУММКВ', MEDIAN: 'МЕДИАНА', MODE: 'МОДА', 'MODE.SNGL': 'МОДА.ОДН', VAR: 'ДИСП', VARP: 'ДИСПР', STDEV: 'СТАНДОТКЛОН',
    STDEVP: 'СТАНДОТКЛОНП', 'VAR.S': 'ДИСП.В', 'VAR.P': 'ДИСП.Г', 'STDEV.S': 'СТАНДОТКЛОН.В', 'STDEV.P': 'СТАНДОТКЛОН.Г',
    AVEDEV: 'СРОТКЛ', GEOMEAN: 'СРГЕОМ', HARMEAN: 'СРГАРМ', DEVSQ: 'КВАДРОТКЛ', COUNT: 'СЧЁТ', COUNTA: 'СЧЁТЗ',
    COUNTBLANK: 'СЧИТАТЬПУСТОТЫ', LARGE: 'НАИБОЛЬШИЙ', SMALL: 'НАИМЕНЬШИЙ', PERCENTILE: 'ПЕРСЕНТИЛЬ',
    'PERCENTILE.INC': 'ПРОЦЕНТИЛЬ.ВКЛ', 'PERCENTILE.EXC': 'ПРОЦЕНТИЛЬ.ИСКЛ', QUARTILE: 'КВАРТИЛЬ', 'QUARTILE.INC': 'КВАРТИЛЬ.ВКЛ',
    RANK: 'РАНГ', 'RANK.EQ': 'РАНГ.РВ', CORREL: 'КОРРЕЛ', SUMPRODUCT: 'СУММПРОИЗВ', COUNTIF: 'СЧЁТЕСЛИ', COUNTIFS: 'СЧЁТЕСЛИМН',
    SUMIF: 'СУММЕСЛИ', SUMIFS: 'СУММЕСЛИМН', AVERAGEIF: 'СРЗНАЧЕСЛИ', AVERAGEIFS: 'СРЗНАЧЕСЛИМН', MAXIFS: 'МАКСЕСЛИ', MINIFS: 'МИНЕСЛИ',
    ABS: 'ABS', SIGN: 'ЗНАК', INT: 'ЦЕЛОЕ', TRUNC: 'ОТБР', ROUND: 'ОКРУГЛ', ROUNDUP: 'ОКРУГЛВВЕРХ', ROUNDDOWN: 'ОКРУГЛВНИЗ',
    MROUND: 'ОКРУГЛТ', CEILING: 'ОКРВВЕРХ', FLOOR: 'ОКРВНИЗ', 'CEILING.MATH': 'ОКРВВЕРХ.МАТ', 'FLOOR.MATH': 'ОКРВНИЗ.МАТ',
    MOD: 'ОСТАТ', QUOTIENT: 'ЧАСТНОЕ', POWER: 'СТЕПЕНЬ', SQRT: 'КОРЕНЬ', EXP: 'EXP', LN: 'LN', LOG10: 'LOG10', LOG: 'LOG', PI: 'ПИ',
    SIN: 'SIN', COS: 'COS', TAN: 'TAN', ASIN: 'ASIN', ACOS: 'ACOS', ATAN: 'ATAN', ATAN2: 'ATAN2', DEGREES: 'ГРАДУСЫ',
    RADIANS: 'РАДИАНЫ', EVEN: 'ЧЁТН', ODD: 'НЕЧЁТ', FACT: 'ФАКТР', GCD: 'НОД', LCM: 'НОК', RAND: 'СЛЧИС', RANDBETWEEN: 'СЛУЧМЕЖДУ',
    IF: 'ЕСЛИ', IFS: 'ЕСЛИМН', IFERROR: 'ЕСЛИОШИБКА', IFNA: 'ЕСНД', AND: 'И', OR: 'ИЛИ', XOR: 'ИСКЛИЛИ', NOT: 'НЕ',
    TRUE: 'ИСТИНА', FALSE: 'ЛОЖЬ', SWITCH: 'ПЕРЕКЛЮЧ', CHOOSE: 'ВЫБОР', ISBLANK: 'ЕПУСТО', ISNUMBER: 'ЕЧИСЛО', ISTEXT: 'ЕТЕКСТ',
    ISNONTEXT: 'ЕНЕТЕКСТ', ISLOGICAL: 'ЕЛОГИЧ', ISERROR: 'ЕОШИБКА', ISERR: 'ЕОШ', ISNA: 'ЕНД', ISEVEN: 'ЕЧЁТН', ISODD: 'ЕНЕЧЁТ',
    ISREF: 'ЕССЫЛКА', NA: 'НД', 'ERROR.TYPE': 'ТИП.ОШИБКИ', N: 'Ч', T: 'Т', TYPE: 'ТИП', ROW: 'СТРОКА', COLUMN: 'СТОЛБЕЦ',
    ROWS: 'ЧСТРОК', COLUMNS: 'ЧИСЛСТОЛБ', LEN: 'ДЛСТР', LEFT: 'ЛЕВСИМВ', RIGHT: 'ПРАВСИМВ', MID: 'ПСТР', UPPER: 'ПРОПИСН',
    LOWER: 'СТРОЧН', PROPER: 'ПРОПНАЧ', TRIM: 'СЖПРОБЕЛЫ', CLEAN: 'ПЕЧСИМВ', CONCAT: 'СЦЕП', CONCATENATE: 'СЦЕПИТЬ',
    TEXTJOIN: 'ОБЪЕДИНИТЬ', SUBSTITUTE: 'ПОДСТАВИТЬ', REPLACE: 'ЗАМЕНИТЬ', FIND: 'НАЙТИ', SEARCH: 'ПОИСК', VALUE: 'ЗНАЧЕН',
    NUMBERVALUE: 'ЧЗНАЧ', TEXT: 'ТЕКСТ', FIXED: 'ФИКСИРОВАННЫЙ', REPT: 'ПОВТОР', EXACT: 'СОВПАД', CHAR: 'СИМВОЛ', CODE: 'КОДСИМВ',
    UNICHAR: 'ЮНИСИМВ', UNICODE: 'UNICODE', TEXTBEFORE: 'ТЕКСТДО', TEXTAFTER: 'ТЕКСТПОСЛЕ', TEXTSPLIT: 'ТЕКСТРАЗД',
    DATE: 'ДАТА', TIME: 'ВРЕМЯ', TODAY: 'СЕГОДНЯ', NOW: 'ТДАТА', YEAR: 'ГОД', MONTH: 'МЕСЯЦ', DAY: 'ДЕНЬ', HOUR: 'ЧАС',
    MINUTE: 'МИНУТЫ', SECOND: 'СЕКУНДЫ', WEEKDAY: 'ДЕНЬНЕД', ISOWEEKNUM: 'НОМНЕДЕЛИ.ISO', WEEKNUM: 'НОМНЕДЕЛИ', EDATE: 'ДАТАМЕС',
    EOMONTH: 'КОНМЕСЯЦА', DAYS: 'ДНИ', DATEDIF: 'РАЗНДАТ', DAYS360: 'ДНЕЙ360', NETWORKDAYS: 'ЧИСТРАБДНИ', WORKDAY: 'РАБДЕНЬ',
    DATEVALUE: 'ДАТАЗНАЧ', TIMEVALUE: 'ВРЕМЗНАЧ', YEARFRAC: 'ДОЛЯГОДА', VLOOKUP: 'ВПР', HLOOKUP: 'ГПР', LOOKUP: 'ПРОСМОТР',
    MATCH: 'ПОИСКПОЗ', XMATCH: 'ПОИСКПОЗX', XLOOKUP: 'ПРОСМОТРX', INDEX: 'ИНДЕКС', OFFSET: 'СМЕЩ', INDIRECT: 'ДВССЫЛ',
    ADDRESS: 'АДРЕС', HYPERLINK: 'ГИПЕРССЫЛКА', TRANSPOSE: 'ТРАНСП', UNIQUE: 'УНИК', SORT: 'СОРТ', SORTBY: 'СОРТПО',
    FILTER: 'ФИЛЬТР', SEQUENCE: 'ПОСЛЕДОВ', TAKE: 'ВЗЯТЬ', DROP: 'СБРОСИТЬ', CHOOSECOLS: 'ВЫБОРСТОЛБЦ', CHOOSEROWS: 'ВЫБОРСТРОК',
    VSTACK: 'ВСТОЛБИК', HSTACK: 'ГСТОЛБИК',
  },
};
export const ERROR_NAMES = {
  ru: { '#NULL!': '#ПУСТО!', '#DIV/0!': '#ДЕЛ/0!', '#VALUE!': '#ЗНАЧ!', '#REF!': '#ССЫЛКА!', '#NAME?': '#ИМЯ?', '#NUM!': '#ЧИСЛО!', '#N/A': '#Н/Д', '#SPILL!': '#ПЕРЕНОС!', '#CALC!': '#ВЫЧИСЛ!' },
};
export const BOOL_NAMES = { ru: { TRUE: 'ИСТИНА', FALSE: 'ЛОЖЬ' } };
// Separators of the comma-decimal locales.
const SEP = { ru: { arg: ';', decimal: ',', col: '\\' } };

// Users type Е for Ё routinely; folding both sides of the reverse lookup accepts either.
const foldYo = (s) => s.replace(/Ё/g, 'Е');
const reverse = new Map();
// Local name (upper case, Ё folded) -> canonical name, built from the forward table.
function back(table, lang) {
  const key = table + ':' + lang;
  let m = reverse.get(key);
  if (!m) {
    const src = (table === 'fn' ? FUNCTION_NAMES : table === 'err' ? ERROR_NAMES : BOOL_NAMES)[lang] || {};
    m = new Map(Object.entries(src).map(([en, loc]) => [foldYo(loc.toUpperCase()), en]));
    reverse.set(key, m);
  }
  return m;
}

export const localFunctionName = (name, lang = 'ru') => {
  const n = normFuncName(name);
  return (FUNCTION_NAMES[lang] && FUNCTION_NAMES[lang][n]) || name;
};
export const canonicalFunctionName = (name, lang = 'ru') => back('fn', lang).get(foldYo(String(name).toUpperCase())) || name;

// Sticky (/y) regex: matched at an exact offset (lastIndex) with no scanning, to recover a number token's source
// text from the tokenizer position.
const RE_NUM = /(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

// Splices replacements [{ at, len, s }] into text (sorted by position).
// Position-based edits computed from tokens, applied in one pass: replacing by search would also hit the same text
// inside strings or sheet names, which must never be translated.
function splice(text, edits) {
  let out = '', i = 0;
  for (const e of edits.sort((a, b) => a.at - b.at)) { out += text.slice(i, e.at) + e.s; i = e.at + e.len; }
  return out + text.slice(i);
}

// Token-driven (the real tokenizer of parser.js), so strings, references and names are recognized exactly and left
// alone. A bracket stack decides what a canonical ',' means: inside {} it is the array column separator ('\' in
// ru), elsewhere the argument separator (';').
export function localizeFormula(text, lang = 'ru') {
  const fn = FUNCTION_NAMES[lang];
  if (!fn) return String(text);
  const src = String(text);
  const off = src[0] === '=' ? 1 : 0;
  const body = src.slice(off);
  const sep = SEP[lang], errs = ERROR_NAMES[lang] || {}, bools = BOOL_NAMES[lang] || {};
  const edits = [], stack = [];
  for (const t of tokenize(body)) {
    if (t.t === 'func') { const loc = fn[normFuncName(t.v)]; if (loc) edits.push({ at: t.at, len: t.v.length, s: loc }); }
    else if (t.t === 'bool') edits.push({ at: t.at, len: t.v ? 4 : 5, s: bools[t.v ? 'TRUE' : 'FALSE'] || (t.v ? 'TRUE' : 'FALSE') });
    else if (t.t === 'err' && errs[t.v]) edits.push({ at: t.at, len: t.v.length, s: errs[t.v] });
    else if (t.t === 'num' && sep.decimal !== '.') {
      RE_NUM.lastIndex = t.at;
      const m = RE_NUM.exec(body);
      if (m && m[0].includes('.')) edits.push({ at: t.at, len: m[0].length, s: m[0].replace('.', sep.decimal) });
    } else if (t.t === 'op') {
      if (t.v === '(' || t.v === '{') stack.push(t.v);
      else if (t.v === ')' || t.v === '}') stack.pop();
      else if (t.v === ',') edits.push({ at: t.at, len: 1, s: stack[stack.length - 1] === '{' ? sep.col : sep.arg });
    }
  }
  return src.slice(0, off) + splice(body, edits);
}

// Two passes because the localized text cannot be tokenized by the canonical tokenizer: ';' and the decimal ','
// would be misread. Pass 1 rewrites characters outside quoted strings and quoted sheet names (doubled quotes are
// escapes) into canonical separators; then the text IS canonical syntax with localized names, so pass 2 can use the
// tokenizer to translate function names and booleans. Inside {} the localized ';' (row separator) is already
// canonical and is kept.
export function delocalizeFormula(text, lang = 'ru') {
  const sep = SEP[lang];
  if (!sep) return String(text);
  const src = String(text);
  const errs = back('err', lang);
  // Pass 1, over the characters: separators, decimal marks and error literals (strings and quoted sheets copied).
  let out = '';
  const stack = [];
  for (let i = 0; i < src.length;) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      for (;;) {
        const k = src.indexOf(ch, j);
        if (k < 0) { j = src.length; break; }
        if (src[k + 1] === ch) { j = k + 2; continue; }
        j = k + 1;
        break;
      }
      out += src.slice(i, j);
      i = j;
      continue;
    }
    if (ch === '#') {
      const up = foldYo(src.slice(i, i + 12).toUpperCase());
      let hit = null;
      for (const [loc, en] of errs) if (up.startsWith(loc) && (!hit || loc.length > hit[0].length)) hit = [loc, en];
      if (hit) { out += hit[1]; i += hit[0].length; continue; }
    }
    const top = stack[stack.length - 1];
    if (ch === '(' || ch === '{') stack.push(ch);
    else if (ch === ')' || ch === '}') stack.pop();
    if (ch === sep.decimal) out += '.';
    else if (ch === sep.arg && top !== '{') out += ',';
    else if (ch === sep.col && top === '{') out += ',';
    else out += ch;
    i++;
  }
  // Pass 2, over the tokens: function names and booleans.
  const off = out[0] === '=' ? 1 : 0;
  const body = out.slice(off);
  const fns = back('fn', lang), bools = back('bool', lang);
  const edits = [];
  for (const t of tokenize(body)) {
    if (t.t === 'func') { const en = fns.get(foldYo(t.v.toUpperCase())); if (en) edits.push({ at: t.at, len: t.v.length, s: en }); }
    else if (t.t === 'name') { const en = bools.get(foldYo(t.v.toUpperCase())); if (en) edits.push({ at: t.at, len: t.v.length, s: en }); }
  }
  return out.slice(0, off) + splice(body, edits);
}

export function parseLocalizedFormula(text, lang = 'ru') {
  return parseFormula(delocalizeFormula(text, lang));
}
