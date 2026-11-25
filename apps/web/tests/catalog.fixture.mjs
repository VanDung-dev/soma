import { readFile } from 'node:fs/promises';

export async function initCatalogWasm(server) {
  const wasm = await server.ssrLoadModule('/src/content/content.js');
  wasm.initSync({ module: await readFile(new URL('../src/content/content_bg.wasm', import.meta.url)) });
  return wasm;
}

export async function createCatalogFixture(server, source, packages = []) {
  const wasm = await initCatalogWasm(server);
  const { Catalog } = await server.ssrLoadModule('/src/catalog/index.ts');
  const store = new Catalog(wasm.CatalogData.from_json(typeof source === 'string' ? source : JSON.stringify(source)));
  for (const [root, json] of packages) store.ingestMetadata(root, typeof json === 'string' ? json : JSON.stringify(json));
  if (packages.length) store.finish();
  return store;
}
