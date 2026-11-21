import assert from 'node:assert/strict';

export async function checkLessonPlayerExit(page) {
  const text = vi => ({ vi, en: vi });
  const lesson = { id: 'player-exit', version: 1, title: text('Thoát bài học'), summary: text(''), modelId: '',
    steps: [{ id: 'reading', kind: 'text', showModel: false, title: text('Nội dung'), instruction: text('Bài đọc.') }] };
  const errors = [], dialogs = [];
  const onError = error => errors.push(error.message);
  const onDialog = dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); };
  page.on('pageerror', onError); page.on('dialog', onDialog);
  try {
    await page.goto('/home');
    await page.evaluate(lesson => localStorage.setItem('soma.lesson-v1:' + lesson.id, JSON.stringify(lesson)), lesson);
    for (const width of [1440, 390]) for (const preview of [false, true]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/lessons/' + lesson.id + (preview ? '/edit' : ''));
      if (preview) await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
      await page.locator('.lesson-player').getByRole('button', { name: 'Thoát', exact: true }).click();
      assert.deepEqual(errors, [], 'Leaving the player must not treat the click event as a lesson');
      await page.waitForURL(/\/lessons$/);
      await page.getByRole('searchbox', { name: 'Tìm bài học' }).waitFor();
      assert.equal(dialogs.length, 0, 'Saved preview and view must exit without a discard prompt');
    }
    await page.goto('/lessons/' + lesson.id + '/edit');
    await page.getByLabel('Tên bài học', { exact: true }).fill('Bản sửa chưa lưu');
    await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
    await page.locator('.lesson-player').getByRole('button', { name: 'Thoát', exact: true }).click();
    await page.locator('.lesson-confirm-dialog').getByRole('button', { name: 'Tiếp tục soạn bài' }).click();
    assert(await page.locator('.lesson-player').isVisible(), 'Cancelling exit must keep the draft preview open');
    await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
    assert.equal(await page.getByLabel('Tên bài học', { exact: true }).inputValue(), 'Bản sửa chưa lưu');
    await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
    await page.locator('.lesson-player').getByRole('button', { name: 'Thoát', exact: true }).click();
    await page.locator('.lesson-confirm-dialog').getByRole('button', { name: 'Thoát không lưu' }).click();
    await page.waitForURL(/\/lessons$/);
    assert.equal(dialogs.length, 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('soma.lesson-v1:player-exit'))), lesson, 'Discarding preview edits must preserve the saved lesson');
    await page.goto('/lessons/' + lesson.id + '/edit');
    await page.getByLabel('Tên bài học', { exact: true }).fill('Bản đã lưu');
    await page.getByRole('button', { name: 'Thoát', exact: true }).click();
    await page.locator('.lesson-confirm-dialog').getByRole('button', { name: 'Lưu và thoát' }).click();
    await page.waitForURL(/\/lessons$/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('soma.lesson-v1:player-exit')).title.vi), 'Bản đã lưu');
    await page.evaluate(lesson => localStorage.setItem('soma.lesson-v1:player-exit-empty', JSON.stringify({ ...lesson, id: 'player-exit-empty', steps: [] })), lesson);
    await page.goto('/lessons/player-exit-empty');
    await page.getByRole('button', { name: 'Tiếp tục soạn bài', exact: true }).click();
    await page.waitForURL(/\/lessons$/);
    assert.deepEqual(errors, []);
    assert.equal(dialogs.length, 0);
  } finally { page.off('pageerror', onError); page.off('dialog', onDialog); }
}
