export async function checkNativeContextMenu() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const heading = document.querySelector('.app-menu-bar h1');
  const canvas = document.querySelector('.model-canvas canvas');
  const field = document.querySelector('.catalog-panel .structure-search input');
  const selection = getSelection();
  const ranges = Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange());
  const source = document.activeElement;
  const value = field.value;
  const open = (target, blocked = false) => {
    for (const options of [{ button: 2 }, { button: 2, shiftKey: true }, { button: -1 }]) {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...options });
      target.dispatchEvent(event);
      assert(event.defaultPrevented === blocked, 'Reserve the canvas for camera controls and keep native menus elsewhere');
      assert(!document.querySelector('.context-menu, .context-notice'), 'Do not mount a custom menu or clipboard notice');
    }
  };
  try {
    selection.removeAllRanges();
    const range = document.createRange(); range.selectNodeContents(heading); selection.addRange(range);
    open(heading); await frames();
    assert(selection.toString() === heading.textContent, 'Right-click preserves selected page text');
    open(canvas, true); await frames();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'Atlas 123');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus(); field.setSelectionRange(6, 9);
    open(field); await frames();
    assert(field.value === 'Atlas 123' && field.selectionStart === 6 && field.selectionEnd === 9,
      'Native clipboard controls retain the editable text and selection');
    assert(document.activeElement === field, 'Right-click preserves input focus');
    return { canvasMenuBlocked: true, nativeMenusOutsideCanvas: true, textSelectionPreserved: true, inputSelectionPreserved: true };
  } finally {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    selection.removeAllRanges(); for (const range of ranges) selection.addRange(range);
    source?.focus({ preventScroll: true });
  }
}
