import { getCatalog, getContent, getWasm } from '../src/anatomy/core.ts';

export async function checkExplosionEntry() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const { AnatomyViewer } = await getWasm(), proto = AnatomyViewer.prototype;
  const data = JSON.parse((await getContent()).get_catalog());
  const target = data.targets.find(item => item.source_name === 'Axial skeleton');
  const canvas = document.querySelector('.model-canvas canvas'), gl = canvas.getContext('webgl2');
  const slider = document.querySelector('.explode-control input');
  const original = { visibility: proto.change_visibility, render: proto.render_explosion };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const wait = time => new Promise(resolve => setTimeout(resolve, time));
  const input = value => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, String(value));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  };
  let viewer, previous, maxCenterStep = 0, maxSizeStep = 0, samples = 0;
  proto.change_visibility = function(...args) { viewer = this; return original.visibility.apply(this, args); };
  const snapshot = () => {
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let left = canvas.width, right = 0, bottom = canvas.height, top = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] !== 255) continue;
      const x = i / 4 % canvas.width, y = Math.floor(i / 4 / canvas.width);
      left = Math.min(left, x); right = Math.max(right, x); bottom = Math.min(bottom, y); top = Math.max(top, y);
    }
    assert(left < right && bottom < top, 'Keep the axial skeleton visible during entry and return');
    return [(left + right) / canvas.width / 2, (top + bottom) / canvas.height / 2,
      (right - left) / canvas.width, (top - bottom) / canvas.height];
  };
  try {
    document.querySelectorAll('.tree-actions button')[1].click(); await frames();
    const root = data.targets.find(item => item.id === target.parent_id);
    const toggle = document.querySelector(`[data-target-id="${root.id}"] > .tree-row .folder-toggle`);
    if (toggle.getAttribute('aria-expanded') === 'false') { toggle.click(); await frames(); }
    document.querySelector(`[data-target-id="${target.id}"] > .tree-row input[type="checkbox"]`).click();
    await wait(400); viewer.finish_reconstruction(); viewer.render();
    const assembled = previous = snapshot();
    proto.render_explosion = function(...args) {
      const moving = original.render.apply(this, args), current = snapshot();
      maxCenterStep = Math.max(maxCenterStep, Math.hypot(current[0] - previous[0], current[1] - previous[1]));
      maxSizeStep = Math.max(maxSizeStep, Math.abs(current[2] - previous[2]), Math.abs(current[3] - previous[3]));
      previous = current; samples++;
      return moving;
    };
    for (const value of [1, 0, 3, 0, 7, 0, 1, 0]) { input(value); await wait(250); }
    await wait(1200); viewer.render();
    const returned = snapshot();
    assert(samples > 20, 'Measure intermediate frames across repeated zero crossings');
    assert(maxCenterStep < 0.025 && maxSizeStep < 0.035,
      `Entry and return must avoid abrupt center or scale changes: ${JSON.stringify({ maxCenterStep, maxSizeStep, samples })}`);
    assert(returned.every((value, i) => Math.abs(value - assembled[i]) < 0.002), 'Returning to zero must restore the original framing');
    const settledSamples = samples;
    await wait(200);
    assert(samples === settledSamples, 'Stop rendering after the return settles');
    proto.render_explosion = original.render;
    document.querySelector('.tree-actions button').click(); await wait(400);
    viewer.inspect('reset'); viewer.finish_camera_transition();
    const overview = [];
    for (const value of [7, 15, 30]) {
      input(value); await wait(300); viewer.finish_explosion(); viewer.render();
      const box = snapshot();
      assert(box[0] - box[2] / 2 > 0 && box[0] + box[2] / 2 < 0.999
        && box[1] - box[3] / 2 > 0 && box[1] + box[3] / 2 < 0.999,
      `Keep the complete overview inside the canvas at ${value}%: ${JSON.stringify(box)}`);
      overview.push({ value, box });
    }
    assert(gl.getError() === gl.NO_ERROR && !document.querySelector('.model-error'), 'Keep the renderer healthy');
    return { maxCenterStep, maxSizeStep, samples, repeatedZeroCrossings: true, exactReturn: true, overview };
  } finally {
    proto.change_visibility = original.visibility; proto.render_explosion = original.render;
    input(0); document.querySelector('.tree-actions button').click();
    await wait(400);
  }
}

