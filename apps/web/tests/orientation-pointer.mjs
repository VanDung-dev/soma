import assert from 'node:assert/strict';

export async function checkAnatomyOverviewResize(page) {
  const originalSize = page.viewportSize();
  const canvas = page.locator('.model-canvas canvas');
  await page.evaluate(async () => {
    const { AnatomyViewer } = await import('/src/anatomy/core.ts').then(module => module.getWasm());
    const resize = AnatomyViewer.prototype.resize;
    const probe = window.anatomyOverviewProbe = { restore: () => { AnatomyViewer.prototype.resize = resize; } };
    AnatomyViewer.prototype.resize = function (...args) {
      probe.viewer = this;
      return resize.apply(this, args);
    };
  });
  const measure = () => canvas.evaluate(async canvas => {
    for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame);
    window.anatomyOverviewProbe.viewer.render();
    const gl = canvas.getContext('webgl2');
    const { width, height } = canvas;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let left = width, right = -1, top = height, bottom = -1;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 255) continue;
      const pixel = (i - 3) / 4;
      const x = pixel % width, y = height - 1 - Math.floor(pixel / width);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    const rect = canvas.getBoundingClientRect();
    return [(rect.x + (left + right + 1) * rect.width / width / 2) / innerWidth,
      (rect.y + (top + bottom + 1) * rect.height / height / 2) / innerHeight,
      (bottom - top + 1) * rect.height / height / innerHeight];
  });
  const expectProportions = (measured, expected, label) => {
    assert(measured.every((value, index) => Math.abs(value - expected[index]) < 0.004), `${label}: ${measured}`);
  };
  const sizes = [[1280, 800], [1152, 720], [1120, 700], [800, 500], [1920, 1200], [1280, 800]];
  try {
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      expectProportions(await measure(), [0.5, 0.5, 0.75], `Anatomy overview at ${width}×${height}`);
    }
    await page.evaluate(() => {
      const { viewer } = window.anatomyOverviewProbe;
      viewer.rotate(-0.4, 0.12);
      viewer.zoom(0.92);
      viewer.pan(-0.03, 0.02);
    });
    const manual = await measure();
    assert(Math.abs(manual[2] - 0.75) > 0.01, 'Change the zoom before testing manual framing');
    for (const [width, height] of sizes.slice(1)) {
      await page.setViewportSize({ width, height });
      expectProportions(await measure(), manual, `Manual camera at ${width}×${height}`);
    }
    await canvas.press('r');
    await page.evaluate(() => window.anatomyOverviewProbe.viewer.finish_camera_transition());
    expectProportions(await measure(), [0.5, 0.5, 0.75], 'Reset restores the overview framing');
  } finally {
    await page.evaluate(() => {
      window.anatomyOverviewProbe.restore();
      delete window.anatomyOverviewProbe;
    });
    await page.setViewportSize(originalSize);
  }
  return { overview: true, manualCamera: true, reset: true };
}

