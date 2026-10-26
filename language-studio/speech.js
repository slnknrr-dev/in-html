// language-studio/speech.js - pronunciation through the browser's own speech synthesis (Web Speech API, offline
// voices of the operating system; nothing is fetched by this page). A language without an installed voice simply
// has no "listen" buttons.
//
//   canSpeak(lang) -> boolean (after voicesReady())   speak(text, lang, rate?)   voicesReady() -> Promise

const synth = () => (typeof window !== 'undefined' && window.speechSynthesis) || null;

// Voices load asynchronously in Chromium (getVoices() is empty until 'voiceschanged'), synchronously in Firefox and
// Safari. The promise resolves on whichever comes first: voices already present, the event, or a 1.5 s timeout
// (some engines never fire the event when there are no voices). Memoised: every caller shares one wait.
let ready = null;
export function voicesReady() {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    const s = synth();
    if (!s) { resolve([]); return; }
    const done = () => resolve(s.getVoices());
    if (s.getVoices().length) { done(); return; }
    s.addEventListener?.('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
  return ready;
}

// Best voice for a BCP 47 tag, most specific first: exact tag, then any region of the base language (some engines
// report "ka_GE" with an underscore, hence the replace), then the bare base tag. null = no voice: callers hide the
// listen button rather than letting the engine read Georgian with an English voice.
function voiceFor(lang) {
  const s = synth();
  if (!s) return null;
  const vs = s.getVoices();
  const base = lang.split('-')[0];
  return vs.find((v) => v.lang === lang) || vs.find((v) => v.lang.replace('_', '-').toLowerCase().startsWith(base + '-')) || vs.find((v) => v.lang.toLowerCase() === base) || null;
}

export const canSpeak = (lang) => !!voiceFor(lang);

// cancel() first: a new click interrupts the previous word instead of queueing behind it. Rate 0.8: slightly slow,
// for learners.
export function speak(text, lang, rate = 0.8) {
  const s = synth();
  const v = voiceFor(lang);
  if (!s || !v) return false;
  s.cancel();
  const u = new SpeechSynthesisUtterance(String(text));
  u.voice = v;
  u.lang = v.lang;
  u.rate = rate;
  s.speak(u);
  return true;
}
