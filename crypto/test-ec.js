// crypto/test-ec.js - unit tests of secp256k1.js (run by crypto/test.js, or alone: `node crypto/test-ec.js`).
// Official vectors: every BIP-340 Schnorr vector (bip-0340/test-vectors.csv), the 464 Wycheproof ECDSA secp256k1
// SHA-256 vectors of the Bitcoin variant (strict DER, low S; secp256k1-wycheproof.json), the BIP-341 key-path tweak.
// Cross-checks against OpenSSL through node:crypto with random keys: public keys, ECDH, ECDSA both ways.
// The RFC 6979 nonces are checked with the widely used vectors of trezor-crypto / python-ecdsa.
//
// Three independent oracles on purpose: specification vectors (BIP-340, BIP-341), adversarial vectors (Wycheproof:
// malformed DER, edge-case r / s, points at infinity - the cases a happy-path test never hits), and a differential
// check against OpenSSL on random keys (catches carry / reduction bugs that fixed vectors happen to miss).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as nodeCrypto from 'node:crypto';
import {
  CURVE, Point, Signature, ecdsaRecover, ecdsaSign, ecdsaVerify, getPublicKey, getSharedSecret, isValidPrivateKey,
  isValidPublicKey, liftX, privateAdd, privateMultiply, privateNegate, publicAdd, publicCombine, publicMultiply,
  schnorrPublicKey, schnorrSign, schnorrVerify, taprootOutputKey, taprootTweakPrivateKey, convertPublicKey,
} from './secp256k1.js';
import { sha256 } from './sha2.js';
import { bytesToHex, hexToBytes } from './encoding.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const BIP340 = `0,0000000000000000000000000000000000000000000000000000000000000003,F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9,0000000000000000000000000000000000000000000000000000000000000000,0000000000000000000000000000000000000000000000000000000000000000,E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0,TRUE
1,B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF,DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,0000000000000000000000000000000000000000000000000000000000000001,243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,6896BD60EEAE296DB48A229FF71DFE071BDE413E6D43F917DC8DCF8C78DE33418906D11AC976ABCCB20B091292BFF4EA897EFCB639EA871CFA95F6DE339E4B0A,TRUE
2,C90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B14E5C9,DD308AFEC5777E13121FA72B9CC1B7CC0139715309B086C960E18FD969774EB8,C87AA53824B4D7AE2EB035A2B5BBBCCC080E76CDC6D1692C4B0B62D798E6D906,7E2D58D8B3BCDF1ABADEC7829054F90DDA9805AAB56C77333024B9D0A508B75C,5831AAEED7B44BB74E5EAB94BA9D4294C49BCF2A60728D8B4C200F50DD313C1BAB745879A5AD954A72C45A91C3A51D3C7ADEA98D82F8481E0E1E03674A6F3FB7,TRUE
3,0B432B2677937381AEF05BB02A66ECD012773062CF3FA2549E44F58ED2401710,25D1DFF95105F5253C4022F628A996AD3A0D95FBF21D468A1B33F8C160D8F517,FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF,FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF,7EB0509757E246F19449885651611CB965ECC1A187DD51B64FDA1EDC9637D5EC97582B9CB13DB3933705B32BA982AF5AF25FD78881EBB32771FC5922EFC66EA3,TRUE
4,,D69C3509BB99E412E68B0FE8544E72837DFA30746D8BE2AA65975F29D22DC7B9,,4DF3C3F68FCC83B27E9D42C90431A72499F17875C81A599B566C9889B9696703,00000000000000000000003B78CE563F89A0ED9414F5AA28AD0D96D6795F9C6376AFB1548AF603B3EB45C9F8207DEE1060CB71C04E80F593060B07D28308D7F4,TRUE
5,,EEFDEA4CDB677750A420FEE807EACF21EB9898AE79B9768766E4FAA04A2D4A34,,243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E17776969E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B,FALSE
6,,DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,,243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,FFF97BD5755EEEA420453A14355235D382F6472F8568A18B2F057A14602975563CC27944640AC607CD107AE10923D9EF7A73C643E166BE5EBEAFA34B1AC553E2,FALSE
7,,DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,,243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,1FA62E331EDBC21C394792D2AB1100A7B432B013DF3F6FF4F99FCB33E0E1515F28890B3EDB6E7189B630448B515CE4F8622A954CFE545735AAEA5134FCCDB2BD,FALSE
8,,DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,,243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E177769961764B3AA9B2FFCB6EF947B6887A226E8D7C93E00C5ED0C1834FF0D0C2E6DA6,FALSE
9,,DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,,243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,0000000000000000000000000000000000000000000000000000000000000000123DDA8328AF9C23A94C1FEECFD123BA4FB73476F0D594DCB65C6425BD186051,FALSE
10,,DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,,243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,00000000000000000000000000000000000000000000000000000000000000017615FBAF5AE28864013C099742DEADB4DBA87F11AC6754F93780D5A1837CF197,FALSE
11,,DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,,243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,4A298DACAE57395A15D0795DDBFD1DCB564DA82B0F269BC70A74F8220429BA1D69E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B,FALSE
12,,DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,,243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F69E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B,FALSE
13,,DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659,,243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E177769FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141,FALSE
14,,FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC30,,243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89,6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E17776969E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B,FALSE
15,0340034003400340034003400340034003400340034003400340034003400340,778CAA53B4393AC467774D09497A87224BF9FAB6F6E68B23086497324D6FD117,0000000000000000000000000000000000000000000000000000000000000000,,71535DB165ECD9FBBC046E5FFAEA61186BB6AD436732FCCC25291A55895464CF6069CE26BF03466228F19A3A62DB8A649F2D560FAC652827D1AF0574E427AB63,TRUE
16,0340034003400340034003400340034003400340034003400340034003400340,778CAA53B4393AC467774D09497A87224BF9FAB6F6E68B23086497324D6FD117,0000000000000000000000000000000000000000000000000000000000000000,11,08A20A0AFEF64124649232E0693C583AB1B9934AE63B4C3511F3AE1134C6A303EA3173BFEA6683BD101FA5AA5DBC1996FE7CACFC5A577D33EC14564CEC2BACBF,TRUE
17,0340034003400340034003400340034003400340034003400340034003400340,778CAA53B4393AC467774D09497A87224BF9FAB6F6E68B23086497324D6FD117,0000000000000000000000000000000000000000000000000000000000000000,0102030405060708090A0B0C0D0E0F1011,5130F39A4059B43BC7CAC09A19ECE52B5D8699D1A71E3C52DA9AFDB6B50AC370C4A482B77BF960F8681540E25B6771ECE1E5A37FD80E5A51897C5566A97EA5A5,TRUE
18,0340034003400340034003400340034003400340034003400340034003400340,778CAA53B4393AC467774D09497A87224BF9FAB6F6E68B23086497324D6FD117,0000000000000000000000000000000000000000000000000000000000000000,99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999,403B12B0D8555A344175EA7EC746566303321E5DBFA8BE6F091635163ECA79A8585ED3E3170807E7C03B720FC54C7B23897FCBA0E9D0B4A06894CFD249F22367,TRUE`;

// RFC 6979 + secp256k1 + SHA-256 (trezor-crypto test_rfc6979 / python-ecdsa): [private key, message, r || s (low S)].
const RFC6979 = [
  ['0000000000000000000000000000000000000000000000000000000000000001', 'Satoshi Nakamoto',
    '934b1ea10a4b3c1757e2b0c017d0b6143ce3c9a7e6a4a49860d7a6ab210ee3d82442ce9d2b916064108014783e923ec36b49743e2ffa1c4496f01a512aafd9e5'],
  ['0000000000000000000000000000000000000000000000000000000000000001', 'All those moments will be lost in time, like tears in rain. Time to die...',
    '8600dbd41e348fe5c9465ab92d23e3db8b98b873beecd930736488696438cb6b547fe64427496db33bf66019dacbf0039c04199abb0122918601db38a72cfc21'],
  ['f8b8af8ce3c7cca5e300d33939540c10d45ce001b8f252bfbc57ba0342904181', 'Alan Turing',
    '7063ae83e7f62bbb171798131b4a0564b956930092b33b07b395615d9ec7e15c58dfcc1e00a35e1572f366ffe34ba0fc47db1e7189759b9fb233c5b05ab388ea'],
  ['e91671c46231f833a6406ccbea0e3e392c76c167bac1cb013f6f1013980455c2', 'There is a computer disease that anybody who works with computers knows about. It\'s a very serious disease and it interferes completely with the work. The trouble with computers is that you \'play\' with them!',
    'b552edd27580141f3b2a5463048cb7cd3e047b97c9f98076c32dbdf85a68718b279fa72dd19bfae05577e06c7c0c1900c371fcd5893f7e1d56a37d30174671f6'],
];

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const throws = (name, fn) => { try { fn(); fail++; console.log(`FAIL ${name}: no error`); } catch { pass++; } };
  const hex = bytesToHex;

  // Curve basics.
  eq('G', hex(getPublicKey(1n, false)), '04' + CURVE.Gx.toString(16) + CURVE.Gy.toString(16));
  eq('2G', Point.BASE.double().x.toString(16), 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');
  eq('2G = G + G', Point.BASE.add(Point.BASE).equals(Point.BASE.multiply(2n)), true);
  eq('n·G = infinity', Point.BASE.multiply(CURVE.n).isZero, true);
  eq('(n-1)·G = -G', Point.BASE.multiply(CURVE.n - 1n).equals(Point.BASE.negate()), true);
  eq('3G via variable base', Point.fromBytes(getPublicKey(1n)).multiply(3n).equals(Point.fromPrivateKey(3n)), true);
  eq('G - G', Point.BASE.subtract(Point.BASE).isZero, true);
  eq('private key range', [0n, 1n, CURVE.n - 1n, CURVE.n].map(isValidPrivateKey), [false, true, true, false]);
  throws('infinity has no encoding', () => Point.ZERO.toBytes());
  throws('x not on curve', () => Point.fromBytes('02' + 'EEFDEA4CDB677750A420FEE807EACF21EB9898AE79B9768766E4FAA04A2D4A34'));
  throws('hybrid encoding', () => Point.fromBytes('06' + CURVE.Gx.toString(16) + CURVE.Gy.toString(16)));
  eq('valid public keys', [getPublicKey(5n), getPublicKey(5n, false), new Uint8Array(33)].map(isValidPublicKey), [true, true, false]);
  eq('compress / decompress', hex(convertPublicKey(convertPublicKey(getPublicKey(77n), false))), hex(getPublicKey(77n)));

  // Cross-checks with OpenSSL (node:crypto): random keys, public keys, ECDH and ECDSA in both directions.
  // OpenSSL returns private keys without leading zero bytes (31 bytes about once in 256 keys): pad them to 32.
  const priv32 = (ecdh) => { const k = ecdh.getPrivateKey(), out = new Uint8Array(32); out.set(k, 32 - k.length); return out; };
  for (let i = 0; i < 24; i++) {
    const a = nodeCrypto.createECDH('secp256k1'); a.generateKeys();
    const b = nodeCrypto.createECDH('secp256k1'); b.generateKeys();
    const da = priv32(a), db = priv32(b);
    eq(`openssl public key ${i}`, hex(getPublicKey(da, false)), a.getPublicKey('hex'));
    eq(`openssl compressed ${i}`, hex(getPublicKey(da)), a.getPublicKey('hex', 'compressed'));
    eq(`openssl ecdh ${i}`, hex(getSharedSecret(da, b.getPublicKey()).subarray(1)), a.computeSecret(b.getPublicKey('hex'), 'hex', 'hex'));
    const jwk = (ecdh) => {
      const pub = ecdh.getPublicKey();
      const b64 = (x) => Buffer.from(x).toString('base64url');
      return { kty: 'EC', crv: 'secp256k1', x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33)), d: b64(priv32(ecdh)) };
    };
    const priv = nodeCrypto.createPrivateKey({ key: jwk(a), format: 'jwk' });
    const pubKey = nodeCrypto.createPublicKey({ key: { ...jwk(a), d: undefined }, format: 'jwk' });
    const msg = nodeCrypto.randomBytes(1 + i * 7);
    const ours = ecdsaSign(sha256(msg), da);
    eq(`openssl verifies ours ${i}`, nodeCrypto.verify('sha256', msg, pubKey, Buffer.from(ours.toDER())), true);
    const theirs = Signature.fromDER(nodeCrypto.sign('sha256', msg, priv));
    eq(`we verify openssl ${i}`, ecdsaVerify(theirs, sha256(msg), a.getPublicKey()), true);
    eq(`we reject another message ${i}`, ecdsaVerify(theirs, sha256(Buffer.concat([msg, Buffer.of(1)])), a.getPublicKey()), false);
    eq(`recovery ${i}`, hex(ecdsaRecover(ours, ours.recovery, sha256(msg), false)), a.getPublicKey('hex'));
    eq(`low S ${i}`, ours.hasHighS(), false);
  }

  // RFC 6979 deterministic nonces.
  for (const [d, m, sig] of RFC6979) {
    const s = ecdsaSign(sha256(m), hexToBytes(d));
    eq(`rfc6979 ${m.slice(0, 16)}`, hex(s.toCompact()), sig);
    eq(`rfc6979 recover ${m.slice(0, 16)}`, hex(s.recoverPublicKey(sha256(m))), hex(getPublicKey(hexToBytes(d))));
  }
  // Extra entropy changes the nonce, the signature still verifies.
  const e1 = ecdsaSign(sha256('x'), 9n), e2 = ecdsaSign(sha256('x'), 9n, { extraEntropy: new Uint8Array(32).fill(1) });
  eq('extra entropy', [e1.r === e2.r, ecdsaVerify(e2, sha256('x'), getPublicKey(9n))], [false, true]);
  // High S: valid for plain ECDSA, rejected with lowS.
  const hi = new Signature(e1.r, CURVE.n - e1.s);
  eq('high S', [ecdsaVerify(hi, sha256('x'), getPublicKey(9n)), ecdsaVerify(hi, sha256('x'), getPublicKey(9n), { lowS: true })], [true, false]);
  eq('normalizeS', hex(hi.normalizeS().toCompact()), hex(e1.toCompact()));
  eq('DER round trip', hex(Signature.fromDER(e1.toDER()).toCompact()), hex(e1.toCompact()));
  eq('DER small r', hex(new Signature(1n, 0x80n).toDER()), '300702010102020080');
  throws('DER padding', () => Signature.fromDER('30080202000102020080'));
  throws('DER negative', () => Signature.fromDER('300702018102020080'));
  throws('DER trailing', () => Signature.fromDER('30080201010202008000'));
  throws('recovery id', () => ecdsaRecover(e1, 4, sha256('x')));

  // Wycheproof ECDSA secp256k1 SHA-256, Bitcoin variant: strict DER + low S.
  const wy = JSON.parse(fs.readFileSync(path.join(HERE, 'secp256k1-wycheproof.json'), 'utf8'));
  let wyOk = 0, wyBad = [];
  for (const [pub, tests] of wy.groups) {
    for (const [id, msg, sig, valid] of tests) {
      let got;
      try { got = ecdsaVerify(Signature.fromDER(sig), sha256(hexToBytes(msg)), hexToBytes(pub), { lowS: true }); } catch { got = false; }
      if (got === !!valid) wyOk++; else wyBad.push(id);
    }
  }
  eq(`wycheproof ${wy.numberOfTests} vectors`, [wyOk, wyBad.slice(0, 10)], [wy.numberOfTests, []]);

  // BIP-340 Schnorr: every vector of the BIP.
  for (const line of BIP340.split('\n')) {
    const [i, sk, pk, aux, msg, sig, ok] = line.split(',');
    if (sk) {
      eq(`bip340 ${i} public key`, hex(schnorrPublicKey(hexToBytes(sk))).toUpperCase(), pk);
      eq(`bip340 ${i} sign`, hex(schnorrSign(hexToBytes(msg), hexToBytes(sk), hexToBytes(aux))).toUpperCase(), sig);
    }
    eq(`bip340 ${i} verify`, schnorrVerify(hexToBytes(sig), hexToBytes(msg), hexToBytes(pk)), ok === 'TRUE');
  }
  eq('lift_x even', liftX(hexToBytes('F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9')).hasEvenY(), true);

  // BIP-341: output key of an internal key without scripts, and the tweaked private key (wallet-test-vectors.json).
  const tw = taprootOutputKey(hexToBytes('d6889cb081036e0faefa3a35157ad71086b123b2b144b649798b494c300a961d'));
  eq('taproot output key', hex(tw.key), '53a1f6e454df1aa2776a2814a721372d6258050de330b3c6d10ee8f4e0dda343');
  eq('taproot tweaked private key', hex(taprootTweakPrivateKey(hexToBytes('6b973d88838f27366ed61c9ad6367663045cb456e28335c109e30717ae0c6baa'))),
    '2405b971772ad26915c8dcdf10f238753a9b837e5f8e6a86fd7c0cce5b7296d9');

  // Tweaks: private and public sides agree.
  const t = sha256('tweak');
  eq('privateAdd ~ publicAdd', hex(getPublicKey(privateAdd(11n, t))), hex(publicAdd(getPublicKey(11n), t)));
  eq('privateMultiply ~ publicMultiply', hex(getPublicKey(privateMultiply(11n, t))), hex(publicMultiply(getPublicKey(11n), t)));
  eq('privateNegate', hex(getPublicKey(privateNegate(11n))), hex(Point.fromPrivateKey(11n).negate().toBytes()));
  eq('publicCombine', hex(publicCombine([getPublicKey(5n), getPublicKey(6n)])), hex(getPublicKey(11n)));
  throws('tweak >= n', () => privateAdd(1n, hexToBytes(CURVE.n.toString(16))));
  throws('tweak to zero', () => privateAdd(CURVE.n - 1n, hexToBytes('00'.repeat(31) + '01')));

  console.log(`crypto secp256k1: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
