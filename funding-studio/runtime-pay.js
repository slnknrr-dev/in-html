// funding-studio/runtime-pay.js - payment runtime features of exported pages (serialized like runtime.js):
//
//   price     R.price(sym, cur) -> Promise<price of 1 sym in cur | null>: the owner's fixed rates (direct, inverse,
//             one hop) or the owner's price URL (JSON, path per symbol with {cur} / {CUR}); R.units / R.unitsText
//             decimal amounts in base units (BigInt) and back
//   m-stripe  Payment Links per amount / interval / currency, a "customer chooses" link, or a Buy Button (Stripe's
//             script is loaded only after the donor asks for it)
//   m-paypal  Donate button (hosted button id) / business account with amount / paypal.me
//   m-tbc     TBC Bank payment links (GEL) or transfer details
//   m-bank    IBAN transfer details with copy buttons and an EPC QR code (EUR)
//   m-btc     BIP-21 URI and QR (amount from the rate when there is one), one address per visitor from the owner's list
//   m-eth     EIP-681 URI and QR for ETH or ERC-20 stablecoins on the owner's chains; donate with a browser wallet
//             (EIP-6963 discovery, EIP-1193 requests, chain switching)
//   donate    the donate form: amount, interval, currency, donor details, method buttons and their availability; the
//             backend (R.api) creates checkouts for Stripe / PayPal / TBC and per-donation crypto addresses, the page
//             falls back to the methods above when the server cannot be reached
// Method features fill R.M[m] = { can(st) -> '' | reason key, go(st, panel, server) } before donate runs.
//
// Design: a plugin table keeps the donate form ignorant of providers - it asks each method whether it can serve the
// current state (amount, interval, currency) and why not (the reason key becomes the disabled button's hint), and
// hands over a panel. Every method works with public data only (links, IBANs, addresses): secrets never reach a
// page. When a backend is reachable, server-capable methods get a checkout/claim response instead (the `server`
// argument). Third-party code (Stripe's Buy Button script) is loaded only after an explicit click - no tracker is
// pulled in by merely viewing the page. Same ES5 / toString constraints as runtime.js.

function rtPrice(R) {
  var rates = (R.cfg.pay && R.cfg.pay.rates) || {};
  var fixed = rates.fixed || {};
  function get(a, b) {
    var x = +fixed[a + ':' + b];
    if (x > 0) return x;
    var y = +fixed[b + ':' + a];
    return y > 0 ? 1 / y : null;
  }
  // Fixed rates are stored as 'A:B' -> price of 1 A in B. Lookup order: direct, inverse (1 / B:A), then one hop through
  // any currency that appears in a stored pair (A->M->B), so 'BTC:EUR' and 'USD:EUR' are enough to price BTC in USD.
  function fixedRate(a, b) {
    if (a === b) return 1;
    var d = get(a, b);
    if (d) return d;
    for (var k in fixed) {
      if (!Object.prototype.hasOwnProperty.call(fixed, k)) continue;
      var parts = k.split(':');
      for (var i = 0; i < 2; i++) {
        var mid = parts[i];
        if (mid === a || mid === b) continue;
        var x = get(a, mid);
        var y = x && get(mid, b);
        if (x && y) return x * y;
      }
    }
    return null;
  }
  // The owner's price URL is fetched once per page view; a failed fetch resets the promise so a later call retries.
  // KNOWN DEFECT: `remote` is one shared promise, but the URL is built with the currency of the FIRST call ({cur});
  // a later call with another currency reuses that response and usually falls back to the fixed rate. Fix: cache the
  // promise per resolved URL (an object keyed by URL).
  var remote = null;
  function path(o, p) {
    var parts = String(p || '').split('.');
    for (var i = 0; i < parts.length && o != null; i++) if (parts[i]) o = o[parts[i]];
    return o;
  }
  R.price = function (sym, cur) {
    if (sym === cur) return Promise.resolve(1);
    if (sym === 'USD' && cur === 'USD') return Promise.resolve(1);
    var f = fixedRate(sym, cur);
    var tpl = rates.paths && rates.paths[sym];
    if (!rates.url || !tpl || !R.json) return Promise.resolve(f);
    if (!remote) remote = R.json(rates.url.replace(/\{cur\}/g, cur.toLowerCase()).replace(/\{CUR\}/g, cur), { timeout: 8000 }).catch(function () { remote = null; return null; });
    return remote.then(function (j) {
      var v = j ? +path(j, tpl.replace(/\{cur\}/g, cur.toLowerCase()).replace(/\{CUR\}/g, cur)) : NaN;
      return v > 0 ? v : f;
    });
  };
  // Decimal amount (number or text) -> BigInt base units, rounded half up.
  // String arithmetic instead of Math.round(x * 10^d): 18 decimals exceed float precision, and String(number) may be
  // in exponent form (1e-7), which is expanded by shifting the decimal point textually. One extra digit is kept to
  // decide rounding. Wallet URIs need exact integers (EIP-681 value in wei).
  R.units = function (amount, decimals) {
    var s = typeof amount === 'number' ? String(amount) : String(amount || '0');
    var m = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s);
    if (!m) return BigInt(0);
    var int = m[1];
    var frac = m[2] || '';
    var e = +(m[3] || 0);
    if (e > 0) { int += (frac.slice(0, e) + Array(e + 1).join('0')).slice(0, e); frac = frac.slice(e); }
    if (e < 0) { var pad = Array(-e + 1).join('0') + int; int = pad.slice(0, pad.length + e) || '0'; frac = pad.slice(pad.length + e) + frac; }
    var full = (frac + Array(decimals + 2).join('0')).slice(0, decimals + 1);
    var u = BigInt(int + full.slice(0, decimals));
    if (+full[decimals] >= 5) u += BigInt(1);
    return u;
  };
  R.unitsText = function (u, decimals) {
    var s = BigInt(u).toString();
    while (s.length <= decimals) s = '0' + s;
    var i = s.slice(0, s.length - decimals);
    var f = decimals ? s.slice(s.length - decimals).replace(/0+$/, '') : '';
    return f ? i + '.' + f : i;
  };
}

