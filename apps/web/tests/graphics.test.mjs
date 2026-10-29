import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('graphics preferences validate saved values and tolerate unavailable storage', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const previousWindow = globalThis.window;
  try {
    const { readGraphicsSettings, defaultGraphics } = await server.ssrLoadModule('/src/anatomy/viewer/graphics.ts');
    for (const value of [null, 'invalid', '{}', '{"quality":"ultra","frameRate":-1,"grid":"false"}']) {
      globalThis.window = { localStorage: { getItem: () => value } };
      assert.deepEqual(readGraphicsSettings(), defaultGraphics);
    }
    for (const modelQuality of ['low', 'high']) for (const frameRate of [30, 60, 120, 'display']) {
      const settings = { shadowQuality: 'low', lightingQuality: 'low', modelQuality, frameRate, grid: false, showFps: true, showAxes: false };
      globalThis.window = { localStorage: { getItem: () => JSON.stringify(settings) } };
      assert.deepEqual(readGraphicsSettings(), settings);
    }
    for (const [value, expected] of [[false, false], [true, true], ['false', true], [null, true]]) {
      globalThis.window = { localStorage: { getItem: () => JSON.stringify({ showAxes: value }) } };
      assert.equal(readGraphicsSettings().showAxes, expected, 'Default to visible for old or invalid preferences');
    }
    for (const frameRate of [null, 0, -1, 59, 144, 240, '120', 'unlimited', 'auto']) {
      globalThis.window = { localStorage: { getItem: () => JSON.stringify({ frameRate }) } };
      assert.equal(readGraphicsSettings().frameRate, 60, 'Invalid or retired frame limits must retain the default');
    }
    for (const [quality, shadowQuality] of [['low', 'off'], ['balanced', 'low'], ['high', 'high']]) {
      globalThis.window = { localStorage: { getItem: () => JSON.stringify({ quality, frameRate: 30, grid: false }) } };
      assert.deepEqual(readGraphicsSettings(), { ...defaultGraphics, shadowQuality, modelQuality: quality === 'low' ? 'low' : 'high', frameRate: 30, grid: false });
    }
    globalThis.window = { localStorage: { getItem: () => JSON.stringify({ lightingQuality: 'balanced', modelQuality: 'balanced', frameRate: 0 }) } };
    assert.deepEqual(readGraphicsSettings(), defaultGraphics, 'Retired levels must migrate to High and 60 FPS');
    globalThis.window = { localStorage: { getItem: () => JSON.stringify({ shadowQuality: 'high', lightingQuality: 'low', modelQuality: 'high' }) } };
    assert.deepEqual(readGraphicsSettings(), { ...defaultGraphics, shadowQuality: 'high', lightingQuality: 'low' });
    globalThis.window = { get localStorage() { throw Error('Storage unavailable'); } };
    assert.deepEqual(readGraphicsSettings(), defaultGraphics);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    await server.close();
  }
});

