import assert from 'node:assert/strict';

export async function checkLessonReader(page) {
  const text = vi => ({ vi, en: '' });
  const content = { title: text('Nội dung'), instruction: text('Quan sát mô hình cùng nội dung bên phải.') };
  const brainstem = 'collection:285c4b2bbe57a435';
  const pons = 'collection:94f4f0afe3598035';
  const lesson = {
    id: 'reader-browser-check', version: 1, title: text('Bài kiểm thử khung học'), summary: text(''),
    modelId: 'collection:cc46df69f8495544', steps: [
      { ...content, id: 'intro', kind: 'text', title: text('Giới thiệu'), instruction: text('Nội dung kiểm thử cuộn đọc độc lập.\n\n'.repeat(100)) },
      { ...content, id: 'brainstem', kind: 'observe', title: text('Quan sát thân não'), targetId: brainstem },
      { ...content, id: 'reading', kind: 'text', title: text('Đọc về thân não') },
      { ...content, id: 'pons', kind: 'observe', title: text('Quan sát cầu não'), targetId: pons },
      { ...content, id: 'details', kind: 'text', title: text('Đọc về cầu não') },
      { ...content, id: 'quiz', kind: 'identify_structure', title: text('Nhận diện'), targetId: brainstem, choiceIds: [pons, 'collection:a6f4bb7246cd6e74'],
        answerId: pons, explanation: text('Đã chọn đúng cấu trúc.') },
      { ...content, id: 'summary', kind: 'text', title: text('Tổng kết') },
    ],
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(lesson => localStorage.setItem('soma.lesson:' + lesson.id, JSON.stringify(lesson)), lesson);
  await page.goto('/lessons/' + lesson.id + '/edit');
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  const model = page.locator('.lesson-model');
  const reader = page.locator('.lesson-reader-body');
  await page.locator('.lesson-player > .model-canvas[aria-busy="false"]').waitFor();
  assert.equal(await model.locator('.structure-search-field, .explode-control').count(), 0);
  await page.evaluate(() => { window.lessonReaderCanvas = document.querySelector('.lesson-player > .model-canvas canvas'); });
  const canvasUnchanged = () => page.evaluate(() => window.lessonReaderCanvas === document.querySelector('.lesson-player > .model-canvas canvas'));
  const original = await model.boundingBox();
  assert(await page.getByRole('button', { name: 'Thu gọn mô hình 3D', exact: true }).isHidden());
  const readingBounds = await page.locator('.lesson-step').boundingBox();
  assert(original.x + original.width <= readingBounds.x);
  assert(original.width > readingBounds.width && original.width < readingBounds.width * 1.4);
  await reader.evaluate(node => { node.scrollTop = node.scrollHeight; });
  assert(await reader.evaluate(node => node.scrollTop > 0));
  assert.deepEqual(await model.boundingBox(), original);
  assert(await page.getByRole('button', { name: 'Bước tiếp theo', exact: true }).isVisible());

  const jump = async title => {
    if (await page.locator('.lesson-reader-outline').isHidden()) await page.getByRole('button', { name: 'Mục lục', exact: true }).click();
    await page.locator('.lesson-reader-outline').getByRole('button', { name: title, exact: true }).click();
    assert(await page.locator('.lesson-reader-outline').isVisible(), 'Choosing a step must keep the outline open');
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
  };
  await jump('Đọc về cầu não');
  await jump('Đọc về thân não');
  assert(await model.isVisible());
  assert(await canvasUnchanged());
  await jump('Nhận diện');
  assert(await page.locator('.lesson-reader-outline').getByRole('button', { name: 'Tổng kết', exact: true }).isDisabled());
  const choices = page.locator('.lesson-step input[type=radio]');
  await choices.nth(1).check();
  await page.getByRole('button', { name: 'Kiểm tra đáp án', exact: true }).click();
  assert(await page.getByRole('button', { name: 'Bước tiếp theo', exact: true }).isDisabled());
  await choices.first().check();
  await page.getByRole('button', { name: 'Kiểm tra đáp án', exact: true }).click();
  assert(await page.getByRole('button', { name: 'Bước tiếp theo', exact: true }).isEnabled());
  await jump('Tổng kết');
  assert(await canvasUnchanged());
  await page.getByRole('button', { name: 'Đóng mục lục', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 700 });
  assert(await page.locator('.lessons-screen').evaluate(node => node.scrollWidth <= node.clientWidth));
  const expandedReader = await page.locator('.lesson-step').boundingBox();
  await page.getByRole('button', { name: 'Thu gọn mô hình 3D', exact: true }).click();
  assert(await model.isHidden());
  assert((await page.locator('.lesson-step').boundingBox()).height > expandedReader.height);
  assert(await canvasUnchanged());
  await page.setViewportSize({ width: 1280, height: 800 });
  assert(await model.isVisible(), 'Desktop restores the two-pane layout after a mobile collapse');
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole('button', { name: 'Hiện mô hình 3D', exact: true }).click();
  assert(await model.isVisible());
  await page.getByRole('button', { name: 'Hoàn thành', exact: true }).click();
  await page.getByRole('heading', { name: 'Đã hoàn thành bài học', exact: true }).waitFor();
  assert(await model.isVisible());
  assert(await canvasUnchanged());
  assert.deepEqual(await page.evaluate(id => JSON.parse(localStorage.getItem('soma.lesson:' + id)), lesson.id), lesson);

  const unfinished = { ...lesson, id: 'unfinished-reader-check', steps: [{ ...lesson.steps[5], choiceIds: [], answerId: '' }, lesson.steps[6]] };
  await page.evaluate(value => localStorage.setItem('soma.lesson:' + value.id, JSON.stringify(value)), unfinished);
  await page.goto('/lessons/' + unfinished.id + '/edit');
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  await page.getByRole('heading', { name: 'Nhận diện', exact: true }).waitFor();
  assert(await page.getByRole('button', { name: 'Kiểm tra đáp án', exact: true }).isDisabled());
  await page.getByRole('status').filter({ hasText: 'thêm ít nhất hai phương án' }).waitFor();
  assert(await page.getByRole('button', { name: 'Bước tiếp theo', exact: true }).isDisabled(), 'Preview follows the same completion requirements as student learning');
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất .lesson.br', exact: true }).click();
  assert((await download).suggestedFilename().endsWith('.lesson.br'), 'Unfinished drafts can be exported as portable packages for testing');
  assert.deepEqual(await page.evaluate(id => JSON.parse(localStorage.getItem('soma.lesson:' + id)), unfinished.id), unfinished);
}