export async function checkVisibilityCamera() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const { AnatomyViewer } = await getWasm(), proto = AnatomyViewer.prototype;
  const data = JSON.parse((await getContent()).get_catalog()), catalog = await getCatalog();
  const target = data.targets.find(item => item.source_name === 'Cranium');
  const canvas = document.querySelector('.model-canvas canvas'), gl = canvas.getContext('webgl2');
  const slider = document.querySelector('.explode-control input');
  const original = { inspect: proto.inspect, capture: canvas.setPointerCapture, explosion: proto.render_explosion };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const settle = () => new Promise(resolve => setTimeout(resolve, 500));
  const opened = [];
  let viewer;
  proto.inspect = function(...args) { viewer = this; return original.inspect.apply(this, args); };
  const snapshot = () => {
    viewer.render();
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const box = { left: canvas.width, right: 0, top: canvas.height, bottom: 0, opaque: 0, grid: 0, hit: null };
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3];
      if (alpha > 0 && alpha < 255) box.grid++;
      if (alpha !== 255) continue;
      const x = i / 4 % canvas.width, y = canvas.height - 1 - Math.floor(i / 4 / canvas.width);
      box.left = Math.min(box.left, x); box.right = Math.max(box.right, x);
      box.top = Math.min(box.top, y); box.bottom = Math.max(box.bottom, y); box.opaque++;
      box.hit ??= { x, y };
    }
    assert(gl.getError() === gl.NO_ERROR, 'Visibility and reset must keep WebGL healthy');
    return box;
  };
  try {
    document.querySelectorAll('.tree-actions button')[1].click(); await frames();
    const ancestors = [];
    for (let current = target; current; current = data.targets.find(item => item.id === current.parent_id)) ancestors.unshift(current);
    for (const item of ancestors.slice(0, -1)) {
      const toggle = document.querySelector(`[data-target-id="${item.id}"] > .tree-row .folder-toggle`);
      if (toggle?.getAttribute('aria-expanded') === 'false') { opened.push(item.id); toggle.click(); await frames(); }
    }
    const checkbox = document.querySelector(`[data-target-id="${target.id}"] > .tree-row input[type="checkbox"]`);
    assert(checkbox, 'Find the skull visibility checkbox');
    checkbox.click(); checkbox.focus(); await settle();
    const reset = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true });
    checkbox.dispatchEvent(reset); checkbox.dispatchEvent(new KeyboardEvent('keyup', { key: 'r', bubbles: true }));
    assert(reset.defaultPrevented && viewer, 'R must work directly after checking a model');
    await settle(); viewer.finish_camera_transition();
    const focused = snapshot(), count = catalog.members(target.id).length;
    assert(viewer.visible_count() === count, 'Reset must preserve the checked structures');
    assert(focused.bottom - focused.top > canvas.height * 0.25, 'Reset must enlarge a small visible model');
    viewer.rotate(0.3, 0.1);
    const rotated = snapshot();
    assert(Math.abs(rotated.left + rotated.right - focused.left - focused.right) < canvas.width * 0.1
      && Math.abs(rotated.top + rotated.bottom - focused.top - focused.bottom) < canvas.height * 0.1,
    'Orbit must use the visible subset after resetting from checkboxes');
    viewer.inspect('reset'); viewer.finish_camera_transition();
    document.querySelector(`[data-target-id="${target.id}"] > .tree-row .tree-name`).click(); await frames();
    const link = document.querySelector('.reader-actions a[href^="https://openstax.org/"]');
    assert(link, 'Show the related OpenStax reference');
    const theme = document.documentElement.getAttribute('data-theme');
    try {
      for (const value of ['light', 'dark']) {
        document.documentElement.setAttribute('data-theme', value);
        assert(getComputedStyle(link).color === getComputedStyle(link.parentElement).color,
          `OpenStax must use the surrounding text color in ${value} mode`);
      }
    } finally {
      if (theme === null) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', theme);
    }
    const states = [];
    let samples = [];
    proto.render_explosion = function(...args) {
      const moving = original.explosion.apply(this, args);
      if (samples.length < 4) {
        const box = snapshot();
        samples.push({ left: box.left / canvas.width, right: box.right / canvas.width,
          top: box.top / canvas.height, bottom: box.bottom / canvas.height, opaque: box.opaque });
      }
      return moving;
    };
    for (const value of [15, 30, 45, 60, 80, 100, 60, 30, 0]) {
      samples = [];
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, String(value));
      slider.dispatchEvent(new Event('input', { bubbles: true })); await settle();
      viewer.finish_explosion(); viewer.finish_camera_transition();
      const box = snapshot();
      assert(box.opaque > 200, `Keep the skull visible at ${value}% separation`);
      assert(box.grid > 500, `Keep the grid visible at ${value}% separation`);
      const frame = document.querySelector('.model-focus-frame').getBoundingClientRect(), area = canvas.getBoundingClientRect();
      assert(box.left / canvas.width >= (frame.left - area.left) / area.width - 0.02
        && box.right / canvas.width <= (frame.right - area.left) / area.width + 0.02,
      `Keep the separated models between the panels at ${value}%`);
      assert(samples.every(sample => sample.opaque > 200
        && sample.left >= (frame.left - area.left) / area.width - 0.02
        && sample.right <= (frame.right - area.left) / area.width + 0.02
        && sample.top >= (frame.top - area.top) / area.height - 0.04
        && sample.bottom <= (frame.bottom - area.top) / area.height + 0.04),
      `Keep intermediate animation frames inside the viewport at ${value}%: ${JSON.stringify(samples)}`);
      states.push({ value, opaque: box.opaque, grid: box.grid, intermediateFrames: samples.length });
    }
    const box = snapshot(), area = canvas.getBoundingClientRect();
    const point = { clientX: area.left + (box.hit.x + 0.5) / canvas.width * area.width,
      clientY: area.top + (box.hit.y + 0.5) / canvas.height * area.height, pointerId: 999,
      pointerType: 'mouse', button: 2, bubbles: true };
    canvas.setPointerCapture = () => {};
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...point, buttons: 2 }));
    await new Promise(resolve => setTimeout(resolve, 700));
    const ring = document.querySelector('.model-hold-progress[data-action="hide"]');
    assert(ring && getComputedStyle(ring).visibility === 'visible', 'Show the hide progress around the pointer');
    const transform = new DOMMatrix(getComputedStyle(ring).transform);
    assert(transform.a * transform.d - transform.b * transform.c < 0, 'Hide progress must run opposite to move progress');
    await new Promise(resolve => setTimeout(resolve, 450));
    canvas.dispatchEvent(new PointerEvent('pointerup', point)); await settle();
    assert(viewer.visible_count() === count - 1, 'A completed right hold must hide exactly the hit structure');
    assert(document.querySelector('.model-hud').textContent.includes(`${count - 1}/`), 'Hiding must update study visibility as well as rendering');
    return { checkboxReset: true, smallModelZoom: true, visibleOrbit: true, states, reverseHideProgress: true, synchronizedVisibility: true, neutralOpenStax: true };
  } finally {
    canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 999 }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '0');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.tree-actions button').click();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'r', bubbles: true }));
    for (const id of opened.reverse()) document.querySelector(`[data-target-id="${id}"] > .tree-row .folder-toggle`)?.click();
    await settle();
    canvas.setPointerCapture = original.capture; proto.inspect = original.inspect; proto.render_explosion = original.explosion; catalog.free();
  }
}
