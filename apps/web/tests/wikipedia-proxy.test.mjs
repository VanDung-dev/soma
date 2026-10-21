import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { wikipediaUrl, wikipediaProxy } from '../scripts/wikipedia-proxy.mjs';

test('Wikipedia proxy preserves the original page and isolates read-only upstream access', async () => {
  for (const value of ['http://en.wikipedia.org/wiki/Skeleton', 'https://en.wikipedia.org.evil.example/wiki/Skeleton',
    'https://user:password@en.wikipedia.org/wiki/Skeleton', 'https://en.wikipedia.org:444/wiki/Skeleton',
    'https://en.wikipedia.org/w/api.php', 'https://en.wikipedia.org/wiki/', 'https://en.wikipedia.org/wiki/Skeleton?action=edit',
    'https://en.wikipedia.org/wiki/Skeleton#%ZZ', 'file:///etc/passwd', null]) assert.equal(wikipediaUrl(value), undefined);
  assert.equal(wikipediaUrl('https://vi.wikipedia.org/wiki/Bộ_xương').searchParams.get('useskin'), 'vector-2022');
  const nativeFetch = globalThis.fetch;
  const calls = [];
  let mode = 'page';
  let started, aborted;
  const original = '<!doctype html><html><head><script src="/w/load.php"></script></head><body><header class="vector-header">Wikipedia</header><h1>Skeleton</h1><input id="p-lang-btn-checkbox"><input id="vector-page-titlebar-toc-checkbox"></body></html>';
  globalThis.fetch = async (url, options) => {
    calls.push({ url: new URL(url), options });
    if (mode === 'slow') {
      started();
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { aborted(); reject(Error('aborted')); }, { once: true }));
    }
    if (mode === 'error') throw Error('offline');
    if (mode === 'escape') return new Response('', { status: 302, headers: { location: 'https://example.com/wiki/Skeleton' } });
    if (mode === 'redirect' && new URL(url).pathname === '/wiki/Alias') return new Response('', { status: 302, headers: { location: '/wiki/Skeleton' } });
    return new Response(original, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  const server = createServer((req, res) => wikipediaProxy(req, res, () => res.writeHead(404).end()));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/wikipedia?url=`;
    const response = await nativeFetch(base + encodeURIComponent('https://en.wikipedia.org/wiki/Skeleton#Humans'));
    const html = await response.text();
    assert.equal(response.status, 200);
    assert(html.includes('<base href="https://en.wikipedia.org/wiki/Skeleton">'));
    assert(html.includes('header.vector-header { display: none !important; }'));
    assert(html.includes('<header class="vector-header">Wikipedia</header><h1>Skeleton</h1>'));
    assert(html.includes('<script src="/w/load.php"></script>') && html.includes('id="p-lang-btn-checkbox"') && html.includes('id="vector-page-titlebar-toc-checkbox"'));
    assert(!html.includes("wikipedia:contextmenu") && !html.includes("addEventListener('contextmenu'"));
    assert(!html.includes('wikipedia:pointerdown') && html.includes('wikipedia:shortcut'));
    assert(!html.includes('reader-navigation'));
    assert(response.headers.get('content-security-policy').includes('sandbox allow-scripts'));
    assert(!response.headers.get('content-security-policy').includes('allow-same-origin'));
    assert.equal(calls[0].options.redirect, 'manual');
    assert(!calls[0].options.headers.Cookie);
    assert.equal(calls[0].url.searchParams.get('useskin'), 'vector-2022');
    assert.equal((await nativeFetch(base + encodeURIComponent('https://example.com/wiki/Skeleton'))).status, 400);
    assert.equal(calls.length, 1);
    assert.equal((await nativeFetch(base + encodeURIComponent('https://en.wikipedia.org/wiki/Skeleton'), { method: 'POST' })).status, 405);
    assert.equal(calls.length, 1);
    mode = 'escape';
    assert.equal((await nativeFetch(base + encodeURIComponent('https://en.wikipedia.org/wiki/Skeleton'))).status, 502);
    assert.equal(calls.length, 2, 'Do not follow redirects outside Wikipedia');
    mode = 'redirect';
    const redirected = await nativeFetch(base + encodeURIComponent('https://en.wikipedia.org/wiki/Alias#Humans'));
    assert.equal(redirected.status, 200);
    assert((await redirected.text()).includes('Skeleton?useskin=vector-2022#Humans'));
    mode = 'error';
    const offline = await nativeFetch(base + encodeURIComponent('https://en.wikipedia.org/wiki/Skeleton'));
    assert.equal(offline.status, 502);
    const offlineHtml = await offline.text();
    assert(offlineHtml.includes('Không tải được Wikipedia') && offlineHtml.includes('wikipedia:shortcut'));
    assert(!offlineHtml.includes("addEventListener('contextmenu'"));
    assert(offline.headers.get('content-security-policy').includes("default-src 'none'")
      && !offline.headers.get('content-security-policy').includes('allow-same-origin'));
    mode = 'slow';
    const start = new Promise(resolve => { started = resolve; });
    const abort = new Promise(resolve => { aborted = resolve; });
    const controller = new AbortController();
    const pending = nativeFetch(base + encodeURIComponent('https://en.wikipedia.org/wiki/Skeleton'), { signal: controller.signal });
    await start; controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    await abort;
  } finally {
    globalThis.fetch = nativeFetch;
    await new Promise(resolve => server.close(resolve));
  }
});
