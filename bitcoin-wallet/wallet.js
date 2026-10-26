// bitcoin-wallet/wallet.js - the wallet section: the wallets of the current network, creating (new phrase with the
// backup check), restoring and watch-only wallets (xpub / ypub / zpub, descriptors, addresses), and per wallet the
// overview (balance, history with fee bumping), receive (fresh addresses, BIP-21 QR), send (send.js), coins (coin
// control, freezing, labels), addresses, message signing and verification, the address book and backup / export.
//
// Routing: #/wallet[/<id>[/<sub>]] plus #/wallet/new/<kind> and #/wallet/book. Every sub-view is a function
// (ctx, wallet) that appends to ctx.view; local `paint()` closures re-render one view after a sync or an edit, and
// ctx.alive() guards async continuations against a view the user has already left.
// Pattern for chain data: paint immediately from the cache (possibly "not synced"), start a sync in the background,
// repaint when it lands. The UI is never blocked on the network.
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { button, copyText, download, field, seg, select, textInput, toggle } from '../ui/app.js';
import { confirmDialog, openDialog, promptDialog, toast } from '../ui/overlays.js';
import { contextMenu } from '../ui/contextmenu.js';
import { iconEl } from '../ui/icons.js';
import { generateMnemonic } from '../hdkey/bip39.js';
import { extendedKeyPrefix } from '../hdkey/bip32.js';
import { isValidAddress, decodeAddress } from '../bitcoin/address.js';
import { formatBitcoinURI } from '../bitcoin/uri.js';
import { signMessage, verifyMessage, bip322Sign } from '../bitcoin/message.js';
import { parseDescriptor } from '../bitcoin/descriptor.js';
import { exportLabels } from '../bitcoin/labels.js';
import { openVault } from '../walletui/vault.js';
import { NETWORKS } from '../bitcoin/networks.js';
import { mnemonicGrid, backupCheck, mnemonicInput } from '../walletui/mnemonic.js';
import { qrElement, showQr } from '../walletui/qr.js';
import { addressBookView } from '../walletui/addressbook.js';
import { section, kv, go, busy, statusLine, linkTo, mono, copyable, OFFLINE } from '../walletui/shell.js';
import { backendCall } from '../walletui/net.js';
import { short, ago } from '../walletui/format.js';
import { lineChart } from '../walletui/chart.js';
import {
  settings, vault, walletsOfNetwork, walletById, createHdWallet, createWatchWallet, deleteWallet, addHdAccount, accountOf,
  masterOf, saveVault, source, labelOf, setLabel, syncCache, backendInfo,
} from './state.js';
import { amt, syncWallet, walletState, nextIndex, lang, parseAmount } from './common.js';
import { renderSend, bumpDialog, cpfpDialog } from './send.js';

// Display names: BIP numbers for HD account types, descriptor function names for imported descriptors.
const TYPE_LABEL = { p2wpkh: 'Native SegWit (BIP-84)', p2tr: 'Taproot (BIP-86)', 'p2sh-p2wpkh': 'Nested SegWit (BIP-49)', p2pkh: 'Legacy (BIP-44)', addresses: 'Addresses', wpkh: 'wpkh()', 'sh-wpkh': 'sh(wpkh())', tr: 'tr()', pkh: 'pkh()', wsh: 'wsh()', 'sh-wsh': 'sh(wsh())' };
export const typeLabel = (x) => TYPE_LABEL[x] || x;

export async function renderWallet(ctx) {
  const [, id, sub] = ctx.route.parts;
  if (id === 'new') return renderNew(ctx, sub);
  if (id === 'book') return renderBook(ctx);
  const list = walletsOfNetwork();
  if (!id) {
    // One wallet: skip the list and open it directly; replace:true keeps the back button from bouncing to the list.
    if (list.length === 1) { go('wallet/' + list[0].id, { replace: true }); return; }
    return renderList(ctx, list);
  }
  const w = walletById(id);
  if (!w) { go('wallet', { replace: true }); return; }
  const subs = [['', 'btc.overview'], ['receive', 'btc.receive'], ['send', 'btc.send'], ['coins', 'btc.coins'], ['addresses', 'btc.addresses'], ['sign', 'btc.messages'], ['backup', 'btc.backupExport']];
  ctx.view.append(h('div', { class: 'ap-row' }, h('h2', { class: 'wu-h' }, w.name), h('span', { class: 'wu-pill' }, NETWORKS[w.network].label), w.kind === 'watch' ? h('span', { class: 'wu-pill wu-warnc' }, t('btc.watchOnly')) : null,
    h('span', { class: 'ed-spacer' }), walletsOfNetwork().length > 1 ? linkTo('wallet', t('btc.allWallets')) : null),
    h('nav', { class: 'wu-subtabs' }, subs.map(([k, l]) => h('a', { href: '#/wallet/' + w.id + (k ? '/' + k : ''), class: (sub || '') === k ? 'wu-on' : '' }, t(l)))));
  const fn = { receive: renderReceive, send: renderSend, coins: renderCoins, addresses: renderAddresses, sign: renderSign, backup: renderBackup }[sub] || renderOverview;
  return fn(ctx, w);
}

