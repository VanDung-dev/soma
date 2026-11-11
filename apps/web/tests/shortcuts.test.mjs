import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('app shortcuts match platform modifiers and preserve editing, composition and native clipboard', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { appShortcuts, shortcutAction, shortcutLabel, isMacPlatform } = await server.ssrLoadModule('/src/shortcuts.ts');
    const event = patch => ({ key: '', code: '', target: null, ctrlKey: false, metaKey: false, altKey: false,
      shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false, ...patch });
    assert(isMacPlatform('MacIntel')); assert(!isMacPlatform('Win32')); assert(!isMacPlatform('Linux x86_64'));
    assert.equal(shortcutLabel('back', true), '⌘['); assert.equal(shortcutLabel('forward', false), 'Ctrl+]');
    assert.equal(shortcutLabel('restore', true), 'T');
    assert.equal(shortcutLabel('settings', true), '⌘,'); assert.equal(shortcutLabel('settings', false), 'Ctrl+,');
    assert.equal(shortcutLabel('catalog', true), '⇧⌘S'); assert.equal(shortcutLabel('information', false), 'Shift+Ctrl+.');
    assert(!Object.hasOwn(appShortcuts, 'find'), 'Search must not advertise a keyboard shortcut');
    for (const mac of [false, true]) {
      const command = mac ? { metaKey: true } : { ctrlKey: true };
      assert.equal(shortcutAction(event({ key: 'Escape' }), mac), undefined);
      assert.equal(shortcutAction(event({ key: 'g' }), mac), undefined);
      assert.equal(shortcutAction(event({ key: ',' }), mac), undefined);
      assert.equal(shortcutAction(event({ key: ',', ...(mac ? { ctrlKey: true } : { metaKey: true }) }), mac), undefined);
      assert.equal(shortcutAction(event({ key: '،', code: 'Comma', ...command }), mac), 'settings');
      assert.equal(shortcutAction(event({ key: 'S', shiftKey: true, ...command }), mac), 'catalog');
      assert.equal(shortcutAction(event({ key: '>', code: 'Period', shiftKey: true, ...command }), mac), 'information');
      assert.equal(shortcutAction(event({ key: 's', ...command }), mac), undefined);
      assert.equal(shortcutAction(event({ key: 'S', shiftKey: true, ...command, target: { closest: () => ({}) } }), mac), undefined);
      assert.equal(shortcutAction(event({ key: '[', ...command }), mac), 'back');
      assert.equal(shortcutAction(event({ key: ']', ...command }), mac), 'forward');
      assert.equal(shortcutAction(event({ key: 'é', code: 'BracketLeft', ...command }), mac), 'back');
      assert.equal(shortcutAction(event({ key: '[', ...(mac ? { ctrlKey: true } : { metaKey: true }) }), mac), undefined);
      assert.equal(shortcutAction(event({ key: 'c', ...command }), mac), undefined);
      assert.equal(shortcutAction(event({ key: 'v', ...command }), mac), undefined);
      assert.equal(shortcutAction(event({ key: 'f' }), mac), undefined, 'Plain F belongs to typing');
      assert.equal(shortcutAction(event({ key: 'f', ...command }), mac), undefined, 'Preserve the browser Find shortcut');
      for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }]) {
        assert.equal(shortcutAction(event({ key: '/', ...modifiers }), mac), undefined);
      }
      for (const [key, action, modifiers = {}] of [[',', 'settings', command], ['t', 'restore']]) {
        assert.equal(shortcutAction(event({ key, ...modifiers }), mac), action);
        for (const flag of ['altKey', 'shiftKey', 'isComposing', 'repeat', 'defaultPrevented']) {
          assert.equal(shortcutAction(event({ key, ...modifiers, [flag]: true }), mac), undefined);
        }
        assert.equal(shortcutAction(event({ key, ...modifiers, keyCode: 229 }), mac), undefined, 'Ignore IME events at composition boundaries');
        const target = { closest: () => ({}) };
        assert.equal(shortcutAction(event({ key, target, ...modifiers }), mac), action === 'settings' ? action : undefined);
      }
    }
  } finally { await server.close(); }
});
