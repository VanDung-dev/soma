export function wikipediaUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/^[a-z][a-z0-9-]*\.wikipedia\.org$/.test(url.hostname)
      || url.username || url.password || url.port || !url.pathname.startsWith('/wiki/') || url.pathname === '/wiki/'
      || [...url.searchParams.keys()].some(key => !['useskin', 'variant'].includes(key))) return;
    decodeURIComponent(url.pathname); decodeURIComponent(url.hash);
    url.searchParams.set('useskin', 'vector-2022');
    return url;
  } catch { return; }
}

function frameBridge(source) {
  // The isolated frame has no cookies; Vector reads them during startup.
  Object.defineProperty(document, 'cookie', { get: () => '', set: () => {} });
  const original = new URL(source);
  const proxy = new URL(location.href); proxy.hash = '';
  const report = type => {
    const url = new URL(original); url.hash = location.hash;
    url.searchParams.delete('useskin');
    parent.postMessage({ type: `wikipedia:${type}`, url: url.href }, '*');
  };
  const apiUrl = value => {
    const url = new URL(value, document.baseURI);
    if (/^[a-z][a-z0-9-]*\.wikipedia\.org$/.test(url.hostname) && url.pathname === '/w/api.php') url.searchParams.set('origin', '*');
    return url.href;
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...args) { return open.call(this, method, apiUrl(url), ...args); };
  const nativeFetch = window.fetch;
  window.fetch = (input, options) => nativeFetch(typeof input === 'string' || input instanceof URL ? apiUrl(input) : input, options);
  let blockContextMenu = false;
  const rewrite = link => {
    let url;
    try { url = new URL(link.href); } catch { return; }
    if (url.origin === proxy.origin && url.pathname === proxy.pathname) return;
    if (url.origin === original.origin && url.pathname === original.pathname && url.hash && !url.search) {
      const target = new URL(proxy); target.hash = url.hash; link.href = target.href;
    } else if (url.protocol === 'https:' && /^[a-z][a-z0-9-]*\.wikipedia\.org$/.test(url.hostname)
      && url.pathname.startsWith('/wiki/') && !url.search && !url.username && !url.password && !url.port) {
      const target = new URL(proxy); target.searchParams.set('url', url.href); target.hash = url.hash; link.href = target.href;
    } else { link.target = '_blank'; link.rel = 'noreferrer'; }
  };
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') rewrite(record.target);
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches('a[href]')) rewrite(node);
        node.querySelectorAll('a[href]').forEach(rewrite);
      }
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] });
  addEventListener('hashchange', () => report('location'));
  addEventListener('beforeunload', () => report('loading'));
  addEventListener('contextmenu', event => {
    if (!blockContextMenu) return;
    event.preventDefault();
    parent.postMessage({ type: 'wikipedia:contextmenu-open', x: event.clientX, y: event.clientY }, '*');
  });
  addEventListener('keydown', event => {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.altKey) return;
    const key = event.key.toLowerCase();
    const command = /Mac|iPhone|iPad/i.test(navigator.platform) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (key !== 'escape' && (event.target.isContentEditable || event.target.closest?.('input, textarea, select, [role="textbox"]'))) return;
    if (command ? event.shiftKey ? key !== 's' && event.code !== 'Period' : !['[', ']'].includes(key) && !['BracketLeft', 'BracketRight'].includes(event.code)
      : event.metaKey || event.ctrlKey || event.shiftKey || !['escape', 'g', 't'].includes(key)) return;
    event.preventDefault();
    parent.postMessage({ type: 'wikipedia:shortcut', key: event.key, code: event.code,
      metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey }, '*');
  });
  addEventListener('message', event => {
    if (event.source !== parent) return;
    if (event.data?.type === 'wikipedia:contextmenu' && typeof event.data.blocked === 'boolean') {
      blockContextMenu = event.data.blocked;
      return;
    }
    if (event.data?.type !== 'wikipedia:reset') return;
    const url = new URL(event.data.url);
    if (url.origin !== original.origin || url.pathname !== original.pathname) return;
    location.hash = url.hash;
    const target = url.hash && document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (target) target.scrollIntoView(); else scrollTo(0, 0);
    report('location');
  });
  addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a[href]').forEach(rewrite);
    if (!location.hash && original.hash) location.hash = original.hash;
    report('ready');
  });
}

export function wikipediaPage(html, source) {
  const base = new URL(source); base.searchParams.delete('useskin'); base.hash = '';
  const href = base.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  const script = `(${frameBridge.toString()})(${JSON.stringify(source.href).replaceAll('<', '\\u003c')});`;
  return html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}<base href="${href}"><style>header.vector-header { display: none !important; }</style><script>${script}</script>`);
}

export async function wikipediaProxy(req, res, next) {
  let request;
  try { request = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400).end(); return; }
  if (request.pathname !== '/wikipedia') return next();
  if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }).end(); return; }
  let source = wikipediaUrl(request.searchParams.get('url'));
  if (!source) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Liên kết Wikipedia không hợp lệ.'); return; }
  const controller = new AbortController();
  res.once('close', () => controller.abort());
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
  try {
    let response;
    for (let redirects = 0; redirects <= 5; redirects++) {
      response = await fetch(source, { redirect: 'manual', signal, headers: { 'User-Agent': 'HumanAtlas/0.1 (Wikipedia article reader)' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      const target = location && wikipediaUrl(new URL(location, source).href);
      await response.body?.cancel();
      if (!target || redirects === 5) throw Error('Unsupported redirect');
      if (!target.hash) target.hash = source.hash;
      source = target;
    }
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw Error('Wikipedia unavailable');
    const html = wikipediaPage(await response.text(), source);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src https://*.wikipedia.org 'unsafe-inline' 'unsafe-eval'; style-src https://*.wikipedia.org 'unsafe-inline'; img-src https://*.wikipedia.org https://*.wikimedia.org data:; font-src https://*.wikipedia.org https://*.wikimedia.org data:; connect-src https://*.wikipedia.org https://*.wikimedia.org; media-src https://*.wikimedia.org blob:; base-uri https://*.wikipedia.org; form-action 'none'; frame-src 'none'",
    }).end(html);
  } catch {
    if (res.destroyed) return;
    res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; base-uri https://*.wikipedia.org" })
      .end(wikipediaPage('<!doctype html><html lang="vi"><head><meta charset="utf-8"></head><body><p>Không tải được Wikipedia. Hãy thử “Về bài của bộ phận” hoặc mở bài gốc.</p></body></html>', source));
  }
}

export const wikipediaProxyPlugin = {
  name: 'wikipedia-proxy',
  configureServer(server) { server.middlewares.use(wikipediaProxy); },
  configurePreviewServer(server) { server.middlewares.use(wikipediaProxy); },
};
