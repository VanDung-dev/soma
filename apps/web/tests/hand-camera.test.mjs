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
    let now = 0, next = 0, captures = 0, stopped = 0, terminated = 0, allowed = true, cameraAllowed = true, popover = null, focused = true;
    let suspensionChecks = 0, started = 0;
    const constraints = [];
    const frames = new Map(), timers = new Map(), results = [], errors = [], messages = [], activity = [];
    const track = new EventTarget(); track.stop = () => stopped++;
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    const video = { play: async () => {}, pause() {}, srcObject: null, readyState: 2, currentTime: 0, videoWidth: 640, videoHeight: 480 };
    const win = new EventTarget();
    Object.assign(win, { location: { href: 'http://localhost:5173/anatomy' },
      setTimeout: callback => { timers.set(++next, callback); return next; }, clearTimeout: id => timers.delete(id) });
    install('window', win);
    install('document', { hidden: false, hasFocus: () => focused, querySelector: () => { suspensionChecks++; return popover; } });
    install('navigator', { mediaDevices: { getUserMedia: async options => {
      assert.equal(options.audio, false); constraints.push(options); return stream;
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
    const start = deviceId => startHandCamera(video, {
      deviceId, onStarted: () => started++, onActiveChange: active => activity.push(active),
      allowed: () => allowed, cameraAllowed: () => cameraAllowed,
      region: () => [0.2, 0.1, 0.8, 0.9], onResult: feedback => results.push(feedback), onError: error => errors.push(error),
    });
    const rotating = () => ({ type: 'result', timestamp: now, mode: 'rotate', zoom: 'none',
      region: [0.2, 0.1, 0.8, 0.9], hands: [{ side: 'left', x: 0.6, y: 0.4, pinching: true, state: 'active', landmarks: handLandmarks({ pinching: true }) }], commands: [{ kind: 'rotate', x: 0.1, y: 0 }] });
    dispose = start();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started, 1);
    assert.deepEqual(activity, [true], 'Announce actual camera capture');
    assert.equal(constraints[0].video.facingMode, 'user');
    assert.equal(constraints[0].video.deviceId, undefined);
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
    assert.deepEqual(results.at(-1).hands, rotating().hands, 'Manual input must preserve fresh virtual hands');
    now += 1000; await tick();
    assert.equal(captures, 2, 'Continue tracking during manual input without queueing frames');
    worker.onmessage({ data: rotating() });
    assert.equal(results.at(-1).mode, 'paused');
    assert.deepEqual(results.at(-1).commands, []);
    await tick();
    assert.equal(captures, 3);
    assert.equal(messages.findLast(message => message.type === 'frame').suspended, true);
    worker.onmessage({ data: rotating() });
    emit('pointerup', { pointerId: 1 }); now += 500; await tick();
    assert.equal(captures, 4);
    assert.equal(messages.findLast(message => message.type === 'frame').suspended, false);
    const checksBeforeResult = suspensionChecks;
    worker.onmessage({ data: { ...rotating(), suspended: false } });
    assert.equal(suspensionChecks - checksBeforeResult, 1, 'Check open panels only once per fresh result');
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
    assert.equal(captures, 6, 'Unavailable viewers retain visual tracking');
    assert.equal(messages.findLast(message => message.type === 'frame').suspended, true);
    worker.onmessage({ data: rotating() });
    assert.equal(results.at(-1).mode, 'paused');
    assert.deepEqual(results.at(-1).hands, rotating().hands);
    assert.deepEqual(results.at(-1).commands, []);
    allowed = true; popover = {}; await tick();
    assert.equal(captures, 7, 'Unowned popovers suspend actions while retaining virtual hands');
    worker.onmessage({ data: rotating() });
    assert.equal(results.at(-1).mode, 'paused');
    assert.deepEqual(results.at(-1).hands, rotating().hands);
    cameraAllowed = false; popover = null; await tick();
    assert.equal(captures, 8, 'Separated anatomy must retain visual tracking');
    const separatedFrame = messages.findLast(message => message.type === 'frame');
    assert.equal(separatedFrame.cameraAllowed, false);
    assert.equal(separatedFrame.suspended, false);
    worker.onmessage({ data: { ...rotating(), cameraAllowed: false } });
    assert.equal(results.at(-1).mode, 'idle');
    assert.deepEqual(results.at(-1).commands, [], 'Separated anatomy must not receive camera commands');
    assert.deepEqual(results.at(-1).hands, rotating().hands, 'A camera disable must preserve fresh hand tracking');
    document.hidden = true; await tick();
    assert.equal(captures, 8);
    assert.deepEqual(results.at(-1).hands, [], 'Hidden pages must clear visual tracking');
    document.hidden = false; focused = false; await tick();
    assert.equal(captures, 8, 'Unfocused pages must pause inference');
    focused = true; await tick();
    assert.equal(captures, 9);
    assert.deepEqual(activity, [true], 'Paused inference must keep the camera activity indicator on');
    dispose(); dispose(); dispose = undefined;
    assert.deepEqual(activity, [true, false], 'Clear camera activity exactly once after stopping capture');
    assert.equal(stopped, 1); assert.equal(terminated, 1);
    assert.equal(frames.size, 0); assert.equal(timers.size, 0); assert.equal(video.srcObject, null);
    assert.deepEqual(errors, []);

    let resolvePermission;
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { resolvePermission = resolve; });
    dispose = start(); dispose(); dispose = undefined;
    resolvePermission(stream);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stopped, 2, 'A camera granted after cancellation must be stopped immediately');
    assert.equal(started, 1, 'Cancelled capture must not announce a camera start');
    assert.equal(video.srcObject, null);

    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
    dispose = start();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(errors.at(-1), 'camera');
    assert.deepEqual(activity, [true, false], 'Denied or cancelled permission must not announce capture');
    dispose = undefined;

    navigator.mediaDevices.getUserMedia = async () => stream;
    dispose = start();
    await new Promise(resolve => setImmediate(resolve));
    worker.onerror(); dispose(); dispose = undefined;
    assert.equal(errors.at(-1), 'model');
    assert.equal(stopped, 3); assert.equal(terminated, 2);
    assert.deepEqual(activity.slice(-2), [true, false], 'Worker failure must clear camera activity');
    assert.equal(video.srcObject, null); assert.equal(timers.size, 0);

    navigator.mediaDevices.getUserMedia = async options => { constraints.push(options); return stream; };
    dispose = start('usb-camera');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(constraints.at(-1).video.deviceId, { exact: 'usb-camera' });
    assert.equal(constraints.at(-1).video.facingMode, undefined, 'Do not conflict with the selected camera');
    assert.equal(started, 3);
    dispose(); dispose = undefined;
    assert.equal(stopped, 4);
    assert.equal(video.srcObject, null);

    let resolvePlayback;
    video.play = () => new Promise(resolve => { resolvePlayback = resolve; });
    dispose = start();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(activity.at(-1), true, 'Capture must be indicated before playback or tracking is ready');
    track.dispatchEvent(new Event('ended'));
    assert.equal(activity.at(-1), false, 'A disconnected camera must clear its activity indicator');
    resolvePlayback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stopped, 5);
    assert.equal(video.srcObject, null);
    dispose = undefined;
  } finally {
    dispose?.();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
    await server.close();
  }
});
