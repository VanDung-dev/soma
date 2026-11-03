import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('hand start region follows the letterboxed image and excludes visible panels', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { measureHandRegion } = await server.ssrLoadModule('/src/anatomy/viewer/layout.ts');
    const box = (left, top, width, height) => ({ getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }) });
    const host = box(100, 50, 1000, 800), frame = box(300, 100, 600, 600);
    const video = { videoWidth: 640, videoHeight: 480 };
    let reads = 0;
    const bounds = host.getBoundingClientRect;
    host.getBoundingClientRect = () => { reads++; return bounds(); };
    const result = measureHandRegion(host, video, frame, [box(320, 120, 180, 280), box(0, 0, 0, 0)]);
    assert.equal(reads, 1, 'Measure the camera host once per frame');
    const expected = [0.2, 25 / 750, 0.8, 625 / 750, 0.22, 45 / 750, 0.4, 325 / 750];
    assert.equal(result.length, expected.length);
    result.forEach((value, index) => assert(Math.abs(value - expected[index]) < 1e-10));
    assert.deepEqual(measureHandRegion(box(0, 0, 600, 1000), { videoWidth: 1280, videoHeight: 720 },
      box(0, 100, 600, 800), [box(0, 0, 600, 100)]), [0, 0, 1, 1]);
    assert.deepEqual(measureHandRegion(host, { videoWidth: 0, videoHeight: 0 }, frame, []), [0, 0, 0, 0]);
    for (const [width, height] of [[0, 800], [1000, 0], [0, 0]]) {
      assert.deepEqual(measureHandRegion(box(100, 50, width, height), video, frame, []), [0, 0, 0, 0]);
    }
  } finally { await server.close(); }
});

test('camera mode reclaims hidden panels without collapsing the viewport', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const originalWindow = globalThis.window;
  try {
    const { measureViewport } = await server.ssrLoadModule('/src/anatomy/viewer/layout.ts');
    let desktop = true;
    globalThis.window = { matchMedia: () => ({ matches: desktop }) };
    const box = (left, top, width, height) => ({ hidden: false, getBoundingClientRect() {
      return this.hidden ? { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
        : { left, top, width, height, right: left + width, bottom: top + height };
    } });
    const elements = { host: box(100, 50, 1000, 800), frame: { style: {} }, menu: box(112, 62, 976, 48),
      catalog: box(112, 122, 200, 712), information: box(888, 122, 200, 712), hud: box(450, 750, 300, 80) };
    const normal = measureViewport(elements);
    assert.equal(elements.frame.style.width, '552px');
    for (const [catalogHidden, informationHidden, left, width] of [
      [true, false, '12px', '764px'], [false, true, '224px', '764px'], [true, true, '12px', '976px'],
    ]) {
      elements.catalog.hidden = catalogHidden;
      elements.information.hidden = informationHidden;
      measureViewport(elements);
      assert.equal(elements.frame.style.left, left);
      assert.equal(elements.frame.style.width, width);
      assert.equal(elements.frame.style.height, '712px');
    }
    elements.catalog.hidden = elements.information.hidden = true;
    for (const compact of [false, true]) {
      desktop = !compact;
      const camera = measureViewport(elements);
      assert.equal(elements.frame.style.left, '12px');
      assert.equal(elements.frame.style.top, '72px');
      assert.equal(elements.frame.style.width, '976px');
      assert.equal(elements.frame.style.height, '712px');
      assert(camera[2] > normal[2]);
      assert(camera.every(value => value > 0 && value <= 1));
    }
    desktop = true;
    elements.catalog.hidden = elements.information.hidden = false;
    assert.deepEqual(measureViewport(elements), normal);
    const catalogBounds = elements.catalog.getBoundingClientRect, informationBounds = elements.information.getBoundingClientRect;
    elements.catalog.getBoundingClientRect = box(-112, 122, 200, 712).getBoundingClientRect;
    elements.information.getBoundingClientRect = box(1112, 122, 200, 712).getBoundingClientRect;
    measureViewport(elements);
    assert.equal(elements.frame.style.left, '12px');
    assert.equal(elements.frame.style.width, '976px');
    elements.catalog.getBoundingClientRect = catalogBounds;
    elements.information.getBoundingClientRect = informationBounds;
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    await server.close();
  }
});
