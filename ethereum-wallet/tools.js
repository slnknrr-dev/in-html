// ethereum-wallet/tools.js - tools that need no endpoint: the raw transaction decoder (type, chain id, nonce, fees,
// recipient, value, call data decoded, the sender recovered, the hash; broadcast when connected), ABI encoding and
// decoding of parameters and call data, the EIP-681 URI decoder, the unit converter (wei / gwei / ether) and keystore
// v3 files (decrypt to see the address or the key, encrypt a private key).
//
// Every tool here is pure computation over user-supplied data (works in the offline build); the only network action
// is the optional broadcast of a decoded raw transaction. Inputs are untrusted: each tool wraps parsing in try/catch
// and shows the error in place, so a malformed paste never breaks the page.
import { h } from '../ui/dom.js';
import { t } from '../ui/i18n.js';
import { button, copyText, download, field, seg, textInput } from '../ui/app.js';
import { confirmDialog, toast } from '../ui/overlays.js';
import { pickFiles } from '../ui/files.js';
import { iconEl } from '../ui/icons.js';
import { wipe, bytesToHex } from '../crypto/encoding.js';
import { isValidPrivateKey } from '../crypto/secp256k1.js';
import { scanQr } from '../walletui/qr.js';
import { section, kv, go, busy, statusLine, mono, copyable, OFFLINE } from '../walletui/shell.js';
import { parseTransaction, validateTransaction } from '../ethereum/tx.js';
import { parseAbi, parseFragment, encodeParameters, decodeParameters, encodeFunctionData, formatAbiValue, formatFragment } from '../ethereum/abi.js';
import { parseEthereumURI } from '../ethereum/uri.js';
import { formatUnits, parseUnits, fromHex } from '../ethereum/units.js';
import { privateKeyToAddress } from '../ethereum/address.js';
import { decryptKeystoreAsync, encryptKeystoreAsync, keystoreAddress } from '../ethereum/keystore.js';
import { chainName } from '../ethereum/chains.js';
import { rpc, chain, settings, rememberSent } from './state.js';
import { txView, decodeCall, argsTable, fmtEth } from './common.js';

// Sub-tab routing (#/tools/<k>); an unknown key falls back to the decoder instead of an empty page.
export async function renderTools(ctx) {
  const sub = ctx.route.parts[1] || 'decode';
  ctx.view.append(h('nav', { class: 'wu-subtabs' }, [['decode', 'eth.decoder'], ['abi', 'eth.abiTool'], ['uri', 'eth.uriTool'], ['units', 'eth.units'], ['keystore', 'eth.keystore']].map(([k, l]) => h('a', { href: '#/tools/' + k, class: sub === k ? 'wu-on' : '' }, t(l)))));
  ({ decode: decodeTool, abi: abiTool, uri: uriTool, units: unitsTool, keystore: keystoreTool }[sub] || decodeTool)(ctx);
}

async function readText(accept = '.txt,.hex,.json,text/plain,application/json') {
  const [f] = await pickFiles({ accept });
  return f ? (await f.text()).trim() : null;
}

// Keystore KDFs (scrypt/pbkdf2) take seconds; a determinate bar fed by onProgress shows the work is alive. Methods are
// attached to the element itself to avoid a wrapper object for a two-method widget.
function progressBar() {
  const bar = h('i');
  const el = h('div', { class: 'ap-progress', hidden: true }, bar);
  el.set = (f) => { el.hidden = false; bar.style.width = Math.round(f * 100) + '%'; };
  el.done = () => { el.hidden = true; bar.style.width = '0'; };
  return el;
}

// --- raw transactions ---

