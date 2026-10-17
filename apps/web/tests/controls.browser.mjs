import { getWasm } from '../src/core.ts';

// Run in Vite: (await import('/tests/controls.browser.mjs')).checkControls()
export async function checkControls() {
  const { AnatomyViewer } = await getWasm(), proto = AnatomyViewer.prototype;
  const canvas = document.querySelector('.model-canvas canvas');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  assert(canvas && document.querySelector('.model-canvas').getAttribute('aria-busy') === 'false' && !document.querySelector('.model-error'), 'Wait for model loading to finish');
  const frames = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame); };
  const send = (type, key, target = canvas, extra = {}) => {
    const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(event); return event.defaultPrevented;
  };
  const calls = [], originals = {};
  let viewer, matrix, inverse;
  const gl = canvas.getContext('webgl2'), originalMatrix = gl.uniformMatrix4fv;
  gl.uniformMatrix4fv = function(...args) {
    originalMatrix.apply(this, args);
    const program = this.getParameter(this.CURRENT_PROGRAM);
    for (const name of ['view_projection', 'inverse_projection']) {
      const location = program && this.getUniformLocation(program, name);
      if (location) {
        const value = this.getUniform(program, location);
        if (name === 'view_projection') matrix = [...value]; else inverse = [...value];
      }
    }
  };
  for (const method of ['pan', 'rotate', 'zoom', 'zoom_at', 'inspect']) {
    originals[method] = proto[method];
    proto[method] = function(...args) { viewer = this; calls.push({ method, args }); return originals[method].apply(this, args); };
  }
  const input = document.createElement('input');
  document.body.append(input);
  try {
    const expected = [
      ['w', 'pan', [0, 0.06]], ['a', 'pan', [-0.06, 0]],
      ['s', 'pan', [0, -0.06]], ['d', 'pan', [0.06, 0]],
      ['ArrowUp', 'rotate', [0, Math.PI / 8]], ['ArrowLeft', 'rotate', [Math.PI / 8, 0]],
      ['ArrowDown', 'rotate', [0, -Math.PI / 8]], ['ArrowRight', 'rotate', [-Math.PI / 8, 0]],
      ['e', 'zoom', [1 / 1.2]], ['q', 'zoom', [1.2]], ['r', 'inspect', ['reset']],
    ];
    const guide = document.querySelector('.controls-guide');
    assert(!guide.matches(':popover-open'), 'Guide must start closed');
    assert(!document.querySelector('[data-control]'), 'Remove the full control buttons');
    document.querySelector('.app-menu-bar [aria-label="Trợ giúp"]').click(); await frames(1);
    assert(guide.matches(':popover-open'), 'Info button must open the guide');
    const keyboard = guide.querySelector('[aria-label="Bàn phím"]').getBoundingClientRect();
    const mouse = guide.querySelector('[aria-label="Chuột"]').getBoundingClientRect();
    assert(keyboard.right < mouse.left, 'Keyboard instructions must be left of mouse instructions');
    assert(guide.querySelectorAll('kbd').length === expected.length, 'Document all keyboard controls');
    assert(guide.innerText.includes('Di chuyển camera') && guide.innerText.includes('Xoay mô hình'), 'Distinguish camera movement from model rotation');
    assert(guide.innerText.includes('Shift + kéo') && guide.innerText.includes('Cuộn chuột'), 'Document mouse gestures');
    guide.querySelector('button').click(); await frames(1);
    assert(!guide.matches(':popover-open'), 'Close button must hide the guide');
    for (const [key, method, args] of expected) {
      canvas.focus(); calls.length = 0;
      assert(send('keydown', key), `${key}: prevent page scrolling`);
      await frames();
      assert(calls.length > 0 && calls.every(c => c.method === method), `${key}: keyboard mapping`);
      for (const call of calls) for (let i = 0; i < args.length; i++) {
        const reference = args[i], actual = call.args[i];
        if (method === 'zoom') assert((actual < 1) === (reference < 1), `${key}: zoom direction`);
        else if (typeof reference === 'number') assert(Math.sign(actual) === Math.sign(reference), `${key}: movement direction`);
        else assert(actual === reference, `${key}: reset`);
      }
      assert(!document.querySelector('.controls-info.is-active'), 'Remove key interaction feedback');
      send('keyup', key); await frames(1);
      const stopped = calls.length; await frames(2);
      assert(calls.length === stopped, `${key}: must stop on keyup`);
    }
    calls.length = 0;
    send('keydown', 'w'); send('keydown', 'd'); send('keydown', 'ArrowLeft'); send('keydown', 'r');
    await frames(5); send('keydown', 'r', canvas, { repeat: true });
    assert(calls.filter(c => c.method === 'pan').length >= 4 && calls.filter(c => c.method === 'rotate').length >= 2,
      'Hold camera movement and model rotation together');
    assert(calls.filter(c => c.method === 'inspect').length === 1, 'Reset must not repeat while another key is held');
    window.dispatchEvent(new Event('blur')); await frames(1);
    const stopped = calls.length; await frames(3);
    assert(calls.length === stopped && !document.querySelector('.controls-info.is-active'), 'Blur must release controls');
    input.focus(); calls.length = 0;
    assert(!send('keydown', 'w', input), 'Text input must retain its keys');
    await frames(2); assert(!calls.length, 'Do not move while typing');
    canvas.focus();
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'isComposing']) {
      assert(!send('keydown', 'q', canvas, { [modifier]: true }), 'Preserve shortcuts and IME');
    }
    const treeInput = document.querySelector('.catalog-panel input');
    treeInput.focus(); assert(!send('keydown', 'ArrowDown', treeInput), 'Preserve catalog keyboard navigation');
    canvas.focus(); calls.length = 0;
    const transform = (matrix, point) => {
      const clip = [0, 1, 2, 3].map(row => [...point, 1].reduce((sum, value, col) => sum + matrix[col * 4 + row] * value, 0));
      return clip.slice(0, 3).map(value => value / clip[3]);
    };
    const anchorStays = async (x, y, action) => {
      viewer.render();
      const expected = [2 * x - 1, 1 - 2 * y];
      const point = transform(inverse, [...expected, 0.99]);
      const before = [...matrix];
      await action(); await frames(); viewer.render();
      const actual = transform(matrix, point);
      assert(Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) < 2e-4,
        `Zoom must keep its screen anchor fixed: ${JSON.stringify({ expected, actual, point, call: calls.at(-1) })}`);
      assert(matrix.some((value, i) => Math.abs(value - before[i]) > 1e-5), 'Zoom must change the camera');
    };
    viewer.inspect('reset'); viewer.pan(0.12, -0.08); viewer.rotate(0.2, -0.1);
    const area = canvas.getBoundingClientRect();
    for (const [x, y, deltaY, deltaMode] of [[0.3, 0.35, -100, 0], [0.7, 0.65, 6, 1], [0.5, 0.4, -0.1, 2]]) {
      const event = new WheelEvent('wheel', {
        clientX: area.left + x * area.width, clientY: area.top + y * area.height,
        deltaY, deltaMode, bubbles: true, cancelable: true,
      });
      const cursorX = (event.clientX - area.left) / area.width, cursorY = (event.clientY - area.top) / area.height;
      await anchorStays(cursorX, cursorY, () => canvas.dispatchEvent(event));
      const call = calls.findLast(c => c.method === 'zoom_at');
      assert(call && Math.abs(call.args[0] - cursorX) < 1e-6 && Math.abs(call.args[1] - cursorY) < 1e-6,
        'Wheel must pass canvas-relative cursor coordinates');
      assert((call.args[2] < 1) === (deltaY < 0), 'Preserve wheel zoom direction');
    }
    for (const key of ['e', 'q']) await anchorStays(0.5, 0.5, async () => {
      send('keydown', key); await frames(4); send('keyup', key);
    });
    assert(canvas.getContext('webgl2').getError() === 0, 'No WebGL errors after keyboard and wheel interactions');
    return { mappings: expected.length, guide: true, twoColumns: true, noKeyFeedback: true, hold: true, simultaneous: true, resetOnce: true, blur: true, typing: true, shortcuts: true, mouseWheel: true, pointerAnchor: true, keyboardCenter: true };
  } finally {
    window.dispatchEvent(new Event('blur'));
    for (const [method, original] of Object.entries(originals)) proto[method] = original;
    gl.uniformMatrix4fv = originalMatrix;
    input.remove(); send('keydown', 'r'); send('keyup', 'r');
  }
}

