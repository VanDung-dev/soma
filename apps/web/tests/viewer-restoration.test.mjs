import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('runtime delegates restoration to WASM and synchronizes completion, reduced motion and cancellation', async t => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const original = Object.fromEntries(['window', 'document', 'performance', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame']
    .map(key => [key, globalThis[key]]));
  let runtime;
  try {
    const { ViewerRuntime } = await server.ssrLoadModule('/src/anatomy/viewer/runtime.ts');
    let now = 100, nextFrame = 0, active = false, selected = 'a';
    let ids = ['a', 'b'], separated = ['a', 'b', 'c'];
    const pending = new Map(), calls = [], patches = [];
    const motion = Object.assign(new EventTarget(), { matches: false });
    const canvas = Object.assign(new EventTarget(), { dataset: {}, setAttribute() {}, remove() {} });
    globalThis.window = Object.assign(new EventTarget(), { matchMedia: () => motion, clearInterval() {} });
    globalThis.document = { createElement: () => canvas };
    globalThis.performance = { now: () => now };
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.requestAnimationFrame = callback => { pending.set(++nextFrame, callback); return nextFrame; };
    globalThis.cancelAnimationFrame = id => pending.delete(id);
    runtime = new ViewerRuntime({ appendChild() {} }, { viewport: () => [0, 0, 1, 1], onState: patch => patches.push(patch), onPick() {}, onHide() { return true; } });
    const viewer = runtime.viewer = {
      selected_id: () => selected, select: id => { selected = id; }, separated_ids: () => separated,
      clear_selection() {}, selection_ids: () => [],
      begin_restoration: (...args) => {
        calls.push(['begin', ...args]); active = args[2];
        if (!active) separated = separated.filter(id => !ids.includes(id));
        return ids;
      },
      restoration_active: () => active,
      advance_restoration: time => { calls.push(['advance', time]); return active; },
      finish_restoration: () => { calls.push(['finish']); active = false; separated = []; },
      advance_camera: () => false, advance_reconstruction: () => false, render() {}, free() {},
      finish_reconstruction() {}, finish_explosion() {}, finish_camera_transition() {},
      clear_center() {}, change_visibility: (...args) => calls.push(['visibility', ...args]), inspect: (...args) => calls.push(['inspect', ...args]),
      restore_structure: () => { calls.push(['restore']); active = false; separated = []; },
    };
    runtime.loading = false;
    runtime.structureIds = ['a', 'b', 'c'];
    runtime.setMoving('a');
    const tick = time => {
      now = time;
      const frames = [...pending.values()]; pending.clear();
      for (const frame of frames) frame(time);
    };
    assert(runtime.restoreStructure('b'));
    assert.deepEqual(calls.at(-1), ['begin', 'b', 100, true]);
    tick(200);
    assert.deepEqual(calls.at(-1), ['advance', 200]);
    assert.equal(runtime.movingId, 'a', 'Keep the active group locked until Rust finishes');
    active = false; separated = ['c']; tick(600);
    assert.equal(runtime.movingId, '');
    assert.deepEqual([...patches.at(-1).separatedIds], ['c']);
    assert(!calls.some(([method]) => method === 'restore'), 'Frames must not send per-structure offsets back to WASM');
    ids = ['c']; runtime.setMoving('c'); motion.matches = true;
    assert(runtime.restoreStructure('c'));
    assert.deepEqual(calls.at(-1), ['begin', 'c', 600, false]);
    assert.equal(runtime.restoration, undefined, 'Reduced motion completes immediately');
    assert.equal(runtime.movingId, '');
    ids = ['a']; separated = ['a']; motion.matches = false;
    runtime.setMoving('a'); runtime.restoreStructure('a');
    motion.matches = true; motion.dispatchEvent(new Event('change'));
    assert.deepEqual(calls.at(-1), ['finish']);
    assert.equal(runtime.restoration, undefined, 'Changing reduced motion finishes the pending Rust animation');
    assert.equal(runtime.movingId, '');
    motion.matches = false; separated = ['a'];
    runtime.restoreStructure('a');
    assert(runtime.overview());
    assert.deepEqual(calls.slice(-2), [['visibility', ['a', 'b', 'c'], true, 600], ['inspect', 'reset', 600]]);
    const advanced = calls.filter(([method]) => method === 'advance').length;
    tick(1000);
    assert.equal(runtime.restoration, undefined);
    assert.equal(calls.filter(([method]) => method === 'advance').length, advanced, 'Overview must not replay cancelled offsets');
    motion.matches = true;
    assert(runtime.overview());
    assert.deepEqual(calls.slice(-2), [['visibility', ['a', 'b', 'c'], true, undefined], ['inspect', 'reset', undefined]]);
    t.mock.method(console, 'error', () => {});
    viewer.begin_restoration = () => { throw Error('Rejected restoration'); };
    assert.equal(runtime.restoreStructure('missing'), false);
    assert.equal(patches.at(-1).status, 'processError');
  } finally {
    runtime?.dispose();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
    await server.close();
  }
});
