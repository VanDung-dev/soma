import { getWasm } from '../src/core.ts';

// Run in Vite: (await import('/tests/selection.browser.mjs')).checkSelectionOutline()
export async function checkSelectionOutline() {
  const { AnatomyViewer } = await getWasm();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  canvas.style.cssText = 'width:256px;height:256px;position:fixed;left:-1000px';
  document.body.append(canvas);
  const gl = canvas.getContext('webgl2');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const bounds = (left, right) => ({ min: [left, -0.5, 0], max: [right, 0.5, 0] });
  const part = (id, left, right) => ({ source_id: id, bounds: bounds(left, right),
    color: [0.4, 0.2, 0.1, 1], roughness: 0.6, metallic: 0, specular: 0.04,
    subsurface: 0, double_sided: true, blend: false, alpha_cutoff: 0, active: true, visible: true });
  const vertices = new Float32Array([-0.9, -0.5, 0, 0, 0, 1, -0.2, -0.5, 0, 0, 0, 1,
    -0.2, 0.5, 0, 0, 0, 1, -0.9, 0.5, 0, 0, 0, 1,
    0.2, -0.5, 0, 0, 0, 1, 0.9, -0.5, 0, 0, 0, 1,
    0.9, 0.5, 0, 0, 0, 1, 0.2, 0.5, 0, 0, 0, 1]);
  const packed = { scene: { bounds: bounds(-0.9, 0.9), selected: '',
    parts: [part('left', -0.9, -0.2), part('right', 0.2, 0.9)] },
    draws: [[6, 0], [6, 24]], vertex_count: 8, index_count: 12 };
  let viewer;
  const pixels = () => {
    viewer.render();
    const rgba = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    assert(gl.getError() === gl.NO_ERROR, 'Selection rendering produced a WebGL error');
    return rgba;
  };
  const outline = rgba => {
    const result = { left: 0, right: 0, first: -1 };
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 2] > rgba[i] + 25 && rgba[i + 2] > rgba[i + 1] + 8) {
        const pixel = i / 4;
        result[pixel % canvas.width < canvas.width / 2 ? 'left' : 'right']++;
        if (result.first < 0) result.first = pixel;
      }
    }
    return result;
  };
  try {
    viewer = AnatomyViewer.fromPrepared(canvas, [vertices,
      new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]), JSON.stringify(packed)]);
    const shadows = (await import('./shading.browser.mjs')).checkViewerShadows(viewer, gl, ['left', 'right']);
    const baseline = pixels();
    assert(outline(baseline).first < 0, 'Unselected models must have no outline');
    viewer.select('left');
    const leftPixels = pixels(), left = outline(leftPixels);
    assert(left.left > 20 && left.right === 0, 'Outline must surround only the selected model');
    assert(baseline[left.first * 4 + 3] < 255, 'Outline must be outside the opaque anatomy');
    assert(viewer.pick(left.first % canvas.width, Math.floor(left.first / canvas.width)) === '',
      'Outline pixels must not become pickable anatomy');
    viewer.select('right');
    const right = outline(pixels());
    assert(right.right > 20 && right.left === 0, 'Changing selection must remove the previous outline');
    viewer.pan(0.01, 0); viewer.zoom(0.95); viewer.rotate(0.05, 0);
    assert(outline(pixels()).right > 20, 'Outline must follow camera operations');
    viewer.inspect('reset');
    assert(JSON.stringify(viewer.select_region(0, 0, 128, 256)) === '["left"]', 'Select region A');
    const grouped = viewer.select_region(128, 0, 128, 256);
    assert(JSON.stringify(grouped) === '["left","right"]', 'Adding region B must preserve region A');
    assert(JSON.stringify(viewer.select_region(128, 0, 128, 256)) === JSON.stringify(grouped), 'Repeated regions must not duplicate models');
    assert(JSON.stringify(viewer.select_region(0, 0, 1, 1)) === JSON.stringify(grouped), 'Empty space must preserve the existing group');
    assert(JSON.stringify(viewer.select_region(256, 256, 10, 10)) === JSON.stringify(grouped), 'Out-of-bounds regions must preserve the group');
    const groupOutline = outline(pixels());
    assert(groupOutline.left > 20 && groupOutline.right > 20, 'Outline every selected structure');
    viewer.restore_structure('left', new Float32Array([0.05, 0, 0]));
    viewer.restore_structure('right', new Float32Array([0, 0.05, 0]));
    const beforeLeft = viewer.structure_offset('left'), beforeRight = viewer.structure_offset('right');
    viewer.begin_selection_drag(); viewer.move_selection('left', 0.05, 0.03);
    const afterLeft = viewer.structure_offset('left'), afterRight = viewer.structure_offset('right');
    assert(afterLeft.some((value, i) => Math.abs(value - beforeLeft[i]) > 1e-6), 'Move the selected group');
    assert(afterLeft.every((value, i) => Math.abs(value - beforeLeft[i] - afterRight[i] + beforeRight[i]) < 1e-6),
      'Group movement keeps the relative positions of previously separated structures');
    assert(viewer.structure_group('left').length === 1, 'Marquee must not create a permanent connection');
    viewer.restore_structure(''); viewer.clear_selection(); viewer.select('right');
    const beforeResize = outline(pixels()).right;
    viewer.resize(512, 512);
    assert(outline(pixels()).right > beforeResize * 2.5, 'Keep outline thickness in CSS pixels after resize');
    viewer.change_visibility('["right"]', false);
    assert(viewer.selected_id() === '' && outline(pixels()).first < 0, 'Hiding a selection must clear its outline');
    assert(JSON.stringify(viewer.select_region(0, 0, 512, 512)) === '["left"]', 'Hidden structures must be excluded from marquee');
    assert(JSON.stringify(viewer.select_region(512, 512, 100, 100)) === '["left"]', 'Out-of-bounds marquee preserves the group safely');
    viewer.clear_selection();
    viewer.select('left'); viewer.select('');
    assert(outline(pixels()).first < 0, 'Clearing selection must remove the outline');
    for (const [ids, frame] of [['["unknown"]', [0, 0, 1, 1]],
      ['["left","left"]', [0, 0, 1, 1]], ['["right"]', [0, 0, 0, 1]]]) {
      let rejected = false;
      try { viewer.focus(ids, ...frame); } catch { rejected = true; }
      assert(rejected && viewer.visible_count() === 1, 'Invalid focus must not change visibility');
    }
    viewer.focus('["right"]', 0.2, 0.1, 0.6, 0.8);
    assert(viewer.visible_count() === 2, 'Focus must enable its target and preserve other visible models');
    return { selectedOnly: true, outsideSilhouette: true, pickingUnaffected: true,
      camera: true, resize: true, hidden: true, deselected: true, focusApi: true, shadows,
      marquee: true, additiveRegions: true, deduplicated: true, emptyRegionPreserved: true,
      groupOutline: true, relativeOffsets: true, temporaryGroup: true };
  } finally {
    viewer?.free(); canvas.remove();
  }
}

