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
    for (const modelQuality of ['low', 'high']) for (const frameRate of [30, 60]) {
      const settings = { shadowQuality: 'low', lightingQuality: 'low', modelQuality, frameRate, grid: false, showFps: true };
      globalThis.window = { localStorage: { getItem: () => JSON.stringify(settings) } };
      assert.deepEqual(readGraphicsSettings(), settings);
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
    const pending = new Map(), timers = new Map(), reports = [];
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
    runtime = new ViewerRuntime(host, { frame() {}, viewport() {}, onState() {}, onPick() {}, onFps: fps => reports.push(fps) });
    runtime.viewer = {
      advance_camera: () => false, advance_reconstruction: () => false,
      render: () => draws++, render_reconstruction: () => { draws++; return --remaining > 0; },
      set_graphics() {}, selected_id: () => '', free() {},
    };
    runtime.scheduleRender();
    assert.equal(pending.size, 0, 'Partially uploaded anatomy must not render during loading');
    runtime.loading = false;
    const tick = time => {
      now = time;
      const callbacks = [...pending.values()]; pending.clear();
      callbacks.forEach(callback => callback(time));
    };
    for (const frameRate of [30, 60]) {
      runtime.graphics = { ...runtime.graphics, frameRate };
      runtime.lastRenderTime = -Infinity; draws = 0;
      const start = now;
      for (let frame = 0; frame < 120; frame++) {
        runtime.scheduleRender(); runtime.scheduleRender();
        assert.equal(pending.size, 1);
        tick(start + frame * 1000 / 120);
      }
      assert.equal(draws, frameRate);
      while (pending.size) tick(now + 1000 / 30);
      assert.equal(pending.size, 0);
    }
    runtime.graphics.frameRate = 30; runtime.animating = true; remaining = 2;
    runtime.scheduleRender();
    for (let frame = 0; frame < 12; frame++) tick(now + 1000 / 120);
    assert.equal(runtime.animating, false);
    assert.equal(pending.size, 0);
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
    runtime.setGraphics({ ...runtime.graphics, showFps: true });
    runtime.dispose();
    assert.equal(timers.size, 0, 'Disposal must stop the FPS meter');
    const before = draws; tick(now + 1000);
    assert.equal(draws, before);
    runtime.scheduleRender(); assert.equal(pending.size, 0);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
    await server.close();
  }
});
