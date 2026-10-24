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
    const result = measureHandRegion(host, video, frame, [box(320, 120, 180, 280), box(0, 0, 0, 0)]);
    const expected = [0.2, 25 / 750, 0.8, 625 / 750, 0.22, 45 / 750, 0.4, 325 / 750];
    assert.equal(result.length, expected.length);
    result.forEach((value, index) => assert(Math.abs(value - expected[index]) < 1e-10));
    assert.deepEqual(measureHandRegion(box(0, 0, 600, 1000), { videoWidth: 1280, videoHeight: 720 },
      box(0, 100, 600, 800), [box(0, 0, 600, 100)]), [0, 0, 1, 1]);
    assert.deepEqual(measureHandRegion(host, { videoWidth: 0, videoHeight: 0 }, frame, []), [0, 0, 0, 0]);
  } finally { await server.close(); }
});
