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
  assert(root.querySelector('.module-nav [aria-current="page"]').getAttribute('href') === '/' + name, 'Mark the current module in navigation');
  assert(JSON.stringify([...root.querySelectorAll('.module-nav a')].map(link => link.textContent)) === JSON.stringify(['Home', '3D Anatomy', 'Lessons', 'Games']), 'Keep the requested navigation order');
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
    assert(JSON.stringify([...space.querySelectorAll('.home-modules a')].map(link => link.getAttribute('href'))) === JSON.stringify(['/anatomy', '/lessons', '/games']), 'Show all app sections on Home');
    const images = [...space.querySelectorAll('.home-modules img')];
    assert(images.length === 3, 'Give each module its own model preview');
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
