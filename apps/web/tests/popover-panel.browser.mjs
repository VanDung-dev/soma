import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { SourceDocument } from '../src/source-document.tsx';

export async function checkPopoverPanels() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let sourceClosed = 0;
  try {
    flushSync(() => root.render(createElement(SourceDocument, {
      path: '/models/z-anatomy/ATTRIBUTION.md', onClose: () => sourceClosed++,
    })));
    const panels = [...document.querySelectorAll('.settings-popover, .controls-guide'), host.querySelector('.source-document')];
    assert(panels.length === 3 && panels.every(Boolean), 'Check Settings, Guide and Source together');
    let geometry;
    for (const panel of panels) {
      panel.showPopover(); await frames();
      assert(panel.classList.contains('app-popover') && panel.popover === 'auto', 'Use the shared dismissible popover');
      assert(document.querySelectorAll('.app-popover:popover-open').length === 1, 'Keep only one shared panel open');
      const bounds = panel.getBoundingClientRect(), content = panel.querySelector('.popover-content');
      const inner = content.getBoundingClientRect(), style = getComputedStyle(panel);
      const current = [bounds.width, bounds.height, style.borderRadius, getComputedStyle(content).borderRadius];
      geometry ??= current;
      assert(JSON.stringify(current) === JSON.stringify(geometry), 'Use matching dimensions and corner radii');
      for (const inset of [inner.left - bounds.left, bounds.right - inner.right, bounds.bottom - inner.bottom]) {
        assert(Math.abs(inset - 10) < 1, 'Use matching content insets');
      }
      const close = panel.querySelector('.controls-info');
      assert(close.getBoundingClientRect().width === 28 && close.querySelector('svg'), 'Use the shared icon close button');
      close.click(); await frames();
      assert(!panel.matches(':popover-open'), 'Close every panel with its button');
      panel.showPopover(); await frames();
      const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      close.dispatchEvent(key); await frames();
      assert(key.defaultPrevented && !panel.matches(':popover-open'), 'Close with Escape without opening another panel');
    }
    assert(sourceClosed > 0, 'Notify the source owner when the popover closes');
    return { sharedGeometry: true, nativeAutoPopover: true, exclusive: true, closeButton: true, escape: true, sourceCloseNotification: true };
  } finally {
    document.querySelectorAll('.app-popover:popover-open').forEach(panel => panel.hidePopover());
    root.unmount(); host.remove();
  }
}
