// event-invite/guests.js - the guests page: a pasted guest list (calendar/guests.js parseGuestList: 'Name',
// 'Name <mail>', one name per content language separated by commas) with a group and allowed companions, groups and
// tags, RSVP statuses entered by the host or read from pasted replies ([RSVP|…] tags of the invitation), tables, the
// summary (counts, seats against a capacity, poll bars, groups, tags, tables, menu choices), filters, the CSV export,
// personalised links (#guest=…), personalised invitation files, invitation e-mails (mailto: and a mail-merge ZIP of
// .eml files), printed and PDF name cards, and, with an RSVP server, "Sync replies" (manual answers are kept, conflicts
// shown).
//
// Architecture: module-level state S (the shared event record from common.js) + F (filters, page-local, not saved).
// Two render levels: render() rebuilds the whole page (language switch, storage reload, clear-all), renderTable()
// rebuilds only the list (add, filter, remove). Edits inside a row update S in place and call changed(), which
// saves (debounced) and repaints the summary without rebuilding rows, so the input being typed in keeps focus.
import { PDF_FONT, RESPONSES, fontPicker, inviteData, serverReady, fileSafe, guestLink, inviteHTML, loadEvent, normalizeGuest, onStorage, saveEvent, startShell, tl, uid } from './common.js';
import { FONTS, LANG_NAMES, ornamentHead, parseReplies, theme, txt } from './invite.js';
import { button, card, copyText, download, field, select, t, textInput, toast } from '../ui/app.js';
import { $, debounce, esc, h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { confirmDialog } from '../ui/overlays.js';
import { guestsCsv, normalizeTags, parseGuestList, pollBars, rsvpSummary, tagCounts } from '../calendar/guests.js';
import { mailtoLink } from '../mail/address.js';
import { mailMergeZip } from './mailer.js';
import { nameCardsPDF } from './cards-pdf.js';
import { api } from './net.js';
import { openDialog } from '../ui/overlays.js';

// `let`: reassigned when the designer page saves in another tab (onStorage below).
let S = loadEvent();
const F = { q: '', group: '', status: '' };
// 300ms debounce: typing in a row would otherwise serialise up to 5000 guests to localStorage on every keystroke.
const save = debounce(() => saveEvent(S), 300);
const main = $('#main');
main.classList.add('ei-guests');
let els = {};

const answer = (g) => (g.rsvp && g.rsvp.response) || '';
// Display fallback chain: main name, any per-language name, e-mail, dash; a guest is never shown as blank.
const shownName = (g) => g.name || Object.values(g.names || {}).find(Boolean) || g.email || '—';

// ---------------------------------------------------------------------------------------------------------------
// Layout

function render() {
  main.textContent = '';
  els = {};
  // aria-live="polite" on the summary: screen readers announce new counts after an edit without interrupting.
  els.sum = h('div', { class: 'ei-sum', 'aria-live': 'polite' });
  els.capBar = h('div', { class: 'ei-cap-bar' });
  els.more = h('div', { class: 'ei-sum-more' });
  const cap = textInput(S.capacity ? String(S.capacity) : '', (v) => { S.capacity = Math.max(0, Math.min(100000, Math.floor(+v) || 0)); changed(); }, { type: 'number', min: 0, class: 'ed-input ei-num ei-cap', placeholder: '0' });
  const capRow = h('div', { class: 'ei-cap-row' }, field('ei.s.capacity', cap, 'ei.s.capacityHint'), els.capBar);
  els.table = h('div', { class: 'ei-g-list' });
  els.count = h('span', { class: 'ei-g-count' });
  const side = h('div', { class: 'ei-col ei-g-side' }, addCard(), repliesCard(), linkCard(), card('ei.x.font', fontPicker()));
  const list = card('ei.g.list', toolbar(), els.table);
  list.classList.add('ei-g-listcard');
  main.append(h('div', { class: 'ei-g-work' }, side, h('div', { class: 'ei-col ei-g-main' }, card('ei.g.summary', els.sum, capRow, els.more), list)));
  paintSummary();
  renderTable();
}

function addCard() {
  const area = textInput('', () => {}, { multiline: true, rows: 6, class: 'ed-input ed-textarea ei-paste', placeholder: t('ei.g.pastePh'), spellcheck: 'false' });
  const grp = textInput('', () => {}, { class: 'ed-input ei-add-group', list: 'ei-groups', maxlength: 60, placeholder: t('ei.g.groupPh') });
  const plus = select([0, 1, 2, 3, 4].map((v) => ({ v, l: '=' + v })), S.rsvp.plus, () => {});
  const add = button('ei.g.add', 'plus', () => {
    // Duplicates are detected by e-mail only (names are too ambiguous). A duplicate merges new per-language names in,
    // existing ones winning (spread order). The comparison assumes parseGuestList returns lower-cased e-mails.
    const parsed = parseGuestList(area.value, S.langs);
    if (!parsed.length) { toast(t('ei.g.addNone'), 'warn'); return; }
    let n = 0;
    for (const p of parsed) {
      const dup = p.email && S.guests.find((g) => g.email && g.email.toLowerCase() === p.email);
      if (dup) { dup.names = { ...p.names, ...dup.names }; continue; }
      S.guests.push(normalizeGuest({ id: uid(8), name: p.name, names: p.names, email: p.email, group: grp.value.trim(), plus: +plus.value, lang: '' }));
      n++;
    }
    area.value = '';
    changed(); renderTable();
    toast(t('ei.g.added', { n }), 'ok');
  }, 'primary');
  add.classList.add('ei-add');
  const langs = S.langs.length > 1 ? t('ei.g.pasteLangs', { langs: S.langs.map((l) => LANG_NAMES[l]).join(', ') }) : '';
  return card('ei.g.addTitle', h('div', { class: 'ed-fields' },
    field('ei.g.paste', area, '=' + t('ei.g.pasteHint') + (langs ? ' ' + langs : '')),
    h('div', { class: 'ed-grid2' }, field('ei.g.group', grp), field('ei.g.allowed', plus)),
    h('div', { class: 'ap-actions' }, add)));
}

function repliesCard() {
  const area = textInput('', () => {}, { multiline: true, rows: 4, class: 'ed-input ed-textarea ei-replies', placeholder: '[RSVP|…]', spellcheck: 'false' });
  const go = button('ei.g.import', 'reply', () => {
    // Reply matching order: guest id from a personal link (exact), then name (case-insensitive, any language).
    // Unknown replies become new guests rather than being dropped: a reply forwarded from someone not on the list is
    // still information the host needs. Imported answers overwrite any manual status (an explicit host action).
    const list = parseReplies(area.value);
    if (!list.length) { toast(t('ei.g.importNone'), 'warn'); return; }
    let added = 0;
    const key = (s) => String(s || '').trim().toLowerCase();
    for (const r of list) {
      let g = r.id && S.guests.find((x) => x.id === r.id);
      if (!g && r.name) g = S.guests.find((x) => [x.name, ...Object.values(x.names || {})].some((n) => key(n) === key(r.name)));
      if (!g) { g = normalizeGuest({ id: r.id || uid(8), name: r.name || '?', plus: r.plus }); S.guests.push(g); added++; }
      g.rsvp = { response: r.response, guests: r.response === 'yes' ? r.plus : 0, menu: r.menu || '', diet: r.diet || '', src: 'reply', sid: '' };
    }
    area.value = '';
    changed(); renderTable();
    toast(t('ei.g.imported', { n: list.length }) + (added ? ' ' + t('ei.g.importNew', { n: added }) : ''), 'ok');
  });
  go.classList.add('ei-import');
  return card('ei.g.replies', h('div', { class: 'ed-fields' }, field('ei.g.repliesLabel', area, 'ei.g.repliesHint'), h('div', { class: 'ap-actions' }, go)));
}

function linkCard() {
  return card('ei.g.linkTitle', h('div', { class: 'ed-fields' },
    field('ei.g.address', textInput(S.link, (v) => { S.link = v.trim(); changed(); }, { type: 'url', class: 'ed-input ei-link', placeholder: 'https://example.com/invitation.html', spellcheck: 'false' }), 'ei.g.addressHint'),
    field('ei.g.file', textInput(S.file, (v) => { S.file = v.trim() || 'invitation.html'; changed(); }, { placeholder: 'invitation.html', spellcheck: 'false' }), 'ei.g.fileHint')));
}

function toolbar() {
  // Filter changes call renderTable(), not changed(): filters are view state and must not trigger a save.
  const q = textInput(F.q, (v) => { F.q = v; renderTable(); }, { type: 'search', placeholder: t('ei.g.search'), 'aria-label': t('ei.g.search'), class: 'ed-input ei-g-q' });
  const groups = [...new Set(S.guests.map((g) => g.group).filter(Boolean))].sort();
  const gsel = select([{ v: '', l: 'ei.g.allGroups' }, ...groups.map((g) => ({ v: g, l: '=' + g }))], F.group, (v) => { F.group = v; renderTable(); });
  gsel.setAttribute('aria-label', t('ei.g.group'));
  const ssel = select([{ v: '', l: 'ei.g.allStatus' }, { v: 'none', l: 'ei.st.none' }, ...RESPONSES.map((r) => ({ v: r, l: 'ei.st.' + r }))], F.status, (v) => { F.status = v; renderTable(); });
  ssel.setAttribute('aria-label', t('ei.g.status'));
  const sm = (b) => { b.classList.add('ed-sm'); return b; };
  return h('div', { class: 'ei-g-bar' },
    h('div', { class: 'ei-g-filters' }, q, gsel, ssel, els.count),
    h('div', { class: 'ap-row ei-g-acts' },
      serverReady(S) ? sm(button('ei.g.sync', 'refresh', syncReplies, 'primary')) : null,
      sm(button('ei.g.csv', 'sheet', exportCsv)), sm(button('ei.g.zip', 'mail', exportZip)), sm(button('ei.g.cards', 'print', printNameCards)), sm(button('ei.g.pdfCards', 'paper', exportNameCardsPDF)),
      sm(button('ei.g.clear', 'trash', clearAll, 'danger'))),
    // <datalist> shared by the add form and every row: group names typed once are offered everywhere.
    h('datalist', { id: 'ei-groups' }, groups.map((g) => h('option', { value: g }))));
}

// --- table ----------------------------------------------------------------------------------------------------------

// Search across every text field incl. per-language names and tags. Linear scan per keystroke: fine for the 5000
// guest cap; an index would cost more in invalidation than it saves.
function filtered() {
  const q = F.q.trim().toLowerCase();
  return S.guests.filter((g) => {
    if (F.group && g.group !== F.group) return false;
    if (F.status && (F.status === 'none' ? answer(g) : answer(g) !== F.status)) return false;
    if (!q) return true;
    return [g.name, ...Object.values(g.names || {}), g.email, g.group, g.seat, g.note, ...g.tags].some((x) => String(x || '').toLowerCase().includes(q));
  });
}

function renderTable() {
  const box = els.table;
  box.textContent = '';
  const rows = filtered();
  els.count.textContent = t('ei.g.shown', { n: rows.length, total: S.guests.length });
  if (!S.guests.length) { box.append(h('p', { class: 'ap-empty' }, t('ei.g.empty'))); return; }
  if (!rows.length) { box.append(h('p', { class: 'ap-empty' }, t('ei.g.noMatch'))); return; }
  // aria-hidden: the visual header duplicates the per-input aria-labels; exposing both would double-announce.
  const head = h('div', { class: 'ei-g-row ei-g-head', 'aria-hidden': 'true' },
    ['ei.g.name', 'ei.g.groupTags', 'ei.g.allowedShort', 'ei.g.status', 'ei.g.seat', ''].map((k) => h('span', {}, k ? t(k) : '')));
  box.append(head, ...rows.map(guestRow));
}

function guestRow(g) {
  // upd(): wraps each field setter with changed(), so every edit saves and repaints the summary in one place.
  const upd = (fn) => (v) => { fn(v); changed(); };
  const inp = (val, fn, attrs) => textInput(val, upd(fn), attrs);
  // Editing the main name drops a single per-language name, which would otherwise shadow the edit in the invitation.
  const name = inp(g.name, (v) => { g.name = v; if (g.names && Object.keys(g.names).length <= 1) g.names = {}; }, { class: 'ed-input ei-g-name', 'aria-label': t('ei.g.name'), maxlength: 120 });
  const email = inp(g.email, (v) => { g.email = v.trim(); mail.disabled = !g.email; }, { type: 'email', class: 'ed-input ei-g-email', 'aria-label': t('ei.g.email'), placeholder: t('ei.g.email') });
  const grp = inp(g.group, (v) => { g.group = v.trim(); }, { class: 'ed-input', list: 'ei-groups', 'aria-label': t('ei.g.group'), placeholder: t('ei.g.group'), maxlength: 60 });
  const tags = inp(g.tags.join(', '), (v) => { g.tags = normalizeTags(v); }, { class: 'ed-input', 'aria-label': t('ei.g.tags'), placeholder: t('ei.g.tags') });
  const plus = inp(String(g.plus), (v) => { g.plus = Math.max(0, Math.min(9, Math.floor(+v) || 0)); }, { type: 'number', min: 0, max: 9, class: 'ed-input ei-num', 'aria-label': t('ei.g.allowed') });
  // Status change: a manual status keeps the server reply id (sid), so the next sync does not report the same server
  // answer as new. data-st on the row drives the CSS status stripe without re-rendering the row.
  const status = select([{ v: '', l: 'ei.st.none' }, ...RESPONSES.map((r) => ({ v: r, l: 'ei.st.' + r }))], answer(g), (v) => {
    g.rsvp = v ? { response: v, guests: v === 'yes' ? (g.rsvp?.guests || 0) : 0, menu: g.rsvp?.menu || '', diet: g.rsvp?.diet || '', src: 'manual', sid: g.rsvp?.sid || '' } : null;
    coming.disabled = v !== 'yes';
    if (v !== 'yes') coming.value = '0';
    row.dataset.st = v || 'none';
    changed();
  });
  status.classList.add('ei-g-status');
  status.setAttribute('aria-label', t('ei.g.status'));
  const coming = inp(String(g.rsvp?.guests || 0), (v) => { if (g.rsvp) g.rsvp.guests = Math.max(0, Math.min(20, Math.floor(+v) || 0)); }, { type: 'number', min: 0, max: 20, class: 'ed-input ei-num ei-g-coming', 'aria-label': t('ei.g.coming'), title: t('ei.g.coming') });
  coming.disabled = answer(g) !== 'yes';
  const seat = inp(g.seat, (v) => { g.seat = v.trim(); }, { class: 'ed-input ei-g-seat', 'aria-label': t('ei.g.seat'), placeholder: t('ei.g.seatPh'), maxlength: 40 });
  // Icon buttons: aria-label includes the guest name ("Remove: Nino") so a screen-reader list of buttons is not twenty
  // identical "Remove" entries.
  const ib = (ic, label, fn, cls = '') => h('button', { type: 'button', class: 'ed-iconbtn ' + cls, title: t(label), 'aria-label': `${t(label)}: ${shownName(g)}`, html: icon(ic), onclick: fn });
  const mail = ib('mail', 'ei.g.mail', () => mailGuest(g));
  mail.disabled = !g.email;
  const row = h('div', { class: 'ei-g-row', dataset: { id: g.id, st: answer(g) || 'none' } },
    h('div', { class: 'ei-g-cell ei-g-who' }, name, email),
    h('div', { class: 'ei-g-cell' }, grp, tags),
    h('div', { class: 'ei-g-cell ei-g-allow' }, h('span', { class: 'ei-g-mlabel' }, t('ei.g.allowedShort')), plus),
    h('div', { class: 'ei-g-cell ei-g-st' }, status, h('label', { class: 'ei-g-plus' }, h('span', {}, '+'), coming)),
    h('div', { class: 'ei-g-cell' }, seat),
    h('div', { class: 'ei-g-cell ei-g-btns' },
      ib('link', 'ei.g.copyLink', () => copyText(guestLink(S, g), t('ei.g.linkCopied'))),
      ib('download', 'ei.g.personal', () => personalFile(g)),
      mail,
      ib('trash', 'ei.g.remove', () => removeGuest(g), 'ed-danger')));
  return row;
}

// Undo via toast instead of a confirm dialog: removing one guest is common and cheap to reverse. The guest is put
// back at its old index; if the list changed meanwhile the position may differ, the data does not.
function removeGuest(g) {
  const i = S.guests.indexOf(g);
  if (i < 0) return;
  S.guests.splice(i, 1);
  changed(); renderTable();
  toast(t('ei.g.removed', { name: shownName(g) }), 'info', { label: t('dlg.undo'), fn: () => { S.guests.splice(i, 0, g); changed(); renderTable(); } });
}
// Clear-all is destructive enough for a confirm dialog AND an undo (holding the old array costs nothing).
async function clearAll() {
  if (!S.guests.length) return;
  if (!(await confirmDialog(t('ei.g.clear'), t('ei.g.clearText', { n: S.guests.length }), t('dlg.delete'), true))) return;
  const before = S.guests;
  S.guests = [];
  changed(); render();
  toast(t('ei.g.cleared'), 'info', { label: t('dlg.undo'), fn: () => { S.guests = before; changed(); render(); } });
}

async function personalFile(g) {
  try { download(await inviteHTML(S, { guest: g }), fileSafe(txt(S.title, S.langs[0])) + '-' + fileSafe(shownName(g), 'guest') + '.html', 'text/html'); }
  catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}

// mailto: through a temporary <a> click, not location.href: assigning location would count as a navigation and
// could tear down the page in some browsers when no mail handler is registered.
function mailGuest(g) {
  if (!g.email) return;
  const l = g.lang && S.langs.includes(g.lang) ? g.lang : S.langs[0];
  const title = txt(S.title, l, S.langs[0]);
  const name = (g.names && g.names[l]) || g.name;
  const a = h('a', { href: mailtoLink({ to: g.email, subject: tl(l, 'ei.g.mailSubject', { title }), body: tl(l, 'ei.g.mailBody', { name, title, link: guestLink(S, g) }) }) });
  document.body.append(a); a.click(); a.remove();
}

// --- summary --------------------------------------------------------------------------------------------------------

// rsvpSummary (calendar/guests.js) does the counting; this function only maps numbers to tiles. "maybe" and
// "maybeNo" share one tile; the poll bars below keep them apart.
function paintSummary() {
  const box = els.sum;
  if (!box) return;
  box.textContent = '';
  const sum = rsvpSummary(S.guests, { capacity: S.capacity });
  const c = sum.counts;
  const tile = (k, n, label, sub) => h('div', { class: 'ei-tile ei-tile-' + k, dataset: { k } }, h('b', { class: 'ei-tile-n' }, String(n)), h('span', {}, label), sub ? h('small', {}, sub) : null);
  box.append(h('div', { class: 'ei-tiles' },
    tile('total', sum.total, t('ei.s.total', { n: sum.total })),
    tile('yes', c.yes, t('ei.st.yes')),
    tile('maybe', c.maybe + c.maybeNo, t('ei.st.maybe')),
    tile('no', c.no, t('ei.st.no')),
    c.waitlist ? tile('waitlist', c.waitlist, t('ei.st.waitlist')) : null,
    tile('none', sum.noAnswer, t('ei.st.none')),
    tile('seats', sum.seats, t('ei.s.seats', { n: sum.seats }), sum.fullness ? t('ei.s.of', { cap: sum.fullness.cap }) : '')));
  els.capBar.textContent = '';
  els.more.textContent = '';
  if (sum.fullness) {
    const f = sum.fullness;
    // role="meter" with aria-value*: the capacity bar is a gauge, not a progress bar (nothing is "loading").
    els.capBar.append(h('div', { class: 'ei-bar ei-full' + (f.full ? ' ei-over' : f.almost ? ' ei-almost' : ''), role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': f.cap, 'aria-valuenow': f.going, 'aria-label': t('ei.s.capacity') },
      h('i', { style: { width: f.pct + '%' } }), h('span', {}, f.full ? t('ei.s.full') : t('ei.s.left', { n: f.left }))));
  }
  // Poll bars of the answers.
  const keys = ['yes', 'maybe', 'maybeNo', 'no', 'waitlist', 'none'];
  const bars = pollBars(keys.map((k) => t('ei.st.' + k)), keys.map((k) => (k === 'none' ? sum.noAnswer : c[k])));
  els.more.append(h('div', { class: 'ei-polls' }, h('div', { class: 'ed-label' }, t('ei.s.answers')),
    // The first four answer bars are always shown (stable layout); waitlist and "none" only when non-zero.
    bars.map((b, i) => (b.count || i < 4 ? h('div', { class: 'ei-poll ei-poll-' + keys[i] }, h('span', { class: 'ei-poll-l' }, b.label), h('span', { class: 'ei-poll-b' }, h('i', { style: { width: b.pct + '%' } })), h('b', {}, String(b.count))) : null))));
  // Groups, tags, tables and menu choices.
  const groups = new Map();
  for (const g of S.guests) {
    const k = g.group || t('ei.s.noGroup');
    if (!groups.has(k)) groups.set(k, { n: 0, seats: 0 });
    const x = groups.get(k); x.n++;
    if (answer(g) === 'yes') x.seats += 1 + (g.rsvp.guests || 0);
  }
  const chips = (title, list) => (list.length ? h('div', { class: 'ei-chipset' }, h('div', { class: 'ed-label' }, title), h('div', { class: 'ed-chips' }, list)) : null);
  const chip = (label, n, sub) => h('span', { class: 'ed-chip ei-chip' }, label, h('b', {}, String(n)), sub ? h('small', {}, sub) : null);
  const tables = new Map(), menus = new Map();
  for (const g of S.guests) {
    if (answer(g) !== 'yes') continue;
    if (g.seat) tables.set(g.seat, (tables.get(g.seat) || 0) + 1 + (g.rsvp.guests || 0));
    if (g.rsvp.menu) menus.set(g.rsvp.menu, (menus.get(g.rsvp.menu) || 0) + 1);
  }
  els.more.append(h('div', { class: 'ei-chipsets' },
    chips(t('ei.s.groups'), [...groups].map(([k, x]) => chip(k, x.n, x.seats ? t('ei.s.seatsShort', { n: x.seats }) : ''))),
    chips(t('ei.s.tags'), tagCounts(S.guests).slice(0, 30).map((x) => chip(x.tag, x.count))),
    // numeric collation: "Table 2" sorts before "Table 10".
    chips(t('ei.s.tables'), [...tables].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([k, n]) => chip(k, n))),
    chips(t('ei.s.menu'), [...menus].map(([k, n]) => chip(k, n)))));
}

// --- exports ----------------------------------------------------------------------------------------------------

// guestsCsv (calendar/guests.js) handles quoting and formula-injection escaping; this side only passes labels in the
// UI language, so the exported header matches what the host sees on screen. Exports the filtered view, not all.
function exportCsv() {
  const labels = {
    name: t('ei.g.name'), lang: t('ei.g.lang'), response: t('ei.g.status'), option: t('ei.g.menu'), total: t('ei.g.total'), opened: t('ei.g.opened'),
    tags: t('ei.g.tags'), seat: t('ei.g.seat'), email: t('ei.g.email'), phone: t('ei.g.phone'), note: t('ei.g.note'), link: t('ei.g.link'),
    yes: t('ei.st.yes'), no: t('ei.st.no'), maybe: t('ei.st.maybe'), maybeNo: t('ei.st.maybeNo'), waitlist: t('ei.st.waitlist'), none: t('ei.st.none'), true: t('ei.yes'), false: t('ei.no'),
  };
  const rows = filtered().map((g) => ({
    name: shownName(g), lang: g.lang, rsvp: g.rsvp, option: g.rsvp?.menu || '', tags: g.tags, seat: g.seat, email: g.email, phone: g.phone, note: g.note,
    link: guestLink(S, g), answers: [g.group, g.plus],
  }));
  download(guestsCsv(rows, { labels, extra: [t('ei.g.group'), t('ei.g.allowed')] }), fileSafe(txt(S.title, S.langs[0]), 'guests') + '-guests.csv', 'text/csv');
}

// Mail merge: one .eml per guest with an e-mail address, personalised (greeting, language, personal link).
async function exportZip() {
  const list = filtered().filter((g) => g.email);
  if (!list.length) { toast(t('ei.g.zipNone'), 'warn'); return; }
  try {
    const bytes = await mailMergeZip(list.map((g) => ({ D: inviteData(S, { guest: g }), guest: { i: g.id, n: Object.keys(g.names || {}).length > 1 ? g.names : g.name }, link: guestLink(S, g), to: { name: shownName(g), address: g.email }, lang: g.lang })));
    download(bytes, fileSafe(txt(S.title, S.langs[0]), 'invitation') + '-emails.zip', 'application/zip');
  } catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}
function exportNameCardsPDF() {
  const list = filtered();
  if (!list.length) { toast(t('ei.g.noMatch'), 'warn'); return; }
  try { download(nameCardsPDF(inviteData(S), list, { fonts: PDF_FONT.bytes ? [PDF_FONT.bytes] : [], tableLabel: (n) => t('ei.g.tableN', { n }) }), fileSafe(txt(S.title, S.langs[0]), 'guests') + '-name-cards.pdf', 'application/pdf'); }
  catch (e) { toast(t('err.generic', { msg: e.message }), 'error'); }
}

// Algorithm: (1) sort replies by time and keep the latest per guest key, mirroring the server's counts route;
// (2) match by guest id, then by name; (3) skip replies already applied (sid); (4) a differing manual status is a
// conflict, never silently overwritten; (5) the dialog decides all conflicts at once.
// Replies from the RSVP server: new answers are applied, answers the host set by hand win and are listed as
// conflicts (the host may take the server's answers instead), unknown names become guests.
async function syncReplies() {
  let replies;
  try { replies = (await api(S.server.url, 'api/events/' + encodeURIComponent(S.server.event) + '/replies', { token: S.server.token })).replies || []; }
  catch (e) { toast(t('ei.g.syncFail', { msg: e.message }), 'error'); return; }
  const key = (v) => String(v || '').trim().toLowerCase();
  const latest = new Map();
  for (const r of [...replies].sort((a, b) => (a.at < b.at ? -1 : 1))) latest.set(r.guest || 'n:' + key(r.name), r);
  let applied = 0, added = 0;
  const conflicts = [];
  for (const r of latest.values()) {
    let g = r.guest && S.guests.find((x) => x.id === r.guest);
    if (!g) g = S.guests.find((x) => [x.name, ...Object.values(x.names || {})].some((n) => key(n) === key(r.name)));
    const rsvp = { response: r.answer, guests: r.answer === 'yes' ? r.plus | 0 : 0, menu: r.menu || '', diet: r.diet || '', src: 'server', sid: r.id };
    if (!g) { S.guests.push(normalizeGuest({ id: r.guest || uid(8), name: r.name, rsvp, note: r.msg || '' })); added++; continue; }
    // Same server reply as last time: nothing new, and not a conflict either.
    if (g.rsvp && g.rsvp.sid === r.id) continue;
    if (g.rsvp && g.rsvp.src === 'manual' && (g.rsvp.response !== rsvp.response || (g.rsvp.guests | 0) !== rsvp.guests)) { conflicts.push({ g, rsvp }); continue; }
    g.rsvp = rsvp;
    if (r.msg && !g.note) g.note = r.msg.slice(0, 400);
    applied++;
  }
  changed(); renderTable();
  toast(t('ei.g.synced', { n: applied }) + (added ? ' ' + t('ei.g.importNew', { n: added }) : ''), 'ok');
  if (!conflicts.length) return;
  const body = h('div', { class: 'ei-conflicts' }, h('p', {}, t('ei.g.conflicts', { n: conflicts.length })),
    h('ul', {}, conflicts.map((c) => h('li', {}, t('ei.g.conflictRow', { name: shownName(c.g), mine: t('ei.st.' + c.g.rsvp.response), theirs: t('ei.st.' + c.rsvp.response) + (c.rsvp.guests ? ' +' + c.rsvp.guests : '') })))));
  const v = await openDialog({ title: t('ei.g.conflictTitle'), body, buttons: [{ label: t('ei.g.keepMine'), value: 'mine' }, { label: t('ei.g.useServer'), value: 'server', primary: true }] });
  if (v === 'server') { for (const c of conflicts) c.g.rsvp = c.rsvp; changed(); renderTable(); }
  // "Keep mine": remember the server reply id, so the same conflict is not raised again on the next sync.
  else for (const c of conflicts) c.g.rsvp.sid = c.rsvp.sid;
  save();
}

// Folded name cards (tents): four on an A4 sheet, the name upright on the front and upside down on the back.
// HTML print instead of the PDF path: uses the browser's fonts (any script works without picking a TTF).
// Names go through esc() because the sheet is built with innerHTML.
function printNameCards() {
  const list = filtered();
  if (!list.length) { toast(t('ei.g.noMatch'), 'warn'); return; }
  const th = theme(S.design.theme);
  $('#ei-print')?.remove();
  const sheet = h('div', { id: 'ei-print', class: 'ei-tents', style: { '--acc': th.accent, '--ink': th.ink, '--paper': th.paper, '--seal': th.seal, '--head': FONTS[S.design.font] || FONTS.serif } });
  const half = (g, back) => `<div class="ei-tent-half${back ? ' ei-tent-back' : ''}"><span class="ei-tent-orn">${ornamentHead(S.design.ornament)}</span><b>${esc(shownName(g))}</b>${g.seat ? `<small>${esc(t('ei.g.tableN', { n: g.seat }))}</small>` : ''}</div>`;
  // @page inside the sheet: applies only while the sheet exists, so printing other pages keeps default margins.
  sheet.innerHTML = '<style>@page{size:A4;margin:8mm}</style>' + list.map((g) => `<div class="ei-tent">${half(g, true)}${half(g, false)}</div>`).join('');
  document.body.append(sheet);
  document.body.classList.add('ei-printing');
  // Cleanup on afterprint, plus a 1s timer after print() as a fallback for browsers that never fire afterprint.
  // print() blocks in desktop browsers, so the timer starts after the dialog closes; done() is idempotent.
  // The 60ms delay lets the browser apply styles to the new sheet before the print snapshot.
  const done = () => { document.body.classList.remove('ei-printing'); sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1000); }, 60);
}

// ---------------------------------------------------------------------------------------------------------------

// Count line updated here because a row edit (e.g. status) can change filter membership without a table rebuild.
function changed() { save(); paintSummary(); if (els.count) els.count.textContent = t('ei.g.shown', { n: filtered().length, total: S.guests.length }); }

onStorage(() => { S = loadEvent(); render(); });
startShell('guests', () => render());
render();
