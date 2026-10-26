import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('language and theme initialization tolerate unavailable browser storage', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    const { getInitialLanguage } = await server.ssrLoadModule('/src/i18n.tsx');
    const { getInitialTheme } = await server.ssrLoadModule('/src/theme.tsx');
    for (const value of [null, 'invalid', 'en', 'vi', 'light', 'dark', 'auto']) {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => value } } });
      assert.equal(getInitialLanguage(), value === 'en' ? 'en' : 'vi');
      assert.equal(getInitialTheme(), value === 'light' || value === 'dark' ? value : 'auto');
    }
    for (const storage of [{ getItem() { throw new DOMException('Blocked', 'SecurityError'); } }, undefined]) {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
      assert.equal(getInitialLanguage(), 'vi');
      assert.equal(getInitialTheme(), 'auto');
    }
    delete globalThis.window;
    assert.equal(getInitialLanguage(), 'vi');
    assert.equal(getInitialTheme(), 'auto');
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original); else delete globalThis.window;
    await server.close();
  }
});
