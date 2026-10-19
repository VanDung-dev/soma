import { getWasm } from '../src/core.ts';

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
      const back = document.querySelector('.app-menu-history button');
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
  try {
    if (document.querySelector('.reader-expanded')) { document.querySelector('.reader-expand').click(); await wait(); }
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
      assert(!document.querySelector('.reader-expand'), 'Ordinary selection must not offer reference reading');
      if (amount > 0) {
        results.push({ separation: amount, hoverKeepsZoom: true, selectionDoesNotReframe: true, readerRequiresManualSeparation: true });
        continue;
      }
      canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: -1 })); await wait();
      [...document.querySelectorAll('.context-menu button')].find(button => button.querySelector('span')?.textContent === 'Tách để quan sát').click(); await wait();
      document.querySelector('.reader-expand').click(); await wait();
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
      document.querySelector('.reader-expand').click(); await wait();
      await Promise.all(document.querySelector('.information-panel').getAnimations().map(animation => animation.finished));
      await wait();
      viewer.finish_camera_transition();
      canvas.focus(); canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true })); await wait();
      assert(gl.getError() === gl.NO_ERROR && !document.querySelector('.model-error'), 'Keep the renderer healthy');
      results.push({ separation: amount, hoverKeepsZoom: true, selectionDoesNotReframe: true, expandedReaderKeepsManualZoom: true });
    }
    return { states: results };
  } finally {
    if (document.querySelector('.reader-expanded')) { document.querySelector('.reader-expand').click(); await wait(); }
    await overview();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '0');
    slider.dispatchEvent(new Event('input', { bubbles: true })); await wait();
    proto.zoom_at = original.zoom; proto.reframe = original.reframe;
    gl.uniformMatrix4fv = original.matrix; canvas.setPointerCapture = original.capture;
  }
}
