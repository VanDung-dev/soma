import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { LessonPackage, lesson_image_info, restore_lesson_draft, split_lesson_draft } from './lesson-wasm.fixture.mjs';
import { packLessonTar, unpackLessonTar } from './lesson-package.fixture.mjs';

const encoder = new TextEncoder();
const image = new Uint8Array(readFileSync(new URL('../public/home/anatomy.png', import.meta.url)));
const info = lesson_image_info(image);
const draft = { id: '026317aafa166ceea1b3f9ee775c2c1e', version: 1, title: { vi: 'Học giải phẫu', en: 'Anatomy lesson' },
  summary: { vi: '', en: '' }, modelId: '', steps: [{ id: 'read', kind: 'text', title: { vi: '', en: '' },
    instruction: { vi: '<p><img src="' + info.path + '" alt=""></p>', en: '', html: ['vi'] } }] };

test('optional author survives package export and import and rejects non-text values', () => {
  for (const author of [undefined, 'Nguyễn An']) {
    const lesson = { ...draft, ...(author === undefined ? {} : { author }) };
    const pack = new LessonPackage(JSON.stringify(lesson));
    try {
      pack.add_image(info.path, image);
      const imported = LessonPackage.open('author.lesson.br', pack.export());
      try { assert.deepEqual(JSON.parse(imported.lesson_json()), lesson); }
      finally { imported.free(); }
    } finally { pack.free(); }
  }
  for (const author of [null, 42, { name: 'An' }]) {
    assert.throws(() => new LessonPackage(JSON.stringify({ ...draft, author })));
  }
});

test('question resources survive inactive modes and are required by portable packages', () => {
  const empty = { vi: '', en: '' };
  const rich = draft.steps[0].instruction;
  for (const field of ['prompt', 'explanation', 'choice']) {
    const question = { id: 'question', prompt: field === 'prompt' ? rich : empty,
      explanation: field === 'explanation' ? rich : empty, answerId: '',
      choices: [{ id: 'a', text: field === 'choice' ? rich : empty }] };
    const lesson = { ...draft, steps: [{ ...draft.steps[0], instruction: empty, mode: 'content', questions: [question] }] };
    const pack = new LessonPackage(JSON.stringify(lesson));
    try {
      assert.throws(() => pack.export(), /Missing lesson image/);
      pack.add_image(info.path, image);
      const imported = LessonPackage.open('questions.lesson.br', pack.export());
      try {
        assert.deepEqual(JSON.parse(imported.lesson_json()), lesson);
        assert.deepEqual(imported.image_bytes(info.path), image);
      } finally { imported.free(); }
    } finally { pack.free(); }
  }
});

test('question table preserves order and isolates damage by section', () => {
  const text = { vi: 'Câu hỏi', en: '' };
  const question = { id: 'quiz', prompt: text, explanation: text, answerId: 'a',
    choices: [{ id: 'a', text }, { id: 'b', text }] };
  const step = { id: 'first', kind: 'text', title: text, instruction: text,
    mode: 'content_questions', questions: [question, { ...question, id: 'second-question' }] };
  const lesson = { ...draft, modelId: 'bones', steps: [step, { ...step, id: 'second' },
    { ...step, id: 'observe', kind: 'observe', targetId: 'bones' }, { ...step, id: 'empty', mode: 'content', questions: [] }] };
  const [stored, records] = split_lesson_draft(JSON.stringify(lesson));
  const [first, second, observe] = JSON.parse(stored).steps;
  assert.equal(first.questions, undefined);
  assert.notEqual(first.questionRef, second.questionRef);
  assert.deepEqual(JSON.parse(restore_lesson_draft(stored, records)), lesson);

  const pack = new LessonPackage(JSON.stringify(lesson));
  try {
    const files = unpackLessonTar(brotliDecompressSync(pack.export()));
    const table = new TextDecoder().decode(files.get('questions.jsonl')).trimEnd().split('\n');
    assert.equal(JSON.parse(new TextDecoder().decode(files.get('lesson.json'))).steps[0].questionRef,
      first.questionRef);
    assert.deepEqual(table.map(JSON.parse).filter(row => row.section === 'first').map(row => row.record), step.questions);
    const reordered = new Map(files).set('questions.jsonl', encoder.encode([...table].reverse().join('\n') + '\n'));
    const ordered = LessonPackage.open('questions.lesson.br', brotliCompressSync(packLessonTar(reordered)));
    try { assert.deepEqual(JSON.parse(ordered.lesson_json()), lesson); }
    finally { ordered.free(); }
    for (const damage of ['', '{broken\n']) {
      const damaged = new Map(files);
      const line = table.findIndex(line => JSON.parse(line).section === 'first');
      const remaining = table.filter((_, index) => index !== line);
      damaged.set('questions.jsonl', encoder.encode(damage + remaining.join('\n') + '\n'));
      const recovered = LessonPackage.open('questions.lesson.br', brotliCompressSync(packLessonTar(damaged)));
      try {
        const restored = JSON.parse(recovered.lesson_json());
        const { questions, ...body } = step;
        assert.deepEqual(restored.steps[0], { ...body, questionRef: first.questionRef });
        assert.deepEqual(restored.steps.slice(1), lesson.steps.slice(1));
      } finally { recovered.free(); }
    }
    const missing = new Map(files);
    missing.delete('questions.jsonl');
    const withoutQuestions = LessonPackage.open('questions.lesson.br', brotliCompressSync(packLessonTar(missing)));
    try {
      const restored = JSON.parse(withoutQuestions.lesson_json());
      assert.equal(restored.steps[2].targetId, 'bones');
      assert.equal(restored.steps[2].questionRef, observe.questionRef);
    } finally { withoutQuestions.free(); }
  } finally { pack.free(); }

});