test('frame limits coalesce redraws, finish animations, and stop when idle or disposed', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const original = { requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame,
    performance: globalThis.performance, document: globalThis.document, window: globalThis.window, ResizeObserver: globalThis.ResizeObserver };
  try {
    const { ViewerRuntime } = await server.ssrLoadModule('/src/anatomy/viewer/runtime.ts');
    let now = 0, nextId = 0, draws = 0, remaining = 0, timerId = 0;
    const pending = new Map(), timers = new Map(), reports = [], grids = [], renderSizes = [], orientations = [];
    let axes = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    globalThis.requestAnimationFrame = callback => { pending.set(++nextId, callback); return nextId; };
    globalThis.cancelAnimationFrame = id => pending.delete(id);
    globalThis.performance = { now: () => now };
    let runtime;
    const host = { appendChild() {}, getBoundingClientRect: () => ({ width: 800, height: 600 }) };
    const canvas = { setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} };
    globalThis.document = { createElement: () => canvas };
    globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      setInterval: callback => { timers.set(++timerId, callback); return timerId; }, clearInterval: id => timers.delete(id) };
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    runtime = new ViewerRuntime(host, { viewport() {}, onState() {}, onPick() {}, onFps: fps => reports.push(fps),
      onOrientation: axes => orientations.push(axes) });
    runtime.viewer = {
      advance_camera: () => false, advance_reconstruction: () => false,
      camera_axes: () => axes.slice(),
      render: () => draws++, render_reconstruction: () => { draws++; return --remaining > 0; },
      set_graphics: (_shadow, _lighting, grid, width, height) => { grids.push(grid); renderSizes.push([width, height]); }, selected_id: () => '', free() {},
    };
    runtime.scheduleRender();
    assert.equal(pending.size, 0, 'Partially uploaded anatomy must not render during loading');
    runtime.loading = false;
    runtime.setGraphics({ ...runtime.graphics, grid: true });
    assert.equal(grids.at(-1), true, 'Hand camera mode must leave the scene grid preference unchanged');
    const tick = time => {
      now = time;
      const callbacks = [...pending.values()]; pending.clear();
      callbacks.forEach(callback => callback(time));
    };
    for (const refreshRate of [60, 120, 144, 240]) for (const frameRate of [30, 60, 120, 'display']) {
      runtime.graphics = { ...runtime.graphics, frameRate };
      runtime.lastRenderTime = -Infinity; draws = 0;
      const start = now;
      for (let frame = 0; frame < refreshRate; frame++) {
        runtime.scheduleRender(); runtime.scheduleRender();
        assert.equal(pending.size, 1);
        tick(start + frame * 1000 / refreshRate);
      }
      assert.equal(draws, frameRate === 'display' ? refreshRate : Math.min(frameRate, refreshRate), `${frameRate} FPS at ${refreshRate} Hz`);
      while (pending.size) tick(now + 1000 / 30);
      assert.equal(pending.size, 0);
    }
    assert.equal(orientations.length, 1, 'Unchanged camera axes must not trigger UI updates on each render');
    axes = new Float32Array([0, 0, 1, 0, 1, 0, -1, 0, 0]);
    runtime.scheduleRender(); tick(now + 100);
    assert.equal(orientations.length, 2, 'Publish changed axes on the same render as the camera');
    assert.deepEqual(orientations.at(-1), axes);
    assert.equal(pending.size, 0, 'The axes must not keep the viewer rendering while idle');
    runtime.graphics.frameRate = 30; runtime.animating = true; remaining = 2;
    runtime.scheduleRender();
    for (let frame = 0; frame < 12; frame++) tick(now + 1000 / 120);
    assert.equal(runtime.animating, false);
    assert.equal(pending.size, 0);
    runtime.viewer.advance_camera = () => --remaining > 0;
    remaining = 3;
    runtime.scheduleRender();
    for (let frame = 0; frame < 12; frame++) tick(now + 1000 / 120);
    assert.equal(remaining, 0, 'Keep drawing until WASM finishes the camera transition');
    assert.equal(pending.size, 0, 'Stop drawing after the camera transition finishes');
    runtime.viewer.advance_camera = () => false;
    runtime.setGraphics({ ...runtime.graphics, frameRate: 30, showFps: true });
    const sample = [...timers.values()][0], start = now;
    for (let frame = 0; frame < 30; frame++) {
      runtime.scheduleRender(); tick(start + frame * 1000 / 30);
    }
    now = start + 1000; sample();
    assert.equal(reports.at(-1), 30, 'Count actual draws, not display refresh callbacks');
    now += 1000; sample();
    assert.equal(reports.at(-1), 0, 'Report zero when the on-demand viewer is idle');
    assert.equal(pending.size, 0, 'The FPS meter must not request render frames');
    runtime.setGraphics({ ...runtime.graphics, showFps: false });
    assert.equal(timers.size, 0, 'Disabling the meter must stop its timer');
    tick(now + 100);
    let resized = 0, reframed = 0;
    canvas.width = 800; canvas.height = 600;
    host.getBoundingClientRect = () => ({ width: 900, height: 650 });
    runtime.options.viewport = () => [0, 0, 1, 1];
    runtime.viewer.resize = (width, height) => { canvas.width = width; canvas.height = height; resized++; };
    runtime.viewer.reframe = () => { reframed++; };
    runtime.lastRenderTime = now;
    runtime.resize(); runtime.resize();
    assert.equal(resized, 0, 'ResizeObserver must preserve the current canvas until a draw is due');
    assert.equal(pending.size, 1, 'Coalesce repeated resize notifications');
    const drawsBeforeResize = draws;
    tick(now + 1);
    assert.equal(resized, 0, 'A throttled frame must not clear the canvas');
    tick(now + 40);
    assert.equal(resized, 1);
    assert.equal(reframed, 1);
    assert.equal(draws, drawsBeforeResize + 1, 'Resize and redraw must finish in the same frame');
    assert.deepEqual([canvas.width, canvas.height], [900, 650]);
    runtime.resize(); tick(now + 40);
    assert.equal(resized, 1, 'Unchanged pixel dimensions must not reallocate the canvas');
    for (const [dpr, modelQuality, expected] of [[3, 'high', [1800, 1300]], [3, 'low', [900, 650]],
      [1.25, 'high', [1125, 813]], [1.25, 'low', [563, 406]]]) {
      window.devicePixelRatio = dpr;
      runtime.setGraphics({ ...runtime.graphics, modelQuality });
      runtime.resize(); tick(now + 40);
      assert.deepEqual(renderSizes.at(-1), expected, 'Graphics settings must respect quality, DPR cap and rounding');
      assert.deepEqual([canvas.width, canvas.height], expected, 'Resize must use the same resolution as graphics settings');
    }
    const resizesBeforeDispose = resized;
    const views = [];
    runtime.viewer.orient = (...args) => views.push(args);
    assert(runtime.control([{ kind: 'orient', axis: 'Y', direction: -1 }]));
    assert.deepEqual(views.at(-1), ['Y', -1, now], 'Route preset views through the shared camera animation');
    runtime.motion.matches = true;
    assert(runtime.control([{ kind: 'orient', axis: 'Z', direction: 1 }]));
    assert.deepEqual(views.at(-1), ['Z', 1, undefined], 'Snap axis views immediately under reduced motion');
    runtime.setGraphics({ ...runtime.graphics, showFps: true });
    runtime.dispose();
    assert.equal(timers.size, 0, 'Disposal must stop the FPS meter');
    const before = draws; tick(now + 1000);
    assert.equal(draws, before);
    runtime.resize(); tick(now + 1000);
    assert.equal(resized, resizesBeforeDispose, 'Disposed runtimes must not resize GPU resources');
    runtime.scheduleRender(); assert.equal(pending.size, 0);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
    await server.close();
  }
});
