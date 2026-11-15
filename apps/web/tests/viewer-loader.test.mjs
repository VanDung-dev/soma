import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('one GLB and one JSON supply ordered metadata and clean up cancellation and worker failure', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const original = { fetch: globalThis.fetch, Worker: globalThis.Worker };
  const requests = [], signals = [], workers = [], posted = [];
  const roots = Array.from({ length: 5 }, (_, id) => ({
    id: String(id), model: { path: 'models/z-anatomy/z-anatomy.glb.br' },
  }));
  let workerFailure = false, badMetadata = false;
  try {
    const { loadModels } = await server.ssrLoadModule('/src/anatomy/viewer/loader.ts');
    globalThis.fetch = async (url, { signal }) => {
      requests.push(url); signals.push(signal);
      if (url.endsWith('.json')) return Response.json({
        manifest: { models: roots.map(root => ({ source_ids: [root.id] })) },
        metadata: badMetadata ? {} : Object.fromEntries(roots.map(root => [root.id, { structures: [{ source_id: root.id }] }])),
      });
      return new Response(new Uint8Array([5]));
    };
    globalThis.Worker = class {
      constructor() { this.terminated = false; workers.push(this); }
      postMessage(data, transfers) {
        posted.push(data.selected);
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
    const controller = new AbortController(), progress = [], ingested = [], completed = [];
    for await (const prepared of loadModels(roots, controller.signal, count => progress.push(count), (root, json) => {
      const ids = JSON.parse(json).structures.map(part => part.source_id);
      assert.deepEqual(ids, [root.id]); ingested.push(root.id); return ids;
    })) completed.push(prepared[0][0]);
    assert.deepEqual(completed, [5]);
    assert.equal(requests.length, 2, 'Download one GLB and one JSON');
    assert.deepEqual(posted, [roots.map(root => root.id)]);
    assert.deepEqual(ingested, roots.map(root => root.id));
    assert.deepEqual(progress, [1, 2, 3, 4, 5]);
    assert(workers[0].terminated);
    assert(signals.every(signal => signal.aborted));
    assert(!controller.signal.aborted);

    const cancelled = new AbortController();
    const cancelling = loadModels(roots, cancelled.signal, () => cancelled.abort(), () => []);
    await assert.rejects(cancelling.next(), { name: 'AbortError' });
    assert(workers[1].terminated);
    assert(signals.every(signal => signal.aborted));

    workerFailure = true;
    await assert.rejects(loadModels(roots, controller.signal, () => {}, () => []).next(), /Preparation failed/);
    assert(workers[2].terminated);
    workerFailure = false; badMetadata = true;
    await assert.rejects(loadModels(roots, controller.signal, () => {}, () => []).next(), /Missing system metadata/);
    assert(workers[3].terminated);

    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(loadModels(roots, controller.signal, () => {}, () => []).next(), /HTTP 503/);
    assert(workers[4].terminated);
  } finally {
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
  let version = 'first', modelRequests = 0, storageFails = false;
  try {
    const { loadModels } = await server.ssrLoadModule('/src/anatomy/viewer/loader.ts');
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
    globalThis.indexedDB = { deleteDatabase() {}, open() {
      const request = { result: database };
      queueMicrotask(() => { request.onupgradeneeded(); request.onsuccess(); });
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
    const roots = [{ id: 'test', model: { path: 'models/z-anatomy/z-anatomy.glb.br', sha256: version } }];
    const load = async () => {
      roots[0].model.sha256 = version;
      const result = [];
      for await (const prepared of loadModels(roots, new AbortController().signal, () => {}, () => [])) result.push(prepared[0][0]);
      return result;
    };
    assert.deepEqual(await load(), [1]);
    assert.deepEqual(await load(), [1]);
    assert.equal(modelRequests, 1);
    assert(entries.get(roots[0].model.path).bytes instanceof Blob, 'Large models must use Blob storage to avoid IndexedDB value-size limits');
    version = 'second';
    assert.deepEqual(await load(), [2]);
    assert.equal(modelRequests, 2);
    assert.equal(entries.size, 1);
    storageFails = true;
    assert.deepEqual(await load(), [2]);
    assert.equal(modelRequests, 3);
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
    await server.close();
  }
});
