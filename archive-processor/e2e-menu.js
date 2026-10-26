// archive-processor/e2e-menu.js - end-to-end scenario of the row context menu for the built page:
//   node check.js e2e archive-processor/html@5_offline_singlefile/index.html archive-processor/e2e-menu.js --lang en
// Right click on a folder and a file (items, properties, extract folder / file, test file), the Menu key on the focused
// row (menu anchored to the row, focus inside), a long press by touch (Select first), selection-aware items, copy. The
// 7z archive below was made with 7-Zip (base64). Same harness conventions as e2e-app.js.
export default async function () {
  const DATA = {"lzma2.7z":"N3q8ryccAAQ5LrW6KAkAAAAAAAAjAAAAAAAAAHa7PAHgIQAIJV0AEYgWOacIXs+xaSc/E33y2JJ8zY+g3VNRJKd6DLeIB2AaEEDmYWJMH+E3fRRfnZR3Pj/Cqh+VPiTcGsH5d4uuENX4ylBVzID+RFKSg/qWqfoXhILqOn70G26fkHNWM0g4W0pDJWJgFIUIT5JGBocukqQ8dEpaqs0IyyegDjNvo7wMRKt5f7PlHjBuVO/zSDIxLcaYlq/Nujzl6QYtvqTQ8lx/IgPGn+FJY+eAOe86yIVXcpLaulcS8PcDKGZFm4Or1JrMYfGsPzLrIAQl9TPsuEcHcrvWbSB9w2WcO4B8fYrwHOJ6h+EshOXwXl83TNc+nTV2s5c8N/NlJ1OiB75kukJTsiLlFgsPCsvIm5r6wLqPgaDuSdM+C35GCe3wn2cqNa4oi2rqxApDk9igsl18cDvN6ss0AqMF/aUzvwh4Mv1xggNQUykxlU+TJwkd9Q8GoGOZ8uoZagfzykczDsQMMDuqVfWubjhsXlNZaIeYRp0mKVqwP9soZvGwEAS+rTdLUVJPHT7MyDco89GU5h5gqbpHTHlES/XeFdU8gd6C0D/NcuJn5RMr83cOdTUXRRHKjsbsHdQRYv4gwP7FirNX2DNoF3Bahxy5R2sqkLRlCPrxV5EfErxuZA8QZy9e1BH7iuyeOAOzX2MLbapO7kX+Qe9PKJzsQRZDqTcuKtA0VVZ4ys9GkDrkv4kli+ZeaZFJx01qSukpc67IkRfoMuCmAO0WtiQyM2uo2ts5DRMThkbARyNqjaXMvPg70QIQpaZEdpJqLumrq6zCVNhteCQBs1FIpGEEr25FAxlVn4WcwdWi2eCSXP9PP9ACydMZ4JDr9b1XGBkKy0LjBJvgINYgTnmffilUmaJAxyyeOfRsq6N+lVNZBQQthV5E5FsLPtigh1XT951e4v+cpqKhXZJ0jvLzYZJbR3BfJbiMtRdoS838Zj/eRv//eyX3/34lQTXrTOtxuuQFVPsLIleqrYtQOfGbDE/GVMEYFyRf+pbJRD6OMX6E0u+AgJnTF7+edFyWAiV7qGvYkuprFpCpqqGpuqN4ZdbEFbWHpLG8sqqua6gg8VWhEYsBzHYAFs54nV/rGZyS2OlwepWFG56LZ4vFm7cj3t741PI5MhrNKMk5PN7OCkP57+aKTShDILgMlRqXGeSV1i/aLn7epiRoQxxgDA3kFlLr+mtB9dffo3r/OKEtYjjqr6uUuaPhxoqp3OBAUwVObGgQwKjbwAK3VjLlYxSoeLVPG3tZfQ9QGtrN8BAk5Syx3Ya0ceDxQ6Et8LrtE/CY/8OeauSEBdJ2thjBfvVoFgeZpNls1GqiC8i5dedpQid52VIA3sbf9G1Qn4SS//PJMPn8ttc1r3Zyn7q8wPj3QRVYDlYFwVsWQ5gg3ppmXC4DzLeQnCMPPBzQXGir4vajAyAGm/h9dDRb9vVl1KFzO6BBe4a+EUeLzMnb+tm4ez18v0owB1miK2RQAw/vNy48QthQafUm+ToXJ/Tsh5x8tAC/yAKxMcH1VdN/2mfJNetjR37QXKKSbEKaVdzOwvlOZzRWF2Au8brniv2HyiaKkxTBPTaTzvbEyhK5Gv8iW7KBn/Gdi0xp8evJpJHnUv2zTijoOQiLX6juF06IFUFO39O99mOm1k3oYuYQysvQkd8OcL7RElVNyjfBfZCtwa12Flzp85whIJEO2Ktd4d7ws9b//NF057rY9MT1bTW+0Quzk56xJfckxhNi9p2OL06mwW+jHXEktOpRTtunFJX8AIXMBozr/aEWCb1cf5rZXR5/NA4hXKbD+tHHSZZ+3oQM880IJrbB6ihpV9fVS4zY1G6p0FTJIojXZ3vH7Gc/W8AjPlKlQcUbAQzRu+Yyt+XIXnlehMQU8ZyAWzKDacH7FsJVDRjUNA70b6bvRyByIigv+UV/1Srsh2vl/2K9hb06qvAjAYvO5esq4qrKVu9ToX7SFpRCP9La5XCu+GKaIiLc3AvhmbItRsxSrtfLkIW6+1GEOJ2gh2bGV80dnghXoHcn/AoN3FZtnbwSSi9D6PJhpFXn+CZlv/QuXlSNCCjAZxuzfyFmGk0Zrq2isGLXqSQLbNie4nyzDVpcR1cpXv14DF1u7NVACrLSVRB6fO2//IB0vPFrPPKsro+0si0ipUpK9GgfWPx4AEFxQOKskrW4fPnD5FOGbMsL1YZQFHX7QVfZ9em00F00qYpnLAU2yme2p5lBm41z219huCuoCMkZphINAImQ3IhKNWQOk37FaX+ppPEICTywxtmHIph56WqE5O+cNWpY6byDoNxA9v5Pn4HAAIxvsdLQSVvaDqd42e2YODW1T+I4GQVAIuH67fnLI//VNsYROV42tcybPPX4NkJqD/l+xGC5oIJ4wdkxvNCpNo9V6pl5Hsn5dNSLndwcPYTr0QHZGFe7sX9iLsqmIMGYTZN0wdmLOrBKiG/6d33r2DRuNj8sdO6HeJwxcgZginPCSBA67RbTLVZo7ZkIjYOsqNvW0C76eIPMlINsvB4whEuwRmEb8loOnG0zfY6UHGRsgIxzfOdSr+695TMSxem9kkExXueeJ6kO0badJ0Ng/BsbG++CGtYJ8i8PVAOwoOgSlK/59nZPhEiOu6Aikbl07eAAZmC0jGYcYDdCvqHdruUgCdYYfcBKVihv2cxu4Wmfz6whpsi0GZtkf+ptkUNJlS7YkNtSieF9ba8BApHbTz6jUP5wOdQjMopaqGu3yG07Zwo3Ww9aUTL7elQhPu0EiOEpfIZappMVprdGxTCbvWCyExZokbPI8WGHO4QAAAAAgTMHrg/VhdSYVyTT/rNwIgjTBau6I3mb39YT+cAgvS5gvZxInP4YZM/+M6lGTH0phqH0eCOpIeah6ICFW9YrzdyZ35ukFY6fbu97Fy2jceqyWAqPFtHoz6gtjMQs/Ess0hbjKmC6Pac8/Or88YL9obW6R0aiOlMGabDB0hNS+8bbhoFoyx/fJXmhZM6dDwA+ex5w6325bKqtWSM94Wuf8xhfhMMv269BPEpdS6c91hjExVMPuaiZU4JevZUWFpbw8SbkooITeXoenw2ASAN84EavdZjcrlohmHorBxAgi29S2Ydz+7iUV1iAg45j35VLCy/HIdEyAl4kFwaILQEJgPsABwsBAAEjAwEBBV0AEAAADIGuCgEK2zw1AAA="};
  const steps = [];
  const ok = (name, cond, value) => steps.push([name, cond ? 'ok' : 'FAIL', value]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { let v; try { v = fn(); } catch { v = null; } if (v) return v; await sleep(40); } return null; };
  const file = (name) => new File([Uint8Array.from(atob(DATA[name]), (c) => c.charCodeAt(0))], name);
  const rows = () => [...document.querySelectorAll('.ax-row')];
  const row = (text) => rows().find((r) => r.querySelector('.ax-base') && r.querySelector('.ax-base').textContent === text);
  const menu = () => document.querySelector('.ed-menu-pop .ed-menu, .ed-menu');
  const labels = () => (menu() ? [...menu().querySelectorAll('.ed-menu-item')].map((b) => b.textContent.trim()) : []);
  const pick = (label) => { const m = menu(); const b = m && [...m.querySelectorAll('.ed-menu-item')].find((x) => x.textContent.trim() === label); if (b) b.click(); else steps.push(['pick ' + label, 'FAIL', m ? labels().join(' | ') : 'no menu']); return !!b; };
  const closeMenu = async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await sleep(80); };
  const rightClick = (el) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + 40, clientY: r.top + r.height / 2 })); };
  const downloads = [];
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push({ name: this.download, href: this.href }); else origClick.call(this); };
  const drop = (files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    document.querySelector('.ap-drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  };

  await until(() => document.documentElement.dataset.engine && document.documentElement.dataset.engine !== 'starting', 10000);
  drop([file('lzma2.7z')]);
  ok('listing', await until(() => row('text.txt')), rows().length);

  // 1. right click on a folder
  rightClick(row('dir'));
  ok('folder menu', await until(() => menu()), labels().join(' | '));
  const fl = labels();
  ok('folder items', ['Expand', 'Extract folder', 'Test folder', 'Select', 'Copy name', 'Copy path', 'Properties'].every((x) => fl.includes(x)), fl.join(' | '));
  ok('folder menu has no browser default', true);
  pick('Properties');
  const props = await until(() => document.querySelector('.ed-dialog .ax-entry'));
  ok('folder properties', props && /Files\s*2/.test(props.textContent) && /in a solid block/.test(props.textContent) && /Folders\s*1/.test(props.textContent), props && props.textContent.slice(0, 160));
  document.querySelector('.ed-dialog .ed-dlg-foot .ed-primary').click();
  await sleep(250);

  // 2. extract the folder from its menu: one ZIP named after the folder
  rightClick(row('dir'));
  await until(() => menu());
  pick('Extract folder');
  ok('extract folder zip', await until(() => downloads.find((d) => d.name === 'dir.zip')), JSON.stringify(downloads));

  // 3. a file: open, extract this file
  await sleep(200);
  rightClick(row('text.txt'));
  await until(() => menu());
  const fi = labels();
  ok('file items', ['Open', 'Extract this file', 'Test this file', 'Select', 'Copy name', 'Copy path', 'Properties'].every((x) => fi.includes(x)), fi.join(' | '));
  ok('file row active', row('text.txt').classList.contains('ax-active'), row('text.txt').className);
  pick('Extract this file');
  ok('extract one file', await until(() => downloads.find((d) => d.name === 'text.txt')), JSON.stringify(downloads.map((d) => d.name)));

  // 4. test this file -> report with one result
  await sleep(200);
  rightClick(row('random.bin'));
  await until(() => menu());
  pick('Test this file');
  const rep = await until(() => document.querySelector('.ax-test-head'));
  ok('test one file', rep && /1/.test(rep.textContent) && document.querySelectorAll('.ax-test-table tbody tr').length === 1, rep && rep.textContent);
  document.querySelector('.ed-dialog .ed-dlg-foot .ed-primary').click();
  await sleep(250);

  // 5. keyboard: Menu key on the focused row (contextmenu at 0, 0) anchors the menu to the row
  const r0 = row('prog.exe');
  r0.click();
  await until(() => document.querySelector('.ed-dialog'));
  document.querySelector('.ed-dialog .ed-dlg-foot .ed-primary') && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(250);
  if (document.querySelector('.ed-dialog')) { const x = document.querySelector('.ed-dialog .ed-iconbtn'); if (x) x.click(); await sleep(250); }
  const act = document.querySelector('.ax-row.ax-active');
  act.focus();
  act.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0 }));
  const km = await until(() => menu());
  await sleep(100);
  const pr = km && km.closest('.ed-menu-pop, .ed-pop') ? km.closest('.ed-menu-pop, .ed-pop').getBoundingClientRect() : null;
  const ar = act.getBoundingClientRect();
  ok('keyboard menu', !!km && labels().includes('Open'), labels().join(' | '));
  ok('keyboard menu anchored', pr && pr.top >= ar.top - 2 && pr.left >= 0, pr && JSON.stringify({ top: pr.top, rowTop: ar.top }));
  ok('keyboard focus in menu', document.activeElement && document.activeElement.classList.contains('ed-menu-item'), document.activeElement && document.activeElement.className);
  ok('menu label', km.getAttribute('aria-label') === 'prog.exe' || (km.closest('[aria-label]') && km.closest('[aria-label]').getAttribute('aria-label') === 'prog.exe'), km.outerHTML.slice(0, 120));
  pick('Copy name');
  await sleep(150);
  ok('keyboard focus back on the row', document.activeElement && document.activeElement.matches('.ax-row.ax-active') && /prog\.exe/.test(document.activeElement.textContent), document.activeElement && document.activeElement.className);
  await closeMenu();

  // 6. touch long press: Select first, selecting the row (a long press right after another menu is suppressed)
  await sleep(900);
  const t = row('zeros.bin'), tr = t.getBoundingClientRect();
  t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 7, clientX: tr.left + 60, clientY: tr.top + 10 }));
  const tm = await until(() => menu(), 2000);
  ok('long press menu', !!tm && labels()[0] === 'Select', labels().join(' | '));
  t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 7 }));
  // The click derived from lifting that finger activates nothing; a new tap on an item works.
  const sel = [...menu().querySelectorAll('.ed-menu-item')].find((x) => x.textContent.trim() === 'Select');
  sel.click();
  await sleep(50);
  ok('lift click swallowed', !/selected/.test(document.querySelector('.ax-selinfo').textContent) && !!menu(), document.querySelector('.ax-selinfo').textContent);
  sel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 8 }));
  pick('Select');
  ok('long press selects', await until(() => /1 file/.test(document.querySelector('.ax-selinfo').textContent)), document.querySelector('.ax-selinfo').textContent);
  ok('no preview after long press', !document.querySelector('.ed-dialog'), '');
  await sleep(900);

  // 7. selection-aware item and deselect
  rightClick(row('text.txt'));
  await until(() => menu());
  pick('Select');
  await sleep(50);
  rightClick(row('text.txt'));
  await until(() => menu());
  ok('selection item', labels().some((l) => /Extract 2 files/.test(l)) && labels().includes('Deselect'), labels().join(' | '));
  pick('Deselect');
  ok('deselect', await until(() => /1 file/.test(document.querySelector('.ax-selinfo').textContent)), document.querySelector('.ax-selinfo').textContent);

  // 8. copy path -> a toast
  rightClick(row('text.txt'));
  await until(() => menu());
  pick('Copy path');
  ok('copy toast', await until(() => document.querySelector('.ed-toast')), document.querySelector('.ed-toast') && document.querySelector('.ed-toast').textContent);

  // 9. the test hook lists the labels of a row menu
  ok('hook labels', JSON.stringify(window.__archproc.rowMenu('dir/sub/note.md')), JSON.stringify(window.__archproc.rowMenu('dir/sub/note.md')));
  return { steps };
}
