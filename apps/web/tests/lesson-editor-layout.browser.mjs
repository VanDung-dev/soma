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
  await page.setViewportSize({ width: 1280, height: 800 });
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
  const outlineOrder = () => outline.locator('[data-lesson-step]').evaluateAll(rows => rows.map(row => row.dataset.lessonStep));
  const waitForOutlineOrder = order => page.waitForFunction(order => {
    const rows = [...document.querySelectorAll('#lesson-author-outline [data-lesson-step]')];
    return JSON.stringify(rows.map(row => row.dataset.lessonStep)) === JSON.stringify(order);
  }, order);
  const saveDraft = async () => {
    await page.getByRole('button', { name: 'Lưu bài học', exact: true }).click();
    await page.getByRole('button', { name: 'Đã lưu', exact: true }).waitFor();
    return saved();
  };
  const choose = name => outline.locator('.lesson-outline-row').filter({ hasText: name }).click();
  await page.getByLabel('Tên bài học').waitFor();
  assert(await outline.isVisible());
  assert.deepEqual(await document.evaluate(node => [...node.classList].filter(name => name.startsWith('lesson-author-document--'))), ['lesson-author-document--details']);
  assert.equal(await settings.count(), 0);
  assert(await model.isHidden(), 'Lesson details keep the model controls hidden');
  await page.locator('.lesson-editor > .model-canvas[aria-busy="false"]').waitFor();
  await page.evaluate(() => { window.editorCanvas = document.querySelector('.lesson-editor > .model-canvas canvas'); });
  await choose('Một');
  await page.locator('.lesson-editor > .model-canvas[aria-busy="false"]').waitFor();
  assert.deepEqual(await document.evaluate(node => [...node.classList].filter(name => name.startsWith('lesson-author-document--'))), ['lesson-author-document--step']);
  await page.waitForFunction(() => {
    const scene = document.querySelector('.lesson-scene-region');
    return !!scene && Math.abs(scene.getBoundingClientRect().width - 476) < 0.5;
  });
  assert.deepEqual(await page.evaluate(() => ['#lesson-author-outline', '.lesson-scene-region', '#lesson-author-writing']
    .map(selector => Math.round(document.querySelector(selector).getBoundingClientRect().width))), [240, 476, 500]);
  const stepLabel = await document.getAttribute('aria-label');
  assert.match(stepLabel, /^(Mục|Section) 1 · Một$/);
  assert.deepEqual(await document.evaluate(node => [...node.classList].filter(name => name.startsWith('lesson-author-document--'))), ['lesson-author-document--step']);
  await page.locator('#lesson-toggle-outline').click();
  await outline.waitFor({ state: 'hidden' });
  assert(await outline.isHidden());
  assert.equal(await document.getAttribute('aria-label'), stepLabel);
  assert.deepEqual(await document.evaluate(node => [...node.classList].filter(name => name.startsWith('lesson-author-document--'))), ['lesson-author-document--step']);
  await page.locator('#lesson-toggle-outline').click();
  await page.getByRole('button', { name: 'Thiết lập 3D', exact: true }).click();
  const closeModelSettings = page.getByRole('button', { name: 'Đóng thiết lập 3D', exact: true });
  await closeModelSettings.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Đóng thiết lập 3D');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.lesson-model-settings')?.dataset.open === 'false'
    && document.activeElement === document.querySelector('.lesson-model-toolbar > .lesson-button'));
  assert(await page.evaluate(() => window.editorCanvas === document.querySelector('.lesson-editor > .model-canvas canvas')));
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
  await waitForOutlineOrder(['step-1', 'step-0', 'step-2']);
  assert.deepEqual(await outlineOrder(), ['step-1', 'step-0', 'step-2'], 'Pointer reorder updates the visible draft');
  assert.deepEqual((await saved()).steps.map(step => step.id), ['step-0', 'step-1', 'step-2'], 'Reordering stays staged until Save');
  assert.equal(await page.getByLabel('Tên mục').inputValue(), 'Hai', 'Reordering must preserve the active step');
  await handle.focus();
  await handle.press('Space');
  await handle.press('End');
  await handle.press('Space');
  await waitForOutlineOrder(['step-0', 'step-2', 'step-1']);
  assert.deepEqual(await outlineOrder(), ['step-0', 'step-2', 'step-1'], 'Keyboard reorder updates the visible draft');
  assert.deepEqual((await saved()).steps.map(step => step.id), ['step-0', 'step-1', 'step-2'], 'Keyboard reorder stays staged until Save');
  const reordered = await saveDraft();
  assert.deepEqual(reordered.steps.map(step => step.id), ['step-0', 'step-2', 'step-1']);
  const listed = await page.evaluate(async id => {
    const { listLessons } = await import('/src/lessons/shared/source.ts');
    return (await listLessons()).lessons.find(item => item.id === id);
  }, lesson.id);
  assert(listed);
  assert(listed.steps[0].instruction.vi.includes('Đã sửa nội dung Một'), 'Saved rich text remains readable from the lesson source');
  assert.deepEqual(reordered.steps[0].instruction.html, ['vi']);
  assert.deepEqual(reordered.steps[1], lesson.steps[2], 'Moving a step must preserve its content and scene');
  await handle.press('Space');
  await handle.press('Home');
  await handle.press('Escape');
  assert.equal(await handle.getAttribute('aria-pressed'), 'false', 'Escape ends keyboard reordering');
  assert.deepEqual(await outlineOrder(), ['step-0', 'step-2', 'step-1'], 'Escape cancels keyboard reordering');
  assert.deepEqual(await saved(), reordered, 'Escape must cancel keyboard reordering');
  assert.equal(await page.getByLabel('Tên mục').inputValue(), 'Hai');
  await document.getByRole('button', { name: 'Mục trước', exact: true }).click();
  assert.equal(await page.getByLabel('Tên mục').inputValue(), 'Ba');
  await model.locator('.orientation-axes [data-axis="Y"][data-direction="1"]').click();
  assert(await outline.isVisible());
  assert(await settings.isVisible());
  assert(await page.evaluate(() => window.editorCanvas === document.querySelector('.lesson-editor > .model-canvas canvas')));
  await page.locator('#lesson-toggle-outline').click();
  await page.reload();
  await page.getByLabel('Tên bài học').waitFor();
  assert(await outline.isHidden());
  assert.equal(await settings.count(), 0);
  await page.locator('#lesson-toggle-outline').click();
  await outline.waitFor({ state: 'visible' });
  await choose('Hai');
  await page.locator('#lesson-toggle-outline').click();
  await outline.waitFor({ state: 'hidden' });
  await document.getByRole('button', { name: 'Thêm mục', exact: true }).click();
  assert(await outline.isHidden());
  assert(await settings.isVisible());
  assert.equal(await page.getByLabel('Tên mục').inputValue(), '', 'Adding a step while the outline is closed opens a new draft');
  await page.getByLabel('Tên mục').fill('Bốn');
  await lessonBody(page).fill('Nội dung Bốn');
  await page.locator('#lesson-toggle-outline').click();
  assert.equal(await outline.locator('[data-lesson-step]').count(), 4, 'The added draft appears in the outline');
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  const readerOutline = page.locator('.lesson-reader-outline');
  const readerToggle = page.locator('.lesson-player-header .sidebar-toggle');
  await readerToggle.click();
  await readerOutline.getByRole('button', { name: 'Ba', exact: true }).click();
  assert(await readerOutline.isVisible());
  await page.getByRole('button', { name: 'Mục tiếp theo', exact: true }).click();
  assert(await readerOutline.isVisible());
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  await page.getByLabel('Tên mục').waitFor();
  assert(await outline.isVisible());
  assert(await settings.isVisible());
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  await readerToggle.waitFor();
  assert(await readerOutline.isVisible(), 'Learner outline preference survives returning to preview');
  await readerToggle.click();
  await page.setViewportSize({ width: 390, height: 844 });
  const playerModel = page.locator('.lesson-player .lesson-model');
  await page.getByRole('button', { name: 'Thu gọn mô hình 3D', exact: true }).click();
  await page.getByRole('button', { name: 'Mục tiếp theo', exact: true }).click();
  assert(await playerModel.isHidden(), 'Changing a 3D step must respect the learner’s collapsed-model choice');
  await page.getByRole('button', { name: 'Hiện mô hình 3D', exact: true }).click();
  await readerToggle.click();
  assert(await readerOutline.isVisible());
  assert(await page.locator('.lessons-screen').evaluate(node => node.scrollWidth <= node.clientWidth));
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  await page.getByLabel('Tên mục').waitFor();
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
  await page.getByLabel('Tên mục').waitFor();
  assert(await settings.isVisible(), 'Blocked panel storage must fall back to accessible inline settings');
}
