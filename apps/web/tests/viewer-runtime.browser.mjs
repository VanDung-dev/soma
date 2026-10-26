import { getCatalog } from '../src/anatomy/core.ts';
import { StudySession } from '../src/anatomy/study/session.ts';
import { ViewerRuntime } from '../src/anatomy/viewer/runtime.ts';

// Run in Vite: (await import('/tests/viewer-runtime.browser.mjs')).checkViewerRuntime()
export async function checkViewerRuntime() {
  const catalog = await getCatalog();
  const root = catalog.targets.find(t => t.model?.path.endsWith('skeletal-system.glb'));
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const fixtures = [];
  let timeout;
  const create = (cancelAfterFirst = false) => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-1000px;width:300px;height:400px';
    document.body.append(host);
    const session = new StudySession(catalog);
    const statuses = [];
    let ready, fail, updates = 0, updatesAtCancellation;
    const loaded = new Promise((resolve, reject) => { ready = resolve; fail = reject; });
    const runtime = new ViewerRuntime(host, { viewport: () => [0, 0, 1, 1],
      onPick: session.pick, onState: patch => {
        updates++; session.updateViewer(patch);
        if (patch.status) statuses.push(patch.status);
        if (cancelAfterFirst && patch.loadedSystems === 1) { runtime.dispose(); updatesAtCancellation = updates; }
        if (patch.error) fail(Error(patch.status));
        else if (patch.building === false) ready();
      } });
    session.connect(runtime);
    const fixture = { host, session, runtime, loaded, statuses, updates: () => updates, updatesAtCancellation: () => updatesAtCancellation };
    fixtures.push(fixture); return fixture;
  };
  try {
    const first = create(), second = create();
    await Promise.race([
      Promise.all([first, second].map(async f => { await f.runtime.start([root]); await f.loaded; })),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Independent viewer startup timed out')), 20000); }),
    ]);
    assert(first.host.querySelectorAll('canvas').length === 1 && second.host.querySelectorAll('canvas').length === 1,
      'Each host must own its own canvas without the study screen or CSS selectors');
    const ids = root.model.structure_ids;
    assert(first.session.getSnapshot().visibleIds.size === ids.length && second.session.getSnapshot().visibleIds.size === ids.length,
      'Both runtimes must load their own geometry');
    for (const fixture of [first, second]) assert(JSON.stringify(fixture.statuses) === JSON.stringify(['loading', 'preparing', 'finishing']),
      'Viewer startup must publish status codes in source loading order');
    assert(first.session.changeVisibility(ids, false), 'The first runtime must accept visibility commands');
    assert(first.session.getSnapshot().visibleIds.size === 0 && second.session.getSnapshot().visibleIds.size === ids.length,
      'A command in one session must not affect the other');
    first.runtime.dispose();
    assert(!first.host.querySelector('canvas') && !first.session.control([{ kind: 'reset' }]),
      'Disposed runtimes must release their canvas and reject commands');
    assert(second.session.control([{ kind: 'reset' }]), 'The other runtime must remain usable');
    const cancelled = create();
    const start = cancelled.runtime.start([root]);
    cancelled.runtime.dispose();
    const updates = cancelled.updates();
    await start;
    assert(!cancelled.host.querySelector('canvas') && cancelled.updates() === updates,
      'Unmount during initialization must not publish late state or recreate the canvas');
    const preparing = create(true);
    await preparing.runtime.start([root, catalog.targets.find(t => t.model && t !== root)]);
    assert(preparing.updatesAtCancellation() !== undefined && preparing.updates() === preparing.updatesAtCancellation()
      && !preparing.host.querySelector('canvas'), 'Cancellation between worker batches must stop preparation and late updates');
    return { independentHosts: true, independentSessions: true, disposal: true, cancelledStartup: true, cancelledPreparation: true };
  } finally {
    clearTimeout(timeout);
    for (const f of fixtures) { f.session.disconnect(f.runtime); f.runtime.dispose(); f.host.remove(); }
  }
}
