import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { readLessonMetadata, unpackLessonTar } from './lesson-package.fixture.mjs';
import { lessonBody, savedLesson, saveLessonDraft } from './lesson-editor-tools.mjs';
import { checkLessonHeader } from './lesson-editor-experience.browser.mjs';

export async function checkLessonQuestions(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/lessons');
  await page.getByRole('button', { name: 'Tạo bài học', exact: true }).click();
  await page.getByLabel('Tên bài học').fill('Bài học nhiều câu hỏi');
  const url = page.url();
  const saved = () => savedLesson(page);
  const writing = page.locator('#lesson-author-writing');
  await writing.getByRole('button', { name: 'Thêm mục', exact: true }).click();
  await page.getByLabel('Tên mục').fill('Hai câu hỏi');
  await page.getByLabel('Hiển thị mô hình 3D ở mục này', { exact: true }).uncheck();
  await lessonBody(page).fill('Nội dung phải còn sau khi chuyển chế độ.');
  const mode = page.getByRole('group', { name: 'Hiển thị trong mục', exact: true });
  const selectMode = value => mode.getByRole('button', { name: { content: 'Nội dung', questions: 'Câu hỏi', content_questions: 'Nội dung và câu hỏi' }[value], exact: true }).click();
  await selectMode('content_questions');
  await page.getByRole('button', { name: 'Thêm câu hỏi', exact: true }).click();
  const questions = page.locator('.lesson-question-editor > fieldset');
  for (let i = 0; i < 2; i++) {
    await questions.nth(i).getByLabel('Đề bài', { exact: true }).fill(`Đề bài ${i + 1}`);
    await questions.nth(i).getByLabel('Phương án 1', { exact: true }).fill(`Sai ${i + 1}`);
    await questions.nth(i).getByLabel('Phương án 2', { exact: true }).fill(`Đúng ${i + 1}`);
    await questions.nth(i).getByRole('radio', { name: 'Chọn phương án 2 làm đáp án đúng', exact: true }).check();
    await questions.nth(i).getByLabel('Giải thích đáp án', { exact: true }).fill(`Giải thích ${i + 1}`);
  }
  await questions.nth(1).getByRole('button', { name: 'Thêm phương án trả lời', exact: true }).click();
  await questions.nth(1).getByLabel('Phương án 3', { exact: true }).fill('Một lựa chọn khác');
  await saveLessonDraft(page);
  const both = (await saved()).steps[0];
  for (const value of ['content', 'questions', 'content_questions']) {
    await selectMode(value);
    await saveLessonDraft(page);
    assert.equal(await mode.getByRole('button', { pressed: true }).count(), 1);
    assert.deepEqual((await saved()).steps[0].questions, both.questions);
    assert.deepEqual((await saved()).steps[0].instruction, both.instruction);
    assert.equal(await page.locator('.tox-tinymce').count(), value === 'questions' ? 0 : 1);
    assert.equal(await questions.count(), value === 'content' ? 0 : 2);
  }
  await page.reload();
  await page.locator('#lesson-author-outline .lesson-outline-row').filter({ hasText: 'Hai câu hỏi' }).click();
  await lessonBody(page).waitFor();
  assert.deepEqual((await saved()).steps[0].questions, both.questions);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await checkLessonHeader(page, '.lesson-author-bar', '.lesson-author-heading');
    assert(await writing.evaluate(node => node.scrollWidth <= node.clientWidth));
    if (process.env.SOMA_LESSON_VISUALS) await page.screenshot({ path: `/tmp/soma-question-editor-${width}.png` });
  }
  const original = await saved();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất .lesson.br', exact: true }).click();
  const bytes = await readFile(await (await downloadEvent).path());
  const files = unpackLessonTar(brotliDecompressSync(bytes));
  assert.deepEqual(readLessonMetadata(files), original);
  const exercise = async root => {
    const finish = root.getByRole('button', { name: 'Hoàn thành', exact: true });
    const question = index => root.getByRole('region', { name: `Câu hỏi ${index}`, exact: true });
    assert(await finish.isDisabled());
    await question(1).getByRole('radio', { name: 'Sai 1', exact: true }).check();
    await question(1).getByRole('button', { name: 'Kiểm tra đáp án', exact: true }).click();
    await question(1).getByRole('status').filter({ hasText: 'Chưa đúng' }).waitFor();
    assert(await finish.isDisabled());
    await question(1).getByRole('radio', { name: 'Đúng 1', exact: true }).check();
    await question(1).getByRole('button', { name: 'Kiểm tra đáp án', exact: true }).click();
    assert(await finish.isDisabled(), 'Every question must be correct before moving on');
    await question(2).getByRole('radio', { name: 'Đúng 2', exact: true }).check();
    await question(2).getByRole('button', { name: 'Kiểm tra đáp án', exact: true }).click();
    assert(await finish.isEnabled());
    assert(await question(1).getByRole('radio', { name: 'Đúng 1', exact: true }).isDisabled());
    assert(await question(2).getByText('Giải thích 2', { exact: true }).isVisible());
    await finish.click();
    await root.getByRole('heading', { name: 'Đã hoàn thành bài học', exact: true }).waitFor();
    await root.getByRole('button', { name: 'Xem lại bài học', exact: true }).click();
    assert(await question(2).getByRole('radio', { name: 'Đúng 2', exact: true }).isChecked(), 'Review preserves completed answers');
  };
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  assert.equal(await page.locator('.lesson-player').getByRole('region', { name: /Câu hỏi \d/ }).count(), 2);
  assert(await page.getByRole('button', { name: 'Hoàn thành', exact: true }).isEnabled());
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await checkLessonHeader(page, '.lesson-player-header', '.lesson-player-heading');
    if (process.env.SOMA_LESSON_VISUALS) await page.screenshot({ path: `/tmp/soma-question-preview-${width}.png` });
  }
  assert.deepEqual(await saved(), original);
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  await selectMode('questions');
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  assert.equal(await page.locator('.lesson-instructions').count(), 0);
  const heading = await page.getByRole('heading', { name: 'Hai câu hỏi', exact: true }).boundingBox();
  const firstQuestion = await page.getByRole('region', { name: 'Câu hỏi 1', exact: true }).boundingBox();
  assert(firstQuestion.y - heading.y - heading.height >= 12, 'The first question has breathing room below the section title');
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  await selectMode('content');
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  assert.equal(await page.locator('.lesson-questions input').count(), 0);
  assert(await page.getByRole('button', { name: 'Hoàn thành', exact: true }).isEnabled());
  const studentContext = await page.context().browser().newContext({ baseURL: new URL(page.url()).origin });
  try {
    const student = await studentContext.newPage();
    await student.clock.install();
    await student.goto('/home');
    await student.evaluate(lesson => localStorage.setItem('soma.lesson-v1:' + lesson.id, JSON.stringify(lesson)), original);
    await student.goto('/lessons/' + original.id);
    await student.getByRole('heading', { name: 'Hai câu hỏi', exact: true }).waitFor();
    await student.locator('.lesson-player-stepbar button[data-reading]').waitFor();
    await student.clock.fastForward(16_000);
    await student.locator('.lesson-player-stepbar button[data-read][aria-description^="Trả lời đúng"]').waitFor();
    await exercise(student.locator('.lesson-player'));
  } finally { await studentContext.close(); }
  assert.equal(page.url(), url);
}

