// archive-processor/e2e-app.js - end-to-end scenario for the built page:
//   node check.js e2e archive-processor/html@5_offline_singlefile/index.html archive-processor/e2e-app.js --lang en
// Opening (drop), tree, search, keyboard, test, extraction to ZIP and single files, passwords (data and headers),
// preview, language switch. The archives below were made with 7-Zip and Python (base64).
// 
// Technique: runs inside the page. Inputs are synthesised (DataTransfer + DragEvent for drops); downloads are captured by
// patching HTMLAnchorElement.prototype.click (download helpers click a temporary <a download>). until() polls a
// condition instead of fixed sleeps: worker jobs take variable time. Each step records ok/FAIL instead of throwing, so
// one failure does not hide the rest of the report.
export default async function () {
  const DATA = {"lzma2.7z":"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","pw-aes.zip":"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","pw-mhe.7z":"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","text.xz":"/Td6WFoAAArh+wyhAgAhARYAAAB0L+Wj4APnAU1dADoYSwwkcl7ucqBTh2DkCgzc9NmuD2LrUFzplMs5dhthNZp/uSkbextEbc9vOUPhn9Oc/el0mh72/LUKJzuVUzNBT6zjwMZLzKwxy8Gdox1Y28GCQ0qQgxCbkLZRfKkZH9QZ6dTUHdS7vs7DPhqrwRoqeHW50ccEdZud/0mr+IW1j3b9dSenRLasyfK9uuaG+y1WzzirKQAGzausNMbyPJNva9Qf2qjXxiU/HRByyGX79TBd9XsrbIkekJcmIB9v1weXKqPlwkjudBrTUipUauEvvarboMUez9RnXOZf4kg2MBppXh/VSqIWt0Lj1BniSDgftqXClCZgvos2g1OkuswuKrwtnoSLvzBMRQ8ujDaPy206W9qcZKahNlbC3P2ef5bk6Y21hLtjBWA60BaBQ/SA3TQP0PO3lMxSmrWtw2ZT603fgEQaGiAC/6zxZgAAAADzmFvnB2XClCoe7y85N64MmRFuKun9XltH8OPMFp7SIQABgQPoBwAAIhadR7bp3xwCAAAAAApZWgAAAAD9N3pYWgAABObWtEYCAQQAIQEWAA2GNR/gB88CQl0AOhhABkG+Ejtpz/kKPU5t0Z9LVG0VogYkCUB2ZqOI8P246eFFJMvXqcxeK4OmQ0uhFNiVRvvsFHP42eGHSWgqZEB692iE+6vWb5HF9oAPfQizjxh9jpDHuVqbgIKF6l2R9CU2/yJaFfEPUEDdwgls8yNccpSlGxLtW2/V5cCaKJWjsD3Mq/V27sUkkCoYKegp3vWfGlw1wtm7srM8jiXhVYkUYm/9jCtVp+1JvfVPo7Ii0dMaugqopp4NyrE/fxku4RwpgGt3Iu7Q70ff9/rBBj1HAa/XUhOXs1Fd8ro0HgheGN33dNmYkTcHPI3EgRHzBQKacwtnv/9VDsC+sIp+uBhNCkhbaiXkUSE0Wi99f2mfT6WDFxwG+vUczHVn4WQAhLH8PDpxTmwBza/TRmjDoYdPuBE0xVMbTYwrsvAJmbxZUSR0ennb8lBEp9Z0b/vwrATUL2Nkv6uns6SgCcU3fQotyGT4FZliUxatlwYEbotKizf3Ui7kGZtuB69MjVyzrt2PZOaGO+CgE6TiW8VjqzdJnUr6K0DMEZsJZAuADuwKUN+OMFIB3cctbFZGMFQixI5BuHjYYZGe00OKq3jjCvsp0sFH2emcxIHdAIfUlQos0IrZQHWb63kpcjj86pnffdZ+7HQ3RTXKFgZGDd7BySlJTE4iGwSxfDg/6hzAE4u1Z17h9wdFg9tntK3UBJhelUSvpBeP1Nprf4DzSEZ4dNLOI1PNehKjU+kODk8yIPTAFrQYV971YSQvsqcRqYnaOJwAAACVB0VhDXXapgAB3gTQDwAA5vHpM7HEZ/sCAAAAAARZWg=="};
  const steps = [];
  const ok = (name, cond, value) => steps.push([name, cond ? 'ok' : 'FAIL', value]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { let v; try { v = fn(); } catch { v = null; } if (v) return v; await sleep(40); } return null; };
  const file = (name) => new File([Uint8Array.from(atob(DATA[name]), (c) => c.charCodeAt(0))], name);
  const rows = () => [...document.querySelectorAll('.ax-row')];
  const row = (text) => rows().find((r) => r.querySelector('.ax-base') && r.querySelector('.ax-base').textContent === text);
  const downloads = [];
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push({ name: this.download, href: this.href }); else origClick.call(this); };
  const drop = (files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    document.querySelector('.ap-drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  };
  const pressPassword = async (pw) => {
    const back = await until(() => [...document.querySelectorAll('.ed-backdrop:not(.ed-out)')].find((b) => b.querySelector('.ax-pw')));
    if (!back) return false;
    back.querySelector('.ax-pw').value = pw;
    back.querySelector('.ed-dlg-foot .ed-primary').click();
    return true;
  };

  await until(() => document.documentElement.dataset.engine && document.documentElement.dataset.engine !== 'starting', 10000);
  ok('engine', document.documentElement.dataset.engine === 'worker', document.documentElement.dataset.engine);
  // 1. drop a 7z on the drop zone
  drop([file('lzma2.7z')]);
  ok('listing', await until(() => rows().length >= 7), rows().length);
  ok('summary', /7z/.test(document.querySelector('.ax-kv').textContent), document.querySelector('.ax-kv').textContent.slice(0, 120));
  // 2. tree: open dir, then dir/sub via keyboard
  row('dir').click();
  ok('folder opens', await until(() => row('sub')), rows().map((r) => r.textContent).join('|').slice(0, 200));
  const body = document.querySelector('.ax-body');
  body.focus();
  const key = (k) => body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  key('Home'); key('ArrowDown'); key('ArrowRight');
  ok('keyboard opens sub', await until(() => row('note.md')), rows().length);
  key('ArrowDown'); key(' ');
  ok('keyboard selects', await until(() => /1/.test(document.querySelector('.ax-selinfo').textContent)), document.querySelector('.ax-selinfo').textContent);
  // 3. search
  const search = document.querySelector('.ax-search');
  search.value = '*.txt'; search.dispatchEvent(new Event('input'));
  await sleep(50);
  ok('search *.txt', rows().length === 3, rows().map((r) => r.textContent).join('|'));
  search.value = ''; search.dispatchEvent(new Event('input'));
  // 4. test
  document.querySelector('.ax-tools .ed-btn:not(.ed-primary)').click();
  const rep = await until(() => document.querySelector('.ax-test-head'));
  ok('test archive (selection)', rep && /no errors/.test(rep.textContent), rep && rep.textContent);
  document.querySelector('.ed-dialog .ed-dlg-foot .ed-primary').click();
  await sleep(250);
  // 5. extract everything -> one ZIP download
  document.querySelector('.ax-selinfo') && document.querySelector('.ax-c-check input').click(); // header box: select all
  await sleep(50);
  document.querySelector('.ax-tools .ed-primary').click();
  await until(() => downloads.length);
  const z = downloads[0];
  let zipOk = false;
  if (z) { const b = new Uint8Array(await (await fetch(z.href)).arrayBuffer()); zipOk = b[0] === 0x50 && b[1] === 0x4b && b.length > 3000; }
  ok('extract all -> ZIP', z && /\.zip$/.test(z.name) && zipOk, z && z.name);
  // 6. preview a text file
  row('text.txt').click();
  const pre = await until(() => document.querySelector('.ax-text'));
  ok('preview', pre && pre.textContent.startsWith('alpha') || (pre && pre.textContent.length > 100), pre && pre.textContent.slice(0, 40));
  document.querySelector('.ed-dialog .ed-iconbtn').click();
  await sleep(250);
  // 7. encrypted ZIP: extracting one file asks for the password; a wrong one is reported, the right one works
  window.__archproc.openFiles([file('pw-aes.zip')]);
  await until(() => document.querySelector('.ax-arcname') && document.querySelector('.ax-arcname').textContent === 'pw-aes.zip' && row('text.txt'));
  downloads.length = 0;
  row('text.txt').querySelector('.ax-check').click();
  document.querySelector('.ax-tools .ed-primary').click();
  ok('password asked', await pressPassword('wrong'));
  const err = await until(() => document.querySelector('.ed-dialog .ax-error'));
  ok('wrong password reported', !!err, err && err.textContent);
  await pressPassword('fixture');
  await until(() => downloads.length);
  ok('single file download', downloads.length === 1 && downloads[0].name === 'text.txt', downloads.map((d) => d.name).join(','));
  if (downloads[0]) { const t = await (await fetch(downloads[0].href)).text(); ok('extracted text', t.startsWith(t.slice(0, 5)) && t.length === 3000, t.length); }
  // 8. encrypted headers: the password is asked when opening
  window.__archproc.openFiles([file('pw-mhe.7z')]);
  ok('header password asked', await pressPassword('fixture'));
  ok('encrypted listing', await until(() => document.querySelector('.ax-arcname').textContent === 'pw-mhe.7z' && row('text.txt')), rows().length);
  ok('summary says names encrypted', /names|yes/.test(document.querySelector('.ax-kv').textContent));
  // 9. single-stream file
  window.__archproc.openFiles([file('text.xz')]);
  ok('xz single entry', await until(() => document.querySelector('.ax-arcname').textContent === 'text.xz' && row('text')), rows().map((r) => r.textContent).join('|'));
  // 10. language switch re-renders the archive view
  const sel = document.querySelector('.ap-lang');
  sel.value = 'ru'; sel.dispatchEvent(new Event('change'));
  ok('language switch', await until(() => /Сводка/.test(document.body.textContent)), document.querySelector('.ap-card-h') && document.querySelector('.ap-card-h').textContent);
  HTMLAnchorElement.prototype.click = origClick;
  return { steps };
}
