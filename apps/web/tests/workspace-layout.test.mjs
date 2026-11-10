import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('workspace menus retain feature slots and expose accessible sidebar state in either layout', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { WorkspaceLayout, WorkspaceMenu, SidebarToggle } = await server.ssrLoadModule('/src/pages/workspace-layout.tsx');
    for (const layout of ['overlay', 'inline']) for (const expanded of [false, true]) {
      const markup = renderToStaticMarkup(h(WorkspaceLayout, { className: 'consumer-workspace' },
        h(WorkspaceMenu, { layout,
          navigation: h(SidebarToggle, { controls: 'consumer-panel', expanded, name: 'Mục lục', onToggle() {} }),
          title: h('h1', null, 'Workspace title'),
          actions: h('button', { type: 'button' }, 'Feature action'),
        }),
        h('aside', { id: 'consumer-panel', hidden: !expanded }, 'Feature panel')));
      assert(markup.includes('class="workspace-shell consumer-workspace"'));
      assert(markup.includes(`data-layout="${layout}"`));
      assert(markup.includes(`aria-expanded="${expanded}" aria-controls="consumer-panel"`));
      assert(markup.includes(expanded ? 'Ẩn bảng Mục lục' : 'Hiện bảng Mục lục'));
      assert(markup.indexOf('app-menu-history') < markup.indexOf('Workspace title'));
      assert(markup.indexOf('Workspace title') < markup.indexOf('Feature action'));
      assert.equal((markup.match(/class="app-menu-bar"/g) ?? []).length, 1);
      assert.equal((markup.match(/id="consumer-panel"/g) ?? []).length, 1);
    }
  } finally { await server.close(); }
});

test('workspace settings preserve module extensions and guides respect manipulation and camera capabilities', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { WorkspaceSettings } = await server.ssrLoadModule('/src/pages/workspace-panels.tsx');
    const { LessonControls } = await server.ssrLoadModule('/src/lessons/shared/controls.tsx');
    const { CameraGuide } = await server.ssrLoadModule('/src/pages/camera-guide.tsx');
    const { defaultGraphics } = await server.ssrLoadModule('/src/anatomy/viewer/graphics.ts');
    const { translateMessage } = await server.ssrLoadModule('/src/i18n.tsx');
    const t = key => translateMessage(key, 'vi');
    const settings = renderToStaticMarkup(h(WorkspaceSettings, { id: 'settings', graphics: defaultGraphics, onChange() {} },
      h('div', { 'data-module-setting': true }, 'Module setting')));
    assert(settings.includes('data-module-setting="true"'));
    for (const field of ['shadow', 'lighting', 'model', 'fps', 'show-axes', 'show-fps', 'grid']) {
      assert(settings.includes(`for="settings-${field}"`));
      assert(settings.includes(`id="settings-${field}"`));
    }
    const anatomy = renderToStaticMarkup(h(WorkspaceSettings, { id: 'anatomy-settings', graphics: defaultGraphics, onChange() {}, graphicsButtons: true }));
    for (const field of ['shadow', 'lighting', 'model', 'fps']) {
      assert(anatomy.includes(`aria-labelledby="anatomy-settings-${field}-label"`));
      assert(!anatomy.includes(`<select id="anatomy-settings-${field}"`));
    }
    assert.equal((anatomy.match(/aria-pressed="true"/g) ?? []).length, 4);
    assert.equal((anatomy.match(/class="settings-switch"/g) ?? []).length, 3);
    const legacy = renderToStaticMarkup(h(WorkspaceSettings, { id: 'legacy', graphics: { ...defaultGraphics, frameRate: 'display' }, onChange() {}, graphicsButtons: true }));
    assert(legacy.includes('data-value="display" aria-pressed="true"'));
    const editorSettings = renderToStaticMarkup(h(LessonControls, { graphics: defaultGraphics, onGraphicsChange() {}, editing: true }));
    assert.equal((editorSettings.match(/class="graphics-options" role="group"/g) ?? []).length, 4);
    for (const [canManipulate, handCamera] of [[false, false], [true, false], [true, true]]) {
      const guide = renderToStaticMarkup(h(CameraGuide, { shortcuts: ['guide', 'settings'], canManipulate, handCamera }));
      assert(guide.includes(t('controls.mouse.zoomAtCursor')));
      assert.equal(guide.includes(t('context.detach')), canManipulate);
      assert.equal(guide.includes(t('controls.hand.rightPinch')), handCamera);
      assert(!guide.includes(t('context.restore')), 'Consumers choose the shortcuts their module supports');
    }
  } finally { await server.close(); }
});