export async function checkLessonImageProgress(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/lessons');
  await page.getByRole('button', { name: 'Tạo bài học', exact: true }).click();
  await page.getByLabel('Tên bài học').fill('Tiến trình xử lý ảnh');
  await page.evaluate(() => {
    const OriginalWorker = window.Worker;
    window.releaseLessonImages = [];
    window.Worker = class extends OriginalWorker {
      set onmessage(callback) {
        super.onmessage = event => {
          if (event.data.result?.image) window.releaseLessonImages.push(() => callback(event));
          else callback(event);
        };
      }
    };
    window.restoreLessonWorker = () => { window.Worker = OriginalWorker; };
  });
  const image = await readFile(new URL('../public/home/anatomy.png', import.meta.url));
  const upload = { name: 'progress.png', mimeType: 'image/png', buffer: image };
  const release = async () => {
    await page.waitForFunction(() => window.releaseLessonImages.length > 0);
    await page.evaluate(() => window.releaseLessonImages.shift()());
  };
  try {
    const cover = page.getByLabel('Ảnh bìa bài học', { exact: true });
    await cover.setInputFiles(upload);
    await page.getByRole('status').filter({ hasText: 'Đang nén ảnh' }).waitFor();
    assert(await cover.isDisabled());
    assert.equal(await page.getByRole('progressbar').getAttribute('value'), null, 'Compression shows an indeterminate indicator');
    if (process.env.SOMA_LESSON_VISUALS) await page.screenshot({ path: '/tmp/soma-cover-compressing.png' });
    await release();
    await page.locator('.lesson-cover').waitFor();
    assert.equal(await page.locator('.lesson-image-progress').count(), 0);
    await page.locator('#lesson-author-writing').getByRole('button', { name: 'Thêm mục', exact: true }).click();
    await lessonBody(page).fill('Ảnh trong nội dung');
    await page.getByRole('button', { name: 'Insert/edit image', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), dialog.getByRole('button', { name: 'Browse files', exact: true }).click()]);
    await chooser.setFiles(upload);
    await page.getByRole('status').filter({ hasText: 'Đang nén ảnh' }).waitFor();
    assert(await dialog.locator('.tox-dialog__busy-spinner').isVisible(), 'The image dialog stays blocked while processing');
    assert.equal(await dialog.locator('.tox-dialog__busy-spinner').evaluate(node => getComputedStyle(node, '::after').content), '"Đang nén ảnh…"');
    if (process.env.SOMA_LESSON_VISUALS) await page.screenshot({ path: '/tmp/soma-content-compressing.png' });
    await release();
    await dialog.locator('.tox-dialog__busy-spinner').waitFor({ state: 'hidden' });
    await page.waitForFunction(input => input.value.startsWith('blob:'), await dialog.getByRole('combobox', { name: 'Source', exact: true }).elementHandle());
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await lessonBody(page).locator('img').waitFor();
    assert.equal(await page.locator('.lesson-image-progress').count(), 0);
    await page.getByRole('button', { name: 'Insert/edit image', exact: true }).click();
    const [invalidChooser] = await Promise.all([page.waitForEvent('filechooser'), dialog.getByRole('button', { name: 'Browse files', exact: true }).click()]);
    await invalidChooser.setFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') });
    await page.locator('.tox-notification--error').waitFor();
    assert.equal(await page.locator('.lesson-image-progress').count(), 0);
    assert.equal(await dialog.locator('.tox-dialog__busy-spinner').count(), 0, 'Failed uploads unblock the dialog');
    assert(await dialog.getByRole('combobox', { name: 'Source', exact: true }).isEditable());
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally { await page.evaluate(() => window.restoreLessonWorker()); }
}
