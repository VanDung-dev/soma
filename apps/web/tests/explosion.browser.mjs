import { getWasm } from '../src/core.ts';

// Run in Vite: (await import('/tests/explosion.browser.mjs')).checkExplosion()
export async function checkExplosion() {
  const { AnatomyViewer } = await getWasm();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  canvas.style.cssText = 'width:256px;height:256px;position:fixed;left:-1000px';
  document.body.append(canvas);
  const gl = canvas.getContext('webgl2'), locations = new Map(), offsets = [];
  const getLocation = gl.getUniformLocation, setVector = gl.uniform3fv, setMatrix = gl.uniformMatrix4fv;
  let matrix, viewer, sphereDraws = 0;
  const drawArrays = gl.drawArrays;
  gl.drawArrays = function(...args) { sphereDraws++; return drawArrays.apply(this,args); };
  gl.getUniformLocation = function(program, name) {
    const location = getLocation.call(this, program, name); locations.set(location, name); return location;
  };
  gl.uniform3fv = function(location, value) {
    if (locations.get(location) === 'part_offset') offsets.push([...value]);
    return setVector.call(this, location, value);
  };
  gl.uniformMatrix4fv = function(location, transpose, value) {
    if (locations.get(location) === 'view_projection') matrix = [...value];
    return setMatrix.call(this, location, transpose, value);
  };
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const bounds = (left, right) => ({ min: [left, -0.5, 0], max: [right, 0.5, 0] });
  const part = (id, left, right) => ({ source_id: id, bounds: bounds(left, right),
    color: [0.4,0.2,0.1,1], roughness: 0.6, metallic: 0, specular: 0.04, subsurface: 0,
    double_sided: true, blend: false, alpha_cutoff: 0, active: true, visible: true });
  const vertices = [], indices = [];
  for (const [left, right] of [[-0.9,-0.55],[-0.55,-0.2],[0.2,0.9]]) {
    const base = vertices.length / 6;
    for (const [x, y] of [[left,-0.5],[right,-0.5],[right,0.5],[left,0.5]]) vertices.push(x,y,0,0,0,1);
    indices.push(base,base+1,base+2,base,base+2,base+3);
  }
  const pixels = () => {
    offsets.length = 0; sphereDraws = 0; viewer.render();
    const rgba = new Uint8Array(256 * 256 * 4);
    gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    assert(gl.getError() === gl.NO_ERROR, 'Explosion produced a WebGL error');
    return rgba;
  };
  const pickCenter = (x, offset) => {
    const point = [x + offset[0], offset[1], offset[2], 1];
    const clip = [0,1,2,3].map(row => point.reduce((sum, value, col) => sum + matrix[col * 4 + row] * value, 0));
    return viewer.pick(Math.floor((clip[0] / clip[3] + 1) * 128), Math.floor((clip[1] / clip[3] + 1) * 128));
  };
  try {
    viewer = AnatomyViewer.fromPrepared(canvas, [new Float32Array(vertices), new Uint32Array(indices),
      JSON.stringify({ scene: { bounds: bounds(-0.9,0.9), selected: '',
        parts: [part('a',-0.9,-0.55),part('a',-0.55,-0.2),part('b',0.2,0.9)] },
      draws: [[6,0],[6,24],[6,48]], vertex_count: 12, index_count: 18 })]);
    viewer.configure_explosion('[["a"],["b"]]');
    pixels();
    const defaultMatrix = JSON.stringify(matrix);
    viewer.rotate(0.2,-0.1); viewer.pan(0.01,-0.01); viewer.zoom(1.6);
    const before = pixels(), beforeMatrix = [...matrix];
    for (const amount of [0,0.01,0.3,0.31,0.6,0.61,0.99,1]) {
      viewer.set_explode_mode(true); viewer.reframe(0.1,0.1,0.8,0.6);
      viewer.set_explode(amount, 0, false);
      const displayed = pixels();
      assert(JSON.stringify(matrix) === JSON.stringify(beforeMatrix),
        'Separation must preserve the zoomed, rotated and panned camera');
      assert(sphereDraws === 1, 'Keep the spherical grid at every separation level');
      assert(displayed.filter((value, i) => i % 4 === 3 && value > 0 && value < 255).length > 500,
        'The spherical grid must produce visible background pixels');
      if (amount === 0) assert(displayed.every((value, i) => value === before[i]),
        'Zero separation must keep the assembled image and spherical space');
      const moved = offsets.slice(-3);
      assert(JSON.stringify(moved[0]) === JSON.stringify(moved[1]), 'Keep multipart structures together');
      assert(pickCenter(-0.72,moved[0]) === 'a', `Pick translated structure a at ${amount}`);
      viewer.select(''); pixels();
      assert(pickCenter(0.55,moved[2]) === 'b', `Pick translated structure b at ${amount}`);
      viewer.select('a');
      const selected = pixels();
      assert(selected.some((value, i) => i % 4 === 2 && value > selected[i-2] + 25
        && value > selected[i-1] + 8), 'Outline must follow translated structures');
      viewer.select(''); viewer.set_explode_mode(false);
      const restored = pixels();
      assert(JSON.stringify(matrix) === JSON.stringify(beforeMatrix), 'Restore the exact anatomy camera');
      assert(restored.every((value, i) => value === before[i]), 'Restore the assembled image exactly');
    }
    viewer.set_explode_mode(true); viewer.set_explode(1, 0, true);
    assert(viewer.render_explosion(16), 'Animate separation');
    viewer.set_explode_mode(false);
    assert(pixels().every((value, i) => value === before[i]), 'Leaving during animation must restore anatomy');
    viewer.set_explode_mode(true); viewer.set_explode(0.35, 0, false);
    viewer.rotate(0.12,-0.08); viewer.pan(0.01,0.02); viewer.zoom(0.8); pixels();
    const adjustedMatrix = JSON.stringify(matrix);
    for (const [time, amount] of [[16,0.8],[32,1],[48,0.2],[64,0]]) {
      viewer.set_explode(amount, time, true); viewer.render_explosion(time + 16); pixels();
      assert(JSON.stringify(matrix) === adjustedMatrix, 'Animation must preserve camera adjustments during separation');
      viewer.finish_explosion(); pixels();
      assert(JSON.stringify(matrix) === adjustedMatrix, 'Finishing separation must preserve the camera');
    }
    viewer.set_explode_mode(false); pixels();
    assert(JSON.stringify(matrix) === adjustedMatrix, 'Reassembly must retain the latest camera');
    for (let cycle = 0; cycle < 3; cycle++) {
      viewer.set_explode_mode(true); viewer.set_explode(1, 0, false);
      viewer.inspect('reset'); pixels();
      const layoutMatrix = JSON.stringify(matrix);
      viewer.set_explode_mode(false); pixels();
      assert(JSON.stringify(matrix) === layoutMatrix, 'Returning to zero must not move the camera');
      viewer.inspect('reset'); pixels();
      assert(JSON.stringify(matrix) === defaultMatrix,
        'Reset after reassembly must restore anatomy framing, not the separated layout');
    }
    viewer.set_explode_mode(true); viewer.set_explode(1, 0, false);
    viewer.change_visibility('["b"]', false); viewer.finish_explosion(); pixels();
    assert(viewer.visible_count() === 1, 'Repack only visible structures');
    viewer.set_visibility('[]'); viewer.finish_explosion(); pixels();
    assert(viewer.visible_count() === 0, 'Empty layouts remain valid');
    viewer.set_visibility('["a","b"]'); viewer.finish_explosion();
    viewer.focus('["b"]',0.1,0.1,0.8,0.6); pixels();
    assert(pickCenter(0.55,offsets.slice(-3)[2]) === 'b', 'Focus uses the translated bounds');
    viewer.select('');
    viewer.resize(256,256); viewer.reframe(0.1,0.1,0.8,0.6); viewer.finish_explosion(); pixels();
    const project = point => {
      const clip = [0,1,2,3].map(row => [...point,1].reduce((sum, value, col) => sum + matrix[col * 4 + row] * value, 0));
      return clip.slice(0,2).map(value => value / clip[3]);
    };
    const rotateAt = (pivot, message) => {
      const before = project(pivot);
      viewer.rotate(0.35,-0.15); pixels();
      assert(Math.hypot(...project(pivot).map((value,i) => value - before[i])) < 1e-4, message);
    };
    const centered = (pivot, expected, message) => assert(
      Math.hypot(...project(pivot).map((value,i) => value - expected[i])) < 1e-4,
      `${message}: ${JSON.stringify({ pivot, actual: project(pivot), expected })}`);
    let orbitTime = 100;
    for (const [amount, animate] of [[0,false],[0.35,false],[1,false],[0.6,true]]) {
      orbitTime += 100;
      viewer.set_explode(amount, orbitTime, animate);
      if (animate) viewer.render_explosion(orbitTime + 16);
      viewer.inspect('reset');
      // Start another animation after reset, which deliberately finishes transitions.
      if (animate) { viewer.set_explode(0.3, orbitTime + 20, true); viewer.render_explosion(orbitTime + 36); }
      viewer.pan(0.04,-0.03); viewer.zoom(0.8); pixels();
      const moved = offsets.slice(-3);
      const beforeSelection = JSON.stringify(matrix);
      assert(pickCenter(-0.72,moved[0]) === 'a', 'Click must select the moved structure');
      viewer.select('b'); viewer.select('a'); pixels();
      assert(JSON.stringify(matrix) === beforeSelection, 'Click and transient hover must preserve framing and zoom');
      rotateAt(moved[0].map((value,i) => value + [-0.55,0,0][i]),
        'Orbit must use the current translated center of all selected primitives');
      const selectedPivot = moved[0].map((value,i) => value + [-0.55,0,0][i]);
      viewer.center(0.3,0.4); pixels();
      centered(selectedPivot,[-0.4,0.2],'Center the selected structure in the available viewport');
      rotateAt(selectedPivot, 'A centered selection must remain centered while orbiting');
      viewer.zoom(0.85); pixels();
      centered(selectedPivot,[-0.4,0.2],'Zoom must preserve the selected viewport center');
      viewer.inspect('reset'); pixels();
      const resetOffset = offsets.at(-1);
      centered(resetOffset.map((value,i) => value + [-0.55,0,0][i]),[-0.4,0.2],
        'Reset must keep the selected structure in the available viewport');
      // Restore animated offsets before checking the unselected layout center.
      viewer.set_explode(amount,orbitTime + 40,false); pixels();
      const beforeDeselect = JSON.stringify(matrix);
      viewer.select(''); pixels();
      const restored = offsets.slice(-3);
      assert(JSON.stringify(matrix) === beforeDeselect, 'Deselecting must not snap the camera');
      const center = [
        (Math.min(-0.9 + restored[0][0],0.2 + restored[2][0]) + Math.max(-0.2 + restored[0][0],0.9 + restored[2][0])) / 2,
        (restored[0][1] + restored[2][1]) / 2, (restored[0][2] + restored[2][2]) / 2,
      ];
      rotateAt(center, 'Deselecting must restore the whole model pivot');
      viewer.center(0.5,0.45); pixels();
      centered(center,[0,0.1],'Center the original model when nothing is selected');
    }
    viewer.set_explode_mode(false); viewer.inspect('reset');
    viewer.select('a'); viewer.clear_center(); viewer.inspect('reset'); pixels();
    const uncentered = JSON.stringify(matrix);
    viewer.pan(0.08,-0.04); viewer.zoom(0.8); viewer.rotate(0.2,-0.1); pixels();
    const beforeExpand = JSON.stringify(matrix);
    viewer.center(0.3,0.4); pixels();
    viewer.pan(-0.05,0.02); viewer.zoom(0.9); viewer.rotate(-0.1,0.2);
    viewer.center(0.25,0.45); pixels();
    viewer.clear_center(); pixels();
    assert(JSON.stringify(matrix) === beforeExpand, 'Closing the expanded reader must restore its original camera');
    viewer.clear_center(); pixels();
    assert(JSON.stringify(matrix) === beforeExpand, 'Repeated close callbacks must not overwrite the restored view');
    viewer.inspect('reset'); pixels();
    assert(JSON.stringify(matrix) === uncentered, 'Reset must not restore the disabled centering constraint');
    viewer.center(0.25,0.4,1000); pixels();
    assert(JSON.stringify(matrix) === uncentered, 'Opening must start at the current camera without a jump');
    assert(viewer.advance_camera(1016), 'Opening must move through intermediate frames'); pixels();
    const intermediate = JSON.stringify(matrix);
    assert(intermediate !== uncentered, 'Camera must move gradually toward the expanded viewport');
    viewer.clear_center(1016); pixels();
    assert(JSON.stringify(matrix) === intermediate, 'Closing mid-animation must continue from the displayed camera');
    viewer.advance_camera(1032); pixels();
    const closing = JSON.stringify(matrix);
    viewer.center(0.2,0.45,1032); pixels();
    assert(JSON.stringify(matrix) === closing, 'Reopening mid-return must not jump or replace the original camera');
    viewer.advance_camera(1048); viewer.finish_camera_transition(); pixels();
    centered([-0.55,0,0],[-0.6,0.1],'Finishing reduced motion must reach the exact expanded center');
    viewer.clear_center(1048);
    let moving = true, cameraSteps = 0;
    for (let time = 1064; moving && cameraSteps < 100; time += 16) {
      moving = viewer.advance_camera(time); cameraSteps++;
    }
    pixels();
    assert(!moving && cameraSteps > 2 && JSON.stringify(matrix) === uncentered,
      'Animated return must finish at the exact original camera after rapid toggles');
    viewer.center(0.25,0.4,3000); viewer.advance_camera(3016);
    viewer.rotate(0.1,0); pixels();
    const manual = JSON.stringify(matrix);
    assert(!viewer.advance_camera(3032), 'Manual rotation must interrupt automatic camera movement'); pixels();
    assert(JSON.stringify(matrix) === manual, 'Interrupted animation must not fight the user controls');
    viewer.clear_center(); pixels();
    assert(JSON.stringify(matrix) === uncentered, 'Closing after a manual adjustment must still restore the saved view');
    viewer.select('a'); viewer.change_visibility('["a"]',false); pixels();
    assert(viewer.selected_id() === '', 'Hiding the selected structure must release its pivot');
    rotateAt([0,0,0], 'A hidden selection must fall back to the original model center');
    viewer.set_visibility('["a","b"]'); viewer.set_explode_mode(true);
    for (const amount of [NaN,Infinity,-0.1,1.1]) {
      let rejected = false;
      try { viewer.set_explode(amount, 1, false); } catch { rejected = true; }
      assert(rejected, 'Reject invalid amounts');
    }
    for (const point of [[NaN,0.5],[0.5,Infinity],[-0.1,0.5],[0.5,1.1]]) {
      let rejected = false;
      try { viewer.center(...point); } catch { rejected = true; }
      assert(rejected, 'Reject invalid viewport centers');
    }
    return { reassembledResetCycles: 3, preservedCamera: true, animatedCameraAdjustments: true, sphereAtEveryLevel: true,
      multipart: true, picking: true, outline: true, exactCameraAndImageRestore: true,
      interrupt: true, visibility: true, empty: true, focus: true, resize: true, validation: true,
      selectedOrbit: true, animatedOrbit: true, deselectedOrbit: true, hiddenOrbit: true, viewportCenter: true,
      closeRestoresCamera: true, repeatedClosePreservesView: true, resetClearsCenter: true,
      smoothCamera: true, rapidToggles: true, manualInterrupt: true, reducedMotionFinish: true };
  } finally { viewer?.free(); canvas.remove(); }
}

