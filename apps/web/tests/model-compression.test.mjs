import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createWebServer } from '../scripts/serve.mjs';

test('model storage keeps only compressed GLBs and serves their bytes without HTTP decoding', async () => {
  const directory = new URL('../public/models/z-anatomy/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory)));
  const files = await readdir(directory);
  assert.equal(files.filter(file => file.endsWith('.glb.br')).length, 9);
  assert(!files.some(file => file.endsWith('.glb')));
  const stored = manifest.models.reduce((sum, model) => sum + model.bytes, 0);
  const decoded = manifest.models.reduce((sum, model) => sum + model.uncompressed_bytes, 0);
  assert(stored < decoded * 0.52);
  const server = createWebServer(fileURLToPath(directory));
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const model = manifest.models[0];
    const bytes = await readFile(new URL(model.file, directory));
    for (const encoding of ['br', 'identity']) {
      const response = await fetch(`${base}/${model.file}`, { headers: { 'Accept-Encoding': encoding } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-encoding'), null);
      assert.equal(response.headers.get('content-type'), 'application/octet-stream');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    const head = await fetch(`${base}/${model.file}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal((await fetch(`${base}/${model.file.replace(/\.br$/, '')}`)).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
