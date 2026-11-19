import assert from 'node:assert/strict';
import { checkLessonResetFocus } from './lesson-background-stability.browser.mjs';

export async function checkLessonPlayerBackground(page) {
  const text = vi => ({ vi, en: vi });
  const root = 'collection:baf3076d0495a617';
  const lesson = { id: 'player-background', version: 1, title: text('Nền bài học'), summary: text('Mô tả'), modelId: root,
    steps: [
      { id: 'intro', kind: 'text', showModel: false, title: text('Giới thiệu'), instruction: text('Đọc phần giới thiệu.') },
      { id: 'model', kind: 'observe', modelIds: [root], targetId: root, title: text('Quan sát'), instruction: text('Quan sát hệ xương.') },
      { id: 'reading', kind: 'text', showModel: false, title: text('Đọc thêm'), instruction: text('Nội dung đọc thêm.') },
      { id: 'quiz', kind: 'text', showModel: false, mode: 'questions', title: text('Câu hỏi'), instruction: text(''), questions: [
        { id: 'q', prompt: text('Chọn đáp án đúng'), choices: [{ id: 'a', text: text('Đúng') }, { id: 'b', text: text('Sai') }], answerId: 'a', explanation: text('Giải thích.') },
      ] },
      { id: 'last', kind: 'observe', modelIds: [root], targetId: root, title: text('Quan sát tiếp'), instruction: text('Quan sát lại hệ xương.') },
    ] };
  for (const mode of ['preview', 'view']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/home');
    await page.evaluate(lesson => {
      localStorage.setItem('soma.lesson-v1:' + lesson.id, JSON.stringify(lesson));
      localStorage.setItem('soma.lessons.panel:readerOutline', 'false');
    }, lesson);
    await page.goto('/lessons/' + lesson.id + (mode === 'preview' ? '/edit' : ''));
    if (mode === 'preview') await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
    const player = page.locator('.lesson-player');
    const canvasHost = player.locator(':scope > .model-canvas');
    const canvas = canvasHost.locator('canvas');
    const model = player.locator('.lesson-model');
    const next = player.locator('.lesson-editor-stepbar-actions > button');
    const outline = player.locator('.lesson-reader-outline');
    const sidebar = player.locator('.lesson-player-header .sidebar-toggle');
    const settle = async () => {
      await page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all([...document.querySelectorAll('.lesson-player-body, .lesson-workspace')]
          .flatMap(node => node.getAnimations()).map(animation => animation.finished.catch(() => {})));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
    };
    await player.getByRole('heading', { name: 'Giới thiệu', exact: true }).waitFor();
    await player.locator(':scope > .model-canvas[aria-busy="false"]').waitFor();
    const original = await canvas.elementHandle();
    assert(await model.isHidden());
    assert(await canvasHost.evaluate(node => node.inert && node.getBoundingClientRect().width === node.parentElement.getBoundingClientRect().width));
    await page.evaluate(async () => {
      const { AnatomyViewer } = await (await import('/src/anatomy/core.ts')).getWasm();
      const proto = AnatomyViewer.prototype, apply = proto.apply_scene, reframe = proto.reframe;
      proto.apply_scene = function(...args) { window.playerViewer = this; return apply.apply(this, args); };
      proto.reframe = function(...args) { window.playerFrame = args; return reframe.apply(this, args); };
      window.restorePlayer = () => { proto.apply_scene = apply; proto.reframe = reframe; };
    });
    try {
      await next.click();
      await player.getByRole('heading', { name: 'Quan sát', exact: true }).waitFor();
      await settle();
      await page.waitForFunction(() => window.playerViewer?.visible_count() === 277);
      assert(await model.isVisible());
      assert.equal(await player.locator('.explode-control, .structure-search-field, .lesson-part-card').count(), 0);
      assert(await model.evaluate(node => getComputedStyle(node).boxShadow === 'none' && getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)'));
      const before = await page.evaluate(() => window.playerViewer.camera_pose());
      const frame = await model.locator('.model-focus-frame').boundingBox();
      const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
      for (const button of ['left', 'right']) {
        await page.mouse.move(center.x, center.y);
        await page.mouse.down({ button });
        await page.waitForTimeout(1100);
        await page.mouse.up({ button });
        assert.equal(await player.locator('.model-hold-progress, .lesson-part-card').count(), 0);
      }
      assert.equal(await page.evaluate(() => window.playerViewer.visible_count()), 277);
      await page.keyboard.down('Shift');
      await page.mouse.move(center.x, center.y);
      await page.mouse.down(); await page.mouse.move(center.x + 25, center.y + 20); await page.mouse.up();
      await page.keyboard.up('Shift');
      assert(await canvasHost.locator('.model-selection-box').isHidden());
      await page.mouse.move(center.x, center.y);
      await page.mouse.down(); await page.mouse.move(center.x + 45, center.y + 20); await page.mouse.up();
      await page.mouse.wheel(0, -120);
      await page.waitForFunction(before => window.playerViewer.camera_pose().yaw !== before.yaw, before);
      await player.locator('.lesson-player-reset').click();
      await page.waitForFunction(before => {
        const current = window.playerViewer.camera_pose();
        return ['yaw', 'pitch', 'distance'].every(key => Math.abs(current[key] - before[key]) < 1e-4);
      }, before);
      await next.click();
      await player.getByRole('heading', { name: 'Đọc thêm', exact: true }).waitFor();
      await settle();
      assert(await model.isHidden());
      await page.waitForFunction(() => window.playerViewer.visible_count() === 0);
      assert(await original.evaluate(canvas => canvas === document.querySelector('.lesson-player > .model-canvas canvas')));
      await next.click();
      await player.getByRole('heading', { name: 'Câu hỏi', exact: true }).waitFor();
      if (mode === 'view') assert(await next.isDisabled(), 'Student completion rules remain in force');
      await player.getByRole('radio', { name: 'Đúng', exact: true }).check();
      await player.getByRole('button', { name: 'Kiểm tra đáp án', exact: true }).click();
      await next.click();
      await player.getByRole('heading', { name: 'Quan sát tiếp', exact: true }).waitFor();
      await settle();
      for (const width of [320, 768, 1440]) for (const reduced of [false, true]) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
        await settle();
        for (const open of [true, false]) {
          const before = await model.boundingBox();
          await sidebar.click();
          const transition = await outline.evaluate(node => ({ opacity: Number(getComputedStyle(node).opacity), inert: node.inert }));
          assert.equal(transition.inert, !open);
          await settle();
          const after = await model.boundingBox();
          assert(width > 900 ? open ? after.width < before.width : after.width > before.width
            : open ? after.y > before.y : after.y < before.y);
          await checkLessonResetFocus(page, 'playerViewer', '.lesson-player > .model-canvas canvas');
        }
        assert(await original.evaluate(canvas => canvas === document.querySelector('.lesson-player > .model-canvas canvas')));
        assert(await player.evaluate(node => node.scrollWidth <= node.clientWidth));
        if (process.env.SOMA_LESSON_VISUALS) await page.screenshot({ path: `/tmp/soma-${mode}-background-${width}.png` });
      }
      await page.setViewportSize({ width: 390, height: 900 });
      const toggle = player.locator('.lesson-player-model-toggle');
      await toggle.click(); await settle();
      assert(await model.isHidden());
      assert(await canvasHost.evaluate(node => node.inert));
      await player.locator('.lesson-step-previous').click();
      await player.locator('.lesson-step-previous').click();
      await player.locator('.lesson-step-previous').click();
      assert(await model.isHidden(), 'A mobile collapse survives changing steps');
      await page.setViewportSize({ width: 1440, height: 900 }); await settle();
      assert(await model.isVisible(), 'Desktop restores the model while preserving the mobile preference');
      for (let step = 0; step < 4; step++) await next.click();
      await player.getByRole('heading', { name: 'Đã hoàn thành bài học', exact: true }).waitFor();
      await settle();
      assert(await model.isHidden());
      assert(await original.evaluate(canvas => canvas === document.querySelector('.lesson-player > .model-canvas canvas')));
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('soma.lesson-v1:player-background'))), lesson);
    } finally { await page.evaluate(() => window.restorePlayer()); }
  }
  const readingOnly = { ...lesson, id: 'player-reading-only', modelId: '', steps: [lesson.steps[0]] };
  await page.evaluate(lesson => localStorage.setItem('soma.lesson-v1:' + lesson.id, JSON.stringify(lesson)), readingOnly);
  await page.goto('/lessons/' + readingOnly.id);
  await page.locator('.lesson-player > .model-canvas[aria-busy="false"]').waitFor();
  assert(await page.locator('.lesson-player > .model-canvas canvas').isVisible());
  assert(await page.locator('.lesson-player .lesson-model').isHidden());
  const empty = { ...readingOnly, id: 'player-empty-preview', steps: [] };
  await page.evaluate(lesson => localStorage.setItem('soma.lesson-v1:' + lesson.id, JSON.stringify(lesson)), empty);
  await page.goto('/lessons/' + empty.id + '/edit');
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  await page.locator('.lesson-player > .model-canvas[aria-busy="false"]').waitFor();
  assert(await page.locator('.lesson-player > .model-canvas canvas').isVisible());
  assert(await page.locator('.lesson-player .lesson-model').isHidden());
}
