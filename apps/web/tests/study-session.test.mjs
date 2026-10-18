import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';

test('study commands share folder visibility policy independently of UI selection', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { StudySession } = await server.ssrLoadModule('/src/study/session.ts');
    const { indexCatalog, structureIds } = await server.ssrLoadModule('/src/catalog/index.ts');
    const catalog = JSON.parse(await readFile(new URL('../../../content/catalog.json', import.meta.url)));
    const index = indexCatalog(catalog);
    const roots = catalog.targets.filter(t => !t.parent_id && t.model);
    assert.deepEqual(index.roots.map(t => t.id), roots.map(t => t.id), 'Keep source loading order independent of tree display order');
    const root = roots[0], ids = structureIds(root);
    assert.deepEqual(ids, root.model.structure_ids, 'System operations must use display geometry membership');
    const meshes = [...new Set(roots.flatMap(t => t.model.structure_ids))].map(source_id => ({ source_id }));
    const calls = [];
    let succeeds = true;
    const viewer = {
      select: id => { calls.push(['select', id]); return succeeds; },
      changeVisibility: () => succeeds,
      focus: (...args) => { calls.push(['focus', ...args]); return succeeds; },
      setExplosion: (...args) => { calls.push(['explode', ...args]); return succeeds; },
      retargetExplosion: (...args) => { calls.push(['retarget', ...args]); },
      overview: () => succeeds,
      control: () => succeeds,
    };
    const session = new StudySession(catalog);
    session.connect(viewer); session.updateViewer({ meshes, building: false });
    let notifications = 0;
    const unsubscribe = session.subscribe(() => notifications++);
    session.updateViewer({ hovered: '' });
    assert.equal(notifications, 0, 'Unchanged renderer snapshots must not trigger UI updates');
    session.browseTarget(roots[1].id);
    assert(session.focus([], root.id));
    assert.deepEqual(calls.findLast(c => c[0] === 'focus'), ['focus', ids, true, false]);
    assert.deepEqual([...session.getSnapshot().visibleIds], ids);
    assert(session.changeVisibility([ids[0]], false));
    assert(session.focus([], root.id));
    assert.equal(calls.findLast(c => c[0] === 'focus')[3], true, 'Mixed checkbox needs a reveal even on a selected row');
    session.browseTarget(roots[1].id);
    assert(session.focus([], root.id));
    assert.equal(calls.findLast(c => c[0] === 'focus')[3], false, 'Checked checkbox skips reveal even on an unselected row');
    session.browseStructure(ids[0]);
    session.updateViewer({ hovered: ids[1] });
    assert.equal(session.getSnapshot().readingId, ids[0], 'Hover must not replace the article being read');
    session.changeExplosion(30);
    assert.deepEqual(calls.findLast(c => c[0] === 'explode'), ['explode', 30, [ids[0]]]);
    const before = session.getSnapshot();
    succeeds = false;
    assert.equal(session.changeVisibility(ids, false), false);
    assert.equal(session.focus([], roots[1].id), false);
    assert.equal(session.overview(), false);
    assert.equal(session.getSnapshot(), before, 'Failed viewer mutations must not commit study state');
    succeeds = true;
    assert(session.overview());
    assert.equal(session.getSnapshot().visibleIds.size, meshes.length);
    assert.equal(session.getSnapshot().readingId, '');
    assert.equal(session.getSnapshot().explosionAmount, 0);
    unsubscribe();
    const otherSession = new StudySession(catalog);
    otherSession.connect(viewer); otherSession.updateViewer({ meshes, building: false });
    session.changeVisibility(ids, false);
    assert(otherSession.getSnapshot().visibleIds.has(ids[0]), 'Viewer sessions must not share mutable visibility state');
    const replacement = { ...viewer, control: () => false };
    session.connect(replacement); session.disconnect(viewer);
    assert.equal(session.control([{ kind: 'reset' }]), false, 'An old cleanup must not disconnect the replacement viewer');
  } finally { await server.close(); }
});

test('model metadata validation preserves identities and rejects malformed or mismatched packages', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { validateMetadata } = await server.ssrLoadModule('/src/viewer/loader.ts');
    const metadata = JSON.parse(await readFile(new URL('../public/models/z-anatomy/skeletal-system.json', import.meta.url)));
    const ids = metadata.structures.map(s => s.source_id);
    const before = JSON.stringify(metadata);
    assert.equal(validateMetadata(metadata, ids.slice().reverse()), metadata.structures);
    assert.equal(JSON.stringify(metadata), before);
    for (const invalid of [null, {}, { structures: [] }, { structures: [null] },
      { structures: [metadata.structures[0], metadata.structures[0]] },
      { structures: [{ ...metadata.structures[0], collections: [123] }] }]) {
      assert.throws(() => validateMetadata(invalid, ids), /Metadata không hợp lệ/);
    }
    assert.throws(() => validateMetadata(metadata, ids.slice(1)), /Metadata không khớp catalog/);
  } finally { await server.close(); }
});
