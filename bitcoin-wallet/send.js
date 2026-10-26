// bitcoin-wallet/send.js - sending: recipients (address book, QR / BIP-21), amounts or "send everything", the fee rate
// from the server's estimates or typed, coin control, replace-by-fee, the review of the transaction, then signing in
// this browser and broadcasting — or a PSBT (file, Base64, QR) for an air-gapped signer; fee bumping (RBF) and
// child-pays-for-parent.
//
// Flow: form state (recipients, fee mode, RBF) -> createSpend() (bitcoin/spend.js: coin selection, change, fee, a
// PSBT) -> review (amounts, fee, the full decoded transaction) -> one of three exits: sign + broadcast here, sign +
// export the raw tx (broadcast elsewhere), or export the unsigned PSBT for an air-gapped / hardware signer.
// Nothing is signed before the review: the user sees exactly the transaction that will be signed.
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { button, copyText, download, field, seg, toggle } from '../ui/app.js';
import { openDialog, toast } from '../ui/overlays.js';
import { iconEl } from '../ui/icons.js';
import { bytesToHex, hexToBytes } from '../crypto/encoding.js';
import { isValidAddress, toOutputScript } from '../bitcoin/address.js';
import { parseBitcoinURI } from '../bitcoin/uri.js';
import { createSpend, bumpFee, cpfp } from '../bitcoin/spend.js';
import { pickFeeRates } from '../bitcoin/fees.js';
import { Transaction } from '../bitcoin/tx.js';
import { classify } from '../bitcoin/script.js';
import { scanQr, showQr } from '../walletui/qr.js';
import { pickContact } from '../walletui/addressbook.js';
import { section, go, busy, statusLine, OFFLINE } from '../walletui/shell.js';
import { settings, vault, accountOf, masterOf, source, syncCache } from './state.js';
import { amt, parseAmount, walletState, nextIndex, txView, syncWallet } from './common.js';

// The change address: the next unused change address of the first account that has a change chain.
// Fresh change per transaction (not a fixed address) so outputs cannot be linked by address reuse.
function changeInfo(w) {
  const acc = w.accounts.find((a) => a.type !== 'addresses' && a.change) || null;
  if (!acc) return null;
  return accountOf(w, acc).spendInfo(1, nextIndex(w, acc, 1));
}

// Full previous transactions for legacy inputs (BIP-174 needs them to sign).
// Legacy sighash does not commit to input amounts, so a signer must see the full previous tx to verify the value
// it is spending (otherwise a host could lie about fees). Segwit inputs (incl. nested P2SH-P2WPKH, detected by a
// redeem script starting with OP_0) commit to amounts and need only the prevout.
async function withPrevTxs(w, coins) {
  const src = source(w.network);
  for (const u of coins) {
    const c = classify(u.script).type;
    const segwit = c === 'p2wpkh' || c === 'p2tr' || c === 'p2wsh' || (c === 'p2sh' && u.spendInfo && u.spendInfo.witnessScript) || (c === 'p2sh' && u.spendInfo && u.spendInfo.redeemScript && u.spendInfo.redeemScript[0] === 0);
    if (!segwit && !u.prevTx && src) u.prevTx = Transaction.fromHex(await src.txHex(u.txid));
  }
  return coins;
}

