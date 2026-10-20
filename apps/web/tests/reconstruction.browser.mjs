import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { StudyApp } from '../src/anatomy/study-app.tsx';
import { getCatalog, getWasm } from '../src/anatomy/core.ts';

// Run in Vite: (await import('/tests/reconstruction.browser.mjs')).checkStartupCamera()
export async function checkStartupCamera(reducedMotion = false) {
  const catalog = await getCatalog(), { AnatomyViewer } = await getWasm();
  const systems = catalog.targets.filter(target => !target.parent_id && target.model).length;
  const originals = [], locations = new WeakMap();
  let viewer, appended = 0, frames = 0, animationFrames = 0, drawing = false, matrix, firstMatrix, failure;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const wrap = (object, name, callback) => {
    const original = object[name];
    originals.push(() => { object[name] = original; });
    object[name] = function(...args) { return callback.call(this, original, args); };
  };
  const media = window.matchMedia.bind(window);
  wrap(window, 'matchMedia', function(original, [query]) {
    return query === '(prefers-reduced-motion: reduce)'
      ? media(reducedMotion ? '(min-width: 0px)' : '(min-width: 100000px)')
      : original.call(this, query);
  });
  wrap(WebGL2RenderingContext.prototype, 'getUniformLocation', function(original, args) {
    const location = original.apply(this, args);
    if (location) locations.set(location, args[1]);
    return location;
  });
  wrap(WebGL2RenderingContext.prototype, 'uniformMatrix4fv', function(original, args) {
    if (drawing && locations.get(args[0]) === 'view_projection') matrix = Array.from(args[2]);
    return original.apply(this, args);
  });
  wrap(AnatomyViewer, 'fromPrepared', function(original, args) {
    const result = original.apply(this, args);
    if (args[0].closest('#root') === document.getElementById('root')) viewer = result;
    return result;
  });
  wrap(AnatomyViewer.prototype, 'appendPrepared', function(original, args) {
    if (this !== viewer) return original.apply(this, args);
    assert(frames === 0, 'Adding a system after the first frame changes the startup camera');
    const result = original.apply(this, args);
    appended++;
    return result;
  });
  for (const name of ['render', 'render_reconstruction']) {
    wrap(AnatomyViewer.prototype, name, function(original, args) {
      if (this !== viewer) return original.apply(this, args);
      try {
        assert(appended === systems - 1, 'Frame shown before all systems have been framed');
        drawing = true;
        const result = original.apply(this, args);
        assert(matrix?.length === 16, 'Missing anatomy camera projection');
        firstMatrix ??= matrix;
        assert(matrix.every((value, i) => Math.abs(value - firstMatrix[i]) < 1e-6),
          'Camera must stay fixed throughout reconstruction');
        frames++;
        if (name === 'render_reconstruction') animationFrames++;
        return result;
      } catch (cause) { failure = cause; throw cause; }
      finally { drawing = false; }
    });
  }
  const previous = document.getElementById('root');
  previous.remove();
  const element = document.createElement('div');
  element.id = 'root'; document.body.append(element);
  const root = createRoot(element);
  let observer, timeout;
  try {
    const done = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(failure ?? Error(`Startup did not finish (${appended} appended, ${frames} frames): ${element.textContent}`)), 20000);
      observer = new MutationObserver(() => {
        if (element.querySelector('.model-error')) reject(failure ?? Error('Model loading failed'));
        else if (element.querySelector('.model-canvas[aria-busy="false"]')) resolve();
      });
      observer.observe(element, { childList: true, subtree: true, attributes: true });
    });
    root.render(createElement(StudyApp, { catalog }));
    await done;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    assert(frames > 0 && (reducedMotion ? animationFrames === 0 : animationFrames > 1),
      'Startup must render and respect the reduced motion preference');
    const expected = new Set(catalog.targets.flatMap(target => target.model?.structure_ids ?? []));
    assert(element.querySelector('.model-status').textContent === `${expected.size}/${expected.size} cấu trúc đang hiện`,
      'All structures must remain visible after startup');
    return { systems, frames, animationFrames, cameraStable: true, reducedMotion };
  } finally {
    clearTimeout(timeout); observer?.disconnect(); root.unmount(); element.remove();
    document.body.append(previous);
    for (const restore of originals.reverse()) restore();
  }
}
