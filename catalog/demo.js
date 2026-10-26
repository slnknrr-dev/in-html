// catalog/demo.js - demo content for a fresh start that needs no copyrighted media: short pieces synthesized here as
// WAV files (wav/wav.js) that really play (presence 'file', bytes in the blob store), public-domain works as nominal
// entries (a symphony known by its movements, a song known by its lyrics, a book known by its chapters, a silent film),
// a source-level entry, an anime known from a list with tracking, playlists (manual, smart, mood), a workspace and tag
// definitions — so every kind and every presence level shows something.
//
//   buildDemo({ sampleRate = 22050, seconds = 8, now }) -> { nodes, blobs: [{ id, type, bytes }] }
//   synthesize(spec, sampleRate) -> Float32Array     spec: { notes: [[midi | null, beats]], bpm, wave, chord, drum }
//   DEMO_TAG = 'demo'                                every demo node carries it (the app can remove the demo)
//
// Why synthesize instead of shipping samples: the app is a single offline HTML file, so any bundled audio would
// bloat it and raise licensing questions. A few seconds of additive synthesis are generated on demand in
// milliseconds and are original by construction. Low sample rate (22 050 Hz) and mono keep the blobs small;
// the content is test tones, not hi-fi.
// Determinism: timestamps derive from the `now` argument plus a tick, so ordering by `added` is stable and tests
// can pass a fixed now. Ids are random (uid), so the demo can be loaded alongside existing data without clashes.

import { encodeWav } from '../wav/wav.js';
import { uid } from './model.js';

export const DEMO_TAG = 'demo';

