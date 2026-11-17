import { lessonBody } from './lesson-editor-tools.mjs';
import assert from 'node:assert/strict';

export async function checkLessonResponsiveLayout(page) {
  const text = vi => ({ vi, en: '' });
  const modelId = 'collection:cc46df69f8495544';
  const lesson = {
    id: 'responsive-lesson-check', version: 1, title: text('Bài học co giãn'), summary: text(''), modelId,
    steps: [
      { id: 'observe', kind: 'observe', title: text('Quan sát'), instruction: text('Nội dung quan sát.'), targetId: modelId },
      { id: 'read', kind: 'text', showModel: false, title: text('Đọc'), instruction: text('Nội dung kiểm tra cuộn.\n\n'.repeat(100)) },
    ],
  };
  const sizes = [[1280, 800, 240, 476, 500], [1440, 900, 265, 586, 525],
    [1600, 1000, 290, 696, 550], [1920, 1200, 340, 916, 600]];
  const viewPath = `/lessons/${lesson.id}`;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(lesson => {
    localStorage.setItem('soma.lesson:' + lesson.id, JSON.stringify(lesson));
    for (const panel of ['editorOutline', 'readerOutline']) localStorage.setItem(`soma.lessons.panel:${panel}`, 'true');
  }, lesson);
  const observeCamera = () => page.evaluate(async () => {
    const { getWasm } = await import('/src/anatomy/core.ts');
    const { AnatomyViewer } = await getWasm();
    const reframe = AnatomyViewer.prototype.reframe;
    AnatomyViewer.prototype.reframe = function (...frame) {
      window.responsiveLessonViewer = this;
      return reframe.apply(this, frame);
    };
  });
  await page.goto(`${viewPath}/edit`);
  await observeCamera();
  const outline = editor => page.locator(editor ? '#lesson-author-outline' : '.lesson-reader-outline');
  const model = editor => page.locator(editor ? '.lesson-scene-region' : '.lesson-player .lesson-model');
  const content = editor => page.locator(editor ? '#lesson-author-writing' : '.lesson-player .lesson-step');
  const choose = (editor, title) => outline(editor).locator('.lesson-outline-row').filter({ hasText: title }).click();
  const bounds = async locator => Object.values(await locator.boundingBox()).map(value => Math.round(value));
  const measure = async editor => {
    await page.locator('.model-canvas[aria-busy="false"] canvas').waitFor({ state: 'attached' });
    const frame = model(editor).locator('.model-focus-frame');
    const camera = async () => {
      return page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return window.responsiveLessonViewer.camera_pose();
      });
    };
    const initialCamera = await camera();
    const toggle = page.locator(editor ? '#lesson-toggle-outline' : '.lesson-player-header .sidebar-toggle');
    const results = [];
    for (const [width, height, outlineWidth, modelWidth, contentWidth] of [...sizes, ...sizes.slice(0, -1).reverse()]) {
      await page.setViewportSize({ width, height });
      const panels = await Promise.all([outline(editor), model(editor), content(editor), frame].map(bounds));
      assert.deepEqual(panels.slice(0, 3).map(rect => rect[2]), [outlineWidth, modelWidth, contentWidth], `${width}px with outline`);
      if (editor) {
        await page.getByRole('button', { name: 'Thiết lập 3D', exact: true }).click();
        const settings = page.locator('.lesson-model-settings[data-open="true"]');
        await settings.waitFor();
        assert.deepEqual(await bounds(settings), panels[2], '3D settings share the writing panel bounds');
        assert.deepEqual(await bounds(frame), panels[3], 'Opening settings preserves the model frame');
        const columns = await settings.locator('.lesson-model-systems-list').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
        assert.equal(columns, width < 1600 ? 1 : 2);
        const actions = settings.locator('.lesson-model-settings-actions');
        const footer = await bounds(actions);
        await settings.locator('.lesson-model-settings-content').evaluate(node => { node.scrollTop = node.scrollHeight; });
        assert.deepEqual(await bounds(actions), footer, 'The action row stays in place while settings scroll');
        await settings.getByRole('button', { name: 'Hủy', exact: true }).click();
      }
      await toggle.click();
      const closed = await Promise.all([model(editor), content(editor), frame].map(bounds));
      assert.equal(closed[0][2], modelWidth + outlineWidth + 16, 'The model takes the space freed by the outline');
      assert.deepEqual(closed[1], panels[2]);
      const pose = await camera();
      for (const key of ['yaw', 'pitch', 'distance']) assert(Math.abs(pose[key] - initialCamera[key]) < 1e-4);
      await toggle.click();
      results.push({ panels, closed });
    }
    await page.setViewportSize({ width: 1920, height: 1200 });
    const workspace = page.locator(editor ? '.lesson-editor' : '.lesson-player');
    await workspace.evaluate(node => { node.style.width = 'calc(100% - 480px)'; });
    assert.deepEqual(await Promise.all([outline(editor), model(editor), content(editor)].map(async panel => (await bounds(panel))[2])),
      sizes[1].slice(2), 'Column widths follow the workspace even when it is narrower than the viewport');
    await workspace.evaluate(node => { node.style.removeProperty('width'); });
    await choose(editor, 'Đọc');
    await model(editor).waitFor({ state: 'hidden' });
    const [contentX, , contentWidth] = await bounds(content(editor));
    const [outlineX, , outlineWidth] = await bounds(outline(editor));
    assert.equal(contentWidth, 600);
    assert.equal(2 * (contentX - outlineX - outlineWidth - 16) + contentWidth, 1920 - 32 - outlineWidth - 16,
      'A step with 3D hidden stays centered in the space next to the outline');
    if (!editor) {
      assert(await page.locator('.lesson-reader-body').evaluate(node => {
        node.scrollTop = node.scrollHeight;
        return node.scrollTop > 0;
      }));
      assert(await page.getByRole('button', { name: 'Hoàn thành', exact: true }).isVisible());
    }
    return results;
  };

  await choose(true, 'Quan sát');
  const editor = await measure(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  assert.deepEqual(await measure(false), editor, 'Preview uses the same layout and camera frame as the editor');
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  assert.equal(await page.getByLabel('Tên mục').inputValue(), 'Đọc');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/lessons');
  await observeCamera();
  await page.locator('.lesson-card').filter({ hasText: 'Bài học co giãn' }).getByRole('button', { name: 'Vào học', exact: true }).click();
  assert.deepEqual(await measure(false), editor, 'View uses the same layout and camera frame as the editor');
}