export async function renderSend(ctx, w) {
  const s = walletState(w);
  const src = source(w.network);
  const recipients = [{ address: '', amount: '', max: false }];
  // Coin control preset from the coins view (route query); unknown or frozen coins silently drop out below.
  const preset = (ctx.route.query.get('coins') || '').split(',').filter(Boolean);
  let feeMode = 'normal', customRate = '', rbf = true;
  let rates = null;
  const form = h('div', { class: 'wu-col' });
  const review = h('div', { class: 'wu-col' });
  ctx.view.append(h('div', { class: 'wu-grid2' }, section(t('btc.send'), form), h('div', { class: 'wu-col' }, review)));
  // Sending needs a fresh UTXO set; a stale one would build a transaction spending already-spent coins.
  if (!s.synced && src) {
    form.append(statusLine('info', t('btc.syncing')));
    try { await syncWallet(w); } catch (e) { form.textContent = ''; form.append(statusLine('error', e.message)); return; }
    if (!ctx.alive()) return;
  }
  if (src) { try { rates = pickFeeRates(await src.feeEstimates()); } catch { rates = null; } }
  const st = walletState(w);
  // Spendable = not frozen AND has signing info (HD accounts); address-only watch coins are excluded.
  const spendable = st.utxos.filter((u) => !u.frozen && u.spendInfo);
  const chosen = preset.length ? spendable.filter((u) => preset.includes(u.txid + ':' + u.vout)) : [];
  const paint = () => {
    form.textContent = '';
    if (!st.synced) form.append(statusLine('info', OFFLINE ? t('btc.offlineSend') : t('btc.noServerText')));
    recipients.forEach((r, i) => {
      const addr = h('input', { class: 'ed-input wu-mono', value: r.address, placeholder: t('btc.addressOrUri'), autocomplete: 'off', spellcheck: 'false', 'aria-label': t('btc.recipient') });
      const amount = h('input', { class: 'ed-input', value: r.amount, inputmode: 'decimal', placeholder: '0.00', disabled: r.max, 'aria-label': t('btc.amount') });
      addr.addEventListener('change', () => {
        const v = addr.value.trim();
        if (/^bitcoin:/i.test(v)) {
          // BIP-21 URIs are accepted in the address field and split into address + amount.
          // KNOWN DEFECT: the amount is written as a BTC decimal (u.amount / 1e8) but parsed later in settings.unit, so with
          // mBTC / bits / sat selected the amount is off by a factor; tiny amounts also stringify as "1e-8". Fix: format with
          // formatBtc(u.amount, { unit: settings.unit }) (bitcoin/units.js).
          try { const u = parseBitcoinURI(v, { network: w.network }); r.address = u.address; if (u.amount) r.amount = (u.amount / 1e8).toString(); paint(); return; } catch (e) { toast(e.message, 'error'); }
        }
        r.address = v;
      });
      amount.addEventListener('input', () => { r.amount = amount.value; });
      // Only one recipient may take "everything else" (max): the remainder after other outputs and the fee.
      const maxT = toggle(r.max, (on) => { recipients.forEach((x) => { x.max = false; }); r.max = on; paint(); });
      form.append(h('div', { class: 'wu-col wu-recipient' },
        h('div', { class: 'ap-row' }, h('b', null, t('btc.recipientN', { n: i + 1 })), h('span', { class: 'ed-spacer' }),
          h('button', { type: 'button', class: 'ed-iconbtn', title: t('wu.addressBook'), 'aria-label': t('wu.addressBook'), onclick: async () => { const c = await pickContact(vault.data.book); if (c) { r.address = c.address; paint(); } } }, iconEl('users')),
          OFFLINE ? null : h('button', { type: 'button', class: 'ed-iconbtn', title: t('wu.scan'), 'aria-label': t('wu.scan'), onclick: async () => { const text = await scanQr(); if (text) { addr.value = text; addr.dispatchEvent(new Event('change')); } } }, iconEl('scan')),
          recipients.length > 1 ? h('button', { type: 'button', class: 'ed-iconbtn', title: t('dlg.delete'), 'aria-label': t('dlg.delete'), onclick: () => { recipients.splice(i, 1); paint(); } }, iconEl('trash')) : null),
        addr, h('div', { class: 'ap-row wu-nowrap' }, amount, h('span', { class: 'wu-muted' }, settings.unit), h('label', { class: 'ed-field ed-field-check' }, maxT, h('span', null, t('btc.max'))))));
    });
    form.append(h('div', { class: 'ap-row' }, button('btc.addRecipient', 'plus', () => { recipients.push({ address: '', amount: '', max: false }); paint(); })));
    // Fee presets come from the server's estimates (fastest / ~1 hour / economy); without a server only a custom rate.
    const opts = rates ? [{ v: 'fast', l: '=' + t('btc.feeFast') + ` ${rates.fastest}` }, { v: 'normal', l: '=' + t('btc.feeNormal') + ` ${rates.hour}` }, { v: 'slow', l: '=' + t('btc.feeSlow') + ` ${rates.economy}` }, { v: 'custom', l: 'btc.feeCustom' }] : [{ v: 'custom', l: 'btc.feeCustom' }];
    if (!rates) feeMode = 'custom';
    const custom = h('input', { class: 'ed-input', value: customRate, inputmode: 'decimal', placeholder: 'sat/vB', 'aria-label': t('btc.feeRate'), hidden: feeMode !== 'custom' });
    custom.addEventListener('input', () => { customRate = custom.value; });
    form.append(field('btc.feeRateLabel', h('div', { class: 'wu-col' }, seg(opts, feeMode, (v) => { feeMode = v; custom.hidden = v !== 'custom'; }), custom)));
    form.append(h('label', { class: 'ed-field ed-field-check' }, toggle(rbf, (v) => { rbf = v; }), h('span', null, t('btc.rbfLabel'))));
    form.append(h('div', { class: 'wu-small wu-muted' }, chosen.length ? t('btc.coinControlOn', { n: chosen.length, amt: amt(chosen.reduce((x, u) => x + u.value, 0)) }) : t('btc.coinControlOff', { amt: amt(spendable.reduce((x, u) => x + u.value, 0)) }), ' ',
      h('a', { href: '#/wallet/' + w.id + '/coins', class: 'wu-link' }, t('btc.chooseCoins'))));
    const err = h('div', { class: 'wu-error', role: 'alert' });
    const go2 = h('button', { type: 'button', class: 'ed-btn ed-primary' }, iconEl('check'), t('btc.review'));
    go2.addEventListener('click', () => busy(go2, buildAndReview(err)));
    form.append(err, h('div', { class: 'ap-row' }, go2));
  };
  const rate = () => {
    // Minimum 1 sat/vB: the default minimum relay fee; a lower rate would not propagate.
    if (feeMode === 'custom') { const r = Number(String(customRate).replace(',', '.')); if (!(r >= 1)) throw new Error(t('btc.badFeeRate')); return r; }
    return { fast: rates.fastest, normal: rates.hour, slow: rates.economy }[feeMode];
  };
  async function buildAndReview(err) {
    err.textContent = '';
    review.textContent = '';
    try {
      const recs = recipients.map((r) => {
        if (!isValidAddress(r.address, w.network)) throw new Error(t('btc.badAddress', { a: r.address }));
        return r.max ? { address: r.address, max: true } : { address: r.address, value: parseAmount(r.amount) };
      });
      if (!spendable.length) throw new Error(t('btc.noCoins'));
      const coins = await withPrevTxs(w, chosen.length ? chosen : spendable);
      // onlyInclude: with coin control the selection must use exactly the chosen coins, never add others silently.
      const r = createSpend({ utxos: coins, include: chosen.length ? coins : [], onlyInclude: !!chosen.length, recipients: recs, feeRate: rate(), change: changeInfo(w), network: w.network, rbf });
      showReview(w, r, review, ctx);
    // Typed errors from spend.js map to translated messages; dust = an output below the relay dust threshold.
    } catch (e) { err.textContent = e.code === 'insufficient' ? t('btc.insufficient', { have: amt(e.available || 0) }) : e.code === 'dust' ? t('btc.dust', { dust: e.dust }) : e.message; }
  }
  paint();
}

