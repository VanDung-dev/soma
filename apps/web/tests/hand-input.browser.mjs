import { getWasm } from '../src/core.ts';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { HandInteractionOverlay } from '../src/anatomy/hand-interaction-overlay.tsx';
import { handLandmarks } from './hand-pose.fixture.mjs';
import { measureHandRegion } from '../src/anatomy/hand-camera/layout.ts';

const fullRegion = new Float32Array([0, 0, 1, 1]);

export async function previewHandFeedback(feedback, aspect = 4 / 3) {
  const host = document.createElement('div');
  host.className = 'hand-camera-scene-overlay';
  const image = document.createElement('div');
  image.className = 'hand-camera-image-area';
  image.style.width = `min(100cqw, ${aspect * 100}cqh)`;
  image.style.height = `min(100cqh, ${100 / aspect}cqw)`;
  host.append(image);
  document.querySelector('.model-canvas').append(host);
  const root = createRoot(image);
  flushSync(() => root.render(createElement(HandInteractionOverlay, { feedback, aspect })));
  await new Promise(requestAnimationFrame);
  return () => { root.unmount(); host.remove(); };
}

export async function previewVirtualHands(mode = 'idle') {
  const { HandGestureController } = await getWasm();
  const gestures = new HandGestureController();
  try {
    const sides = mode === 'rotate' ? ['right'] : mode === 'pan' ? ['left'] : ['left', 'right'];
    const hands = sides.flatMap(side => [side === 'left' ? 0 : 1, 0.99,
      ...handLandmarks({ side, x: side === 'left' ? 0.42 : 0.58, y: 0.6, pinching: mode !== 'idle' }).flat()]);
    const region = measureHandRegion(document.querySelector('.model-canvas'), { videoWidth: 640, videoHeight: 480 },
      document.querySelector('.model-focus-frame'), [...document.querySelectorAll('.hand-camera, .model-hud, .catalog-panel, .information-panel')]);
    const feedback = JSON.parse(gestures.update(new Float32Array(hands), 0, 4 / 3, new Float32Array(region)));
    feedback.region = region;
    return previewHandFeedback(feedback);
  } finally { gestures.free(); }
}

export async function checkHandInput() {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const { HandGestureController } = await getWasm();
  const gestures = new HandGestureController();
  const hand = (side, x, gap = 0.01) => new Float32Array([side, 0.99, ...Array.from({ length: 21 }, (_, index) =>
    [x + (index === 8 ? gap : 0), index === 9 ? 0.6 : 0.4, 0]).flat()]);
  try {
    const first = JSON.parse(gestures.update(hand(1, 0.4), 0, 1, fullRegion));
    assert(first.mode === 'rotate' && first.commands.length === 0, 'First pinch must establish its baseline');
    assert(first.hands.length === 1 && first.hands[0].pinching && Math.abs(first.hands[0].x - 0.595) < 1e-5,
      'Rust must return the mirrored hand cursor');
    assert(first.hands[0].landmarks.length === 21 && Math.abs(first.hands[0].landmarks[0][0] - 0.6) < 1e-5,
      'Rust must return all mirrored virtual-hand joints');
    const moved = JSON.parse(gestures.update(hand(1, 0.43), 33, 1, fullRegion));
    assert(moved.commands.some(command => command.kind === 'rotate' && command.x > 0), 'Rust WASM must return a mirrored rotation');
    const lost = JSON.parse(gestures.update(new Float32Array(), 66, 1, fullRegion));
    assert(lost.mode === 'idle' && lost.commands.length === 0, 'Lost hands must stop motion');
    assert(lost.hands.length === 0, 'Lost hands must clear the visual overlay');
    gestures.reset();
    gestures.update(hand(0, 0.4, 0.13), 0, 1, fullRegion);
    gestures.update(hand(0, 0.4), 33, 1, fullRegion);
    const pan = JSON.parse(gestures.update(hand(0, 0.46), 66, 1, fullRegion));
    assert(pan.mode === 'pan' && pan.commands.length && pan.commands.every(command => command.kind === 'pan'),
      'Only the left hand must pan without rotating or zooming');
    gestures.reset();
    const pair = (left, right, gap = 0.01) => new Float32Array([...hand(0, left, gap), ...hand(1, right, gap)]);
    gestures.update(pair(0.3, 0.7, 0.13), 0, 1, fullRegion);
    gestures.update(pair(0.3, 0.7), 33, 1, fullRegion);
    const zoom = JSON.parse(gestures.update(pair(0.27, 0.73), 66, 1, fullRegion));
    assert(zoom.mode === 'zoom' && zoom.commands.length && zoom.commands.every(command => command.kind === 'zoom' && command.factor < 1), 'Spreading pinched hands must only zoom in');
    assert(zoom.zoom === 'in' && zoom.hands.length === 2, 'Rust must report zoom direction and both hand cursors');
  } finally { gestures.free(); }

  const worker = new Worker(new URL('../src/anatomy/hand-camera/hand-worker.ts', import.meta.url), { type: 'module' });
  let timeout;
  let stage = 'loading';
  try {
    await new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(Error(`Hand inference worker timed out: ${stage}`)), 15000);
      worker.onerror = event => reject(Error(event.message));
      worker.onmessage = ({ data }) => {
        stage = data.type;
        if (data.type === 'error') { reject(Error(`Hand worker failed: ${data.stage}`)); return; }
        if (data.type === 'ready') {
          try {
            const canvas = new OffscreenCanvas(640, 480);
            canvas.getContext('2d').fillRect(0, 0, 640, 480);
            const image = canvas.transferToImageBitmap();
            worker.postMessage({ type: 'frame', image, timestamp: 1000, aspect: 4 / 3, region: [...fullRegion] }, [image]);
          } catch (cause) { reject(cause); }
        } else if (data.type === 'result') {
          try {
            assert(data.mode === 'idle' && data.commands.length === 0 && data.hands.length === 0, 'Blank images must not move the viewer or show cursors');
            resolve();
          } catch (cause) { reject(cause); }
        }
      };
      worker.postMessage({ type: 'init', modelUrl: new URL('/hand-input/hand_landmarker.task', location.href).href });
    });
  } finally { clearTimeout(timeout); worker.terminate(); }
  return { rustGestures: 'passed', mediaPipeWorker: 'passed' };
}

