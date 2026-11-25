import { getWasm } from '../src/core.ts';

export async function monitorViewerResize() {
  const { AnatomyViewer } = await getWasm(), proto = AnatomyViewer.prototype;
  const host = document.querySelector('.model-canvas'), canvas = host.querySelector('canvas');
  if (host.getAttribute('aria-busy') !== 'false') throw Error('Wait for model loading to finish');
  const originals = new Map();
  let unpainted = false, resizes = 0, emptyFrames = 0, observations = 0, loads = 0;
  const wrap = (owner, name, after) => {
    const original = owner[name];
    originals.set(name, { owner, original });
    owner[name] = function(...args) {
      const result = original.apply(this, args);
      after();
      return result;
    };
  };
  wrap(proto, 'resize', () => { unpainted = true; resizes++; });
  for (const method of ['render', 'render_reconstruction', 'render_explosion']) wrap(proto, method, () => { unpainted = false; });
  for (const method of ['appendPrepared', 'start_reconstruction']) wrap(proto, method, () => { loads++; });
  wrap(AnatomyViewer, 'fromPrepared', () => { loads++; });
  const observer = new ResizeObserver(() => {
    observations++;
    if (unpainted) emptyFrames++;
  });
  observer.observe(host);
  return {
    snapshot: () => ({ resizes, emptyFrames, observations, loads,
      sameCanvas: host.querySelector('canvas') === canvas,
      healthy: !document.querySelector('.model-error') && host.getAttribute('aria-busy') === 'false' }),
    stop: () => {
      observer.disconnect();
      for (const [name, { owner, original }] of originals) owner[name] = original;
    },
  };
}
