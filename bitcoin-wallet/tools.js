// bitcoin-wallet/tools.js - tools that work without any server: PSBTs (import by file, text or QR; decode; sign with an
// unlocked wallet; combine; finalize; extract; broadcast when connected; export), the decoder (raw transactions, PSBTs,
// scripts, block headers, descriptors and their addresses, BIP-21 URIs), message verification, BIP-329 label import.
//
// These tools are the cold-wallet workflow: an offline build of this page on an air-gapped device imports a PSBT
// (file / text / QR), signs it with the vault keys and exports it back; an online copy combines, finalises and
// broadcasts. Every step is a pure transformation of the PSBT (BIP-174 roles: signer, combiner, finalizer, extractor),
// so the order of devices does not matter.
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { button, copyText, field, seg, select, textInput } from '../ui/app.js';
import { toast } from '../ui/overlays.js';
import { pickFiles } from '../ui/files.js';
import { bytesToHex, hexToBytes, base64ToBytes } from '../crypto/encoding.js';
import { Psbt } from '../bitcoin/psbt.js';
import { Transaction } from '../bitcoin/tx.js';
import { toAsm, fromAsm, classify } from '../bitcoin/script.js';
import { fromOutputScript } from '../bitcoin/address.js';
import { parseHeader, difficulty } from '../bitcoin/block.js';
import { parseDescriptor } from '../bitcoin/descriptor.js';
import { parseBitcoinURI } from '../bitcoin/uri.js';
import { verifyMessage } from '../bitcoin/message.js';
import { importLabels } from '../bitcoin/labels.js';
import { scanQr } from '../walletui/qr.js';
import { section, kv, go, busy, statusLine, mono, copyable, OFFLINE } from '../walletui/shell.js';
import { dateTime, short } from '../walletui/format.js';
import { settings, source, walletsOfNetwork, vault, saveVault } from './state.js';
import { amt, txView, walletState, lang } from './common.js';
import { signPsbt, exportPsbt, exportTx } from './send.js';

export async function renderTools(ctx) {
  const sub = ctx.route.parts[1] || 'psbt';
  ctx.view.append(h('nav', { class: 'wu-subtabs' }, [['psbt', 'btc.psbt'], ['decode', 'btc.decoder'], ['verify', 'btc.verifyMessage'], ['labels', 'btc.labels']].map(([k, l]) => h('a', { href: '#/tools/' + k, class: sub === k ? 'wu-on' : '' }, t(l)))));
  ({ psbt: psbtTool, decode: decodeTool, verify: verifyTool, labels: labelsTool }[sub] || psbtTool)(ctx);
}

// Binary PSBT files start with the magic bytes "psbt" 0xff; everything else is read as text (Base64 or hex).
async function readInput({ binaryOk = true } = {}) {
  const [f] = await pickFiles({ accept: '.psbt,.txn,.txt,.hex,application/octet-stream,text/plain' });
  if (!f) return null;
  const b = new Uint8Array(await f.arrayBuffer());
  if (binaryOk && b[0] === 0x70 && b[1] === 0x73 && b[2] === 0x62 && b[3] === 0x74 && b[4] === 0xff) return b;
  return new TextDecoder().decode(b).trim();
}

