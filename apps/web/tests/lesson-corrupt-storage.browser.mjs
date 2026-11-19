import assert from 'node:assert/strict';
import { createLesson } from './lesson-editor-tools.mjs';

export async function checkLessonCorruptStorage(page) {
  await page.goto('/lessons');
  const id = await createLesson(page);
  const invalidId = await page.evaluate(id => {
    const key = 'soma.lesson-v1:' + id;
    const lesson = JSON.parse(localStorage.getItem(key));
    lesson.title = { vi: 'Valid lesson', en: 'Valid lesson' };
    localStorage.setItem(key, JSON.stringify(lesson));
    const invalidId = crypto.randomUUID().replaceAll('-', '');
    localStorage.setItem('soma.lesson-v1:' + invalidId, '{');
    return invalidId;
  }, id);

  try {
    await page.goto('/lessons');
    await page.getByRole('heading', { name: 'Valid lesson', exact: true }).waitFor();
    assert.match(await page.locator('.lesson-library-error').textContent(), /1/);
  } finally {
    await page.evaluate(({ id, invalidId }) => {
      localStorage.removeItem('soma.lesson-v1:' + id);
      localStorage.removeItem('soma.lesson-v1:' + invalidId);
    }, { id, invalidId });
    await page.goto('/lessons');
  }
}