export async function checkLessonEditorLayout(page) {
  const text = vi => ({ vi, en: '' });
  const lesson = {
    id: 'persistent-editor-check', version: 1, title: text('Soạn bài liên tục'), summary: text(''),
    modelId: 'collection:cc46df69f8495544',
    steps: ['Một', 'Hai', 'Ba'].map((name, i) => ({ id: 'step-' + i, kind: 'observe',
      title: text(name), instruction: text('Nội dung ' + name), targetId: 'collection:cc46df69f8495544' })),
  };
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(lesson => {
    localStorage.setItem('soma.lesson:' + lesson.id, JSON.stringify(lesson));
    for (const name of ['editorOutline', 'readerOutline']) localStorage.removeItem('soma.lessons.panel:' + name);
  }, lesson);
  await page.goto('/lessons/' + lesson.id + '/edit');
  const outline = page.locator('#lesson-author-outline');
  const settings = page.locator('.lesson-step-options');
  const document = page.locator('#lesson-author-writing');
  const model = page.locator('.lesson-scene-region');
  const saved = () => page.evaluate(id => JSON.parse(localStorage.getItem('soma.lesson:' + id)), lesson.id);
  const outlineOrder = () => outline.locator('[data-lesson-step]').evaluateAll(rows => rows.map(row => row.dataset.lessonStep));
  const waitForOutlineOrder = order => page.waitForFunction(order => {
    const rows = [...document.querySelectorAll('#lesson-author-outline [data-lesson-step]')];
    return JSON.stringify(rows.map(row => row.dataset.lessonStep)) === JSON.stringify(order);
  }, order);
  const saveDraft = async () => {
    await page.getByRole('button', { name: 'Lưu bài học', exact: true }).click();
    await page.getByRole('button', { name: 'Đã lưu', exact: true }).waitFor();
    return saved();
  };
  const choose = name => outline.locator('.lesson-outline-row').filter({ hasText: name }).click();
  await page.getByLabel('Tên bài học').waitFor();
  assert(await outline.isVisible());
  assert.deepEqual(await document.evaluate(node => [...node.classList].filter(name => name.startsWith('lesson-author-document--'))), ['lesson-author-document--details']);
  assert.equal(await settings.count(), 0);
  assert(await model.isHidden(), 'Lesson details keep the model controls hidden');
  await page.locator('.lesson-editor > .model-canvas[aria-busy="false"]').waitFor();
  await page.evaluate(() => { window.editorCanvas = document.querySelector('.lesson-editor > .model-canvas canvas'); });
  await choose('Một');
  await page.locator('.lesson-editor > .model-canvas[aria-busy="false"]').waitFor();
  assert.deepEqual(await document.evaluate(node => [...node.classList].filter(name => name.startsWith('lesson-author-document--'))), ['lesson-author-document--step']);
  await page.waitForFunction(() => {
    const scene = document.querySelector('.lesson-scene-region');
    return !!scene && Math.abs(scene.getBoundingClientRect().width - 476) < 0.5;
  });
  assert.deepEqual(await page.evaluate(() => ['#lesson-author-outline', '.lesson-scene-region', '#lesson-author-writing']
    .map(selector => Math.round(document.querySelector(selector).getBoundingClientRect().width))), [240, 476, 500]);
  const stepLabel = await document.getAttribute('aria-label');
  assert.match(stepLabel, /^(Mục|Section) 1 · Một$/);
  assert.deepEqual(await document.evaluate(node => [...node.classList].filter(name => name.startsWith('lesson-author-document--'))), ['lesson-author-document--step']);
  await page.locator('#lesson-toggle-outline').click();
  await outline.waitFor({ state: 'hidden' });
  assert(await outline.isHidden());
  assert.equal(await document.getAttribute('aria-label'), stepLabel);
  assert.deepEqual(await document.evaluate(node => [...node.classList].filter(name => name.startsWith('lesson-author-document--'))), ['lesson-author-document--step']);
  await page.locator('#lesson-toggle-outline').click();
  await page.getByRole('button', { name: 'Thiết lập 3D', exact: true }).click();
  const closeModelSettings = page.getByRole('button', { name: 'Đóng thiết lập 3D', exact: true });
  await closeModelSettings.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Đóng thiết lập 3D');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.lesson-model-settings')?.dataset.open === 'false'
    && document.activeElement === document.querySelector('.lesson-model-toolbar > .lesson-button'));
  assert(await page.evaluate(() => window.editorCanvas === document.querySelector('.lesson-editor > .model-canvas canvas')));
  await lessonBody(page).fill('Đã sửa nội dung Một');
  await choose('Hai');
  assert(await outline.isVisible());
  assert(await settings.isVisible());
  assert.equal(await lessonBody(page).innerText(), 'Nội dung Hai');
  const handle = outline.getByRole('button', { name: 'Kéo để sắp xếp “Hai”', exact: true });
  const start = await handle.boundingBox();
  const firstRow = await outline.locator('[data-lesson-step="step-0"]').boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstRow.x + firstRow.width / 2, firstRow.y + 5, { steps: 10 });
  await page.mouse.up();
  await waitForOutlineOrder(['step-1', 'step-0', 'step-2']);
  assert.deepEqual(await outlineOrder(), ['step-1', 'step-0', 'step-2'], 'Pointer reorder updates the visible draft');
  assert.deepEqual((await saved()).steps.map(step => step.id), ['step-0', 'step-1', 'step-2'], 'Reordering stays staged until Save');
  assert.equal(await page.getByLabel('Tên mục').inputValue(), 'Hai', 'Reordering must preserve the active step');
  await handle.focus();
  await handle.press('Space');
  await handle.press('End');
  await handle.press('Space');
  await waitForOutlineOrder(['step-0', 'step-2', 'step-1']);
  assert.deepEqual(await outlineOrder(), ['step-0', 'step-2', 'step-1'], 'Keyboard reorder updates the visible draft');
  assert.deepEqual((await saved()).steps.map(step => step.id), ['step-0', 'step-1', 'step-2'], 'Keyboard reorder stays staged until Save');
  const reordered = await saveDraft();
  assert.deepEqual(reordered.steps.map(step => step.id), ['step-0', 'step-2', 'step-1']);
  const listed = await page.evaluate(async id => {
    const { listLessons } = await import('/src/lessons/shared/source.ts');
    return (await listLessons()).lessons.find(item => item.id === id);
  }, lesson.id);
  assert(listed);
  assert(listed.steps[0].instruction.vi.includes('Đã sửa nội dung Một'), 'Saved rich text remains readable from the lesson source');
  assert.deepEqual(reordered.steps[0].instruction.html, ['vi']);
  assert.deepEqual(reordered.steps[1], lesson.steps[2], 'Moving a step must preserve its content and scene');
  await handle.press('Space');
  await handle.press('Home');
  await handle.press('Escape');
  assert.equal(await handle.getAttribute('aria-pressed'), 'false', 'Escape ends keyboard reordering');
  assert.deepEqual(await outlineOrder(), ['step-0', 'step-2', 'step-1'], 'Escape cancels keyboard reordering');
  assert.deepEqual(await saved(), reordered, 'Escape must cancel keyboard reordering');
  assert.equal(await page.getByLabel('Tên mục').inputValue(), 'Hai');
  await document.getByRole('button', { name: 'Mục trước', exact: true }).click();
  assert.equal(await page.getByLabel('Tên mục').inputValue(), 'Ba');
  await model.locator('.orientation-axes [data-axis="Y"][data-direction="1"]').click();
  assert(await outline.isVisible());
  assert(await settings.isVisible());
  assert(await page.evaluate(() => window.editorCanvas === document.querySelector('.lesson-editor > .model-canvas canvas')));
  await page.locator('#lesson-toggle-outline').click();
  await page.reload();
  await page.getByLabel('Tên bài học').waitFor();
  assert(await outline.isHidden());
  assert.equal(await settings.count(), 0);
  await page.locator('#lesson-toggle-outline').click();
  await outline.waitFor({ state: 'visible' });
  await choose('Hai');
  await page.locator('#lesson-toggle-outline').click();
  await outline.waitFor({ state: 'hidden' });
  await document.getByRole('button', { name: 'Thêm mục', exact: true }).click();
  assert(await outline.isHidden());
  assert(await settings.isVisible());
  assert.equal(await page.getByLabel('Tên mục').inputValue(), '', 'Adding a step while the outline is closed opens a new draft');
  await page.getByLabel('Tên mục').fill('Bốn');
  await lessonBody(page).fill('Nội dung Bốn');
  await page.locator('#lesson-toggle-outline').click();
  assert.equal(await outline.locator('[data-lesson-step]').count(), 4, 'The added draft appears in the outline');
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  const readerOutline = page.locator('.lesson-reader-outline');
  const readerToggle = page.locator('.lesson-player-header .sidebar-toggle');
  await readerToggle.click();
  await readerOutline.getByRole('button', { name: 'Ba', exact: true }).click();
  assert(await readerOutline.isVisible());
  await page.getByRole('button', { name: 'Mục tiếp theo', exact: true }).click();
  assert(await readerOutline.isVisible());
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  await page.getByLabel('Tên mục').waitFor();
  assert(await outline.isVisible());
  assert(await settings.isVisible());
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  await readerToggle.waitFor();
  assert(await readerOutline.isVisible(), 'Learner outline preference survives returning to preview');
  await readerToggle.click();
  await page.setViewportSize({ width: 390, height: 844 });
  const playerModel = page.locator('.lesson-player .lesson-model');
  await page.getByRole('button', { name: 'Thu gọn mô hình 3D', exact: true }).click();
  await page.getByRole('button', { name: 'Mục tiếp theo', exact: true }).click();
  await playerModel.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Hiện mô hình 3D', exact: true }).click();
  await readerToggle.click();
  assert(await readerOutline.isVisible());
  assert(await page.locator('.lessons-screen').evaluate(node => node.scrollWidth <= node.clientWidth));
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  await page.getByLabel('Tên mục').waitFor();
  assert(await outline.isVisible());
  assert((await outline.locator('.catalog-tree').boundingBox()).height >= 70, 'Mobile outline needs usable space for selecting steps');
  await choose('Một');
  assert(await outline.isVisible());
  assert(await settings.isVisible());
  await page.evaluate(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) {
      if (key.startsWith('soma.lessons.panel:')) throw new DOMException('Blocked', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('soma.lessons.panel:')) throw new DOMException('Blocked', 'SecurityError');
      return set.call(this, key, value);
    };
  });
  await page.locator('#lesson-toggle-outline').click();
  await page.locator('#lesson-toggle-outline').click();
  assert(await outline.isVisible(), 'Panel toggles remain usable when preference storage is blocked');
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  await page.getByLabel('Tên mục').waitFor();
  assert(await settings.isVisible(), 'Blocked panel storage must fall back to accessible inline settings');
}
