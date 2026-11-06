import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('lesson files import raw editable JSON, including drafts, while rejecting malformed or oversized files', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { importLesson } = await server.ssrLoadModule('/src/lessons/source.ts');
    const draft = { id: 'draft-json', version: 1, title: { vi: '', en: '' }, summary: { vi: '', en: '' }, modelId: '', steps: [] };
    assert.deepEqual(await importLesson(new File([JSON.stringify(draft, null, 2)], 'lesson.json')), draft);
    for (const content of ['{', 'null', '{}', JSON.stringify({ ...draft, steps: [{ kind: 'unsupported' }] })]) {
      await assert.rejects(() => importLesson(new File([content], 'lesson.json')));
    }
    await assert.rejects(() => importLesson(new File([' '.repeat(512 * 1024 + 1)], 'large.json')), /512 KiB/);
  } finally { await server.close(); }
});