function psbtTool(ctx) {
  const ta = textInput('', () => {}, { multiline: true, rows: 5, class: 'ed-input ed-textarea wu-mono', placeholder: 'cHNidP8B… / 70736274ff…', 'aria-label': 'PSBT' });
  const out = h('div', { class: 'wu-col' });
  let psbt = null;
  const load = (input) => {
    out.textContent = '';
    try {
      psbt = typeof input === 'string' ? Psbt.parse(input) : Psbt.fromBytes(input);
      show();
    } catch (e) { out.append(statusLine('error', t('btc.psbtBad', { msg: e.message }))); psbt = null; }
  };
  const show = () => {
    out.textContent = '';
    const tx = psbt.tx();
    // spentOutput(i): witness_utxo or the output of non_witness_utxo; null when the PSBT lacks it (fee unknown).
    const prevouts = psbt.inputs.map((_, i) => psbt.spentOutput(i));
    const own = new Set();
    for (const w of walletsOfNetwork()) for (const s of walletState(w).own) own.add(s);
    const fee = psbt.fee();
    const finals = psbt.inputs.filter((_, i) => psbt.isFinalized(i)).length;
    // Signature count over all kinds: ECDSA partial sigs, the taproot key-path sig and script-path sigs.
    const sigs = psbt.inputs.reduce((n, i) => n + (i.partialSigs || []).length + (i.tapKeySig ? 1 : 0) + (i.tapScriptSigs || []).length, 0);
    const hd = walletsOfNetwork().filter((w) => w.kind === 'hd');
    const wsel = select(hd.map((w) => ({ v: w.id, l: '=' + w.name })), hd[0] ? hd[0].id : '', () => {});
    const signBtn = h('button', { type: 'button', class: 'ed-btn ed-primary', disabled: !hd.length }, t('btc.signPsbt'));
    signBtn.addEventListener('click', () => busy(signBtn, (async () => {
      const w = hd.find((x) => x.id === wsel.value);
      // A partially signed multisig PSBT is a normal outcome: signPsbt throws notFinal after signing, which is reported
      // as "signed partly" and the PSBT is kept. Matching by the translated message is fragile (an error code would be
      // safer), but both sides use the same t() key, so they stay in sync.
      try { await signPsbt(w, psbt); } catch (e) {
        if (e.message === t('btc.notFinal')) { toast(t('btc.signedPartly'), 'info'); } else { toast(e.message, 'error'); return; }
      }
      ta.value = psbt.toBase64();
      show();
    })()));
    const finalize = button('btc.finalize', 'check', () => { const ok = psbt.finalizeAll(); toast(ok ? t('btc.finalized') : t('btc.notFinal'), ok ? 'ok' : 'warn'); ta.value = psbt.toBase64(); show(); });
    const combine = button('btc.combine', 'layers', async () => {
      const other = await readInput();
      if (!other) return;
      try { psbt.combine(typeof other === 'string' ? Psbt.parse(other) : Psbt.fromBytes(other)); ta.value = psbt.toBase64(); show(); } catch (e) { toast(e.message, 'error'); }
    });
    const complete = finals === psbt.inputs.length;
    const src = source();
    const bcast = h('button', { type: 'button', class: 'ed-btn ed-primary', disabled: !complete || !src }, t('btc.broadcast'));
    bcast.addEventListener('click', () => busy(bcast, src.broadcast(psbt.extract().toHex()).then((id) => { toast(t('btc.sent', { txid: id.slice(0, 12) }), 'ok'); go('explorer/tx/' + id); }).catch((e) => toast(e.message, 'error'))));
    out.append(section(t('btc.psbtSummary'), kv([
      [t('btc.psbtVersion'), String(psbt.version)],
      [t('btc.txid'), copyable(tx.txid())],
      [t('btc.inputsShort'), `${psbt.inputs.length} · ${t('btc.finalCount', { n: finals })} · ${t('btc.sigCount', { n: sigs })}`],
      // "≈": an unsigned transaction has no witnesses yet, so its vsize (and the rate) is an underestimate.
      [t('btc.fee'), fee !== null ? `${amt(fee)} · ${(fee / tx.vsize()).toFixed(2)} sat/vB (≈)` : t('btc.feeUnknown')],
      psbt.global.xpubs.length ? [t('btc.xpubs'), String(psbt.global.xpubs.length)] : null,
    ]), h('div', { class: 'ap-row wu-mt' }, hd.length ? wsel : null, signBtn, finalize, combine,
      button('btc.exportPsbt', 'qr', () => exportPsbt(psbt)), complete ? button('btc.extract', 'download', () => exportTx(psbt.extract())) : null, OFFLINE ? null : bcast)));
    // The decoded view shows the extracted final transaction when complete, else the unsigned skeleton.
    out.append(txView(complete ? psbt.extract() : tx, { prevouts, own, link: !OFFLINE }));
  };
  ctx.view.append(section(t('btc.psbt'), h('p', { class: 'wu-small wu-muted' }, t('btc.psbtIntro')), ta,
    h('div', { class: 'ap-row' }, button('btc.load', 'check', () => load(ta.value.trim()), 'primary'), button('btc.fromFile', 'upload', async () => { const v = await readInput(); if (v) { if (typeof v === 'string') ta.value = v; load(v); } }),
      button('wu.scan', 'scan', async () => { const v = await scanQr(); if (v) { ta.value = v; load(v); } }))), out);
}

