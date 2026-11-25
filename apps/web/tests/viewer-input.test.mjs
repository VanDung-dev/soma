import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('student input permits camera controls while blocking picking, marquee, hiding and separation', async t => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const previousWindow = globalThis.window;
  let unbind;
  try {
    const { bindViewerInput } = await server.ssrLoadModule('/src/viewer/input.ts');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    globalThis.window = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
    const canvas = Object.assign(new EventTarget(), { width: 300, height: 300, clientWidth: 300, clientHeight: 300,
      dataset: {}, focus() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 300 }) });
    const calls = [];
    const forbidden = () => assert.fail('Student mode cannot select or change lesson structures');
    const viewer = { rotate: () => calls.push('rotate'), pan: () => calls.push('pan'), zoom_at: () => calls.push('zoom'),
      selected_id: () => '', selection_ids: () => [], clear_selection() {}, pick: forbidden, select_region: forbidden, move_structure: forbidden };
    unbind = bindViewerInput(canvas, { enabled: () => true, selectable: () => false,
      operate: action => { action(viewer); return true; }, redraw() {}, pick: forbidden,
      detachable: () => true, detach: forbidden, hide: forbidden, beginGroup: forbidden });
    const pointer = (type, values = {}) => canvas.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      clientX: 100, clientY: 100, pointerId: 1, pointerType: 'mouse', button: 0,
      buttons: type === 'pointerup' ? 0 : 1, shiftKey: false, ...values,
    }));
    for (const values of [{}, { shiftKey: true }, { button: 2, buttons: 2 }]) {
      pointer('pointerdown', values); t.mock.timers.tick(1500);
      pointer('pointermove', { ...values, clientX: 150 }); pointer('pointerup', { ...values, clientX: 150, buttons: 0 });
      pointer('pointerdown', values); pointer('pointerup', { ...values, buttons: 0 });
    }
    canvas.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), { clientX: 100, clientY: 100, deltaY: 100, deltaMode: 0 }));
    assert.deepEqual(calls, ['rotate', 'rotate', 'pan', 'zoom']);
  } finally {
    unbind?.(); t.mock.timers.reset();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    await server.close();
  }
});

