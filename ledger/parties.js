// ledger/parties.js - who takes part in a managed property and what money is for: party roles (a closed list), parties
// that point either at an account of the app (`ref`) or at an outside person by name, the article dictionary
// (rent, commission, cleaning, …) with labels in English, Russian and Georgian, free articles kept as typed, and the
// labels of the journal kinds. Pure data and functions; names of accounts are passed in, never looked up.
//
//   PARTY_ROLES, isPartyRole, partyRole(v), roleLabel(role, lang)
//   cleanId(v) -> positive integer | non-empty string | null
//   normalizeParty({ role, ref, name, note }) -> party | null     a party needs a ref or a name
//   partyName(party, refName?, lang?)                             the account's name, the outside name, or the role
//   LEDGER_ARTICLES, LEDGER_ARTICLE_I18N, isLedgerArticle, cleanArticle(v), cleanArticleName(v),
//   articleNames(rules), articleLabel(article, names?, lang?)
//   LEDGER_KINDS ('accrual' | 'deduction' | 'payout'), isLedgerKind, kindLabel(kind, lang)

const FALLBACK = 'en';
const langOf = (lang) => String(lang || FALLBACK).slice(0, 2).toLowerCase();

// --- ids -----------------------------------------------------------------------------------------------------------

// A party / journal id: a positive integer or a short non-empty string (a UUID, 'p1'). Anything else is no id.
// Digit strings are normalised to numbers so '12' from a form and 12 from storage are the same id; sameId compares
// via String() for the same reason. Note '007' becomes 7 - ids are not meant to carry leading zeros.
export function cleanId(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null;
  const s = String(v ?? '').trim();
  if (!s || s.length > 64) return null;
  return /^\d+$/.test(s) ? (Number(s) > 0 ? Number(s) : null) : s;
}
export const sameId = (a, b) => a != null && b != null && String(a) === String(b);

// --- roles ---------------------------------------------------------------------------------------------------------

// owner - the owner of the property; agency - whoever manages it; platform - the marketplace when it takes a share;
// contractor - cleaning, repairs, laundry (there may be several). The list is closed: a role decides who gets a
// statement, and a role made up by a typo would be a right made up by a typo.
export const PARTY_ROLES = ['owner', 'agency', 'platform', 'contractor'];
export const isPartyRole = (v) => PARTY_ROLES.includes(String(v ?? ''));
export const partyRole = (v) => (isPartyRole(v) ? v : 'contractor');

export const PARTY_ROLE_I18N = {
  owner: { en: 'Owner', ru: 'Собственник', ka: 'მესაკუთრე', he: 'בעלים', ar: 'المالك' },
  agency: { en: 'Manager', ru: 'Управляющий', ka: 'მმართველი', he: 'מנהל הנכס', ar: 'مدير العقار' },
  platform: { en: 'Platform', ru: 'Площадка', ka: 'პლატფორმა', he: 'הפלטפורמה', ar: 'المنصة' },
  contractor: { en: 'Contractor', ru: 'Подрядчик', ka: 'კონტრაქტორი', he: 'קבלן', ar: 'مقاول' },
};

export function roleLabel(role, lang = FALLBACK) {
  const t = PARTY_ROLE_I18N[partyRole(role)];
  return t[langOf(lang)] || t[FALLBACK];
}

const line = (v, max) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

/**
 * A party points EITHER at an account of the app (`ref`: its name lives there and changes there, so no copy is kept)
 * OR at an outside person by `name` (a cleaner without an account). A party with neither is a share nobody could be
 * named for, so it is not created.
 */
export function normalizeParty(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const ref = line(o.ref, 64);
  const name = line(o.name, 120);
  if (!ref && !name) return null;
  const p = { role: partyRole(o.role), ref, name: ref ? '' : name, note: line(o.note, 200) };
  const id = cleanId(o.id);
  return id == null ? p : { id, ...p };
}

// Name for display: the account's own name (passed in), the outside name, else the role in words - never a blank.
export function partyName(p, refName = '', lang = FALLBACK) {
  if (p && p.ref) return String(refName || '').trim() || roleLabel(p.role, lang);
  return String((p && p.name) || '').trim() || roleLabel(p && p.role, lang);
}

// --- articles ------------------------------------------------------------------------------------------------------

