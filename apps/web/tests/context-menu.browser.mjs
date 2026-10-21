export async function checkNativeContextMenu() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const heading = document.querySelector('.app-menu-bar h1');
  const canvas = document.querySelector('.model-canvas canvas');
  const trigger = document.querySelector('.structure-search-field');
  const field = document.querySelector('input[type="search"]');
  const selection = getSelection();
  const ranges = Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange());
  const source = document.activeElement;
  const value = field.value;
  const search = field.closest('[popover]');
  const open = target => {
    for (const options of [{ button: 2 }, { button: 2, shiftKey: true }, { button: -1 }]) {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...options });
      target.dispatchEvent(event);
      assert(!event.defaultPrevented, 'Leave mouse and keyboard context menus to the host');
      assert(!document.querySelector('.context-menu, .context-notice'), 'Do not mount a custom menu or clipboard notice');
    }
  };
  try {
    selection.removeAllRanges();
    const range = document.createRange(); range.selectNodeContents(heading); selection.addRange(range);
    open(heading); await frames();
    assert(selection.toString() === heading.textContent, 'Right-click preserves selected page text');
    open(canvas); await frames();
    if (!search.matches(':popover-open')) { trigger.click(); await frames(); }
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'Atlas 123');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus(); field.setSelectionRange(6, 9);
    open(field); await frames();
    assert(field.value === 'Atlas 123' && field.selectionStart === 6 && field.selectionEnd === 9,
      'Native clipboard controls retain the editable text and selection');
    assert(document.activeElement === field && search.matches(':popover-open'), 'Right-click preserves input focus and the search popover');
    return { nativeMouseMenu: true, nativeKeyboardMenu: true, textSelectionPreserved: true, inputSelectionPreserved: true };
  } finally {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    search.hidePopover();
    selection.removeAllRanges(); for (const range of ranges) selection.addRange(range);
    source?.focus({ preventScroll: true });
  }
}
