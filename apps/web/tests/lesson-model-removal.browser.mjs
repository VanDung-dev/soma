import assert from 'node:assert/strict';
import { createLesson, lessonModelRoot } from './lesson-editor-tools.mjs';

export async function checkLessonModelRemoval(page) {
  await page.goto('/lessons');
  const id = await createLesson(page);
  await page.evaluate(({ id, bones, joints }) => {
    const key = 'soma.lesson-v1:' + id;
    const lesson = JSON.parse(localStorage.getItem(key));
    const text = value => ({ vi: value, en: value });
    const step = (name, modelId) => ({ id: crypto.randomUUID().replaceAll('-', ''), kind: 'observe',
      title: text(name), instruction: text(name), showModel: true, modelIds: [modelId], targetId: modelId });
    localStorage.setItem(key, JSON.stringify({ ...lesson, title: text('Model removal regression'), modelId: bones,
      modelIds: [bones], steps: [step('Bones', bones), step('Joints', joints)] }));
  }, { id, bones: 'collection:baf3076d0495a617', joints: 'collection:df6cf17f3715fcc8' });
  await page.reload();
  const readyCanvas = page.locator('.lesson-editor > .model-canvas[aria-busy="false"]');
  await readyCanvas.waitFor();
  assert.equal(await page.locator('.lesson-editor .model-error').count(), 0, 'Both model roots should load before removal');
  await page.locator('#lesson-author-outline .lesson-outline-row').filter({ hasText: 'Bones' }).click();
  await page.evaluate(async () => {
    const { getWasm } = await import('/src/anatomy/core.ts');
    const { AnatomyViewer } = await getWasm();
    const append = AnatomyViewer.prototype.appendPrepared;
    const canvas = document.querySelector('.lesson-editor > .model-canvas canvas');
    window.lessonModelCheck = { appends: 0, canvas, restore: () => { AnatomyViewer.prototype.appendPrepared = append; } };
    AnatomyViewer.prototype.appendPrepared = function (...args) {
      window.lessonModelCheck.appends++;
      return append.apply(this, args);
    };
  });
  try {
    await page.getByRole('button', { name: 'Thiết lập 3D', exact: true }).click();
    const settings = page.locator('.lesson-model-settings[data-open="true"]');
    const nerves = lessonModelRoot(settings, 'collection:cc46df69f8495544');
    await nerves.check();
    await page.waitForFunction(() => window.lessonModelCheck.appends === 1);
    await readyCanvas.waitFor();
    assert(await page.evaluate(() => window.lessonModelCheck.canvas === document.querySelector('.lesson-editor > .model-canvas canvas')));
    await nerves.uncheck();
    await nerves.check();
    await readyCanvas.waitFor();
    assert.equal(await page.evaluate(() => window.lessonModelCheck.appends), 1, 'Selecting an already loaded model uses its existing geometry');
    await settings.getByRole('button', { name: 'Hủy', exact: true }).click();
    assert(await page.evaluate(() => window.lessonModelCheck.canvas === document.querySelector('.lesson-editor > .model-canvas canvas')));
  } finally {
    await page.evaluate(() => window.lessonModelCheck.restore());
  }
  await page.locator('#lesson-author-outline .lesson-outline-row').filter({ hasText: 'Joints' }).click();
  await page.getByRole('checkbox', { name: 'Hiển thị mô hình 3D ở mục này', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Xóa mục', exact: true }).click();
  await page.getByRole('dialog', { name: 'Xác nhận' }).getByRole('button', { name: 'Xóa mục', exact: true }).click();
  await readyCanvas.waitFor();
  assert.equal(await page.locator('.lesson-editor .model-error').count(), 0, 'Removing a step must not leave stale model geometry in the viewer');
}
