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
  for (const method of ['pan', 'rotate', 'zoom', 'inspect']) {
    originals[method] = proto[method];
    proto[method] = function(...args) { calls.push({ method, args }); return originals[method].apply(this, args); };
  }
  const input = document.createElement('input');
  document.body.append(input);
  try {
    const expected = [
      ['w', 'pan', [0, 0.04]], ['a', 'pan', [-0.04, 0]], ['s', 'pan', [0, -0.04]], ['d', 'pan', [0.04, 0]],
      ['ArrowUp', 'rotate', [0, Math.PI / 8]], ['ArrowLeft', 'rotate', [Math.PI / 8, 0]],
      ['ArrowDown', 'rotate', [0, -Math.PI / 8]], ['ArrowRight', 'rotate', [-Math.PI / 8, 0]],
      ['e', 'zoom', [1 / 1.2]], ['q', 'zoom', [1.2]], ['r', 'inspect', ['reset']],
    ];
    const guide = document.querySelector('.controls-guide');
    assert(!guide.matches(':popover-open'), 'Guide must start closed');
    assert(!document.querySelector('[data-control]'), 'Remove the full control buttons');
    document.querySelector('.controls-info').click(); await frames(1);
    assert(guide.matches(':popover-open'), 'Info button must open the guide');
    const keyboard = guide.querySelector('[aria-label="Bàn phím"]').getBoundingClientRect();
    const mouse = guide.querySelector('[aria-label="Chuột"]').getBoundingClientRect();
    assert(keyboard.right < mouse.left, 'Keyboard instructions must be left of mouse instructions');
    assert(guide.querySelectorAll('kbd').length === expected.length, 'Document all keyboard controls');
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
      assert(!document.querySelector('.model-controls .is-active'), 'Remove key interaction feedback');
      send('keyup', key); await frames(1);
      const stopped = calls.length; await frames(2);
      assert(calls.length === stopped, `${key}: must stop on keyup`);
    }
    calls.length = 0;
    send('keydown', 'w'); send('keydown', 'd'); send('keydown', 'r');
    await frames(5); send('keydown', 'r', canvas, { repeat: true });
    assert(calls.filter(c => c.method === 'pan').length >= 4, 'Hold multiple keys continuously');
    assert(calls.filter(c => c.method === 'inspect').length === 1, 'Reset must not repeat while another key is held');
    window.dispatchEvent(new Event('blur')); await frames(1);
    const stopped = calls.length; await frames(3);
    assert(calls.length === stopped && !document.querySelector('.model-controls .is-active'), 'Blur must release controls');
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
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    assert(calls.some(c => c.method === 'zoom' && c.args[0] < 1), 'Preserve mouse wheel zoom');
    assert(canvas.getContext('webgl2').getError() === 0, 'No WebGL errors after keyboard and wheel interactions');
    return { mappings: expected.length, guide: true, twoColumns: true, noKeyFeedback: true, hold: true, simultaneous: true, resetOnce: true, blur: true, typing: true, shortcuts: true, mouseWheel: true };
  } finally {
    window.dispatchEvent(new Event('blur'));
    for (const [method, original] of Object.entries(originals)) proto[method] = original;
    input.remove(); send('keydown', 'r'); send('keyup', 'r');
  }
}