test('Shift-left marquee selects a temporary group and left hold moves it together with cancellation', async t => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const previousWindow = globalThis.window;
  let unbind;
  try {
    const { bindViewerInput } = await server.ssrLoadModule('/src/viewer/input.ts');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    globalThis.window = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
    const canvas = Object.assign(new EventTarget(), { width: 600, height: 300, clientWidth: 300, clientHeight: 150,
      dataset: {}, focus() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 20, top: 40, width: 300, height: 150 }) });
    let selection = [], selected = '', enabled = true, rotations = 0, pans = 0, starts = 0;
    const regions = [], boxes = [], moves = [], restored = [], snaps = [];
    const offsets = { a: new Float32Array([1, 2, 3]), b: new Float32Array([4, 5, 6]) };
    const viewer = {
      selected_id: () => selected, select: id => { selected = id; },
      pick: x => { selected = x < 500 ? 'a' : ''; return selected; },
      selection_ids: () => selection, clear_selection: () => { selection = []; },
      select_region: (...args) => { regions.push(args); selection = ['a', 'b']; return selection; },
      structure_offset: id => offsets[id], move_selection: (...args) => moves.push(args),
      move_structure: () => assert.fail('The selected group must use one shared translation'),
      restore_structure: (...args) => restored.push(args), rotate: () => rotations++, pan: () => pans++,
    };
    unbind = bindViewerInput(canvas, {
      enabled: () => enabled, operate: action => { action(viewer); return true; }, redraw() {}, pick() {},
      detachable: () => true, movable: () => true,
      beginGroup: () => { starts++; return true; }, onBox: rect => boxes.push(rect), snap: (...args) => snaps.push(args),
    });
    const pointer = (type, values = {}) => {
      const event = Object.assign(new Event(type, { cancelable: true }), {
        clientX: 50, clientY: 70, pointerId: 1, pointerType: 'mouse', button: 0,
        buttons: type === 'pointerup' ? 0 : 1, shiftKey: false, ...values,
      });
      canvas.dispatchEvent(event); return event;
    };
    const marquee = (reverse = false) => {
      const start = reverse ? { clientX: 180, clientY: 140 } : { clientX: 50, clientY: 70 };
      const end = reverse ? { clientX: 50, clientY: 70 } : { clientX: 180, clientY: 140 };
      assert(pointer('pointerdown', { ...start, button: 0, buttons: 1, shiftKey: true }).defaultPrevented);
      pointer('pointermove', { ...end, button: -1, buttons: 1, shiftKey: true });
      assert.deepEqual(boxes.at(-1), { x: 30, y: 30, width: 130, height: 70 });
      pointer('pointerup', { ...end, button: 0, shiftKey: true });
      assert.equal(boxes.at(-1), null);
      assert.deepEqual(regions.at(-1), [60, 100, 260, 140]);
    };
    marquee(); marquee(true);
    assert.equal(rotations, 0); assert.equal(pans, 0);
    pointer('pointerdown', { button: 0, buttons: 1, shiftKey: true });
    pointer('pointerup', { button: 0, shiftKey: true });
    assert.deepEqual(selection, ['a', 'b'], 'Shift click without a rectangle must preserve the group');
    assert.equal(regions.length, 2);
    pointer('pointerdown'); t.mock.timers.tick(999);
    assert.equal(starts, 0); assert.equal(canvas.dataset.dragging, undefined);
    t.mock.timers.tick(1); assert.equal(starts, 1);
    pointer('pointermove', { clientX: 80, clientY: 85 }); pointer('pointerup', { clientX: 80, clientY: 85 });
    assert.deepEqual(moves, [['a', 0.1, 0.1]]);
    assert.deepEqual(selection, ['a', 'b']);
    assert(!snaps.some(([id]) => id), 'Temporary groups must not snap to a neighbor');
    pointer('pointerdown'); t.mock.timers.tick(1000); pointer('pointermove', { clientX: 80 });
    pointer('pointercancel');
    assert.deepEqual(restored, [['a', offsets.a], ['b', offsets.b]], 'Cancel restores every member to its own offset');
    for (const interrupt of [
      () => pointer('pointercancel'), () => pointer('lostpointercapture'),
      () => window.dispatchEvent(new Event('blur')), () => window.dispatchEvent(new Event('resize')),
    ]) {
      pointer('pointerdown', { button: 0, buttons: 1, shiftKey: true }); interrupt();
      pointer('pointerup', { clientX: 180, clientY: 140, button: 0, shiftKey: true });
      assert.equal(regions.length, 2); assert.equal(boxes.at(-1), null);
    }
    pointer('pointerdown', { button: 0, buttons: 1, shiftKey: true });
    pointer('pointermove', { clientX: -100, clientY: 900, buttons: 1, shiftKey: true });
    pointer('pointerup', { clientX: -100, clientY: 900, button: 0, shiftKey: true });
    assert.deepEqual(regions.at(-1), [0, 0, 60, 240], 'Clip captured pointers to the canvas');
    pointer('pointerdown'); t.mock.timers.tick(500);
    const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
    canvas.dispatchEvent(escape); t.mock.timers.tick(1000);
    assert(escape.defaultPrevented); assert.deepEqual(selection, []); assert.equal(starts, 2);
    const settings = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
    canvas.dispatchEvent(settings); assert(!settings.defaultPrevented, 'Escape remains available when no group or gesture is active');
    for (const shiftKey of [false, true]) {
      pointer('pointerdown', { clientX: 300, button: 2, buttons: 2, shiftKey });
      pointer('pointermove', { clientX: 80, button: -1, buttons: 2, shiftKey });
      pointer('pointerup', { button: 2, shiftKey });
    }
    assert.equal(pans, 2, 'Right drag pans the camera with or without Shift');
    assert.equal(regions.length, 3, 'Right drag must not select a region');
    enabled = false;
    pointer('pointerdown', { button: 0, buttons: 1, shiftKey: true }); pointer('pointerup', { clientX: 180, clientY: 140, button: 0, shiftKey: true });
    assert.equal(regions.length, 3, 'Disabled viewers cannot select');
    enabled = true; marquee();
    pointer('pointerdown'); t.mock.timers.tick(1000); pointer('pointermove', { clientX: 80 }); unbind();
    assert.deepEqual(restored.slice(-2), [['a', offsets.a], ['b', offsets.b]], 'Disposal restores the whole drag');
    assert.equal(boxes.at(-1), null);
  } finally {
    unbind?.(); t.mock.timers.reset();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    await server.close();
  }
});

