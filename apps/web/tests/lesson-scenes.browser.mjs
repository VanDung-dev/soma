import { lessonBody, savedLesson, saveLessonDraft, selectLessonModel } from './lesson-editor-tools.mjs';
import assert from 'node:assert/strict';

export async function checkLessonScenes(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/lessons');
  await page.getByRole('button', { name: 'Tạo bài học', exact: true }).click();
  await page.getByLabel('Tên bài học').fill('Bài học cảnh 3D');
  const url = page.url();
  const saved = () => savedLesson(page);
  const add = async (title, instruction) => {
    assert.equal(await page.getByRole('button', { name: 'Quan sát 3D', exact: true }).count(), 0);
    await page.locator('#lesson-author-writing').getByRole('button', { name: 'Thêm mục', exact: true }).click();
    await page.getByLabel('Tên mục').fill(title);
    await lessonBody(page).fill(instruction);
  };
  await add('Mặt bên', 'Xoay và tách để quan sát mặt bên.');
  await selectLessonModel(page, 'collection:cc46df69f8495544');
  const frame = page.locator('.lesson-scene-region');
  await page.locator('.lesson-editor > .model-canvas[aria-busy="false"]').waitFor();
  await frame.locator('.orientation-axes [data-axis="Y"][data-direction="1"] .orientation-hit-target').click();
  const bounds = await frame.locator('.model-focus-frame').boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.55);
  await page.mouse.wheel(0, -100);
  const settings = page.locator('.lesson-model-settings[data-open="true"]');
  const openSettings = async () => {
    await frame.getByRole('button', { name: 'Thiết lập 3D', exact: true }).click();
    await settings.getByRole('button', { name: 'Hủy', exact: true }).and(settings.locator(':focus')).waitFor();
  };
  const applySettings = () => settings.getByRole('button', { name: 'Áp dụng', exact: true }).click();
  const slider = settings.getByRole('slider', { name: 'Mức độ tách', exact: true });
  await openSettings();
  await slider.focus();
  await slider.press('Home');
  for (let i = 0; i < 30; i++) await slider.press('ArrowRight');
  await applySettings();
  await saveLessonDraft(page);
  const first = (await saved()).steps[0];
  assert.equal(first.view.explosion, 30);
  assert(Math.abs(first.view.camera.yaw) > 0.1);
  assert(first.visibleIds.length > 0);
  await add('Góc nhìn trước', 'So sánh với mặt bên.');
  await openSettings();
  await settings.getByRole('button', { name: 'Sao chép cảnh mục trước', exact: true }).click();
  await slider.and(settings.locator('input:enabled')).waitFor();
  assert.equal(await slider.inputValue(), '30', 'Copying the previous scene keeps its authored explosion');
  await applySettings();
  await page.locator('.lesson-editor > .model-canvas[aria-busy="false"]').waitFor();
  await frame.locator('.orientation-axes [data-axis="X"][data-direction="1"] .orientation-hit-target').click();
  await openSettings();
  await slider.and(settings.locator('input:enabled')).waitFor();
  await slider.fill('100');
  assert.equal(await slider.inputValue(), '100');
  await applySettings();
  await saveLessonDraft(page);
  const lesson = await saved();
  assert.equal(lesson.steps[1].view.explosion, 100);
  assert.equal(lesson.steps[1].view.camera.yaw, 0);
  assert.notDeepEqual(lesson.steps[1].view, first.view);
  await page.reload();
  await page.getByLabel('Tên bài học').waitFor();
  await page.locator('#lesson-author-outline .lesson-outline-row').filter({ hasText: 'Mặt bên' }).click();
  await page.locator('.lesson-editor > .model-canvas[aria-busy="false"]').waitFor();
  await openSettings();
  assert.equal(await slider.inputValue(), '30');
  await slider.press('End');
  await settings.getByRole('button', { name: 'Hủy', exact: true }).click();
  await openSettings();
  assert.equal(await slider.inputValue(), '30');
  await settings.getByRole('button', { name: 'Về cảnh của mục', exact: true }).click();
  await applySettings();
  await saveLessonDraft(page);
  const restored = (await saved()).steps[0].view;
  for (const key of ['yaw', 'pitch', 'distance']) assert(Math.abs(restored.camera[key] - first.view.camera[key]) < 1e-4);

  const beforeLearning = await saved();
  await page.evaluate(async () => {
    const { AnatomyViewer } = await (await import('/src/core.ts')).getWasm();
    const applyScene = AnatomyViewer.prototype.apply_study_scene;
    AnatomyViewer.prototype.apply_study_scene = function (...args) {
      window.lessonScenesViewer = this;
      return applyScene.apply(this, args);
    };
    window.restoreLessonScenesViewer = () => { AnatomyViewer.prototype.apply_study_scene = applyScene; };
  });
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  const player = page.locator('.lesson-player');
  const playerModel = player.locator('.lesson-model');
  await player.locator(':scope > .model-canvas[aria-busy="false"]').waitFor();
  assert.equal(await player.locator('.explode-control, .structure-search').count(), 0);
  await page.mouse.move(1400, 5);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const snapshot = async () => Buffer.from(await player.locator(':scope > .model-canvas canvas').evaluate(canvas => {
    window.lessonScenesViewer.render();
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  const initialImage = await snapshot();
  const renderedPose = () => page.evaluate(() => window.lessonScenesViewer.camera_pose());
  const initialPose = await renderedPose();
  const box = await playerModel.locator('.model-focus-frame').boundingBox();
  for (const button of ['left', 'right']) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button });
    await page.waitForTimeout(1100);
    assert.equal(await player.locator('.lesson-hold-progress, .lesson-part-card').count(), 0);
    await page.mouse.up({ button });
  }
  assert(await sameRender(page, initialImage, await snapshot()), 'Holding cannot hide, detach or highlight authored parts');
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10);
  assert(await player.locator(':scope > .model-canvas .model-selection-box').isHidden(), 'Student input cannot select a group');
  await page.mouse.up();
  await page.keyboard.up('Shift');
  for (const button of ['left', 'right']) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button });
    await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 20, { steps: 3 });
    await page.mouse.up({ button });
  }
  await page.mouse.wheel(0, -150);
  assert(!(await snapshot()).equals(initialImage), 'Student camera controls must remain interactive');
  await player.getByRole('button', { name: 'Về cảnh của mục', exact: true }).click();
  await page.mouse.move(1400, 5);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const restoredImage = await snapshot();
  assert.deepEqual(await renderedPose(), initialPose, 'Reset restores the authored camera position');
  assert(await sameRender(page, initialImage, restoredImage), 'Reset must restore the authored render within one color rounding level');
  await player.getByRole('button', { name: 'Mục tiếp theo', exact: true }).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert(!(await snapshot()).equals(initialImage), 'Each step applies its own authored explosion and camera');
  await player.getByRole('button', { name: 'Mục trước', exact: true }).click();
  assert.deepEqual(await saved(), beforeLearning, 'Learner interactions must not edit the saved lesson');
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.locator('.lessons-screen').evaluate(node => node.scrollWidth <= node.clientWidth));
  assert.equal(await player.locator('.explode-control, .structure-search').count(), 0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await player.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  await frame.getByText(`${first.visibleIds.length}/${first.visibleIds.length} cấu trúc đang hiện`, { exact: true }).waitFor();
  const mode = page.getByRole('group', { name: 'Hiển thị trong mục', exact: true });
  await mode.getByRole('button', { name: 'Nội dung và câu hỏi', exact: true }).click();
  await saveLessonDraft(page);
  assert.equal((await saved()).steps[0].questions.length, 1);
  assert.deepEqual((await saved()).steps[0].view, beforeLearning.steps[0].view);
  await mode.getByRole('button', { name: 'Nội dung', exact: true }).click();
  await saveLessonDraft(page);
  assert.equal((await saved()).steps[0].kind, 'observe');
  assert.deepEqual((await saved()).steps[0].view, beforeLearning.steps[0].view);
  assert.equal(await page.locator('#lesson-author-inspector').count(), 0);
  await page.locator('.lesson-editor > .model-canvas[aria-busy="false"]').waitFor();
  await openSettings();
  assert.equal(await slider.inputValue(), '30');
  await settings.getByRole('button', { name: 'Hủy', exact: true }).click();
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  await player.locator(':scope > .model-canvas[aria-busy="false"]').waitFor();
  assert.equal(page.url(), url);
  await page.evaluate(() => window.restoreLessonScenesViewer());
}

async function sameRender(page, initialImage, restoredImage) {
  return restoredImage.equals(initialImage) || await page.evaluate(async files => {
    const images = await Promise.all(files.map(bytes => createImageBitmap(new Blob([Uint8Array.from(atob(bytes), char => char.charCodeAt(0))]))));
    try {
      if (images[0].width !== images[1].width || images[0].height !== images[1].height) return false;
      const canvas = new OffscreenCanvas(images[0].width, images[0].height);
      const context = canvas.getContext('2d');
      const pixels = images.map(image => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      });
      return pixels[0].every((value, index) => Math.abs(value - pixels[1][index]) <= 1);
    } finally { images.forEach(image => image.close()); }
  }, [initialImage.toString('base64'), restoredImage.toString('base64')]);
}
