import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('app shortcuts match platform modifiers and preserve editing, composition and native clipboard', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { shortcutAction, shortcutLabel, isMacPlatform } = await server.ssrLoadModule('/src/shortcuts.ts');
    const event = patch => ({ key: '', code: '', target: null, ctrlKey: false, metaKey: false, altKey: false,
      shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false, ...patch });
    assert(isMacPlatform('MacIntel')); assert(!isMacPlatform('Win32')); assert(!isMacPlatform('Linux x86_64'));
    assert.equal(shortcutLabel('copy', true), '⌘C'); assert.equal(shortcutLabel('paste', false), 'Ctrl+V');
    assert.equal(shortcutLabel('back', true), '⌘['); assert.equal(shortcutLabel('forward', false), 'Ctrl+]');
    assert.equal(shortcutLabel('restore', true), 'T'); assert.equal(shortcutLabel('settings', false), 'Esc');
    for (const mac of [false, true]) {
      const command = mac ? { metaKey: true } : { ctrlKey: true };
      assert.equal(shortcutAction(event({ key: '[', ...command }), mac), 'back');
      assert.equal(shortcutAction(event({ key: ']', ...command }), mac), 'forward');
      assert.equal(shortcutAction(event({ key: 'é', code: 'BracketLeft', ...command }), mac), 'back');
      assert.equal(shortcutAction(event({ key: '[', ...(mac ? { ctrlKey: true } : { metaKey: true }) }), mac), undefined);
      assert.equal(shortcutAction(event({ key: 'c', ...command }), mac), undefined);
      assert.equal(shortcutAction(event({ key: 'v', ...command }), mac), undefined);
      for (const [key, action] of [['Escape', 'settings'], ['g', 'guide'], ['f', 'find'], ['t', 'restore']]) {
        assert.equal(shortcutAction(event({ key }), mac), action);
        for (const flag of ['altKey', 'shiftKey', 'isComposing', 'repeat', 'defaultPrevented']) {
          assert.equal(shortcutAction(event({ key, [flag]: true }), mac), undefined);
        }
        const target = { closest: () => ({}) };
        assert.equal(shortcutAction(event({ key, target }), mac), key === 'Escape' ? 'settings' : undefined);
      }
    }
  } finally { await server.close(); }
});
