import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { createCatalogFixture } from './catalog.fixture.mjs';

test('lesson structure setup loads combined and legacy metadata through the Rust catalog', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const originalFetch = globalThis.fetch;
  const catalogs = [];
  try {
    const { loadModelMetadata } = await server.ssrLoadModule('/src/model-assets.ts');
    const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
    const source = await readJson('../../../content/catalog.json');
    const bundle = await readJson('../public/models/z-anatomy/z-anatomy.json');
    const bundledPath = 'models/z-anatomy/z-anatomy.json';
    const requests = [], files = new Map([[bundledPath, bundle]]);
    const controller = new AbortController();
    globalThis.fetch = async (url, { signal }) => {
      const path = new URL(url, 'http://soma.test').pathname.slice(1);
      requests.push(path);
      assert.equal(signal, controller.signal);
      assert(files.has(path), `Request a planned metadata file: ${path}`);
      return Response.json(files.get(path));
    };

    const combined = await createCatalogFixture(server, source);
    catalogs.push(combined);
    await loadModelMetadata(combined, controller.signal);
    assert.deepEqual(requests, [bundledPath]);
    const root = source.targets.find(target => target.model);
    const part = bundle.metadata[root.id].structures[0].source_id;
    assert(combined.identities().includes(part), 'Index the loaded metadata before publishing readiness');

    const legacyPath = 'models/z-anatomy/skeletal-system.json';
    root.model.path = 'models/z-anatomy/skeletal-system.glb';
    files.set(legacyPath, bundle.metadata[root.id]);
    const mixed = await createCatalogFixture(server, source);
    catalogs.push(mixed);
    requests.length = 0;
    await loadModelMetadata(mixed, controller.signal);
    assert.deepEqual(requests, [legacyPath, bundledPath]);
    assert.deepEqual(mixed.identities(), combined.identities());

    const cancelled = await createCatalogFixture(server, source);
    catalogs.push(cancelled);
    globalThis.fetch = async () => {
      controller.abort();
      return Response.json(bundle);
    };
    await assert.rejects(loadModelMetadata(cancelled, controller.signal), { name: 'AbortError' });
    assert.deepEqual(cancelled.identities(), []);
  } finally {
    globalThis.fetch = originalFetch;
    for (const catalog of catalogs) catalog.free();
    await server.close();
  }
});
