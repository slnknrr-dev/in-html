// player/nav.js - spatial navigation for the 10-foot "home theatre" mode and TV remotes: given the rectangles of the
// focusable elements and the focused one, the element an arrow / D-pad press moves to. Pure geometry (the page passes
// getBoundingClientRect() results), like the WICG spatial navigation heuristics: candidates lie in the half-plane of
// the direction; the score prefers small distance along the axis, overlap across it, and alignment.
//
//   nextFocus(rects, current, dir) -> index | -1     rects [{ x, y, w, h }], current index (or -1: the top-left one),
//                                                    dir 'up' | 'down' | 'left' | 'right'
//   dirOfKey(key) -> dir | null                      (arrows, WASD-free: only arrows and the D-pad keys of TVs)

export function dirOfKey(key) {
  return { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Up: 'up', Down: 'down', Left: 'left', Right: 'right' }[key] || null;
}

// Pure function of rectangles so it is testable without a DOM and independent of layout engine. Weighting: distance
// along the direction counts fully, misalignment across it cheaply when the boxes overlap in that axis (same row)
// and heavily otherwise, so "right" prefers the neighbour in the same row over a closer item diagonally.
export function nextFocus(rects, current, dir) {
  if (!rects.length) return -1;
  if (current < 0 || current >= rects.length) {
    let best = 0;
    rects.forEach((r, i) => { if (r.y < rects[best].y - 2 || (Math.abs(r.y - rects[best].y) <= 2 && r.x < rects[best].x)) best = i; });
    return best;
  }
  const c = rects[current];
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  let best = -1, bestScore = Infinity;
  rects.forEach((r, i) => {
    if (i === current || r.w <= 0 || r.h <= 0) return;
    const rx = r.x + r.w / 2, ry = r.y + r.h / 2;
    let along, across, overlap;
    switch (dir) {
      case 'right': if (r.x < c.x + c.w - 1 && rx <= cx) return; along = Math.max(0, r.x - (c.x + c.w)); across = Math.abs(ry - cy); overlap = Math.max(0, Math.min(c.y + c.h, r.y + r.h) - Math.max(c.y, r.y)); break;
      case 'left': if (r.x + r.w > c.x + 1 && rx >= cx) return; along = Math.max(0, c.x - (r.x + r.w)); across = Math.abs(ry - cy); overlap = Math.max(0, Math.min(c.y + c.h, r.y + r.h) - Math.max(c.y, r.y)); break;
      case 'down': if (r.y < c.y + c.h - 1 && ry <= cy) return; along = Math.max(0, r.y - (c.y + c.h)); across = Math.abs(rx - cx); overlap = Math.max(0, Math.min(c.x + c.w, r.x + r.w) - Math.max(c.x, r.x)); break;
      case 'up': if (r.y + r.h > c.y + 1 && ry >= cy) return; along = Math.max(0, c.y - (r.y + r.h)); across = Math.abs(rx - cx); overlap = Math.max(0, Math.min(c.x + c.w, r.x + r.w) - Math.max(c.x, r.x)); break;
      default: return;
    }
    const score = along + across * (overlap > 0 ? 0.3 : 2) - Math.sqrt(overlap) * 2;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}
