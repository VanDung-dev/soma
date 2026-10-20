import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('manual separation drags only its structure and rotates only from empty background', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const previousWindow = globalThis.window;
  let unbind;
  try {
    const { bindViewerInput } = await server.ssrLoadModule('/src/anatomy/viewer/input.ts');
    globalThis.window = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
    const bounds = { left: 0, top: 0, right: 300, bottom: 300, width: 300, height: 300 };
    const canvas = Object.assign(new EventTarget(), { width: 300, height: 300, clientWidth: 300, clientHeight: 300,
      dataset: {}, focus() {}, setPointerCapture() {}, hasPointerCapture: () => false, getBoundingClientRect: () => bounds });
    let selected = 'a', moving = 'a', moves = [], rotations = 0, pans = 0, picked = [];
    const separated = new Set(), restored = [], committed = [];
    const viewer = {
      selected_id: () => selected, select: id => { selected = id; },
      pick: x => { selected = x < 100 ? 'a' : x < 200 ? 'b' : ''; return selected; },
      structure_offset: () => new Float32Array([0, 0, 0]),
      move_structure: (...args) => moves.push(args), restore_structure() {},
      rotate: () => rotations++, pan: () => pans++,
    };
    unbind = bindViewerInput(canvas, { enabled: () => true, frame: () => bounds,
      operate: action => { action(viewer); return true; }, redraw() {}, hover() {}, pick: id => picked.push(id), moving: () => moving || [...separated][0] || '',
      movable: id => id === moving || separated.has(id), moved: id => committed.push(id), restore: () => restored.push(true) });
    const pointer = (type, x, button = 0, buttons = type === 'pointerup' ? 0 : 1) => {
      const event = Object.assign(new Event(type), { clientX: x, clientY: 100, pointerId: 1, pointerType: 'mouse', button, buttons, shiftKey: false });
      canvas.dispatchEvent(event);
    };
    pointer('pointerdown', 130); pointer('pointermove', 150); pointer('pointerup', 150);
    assert.equal(rotations, 0, 'Dragging another structure during separation must not rotate the whole body');
    assert.equal(moves.length, 0, 'Another structure must not inherit movement mode');
    assert.equal(selected, 'a');
    pointer('pointerdown', 30); pointer('pointermove', 50); pointer('pointerup', 50);
    assert.equal(moves.length, 1); assert.equal(moves[0][0], 'a');
    assert.equal(rotations, 0);
    pointer('pointerdown', 230); pointer('pointermove', 250); pointer('pointerup', 250);
    assert.equal(rotations, 1, 'Background dragging must retain camera rotation');
    pointer('pointerdown', 130); pointer('pointerup', 130);
    assert.deepEqual(picked, ['b'], 'A primary click must still select another structure');
    pointer('pointerdown', 30); pointer('pointerup', 30);
    assert.equal(selected, 'a', 'Clicking the active moving structure must select it again');
    assert.deepEqual(picked, ['b', 'a']);
    pointer('pointerdown', 130, 2, 2); pointer('pointermove', 150, 2, 2); pointer('pointerup', 150, 2);
    assert.equal(pans, 1, 'Right dragging must retain camera pan');
    moving = '';
    pointer('pointerdown', 130); pointer('pointermove', 150); pointer('pointerup', 150);
    assert.equal(rotations, 2, 'Normal navigation remains available outside separation mode');
    moving = 'b'; separated.add('a');
    pointer('pointerdown', 30); pointer('pointermove', 50); pointer('pointerup', 50);
    assert.equal(moves.at(-1)[0], 'a', 'Previously separated structures remain draggable without Move again');
    assert.equal(committed.at(-1), 'a', 'Commit the structure being dragged rather than the newest separation');
    pointer('pointerdown', 30); pointer('pointermove', 50);
    const restore = Object.assign(new Event('keydown', { cancelable: true }), { key: 't', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
    canvas.dispatchEvent(restore); assert(restore.defaultPrevented); assert.deepEqual(restored, [true]);
    const count = moves.length;
    pointer('pointermove', 70); pointer('pointerup', 70);
    assert.equal(moves.length, count, 'T must finish the drag before restoring so later movement cannot reapply it');
  } finally {
    unbind?.();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    await server.close();
  }
});
