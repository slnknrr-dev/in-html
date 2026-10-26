// access/tokens.js - right sets as closed vocabularies of tokens ('user', 'staff', 'lot:edit.sold', 'team:lot.write'),
// computed once per viewer and object, and the `need` field of UI blocks and buttons built in a constructor: tokens
// separated by commas or spaces, any one of which shows the block ('lot:*' = any token with that prefix). An unknown
// token is kept and matches nobody: a typo must hide a block, not show it to everyone. `need` only narrows - a button
// is shown when both the token of the door it leads to and its own need are met, so a hand-made button cannot promise
// what the server will refuse.
//
//   tokenSet(tokens, vocabulary) -> frozen, sorted by the vocabulary, unknown tokens removed
//   hasToken(set, token)   parseNeed(raw) -> ['token', …] (max 16)   needMet(need, set)   needAllMet(needs, set)
//   filterByNeed(items, set, needOf = (x) => x.need, extra = () => []) -> items whose own need and extra need are met
//   (a null set means "not checked", e.g. a constructor preview)

export function tokenSet(tokens, vocabulary) {
  const order = new Map(vocabulary.map((t, i) => [t, i]));
  return Object.freeze([...new Set(tokens)].filter((t) => order.has(t)).sort((a, b) => order.get(a) - order.get(b)));
}

export function hasToken(set, token) {
  if (!set) return false;
  const t = String(token || '');
  if (t.endsWith(':*')) { const p = t.slice(0, -1); return set.some((x) => x.startsWith(p)); }
  return set.includes(t);
}

export function parseNeed(raw) {
  const list = Array.isArray(raw) ? raw.map((x) => String(x ?? '')) : String(raw ?? '').split(/[\s,;]+/);
  const out = [];
  for (const x of list) {
    const t = x.trim().toLowerCase().slice(0, 40);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 16) break;
  }
  return out;
}

// OR semantics within one need; a null set means "not evaluated" (constructor preview) and shows everything.
// Unknown tokens simply never match, so a typo hides the block instead of exposing it.
export function needMet(need, set) {
  if (!need || !need.length) return true;
  if (!set) return true;
  return need.some((t) => hasToken(set, t));
}

/** A list of needs that must all hold (AND), each met by any of its tokens (OR); null needs: never. */
export const needAllMet = (needs, set) => !!needs && needs.every((n) => needMet(n, set));

export function filterByNeed(items, set, needOf = (x) => x && x.need, extra = () => []) {
  if (!set || !Array.isArray(items)) return items;
  return items.filter((x) => needMet(parseNeed(needOf(x)), set) && needMet(extra(x), set));
}
