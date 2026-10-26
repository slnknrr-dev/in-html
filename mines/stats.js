// mines/stats.js - statistics and best times per configuration (pure data, the application stores it).
//
// stats = { v: 1, games: { [configKey]: { played, won, streak, bestStreak, wonMs, best: [{ ms, date, bbbv, clicks,
//           seed?, replay? }] } } }
// recordGame(stats, key, { won, ms, date, assisted, bbbv, clicks, seed, replay }) -> rank of a new best time (1…BEST)
//   or 0. Assisted games (hints, undo) count as played / won but never enter the best times.

//
// Note "pure data" means plain JSON-serialisable objects; recordGame does mutate the stats object it is given
// (stats.games[key] is replaced with an updated copy of the entry).
export const BEST = 5;

export const emptyStats = () => ({ v: 1, games: {} });

export function normalizeStats(s) {
  if (!s || typeof s !== 'object' || s.v !== 1 || typeof s.games !== 'object' || !s.games) return emptyStats();
  return s;
}

export function entry(stats, key) {
  return stats.games[key] || { played: 0, won: 0, streak: 0, bestStreak: 0, wonMs: 0, best: [] };
}

export function recordGame(stats, key, r) {
  const e = { ...entry(stats, key) };
  e.best = (e.best || []).slice();
  e.played++;
  let rank = 0;
  if (r.won) {
    e.won++;
    e.streak++;
    e.bestStreak = Math.max(e.bestStreak, e.streak);
    e.wonMs += r.ms;
    if (!r.assisted) {
      const item = { ms: r.ms, date: r.date, bbbv: r.bbbv, clicks: r.clicks };
      if (r.seed != null) item.seed = r.seed;
      if (r.replay) item.replay = r.replay;
      e.best.push(item);
      // Stable sort: a tie keeps the older record ahead, so an equal time does not push out an earlier best.
      e.best.sort((a, b) => a.ms - b.ms);
      const at = e.best.indexOf(item);
      e.best = e.best.slice(0, BEST);
      rank = at < BEST ? at + 1 : 0;
    }
  } else e.streak = 0;
  stats.games[key] = e;
  return rank;
}

// Totals over every configuration.
export function totals(stats) {
  let played = 0, won = 0;
  for (const e of Object.values(stats.games)) { played += e.played; won += e.won; }
  return { played, won, rate: played ? won / played : 0 };
}
