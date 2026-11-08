export const lessonBody = page => page.frameLocator('#lesson-write-body_ifr').locator('body[contenteditable="true"]');

export async function selectLessonModel(page, id) {
  await page.locator('.lesson-editor-hud .lesson-model-toolbar > button[popovertarget="lesson-model-settings"]').click();
  await page.getByLabel('Mô hình 3D của bài học').selectOption(id);
  await page.getByRole('button', { name: 'Đóng thiết lập 3D', exact: true }).click();
}
