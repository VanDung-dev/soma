import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { unpackLessonTar } from './lesson-package.fixture.mjs';
import { lessonBody } from './lesson-editor-tools.mjs';

export async function checkLessonEditorExperience(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/lessons');
  await page.getByRole('button', { name: 'Tạo bài học', exact: true }).click();
  const id = new URL(page.url()).pathname.split('/')[2];
  const saved = () => page.evaluate(id => JSON.parse(localStorage.getItem('soma.lesson:' + id)), id);
  const writing = page.locator('#lesson-author-writing');
  const frame = page.locator('.lesson-scene-region');
  assert.equal(await page.locator('.lesson-model:visible, .tox-tinymce, .structure-search-field:visible').count(), 0, 'Lesson details are a simple card form');
  await page.getByLabel('Tên bài học').fill('Thông tin và từng bước');
  await page.getByLabel('Mô tả ngắn').fill('Mô tả trên thẻ bài học.');
  const cover = await readFile(new URL('../public/home/anatomy.png', import.meta.url));
  await page.getByLabel('Ảnh bìa bài học', { exact: true }).setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: cover });
  await writing.locator('.lesson-cover').waitFor();
  await writing.getByRole('button', { name: 'Lưu thông tin', exact: true }).click();
  const details = await saved();
  assert.equal(details.summary.vi, 'Mô tả trên thẻ bài học.');
  assert(!details.summary.html);
  assert.match(details.cover, /^images\/[a-f0-9]{64}\.(png|jpg|webp)$/);
  await page.getByRole('button', { name: 'Danh sách bài học', exact: true }).click();
  const card = page.locator('.lesson-card').filter({ hasText: 'Thông tin và từng bước' });
  await card.locator('img').waitFor();
  assert(await card.locator('img').evaluate(img => img.decode().then(() => img.naturalWidth > 0)));
  await page.reload();
  await card.locator('img').waitFor();
  await card.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
  assert.equal(await page.getByLabel('Mô tả ngắn').inputValue(), details.summary.vi);
  assert.equal(await page.locator('.tox-tinymce').count(), 0);
  await writing.getByRole('button', { name: 'Thêm bước học', exact: true }).click();
  await page.getByLabel('Tên mục').fill('Hai dòng');
  assert.equal(await page.locator('#lesson-author-inspector, #lesson-toggle-inspector, #lesson-scene-structures').count(), 0);
  assert.equal(await page.locator('.structure-search-field').count(), 1, 'The editor has one structure search');
  assert.equal((await page.locator('.structure-search-field').textContent()).trim(), '', 'Search shows only the magnifier');
  const settingsButton = frame.getByRole('button', { name: 'Thiết lập 3D', exact: true });
  assert(await settingsButton.evaluate(button => !!button.closest('.lesson-editor-hud')));
  await settingsButton.click();
  const settings = page.locator('#lesson-model-settings:popover-open');
  assert.equal(await settings.locator('.structure-tree > li').count(), 9, 'Model and structure settings share one panel');
  assert(await settings.evaluate(panel => !!panel.closest('.lesson-editor-hud')));
  await page.getByRole('button', { name: 'Đóng thiết lập 3D', exact: true }).click();
  const search = page.locator('.structure-search-popover:popover-open');
  const ids = [];
  for (const query of ['xương hàm dưới', 'masseter']) {
    await frame.getByRole('button', { name: 'Tìm và thêm cấu trúc 3D', exact: true }).click();
    await search.getByRole('combobox').fill(query);
    const option = search.locator('[role="option"][data-structure-id]').first();
    await option.waitFor();
    ids.push(await option.getAttribute('data-structure-id'));
    await option.click();
    await page.locator('.lesson-editor > .model-canvas[aria-busy="false"]').waitFor();
  }
  assert.deepEqual((await saved()).steps[0].visibleIds, ids);
  const part = frame.getByRole('region', { name: 'Thông tin bộ phận' });
  await part.getByRole('heading').waitFor();
  assert.equal(await part.locator('.information-heading .lesson-button').count(), 1);
  assert(await part.evaluate(node => getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(node).boxShadow === 'none'));
  const bounds = await part.boundingBox();
  const canvas = await frame.boundingBox();
  assert(Math.abs(bounds.x - canvas.x - 10) <= 1);
  assert(Math.abs(bounds.width - canvas.width + 20) <= 1, 'Part details span the model interaction region');
  assert(bounds.y > canvas.y + canvas.height / 2, 'Part details sit near the bottom');
  await settingsButton.click();
  await settings.locator('.structure-tree > li > .tree-row .tree-name').first().click();
  await page.getByRole('button', { name: 'Đóng thiết lập 3D', exact: true }).click();
  assert.equal(await part.count(), 0, 'Browsing a group clears the previous part card');
  await frame.getByRole('button', { name: 'Tìm và thêm cấu trúc 3D', exact: true }).click();
  await search.getByRole('combobox').fill('masseter');
  await search.locator('[role="option"][data-structure-id]').first().click();
  await part.getByRole('heading').waitFor();
  await part.getByRole('button', { name: 'Đóng thông tin bộ phận', exact: true }).click();
  const body = lessonBody(page);
  await body.fill('Dòng thứ nhất');
  await body.press('End');
  await body.press('Enter');
  assert.equal(await page.locator('.lesson-author-alerts').count(), 0, 'Enter must not report a storage conflict');
  await page.keyboard.type('Dòng thứ hai');
  await body.press('Shift+Enter');
  await page.keyboard.type('Dòng thứ ba');
  await body.press('ControlOrMeta+z');
  await body.press('ControlOrMeta+Shift+z');
  assert.equal(await page.locator('.lesson-author-alerts').count(), 0);
  const slider = frame.getByRole('slider', { name: 'Mức độ tách', exact: true });
  await slider.focus(); await slider.press('End');
  await writing.getByRole('button', { name: 'Lưu bước', exact: true }).click();
  await writing.getByRole('status').filter({ hasText: 'Đã lưu bước' }).waitFor();
  assert.equal(await part.count(), 0, 'Saving must not reopen dismissed part information');
  const first = (await saved()).steps[0];
  assert.equal(first.view.explosion, 100);
  await writing.getByRole('button', { name: 'Thêm bước học', exact: true }).click();
  await page.getByLabel('Tên mục').fill('Chỉ nội dung');
  await body.fill('Bước này không hiển thị mô hình.');
  await page.getByRole('checkbox', { name: 'Hiển thị mô hình 3D ở bước này', exact: true }).uncheck();
  assert(await frame.isHidden());
  await writing.getByRole('button', { name: 'Lưu bước', exact: true }).click();
  const hidden = (await saved()).steps[1];
  assert.equal(hidden.showModel, false);
  assert.deepEqual(hidden.view, first.view, 'Hiding 3D preserves the authored scene');
  await page.reload();
  await page.getByLabel('Tên bài học').waitFor();
  assert.equal(await page.locator('.lesson-model:visible, .tox-tinymce').count(), 0);
  if (await page.locator('#lesson-author-outline').isHidden()) await page.locator('#lesson-toggle-outline').click();
  await page.locator('#lesson-author-outline .lesson-outline-row').filter({ hasText: 'Chỉ nội dung' }).click();
  assert(await frame.isHidden());
  assert.equal(await body.innerText(), hidden.instruction.vi.replace(/<[^>]+>/g, ''));
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  const player = page.locator('.lesson-player');
  await player.locator('.model-canvas[aria-busy="false"]').waitFor();
  const headerBounds = await player.locator('.lesson-player-header').boundingBox();
  const headingBounds = await player.locator('.lesson-player-heading').boundingBox();
  assert(Math.abs(headingBounds.x + headingBounds.width / 2 - headerBounds.x - headerBounds.width / 2) <= 1, 'The preview heading is centered');
  const outlineBounds = await player.getByRole('button', { name: 'Mục lục', exact: true }).boundingBox();
  assert(outlineBounds.x + outlineBounds.width <= headingBounds.x, 'The outline toggle sits to the left of the title');
  assert.equal(await player.locator('.explode-control, .structure-search-field, .lesson-part-card').count(), 0, 'Student preview has only camera controls');
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await checkLessonHeader(page, '.lesson-player-header', '.lesson-player-heading');
    assert(await player.evaluate(node => node.scrollWidth <= node.clientWidth));
  }
  const viewer = await player.locator('canvas').elementHandle();
  assert(await player.locator('.lesson-model').isVisible());
  await player.getByRole('button', { name: 'Bước tiếp theo', exact: true }).click();
  assert(await player.locator('.lesson-model').isHidden());
  assert.equal(await player.locator('.lesson-workspace').getAttribute('data-model'), 'false');
  await player.getByRole('button', { name: 'Bước trước', exact: true }).click();
  assert(await player.locator('.lesson-model').isVisible());
  assert(await viewer.evaluate(canvas => canvas === document.querySelector('.lesson-player canvas')), 'Changing model visibility keeps the learner viewer');
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Hiển thị mô hình 3D ở bước này', exact: true }).check();
  await page.locator('.lesson-editor > .model-canvas[aria-busy="false"]').waitFor();
  assert.equal(await slider.inputValue(), '100');
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(await page.locator('.lessons-screen').evaluate(node => node.scrollWidth <= node.clientWidth));
    await checkLessonHeader(page, '.lesson-author-bar', '.lesson-author-heading');
    assert.equal(await page.locator('.structure-search-field').count(), 1);
    assert((await frame.locator('.lesson-scene-viewport').boundingBox()).height >= 140);
  }
  const expected = await saved();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất .lesson.br', exact: true }).click();
  const download = await downloadEvent;
  const bytes = await readFile(await download.path());
  const files = unpackLessonTar(brotliDecompressSync(bytes));
  assert(files.has(expected.cover), 'Export includes the lesson cover');
  const exported = JSON.parse(new TextDecoder().decode(files.get('lesson.json')));
  expected.steps.forEach((step, index) => {
    if (!step.view) return;
    const camera = exported.steps[index].view.camera;
    assert(camera.pan.every((value, axis) => Math.abs(value - step.view.camera.pan[axis]) < 1e-14), 'Camera pan survives JSON round-trip precision');
    camera.pan = step.view.camera.pan;
  });
  assert.deepEqual(exported, expected);
  const fresh = await page.context().browser().newContext({ baseURL: new URL(page.url()).origin });
  try {
    const imported = await fresh.newPage();
    await imported.goto('/lessons');
    await imported.locator('input[type=file]').setInputFiles({ name: 'cover.lesson.br', mimeType: 'application/octet-stream', buffer: bytes });
    await imported.locator('.lesson-card img').waitFor();
    assert(await imported.locator('.lesson-card img').evaluate(img => img.decode().then(() => img.naturalWidth > 0)));
    await imported.evaluate(lesson => localStorage.setItem('soma.lesson:hidden-only', JSON.stringify({
      ...lesson, id: 'hidden-only', cover: undefined, modelId: '', steps: [{ ...lesson.steps[1], showModel: false }],
    })), expected);
    await imported.goto('/lessons/hidden-only/edit');
    await imported.getByRole('button', { name: 'Xem trước', exact: true }).click();
    await imported.getByRole('heading', { name: 'Chỉ nội dung', exact: true }).waitFor();
    assert.equal(await imported.locator('.lesson-model:visible, .lesson-preview-issue').count(), 0, 'Hidden-only lessons need no 3D model');
    await imported.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
    await imported.getByLabel('Tên bài học').waitFor();
    await imported.getByRole('button', { name: 'Xem trước', exact: true }).click();
    await imported.getByRole('button', { name: 'Danh sách bài học', exact: true }).click();
    assert.equal(new URL(imported.url()).pathname, '/lessons', 'Preview exit goes to the library');
    await imported.locator('.lesson-card:has(img)').getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
    await imported.getByRole('button', { name: 'Danh sách bài học', exact: true }).click();
    assert.equal(new URL(imported.url()).pathname, '/lessons', 'Editor exit goes to the library');
  } finally { await fresh.close(); }
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('soma.lesson:')) throw new DOMException('Full', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  await page.getByLabel('Tên mục').fill('Chưa ghi được');
  await writing.getByRole('button', { name: 'Lưu bước', exact: true }).click();
  assert.deepEqual(await saved(), expected);
  assert.equal(await writing.getByRole('status').filter({ hasText: 'Đã lưu bước' }).count(), 0);
  await page.reload();
  await page.getByLabel('Tên bài học').waitFor();
  if (await page.locator('#lesson-author-outline').isHidden()) await page.locator('#lesson-toggle-outline').click();
  await page.locator('#lesson-author-outline .lesson-outline-row').filter({ hasText: 'Chỉ nội dung' }).click();
  await page.locator('.lesson-editor > .model-canvas[aria-busy="false"]').waitFor();
  const external = await saved(); external.title.vi = 'Đã sửa ở tab khác';
  await page.evaluate(lesson => localStorage.setItem('soma.lesson:' + lesson.id, JSON.stringify(lesson)), external);
  await page.getByLabel('Tên mục').fill('Không ghi đè tab khác');
  await writing.getByRole('button', { name: 'Lưu bước', exact: true }).click();
  assert.deepEqual(await saved(), external);
  assert(await page.locator('.lesson-author-alerts').isVisible());
}

export async function checkLessonHeader(page, selector, headingSelector) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry = await page.locator(selector).evaluate((header, headingSelector) => {
    const box = header.getBoundingClientRect();
    const title = header.querySelector(headingSelector).getBoundingClientRect();
    return { height: box.height, radius: getComputedStyle(header).borderRadius,
      center: title.x + title.width / 2 - box.x - box.width / 2,
      buttons: [...header.querySelectorAll('.lesson-button, .controls-info')].filter(button => button.getBoundingClientRect().width).map(button => {
        const child = button.getBoundingClientRect();
        return { height: child.height, radius: getComputedStyle(button).borderRadius, inset: Math.min(child.x - box.x, box.right - child.right),
          contained: child.top >= box.top && child.bottom <= box.bottom };
      }) };
  }, headingSelector);
  assert(geometry.height >= 48);
  assert.equal(geometry.radius, '24px');
  assert(Math.abs(geometry.center) <= 1, 'The title is centered between equal side columns');
  for (const button of geometry.buttons) {
    assert.equal(button.height, 28);
    assert.equal(button.radius, '14px');
    assert(button.contained, 'Wrapped toolbar controls stay inside the header');
    assert(button.inset >= 9.5, 'Toolbar controls respect the outer 10px inset');
  }
}