function renderList(ctx, list) {
  const net = NETWORKS[settings.network];
  if (!list.length) {
    ctx.view.append(section(t('btc.welcome'), h('p', null, t('btc.welcomeText', { net: net.label })),
      h('div', { class: 'ap-row' }, button('btc.newWallet', 'plus', () => go('wallet/new/create'), 'primary'), button('btc.restoreWallet', 'key', () => go('wallet/new/restore')), button('btc.watchWallet', 'eye', () => go('wallet/new/watch'))),
      // Mainnet warning only on mainnet: test networks hold coins of no value.
      net.testnet ? null : h('div', { class: 'wu-warn-box wu-mt' }, iconEl('warn'), t('btc.mainnetWarn'))));
    return;
  }
  const items = list.map((w) => {
    const s = walletState(w);
    return h('a', { class: 'wu-item', href: '#/wallet/' + w.id }, iconEl(w.kind === 'watch' ? 'eye' : 'wallet'),
      h('div', { class: 'wu-item-main' }, h('b', null, w.name), h('span', { class: 'wu-small wu-muted' }, w.accounts.map((a) => typeLabel(a.type)).join(', '))),
      h('span', { class: 'wu-item-side' }, s.synced ? amt(s.total) : '—'));
  });
  ctx.view.append(section(t('btc.wallets', { net: net.label }), h('div', { class: 'wu-list' }, items),
    h('div', { class: 'ap-row wu-mt' }, button('btc.newWallet', 'plus', () => go('wallet/new/create'), 'primary'), button('btc.restoreWallet', 'key', () => go('wallet/new/restore')), button('btc.watchWallet', 'eye', () => go('wallet/new/watch')), button('wu.addressBook', 'users', () => go('wallet/book')))));
}

// --- new wallets ---

function nameField(def) {
  const i = h('input', { class: 'ed-input', value: def, maxlength: 60 });
  return { el: field('btc.walletName', i), value: () => i.value.trim() || def };
}

// Default: all four derivations, so restoring a phrase from any common wallet finds its funds.
const ALL_TYPES = ['p2wpkh', 'p2tr', 'p2sh-p2wpkh', 'p2pkh'];

function typesField() {
  const chosen = new Set(ALL_TYPES);
  const el = h('div', { class: 'wu-col wu-tight' }, h('span', { class: 'ed-label' }, t('btc.accountTypes')), ALL_TYPES.map((ty) => {
    const c = toggle(true, (on) => { if (on) chosen.add(ty); else chosen.delete(ty); });
    return h('label', { class: 'ed-field ed-field-check' }, c, h('span', null, typeLabel(ty)));
  }));
  return { el, value: () => ALL_TYPES.filter((x) => chosen.has(x)) };
}

