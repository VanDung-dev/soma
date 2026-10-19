export async function checkContextMenu() {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const field = document.querySelector('input[type="search"]');
  const trigger = document.querySelector('.structure-search-field');
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  let text = 'XYZ', denied = false, writes = [];
  let stage = 'copy';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async value => { writes.push(value); },
    readText: async () => { if (denied) throw Error('Permission denied'); return text; },
  } });
  const open = (target, options = {}) => {
    const bounds = target.getBoundingClientRect();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2,
      clientX: bounds.x + 8, clientY: bounds.y + 8, ...options });
    target.dispatchEvent(event);
    return event;
  };
  const menu = () => document.querySelector('.context-menu');
  const action = label => { assert(menu(), `Menu missing during ${stage}`); return [...menu().querySelectorAll('button')].find(button => button.querySelector('span')?.textContent === label); };
  const close = () => menu()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const pasteText = value => {
    field.focus(); field.select(); document.execCommand('insertText', false, value);
  };
  const fake = document.createElement('input');
  try {
    trigger.click(); await frames();
    pasteText('Atlas 123'); field.setSelectionRange(6, 9);
    assert(open(field).defaultPrevented, 'App must replace the native context menu');
    await frames();
    const mac = /Mac|iPhone|iPad/i.test(navigator.platform);
    assert(action('Sao chép').querySelector('kbd').textContent === (mac ? '⌘C' : 'Ctrl+C'), 'Copy shows the platform shortcut');
    assert(action('Dán').querySelector('kbd').textContent === (mac ? '⌘V' : 'Ctrl+V'), 'Paste shows the platform shortcut');
    menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac })); await frames();
    assert(writes.at(-1) === '123', 'Copy must preserve the original field selection');
    assert(field.value === 'Atlas 123' && field.closest('[popover]').matches(':popover-open'), 'Copy must retain the search popup and query');
    stage = 'paste'; open(field); await frames(); action('Dán').click(); await frames();
    assert(field.value === 'Atlas XYZ', 'Paste must replace only the selected text');
    assert(document.querySelector('.search-status').textContent.includes('Không tìm thấy'), 'Paste must update React search state');
    denied = true;
    stage = 'denied';
    open(field); await frames(); action('Dán').click(); await frames();
    assert(field.value === 'Atlas XYZ' && document.activeElement === field, 'Rejected clipboard permission must preserve text and focus');
    assert(document.querySelector('.context-notice').textContent.includes('Ctrl+V'), 'Clipboard rejection must explain the fallback');
    assert(!open(field, { shiftKey: true }).defaultPrevented, 'Shift plus right-click must retain the native menu');
    await frames(); assert(!menu(), 'Native bypass must close the custom menu');
    open(field, { button: -1, shiftKey: true }); await frames();
    assert(menu(), 'Keyboard context menu must still work with Shift+F10');
    menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    assert(document.activeElement === action('Dán'), 'Arrow keys must navigate the menu');
    close(); await frames(); assert(document.activeElement === field, 'Escape must restore field focus');
    field.readOnly = true; open(field); await frames();
    assert(action('Dán').disabled, 'Read-only fields cannot accept paste'); close(); field.readOnly = false;
    pasteText(''); field.closest('[popover]').hidePopover(); await frames();
    fake.type = 'password'; fake.value = 'never-copy-password'; fake.style.cssText = 'position:fixed;top:100px;left:20px'; document.body.appendChild(fake);
    stage = 'password';
    fake.focus({ preventScroll: true }); fake.select(); open(fake); await frames();
    assert(action('Sao chép').disabled, 'Password selections must not be copied'); close();
    fake.remove();
    const heading = document.querySelector('.app-menu-bar h1');
    stage = 'page text';
    const selection = getSelection(); selection.removeAllRanges();
    const range = document.createRange(); range.selectNodeContents(heading); selection.addRange(range);
    open(heading); await frames(); action('Sao chép').click(); await frames();
    assert(writes.at(-1) === heading.textContent, 'Copy must also work for selected page text');
    selection.removeAllRanges();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2,
      clientX: innerWidth - 1, clientY: innerHeight - 1 });
    document.querySelector('.study-shell').dispatchEvent(event); await frames();
    const box = menu().getBoundingClientRect();
    assert(box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, 'Menu must stay inside the viewport');
    close();
    return { copy: true, paste: true, permissionDenied: true, nativeBypass: true, keyboard: true, textSelection: true, bounds: true };
  } finally {
    close(); fake.remove(); field.readOnly = false;
    if (original) Object.defineProperty(navigator, 'clipboard', original); else delete navigator.clipboard;
  }
}
