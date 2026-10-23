import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

export async function checkModuleNavigation() {
  const { App } = await import('/src/app.tsx');
  const { getWasm } = await import('/src/anatomy/core.ts');
  const catalog = (await getWasm()).get_catalog();
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const originalTauri = Object.getOwnPropertyDescriptor(window, 'isTauri');
  const originalInternals = Object.getOwnPropertyDescriptor(window, '__TAURI_INTERNALS__');
  const originalTitle = document.title;
  const originalUrl = location.href;
  assert(['/', '/home', '/home/'].includes(location.pathname), 'Start the navigation probe on Home');
  let catalogCalls = 0;
  try {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {
      invoke: async command => {
        assert(command === 'get_catalog', 'Only mock the native catalog command');
        catalogCalls++;
        return catalog;
      },
    } });
    for (const desktop of [false, true]) {
      Object.defineProperty(window, 'isTauri', { configurable: true, value: desktop });
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      const click = (target, patch = {}) => {
        let intercepted;
        host.addEventListener('click', event => {
          intercepted = event.defaultPrevented;
          event.preventDefault();
        }, { once: true });
        flushSync(() => {
          if (patch.detail !== 0) target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1, ...patch }));
        });
        return intercepted;
      };
      try {
        flushSync(() => root.render(createElement(App)));
        const frame = host.querySelector('.module-page');
        const header = host.querySelector('.module-header');
        const content = host.querySelector('.module-content');
        const credit = host.querySelector('.home-credit a');
        const creditHref = credit.getAttribute('href');
        const readDocument = path => new Promise((resolve, reject) => {
          const observer = new MutationObserver(check);
          const timeout = setTimeout(() => { observer.disconnect(); reject(Error(`Source document timed out: ${path}; ${host.querySelector('.source-document')?.outerHTML}`)); }, 5000);
          function check() {
            const result = host.querySelector('.source-document pre, .source-document [role="alert"]');
            if (result) { clearTimeout(timeout); observer.disconnect(); resolve(result); }
          }
          observer.observe(host, { childList: true, subtree: true, attributes: true, characterData: true });
          check();
        });
        for (const path of ['/home/ATTRIBUTION.md', '/models/z-anatomy/ATTRIBUTION.md', '/missing/ATTRIBUTION.md']) {
          credit.href = path;
          credit.focus();
          assert(click(credit) === desktop, 'Open bundled source documents inside desktop and retain browser links');
          if (desktop) {
            const result = await readDocument(path);
            const panel = host.querySelector('.source-document');
            assert(panel.matches(':popover-open') && panel.popover === 'auto', 'Read source documents in the shared dismissible popover');
            if (path.startsWith('/missing/')) assert(result.getAttribute('role') === 'alert', 'Show document loading failures');
            else assert(result.textContent === await (await fetch(path)).text(), 'Preserve the complete source and license text');
            const key = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true });
            result.dispatchEvent(key);
            assert(!key.defaultPrevented, 'Document keys must not invoke viewer shortcuts');
            await new Promise(resolve => {
              panel.addEventListener('toggle', event => { if (event.newState === 'closed') resolve(); });
              panel.querySelector('button').click();
            });
            flushSync(() => {});
            assert(!host.querySelector('.source-document') && document.activeElement === credit, 'Close documents and restore link focus');
            assert(host.querySelector('.module-page') === frame && location.href === originalUrl, 'Keep the current page mounted while reading sources');
          } else assert(!host.querySelector('.source-document'), 'Keep native browser tab behavior');
        }
        credit.setAttribute('href', creditHref);
        const check = page => {
          assert(location.href === originalUrl, 'Keep the desktop WebView URL unchanged');
          assert(host.querySelector('.module-page') === frame && host.querySelector('.module-header') === header && host.querySelector('.module-content') === content, 'Keep the same frame, header and content container');
          assert(content.dataset.page === page, 'Render the selected module');
          assert(host.querySelector('.module-nav [aria-current="page"]').pathname === '/' + page, 'Update the active navigation link');
          assert(document.title === 'Human Atlas — ' + host.querySelector('.module-nav [aria-current="page"]').textContent, 'Update the window title');
        };
        for (const page of ['anatomy']) {
          assert(click(host.querySelector(`.home-module-${page} strong`)) === desktop, 'Intercept Home cards only on desktop, including nested targets');
          check(desktop ? page : 'home');
          if (desktop) {
            assert(frame.dataset.focusSource === 'pointer', 'Track pointer focus across the shared frame');
            assert(document.activeElement === host.querySelector('.module-nav [aria-current="page"]'), 'Restore keyboard focus to the active module');
            assert(getComputedStyle(document.activeElement).outlineStyle === 'none', 'Hide the focus outline after pointer navigation');
            assert(click(host.querySelector('.module-brand')), 'Return to Home inside the same WebView');
            check('home');
          }
        }
        for (const page of ['home', 'anatomy']) {
          assert(click(host.querySelector(`.module-nav a[href="/${page}"]`)) === desktop, 'Intercept header links only on desktop');
          check(desktop ? page : 'home');
        }
        const anatomy = host.querySelector('.module-nav a[href="/anatomy"]');
        if (desktop) {
          anatomy.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          assert(click(anatomy, { detail: 0 }), 'Allow keyboard activation');
          check('anatomy');
          const active = host.querySelector('.module-nav [aria-current="page"]');
          assert(document.activeElement === active && frame.dataset.focusSource === 'keyboard', 'Keep keyboard focus available');
          click(host.querySelector('.module-brand'));
          check('home');
          assert(getComputedStyle(document.activeElement).outlineStyle === 'none', 'Hide keyboard focus outlines again after a pointer click');
        }
        for (const patch of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
          assert(!click(anatomy, patch), 'Preserve modified and secondary clicks');
          check('home');
        }
        const link = document.createElement('a');
        frame.append(link);
        for (const href of ['/unknown', '#workspace', '/games?mode=test', '/games#section', 'https://example.com/games']) {
          link.href = href;
          assert(!click(link), 'Preserve non-module URLs');
          check('home');
        }
        link.href = '/games';
        link.target = '_blank';
        assert(!click(link), 'Preserve new-window links');
        link.removeAttribute('target');
        link.download = 'games';
        assert(!click(link), 'Preserve downloads');
        link.removeAttribute('download');
        link.addEventListener('click', event => event.preventDefault(), { once: true });
        click(link);
        check('home');
      } finally {
        flushSync(() => root.unmount());
        host.remove();
      }
    }
    assert(catalogCalls === 1, 'Mount Anatomy once through the native catalog path');
    return { desktopInPlace: true, stableFrame: true, webLinksPreserved: true, keyboardFocus: true, linkExceptions: true,
      sourceDocuments: true, sourceTextPreserved: true, sourceErrors: true, sourceFocusRestored: true };
  } finally {
    if (originalTauri) Object.defineProperty(window, 'isTauri', originalTauri); else delete window.isTauri;
    if (originalInternals) Object.defineProperty(window, '__TAURI_INTERNALS__', originalInternals); else delete window.__TAURI_INTERNALS__;
    document.title = originalTitle;
  }
}

