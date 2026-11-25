import { getCatalog } from '../src/core.ts';
import { StudySession } from '../src/viewer/session.ts';
import { ViewerRuntime } from '../src/viewer/runtime.ts';

// Run in Vite: (await import('/tests/viewer-runtime.browser.mjs')).checkViewerRuntime()
export async function checkViewerRuntime() {
  const catalog = await getCatalog();
  const root = catalog.roots.find(t => t.source_name === '1: Skeletal system');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const fixtures = [];
  let timeout;
  const create = async (cancelAfterFirst = false) => {
    const data = await getCatalog();
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-1000px;width:300px;height:400px';
    document.body.append(host);
    const session = new StudySession(data);
    const statuses = [];
    let ready, fail, updates = 0, updatesAtCancellation;
    const loaded = new Promise((resolve, reject) => { ready = resolve; fail = reject; });
    const runtime = new ViewerRuntime(host, { viewport: () => [0, 0, 1, 1],
      onPick: session.pick, onHide: ids => session.changeVisibility(ids, false), onState: patch => {
        updates++; session.updateViewer(patch);
        if (patch.status) statuses.push(patch.status);
        if (cancelAfterFirst && patch.loadedSystems === 1) { runtime.dispose(); updatesAtCancellation = updates; }
        if (patch.error) fail(Error(patch.status));
        else if (patch.building === false) ready();
      } });
    session.connect(runtime);
    const fixture = { catalog: data, host, session, runtime, loaded, statuses, updates: () => updates, updatesAtCancellation: () => updatesAtCancellation };
    fixtures.push(fixture); return fixture;
  };
  try {
    const first = await create(), second = await create();
    await Promise.race([
      Promise.all([first, second].map(async f => { await f.runtime.start(f.catalog, [root]); await f.loaded; })),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Independent viewer startup timed out')), 20000); }),
    ]);
    assert(first.host.querySelectorAll('canvas').length === 1 && second.host.querySelectorAll('canvas').length === 1,
      'Each host must own its own canvas without the study screen or CSS selectors');
    const ids = catalog.members(root.id);
    assert(first.session.getSnapshot().visibleIds.size === ids.length && second.session.getSnapshot().visibleIds.size === ids.length,
      'Both runtimes must load their own geometry');
    for (const fixture of [first, second]) {
      const ids = fixture.session.getSnapshot().structureIds;
      const expected = ids.map(id => fixture.catalog.detail(id)).sort((a, b) => a.names.vi.localeCompare(b.names.vi, 'vi') || a.source_object.localeCompare(b.source_object));
      assert(ids.every((id, index) => id === expected[index].source_id), 'Startup must preserve Vietnamese name order and source-object tie breaks');
    }
    for (const fixture of [first, second]) assert(JSON.stringify(fixture.statuses) === JSON.stringify(['loading', 'preparing', 'finishing']),
      'Viewer startup must publish status codes in source loading order');
    assert(first.session.changeVisibility(ids, false), 'The first runtime must accept visibility commands');
    assert(first.session.getSnapshot().visibleIds.size === 0 && second.session.getSnapshot().visibleIds.size === ids.length,
      'A command in one session must not affect the other');
    assert(first.session.applyScene(ids), 'Lesson scenes restore their own visibility');
    const initialView = first.session.captureView();
    first.session.control([{ kind: 'rotate', x: 0.7, y: -0.2 }, { kind: 'zoom', factor: 0.8 }, { kind: 'pan', x: 0.1, y: -0.1 }]);
    first.session.changeExplosion(30);
    const savedView = first.session.captureView();
    assert(savedView.explosion === 30 && savedView.camera.yaw !== initialView.camera.yaw, 'Capture preserves authored camera and exact explosion level');
    assert(first.session.applyScene(ids, savedView), 'Apply an authored view');
    const restoredView = first.session.captureView();
    assert(Math.abs(savedView.camera.distance - restoredView.camera.distance) < 1e-4
      && savedView.camera.yaw === restoredView.camera.yaw, 'Restoring the view must preserve zoom and orientation');
    first.session.applyScene(ids, initialView);
    first.session.applyScene(ids, savedView);
    first.session.applyScene(ids, initialView);
    first.session.control([{ kind: 'rotate', x: 0.2, y: 0 }]);
    const interrupted = first.session.captureView();
    assert(Math.abs(interrupted.camera.yaw - initialView.camera.yaw) > 0.01, 'Manual input cancels the pending authored camera transition');
    assert(interrupted.explosion === 0, 'Rapid step changes retain the latest explosion state');
    first.runtime.dispose();
    assert(!first.host.querySelector('canvas') && !first.session.control([{ kind: 'reset' }]),
      'Disposed runtimes must release their canvas and reject commands');
    assert(second.session.control([{ kind: 'reset' }]), 'The other runtime must remain usable');
    const cancelled = await create();
    const start = cancelled.runtime.start(cancelled.catalog, [root]);
    cancelled.runtime.dispose();
    const updates = cancelled.updates();
    await start;
    assert(!cancelled.host.querySelector('canvas') && cancelled.updates() === updates,
      'Unmount during initialization must not publish late state or recreate the canvas');
    const preparing = await create(true);
    await preparing.runtime.start(preparing.catalog, [root, catalog.roots.find(t => t !== root)]);
    assert(preparing.updatesAtCancellation() !== undefined && preparing.updates() === preparing.updatesAtCancellation()
      && !preparing.host.querySelector('canvas'), 'Cancellation between worker batches must stop preparation and late updates');
    return { independentHosts: true, independentSessions: true, authoredViews: true, rapidScenes: true, manualCameraInterrupt: true,
      disposal: true, cancelledStartup: true, cancelledPreparation: true };
  } finally {
    clearTimeout(timeout); catalog.free();
    for (const f of fixtures) { f.session.disconnect(f.runtime); f.runtime.dispose(); f.catalog.free(); f.host.remove(); }
  }
}