// Raw transaction decoder. A one-shot prefill arrives through sessionStorage ('ethw-decode', set by other views,
// e.g. the offline signer) and is removed at once so a reload does not re-decode stale input. Whitespace is stripped
// because hex pasted from QR/e-mail often wraps lines. Broadcast is allowed only online and when the transaction's
// chain id equals the selected chain: sending a chain-5 transaction to a chain-1 node fails or, for a pre-EIP-155
// transaction without chain id, could be replayed on any chain (hence the explicit "no replay protection" label).
function decodeTool(ctx) {
  const pre = sessionStorage.getItem('ethw-decode') || '';
  sessionStorage.removeItem('ethw-decode');
  const ta = textInput(pre, () => {}, { multiline: true, rows: 5, class: 'ed-input ed-textarea wu-mono', placeholder: t('eth.decodeHint'), 'aria-label': t('eth.decoder') });
  const out = h('div', { class: 'wu-col' });
  const decode = () => {
    out.textContent = '';
    const s = ta.value.trim().replace(/\s+/g, '');
    if (!s) return;
    let tx;
    try { tx = parseTransaction(s.startsWith('0x') ? s : '0x' + s); } catch (e) { out.append(statusLine('error', t('eth.notTx', { msg: e.message }))); return; }
    const problems = validateTransaction(tx, { chainId: tx.chainId != null ? Number(tx.chainId) : null });
    const client = rpc();
    const sameChain = tx.chainId == null || Number(tx.chainId) === chain().id;
    const bcast = h('button', { type: 'button', class: 'ed-btn ed-primary', disabled: !client || !sameChain }, t('eth.broadcast'));
    bcast.addEventListener('click', () => busy(bcast, client.sendRawTransaction(s.startsWith('0x') ? s : '0x' + s).then((hash) => {
      rememberSent({ hash, chainId: Number(tx.chainId ?? settings.chainId), from: tx.from, nonce: Number(tx.nonce), to: tx.to, value: String(tx.value), data: tx.data, gasLimit: String(tx.gasLimit), type: tx.type,
        maxFeePerGas: tx.maxFeePerGas != null ? String(tx.maxFeePerGas) : null, maxPriorityFeePerGas: tx.maxPriorityFeePerGas != null ? String(tx.maxPriorityFeePerGas) : null, gasPrice: tx.gasPrice != null ? String(tx.gasPrice) : null, token: null, kind: 'send', at: Date.now(), status: 'pending' });
      toast(t('eth.sent', { hash: hash.slice(0, 14) }), 'ok'); go('explorer/tx/' + hash);
    }).catch((e) => toast(e.message, 'error'))));
    out.append(section(t('eth.decodedTx'), kv([
      [t('eth.hash'), copyable(tx.hash)],
      [t('eth.sender'), tx.from ? copyable(tx.from) : '—'],
      [t('eth.chain'), tx.chainId != null ? `${chainName(Number(tx.chainId))} (${tx.chainId})` : t('eth.noReplayProtection')],
      [t('eth.checks'), problems.length ? problems.join(', ') : t('eth.checksOk')],
    ]), !sameChain ? statusLine('warn', t('eth.otherChain', { id: String(tx.chainId) })) : null, OFFLINE ? null : h('div', { class: 'ap-row wu-mt' }, bcast)));
    out.append(txView(tx, { link: !OFFLINE, title: t('eth.transaction'), live: false }));
  };
  ctx.view.append(section(t('eth.decoder'), h('p', { class: 'wu-small wu-muted' }, t('eth.decodeIntro')), ta,
    h('div', { class: 'ap-row' }, button('eth.decode', 'terminal', decode, 'primary'), button('eth.fromFile', 'upload', async () => { const v = await readText(); if (v) { ta.value = v; decode(); } }),
      button('wu.scan', 'scan', async () => { const v = await scanQr(); if (v) { ta.value = v; decode(); } }))), out);
  if (pre) decode();
}

// --- ABI ---

// Values as JSON; the surrounding [] is optional for convenience. Big integers must be quoted strings: JSON numbers
// above 2^53 would silently lose precision before reaching the ABI encoder.
function parseValues(text) {
  const s = text.trim();
  if (!s) return [];
  const v = JSON.parse(s.startsWith('[') ? s : '[' + s + ']');
  return v;
}

