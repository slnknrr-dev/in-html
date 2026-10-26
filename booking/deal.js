// booking/deal.js - the deal without a price calendar (sale, long-term rent): the lead funnel
//   new -> show (viewing set) -> shown -> thinking -> deal | refused -> closed
// a closed list of statuses with a transition table, per-section flows (which steps are on, their names in several
// languages), the funnel counted from statuses, and viewing slots on a minute axis that uses the same half-open
// interval rule as stays.
//
// Rules:
//  1. The status list is CLOSED and lives in code. Data only turns steps on or off and renames them; a state-graph
//     editor for seven statuses would be a language to maintain forever.
//  2. The funnel is COUNTED from the statuses, never stored as a number (a stored counter drifts from the leads).
//  3. A viewing lives on occupancy: an agent's slots use rangesOverlap, the flat's own bookings use stayConflicts -
//     a second calendar would be a second answer to "when is somebody busy".
//
//   DEAL_STATUSES, DEAL_OPEN, DEAL_ALWAYS, DEAL_NEXT, DEAL_STATUS_I18N, DEAL_FLOW_ALL
//   isDealStatus, dealOpen, dealFlowOf(settings), dealOnKey, dealNameKey, dealFlowHas, dealLabel(s, flow, lang)
//   dealCanGo(from, to, flow), dealNext(from, flow), dealFunnel(statuses, flow, lang), dealOpenCount(statuses)
//   dealConversion(statuses) -> { leads, shown, deals, showRate, dealRate }
//   SHOW_MINUTES, SHOW_MINUTES_MAX, cleanShowAt, showMinutes, normalizeShow, showDay, minuteNum, showsOverlap,
//   showConflicts(want, taken), showBusy(want, stays), freeShowSlots(day, taken, { agent, from, to, minutes, step })

import { dayAdd, dayNum, isDay } from './days.js';
import { rangesOverlap, stayConflicts } from './stays.js';

// --- statuses ---------------------------------------------------------------------------------------------------

// Order matters: it is the order of the funnel steps. Four OPEN statuses (the lead is being worked on) and three
// CLOSED ones; closed leads leave the queue, or a year later the queue is an archive.
export const DEAL_STATUSES = ['new', 'show', 'shown', 'thinking', 'deal', 'refused', 'closed'];
export const isDealStatus = (v) => DEAL_STATUSES.includes(String(v ?? ''));
export const DEAL_OPEN = ['new', 'show', 'shown', 'thinking'];
export const dealOpen = (v) => isDealStatus(v) && DEAL_OPEN.includes(v);
// Entry and exit cannot be switched off: a flow without 'new' accepts no lead, one without 'closed' cannot close one.
export const DEAL_ALWAYS = ['new', 'closed'];

// Reference labels; a section may rename them, an empty name falls back here (to the SAME language).
export const DEAL_STATUS_I18N = {
  new: { en: 'Enquiry', ru: 'Заявка', ka: 'განაცხადი' },
  show: { en: 'Viewing set', ru: 'Назначен показ', ka: 'ჩვენება დანიშნულია' },
  shown: { en: 'Viewed', ru: 'Показ состоялся', ka: 'ჩვენება შედგა' },
  thinking: { en: 'Considering', ru: 'Думает', ka: 'ფიქრობს' },
  deal: { en: 'Deal', ru: 'Сделка', ka: 'გარიგება' },
  refused: { en: 'Declined', ru: 'Отказ', ka: 'უარი' },
  closed: { en: 'Closed', ru: 'Закрыто', ka: 'დახურული' },
};
export const DEAL_LANGS = ['en', 'ru', 'ka'];

/**
 * Allowed transitions - a table, not a graph from an editor. Decisions built in:
 *  - from any open status a viewing can be set AGAIN: "considering" is a reason to show a second flat, and a second
 *    lead for the same person would count them twice;
 *  - "viewed" is reachable straight from "enquiry": the agent showed it at once;
 *  - closed statuses only REOPEN into 'new' (a client back after half a year is the same person); a deal can also be
 *    archived.
 */
export const DEAL_NEXT = {
  new: ['show', 'shown', 'thinking', 'deal', 'refused', 'closed'],
  show: ['shown', 'thinking', 'deal', 'refused', 'closed'],
  shown: ['show', 'thinking', 'deal', 'refused', 'closed'],
  thinking: ['show', 'shown', 'deal', 'refused', 'closed'],
  deal: ['closed', 'new'],
  refused: ['new'],
  closed: ['new'],
};

