import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CameraDevicesContext, useCameraDevices } from '../src/anatomy/camera-devices.ts';
import { MenuBar } from '../src/anatomy/menu-bar.tsx';
import { HandCameraControls } from '../src/anatomy/hand-camera-controls.tsx';
import { SettingsPage } from '../src/settings/page.tsx';

export async function checkCameraDevices() {
  const assert = (value, message) => { if (!value) throw Error(message); };
  const frames = async () => { for (let index = 0; index < 4; index++) await new Promise(requestAnimationFrame); };
  const waitFor = async (check, message) => {
    for (let index = 0; index < 120; index++) {
      if (check()) return;
      await new Promise(requestAnimationFrame);
    }
    throw Error(message);
  };
  const originalMedia = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  const originalWorker = window.Worker;
  const originalTheme = document.documentElement.dataset.theme;
  const host = document.createElement('div'), scene = document.createElement('div');
  scene.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:480px;pointer-events:none';
  document.body.append(host, scene);
  const sceneRef = { current: scene };
  const root = createRoot(host);
  const media = new EventTarget();
  const cameras = [{ kind: 'videoinput', deviceId: 'built-in', label: 'MacBook Pro Camera' },
    { kind: 'videoinput', deviceId: 'iphone-camera', label: 'iPhone Camera' }];
  let available = [{ kind: 'videoinput', deviceId: '', label: '' }], granted = false, current, stopped = 0, listeners = 0;
  const requests = [], streams = [], workers = [];
  media.enumerateDevices = async () => available;
  const enumerate = media.enumerateDevices;
  const add = media.addEventListener.bind(media), remove = media.removeEventListener.bind(media);
  media.addEventListener = (...args) => { listeners++; add(...args); };
  media.removeEventListener = (...args) => { listeners--; remove(...args); };
  media.getUserMedia = async constraints => {
    requests.push(constraints);
    if (!granted) { granted = true; available = [...cameras,
      { kind: 'videoinput', deviceId: 'built-in-desk', label: 'MacBook Pro Desk View Camera' },
      { kind: 'videoinput', deviceId: 'iphone-desk', label: 'iPhone desk view Camera' }]; }
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    canvas.getContext('2d').fillRect(0, 0, 640, 480);
    const stream = canvas.captureStream(30);
    for (const track of stream.getTracks()) {
      const stop = track.stop.bind(track);
      track.stop = () => { stopped++; stop(); };
    }
    streams.push(stream);
    return stream;
  };
  const capture = media.getUserMedia;
  function Harness() {
    const devices = useCameraDevices();
    current = devices;
    const [enabled, setEnabled] = useState(false);
    const [active, setActive] = useState(false);
    return createElement('div', null,
      createElement(MenuBar, { ref: { current: null }, disabled: false, canGoBack: false, canGoForward: false,
        onBack() {}, onForward() {}, cameraEnabled: enabled, cameraActive: active || devices.accessActive,
        onCameraChange: setEnabled, cameraAccessPending: devices.requesting }),
      createElement(CameraDevicesContext, { value: devices }, createElement(SettingsPage, { section: 'camera' })),
      createElement(HandCameraControls, { enabled, disabled: false, deviceId: devices.deviceId, onCameraStarted: devices.refresh, onCameraActiveChange: setActive,
        onControl: () => true, sceneHost: sceneRef, interactionFrame: sceneRef, obstacles: [], onEnabledChange: setEnabled }));
  }
  const select = () => host.querySelector('#settings-camera-device');
  const toggle = () => host.querySelector('.hand-camera-toggle');
  const choose = value => { select().value = value; select().dispatchEvent(new Event('change', { bubbles: true })); };
  try {
    Object.defineProperty(navigator, 'mediaDevices', { value: media, configurable: true });
    window.Worker = class {
      constructor() { workers.push(this); }
      postMessage(message) {
        if (message.type === 'init') queueMicrotask(() => { if (!this.closed) this.onmessage?.({ data: { type: 'ready' } }); });
        if (message.type === 'frame') {
          message.image.close();
          queueMicrotask(() => { if (!this.closed) this.onmessage?.({ data: { type: 'result', timestamp: performance.now(),
            mode: 'idle', hands: [], region: [], zoom: 'none', commands: [] } }); });
        }
      }
      terminate() { this.closed = true; }
    };
    root.render(createElement(Harness));
    await waitFor(() => select() && listeners === 1, 'Subscribe to camera changes');
    await frames();
    assert(select().disabled && select().options.length === 1 && requests.length === 0, 'Listing devices must not open a camera');
    assert(toggle().querySelector('.line-md-icon[aria-hidden="true"] svg') && !toggle().textContent.trim() && toggle().getAttribute('aria-label'), 'Use a decorative camera icon with an accessible switch label');
    assert(toggle().dataset.cameraActive === 'false', 'Do not show camera activity before capture');
    assert(host.querySelector('[data-camera-access]'), 'Offer permission access when the browser hides camera names and IDs');
    media.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
    host.querySelector('[data-camera-access]').click();
    await waitFor(() => current.error && !current.requesting, 'Allow retry after camera access is denied');
    assert(workers.length === 0 && streams.length === 0 && toggle().getAttribute('aria-checked') === 'false', 'Permission discovery must not start hand controls');
    assert(toggle().dataset.cameraActive === 'false', 'Denied permission must not show camera activity');
    media.getUserMedia = capture;
    let finishEnumeration;
    media.enumerateDevices = () => new Promise(resolve => { finishEnumeration = () => resolve(available); });
    host.querySelector('[data-camera-access]').click();
    host.querySelector('[data-camera-access]')?.click();
    await waitFor(() => current.accessActive && finishEnumeration, 'Show camera activity while permission discovery holds a stream');
    assert(toggle().dataset.cameraActive === 'true' && toggle().getAttribute('aria-checked') === 'false', 'Temporary camera use must show activity even while hand controls are off');
    assert(toggle().getAttribute('aria-description') === 'Camera đang được sử dụng', 'Expose camera activity to assistive technology');
    const icon = toggle().querySelector('.line-md-icon');
    document.documentElement.dataset.theme = 'light';
    assert(getComputedStyle(icon).color === 'rgb(0, 143, 50)', 'Use green for camera activity in the light theme');
    assert(getComputedStyle(icon).width === '24px' && getComputedStyle(icon.querySelector('svg')).strokeWidth === '2.8px', 'Use a larger, bolder icon while the camera is active');
    document.documentElement.dataset.theme = 'dark';
    assert(getComputedStyle(icon).color === 'rgb(60, 255, 123)', 'Use a brighter green for camera activity in the dark theme');
    if (originalTheme === undefined) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = originalTheme;
    const activeStyle = getComputedStyle(icon);
    assert(activeStyle.animationName === 'none' && activeStyle.opacity === '1' && activeStyle.transform === 'none'
      && activeStyle.filter !== 'none', 'Keep the active camera icon steadily lit without pulsing');
    streams[0].getVideoTracks()[0].dispatchEvent(new Event('ended'));
    await waitFor(() => toggle().dataset.cameraActive === 'false', 'Clear temporary camera activity when its track ends');
    media.enumerateDevices = enumerate; finishEnumeration();
    await waitFor(() => select().options.length === 3 && stopped === 1 && !current.requesting, 'Permission access must reveal both cameras and stop the temporary stream');
    assert(requests.length === 1 && requests[0].audio === false && requests[0].video === true, 'Request video permission only once');
    assert(workers.length === 0 && toggle().getAttribute('aria-checked') === 'false', 'Listing permitted cameras must keep hand controls off');
    assert(toggle().dataset.cameraActive === 'false', 'Stop the activity indicator after releasing the temporary stream');
    assert([...select().options].some(option => option.textContent === 'iPhone Camera'), 'Include Continuity Camera as a selectable input');
    assert(current.devices.length === 2 && ![...select().options].some(option => /desk\s*view/i.test(option.textContent)), 'Exclude Desk View cameras while keeping regular MacBook and iPhone cameras');
    let grantTracking;
    media.getUserMedia = options => new Promise(resolve => { grantTracking = () => capture(options).then(resolve); });
    toggle().click();
    await waitFor(() => grantTracking, 'Wait for camera permission');
    assert(toggle().getAttribute('aria-checked') === 'true' && toggle().dataset.cameraActive === 'false', 'A pending permission prompt must not claim the camera is active');
    await grantTracking(); media.getUserMedia = capture;
    await waitFor(() => workers.length === 1, 'Start tracking only after camera mode is turned on');
    assert(toggle().dataset.cameraActive === 'true', 'Show camera activity after acquiring the tracking stream');
    assert(requests[1].audio === false && requests[1].video.facingMode === 'user', 'Default capture must remain video-only');
    assert(select().labels[0].textContent === 'Camera điều khiển tay', 'Keep a labeled camera selector inside Settings');
    const initialDevices = current.devices;
    media.dispatchEvent(new Event('devicechange')); await frames();
    assert(current.devices === initialDevices, 'An unchanged device list must preserve its identity');
    choose('iphone-camera');
    await waitFor(() => requests.length === 3 && workers.length === 2, 'Switch to the selected camera');
    assert(requests[2].video.deviceId.exact === 'iphone-camera' && !requests[2].video.facingMode, 'Request the selected camera exactly');
    assert(stopped === 2 && workers[0].closed, 'Switching must stop the old track and worker');
    available = cameras.slice(0, 1); media.dispatchEvent(new Event('devicechange'));
    await waitFor(() => select().value === '' && requests.length === 4 && workers.length === 3, 'Fall back when the selected camera disappears');
    assert(stopped === 3 && !requests[3].video.deviceId, 'Stop the removed camera and use the default');
    toggle().click();
    await waitFor(() => stopped === 4, 'Turning off must stop the current camera');
    assert(toggle().dataset.cameraActive === 'false', 'Turning off must clear the camera activity indicator');
    assert(workers.every(worker => worker.closed), 'All camera workers must terminate');
    media.enumerateDevices = async () => { throw Error('enumeration denied'); };
    media.dispatchEvent(new Event('devicechange')); await frames();
    assert(select().disabled && current.error, 'Disable camera selection when enumeration fails');
    media.enumerateDevices = enumerate; media.dispatchEvent(new Event('devicechange')); await frames();
    assert(!select().disabled && !current.error, 'Recover when enumeration is available again');
    const pending = [];
    media.enumerateDevices = () => new Promise(resolve => pending.push(resolve));
    const first = current.refresh(), second = current.refresh();
    pending[1]([cameras[1]]); await second;
    pending[0]([cameras[0]]); await first; await frames();
    assert(current.devices.length === 1 && current.devices[0].deviceId === 'iphone-camera', 'Ignore out-of-order enumeration results');
    media.enumerateDevices = enumerate; available = [];
    media.dispatchEvent(new Event('devicechange')); await frames();
    assert(select().disabled && !current.error && select().options.length === 1, 'Handle devices being unavailable');
    media.enumerateDevices = undefined; media.dispatchEvent(new Event('devicechange')); await frames();
    assert(current.error && select().disabled, 'Handle unavailable enumeration APIs');
    media.enumerateDevices = enumerate; available = cameras; media.dispatchEvent(new Event('devicechange')); await frames();
    media.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
    toggle().click();
    await waitFor(() => toggle().getAttribute('aria-checked') === 'false' && host.querySelector('[role="alert"]'), 'Permission errors must turn camera mode off');
    assert(stopped === 4, 'Permission failure must not leave a capture running');
    const notice = host.querySelector('.hand-camera-error');
    const noticeArea = notice.getBoundingClientRect();
    assert(Math.abs(noticeArea.left + noticeArea.width / 2 - innerWidth / 2) < 1
      && Math.abs(noticeArea.top + noticeArea.height / 2 - innerHeight / 2) < 1, 'Center the camera notification in the viewport');
    const retryArea = notice.querySelector('.hand-camera-error-retry').getBoundingClientRect();
    assert(retryArea.top > notice.querySelector('p').getBoundingClientRect().bottom, 'Place the retry button below the notification message');
    assert(document.elementFromPoint(retryArea.left + retryArea.width / 2, retryArea.top + retryArea.height / 2) === notice.querySelector('.hand-camera-error-retry'), 'The retry button must receive pointer input');
    assert(notice.querySelector('h2').textContent === 'Điều khiển bằng camera đã dừng'
      && notice.closest('dialog').getAttribute('aria-labelledby') === notice.querySelector('h2').id, 'Give the notification an accessible title');
    assert(getComputedStyle(notice.closest('dialog')).backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(notice).pointerEvents === 'auto', 'Display the error on an interactive notification surface');
    notice.querySelector('.alert-card-actions button').click(); await frames();
    assert(!host.querySelector('.hand-camera-error') && toggle().getAttribute('aria-checked') === 'false', 'Dismissing an error must keep the camera off');
    toggle().click();
    await waitFor(() => host.querySelector('.hand-camera-error') && toggle().getAttribute('aria-checked') === 'false', 'A new failure must show the notification again');
    let retryAttempts = 0;
    media.getUserMedia = async () => { retryAttempts++; throw new DOMException('Denied', 'NotAllowedError'); };
    host.querySelector('.hand-camera-error-retry').click();
    await waitFor(() => retryAttempts === 1 && toggle().getAttribute('aria-checked') === 'false' && host.querySelector('.hand-camera-error'), 'A failed retry must retain a usable notification');
    media.getUserMedia = capture;
    host.querySelector('.hand-camera-error-retry').click();
    await waitFor(() => workers.length === 4 && toggle().dataset.cameraActive === 'true', 'Retry must restart camera capture');
    assert(!host.querySelector('.hand-camera-error'), 'A successful retry must clear the notification');
    toggle().click();
    await waitFor(() => stopped === 5 && toggle().dataset.cameraActive === 'false', 'Stop the retried camera and clear its activity indicator');
    available = []; media.dispatchEvent(new Event('devicechange')); await frames();
    let resolvePermission;
    media.getUserMedia = options => new Promise(resolve => { resolvePermission = () => capture(options).then(resolve); });
    host.querySelector('[data-camera-access]').click();
    await waitFor(() => current.requesting, 'Expose a pending permission request');
    root.unmount();
    await resolvePermission(); await frames();
    assert(stopped === 6 && workers.length === 4, 'Stop a permission stream granted after unmount without starting a worker');
    assert(listeners === 0, 'Unmounting must remove the device-change listener');
    return { permissionRequest: true, continuityListed: true, deskViewExcluded: true, activityIndicator: true, errorNotification: true, retry: true, permissionRefresh: true, cameraSwitch: true, defaultFallback: true, videoOnly: true, stableDevices: true,
      enumerationFailure: true, staleResults: true, unsupported: true, denied: true, stoppedTracks: stopped, disposedWorkers: workers.length, cleanup: true };
  } finally {
    root.unmount(); host.remove(); scene.remove();
    for (const stream of streams) for (const track of stream.getTracks()) if (track.readyState !== 'ended') track.stop();
    if (originalMedia) Object.defineProperty(navigator, 'mediaDevices', originalMedia); else delete navigator.mediaDevices;
    window.Worker = originalWorker;
    if (originalTheme === undefined) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = originalTheme;
  }
}
