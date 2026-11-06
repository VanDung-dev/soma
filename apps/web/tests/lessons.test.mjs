import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import { lessonPreviewIssues, lessonSceneStep, lessonText, readLesson, validateLessonTargets } from '../src/lessons/contract.ts';
import { packLesson, unpackLesson } from '../src/lessons/jsoma.ts';

const text = en => ({ vi: '', en });
const draft = { id: 'lesson-test', version: 1, title: text(''), summary: text(''), modelId: '', steps: [] };

test('authored views survive JSoma export and reject invalid camera and explosion values', () => {
  const view = { camera: { target: [1, 2, 3], yaw: 1.2, pitch: -0.3, distance: 4, pan: [0.1, -0.2] }, explosion: 30 };
  const lesson = { ...draft, title: text('Scenes'), modelId: 'model', steps: [
    { id: 'view', kind: 'observe', title: text('Side view'), instruction: text('Rotate and explore'), targetId: 'model', visibleIds: ['1'], view },
  ] };
  assert.deepEqual(readLesson(unpackLesson(packLesson(readLesson(lesson)))), lesson);
  const manifest = JSON.parse(new TextDecoder().decode(unzipSync(packLesson(lesson))['manifest.json']));
  assert.equal(manifest.formatVersion, 2);
  for (const invalid of [null, {}, { ...view, extra: true }, { ...view, explosion: -1 }, { ...view, explosion: 101 }, { ...view, explosion: NaN },
    ...[{ yaw: Infinity }, { pitch: Math.PI }, { distance: 0 }, { distance: 1e-50 }, { target: [1, 2] }, { target: [0, NaN, 1] }, { pan: [0] }, { extra: true }].map(change => ({ ...view, camera: { ...view.camera, ...change } }))]) {
    for (const isDraft of [true, false]) assert.throws(() => readLesson({ ...lesson, steps: [{ ...lesson.steps[0], view: invalid }] }, isDraft), /needs a model/);
  }
  const legacy = { ...lesson, steps: [{ ...lesson.steps[0], view: undefined }] };
  assert.equal(JSON.parse(new TextDecoder().decode(unzipSync(packLesson(legacy))['manifest.json'])).formatVersion, 1);
  assert.deepEqual(readLesson(unpackLesson(packLesson(legacy))), JSON.parse(JSON.stringify(legacy)));
});

test('reading sections inherit the preceding scene with a stable initial fallback', () => {
  const intro = { id: 'intro', kind: 'text' };
  const skull = { id: 'skull', kind: 'observe', targetId: 'skull', visibleIds: ['1', '2'] };
  const notes = { id: 'notes', kind: 'text' };
  const quiz = { id: 'quiz', kind: 'identify_structure', targetId: 'jaw' };
  const summary = { id: 'summary', kind: 'text' };
  const lesson = { ...draft, steps: [intro, skull, notes, quiz, summary] };
  assert.equal(lessonSceneStep(lesson, 0), skull);
  assert.equal(lessonSceneStep(lesson, 4), quiz);
  assert.equal(lessonSceneStep(lesson, 2), skull, 'Jumping back must not inherit the last visited quiz');
  assert.equal(lessonSceneStep(lesson, 1), skull);
  assert.equal(lessonSceneStep({ ...draft, steps: [intro, notes] }, 1), undefined);
});

test('draft preview identifies unfinished sections without changing content or export validation', () => {
  const lesson = { ...draft, title: text('Draft'), steps: [
    { id: 'read', kind: 'text', title: text('Read'), instruction: text('Notes') },
    { id: 'observe', kind: 'observe', title: text(''), instruction: text(''), targetId: '' },
    { id: 'quiz', kind: 'identify_structure', title: text('Quiz'), instruction: text('Pick'), targetId: '', choiceIds: [], answerId: '', explanation: text('') },
  ] };
  const original = structuredClone(lesson);
  const issues = lessonPreviewIssues(lesson, [], () => []);
  assert.equal(issues.has('read'), false);
  assert.equal(issues.get('observe').reason, 'stepText');
  assert.equal(issues.get('observe').step, 2);
  assert.equal(issues.get('quiz').reason, 'target');
  assert.deepEqual(lesson, original);
  assert.throws(() => readLesson(lesson), /needs a title and instructions/);
  assert.deepEqual([...lessonPreviewIssues(draft, [], () => [])], []);
});

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

test('custom scenes persist exact model members and bound exercise choices', () => {
  const lesson = {
    ...draft, title: text('Custom skull'), modelId: 'model',
    steps: [{ id: 'observe', kind: 'observe', title: text('Head'), instruction: text('Explore.'),
      targetId: 'skull', visibleIds: ['1', '2', 'jaw'] }],
  };
  const members = { skull: ['1', '2'], a: ['1'], b: ['jaw'], otherModel: ['elsewhere'] };
  const validate = value => validateLessonTargets(value, ['1', '2', 'jaw'], id => members[id] ?? []);
  validate(readLesson(lesson));
  assert.throws(() => validate({ ...lesson, steps: [{ ...lesson.steps[0], targetId: 'otherModel' }] }), /unavailable structure/);
  assert.deepEqual(readLesson(unpackLesson(packLesson(lesson))), lesson);
  for (const visibleIds of [null, '1', [1], ['1', '1']]) {
    assert.throws(() => readLesson({ ...lesson, steps: [{ ...lesson.steps[0], visibleIds }] }), /needs a model/);
  }
  for (const visibleIds of [[], ['missing']]) {
    const value = { ...lesson, steps: [{ ...lesson.steps[0], visibleIds }] };
    assert.deepEqual(readLesson(value, true), value);
    assert.throws(() => validate(value), /unavailable structure/);
  }
  const exercise = { ...lesson, steps: [{ ...lesson.steps[0], kind: 'identify_structure',
    choiceIds: ['a', 'b'], answerId: 'b', explanation: text('') }] };
  validate(readLesson(exercise));
  assert.throws(() => validate({ ...exercise, steps: [{ ...exercise.steps[0], visibleIds: ['1', '2'] }] }), /cannot overlap/);
});