// The first input is either a function/event/error signature (selector-aware encode/decode) or a bare comma list of
// types (raw parameter encoding). Split regex: commas not inside parentheses, so tuple types "(uint256,address)"
// stay whole - a naive split(',') would break them. Decode checks the 4-byte selector before decoding the rest:
// decoding arguments against the wrong function would produce plausible-looking garbage.
function abiTool(ctx) {
  let mode = 'call';
  const sig = textInput('', () => {}, { class: 'ed-input wu-mono', placeholder: 'function transfer(address to, uint256 amount)  /  uint256, address[]', 'aria-label': t('eth.signatureOrTypes') });
  const vals = textInput('', () => {}, { multiline: true, rows: 3, class: 'ed-input ed-textarea wu-mono', placeholder: '["0x…", "1000"]', 'aria-label': t('eth.values') });
  const data = textInput('', () => {}, { multiline: true, rows: 4, class: 'ed-input ed-textarea wu-mono', placeholder: '0x…', 'aria-label': t('eth.callData') });
  const out = h('div', { class: 'wu-col' });
  const show = (el) => { out.textContent = ''; out.append(el); };
  const fragment = () => {
    const s = sig.value.trim();
    return /^(function|event|error)\s/.test(s) || /^[A-Za-z_$][\w$]*\(/.test(s) ? parseFragment(/^(function|event|error)\s/.test(s) ? s : 'function ' + s) : null;
  };
  const encode = () => {
    try {
      const f = fragment();
      const v = parseValues(vals.value);
      const hex = f ? encodeFunctionData(f, v) : encodeParameters(sig.value.split(/\s*,\s*(?![^(]*\))/).filter(Boolean), v);
      data.value = hex;
      show(h('div', { class: 'wu-col' }, f ? kv([[t('eth.selector'), mono(f.selector)], [t('eth.signature'), mono(f.signature)]]) : null, h('div', { class: 'ap-row wu-nowrap' }, h('span', { class: 'wu-mono wu-break wu-small' }, hex), button('', 'copy', () => copyText(hex)))));
    } catch (e) { show(statusLine('error', e.message)); }
  };
  const decode = () => {
    try {
      const f = fragment();
      const d = data.value.trim();
      if (f) {
        const r = parseAbi([formatFragment(f, 'human')]);
        const fr = r.functions[0];
        if (d.slice(0, 10).toLowerCase() !== fr.selector) throw new Error(t('eth.selectorMismatch', { want: fr.selector, got: d.slice(0, 10) }));
        const args = decodeParameters(fr.inputs, '0x' + d.slice(10));
        show(section(fr.signature, argsTable(fr, args)));
      } else if (!sig.value.trim()) {
        const dec = decodeCall(d);
        show(dec ? section(dec.signature, argsTable(dec.fragment, dec.args)) : statusLine('info', t('eth.unknownCall', { sel: d.slice(0, 10) })));
      } else {
        const types = sig.value.split(/\s*,\s*(?![^(]*\))/).filter(Boolean);
        const r = decodeParameters(types, d);
        show(kv(types.map((ty, i) => [ty, mono(formatAbiValue(r[i], ty))])));
      }
    } catch (e) { show(statusLine('error', e.message)); }
  };
  const paintMode = () => { vals.closest('.ed-field').hidden = mode !== 'call'; };
  ctx.view.append(section(t('eth.abiTool'), h('p', { class: 'wu-small wu-muted' }, t('eth.abiIntro')),
    seg([{ v: 'call', l: 'eth.encode' }, { v: 'decode', l: 'eth.decode' }], mode, (v) => { mode = v; paintMode(); }),
    field('eth.signatureOrTypes', sig), field('eth.values', vals), field('eth.callData', data),
    h('div', { class: 'ap-row' }, button('eth.encode', 'check', encode, 'primary'), button('eth.decode', 'terminal', decode))), out);
  paintMode();
}

// --- EIP-681 ---

// EIP-681 payment URIs (from QR codes). Known parameters (value/address/uint256) are shown as amount/recipient, the
// rest listed raw. A failed address checksum is a warning, not an error: some wallets emit lowercase addresses.
function uriTool(ctx) {
  const ta = textInput('', () => {}, { multiline: true, rows: 3, class: 'ed-input ed-textarea wu-mono', placeholder: 'ethereum:0x…@1?value=1e18', 'aria-label': 'URI' });
  const out = h('div', { class: 'wu-col' });
  const decode = () => {
    out.textContent = '';
    try {
      const u = parseEthereumURI(ta.value.trim());
      out.append(section('EIP-681', kv([
        [t('eth.target'), copyable(u.target)],
        [t('eth.chain'), u.chainId != null ? `${chainName(u.chainId)} (${u.chainId})` : t('eth.chainDefault')],
        u.functionName ? [t('eth.function'), mono(u.functionName)] : null,
        u.to ? [t('eth.recipient'), copyable(u.to)] : null,
        u.token ? [t('eth.token'), copyable(u.token)] : null,
        u.amount != null ? [t('eth.amount'), u.token ? `${u.amount} (${t('eth.baseUnits')})` : fmtEth(u.amount, u.chainId || settings.chainId, 18)] : null,
        ...u.args.filter(([k]) => !['value', 'address', 'uint256'].includes(k)).map(([k, v]) => [k, mono(String(v))]),
      ]), u.checksumOk ? null : statusLine('warn', t('eth.uriChecksum'))));
    } catch (e) { out.append(statusLine('error', e.message)); }
  };
  ctx.view.append(section(t('eth.uriTool'), h('p', { class: 'wu-small wu-muted' }, t('eth.uriIntro')), ta,
    h('div', { class: 'ap-row' }, button('eth.decode', 'terminal', decode, 'primary'), button('wu.scan', 'scan', async () => { const v = await scanQr(); if (v) { ta.value = v; decode(); } }))), out);
}

// --- units ---

// Three linked inputs; typing in one rewrites the other two. All conversion goes through bigint wei, so no float
// rounding (1e-18 ether stays exactly 1 wei). The edited field is never rewritten, keeping the caret in place.
function unitsTool(ctx) {
  const units = [['wei', 0], ['gwei', 9], ['ether', 18]];
  const inputs = units.map(([u]) => h('input', { class: 'ed-input wu-mono', inputmode: 'decimal', 'aria-label': u, name: 'unit-' + u }));
  const err = h('div', { class: 'wu-error' });
  inputs.forEach((inp, i) => inp.addEventListener('input', () => {
    err.textContent = '';
    try {
      const wei = parseUnits(inp.value.trim().replace(',', '.') || '0', units[i][1]);
      inputs.forEach((o, k) => { if (k !== i) o.value = formatUnits(wei, units[k][1]); });
    } catch (e) { err.textContent = e.message; }
  }));
  ctx.view.append(section(t('eth.units'), h('p', { class: 'wu-small wu-muted' }, t('eth.unitsIntro')),
    ...units.map(([u], i) => field('=' + u, inputs[i])), err));
}

// --- keystore ---

// Keystore v3 (Web3 Secret Storage). Secret hygiene: decrypted key bytes are wiped in finally; the private key is
// shown only after an explicit confirmation dialog. Limitation: the hex string kept for that reveal cannot be wiped
// (JS strings are immutable) and lives until the view is discarded. Inputs are type=password so the key is not
// visible over the shoulder or stored by form autofill (autocomplete off / new-password).
function keystoreTool(ctx) {
  const ta = textInput('', () => {}, { multiline: true, rows: 5, class: 'ed-input ed-textarea wu-mono', placeholder: '{"version":3,"crypto":{…}}', 'aria-label': t('eth.keystoreFile') });
  const pw = h('input', { type: 'password', class: 'ed-input', autocomplete: 'off' });
  const prog = progressBar();
  const out = h('div', { class: 'wu-col' });
  const dec = h('button', { type: 'button', class: 'ed-btn ed-primary' }, t('eth.decrypt'));
  dec.addEventListener('click', () => busy(dec, (async () => {
    out.textContent = '';
    let key = null;
    try {
      key = await decryptKeystoreAsync(ta.value.trim(), pw.value, { onProgress: prog.set });
      const address = privateKeyToAddress(key);
      const hex = '0x' + bytesToHex(key);
      const show = button('eth.showKey', 'eye', async () => {
        if (!(await confirmDialog(t('eth.showKey'), t('eth.keyWarn'), t('eth.showKey'), true))) return;
        show.replaceWith(h('div', { class: 'wu-mono wu-break wu-small' }, hex));
      });
      out.append(statusLine('ok', t('eth.keystoreOk')), kv([[t('eth.address'), copyable(address)]]), h('div', { class: 'ap-row' }, show));
    } catch (e) { out.append(statusLine('error', e.code === 'password' ? t('wu.wrongPassword') : e.message)); } finally { prog.done(); if (key) wipe(key); }
  })()));
  const kin = h('input', { type: 'password', class: 'ed-input wu-mono', autocomplete: 'off', placeholder: '0x…' });
  const kp1 = h('input', { type: 'password', class: 'ed-input', autocomplete: 'new-password' });
  const kp2 = h('input', { type: 'password', class: 'ed-input', autocomplete: 'new-password' });
  const prog2 = progressBar();
  const err2 = h('div', { class: 'wu-error', role: 'alert' });
  const enc = h('button', { type: 'button', class: 'ed-btn ed-primary' }, iconEl('download'), t('eth.encrypt'));
  enc.addEventListener('click', () => busy(enc, (async () => {
    err2.textContent = '';
    let key = null;
    try {
      const hex = kin.value.trim().replace(/^0x/i, '');
      if (!/^[0-9a-fA-F]{64}$/.test(hex) || !isValidPrivateKey((key = fromHex(hex)))) throw new Error(t('eth.badKey'));
      // Minimum length only: the KDF (thousands of iterations / scrypt) is the real brute-force defence.
      if (kp1.value.length < 8) throw new Error(t('wu.pwShort'));
      if (kp1.value !== kp2.value) throw new Error(t('wu.pwMismatch'));
      const json = await encryptKeystoreAsync(key, kp1.value, { onProgress: prog2.set });
      kin.value = kp1.value = kp2.value = '';
      // File name in the geth convention UTC--<ISO time>--<address>; ':' replaced because it is illegal on Windows.
      download(JSON.stringify(json), `UTC--${new Date().toISOString().replace(/:/g, '-')}--${json.address}.json`, 'application/json');
      toast(t('eth.keystoreSaved'), 'ok');
    } catch (e) { err2.textContent = e.message; } finally { prog2.done(); if (key) wipe(key); }
  })()));
  ctx.view.append(h('div', { class: 'wu-grid2' },
    section(t('eth.keystoreDecrypt'), h('p', { class: 'wu-small wu-muted' }, t('eth.keystoreDecryptIntro')), ta,
      h('div', { class: 'ap-row' }, button('eth.fromFile', 'upload', async () => { const v = await readText('.json,application/json,text/plain'); if (v) { ta.value = v; const a = keystoreAddress(v); if (a) toast(t('eth.keystoreFor', { a }), 'info'); } })),
      field('eth.keystorePassword', pw), prog, h('div', { class: 'ap-row' }, dec), out),
    section(t('eth.keystoreEncrypt'), h('p', { class: 'wu-small wu-muted' }, t('eth.keystoreEncryptIntro')), field('eth.privateKey', kin), field('wu.newPassword', kp1), field('wu.repeatPassword', kp2), prog2, err2, h('div', { class: 'ap-row' }, enc))));
}