export async function checkMarqueeInput() {
  const { AnatomyViewer } = await getWasm(), proto = AnatomyViewer.prototype;
  const canvas = document.querySelector('.model-canvas canvas');
  const overlay = document.querySelector('.model-selection-box');
  const frame = document.querySelector('.model-focus-frame').getBoundingClientRect();
  const bounds = canvas.getBoundingClientRect();
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const capture = canvas.setPointerCapture, region = proto.select_region, move = proto.move_study_drag;
  let viewer, ids, moves = 0;
  const frames = async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); };
  const pointer = (type, point, extra = {}) => canvas.dispatchEvent(new PointerEvent(type, {
    pointerId: 777, pointerType: 'mouse', bubbles: true, cancelable: true, ...point, ...extra,
  }));
  canvas.setPointerCapture = () => {};
  proto.select_region = function(...args) { viewer = this; ids = region.apply(this, args); return ids; };
  proto.move_study_drag = function(...args) { moves++; return move.apply(this, args); };
  let before;
  try {
    const start = { clientX: frame.left + 10, clientY: frame.top + 10 };
    const end = { clientX: frame.right - 10, clientY: frame.bottom - 10 };
    const middleY = (start.clientY + end.clientY) / 2;
    pointer('pointerdown', start, { button: 0, buttons: 1, shiftKey: true });
    pointer('pointermove', { ...end, clientY: middleY }, { button: -1, buttons: 1, shiftKey: true });
    assert(!overlay.hidden && overlay.getBoundingClientRect().width > 100, 'Show the marquee while Shift-left dragging');
    assert(getComputedStyle(overlay).pointerEvents === 'none', 'The marquee must not intercept input');
    pointer('pointerup', { ...end, clientY: middleY }, { button: 0, shiftKey: true }); await frames();
    assert(overlay.hidden && ids.length > 1, 'Commit multiple structures and hide the marquee on release');
    const firstRegion = [...ids];
    pointer('pointerdown', { ...start, clientY: middleY }, { button: 0, buttons: 1, shiftKey: true });
    pointer('pointermove', end, { button: -1, buttons: 1, shiftKey: true });
    pointer('pointerup', end, { button: 0, shiftKey: true }); await frames();
    assert(ids.length > firstRegion.length && firstRegion.every(id => ids.includes(id)), 'The second marquee must add models to the first region');
    const combined = [...ids];
    pointer('pointerdown', { ...start, clientY: middleY }, { button: 0, buttons: 1, shiftKey: true });
    pointer('pointermove', end, { button: -1, buttons: 1, shiftKey: true });
    pointer('pointerup', end, { button: 0, shiftKey: true }); await frames();
    assert(JSON.stringify(ids) === JSON.stringify(combined), 'B reselected must keep AB without duplicates');
    pointer('pointerdown', start, { button: 0, buttons: 1, shiftKey: true });
    pointer('pointerup', start, { button: 0, shiftKey: true }); await frames();
    assert(viewer.selection_ids().length === combined.length, 'A Shift click without dragging must preserve AB');
    before = new Map(ids.map(id => [id, viewer.structure_offset(id)]));
    let hit;
    for (let y = frame.top + 20; y < frame.bottom - 20 && !hit; y += 10) {
      for (let x = frame.left + 20; x < frame.right - 20 && !hit; x += 10) {
        const id = viewer.pick(Math.floor((x - bounds.left) / bounds.width * canvas.width),
          canvas.height - 1 - Math.floor((y - bounds.top) / bounds.height * canvas.height));
        if (ids.includes(id)) hit = { clientX: x, clientY: y };
      }
    }
    assert(hit, 'Find a visible member for the hold gesture');
    viewer.select('');
    pointer('pointerdown', hit, { button: 0, buttons: 1 });
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert(canvas.dataset.dragging === 'true', 'A left hold starts dragging the group');
    pointer('pointermove', { ...hit, clientX: hit.clientX + 20 }, { button: -1, buttons: 1 });
    pointer('pointerup', { ...hit, clientX: hit.clientX + 20 }, { button: 0 }); await frames();
    assert(moves === 1 && viewer.selection_ids().length === ids.length, 'Keep the temporary group after dragging');
    const delta = viewer.structure_offset(ids[0]).map((value, i) => value - before.get(ids[0])[i]);
    assert(delta.some(value => Math.abs(value) > 1e-6), 'The pointer gesture moves anatomy');
    assert(ids.every(id => viewer.structure_offset(id).every((value, i) => Math.abs(value - before.get(id)[i] - delta[i]) < 1e-5)),
      'Every selected model must move by the same amount');
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await frames();
    assert(viewer.selection_ids().length === 0, 'Escape clears the temporary group');
    return { marqueeOverlay: true, firstRegion: firstRegion.length, selected: ids.length,
      additiveRegions: true, deduplicated: true, holdAndDrag: true, sharedTranslation: true, escape: true };
  } finally {
    pointer('pointercancel', { clientX: 0, clientY: 0 });
    if (viewer && before) for (const [id, offset] of before) viewer.restore_structure(id, offset);
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));
    proto.select_region = region; proto.move_study_drag = move; canvas.setPointerCapture = capture;
  }
}

