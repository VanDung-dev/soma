import { readFileSync } from 'node:fs';
import { wikipediaPage } from './wikipedia-page.mjs';

const frameTemplate = readFileSync(new URL('./wikipedia-frame.html', import.meta.url), 'utf8');
const frameCsp = readFileSync(new URL('./wikipedia-frame.csp', import.meta.url), 'utf8').trim();

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
      response = await fetch(source, { redirect: 'manual', signal, headers: { 'User-Agent': 'Soma/0.1 (Wikipedia article reader)' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      const target = location && wikipediaUrl(new URL(location, source).href);
      await response.body?.cancel();
      if (!target || redirects === 5) throw Error('Unsupported redirect');
      if (!target.hash) target.hash = source.hash;
      source = target;
    }
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw Error('Wikipedia unavailable');
    const html = wikipediaPage(await response.text(), source, frameTemplate);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': frameCsp,
    }).end(html);
  } catch {
    if (res.destroyed) return;
    res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; base-uri https://*.wikipedia.org" })
      .end(wikipediaPage('<!doctype html><html lang="vi"><head><meta charset="utf-8"></head><body><p>Không tải được Wikipedia</p></body></html>', source, frameTemplate));
  }
}

export const wikipediaProxyPlugin = {
  name: 'wikipedia-proxy',
  configureServer(server) { server.middlewares.use(wikipediaProxy); },
  configurePreviewServer(server) { server.middlewares.use(wikipediaProxy); },
};
