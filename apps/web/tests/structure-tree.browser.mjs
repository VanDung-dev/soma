import { getContent } from '../src/anatomy/core.ts';

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
  const target = catalog.targets.find(target => target.model?.path.endsWith('/muscular-insertions.glb'));
  const nested = new Set(catalog.targets.filter(child => child.parent_id === target.id).flatMap(child => child.structure_ids));
  const ids = target.model.structure_ids.filter(id => !nested.has(id));
  const root = document.querySelector('[data-target-id="' + target.id + '"]');
  const toggle = root.querySelector('.folder-toggle');
  const scroll = root.closest('.catalog-tree');
  const search = document.querySelector('.structure-search-popover');
  const initialOpen = toggle.getAttribute('aria-expanded') === 'true';
  const originalScroll = scroll.scrollTop;
  const selected = () => document.querySelector('.information-heading').dataset.structureId;
  const rows = () => [...root.querySelectorAll('.part-row')];
  const back = document.querySelector('.app-menu-history button');
  try {
    for (const panel of document.querySelectorAll('[popover]:popover-open')) panel.hidePopover();
    if (initialOpen) { toggle.click(); await frames(); }
    scroll.scrollTop = 0;
    toggle.click(); await frames();
    const initialRows = rows().length;
    assert(initialRows >= 40 && initialRows < 100 && initialRows < ids.length, 'Opening a large folder must bound the initial mounted rows');
    const systemCheckbox = root.querySelector(':scope > .folder-row .visibility-checkbox input');
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
    const metadata = await (await fetch('/' + target.model.path.replace(/\.glb$/, '.json'))).json();
    const last = metadata.structures.find(part => part.source_id === ids.at(-1));
    document.querySelector('.structure-search-field').click(); await frames();
    const input = search.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, last.source_object);
    input.dispatchEvent(new Event('input', { bubbles: true })); await frames();
    const result = search.querySelector('[data-structure-id="' + last.source_id + '"]');
    assert(result, 'Find a structure beyond the initial tree rows');
    result.click();
    await waitFor(() => root.querySelector('[data-structure-id="' + last.source_id + '"]'), 'Reveal a not-yet-mounted structure from search');
    const revealed = root.querySelector('[data-structure-id="' + last.source_id + '"]');
    await frames();
    assert(revealed.classList.contains('is-selected') && selected() === last.source_id, 'Search must synchronize selection and reveal');
    const bounds = revealed.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
    assert(bounds.bottom > viewport.top && bounds.top < viewport.bottom, 'Scroll the revealed row into view');
    toggle.click(); await frames(); scroll.scrollTop = 0;
    toggle.click(); await frames();
    assert(rows().length < 100, 'Reopening after a reveal must restore the initial row bound');
    return { initialRows, totalDirectRows: ids.length, keyboardSelection: true, pointerFocus: true, keyboardLoading: true,
      scrollLoading: true, searchReveal: true, boundedReopen: true };
  } finally {
    search.hidePopover();
    while (!back.disabled) { back.click(); await frames(); }
    if ((toggle.getAttribute('aria-expanded') === 'true') !== initialOpen) { toggle.click(); await frames(); }
    scroll.scrollTop = originalScroll;
  }
}