export async function checkExplosionControls() {
  const { AnatomyViewer } = await getWasm(), proto = AnatomyViewer.prototype;
  const original = proto.set_explode, originalMode = proto.set_explode_mode;
  const originalRender = proto.render_explosion;
  const media = window.matchMedia;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const wait = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const slider = document.querySelector('.explode-control input');
  const input = value => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,value);
    slider.dispatchEvent(new Event('input',{ bubbles: true }));
  };
  let amount, enabled = false, reduced = true, movingReturn = false, finishReturn, timeout;
  const switches = [];
  window.matchMedia = function(query) {
    return media.call(this, query === '(prefers-reduced-motion: reduce)'
      ? reduced ? '(min-width: 0px)' : '(max-width: 0px)' : query);
  };
  proto.set_explode_mode = function(value) {
    enabled = value; switches.push(value); return originalMode.call(this,value);
  };
  proto.set_explode = function(value, time, animate) {
    amount = value; assert(animate === !reduced, 'Respect reduced motion'); return original.call(this,value,time,animate);
  };
  proto.render_explosion = function(time) {
    const moving = originalRender.call(this,time);
    if (amount === 0) {
      movingReturn ||= moving;
      if (!moving) finishReturn?.();
    }
    return moving;
  };
  try {
    input('0'); await wait(); switches.length = 0;
    assert(slider && slider.value === '0' && !document.querySelector('.view-modes')
      && !document.querySelector('.explode-control button'),
      'Show one slider for assembled and separated anatomy');
    input('100'); await wait();
    assert(enabled && amount === 1 && document.querySelector('.explode-label output').textContent === '100%',
      'Moving the slider must activate separation');
    input('35'); await wait();
    assert(amount === 0.35 && switches.length === 1, 'Adjust separation without resaving the anatomy camera');
    input('0'); await wait();
    assert(!enabled && slider.value === '0' && switches.length === 2,
      `Reassemble at zero: enabled=${enabled}, switches=${switches}, value=${slider.value}`);
    for (let i = 0; i < 10; i++) {
      input('100'); await wait();
      input('0'); await wait();
    }
    assert(!enabled && !document.querySelector('.model-error'), 'Repeated separation must remain stable');
    assert(document.querySelector('.explode-control input') === slider, 'Keep the slider mounted at zero');
    input('100'); await wait();
    reduced = false; input('0'); await wait();
    assert(enabled && movingReturn, 'Zero must animate back before leaving separation');
    const switchesBeforeInterrupt = switches.length;
    input('35'); await wait();
    assert(enabled && amount === 0.35 && switches.length === switchesBeforeInterrupt,
      'Allow interrupting reassembly without clearing offsets');
    const settled = new Promise(resolve => { finishReturn = resolve; });
    input('0');
    await Promise.race([settled, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(Error('Reassembly did not settle')), 3000);
    })]);
    assert(!enabled && slider.value === '0' && !document.querySelector('.model-error'),
      'Finish reassembly and leave separation cleanly');
    return { unifiedSlider: true, automaticSeparation: true, reassemble: true, animatedReturn: true,
      interruptedReturn: true, repeatedCycles: 10, reducedMotion: true };
  } finally {
    clearTimeout(timeout); reduced = true;
    input('0');
    window.matchMedia = media; proto.set_explode = original; proto.set_explode_mode = originalMode;
    proto.render_explosion = originalRender;
  }
}