export async function checkOrientationPointer(page, { touch = false } = {}) {
  await page.evaluate(async () => {
    const { AnatomyViewer } = await import('/src/anatomy/core.ts').then(module => module.getWasm());
    const probe = window.__orientationPointer = { originals: {}, viewer: null, views: [], rotations: 0 };
    for (const name of ['camera_axes', 'orient', 'rotate']) {
      probe.originals[name] = AnatomyViewer.prototype[name];
      AnatomyViewer.prototype[name] = function(...args) {
        probe.viewer = this;
        if (name === 'orient') probe.views.push(args.slice(0, 2));
        if (name === 'rotate') probe.rotations++;
        return probe.originals[name].apply(this, args);
      };
    }
  });
  const point = async (axis, direction) => {
    const area = await page.locator(`.orientation-axes [data-axis="${axis}"][data-direction="${direction}"] circle:not(.orientation-hit-target)`).boundingBox();
    return { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  };
  const reset = async () => {
    await page.locator('.model-canvas canvas').press('r');
    await page.waitForFunction(() => {
      const endpoint = document.querySelector('.orientation-axes [data-axis="X"][data-direction="1"]');
      const marker = endpoint?.querySelector('circle');
      return marker && Number(marker.getAttribute('cx')) === 56 && Number(marker.getAttribute('cy')) === 56
        && Number(endpoint.getAttribute('opacity')) === 1;
    });
    const front = await point('X', 1);
    await page.mouse.move(front.x, front.y);
    await page.mouse.down();
    await page.mouse.move(front.x - 55, front.y + 55, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => {
      const marker = document.querySelector('.orientation-axes [data-axis="X"][data-direction="1"] circle');
      return Math.abs(Number(marker.getAttribute('cx')) - 56) > 15;
    });
    await page.evaluate(() => { window.__orientationPointer.views = []; window.__orientationPointer.rotations = 0; });
  };
  try {
    await reset();
    await page.mouse.move(0, 0);
    assert.equal(await page.locator('.orientation-axes [aria-pressed="true"]').count(), 0, 'The default view must not show a selected axis');
    const target = page.locator('.orientation-axes [data-axis="X"][data-direction="-1"]');
    const appearance = () => target.evaluate(endpoint => ({
      fill: getComputedStyle(endpoint.querySelector('circle:not(.orientation-hit-target)')).fill,
      stroke: getComputedStyle(endpoint.querySelector('circle:not(.orientation-hit-target)')).stroke,
      text: getComputedStyle(endpoint.querySelector('text')).fill,
      textOpacity: getComputedStyle(endpoint.querySelector('text')).opacity,
      groupOpacity: getComputedStyle(endpoint).opacity,
    }));
    const normal = await appearance(), hoverPoint = await point('X', -1);
    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    assert.deepEqual(await appearance(), { ...normal, text: 'rgb(255, 255, 255)', textOpacity: '1', groupOpacity: '1' }, 'Hover must reveal a readable label and preserve the neutral background');
    assert.equal(normal.fill, 'rgba(18, 23, 21, 0.75)', 'Give negative endpoints a neutral background');
    assert.equal(normal.textOpacity, '0', 'Hide negative labels before hover');
    await page.mouse.move(0, 0);
    assert.deepEqual(await appearance(), normal, 'Restore the label when the pointer leaves');
    for (const [index, axis] of [...'XYZ'].entries()) for (const direction of [-1, 1]) {
      await reset();
      const p = await point(axis, direction);
      await page.mouse.click(p.x, p.y);
      assert.deepEqual(await page.evaluate(() => window.__orientationPointer.views), [[axis, direction]], 'Click the selected endpoint exactly once');
      await page.waitForFunction(({ index, direction }) => Math.abs(window.__orientationPointer.viewer.camera_axes()[index * 3 + 2] - direction) < 1e-5,
        { index, direction });
      await page.waitForFunction(({ axis, direction }) => document.querySelector(`.orientation-axes [data-axis="${axis}"][data-direction="${direction}"]`)?.getAttribute('aria-pressed') === 'true',
        { axis, direction });
      await page.mouse.move(0, 0);
      const selected = page.locator(`.orientation-axes [data-axis="${axis}"][data-direction="${direction}"]`);
      const selectedStyle = await selected.evaluate(element => ({
        stroke: getComputedStyle(element.querySelector('circle:not(.orientation-hit-target)')).stroke,
        fill: getComputedStyle(element.querySelector('circle:not(.orientation-hit-target)')).fill,
        color: getComputedStyle(element).color,
        text: getComputedStyle(element.querySelector('text')).fill,
        opacity: getComputedStyle(element.querySelector('text')).opacity,
      }));
      assert.equal(selectedStyle.stroke, selectedStyle.color, 'Keep the selected endpoint border in its axis color');
      assert.equal(selectedStyle.fill, selectedStyle.color, 'Fill the selected endpoint with its axis color');
      assert.equal(selectedStyle.text, 'rgb(16, 24, 39)', 'Keep the selected label dark while the pointer is away');
      assert.equal(selectedStyle.opacity, '1', 'Keep the selected direction visible after the pointer leaves');
      const centered = await point(axis, direction);
      await page.mouse.move(centered.x, centered.y);
      assert.equal(await selected.evaluate(element => getComputedStyle(element.querySelector('text')).fill), 'rgb(255, 255, 255)',
        'Brighten the selected label when the pointer returns');
      await page.mouse.click(centered.x, centered.y);
      assert.deepEqual(await page.evaluate(() => window.__orientationPointer.views), [[axis, direction], [axis, -direction]],
        'Clicking the centered axis again must select its opposite');
      await page.waitForFunction(({ axis, direction }) => document.querySelector(`.orientation-axes [data-axis="${axis}"][data-direction="${-direction}"]`)?.getAttribute('aria-pressed') === 'true',
        { axis, direction });
    }
    if (touch) {
      await reset();
      const p = await point('Y', 1);
      await page.touchscreen.tap(p.x, p.y);
      assert.deepEqual(await page.evaluate(() => window.__orientationPointer.views), [['Y', 1]], 'Touch must choose an axis exactly once');
      await page.waitForFunction(() => Math.abs(window.__orientationPointer.viewer.camera_axes()[5] - 1) < 1e-5);
      await page.waitForSelector('.orientation-axes [data-axis="Y"][data-direction="1"][aria-pressed="true"]');
      const centered = await point('Y', 1);
      await page.touchscreen.tap(centered.x, centered.y);
      assert.deepEqual(await page.evaluate(() => window.__orientationPointer.views), [['Y', 1], ['Y', -1]],
        'Tapping the centered axis again must select its opposite');
      await page.waitForSelector('.orientation-axes [data-axis="Y"][data-direction="-1"][aria-pressed="true"]');
    }
    await reset();
    const p = await point('X', 1);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move(p.x - 110, p.y + 40, { steps: 8 }); await page.mouse.up();
    const dragged = await page.evaluate(() => ({ views: window.__orientationPointer.views, rotations: window.__orientationPointer.rotations,
      selection: getSelection().toString(), active: document.querySelector('.orientation-axes').dataset.dragging }));
    assert.deepEqual(dragged.views, [], 'Dragging an endpoint must not snap on release');
    assert(dragged.rotations > 0 && dragged.selection === '' && !dragged.active, 'Drag must rotate beyond the widget without selecting text or retaining capture');
    assert.equal(await page.locator('.orientation-axes [aria-pressed="true"]').count(), 0, 'Dragging must clear the selected axis');
    await page.mouse.move(p.x - 150, p.y + 60);
    assert.equal(await page.evaluate(() => window.__orientationPointer.rotations), dragged.rotations, 'Release must stop rotation');
    for (const event of ['pointercancel', 'blur']) {
      await reset();
      const start = await point('X', 1);
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.mouse.move(start.x - 10, start.y + 5);
      await page.evaluate(event => event === 'blur' ? window.dispatchEvent(new Event('blur'))
        : document.querySelector('.orientation-axes').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })), event);
      const before = await page.evaluate(() => window.__orientationPointer.rotations);
      await page.mouse.move(start.x - 30, start.y + 20); await page.mouse.up();
      assert.equal(await page.evaluate(() => window.__orientationPointer.rotations), before, 'Cancelled or unfocused dragging must stop');
      assert.deepEqual(await page.evaluate(() => window.__orientationPointer.views), [], 'Cancelled dragging must not select a preset');
    }
    return { labelHover: true, selectedView: true, sixMousePresets: true, reverseOnRepeat: true, ...(touch ? { touchTap: true } : {}), capturedDrag: true, noSnapAfterDrag: true, noSelection: true,
      release: true, cancel: true, blur: true };
  } finally {
    await page.mouse.up();
    await page.evaluate(async () => {
      const { AnatomyViewer } = await import('/src/anatomy/core.ts').then(module => module.getWasm());
      Object.assign(AnatomyViewer.prototype, window.__orientationPointer.originals);
      delete window.__orientationPointer;
    });
    await page.locator('.model-canvas canvas').press('r');
  }
}
