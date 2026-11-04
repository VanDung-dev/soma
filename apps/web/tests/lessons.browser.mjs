import assert from 'node:assert/strict';

export async function checkLessons(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/home');
  await page.locator('.home-module-lessons').click();
  await page.getByRole('status').filter({ hasText: 'Chưa có bài học' }).waitFor();
  await page.getByRole('button', { name: 'Tạo bài học' }).click();
  const editorUrl = page.url();
  assert.match(editorUrl, /\/lessons\/[a-z0-9]+\/edit$/);

  await page.getByLabel('Tên bài học (VI)').fill('Bài kiểm thử');
  await page.getByRole('button', { name: 'Đoạn nội dung', exact: true }).click();
  await page.getByLabel('Tên mục (VI)').fill('Đọc phần mở đầu');
  await page.getByLabel('Nội dung hướng dẫn (VI)').fill('Quan sát phần mô tả.');
  await page.getByRole('button', { name: 'Xem trước' }).click();
  await page.getByRole('heading', { name: 'Đọc phần mở đầu' }).waitFor();
  assert.equal(await page.locator('.lesson-model canvas').count(), 0);
  await page.getByRole('button', { name: 'Hoàn thành', exact: true }).click();
  await page.getByRole('heading', { name: 'Đã hoàn thành bài học' }).waitFor();

  await page.reload();
  assert.equal(page.url(), editorUrl);
  await page.getByRole('button', { name: 'Danh sách bài học' }).click();
  const librarySearch = page.getByRole('searchbox', { name: 'Tìm bài học' });
  await librarySearch.fill('khong ton tai');
  await page.getByRole('status').filter({ hasText: 'Không tìm thấy bài học' }).waitFor();
  await librarySearch.fill('bai kiem thu');
  await page.getByRole('button', { name: 'Chỉnh sửa' }).click();
  assert.equal(page.url(), editorUrl);
  await page.getByRole('button', { name: /Đọc phần mở đầu/ }).click();
  assert.equal(await page.getByLabel('Tên mục (VI)').inputValue(), 'Đọc phần mở đầu');

  await page.getByRole('button', { name: 'Quan sát 3D', exact: true }).click();
  const pick = page.getByRole('button', { name: 'Chọn trong danh mục giải phẫu', exact: true });
  assert(await pick.isDisabled());
  await page.getByLabel('Mô hình 3D của bài học').selectOption('collection:cc46df69f8495544');
  await pick.click();
  const search = page.locator('.structure-search-popover:popover-open');
  const query = search.getByRole('combobox');
  await query.fill('Cranium');
  await search.getByRole('status').filter({ hasText: 'Không tìm thấy' }).waitFor();
  assert.equal(await search.getByRole('option').count(), 0);
  await query.fill('cau nao');
  await search.locator('[data-target-id="collection:94f4f0afe3598035"]').waitFor();
  await query.press('Enter');
  await page.getByRole('button', { name: /Chọn trong danh mục giải phẫu · Cầu não/ }).waitFor();
  const frame = page.locator('.lesson-scene-region');
  await frame.locator('.orientation-axes [data-axis="Y"][data-direction="1"]').waitFor();
  const width = await frame.evaluate(node => node.clientWidth);
  await page.getByRole('button', { name: 'Ẩn bảng Mục lục' }).click();
  assert(await frame.evaluate(node => node.clientWidth) > width);

  await page.setViewportSize({ width: 320, height: 700 });
  assert(await page.locator('.lessons-screen').evaluate(element => element.scrollWidth <= element.clientWidth));
  await page.getByRole('button', { name: 'Hiện bảng Mục lục' }).click();
  await page.getByRole('button', { name: 'Hiện bảng Thiết lập' }).click();
  assert(await page.locator('#lesson-author-outline').isHidden());
}
