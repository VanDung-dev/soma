import { modelMetadata } from './model.fixture.mjs';
import { initCatalogWasm, createCatalogFixture } from './catalog.fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('structure search matches names, Latin and laterality, and reveals the selected tree path', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const wasm = await initCatalogWasm(server);
    const { Catalog } = await server.ssrLoadModule('/src/anatomy/catalog/index.ts');
    const { StructureSearch } = await server.ssrLoadModule('/src/anatomy/structure-search.tsx');
    const fixture = parts => {
      const ids = parts.map((_, i) => 'za:' + i.toString(16).padStart(16, '0'));
      const targets = parts.length ? [{ id: 'fixture', title: 'Fixture', source_name: 'Fixture', group_id: 'g', structure_ids: ids,
        model: { path: 'models/z-anatomy/fixture.glb', scope: 'fixture', structure_ids: ids } }] : [];
      const raw = { schema_version: 1, groups: parts.length ? [{ id: 'g', title: 'Fixture' }] : [], targets };
      const store = new Catalog(wasm.CatalogData.from_json(JSON.stringify(raw)));
      if (parts.length) store.ingestMetadata(store.roots[0], JSON.stringify({ structures: parts.map((part, i) => ({ ...part, source_id: ids[i] })) }));
      store.finish();
      return { store, ids, search: query => store.search(query, 'vi', 100).items.map(row => ({ ...row, source_id: parts[ids.indexOf(row.source_id)].source_id })) };
    };
    const searchStructures = (parts, query) => { const f = fixture(parts); try { return f.search(query); } finally { f.store.free(); } };
    const { StructureTree } = await server.ssrLoadModule('/src/anatomy/structure-tree.tsx');
    const part = (id, name, latin, laterality = '') => ({ source_id: id, source_name: name,
      source_object: name, latin, laterality, collections: [] });
    const parts = [part('head', 'Head of femur', 'Caput femoris'),
      part('right', 'Femur', 'Os femoris', 'right'), part('left', 'Femur', 'Os femoris', 'left'),
      part('clavicle', 'Xương đòn', 'Clavicula')];
    assert.deepEqual(searchStructures(parts, '  FEMUR ').map(p => p.source_id), ['right', 'left', 'head']);
    assert.deepEqual(searchStructures(parts, 'femur trai').map(p => p.source_id), ['left']);
    assert.deepEqual(searchStructures(parts, 'femur phải').map(p => p.source_id), ['right']);
    assert.deepEqual(searchStructures(parts, 'xương đùi').map(p => p.source_id), ['right', 'left', 'head']);
    assert.deepEqual(searchStructures(parts, 'XUONG DUI TRAI').map(p => p.source_id), ['left']);
    assert.deepEqual(searchStructures(parts, 'Femur left').map(p => p.source_id), ['left']);
    assert.deepEqual(searchStructures(parts, 'os femoris').map(p => p.source_id), ['right', 'left']);
    assert.deepEqual(searchStructures(parts, 'xuong don').map(p => p.source_id), ['clavicle']);
    assert.equal(searchStructures(parts, '   ').length, parts.length, 'Blank input shows A–Z');
    assert.deepEqual(searchStructures(parts, 'does-not-exist'), []);
    assert.deepEqual(searchStructures(parts, '---'), []);
    assert.deepEqual(searchStructures([], 'femur'), []);
    const withLeftHead = [part('left-head', 'Head of femur', 'Caput femoris', 'left'), ...parts];
    for (const query of ['Femur left', 'Femur trai', 'xuong dui trai', 'Xương đùi · trái']) {
      assert.equal(searchStructures(withLeftHead, query)[0].source_id, 'left', query);
    }
    const html = renderToStaticMarkup(createElement(StructureSearch, { catalog: fixture(parts).store, disabled: true, onSelect() {} }));
    assert.match(html, /role="search"/);
    assert.match(html, /<input[^>]*type="search"[^>]*disabled=""/);
    assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Tìm kiếm"/);
    assert.match(html, /class="structure-search-field"[^>]*popoverTarget=/);
    assert.match(html, /class="structure-search-popover"[^>]*popover="auto"[^>]*role="dialog"/);
    assert.match(html, /role="combobox"/);
    assert.match(html, /role="listbox"/);
    assert.doesNotMatch(html, /class="controls-info"/);
    const alphabetical = renderToStaticMarkup(createElement(StructureSearch, {
      catalog: fixture([part('unknown', '???', ''), part('z', 'ZzzAtlas', ''), part('a', 'AaaAtlas', ''), part('m', 'MmmAtlas', '')]).store,
      disabled: false, onSelect() {},
    }));
    assert(alphabetical.indexOf('data-structure-id="za:0000000000000002"') < alphabetical.indexOf('data-structure-id="za:0000000000000003"'));
    assert(alphabetical.indexOf('data-structure-id="za:0000000000000003"') < alphabetical.indexOf('data-structure-id="za:0000000000000001"'));
    assert(alphabetical.indexOf('data-structure-id="za:0000000000000001"') < alphabetical.indexOf('data-structure-id="za:0000000000000000"'));
    const find = query => searchStructures(parts, query);
    assert.deepEqual(find('femur').map(part => part.source_id), ['right', 'left', 'head']);
    assert.deepEqual(find('xuong dui trai').map(part => part.source_id), ['left']);
    assert.deepEqual(find('Clavicula').map(part => part.source_id), ['clavicle']);

    const catalog = JSON.parse(await readFile(new URL('../../../content/catalog.json', import.meta.url)));
    const metadata = modelMetadata('skeletal-system');
    const femur = metadata.structures.find(p => p.source_name === 'Femur');
    assert(femur);
    const tree = renderToStaticMarkup(createElement(StructureTree, {
      catalog: await createCatalogFixture(server, catalog, [[catalog.targets.find(target => target.source_name === '1: Skeletal system'), metadata]]), visibleIds: new Set([femur.source_id]), selected: femur.source_id,
      reveal: { id: femur.source_id }, disabled: false,
      onVisibility() {}, onSelect() {}, onTarget() {}, onFocus() {},
    }));
    assert(tree.includes(`data-structure-id="${femur.source_id}"`), 'Search must open ancestors of the exact structure');
    assert.match(tree, /class="tree-row part-row is-selected"/);
    assert.match(tree, /aria-expanded="true"/);
    assert.match(tree, /Xương đùi · (trái|phải)/);
    assert.match(tree, /<small lang="en">Femur · (left|right)<\/small>/);
    assert.match(tree, /Bộ xương chi|Xương chi|Xương đùi/);
    assert.doesNotMatch(tree, /class="tree-focus"/);
    assert.match(tree, /<small class="tree-count"><span>277<\/span> <span>cấu trúc<\/span><\/small>/);
    assert.match(tree, /aria-keyshortcuts="Shift\+Enter"/);
    assert.doesNotMatch(tree, /is-search-match|<mark>/);
  } finally { await server.close(); }
});
