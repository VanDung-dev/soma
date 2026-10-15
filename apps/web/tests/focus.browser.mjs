import { getCatalog, getWasm } from '../src/core.ts';

// Run after loading in Vite: (await import('/tests/focus.browser.mjs')).checkFocusTree()
export async function checkFocusTree() {
  const catalog = await getCatalog(), { AnatomyViewer } = await getWasm();
  const proto = AnatomyViewer.prototype, originalFocus = proto.focus, originalRender = proto.render;
  const canvas = document.querySelector('.model-canvas canvas'), gl = canvas.getContext('webgl2');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  assert(document.querySelector('.model-canvas').getAttribute('aria-busy') === 'false' && !document.querySelector('.model-error'),
    'Wait for model loading to finish before checking focus');
  const wait = () => new Promise(resolve => setTimeout(resolve, 180));
  const root = catalog.targets.find(t => t.model?.path.endsWith('skeletal-system.glb'));
  const branch = catalog.targets.find(t => t.source_name === 'Cranium');
  const otherBranch = catalog.targets.find(t => t.source_name === 'Appendicular skeleton');
  const row = target => document.querySelector(`[data-target-id="${target.id}"] > .tree-row`);
  let focusCalls = 0, lastIds, lastViewer, imageBounds;
  proto.focus = function(ids, ...frame) {
    focusCalls++; lastIds = JSON.parse(ids); lastViewer = this;
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
    assert(!document.querySelector('.tree-actions .tree-focus'), 'The catalog toolbar must not have a general focus button');
    for (const system of catalog.targets.filter(t => t.model)) {
      row(system).querySelector('.tree-focus').click(); await wait();
      const expected = new Set(system.model.structure_ids);
      assert(lastIds.length === expected.size && lastIds.every(id => expected.has(id))
        && lastViewer.visible_count() === expected.size && row(system).querySelector('input').checked,
        `System focus must match its checkbox: ${system.title}`);
      if (system === root) {
        const joints = catalog.targets.find(t => t.model?.path.endsWith('joints.glb'));
        assert(!row(joints).querySelector('input').checked && !row(joints).querySelector('input').indeterminate,
          'Skeletal focus must not enable any joints');
      }
    }
    [...document.querySelectorAll('.tree-actions button')].find(b => b.textContent === 'Ẩn tất cả').click();
    await wait();
    for (const target of [root, branch]) {
      const toggle = row(target).querySelector('.folder-toggle');
      if (toggle.getAttribute('aria-expanded') === 'false') { toggle.click(); await wait(); }
    }
    const partRow = document.querySelector(`[data-target-id="${branch.id}"] [data-structure-id]`);
    const partId = partRow.getAttribute('data-structure-id');
    partRow.querySelector('.tree-focus').click(); await wait();
    assert(lastIds.length === 1 && lastIds[0] === partId, 'Magnifier must address the exact structure');
    assert(lastViewer.visible_count() === 1 && partRow.querySelector('input').checked, 'Hidden structure must be enabled');
    assert(lastViewer.selected_id() === partId, 'Focused structure must remain selected');
    const area = canvas.getBoundingClientRect(), ratio = canvas.width / area.width;
    const desktop = innerWidth > 900;
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
    row(branch).querySelector('.tree-focus').click(); await wait();
    assert(lastIds.length === branch.structure_ids.length && branch.structure_ids.every(id => lastIds.includes(id)),
      'Parent magnifier must address all descendants');
    assert(lastViewer.visible_count() === branch.structure_ids.length && row(branch).querySelector('input').checked
      && !row(otherBranch).querySelector('input').checked && row(branch).classList.contains('is-selected'),
      'Parent magnifier must isolate its complete branch and synchronize the checkboxes');
    const child = catalog.targets.find(t => t.source_name === 'Bones of cranium');
    row(child).querySelector('.tree-focus').click(); await wait();
    assert(lastViewer.visible_count() === child.structure_ids.length && child.structure_ids.every(id => lastIds.includes(id))
      && row(child).querySelector('input').checked && row(branch).querySelector('input').indeterminate,
      'Child magnifier must isolate its own branch');
    row(branch).querySelector('.tree-focus').click(); await wait();
    assert(row(root).querySelector('input').indeterminate, 'Partially enabled system must remain indeterminate');
    row(otherBranch).querySelector('input').click(); await wait();
    const visibleCount = new Set([...branch.structure_ids, ...otherBranch.structure_ids]).size;
    assert(lastViewer.visible_count() === visibleCount, 'Enabling another folder must preserve existing visibility');
    partRow.querySelector('.tree-focus').click(); await wait();
    assert(lastViewer.visible_count() === 1 && lastViewer.selected_id() === partId,
      'Individual magnifier must isolate the focused structure');
    assert(partRow.querySelector('input').checked && !row(otherBranch).querySelector('input').checked,
      'Isolation must synchronize the checkboxes');
    return { generalFocusRemoved: true, systemsMatchCheckboxes: true, skeletalExcludesJoints: true, smallModel: true, exactIds: true, checkboxDoesNotZoom: true,
      descendantsEnabled: true, folderIsolates: true, childFolderIsolates: true, individualIsolates: true,
      checkboxSynchronized: true, viewportFits: true };
  } finally {
    proto.focus = originalFocus; proto.render = originalRender;
  }
}