test('touchpad pinch follows gesture scale at the cursor while wheel zoom keeps its sensitivity', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const previousWindow = globalThis.window;
  let unbind;
  try {
    const { bindViewerInput } = await server.ssrLoadModule('/src/viewer/input.ts');
    globalThis.window = new EventTarget();
    const canvas = Object.assign(new EventTarget(), { clientHeight: 400,
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 400 }) });
    const calls = [];
    let enabled = true;
    unbind = bindViewerInput(canvas, { enabled: () => enabled,
      operate: action => { action({ zoom_at: (...args) => calls.push(args) }); return true; }, redraw() {}, pick() {} });
    const wheel = (deltaY, ctrlKey = false, deltaMode = 0) => {
      const event = Object.assign(new Event('wheel', { cancelable: true }), {
        clientX: 300, clientY: 350, deltaY, deltaMode, ctrlKey,
      });
      canvas.dispatchEvent(event);
      assert(event.defaultPrevented, 'Zoom must not magnify the page');
      return calls.at(-1);
    };
    for (const scale of [1.2, 1 / 1.2, 1.002]) {
      const [x, y, factor] = wheel(-100 * Math.log(scale), true);
      assert.equal(x, 0.25); assert.equal(y, 0.75);
      assert(Math.abs(factor - 1 / scale) < 1e-12, 'Pinch must preserve the browser gesture scale');
    }
    for (const [deltaY, deltaMode, pixels] of [[-100, 0, -100], [6, 1, 96], [-0.1, 2, -40]]) {
      assert.equal(wheel(deltaY, false, deltaMode)[2], Math.exp(pixels * 0.001));
    }
    for (const deltaY of [-10000, 10000]) {
      assert.equal(wheel(deltaY, true)[2], Math.exp(Math.sign(deltaY)));
    }
    const count = calls.length;
    enabled = false; wheel(-10, true);
    assert.equal(calls.length, count, 'Disabled viewers must ignore pinch');
    enabled = true; unbind();
    const disposed = new Event('wheel', { cancelable: true });
    canvas.dispatchEvent(disposed);
    assert(!disposed.defaultPrevented);
    assert.equal(calls.length, count, 'Disposed viewers must remove the wheel listener');
  } finally {
    unbind?.();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    await server.close();
  }
});

