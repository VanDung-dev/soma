import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('model loading streams in order, bounds prefetch and cleans up cancellation and worker failure', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const original = { fetch: globalThis.fetch, Worker: globalThis.Worker };
  const requests = [], signals = [], workers = [], posted = [];
  const roots = Array.from({ length: 5 }, (_, id) => ({
    id: String(id), model: { path: `models/${id}.glb${id % 2 ? '.br' : ''}`, structure_ids: [String(id)] },
  }));
  let workerFailure = false;
  try {
    const { loadModels: load } = await server.ssrLoadModule('/src/anatomy/viewer/loader.ts');
    const loadModels = (roots, signal, progress) => load(roots, signal, progress, (_root, json) => JSON.parse(json).structures.map(part => part.source_id));
    globalThis.fetch = async (url, { signal }) => {
      requests.push(url); signals.push(signal);
      const id = url.match(/\/(\d+)\.(glb(?:\.br)?|json)$/)[1];
      return { ok: true,
        text: async () => JSON.stringify({ structures: [{ source_id: id, source_name: id, source_object: id, latin: '', laterality: '', collections: [] }] }),
        arrayBuffer: async () => new Uint8Array([Number(id)]).buffer,
      };
    };
    globalThis.Worker = class {
      constructor() { this.terminated = false; workers.push(this); }
      postMessage(data, transfers) {
        posted.push(data.packages[0][0]);
        assert.equal(transfers[0], data.packages[0].buffer);
        queueMicrotask(() => {
          if (workerFailure) this.onerror({ message: 'Preparation failed' });
          else this.onmessage({ data: { prepared: [new Float32Array([data.packages[0][0]]), new Uint32Array([0]), '{}'] } });
        });
      }
      terminate() { this.terminated = true; }
    };
    const controller = new AbortController(), progress = [];
    const stream = loadModels(roots, controller.signal, count => progress.push(count));
    const first = await stream.next();
    assert.equal(first.value[0][0], 0);
    assert.equal(requests.filter(url => /\.glb(?:\.br)?$/.test(url)).length, 2, 'Prefetch only two systems');
    assert.deepEqual(posted, [0], 'Yield the first package before preparing the next');
    const second = await stream.next();
    assert.equal(second.value[0][0], 1);
    assert.equal(requests.filter(url => /\.glb(?:\.br)?$/.test(url)).length, 3);
    assert.deepEqual(progress, [1, 2]);
    await stream.return();
    assert(workers[0].terminated);
    assert(signals.every(signal => signal.aborted), 'Closing the stream cancels prefetched downloads');
    assert(!controller.signal.aborted, 'Stream cleanup must not abort its caller');

    const completed = [], completedProgress = [];
    for await (const prepared of loadModels(roots, controller.signal, count => completedProgress.push(count))) {
      completed.push(prepared[0][0]);
    }
    assert.deepEqual(completed, [0, 1, 2, 3, 4]);
    assert.deepEqual(completedProgress, [1, 2, 3, 4, 5]);
    assert(workers[1].terminated);

    const cancelled = new AbortController();
    const cancelling = loadModels(roots, cancelled.signal, () => cancelled.abort());
    await assert.rejects(cancelling.next(), { name: 'AbortError' });
    assert(workers[2].terminated);
    assert(signals.every(signal => signal.aborted));

    workerFailure = true;
    const failing = loadModels(roots, controller.signal, () => {});
    await assert.rejects(failing.next(), /Preparation failed/);
    assert(workers[3].terminated);
    assert(signals.every(signal => signal.aborted));
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
    await server.close();
  }
});
