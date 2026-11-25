import { getWasm } from '../src/core.ts';

export async function checkStructureSearch() {
  const { AnatomyViewer } = await getWasm();
  const originalFocus = AnatomyViewer.prototype.focus;
  const originalAnimated = AnatomyViewer.prototype.focus_animated;
  const originalSelect = AnatomyViewer.prototype.select;
  const panel = document.querySelector('.catalog-panel');
  const input = panel.querySelector('.structure-search input');
  const tree = panel.querySelector('.catalog-tree');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const wait = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const enter = async text => {
    input.focus();
    setValue.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait();
  };
  const treeState = () => [...tree.querySelectorAll('.folder-toggle[aria-expanded="true"]')]
    .map(button => button.closest('[data-target-id]').dataset.targetId).join(',');
  const best = () => tree.querySelector('.tree-name[data-search-best]');
  const originalValue = input.value;
  const originalScroll = tree.scrollTop;
  const catalogToggle = document.querySelector('.app-menu-history .sidebar-toggle');
  const wasClosed = catalogToggle.getAttribute('aria-expanded') === 'false';
  let focused, viewer, calls = 0, selections = 0;
  AnatomyViewer.prototype.focus = function(ids, ...viewport) {
    focused = typeof ids === 'string' ? JSON.parse(ids) : ids;
    viewer = this; calls++;
    return originalFocus.call(this, ids, ...viewport);
  };
  AnatomyViewer.prototype.focus_animated = function(ids, ...viewport) {
    focused = typeof ids === 'string' ? JSON.parse(ids) : ids;
    viewer = this; calls++;
    return originalAnimated.call(this, ids, ...viewport);
  };
  AnatomyViewer.prototype.select = function(...args) {
    selections++;
    return originalSelect.apply(this, args);
  };
  try {
    if (wasClosed) {
      catalogToggle.click();
      await Promise.all(panel.getAnimations().map(animation => animation.finished.catch(() => {})));
      await wait();
    }
    assert(!input.disabled, 'Wait for startup to finish');
    assert(panel.contains(input) && !input.closest('[popover]'), 'Search belongs in the catalog panel');
    const canvas = document.querySelector('.model-canvas canvas');
    canvas.focus();
    for (const extra of [{ key: 'f' }, { key: 'f', ctrlKey: true }, { key: 'f', metaKey: true },
      { key: '/', ctrlKey: true }, { key: '/', metaKey: true }]) {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...extra });
      canvas.dispatchEvent(event);
      assert(!event.defaultPrevented && document.activeElement !== input, 'Leave browser Find and typing shortcuts alone');
    }
    const state = treeState();
    const rootCount = tree.querySelectorAll('.structure-tree > li').length;
    await enter('sọ');
    const skullId = best()?.closest('[data-target-id]')?.dataset.targetId;
    assert(skullId && best().querySelector('mark')?.textContent === 'Sọ', 'Highlight the skull group as the best result');
    assert(!tree.textContent.includes('Bao gân'), 'Exclude words that only match inside an unrelated word');
    await enter('Cranium');
    assert(best()?.closest('[data-target-id]')?.dataset.targetId === skullId && best().querySelector('mark')?.textContent === 'Cranium',
      'Highlight the matching English name on the same group');
    await enter('so');
    assert(best()?.closest('[data-target-id]')?.dataset.targetId === skullId, 'Find the skull with unaccented Vietnamese');
    await enter('N');
    assert(best()?.querySelector('mark'), 'Show a highlighted result for a single letter');
    await enter('__no_matching_structure__');
    assert(!best() && !tree.querySelector('.tree-row') && panel.querySelector('.structure-search > p')?.textContent,
      'Explain when no structure matches');
    assert(calls === 0 && selections === 0 && document.activeElement === input,
      'Typing must preserve camera, model selection and text focus');
    await enter('');
    assert(treeState() === state && tree.querySelectorAll('.structure-tree > li').length === rootCount && !tree.querySelector('mark'),
      'Clearing search restores the unfiltered tree and its open branches');

    await enter('xuong dui trai');
    const left = best();
    const id = left?.closest('[data-structure-id]')?.dataset.structureId;
    assert(id && left.querySelector('mark')?.textContent.includes('Xương đùi · trái'), 'Match the exact structure and laterality');
    left.click();
    await wait();
    assert(!calls && document.querySelector('.information-heading').dataset.structureId === id,
      'Clicking a tree result opens its details without focusing the model');
    await enter('Femur left');
    assert(best()?.closest('[data-structure-id]')?.dataset.structureId === id, 'English and Vietnamese match the same structure');
    await enter('Os femoris');
    assert(tree.querySelector('[data-structure-id="' + id + '"] small[lang="la"] mark'), 'Highlight Latin names');
    await enter('xuong dui trai');
    best().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    await wait();
    assert(focused?.length === 1 && focused[0] === id && viewer.visible_count() === 1 && viewer.selected_id() === id,
      'Shift+Enter explicitly focuses the matching model');
    assert(input.value === 'xuong dui trai' && best(), 'Keep the search results visible after model focus');
    return { inline: true, restoredTree: true, exactMatch: true, bilingualNames: true, latinSearch: true, explicitFocus: true };
  } finally {
    AnatomyViewer.prototype.focus = originalFocus;
    AnatomyViewer.prototype.focus_animated = originalAnimated;
    AnatomyViewer.prototype.select = originalSelect;
    await enter(originalValue);
    for (const back = document.querySelector('.app-menu-history .history-back'); !back.disabled;) { back.click(); await wait(); }
    if (wasClosed && catalogToggle.getAttribute('aria-expanded') === 'true') catalogToggle.click();
    tree.scrollTop = originalScroll;
  }
}
