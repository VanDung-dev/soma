import { getCatalog, getWasm } from '../src/core.ts';

export async function checkInventorySwitch() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const catalog = await getCatalog(), { AnatomyViewer } = await getWasm(), proto = AnatomyViewer.prototype;
  const canvas = document.querySelector('.model-canvas canvas'), gl = canvas.getContext('webgl2');
  const slider = document.querySelector('.explode-control input');
  const original = { explode: proto.set_study_explosion, matrix: gl.uniformMatrix4fv };
  const wait = time => new Promise(resolve => setTimeout(resolve, time));
  const input = value => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, String(value));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const focus = target => {
    const name = document.querySelector(`[data-target-id="${target.id}"] > .tree-row .tree-name`);
    for (const detail of [1, 2]) name.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
    name.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
  };
  let viewer, matrix;
  proto.set_study_explosion = function(...args) { viewer = this; return original.explode.apply(this, args); };
  gl.uniformMatrix4fv = function(...args) {
    const result = original.matrix.apply(this, args), program = this.getParameter(this.CURRENT_PROGRAM);
    const location = program && this.getUniformLocation(program, 'view_projection');
    if (location) matrix = [...this.getUniform(program, location)];
    return result;
  };
  const snapshot = () => { viewer.render(); return matrix.slice(); };
  const same = (a, b) => a.every((value, i) => Math.abs(value - b[i]) < 1e-5);
  try {
    focus(catalog.roots[0]); await wait(700);
    input(100); await wait(900);
    const systems = ['2: Muscular insertions', '6: Lymphoid organs', '8: Visceral systems', '9: Regions of human body']
      .map(name => catalog.roots.find(root => root.source_name === name));
    const results = [];
    for (const target of systems) {
      assert(target, 'Find a source system');
      const before = snapshot();
      focus(target);
      const started = snapshot();
      assert(same(started, before), `System focus must start from the displayed camera without a jump: ${target.source_name} ${JSON.stringify({ before, started })}`);
      await wait(150);
      assert(same(snapshot(), before), 'Fade out the old system before zooming into the new inventory');
      await wait(750);
      const settled = snapshot();
      assert(!same(settled, before), 'Fit the new inventory instead of keeping the previous system scale');
      await wait(400);
      assert(same(snapshot(), settled), 'Fading out the old system must not trigger a second camera adjustment');
      assert(viewer.visible_count() === catalog.members(target.id).length, 'Show only the focused system');
      assert(slider.value === '100', 'Keep full separation when switching systems');
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let opaque = 0, grid = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] === 255) opaque++;
        else if (pixels[i] > 0) grid++;
      }
      assert(opaque > 100 && grid > 500, 'Keep the new inventory and spherical grid visible');
      results.push({ system: target.source_name, structures: viewer.visible_count(), opaque, grid });
    }
    for (const target of systems) { focus(target); await wait(90); }
    await wait(1000);
    assert(viewer.visible_count() === catalog.members(systems.at(-1).id).length,
      'Rapid switching must finish at the latest system');
    assert(gl.getError() === gl.NO_ERROR && !document.querySelector('.model-error'), 'Keep the renderer healthy');
    return { smoothCamera: true, noSecondRepack: true, rapidSwitch: true, systems: results };
  } finally {
    input(0); document.querySelector('.tree-actions button').click(); await wait(700);
    proto.set_study_explosion = original.explode; gl.uniformMatrix4fv = original.matrix; catalog.free();
  }
}
