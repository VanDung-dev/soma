import assert from 'node:assert/strict';

export async function checkLessonCorruptStorage(page) {
  await page.goto('/lessons');
  await page.getByRole('button', { name: 'Tạo bài học', exact: true }).click();
  const id = new URL(page.url()).pathname.split('/')[2];
  const invalidId = await page.evaluate(id => {
    const key = 'soma.lesson:' + id;
    const lesson = JSON.parse(localStorage.getItem(key));
    lesson.title = { vi: 'Valid lesson', en: 'Valid lesson' };
    localStorage.setItem(key, JSON.stringify(lesson));
    const invalidId = crypto.randomUUID().replaceAll('-', '');
    localStorage.setItem('soma.lesson:' + invalidId, '{');
    return invalidId;
  }, id);

  try {
    await page.goto('/lessons');
    await page.getByRole('heading', { name: 'Valid lesson', exact: true }).waitFor();
    assert.match(await page.locator('.lesson-library-error').textContent(), /1/);
  } finally {
    await page.evaluate(({ id, invalidId }) => {
      localStorage.removeItem('soma.lesson:' + id);
      localStorage.removeItem('soma.lesson:' + invalidId);
    }, { id, invalidId });
    await page.goto('/lessons');
  }
}