test('left hold detaches after one second and cancels on interrupted gestures', async t => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const previousWindow = globalThis.window;
  let unbind;
  try {
    const { bindViewerInput } = await server.ssrLoadModule('/src/viewer/input.ts');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    globalThis.window = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
    const canvas = Object.assign(new EventTarget(), { width: 300, height: 300, clientWidth: 300, clientHeight: 300,
      dataset: {}, focus() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 300 }) });
    let selected = 'a', moving = '', enabled = true, detachable = true, joined = false, rotations = 0;
    const detached = [], moves = [], picked = [], progress = [], committed = [], restored = [], snaps = [];
    const viewer = {
      selected_id: () => selected, select: id => { selected = id; },
      pick: x => { selected = x < 200 ? 'b' : ''; return selected; },
      structure_offset: () => new Float32Array([1, 2, 3]),
      move_structure: (...args) => moves.push(args), restore_structure: (...args) => restored.push(args),
      rotate: () => rotations++, pan() {}, zoom_at() {},
    };
    unbind = bindViewerInput(canvas, { enabled: () => enabled,
      operate: action => { action(viewer); return true; }, redraw() {}, pick: id => picked.push(id),
      moving: () => moving, detachable: () => detachable, joined: () => joined,
      detach: id => { detached.push(id); moving = selected = id; joined = false; return true; },
      onHold: point => progress.push(point), moved: id => committed.push(id),
      snap: (id, commit) => snaps.push([id, commit]),
    });
    const pointer = (type, values = {}) => canvas.dispatchEvent(Object.assign(new Event(type), {
      clientX: 130, clientY: 100, pointerId: 1, pointerType: 'mouse', button: 0,
      buttons: type === 'pointerup' ? 0 : 1, shiftKey: false, ...values,
    }));
    pointer('pointerdown');
    const menu = new Event('contextmenu', { cancelable: true });
    canvas.dispatchEvent(menu); assert(menu.defaultPrevented);
    assert.equal(selected, 'a', 'Starting the hold must preserve selection');
    assert.deepEqual(progress.at(-1), { x: 130, y: 100, action: 'move' });
    t.mock.timers.tick(999); assert.equal(detached.length, 0);
    pointer('pointermove', { clientX: 133 });
    assert.equal(rotations, 0, 'Small pointer jitter must not rotate the model');
    t.mock.timers.tick(1);
    assert.deepEqual(detached, ['b']); assert.deepEqual(picked, ['b']); assert.equal(progress.at(-1), null);
    assert.equal(canvas.dataset.dragging, 'true');
    pointer('pointermove', { clientX: 163 }); pointer('pointerup', { clientX: 163 });
    assert.deepEqual(moves, [['b', 0.1, 0]], 'Continue dragging without a second press or a jump');
    assert.deepEqual(committed, ['b']); assert.deepEqual(picked, ['b'], 'A held release must not select again');
    assert.deepEqual(snaps, [['b', false], ['b', true]], 'Preview while dragging and connect only on release');
    pointer('pointerdown', { button: 0, buttons: 1 }); pointer('pointermove', { clientX: 131, button: -1, buttons: 1 }); pointer('pointerup', { clientX: 131, button: 0 });
    assert.deepEqual(snaps.at(-1), ['', false], 'A short click must clear the drag preview');
    moving = '';
    pointer('pointerdown', { button: 0, buttons: 1 }); t.mock.timers.tick(400); pointer('pointerup', { button: 0 }); t.mock.timers.tick(1000);
    assert.deepEqual(picked, ['b', 'b', 'b'], 'A short click keeps ordinary selection');
    assert.equal(detached.length, 1);
    pointer('pointerdown'); pointer('pointermove', { clientX: 150 }); t.mock.timers.tick(1000); pointer('pointerup');
    assert.equal(rotations, 1, 'Dragging before the threshold must rotate');
    assert.equal(detached.length, 1); assert.equal(progress.at(-1), null);
    const interruptions = [
      () => pointer('pointercancel'), () => pointer('lostpointercapture'), () => pointer('pointerleave'),
      () => window.dispatchEvent(new Event('blur')), () => window.dispatchEvent(new Event('resize')),
      () => canvas.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })),
      () => canvas.dispatchEvent(Object.assign(new Event('wheel'), { clientX: 130, clientY: 100, deltaY: 1, deltaMode: 0 })),
      () => { pointer('pointerdown', { pointerId: 2 }); pointer('pointerup', { pointerId: 2 }); },
    ];
    for (const interrupt of interruptions) {
      pointer('pointerdown'); t.mock.timers.tick(500); interrupt(); t.mock.timers.tick(1000);
      assert.equal(detached.length, 1, 'Interrupted holds must not detach later');
      assert.equal(progress.at(-1), null); pointer('pointercancel');
    }
    for (const values of [{ clientX: 230 }, { button: 2, buttons: 2 }, { shiftKey: true }, { pointerType: 'touch' }]) {
      const count = progress.length;
      pointer('pointerdown', values); t.mock.timers.tick(1000); pointer('pointerup', values);
      assert.equal(progress.length, count, 'Only an unmodified left mouse hold on anatomy shows progress');
    }
    for (const change of [() => { enabled = false; }, () => { detachable = false; }]) {
      pointer('pointerdown'); t.mock.timers.tick(500); change(); t.mock.timers.tick(500); pointer('pointercancel');
      assert.equal(detached.length, 1, 'Recheck availability before detaching'); enabled = detachable = true;
    }
    detachable = false;
    const count = progress.length;
    pointer('pointerdown'); t.mock.timers.tick(1000); pointer('pointerup');
    assert.equal(progress.length, count, 'Automatic explosion must not offer manual separation');
    detachable = true;
    pointer('pointerdown'); t.mock.timers.tick(1000); pointer('pointermove', { clientX: 160 }); pointer('lostpointercapture');
    assert.deepEqual(restored.at(-1), ['b', new Float32Array([1, 2, 3])], 'Capture loss restores the pre-drag offset');
    assert.deepEqual(snaps.at(-1), ['', false], 'Cancelled drags must never connect');
    joined = true;
    pointer('pointerdown'); t.mock.timers.tick(500); pointer('pointermove', { clientX: 160 }); pointer('pointerup', { clientX: 160 });
    assert.equal(detached.length, 2, 'Dragging immediately preserves the joined group');
    assert(joined);
    pointer('pointerdown'); t.mock.timers.tick(1000);
    assert.equal(detached.length, 3, 'A full hold detaches one joined piece'); assert(!joined);
    pointer('pointerup');
    moving = '';
    pointer('pointerdown'); unbind(); t.mock.timers.tick(1000);
    assert.equal(detached.length, 3, 'Disposal must cancel the pending hold'); assert.equal(progress.at(-1), null);
  } finally {
    unbind?.(); t.mock.timers.reset();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    await server.close();
  }
});