// Stripe without a server: Payment Links are fixed-price URLs, so the owner pastes one per (amount, currency,
// interval) tuple, plus optionally a "customer chooses" link for one-time gifts. prefilled_email and
// client_reference_id are documented Payment Link parameters (the reference helps reconcile in the dashboard).
// The Buy Button alternative needs Stripe's script, injected on click only.
function rtMStripe(R) {
  var s = (R.cfg.pay && R.cfg.pay.stripe) || {};
  R.M = R.M || {};
  function link(st) {
    var ls = s.links || [];
    for (var i = 0; i < ls.length; i++) if (+ls[i][0] === st.amt && ls[i][1] === st.cur && ls[i][2] === st.int) return ls[i][3];
    return st.int === 'once' && s.any ? s.any : '';
  }
  function prefill(u, st) {
    try {
      var x = new URL(u);
      if (st.donor.email) x.searchParams.set('prefilled_email', st.donor.email);
      if (st.ref) x.searchParams.set('client_reference_id', st.ref);
      return x.href;
    } catch (e) { return u; }
  }
  R.M.stripe = {
    can: function (st) { if (link(st)) return ''; if (s.buy && s.pk && st.int === 'once') return ''; return st.int === 'month' ? 'noMonthly' : 'noLink'; },
    go: function (st, P) {
      var u = link(st);
      if (u) { R.pending(st, 'stripe'); P.note(R.t('redirecting')); R.go(prefill(u, st)); return; }
      var body = P.open('m.stripe', 'card');
      body.appendChild(R.el('p', '__P__-muted', R.t('stripeScript')));
      var btn = R.el('button', '__P__-btn', R.t('loadStripe'));
      btn.type = 'button';
      btn.addEventListener('click', function () {
        btn.disabled = true;
        var sc = document.createElement('script');
        sc.async = true;
        sc.src = 'https://js.stripe.com/v3/buy-button.js';
        sc.onload = function () {
          var el = document.createElement('stripe-buy-button');
          el.setAttribute('buy-button-id', s.buy);
          el.setAttribute('publishable-key', s.pk);
          if (st.donor.email) el.setAttribute('customer-email', st.donor.email);
          if (st.ref) el.setAttribute('client-reference-id', st.ref);
          btn.replaceWith(el);
          R.pending(st, 'stripe');
        };
        sc.onerror = function () { btn.disabled = false; P.note(R.t('serverDown')); };
        document.head.appendChild(sc);
      });
      body.appendChild(btn);
    },
  };
}

// PayPal without a server: hosted donate button id, the donate URL with business + amount, or paypal.me/<name>/<amt>.
// Zero-decimal currencies (JPY, HUF, TWD per PayPal's currency list) must be sent without decimals or PayPal rejects
// the amount. No monthly giving without a server (subscriptions need API calls).
function rtMPaypal(R) {
  var p = (R.cfg.pay && R.cfg.pay.paypal) || {};
  R.M = R.M || {};
  function url(st) {
    var cur = st.cur;
    var ok = (p.cur || []).indexOf(cur) >= 0;
    var val = cur === 'JPY' || cur === 'HUF' || cur === 'TWD' ? String(Math.round(st.amt)) : st.amt.toFixed(2);
    if (p.mode === 'me') return 'https://paypal.me/' + encodeURIComponent(p.me) + (ok ? '/' + val + cur : '');
    var u = new URL(p.sandbox ? 'https://www.sandbox.paypal.com/donate' : 'https://www.paypal.com/donate');
    if (p.mode === 'hosted') u.searchParams.set('hosted_button_id', p.hosted);
    else {
      u.searchParams.set('business', p.business);
      u.searchParams.set('amount', val);
      u.searchParams.set('currency_code', cur);
      if (st.title) u.searchParams.set('item_name', st.title.slice(0, 120));
    }
    return u.href;
  }
  R.M.paypal = {
    can: function (st) {
      if (p.mode === 'hosted') return p.hosted ? '' : 'noLink';
      if ((p.cur || []).indexOf(st.cur) < 0) return 'noCurrency';
      if (st.int === 'month') return 'noMonthly';
      return p.mode === 'me' ? (p.me ? '' : 'noLink') : (p.business ? '' : 'noLink');
    },
    go: function (st, P) { R.pending(st, 'paypal'); P.note(R.t('redirecting')); R.go(url(st)); },
  };
}