export async function checkHudCentering() {
  const { AnatomyViewer } = await getWasm(), proto = AnatomyViewer.prototype;
  const originalCenter = proto.center;
  const originalAdvance = proto.advance_camera;
  let cameraMoving = false, cameraDone;
  proto.advance_camera = function(...args) {
    cameraMoving = originalAdvance.apply(this,args);
    if (!cameraMoving) { cameraDone?.(); cameraDone = undefined; }
    return cameraMoving;
  };
  const gl = document.querySelector('.model-canvas canvas').getContext('webgl2');
  const originalMatrix = gl.uniformMatrix4fv;
  let viewMatrix, beforeExpand;
  gl.uniformMatrix4fv = function(...args) {
    const result = originalMatrix.apply(this,args);
    const program = this.getParameter(this.CURRENT_PROGRAM);
    const location = program && this.getUniformLocation(program,'view_projection');
    if (location) viewMatrix = JSON.stringify([...this.getUniform(program,location)]);
    return result;
  };
  let center, calls = 0;
  proto.center = function(...args) { center = args; calls++; return originalCenter.apply(this,args); };
  const panel = document.querySelector('.information-panel');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const settleCamera = async () => {
    if (cameraMoving) await new Promise((resolve,reject) => {
      const timeout = setTimeout(() => { cameraDone = undefined; reject(Error('Camera transition did not finish')); },3000);
      cameraDone = () => { clearTimeout(timeout); resolve(); };
    });
    await frames();
  };
  const states = [];
  try {
    if (panel.classList.contains('reader-expanded')) {
      document.querySelector('.reader-expand').click(); await frames();
      await settleCamera();
    }
    document.querySelector('.folder-row .tree-name').click(); await frames();
    for (let i = 0; i < 12 && document.querySelectorAll('.part-row .tree-name').length < 2; i++) {
      document.querySelector('.folder-toggle[aria-expanded="false"]').click(); await frames();
    }
    const parts = [...document.querySelectorAll('.part-row .tree-name')].slice(0,2);
    assert(parts.length === 2, 'Find two anatomical structures to check selection changes');
    let before = calls;
    for (const part of parts) { part.click(); await frames(); }
    assert(calls === before, 'Normal information view must not recenter when the selection changes');
    let index = 0;
    for (const expanded of [true, false, true, false]) {
      before = calls;
      if (expanded) beforeExpand = viewMatrix;
      if (index === 3) document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      else document.querySelector('.reader-expand').click();
      await frames();
      await Promise.all(panel.getAnimations().map(animation => animation.finished.catch(() => {})));
      await frames();
      await settleCamera();
      assert(panel.classList.contains('reader-expanded') === expanded, 'Toggle the real information panel state');
      assert(expanded ? calls > before : calls === before,
        'Automatic centering must run only while the information panel is expanded');
      if (!expanded) assert(beforeExpand && viewMatrix === beforeExpand,
        'Closing the expanded information panel must redraw the exact camera from before opening');
      before = calls;
      parts[index++ % 2].click(); await frames();
      await settleCamera();
      assert(expanded ? calls > before : calls === before,
        'Selection changes must recenter only in the expanded information view');
      const desktop = matchMedia('(min-width: 901px)').matches;
      const area = document.querySelector('.model-canvas').getBoundingClientRect();
      const left = desktop ? document.querySelector('.catalog-panel').getBoundingClientRect().right : area.left;
      const right = desktop ? panel.getBoundingClientRect().left : area.right;
      const expected = (left + right) / 2;
      const hud = document.querySelector('.model-hud').getBoundingClientRect();
      if (expanded) {
        assert(center && Math.abs(area.left + center[0] * area.width - expected) < 1,
        `Center the anatomy in the same remaining 3D area as the controls: ${JSON.stringify({center,expected,area:area.toJSON()})}`);
        assert(Math.abs(area.top + center[1] * area.height - (area.top + 110 + hud.top - 12) / 2) < 1,
        'Center the anatomy above the HUD and below the page heading');
      }
      for (const selector of ['.explode-control']) {
        const control = document.querySelector(selector), bounds = control.getBoundingClientRect();
        assert(Math.abs(bounds.x + bounds.width / 2 - expected) < 1, 'Center controls in the remaining 3D area');
        assert(bounds.left >= left && bounds.right <= right, 'Keep controls outside both panels');
        assert(control.contains(document.elementFromPoint(expected, bounds.y + bounds.height / 2)),
          'Expanded information must not cover the controls');
      }
      assert(document.querySelector('.explode-control').getBoundingClientRect().width >= 179,
        'Keep the slider usable on narrow desktop layouts');
      if (desktop && expanded) assert(panel.getBoundingClientRect().width >= parseFloat(getComputedStyle(panel).getPropertyValue('--panel-width')),
        'Expanding the reader must not shrink it');
      states.push({ expanded, center: expected });
    }
    return { viewport: innerWidth, centeredAndClickable: true, expandedOnlyFocus: true,
      normalSelectionKeepsView: true, closeRestoresCamera: true, escapeRestoresCamera: true, states };
  } finally {
    if (panel.classList.contains('reader-expanded')) {
      document.querySelector('.reader-expand').click(); await frames();
      await settleCamera();
    }
    proto.center = originalCenter;
    proto.advance_camera = originalAdvance;
    gl.uniformMatrix4fv = originalMatrix;
  }
}