export async function checkSelectionHover() {
  const { AnatomyViewer } = await getWasm(), proto = AnatomyViewer.prototype;
  const canvas = document.querySelector('.model-canvas canvas');
  const originalPick = proto.pick;
  let selectionBefore, selectionAfter, calls = 0;
  proto.pick = function(...args) {
    selectionBefore = this.selected_id();
    const id = originalPick.apply(this, args);
    calls++;
    queueMicrotask(() => { selectionAfter = this.selected_id(); });
    return id;
  };
  try {
    const bounds = document.querySelector('.model-focus-frame').getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse',
      clientX: bounds.left + bounds.width / 2, clientY: bounds.top + 20 }));
    await new Promise(resolve => setTimeout(resolve, 200));
    if (!calls || !selectionBefore || selectionAfter !== selectionBefore) {
      throw Error('Hover must preserve a previously selected structure');
    }
    return { hoverPreservesSelection: true };
  } finally { proto.pick = originalPick; }
}

export async function checkOutlineOcclusion() {
  const { AnatomyViewer } = await getWasm();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:256px;height:256px;position:fixed;left:-1000px';
  document.body.append(canvas);
  const gl = canvas.getContext('webgl2');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const geometry = [['back', -0.25, 0.25, -0.25, 0.25, 0],
    ['moving', 0.25, 0.5, -0.25, 0.25, 0], ['cover', -0.9, 0.9, -0.9, 0.9, 0.3]];
  const vertices = [], indices = [];
  const parts = geometry.map(([id, left, right, bottom, top, z], i) => {
    for (const [x, y] of [[left, bottom], [right, bottom], [right, top], [left, top]]) vertices.push(x, y, z, 0, 0, 1);
    indices.push(...[0, 1, 2, 0, 2, 3].map(index => index + i * 4));
    return { source_id: id, bounds: { min: [left, bottom, z], max: [right, top, z] },
      color: [0.4, 0.2, 0.1, 1], roughness: 0.6, metallic: 0, specular: 0.04, subsurface: 0,
      double_sided: true, blend: false, alpha_cutoff: 0, active: true, visible: true };
  });
  const packed = { scene: { bounds: { min: [-0.9, -0.9, 0], max: [0.9, 0.9, 0.3] }, selected: '', parts },
    draws: parts.map((_, i) => [6, i * 24]), vertex_count: 12, index_count: 18 };
  let viewer;
  const outlinePixels = () => {
    viewer.render();
    const rgba = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    assert(gl.getError() === gl.NO_ERROR, 'Occluded outlines must not produce WebGL errors');
    let blue = 0;
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 2] > rgba[i] + 25 && rgba[i + 2] > rgba[i + 1] + 8) blue++;
    return blue;
  };
  try {
    viewer = AnatomyViewer.fromPrepared(canvas, [new Float32Array(vertices), new Uint32Array(indices), JSON.stringify(packed)]);
    viewer.set_graphics(0, 1, false, 256, 256);
    for (const size of [256, 512]) {
      viewer.resize(size, size); viewer.restore_structure(''); viewer.set_visibility('["back","moving","cover"]');
      viewer.select('moving');
      assert(viewer.preview_connection('moving') === 'back', 'Use a covered source neighbor as the snap target');
      assert(outlinePixels() === 0, 'Opaque foreground anatomy must hide both selected and snap-target outlines');
      viewer.change_visibility('["cover"]', false);
      const visible = outlinePixels();
      assert(visible > 20, 'Visible selected and target silhouettes must still be outlined');
      viewer.change_visibility('["cover"]', true);
      viewer.restore_structure('cover', new Float32Array([-0.6, 0, 0]));
      viewer.preview_connection('moving');
      const partial = outlinePixels();
      assert(partial > 0 && partial < visible, 'Only the exposed part of a partially covered silhouette is outlined');
      viewer.restore_structure('cover'); viewer.preview_connection('moving'); viewer.resize(512, 512);
      assert(outlinePixels() === 0, 'Occlusion must survive render-target resize');
    }
    return { selectedOcclusion: true, snapTargetOcclusion: true, partialOcclusion: true, resize: true };
  } finally {
    viewer?.free(); canvas.remove();
  }
}
