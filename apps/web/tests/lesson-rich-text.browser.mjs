import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { unpackLessonTar } from './lesson-package.fixture.mjs';
import { lessonBody } from './lesson-editor-tools.mjs';

export async function checkLessonRichText(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/lessons');
  await page.getByRole('button', { name: 'Tạo bài học', exact: true }).click();
  await page.getByLabel('Tên bài học').fill('Nội dung định dạng');
  await page.locator('#lesson-author-writing').getByRole('button', { name: 'Thêm bước học', exact: true }).click();
  await page.getByLabel('Tên mục (VI)').fill('Định dạng');
  const id = new URL(page.url()).pathname.split('/')[2];
  const saved = () => page.evaluate(id => JSON.parse(localStorage.getItem('soma.lesson:' + id)), id);
  await lessonBody(page).fill('Quan sát mô hình');
  await lessonBody(page).press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  assert.equal(await lessonBody(page).locator('strong').textContent(), 'Quan sát mô hình');
  assert((await saved()).steps[0].instruction.vi.includes('<strong>'));
  await page.getByRole('button', { name: 'English', exact: true }).click();
  assert.equal((await lessonBody(page).innerText()).trim(), '');
  await lessonBody(page).fill('Study the model');
  const authored = await saved();
  assert.deepEqual(authored.steps[0].instruction.html, ['vi', 'en']);
  assert(authored.steps[0].instruction.vi.includes('<strong>Quan sát mô hình</strong>'));
  await page.getByRole('button', { name: 'Tiếng Việt', exact: true }).click();
  assert.equal(await lessonBody(page).locator('strong').textContent(), 'Quan sát mô hình');
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  assert.equal(await page.locator('.lesson-rich-content strong').textContent(), 'Quan sát mô hình');
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  await page.reload();
  await page.locator('#lesson-author-outline .lesson-outline-row').filter({ hasText: 'Định dạng' }).click();
  assert.equal(await lessonBody(page).locator('strong').textContent(), 'Quan sát mô hình');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất .lesson.br', exact: true }).click();
  const download = await downloaded;
  assert.equal(download.suggestedFilename(), 'Nội dung định dạng.lesson.br');
  const files = unpackLessonTar(brotliDecompressSync(await readFile(await download.path())));
  const json = new TextDecoder().decode(files.get('lesson.json'));
  assert(json.includes('\n  "id":'), 'Export should be readable, indented JSON');
  const exported = JSON.parse(json);
  assert.deepEqual(exported, await saved());
  const edited = { ...exported, title: { vi: 'Bài chỉnh trực tiếp JSON', en: '' } };
  await page.getByRole('button', { name: 'Danh sách bài học', exact: true }).click();
  const upload = { name: 'edited-lesson.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(edited, null, 2)) };
  const cancelled = page.waitForEvent('dialog').then(dialog => dialog.dismiss());
  await page.locator('input[type="file"]').setInputFiles(upload);
  await cancelled;
  assert.deepEqual(await saved(), exported, 'Cancelling replacement must preserve the existing draft');
  const accepted = page.waitForEvent('dialog').then(dialog => dialog.accept());
  await page.locator('input[type="file"]').setInputFiles(upload);
  await accepted;
  await page.getByRole('heading', { name: 'Bài chỉnh trực tiếp JSON', exact: true }).waitFor();
  assert.deepEqual(await saved(), edited, 'Editing and reimporting JSON preserves rich text and step identities');

  const attack = '<p><strong>Safe</strong> <a href="javascript:window.lessonAttack=1">bad link</a></p><script>window.lessonAttack=1</script><img src="https://invalid.example/track" onerror="window.lessonAttack=1"><svg onload="window.lessonAttack=1"></svg><iframe srcdoc="<script>parent.lessonAttack=1</script>"></iframe><style>body{display:none}</style>';
  const legacy = { id: 'legacy-markup', kind: 'text', title: { vi: 'Văn bản cũ', en: '' },
    instruction: { vi: 'Giữ nguyên <strong>văn bản</strong>\nDòng hai', en: '' } };
  const malformed = { ...authored, id: 'rich-safety-check', steps: [
    { ...authored.steps[0], instruction: { vi: attack, en: '', html: ['vi'] } }, legacy,
  ] };
  const external = [];
  const request = req => { if (req.url().startsWith('https://invalid.example/')) external.push(req.url()); };
  page.on('request', request);
  try {
    await page.evaluate(lesson => localStorage.setItem('soma.lesson:' + lesson.id, JSON.stringify(lesson)), malformed);
    await page.goto('/lessons/rich-safety-check/edit');
    await page.locator('#lesson-author-outline .lesson-outline-row').filter({ hasText: 'Định dạng' }).click();
    assert.equal(await lessonBody(page).locator('script,img,svg,iframe,style').count(), 0);
    await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
    const rendered = page.locator('.lesson-rich-content');
    await rendered.locator('strong').waitFor();
    assert.equal(await rendered.locator('script,img,svg,iframe,style').count(), 0);
    assert.equal(await rendered.locator('a[href^="javascript:"]').count(), 0);
    assert.equal(await page.evaluate(() => window.lessonAttack), undefined);
    assert.deepEqual(external, [], 'Imported rich HTML must not load remote embeds before or after editing');
    await page.getByRole('button', { name: 'Bước tiếp theo', exact: true }).click();
    assert((await rendered.innerText()).includes('Giữ nguyên <strong>văn bản</strong>'));
    assert.equal(await rendered.locator('strong').count(), 0, 'Legacy plain text must not be interpreted as HTML');
  } finally { page.off('request', request); }
}
