import assert from 'node:assert/strict';
import { checkLessonResetFocus } from './lesson-background-stability.browser.mjs';
import { savedLesson, selectLessonModel } from './lesson-editor-tools.mjs';

export async function checkLessonBackground(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/lessons');
  await page.getByRole('button', { name: 'Tạo bài học', exact: true }).click();
  await page.getByLabel('Tên bài học', { exact: true }).fill('Nền liên tục');
  const canvas = page.locator('.lesson-editor > .model-canvas canvas');
  await page.locator('.lesson-editor > .model-canvas[aria-busy="false"]').waitFor();
  const emptyCanvas = await canvas.elementHandle();
  assert(await page.evaluate(async () => {
    const { AnatomyViewer } = await (await import('/src/anatomy/core.ts')).getWasm();
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const viewer = AnatomyViewer.background(canvas);
    const gl = canvas.getContext('webgl2');
    try {
      viewer.render();
      const pixel = new Uint8Array(4);
      gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return pixel[3] > 0 && viewer.visible_count() === 0 && gl.getError() === gl.NO_ERROR;
    } finally { viewer.free(); }
  }), 'Draw the actual viewer background before adding a model');
  assert(await page.locator('.lesson-scene-region').isHidden());
  const writing = page.locator('#lesson-author-writing');
  await writing.locator('.lesson-editor-stepbar-actions > button').click();
  await page.getByLabel('Tên mục', { exact: true }).fill('Bước đầu tiên');
  assert(await emptyCanvas.evaluate(canvas => canvas === document.querySelector('.lesson-editor > .model-canvas canvas')));
  assert(await page.locator('.lesson-scene-placeholder').isVisible());
  await selectLessonModel(page, 'collection:baf3076d0495a617');
  await page.locator('.lesson-editor > .model-canvas[aria-busy="false"]').waitFor();
  await page.locator('.lesson-editor-scene[data-active="true"]').waitFor();
  await page.getByText('277/277 cấu trúc đang hiện', { exact: true }).waitFor();
  const original = await canvas.elementHandle();
  await page.evaluate(async () => {
    const { AnatomyViewer } = await (await import('/src/anatomy/core.ts')).getWasm();
    const proto = AnatomyViewer.prototype, original = proto.apply_scene, reframe = proto.reframe;
    proto.apply_scene = function(...args) { window.backgroundViewer = this; return original.apply(this, args); };
    proto.reframe = function(...args) { window.backgroundFrame = args; return reframe.apply(this, args); };
    window.restoreBackgroundViewer = () => { proto.apply_scene = original; proto.reframe = reframe; };
  });
  const outline = page.locator('#lesson-author-outline');
  const details = () => outline.getByRole('button', { name: 'Thông tin bài học', exact: true }).click();
  const step = () => outline.locator('.lesson-outline-row').filter({ hasText: 'Bước đầu tiên' }).click();
  try {
    await details();
    await page.getByLabel('Tên bài học', { exact: true }).waitFor();
    assert(await original.evaluate(canvas => canvas === document.querySelector('.lesson-editor > .model-canvas canvas')));
    assert(await canvas.evaluate(canvas => canvas.parentElement.inert));
    for (const width of [1440, 390]) for (const reduced of [false, true]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
      const before = await writing.boundingBox();
      await step();
      await page.getByLabel('Tên mục', { exact: true }).waitFor();
      const animations = await page.locator('.lesson-author-center').evaluate(node => node.getAnimations().length);
      assert.equal(animations, 0, 'The document layout updates without a grid transition');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const after = await writing.boundingBox();
      assert(width > 900 ? after.x + after.width > before.x + before.width : after.y > before.y);
      assert(await original.evaluate(canvas => canvas === document.querySelector('.lesson-editor > .model-canvas canvas')));
      await page.waitForFunction(() => window.backgroundViewer?.visible_count() === 277);
      assert(await page.evaluate(() => {
        const host = document.querySelector('.lesson-editor > .model-canvas').getBoundingClientRect();
        const frame = document.querySelector('.model-focus-frame').getBoundingClientRect();
        const expected = [(frame.left - host.left) / host.width, (frame.top - host.top) / host.height,
          frame.width / host.width, frame.height / host.height];
        return window.backgroundFrame.every((value, index) => Math.abs(value - expected[index]) < 1e-5);
      }), 'Fit the model to the current layout');
      await page.locator('.lesson-editor-hud').waitFor({ state: 'visible' });
      await checkLessonResetFocus(page, 'backgroundViewer', '.lesson-editor > .model-canvas canvas');
      if (process.env.SOMA_LESSON_VISUALS) await page.screenshot({ path: `/tmp/soma-background-step-${width}.png` });
      await details();
      await page.getByLabel('Tên bài học', { exact: true }).waitFor();
      await page.waitForFunction(() => window.backgroundViewer?.visible_count() === 0);
      assert(await canvas.evaluate(canvas => canvas.parentElement.inert && !canvas.getContext('webgl2').isContextLost()));
      if (process.env.SOMA_LESSON_VISUALS) await page.screenshot({ path: `/tmp/soma-background-details-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await step();
    await page.locator('.orientation-axes [data-axis="Y"][data-direction="1"] .orientation-hit-target').click();
    await page.getByRole('button', { name: 'Lưu bài học', exact: true }).click();
    await page.getByRole('button', { name: 'Đã lưu', exact: true }).waitFor();
    const authored = (await savedLesson(page)).steps[0].view;
    await details();
    await step();
    await page.waitForFunction(view => {
      const current = window.backgroundViewer.camera_pose();
      return ['yaw', 'pitch', 'distance'].every(key => Math.abs(current[key] - view.camera[key]) < 1e-4);
    }, authored);
    assert(await original.evaluate(canvas => canvas === document.querySelector('.lesson-editor > .model-canvas canvas')));
  } finally { await page.evaluate(() => window.restoreBackgroundViewer()); }
}
