import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { LessonPackage, lesson_image_info } from './lesson-wasm.fixture.mjs';
import { packLessonTar, unpackLessonTar } from './lesson-package.fixture.mjs';

const encoder = new TextEncoder();
const image = new Uint8Array(readFileSync(new URL('../public/home/anatomy.png', import.meta.url)));
const info = lesson_image_info(image);
const draft = { id: '026317aafa166ceea1b3f9ee775c2c1e', version: 1, title: { vi: 'Học giải phẫu', en: 'Anatomy lesson' },
  summary: { vi: '', en: '' }, modelId: '', steps: [{ id: 'read', kind: 'text', title: { vi: '', en: '' },
    instruction: { vi: '<p><img src="' + info.path + '" alt=""></p>', en: '', html: ['vi'] } }] };

test('Rust exports title.lesson.br with internal identity and lossless images, readable by independent Brotli/TAR code', () => {
  const pack = new LessonPackage(JSON.stringify(draft));
  try {
    pack.add_image(info.path, image);
    assert.equal(pack.file_name('vi'), 'Học giải phẫu.lesson.br');
    assert.equal(pack.file_name('en'), 'Anatomy lesson.lesson.br');
    const bytes = pack.export();
    const files = unpackLessonTar(brotliDecompressSync(bytes));
    assert.deepEqual(JSON.parse(new TextDecoder().decode(files.get('lesson.json'))), draft);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(files.get('manifest.json'))), { format: 'soma-lesson', version: 1 });
    assert.deepEqual(files.get(info.path), image);
    for (const filename of ['renamed.lesson.br', 'old.soma.br']) {
      const imported = LessonPackage.open(filename, bytes);
      try { assert.deepEqual(JSON.parse(imported.lesson_json()), draft); assert.deepEqual(imported.image_bytes(info.path), image); }
      finally { imported.free(); }
    }
    files.set('manifest.json', encoder.encode('{"format":"soma","version":1}'));
    const legacy = LessonPackage.open('legacy.soma.br', brotliCompressSync(packLessonTar(files)));
    try { assert.equal(JSON.parse(legacy.lesson_json()).id, draft.id); }
    finally { legacy.free(); }
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
