import assert from 'node:assert/strict';
import test from 'node:test';
import { LessonPackage } from './lesson-wasm.fixture.mjs';
import { lessonMode, lessonQuestions, updateLessonQuestions, lessonPreviewIssues, lessonSceneStep, lessonText, readLesson, validateLessonTargets } from '../src/lessons/contract.ts';
import { lessonModels } from '../src/lessons/targets.ts';

const text = en => ({ vi: '', en });
const draft = { id: 'lesson-test', version: 1, title: text(''), summary: text(''), modelId: '', steps: [] };

test('multiple questions validate active modes and preserve inactive drafts and legacy answers', () => {
  const question = { id: 'question-one', prompt: text('Which part?'), choices: [
    { id: 'a', text: text('First') }, { id: 'b', text: text('Second') },
  ], answerId: 'b', explanation: text('Because it is second.') };
  const step = { id: 'quiz', kind: 'text', title: text('Quiz'), instruction: text(''), mode: 'questions', questions: [question, { ...question, id: 'question-two' }] };
  const lesson = { ...draft, title: text('Practice'), steps: [step] };
  assert.deepEqual(readLesson(lesson), lesson, 'Question-only steps need no instructions or model');
  const pack = new LessonPackage(JSON.stringify(lesson));
  try {
    const reopened = LessonPackage.open('questions.lesson.br', pack.export());
    try { assert.deepEqual(JSON.parse(reopened.lesson_json()), lesson); } finally { reopened.free(); }
  } finally { pack.free(); }
  for (const questions of [[], [question, question], [{ ...question, prompt: text('') }], [{ ...question, choices: question.choices.slice(0, 1) }],
    [{ ...question, choices: [question.choices[0], question.choices[0]] }], [{ ...question, answerId: 'missing' }], [{ ...question, choices: [{ ...question.choices[0], text: text('') }, question.choices[1]] }]]) {
    assert.throws(() => readLesson({ ...lesson, steps: [{ ...step, questions }] }));
  }
  assert.doesNotThrow(() => readLesson({ ...lesson, steps: [{ ...step, questions: [{ ...question, prompt: text(''), choices: [], answerId: '' }] }] }, true));
  for (const questions of [[question, question], [{ ...question, choices: [question.choices[0], question.choices[0]] }]]) {
    assert.throws(() => readLesson({ ...lesson, steps: [{ ...step, questions }] }, true));
  }
  for (const mode of ['both', null, false]) assert.throws(() => readLesson({ ...lesson, steps: [{ ...step, mode }] }, true));
  assert.throws(() => readLesson({ ...lesson, steps: [{ ...step, mode: 'content_questions' }] }), /instructions/);
  const inactive = { ...step, mode: 'content', instruction: text('Read'), questions: [{ ...question, prompt: text(''), choices: [], answerId: '' }] };
  assert.deepEqual(readLesson({ ...lesson, steps: [inactive] }).steps[0], inactive);
  const legacy = { ...step, kind: 'identify_structure', mode: undefined, questions: undefined, targetId: 'scene',
    choiceIds: ['a', 'b'], answerId: 'b', explanation: question.explanation };
  assert.equal(lessonMode(legacy), 'content_questions');
  const adapted = lessonQuestions(legacy, id => text(id));
  assert.equal(adapted[0].answerId, 'b');
  assert.deepEqual(adapted[0].choices.map(choice => choice.id), legacy.choiceIds);
  const converted = updateLessonQuestions(legacy, 'content', adapted);
  assert.equal(converted.kind, 'observe');
  assert.deepEqual(updateLessonQuestions(converted, 'questions', adapted).questions, adapted);
  assert.equal(converted.targetId, legacy.targetId);
});

test('lesson models include every system needed by setup and authored scenes without duplicating shared parts', () => {
  const catalog = { roots: [{ id: 'bones' }, { id: 'muscles' }, { id: 'joints' }],
    members: id => ({ bones: ['jaw'], muscles: ['masseter'], joints: ['jaw', 'joint'], head: ['jaw', 'masseter'] })[id] ?? [] };
  const lesson = { ...draft, modelId: 'bones', scene: { targetId: 'head' } };
  assert.deepEqual(lessonModels(catalog, lesson), ['bones', 'muscles']);
  assert.deepEqual(lessonModels(catalog, { ...lesson, steps: [{ kind: 'observe', targetId: 'joints', visibleIds: ['joint'] }] }), ['bones', 'muscles', 'joints']);
  assert.deepEqual(lessonModels(catalog, { ...lesson, scene: { targetId: 'bones', visibleIds: [] } }), ['bones']);
  assert.deepEqual(lessonModels(catalog, { ...lesson, modelIds: ['bones', 'joints'] }), ['bones', 'joints', 'muscles']);
  assert.deepEqual(lessonModels(catalog, { ...lesson, modelId: '', modelIds: [] }), []);
  assert.deepEqual(lessonModels(catalog, draft), []);
});

test('lesson setup preserves its scene before any steps exist and validates scene data', () => {
  const scene = { targetId: 'model', visibleIds: ['1'], view: {
    camera: { target: [0, 0, 0], yaw: 0, pitch: 0, distance: 4, pan: [0, 0] }, explosion: 20,
  } };
  const lesson = { ...draft, modelId: 'model', scene };
  assert.deepEqual(readLesson(JSON.parse(JSON.stringify(lesson)), true), lesson);
  const pack = new LessonPackage(JSON.stringify(lesson));
  try {
    const imported = LessonPackage.open('setup.lesson.br', pack.export());
    try { assert.deepEqual(JSON.parse(imported.lesson_json()), lesson); }
    finally { imported.free(); }
  } finally { pack.free(); }
  for (const invalid of [null, {}, { ...scene, visibleIds: ['1', '1'] }, { ...scene, view: { ...scene.view, explosion: 101 } }]) {
    assert.throws(() => readLesson({ ...lesson, scene: invalid }, true));
  }
});