function renderNew(ctx, kind) {
  const net = NETWORKS[settings.network];
  const back = linkTo('wallet', '← ' + t('btc.allWallets'));
  if (kind === 'create') {
    let words = 12;
    // The phrase is generated locally (bip39.js, crypto.getRandomValues entropy) and shown once.
    let phrase = generateMnemonic(words);
    const grid = h('div');
    const paint = () => { grid.textContent = ''; grid.append(mnemonicGrid(phrase)); };
    paint();
    const name = nameField(t('btc.defaultName'));
    const types = typesField();
    const pass = h('input', { class: 'ed-input', type: 'password', autocomplete: 'off' });
    const create = h('button', { type: 'button', class: 'ed-btn ed-primary' }, iconEl('check'), t('btc.backupDone'));
    // backupCheck makes the user re-enter chosen words before the wallet exists: an unverified backup is the most
    // common way to lose funds. The phrase variable and grid are cleared afterwards to drop references early.
    create.addEventListener('click', async () => {
      if (!(await backupCheck(phrase))) return;
      const w = await busy(create, createHdWallet({ name: name.value(), mnemonic: phrase, passphrase: pass.value, types: types.value() }));
      phrase = ''; grid.textContent = '';
      toast(t('btc.walletCreated'), 'ok');
      go('wallet/' + w.id + '/receive');
    });
    ctx.view.append(back, section(t('btc.newWallet'),
      h('p', null, t('btc.newText', { net: net.label })),
      // Changing the length generates a new phrase; never extend or truncate an existing one (the checksum would break).
      seg([{ v: 12, l: '=12' }, { v: 24, l: '=24' }], words, (v) => { words = v; phrase = generateMnemonic(words); paint(); }, 'btc.words'),
      grid, name.el, types.el,
      field('btc.passphrase', pass, 'btc.passphraseHint'),
      h('div', { class: 'ap-row' }, create)));
    return;
  }
  if (kind === 'restore') {
    const input = mnemonicInput();
    const name = nameField(t('btc.restoredName'));
    const types = typesField();
    const pass = h('input', { class: 'ed-input', type: 'password', autocomplete: 'off' });
    const btn = h('button', { type: 'button', class: 'ed-btn ed-primary' }, iconEl('key'), t('btc.restore'));
    btn.addEventListener('click', async () => {
      const st = input.state();
      // An invalid checksum may still be intentional (a phrase from a tool with another wordlist rule); allowed after an
      // explicit confirmation, never silently.
      if (!st.ok && !(await confirmDialog(t('btc.invalidPhrase'), t('btc.invalidPhraseText'), t('btc.restoreAnyway'), true))) return;
      if (!st.words.length) return;
      const w = await busy(btn, createHdWallet({ name: name.value(), mnemonic: st.phrase, passphrase: pass.value, types: types.value() }));
      go('wallet/' + w.id);
    });
    ctx.view.append(back, section(t('btc.restoreWallet'), h('p', null, t('btc.restoreText')), input, name.el, types.el, field('btc.passphrase', pass, 'btc.passphraseHint'), h('div', { class: 'ap-row' }, btn)));
    return;
  }
  // watch-only
  const ta = textInput('', () => {}, { multiline: true, rows: 4, class: 'ed-input ed-textarea wu-mono', placeholder: 'zpub… / wpkh([fingerprint/84h/0h/0h]xpub…/<0;1>/*) / bc1q… bc1q…' });
  const name = nameField(t('btc.watchName'));
  const err = h('div', { class: 'wu-error' });
  const btn = h('button', { type: 'button', class: 'ed-btn ed-primary' }, iconEl('eye'), t('btc.addWatch'));
  btn.addEventListener('click', () => {
    err.textContent = '';
    const text = ta.value.trim();
    try {
      let w;
      // Input detection order: extended key prefix (xpub/ypub/zpub/tpub...), then descriptor syntax "func(", then a list
      // of addresses (validated against the current network so a testnet address cannot enter a mainnet wallet).
      if (extendedKeyPrefix(text)) w = createWatchWallet({ name: name.value(), xpub: text });
      else if (/^[a-z_]+\(/.test(text)) {
        const lines = text.split(/\s*\n\s*/).filter(Boolean);
        w = createWatchWallet({ name: name.value(), receive: lines[0], change: lines[1] || null });
      } else {
        const addrs = text.split(/[\s,;]+/).filter(Boolean);
        const bad = addrs.find((a) => !isValidAddress(a, settings.network));
        if (!addrs.length || bad) throw new Error(t('btc.badAddress', { a: bad || '' }));
        w = createWatchWallet({ name: name.value(), addresses: addrs });
      }
      go('wallet/' + w.id);
    } catch (e) { err.textContent = e.message; }
  });
  ctx.view.append(back, section(t('btc.watchWallet'), h('p', null, t('btc.watchText')), field('btc.watchInput', ta), name.el, err, h('div', { class: 'ap-row' }, btn)));
}

// --- overview ---

async function renderOverview(ctx, w) {
  const box = h('div', { class: 'wu-col' });
  ctx.view.append(box);
  const paint = () => {
    box.textContent = '';
    const s = walletState(w);
    const src = source(w.network);
    const refresh = h('button', { type: 'button', class: 'ed-btn' }, iconEl('refresh'), t('btc.refresh'));
    // busy() disables the button while the promise runs; errors become toasts, the old data stays visible.
    refresh.addEventListener('click', () => busy(refresh, syncWallet(w, { force: true }).then(paint).catch((e) => toast(e.message, 'error'))));
    box.append(section(t('btc.balance'),
      h('div', { class: 'wu-amount' }, s.synced ? amt(s.total) : '—'),
      s.synced && s.unconfirmed ? h('div', { class: 'wu-small wu-muted' }, t('btc.pending', { amt: amt(s.unconfirmed, { sign: true }) })) : null,
      !src ? statusLine('info', OFFLINE ? t('btc.offlineNoSync') : t('btc.noServerText')) : null,
      s.errors.length ? statusLine('error', s.errors[0]) : null,
      h('div', { class: 'ap-row wu-mt' }, src ? refresh : null, button('btc.receive', 'download', () => go('wallet/' + w.id + '/receive'), 'primary'), button('btc.send', 'send', () => go('wallet/' + w.id + '/send')),
        !src && !OFFLINE ? button('btc.chooseServer', 'globe', () => go('settings')) : null)));
    if (s.series.length > 1) box.append(section(t('btc.balanceHistory'), lineChart({ points: s.series.map((p) => ({ x: p.time, y: p.balance })), step: true, yFormat: (v) => amt(v), xFormat: (x) => new Date(x * 1000).toLocaleDateString(lang()), label: t('btc.balanceHistory') })));
    box.append(section(t('btc.history'), historyList(w, s, paint)));
    box.append(section(t('btc.accounts'), h('div', { class: 'wu-list' }, w.accounts.map((a) => {
      const c = syncCache.get(a.id);
      return h('div', { class: 'wu-item' }, h('div', { class: 'wu-item-main' }, h('b', null, (a.label || typeLabel(a.type)) + (a.index ? ` #${a.index}` : '')), a.xpub ? h('span', { class: 'wu-mono wu-small wu-break' }, short(a.xpub, 14, 10)) : null),
        h('span', { class: 'wu-item-side' }, c && c.scan ? amt(c.scan.balance.total) : '—'));
    })), w.kind === 'hd' ? h('div', { class: 'ap-row wu-mt' }, button('btc.addAccount', 'plus', async () => {
      const type = await chooseType();
      if (!type) return;
      // Next account index per type: highest existing + 1 (Math.max(-1, ...) gives 0 for the first one).
      const index = Math.max(-1, ...w.accounts.filter((a) => a.type === type).map((a) => a.index)) + 1;
      await addHdAccount(w, type, index);
      paint();
    })) : null));
  };
  paint();
  // First visit without a scan: background sync, then repaint only if this view is still the current one.
  if (source(w.network) && !walletState(w).synced) syncWallet(w).then(() => ctx.alive() && paint()).catch((e) => ctx.alive() && (paint(), toast(e.message, 'error')));
}

async function chooseType() {
  const s = select(ALL_TYPES.map((x) => ({ v: x, l: '=' + typeLabel(x) })), 'p2wpkh', () => {});
  const v = await openDialog({ title: t('btc.addAccount'), body: field('btc.accountType', s), buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), primary: true, value: 'ok' }] });
  return v === 'ok' ? s.value : null;
}

