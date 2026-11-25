import { getWasm } from '../src/core.ts';
import { closeSettings, openSettings } from './settings.fixture.mjs';

export async function checkDefaultFrontView() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const widget = document.querySelector('.orientation-axes'), canvas = document.querySelector('.model-canvas canvas');
  const frames = async count => { for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame); };
  const front = () => {
    const positive = widget.querySelector('[data-axis="X"][data-direction="1"]');
    const negative = widget.querySelector('[data-axis="X"][data-direction="-1"]');
    const point = positive.querySelector('circle');
    return Number(point.getAttribute('cx')) === 56 && Number(point.getAttribute('cy')) === 56
      && Number(positive.getAttribute('opacity')) === 1 && Math.abs(Number(negative.getAttribute('opacity')) - 0.45) < 1e-6;
  };
  const key = async (name, count) => {
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    await frames(count);
    canvas.dispatchEvent(new KeyboardEvent('keyup', { key: name, bubbles: true, cancelable: true }));
  };
  assert(front(), 'Startup must face +X with -X behind');
  await key('ArrowLeft', 10); await key('ArrowUp', 10);
  assert(!front(), 'Manual rotation must still change the view');
  await key('r', 1); await frames(70);
  assert(front(), 'R must restore the same frontal orientation as startup');
  return { startupFront: true, resetFront: true, positiveXInFront: true, negativeXBehind: true, manualRotation: true };
}

export async function checkAxesVisibility() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const settings = await openSettings('graphics');
  const axes = 'input[id$="-show-axes"]', fps = 'input[id$="-show-fps"]';
  const widget = document.querySelector('.orientation-axes');
  const canvas = document.querySelector('.model-canvas canvas');
  const initial = { axes: settings.querySelector(axes).checked, fps: settings.querySelector(fps).checked };
  const frames = async (count = 6) => { for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame); };
  const toggle = async (selector, value) => {
    const control = (await openSettings('graphics')).querySelector(selector);
    if (control.checked !== value) { control.click(); await frames(); }
  };
  const position = () => widget.querySelector('[data-axis="X"][data-direction="1"] circle').getAttribute('cx');
  try {
    await toggle(axes, true); await toggle(fps, true);
    const before = position();
    await toggle(axes, false);
    assert(widget.getBoundingClientRect().width === 0 && widget.getAttribute('aria-disabled') === 'true',
      'Hide and disable the axes when the preference is off');
    assert(document.querySelector('.model-fps')?.getBoundingClientRect().width > 0,
      'Keep FPS visible when the axes are hidden');
    assert(JSON.parse(localStorage.getItem('human-atlas-graphics')).showAxes === false, 'Persist the hidden preference');
    await closeSettings(); canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    await frames(10);
    canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    await frames();
    const rotated = position();
    assert(rotated !== before, 'Keep the hidden axes synchronized with camera movement');
    await toggle(axes, true);
    assert(widget.getBoundingClientRect().width === 80 && widget.getAttribute('aria-disabled') === 'false' && position() === rotated,
      'Restore the axes at the current camera orientation');
    assert(JSON.parse(localStorage.getItem('human-atlas-graphics')).showAxes === true, 'Persist the visible preference');
    await toggle(fps, false);
    assert(widget.getBoundingClientRect().width === 80 && !document.querySelector('.model-fps'), 'Axes and FPS visibility must be independent');
    return { hidden: true, persisted: true, cameraSynced: true, fpsIndependent: true };
  } finally {
    await toggle(axes, initial.axes); await toggle(fps, initial.fps);
    await closeSettings();
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'r', bubbles: true, cancelable: true }));
    await frames(70);
  }
}