function decodeTool(ctx) {
  // One-shot hand-over from the explorer search (sessionStorage): read and delete, so a reload starts empty.
  const pre = sessionStorage.getItem('btcw-decode') || '';
  sessionStorage.removeItem('btcw-decode');
  const ta = textInput(pre, () => {}, { multiline: true, rows: 5, class: 'ed-input ed-textarea wu-mono', placeholder: t('btc.decodeHint'), 'aria-label': t('btc.decoder') });
  const out = h('div', { class: 'wu-col' });
  const decode = () => {
    out.textContent = '';
    const s = ta.value.trim();
    if (!s) return;
    try { out.append(...decodeAny(s)); } catch (e) { out.append(statusLine('error', e.message)); }
  };
  ctx.view.append(section(t('btc.decoder'), h('p', { class: 'wu-small wu-muted' }, t('btc.decodeIntro')), ta,
    h('div', { class: 'ap-row' }, button('btc.decode', 'terminal', decode, 'primary'), button('btc.fromFile', 'upload', async () => { const v = await readInput({ binaryOk: false }); if (v) { ta.value = v; decode(); } }),
      button('wu.scan', 'scan', async () => { const v = await scanQr(); if (v) { ta.value = v; decode(); } }))), out);
  if (pre) decode();
}

// Detection order matters: explicit prefixes first (bitcoin:, PSBT magic, descriptor "func("), then hex; non-hex
// text is parsed as script ASM. An 80-byte hex blob is taken as a block header (a transaction of exactly 80 bytes
// would be misread; rare enough to accept), then a transaction, then a bare script as the fallback.
function decodeAny(s) {
  if (/^bitcoin:/i.test(s)) {
    const u = parseBitcoinURI(s, { network: settings.network });
    return [section('BIP-21', kv([[t('btc.address'), copyable(u.address)], [t('btc.amount'), u.amount !== null ? amt(u.amount) : '—'], [t('btc.label'), u.label], [t('btc.message'), u.message], ...Object.entries(u.params)]))];
  }
  if (/^cHNidP/.test(s) || /^70736274ff/i.test(s)) {
    const p = Psbt.parse(s);
    return [statusLine('info', t('btc.isPsbt')), txView(p.tx(), { prevouts: p.inputs.map((_, i) => p.spentOutput(i)), link: !OFFLINE })];
  }
  if (/^[a-z_]+\(/.test(s)) {
    const d = parseDescriptor(s, { network: settings.network });
    const rows = [];
    // Ranged descriptors: show the first 10 indexes so the user can match addresses against another wallet.
    for (let i = 0; i < (d.isRange ? 10 : 1); i++) for (const sc of d.expand(i).scripts) rows.push(h('tr', null, h('td', null, String(i)), h('td', null, fromOutputScript(sc, settings.network) || '—'), h('td', null, mono(bytesToHex(sc)))));
    // Private keys inside a pasted descriptor are flagged: the user may have just exposed a secret.
    return [section(t('btc.descriptor'), kv([[t('btc.type'), d.type], [t('btc.ranged'), d.isRange ? t('btc.yes') : t('btc.no')], [t('btc.normalized'), mono(d.toString({ public: true }))], d.hasPrivateKeys ? [t('btc.warning'), t('btc.descHasPriv')] : null]),
      h('div', { class: 'ap-table-wrap wu-mt' }, h('table', { class: 'ap-table' }, h('tbody', null, rows))))];
  }
  const hex = s.replace(/\s+/g, '');
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) {
    // ASM text
    const script = fromAsm(s);
    return [scriptSection(script)];
  }
  const b = hexToBytes(hex);
  if (b.length === 80) {
    const hd = parseHeader(b);
    return [section(t('btc.blockHeader'), kv([[t('btc.hash'), copyable(hd.hash)], [t('btc.previous'), mono(hd.prevHash)], [t('btc.merkleRoot'), mono(hd.merkleRoot)], [t('btc.time'), dateTime(hd.time, lang())],
      ['bits', '0x' + hd.bits.toString(16)], [t('btc.difficulty'), String(Math.round(difficulty(hd.bits)))], ['nonce', String(hd.nonce)], [t('btc.version'), '0x' + (hd.version >>> 0).toString(16)]]))];
  }
  try { return [txView(Transaction.fromBytes(b), { link: !OFFLINE })]; } catch { return [scriptSection(b)]; }
}

