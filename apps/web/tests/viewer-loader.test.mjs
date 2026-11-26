import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { initCatalogWasm } from './catalog.fixture.mjs';

test('one GLB and one JSON supply ordered metadata and clean up cancellation and worker failure', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const original = { fetch: globalThis.fetch, Worker: globalThis.Worker, indexedDB: globalThis.indexedDB };
  const requests = [], signals = [], workers = [], posted = [];
  let workerFailure = false, badMetadata = false;
  let catalog;
  try {
    const { loadModels } = await server.ssrLoadModule('/src/viewer/loader.ts');
    const wasm = await initCatalogWasm(server);
    const { Catalog } = await server.ssrLoadModule('/src/catalog/index.ts');
    catalog = new Catalog(new wasm.CatalogData());
    const roots = catalog.roots.slice(0, 5);
    const { bundle } = catalog.modelLoadPlan(roots.map(root => root.id).reverse());
    const payload = JSON.parse(await readFile(new URL('../public/models/z-anatomy/z-anatomy.json', import.meta.url), 'utf8'));
    const expected = roots.flatMap(root => payload.metadata[root.id].structures.map(part => part.source_id));
    assert.deepEqual(bundle.rootIds, roots.map(root => root.id));
    globalThis.indexedDB = undefined;
    globalThis.fetch = async (url, { signal }) => {
      requests.push(url); signals.push(signal);
      if (url.endsWith('.json')) return Response.json({
        manifest: payload.manifest,
        metadata: badMetadata ? {} : payload.metadata,
      });
      return new Response(new Uint8Array([5]));
    };
    globalThis.Worker = class {
      constructor() { this.terminated = false; workers.push(this); }
      postMessage(data, transfers) {
        posted.push(data.selected);
        assert.deepEqual(data.ids, payload.manifest.models.flatMap(model => model.source_ids));
        assert.equal(transfers[0], data.bytes.buffer);
        queueMicrotask(() => {
          if (workerFailure) this.onerror({ message: 'Preparation failed' });
          else this.onmessage({ data: {
            prepared: [new Float32Array([5]), new Uint32Array([0]), '{}'],
          } });
        });
      }
      terminate() { this.terminated = true; }
    };
    const controller = new AbortController(), progress = [], completed = [];
    for await (const { geometry, metadata } of loadModels(catalog, bundle, controller.signal, count => progress.push(count))) {
      assert.equal(catalog.detail(expected[0]), undefined, 'Keep metadata staged until the geometry can be accepted');
      catalog.ingestModelMetadata(metadata);
      assert.equal(catalog.detail(expected[0]).source_id, expected[0]);
      completed.push(geometry[0][0]);
    }
    assert.deepEqual(completed, [5]);
    assert.equal(requests.length, 2, 'Download one GLB and one JSON');
    assert.deepEqual(posted, [expected]);
    assert.deepEqual(progress, [1, 2, 3, 4, 5]);
    assert(workers[0].terminated);
    assert(signals.every(signal => signal.aborted));
    assert(!controller.signal.aborted);

    catalog.clearMetadata();
    const cancelled = new AbortController();
    const cancelling = loadModels(catalog, bundle, cancelled.signal, () => cancelled.abort());
    await assert.rejects(cancelling.next(), { name: 'AbortError' });
    assert(workers[1].terminated);
    assert(signals.every(signal => signal.aborted));
    assert.equal(catalog.detail(expected[0]), undefined);

    workerFailure = true;
    await assert.rejects(loadModels(catalog, bundle, controller.signal, () => {}).next(), /Preparation failed/);
    assert(workers[2].terminated);
    workerFailure = false; badMetadata = true;
    await assert.rejects(loadModels(catalog, bundle, controller.signal, () => {}).next(), /Missing system metadata/);
    assert(workers[3].terminated);

    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(loadModels(catalog, bundle, controller.signal, () => {}).next(), /HTTP 503/);
    assert(workers[4].terminated);
  } finally {
    catalog?.free();
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
    await server.close();
  }
});

test('model cache reuses unchanged files, replaces changed versions and tolerates storage failure', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const original = { fetch: globalThis.fetch, Worker: globalThis.Worker, indexedDB: globalThis.indexedDB };
  const entries = new Map();
  const openedDatabases = [];
  let version = 'first', modelRequests = 0, storageFails = false;
  try {
    const { loadModels } = await server.ssrLoadModule('/src/viewer/loader.ts');
    const database = {
      createObjectStore() {}, close() {},
      transaction() {
        if (storageFails) throw Error('Storage unavailable');
        const transaction = { objectStore: () => ({
          get(key) {
            const request = {};
            queueMicrotask(() => { request.result = structuredClone(entries.get(key)); request.onsuccess(); });
            return request;
          },
          put(value, key) {
            const stored = structuredClone(value);
            queueMicrotask(() => { entries.set(key, stored); transaction.oncomplete(); });
          },
        }) };
        return transaction;
      },
    };
    globalThis.indexedDB = { open(name, schemaVersion) {
      openedDatabases.push({ name, schemaVersion });
      const request = { result: database };
      const firstOpen = openedDatabases.length === 1;
      queueMicrotask(() => {
        if (firstOpen) request.onupgradeneeded();
        request.onsuccess();
      });
      return request;
    } };
    globalThis.fetch = async url => {
      if (url.endsWith('.json')) return Response.json({ manifest: { models: [{ source_ids: ['test'] }] }, metadata: { test: { structures: [] } } });
      modelRequests++;
      return new Response(new Uint8Array([version === 'first' ? 1 : 2]));
    };
    globalThis.Worker = class {
      postMessage(data) {
        const copied = structuredClone(data, { transfer: [data.bytes.buffer] });
        queueMicrotask(() => this.onmessage({ data: { prepared: [new Float32Array([copied.bytes[0]]), new Uint32Array(), '{}'] } }));
      }
      terminate() {}
    };
    const bundle = { path: 'models/z-anatomy/z-anatomy.glb.br', metadataPath: 'models/z-anatomy/z-anatomy.json', rootIds: ['test'], sha256: version };
    const catalog = { prepareModelMetadata: () => ({ geometry_ids: () => [['test'], ['test']], free() {} }) };
    const load = async () => {
      bundle.sha256 = version;
      const result = [];
      for await (const { geometry } of loadModels(catalog, bundle, new AbortController().signal, () => {})) result.push(geometry[0][0]);
      return result;
    };
    assert.deepEqual(await load(), [1]);
    assert.deepEqual(await load(), [1]);
    assert.equal(modelRequests, 1);
    assert(entries.get(bundle.path).bytes instanceof Blob, 'Large models must use Blob storage to avoid IndexedDB value-size limits');
    version = 'second';
    assert.deepEqual(await load(), [2]);
    assert.equal(modelRequests, 2);
    assert.equal(entries.size, 1);
    storageFails = true;
    assert.deepEqual(await load(), [2]);
    assert.equal(modelRequests, 3);
    assert.deepEqual(openedDatabases, Array.from({ length: 4 }, () => ({ name: 'anatomy-models-v1', schemaVersion: 1 })));
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
    await server.close();
  }
});