export async function checkHandCameraBridge(side = 'left') {
  const button = document.querySelector('.hand-camera-toggle');
  if (!button || button.disabled || button.getAttribute('aria-checked') === 'true') {
    throw Error('Wait for the viewer and turn the hand camera off before running this probe');
  }
  const { AnatomyViewer, HandGestureController } = await getWasm();
  const gestures = new HandGestureController();
  const originalWorker = window.Worker, originalCamera = navigator.mediaDevices.getUserMedia;
  const originalRotate = AnatomyViewer.prototype.rotate;
  const originalPan = AnatomyViewer.prototype.pan;
  const mode = side === 'left' ? 'pan' : 'rotate';
  const sideOffset = side === 'left' ? 0.135 : -0.135;
  const originalFocus = document.hasFocus;
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
  const context = canvas.getContext('2d');
  let animation = 0, index = 0, timeout;
  const draw = () => {
    context.fillStyle = index++ % 2 ? '#111' : '#222';
    context.fillRect(0, 0, canvas.width, canvas.height);
    animation = requestAnimationFrame(draw);
  };
  draw();
  const stream = canvas.captureStream(30);
  let frame = 0, resolveMotion, cameraRequests = 0;
  let pose, nextResult, pendingTimer, lastRegion, motions = 0, unexpected = 0;
  const setPose = (x, pinching) => {
    pose = { side, x: 1 - x + sideOffset, y: 0.57, pinching };
    return new Promise((resolve, reject) => {
      pendingTimer = setTimeout(() => reject(Error('Camera session probe timed out')), 5000);
      nextResult = update => { clearTimeout(pendingTimer); resolve(update); };
    });
  };
  const savedGraphics = localStorage.getItem('human-atlas-graphics');
  const motion = new Promise((resolve, reject) => {
    resolveMotion = resolve;
    timeout = setTimeout(() => reject(Error('Hand commands did not reach the live viewer')), 10000);
  });
  try {
    document.hasFocus = () => true;
    navigator.mediaDevices.getUserMedia = async () => { cameraRequests++; return stream; };
    window.Worker = class {
      constructor(url, options) {
        if (!String(url).includes('hand-worker')) return new originalWorker(url, options);
      }
      postMessage(data) {
        if (data.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
        else if (data.type === 'reset') gestures.reset();
        else {
          data.image.close();
          const x = 0.5 + sideOffset + Math.min(frame++, 3) * 0.01;
          lastRegion = data.region;
          const hand = new Float32Array([side === 'left' ? 0 : 1, 0.99, ...handLandmarks(pose ?? { side, x, pinching: true }).flat()]);
          const update = JSON.parse(gestures.update(hand, data.timestamp, data.aspect, new Float32Array(data.region)));
          const notify = nextResult; nextResult = undefined;
          queueMicrotask(() => {
            this.onmessage?.({ data: { type: 'result', timestamp: data.timestamp, region: data.region, ...update } });
            if (notify) requestAnimationFrame(() => notify(update));
          });
        }
      }
      terminate() {}
    };
    AnatomyViewer.prototype.rotate = function(...args) {
      const result = originalRotate.apply(this, args);
      if (mode === 'rotate') { motions++; resolveMotion(args); } else unexpected++;
      return result;
    };
    AnatomyViewer.prototype.pan = function(...args) {
      const result = originalPan.apply(this, args);
      if (mode === 'pan') { motions++; resolveMotion(args); } else unexpected++;
      return result;
    };
    button.click();
    const movement = await motion;
    await new Promise(requestAnimationFrame);
    const marker = document.querySelector(`.hand-cursor[data-side="${side}"][data-button="${mode === 'pan' ? 'right' : 'left'}"]`);
    if (!marker || !marker.textContent.includes(side === 'left' ? 'Tay trái' : 'Tay phải')) {
      throw Error('The active hand must display its corresponding camera action');
    }
    const virtual = document.querySelector(`.hand-virtual[data-side="${side}"][data-pinching="true"]`);
    if (virtual?.querySelectorAll('circle').length !== 21 || virtual.querySelectorAll('polyline').length !== 5) {
      throw Error('Rust landmarks must render the complete virtual hand over the live model');
    }
    const video = document.querySelector('.hand-camera-scene');
    if (!video.hidden || video.srcObject !== stream || cameraRequests !== 1) {
      throw Error('Tracking must use a hidden camera without changing the viewer background');
    }
    if (document.querySelector('.hand-camera-status, .hand-camera-guide, .hand-camera-privacy')
      || document.querySelector('.hand-action-menu, .hand-select-options')) {
      throw Error('Hand camera input must stay focused on model interactions');
    }
    if (button.getAttribute('role') !== 'switch' || !button.closest('.app-menu-history')) throw Error('Camera mode switch must sit beside history navigation');
    const image = document.querySelector('.hand-camera-image-area').getBoundingClientRect();
    const area = document.querySelector('.model-canvas').getBoundingClientRect();
    const width = Math.min(area.width, area.height * video.videoWidth / video.videoHeight);
    const height = width * video.videoHeight / video.videoWidth;
    if (Math.abs(image.width - width) > 1 || Math.abs(image.height - height) > 1
      || Math.abs(image.left - area.left - (area.width - width) / 2) > 1
      || Math.abs(image.top - area.top - (area.height - height) / 2) > 1) {
      throw Error('Hand markers must match the letterboxed camera image');
    }
    await setPose(0.5, false);
    const outside = lastRegion[2] + 0.02;
    const steps = Math.ceil((outside - 0.5) / 0.08);
    for (let step = 1; step <= steps; step++) await setPose(0.5 + (outside - 0.5) * step / steps, false);
    const beforeRejected = motions;
    let state = await setPose(outside, true);
    if (state.mode !== 'idle' || state.hands[0].state !== 'release') throw Error('A pinch outside the viewer must not start control');
    if (!document.querySelector('.hand-cursor[data-state="release"] .hand-mouse-mapped')
      || document.querySelector('.hand-mouse-pressed')) throw Error('Rejected pinches must keep the mapped icon without a pressed mouse button');
    for (let step = 1; step <= steps; step++) {
      state = await setPose(outside + (0.5 - outside) * step / steps, true);
      if (state.mode !== 'idle' || motions !== beforeRejected) throw Error('Moving an already closed pinch into the viewer must not activate it');
    }
    state = await setPose(0.5, false);
    if (state.hands[0].state !== 'ready') throw Error('An open hand inside the viewer must be ready');
    state = await setPose(0.5, true);
    if (state.mode !== mode || state.commands.length) throw Error('A fresh pinch inside must capture without an initial jump');
    for (let step = 1; step <= steps; step++) {
      state = await setPose(0.5 + (outside - 0.5) * step / steps, true);
      if (state.mode !== mode || state.hands[0].state !== 'active') throw Error('Captured control must survive leaving the start region');
    }
    state = await setPose(outside, false);
    if (state.mode !== 'idle' || state.commands.length) throw Error('Release must end the captured session');
    await setPose(0.5, false); await setPose(0.5, true);
    const beforeManual = motions;
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 99 }));
    await new Promise(requestAnimationFrame);
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 99 }));
    state = await setPose(0.5, true);
    if (state.mode !== 'idle' || state.hands[0].state !== 'release' || motions !== beforeManual) {
      throw Error('Manual input must end capture and prevent a held pinch from automatically resuming');
    }
    await setPose(0.5, false); await setPose(0.5, true);
    if (!video.hidden || stream.getTracks()[0].readyState !== 'live' || !document.querySelector('.hand-virtual')) {
      throw Error('Hand tracking must remain active without a camera background toggle');
    }
    button.click();
    await new Promise(requestAnimationFrame);
    if (stream.getTracks().some(track => track.readyState !== 'ended')) throw Error('Camera tracks were not released');
    if (document.querySelector('.hand-interaction-overlay')) throw Error('Stopping the camera must remove the overlay');
    if (!video.hidden || localStorage.getItem('human-atlas-graphics') !== savedGraphics) throw Error('Camera shutdown must preserve graphics preferences');
    if (button.getAttribute('aria-checked') !== 'false') throw Error('Camera mode must be off after stopping');
    if (unexpected) throw Error('A single hand must not trigger the other hand\'s camera action');
    return { rustToViewer: 'passed', side, mode, movement, handOverlay: 'passed', startRegionAndCapture: 'passed', cameraCleanup: 'passed' };
  } finally {
    clearTimeout(timeout);
    clearTimeout(pendingTimer);
    if (button.getAttribute('aria-checked') === 'true') {
      button.click(); await new Promise(requestAnimationFrame);
    }
    cancelAnimationFrame(animation); stream.getTracks().forEach(track => track.stop());
    window.Worker = originalWorker; navigator.mediaDevices.getUserMedia = originalCamera;
    document.hasFocus = originalFocus;
    AnatomyViewer.prototype.rotate = originalRotate;
    AnatomyViewer.prototype.pan = originalPan;
    gestures.free();
  }
}
