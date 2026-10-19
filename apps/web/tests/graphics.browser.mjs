import { getWasm } from '../src/core.ts';

export async function checkGraphics() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  assert(document.querySelector('.model-canvas[aria-busy="false"]'), 'Wait for model loading to finish');
  const { AnatomyViewer } = await getWasm();
  const popover = document.querySelector('.settings-popover');
  const [shadow, lighting, quality, fps] = popover.querySelectorAll('select');
  for (const [control, values] of [[shadow, ['high', 'low', 'off']], [lighting, ['high', 'low']],
    [quality, ['high', 'low']], [fps, ['60', '30']]]) {
    assert(JSON.stringify([...control.options].map(option => option.value)) === JSON.stringify(values),
      'Expose only the requested levels in their requested order');
  }
  assert(quality.labels[0].textContent === (document.documentElement.lang === 'en' ? 'Display sharpness' : 'Độ nét hiển thị'),
    'Label display sharpness explicitly');
  const grid = popover.querySelector('input[id$="-grid"]');
  const showFps = popover.querySelector('input[id$="-show-fps"]');
  const canvas = document.querySelector('.model-canvas canvas'), gl = canvas.getContext('webgl2');
  const original = { quality: quality.value, shadow: shadow.value, lighting: lighting.value, fps: fps.value,
    grid: grid.checked, showFps: showFps.checked, open: popover.matches(':popover-open'),
    configure: AnatomyViewer.prototype.set_graphics, drawElements: gl.drawElements, drawArrays: gl.drawArrays,
    storage: gl.renderbufferStorage };
  let viewer, shadowDraws = 0, backgrounds = 0, shadowSize;
  AnatomyViewer.prototype.set_graphics = function(...args) {
    viewer = this; return original.configure.apply(this, args);
  };
  gl.drawElements = function(...args) {
    if (this.getParameter(this.FRAMEBUFFER_BINDING)) shadowDraws++;
    return original.drawElements.apply(this, args);
  };
  gl.drawArrays = function(...args) { backgrounds++; return original.drawArrays.apply(this, args); };
  gl.renderbufferStorage = function(...args) {
    shadowSize = args.slice(2); return original.storage.apply(this, args);
  };
  const frames = async () => { for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame); };
  const choose = async (control, value) => {
    control.value = value; control.dispatchEvent(new Event('change', { bubbles: true })); await frames();
  };
  const matrix = () => {
    viewer.render();
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    return [...gl.getUniform(program, gl.getUniformLocation(program, 'view_projection'))];
  };
  try {
    if (!original.open) popover.showPopover();
    await choose(fps, '30'); await choose(fps, '60');
    await choose(shadow, 'off'); await choose(lighting, 'high'); await choose(quality, 'high');
    assert(viewer, 'Settings must reach the WASM viewer');
    const selected = viewer.selected_id(); viewer.select('');
    viewer.finish_camera_transition(); viewer.rotate(0.17, -0.06); viewer.pan(0.025, -0.015); viewer.zoom(0.94);
    const before = matrix(), visible = viewer.visible_count(), bounds = canvas.getBoundingClientRect();
    const results = [];
    for (const [value, scale] of [['low', 0.5], ['high', 1]]) {
      await choose(quality, value);
      const ratio = Math.min(devicePixelRatio, 2) * scale;
      assert(canvas.width === Math.max(1, Math.round(bounds.width * ratio))
        && canvas.height === Math.max(1, Math.round(bounds.height * ratio)), 'Apply render resolution');
      assert(shadowSize?.every(size => size === 1), 'Model quality must not enable shadows');
      assert(matrix().every((value, i) => Math.abs(value - before[i]) < 1e-6), 'Quality changes must preserve the camera');
      assert(viewer.visible_count() === visible, 'Quality changes must preserve visible anatomy');
      shadowDraws = 0;
      viewer.render_reconstruction(performance.now());
      assert(shadowDraws === 0, 'Model quality must not change shadow passes');
      const program = gl.getParameter(gl.CURRENT_PROGRAM);
      assert(gl.getUniform(program, gl.getUniformLocation(program, 'lighting_quality')) === 2,
        'Model quality must not change lighting');
      results.push({ quality: value, width: canvas.width, height: canvas.height });
    }
    const fullSize = [canvas.width, canvas.height];
    for (const [value, level, size] of [['off', 0, 1], ['low', 1, 1024], ['high', 2, 2048]]) {
      await choose(shadow, value);
      shadowDraws = 0; viewer.render_reconstruction(performance.now());
      assert(level === 0 ? shadowDraws === 0 : shadowDraws > 0, 'Apply shadow passes independently');
      assert(shadowSize.every(value => value === size), 'Apply shadow resolution independently');
      assert(canvas.width === fullSize[0] && canvas.height === fullSize[1], 'Shadows must not change render resolution');
      const program = gl.getParameter(gl.CURRENT_PROGRAM);
      assert(gl.getUniform(program, gl.getUniformLocation(program, 'shadow_quality')) === level, 'Apply shadow filtering');
    }
    for (const [value, level] of [['low', 0], ['high', 2]]) {
      await choose(lighting, value); viewer.render();
      const program = gl.getParameter(gl.CURRENT_PROGRAM);
      assert(gl.getUniform(program, gl.getUniformLocation(program, 'lighting_quality')) === level, 'Apply lighting quality');
      assert(gl.getUniform(program, gl.getUniformLocation(program, 'shadow_quality')) === 2, 'Lighting must not change shadows');
      assert(canvas.width === fullSize[0] && canvas.height === fullSize[1], 'Lighting must not change resolution');
      assert(matrix().every((value, i) => Math.abs(value - before[i]) < 1e-6), 'Lighting and shadows must preserve the camera');
    }
    for (const shown of [false, true, false, true]) {
      if (grid.checked !== shown) { grid.click(); await frames(); }
      backgrounds = 0; viewer.render();
      assert(backgrounds === (shown ? 1 : 0), 'Grid toggle must skip or draw the background pass');
    }
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    viewer.render(); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const pixel = pixels.findIndex((value, i) => i % 4 === 3 && value === 255) / 4;
    assert(pixel >= 0, 'Anatomy must remain visible');
    const picked = viewer.pick(pixel % canvas.width, Math.floor(pixel / canvas.width));
    assert(picked, 'Picking must work after changing render resolution'); viewer.select('');
    assert(JSON.parse(localStorage.getItem('human-atlas-graphics')).modelQuality === 'high', 'Persist graphics settings');
    let invalid = 0;
    for (const args of [[3, 2, true, canvas.width, canvas.height], [2, 3, true, canvas.width, canvas.height], [0, 2, true, 0, canvas.height]]) {
      try { viewer.set_graphics(...args); } catch { invalid++; }
    }
    assert(invalid === 3, 'Reject invalid renderer configuration');
    if (!showFps.checked) { showFps.click(); await frames(); }
    await choose(fps, '30'); popover.hidePopover(); canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 1250));
    canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    const activeFps = parseInt(document.querySelector('.model-fps')?.textContent);
    assert(activeFps > 0 && activeFps <= 35, 'Show measured render FPS within the selected frame limit');
    await new Promise(resolve => setTimeout(resolve, 2200));
    assert(document.querySelector('.model-fps')?.textContent === '0 FPS', 'The FPS display must return to zero when idle');
    popover.showPopover();
    assert(gl.getError() === gl.NO_ERROR && !document.querySelector('.model-error'), 'Keep WebGL healthy');
    const area = popover.getBoundingClientRect();
    assert(area.left >= 0 && area.right <= innerWidth && area.top >= 0 && area.bottom <= innerHeight
      && popover.scrollWidth <= popover.clientWidth, 'Settings must fit the viewport');
    viewer.select(selected);
    return { modelResolution: results, independentShadows: true, independentLighting: true,
      activeFps, idleFps: 0, cameraPreserved: true, visibilityPreserved: true, gridPass: true, picking: true,
      persistence: true, invalidRejected: true, viewportFits: true };
  } finally {
    canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    window.dispatchEvent(new Event('blur'));
    await choose(quality, original.quality); await choose(shadow, original.shadow);
    await choose(lighting, original.lighting); await choose(fps, original.fps);
    if (grid.checked !== original.grid) { grid.click(); await frames(); }
    if (showFps.checked !== original.showFps) { showFps.click(); await frames(); }
    viewer?.inspect('reset'); viewer?.render();
    if (!original.open) popover.hidePopover();
    AnatomyViewer.prototype.set_graphics = original.configure;
    gl.drawElements = original.drawElements; gl.drawArrays = original.drawArrays; gl.renderbufferStorage = original.storage;
  }
}
