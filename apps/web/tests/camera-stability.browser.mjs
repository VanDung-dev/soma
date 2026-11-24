import { getWasm } from '../src/anatomy/core.ts';

export async function checkViewerResize() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const { AnatomyViewer } = await getWasm(), proto = AnatomyViewer.prototype;
  const host = document.querySelector('.model-canvas'), canvas = host.querySelector('canvas');
  assert(host.getAttribute('aria-busy') === 'false', 'Wait for model loading to finish');
  const gl = canvas.getContext('webgl2');
  const original = { resize: proto.resize, matrix: gl.uniformMatrix4fv, style: host.style.cssText,
    fromPrepared: AnatomyViewer.fromPrepared, append: proto.appendPrepared, start: proto.start_reconstruction };
  let viewer, matrix, loads = 0;
  proto.resize = function(...args) { viewer = this; return original.resize.apply(this, args); };
  gl.uniformMatrix4fv = function(...args) {
    const result = original.matrix.apply(this, args), program = this.getParameter(this.CURRENT_PROGRAM);
    const location = program && this.getUniformLocation(program, 'view_projection');
    if (location) matrix = [...this.getUniform(program, location)];
    return result;
  };
  AnatomyViewer.fromPrepared = function(...args) { loads++; return original.fromPrepared.apply(this, args); };
  proto.appendPrepared = function(...args) { loads++; return original.append.apply(this, args); };
  proto.start_reconstruction = function(...args) { loads++; return original.start.apply(this, args); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 300));
  const resources = () => performance.getEntriesByType('resource').filter(e => /\.glb(?:\.br)?(?:\?|$)/.test(e.name)).length;
  try {
    const count = resources();
    host.style.width = `${host.clientWidth - 1}px`;
    await settle();
    assert(viewer, 'ResizeObserver must update the existing renderer');
    viewer.finish_camera_transition();
    viewer.rotate(0.4, -0.2); viewer.pan(0.08, -0.04); viewer.zoom(0.7);
    viewer.render(); const before = matrix.slice(), selected = viewer.selected_id(), visible = viewer.visible_count();
    const width = host.clientWidth, height = host.clientHeight;
    for (const [w, h] of [[width - 100, height - 60], [width + 50, height + 20], [width, height]]) {
      host.style.width = `${w}px`; host.style.height = `${h}px`;
      await settle();
      assert(host.querySelector('canvas') === canvas && host.getAttribute('aria-busy') === 'false', 'Resize must keep the loaded canvas');
      assert(viewer.selected_id() === selected && viewer.visible_count() === visible, 'Resize must preserve study state');
    }
    viewer.render();
    assert(before.every((value, i) => Math.abs(value - matrix[i]) < 1e-5), 'Resize must preserve rotation, pan and zoom');
    assert(loads === 0 && resources() === count, 'Resize must not reload or reconstruct geometry');
    assert(gl.getError() === gl.NO_ERROR && !document.querySelector('.model-error'), 'Keep the renderer healthy after resize');
    return { sameCanvas: true, cameraPreserved: true, studyStatePreserved: true, noModelReload: true };
  } finally {
    host.style.cssText = original.style;
    await settle();
    proto.resize = original.resize; gl.uniformMatrix4fv = original.matrix;
    AnatomyViewer.fromPrepared = original.fromPrepared; proto.appendPrepared = original.append; proto.start_reconstruction = original.start;
  }
}

