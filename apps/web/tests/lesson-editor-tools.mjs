export const lessonBody = page => page.frameLocator('#lesson-write-body_ifr').locator('body[contenteditable="true"]');

export async function selectLessonModel(page, id) {
  await page.getByRole('button', { name: 'Thiết lập 3D', exact: true }).click();
  const settings = page.locator('.lesson-model-settings[data-open="true"]');
  await settings.getByRole('listbox', { name: 'Mô hình 3D của bài học' }).selectOption(Array.isArray(id) ? id : [id]);
  await settings.getByRole('button', { name: 'Áp dụng', exact: true }).click();
}
