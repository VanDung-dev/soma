import assert from 'node:assert/strict';
import { createLesson } from './lesson-editor-tools.mjs';

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
  await page.locator('.lesson-editor > .model-canvas[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.lesson-editor .model-error').count(), 0, 'Both model roots should load before removal');
  await page.locator('#lesson-author-outline .lesson-outline-row').filter({ hasText: 'Joints' }).click();
  await page.getByRole('checkbox', { name: 'Hiển thị mô hình 3D ở mục này', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Xóa mục', exact: true }).click();
  await page.getByRole('dialog', { name: 'Xác nhận' }).getByRole('button', { name: 'Xóa mục', exact: true }).click();
  await page.locator('.lesson-editor > .model-canvas[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.lesson-editor .model-error').count(), 0, 'Removing a step must not leave stale model geometry in the viewer');
}
