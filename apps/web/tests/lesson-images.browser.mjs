import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { packLessonTar, readLessonMetadata, unpackLessonTar } from './lesson-package.fixture.mjs';
import { chooseLessonImage, lessonBody, savedLesson, saveLessonDraft } from './lesson-editor-tools.mjs';

export async function checkLessonImages(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/lessons');
  await page.getByRole('button', { name: 'Tạo bài học', exact: true }).click();
  await page.getByLabel('Tên bài học').fill('Bài học có ảnh');
  await page.locator('#lesson-author-writing').getByRole('button', { name: 'Thêm mục', exact: true }).click();
  await page.getByLabel('Tên mục').fill('Quan sát ảnh');
  await lessonBody(page).fill('Hình minh họa được lưu cùng bài học.');
  const id = new URL(page.url()).pathname.split('/')[2];
  const saved = () => savedLesson(page, id);
  const image = await readFile(new URL('../public/home/anatomy.png', import.meta.url));
  const insert = async (upload, direction) => {
    await lessonBody(page).press('ControlOrMeta+a');
    await lessonBody(page).press(direction);
    await chooseLessonImage(page, upload);
    const inserted = lessonBody(page).getByAltText(upload.name, { exact: true });
    await inserted.waitFor();
    await inserted.evaluate(img => img.decode());
  };
  await insert({ name: 'anatomy.png', mimeType: 'image/png', buffer: image }, 'ArrowLeft');
  const storedImage = Buffer.from(await lessonBody(page).locator('img').last().evaluate(async img =>
    [...new Uint8Array(await (await fetch(img.src)).arrayBuffer())]));
  assert(storedImage.length < image.length, 'Squoosh must reduce the uploaded PNG');
  const hash = createHash('sha256').update(storedImage).digest('hex');
  const path = `images/${hash}.webp`;
  assert(await lessonBody(page).locator('img').last().evaluate(async (img, base64) => {
    const original = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))]));
    try {
      if (img.naturalWidth !== original.width || img.naturalHeight !== original.height) return false;
      const canvas = document.createElement('canvas'); canvas.width = original.width; canvas.height = original.height;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(original, 0, 0);
      const before = context.getImageData(0, 0, canvas.width, canvas.height).data;
      context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(img, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data.every((value, index) => {
        const alpha = before[index - index % 4 + 3];
        return index % 4 === 3 || alpha === 255 ? value === before[index] : Math.abs(value - before[index]) <= Math.ceil(255 / alpha);
      });
    } finally { original.close(); }
  }, image.toString('base64')), 'PNG preserves dimensions, alpha and opaque pixels; translucent colors stay within one premultiplied rounding level');
  const formats = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#5d8875'; ctx.fillRect(0, 0, 160, 90);
    return ['image/jpeg', 'image/webp'].map(type => ({ type, value: canvas.toDataURL(type).split(',')[1] }));
  });
  await lessonBody(page).press('ControlOrMeta+a');
  await lessonBody(page).press('ArrowRight');
  await lessonBody(page).press('Enter');
  for (const format of formats) {
    const bytes = Buffer.from(format.value, 'base64');
    await insert({ name: format.type === 'image/jpeg' ? 'test.jpg' : 'test.webp', mimeType: format.type, buffer: bytes }, 'ArrowRight');
    const stored = Buffer.from(await lessonBody(page).locator('img').last().evaluate(async img =>
      [...new Uint8Array(await (await fetch(img.src)).arrayBuffer())]));
    if (format.type === 'image/jpeg') {
      assert(stored.length < bytes.length, 'JPEG upload is compressed');
      assert.equal(stored.toString('ascii', 8, 12), 'WEBP');
    } else assert.deepEqual(stored, bytes, 'Existing WebP is not recompressed');
  }
  assert.equal(await lessonBody(page).locator('img').count(), 3);
  const illustration = lessonBody(page).getByAltText('anatomy.png', { exact: true });
  const changeAlignment = async (alignment, addCaption = false) => {
    await illustration.dblclick();
    const properties = page.locator('.jodit-dialog_active_true');
    if (addCaption) await properties.getByRole('checkbox', { name: 'Chú thích ảnh', exact: true }).check();
    await properties.getByRole('tab', { name: 'Nâng cao', exact: true }).click();
    await properties.getByRole('combobox').selectOption(alignment);
    await properties.getByRole('button', { name: 'Áp dụng', exact: true }).click();
    await properties.waitFor({ state: 'hidden' });
  };
  await illustration.click();
  const handle = page.locator('.jodit-resizer__bottom-right');
  await handle.waitFor();
  const corner = await handle.boundingBox();
  const widthBefore = (await illustration.boundingBox()).width;
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x - 30, corner.y, { steps: 4 });
  await page.mouse.up();
  const resizedWidth = Math.round((await illustration.boundingBox()).width);
  assert(resizedWidth < widthBefore - 15, 'Dragging the resize handle reduces image width');
  await changeAlignment('left', true);
  const figure = lessonBody(page).locator('figure').filter({ has: page.getByAltText('anatomy.png', { exact: true }) });
  assert.equal(await figure.evaluate(el => getComputedStyle(el).float), 'left');
  await figure.locator('figcaption').fill('Mô hình giải phẫu');
  await changeAlignment('right');
  assert.equal(await figure.evaluate(el => getComputedStyle(el).float), 'right');
  assert.deepEqual(await page.evaluate(async () =>
    (await indexedDB.databases()).filter(({ name }) => name?.startsWith('soma-lesson-images'))),
  [{ name: 'soma-lesson-images-v1', version: 1 }]);
  await saveLessonDraft(page);
  const original = await saved();
  assert(original.steps[0].instruction.vi.includes(path));
  assert.match(original.steps[0].instruction.vi, /<figure[^>]*lesson-image-right/);
  assert.match(original.steps[0].instruction.vi, /<figcaption>Mô hình giải phẫu<\/figcaption>/);
  assert(!original.steps[0].instruction.vi.includes('blob:'));
  assert(!original.steps[0].instruction.vi.includes('data:'));
  assert(!original.steps[0].instruction.vi.includes('data-lesson-image'));
  await page.reload();
  await page.locator('#lesson-author-outline .lesson-outline-row').filter({ hasText: 'Quan sát ảnh' }).click();
  await lessonBody(page).locator('img').first().waitFor();
  await lessonBody(page).locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
  assert(await lessonBody(page).locator('img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)));
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  const rendered = page.locator('.lesson-rich-content img');
  await rendered.first().waitFor();
  await rendered.evaluateAll(images => Promise.all(images.map(img => img.decode())));
  assert(await rendered.evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)));
  const renderedFigure = page.locator('.lesson-instructions figure.lesson-image-right');
  assert.equal(await renderedFigure.locator('figcaption').innerText(), 'Mô hình giải phẫu');
  assert(Math.abs((await renderedFigure.boundingBox()).width - resizedWidth) <= 1, 'The lesson player preserves the resized width');
  assert(await renderedFigure.evaluate(el => {
    const image = el.getBoundingClientRect();
    const walker = document.createTreeWalker(el.parentElement, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      if (!node.textContent.includes('Hình minh họa')) continue;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 4);
      const text = range.getBoundingClientRect();
      return text.right < image.left && text.top >= image.top && text.top < image.bottom;
    }
    return false;
  }), 'Lesson text wraps beside the right-aligned illustration');
  if (process.env.SOMA_PACKAGE_SCREENSHOT) await page.screenshot({ path: process.env.SOMA_PACKAGE_SCREENSHOT });
  await page.setViewportSize({ width: 320, height: 700 });
  assert.equal(await renderedFigure.evaluate(el => getComputedStyle(el).float), 'none', 'Images stack on narrow layouts');
  assert(await page.locator('.lessons-screen').evaluate(node => node.scrollWidth <= node.clientWidth));
  const widths = await rendered.evaluateAll(images => images.map(img => [img.getBoundingClientRect().width, img.parentElement.clientWidth]));
  assert(widths.every(([imageWidth, contentWidth]) => imageWidth <= contentWidth + 0.5),
    `Reader images must fit within their content at 320px: ${JSON.stringify(widths)}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất .lesson.br', exact: true }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'Bài học có ảnh.lesson.br');
  const compressed = await readFile(await download.path());
  const tar = brotliDecompressSync(compressed);
  const files = unpackLessonTar(tar);
  assert.deepEqual(Buffer.from(files.get(path)), storedImage);
  assert.deepEqual(readLessonMetadata(files), original);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(files.get('manifest.json'))), { format: 'soma-lesson', version: 1 });
  assert.equal([...files.keys()].filter(path => path.startsWith('images/')).length, 3);
  if (process.env.SOMA_PACKAGE_ARTIFACT) await writeFile(process.env.SOMA_PACKAGE_ARTIFACT, compressed);
  await page.getByRole('button', { name: 'Thoát', exact: true }).click();
  const card = page.locator('.lesson-card').filter({ has: page.getByRole('heading', { name: 'Bài học có ảnh', exact: true }) });
  const confirm = page.getByRole('dialog', { name: 'Xác nhận' });
  await card.getByRole('button', { name: 'Xóa', exact: true }).click();
  await confirm.getByRole('button', { name: 'Xóa', exact: true }).click();
  await card.waitFor({ state: 'hidden' });
  const upload = { name: 'renamed.lesson.br', mimeType: 'application/octet-stream', buffer: compressed };
  await page.locator('input[type=file]').setInputFiles(upload);
  await card.waitFor();
  await card.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
  await page.locator('#lesson-author-outline .lesson-outline-row').filter({ hasText: 'Quan sát ảnh' }).click();
  await lessonBody(page).locator('img').first().waitFor();
  await lessonBody(page).locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
  assert(await lessonBody(page).locator('img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)));
  assert.deepEqual(await saved(), original);
  await page.getByRole('button', { name: 'Thoát', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(upload);
  await confirm.getByRole('button', { name: 'Hủy', exact: true }).click();
  assert.deepEqual(await saved(), original);
  const invalid = new Map(files); invalid.delete(path);
  await page.locator('input[type=file]').setInputFiles({ ...upload, buffer: brotliCompressSync(packLessonTar(invalid)) });
  await page.getByRole('alert').waitFor();
  assert.deepEqual(await saved(), original, 'Invalid import preserves draft');
  const corrupt = new Map(files); corrupt.set(path, new TextEncoder().encode('<svg onload="alert(1)"/>'));
  await page.locator('input[type=file]').setInputFiles({ ...upload, buffer: brotliCompressSync(packLessonTar(corrupt)) });
  await page.getByRole('status').filter({ hasText: 'Đang mở gói bài học' }).waitFor({ state: 'hidden' });
  assert.deepEqual(await saved(), original, 'Invalid image cannot replace draft');
  const tooLarge = Buffer.from(image); tooLarge.writeUInt32BE(100000, 16);
  const oversized = new Map(files); oversized.set(path, tooLarge);
  await page.locator('input[type=file]').setInputFiles({ ...upload, buffer: brotliCompressSync(packLessonTar(oversized)) });
  await page.getByRole('status').filter({ hasText: 'Đang mở gói bài học' }).waitFor({ state: 'hidden' });
  assert.deepEqual(await saved(), original, 'Image dimensions are bounded before decoding');
  const wrongHash = new Map(files); wrongHash.set(path, Buffer.from(formats[0].value, 'base64'));
  await page.locator('input[type=file]').setInputFiles({ ...upload, buffer: brotliCompressSync(packLessonTar(wrongHash)) });
  await page.getByRole('status').filter({ hasText: 'Đang mở gói bài học' }).waitFor({ state: 'hidden' });
  assert.deepEqual(await saved(), original, 'A valid image with the wrong hash cannot replace draft');
  const fresh = await page.context().browser().newContext({ baseURL: new URL(page.url()).origin });
  try {
    const imported = await fresh.newPage();
    await imported.goto('/lessons');
    await imported.getByRole('status').filter({ hasText: 'Chưa có bài học' }).waitFor();
    await imported.locator('input[type=file]').setInputFiles(upload);
    await imported.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
    await imported.locator('#lesson-author-outline .lesson-outline-row').filter({ hasText: 'Quan sát ảnh' }).click();
    await lessonBody(imported).locator('img').first().waitFor();
    await lessonBody(imported).locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
    assert.equal(await lessonBody(imported).locator('img').count(), 3, 'A fresh profile needs only the package');
  } finally { await fresh.close(); }
  console.log('Image package round trip', JSON.stringify({ tarBytes: tar.length, brotliBytes: compressed.length, originalImageBytes: image.length, storedImageBytes: storedImage.length }));
}