function showReview(w, r, box, ctx) {
  const tx = r.psbt.tx();
  const prevouts = r.inputs.map((u) => ({ value: u.value, script: u.script }));
  const own = walletState(w).own;
  const sendBtn = h('button', { type: 'button', class: 'ed-btn ed-primary' }, iconEl('send'), t('btc.signSend'));
  sendBtn.addEventListener('click', () => busy(sendBtn, signAndSend(w, r.psbt, ctx)));
  const signOnly = button('btc.signExport', 'download', async () => {
    const tx2 = await signPsbt(w, r.psbt);
    exportTx(tx2);
  });
  const psbtBtn = button('btc.exportPsbt', 'qr', () => exportPsbt(r.psbt));
  box.append(section(t('btc.reviewTitle'),
    h('div', { class: 'ap-kv-wrap' }, h('dl', { class: 'ap-kv' },
      // "Sending" excludes the change output, so the figure is what leaves the wallet to recipients.
      h('dt', null, t('btc.sending')), h('dd', null, amt(r.outputs.filter((o, i) => !r.change || i !== r.change.index).reduce((x, o) => x + o.value, 0))),
      h('dt', null, t('btc.fee')), h('dd', null, `${amt(r.fee)} · ${r.feeRate.toFixed(2)} sat/vB · ${r.vsize} vB`),
      h('dt', null, t('btc.change')), h('dd', null, r.change ? amt(r.change.value) : t('btc.noChange')),
      h('dt', null, t('btc.coinsUsed')), h('dd', null, `${r.inputs.length} (${r.algorithm})`))),
    // Fee above 5% of the outputs: a heuristic warning for fat-fingered custom rates or many tiny inputs.
    r.fee > 0.05 * r.outputs.reduce((x, o) => x + o.value, 0) ? statusLine('warn', t('btc.highFee')) : null,
    // Watch-only wallets get only the PSBT export: no keys to sign with, by design.
    h('div', { class: 'ap-row wu-mt' }, w.kind === 'hd' && source(w.network) ? sendBtn : null, w.kind === 'hd' ? signOnly : null, psbtBtn)));
  box.append(txView(tx, { prevouts, own, network: w.network, link: false }));
}

