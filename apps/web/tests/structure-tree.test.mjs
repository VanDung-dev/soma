import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('each system checkbox covers only its Blender display collection', async () => {
  const catalog = JSON.parse(await readFile(new URL('../../../content/catalog.json', import.meta.url)));
  const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom' });
  try {
    const { StructureTree } = await server.ssrLoadModule('/src/structure-tree.tsx');
    const roots = catalog.targets.filter(target => target.model);
    for (const root of roots) {
      const html = renderToStaticMarkup(createElement(StructureTree, {
        catalog, structures: [], visibleIds: new Set(root.model.structure_ids), selected: '', disabled: false,
        onVisibility() {}, onSelect() {}, onTarget() {},
      }));
      const inputs = html.match(/<input\b[^>]*>/g);
      for (const other of roots) {
        const input = inputs.find(input => input.includes(`aria-label="Hiện ${other.title}"`));
        assert(input, other.title);
        assert.equal(input.includes('checked=""'), other === root, `${root.title}: ${other.title}`);
      }
      assert(html.includes(`${root.model.structure_ids.length} cấu trúc`), root.title);
    }
  } finally {
    await server.close();
  }
});