function rtMTbc(R) {
  var t = (R.cfg.pay && R.cfg.pay.tbc) || {};
  R.M = R.M || {};
  function link(st) {
    var ls = t.links || [];
    if (st.cur === 'GEL') for (var i = 0; i < ls.length; i++) if (+ls[i][0] === st.amt && st.int === 'once') return ls[i][1];
    return st.int === 'once' && t.any ? t.any : '';
  }
  R.M.tbc = {
    can: function (st) { return link(st) || t.iban ? '' : st.int === 'month' ? 'noMonthly' : 'noLink'; },
    go: function (st, P) {
      var u = link(st);
      if (u) { R.pending(st, 'tbc'); P.note(R.t('redirecting')); R.go(u); return; }
      var body = P.open('m.tbc', 'bank');
      body.appendChild(R.el('p', '__P__-muted', R.t('transferHint')));
      var dl = R.el('dl', '__P__-dl');
      if (t.holder) R.copyRow(dl, R.t('holder'), t.holder);
      R.copyRow(dl, 'IBAN', t.iban.replace(/(.{4})(?=.)/g, '$1 '), t.iban);
      R.copyRow(dl, 'SWIFT', t.swift || 'TBCBGE22');
      R.copyRow(dl, R.t('amount'), R.fmt(st.amt, st.cur), String(st.amt));
      R.copyRow(dl, R.t('reference'), st.reference);
      body.appendChild(dl);
      R.pending(st, 'tbc');
    },
  };
}

function rtMBank(R) {
  var b = (R.cfg.pay && R.cfg.pay.bank) || {};
  R.M = R.M || {};
  // EPC069-12 payload (version 002, UTF-8, SCT) with the amount and the unstructured remittance text.
  // Lines: service tag, version, charset 1 = UTF-8, SCT, BIC (optional in v002), name <= 70, IBAN, 'EUR' + amount,
  // purpose, structured reference (empty), remittance text <= 140. Only for EUR: SEPA credit transfers are euro-only,
  // which is why the QR is skipped for other currencies. Banking apps scan it and prefill the transfer.
  function epc(st) {
    var amt = String(Math.round(st.amt * 100) / 100);
    return ['BCD', '002', '1', 'SCT', b.bic || '', b.holder.slice(0, 70), b.iban, 'EUR' + amt, '', '', st.reference.slice(0, 140)].join('\n');
  }
  R.M.bank = {
    can: function () { return b.iban ? '' : 'noLink'; },
    go: function (st, P) {
      var body = P.open('m.bank', 'bank');
      var grid = R.el('div', '__P__-panel-grid');
      var left = R.el('div');
      left.appendChild(R.el('p', '__P__-muted', R.t('transferHint')));
      var dl = R.el('dl', '__P__-dl');
      if (b.holder) R.copyRow(dl, R.t('holder'), b.holder);
      R.copyRow(dl, 'IBAN', b.iban.replace(/(.{4})(?=.)/g, '$1 '), b.iban);
      if (b.bic) R.copyRow(dl, 'BIC', b.bic);
      if (b.bank) R.copyRow(dl, R.t('bankName'), b.bank);
      R.copyRow(dl, R.t('amount'), R.fmt(st.amt, st.cur), String(st.amt));
      R.copyRow(dl, R.t('reference'), st.reference);
      left.appendChild(dl);
      grid.appendChild(left);
      if (b.epc && b.holder && st.cur === 'EUR' && R.qr) {
        var q = R.el('div', '__P__-qr');
        q.innerHTML = R.qr(epc(st), R.t('scanBank'));
        var fig = R.el('figure');
        fig.appendChild(q);
        fig.appendChild(R.el('figcaption', '__P__-small __P__-muted', R.t('scanBank')));
        grid.appendChild(fig);
      }
      body.appendChild(grid);
      R.pending(st, 'bank');
    },
  };
}

