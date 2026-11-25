import { lessonBody, savedLesson, saveLessonDraft } from './lesson-editor-tools.mjs';
import assert from 'node:assert/strict';

export async function checkLessonOutlineTouch(page) {
  const browser = page.context().browser();
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, hasTouch: true, isMobile: true });
  try {
    const mobile = await context.newPage();
    const errors = [];
    mobile.on('pageerror', error => errors.push(error.message));
    const origin = new URL(page.url()).origin;
    await mobile.goto(origin + '/lessons');
    const text = vi => ({ vi, en: '' });
    const lesson = { id: 'touch-outline-check', version: 1, title: text('Kéo thả cảm ứng'), summary: text(''), modelId: '',
      steps: Array.from({ length: 20 }, (_, i) => ({ id: 'touch-' + i, kind: 'text', title: text('Mục ' + (i + 1)), instruction: text('Nội dung ' + i) })) };
    await mobile.evaluate(lesson => localStorage.setItem('soma.lesson-v1:' + lesson.id, JSON.stringify(lesson)), lesson);
    await mobile.goto(origin + '/lessons/' + lesson.id + '/edit');
    const outline = mobile.locator('#lesson-author-outline');
    await outline.waitFor();
    await outline.locator('[data-lesson-step="touch-0"] .lesson-outline-row').click();
    await lessonBody(mobile).waitFor();
    await mobile.evaluate(()=>document.fonts.ready);
    const cdp = await context.newCDPSession(mobile);
    const saved = () => savedLesson(mobile, 'touch-outline-check');
    const order = () => outline.locator('[data-lesson-step]').evaluateAll(rows => rows.map(row => row.dataset.lessonStep));
    const area = outline.locator('.catalog-tree');
    await area.evaluate(node => { node.scrollTop = node.querySelector('[data-lesson-step]').offsetTop; });
    const handle = outline.locator('[data-lesson-step="touch-0"] .lesson-drag-handle');
    const start = await handle.boundingBox();
    const target = await outline.locator('[data-lesson-step="touch-1"]').boundingBox();
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type,
      touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1, radiusX: 5, radiusY: 5, force: 1 }] });
    await touch('touchStart', start.x + start.width / 2, start.y + start.height / 2);
    await touch('touchMove', target.x + 20, target.y + target.height * 0.6);
    await touch('touchEnd');
    await mobile.waitForFunction(() => document.querySelector('#lesson-author-outline [data-lesson-step]')?.dataset.lessonStep === 'touch-1');
    const staged = await order();
    assert.deepEqual(staged.slice(0, 2), ['touch-1', 'touch-0']);
    const unchanged = await saved();
    assert.deepEqual(unchanged.steps.slice(0, 2).map(step => step.id), ['touch-0', 'touch-1']);
    const cancelledHandle = await outline.locator('[data-lesson-step="touch-1"] .lesson-drag-handle').boundingBox();
    await touch('touchStart', cancelledHandle.x + 12, cancelledHandle.y + 20);
    await touch('touchMove', target.x + 20, target.y + target.height * 0.6);
    await touch('touchCancel');
    assert.deepEqual(await order(), staged);
    assert.deepEqual(await saved(), unchanged, 'Touch cancellation must not persist a partial reorder');
    const first = await outline.locator('[data-lesson-step="touch-1"] .lesson-drag-handle').boundingBox();
    const bounds = await area.boundingBox();
    const beforeScroll = await area.evaluate(node => node.scrollTop);
    await touch('touchStart', first.x + 12, first.y + 20);
    await touch('touchMove', bounds.x + 20, bounds.y + bounds.height - 6);
    await mobile.waitForFunction(before => document.querySelector('#lesson-author-outline .catalog-tree').scrollTop > before + 70, beforeScroll, { timeout: 3000 });
    await touch('touchEnd');
    await saveLessonDraft(mobile);
    const reordered = await saved();
    assert(reordered.steps.findIndex(step => step.id === 'touch-1') > 1, 'Dragging at the edge scrolls a long outline');
    assert.deepEqual([...reordered.steps].sort((a, b) => a.id.localeCompare(b.id)), [...lesson.steps].sort((a, b) => a.id.localeCompare(b.id)));
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}