// --- the flow of a section --------------------------------------------------------------------------------------

// Setting keys of a section's flow: st_<status> (false = off) and nm_<status> ({ en, ru, ka } names).
export const dealOnKey = (s) => 'st_' + s;
export const dealNameKey = (s) => 'nm_' + s;

/**
 * The flow { on, names } of a section from its settings. A missing flag means ON: a section configured before the
 * flow existed gets the whole cycle, not an empty one with leads stuck in 'new'.
 */
export function dealFlowOf(settings) {
  const o = settings && typeof settings === 'object' ? settings : {};
  const names = {};
  const on = [];
  for (const s of DEAL_STATUSES) {
    if (DEAL_ALWAYS.includes(s) || o[dealOnKey(s)] !== false) on.push(s);
    const raw = o[dealNameKey(s)];
    const src = raw && typeof raw === 'object' ? raw : {};
    const nm = {};
    for (const l of DEAL_LANGS) {
      const v = String(src[l] ?? '').trim().slice(0, 40);
      if (v) nm[l] = v;
    }
    if (Object.keys(nm).length) names[s] = nm;
  }
  return { on, names };
}

export const DEAL_FLOW_ALL = { on: [...DEAL_STATUSES], names: {} };

export const dealFlowHas = (flow, s) => isDealStatus(s) && (flow ? flow.on.includes(s) : true);

/**
 * Status label in a language. Fallback: the section's name in THIS language -> the reference label of this language
 * -> the section's English name -> the English reference. A section that renamed a step only in one language must
 * not show that language to visitors of another.
 */
export function dealLabel(s, flow, lang = 'en') {
  if (!isDealStatus(s)) return String(s ?? '');
  const want = String(lang || 'en').slice(0, 2).toLowerCase();
  const own = flow?.names?.[s] || {};
  return String(own[want] || DEAL_STATUS_I18N[s][want] || own.en || DEAL_STATUS_I18N[s].en);
}

// The ONE door for every transition: buttons, the server and bots all ask it.
export function dealCanGo(from, to, flow) {
  if (!isDealStatus(from) || !isDealStatus(to)) return false;
  if (!dealFlowHas(flow, to)) return false;
  return DEAL_NEXT[from].includes(to);
}

// Where a lead can go, in the order of DEAL_STATUSES (buttons).
export const dealNext = (from, flow) => DEAL_STATUSES.filter((s) => dealCanGo(from, s, flow));

// --- funnel -----------------------------------------------------------------------------------------------------

/**
 * The funnel: a count per status, nothing else. An unknown status counts as 'new' (the sum must always equal the
 * number of leads). A switched-off step is still listed while somebody stands in it.
 * -> [{ status, label, n, open }]
 */
export function dealFunnel(statuses, flow, lang = 'en') {
  const n = new Map();
  for (const raw of statuses || []) {
    const s = isDealStatus(raw) ? raw : 'new';
    n.set(s, (n.get(s) || 0) + 1);
  }
  return DEAL_STATUSES
    .filter((s) => dealFlowHas(flow, s) || (n.get(s) || 0) > 0)
    .map((s) => ({ status: s, label: dealLabel(s, flow, lang), n: n.get(s) || 0, open: dealOpen(s) }));
}

// Leads in work (a tab badge): the same count as the open steps of the funnel.
export const dealOpenCount = (statuses) => (statuses || []).filter((s) => dealOpen(isDealStatus(s) ? s : 'new')).length;

/**
 * Conversion from current statuses (each lead counted once at the step it reached): `shown` = leads past a viewing
 * (shown, thinking, deal), `deals` = deals; rates are 0..1 of all leads (0 when there are none). An approximation:
 * a refused lead may or may not have been shown - only a status history can tell.
 */
export function dealConversion(statuses) {
  const list = (statuses || []).map((s) => (isDealStatus(s) ? s : 'new'));
  const leads = list.length;
  const shown = list.filter((s) => s === 'shown' || s === 'thinking' || s === 'deal').length;
  const deals = list.filter((s) => s === 'deal').length;
  return { leads, shown, deals, showRate: leads ? shown / leads : 0, dealRate: leads ? deals / leads : 0 };
}

