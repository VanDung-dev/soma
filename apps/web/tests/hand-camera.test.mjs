import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { handLandmarks } from './hand-pose.fixture.mjs';

test('camera input keeps one frame in flight, yields to manual input, and releases resources', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const names = ['window', 'document', 'navigator', 'Worker', 'createImageBitmap', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const install = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  let dispose;
  try {
    const { startHandCamera } = await server.ssrLoadModule('/src/anatomy/viewer/hand-camera.ts');
    let now = 0, next = 0, captures = 0, stopped = 0, terminated = 0, allowed = true;
    const frames = new Map(), timers = new Map(), results = [], errors = [], messages = [];
    const track = new EventTarget(); track.stop = () => stopped++;
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    const video = { play: async () => {}, pause() {}, srcObject: null, readyState: 2, currentTime: 0, videoWidth: 640, videoHeight: 480 };
    const win = new EventTarget();
    Object.assign(win, { location: { href: 'http://localhost:5173/anatomy' },
      setTimeout: callback => { timers.set(++next, callback); return next; }, clearTimeout: id => timers.delete(id) });
    install('window', win);
    install('document', { hidden: false, hasFocus: () => true, querySelector: () => null });
    install('navigator', { mediaDevices: { getUserMedia: async options => {
      assert.equal(options.audio, false); return stream;
    } } });
    let worker;
    install('Worker', class {
      constructor() { worker = this; }
      postMessage(message) { messages.push(message); }
      terminate() { terminated++; }
    });
    install('createImageBitmap', async () => { captures++; return { close() {} }; });
    install('requestAnimationFrame', callback => { frames.set(++next, callback); return next; });
    install('cancelAnimationFrame', id => frames.delete(id));
    install('performance', { now: () => now });
    const tick = async () => {
      now += 40; video.currentTime += 0.04;
      const callbacks = [...frames.values()]; frames.clear();
      await Promise.all(callbacks.map(callback => callback(now)));
    };
    const emit = (name, props) => { const event = new Event(name); Object.assign(event, props); win.dispatchEvent(event); };
    const start = () => startHandCamera(video, {
      allowed: () => allowed, region: () => [0.2, 0.1, 0.8, 0.9], onResult: feedback => results.push(feedback), onError: error => errors.push(error),
    });
    const rotating = () => ({ type: 'result', timestamp: now, mode: 'rotate', zoom: 'none',
      region: [0.2, 0.1, 0.8, 0.9], hands: [{ side: 'left', x: 0.6, y: 0.4, pinching: true, state: 'active', landmarks: handLandmarks({ pinching: true }) }], commands: [{ kind: 'rotate', x: 0.1, y: 0 }] });
    dispose = start();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages[0].type, 'init');
    worker.onmessage({ data: { type: 'ready' } });
    await tick(); await tick();
    assert.equal(captures, 1, 'Do not queue camera frames behind inference');
    assert.deepEqual(messages.find(message => message.type === 'frame').region, [0.2, 0.1, 0.8, 0.9]);
    emit('pointerdown', { pointerId: 1 });
    worker.onmessage({ data: rotating() });
    assert.equal(results.filter(result => result.commands.length).length, 0, 'Drop results that arrive during manual input');
    await tick();
    assert.ok(messages.some(message => message.type === 'reset'));
    assert.equal(results.at(-1).mode, 'paused');
    assert.deepEqual(results.at(-1).hands, [], 'Manual input must remove the hand cursors');
    now += 1000; await tick();
    assert.equal(captures, 1, 'A held pointer continues blocking after the cooldown');
    emit('pointerup', { pointerId: 1 }); now += 500; await tick();
    assert.equal(captures, 2);
    worker.onmessage({ data: rotating() });
    assert.equal(results.filter(result => result.commands.length).length, 1);
    assert.deepEqual(results.at(-1).hands, rotating().hands, 'Forward the Rust cursor positions unchanged');
    const [feedbackTimeout, expireFeedback] = [...timers.entries()].at(-1);
    timers.delete(feedbackTimeout); expireFeedback();
    assert.deepEqual(results.at(-1).hands, [], 'Expired landmarks must not leave frozen hand cursors');
    await tick();
    const capturedAt = now; now += 250;
    worker.onmessage({ data: { ...rotating(), timestamp: capturedAt } });
    assert.equal(results.filter(result => result.commands.length).length, 1, 'Late inference must not apply stale motion');
    assert.deepEqual(results.at(-1).hands, [], 'Late inference must not restore stale cursors');
    allowed = false; await tick();
    assert.equal(captures, 3, 'Unavailable viewers must not receive camera input');
    dispose(); dispose(); dispose = undefined;
    assert.equal(stopped, 1); assert.equal(terminated, 1);
    assert.equal(frames.size, 0); assert.equal(timers.size, 0); assert.equal(video.srcObject, null);
    assert.deepEqual(errors, []);

    let resolvePermission;
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { resolvePermission = resolve; });
    dispose = start(); dispose(); dispose = undefined;
    resolvePermission(stream);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stopped, 2, 'A camera granted after cancellation must be stopped immediately');
    assert.equal(video.srcObject, null);

    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
    dispose = start();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(errors.at(-1), 'camera');
    dispose = undefined;

    navigator.mediaDevices.getUserMedia = async () => stream;
    dispose = start();
    await new Promise(resolve => setImmediate(resolve));
    worker.onerror(); dispose(); dispose = undefined;
    assert.equal(errors.at(-1), 'model');
    assert.equal(stopped, 3); assert.equal(terminated, 2);
    assert.equal(video.srcObject, null); assert.equal(timers.size, 0);
  } finally {
    dispose?.();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
    await server.close();
  }
});