test('right hold hides the hit structure or selected group and cancels interrupted holds', async t => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const previousWindow = globalThis.window;
  let unbind;
  try {
    const { bindViewerInput } = await server.ssrLoadModule('/src/viewer/input.ts');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    globalThis.window = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
    const canvas = Object.assign(new EventTarget(), { width: 300, height: 300, clientWidth: 300, clientHeight: 300,
      dataset: {}, focus() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 300 }) });
    let selected = 'b', selection = [], enabled = true, hit = 'a', pans = 0;
    const hidden = [], progress = [], picked = [];
    const viewer = { selected_id: () => selected, select: id => { selected = id; },
      pick: () => { selected = hit; return hit; }, selection_ids: () => selection, clear_selection() {},
      rotate() {}, pan: () => pans++, zoom_at() {} };
    unbind = bindViewerInput(canvas, { enabled: () => enabled, operate: action => { action(viewer); return true; },
      redraw() {}, pick: id => picked.push(id), detachable: () => false,
      hide: ids => { hidden.push(ids); selected = ''; return true; }, onHold: point => progress.push(point) });
    const pointer = (type, values = {}) => canvas.dispatchEvent(Object.assign(new Event(type), {
      clientX: 100, clientY: 100, pointerId: 1, pointerType: 'mouse', button: 2,
      buttons: type === 'pointerup' ? 0 : 2, shiftKey: false, ...values,
    }));
    pointer('pointerdown');
    assert.equal(selected, 'b');
    const menu = new Event('contextmenu', { cancelable: true });
    canvas.dispatchEvent(menu); assert(menu.defaultPrevented);
    assert.deepEqual(progress.at(-1), { x: 100, y: 100, action: 'hide' });
    t.mock.timers.tick(999); assert.deepEqual(hidden, []);
    pointer('pointermove', { clientX: 102 }); t.mock.timers.tick(1);
    assert.deepEqual(hidden, [['a']], 'Hiding remains available during automatic explosion');
    assert.equal(progress.at(-1), null);
    pointer('pointermove', { clientX: 140 }); pointer('pointerup');
    assert.equal(pans, 0, 'A completed hide must consume the rest of the gesture');
    assert.deepEqual(picked, [], 'Release must not select a structure behind the hidden one');
    selection = ['a', 'b'];
    pointer('pointerdown'); t.mock.timers.tick(1000); pointer('pointerup');
    assert.deepEqual(hidden.at(-1), ['a', 'b']);
    hit = 'c';
    pointer('pointerdown'); t.mock.timers.tick(1000); pointer('pointerup');
    assert.deepEqual(hidden.at(-1), ['c'], 'An outside hit must not hide the selected group');
    for (const interrupt of [
      () => pointer('pointerup'), () => pointer('pointercancel'), () => pointer('lostpointercapture'),
      () => pointer('pointerleave'), () => pointer('pointermove', { clientX: 120 }),
      () => window.dispatchEvent(new Event('blur')), () => window.dispatchEvent(new Event('resize')),
      () => canvas.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })),
      () => canvas.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 1, deltaMode: 0 })),
      () => { pointer('pointerdown', { pointerId: 2 }); pointer('pointercancel', { pointerId: 2 }); },
      () => { enabled = false; },
    ]) {
      pointer('pointerdown'); t.mock.timers.tick(500); interrupt(); t.mock.timers.tick(1000);
      assert.equal(hidden.length, 3); pointer('pointercancel'); enabled = true;
    }
    for (const values of [{ pointerType: 'touch' }, { button: 0, buttons: 1 }]) {
      pointer('pointerdown', values); t.mock.timers.tick(1000); pointer('pointercancel');
      assert.equal(hidden.length, 3);
    }
    pointer('pointerdown'); unbind(); t.mock.timers.tick(1000);
    assert.equal(hidden.length, 3); assert.equal(progress.at(-1), null);
  } finally {
    unbind?.(); t.mock.timers.reset();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    await server.close();
  }
});