// signAll returns the number of inputs signed with keys derived from this master; 0 means the PSBT belongs to
// another wallet. finalizeAll builds scriptSig / witness; a failure means some input still lacks a signature.
export async function signPsbt(w, psbt) {
  const m = await masterOf(w);
  const n = psbt.signAll(m);
  if (!n) throw new Error(t('btc.nothingSigned'));
  if (!psbt.finalizeAll()) throw new Error(t('btc.notFinal'));
  return psbt.extract();
}

async function signAndSend(w, psbt, ctx) {
  try {
    const tx = await signPsbt(w, psbt);
    const txid = await source(w.network).broadcast(tx.toHex());
    // Invalidate the sync throttle so the next view refreshes and shows the new transaction immediately.
    for (const a of w.accounts) { const c = syncCache.get(a.id); if (c) c.at = 0; }
    toast(t('btc.sent', { txid: txid.slice(0, 12) }), 'ok');
    await openDialog({ title: t('btc.sentTitle'), body: h('div', { class: 'wu-col' }, statusLine('ok', t('btc.sentText')), h('div', { class: 'wu-mono wu-break wu-small', 'data-txid': txid }, txid)),
      buttons: [{ label: t('btc.openExplorer'), value: 'x' }, { label: t('dlg.close'), value: null, primary: true }] }).then((v) => { if (v === 'x') go('explorer/tx/' + txid); else if (ctx.alive()) go('wallet/' + w.id); });
  } catch (e) { toast(e.message, 'error'); }
}

// PSBT as Base64 (copy / QR) and binary .psbt (BIP-174 file format) for signers that import files.
export function exportPsbt(psbt, name = 'transaction') {
  const b64 = psbt.toBase64();
  return openDialog({
    title: t('btc.psbtTitle'),
    body: h('div', { class: 'wu-col' }, h('p', { class: 'wu-small' }, t('btc.psbtText')), h('textarea', { class: 'ed-input ed-textarea wu-mono', rows: 5, readonly: true }, b64)),
    buttons: [
      { label: t('ap.copy'), onClick: () => { copyText(b64); return false; } },
      { label: t('btc.downloadPsbt'), onClick: () => { download(psbt.toBytes(), name + '.psbt', 'application/octet-stream'); return false; } },
      { label: 'QR', onClick: () => { showQr(b64, { title: 'PSBT' }); return false; } },
      { label: t('dlg.close'), value: null, primary: true },
    ],
  });
}

export function exportTx(tx) {
  const hex = tx.toHex();
  return openDialog({
    title: t('btc.signedTx'), body: h('div', { class: 'wu-col' }, h('p', { class: 'wu-small' }, t('btc.signedTxText')), h('textarea', { class: 'ed-input ed-textarea wu-mono', rows: 5, readonly: true }, hex)),
    buttons: [
      { label: t('ap.copy'), onClick: () => { copyText(hex); return false; } },
      { label: t('btc.downloadTx'), onClick: () => { download(hex, tx.txid() + '.txn', 'text/plain'); return false; } },
      { label: 'QR', onClick: () => { showQr(hex, { title: t('btc.signedTx') }); return false; } },
      { label: t('dlg.close'), value: null, primary: true },
    ],
  });
}