function historyList(w, s, repaint) {
  if (!s.history.length) return h('div', { class: 'ap-empty' }, s.synced ? t('btc.noTx') : t('btc.notSynced'));
  // History capped at 200 rows: rendering thousands of DOM rows would stall the UI; the explorer shows the rest.
  const list = h('div', { class: 'wu-list' }, s.history.slice(0, 200).map((x) => h('div', { class: 'wu-item', tabindex: '0', dataset: { txid: x.txid } },
    iconEl(x.type === 'receive' ? 'download' : x.type === 'self' ? 'refresh' : 'send'),
    h('div', { class: 'wu-item-main' }, h('span', null, labelOf('tx', x.txid) || t('btc.tx.' + x.type)),
      h('span', { class: 'wu-small wu-muted' }, x.confirmed ? ago(x.time, lang()) : t('btc.unconfirmed'), ' · ', mono(short(x.txid, 8, 6)))),
    h('span', { class: 'wu-item-side ' + (x.net > 0 ? 'wu-pos' : '') }, amt(x.net, { sign: true }), x.fee ? h('div', { class: 'wu-small wu-muted' }, t('btc.feeShort', { fee: amt(x.fee) })) : null))));
  contextMenu(list, (el) => {
    const x = s.history.find((y) => y.txid === el.dataset.txid);
    if (!x) return null;
    return [
      OFFLINE ? null : { label: t('btc.openExplorer'), icon: 'search', action: () => go('explorer/tx/' + x.txid) },
      { label: t('btc.copyTxid'), icon: 'copy', action: () => copyText(x.txid) },
      { label: t('btc.editLabel'), icon: 'tag', action: async () => { const v = await promptDialog(t('btc.editLabel'), t('btc.label'), labelOf('tx', x.txid)); if (v !== null) { setLabel('tx', x.txid, v); repaint(); } } },
      // Fee bumping is offered only where it can work: unconfirmed, opted into RBF (BIP 125), sent by us (we must
      // re-sign), HD wallet (keys available). CPFP: an unconfirmed incoming output we can spend in a child transaction.
      !x.confirmed && x.type !== 'receive' && x.rbf && w.kind === 'hd' ? { label: t('btc.bumpFee'), icon: 'zap', action: () => bumpDialog(w, x.txid).then(repaint) } : null,
      !x.confirmed && x.received > 0 && w.kind === 'hd' ? { label: t('btc.cpfp'), icon: 'zap', action: () => cpfpDialog(w, x.txid).then(repaint) } : null,
    ].filter(Boolean);
  }, { selector: '.wu-item', label: t('btc.history') });
  list.addEventListener('dblclick', (e) => { const el = e.target.closest('.wu-item'); if (el && !OFFLINE) go('explorer/tx/' + el.dataset.txid); });
  return list;
}