function rtMBtc(R) {
  var c = (R.cfg.pay && R.cfg.pay.btc) || {};
  R.M = R.M || {};
  // One address of the owner's list per visitor (kept in this browser), so repeated visits show the same one.
  // Spreading visitors over several addresses limits address reuse (privacy for donors, easier matching for the owner)
  // without a server; true per-donation addresses need the backend (server.address).
  // BIP-21: 'bitcoin:<address>?amount=<BTC decimal>&label=<urlencoded>'.
  function address() {
    var list = c.list || [];
    if (!list.length) return '';
    var k = R.docKey('btc');
    var i = parseInt(R.store.get(k), 10);
    if (!(i >= 0 && i < list.length)) { i = Math.floor(Math.random() * list.length); R.store.set(k, String(i)); }
    return list[i];
  }
  R.M.btc = {
    can: function () { return (c.list || []).length ? '' : 'noLink'; },
    // server: { address, btc, uri, id, key } from the backend (per-donation address and amount).
    go: function (st, P, server) {
      var body = P.open('m.btc', 'bitcoin');
      var addr = server ? server.address : address();
      var grid = R.el('div', '__P__-panel-grid');
      var left = R.el('div');
      var dl = R.el('dl', '__P__-dl');
      left.appendChild(dl);
      var acts = R.el('div', '__P__-panel-acts');
      left.appendChild(acts);
      grid.appendChild(left);
      var q = R.el('div', '__P__-qr');
      grid.appendChild(q);
      body.appendChild(grid);
      function draw(btc) {
        dl.textContent = '';
        acts.textContent = '';
        var params = [];
        if (btc) params.push('amount=' + btc);
        var label = c.label || st.title;
        if (label) params.push('label=' + encodeURIComponent(label.slice(0, 60)));
        var uri = server && server.uri ? server.uri : 'bitcoin:' + addr + (params.length ? '?' + params.join('&') : '');
        R.copyRow(dl, R.t('address'), addr, addr, true);
        if (btc) R.copyRow(dl, R.t('amount'), btc + ' BTC', btc, true);
        else dl.appendChild(R.el('dd', '__P__-muted', R.t('noRate')));
        if (R.qr) q.innerHTML = R.qr(uri, 'Bitcoin');
        var a = R.el('a', '__P__-btn __P__-btn-sm __P__-btn-secondary', R.t('openWallet'));
        a.href = uri;
        acts.appendChild(a);
      }
      if (server && server.btc) draw(server.btc);
      else {
        draw('');
        R.price('BTC', st.cur).then(function (rate) {
          if (!(rate > 0)) return;
          draw(R.unitsText(R.units(st.amt / rate, 8), 8));
        });
      }
      if (server && server.id) P.watch(server.id, server.key); else R.pending(st, 'btc');
    },
  };
}

