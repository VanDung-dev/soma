export const lessonBody = page => page.frameLocator('#lesson-write-body_ifr').locator('body[contenteditable="true"]');

export async function selectLessonModel(page, id) {
  await page.locator('.lesson-editor-hud .lesson-model-toolbar > button[popovertarget="lesson-model-settings"]').click();
  const ids = Array.isArray(id) ? id : [id];
  const select = page.getByLabel('Mô hình 3D của bài học');
  if (await select.count() > 0) {
    await select.selectOption(ids);
  } else {
    for (const item of ids) {
      await page.locator(`#lesson-model-settings input[type="checkbox"][value="${item}"]`).check();
    }
  }
  await page.getByRole('button', { name: 'Đóng thiết lập 3D', exact: true }).click();
}
