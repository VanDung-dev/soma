import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('lesson structure setup accepts combined and legacy per-model metadata', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { metadataForRoot } = await server.ssrLoadModule('/src/lessons/editor/model-setup.tsx');
    const model = { structures: [{ source_id: 'za:part' }] };
    assert.deepEqual(metadataForRoot({ metadata: { 'collection:skeletal': model } }, 'collection:skeletal'), model);
    assert.deepEqual(metadataForRoot(model, 'collection:skeletal'), model);
    assert.throws(() => metadataForRoot({ metadata: {} }, 'collection:skeletal'), /Missing system metadata/);
  } finally { await server.close(); }
});
