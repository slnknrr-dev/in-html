// book/sample.js - a small original sample book that uses every construct of the model (parts and chapters, an
// epigraph, a poem, a citation, a table, a list, code, footnotes, named styles, an illustration and a cover drawn
// pixel by pixel), for tests and for trying the reader. The story was written for this repository.
//
//   sampleBook() -> book (deterministic)

import { encodePNG } from '../png/encode.js';
import { normalizeBook } from './model.js';

//
// Why a generated sample instead of a bundled file: images are drawn procedurally and PNG-encoded at call time, so
// the repo holds no binary assets and the book is identical on every run (fixed ids, fixed dates, no randomness).
// Tests rely on that determinism, and on the sample touching every block and inline type of book/model.js, so a
// converter that drops a construct fails a round-trip test immediately.
const p = (...c) => ({ type: 'p', c });
const em = (...c) => ({ t: 'em', c });
const strong = (...c) => ({ t: 'strong', c });
const note = (ref, label) => ({ t: 'note', ref, c: [label] });

// A lighthouse at dusk: sky gradient, sea, tower, light beam.
// Per-pixel procedural painting into RGBA (Uint8ClampedArray clamps out-of-range colour math to 0..255 for free).
// Layers are applied in painter's order: sky/sea gradient, tower stripes, lantern, then the beam blended on top.
function picture(w, h, { beam = true } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  const horizon = Math.round(h * 0.68);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r, g, b;
      if (y < horizon) {
        const t = y / horizon;
        r = 40 + 190 * t; g = 50 + 110 * t; b = 110 + 40 * t;
      } else {
        const t = (y - horizon) / (h - horizon);
        const wave = Math.sin(x * 0.18 + y * 0.9) * 10;
        r = 30 + 20 * t + wave; g = 70 + 30 * t + wave; b = 110 + 20 * t + wave;
      }
      // Tower: a tapering column with stripes.
      const cx = w * 0.62, top = h * 0.22, base = horizon + 4;
      if (y > top && y < base) {
        const half = (w * 0.035) + (w * 0.03) * (y - top) / (base - top);
        if (Math.abs(x - cx) < half) {
          const stripe = Math.floor((y - top) / ((base - top) / 6)) % 2;
          r = stripe ? 200 : 235; g = stripe ? 60 : 232; b = stripe ? 50 : 220;
        }
      }
      // Lantern and beam.
      const ly = top - h * 0.04;
      if (Math.abs(y - ly) < h * 0.04 && Math.abs(x - cx) < w * 0.05) { r = 255; g = 236; b = 150; }
      if (beam && x < cx && Math.abs((y - ly) - (x - cx) * 0.18) < (cx - x) * 0.12) { r = (r + 255 * 1.4) / 2.4; g = (g + 240 * 1.4) / 2.4; b = (b + 170 * 1.4) / 2.4; }
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return encodePNG({ width: w, height: h, data }, { level: 6 });
}

