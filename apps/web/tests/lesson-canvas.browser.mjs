import assert from 'node:assert/strict';
import { savedLesson } from './lesson-editor-tools.mjs';

export async function checkLessonCanvas(page) {
  const text = vi => ({ vi, en: vi });
  const lesson = {
    id: 'canvas-consistency', version: 1, title: text('Canvas đồng bộ'), summary: text('Mô tả'),
    modelId: 'collection:cc46df69f8495544',
    steps: ['Quan sát', 'So sánh'].map((title, index) => ({ id: `step-${index}`, kind: 'observe',
      title: text(title), instruction: text('Nội dung quan sát'), targetId: 'collection:cc46df69f8495544' })),
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/anatomy');
  await page.locator('.model-canvas[aria-busy="false"]').waitFor({ timeout: 60000 });
  await page.evaluate(lesson => localStorage.setItem('soma.lesson-v1:' + lesson.id, JSON.stringify(lesson)), lesson);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('anatomy-models-v1');
    request.onblocked = () => reject(new Error('Model cache is still open'));
    request.onsuccess = resolve; request.onerror = () => reject(request.error);
  }));
  let release;
  const loading = new Promise(resolve => { release = resolve; });
  const blockModel = async route => { await loading; await route.continue().catch(() => {}); };
  let metadataRequests = 0;
  const countMetadata = request => {
    if (new URL(request.url()).pathname.endsWith('/models/z-anatomy/z-anatomy.json')) metadataRequests++;
  };
  await page.route('**/*.glb.br', blockModel);
  page.on('request', countMetadata);
  const region = page.locator('.lesson-scene-region');
  const canvas = page.locator('.lesson-editor > .model-canvas canvas');
  const canvasHost = page.locator('.lesson-editor > .model-canvas');
  const hud = region.locator('.lesson-editor-hud');
  const modelSettings = page.locator('#lesson-model-settings');
  const openModelSettings = region.getByRole('button', { name: 'Thiết lập 3D', exact: true });
  const slider = modelSettings.getByRole('slider', { name: 'Mức độ tách', exact: true });
  const choose = title => page.locator('#lesson-author-outline .lesson-outline-row').filter({ hasText: title }).click();
  const settled = () => page.waitForFunction(() => window.lessonCanvasViewer && !window.lessonCanvasViewer.advance_camera(performance.now()));
  const pose = () => page.evaluate(() => window.lessonCanvasViewer.camera_pose());
  const saved = () => savedLesson(page, 'canvas-consistency');
  const geometry = async () => {
    await page.waitForFunction(() => {
      const region = document.querySelector('.lesson-editor-scene');
      const host = document.querySelector('.lesson-editor > .model-canvas').getBoundingClientRect();
      const frame = region.querySelector('.model-focus-frame').getBoundingClientRect();
      const expected = [(frame.left - host.left) / host.width, (frame.top - host.top) / host.height,
        frame.width / host.width, frame.height / host.height];
      const actual = window.lessonCanvasFrames.at(-1);
      return actual && actual.every((value, index) => Math.abs(value - expected[index]) < 1e-5);
    });
    return region.evaluate(node => {
      const host = node.getBoundingClientRect();
      const frame = node.querySelector('.model-focus-frame').getBoundingClientRect();
      const hud = node.querySelector('.lesson-editor-hud').getBoundingClientRect();
      const canvas = document.querySelector('.lesson-editor > .model-canvas canvas');
      return { top: frame.top - host.top, gap: hud.top - frame.bottom, height: frame.height,
        left: hud.left - host.left, right: host.right - hud.right, bottom: host.bottom - hud.bottom,
        overflow: node.scrollWidth > node.clientWidth,
        interactive: document.elementFromPoint(frame.left + frame.width / 2, frame.top + frame.height / 2) === canvas };
    });
  };
  try {
    await page.goto('/lessons/' + lesson.id + '/edit');
    await page.getByLabel('Tên bài học', { exact: true }).waitFor();
    await page.evaluate(async () => {
      const { AnatomyViewer } = await (await import('/src/core.ts')).getWasm();
      const proto = AnatomyViewer.prototype;
      const apply = proto.apply_study_scene, reframe = proto.reframe;
      window.lessonCanvasFrames = [];
      proto.apply_study_scene = function(...args) { window.lessonCanvasViewer = this; if (args[2]) window.lessonCanvasFrames.push(args[2]); return apply.apply(this, args); };
      proto.reframe = function(...args) { window.lessonCanvasFrames.push(args); return reframe.apply(this, args); };
      window.restoreLessonCanvas = () => { proto.apply_study_scene = apply; proto.reframe = reframe; };
    });
    await choose('Quan sát');
    await page.locator('.lesson-editor > .model-canvas[aria-busy="true"]').waitFor();
    assert(await hud.locator('.model-status').isVisible());
    assert.equal(await hud.getByRole('progressbar').getAttribute('max'), '1');
    release();
    await page.locator('.lesson-editor > .model-canvas[aria-busy="false"]').waitFor({ timeout: 60000 });
    await settled();
    assert.equal(metadataRequests, 1, 'Only the viewer loads metadata before 3D settings open');
    assert.equal(await hud.getByRole('progressbar').count(), 0);
    assert.equal(await canvasHost.locator(':scope > :not(canvas):not(.model-selection-box)').count(), 0);
    assert(await canvasHost.evaluate(node => {
      const area = node.getBoundingClientRect(), workspace = node.parentElement.getBoundingClientRect();
      return Math.abs(area.width - workspace.width) < 1 && Math.abs(area.height - workspace.height) < 1
        && getComputedStyle(node).boxShadow === 'none' && getComputedStyle(node).borderWidth === '0px';
    }), 'The borderless canvas supplies the entire editor background');
    assert.match(await hud.locator('.model-status').last().textContent(), /582\/582/);
    await page.evaluate(() => { window.lessonCanvasElement = document.querySelector('.lesson-editor > .model-canvas canvas'); });
    const initial = await geometry();
    assert(initial.height > 200 && initial.gap >= 7.5 && initial.interactive);
    for (const edge of ['top', 'left', 'right', 'bottom']) assert(Math.abs(initial[edge] - 10) < 1);

    const settings = page.locator('.settings-page');
    await page.locator('.module-settings').click();
    await settings.locator('a[href="/settings#graphics"]').click();
    await settings.locator('input[id$="-show-fps"]').check();
    await settings.locator('input[id$="-show-axes"]').uncheck();
    await page.locator('.module-settings').click();
    assert(await region.locator('.model-orientation .model-fps').isVisible());
    assert(await region.locator('.orientation-axes').isHidden());
    await canvas.press('ArrowRight');
    await page.locator('.module-settings').click();
    await settings.locator('a[href="/settings#graphics"]').click();
    await settings.locator('input[id$="-show-axes"]').check();
    await page.locator('.module-settings').click();
    assert(await region.locator('.orientation-axes').isVisible());

    const before = await pose();
    let bounds = await region.locator('.model-focus-frame').boundingBox();
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 40, center.y + 15, { steps: 4 });
    await page.mouse.up();
    await page.mouse.move(center.x, center.y);
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(before => {
      const camera = window.lessonCanvasViewer.camera_pose();
      return camera.yaw !== before.yaw && camera.distance !== before.distance;
    }, before);
    const rotated = await pose();
    assert.notEqual(rotated.yaw, before.yaw);
    assert.notEqual(rotated.distance, before.distance);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(center.x + 80, center.y + 50);
    assert(await canvasHost.locator('.model-selection-box').isVisible());
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.keyboard.up('Shift');
    assert(await canvasHost.locator('.model-selection-box').isHidden());

    await page.evaluate(async () => {
      const { getCatalog } = await import('/src/core.ts');
      const catalog = await getCatalog();
      try { window.lessonCanvasPart = catalog.members('collection:cc46df69f8495544')[0]; }
      finally { catalog.free(); }
      const viewer = window.lessonCanvasViewer;
      const pick = Object.getPrototypeOf(viewer).pick;
      Object.getPrototypeOf(viewer).pick = function() { this.select(window.lessonCanvasPart); return window.lessonCanvasPart; };
      window.restoreLessonCanvasPick = () => { Object.getPrototypeOf(viewer).pick = pick; };
    });
    await page.mouse.click(center.x, center.y);
    await region.locator('.lesson-part-card').waitFor();
    const withPart = await geometry();
    assert.equal(withPart.height, initial.height, 'Structure details preserve the model frame');
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.waitForTimeout(1100);
    const separation = await region.locator('.model-hold-progress, .separation-status').count();
    await page.mouse.up();
    assert.equal(separation, 0, 'Editor input does not detach model parts');
    await settled();
    await page.mouse.move(center.x, center.y);
    await page.mouse.down({ button: 'right' });
    await region.locator('.model-hold-progress[data-action="hide"]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => /581\/582/.test(document.querySelector('.lesson-editor-hud').textContent));
    await page.mouse.up({ button: 'right' });
    await page.evaluate(() => window.restoreLessonCanvasPick());
    await page.getByRole('button', { name: 'Lưu bài học', exact: true }).click();
    assert.equal((await saved()).steps[0].visibleIds.length, 581);

    await openModelSettings.click();
    await modelSettings.locator('.structure-tree > li').first().waitFor();
    assert.equal(metadataRequests, 2, '3D settings read the shared metadata bundle once');
    await slider.fill('40');
    await page.waitForFunction(() => document.querySelector('#lesson-model-settings .explode-control output')?.textContent === '40%');
    await modelSettings.getByRole('button', { name: 'Áp dụng', exact: true }).click();
    await modelSettings.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Lưu bài học', exact: true }).click();
    const authored = (await saved()).steps[0];
    assert.equal(authored.view.explosion, 40);
    await choose('So sánh');
    await settled();
    await choose('Quan sát');
    await settled();
    await openModelSettings.click();
    assert.equal(await slider.inputValue(), '40');
    assert.equal(metadataRequests, 2, 'Reopening 3D settings reuses indexed metadata');
    await modelSettings.getByRole('button', { name: 'Hủy', exact: true }).click();
    await modelSettings.waitFor({ state: 'hidden' });
    assert(await page.evaluate(() => window.lessonCanvasElement === document.querySelector('.lesson-editor > .model-canvas canvas')));
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await Promise.all(document.querySelector('.lesson-author-workspace').getAnimations().map(animation => animation.finished.catch(() => {})));
      });
      const layout = await geometry();
      assert(layout.height >= 80 && layout.gap >= 7.5 && !layout.overflow && layout.interactive, `Usable canvas at ${width}px`);
      for (const edge of ['top', 'left', 'right', 'bottom']) assert(Math.abs(layout[edge] - 10) < 1);
      if (process.env.SOMA_LESSON_VISUALS) await page.screenshot({ path: `/tmp/soma-canvas-${width}.png` });
    }
    for (const width of [390, 1440]) for (const reduced of [false, true]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
      await geometry();
      const outline = await page.locator('#lesson-author-outline').boundingBox();
      const model = await region.boundingBox();
      assert(width === 1440 ? outline.x + outline.width <= model.x : outline.y + outline.height <= model.y,
        'The outline stays outside the model pane at every width');
      assert(await page.evaluate(() => window.lessonCanvasElement === document.querySelector('.lesson-editor > .model-canvas canvas')));
    }
    await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
    await page.locator('.lesson-player .model-canvas[aria-busy="false"]').waitFor();
    assert.equal(await page.locator('.lesson-player .explode-control, .lesson-player .structure-search').count(), 0);
    assert.deepEqual((await saved()).steps[0], authored);
  } finally {
    release();
    page.off('request', countMetadata);
    await page.unroute('**/*.glb.br', blockModel);
    await page.evaluate(() => { window.restoreLessonCanvasPick?.(); window.restoreLessonCanvas?.(); });
  }
}
