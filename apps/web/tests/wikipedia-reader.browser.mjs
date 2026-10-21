import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { WikipediaReader } from '../src/anatomy/wikipedia-reader.tsx';
import { wikipediaPage } from '../scripts/wikipedia-proxy.mjs';

// Run in Vite: (await import('/tests/wikipedia-reader.browser.mjs')).checkWikipediaReader()
export async function checkWikipediaReader() {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const until = async check => {
    const deadline = performance.now() + 3000;
    while (!check()) {
      if (performance.now() > deadline) throw Error('Reader did not settle');
      await new Promise(requestAnimationFrame);
    }
  };
  const source = 'https://en.wikipedia.org/wiki/Skeleton#Humans';
  const host = document.createElement('div'); host.className = 'information-panel';
  Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: '500px', height: '500px', zIndex: '20' });
  document.body.append(host);
  const root = createRoot(host), resets = [];
  const receive = event => { if (event.source === host.querySelector('iframe')?.contentWindow && event.data?.type === 'wikipedia:reset-seen') resets.push(event.data.url); };
  window.addEventListener('message', receive);
  const render = (name = '1: Skeletal system', expanded = false) => root.render(createElement(WikipediaReader, { key: name, name, expanded }));
  const send = (type, url, from = host.querySelector('iframe').contentWindow) => window.dispatchEvent(new MessageEvent('message', { source: from, origin: 'null', data: { type, url } }));
  try {
    render(); await until(() => host.querySelector('iframe'));
    const frame = host.querySelector('iframe');
    assert(frame.src.includes('/wikipedia?url=') && frame.title.includes('Hệ xương'), 'Embed the proxy page with an accessible title');
    assert(!frame.sandbox.contains('allow-same-origin') && frame.sandbox.contains('allow-scripts'), 'Isolate native Wikipedia scripts from the app');
    assert(!host.querySelector('.reader-navigation,h1'), 'Do not recreate Wikipedia controls in React');
    frame.srcdoc = wikipediaPage(`<html><head></head><body><script>addEventListener('message', e => {
      if(e.data?.type === 'wikipedia:reset') parent.postMessage({type:'wikipedia:reset-seen',url:e.data.url},'*');
      if(e.data?.type === 'wikipedia:test-loading') dispatchEvent(new Event('beforeunload'));
    }); parent.postMessage({type:'wikipedia:test-ready'},'*');<\/script></body></html>`, new URL(source));
    await new Promise(resolve => { const ready = event => { if(event.source === frame.contentWindow && event.data?.type === 'wikipedia:test-ready') { window.removeEventListener('message',ready); resolve(); } }; window.addEventListener('message',ready); });
    send('wikipedia:ready', source);
    await until(() => frame.getAttribute('aria-busy') === 'false');
    assert(!host.querySelector('.wikipedia-skeleton'), 'Remove the loading skeleton when the article is ready');
    const height = host.querySelector('.wikipedia-frame').getBoundingClientRect().height;
    send('wikipedia:loading', source, window);
    send('wikipedia:loading', 'https://en.wikipedia.org.evil.example/wiki/Skeleton');
    await new Promise(requestAnimationFrame);
    assert(!host.querySelector('.wikipedia-skeleton'), 'Ignore untrusted loading messages');
    frame.contentWindow.postMessage({ type: 'wikipedia:test-loading' }, '*');
    await until(() => host.querySelector('.wikipedia-skeleton'));
    assert(frame.getAttribute('aria-busy') === 'true' && host.querySelector('.wikipedia-skeleton [aria-hidden="true"]'),
      'Show accessible loading status with decorative placeholders during navigation');
    assert(host.querySelector('.wikipedia-frame').getBoundingClientRect().height === height, 'Keep the article geometry while loading');
    assert(frame.getBoundingClientRect().height === height, 'Fill the loading area with the real article frame');
    send('wikipedia:ready', source);
    await until(() => !host.querySelector('.wikipedia-skeleton'));
    send('wikipedia:loading', source);
    await until(() => host.querySelector('.wikipedia-skeleton'));
    frame.dispatchEvent(new Event('load'));
    await until(() => !host.querySelector('.wikipedia-skeleton'));
    send('wikipedia:location', 'https://vi.wikipedia.org/wiki/Bộ_xương', window);
    send('wikipedia:location', 'https://en.wikipedia.org.evil.example/wiki/Skeleton');
    send('wikipedia:location', 'https://en.wikipedia.org/wiki/Skeleton?action=edit');
    await new Promise(requestAnimationFrame);
    assert(host.querySelector('.reader-actions > a').href === source, 'Reject messages from other windows and untrusted URLs');
    send('wikipedia:location', 'https://en.wikipedia.org/wiki/Skeleton#Classification');
    await until(() => host.querySelector('.reader-actions > a').hash === '#Classification');
    render('1: Skeletal system', true);
    await until(() => resets.length > 0);
    assert(resets.at(-1) === source, 'Expansion restores the mapped section while still on the same article');
    send('wikipedia:ready', 'https://vi.wikipedia.org/wiki/Bộ_xương');
    await until(() => host.querySelector('.reader-actions > a').hostname === 'vi.wikipedia.org');
    const before = resets.length;
    render('1: Skeletal system', false); await new Promise(requestAnimationFrame);
    assert(resets.length === before, 'Preserve the translated article when collapsing');
    host.querySelector('.reader-actions > button').click();
    await until(() => host.querySelector('iframe') !== frame);
    assert(host.querySelector('.wikipedia-skeleton'), 'Show the skeleton again when returning to the original article');
    assert(host.querySelector('.reader-actions > a').href === source && host.querySelector('iframe').src.includes('Skeleton%23Humans'), 'The return button reloads the selected structure article');
    render('Unmapped part'); await until(() => host.textContent.includes('Chưa gắn bài Wikipedia'));
    assert(!host.querySelector('iframe'), 'Keep unmapped structures explicit');
    return { originalIframe: true, isolation: true, messageValidation: true, expansion: true, translatedPagePreserved: true, return: true, unmapped: true,
      loadingSkeleton: true, loadingBridge: true, stableLoadingGeometry: true, reloadSkeleton: true };
  } finally { window.removeEventListener('message', receive); root.unmount(); host.remove(); }
}