export async function checkExplodedOpacity() {
  const { AnatomyViewer } = await getWasm();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const gl = canvas.getContext('webgl2');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const bounds = { min: [-0.5,-0.5,0], max: [0.5,0.5,0] };
  const packed = { scene: { bounds, selected: '', parts: [{ source_id: 'fascia', bounds,
    color: [0.4,0.3,0.2,0.15], roughness: 0.6, metallic: 0, specular: 0.04, subsurface: 0,
    double_sided: true, blend: true, alpha_cutoff: 0, active: true, visible: true }] },
    draws: [[6,0]], vertex_count: 4, index_count: 6 };
  const vertices = new Float32Array([-0.5,-0.5,0,0,0,1, 0.5,-0.5,0,0,0,1,
    0.5,0.5,0,0,0,1, -0.5,0.5,0,0,0,1]);
  let viewer, shadowDraws = 0, framebuffer, materialAlpha;
  const bind = gl.bindFramebuffer, draw = gl.drawElements;
  gl.bindFramebuffer = function(target, value) { framebuffer = value; return bind.call(this,target,value); };
  gl.drawElements = function(...args) {
    if (framebuffer) shadowDraws++;
    else {
      const program = gl.getParameter(gl.CURRENT_PROGRAM);
      materialAlpha = gl.getUniform(program, gl.getUniformLocation(program,'base_color'))[3];
      assert(gl.getParameter(gl.DEPTH_WRITEMASK) === !gl.isEnabled(gl.BLEND),
        'Opaque separated tissue must write depth; translucent tissue must blend');
    }
    return draw.apply(this,args);
  };
  const opacity = amount => {
    viewer.set_explode(amount, 0, false); shadowDraws = 0; viewer.render();
    const rgba = new Uint8Array(128 * 128 * 4);
    gl.readPixels(0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
    assert(gl.getError() === gl.NO_ERROR, 'Opacity transition produced a WebGL error');
    return rgba.reduce((max, value, i) => i % 4 === 3 ? Math.max(max,value) : max, 0);
  };
  try {
    viewer = AnatomyViewer.fromPrepared(canvas,
      [vertices,new Uint32Array([0,1,2,0,2,3]),JSON.stringify(packed)]);
    viewer.configure_explosion('[["fascia"]]'); viewer.set_explode_mode(true);
    opacity(0);
    assert(Math.abs(materialAlpha - 0.15) < 1e-6, 'Keep source opacity over the assembled sphere');
    opacity(0.5);
    assert(Math.abs(materialAlpha - 0.575) < 1e-6, 'Increase opacity with separation');
    assert(shadowDraws === 0, 'Translucent tissue must not cast an opaque shadow');
    assert(opacity(1) === 255, 'Fully separated tissue must be opaque');
    assert(shadowDraws > 0, 'Opaque separated tissue must cast shadows');
    viewer.set_explode_mode(false); viewer.set_explode_mode(true);
    opacity(0);
    assert(Math.abs(materialAlpha - 0.15) < 1e-6, 'Reassembly must restore source opacity');
    packed.scene.parts[0].color[3] = 0;
    viewer.free(); viewer = undefined;
    const invisibleCanvas = document.createElement('canvas');
    invisibleCanvas.width = invisibleCanvas.height = 128;
    viewer = AnatomyViewer.fromPrepared(invisibleCanvas,
      [vertices,new Uint32Array([0,1,2,0,2,3]),JSON.stringify(packed)]);
    viewer.configure_explosion('[["fascia"]]'); viewer.set_explode_mode(true);
    viewer.set_explode(1, 0, false); viewer.render();
    const invisibleGl = invisibleCanvas.getContext('webgl2'), rgba = new Uint8Array(128 * 128 * 4);
    invisibleGl.readPixels(0,0,128,128,invisibleGl.RGBA,invisibleGl.UNSIGNED_BYTE,rgba);
    viewer.set_visibility('[]'); viewer.finish_explosion(); viewer.render();
    const background = new Uint8Array(rgba.length);
    invisibleGl.readPixels(0,0,128,128,invisibleGl.RGBA,invisibleGl.UNSIGNED_BYTE,background);
    assert(invisibleGl.getError() === invisibleGl.NO_ERROR && rgba.every((value, i) => value === background[i]),
      'Do not reveal fully invisible source material');
    return { sourceAlpha: 0.15, halfwayAlpha: 0.575, separatedAlpha: 1,
      depthAndShadows: true, restored: true, invisiblePreserved: true };
  } finally { viewer?.free(); canvas.remove(); }
}
