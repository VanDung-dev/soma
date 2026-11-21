import assert from 'node:assert/strict';
import test from 'node:test';
import { LessonPackage, validate_lesson_file } from './lesson-wasm.fixture.mjs';

const encoder = new TextEncoder();
test('Rust rejects standalone JSON imports and invalid or oversized lesson packages', () => {
  const draft = { id: 'draft-json', version: 1, title: { vi: '', en: '' }, summary: { vi: '', en: '' }, modelId: '', steps: [] };
  assert.throws(() => LessonPackage.open('lesson.json', encoder.encode(JSON.stringify(draft))), /Invalid .lesson.br file/);
  assert.throws(() => LessonPackage.open('lesson.JSON', encoder.encode(JSON.stringify(draft))), /Invalid .lesson.br file/);
  assert.throws(() => LessonPackage.open('raw.lesson.br', encoder.encode(JSON.stringify(draft))));
  assert.throws(() => validate_lesson_file('lesson.txt', 1), /Invalid .lesson.br file/);
  for (const json of ['{', 'null', '{}', JSON.stringify({ ...draft, steps: [{ kind: 'unsupported' }] })]) {
    assert.throws(() => LessonPackage.open('lesson.json', encoder.encode(json)));
  }
  assert.throws(() => validate_lesson_file('large.json', 1), /Invalid .lesson.br file/);
  assert.throws(() => validate_lesson_file('large.lesson.br', 64 * 1024 * 1024 + 1), /64 MiB/);
  for (const size of [5 * 1024 ** 3, Infinity, NaN, -1, 1.5]) assert.throws(() => validate_lesson_file('large.lesson.br', size));
});
