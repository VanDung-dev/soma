import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('restoring a saved scene preserves the current section content and questions', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { restoreSavedScene } = await server.ssrLoadModule('/src/lessons/editor/saved-scene.ts');
    const current = { id: 'step', kind: 'observe', title: { vi: 'Đã sửa', en: '' }, instruction: { vi: '', en: '' },
      targetId: 'changed', modelIds: ['changed'], visibleIds: ['changed'], view: { explosion: 75 }, questions: [{ id: 'quiz', choices: [{ id: 'a' }, { id: 'b' }], answerId: 'a' }] };
    const saved = { targetId: 'saved', visibleIds: ['a'], view: { explosion: 10 } };
    const restored = restoreSavedScene(current, saved, ['model']);
    assert.deepEqual({ targetId: restored.targetId, modelIds: restored.modelIds, visibleIds: restored.visibleIds, view: restored.view },
      { targetId: 'saved', modelIds: ['model'], visibleIds: ['a'], view: { explosion: 10 } });
    assert.equal(restored.title.vi, 'Đã sửa');
    assert.deepEqual(restored.questions, current.questions);
    const empty = restoreSavedScene(current, undefined, []);
    assert.deepEqual(empty.modelIds, []);
    assert.equal(empty.targetId, '');
    assert.equal(empty.visibleIds, undefined);
    assert.equal(empty.view, undefined);
  } finally { await server.close(); }
});