export async function checkModuleLayout() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const root = document.getElementById('root');
  const path = location.pathname.replace(/\/+$/, '');
  const name = path.slice(1) || 'home';
  const documentBounds = document.documentElement;
  assert(documentBounds.scrollWidth === innerWidth && documentBounds.scrollHeight === innerHeight, 'Keep the document inside the viewport');
  if (!['home', 'anatomy', 'lessons', 'games'].includes(name)) {
    assert(root.childElementCount === 0, 'Keep unknown routes empty');
    return { path, empty: true, viewport: [innerWidth, innerHeight] };
  }
  const content = root.querySelector('.module-content');
  const space = content.querySelector(':scope > .model-space');
  assert(root.querySelectorAll('.model-space').length === 1, 'The shared layout must own the only workspace');
  assert(content.dataset.page === name, 'Render the module at its own URL');
  const currentNavigation = root.querySelector('.module-nav [aria-current="page"]');
  assert(name === 'lessons' || name === 'games' ? currentNavigation.getAttribute('aria-disabled') === 'true' : currentNavigation.getAttribute('href') === '/' + name, 'Mark the current module in navigation');
  assert(JSON.stringify([...root.querySelectorAll('.module-nav a, .module-nav-disabled')].map(link => link.textContent)) === JSON.stringify(['Home', '3D Anatomy', 'Lessons', 'Games']), 'Show all modules while disabling unavailable ones');
  assert(root.querySelector('.module-brand').getAttribute('href') === '/home' && !root.querySelector('.brand-mark'), 'The brand must link to Home without a mark');
  const outer = content.getBoundingClientRect(), inner = space.getBoundingClientRect();
  const inset = parseFloat(getComputedStyle(space).left);
  assert(inset === 0 && getComputedStyle(content).boxShadow === 'none', 'Fill the module content without an outer border band');
  for (const gap of [inner.left - outer.left, inner.top - outer.top, outer.right - inner.right, outer.bottom - inner.bottom]) {
    assert(Math.abs(gap - inset) < .1, 'Use the same workspace inset on every side');
  }
  assert(parseFloat(getComputedStyle(content).borderRadius) === parseFloat(getComputedStyle(space).borderRadius) + inset, 'Keep nested corner radii aligned');
  assert(getComputedStyle(space).backgroundImage !== 'none', 'Apply the shared theme background');
  assert(outer.bottom <= innerHeight && inner.width > 0 && inner.height > 0, 'Keep the frame visible and usable');
  for (const control of root.querySelectorAll('.module-header a, .module-header button')) {
    const rect = control.getBoundingClientRect();
    assert(rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight, 'Keep navigation and preferences inside the viewport');
  }
  if (name === 'anatomy') {
    let observer, timeout;
    try {
      await new Promise((resolve, reject) => {
        const ready = () => {
          if (space.querySelector('.model-error')) reject(Error('Model loading failed'));
          else if (space.querySelector('.model-canvas[aria-busy="false"]')) resolve();
        };
        observer = new MutationObserver(ready);
        observer.observe(space, { attributes: true, childList: true, subtree: true });
        timeout = setTimeout(() => reject(Error('Model loading timed out')), 20000);
        ready();
      });
    } finally { observer?.disconnect(); clearTimeout(timeout); }
    const canvas = space.querySelector('.model-canvas');
    assert(canvas.getAttribute('aria-busy') === 'false' && !space.querySelector('.model-error'), 'Wait for the model to finish loading');
    const bounds = canvas.getBoundingClientRect();
    assert(bounds.left === inner.left && bounds.top === inner.top && bounds.width === inner.width && bounds.height === inner.height, 'Fill the supplied workspace without another frame');
    const frame = space.querySelector('.model-focus-frame').getBoundingClientRect();
    assert(frame.width > 0 && frame.height > 0 && frame.left >= inner.left && frame.right <= inner.right && frame.top >= inner.top && frame.bottom <= inner.bottom, 'Keep camera interactions inside the viewer');
    for (const panel of space.querySelectorAll('.catalog-panel, .information-panel')) {
      if (getComputedStyle(panel).display === 'none') continue;
      const bounds = panel.getBoundingClientRect();
      assert(bounds.left >= inner.left && bounds.top >= inner.top && bounds.right <= inner.right && bounds.bottom <= inner.bottom, 'Keep open panels inside the workspace');
    }
  } else if (name === 'home') {
    assert(JSON.stringify([...space.querySelectorAll('.home-modules a')].map(link => link.getAttribute('href'))) === JSON.stringify(['/anatomy']), 'Show only available modules on Home');
    const images = [...space.querySelectorAll('.home-modules img')];
    assert(images.length === 3, 'Keep every module preview visible');
    await Promise.all(images.map(image => image.decode()));
    assert(images.every(image => image.naturalWidth > 0 && image.naturalHeight > 0), 'Load every model preview successfully');
    assert(!space.querySelector('canvas'), 'Use static previews without starting a 3D viewer on Home');
    assert(space.querySelector('.home-credit a').getAttribute('href') === '/home/ATTRIBUTION.md', 'Keep source credits available');
    for (const link of space.querySelectorAll('.home-modules a')) {
      const bounds = link.getBoundingClientRect();
      assert(bounds.left >= inner.left && bounds.top >= inner.top && bounds.right <= inner.right && bounds.bottom <= inner.bottom, 'Keep Home links visible inside the workspace');
    }
  } else assert(space.childElementCount === 0, 'Leave future module content empty');
  return { path, singleWorkspace: true, contained: true, viewport: [innerWidth, innerHeight] };
}
