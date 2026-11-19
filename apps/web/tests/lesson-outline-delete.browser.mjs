import assert from 'node:assert/strict';

export async function checkLessonOutlineDelete(page) {
  const text = vi => ({ vi, en: '' });
  const lesson = { id: 'outline-delete-test', version: 1, title: text('Delete test'), summary: text(''), modelId: '',
    steps: ['one', 'two'].map(id => ({ id, kind: 'text', title: text(id), instruction: text('Nội dung') })) };
  await page.goto('/home');
  await page.evaluate(lesson => {
    localStorage.setItem('soma.lesson-v1:' + lesson.id, JSON.stringify(lesson));
    localStorage.setItem('soma.lessons.panel:editorOutline', 'true');
  }, lesson);
  await page.goto('/lessons/' + lesson.id + '/edit');
  const card = page.locator('[data-lesson-step="one"] .lesson-outline-row');
  await card.click();
  const title = page.getByLabel('Tên mục', { exact: true });
  await title.focus();
  await title.press('Backspace');
  assert.equal(await page.locator('.lesson-confirm-dialog[open]').count(), 0, 'Editing text must not open the removal dialog');
  await card.focus();
  await card.press('Delete');
  const dialog = page.locator('.lesson-confirm-dialog[open]');
  await dialog.getByRole('button', { name: 'Hủy', exact: true }).click();
  assert.equal(await page.locator('[data-lesson-step="one"]').count(), 1);
  await card.focus();
  await card.press('Backspace');
  await dialog.getByRole('button', { name: 'Xóa mục', exact: true }).click();
  assert.equal(await page.locator('[data-lesson-step="one"]').count(), 0);
  assert.equal(await page.locator('[data-lesson-step="two"]').count(), 1);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('soma.lesson-v1:outline-delete-test')).steps.length), 2,
    'Removing a section remains a draft until the lesson is saved');
}