// What the money is for, in the reader's language. The list is open: a free article ('waste removal') stays a string
// shown as typed; what everybody has is translated for free. `surplus` is the extra a booking earned above the usual
// price (it may be routed differently and hidden from the owner).
export const LEDGER_ARTICLES = ['rent', 'commission', 'cleaning', 'utilities', 'repair', 'supplies', 'tax', 'fee', 'surplus', 'other'];
export const isLedgerArticle = (v) => LEDGER_ARTICLES.includes(String(v ?? ''));

export const LEDGER_ARTICLE_I18N = {
  rent: { en: 'Accommodation', ru: 'Проживание', ka: 'ცხოვრება' },
  commission: { en: 'Management fee', ru: 'Комиссия управляющего', ka: 'მართვის საკომისიო' },
  cleaning: { en: 'Cleaning', ru: 'Уборка', ka: 'დასუფთავება' },
  utilities: { en: 'Utilities', ru: 'Коммунальные', ka: 'კომუნალური' },
  repair: { en: 'Repairs', ru: 'Ремонт', ka: 'რემონტი' },
  supplies: { en: 'Supplies', ru: 'Расходники', ka: 'სახარჯი მასალები' },
  tax: { en: 'Tax', ru: 'Налог', ka: 'გადასახადი' },
  fee: { en: 'Platform fee', ru: 'Комиссия площадки', ka: 'პლატფორმის საკომისიო' },
  surplus: { en: 'Surplus', ru: 'Сверхприбыль', ka: 'ზედმეტი მოგება' },
  other: { en: 'Other', ru: 'Прочее', ka: 'სხვა' },
};

export const ARTICLE_LANGS = ['en', 'ru', 'ka'];

// A dictionary word becomes its key (case and spaces ignored); anything else stays as typed. A word in another
// language is NOT guessed into a key: 'cleaning of the stairs' must not become 'cleaning' on somebody's statement.
export function cleanArticle(v) {
  const s = String(v ?? '').trim().slice(0, 60);
  const low = s.toLowerCase();
  return isLedgerArticle(low) ? low : s;
}

// Own article name in the article languages; a plain string is English. Empty languages are not kept, so {} and
// "no name" are one value (normalisation stays idempotent).
export function cleanArticleName(v) {
  const out = {};
  if (typeof v === 'string') { const s = v.trim().slice(0, 60); if (s) out[FALLBACK] = s; return out; }
  const o = v && typeof v === 'object' ? v : {};
  for (const l of ARTICLE_LANGS) { const s = String(o[l] ?? '').trim().slice(0, 60); if (s) out[l] = s; }
  return out;
}

// Own names of the articles of a rule list: article -> { en, ru, ka }; rules of one article merge their languages.
export function articleNames(rules) {
  const out = {};
  for (const r of rules || []) {
    if (!r || !r.article || !r.name || !Object.keys(r.name).length) continue;
    out[r.article] = { ...(out[r.article] || {}), ...r.name };
  }
  return out;
}

/**
 * Article label in the reader's language. The dictionary word of the reader's language beats an own name in another
 * language: own[lang] -> dictionary[lang] -> own.en -> dictionary.en -> any own name -> the article itself. A free
 * article falls back to itself, never to 'Other' (that would misstate what was withheld).
 */
export function articleLabel(article, names, lang = FALLBACK) {
  const a = String(article ?? '').trim();
  if (!a) return '';
  const want = langOf(lang);
  const own = (names && names[a]) || {};
  const std = isLedgerArticle(a) ? LEDGER_ARTICLE_I18N[a] : {};
  return String(own[want] || std[want] || own[FALLBACK] || std[FALLBACK] || Object.values(own).find(Boolean) || a);
}

// --- journal kinds -------------------------------------------------------------------------------------------------

// Amounts in the journal are always positive; the kind gives the direction: an accrual adds to the party, a deduction
// and a payout take away.
export const LEDGER_KINDS = ['accrual', 'deduction', 'payout'];
export const isLedgerKind = (v) => LEDGER_KINDS.includes(String(v ?? ''));

export const LEDGER_KIND_I18N = {
  accrual: { en: 'Accrued', ru: 'Начислено', ka: 'დარიცხული' },
  deduction: { en: 'Withheld', ru: 'Удержано', ka: 'დაკავებული' },
  payout: { en: 'Paid out', ru: 'Выплачено', ka: 'გადახდილი' },
};

export function kindLabel(kind, lang = FALLBACK) {
  const t = LEDGER_KIND_I18N[isLedgerKind(kind) ? kind : 'accrual'];
  return t[langOf(lang)] || t[FALLBACK];
}