// --- receive ---

function renderReceive(ctx, w) {
  const accs = w.accounts;
  let acc = accs[0];
  // Start at the first unused address after sync (address reuse harms privacy); index 0 before any sync.
  let index = nextIndex(w, acc);
  let amount = '', label = '', message = '';
  const out = h('div', { class: 'wu-col wu-center' });
  const paint = () => {
    out.textContent = '';
    const a = accountOf(w, acc);
    const address = a.address(0, index);
    let sats = null;
    // An unparsable amount just drops the amount from the URI instead of blocking the QR.
    try { sats = amount ? parseAmount(amount) : null; } catch { sats = null; }
    const uri = formatBitcoinURI({ address, amount: sats, label, message });
    // Two URIs: the copy version keeps the address case; the QR version (qr:true) uses uppercase where allowed so the
    // QR fits the denser alphanumeric mode.
    out.append(qrElement(formatBitcoinURI({ address, amount: sats, label, message }, { qr: true }), { size: 240, label: address }),
      h('div', { class: 'wu-mono wu-break wu-center', style: { fontSize: '15px' } }, address),
      h('div', { class: 'wu-small wu-muted' }, acc.type === 'addresses' ? t('btc.watchAddress') : `${typeLabel(acc.type)} · ${t('btc.indexN', { n: index })}`),
      labelOf('addr', address) ? h('div', null, h('span', { class: 'wu-pill' }, labelOf('addr', address))) : null,
      h('div', { class: 'ap-row' }, button('ap.copy', 'copy', () => copyText(address)), button('btc.copyUri', 'link', () => copyText(uri)), button('btc.enlarge', 'qr', () => showQr(uri, { title: t('btc.receive'), caption: address })),
        // "Next address" moves past the scanned range locally. Caveat: handing out more than gapLimit unused addresses in a
        // row means a restore with the default gap limit will not find funds sent to the later ones.
        acc.type !== 'addresses' ? button('btc.nextAddress', 'refresh', () => { index++; paint(); }) : null,
        button('btc.labelAddress', 'tag', async () => { const v = await promptDialog(t('btc.labelAddress'), t('btc.label'), labelOf('addr', address)); if (v !== null) { setLabel('addr', address, v); paint(); } })));
    if (w.kind === 'hd' && !OFFLINE) out.append(h('p', { class: 'wu-small wu-muted' }, t('btc.receiveNote')));
  };
  const accSel = select(accs.map((a, i) => ({ v: i, l: '=' + (a.label || typeLabel(a.type)) + (a.index ? ' #' + a.index : '') })), 0, (v) => { acc = accs[+v]; index = acc.type === 'addresses' ? 0 : nextIndex(w, acc); paint(); });
  const amountIn = textInput('', (v) => { amount = v; paint(); }, { inputmode: 'decimal', placeholder: '0.00', 'aria-label': t('btc.amount') });
  ctx.view.append(h('div', { class: 'wu-grid2' },
    section(t('btc.receive'), out),
    section(t('btc.request'), field('btc.account', accSel), field('=' + t('btc.amount') + ' (' + settings.unit + ')', amountIn),
      field('btc.label', textInput('', (v) => { label = v; paint(); })), field('btc.message', textInput('', (v) => { message = v; paint(); })))));
  paint();
  // After the background sync the index only moves forward: never jump back to an address already shown to someone.
  if (source(w.network) && !syncCache.get(acc.id)) syncWallet(w).then(() => { if (ctx.alive() && acc.type !== 'addresses') { index = Math.max(index, nextIndex(w, acc)); paint(); } }).catch(() => {});
}

// --- coins (UTXOs) ---