export async function checkCameraStability() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  assert(document.querySelector('.model-canvas[aria-busy="false"]'), 'Wait for model loading to finish');
  const { AnatomyViewer } = await getWasm(), proto = AnatomyViewer.prototype;
  const canvas = document.querySelector('.model-canvas canvas'), gl = canvas.getContext('webgl2');
  const slider = document.querySelector('.explode-control input');
  const original = { zoom: proto.zoom_at, reframe: proto.reframe, matrix: gl.uniformMatrix4fv,
    capture: canvas.setPointerCapture };
  let viewer, matrix, reframes = 0;
  proto.zoom_at = function(...args) { viewer = this; return original.zoom.apply(this, args); };
  proto.reframe = function(...args) { reframes++; return original.reframe.apply(this, args); };
  gl.uniformMatrix4fv = function(...args) {
    const result = original.matrix.apply(this, args), program = this.getParameter(this.CURRENT_PROGRAM);
    const location = program && this.getUniformLocation(program, 'view_projection');
    if (location) matrix = [...this.getUniform(program, location)];
    return result;
  };
  canvas.setPointerCapture = function(id) { if (id !== 999) original.capture.call(this, id); };
  const wait = () => new Promise(resolve => setTimeout(resolve, 250));
  const snapshot = () => { viewer.render(); return matrix.slice(); };
  const same = (a, b) => a.every((value, i) => Math.abs(value - b[i]) < 1e-5);
  const overview = async () => {
    for (let i = 0; i < 20; i++) {
      const back = document.querySelector('.app-menu-history .history-back');
      if (back.disabled) break;
      back.click(); await wait();
    }
    canvas.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    await wait();
  };
  const opaquePoint = () => {
    const frame = document.querySelector('.model-focus-frame').getBoundingClientRect(), area = canvas.getBoundingClientRect();
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    viewer.render(); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    for (let y = frame.top + 20; y < frame.bottom - 180; y += 3) for (let x = frame.left + 16; x < frame.right - 16; x += 3) {
      const px = Math.floor((x - area.left) / area.width * canvas.width);
      const py = canvas.height - 1 - Math.floor((y - area.top) / area.height * canvas.height);
      if (pixels[(py * canvas.width + px) * 4 + 3] === 255) return { x, y };
    }
    throw Error('Find visible anatomy inside the interaction frame');
  };
  const results = [];
  const readerToggle = document.querySelector('.information-width-toggle');
  try {
    if (document.querySelector('.reader-expanded')) { readerToggle.click(); await wait(); }
    for (const amount of [0, 30]) {
      await overview();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, String(amount));
      slider.dispatchEvent(new Event('input', { bubbles: true })); await wait();
      const frame = document.querySelector('.model-focus-frame').getBoundingClientRect();
      canvas.dispatchEvent(new WheelEvent('wheel', { clientX: frame.left + frame.width * 0.4,
        clientY: frame.top + frame.height * 0.4, deltaY: -100, bubbles: true, cancelable: true }));
      viewer.finish_explosion(); viewer.finish_camera_transition(); await wait();
      const beforeZoom = snapshot();
      canvas.dispatchEvent(new WheelEvent('wheel', { clientX: frame.left + frame.width * 0.4,
        clientY: frame.top + frame.height * 0.4, deltaY: -150, bubbles: true, cancelable: true }));
      const zoomed = snapshot();
      assert(!same(beforeZoom, zoomed), 'Wheel input must change the camera');
      const point = opaquePoint(); reframes = 0;
      canvas.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: point.x, clientY: point.y }));
      await wait();
      assert(same(snapshot(), zoomed), `Hover must preserve manual zoom at ${amount}% separation`);
      assert(reframes === 0, 'Showing hover labels must not reframe the scene');
      canvas.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' })); await wait();
      assert(same(snapshot(), zoomed), 'Removing hover labels must preserve the camera');
      reframes = 0;
      for (const type of ['pointerdown', 'pointerup']) canvas.dispatchEvent(new PointerEvent(type, {
        pointerType: 'mouse', pointerId: 999, button: 0, clientX: point.x, clientY: point.y, bubbles: true,
      }));
      await wait();
      assert(viewer.selected_id(), 'Click must select visible anatomy');
      assert(reframes === 0, 'Selection in the collapsed information view must not reframe the scene');
      if (amount === 0) assert(same(snapshot(), zoomed), 'Normal model selection must preserve the zoomed camera');
      canvas.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
      assert(readerToggle && !readerToggle.disabled,
        'Keep the reader control visible and enabled for ordinary selection');
      if (amount > 0) {
        results.push({ separation: amount, hoverKeepsZoom: true, selectionDoesNotReframe: true, readerRequiresManualSeparation: true });
        continue;
      }
      const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2,
        clientX: point.x, clientY: point.y });
      canvas.dispatchEvent(menu); await wait();
      assert(menu.defaultPrevented && !document.querySelector('.context-menu'), 'Right-click on the canvas must not open a menu');
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', pointerId: 999,
        button: 0, buttons: 1, clientX: point.x, clientY: point.y, bubbles: true }));
      await wait();
      const progress = document.querySelector('.model-hold-progress');
      assert(progress && getComputedStyle(progress).visibility === 'hidden' && canvas.dataset.moving !== 'true',
        'Keep hold progress hidden during the first half second');
      const progressBounds = progress.getBoundingClientRect();
      assert(Math.abs(progressBounds.left + progressBounds.width / 2 - point.x) < 1
        && Math.abs(progressBounds.top + progressBounds.height / 2 - point.y) < 1, 'Center progress around the cursor');
      await new Promise(resolve => setTimeout(resolve, 450));
      assert(getComputedStyle(progress).visibility === 'visible' && canvas.dataset.moving !== 'true',
        'Show hold progress during the remaining half second');
      const fill = getComputedStyle(progress.querySelector('.model-hold-fill'));
      assert(parseFloat(fill.strokeDashoffset) > 0 && parseFloat(fill.strokeDashoffset) < 100, 'Animate hold progress');
      await new Promise(resolve => setTimeout(resolve, 450));
      assert(!document.querySelector('.model-hold-progress') && canvas.dataset.dragging === 'true', 'Holding enables dragging in the same gesture');
      assert(same(snapshot(), zoomed), 'Holding must preserve camera position');
      const moving = viewer.selected_id();
      canvas.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', pointerId: 999,
        button: 0, buttons: 1, clientX: point.x + 35, clientY: point.y, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', pointerId: 999,
        button: 0, clientX: point.x + 35, clientY: point.y, bubbles: true })); await wait();
      assert(viewer.structure_offset(moving).some(value => value !== 0), 'Drag the held structure without a second press');
      readerToggle.click(); await wait();
      await Promise.all(document.querySelector('.information-panel').getAnimations().map(animation => animation.finished));
      await wait();
      viewer.finish_camera_transition();
      const readerFrame = document.querySelector('.model-focus-frame').getBoundingClientRect();
      canvas.dispatchEvent(new WheelEvent('wheel', { clientX: readerFrame.left + readerFrame.width * 0.4,
        clientY: readerFrame.top + readerFrame.height * 0.4, deltaY: -100, bubbles: true, cancelable: true }));
      const readerZoom = snapshot(), readerPoint = opaquePoint(); reframes = 0;
      canvas.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: readerPoint.x, clientY: readerPoint.y }));
      await wait();
      const afterReaderHover = snapshot();
      assert(same(afterReaderHover, readerZoom) && reframes === 0,
        `Reader hover must not override manual zoom or recenter the scene: ${JSON.stringify({ amount, reframes, readerZoom, afterReaderHover })}`);
      canvas.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' })); await wait();
      assert(same(snapshot(), readerZoom), 'Removing a reader hover label must preserve manual zoom');
      readerToggle.click(); await wait();
      await Promise.all(document.querySelector('.information-panel').getAnimations().map(animation => animation.finished));
      await wait();
      viewer.finish_camera_transition();
      canvas.focus(); canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true })); await wait();
      assert(gl.getError() === gl.NO_ERROR && !document.querySelector('.model-error'), 'Keep the renderer healthy');
      results.push({ separation: amount, holdProgressAtCursor: true, holdDragsStructure: true,
        hoverKeepsZoom: true, selectionDoesNotReframe: true, expandedReaderKeepsManualZoom: true });
    }
    return { states: results };
  } finally {
    if (document.querySelector('.reader-expanded')) { readerToggle.click(); await wait(); }
    await overview();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '0');
    slider.dispatchEvent(new Event('input', { bubbles: true })); await wait();
    proto.zoom_at = original.zoom; proto.reframe = original.reframe;
    gl.uniformMatrix4fv = original.matrix; canvas.setPointerCapture = original.capture;
  }
}
