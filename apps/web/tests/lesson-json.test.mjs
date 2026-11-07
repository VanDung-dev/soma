import assert from 'node:assert/strict';
import test from 'node:test';
import { LessonPackage, validate_lesson_file } from './lesson-wasm.fixture.mjs';

const encoder = new TextEncoder();
test('Rust imports raw editable JSON drafts and rejects malformed or oversized files', () => {
  const draft = { id: 'draft-json', version: 1, title: { vi: '', en: '' }, summary: { vi: '', en: '' }, modelId: '', steps: [] };
  const pack = LessonPackage.open('lesson.json', encoder.encode(JSON.stringify(draft)));
  try { assert.deepEqual(JSON.parse(pack.lesson_json()), draft); }
  finally { pack.free(); }
  assert.throws(() => validate_lesson_file('lesson.txt', 1), /Invalid .lesson.br file/);
  for (const json of ['{', 'null', '{}', JSON.stringify({ ...draft, steps: [{ kind: 'unsupported' }] })]) {
    assert.throws(() => LessonPackage.open('lesson.json', encoder.encode(json)));
  }
  assert.throws(() => validate_lesson_file('large.json', 2 * 1024 * 1024 + 1), /2 MiB/);
  for (const size of [5 * 1024 ** 3, Infinity, NaN, -1, 1.5]) assert.throws(() => validate_lesson_file('large.lesson.br', size));
});
