import { lessonBody } from './lesson-editor-tools.mjs';
import assert from 'node:assert/strict';

export async function checkLessonEditorLayout(page) {
  const text = vi => ({ vi, en: '' });
  const lesson = {
    id: 'persistent-editor-check', version: 1, title: text('Soạn bài liên tục'), summary: text(''),
    modelId: 'collection:cc46df69f8495544',
    steps: ['Một', 'Hai', 'Ba'].map((name, i) => ({ id: 'step-' + i, kind: 'observe',
      title: text(name), instruction: text('Nội dung ' + name), targetId: 'collection:cc46df69f8495544' })),
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(lesson => {
    localStorage.setItem('soma.lesson:' + lesson.id, JSON.stringify(lesson));
    for (const name of ['editorOutline', 'readerOutline']) localStorage.removeItem('soma.lessons.panel:' + name);
  }, lesson);
  await page.goto('/lessons/' + lesson.id + '/edit');
  const outline = page.locator('#lesson-author-outline');
  const settings = page.locator('.lesson-step-options');
  const document = page.locator('#lesson-author-writing');
  const model = page.locator('.lesson-scene-region');
  const saved = () => page.evaluate(id => JSON.parse(localStorage.getItem('soma.lesson:' + id)), lesson.id);
  const choose = name => outline.locator('.lesson-outline-row').filter({ hasText: name }).click();
  await page.getByLabel('Tên bài học').waitFor();
  assert(await outline.isVisible());
  assert.equal(await settings.count(), 0);
  assert.equal(await model.count(), 0, 'Lesson details have no 3D workspace');
  await choose('Một');
  await model.locator('.model-canvas[aria-busy="false"]').waitFor();
  await page.evaluate(() => { window.editorCanvas = document.querySelector('.lesson-scene-region canvas'); });
  await lessonBody(page).fill('Đã sửa nội dung Một');
  await choose('Hai');
  assert(await outline.isVisible());
  assert(await settings.isVisible());
  assert.equal(await lessonBody(page).innerText(), 'Nội dung Hai');
  const handle = outline.getByRole('button', { name: 'Kéo để sắp xếp “Hai”', exact: true });
  const start = await handle.boundingBox();
  const firstRow = await outline.locator('[data-lesson-step="step-0"]').boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstRow.x + firstRow.width / 2, firstRow.y + 5, { steps: 10 });
  await page.mouse.up();
  assert.deepEqual((await saved()).steps.map(step => step.id), ['step-1', 'step-0', 'step-2']);
  assert.equal(await page.getByLabel('Tên mục (VI)').inputValue(), 'Hai', 'Reordering must preserve the active step');
  await handle.focus();
  await handle.press('Space');
  await handle.press('End');
  await handle.press('Space');
  const reordered = await saved();
  assert.deepEqual(reordered.steps.map(step => step.id), ['step-0', 'step-2', 'step-1']);
  assert(reordered.steps[0].instruction.vi.includes('Đã sửa nội dung Một'));
  assert.deepEqual(reordered.steps[0].instruction.html, ['vi']);
  assert.deepEqual(reordered.steps[1], lesson.steps[2], 'Moving a step must preserve its content and scene');
  await handle.press('Space');
  await handle.press('Home');
  await handle.press('Escape');
  assert.deepEqual(await saved(), reordered, 'Escape must cancel keyboard reordering');
  assert.equal(await page.getByLabel('Tên mục (VI)').inputValue(), 'Hai');
  await document.getByRole('button', { name: 'Bước trước', exact: true }).click();
  assert.equal(await page.getByLabel('Tên mục (VI)').inputValue(), 'Ba');
  await model.locator('.orientation-axes [data-axis="Y"][data-direction="1"]').click();
  assert(await outline.isVisible());
  assert(await settings.isVisible());
  assert(await page.evaluate(() => window.editorCanvas === document.querySelector('.lesson-scene-region canvas')));
  await page.locator('#lesson-toggle-outline').click();
  await page.reload();
  await page.getByLabel('Tên bài học').waitFor();
  assert(await outline.isHidden());
  assert.equal(await settings.count(), 0);
  await document.getByRole('button', { name: 'Thêm bước học', exact: true }).click();
  assert.equal((await saved()).steps.length, 4, 'Adding a step must not require opening the outline');
  assert(await outline.isHidden());
  assert(await settings.isVisible());
  await page.getByLabel('Tên mục (VI)').fill('Bốn');
  await lessonBody(page).fill('Nội dung Bốn');
  await page.locator('#lesson-toggle-outline').click();
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  const readerOutline = page.locator('.lesson-reader-outline');
  const readerToggle = page.getByRole('button', { name: 'Mục lục', exact: true });
  await readerToggle.click();
  await readerOutline.getByRole('button', { name: 'Ba', exact: true }).click();
  assert(await readerOutline.isVisible());
  await page.getByRole('button', { name: 'Bước tiếp theo', exact: true }).click();
  assert(await readerOutline.isVisible());
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  await page.getByLabel('Tên mục (VI)').waitFor();
  assert(await outline.isVisible());
  assert(await settings.isVisible());
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  await readerToggle.waitFor();
  assert(await readerOutline.isVisible(), 'Learner outline preference survives returning to preview');
  await page.getByRole('button', { name: 'Đóng mục lục', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const playerModel = page.locator('.lesson-player .lesson-model');
  await page.getByRole('button', { name: 'Thu gọn mô hình 3D', exact: true }).click();
  await page.getByRole('button', { name: 'Bước tiếp theo', exact: true }).click();
  assert(await playerModel.isHidden(), 'Changing a 3D step must respect the learner’s collapsed-model choice');
  await page.getByRole('button', { name: 'Hiện mô hình 3D', exact: true }).click();
  await readerToggle.click();
  assert(await readerOutline.isVisible());
  assert(await page.locator('.lessons-screen').evaluate(node => node.scrollWidth <= node.clientWidth));
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  await page.getByLabel('Tên mục (VI)').waitFor();
  assert(await outline.isVisible());
  assert((await outline.locator('.catalog-tree').boundingBox()).height >= 70, 'Mobile outline needs usable space for selecting steps');
  await choose('Một');
  assert(await outline.isVisible());
  assert(await settings.isVisible());
  await page.evaluate(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) {
      if (key.startsWith('soma.lessons.panel:')) throw new DOMException('Blocked', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('soma.lessons.panel:')) throw new DOMException('Blocked', 'SecurityError');
      return set.call(this, key, value);
    };
  });
  await page.locator('#lesson-toggle-outline').click();
  await page.locator('#lesson-toggle-outline').click();
  assert(await outline.isVisible(), 'Panel toggles remain usable when preference storage is blocked');
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  await page.getByLabel('Tên mục (VI)').waitFor();
  assert(await settings.isVisible(), 'Blocked panel storage must fall back to accessible inline settings');
}
