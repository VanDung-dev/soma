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

test('settings render as a page and guides respect manipulation and camera capabilities', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { SettingsPage } = await server.ssrLoadModule('/src/settings/page.tsx');
    const { GraphicsControls } = await server.ssrLoadModule('/src/settings/graphics-controls.tsx');
    const { defaultGraphics } = await server.ssrLoadModule('/src/viewer/graphics.ts');
    const { translateMessage } = await server.ssrLoadModule('/src/i18n.tsx');
    const t = key => translateMessage(key, 'vi');
    const fontSize = { fontSize: '12', setFontSize() {}, failed: false };
    const settings = renderToStaticMarkup(h(SettingsPage, { fontSize }));
    assert(settings.includes('<main class="settings-page"') && !settings.includes('popover='));
    assert(settings.includes('<nav class="settings-navigation" aria-labelledby="settings-title"><h1 id="settings-title">'));
    assert(settings.includes('id="settings-language"') && settings.includes('id="settings-theme"'));
    assert.match(settings, /<input id="settings-font-size"[^>]* value="12"/);
    const graphicsPage = renderToStaticMarkup(h(SettingsPage, { section: 'graphics', fontSize }));
    for (const field of ['show-axes', 'show-fps', 'grid']) {
      assert(graphicsPage.includes(`for="settings-graphics-${field}"`));
      assert(graphicsPage.includes(`id="settings-graphics-${field}"`));
    }
    const anatomy = renderToStaticMarkup(h(GraphicsControls, { id: 'anatomy-settings', graphics: defaultGraphics, onChange() {}, buttons: true }));
    for (const field of ['shadow', 'lighting', 'model', 'fps']) {
      assert(anatomy.includes(`aria-labelledby="anatomy-settings-${field}-label"`));
      assert(!anatomy.includes(`<select id="anatomy-settings-${field}"`));
    }
    assert.equal((anatomy.match(/aria-pressed="true"/g) ?? []).length, 4);
    assert.equal((anatomy.match(/class="settings-switch"/g) ?? []).length, 3);
    const legacy = renderToStaticMarkup(h(GraphicsControls, { id: 'legacy', graphics: { ...defaultGraphics, frameRate: 'display' }, onChange() {}, buttons: true }));
    assert(legacy.includes('data-value="display" aria-pressed="true"'));
    const guidePage = renderToStaticMarkup(h(SettingsPage, { section: 'guide', fontSize }));
    assert(guidePage.includes('controls-guide') && !guidePage.includes('popover=') && !guidePage.includes('<kbd>'));
    assert(guidePage.includes(t('controls.mouse.zoomAtCursor')) && guidePage.includes(t('controls.hand.rightPinch')));
    const keys = renderToStaticMarkup(h(SettingsPage, { section: 'shortcuts', fontSize }));
    assert(keys.includes('data-shortcut="settings"') && keys.includes('data-shortcut="camera:r"'));
  } finally { await server.close(); }
});
