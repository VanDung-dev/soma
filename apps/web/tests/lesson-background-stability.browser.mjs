export function readLessonFocus(viewer, canvas) {
  const gl = canvas.getContext('webgl2'), arrays = gl.drawArrays, elements = gl.drawElements;
  const target = viewer.camera_pose().target;
  const project = (matrix, point) => {
    const p = new DOMMatrix(Array.from(matrix)).transformPoint(new DOMPoint(...point));
    return [(p.x / p.w + 1) / 2, (1 - p.y / p.w) / 2];
  };
  const focus = {};
  gl.drawArrays = function(...args) {
    arrays.apply(this, args);
    const program = this.getParameter(this.CURRENT_PROGRAM);
    const location = this.getUniformLocation(program, 'inverse_projection');
    if (location) {
      const projection = new DOMMatrix(Array.from(this.getUniform(program, location))).inverse();
      const origin = this.getUniform(program, this.getUniformLocation(program, 'sphere_origin'));
      focus.background = project(projection.toFloat64Array(), Array.from(origin).slice(0, 3));
    }
  };
  gl.drawElements = function(...args) {
    elements.apply(this, args);
    const program = this.getParameter(this.CURRENT_PROGRAM);
    if (!this.getUniform(program, this.getUniformLocation(program, 'shadow_pass'))) {
      focus.model = project(this.getUniform(program, this.getUniformLocation(program, 'view_projection')), target);
    }
  };
  try { viewer.render(); }
  finally { gl.drawArrays = arrays; gl.drawElements = elements; }
  return focus;
}

