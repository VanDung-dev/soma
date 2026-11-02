import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { checkOrientationPointer } from '../tests/orientation-pointer.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BENCHMARK_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'atlas-browser-check-'));
const server = await createServer({ root, cacheDir, server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null } });
let browser;
try {
  await server.listen();
  const baseURL = server.resolvedUrls.local[0];
  browser = await chromium.launch({ executablePath: process.env.BENCHMARK_BROWSER, headless: true, chromiumSandbox: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
  await context.addInitScript(() => { if (window.top === window) localStorage.setItem('anatomy-onboarding:v1', 'dismissed'); });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/anatomy');
  await page.waitForSelector('.model-canvas[aria-busy="false"]', { timeout: 60000 });
  for (const [file, name] of [['inventory-switch.browser.mjs', 'checkInventorySwitch'], ['visibility-camera.browser.mjs', 'checkExplosionEntry'], ['visibility-camera.browser.mjs', 'checkVisibilityCamera'], ['selection.browser.mjs', 'checkSelectionOutline'], ['selection.browser.mjs', 'checkMarqueeInput'],
    ['language.browser.mjs', 'checkLanguage'], ['theme.browser.mjs', 'checkTheme'],
    ['orientation-axes.browser.mjs', 'checkAxesVisibility'],
    ['orientation-axes.browser.mjs', 'checkOrientationAxes'],
    ['sidebar.browser.mjs', 'checkSidebar'],
    ['sidebar.browser.mjs', 'checkSidebarMotion'],
    ['structure-tree.browser.mjs', 'checkStructureTree'], ['search.browser.mjs', 'checkStructureSearch'],
    ['viewer-runtime.browser.mjs', 'checkViewerRuntime'], ['assembly.browser.mjs', 'checkRestoration'], ['controls.browser.mjs', 'checkControls'],
    ['camera-devices.browser.mjs', 'checkCameraDevices'], ['hand-input.browser.mjs', 'checkHandInput']]) {
    const result = await page.evaluate(async ({ file, name }) => {
      let timeout;
      try {
        return await Promise.race([(await import('/tests/' + file))[name](),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(Error(name + ' timed out')), 30000); })]);
      } finally { clearTimeout(timeout); }
    }, { file, name });
    console.log(name, JSON.stringify(result));
    if (name === 'checkOrientationAxes') console.log('checkOrientationPointer', JSON.stringify(await checkOrientationPointer(page)));
  }
  assert.deepEqual(errors, [], 'Browser checks must not raise uncaught errors');
  await context.close();
  const blocked = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
  await blocked.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
  });
  const blockedPage = await blocked.newPage();
  blockedPage.on('pageerror', error => errors.push(error.message));
  await blockedPage.goto('/home');
  await blockedPage.waitForSelector('.home-page');
  for (const [file, name] of [['language.browser.mjs', 'checkLanguage'], ['theme.browser.mjs', 'checkTheme']]) {
    console.log(name + ':blocked-storage', JSON.stringify(await blockedPage.evaluate(async ({ file, name }) =>
      (await import('/tests/' + file))[name](), { file, name })));
  }
  assert.deepEqual(errors, [], 'Blocked storage must not break startup or preference controls');
  await blocked.close();
  console.log('Browser checks passed: 21');
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
