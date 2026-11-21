import { wikipediaPage } from '../scripts/wikipedia-page.mjs';
import frameTemplate from '../scripts/wikipedia-frame.html?raw';
import { frameShortcuts } from '../src/shortcuts.ts';
import { closeSettings, openSettings, waitForSettings } from './settings.fixture.mjs';

export async function checkAppShortcuts() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const canvas = document.querySelector('canvas');
  const command = /Mac|iPhone|iPad/i.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
  const key = async (value, target = canvas, extra = {}) => {
    target.focus();
    const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(event);
    target.dispatchEvent(new KeyboardEvent('keyup', { key: value, bubbles: true, cancelable: true, ...extra }));
    await frames();
    return event.defaultPrevented;
  };
  const close = async () => {
    document.querySelectorAll(':popover-open').forEach(panel => panel.hidePopover());
    await frames();
  };
  const frame = document.createElement('iframe');
  try {
    await close();
    for (const unused of ['Escape', 'g']) {
      await key(unused);
      assert(!document.querySelector('.settings-page'), 'Leave Escape and G unbound to Settings');
    }
    await key(',', canvas, command);
    const settings = await waitForSettings(true);
    assert(document.activeElement === settings.querySelector('h2'), 'The platform shortcut opens and focuses Settings');
    await key(',', settings.querySelector('button'), command); await waitForSettings(false);
    const shortcuts = await openSettings('shortcuts');
    for (const row of shortcuts.querySelectorAll('.shortcut-row')) {
      assert(row.scrollWidth <= row.clientWidth, 'App shortcut labels must fit narrow screens');
    }
    await closeSettings();
    await key('f');
    const input = document.querySelector('.catalog-panel .structure-search input');
    assert(document.activeElement !== input, 'Plain F must not move focus to search');
    assert(!await key('f', canvas, command), 'Let the browser handle its native Find shortcut');
    assert(document.activeElement !== input, 'Preserve the browser Find shortcut');
    assert(!await key('/', canvas, { ctrlKey: true }) && document.activeElement !== input, 'Ctrl+/ must not move focus to search');
    input.focus();
    assert(document.activeElement === input, 'Structure search is directly focusable');
    for (const value of ['g', 't', 'f']) await key(value, input);
    assert(!document.querySelector('.settings-page') && document.activeElement === input, 'Typing does not activate app shortcuts');
    await close();
    const roots = [...document.querySelectorAll('.structure-tree > li > .folder-row .tree-name')];
    roots[0].click(); await frames(); const first = document.querySelector('.information-heading h2').textContent;
    roots[1].click(); await frames(); const second = document.querySelector('.information-heading h2').textContent;
    await key('[', canvas, command); assert(document.querySelector('.information-heading h2').textContent === first, 'Platform modifier + [ goes Back');
    await key(']', canvas, command); assert(document.querySelector('.information-heading h2').textContent === second, 'Platform modifier + ] goes Forward');
    window.postMessage({ type: 'wikipedia:shortcut', key: ',', code: 'Comma', ctrlKey: false, metaKey: false, shiftKey: false, ...command }, '*');
    await frames(); assert(!document.querySelector('.settings-page'), 'Ignore shortcut messages from unknown windows');
    frame.className = 'wikipedia-article'; frame.sandbox = 'allow-scripts';
    frame.srcdoc = wikipediaPage('<html><head></head><body><script>addEventListener("message", e => { if(e.data?.type === "test:key") dispatchEvent(new KeyboardEvent("keydown", {key:e.data.key, code:e.data.code || "KeyG", metaKey:!!e.data.metaKey, ctrlKey:!!e.data.ctrlKey, bubbles:true, cancelable:true})); });</script></body></html>', new URL('https://en.wikipedia.org/wiki/Skeleton'), frameTemplate);
    const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
    document.body.append(frame); await loaded;
    frame.contentWindow.postMessage({ type: 'wikipedia:bindings', bindings: frameShortcuts() }, '*');
    frame.contentWindow.postMessage({ type: 'test:key', key: ',', code: 'Comma', ...command }, '*');
    await waitForSettings(true);
    await closeSettings();
    frame.contentWindow.postMessage({ type: 'test:key', key: 'f', code: 'KeyF' }, '*');
    await frames();
    assert(document.activeElement !== input, 'Plain F in an article must not move focus to search');
    frame.contentWindow.postMessage({ type: 'test:key', key: 'f', code: 'KeyF', ...command }, '*');
    await frames();
    assert(document.activeElement !== input, 'Article browser Find must remain available');
    frame.contentWindow.postMessage({ type: 'test:key', key: '/', code: 'Slash', ctrlKey: true }, '*');
    await frames();
    assert(document.activeElement !== input, 'Ctrl+/ in an article must not move focus to search');
    return { settings: true, inlineSearch: true, history: true, typingPreserved: true, article: true, sourceValidated: true };
  } finally { frame.remove(); await closeSettings(); await close(); }
}
