import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogData, LessonPackage } from './lesson-wasm.fixture.mjs';
import { Catalog } from '../src/catalog/index.ts';
import { lessonLanguageTag, lessonMode, updateLessonQuestions, lessonPreviewIssues, lessonSceneStep, lessonText, readLesson, validateLessonTargets } from '../src/lessons/shared/contract.ts';

const text = en => ({ vi: '', en });
const draft = { id: 'lesson-test', version: 1, title: text(''), summary: text(''), modelId: '', steps: [] };

test('multiple questions validate active modes and preserve inactive drafts', () => {
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
  assert.equal(lessonMode(inactive), 'content');
  assert.deepEqual(updateLessonQuestions(inactive, 'questions', [question]).questions, [question]);

});

test('lesson models include every system needed by setup and authored scenes without duplicating shared parts', () => {
  const [jaw, masseter, joint] = ['za:0000000000000001', 'za:0000000000000002', 'za:0000000000000003'];
  const target = (id, group, structure_ids, parent_id) => ({ id, title: id, source_name: id, group_id: `${group}-group`, structure_ids, parent_id });
  const root = (id, ids, structureIds = ids) => ({ ...target(id, id, structureIds),
    model: { path: `models/z-anatomy/${id}.glb`, scope: id, structure_ids: ids } });
  const data = CatalogData.from_json(JSON.stringify({ schema_version: 1,
    groups: ['bones', 'muscles', 'joints'].map(id => ({ id: `${id}-group`, title: id })),
    targets: [root('bones', [jaw], [jaw, masseter]), root('muscles', [masseter]), root('joints', [jaw, joint]),
      target('head', 'bones', [jaw, masseter], 'bones'), target('skull', 'bones', [jaw], 'head'),
      target('empty', 'bones', [], 'bones'), target('jaw', 'bones', [jaw], 'bones')],
  }));
  const catalog = new Catalog(data);
  try {
    const lesson = { ...draft, modelId: 'bones', scene: { targetId: 'head' } };
    assert.deepEqual(catalog.lessonModels(lesson), ['bones', 'muscles']);
    assert.deepEqual(catalog.lessonModels({ ...lesson, steps: [{ kind: 'observe', targetId: 'joints', visibleIds: [joint] }] }), ['bones', 'muscles', 'joints']);
    assert.deepEqual(catalog.lessonModels({ ...lesson, scene: { targetId: 'head', visibleIds: [] } }), ['bones']);
    assert.deepEqual(catalog.lessonModels({ ...lesson, modelIds: ['bones', 'joints'] }), ['bones', 'joints', 'muscles']);
    assert.deepEqual(catalog.lessonModels({ ...lesson, preloadModelIds: ['joints', 'bones'] }), ['joints', 'bones', 'muscles']);
    assert.deepEqual(catalog.lessonModels({ ...lesson, modelId: '', modelIds: [], scene: undefined }), []);
    assert.deepEqual(catalog.lessonModels({ ...draft, steps: [{ kind: 'text', targetId: 'joints', visibleIds: 3 }] }), []);
    assert.deepEqual(catalog.lessonModels(draft), []);
    assert.deepEqual(catalog.lessonSceneModels(lesson, { targetId: 'head', modelIds: [] }), []);
    assert.deepEqual(catalog.lessonSceneModels(lesson, { targetId: 'head', modelIds: ['joints'] }), ['joints']);
    assert.deepEqual(catalog.lessonSceneVisibleIds(lesson.scene), [jaw, masseter]);
    assert.deepEqual(catalog.lessonSceneVisibleIds({ targetId: 'head', visibleIds: [] }), []);
    assert.deepEqual(catalog.lessonSceneVisibleIds(), []);
    assert.deepEqual(catalog.lessonTargets(['joints', 'bones', 'head', 'missing']).map(target => target.id),
      ['joints', 'bones', 'head', 'jaw', 'skull']);
    assert.deepEqual(catalog.editLessonSceneVisibility(['joints', 'bones'], 'skull', [jaw], { id: 'joints', shown: false }), [['bones'], 'skull']);
    assert.deepEqual(catalog.editLessonSceneVisibility(['joints', 'bones'], 'skull', [joint], { id: 'bones', shown: false }), [['joints'], 'joints']);
    assert.deepEqual(catalog.editLessonSceneVisibility(['bones'], 'head', [jaw, masseter], { id: 'bones', shown: true }), [['bones', 'muscles'], 'head']);
  } finally { catalog.free(); }
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
  const mediaOnly = vi => ({ ...lesson, steps: [{ ...lesson.steps[0], instruction: { vi, en: '', html: ['vi'] } }] });
  assert.doesNotThrow(() => readLesson(mediaOnly('<video><source src="https://example.com/lesson.mp4"></video>')));
  assert.doesNotThrow(() => readLesson(mediaOnly('<iframe src="https://www.youtube.com/embed/test"></iframe>')));
  assert.throws(() => readLesson(mediaOnly('<source src="https://example.com/lesson.mp4">')), /needs a title/);
  assert.throws(() => readLesson(mediaOnly('<iframe src="https://example.com/embed/test"></iframe>')), /needs a title/);
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
  const quiz = { id: 'quiz', kind: 'observe', targetId: 'jaw' };
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
    { id: 'quiz', kind: 'observe', title: text('Quiz'), instruction: text('Pick'), targetId: '' },
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

test('custom scenes persist exact model members', () => {
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

});

test('lesson language tag identifies single and bilingual configurations', () => {
  assert.equal(lessonLanguageTag({ ...draft, languages: ['vi'] }), 'vi');
  assert.equal(lessonLanguageTag({ ...draft, languages: ['en'] }), 'en');
  assert.equal(lessonLanguageTag({ ...draft, languages: ['vi', 'en'] }), 'vi/en');
  assert.equal(lessonLanguageTag({ ...draft, title: { vi: 'Bài học', en: '' } }), 'vi');
  assert.equal(lessonLanguageTag({ ...draft, title: { vi: '', en: 'Lesson' } }), 'en');
  assert.equal(lessonLanguageTag({ ...draft, title: { vi: 'Bài học', en: 'Lesson' } }), 'vi/en');
});
