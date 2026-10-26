// pdf/path.js - vector paths for the PDF writer: SVG path data (M L H V C S Q T A Z, absolute and relative) to
// absolute moveto / lineto / cubic / close commands (quadratics raised to cubics, elliptical arcs split into cubic
// segments of at most 90 degrees), shape helpers, and PDF path operators.
//
//   parsePath(d) -> [['M', x, y] | ['L', x, y] | ['C', x1, y1, x2, y2, x, y] | ['Z']]
//   rectPath(x, y, w, h, r) / ellipsePath(cx, cy, rx, ry) / polygonPath(points, close) -> commands
//   arcPath(cx, cy, r, startDeg, endDeg) -> commands of a circular arc (degrees clockwise from +x, y down)
//   pathOps(commands) -> 'x y m … h' (PDF operators, numbers rounded to 0.001)
//   pathBounds(commands) -> [x0, y0, x1, y1] (of the control polygon)
//   fmt(n) -> PDF number

// PDF numbers: 3 decimals (1/1000 pt is far below device resolution and keeps content streams short), never '-0'
// (legal, but noisy and breaks byte-stable output), and NaN/Infinity become 0 because PDF has no such tokens and a
// reader would reject the whole content stream. PDF also forbids exponent notation, which String() would use only
// beyond 1e21 - unreachable for page coordinates.
export const fmt = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) || !Number.isFinite(r) ? '0' : String(r);
};

const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

// A cursor over path data; arc flags are single characters, so "a1 1 0 011 1" reads as 0, 1, 1, 1.
function reader(d) {
  const s = String(d || '');
  let i = 0;
  const skip = () => { while (i < s.length && /[\s,]/.test(s[i])) i++; };
  return {
    done() { skip(); return i >= s.length; },
    command() { skip(); const c = s[i]; if (c && /[MmLlHhVvCcSsQqTtAaZz]/.test(c)) { i++; return c; } return null; },
    number() {
      skip();
      NUM.lastIndex = i;
      const m = NUM.exec(s);
      if (!m) throw new Error('path: number expected at ' + i + (s[i] ? ' ("' + s[i] + '")' : ''));
      i = NUM.lastIndex;
      return +m[0];
    },
    flag() { skip(); const c = s[i]; if (c !== '0' && c !== '1') throw new Error('path: arc flag expected at ' + i); i++; return +c; },
  };
}

// Normalises SVG's 10 commands to PDF's three (m, l, c) + close, all absolute. State: current point (x, y), subpath
// start (sx, sy) for Z, and the last cubic/quadratic control point for the smooth S/T reflections (reset by any
// other command, as the SVG spec requires). Repeated coordinates after a command reuse it; after M they mean L.
// Quadratic -> cubic is exact: control points at 2/3 of the way to the quadratic control point.
export function parsePath(d) {
  const r = reader(d);
  const out = [];
  let x = 0, y = 0, sx = 0, sy = 0, cmd = '', lastC = null, lastQ = null;
  while (!r.done()) {
    const c = r.command();
    if (c) cmd = c;
    else if (!cmd) throw new Error('path: data must start with a command');
    const up = cmd.toUpperCase(), rel = cmd !== up;
    if (up === 'Z') {
      if (!c) throw new Error('path: numbers after Z');
      out.push(['Z']); x = sx; y = sy; lastC = lastQ = null;
      continue;
    }
    const a = [];
    for (let j = 0; j < ARGS[up]; j++) a.push(up === 'A' && (j === 3 || j === 4) ? r.flag() : r.number());
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (up) {
      case 'M':
        x = a[0] + ox; y = a[1] + oy; sx = x; sy = y; out.push(['M', x, y]); lastC = lastQ = null;
        cmd = rel ? 'l' : 'L';
        break;
      case 'L': x = a[0] + ox; y = a[1] + oy; out.push(['L', x, y]); lastC = lastQ = null; break;
      case 'H': x = a[0] + ox; out.push(['L', x, y]); lastC = lastQ = null; break;
      case 'V': y = a[0] + oy; out.push(['L', x, y]); lastC = lastQ = null; break;
      case 'C': {
        const q = ['C', a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy];
        out.push(q); lastC = [q[3], q[4]]; lastQ = null; x = q[5]; y = q[6];
        break;
      }
      case 'S': {
        const r1 = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
        const q = ['C', r1[0], r1[1], a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
        out.push(q); lastC = [q[3], q[4]]; lastQ = null; x = q[5]; y = q[6];
        break;
      }
      case 'Q': case 'T': {
        const q = up === 'Q' ? [a[0] + ox, a[1] + oy] : lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
        const e = up === 'Q' ? [a[2] + ox, a[3] + oy] : [a[0] + ox, a[1] + oy];
        out.push(['C', x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y), e[0] + (2 / 3) * (q[0] - e[0]), e[1] + (2 / 3) * (q[1] - e[1]), e[0], e[1]]);
        lastQ = q; lastC = null; x = e[0]; y = e[1];
        break;
      }
      case 'A': {
        const ex = a[5] + ox, ey = a[6] + oy;
        for (const q of arcToCubics(x, y, a[0], a[1], a[2], a[3], a[4], ex, ey)) out.push(q);
        x = ex; y = ey; lastC = lastQ = null;
        break;
      }
    }
  }
  return out;
}

