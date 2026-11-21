import { lessonBody, savedLesson } from './lesson-editor-tools.mjs';
import assert from 'node:assert/strict';

export async function checkLessonResponsiveLayout(page) {
  const text = vi => ({ vi, en: '' });
  const modelId = 'collection:baf3076d0495a617';
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
    localStorage.setItem('soma.lesson-v1:' + lesson.id, JSON.stringify(lesson));
    localStorage.setItem('soma.lesson-progress-v1:' + lesson.id, JSON.stringify({ read: ['observe'], answers: {} }));
    for (const panel of ['editorOutline', 'readerOutline']) localStorage.setItem(`soma.lessons.panel:${panel}`, 'true');
  }, lesson);
  const observeCamera = () => page.evaluate(async () => {
    const { getWasm } = await import('/src/anatomy/core.ts');
    const { AnatomyViewer } = await getWasm();
    const reframe = AnatomyViewer.prototype.reframe;
    AnatomyViewer.prototype.reframe = function (...frame) {
      window.responsiveLessonViewer = this;
      window.responsiveLessonFrame = frame;
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
  const requireAutoFit = async () => {
    const result = await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
      const canvas = document.querySelector('.model-canvas canvas');
      const gl = canvas.getContext('webgl2');
      const { width, height } = canvas;
      window.responsiveLessonViewer.render();
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let left = width, right = -1, top = height, bottom = -1;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] !== 255) continue;
        const pixel = (i - 3) / 4;
        const x = pixel % width, y = height - 1 - Math.floor(pixel / width);
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
      const [x, y, w, h] = window.responsiveLessonFrame;
      return { center: [((left + right + 1) / (2 * width) - x) / w, ((top + bottom + 1) / (2 * height) - y) / h],
        fill: Math.max((right - left + 1) / (width * w), (bottom - top + 1) / (height * h)) };
    });
    assert(result.center.every(value => Math.abs(value - 0.5) < 0.04), `Fit centered within the 3D frame: ${JSON.stringify(result)}`);
    assert(result.fill > 0.77 && result.fill <= 0.86, `Fit within 85% of the 3D frame, allowing for geometry and rasterization: ${JSON.stringify(result)}`);
  };
  const measure = async editor => {
    await page.locator('.model-canvas[aria-busy="false"] canvas').waitFor({ state: 'attached' });
    const shell = page.locator('.lesson-workspace-shell');
    assert.equal(await shell.locator(':scope > .lesson-header').count(), 1);
    assert.equal(await shell.locator(':scope > .lesson-workspace-body > .lesson-outline-panel').count(), 1);
    assert.equal(await shell.locator('.lesson-workspace-main > .lesson-content-panel > .lesson-step-navigation').count(), 1);
    const frame = model(editor).locator('.lesson-model-surface > .model-focus-frame');
    const toggle = page.locator(editor ? '#lesson-toggle-outline' : '.lesson-player-header .sidebar-toggle');
    const results = [];
    for (const [width, height, outlineWidth, modelWidth, contentWidth] of [...sizes, ...sizes.slice(0, -1).reverse()]) {
      await page.setViewportSize({ width, height });
      const panels = await Promise.all([outline(editor), model(editor), content(editor), frame].map(bounds));
      assert.deepEqual(panels.slice(0, 3).map(rect => rect[2]), [outlineWidth, modelWidth, contentWidth], `${width}px with outline`);
      const [modelX, modelY, paneWidth, paneHeight] = panels[1];
      const [statusX, statusY, statusWidth, statusHeight] = await bounds(model(editor).locator('.lesson-model-hud > .model-status').first());
      assert(Math.abs(statusX + statusWidth / 2 - modelX - paneWidth / 2) <= 1, 'Model status stays centered in the 3D pane');
      const statusBottom = modelY + paneHeight - statusY - statusHeight;
      const [creditX, creditY] = await bounds(model(editor).locator('.lesson-model-credit'));
      const creditInset = [creditX - modelX, creditY - modelY];
      assert.deepEqual(creditInset, [10, 10], 'Model attribution stays in the top-left corner');
      if (editor) {
        await page.getByRole('button', { name: 'Thiết lập 3D', exact: true }).click();
        const settings = page.locator('.lesson-model-settings[data-open="true"]');
        await settings.waitFor();
        assert.deepEqual(await bounds(settings), panels[2], '3D settings share the writing panel bounds');
        assert.deepEqual(await bounds(frame), panels[3], 'Opening settings preserves the model frame');
        const tree = settings.locator(':scope > .lesson-scene-tree');
        const controls = settings.locator(':scope > .lesson-model-settings-controls');
        const actions = settings.locator(':scope > .guide-heading .lesson-model-settings-actions');
        await tree.locator('.structure-tree > li').first().waitFor();
        assert.equal(await tree.locator('.structure-tree > li').count(), 9);
        assert.equal(await controls.locator('.lesson-inspector-actions').count(), 1);
        const [treeBounds, controlsBounds, actionsBounds] = await Promise.all([tree, controls, actions].map(bounds));
        assert(treeBounds[1] + treeBounds[3] <= controlsBounds[1], 'The structure tree is above the model controls');
        const scroll = await tree.evaluate(node => {
          node.scrollTop = node.scrollHeight;
          return {
            overflow: getComputedStyle(node).overflowY,
            scrollTop: node.scrollTop,
            scrollMax: node.scrollHeight - node.clientHeight,
          };
        });
        assert.equal(scroll.overflow, 'auto');
        assert(Math.abs(scroll.scrollTop - scroll.scrollMax) <= 1, 'Overflow scrolls inside the structure tree');
        assert.deepEqual(await bounds(controls), controlsBounds, 'The model controls stay in place while the tree scrolls');
        assert.deepEqual(await bounds(actions), actionsBounds, 'The header actions stay in place while the tree scrolls');
        await settings.getByRole('button', { name: 'Hủy', exact: true }).click();
      }
      await toggle.click();
      const closed = await Promise.all([model(editor), content(editor), frame].map(bounds));
      assert.equal(closed[0][2], modelWidth + outlineWidth + 16, 'The model takes the space freed by the outline');
      assert.deepEqual(closed[1], panels[2]);
      if (width === 1280) await requireAutoFit();
      await toggle.click();
      results.push({ panels, closed, statusBottom, creditInset });
    }
    for (const [width, height] of [[912, 570], [800, 500], [1280, 800], [1920, 1200]]) {
      await page.setViewportSize({ width, height });
      await requireAutoFit();
    }
    for (const [width, height] of [[800, 500], [901, 500], [1024, 640]]) {
      await page.setViewportSize({ width, height });
      const [scene, document] = await Promise.all([model(editor).boundingBox(), content(editor).boundingBox()]);
      assert(scene.width >= 240 && scene.x + scene.width <= document.x, `Usable side-by-side model at ${width}px`);
      assert(document.y + document.height <= height, `Writing or reading stays within ${width}×${height}`);
      if (editor) {
        for (const tool of await model(editor).locator('.lesson-model-settings-trigger').all()) {
          const button = await tool.boundingBox();
          if (!button) continue;
          assert(button.x >= scene.x && button.x + button.width <= scene.x + scene.width + 1,
            `The 3D toolbar stays inside its pane at ${width}px`);
        }
      } else {
        assert((await page.locator('.lesson-reader-body').boundingBox()).height >= 200, `Usable reading height at ${width}px`);
      }
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
    localStorage.setItem('soma.lesson-v1:' + lesson.id, JSON.stringify(lesson));
    for (const name of ['editorOutline', 'readerOutline']) localStorage.removeItem('soma.lessons.panel:' + name);
  }, lesson);
  await page.goto('/lessons/' + lesson.id + '/edit');
  const outline = page.locator('#lesson-author-outline');
  const settings = page.locator('.lesson-step-options');
  const document = page.locator('#lesson-author-writing');
  const model = page.locator('.lesson-scene-region');
  const saved = () => savedLesson(page, lesson.id);
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
  const cancelModelSettings = page.locator('#lesson-model-settings').getByRole('button', { name: 'Hủy', exact: true });
  await cancelModelSettings.waitFor();
  await page.waitForFunction(() => document.activeElement === document.querySelector('#lesson-model-settings .lesson-model-settings-actions > :first-child'));
  await document.locator('.tox-editor-header').waitFor();
  const coversToolbar = await page.locator('.lesson-model-settings[data-open="true"]').evaluate(async panel => {
    await Promise.all(panel.getAnimations().map(animation => animation.finished));
    const writing = window.document.getElementById('lesson-author-writing');
    const toolbar = writing.querySelector('.tox-editor-header');
    const { x, y, width, height } = toolbar.getBoundingClientRect();
    const wasInert = writing.inert;
    writing.inert = false;
    try {
      return panel.contains(window.document.elementFromPoint(x + width / 2, y + height / 2));
    } finally {
      writing.inert = wasInert;
    }
  });
  assert(coversToolbar, '3D settings cover the writing toolbar');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.lesson-model-settings')?.dataset.open === 'false'
    && document.activeElement === document.querySelector('.lesson-model-settings-trigger'));
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
  await page.getByRole('heading', { name: 'Bốn', exact: true }).waitFor();
  const readerOutline = page.locator('.lesson-reader-outline');
  const readerToggle = page.locator('.lesson-player-header .sidebar-toggle');
  await readerToggle.click();
  await readerOutline.getByRole('button', { name: 'Ba', exact: true }).click();
  assert(await readerOutline.isVisible());
  await page.getByRole('button', { name: 'Mục tiếp theo', exact: true }).click();
  assert(await readerOutline.isVisible());
  await page.getByRole('button', { name: 'Quay lại soạn bài', exact: true }).click();
  await page.getByLabel('Tên mục').waitFor();
  assert.equal(await page.getByLabel('Tên mục').inputValue(), 'Bốn');
  assert(await outline.isVisible());
  assert(await settings.isVisible());
  await page.getByRole('button', { name: 'Xem trước', exact: true }).click();
  await readerToggle.waitFor();
  assert(await readerOutline.isVisible(), 'Learner outline preference survives returning to preview');
  await readerOutline.getByRole('button', { name: 'Một', exact: true }).click();
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