// RBF: same inputs, the fee raised by lowering the change (or adding coins).
// BIP-125 rules the replacement must satisfy (spend.js enforces them): higher absolute fee and higher rate than the
// original. Default suggestion: 1.5x the old rate + 1 sat/vB, comfortably above the incremental relay fee.
export async function bumpDialog(w, txid) {
  const src = source(w.network);
  const st = walletState(w);
  const raw = st.txs.get(txid);
  if (!src || !raw) return;
  const tx = Transaction.fromHex(await src.txHex(txid));
  const spent = raw.vin.map((i) => {
    const u = { txid: i.txid, vout: i.vout, value: i.prevout.value, script: hexToBytes(i.prevout.scriptpubkey) };
    return { ...u, spendInfo: infoForScript(w, u.script) };
  });
  // Replacing requires signing every input again; a tx with inputs from another wallet cannot be bumped here.
  if (spent.some((u) => !u.spendInfo)) { toast(t('btc.bumpForeign'), 'error'); return; }
  // KNOWN DEFECT: "change" is the first output paying to any of our scripts, so for a payment to our own receive
  // address that output may be shrunk instead of the real change. Fix: prefer an output on the change chain (chain 1)
  // via the scan's address list, and fall back only when none exists.
  const changeIndex = tx.outputs.findIndex((o) => st.own.has(bytesToHex(o.script)));
  // Old rate from weight (vsize = ceil(weight / 4)), matching how fee rates are defined since segwit.
  const oldRate = raw.fee / Math.ceil(raw.weight / 4);
  const rateIn = h('input', { class: 'ed-input', value: String(Math.ceil(oldRate * 1.5 + 1)), inputmode: 'decimal' });
  const v = await openDialog({ title: t('btc.bumpFee'), body: h('div', { class: 'wu-col' }, h('p', null, t('btc.bumpText', { rate: oldRate.toFixed(1) })), field('btc.newFeeRate', rateIn)),
    buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('btc.signSend'), primary: true, value: 'ok' }] });
  if (v !== 'ok') return;
  try {
    const extra = st.utxos.filter((u) => !u.frozen && u.spendInfo && !tx.inputs.some((i) => i.txid === u.txid && i.vout === u.vout));
    const r = bumpFee({ tx, spent, newFeeRate: Number(rateIn.value), changeIndex: changeIndex >= 0 ? changeIndex : null, change: changeInfo(w), extraUtxos: await withPrevTxs(w, extra), network: w.network });
    const signed = await signPsbt(w, r.psbt);
    const id = await src.broadcast(signed.toHex());
    toast(t('btc.sent', { txid: id.slice(0, 12) }), 'ok');
    for (const a of w.accounts) { const c = syncCache.get(a.id); if (c) c.at = 0; }
  } catch (e) { toast(e.message, 'error'); }
}

// Signing info of a script among the scanned addresses; null for foreign inputs.
function infoForScript(w, script) {
  const hex = bytesToHex(script);
  for (const acc of w.accounts) {
    if (acc.type === 'addresses') continue;
    const c = syncCache.get(acc.id);
    if (!c || !c.scan) continue;
    const a = accountOf(w, acc);
    for (const x of c.scan.addresses) if (bytesToHex(a.script(x.chain, x.index)) === hex) return a.spendInfo(x.chain, x.index);
  }
  return null;
}

// CPFP: spend our output of an unconfirmed transaction with a fee that lifts the pair to the chosen rate.
// Child fee = rate x (parent vsize + child vsize) - parent fee: miners evaluate the package rate.
export async function cpfpDialog(w, txid) {
  const src = source(w.network);
  const st = walletState(w);
  const raw = st.txs.get(txid);
  if (!src || !raw) return;
  const ours = st.utxos.filter((u) => u.txid === txid && u.spendInfo);
  if (!ours.length) { toast(t('btc.cpfpNone'), 'error'); return; }
  const rateIn = h('input', { class: 'ed-input', value: '10', inputmode: 'decimal' });
  const v = await openDialog({ title: t('btc.cpfp'), body: h('div', { class: 'wu-col' }, h('p', null, t('btc.cpfpText')), field('btc.newFeeRate', rateIn)),
    buttons: [{ label: t('dlg.cancel'), value: null }, { label: t('btc.signSend'), primary: true, value: 'ok' }] });
  if (v !== 'ok') return;
  try {
    const dest = changeInfo(w) || ours[0].spendInfo;
    const r = cpfp({ parent: { txid, vsize: Math.ceil(raw.weight / 4), fee: raw.fee }, utxos: await withPrevTxs(w, ours), feeRate: Number(rateIn.value), destination: dest, network: w.network });
    const signed = await signPsbt(w, r.psbt);
    const id = await src.broadcast(signed.toHex());
    toast(t('btc.sent', { txid: id.slice(0, 12) }), 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

export { toOutputScript };
