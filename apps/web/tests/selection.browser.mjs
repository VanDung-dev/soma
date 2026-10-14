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
    const beforeResize = outline(pixels()).right;
    viewer.resize(512, 512);
    assert(outline(pixels()).right > beforeResize * 2.5, 'Keep outline thickness in CSS pixels after resize');
    viewer.change_visibility('["right"]', false);
    assert(viewer.selected_id() === '' && outline(pixels()).first < 0, 'Hiding a selection must clear its outline');
    viewer.select('left'); viewer.select('');
    assert(outline(pixels()).first < 0, 'Clearing selection must remove the outline');
    return { selectedOnly: true, outsideSilhouette: true, pickingUnaffected: true,
      camera: true, resize: true, hidden: true, deselected: true, shadows };
  } finally {
    viewer?.free(); canvas.remove();
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
    const bounds = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse',
      clientX: bounds.left + bounds.width / 2, clientY: bounds.top + 20 }));
    await new Promise(resolve => setTimeout(resolve, 200));
    if (!calls || !selectionBefore || selectionAfter !== selectionBefore) {
      throw Error('Hover must preserve a previously selected structure');
    }
    return { hoverPreservesSelection: true };
  } finally { proto.pick = originalPick; }
}