// The raw object is passed through normalizeBook like any imported file, so the sample also exercises the trust
// boundary rather than bypassing it.
export function sampleBook() {
  const book = {
    meta: {
      title: 'The Clockmaker of Saltmarsh', subtitle: 'A short tale in two parts',
      authors: [{ first: 'Ada', middle: '', last: 'Wren', nick: '' }], translators: [],
      lang: 'en', series: [{ name: 'Saltmarsh Tales', number: '1' }], genres: ['prose_contemporary'], subjects: ['Sea', 'Clocks'],
      annotation: [p('In a village where the tide keeps better time than any church bell, an old clockmaker receives a letter that was posted thirty years ago.'), p('A sample book for the reader and the writer: every kind of content the format knows appears at least once.')],
      keywords: 'sea, clocks, letters, lighthouse', date: '2026', publisher: 'In-HTML Sample Press', city: 'Saltmarsh', year: '2026',
      ids: [{ scheme: 'uuid', value: '6f0c5d2e-8a41-4c7b-9e3a-1b2c3d4e5f60' }], rights: 'Written for this repository; free to use.',
      cover: 'cover.png', created: '2026-10-13T00:00:00.000Z', modified: '2026-10-13T00:00:00.000Z',
    },
    styles: [
      { id: 'letter', name: 'Letter', kind: 'block', props: { italic: true, indent: 'block', spaceBefore: '0.5' } },
      { id: 'signature', name: 'Signature', kind: 'block', props: { align: 'right', indent: 'none', smallCaps: true } },
      { id: 'smallcaps', name: 'Small caps', kind: 'inline', props: { smallCaps: true } },
    ],
    images: {
      'cover.png': { type: 'image/png', data: picture(160, 240), name: 'cover.png' },
      'lighthouse.png': { type: 'image/png', data: picture(240, 150, { beam: false }), name: 'lighthouse.png' },
    },
    front: [{ type: 'epigraph', blocks: [p('The sea forgets nothing; it only takes its time remembering.')], authors: [['A Saltmarsh saying']] }],
    sections: [
      {
        id: 'part-1', title: [['Part One'], ['The Tide Clock']], blocks: [], sections: [
          {
            id: 'ch-1', title: [['Chapter 1'], ['A Clock That Ran Backwards']], sections: [], blocks: [
              p({ t: 'style', name: 'smallcaps', c: ['Every morning'] }, ' at a quarter past six, Elias Marrow unlocked the green door of his shop on Harbour Lane and wound the forty clocks that lived there. He did it in the same order each day: the tall case clock by the window first, the brass carriage clocks on the shelf next, and last of all the small tin alarm clock that nobody had ever wanted to buy.'),
              p('The village of Saltmarsh did not need forty clocks. It had the tide', note('n1', '1'), ', which came and went with a punctuality that put the church bell to shame, and it had the lighthouse, whose lamp was lit at dusk by a keeper who had not missed a single evening in twenty-two years.'),
              p('So Elias repaired more than he sold. Fishermen brought him pocket watches swollen with sea water; children brought him clockwork mice with broken springs. He fixed them all, slowly and ', em('without ever promising a day'), ', because he believed that a promise about time was the one kind of promise a clockmaker should never make.'),
              p('On the morning this story begins, the tin alarm clock was running backwards.'),
              { type: 'hr' },
              p('It was not broken. Elias opened its back, held it to the window and watched the escapement tick as neatly as ever. The wheels turned the right way. Only the hands moved the wrong way round, sliding from seven to six to five with an air of calm determination.'),
              p('“Well,” he said to it, “', strong('that'), ' is new.”'),
              p('Then the bell above the door rang, and the postman came in out of the wind with a letter in his hand and an apology on his face.'),
            ],
          },
          {
            id: 'ch-2', title: [['Chapter 2'], ['A Letter from the Sea']], sections: [], blocks: [
              { type: 'epigraph', blocks: [p('Write it down, and the sea will deliver it. Eventually.')], authors: [['Margin note in a harbour log']] },
              p('“Found it behind the sorting cabinet,” the postman said. “They moved the cabinet for the first time since the flood. The stamp says it was posted in nineteen ninety-six.”'),
              p('The envelope was the colour of weak tea. The handwriting on it was small and slanted and very familiar, although Elias needed a long moment to admit to himself whose it was.'),
              p('He did not open it at once. He made tea, he wound the tall case clock a second time without noticing, and he looked at the tide table pinned beside the counter as if it could tell him what to do.'),
              { type: 'table', id: 'tides', rows: [
                { cells: [{ c: ['Day'], header: true }, { c: ['High water'], header: true }, { c: ['Low water'], header: true }] },
                { cells: [{ c: ['Monday'] }, { c: ['06:12'], align: 'center' }, { c: ['12:31'], align: 'center' }] },
                { cells: [{ c: ['Tuesday'] }, { c: ['06:58'], align: 'center' }, { c: ['13:15'], align: 'center' }] },
                { cells: [{ c: ['Wednesday'] }, { c: ['07:41'], align: 'center' }, { c: ['14:02'], align: 'center' }] },
              ] },
              p('At last he slit the envelope with the small brass knife he used for clock springs.'),
              { type: 'cite', blocks: [
                { type: 'p', style: 'letter', c: ['Dear Elias,'] },
                { type: 'p', style: 'letter', c: ['If this reaches you, the clock I left on your shelf will already have started to run the other way. Do not fix it. It is not counting down; it is counting back, to the evening we argued on the breakwater. When it arrives there, go to the lighthouse.'] },
                { type: 'p', style: 'signature', c: ['Your sister, Maren'] },
              ], authors: [] },
              p('Elias read the letter three times. Then he looked at the tin clock, which had reached a quarter to five and showed no sign of stopping, and he understood that he had been given a deadline after all', note('n2', '2'), '.'),
            ],
          },
        ],
      },
      {
        id: 'part-2', title: [['Part Two'], ['The Lighthouse']], blocks: [], sections: [
          {
            id: 'ch-3', title: [['Chapter 3'], ['The Keeper’s Song']], sections: [], blocks: [
              p('The keeper, a broad and cheerful woman named Ottilie Shore, let him in without asking why he had come. People who climbed to the lamp room usually had a reason they could not explain, she said, and it was rude to make them try.'),
              { type: 'image', id: 'fig-lighthouse', src: 'lighthouse.png', alt: 'The Saltmarsh lighthouse at dusk', title: ['The Saltmarsh light, as Maren drew it'] },
              p('While she trimmed the wick she sang under her breath, a song every child in Saltmarsh learned before they could read:'),
              { type: 'poem', id: 'tide-song', title: [['Song of the Tide']], epigraphs: [], stanzas: [
                { title: null, subtitle: [], lines: [['The tide goes out to fetch the moon,'], ['the tide comes in to bring it,'], ['and every clock along the dune'], ['is only learning how to sing it.']] },
                { title: null, subtitle: [], lines: [['So wind your watch and wait your turn,'], ['the sea is never early;'], ['what leaves the harbour will return'], ['— if late, then all the surely.']] },
              ], authors: [['Traditional, Saltmarsh']], date: '' },
              p('“Your sister sang it wrong,” Ottilie said suddenly. “Always the last line. ', em('If late, then all the surely'), '. Nobody else says it like that.”'),
              p('Elias went very still. On the windowsill, among the spare lamp chimneys, sat a second tin alarm clock — the twin of his own. Its hands pointed at seven, and they were moving forwards.'),
              p('Taped to its back was a key, and a list in the same small, slanted hand:'),
              { type: 'list', ordered: true, items: [[p('Wind the clock in the shop until the hands meet.')], [p('Bring this one down to the breakwater.')], [p('Say you are sorry first. I will, too.')]] },
              p('He laughed then, for the first time in a long while, because it was exactly like Maren to leave instructions for an apology', note('n3', '3'), '.'),
            ],
          },
        ],
      },
      {
        id: 'afterword', title: [['Afterword']], sections: [], blocks: [
          p('This sample book exists so that the reader and the writer of this application have something to show. It also contains a little code, because books about clocks should explain how clocks are wound:'),
          { type: 'code', text: 'for (const clock of shop.clocks) {\n  clock.wind(clock.turnsNeeded());\n}' },
          p('The chemistry of brass is CuZn', { t: 'sub', c: ['x'] }, ', more or less; the tide repeats every 12', { t: 'sup', c: ['h'] }, ' 25', { t: 'sup', c: ['m'] }, '. Read more about the ', { t: 'a', href: '#tides', c: ['tide table'] }, ' or return to ', { t: 'a', href: '#ch-1', c: ['the first chapter'] }, '.'),
          p({ t: 'strike', c: ['The end.'] }, ' Not quite the end: the clocks are still running.'),
        ],
      },
    ],
    notes: [
      { id: 'n1', kind: 'note', label: ['1'], blocks: [p('High water at Saltmarsh comes about fifty minutes later each day, following the moon.')] },
      { id: 'n2', kind: 'note', label: ['2'], blocks: [p('Elias kept a ledger of every promise he had ever refused to make. This would have been the first entry on the other side of the page.')] },
      { id: 'n3', kind: 'note', label: ['3'], blocks: [p('Maren’s lists always had an odd number of items. She said even numbers were for people who liked to stop.')] },
    ],
  };
  return normalizeBook(book);
}
