// doc/schema.js - helpers for block registry schemas.
// Labels are dictionary keys, not texts: schemas are language-neutral data, the editor translates at display time.

// optList('a', 'b') -> [{ v: 'a', l: 'o.a' }, ...] (option labels are editor dictionary keys); numOpts(1, 2) -> [{ v: 1, l: '1' }, ...].
export const optList = (...vals) => vals.map((v) => ({ v, l: 'o.' + v }));
export const numOpts = (...vals) => vals.map((v) => ({ v, l: String(v) }));
export const ALIGN3 = optList('left', 'center', 'right');
