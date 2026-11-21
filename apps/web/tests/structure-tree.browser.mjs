import { getCatalog, getContent } from '../src/anatomy/core.ts';

export async function checkStructureTree() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const waitFor = async (check, message) => {
    for (let index = 0; index < 90; index++) {
      if (check()) return;
      await frames();
    }
    throw Error(message);
  };
  const catalog = JSON.parse((await getContent()).get_catalog());
  const target = catalog.targets.find(target => target.source_name === '2: Muscular insertions');
  const nested = new Set(catalog.targets.filter(child => child.parent_id === target.id).flatMap(child => child.structure_ids));
  const ids = target.model.structure_ids.filter(id => !nested.has(id));
  const scroll = document.querySelector('.catalog-panel .catalog-tree');
  const root = () => scroll.querySelector('[data-target-id="' + target.id + '"]');
  const toggle = () => root().querySelector('.folder-toggle');
  const input = document.querySelector('.catalog-panel .structure-search input');
  const initialOpen = toggle().getAttribute('aria-expanded') === 'true';
  const originalScroll = scroll.scrollTop;
  const originalQuery = input.value;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const enter = async query => {
    setValue.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await frames();
  };
  const selected = () => document.querySelector('.information-heading').dataset.structureId;
  const rows = () => [...(root()?.querySelectorAll('.part-row') ?? [])];
  const back = document.querySelector('.app-menu-history .history-back');
  try {
    for (const panel of document.querySelectorAll('[popover]:popover-open')) panel.hidePopover();
    if (initialOpen) { toggle().click(); await frames(); }
    scroll.scrollTop = 0;
    toggle().click(); await frames();
    const initialRows = rows().length;
    assert(initialRows >= 40 && initialRows < 100 && initialRows < ids.length, 'Opening a large folder must bound the initial mounted rows');
    const systemCheckbox = root().querySelector(':scope > .folder-row .visibility-checkbox input');
    const partCheckbox = rows()[0].querySelector('.visibility-checkbox input');
    assert(systemCheckbox.checked && !systemCheckbox.indeterminate, 'Visible systems must start checked');
    partCheckbox.click(); await frames();
    assert(!systemCheckbox.checked && systemCheckbox.indeterminate, 'Hiding one structure must mark its system mixed');
    partCheckbox.click(); await frames();
    assert(systemCheckbox.checked && !systemCheckbox.indeterminate, 'Restoring the structure must check its system again');
    systemCheckbox.click(); await frames();
    assert(!systemCheckbox.checked && !systemCheckbox.indeterminate, 'Hiding the system must clear its checkbox');
    systemCheckbox.click(); await frames();
    assert(systemCheckbox.checked && !systemCheckbox.indeterminate, 'Showing the system must refresh its checkbox');
    const first = rows()[0].querySelector('.tree-name');
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    first.focus(); await frames();
    assert(selected() === rows()[0].dataset.structureId, 'Keyboard focus must select the structure');
    const second = rows()[1].querySelector('.tree-name');
    second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    second.focus(); await frames();
    second.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    assert(selected() === rows()[0].dataset.structureId, 'Pointer focus alone must not select a different structure');
    const nearEnd = rows()[initialRows - 5].querySelector('.tree-name');
    nearEnd.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    nearEnd.focus(); await frames();
    assert(rows().length > initialRows && document.activeElement === nearEnd, 'Keyboard traversal must load the next rows without losing focus');
    const beforeScroll = rows().length;
    scroll.scrollTop = scroll.scrollHeight;
    await waitFor(() => rows().length > beforeScroll, 'Scrolling must load more structures');
    const bundle = await (await fetch('/' + target.model.path.replace(/\.glb(?:\.br)?$/, '.json'))).json();
    const metadata = bundle.metadata[target.id];
    const store = await getCatalog();
    try {
      store.ingestMetadata(store.roots.find(root => root.id === target.id), JSON.stringify(metadata));
      store.finish();
      const lastId = ids.at(-1);
      const last = store.detail(lastId);
      const beforeSearch = selected();
      await enter(last.names.en);
      const revealed = scroll.querySelector('.part-row[data-structure-id="' + lastId + '"]');
      assert(revealed?.querySelector('mark'), 'Search reveals and highlights a structure beyond the initial row limit');
      assert(selected() === beforeSearch, 'Revealing a result is independent of model selection');
      const bounds = revealed.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
      assert(bounds.bottom > viewport.top && bounds.top < viewport.bottom, 'Scroll the best matching row into view');
      revealed.querySelector('.tree-name').click();
      await frames();
      assert(revealed.classList.contains('is-selected') && selected() === lastId, 'Clicking the result selects it');
      await enter('');
      toggle().click(); await frames(); scroll.scrollTop = 0;
      toggle().click(); await frames();
      assert(rows().length < 100, 'Reopening after a search restores the initial row bound');

      const expandedPath = () => [...scroll.querySelectorAll('.folder-toggle[aria-expanded="true"]')]
        .map(button => button.closest('[data-target-id]').dataset.targetId);
      const matchesPath = expected => {
        const expanded = expandedPath();
        return expanded.length === expected.length && expected.every(id => expanded.includes(id));
      };
      await enter('sọ');
      const skull = catalog.targets.find(target => target.source_name === 'Cranium');
      const skullPath = store.reveal(skull.id).slice(1).map(([id]) => id);
      assert(matchesPath(skullPath), 'Search opens only the ancestors of the best matching folder');
      const skullRow = scroll.querySelector('[data-target-id="' + skull.id + '"] > .folder-row');
      assert(skullRow.querySelector('.folder-toggle').getAttribute('aria-expanded') === 'false', 'Keep the matching folder collapsed');
      skullRow.querySelector('.tree-name').click(); await frames();
      await enter(last.names.en);
      const lastPath = store.reveal(lastId).map(([id]) => id);
      assert(matchesPath(lastPath), 'A new search opens only the new best path');
      scroll.querySelector('[data-structure-id="' + lastId + '"] > .tree-name').click(); await frames();
      await enter('');
      back.click();
      await waitFor(() => matchesPath(skullPath)
        && scroll.querySelector('[data-target-id="' + skull.id + '"] > .folder-row.is-selected'), 'Back must restore only the skull parent path');
      document.querySelector('.app-menu-history .history-forward').click();
      await waitFor(() => matchesPath(lastPath)
        && scroll.querySelector('[data-structure-id="' + lastId + '"].is-selected'), 'Forward must restore only the structure path');
    } finally { store.free(); }
    return { initialRows, totalDirectRows: ids.length, keyboardSelection: true, pointerFocus: true, keyboardLoading: true,
      scrollLoading: true, searchReveal: true, boundedReopen: true, replaceSearchPath: true, collapsedSearchGroup: true };
  } finally {
    await enter('');
    while (!back.disabled) { back.click(); await frames(); }
    if ((toggle().getAttribute('aria-expanded') === 'true') !== initialOpen) { toggle().click(); await frames(); }
    await enter(originalQuery);
    scroll.scrollTop = originalScroll;
  }
}
