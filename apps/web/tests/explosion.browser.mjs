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
    viewer.rotate(0.2,-0.1); viewer.pan(0.01,-0.01); viewer.zoom(0.9);
    const before = pixels(), beforeMatrix = [...matrix];
    for (const amount of [0,0.35,0.45,1]) {
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
    for (const amount of [NaN,Infinity,-0.1,1.1]) {
      let rejected = false;
      try { viewer.set_explode(amount, 1, false); } catch { rejected = true; }
      assert(rejected, 'Reject invalid amounts');
    }
    return { reassembledResetCycles: 3, preservedCamera: true, animatedCameraAdjustments: true, sphereAtEveryLevel: true,
      multipart: true, picking: true, outline: true, exactCameraAndImageRestore: true,
      interrupt: true, visibility: true, empty: true, focus: true, resize: true, validation: true };
  } finally { viewer?.free(); canvas.remove(); }
}

export async function checkExplosionControls() {
  const { AnatomyViewer } = await getWasm(), proto = AnatomyViewer.prototype;
  const original = proto.set_explode, originalMode = proto.set_explode_mode;
  const media = window.matchMedia;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const wait = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  let amount, enabled = false;
  const switches = [];
  window.matchMedia = function(query) {
    return media.call(this, query === '(prefers-reduced-motion: reduce)' ? '(min-width: 0px)' : query);
  };
  proto.set_explode_mode = function(value) {
    enabled = value; switches.push(value); return originalMode.call(this,value);
  };
  proto.set_explode = function(value, time, animate) {
    amount = value; assert(!animate, 'Respect reduced motion'); return original.call(this,value,time,animate);
  };
  try {
    document.querySelector('.explode-reset').click(); await wait(); switches.length = 0;
    const slider = document.querySelector('.explode-control input');
    assert(slider && slider.value === '0' && !document.querySelector('.view-modes'),
      'Show one slider for assembled and separated anatomy');
    const input = value => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,value);
      slider.dispatchEvent(new Event('input',{ bubbles: true }));
    };
    input('100'); await wait();
    assert(enabled && amount === 1 && document.querySelector('.explode-label output').textContent === '100%',
      'Moving the slider must activate separation');
    input('35'); await wait();
    assert(amount === 0.35 && switches.length === 1, 'Adjust separation without resaving the anatomy camera');
    document.querySelector('.explode-reset').click(); await wait();
    assert(!enabled && slider.value === '0' && switches.length === 2, 'Reassemble and restore the anatomy camera');
    for (let i = 0; i < 10; i++) {
      input('100'); await wait();
      input('0'); await wait();
    }
    assert(!enabled && !document.querySelector('.model-error'), 'Repeated separation must remain stable');
    assert(document.querySelector('.explode-control input') === slider, 'Keep the slider mounted at zero');
    return { unifiedSlider: true, automaticSeparation: true, reassemble: true, repeatedCycles: 10, reducedMotion: true };
  } finally {
    document.querySelector('.explode-reset').click();
    window.matchMedia = media; proto.set_explode = original; proto.set_explode_mode = originalMode;
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