function renderCoins(ctx, w) {
  const box = h('div', { class: 'wu-col' });
  ctx.view.append(box);
  const selected = new Set();
  const paint = () => {
    box.textContent = '';
    const s = walletState(w);
    if (!s.synced) { box.append(section(t('btc.coins'), h('div', { class: 'ap-empty' }, source(w.network) ? t('btc.notSynced') : t('btc.noServerText')))); return; }
    // Largest coins first: the order coin control usually needs. Frozen coins cannot be ticked (disabled checkbox).
    const rows = [...s.utxos].sort((a, b) => b.value - a.value);
    const total = rows.reduce((x, u) => x + u.value, 0);
    const key = (u) => u.txid + ':' + u.vout;
    const table = h('table', { class: 'ap-table' }, h('thead', null, h('tr', null, h('th', null, ''), h('th', null, t('btc.amount')), h('th', null, t('btc.address')), h('th', null, t('btc.label')), h('th', null, t('btc.confs')))),
      h('tbody', null, rows.map((u) => {
        const cb = h('input', { type: 'checkbox', checked: selected.has(key(u)), disabled: u.frozen, 'aria-label': key(u), onchange: () => { if (cb.checked) selected.add(key(u)); else selected.delete(key(u)); sum.textContent = selSum(); } });
        return h('tr', { dataset: { k: key(u) } }, h('td', null, cb), h('td', null, amt(u.value)), h('td', null, mono(short(u.address, 10, 8))),
          h('td', null, u.frozen ? h('span', { class: 'wu-pill wu-warnc' }, t('btc.frozen')) : null, ' ', u.label || ''),
          // Confirmations = tip - height + 1 (the block containing the tx counts as one).
          h('td', null, u.confirmed && s.tip ? String(s.tip - u.height + 1) : t('btc.unconfirmed')));
      })));
    const selSum = () => t('btc.selected', { n: selected.size, amt: amt(rows.filter((u) => selected.has(key(u))).reduce((x, u) => x + u.value, 0)) });
    const sum = h('span', { class: 'wu-small' }, selSum());
    contextMenu(table, (tr) => {
      const u = rows.find((x) => key(x) === tr.dataset.k);
      if (!u) return null;
      return [
        // Freeze / unfreeze = BIP-329 output record with spendable:false/true; the coin is deselected immediately.
        { label: u.frozen ? t('btc.unfreeze') : t('btc.freeze'), icon: u.frozen ? 'unlock' : 'lock', action: () => { setLabel('output', key(u), labelOf('output', key(u)), { spendable: !!u.frozen }); selected.delete(key(u)); paint(); } },
        { label: t('btc.editLabel'), icon: 'tag', action: async () => { const v = await promptDialog(t('btc.editLabel'), t('btc.label'), labelOf('output', key(u))); if (v !== null) { setLabel('output', key(u), v, u.frozen ? { spendable: false } : {}); paint(); } } },
        OFFLINE ? null : { label: t('btc.openExplorer'), icon: 'search', action: () => go('explorer/tx/' + u.txid) },
      ].filter(Boolean);
    }, { selector: 'tbody tr' });
    box.append(section(t('btc.coinsN', { n: rows.length, amt: amt(total) }), h('div', { class: 'ap-table-wrap' }, table),
      // Note: `w.kind === 'hd' || true` is always true; watch-only wallets may also spend selected coins (send.js builds
      // an unsigned PSBT for an external signer), so the condition is dead code kept from an earlier version.
      h('div', { class: 'ap-row wu-mt' }, sum, h('span', { class: 'ed-spacer' }), w.kind === 'hd' || true ? button('btc.spendSelected', 'send', () => {
        if (!selected.size) { toast(t('btc.selectCoins'), 'warn'); return; }
        // Selected coins travel to the send view in the route query, so a reload keeps the selection.
        go('wallet/' + w.id + '/send?coins=' + encodeURIComponent([...selected].join(',')));
      }, 'primary') : null)));
  };
  paint();
  if (source(w.network) && !walletState(w).synced) syncWallet(w).then(() => ctx.alive() && paint()).catch((e) => toast(e.message, 'error'));
}

// --- addresses ---

function renderAddresses(ctx, w) {
  for (const acc of w.accounts) {
    const a = accountOf(w, acc);
    const c = syncCache.get(acc.id);
    const used = new Map(c && c.scan ? c.scan.addresses.map((x) => [x.chain + ':' + x.index, x]) : []);
    const rows = [];
    const chains = acc.type === 'addresses' ? [0] : [0, 1];
    for (const chain of chains) {
      // Show the used range plus a margin of 5 unused addresses (at least 10), like most wallets' address lists.
      const n = acc.type === 'addresses' ? acc.addresses.length : Math.max(nextIndex(w, acc, chain) + 5, 10);
      for (let i = 0; i < n; i++) {
        const addr = a.address(chain, i);
        const u = used.get(chain + ':' + i);
        rows.push(h('tr', null, h('td', null, chain ? t('btc.change') : t('btc.receive')), h('td', null, String(i)), h('td', null, copyable(addr)),
          h('td', null, u ? (u.used ? amt(u.balance) : t('btc.unused')) : '—'), h('td', null, labelOf('addr', addr))));
      }
    }
    ctx.view.append(section(acc.label || typeLabel(acc.type), h('div', { class: 'ap-table-wrap' }, h('table', { class: 'ap-table' },
      h('thead', null, h('tr', null, h('th', null, t('btc.chain')), h('th', null, '#'), h('th', null, t('btc.address')), h('th', null, t('btc.balance')), h('th', null, t('btc.label')))), h('tbody', null, rows)))));
  }
}