test('manual separation drags only its structure and rotates only from empty background', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  const previousWindow = globalThis.window;
  let unbind;
  try {
    const { bindViewerInput } = await server.ssrLoadModule('/src/viewer/input.ts');
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
    unbind = bindViewerInput(canvas, { enabled: () => true,
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
    assert.equal(pans, 1, 'Right dragging must pan the camera');
    const movedCount = moves.length;
    pointer('pointerdown', 30, 2, 2); pointer('pointermove', 50, -1, 2); pointer('pointerup', 50, 2);
    assert.equal(pans, 2, 'Right dragging must pan even over a movable structure');
    assert.equal(moves.length, movedCount, 'Right dragging must not move anatomy');
    for (const shiftKey of [false, true]) {
      const menu = Object.assign(new Event('contextmenu', { cancelable: true }), { button: 2, shiftKey });
      canvas.dispatchEvent(menu);
      assert(menu.defaultPrevented, 'The canvas owns right-button input instead of opening a browser menu');
    }
    moving = '';
    pointer('pointerdown', 130); pointer('pointermove', 150); pointer('pointerup', 150);
    assert.equal(rotations, 2, 'Normal navigation remains available outside separation mode');
    moving = selected = 'b'; separated.add('a');
    pointer('pointerdown', 30); pointer('pointermove', 50);
    assert.equal(selected, 'a', 'Highlight the separated structure currently being dragged');
    assert.equal(picked.at(-1), 'a', 'Update anatomy information before the drag ends');
    pointer('pointerup', 50);
    assert.equal(moves.at(-1)[0], 'a', 'Previously separated structures remain draggable without Move again');
    assert.equal(committed.at(-1), 'a', 'Commit the structure being dragged rather than the newest separation');
    pointer('pointerdown', 30); pointer('pointermove', 50);
    for (const key of ['w', 'a', 's', 'd', 'e', 'q', 'r', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
      canvas.dispatchEvent(event);
      assert(event.defaultPrevented, `Block camera key ${key} while dragging anatomy`);
    }
    const unrelated = Object.assign(new Event('keydown', { cancelable: true }), { key: 'z' });
    canvas.dispatchEvent(unrelated); assert(!unrelated.defaultPrevented);
    const restore = Object.assign(new Event('keydown', { cancelable: true }), { key: 't', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
    canvas.dispatchEvent(restore); assert(restore.defaultPrevented); assert.deepEqual(restored, [true]);
    const count = moves.length;
    pointer('pointermove', 70); pointer('pointerup', 70);
    assert.equal(moves.length, count, 'T must finish the drag before restoring so later movement cannot reapply it');
    canvas.width = 800; canvas.height = 400;
    canvas.getBoundingClientRect = () => ({ left: 20, top: 40, width: 200, height: 100 });
    const pixels = [];
    viewer.pick = (x, y) => { pixels.push([x, y]); selected = 'a'; return selected; };
    moving = ''; separated.clear(); selected = 'b';
    pointer('pointerdown', 70);
    assert.equal(selected, 'b', 'Hit testing must preserve selection until the click completes');
    pointer('pointerup', 70);
    assert.deepEqual(pixels, [[200, 159], [200, 159]], 'Hold and click must use the same scaled canvas coordinates and inverted Y');
    assert.equal(selected, 'a');
  } finally {
    unbind?.();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    await server.close();
  }
});
