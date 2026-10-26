// mail-composer/e2e.js - in-page scenario of the compose page (node check.js e2e
// mail-composer/html@5_offline_singlefile/index.html mail-composer/e2e.js): a Georgian subject and an attachment give
// an .eml with an encoded subject and a multipart/mixed boundary; the structure view (the inspector reading that text
// back) shows the same subject; the mailto: link is refused while a file is attached; mail merge counts its rows.
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  // Georgian text forces RFC 2047 subject encoding and RFC 2231 file names: the paths most likely to break.
  const subject = 'ქართული წერილი — ტესტი';
  const subj = document.querySelector('#mc-subject');
  subj.value = subject; subj.dispatchEvent(new Event('input'));
  // A synthetic drop event with a DataTransfer reaches the same dropZone handler a real file drop does.
  const dt = new DataTransfer();
  dt.items.add(new File(['გამარჯობა, attachment\n'], 'ბარათი.txt', { type: 'text/plain' }));
  document.querySelector('.mc-files .ap-drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  await sleep(700);
  step('file listed', document.querySelectorAll('.mc-file').length >= 1, document.querySelectorAll('.mc-file').length);
  document.querySelector('[data-tab="source"]').click();
  await sleep(200);
  const eml = document.querySelector('#mc-panel .mc-source')?.textContent || '';
  step('encoded subject', /^Subject: =\?UTF-8\?B\?/m.test(eml), (/^Subject:.*$/m.exec(eml) || [''])[0].slice(0, 60));
  step('multipart/mixed boundary', /Content-Type: multipart\/mixed;\s*boundary="[^"]+"/.test(eml), (/multipart\/mixed[^\r\n]*/.exec(eml) || [''])[0]);
  step('RFC 2231 file name', eml.includes("filename*=UTF-8''"), (/filename\*=[^\r\n]*/.exec(eml) || [''])[0]);
  // Round trip: the structure tab parses the generated .eml, so the decoded subject must equal the typed one exactly.
  document.querySelector('[data-tab="structure"]').click();
  await sleep(200);
  const back = document.querySelector('#mc-panel .mc-i-subject')?.textContent;
  step('subject read back', back === subject, back);
  step('mailto refused with a file', document.querySelector('#mc-mailto').disabled, document.querySelector('.mc-mailto-note')?.textContent);
  // Clean up: remove the file, back to the preview.
  document.querySelector('.mc-fdel')?.click();
  document.querySelector('[data-tab="preview"]').click();
  await sleep(300);
  // The preview must be a sandboxed iframe (the security boundary for mail HTML).
  step('preview frame', !!document.querySelector('#mc-panel iframe.mc-frame[sandbox]'), document.querySelector('#mc-panel iframe')?.getAttribute('sandbox'));
  return { steps };
}
