import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

test('image compression preserves WebP, animated PNG and originals on unsupported browsers', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const previous = { OffscreenCanvas: globalThis.OffscreenCanvas, createImageBitmap: globalThis.createImageBitmap };
  try {
    const { compressLessonImage } = await server.ssrLoadModule('/src/lessons/compress-image.ts');
    const png = new Uint8Array(await readFile(new URL('../public/home/anatomy.png', import.meta.url)));
    delete globalThis.OffscreenCanvas;
    assert.equal(await compressLessonImage(png, 'image/png'), png);
    globalThis.OffscreenCanvas = class {};
    delete globalThis.createImageBitmap;
    assert.equal(await compressLessonImage(png, 'image/png'), png);
    globalThis.createImageBitmap = async () => { throw new Error('decode failed'); };
    assert.equal(await compressLessonImage(png, 'image/webp'), png);
    const animated = new Uint8Array(png.length + 20);
    animated.set(png.subarray(0, 33));
    animated.set([0, 0, 0, 8, 97, 99, 84, 76, 0, 0, 0, 1], 33);
    animated.set(png.subarray(33), 53);
    assert.equal(await compressLessonImage(animated, 'image/png'), animated, 'Do not flatten animated PNG');
    await assert.rejects(compressLessonImage(png, 'image/png'), /decode failed/, 'Static PNG enters compression and propagates failures');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
    await server.close();
  }
});
