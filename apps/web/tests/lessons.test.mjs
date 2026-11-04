import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import { lessonText, readLesson, validateLessonTargets } from '../src/lessons/contract.ts';
import { packLesson, unpackLesson } from '../src/lessons/jsoma.ts';

const text = en => ({ vi: '', en });
const draft = { id: 'lesson-test', version: 1, title: text(''), summary: text(''), modelId: '', steps: [] };

test('incomplete drafts can be saved and only complete lessons can be shared', () => {
  assert.deepEqual(readLesson(draft, true), draft);
  assert.throws(() => readLesson(draft), /title and at least one step/);
  const lesson = {
    ...draft, title: text('Anatomy notes'),
    steps: [{ id: 'read', kind: 'text', title: text('Overview'), instruction: text('Read the notes.') }],
  };
  assert.equal(lessonText(lesson.title, 'vi'), 'Anatomy notes');
  const bytes = packLesson(readLesson(lesson));
  assert.deepEqual(readLesson(unpackLesson(bytes)), lesson);
  validateLessonTargets(lesson, [], () => []);
  const files = unzipSync(bytes);
  files['content.json'][0] ^= 1;
  assert.throws(() => unpackLesson(zipSync(files)), /checksum mismatch/);
});

test('an exercise must have distinct selectable structures inside its visible target', () => {
  const lesson = {
    ...draft, title: text('Practice'), modelId: 'model',
    steps: [{ id: 'identify', kind: 'identify_structure', title: text('Identify'), instruction: text('Pick a part.'),
      targetId: 'scene', answerId: 'a', choiceIds: ['a', 'b'], explanation: text('') }],
  };
  assert.deepEqual(readLesson(lesson), lesson);
  const members = { scene: ['1', '2'], a: ['1'], b: ['2'] };
  validateLessonTargets(lesson, ['1', '2'], id => members[id]);
  assert.throws(() => validateLessonTargets(lesson, ['1'], id => members[id]), /unavailable structure/);
  assert.throws(() => validateLessonTargets(lesson, ['1', '2'], id => id === 'b' ? ['1'] : members[id]), /cannot overlap/);
});
