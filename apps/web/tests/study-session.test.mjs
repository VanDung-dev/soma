import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';

test('manual movement blocks automatic explosion and preserves study navigation', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { StudySession } = await server.ssrLoadModule('/src/study/session.ts');
    const catalog = JSON.parse(await readFile(new URL('../../../content/catalog.json', import.meta.url)));
    const session = new StudySession(catalog), calls = [];
    const id = catalog.targets.find(target => target.model).model.structure_ids[0];
    session.connect({ setMoving: id => { calls.push(['move', id]); return true; },
      restoreStructure: id => { calls.push(['restore', id]); return true; },
      setExplosion: value => { calls.push(['explode', value]); return true; } });
    session.updateViewer({ meshes: [{ source_id: id }], building: false });
    assert.equal(session.setMoving('missing'), false);
    session.changeExplosion(30);
    assert.equal(session.setMoving(id), false);
    session.changeExplosion(0);
    assert.equal(session.setMoving(id), false, 'A visible structure must be selected before entering movement mode');
    session.updateViewer({ selected: id });
    assert(session.setMoving(id));
    session.updateViewer({ movingId: id, separatedIds: new Set([id]) });
    const before = session.getSnapshot();
    session.changeExplosion(60);
    assert.equal(session.getSnapshot(), before);
    assert.equal(calls.at(-1)[0], 'move');
    assert(session.restoreStructure(id));
    assert.equal(session.getSnapshot().canGoBack, false);
    assert.equal(session.getSnapshot().readingId, '');
  } finally { await server.close(); }
});

test('reader panel toggles at all times while reference reading remains limited to moving or separated structures', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { StudySession } = await server.ssrLoadModule('/src/study/session.ts');
    const catalog = JSON.parse(await readFile(new URL('../../../content/catalog.json', import.meta.url)));
    const session = new StudySession(catalog);
    const [a, b] = catalog.targets.find(target => target.model).model.structure_ids;
    session.connect({ select: () => true, retargetExplosion() {} });
    session.pick(a); session.toggleReader();
    assert.equal(session.getSnapshot().readerExpanded, true, 'The information panel can expand without a reference article');
    session.toggleReader();
    session.updateViewer({ movingId: a }); session.toggleReader();
    assert.equal(session.getSnapshot().readerExpanded, true, 'Enabling separation permits reading before the first drag');
    session.pick(b);
    assert.equal(session.getSnapshot().readerExpanded, false, 'Selecting an ordinary structure closes the reader');
    session.toggleReader(); assert.equal(session.getSnapshot().readerExpanded, true, 'The panel remains expandable without a reference article');
    session.toggleReader();
    session.updateViewer({ movingId: '', separatedIds: new Set([a]) });
    session.browseStructure(a); session.toggleReader();
    assert.equal(session.getSnapshot().readerExpanded, true, 'A displaced structure remains readable after finishing movement');
    session.updateViewer({ separatedIds: new Set() });
    assert.equal(session.getSnapshot().readerExpanded, false, 'Restoring the last position closes the reader');
    session.toggleReader(); assert.equal(session.getSnapshot().readerExpanded, true, 'The panel can still expand when reading is unavailable');
  } finally { await server.close(); }
});

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

test('Back and Forward follow anatomy navigation without recording hover or manual camera controls', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { StudySession } = await server.ssrLoadModule('/src/study/session.ts');
    const catalog = JSON.parse(await readFile(new URL('../../../content/catalog.json', import.meta.url)));
    const roots = catalog.targets.filter(target => !target.parent_id && target.model);
    const meshes = [...new Set(roots.flatMap(target => target.model.structure_ids))].map(source_id => ({ source_id }));
    let succeeds = true;
    const calls = [];
    const viewer = {
      select: id => { calls.push(['select', id]); return succeeds; },
      focus: (...args) => { calls.push(['focus', ...args]); return succeeds; },
      overview: () => { calls.push(['overview']); return succeeds; },
      changeVisibility: () => succeeds, setExplosion: () => succeeds, retargetExplosion() {}, control: () => true,
    };
    const session = new StudySession(catalog);
    session.connect(viewer); session.updateViewer({ meshes, building: false });
    assert.equal(session.back(), false);
    assert.equal(session.forward(), false);
    assert.equal(session.getSnapshot().canGoBack, false);
    assert.equal(session.getSnapshot().canGoForward, false);
    session.browseTarget(roots[0].id);
    session.browseTarget(roots[0].id);
    session.updateViewer({ hovered: meshes[0].source_id });
    session.changeExplosion(20);
    session.control([{ kind: 'zoom', factor: 1.1 }]);
    assert(session.back());
    assert.equal(session.getSnapshot().targetId, undefined);
    assert.equal(session.getSnapshot().canGoBack, false, 'Repeated selection and non-navigation actions must not add steps');
    assert(session.forward());
    assert.equal(session.getSnapshot().targetId, roots[0].id);
    const id = roots[0].model.structure_ids[0];
    session.browseStructure(id);
    session.focus([id]);
    session.pick(id);
    assert(session.back());
    assert.equal(session.getSnapshot().targetId, roots[0].id, 'Selection followed by focus is one destination');
    assert(session.forward());
    assert.deepEqual(session.getSnapshot().focusedIds, [id], 'Forward must replay the structure focus');
    assert.deepEqual(calls.findLast(call => call[0] === 'focus'), ['focus', [id], false, false]);
    assert.equal(session.getSnapshot().reveal.id, id);
    assert(session.focus([], roots[1].id));
    assert(session.back());
    assert(session.forward());
    assert.equal(session.getSnapshot().targetId, roots[1].id);
    assert.deepEqual(session.getSnapshot().focusedIds, roots[1].model.structure_ids, 'Restore focused system membership');
    assert(session.back());
    assert.equal(session.getSnapshot().canGoForward, true);
    session.browseTarget(roots[2].id);
    assert.equal(session.getSnapshot().canGoForward, false, 'A new destination truncates the forward branch');
    assert.equal(session.forward(), false);
    const before = session.getSnapshot();
    succeeds = false;
    assert.equal(session.back(), false);
    assert.equal(session.browseStructure(meshes[1].source_id), false);
    assert.equal(session.browseTarget(roots[3].id), false);
    assert.equal(session.getSnapshot(), before, 'Failed navigation must not move history or commit state');
    succeeds = true;
    assert(session.back());
    assert.equal(session.getSnapshot().readingId, id);
    assert(session.forward());
    assert.equal(session.getSnapshot().targetId, roots[2].id);
    const other = new StudySession(catalog);
    assert.equal(other.getSnapshot().canGoBack, false, 'Navigation history belongs to one session');
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