export async function checkLessonResetFocus(page, viewerName, canvasSelector) {
  await page.evaluate(async () => {
    await Promise.all([...document.querySelectorAll('.lesson-editor, .lesson-player')]
      .flatMap(node => node.getAnimations({ subtree: true }))
      .filter(animation => animation.effect.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.evaluate(name => {
    const viewer = window[name];
    viewer.rotate(0.35, 0.15); viewer.pan(0.12, -0.08); viewer.zoom(0.7); viewer.render();
  }, viewerName);
  await page.locator(canvasSelector).focus();
  await page.keyboard.press('r');
  await page.evaluate(async ({ viewerName, canvasSelector }) => {
    const { readLessonFocus } = await import('/tests/lesson-background-stability.browser.mjs');
    const viewer = window[viewerName], canvas = document.querySelector(canvasSelector);
    viewer.finish_camera_transition();
    const frame = canvas.closest('.lesson-editor, .lesson-player').querySelector('.model-focus-frame').getBoundingClientRect();
    const host = canvas.getBoundingClientRect();
    const expected = [(frame.left + frame.width / 2 - host.left) / host.width, (frame.top + frame.height / 2 - host.top) / host.height];
    const focus = readLessonFocus(viewer, canvas), pose = viewer.camera_pose();
    if (Math.abs(pose.yaw) > 1e-5 || Math.abs(pose.pitch) > 1e-5 || pose.pan.some(value => Math.abs(value) > 1e-5)) throw Error('R must reset rotation and pan');
    for (const key of ['model', 'background']) {
      if (!focus[key]?.every((value, index) => Math.abs(value - expected[index]) < 1e-4)) throw Error(`R must fit ${key} to the current lesson focus frame`);
    }
  }, { viewerName, canvasSelector });
}

export async function checkLessonBackgroundStability(page) {
  await page.goto('/home');
  const result = await page.evaluate(async () => {
    const { readLessonFocus } = await import('/tests/lesson-background-stability.browser.mjs');
    const { getWasm, getCatalog } = await import('/src/anatomy/core.ts');
    const wasm = await getWasm(), catalog = await getCatalog();
    const assert = (ok, message) => { if (!ok) throw Error(message); };
    const create = () => {
      const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 128;
      return canvas;
    };
    const capture = (viewer, canvas) => {
      const gl = canvas.getContext('webgl2'), draw = gl.drawArrays;
      let pixels;
      gl.drawArrays = function(...args) {
        draw.apply(this, args);
        const program = this.getParameter(this.CURRENT_PROGRAM);
        if (this.getUniformLocation(program, 'inverse_projection')) {
          pixels = new Uint8Array(canvas.width * canvas.height * 4);
          this.readPixels(0, 0, canvas.width, canvas.height, this.RGBA, this.UNSIGNED_BYTE, pixels);
        }
      };
      try { viewer.render(); assert(gl.getError() === gl.NO_ERROR, 'Background rendering must not produce WebGL errors'); }
      finally { gl.drawArrays = draw; }
      return pixels;
    };
    const equal = (left, right) => left?.length === right?.length && left.every((value, index) => value === right[index]);
    const canvas = create(), viewer = wasm.AnatomyViewer.background(canvas);
    let anatomy;
    let checks = 0, focusChecks = 0;
    try {
      let baseline = capture(viewer, canvas);
      assert(baseline.some((value, index) => index % 4 === 3 && value > 0), 'The empty renderer must draw the spherical grid');
      const stable = () => { assert(equal(capture(viewer, canvas), baseline), 'Lesson layout must leave every background pixel unchanged'); checks++; };
      let movements = 0;
      const moving = (action) => {
        const before = capture(viewer, canvas);
        action();
        baseline = capture(viewer, canvas);
        assert(!equal(baseline, before), 'Camera interaction and authored rotation must move the lesson background');
        movements++;
      };
      const focused = (center) => {
        const focus = readLessonFocus(viewer, canvas);
        const expected = center ?? focus.model ?? [0.5, 0.5];
        assert(focus.background.every((value, index) => Math.abs(value - expected[index]) < 1e-4), 'The background must share the model focus or center when empty');
        if (focus.model && center) assert(focus.model.every((value, index) => Math.abs(value - center[index]) < 1e-4), 'Reset must return the model to the lesson focus frame');
        focusChecks++;
      };
      focused([0.5, 0.5]);
      const ids = catalog.members('collection:baf3076d0495a617');
      const bytes = new Uint8Array(await (await fetch('/models/z-anatomy/z-anatomy.glb.br')).arrayBuffer());
      const { manifest } = await (await fetch('/models/z-anatomy/z-anatomy.json')).json();
      const prepared = wasm.prepare_model(bytes, manifest.models.flatMap(model => model.source_ids), ids);
      viewer.appendPrepared(prepared, 1, false);
      const frame = [0.24, 0.1, 0.35, 0.75], center = [frame[0] + frame[2] / 2, frame[1] + frame[3] / 2];
      viewer.reframe(...frame); viewer.apply_scene(ids); viewer.align_viewport(true);
      const fitted = viewer.capture_view();
      viewer.rotate(0.4, 0.2); viewer.pan(0.1, -0.1); viewer.zoom(0.8);
      viewer.inspect('reset', 10); viewer.finish_camera_transition();
      focused(center);
      assert(Math.abs(viewer.camera_pose().distance - fitted.camera.distance) < 1e-4, 'Reset must preserve the fitted scale for the lesson focus frame');
      viewer.set_visibility([]);
      focused([0.5, 0.5]);
      viewer.reframe(0, 0, 1, 1); viewer.align_viewport(true); baseline = capture(viewer, canvas);
      stable();
      viewer.set_visibility([]); stable();
      for (const frame of [[0, 0, 1, 1], [0.2, 0.1, 0.4, 0.8], [0.85, 0.1, 0.001, 0.8], [0.1, 0.45, 0.8, 0.25]]) {
        viewer.reframe(...frame); viewer.align_viewport(true); stable(); focused([0.5, 0.5]);
      }
      viewer.apply_scene(ids); viewer.align_viewport(true); focused();
      const authored = viewer.capture_view();
      viewer.apply_scene([], authored); focused([0.5, 0.5]);
      viewer.apply_scene(ids, { ...authored, camera: { ...authored.camera, yaw: Math.PI / 2, pitch: 0.2 } }, 10);
      viewer.align_viewport(false);
      for (const time of [20, 60, 120, 300, 700]) moving(() => viewer.advance_camera(time));
      viewer.finish_camera_transition();
      moving(() => viewer.rotate(0.4, -0.1));
      moving(() => viewer.pan(0.1, -0.1));
      moving(() => viewer.zoom(0.6));
      moving(() => viewer.zoom_at(0.7, 0.3, 1.1));
      focused();
      for (const frame of [[0, 0, 1, 1], [0.2, 0.1, 0.4, 0.8], [0.1, 0.45, 0.8, 0.25]]) {
        viewer.reframe(...frame); viewer.align_viewport(false); focused();
        viewer.inspect('reset', 800); viewer.finish_camera_transition();
        focused([frame[0] + frame[2] / 2, frame[1] + frame[3] / 2]);
      }
      viewer.configure_explosion([ids]); viewer.set_explode_mode(true); viewer.set_explode(0.4, 800, false, true);
      focused();
      viewer.inspect('reset', 850); viewer.finish_camera_transition(); focused();
      viewer.apply_scene(ids, authored); viewer.align_viewport(false); focused();
      moving(() => viewer.set_camera_pose({ ...authored.camera, yaw: 0.5 }));
      viewer.orient('Z', 1, 900);
      for (const time of [920, 960, 1020]) moving(() => viewer.advance_camera(time));
      viewer.finish_camera_transition(); baseline = capture(viewer, canvas);
      for (const [width, height] of [[128, 192], [256, 128], [192, 128]]) {
        viewer.resize(width, height);
        assert(capture(viewer, canvas).some((value, index) => index % 4 === 3 && value > 0), 'The background must survive a real canvas resize');
      }
      stable();
      viewer.set_graphics(0, 1, false, 192, 128);
      assert(capture(viewer, canvas) === undefined, 'The grid setting must still hide the backdrop');
      viewer.set_graphics(0, 1, true, 192, 128); stable();
      const anatomyCanvas = create();
      anatomy = wasm.AnatomyViewer.fromPrepared(anatomyCanvas, prepared);
      const before = capture(anatomy, anatomyCanvas);
      anatomy.rotate(0.4, 0.2);
      assert(!equal(capture(anatomy, anatomyCanvas), before), 'Anatomy must retain its camera-linked environment');
      return { stablePixelComparisons: checks, focusChecks, cameraMovements: movements, loading: true, scenes: true, layout: true, reset: true, camera: true, explosion: true, resize: true, anatomy: true };
    } finally { anatomy?.free(); viewer.free(); catalog.free(); }
  });
  if (result.stablePixelComparisons < 8 || result.focusChecks < 15 || result.cameraMovements < 10) throw Error('Missing lesson background checks');
  return result;
}
