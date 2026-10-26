// planogram-studio/e2e.js - in-page scenario of the planogram page (node check.js e2e
// planogram-studio/html@5_offline_singlefile/index.html planogram-studio/e2e.js): loads the demo, checks the fit
// state of the demo fixtures, places facings with the keyboard alternative until the shelf overflows, undo / redo,
// drops a product with drag and drop, saves two versions and compares them, and checks the analytics tables.
// Serialized into the page: only browser globals. Elements are addressed by data-act / data-fk hooks rather than
// by visible text, so the scenario is independent of the UI language.
export default async function scenario() {
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, value) => steps.push([name, ok ? 'ok' : 'FAIL', value]);
  const $ = (s) => document.querySelector(s);
  const act = (a) => $(`[data-act="${a}"]`);
  const fit = () => $('.pgs-fit')?.dataset.state;
  const pickFixture = async (id) => { const s = $('#pgs-fixture'); s.value = id; s.dispatchEvent(new Event('change')); await sleep(150); };

  act('demo').click();
  await sleep(200);
  $('.ed-dialog .ed-primary').click();
  await sleep(400);
  step('demo loaded', document.querySelectorAll('.pgs-prod').length >= 55, document.querySelectorAll('.pgs-prod').length);

  await pickFixture('fx-drinks');
  step('drinks fits', fit() === 'ok', fit());
  await pickFixture('fx-wine');
  step('wine overflow warning', fit() === 'bad' && !!$('.pg-over') && !!$('.pgs-w[data-code="too_wide"]'), fit());
  await pickFixture('fx-dairy');
  step('dairy squeezed', fit() === 'warn' && !!$('.pg-squeeze'), fit());

  // Keyboard alternative: product + shelf + facings -> Place.
  await pickFixture('fx-drinks');
  const n0 = document.querySelectorAll('.pg-pos').length;
  const ps = $('#pgs-place-prod'); ps.value = 'p-bj05'; ps.dispatchEvent(new Event('change')); await sleep(80);
  const ss = $('#pgs-place-shelf'); ss.value = '0'; ss.dispatchEvent(new Event('change')); await sleep(80);
  for (let i = 0; i < 2; i++) { $('[data-fk="place-fx+"]').click(); await sleep(60); }
  act('place').click();
  await sleep(250);
  step('placed facings', document.querySelectorAll('.pg-pos').length === n0 + 1, document.querySelectorAll('.pg-pos').length);
  step('overflow after placing', fit() === 'bad' && !!$('.pg-over'), fit());
  act('undo').click(); await sleep(200);
  step('undo restores fit', fit() === 'ok' && !$('.pg-over'), fit());
  act('redo').click(); await sleep(200);
  step('redo brings overflow', fit() === 'bad', fit());
  act('undo').click(); await sleep(200);

  // Facing stepper on the selected position.
  $('.pg-pos[data-pos="4:0"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
  $('#pgs-canvas').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }));
  await sleep(150);
  const before = $('[data-fk="pos-fx"]')?.value;
  $('[data-fk="pos-fx+"]').click(); await sleep(150);
  step('stepper adds a facing', Number($('[data-fk="pos-fx"]').value) === Number(before) + 1, [before, $('[data-fk="pos-fx"]').value]);
  act('undo').click(); await sleep(150);

  // Drag and drop from the library onto shelf 4.
  try {
    const dt = new DataTransfer();
    dt.setData('text/x-pgs-product', 'p-lk05');
    const r = $('.pgs-canvas rect.pg-space[data-shelf="3"]').getBoundingClientRect();
    const st = $('.pgs-stage');
    const at = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 3, clientY: r.top + r.height / 2 };
    st.dispatchEvent(new DragEvent('dragover', at));
    st.dispatchEvent(new DragEvent('drop', at));
    await sleep(250);
    step('drag and drop places', $('.pg-pos[data-pos="3:0"] title')?.textContent.startsWith('Likani'), $('.pg-pos[data-pos="3:0"] title')?.textContent);
  } catch (e) { step('drag and drop places', false, e.message); }

  // Versions: save A, remove a position, save B, compare.
  const name = $('#pgs-ver-name'); name.value = 'E2E A'; act('save-version').click(); await sleep(200);
  $('.pg-pos[data-pos="0:0"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
  $('#pgs-canvas').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }));
  await sleep(120);
  act('remove').click(); await sleep(200);
  $('#pgs-ver-name').value = 'E2E B'; act('save-version').click(); await sleep(200);
  const items = [...document.querySelectorAll('.pgs-vitem')];
  const idOf = (n) => items.find((li) => li.textContent.includes(n))?.dataset.id;
  const a = $('#pgs-cmp-a'); a.value = idOf('E2E A'); a.dispatchEvent(new Event('change')); await sleep(150);
  const b = $('#pgs-cmp-b'); b.value = idOf('E2E B'); b.dispatchEvent(new Event('change')); await sleep(150);
  const d = $('.pgs-diff');
  step('compare finds removal', d && d.dataset.removed === '1', d?.dataset);
  step('diff list readable', !!$('.pgs-dlist li[data-kind="removed"]'), $('.pgs-dlist')?.textContent.slice(0, 120));

  step('macro space rows', document.querySelectorAll('.pgs-macro-t tbody tr').length >= 2, document.querySelectorAll('.pgs-macro-t tbody tr').length);
  step('days of supply rows', document.querySelectorAll('.pgs-dos tbody tr').length >= 5, document.querySelectorAll('.pgs-dos tbody tr').length);
  return { steps };
}
