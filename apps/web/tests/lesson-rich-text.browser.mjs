import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { packLessonTar, readLessonMetadata, unpackLessonTar } from './lesson-package.fixture.mjs';
import { lessonBody, savedLesson, saveLessonDraft } from './lesson-editor-tools.mjs';

export async function checkLessonRichText(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/lessons');
  await page.getByRole('button', { name: 'Tạo bài học', exact: true }).click();
  await page.getByLabel('Tên bài học').fill('Nội dung định dạng');
  await page.locator('#lesson-author-writing').getByRole('button', { name: 'Thêm mục', exact: true }).click();
  await page.getByLabel('Tên mục').fill('Định dạng');
  const id = new URL(page.url()).pathname.split('/')[2];
  const saved = () => savedLesson(page, id);
  await lessonBody(page).fill('Quan sát mô hình');
  await lessonBody(page).press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Đậm', exact: true }).click();
  assert.equal(await lessonBody(page).locator('strong').textContent(), 'Quan sát mô hình');
  await saveLessonDraft(page);
  assert((await saved()).steps[0].instruction.vi.includes('<strong>'));
  await page.getByRole('button', { name: 'English', exact: true }).click();
  assert.equal((await lessonBody(page).innerText()).trim(), '');
  await lessonBody(page).fill('Study the model');
  await saveLessonDraft(page);
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
  const exported = readLessonMetadata(files);
  assert.deepEqual(exported, await saved());
  const edited = { ...exported, title: { vi: 'Bài chỉnh trực tiếp gói', en: '' } };
  await page.getByRole('button', { name: 'Thoát', exact: true }).click();
  files.set('lesson.json', new TextEncoder().encode(JSON.stringify({ ...JSON.parse(json), title: edited.title }, null, 2)));
  const upload = { name: 'edited-lesson.lesson.br', mimeType: 'application/octet-stream', buffer: brotliCompressSync(packLessonTar(files)) };
  const confirm = page.getByRole('dialog', { name: 'Xác nhận' });
  await page.locator('input[type="file"]').setInputFiles(upload);
  await confirm.getByRole('button', { name: 'Hủy', exact: true }).click();
  assert.deepEqual(await saved(), exported, 'Cancelling replacement must preserve the existing draft');
  await page.locator('input[type="file"]').setInputFiles(upload);
  await confirm.getByRole('button', { name: 'Thay thế', exact: true }).click();
  await page.getByRole('heading', { name: 'Bài chỉnh trực tiếp gói', exact: true }).waitFor();
  assert.deepEqual(await saved(), edited, 'Reimporting a lesson package preserves rich text and section identities');

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
    await page.evaluate(lesson => localStorage.setItem('soma.lesson-v1:' + lesson.id, JSON.stringify(lesson)), malformed);
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
    await page.getByRole('button', { name: 'Mục tiếp theo', exact: true }).click();
    assert((await rendered.innerText()).includes('Giữ nguyên <strong>văn bản</strong>'));
    assert.equal(await rendered.locator('strong').count(), 0, 'Legacy plain text must not be interpreted as HTML');
  } finally { page.off('request', request); }
}
