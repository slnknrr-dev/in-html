// walletui/test.js - unit tests of the DOM-free parts of the wallet UI library: `node walletui/test.js` (vault
// encryption with Argon2id and scrypt, wrong passwords, tampering, the session with a memory store and auto-lock,
// multi-part QR texts, formatting helpers).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultSession, openVault, sealVault, openWithKey, sealWithKey } from './vault.js';
import { joinParts, splitParts } from './qr.js';
import { short, bytes, pct } from './format.js';

// Only the DOM-free modules are tested here (vault crypto, QR splitting, formatting), so it runs in plain Node.
// Run only when executed directly; importing run() has no side effects.
const isMain = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function run() {
  let pass = 0, fail = 0;
  const eq = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  };
  const rejects = async (name, p, code) => { try { await p; fail++; console.log(`FAIL ${name}: no error`); } catch (e) { eq(name, e.code, code); } };
  const fast = { name: 'argon2id', m: 256, t: 1, p: 1 };
  const data = { wallets: [{ mnemonic: 'abandon … about' }], book: [] };
  const { envelope, key } = await sealVault(data, 'correct horse', { kdf: fast });
  eq('envelope shape', [envelope.format, envelope.cipher, envelope.kdf.name, typeof envelope.kdf.salt], ['in-html-vault', 'aes-256-gcm', 'argon2id', 'string']);
  eq('open', (await openVault(envelope, 'correct horse')).data, data);
  await rejects('wrong password', openVault(envelope, 'wrong'), 'password');
  const tampered = { ...envelope, ct: envelope.ct.slice(0, -4) + (envelope.ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA') };
  await rejects('tampered', openVault(tampered, 'correct horse'), 'password');
  eq('reseal with key', openWithKey(sealWithKey({ x: 1 }, key, envelope.kdf), key), { x: 1 });
  const sc = await sealVault({ y: 2 }, 'pw', { kdf: { name: 'scrypt', N: 1024, r: 8, p: 1 } });
  eq('scrypt vault', (await openVault(sc.envelope, 'pw')).data, { y: 2 });
  await rejects('not a vault', openVault({ hello: 1 }, 'pw'), 'format');

  let locked = null;
  const s = new VaultSession({ storageKey: 'v', kdf: fast, onLock: (why) => { locked = why; } });
  eq('session empty', s.exists(), false);
  await s.create('pw1', { a: 1 });
  s.data.a = 2;
  s.save();
  s.lock();
  eq('session locked', [s.unlocked, locked], [false, 'manual']);
  eq('session unlock', await s.unlock('pw1'), { a: 2 });
  await s.changePassword('pw1', 'pw2');
  s.lock();
  await rejects('old password gone', s.unlock('pw1'), 'password');
  eq('new password', await s.unlock('pw2'), { a: 2 });
  s.setAutoLock(1);
  s.lastActive = Date.now() - 120000;
  await new Promise((r) => setTimeout(r, 5200));
  eq('auto-lock', [s.unlocked, locked], [false, 'timeout']);
  s.destroy();
  eq('destroyed', s.exists(), false);

  const long = 'x'.repeat(2500);
  const parts = splitParts(long, 1000);
  eq('qr parts', [parts.length, parts[0].slice(0, 5), joinParts([parts[2], parts[0], parts[1]]) === long, joinParts(parts.slice(1))], [3, 'p1of3', true, null]);
  eq('format', [short('0123456789abcdef0123', 4, 4), bytes(2048), pct(0.1234)], ['0123…0123', '2.0 kB', '12.3 %']);
  console.log(`walletui: ${pass} passed, ${fail} failed`);
  return fail;
}

if (isMain) process.exitCode = (await run()) ? 1 : 0;
