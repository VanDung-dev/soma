import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { StructureTree } from '../src/anatomy/structure-tree.tsx';
import { StructureSearch } from '../src/anatomy/structure-search.tsx';

export function checkRenderEfficiency({ verify = true } = {}) {
  const assert = (ok, message) => { if (verify && !ok) throw Error(message); };
  const host = document.createElement('div');
  host.hidden = true;
  document.body.append(host);
  const root = createRoot(host);
  let reads = 0, selected = '', focused = '';
  const structures = Array.from({ length: 100 }, (_, index) => ({
    source_id: String(index), get source_name() { reads++; return `Atlas ${index}`; },
    source_object: `Atlas ${index}`, latin: '', laterality: '', collections: [],
  }));
  const ids = structures.map(part => part.source_id);
  const catalog = { groups: [], targets: [
    { id: 'root', group_id: 'root', title: 'Root', source_name: 'Root', structure_ids: ids, model: { structure_ids: ids } },
    { id: 'child', parent_id: 'root', title: 'Child', source_name: 'Child', structure_ids: ids.slice(0, 50) },
  ] };
  const onSelect = id => { selected = id; };
  const treeProps = { catalog, structures, selected: '', visibleIds: new Set(ids), disabled: false,
    onSelect, onTarget() {}, onVisibility() {}, onFocus: ids => { focused = ids[0]; }, reveal: { id: '0' } };
  const searchProps = { structures, disabled: false, onSelect };
  const render = () => flushSync(() => root.render(createElement('div', null,
    createElement(StructureTree, treeProps), createElement(StructureSearch, searchProps))));
  try {
    render();
    const initialReads = reads;
    reads = 0;
    const started = performance.now();
    for (let frame = 0; frame < 20; frame++) render();
    const repeatedRenderMs = performance.now() - started;
    const repeatedReads = reads;
    assert(repeatedReads === 0, 'Parent-only updates must not recalculate tree/search names');
    const row = host.querySelector('[data-structure-id="0"].part-row');
    assert(row && row.querySelector('input').checked, 'Reveal must open the nested structure');
    treeProps.visibleIds = new Set(['99']);
    treeProps.selected = '0';
    render();
    assert(!row.querySelector('input').checked && row.classList.contains('is-selected'), 'Visibility and selection must update through memoized trees');
    row.querySelector('.tree-name').click();
    assert(selected === '0', 'Structure selection must remain connected');
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    assert(focused === '0', 'Structure focus must remain connected');
    searchProps.onSelect = id => { selected = `new:${id}`; };
    render();
    host.querySelector('[role="option"]').click();
    assert(selected.startsWith('new:'), 'Search must use the updated callback');
    treeProps.reveal = { id: '99' };
    render();
    assert(host.querySelector('[data-structure-id="99"].part-row'), 'A new reveal must update the tree path');
    return { initialReads, repeatedReads, repeatedRenderMs: Math.round(repeatedRenderMs * 100) / 100,
      visibility: true, selection: true, focus: true, callbackReplacement: true, reveal: true };
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
}
