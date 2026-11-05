import { bundle, modelBytes } from './model.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, constants } from 'node:zlib';
import { createWebServer } from '../scripts/serve.mjs';

test('Brotli rejects an invalid block switch', () => {
  const input = Buffer.from('200010414141fcffff07002228f00b60f7f41f000000', 'hex');
  assert.equal(constants.BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH, -17);
  assert.throws(() => brotliDecompressSync(input), {
    code: 'ERR__ERROR_FORMAT_BLOCK_SWITCH',
    errno: -17,
  });
});

test('model storage keeps only compressed GLBs and serves their bytes without HTTP decoding', async () => {
  const directory = new URL('../public/models/z-anatomy/', import.meta.url);
  const storedBytes = modelBytes();
  const files = await readdir(directory);
  assert.equal(files.filter(file => file.endsWith('.glb.br')).length, 1);
  assert.deepEqual(files.filter(file => file.endsWith('.json')), ['z-anatomy.json']);
  assert(!files.some(file => file.endsWith('.glb')));
  const stored = storedBytes.length;
  const decoded = brotliDecompressSync(storedBytes).length;
  assert(stored < decoded * 0.52);
  const server = createWebServer(fileURLToPath(directory));
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const model = { file: 'z-anatomy.glb.br', bytes: storedBytes.length };
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
