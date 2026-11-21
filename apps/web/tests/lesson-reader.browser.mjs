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
      { ...content, id: 'quiz', kind: 'observe', title: text('Nhận diện'), instruction: text(''), targetId: brainstem, mode: 'questions',
        questions: [{ id: 'identify-pons', prompt: text('Hãy nhận diện cầu não'), answerId: 'pons',
          explanation: text('Đã chọn đúng cấu trúc.'), choices: [{ id: 'pons', text: text('Cầu não') }, { id: 'medulla', text: text('Hành não') }] }] },
      { ...content, id: 'summary', kind: 'text', title: text('Tổng kết') },
    ],
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(lesson => localStorage.setItem('soma.lesson-v1:' + lesson.id, JSON.stringify(lesson)), lesson);
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
  assert(original.width > readingBounds.width && original.width < readingBounds.width * 2.5);
  await reader.evaluate(node => { node.scrollTop = node.scrollHeight; });
  assert(await reader.evaluate(node => node.scrollTop > 0));
  assert.deepEqual(await model.boundingBox(), original);
  assert(await page.getByRole('button', { name: 'Mục tiếp theo', exact: true }).isVisible());

  const jump = async title => {
    await page.locator('.lesson-reader-outline').getByRole('button', { name: title, exact: true }).click();
    assert(await page.locator('.lesson-reader-outline').isVisible(), 'Choosing a step must keep the outline open');
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
  };
  await jump('Đọc về cầu não');
  await jump('Đọc về thân não');
  assert(await model.isVisible());
  assert(await canvasUnchanged());
  await jump('Nhận diện');
  assert(await page.locator('.lesson-reader-outline').getByRole('button', { name: 'Tổng kết', exact: true }).isEnabled());
  const choices = page.locator('.lesson-step input[type=radio]');
  await choices.nth(1).check();
  await page.getByRole('button', { name: 'Kiểm tra đáp án', exact: true }).click();
  assert(await page.getByRole('button', { name: 'Mục tiếp theo', exact: true }).isEnabled());
  await choices.first().check();
  await page.getByRole('button', { name: 'Kiểm tra đáp án', exact: true }).click();
  assert(await page.getByRole('button', { name: 'Mục tiếp theo', exact: true }).isEnabled());
  await jump('Tổng kết');
  assert(await canvasUnchanged());
  await page.setViewportSize({ width: 320, height: 700 });
  assert(await page.locator('.lesson-reader-outline').isVisible());
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
  assert.deepEqual(await page.evaluate(id => JSON.parse(localStorage.getItem('soma.lesson-v1:' + id)), lesson.id), lesson);

  const unfinished = { ...lesson, id: 'unfinished-reader-check', steps: [{ ...lesson.steps[5], questions: [{ ...lesson.steps[5].questions[0], choices: [], answerId: '' }] }, lesson.steps[6]] };
  await page.evaluate(value => localStorage.setItem('soma.lesson-v1:' + value.id, JSON.stringify(value)), unfinished);
  await page.goto('/lessons/' + unfinished.id + '/edit');
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  await page.getByRole('heading', { name: 'Nhận diện', exact: true }).waitFor();
  assert(await page.getByRole('button', { name: 'Kiểm tra đáp án', exact: true }).isDisabled());
  await page.getByRole('status').filter({ hasText: 'thêm ít nhất hai phương án' }).waitFor();
  assert(await page.getByRole('button', { name: 'Mục tiếp theo', exact: true }).isEnabled());
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất .lesson.br', exact: true }).click();
  assert((await download).suggestedFilename().endsWith('.lesson.br'), 'Unfinished drafts can be exported as portable packages for testing');
  assert.deepEqual(await page.evaluate(id => JSON.parse(localStorage.getItem('soma.lesson-v1:' + id)), unfinished.id), unfinished);

  const studentContext = await page.context().browser().newContext({ baseURL: new URL(page.url()).origin });
  try {
    const student = await studentContext.newPage();
    await student.addInitScript(() => { document.hasFocus = () => false; });
    await student.clock.install();
    await student.goto('/home');
    const study = { ...lesson, id: 'reader-progress-check', modelId: '', steps: [lesson.steps[0], { ...lesson.steps[5], kind: 'text' }, lesson.steps[6]] };
    await student.evaluate(value => localStorage.setItem('soma.lesson-v1:' + value.id, JSON.stringify(value)), study);
    await student.goto('/lessons');
    const start = student.getByRole('button', { name: 'Vào học', exact: true });
    await start.click();
    const next = student.getByRole('button', { name: 'Mục tiếp theo', exact: true });
    const reading = student.locator('.lesson-player-stepbar button[data-reading]');
    const read = student.locator('.lesson-player-stepbar button[data-read]');
    await next.and(reading).waitFor();
    const studentOutline = student.getByRole('navigation', { name: 'Mục lục', exact: true });
    const introRow = studentOutline.getByRole('button', { name: 'Giới thiệu', exact: true });
    await introRow.locator('.lesson-outline-status:not([data-read])').waitFor();
    const readMarker = '.lesson-outline-status[data-read]';
    assert.equal(await next.evaluate(button => getComputedStyle(button).animationDuration), '15s');
    const fill = await next.evaluate(button => {
      const animation = button.getAnimations().find(value => value.animationName === 'lesson-reading');
      if (!animation) return [];
      const currentTime = animation.currentTime ?? 0;
      const sizes = [0, 7_500, 15_000].map(time => {
        animation.currentTime = time;
        return getComputedStyle(button).backgroundSize;
      });
      animation.currentTime = currentTime;
      return sizes;
    });
    assert.deepEqual(fill, ['0% 100%', '50% 100%', '100% 100%']);
    assert.equal(await student.locator('.lesson-study-status').count(), 0);
    await student.clock.fastForward(7_000);
    assert(await next.isDisabled());
    await student.evaluate(() => window.dispatchEvent(new Event('blur')));
    await student.clock.fastForward(9_000);
    await introRow.locator(readMarker).waitFor();
    assert.equal(await introRow.getAttribute('aria-description'), 'Đã đọc');
    await next.click();
    await student.getByRole('heading', { name: 'Nhận diện', exact: true }).waitFor();
    await student.getByRole('radio', { name: 'Cầu não', exact: true }).check();
    await student.getByRole('button', { name: 'Kiểm tra đáp án', exact: true }).click();
    assert(await next.isDisabled());
    await next.and(reading).waitFor();
    await student.clock.fastForward(16_000);
    await next.and(read).waitFor();
    await student.reload();
    await student.getByRole('heading', { name: 'Nhận diện', exact: true }).waitFor();
    assert(await student.getByRole('radio', { name: 'Cầu não', exact: true }).isChecked());
    await studentOutline.getByRole('button', { name: 'Nhận diện', exact: true }).locator(readMarker).waitFor();
    await next.click();
    await student.getByRole('heading', { name: 'Tổng kết', exact: true }).waitFor();
    await reading.waitFor();
    await student.clock.fastForward(8_000);
    await student.getByRole('button', { name: 'Thoát', exact: true }).click();
    const savedProgress = () => student.evaluate(id => localStorage.getItem(`soma.lesson-progress-v1:${id}`), study.id);
    const beforePreview = await savedProgress();
    await student.goto(`/lessons/${study.id}/edit`);
    await student.getByRole('button', { name: 'Xem trước', exact: true }).click();
    await introRow.locator(readMarker).waitFor();
    await studentOutline.getByRole('button', { name: 'Nhận diện', exact: true }).locator(readMarker).waitFor();
    const summaryRow = studentOutline.getByRole('button', { name: 'Tổng kết', exact: true });
    await summaryRow.click();
    await summaryRow.locator('.lesson-outline-status:not([data-read])').waitFor();
    assert.equal(await studentOutline.locator('.lesson-block-icon').count(), 0);
    assert.equal(await savedProgress(), beforePreview);
    await student.goto('/lessons');
    await start.click();
    await student.getByRole('heading', { name: 'Tổng kết', exact: true }).waitFor();
    const finish = student.getByRole('button', { name: 'Hoàn thành', exact: true });
    await finish.and(reading).waitFor();
    await student.clock.fastForward(8_000);
    assert(await finish.isDisabled());
    await student.clock.fastForward(8_000);
    await finish.click();
    await student.reload();
    await student.getByRole('heading', { name: 'Đã hoàn thành bài học', exact: true }).waitFor();
  } finally { await studentContext.close(); }
}