function rtMEth(R) {
  var c = (R.cfg.pay && R.cfg.pay.eth) || {};
  R.M = R.M || {};
  var found = [];
  // EIP-6963: wallets announce themselves on request; window.ethereum (EIP-1193) is the fallback.
  // Why: with several extensions installed, window.ethereum is whichever injected last; 6963 lets the donor choose.
  // Announcements arrive asynchronously, so the page listens for 450 ms. Wallet icons are accepted only as data:
  // image URLs of raster/SVG types - an announced icon is third-party input, and a remote URL would leak the visit.
  // Note: an SVG data URL in <img> cannot run script (images are sandboxed), so svg+xml is safe here.
  function discover() {
    return new Promise(function (resolve) {
      var seen = {};
      found = [];
      function on(e) {
        var d = e.detail || {};
        if (!d.provider || !d.info || seen[d.info.uuid]) return;
        seen[d.info.uuid] = 1;
        found.push({ name: String(d.info.name || 'Wallet'), icon: /^data:image\/(png|svg\+xml|webp|jpeg);/.test(d.info.icon || '') ? d.info.icon : '', p: d.provider });
      }
      window.addEventListener('eip6963:announceProvider', on);
      window.dispatchEvent(new Event('eip6963:requestProvider'));
      setTimeout(function () {
        window.removeEventListener('eip6963:announceProvider', on);
        if (!found.length && window.ethereum && typeof window.ethereum.request === 'function') found.push({ name: 'Browser wallet', icon: '', p: window.ethereum });
        resolve(found);
      }, 450);
    });
  }
  function hex(n) { return '0x' + BigInt(n).toString(16); }
  function pad(h) { h = h.replace(/^0x/, ''); while (h.length < 64) h = '0' + h; return h; }
  R.M.eth = {
    can: function () { return c.address && (c.chains || []).length ? '' : 'noLink'; },
    go: function (st, P, server) {
      var body = P.open('m.eth', 'ethereum');
      var chains = c.chains || [];
      var ch = chains[0];
      var tok = ch.tokens[0];
      var units = null;
      var row = R.el('div', '__P__-row2');
      var selC = R.el('select', '__P__-select');
      selC.setAttribute('aria-label', R.t('network'));
      chains.forEach(function (x, i) { var o = R.el('option', '', x.name + (x.test ? ' (test)' : '')); o.value = String(i); selC.appendChild(o); });
      var selT = R.el('select', '__P__-select');
      selT.setAttribute('aria-label', R.t('token'));
      row.appendChild(selC);
      row.appendChild(selT);
      body.appendChild(row);
      var grid = R.el('div', '__P__-panel-grid');
      var left = R.el('div');
      var dl = R.el('dl', '__P__-dl');
      left.appendChild(dl);
      var acts = R.el('div', '__P__-panel-acts');
      left.appendChild(acts);
      var status = R.el('div');
      left.appendChild(status);
      grid.appendChild(left);
      var q = R.el('div', '__P__-qr');
      grid.appendChild(q);
      body.appendChild(grid);
      function fillTokens() {
        selT.textContent = '';
        ch.tokens.forEach(function (t, i) { var o = R.el('option', '', t.s); o.value = String(i); selT.appendChild(o); });
        tok = ch.tokens[0];
      }
      // EIP-681: native 'ethereum:<to>@<chainId>?value=<wei>'; token 'ethereum:<token>@<chainId>/transfer?address=
      // <to>&uint256=<units>'. Chain id omitted for mainnet (1), as the EIP allows; integers only (no 1e18 notation).
      function uri() {
        var at = ch.id !== 1 ? '@' + ch.id : '';
        if (tok.n) return 'ethereum:' + c.address + at + (units ? '?value=' + units.toString() : '');
        return 'ethereum:' + tok.a + at + '/transfer?address=' + c.address + (units ? '&uint256=' + units.toString() : '');
      }
      function draw() {
        dl.textContent = '';
        R.copyRow(dl, R.t('address'), c.address, c.address, true);
        R.copyRow(dl, R.t('network'), ch.name);
        if (units) { var txt = R.unitsText(units, tok.d); R.copyRow(dl, R.t('amount'), txt + ' ' + tok.s, txt, true); }
        else dl.appendChild(R.el('dd', '__P__-muted', R.t('noRate')));
        if (!tok.n) dl.appendChild(R.el('dd', '__P__-small __P__-muted', R.t('tokenNote', { token: tok.s, network: ch.name })));
        if (R.qr) q.innerHTML = R.qr(uri(), 'Ethereum');
      }
      function update() {
        units = null;
        draw();
        R.price(tok.usd ? 'USD' : tok.s, st.cur).then(function (rate) {
          if (!(rate > 0)) return;
          units = R.units(st.amt / rate, tok.d);
          draw();
        });
      }
      selC.addEventListener('change', function () { ch = chains[+selC.value]; fillTokens(); update(); });
      selT.addEventListener('change', function () { tok = ch.tokens[+selT.value]; update(); });
      fillTokens();
      update();
      var pay = R.el('button', '__P__-btn __P__-btn-sm', R.t('payWallet'));
      pay.type = 'button';
      acts.appendChild(pay);
      function say(cls, text, href) {
        status.textContent = '';
        var p = R.el('p', '__P__-status ' + cls, text);
        status.appendChild(p);
        if (href) { var a = R.el('a', '', R.t('viewTx')); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; status.appendChild(a); }
      }
      // Wallet flow (EIP-1193): request accounts -> check chain -> switch chain if needed (error 4902 = chain unknown
      // to the wallet; adding it is left to the donor) -> send. Token transfers call transfer(address,uint256): selector
      // 0xa9059cbb + 32-byte left-padded address + 32-byte amount. Error 4001 = user rejected. After sending, a backend
      // (if any) is told the tx hash so it can verify on-chain; the page itself never treats "sent" as "paid".
      function send(w) {
        if (!units) { say('__P__-status-bad', R.t('noRate')); return; }
        var p = w.p;
        var from = '';
        say('__P__-status-wait', R.t('confirmWallet'));
        p.request({ method: 'eth_requestAccounts' }).then(function (acc) {
          from = acc && acc[0];
          return p.request({ method: 'eth_chainId' });
        }).then(function (cid) {
          if (parseInt(cid, 16) === ch.id) return null;
          say('__P__-status-wait', R.t('switchChain', { network: ch.name }));
          return p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex(ch.id) }] }).catch(function (e) {
            if (e && e.code === 4902) throw new Error(R.t('addChain', { network: ch.name }));
            throw e;
          });
        }).then(function () {
          var tx = tok.n ? { from: from, to: c.address, value: hex(units) }
            : { from: from, to: tok.a, value: '0x0', data: '0xa9059cbb' + pad(c.address.toLowerCase()) + pad(units.toString(16)) };
          return p.request({ method: 'eth_sendTransaction', params: [tx] });
        }).then(function (hash) {
          say('__P__-status-ok', R.t('txSent'), ch.x + '/tx/' + hash);
          if (server) {
            R.api.post('api/eth/claim', { site: R.api.site, campaign: st.camp, chain: ch.id, token: tok.s, tx: hash, from: from, amount: st.amt, currency: st.cur, interval: 'once', donor: st.donor, lang: R.lang() })
              .then(function (r) { if (r && r.id) P.watch(r.id, r.key); }, function () { /* the backend also scans for transfers */ });
          } else R.pending(st, 'eth');
        }).catch(function (e) {
          var msg = e && e.code === 4001 ? R.t('txRejected') : (e && e.message) || R.t('txFailed');
          say('__P__-status-bad', msg);
        });
      }
      pay.addEventListener('click', function () {
        pay.disabled = true;
        discover().then(function (list) {
          pay.disabled = false;
          if (!list.length) { say('__P__-status-bad', R.t('noWallet')); return; }
          if (list.length === 1) { send(list[0]); return; }
          status.textContent = '';
          var box = R.el('div', '__P__-wallets');
          list.forEach(function (w) {
            var b = R.el('button', '__P__-wallet');
            b.type = 'button';
            if (w.icon) { var im = R.el('img'); im.src = w.icon; im.alt = ''; b.appendChild(im); }
            b.appendChild(R.el('span', '', w.name));
            b.addEventListener('click', function () { send(w); });
            box.appendChild(b);
          });
          status.appendChild(box);
        });
      });
    },
  };
}

