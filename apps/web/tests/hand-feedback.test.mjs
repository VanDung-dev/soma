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
      disabled: false, onControl: () => true, sceneHost: { current: null }, interactionFrame: { current: null }, obstacles: [], onBackground: () => {},
    }));
    assert(controls.includes('Bật camera'));
    assert(!/hand-camera-(status|guide|privacy)/.test(controls));
    assert(controls.includes('hand-camera-scene-toggle'));
    const { HandInteractionOverlay } = await server.ssrLoadModule('/src/anatomy/hand-interaction-overlay.tsx');
    const hands = ['left', 'right'].map(side => ({ side, x: side === 'left' ? 0.25 : 0.75, y: 0.5,
      pinching: true, state: 'active', landmarks: handLandmarks({ side, pinching: true }) }));
    const render = (mode, tracked, zoom = 'none') => renderToStaticMarkup(createElement(HandInteractionOverlay,
      { feedback: { mode, hands: tracked, region: [0.2, 0.1, 0.8, 0.9], zoom, commands: [] } }));
    const open = render('idle', [{ ...hands[0], pinching: false, state: 'ready' }]);
    assert(open.includes('data-button="none"') && open.includes('Sẵn sàng'));
    assert(open.includes('class="hand-virtual"') && open.includes('data-pinching="false"'));
    assert.equal((open.match(/<circle /g) ?? []).length, 21, 'All tracked joints must be visible before pinching');
    assert.equal((open.match(/<polyline /g) ?? []).length, 5, 'The virtual hand must show five articulated fingers');
    const rotate = render('rotate', hands.slice(1));
    assert(rotate.includes('data-button="left"') && rotate.includes('Giữ chuột trái'));
    const pan = render('pan', hands.slice(0, 1));
    assert(pan.includes('data-button="right"') && pan.includes('Giữ chuột phải'));
    const cursor = /class="hand-cursor"[^>]*style="([^"]+)"/.exec(pan);
    const center = [0, 5, 9, 13, 17].reduce(([x, y], index) => {
      const point = hands[0].landmarks[index];
      return [x + point[0] / 5, y + point[1] / 5];
    }, [0, 0]);
    assert.equal(cursor[1], `left:${center[0] * 100}%;top:${center[1] * 100}%`, 'Action information must follow the palm');
    assert(pan.includes('class="hand-pinch-point" data-side="left" data-state="active" style="left:25%;top:50%"'),
      'The interaction dot must stay at the pinch point independently of the palm');
    const rejected = render('idle', [{ ...hands[0], state: 'release' }]);
    assert(rejected.includes('data-button="none"') && rejected.includes('Nhả để bắt đầu'));
    assert(!rejected.includes('hand-mouse-pressed'));
    assert(open.includes('hand-start-region'));
    for (const [direction, text] of [['in', 'Phóng to'], ['out', 'Thu nhỏ']]) {
      const markup = render('zoom', hands, direction);
      assert.equal((markup.match(/class="hand-cursor"/g) ?? []).length, 2);
      assert.equal((markup.match(/class="hand-virtual"/g) ?? []).length, 2);
      assert.equal((markup.match(/data-button="none"/g) ?? []).length, 2);
      assert(!markup.includes('hand-mouse-pressed'));
      assert(markup.includes('↔') && markup.includes('Thu phóng'));
      assert(markup.includes('Tay trái') && markup.includes('Tay phải') && markup.includes(text));
      assert(markup.includes('hand-interaction-link') && markup.includes('hand-zoom-indicator'));
    }
    assert.equal(render('idle', []), '');
    assert.equal(render('paused', hands), '');
  } finally { await server.close(); }
});
