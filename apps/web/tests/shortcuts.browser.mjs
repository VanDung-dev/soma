import { wikipediaPage } from '../scripts/wikipedia-proxy.mjs';

export async function checkAppShortcuts() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const canvas = document.querySelector('canvas');
  const guide = document.querySelector('.controls-guide');
  const settings = document.querySelector('.settings-popover');
  const key = async (value, target = canvas, extra = {}) => {
    target.focus();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra }));
    await frames();
  };
  const close = async () => {
    document.querySelectorAll(':popover-open').forEach(panel => panel.hidePopover());
    await frames();
  };
  const frame = document.createElement('iframe');
  try {
    await close();
    await key('Escape'); assert(settings.matches(':popover-open'), 'Esc opens Settings');
    await key('Escape', settings.querySelector('button')); assert(!settings.matches(':popover-open'), 'Esc closes Settings');
    await key('g'); assert(guide.matches(':popover-open'), 'G opens the controls guide');
    assert(guide.textContent.includes('T') && guide.textContent.includes('Esc'), 'Guide documents new app shortcuts');
    for (const row of guide.querySelectorAll('.guide-app-shortcuts dl > div')) {
      assert(row.scrollWidth <= row.clientWidth, 'App shortcut labels must fit narrow screens');
    }
    await key('g', guide.querySelector('button')); assert(!guide.matches(':popover-open'), 'G toggles the guide');
    await key('f');
    const input = document.querySelector('input[type="search"]');
    assert(document.activeElement === input && input.closest('[popover]').matches(':popover-open'), 'F opens and focuses structure search');
    for (const value of ['g', 't', 'f']) await key(value, input);
    assert(!guide.matches(':popover-open') && document.activeElement === input, 'Typing does not activate app shortcuts');
    await close();
    const roots = [...document.querySelectorAll('.structure-tree > li > .folder-row .tree-name')];
    roots[0].click(); await frames(); const first = document.querySelector('.information-heading h2').textContent;
    roots[1].click(); await frames(); const second = document.querySelector('.information-heading h2').textContent;
    const command = /Mac|iPhone|iPad/i.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
    await key('[', canvas, command); assert(document.querySelector('.information-heading h2').textContent === first, 'Platform modifier + [ goes Back');
    await key(']', canvas, command); assert(document.querySelector('.information-heading h2').textContent === second, 'Platform modifier + ] goes Forward');
    window.postMessage({ type: 'wikipedia:shortcut', key: 'g', code: 'KeyG', ctrlKey: false, metaKey: false }, '*');
    await frames(); assert(!guide.matches(':popover-open'), 'Ignore shortcut messages from unknown windows');
    frame.className = 'wikipedia-article'; frame.sandbox = 'allow-scripts';
    frame.srcdoc = wikipediaPage('<html><head></head><body><script>addEventListener("message", e => { if(e.data?.type === "test:key") dispatchEvent(new KeyboardEvent("keydown", {key:e.data.key, code:"KeyG", bubbles:true, cancelable:true})); });</script></body></html>', new URL('https://en.wikipedia.org/wiki/Skeleton'));
    const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
    document.body.append(frame); await loaded;
    frame.contentWindow.postMessage({ type: 'test:key', key: 'g' }, '*');
    await new Promise((resolve, reject) => {
      const toggled = () => {
        if (!guide.matches(':popover-open')) return;
        clearTimeout(timeout); guide.removeEventListener('toggle', toggled); resolve();
      };
      const timeout = setTimeout(() => { guide.removeEventListener('toggle', toggled); reject(Error('Article shortcut did not open guide')); }, 3000);
      guide.addEventListener('toggle', toggled);
    });
    assert(guide.matches(':popover-open'), 'App shortcuts also work from the isolated article');
    return { settings: true, guide: true, find: true, history: true, typingPreserved: true, article: true, sourceValidated: true };
  } finally { frame.remove(); await close(); }
}