function rtDonate(R) {
  var cfg = R.cfg;
  var M = R.M || {};
  var routes = cfg.routes || {};
  // A row of transfer details with a copy button: dl, label, shown text, copied value, monospace.
  R.copyRow = function (dl, label, text, value, mono) {
    dl.appendChild(R.el('dt', '', label));
    var dd = R.el('dd', '__P__-copyrow');
    dd.appendChild(R.el('span', mono || /^[A-Z]{2}\d{2}/.test(text) ? '__P__-mono' : '', text));
    var b = R.el('button', '__P__-btn __P__-btn-ghost __P__-btn-sm', R.t('copy'));
    b.type = 'button';
    b.addEventListener('click', function () { R.copy(value != null ? value : text).then(function (ok) { b.textContent = ok ? R.t('copied') : R.t('copyFail'); R.live(b.textContent); setTimeout(function () { b.textContent = R.t('copy'); }, 1800); }); });
    dd.appendChild(b);
    dl.appendChild(dd);
  };
  // The donation this browser started (thank-you page without a backend).
  R.pending = function (st, m) {
    R.store.set(R.docKey('pending'), JSON.stringify({ m: m, a: st.amt, c: st.cur, i: st.int, camp: st.camp, ref: st.ref, t: Date.now() }));
  };
  function thanksURL(extra) {
    var base = location.href.split('#')[0].split('?')[0];
    var q = extra ? '?' + extra : '';
    if (!routes.thanks) return base + q + location.hash.split('?')[0];
    if (routes.mode === 'hash') return base + q + '#/' + routes.thanks;
    try { return new URL((routes.depth ? '../' : './') + routes.thanks + '/' + q, location.href).href; } catch (e) { return base + q; }
  }
  R.thanksURL = thanksURL;
  // Free-text amount in any locale: spaces, apostrophes (Swiss 1'000) and underscores are group marks. The last '.'
  // or ',' is the decimal mark unless (a) the other mark also occurs (then the other is grouping), or (b) the same
  // mark occurs twice, or (c) it is followed by exactly 3 digits after a 1-3 digit head ('1,000' / '1.000' read as a
  // thousand - the likelier intent for a donation). Anything else is NaN, never a guess.
  function parseAmt(v) {
    var s = String(v || '').replace(/[\s '’_]/g, '');
    if (!s) return NaN;
    var i = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    if (i >= 0) {
      var ch = s[i];
      var other = ch === '.' ? ',' : '.';
      var head = s.slice(0, i);
      var tail = s.slice(i + 1);
      if (s.indexOf(other) >= 0) s = head.split(other).join('') + '.' + tail;
      else if (head.indexOf(ch) >= 0 || (tail.length === 3 && /^[1-9]\d{0,2}$/.test(head))) s = s.split(ch).join('');
      else s = head + '.' + tail;
    }
    return /^\d+(\.\d+)?$/.test(s) ? +s : NaN;
  }
  function server(m, st) {
    var info = R.api && R.api.info;
    return !!(info && info.methods && info.methods[m] && (!info.currencies || !info.currencies[m] || info.currencies[m].indexOf(st.cur) >= 0));
  }
  function init(root) {
    var form = R.$('form', root);
    if (!form) return;
    var camp = root.getAttribute('data-camp');
    var c = R.camps[camp] || {};
    var st = { root: root, camp: camp, cur: c.cur || 'EUR', amt: +root.getAttribute('data-amt') || 0, int: root.getAttribute('data-int') || 'once', donor: {}, title: '', ref: '', reference: '' };
    var min = +form.getAttribute('data-min') || 0;
    var max = +form.getAttribute('data-max') || 1e9;
    var amts = R.$$('[data-amt]', form);
    var ints = R.$$('[data-int]', form);
    var custom = R.$('[data-__P__-custom]', form);
    var curSel = R.$('[data-__P__-cur]', form);
    var err = R.$('[data-__P__-err]', form);
    var panelEl = R.$('[data-__P__-panel]', form);
    var sum = R.$('[data-__P__-sum]', form);
    var impact = R.$('[data-__P__-impact]', form);
    var mBtns = R.$$('[data-m]', form);
    function title() { var t = c.title || {}; return t[R.lang()] || t[cfg.defaultLang] || document.title; }
    function fail(msg) { err.textContent = msg; err.hidden = !msg; if (msg) R.live(msg); }
    function sync() {
      amts.forEach(function (b) { b.setAttribute('aria-checked', String(!st.customOn && +b.getAttribute('data-amt') === st.amt)); });
      ints.forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-int') === st.int)); });
      R.$$('[data-__P__-money]', form).forEach(function (s) { s.textContent = R.fmt(+s.getAttribute('data-__P__-money'), st.cur); });
      var cs = R.$('[data-__P__-cursym]', form);
      if (cs) cs.textContent = st.cur;
      if (sum) sum.textContent = st.amt > 0 ? '· ' + R.fmt(st.amt, st.cur) + (st.int === 'month' ? ' ' + R.t('perMonth') : '') : '';
      // Impact: the largest line at or below the amount (lines of this campaign or without one).
      var best = null;
      R.$$('[data-__P__-imp]').forEach(function (el) {
        var cc = el.getAttribute('data-camp');
        el.classList.remove('__P__-on');
        if (cc && cc !== camp) return;
        var a = +el.getAttribute('data-__P__-imp');
        if (a <= st.amt && (!best || a >= +best.getAttribute('data-__P__-imp'))) best = el;
      });
      if (best) best.classList.add('__P__-on');
      if (impact) { var t = best && R.$('.__P__-imp-t', best); impact.textContent = t ? (t.innerText || t.textContent).trim() : ''; }
      // Method buttons: enabled when the backend serves the method (and currency) or the public fallback can. Buttons
      // that exist only for the backend (data-need-api) stay hidden until the probe has answered, so they neither
      // flash in nor disappear after load. The disabled reason becomes the tooltip.
      mBtns.forEach(function (b) {
        var m = b.getAttribute('data-m');
        var on = server(m, st);
        var h = M[m];
        var reason = on ? '' : h ? h.can(st) : 'unavailable';
        var apiKnown = !R.api || (R.api.info !== null || R.api.done);
        b.hidden = !on && (!h || b.hasAttribute('data-need-api')) && apiKnown;
        b.disabled = !!reason && !on;
        b.title = reason && !on ? R.t(reason) : '';
      });
    }
    amts.forEach(function (b) { b.addEventListener('click', function () { st.amt = +b.getAttribute('data-amt'); st.customOn = false; if (custom) custom.value = ''; fail(''); sync(); }); });
    ints.forEach(function (b) { b.addEventListener('click', function () { st.int = b.getAttribute('data-int'); sync(); }); });
    if (custom) custom.addEventListener('input', function () { var v = parseAmt(custom.value); if (v > 0) { st.amt = v; st.customOn = true; } else if (!custom.value) { st.customOn = false; st.amt = +(amts[1] || amts[0] || { getAttribute: function () { return 0; } }).getAttribute('data-amt'); } fail(''); sync(); });
    if (curSel) curSel.addEventListener('change', function () { st.cur = curSel.value; sync(); });
    // Panel of a method: header with a back button; note(): a line under the methods.
    var P = {
      open: function (key, ic) {
        panelEl.textContent = '';
        panelEl.hidden = false;
        var hd = R.el('div', '__P__-row2');
        hd.appendChild(R.el('h3', '__P__-panel-h', R.t(key)));
        var back = R.el('button', '__P__-btn __P__-btn-ghost __P__-btn-sm', R.t('back'));
        back.type = 'button';
        back.style.marginInlineStart = 'auto';
        back.addEventListener('click', function () { panelEl.hidden = true; panelEl.textContent = ''; var mb = R.$('[data-m]', form); if (mb) mb.focus(); });
        hd.appendChild(back);
        panelEl.appendChild(hd);
        var body = R.el('div', '__P__-panel-b');
        panelEl.appendChild(body);
        try { panelEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* old engines */ }
        void ic;
        return body;
      },
      note: function (msg) { fail(''); R.live(msg); if (sum) sum.textContent = msg; },
      // Status of a donation the backend knows (crypto): polled until it is final.
      // Every 15 s (30 s after errors), at most 240 polls ~ 1 h - block times make faster polling pointless.
      watch: function (id, key) {
        var line = R.el('p', '__P__-status __P__-status-wait', R.t('waitingPayment'));
        panelEl.appendChild(line);
        var n = 0;
        (function poll() {
          R.api.get('api/donations/' + encodeURIComponent(id) + '?k=' + encodeURIComponent(key)).then(function (x) {
            if (x.status === 'succeeded') { line.className = '__P__-status __P__-status-ok'; line.textContent = R.t('received'); var a = R.el('a', '__P__-btn __P__-btn-sm', R.t('continue')); a.href = thanksURL('d=' + encodeURIComponent(id) + '&k=' + encodeURIComponent(key)); panelEl.appendChild(a); return; }
            if (x.status === 'failed' || x.status === 'expired') { line.className = '__P__-status __P__-status-bad'; line.textContent = R.t('st.' + x.status); return; }
            if (++n < 240) setTimeout(poll, 15000);
          }, function () { if (++n < 240) setTimeout(poll, 30000); });
        })();
      },
    };
    function collect() {
      var dn = {};
      R.$$('[data-__P__-f]', form).forEach(function (el) {
        var k = el.getAttribute('data-__P__-f');
        dn[k] = el.type === 'checkbox' ? !!el.checked : String(el.value || '').trim();
      });
      return dn;
    }
    function check() {
      if (custom && custom.value && !(parseAmt(custom.value) > 0)) return R.t('chooseAmount');
      if (!(st.amt > 0)) return R.t('chooseAmount');
      if (st.amt < min) return R.t('minAmount', { min: R.fmt(min, st.cur) });
      if (st.amt > max) return R.t('maxAmount', { max: R.fmt(max, st.cur) });
      var em = R.$('[data-__P__-f=email]', form);
      if (em && em.required && !em.value.trim()) return R.t('needEmail');
      if (em && em.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em.value.trim())) return R.t('badEmail');
      return '';
    }
    // Short payment reference ('D' + 8 hex) for transfer purposes and Stripe client_reference_id: lets the owner match
    // a bank statement line to a donation. 32 bits are enough to disambiguate, not meant as a secret.
    function ref() {
      var b = new Uint8Array(4);
      try { crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 4; i++) b[i] = Math.random() * 256; }
      return 'D' + Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('').toUpperCase();
    }
    // Pay: validate, then prefer the backend (checkout redirect, per-donation BTC address, ETH claim after sending),
    // else the public method. Note the inverted reading of can(): it returns '' when usable, so `!h.can(st)` means
    // "can". The amount sent to the server is only a request - the server re-validates it against the campaign.
    function pay(m) {
      var e = check();
      if (e) { fail(e); return; }
      fail('');
      st.donor = collect();
      st.title = title();
      st.ref = ref();
      var purpose = cfg.pay && cfg.pay.bank && cfg.pay.bank.purpose ? cfg.pay.bank.purpose[R.lang()] || cfg.pay.bank.purpose[cfg.defaultLang] || '' : '';
      st.reference = (purpose ? purpose + ' ' : '') + st.ref;
      var h = M[m];
      if (server(m, st)) {
        var body = { site: R.api.site, campaign: camp, method: m, amount: st.amt, currency: st.cur, interval: st.int, donor: st.donor, lang: R.lang(), back: location.href, thanks: thanksURL('') };
        if (m === 'btc') {
          R.api.post('api/btc/address', body).then(function (r) { h.go(st, P, r); }, function (x) { fallback(m, x); });
          return;
        }
        if (m === 'eth') { h.go(st, P, true); return; }
        P.note(R.t('redirecting'));
        R.api.post('api/checkout', body).then(function (r) {
          if (r && r.url) { R.store.set(R.docKey('pending'), JSON.stringify({ m: m, a: st.amt, c: st.cur, i: st.int, camp: camp, t: Date.now() })); R.go(r.url); } else fallback(m, null);
        }, function (x) { fallback(m, x); });
        return;
      }
      if (h && !h.can(st)) h.go(st, P, null);
    }
    // A 4xx is the server refusing this request (bad amount, currency): show its message, do not silently switch to
    // a fallback that would accept what the server refused. Network errors / 5xx: use the public method if possible.
    function fallback(m, x) {
      var h = M[m];
      if (x && x.status && x.status >= 400 && x.status < 500) { fail((x.body && x.body.error) || R.t('serverDown')); return; }
      if (h && !h.can(st)) { R.live(R.t('serverDown')); h.go(st, P, null); return; }
      fail(R.t('serverDown'));
    }
    mBtns.forEach(function (b) { b.addEventListener('click', function () { pay(b.getAttribute('data-m')); }); });
    // A tier picked on another page (sessionStorage) or the URL (?amount=25&interval=month).
    try {
      var pk = JSON.parse(sessionStorage.getItem('__P__-pick') || 'null');
      if (pk && pk.camp === camp) { st.amt = +pk.amt || st.amt; st.int = pk.int || st.int; sessionStorage.removeItem('__P__-pick'); }
    } catch (e) { /* storage blocked */ }
    var qa = parseAmt(R.param('amount'));
    if (qa > 0) { st.amt = qa; if (custom && !amts.some(function (b) { return +b.getAttribute('data-amt') === qa; })) { custom.value = String(qa); st.customOn = true; } }
    if (R.param('interval') === 'month' || R.param('interval') === 'once') st.int = R.param('interval');
    st.pick = function (amt, int) { st.amt = amt; st.int = int || st.int; st.customOn = !amts.some(function (b) { return +b.getAttribute('data-amt') === amt; }); if (custom) custom.value = st.customOn ? String(amt) : ''; fail(''); sync(); };
    forms.push(st);
    sync();
    if (R.api) R.api.ready.then(function () { R.api.done = true; sync(); });
    document.addEventListener('__P__:lang', sync);
  }
  var forms = [];
  R.$$('[data-__P__-don]').forEach(init);
  // Tier buttons: choose the amount in the donate form of this page, or carry it to the campaign's page.
  // Delegated on document (one listener for any number of tiers). Cross-page hand-off uses sessionStorage (this tab
  // only, consumed once by the target form) so the link itself can stay a plain href that works without JS.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('[data-__P__-pick]') : null;
    if (!a) return;
    var camp = a.getAttribute('data-camp');
    var amt = +a.getAttribute('data-amt');
    var int = a.getAttribute('data-int');
    var page = R.currentPage ? R.currentPage() : null;
    var here = forms.filter(function (f) { return (!camp || f.camp === camp) && (!page || page.contains(f.root)); })[0];
    if (here) {
      e.preventDefault();
      here.pick(amt, int);
      try { here.root.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (x) { /* ignore */ }
      var m = R.$('[data-m]:not([hidden]):not(:disabled)', here.root);
      if (m) setTimeout(function () { m.focus({ preventScroll: true }); }, 400);
      return;
    }
    try { sessionStorage.setItem('__P__-pick', JSON.stringify({ camp: camp, amt: amt, int: int })); } catch (x) { /* blocked */ }
  });
}

export {
  rtDonate,
  rtMBank,
  rtMBtc,
  rtMEth,
  rtMPaypal,
  rtMStripe,
  rtMTbc,
  rtPrice
};