// --- messages ---

function renderSign(ctx, w) {
  const addrIn = textInput('', () => {}, { class: 'ed-input wu-mono', placeholder: 'bc1q…' });
  const msgIn = textInput('', () => {}, { multiline: true, rows: 4 });
  const fmt = select([{ v: 'auto', l: 'btc.fmtAuto' }, { v: 'legacy', l: 'btc.fmtLegacy' }, { v: 'bip322', l: 'btc.fmtBip322' }], 'auto', () => {});
  const out = textInput('', () => {}, { multiline: true, rows: 3, class: 'ed-input ed-textarea wu-mono', readonly: true });
  if (w.accounts[0] && w.accounts[0].type !== 'addresses') addrIn.value = accountOf(w, w.accounts[0]).address(0, 0);
  const signBtn = h('button', { type: 'button', class: 'ed-btn ed-primary' }, iconEl('edit'), t('btc.sign'));
  signBtn.addEventListener('click', () => busy(signBtn, (async () => {
    const address = addrIn.value.trim();
    const key = await findKey(w, address);
    if (!key) { toast(t('btc.notOurAddress'), 'error'); return; }
    const d = decodeAddress(address, w.network);
    // Legacy (BIP-137) message signatures only exist for single-key types; everything else needs BIP-322.
    // "auto" picks legacy for P2PKH (what verifiers of old addresses expect) and BIP-322 otherwise.
    const legacyType = d.type === 'p2pkh' ? 'p2pkh' : d.type === 'p2wpkh' ? 'p2wpkh' : d.type === 'p2sh' ? 'p2sh-p2wpkh' : null;
    const useLegacy = fmt.value === 'legacy' || (fmt.value === 'auto' && d.type === 'p2pkh');
    if (useLegacy && !legacyType) { toast(t('btc.legacyUnsupported'), 'error'); return; }
    out.value = useLegacy ? signMessage(msgIn.value, key, { type: legacyType }) : bip322Sign(msgIn.value, key, address, { network: w.network });
  })().catch((e) => toast(e.message, 'error'))));
  const vAddr = textInput('', () => {}, { class: 'ed-input wu-mono' });
  const vMsg = textInput('', () => {}, { multiline: true, rows: 3 });
  const vSig = textInput('', () => {}, { multiline: true, rows: 2, class: 'ed-input ed-textarea wu-mono' });
  const vOut = h('div');
  const verifyBtn = button('btc.verify', 'check', () => {
    const r = verifyMessage(vMsg.value, vAddr.value.trim(), vSig.value.trim(), { network: w.network });
    vOut.textContent = '';
    vOut.append(statusLine(r.valid ? 'ok' : 'error', r.valid ? t('btc.sigValid', { format: r.format }) : t('btc.sigInvalid', { error: r.error || '' })));
  });
  ctx.view.append(h('div', { class: 'wu-grid2' },
    section(t('btc.signMessage'), w.kind === 'watch' ? statusLine('info', t('btc.watchCannotSign')) : null, field('btc.address', addrIn), field('btc.message', msgIn), field('btc.format', fmt), h('div', { class: 'ap-row' }, signBtn), field('btc.signature', out)),
    section(t('btc.verifyMessage'), field('btc.address', vAddr), field('btc.message', vMsg), field('btc.signature', vSig), h('div', { class: 'ap-row' }, verifyBtn), vOut)));
}

// The private key of one of the wallet's addresses (searches the first 200 receive / change indexes).
// Linear search over derived addresses: fine for an interactive action; addresses beyond index 199 cannot sign
// messages here. The key is derived from the cached master along the PSBT derivation path of that address.
export async function findKey(w, address) {
  if (w.kind !== 'hd') return null;
  const m = await masterOf(w);
  for (const acc of w.accounts) {
    if (acc.type === 'addresses') continue;
    const a = accountOf(w, acc);
    for (const chain of [0, 1]) for (let i = 0; i < 200; i++) {
      if (a.address(chain, i) === address) {
        const d = a.spendInfo(chain, i);
        const path = (d.bip32Derivation || d.tapBip32Derivation)[0].path;
        let k = m;
        for (const p of path) k = k.deriveChild(p);
        return k.privateKey;
      }
    }
  }
  return null;
}

// --- address book ---