test('a cover is a required package resource even without rich text or steps', () => {
  const lesson = { ...draft, cover: info.path, steps: [] };
  const pack = new LessonPackage(JSON.stringify(lesson));
  try {
    assert.throws(() => pack.export(), /Missing lesson image/);
    pack.add_image(info.path, image);
    const files = unpackLessonTar(brotliDecompressSync(pack.export()));
    assert.deepEqual(files.get(info.path), image);
    const opened = LessonPackage.open('cover.lesson.br', pack.export());
    try { assert.deepEqual(JSON.parse(opened.lesson_json()), lesson); }
    finally { opened.free(); }
  } finally { pack.free(); }
});

test('Rust exports title.lesson.br with internal identity and lossless images, readable by independent Brotli/TAR code', () => {
  const pack = new LessonPackage(JSON.stringify(draft));
  try {
    pack.add_image(info.path, image);
    assert.equal(pack.file_name('vi'), 'Học giải phẫu.lesson.br');
    assert.equal(pack.file_name('en'), 'Anatomy lesson.lesson.br');
    const bytes = pack.export();
    const files = unpackLessonTar(brotliDecompressSync(bytes));
    const hash = createHash('sha256').update(draft.steps[0].instruction.vi).digest('hex');
    const stored = structuredClone(draft);
    stored.preloadModelIds = [];
    stored.steps[0].instruction.vi = `lesson-content:${hash}`;
    assert.deepEqual(JSON.parse(new TextDecoder().decode(files.get('lesson.json'))), stored);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(files.get('manifest.json'))), { format: 'soma-lesson', version: 6 });
    assert.equal([...files.keys()].some(path => path.startsWith('scenes/')), false);
    assert.deepEqual(files.get(`content/${hash}.html`), encoder.encode(draft.steps[0].instruction.vi));
    assert.deepEqual(files.get(info.path), image);
    const imported = LessonPackage.open('renamed.lesson.br', bytes);
    try { assert.deepEqual(JSON.parse(imported.lesson_json()), draft); assert.deepEqual(imported.image_bytes(info.path), image); }
    finally { imported.free(); }
    assert.throws(() => LessonPackage.open('content.game.br', bytes));
  } finally { pack.free(); }
});

test('Rust rejects missing resources, mismatched image hashes and malformed archives without producing a lesson', () => {
  const pack = new LessonPackage(JSON.stringify(draft));
  try {
    assert.throws(() => pack.export(), /Missing lesson image/);
    pack.add_image(info.path, image);
    const files = unpackLessonTar(brotliDecompressSync(pack.export()));
    for (const mutate of [
      files => files.delete(info.path),
      files => files.set(info.path, encoder.encode('<svg/>')),
      files => files.set('../lesson.json', encoder.encode('{}')),
      files => files.set('manifest.json', encoder.encode('{"format":"soma-game","version":1}')),
    ]) {
      const invalid = new Map(files); mutate(invalid);
      assert.throws(() => LessonPackage.open('invalid.lesson.br', brotliCompressSync(packLessonTar(invalid))));
    }
    assert.throws(() => LessonPackage.open('invalid.lesson.br', new Uint8Array([1, 2, 3])));
  } finally { pack.free(); }
});

test('Rust produces safe localized filenames while keeping the lesson ID unchanged', () => {
  for (const [title, language, expected] of [
    [{ vi: '', en: 'English fallback' }, 'vi', 'English fallback.lesson.br'],
    [{ vi: '', en: '' }, 'en', 'Untitled lesson.lesson.br'],
    [{ vi: 'CON', en: '' }, 'vi', '_CON.lesson.br'],
    [{ vi: ' ..Bài: học/1?*.. ', en: '' }, 'vi', 'Bài- học-1--.lesson.br'],
  ]) {
    const pack = new LessonPackage(JSON.stringify({ ...draft, title }));
    try { assert.equal(pack.file_name(language), expected); assert.equal(JSON.parse(pack.lesson_json()).id, draft.id); }
    finally { pack.free(); }
  }
});
