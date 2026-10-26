// site-studio/wiki-templates-news.js - the "news outlet" template: The Port Velling Courier, the newspaper of an
// invented harbour city. A front page (banner, hero list of the latest stories, section cards), sections as categories,
// dated stories with bylines, an explainer in two versions, a running story with a timeline, a photo gallery, an
// opinion column, an interactive city map, editorial standards, corrections and one embargoed 451 story
// (password 'embargo451'). Everything in it - city, paper, people, documents - is fictional.
import { svgMedia } from './wiki-kit.js';

// ---------------------------------------------------------------------------------------------
// Illustrations: flat editorial style, one palette (ink navy, cream paper, coral, mustard, teal).

const FONT = 'system-ui, sans-serif';
const f1 = (v) => +v.toFixed(1);
const svg = (w, h, defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
const lin = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map((c, i) => `<stop offset="${(i / (stops.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('')}</linearGradient>`;
const halo = (id, c) => `<radialGradient id="${id}"><stop offset="0" stop-color="${c}" stop-opacity=".85"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`;
const prng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const stars = (seed, n, w, h) => {
  const r = prng(seed);
  let s = '';
  for (let i = 0; i < n; i++) s += `<circle cx="${(r() * w) | 0}" cy="${(r() * h) | 0}" r="${f1(r() * 1.5 + 0.5)}" fill="#fff" opacity="${f1(r() * 0.6 + 0.3)}"/>`;
  return s;
};
const waves = (y0, y1, w, color, seed) => {
  const r = prng(seed);
  let d = '';
  for (let y = y0; y < y1; y += 22) {
    const x = (r() * w) | 0, l = 30 + ((r() * 60) | 0);
    d += `M${x} ${y}q${l / 4} -5 ${l / 2} 0t${l / 2} 0`;
  }
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" opacity=".5"/>`;
};
// A paper lantern with its glow (needs a `halo` gradient with id 'hl').
const lantern = (x, y, s = 1, c = '#e76f51') => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(28 * s)}" fill="url(#hl)"/>` +
  `<rect x="${f1(x - 9 * s)}" y="${f1(y - 12 * s)}" width="${f1(18 * s)}" height="${f1(24 * s)}" rx="${f1(7 * s)}" fill="${c}"/>` +
  `<rect x="${f1(x - 5 * s)}" y="${f1(y - 15 * s)}" width="${f1(10 * s)}" height="${f1(4 * s)}" fill="#1f2a44"/><rect x="${f1(x - 5 * s)}" y="${f1(y + 11 * s)}" width="${f1(10 * s)}" height="${f1(4 * s)}" fill="#1f2a44"/>` +
  `<path d="M${f1(x)} ${f1(y - 9 * s)}v${f1(18 * s)}" stroke="#fff3c4" stroke-width="${f1(2 * s)}" opacity=".6"/>`;
const LANTERN_COLORS = ['#e76f51', '#f2b84b', '#5fd3c4', '#f28fad', '#ffd88a'];

function logoSVG() {
  return svg(200, 200, lin('g', ['#2b3a67', '#1f2a44']),
    '<rect width="200" height="200" rx="36" fill="url(#g)"/>' +
    `<text x="100" y="112" font-family="Georgia, 'Times New Roman', serif" font-size="86" font-weight="700" fill="#f3ead8" text-anchor="middle">PV</text>` +
    '<path d="M38 140q16-12 31 0t31 0 31 0 31 0M38 160q16-12 31 0t31 0 31 0 31 0" fill="none" stroke="#e76f51" stroke-width="7" stroke-linecap="round"/>');
}

function skylineSVG() {
  const r = prng(11);
  let city = '', win = '';
  for (let x = -10; x < 1210;) {
    const w = 46 + ((r() * 48) | 0), h = 50 + ((r() * 120) | 0), top = 300 - h;
    const fill = r() < 0.5 ? '#3f3765' : '#4b4275';
    city += `<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="${fill}"/>`;
    if (r() < 0.35) city += `<path d="M${x} ${top}l${w / 2} -20l${w / 2} 20z" fill="${fill}"/>`;
    for (let wy = top + 12; wy < 286; wy += 20) for (let wx = x + 8; wx < x + w - 8; wx += 15) if (r() < 0.22) win += `M${wx} ${wy}h5v8h-5z`;
    x += w + 3;
  }
  let truss = '';
  for (let x = 470; x <= 730; x += 37) truss += `M${x} 284V322M${x} 284L${x + 37} 322`;
  let lan = '';
  for (let i = 0; i < 11; i++) lan += lantern(70 + i * 105 + ((r() * 40) | 0), 345 + ((r() * 40) | 0), 0.55, LANTERN_COLORS[i % 5]);
  return svg(1200, 400, lin('s', ['#2b2d5b', '#9a5a7a', '#f3b27a']) + lin('w', ['#5b5a8c', '#1f2448']) + halo('hl', '#ffd88a') + halo('sun', '#ffe2b0'),
    '<rect width="1200" height="400" fill="url(#s)"/>' + stars(3, 40, 1200, 120) +
    '<circle cx="860" cy="250" r="150" fill="url(#sun)"/><circle cx="860" cy="252" r="70" fill="#ffd9a0"/>' +
    '<path d="M0 250Q150 196 300 232T600 222T900 210T1200 228V300H0z" fill="#8d6e9e" opacity=".6"/>' +
    city + `<path d="${win}" fill="#ffd88a"/>` +
    '<path d="M96 300l8-92h20l8 92z" fill="#f3ead8"/><path d="M99 262h30l2 18h-34zM103 222h22l1 14h-24z" fill="#e76f51"/><rect x="104" y="196" width="20" height="14" fill="#ffd88a"/><path d="M100 196h28l-14-14z" fill="#1f2a44"/>' +
    '<path d="M114 203L-20 150V256z" fill="#ffd88a" opacity=".18"/>' +
    '<rect y="300" width="1200" height="100" fill="url(#w)"/>' +
    '<path d="M800 312h120M820 326h80M835 340h50M845 354h30" stroke="#ffd9a0" stroke-width="4" stroke-linecap="round" opacity=".6"/>' +
    waves(318, 400, 1200, '#8f8cc4', 5) +
    '<path d="M585 322h30l12 78h-54z" fill="#2a2547"/>' +
    '<path d="M420 322H780" stroke="#2a2547" stroke-width="10"/><path d="M436 322L470 284H730L764 322" fill="none" stroke="#2a2547" stroke-width="7" stroke-linejoin="round"/>' +
    `<path d="${truss}" stroke="#2a2547" stroke-width="4"/>` + lan +
    '<path d="M300 90q8-8 16 0q8-8 16 0M350 120q6-6 12 0q6-6 12 0M980 70q8-8 16 0q8-8 16 0" fill="none" stroke="#2a2547" stroke-width="3" stroke-linecap="round"/>');
}

function bridgeSVG() {
  let truss = '';
  for (let x = 170; x <= 630; x += 46) truss += `M${x} 192V250`;
  for (let x = 170; x < 630; x += 92) truss += `M${x} 192L${x + 46} 250L${x + 92} 192`;
  return svg(800, 450, lin('s', ['#a9d3dc', '#eef5ef']) + lin('w', ['#2f7f88', '#1d5c63']),
    '<rect width="800" height="450" fill="url(#s)"/>' +
    '<circle cx="660" cy="80" r="34" fill="#fff6dc"/>' +
    '<path d="M0 232h60v-50h40v30h50v-70h36v90h70v-40h50v40h80v-60h44v60h70v-30h60v-50h40v80h100v-40h50v40h50v40H0z" fill="#9fb7bd"/>' +
    '<rect y="262" width="800" height="188" fill="url(#w)"/>' + waves(280, 450, 800, '#8fd0d4', 9) +
    '<path d="M0 248h160v30l-20 172H0z" fill="#b9a58a"/><path d="M640 248h160v202H660l-20-172z" fill="#b9a58a"/>' +
    '<path d="M0 248h160v8H0zM640 248h160v8H640z" fill="#8f7d66"/>' +
    '<path d="M370 262h60l16 188h-92z" fill="#a8947a"/>' +
    '<rect x="150" y="246" width="500" height="16" fill="#c4553b"/>' +
    '<path d="M150 250L172 192H628L650 250" fill="none" stroke="#c4553b" stroke-width="10" stroke-linejoin="round"/>' +
    `<path d="${truss}" fill="none" stroke="#c4553b" stroke-width="5" stroke-linejoin="round"/>` +
    '<circle cx="400" cy="276" r="18" fill="#f2b84b" stroke="#1f2a44" stroke-width="4"/><path d="M391 263l7 9-5 6 9 10" stroke="#1f2a44" stroke-width="3" fill="none"/>' +
    '<circle cx="452" cy="330" r="5" fill="#d8f3f1"/><circle cx="460" cy="312" r="3.5" fill="#d8f3f1"/><circle cx="455" cy="296" r="2.5" fill="#d8f3f1"/>' +
    '<rect x="36" y="200" width="8" height="48" fill="#1f2a44"/><rect x="40" y="212" width="112" height="12" fill="#f2b84b"/>' +
    '<path d="M60 212l-8 12M82 212l-8 12M104 212l-8 12M126 212l-8 12M148 212l-8 12" stroke="#1f2a44" stroke-width="6"/>' +
    '<rect x="56" y="168" width="84" height="28" rx="4" fill="#e76f51"/><rect x="94" y="196" width="6" height="16" fill="#1f2a44"/>' +
    `<text x="98" y="187" font-family="${FONT}" font-size="15" font-weight="800" fill="#fff" text-anchor="middle">CLOSED</text>` +
    '<path d="M724 250V86M724 86H566M724 118L690 86M690 86v34" stroke="#f2b84b" stroke-width="7" fill="none" stroke-linejoin="round"/>' +
    '<path d="M592 86v84" stroke="#1f2a44" stroke-width="2"/><rect x="582" y="170" width="20" height="12" fill="#1f2a44"/>');
}

function tramSVG() {
  let houses = '';
  const r = prng(21);
  for (let i = 0; i < 9; i++) {
    const x = 20 + i * 88, base = Math.round(336 - 0.2125 * (x + 60)), h = 40 + ((r() * 40) | 0);
    houses += `<path d="M${x} ${base}v-${h}l30 -22l30 22v${h}z" fill="${i % 2 ? '#2e3566' : '#363e73'}"/>`;
    if (r() < 0.8) houses += `<rect x="${x + 12}" y="${base - h + 10}" width="10" height="12" fill="#ffd88a"/>`;
    if (r() < 0.6) houses += `<rect x="${x + 38}" y="${base - h + 10}" width="10" height="12" fill="#ffd88a"/>`;
  }
  return svg(800, 450, lin('s', ['#141a38', '#3b3f74']) + halo('hl', '#ffe7a8'),
    '<rect width="800" height="450" fill="url(#s)"/>' + stars(8, 45, 800, 200) +
    '<circle cx="660" cy="86" r="34" fill="#f6efd0"/><circle cx="676" cy="76" r="30" fill="#232a55"/>' +
    houses +
    '<path d="M0 450V330L800 160V450z" fill="#232a4f"/>' +
    '<path d="M0 352L800 182M0 366L800 196" stroke="#8a8fb8" stroke-width="3"/>' +
    '<path d="M0 202L800 32" stroke="#c9cbe0" stroke-width="2"/><path d="M130 174V302M600 74V202" stroke="#4b5288" stroke-width="6"/>' +
    '<g transform="translate(250 188) rotate(-12)">' +
    '<path d="M60 0L40 -38L80 -38" fill="none" stroke="#c9cbe0" stroke-width="3"/>' +
    '<rect x="0" y="0" width="270" height="96" rx="22" fill="#e76f51"/><rect x="0" y="54" width="270" height="16" fill="#f3ead8"/>' +
    '<rect x="22" y="14" width="44" height="32" rx="6" fill="#ffe29a"/><rect x="78" y="14" width="44" height="32" rx="6" fill="#ffe29a"/><rect x="134" y="14" width="44" height="32" rx="6" fill="#ffe29a"/><rect x="190" y="14" width="44" height="32" rx="6" fill="#ffe29a"/>' +
    '<circle cx="60" cy="100" r="13" fill="#1f2a44"/><circle cx="210" cy="100" r="13" fill="#1f2a44"/>' +
    '<circle cx="268" cy="62" r="60" fill="url(#hl)"/><circle cx="266" cy="62" r="7" fill="#fff6d6"/>' +
    `<text x="248" y="40" font-family="${FONT}" font-size="22" font-weight="800" fill="#1f2a44" text-anchor="middle">3</text></g>`);
}

function glowSVG() {
  const r = prng(31);
  let sparks = '';
  for (let i = 0; i < 70; i++) sparks += `<circle cx="${(r() * 800) | 0}" cy="${250 + ((r() * 200) | 0)}" r="${f1(r() * 2.2 + 0.6)}" fill="#bffcf2" opacity="${f1(r() * 0.7 + 0.2)}"/>`;
  const wave = (y, k) => `M-20 ${y}q50 -${k} 100 0t100 0t100 0t100 0t100 0t100 0t100 0t100 0t100 0`;
  return svg(800, 450, lin('s', ['#0b1430', '#1a2a52']) + lin('w', ['#0d1d3a', '#071026']) + '<filter id="b" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>',
    '<rect width="800" height="450" fill="url(#s)"/>' + stars(12, 60, 800, 200) +
    '<path d="M0 232h40v-16h30v10h60v-24h26v30h90v-12h40v12h120v-20h30v20h140v-14h50v14h154v18H0z" fill="#091127"/>' +
    '<path d="M70 222h4v4h-4zM250 220h4v4h-4zM470 218h4v4h-4zM650 222h4v4h-4z" fill="#ffd88a"/>' +
    '<rect y="244" width="800" height="206" fill="url(#w)"/>' +
    `<g fill="none" stroke="#5ff3df" stroke-width="7" filter="url(#b)" opacity=".8"><path d="${wave(300, 12)}"/><path d="${wave(360, 16)}"/><path d="${wave(420, 18)}"/></g>` +
    `<g fill="none" stroke="#d9fff9" stroke-width="2"><path d="${wave(300, 12)}"/><path d="${wave(360, 16)}"/><path d="${wave(420, 18)}"/></g>` +
    sparks +
    '<path d="M300 330q80 30 230 6l-14 22H318z" fill="#050a18"/><path d="M380 318l-60 40M450 318l70 34" stroke="#050a18" stroke-width="5"/>' +
    '<circle cx="400" cy="306" r="11" fill="#050a18"/><path d="M388 330q12-22 24 0z" fill="#050a18"/>' +
    '<path d="M300 362q-40 10-80 4M530 356q50 10 90 2" stroke="#7ef9e8" stroke-width="5" fill="none" filter="url(#b)"/>');
}

function gaugeSVG() {
  let marks = '';
  for (let i = 0; i < 12; i++) marks += `<rect x="${i % 2 ? 600 : 588}" y="${150 + i * 24}" width="${i % 2 ? 12 : 24}" height="5" fill="#1f2a44"/>`;
  return svg(800, 450, lin('s', ['#f6e3c2', '#f3ead8']) + lin('w', ['#3b8c93', '#1d5c63']),
    '<rect width="800" height="450" fill="url(#s)"/><circle cx="140" cy="90" r="40" fill="#f2b84b" opacity=".7"/>' +
    '<rect y="300" width="800" height="150" fill="url(#w)"/>' + waves(318, 450, 800, '#a8e0e0', 13) +
    '<path d="M0 280h470v170H0z" fill="#b9a58a"/>' +
    '<path d="M0 280h470M0 318h470M0 356h470M0 394h470M0 432h470M60 280v38M180 280v38M300 280v38M420 280v38M120 318v38M240 318v38M360 318v38M60 356v38M180 356v38M300 356v38M420 356v38" stroke="#9c8a70" stroke-width="3"/>' +
    '<path d="M250 280V150h120v130z" fill="#c4553b"/><path d="M240 150l70-58 70 58z" fill="#1f2a44"/><rect x="304" y="70" width="12" height="24" fill="#1f2a44"/>' +
    '<circle cx="310" cy="190" r="30" fill="#fbf7ef" stroke="#1f2a44" stroke-width="5"/><path d="M310 190V170M310 190l14 8" stroke="#1f2a44" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M290 280v-46a20 20 0 0 1 40 0v46z" fill="#1f2a44"/>' +
    '<rect x="580" y="140" width="40" height="300" fill="#fbf7ef" stroke="#1f2a44" stroke-width="4"/>' + marks +
    '<path d="M560 108q10-10 20 0q10-10 20 0" fill="none" stroke="#1f2a44" stroke-width="3"/>' +
    '<path d="M470 300h110" stroke="#1f2a44" stroke-width="3" stroke-dasharray="8 6"/>');
}

function theatreSVG() {
  let bulbs = '';
  for (let x = 236; x <= 564; x += 16) bulbs += `<circle cx="${x}" cy="232" r="4"/><circle cx="${x}" cy="292" r="4"/>`;
  let people = '';
  for (let i = 0; i < 9; i++) {
    const x = 180 + i * 52, h = 54 + (i % 3) * 8;
    people += `<circle cx="${x}" cy="${410 - h}" r="11"/><path d="M${x - 16} 420v-${h - 16}a16 16 0 0 1 32 0v${h - 16}z"/>`;
  }
  return svg(800, 450, lin('s', ['#f4c9a0', '#8a5a8c'], 0, 1),
    '<rect width="800" height="450" fill="url(#s)"/>' +
    '<rect x="618" y="40" width="44" height="190" fill="#6e3326"/><rect x="612" y="34" width="56" height="12" fill="#4f241b"/>' +
    '<rect x="120" y="120" width="560" height="330" fill="#9c4a35"/><path d="M110 120l290-70 290 70z" fill="#6e3326"/>' +
    '<path d="M170 210v-40a26 26 0 0 1 52 0v40zM578 210v-40a26 26 0 0 1 52 0v40zM374 150v-30a26 26 0 0 1 52 0v30z" fill="#ffd88a"/>' +
    '<rect x="220" y="220" width="360" height="84" rx="6" fill="#1f2a44"/>' + `<g fill="#ffe08a">${bulbs}</g>` +
    `<text x="400" y="258" font-family="${FONT}" font-size="17" font-weight="800" fill="#f3ead8" text-anchor="middle" letter-spacing="1">THE RIVER KEEPS</text>` +
    `<text x="400" y="282" font-family="${FONT}" font-size="17" font-weight="800" fill="#f2b84b" text-anchor="middle" letter-spacing="1">ITS OWN COUNSEL</text>` +
    '<rect x="340" y="330" width="120" height="120" fill="#3a1e18"/><rect x="346" y="336" width="52" height="114" fill="#f2b84b" opacity=".85"/><rect x="402" y="336" width="52" height="114" fill="#f2b84b" opacity=".7"/>' +
    `<g fill="#2b1a2e">${people}</g>`);
}

function rowingSVG() {
  const boat = (x, y, c) => {
    let oars = '', heads = '';
    for (let i = 0; i < 8; i++) {
      const ox = x + 50 + i * 34;
      oars += `M${ox} ${y - 6}l-26 34`;
      heads += `<circle cx="${ox}" cy="${y - 22}" r="7" fill="${c}"/><rect x="${ox - 6}" y="${y - 16}" width="12" height="12" rx="3" fill="${c}"/>`;
    }
    return `<path d="M${x} ${y}h330l20 -6l-6 14H${x + 10}z" fill="#1f2a44"/><path d="${oars}" stroke="#f3ead8" stroke-width="4" stroke-linecap="round"/>${heads}<circle cx="${x + 330}" cy="${y - 18}" r="6" fill="#f2b84b"/>`;
  };
  let reeds = '';
  for (let x = 0; x < 800; x += 14) reeds += `M${x} 196q4 -${18 + (x % 5) * 4} 8 -${26 + (x % 7) * 3}`;
  return svg(800, 450, lin('s', ['#d8eef0', '#f7f3e8']) + lin('w', ['#4a9a94', '#2a6f73']),
    '<rect width="800" height="450" fill="url(#s)"/>' +
    '<path d="M0 200q200-30 400-10t400-6v26H0z" fill="#a9b98a"/>' + `<path d="${reeds}" stroke="#7d8f5e" stroke-width="2.5" fill="none"/>` +
    '<rect y="206" width="800" height="244" fill="url(#w)"/>' + waves(226, 450, 800, '#bfe9e4', 17) +
    boat(60, 300, '#e76f51') + boat(30, 390, '#2a9d8f') +
    '<path d="M700 230v190" stroke="#f3ead8" stroke-width="3" stroke-dasharray="10 8"/>' +
    '<circle cx="700" cy="250" r="9" fill="#e76f51"/><circle cx="700" cy="420" r="9" fill="#e76f51"/>' +
    '<rect x="736" y="120" width="5" height="110" fill="#1f2a44"/><path d="M741 122h46l-10 16 10 16h-46z" fill="#f2b84b"/>' +
    '<path d="M420 312q20-14 40 0M420 404q20-14 40 0" stroke="#fff" stroke-width="3" fill="none"/>');
}

function ferrySVG() {
  return svg(800, 450, lin('s', ['#fde2c4', '#cfe6ea']) + lin('w', ['#3a8c93', '#1d5c63']),
    '<rect width="800" height="450" fill="url(#s)"/><circle cx="160" cy="120" r="48" fill="#fff1d6"/>' +
    '<path d="M0 250h800v-20H560l-10-40h-12l-6 40H0z" fill="#b8c9c7"/>' +
    '<path d="M430 230L450 196H700L720 230" fill="none" stroke="#9fb0ae" stroke-width="7"/><path d="M450 196v34M512 196v34M575 196v34M637 196v34M700 196v34" stroke="#9fb0ae" stroke-width="4"/>' +
    '<rect y="250" width="800" height="200" fill="url(#w)"/>' + waves(270, 450, 800, '#a6dcdc', 19) +
    '<path d="M60 362q120 18 250 8" stroke="#e9f7f5" stroke-width="6" fill="none" stroke-linecap="round" opacity=".7"/>' +
    '<path d="M250 330h360l-30 50H285z" fill="#1f2a44"/><rect x="250" y="324" width="360" height="10" fill="#e76f51"/>' +
    '<rect x="300" y="270" width="250" height="56" rx="6" fill="#fbf7ef"/><rect x="340" y="236" width="150" height="36" rx="6" fill="#fbf7ef"/>' +
    '<path d="M316 284h28v20h-28zM356 284h28v20h-28zM396 284h28v20h-28zM436 284h28v20h-28zM476 284h28v20h-28zM516 284h20v20h-20zM356 246h24v16h-24zM392 246h24v16h-24zM428 246h24v16h-24z" fill="#2a9d8f"/>' +
    '<rect x="500" y="208" width="26" height="40" fill="#e76f51"/><rect x="500" y="208" width="26" height="8" fill="#1f2a44"/>' +
    '<path d="M512 200q-10-20 10-34q22-12 12-30" stroke="#fff" stroke-width="9" fill="none" stroke-linecap="round" opacity=".7"/>');
}

function columnistSVG() {
  let lines = '';
  for (let c = 0; c < 3; c++) for (let i = 0; i < 9; i++) lines += `M${200 + c * 112} ${196 + i * 18}h${i === 8 ? 50 : 94}`;
  return svg(800, 450, lin('d', ['#c98f5a', '#b07646']),
    '<rect width="800" height="450" fill="url(#d)"/>' +
    '<path d="M0 60h800M0 160h800M0 260h800M0 360h800" stroke="#a96d3e" stroke-width="2" opacity=".5"/>' +
    '<g transform="rotate(-4 400 225)"><rect x="176" y="70" width="372" height="330" fill="#fbf7ef"/>' +
    '<rect x="200" y="92" width="324" height="24" fill="#1f2a44"/><rect x="200" y="126" width="324" height="46" fill="#e76f51" opacity=".85"/>' +
    `<path d="${lines}" stroke="#b9b2a6" stroke-width="7"/></g>` +
    '<circle cx="650" cy="130" r="58" fill="#f3ead8"/><circle cx="650" cy="130" r="44" fill="#6b3e26"/><path d="M704 120q30 0 30 22t-30 18" stroke="#f3ead8" stroke-width="10" fill="none"/>' +
    '<g transform="rotate(32 600 330)"><rect x="470" y="318" width="210" height="24" rx="12" fill="#1f2a44"/><rect x="560" y="318" width="20" height="24" fill="#f2b84b"/><path d="M680 320l40 10-40 10z" fill="#f2b84b"/></g>' +
    '<path d="M70 300a34 34 0 1 0 0.1 0M150 300a34 34 0 1 0 0.1 0M104 334h12" fill="none" stroke="#1f2a44" stroke-width="6"/>');
}

function pressSVG() {
  let sheets = '';
  for (let i = 0; i < 6; i++) sheets += `<rect x="${560 + i * 4}" y="${330 - i * 12}" width="170" height="12" fill="${i % 2 ? '#f3ead8' : '#fbf7ef'}" stroke="#d6cdbb"/>`;
  return svg(800, 450, lin('s', ['#e9e2d4', '#d9cfbd']),
    '<rect width="800" height="450" fill="url(#s)"/><rect y="380" width="800" height="70" fill="#b9ad97"/>' +
    '<path d="M90 380V120h360v260" fill="#2b3a67"/><rect x="70" y="100" width="400" height="30" rx="6" fill="#1f2a44"/>' +
    '<circle cx="190" cy="220" r="62" fill="#8a8f98"/><circle cx="190" cy="220" r="40" fill="#c4c8cf"/><circle cx="350" cy="290" r="62" fill="#8a8f98"/><circle cx="350" cy="290" r="40" fill="#c4c8cf"/>' +
    '<path d="M150 158L470 228l230 18" stroke="#fbf7ef" stroke-width="20" fill="none"/>' +
    '<path d="M230 260q80 30 120 -32" stroke="#fbf7ef" stroke-width="20" fill="none"/>' +
    '<path d="M180 180h20v80h-20zM340 250h20v80h-20z" fill="#e76f51" opacity=".8"/>' +
    sheets +
    '<rect x="580" y="200" width="150" height="40" fill="#fbf7ef" transform="rotate(4 655 220)"/><rect x="592" y="208" width="126" height="10" fill="#1f2a44" transform="rotate(4 655 220)"/>' +
    '<circle cx="740" cy="90" r="30" fill="#f2b84b"/><path d="M740 70v20l14 10" stroke="#1f2a44" stroke-width="5" fill="none" stroke-linecap="round"/>');
}

function stampSVG() {
  let lines = '';
  for (let i = 0; i < 11; i++) lines += `M110 ${100 + i * 24}h${i % 4 === 3 ? 200 : 380}`;
  return svg(600, 400, '',
    '<rect width="600" height="400" fill="#c98f5a"/><rect x="80" y="40" width="440" height="340" fill="#fbf7ef" transform="rotate(-2 300 210)"/>' +
    `<path d="${lines}" stroke="#c9c1b2" stroke-width="8" transform="rotate(-2 300 210)"/>` +
    '<g transform="rotate(-14 300 210)" opacity=".9"><rect x="140" y="160" width="320" height="104" rx="10" fill="none" stroke="#c8402f" stroke-width="9"/>' +
    `<text x="300" y="214" font-family="${FONT}" font-size="46" font-weight="900" fill="#c8402f" text-anchor="middle" letter-spacing="3">EMBARGOED</text>` +
    `<text x="300" y="248" font-family="${FONT}" font-size="20" font-weight="700" fill="#c8402f" text-anchor="middle" letter-spacing="2">451 · NOT BEFORE 06:00</text></g>`);
}

// The Lantern Festival gallery: four night scenes sharing a sky and water.
function festivalSVG(kind) {
  const defs = lin('s', ['#121a3a', '#3a2f5e']) + lin('w', ['#1d2550', '#0e1330']) + halo('hl', '#ffd88a') + lin('f', ['#f2b84b', '#e76f51']);
  let body = '<rect width="600" height="400" fill="url(#s)"/>' + stars(40 + kind, 30, 600, 150);
  const r = prng(50 + kind);
  if (kind === 1) { // procession along the quay
    body += '<path d="M0 230h50v-60h40v40h60v-70h50v50h70v-40h60v60h80v-50h50v40h90v-30h50v60H0z" fill="#2a2450"/><rect y="290" width="600" height="110" fill="#3a3350"/><rect y="286" width="600" height="8" fill="#4d4568"/>';
    for (let i = 0; i < 9; i++) {
      const x = 36 + i * 66, h = 60 + ((r() * 16) | 0);
      body += `<path d="M${x} 300v-${h}" stroke="#151028" stroke-width="3"/><circle cx="${x + 14}" cy="${405 - h}" r="10" fill="#151028"/><path d="M${x + 2} 400v-${h - 30}a12 12 0 0 1 24 0v${h - 30}z" fill="#151028"/>` + lantern(x, 300 - h - 14, 0.9, LANTERN_COLORS[i % 5]);
    }
  } else if (kind === 2) { // boats with lanterns on the water
    body += '<rect y="220" width="600" height="180" fill="url(#w)"/>' + waves(236, 400, 600, '#5a6aa8', 61);
    for (let i = 0; i < 5; i++) {
      const x = 40 + i * 120 + ((r() * 30) | 0), y = 260 + (i % 2) * 70, c = LANTERN_COLORS[i % 5];
      body += `<path d="M${x} ${y + 22}h20M${x + 3} ${y + 32}h14M${x + 6} ${y + 42}h8" stroke="${c}" stroke-width="3" stroke-linecap="round" opacity=".45"/><path d="M${x - 30} ${y}h80l-12 16h-56z" fill="#141028"/><path d="M${x + 10} ${y}v-40" stroke="#141028" stroke-width="3"/>` + lantern(x + 10, y - 48, 0.8, c);
    }
  } else if (kind === 3) { // the giant fish lantern
    body += '<rect y="300" width="600" height="100" fill="#3a3350"/><circle cx="300" cy="180" r="190" fill="url(#hl)" opacity=".7"/>' +
      '<path d="M470 180l80-60v120z" fill="url(#f)"/><ellipse cx="300" cy="180" rx="180" ry="86" fill="url(#f)"/>' +
      '<path d="M200 120q30 60 0 120M260 104q34 76 0 152M320 100q34 80 0 160M380 108q30 72 0 144" fill="none" stroke="#fff3c4" stroke-width="5" opacity=".6"/>' +
      '<circle cx="170" cy="160" r="20" fill="#fbf7ef"/><circle cx="166" cy="160" r="9" fill="#1f2a44"/><path d="M128 196q16 12 30 2" stroke="#1f2a44" stroke-width="5" fill="none"/>' +
      '<path d="M290 96l40-40 30 46zM300 262l30 40 30-44z" fill="#e76f51"/>' +
      '<path d="M200 262v80M300 266v76M400 260v82" stroke="#151028" stroke-width="5"/>';
    for (let i = 0; i < 7; i++) { const x = 120 + i * 60; body += `<circle cx="${x}" cy="334" r="12" fill="#151028"/><path d="M${x - 14} 400v-46a14 14 0 0 1 28 0v46z" fill="#151028"/>`; }
    for (let i = 0; i < 30; i++) body += `<rect x="${(r() * 600) | 0}" y="${(r() * 280) | 0}" width="5" height="5" fill="${LANTERN_COLORS[i % 5]}" transform="rotate(${(r() * 90) | 0} 300 150)"/>`;
  } else { // strings of lanterns over Ropewalk Street
    body += '<path d="M0 0h170l40 400H0z" fill="#2a2450"/><path d="M600 0H430l-40 400h210z" fill="#2e2856"/><path d="M210 400l40-150h100l40 150z" fill="#3a3350"/>' +
      '<path d="M40 60h60v70H40zM40 190h60v70H40zM500 60h60v70h-60zM500 190h60v70h-60z" fill="#ffd88a" opacity=".85"/>';
    for (const [y0, y1, sag] of [[80, 90, 70], [170, 160, 60], [250, 255, 40]]) {
      body += `<path d="M170 ${y0}Q300 ${y0 + sag * 2} 430 ${y1}" fill="none" stroke="#151028" stroke-width="2"/>`;
      for (let t = 0.1; t < 0.95; t += 0.16) {
        const x = (1 - t) * (1 - t) * 170 + 2 * (1 - t) * t * 300 + t * t * 430;
        const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * (y0 + sag * 2) + t * t * y1;
        body += lantern(x, y + 14, 0.7, LANTERN_COLORS[((t * 10) | 0) % 5]);
      }
    }
  }
  return svg(600, 400, defs, body);
}

// The city map: water, districts, roads, landmarks. Districts are shared with the diagram (percent coordinates).
const DISTRICTS = {
  northbank: { label: 'Northbank', fill: '#eadfc6', pts: [[23, 6], [46, 4], [64, 6], [64, 41.5], [50, 42], [34, 38], [28, 30], [22, 15]] },
  lanternhill: { label: 'Lanternhill', fill: '#dfe6cc', pts: [[64, 6], [96, 4], [98, 36.6], [75, 41], [64, 41.5]] },
  oldquay: { label: 'Old Quay', fill: '#f2dcc6', pts: [[38, 60], [52, 57], [62, 55.6], [62, 78], [44, 80], [34, 74], [30, 70]] },
  brassworks: { label: 'Brassworks', fill: '#e8d4c4', pts: [[62, 55.6], [75, 54], [98, 50.5], [98, 94], [62, 94]] },
  saltmarsh: { label: 'Saltmarsh', fill: '#d8e4cf', pts: [[30, 70], [34, 74], [44, 80], [62, 78], [62, 94], [24, 96], [24, 85]] },
  gullwing: { label: 'Gullwing Island', fill: '#ebe3cf', pts: [[7, 46], [13, 43], [18, 47], [17, 55], [11, 58], [6, 54]] },
};
const P12x8 = (pts) => pts.map(([x, y]) => `${f1(x * 12)},${f1(y * 8)}`).join(' ');

function cityMapSVG() {
  const water = [[0, 0], [18, 0], [22, 15], [28, 30], [34, 38], [50, 42], [75, 41], [100, 37], [100, 50], [75, 54], [52, 57], [38, 60], [30, 70], [24, 85], [20, 100], [0, 100]];
  let blocks = '';
  const r = prng(77);
  const inPoly = (x, y, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  for (const k of ['northbank', 'oldquay', 'brassworks']) {
    for (let i = 0; i < 26; i++) {
      const x = r() * 100, y = r() * 100;
      if (inPoly(x, y, DISTRICTS[k].pts) && inPoly(x + 3, y + 3, DISTRICTS[k].pts)) blocks += `M${f1(x * 12)} ${f1(y * 8)}h${18 + ((r() * 14) | 0)}v${14 + ((r() * 10) | 0)}h-${18 + ((r() * 8) | 0)}z`;
    }
  }
  let reeds = '';
  for (let i = 0; i < 40; i++) { const x = 300 + r() * 380, y = 640 + r() * 100; if (inPoly(x / 12, y / 8, DISTRICTS.saltmarsh.pts)) reeds += `M${f1(x)} ${f1(y)}l-4 -12M${f1(x + 5)} ${f1(y)}l2 -14M${f1(x + 10)} ${f1(y)}l5 -10`; }
  return svg(1200, 800, lin('w', ['#a7d3d6', '#82bcc3']),
    '<rect width="1200" height="800" fill="#efe6d2"/>' +
    Object.values(DISTRICTS).map((d) => `<polygon points="${P12x8(d.pts)}" fill="${d.fill}" stroke="#d5c7a8" stroke-width="3" stroke-linejoin="round"/>`).join('') +
    `<polygon points="${P12x8(water)}" fill="url(#w)"/>` +
    `<polygon points="${P12x8(DISTRICTS.gullwing.pts)}" fill="${DISTRICTS.gullwing.fill}" stroke="#d5c7a8" stroke-width="3"/>` +
    waves(40, 800, 300, '#e7f6f6', 81) +
    '<path d="M820 120a90 50 0 1 0 0.1 0M840 140a60 30 0 1 0 0.1 0M860 160a30 14 0 1 0 0.1 0" fill="none" stroke="#b9c7a2" stroke-width="3"/>' +
    `<path d="${blocks}" fill="#d9c6a6"/>` + `<path d="${reeds}" stroke="#8fa77a" stroke-width="2.5" fill="none"/>` +
    '<path d="M300 140C450 160 560 120 760 150S1000 200 1160 140M624 330V60M380 600C520 620 640 640 1160 600M744 470V760M560 640L520 760" fill="none" stroke="#fbf7ef" stroke-width="9" stroke-linecap="round"/>' +
    '<path d="M624 330L700 250L800 200L900 150L1000 112" fill="none" stroke="#e76f51" stroke-width="5" stroke-dasharray="2 10" stroke-linecap="round"/>' +
    '<rect x="612" y="332" width="24" height="128" fill="#c4553b"/><path d="M612 340h24M612 360h24M612 380h24M612 400h24M612 420h24M612 440h24" stroke="#8f3a27" stroke-width="3"/>' +
    '<path d="M504 316V470" stroke="#1f2a44" stroke-width="4" stroke-dasharray="10 9"/><circle cx="504" cy="316" r="7" fill="#1f2a44"/><circle cx="504" cy="470" r="7" fill="#1f2a44"/>' +
    '<rect x="102" y="344" width="12" height="28" fill="#fbf7ef" stroke="#1f2a44" stroke-width="3"/><circle cx="108" cy="340" r="7" fill="#f2b84b"/>' +
    '<circle cx="1008" cy="112" r="11" fill="#e76f51" stroke="#fbf7ef" stroke-width="4"/>' +
    '<path d="M1080 700l20-60 20 60-20-14z" fill="#1f2a44"/>' + `<text x="1100" y="630" font-family="${FONT}" font-size="22" font-weight="700" fill="#1f2a44" text-anchor="middle">N</text>` +
    '<path d="M60 760h160" stroke="#1f2a44" stroke-width="6"/><path d="M60 760h80" stroke="#fbf7ef" stroke-width="3"/>' + `<text x="140" y="745" font-family="${FONT}" font-size="16" fill="#1f2a44" text-anchor="middle">1 km</text>` +
    `<text x="800" y="416" font-family="Georgia, serif" font-size="26" font-style="italic" fill="#3d6f74" text-anchor="middle">Gannet Estuary</text>`);
}

const media = {
  logo: svgMedia(logoSVG(), { name: 'courier-monogram.svg', alt: 'The Courier monogram: the letters PV above two coral waves' }),
  skyline: svgMedia(skylineSVG(), { name: 'port-velling-at-dusk.svg', alt: 'Port Velling at dusk: rooftops, the lighthouse, the Swing Bridge and floating lanterns on the estuary', credit: 'Illustration: Olu Fenwright' }),
  bridge: svgMedia(bridgeSVG(), { name: 'swing-bridge-closed.svg', alt: 'The red iron Swing Bridge with a CLOSED barrier, a crane and a cracked bearing on the central pier', credit: 'Illustration: Olu Fenwright' }),
  tram: svgMedia(tramSVG(), { name: 'night-tram.svg', alt: 'A coral-and-cream tram number 3 climbing Lanternhill at night under the moon', credit: 'Illustration: Olu Fenwright' }),
  glow: svgMedia(glowSVG(), { name: 'estuary-glow.svg', alt: 'Blue-green glowing waves on the dark estuary with a rowing boat leaving a trail of light', credit: 'Illustration: Olu Fenwright' }),
  gauge: svgMedia(gaugeSVG(), { name: 'tide-gauge-house.svg', alt: 'The brick tide gauge house on the Old Quay wall with its dial and a striped tide staff in the water', credit: 'Illustration: Olu Fenwright' }),
  theatre: svgMedia(theatreSVG(), { name: 'brassworks-theatre.svg', alt: 'The old foundry building of the Brassworks Theatre with a lit marquee and people queueing', credit: 'Illustration: Olu Fenwright' }),
  rowing: svgMedia(rowingSVG(), { name: 'estuary-cup.svg', alt: 'Two rowing eights racing towards a finish line of buoys past the reeds', credit: 'Illustration: Olu Fenwright' }),
  ferry: svgMedia(ferrySVG(), { name: 'quay-ferry.svg', alt: 'The navy-and-white Quay ferry crossing the river with the closed Swing Bridge behind it', credit: 'Illustration: Olu Fenwright' }),
  columnist: svgMedia(columnistSVG(), { name: 'opinion-desk.svg', alt: 'A desk seen from above: a newspaper, a fountain pen, a cup of coffee and reading glasses', credit: 'Illustration: Olu Fenwright' }),
  press: svgMedia(pressSVG(), { name: 'printing-press.svg', alt: 'A flat illustration of a printing press feeding sheets of paper onto a stack', credit: 'Illustration: Olu Fenwright' }),
  stamp: svgMedia(stampSVG(), { name: 'embargo-stamp.svg', alt: 'A typed page with a red rubber stamp reading EMBARGOED, 451, not before 06:00', credit: 'Illustration: Olu Fenwright' }),
  lantern1: svgMedia(festivalSVG(1), { name: 'lantern-procession.svg', alt: 'Silhouettes carrying lanterns on poles along the quay at night', credit: 'Illustration: Olu Fenwright' }),
  lantern2: svgMedia(festivalSVG(2), { name: 'lantern-boats.svg', alt: 'Small boats with glowing lanterns on masts, reflected in the dark water', credit: 'Illustration: Olu Fenwright' }),
  lantern3: svgMedia(festivalSVG(3), { name: 'giant-fish-lantern.svg', alt: 'A giant glowing fish-shaped lantern carried on poles above a crowd, with confetti', credit: 'Illustration: Olu Fenwright' }),
  lantern4: svgMedia(festivalSVG(4), { name: 'ropewalk-lanterns.svg', alt: 'Strings of paper lanterns hanging across a narrow street between houses', credit: 'Illustration: Olu Fenwright' }),
  citymap: svgMedia(cityMapSVG(), { name: 'port-velling-map.svg', alt: 'Map of Port Velling: the Gannet Estuary dividing Northbank and Lanternhill from Old Quay, Brassworks and Saltmarsh, with Gullwing Island in the bay', credit: 'Map: Courier graphics desk' }),
};

// ---------------------------------------------------------------------------------------------
// Shared blocks

const NAVBOX = {
  type: 'navbox', title: 'The Port Velling Courier', color: '#1f2a44',
  groups: [
    { label: 'Sections', links: '[[city|City]]\n[[science|Science]]\n[[culture|Culture]]\n[[sport|Sport]]\n[[opinion|Opinion]]' },
    { label: 'Running story', links: '[[city/swing-bridge|Swing Bridge repairs]]\n[[opinion/keep-the-ferry|Keep the ferry]]\n[[city/night-tram|Night tram]]' },
    { label: 'Explainers', links: '[[science/estuary-glow|Why does the estuary glow?]]\n[[science/tide-gauge|The tide gauge at 150]]' },
    { label: 'Culture & sport', links: '[[culture/lantern-festival|Lantern Festival in pictures]]\n[[culture/river-play|Review: The River Keeps Its Own Counsel]]\n[[sport/estuary-cup|Estuary Cup]]' },
    { label: 'The paper', links: '[[front-page|Front page]]\n[[map|City map]]\n[[about|About us]]\n[[about#Editorial standards|Standards]]\n[[corrections|Corrections]]' },
  ],
};

const by = (name, desk) => `[[about#Newsroom|${name}]], ${desk}`;

const glowDiagram = {
  type: 'diagram', aspect: '16:9', bg: '#0f1d36', labels: 'always', align: 'center',
  caption: 'From a splash to a flash: what happens inside one glowing cell, in under a second.',
  items: [
    { id: 'wave', shape: 'none', x: 13, y: 50, label: 'A wave, an oar or a swimmer stirs the water' },
    { id: 'cell', shape: 'none', x: 38, y: 20, label: 'The cell’s outer wall is bent' },
    { id: 'signal', shape: 'none', x: 64, y: 20, label: 'An electrical signal sweeps through the cell' },
    { id: 'acid', shape: 'none', x: 87, y: 50, label: 'Acid floods the tiny light pockets ({{tip|scintillons|Small sacs inside the cell that hold the light-making chemicals}})' },
    { id: 'react', shape: 'none', x: 64, y: 82, label: 'The enzyme luciferase makes luciferin give off light' },
    { id: 'flash', shape: 'none', x: 38, y: 82, label: 'A blue-green flash lasting about a tenth of a second' },
  ],
  edges: [{ from: 'wave', to: 'cell' }, { from: 'cell', to: 'signal' }, { from: 'signal', to: 'acid' }, { from: 'acid', to: 'react' }, { from: 'react', to: 'flash' }],
};

// ---------------------------------------------------------------------------------------------
// Pages

const frontPage = {
  slug: 'front-page', title: 'Front page', display: 'The Port Velling Courier', toc: 'off', layout: 'wide',
  summary: 'Independent news from the Gannet Estuary since 1871: the city, science, culture, sport and opinion.',
  blocks: [
    {
      type: 'banner', style: 'overlay', media: 'skyline', link: 'city/swing-bridge', button: 'Follow the running story',
      title: 'Swing Bridge to stay shut until spring',
      text: 'The 1904 bridge between Old Quay and Northbank needs a new pivot bearing, cast in the city’s own Brassworks. Every development, as it happens.',
    },
    {
      type: 'pagelist', title: 'Latest stories', source: 'links', style: 'hero', limit: 9, summary: true,
      links: ['city/swing-bridge', 'sport/estuary-cup', 'opinion/keep-the-ferry', 'city/night-tram', 'culture/river-play', 'science/estuary-glow', 'culture/lantern-festival', 'science/tide-gauge'].map((link) => ({ link })),
    },
    {
      type: 'columns', ratio: '2:1', cols: [
        { blocks: [
          { type: 'heading', text: 'In brief', level: '2' },
          { type: 'text', text: '- **Bridge:** repairs to the [[city/swing-bridge|Swing Bridge]] will run until March; the [[opinion/keep-the-ferry|Quay ferry]] now sails every ten minutes at peak times.\n- **Trams:** the [[city/night-tram|Lanternhill night tram]] is back on Friday and Saturday nights after nine years.\n- **Rowing:** Saltmarsh take the [[sport/estuary-cup|Estuary Cup]] by a canvas in the closest finish for decades.\n- **Theatre:** four stars for *[[culture/river-play|The River Keeps Its Own Counsel]]* at the Brassworks.\n- **Science:** why the estuary [[science/estuary-glow|glows blue on late-summer nights]] - in full, or in plain words.\n- **150 years:** the [[science/tide-gauge|Old Quay tide gauge]] has measured every tide since 1876.' },
        ] },
        { blocks: [
          { type: 'callout', kind: 'info', title: 'Today in Port Velling', text: '**High water at Old Quay:** 06:41 (4.6 m) and 19:02 (4.4 m), read from the [[science/tide-gauge|Victorian tide gauge]].\n\n**Crossing the river:** Swing Bridge closed; Quay ferry every 10 minutes, 06:00–23:30.\n\n**Tonight:** *The River Keeps Its Own Counsel*, Brassworks Theatre, 19:30.' },
          { type: 'quote', style: 'pull', text: 'A bridge is a promise that the two halves of a city will keep meeting. A ferry is the proof that they want to.', author: '[[opinion/keep-the-ferry|Maud Kestering]]', source: 'Opinion' },
        ] },
      ],
    },
    {
      type: 'pagelist', title: 'Sections', source: 'links', style: 'cards', summary: true,
      links: ['city', 'science', 'culture', 'sport', 'opinion'].map((link) => ({ link })),
    },
    {
      type: 'media', media: 'citymap', link: 'map', align: 'left', width: 420, layout: 'split', caption: 'Open the interactive map',
      text: '## Find your way around\nThe [[map|interactive map of Port Velling]] shows the six districts, the bridge diversion, the ferry crossing and where this week’s stories happened. Hover over a district for a preview; click to read on.\n\nNew to the Courier? Read [[about|who we are]], our [[about#Editorial standards|editorial standards]] and the [[corrections|corrections]] we have published.',
    },
    NAVBOX,
  ],
};

const section = (slug, title, image, summary, intro, extra = []) => ({
  slug, title, image, summary, toc: 'off', cats: ['sections'], order: 1,
  blocks: [
    { type: 'text', text: intro },
    { type: 'pagelist', title: `Latest in ${title}`, source: 'category', category: slug, style: 'hero', sort: 'date', limit: 10, summary: true },
    ...extra,
    NAVBOX,
  ],
});

const sections = [
  section('city', 'City', 'bridge', 'Council, transport, housing and the harbour: news from every district of Port Velling.',
    'The City desk covers the council chamber, the harbour, transport and the six districts of Port Velling - from the hill streets of [[map#Lanternhill|Lanternhill]] to the reed beds of [[map#Saltmarsh|Saltmarsh]]. Our biggest story this autumn is the closure of the [[city/swing-bridge|Swing Bridge]].',
    [
      { type: 'callout', kind: 'important', title: 'Running story: the Swing Bridge', text: 'The bridge between Old Quay and Northbank has been closed since 2 September. Read [[city/swing-bridge|the story so far]], with a full timeline, or the argument for [[opinion/keep-the-ferry|keeping the ferry]] once it reopens.' },
      { type: 'text', text: '## Districts\nNot sure where Brassworks ends and Saltmarsh begins? The [[map|city map]] has a short guide to each district and the stories we have reported there.' },
    ]),
  section('science', 'Science', 'glow', 'The estuary, the weather, the sea and the people who measure them - explained clearly.',
    'Science at the Courier means the natural world on our doorstep: the tides, the estuary, the weather off Gullwing Island. Our explainers answer one question at a time, and many come in two versions: the **full story** and the same story **in plain words**.',
    [{ type: 'callout', kind: 'tip', title: 'Two ways to read', text: 'Look for the version switch under the headline of [[science/estuary-glow|Why does the estuary glow?]] - pick *Full story* or *In plain words*.' }]),
  section('culture', 'Culture', 'theatre', 'Theatre, festivals, music and pictures from Port Velling’s cultural life.',
    'Reviews, festivals and pictures. This month: a four-star new play at the [[culture/river-play|Brassworks Theatre]] and our pictures editor’s favourite moments from the [[culture/lantern-festival|Lantern Festival]].'),
  section('sport', 'Sport', 'rowing', 'Rowing, football and running on and around the estuary.',
    'From the rowing clubs of the estuary to Sunday league football on Northbank Common. This week: the closest [[sport/estuary-cup|Estuary Cup]] finish in living memory.',
    [{ type: 'table', caption: 'Fixtures this week', head: 'row', striped: true, compact: true, rows: [
      ['Day', 'Event', 'Where'],
      ['Saturday', 'Northbank Athletic v Brassworks Rovers', 'Northbank Common'],
      ['Saturday', 'Junior sculls, autumn series', 'Saltmarsh Rowing Club'],
      ['Sunday', 'Lanternhill 10K', 'Start: tram terminus'],
    ] }]),
  section('opinion', 'Opinion', 'columnist', 'Columns, editorials and letters. The views are the writers’ own.',
    'Our columnists argue; our news pages report. Columns carry the writer’s name and a clear label, as our [[about#Editorial standards|editorial standards]] require. This week [[opinion/keep-the-ferry|Maud Kestering]] makes the case for the Quay ferry.',
    [{ type: 'text', text: '## Letters\n> The night tram is back, and my shift at the infirmary finally ends with a ride home rather than a forty-minute climb. Thank you to everyone who signed the petition.\n> - *A reader, Lanternhill*\n\n> Your bridge timeline was the first time I understood why a crack the size of a pencil closes a bridge for six months.\n> - *A reader, Old Quay*\n\nWrite to the letters desk at the Courier office on Ropewalk Street (see [[about|about us]]). Letters may be shortened.' }]),
];

const swingBridge = {
  slug: 'city/swing-bridge', parent: 'city', title: 'Swing Bridge repairs: the story so far', date: '2026-10-12', author: by('Ines Tallowby', 'City Desk'),
  cats: ['city', 'running-stories'], image: 'bridge',
  summary: 'Port Velling’s 1904 Swing Bridge closed on 2 September after a diver found a cracked pivot bearing. What we know, updated as the repair goes on.',
  blocks: [
    { type: 'hatnote', kind: 'about', text: 'This is a **running story**, updated as events happen. For the argument about what happens after the bridge reopens, see [[opinion/keep-the-ferry]].' },
    {
      type: 'infobox', title: 'Swing Bridge', subtitle: 'Old Quay ↔ Northbank', image: 'bridge', caption: 'The bridge at low water, closed to traffic.', color: '#c4553b',
      rows: [
        { label: 'Opened', value: '1904' },
        { label: 'Type', value: 'Iron truss swing bridge' },
        { label: 'Swing span', value: '64 m{{layer|factcheck| ✔ measured drawing, 1903}}' },
        { header: true, label: 'Closure' },
        { label: 'Closed since', value: '2 September 2026' },
        { label: 'Reason', value: 'Cracked pivot bearing' },
        { label: 'Diversion', value: '[[opinion/keep-the-ferry|Quay ferry]]; Lanternhill Road (cars)' },
        { label: 'Target reopening', value: 'March 2027' },
        { label: 'Fact-check', value: 'Dates checked against council minutes and Harbour Authority notices.', layer: 'factcheck' },
      ],
    },
    {
      type: 'text',
      text: 'The **Swing Bridge**, the iron bridge that has joined [[map#Old Quay|Old Quay]] to [[map#Northbank|Northbank]] since 1904, will stay closed to traffic until at least March 2027, the city council confirmed on Monday. A diver working for the Harbour Authority found a crack in the bridge’s central **pivot bearing** on 2 September, and the bridge was shut the same afternoon.{{ref|name=notice|Port Velling Harbour Authority, closure notice of 2 September 2026.}}\n\n' +
        '## What happened\nThe Swing Bridge does not lift; it turns. Its 64-metre span sits on a single bearing on the central pier and swings sideways to let tall ships through - something it now does only a few times a year. Last November’s five-yearly survey recommended “close monitoring” of that bearing.{{ref|name=survey|{{cite|author=Port Velling Harbour Authority|title=Swing Bridge five-yearly condition survey|year=2025|publisher=PVHA Engineering Office}}}} When a routine dive in September found a hairline crack in the bearing race, engineers closed the bridge rather than risk the span settling out of line.{{layer|factcheck| ✔ The survey wording was confirmed with the Harbour Authority press office.}}\n\n' +
        '## Why it takes so long\nThe bearing is a 1904 casting with no spare. A replacement has to be patterned, cast, machined and fitted with the span jacked up a few centimetres - work that can only be done on calm days. The contract went to the Brassworks Foundry Co-operative, which still has the original drawings in its archive.{{ref|{{cite|author=Brassworks Foundry Co-operative|title=Statement on the Swing Bridge bearing contract|work=Press release|year=2026}}}}\n\n' +
        '## How to get across now\n- **On foot or by bike:** the [[opinion/keep-the-ferry|Quay ferry]] runs every 10 minutes at peak times, 06:00–23:30.\n- **By car:** the signed diversion uses Lanternhill Road and the upstream crossing; allow 25 extra minutes.\n- **By tram:** line 3, including the restored [[city/night-tram|night service]], is not affected north of the river.\n\n' +
        '## What happens next\nThe council will publish a monthly progress note. The [[corrections|corrections page]] lists any changes we make to this story.',
    },
    { type: 'callout', kind: 'important', title: 'Correction', text: 'An earlier version of this story gave the swing span as 46 metres. It is 64 metres. See [[corrections]].' },
    {
      type: 'timeline', title: 'Timeline', style: 'line', items: [
        { date: '14 November 2025', title: 'Survey flags the pivot bearing', text: 'The Harbour Authority’s five-yearly survey recommends close monitoring of the central bearing.' },
        { date: '3 June 2026', title: 'Council sets money aside', text: 'LC 1.2 million is put into the maintenance budget for “bearing works, if required”.{{ref|name=minutes|{{cite|author=Port Velling City Council|title=Minutes of the Finance and Infrastructure Committee, 3 June 2026|year=2026|publisher=Port Velling City Council}}}}' },
        { date: '2 September 2026', title: 'Bridge closed', text: 'A routine dive finds a crack; the bridge closes at 15:40.' },
        { date: '9 September 2026', title: 'Ferry doubled', text: 'The Quay ferry moves to a 10-minute peak timetable.', link: 'opinion/keep-the-ferry' },
        { date: '24 September 2026', title: 'Foundry wins the contract', text: 'The new bearing will be cast in Brassworks from the 1903 drawings.' },
        { date: '6 October 2026', title: 'Divers inspect the pier', text: 'No further damage is found to the stone pier.' },
        { date: '12 October 2026', title: 'Spring reopening confirmed', text: 'The council names March 2027 as its target.' },
      ],
    },
    {
      type: 'table', caption: 'What the repair costs (council estimate, October 2026)', head: 'row', striped: true,
      rows: [
        ['Item', 'Cost (LC)'],
        ['Pattern, casting and machining of the bearing', '410,000'],
        ['Jacking and temporary supports', '265,000'],
        ['Divers and pier inspection', '58,000'],
        ['Extra ferry sailings (to March)', '190,000'],
        ['Contingency', '120,000'],
        ['**Total**', '**1,043,000**'],
      ],
    },
    { type: 'quote', style: 'block', text: 'It is a beautiful piece of Victorian engineering, and it was built to be repaired. We just have to do it the way they did - slowly.', author: 'Harbour Authority bridge engineer', source: 'speaking to the Courier, 6 October 2026' },
    { type: 'callout', kind: 'note', title: 'Fact-check notes', layer: 'factcheck', text: 'Every date in the timeline was checked against a published document: Harbour Authority notices, council minutes or the foundry’s statement. The cost table is the council’s estimate, not a final figure.' },
    {
      type: 'seealso', items: [
        { link: 'opinion/keep-the-ferry', label: 'Keep the ferry running after the bridge reopens', note: 'opinion' },
        { link: 'map', label: 'Map of Port Velling', note: 'the bridge, the ferry and the diversion' },
        { link: 'city/night-tram', label: 'Night tram returns to Lanternhill' },
        { link: 'culture/river-play', label: 'Review: a play set at the bridge’s opening in 1904' },
      ],
    },
    { type: 'references' },
    NAVBOX,
  ],
};

const nightTram = {
  slug: 'city/night-tram', parent: 'city', title: 'Night tram returns to Lanternhill after nine years', date: '2026-10-09', author: by('Ines Tallowby', 'City Desk'),
  cats: ['city'], image: 'tram',
  summary: 'Line 3 runs again on Friday and Saturday nights until 01:30, after a petition signed by 6,400 residents.',
  blocks: [
    { type: 'media', media: 'tram', align: 'right', width: 380, caption: 'Tram 3 on the climb to the summit terminus.' },
    {
      type: 'text',
      text: 'For the first time since 2017, a tram climbed [[map#Lanternhill|Lanternhill]] after midnight on Friday. The restored **night service on line 3** will run every 20 minutes on Friday and Saturday nights until 01:30, from the Northbank ferry stop to the summit terminus.\n\n' +
        'The service was cut nine years ago to save money. It came back after a petition signed by 6,400 residents - many of them shift workers at Lanternhill Infirmary - and a trial funded by the hospital and two hill-top pubs.{{ref|{{cite|author=Port Velling Transport Board|title=Line 3 night service: trial report and decision|year=2026|publisher=Port Velling Transport Board}}}}\n\n' +
        '## Why now\nThe closure of the [[city/swing-bridge|Swing Bridge]] has pushed more people onto the [[opinion/keep-the-ferry|Quay ferry]], which lands at Northbank right beside the line 3 stop. Linking the last ferry with a tram up the hill was, in the words of one councillor, “the cheapest good idea we have had this year”.\n\n' +
        '## Timetable',
    },
    {
      type: 'table', caption: 'Line 3 night service, Friday and Saturday', head: 'row', striped: true, compact: true,
      rows: [['Stop', 'First night tram', 'Last night tram'], ['Northbank ferry stop', '23:50', '01:10'], ['Infirmary', '23:58', '01:18'], ['Bell Street', '00:04', '01:24'], ['Summit terminus', '00:10', '01:30']],
    },
    { type: 'text', text: 'The trial will be reviewed in March, when the bridge is due to reopen. Riders can leave comments with the Transport Board until the end of January.{{layer|factcheck| ✔ Times confirmed with the Transport Board timetable office.}}' },
    { type: 'references' },
    NAVBOX,
  ],
};

const glowFull = [
  { type: 'hatnote', kind: 'about', text: 'This is an **explainer**. Use the version switch above to read it *in plain words*. For the night the river lit up the Lantern Festival, see [[culture/lantern-festival]].' },
  { type: 'media', media: 'glow', align: 'full', caption: 'Each spark of light is a single cell, flashing as the water around it moves.' },
  {
    type: 'text',
    text: 'On calm nights in late August and September, the [[map#The estuary|Gannet Estuary]] does something that brings half of Port Velling down to the water: every wave, oar stroke and swimming dog leaves a trail of **blue-green light**. This year’s display, which peaked on the night of the [[culture/lantern-festival|Lantern Festival]], was the brightest the Gannet Estuary Monitoring Trust has recorded.{{ref|name=trust|{{cite|author=Gannet Estuary Monitoring Trust|title=Annual water quality and plankton report 2026|year=2026|publisher=GEMT}}}}\n\n' +
      '## Living light\nThe light is made by living things: mostly {{tip|dinoflagellates|Single-celled plankton, many of them able to swim with two tiny whip-like tails}}, single-celled plankton far too small to see one by one. Making light from a chemical reaction inside a living body is called **bioluminescence**. Fireflies do it; so do many deep-sea fish. In these plankton the reaction involves a light-giving molecule, **luciferin**, and an enzyme, **luciferase**, that makes it react.\n\n' +
      '## Why the flash needs a splash\nThe cells do not glow steadily. They flash when the water around them is disturbed, because bending the cell sets off an electrical signal inside it, which releases the light reaction - all in a fraction of a second. Biologists think the flash works like a burglar alarm: it startles small animals that eat plankton, and it can attract larger animals that eat *them*.',
  },
  glowDiagram,
  {
    type: 'text',
    text: '## Why late summer\nBlooms follow a recipe: warm water, calm weather and plenty of nutrients washed down the river. The Monitoring Trust counts “bright nights” every year from the Gullwing Island jetty.{{ref|name=trust}} Many of these plankton also keep an internal daily clock and save their light for the night.',
  },
  {
    type: 'table', caption: 'Bright nights recorded from Gullwing Island jetty (Monitoring Trust)', head: 'row', sortable: true, striped: true,
    rows: [['Year', 'Bright nights', 'Brightest night'], ['2022', '9', '30 August'], ['2023', '4', '11 September'], ['2024', '12', '2 September'], ['2025', '7', '27 August'], ['2026', '15', '3 October']],
  },
  {
    type: 'text',
    text: '## Is it safe?\nThe glow itself is harmless. But a bloom is a sign of a crowded, nutrient-rich estuary, and the Trust tests the water for harmful species whenever it sees one. Its advice: enjoy the light from the shore or a boat, do not swim at night, and check the Trust’s notices before taking a dip by day.{{layer|factcheck| ✔ Safety wording agreed with the Monitoring Trust’s science officer.}}\n\n' +
      '## How to see it\nGo on a dark, calm night, away from the quay lights - the shingle below [[map#Saltmarsh|Saltmarsh]] is a good spot - and stir the water with your hand. Your eyes need around twenty minutes to adapt to the dark.',
  },
  {
    type: 'seealso', items: [
      { link: 'science/tide-gauge', label: 'The tide gauge that has watched Old Quay for 150 years' },
      { link: 'culture/lantern-festival', label: 'In pictures: the Lantern Festival', note: 'the night the river joined in' },
      { link: 'culture/river-play', label: 'The River Keeps Its Own Counsel', note: 'a play that ends with the glow' },
    ],
  },
  { type: 'references' },
  NAVBOX,
];

const glowPlain = [
  { type: 'hatnote', kind: 'about', text: 'This is the **plain words** version of our explainer. Switch to *Full story* above for more detail and sources.' },
  { type: 'media', media: 'glow', align: 'full', caption: 'The glow on the estuary. Each spark is one tiny living cell.' },
  {
    type: 'text',
    text: 'Some nights, the river in Port Velling glows blue. Here is why, in five short points.\n\n' +
      '- **It is alive.** The light comes from tiny living things in the water. They are too small to see one by one.\n- **They glow when the water moves.** A wave, a boat or your hand makes them flash.\n- **The flash is fast.** Each one lasts less than a second.\n- **It happens in late summer.** Warm, calm water helps them grow in huge numbers.\n- **It is safe to watch.** Look from the shore. Do not swim in the river at night.\n\n' +
      '## Why do they flash?\nScientists think the flash scares away small animals that want to eat them. It is a bit like a burglar alarm.\n\n' +
      '## Where can I see it?\nFind a dark, quiet spot by the water, like the beach below [[map#Saltmarsh|Saltmarsh]]. Wait until your eyes get used to the dark. Then gently stir the water.',
  },
  glowDiagram,
  { type: 'callout', kind: 'tip', title: 'Words to know', text: '**Plankton:** tiny living things that drift in water.\n\n**Bioluminescence:** light made by a living thing.' },
  NAVBOX,
];

const estuaryGlow = {
  slug: 'science/estuary-glow', parent: 'science', title: 'Why does the estuary glow?', date: '2026-10-05', author: by('Rook Asquemore', 'Science Editor'),
  cats: ['science', 'explainers'], image: 'glow',
  summary: 'The blue light on the Gannet Estuary is made by single-celled plankton that flash when the water moves. An explainer in two versions.',
  versions: [{ id: 'full', label: 'Full story', blocks: glowFull }, { id: 'plain', label: 'In plain words', blocks: glowPlain }],
};

const tideGauge = {
  slug: 'science/tide-gauge', parent: 'science', title: 'The tide gauge that has watched Old Quay for 150 years', date: '2026-09-28', author: by('Rook Asquemore', 'Science Editor'),
  cats: ['science'], image: 'gauge',
  summary: 'Since 1876 a float in a brick tower on the Old Quay wall has recorded every tide - one of the longest local sea-level records on the coast.',
  blocks: [
    {
      type: 'infobox', title: 'Old Quay tide gauge', image: 'gauge', caption: 'The gauge house and its tide staff.', color: '#1d5c63',
      rows: [
        { label: 'Built', value: '1876, by the Port Velling Harbour Board' },
        { label: 'Location', value: '[[map#Old Quay|Old Quay]] wall, Ropewalk Steps' },
        { label: 'Method', value: 'Float in a stilling well, pen on a turning paper drum' },
        { label: 'Digital since', value: '1994' },
        { label: 'Records', value: 'Hourly heights, 150 years' },
      ],
    },
    {
      type: 'text',
      text: 'Inside a small brick tower on the [[map#Old Quay|Old Quay]] wall, a copper float has risen and fallen with every tide for 150 years. The **Old Quay tide gauge**, built in 1876, turns 150 this month - and its record of the estuary’s height has become one of the most valuable things the city owns.\n\n' +
        '## How it works\nThe float sits in a {{tip|stilling well|A pipe open to the river at the bottom, so waves are smoothed out but the slow rise and fall of the tide gets through}}, connected by a wire to a pen. As the tide rises, the pen draws a line on a paper drum turned by a clock. Since 1994 an electronic sensor has run alongside the float, but the pen still draws: when the electronics failed in the storm of 2013, the paper record filled the gap.\n\n' +
        '## What 150 years show\nVolunteers from the Harbour Society have typed up the old paper charts, decade by decade.{{ref|{{cite|author=Port Velling Harbour Society|title=Old Quay tide records 1876–2025, transcribed edition|year=2026|publisher=Harbour Society Press}}}} The headline: average high water at Old Quay is now about 19 centimetres higher than when the gauge was built.',
    },
    {
      type: 'table', caption: 'Average high water at Old Quay, above the 1876 datum (Harbour Society transcription)', head: 'row', sortable: true, striped: true, compact: true,
      rows: [['Decade', 'Average high water (cm)', 'Change since 1876 (cm)'], ['1880s', '412', '+1'], ['1910s', '414', '+3'], ['1940s', '417', '+6'], ['1970s', '420', '+9'], ['2000s', '425', '+14'], ['2016–2025', '430', '+19']],
    },
    {
      type: 'quote', style: 'block', layer: 'archive',
      text: 'The new tide gauge upon the Old Quay was set going on Monday, in the presence of the Harbour Board and a great many boys. The machine writes down the tide by itself, day and night, and the Board is assured it will do so for a hundred years.',
      author: 'The Port Velling Courier', source: 'From the archive, September 1876',
    },
    {
      type: 'text',
      text: '## Why it matters\nLong, unbroken records are rare. Engineers used this one when they designed the 1990s flood gates, and the Harbour Authority will use it again when it plans the [[city/swing-bridge|Swing Bridge]] repairs, which have to be done at the right state of the tide.\n\nThe front page prints the day’s high-water times from the gauge every morning - see [[front-page|today’s edition]].{{layer|factcheck| ✔ Figures in the table were checked against the Harbour Society’s published transcription.}}',
    },
    { type: 'callout', kind: 'note', title: 'Correction', text: 'An earlier version gave the year the gauge was built as 1867. It was 1876. See [[corrections]].' },
    { type: 'seealso', items: [{ link: 'science/estuary-glow', label: 'Why does the estuary glow?' }, { link: 'map', label: 'Map of Port Velling' }] },
    { type: 'references' },
    NAVBOX,
  ],
};

const lanternFestival = {
  slug: 'culture/lantern-festival', parent: 'culture', title: 'In pictures: the Lantern Festival 2026', date: '2026-10-04', author: by('Olu Fenwright', 'Pictures Editor'),
  cats: ['culture', 'pictures'], image: 'lantern3',
  summary: 'Twelve thousand lanterns, one giant fish and an estuary that glowed back: the festival night in pictures.',
  blocks: [
    {
      type: 'text',
      text: 'Saturday’s **Lantern Festival** drew the biggest crowd in its history to [[map#Old Quay|Old Quay]] - and, for the first time, the river joined in: the [[science/estuary-glow|estuary glow]] peaked the same night. Our pictures editor spent the evening on the quay. Tap a picture to enlarge it.',
    },
    {
      type: 'gallery', title: 'Festival night', style: 'grid', size: 'l',
      items: [
        { media: 'lantern1', caption: 'The procession sets off along the quay at dusk.' },
        { media: 'lantern2', caption: 'Rowing club boats carry lanterns out on the water.', link: 'sport/estuary-cup' },
        { media: 'lantern3', caption: 'The giant fish lantern, made by pupils of Saltmarsh Primary School.' },
        { media: 'lantern4', caption: 'Ropewalk Street, strung with lanterns, outside the Courier office.', link: 'about' },
      ],
    },
    {
      type: 'text',
      text: '## A short history\nThe festival began in 1952, when fishing families walked lanterns to the quay to mark the end of the herring season. Today it is run by volunteers, and every lantern is handmade at workshops in the weeks before. This year the procession avoided the closed [[city/swing-bridge|Swing Bridge]] and finished at the ferry pier instead.',
    },
    { type: 'quote', style: 'block', text: 'We planned for the bridge being shut. We did not plan for the river lighting up. Nobody will forget this one.', author: 'Festival committee chair', source: 'speaking on the night' },
    { type: 'callout', kind: 'note', title: 'From the archive', layer: 'archive', text: 'The Courier’s first festival report, in 1952, described “some two hundred lanterns and a brass band that knew three tunes”.' },
    { type: 'callout', kind: 'info', title: 'Clarification', text: 'An earlier caption credited the giant fish lantern to the Brassworks workshop; it was made by Saltmarsh Primary School. See [[corrections]].' },
    NAVBOX,
  ],
};

const riverPlay = {
  slug: 'culture/river-play', parent: 'culture', title: 'Review: The River Keeps Its Own Counsel, Brassworks Theatre',
  display: 'Review: *The River Keeps Its Own Counsel*, Brassworks Theatre', date: '2026-10-08', author: by('Dara Pellinore', 'Theatre Critic'),
  cats: ['culture'], image: 'theatre',
  summary: 'A new play about the summer the Swing Bridge opened in 1904 is funny, generous and, in its last ten minutes, astonishing. Four stars.',
  blocks: [
    {
      type: 'infobox', title: 'The River Keeps Its Own Counsel', image: 'theatre', caption: 'The Brassworks Theatre, a converted foundry.', color: '#9c4a35',
      rows: [
        { label: 'Venue', value: 'Brassworks Theatre ([[map#Brassworks|Brassworks]])' },
        { label: 'Writer', value: 'Ottilie Marsh' },
        { label: 'Director', value: 'Kasimir Doole' },
        { label: 'Running time', value: '2 h 10 min, with an interval' },
        { label: 'Until', value: '21 November 2026' },
        { label: 'Rating', value: '★★★★☆' },
      ],
    },
    { type: 'quote', style: 'epigraph', text: 'You can build a bridge over a river. You cannot make it agree to be crossed.', author: 'Nell, the ferrywoman', source: 'Act One' },
    {
      type: 'text',
      text: 'Ottilie Marsh’s new play is set in the summer of 1904, as the [[city/swing-bridge|Swing Bridge]] is about to open and put a family of ferry-keepers out of work. It is a comedy for most of its length, a quiet tragedy for some of it, and in its last ten minutes something else entirely.\n\n' +
        '## The story\nNell runs the Old Quay ferry with her two sons. The bridge will make them unnecessary; the council has offered her a job as a toll-keeper on the very bridge that ruins her. The play follows the three of them through the last weeks of the crossing, as passengers - a drunk alderman, an engineer who cannot swim, a girl running away to sea - come and go.\n\n' +
        '## The production\nKasimir Doole’s staging uses the old foundry’s pit as the river: actors row across a floor of black water, and the bridge is built, piece by piece, above the audience’s heads. The design is the star. The second act sags a little in the middle, where a subplot about a lost wedding ring outstays its welcome.\n\n' +
        '## Verdict\nGo for the ending, in which the river - lit from below in the blue of the [[science/estuary-glow|estuary glow]] - seems to answer Nell back. Anyone following the argument over the [[opinion/keep-the-ferry|future of the Quay ferry]] will find the play has been there before them.',
    },
    { type: 'seealso', items: [{ link: 'culture/lantern-festival', label: 'In pictures: the Lantern Festival' }, { link: 'city/swing-bridge', label: 'Swing Bridge repairs: the story so far' }] },
    NAVBOX,
  ],
};

const estuaryCup = {
  slug: 'sport/estuary-cup', parent: 'sport', title: 'Saltmarsh Rowing Club wins the Estuary Cup by a canvas', date: '2026-10-11', author: by('Tobiah Fennimore', 'Sport'),
  cats: ['sport'], image: 'rowing',
  summary: 'After 4.2 kilometres from Gullwing Island, Saltmarsh beat the holders Northbank by the length of a bow canvas.',
  blocks: [
    {
      type: 'infobox', title: 'Estuary Cup 2026', image: 'rowing', caption: 'The last hundred metres.', color: '#2a9d8f',
      rows: [
        { label: 'Date', value: '10 October 2026' },
        { label: 'Course', value: '4.2 km, Gullwing Island to Old Quay' },
        { label: 'Boats', value: 'Eights (eight rowers and a cox)' },
        { label: 'Winner', value: 'Saltmarsh Rowing Club' },
        { label: 'Margin', value: 'A {{tip|canvas|The covered section at the bow of a racing boat - a margin of a few feet}}' },
        { label: 'Winning time', value: '13:07' },
      ],
    },
    {
      type: 'text',
      text: '**Saltmarsh Rowing Club** won the 71st Estuary Cup on Saturday by the smallest margin in rowing - a canvas - after a final sprint past the ferry pier that had the crowd on [[map#Old Quay|Old Quay]] on its feet.\n\n' +
        '## How the race was won\nThe holders, Northbank, led from the start at [[map#Gullwing Island|Gullwing Island]] and were a length up at halfway. Saltmarsh, rowing a lower rate into the headwind, waited. With the race moved downstream of the closed [[city/swing-bridge|Swing Bridge]] for the first time, the finish came sooner than either crew was used to - and the Saltmarsh cox called the sprint early.\n\n' +
        '## Results',
    },
    {
      type: 'table', caption: 'Estuary Cup 2026, final order', head: 'row', sortable: true, striped: true,
      rows: [['Place', 'Crew', 'Time', 'Margin'], ['1', 'Saltmarsh RC', '13:07', '-'], ['2', 'Northbank RC', '13:08', 'canvas'], ['3', 'Lanternhill Boat Club', '13:21', '4 lengths'], ['4', 'University of Port Velling BC', '13:30', '3 lengths'], ['5', 'Brassworks Rowing Club', '13:44', '5 lengths']],
    },
    { type: 'quote', style: 'block', text: 'I called it two hundred metres early and then spent the longest minute of my life wondering if I had got it wrong.', author: 'Saltmarsh cox', source: 'after the race' },
    { type: 'text', text: '## What’s next\nThe junior sculls series starts on Saturday at the Saltmarsh boathouse - see the [[sport|Sport]] fixtures. The rowing clubs will also carry lanterns again at next year’s [[culture/lantern-festival|Lantern Festival]].' },
    NAVBOX,
  ],
};

const keepFerry = {
  slug: 'opinion/keep-the-ferry', parent: 'opinion', title: 'Keep the ferry running after the bridge reopens', date: '2026-10-10', author: by('Maud Kestering', 'Columnist'),
  cats: ['opinion'], image: 'ferry',
  summary: 'The Swing Bridge closure has turned the Quay ferry into the busiest crossing in the city. When the bridge reopens, the council should keep it.',
  blocks: [
    { type: 'callout', kind: 'note', title: 'Opinion', text: 'This column reflects the writer’s view, not the Courier’s. Our news report on the closure is [[city/swing-bridge|Swing Bridge repairs: the story so far]]. See our [[about#Editorial standards|editorial standards]].' },
    { type: 'media', media: 'ferry', align: 'right', width: 360, caption: 'The Quay ferry, now every ten minutes.' },
    {
      type: 'text',
      text: 'Six weeks ago the Quay ferry was a curiosity: a little boat that ran every half hour for tourists and the occasional cyclist. Since the [[city/swing-bridge|Swing Bridge]] closed, it has carried more people across the river than any year in its history. The council plans to cut it back to the old timetable in March. It should not.\n\n' +
        '## The numbers\nThe Harbour Authority’s own counts make the case better than I can.{{ref|{{cite|author=Port Velling Harbour Authority|title=Quay ferry passenger counts, monthly|year=2026|publisher=PVHA}}}}',
    },
    {
      type: 'table', caption: 'Quay ferry passengers per average weekday', head: 'row', compact: true,
      rows: [['Month', 'Passengers'], ['July 2026', '640'], ['August 2026', '710'], ['September 2026', '4,980']],
    },
    { type: 'quote', style: 'pull', text: 'A bridge is a promise that the two halves of a city will keep meeting. A ferry is the proof that they want to.' },
    {
      type: 'text',
      text: '## The objections\nThe ferry costs money: around LC 190,000 extra until March, according to the [[city/swing-bridge|council’s estimate]]. But that is a small fraction of the repair bill, and a frequent ferry would take pressure off the bridge for the next hundred years. It also does something a bridge cannot: it lands at the Northbank tram stop, where the new [[city/night-tram|night tram]] waits.\n\n' +
        '## What I am asking for\nKeep a 15-minute ferry all year. Review it in a year. If nobody uses it, cut it. I would bet my bus pass they will.\n\n' +
        'If you agree - or think I have got it badly wrong - write to the letters desk; see the [[opinion|Opinion]] page.',
    },
    { type: 'references' },
    NAVBOX,
  ],
};

const mapItems = [
  ...Object.entries(DISTRICTS).map(([id, d]) => ({ id, shape: 'poly', pts: d.pts, label: d.label, link: `map#${d.label}`, color: '#1f2a44' })),
  { id: 'bridge', shape: 'point', x: 52, y: 49.5, lx: 60, ly: 33, label: 'Swing Bridge (closed)', link: 'city/swing-bridge', note: 'Closed since 2 September', color: '#c4553b' },
  { id: 'ferry', shape: 'point', x: 42, y: 49, lx: 30, ly: 46, label: 'Quay ferry', link: 'opinion/keep-the-ferry', color: '#c4553b' },
  { id: 'gauge', shape: 'point', x: 56, y: 57.5, lx: 66, ly: 63, label: 'Tide gauge', link: 'science/tide-gauge', color: '#c4553b' },
  { id: 'tram', shape: 'point', x: 84, y: 14, lx: 72, ly: 5, label: 'Night tram terminus', link: 'city/night-tram', color: '#c4553b' },
  { id: 'theatre', shape: 'point', x: 72, y: 80, lx: 86, ly: 88, label: 'Brassworks Theatre', link: 'culture/river-play', color: '#c4553b' },
  { id: 'rowing', shape: 'point', x: 30, y: 78, lx: 14, ly: 86, label: 'Saltmarsh Rowing Club', link: 'sport/estuary-cup', color: '#c4553b' },
  { id: 'festival', shape: 'point', x: 38, y: 36, lx: 24, ly: 30, label: 'Lantern Festival route', link: 'culture/lantern-festival', color: '#c4553b' },
  { id: 'glow', shape: 'point', x: 85, y: 44, lx: 92, ly: 58, label: 'Best glow viewing', link: 'science/estuary-glow', color: '#c4553b' },
  { id: 'office', shape: 'point', x: 50, y: 72, lx: 54, ly: 88, label: 'Courier office', link: 'about', color: '#c4553b' },
];

const cityMap = {
  slug: 'map', title: 'Map of Port Velling', cats: ['city'], image: 'citymap', layout: 'wide',
  summary: 'An interactive map of Port Velling’s six districts and the places in this week’s stories.',
  blocks: [
    { type: 'text', text: 'Port Velling grew up on both banks of the **Gannet Estuary**, where the river widens into a sheltered bay. Hover over a district or a red marker for a preview and click to read on. The district guides below say what each part of the city is known for and which stories we have reported there.' },
    { type: 'diagram', media: 'citymap', labels: 'always', align: 'full', caption: 'Port Velling: districts (outlined) and places in the news (red markers). Map: Courier graphics desk.', items: mapItems },
    {
      type: 'infobox', title: 'Port Velling at a glance', image: 'skyline', caption: 'The city from the estuary at dusk.',
      rows: [
        { label: 'River', value: 'Gannet (estuary)' },
        { label: 'Districts', value: '6' },
        { label: 'Population', value: 'about 212,000' },
        { label: 'River crossings', value: 'Swing Bridge (closed), Quay ferry, Upstream Bridge' },
        { label: 'Trams', value: '3 lines' },
      ],
    },
    {
      type: 'text',
      text: '## Old Quay\nThe old harbour and the city’s oldest streets, on the south bank. Home to the [[science/tide-gauge|tide gauge]], the ferry pier, the [[culture/lantern-festival|Lantern Festival]] and the Courier office on Ropewalk Street.\n\n' +
        '## Northbank\nOffices, the market and Northbank Common, joined to Old Quay by the [[city/swing-bridge|Swing Bridge]] - currently closed - and the [[opinion/keep-the-ferry|Quay ferry]].\n\n' +
        '## Lanternhill\nSteep streets of terraced houses climbing to the infirmary and the summit, served by tram line 3 and its restored [[city/night-tram|night service]].\n\n' +
        '## Brassworks\nThe old foundry district. The Brassworks Foundry Co-operative is casting the bridge’s new bearing, and the biggest foundry hall is now the [[culture/river-play|Brassworks Theatre]].\n\n' +
        '## Saltmarsh\nReed beds, boathouses and a shingle beach - the best place to see the [[science/estuary-glow|estuary glow]] and home of the [[sport/estuary-cup|Estuary Cup]] winners.\n\n' +
        '## Gullwing Island\nA small island in the bay with a lighthouse, a volunteer observatory and the start line of the Estuary Cup.\n\n' +
        '## The estuary\nThe Gannet is tidal all the way through the city. Its tides are measured at Old Quay; on late-summer nights, its plankton glow.',
    },
    NAVBOX,
  ],
};

const about = {
  slug: 'about', title: 'About the Courier', cats: ['the-courier'], image: 'press',
  summary: 'Who we are, who writes for us, the standards we hold ourselves to - and how embargoes and 451 pages work on this site.',
  blocks: [
    { type: 'media', media: 'press', align: 'right', width: 360, caption: 'The Courier was printed on Ropewalk Street until 1998.' },
    {
      type: 'text',
      text: '**The Port Velling Courier** has reported on the city since 1871, when it began as a one-sheet list of ships arriving at [[map#Old Quay|Old Quay]]. It is owned by a reader trust and has no other owner, shareholder or political party behind it. Our office is still on Ropewalk Street - you can find it on the [[map|city map]].\n\n' +
        '## Newsroom',
    },
    {
      type: 'table', head: 'row', striped: true,
      rows: [
        ['Name', 'Role', 'Writes about'],
        ['Marguerite Ollenshaw', 'Editor', 'Editorials, [[front-page|the front page]]'],
        ['Ines Tallowby', 'City Desk', '[[city/swing-bridge|the bridge]], [[city/night-tram|transport]], the council'],
        ['Rook Asquemore', 'Science Editor', '[[science/estuary-glow|the estuary]], [[science/tide-gauge|tides]], weather'],
        ['Dara Pellinore', 'Theatre Critic', '[[culture/river-play|theatre]], music, books'],
        ['Tobiah Fennimore', 'Sport', '[[sport/estuary-cup|rowing]], football, running'],
        ['Maud Kestering', 'Columnist', '[[opinion/keep-the-ferry|opinion]]'],
        ['Olu Fenwright', 'Pictures Editor', '[[culture/lantern-festival|pictures]] and every illustration on this site'],
        ['Saul Brackenridge', 'Readers’ Editor', '[[corrections|corrections]] and complaints'],
      ],
    },
    {
      type: 'text',
      text: '## Editorial standards\n- **Accuracy first.** We check facts against documents and named sources before we publish, and say so when we cannot.\n- **Opinion is labelled.** Columns carry the writer’s name and an *Opinion* label; news reports do not take sides. See the [[opinion|Opinion]] section.\n- **Sources.** We name sources wherever we can. When we cannot, we say why, and at least two editors know who they are.\n- **Corrections.** When we get something wrong we fix it, say what changed and list it on the [[corrections|corrections page]].\n- **Independence.** No advertiser, owner or official sees a story before it is published.\n- **Explaining clearly.** Our explainers come in two versions - try the switch on [[science/estuary-glow|Why does the estuary glow?]]\n\n' +
        '## How to read this site\n- **Hover previews:** point at any link to see the start of the page it leads to.\n- **Versions:** some stories offer a *Full story* and an *In plain words* version, chosen under the headline.\n- **Fact-check notes:** turn on the *Fact-check notes* layer under a headline to see how we verified a story - the [[city/swing-bridge|bridge story]] has plenty.\n- **From the archive:** short notes from old editions, shown with the *From the archive* layer.\n\n' +
        '## Embargoes and the 451 page\nNews organisations sometimes receive stories under **embargo**: they may prepare them but must not publish before a set time. This site shows how that works with a **451 page** - a page that answers “not found” until you have the password, and is encrypted in the published site, not merely hidden.',
    },
    { type: 'media', media: 'stamp', align: 'center', width: 420, caption: 'Embargoed copy waits behind a password until its time comes.' },
    {
      type: 'callout', kind: 'tip', title: 'Try it',
      text: 'Our embargoed story about [[city/gullwing-lease|the future of Gullwing Island]] is a 451 page. Open it with `#?451=embargo451` appended to the address, or enter the password `embargo451` on the [[special:unlock|unlock page]]. Without the password, the address answers with an ordinary “page not found”.',
    },
    NAVBOX,
  ],
};

const corrections = {
  slug: 'corrections', parent: 'about', title: 'Corrections and clarifications', cats: ['the-courier'],
  summary: 'Every correction and clarification we have published, newest first, with what changed and why.',
  blocks: [
    {
      type: 'text',
      text: 'We correct mistakes openly. When a story changes after publication, we add a note to the story and list it here. To report an error, write to the Readers’ Editor, Saul Brackenridge, at the Courier office - see [[about#Newsroom|the newsroom]] and our [[about#Editorial standards|editorial standards]].',
    },
    {
      type: 'table', caption: 'Corrections, October 2026', head: 'row', striped: true, sortable: true,
      rows: [
        ['Date', 'Story', 'What was wrong', 'Now reads'],
        ['2026-10-12', '[[city/swing-bridge|Swing Bridge repairs]]', 'Swing span given as 46 m', '64 m'],
        ['2026-10-06', '[[science/estuary-glow|Why does the estuary glow?]]', 'Said each flash lasts about a second', 'About a tenth of a second'],
        ['2026-10-05', '[[culture/lantern-festival|Lantern Festival in pictures]]', 'Giant fish lantern credited to the Brassworks workshop', 'Made by Saltmarsh Primary School (clarification)'],
        ['2026-09-29', '[[science/tide-gauge|The tide gauge at 150]]', 'Gauge built in 1867', 'Built in 1876'],
      ],
    },
    { type: 'details', summary: 'What is the difference between a correction and a clarification?', text: 'A **correction** fixes a fact that was wrong. A **clarification** adds or rewords something that was accurate but could mislead. Both are listed here.' },
    NAVBOX,
  ],
};

// The 451 page: an embargoed story, a 404 for everyone without the password.
const gullwingLease = {
  slug: 'city/gullwing-lease', parent: 'city', title: 'Harbour Authority plans to lease Gullwing lighthouse for a hotel', date: '2026-10-15', author: by('Ines Tallowby', 'City Desk'),
  cats: ['city'], image: 'stamp',
  summary: 'Board papers seen by the Courier propose a 35-year lease of the Gullwing Island lighthouse and observatory, with the rent paying for the Swing Bridge repair.',
  secret: { password: 'embargo451', note: 'Embargoed story: demo password embargo451' },
  blocks: [
    { type: 'callout', kind: 'warning', title: 'Embargoed', text: 'Not for publication before **06:00 on Thursday 15 October 2026**. This copy is visible only with the embargo password; see [[about#Embargoes and the 451 page|how embargoes work]].' },
    { type: 'media', media: 'stamp', align: 'right', width: 320, caption: 'Embargoed copy.' },
    {
      type: 'text',
      text: 'The Port Velling Harbour Authority plans to lease the lighthouse and old observatory on [[map#Gullwing Island|Gullwing Island]] to a hotel company for 35 years, according to board papers seen by the Courier.{{ref|{{cite|author=Port Velling Harbour Authority|title=Board paper 26/41: Gullwing Island buildings, options for lease|year=2026|publisher=PVHA (unpublished)}}}}\n\n' +
        'The rent - LC 80,000 a year, rising with inflation - would be set against the cost of the [[city/swing-bridge|Swing Bridge]] repair, the papers say. The volunteer observatory, which opens its telescope to the public on clear Friday nights, would have to move.\n\n' +
        '## What the papers propose',
    },
    {
      type: 'table', head: 'row', striped: true,
      rows: [['Term', 'Proposal'], ['Length of lease', '35 years'], ['Rent', 'LC 80,000 a year'], ['Buildings', 'Lighthouse keeper’s cottages, observatory, jetty'], ['Lighthouse lamp', 'Stays under Harbour Authority control'], ['Public access', '“To be agreed”']],
    },
    {
      type: 'text',
      text: 'The board meets on 22 October. The observatory’s volunteers, who learned of the plan from the Courier, said they would ask the board to guarantee public nights in any lease.\n\nThe same papers suggest a direct boat from Old Quay to the island - which would give the argument for [[opinion/keep-the-ferry|keeping the Quay ferry]] a new twist.',
    },
    { type: 'references' },
  ],
};

// Structure (data module, commented at header level only): helpers above build markup strings and SVG artwork
// (generated in code rather than shipped as files: zero binary assets, deterministic, diffable); the default export
// is the template descriptor { id, icon, name, desc, spec({ lang }) } consumed by wiki-templates.js, whose spec() returns
// a kit spec (wiki-kit.js) - pages by slug, blocks as plain objects, media from SVG text, secret pages/variants with
// their demo passwords. buildKB normalises everything, so content here need not be perfectly shaped.
// prng is the Park-Miller minimal standard generator (seed * 16807 mod 2^31-1): seeded, so decorative scatter (stars,
// waves) is identical on every build and in snapshot tests, which Math.random would not be.
export default {
  id: 'news',
  icon: 'newspaper',
  name: { en: 'News outlet', ru: 'Новостное издание', uk: 'Новинне видання', de: 'Nachrichtenportal', fr: 'Média d’information', es: 'Medio de noticias', ka: 'საინფორმაციო გამოცემა' },
  desc: {
    en: 'A fictional city newspaper: front page, sections, dated stories, an explainer, a running story, a gallery and an interactive map.',
    ru: 'Вымышленная городская газета: первая полоса, рубрики, датированные статьи, объяснение, хроника, галерея и интерактивная карта.',
    uk: 'Вигадана міська газета: перша шпальта, рубрики, датовані статті, пояснення, хроніка, галерея та інтерактивна мапа.',
    de: 'Eine fiktive Stadtzeitung: Titelseite, Ressorts, datierte Artikel, Erklärstück, laufende Geschichte, Galerie und interaktiver Stadtplan.',
    fr: 'Un journal municipal fictif : une, rubriques, articles datés, décryptage, suivi en continu, galerie et plan interactif.',
    es: 'Un periódico ficticio de una ciudad: portada, secciones, noticias fechadas, explicador, tema en curso, galería y mapa interactivo.',
    ka: 'გამოგონილი ქალაქის გაზეთი: პირველი გვერდი, რუბრიკები, დათარიღებული სტატიები, განმარტება, ქრონიკა, გალერეა და ინტერაქტიური რუკა.',
  },
  spec() {
    return {
      title: 'The Port Velling Courier',
      tagline: 'Independent news from the Gannet Estuary since 1871',
      lang: 'en', uiLang: 'en', theme: 'magazine', accent: '#c8402f', logo: 'logo', home: 'front-page',
      nav: [
        { label: 'Front page', link: 'front-page' }, { label: 'City', link: 'city' }, { label: 'Science', link: 'science' }, { label: 'Culture', link: 'culture' },
        { label: 'Sport', link: 'sport' }, { label: 'Opinion', link: 'opinion' }, { label: 'Map', link: 'map' }, { label: 'About', link: 'about' },
      ],
      footer: '**The Port Velling Courier** is a fictional newspaper of a fictional city, made as a template. Its people, places, documents and events are invented; any resemblance to real ones is coincidental.\n\n[[about|About us]] · [[about#Editorial standards|Editorial standards]] · [[corrections|Corrections]] · [[map|City map]]',
      license: 'Text and illustrations of this template may be reused and adapted freely.',
      layers: [
        { id: 'factcheck', label: 'Fact-check notes', on: false },
        { id: 'archive', label: 'From the archive', on: true },
      ],
      cats: [
        { slug: 'city', name: 'City', desc: 'News from the council chamber, the harbour, transport and every district of Port Velling. Section front: [[city]].' },
        { slug: 'science', name: 'Science', desc: 'The estuary, the tides and the weather, explained. Section front: [[science]].' },
        { slug: 'culture', name: 'Culture', desc: 'Theatre, festivals, music and pictures. Section front: [[culture]].' },
        { slug: 'sport', name: 'Sport', desc: 'Rowing, football and running on and around the estuary. Section front: [[sport]].' },
        { slug: 'opinion', name: 'Opinion', desc: 'Columns and letters. The views are the writers’ own. Section front: [[opinion]].' },
        { slug: 'explainers', name: 'Explainers', desc: 'Pieces that answer one question clearly, often in two versions: the full story and plain words.' },
        { slug: 'running-stories', name: 'Running stories', desc: 'Stories we keep updating as events unfold, each with a timeline.' },
        { slug: 'pictures', name: 'Pictures', desc: 'Galleries by the Courier’s pictures desk.' },
        { slug: 'sections', name: 'Sections', desc: 'The section fronts of the Courier: City, Science, Culture, Sport and Opinion.' },
        { slug: 'the-courier', name: 'About the Courier', desc: 'Who we are, our standards and our corrections.' },
      ],
      media,
      pages: [frontPage, ...sections, swingBridge, nightTram, estuaryGlow, tideGauge, lanternFestival, riverPlay, estuaryCup, keepFerry, cityMap, about, corrections, gullwingLease],
    };
  },
};
