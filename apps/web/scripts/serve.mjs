import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { wikipediaProxy } from './wikipedia-proxy.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

export function createWebServer(directory = dist) {
  return createServer((req, res) => {
    wikipediaProxy(req, res, async () => {
      try {
        if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const page = ['/', '/home', '/anatomy', '/lessons', '/games', '/settings'].includes(pathname.replace(/\/+$/, '') || '/') ||
          /^\/lessons\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/edit)?\/?$/.test(pathname);
        const index = path.resolve(directory, 'index.html');
        let file = page ? index : path.resolve(directory, '.' + pathname);
        if (!file.startsWith(path.resolve(directory) + path.sep)) { res.writeHead(403).end(); return; }
        let status = 200;
        if (!(await stat(file).catch(() => null))?.isFile()) {
          if (page || path.extname(pathname) || !req.headers.accept?.includes('text/html')) {
            res.writeHead(404).end();
            return;
          }
          file = index;
          status = 404;
          if (!(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
        }
        res.writeHead(status, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
        if (req.method === 'HEAD') res.end(); else await pipeline(createReadStream(file), res);
      } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
    }).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT must be between 1 and 65535');
  createWebServer().listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`Soma: http://${process.env.HOST ?? '127.0.0.1'}:${port}`));
}
