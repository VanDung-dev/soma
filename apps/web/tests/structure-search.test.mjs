import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('structure search matches names, Latin and laterality, and reveals the selected tree path', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' });
  try {
    const { searchStructures, StructureSearch } = await server.ssrLoadModule('/src/structure-search.tsx');
    const { StructureTree } = await server.ssrLoadModule('/src/structure-tree.tsx');
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
    assert.deepEqual(searchStructures(parts, '   '), []);
    assert.deepEqual(searchStructures(parts, 'does-not-exist'), []);
    assert.deepEqual(searchStructures(parts, '---'), []);
    assert.deepEqual(searchStructures([], 'femur'), []);
    const withLeftHead = [part('left-head', 'Head of femur', 'Caput femoris', 'left'), ...parts];
    for (const query of ['Femur left', 'Femur trai', 'xuong dui trai', 'Xương đùi · trái']) {
      assert.equal(searchStructures(withLeftHead, query)[0].source_id, 'left', query);
    }
    const html = renderToStaticMarkup(createElement(StructureSearch, { structures: parts, disabled: true, onSelect() {} }));
    assert.match(html, /role="search"/);
    assert.match(html, /<input[^>]*type="search"[^>]*disabled=""/);
    assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Tìm kiếm"/);

    const catalog = JSON.parse(await readFile(new URL('../../../content/catalog.json', import.meta.url)));
    const metadata = JSON.parse(await readFile(new URL('../public/models/z-anatomy/skeletal-system.json', import.meta.url)));
    const femur = metadata.structures.find(p => p.source_name === 'Femur');
    assert(femur);
    const tree = renderToStaticMarkup(createElement(StructureTree, {
      catalog, structures: metadata.structures, visibleIds: new Set([femur.source_id]), selected: femur.source_id,
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
  } finally { await server.close(); }
});