// Equal temperament, MIDI 69 = A4 = 440 Hz.
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Additive synthesis into a float buffer, mixed by summation, then normalised to a 0.8 peak (headroom against
// inter-sample clipping after 16-bit conversion; normalising after mixing avoids hand-tuning gains per voice).
// Envelope per note: 10 ms linear attack (no click at onset), exponential decay (fast for plucked tones, slow for
// pads), 20 ms linear release (no click at the cut). Notes are held 10 % past their slot (d * 1.1) for legato.
// Waves: 'soft' = fundamental + two weak harmonics, 'square' = sign(sin) at reduced gain (square waves are loud),
// 'pad' = slightly detuned octave (2.01: slow beating gives movement) + sub-octave. Drum = a downward pitch sweep
// with fast decay, the classic synthesized kick. The melody loops until `seconds` is filled; a rest is null.
export function synthesize({ notes = [], bpm = 100, wave = 'soft', chord = null, drum = false, seconds = 8 } = {}, sampleRate = 22050) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  const beat = 60 / bpm;
  let t = 0;
  const add = (hz, start, dur, gain, shape) => {
    const s0 = Math.floor(start * sampleRate), len = Math.floor(dur * sampleRate);
    for (let i = 0; i < len && s0 + i < n; i++) {
      const x = i / sampleRate;
      const env = Math.min(1, x / 0.01) * Math.exp(-x * (shape === 'pad' ? 0.6 : 3.2)) * Math.min(1, (len - i) / (0.02 * sampleRate));
      const ph = 2 * Math.PI * hz * x;
      const v = shape === 'square' ? Math.sign(Math.sin(ph)) * 0.35 : shape === 'pad' ? Math.sin(ph) * 0.6 + Math.sin(ph * 2.01) * 0.2 + Math.sin(ph * 0.5) * 0.2 : Math.sin(ph) + 0.3 * Math.sin(ph * 2) + 0.12 * Math.sin(ph * 3);
      out[s0 + i] += v * env * gain;
    }
  };
  while (t < seconds) {
    for (const [m, beats] of notes) {
      if (t >= seconds) break;
      const d = beats * beat;
      if (m !== null) add(midiHz(m), t, d * 1.1, 0.32, wave);
      t += d;
    }
    if (!notes.length) break;
  }
  if (chord) {
    const bar = 4 * beat;
    for (let b = 0, i = 0; b < seconds; b += bar, i++) for (const m of chord[i % chord.length]) add(midiHz(m), b, bar, 0.12, 'pad');
  }
  if (drum) {
    for (let b = 0; b < seconds; b += beat) {
      const s0 = Math.floor(b * sampleRate);
      for (let i = 0; i < 0.12 * sampleRate && s0 + i < n; i++) { const x = i / sampleRate; out[s0 + i] += Math.sin(2 * Math.PI * (120 - 400 * x) * x) * Math.exp(-x * 30) * 0.5; }
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? 0.8 / peak : 1;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

// Each piece is tagged and given energy / bpm so that the smart and mood presets (smart.js) have something to match.
// `bpm` drives synthesis, `bpm2` is the value stored on the work (kept separate so the spec spread into wav() does
// not leak a stored field name into synthesis options).
const PIECES = [
  { title: 'Morning Arpeggio', notes: [[60, 0.5], [64, 0.5], [67, 0.5], [72, 0.5], [67, 0.5], [64, 0.5]], bpm: 96, chord: [[48, 55, 64], [45, 52, 60], [41, 48, 57], [43, 50, 59]], tags: ['mood:calm', 'tod:morning', 'genre:ambient'], energy: 3, bpm2: 96 },
  { title: 'Pentatonic Walk', notes: [[62, 0.5], [64, 0.5], [67, 1], [69, 0.5], [72, 0.5], [69, 1], [67, 0.5], [64, 0.5], [62, 1]], bpm: 112, tags: ['mood:happy', 'genre:folk'], energy: 5, bpm2: 112 },
  { title: 'Square Dance Machine', notes: [[57, 0.25], [57, 0.25], [64, 0.5], [62, 0.25], [60, 0.25], [64, 0.5]], bpm: 128, wave: 'square', drum: true, tags: ['mood:energetic', 'activity:workout', 'genre:electronic/chiptune'], energy: 8, bpm2: 128 },
  { title: 'Evening Chorale', notes: [], bpm: 70, chord: [[48, 52, 55, 60], [53, 57, 60, 65], [55, 59, 62, 67], [48, 52, 55, 64]], tags: ['mood:calm', 'tod:evening', 'genre:classical/chorale'], energy: 2, bpm2: 70 },
];

// Returns plain nodes and blobs instead of writing to a db: the caller decides where they go (IndexedDB + blob
// store in the browser, files on the backend), and tests can inspect the output directly. Nodes bypass normNode
// because they are trusted, locally built data. The sections below cover, in order: file / source / nominal
// presence, every family (music, audiobook, movie, anime, podcast), tracking states, and every collection kind.
export function buildDemo({ sampleRate = 22050, seconds = 8, now = Date.now() } = {}) {
  const nodes = [];
  const blobs = [];
  let tick = 0;
  const T = () => now - 60000 + (tick++) * 10;
  // Every node gets DEMO_TAG (deduped via Set) so "remove demo" is a single tag query.
  const node = (fields) => { const t = T(); const n = { id: uid(), created: t, updated: t, tags: [], ...fields }; n.tags = [...new Set([DEMO_TAG, ...n.tags])]; nodes.push(n); return n; };
  const work = (fields) => node({ type: 'work', added: T(), ...fields });
  const media = (workId, fields) => node({ type: 'media', work: workId, ...fields });
  const wav = (spec) => {
    const samples = synthesize({ ...spec, seconds }, sampleRate);
    const bytes = encodeWav([samples], { sampleRate, bitDepth: 16, info: { title: spec.title, artist: spec.artist || 'In-HTML Ensemble', album: spec.album || '' } });
    const id = 'demo-' + uid();
    blobs.push({ id, type: 'audio/wav', bytes });
    return { id, size: bytes.length };
  };

  // Tag definitions: implications and aliases. Note: energy:low / energy:high are tags, distinct from the numeric
  // energy field; query.js routes energy:low to the tag because 'low' is not a number.
  node({ type: 'tagdef', name: 'mood:calm', aliases: ['mood:chill', 'mood:relaxed'], implies: ['energy:low'], color: '#5b8cff' });
  node({ type: 'tagdef', name: 'mood:energetic', aliases: ['mood:upbeat'], implies: ['energy:high'], color: '#ff6b5b' });
  node({ type: 'tagdef', name: 'genre:electronic/chiptune', implies: ['era:8-bit'] });
  node({ type: 'tagdef', name: 'activity:workout', aliases: ['activity:gym'] });

  // 1. A real album: synthesized WAV files (presence 'file'). The first track carries enhanced LRC (per-word
  //    <mm:ss.xx> stamps) to exercise karaoke-style lyrics rendering.
  const album = work({ kind: 'album', title: 'Tone Studies', year: 2026, domain: 'music', people: [{ name: 'In-HTML Ensemble', role: 'albumartist' }], tags: ['genre:ambient'], cover: { gen: { style: 'vinyl', seed: 'album:Tone Studies' } } });
  PIECES.forEach((p, i) => {
    const b = wav({ ...p, album: 'Tone Studies' });
    const w = work({ kind: 'track', title: p.title, parent: album.id, order: i + 1, domain: 'music', duration: seconds, energy: p.energy, bpm: p.bpm2, tags: p.tags,
      lyrics: i === 0 ? { lrc: `[ti:${p.title}]\n[00:00.00]Light comes over the hill\n[00:02.00]<00:02.00>the <00:02.40>day <00:02.80>begins\n[00:04.00]Hum along, the notes are near\n[00:06.00]and the morning is clear` } : undefined });
    media(w.id, { presence: 'file', loc: { kind: 'blob', blob: b.id }, name: `${String(i + 1).padStart(2, '0')} ${p.title}.wav`, size: b.size, duration: seconds, container: 'wav', mime: 'audio/wav', kind: 'audio', audio: { codec: 'pcm', sampleRate, channels: 1, bitsPerSample: 16 } });
  });

  // 2. A public-domain symphony known only by its movements (nominal), one movement known as a source link.
  const sym = work({ kind: 'album', title: 'Symphony No. 5 in C minor, Op. 67', year: 1808, domain: 'music', people: [{ name: 'Ludwig van Beethoven', role: 'composer' }, { name: 'Ludwig van Beethoven', role: 'albumartist' }], tags: ['genre:classical/symphony', 'era:classical'], description: 'Four movements; first performed in Vienna on 22 December 1808.' });
  ['Allegro con brio', 'Andante con moto', 'Scherzo. Allegro', 'Allegro'].forEach((t, i) => {
    const w = work({ kind: 'track', title: t, parent: sym.id, order: i + 1, domain: 'music', people: [{ name: 'Ludwig van Beethoven', role: 'composer' }] });
    if (i === 0) media(w.id, { presence: 'source', source: { ref: 'https://example.org/beethoven-5-1.ogg', url: 'https://example.org/beethoven-5-1.ogg', title: 'A link the user could add (example address)' } });
  });

  // 3. A song known only by its lyrics (nominal: the lyrics are the source of information; written for this demo),
  //    and a traditional tune known only by its title.
  work({ kind: 'track', title: 'Lantern Song', domain: 'music', people: [{ name: 'In-HTML Ensemble', role: 'artist' }], tags: ['genre:folk', 'mood:melancholic'],
    lyrics: { text: 'Carry the lantern down to the shore,\nthe boats are late and the wind is low.\nCount the lights on the water once more —\none for each song that we used to know.\n\nHum it slow, hum it slow,\nthe tide remembers the words we forgot.' } });
  work({ kind: 'track', title: 'Greensleeves', domain: 'music', year: 1580, people: [{ name: 'Traditional', role: 'artist' }], tags: ['genre:folk/english', 'era:renaissance'] });

  // 4. An audiobook: chapter 1 is a file (a synthesized stand-in), the rest are known by their titles; a book series.
  const series = work({ kind: 'bookseries', title: 'Alice', domain: 'audiobook', people: [{ name: 'Lewis Carroll', role: 'author' }] });
  const alice = work({ kind: 'book', title: "Alice's Adventures in Wonderland", parent: series.id, order: 1, year: 1865, domain: 'audiobook', people: [{ name: 'Lewis Carroll', role: 'author' }, { name: 'Demo Narrator', role: 'narrator' }], tags: ['genre:fantasy', 'lang:en'], track: { status: 'current', progress: 0, started: now - 3 * 864e5, updated: now - 3 * 864e5 } });
  ['Down the Rabbit-Hole', 'The Pool of Tears', 'A Caucus-Race and a Long Tale', 'The Rabbit Sends in a Little Bill', 'Advice from a Caterpillar', 'Pig and Pepper', 'A Mad Tea-Party', "The Queen's Croquet-Ground", "The Mock Turtle's Story", 'The Lobster Quadrille', 'Who Stole the Tarts?', "Alice's Evidence"].forEach((t, i) => {
    const w = work({ kind: 'chapter', title: t, parent: alice.id, order: i + 1, domain: 'audiobook' });
    if (i === 0) {
      const b = wav({ title: t, notes: [[57, 1], [59, 1], [60, 2], [null, 1], [64, 1], [62, 2]], bpm: 80, wave: 'soft', artist: 'Demo Narrator', album: alice.title });
      media(w.id, { presence: 'file', loc: { kind: 'blob', blob: b.id }, name: '01 Down the Rabbit-Hole.wav', size: b.size, duration: seconds, container: 'wav', mime: 'audio/wav', kind: 'audio', bookmarks: [{ at: 2.5, title: 'The White Rabbit', created: now }] });
    }
  });
  work({ kind: 'book', title: 'Through the Looking-Glass', parent: series.id, order: 2, year: 1871, domain: 'audiobook', people: [{ name: 'Lewis Carroll', role: 'author' }], track: { status: 'planned', updated: now } });

  // 5. A silent film (public domain), nominal, with a director.
  work({ kind: 'movie', title: 'Nosferatu', year: 1922, domain: 'movie', people: [{ name: 'F. W. Murnau', role: 'director' }], tags: ['genre:horror', 'era:silent'], description: 'A Symphony of Horror — the German expressionist film.', cover: { gen: { style: 'film', seed: 'movie:Nosferatu', hue: 20 } } });

  // 6. An anime known from a list (MyAnimeList-like tracking), fictional, with alternative titles and episodes.
  //    Tracking sits on the season (anime convention, see tracking.js trackTarget); episodes 1-2 are played so
  //    progress 2 is consistent and continueList offers episode 3, which only has a source reference.
  const show = work({ kind: 'show', title: 'Hoshi no Uta', titles: { romaji: 'Hoshi no Uta', native: '星の歌', en: 'Song of the Stars' }, domain: 'anime', format: 'tv', year: 2026, total: 12, tags: ['genre:slice of life', 'theme:music', 'lang:ja'], description: 'A fictional demo series: twelve episodes about a choir on a small island.' });
  const season = work({ kind: 'season', title: 'Season 1', parent: show.id, season: 1, domain: 'anime', total: 12, track: { status: 'current', progress: 2, score: 8, started: now - 10 * 864e5, updated: now - 864e5 } });
  for (let e = 1; e <= 12; e++) {
    const w = work({ kind: 'episode', title: ['The Island', 'First Rehearsal', 'Out of Tune', 'Night Practice', 'Festival Eve', 'Rain', 'Harmony', 'The Letter', 'Low Tide', 'Echo', 'Before the Stage', 'Song of the Stars'][e - 1], parent: season.id, season: 1, episode: e, domain: 'anime', duration: 1440, plays: e <= 2 ? 1 : 0, lastPlayed: e <= 2 ? now - (3 - e) * 864e5 : undefined, markers: { intro: [60, 150], outro: [1320, 1410] } });
    if (e === 3) media(w.id, { presence: 'source', source: { ref: 'example:hoshi-no-uta-03', title: 'An example reference (not a real extractor)' } });
  }
  work({ kind: 'movie', title: 'Hoshi no Uta: The Concert', titles: { romaji: 'Hoshi no Uta Gekijouban', native: '星の歌 劇場版' }, domain: 'anime', format: 'movie', year: 2027, track: { status: 'planned', updated: now } });

  // 7. A podcast with two episodes (files).
  const pod = work({ kind: 'podcast', title: 'In-HTML Radio', domain: 'podcast', people: [{ name: 'The Demo Hosts', role: 'host' }], tags: ['genre:talk'] });
  ['Episode 1: Files, sources and cards', 'Episode 2: Tags all the way down'].forEach((t, i) => {
    const b = wav({ title: t, notes: [[67, 0.5], [null, 0.5], [64, 0.5], [null, 1.5]], bpm: 90, artist: 'The Demo Hosts', album: 'In-HTML Radio' });
    const w = work({ kind: 'episode', title: t, parent: pod.id, episode: i + 1, domain: 'podcast', date: new Date(now - (2 - i) * 7 * 864e5).toISOString().slice(0, 10) });
    media(w.id, { presence: 'file', loc: { kind: 'blob', blob: b.id }, name: `radio-${i + 1}.wav`, size: b.size, duration: seconds, container: 'wav', mime: 'audio/wav', kind: 'audio' });
  });

  // 8. Collections: manual, smart, mood; a workspace with folders. Folder ids are fixed readable strings (legal per
  //    normWorkspaceRoot's id pattern) since they only need to be unique within this one tree.
  const tracks = nodes.filter((n) => n.type === 'work' && n.kind === 'track' && n.parent === album.id);
  const fav = node({ type: 'collection', kind: 'playlist', name: 'Favourites', items: [tracks[0].id, tracks[3].id, nodes.find((n) => n.title === 'Lantern Song').id].map((ref) => ({ ref, added: now })) });
  node({ type: 'collection', kind: 'smart', name: 'Calm', query: 'mood:calm OR energy:..3', kinds: ['track'], pick: 'all', sort: 'title' });
  node({ type: 'collection', kind: 'mood', name: 'Right now', tod: 'auto', kinds: ['track'] });
  node({ type: 'collection', kind: 'smart', name: 'Wishlist', query: 'presence:nominal kind:track,movie,book', pick: 'all', playable: false, sort: '-added' });
  node({ type: 'workspace', name: 'Home', view: 'auto', root: { id: 'root', name: '', items: [], children: [
    { id: 'f-listen', name: 'Listen', items: [album.id, fav.id], children: [{ id: 'f-calm', name: 'Calm evenings', items: [], children: [], query: 'mood:calm', tags: ['tod:evening'] }] },
    { id: 'f-watch', name: 'Watch', items: [show.id], children: [], query: 'domain:movie' },
    { id: 'f-read', name: 'Read aloud', items: [series.id], children: [] },
  ] } });
  return { nodes, blobs };
}