function renderBook(ctx) {
  ctx.view.append(linkTo('wallet', '← ' + t('btc.allWallets')), section(t('wu.addressBook'), addressBookView({
    entries: vault.data.book,
    validate: (a) => (isValidAddress(a, settings.network) ? null : t('btc.badAddress', { a })),
    onChange: () => saveVault(),
  })));
}

// --- backup and export ---

function renderBackup(ctx, w) {
  if (w.kind === 'hd') {
    // Re-asks the password even though the vault is unlocked: an unlocked laptop left alone must not reveal the phrase.
    // The check decrypts the stored envelope with the typed password; success is the proof.
    const reveal = button('btc.showPhrase', 'eye', async () => {
      const pw = h('input', { type: 'password', class: 'ed-input', autocomplete: 'current-password' });
      const ok = await openDialog({ title: t('btc.showPhrase'), body: field('wu.password', pw), buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('dlg.ok'), primary: true, value: 'ok' }] });
      if (ok !== 'ok') return;
      try {

        await openVault(vault.exportEnvelope(), pw.value);
      } catch { toast(t('wu.wrongPassword'), 'error'); return; }
      await openDialog({ title: t('btc.recoveryPhrase'), body: h('div', { class: 'wu-col' }, mnemonicGrid(w.mnemonic, { hidden: false }), w.passphrase ? statusLine('warn', t('btc.hasPassphrase')) : null), wide: true });
    });
    ctx.view.append(section(t('btc.recoveryPhrase'), h('p', null, t('btc.phraseBackupText')), h('div', { class: 'ap-row' }, reveal),
      w.fingerprint ? kv([[t('btc.fingerprint'), mono(w.fingerprint)]]) : null));
  }
  // Descriptors and xpubs are public but privacy-sensitive (they reveal all addresses); shown for watch-only export.
  for (const acc of w.accounts) {
    if (acc.type === 'addresses') continue;
    const desc = accountOf(w, acc).descriptor();
    const text = Array.isArray(desc) ? desc.join('\n') : desc;
    ctx.view.append(section(acc.label || typeLabel(acc.type),
      acc.xpub ? field('btc.xpub', h('div', { class: 'ap-row wu-nowrap' }, h('span', { class: 'wu-mono wu-break wu-small' }, acc.xpub), button('', 'copy', () => copyText(acc.xpub)), button('', 'qr', () => showQr(acc.xpub, { title: 'xpub' })))) : null,
      field('btc.descriptor', h('div', { class: 'ap-row wu-nowrap' }, h('span', { class: 'wu-mono wu-break wu-small' }, text), button('', 'copy', () => copyText(text)), button('', 'qr', () => showQr(text, { title: t('btc.descriptor') })))),
      h('p', { class: 'wu-small wu-muted' }, t('btc.watchExportNote'))));
  }
  const rename = button('btc.rename', 'edit', async () => { const v = await promptDialog(t('btc.rename'), t('btc.walletName'), w.name); if (v) { w.name = v; saveVault(); ctx.rerender(); } });
  const del = button('btc.deleteWallet', 'trash', async () => {
    if (await confirmDialog(t('btc.deleteWallet'), w.kind === 'hd' ? t('btc.deleteHdText') : t('btc.deleteWatchText'), t('dlg.delete'), true)) { deleteWallet(w.id); go('wallet'); }
  }, 'danger');
  // KNOWN DEFECT: exports the labels of every wallet in the vault, while the file is named after the current wallet.
  // Fix: filter vault.data.labels to this wallet's txids / addresses / outputs, or name the file after the vault.
  const labels = button('btc.exportLabels', 'download', async () => {

    download(exportLabels(vault.data.labels), `${w.name}-labels.jsonl`, 'application/jsonl');
  });
  // Watch-only registration with this site's backend: only public descriptors / addresses are sent.
  // The owner token is asked for each time and not stored: it grants write access to the server's watch list.
  const watch = backendInfo && backendInfo.network === w.network ? button('btc.serverWatch', 'eye', async () => {
    const tok = await promptDialog(t('btc.serverWatch'), t('btc.serverToken'), '');
    if (tok === null) return;
    try {
      for (const acc of w.accounts) {
        const body = acc.type === 'addresses' ? { label: w.name, addresses: acc.addresses } : { label: w.name + ' · ' + typeLabel(acc.type), descriptors: [acc.receive, acc.change].filter(Boolean) };
        await backendCall('watch', { method: 'POST', body, token: tok });
      }
      toast(t('btc.serverWatchOk'), 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }) : null;
  ctx.view.append(section(t('btc.manage'), h('div', { class: 'ap-row' }, rename, labels, watch, del), watch ? h('p', { class: 'wu-small wu-muted' }, t('btc.serverWatchNote')) : null));
}

export { parseDescriptor };