test('rich lesson JSON keeps locale markers while legacy text remains unchanged', () => {
  const instruction = { vi: '<p><strong>Quan sát</strong> kỹ.</p>', en: 'Literal <b>text</b>', html: ['vi'] };
  const lesson = { ...draft, title: text('Rich content'), steps: [
    { id: 'read', kind: 'text', title: text('Read'), instruction },
  ] };
  assert.deepEqual(readLesson(JSON.parse(JSON.stringify(lesson))), lesson);
  for (const html of [true, 'vi', ['fr'], ['vi', 'vi'], [1]]) {
    assert.throws(() => readLesson({ ...lesson, steps: [{ ...lesson.steps[0], instruction: { ...instruction, html } }] }, true));
  }
  assert.throws(() => readLesson({ ...lesson, steps: [{ ...lesson.steps[0], instruction: { vi: '<p><br>&nbsp;</p>', en: '', html: ['vi'] } }] }), /needs a title/);
  assert.equal(readLesson(lesson).steps[0].instruction.en, 'Literal <b>text</b>');
  assert.doesNotThrow(() => readLesson({ ...lesson, steps: [{ ...lesson.steps[0], instruction: {
    vi: '<p><img src="images/' + 'a'.repeat(64) + '.png" alt=""></p>', en: '', html: ['vi'],
  } }] }));
});

test('authored views survive JSON serialization and reject invalid camera and explosion values', () => {
  const view = { camera: { target: [1, 2, 3], yaw: 1.2, pitch: -0.3, distance: 4, pan: [0.1, -0.2] }, explosion: 30 };
  const lesson = { ...draft, title: text('Scenes'), modelId: 'model', steps: [
    { id: 'view', kind: 'observe', title: text('Side view'), instruction: text('Rotate and explore'), targetId: 'model', visibleIds: ['1'], view },
  ] };
  assert.deepEqual(readLesson(JSON.parse(JSON.stringify(lesson))), lesson);
  for (const invalid of [null, {}, { ...view, extra: true }, { ...view, explosion: -1 }, { ...view, explosion: 101 }, { ...view, explosion: NaN },
    ...[{ yaw: Infinity }, { pitch: Math.PI }, { distance: 0 }, { distance: 1e-50 }, { target: [1, 2] }, { target: [0, NaN, 1] }, { pan: [0] }, { extra: true }].map(change => ({ ...view, camera: { ...view.camera, ...change } }))]) {
    for (const isDraft of [true, false]) assert.throws(() => readLesson({ ...lesson, steps: [{ ...lesson.steps[0], view: invalid }] }, isDraft), /needs a model/);
  }
  const legacy = { ...lesson, steps: [{ ...lesson.steps[0], view: undefined }] };
  assert.deepEqual(readLesson(JSON.parse(JSON.stringify(legacy))), JSON.parse(JSON.stringify(legacy)));
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

test('step visibility hides only the requested scene and retains its authored data', () => {
  const scene = { id: 'first', kind: 'observe', title: text('Read'), instruction: text('Notes'), targetId: 'model', visibleIds: ['1'] };
  const hidden = { ...scene, id: 'hidden', showModel: false };
  const lesson = { ...draft, modelId: 'model', steps: [scene, hidden, { ...scene, id: 'last' }] };
  assert.deepEqual(readLesson(lesson, true), lesson);
  assert.equal(lessonSceneStep(lesson, 0), scene);
  assert.equal(lessonSceneStep(lesson, 1), undefined);
  assert.equal(lessonSceneStep(lesson, 2), lesson.steps[2]);
  assert.deepEqual(hidden.visibleIds, ['1']);
  const textOnly = { ...lesson, title: text('Text lesson'), modelId: '', steps: [{ ...hidden, targetId: '', visibleIds: [] }] };
  assert.doesNotThrow(() => readLesson(textOnly));
  assert.doesNotThrow(() => validateLessonTargets(textOnly, [], () => []));
  for (const showModel of [null, 'false', 0]) assert.throws(() => readLesson({ ...lesson, steps: [{ ...scene, showModel }] }, true));
  assert.throws(() => readLesson({ ...lesson, steps: [{ ...hidden, kind: 'identify_structure', choiceIds: [], answerId: '', explanation: text('') }] }, true));
});

test('cover paths are validated independently of the plain summary', () => {
  const cover = 'images/' + 'a'.repeat(64) + '.webp';
  assert.deepEqual(readLesson({ ...draft, cover }, true).cover, cover);
  for (const invalid of [null, '', 'https://example.com/a.png', '../cover.png', 'images/x.svg']) {
    assert.throws(() => readLesson({ ...draft, cover: invalid }, true));
  }
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

test('draft validation preserves unfinished lessons while complete validation requires content', () => {
  assert.deepEqual(readLesson(draft, true), draft);
  assert.throws(() => readLesson(draft), /title and at least one step/);
  const lesson = {
    ...draft, title: text('Anatomy notes'),
    steps: [{ id: 'read', kind: 'text', title: text('Overview'), instruction: text('Read the notes.') }],
  };
  assert.equal(lessonText(lesson.title, 'vi'), 'Anatomy notes');
  assert.deepEqual(readLesson(JSON.parse(JSON.stringify(lesson))), lesson);
  validateLessonTargets(lesson, [], () => []);

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
  assert.deepEqual(readLesson(JSON.parse(JSON.stringify(lesson))), lesson);
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
