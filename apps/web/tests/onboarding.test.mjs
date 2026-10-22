import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('introductory guide respects saved decisions, supports replay and tolerates blocked storage', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const previousWindow = globalThis.window;
  try {
    const { AnatomyOnboarding, onboardingStorageKey, readOnboardingStatus } = await server.ssrLoadModule('/src/anatomy/onboarding.tsx');
    let saved = null;
    globalThis.window = { matchMedia: () => ({ matches: true }), localStorage: {
      getItem: key => { assert.equal(key, onboardingStorageKey); return saved; },
    } };
    const render = (replay = false) => renderToStaticMarkup(createElement(AnatomyOnboarding, { replay, onPanelChange() {} }));
    for (saved of [null, '', 'invalid', '"completed"']) {
      assert.equal(readOnboardingStatus(), null);
      assert(render().includes('popover="manual"'), 'First visits must allow practicing outside the guide');
      assert(render().includes('Bắt đầu'));
    }
    for (saved of ['completed', 'dismissed']) {
      assert.equal(readOnboardingStatus(), saved);
      assert.equal(render(), '', 'Saved decisions must suppress automatic replay');
      assert(render(true).includes('Bắt đầu'), 'Help must replay the guide after either decision');
    }
    globalThis.window = { matchMedia: () => ({ matches: false }), get localStorage() { throw Error('Storage blocked'); } };
    assert.equal(readOnboardingStatus(), null);
    assert(render().includes('Bắt đầu'), 'Unavailable storage must not prevent rendering');
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    await server.close();
  }
});

test('guide placement stays beside its target and fits the workspace at its edges', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { placeOnboarding } = await server.ssrLoadModule('/src/anatomy/onboarding-layout.ts');
    const area = { left: 0, top: 0, right: 1000, bottom: 800 };
    for (const [target, card, placement] of [
      [{ left: 30, top: 100, right: 300, bottom: 170 }, { width: 340, height: 240 }, 'right'],
      [{ left: 920, top: 20, right: 960, bottom: 60 }, { width: 340, height: 240 }, 'left'],
      [{ left: 400, top: 100, right: 600, bottom: 170 }, { width: 400, height: 240 }, 'below'],
      [{ left: 400, top: 700, right: 600, bottom: 740 }, { width: 400, height: 240 }, 'above'],
      [{ left: 20, top: 20, right: 980, bottom: 780 }, { width: 340, height: 240 }, 'bottom'],
      [null, { width: 340, height: 240 }, 'center'],
    ]) {
      const result = placeOnboarding(area, target, card, 16);
      assert.equal(result.placement, placement);
      assert(result.left >= 16 && result.top >= 16);
      assert(result.left + card.width <= 984 && result.top + card.height <= 784);
      if (target && !['bottom', 'center'].includes(placement)) assert(
        result.left >= target.right + 12 || result.left + card.width <= target.left - 12
        || result.top >= target.bottom + 12 || result.top + card.height <= target.top - 12,
        'The guide must leave room to interact with its target',
      );
    }
    assert.equal(placeOnboarding({ left: 0, top: 0, right: 1280, bottom: 800 },
      { left: 365, top: 120, right: 915, bottom: 470 }, { width: 320, height: 300 }, 16).placement, 'right');
    assert.equal(placeOnboarding(area, { left: 920, top: 20, right: 960, bottom: 60 }, { width: 340, height: 240 }, 16, 'below').placement, 'below');
  } finally { await server.close(); }
});