// --- viewing slots ----------------------------------------------------------------------------------------------
//
// A viewing is a slot of an AGENT: [start, start + minutes) on the minute axis - 15:00-15:30 and 15:30-16:00 do not
// conflict, the same rule as the check-out day of a stay.

export const SHOW_MINUTES = 30;
export const SHOW_MINUTES_MAX = 480;

const AT_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/;

// 'YYYY-MM-DDTHH:MM' or '' (no time yet is a legal state). Seconds and zones are dropped: viewings are set in minutes
// of local time; storing them in UTC would move other people's meetings at a DST switch.
export function cleanShowAt(v) {
  const m = AT_RE.exec(String(v ?? '').trim());
  if (!m) return '';
  const [, day, hh, mm] = m;
  if (!isDay(day) || +hh > 23 || +mm > 59) return '';
  return `${day}T${hh}:${mm}`;
}

// Duration in minutes: 5 .. 480, the default for anything shorter or invalid.
export const showMinutes = (v) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 5 ? Math.min(SHOW_MINUTES_MAX, n) : SHOW_MINUTES;
};

// A slot { at, minutes, agent?, id? }; null without a time (a viewing without a time is an intention).
export function normalizeShow(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const at = cleanShowAt(r.at);
  if (!at) return null;
  const out = { at, minutes: showMinutes(r.minutes) };
  const agent = String(r.agent ?? '').trim().toLowerCase().slice(0, 64);
  if (agent) out.agent = agent;
  if (r.id !== undefined && Number.isFinite(Number(r.id))) out.id = Number(r.id);
  return out;
}

export const showDay = (s) => String(s?.at || '').slice(0, 10);

// Minute since the epoch, built on dayNum so stays and viewings share one day axis; NaN for garbage.
export function minuteNum(at) {
  const m = AT_RE.exec(String(at || ''));
  if (!m) return NaN;
  return dayNum(m[1]) * 1440 + Number(m[2]) * 60 + Number(m[3]);
}

export function showsOverlap(a, b) {
  const x = minuteNum(a?.at), y = minuteNum(b?.at);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return rangesOverlap(x, x + showMinutes(a.minutes), y, y + showMinutes(b.minutes));
}

/**
 * Which slots stand in the way: only slots of the SAME agent (two viewings at one hour by two agents is normal
 * work); a slot without an agent claims nobody's time; the slot itself (same id, being moved) is not a conflict.
 */
export function showConflicts(want, taken) {
  if (!want || !want.agent) return [];
  return (taken || []).filter((s) => s && s.agent === want.agent && s.id !== want.id && showsOverlap(want, s));
}

// Bookings of the flat on the viewing day (people live there): returned, not refused - a person decides.
export function showBusy(want, busy) {
  if (!want) return [];
  const day = showDay(want);
  return isDay(day) ? stayConflicts({ from: day, to: dayAdd(day, 1) }, busy || []) : [];
}

const hhmm = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');

/**
 * Free start times of an agent on a day: slots of `minutes` every `step` minutes between `from` and `to` ('HH:MM',
 * default 09:00-19:00) that conflict with none of the agent's taken slots (without an agent: with none of the
 * slots at all, e.g. the viewings of one flat). -> ['YYYY-MM-DDTHH:MM', ...]
 */
// Brute force over candidate starts (at most a few dozen per day) against the taken list: simpler than interval
// subtraction and obviously correct. Malformed from/to parse to NaN, so the loop simply does not run (no slots).
export function freeShowSlots(day, taken, { agent = '', from = '09:00', to = '19:00', minutes = SHOW_MINUTES, step = 30 } = {}) {
  if (!isDay(day)) return [];
  const m = (s) => { const [h, mm] = String(s).split(':').map(Number); return h * 60 + (mm || 0); };
  const len = showMinutes(minutes), st = Math.max(5, Math.trunc(step) || 30);
  const out = [];
  for (let t = m(from); t + len <= m(to); t += st) {
    const want = { at: `${day}T${hhmm(t)}`, minutes: len, agent: String(agent).toLowerCase() };
    const clash = want.agent ? showConflicts(want, taken) : (taken || []).filter((s) => showsOverlap(want, s));
    if (!clash.length) out.push(want.at);
  }
  return out;
}
