import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { createServer } from 'vite';
import { handLandmarks } from './hand-pose.fixture.mjs';

test('hand feedback identifies each hand, held mouse buttons and zoom direction', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { HandCameraControls } = await server.ssrLoadModule('/src/anatomy/hand-camera-controls.tsx');
    const controls = renderToStaticMarkup(createElement(HandCameraControls, {
      enabled: false, onEnabledChange() {}, disabled: false, onControl: () => true, sceneHost: { current: null }, interactionFrame: { current: null }, obstacles: [],
    }));
    assert(!controls.includes('hand-action-menu'));
    assert(!controls.includes('hand-camera-scene-toggle'));
    const { MenuBar } = await server.ssrLoadModule('/src/anatomy/menu-bar.tsx');
    const { readGraphicsSettings } = await server.ssrLoadModule('/src/anatomy/viewer/graphics.ts');
    for (const cameraEnabled of [false, true]) {
      const menu = renderToStaticMarkup(createElement(MenuBar, {
        ref: { current: null }, disabled: false, canGoBack: false, canGoForward: false, onBack() {}, onForward() {},
        helpId: 'help', settingsId: 'settings', graphics: readGraphicsSettings(), onGraphicsChange() {}, cameraEnabled, cameraActive: false, onCameraChange() {},
        cameraDevices: [{ deviceId: 'usb-camera', label: 'USB Camera' }], cameraDeviceId: 'usb-camera', cameraDevicesError: false, onCameraDeviceChange() {},
        cameraAccessPending: false, onCameraAccessRequest() {},
      }));
      assert(menu.includes(`role="switch" aria-checked="${cameraEnabled}" aria-label="Chế độ camera"`));
      assert(menu.includes('class="popover-content settings-content"'));
      assert(!menu.includes('settings-camera-status') && !menu.includes('aria-describedby="settings-camera-status"'));
      assert(menu.includes('for="settings-camera"') && menu.includes('<option value="usb-camera" selected="">USB Camera</option>'));
    }
    const { HandInteractionOverlay } = await server.ssrLoadModule('/src/anatomy/hand-interaction-overlay.tsx');
    const hands = ['left', 'right'].map(side => ({ side, x: side === 'left' ? 0.25 : 0.75, y: 0.5,
      pinching: true, state: 'active', landmarks: handLandmarks({ side, pinching: true }) }));
    const render = (mode, tracked, zoom = 'none') => renderToStaticMarkup(createElement(HandInteractionOverlay,
      { feedback: { mode, hands: tracked, region: [0.2, 0.1, 0.8, 0.9], zoom, commands: [] } }));
    const open = render('idle', [{ ...hands[0], pinching: false, state: 'ready' }]);
    assert(open.includes('data-button="none"') && open.includes('hand-mouse-mapped'));
    assert(open.includes('class="hand-virtual"') && open.includes('data-pinching="false"'));
    assert(!open.includes('hand-virtual-joints') && !open.includes('<circle '), 'Joint markers must stay hidden');
    assert(!open.includes('hand-virtual-wire') && !open.includes('<polyline '), 'Skeleton lines must stay hidden');
    assert.equal((open.match(/<polygon /g) ?? []).length, 1, 'The palm surface must remain visible');
    assert.equal((open.match(/<line /g) ?? []).length, 15, 'All five articulated finger surfaces must remain visible');
    const rotate = render('rotate', hands.slice(1));
    assert(rotate.includes('data-button="left"') && rotate.includes('hand-mouse-pressed'));
    const pan = render('pan', hands.slice(0, 1));
    assert(pan.includes('data-button="right"') && pan.includes('hand-mouse-pressed'));
    const cursor = /class="hand-cursor"[^>]*style="([^"]+)"/.exec(pan);
    const center = [0, 5, 9, 13, 17].reduce(([x, y], index) => {
      const point = hands[0].landmarks[index];
      return [x + point[0] / 5, y + point[1] / 5];
    }, [0, 0]);
    assert.equal(cursor[1], `left:${center[0] * 100}%;top:${center[1] * 100}%`, 'Action information must follow the palm');
    assert(pan.includes('class="hand-pinch-point" data-side="left" data-state="active" style="left:25%;top:50%"'),
      'The interaction dot must stay at the pinch point independently of the palm');
    const rejected = render('idle', [{ ...hands[0], state: 'release' }]);
    assert(rejected.includes('data-button="none"') && rejected.includes('data-state="release"'));
    assert(!rejected.includes('hand-mouse-pressed'));
    assert(open.includes('hand-start-region'));
    for (const [direction, symbol] of [['in', '+'], ['out', '−']]) {
      const markup = render('zoom', hands, direction);
      assert.equal((markup.match(/class="hand-cursor"/g) ?? []).length, 2);
      assert.equal((markup.match(/class="hand-virtual"/g) ?? []).length, 2);
      assert.equal((markup.match(/data-button="none"/g) ?? []).length, 2);
      assert(!markup.includes('hand-mouse-pressed'));
      assert.equal((markup.match(/class="hand-mouse-mapped"/g) ?? []).length, 2);
      assert.equal(markup.replace(/<[^>]*>/g, ''), symbol, 'Zoom feedback must use only a symbol');
      assert(markup.includes('hand-interaction-link') && markup.includes('hand-zoom-indicator'));
    }
    assert.equal(render('idle', []), '');
    const paused = render('paused', hands);
    assert.equal((paused.match(/class="hand-virtual"/g) ?? []).length, 2);
    assert.equal((paused.match(/class="hand-cursor"/g) ?? []).length, 2);
    assert.equal((paused.match(/class="hand-mouse-mapped"/g) ?? []).length, 2);
    assert(!paused.includes('hand-mouse-pressed') && !paused.includes('hand-start-region'));
    const visualOnly = renderToStaticMarkup(createElement(HandInteractionOverlay,
      { feedback: { mode: 'zoom', hands, region: [0, 0, 1, 1], zoom: 'in', commands: [] }, interactive: false }));
    assert(!visualOnly.includes('hand-virtual-joints') && !visualOnly.includes('<circle '));
    assert(!visualOnly.includes('hand-virtual-wire') && !visualOnly.includes('<polyline '));
    assert.equal((visualOnly.match(/class="hand-mouse-mapped"/g) ?? []).length, 2);
    assert(!visualOnly.includes('hand-mouse-pressed') && !visualOnly.includes('hand-interaction-link'));
    for (const markup of [open, rotate, pan, rejected, paused, visualOnly]) {
      assert.equal(markup.replace(/<[^>]*>/g, ''), '', 'Hand badges must not contain text');
    }
    for (const side of ['left', 'right']) {
      const button = side === 'right' ? 'left' : 'right';
      const path = button === 'left' ? 'M15 4a10 10 0 0 0-10 10v3h10Z' : 'M17 4a10 10 0 0 1 10 10v3H17Z';
      for (const state of ['ready', 'outside', 'release', 'active']) {
        const tracked = [{ ...hands.find(hand => hand.side === side), state }];
        for (const mode of ['idle', 'paused', 'zoom']) {
          const markup = render(mode, tracked);
          const pressed = state === 'active' && mode === 'idle';
          assert(markup.includes(`data-mouse-button="${button}"><path class="hand-mouse-${pressed ? 'pressed' : 'mapped'}" d="${path}"`),
            `${side} hand must show the ${button} mouse icon in ${mode}/${state}`);
        }
      }
    }
  } finally { await server.close(); }
});