export async function checkOrientationAxes() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const { AnatomyViewer } = await getWasm();
  const original = AnatomyViewer.prototype.camera_axes;
  const canvas = document.querySelector('.model-canvas canvas');
  const widget = document.querySelector('.orientation-axes');
  const fps = 'input[id$="-show-fps"]';
  const showFps = (await openSettings('graphics')).querySelector(fps).checked;
  await closeSettings();
  let viewer, samples = 0;
  AnatomyViewer.prototype.camera_axes = function() { viewer = this; samples++; return original.call(this); };
  const frames = async (count = 5) => { for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame); };
  const setFps = async value => {
    const control = (await openSettings('graphics')).querySelector(fps);
    if (control.checked !== value) { control.click(); await frames(); }
    await closeSettings();
  };
  const key = async name => {
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    await frames();
    canvas.dispatchEvent(new KeyboardEvent('keyup', { key: name, bubbles: true, cancelable: true }));
    await frames();
  };
  const positions = () => [...widget.querySelectorAll('g')].map(group => [group.dataset.axis, group.dataset.direction,
    Number(group.querySelector('circle').getAttribute('cx')), Number(group.querySelector('circle').getAttribute('cy'))]);
  const matchesCamera = () => {
    const axes = viewer.camera_axes();
    let previousDepth = -Infinity;
    for (const [axis, direction, x, y] of positions()) {
      const index = 'XYZ'.indexOf(axis) * 3, sign = Number(direction), depth = axes[index + 2] * sign;
      assert(Math.abs(x - 56 - axes[index] * sign * 38) < 1e-4
        && Math.abs(y - 56 + axes[index + 1] * sign * 38) < 1e-4, 'Project world axes using the current WASM camera');
      assert(depth >= previousDepth, 'Draw the nearer endpoints above farther endpoints');
      const endpoint = widget.querySelector(`[data-axis="${axis}"][data-direction="${direction}"]`);
      const expectedOpacity = endpoint.matches(':hover, :focus-visible') ? 1 : 1 - Math.max(0, -depth) * 0.55;
      assert(Math.abs(Number(getComputedStyle(endpoint).opacity) - expectedOpacity) < 1e-5,
        'Fade either direction gradually only when it moves behind the other');
      previousDepth = depth;
    }
    const gl = canvas.getContext('webgl2');
    const useProgram = gl.useProgram;
    const programs = new Set();
    gl.useProgram = function(program) {
      if (program) programs.add(program);
      return useProgram.call(this, program);
    };
    try { viewer.render(); } finally { gl.useProgram = useProgram; }
    const uniforms = [...programs].map(program => [program, gl.getUniformLocation(program, 'light_basis')]);
    const modelUniform = uniforms.find(([, location]) => location);
    assert(modelUniform, 'The model shader must expose its light basis');
    const basis = gl.getUniform(...modelUniform);
    const worldAxes = [2, 0, 1];
    assert(axes.every((value, i) => Math.abs(value - basis[(i % 3) * 3 + worldAxes[Math.floor(i / 3)]]) < 1e-6),
      'Show X facing the model front, Y sideways, and Z upright');
  };
  try {
    assert(widget.getAttribute('role') === 'group' && widget.getAttribute('aria-label'), 'Give the view controls an accessible name');
    assert(widget.querySelectorAll('g').length === 6
      && JSON.stringify([...widget.querySelectorAll('text')].map(label => label.textContent).sort()) === JSON.stringify(['X', '−X', 'Y', '−Y', 'Z', '−Z'].sort()),
      'Label all six positive and negative axis endpoints');
    const size = widget.getBoundingClientRect();
    assert(size.width === 80 && size.height === 80, 'Keep the axes compact like the Blender orientation widget');
    assert(getComputedStyle(widget).pointerEvents === 'auto', 'Allow the axes to respond to pointer hover');
    for (const endpoint of widget.querySelectorAll('g')) {
      assert(getComputedStyle(endpoint.querySelector('circle:not(.orientation-hit-target)')).fill
        === (endpoint.dataset.direction === '-1' ? 'rgba(18, 23, 21, 0.75)' : getComputedStyle(endpoint).color),
        'Keep positive endpoints colored and negative endpoints readable against a neutral background');
    }
    for (const label of widget.querySelectorAll('text')) {
      const style = getComputedStyle(label);
      assert((style.userSelect === 'none' || style.getPropertyValue('-webkit-user-select') === 'none')
        && style.cursor === 'grab', 'Prevent native text selection and text cursors on axis labels, including Safari');
    }
    await key('ArrowLeft');
    assert(viewer, 'Runtime must publish camera orientation');
    matchesCamera();
    const rotated = JSON.stringify(positions());
    await key('ArrowUp'); matchesCamera();
    assert(JSON.stringify(positions()) !== rotated, 'Pitch must update the axes');
    const orientation = JSON.stringify(positions());
    for (const name of ['w', 'e']) { await key(name); matchesCamera(); }
    assert(JSON.stringify(positions()) === orientation, 'Pan and zoom must preserve axis direction');
    await key('r'); await frames(70); matchesCamera();
    assert(JSON.stringify(positions()) !== orientation, 'Camera reset must update the axes throughout its transition');
    const sampled = samples; await frames(10);
    assert(samples === sampled, 'Orientation must not keep rendering while idle');
    const visible = viewer.visible_count(), selected = viewer.selected_id();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'var(--selected-bg)';
    probe.style.color = 'var(--text)';
    document.body.append(probe);
    const { backgroundColor: focusBackground, color: focusText } = getComputedStyle(probe);
    probe.remove();
    for (const [index, axis] of [...'XYZ'].entries()) for (const direction of [-1, 1]) {
      const endpoint = widget.querySelector(`[data-axis="${axis}"][data-direction="${direction}"]`);
      assert(endpoint.getAttribute('role') === 'button' && endpoint.tabIndex === 0 && endpoint.getAttribute('aria-label'),
        'Make all six endpoint controls accessible from the keyboard');
      endpoint.focus();
      endpoint.dispatchEvent(new KeyboardEvent('keydown', { key: direction === 1 ? 'Enter' : ' ', bubbles: true, cancelable: true }));
      await frames(reduced ? 5 : 70);
      const basis = viewer.camera_axes();
      assert(Math.abs(basis[index * 3 + 2] - direction) < 1e-5, 'Axis buttons must align the camera with each signed world axis');
      assert(endpoint.getAttribute('aria-pressed') === 'true', 'Mark the aligned axis selected for keyboard and screen readers');
      const marker = getComputedStyle(endpoint.querySelector('circle:not(.orientation-hit-target)'));
      assert(document.activeElement === endpoint && endpoint.matches(':focus-visible')
        && marker.fill === focusBackground && marker.stroke === focusBackground
        && getComputedStyle(endpoint.querySelector('text')).fill === focusText
        && getComputedStyle(endpoint.querySelector('.orientation-hit-target')).stroke === 'none',
        'Show keyboard focus through the theme background and label colors without a ring');
      matchesCamera();
      assert(viewer.visible_count() === visible && viewer.selected_id() === selected, 'Axis views must preserve selection and visible anatomy');
    }
    const positiveZ = widget.querySelector('[data-axis="Z"][data-direction="1"]');
    positiveZ.focus();
    positiveZ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await frames(reduced ? 5 : 70);
    const negativeZ = widget.querySelector('[data-axis="Z"][data-direction="-1"]');
    assert(negativeZ.getAttribute('aria-pressed') === 'true', 'Repeating a centered keyboard preset must select its opposite');
    negativeZ.focus();
    negativeZ.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    await frames(reduced ? 5 : 70);
    assert(positiveZ.getAttribute('aria-pressed') === 'true', 'Repeat again to return to the original view');
    await key('e');
    assert(widget.querySelector('[data-axis="Z"][data-direction="1"]').getAttribute('aria-pressed') === 'true',
      'Zooming must keep the selected view');
    await key('ArrowRight');
    assert(!widget.querySelector('[aria-pressed="true"]'), 'Rotating away must clear the selected view');
    for (const args of [['bad', 1], ['X', 0], ['Y', 2], ['Z', 1, -1], ['Z', 1, NaN]]) {
      let rejected = false;
      try { viewer.orient(...args); } catch { rejected = true; }
      assert(rejected, 'Reject invalid axis views at the WASM boundary');
    }
    await key('r'); await frames(reduced ? 5 : 70);
    await setFps(true);
    const axesArea = widget.getBoundingClientRect(), fpsArea = document.querySelector('.model-fps').getBoundingClientRect();
    assert(fpsArea.top >= axesArea.bottom && Math.abs((fpsArea.left + fpsArea.right - axesArea.left - axesArea.right) / 2) < 1,
      'Place FPS directly below and centered with the axes');
    assert(axesArea.left >= 0 && axesArea.right <= innerWidth && axesArea.top >= 0 && fpsArea.bottom <= innerHeight,
      'Keep the axes and FPS inside the viewport');
    assert(!document.querySelector('.model-error'), 'Keep the model healthy after camera commands');
    return { sixDirections: true, cameraBasis: true, rotation: true, panZoomStable: true, reset: true, idle: true,
      keyboardPresets: true, selectionPreserved: true, invalidRejected: true, fpsBelow: true, fits: true };
  } finally {
    await setFps(showFps);
    AnatomyViewer.prototype.camera_axes = original;
  }
}
