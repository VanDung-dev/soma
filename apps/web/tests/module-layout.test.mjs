import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { createServer } from 'vite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWebServer } from '../scripts/serve.mjs';

test('Home and module routes share one workspace and navigation returns to Home', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const previousWindow = globalThis.window;
  try {
    globalThis.window = { location: { pathname: '/' }, localStorage: { getItem: () => null } };
    const { App } = await server.ssrLoadModule('/src/app.tsx');
    const render = path => {
      globalThis.window.location.pathname = path;
      return renderToStaticMarkup(createElement(App));
    };
    assert.equal(render('/'), render('/home'));
    assert.equal(render('/unknown'), '');
    for (const name of ['home', 'anatomy', 'lessons', 'games']) {
      const markup = render('/' + name);
      assert.equal((markup.match(/class="model-space"/g) ?? []).length, 1);
      assert(markup.includes(`data-page="${name}"`));
      if (name === 'home' || name === 'anatomy') assert(markup.includes(`href="/${name}" aria-current="page"`));
      else assert(markup.includes(`aria-disabled="true" aria-current="page">${name === 'lessons' ? 'Lessons' : 'Games'}</span>`));
      assert(markup.includes('class="module-brand" href="/home"'));
      assert(!markup.includes('brand-mark'));
      const navigation = markup.match(/<nav class="module-nav"[\s\S]*?<\/nav>/)[0];
      assert.deepEqual([...navigation.matchAll(/href="([^"]+)"/g)].map(match => match[1]), ['/home', '/anatomy']);
      assert(navigation.includes('aria-disabled="true"') && navigation.includes('Lessons</span>'));
      assert(navigation.includes('aria-disabled="true"') && navigation.includes('Games</span>'));
      assert.equal(render('/' + name + '/'), markup);
      if (name === 'home') {
        assert(markup.includes('Chọn một phần để bắt đầu.'));
        assert.equal((markup.match(/Chưa có nội dung\./g) ?? []).length, 2);
        assert.deepEqual([...markup.matchAll(/class="home-module[^\"]*" href="([^"]+)"/g)].map(match => match[1]), ['/anatomy']);
        assert.equal((markup.match(/class="home-module-art"/g) ?? []).length, 3);
        assert.equal((markup.match(/class="home-module-copy"/g) ?? []).length, 3);
        assert.equal((markup.match(/draggable="false"/g) ?? []).length, 6);
        for (const module of ['lessons', 'games']) assert(markup.includes(`class="home-module home-module-${module}" aria-disabled="true"`));
      }
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    await server.close();
  }
});

test('the production server serves module URLs and keeps missing assets as errors', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'atlas-pages-'));
  const server = createWebServer(directory);
  try {
    await writeFile(path.join(directory, 'index.html'), '<main>Soma</main>');
    await writeFile(path.join(directory, 'site.webmanifest'), JSON.stringify({ name: 'Soma' }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const route of ['/', '/home', '/home/', '/anatomy', '/lessons', '/games', '/anatomy/']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), '<main>Soma</main>');
    }
    assert.equal((await fetch(base + '/games', { method: 'HEAD' })).status, 200);
    const manifest = await fetch(base + '/site.webmanifest');
    assert.equal(manifest.headers.get('content-type'), 'application/manifest+json');
    assert.deepEqual(await manifest.json(), { name: 'Soma' });
    assert.equal((await fetch(base + '/assets/missing.js')).status, 404);
    assert.equal((await fetch(base + '/missing')).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('desktop headers expose dragging and reserve platform window controls', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const previousWindow = globalThis.window;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const tauriDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'isTauri');
  try {
    globalThis.window = { location: { pathname: '/home' }, localStorage: { getItem: () => null } };
    const { App } = await server.ssrLoadModule('/src/app.tsx');
    for (const [desktop, userAgent, macOS, windows] of [[false, 'Macintosh', false, false], [true, 'Windows NT', false, true],
      [true, 'Macintosh; Intel Mac OS X', true, false], [true, 'Linux', false, false]]) {
      Object.defineProperty(globalThis, 'isTauri', { value: desktop, configurable: true });
      Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true });
      const markup = renderToStaticMarkup(createElement(App));
      assert.equal(markup.includes('macos-window'), macOS);
      assert.equal(markup.includes('windows-window'), windows);
      assert.equal(markup.includes('class="window-controls"'), windows);
      assert.equal(markup.includes('data-tauri-drag-region="deep"'), macOS || windows);
      assert(markup.includes('class="module-brand" href="/home"'));
      assert(!/<(?:a|button)[^>]*data-tauri-drag-region/.test(markup));
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator;
    if (tauriDescriptor) Object.defineProperty(globalThis, 'isTauri', tauriDescriptor); else delete globalThis.isTauri;
    await server.close();
  }
});
