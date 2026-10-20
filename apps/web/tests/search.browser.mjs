import { getWasm } from '../src/anatomy/core.ts';

export async function checkStructureSearch() {
  const { AnatomyViewer } = await getWasm();
  const originalFocus = AnatomyViewer.prototype.focus;
  const trigger = document.querySelector('.structure-search-field');
  const popover = document.querySelector('.structure-search-popover');
  const form = popover.querySelector('form'), input = form.querySelector('input');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const wait = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const open = async () => {
    if (!popover.matches(':popover-open')) trigger.click();
    await wait();
  };
  const enter = async text => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait();
  };
  const key = async key => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await wait();
  };
  const tree = document.querySelector('.catalog-tree');
  const treeState = () => [...tree.querySelectorAll('.folder-toggle')].map(button => button.getAttribute('aria-expanded')).join(',');
  let focused, viewer, calls = 0;
  AnatomyViewer.prototype.focus = function(ids, ...viewport) {
    focused = JSON.parse(ids); viewer = this; calls++;
    return originalFocus.call(this, ids, ...viewport);
  };
  try {
    assert(!trigger.disabled, 'Wait for startup to finish');
    if (popover.matches(':popover-open')) { popover.hidePopover(); await wait(); }
    assert(!tree.querySelector('mark'), 'The catalog must remain a normal tree');
    const state = treeState(), rowCount = tree.querySelectorAll('.tree-row').length;
    const action = document.querySelector('.tree-actions > button').getBoundingClientRect();
    const button = trigger.getBoundingClientRect();
    assert(trigger.closest('.tree-actions') && Math.abs(action.top + action.height / 2 - button.top - button.height / 2) < 1,
      'Align the icon-only search button with the tree actions');
    await open();
    assert(document.activeElement === input, 'Focus the search input on opening');
    const bounds = popover.getBoundingClientRect();
    assert(Math.abs(bounds.left + bounds.width / 2 - innerWidth / 2) < 1
      && Math.abs(bounds.top + bounds.height / 2 - innerHeight / 2) < 1, 'Center Spotlight like Settings');
    const settingsStyle = getComputedStyle(document.querySelector('.settings-popover'));
    const checkSize = () => {
      const current = popover.getBoundingClientRect();
      assert(current.width === parseFloat(settingsStyle.width) && current.height === parseFloat(settingsStyle.height),
        'Keep Spotlight the same size as Settings');
    };
    checkSize();
    assert(!popover.querySelector('.controls-info') && getComputedStyle(popover).backdropFilter === 'none'
      && getComputedStyle(popover, '::backdrop').backdropFilter === 'none', 'Remove the close button and blur effects');
    assert(getComputedStyle(trigger).borderRadius === getComputedStyle(document.querySelector('.tree-actions > button')).borderRadius,
      'Use Radius 2 for the search trigger');
    const options = () => [...form.querySelectorAll('[role="option"]')];
    assert(options().length === 20 && form.querySelector('[role="status"]').textContent.startsWith('A–Z'), 'Show alphabetical results before typing');
    const alphabetic = () => {
      const names = options().map(option => option.querySelector('span').textContent);
      const collator = new Intl.Collator(document.documentElement.lang, { sensitivity: 'base', numeric: true, ignorePunctuation: true });
      assert(names.every((name, i) => !i || collator.compare(names[i - 1], name) <= 0), 'Keep default results in A–Z order');
    };
    alphabetic();
    const list = form.querySelector('[role="listbox"]');
    list.scrollTop = list.scrollHeight;
    await wait();
    assert(options().length > 20, 'Load more alphabetical results when scrolling');
    alphabetic();
    assert(calls === 0 && treeState() === state, 'Browsing A–Z must preserve the tree and model');
    await enter('FEMUR');
    checkSize();
    assert(options().length >= 2 && /^Xương đùi/.test(options()[0].textContent), 'Rank exact bilingual names first');
    assert(treeState() === state && tree.querySelectorAll('.tree-row').length === rowCount && calls === 0,
      'Typing must not rebuild, expand or focus the catalog tree');
    await key('ArrowDown');
    assert(input.getAttribute('aria-activedescendant') === options()[1].id && options()[1].getAttribute('aria-selected') === 'true',
      'Arrow keys must navigate the result list');
    await key('ArrowUp');
    assert(options()[0].getAttribute('aria-selected') === 'true', 'Navigate back to the first result');
    await enter('x');
    assert(options().length === 20 && tree.querySelectorAll('.tree-row').length === rowCount, 'Bound broad searches to 20 result rows');
    await key('Escape');
    assert(!popover.matches(':popover-open') && document.activeElement === trigger && input.value === '', 'Escape closes, clears and restores focus');
    await open();
    await enter('__no_matching_structure__');
    checkSize();
    assert(!options().length && form.querySelector('[role="status"]').textContent.includes('Không tìm thấy'), 'Explain when no results match');
    form.requestSubmit(); await wait();
    assert(calls === 0, 'An unmatched search must preserve the camera');
    await key('Escape');
    document.querySelector('.tree-actions > button:nth-child(2)').click(); await wait();
    await open(); await enter('xuong dui trai');
    const left = options()[0], id = left.dataset.structureId;
    assert(left.textContent.startsWith('Xương đùi · trái'), 'Unaccented laterality must find the exact structure');
    form.requestSubmit(); await wait();
    const row = tree.querySelector('[data-structure-id="' + id + '"]');
    assert(focused.length === 1 && focused[0] === id && viewer.visible_count() === 1 && viewer.selected_id() === id,
      'Enter must focus and reveal the exact hidden structure');
    assert(row?.classList.contains('is-selected') && row.querySelector('input').checked, 'Synchronize the tree selection and visibility');
    assert(!popover.matches(':popover-open') && document.activeElement === document.querySelector('.model-canvas canvas'),
      'Close Spotlight and focus the model after choosing a result');
    assert(/Xương đùi/.test(document.querySelector('.information-heading h2').textContent), 'Update the information panel');
    await open(); await enter('Femur left');
    assert(options()[0].dataset.structureId === id, 'English and Vietnamese resolve to the same structure');
    await enter('Os femoris');
    assert(options().some(option => option.dataset.structureId === id && option.querySelector('[lang="la"]')), 'Keep Latin search');
    const clickedId = options()[0].dataset.structureId;
    options()[0].click(); await wait();
    assert(viewer.selected_id() === clickedId && !popover.matches(':popover-open'), 'Clicking a result selects and closes Spotlight');
    await open(); await enter('x');
    const finalBounds = popover.getBoundingClientRect();
    assert(finalBounds.left >= 0 && finalBounds.right <= innerWidth && finalBounds.top >= 0 && finalBounds.bottom <= innerHeight,
      'Keep Spotlight within the viewport');
    assert(popover.scrollWidth <= popover.clientWidth, 'Results must fit without horizontal overflow');
    return { iconAligned: true, centered: true, autofocus: true, keyboardNavigation: true, escapeRestoresFocus: true,
      independentTree: true, resultLimit: 20, exactSelection: true, hiddenEnabled: true, bilingualNames: true, latinSearch: true, viewportFits: true };
  } finally {
    AnatomyViewer.prototype.focus = originalFocus;
    popover.hidePopover();
    for (const back = document.querySelector('.app-menu-history button'); !back.disabled;) { back.click(); await wait(); }
    await wait();
  }
}