function scriptSection(script) {
  const c = classify(script);
  const addr = fromOutputScript(script, settings.network);
  return section(t('btc.script'), kv([[t('btc.type'), c.type], ['ASM', mono(toAsm(script))], ['hex', mono(bytesToHex(script))], addr ? [t('btc.address'), copyable(addr)] : null, c.type === 'multisig' ? ['m-of-n', `${c.m}-of-${c.n}`] : null]));
}

function verifyTool(ctx) {
  const a = textInput('', () => {}, { class: 'ed-input wu-mono' });
  const m = textInput('', () => {}, { multiline: true, rows: 4 });
  const sg = textInput('', () => {}, { multiline: true, rows: 2, class: 'ed-input ed-textarea wu-mono' });
  const out = h('div');
  ctx.view.append(section(t('btc.verifyMessage'), h('p', { class: 'wu-small wu-muted' }, t('btc.verifyIntro')), field('btc.address', a), field('btc.message', m), field('btc.signature', sg),
    h('div', { class: 'ap-row' }, button('btc.verify', 'check', () => {
      const r = verifyMessage(m.value, a.value.trim(), sg.value.trim(), { network: settings.network });
      out.textContent = '';
      // BIP-322 "proof of funds" signatures may carry a locktime; shown when present.
      out.append(statusLine(r.valid ? 'ok' : 'error', r.valid ? t('btc.sigValid', { format: r.format }) + (r.locktime ? ' · locktime ' + r.locktime : '') : t('btc.sigInvalid', { error: r.error || '' })));
    }, 'primary')), out));
}

function labelsTool(ctx) {
  const out = h('div');
  ctx.view.append(section(t('btc.labels'), h('p', { class: 'wu-small wu-muted' }, t('btc.labelsIntro', { n: vault.data.labels.length })),
    h('div', { class: 'ap-row' }, button('btc.importLabels', 'upload', async () => {
      const [f] = await pickFiles({ accept: '.jsonl,.json,.txt' });
      if (!f) return;
      // BIP-329 import: imported records overwrite fields of existing ones (same type + ref), others are appended.
      // Invalid lines are counted and reported, not fatal: one bad line must not discard a whole label file.
      const r = importLabels(await f.text(), { network: settings.network });
      for (const rec of r.records) {
        const i = vault.data.labels.findIndex((l) => l.type === rec.type && l.ref === rec.ref);
        if (i >= 0) Object.assign(vault.data.labels[i], rec); else vault.data.labels.push(rec);
      }
      saveVault();
      out.textContent = '';
      out.append(statusLine(r.errors.length ? 'warn' : 'ok', t('btc.labelsImported', { n: r.records.length, bad: r.errors.length })));
    }, 'primary')), out));
}

export { base64ToBytes, short };
