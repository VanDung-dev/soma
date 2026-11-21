export const lessonBody = page => page.frameLocator('#lesson-write-body_ifr').locator('body[contenteditable="true"]');

export async function createLesson(page) {
  await page.getByRole('button', { name: 'Tạo bài học', exact: true }).click();
  await page.waitForURL(/\/lessons\/[a-z0-9]+\/edit$/);
  return new URL(page.url()).pathname.split('/')[2];
}

export async function saveLessonDraft(page) {
  await page.getByRole('button', { name: 'Lưu bài học', exact: true }).click();
  await page.getByRole('button', { name: 'Đã lưu', exact: true }).waitFor();
}

export const savedLesson = (page, id) => page.evaluate(async id => {
  const { listLessons } = await import('/src/lessons/shared/source.ts');
  const { lessons } = await listLessons();
  return lessons.find(lesson => lesson.id === (id ?? location.pathname.split('/')[2]));
}, id ?? null);

export async function selectLessonModel(page, id) {
  await page.getByRole('button', { name: 'Thiết lập 3D', exact: true }).click();
  const settings = page.locator('.lesson-model-settings[data-open="true"]');
  for (const root of Array.isArray(id) ? id : [id]) {
    await lessonModelRoot(settings, root).check();
  }
  await settings.getByRole('button', { name: 'Áp dụng', exact: true }).click();
}

export const lessonModelRoot = (settings, id) => settings
  .locator(`.structure-tree > li[data-target-id="${id}"] > .folder-row input[type="checkbox"]`);
