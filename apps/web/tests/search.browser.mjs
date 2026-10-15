import { getWasm } from '../src/core.ts';

// Run after startup in Vite: (await import('/tests/search.browser.mjs')).checkStructureSearch()
export async function checkStructureSearch() {
  const { AnatomyViewer } = await getWasm();
  const originalFocus = AnatomyViewer.prototype.focus;
  const form = document.querySelector('.structure-search'), input = form.querySelector('input');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const wait = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const enter = async text => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait();
  };
  let focused, viewer, calls = 0;
  AnatomyViewer.prototype.focus = function(ids, ...viewport) {
    focused = JSON.parse(ids); viewer = this; calls++;
    return originalFocus.call(this, ids, ...viewport);
  };
  try {
    assert(!input.disabled && !document.querySelector('.tree-help'), 'Search replaces the help after startup');
    await enter('');
    form.requestSubmit(); await wait();
    assert(calls === 0, 'Empty search must not change the model');
    assert(!document.querySelector('.tree-actions .tree-focus'), 'The general focus button must be removed');
    await enter('Femur');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait();
    assert(!form.querySelector('.structure-search-popup'), 'Escape must dismiss the popup');
    await enter('Femur');
    document.querySelector('.model-canvas canvas').focus(); await wait();
    assert(!form.querySelector('.structure-search-popup') && calls === 0, 'Leaving search must dismiss without changing the model');
    document.querySelector('.tree-actions button:nth-child(2)').click(); await wait();
    const toolbarTop = document.querySelector('.tree-actions').getBoundingClientRect().top;
    await enter('FEMUR');
    const result = form.querySelector('.structure-search-results button');
    assert(result && /^Xương đùi/.test(result.textContent) && result.querySelector('[lang="en"]').textContent.startsWith('Femur'),
      'Exact names must be first with Vietnamese primary and English secondary');
    assert(Math.abs(document.querySelector('.tree-actions').getBoundingClientRect().top - toolbarTop) < 0.5,
      'Search results must overlay the catalog without pushing its actions down');
    const bounds = result.getBoundingClientRect();
    assert(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest('button') === result,
      'Popup results must be clickable above the underlying catalog');
    const id = result.dataset.structureId;
    result.click(); await wait();
    const row = document.querySelector(`.structure-tree [data-structure-id="${id}"]`);
    assert(focused.length === 1 && focused[0] === id && viewer.visible_count() === 1 && viewer.selected_id() === id,
      'Search must focus, show and select the exact structure even when hidden');
    assert(row?.classList.contains('is-selected') && row.querySelector('input').checked,
      'Search must reveal the selected structure inside its tree branch');
    assert(/Xương đùi/.test(document.querySelector('.information-heading h2').textContent), 'Search must update the information panel in Vietnamese');
    assert(/Femur/.test(document.querySelector('.international-name').textContent), 'English must remain visible');
    assert(input.value === '' && !form.querySelector('.structure-search-results'), 'Choosing a result closes suggestions');
    assert(document.activeElement === document.querySelector('.model-canvas canvas'), 'Focus returns to the model controls');
    const folder = row.closest('ul').closest('[data-target-id]');
    folder.querySelector('.folder-toggle').click(); await wait();
    await enter('Femur');
    form.requestSubmit(); await wait();
    assert(document.querySelector(`.structure-tree [data-structure-id="${id}"]`),
      'Repeating a search must reopen a manually closed branch');
    await enter('__no_matching_structure__');
    const before = calls;
    assert(form.querySelector('[role="status"]').textContent.includes('Không tìm thấy'), 'No matches must be explained');
    assert(form.querySelector('button[type="submit"]').disabled, 'No matches disables the search action');
    form.requestSubmit(); await wait();
    assert(calls === before, 'Unmatched searches must preserve the camera');
    await enter('xuong dui trai');
    const left = [...form.querySelectorAll('.structure-search-results button')].find(button => button.textContent.includes('Xương đùi · trái'));
    assert(left, 'Unaccented laterality must find the left structure');
    const leftId = left.dataset.structureId;
    left.click(); await wait();
    assert(viewer.selected_id() === leftId, 'Laterality must resolve to the exact structure ID');
    await enter('Femur left');
    assert(form.querySelector('.structure-search-results button').dataset.structureId === leftId,
      'English and Vietnamese must resolve to the same structure');
    await enter('Os femoris');
    assert([...form.querySelectorAll('.structure-search-results button')].some(button => button.dataset.structureId === leftId),
      'Latin remains searchable');
    await enter('');
    return { clickFocuses: true, enterFocuses: true, revealsTree: true, hiddenEnabled: true,
      exactSelection: true, laterality: true, repeatedSearch: true, emptyAndMissingSafe: true, helpRemoved: true,
      overlaysWithoutReflow: true, dismisses: true, generalFocusRemoved: true, bilingualNames: true, latinSearch: true };
  } finally { AnatomyViewer.prototype.focus = originalFocus; }
}
