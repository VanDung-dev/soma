import { getContent, getWasm } from '../src/anatomy/core.ts';

// Run after loading in Vite: (await import('/tests/focus.browser.mjs')).checkFocusTree()
export async function checkFocusTree() {
  const wasm = await getWasm(), { AnatomyViewer } = wasm;
  const catalog = JSON.parse((await getContent()).get_catalog());
  const proto = AnatomyViewer.prototype, originalFocus = proto.focus, originalRender = proto.render;
  const originalVisibility = proto.change_visibility;
  const canvas = document.querySelector('.model-canvas canvas'), gl = canvas.getContext('webgl2');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  assert(document.querySelector('.model-canvas').getAttribute('aria-busy') === 'false' && !document.querySelector('.model-error'),
    'Wait for model loading to finish before checking focus');
  const wait = () => new Promise(resolve => setTimeout(resolve, 180));
  const root = catalog.targets.find(t => t.model?.path.endsWith('skeletal-system.glb'));
  const branch = catalog.targets.find(t => t.source_name === 'Cranium');
  const otherBranch = catalog.targets.find(t => t.source_name === 'Appendicular skeleton');
  const row = target => document.querySelector(`[data-target-id="${target.id}"] > .tree-row`);
  const doubleClick = element => {
    const name = element.querySelector('.tree-name');
    for (const detail of [1,2]) name.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
    name.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
  };
  let focusCalls = 0, revealCalls = 0, lastHide, lastIds, lastViewer, imageBounds;
  proto.change_visibility = function(ids, shown, ...args) {
    if (shown) revealCalls++;
    else lastHide = { ids: (typeof ids === "string" ? JSON.parse(ids) : ids), now: args[0] };
    return originalVisibility.call(this,ids,shown,...args);
  };
  proto.focus = function(ids, ...frame) {
    focusCalls++; lastIds = (typeof ids === "string" ? JSON.parse(ids) : ids); lastViewer = this;
    return originalFocus.call(this, ids, ...frame);
  };
  proto.render = function() {
    originalRender.call(this);
    const bytes = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    imageBounds = { left: canvas.width, right: 0, top: canvas.height, bottom: 0 };
    for (let pixel = 0; pixel < bytes.length / 4; pixel++) {
      if (bytes[pixel * 4 + 3] !== 255) continue;
      const x = pixel % canvas.width, y = canvas.height - 1 - Math.floor(pixel / canvas.width);
      imageBounds.left = Math.min(imageBounds.left, x); imageBounds.right = Math.max(imageBounds.right, x);
      imageBounds.top = Math.min(imageBounds.top, y); imageBounds.bottom = Math.max(imageBounds.bottom, y);
    }
    assert(gl.getError() === gl.NO_ERROR, 'Focus produced a WebGL error');
  };
  try {
    assert(!document.querySelector('.tree-focus'), 'Remove all dedicated focus buttons');
    const tree = document.querySelector('.catalog-tree'), treeStyle = getComputedStyle(tree);
    assert(treeStyle.position === 'relative' && treeStyle.isolation === 'isolate' && Number(treeStyle.zIndex) > 0
      && treeStyle.backgroundColor !== 'rgba(0, 0, 0, 0)', 'Give the catalog tree its own raised surface');
    const rootRow = row(root), name = rootRow.querySelector('.tree-name'), countLabel = rootRow.querySelector('.tree-count');
    assert(countLabel.textContent === `${root.model.structure_ids.length} cấu trúc` && !name.contains(countLabel)
      && countLabel.getBoundingClientRect().left >= name.getBoundingClientRect().right - 1,
      'Move the structure count into the former focus-button column');
    name.click(); await wait();
    assert(focusCalls === 0, 'A single click must only browse folder information');
    rootRow.querySelector('.folder-toggle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    rootRow.querySelector('input').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    assert(focusCalls === 0, 'Disclosure and visibility controls must not trigger double-click focus');
    assert(catalog.targets.filter(t => t.model).every(t => row(t).querySelector('input').checked),
      'Start with all systems checked');
    doubleClick(rootRow);
    const rootIds = new Set(root.model.structure_ids);
    const otherIds = new Set(catalog.targets.filter(t => t.model).flatMap(t => t.model.structure_ids).filter(id => !rootIds.has(id)));
    assert(lastHide && Number.isFinite(lastHide.now) && lastHide.ids.length === otherIds.size
      && lastHide.ids.every(id => otherIds.has(id)) && revealCalls === 0,
      'Focusing a checked folder must animate hiding only the other systems');
    assert(lastViewer.visible_count() === rootIds.size && lastViewer.advance_reconstruction(performance.now()),
      'Outgoing systems must keep fading after focus updates logical visibility');
    await new Promise(resolve => setTimeout(resolve, 750));
    assert(!lastViewer.advance_reconstruction(performance.now()), 'The outgoing fade must complete');
    [...document.querySelectorAll('.tree-actions button')].find(b => b.textContent === 'Hiện tất cả').click();
    await new Promise(resolve => setTimeout(resolve, 750));
    rootRow.querySelector('input').click(); await wait();
    assert(rootRow.classList.contains('is-selected') && !rootRow.querySelector('input').checked,
      'Keep a selected folder unchecked to reproduce the visibility guard bug');
    let revealsBefore = revealCalls;
    doubleClick(rootRow); await wait();
    assert(revealCalls === revealsBefore + 1 && rootRow.querySelector('input').checked,
      'An unchecked folder must reveal even when its row is selected');
    row(catalog.targets.find(t => t.model && t.id !== root.id)).querySelector('.tree-name').click(); await wait();
    assert(!rootRow.classList.contains('is-selected') && rootRow.querySelector('input').checked,
      'Keep a visible folder checked after selecting a different row');
    revealsBefore = revealCalls;
    doubleClick(rootRow); await wait();
    assert(revealCalls === revealsBefore, 'A checked folder must skip reveal even when its row was not selected');
    const beforeKeyboard = focusCalls, revealsBeforeKeyboard = revealCalls;
    const shortcut = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
    name.dispatchEvent(shortcut); await wait();
    assert(shortcut.defaultPrevented && focusCalls === beforeKeyboard + 1 && lastIds.length === root.model.structure_ids.length,
      'Offer Shift+Enter as the keyboard equivalent of folder focus');
    assert(revealCalls === revealsBeforeKeyboard, 'A checked folder must skip the reveal when focused from the keyboard');
    for (const system of catalog.targets.filter(t => t.model)) {
      const before = focusCalls, revealsBefore = revealCalls, wasChecked = row(system).querySelector('input').checked;
      doubleClick(row(system)); await wait();
      assert(focusCalls === before + 1, 'Double-click must focus once after the two normal click events');
      assert(revealCalls === revealsBefore + (wasChecked ? 0 : 1),
        'Use checkbox visibility to decide whether folder focus needs a reveal');
      const expected = new Set(system.model.structure_ids);
      assert(lastIds.length === expected.size && lastIds.every(id => expected.has(id))
        && lastViewer.visible_count() === expected.size && row(system).querySelector('input').checked,
        `System focus must match its checkbox: ${system.title}`);
      if (system === root) {
        const joints = catalog.targets.find(t => t.model?.path.endsWith('joints.glb'));
        assert(!row(joints).querySelector('input').checked && !row(joints).querySelector('input').indeterminate,
          'Skeletal focus must not enable any joints');
      }
      const focusedReveals = revealCalls;
      doubleClick(row(system)); await wait();
      assert(revealCalls === focusedReveals, 'Repeated double-click must not restart an already checked folder reveal');
    }
    [...document.querySelectorAll('.tree-actions button')].find(b => b.textContent === 'Ẩn tất cả').click();
    await wait();
    for (const target of [root, branch]) {
      const toggle = row(target).querySelector('.folder-toggle');
      if (toggle.getAttribute('aria-expanded') === 'false') { toggle.click(); await wait(); }
    }
    const partRow = document.querySelector(`[data-target-id="${branch.id}"] [data-structure-id]`);
    const partId = partRow.getAttribute('data-structure-id');
    doubleClick(partRow); await wait();
    assert(lastIds.length === 1 && lastIds[0] === partId, 'Double-click must address the exact structure');
    assert(lastViewer.visible_count() === 1 && partRow.querySelector('input').checked, 'Hidden structure must be enabled');
    assert(lastViewer.selected_id() === partId, 'Focused structure must remain selected');
    const area = canvas.getBoundingClientRect(), ratio = canvas.width / area.width;
    const desktop = innerWidth > 1140;
    const left = desktop ? document.querySelector('.catalog-panel').getBoundingClientRect().right + 12 : area.left + 12;
    const right = desktop ? document.querySelector('.information-panel').getBoundingClientRect().left - 12 : area.right - 12;
    assert(imageBounds.left >= (left - area.left) * ratio - 2 && imageBounds.right <= (right - area.left) * ratio + 2,
      'Small structure must fit between the panels');
    assert(imageBounds.top >= 110 * ratio - 2 && imageBounds.bottom <= (area.height - 80) * ratio + 2,
      'Small structure must fit below the header and above the controls');
    assert(imageBounds.bottom - imageBounds.top > 30 * ratio, 'Small structure must be enlarged');
    const count = focusCalls;
    partRow.querySelector('input').click(); await wait();
    assert(focusCalls === count && lastViewer.visible_count() === 0, 'Checkbox must not zoom');
    row(otherBranch).querySelector('input').click(); await wait();
    assert(focusCalls === count, 'Enabling a folder must not zoom');
    row(branch).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await wait();
    assert(lastIds.length === branch.structure_ids.length && branch.structure_ids.every(id => lastIds.includes(id)),
      'Parent double-click must address all descendants');
    assert(lastViewer.visible_count() === branch.structure_ids.length && row(branch).querySelector('input').checked
      && !row(otherBranch).querySelector('input').checked && row(branch).classList.contains('is-selected'),
      'Parent double-click must isolate its complete branch and synchronize the checkboxes');
    const child = catalog.targets.find(t => t.source_name === 'Bones of cranium');
    row(child).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await wait();
    assert(lastViewer.visible_count() === child.structure_ids.length && child.structure_ids.every(id => lastIds.includes(id))
      && row(child).querySelector('input').checked && row(branch).querySelector('input').indeterminate,
      'Child double-click must isolate its own branch');
    row(branch).querySelector('.tree-name').click(); await wait();
    assert(row(branch).querySelector('input').indeterminate, 'Keep a partially visible folder selected');
    revealsBefore = revealCalls;
    doubleClick(row(branch)); await wait();
    assert(revealCalls === revealsBefore + 1, 'A mixed checkbox must reveal the complete folder');
    assert(row(root).querySelector('input').indeterminate, 'Partially enabled system must remain indeterminate');
    row(otherBranch).querySelector('input').click(); await wait();
    const visibleCount = new Set([...branch.structure_ids, ...otherBranch.structure_ids]).size;
    assert(lastViewer.visible_count() === visibleCount, 'Enabling another folder must preserve existing visibility');
    partRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await wait();
    assert(lastViewer.visible_count() === 1 && lastViewer.selected_id() === partId,
      'Individual double-click must isolate the focused structure');
    assert(partRow.querySelector('input').checked && !row(otherBranch).querySelector('input').checked,
      'Isolation must synchronize the checkboxes');
    return { generalFocusRemoved: true, allFocusButtonsRemoved: true, doubleClickFocus: true, keyboardFocus: true, raisedTree: true, countInRightColumn: true,
      systemsMatchCheckboxes: true, skeletalExcludesJoints: true, smallModel: true, exactIds: true, checkboxDoesNotZoom: true,
      descendantsEnabled: true, folderIsolates: true, childFolderIsolates: true, individualIsolates: true,
      checkboxSynchronized: true, viewportFits: true, uncheckedFolderReveal: true, checkedFolderSkipsReveal: true,
      selectionDoesNotControlReveal: true, mixedFolderReveal: true, outgoingFolderFade: true };
  } finally {
    proto.focus = originalFocus; proto.render = originalRender; proto.change_visibility = originalVisibility;
  }
}