// SVG arc (endpoint parameterisation, F.6.5 of SVG 1.1) -> cubic segments.
// Out-of-range radii are scaled up (lambda > 1) as SVG requires, instead of failing; zero radius means a straight
// line; identical endpoints mean "draw nothing". max(0, ...) under the sqrt absorbs rounding that would yield NaN.
function arcToCubics(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [['L', x2, y2]];
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  let co = Math.sqrt(Math.max(0, num / (rx * rx * yp * yp + ry * ry * xp * xp)));
  if (fa === fs) co = -co;
  const cxp = (co * rx * yp) / ry, cyp = (-co * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  if (fs && dt < 0) dt += 2 * Math.PI;
  return ellipseArc(cx, cy, rx, ry, phi, t1, dt, x2, y2);
}

// Standard cubic approximation of an elliptic arc: control handles along the tangents with length k = 4/3 tan(d/4)
// per segment. Segments of <= 90 degrees keep the radial error below ~0.03 %. The last point is snapped to the exact
// requested end so accumulated float error cannot leave a visible gap before the next command.
function ellipseArc(cx, cy, rx, ry, phi, t1, dt, endX, endY) {
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const d = dt / segs, k = (4 / 3) * Math.tan(d / 4);
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const pt = (t) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const der = (t) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out = [];
  let t = t1;
  for (let i = 0; i < segs; i++) {
    const p0 = pt(t), d0 = der(t), t2 = t + d, p3 = i === segs - 1 && endX != null ? [endX, endY] : pt(t2), d3 = der(t2);
    out.push(['C', p0[0] + k * d0[0], p0[1] + k * d0[1], p3[0] - k * d3[0], p3[1] - k * d3[1], p3[0], p3[1]]);
    t = t2;
  }
  return out;
}

export function arcPath(cx, cy, r, startDeg, endDeg, { moveTo = true } = {}) {
  const a0 = (startDeg * Math.PI) / 180, a1 = (endDeg * Math.PI) / 180;
  const out = moveTo ? [['M', cx + r * Math.cos(a0), cy + r * Math.sin(a0)]] : [];
  return out.concat(ellipseArc(cx, cy, r, r, 0, a0, a1 - a0));
}

export function ellipsePath(cx, cy, rx, ry = rx) {
  return [['M', cx + rx, cy], ...ellipseArc(cx, cy, rx, ry, 0, 0, 2 * Math.PI, cx + rx, cy), ['Z']];
}

export function rectPath(x, y, w, h, r = 0) {
  const rr = Math.max(0, Math.min(r || 0, Math.abs(w) / 2, Math.abs(h) / 2));
  if (!rr) return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
  // 0.5522847498 = 4/3 (sqrt(2) - 1): the handle length that makes a cubic best approximate a quarter circle.
  const k = 0.5522847498 * rr;
  return [
    ['M', x + rr, y], ['L', x + w - rr, y], ['C', x + w - rr + k, y, x + w, y + rr - k, x + w, y + rr],
    ['L', x + w, y + h - rr], ['C', x + w, y + h - rr + k, x + w - rr + k, y + h, x + w - rr, y + h],
    ['L', x + rr, y + h], ['C', x + rr - k, y + h, x, y + h - rr + k, x, y + h - rr],
    ['L', x, y + rr], ['C', x, y + rr - k, x + rr - k, y, x + rr, y], ['Z'],
  ];
}

export function polygonPath(points, close = true) {
  const out = points.map((p, i) => [i ? 'L' : 'M', p[0], p[1]]);
  if (close && out.length) out.push(['Z']);
  return out;
}

export function pathOps(cmds) {
  const o = [];
  for (const c of cmds) {
    if (c[0] === 'M') o.push(`${fmt(c[1])} ${fmt(c[2])} m`);
    else if (c[0] === 'L') o.push(`${fmt(c[1])} ${fmt(c[2])} l`);
    else if (c[0] === 'C') o.push(`${fmt(c[1])} ${fmt(c[2])} ${fmt(c[3])} ${fmt(c[4])} ${fmt(c[5])} ${fmt(c[6])} c`);
    else if (c[0] === 'Z') o.push('h');
  }
  return o.join(' ');
}

export function pathBounds(cmds) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cmds) for (let i = 1; i + 1 < c.length; i += 2) { x0 = Math.min(x0, c[i]); x1 = Math.max(x1, c[i]); y0 = Math.min(y0, c[i + 1]); y1 = Math.max(y1, c[i + 1]); }
  return x0 === Infinity ? [0, 0, 0, 0] : [x0, y0, x1, y1];
}
