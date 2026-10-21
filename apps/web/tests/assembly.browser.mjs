import { getCatalog, getWasm } from '../src/anatomy/core.ts';

export async function checkAssembly() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const canvas = document.querySelector('.model-canvas canvas');
  assert(document.querySelector('.model-canvas[aria-busy="false"]'), 'Wait for model loading');
  const { AnatomyViewer } = await getWasm(), proto = AnatomyViewer.prototype;
  const original = { zoom: proto.zoom_at, pick: proto.pick, capture: canvas.setPointerCapture };
  let viewer, hit = '';
  proto.zoom_at = function(...args) { viewer = this; return original.zoom.apply(this, args); };
  const area = canvas.getBoundingClientRect();
  const point = { pointerId: 999, pointerType: 'mouse', button: 0,
    clientX: area.left + area.width / 2, clientY: area.top + area.height / 2, bubbles: true };
  const pointer = (type, dx = 0) => canvas.dispatchEvent(new PointerEvent(type,
    { ...point, clientX: point.clientX + dx, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1 }));
  const offset = id => [...viewer.structure_offset(id)];
  const equal = (a, b) => a.every((value, i) => Math.abs(value - b[i]) < 1e-6);
  let ids = [], a, b;
  try {
    canvas.dispatchEvent(new WheelEvent('wheel', { ...point, deltaY: 0, bubbles: true, cancelable: true }));
    assert(viewer, 'Capture the live renderer');
    const catalog = await getCatalog();
    ids = [...new Set(catalog.targets.flatMap(target => target.model?.structure_ids ?? []))];
    for (const id of ids) {
      const target = viewer.preview_connection(id);
      if (target) { a = id; b = target; break; }
    }
    viewer.preview_connection('');
    assert(a && b, 'Find an adjacent pair in the source model');
    viewer.set_visibility(JSON.stringify([a, b]));
    viewer.move_structure(a, 0.15, 0);
    const anchor = offset(a);
    viewer.restore_structure(b, new Float32Array(anchor));
    viewer.move_structure(b, -6 / area.width, 0);
    const before = offset(b);
    hit = b;
    proto.pick = function() { this.select(hit); return hit; };
    canvas.setPointerCapture = () => {};
    pointer('pointerdown'); await new Promise(resolve => setTimeout(resolve, 1100));
    pointer('pointermove', 6); await frames();
    assert(document.querySelector('.model-snap-hint')?.textContent.includes('Thả chuột'), 'Show the release-to-connect hint');
    assert(viewer.structure_group(b).length === 1 && equal(offset(a), anchor), 'Preview must not move or join the target');
    pointer('pointercancel'); await frames();
    assert(!document.querySelector('.model-snap-hint'), 'Cancellation removes the hint');
    assert(equal(offset(b), before) && viewer.structure_group(b).length === 1, 'Cancellation restores position without joining');
    hit = a;
    pointer('pointerdown'); pointer('pointermove', -30); await frames();
    assert(viewer.selected_id() === a && document.querySelector('.information-heading').dataset.structureId === a,
      'Highlight and anatomy information must follow an older separated piece while it is dragged');
    pointer('pointercancel'); await frames();
    hit = b;
    pointer('pointerdown'); pointer('pointermove', 6); await frames();
    assert(viewer.selected_id() === b && document.querySelector('.information-heading').dataset.structureId === b,
      'Switch selection back when dragging the other piece');
    assert(document.querySelector('.model-snap-hint'), 'Offer the same connection on the next drag');
    pointer('pointerup', 6); await frames();
    assert(viewer.structure_group(a).includes(b) && equal(offset(a), offset(b)), 'Release aligns and joins the pair');
    assert(!document.querySelector('.model-snap-hint'), 'Release clears the hint');
    const assembled = offset(a);
    pointer('pointerdown'); pointer('pointermove', 40); pointer('pointerup', 40); await frames();
    assert(!equal(offset(a), assembled) && equal(offset(a), offset(b)), 'Dragging a joined piece moves the entire group');
    hit = a;
    const stationary = offset(b);
    pointer('pointerdown'); await new Promise(resolve => setTimeout(resolve, 1100));
    assert(viewer.structure_group(a).length === 1, 'Holding detaches one piece from the group');
    pointer('pointermove', 70); pointer('pointerup', 70); await frames();
    assert(equal(offset(b), stationary) && !equal(offset(a), offset(b)), 'The detached piece moves independently');
    viewer.restore_structure(b);
    viewer.restore_structure(a);
    viewer.move_structure(a, -6 / area.width, 0);
    pointer('pointerdown'); pointer('pointermove', 6); await frames();
    assert(document.querySelector('.model-snap-hint'), 'Suggest reattachment to the assembled body');
    pointer('pointerup', 6); await frames();
    assert(offset(a).every(value => value === 0) && viewer.separated_ids().length === 0, 'Body attachment restores the exact source position');
    assert(!document.querySelector('.explode-control input').disabled, 'Body attachment unlocks automatic explosion');
    assert(canvas.getContext('webgl2').getError() === 0 && !document.querySelector('.model-error'), 'Keep WebGL healthy');
    return { pair: [a, b], preview: true, cancel: true, dragSelectionFollowsPiece: true,
      releaseToJoin: true, groupDrag: true, holdToDetach: true, bodyReattachment: true };
  } finally {
    pointer('pointercancel');
    if (viewer) {
      viewer.restore_structure('');
      if (ids.length) viewer.set_visibility(JSON.stringify(ids));
      canvas.focus(); canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true }));
      viewer.render();
    }
    proto.zoom_at = original.zoom; proto.pick = original.pick; canvas.setPointerCapture = original.capture;
  }
}
